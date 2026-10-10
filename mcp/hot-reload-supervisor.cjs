'use strict'

const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { spawn } = require('child_process')

const RECEIPT_SCHEMA = 'GlobalHostConfigReceiptV1'
const ROLES = new Set(['memory', 'profile'])
const REQUEST_TIMEOUT_MS = 30_000
const RELOAD_SETTLE_MS = 80
const MAX_PAGED_LIST_PAGES = 128
const MAX_FRAME_BYTES = 4 * 1024 * 1024

function supervisorError (code, detail) {
  const error = new Error(`${code}: ${detail}`)
  error.code = code
  return error
}

function stableJson (value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function isInside (root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function readJson (file, label) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required')
    return value
  } catch (error) {
    throw supervisorError('MCP_SUPERVISOR_METADATA_INVALID', `${label}: ${error.message}`)
  }
}

function validLiveSourceRoot (candidate, role) {
  if (!candidate) return false
  const root = path.resolve(candidate)
  try {
    const pkg = readJson(path.join(root, 'package.json'), 'live source package')
    const gitStat = fs.statSync(path.join(root, '.git'))
    return pkg.name === 'devcodex' &&
      (gitStat.isDirectory() || gitStat.isFile()) &&
      fs.statSync(path.join(root, 'mcp', `${role}-server.js`)).isFile()
  } catch {
    return false
  }
}

function resolveWorkerTarget (baseRoot, role) {
  const receiptFile = path.join(baseRoot, 'global-host-receipt.json')
  const receipt = readJson(receiptFile, 'global host receipt')
  if (receipt.schemaVersion !== RECEIPT_SCHEMA || receipt.result !== 'committed') {
    throw supervisorError('MCP_SUPERVISOR_RECEIPT_MISMATCH', receiptFile)
  }
  const liveRoot = receipt.runtimeSource?.mode === 'live-source-checkout' &&
    validLiveSourceRoot(receipt.runtimeSource.sourceRoot, role)
    ? path.resolve(receipt.runtimeSource.sourceRoot)
    : null
  const runtimeRoot = path.resolve(String(receipt.runtimeRoot || ''))
  if (!liveRoot && (!receipt.runtimeRoot || !isInside(baseRoot, runtimeRoot) || runtimeRoot === path.resolve(baseRoot))) {
    throw supervisorError('MCP_SUPERVISOR_RUNTIME_ESCAPE', runtimeRoot || '(missing)')
  }
  const root = liveRoot || runtimeRoot
  const server = path.join(root, 'mcp', `${role}-server.js`)
  if (!fs.statSync(server).isFile()) throw supervisorError('MCP_SUPERVISOR_WORKER_MISSING', server)
  return {
    receiptFile,
    receiptUpdatedAt: String(receipt.updatedAt || ''),
    generationId: String(receipt.runtimeGeneration?.generationId || ''),
    mode: liveRoot ? 'live-source-checkout' : 'immutable-generation',
    root,
    server
  }
}

function watchTree (root, onChange) {
  const watchers = []
  const attach = (directory, recursive) => {
    try {
      const watcher = fs.watch(directory, { recursive }, () => onChange())
      watcher.on('error', () => onChange())
      watchers.push(watcher)
      return true
    } catch {
      return false
    }
  }
  if (attach(root, true)) return watchers
  const visit = directory => {
    attach(directory, false)
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(path.join(directory, entry.name))
    }
  }
  visit(root)
  return watchers
}

function watchReceipt (file, onChange) {
  const listener = (current, previous) => {
    if (current.mtimeMs !== previous.mtimeMs || current.size !== previous.size) onChange()
  }
  fs.watchFile(file, { persistent: false, interval: 500 }, listener)
  return { close: () => fs.unwatchFile(file, listener) }
}

