#!/usr/bin/env node
'use strict'

const assert = require('assert')
const grokHooks = require('../grok/hooks/devcodex.json')
const {
  parseContextToolIdentity
} = require('../hooks/_runtime/lifecycle-bootstrap-state.cjs')
const {
  EVENT_MAP,
  applyCliEnvironmentOverrides,
  adaptHostOutput,
  isGrokImportedClaudePayload,
  normalizeHostPayload,
  probeHostAdapterContract,
  runHostAdapter
} = require('../hooks/_runtime/lifecycle-host-adapters.cjs')

const cliOverrideEnv = {}
applyCliEnvironmentOverrides([
  '--skill-route-probe-authority', './probe-authority.json',
  '--skill-route-trace', './route-trace.jsonl',
  '--lifecycle-trace', './lifecycle-trace.jsonl',
  '--workspace-root', '.',
  '--context-epoch', 'ctx-probe',
  '--event', 'userPromptTransformed'
], cliOverrideEnv)
assert.ok(cliOverrideEnv.DEVCODEX_SKILL_ROUTE_PROBE_AUTHORITY.endsWith('probe-authority.json'))
assert.ok(cliOverrideEnv.DEVCODEX_SKILL_ROUTE_TRACE.endsWith('route-trace.jsonl'))
assert.ok(cliOverrideEnv.DEVCODEX_LIFECYCLE_TRACE.endsWith('lifecycle-trace.jsonl'))
assert.strictEqual(cliOverrideEnv.DEVCODEX_WORKSPACE_ROOT, process.cwd())
assert.strictEqual(cliOverrideEnv.DEVCODEX_CONTEXT_EPOCH, 'ctx-probe')
assert.strictEqual(cliOverrideEnv.DEVCODEX_CONTEXT_EPOCH_SOURCE, 'host-adapter-cli')
assert.strictEqual(cliOverrideEnv.DEVCODEX_HOST_EVENT, 'userPromptTransformed')

assert.deepStrictEqual(Object.keys(EVENT_MAP).sort(), ['claude', 'codex', 'copilot', 'gemini', 'grok'])
assert.deepStrictEqual(
  parseContextToolIdentity('mcp__devcodex_profile__profile_context_plan'),
  {
    raw: 'mcp__devcodex_profile__profile_context_plan',
    server: 'devcodex-profile',
    tool: 'profile_context_plan'
  }
)
assert.strictEqual(
  parseContextToolIdentity('mcp__devcodex_memory__memory_status').server,
  'devcodex-memory'
)
assert.deepStrictEqual(
  parseContextToolIdentity('devcodex-profile-profile_context_plan'),
  {
    raw: 'devcodex-profile-profile_context_plan',
    server: 'devcodex-profile',
    tool: 'profile_context_plan'
  }
)

for (const host of ['copilot', 'claude', 'codex', 'gemini', 'grok']) {
  const probe = probeHostAdapterContract(host)
  assert.strictEqual(probe.status, 'passed', `${host} contract probe must pass`)
  assert.ok(probe.events.length > 0, `${host} contract probe must exercise events`)
}
assert.strictEqual(probeHostAdapterContract('unknown').errorCode, 'HOST_ADAPTER_UNSUPPORTED')

