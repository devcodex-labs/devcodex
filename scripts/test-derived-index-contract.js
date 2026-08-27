'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  buildQueryEnvelope,
  createDerivedIndexStore,
  DerivedIndexError,
  QUERY_ENVELOPE_SCHEMA
} = require('./lib/derived-index-contract.js')
const { buildContentIdentity } = require('../hooks/_runtime/content-identity.cjs')

function sourceIdentity(label) {
  return buildContentIdentity({
    sourceKey: `fixture://${label}`,
    content: label,
    contractVersion: '1'
  })
}

function treeDigest(root) {
  if (!fs.existsSync(root)) return null
  const hash = crypto.createHash('sha256')
  const files = []
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else files.push(absolute)
    }
  }
  visit(root)
  for (const file of files.sort()) {
    hash.update(path.relative(root, file).replaceAll('\\', '/'))
    hash.update(fs.readFileSync(file))
  }
  return hash.digest('hex')
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-derived-index-'))
const nowValues = [
  Date.parse('2026-07-23T00:00:00Z'),
  Date.parse('2026-07-23T00:00:01Z'),
  Date.parse('2026-07-23T00:00:02Z'),
  Date.parse('2026-07-23T00:00:03Z')
]

function derivedIndexLockFaultFs({ failures, code = 'EPERM' }) {
  let attempts = 0
  const proxy = new Proxy(fs, {
    get(target, property) {
      if (property === 'openSync') return (file, flags, ...rest) => {
        if (flags === 'wx' && path.basename(String(file)) === 'write.lock') {
          attempts += 1
          if (attempts <= failures) throw Object.assign(new Error(`injected derived-index ${code}`), { code })
        }
        return target.openSync(file, flags, ...rest)
      }
      return target[property]
    }
  })
  return { fs: proxy, attempts: () => attempts }
}

function derivedIndexLockRecordWriteFailureFs() {
  const descriptors = new Map()
  let lockPath = ''
  const proxy = new Proxy(fs, {
    get(target, property) {
      if (property === 'openSync') return (file, flags, ...rest) => {
        const descriptor = target.openSync(file, flags, ...rest)
        descriptors.set(descriptor, path.resolve(String(file)))
        return descriptor
      }
      if (property === 'writeFileSync') return (file, ...rest) => {
        const ownedPath = Number.isInteger(file) ? descriptors.get(file) : ''
        if (!lockPath && path.basename(ownedPath || '') === 'write.lock') {
          lockPath = ownedPath
          throw Object.assign(new Error('injected derived-index lock record write failure'), { code: 'EIO' })
        }
        return target.writeFileSync(file, ...rest)
      }
      if (property === 'closeSync') return descriptor => {
        descriptors.delete(descriptor)
        return target.closeSync(descriptor)
      }
      return target[property]
    }
  })
  return { fs: proxy, lockPath: () => lockPath }
}
const store = createDerivedIndexStore({
  activeRoot: tempRoot,
  domain: 'fixture',
  scopeIdentity: { project: 'alpha', agent: 'codex' },
  now: () => nowValues[0]
})
const firstSource = sourceIdentity('source-one')
const partitions = [
  { key: 'current', payload: { rows: [{ id: 'A' }] }, metadata: { count: 1 } },
  { key: '2026-07', payload: { rows: [{ id: 'B' }] }, metadata: { count: 1 } }
]

const first = store.commit({
  sourceIdentity: firstSource,
  freshnessTier: 'writer-attested',
  partitions
})
assert.equal(first.status, 'persisted')
assert.equal(first.generation, 1)
assert.equal(first.readbackVerified, true)
assert(fs.existsSync(store.pointerPath), 'pointer must be materialized last')

const current = store.readCurrent({ expectedSourceIdentity: firstSource })
assert.equal(current.status, 'fresh')
assert.equal(current.freshnessTier, 'content-verified')
assert.equal(current.manifest.partitions.length, 2)

const currentPartition = store.readPartition('current', {
  expectedSourceIdentity: firstSource,
  current
})
assert.equal(currentPartition.status, 'fresh')
assert.deepEqual(currentPartition.payload, { rows: [{ id: 'A' }] })
assert.equal(currentPartition.filesRead, 3)

