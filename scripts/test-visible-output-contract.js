#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  ACTION_HEADINGS,
  INTERNAL_ARTIFACT_CLASSES,
  classifyArtifactTruthSource,
  createArtifactAnchor,
  createArtifactDeliveryManifest,
  buildSimpleGovernanceFastPathDecision,
  classifyArtifactPathColumnSample,
  createLinkCapabilityDecision,
  createVisibleEnvelope,
  analyzeFinalValidationSummarySample,
  analyzeDialogueNarrativeSample,
  projectArtifactAnchorsFromManifest,
  projectUserFacingArtifactSet,
  renderVisibleEnvelope,
  classifyDialogueNarrativeSample,
  classifyFinalValidationSummarySample,
  hasReadableNarrativeSnippet,
  shouldUseCompact
} = require('../hooks/_runtime/visible-output-contract.cjs')
const ROOT = path.resolve(__dirname, '..')
const WORKSPACE = path.dirname(ROOT)

function entry(id, overrides = {}) {
  return {
    artifactId: id,
    canonicalPath: path.join(WORKSPACE, '.devcodex', 'devcodex-v1', `${id}.md`),
    previousPath: null,
    lifecycleOperation: 'update',
    origin: 'execution-contract',
    ownership: 'report',
    artifactClass: 'report',
    deliveryRequirement: 'supporting',
    visibility: 'optional-detail',
    displayName: `${id} 的语义交付说明`,
    purposeKey: `${id}-purpose`,
    purposeText: `说明 ${id} 对本次结论的用途`,
    userAction: '按需查看',
    readingOrder: 30,
    contentDigest: `digest-${id}`,
    evidenceRefs: [`evidence-${id}`],
    ...overrides
  }
}

function manifest(entries, overrides = {}) {
  const ids = entries.map(item => item.artifactId)
  return createArtifactDeliveryManifest({
    taskId: 'visible-output-fixture',
    candidateIdentity: 'candidate-visible-v1',
    generatedAt: '2026-07-19T10:00:00.000Z',
    entries,
    plannedArtifactIds: ids,
    observedArtifactIds: ids,
    internalDeliveredArtifactIds: ids,
    ...overrides
  })
}

function checks(localizedSuffix = '') {
  return Array.from({ length: 8 }, (_, ordinal) => ({
    id: `PC${ordinal}`,
    ordinal,
    status: ordinal === 5 ? 'WARN' : ordinal === 7 ? 'N/A' : 'PASS',
    summaryKey: `pc${ordinal}-summary`,
    summary: `PC${ordinal} 可见摘要${localizedSuffix}`,
    evidenceState: ordinal === 5 ? 'unverified' : 'verified',
    evidenceRefs: [`receipt-pc${ordinal}`],
    requiredAction: ordinal === 5 ? '保留 portable fallback' : null
  }))
}

const entries = [
  entry('decision', {
    visibility: 'decision-required', deliveryRequirement: 'required', readingOrder: 90,
    artifactClass: 'decision', displayName: '待确认的需求变更说明', userAction: '确认后继续'
  }),
  entry('result', {
    visibility: 'result', deliveryRequirement: 'required', readingOrder: 50,
    artifactClass: 'deliverable', displayName: '最终执行与验证报告', userAction: '查看结论'
  }),
  entry('evidence', {
    visibility: 'evidence', deliveryRequirement: 'required', readingOrder: 10,
    artifactClass: 'evidence', displayName: '影响结论的验证证据', userAction: '用于核对结论'
  }),
  entry('optional', { visibility: 'optional-detail', readingOrder: 1, displayName: '实现细节与追踪说明' }),
  entry('session', {
    artifactClass: 'session', deliveryRequirement: 'internal', visibility: 'internal-only',
    displayName: '需求会话内部连续性记录', userAction: '无需操作'
  }),
  entry('raw-ledger', {
    artifactClass: 'raw-ledger', deliveryRequirement: 'internal', visibility: 'internal-only',
    displayName: '治理台账内部原始记录', userAction: '无需操作'
  }),
  entry('renamed', {
    lifecycleOperation: 'rename', previousPath: path.join(WORKSPACE, 'old-name.md'),
    visibility: 'optional-detail', displayName: '重命名后的迁移说明'
  })
]

