'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const RECEIPT_SCHEMA = 'MemoryFileTransactionReceiptV1'
const SNAPSHOT_SCHEMA = 'MemoryFileSnapshotV1'
const METADATA_RECEIPT_SCHEMA = 'MemoryFileMetadataReceiptV1'
const CAS_ERROR_CODE = 'MEMORY_FILE_CAS_MISMATCH'
const READBACK_ERROR_CODE = 'MEMORY_FILE_READBACK_MISMATCH'
const CREATE_CONFLICT_ERROR_CODE = 'MEMORY_FILE_CREATE_CONFLICT'
const UNSUPPORTED_FSYNC_CODES = new Set(['EINVAL', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EISDIR'])

class MemoryFileTransactionError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'MemoryFileTransactionError'
    this.code = code
    this.details = details
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function fileIdentity(stat) {
  if (!stat) return null
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    size: Number(stat.size),
    mtimeMs: Number(stat.mtimeMs),
    ctimeMs: Number(stat.ctimeMs)
  }
}

function sameFileIdentity(left, right) {
  if (!left || !right) return left === right
  return left.dev === right.dev && left.ino === right.ino
}

function publicSnapshot(snapshot) {
  return {
    schemaVersion: SNAPSHOT_SCHEMA,
    exists: snapshot.exists,
    byteSize: snapshot.byteSize,
    digest: snapshot.digest,
    identity: snapshot.identity,
    metadata: snapshot.metadata
  }
}

function assertExpectedSnapshot(expected, observed, filePath) {
  const matches = expected && observed &&
    expected.schemaVersion === SNAPSHOT_SCHEMA &&
    expected.exists === observed.exists &&
    expected.byteSize === observed.byteSize &&
    expected.digest === observed.digest &&
    sameFileIdentity(expected.identity, observed.identity)
  if (!matches) {
    throw new MemoryFileTransactionError(
      CAS_ERROR_CODE,
      `Memory source changed before commit: ${filePath}`,
      {
        filePath,
        expected: expected ? publicSnapshot(expected) : null,
        observed: observed ? publicSnapshot(observed) : null
      }
    )
  }
}

function platformMetadata(stat, platform) {
  if (!stat) {
    return {
      platform,
      mode: null,
      uid: null,
      gid: null,
      dacl: platform === 'win32'
        ? { status: 'UNVERIFIED', reason: 'no-repeatable-dacl-probe' }
        : { status: 'N/A', reason: 'posix-mode-owner-contract' }
    }
  }
  return {
    platform,
    mode: platform === 'win32' ? null : (stat.mode & 0o7777),
    uid: platform === 'win32' || !Number.isInteger(stat.uid) ? null : stat.uid,
    gid: platform === 'win32' || !Number.isInteger(stat.gid) ? null : stat.gid,
    dacl: platform === 'win32'
      ? { status: 'UNVERIFIED', reason: 'no-repeatable-dacl-probe' }
      : { status: 'N/A', reason: 'posix-mode-owner-contract' }
  }
}

function metadataReceipt(before, after, platform, created) {
  const expectedMode = platform === 'win32' ? null : (created ? 0o600 : before.mode)
  const expectedUid = platform === 'win32' || created ? after.uid : before.uid
  const expectedGid = platform === 'win32' || created ? after.gid : before.gid
  const modeStatus = platform === 'win32'
    ? { status: 'UNVERIFIED', expected: null, before: before.mode, after: after.mode, reason: 'mode-is-not-the-windows-dacl-authority' }
    : {
        status: after.mode === expectedMode ? 'PASS' : 'BLOCK',
        expected: expectedMode,
        before: before.mode,
        after: after.mode,
        reason: after.mode === expectedMode ? null : 'posix-mode-drift'
      }
  const ownerStatus = platform === 'win32'
    ? { status: 'UNVERIFIED', uid: null, gid: null, reason: 'windows-owner-not-probed' }
    : {
        status: after.uid === expectedUid && after.gid === expectedGid ? 'PASS' : 'BLOCK',
        expectedUid,
        expectedGid,
        beforeUid: before.uid,
        beforeGid: before.gid,
        afterUid: after.uid,
        afterGid: after.gid,
        reason: after.uid === expectedUid && after.gid === expectedGid ? null : 'posix-owner-drift'
      }
  const dacl = platform === 'win32'
    ? { status: 'UNVERIFIED', reason: 'no-repeatable-dacl-probe' }
    : { status: 'N/A', reason: 'posix-mode-owner-contract' }
  const blocked = modeStatus.status === 'BLOCK' || ownerStatus.status === 'BLOCK'
  return {
    schemaVersion: METADATA_RECEIPT_SCHEMA,
    platform,
    created,
    status: blocked ? 'BLOCK' : (platform === 'win32' ? 'WARN' : 'PASS'),
    mode: modeStatus,
    owner: ownerStatus,
    dacl
  }
}

function durableStep(operation) {
  try {
    operation()
    return { status: 'PASS', reason: null }
  } catch (error) {
    if (UNSUPPORTED_FSYNC_CODES.has(error?.code)) {
      return { status: 'unsupported', reason: error.code }
    }
    throw error
  }
}

function createNodeMemoryFileAdapter(options = {}) {
  const fsImpl = options.fs || fs
  const pathImpl = options.path || path
  const platform = options.platform || process.platform
  const faultInjector = typeof options.faultInjector === 'function' ? options.faultInjector : () => {}
  const randomBytes = typeof options.randomBytes === 'function'
    ? options.randomBytes
    : size => crypto.randomBytes(size)

  function readDescriptorSnapshot(descriptor, filePath) {
    const stat = fsImpl.fstatSync(descriptor)
    if (!stat.isFile()) {
      throw new MemoryFileTransactionError('MEMORY_FILE_NOT_REGULAR', `Memory target is not a regular file: ${filePath}`)
    }
    const bytes = Buffer.alloc(stat.size)
    let bytesRead = 0
    while (bytesRead < bytes.length) {
      const count = fsImpl.readSync(descriptor, bytes, bytesRead, bytes.length - bytesRead, bytesRead)
      if (!Number.isInteger(count) || count <= 0) break
      bytesRead += count
    }
    if (bytesRead !== bytes.length) {
      throw new MemoryFileTransactionError(CAS_ERROR_CODE, `Memory target changed during snapshot read: ${filePath}`)
    }
    const after = fsImpl.fstatSync(descriptor)
    const beforeIdentity = fileIdentity(stat)
    const afterIdentity = fileIdentity(after)
    if (!sameFileIdentity(beforeIdentity, afterIdentity) || stat.size !== after.size || stat.mtimeMs !== after.mtimeMs) {
      throw new MemoryFileTransactionError(CAS_ERROR_CODE, `Memory target changed during snapshot read: ${filePath}`)
    }
    return {
      schemaVersion: SNAPSHOT_SCHEMA,
      exists: true,
      byteSize: bytes.length,
      digest: sha256(bytes),
      identity: afterIdentity,
      metadata: platformMetadata(after, platform),
      content: bytes.toString('utf8')
    }
  }

  function readSnapshot(filePath) {
    let descriptor
    try {
      descriptor = fsImpl.openSync(filePath, 'r')
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return {
          schemaVersion: SNAPSHOT_SCHEMA,
          exists: false,
          byteSize: 0,
          digest: sha256(Buffer.alloc(0)),
          identity: null,
          metadata: platformMetadata(null, platform),
          content: ''
        }
      }
      throw error
    }
    try {
      return readDescriptorSnapshot(descriptor, filePath)
    } finally {
      fsImpl.closeSync(descriptor)
    }
  }

  function verifyPathIdentity(filePath, expectedIdentity) {
    const stat = fsImpl.statSync(filePath)
    const observed = fileIdentity(stat)
    if (!sameFileIdentity(expectedIdentity, observed)) {
      throw new MemoryFileTransactionError(CAS_ERROR_CODE, `Memory target identity changed before commit: ${filePath}`, {
        expectedIdentity,
        observedIdentity: observed
      })
    }
    return observed
  }

  function ensureParent(filePath) {
    fsImpl.mkdirSync(pathImpl.dirname(filePath), { recursive: true })
  }

  function flushDirectory(directory) {
    if (typeof fsImpl.fsyncSync !== 'function') return { status: 'unsupported', reason: 'fsyncSync-unavailable' }
    let descriptor
    try {
      descriptor = fsImpl.openSync(directory, 'r')
      return durableStep(() => fsImpl.fsyncSync(descriptor))
    } catch (error) {
      if (UNSUPPORTED_FSYNC_CODES.has(error?.code)) return { status: 'unsupported', reason: error.code }
      throw error
    } finally {
      if (descriptor !== undefined) fsImpl.closeSync(descriptor)
    }
  }

  function flushFile(descriptor) {
    if (typeof fsImpl.fsyncSync !== 'function') return { status: 'unsupported', reason: 'fsyncSync-unavailable' }
    return durableStep(() => fsImpl.fsyncSync(descriptor))
  }

  function writeAll(descriptor, bytes, position) {
    let written = 0
    while (written < bytes.length) {
      const count = fsImpl.writeSync(descriptor, bytes, written, bytes.length - written, position + written)
      if (!Number.isInteger(count) || count <= 0) throw new Error('Memory file write made no progress.')
      written += count
    }
    return written
  }

  function readExact(descriptor, length, position) {
    const bytes = Buffer.alloc(length)
    let read = 0
    while (read < length) {
      const count = fsImpl.readSync(descriptor, bytes, read, length - read, position + read)
      if (!Number.isInteger(count) || count <= 0) break
      read += count
    }
    return bytes.subarray(0, read)
  }

  function appendCas(input) {
    const bytes = Buffer.from(input.appendText, 'utf8')
    ensureParent(input.filePath)
    if (!input.expected.exists) {
      let descriptor
      try {
        faultInjector('before-create', input)
        descriptor = fsImpl.openSync(input.filePath, 'wx', 0o600)
        const written = writeAll(descriptor, bytes, 0)
        if (platform !== 'win32' && typeof fsImpl.fchmodSync === 'function') fsImpl.fchmodSync(descriptor, 0o600)
        const fileFlush = flushFile(descriptor)
        const stat = fsImpl.fstatSync(descriptor)
        const tail = readExact(descriptor, bytes.length, 0)
        if (stat.size !== bytes.length || !tail.equals(bytes)) {
          throw new MemoryFileTransactionError(READBACK_ERROR_CODE, `New Memory file readback failed: ${input.filePath}`)
        }
        const afterMetadata = platformMetadata(stat, platform)
        const metadata = metadataReceipt(input.expected.metadata, afterMetadata, platform, true)
        if (metadata.status === 'BLOCK') {
          throw new MemoryFileTransactionError('MEMORY_FILE_METADATA_DRIFT', `New Memory file metadata did not match its contract: ${input.filePath}`, metadata)
        }
        return {
          route: 'eof-append',
          bytesWritten: written,
          bytesRead: tail.length,
          growthBytes: written,
          afterDigest: input.nextDigest,
          afterByteSize: stat.size,
          metadata,
          durability: {
            fileFlush,
            directoryFlush: flushDirectory(pathImpl.dirname(input.filePath)),
            readback: { status: 'PASS', scope: 'created-file-exact' }
          }
        }
      } catch (error) {
        if (error?.code === 'EEXIST') {
          throw new MemoryFileTransactionError(CAS_ERROR_CODE, `Memory target was created by another writer: ${input.filePath}`)
        }
        throw error
      } finally {
        if (descriptor !== undefined) fsImpl.closeSync(descriptor)
      }
    }

    const descriptor = fsImpl.openSync(input.filePath, 'r+')
    try {
      const observed = readDescriptorSnapshot(descriptor, input.filePath)
      assertExpectedSnapshot(input.expected, observed, input.filePath)
      verifyPathIdentity(input.filePath, observed.identity)
      faultInjector('before-append-final-cas', input)
      const finalObserved = readDescriptorSnapshot(descriptor, input.filePath)
      assertExpectedSnapshot(input.expected, finalObserved, input.filePath)
      verifyPathIdentity(input.filePath, finalObserved.identity)
      const written = writeAll(descriptor, bytes, input.expected.byteSize)
      const fileFlush = flushFile(descriptor)
      const afterStat = fsImpl.fstatSync(descriptor)
      const appended = readExact(descriptor, bytes.length, input.expected.byteSize)
      verifyPathIdentity(input.filePath, fileIdentity(afterStat))
      if (afterStat.size !== input.expected.byteSize + bytes.length || !appended.equals(bytes)) {
        throw new MemoryFileTransactionError(READBACK_ERROR_CODE, `Memory append readback failed: ${input.filePath}`)
      }
      const afterMetadata = platformMetadata(afterStat, platform)
      const metadata = metadataReceipt(input.expected.metadata, afterMetadata, platform, false)
      if (metadata.status === 'BLOCK') {
        throw new MemoryFileTransactionError('MEMORY_FILE_METADATA_DRIFT', `Memory append changed protected metadata: ${input.filePath}`, metadata)
      }
      return {
        route: 'eof-append',
        bytesWritten: written,
        bytesRead: observed.byteSize + finalObserved.byteSize + appended.length,
        growthBytes: written,
        afterDigest: input.nextDigest,
        afterByteSize: afterStat.size,
        metadata,
        durability: {
          fileFlush,
          directoryFlush: { status: 'N/A', reason: 'existing-directory-entry-unchanged' },
          readback: { status: 'PASS', scope: 'expected-prefix-cas+appended-range+size+identity' }
        }
      }
    } finally {
      fsImpl.closeSync(descriptor)
    }
  }

  function createCas(input) {
    ensureParent(input.filePath)
    const initial = readSnapshot(input.filePath)
    assertExpectedSnapshot(input.expected, initial, input.filePath)
    if (input.expected.exists) {
      throw new MemoryFileTransactionError(
        CREATE_CONFLICT_ERROR_CODE,
        `Memory create target already exists: ${input.filePath}`
      )
    }
    if (typeof fsImpl.linkSync !== 'function') {
      throw new MemoryFileTransactionError(
        'MEMORY_FILE_ATOMIC_CREATE_UNAVAILABLE',
        `Atomic create-if-absent is unavailable: ${input.filePath}`
      )
    }
    const bytes = Buffer.from(input.content, 'utf8')
    const directory = pathImpl.dirname(input.filePath)
    const temp = pathImpl.join(
      directory,
      `.${pathImpl.basename(input.filePath)}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.create.tmp`
    )
    let descriptor
    try {
      descriptor = fsImpl.openSync(temp, 'wx', 0o600)
      const written = writeAll(descriptor, bytes, 0)
      if (platform !== 'win32' && typeof fsImpl.fchmodSync === 'function') fsImpl.fchmodSync(descriptor, 0o600)
      const fileFlush = flushFile(descriptor)
      fsImpl.closeSync(descriptor)
      descriptor = undefined
      faultInjector('before-create-final-cas', input)
      const finalObserved = readSnapshot(input.filePath)
      assertExpectedSnapshot(input.expected, finalObserved, input.filePath)
      try {
        fsImpl.linkSync(temp, input.filePath)
      } catch (error) {
        if (error?.code === 'EEXIST') {
          throw new MemoryFileTransactionError(
            CREATE_CONFLICT_ERROR_CODE,
            `Memory create target won by another writer: ${input.filePath}`
          )
        }
        throw error
      }
      const directoryFlush = flushDirectory(directory)
      const readback = readSnapshot(input.filePath)
      if (readback.digest !== input.nextDigest || readback.byteSize !== bytes.length || readback.content !== input.content) {
        throw new MemoryFileTransactionError(READBACK_ERROR_CODE, `Memory atomic-create readback failed: ${input.filePath}`)
      }
      const metadata = metadataReceipt(input.expected.metadata, readback.metadata, platform, true)
      if (metadata.status === 'BLOCK') {
        throw new MemoryFileTransactionError(
          'MEMORY_FILE_METADATA_DRIFT',
          `New Memory file metadata did not match its contract: ${input.filePath}`,
          metadata
        )
      }
      return {
        route: 'atomic-create',
        bytesWritten: written,
        bytesRead: initial.byteSize + finalObserved.byteSize + readback.byteSize,
        growthBytes: bytes.length,
        afterDigest: readback.digest,
        afterByteSize: readback.byteSize,
        metadata,
        durability: {
          fileFlush,
          directoryFlush,
          readback: { status: 'PASS', scope: 'hardlink-create-if-absent+whole-file-exact' }
        }
      }
    } finally {
      if (descriptor !== undefined) fsImpl.closeSync(descriptor)
      try { fsImpl.unlinkSync(temp) } catch { /* transaction-owned temp only */ }
    }
  }

  function replaceCas(input) {
    ensureParent(input.filePath)
    const initial = readSnapshot(input.filePath)
    assertExpectedSnapshot(input.expected, initial, input.filePath)
    const bytes = Buffer.from(input.content, 'utf8')
    const directory = pathImpl.dirname(input.filePath)
    const temp = pathImpl.join(
      directory,
      `.${pathImpl.basename(input.filePath)}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`
    )
    let descriptor
    let installed = false
    try {
      descriptor = fsImpl.openSync(temp, 'wx', input.expected.exists && platform !== 'win32'
        ? input.expected.metadata.mode
        : 0o600)
      const written = writeAll(descriptor, bytes, 0)
      if (platform !== 'win32') {
        if (typeof fsImpl.fchmodSync === 'function') {
          fsImpl.fchmodSync(descriptor, input.expected.exists ? input.expected.metadata.mode : 0o600)
        }
        const tempStat = fsImpl.fstatSync(descriptor)
        const expectedUid = input.expected.exists ? input.expected.metadata.uid : tempStat.uid
        const expectedGid = input.expected.exists ? input.expected.metadata.gid : tempStat.gid
        if ((tempStat.uid !== expectedUid || tempStat.gid !== expectedGid) && typeof fsImpl.fchownSync === 'function') {
          fsImpl.fchownSync(descriptor, expectedUid, expectedGid)
        }
      }
      const fileFlush = flushFile(descriptor)
      fsImpl.closeSync(descriptor)
      descriptor = undefined
      faultInjector('before-replace-final-cas', input)
      const finalObserved = readSnapshot(input.filePath)
      assertExpectedSnapshot(input.expected, finalObserved, input.filePath)
      fsImpl.renameSync(temp, input.filePath)
      installed = true
      const directoryFlush = flushDirectory(directory)
      const readback = readSnapshot(input.filePath)
      if (readback.digest !== input.nextDigest || readback.byteSize !== bytes.length || readback.content !== input.content) {
        throw new MemoryFileTransactionError(READBACK_ERROR_CODE, `Memory rewrite readback failed: ${input.filePath}`)
      }
      const metadata = metadataReceipt(input.expected.metadata, readback.metadata, platform, !input.expected.exists)
      if (metadata.status === 'BLOCK') {
        throw new MemoryFileTransactionError('MEMORY_FILE_METADATA_DRIFT', `Memory rewrite changed protected metadata: ${input.filePath}`, metadata)
      }
      return {
        route: 'rewrite',
        bytesWritten: written,
        bytesRead: initial.byteSize + finalObserved.byteSize + readback.byteSize,
        growthBytes: Math.max(0, bytes.length - input.expected.byteSize),
        afterDigest: readback.digest,
        afterByteSize: readback.byteSize,
        metadata,
        durability: {
          fileFlush,
          directoryFlush,
          readback: { status: 'PASS', scope: 'whole-file-exact' }
        }
      }
    } finally {
      if (descriptor !== undefined) fsImpl.closeSync(descriptor)
      if (!installed) {
        try { fsImpl.unlinkSync(temp) } catch { /* transaction-owned temp only */ }
      }
    }
  }

  return { readSnapshot, appendCas, createCas, replaceCas }
}

