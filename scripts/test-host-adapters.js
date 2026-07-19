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
assert.deepStrictEqual(adaptHostOutput('grok', 'PreToolUse', { continue: true }), { continue: true })

for (const event of ['UserPromptSubmit', 'Stop', 'PreCompact']) {
  for (const group of grokHooks.hooks[event]) {
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(group, 'matcher'),
      false,
      `${event} is a lifecycle event and must omit tool-name matcher`
    )
  }
}
for (const event of ['PreToolUse', 'PostToolUse']) {
  assert.strictEqual(grokHooks.hooks[event][0].matcher, '*')
}

console.log('host adapter tests passed gemini mapping, grok native output and lifecycle matcher contract')