const deliveryManifest = manifest(entries)
assert.strictEqual(deliveryManifest.validation.valid, true, deliveryManifest.validation.errors.join(', '))
assert.strictEqual(deliveryManifest.reconciliation.status, 'verified')
assert.match(deliveryManifest.manifestId, /^artifact-manifest-[a-f0-9]{64}$/)

const defaultSet = projectUserFacingArtifactSet(deliveryManifest, { messageKind: 'final-result' })
assert.strictEqual(defaultSet.validation.valid, true)
assert.deepStrictEqual(defaultSet.items.map(item => item.artifactId), ['decision', 'result', 'evidence'])
assert.deepStrictEqual(defaultSet.counts, { listed: 3, remaining: 4, total: 7 })
assert.strictEqual(defaultSet.heading, ACTION_HEADINGS['final-result'])
assert.strictEqual(defaultSet.items.some(item => ['session', 'raw-ledger'].includes(item.artifactId)), false)
assert.strictEqual(INTERNAL_ARTIFACT_CLASSES.has('session'), true)

const requirementTruth = classifyArtifactTruthSource('requirement')
assert.strictEqual(requirementTruth.schemaVersion, 'ArtifactTruthSourceClassificationV1')
assert.strictEqual(requirementTruth.truthSourceKind, 'markdown-canonical')
assert.strictEqual(requirementTruth.humanConfirmationRequired, true)
const runtimeTruth = classifyArtifactTruthSource('runtime-state')
assert.strictEqual(runtimeTruth.truthSourceKind, 'json-canonical')
assert.strictEqual(runtimeTruth.machineValidationRequired, true)
const anchorProjection = projectArtifactAnchorsFromManifest(deliveryManifest, {
  generatedAt: '2026-07-19T10:01:00.000Z',
  owner: 'visible-output-contract'
})
assert.strictEqual(anchorProjection.schemaVersion, 'ArtifactAnchorProjectionV1')
assert.strictEqual(anchorProjection.validation.valid, true, anchorProjection.validation.errors.join(', '))
assert.strictEqual(anchorProjection.anchors.length, deliveryManifest.entries.length)
assert.match(anchorProjection.projectionDigest, /^artifact-anchor-projection-[a-f0-9]{64}$/)
assert.strictEqual(anchorProjection.anchors[0].schemaVersion, 'ArtifactAnchorV1')
assert.strictEqual(anchorProjection.anchors[0].contentDigest, deliveryManifest.entries[0].contentDigest)
assert(anchorProjection.anchors[0].evidenceRefs.includes(`manifest:${deliveryManifest.manifestId}`))
assert.strictEqual(anchorProjection.anchors.some(anchor => String(anchor.summaryLine).includes('REPORT BODY')), false)
const invalidAnchor = createArtifactAnchor({
  artifactId: 'invalid-anchor',
  artifactKind: 'report',
  canonicalPath: path.join(WORKSPACE, '.devcodex', 'devcodex-v1', 'invalid-anchor.md'),
  generatedAt: '2026-07-19T10:02:00.000Z',
  owner: 'visible-output-contract',
  evidenceRefs: ['negative-probe']
})
assert.strictEqual(invalidAnchor.validation.valid, false)
assert(invalidAnchor.validation.errors.includes('contentDigest-required'))
const explicitAnchor = createArtifactAnchor({
  artifactId: 'report-anchor',
  artifactKind: 'report',
  canonicalPath: path.join(WORKSPACE, '.devcodex', 'devcodex-v1', 'report-anchor.md'),
  contentDigest: 'sha256-report-anchor',
  projectionDigest: 'sha256-short-md',
  generatedAt: '2026-07-19T10:03:00.000Z',
  owner: 'visible-output-contract',
  status: 'fresh',
  evidenceRefs: ['unit-fixture']
})
assert.strictEqual(explicitAnchor.validation.valid, true)
assert.strictEqual(explicitAnchor.truthSourceKind, 'markdown-canonical')
assert.strictEqual(explicitAnchor.projectionDigest, 'sha256-short-md')