const claude = normalizeHostPayload('claude', { hookEventName: 'PreToolUse' })
assert.strictEqual(claude.mappedEvent, 'PreToolUse')
assert.strictEqual(claude.payload.devcodexHostSurface, 'claude')
const codex = normalizeHostPayload('codex', { hook_event_name: 'PreCompact' })
assert.strictEqual(codex.mappedEvent, 'PreCompact')
assert.strictEqual(codex.payload.devcodexHostSurface, 'codex')
const codexPost = normalizeHostPayload('codex', {
  hook_event_name: 'PostToolUse',
  tool_response: {
    success: false,
    error: { code: 'CONDITIONAL_UNAVAILABLE' }
  }
})
assert.deepStrictEqual(codexPost.payload.tool_result, {
  success: false,
  error: { code: 'CONDITIONAL_UNAVAILABLE' }
})
const copilot = normalizeHostPayload('copilot', {
  hookEventName: 'preToolUse',
  sessionId: 'copilot-session',
  toolName: 'powershell',
  toolArgs: { command: 'Get-Date' }
})
assert.strictEqual(copilot.mappedEvent, 'PreToolUse')
assert.strictEqual(copilot.payload.devcodexHostSurface, 'copilot')
assert.strictEqual(copilot.payload.session_id, 'copilot-session')
assert.strictEqual(copilot.payload.tool_name, 'powershell')
assert.deepStrictEqual(copilot.payload.tool_input, { command: 'Get-Date' })
const copilotMcp = normalizeHostPayload('copilot', {
  hookEventName: 'postToolUse',
  toolName: 'devcodex-profile-profile_context_plan',
  toolArgs: '{"project":"sample","contextEpoch":"ctx-1"}',
  toolResult: {
    resultType: 'success',
    textResultForLlm: '{"schemaVersion":"ContextReadPlanV2"}'
  }
})
assert.deepStrictEqual(copilotMcp.payload.tool_input, {
  project: 'sample',
  contextEpoch: 'ctx-1'
})
assert.deepStrictEqual(copilotMcp.payload.tool_result, {
  success: true,
  result: '{"schemaVersion":"ContextReadPlanV2"}'
})
const copilotMcpPre = normalizeHostPayload('copilot', {
  hookEventName: 'preToolUse',
  sessionId: 'copilot-mcp-session',
  toolName: 'devcodex-profile-profile_load',
  toolArgs: '{"project":"sample","files":["README.md"]}'
})
const copilotMcpPost = normalizeHostPayload('copilot', {
  hookEventName: 'postToolUse',
  sessionId: 'copilot-mcp-session',
  toolName: 'devcodex-profile-profile_load',
  toolArgs: '{"files":["README.md"],"project":"sample"}',
  toolResult: {
    resultType: 'success',
    textResultForLlm: 'profile body'
  }
})
assert.match(copilotMcpPre.payload.tool_call_id, /^copilot-[a-f0-9]{32}$/)
assert.strictEqual(
  copilotMcpPost.payload.tool_call_id,
  copilotMcpPre.payload.tool_call_id
)
const copilotContinuation = normalizeHostPayload('copilot', {
  hookEventName: 'userPromptTransformed',
  prompt: 'Progressive Skill route is incomplete: PLAN_NOT_COMMITTED.',
  transformedPrompt: 'continuation'
})
assert.strictEqual(copilotContinuation.payload.devcodex_host_continuation, true)
const copilotSubmittedContinuation = normalizeHostPayload('copilot', {
  hookEventName: 'userPromptSubmitted',
  prompt: 'Progressive Skill route is incomplete: PLAN_NOT_COMMITTED.'
})
assert.strictEqual(copilotSubmittedContinuation.payload.devcodex_host_continuation, true)
const copilotTransformedContinuation = normalizeHostPayload('copilot', {
  hookEventName: 'userPromptTransformed',
  prompt: 'original user prompt',
  transformedPrompt: 'Progressive Skill route is incomplete: PLAN_NOT_COMMITTED.'
})
assert.strictEqual(copilotTransformedContinuation.payload.devcodex_host_continuation, true)
assert.strictEqual(copilotTransformedContinuation.payload.devcodex_host_transform_only, true)

for (const [host, eventName] of [
  ['claude', 'UserPromptSubmit'],
  ['codex', 'UserPromptSubmit'],
  ['gemini', 'BeforeAgent'],
  ['grok', 'user_prompt_submit']
]) {
  for (const prompt of [
    'Progressive Skill route is incomplete: PLAN_NOT_COMMITTED.',
    'Progressive Skill route context is stale; refresh ContextRead and call skill_route rebind before loading pending stages: closeout.',
    'Progressive Skill route stages remain pending: closeout.'
  ]) {
    const normalized = normalizeHostPayload(host, {
      hookEventName: eventName,
      hook_run_id: `${host}-route-continuation`,
      prompt
    })
    assert.strictEqual(
      normalized.payload.devcodex_host_continuation,
      true,
      `${host} must preserve route continuation carrier for ${prompt}`
    )
  }
}

const pastedRouteText = normalizeHostPayload('codex', {
  hookEventName: 'UserPromptSubmit',
  prompt: 'Progressive Skill route stages remain pending: closeout.'
})
assert.notStrictEqual(
  pastedRouteText.payload.devcodex_host_continuation,
  true,
  'ordinary user-pasted text without a hook carrier must remain a user message'
)

const structuredContinuation = normalizeHostPayload('codex', {
  hookEventName: 'UserPromptSubmit',
  devcodexCode: 'progressive-skill-route',
  devcodexHookRunId: 'structured-hook',
  devcodexStateFingerprint: 'a'.repeat(64),
  prompt: 'continue'
})
assert.strictEqual(structuredContinuation.payload.devcodex_host_continuation, true)
assert.strictEqual(structuredContinuation.payload.devcodex_route_continuation.structured, true)

