'use strict'

const { Buffer } = require('buffer')

const STDIO_MAX_FRAME_BYTES = 4 * 1024 * 1024
const STDIO_MAX_MESSAGE_BYTES = 4 * 1024 * 1024
const STDIO_CHILD_TIMEOUT_MS = 30 * 1000

function byteLength(value) {
  return Buffer.byteLength(String(value || ''), 'utf8')
}

function createBoundedTextAccumulator(options = {}) {
  const maxBytes = options.maxBytes || STDIO_MAX_FRAME_BYTES
  let text = ''
  let overflowed = false
  return {
    push(chunk) {
      if (overflowed) return false
      const next = String(chunk || '')
      if (byteLength(text) + byteLength(next) > maxBytes) {
        text = ''
        overflowed = true
        return false
      }
      text += next
      return true
    },
    snapshot() {
      return text
    },
    get overflowed() {
      return overflowed
    },
    maxBytes
  }
}

module.exports = {
  STDIO_CHILD_TIMEOUT_MS,
  STDIO_MAX_FRAME_BYTES,
  STDIO_MAX_MESSAGE_BYTES,
  byteLength,
  createBoundedTextAccumulator
}