const allDeliverable = projectUserFacingArtifactSet(deliveryManifest, { scope: 'all-deliverable' })
assert.deepStrictEqual(allDeliverable.items.map(item => item.artifactId), ['decision', 'result', 'evidence', 'optional', 'renamed'])
assert.deepStrictEqual(allDeliverable.counts, { listed: 5, remaining: 2, total: 7 })
const internalAudit = projectUserFacingArtifactSet(deliveryManifest, { scope: 'internal-audit' })
assert.strictEqual(internalAudit.items.length, 7)
assert.strictEqual(internalAudit.counts.listed + internalAudit.counts.remaining, internalAudit.counts.total)

const missingObserved = manifest(entries, { observedArtifactIds: entries.slice(1).map(item => item.artifactId) })
assert.strictEqual(missingObserved.validation.valid, false)
assert.deepStrictEqual(missingObserved.reconciliation.missingObserved, ['decision'])
assert.strictEqual(projectUserFacingArtifactSet(missingObserved).validation.valid, false)
assert.strictEqual(projectArtifactAnchorsFromManifest(missingObserved).validation.valid, false)
assert.strictEqual(manifest([entry('hidden-required', {
  visibility: 'internal-only', deliveryRequirement: 'required', displayName: '错误隐藏的必要交付'
})]).validation.valid, false)
assert.strictEqual(manifest([entry('internal-visible', {
  visibility: 'result', deliveryRequirement: 'internal', displayName: '错误显示的内部记录'
})]).validation.valid, false)
assert.strictEqual(manifest([entry('session-visible', {
  artifactClass: 'session', visibility: 'result', deliveryRequirement: 'supporting', displayName: '错误泄漏的会话记录'
})]).validation.valid, false)
assert.strictEqual(manifest([entry('bad-name', { displayName: 'bad-name.md', canonicalPath: 'bad-name.md' })]).validation.valid, false)
assert.strictEqual(manifest([entry('filename-name', { displayName: '01-需求确认.md' })]).validation.valid, false)
assert.strictEqual(manifest([entry('bad-rename', { lifecycleOperation: 'rename', previousPath: null })]).validation.valid, false)
assert.strictEqual(manifest([entry('same-rename', {
  lifecycleOperation: 'rename', previousPath: path.join(WORKSPACE, '.devcodex', 'devcodex-v1', 'same-rename.md')
})]).validation.valid, false)
assert.strictEqual(manifest([entry('duplicate-a'), entry('duplicate-b', {
  canonicalPath: path.join(WORKSPACE, '.devcodex', 'devcodex-v1', 'duplicate-a.md')
})]).validation.valid, false)
assert.strictEqual(manifest([entry('candidate-array')], { candidateIdentity: [] }).validation.valid, false)
assert.strictEqual(manifest([entry('invalid-time')], { generatedAt: 'not-a-time' }).validation.valid, false)
assert.strictEqual(manifest([entry('duplicate-planned')], { plannedArtifactIds: ['duplicate-planned', 'duplicate-planned'] }).validation.valid, false)

const clickable = createLinkCapabilityDecision({
  surface: 'codex-app-fixture', evidenceState: 'verified', supportsClickable: true,
  supportsMarkdown: true, workspaceRoot: WORKSPACE, targetRelation: 'workspace', evidenceRefs: ['direct-replay-codex']
})
assert.strictEqual(clickable.mode, 'clickable')
assert.strictEqual(clickable.absolutePathFallback, false)
const portable = createLinkCapabilityDecision({
  surface: 'unknown-fixture', evidenceState: 'unverified', supportsMarkdown: true,
  workspaceRoot: WORKSPACE, targetRelation: 'workspace'
})
assert.strictEqual(portable.mode, 'portable')
assert.strictEqual(portable.absolutePathFallback, false)
const plain = createLinkCapabilityDecision({
  surface: 'terminal-fixture', evidenceState: 'verified', supportsMarkdown: false,
  workspaceRoot: WORKSPACE, targetRelation: 'workspace', evidenceRefs: ['terminal-capability-probe']
})
assert.strictEqual(plain.mode, 'plain')
const failed = createLinkCapabilityDecision({
  surface: 'failed-fixture', evidenceState: 'failed', supportsMarkdown: true, linkFailed: true,
  workspaceRoot: WORKSPACE, targetRelation: 'workspace'
})
assert.strictEqual(failed.mode, 'failed')
assert.strictEqual(failed.absolutePathFallback, true)
const external = createLinkCapabilityDecision({
  surface: 'external-fixture', evidenceState: 'verified', supportsClickable: true,
  supportsMarkdown: true, workspaceRoot: WORKSPACE, targetRelation: 'external', evidenceRefs: ['external-target-probe']
})
assert.strictEqual(external.absolutePathFallback, true)
assert.strictEqual(createLinkCapabilityDecision({
  surface: 'false-verified', evidenceState: 'verified', supportsClickable: true,
  supportsMarkdown: true, workspaceRoot: WORKSPACE, targetRelation: 'workspace'
}).validation.valid, false)

