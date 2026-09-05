#!/usr/bin/env node
'use strict'

const assert = require('assert')
const childProcess = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  RECENT_REQUIREMENT_ARTIFACT_DAYS,
  HISTORICAL_TEMPLATE_DISPOSITION_SCHEMA,
  checkArtifactTemplateFile,
  checkActualCandidateEvidence,
  hasSimpleTaskFastPathMarker,
  collectRecentBugArtifactIssues,
  collectRecentRequirementArtifactIssues,
  validateHistoricalTemplateDispositions
} = require('./lib/requirement-artifact-check')
const { buildActualCandidateEvidenceReceipt } = require('./lib/actual-candidate-evidence')
const { createArtifactTemplateBinding } = require('../hooks/_runtime/artifact-template-contract.cjs')

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
}

function setAge(filePath, daysAgo) {
  const time = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)
  fs.utimesSync(filePath, time, time)
}

function qualifiedTemplateText(slot, filePath, intent = 'dev') {
  const binding = createArtifactTemplateBinding({ slot, target: filePath, intent })
  return `${binding.requiredSemanticIds.map(semanticId => {
    if (semanticId === 'document-title') return '# Fixture implementation plan\n\n> **类型**：dev'
    return semanticId.startsWith('heading:') ? `## ${semanticId.slice('heading:'.length).replace(/-/g, ' ')}` : ''
  }).filter(Boolean).join('\n\n')}\n`
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-v41-'))

try {
  const requirementsRoot = path.join(tempRoot, 'requirements')
  const bugsRoot = path.join(tempRoot, 'bugs')
  const overlayProject = path.basename(tempRoot)

  write(path.join(tempRoot, 'profile', 'artifact-slot-registry.overlay.v2.json'), JSON.stringify({
    schemaVersion: 'ArtifactSlotRegistryOverlayV2',
    contractVersion: '2',
    project: overlayProject,
    baseRegistryId: 'devcodex-shipped-base-v2',
    constraints: { mayWidenProtected: false, allowedRootClasses: ['active-root', 'project-root', 'logical'] },
    slotExtensions: [],
    slots: [{
      slotId: 'fixture-task-http-verification',
      rootClass: 'active-root',
      scope: 'task',
      taskKinds: ['requirements', 'bugs'],
      artifactClass: 'http-verification',
      stage: 'verification',
      relativePatterns: ['^verify\\.http$'],
      alternativeGroup: null,
      writePolicy: 'bounded-path',
      owner: 'task-owner',
      mutability: 'mutable',
      protected: false,
      destructivePolicy: 'confirm'
    }]
  }, null, 2))
  const baseRegistry = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'hooks', '_runtime', 'artifact-slot-registry.v2.json'),
    'utf8'
  ))
  const slot = slotId => baseRegistry.slots.find(item => item.slotId === slotId)

  const goodRequirementOverview = path.join(requirementsRoot, 'good-requirement', '00-需求概况.md')
  const goodRequirementCp1 = path.join(requirementsRoot, 'good-requirement', '01-需求确认.md')
  const goodRequirementPlan = path.join(requirementsRoot, 'good-requirement', '04-实施计划.md')
  const goodRequirementProgress = path.join(requirementsRoot, 'good-requirement', '05-实施进度.md')
  write(goodRequirementOverview, qualifiedTemplateText(slot('requirement-overview'), goodRequirementOverview))
  write(goodRequirementCp1, qualifiedTemplateText(slot('requirement-cp1'), goodRequirementCp1))
  write(goodRequirementPlan, `${qualifiedTemplateText(slot('implementation-plan'), goodRequirementPlan)}\n> 计划模式：轻计划摘要\n\n## 回滚摘要\n`)
  write(goodRequirementProgress, `${qualifiedTemplateText(slot('implementation-progress'), goodRequirementProgress)}\n> 当前轮次：R1\n> 当前 CP：执行中\n> 当前批次：Batch 1 / 3\n\n## 进度总览\n\n## 支撑产物状态\n\n**本轮验证结果**：\n\n## 阻塞与恢复\n\n## 下一步\n\n## 变更记录\n`)
  write(path.join(requirementsRoot, 'good-requirement', 'verify.http'), 'GET http://localhost/health\n')

  const goodChangeOverview = path.join(requirementsRoot, 'good-change', '00-需求变更概况.md')
  const goodChangeCp1 = path.join(requirementsRoot, 'good-change', '01-需求变更确认.md')
  const goodProductCp1 = path.join(requirementsRoot, 'good-product-requirement', '01-产品需求.md')
  write(goodChangeOverview, qualifiedTemplateText(slot('requirement-overview'), goodChangeOverview))
  write(goodChangeCp1, qualifiedTemplateText(slot('requirement-cp1'), goodChangeCp1))
  write(goodProductCp1, qualifiedTemplateText(slot('requirement-cp1'), goodProductCp1))

  write(path.join(requirementsRoot, 'bad-requirement', '00-需求概况.md'), '# bad overview\n')
  write(path.join(requirementsRoot, 'bad-requirement', '01-需求确认.md'), '# bad\n')
  write(path.join(requirementsRoot, 'bad-product-requirement', '01-产品需求.md'), '# bad product requirement\n')
  write(path.join(requirementsRoot, 'bad-change', '00-需求变更概况.md'), '# bad change overview\n')
  write(path.join(requirementsRoot, 'bad-change', '01-需求变更确认.md'), '# bad change\n')
  write(path.join(requirementsRoot, 'bad-requirement', '04-实施计划.md'), [
    '# bad plan',
    '',
    '## 目录导航',
    '',
    '## 验证路线'
  ].join('\n'))
  write(path.join(requirementsRoot, 'bad-requirement', '05-实施进度.md'), [
    '# bad progress',
    '',
    '> 当前轮次：R1',
    '> 当前 CP：执行中',
    '',
    '## 目录导航',
    '',
    '## 进度总览'
  ].join('\n'))

  write(path.join(requirementsRoot, 'old-requirement', '01-需求概述.md'), '# old\n')
  setAge(path.join(requirementsRoot, 'old-requirement', '01-需求概述.md'), RECENT_REQUIREMENT_ARTIFACT_DAYS + 10)

  write(path.join(requirementsRoot, 'simple-fast-path', '.memory', 'sessions.md'), [
    '# sessions',
    '',
    'SimpleTaskFastPath: applied',
    '00-需求概况.md: N/A + skipReason',
    '01-需求确认.md: N/A + skipReason',
    '01-产品需求.md: N/A + skipReason',
    '04-实施计划.md: N/A + skipReason'
  ].join('\n'))

  const goodBugOverview = path.join(bugsRoot, 'good-bug', '00-问题概况.md')
  const goodBugCp1 = path.join(bugsRoot, 'good-bug', '01-问题确认.md')
  const goodBugCp2 = path.join(bugsRoot, 'good-bug', '02-修复方案.md')
  write(goodBugOverview, qualifiedTemplateText(slot('bug-overview'), goodBugOverview, 'fix'))
  write(goodBugCp1, `${qualifiedTemplateText(slot('bug-cp1'), goodBugCp1, 'fix')}\n## 目录导航\n`)
  write(goodBugCp2, qualifiedTemplateText(slot('bug-cp2'), goodBugCp2, 'fix'))
  write(path.join(bugsRoot, 'bad-bug', '00-问题概况.md'), '# bad bug overview\n')
  write(path.join(bugsRoot, 'bad-bug', '01-问题确认.md'), '# bad bug confirmation\n')
  write(path.join(bugsRoot, 'unknown-only-bug', '02-功能清单.md'), '# misplaced inventory\n')
  write(path.join(bugsRoot, 'simple-fast-path-bug', '.memory', 'sessions.md'), [
    '# sessions',
    '',
    'SimpleTaskFastPath: applied',
    '00-问题概况.md: N/A + skipReason',
    '01-问题确认.md: N/A + skipReason'
  ].join('\n'))

  write(path.join(requirementsRoot, 'bad-template-pr1', '03-方案复审-PR1.md'), '# invalid PR1\n')
  write(path.join(requirementsRoot, 'good-template-pr1', '03-方案复审-PR1.md'), [
    '# Good PR1',
    '',
    '## 审查范围',
    '',
    '## 需求与方案映射',
    '',
    '## 代码实况',
    '',
    '## 阻断项快照',
    '',
    '## 复核结论',
    '',
    '## 专项审查维度'
  ].join('\n'))

  const { checkedDirs, issues, mergedRegistryDigest, registrySlotCount } = collectRecentRequirementArtifactIssues({
    activeRoot: tempRoot,
    recentDays: RECENT_REQUIREMENT_ARTIFACT_DAYS
  })

  assert.match(mergedRegistryDigest, /^[a-f0-9]{64}$/)
  assert(baseRegistry.slots.some(slot => slot.slotId === 'project-host-governance'))
  assert.strictEqual(
    registrySlotCount,
    baseRegistry.slots.length + 1,
    'requirement consumer must load the current base registry plus the project-bound overlay slot'
  )

  assert(checkedDirs.includes('good-requirement'))
  assert(checkedDirs.includes('good-change'))
  assert(checkedDirs.includes('good-product-requirement'))
  assert(checkedDirs.includes('bad-requirement'))
  assert(checkedDirs.includes('bad-change'))
  assert(checkedDirs.includes('bad-product-requirement'))
  assert(checkedDirs.includes('bad-template-pr1'))
  assert(checkedDirs.includes('good-template-pr1'))
  assert(!checkedDirs.includes('old-requirement'))
  assert(!checkedDirs.includes('simple-fast-path'))
  assert(hasSimpleTaskFastPathMarker(path.join(requirementsRoot, 'simple-fast-path')))
  assert(issues.some(item => item.includes('bad-requirement/00-需求概况.md missing "## 目录导航"')))
  assert(issues.some(item => item.includes('bad-requirement/01-需求确认.md missing "## 目录导航"')))
  assert(issues.some(item => item.includes('bad-product-requirement/01-产品需求.md missing "## 目录导航"')))
  assert(issues.some(item => item.includes('bad-change/00-需求变更概况.md missing "## 目录导航"')))
  assert(issues.some(item => item.includes('bad-change/01-需求变更确认.md missing "## 目录导航"')))
  assert(issues.some(item => item.includes('bad-requirement/04-实施计划.md missing plan mode')))
  assert(issues.some(item => item.includes('bad-requirement/04-实施计划.md missing rollback section')))
  assert(issues.some(item => item.includes('bad-requirement/05-实施进度.md missing "支撑产物状态"')))
  assert(issues.some(item => item.includes('bad-template-pr1/03-方案复审-PR1.md template qualification artifact-template-required-semantic-missing:')))
  assert(!issues.some(item => item.includes('good-requirement')), JSON.stringify(issues.filter(item => item.includes('good-requirement'))))
  assert(!issues.some(item => item.includes('good-product-requirement')))
  assert(!issues.some(item => item.includes('good-template-pr1')))

  const pr1Slot = baseRegistry.slots.find(slot => slot.slotId === 'plan-review-pr1')
  const invalidPr1Path = path.join(requirementsRoot, 'bad-template-pr1', '03-方案复审-PR1.md')
  assert.strictEqual(checkArtifactTemplateFile({ slot: pr1Slot, filePath: invalidPr1Path }).passed, false)
  const deletedValidatorResult = checkArtifactTemplateFile({
    slot: { ...pr1Slot, templateValidator: undefined },
    filePath: invalidPr1Path
  })
  assert.strictEqual(deletedValidatorResult.passed, false, 'deleting the validator contract must keep invalid fixtures red')
  assert(deletedValidatorResult.issues.includes('ARTIFACT_TEMPLATE_BINDING_INVALID'))

  const reportSlot = baseRegistry.slots.find(slot => slot.slotId === 'task-report')
  const auditReportPath = path.join(requirementsRoot, 'good-requirement', 'reports', 'codex', '20260831', '09--独立复审报告.md')
  const auditBinding = createArtifactTemplateBinding({ slot: reportSlot, target: auditReportPath, intent: 'audit' })
  const auditLines = auditBinding.requiredSemanticIds.map(semanticId => {
    if (semanticId === 'document-title') return '# 独立复审报告\n\n> **类型**：audit'
    return semanticId.startsWith('heading:') ? `## ${semanticId.slice('heading:'.length).replace(/-/g, ' ')}` : ''
  }).filter(Boolean)
  write(auditReportPath, `${auditLines.join('\n\n')}\n`)
  assert.strictEqual(checkArtifactTemplateFile({ slot: reportSlot, filePath: auditReportPath }).passed, true,
    'the artifact checker must honor the report workflow declared by the artifact instead of defaulting every report to dev')
  assert.strictEqual(checkArtifactTemplateFile({ slot: reportSlot, filePath: auditReportPath, intent: 'dev' }).passed, false,
    'an explicit caller intent remains authoritative')

  const devRepairReportPath = path.join(requirementsRoot, 'good-requirement', 'reports', 'codex', '20260831', '10--Stage-A修复交付.md')
  const devRepairBinding = createArtifactTemplateBinding({ slot: reportSlot, target: devRepairReportPath, intent: 'dev' })
  const devRepairLines = devRepairBinding.requiredSemanticIds.map(semanticId => {
    if (semanticId === 'document-title') return '# Stage A 修复交付\n\n> **类型**：dev'
    return semanticId.startsWith('heading:') ? `## ${semanticId.slice('heading:'.length).replace(/-/g, ' ')}` : ''
  }).filter(Boolean)
  write(devRepairReportPath, `${devRepairLines.join('\n\n')}\n`)
  assert.strictEqual(checkArtifactTemplateFile({ slot: reportSlot, filePath: devRepairReportPath }).passed, true,
    'a declared dev report must keep the dev template even when its filename contains 修复')

  const planSlot = baseRegistry.slots.find(slot => slot.slotId === 'implementation-plan')
  const dispositionDir = path.join(requirementsRoot, 'historical-template-disposition')
  const historicalPath = path.join(dispositionDir, '04-实施计划-v0.1.0.md')
  const replacementPath = path.join(dispositionDir, '04-实施计划-v0.1.1.md')
  const futurePath = path.join(dispositionDir, '04-实施计划-v0.1.2.md')
  write(path.join(dispositionDir, '00-需求概况.md'), '# overview\n\n## 目录导航\n')
  write(historicalPath, '# invalid historical plan\n\ntemplateBindingStatus: qualified-v1\n')
  write(replacementPath, qualifiedTemplateText(planSlot, replacementPath))
  write(futurePath, qualifiedTemplateText(planSlot, futurePath))
  write(path.join(dispositionDir, '.memory', 'sessions.md'), [
    '# sessions',
    '',
    '| CP | 状态 | artifactPath | version | sha256 | sourceMessage | confirmedAt |',
    '|:--:|:----:|--------------|---------|--------|---------------|-------------|',
    `| CP3 | ✅ | [04-实施计划-v0.1.1.md](../04-实施计划-v0.1.1.md) | v0.1.1-candidate | \`${crypto.createHash('sha256').update(fs.readFileSync(replacementPath)).digest('hex')}\` | confirm | now |`,
    ''
  ].join('\n'))
  const validDisposition = {
    schemaVersion: HISTORICAL_TEMPLATE_DISPOSITION_SCHEMA,
    entries: [{
      relativePath: '04-实施计划-v0.1.0.md',
      artifactSha256: crypto.createHash('sha256').update(fs.readFileSync(historicalPath)).digest('hex'),
      candidateVersion: 'v0.1.0-candidate',
      disposition: 'superseded-confirmed',
      replacementPath: '04-实施计划-v0.1.1.md',
      replacementSha256: crypto.createHash('sha256').update(fs.readFileSync(replacementPath)).digest('hex'),
      reasonCode: 'historical-semantic-mismatch'
    }]
  }
  const dispositionSidecar = path.join(dispositionDir, '.memory', 'artifact-template-dispositions.json')
  const dispositionInventory = () => require('../hooks/_runtime/artifact-slot-decision.cjs').enumerateTaskArtifacts({
    taskRoot: dispositionDir,
    taskKind: 'requirements',
    activeRoot: tempRoot,
    project: overlayProject,
    registry: require('../hooks/_runtime/artifact-slot-decision.cjs').readLayeredArtifactSlotRegistry({ activeRoot: tempRoot, project: overlayProject, fs }),
    fs
  })
  const writeDisposition = value => write(dispositionSidecar, `${JSON.stringify(value, null, 2)}\n`)
  writeDisposition(validDisposition)
  assert.strictEqual(validateHistoricalTemplateDispositions(dispositionDir, dispositionInventory()).valid, true)
  const dispositionCollection = collectRecentRequirementArtifactIssues({ activeRoot: tempRoot, project: overlayProject })
  assert(!dispositionCollection.issues.some(issue => issue.startsWith('historical-template-disposition/04-实施计划-v0.1.0.md template qualification')),
    'an exact digest-bound historical disposition must isolate only the declared failing candidate')

  write(historicalPath, '# tampered historical plan\ntemplateBindingStatus: qualified-v1\n')
  assert(validateHistoricalTemplateDispositions(dispositionDir, dispositionInventory()).issues.some(issue => issue.includes('artifact-digest-mismatch')))
  write(historicalPath, '# invalid historical plan\n\ntemplateBindingStatus: qualified-v1\n')
  writeDisposition({ ...validDisposition, entries: [...validDisposition.entries, { ...validDisposition.entries[0] }] })
  assert(validateHistoricalTemplateDispositions(dispositionDir, dispositionInventory()).issues.some(issue => issue.includes('duplicate-relative-path')))
  writeDisposition({ ...validDisposition, entries: [{ ...validDisposition.entries[0], relativePath: '../outside.md' }] })
  assert(validateHistoricalTemplateDispositions(dispositionDir, dispositionInventory()).issues.some(issue => issue.includes('relative-path-invalid')))
  writeDisposition({ ...validDisposition, entries: [{
    ...validDisposition.entries[0],
    relativePath: '04-实施计划-v0.1.1.md',
    artifactSha256: crypto.createHash('sha256').update(fs.readFileSync(replacementPath)).digest('hex'),
    candidateVersion: 'v0.1.1-candidate',
    replacementPath: '04-实施计划-v0.1.2.md',
    replacementSha256: crypto.createHash('sha256').update(fs.readFileSync(futurePath)).digest('hex')
  }] })
  assert(validateHistoricalTemplateDispositions(dispositionDir, dispositionInventory()).issues.some(issue => issue.includes('current-head-cannot-be-disposed')))
  write(replacementPath, '# invalid replacement\n')
  writeDisposition({ ...validDisposition, entries: [{
    ...validDisposition.entries[0],
    replacementSha256: crypto.createHash('sha256').update(fs.readFileSync(replacementPath)).digest('hex')
  }] })
  assert(validateHistoricalTemplateDispositions(dispositionDir, dispositionInventory()).issues.some(issue => issue.includes('replacement-not-qualified')))
  write(replacementPath, qualifiedTemplateText(planSlot, replacementPath))
  writeDisposition(validDisposition)

  const bugResult = collectRecentBugArtifactIssues({
    activeRoot: tempRoot,
    recentDays: RECENT_REQUIREMENT_ARTIFACT_DAYS
  })

  assert.strictEqual(bugResult.mergedRegistryDigest, mergedRegistryDigest)
  assert.strictEqual(bugResult.registrySlotCount, baseRegistry.slots.length + 1)

  assert(bugResult.checkedDirs.includes('good-bug'))
  assert(bugResult.checkedDirs.includes('bad-bug'))
  assert(bugResult.checkedDirs.includes('unknown-only-bug'))
  assert(!bugResult.checkedDirs.includes('simple-fast-path-bug'))
  assert(hasSimpleTaskFastPathMarker(path.join(bugsRoot, 'simple-fast-path-bug')))
  assert(bugResult.issues.some(item => item.includes('bad-bug/00-问题概况.md missing "## 目录导航"')))
  assert(bugResult.issues.some(item => item.includes('bad-bug/01-问题确认.md missing "## 目录导航"')))
  assert(bugResult.issues.some(item => item.includes('unknown-only-bug/02-功能清单.md unknown formal artifact slot')))
  assert(!bugResult.issues.some(item => item.includes('good-bug')), JSON.stringify(bugResult.issues.filter(item => item.includes('good-bug'))))

  const mismatchedOverlay = collectRecentRequirementArtifactIssues({
    activeRoot: tempRoot,
    project: 'wrong-project',
    recentDays: RECENT_REQUIREMENT_ARTIFACT_DAYS
  })
  assert.strictEqual(mismatchedOverlay.registryErrorCode, 'ARTIFACT_SLOT_REGISTRY_OVERLAY_INVALID')
  assert(mismatchedOverlay.issues.some(item => item.includes('artifact registry ARTIFACT_SLOT_REGISTRY_OVERLAY_INVALID')))

  childProcess.execFileSync('git', ['init', '--quiet', tempRoot], { windowsHide: true })
  childProcess.execFileSync('git', ['-C', tempRoot, 'config', 'core.autocrlf', 'false'], { windowsHide: true })
  childProcess.execFileSync('git', ['-C', tempRoot, 'add', '.'], { windowsHide: true })
  childProcess.execFileSync('git', [
    '-C', tempRoot,
    '-c', 'user.name=DevCodex Test',
    '-c', 'user.email=devcodex-test@example.invalid',
    'commit', '--quiet', '-m', 'requirement artifact baseline'
  ], { windowsHide: true })
  const actualSourceHead = childProcess.execFileSync('git', ['-C', tempRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    windowsHide: true
  }).trim()
  const actualCandidatePath = path.join(tempRoot, 'evidence', 'actual-ecr.md')
  write(actualCandidatePath, [
    '# Requirement artifact ECR execution closure review',
    `sourceHead: ${actualSourceHead}`,
    '> closureState: passed',
    '## ReviewGradeCard',
    '| field | value |',
    '|---|---|',
    '| reviewClass | R2 |',
    '## ReviewExecutionPlanV1',
    '- exact scope',
    '## evidenceLedger',
    '- targeted test',
    'openBlockers: 0',
    'dirty boundary: exact',
    'release/publish 未执行，版本发布冻结',
    '## 复审结论',
    '- findings=[]; blockers=[]; missingEvidence=[]'
  ].join('\n'))
  const actualReceipt = buildActualCandidateEvidenceReceipt({
    candidatePath: actualCandidatePath,
    requestedPhase: 'ECR',
    sourceRoot: tempRoot,
    allowedRoots: [tempRoot],
    generatedAt: '2026-08-24T16:00:00.000Z'
  })
  assert.strictEqual(actualReceipt.passed, true, JSON.stringify(actualReceipt.issues))
  const actualCheck = checkActualCandidateEvidence({
    candidatePath: actualCandidatePath,
    requestedPhase: 'ECR',
    sourceHead: actualReceipt.sourceHead,
    dirtyScopeDigest: actualReceipt.dirtyScopeDigest,
    receipt: actualReceipt,
    expectedReceiptDigest: actualReceipt.receiptDigest
  })
  assert.strictEqual(actualCheck.passed, true, JSON.stringify(actualCheck.issues))
  assert.strictEqual(checkActualCandidateEvidence({ candidatePath: actualCandidatePath }).passed, false)
  const unboundActualCheck = checkActualCandidateEvidence({
    candidatePath: actualCandidatePath,
    requestedPhase: 'ECR',
    sourceHead: actualReceipt.sourceHead,
    dirtyScopeDigest: actualReceipt.dirtyScopeDigest,
    receipt: actualReceipt
  })
  assert.strictEqual(unboundActualCheck.passed, false)
  assert(unboundActualCheck.issues.some(item => item.includes('exact actual candidate receipt digest required')))
  const staleActualCheck = checkActualCandidateEvidence({
    candidatePath: actualCandidatePath,
    requestedPhase: 'CP3',
    sourceHead: actualReceipt.sourceHead,
    dirtyScopeDigest: actualReceipt.dirtyScopeDigest,
    receipt: actualReceipt,
    expectedReceiptDigest: actualReceipt.receiptDigest
  })
  assert.strictEqual(staleActualCheck.passed, false)
  assert(staleActualCheck.issues.some(item => item.includes('verification-requestedPhase-mismatch')))

  console.log('Requirement runtime artifact source-scope fixture checks passed; active-root V41 coverage is exercised by node scripts/validate.js')
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