const beforeRead = treeDigest(tempRoot)
const repeatedRead = store.readPartition('2026-07', { expectedSourceIdentity: firstSource })
const afterRead = treeDigest(tempRoot)
assert.equal(repeatedRead.status, 'fresh')
assert.equal(afterRead, beforeRead, 'query path must be zero-write')

const beforeReuse = treeDigest(tempRoot)
const reused = store.commit({
  sourceIdentity: firstSource,
  freshnessTier: 'writer-attested',
  partitions
})
assert.equal(reused.status, 'reused')
assert.equal(reused.generation, 1)
assert.equal(treeDigest(tempRoot), beforeReuse, 'idempotent commit must not rewrite current state')

const stale = store.readCurrent({ expectedSourceIdentity: sourceIdentity('other-source') })
assert.equal(stale.status, 'stale')
assert.equal(stale.freshnessTier, 'stale')

const secondSource = sourceIdentity('source-two')
const second = store.commit({
  sourceIdentity: secondSource,
  freshnessTier: 'writer-attested',
  partitions: [{ key: 'current', payload: { rows: [{ id: 'C' }] } }]
})
assert.equal(second.status, 'persisted', 'one store instance must support successive generations')
assert.equal(second.generation, 2)
const secondCurrent = store.readCurrent({ expectedSourceIdentity: secondSource })
assert.equal(secondCurrent.status, 'fresh')

const fallback = buildQueryEnvelope({
  status: 'fallback',
  freshnessTier: 'stale',
  coverage: { status: 'legacy-complete' },
  items: [{ id: 'A' }],
  evidencePointers: ['legacy://fixture'],
  telemetry: { sourceBytes: 20, deliveredBytes: 10, filesRead: 1, tokens: null },
  receipt: stale
})
assert.equal(fallback.schemaVersion, QUERY_ENVELOPE_SCHEMA)
assert.equal(fallback.status, 'fallback')
assert.equal(fallback.telemetry.tokens, null)

const crashStore = createDerivedIndexStore({
  activeRoot: tempRoot,
  domain: 'fixture',
  scopeIdentity: { project: 'alpha', agent: 'codex' },
  now: () => nowValues[1],
  faultInjector(stage) {
    if (stage === 'after-manifest') throw new Error('fixture crash')
  }
})
const crashed = crashStore.commit({
  sourceIdentity: sourceIdentity('source-three'),
  freshnessTier: 'writer-attested',
  partitions: [{ key: 'current', payload: { rows: [{ id: 'D' }] } }]
})
assert.equal(crashed.status, 'error')
assert.equal(crashed.stage, 'manifest')
const afterCrash = store.readCurrent({ expectedSourceIdentity: secondSource })
assert.equal(afterCrash.status, 'fresh', 'manifest-only failure must not advance pointer')
assert.equal(afterCrash.pointer.generation, 2)

fs.mkdirSync(path.dirname(store.lockPath), { recursive: true })
fs.writeFileSync(store.lockPath, '{}\n')
const lockedStore = createDerivedIndexStore({
  activeRoot: tempRoot,
  domain: 'fixture',
  scopeIdentity: { project: 'alpha', agent: 'codex' },
  lockWaitMs: 0,
  now: () => nowValues[2]
})
const locked = lockedStore.commit({
  sourceIdentity: sourceIdentity('source-four'),
  partitions: [{ key: 'current', payload: {} }]
})
assert.equal(locked.status, 'bypassed')
assert.equal(locked.errorCode, 'DERIVED_INDEX_LOCK_TIMEOUT')
fs.unlinkSync(store.lockPath)

const transientLockFault = derivedIndexLockFaultFs({ failures: 2 })
const transientStore = createDerivedIndexStore({
  activeRoot: tempRoot,
  domain: 'transient-lock',
  scopeIdentity: { project: 'alpha', agent: 'codex' },
  lockFs: transientLockFault.fs,
  platform: 'win32',
  windowsFsRetryMaxAttempts: 3,
  windowsFsRetryDelayMs: 0,
  now: () => nowValues[2]
})
const transientCommit = transientStore.commit({
  sourceIdentity: sourceIdentity('transient-lock-source'),
  partitions: [{ key: 'current', payload: { recovered: true } }]
})
assert.equal(transientCommit.status, 'persisted')
assert.equal(transientLockFault.attempts(), 3)
assert.strictEqual(fs.existsSync(transientStore.lockPath), false)

