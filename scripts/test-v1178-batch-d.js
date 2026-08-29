'use strict'

const assert = require('assert')
const path = require('path')
const {
  CAS_ERROR_CODE,
  SNAPSHOT_SCHEMA,
  createMemoryFileTransaction,
  metadataReceipt,
  sha256
} = require('../mcp/memory-file-transaction.cjs')
const {
  applyMemoryCursor,
  decodeMemoryCursor,
  dispatch,
  memoryCursorBinding
} = require('../mcp/memory-server.js')
const { paginateMemoryItems } = require('./lib/memory-index.js')

class MemoryFs {
  constructor() {
    this.files = new Map()
    this.directories = new Set()
    this.descriptors = new Map()
    this.nextDescriptor = 10
    this.nextInode = 100
    this.clock = 1000
  }

  key(value) {
    return path.resolve(value)
  }

  error(code, message) {
    return Object.assign(new Error(message), { code })
  }

  mkdirSync(directory) {
    this.directories.add(this.key(directory))
  }

  put(filePath, content, mode = 0o600, uid = 1000, gid = 1000) {
    const key = this.key(filePath)
    this.directories.add(path.dirname(key))
    const existing = this.files.get(key)
    const entry = existing || { ino: this.nextInode++, ctimeMs: this.clock++, mode, uid, gid }
    entry.buffer = Buffer.from(content, 'utf8')
    entry.mode = mode
    entry.uid = uid
    entry.gid = gid
    entry.mtimeMs = this.clock++
    this.files.set(key, entry)
  }

  text(filePath) {
    return this.files.get(this.key(filePath))?.buffer.toString('utf8')
  }

  statFor(entry, directory = false) {
    return {
      dev: 1,
      ino: entry?.ino || 1,
      size: directory ? 0 : entry.buffer.length,
      mtimeMs: entry?.mtimeMs || 1,
      ctimeMs: entry?.ctimeMs || 1,
      mtime: new Date(entry?.mtimeMs || 1),
      mode: directory ? 0o700 : entry.mode,
      uid: directory ? 1000 : entry.uid,
      gid: directory ? 1000 : entry.gid,
      isFile() { return !directory },
      isDirectory() { return directory }
    }
  }

  openSync(filePath, flags, mode = 0o600) {
    const key = this.key(filePath)
    if (flags === 'r' && this.directories.has(key)) {
      const descriptor = this.nextDescriptor++
      this.descriptors.set(descriptor, { key, directory: true })
      return descriptor
    }
    let entry = this.files.get(key)
    if (flags === 'wx') {
      if (entry) throw this.error('EEXIST', `exists: ${key}`)
      entry = { ino: this.nextInode++, buffer: Buffer.alloc(0), mode, uid: 1000, gid: 1000, mtimeMs: this.clock++, ctimeMs: this.clock++ }
      this.files.set(key, entry)
    } else if (!entry) {
      throw this.error('ENOENT', `missing: ${key}`)
    }
    const descriptor = this.nextDescriptor++
    this.descriptors.set(descriptor, { key, entry, directory: false })
    return descriptor
  }

  closeSync(descriptor) {
    this.descriptors.delete(descriptor)
  }

  fstatSync(descriptor) {
    const item = this.descriptors.get(descriptor)
    if (!item) throw this.error('EBADF', 'bad descriptor')
    return this.statFor(item.entry, item.directory)
  }

  statSync(filePath) {
    const key = this.key(filePath)
    if (this.directories.has(key) && !this.files.has(key)) return this.statFor(null, true)
    const entry = this.files.get(key)
    if (!entry) throw this.error('ENOENT', `missing: ${key}`)
    return this.statFor(entry, false)
  }

  readSync(descriptor, target, targetOffset, length, position) {
    const entry = this.descriptors.get(descriptor)?.entry
    if (!entry) throw this.error('EBADF', 'bad descriptor')
    const available = Math.max(0, Math.min(length, entry.buffer.length - position))
    if (available) entry.buffer.copy(target, targetOffset, position, position + available)
    return available
  }

