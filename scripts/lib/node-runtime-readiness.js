'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const STARTUP_BOUNDARY = 'A managed launcher that invokes "node" can be denied before DevCodex JavaScript starts; at that boundary no hook can self-recover.'

function envValue(env, name) {
  const key = Object.keys(env || {}).find(candidate => candidate.toLowerCase() === name.toLowerCase())
  return key ? String(env[key] || '') : ''
}

function bounded(value, limit = 512) {
  const text = String(value || '')
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text
}

function executableNames(platform, env) {
  if (platform !== 'win32') return ['node']
  const extensions = (envValue(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)
    .map(value => value.startsWith('.') ? value : `.${value}`)
  return [...new Set(extensions.map(extension => `node${extension}`))]
}

function resolveAmbientNode(options = {}) {
  const fsImpl = options.fs || fs
  const env = options.env || process.env
  const platform = options.platform || process.platform
  const delimiter = platform === 'win32' ? ';' : path.delimiter
  const pathEntries = envValue(env, 'PATH')
    .split(delimiter)
    .map(value => value.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)
    .slice(0, 128)
  const names = executableNames(platform, env)
  const accessErrors = []
  let candidatesChecked = 0

  for (const entry of pathEntries) {
    for (const name of names) {
      const candidate = path.resolve(entry, name)
      candidatesChecked += 1
      try {
        if (fsImpl.statSync(candidate).isFile()) {
          return {
            status: 'resolved',
            resolvedPath: candidate,
            candidatesChecked,
            pathEntriesChecked: pathEntries.length,
            accessErrors
          }
        }
      } catch (error) {
        if (error && error.code !== 'ENOENT' && error.code !== 'ENOTDIR' && accessErrors.length < 5) {
          accessErrors.push({
            path: bounded(candidate, 260),
            errorCode: error.code || 'UNKNOWN'
          })
        }
      }
    }
  }

  return {
    status: accessErrors.length ? 'unverified' : 'missing',
    resolvedPath: null,
    candidatesChecked,
    pathEntriesChecked: pathEntries.length,
    accessErrors
  }
}

function classifyProvider(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/').toLowerCase()
  if (!normalized) return 'unknown'
  if (normalized.includes('/volta/') || normalized.includes('/.volta/')) return 'volta'
  if (normalized.includes('/nvm/') || normalized.includes('/.nvm/') || normalized.includes('/nvm-')) return 'nvm'
  if (normalized.includes('/fnm/') || normalized.includes('/.fnm/') || normalized.includes('/fnm_multishells/')) return 'fnm'
  if (normalized.includes('/.asdf/') || normalized.includes('/asdf/')) return 'asdf'
  if (
    normalized.includes('/program files/nodejs/') ||
    normalized.startsWith('/usr/bin/') ||
    normalized.startsWith('/usr/local/bin/') ||
    normalized.startsWith('/opt/homebrew/bin/')
  ) return 'system'
  return 'unknown'
}

function classifyLauncher(filePath, provider) {
  const normalized = String(filePath || '').replace(/\\/g, '/').toLowerCase()
  const extension = path.extname(normalized)
  if (!normalized) return 'unknown'
  if (normalized.includes('/shims/') || ['volta', 'nvm', 'fnm', 'asdf'].includes(provider)) return 'shim'
  if (['.cmd', '.bat', '.ps1', '.sh', '.js'].includes(extension)) return 'script'
  if (['.exe', '.com'].includes(extension) || extension === '') return 'binary'
  return 'unknown'
}

function inspectNodeRuntimeReadiness(options = {}) {
  const fsImpl = options.fs || fs
  const env = options.env || process.env
  const platform = options.platform || process.platform
  const spawn = options.spawnSync || spawnSync
  const timeoutMs = Math.max(1000, Math.min(Number(options.timeoutMs) || 5000, 15000))
  const processExecPath = path.resolve(options.processExecPath || process.execPath)
  const processVersion = String(options.processVersion || process.version)
  const ambient = resolveAmbientNode({ fs: fsImpl, env, platform })
  const base = {
    schemaVersion: 'NodeRuntimeReadinessV1',
    processExecPath,
    processVersion,
    ambientCommand: 'node',
    ambientPath: ambient.resolvedPath,
    ambient,
    provider: classifyProvider(ambient.resolvedPath || processExecPath),
    launcherKind: 'unknown',
    smoke: { status: 'skipped', exitCode: null, errorCode: null, version: null, stderr: '' },
    startupBoundary: STARTUP_BOUNDARY
  }
  base.launcherKind = classifyLauncher(ambient.resolvedPath || processExecPath, base.provider)

  if (!ambient.resolvedPath) {
    const denied = ambient.status === 'unverified'
    return {
      ...base,
      status: denied ? 'UNVERIFIED' : 'BLOCK',
      reasonCode: denied ? 'ambient-node-search-denied' : 'ambient-node-missing',
      nextStep: denied
        ? 'Grant read access to the Node launcher directories, then rerun `devcodex doctor`.'
        : 'Install Node.js >=18.17.0 or add a stable Node launcher to PATH, then rerun `devcodex doctor`.'
    }
  }

  let result
  try {
    result = spawn(ambient.resolvedPath, ['--version'], {
      encoding: 'utf8',
      env,
      timeout: timeoutMs,
      windowsHide: true
    })
  } catch (error) {
    result = { status: null, stdout: '', stderr: '', error }
  }
  const errorCode = result?.error?.code || null
  const output = bounded(String(result?.stdout || '').trim(), 80)
  const smoke = {
    status: result?.status === 0 ? 'passed' : 'failed',
    exitCode: Number.isInteger(result?.status) ? result.status : null,
    errorCode,
    version: output || null,
    stderr: bounded(String(result?.stderr || result?.error?.message || '').trim(), 240)
  }
  if (result?.status === 0) {
    const versionRecognized = /^v?\d+\.\d+\.\d+/.test(output)
    return {
      ...base,
      status: versionRecognized ? 'PASS' : 'WARN',
      reasonCode: versionRecognized ? null : 'ambient-node-version-unverified',
      nextStep: versionRecognized
        ? null
        : 'Verify that the ambient `node` command is an official supported Node.js runtime.',
      smoke
    }
  }

  const permissionDenied = errorCode === 'EPERM' || errorCode === 'EACCES'
  const timedOut = errorCode === 'ETIMEDOUT' || result?.signal === 'SIGTERM'
  return {
    ...base,
    status: 'BLOCK',
    reasonCode: permissionDenied
      ? 'sandbox-exec-denied'
      : (timedOut ? 'ambient-node-timeout' : 'ambient-node-smoke-failed'),
    nextStep: permissionDenied
      ? 'Approve this Node launcher once in Codex, or use a trusted system Node installation, then rerun `devcodex doctor`.'
      : 'Repair the ambient Node launcher or select a stable Node installation, then rerun `devcodex doctor`.',
    smoke
  }
}

module.exports = {
  STARTUP_BOUNDARY,
  classifyLauncher,
  classifyProvider,
  inspectNodeRuntimeReadiness,
  resolveAmbientNode
}