const copilotDeny = adaptHostOutput('copilot', 'preToolUse', {
  hookSpecificOutput: {
    permissionDecision: 'deny',
    permissionDecisionReason: 'policy denied'
  },
  modifiedArgs: { command: 'Write-Output safe' }
})
assert.deepStrictEqual(copilotDeny, {
  permissionDecision: 'deny',
  permissionDecisionReason: 'policy denied',
  modifiedArgs: { command: 'Write-Output safe' }
})
const copilotPost = adaptHostOutput('copilot', 'PostToolUse', {
  hookSpecificOutput: { additionalContext: 'remember this' },
  modifiedResult: { resultType: 'success', textResultForLlm: 'safe result' }
})
assert.deepStrictEqual(copilotPost, {
  additionalContext: 'remember this',
  modifiedResult: { resultType: 'success', textResultForLlm: 'safe result' }
})
assert.deepStrictEqual(
  adaptHostOutput('copilot', 'agentStop', { decision: 'block', reason: 'continue closure' }),
  { decision: 'block', reason: 'continue closure' }
)
assert.deepStrictEqual(
  adaptHostOutput('copilot', 'UserPromptSubmit', { decision: 'block', reason: 'must be ignored' }),
  {}
)
const copilotTransformed = adaptHostOutput('copilot', 'userPromptTransformed', {
  systemMessage: 'system route',
  hookSpecificOutput: { additionalContext: 'skill bootstrap' }
}, {
  transformedPrompt: 'original transformed prompt'
})
assert.match(copilotTransformed.modifiedTransformedPrompt, /original transformed prompt/)
assert.match(copilotTransformed.modifiedTransformedPrompt, /system route/)
assert.match(copilotTransformed.modifiedTransformedPrompt, /skill bootstrap/)

const unknownEvent = runHostAdapter('codex', { hookEventName: 'UnknownEvent' })
assert.strictEqual(unknownEvent.status, 2)
assert.match(unknownEvent.error, /Unsupported codex hook event/)
const spawnFailure = runHostAdapter('claude', { hookEventName: 'PreToolUse' }, {
  spawnSync: () => ({ status: null, stdout: '', stderr: '', error: { code: 'ENOENT' } })
})
assert.strictEqual(spawnFailure.status, 1)
assert.match(spawnFailure.error, /ENOENT/)
const childSuccess = runHostAdapter('codex', { hookEventName: 'UserPromptSubmit' }, {
  spawnSync: () => ({ status: 0, stdout: '{"continue":true}', stderr: '' })
})
assert.strictEqual(childSuccess.status, 0)
assert.strictEqual(childSuccess.output.continue, true)
let observedLifecycleCwd = null
const childWithPayloadCwd = runHostAdapter('copilot', {
  hookEventName: 'userPromptSubmitted',
  cwd: process.cwd(),
  prompt: 'Project sample.'
}, {
  spawnSync: (_command, _args, spawnOptions) => {
    observedLifecycleCwd = spawnOptions.cwd
    return { status: 0, stdout: '{"continue":true}', stderr: '' }
  }
})
assert.strictEqual(childWithPayloadCwd.status, 0)
assert.strictEqual(observedLifecycleCwd, process.cwd())

for (const event of ['user_prompt_submit', 'pre_tool_use', 'post_tool_use', 'stop']) {
  const payload = { hookEventName: event, cwd: process.cwd() }
  assert.strictEqual(isGrokImportedClaudePayload('claude', payload, event), true)
  const imported = runHostAdapter('claude', payload, {
    spawnSync: () => {
      throw new Error('Grok-imported Claude hooks must not execute the lifecycle twice')
    }
  })
  assert.strictEqual(imported.status, 0)
  assert.strictEqual(imported.output.continue, true)
  assert.strictEqual(imported.output.devcodexCompatibilityBypass, 'grok-imported-claude-hook')
}
assert.strictEqual(
  isGrokImportedClaudePayload('claude', { hook_event_name: 'UserPromptSubmit' }, 'UserPromptSubmit'),
  false
)
assert.strictEqual(
  runHostAdapter('claude', { hookEventName: 'unknown_foreign_event' }).status,
  2
)

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
const grokMcp = normalizeHostPayload('grok', {
  hookEventName: 'pre_tool_use',
  toolName: 'devcodex-profile__profile_context_plan',
  toolInput: {
    tool_name: 'devcodex-profile__profile_context_plan',
    tool_input: {
      project: 'sample',
      contextEpoch: 'ctx-12345678'
    }
  }
})
assert.deepStrictEqual(grokMcp.payload.tool_input, {
  project: 'sample',
  contextEpoch: 'ctx-12345678'
})
const grokMcpPost = normalizeHostPayload('grok', {
  hookEventName: 'post_tool_use',
  toolName: 'devcodex-profile__profile_context_plan',
  toolResult: {
    output: {
      OkayOutput: {
        schemaVersion: 'ContextReadPlanV2'
      }
    }
  }
})
assert.deepStrictEqual(grokMcpPost.payload.tool_result, {
  schemaVersion: 'ContextReadPlanV2'
})
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

