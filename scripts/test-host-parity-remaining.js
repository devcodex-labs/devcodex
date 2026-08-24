#!/usr/bin/env node
'use strict'

/**
 * Remaining HostParity deliverables smoke:
 * - cross-host hard-block matrix not weakened
 * - gemini/grok deny shapes
 * - SessionStart stamp
 * - entry check compose
 * - lifecycle PreToolUse deny path via host adapter (fixture)
 */

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { adaptHostOutput, runHostAdapter } = require('../hooks/_runtime/lifecycle-host-adapters.cjs')
const { buildLifecycleHookOutput } = require('../hooks/_runtime/lifecycle-hook-output.cjs')
const { runSessionStart } = require('../grok/plugins/devcodex-workspace/hooks/session-start.cjs')
const {
  composeEntryCheckBlock,
  evaluateGrokHostParity,
  formatGrokTurnChecklistMarkdown
} = require('./lib/host-parity-scorecard.js')

const tempRoots = []
function makeTempRoot(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempRoots.push(root)
  return root
}
function cleanupTempFixtures() {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true })
}
process.once('exit', cleanupTempFixtures)

const hookOut = buildLifecycleHookOutput({ env: {}, enforcementMode: 'safety-only' })

// Cross-host: Codex/Claude not weakened
assert.strictEqual(hookOut.eventSupportsHardBlock('codex', 'UserPromptSubmit'), true)
assert.strictEqual(hookOut.eventSupportsHardBlock('codex', 'PreToolUse'), true)
assert.strictEqual(hookOut.eventSupportsHardBlock('codex', 'Stop'), true)
assert.strictEqual(hookOut.eventSupportsHardBlock('claude', 'UserPromptSubmit'), true)
assert.strictEqual(hookOut.eventSupportsHardBlock('claude', 'Stop'), true)
assert.strictEqual(hookOut.eventSupportsHardBlock('claude', 'PreToolUse'), true)
// Grok: PreTool + conditional Stop; UPS remains non-hard
assert.strictEqual(hookOut.eventSupportsHardBlock('grok', 'PreToolUse'), true)
assert.strictEqual(hookOut.eventSupportsHardBlock('grok', 'UserPromptSubmit'), false)
assert.strictEqual(hookOut.eventSupportsHardBlock('grok', 'Stop'), true)
// Copilot / instruction-fallback
assert.strictEqual(hookOut.eventSupportsHardBlock('copilot', 'PreToolUse'), true)
assert.strictEqual(hookOut.eventSupportsHardBlock('jetbrains-copilot', 'PreToolUse'), false)

// Gemini adapter still converts Claude permission shape
const geminiDeny = adaptHostOutput('gemini', 'BeforeTool', {
  hookSpecificOutput: {
    permissionDecision: 'deny',
    permissionDecisionReason: 'gemini-danger'
  }
})
assert.strictEqual(geminiDeny.decision, 'deny')
assert.strictEqual(geminiDeny.reason, 'gemini-danger')

// Grok deny official shape
const grokDeny = adaptHostOutput('grok', 'PreToolUse', {
  hookSpecificOutput: {
    permissionDecision: 'deny',
    permissionDecisionReason: 'dangerous-command'
  }
})
assert.deepStrictEqual(grokDeny, { decision: 'deny', reason: 'dangerous-command' })

// Codex path through adaptHostOutput is uncommon; ensure non-grok non-gemini does not strip to only decision
const codexOut = adaptHostOutput('codex', 'PreToolUse', {
  continue: true,
  hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'c' }
})
assert.strictEqual(codexOut.hookSpecificOutput.permissionDecision, 'deny')

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
}

