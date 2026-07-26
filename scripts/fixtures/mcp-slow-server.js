#!/usr/bin/env node
'use strict'

/**
 * Test-only MCP stdio server: tools/call can delay or hang for deadline probes.
 * Never wire this into user .mcp.json.
 */

function send (id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}

function dispatch (method, params, id) {
  if (method === 'initialize') {
    send(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'mcp-slow-fixture', version: '0.0.0' }
    })
    return
  }
  if (method === 'tools/list') {
    send(id, {
      tools: [{
        name: 'slow_tool',
        description: 'test delay',
        inputSchema: { type: 'object', properties: { delayMs: { type: 'number' }, never: { type: 'boolean' } } }
      }]
    })
    return
  }
  if (method === 'tools/call') {
    const name = params?.name
    const args = params?.arguments || {}
    if (name !== 'slow_tool') {
      send(id, { content: [{ type: 'text', text: 'unknown' }], isError: true })
      return
    }
    if (args.never === true) {
      // hang until killed by parent timeout
      return
    }
    const delay = Math.max(0, Number(args.delayMs) || 0)
    setTimeout(() => {
      send(id, { content: [{ type: 'text', text: JSON.stringify({ ok: true, delay }) }] })
    }, delay)
    return
  }
  process.stdout.write(JSON.stringify({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: 'Method not found' }
  }) + '\n')
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  const lines = buffer.split('\n')
  buffer = lines.pop()
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let req
    try { req = JSON.parse(trimmed) } catch {
      continue
    }
    dispatch(req.method, req.params, req.id)
  }
})