function createWorker (server, inputRoot) {
  const child = spawn(process.execPath, [server, inputRoot], {
    cwd: process.cwd(),
    env: { ...process.env, DEVCODEX_MCP_SUPERVISED: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  const pending = new Map()
  let sequence = 0
  let exited = false
  readline.createInterface({ input: child.stdout }).on('line', line => {
    let message
    try { message = JSON.parse(line) } catch { return }
    if (!message || typeof message !== 'object' || Array.isArray(message)) return
    const waiter = pending.get(message.id)
    if (waiter) {
      pending.delete(message.id)
      clearTimeout(waiter.timer)
      waiter.resolve(message)
    }
  })
  child.stderr.on('data', chunk => process.stderr.write(chunk))
  child.once('exit', (code, signal) => {
    exited = true
    const error = supervisorError('MCP_SUPERVISOR_WORKER_EXITED', `${server}: code=${code}; signal=${signal || 'none'}`)
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    pending.clear()
  })

  function exchange (method, params) {
    if (exited) return Promise.reject(supervisorError('MCP_SUPERVISOR_WORKER_UNAVAILABLE', server))
    const id = `devcodex-supervisor-${process.pid}-${++sequence}`
    const frame = JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })
    // Internal ids can make an otherwise bounded client frame exceed the worker limit.
    if (Buffer.byteLength(frame, 'utf8') > MAX_FRAME_BYTES) {
      return Promise.reject(supervisorError('MCP_STDIO_FRAME_TOO_LARGE', 'forwarded request exceeds the worker frame limit'))
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(supervisorError('MCP_SUPERVISOR_WORKER_TIMEOUT', `${method}: ${REQUEST_TIMEOUT_MS}ms`))
      }, REQUEST_TIMEOUT_MS)
      timer.unref?.()
      pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${frame}\n`)
    })
  }

  return {
    child,
    server,
    exchange,
    notify (method, params) {
      if (!exited) child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })}\n`)
    },
    async close () {
      if (exited) return
      child.stdin.end()
      await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        new Promise(resolve => setTimeout(() => {
          if (!exited) child.kill()
          resolve()
        }, 750))
      ])
    },
    get exited () { return exited }
  }
}

async function collectPagedList (worker, method, field) {
  const values = []
  let cursor
  const seenCursors = new Set()
  let pages = 0
  do {
    pages += 1
    if (pages > MAX_PAGED_LIST_PAGES) {
      throw supervisorError('MCP_SUPERVISOR_PAGING_LIMIT_EXCEEDED', `${method}: exceeded ${MAX_PAGED_LIST_PAGES} pages`)
    }
    const response = await worker.exchange(method, cursor ? { cursor } : {})
    if (response.error) throw supervisorError('MCP_SUPERVISOR_CONTRACT_READ_FAILED', `${method}: ${response.error.message}`)
    values.push(...(Array.isArray(response.result?.[field]) ? response.result[field] : []))
    const nextCursor = response.result?.nextCursor || null
    if (nextCursor) {
      if (seenCursors.has(nextCursor)) {
        throw supervisorError('MCP_SUPERVISOR_PAGING_CURSOR_LOOP', `${method}: repeated nextCursor`)
      }
      seenCursors.add(nextCursor)
    }
    cursor = nextCursor
  } while (cursor)
  return values.sort((left, right) => String(left?.name || '').localeCompare(String(right?.name || '')))
}

async function readContract (worker, initializeResult) {
  const contract = {
    protocolVersion: initializeResult?.protocolVersion || null,
    capabilities: initializeResult?.capabilities || {},
    tools: await collectPagedList(worker, 'tools/list', 'tools')
  }
  if (initializeResult?.capabilities?.prompts) {
    contract.prompts = await collectPagedList(worker, 'prompts/list', 'prompts')
  }
  return contract
}

function writeDiagnostic (value) {
  process.stderr.write(`${JSON.stringify(value)}\n`)
}

