'use strict'

const fs = require('fs')
const path = require('path')
const {
  buildJsonContentIdentity,
  stableStringify,
  validateContentIdentity
} = require('../../hooks/_runtime/content-identity.cjs')
const {
  createDerivedStateStore,
  resolveInside,
  sameIdentity
} = require('../../hooks/_runtime/derived-state-store.cjs')

const DERIVED_INDEX_ROOT = '.runtime-state/derived-indexes/v1'
const POINTER_SCHEMA = 'DerivedIndexPointerV1'
const MANIFEST_SCHEMA = 'DerivedIndexManifestV1'
const PARTITION_SCHEMA = 'DerivedIndexPartitionV1'
const COMMIT_RECEIPT_SCHEMA = 'DerivedIndexCommitReceiptV1'
const QUERY_ENVELOPE_SCHEMA = 'DerivedIndexQueryEnvelopeV1'
const CONTRACT_VERSION = '1'
const FRESHNESS_TIERS = new Set([
  'content-verified',
  'writer-attested',
  'metadata-reconciled',
  'stale',
  'invalid'
])
const QUERY_STATUSES = new Set(['fresh', 'partial', 'fallback', 'invalid'])

class DerivedIndexError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'DerivedIndexError'
    this.code = code
  }
}

function waitSync(milliseconds) {
  if (milliseconds <= 0) return
  const signal = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(signal, 0, 0, milliseconds)
}

function validateDomain(domain) {
  const value = String(domain || '').trim()
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(value)) {
    throw new DerivedIndexError('DERIVED_INDEX_INVALID_DOMAIN', 'domain must be lowercase kebab-case')
  }
  return value
}

function validateScopeIdentity(scopeIdentity) {
  if (!scopeIdentity || typeof scopeIdentity !== 'object' || Array.isArray(scopeIdentity)) {
    throw new DerivedIndexError('DERIVED_INDEX_INVALID_SCOPE', 'scopeIdentity must be an object')
  }
  const keys = Object.keys(scopeIdentity)
  if (!keys.length || keys.some(key => !String(key).trim())) {
    throw new DerivedIndexError('DERIVED_INDEX_INVALID_SCOPE', 'scopeIdentity must contain named fields')
  }
  return JSON.parse(stableStringify(scopeIdentity))
}

function logicalIdentity(sourceKey, document) {
  return buildJsonContentIdentity({
    sourceKey,
    value: document,
    contractVersion: CONTRACT_VERSION
  }).identity
}

function scopeDigestFor(scopeIdentity) {
  return logicalIdentity('derived-index://scope', scopeIdentity).digest
}

function withoutField(value, field) {
  return Object.fromEntries(Object.entries(value || {}).filter(([key]) => key !== field))
}

function verifyStoredDocument(value, identityField, expectedIdentity = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, errorCode: 'DERIVED_INDEX_INVALID_DOCUMENT' }
  }
  const identity = value[identityField]
  const validation = validateContentIdentity(identity)
  if (!validation.valid) {
    return {
      valid: false,
      errorCode: 'DERIVED_INDEX_INVALID_IDENTITY',
      errors: validation.errors
    }
  }
  const observed = logicalIdentity(identity.sourceKey, withoutField(value, identityField))
  if (!sameIdentity(identity, observed)) {
    return { valid: false, errorCode: 'DERIVED_INDEX_DIGEST_MISMATCH', observedIdentity: observed }
  }
  if (expectedIdentity && !sameIdentity(identity, expectedIdentity)) {
    return { valid: false, errorCode: 'DERIVED_INDEX_IDENTITY_MISMATCH', observedIdentity: identity }
  }
  return { valid: true, identity, document: withoutField(value, identityField) }
}

function createStoredDocument(document, identityField, sourceKey) {
  const identity = logicalIdentity(sourceKey, document)
  return { stored: { ...document, [identityField]: identity }, identity }
}