// Grok official Stop Decision Control: decision:block is preserved and fed back to the model
const grokStop = adaptHostOutput('grok', 'Stop', {
  decision: 'block',
  reason: 'closure-incomplete',
  systemMessage: 'DevCodex closure reminder'
})
assert.strictEqual(grokStop.decision, 'block')
assert.strictEqual(grokStop.reason, 'closure-incomplete')
assert.strictEqual(grokStop.devcodexGrokEvidenceMode, 'stop-decision-block')

const grokStopAllow = adaptHostOutput('grok', 'Stop', { decision: 'allow' })
assert.strictEqual(grokStopAllow.decision, 'allow')
assert.strictEqual(grokStopAllow.devcodexGrokEvidenceMode, 'stop-decision-allow')

const grokStopSoft = adaptHostOutput('grok', 'Stop', {
  continue: true,
  systemMessage: 'soft reminder only'
})
assert.strictEqual(grokStopSoft.continue, true)
assert.strictEqual(Object.prototype.hasOwnProperty.call(grokStopSoft, 'decision'), false)
assert.strictEqual(grokStopSoft.devcodexGrokEvidenceMode, 'stop-soft')

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
assert.strictEqual(bootstrapApi.hostCapabilityFor('copilot', {}), 'path-observable')
assert.strictEqual(bootstrapApi.hostCapabilityFor('claude', {}), 'structured-plan')
assert.strictEqual(bootstrapApi.hostCapabilityFor('grok', { contextCapability: 'structured-plan' }), 'path-observable')
assert.strictEqual(bootstrapApi.hostCapabilityFor('codex', { devcodexContextCapability: 'structured-plan' }), 'path-observable')
assert.strictEqual(bootstrapApi.hostCapabilityFor('copilot', { contextCapability: 'structured-plan' }), 'path-observable')
assert.strictEqual(bootstrapApi.hostCapabilityFor('claude', { contextCapability: 'instruction-only' }), 'instruction-only')
assert.strictEqual(bootstrapApi.isRouteContextReceiptReady({
  plan: { selectedSources: [{}], mandatorySourceIds: ['profile'] },
  receipt: { status: 'escalated-full' }
}), true)
assert.strictEqual(bootstrapApi.isRouteContextReceiptReady({
  plan: { selectedSources: [], mandatorySourceIds: [] },
  receipt: { status: 'baseline-ready' }
}), true)
assert.strictEqual(bootstrapApi.isRouteContextReceiptReady({
  plan: { selectedSources: [{}], mandatorySourceIds: ['profile'] },
  receipt: { status: 'baseline-ready' }
}), false)

const {
  HOST_COMPLETION_ROUTES,
  WorkflowCompletionLifecycleError,
  completionRouteForHost
} = require('../hooks/_runtime/lifecycle-workflow-completion.cjs')
const { projectWorkflowCompletionVisibleState } = require('../hooks/_runtime/lifecycle-visible-reply.cjs')
const completionHosts = ['codex', 'claude', 'copilot', 'gemini', 'grok']
assert.deepStrictEqual(Object.keys(HOST_COMPLETION_ROUTES).sort(), [...completionHosts].sort())

