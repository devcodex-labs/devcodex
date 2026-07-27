'use strict'

/**
 * M0: MCP runtime allowlist closure + tools/call smoke + hang-bound deadline.
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const {
  CLAUDE_MCP_RUNTIME_SCRIPT_DEPS
} = require('../index.js')
const {
  mcpToolCallProbe,
  mcpInitializeProbe
} = require('./lib/global-host-runtime-verifier.js')

function mustIncludeGates () {
  assert.ok(
    CLAUDE_MCP_RUNTIME_SCRIPT_DEPS.includes('scripts/lib/executable-absorption-gates.js'),
    'allowlist must include executable-absorption-gates.js'
  )
  assert.ok(
    CLAUDE_MCP_RUNTIME_SCRIPT_DEPS.includes('scripts/lib/host-parity-scorecard.js'),
    'allowlist must include host-parity-scorecard.js'
  )
}

function closureRequireTree () {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-closure-'))
  const lib = path.join(tmp, 'scripts', 'lib')
  fs.mkdirSync(lib, { recursive: true })
  for (const rel of CLAUDE_MCP_RUNTIME_SCRIPT_DEPS) {
    const src = path.join(ROOT, rel)
    assert.ok(fs.existsSync(src), `source missing: ${rel}`)
    fs.copyFileSync(src, path.join(tmp, ...rel.split('/')))
  }
  // host-parity must load under allowlist-only tree
  const hostParity = path.join(tmp, 'scripts', 'lib', 'host-parity-scorecard.js')
  const ok = spawnSync(process.execPath, ['-e', 'require(process.argv[1]); console.log("OK")', hostParity], {
    encoding: 'utf8',
    windowsHide: true
  })
  assert.strictEqual(ok.status, 0, `host-parity require under allowlist failed: ${ok.stderr}`)
  assert.match(String(ok.stdout), /OK/)

  // negative: remove gates → require fails
  fs.unlinkSync(path.join(tmp, 'scripts', 'lib', 'executable-absorption-gates.js'))
  const bad = spawnSync(process.execPath, ['-e', 'try{require(process.argv[1]);process.exit(0)}catch(e){console.error(e.message);process.exit(2)}', hostParity], {
    encoding: 'utf8',
    windowsHide: true
  })
  assert.strictEqual(bad.status, 2, 'expected require fail without gates')
  assert.match(String(bad.stderr), /executable-absorption-gates/)
}

function hangBound () {
  const fixture = path.join(ROOT, 'scripts', 'fixtures', 'mcp-slow-server.js')
  assert.ok(fs.existsSync(fixture), 'mcp-slow-server fixture missing')
  const r = mcpToolCallProbe(fixture, ROOT, 'slow_tool', { delayMs: 5000 }, {
    timeoutMs: 800,
    spawnSync
  })
  assert.strictEqual(r.passed, false, 'slow tool must fail deadline')
  assert.ok(r.timedOut || r.error === 'ETIMEDOUT' || r.error === 'no-tools-call-response', `expected timeout-ish, got ${JSON.stringify(r)}`)
  assert.ok(r.latencyMs < 4000, `deadline should cut short: ${r.latencyMs}`)
}

function sourcePackageToolSmoke () {
  const mem = path.join(ROOT, 'mcp', 'memory-server.js')
  const prof = path.join(ROOT, 'mcp', 'profile-server.js')
  const memR = mcpToolCallProbe(mem, ROOT, 'memory_status', { agent: 'grok', project: 'devcodex', limit: 2 }, {
    timeoutMs: 8000
  })
  assert.strictEqual(memR.passed, true, `memory smoke failed: ${memR.error} ${memR.textHead}`)
  const profR = mcpToolCallProbe(prof, ROOT, 'profile_compose_entry_check', {
    project: 'devcodex',
    status: 'PASS',
    nextStep: 'test'
  }, { timeoutMs: 8000 })
  assert.strictEqual(profR.passed, true, `profile smoke failed: ${profR.error} ${profR.textHead}`)
  assert.ok(!/executable-absorption-gates/i.test(profR.textHead || ''), 'source profile must not miss gates')
}

function initStillWorks () {
  const r = mcpInitializeProbe(path.join(ROOT, 'mcp', 'memory-server.js'), ROOT, { timeoutMs: 5000 })
  assert.strictEqual(r.passed, true, `initialize failed: ${r.error}`)
}

mustIncludeGates()
closureRequireTree()
hangBound()
sourcePackageToolSmoke()
initStillWorks()
console.log('test-mcp-runtime-closure: PASS')
