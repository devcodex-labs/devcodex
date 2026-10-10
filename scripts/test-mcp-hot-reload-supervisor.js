'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const readline = require('readline')
const { spawn } = require('child_process')
const {
  collectPagedList,
  validLiveSourceRoot
} = require('../mcp/hot-reload-supervisor.cjs')

const ROOT = path.resolve(__dirname, '..')

function workerSource (version, toolName = 'fixture_version') {
  return `'use strict'
const readline = require('readline')
const tool = ${JSON.stringify(toolName)}
const version = ${JSON.stringify(version)}
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line)
  if (request.id === undefined) return
  let result
  if (request.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version } }
  else if (request.method === 'tools/list') result = { tools: [{ name: tool, description: 'stable contract', inputSchema: { type: 'object' } }] }
  else if (request.method === 'tools/call') result = { content: [{ type: 'text', text: JSON.stringify({ version, pid: process.pid }) }] }
  else result = {}
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n')
})
`
}

function callClient (child, onMessage = null, diagnosticContext = () => ({})) {
  const pending = new Map()
  readline.createInterface({ input: child.stdout }).on('line', line => {
    const message = JSON.parse(line)
    if (onMessage) onMessage(message)
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    waiter(message)
  })
  let id = 0
  return (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id
    const timer = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error(`timeout: ${method}; requestId=${requestId}; childPid=${child.pid}; childExitCode=${child.exitCode}; context=${JSON.stringify(diagnosticContext())}`))
    }, 5000)
    pending.set(requestId, message => {
      clearTimeout(timer)
      resolve(message)
    })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params })}\n`)
  })
}

function toolValue (response) {
  assert(!response.error, JSON.stringify(response.error))
  return JSON.parse(response.result.content[0].text)
}

async function waitForVersion (call, expected) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const value = toolValue(await call('tools/call', { name: 'fixture_version', arguments: {} }))
    if (value.version === expected) return value
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`hot reload did not reach ${expected}`)
}

async function main () {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-mcp-hot-reload-'))
  const baseRoot = path.join(tempRoot, 'managed')
  const sourceRoot = path.join(tempRoot, 'source')
  const mcpRoot = path.join(sourceRoot, 'mcp')
  let child
  try {
    fs.mkdirSync(baseRoot, { recursive: true })
    fs.mkdirSync(path.join(sourceRoot, '.git'), { recursive: true })
    fs.mkdirSync(mcpRoot, { recursive: true })
    fs.mkdirSync(path.join(sourceRoot, 'hooks', '_runtime'), { recursive: true })
    fs.copyFileSync(path.join(ROOT, 'mcp', 'stdio-jsonrpc.cjs'), path.join(mcpRoot, 'stdio-jsonrpc.cjs'))
    fs.copyFileSync(path.join(ROOT, 'hooks', '_runtime', 'stdio-bounds.cjs'), path.join(sourceRoot, 'hooks', '_runtime', 'stdio-bounds.cjs'))
    fs.writeFileSync(path.join(sourceRoot, 'package.json'), '{"name":"devcodex","version":"0.0.0"}\n')
    const worker = path.join(mcpRoot, 'profile-server.js')
    fs.writeFileSync(worker, workerSource('v1'))
    assert.strictEqual(validLiveSourceRoot(sourceRoot, 'profile'), true)
    fs.rmSync(path.join(sourceRoot, '.git'), { recursive: true, force: true })
    fs.writeFileSync(path.join(sourceRoot, '.git'), 'gitdir: ../.git/worktrees/fixture\n')
    assert.strictEqual(validLiveSourceRoot(sourceRoot, 'profile'), true)
    const supervisor = path.join(baseRoot, 'mcp-hot-reload-supervisor.cjs')
    fs.copyFileSync(path.join(ROOT, 'mcp', 'hot-reload-supervisor.cjs'), supervisor)
    fs.writeFileSync(path.join(baseRoot, 'global-host-receipt.json'), `${JSON.stringify({
      schemaVersion: 'GlobalHostConfigReceiptV1',
      result: 'committed',
      runtimeRoot: path.join(baseRoot, 'unused-runtime'),
      runtimeGeneration: { generationId: 'fixture' },
      runtimeSource: {
        schemaVersion: 'McpRuntimeSourceV1',
        mode: 'live-source-checkout',
        sourceRoot
      },
      updatedAt: new Date().toISOString()
    })}\n`)

    let pagingCalls = 0
    await assert.rejects(
      () => collectPagedList({
        async exchange () {
          pagingCalls += 1
          return { result: { tools: [], nextCursor: 'same-cursor' } }
        }
      }, 'tools/list', 'tools'),
      /MCP_SUPERVISOR_PAGING_CURSOR_LOOP/
    )
    assert.strictEqual(pagingCalls, 2)

    const diagnostics = []
    child = spawn(process.execPath, [supervisor, 'profile', tempRoot], {
      cwd: tempRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    child.stderr.on('data', chunk => diagnostics.push(String(chunk)))
    const observedMessages = []
    let phase = 'initialize'
    const call = callClient(child, message => observedMessages.push(message), () => ({
      phase,
      diagnostics: diagnostics.join('').slice(-4000),
      lastResponseIds: observedMessages.slice(-5).map(message => message.id)
    }))
    child.stdin.write('42\n')
    const invalidDeadline = Date.now() + 5000
    while (
      Date.now() < invalidDeadline &&
      !observedMessages.some(message => message?.id === null && message?.error?.code === -32600)
    ) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert(
      observedMessages.some(message => message?.id === null && message?.error?.code === -32600),
      'supervisor must return JSON-RPC -32600 for parsed non-object frames'
    )
    const initialized = await call('initialize', { protocolVersion: '2024-11-05', capabilities: {} })
    assert(initialized.result)
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`)
    phase = 'initial-worker-call'
    const first = toolValue(await call('tools/call', { name: 'fixture_version', arguments: {} }))
    assert.strictEqual(first.version, 'v1')

    fs.writeFileSync(worker, workerSource('v2'))
    phase = 'implementation-hot-reload'
    const second = await waitForVersion(call, 'v2')
    assert.notStrictEqual(second.pid, first.pid, 'worker PID must change while supervisor connection stays open')

    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 999, method: 'tools/call', params: { value: 'x'.repeat(4 * 1024 * 1024) } })}\n`)
    const oversizedDeadline = Date.now() + 2000
    while (!observedMessages.some(message => message.error?.data?.errorCode === 'MCP_STDIO_FRAME_TOO_LARGE') && Date.now() < oversizedDeadline) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert(observedMessages.some(message => message.error?.data?.errorCode === 'MCP_STDIO_FRAME_TOO_LARGE'), 'oversize must fail immediately')
    const nearLimitRequest = { jsonrpc: '2.0', id: 1000, method: 'tools/call', params: { value: '' } }
    nearLimitRequest.params.value = 'x'.repeat(4 * 1024 * 1024 - Buffer.byteLength(JSON.stringify(nearLimitRequest)) - 1)
    child.stdin.write(`${JSON.stringify(nearLimitRequest)}\n`)
    const forwardedDeadline = Date.now() + 2000
    while (!observedMessages.some(message => message.id === 1000) && Date.now() < forwardedDeadline) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.strictEqual(observedMessages.find(message => message.id === 1000)?.error?.data?.errorCode, 'MCP_STDIO_FRAME_TOO_LARGE', 'internal id expansion must not produce a worker timeout')
    phase = 'after-frame-rejection'
    assert.strictEqual(toolValue(await call('tools/call')).version, 'v2')
    process.kill(second.pid)
    await new Promise(resolve => setTimeout(resolve, 100))
    phase = 'same-contract-crash-recovery'
    const restarted = toolValue(await call('tools/call'))
    assert.strictEqual(restarted.version, 'v2', 'same contract crash recovery must work')

    fs.writeFileSync(worker, workerSource('v3', 'changed_schema'))
    await new Promise(resolve => setTimeout(resolve, 150))
    phase = 'changed-contract-hot-reload'
    const afterSchemaChange = toolValue(await call('tools/call', { name: 'fixture_version', arguments: {} }))
    assert.strictEqual(afterSchemaChange.version, 'v2', 'schema change must keep the compatible worker serving')
    await new Promise(resolve => setTimeout(resolve, 50))
    const diagnosticText = diagnostics.join('')
    assert.match(diagnosticText, /"status":"switched"/)
    assert.match(diagnosticText, /"status":"restart-required"/)

    process.kill(restarted.pid)
    await new Promise(resolve => setTimeout(resolve, 100))
    phase = 'changed-contract-crash-recovery'
    const incompatibleRestart = await call('tools/call')
    assert.strictEqual(incompatibleRestart.error?.data?.errorCode, 'MCP_SCHEMA_RESTART_REQUIRED')
    assert.strictEqual((await call('tools/list')).error?.data?.errorCode, 'MCP_SCHEMA_RESTART_REQUIRED', 'rejected crash worker cannot serve the changed contract')

    console.log(JSON.stringify({
      schemaVersion: 'McpHotReloadProbeV1',
      connectionPid: child.pid,
      oldWorkerPid: first.pid,
      newWorkerPid: second.pid,
      implementationHotReload: 'PASS',
      schemaChangeFallback: 'PASS',
      result: 'PASS'
    }))
  } finally {
    if (child && child.exitCode === null) {
      child.stdin.end()
      await new Promise(resolve => child.once('exit', resolve))
    }
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`)
    process.exitCode = 1
  })
}

module.exports = { main }
