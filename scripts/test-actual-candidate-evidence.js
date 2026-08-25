#!/usr/bin/env node
'use strict'

const assert = require('assert')
const childProcess = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  buildActualCandidateEvidenceReceipt,
  buildCandidateConfirmationBinding,
  digest,
  validateActualCandidateEvidenceReceipt,
  verifyActualCandidateEvidenceReceipt
} = require('./lib/actual-candidate-evidence')
const { candidateClassifierRuleDigest } = require('./lib/candidate-review-bundle')

const ROOT = path.resolve(__dirname, '..')
const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'candidate-review-bundle')
let SOURCE_HEAD = null
const GENERATED_AT = '2026-08-24T16:00:00.000Z'
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-actual-candidate-'))

function writeCandidate(name, content) {
  const filePath = path.join(tempRoot, name)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
  return filePath
}

function cp3Candidate() {
  return [
    '---',
    'phaseKind: CP3',
    'documentKind: implementation-plan-candidate',
    'candidateVersion: v-test-candidate',
    `sourceHead: ${SOURCE_HEAD}`,
    'productImplementationAuthorized: false',
    'releaseAuthorized: false',
    '---',
    '',
    '# CP3 implementation plan candidate',
    '',
    '## 任务分解',
    '',
    '- implement exact gate',
    '',
    '## 分批执行策略',
    '',
    '- one writer',
    '',
    '## 独立验证方式',
    '',
    '- targeted positive and negative probes',
    '',
    '## 风险、回滚与回退条件',
    '',
    '- revert the bounded patch',
    '',
    '## 里程碑与完成定义',
    '',
    '- exact receipt is fresh',
    '',
    '## 执行与授权边界',
    '',
    '- release remains frozen'
  ].join('\n')
}

function ecrCandidate(openBlockers = 0) {
  return [
    '# Actual candidate ECR execution closure review',
    '',
    `sourceHead: ${SOURCE_HEAD}`,
    '> closureState: passed',
    '',
    '## ReviewGradeCard',
    '',
    '| field | value |',
    '|---|---|',
    '| reviewClass | R3 |',
    '',
    '## ReviewExecutionPlanV1',
    '',
    '- bounded affected review',
    '',
    '## evidenceLedger',
    '',
    '- targeted tests passed',
    '',
    `openBlockers: ${openBlockers}`,
    'dirty boundary: exact changed set',
    'release/publish 未执行，版本发布冻结',
    '',
    '## 复审结论',
    '',
    '- findings=[]; blockers=[]; missingEvidence=[]'
  ].join('\n')
}

function build(filePath, requestedPhase, overrides = {}) {
  return buildActualCandidateEvidenceReceipt({
    candidatePath: filePath,
    requestedPhase,
    sourceRoot: tempRoot,
    allowedRoots: [tempRoot],
    generatedAt: GENERATED_AT,
    ...overrides
  })
}

