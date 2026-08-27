'use strict'

const TRANSIENT_WINDOWS_FS_CODES = new Set(['EACCES', 'EBUSY', 'EPERM'])

function waitSync (milliseconds) {
  if (milliseconds <= 0) return
  const signal = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(signal, 0, 0, milliseconds)
}

function isTransientWindowsFsError (error, options = {}) {
  const platform = String(options.platform || process.platform).toLowerCase()
  return platform === 'win32' && TRANSIENT_WINDOWS_FS_CODES.has(String(error?.code || '').toUpperCase())
}

function retryTransientWindowsFs (operation, options = {}) {
  if (typeof operation !== 'function') throw new TypeError('operation must be a function')
  const maxAttempts = Number.isInteger(options.maxAttempts) && options.maxAttempts > 0
    ? options.maxAttempts
    : 40
  const delayMs = Number.isInteger(options.delayMs) && options.delayMs >= 0
    ? options.delayMs
    : 5
  let retries = 0
  while (true) {
    try {
      return { value: operation(), retries }
    } catch (error) {
      if (!isTransientWindowsFsError(error, options) || retries >= maxAttempts - 1) throw error
      retries += 1
      waitSync(delayMs)
    }
  }
}

module.exports = {
  TRANSIENT_WINDOWS_FS_CODES,
  isTransientWindowsFsError,
  retryTransientWindowsFs,
  waitSync
}