  writeSync(descriptor, source, sourceOffset, length, position) {
    const entry = this.descriptors.get(descriptor)?.entry
    if (!entry) throw this.error('EBADF', 'bad descriptor')
    const end = position + length
    if (end > entry.buffer.length) {
      const expanded = Buffer.alloc(end)
      entry.buffer.copy(expanded)
      entry.buffer = expanded
    }
    source.copy(entry.buffer, position, sourceOffset, sourceOffset + length)
    entry.mtimeMs = this.clock++
    return length
  }

  fchmodSync(descriptor, mode) {
    this.descriptors.get(descriptor).entry.mode = mode
  }

  fchownSync(descriptor, uid, gid) {
    const entry = this.descriptors.get(descriptor).entry
    entry.uid = uid
    entry.gid = gid
  }

  fsyncSync() {}

  renameSync(source, destination) {
    const sourceKey = this.key(source)
    const destinationKey = this.key(destination)
    const entry = this.files.get(sourceKey)
    if (!entry) throw this.error('ENOENT', `missing: ${sourceKey}`)
    this.files.delete(sourceKey)
    this.files.set(destinationKey, entry)
  }

  unlinkSync(filePath) {
    const key = this.key(filePath)
    if (!this.files.delete(key)) throw this.error('ENOENT', `missing: ${key}`)
  }
}

function fakeSnapshot(state) {
  const bytes = Buffer.from(state.content, 'utf8')
  return {
    schemaVersion: SNAPSHOT_SCHEMA,
    exists: state.exists,
    byteSize: state.exists ? bytes.length : 0,
    digest: sha256(state.exists ? bytes : Buffer.alloc(0)),
    identity: state.exists
      ? { dev: '1', ino: '7', size: bytes.length, mtimeMs: state.revision, ctimeMs: 1 }
      : null,
    metadata: state.exists
      ? { platform: 'linux', mode: state.mode, uid: state.uid, gid: state.gid, dacl: { status: 'N/A' } }
      : { platform: 'linux', mode: null, uid: null, gid: null, dacl: { status: 'N/A' } },
    content: state.exists ? state.content : ''
  }
}

function createFakeAdapter(initial = '') {
  const state = {
    exists: initial.length > 0,
    content: initial,
    mode: 0o640,
    uid: 1000,
    gid: 1000,
    revision: 1
  }
  const adapter = {
    readSnapshot() {
      return fakeSnapshot(state)
    },
    appendCas(input) {
      assert.strictEqual(fakeSnapshot(state).digest, input.expected.digest)
      state.content += input.appendText
      state.exists = true
      state.mode = input.expected.exists ? input.expected.metadata.mode : 0o600
      state.revision += 1
      const after = fakeSnapshot(state)
      return {
        route: 'eof-append',
        bytesWritten: Buffer.byteLength(input.appendText),
        bytesRead: Buffer.byteLength(input.appendText),
        growthBytes: Buffer.byteLength(input.appendText),
        afterDigest: after.digest,
        afterByteSize: after.byteSize,
        metadata: metadataReceipt(input.expected.metadata, after.metadata, 'linux', !input.expected.exists),
        durability: {
          fileFlush: { status: 'PASS', reason: null },
          directoryFlush: input.expected.exists
            ? { status: 'N/A', reason: 'existing-directory-entry-unchanged' }
            : { status: 'PASS', reason: null },
          readback: { status: 'PASS', scope: 'fake-exact' }
        }
      }
    },
    replaceCas(input) {
      assert.strictEqual(fakeSnapshot(state).digest, input.expected.digest)
      state.content = input.content
      state.exists = true
      state.mode = input.expected.exists ? input.expected.metadata.mode : 0o600
      state.revision += 1
      const after = fakeSnapshot(state)
      return {
        route: 'rewrite',
        bytesWritten: Buffer.byteLength(input.content),
        bytesRead: Buffer.byteLength(input.content),
        growthBytes: Math.max(0, after.byteSize - input.expected.byteSize),
        afterDigest: after.digest,
        afterByteSize: after.byteSize,
        metadata: metadataReceipt(input.expected.metadata, after.metadata, 'linux', !input.expected.exists),
        durability: {
          fileFlush: { status: 'PASS', reason: null },
          directoryFlush: { status: 'PASS', reason: null },
          readback: { status: 'PASS', scope: 'fake-exact' }
        }
      }
    }
  }
  return { adapter, state }
}