try {
  childProcess.execFileSync('git', ['init', '--quiet', tempRoot], { windowsHide: true })
  childProcess.execFileSync('git', ['-C', tempRoot, 'config', 'core.autocrlf', 'false'], { windowsHide: true })
  fs.writeFileSync(path.join(tempRoot, '.baseline'), 'actual-candidate source baseline\n', 'utf8')
  childProcess.execFileSync('git', ['-C', tempRoot, 'add', '.baseline'], { windowsHide: true })
  childProcess.execFileSync('git', [
    '-C', tempRoot,
    '-c', 'user.name=DevCodex Test',
    '-c', 'user.email=devcodex-test@example.invalid',
    'commit', '--quiet', '-m', 'test baseline'
  ], { windowsHide: true })
  SOURCE_HEAD = childProcess.execFileSync('git', ['-C', tempRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    windowsHide: true
  }).trim()

  const candidates = {
    CP1: writeCandidate('cp1.md', fs.readFileSync(path.join(FIXTURE_ROOT, 'cp1-ready.md'), 'utf8')),
    CP2: writeCandidate('cp2.md', fs.readFileSync(path.join(FIXTURE_ROOT, 'cp2-ready.md'), 'utf8')),
    CP3: writeCandidate('cp3.md', cp3Candidate()),
    ECR: writeCandidate('ecr.md', ecrCandidate())
  }

  for (const [phase, candidatePath] of Object.entries(candidates)) {
    const before = fs.readdirSync(tempRoot).sort()
    const receipt = build(candidatePath, phase)
    const after = fs.readdirSync(tempRoot).sort()
    assert.strictEqual(receipt.passed, true, `${phase}: ${JSON.stringify(receipt.issues)}`)
    assert.strictEqual(receipt.actualPathEvidence, true)
    assert.strictEqual(receipt.fixtureOnly, false)
    assert.strictEqual(receipt.requestedPhase, phase)
    assert.strictEqual(receipt.detectedPhase, phase)
    assert.deepStrictEqual(validateActualCandidateEvidenceReceipt(receipt).issues, [])
    assert.deepStrictEqual(before, after, 'candidate evaluation must not create evidence files')
    const verification = verifyActualCandidateEvidenceReceipt(receipt, {
      requestedPhase: phase,
      sourceHead: receipt.sourceHead,
      dirtyScopeDigest: receipt.dirtyScopeDigest,
      expectedReceiptDigest: receipt.receiptDigest
    })
    assert.strictEqual(verification.fresh, true, `${phase}: ${JSON.stringify(verification.issues)}`)
    const confirmation = buildCandidateConfirmationBinding(receipt)
    assert.strictEqual(confirmation.qualified, true)
    assert.strictEqual(confirmation.artifactDigest, receipt.candidateDigest)
    assert.strictEqual(confirmation.receiptDigest, receipt.receiptDigest)
  }

  const fixtureOnly = buildActualCandidateEvidenceReceipt({
    candidatePath: path.join(FIXTURE_ROOT, 'cp2-ready.md'),
    requestedPhase: 'CP2',
    sourceRoot: tempRoot,
    allowedRoots: [ROOT],
    generatedAt: GENERATED_AT
  })
  assert.strictEqual(fixtureOnly.passed, false)
  assert(fixtureOnly.issues.some(item => item.code === 'fixture-only-evidence'))
  assert.strictEqual(validateActualCandidateEvidenceReceipt(fixtureOnly).valid, true)

  const callerSuppliedIdentityOnly = buildActualCandidateEvidenceReceipt({
    candidatePath: candidates.CP2,
    requestedPhase: 'CP2',
    sourceHead: SOURCE_HEAD,
    dirtyScopeDigest: 'b'.repeat(64),
    generatedAt: GENERATED_AT
  })
  assert.strictEqual(callerSuppliedIdentityOnly.passed, false)
  assert(callerSuppliedIdentityOnly.issues.some(item => item.code === 'source-identity-unavailable'))
  assert.strictEqual(validateActualCandidateEvidenceReceipt(callerSuppliedIdentityOnly).valid, true)

  const wrongPhase = build(candidates.CP2, 'CP1')
  assert.strictEqual(wrongPhase.passed, false)
  assert(wrongPhase.issues.some(item => item.code === 'candidate-phase-mismatch'))
  const wrongEcrPhase = build(candidates.ECR, 'CP3')
  assert.strictEqual(wrongEcrPhase.passed, false)
  assert(wrongEcrPhase.issues.some(item => item.code === 'candidate-phase-mismatch'))

  const missingFieldPath = writeCandidate('cp3-missing-validation.md', cp3Candidate().replace('## 独立验证方式', '## 检查'))
  const missingField = build(missingFieldPath, 'CP3')
  assert.strictEqual(missingField.passed, false)
  assert(missingField.candidateReviewReceipt.missingFields.includes('ValidationRoute'))
  assert(missingField.issues.some(item => item.code === 'candidate-review-not-ready'))

  const openBlockerPath = writeCandidate('ecr-open.md', ecrCandidate(2))
  const openBlocker = build(openBlockerPath, 'ECR')
  assert.strictEqual(openBlocker.passed, false)
  assert.strictEqual(openBlocker.candidateReviewReceipt.openBlockers, 2)
  assert(openBlocker.issues.some(item => item.code === 'candidate-open-blockers'))
  assert.strictEqual(validateActualCandidateEvidenceReceipt(openBlocker).valid, true)

  const bindingDrift = build(candidates.CP3, 'CP3', {
    expectedCandidateDigest: '0'.repeat(64),
    expectedSourceHead: 'c'.repeat(40),
    expectedDirtyScopeDigest: 'd'.repeat(64),
    expectedClassifierRuleDigest: 'e'.repeat(64)
  })
  assert.strictEqual(bindingDrift.passed, false)
  assert.strictEqual(validateActualCandidateEvidenceReceipt(bindingDrift).valid, true)
  for (const code of [
    'candidate-digest-mismatch',
    'source-head-mismatch',
    'dirty-scope-digest-mismatch',
    'classifier-rule-digest-mismatch'
  ]) {
    assert(bindingDrift.issues.some(item => item.code === code), `missing ${code}`)
  }

  const declaredHeadDriftPath = writeCandidate(
    'cp3-head-drift.md',
    cp3Candidate().replace(`sourceHead: ${SOURCE_HEAD}`, `sourceHead: ${'f'.repeat(40)}`)
  )
  const declaredHeadDrift = build(declaredHeadDriftPath, 'CP3')
  assert(declaredHeadDrift.issues.some(item => item.code === 'candidate-source-head-mismatch'))

  const historicalEcrPath = writeCandidate(
    'ecr-historical-head.md',
    ecrCandidate().replace(`sourceHead: ${SOURCE_HEAD}`, `source baseline=${'8'.repeat(40)}`)
  )
  const historicalEcr = build(historicalEcrPath, 'ECR')
  assert.strictEqual(historicalEcr.declaredSourceHead, '8'.repeat(40))
  assert(historicalEcr.issues.some(item => item.code === 'candidate-source-head-mismatch'))
  assert.strictEqual(validateActualCandidateEvidenceReceipt(historicalEcr).valid, true)
  const forgedHistoricalEcr = JSON.parse(JSON.stringify(historicalEcr))
  forgedHistoricalEcr.issues = []
  forgedHistoricalEcr.passed = true
  delete forgedHistoricalEcr.receiptDigest
  forgedHistoricalEcr.receiptDigest = digest(forgedHistoricalEcr)
  assert(
    validateActualCandidateEvidenceReceipt(forgedHistoricalEcr).issues
      .some(item => item.code === 'receipt-source-head-mismatch-unexplained')
  )
  const unboundEcrPath = writeCandidate(
    'ecr-source-head-missing.md',
    ecrCandidate().replace(`sourceHead: ${SOURCE_HEAD}\n`, '')
  )
  const unboundEcr = build(unboundEcrPath, 'ECR')
  assert(unboundEcr.issues.some(item => item.code === 'candidate-source-head-missing'))

  const readbackPath = writeCandidate('cp3-readback.md', cp3Candidate())
  const readbackReceipt = build(readbackPath, 'CP3')
  fs.appendFileSync(readbackPath, '\npost-receipt drift\n', 'utf8')
  const staleReadback = verifyActualCandidateEvidenceReceipt(readbackReceipt)
  assert.strictEqual(staleReadback.fresh, false)
  assert(staleReadback.issues.some(item => item.code === 'candidate-content-drift'))

  const tampered = JSON.parse(JSON.stringify(build(candidates.CP1, 'CP1')))
  tampered.sourceHead = '9'.repeat(40)
  assert(validateActualCandidateEvidenceReceipt(tampered).issues.some(item => item.code === 'receipt-digest-mismatch'))

  const stagedDriftReceipt = build(candidates.CP2, 'CP2')
  childProcess.execFileSync('git', ['-C', tempRoot, 'add', candidates.CP2], { windowsHide: true })
  const stagedDrift = verifyActualCandidateEvidenceReceipt(stagedDriftReceipt)
  assert(stagedDrift.issues.some(item => item.code === 'dirty-scope-drift'))

  assert.strictEqual(digest(fs.readFileSync(candidates.CP3)), build(candidates.CP3, 'CP3').candidateDigest)
  assert.strictEqual(build(candidates.CP3, 'CP3').classifierRuleDigest, candidateClassifierRuleDigest())
  console.log('actual candidate evidence gate tests passed')
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
