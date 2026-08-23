'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { acquireRuntimeGenerationLease } = require('./runtime-generation-lease.cjs')

const PROCESS_IDENTITY_SCHEMA = 'RuntimeProcessIdentityV2'
const RUNTIME_GENERATION_SCHEMA = 'RuntimeGenerationManifestV1'
const RUNTIME_CONTRACT_VERSION = 2
const DIGEST_RE = /^[a-f0-9]{64}$/
const identityCache = new Map()

function stableValue (value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
}

function sha256 (value) {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(stableValue(value)))
  return crypto.createHash('sha256').update(body).digest('hex')
}

function defaultRuntimeRoot () {
  return path.resolve(__dirname, '..', '..')
}

function readJson (file, fsImpl = fs) {
  try {
    return JSON.parse(fsImpl.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function readRuntimeGenerationManifest (runtimeRoot = defaultRuntimeRoot(), fsImpl = fs) {
  const root = path.resolve(runtimeRoot)
  const manifestPath = path.join(root, 'runtime-generation.json')
  const manifest = readJson(manifestPath, fsImpl)
  if (manifest?.schemaVersion === RUNTIME_GENERATION_SCHEMA &&
      typeof manifest.generationId === 'string' && manifest.generationId.trim() &&
      Number.isInteger(manifest.runtimeContractVersion) &&
      DIGEST_RE.test(String(manifest.runtimeContractDigest || '')) &&
      DIGEST_RE.test(String(manifest.sourceDigest || '')) &&
      DIGEST_RE.test(String(manifest.filesDigest || '')) &&
      manifest.runtimeRoot === '.' && manifest.immutable === true) {
    return { status: 'resolved', manifestPath, manifest }
  }
  const packageJson = readJson(path.join(root, 'package.json'), fsImpl)
  return {
    status: 'source-fallback',
    manifestPath,
    manifest: {
      schemaVersion: RUNTIME_GENERATION_SCHEMA,
      generationId: `source-${packageJson?.version || 'unknown'}`,
      packageName: packageJson?.name || 'devcodex',
      packageVersion: packageJson?.version || 'unknown',
      runtimeContractVersion: RUNTIME_CONTRACT_VERSION,
      sourceDigest: null,
      immutable: false
    }
  }
}

function captureRuntimeProcessIdentity (options = {}) {
  const fsImpl = options.fs || fs
  const runtimeRoot = path.resolve(options.runtimeRoot || defaultRuntimeRoot())
  const role = String(options.role || process.env.DEVCODEX_RUNTIME_ROLE || 'runtime').trim()
  const cacheKey = `${role}|${runtimeRoot}`
  if (!options.noCache && identityCache.has(cacheKey)) return identityCache.get(cacheKey)
  const generation = readRuntimeGenerationManifest(runtimeRoot, fsImpl)
  const bootRuntimeContractDigest = String(options.bootRuntimeContractDigest || '')
  const generationRuntimeContractDigest = generation.manifest.runtimeContractDigest || null
  const material = {
    schemaVersion: PROCESS_IDENTITY_SCHEMA,
    role,
    processId: process.pid,
    nodeVersion: process.version,
    generationId: generation.manifest.generationId,
    packageVersion: generation.manifest.packageVersion,
    runtimeContractVersion: generation.manifest.runtimeContractVersion,
    bootRuntimeContractDigest,
    generationRuntimeContractDigest,
    runtimeContractAligned: generation.status !== 'resolved' ||
      generationRuntimeContractDigest === bootRuntimeContractDigest,
    generationSourceDigest: generation.manifest.sourceDigest || null,
    manifestStatus: generation.status
  }
  const identity = { ...material, identityDigest: sha256(material) }
  const persistentRole = /(?:^|-)mcp$/i.test(role)
  if (options.acquireLease === true || (options.acquireLease !== false && persistentRole)) {
    const lease = acquireRuntimeGenerationLease({
      fs: fsImpl,
      runtimeRoot,
      role,
      heartbeatIntervalMs: options.heartbeatIntervalMs,
      leaseTtlMs: options.leaseTtlMs,
      registerExit: options.registerLeaseExit
    })
    if (persistentRole && generation.status === 'resolved' && lease.status !== 'active') {
      const error = new Error(`RUNTIME_GENERATION_LEASE_REQUIRED: ${lease.reasonCode || lease.status}`)
      error.code = 'RUNTIME_GENERATION_LEASE_REQUIRED'
      error.lease = lease
      throw error
    }
  }
  if (!options.noCache) identityCache.set(cacheKey, identity)
  return identity
}

function validateRuntimeProcessIdentity (value) {
  const identity = value && typeof value === 'object' && !Array.isArray(value) ? value : null
  if (!identity || identity.schemaVersion !== PROCESS_IDENTITY_SCHEMA) {
    return { valid: false, reasonCode: 'process-identity-missing' }
  }
  const { identityDigest, ...material } = identity
  if (!DIGEST_RE.test(String(identityDigest || '')) || sha256(material) !== identityDigest) {
    return { valid: false, reasonCode: 'process-identity-digest-mismatch' }
  }
  if (!identity.generationId || !identity.packageVersion ||
      !Number.isInteger(identity.runtimeContractVersion) ||
      !DIGEST_RE.test(String(identity.bootRuntimeContractDigest || '')) ||
      (identity.generationRuntimeContractDigest !== null &&
        !DIGEST_RE.test(String(identity.generationRuntimeContractDigest || ''))) ||
      identity.runtimeContractAligned !== true) {
    return { valid: false, reasonCode: 'process-identity-incomplete' }
  }
  return { valid: true, reasonCode: 'process-identity-valid', identity }
}

function compareRuntimeProcessIdentity (producer, consumer) {
  const producerValidation = validateRuntimeProcessIdentity(producer)
  const consumerValidation = validateRuntimeProcessIdentity(consumer)
  if (!producerValidation.valid || !consumerValidation.valid) {
    return {
      compatible: false,
      current: false,
      status: 'refresh-required',
      reasonCode: !producerValidation.valid
        ? `producer-${producerValidation.reasonCode}`
        : `consumer-${consumerValidation.reasonCode}`,
      producerValidation,
      consumerValidation
    }
  }
  const left = producerValidation.identity
  const right = consumerValidation.identity
  const sameGeneration = left.generationId === right.generationId &&
    left.runtimeContractVersion === right.runtimeContractVersion &&
    left.bootRuntimeContractDigest === right.bootRuntimeContractDigest
  if (sameGeneration) {
    return {
      compatible: true,
      current: true,
      status: 'current-generation',
      reasonCode: 'runtime-generation-current',
      producerValidation,
      consumerValidation
    }
  }
  const versionDelta = right.runtimeContractVersion - left.runtimeContractVersion
  if (versionDelta < 0 || versionDelta > 1) {
    return {
      compatible: false,
      current: false,
      status: 'refresh-required',
      reasonCode: 'runtime-contract-outside-n-1-window',
      versionDelta,
      producerValidation,
      consumerValidation
    }
  }
  return {
    compatible: true,
    current: false,
    status: 'generation-superseded',
    reasonCode: versionDelta === 1
      ? 'runtime-generation-n-1-superseded'
      : 'runtime-generation-replaced',
    versionDelta,
    producerValidation,
    consumerValidation
  }
}

module.exports = {
  PROCESS_IDENTITY_SCHEMA,
  RUNTIME_CONTRACT_VERSION,
  RUNTIME_GENERATION_SCHEMA,
  compareRuntimeProcessIdentity,
  captureRuntimeProcessIdentity,
  defaultRuntimeRoot,
  readRuntimeGenerationManifest,
  validateRuntimeProcessIdentity
}