const committedProjection = Object.freeze({
  schemaVersion: 'WorkflowCompletionProjectionV1',
  workflowEvidenceState: 'PASS',
  workflowComplete: true,
  deliveryCommitted: true,
  completionPhase: 'committed-complete',
  projectionDigest: 'a'.repeat(64),
  phaseTerminals: Object.freeze(['requirements', 'implementation', 'verification', 'delivery'].map(phase => Object.freeze({ phase, status: 'PASS' }))),
  diagnostics: Object.freeze({ firstBlocker: null, recommendedActions: Object.freeze([]) })
})
const incompleteProjection = Object.freeze({
  ...committedProjection,
  workflowEvidenceState: 'UNVERIFIED',
  workflowComplete: false,
  deliveryCommitted: false,
  completionPhase: 'delivery-prepared',
  projectionDigest: 'b'.repeat(64),
  diagnostics: Object.freeze({ firstBlocker: Object.freeze({ requirementId: 'delivery.manifest' }), recommendedActions: Object.freeze(['run-task-verify']) })
})
const hostCompletionFixtures = Object.freeze([
  ['success', committedProjection],
  ['failed-exit', incompleteProjection],
  ['tool-unobservable', incompleteProjection],
  ['stop-only', incompleteProjection],
  ['marker-only', incompleteProjection],
  ['candidate-stale', incompleteProjection],
  ['portable-receipt-missing', incompleteProjection],
  ['fallback', incompleteProjection],
  ['adapter-disabled-untrusted', incompleteProjection],
  ['output-not-injectable', incompleteProjection]
])
const expectedVisible = hostCompletionFixtures.map(([, projection]) => projectWorkflowCompletionVisibleState(projection))

for (const host of completionHosts) {
  const defaults = HOST_COMPLETION_ROUTES[host]
  const direct = completionRouteForHost(host, {
    surface: defaults.defaultSurface,
    adapterEnabled: true,
    trusted: true,
    directReplay: true,
    sourceObserved: true,
    outputObserved: true
  })
  assert.strictEqual(direct.semanticReducer, 'workflow-completion-contract')
  assert.strictEqual(direct.evidenceMode, 'direct-replay')
  assert.strictEqual(direct.evidenceCeiling, 'verified')
  assert.strictEqual(direct.visibleReplyEvidence, 'verified-present')

  const unobserved = completionRouteForHost(host, { surface: defaults.defaultSurface })
  assert.strictEqual(unobserved.evidenceMode, 'portable-receipt')
  assert.strictEqual(unobserved.evidenceCeiling, 'UNVERIFIED')
  assert.strictEqual(unobserved.visibleReplyEvidence, 'unverified')

  const disabled = completionRouteForHost(host, { adapterEnabled: false, trusted: true })
  assert.strictEqual(disabled.evidenceMode, 'instruction-fallback')
  assert.strictEqual(disabled.fallbackReason, 'adapter-disabled')
  const untrusted = completionRouteForHost(host, { adapterEnabled: true, trusted: false })
  assert.strictEqual(untrusted.evidenceMode, 'instruction-fallback')
  assert.strictEqual(untrusted.fallbackReason, 'adapter-untrusted')

  const visibleMatrix = hostCompletionFixtures.map(([, projection]) => projectWorkflowCompletionVisibleState(projection))
  assert.deepStrictEqual(visibleMatrix, expectedVisible, `${host} completion semantics must match the shared reducer`)
  assert.strictEqual(visibleMatrix[0].workflowComplete, true)
  for (const state of visibleMatrix.slice(1)) assert.strictEqual(state.workflowComplete, false)
}
assert.throws(() => completionRouteForHost('unknown'), error => error instanceof WorkflowCompletionLifecycleError && error.code === 'WORKFLOW_HOST_UNSUPPORTED')

const { buildLifecycleHookOutput } = require('../hooks/_runtime/lifecycle-hook-output.cjs')
const hookOut = buildLifecycleHookOutput({ env: process.env, enforcementMode: 'safety-only' })
assert.strictEqual(hookOut.eventSupportsHardBlock('grok', 'PreToolUse'), true)
assert.strictEqual(hookOut.eventSupportsHardBlock('grok', 'UserPromptSubmit'), false)
// Grok official Stop Decision Control: Stop/SubagentStop hard block is supported
assert.strictEqual(hookOut.eventSupportsHardBlock('grok', 'Stop'), true)
assert.strictEqual(hookOut.eventSupportsHardBlock('codex', 'UserPromptSubmit'), true)
assert.strictEqual(hookOut.eventSupportsHardBlock('copilot', 'PreToolUse'), true)
assert.strictEqual(hookOut.eventSupportsHardBlock('copilot', 'Stop'), true)
assert.strictEqual(hookOut.eventSupportsHardBlock('copilot', 'UserPromptSubmit'), false)
assert.strictEqual(
  buildLifecycleHookOutput({
    env: { ...process.env, DEVCODEX_HOST_PLATFORM: 'copilot', CODEX_HOME: 'would-otherwise-win' },
    enforcementMode: 'safety-only'
  }).detectPlatform({ hook_event_name: 'PreToolUse' }),
  'copilot'
)

console.log('host adapter tests passed five-host mapping, Copilot CLI output contracts, capability ceilings, and completion parity')
