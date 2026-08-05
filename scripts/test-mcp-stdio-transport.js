#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { PassThrough } = require('stream')
const {
  ERROR_CODES,
  MCP_STDIO_MAX_FRAME_BYTES,
  MCP_STDIO_MAX_MESSAGE_BYTES,
  MCP_STDIO_REQUEST_TIMEOUT_MS,
  createJsonLineServer
} = require('../mcp/stdio-jsonrpc.cjs')

function harness(options = {}) {
  const input = new PassThrough()
  const output = new PassThrough()
  let text = ''
  output.setEncoding('utf8')
  output.on('data', chunk => { text += chunk })
  const server = createJsonLineServer({ input, output, ...options })
  return {
    input,
    server,
    responses() {
      return text.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
    }
  }
}

async function settle(instance, waitMs = 0) {
  if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs))
  await instance.server.idle()
  await new Promise(resolve => setImmediate(resolve))
}

async function main() {
  assert.strictEqual(MCP_STDIO_MAX_FRAME_BYTES, 4 * 1024 * 1024)
  assert.strictEqual(MCP_STDIO_MAX_MESSAGE_BYTES, 4 * 1024 * 1024)
  assert.strictEqual(MCP_STDIO_REQUEST_TIMEOUT_MS, 30000)
  assert.throws(() => createJsonLineServer({ input: new PassThrough(), output: new PassThrough() }), /dispatch must be a function/)

  const reset = harness({
    maxFrameBytes: 96,
    maxMessageBytes: 512,
    dispatch: method => ({ method })
  })
  reset.input.write('x'.repeat(97))
  reset.input.write(`discarded-rest\n${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })}\n`)
  await settle(reset)
  const resetResponses = reset.responses()
  assert.strictEqual(resetResponses[0].error.data.errorCode, ERROR_CODES.FRAME_TOO_LARGE)
  assert.strictEqual(resetResponses[1].id, 1)
  assert.deepStrictEqual(resetResponses[1].result, { method: 'initialize' })
  reset.server.close()
  reset.server.close()

  const completeOversize = harness({
    maxFrameBytes: 96,
    maxMessageBytes: 512,
    dispatch: () => ({ ok: true })
  })
  completeOversize.input.write(`${'q'.repeat(97)}\n`)
  await settle(completeOversize)
  assert.strictEqual(completeOversize.responses()[0].error.data.errorCode, ERROR_CODES.FRAME_TOO_LARGE)
  completeOversize.server.close()

  const malformed = harness({ dispatch: () => ({ ok: true }) })
  malformed.input.write('{broken json}\n')
  await settle(malformed)
  assert.strictEqual(malformed.responses()[0].error.code, -32700)
  malformed.server.close()

  const notification = harness({ dispatch: () => ({ ignored: true }) })
  notification.input.write(`\n${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
  await settle(notification)
  assert.deepStrictEqual(notification.responses(), [])
  notification.server.close()

  const dispatchError = harness({
    dispatch: () => { throw Object.assign(new Error('bounded failure'), { code: -32010 }) }
  })
  dispatchError.input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/call' })}\n`)
  await settle(dispatchError)
  assert.strictEqual(dispatchError.responses()[0].error.code, -32010)
  assert.strictEqual(dispatchError.responses()[0].error.message, 'bounded failure')
  dispatchError.server.close()

  const requestLimit = harness({
    maxFrameBytes: 512,
    maxMessageBytes: 96,
    dispatch: () => ({ ok: true })
  })
  requestLimit.input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { value: 'y'.repeat(120) } })}\n`)
  await settle(requestLimit)
  assert.strictEqual(requestLimit.responses()[0].error.data.errorCode, ERROR_CODES.MESSAGE_TOO_LARGE)
  assert.strictEqual(requestLimit.responses()[0].error.data.direction, 'request')
  requestLimit.server.close()

  const responseLimit = harness({
    maxFrameBytes: 512,
    maxMessageBytes: 128,
    dispatch: () => ({ value: 'z'.repeat(200) })
  })
  responseLimit.input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call' })}\n`)
  await settle(responseLimit)
  assert.strictEqual(responseLimit.responses()[0].id, 3)
  assert.strictEqual(responseLimit.responses()[0].error.data.errorCode, ERROR_CODES.MESSAGE_TOO_LARGE)
  assert.strictEqual(responseLimit.responses()[0].error.data.direction, 'response')
  responseLimit.server.close()

  const timeout = harness({
    requestTimeoutMs: 15,
    dispatch: () => new Promise(() => {})
  })
  timeout.input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call' })}\n`)
  await settle(timeout, 30)
  assert.strictEqual(timeout.responses()[0].id, 4)
  assert.strictEqual(timeout.responses()[0].error.data.errorCode, ERROR_CODES.REQUEST_TIMEOUT)
  assert.strictEqual(timeout.responses()[0].error.data.requestTimeoutMs, 15)
  timeout.server.close()

  let ended = false
  const endAware = harness({
    dispatch: () => ({ ok: true }),
    onEnd: () => { ended = true }
  })
  endAware.input.end(`${JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'initialize' })}\n`)
  await settle(endAware)
  assert.strictEqual(ended, true)
  assert.strictEqual(endAware.responses()[0].id, 6)
  endAware.server.close()

  console.log('✓ bounded MCP stdio frame/message/reset/timeout tests passed')
}

main().catch(error => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
