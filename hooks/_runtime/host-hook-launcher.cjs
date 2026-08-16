'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const RECEIPT_SCHEMA = 'GlobalHostConfigReceiptV1'
const GENERATION_SCHEMA = 'RuntimeGenerationManifestV1'
const COMPATIBLE_HOSTS = new Set(['claude', 'cursor'])
const SUPPORTED_HOSTS = new Set([
  'claude',
  'codex',
  'copilot',
  'cursor',
  'gemini',
  'grok'
])

function launcherError (code, detail) {
  const error = new Error(`${code}: ${detail}`)
  error.code = code
  return error
}

function envValue (env, name) {
  const key = Object.keys(env || {}).find(candidate => candidate.toLowerCase() === name.toLowerCase())
  return key ? String(env[key] || '').trim() : ''
}

/**
 * Grok imports user Claude hooks by default. The dedicated DevCodex Grok
 * plugin owns lifecycle execution, so an imported DevCodex Claude hook must
 * exit before receipt resolution or a second runtime process is started.
 * Grok reserves and injects all four variables for every hook process.
 */
function isGrokImportedClaudeHook (host, env = process.env) {
  if (String(host || '').trim().toLowerCase() !== 'claude') return false
  return [
    'GROK_HOOK_EVENT',
    'GROK_HOOK_NAME',
    'GROK_SESSION_ID',
    'GROK_WORKSPACE_ROOT'
  ].every(name => envValue(env, name) !== '')
}

function isInside (root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

function readJson (file, label, fsImpl = fs) {
  let value
  try {
    value = JSON.parse(fsImpl.readFileSync(file, 'utf8'))
  } catch (error) {
    throw launcherError('GLOBAL_HOST_LAUNCHER_METADATA_INVALID', `${label}: ${error.message}`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw launcherError('GLOBAL_HOST_LAUNCHER_METADATA_INVALID', `${label}: object required`)
  }
  return value
}

function resolveCurrentAdapter (host, options = {}) {
  const fsImpl = options.fs || fs
  const normalizedHost = String(host || '').trim().toLowerCase()
  if (!SUPPORTED_HOSTS.has(normalizedHost)) {
    throw launcherError('GLOBAL_HOST_LAUNCHER_HOST_UNSUPPORTED', normalizedHost || '(missing)')
  }
  const baseRoot = path.resolve(options.baseRoot || __dirname)
  const receiptFile = path.join(baseRoot, 'global-host-receipt.json')
  const receipt = readJson(receiptFile, 'global host receipt', fsImpl)
  if (receipt.schemaVersion !== RECEIPT_SCHEMA ||
      receipt.result !== 'committed' ||
      receipt.host !== normalizedHost) {
    throw launcherError('GLOBAL_HOST_LAUNCHER_RECEIPT_MISMATCH', receiptFile)
  }
  const runtimeRoot = path.resolve(String(receipt.runtimeRoot || ''))
  if (!receipt.runtimeRoot || !isInside(baseRoot, runtimeRoot) || runtimeRoot === baseRoot) {
    throw launcherError('GLOBAL_HOST_LAUNCHER_RUNTIME_ESCAPE', runtimeRoot || '(missing)')
  }
  const generationFile = path.join(runtimeRoot, 'runtime-generation.json')
  const generation = readJson(generationFile, 'runtime generation', fsImpl)
  if (generation.schemaVersion !== GENERATION_SCHEMA ||
      generation.generationId !== receipt.runtimeGeneration?.generationId ||
      generation.packageVersion !== receipt.packageVersion ||
      generation.sourceDigest !== receipt.runtimeGeneration?.sourceDigest) {
    throw launcherError('GLOBAL_HOST_LAUNCHER_GENERATION_MISMATCH', generationFile)
  }
  const adapterName = COMPATIBLE_HOSTS.has(normalizedHost)
    ? 'lifecycle-cursor-compatible.cjs'
    : 'lifecycle-host-adapters.cjs'
  const adapter = path.join(runtimeRoot, 'hooks', '_runtime', adapterName)
  let stat
  try {
    stat = fsImpl.statSync(adapter)
  } catch (error) {
    throw launcherError('GLOBAL_HOST_LAUNCHER_ADAPTER_MISSING', `${adapter}: ${error.message}`)
  }
  if (!stat.isFile() || !isInside(runtimeRoot, adapter)) {
    throw launcherError('GLOBAL_HOST_LAUNCHER_ADAPTER_INVALID', adapter)
  }
  return {
    schemaVersion: 'StableHostHookLauncherResolutionV1',
    host: normalizedHost,
    baseRoot,
    receiptFile,
    runtimeRoot,
    generation,
    adapter
  }
}

function main () {
  if (isGrokImportedClaudeHook(process.argv[2], process.env)) {
    process.exit(0)
    return
  }
  let resolved
  try {
    resolved = resolveCurrentAdapter(process.argv[2])
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exit(2)
    return
  }
  const result = spawnSync(
    process.execPath,
    [resolved.adapter, resolved.host, ...process.argv.slice(3)],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
      windowsHide: true
    }
  )
  if (result.error) {
    process.stderr.write(`GLOBAL_HOST_LAUNCHER_SPAWN_FAILED: ${result.error.message}\n`)
    process.exit(2)
    return
  }
  process.exit(Number.isInteger(result.status) ? result.status : 2)
}

if (require.main === module) main()

module.exports = {
  COMPATIBLE_HOSTS,
  SUPPORTED_HOSTS,
  isInside,
  isGrokImportedClaudeHook,
  resolveCurrentAdapter
}
