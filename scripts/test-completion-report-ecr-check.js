#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  commitWorkflowCompletionDelivery,
  collectRecentCompletedReportEcrIssues,
  classifyCheckboxEcrFromReportText,
  createWorkflowCompletionReportRef,
  formatWorkflowCompletionMemoryRef,
  formatWorkflowCompletionReportRef,
  parseWorkflowCompletionReportRef,
  resolveWorkflowCompletionReport
} = require('./lib/completion-report-ecr-check')
const {
  createWorkflowCompletionCandidate,
  createWorkflowCompletionPlan,
  createWorkflowEvidenceReceipt,
  evaluateWorkflowCompletion
} = require('../hooks/_runtime/workflow-completion-contract.cjs')
const { buildContentIdentity, sha256 } = require('../hooks/_runtime/content-identity.cjs')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-ecr-'))
const repDir = path.join(tmp, 'reports', 'requirements', 'grok', '20260721')
fs.mkdirSync(repDir, { recursive: true })

const observedAt = '2026-07-22T08:00:00Z'
const generatedAt = '2026-07-22T08:01:00Z'
const nowMs = Date.parse('2026-07-22T08:02:00Z')
const taskScope = {
  project: 'devcodex', kind: 'requirements', taskId: 'ecr-fixture',
  relativeTaskPath: 'requirements/ecr-fixture', legacyKey: sha256('legacy:ecr-fixture'),
  sourceIdentity: buildContentIdentity({ sourceKey: 'task:ecr-fixture', content: 'ecr-fixture', contractVersion: '1' })
}
const candidate = createWorkflowCompletionCandidate({ taskScope, components: { source: sha256('source'), rules: sha256('rules') } })
const requirement = {
  requirementId: 'workflow.verification', alias: 'T7', planOrder: 0,
  applicability: { decision: 'required', authority: 'test-router', reason: 'fixture', owner: 'validation' },
  dependencyBindings: { source: candidate.components.source }, nonWaivable: false
}
const plan = createWorkflowCompletionPlan({
  candidate, workflow: 'dev', intent: 'structured ECR fixture', stage: 'implementation',
  ruleSetDigest: candidate.components.rules, requirements: [requirement]
})
const receipt = createWorkflowEvidenceReceipt({
  requirementId: requirement.requirementId, observedCandidateId: candidate.candidateId,
  dependencyBindings: requirement.dependencyBindings, sourceKind: 'validation', sourceSchema: 'ValidationExecutionReceiptV1',
  sourceIdentity: 'fixture:validation', result: 'passed', observedAt, actor: 'test', host: 'node', runId: 'run-1',
  evidenceRefs: ['fixture:passed'], qualification: { level: 'E1', satisfiesRequired: true, trusted: true, observable: true, warning: false }
})
const snapshot = evaluateWorkflowCompletion({
  candidate, plan, receipts: [receipt], generatedAt, now: nowMs,
  rollout: { schemaVersion: 'RolloutStateV1', mode: 'shadow', ruleSetDigest: candidate.components.rules, legacyComparison: 'same' }
})

const bad = path.join(repDir, '01--bad-complete.md')
fs.writeFileSync(bad, [
  '# bad',
  '> **类型**: dev',
  '> **状态**: 已完成',
  '',
  '## ECR 执行闭环复审',
  '| ECR-1 | ✅ |',
  '| ECR-2 | ✅ |'
].join('\n'))

const good = path.join(repDir, '02--good-complete.md')
const reportRef = createWorkflowCompletionReportRef(snapshot, good)
fs.writeFileSync(good, [
  '# good',
  '> **类型**: dev',
  '> **状态**: 已完成',
  formatWorkflowCompletionReportRef(reportRef),
  '',
  '## ECR 执行闭环复审',
  '| ECR-1 | ✅ |',
  '',
  'npm run test:core exitCode=0 All checks passed'
].join('\n'))
const memory = path.join(tmp, 'memory.md')
fs.writeFileSync(memory, '# memory\n', 'utf8')
const delivery = commitWorkflowCompletionDelivery({
  activeRoot: tmp,
  reportPath: good,
  memoryPaths: [memory],
  artifactManifestEntries: [good, memory],
  snapshot,
  createdAt: '2026-07-22T08:02:00Z'
})
assert.strictEqual(delivery.projection.workflowComplete, true)
assert.strictEqual(delivery.projection.deliveryCommitted, true)

const committedMemory = fs.readFileSync(memory, 'utf8')
fs.writeFileSync(memory, `${committedMemory}mutated after commit\n`, 'utf8')
const staleMemoryResolution = resolveWorkflowCompletionReport({ activeRoot: tmp, reportPath: good, snapshot, nowMs })
assert.strictEqual(staleMemoryResolution.status, 'UNVERIFIED')
assert.strictEqual(staleMemoryResolution.errorCode, 'WORKFLOW_MEMORY_READBACK_INVALID')
fs.writeFileSync(memory, committedMemory, 'utf8')
assert.throws(() => commitWorkflowCompletionDelivery({
  activeRoot: tmp,
  reportPath: good,
  memoryPaths: [__filename],
  artifactManifestEntries: [good],
  snapshot,
  createdAt: '2026-07-22T08:02:00Z'
}), error => error.code === 'WORKFLOW_MEMORY_PATH_UNSAFE')

