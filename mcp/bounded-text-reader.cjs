'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { TextDecoder } = require('util')

const DEFAULT_CHUNK_BYTES = 64 * 1024
const DEFAULT_MAX_LINE_BYTES = 64 * 1024

function boundedTextReadError(code, message, details = {}) {
  const error = new Error(message)
  error.code = code
  error.contextReadCode = code
  Object.assign(error, details)
  return error
}

function readBoundedTextFileSync(filePath, options = {}) {
  const fsImpl = options.fs || fs
  const maxBytes = Number(options.maxBytes)
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw boundedTextReadError('SOURCE_READ_BUDGET_INVALID', 'A positive integer maxBytes source budget is required.')
  }
  const resolved = path.resolve(String(filePath || ''))
  let descriptor
  try {
    descriptor = fsImpl.openSync(resolved, 'r')
  } catch (error) {
    if (error?.code === 'ENOENT' && options.allowMissing === true) {
      return {
        path: resolved,
        exists: false,
        logicalBytes: 0,
        sourceBytesRead: 0,
        chars: 0,
        content: ''
      }
    }
    throw error
  }

  try {
    const initial = fsImpl.fstatSync(descriptor)
    if (!initial.isFile()) {
      throw boundedTextReadError('SOURCE_NOT_REGULAR_FILE', `Context source is not a regular file: ${resolved}`, {
        filePath: resolved
      })
    }
    if (initial.size > maxBytes) {
      throw boundedTextReadError('SOURCE_TOO_LARGE', `Context source exceeds the ${maxBytes}-byte read budget: ${resolved}`, {
        filePath: resolved,
        logicalBytes: initial.size,
        maxBytes,
        sourceBytesRead: 0
      })
    }

    const chunks = []
    let sourceBytesRead = 0
    while (sourceBytesRead <= maxBytes) {
      const remainingWithSentinel = maxBytes - sourceBytesRead + 1
      const chunk = Buffer.allocUnsafe(Math.min(DEFAULT_CHUNK_BYTES, remainingWithSentinel))
      const bytesRead = fsImpl.readSync(descriptor, chunk, 0, chunk.length, null)
      if (bytesRead === 0) break
      sourceBytesRead += bytesRead
      if (sourceBytesRead > maxBytes) {
        throw boundedTextReadError('SOURCE_TOO_LARGE', `Context source grew beyond the ${maxBytes}-byte read budget: ${resolved}`, {
          filePath: resolved,
          logicalBytes: fsImpl.fstatSync(descriptor).size,
          maxBytes,
          sourceBytesRead
        })
      }
      chunks.push(chunk.subarray(0, bytesRead))
    }

    const finalStat = fsImpl.fstatSync(descriptor)
    if (finalStat.size > maxBytes) {
      throw boundedTextReadError('SOURCE_TOO_LARGE', `Context source grew beyond the ${maxBytes}-byte read budget: ${resolved}`, {
        filePath: resolved,
        logicalBytes: finalStat.size,
        maxBytes,
        sourceBytesRead
      })
    }
    const bytes = Buffer.concat(chunks, sourceBytesRead)
    let content
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      throw boundedTextReadError('SOURCE_INVALID_UTF8', `Context source is not valid UTF-8: ${resolved}`, {
        filePath: resolved,
        logicalBytes: finalStat.size,
        maxBytes,
        sourceBytesRead
      })
    }
    return {
      path: resolved,
      exists: true,
      logicalBytes: finalStat.size,
      sourceBytesRead,
      chars: content.length,
      modifiedAt: finalStat.mtime.toISOString(),
      content
    }
  } finally {
    fsImpl.closeSync(descriptor)
  }
}

