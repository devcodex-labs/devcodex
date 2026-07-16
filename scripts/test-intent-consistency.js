#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
  EVIDENCE_PRIORITY,
  evaluateIntentConsistency,
  isShortConfirmation
} = require('./lib/intent-consistency')

const base = {
  userText: '确认',
  semanticAction: 'confirm',
  confidence: 'high',
  proposalRef: 'proposal:A',
  requirementRef: 'requirement:absorption',
  expectedRequirementRef: 'requirement:absorption',
  phase: 'CP2',
  expectedPhase: 'CP2',
  routeHints: ['dev'],
  historyRefs: ['session:previous']
}

const matched = evaluateIntentConsistency(base)
assert.strictEqual(matched.ok, true)
assert.strictEqual(matched.status, 'matched')
assert.strictEqual(matched.selected.binding, 'short-confirmation')
assert.deepStrictEqual(matched.evidence.map(item => item.source), EVIDENCE_PRIORITY)
assert.deepStrictEqual(matched.ignored.map(item => item.source), ['route-hint', 'history'])

const missingState = evaluateIntentConsistency({ ...base, proposalRef: '' })
assert.strictEqual(missingState.status, 'clarify')
assert.strictEqual(missingState.errorCode, 'INTENT_STATE_MISSING')

const missingRequiredInput = evaluateIntentConsistency({ semanticAction: '', confidence: 'high', phase: '' })
assert.strictEqual(missingRequiredInput.status, 'clarify')
assert.strictEqual(missingRequiredInput.errorCode, 'INTENT_STATE_MISSING')

const unboundShortConfirmation = evaluateIntentConsistency({
  userText: '继续',
  semanticAction: 'analyze',
  confidence: 'high',
  phase: 'analysis'
})
assert.strictEqual(unboundShortConfirmation.status, 'clarify')
assert.strictEqual(unboundShortConfirmation.errorCode, 'INTENT_STATE_MISSING')

const malformedAdvisoryEvidence = evaluateIntentConsistency({ ...base, routeHints: 'dev', historyRefs: {} })
assert.deepStrictEqual(malformedAdvisoryEvidence.ignored, [])

const phaseMismatch = evaluateIntentConsistency({ ...base, phase: 'CP3' })
assert.strictEqual(phaseMismatch.status, 'blocked')
assert.strictEqual(phaseMismatch.errorCode, 'INTENT_PHASE_MISMATCH')

const requirementMismatch = evaluateIntentConsistency({ ...base, requirementRef: 'requirement:other' })
assert.strictEqual(requirementMismatch.status, 'blocked')
assert.strictEqual(requirementMismatch.errorCode, 'INTENT_REQUIREMENT_MISMATCH')

const lowConfidence = evaluateIntentConsistency({ ...base, confidence: 'low' })
assert.strictEqual(lowConfidence.status, 'clarify')
assert.strictEqual(lowConfidence.errorCode, 'INTENT_LOW_CONFIDENCE')

const nonConfirmation = evaluateIntentConsistency({
  userText: '分析当前实现',
  semanticAction: 'analyze',
  confidence: 0.9,
  phase: 'analysis'
})
assert.strictEqual(nonConfirmation.ok, true)
assert.strictEqual(nonConfirmation.selected.binding, 'explicit-intent')
assert.strictEqual(isShortConfirmation('继续'), true)
assert.strictEqual(isShortConfirmation('继续分析当前实现'), false)

console.log('✓ Intent consistency evidence priority and negative fixtures passed')