const stateDir = path.join(tmp, '.runtime-state', 'workflow-completion')
fs.mkdirSync(stateDir, { recursive: true })
fs.writeFileSync(path.join(stateDir, 'fixture.json'), JSON.stringify({ schemaVersion: 'WorkflowCompletionDerivedStateV1', current: snapshot }, null, 2))

const { checkedFiles, issues, results } = collectRecentCompletedReportEcrIssues({
  activeRoot: tmp,
  recentDays: 2,
  nowMs
})
assert.ok(checkedFiles.length >= 2, 'should check both reports')
assert.strictEqual(issues.length, 0)
assert.ok(!issues.some(i => i.includes('good-complete')))
assert.strictEqual(results.find(item => item.relativePath.includes('bad-complete')).status, 'UNVERIFIED')
assert.strictEqual(results.find(item => item.relativePath.includes('bad-complete')).legacy, true)
assert.strictEqual(results.find(item => item.relativePath.includes('good-complete')).projection.projectionDigest, delivery.projection.projectionDigest)

assert.strictEqual(
  classifyCheckboxEcrFromReportText(fs.readFileSync(bad, 'utf8')),
  'checkbox-ecr'
)
assert.strictEqual(
  classifyCheckboxEcrFromReportText(fs.readFileSync(good, 'utf8')),
  'ok'
)

const markerOnly = path.join(repDir, '03--marker-only.md')
fs.writeFileSync(markerOnly, `# marker only\n${formatWorkflowCompletionReportRef(createWorkflowCompletionReportRef(snapshot, markerOnly))}\n`)
const markerResolution = resolveWorkflowCompletionReport({ activeRoot: tmp, reportPath: markerOnly, snapshot, nowMs })
assert.strictEqual(markerResolution.status, 'UNVERIFIED')
assert.strictEqual(markerResolution.errorCode, 'WORKFLOW_COMMIT_NOT_ATTEMPTED')
assert.strictEqual(markerResolution.projection.workflowComplete, false)
const deliveryAttempt = { candidateId: snapshot.candidateId, result: 'failed', observedAt, attemptDigest: sha256('delivery-attempt-failed') }
const failedMarkerResolution = resolveWorkflowCompletionReport({ activeRoot: tmp, reportPath: markerOnly, snapshot, deliveryAttempt, nowMs })
assert.strictEqual(failedMarkerResolution.errorCode, 'WORKFLOW_COMMIT_FAILED')
assert.strictEqual(failedMarkerResolution.projection.completionPhase, 'commit-failed')

const selectedNotExecutedSnapshot = evaluateWorkflowCompletion({
  candidate, plan, receipts: [], generatedAt, now: nowMs,
  rollout: { schemaVersion: 'RolloutStateV1', mode: 'shadow', ruleSetDigest: candidate.components.rules, legacyComparison: 'same' }
})
const selectedNotExecuted = path.join(repDir, '05--selected-not-executed.md')
fs.writeFileSync(selectedNotExecuted, `# selected route only\n> **类型**: dev\n> **状态**: 已完成\n${formatWorkflowCompletionReportRef(createWorkflowCompletionReportRef(selectedNotExecutedSnapshot, selectedNotExecuted))}\n`)
const blockedDelivery = commitWorkflowCompletionDelivery({
  activeRoot: tmp, reportPath: selectedNotExecuted, memoryPaths: [memory], artifactManifestEntries: [selectedNotExecuted, memory],
  snapshot: selectedNotExecutedSnapshot, createdAt: '2026-07-22T08:02:00Z'
})
assert.strictEqual(blockedDelivery.projection.completionPhase, 'committed-blocked')
assert.strictEqual(blockedDelivery.projection.workflowComplete, false)

const reviewOnly = path.join(repDir, '06--review-document-only.md')
fs.writeFileSync(reviewOnly, '# review only\n> **类型**: dev\n> **状态**: 已完成\n## Review\nSaturation passed.\n')
const reviewOnlyResolution = resolveWorkflowCompletionReport({ activeRoot: tmp, reportPath: reviewOnly, snapshot, nowMs })
assert.strictEqual(reviewOnlyResolution.status, 'UNVERIFIED')
assert.strictEqual(reviewOnlyResolution.legacy, true)

const escape = path.join(repDir, '04--escape.md')
fs.writeFileSync(escape, `# escape\n${formatWorkflowCompletionReportRef({ ...reportRef, sidecarPath: '../escape.md.completion.json' })}\n`)
assert.strictEqual(resolveWorkflowCompletionReport({ activeRoot: tmp, reportPath: escape, snapshot, nowMs }).errorCode, 'WORKFLOW_SIDECAR_PATH_UNSAFE')