async function main () {
  const role = String(process.argv[2] || '').trim()
  const inputRoot = String(process.argv[3] || '.').trim() || '.'
  if (!ROLES.has(role)) throw supervisorError('MCP_SUPERVISOR_ROLE_INVALID', role || '(missing)')
  const baseRoot = path.resolve(__dirname)
  let revision = 0
  let settledAt = 0
  let dirty = false
  let current = null
  let currentTarget = null
  let initializeParams = null
  let initializeResult = null
  let negotiatedContract = null
  let initializedParams = null
  let watchers = []

  const markDirty = () => {
    revision += 1
    settledAt = Date.now() + RELOAD_SETTLE_MS
    dirty = true
  }

  function resetWatchers (target) {
    for (const watcher of watchers) watcher.close()
    watchers = []
    watchers.push(watchReceipt(target.receiptFile, markDirty))
    if (target.mode === 'live-source-checkout') {
      for (const relative of ['mcp', 'hooks/_runtime', 'scripts/lib', 'content', 'prompts', 'skills']) {
        const source = path.join(target.root, ...relative.split('/'))
        if (fs.existsSync(source)) watchers.push(...watchTree(source, markDirty))
      }
    }
  }

  async function startCurrent () {
    currentTarget = resolveWorkerTarget(baseRoot, role)
    current = createWorker(currentTarget.server, inputRoot)
    resetWatchers(currentTarget)
    dirty = false
  }

  async function maybeReload () {
    if (!current || current.exited) {
      if (current) await current.close()
      await startCurrent()
      if (initializeParams) {
        try {
          const response = await current.exchange('initialize', initializeParams)
          if (response.error) throw supervisorError('MCP_SUPERVISOR_RESTART_INITIALIZE_FAILED', response.error.message)
          if (initializedParams !== null) current.notify('notifications/initialized', initializedParams)
          const contract = await readContract(current, response.result)
          if (negotiatedContract === null || stableJson(contract) !== negotiatedContract) {
            throw supervisorError('MCP_SCHEMA_RESTART_REQUIRED', 'restarted worker contract differs from the negotiated connection')
          }
          initializeResult = response.result
        } catch (error) {
          await current.close()
          writeDiagnostic({ schemaVersion: 'McpHotReloadEventV1', status: 'restart-required', errorCode: error.code, role, message: error.message })
          throw error
        }
      }
      return
    }
    if (!dirty || !initializeParams) return
    const waitMs = settledAt - Date.now()
    if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs))
    const candidateRevision = revision
    let candidate
    try {
      const target = resolveWorkerTarget(baseRoot, role)
      candidate = createWorker(target.server, inputRoot)
      const initialized = await candidate.exchange('initialize', initializeParams)
      if (initialized.error) throw supervisorError('MCP_SUPERVISOR_CANDIDATE_INITIALIZE_FAILED', initialized.error.message)
      if (initializedParams !== null) candidate.notify('notifications/initialized', initializedParams)
      const candidateContract = await readContract(candidate, initialized.result)
      if (stableJson(candidateContract) !== negotiatedContract) {
        throw supervisorError('MCP_SCHEMA_RESTART_REQUIRED', 'worker tools/prompts contract changed')
      }
      const previous = current
      current = candidate
      currentTarget = target
      initializeResult = initialized.result
      candidate = null
      resetWatchers(target)
      dirty = revision !== candidateRevision
      await previous.close()
      writeDiagnostic({
        schemaVersion: 'McpHotReloadEventV1',
        status: 'switched',
        role,
        worker: currentTarget.server,
        mode: currentTarget.mode
      })
    } catch (error) {
      if (candidate) await candidate.close()
      dirty = revision !== candidateRevision
      writeDiagnostic({
        schemaVersion: 'McpHotReloadEventV1',
        status: error.code === 'MCP_SCHEMA_RESTART_REQUIRED' ? 'restart-required' : 'candidate-rejected',
        errorCode: error.code || 'MCP_HOT_RELOAD_FAILED',
        role,
        message: error.message
      })
    }
  }

  async function handle (message) {
    if (!current) await startCurrent()
    if (message.method !== 'initialize') await maybeReload()
    if (message.id === undefined) {
      if (message.method === 'notifications/initialized') initializedParams = message.params ?? {}
      current.notify(message.method, message.params)
      return
    }
    if (message.method === 'initialize') initializeParams = message.params ?? {}
    const response = await current.exchange(message.method, message.params)
    if (message.method === 'initialize' && !response.error) {
      initializeResult = response.result
      negotiatedContract = stableJson(await readContract(current, initializeResult))
    }
    if (response.error) {
      const error = new Error(response.error.message)
      error.code = response.error.code
      error.data = response.error.data
      throw error
    }
    return response.result
  }

  // The deployed supervisor is a standalone file; read its bounded transport
  // from the receipt-selected runtime rather than a relative checkout path.
  const target = resolveWorkerTarget(baseRoot, role)
  const { createJsonLineServer } = require(path.join(target.root, 'mcp', 'stdio-jsonrpc.cjs'))
  const cleanup = async () => {
    for (const watcher of watchers) watcher.close()
    if (current) await current.close()
  }
  const transport = createJsonLineServer({
    async dispatch (method, params, message) {
      try {
        return await handle(message)
      } catch (error) {
        if (!Number.isInteger(error.code)) {
          error.data = { errorCode: error.code || 'MCP_SUPERVISOR_FAILURE' }
          error.code = -32603
        }
        throw error
      }
    },
    onEnd: cleanup
  })
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      transport.close()
      process.stdin.pause()
      transport.idle().finally(cleanup)
    })
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`)
    process.exitCode = 2
  })
}

module.exports = {
  collectPagedList,
  createWorker,
  readContract,
  resolveWorkerTarget,
  stableJson,
  validLiveSourceRoot
}
