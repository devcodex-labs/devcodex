#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  ContentIdentityError,
  buildContentIdentity,
  buildJsonContentIdentity,
  matchesContentIdentity,
  stableStringify,
  validateContentIdentity
} = require('../hooks/_runtime/content-identity.cjs')
const {
  DerivedStateStoreError,
  createDerivedStateStore,
  resolveInside
} = require('../hooks/_runtime/derived-state-store.cjs')

const root = fs.mkdtempSync(path.join(os.tmpdir(), `devcodex-content-identity-${process.pid}-`))

try {
  assert.strictEqual(stableStringify({ z: 1, a: { d: 2, c: 1 } }), '{"a":{"c":1,"d":2},"z":1}')
  assert.strictEqual(stableStringify({ a: 1, z: 2 }), stableStringify({ z: 2, a: 1 }))
  assert.throws(() => stableStringify({ bad: Number.NaN }), error => error instanceof ContentIdentityError && error.code === 'CONTENT_NON_FINITE_NUMBER')
  const cycle = {}
  cycle.self = cycle
  assert.throws(() => stableStringify(cycle), error => error instanceof ContentIdentityError && error.code === 'CONTENT_CYCLE')

  const bytesIdentity = buildContentIdentity({ sourceKey: 'fixture\\source', content: 'alpha' })
  assert.strictEqual(bytesIdentity.sourceKey, 'fixture/source')
  assert.strictEqual(validateContentIdentity(bytesIdentity).valid, true)
  assert.strictEqual(matchesContentIdentity(bytesIdentity, 'alpha'), true)
  assert.strictEqual(matchesContentIdentity(bytesIdentity, 'beta'), false)

  const jsonIdentity = buildJsonContentIdentity({ sourceKey: 'fixture/json', value: { two: 2, one: 1 } }).identity
  const store = createDerivedStateStore({ root, relativePath: '.runtime-state/state.json', maxBytes: 4096 })
  assert.strictEqual(store.read({ expectedIdentity: jsonIdentity }).status, 'missing')
  const persisted = store.write({ schemaVersion: 'FixtureV1', sourceIdentity: jsonIdentity, value: 42 })
  assert.strictEqual(persisted.status, 'persisted')
  const fresh = store.read({ expectedIdentity: jsonIdentity })
  assert.strictEqual(fresh.status, 'fresh')
  assert.strictEqual(fresh.value.value, 42)

  const changedIdentity = buildJsonContentIdentity({ sourceKey: 'fixture/json', value: { one: 2 } }).identity
  assert.strictEqual(store.read({ expectedIdentity: changedIdentity }).status, 'stale')
  fs.writeFileSync(store.filePath, '{broken', 'utf8')
  assert.strictEqual(store.read().status, 'invalid')

  let lockNow = Date.now()
  const locked = createDerivedStateStore({
    root,
    relativePath: '.runtime-state/locked.json',
    lockWaitMs: 0,
    lockLeaseMs: 1000,
    now: () => lockNow
  })
  fs.mkdirSync(path.dirname(locked.lockPath), { recursive: true })
  fs.writeFileSync(locked.lockPath, '{"pid":1}\n', 'utf8')
  lockNow = fs.statSync(locked.lockPath).mtimeMs + 500
  const lockReceipt = locked.write({ schemaVersion: 'FixtureV1', sourceIdentity: jsonIdentity })
  assert.strictEqual(lockReceipt.status, 'bypassed')
  assert.strictEqual(lockReceipt.errorCode, 'DERIVED_STATE_LOCK_TIMEOUT')
  assert.strictEqual(fs.existsSync(locked.lockPath), true, 'a fresh malformed lock must never be quarantined automatically')

  const bounded = createDerivedStateStore({ root, relativePath: '.runtime-state/bounded.json', maxBytes: 64 })
  const boundedReceipt = bounded.write({ schemaVersion: 'FixtureV1', body: 'x'.repeat(100) })
  assert.strictEqual(boundedReceipt.status, 'bypassed')
  assert.strictEqual(boundedReceipt.errorCode, 'DERIVED_STATE_CAPACITY_EXCEEDED')

  assert.throws(() => resolveInside(root, '../escape.json'), error => error instanceof DerivedStateStoreError && error.code === 'DERIVED_STATE_PATH_ESCAPE')
  const tempResidue = fs.readdirSync(path.join(root, '.runtime-state')).filter(file => file.endsWith('.tmp'))
  assert.deepStrictEqual(tempResidue, [])
  process.stdout.write('content identity and derived-state store tests passed\n')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