const malformed = `${formatWorkflowCompletionReportRef(reportRef)}\n${formatWorkflowCompletionReportRef(reportRef)}`
assert.strictEqual(parseWorkflowCompletionReportRef(malformed).status, 'invalid')

const memoryIdentity = buildContentIdentity({ sourceKey: memory, content: fs.readFileSync(memory), contractVersion: '1' })
assert(formatWorkflowCompletionMemoryRef({
  schemaVersion: 'WorkflowCompletionMemoryRefV1', candidateId: snapshot.candidateId,
  coreSnapshotDigest: snapshot.coreSnapshotDigest, sidecarPath: reportRef.sidecarPath,
  memoryKind: 'task', contentIdentity: memoryIdentity
}).includes('DEVCODEX-WORKFLOW-COMPLETION-MEMORY-REF'))

const transientReport = path.join(repDir, '07--transient-sidecar.md')
fs.writeFileSync(transientReport, `# transient\n${formatWorkflowCompletionReportRef(createWorkflowCompletionReportRef(snapshot, transientReport))}\n`)
const transientSidecar = `${transientReport}.completion.json`
let transientSidecarOpenAttempts = 0
let transientSidecarUnlinkAttempts = 0
const transientSidecarFs = Object.create(fs)
transientSidecarFs.openSync = (file, flags, ...rest) => {
  if (flags === 'wx' && path.resolve(String(file)) === path.resolve(`${transientSidecar}.lock`)) {
    transientSidecarOpenAttempts += 1
    if (transientSidecarOpenAttempts <= 2) throw Object.assign(new Error('injected sidecar lock EACCES'), { code: 'EACCES' })
  }
  return fs.openSync(file, flags, ...rest)
}
transientSidecarFs.unlinkSync = file => {
  if (path.resolve(String(file)) === path.resolve(`${transientSidecar}.lock`)) {
    transientSidecarUnlinkAttempts += 1
    if (transientSidecarUnlinkAttempts === 1) throw Object.assign(new Error('injected sidecar unlock EBUSY'), { code: 'EBUSY' })
  }
  return fs.unlinkSync(file)
}
const transientDelivery = commitWorkflowCompletionDelivery({
  activeRoot: tmp,
  reportPath: transientReport,
  memoryPaths: [memory],
  artifactManifestEntries: [transientReport, memory],
  snapshot,
  createdAt: '2026-07-22T08:02:00Z',
  fs: transientSidecarFs,
  platform: 'win32',
  windowsFsRetryMaxAttempts: 3,
  windowsFsRetryDelayMs: 0
})
assert.strictEqual(transientDelivery.projection.workflowComplete, true)
assert.strictEqual(transientSidecarOpenAttempts, 3)
assert.strictEqual(transientSidecarUnlinkAttempts, 2)

const lockedReport = path.join(repDir, '08--locked-sidecar.md')
fs.writeFileSync(lockedReport, `# locked\n${formatWorkflowCompletionReportRef(createWorkflowCompletionReportRef(snapshot, lockedReport))}\n`)
const lockedSidecar = `${lockedReport}.completion.json`
fs.writeFileSync(`${lockedSidecar}.lock`, '{"fixture":true}\n', 'utf8')
try {
  assert.throws(() => commitWorkflowCompletionDelivery({
    activeRoot: tmp, reportPath: lockedReport, memoryPaths: [memory], artifactManifestEntries: [lockedReport, memory],
    snapshot, createdAt: '2026-07-22T08:02:00Z'
  }), error => error.code === 'WORKFLOW_SIDECAR_LOCKED')
  assert.strictEqual(fs.existsSync(lockedSidecar), false)
} finally {
  fs.unlinkSync(`${lockedSidecar}.lock`)
}

const originalGood = fs.readFileSync(good, 'utf8')
fs.appendFileSync(good, '\npost-commit mutation\n')
const reverseIdentity = resolveWorkflowCompletionReport({ activeRoot: tmp, reportPath: good, snapshot, nowMs })
assert.strictEqual(reverseIdentity.status, 'UNVERIFIED')
assert.strictEqual(reverseIdentity.errorCode, 'WORKFLOW_COMMIT_INVALID')
assert(reverseIdentity.errors.includes('commit-report-reverse-identity-mismatch'))
fs.writeFileSync(good, originalGood, 'utf8')

assert.throws(() => commitWorkflowCompletionDelivery({
  activeRoot: tmp, reportPath: markerOnly, memoryPaths: [], artifactManifestEntries: [markerOnly], snapshot,
  createdAt: '2026-07-22T08:02:00Z'
}), error => error.code === 'WORKFLOW_MEMORY_RECEIPT_REQUIRED')

fs.rmSync(tmp, { recursive: true, force: true })

console.log('completion-report-ecr-check tests passed: falseGreen=4 legacy=UNVERIFIED marker-only=UNVERIFIED selected-only=committed-blocked review-only=UNVERIFIED structured=committed-complete reverse-identity=closed')
