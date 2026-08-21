'use strict'

const assert = require('assert')
const path = require('path')
const {
  createDerivedStateStore,
  stateDigest
} = require('../hooks/_runtime/derived-state-store.cjs')
const {
  commitLifecycleState,
  readLifecycleStateCommit
} = require('../hooks/_runtime/lifecycle-state-commit.cjs')
const {
  contextSourceLedgerRelativePath
} = require('../hooks/_runtime/context-source-observation.cjs')
const {
  PROJECT_NAMESPACE_SCHEMA_PATTERN,
  normalizeProjectNamespace
} = require('../hooks/_runtime/workspace-layout.cjs')
const {
  readBoundedTextFileSync,
  scanBoundedTextLinesSync
} = require('../mcp/bounded-text-reader.cjs')
const {
  executeGlobalHostTransaction,
  operationDigest
} = require('./lib/global-host-config-transaction.js')
const { mergeVscodeUserMcpContent } = require('./lib/global-host-config.js')

function fsError(code, message) {
  const error = new Error(message || code)
  error.code = code
  return error
}

class MemoryFs {
  constructor() {
    this.entries = new Map()
    this.descriptors = new Map()
    this.nextDescriptor = 10
    this.nextIno = 100
    this.clock = 1000
    this.openCounts = new Map()
    this.readCounts = new Map()
    this.renameCounts = new Map()
    this.unlinkCounts = new Map()
    this.onOpen = null
    this.onRead = null
    this.onRename = null
    this.onUnlink = null
  }

  key(file) {
    const resolved = path.resolve(String(file))
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }

  ensureDirectory(directory) {
    const resolved = path.resolve(directory)
    const parent = path.dirname(resolved)
    if (parent !== resolved) this.ensureDirectory(parent)
    const key = this.key(resolved)
    const existing = this.entries.get(key)
    if (existing?.type === 'file') throw fsError('ENOTDIR')
    if (!existing) {
      this.entries.set(key, {
        type: 'dir', mode: 0o40755, uid: 1, gid: 1,
        dev: 1, ino: this.nextIno++, mtimeMs: this.clock++
      })
    }
  }

  mkdirSync(directory, options = {}) {
    if (!options.recursive && !this.existsSync(path.dirname(path.resolve(directory)))) throw fsError('ENOENT')
    this.ensureDirectory(directory)
  }

  existsSync(file) {
    return this.entries.has(this.key(file))
  }

  setFile(file, value, options = {}) {
    const resolved = path.resolve(file)
    this.ensureDirectory(path.dirname(resolved))
    const key = this.key(resolved)
    const previous = this.entries.get(key)
    const data = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(String(value), options.encoding || 'utf8')
    this.entries.set(key, {
      type: 'file',
      data,
      mode: previous?.mode || 0o100644,
      uid: previous?.uid || 1,
      gid: previous?.gid || 1,
      dev: previous?.dev || 1,
      ino: options.replaceIdentity ? this.nextIno++ : (previous?.ino || this.nextIno++),
      mtimeMs: this.clock++
    })
  }

  setMtime(file, mtimeMs) {
    const entry = this.entries.get(this.key(file))
    if (!entry) throw fsError('ENOENT')
    entry.mtimeMs = mtimeMs
  }

  writeFileSync(target, value, options = {}) {
    if (typeof target === 'number') {
      const descriptor = this.descriptors.get(target)
      if (!descriptor) throw fsError('EBADF')
      this.setFile(descriptor.file, value, { encoding: typeof options === 'string' ? options : options.encoding })
      return
    }
    const flag = typeof options === 'object' ? options.flag : null
    if (flag === 'wx' && this.existsSync(target)) throw fsError('EEXIST')
    this.setFile(target, value, { encoding: typeof options === 'string' ? options : options.encoding })
  }