function normalizePartitions(partitions) {
  if (!Array.isArray(partitions) || !partitions.length) {
    throw new DerivedIndexError('DERIVED_INDEX_PARTITIONS_REQUIRED', 'partitions must be a non-empty array')
  }
  const seen = new Set()
  return partitions.map(partition => {
    const key = String(partition?.key || '').trim()
    if (!key || key.length > 256) {
      throw new DerivedIndexError('DERIVED_INDEX_INVALID_PARTITION_KEY', 'partition key must contain 1-256 characters')
    }
    if (seen.has(key)) {
      throw new DerivedIndexError('DERIVED_INDEX_DUPLICATE_PARTITION', `duplicate partition key: ${key}`)
    }
    seen.add(key)
    if (!Object.prototype.hasOwnProperty.call(partition || {}, 'payload')) {
      throw new DerivedIndexError('DERIVED_INDEX_PARTITION_PAYLOAD_REQUIRED', `partition ${key} has no payload`)
    }
    const metadata = partition.metadata === undefined ? {} : partition.metadata
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new DerivedIndexError('DERIVED_INDEX_INVALID_METADATA', `partition ${key} metadata must be an object`)
    }
    return { key, payload: partition.payload, metadata: JSON.parse(stableStringify(metadata)) }
  }).sort((left, right) => left.key.localeCompare(right.key))
}

function buildQueryEnvelope(input = {}) {
  const status = String(input.status || 'invalid')
  const freshnessTier = String(input.freshnessTier || 'invalid')
  if (!QUERY_STATUSES.has(status)) {
    throw new DerivedIndexError('DERIVED_INDEX_INVALID_QUERY_STATUS', `unsupported query status: ${status}`)
  }
  if (!FRESHNESS_TIERS.has(freshnessTier)) {
    throw new DerivedIndexError('DERIVED_INDEX_INVALID_FRESHNESS', `unsupported freshness tier: ${freshnessTier}`)
  }
  return {
    schemaVersion: QUERY_ENVELOPE_SCHEMA,
    status,
    freshnessTier,
    coverage: input.coverage || { status: 'unknown' },
    items: Array.isArray(input.items) ? input.items : [],
    truncated: input.truncated === true,
    nextPointer: input.nextPointer || null,
    evidencePointers: Array.isArray(input.evidencePointers) ? input.evidencePointers : [],
    hydrated: input.hydrated === true,
    telemetry: input.telemetry || {
      sourceBytes: null,
      deliveredBytes: null,
      filesRead: null,
      tokens: null
    },
    receipt: input.receipt || null
  }
}