function scanBoundedTextLinesSync(filePath, options = {}) {
  const fsImpl = options.fs || fs
  const maxBytes = Number(options.maxBytes)
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw boundedTextReadError('SOURCE_READ_BUDGET_INVALID', 'A positive integer maxBytes source scan budget is required.')
  }
  const chunkBytes = Number.isInteger(options.chunkBytes) && options.chunkBytes > 0
    ? Math.min(options.chunkBytes, maxBytes)
    : Math.min(DEFAULT_CHUNK_BYTES, maxBytes)
  const maxLineBytes = Number.isInteger(options.maxLineBytes) && options.maxLineBytes > 0
    ? options.maxLineBytes
    : DEFAULT_MAX_LINE_BYTES
  const onLine = typeof options.onLine === 'function' ? options.onLine : () => {}
  const resolved = path.resolve(String(filePath || ''))
  let descriptor
  try {
    descriptor = fsImpl.openSync(resolved, 'r')
  } catch (error) {
    if (error?.code === 'ENOENT' && options.allowMissing === true) {
      return {
        path: resolved,
        exists: false,
        logicalBytes: 0,
        sourceBytesRead: 0,
        sourceDigest: null,
        sourcePrefixDigest: null,
        scanComplete: true,
        continuation: null,
        lineCount: 0,
        oversizedLines: 0
      }
    }
    throw error
  }

  try {
    const initial = fsImpl.fstatSync(descriptor)
    if (!initial.isFile()) {
      throw boundedTextReadError('SOURCE_NOT_REGULAR_FILE', `Context source is not a regular file: ${resolved}`, {
        filePath: resolved
      })
    }
    const scanLimit = Math.min(initial.size, maxBytes)
    const digest = crypto.createHash('sha256')
    const validator = new TextDecoder('utf-8', { fatal: true })
    let sourceBytesRead = 0
    let lineStartByte = 0
    let lineNumber = 0
    let oversizedLines = 0
    let pending = Buffer.alloc(0)
    let discardingLongLine = false

    const emitLine = (lineBytes, endByte, oversized = false) => {
      lineNumber += 1
      if (oversized) {
        oversizedLines += 1
        onLine({
          startByte: lineStartByte,
          endByte,
          line: lineNumber,
          text: null,
          oversized: true
        })
      } else {
        let text
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(lineBytes)
        } catch {
          throw boundedTextReadError('SOURCE_INVALID_UTF8', `Context source is not valid UTF-8: ${resolved}`, {
            filePath: resolved,
            logicalBytes: initial.size,
            maxBytes,
            sourceBytesRead
          })
        }
        if (lineNumber === 1 && text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
        if (text.endsWith('\r')) text = text.slice(0, -1)
        onLine({
          startByte: lineStartByte,
          endByte,
          line: lineNumber,
          text,
          oversized: false
        })
      }
      lineStartByte = endByte
      pending = Buffer.alloc(0)
      discardingLongLine = false
    }

    while (sourceBytesRead < scanLimit) {
      const requested = Math.min(chunkBytes, scanLimit - sourceBytesRead)
      const chunk = Buffer.allocUnsafe(requested)
      const chunkStart = sourceBytesRead
      const bytesRead = fsImpl.readSync(descriptor, chunk, 0, requested, chunkStart)
      if (bytesRead === 0) break
      const bytes = chunk.subarray(0, bytesRead)
      sourceBytesRead += bytesRead
      digest.update(bytes)
      try {
        validator.decode(bytes, { stream: sourceBytesRead < initial.size })
      } catch {
        throw boundedTextReadError('SOURCE_INVALID_UTF8', `Context source is not valid UTF-8: ${resolved}`, {
          filePath: resolved,
          logicalBytes: initial.size,
          maxBytes,
          sourceBytesRead
        })
      }

      let cursor = 0
      while (cursor < bytes.length) {
        const newline = bytes.indexOf(0x0A, cursor)
        const segmentEnd = newline === -1 ? bytes.length : newline
        const segment = bytes.subarray(cursor, segmentEnd)
        if (!discardingLongLine) {
          if (pending.length + segment.length <= maxLineBytes) {
            pending = pending.length ? Buffer.concat([pending, segment]) : Buffer.from(segment)
          } else {
            pending = Buffer.alloc(0)
            discardingLongLine = true
          }
        }
        if (newline === -1) break
        const endByte = chunkStart + newline + 1
        emitLine(pending, endByte, discardingLongLine)
        cursor = newline + 1
      }
    }

    const finalStat = fsImpl.fstatSync(descriptor)
    const identityChanged = initial.dev !== finalStat.dev || initial.ino !== finalStat.ino ||
      initial.size !== finalStat.size || initial.mtimeMs !== finalStat.mtimeMs
    if (identityChanged) {
      throw boundedTextReadError('SOURCE_CHANGED_DURING_READ', `Context source changed during bounded scan: ${resolved}`, {
        filePath: resolved,
        logicalBytes: finalStat.size,
        maxBytes,
        sourceBytesRead
      })
    }
    const scanComplete = sourceBytesRead === finalStat.size
    if (scanComplete) {
      try {
        validator.decode()
      } catch {
        throw boundedTextReadError('SOURCE_INVALID_UTF8', `Context source is not valid UTF-8: ${resolved}`, {
          filePath: resolved,
          logicalBytes: finalStat.size,
          maxBytes,
          sourceBytesRead
        })
      }
      if (pending.length || discardingLongLine) {
        emitLine(pending, sourceBytesRead, discardingLongLine)
      }
    }
    const scannedDigest = digest.digest('hex')
    return {
      path: resolved,
      exists: true,
      logicalBytes: finalStat.size,
      sourceBytesRead,
      sourceDigest: scanComplete ? scannedDigest : null,
      sourcePrefixDigest: scannedDigest,
      scanComplete,
      continuation: scanComplete
        ? null
        : {
            byteOffset: lineStartByte,
            scannedThroughByte: sourceBytesRead,
            remainingLogicalBytes: Math.max(0, finalStat.size - lineStartByte)
          },
      lineCount: lineNumber,
      oversizedLines,
      modifiedAt: finalStat.mtime.toISOString(),
      identity: {
        dev: String(finalStat.dev),
        ino: String(finalStat.ino),
        size: finalStat.size,
        mtimeMs: finalStat.mtimeMs
      }
    }
  } finally {
    fsImpl.closeSync(descriptor)
  }
}