  readFileSync(target, encoding) {
    const file = typeof target === 'number' ? this.descriptors.get(target)?.file : target
    if (!file) throw fsError('EBADF')
    const key = this.key(file)
    const count = (this.readCounts.get(key) || 0) + 1
    this.readCounts.set(key, count)
    if (this.onRead) this.onRead(file, count, this)
    const entry = this.entries.get(key)
    if (!entry) throw fsError('ENOENT')
    if (entry.type !== 'file') throw fsError('EISDIR')
    const bytes = Buffer.from(entry.data)
    return typeof encoding === 'string' ? bytes.toString(encoding) : bytes
  }

  openSync(file, flag) {
    const resolved = path.resolve(file)
    const key = this.key(resolved)
    const count = (this.openCounts.get(key) || 0) + 1
    this.openCounts.set(key, count)
    if (this.onOpen) this.onOpen(resolved, flag, count, this)
    if (flag === 'wx') {
      if (this.entries.has(key)) throw fsError('EEXIST')
      this.setFile(resolved, '')
    } else if (!this.entries.has(key)) {
      throw fsError('ENOENT')
    }
    const descriptor = this.nextDescriptor++
    this.descriptors.set(descriptor, { file: resolved, position: 0 })
    return descriptor
  }

  closeSync(descriptor) {
    if (!this.descriptors.delete(descriptor)) throw fsError('EBADF')
  }

  fsyncSync() {}

  readSync(descriptor, buffer, offset, length, position) {
    const opened = this.descriptors.get(descriptor)
    if (!opened) throw fsError('EBADF')
    const entry = this.entries.get(this.key(opened.file))
    if (!entry || entry.type !== 'file') throw fsError('ENOENT')
    const start = position == null ? opened.position : position
    const count = Math.max(0, Math.min(length, entry.data.length - start))
    if (count) entry.data.copy(buffer, offset, start, start + count)
    if (position == null) opened.position += count
    return count
  }

  statObject(entry) {
    return {
      size: entry.type === 'file' ? entry.data.length : 0,
      mode: entry.mode,
      uid: entry.uid,
      gid: entry.gid,
      dev: entry.dev,
      ino: entry.ino,
      mtimeMs: entry.mtimeMs,
      mtime: new Date(entry.mtimeMs),
      isFile: () => entry.type === 'file',
      isDirectory: () => entry.type === 'dir',
      isSymbolicLink: () => false
    }
  }

  statSync(file) {
    const entry = this.entries.get(this.key(file))
    if (!entry) throw fsError('ENOENT')
    return this.statObject(entry)
  }

  lstatSync(file) {
    return this.statSync(file)
  }

  fstatSync(descriptor) {
    const opened = this.descriptors.get(descriptor)
    if (!opened) throw fsError('EBADF')
    return this.statSync(opened.file)
  }

  renameSync(source, destination) {
    const sourceKey = this.key(source)
    const destinationKey = this.key(destination)
    const count = (this.renameCounts.get(destinationKey) || 0) + 1
    this.renameCounts.set(destinationKey, count)
    if (this.onRename) this.onRename(source, destination, count, this)
    const entry = this.entries.get(sourceKey)
    if (!entry) throw fsError('ENOENT')
    this.ensureDirectory(path.dirname(path.resolve(destination)))
    this.entries.set(this.key(destination), entry)
    this.entries.delete(sourceKey)
  }

  unlinkSync(file) {
    const key = this.key(file)
    const count = (this.unlinkCounts.get(key) || 0) + 1
    this.unlinkCounts.set(key, count)
    if (this.onUnlink) this.onUnlink(file, count, this)
    const entry = this.entries.get(key)
    if (!entry) throw fsError('ENOENT')
    if (entry.type !== 'file') throw fsError('EISDIR')
    this.entries.delete(key)
  }

  rmdirSync(directory) {
    const key = this.key(directory)
    const entry = this.entries.get(key)
    if (!entry) throw fsError('ENOENT')
    if (entry.type !== 'dir') throw fsError('ENOTDIR')
    const prefix = `${key}${path.sep}`
    if ([...this.entries.keys()].some(candidate => candidate.startsWith(prefix))) throw fsError('ENOTEMPTY')
    this.entries.delete(key)
  }

