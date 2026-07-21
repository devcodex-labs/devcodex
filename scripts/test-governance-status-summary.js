#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  buildGovernanceStatusSummary,
  buildSimpleGovernanceFastPathDecision,
  inspectDirtyBoundary
} = require('./lib/governance-status-summary.js')

const ROOT = path.resolve(__dirname, '..')

function writeFile(root, relativePath, content) {
  const fullPath = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath, content, 'utf8')
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-governance-summary-'))
try {
  writeFile(tempRoot, 'data/process-improvements.md', [
    '# Process Improvements',
    '',
    '| ID | Summary | Status |',
    '|----|---------|--------|',
    '| PI-100 | candidate summary fixture | closed |',
    ''
  ].join('\n'))
  writeFile(tempRoot, '.memory/clients/codex/SUMMARY.md', [
    '# Codex Summary',
    '',
    'PI-100 closed with matching current projection.',
    ''
  ].join('\n'))

  const executionOptimization = {
    schemaVersion: 'ExecutionOptimizationInspectionV1',
    activeRoot: tempRoot,
    config: { effective: 'safe-auto', status: 'defaulted' },
    stateStatus: 'provided',
    stateIdentity: 'fixture-state',
    features: [
      {
        featureId: 'profile-section-reuse',
        lifecycleState: 'trial',
        evidence: [],
        lastVerdict: null,
        decision: { route: 'full', optimizationAllowed: false, promotionAllowed: false, reasons: ['evidence-missing'] }
      },
      {
        featureId: 'task-resolver-cache',
        lifecycleState: 'trial',
        evidence: ['fixture-benefit'],
        lastVerdict: 'effective',
        decision: { route: 'accelerated', optimizationAllowed: true, promotionAllowed: false, reasons: [] }
      }
    ],
    writes: []
  }
  const summary = buildGovernanceStatusSummary({
    cwd: ROOT,
    packageRoot: ROOT,
    activeRoot: tempRoot,
    sourceRepository: true,
    executionOptimization,
    hostParity: { tier: 'full-capable', hardReady: true, cannotClaim: ['Stop hard-block'] }
  })

  assert.strictEqual(summary.schemaVersion, 'GovernanceStatusSummaryV1')
  assert.strictEqual(summary.readOnly, true)
  assert.strictEqual(summary.runtimeState.recordCount, 1)
  assert.strictEqual(summary.runtimeState.conflictCount, 0)
  assert.strictEqual(summary.ledgers.schemaVersion, 'LedgerRetirementCandidateV1')
  assert.strictEqual(summary.ledgers.readOnly, true)
  assert.strictEqual(summary.ledgers.candidateCount, 1)
  assert.strictEqual(summary.ledgers.candidates[0].recordId, 'PI-100')
  assert.strictEqual(summary.skills.schemaVersion, 'SkillSelectionTraceV1')
  assert.ok(summary.skills.skillCount >= 80)
  assert.ok(summary.skills.graySkillCount >= 3)
  assert.ok(summary.skills.graySkills.includes('brand-visual-quality'))
  assert.strictEqual(summary.skills.evidenceStatus, 'insufficient-trigger-samples')
  assert.strictEqual(summary.executionOptimization.schemaVersion, 'ExecutionOptimizationEvidenceV1')
  assert.strictEqual(summary.executionOptimization.featureCount, 2)
  assert.strictEqual(summary.executionOptimization.acceleratedCount, 1)
  assert.strictEqual(summary.executionOptimization.insufficientEvidenceCount, 1)
  assert.strictEqual(summary.executionOptimization.noEvidencePromotionBlocked, true)
  assert.strictEqual(summary.gateLifecycle.schemaVersion, 'GateLifecycleMetadataV1')
  assert.ok(summary.gateLifecycle.groupCount >= 30)
  assert.strictEqual(summary.gateLifecycle.readOnly, true)
  assert.strictEqual(summary.hostTruth.grokTier, 'full-capable')
  assert.strictEqual(summary.fastPathPolicy.visibleMode, 'full')
  assert.ok(summary.fastPathPolicy.upgradeTriggers.includes('control-plane'))
  assert.strictEqual(summary.validation.valid, true)

  const compact = buildSimpleGovernanceFastPathDecision({
    taskKind: 'chat',
    messageKind: 'progress',
    riskClass: 'low',
    evidenceRefs: ['same-envelope-digest']
  })
  assert.strictEqual(compact.schemaVersion, 'SimpleGovernanceFastPathDecisionV1')
  assert.strictEqual(compact.validation.valid, true)
  assert.strictEqual(compact.eligible, true)
  assert.strictEqual(compact.visibleMode, 'compact')
  assert.deepStrictEqual(compact.upgradeTriggers, [])

  const failClosed = buildSimpleGovernanceFastPathDecision({
    taskKind: 'dev',
    messageKind: 'final-result',
    riskClass: 'high',
    cpState: 'pending',
    sourceMutation: true,
    evidenceRefs: []
  })
  assert.strictEqual(failClosed.validation.valid, true)
  assert.strictEqual(failClosed.eligible, false)
  assert.strictEqual(failClosed.visibleMode, 'full')
  for (const trigger of ['risk-not-low', 'source-mutation', 'message-kind-not-compactable', 'cp-not-confirmed', 'evidence-missing']) {
    assert.ok(failClosed.upgradeTriggers.includes(trigger), `missing upgrade trigger: ${trigger}`)
  }
  const invalidEvidence = buildSimpleGovernanceFastPathDecision({ riskClass: 'low', evidenceRefs: ['ok', 1] })
  assert.strictEqual(invalidEvidence.validation.valid, false)
  assert.strictEqual(invalidEvidence.visibleMode, 'full')

  const dirty = inspectDirtyBoundary(ROOT)
  assert.strictEqual(dirty.schemaVersion, 'DirtyBoundaryV1')
  assert.ok(['clean', 'dirty', 'unknown'].includes(dirty.status))

  console.log('governance status summary passed: runtime/skill/execution/gate/fast-path read-only contract')
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