function createDerivedIndexStore(options = {}) {
  const activeRoot = path.resolve(String(options.activeRoot || ''))
  if (!String(options.activeRoot || '').trim()) {
    throw new DerivedIndexError('DERIVED_INDEX_ACTIVE_ROOT_REQUIRED', 'activeRoot is required')
  }
  const domain = validateDomain(options.domain)
  const scopeIdentity = validateScopeIdentity(options.scopeIdentity)
  const scopeDigest = scopeDigestFor(scopeIdentity)
  const maxPartitionBytes = options.maxPartitionBytes || 32 * 1024 * 1024
  const lockWaitMs = options.lockWaitMs === undefined ? 2000 : options.lockWaitMs
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const faultInjector = typeof options.faultInjector === 'function' ? options.faultInjector : null

  if (!Number.isInteger(maxPartitionBytes) || maxPartitionBytes <= 0) {
    throw new DerivedIndexError('DERIVED_INDEX_INVALID_BUDGET', 'maxPartitionBytes must be a positive integer')
  }
  if (!Number.isInteger(lockWaitMs) || lockWaitMs < 0 || lockWaitMs > 2000) {
    throw new DerivedIndexError('DERIVED_INDEX_INVALID_LOCK_WAIT', 'lockWaitMs must be an integer from 0 to 2000')
  }

  const root = resolveInside(activeRoot, DERIVED_INDEX_ROOT)
  const domainRoot = `${domain}/${scopeDigest}`
  const pointerRelativePath = `${domainRoot}/current.json`
  const lockPath = resolveInside(root, `${domainRoot}/write.lock`)
  const pointerPath = resolveInside(root, pointerRelativePath)

  function createPointerStore(maxWrites) {
    return createDerivedStateStore({
      root,
      relativePath: pointerRelativePath,
      maxBytes: 1024 * 1024,
      lockWaitMs,
      maxWrites,
      identityField: 'pointerIdentity',
      now
    })
  }

  function sourceKey(kind, suffix = '') {
    return `derived-index://${domain}/${scopeDigest}/${kind}${suffix ? `/${suffix}` : ''}`
  }

  function readDocument(relativePath, identityField, expectedIdentity, maxBytes) {
    const store = createDerivedStateStore({
      root,
      relativePath,
      maxBytes,
      lockWaitMs,
      maxWrites: 0,
      identityField,
      now
    })
    const receipt = store.read()
    if (receipt.status !== 'fresh') return receipt
    const verification = verifyStoredDocument(receipt.value, identityField, expectedIdentity)
    if (!verification.valid) {
      return {
        schemaVersion: 'DerivedIndexReadReceiptV1',
        status: 'invalid',
        filePath: store.filePath,
        bytes: receipt.bytes,
        ...verification
      }
    }
    return {
      schemaVersion: 'DerivedIndexReadReceiptV1',
      status: 'fresh',
      filePath: store.filePath,
      bytes: receipt.bytes,
      value: verification.document,
      identity: verification.identity
    }
  }

  function writeImmutable(relativePath, stored, identityField, identity, maxBytes) {
    const existing = readDocument(relativePath, identityField, identity, maxBytes)
    if (existing.status === 'fresh') {
      return { status: 'reused', filePath: existing.filePath, bytes: existing.bytes, identity }
    }
    if (existing.status !== 'missing') {
      return {
        status: 'error',
        errorCode: 'DERIVED_INDEX_IMMUTABLE_COLLISION',
        filePath: existing.filePath,
        observedStatus: existing.status
      }
    }
    const store = createDerivedStateStore({
      root,
      relativePath,
      maxBytes,
      lockWaitMs,
      maxWrites: 1,
      identityField,
      now
    })
    const written = store.write(stored)
    if (written.status !== 'persisted') return written
    const readback = readDocument(relativePath, identityField, identity, maxBytes)
    if (readback.status !== 'fresh') {
      return {
        status: 'error',
        errorCode: 'DERIVED_INDEX_READBACK_FAILED',
        filePath: store.filePath,
        readback
      }
    }
    return { status: 'persisted', filePath: store.filePath, bytes: written.bytes, identity }
  }

  function readManifest(identity) {
    if (!validateContentIdentity(identity).valid) {
      return { schemaVersion: 'DerivedIndexReadReceiptV1', status: 'invalid', errorCode: 'DERIVED_INDEX_INVALID_MANIFEST_IDENTITY' }
    }
    return readDocument(
      `${domainRoot}/manifests/${identity.digest}.json`,
      'contentIdentity',
      identity,
      8 * 1024 * 1024
    )
  }

  function validatePointer(pointer) {
    if (pointer.schemaVersion !== POINTER_SCHEMA ||
        pointer.contractVersion !== CONTRACT_VERSION ||
        pointer.domain !== domain ||
        pointer.scopeDigest !== scopeDigest ||
        stableStringify(pointer.scopeIdentity) !== stableStringify(scopeIdentity) ||
        !Number.isInteger(pointer.generation) ||
        pointer.generation <= 0 ||
        !validateContentIdentity(pointer.sourceIdentity).valid ||
        !validateContentIdentity(pointer.manifestIdentity).valid ||
        !FRESHNESS_TIERS.has(pointer.freshnessTier) ||
        ['stale', 'invalid'].includes(pointer.freshnessTier)) {
      return false
    }
    return true
  }

  function readCurrent({ expectedSourceIdentity = null } = {}) {
    const pointerStore = createPointerStore(0)
    const pointerReceipt = pointerStore.read()
    if (pointerReceipt.status !== 'fresh') {
      return {
        schemaVersion: 'DerivedIndexReadReceiptV1',
        status: pointerReceipt.status,
        freshnessTier: pointerReceipt.status === 'invalid' ? 'invalid' : 'stale',
        filesRead: pointerReceipt.status === 'missing' ? 0 : 1,
        bytesRead: pointerReceipt.bytes || 0,
        pointerReceipt
      }
    }
    const verification = verifyStoredDocument(pointerReceipt.value, 'pointerIdentity')
    if (!verification.valid || !validatePointer(verification.document)) {
      return {
        schemaVersion: 'DerivedIndexReadReceiptV1',
        status: 'invalid',
        freshnessTier: 'invalid',
        filesRead: 1,
        bytesRead: pointerReceipt.bytes || 0,
        pointerReceipt,
        verification
      }
    }
    const pointer = verification.document
    if (expectedSourceIdentity && !sameIdentity(pointer.sourceIdentity, expectedSourceIdentity)) {
      return {
        schemaVersion: 'DerivedIndexReadReceiptV1',
        status: 'stale',
        freshnessTier: 'stale',
        filesRead: 1,
        bytesRead: pointerReceipt.bytes || 0,
        pointer,
        pointerIdentity: verification.identity
      }
    }
    const manifestReceipt = readManifest(pointer.manifestIdentity)
    if (manifestReceipt.status !== 'fresh') {
      return {
        schemaVersion: 'DerivedIndexReadReceiptV1',
        status: 'invalid',
        freshnessTier: 'invalid',
        filesRead: 2,
        bytesRead: (pointerReceipt.bytes || 0) + (manifestReceipt.bytes || 0),
        pointer,
        pointerIdentity: verification.identity,
        manifestReceipt
      }
    }
    const manifest = manifestReceipt.value
    const validManifest = manifest.schemaVersion === MANIFEST_SCHEMA &&
      manifest.contractVersion === CONTRACT_VERSION &&
      manifest.domain === domain &&
      manifest.scopeDigest === scopeDigest &&
      manifest.generation === pointer.generation &&
      sameIdentity(manifest.sourceIdentity, pointer.sourceIdentity) &&
      Array.isArray(manifest.partitions)
    if (!validManifest) {
      return {
        schemaVersion: 'DerivedIndexReadReceiptV1',
        status: 'invalid',
        freshnessTier: 'invalid',
        errorCode: 'DERIVED_INDEX_POINTER_MANIFEST_MISMATCH',
        filesRead: 2,
        bytesRead: (pointerReceipt.bytes || 0) + (manifestReceipt.bytes || 0)
      }
    }
    return {
      schemaVersion: 'DerivedIndexReadReceiptV1',
      status: 'fresh',
      freshnessTier: expectedSourceIdentity ? 'content-verified' : pointer.freshnessTier,
      attestedFreshnessTier: pointer.freshnessTier,
      filesRead: 2,
      bytesRead: (pointerReceipt.bytes || 0) + (manifestReceipt.bytes || 0),
      pointer,
      pointerIdentity: verification.identity,
      manifest,
      manifestIdentity: manifestReceipt.identity
    }
  }

  function readPartition(key, { expectedSourceIdentity = null, current = null } = {}) {
    const currentReceipt = current || readCurrent({ expectedSourceIdentity })
    if (currentReceipt.status !== 'fresh') return currentReceipt
    const descriptor = currentReceipt.manifest.partitions.find(item => item.key === key)
    if (!descriptor) {
      return {
        schemaVersion: 'DerivedIndexReadReceiptV1',
        status: 'missing',
        freshnessTier: currentReceipt.freshnessTier,
        filesRead: currentReceipt.filesRead,
        bytesRead: currentReceipt.bytesRead
      }
    }
    const objectReceipt = readDocument(
      `${domainRoot}/objects/${descriptor.objectIdentity.digest}.json`,
      'contentIdentity',
      descriptor.objectIdentity,
      maxPartitionBytes + 4096
    )
    if (objectReceipt.status !== 'fresh' ||
        objectReceipt.value.schemaVersion !== PARTITION_SCHEMA ||
        objectReceipt.value.domain !== domain ||
        objectReceipt.value.scopeDigest !== scopeDigest ||
        objectReceipt.value.key !== key) {
      return {
        schemaVersion: 'DerivedIndexReadReceiptV1',
        status: 'invalid',
        freshnessTier: 'invalid',
        errorCode: 'DERIVED_INDEX_PARTITION_INVALID',
        filesRead: currentReceipt.filesRead + 1,
        bytesRead: currentReceipt.bytesRead + (objectReceipt.bytes || 0),
        objectReceipt
      }
    }
    return {
      schemaVersion: 'DerivedIndexReadReceiptV1',
      status: 'fresh',
      freshnessTier: currentReceipt.freshnessTier,
      filesRead: currentReceipt.filesRead + 1,
      bytesRead: currentReceipt.bytesRead + (objectReceipt.bytes || 0),
      key,
      metadata: descriptor.metadata || {},
      payload: objectReceipt.value.payload,
      objectIdentity: objectReceipt.identity,
      pointerIdentity: currentReceipt.pointerIdentity,
      manifestIdentity: currentReceipt.manifestIdentity
    }
  }

  function acquireDomainLock() {
    const startedAt = now()
    while (true) {
      try {
        fs.mkdirSync(path.dirname(lockPath), { recursive: true })
        const descriptor = fs.openSync(lockPath, 'wx')
        fs.writeFileSync(descriptor, JSON.stringify({
          pid: process.pid,
          domain,
          scopeDigest,
          acquiredAt: new Date(now()).toISOString()
        }) + '\n', 'utf8')
        return { descriptor, waitedMs: Math.max(0, now() - startedAt) }
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
        const elapsed = now() - startedAt
        if (elapsed >= lockWaitMs) return null
        waitSync(Math.min(25, lockWaitMs - elapsed))
      }
    }
  }

  function maybeFault(stage) {
    if (faultInjector) faultInjector(stage)
  }

  function commit(input = {}) {
    const sourceValidation = validateContentIdentity(input.sourceIdentity)
    if (!sourceValidation.valid) {
      throw new DerivedIndexError('DERIVED_INDEX_INVALID_SOURCE_IDENTITY', sourceValidation.errors.join('; '))
    }
    const freshnessTier = String(input.freshnessTier || 'writer-attested')
    if (!FRESHNESS_TIERS.has(freshnessTier) || ['stale', 'invalid'].includes(freshnessTier)) {
      throw new DerivedIndexError('DERIVED_INDEX_INVALID_FRESHNESS', 'commit freshnessTier must be usable by readers')
    }
    const partitions = normalizePartitions(input.partitions)
    let lock
    try {
      lock = acquireDomainLock()
    } catch (error) {
      return {
        schemaVersion: COMMIT_RECEIPT_SCHEMA,
        status: 'error',
        domain,
        scopeDigest,
        errorCode: 'DERIVED_INDEX_LOCK_FAILED',
        message: error.message
      }
    }
    if (!lock) {
      return {
        schemaVersion: COMMIT_RECEIPT_SCHEMA,
        status: 'bypassed',
        domain,
        scopeDigest,
        errorCode: 'DERIVED_INDEX_LOCK_TIMEOUT',
        lockWaitMs
      }
    }

    let stage = 'prepare'
    try {
      const partitionDocuments = partitions.map(partition => {
        const document = {
          schemaVersion: PARTITION_SCHEMA,
          contractVersion: CONTRACT_VERSION,
          domain,
          scopeDigest,
          key: partition.key,
          payload: partition.payload
        }
        const materialized = createStoredDocument(
          document,
          'contentIdentity',
          sourceKey('partition', encodeURIComponent(partition.key))
        )
        const bytes = Buffer.byteLength(stableStringify(document))
        if (bytes > maxPartitionBytes) {
          throw new DerivedIndexError(
            'DERIVED_INDEX_PARTITION_CAPACITY_EXCEEDED',
            `partition ${partition.key} has ${bytes} bytes; max ${maxPartitionBytes}`
          )
        }
        return { ...partition, ...materialized, bytes }
      })

      const current = readCurrent()
      if (current.status === 'fresh' &&
          sameIdentity(current.pointer.sourceIdentity, input.sourceIdentity) &&
          current.pointer.freshnessTier === freshnessTier &&
          current.manifest.partitions.length === partitionDocuments.length &&
          partitionDocuments.every((item, index) =>
            current.manifest.partitions[index]?.key === item.key &&
            sameIdentity(current.manifest.partitions[index]?.objectIdentity, item.identity) &&
            stableStringify(current.manifest.partitions[index]?.metadata || {}) === stableStringify(item.metadata))) {
        return {
          schemaVersion: COMMIT_RECEIPT_SCHEMA,
          status: 'reused',
          domain,
          scopeDigest,
          generation: current.pointer.generation,
          sourceIdentity: input.sourceIdentity,
          pointerIdentity: current.pointerIdentity,
          manifestIdentity: current.manifestIdentity,
          objectIdentities: current.manifest.partitions.map(item => item.objectIdentity),
          readbackVerified: true,
          waitedMs: lock.waitedMs
        }
      }

      stage = 'objects'
      const objectWrites = []
      for (const partition of partitionDocuments) {
        const write = writeImmutable(
          `${domainRoot}/objects/${partition.identity.digest}.json`,
          partition.stored,
          'contentIdentity',
          partition.identity,
          maxPartitionBytes + 4096
        )
        objectWrites.push(write)
        if (!['persisted', 'reused'].includes(write.status)) {
          throw new DerivedIndexError(
            write.errorCode || 'DERIVED_INDEX_OBJECT_WRITE_FAILED',
            `failed to materialize partition ${partition.key}`
          )
        }
      }
      maybeFault('after-objects')

      stage = 'manifest'
      const generation = current.status === 'fresh' ? current.pointer.generation + 1 : 1
      const manifestDocument = {
        schemaVersion: MANIFEST_SCHEMA,
        contractVersion: CONTRACT_VERSION,
        domain,
        scopeIdentity,
        scopeDigest,
        generation,
        sourceIdentity: input.sourceIdentity,
        freshnessTier,
        partitions: partitionDocuments.map(partition => ({
          key: partition.key,
          objectIdentity: partition.identity,
          metadata: partition.metadata
        })),
        previousManifestIdentity: current.status === 'fresh' ? current.manifestIdentity : null,
        createdAt: new Date(now()).toISOString()
      }
      const manifestMaterialized = createStoredDocument(
        manifestDocument,
        'contentIdentity',
        sourceKey('manifest')
      )
      const manifestWrite = writeImmutable(
        `${domainRoot}/manifests/${manifestMaterialized.identity.digest}.json`,
        manifestMaterialized.stored,
        'contentIdentity',
        manifestMaterialized.identity,
        8 * 1024 * 1024
      )
      if (!['persisted', 'reused'].includes(manifestWrite.status)) {
        throw new DerivedIndexError(
          manifestWrite.errorCode || 'DERIVED_INDEX_MANIFEST_WRITE_FAILED',
          'failed to materialize manifest'
        )
      }
      maybeFault('after-manifest')

      stage = 'pointer'
      const pointerDocument = {
        schemaVersion: POINTER_SCHEMA,
        contractVersion: CONTRACT_VERSION,
        domain,
        scopeIdentity,
        scopeDigest,
        generation,
        sourceIdentity: input.sourceIdentity,
        freshnessTier,
        manifestIdentity: manifestMaterialized.identity,
        committedAt: new Date(now()).toISOString()
      }
      const pointerMaterialized = createStoredDocument(
        pointerDocument,
        'pointerIdentity',
        sourceKey('pointer')
      )
      const pointerStore = createPointerStore(1)
      const pointerWrite = pointerStore.write(pointerMaterialized.stored)
      if (pointerWrite.status !== 'persisted') {
        throw new DerivedIndexError(
          pointerWrite.errorCode || 'DERIVED_INDEX_POINTER_WRITE_FAILED',
          'failed to advance current pointer'
        )
      }
      stage = 'pointer-advanced'
      maybeFault('after-pointer')

      stage = 'readback'
      const readback = readCurrent({ expectedSourceIdentity: input.sourceIdentity })
      if (readback.status !== 'fresh' ||
          !sameIdentity(readback.manifestIdentity, manifestMaterialized.identity) ||
          readback.pointer.generation !== generation) {
        throw new DerivedIndexError('DERIVED_INDEX_READBACK_FAILED', 'committed pointer did not pass readback')
      }
      return {
        schemaVersion: COMMIT_RECEIPT_SCHEMA,
        status: 'persisted',
        domain,
        scopeDigest,
        generation,
        sourceIdentity: input.sourceIdentity,
        pointerIdentity: readback.pointerIdentity,
        manifestIdentity: readback.manifestIdentity,
        objectIdentities: partitionDocuments.map(item => item.identity),
        objectWrites: objectWrites.map(item => item.status),
        manifestWrite: manifestWrite.status,
        pointerWrite: pointerWrite.status,
        readbackVerified: true,
        waitedMs: lock.waitedMs
      }
    } catch (error) {
      return {
        schemaVersion: COMMIT_RECEIPT_SCHEMA,
        status: 'error',
        domain,
        scopeDigest,
        stage,
        errorCode: error.code || 'DERIVED_INDEX_COMMIT_FAILED',
        message: error.message,
        pointerAdvanced: ['pointer-advanced', 'readback'].includes(stage)
      }
    } finally {
      try { fs.closeSync(lock.descriptor) } catch { }
      try { fs.unlinkSync(lockPath) } catch { }
    }
  }

  return Object.freeze({
    activeRoot,
    root,
    domain,
    scopeIdentity,
    scopeDigest,
    lockPath,
    pointerPath,
    commit,
    readCurrent,
    readManifest,
    readPartition
  })
}

module.exports = {
  COMMIT_RECEIPT_SCHEMA,
  CONTRACT_VERSION,
  DERIVED_INDEX_ROOT,
  DerivedIndexError,
  FRESHNESS_TIERS,
  MANIFEST_SCHEMA,
  PARTITION_SCHEMA,
  POINTER_SCHEMA,
  QUERY_ENVELOPE_SCHEMA,
  buildQueryEnvelope,
  createDerivedIndexStore,
  scopeDigestFor,
  validateDomain,
  validateScopeIdentity,
  verifyStoredDocument
}