  copyFileSync(source, destination, flag) {
    if (flag && this.existsSync(destination)) throw fsError('EEXIST')
    this.setFile(destination, this.readFileSync(source))
  }

  chmodSync(file, mode) {
    const entry = this.entries.get(this.key(file))
    if (!entry) throw fsError('ENOENT')
    entry.mode = mode
  }

  chownSync(file, uid, gid) {
    const entry = this.entries.get(this.key(file))
    if (!entry) throw fsError('ENOENT')
    entry.uid = uid
    entry.gid = gid
  }
}

function testDerivedStateOwnerAndCas() {
  const memory = new MemoryFs()
  const root = path.resolve('C:/state')
  memory.mkdirSync(root, { recursive: true })
  let token = 0
  const store = createDerivedStateStore({
    root,
    relativePath: 'ledger.json',
    fs: memory,
    maxWrites: 2,
    lockWaitMs: 0,
    hostname: () => 'host-a',
    pid: 10,
    processKill: () => {},
    randomUUID: () => `token-${++token}`
  })
  assert.strictEqual(store.write({ value: 1 }).status, 'persisted')
  assert.strictEqual(store.update(current => ({ value: current.value + 1 }), {
    expectedDigest: stateDigest({ value: 1 })
  }).status, 'persisted')
  assert.deepStrictEqual(store.read().value, { value: 2 })

  const fixedNow = 10_000
  const validRecord = (ownerToken, hostname, leaseExpiresAtMs) => ({
    schemaVersion: 'DerivedStateLockV2',
    ownerToken,
    hostname,
    pid: 88,
    leaseExpiresAtMs
  })
  const seedLock = (name, value, mtimeMs) => {
    const lockPath = `${path.join(root, `${name}.json`)}.lock`
    memory.writeFileSync(lockPath, value)
    memory.setMtime(lockPath, mtimeMs)
    return lockPath
  }
  const recoveryStore = (name, processKill = () => {}) => createDerivedStateStore({
    root,
    relativePath: `${name}.json`,
    fs: memory,
    lockWaitMs: 0,
    lockLeaseMs: 1000,
    now: () => fixedNow,
    hostname: () => 'host-a',
    pid: 10,
    processKill,
    randomUUID: () => `${name}-${++token}`
  })

  const freshMalformedPath = seedLock('fresh-malformed', '', fixedNow - 500)
  const freshMalformed = recoveryStore('fresh-malformed').write({ forbidden: true })
  assert.strictEqual(freshMalformed.errorCode, 'DERIVED_STATE_LOCK_TIMEOUT')
  assert.strictEqual(memory.existsSync(freshMalformedPath), true)

  for (const [name, value] of [
    ['stale-empty', ''],
    ['stale-corrupt', '{broken']
  ]) {
    seedLock(name, value, fixedNow - 2000)
    const recovered = recoveryStore(name).write({ recovered: true })
    assert.strictEqual(recovered.status, 'persisted')
    assert.strictEqual(recovered.staleLockQuarantined, true)
    assert.strictEqual(recovered.lockRecoveryReason, 'stale-malformed')
    assert.strictEqual(memory.existsSync(recovered.quarantinePath), true)
  }

  seedLock('dead', `${JSON.stringify(validRecord('dead-owner', 'host-a', fixedNow + 1000))}\n`, fixedNow)
  const dead = recoveryStore('dead', () => { throw fsError('ESRCH') }).write({ recovered: true })
  assert.strictEqual(dead.status, 'persisted')
  assert.strictEqual(dead.staleLockQuarantined, true)
  assert.strictEqual(dead.lockRecoveryReason, 'dead-owner')

  seedLock('live-expired', `${JSON.stringify(validRecord('live', 'host-a', fixedNow - 1))}\n`, fixedNow - 2000)
  const liveExpired = recoveryStore('live-expired').write({ forbidden: true })
  assert.strictEqual(liveExpired.errorCode, 'DERIVED_STATE_LOCK_TIMEOUT')

  seedLock('remote-unexpired', `${JSON.stringify(validRecord('remote-new', 'host-b', fixedNow + 1))}\n`, fixedNow)
  const remoteUnexpired = recoveryStore('remote-unexpired').write({ forbidden: true })
  assert.strictEqual(remoteUnexpired.errorCode, 'DERIVED_STATE_LOCK_TIMEOUT')

  seedLock('remote-expired', `${JSON.stringify(validRecord('remote-old', 'host-b', fixedNow - 1))}\n`, fixedNow - 2000)
  const remoteExpired = recoveryStore('remote-expired').write({ recovered: true })
  assert.strictEqual(remoteExpired.status, 'persisted')
  assert.strictEqual(remoteExpired.lockRecoveryReason, 'expired-unknown-owner')

  seedLock('eperm-expired', `${JSON.stringify(validRecord('eperm-old', 'host-a', fixedNow - 1))}\n`, fixedNow - 2000)
  const epermExpired = recoveryStore('eperm-expired', () => { throw fsError('EPERM') }).write({ recovered: true })
  assert.strictEqual(epermExpired.status, 'persisted')
  assert.strictEqual(epermExpired.lockRecoveryReason, 'expired-unknown-owner')

  const driftMemory = new MemoryFs()
  driftMemory.mkdirSync(root, { recursive: true })
  const driftPath = `${path.join(root, 'identity-drift.json')}.lock`
  driftMemory.writeFileSync(driftPath, `${JSON.stringify(validRecord('remote-old', 'host-b', fixedNow - 1))}\n`)
  driftMemory.setMtime(driftPath, fixedNow - 2000)
  driftMemory.onRead = (file, count, fsImpl) => {
    if (fsImpl.key(file) !== fsImpl.key(driftPath) || count !== 2) return
    fsImpl.setFile(file, `${JSON.stringify(validRecord('live-replacement', 'host-a', fixedNow + 1000))}\n`, {
      replaceIdentity: true
    })
    fsImpl.setMtime(file, fixedNow)
  }
  const driftReceipt = createDerivedStateStore({
    root,
    relativePath: 'identity-drift.json',
    fs: driftMemory,
    lockWaitMs: 0,
    lockLeaseMs: 1000,
    now: () => fixedNow,
    hostname: () => 'host-a',
    processKill: () => {},
    randomUUID: () => `drift-${++token}`
  }).write({ forbidden: true })
  assert.strictEqual(driftReceipt.errorCode, 'DERIVED_STATE_LOCK_TIMEOUT')
  assert.strictEqual(JSON.parse(driftMemory.readFileSync(driftPath, 'utf8')).ownerToken, 'live-replacement')

  if (process.platform === 'win32') {
    const transientMemory = new MemoryFs()
    transientMemory.mkdirSync(root, { recursive: true })
    const transientFile = path.join(root, 'windows-transient.json')
    const transientLock = `${transientFile}.lock`
    transientMemory.onOpen = (file, flag, count) => {
      if (transientMemory.key(file) === transientMemory.key(transientLock) && flag === 'wx' && count <= 2) {
        throw fsError('EPERM')
      }
    }
    transientMemory.onRename = (_source, destination, count) => {
      if (transientMemory.key(destination) === transientMemory.key(transientFile) && count <= 2) {
        throw fsError('EPERM')
      }
    }
    transientMemory.onUnlink = (file, count) => {
      if (transientMemory.key(file) === transientMemory.key(transientLock) && count <= 2) {
        throw fsError('EPERM')
      }
    }
    let transientNow = 0
    const transientReceipt = createDerivedStateStore({
      root,
      relativePath: 'windows-transient.json',
      fs: transientMemory,
      lockWaitMs: 2000,
      now: () => { transientNow += 10; return transientNow },
      hostname: () => 'host-a',
      pid: 10,
      randomUUID: () => `transient-${++token}`
    }).write({ recovered: true })
    assert.strictEqual(transientReceipt.status, 'persisted')
    assert.strictEqual(transientReceipt.replaceRetries, 2)
    assert.strictEqual(transientMemory.existsSync(transientLock), false)
  }
}

