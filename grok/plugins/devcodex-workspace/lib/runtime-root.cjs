'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

function resolveGrokHome(env = process.env, options = {}) {
  const home = options.home || env.USERPROFILE || env.HOME || os.homedir()
  return path.resolve(options.grokHome || env.GROK_HOME || path.join(home, '.grok'))
}

function isUnder(root, target) {
  if (!root || !target) return false
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function realpathExistingPrefix(target, fsImpl = fs) {
  const resolved = path.resolve(target)
  const missing = []
  let cursor = resolved
  while (!fsImpl.existsSync(cursor)) {
    const parent = path.dirname(cursor)
    if (parent === cursor) return resolved
    missing.unshift(path.basename(cursor))
    cursor = parent
  }
  const realpath = fsImpl.realpathSync && (fsImpl.realpathSync.native || fsImpl.realpathSync)
  const physical = realpath ? path.resolve(realpath.call(fsImpl.realpathSync, cursor)) : cursor
  return path.resolve(physical, ...missing)
}

function isUnderPhysical(root, target, fsImpl = fs) {
  return isUnder(realpathExistingPrefix(root, fsImpl), realpathExistingPrefix(target, fsImpl))
}

function readJson(file, fsImpl = fs) {
  try {
    return JSON.parse(fsImpl.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function resolveGrokRuntimeRoot(env = process.env, options = {}) {
  const fsImpl = options.fs || fs
  const grokHome = resolveGrokHome(env, options)
  const managedRoot = path.join(grokHome, 'devcodex')
  const legacyRoot = path.join(managedRoot, 'runtime')
  const receipt = readJson(path.join(managedRoot, 'global-host-receipt.json'), fsImpl)
  const candidate = receipt?.runtimeRoot ? path.resolve(receipt.runtimeRoot) : null

  if (!candidate || !isUnderPhysical(managedRoot, candidate, fsImpl) || receipt?.result !== 'committed') {
    return legacyRoot
  }
  if (path.basename(candidate) === 'runtime') return candidate

  const generation = receipt.runtimeGeneration
  const manifest = readJson(path.join(candidate, 'runtime-generation.json'), fsImpl)
  const generationCurrent = generation?.schemaVersion === 'RuntimeGenerationManifestV1' &&
    manifest?.schemaVersion === 'RuntimeGenerationManifestV1' &&
    typeof generation.generationId === 'string' &&
    path.basename(candidate) === `runtime-${generation.generationId}` &&
    generation.generationId === manifest.generationId &&
    generation.packageVersion === manifest.packageVersion &&
    generation.runtimeContractVersion === manifest.runtimeContractVersion &&
    generation.runtimeContractDigest === manifest.runtimeContractDigest &&
    generation.sourceDigest === manifest.sourceDigest &&
    generation.filesDigest === manifest.filesDigest &&
    manifest.runtimeRoot === '.' &&
    manifest.immutable === true
  return generationCurrent ? candidate : legacyRoot
}

module.exports = {
  isUnder,
  isUnderPhysical,
  readJson,
  realpathExistingPrefix,
  resolveGrokHome,
  resolveGrokRuntimeRoot
}
