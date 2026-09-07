'use strict'

const fs = require('fs')

const KIND_METHODS = [
  'isFile', 'isDirectory', 'isSymbolicLink', 'isBlockDevice',
  'isCharacterDevice', 'isFIFO', 'isSocket'
]

/** Keep file IDs lossless while preserving the numeric metadata used by readers. */
function normalizeStat(stat) {
  const snapshot = {}
  for (const key of Object.keys(stat)) {
    const value = stat[key]
    snapshot[key] = typeof value === 'bigint' ? Number(value) : value
  }
  for (const field of ['dev', 'ino']) {
    const value = stat[field]
    if (typeof value !== 'bigint' && !(typeof value === 'number' && Number.isSafeInteger(value))) {
      throw Object.assign(new Error(`Cannot verify lossless file identity: ${field}`), {
        code: 'FILE_IDENTITY_UNVERIFIED'
      })
    }
    snapshot[field] = String(value)
  }
  // BigIntStats exposes Date fields through prototype getters on some Node
  // releases. Preserve the Stats interface consumed by bounded readers.
  for (const field of ['atime', 'mtime', 'ctime', 'birthtime']) {
    const nanos = stat[`${field}Ns`]
    if (typeof nanos === 'bigint') {
      const millis = Number(nanos / 1000000n) + Number(nanos % 1000000n) / 1e6
      snapshot[`${field}Ms`] = millis
      // Numeric Stats rounds Date milliseconds, whereas BigIntStats truncates
      // them. Keep existing cache timestamps compatible without losing file IDs.
      snapshot[field] = new Date(Math.round(millis))
    } else snapshot[field] = stat[field] instanceof Date ? stat[field] : new Date(Number(stat[`${field}Ms`]))
  }
  if (!Number.isSafeInteger(snapshot.size) || snapshot.size < 0) {
    throw Object.assign(new Error('File size exceeds the supported observation range'), {
      code: 'FILE_IDENTITY_SIZE_UNSUPPORTED'
    })
  }
  for (const method of KIND_METHODS) {
    if (typeof stat[method] === 'function') snapshot[method] = stat[method].bind(stat)
  }
  return snapshot
}

function fstatSnapshot(fsImpl, descriptor) {
  return normalizeStat((fsImpl || fs).fstatSync(descriptor, { bigint: true }))
}

/** Reopen the current ordinary file so comparisons never mix stat.dev and fstat.dev. */
function filePathSnapshot(fsImpl, target) {
  const io = fsImpl || fs
  const before = normalizeStat(io.lstatSync(target, { bigint: true }))
  if (!before.isFile() || before.isSymbolicLink()) {
    throw Object.assign(new Error('File identity requires an ordinary, non-reparse target'), {
      code: 'FILE_IDENTITY_TARGET_CHANGED'
    })
  }
  const descriptor = io.openSync(target, 'r')
  try {
    const snapshot = fstatSnapshot(io, descriptor)
    const after = normalizeStat(io.lstatSync(target, { bigint: true }))
    // Node on Windows may expose different dev values for lstat and fstat.
    // Compare dev only within lstat, and the lossless inode across both APIs.
    if (!snapshot.isFile() || !after.isFile() || after.isSymbolicLink() ||
        before.dev !== after.dev || before.ino !== snapshot.ino || after.ino !== snapshot.ino) {
      throw Object.assign(new Error('File target changed while opening its identity'), {
        code: 'FILE_IDENTITY_TARGET_CHANGED'
      })
    }
    return snapshot
  } finally {
    io.closeSync(descriptor)
  }
}

module.exports = { fstatSnapshot, filePathSnapshot, normalizeStat }
