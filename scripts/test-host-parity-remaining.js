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
const { composeEntryCheckBlock } = require('./lib/host-parity-scorecard.js')
const { evaluateGrokHostParity } = require('./lib/host-parity-scorecard.js')

const hookOut = buildLifecycleHookOutput({ env: {}, enforcementMode: 'safety-only' })

// Cross-host: Codex/Claude not weakened
assert.strictEqual(hookOut.eventSupportsHardBlock('codex', 'UserPromptSubmit'), true)
assert.strictEqual(hookOut.eventSupportsHardBlock('codex', 'PreToolUse'), true)
assert.strictEqual(hookOut.eventSupportsHardBlock('codex', 'Stop'), true)
assert.strictEqual(hookOut.eventSupportsHardBlock('claude', 'UserPromptSubmit'), true)
assert.strictEqual(hookOut.eventSupportsHardBlock('claude', 'Stop'), true)
assert.strictEqual(hookOut.eventSupportsHardBlock('claude', 'PreToolUse'), true)
// Grok limited
assert.strictEqual(hookOut.eventSupportsHardBlock('grok', 'PreToolUse'), true)
assert.strictEqual(hookOut.eventSupportsHardBlock('grok', 'UserPromptSubmit'), false)
assert.strictEqual(hookOut.eventSupportsHardBlock('grok', 'Stop'), false)
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

// Compose entry check + website page exists
const block = composeEntryCheckBlock({ project: 'demo', status: 'PASS' })
assert.match(block, /### DevCodex · 入口检查/)
const sitePage = path.join(__dirname, '../website/docs/intro/host-parity-grok.md')
assert.ok(fs.existsSync(sitePage), 'website intro host-parity-grok.md must exist')
const siteText = fs.readFileSync(sitePage, 'utf8')
assert.match(siteText, /devcodex grok/)
assert.match(siteText, /HostParity/)

// Platform req doc (workspace runtime)
const platformReqCandidates = [
  path.join(__dirname, '../../.devcodex/devcodex-v1/requirements/20260720-grok-host-parity-codex/03-平台能力需求-xAI.md'),
  path.join(process.cwd(), '../.devcodex/devcodex-v1/requirements/20260720-grok-host-parity-codex/03-平台能力需求-xAI.md'),
  path.join('E:/Worker/.devcodex/devcodex-v1/requirements/20260720-grok-host-parity-codex/03-平台能力需求-xAI.md')
]
const platformReq = platformReqCandidates.find((p) => fs.existsSync(p))
assert.ok(platformReq, 'platform capability request doc must exist')
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

// philosophy Auto honesty
const philosophy = path.join(__dirname, '../website/docs/intro/philosophy.md')
assert.match(fs.readFileSync(philosophy, 'utf8'), /宿主诚实分列（Auto）/)
assert.match(fs.readFileSync(philosophy, 'utf8'), /Grok Build/)

// rspress sidebar link
const rspress = fs.readFileSync(path.join(__dirname, '../website/rspress.config.ts'), 'utf8')
assert.match(rspress, /host-parity-grok/)

console.log('host parity remaining deliverables smoke passed')