function readBoundedTextRangeSync(filePath, options = {}) {
  const fsImpl = options.fs || fs
  const maxBytes = Number(options.maxBytes)
  const startByte = Number(options.startByte)
  const requestedEnd = Number(options.endByte)
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw boundedTextReadError('SOURCE_READ_BUDGET_INVALID', 'A positive integer maxBytes source range budget is required.')
  }
  if (!Number.isInteger(startByte) || startByte < 0 || !Number.isInteger(requestedEnd) || requestedEnd < startByte) {
    throw boundedTextReadError('SOURCE_RANGE_INVALID', 'Source range offsets must be non-negative integers with endByte >= startByte.')
  }
  const resolved = path.resolve(String(filePath || ''))
  const descriptor = fsImpl.openSync(resolved, 'r')
  try {
    const initial = fsImpl.fstatSync(descriptor)
    if (!initial.isFile()) {
      throw boundedTextReadError('SOURCE_NOT_REGULAR_FILE', `Context source is not a regular file: ${resolved}`, {
        filePath: resolved
      })
    }
    const expected = options.expectedIdentity
    if (expected && (String(initial.dev) !== String(expected.dev) || String(initial.ino) !== String(expected.ino) ||
        initial.size !== expected.size || initial.mtimeMs !== expected.mtimeMs)) {
      throw boundedTextReadError('SOURCE_CHANGED_DURING_READ', `Context source changed before bounded range read: ${resolved}`, {
        filePath: resolved,
        logicalBytes: initial.size,
        maxBytes,
        sourceBytesRead: 0
      })
    }
    const endByte = Math.min(requestedEnd, initial.size)
    const rangeBytes = Math.max(0, endByte - startByte)
    if (rangeBytes > maxBytes) {
      throw boundedTextReadError('SOURCE_TOO_LARGE', `Context source range exceeds the ${maxBytes}-byte read budget: ${resolved}`, {
        filePath: resolved,
        logicalBytes: initial.size,
        maxBytes,
        sourceBytesRead: 0,
        startByte,
        endByte
      })
    }
    const bytes = Buffer.allocUnsafe(rangeBytes)
    let sourceBytesRead = 0
    while (sourceBytesRead < rangeBytes) {
      const bytesRead = fsImpl.readSync(
        descriptor,
        bytes,
        sourceBytesRead,
        rangeBytes - sourceBytesRead,
        startByte + sourceBytesRead
      )
      if (bytesRead === 0) break
      sourceBytesRead += bytesRead
    }
    if (sourceBytesRead !== rangeBytes) {
      throw boundedTextReadError('SOURCE_CHANGED_DURING_READ', `Context source changed during bounded range read: ${resolved}`, {
        filePath: resolved,
        logicalBytes: fsImpl.fstatSync(descriptor).size,
        maxBytes,
        sourceBytesRead,
        startByte,
        endByte
      })
    }
    let content
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      throw boundedTextReadError('SOURCE_INVALID_UTF8', `Context source range is not valid UTF-8: ${resolved}`, {
        filePath: resolved,
        logicalBytes: initial.size,
        maxBytes,
        sourceBytesRead,
        startByte,
        endByte
      })
    }
    return {
      path: resolved,
      logicalBytes: initial.size,
      sourceBytesRead,
      startByte,
      endByte,
      chars: content.length,
      content
    }
  } finally {
    fsImpl.closeSync(descriptor)
  }
}

module.exports = {
  DEFAULT_CHUNK_BYTES,
  DEFAULT_MAX_LINE_BYTES,
  boundedTextReadError,
  readBoundedTextFileSync,
  readBoundedTextRangeSync,
  scanBoundedTextLinesSync
}