const entrySet = projectUserFacingArtifactSet(deliveryManifest, { messageKind: 'entry-check' })

const baseInput = {
  messageKind: 'entry-check',
  context: {
    project: 'devcodex-v1', taskId: 'visible-output-fixture', mode: 'dev', intentRoute: 'dev.optimization',
    phase: 'implementation', contextEpoch: 'epoch-1', hostSurface: 'codex-app-fixture'
  },
  checks: checks(),
  artifactManifest: deliveryManifest,
  userFacingArtifactSet: entrySet,
  linkCapability: clickable,
  presentation: { requestedTier: 'rich-markdown', effectiveTier: 'rich-markdown', degradationReason: null },
  recommendedAction: '继续执行下一批'
}
const envelope = createVisibleEnvelope(baseInput)
assert.strictEqual(envelope.validation.valid, true)
assert.strictEqual(envelope.status, 'WARN')
assert.match(envelope.semanticDigest, /^[a-f0-9]{64}$/)
const localizedEnvelope = createVisibleEnvelope({ ...baseInput, checks: checks('（另一种本地化）') })
assert.strictEqual(localizedEnvelope.semanticDigest, envelope.semanticDigest)
const portablePresentation = createVisibleEnvelope({
  ...baseInput,
  presentation: { requestedTier: 'plain-text', effectiveTier: 'plain-text', degradationReason: 'fixture' }
})
assert.strictEqual(portablePresentation.semanticDigest, envelope.semanticDigest)