function testTransactionCasAndAppendAmplification() {
  const fake = createFakeAdapter('seed\n')
  const transaction = createMemoryFileTransaction({ adapter: fake.adapter })
  const receipts = []
  for (const size of [16, 64, 256, 1024, 4096]) {
    const expectedSnapshot = transaction.readSnapshot('memory.md')
    const appendText = `${'x'.repeat(size)}\n`
    receipts.push(transaction.commit({
      filePath: 'memory.md',
      expectedSnapshot,
      content: expectedSnapshot.content + appendText,
      appendText
    }))
  }
  assert(receipts.every(receipt => receipt.schemaVersion === 'MemoryFileTransactionReceiptV1'))
  assert(receipts.every(receipt => receipt.route === 'eof-append'))
  assert(receipts.every(receipt => receipt.writeAmplificationRatio === 1))
  assert(receipts.every(receipt => receipt.durability.fileFlush.status === 'PASS'))
  assert(receipts.every(receipt => receipt.metadata.status === 'PASS'))

  const external = createFakeAdapter('before\n')
  let injected = false
  const guarded = createMemoryFileTransaction({
    adapter: external.adapter,
    faultInjector(stage) {
      if (stage === 'before-commit-cas' && !injected) {
        injected = true
        external.state.content = 'external-edit\n'
        external.state.revision += 1
      }
    }
  })
  const expected = guarded.readSnapshot('memory.md')
  assert.throws(
    () => guarded.commit({
      filePath: 'memory.md',
      expectedSnapshot: expected,
      content: `${expected.content}writer\n`,
      appendText: 'writer\n'
    }),
    error => error.code === CAS_ERROR_CODE
  )
  assert.strictEqual(external.state.content, 'external-edit\n', 'CAS rejection must preserve the external edit')

  const reconciledExternal = createFakeAdapter('before\n')
  let reconcileInjected = false
  const reconciler = createMemoryFileTransaction({
    adapter: reconciledExternal.adapter,
    faultInjector(stage) {
      if (stage === 'before-commit-cas' && !reconcileInjected) {
        reconcileInjected = true
        reconciledExternal.state.content = 'external-edit\n'
        reconciledExternal.state.revision += 1
      }
    }
  })
  const reconciled = reconciler.commitPureOperation({
    filePath: 'memory.md',
    relativeFile: '.memory/tasks/20260829.md',
    operationFingerprint: 'b'.repeat(64),
    reconcileOnce: true,
    operation(content) {
      return {
        content: `${content}writer\n`,
        appendText: 'writer\n',
        reconcileIdentity: 'c'.repeat(64)
      }
    }
  })
  assert.strictEqual(reconciledExternal.state.content, 'external-edit\nwriter\n')
  assert.strictEqual(reconciled.conflictReceipt.schemaVersion, 'MemoryTransactionConflictReceiptV2')
  assert.strictEqual(reconciled.conflictReceipt.status, 'reconciled')
  assert.strictEqual(reconciled.conflictReceipt.writerFingerprint.status, 'UNVERIFIED')

  const semanticDrift = createFakeAdapter('before\n')
  let semanticInjected = false
  const semanticGuard = createMemoryFileTransaction({
    adapter: semanticDrift.adapter,
    faultInjector(stage) {
      if (stage === 'before-commit-cas' && !semanticInjected) {
        semanticInjected = true
        semanticDrift.state.content = 'changed-precondition\n'
        semanticDrift.state.revision += 1
      }
    }
  })
  assert.throws(() => semanticGuard.commitPureOperation({
    filePath: 'memory.md',
    relativeFile: '.memory/tasks/20260829.md',
    operationFingerprint: 'd'.repeat(64),
    reconcileOnce: true,
    operation(content) {
      return {
        content: `${content}writer\n`,
        appendText: 'writer\n',
        reconcileIdentity: sha256(Buffer.from(content, 'utf8'))
      }
    }
  }), error => error.code === 'MEMORY_TRANSACTION_RECONCILE_PRECONDITION_CHANGED' &&
    error.details?.conflictReceipt?.status === 'blocked-semantic-precondition-changed')
  assert.strictEqual(semanticDrift.state.content, 'changed-precondition\n')
}

