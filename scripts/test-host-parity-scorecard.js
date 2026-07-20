#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  evaluateGrokHostParity,
  composeEntryCheckBlock,
  entryCheckAssistSuffix,
  composePc4Line
} = require('./lib/host-parity-scorecard.js')
const { adaptHostOutput } = require('../hooks/_runtime/lifecycle-host-adapters.cjs')
const { buildLifecyclePayloadUtils } = require('../hooks/_runtime/lifecycle-payload-utils.cjs')

// --- scorecard pure helpers ---
const block = composeEntryCheckBlock({ project: 'demo', status: 'PASS', nextStep: 'go' })
assert.match(block, /### DevCodex · 入口检查/)
assert.match(block, /`PASS` · `demo`/)
assert.match(block, /PC0/)
assert.match(block, /PC4 \[UNVERIFIED\] ENV_MODE unknown/)
assert.match(composeEntryCheckBlock({ project: 'demo', envMode: 'dev' }), /PC4 \[UNVERIFIED\] dev 模式/)
assert.match(composeEntryCheckBlock({ project: 'demo', envMode: 'prod' }), /PC4 \[N\/A\] prod 模式/)
assert.match(composePc4Line({ envMode: 'unexpected' }), /ENV_MODE unknown/)
assert.match(entryCheckAssistSuffix({ project: 'x' }), /S07 assist/)

// Workspace-like layout for hardReady
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-host-parity-'))
fs.mkdirSync(path.join(root, '.codex', 'hooks', '_runtime'), { recursive: true })
fs.writeFileSync(path.join(root, 'AGENTS.md'), '# kernel\n')
const adapterSrc = fs.readFileSync(path.join(__dirname, '../hooks/_runtime/lifecycle-host-adapters.cjs'), 'utf8')
const bootstrapSrc = fs.readFileSync(path.join(__dirname, '../hooks/_runtime/lifecycle-bootstrap-state.cjs'), 'utf8')
fs.writeFileSync(path.join(root, '.codex', 'hooks', '_runtime', 'lifecycle-host-adapters.cjs'), adapterSrc)
fs.writeFileSync(path.join(root, '.codex', 'hooks', '_runtime', 'lifecycle-bootstrap-state.cjs'), bootstrapSrc)
fs.writeFileSync(path.join(root, '.codex', 'hooks', '_runtime', 'lifecycle.cjs'), 'module.exports={}\n')

const ready = evaluateGrokHostParity({
  cwd: root,
  hostRoot: root,
  hasAgentsMd: true,
  hasCodexLifecycle: true,
  hasGrokWorkspacePlugin: true,
  hasGrokPluginRegistration: true,
  instructionProjection: {
    grokPlugin: {
      installed: true,
      registrationCurrent: true,
      root: path.join(root, '.grok', 'devcodex', 'plugins', 'devcodex-workspace')
    }
  }
})
assert.strictEqual(ready.hardReady, true)
assert.strictEqual(ready.tier, 'full-capable')
assert.ok(ready.checks.denyAdapterContract)
assert.ok(ready.checks.pathObservableCapability)
assert.ok(Array.isArray(ready.cannotClaim) && ready.cannotClaim.length >= 3)

const partial = evaluateGrokHostParity({
  cwd: root,
  hostRoot: root,
  hasAgentsMd: false,
  hasCodexLifecycle: false,
  hasGrokWorkspacePlugin: false,
  hasGrokPluginRegistration: false
})
assert.strictEqual(partial.hardReady, false)
assert.strictEqual(partial.tier, 'partial')

// Smoke: deny path used by PreToolUse
const deny = adaptHostOutput('grok', 'PreToolUse', {
  hookSpecificOutput: {
    permissionDecision: 'deny',
    permissionDecisionReason: 'dangerous-command'
  }
})
assert.deepStrictEqual(deny, { decision: 'deny', reason: 'dangerous-command' })

// W8: extra field names for assistant text
const payloadApi = buildLifecyclePayloadUtils({
  fs,
  path,
  payloadPreviewLimit: 2000,
  transcriptTailLimit: 2000,
  safeJsonParse: (t) => { try { return JSON.parse(t) } catch { return null } },
  normalizeText: (s) => String(s || '')
})
const hit = payloadApi.getVisibleReplyEvidence({
  finalMessage: '### DevCodex · 入口检查\n`PASS` · `p`'
})
assert.strictEqual(hit.observed, true)
assert.strictEqual(hit.source, 'finalMessage')

const passive = adaptHostOutput('grok', 'Stop', { decision: 'block', reason: 'x' })
assert.strictEqual(passive.continue, true)
assert.strictEqual(Object.prototype.hasOwnProperty.call(passive, 'decision'), false)

// SessionStart stamp script exists and exits 0
const sessionStart = path.join(__dirname, '../grok/plugins/devcodex-workspace/hooks/session-start.cjs')
assert.ok(fs.existsSync(sessionStart))
const { spawnSync } = require('child_process')
const stampRun = spawnSync(process.execPath, [sessionStart], {
  env: { ...process.env, GROK_PLUGIN_DATA: path.join(root, 'plugin-data'), GROK_SESSION_ID: 'test-session' },
  encoding: 'utf8'
})
assert.strictEqual(stampRun.status, 0)
assert.ok(fs.existsSync(path.join(root, 'plugin-data', 'session-stamps', 'test-session.json')))

console.log('host parity scorecard + smoke tests passed')
