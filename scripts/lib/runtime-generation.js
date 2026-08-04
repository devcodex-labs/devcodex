'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { collectRuntimeScriptDeps } = require('./runtime-dependency-closure.js')
const { resolveControlAsset } = require('./control-content-delivery.js')
const { getRuntimeContractDigest } = require('../../hooks/_runtime/skill-route-mode.cjs')

const RUNTIME_GENERATION_SCHEMA = 'RuntimeGenerationManifestV1'
const RUNTIME_CONTRACT_VERSION = 2
const SOURCE_ROOTS = Object.freeze([
  'content/instructions',
  'host-projections',
  'hooks/_runtime',
  'mcp'
])

function portable (value) {
  return String(value || '').replace(/\\/g, '/')
}

function hash (value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function walkFiles (root, fsImpl = fs) {
  if (!fsImpl.existsSync(root)) return []
  const output = []
  const visit = current => {
    for (const entry of fsImpl.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name)
      if (entry.isDirectory()) visit(target)
      else if (entry.isFile()) output.push(target)
    }
  }
  visit(root)
  return output.sort((left, right) => portable(left).localeCompare(portable(right)))
}

function safeVersion (value) {
  return String(value || 'unknown').replace(/[^A-Za-z0-9._-]/g, '-')
}

function releaseCreatedAt (root, version, fsImpl = fs) {
  const file = path.join(root, 'changelogs', 'releases', `v${version}.md`)
  if (!fsImpl.existsSync(file)) return null
  const match = String(fsImpl.readFileSync(file, 'utf8')).match(/发布日期[:：]\s*(\d{4}-\d{2}-\d{2})/)
  return match ? `${match[1]}T00:00:00.000Z` : null
}

function buildRuntimeGeneration (packageRoot, fsImpl = fs) {
  const root = path.resolve(packageRoot)
  const packageJson = JSON.parse(fsImpl.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const instructionRoot = resolveControlAsset(root, 'instructions', fsImpl)
  const skillRoot = resolveControlAsset(root, 'skills', fsImpl)
  const instructionEntry = resolveControlAsset(root, 'instructions.md', fsImpl)
  const closureFiles = collectRuntimeScriptDeps(root, { fs: fsImpl })
    .map(relative => path.join(root, ...relative.split('/')))
  const files = [...new Set([
    ...SOURCE_ROOTS.flatMap(relative => walkFiles(path.join(root, relative), fsImpl)),
    ...walkFiles(instructionRoot, fsImpl),
    ...walkFiles(skillRoot, fsImpl),
    ...(fsImpl.existsSync(instructionEntry) ? [instructionEntry] : []),
    ...closureFiles
  ])].sort((left, right) => portable(left).localeCompare(portable(right)))
  const sourceEntries = files.map(file => ({
    path: portable(path.relative(root, file)),
    digest: hash(fsImpl.readFileSync(file))
  }))
  const filesDigest = hash(JSON.stringify(sourceEntries))
  const runtimeContractDigest = getRuntimeContractDigest({
    fs: fsImpl,
    packageRoot: root,
    runtimeRoot: path.join(root, 'hooks', '_runtime'),
    mcpAdapterPath: path.join(root, 'mcp', 'profile-server.js'),
    memoryAdapterPath: path.join(root, 'mcp', 'memory-server.js'),
    globalRuntime: {
      status: 'resolved',
      root: skillRoot,
      companionRoot: skillRoot
    }
  })
  const createdAt = releaseCreatedAt(root, packageJson.version, fsImpl)
  const sourceDigest = hash(JSON.stringify({
    packageName: packageJson.name || 'devcodex',
    packageVersion: packageJson.version || 'unknown',
    runtimeContractVersion: RUNTIME_CONTRACT_VERSION,
    runtimeContractDigest,
    filesDigest,
    createdAt
  }))
  const generationId = `${safeVersion(packageJson.version)}-${sourceDigest.slice(0, 16)}`
  return {
    schemaVersion: RUNTIME_GENERATION_SCHEMA,
    generationId,
    packageName: packageJson.name || 'devcodex',
    packageVersion: packageJson.version || 'unknown',
    runtimeContractVersion: RUNTIME_CONTRACT_VERSION,
    runtimeContractDigest,
    sourceDigest,
    filesDigest,
    fileCount: sourceEntries.length,
    createdAt,
    creationTimeAuthority: createdAt ? 'release-changelog' : 'unreleased',
    runtimeRoot: '.',
    immutable: true
  }
}

function runtimeGenerationDirectoryName (generation) {
  const id = String(generation?.generationId || generation || '').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(id)) {
    const error = new Error(`RUNTIME_GENERATION_INVALID: ${id || '(empty)'}`)
    error.code = 'RUNTIME_GENERATION_INVALID'
    throw error
  }
  return `runtime-${id}`
}

module.exports = {
  RUNTIME_CONTRACT_VERSION,
  RUNTIME_GENERATION_SCHEMA,
  SOURCE_ROOTS,
  buildRuntimeGeneration,
  runtimeGenerationDirectoryName
}
