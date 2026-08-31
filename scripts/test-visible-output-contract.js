#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { resolveControlAsset } = require('./lib/control-content-delivery')
const {
  ACTION_HEADINGS,
  INTERNAL_ARTIFACT_CLASSES,
  classifyArtifactTruthSource,
  createArtifactAnchor,
  createArtifactDeliveryManifest,
  buildSimpleGovernanceFastPathDecision,
  classifyArtifactPathColumnSample,
  createLinkCapabilityDecision,
  createHostLinkCapabilityDecisionV2,
  createArtifactDeliveryAttemptV1,
  resolveArtifactDelivery,
  createLegacyVisibleEnvelopeV1,
  createPostCompletionActionSet,
  createEntryCheckModelV3,
  createVisibleEnvelopeV2,
  createVisibleEnvelope,
  analyzeFinalValidationSummarySample,
  analyzeDialogueNarrativeSample,
  projectArtifactAnchorsFromManifest,
  projectUserFacingArtifactSet,
  renderVisibleEnvelope,
  normalizeCompatibleVisibleEnvelope,
  classifyDialogueNarrativeSample,
  classifyFinalValidationSummarySample,
  hasReadableNarrativeSnippet,
  shouldUseCompact
} = require('../hooks/_runtime/visible-output-contract.cjs')
const { renderGrokS07Assist } = require('../hooks/_runtime/lifecycle-bootstrap-state.cjs')
const ROOT = path.resolve(__dirname, '..')
const WORKSPACE = path.dirname(ROOT)
const ZH_LANGUAGE_CONTEXT = Object.freeze({
  schemaVersion: 'LanguageContextV2', primaryLanguage: 'zh-CN', responseLanguage: 'zh-CN',
  artifactLanguage: 'zh-CN', currentTurnClass: 'neutral', source: 'task-primary-language',
  confidence: 'high', updatedPrimary: false
})
const EN_LANGUAGE_CONTEXT = Object.freeze({
  ...ZH_LANGUAGE_CONTEXT,
  primaryLanguage: 'en', responseLanguage: 'en', artifactLanguage: 'en'
})