function testNodeAdapterInMemory() {
  const memoryFs = new MemoryFs()
  const filePath = path.resolve('node-adapter-memory.md')
  const createdPath = path.resolve('node-adapter-created.md')
  const transaction = createMemoryFileTransaction({ fs: memoryFs, platform: 'linux' })
  const missingSnapshot = transaction.readSnapshot(createdPath)
  const created = transaction.commit({
    filePath: createdPath,
    expectedSnapshot: missingSnapshot,
    content: 'first\n',
    appendText: 'first\n'
  })
  assert.strictEqual(created.route, 'rewrite', 'first creation must use atomic temp+rename')
  assert.strictEqual(created.metadata.mode.after, 0o600)
  assert.strictEqual(memoryFs.text(createdPath), 'first\n')

  memoryFs.put(filePath, 'alpha\n', 0o640, 1200, 1300)
  let expectedSnapshot = transaction.readSnapshot(filePath)
  const append = transaction.commit({
    filePath,
    expectedSnapshot,
    content: `${expectedSnapshot.content}beta\n`,
    appendText: 'beta\n'
  })
  assert.strictEqual(append.route, 'eof-append')
  assert.strictEqual(append.writeAmplificationRatio, 1)
  assert.strictEqual(append.metadata.mode.after, 0o640)
  assert.strictEqual(append.metadata.owner.afterUid, 1200)
  assert.strictEqual(append.durability.fileFlush.status, 'PASS')
  assert.strictEqual(memoryFs.text(filePath), 'alpha\nbeta\n')

  expectedSnapshot = transaction.readSnapshot(filePath)
  const rewrite = transaction.commit({
    filePath,
    expectedSnapshot,
    content: expectedSnapshot.content.toUpperCase()
  })
  assert.strictEqual(rewrite.route, 'rewrite')
  assert.strictEqual(rewrite.metadata.status, 'PASS')
  assert.strictEqual(rewrite.durability.directoryFlush.status, 'PASS')
  assert.strictEqual(memoryFs.text(filePath), 'ALPHA\nBETA\n')

  let injected = false
  const guarded = createMemoryFileTransaction({
    fs: memoryFs,
    platform: 'linux',
    faultInjector(stage) {
      if (stage === 'before-replace-final-cas' && !injected) {
        injected = true
        memoryFs.put(filePath, 'external-final-cas\n', 0o640, 1200, 1300)
      }
    }
  })
  expectedSnapshot = guarded.readSnapshot(filePath)
  assert.throws(
    () => guarded.commit({ filePath, expectedSnapshot, content: 'writer-rewrite\n' }),
    error => error.code === CAS_ERROR_CODE
  )
  assert.strictEqual(memoryFs.text(filePath), 'external-final-cas\n')
  assert.strictEqual(
    [...memoryFs.files.keys()].filter(item => item.endsWith('.tmp')).length,
    0,
    'failed rewrite must clean only its transaction-owned in-memory temp'
  )
}

function testMetadataTruthfulness() {
  const posix = metadataReceipt(
    { platform: 'linux', mode: 0o640, uid: 1000, gid: 1001 },
    { platform: 'linux', mode: 0o640, uid: 1000, gid: 1001 },
    'linux',
    false
  )
  assert.strictEqual(posix.status, 'PASS')
  assert.strictEqual(posix.mode.status, 'PASS')
  assert.strictEqual(posix.owner.status, 'PASS')

  const windows = metadataReceipt(
    { platform: 'win32', mode: null, uid: null, gid: null },
    { platform: 'win32', mode: null, uid: null, gid: null },
    'win32',
    false
  )
  assert.strictEqual(windows.status, 'WARN')
  assert.strictEqual(windows.dacl.status, 'UNVERIFIED')
}

