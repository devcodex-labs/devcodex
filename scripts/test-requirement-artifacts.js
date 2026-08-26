#!/usr/bin/env node
'use strict'

const assert = require('assert')
const childProcess = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  RECENT_REQUIREMENT_ARTIFACT_DAYS,
  checkActualCandidateEvidence,
  hasSimpleTaskFastPathMarker,
  collectRecentBugArtifactIssues,
  collectRecentRequirementArtifactIssues
} = require('./lib/requirement-artifact-check')
const { buildActualCandidateEvidenceReceipt } = require('./lib/actual-candidate-evidence')

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
}

function setAge(filePath, daysAgo) {
  const time = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)
  fs.utimesSync(filePath, time, time)
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

  write(path.join(requirementsRoot, 'good-requirement', '00-需求概况.md'), [
    '# overview',
    '',
    '## 目录导航',
    '',
    '- [需求一句话](#需求一句话)'
  ].join('\n'))
  write(path.join(requirementsRoot, 'good-requirement', '01-需求确认.md'), [
    '# good',
    '',
    '## 目录导航',
    '',
    '- [背景](#背景)'
  ].join('\n'))
  write(path.join(requirementsRoot, 'good-requirement', '04-实施计划.md'), [
    '# plan',
    '',
    '> 计划模式：轻计划摘要',
    '',
    '## 目录导航',
    '',
    '## 验证路线',
    '',
    '## 回滚摘要'
  ].join('\n'))
  write(path.join(requirementsRoot, 'good-requirement', '05-实施进度.md'), [
    '# progress',
    '',
    '> 当前轮次：R1',
    '> 当前 CP：执行中',
    '> 当前批次：Batch 1 / 3',
    '',
    '## 目录导航',
    '',
    '## 进度总览',
    '',
    '## 支撑产物状态',
    '',
    '**本轮验证结果**：',
    '',
    '## 阻塞与恢复',
    '',
    '## 下一步',
    '',
    '## 变更记录'
  ].join('\n'))
  write(path.join(requirementsRoot, 'good-requirement', 'verify.http'), 'GET http://localhost/health\n')

  write(path.join(requirementsRoot, 'good-change', '00-需求变更概况.md'), [
    '# change overview',
    '',
    '## 目录导航',
    '',
    '- [原需求基线](#原需求基线)'
  ].join('\n'))
  write(path.join(requirementsRoot, 'good-change', '01-需求变更确认.md'), [
    '# change',
    '',
    '## 目录导航',
    '',
    '- [变更前后差异](#变更前后差异)'
  ].join('\n'))
  write(path.join(requirementsRoot, 'good-product-requirement', '01-产品需求.md'), [
    '# product requirement',
    '',
    '## 目录导航',
    '',
    '- [产品完整需求](#产品完整需求)'
  ].join('\n'))

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

  write(path.join(bugsRoot, 'good-bug', '00-问题概况.md'), [
    '# bug overview',
    '',
    '## 目录导航',
    '',
    '- [重现步骤](#重现步骤)'
  ].join('\n'))
  write(path.join(bugsRoot, 'good-bug', '01-问题确认.md'), [
    '# bug confirmation',
    '',
    '## 目录导航',
    '',
    '- [根因](#根因)'
  ].join('\n'))
  write(path.join(bugsRoot, 'good-bug', '02-修复方案.md'), '# fix design\n')
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

  const { checkedDirs, issues, mergedRegistryDigest, registrySlotCount } = collectRecentRequirementArtifactIssues({
    activeRoot: tempRoot,
    recentDays: RECENT_REQUIREMENT_ARTIFACT_DAYS
  })

  assert.match(mergedRegistryDigest, /^[a-f0-9]{64}$/)
  const baseRegistry = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'hooks', '_runtime', 'artifact-slot-registry.v2.json'),
    'utf8'
  ))
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
  assert(!issues.some(item => item.includes('good-requirement')))
  assert(!issues.some(item => item.includes('good-product-requirement')))

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
  assert(!bugResult.issues.some(item => item.includes('good-bug')))

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
