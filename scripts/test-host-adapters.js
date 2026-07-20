#!/usr/bin/env node
'use strict'

const assert = require('assert')
const grokHooks = require('../grok/hooks/devcodex.json')
const {
  EVENT_MAP,
  adaptHostOutput,
  normalizeHostPayload
} = require('../hooks/_runtime/lifecycle-host-adapters.cjs')

assert.deepStrictEqual(Object.keys(EVENT_MAP).sort(), ['gemini', 'grok'])

const before = normalizeHostPayload('gemini', {
  hook_event_name: 'BeforeAgent',
  prompt: 'continue',
  session_id: 'gemini-session'
})
assert.strictEqual(before.originalEvent, 'BeforeAgent')
assert.strictEqual(before.mappedEvent, 'UserPromptSubmit')
assert.strictEqual(before.payload.hook_event_name, 'UserPromptSubmit')
assert.strictEqual(before.payload.devcodexHostSurface, 'gemini')

const after = normalizeHostPayload('gemini', {
  hook_event_name: 'AfterAgent',
  prompt_response: 'final response'
})
assert.strictEqual(after.mappedEvent, 'Stop')
assert.strictEqual(after.payload.response, 'final response')

const deny = adaptHostOutput('gemini', 'BeforeTool', {
  continue: true,
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: 'blocked',
    additionalContext: 'blocked'
  }
})
assert.strictEqual(deny.decision, 'deny')
assert.strictEqual(deny.reason, 'blocked')
assert.strictEqual(deny.hookSpecificOutput.hookEventName, 'BeforeTool')
assert.strictEqual(Object.prototype.hasOwnProperty.call(deny.hookSpecificOutput, 'permissionDecision'), false)

const retry = adaptHostOutput('gemini', 'AfterAgent', { decision: 'block', reason: 'retry' })
assert.strictEqual(retry.decision, 'deny')
const advisory = adaptHostOutput('gemini', 'PreCompress', { decision: 'block', reason: 'persist' })
assert.strictEqual(advisory.continue, true)
assert.strictEqual(Object.prototype.hasOwnProperty.call(advisory, 'decision'), false)

const grok = normalizeHostPayload('grok', { hook_event_name: 'PreToolUse', tool_name: 'Bash' })
assert.strictEqual(grok.mappedEvent, 'PreToolUse')
// Grok real payload uses snake_case event names (official docs)
const grokSnake = normalizeHostPayload('grok', {
  hookEventName: 'pre_tool_use',
  toolName: 'run_terminal_command',
  toolInput: { command: 'rm -rf /tmp/x' }
})
assert.strictEqual(grokSnake.mappedEvent, 'PreToolUse')
assert.strictEqual(grokSnake.payload.hookEventName, 'PreToolUse')
assert.strictEqual(grokSnake.payload.tool_name, 'run_terminal_command')
assert.deepStrictEqual(grokSnake.payload.tool_input, { command: 'rm -rf /tmp/x' })
// Grok PreToolUse: official decision:allow / decision:deny contract
assert.deepStrictEqual(adaptHostOutput('grok', 'PreToolUse', { continue: true }), { decision: 'allow' })

const grokDenyPermission = adaptHostOutput('grok', 'PreToolUse', {
  continue: true,
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: 'dangerous-command',
    additionalContext: 'dangerous-command detail'
  }
})
assert.strictEqual(grokDenyPermission.decision, 'deny')
assert.strictEqual(grokDenyPermission.reason, 'dangerous-command')
assert.strictEqual(Object.prototype.hasOwnProperty.call(grokDenyPermission, 'hookSpecificOutput'), false)

const grokDenyBlock = adaptHostOutput('grok', 'PreToolUse', {
  decision: 'block',
  reason: 'context-acquisition-incomplete'
})
assert.strictEqual(grokDenyBlock.decision, 'deny')
assert.strictEqual(grokDenyBlock.reason, 'context-acquisition-incomplete')

const grokAllowPermission = adaptHostOutput('grok', 'PreToolUse', {
  hookSpecificOutput: { permissionDecision: 'allow' }
})
assert.deepStrictEqual(grokAllowPermission, { decision: 'allow' })

// PassivePassive events must not emit hard deny (platform: stdout ignored / non-blocking)
const grokPassive = adaptHostOutput('grok', 'UserPromptSubmit', {
  decision: 'block',
  reason: 'should-not-block',
  systemMessage: 'bootstrap',
  hookSpecificOutput: {
    permissionDecision: 'deny',
    permissionDecisionReason: 'nope',
    additionalContext: 'inject-attempt'
  }
})
assert.strictEqual(grokPassive.continue, true)
assert.strictEqual(Object.prototype.hasOwnProperty.call(grokPassive, 'decision'), false)
assert.strictEqual(grokPassive.devcodexGrokEvidenceMode, 'passive-hook-no-context-injection')
assert.strictEqual(
  Object.prototype.hasOwnProperty.call(grokPassive.hookSpecificOutput || {}, 'permissionDecision'),
  false
)