const nonSharingLockFault = derivedIndexLockFaultFs({ failures: 1, code: 'EIO' })
const nonSharingStore = createDerivedIndexStore({
  activeRoot: tempRoot,
  domain: 'nonsharing-lock',
  scopeIdentity: { project: 'alpha', agent: 'codex' },
  lockFs: nonSharingLockFault.fs,
  platform: 'win32',
  windowsFsRetryMaxAttempts: 3,
  windowsFsRetryDelayMs: 0,
  now: () => nowValues[2]
})
const nonSharingCommit = nonSharingStore.commit({
  sourceIdentity: sourceIdentity('nonsharing-lock-source'),
  partitions: [{ key: 'current', payload: {} }]
})
assert.equal(nonSharingCommit.status, 'error')
assert.equal(nonSharingCommit.errorCode, 'DERIVED_INDEX_LOCK_FAILED')
assert.equal(nonSharingLockFault.attempts(), 1)

const partialLockFault = derivedIndexLockRecordWriteFailureFs()
const partialLockStore = createDerivedIndexStore({
  activeRoot: tempRoot,
  domain: 'partial-lock-record',
  scopeIdentity: { project: 'alpha', agent: 'codex' },
  lockFs: partialLockFault.fs,
  now: () => nowValues[2]
})
const partialLockCommit = partialLockStore.commit({
  sourceIdentity: sourceIdentity('partial-lock-source'),
  partitions: [{ key: 'current', payload: {} }]
})
assert.equal(partialLockCommit.status, 'error')
assert.equal(partialLockCommit.errorCode, 'DERIVED_INDEX_LOCK_FAILED')
assert.ok(partialLockFault.lockPath())
assert.strictEqual(fs.existsSync(partialLockFault.lockPath()), false, 'failed derived-index lock record write must not strand the lock')

const pointerBytes = fs.readFileSync(store.pointerPath)
fs.writeFileSync(store.pointerPath, '{broken')
const invalid = store.readCurrent()
assert.equal(invalid.status, 'invalid')
fs.writeFileSync(store.pointerPath, pointerBytes)

const objectPath = path.join(
  tempRoot,
  '.runtime-state',
  'derived-indexes',
  'v1',
  'fixture',
  store.scopeDigest,
  'objects',
  first.objectIdentities[0].digest + '.json'
)
const objectBytes = fs.readFileSync(objectPath)
fs.writeFileSync(objectPath, '{}\n')
const collisionStore = createDerivedIndexStore({
  activeRoot: tempRoot,
  domain: 'fixture',
  scopeIdentity: { project: 'alpha', agent: 'codex' },
  now: () => nowValues[3]
})
const collision = collisionStore.commit({
  sourceIdentity: sourceIdentity('source-five'),
  partitions
})
assert.equal(collision.status, 'error')
assert.equal(collision.errorCode, 'DERIVED_INDEX_IMMUTABLE_COLLISION')
fs.writeFileSync(objectPath, objectBytes)

assert.throws(
  () => createDerivedIndexStore({
    activeRoot: tempRoot,
    domain: '../escape',
    scopeIdentity: { project: 'alpha' }
  }),
  error => error instanceof DerivedIndexError && error.code === 'DERIVED_INDEX_INVALID_DOMAIN'
)
assert.throws(
  () => store.commit({
    sourceIdentity: firstSource,
    partitions: [
      { key: 'same', payload: {} },
      { key: 'same', payload: {} }
    ]
  }),
  error => error instanceof DerivedIndexError && error.code === 'DERIVED_INDEX_DUPLICATE_PARTITION'
)
assert.throws(
  () => buildQueryEnvelope({ status: 'unknown', freshnessTier: 'invalid' }),
  error => error instanceof DerivedIndexError && error.code === 'DERIVED_INDEX_INVALID_QUERY_STATUS'
)

fs.rmSync(tempRoot, { recursive: true, force: true })
console.log('derived index contract tests passed: atomic/idempotent/lock/corrupt/crash/zero-write')
