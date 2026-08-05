'use strict'

const {
  STDIO_CHILD_TIMEOUT_MS,
  STDIO_MAX_FRAME_BYTES,
  STDIO_MAX_MESSAGE_BYTES,
  byteLength
} = require('../hooks/_runtime/stdio-bounds.cjs')

const MCP_STDIO_MAX_FRAME_BYTES = STDIO_MAX_FRAME_BYTES
const MCP_STDIO_MAX_MESSAGE_BYTES = STDIO_MAX_MESSAGE_BYTES
const MCP_STDIO_REQUEST_TIMEOUT_MS = STDIO_CHILD_TIMEOUT_MS

const ERROR_CODES = Object.freeze({
  FRAME_TOO_LARGE: 'MCP_STDIO_FRAME_TOO_LARGE',
  MESSAGE_TOO_LARGE: 'MCP_STDIO_MESSAGE_TOO_LARGE',
  REQUEST_TIMEOUT: 'MCP_STDIO_REQUEST_TIMEOUT'
})

function timeoutError(timeoutMs) {
  const error = new Error(`MCP request exceeded the ${timeoutMs}ms transport deadline`)
  error.code = ERROR_CODES.REQUEST_TIMEOUT
  return error
}

function withDeadline(value, timeoutMs) {
  if (!value || typeof value.then !== 'function') return Promise.resolve(value)
  let timer
  return Promise.race([
    value,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(timeoutError(timeoutMs)), timeoutMs)
      timer.unref?.()
    })
  ]).finally(() => clearTimeout(timer))
}

function createJsonLineServer(options = {}) {
  const input = options.input || process.stdin
  const output = options.output || process.stdout
  const dispatch = options.dispatch
  const maxFrameBytes = options.maxFrameBytes || MCP_STDIO_MAX_FRAME_BYTES
  const maxMessageBytes = options.maxMessageBytes || MCP_STDIO_MAX_MESSAGE_BYTES
  const requestTimeoutMs = options.requestTimeoutMs || MCP_STDIO_REQUEST_TIMEOUT_MS
  if (typeof dispatch !== 'function') throw new TypeError('dispatch must be a function')

  let buffer = ''
  let discardingOversizeFrame = false
  let queue = Promise.resolve()
  let closed = false

  function writeEnvelope(envelope) {
    output.write(`${JSON.stringify(envelope)}\n`)
  }

  function sendError(id, code, message, errorCode = null, data = {}) {
    writeEnvelope({
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        ...(errorCode ? { data: { errorCode, ...data } } : {})
      }
    })
  }

  function sendResponse(id, result) {
    const envelope = { jsonrpc: '2.0', id, result }
    if (byteLength(JSON.stringify(envelope)) > maxMessageBytes) {
      sendError(id, -32098, 'MCP response exceeds the configured message limit', ERROR_CODES.MESSAGE_TOO_LARGE, {
        direction: 'response',
        maxMessageBytes
      })
      return
    }
    writeEnvelope(envelope)
  }

  async function handleFrame(frame) {
    const trimmed = frame.trim()
    if (!trimmed) return
    if (byteLength(trimmed) > maxMessageBytes) {
      sendError(null, -32098, 'MCP request exceeds the configured message limit', ERROR_CODES.MESSAGE_TOO_LARGE, {
        direction: 'request',
        maxMessageBytes
      })
      return
    }
    let request
    try {
      request = JSON.parse(trimmed)
    } catch {
      sendError(null, -32700, 'Parse error')
      return
    }
    try {
      const result = await withDeadline(
        Promise.resolve().then(() => dispatch(request.method, request.params)),
        requestTimeoutMs
      )
      if (request.id !== undefined) sendResponse(request.id, result)
    } catch (error) {
      if (request.id !== undefined) {
        const errorCode = error?.code === ERROR_CODES.REQUEST_TIMEOUT ? ERROR_CODES.REQUEST_TIMEOUT : null
        sendError(
          request.id,
          Number.isInteger(error?.code) ? error.code : -32603,
          error?.message || 'Internal error',
          errorCode,
          errorCode ? { requestTimeoutMs } : {}
        )
      }
    }
  }

  function enqueueFrame(frame) {
    queue = queue.then(() => handleFrame(frame), () => handleFrame(frame))
  }

  function onData(chunk) {
    let remaining = String(chunk || '')
    while (remaining) {
      const newline = remaining.indexOf('\n')
      if (discardingOversizeFrame) {
        if (newline === -1) return
        discardingOversizeFrame = false
        remaining = remaining.slice(newline + 1)
        continue
      }
      if (newline !== -1) {
        const frame = buffer + remaining.slice(0, newline)
        buffer = ''
        remaining = remaining.slice(newline + 1)
        if (byteLength(frame) > maxFrameBytes) {
          sendError(null, -32099, 'MCP stdio frame exceeds the configured limit', ERROR_CODES.FRAME_TOO_LARGE, {
            maxFrameBytes
          })
        } else {
          enqueueFrame(frame)
        }
        continue
      }
      if (byteLength(buffer) + byteLength(remaining) > maxFrameBytes) {
        buffer = ''
        discardingOversizeFrame = true
        sendError(null, -32099, 'MCP stdio frame exceeds the configured limit', ERROR_CODES.FRAME_TOO_LARGE, {
          maxFrameBytes
        })
      } else {
        buffer += remaining
      }
      return
    }
  }

  function onEnd() {
    queue.finally(() => options.onEnd?.())
  }

  input.setEncoding?.('utf8')
  input.on('data', onData)
  input.on('end', onEnd)

  return {
    close() {
      if (closed) return
      closed = true
      input.off?.('data', onData)
      input.off?.('end', onEnd)
    },
    idle() {
      return queue
    }
  }
}

module.exports = {
  ERROR_CODES,
  MCP_STDIO_MAX_FRAME_BYTES,
  MCP_STDIO_MAX_MESSAGE_BYTES,
  MCP_STDIO_REQUEST_TIMEOUT_MS,
  createJsonLineServer
}
