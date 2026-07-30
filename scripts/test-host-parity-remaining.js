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
const {
  composeEntryCheckBlock,
  evaluateGrokHostParity,
  formatGrokTurnChecklistMarkdown
} = require('./lib/host-parity-scorecard.js')

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

// Compose entry check + HostParity public/source surface.
// website/ is a maintainer-local optional doc site (see website/README.md);
// clean GitHub Actions checkouts must validate source-contained semantics rather
// than requiring untracked generated website docs to exist.
const block = composeEntryCheckBlock({ project: 'demo', status: 'PASS' })
assert.match(block, /### DevCodex · 入口检查/)
const sitePage = path.join(__dirname, '../website/docs/intro/host-parity-grok.md')
const siteText = readIfExists(sitePage)
const checklistText = formatGrokTurnChecklistMarkdown()
const hostParitySurface = siteText || checklistText
assert.match(hostParitySurface, /HostParity|GrokTurnChecklist/)
assert.match(hostParitySurface, /GrokTurnChecklist/)
assert.match(hostParitySurface, /scan-hygiene|ttfv-first-delivery/)
if (siteText) {
  assert.match(siteText, /devcodex grok/)
  assert.match(siteText, /repairSteps/)
  assert.match(siteText, /Skill 强制包|Skill bundle|Intent → Skill/i)
  assert.match(siteText, /UnalignedLedger|U-A1|未对齐|cannotClaim/i)
} else {
  const websiteReadme = fs.readFileSync(path.join(__dirname, '../website/README.md'), 'utf8')
  assert.match(websiteReadme, /不进入公开 Git 默认跟踪/)
  assert.match(websiteReadme, /website 视为 optional/)
}
assert.ok(fs.existsSync(path.join(__dirname, 'fixtures/host-parity/unaligned-ledger.v1.json')))

// Platform request semantic fixture (source-contained for clean checkout / CI)
const platformReq = path.join(__dirname, 'fixtures/host-parity/platform-capability-request-xai.md')
assert.ok(fs.existsSync(platformReq), 'source-contained platform capability request fixture must exist')
assert.match(fs.readFileSync(platformReq, 'utf8'), /P-GROK-1/)

// SessionStart stamp
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-parity-remain-'))
const sessionStart = path.join(__dirname, '../grok/plugins/devcodex-workspace/hooks/session-start.cjs')
const stamp = spawnSync(process.execPath, [sessionStart], {
  env: { ...process.env, GROK_PLUGIN_DATA: path.join(root, 'pdata'), GROK_SESSION_ID: 'smoke-1' },
  encoding: 'utf8'
})
assert.strictEqual(stamp.status, 0)
assert.ok(fs.existsSync(path.join(root, 'pdata', 'session-stamps', 'smoke-1.json')))

// Portable Grok hook SessionStart must treat session id as an untrusted filename
const portableHook = JSON.parse(fs.readFileSync(path.join(__dirname, '../grok/hooks/devcodex.json'), 'utf8'))
const portableSessionStart = portableHook.hooks.SessionStart[0].hooks[0].command
const portableRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-portable-grok-'))
const hostileStamp = spawnSync(portableSessionStart, {
  shell: true,
  env: { ...process.env, GROK_PLUGIN_DATA: portableRoot, GROK_SESSION_ID: '../escape' },
  encoding: 'utf8'
})
assert.strictEqual(hostileStamp.status, 0)
const portableStampDir = path.join(portableRoot, 'devcodex-grok-session-stamps')
const portableFiles = fs.readdirSync(portableStampDir)
assert.ok(portableFiles.length >= 1)
assert.strictEqual(fs.existsSync(path.join(portableRoot, 'escape.json')), false)
for (const file of portableFiles) {
  const target = path.resolve(portableStampDir, file)
  const rel = path.relative(portableStampDir, target)
  assert.ok(rel && !rel.startsWith('..') && !path.isAbsolute(rel), `portable stamp escaped: ${target}`)
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

// Optional maintainer website surfaces.
const philosophy = path.join(__dirname, '../website/docs/intro/philosophy.md')
const philosophyText = readIfExists(philosophy)
if (philosophyText) {
  assert.match(philosophyText, /宿主诚实分列（Auto）/)
  assert.match(philosophyText, /Grok Build/)
}

const rspress = readIfExists(path.join(__dirname, '../website/rspress.config.ts'))
if (rspress) {
  assert.match(rspress, /host-parity-grok/)
}

console.log('host parity remaining deliverables smoke passed')