function testLifecycleGenerationPointer() {
  const memory = new MemoryFs()
  const base = path.resolve('C:/lifecycle')
  const metaDir = path.join(base, 'workspace')
  const activeDir = path.join(base, 'project')
  const sessionDir = path.join(metaDir, 'sessions')
  const first = commitLifecycleState({
    metaDir,
    state: { value: 'one' },
    identity: { project: 'project', scope: 'project', sessionKey: 's1' },
    targets: [{ role: 'active', dir: activeDir }, { role: 'meta', dir: metaDir }, { role: 'session', dir: sessionDir }]
  }, { fs: memory, transactionId: 'tx-one' })
  assert.strictEqual(first.status, 'committed')
  const second = commitLifecycleState({
    metaDir,
    state: { value: 'two' },
    identity: { project: 'project', scope: 'project', sessionKey: 's2' },
    targets: [{ role: 'active', dir: activeDir }, { role: 'meta', dir: metaDir }, { role: 'session', dir: sessionDir }]
  }, { fs: memory, transactionId: 'tx-two' })
  assert.strictEqual(second.status, 'committed')
  assert.deepStrictEqual(readLifecycleStateCommit({ metaDir, sessionKey: 's1' }, { fs: memory }).state, { value: 'one' })
  assert.deepStrictEqual(readLifecycleStateCommit({ metaDir, sessionKey: 's2' }, { fs: memory }).state, { value: 'two' })
  assert.deepStrictEqual(readLifecycleStateCommit({ metaDir }, { fs: memory }).state, { value: 'two' })
  memory.setFile(second.entries[0].file, '{"corrupt":true}\n')
  assert.strictEqual(readLifecycleStateCommit({ metaDir, sessionKey: 's2' }, { fs: memory }).status, 'stale')
  assert.strictEqual(readLifecycleStateCommit({ metaDir, sessionKey: 's1' }, { fs: memory }).status, 'fresh')
}