// Compose entry check + source-contained HostParity surface. Narrative Markdown
// is intentionally not a JavaScript validation dependency.
const block = composeEntryCheckBlock({ project: 'demo', status: 'PASS' })
assert.match(block, /### DevCodex · 入口检查/)
const checklistText = formatGrokTurnChecklistMarkdown()
const hostParitySurface = checklistText
assert.match(hostParitySurface, /HostParity|GrokTurnChecklist/)
assert.match(hostParitySurface, /GrokTurnChecklist/)
assert.match(hostParitySurface, /scan-hygiene|ttfv-first-delivery/)
const grokS15Source = fs.readFileSync(path.join(__dirname, 'probe-skill-route-s15-grok.js'), 'utf8')
assert.doesNotMatch(
  grokS15Source,
  /git['"],\s*\[['"]rev-parse['"],\s*['"]HEAD['"]\]/,
  'installed Grok S15 must not require its npm package root to be a Git checkout'
)
assert.match(grokS15Source, /runtimeDigest/)
assert.match(grokS15Source, /hostAdapterDigest/)
assert.ok(fs.existsSync(path.join(__dirname, 'fixtures/host-parity/unaligned-ledger.v1.json')))

// Platform request semantic fixture (source-contained for clean checkout / CI)
const platformReq = path.join(__dirname, 'fixtures/host-parity/platform-capability-request-xai.md')
assert.ok(fs.existsSync(platformReq), 'source-contained platform capability request fixture must exist')
assert.match(fs.readFileSync(platformReq, 'utf8'), /P-GROK-1/)

// SessionStart uses a fixed diagnostic observation ring rather than one owner directory per session.
const root = makeTempRoot('devcodex-parity-remain-')
const sessionStart = path.join(__dirname, '../grok/plugins/devcodex-workspace/hooks/session-start.cjs')
const stamp = spawnSync(process.execPath, [sessionStart], {
  env: { ...process.env, GROK_PLUGIN_DATA: path.join(root, 'pdata'), GROK_SESSION_ID: 'smoke-1' },
  encoding: 'utf8'
})
assert.strictEqual(stamp.status, 0)
const privateSessionRoot = path.join(root, 'pdata', 'private-sessions')
let privateSessionFiles = fs.readdirSync(privateSessionRoot)
assert.strictEqual(privateSessionFiles.length, 1)
assert.match(privateSessionFiles[0], /^slot-(?:0\d|1[0-5])\.json$/)
assert.strictEqual(
  JSON.parse(fs.readFileSync(path.join(privateSessionRoot, privateSessionFiles[0]), 'utf8')).schemaVersion,
  'GrokSessionPrivateObservationV2'
)
for (let index = 0; index < 100; index += 1) {
  runSessionStart({
    env: {
      ...process.env,
      GROK_PLUGIN_DATA: path.join(root, 'pdata'),
      GROK_SESSION_ID: `bounded-session-${index}`
    },
    nonce: `bounded-nonce-${index}`,
    ownerToken: `bounded-owner-token-${index}`,
    nowMs: 1000 + index
  })
}
privateSessionFiles = fs.readdirSync(privateSessionRoot)
assert(privateSessionFiles.length > 1)
assert(privateSessionFiles.length <= 16)
assert(privateSessionFiles.every(file => /^slot-(?:0\d|1[0-5])\.json$/.test(file)))

const failureRoot = makeTempRoot('devcodex-parity-session-failure-')
const renameFailureFs = new Proxy(fs, {
  get(target, property) {
    if (property === 'renameSync') {
      return (source, destination) => {
        if (String(source).endsWith('.next.tmp')) {
          const error = new Error('injected session observation rename failure')
          error.code = 'EPERM'
          throw error
        }
        return target.renameSync(source, destination)
      }
    }
    const value = target[property]
    return typeof value === 'function' ? value.bind(target) : value
  }
})
assert.throws(() => runSessionStart({
  fs: renameFailureFs,
  env: { ...process.env, GROK_PLUGIN_DATA: failureRoot, GROK_SESSION_ID: 'failure-session' },
  nonce: 'failure-nonce',
  ownerToken: 'failure-owner-token',
  nowMs: 2000
}), error => error?.code === 'EPERM')
assert.deepStrictEqual(fs.readdirSync(path.join(failureRoot, 'private-sessions')), [])

// Portable Grok hook SessionStart must treat session id as an untrusted filename
const portableHook = JSON.parse(fs.readFileSync(path.join(__dirname, '../grok/hooks/devcodex.json'), 'utf8'))
const portableSessionStart = portableHook.hooks.SessionStart[0].hooks[0].command
const portableRoot = makeTempRoot('devcodex-portable-grok-')
const hostileStamp = spawnSync(portableSessionStart, {
  shell: true,
  env: {
    ...process.env,
    GROK_PLUGIN_DATA: portableRoot,
    GROK_PLUGIN_ROOT: path.join(__dirname, '../grok/plugins/devcodex-workspace'),
    GROK_SESSION_ID: '../escape'
  },
  encoding: 'utf8'
})
assert.strictEqual(hostileStamp.status, 0)
const portableStampDir = path.join(portableRoot, 'private-sessions')
const portableFiles = fs.readdirSync(portableStampDir)
assert.strictEqual(portableFiles.length, 1)
assert.strictEqual(fs.existsSync(path.join(portableRoot, 'escape.json')), false)
for (const file of portableFiles) {
  const target = path.resolve(portableStampDir, file)
  const rel = path.relative(portableStampDir, target)
  assert.ok(rel && !rel.startsWith('..') && !path.isAbsolute(rel), `portable observation escaped: ${target}`)
  assert.match(file, /^slot-(?:0\d|1[0-5])\.json$/)
  const record = JSON.parse(fs.readFileSync(target, 'utf8'))
  assert.strictEqual(record.schemaVersion, 'GrokSessionPrivateObservationV2')
}

// Scorecard against real workspace root if present
const workspaceRoot = path.resolve(__dirname, '../..')
if (fs.existsSync(path.join(workspaceRoot, 'AGENTS.md'))) {
  const card = evaluateGrokHostParity({
    cwd: workspaceRoot,
    hostRoot: workspaceRoot
  })
  assert.ok(card.schemaVersion === 'HostParityScorecardV1')
  assert.ok(['full-capable', 'partial'].includes(card.tier))
}

const rspress = readIfExists(path.join(__dirname, '../website/rspress.config.ts'))
if (rspress) {
  assert.match(rspress, /host-parity-grok/)
}

cleanupTempFixtures()
assert.ok(tempRoots.every(root => !fs.existsSync(root)), 'host parity temporary fixtures must be removed before success')
console.log('host parity remaining deliverables smoke + temp cleanup passed')