const richText = renderVisibleEnvelope(envelope, { tier: 'rich-markdown' })
const portableText = renderVisibleEnvelope(envelope, { tier: 'portable-markdown' })
const plainText = renderVisibleEnvelope(envelope, { tier: 'plain-text' })
for (const output of [richText, portableText, plainText]) {
  assert.match(output, new RegExp(envelope.semanticDigest))
  for (const check of envelope.checks) assert.match(output, new RegExp(`${check.id} \\[${check.status.replace('/', '\\/')}\\]`))
  for (const item of entrySet.items) assert.match(output, new RegExp(item.displayName))
  assert.doesNotMatch(output, /主要产物|本次会话全部产物/)
  assert.doesNotMatch(output, /核心文件|路径列表/)
  // PF-175: path column required on all presentation tiers
  assert.match(output, /路径[:：]/)
  assert.match(output, /\.devcodex[\\/]devcodex-v1/)
}
assert.doesNotMatch(richText, /绝对路径[:：]/)
assert.doesNotMatch(portableText, /绝对路径[:：]/)
// Rich may use absolute href for clickable open; path cell stays portable
assert.match(richText, new RegExp(WORKSPACE.replace(/[\\/]/g, '[\\\\/]')))
assert.doesNotMatch(portableText, new RegExp(WORKSPACE.replace(/[\\/]/g, '[\\\\/]')))
assert.doesNotMatch(plainText, /####|\[[^\]]+\]\([^\)]+\)/)

// PF-175 free-text path column classifier
assert.strictEqual(
  classifyArtifactPathColumnSample('#### 完成交付文件\n| 语义名称 | 用途 | 路径 | 操作 |\n| a | b | `.devcodex/x.md` | 查看 |'),
  'present'
)
assert.strictEqual(
  classifyArtifactPathColumnSample('#### 完成交付文件\n- [报告](x.md) — 用途说明；路径：`.devcodex/x.md`；操作：查看'),
  'present'
)
assert.strictEqual(
  classifyArtifactPathColumnSample('#### 完成交付文件\n- [报告](x.md) — 用途说明；操作：查看'),
  'missing-path-column'
)
assert.strictEqual(
  classifyArtifactPathColumnSample('主要产物：\n- E:/Worker/foo.md'),
  'legacy-bare-path'
)
assert.strictEqual(classifyArtifactPathColumnSample('随便聊聊'), 'not-claimed')

// PF-186 / PI-164: completion-check must carry a short but verifiable validation summary.
const finalValidationGood = [
  '### DevCodex · 完成检查',
  '| 类型 | 命令 | exitCode | runId/计数 |',
  '| 权威 | `npm run test:visible-output` | exitCode 0 | runId=validation-202607230001 / checks=42 |',
  'WorkspaceSyncStatus: skipped (无需同步)',
  'dirty boundary: git status clean; no unrelated dirty',
  'Release actions: push/tag/release/publish 未执行',
  '`DevCodexVisibleEnvelopeV1 · completion-check · PASS · ' + 'c'.repeat(64) + '`'
].join('\n')
assert.strictEqual(classifyFinalValidationSummarySample(finalValidationGood), 'present')
assert.strictEqual(analyzeFinalValidationSummarySample(finalValidationGood).status, 'verified-present')
assert.strictEqual(classifyFinalValidationSummarySample('随便聊聊'), 'not-claimed')
assert.strictEqual(classifyFinalValidationSummarySample([
  '### DevCodex · 完成检查',
  '整体：全部通过',
  '`DevCodexVisibleEnvelopeV1 · completion-check · PASS · ' + 'd'.repeat(64) + '`'
].join('\n')), 'thin-green-summary')
assert.strictEqual(classifyFinalValidationSummarySample([
  '### DevCodex · 完成检查',
  '权威命令：`npm run test:visible-output`',
  'runId=validation-202607230001',
  'WorkspaceSyncStatus: skipped (无需同步)',
  'dirty boundary: clean',
  'Release actions: push/tag/release/publish 未执行'
].join('\n')), 'exit-code')
assert.strictEqual(classifyFinalValidationSummarySample([
  '### DevCodex · 完成检查',
  '`git status --short` exitCode 0',
  'runId=status-only-001 / checks=1',
  'WorkspaceSyncStatus: skipped (无需同步)',
  'dirty boundary: git status clean',
  'Release actions: push/tag/release/publish 未执行'
].join('\n')), 'validation-command')
assert.strictEqual(classifyFinalValidationSummarySample([
  '### DevCodex · 完成检查',
  '[最终报告](reports/analysis/codex/20260723/01--sample.md)',
  'WorkspaceSyncStatus: skipped (无需同步)',
  'dirty boundary: clean',
  'Release actions: push/tag/release/publish 未执行'
].join('\n')), 'report-link-only')
assert.strictEqual(classifyFinalValidationSummarySample([
  '### DevCodex · 完成检查',
  '| 权威 | `npm run test:visible-output` | exitCode 0 | checks=42 |',
  'dirty boundary: clean',
  'Release actions: push/tag/release/publish 未执行'
].join('\n')), 'workspace-sync')
assert.strictEqual(classifyFinalValidationSummarySample([
  '### DevCodex · 完成检查',
  '| 权威 | `npm run test:visible-output` | exitCode 0 | checks=42 |',
  'WorkspaceSyncStatus: skipped (无需同步)',
  'dirty boundary: clean',
  'Release actions: push/tag/release/publish 未执行',
  'commit abc1234'
].join('\n')), 'post-commit-replay')

// DPC: dialogue-primary narrative (readable closeout without opening report)
assert.strictEqual(classifyDialogueNarrativeSample('随便聊聊'), 'not-claimed')
assert.strictEqual(
  classifyDialogueNarrativeSample([
    '### DevCodex · 完成检查',
    '详见报告：[r](reports/x.md)',
    '`DevCodexVisibleEnvelopeV1 · completion-check · PASS · ' + 'e'.repeat(64) + '`'
  ].join('\n')),
  'narrative-missing'
)
assert.strictEqual(
  classifyDialogueNarrativeSample([
    '### DevCodex · 完成检查',
    '## 结果',
    '已完成对话内可读收口 B1：叙事分类器与 link-only-thin 已落地。',
    '## 要点',
    '- 扩展既有 FVS/PF-169，未新建平行 Gate',
    '- 用户默认可在对话内读懂结论',
    '`DevCodexVisibleEnvelopeV1 · completion-check · PASS · ' + 'f'.repeat(64) + '`'
  ].join('\n')),
  'present'
)
assert.strictEqual(
  classifyDialogueNarrativeSample('分析完成。user-override：用户要求只要路径。'),
  'waived'
)
assert.ok(hasReadableNarrativeSnippet('方案审阅结论：合理，因边界清晰且可验证。'))
assert.ok(!hasReadableNarrativeSnippet('[报告](reports/a.md)'))
assert.strictEqual(analyzeDialogueNarrativeSample('分析完成。').classification, 'narrative-missing')

// F-009 / PF-177: production consumer (lifecycle-visible-reply) must surface missing path column
{
  const { buildLifecycleVisibleReplyUtils } = require('../hooks/_runtime/lifecycle-visible-reply.cjs')
  const replyUtils = buildLifecycleVisibleReplyUtils({})
  const missingPath = [
    '#### 完成交付文件',
    '- [报告](x.md) — 用途说明；操作：查看',
    'DevCodexVisibleEnvelopeV1 · completion-check · PASS · ' + 'a'.repeat(64)
  ].join('\n')
  const withPath = [
    '#### 完成交付文件',
    '- [报告](x.md) — 用途说明；路径：`.devcodex/x.md`；操作：查看',
    'DevCodexVisibleEnvelopeV1 · completion-check · PASS · ' + 'b'.repeat(64)
  ].join('\n')
  const missing = replyUtils.analyzeArtifactDelivery(missingPath)
  assert.strictEqual(missing.pathColumnClass, 'missing-path-column')
  assert.ok(missing.missingItems.includes('missing-path-column'))
  assert.strictEqual(missing.status, 'verified-missing')
  const present = replyUtils.analyzeArtifactDelivery(withPath)
  assert.strictEqual(present.pathColumnClass, 'present')
  assert.ok(!present.missingItems.includes('missing-path-column'))

  // DPC B2: lifecycle wires narrative + analysis delivery into visible state
  const { buildLifecyclePayloadUtils } = require('../hooks/_runtime/lifecycle-payload-utils.cjs')
  const payloadUtils = buildLifecyclePayloadUtils({ fs: require('fs') })
  const replyUtilsWired = buildLifecycleVisibleReplyUtils({
    fs: require('fs'),
    getVisibleReplyEvidence: payloadUtils.getVisibleReplyEvidence,
    collectInterestingStrings: payloadUtils.collectInterestingStrings,
    getStatePaths: () => ({ dir: '', finalPayloadFlag: '', finalPayloadLog: '' }),
    buildGovernanceIntakeReminderItem: () => ''
  })
  const state = {
    mode: 'dev',
    reportTouched: true,
    visible: {}
  }
  const narrativeMissingBody = [
    '### DevCodex · 完成检查',
    '详见报告：[r](reports/x.md)',
    '#### 完成交付文件',
    '- [报告](x.md) — 用途说明；路径：`.devcodex/x.md`；操作：深读时打开归档报告',
    '`DevCodexVisibleEnvelopeV1 · completion-check · PASS · ' + 'c'.repeat(64) + '`'
  ].join('\n')
  replyUtilsWired.updateVisibleReplyState(state, { assistantMessage: narrativeMissingBody }, 'Stop')
  assert.strictEqual(state.visible.dialogueNarrativeStatus, 'verified-missing')
  assert.ok(state.visible.dialogueNarrativeMissingItems.includes('dialogue-narrative'))
  const reminder = replyUtilsWired.buildClosureReminder(
    { mode: 'dev', reportTouched: true, visible: state.visible, mutated: false },
    'Stop'
  )
  assert.match(String(reminder || ''), /Dialogue-Primary|对话内可读收口/)

  const analysisThinState = { mode: 'dev', reportTouched: true, visible: {} }
  const analysisThinBody = '分析完成。[报告](./reports/analysis/grok/20260721/04--审阅.md)'
  replyUtilsWired.updateVisibleReplyState(
    analysisThinState,
    { assistantMessage: analysisThinBody },
    'Stop'
  )
  assert.strictEqual(analysisThinState.visible.analysisDeliveryClass, 'link-only-thin')
  assert.strictEqual(analysisThinState.visible.analysisDeliveryStatus, 'verified-missing')
  assert.ok(analysisThinState.visible.analysisDeliveryMissingItems.includes('analysis-link-only-thin'))
}

const failedEnvelope = createVisibleEnvelope({ ...baseInput, linkCapability: failed })
assert.strictEqual(failedEnvelope.status, 'BLOCK')
const failedForSurface = createLinkCapabilityDecision({
  surface: 'codex-app-fixture', evidenceState: 'failed', supportsMarkdown: true, linkFailed: true,
  workspaceRoot: WORKSPACE, targetRelation: 'workspace', evidenceRefs: ['failed-click-probe']
})
const failedSurfaceEnvelope = createVisibleEnvelope({ ...baseInput, linkCapability: failedForSurface })
assert.strictEqual(failedSurfaceEnvelope.validation.valid, true)
assert.match(renderVisibleEnvelope(failedSurfaceEnvelope, { tier: 'plain-text' }), /fallback：link-failed/)

const invalidStatus = createVisibleEnvelope({
  ...baseInput,
  checks: checks().map((check, index) => index === 3 ? { ...check, status: 'UNKNOWN' } : check)
})
assert.strictEqual(invalidStatus.validation.valid, false)
assert.strictEqual(invalidStatus.status, 'BLOCK')
assert.strictEqual(invalidStatus.checks[0].id, 'VISIBLE_ENVELOPE_INVALID')
const missingPc = createVisibleEnvelope({ ...baseInput, checks: checks().slice(0, 7) })
assert.strictEqual(missingPc.status, 'BLOCK')
const unverifiedPass = createVisibleEnvelope({
  ...baseInput,
  checks: checks().map((check, index) => index === 0 ? { ...check, evidenceState: 'unverified' } : check)
})
assert.strictEqual(unverifiedPass.status, 'BLOCK')
assert.strictEqual(createVisibleEnvelope({ ...baseInput, presentation: {
  requestedTier: 'rich-markdown', effectiveTier: 'unknown', degradationReason: null
} }).status, 'BLOCK')
assert.strictEqual(createVisibleEnvelope({ ...baseInput, artifactManifest: {
  ...deliveryManifest, taskId: 'other-task'
} }).status, 'BLOCK')
assert.strictEqual(createVisibleEnvelope({ ...baseInput, artifactManifest: {
  ...deliveryManifest, unexpectedSibling: true
} }).status, 'BLOCK')
assert.strictEqual(createVisibleEnvelope({ ...baseInput, userFacingArtifactSet: null }).status, 'BLOCK')
const mismatchedSet = { ...defaultSet, manifestId: 'artifact-manifest-mismatch' }
assert.strictEqual(createVisibleEnvelope({ ...baseInput, userFacingArtifactSet: mismatchedSet }).status, 'BLOCK')
assert.strictEqual(createVisibleEnvelope({
  ...baseInput, linkCapability: { ...clickable, mode: 'plain' }
}).status, 'BLOCK')
assert.strictEqual(createVisibleEnvelope({
  ...baseInput, linkCapability: { ...clickable, unexpectedSibling: true }
}).status, 'BLOCK')

for (const messageKind of ['completion-check', 'progress', 'final-result', 'error-block']) {
  const current = createVisibleEnvelope({ ...baseInput, messageKind, checks: checks().slice(0, 2),
    userFacingArtifactSet: projectUserFacingArtifactSet(deliveryManifest, { messageKind }) })
  assert.strictEqual(current.validation.valid, true, messageKind)
}
const confirmation = createVisibleEnvelope({
  ...baseInput,
  messageKind: 'confirmation',
  checks: checks().slice(0, 1),
  decision: { id: 'cp1', kind: 'cp', question: '确认需求？', options: ['确认', '调整'], recommendedOption: '确认' },
  userFacingArtifactSet: projectUserFacingArtifactSet(deliveryManifest, { messageKind: 'confirmation' })
})
assert.strictEqual(confirmation.validation.valid, true)
assert.strictEqual(createVisibleEnvelope({ ...baseInput, messageKind: 'confirmation', checks: checks().slice(0, 1) }).status, 'BLOCK')

const compactChecks = checks().map(check => ({
  ...check,
  status: check.status === 'WARN' ? 'PASS' : check.status,
  evidenceState: check.status === 'WARN' ? 'verified' : check.evidenceState,
  requiredAction: null
}))
const compactEnvelope = createVisibleEnvelope({ ...baseInput, checks: compactChecks })
assert.strictEqual(shouldUseCompact(compactEnvelope, compactEnvelope), true)
assert.strictEqual(shouldUseCompact(compactEnvelope, compactEnvelope, { userRequestedDetails: true }), false)
assert.strictEqual(shouldUseCompact(compactEnvelope, createVisibleEnvelope({ ...baseInput, messageKind: 'final-result', checks: compactChecks.slice(0, 2) })), false)
const compactText = renderVisibleEnvelope(compactEnvelope, { tier: 'portable-markdown', compact: true })
for (let index = 0; index < 8; index += 1) assert.match(compactText, new RegExp(`PC${index}=`))
assert.match(compactText, /状态未变化/)
const confirmationExpanded = renderVisibleEnvelope(confirmation, { tier: 'portable-markdown', compact: true })
assert.doesNotMatch(confirmationExpanded, /状态未变化/)
const invalidPortable = renderVisibleEnvelope(invalidStatus, { tier: 'rich-markdown', compact: true })
assert.match(invalidPortable, /VISIBLE_ENVELOPE_INVALID/)
assert.doesNotMatch(invalidPortable, /状态未变化/)

const fastPathAllowed = buildSimpleGovernanceFastPathDecision({
  taskKind: 'chat',
  messageKind: 'progress',
  riskClass: 'low',
  evidenceRefs: ['semantic-digest-stable']
})
assert.strictEqual(fastPathAllowed.schemaVersion, 'SimpleGovernanceFastPathDecisionV1')
assert.strictEqual(fastPathAllowed.validation.valid, true)
assert.strictEqual(fastPathAllowed.eligible, true)
assert.strictEqual(fastPathAllowed.visibleMode, 'compact')
assert.deepStrictEqual(fastPathAllowed.upgradeTriggers, [])
const fastPathBlocked = buildSimpleGovernanceFastPathDecision({
  taskKind: 'dev',
  messageKind: 'final-result',
  riskClass: 'high',
  cpState: 'pending',
  controlPlane: true,
  sourceMutation: true,
  evidenceRefs: []
})
assert.strictEqual(fastPathBlocked.validation.valid, true)
assert.strictEqual(fastPathBlocked.eligible, false)
assert.strictEqual(fastPathBlocked.visibleMode, 'full')
for (const trigger of ['control-plane', 'source-mutation', 'risk-not-low', 'cp-not-confirmed', 'evidence-missing']) {
  assert.ok(fastPathBlocked.upgradeTriggers.includes(trigger), `missing trigger: ${trigger}`)
}

const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills', 'user-visible-output-contract', 'visible-output-contract.schema.json'), 'utf8'))
for (const definition of [
  'ArtifactDeliveryManifestV1',
  'ArtifactTruthSourceClassificationV1',
  'ArtifactAnchorV1',
  'ArtifactAnchorProjectionV1',
  'UserFacingArtifactSetV1',
  'LinkCapabilityDecisionV1',
  'FinalValidationSummaryV1',
  'DevCodexVisibleEnvelopeV1'
]) {
  assert.ok(schema.$defs[definition], `schema missing ${definition}`)
  assert.strictEqual(schema.$defs[definition].additionalProperties, false, `${definition} must reject sibling fields`)
}
assert.ok(schema.$defs.LinkCapabilityDecisionV1.required.includes('evidenceRefs'))
assert.strictEqual(schema.$defs.ArtifactDeliveryManifestV1.properties.generatedAt.format, 'date-time')
assert.strictEqual(schema.$defs.ArtifactAnchorV1.properties.generatedAt.format, 'date-time')
assert.match(schema.$defs.ArtifactAnchorProjectionV1.properties.projectionDigest.pattern, /artifact-anchor-projection/)

console.log('visible output contract passed: manifest/projection/anchors/counts/names/links/renderers/message-kinds/compact/fail-closed')