function testObservationFullDigestPath() {
  const paths = new Set()
  for (let index = 0; index < 512; index += 1) {
    paths.add(contextSourceLedgerRelativePath(`epoch-${index}`))
  }
  assert.strictEqual(paths.size, 512)
  for (const file of paths) {
    assert.match(file.replace(/\\/g, '/'), /context-source-observations\/v3\/[a-f0-9]{2}\/[a-f0-9]{64}\.json$/)
  }
}

function testGlobalConfigJournalRecovery() {
  const memory = new MemoryFs()
  const root = path.resolve('C:/global-host')
  const config = path.join(root, 'config.json')
  const transactionRoot = path.join(root, 'devcodex', 'transactions')
  memory.setFile(config, 'old')
  const operation = {
    host: 'test', action: 'write', kind: 'text', path: config,
    content: 'new', expectedDigest: operationDigest('old')
  }
  let crash
  try {
    executeGlobalHostTransaction([operation], {
      fs: memory,
      allowedRoots: [root],
      safetyRoots: [root],
      allowedByHost: { test: { allowedRoots: [root], allowedFiles: [], safetyRoots: [root] } },
      transactionRoot,
      transactionId: 'crash-one',
      crashAfterPhase: 'backed-up'
    })
  } catch (error) {
    crash = error
  }
  assert.strictEqual(crash?.code, 'GLOBAL_HOST_TEST_SIMULATED_CRASH')
  assert.strictEqual(memory.existsSync(config), false)

  const recovered = executeGlobalHostTransaction([operation], {
    fs: memory,
    allowedRoots: [root],
    safetyRoots: [root],
    allowedByHost: { test: { allowedRoots: [root], allowedFiles: [], safetyRoots: [root] } },
    transactionRoot,
    transactionId: 'recovered-two'
  })
  assert.strictEqual(recovered.status, 'committed')
  assert.strictEqual(recovered.recoveredTransactions[0].status, 'recovered-rolled-back')
  assert.strictEqual(memory.readFileSync(config, 'utf8'), 'new')
}