function testOpaqueCursorAndPagination() {
  const target = {
    activeRoot: path.resolve('fixture-root'),
    project: 'fixture',
    scope: 'project',
    agent: 'codex'
  }
  const contextBinding = {
    schemaVersion: 'ContextReadBindingV1',
    planId: 'plan-fixture',
    planContentId: 'content-fixture',
    planEpoch: 1
  }
  const query = { status: 'all', limit: 2, since: null }
  const binding = memoryCursorBinding('memory_summary_query', target, contextBinding, query)
  const source = {
    path: path.join(target.activeRoot, '.memory', 'clients', 'codex', 'SUMMARY.md'),
    exists: true,
    bytes: 128,
    modifiedAt: '2026-08-16T00:00:00.000Z',
    sourceDigest: 'a'.repeat(64)
  }
  const projection = {
    source,
    coverage: { status: 'legacy-complete' },
    canonicalSourceTrust: { status: 'trusted' },
    fallbackCoverage: { status: 'complete' }
  }
  applyMemoryCursor(projection, {
    binding,
    cursorState: { offset: 0, payload: null },
    returned: 2,
    hasMore: true
  })
  assert.match(projection.nextCursor, /^mcv1\.[A-Za-z0-9_-]+\.[a-f0-9]{64}$/)
  assert(!projection.nextCursor.includes('offset'), 'public cursor must not expose a raw offset field')
  const payload = decodeMemoryCursor(projection.nextCursor, binding)
  assert.strictEqual(payload.offset, 2)

  const secondProjection = {
    source: { ...source },
    coverage: { status: 'legacy-complete' },
    canonicalSourceTrust: { status: 'trusted' },
    fallbackCoverage: { status: 'complete' }
  }
  applyMemoryCursor(secondProjection, {
    binding,
    cursorState: { offset: payload.offset, payload },
    returned: 2,
    hasMore: false
  })
  assert.strictEqual(secondProjection.pagination.cursorAccepted, true)
  assert.strictEqual(secondProjection.nextCursor, null)

  const rows = ['newest', 'newer', 'older', 'oldest']
  assert.deepStrictEqual([
    ...paginateMemoryItems(rows, 0, 2),
    ...paginateMemoryItems(rows, payload.offset, 2)
  ], rows)

  const changedQueryBinding = memoryCursorBinding(
    'memory_summary_query',
    target,
    contextBinding,
    { ...query, status: 'active' }
  )
  assert.throws(
    () => decodeMemoryCursor(projection.nextCursor, changedQueryBinding),
    error => error.contextReadCode === 'MEMORY_CURSOR_BINDING_MISMATCH'
  )
  assert.throws(
    () => applyMemoryCursor({
      ...secondProjection,
      source: { ...source, sourceDigest: 'b'.repeat(64) }
    }, {
      binding,
      cursorState: { offset: payload.offset, payload },
      returned: 1,
      hasMore: false
    }),
    error => error.contextReadCode === 'MEMORY_CURSOR_SOURCE_CHANGED'
  )

  const partialProjection = {
    source: { ...source, sourceDigest: null, sourcePrefixDigest: 'c'.repeat(64) },
    coverage: { status: 'partial' },
    canonicalSourceTrust: { status: 'partial' },
    fallbackCoverage: { status: 'partial' }
  }
  applyMemoryCursor(partialProjection, {
    binding,
    cursorState: { offset: 0, payload: null },
    returned: 1,
    hasMore: true
  })
  assert.strictEqual(partialProjection.nextCursor, null)
  assert.strictEqual(partialProjection.pagination.blockedReason, 'canonical-source-partial')
}

function testPublicSchemaRuntimeParity() {
  const tools = dispatch('tools/list', {}).tools
  const write = tools.find(tool => tool.name === 'memory_session_write')
  const sessionQuery = tools.find(tool => tool.name === 'memory_session_query')
  const summaryQuery = tools.find(tool => tool.name === 'memory_summary_query')
  assert.deepStrictEqual(write.inputSchema.required, ['content', 'sessionId', 'sessionBinding'])
  assert.strictEqual(sessionQuery.inputSchema.properties.cursor.maxLength, 8192)
  assert.strictEqual(summaryQuery.inputSchema.properties.cursor.maxLength, 8192)

  const rejected = dispatch('tools/call', {
    name: 'memory_session_write',
    arguments: { content: 'must not be written' }
  })
  assert.strictEqual(rejected.isError, true)
  assert.strictEqual(rejected.structuredContent.errorCode, 'MEMORY_WRITER_ARGUMENT_REQUIRED')
}

testTransactionCasAndAppendAmplification()
testNodeAdapterInMemory()
testMetadataTruthfulness()
testOpaqueCursorAndPagination()
testPublicSchemaRuntimeParity()

console.log('v1.17.8 Batch D tests passed: 5/5 (metadata/CAS/cursor/schema/append)')