const grokStop = adaptHostOutput('grok', 'Stop', {
  decision: 'block',
  reason: 'closure-incomplete',
  systemMessage: 'DevCodex closure reminder'
})
assert.strictEqual(grokStop.continue, true)
assert.strictEqual(Object.prototype.hasOwnProperty.call(grokStop, 'decision'), false)
assert.strictEqual(grokStop.devcodexGrokEvidenceMode, 'passive-hook-no-context-injection')

for (const event of ['UserPromptSubmit', 'Stop', 'PreCompact']) {
  for (const group of grokHooks.hooks[event]) {
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(group, 'matcher'),
      false,
      `${event} is a lifecycle event and must omit tool-name matcher`
    )
  }
}
// Grok matcher is regex; "*" is invalid (Nothing to repeat) and can drop PreTool hooks.
for (const event of ['PreToolUse', 'PostToolUse']) {
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(grokHooks.hooks[event][0], 'matcher'),
    false,
    `${event} must omit matcher (empty = match all); never use matcher:"*"`
  )
}
const pluginHooks = require('../grok/plugins/devcodex-workspace/hooks/hooks.json')
for (const event of ['PreToolUse', 'PostToolUse']) {
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(pluginHooks.hooks[event][0], 'matcher'),
    false,
    `plugin ${event} must omit invalid matcher *`
  )
}

// path-observable for grok (HostParity W2) — hostCapabilityFor exported for contract tests
const { buildLifecycleBootstrapStateUtils } = require('../hooks/_runtime/lifecycle-bootstrap-state.cjs')
const bootstrapApi = buildLifecycleBootstrapStateUtils({
  fs: require('fs'),
  path: require('path'),
  crypto: require('crypto'),
  CONTEXT_ROOT: process.cwd(),
  LAYOUT: { enabled: false },
  CONTEXT_PROJECT: '',
  DEFAULT_SCOPE: 'project',
  EXECUTION_MODE: 'confirm',
  readJsonFile: () => null,
  META_STATE_PATHS: {},
  buildPathNeedles: () => [],
  getStatePathsFor: () => ({}),
  getStatePaths: () => ({}),
  getActiveScope: () => 'project',
  getActiveNamespaceRoot: () => process.cwd(),
  getBootstrapAgent: () => 'codex',
  getWorkspaceNamespaceRoot: () => process.cwd(),
  readProfileMode: () => 'prod',
  getToolName: () => '',
  touchesPath: () => false,
  getToolInputStrings: () => [],
  getCommandText: () => '',
  getPayloadSessionKey: () => '',
  getRecentBootstrapTaskStamps: () => [],
  isRecentBootstrapTaskPath: () => false,
  buildInterceptionOutput: () => ({ continue: true }),
  INTERCEPTION_ACTION: { REQUIRE_COMPLETION: 'require_completion', WARN_CONTINUE: 'warn_continue' },
  noopOutput: () => ({ continue: true }),
  emptyGovernanceIntakeState: () => ({}),
  normalizeGovernanceIntakeState: (v) => v,
  createTurnLivenessState: () => ({}),
  normalizeTurnLivenessState: (v) => v,
  CONTEXT_READ_CONTRACT: { schemas: { state: 'ContextReadStateV1' } },
  createContextReadReceipt: () => ({}),
  evaluateContextReuse: () => ({}),
  extractContextPlanBody: () => null,
  extractContextSourceEvidence: () => ({}),
  markContextReadReceiptStale: (v) => v,
  normalizeContextReadState: (v) => v || {},
  normalizeContextToolOutcome: (v) => v
})
assert.strictEqual(typeof bootstrapApi.hostCapabilityFor, 'function')
assert.strictEqual(bootstrapApi.hostCapabilityFor('grok', {}), 'path-observable')
assert.strictEqual(bootstrapApi.hostCapabilityFor('codex', {}), 'path-observable')
assert.strictEqual(bootstrapApi.hostCapabilityFor('copilot', {}), 'instruction-only')
assert.strictEqual(bootstrapApi.hostCapabilityFor('claude', {}), 'structured-plan')

const { buildLifecycleHookOutput } = require('../hooks/_runtime/lifecycle-hook-output.cjs')
const hookOut = buildLifecycleHookOutput({ env: process.env, enforcementMode: 'safety-only' })
assert.strictEqual(hookOut.eventSupportsHardBlock('grok', 'PreToolUse'), true)
assert.strictEqual(hookOut.eventSupportsHardBlock('grok', 'UserPromptSubmit'), false)
assert.strictEqual(hookOut.eventSupportsHardBlock('grok', 'Stop'), false)
assert.strictEqual(hookOut.eventSupportsHardBlock('codex', 'UserPromptSubmit'), true)

console.log('host adapter tests passed gemini mapping, grok decision contract, passive no-block, path-observable parity')