function testBoundedReaderFinalIdentity() {
  const memory = new MemoryFs()
  const file = path.resolve('C:/sources/profile.md')
  memory.setFile(file, 'alpha\n')
  memory.onOpen = (opened, flag, count, fsImpl) => {
    if (fsImpl.key(opened) === fsImpl.key(file) && flag === 'r' && count === 2) {
      fsImpl.setFile(file, 'bravo\n')
    }
  }
  const result = readBoundedTextFileSync(file, { fs: memory, maxBytes: 100 })
  assert.strictEqual(result.content, 'bravo\n')
  assert.strictEqual(result.sourceReadAttempt, 2)

  const scanMemory = new MemoryFs()
  scanMemory.setFile(file, 'one\ntwo\n')
  scanMemory.onOpen = (opened, flag, count, fsImpl) => {
    if (fsImpl.key(opened) === fsImpl.key(file) && flag === 'r' && count === 2) {
      fsImpl.setFile(file, 'six\nfive\n')
    }
  }
  const lines = []
  const scan = scanBoundedTextLinesSync(file, {
    fs: scanMemory,
    maxBytes: 100,
    onLine: line => lines.push(line.text)
  })
  assert.strictEqual(scan.sourceReadAttempt, 2)
  assert.deepStrictEqual(lines, ['six', 'five'])

  const unstable = new MemoryFs()
  unstable.setFile(file, 'aaaa\n')
  unstable.onOpen = (opened, flag, count, fsImpl) => {
    if (fsImpl.key(opened) === fsImpl.key(file) && flag === 'r' && (count === 2 || count === 4)) {
      fsImpl.setFile(file, count === 2 ? 'bbbb\n' : 'cccc\n')
    }
  }
  assert.throws(
    () => readBoundedTextFileSync(file, { fs: unstable, maxBytes: 100 }),
    error => error?.code === 'SOURCE_CHANGED_DURING_READ'
  )
}

function testNamespaceAndVscodeContract() {
  const schema = new RegExp(PROJECT_NAMESPACE_SCHEMA_PATTERN)
  for (const value of ['devcodex', 'apps/api', 'a_b/c.d-1']) {
    assert.strictEqual(schema.test(value), true)
    assert.strictEqual(normalizeProjectNamespace(value, { layout: { enabled: false }, allowEmpty: false }), value)
  }
  for (const value of [' apps/api', 'apps\\api', 'apps//api', '/apps', 'apps/', '.', '..', 'workspace', 'Profile']) {
    assert.throws(
      () => normalizeProjectNamespace(value, { layout: { enabled: false }, allowEmpty: false }),
      error => error?.code === 'PROJECT_NAMESPACE_INVALID'
    )
  }

  for (const invalid of [null, [], 'bad']) {
    const original = `${JSON.stringify({ inputs: [{ id: 'keep' }], servers: invalid }, null, 2)}\n`
    assert.throws(
      () => mergeVscodeUserMcpContent(original, path.resolve('C:/runtime')),
      error => error?.code === 'VSCODE_MCP_SERVERS_INVALID_TYPE'
    )
    assert.ok(original.includes('"keep"'))
  }
}

testDerivedStateOwnerAndCas()
testLifecycleGenerationPointer()
testObservationFullDigestPath()
testGlobalConfigJournalRecovery()
testBoundedReaderFinalIdentity()
testNamespaceAndVscodeContract()

console.log('v1.17.8 Batch B: 7/7 issue probes passed')
