#!/usr/bin/env node
'use strict'

const fs = require('fs')
const readline = require('readline')

const plan = JSON.parse(fs.readFileSync(process.env.DEVCODEX_LEGACY_PLAN_FILE, 'utf8'))

function result (id, value) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result: value })}\n`)
}

readline.createInterface({ input: process.stdin }).on('line', line => {
  let request
  try { request = JSON.parse(line) } catch { return }
  if (request.method === 'initialize') {
    result(request.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'devcodex-profile-legacy-fixture', version: '1.16.2' }
    })
    return
  }
  if (request.method === 'tools/list') {
    result(request.id, {
      tools: [{ name: 'profile_context_plan', inputSchema: { type: 'object' } }]
    })
    return
  }
  if (request.method === 'tools/call' && request.params?.name === 'profile_context_plan') {
    result(request.id, {
      content: [{ type: 'text', text: JSON.stringify(plan, null, 2) }]
    })
    return
  }
  result(request.id, { content: [], isError: true })
})