function entry(id, overrides = {}) {
  return {
    artifactId: id,
    canonicalPath: path.join(WORKSPACE, '.devcodex', 'devcodex', `${id}.md`),
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
  return Array.from({ length: 11 }, (_, ordinal) => ({
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
  canonicalPath: path.join(WORKSPACE, '.devcodex', 'devcodex', 'invalid-anchor.md'),
  generatedAt: '2026-07-19T10:02:00.000Z',
  owner: 'visible-output-contract',
  evidenceRefs: ['negative-probe']
})
assert.strictEqual(invalidAnchor.validation.valid, false)
assert(invalidAnchor.validation.errors.includes('contentDigest-required'))
const explicitAnchor = createArtifactAnchor({
  artifactId: 'report-anchor',
  artifactKind: 'report',
  canonicalPath: path.join(WORKSPACE, '.devcodex', 'devcodex', 'report-anchor.md'),
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
  lifecycleOperation: 'rename', previousPath: path.join(WORKSPACE, '.devcodex', 'devcodex', 'same-rename.md')
})]).validation.valid, false)
assert.strictEqual(manifest([entry('duplicate-a'), entry('duplicate-b', {
  canonicalPath: path.join(WORKSPACE, '.devcodex', 'devcodex', 'duplicate-a.md')
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

const hostLinkMatrix = [
  ['codex-desktop', 'codex-desktop-panel', 'codex-native-file-link', 'markdown-link'],
  ['vscode-codex', 'vscode-terminal', 'vscode-cli-goto', 'terminal-command'],
  ['zed', 'zed-terminal', 'zed-cli-open', 'terminal-command'],
  ['webstorm', 'jetbrains-terminal', 'webstorm-cli-open', 'terminal-command'],
  ['claude-code', 'claude-terminal', 'absolute-path-copy', 'absolute-copy'],
  ['codex-cli', 'terminal', 'absolute-path-copy', 'absolute-copy']
]
for (const [hostSurface, presentationSurface, rendererId, openMode] of hostLinkMatrix) {
  const decision = createHostLinkCapabilityDecisionV2({
    hostSurface,
    presentationSurface,
    evidenceState: 'verified',
    workspaceRoot: WORKSPACE,
    targetRelation: 'workspace',
    evidenceRefs: [`direct-renderer-probe:${hostSurface}`]
  })
  assert.strictEqual(decision.validation.valid, true, JSON.stringify(decision))
  assert.strictEqual(decision.rendererId, rendererId)
  assert.strictEqual(decision.openMode, openMode)
}
const unknownHostLink = createHostLinkCapabilityDecisionV2({
  hostSurface: 'unknown', presentationSurface: 'unknown', evidenceState: 'unverified',
  workspaceRoot: WORKSPACE, targetRelation: 'workspace'
})
assert.strictEqual(unknownHostLink.openMode, 'absolute-copy')
assert.strictEqual(unknownHostLink.absolutePathFallback, true)
assert.strictEqual(unknownHostLink.fallbackReason, 'renderer-unverified')
const presentationMismatch = createHostLinkCapabilityDecisionV2({
  hostSurface: 'codex-desktop', presentationSurface: 'vscode-terminal', evidenceState: 'verified',
  workspaceRoot: WORKSPACE, targetRelation: 'workspace', evidenceRefs: ['mismatch-probe']
})
assert.strictEqual(presentationMismatch.openMode, 'absolute-copy')
assert.strictEqual(presentationMismatch.fallbackReason, 'presentation-host-mismatch')
assert.strictEqual(createHostLinkCapabilityDecisionV2({
  hostSurface: 'codex-desktop', presentationSurface: 'codex-desktop-panel', evidenceState: 'verified',
  workspaceRoot: WORKSPACE, targetRelation: 'workspace'
}).validation.valid, false)

const nativeCapability = createHostLinkCapabilityDecisionV2({
  hostSurface: 'codex-app', presentationSurface: 'codex-desktop-panel', evidenceState: 'verified',
  workspaceRoot: WORKSPACE, targetRelation: 'workspace', evidenceRefs: ['native-action-capability-probe'],
  supportsNativeAction: true, nativeRendererId: 'codex-open-file-action'
})
const nativeWithoutAction = resolveArtifactDelivery({
  linkCapability: nativeCapability,
  artifactId: 'artifact-native-missing',
  target: path.join(ROOT, 'README.md')
})
assert.strictEqual(nativeWithoutAction.validation.valid, true, JSON.stringify(nativeWithoutAction))
assert.strictEqual(nativeWithoutAction.attempt.status, 'fallback')
assert.strictEqual(nativeWithoutAction.attempt.fallbackReason, 'native-action-not-attached')
const nativeOpened = resolveArtifactDelivery({
  linkCapability: nativeCapability,
  artifactId: 'artifact-native-opened',
  target: path.join(ROOT, 'README.md'),
  actionId: 'codex-action-fixture-1',
  attempted: true,
  actionStatus: 'succeeded',
  readback: 'succeeded',
  attemptEvidenceRefs: ['native-action-executed', 'native-action-readback']
})
assert.strictEqual(nativeOpened.validation.valid, true, JSON.stringify(nativeOpened))
assert.strictEqual(nativeOpened.attempt.status, 'opened')
const forgedOpened = createArtifactDeliveryAttemptV1({
  artifactId: 'artifact-forged-opened', rendererId: 'codex-open-file-action', openMode: 'native-action',
  actionId: 'codex-action-fixture-2', target: path.join(ROOT, 'README.md'), attempted: true,
  actionStatus: 'succeeded', readback: 'unavailable', evidenceState: 'verified', evidenceRefs: ['action-only']
})
assert.strictEqual(forgedOpened.status, 'fallback')
assert.strictEqual(forgedOpened.fallbackReason, 'readback-unavailable')
const missingTarget = resolveArtifactDelivery({
  linkCapability: createHostLinkCapabilityDecisionV2({
    hostSurface: 'codex-app', presentationSurface: 'codex-desktop-panel', evidenceState: 'verified',
    workspaceRoot: WORKSPACE, targetRelation: 'workspace', evidenceRefs: ['missing-target-capability']
  }),
  artifactId: 'artifact-missing-target',
  target: path.join(ROOT, 'missing-artifact.md'),
  targetReadback: 'missing',
  attemptEvidenceRefs: ['target-readback-missing']
})
assert.strictEqual(missingTarget.attempt.status, 'fallback')
assert.strictEqual(missingTarget.attempt.fallbackReason, 'target-missing')

const entrySet = projectUserFacingArtifactSet(deliveryManifest, { messageKind: 'entry-check' })

const postCompletionActions = createPostCompletionActionSet({
  requiredNow: [],
  primaryAction: {
    kind: 'commit',
    label: '确认后提交已验证改动',
    reason: '实现与验证已具备提交条件，但提交仍属于独立授权动作',
    evidenceRefs: ['visible-output-fixture-validation'],
    applicability: 'applicable',
    authorization: 'explicit-required'
  },
  conditionalActions: [{
    kind: 'push',
    label: '提交确认后再决定是否推送',
    reason: '只有用户选择发布目标且提交成功后才适用',
    evidenceRefs: ['visible-output-fixture-release-boundary'],
    applicability: 'conditional',
    authorization: 'explicit-required'
  }]
})
assert.strictEqual(postCompletionActions.validation.valid, true)

const entryCheckModel = createEntryCheckModelV3({
  versionFacts: {
    installedPackageVersion: '1.19.3',
    activeRuntimeGeneration: { generationId: 'generation-fixture', packageVersion: '1.19.3', manifestStatus: 'verified' },
    configuredRuntimeGeneration: { generationId: 'generation-fixture', packageVersion: '1.19.3', manifestStatus: 'verified' },
    sourceCandidate: { root: ROOT, packageVersion: '1.19.3', shortHead: '83e2adb9', dirty: true },
    alignment: 'source-ahead',
    restartRequired: false,
    restartReason: 'active-runtime-generation-current'
  },
  workflowPlan: {
    precheck: {
      decisionId: 'workflow-plan-precheck', phase: 'precheck', ceremonyTier: 'standard',
      designDepth: 'standard', assuranceLevel: 'affected'
    },
    postContext: null,
    differences: []
  },
  validationPlan: {
    assuranceLevel: 'affected', targetedCount: 3, affectedCount: 8, fullCount: 0,
    ciRequired: false, packageRequired: false, installRequired: false, releaseRequired: false,
    estimatedDuration: '约 2～5 分钟'
  },
  continuation: {
    nextStage: 'bounded-context-read', automatic: true, userAction: 'none',
    correctionHint: '直接说明要改为简单/标准流程、最小/标准方案或定向/受影响/全量验证'
  },
  showPlan: true
})
assert.strictEqual(entryCheckModel.validation.valid, true, entryCheckModel.validation.errors.join(', '))
const invalidRuntimeMismatch = createEntryCheckModelV3({
  versionFacts: {
    ...entryCheckModel.versionFacts,
    alignment: 'runtime-mismatch',
    restartRequired: false,
    restartReason: 'incorrect-negative-fixture'
  },
  workflowPlan: entryCheckModel.workflowPlan,
  validationPlan: entryCheckModel.validationPlan,
  continuation: entryCheckModel.continuation
})
assert.strictEqual(invalidRuntimeMismatch.validation.valid, false)
assert(invalidRuntimeMismatch.validation.errors.includes('versionFacts.runtimeMismatch-restart-required'))

const baseInput = {
  messageKind: 'entry-check',
  context: {
    project: 'devcodex', taskId: 'visible-output-fixture', mode: 'dev', intentRoute: 'dev.optimization',
    phase: 'implementation', contextEpoch: 'epoch-1', hostSurface: 'codex-app-fixture'
  },
  checks: checks(),
  entryCheckModel,
  artifactManifest: deliveryManifest,
  userFacingArtifactSet: entrySet,
  linkCapability: clickable,
  presentation: { requestedTier: 'rich-markdown', effectiveTier: 'rich-markdown', degradationReason: null },
  postCompletionActions
}
const envelope = createVisibleEnvelope(baseInput)
assert.strictEqual(envelope.validation.valid, true)
assert.strictEqual(envelope.schemaVersion, 'DevCodexVisibleEnvelopeV3')
assert.strictEqual(envelope.status, 'WARN')
assert.match(envelope.semanticDigest, /^[a-f0-9]{64}$/)
const codexDesktopLink = createHostLinkCapabilityDecisionV2({
  hostSurface: 'codex-app', presentationSurface: 'codex-desktop-panel', evidenceState: 'verified',
  workspaceRoot: WORKSPACE, targetRelation: 'workspace', evidenceRefs: ['direct-native-action-probe']
})
const codexDesktopEnvelope = createVisibleEnvelope({
  ...baseInput,
  context: { ...baseInput.context, hostSurface: 'codex-app' },
  linkCapability: codexDesktopLink
})
assert.strictEqual(codexDesktopEnvelope.validation.valid, true)
assert.strictEqual(codexDesktopEnvelope.artifactDeliveryAttempts[0].status, 'ready')
const codexDesktopRendered = renderVisibleEnvelope(codexDesktopEnvelope, {
  tier: 'rich-markdown', languageContext: ZH_LANGUAGE_CONTEXT
})
assert.match(codexDesktopRendered, /\[.+\]\([^)]+\)/)
assert.doesNotMatch(codexDesktopRendered, /使用 Codex 文件面板打开/)
const vscodeLink = createHostLinkCapabilityDecisionV2({
  hostSurface: 'vscode-codex', presentationSurface: 'vscode-terminal', evidenceState: 'verified',
  workspaceRoot: WORKSPACE, targetRelation: 'workspace', evidenceRefs: ['direct-vscode-cli-probe']
})
const vscodeEnvelope = createVisibleEnvelope({
  ...baseInput,
  context: { ...baseInput.context, hostSurface: 'vscode-codex' },
  linkCapability: vscodeLink
})
assert.strictEqual(vscodeEnvelope.validation.valid, true)
assert.strictEqual(vscodeEnvelope.artifactDeliveryAttempts[0].status, 'ready')
assert.match(renderVisibleEnvelope(vscodeEnvelope, {
  tier: 'rich-markdown', languageContext: ZH_LANGUAGE_CONTEXT
}), /code --goto/)
const tamperedDeliveryAttempt = {
  ...codexDesktopEnvelope.artifactDeliveryAttempts[0],
  status: 'opened'
}
assert.strictEqual(createVisibleEnvelope({
  ...baseInput,
  context: { ...baseInput.context, hostSurface: 'codex-app' },
  linkCapability: codexDesktopLink,
  artifactDeliveryAttempts: [tamperedDeliveryAttempt]
}).validation.valid, false)
const tamperedHostLink = { ...codexDesktopLink, unexpectedSibling: true }
assert.strictEqual(createVisibleEnvelope({ ...baseInput, linkCapability: tamperedHostLink }).validation.valid, false)
const localizedEnvelope = createVisibleEnvelope({ ...baseInput, checks: checks('（另一种本地化）') })
assert.strictEqual(localizedEnvelope.semanticDigest, envelope.semanticDigest)
const portablePresentation = createVisibleEnvelope({
  ...baseInput,
  presentation: { requestedTier: 'plain-text', effectiveTier: 'plain-text', degradationReason: 'fixture' }
})
assert.strictEqual(portablePresentation.semanticDigest, envelope.semanticDigest)
const sameSurfacePlain = createLinkCapabilityDecision({
  surface: 'codex-app-fixture', evidenceState: 'verified', supportsClickable: false,
  supportsMarkdown: false, workspaceRoot: WORKSPACE, targetRelation: 'workspace',
  evidenceRefs: ['direct-replay-codex']
})
const plainLinkPresentation = createVisibleEnvelope({ ...baseInput, linkCapability: sameSurfacePlain })
assert.strictEqual(plainLinkPresentation.semanticDigest, envelope.semanticDigest, 'click presentation alone must not change semantic identity')
const sameSurfaceFailed = createLinkCapabilityDecision({
  surface: 'codex-app-fixture', evidenceState: 'failed', supportsMarkdown: true, linkFailed: true,
  workspaceRoot: WORKSPACE, targetRelation: 'workspace'
})
const failedLinkEnvelope = createVisibleEnvelope({ ...baseInput, linkCapability: sameSurfaceFailed })
assert.notStrictEqual(failedLinkEnvelope.semanticDigest, envelope.semanticDigest, 'failed link capability is a material semantic change')

const richText = renderVisibleEnvelope(envelope, {
  tier: 'rich-markdown', languageContext: ZH_LANGUAGE_CONTEXT, audience: 'audit'
})
const portableText = renderVisibleEnvelope(envelope, {
  tier: 'portable-markdown', languageContext: ZH_LANGUAGE_CONTEXT, audience: 'audit'
})
const plainText = renderVisibleEnvelope(envelope, {
  tier: 'plain-text', languageContext: ZH_LANGUAGE_CONTEXT, audience: 'audit'
})
for (const output of [richText, portableText, plainText]) {
  assert.match(output, new RegExp(envelope.semanticDigest))
  for (const check of envelope.checks) assert.match(output, new RegExp(`${check.id} \\[${check.status.replace('/', '\\/')}\\]`))
  for (const item of entrySet.items) assert.match(output, new RegExp(item.displayName))
  assert.doesNotMatch(output, /主要产物|本次会话全部产物/)
  assert.doesNotMatch(output, /核心文件|路径列表/)
  // PF-175: path column required on all presentation tiers
  assert.match(output, /路径[:：]/)
  assert.match(output, /\.devcodex[\\/]devcodex/)
}
assert.doesNotMatch(richText, /绝对路径[:：]/)
assert.doesNotMatch(portableText, /绝对路径[:：]/)
// Rich may use absolute href for clickable open; path cell stays portable
assert.match(richText, new RegExp(WORKSPACE.replace(/[\\/]/g, '[\\\\/]')))
assert.doesNotMatch(portableText, new RegExp(WORKSPACE.replace(/[\\/]/g, '[\\\\/]')))
assert.doesNotMatch(plainText, /####|\[[^\]]+\]\([^\)]+\)/)
assert.match(richText, /下一步：确认后提交已验证改动/)
assert.match(richText, /条件动作：提交确认后再决定是否推送/)

const zhHumanText = renderVisibleEnvelope(envelope, {
  tier: 'portable-markdown', languageContext: ZH_LANGUAGE_CONTEXT, audience: 'human'
})
assert.match(zhHumanText, /### DevCodex · 入口检查/)
assert.doesNotMatch(zhHumanText, new RegExp(envelope.semanticDigest))
assert.doesNotMatch(zhHumanText, /DevCodexVisibleEnvelopeV3/)
const enHumanText = renderVisibleEnvelope(envelope, {
  tier: 'portable-markdown', languageContext: EN_LANGUAGE_CONTEXT, audience: 'human'
})
assert.match(enHumanText, /### DevCodex · Entry check/)
assert.match(enHumanText, /Files from this batch/)
assert.match(enHumanText, /Next:/)
assert.doesNotMatch(enHumanText, /语言回退|入口检查/)
assert.strictEqual(envelope.semanticDigest, localizedEnvelope.semanticDigest)
const missingLanguageText = renderVisibleEnvelope(envelope, { tier: 'portable-markdown' })
assert.match(missingLanguageText, /Language fallback: requested=und, rendered=en, reason=language-context-missing/)
const unsupportedLocaleText = renderVisibleEnvelope(envelope, {
  tier: 'portable-markdown',
  languageContext: { ...ZH_LANGUAGE_CONTEXT, primaryLanguage: 'ja', responseLanguage: 'ja', artifactLanguage: 'ja' }
})
assert.match(unsupportedLocaleText, /Language fallback: requested=ja, rendered=en, reason=locale-catalog-unavailable:ja/)

const zhGrokAssist = renderGrokS07Assist({ languageContext: ZH_LANGUAGE_CONTEXT, project: 'devcodex' })
const enGrokAssist = renderGrokS07Assist({ languageContext: EN_LANGUAGE_CONTEXT, project: 'devcodex' })
const fallbackGrokAssist = renderGrokS07Assist({
  languageContext: { ...ZH_LANGUAGE_CONTEXT, primaryLanguage: 'ja', responseLanguage: 'ja', artifactLanguage: 'ja' },
  project: 'devcodex'
})
assert.match(zhGrokAssist, /### DevCodex · 入口检查/)
assert.match(zhGrokAssist, /下一步：先输出完整 PC0~PC10/)
assert.doesNotMatch(zhGrokAssist, /### DevCodex · Entry check|Language fallback:/)
assert.match(enGrokAssist, /### DevCodex · Entry check/)
assert.match(enGrokAssist, /Next: emit the complete PC0~PC10 block/)
assert.doesNotMatch(enGrokAssist, /### DevCodex · 入口检查|语言回退：/)
assert.match(fallbackGrokAssist, /### DevCodex · Entry check/)
assert.match(fallbackGrokAssist, /Language fallback: requested=ja, rendered=en, reason=locale-catalog-unavailable:ja/)
for (const output of [zhGrokAssist, enGrokAssist, fallbackGrokAssist]) {
  for (let ordinal = 0; ordinal <= 10; ordinal += 1) assert.match(output, new RegExp(`PC${ordinal}(?:\\D|$)`))
  assert.match(output, /GrokTurnChecklist/)
  assert.match(output, /DevCodexVisibleEnvelopeV3 · entry-check · BLOCK · s07-assist-context-incomplete/)
}

const noNextStep = createVisibleEnvelope({
  ...baseInput,
  postCompletionActions: createPostCompletionActionSet({ requiredNow: [], primaryAction: null, conditionalActions: [] })
})
const noNextStepText = renderVisibleEnvelope(noNextStep, {
  tier: 'portable-markdown', languageContext: ZH_LANGUAGE_CONTEXT
})
assert.doesNotMatch(noNextStepText, /继续当前动作|下一步：|条件动作：/)

const legacyInput = { ...baseInput }
delete legacyInput.postCompletionActions
delete legacyInput.entryCheckModel
legacyInput.checks = checks().slice(0, 8)
legacyInput.recommendedAction = '继续执行下一批'
const legacyEnvelope = createLegacyVisibleEnvelopeV1(legacyInput)
assert.strictEqual(legacyEnvelope.schemaVersion, 'DevCodexVisibleEnvelopeV1')
assert.strictEqual(legacyEnvelope.validation.valid, true)
const legacyView = normalizeCompatibleVisibleEnvelope(legacyEnvelope)
assert.strictEqual(legacyView.validation.valid, true)
assert.strictEqual(legacyView.migrationStatus, 'legacy-v1-read-only')
assert.strictEqual(legacyView.postCompletionActions.primaryAction.kind, 'legacy')
assert.strictEqual(legacyView.postCompletionActions.primaryAction.applicability, 'unverified')
assert.match(renderVisibleEnvelope(legacyEnvelope, {
  tier: 'portable-markdown', languageContext: ZH_LANGUAGE_CONTEXT, audience: 'audit'
}), /V1 兼容读取/)
assert.match(renderVisibleEnvelope(legacyEnvelope, {
  tier: 'portable-markdown', languageContext: ZH_LANGUAGE_CONTEXT, audience: 'audit'
}), /DevCodexVisibleEnvelopeV1/)

const v2Envelope = createVisibleEnvelopeV2({ ...baseInput, checks: checks().slice(0, 8) })
assert.strictEqual(v2Envelope.schemaVersion, 'DevCodexVisibleEnvelopeV2')
assert.strictEqual(normalizeCompatibleVisibleEnvelope(v2Envelope).migrationStatus, 'legacy-v2-read-only')
const tamperedV2 = JSON.parse(JSON.stringify(v2Envelope))
tamperedV2.postCompletionActions.requiredNow.push({
  kind: 'api-docs', label: '伪造完成后必做', reason: '负向读取探针', evidenceRefs: ['tampered'],
  applicability: 'required-now', authorization: 'not-required'
})
tamperedV2.messageKind = 'final-result'
const tamperedV2View = normalizeCompatibleVisibleEnvelope(tamperedV2)
assert.strictEqual(tamperedV2View.validation.valid, false)
assert(tamperedV2View.validation.errors.includes('completion-claim-requiredNow-must-be-empty'))
assert(tamperedV2View.validation.errors.includes('semanticDigest-mismatch'))
const extraFieldV2 = { ...v2Envelope, recommendedAction: 'V1 field injection' }
assert.strictEqual(normalizeCompatibleVisibleEnvelope(extraFieldV2).validation.valid, false)
const forgedActionValidation = JSON.parse(JSON.stringify(v2Envelope))
forgedActionValidation.postCompletionActions.validation.valid = false
assert.strictEqual(normalizeCompatibleVisibleEnvelope(forgedActionValidation).validation.valid, false)

const emptyChecksEnvelope = createVisibleEnvelope({
  ...baseInput,
  messageKind: 'progress',
  checks: [],
  userFacingArtifactSet: projectUserFacingArtifactSet(deliveryManifest, { messageKind: 'progress' })
})
assert.strictEqual(emptyChecksEnvelope.status, 'N/A')
const forgedEmptyChecksStatus = { ...emptyChecksEnvelope, status: 'PASS' }
const forgedEmptyChecksView = normalizeCompatibleVisibleEnvelope(forgedEmptyChecksStatus)
assert(forgedEmptyChecksView.validation.errors.includes('status-derived-value-mismatch'))

const injectedManifestProjection = JSON.parse(JSON.stringify(envelope))
injectedManifestProjection.artifactManifest.unexpected = true
assert(normalizeCompatibleVisibleEnvelope(injectedManifestProjection).validation.errors.includes('artifactManifest-projection-invalid'))

const mismatchedLinkSurface = JSON.parse(JSON.stringify(envelope))
mismatchedLinkSurface.context.hostSurface = 'different-host'
assert(normalizeCompatibleVisibleEnvelope(mismatchedLinkSurface).validation.errors.includes('linkCapability-surface-mismatch'))

const injectedNestedValidation = JSON.parse(JSON.stringify(envelope))
injectedNestedValidation.postCompletionActions.validation.unexpected = true
assert(normalizeCompatibleVisibleEnvelope(injectedNestedValidation).validation.errors.includes('postCompletionActions-serialized-shape-invalid'))

const duplicateActionEvidence = createPostCompletionActionSet({
  requiredNow: [],
  primaryAction: {
    kind: 'other', label: '重复证据', reason: '负向探针', evidenceRefs: ['same', 'same'],
    applicability: 'applicable', authorization: 'suggest-only'
  },
  conditionalActions: []
})
assert(duplicateActionEvidence.validation.errors.includes('primaryAction.evidenceRefs-duplicate'))

const duplicateKnownActionKind = createPostCompletionActionSet({
  requiredNow: [],
  primaryAction: {
    kind: 'api-docs', label: '生成接口文档', reason: '存在公开 API', evidenceRefs: ['api-surface'],
    applicability: 'applicable', authorization: 'suggest-only'
  },
  conditionalActions: [{
    kind: 'api-docs', label: '再生成一份接口说明', reason: '重复动作负例', evidenceRefs: ['api-surface'],
    applicability: 'conditional', authorization: 'suggest-only'
  }]
})
assert(duplicateKnownActionKind.validation.errors.includes('postCompletionActions-kind-duplicate'))

const optionalActionWithoutSuggestionBoundary = createPostCompletionActionSet({
  requiredNow: [],
  primaryAction: {
    kind: 'api-docs', label: '生成接口文档', reason: '建议动作负例', evidenceRefs: ['api-surface'],
    applicability: 'applicable', authorization: 'not-required'
  },
  conditionalActions: []
})
assert(optionalActionWithoutSuggestionBoundary.validation.errors.includes('primaryAction.optional-action-must-be-suggest-only'))

const tamperedLegacy = { ...legacyEnvelope, recommendedAction: '篡改后的旧建议' }
const tamperedLegacyView = normalizeCompatibleVisibleEnvelope(tamperedLegacy)
assert.strictEqual(tamperedLegacyView.validation.valid, false)
assert(tamperedLegacyView.validation.errors.includes('semanticDigest-mismatch'))

assert.strictEqual(createVisibleEnvelope({ ...baseInput, recommendedAction: '禁止回写 V1' }).status, 'BLOCK')
assert.strictEqual(createVisibleEnvelope({
  ...baseInput,
  messageKind: 'final-result',
  checks: checks().slice(0, 2),
  userFacingArtifactSet: projectUserFacingArtifactSet(deliveryManifest, { messageKind: 'final-result' }),
  postCompletionActions: {
    requiredNow: [{
      kind: 'api-docs', label: '补齐接口文档', reason: 'Profile 要求', evidenceRefs: ['profile'],
      applicability: 'required-now', authorization: 'not-required'
    }],
    primaryAction: null,
    conditionalActions: []
  }
}).status, 'BLOCK')
assert.strictEqual(createPostCompletionActionSet({
  requiredNow: [],
  primaryAction: null,
  conditionalActions: [{
    kind: 'push', label: '推送', reason: '错误授权负例', evidenceRefs: ['negative-probe'],
    applicability: 'conditional', authorization: 'not-required'
  }]
}).validation.valid, false)
assert.strictEqual(createPostCompletionActionSet({
  requiredNow: [], primaryAction: null,
  conditionalActions: [0, 1, 2].map(index => ({
    kind: 'other', label: `条件动作 ${index}`, reason: '数量上限负例', evidenceRefs: ['negative-probe'],
    applicability: 'conditional', authorization: 'suggest-only'
  }))
}).validation.valid, false)

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
assert.match(renderVisibleEnvelope(failedSurfaceEnvelope, {
  tier: 'plain-text', languageContext: ZH_LANGUAGE_CONTEXT
}), /fallback：link-failed/)

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
const compactText = renderVisibleEnvelope(compactEnvelope, {
  tier: 'portable-markdown', compact: true, languageContext: ZH_LANGUAGE_CONTEXT
})
for (let index = 0; index < 11; index += 1) assert.match(compactText, new RegExp(`PC${index}=`))
assert.match(compactText, /状态未变化/)
const confirmationExpanded = renderVisibleEnvelope(confirmation, {
  tier: 'portable-markdown', compact: true, languageContext: ZH_LANGUAGE_CONTEXT
})
assert.doesNotMatch(confirmationExpanded, /状态未变化/)
const invalidPortable = renderVisibleEnvelope(invalidStatus, {
  tier: 'rich-markdown', compact: true, languageContext: ZH_LANGUAGE_CONTEXT
})
assert.match(invalidPortable, /可见输出契约无效/)
assert.doesNotMatch(invalidPortable, /VISIBLE_ENVELOPE_INVALID/)
assert.doesNotMatch(invalidPortable, /状态未变化/)
const invalidAudit = renderVisibleEnvelope(invalidStatus, {
  tier: 'rich-markdown', compact: true, languageContext: ZH_LANGUAGE_CONTEXT, audience: 'audit'
})
assert.match(invalidAudit, /VISIBLE_ENVELOPE_INVALID/)

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

const schema = JSON.parse(fs.readFileSync(
  resolveControlAsset(ROOT, 'skills/user-visible-output-contract/visible-output-contract.schema.json'),
  'utf8'
))
for (const definition of [
  'ArtifactDeliveryManifestV1',
  'ArtifactTruthSourceClassificationV1',
  'ArtifactAnchorV1',
  'ArtifactAnchorProjectionV1',
  'UserFacingArtifactSetV1',
  'LinkCapabilityDecisionV1',
  'HostLinkCapabilityDecisionV2',
  'ArtifactDeliveryAttemptV1',
  'ArtifactDeliveryResolutionV1',
  'FinalValidationSummaryV1',
  'PostCompletionActionSetV1',
  'DevCodexVisibleEnvelopeV1',
  'DevCodexVisibleEnvelopeV2',
  'EntryCheckModelV3',
  'DevCodexVisibleEnvelopeV3'
]) {
  assert.ok(schema.$defs[definition], `schema missing ${definition}`)
  assert.strictEqual(schema.$defs[definition].additionalProperties, false, `${definition} must reject sibling fields`)
}
assert.ok(schema.$defs.LinkCapabilityDecisionV1.required.includes('evidenceRefs'))
assert.ok(schema.$defs.HostLinkCapabilityDecisionV2.required.includes('presentationSurface'))
assert.ok(schema.$defs.ArtifactDeliveryAttemptV1.required.includes('readback'))
assert.ok(schema.$defs.DevCodexVisibleEnvelopeV3.required.includes('artifactDeliveryAttempts'))
assert.strictEqual(schema.$defs.ArtifactDeliveryManifestV1.properties.generatedAt.format, 'date-time')
assert.strictEqual(schema.$defs.ArtifactAnchorV1.properties.generatedAt.format, 'date-time')
assert.match(schema.$defs.ArtifactAnchorProjectionV1.properties.projectionDigest.pattern, /artifact-anchor-projection/)
assert.ok(schema.$defs.DevCodexVisibleEnvelopeV1.required.includes('recommendedAction'))
assert.ok(schema.$defs.DevCodexVisibleEnvelopeV2.required.includes('postCompletionActions'))
assert.ok(!schema.$defs.DevCodexVisibleEnvelopeV2.required.includes('recommendedAction'))
assert.ok(schema.$defs.DevCodexVisibleEnvelopeV3.required.includes('entryCheckModel'))

console.log('visible output contract passed: V3 PC0-PC10 with V1/V2 read compatibility and fail-closed rendering')