function createMemoryFileTransaction(options = {}) {
  const adapter = options.adapter || createNodeMemoryFileAdapter(options)
  const now = typeof options.now === 'function' ? options.now : () => new Date()
  const randomBytes = typeof options.randomBytes === 'function'
    ? options.randomBytes
    : size => crypto.randomBytes(size)
  const faultInjector = typeof options.faultInjector === 'function' ? options.faultInjector : () => {}

  function readSnapshot(filePath) {
    return adapter.readSnapshot(path.resolve(filePath))
  }

  function commit(input = {}) {
    const filePath = path.resolve(String(input.filePath || ''))
    const expected = input.expectedSnapshot
    const content = String(input.content ?? '')
    const nextDigest = sha256(Buffer.from(content, 'utf8'))
    const startedAt = input.startedAt || now().toISOString()
    if (!expected || expected.schemaVersion !== SNAPSHOT_SCHEMA) {
      throw new MemoryFileTransactionError('MEMORY_FILE_EXPECTED_SNAPSHOT_REQUIRED', 'A MemoryFileSnapshotV1 is required before commit.')
    }
    faultInjector('before-commit-cas', { filePath, expectedSnapshot: expected })
    const observed = adapter.readSnapshot(filePath)
    assertExpectedSnapshot(expected, observed, filePath)
    const appendText = typeof input.appendText === 'string' ? input.appendText : null
    // Missing targets use the atomic temp+rename creation path. EOF append is
    // reserved for an already-observed file so a failed first write cannot
    // expose a partially created canonical Memory document.
    const appendEligible = expected.exists && appendText !== null && expected.content + appendText === content
    if (content === expected.content) {
      return {
        schemaVersion: RECEIPT_SCHEMA,
        transactionId: randomBytes(12).toString('hex'),
        ...input.receiptContext,
        file: input.relativeFile || filePath,
        route: 'no-op',
        beforeDigest: expected.digest,
        afterDigest: expected.digest,
        beforeBytes: expected.byteSize,
        afterBytes: expected.byteSize,
        bytesRead: observed.byteSize,
        bytesWritten: 0,
        writeAmplificationRatio: 0,
        metadata: expected.exists
          ? metadataReceipt(expected.metadata, observed.metadata, expected.metadata.platform, false)
          : {
              schemaVersion: METADATA_RECEIPT_SCHEMA,
              platform: expected.metadata.platform,
              created: false,
              status: 'PASS',
              mode: { status: 'N/A', reason: 'target-remains-absent' },
              owner: { status: 'N/A', reason: 'target-remains-absent' },
              dacl: { status: 'N/A', reason: 'target-remains-absent' }
            },
        durability: {
          fileFlush: { status: 'N/A', reason: 'no-write' },
          directoryFlush: { status: 'N/A', reason: 'no-write' },
          readback: { status: 'PASS', scope: 'cas-snapshot' }
        },
        startedAt,
        completedAt: now().toISOString()
      }
    }
    const result = appendEligible
      ? adapter.appendCas({ filePath, expected, appendText, content, nextDigest })
      : adapter.replaceCas({ filePath, expected, content, nextDigest })
    const growthBytes = Math.max(1, result.growthBytes || Buffer.byteLength(content) - expected.byteSize || 1)
    return {
      schemaVersion: RECEIPT_SCHEMA,
      transactionId: randomBytes(12).toString('hex'),
      ...input.receiptContext,
      file: input.relativeFile || filePath,
      route: result.route,
      beforeDigest: expected.digest,
      afterDigest: result.afterDigest,
      beforeBytes: expected.byteSize,
      afterBytes: result.afterByteSize,
      bytesRead: result.bytesRead,
      bytesWritten: result.bytesWritten,
      writeAmplificationRatio: Number((result.bytesWritten / growthBytes).toFixed(6)),
      metadata: result.metadata,
      durability: result.durability,
      startedAt,
      completedAt: now().toISOString()
    }
  }

  function createIfAbsent(input = {}) {
    const filePath = path.resolve(String(input.filePath || ''))
    const content = String(input.content ?? '')
    const startedAt = input.startedAt || now().toISOString()
    const expected = adapter.readSnapshot(filePath)
    const nextDigest = sha256(Buffer.from(content, 'utf8'))
    if (expected.exists) {
      if (expected.content !== content || expected.digest !== nextDigest) {
        throw new MemoryFileTransactionError(
          CREATE_CONFLICT_ERROR_CODE,
          `Memory create-if-absent content conflict: ${filePath}`,
          { filePath, expected: publicSnapshot(expected), requestedDigest: nextDigest }
        )
      }
      return {
        schemaVersion: RECEIPT_SCHEMA,
        transactionId: randomBytes(12).toString('hex'),
        ...input.receiptContext,
        file: input.relativeFile || filePath,
        route: 'create-match',
        beforeDigest: expected.digest,
        afterDigest: expected.digest,
        beforeBytes: expected.byteSize,
        afterBytes: expected.byteSize,
        bytesRead: expected.byteSize,
        bytesWritten: 0,
        writeAmplificationRatio: 0,
        metadata: metadataReceipt(expected.metadata, expected.metadata, expected.metadata.platform, false),
        durability: {
          fileFlush: { status: 'N/A', reason: 'matching-target-already-durable' },
          directoryFlush: { status: 'N/A', reason: 'matching-directory-entry-already-durable' },
          readback: { status: 'PASS', scope: 'whole-file-exact' }
        },
        startedAt,
        completedAt: now().toISOString()
      }
    }
    if (typeof adapter.createCas !== 'function') {
      throw new MemoryFileTransactionError(
        'MEMORY_FILE_ATOMIC_CREATE_UNAVAILABLE',
        `Atomic create-if-absent adapter is unavailable: ${filePath}`
      )
    }
    const result = adapter.createCas({ filePath, expected, content, nextDigest })
    const growthBytes = Math.max(1, result.growthBytes || Buffer.byteLength(content, 'utf8') || 1)
    return {
      schemaVersion: RECEIPT_SCHEMA,
      transactionId: randomBytes(12).toString('hex'),
      ...input.receiptContext,
      file: input.relativeFile || filePath,
      route: result.route,
      beforeDigest: expected.digest,
      afterDigest: result.afterDigest,
      beforeBytes: expected.byteSize,
      afterBytes: result.afterByteSize,
      bytesRead: result.bytesRead,
      bytesWritten: result.bytesWritten,
      writeAmplificationRatio: Number((result.bytesWritten / growthBytes).toFixed(6)),
      metadata: result.metadata,
      durability: result.durability,
      startedAt,
      completedAt: now().toISOString()
    }
  }

  return { readSnapshot, commit, createIfAbsent }
}

module.exports = {
  CAS_ERROR_CODE,
  CREATE_CONFLICT_ERROR_CODE,
  MemoryFileTransactionError,
  RECEIPT_SCHEMA,
  SNAPSHOT_SCHEMA,
  assertExpectedSnapshot,
  createMemoryFileTransaction,
  createNodeMemoryFileAdapter,
  metadataReceipt,
  sha256
}
