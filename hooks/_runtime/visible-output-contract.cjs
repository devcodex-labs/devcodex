'use strict'

const crypto = require('crypto')
const path = require('path')
const { compactLanguageContext } = require('./language-context.cjs')

const MESSAGE_KINDS = new Set([
  'entry-check', 'completion-check', 'confirmation', 'progress', 'final-result', 'error-block'
])
const STATUSES = new Set(['PASS', 'WARN', 'BLOCK', 'UNVERIFIED', 'N/A'])
const LIFECYCLE_OPERATIONS = new Set(['create', 'update', 'rename', 'move', 'delete', 'unchanged-evidence'])
const VISIBILITIES = new Set(['decision-required', 'result', 'evidence', 'optional-detail', 'internal-only'])
const DELIVERY_REQUIREMENTS = new Set(['required', 'supporting', 'internal'])
const PRESENTATION_TIERS = new Set(['rich-markdown', 'portable-markdown', 'plain-text'])
const LINK_MODES = new Set(['clickable', 'portable', 'plain', 'failed'])
const HOST_LINK_OPEN_MODES = new Set([
  'native-action', 'markdown-link', 'terminal-command', 'portable-path', 'absolute-copy', 'unavailable'
])
const ARTIFACT_DELIVERY_ACTION_STATUSES = new Set(['not-attempted', 'succeeded', 'failed'])
const ARTIFACT_DELIVERY_READBACK_STATUSES = new Set(['not-attempted', 'succeeded', 'failed', 'unavailable'])
const ARTIFACT_DELIVERY_STATUSES = new Set(['ready', 'opened', 'fallback'])
const EVIDENCE_STATES = new Set(['verified', 'unverified', 'failed'])
const POST_COMPLETION_ACTION_KINDS = new Set([
  'api-docs', 'http-verification', 'commit', 'switch-target', 'cherry-pick', 'push', 'other'
])
const POST_COMPLETION_APPLICABILITIES = new Set(['required-now', 'applicable', 'conditional'])
const POST_COMPLETION_AUTHORIZATIONS = new Set(['not-required', 'suggest-only', 'explicit-required'])
const VISIBLE_ENVELOPE_V1_KEYS = Object.freeze([
  'schemaVersion', 'messageKind', 'status', 'context', 'checks', 'decision', 'recommendedAction',
  'artifactManifest', 'userFacingArtifactSet', 'artifactLinks', 'linkCapability', 'presentation',
  'semanticDigest', 'validation'
])
const VISIBLE_ENVELOPE_V2_KEYS = Object.freeze([
  'schemaVersion', 'messageKind', 'status', 'context', 'checks', 'decision', 'postCompletionActions',
  'artifactManifest', 'userFacingArtifactSet', 'artifactLinks', 'linkCapability', 'presentation',
  'semanticDigest', 'validation'
])
const VISIBLE_ENVELOPE_V3_KEYS = Object.freeze([
  'schemaVersion', 'messageKind', 'status', 'context', 'checks', 'decision', 'postCompletionActions',
  'entryCheckModel', 'artifactManifest', 'userFacingArtifactSet', 'artifactLinks', 'linkCapability',
  'artifactDeliveryAttempts', 'presentation', 'semanticDigest', 'validation'
])
const VERSION_ALIGNMENTS = new Set(['aligned', 'version-only', 'source-ahead', 'runtime-mismatch', 'unverified'])
const ASSURANCE_LEVELS = new Set(['targeted', 'affected', 'full'])
const VISIBILITY_ORDER = new Map([
  ['decision-required', 0], ['result', 1], ['evidence', 2], ['optional-detail', 3], ['internal-only', 4]
])
const STATUS_SEVERITY = new Map([
  ['N/A', 0], ['PASS', 1], ['WARN', 2], ['UNVERIFIED', 3], ['BLOCK', 4]
])
const INTERNAL_ARTIFACT_CLASSES = new Set([
  'session', 'daily', 'summary', 'task-state', 'checkpoint', 'runtime-state',
  'raw-receipt', 'raw-manifest', 'raw-ledger'
])
const TRUTH_SOURCE_KINDS = new Set(['json-canonical', 'markdown-canonical', 'projection', 'external'])
const ARTIFACT_ANCHOR_STATUSES = new Set(['fresh', 'stale', 'blocked', 'unknown'])
const JSON_CANONICAL_ARTIFACT_CLASSES = new Set([
  'runtime-state', 'validation-snapshot', 'workflow-completion', 'manifest', 'raw-manifest',
  'raw-receipt', 'raw-ledger', 'project-knowledge', 'context-plan', 'budget-decision'
])
const MARKDOWN_CANONICAL_ARTIFACT_CLASSES = new Set([
  'requirement', 'cp', 'tech-design', 'skill', 'prompt', 'readme', 'docs', 'instructions',
  'report', 'changelog', 'decision', 'deliverable', 'evidence'
])
const PROJECTION_ARTIFACT_CLASSES = new Set([
  'memory', 'summary', 'final', 'session', 'daily', 'task-state', 'checkpoint',
  'visible-envelope', 'user-facing-set', 'artifact-projection'
])
const ACTION_HEADINGS = Object.freeze({
  confirmation: '需要你确认的文件',
  progress: '本批交付文件',
  'final-result': '完成交付文件',
  'error-block': '阻断证据',
  'entry-check': '本批交付文件',
  'completion-check': '完成交付文件'
})
const VISIBLE_LOCALE_CATALOGS = Object.freeze({
  'zh-CN': Object.freeze({
    languageName: '中文',
    kindLabels: {
      'entry-check': '入口检查', 'completion-check': '完成检查', confirmation: '确认',
      progress: '进度', 'final-result': '执行结果', 'error-block': '阻断'
    },
    actionHeadings: ACTION_HEADINGS,
    unknownProject: '未识别项目',
    statusUnchanged: '状态未变化',
    next: '下一步',
    checkAction: '动作',
    confirm: '确认',
    recommend: '建议',
    purposeMissing: '用途未标注',
    view: '查看',
    path: '路径',
    action: '操作',
    absolutePath: '绝对路径',
    opened: '已打开（动作与回读均成功）',
    nativeAction: '原生动作',
    openCommand: '打开命令',
    listed: '已列',
    total: '总计',
    hidden: '默认隐藏',
    requiredNow: '当前必须完成',
    conditionalAction: '条件动作',
    legacyV1: 'V1 兼容读取，适用性与授权未验证',
    localeFallback: (requested, reason) => `语言回退：请求=${requested || 'und'}，实际=en，原因=${reason}`
  }),
  en: Object.freeze({
    languageName: 'English',
    kindLabels: {
      'entry-check': 'Entry check', 'completion-check': 'Completion check', confirmation: 'Confirmation',
      progress: 'Progress', 'final-result': 'Result', 'error-block': 'Blocked'
    },
    actionHeadings: {
      confirmation: 'Files requiring your confirmation',
      progress: 'Files from this batch',
      'final-result': 'Delivered files',
      'error-block': 'Blocking evidence',
      'entry-check': 'Files from this batch',
      'completion-check': 'Delivered files'
    },
    unknownProject: 'unverified project',
    statusUnchanged: 'No status change',
    next: 'Next',
    checkAction: 'Action',
    confirm: 'Confirm',
    recommend: 'Recommended',
    purposeMissing: 'Purpose not specified',
    view: 'View',
    path: 'Path',
    action: 'Action',
    absolutePath: 'Absolute path',
    opened: 'Opened (action and readback succeeded)',
    nativeAction: 'Native action',
    openCommand: 'Open command',
    listed: 'Listed',
    total: 'total',
    hidden: 'hidden by default',
    requiredNow: 'Required now',
    conditionalAction: 'Conditional action',
    legacyV1: 'V1 compatibility read; applicability and authorization are unverified',
    localeFallback: (requested, reason) => `Language fallback: requested=${requested || 'und'}, rendered=en, reason=${reason}`
  })
})

function resolveVisibleLocale(languageContext) {
  const compact = compactLanguageContext(languageContext)
  const requestedLanguage = compact?.responseLanguage || compact?.primaryLanguage || ''
  const renderedLanguage = VISIBLE_LOCALE_CATALOGS[requestedLanguage]
    ? requestedLanguage
    : 'en'
  const fallbackReason = !compact
    ? 'language-context-missing'
    : (renderedLanguage !== requestedLanguage ? `locale-catalog-unavailable:${requestedLanguage}` : null)
  return {
    schemaVersion: 'VisibleLocaleDecisionV1',
    requestedLanguage: requestedLanguage || 'und',
    renderedLanguage,
    confidence: fallbackReason ? 'low' : compact.confidence,
    fallbackReason,
    catalog: VISIBLE_LOCALE_CATALOGS[renderedLanguage]
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
  }
  return value
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function textList(value) {
  return Array.isArray(value) && value.every(text)
}

function normalizeWorkflowAxisProjection(decision) {
  if (!decision || decision.schemaVersion !== 'WorkflowPlanDecisionV1') return null
  return {
    decisionId: String(decision.decisionId || ''),
    phase: String(decision.phase || ''),
    ceremonyTier: String(decision.axes?.ceremonyTier?.value || ''),
    designDepth: String(decision.axes?.designDepth?.value || ''),
    assuranceLevel: String(decision.axes?.assuranceLevel?.value || '')
  }
}

function createEntryCheckModelV3(input = {}) {
  const errors = []
  const versionInput = input.versionFacts && typeof input.versionFacts === 'object' && !Array.isArray(input.versionFacts)
    ? input.versionFacts
    : {}
  const sourceInput = versionInput.sourceCandidate && typeof versionInput.sourceCandidate === 'object' && !Array.isArray(versionInput.sourceCandidate)
    ? versionInput.sourceCandidate
    : null
  const runtimeInput = versionInput.activeRuntimeGeneration && typeof versionInput.activeRuntimeGeneration === 'object' && !Array.isArray(versionInput.activeRuntimeGeneration)
    ? versionInput.activeRuntimeGeneration
    : null
  const configuredRuntimeInput = versionInput.configuredRuntimeGeneration && typeof versionInput.configuredRuntimeGeneration === 'object' && !Array.isArray(versionInput.configuredRuntimeGeneration)
    ? versionInput.configuredRuntimeGeneration
    : null
  const alignment = VERSION_ALIGNMENTS.has(versionInput.alignment) ? versionInput.alignment : 'unverified'
  const restartRequired = typeof versionInput.restartRequired === 'boolean'
    ? versionInput.restartRequired
    : (alignment === 'runtime-mismatch' ? true : null)
  const versionFacts = {
    installedPackageVersion: String(versionInput.installedPackageVersion || 'unverified'),
    activeRuntimeGeneration: runtimeInput ? {
      generationId: String(runtimeInput.generationId || 'unverified'),
      packageVersion: String(runtimeInput.packageVersion || 'unverified'),
      manifestStatus: String(runtimeInput.manifestStatus || 'unverified')
    } : null,
    configuredRuntimeGeneration: configuredRuntimeInput ? {
      generationId: String(configuredRuntimeInput.generationId || 'unverified'),
      packageVersion: String(configuredRuntimeInput.packageVersion || 'unverified'),
      manifestStatus: String(configuredRuntimeInput.manifestStatus || 'unverified')
    } : null,
    sourceCandidate: sourceInput ? {
      root: String(sourceInput.root || ''),
      packageVersion: String(sourceInput.packageVersion || 'unverified'),
      shortHead: String(sourceInput.shortHead || 'unverified'),
      dirty: sourceInput.dirty === true
    } : null,
    alignment,
    restartRequired,
    restartReason: String(versionInput.restartReason || (
      restartRequired === true
        ? 'active-runtime-generation-superseded'
        : (restartRequired === false ? 'active-runtime-generation-current' : 'runtime-generation-unverified')
    ))
  }
  const workflowInput = input.workflowPlan && typeof input.workflowPlan === 'object' && !Array.isArray(input.workflowPlan)
    ? input.workflowPlan
    : {}
  const precheck = normalizeWorkflowAxisProjection(input.precheckDecision) || workflowInput.precheck || null
  const postContext = normalizeWorkflowAxisProjection(input.postContextDecision) || workflowInput.postContext || null
  const differences = Array.isArray(workflowInput.differences)
    ? [...new Set(workflowInput.differences.map(String))].sort()
    : [...new Set(input.postContextDecision?.change?.changedAxes || [])].sort()
  const workflowPlan = { precheck, postContext, differences }
  const planInput = input.validationPlan && typeof input.validationPlan === 'object' && !Array.isArray(input.validationPlan)
    ? input.validationPlan
    : {}
  const nonNegativeInteger = value => Number.isInteger(value) && value >= 0 ? value : 0
  const validationPlan = {
    assuranceLevel: ASSURANCE_LEVELS.has(planInput.assuranceLevel)
      ? planInput.assuranceLevel
      : String(postContext?.assuranceLevel || precheck?.assuranceLevel || 'affected'),
    targetedCount: nonNegativeInteger(planInput.targetedCount),
    affectedCount: nonNegativeInteger(planInput.affectedCount),
    fullCount: nonNegativeInteger(planInput.fullCount),
    ciRequired: planInput.ciRequired === true,
    packageRequired: planInput.packageRequired === true,
    installRequired: planInput.installRequired === true,
    releaseRequired: planInput.releaseRequired === true,
    estimatedDuration: String(planInput.estimatedDuration || 'unverified')
  }
  const continuationInput = input.continuation && typeof input.continuation === 'object' && !Array.isArray(input.continuation)
    ? input.continuation
    : {}
  const continuation = {
    nextStage: String(continuationInput.nextStage || 'context-and-route'),
    automatic: continuationInput.automatic === true,
    userAction: String(continuationInput.userAction || 'none'),
    correctionHint: String(continuationInput.correctionHint || '直接说明要调整的流程、方案深度或验证范围')
  }
  if (!text(versionFacts.installedPackageVersion)) errors.push('versionFacts.installedPackageVersion-required')
  if (!VERSION_ALIGNMENTS.has(versionFacts.alignment)) errors.push('versionFacts.alignment-invalid')
  if (![true, false, null].includes(versionFacts.restartRequired)) errors.push('versionFacts.restartRequired-invalid')
  if (!text(versionFacts.restartReason)) errors.push('versionFacts.restartReason-required')
  if (versionFacts.alignment === 'runtime-mismatch' && versionFacts.restartRequired !== true) {
    errors.push('versionFacts.runtimeMismatch-restart-required')
  }
  if (!precheck || !text(precheck.ceremonyTier) || !text(precheck.designDepth) || !text(precheck.assuranceLevel)) {
    errors.push('workflowPlan.precheck-required')
  }
  if (!ASSURANCE_LEVELS.has(validationPlan.assuranceLevel)) errors.push('validationPlan.assuranceLevel-invalid')
  for (const field of ['nextStage', 'userAction', 'correctionHint']) {
    if (!text(continuation[field])) errors.push(`continuation.${field}-required`)
  }
  return {
    schemaVersion: 'EntryCheckModelV3',
    versionFacts,
    workflowPlan,
    validationPlan,
    continuation,
    showPlan: input.showPlan !== false,
    validation: { valid: errors.length === 0, errors }
  }
}

function entryCheckModelIntegrityErrors(value) {
  const errors = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['entryCheckModel-required']
  if (!hasExactKeys(value, [
    'schemaVersion', 'versionFacts', 'workflowPlan', 'validationPlan', 'continuation', 'showPlan', 'validation'
  ])) errors.push('entryCheckModel-fields-invalid')
  if (value.schemaVersion !== 'EntryCheckModelV3') errors.push('entryCheckModel-schema-invalid')
  if (!VERSION_ALIGNMENTS.has(value.versionFacts?.alignment)) errors.push('entryCheckModel-alignment-invalid')
  if (![true, false, null].includes(value.versionFacts?.restartRequired) || !text(value.versionFacts?.restartReason)) {
    errors.push('entryCheckModel-restart-status-invalid')
  }
  if (value.versionFacts?.alignment === 'runtime-mismatch' && value.versionFacts?.restartRequired !== true) {
    errors.push('entryCheckModel-runtime-mismatch-restart-invalid')
  }
  if (!value.workflowPlan?.precheck || !text(value.workflowPlan.precheck.ceremonyTier) ||
      !text(value.workflowPlan.precheck.designDepth) || !text(value.workflowPlan.precheck.assuranceLevel)) {
    errors.push('entryCheckModel-workflow-precheck-invalid')
  }
  if (!ASSURANCE_LEVELS.has(value.validationPlan?.assuranceLevel)) errors.push('entryCheckModel-assurance-invalid')
  if (!hasExactKeys(value.validation, ['valid', 'errors']) || value.validation.valid !== true || value.validation.errors?.length) {
    errors.push('entryCheckModel-validation-invalid')
  }
  return errors
}

function hasDuplicates(value) {
  return Array.isArray(value) && new Set(value).size !== value.length
}

function hasExactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = keys.slice().sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function validCandidateIdentity(value) {
  return text(value) || Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length)
}

function canonicalPathIdentity(filePath) {
  let normalized = path.normalize(String(filePath || '')).replace(/\\/g, '/').replace(/\/$/, '')
  if (/^[A-Z]:\//.test(normalized)) normalized = normalized[0].toLowerCase() + normalized.slice(1)
  return normalized
}

function basenamePortable(filePath) {
  return String(filePath || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || ''
}

function isSemanticDisplayName(displayName, canonicalPath) {
  if (!text(displayName) || displayName.trim().length < 4) return false
  const normalized = displayName.trim()
  if (normalized === canonicalPath || normalized === basenamePortable(canonicalPath)) return false
  if (/^(?:CP\d+(?:\s+v?\d+(?:\.\d+){1,3})?|v?\d+(?:\.\d+){1,3}|PASS|WARN|BLOCK|UNVERIFIED|N\/A)$/i.test(normalized)) return false
  if (/^[^\\/]+\.[A-Za-z0-9]{1,8}$/.test(normalized)) return false
  return !/[\\/]$/.test(normalized)
}

function difference(left, right) {
  return [...left].filter(value => !right.has(value)).sort()
}

function normalizeEntry(entry) {
  return {
    artifactId: entry?.artifactId,
    canonicalPath: entry?.canonicalPath,
    previousPath: entry?.previousPath ?? null,
    lifecycleOperation: entry?.lifecycleOperation,
    origin: entry?.origin,
    ownership: entry?.ownership,
    artifactClass: entry?.artifactClass,
    deliveryRequirement: entry?.deliveryRequirement,
    visibility: entry?.visibility,
    displayName: entry?.displayName,
    purposeKey: entry?.purposeKey,
    purposeText: entry?.purposeText,
    userAction: entry?.userAction,
    readingOrder: entry?.readingOrder,
    contentDigest: entry?.contentDigest,
    evidenceRefs: entry?.evidenceRefs
  }
}

function validateArtifactEntry(entry, index) {
  const errors = []
  const prefix = `entries[${index}]`
  for (const field of [
    'artifactId', 'canonicalPath', 'origin', 'ownership', 'artifactClass', 'displayName',
    'purposeKey', 'purposeText', 'userAction', 'contentDigest'
  ]) {
    if (!text(entry[field])) errors.push(`${prefix}.${field}-required`)
  }
  if (!LIFECYCLE_OPERATIONS.has(entry.lifecycleOperation)) errors.push(`${prefix}.lifecycleOperation-invalid`)
  if (!VISIBILITIES.has(entry.visibility)) errors.push(`${prefix}.visibility-invalid`)
  if (!DELIVERY_REQUIREMENTS.has(entry.deliveryRequirement)) errors.push(`${prefix}.deliveryRequirement-invalid`)
  if (!Number.isInteger(entry.readingOrder) || entry.readingOrder < 0) errors.push(`${prefix}.readingOrder-invalid`)
  if (!textList(entry.evidenceRefs)) errors.push(`${prefix}.evidenceRefs-invalid`)
  if (!isSemanticDisplayName(entry.displayName, entry.canonicalPath)) errors.push(`${prefix}.displayName-not-semantic`)
  if (/^file:\/\//i.test(entry.canonicalPath || '')) errors.push(`${prefix}.canonicalPath-file-uri-forbidden`)
  if (text(entry.canonicalPath) && !path.isAbsolute(entry.canonicalPath)) errors.push(`${prefix}.canonicalPath-not-absolute`)
  if (['rename', 'move', 'delete'].includes(entry.lifecycleOperation) && !text(entry.previousPath)) {
    errors.push(`${prefix}.previousPath-required`)
  }
  if (text(entry.previousPath) && !path.isAbsolute(entry.previousPath)) errors.push(`${prefix}.previousPath-not-absolute`)
  if (['rename', 'move'].includes(entry.lifecycleOperation) && text(entry.previousPath) &&
      canonicalPathIdentity(entry.previousPath) === canonicalPathIdentity(entry.canonicalPath)) {
    errors.push(`${prefix}.previousPath-must-differ`)
  }
  if (entry.deliveryRequirement === 'required' && entry.visibility === 'internal-only') {
    errors.push(`${prefix}.required-artifact-hidden`)
  }
  if (entry.deliveryRequirement === 'internal' && entry.visibility !== 'internal-only') {
    errors.push(`${prefix}.internal-delivery-must-be-hidden`)
  }
  if (INTERNAL_ARTIFACT_CLASSES.has(entry.artifactClass) &&
      (entry.deliveryRequirement !== 'internal' || entry.visibility !== 'internal-only')) {
    errors.push(`${prefix}.internal-class-must-be-hidden`)
  }
  return errors
}

function createArtifactDeliveryManifest(input) {
  const errors = []
  if (!text(input?.taskId)) errors.push('taskId-required')
  if (!validCandidateIdentity(input?.candidateIdentity)) errors.push('candidateIdentity-required')
  if (!text(input?.generatedAt)) errors.push('generatedAt-required')
  if (text(input?.generatedAt) && !Number.isFinite(Date.parse(input.generatedAt))) errors.push('generatedAt-invalid')
  if (!Array.isArray(input?.entries)) errors.push('entries-invalid')
  const entries = Array.isArray(input?.entries)
    ? input.entries.map(normalizeEntry).sort((left, right) => String(left.artifactId).localeCompare(String(right.artifactId)))
    : []
  entries.forEach((entry, index) => errors.push(...validateArtifactEntry(entry, index)))

  const artifactIds = entries.map(entry => entry.artifactId).filter(text)
  const canonicalPaths = entries.map(entry => entry.canonicalPath).filter(text).map(canonicalPathIdentity)
  if (new Set(artifactIds).size !== artifactIds.length) errors.push('artifactId-duplicate')
  if (new Set(canonicalPaths).size !== canonicalPaths.length) errors.push('canonicalPath-duplicate')

  const listFields = ['plannedArtifactIds', 'observedArtifactIds', 'internalDeliveredArtifactIds']
  for (const field of listFields) {
    if (!textList(input?.[field])) errors.push(`${field}-invalid`)
    else if (hasDuplicates(input[field])) errors.push(`${field}-duplicate`)
  }
  const entrySet = new Set(artifactIds)
  const planned = new Set(input?.plannedArtifactIds || [])
  const observed = new Set(input?.observedArtifactIds || [])
  const internalDelivered = new Set(input?.internalDeliveredArtifactIds || [])
  const reconciliation = {
    plannedCount: planned.size,
    observedCount: observed.size,
    internalDeliveredCount: internalDelivered.size,
    entryCount: entrySet.size,
    missingEntries: difference(planned, entrySet),
    unexpectedEntries: difference(entrySet, planned),
    missingObserved: difference(planned, observed),
    unexpectedObserved: difference(observed, planned),
    missingInternalDelivered: difference(planned, internalDelivered),
    unexpectedInternalDelivered: difference(internalDelivered, planned),
    conflicting: errors.slice()
  }
  reconciliation.status = Object.entries(reconciliation)
    .filter(([, value]) => Array.isArray(value))
    .every(([, value]) => value.length === 0) ? 'verified' : 'failed'

  const core = {
    schemaVersion: 'ArtifactDeliveryManifestV1',
    taskId: input?.taskId || '',
    candidateIdentity: input?.candidateIdentity || null,
    generatedAt: input?.generatedAt || '',
    entries,
    reconciliation
  }
  return {
    ...core,
    manifestId: `artifact-manifest-${digest(core)}`,
    validation: { valid: reconciliation.status === 'verified', errors: reconciliation.conflicting }
  }
}

function artifactIsVisible(entry, scope) {
  if (scope === 'internal-audit') return true
  if (INTERNAL_ARTIFACT_CLASSES.has(entry.artifactClass)) return false
  if (entry.visibility === 'internal-only') return false
  if (scope === 'all-deliverable') return true
  if (['decision-required', 'result'].includes(entry.visibility)) return true
  return entry.visibility === 'evidence' && entry.deliveryRequirement === 'required'
}

function projectUserFacingArtifactSet(manifest, { scope = 'default', messageKind = 'final-result' } = {}) {
  const errors = []
  if (manifest?.schemaVersion !== 'ArtifactDeliveryManifestV1' || !manifest?.validation?.valid ||
      manifest?.reconciliation?.status !== 'verified') errors.push('manifest-not-reconciled')
  if (!['default', 'all-deliverable', 'internal-audit'].includes(scope)) errors.push('scope-invalid')
  if (!MESSAGE_KINDS.has(messageKind)) errors.push('messageKind-invalid')
  const entries = Array.isArray(manifest?.entries) ? manifest.entries : []
  const visible = entries.filter(entry => artifactIsVisible(entry, scope)).sort((left, right) => {
    return VISIBILITY_ORDER.get(left.visibility) - VISIBILITY_ORDER.get(right.visibility) ||
      left.readingOrder - right.readingOrder || left.artifactId.localeCompare(right.artifactId)
  })
  const requiredHidden = entries.filter(entry => entry.deliveryRequirement === 'required' && !visible.includes(entry))
  if (requiredHidden.length) errors.push('required-artifact-hidden')
  const items = visible.map(entry => ({
    artifactId: entry.artifactId,
    canonicalPath: entry.canonicalPath,
    lifecycleOperation: entry.lifecycleOperation,
    visibility: entry.visibility,
    displayName: entry.displayName,
    purposeKey: entry.purposeKey,
    purposeText: entry.purposeText,
    userAction: entry.userAction,
    readingOrder: entry.readingOrder,
    contentDigest: entry.contentDigest
  }))
  const core = {
    schemaVersion: 'UserFacingArtifactSetV1',
    manifestId: manifest?.manifestId || '',
    scope,
    heading: ACTION_HEADINGS[messageKind] || ACTION_HEADINGS['final-result'],
    items,
    counts: { listed: items.length, remaining: entries.length - items.length, total: entries.length },
    reconciliation: {
      status: errors.length ? 'failed' : 'verified',
      requiredHidden: requiredHidden.map(entry => entry.artifactId),
      countConserved: items.length + (entries.length - items.length) === entries.length
    }
  }
  return { ...core, setId: `user-facing-artifacts-${digest(core)}`, validation: { valid: errors.length === 0, errors } }
}

function normalizeArtifactKind(value) {
  return String(value || '').trim().toLowerCase()
}

function classifyArtifactTruthSource(input = {}) {
  const artifactKind = normalizeArtifactKind(typeof input === 'string' ? input : input.artifactKind)
  let truthSourceKind = 'external'
  if (JSON_CANONICAL_ARTIFACT_CLASSES.has(artifactKind)) truthSourceKind = 'json-canonical'
  else if (MARKDOWN_CANONICAL_ARTIFACT_CLASSES.has(artifactKind)) truthSourceKind = 'markdown-canonical'
  else if (PROJECTION_ARTIFACT_CLASSES.has(artifactKind)) truthSourceKind = 'projection'

  const core = {
    schemaVersion: 'ArtifactTruthSourceClassificationV1',
    artifactKind,
    truthSourceKind,
    machineValidationRequired: truthSourceKind === 'json-canonical',
    projectionAllowed: truthSourceKind !== 'projection',
    humanConfirmationRequired: ['requirement', 'cp', 'tech-design', 'skill', 'prompt', 'readme', 'docs', 'instructions'].includes(artifactKind),
    sidecarAllowed: ['markdown-canonical', 'external'].includes(truthSourceKind),
    canonicalFormat: truthSourceKind === 'json-canonical' ? 'json' : (truthSourceKind === 'markdown-canonical' ? 'markdown' : 'derived')
  }
  const errors = []
  if (!text(artifactKind)) errors.push('artifactKind-required')
  return { ...core, classificationDigest: `artifact-truth-source-${digest(core)}`, validation: { valid: errors.length === 0, errors } }
}

function createArtifactAnchor(input = {}) {
  const classification = classifyArtifactTruthSource(input)
  const truthSourceKind = TRUTH_SOURCE_KINDS.has(input.truthSourceKind)
    ? input.truthSourceKind
    : classification.truthSourceKind
  const status = ARTIFACT_ANCHOR_STATUSES.has(input.status) ? input.status : 'unknown'
  const evidenceRefs = textList(input.evidenceRefs)
    ? [...new Set(input.evidenceRefs)].sort()
    : []
  const errors = []
  for (const field of ['artifactId', 'artifactKind', 'canonicalPath', 'contentDigest', 'generatedAt', 'owner']) {
    if (!text(input[field])) errors.push(`${field}-required`)
  }
  if (text(input.generatedAt) && !Number.isFinite(Date.parse(input.generatedAt))) errors.push('generatedAt-invalid')
  if (text(input.canonicalPath) && !path.isAbsolute(input.canonicalPath)) errors.push('canonicalPath-not-absolute')
  if (text(input.canonicalPath) && /^file:\/\//i.test(input.canonicalPath)) errors.push('canonicalPath-file-uri-forbidden')
  if (input.truthSourceKind !== undefined && !TRUTH_SOURCE_KINDS.has(input.truthSourceKind)) errors.push('truthSourceKind-invalid')
  if (input.status !== undefined && !ARTIFACT_ANCHOR_STATUSES.has(input.status)) errors.push('status-invalid')
  if (input.evidenceRefs !== undefined && !textList(input.evidenceRefs)) errors.push('evidenceRefs-invalid')
  errors.push(...classification.validation.errors.map(error => `classification.${error}`))

  const core = {
    schemaVersion: 'ArtifactAnchorV1',
    artifactId: input.artifactId || '',
    artifactKind: normalizeArtifactKind(input.artifactKind),
    truthSourceKind,
    canonicalPath: input.canonicalPath || '',
    contentDigest: input.contentDigest || '',
    projectionDigest: input.projectionDigest || null,
    generatedAt: input.generatedAt || '',
    owner: input.owner || '',
    status,
    stalePolicy: input.stalePolicy || 'contentDigest-mismatch->stale',
    evidenceRefs,
    summaryLine: input.summaryLine || '',
    classification
  }
  return { ...core, anchorDigest: `artifact-anchor-${digest(core)}`, validation: { valid: errors.length === 0, errors } }
}

function projectArtifactAnchorsFromManifest(manifest, {
  generatedAt = manifest?.generatedAt || '',
  owner = 'artifact-delivery-manifest',
  status = 'fresh'
} = {}) {
  const errors = []
  if (manifest?.schemaVersion !== 'ArtifactDeliveryManifestV1' || !manifest?.validation?.valid ||
      manifest?.reconciliation?.status !== 'verified') errors.push('manifest-not-reconciled')
  const manifestRef = text(manifest?.manifestId) ? `manifest:${manifest.manifestId}` : 'manifest:unknown'
  const entries = Array.isArray(manifest?.entries) ? manifest.entries : []
  const anchors = entries.map(entry => createArtifactAnchor({
    artifactId: entry.artifactId,
    artifactKind: entry.artifactClass,
    canonicalPath: entry.canonicalPath,
    contentDigest: entry.contentDigest,
    generatedAt,
    owner,
    status,
    stalePolicy: 'manifest-contentDigest-mismatch->blocked',
    evidenceRefs: [...(textList(entry.evidenceRefs) ? entry.evidenceRefs : []), manifestRef],
    summaryLine: entry.purposeText
  }))
  anchors.forEach((anchor, index) => {
    if (!anchor.validation.valid) errors.push(...anchor.validation.errors.map(error => `anchors[${index}].${error}`))
  })
  const core = {
    schemaVersion: 'ArtifactAnchorProjectionV1',
    sourceSchemaVersion: manifest?.schemaVersion || null,
    sourceId: manifest?.manifestId || null,
    sourceDigest: manifest?.manifestId || null,
    generatedAt,
    owner,
    anchors
  }
  if (!text(generatedAt)) errors.push('generatedAt-required')
  if (text(generatedAt) && !Number.isFinite(Date.parse(generatedAt))) errors.push('generatedAt-invalid')
  if (!text(owner)) errors.push('owner-required')
  return { ...core, projectionDigest: `artifact-anchor-projection-${digest(core)}`, validation: { valid: errors.length === 0, errors } }
}

function createLinkCapabilityDecision(input) {
  const errors = []
  if (!text(input?.surface)) errors.push('surface-required')
  if (!EVIDENCE_STATES.has(input?.evidenceState)) errors.push('evidenceState-invalid')
  if (!['workspace', 'external', 'ambiguous'].includes(input?.targetRelation)) errors.push('targetRelation-invalid')
  const evidenceRefs = Array.isArray(input?.evidenceRefs) ? input.evidenceRefs.slice().sort() : []
  if (!textList(evidenceRefs)) errors.push('evidenceRefs-invalid')
  if (input?.evidenceState === 'verified' && evidenceRefs.length === 0) errors.push('verified-evidenceRefs-required')
  let mode = 'plain'
  let fallbackReason = 'none'
  if (input?.linkFailed || input?.cannotLocate) {
    mode = 'failed'
    fallbackReason = input?.linkFailed ? 'link-failed' : 'cannot-locate'
  } else if (input?.evidenceState === 'verified' && input?.supportsClickable === true) {
    mode = 'clickable'
  } else if (input?.supportsMarkdown !== false) {
    mode = 'portable'
    fallbackReason = input?.evidenceState === 'verified' ? 'clickability-not-verified' : 'capability-unverified'
  }
  if (input?.userRequestedAbsolute) fallbackReason = 'user-requested'
  else if (input?.targetRelation === 'external') fallbackReason = 'workspace-external'
  else if (input?.targetRelation === 'ambiguous') fallbackReason = 'path-ambiguous'
  const absolutePathFallback = Boolean(input?.userRequestedAbsolute || input?.linkFailed || input?.cannotLocate ||
    ['external', 'ambiguous'].includes(input?.targetRelation))
  const core = {
    schemaVersion: 'LinkCapabilityDecisionV1',
    surface: input?.surface || '',
    evidenceState: input?.evidenceState || 'failed',
    mode,
    workspaceRoot: input?.workspaceRoot || null,
    targetRelation: input?.targetRelation || 'ambiguous',
    absolutePathFallback,
    fallbackReason,
    evidenceRefs
  }
  if (!LINK_MODES.has(mode)) errors.push('mode-invalid')
  return { ...core, decisionId: `link-capability-${digest(core)}`, validation: { valid: errors.length === 0, errors } }
}

const PRESENTATION_LINK_RENDERERS = Object.freeze({
  'codex-desktop-panel': Object.freeze({
    hostSurfaces: Object.freeze(['codex-desktop', 'codex-app']),
    rendererId: 'codex-native-file-link',
    openMode: 'markdown-link'
  }),
  'vscode-terminal': Object.freeze({
    hostSurfaces: Object.freeze(['vscode-codex', 'vscode']),
    rendererId: 'vscode-cli-goto',
    openMode: 'terminal-command'
  }),
  'zed-terminal': Object.freeze({
    hostSurfaces: Object.freeze(['zed']),
    rendererId: 'zed-cli-open',
    openMode: 'terminal-command'
  }),
  'jetbrains-terminal': Object.freeze({
    hostSurfaces: Object.freeze(['webstorm', 'jetbrains']),
    rendererId: 'webstorm-cli-open',
    openMode: 'terminal-command'
  }),
  'claude-terminal': Object.freeze({
    hostSurfaces: Object.freeze(['claude', 'claude-code']),
    rendererId: 'absolute-path-copy',
    openMode: 'absolute-copy'
  }),
  terminal: Object.freeze({
    hostSurfaces: Object.freeze(['codex-cli', 'gemini', 'grok', 'copilot']),
    rendererId: 'absolute-path-copy',
    openMode: 'absolute-copy'
  })
})

function resolvePresentationRenderer(hostSurface, presentationSurface) {
  const host = String(hostSurface || '').toLowerCase()
  const surface = String(presentationSurface || '').toLowerCase()
  const renderer = PRESENTATION_LINK_RENDERERS[surface]
  if (!renderer) {
    return { rendererId: 'absolute-path-copy', openMode: 'absolute-copy', fallbackReason: 'presentation-surface-unsupported' }
  }
  if (!renderer.hostSurfaces.includes(host)) {
    return { rendererId: 'absolute-path-copy', openMode: 'absolute-copy', fallbackReason: 'presentation-host-mismatch' }
  }
  return { rendererId: renderer.rendererId, openMode: renderer.openMode, fallbackReason: 'none' }
}

function createHostLinkCapabilityDecisionV2(input) {
  const errors = []
  const hostSurface = input?.hostSurface || ''
  const presentationSurface = input?.presentationSurface || ''
  if (!text(hostSurface)) errors.push('hostSurface-required')
  if (!text(presentationSurface)) errors.push('presentationSurface-required')
  if (!EVIDENCE_STATES.has(input?.evidenceState)) errors.push('evidenceState-invalid')
  if (!['workspace', 'external', 'ambiguous'].includes(input?.targetRelation)) errors.push('targetRelation-invalid')
  const evidenceRefs = Array.isArray(input?.evidenceRefs) ? input.evidenceRefs.slice().sort() : []
  if (!textList(evidenceRefs)) errors.push('evidenceRefs-invalid')
  if (input?.evidenceState === 'verified' && evidenceRefs.length === 0) errors.push('verified-evidenceRefs-required')

  const renderer = resolvePresentationRenderer(hostSurface, presentationSurface)
  let rendererId = renderer.rendererId
  let openMode = renderer.openMode
  let fallbackReason = renderer.fallbackReason
  if (input?.linkFailed || input?.cannotLocate || input?.evidenceState === 'failed') {
    rendererId = 'unavailable-renderer'
    openMode = 'unavailable'
    fallbackReason = input?.cannotLocate ? 'cannot-locate' : 'link-failed'
  } else if (input?.evidenceState !== 'verified') {
    rendererId = 'absolute-path-copy'
    openMode = 'absolute-copy'
    fallbackReason = 'renderer-unverified'
  } else if (fallbackReason === 'none' && input?.supportsNativeAction === true && text(input?.nativeRendererId)) {
    rendererId = input.nativeRendererId
    openMode = 'native-action'
  } else if (fallbackReason === 'none' && input?.supportsMarkdownLink === true) {
    rendererId = 'markdown-local-file'
    openMode = 'markdown-link'
  }
  if (input?.userRequestedAbsolute) {
    rendererId = 'absolute-path-copy'
    openMode = 'absolute-copy'
    fallbackReason = 'user-requested'
  } else if (input?.targetRelation === 'external') {
    rendererId = 'absolute-path-copy'
    openMode = 'absolute-copy'
    fallbackReason = 'workspace-external'
  } else if (input?.targetRelation === 'ambiguous') {
    rendererId = 'absolute-path-copy'
    openMode = 'absolute-copy'
    fallbackReason = 'path-ambiguous'
  }
  const mode = openMode === 'markdown-link'
    ? 'clickable'
    : (openMode === 'unavailable' ? 'failed' : (openMode === 'absolute-copy' ? 'plain' : 'portable'))
  const absolutePathFallback = ['absolute-copy', 'unavailable'].includes(openMode)
  const core = {
    schemaVersion: 'HostLinkCapabilityDecisionV2',
    hostSurface,
    presentationSurface,
    rendererId,
    evidenceState: input?.evidenceState || 'failed',
    mode,
    openMode,
    workspaceRoot: input?.workspaceRoot || null,
    targetRelation: input?.targetRelation || 'ambiguous',
    absolutePathFallback,
    fallbackReason,
    evidenceRefs
  }
  if (!LINK_MODES.has(mode)) errors.push('mode-invalid')
  if (!HOST_LINK_OPEN_MODES.has(openMode)) errors.push('openMode-invalid')
  return { ...core, decisionId: `host-link-capability-${digest(core)}`, validation: { valid: errors.length === 0, errors } }
}

function createArtifactDeliveryAttemptV1(input) {
  const errors = []
  const artifactId = input?.artifactId || ''
  const rendererId = input?.rendererId || ''
  const openMode = input?.openMode || 'unavailable'
  const target = input?.target || ''
  const attempted = input?.attempted === true
  const actionStatus = input?.actionStatus || (attempted ? 'failed' : 'not-attempted')
  const readback = input?.readback || (attempted ? 'unavailable' : 'not-attempted')
  const evidenceState = input?.evidenceState || 'unverified'
  const evidenceRefs = Array.isArray(input?.evidenceRefs) ? input.evidenceRefs.slice().sort() : []
  let actionId = text(input?.actionId) ? input.actionId : null

  if (!text(artifactId)) errors.push('artifactId-required')
  if (!text(rendererId)) errors.push('rendererId-required')
  if (!HOST_LINK_OPEN_MODES.has(openMode)) errors.push('openMode-invalid')
  if (!text(target) || !path.isAbsolute(target)) errors.push('target-absolute-required')
  if (!ARTIFACT_DELIVERY_ACTION_STATUSES.has(actionStatus)) errors.push('actionStatus-invalid')
  if (!ARTIFACT_DELIVERY_READBACK_STATUSES.has(readback)) errors.push('readback-invalid')
  if (!EVIDENCE_STATES.has(evidenceState)) errors.push('evidenceState-invalid')
  if (!textList(evidenceRefs)) errors.push('evidenceRefs-invalid')
  if (!attempted && actionStatus !== 'not-attempted') errors.push('actionStatus-without-attempt')
  if (!attempted && !['not-attempted', 'unavailable'].includes(readback)) errors.push('readback-without-attempt')
  if (attempted && actionStatus === 'not-attempted') errors.push('attempted-actionStatus-conflict')
  if (['succeeded', 'failed'].includes(readback) && actionStatus !== 'succeeded') errors.push('readback-before-action-success')

  const opened = attempted && actionStatus === 'succeeded' && readback === 'succeeded'
  const readyWithoutExecution = evidenceState === 'verified' && (
    ['markdown-link', 'terminal-command', 'portable-path'].includes(openMode) ||
    (openMode === 'native-action' && text(actionId))
  )
  const status = opened ? 'opened' : (readyWithoutExecution && !attempted ? 'ready' : 'fallback')
  if (!ARTIFACT_DELIVERY_STATUSES.has(status)) errors.push('status-invalid')
  if (['ready', 'opened'].includes(status) && evidenceRefs.length === 0) errors.push('delivery-evidence-required')
  if (opened && evidenceState !== 'verified') errors.push('opened-evidence-unverified')
  if (['markdown-link', 'terminal-command', 'portable-path'].includes(openMode) && !actionId) actionId = rendererId

  let fallbackReason = 'none'
  if (status === 'fallback') {
    if (text(input?.fallbackReason) && input.fallbackReason !== 'none') fallbackReason = input.fallbackReason
    else if (attempted && actionStatus === 'failed') fallbackReason = 'action-failed'
    else if (attempted && readback === 'failed') fallbackReason = 'readback-failed'
    else if (attempted && readback === 'unavailable') fallbackReason = 'readback-unavailable'
    else if (openMode === 'native-action' && !actionId) fallbackReason = 'native-action-not-attached'
    else if (['absolute-copy', 'unavailable'].includes(openMode)) fallbackReason = 'absolute-path-fallback'
    else fallbackReason = 'action-not-attempted'
  }

  const core = {
    schemaVersion: 'ArtifactDeliveryAttemptV1',
    artifactId,
    rendererId,
    openMode,
    actionId,
    target,
    attempted,
    actionStatus,
    readback,
    status,
    fallbackReason,
    evidenceState,
    evidenceRefs
  }
  return {
    ...core,
    attemptId: `artifact-delivery-attempt-${digest(core)}`,
    validation: { valid: errors.length === 0, errors }
  }
}

function artifactDeliveryAttemptIntegrityErrors(attempt) {
  if (!attempt || attempt.schemaVersion !== 'ArtifactDeliveryAttemptV1') return ['artifactDeliveryAttempt-shape-invalid']
  const errors = []
  if (!hasExactKeys(attempt, [
    'schemaVersion', 'artifactId', 'rendererId', 'openMode', 'actionId', 'target', 'attempted', 'actionStatus',
    'readback', 'status', 'fallbackReason', 'evidenceState', 'evidenceRefs', 'attemptId', 'validation'
  ])) errors.push('artifactDeliveryAttempt-sibling-fields-invalid')
  const expected = createArtifactDeliveryAttemptV1(attempt)
  if (!attempt.validation?.valid || !hasExactKeys(attempt.validation, ['valid', 'errors']) || attempt.validation.errors?.length) {
    errors.push('artifactDeliveryAttempt-invalid')
  }
  if (!expected.validation.valid) errors.push(...expected.validation.errors.map(error => `artifactDeliveryAttempt.${error}`))
  if (attempt.attemptId !== expected.attemptId || digest(attempt) !== digest(expected)) {
    errors.push('artifactDeliveryAttempt-integrity-mismatch')
  }
  return errors
}

function resolveArtifactDelivery(input) {
  const linkCapability = input?.linkCapability || createHostLinkCapabilityDecisionV2(input)
  const targetReadback = input?.targetReadback || 'present'
  const targetUnavailable = !['present', 'missing', 'unavailable'].includes(targetReadback)
  const targetEvidenceState = targetReadback === 'missing'
    ? 'failed'
    : (targetReadback === 'unavailable' || targetUnavailable ? 'unverified' : (linkCapability?.evidenceState || 'unverified'))
  const targetFallbackReason = targetReadback === 'missing'
    ? 'target-missing'
    : (targetReadback === 'unavailable' || targetUnavailable ? 'target-readback-unavailable' : null)
  const attempt = createArtifactDeliveryAttemptV1({
    artifactId: input?.artifactId,
    rendererId: linkCapability?.rendererId || (linkCapability?.mode === 'clickable' ? 'legacy-markdown-link' : 'absolute-path-copy'),
    openMode: linkCapability?.openMode || (linkCapability?.mode === 'clickable' ? 'markdown-link' : (linkCapability?.mode === 'portable' ? 'portable-path' : 'absolute-copy')),
    actionId: input?.actionId,
    target: input?.target,
    attempted: input?.attempted,
    actionStatus: input?.actionStatus,
    readback: input?.readback,
    evidenceState: targetEvidenceState,
    evidenceRefs: [...new Set([...(linkCapability?.evidenceRefs || []), ...(input?.attemptEvidenceRefs || [])])],
    fallbackReason: targetFallbackReason || (linkCapability?.absolutePathFallback ? linkCapability.fallbackReason : input?.fallbackReason)
  })
  const errors = [
    ...(linkCapability?.validation?.valid ? [] : ['linkCapability-invalid']),
    ...artifactDeliveryAttemptIntegrityErrors(attempt)
  ]
  const core = {
    schemaVersion: 'ArtifactDeliveryResolutionV1',
    linkCapability,
    attempt
  }
  return {
    ...core,
    resolutionId: `artifact-delivery-resolution-${digest(core)}`,
    validation: { valid: errors.length === 0, errors: [...new Set(errors)] }
  }
}

function deriveArtifactDeliveryAttempts(visibleSet, linkCapability, suppliedAttempts) {
  const items = visibleSet?.items || []
  if (!items.length) {
    return {
      attempts: [],
      errors: Array.isArray(suppliedAttempts) && suppliedAttempts.length ? ['artifactDeliveryAttempts-without-visible-items'] : []
    }
  }
  const attempts = Array.isArray(suppliedAttempts)
    ? suppliedAttempts
    : items.map(item => resolveArtifactDelivery({
        linkCapability,
        artifactId: item.artifactId,
        target: item.canonicalPath
      }).attempt)
  const errors = []
  if (!Array.isArray(attempts) || attempts.length !== items.length) {
    errors.push('artifactDeliveryAttempts-count-mismatch')
    return { attempts: Array.isArray(attempts) ? attempts : [], errors }
  }
  const attemptIds = new Set()
  for (let index = 0; index < attempts.length; index++) {
    const attempt = attempts[index]
    const item = items[index]
    errors.push(...artifactDeliveryAttemptIntegrityErrors(attempt).map(error => `${error}:${index}`))
    if (attempt?.artifactId !== item?.artifactId || canonicalPathIdentity(attempt?.target) !== canonicalPathIdentity(item?.canonicalPath)) {
      errors.push(`artifactDeliveryAttempt-target-mismatch:${index}`)
    }
    if (attemptIds.has(attempt?.attemptId)) errors.push(`artifactDeliveryAttempt-duplicate:${index}`)
    attemptIds.add(attempt?.attemptId)
    if (linkCapability?.schemaVersion === 'HostLinkCapabilityDecisionV2' && attempt?.rendererId !== linkCapability.rendererId) {
      errors.push(`artifactDeliveryAttempt-renderer-mismatch:${index}`)
    }
  }
  return { attempts, errors }
}

function semanticArtifactDeliveryAttempts(attempts, linkCapability) {
  if (linkCapability?.schemaVersion !== 'HostLinkCapabilityDecisionV2') return []
  return (attempts || []).map(attempt => ({
    schemaVersion: attempt.schemaVersion,
    artifactId: attempt.artifactId,
    rendererId: attempt.rendererId,
    openMode: attempt.openMode,
    actionId: attempt.actionId,
    target: attempt.target,
    attempted: attempt.attempted,
    actionStatus: attempt.actionStatus,
    readback: attempt.readback,
    status: attempt.status,
    fallbackReason: attempt.fallbackReason,
    evidenceState: attempt.evidenceState,
    evidenceRefs: attempt.evidenceRefs,
    attemptId: attempt.attemptId
  }))
}

function artifactManifestIntegrityErrors(manifest) {
  if (!manifest || manifest.schemaVersion !== 'ArtifactDeliveryManifestV1' || !Array.isArray(manifest.entries)) {
    return ['artifactManifest-shape-invalid']
  }
  const ids = manifest.entries.map(entry => entry?.artifactId)
  const expected = createArtifactDeliveryManifest({
    taskId: manifest.taskId,
    candidateIdentity: manifest.candidateIdentity,
    generatedAt: manifest.generatedAt,
    entries: manifest.entries,
    plannedArtifactIds: ids,
    observedArtifactIds: ids,
    internalDeliveredArtifactIds: ids
  })
  const errors = []
  if (!hasExactKeys(manifest, [
    'schemaVersion', 'taskId', 'candidateIdentity', 'generatedAt', 'entries', 'reconciliation', 'manifestId', 'validation'
  ])) errors.push('artifactManifest-sibling-fields-invalid')
  const entryKeys = [
    'artifactId', 'canonicalPath', 'previousPath', 'lifecycleOperation', 'origin', 'ownership', 'artifactClass',
    'deliveryRequirement', 'visibility', 'displayName', 'purposeKey', 'purposeText', 'userAction', 'readingOrder',
    'contentDigest', 'evidenceRefs'
  ]
  if (manifest.entries.some(entry => !hasExactKeys(entry, entryKeys))) errors.push('artifactManifest-entry-sibling-fields-invalid')
  if (!manifest.validation?.valid || manifest.reconciliation?.status !== 'verified') errors.push('artifactManifest-invalid')
  if (!expected.validation.valid) errors.push(...expected.validation.errors.map(error => `artifactManifest.${error}`))
  if (manifest.manifestId !== expected.manifestId) errors.push('artifactManifest-integrity-mismatch')
  if (digest(manifest.reconciliation) !== digest(expected.reconciliation)) errors.push('artifactManifest-reconciliation-mismatch')
  return errors
}

function userFacingSetIntegrityErrors(set, manifest, messageKind) {
  if (!set || set.schemaVersion !== 'UserFacingArtifactSetV1') return ['userFacingArtifactSet-shape-invalid']
  const errors = []
  if (!set.validation?.valid || set.reconciliation?.status !== 'verified') errors.push('userFacingArtifactSet-invalid')
  if (set.manifestId !== manifest?.manifestId) errors.push('artifact-set-manifest-mismatch')
  const expected = projectUserFacingArtifactSet(manifest, { scope: set.scope, messageKind })
  if (!expected.validation.valid) errors.push(...expected.validation.errors.map(error => `userFacingArtifactSet.${error}`))
  if (set.setId !== expected.setId || digest(set) !== digest(expected)) errors.push('userFacingArtifactSet-integrity-mismatch')
  if (set.heading !== ACTION_HEADINGS[messageKind]) errors.push('userFacingArtifactSet-heading-mismatch')
  if (set.counts?.listed !== set.items?.length || set.counts?.listed + set.counts?.remaining !== set.counts?.total) {
    errors.push('userFacingArtifactSet-count-mismatch')
  }
  if (set.counts?.total !== manifest?.entries?.length || set.reconciliation?.countConserved !== true ||
      (set.reconciliation?.requiredHidden || []).length !== 0) errors.push('userFacingArtifactSet-reconciliation-mismatch')
  return errors
}

function linkCapabilityIntegrityErrors(capability) {
  if (capability?.schemaVersion === 'HostLinkCapabilityDecisionV2') {
    const errors = []
    if (!hasExactKeys(capability, [
      'schemaVersion', 'hostSurface', 'presentationSurface', 'rendererId', 'evidenceState', 'mode', 'openMode',
      'workspaceRoot', 'targetRelation', 'absolutePathFallback', 'fallbackReason', 'evidenceRefs', 'decisionId', 'validation'
    ])) errors.push('linkCapability-sibling-fields-invalid')
    if (!capability.validation?.valid || !hasExactKeys(capability.validation, ['valid', 'errors']) ||
        capability.validation.errors?.length !== 0) errors.push('linkCapability-invalid')
    if (!text(capability.hostSurface) || !text(capability.presentationSurface) || !text(capability.rendererId) ||
        !EVIDENCE_STATES.has(capability.evidenceState) || !LINK_MODES.has(capability.mode) ||
        !HOST_LINK_OPEN_MODES.has(capability.openMode) ||
        !['workspace', 'external', 'ambiguous'].includes(capability.targetRelation) ||
        typeof capability.absolutePathFallback !== 'boolean' || !text(capability.fallbackReason) ||
        !textList(capability.evidenceRefs)) errors.push('linkCapability-fields-invalid')
    if (capability.evidenceState === 'verified' && capability.evidenceRefs?.length === 0) {
      errors.push('linkCapability-verified-evidence-missing')
    }
    if (['native-action', 'markdown-link', 'terminal-command'].includes(capability.openMode) &&
        capability.evidenceState !== 'verified') errors.push('linkCapability-renderer-unverified')
    if (capability.absolutePathFallback !== ['absolute-copy', 'unavailable'].includes(capability.openMode)) {
      errors.push('linkCapability-fallback-conflict')
    }
    const core = {
      schemaVersion: capability.schemaVersion,
      hostSurface: capability.hostSurface,
      presentationSurface: capability.presentationSurface,
      rendererId: capability.rendererId,
      evidenceState: capability.evidenceState,
      mode: capability.mode,
      openMode: capability.openMode,
      workspaceRoot: capability.workspaceRoot ?? null,
      targetRelation: capability.targetRelation,
      absolutePathFallback: capability.absolutePathFallback,
      fallbackReason: capability.fallbackReason,
      evidenceRefs: capability.evidenceRefs
    }
    if (capability.decisionId !== `host-link-capability-${digest(core)}`) errors.push('linkCapability-integrity-mismatch')
    return errors
  }
  if (!capability || capability.schemaVersion !== 'LinkCapabilityDecisionV1') return ['linkCapability-shape-invalid']
  const errors = []
  if (!hasExactKeys(capability, [
    'schemaVersion', 'surface', 'evidenceState', 'mode', 'workspaceRoot', 'targetRelation',
    'absolutePathFallback', 'fallbackReason', 'evidenceRefs', 'decisionId', 'validation'
  ])) errors.push('linkCapability-sibling-fields-invalid')
  if (!capability.validation?.valid) errors.push('linkCapability-invalid')
  if (!hasExactKeys(capability.validation, ['valid', 'errors']) || capability.validation.errors?.length !== 0) {
    errors.push('linkCapability-validation-shape-invalid')
  }
  if (!text(capability.surface) || !EVIDENCE_STATES.has(capability.evidenceState) || !LINK_MODES.has(capability.mode) ||
      !['workspace', 'external', 'ambiguous'].includes(capability.targetRelation) ||
      typeof capability.absolutePathFallback !== 'boolean' || !text(capability.fallbackReason) ||
      !textList(capability.evidenceRefs)) errors.push('linkCapability-fields-invalid')
  if (capability.evidenceState === 'verified' && capability.evidenceRefs?.length === 0) {
    errors.push('linkCapability-verified-evidence-missing')
  }
  if (capability.mode === 'clickable' && capability.evidenceState !== 'verified') errors.push('linkCapability-clickable-unverified')
  if (capability.mode === 'failed' && !capability.absolutePathFallback) errors.push('linkCapability-failed-without-fallback')
  if (capability.absolutePathFallback && capability.fallbackReason === 'none') errors.push('linkCapability-fallback-reason-missing')
  if (!capability.absolutePathFallback && ['link-failed', 'cannot-locate', 'user-requested', 'workspace-external', 'path-ambiguous'].includes(capability.fallbackReason)) {
    errors.push('linkCapability-fallback-reason-conflict')
  }
  const core = {
    schemaVersion: capability.schemaVersion,
    surface: capability.surface,
    evidenceState: capability.evidenceState,
    mode: capability.mode,
    workspaceRoot: capability.workspaceRoot ?? null,
    targetRelation: capability.targetRelation,
    absolutePathFallback: capability.absolutePathFallback,
    fallbackReason: capability.fallbackReason,
    evidenceRefs: capability.evidenceRefs
  }
  if (capability.decisionId !== `link-capability-${digest(core)}`) errors.push('linkCapability-integrity-mismatch')
  return errors
}

function validateLinkCapabilityDecision(capability) {
  const errors = linkCapabilityIntegrityErrors(capability)
  return { valid: errors.length === 0, errors }
}

function linkCapabilityHostSurface(capability) {
  return capability?.schemaVersion === 'HostLinkCapabilityDecisionV2'
    ? capability.hostSurface
    : capability?.surface
}

function deriveStatus(checks) {
  if (!checks.length) return 'N/A'
  return checks.slice().sort((left, right) => STATUS_SEVERITY.get(right.status) - STATUS_SEVERITY.get(left.status))[0].status
}

function normalizePostCompletionAction(action, expectedApplicability, pathName, errors) {
  const normalized = {
    kind: action?.kind,
    label: action?.label,
    reason: action?.reason,
    evidenceRefs: action?.evidenceRefs,
    applicability: action?.applicability,
    authorization: action?.authorization
  }
  if (!hasExactKeys(action, Object.keys(normalized))) errors.push(`${pathName}-fields-invalid`)
  if (!POST_COMPLETION_ACTION_KINDS.has(normalized.kind)) errors.push(`${pathName}.kind-invalid`)
  if (!text(normalized.label)) errors.push(`${pathName}.label-required`)
  if (!text(normalized.reason)) errors.push(`${pathName}.reason-required`)
  if (!textList(normalized.evidenceRefs) || normalized.evidenceRefs.length === 0) {
    errors.push(`${pathName}.evidenceRefs-required`)
  }
  if (hasDuplicates(normalized.evidenceRefs)) errors.push(`${pathName}.evidenceRefs-duplicate`)
  if (!POST_COMPLETION_APPLICABILITIES.has(normalized.applicability) ||
      normalized.applicability !== expectedApplicability) {
    errors.push(`${pathName}.applicability-invalid`)
  }
  if (!POST_COMPLETION_AUTHORIZATIONS.has(normalized.authorization)) {
    errors.push(`${pathName}.authorization-invalid`)
  }
  if (['commit', 'switch-target', 'cherry-pick', 'push'].includes(normalized.kind) &&
      normalized.authorization !== 'explicit-required') {
    errors.push(`${pathName}.git-authorization-must-be-explicit`)
  }
  if (expectedApplicability !== 'required-now' &&
      !['commit', 'switch-target', 'cherry-pick', 'push'].includes(normalized.kind) &&
      normalized.authorization !== 'suggest-only') {
    errors.push(`${pathName}.optional-action-must-be-suggest-only`)
  }
  return normalized
}

function createPostCompletionActionSet(input = {}) {
  const errors = []
  const source = input?.schemaVersion === 'PostCompletionActionSetV1'
    ? {
        requiredNow: input.requiredNow,
        primaryAction: input.primaryAction,
        conditionalActions: input.conditionalActions
      }
    : input
  const requiredNowInput = source?.requiredNow ?? []
  const conditionalInput = source?.conditionalActions ?? []
  if (!Array.isArray(requiredNowInput)) errors.push('requiredNow-invalid')
  if (!Array.isArray(conditionalInput)) errors.push('conditionalActions-invalid')
  if (Array.isArray(conditionalInput) && conditionalInput.length > 2) errors.push('conditionalActions-max-two')
  const requiredNow = Array.isArray(requiredNowInput)
    ? requiredNowInput.map((action, index) => normalizePostCompletionAction(action, 'required-now', `requiredNow.${index}`, errors))
    : []
  const primaryAction = source?.primaryAction === null || source?.primaryAction === undefined
    ? null
    : normalizePostCompletionAction(source.primaryAction, 'applicable', 'primaryAction', errors)
  const conditionalActions = Array.isArray(conditionalInput)
    ? conditionalInput.map((action, index) => normalizePostCompletionAction(action, 'conditional', `conditionalActions.${index}`, errors))
    : []
  const identities = [...requiredNow, ...(primaryAction ? [primaryAction] : []), ...conditionalActions]
    .map(action => `${action.kind}\u0000${action.label}`)
  if (hasDuplicates(identities)) errors.push('postCompletionActions-duplicate')
  const knownKinds = [...requiredNow, ...(primaryAction ? [primaryAction] : []), ...conditionalActions]
    .map(action => action.kind)
    .filter(kind => kind !== 'other')
  if (hasDuplicates(knownKinds)) errors.push('postCompletionActions-kind-duplicate')
  return {
    schemaVersion: 'PostCompletionActionSetV1',
    requiredNow,
    primaryAction,
    conditionalActions,
    validation: { valid: errors.length === 0, errors }
  }
}

function invalidLegacyEnvelopeV1(errors, input = {}) {
  const core = {
    schemaVersion: 'DevCodexVisibleEnvelopeV1',
    messageKind: 'error-block',
    status: 'BLOCK',
    context: input.context || null,
    checks: [{
      id: 'VISIBLE_ENVELOPE_INVALID', ordinal: 0, status: 'BLOCK',
      summaryKey: 'visible-envelope-invalid', summary: '可见输出契约无效', evidenceState: 'verified',
      evidenceRefs: [], requiredAction: '回退到 expanded portable 输出并修正契约'
    }],
    decision: null,
    recommendedAction: '修正可见输出契约后使用 expanded portable 输出',
    artifactManifest: null,
    userFacingArtifactSet: null,
    artifactLinks: [],
    linkCapability: null,
    presentation: { requestedTier: 'portable-markdown', effectiveTier: 'portable-markdown', degradationReason: 'contract-invalid' },
    validation: { valid: false, errors }
  }
  return { ...core, semanticDigest: digest({ ...core, presentation: undefined, validation: undefined }) }
}

function createLegacyVisibleEnvelopeV1(input, options = {}) {
  const errors = []
  if (!MESSAGE_KINDS.has(input?.messageKind)) errors.push('messageKind-invalid')
  if (!input?.context || typeof input.context !== 'object' || Array.isArray(input.context)) errors.push('context-required')
  for (const field of ['project', 'taskId', 'mode', 'intentRoute', 'phase', 'contextEpoch']) {
    if (!text(input?.context?.[field])) errors.push(`context.${field}-required`)
  }
  if (!Object.prototype.hasOwnProperty.call(input?.context || {}, 'hostSurface') ||
      !(input?.context?.hostSurface === null || text(input?.context?.hostSurface))) errors.push('context.hostSurface-required')
  if (!Array.isArray(input?.checks)) errors.push('checks-invalid')
  const checks = Array.isArray(input?.checks) ? input.checks.map(check => ({
    id: check?.id,
    ordinal: check?.ordinal,
    status: check?.status,
    summaryKey: check?.summaryKey,
    summary: check?.summary,
    evidenceState: check?.evidenceState,
    evidenceRefs: check?.evidenceRefs,
    requiredAction: check?.requiredAction ?? null
  })) : []
  const ids = new Set()
  const ordinals = new Set()
  for (const check of checks) {
    if (!text(check.id) || ids.has(check.id)) errors.push('check.id-invalid-or-duplicate')
    if (!Number.isInteger(check.ordinal) || ordinals.has(check.ordinal)) errors.push('check.ordinal-invalid-or-duplicate')
    if (!STATUSES.has(check.status)) errors.push(`check.${check.id || 'unknown'}.status-invalid`)
    if (!text(check.summaryKey) || !text(check.summary) || !EVIDENCE_STATES.has(check.evidenceState) || !textList(check.evidenceRefs)) {
      errors.push(`check.${check.id || 'unknown'}.fields-invalid`)
    }
    if (check.status === 'PASS' && check.evidenceState !== 'verified') errors.push(`check.${check.id || 'unknown'}.pass-evidence-unverified`)
    ids.add(check.id)
    ordinals.add(check.ordinal)
  }
  if (input?.messageKind === 'entry-check') {
    const lastOrdinal = options.entryCheckLastOrdinal === 10 ? 10 : 7
    const expected = Array.from({ length: lastOrdinal + 1 }, (_, index) => `PC${index}`)
    if (checks.length !== expected.length || expected.some((id, index) => checks[index]?.id !== id || checks[index]?.ordinal !== index)) {
      errors.push(`entry-check-PC0-PC${lastOrdinal}-required-in-order`)
    }
  }
  checks.sort((left, right) => left.ordinal - right.ordinal || String(left.id).localeCompare(String(right.id)))
  if (input?.messageKind === 'confirmation') {
    const decision = input?.decision
    if (!decision || typeof decision !== 'object' || Array.isArray(decision)) errors.push('confirmation-decision-required')
    else {
      for (const field of ['id', 'kind', 'question', 'recommendedOption']) {
        if (!text(decision[field])) errors.push(`confirmation.${field}-required`)
      }
      if (!textList(decision.options) || decision.options.length < 2 || !decision.options.includes(decision.recommendedOption)) {
        errors.push('confirmation.options-invalid')
      }
      if (decision.fallbackText !== undefined && !text(decision.fallbackText)) errors.push('confirmation.fallbackText-invalid')
    }
  }
  const hasManifest = Boolean(input?.artifactManifest)
  const hasVisibleSet = Boolean(input?.userFacingArtifactSet)
  if (hasManifest !== hasVisibleSet) errors.push('artifact-manifest-visible-set-pair-required')
  if (hasManifest) errors.push(...artifactManifestIntegrityErrors(input.artifactManifest))
  if (hasManifest && input.artifactManifest.taskId !== input?.context?.taskId) errors.push('artifactManifest-task-mismatch')
  if (hasVisibleSet) errors.push(...userFacingSetIntegrityErrors(input.userFacingArtifactSet, input.artifactManifest, input.messageKind))
  const visibleItemCount = input?.userFacingArtifactSet?.items?.length || 0
  if (visibleItemCount > 0 && !input?.linkCapability) errors.push('linkCapability-required-for-visible-items')
  if (!hasVisibleSet && input?.linkCapability) errors.push('linkCapability-without-visible-set')
  if (input?.linkCapability) {
    errors.push(...linkCapabilityIntegrityErrors(input.linkCapability))
    if (text(input?.context?.hostSurface) && linkCapabilityHostSurface(input.linkCapability) !== input.context.hostSurface) {
      errors.push('linkCapability-surface-mismatch')
    }
    if (input?.context?.hostSurface === null && input.linkCapability.evidenceState === 'verified') {
      errors.push('linkCapability-verified-with-unknown-surface')
    }
  }
  const presentation = input?.presentation || {
    requestedTier: 'portable-markdown', effectiveTier: 'portable-markdown', degradationReason: null
  }
  if (!presentation || typeof presentation !== 'object' || Array.isArray(presentation) ||
      !PRESENTATION_TIERS.has(presentation.requestedTier) || !PRESENTATION_TIERS.has(presentation.effectiveTier) ||
      !(presentation.degradationReason === null || text(presentation.degradationReason))) {
    errors.push('presentation-invalid')
  }
  if (errors.length) return invalidLegacyEnvelopeV1(errors, input)

  const status = deriveStatus(checks)
  const artifactLinks = (input?.userFacingArtifactSet?.items || []).map(item => ({
    artifactId: item.artifactId,
    displayName: item.displayName,
    canonicalPath: item.canonicalPath,
    capabilityDecisionId: input?.linkCapability?.decisionId || null
  }))
  const semanticCore = {
    schemaVersion: 'DevCodexVisibleEnvelopeV1',
    messageKind: input.messageKind,
    status,
    context: input.context,
    checks: checks.map(({ summary, ...check }) => check),
    decision: input.decision || null,
    artifactManifest: input.artifactManifest ? {
      manifestId: input.artifactManifest.manifestId,
      reconciliationStatus: input.artifactManifest.reconciliation.status,
      entryCount: input.artifactManifest.entries.length
    } : null,
    userFacingArtifactSet: input.userFacingArtifactSet ? {
      setId: input.userFacingArtifactSet.setId,
      manifestId: input.userFacingArtifactSet.manifestId,
      scope: input.userFacingArtifactSet.scope,
      heading: input.userFacingArtifactSet.heading,
      items: input.userFacingArtifactSet.items,
      counts: input.userFacingArtifactSet.counts
    } : null,
    requiredAction: input.recommendedAction || null
  }
  return {
    schemaVersion: 'DevCodexVisibleEnvelopeV1',
    messageKind: input.messageKind,
    status,
    context: input.context,
    checks,
    decision: input.decision || null,
    recommendedAction: input.recommendedAction || null,
    artifactManifest: semanticCore.artifactManifest,
    userFacingArtifactSet: input.userFacingArtifactSet || null,
    artifactLinks,
    linkCapability: input.linkCapability || null,
    presentation,
    semanticDigest: digest(semanticCore),
    validation: { valid: true, errors: [] }
  }
}

function invalidEnvelopeV2(errors, input = {}) {
  const postCompletionActions = createPostCompletionActionSet({
    requiredNow: [{
      kind: 'other',
      label: '修正可见输出契约',
      reason: '当前 envelope 未通过确定性校验，不能继续作强完成声明',
      evidenceRefs: ['VISIBLE_ENVELOPE_INVALID'],
      applicability: 'required-now',
      authorization: 'not-required'
    }],
    primaryAction: null,
    conditionalActions: []
  })
  const core = {
    schemaVersion: 'DevCodexVisibleEnvelopeV2',
    messageKind: 'error-block',
    status: 'BLOCK',
    context: input.context || null,
    checks: [{
      id: 'VISIBLE_ENVELOPE_INVALID', ordinal: 0, status: 'BLOCK',
      summaryKey: 'visible-envelope-invalid', summary: '可见输出契约无效', evidenceState: 'verified',
      evidenceRefs: [], requiredAction: '回退到 expanded portable 输出并修正契约'
    }],
    decision: null,
    postCompletionActions,
    artifactManifest: null,
    userFacingArtifactSet: null,
    artifactLinks: [],
    linkCapability: null,
    presentation: { requestedTier: 'portable-markdown', effectiveTier: 'portable-markdown', degradationReason: 'contract-invalid' },
    validation: { valid: false, errors }
  }
  return { ...core, semanticDigest: digest({ ...core, presentation: undefined, validation: undefined }) }
}

function createVisibleEnvelopeV2(input) {
  const errors = []
  if (Object.prototype.hasOwnProperty.call(input || {}, 'recommendedAction')) {
    errors.push('recommendedAction-v1-write-forbidden')
  }
  const postCompletionActions = createPostCompletionActionSet(input?.postCompletionActions || {})
  errors.push(...postCompletionActions.validation.errors.map(error => `postCompletionActions.${error}`))
  if (['completion-check', 'final-result'].includes(input?.messageKind) && postCompletionActions.requiredNow.length > 0) {
    errors.push('completion-claim-requiredNow-must-be-empty')
  }
  const legacy = createLegacyVisibleEnvelopeV1({ ...input, recommendedAction: null })
  if (!legacy.validation.valid) errors.push(...legacy.validation.errors)
  if (errors.length) return invalidEnvelopeV2([...new Set(errors)], input)

  const semanticCore = {
    schemaVersion: 'DevCodexVisibleEnvelopeV2',
    messageKind: legacy.messageKind,
    status: legacy.status,
    context: legacy.context,
    checks: legacy.checks.map(({ summary, ...check }) => check),
    decision: legacy.decision,
    artifactManifest: legacy.artifactManifest,
    userFacingArtifactSet: legacy.userFacingArtifactSet ? {
      setId: legacy.userFacingArtifactSet.setId,
      manifestId: legacy.userFacingArtifactSet.manifestId,
      scope: legacy.userFacingArtifactSet.scope,
      heading: legacy.userFacingArtifactSet.heading,
      items: legacy.userFacingArtifactSet.items,
      counts: legacy.userFacingArtifactSet.counts
    } : null,
    linkCapability: semanticLinkCapability(legacy.linkCapability),
    postCompletionActions: {
      schemaVersion: postCompletionActions.schemaVersion,
      requiredNow: postCompletionActions.requiredNow,
      primaryAction: postCompletionActions.primaryAction,
      conditionalActions: postCompletionActions.conditionalActions
    }
  }
  return {
    schemaVersion: 'DevCodexVisibleEnvelopeV2',
    messageKind: legacy.messageKind,
    status: legacy.status,
    context: legacy.context,
    checks: legacy.checks,
    decision: legacy.decision,
    postCompletionActions,
    artifactManifest: legacy.artifactManifest,
    userFacingArtifactSet: legacy.userFacingArtifactSet,
    artifactLinks: legacy.artifactLinks,
    linkCapability: legacy.linkCapability,
    presentation: legacy.presentation,
    semanticDigest: digest(semanticCore),
    validation: { valid: true, errors: [] }
  }
}

function invalidEnvelope(errors, input = {}) {
  const postCompletionActions = createPostCompletionActionSet({
    requiredNow: [{
      kind: 'other',
      label: '修正可见输出契约',
      reason: '当前 envelope 未通过确定性校验，不能继续作强完成声明',
      evidenceRefs: ['VISIBLE_ENVELOPE_INVALID'],
      applicability: 'required-now',
      authorization: 'not-required'
    }],
    primaryAction: null,
    conditionalActions: []
  })
  const core = {
    schemaVersion: 'DevCodexVisibleEnvelopeV3',
    messageKind: 'error-block',
    status: 'BLOCK',
    context: input.context || null,
    checks: [{
      id: 'VISIBLE_ENVELOPE_INVALID', ordinal: 0, status: 'BLOCK',
      summaryKey: 'visible-envelope-invalid', summary: '可见输出契约无效', evidenceState: 'verified',
      evidenceRefs: [], requiredAction: '回退到 expanded portable 输出并修正契约'
    }],
    decision: null,
    postCompletionActions,
    entryCheckModel: null,
    artifactManifest: null,
    userFacingArtifactSet: null,
    artifactLinks: [],
    linkCapability: null,
    artifactDeliveryAttempts: [],
    presentation: { requestedTier: 'portable-markdown', effectiveTier: 'portable-markdown', degradationReason: 'contract-invalid' },
    validation: { valid: false, errors }
  }
  return { ...core, semanticDigest: digest({ ...core, presentation: undefined, validation: undefined }) }
}

function createVisibleEnvelope(input) {
  const errors = []
  if (Object.prototype.hasOwnProperty.call(input || {}, 'recommendedAction')) {
    errors.push('recommendedAction-v1-write-forbidden')
  }
  const postCompletionActions = createPostCompletionActionSet(input?.postCompletionActions || {})
  errors.push(...postCompletionActions.validation.errors.map(error => `postCompletionActions.${error}`))
  if (['completion-check', 'final-result'].includes(input?.messageKind) && postCompletionActions.requiredNow.length > 0) {
    errors.push('completion-claim-requiredNow-must-be-empty')
  }
  const legacy = createLegacyVisibleEnvelopeV1({ ...input, recommendedAction: null }, { entryCheckLastOrdinal: 10 })
  if (!legacy.validation.valid) errors.push(...legacy.validation.errors)
  const entryCheckModel = input?.messageKind === 'entry-check' ? input.entryCheckModel : null
  if (input?.messageKind === 'entry-check') errors.push(...entryCheckModelIntegrityErrors(entryCheckModel))
  const delivery = deriveArtifactDeliveryAttempts(
    legacy.userFacingArtifactSet,
    legacy.linkCapability,
    input?.artifactDeliveryAttempts
  )
  errors.push(...delivery.errors)
  if (errors.length) return invalidEnvelope([...new Set(errors)], input)

  const semanticCore = {
    schemaVersion: 'DevCodexVisibleEnvelopeV3',
    messageKind: legacy.messageKind,
    status: legacy.status,
    context: legacy.context,
    checks: legacy.checks.map(({ summary, ...check }) => check),
    decision: legacy.decision,
    entryCheckModel,
    artifactManifest: legacy.artifactManifest,
    userFacingArtifactSet: serializedVisibleSet(legacy.userFacingArtifactSet),
    linkCapability: semanticLinkCapability(legacy.linkCapability),
    artifactDeliveryAttempts: semanticArtifactDeliveryAttempts(delivery.attempts, legacy.linkCapability),
    postCompletionActions: {
      schemaVersion: postCompletionActions.schemaVersion,
      requiredNow: postCompletionActions.requiredNow,
      primaryAction: postCompletionActions.primaryAction,
      conditionalActions: postCompletionActions.conditionalActions
    }
  }
  return {
    schemaVersion: 'DevCodexVisibleEnvelopeV3',
    messageKind: legacy.messageKind,
    status: legacy.status,
    context: legacy.context,
    checks: legacy.checks,
    decision: legacy.decision,
    postCompletionActions,
    entryCheckModel,
    artifactManifest: legacy.artifactManifest,
    userFacingArtifactSet: legacy.userFacingArtifactSet,
    artifactLinks: legacy.artifactLinks,
    linkCapability: legacy.linkCapability,
    artifactDeliveryAttempts: delivery.attempts,
    presentation: legacy.presentation,
    semanticDigest: digest(semanticCore),
    validation: { valid: true, errors: [] }
  }
}

function serializedVisibleSet (value) {
  return value ? {
    setId: value.setId,
    manifestId: value.manifestId,
    scope: value.scope,
    heading: value.heading,
    items: value.items,
    counts: value.counts
  } : null
}

function semanticLinkCapability (value) {
  if (!value) return null
  if (value.schemaVersion === 'HostLinkCapabilityDecisionV2') {
    return {
      hostSurface: value.hostSurface,
      presentationSurface: value.presentationSurface,
      rendererId: value.rendererId,
      openMode: value.openMode,
      evidenceState: value.evidenceState,
      workspaceRoot: value.workspaceRoot ?? null,
      targetRelation: value.targetRelation,
      absolutePathFallback: value.absolutePathFallback,
      fallbackReason: value.absolutePathFallback ? value.fallbackReason : null,
      evidenceRefs: value.evidenceRefs
    }
  }
  return {
    surface: value.surface,
    evidenceState: value.evidenceState,
    workspaceRoot: value.workspaceRoot ?? null,
    targetRelation: value.targetRelation,
    absolutePathFallback: value.absolutePathFallback,
    fallbackReason: value.absolutePathFallback ? value.fallbackReason : null,
    evidenceRefs: value.evidenceRefs
  }
}

function validateSerializedEnvelopeBase (envelope, expectedKeys) {
  const errors = []
  if (!hasExactKeys(envelope, expectedKeys)) errors.push('envelope-fields-invalid')
  if (!MESSAGE_KINDS.has(envelope?.messageKind)) errors.push('messageKind-invalid')
  if (!envelope?.context || typeof envelope.context !== 'object' || Array.isArray(envelope.context)) {
    errors.push('context-required')
  }
  for (const field of ['project', 'taskId', 'mode', 'intentRoute', 'phase', 'contextEpoch']) {
    if (!text(envelope?.context?.[field])) errors.push(`context.${field}-required`)
  }
  if (!Object.prototype.hasOwnProperty.call(envelope?.context || {}, 'hostSurface') ||
      !(envelope?.context?.hostSurface === null || text(envelope?.context?.hostSurface))) {
    errors.push('context.hostSurface-required')
  }
  const checks = Array.isArray(envelope?.checks) ? envelope.checks : []
  if (!Array.isArray(envelope?.checks)) errors.push('checks-invalid')
  const ids = new Set()
  const ordinals = new Set()
  for (const check of checks) {
    if (!hasExactKeys(check, ['id', 'ordinal', 'status', 'summaryKey', 'summary', 'evidenceState', 'evidenceRefs', 'requiredAction'])) {
      errors.push('check-fields-invalid')
    }
    if (!text(check?.id) || ids.has(check.id)) errors.push('check.id-invalid-or-duplicate')
    if (!Number.isInteger(check?.ordinal) || ordinals.has(check.ordinal)) errors.push('check.ordinal-invalid-or-duplicate')
    if (!STATUSES.has(check?.status)) errors.push('check.status-invalid')
    if (!text(check?.summaryKey) || !text(check?.summary) || !EVIDENCE_STATES.has(check?.evidenceState) || !textList(check?.evidenceRefs)) {
      errors.push('check.fields-invalid')
    }
    if (check?.status === 'PASS' && check?.evidenceState !== 'verified') errors.push('check.pass-evidence-unverified')
    ids.add(check?.id)
    ordinals.add(check?.ordinal)
  }
  if (envelope?.messageKind === 'entry-check') {
    const lastOrdinal = envelope?.schemaVersion === 'DevCodexVisibleEnvelopeV3' ? 10 : 7
    const expected = Array.from({ length: lastOrdinal + 1 }, (_, index) => `PC${index}`)
    if (checks.length !== expected.length || expected.some((id, index) => checks[index]?.id !== id || checks[index]?.ordinal !== index)) {
      errors.push(`entry-check-PC0-PC${lastOrdinal}-required-in-order`)
    }
  }
  if (STATUSES.has(envelope?.status) && deriveStatus(checks) !== envelope.status) {
    errors.push('status-derived-value-mismatch')
  } else if (!STATUSES.has(envelope?.status)) {
    errors.push('status-invalid')
  }
  if (envelope?.messageKind === 'confirmation') {
    const decision = envelope?.decision
    if (!decision || typeof decision !== 'object' || Array.isArray(decision)) errors.push('confirmation-decision-required')
    else {
      const decisionKeys = Object.keys(decision)
      if (decisionKeys.some(key => !['id', 'kind', 'question', 'options', 'recommendedOption', 'fallbackText'].includes(key))) {
        errors.push('confirmation.fields-invalid')
      }
      for (const field of ['id', 'kind', 'question', 'recommendedOption']) {
        if (!text(decision[field])) errors.push(`confirmation.${field}-required`)
      }
      if (!textList(decision.options) || decision.options.length < 2 || !decision.options.includes(decision.recommendedOption)) {
        errors.push('confirmation.options-invalid')
      }
    }
  }
  const hasManifest = Boolean(envelope?.artifactManifest)
  const hasVisibleSet = Boolean(envelope?.userFacingArtifactSet)
  if (hasManifest !== hasVisibleSet) errors.push('artifact-manifest-visible-set-pair-required')
  if (hasManifest) {
    const manifest = envelope.artifactManifest
    if (!hasExactKeys(manifest, ['manifestId', 'reconciliationStatus', 'entryCount']) ||
        !text(manifest.manifestId) || manifest.reconciliationStatus !== 'verified' ||
        !Number.isInteger(manifest.entryCount) || manifest.entryCount < 0) {
      errors.push('artifactManifest-projection-invalid')
    }
  }
  if (hasManifest && envelope.artifactManifest.manifestId !== envelope.userFacingArtifactSet.manifestId) {
    errors.push('artifact-manifest-visible-set-id-mismatch')
  }
  if (hasVisibleSet) {
    const set = envelope.userFacingArtifactSet
    const setCore = {
      schemaVersion: set.schemaVersion,
      manifestId: set.manifestId,
      scope: set.scope,
      heading: set.heading,
      items: set.items,
      counts: set.counts,
      reconciliation: set.reconciliation
    }
    const itemKeys = [
      'artifactId', 'canonicalPath', 'lifecycleOperation', 'visibility', 'displayName', 'purposeKey',
      'purposeText', 'userAction', 'readingOrder', 'contentDigest'
    ]
    const itemIds = new Set()
    const itemPaths = new Set()
    const itemOrders = new Set()
    for (const item of Array.isArray(set.items) ? set.items : []) {
      if (!hasExactKeys(item, itemKeys) || !text(item?.artifactId) || !text(item?.canonicalPath) ||
          !path.isAbsolute(item?.canonicalPath || '') || /^file:\/\//i.test(item?.canonicalPath || '') ||
          !LIFECYCLE_OPERATIONS.has(item?.lifecycleOperation) || !VISIBILITIES.has(item?.visibility) ||
          !isSemanticDisplayName(item?.displayName, item?.canonicalPath) || !text(item?.purposeKey) ||
          !text(item?.purposeText) || !text(item?.userAction) || !Number.isInteger(item?.readingOrder) ||
          item.readingOrder < 0 || !text(item?.contentDigest)) errors.push('userFacingArtifactSet-item-invalid')
      const canonicalPath = canonicalPathIdentity(item?.canonicalPath)
      if (itemIds.has(item?.artifactId) || itemPaths.has(canonicalPath) || itemOrders.has(item?.readingOrder)) {
        errors.push('userFacingArtifactSet-item-identity-duplicate')
      }
      itemIds.add(item?.artifactId)
      itemPaths.add(canonicalPath)
      itemOrders.add(item?.readingOrder)
    }
    if (!hasExactKeys(set, ['schemaVersion', 'manifestId', 'scope', 'heading', 'items', 'counts', 'reconciliation', 'setId', 'validation']) ||
        set.schemaVersion !== 'UserFacingArtifactSetV1' || set.validation?.valid !== true ||
        !hasExactKeys(set.validation, ['valid', 'errors']) || set.validation.errors?.length !== 0 ||
        !['default', 'all-deliverable', 'internal-audit'].includes(set.scope) ||
        set.heading !== ACTION_HEADINGS[envelope?.messageKind] ||
        !Array.isArray(set.items) || !hasExactKeys(set.counts, ['listed', 'remaining', 'total']) ||
        !['listed', 'remaining', 'total'].every(field => Number.isInteger(set.counts?.[field]) && set.counts[field] >= 0) ||
        !hasExactKeys(set.reconciliation, ['status', 'requiredHidden', 'countConserved']) ||
        set.reconciliation?.status !== 'verified' || set.reconciliation?.countConserved !== true ||
        (set.reconciliation?.requiredHidden || []).length !== 0 ||
        set.counts?.listed !== set.items?.length || set.counts?.listed + set.counts?.remaining !== set.counts?.total ||
        set.setId !== `user-facing-artifacts-${digest(setCore)}`) {
      errors.push('userFacingArtifactSet-invalid')
    }
    if (hasManifest && set.counts?.total !== envelope.artifactManifest?.entryCount) {
      errors.push('artifactManifest-visible-set-count-mismatch')
    }
  }
  const expectedLinks = (envelope?.userFacingArtifactSet?.items || []).map(item => ({
    artifactId: item.artifactId,
    displayName: item.displayName,
    canonicalPath: item.canonicalPath,
    capabilityDecisionId: envelope?.linkCapability?.decisionId || null
  }))
  if (JSON.stringify(envelope?.artifactLinks || []) !== JSON.stringify(expectedLinks)) {
    errors.push('artifactLinks-derived-value-mismatch')
  }
  if (expectedLinks.length > 0 && !envelope?.linkCapability) errors.push('linkCapability-required-for-visible-items')
  if (!hasVisibleSet && envelope?.linkCapability) errors.push('linkCapability-without-visible-set')
  if (envelope?.linkCapability) errors.push(...linkCapabilityIntegrityErrors(envelope.linkCapability))
  if (envelope?.linkCapability && text(envelope?.context?.hostSurface) &&
      linkCapabilityHostSurface(envelope.linkCapability) !== envelope.context.hostSurface) errors.push('linkCapability-surface-mismatch')
  if (envelope?.linkCapability && envelope?.context?.hostSurface === null &&
      envelope.linkCapability.evidenceState === 'verified') errors.push('linkCapability-verified-with-unknown-surface')
  if (envelope?.schemaVersion === 'DevCodexVisibleEnvelopeV3') {
    const delivery = deriveArtifactDeliveryAttempts(
      envelope.userFacingArtifactSet,
      envelope.linkCapability,
      envelope.artifactDeliveryAttempts
    )
    errors.push(...delivery.errors)
  }
  const presentation = envelope?.presentation
  if (!hasExactKeys(presentation, ['requestedTier', 'effectiveTier', 'degradationReason']) ||
      !PRESENTATION_TIERS.has(presentation.requestedTier) || !PRESENTATION_TIERS.has(presentation.effectiveTier) ||
      !(presentation.degradationReason === null || text(presentation.degradationReason))) {
    errors.push('presentation-invalid')
  }
  if (!hasExactKeys(envelope?.validation, ['valid', 'errors']) || envelope?.validation?.valid !== true ||
      !Array.isArray(envelope?.validation?.errors) || envelope.validation.errors.length) {
    errors.push('envelope-invalid')
  }
  return errors
}

function normalizeCompatibleVisibleEnvelope(envelope) {
  if (envelope?.schemaVersion === 'DevCodexVisibleEnvelopeV3') {
    const postCompletionActions = createPostCompletionActionSet(envelope.postCompletionActions || {})
    const errors = validateSerializedEnvelopeBase(envelope, VISIBLE_ENVELOPE_V3_KEYS)
    if (!hasExactKeys(envelope.postCompletionActions, [
      'schemaVersion', 'requiredNow', 'primaryAction', 'conditionalActions', 'validation'
    ]) || envelope.postCompletionActions?.schemaVersion !== 'PostCompletionActionSetV1' ||
      !hasExactKeys(envelope.postCompletionActions?.validation, ['valid', 'errors']) ||
      envelope.postCompletionActions?.validation?.valid !== true ||
      (envelope.postCompletionActions?.validation?.errors || []).length !== 0) {
      errors.push('postCompletionActions-serialized-shape-invalid')
    }
    errors.push(...postCompletionActions.validation.errors.map(error => `postCompletionActions.${error}`))
    if (['completion-check', 'final-result'].includes(envelope.messageKind) && postCompletionActions.requiredNow.length > 0) {
      errors.push('completion-claim-requiredNow-must-be-empty')
    }
    if (envelope.messageKind === 'entry-check') errors.push(...entryCheckModelIntegrityErrors(envelope.entryCheckModel))
    else if (envelope.entryCheckModel !== null) errors.push('entryCheckModel-non-entry-must-be-null')
    const semanticCore = {
      schemaVersion: 'DevCodexVisibleEnvelopeV3',
      messageKind: envelope.messageKind,
      status: envelope.status,
      context: envelope.context,
      checks: (envelope.checks || []).map(({ summary, ...check }) => check),
      decision: envelope.decision,
      entryCheckModel: envelope.entryCheckModel,
      artifactManifest: envelope.artifactManifest,
      userFacingArtifactSet: serializedVisibleSet(envelope.userFacingArtifactSet),
      linkCapability: semanticLinkCapability(envelope.linkCapability),
      artifactDeliveryAttempts: semanticArtifactDeliveryAttempts(envelope.artifactDeliveryAttempts, envelope.linkCapability),
      postCompletionActions: {
        schemaVersion: postCompletionActions.schemaVersion,
        requiredNow: postCompletionActions.requiredNow,
        primaryAction: postCompletionActions.primaryAction,
        conditionalActions: postCompletionActions.conditionalActions
      }
    }
    if (digest(semanticCore) !== envelope.semanticDigest) errors.push('semanticDigest-mismatch')
    return {
      schemaVersion: 'CompatibleVisibleEnvelopeViewV1',
      sourceSchemaVersion: 'DevCodexVisibleEnvelopeV3',
      migrationStatus: 'current-v3',
      envelope,
      postCompletionActions,
      validation: { valid: errors.length === 0, errors: [...new Set(errors)] }
    }
  }
  if (envelope?.schemaVersion === 'DevCodexVisibleEnvelopeV2') {
    const postCompletionActions = createPostCompletionActionSet(envelope.postCompletionActions || {})
    const errors = validateSerializedEnvelopeBase(envelope, VISIBLE_ENVELOPE_V2_KEYS)
    if (!hasExactKeys(envelope.postCompletionActions, [
      'schemaVersion', 'requiredNow', 'primaryAction', 'conditionalActions', 'validation'
    ]) || envelope.postCompletionActions?.schemaVersion !== 'PostCompletionActionSetV1' ||
      !hasExactKeys(envelope.postCompletionActions?.validation, ['valid', 'errors']) ||
      envelope.postCompletionActions?.validation?.valid !== true ||
      (envelope.postCompletionActions?.validation?.errors || []).length !== 0) {
      errors.push('postCompletionActions-serialized-shape-invalid')
    }
    errors.push(...postCompletionActions.validation.errors.map(error => `postCompletionActions.${error}`))
    if (['completion-check', 'final-result'].includes(envelope.messageKind) && postCompletionActions.requiredNow.length > 0) {
      errors.push('completion-claim-requiredNow-must-be-empty')
    }
    const semanticCore = {
      schemaVersion: 'DevCodexVisibleEnvelopeV2',
      messageKind: envelope.messageKind,
      status: envelope.status,
      context: envelope.context,
      checks: (envelope.checks || []).map(({ summary, ...check }) => check),
      decision: envelope.decision,
      artifactManifest: envelope.artifactManifest,
      userFacingArtifactSet: serializedVisibleSet(envelope.userFacingArtifactSet),
      linkCapability: semanticLinkCapability(envelope.linkCapability),
      postCompletionActions: {
        schemaVersion: postCompletionActions.schemaVersion,
        requiredNow: postCompletionActions.requiredNow,
        primaryAction: postCompletionActions.primaryAction,
        conditionalActions: postCompletionActions.conditionalActions
      }
    }
    if (digest(semanticCore) !== envelope.semanticDigest) errors.push('semanticDigest-mismatch')
    return {
      schemaVersion: 'CompatibleVisibleEnvelopeViewV1',
      sourceSchemaVersion: 'DevCodexVisibleEnvelopeV2',
      migrationStatus: 'legacy-v2-read-only',
      envelope,
      postCompletionActions,
      validation: { valid: errors.length === 0, errors: [...new Set(errors)] }
    }
  }
  if (envelope?.schemaVersion === 'DevCodexVisibleEnvelopeV1') {
    const errors = validateSerializedEnvelopeBase(envelope, VISIBLE_ENVELOPE_V1_KEYS)
    if (!(envelope.recommendedAction === null || text(envelope.recommendedAction))) {
      errors.push('recommendedAction-invalid')
    }
    const semanticCore = {
      schemaVersion: 'DevCodexVisibleEnvelopeV1',
      messageKind: envelope.messageKind,
      status: envelope.status,
      context: envelope.context,
      checks: (envelope.checks || []).map(({ summary, ...check }) => check),
      decision: envelope.decision,
      artifactManifest: envelope.artifactManifest,
      userFacingArtifactSet: serializedVisibleSet(envelope.userFacingArtifactSet),
      requiredAction: envelope.recommendedAction || null
    }
    if (digest(semanticCore) !== envelope.semanticDigest) errors.push('semanticDigest-mismatch')
    const legacyAction = text(envelope.recommendedAction) ? {
      kind: 'legacy',
      label: envelope.recommendedAction,
      reason: '来自 V1 recommendedAction；未推断动作类型、适用性或执行授权',
      evidenceRefs: [],
      applicability: 'unverified',
      authorization: 'suggest-only'
    } : null
    return {
      schemaVersion: 'CompatibleVisibleEnvelopeViewV1',
      sourceSchemaVersion: 'DevCodexVisibleEnvelopeV1',
      migrationStatus: 'legacy-v1-read-only',
      envelope,
      postCompletionActions: {
        schemaVersion: 'PostCompletionActionSetCompatibilityViewV1',
        requiredNow: [],
        primaryAction: legacyAction,
        conditionalActions: [],
        validation: { valid: true, errors: [] }
      },
      validation: { valid: errors.length === 0, errors: [...new Set(errors)] }
    }
  }
  const compatibilityErrors = Array.isArray(envelope?.validation?.errors) && envelope.validation.errors.length
    ? envelope.validation.errors
    : ['envelope-invalid']
  return {
    schemaVersion: 'CompatibleVisibleEnvelopeViewV1',
    sourceSchemaVersion: envelope?.schemaVersion || 'unknown',
    migrationStatus: 'invalid',
    envelope: invalidEnvelope(compatibilityErrors),
    postCompletionActions: null,
    validation: { valid: false, errors: compatibilityErrors }
  }
}

function shouldUseCompact(previous, current, { userRequestedDetails = false } = {}) {
  if (userRequestedDetails || !previous?.validation?.valid || !current?.validation?.valid) return false
  if (!['entry-check', 'progress'].includes(current.messageKind)) return false
  if (current.checks.some(check => !['PASS', 'N/A'].includes(check.status))) return false
  const keys = ['project', 'taskId', 'contextEpoch']
  return previous.messageKind === current.messageKind && previous.semanticDigest === current.semanticDigest &&
    keys.every(key => previous.context?.[key] === current.context?.[key])
}

function buildSimpleGovernanceFastPathDecision(input = {}) {
  const errors = []
  const evidenceRefs = Array.isArray(input.evidenceRefs) ? input.evidenceRefs.slice().sort() : []
  if (!textList(evidenceRefs)) errors.push('evidenceRefs-invalid')
  const riskClass = String(input.riskClass || 'unknown')
  const taskKind = String(input.taskKind || 'unknown')
  const messageKind = String(input.messageKind || 'progress')
  const cpState = String(input.cpState || 'not-applicable')
  const upgradeTriggers = []
  const flagMap = {
    controlPlane: 'control-plane',
    sourceMutation: 'source-mutation',
    sharedStateMutation: 'shared-state-mutation',
    publicSurface: 'public-surface',
    destructiveOperation: 'destructive-operation',
    securitySensitive: 'security-sensitive',
    requiresFullFallback: 'full-fallback-required',
    userRequestedDetails: 'user-requested-details'
  }
  for (const [field, reason] of Object.entries(flagMap)) {
    if (input[field] === true) upgradeTriggers.push(reason)
  }
  if (riskClass !== 'low') upgradeTriggers.push('risk-not-low')
  if (!['progress', 'entry-check'].includes(messageKind)) upgradeTriggers.push('message-kind-not-compactable')
  if (['dev', 'fix', 'self-fix'].includes(taskKind) && !['confirmed', 'not-applicable'].includes(cpState)) {
    upgradeTriggers.push('cp-not-confirmed')
  }
  if (evidenceRefs.length === 0) upgradeTriggers.push('evidence-missing')
  const uniqueTriggers = Array.from(new Set(upgradeTriggers)).sort()
  const eligible = errors.length === 0 && uniqueTriggers.length === 0
  const core = {
    schemaVersion: 'SimpleGovernanceFastPathDecisionV1',
    taskKind,
    messageKind,
    riskClass,
    cpState,
    eligible,
    visibleMode: eligible ? 'compact' : 'full',
    reasonCode: eligible ? 'simple-low-risk-evidence-backed' : 'fail-closed-full-path',
    failClosed: true,
    upgradeTriggers: uniqueTriggers,
    guardrails: {
      pcChecks: 'required',
      cpGates: 'required-when-dev-fix-or-self-fix',
      governanceIntake: 'required',
      securityBoundary: 'required',
      profileAndFullFallback: 'required-when-triggered',
      internalArtifacts: 'required'
    },
    evidenceRefs
  }
  return { ...core, decisionId: `simple-governance-fast-path-${digest(core)}`, validation: { valid: errors.length === 0, errors } }
}

function portableTarget(filePath, workspaceRoot) {
  if (!text(workspaceRoot) || !path.isAbsolute(filePath)) return String(filePath).replace(/\\/g, '/')
  const relative = path.relative(workspaceRoot, filePath)
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) return relative.replace(/\\/g, '/')
  return String(filePath).replace(/\\/g, '/')
}

/**
 * PF-175 ArtifactPathColumnGate: always expose a path cell.
 * Default = workspace-relative portable; absolute only when fallback/failed/outside.
 * Rich clickable may still use absolute href for openability; path cell stays portable unless absolutePathFallback.
 */
function resolveArtifactPathCell(item, capability) {
  const portable = portableTarget(item.canonicalPath, capability?.workspaceRoot)
  const absolute = String(item.canonicalPath || '').replace(/\\/g, '/')
  const forceAbsolute = capability?.absolutePathFallback === true ||
    capability?.mode === 'failed' ||
    capability?.targetRelation === 'outside-workspace'
  return {
    portable,
    absolute,
    pathCell: forceAbsolute ? absolute : portable,
    forceAbsolute
  }
}

function renderArtifactItem(item, capability, tier, deliveryAttempt = null, localeDecision = resolveVisibleLocale(null)) {
  const catalog = localeDecision.catalog
  const sep = localeDecision.renderedLanguage === 'zh-CN' ? '；' : '; '
  const colon = localeDecision.renderedLanguage === 'zh-CN' ? '：' : ': '
  const hostDecision = capability?.schemaVersion === 'HostLinkCapabilityDecisionV2'
  const attemptFallback = hostDecision && (!deliveryAttempt || deliveryAttempt.status === 'fallback')
  const pathCapability = attemptFallback
    ? { ...capability, absolutePathFallback: true, mode: 'failed' }
    : capability
  const { portable, absolute, pathCell, forceAbsolute } = resolveArtifactPathCell(item, pathCapability)
  const linkTarget = tier === 'rich-markdown' && capability?.mode === 'clickable'
    ? absolute
    : portable
  const purpose = text(item.purposeText) ? item.purposeText : catalog.purposeMissing
  const action = text(item.userAction) ? item.userAction : catalog.view
  // Path column always present (PF-175); not the same as legacy bare absolute-only lists.
  const pathSuffix = `${sep}${catalog.path}${colon}\`${pathCell}\`${sep}${catalog.action}${colon}${action}`
  if (hostDecision) {
    const quoted = `"${absolute.replace(/"/g, '\\"')}"`
    const rendererAction = {
      'vscode-cli-goto': `\`code --goto ${quoted}\``,
      'zed-cli-open': `\`zed ${quoted}\``,
      'webstorm-cli-open': `\`webstorm ${quoted}\``
    }[capability.rendererId]
    const attemptStatus = deliveryAttempt?.status || 'fallback'
    if (attemptStatus === 'fallback') {
      const reason = deliveryAttempt?.fallbackReason || 'attempt-missing'
      return `- ${item.displayName} — ${purpose}${pathSuffix}${sep}${catalog.absolutePath}${colon}\`${absolute}\`${sep}fallback${colon}${reason}`
    }
    const openedSuffix = attemptStatus === 'opened' ? `${sep}${catalog.opened}` : ''
    if (capability.openMode === 'markdown-link' && tier === 'rich-markdown') {
      const escapedTarget = /\s/.test(absolute) ? `<${absolute}>` : absolute
      return `- [${item.displayName}](${escapedTarget}) — ${purpose}${pathSuffix}${openedSuffix}`
    }
    if (capability.openMode === 'native-action' && deliveryAttempt?.actionId) {
      return `- ${item.displayName} — ${purpose}${pathSuffix}${sep}${catalog.nativeAction}${colon}${deliveryAttempt.actionId}${openedSuffix}`
    }
    if (rendererAction && capability.openMode === 'terminal-command') {
      return `- ${item.displayName} — ${purpose}${pathSuffix}${sep}${catalog.openCommand}${colon}${rendererAction}${openedSuffix}`
    }
    const fallback = capability.absolutePathFallback
      ? `${sep}${catalog.absolutePath}${colon}\`${absolute}\`${sep}fallback${colon}${capability.fallbackReason}`
      : ''
    return `- ${item.displayName} — ${purpose}${pathSuffix}${fallback}`
  }
  if (tier === 'plain-text' || capability?.mode === 'plain' || capability?.mode === 'failed') {
    const fallback = capability?.absolutePathFallback && capability?.fallbackReason
      ? `${sep}fallback${colon}${capability.fallbackReason}`
      : ''
    return `- ${item.displayName} — ${purpose}${pathSuffix}${fallback}`
  }
  const escapedTarget = /\s/.test(linkTarget) ? `<${linkTarget}>` : linkTarget
  let line = `- [${item.displayName}](${escapedTarget}) — ${purpose}${pathSuffix}`
  // Absolute line only when path cell is already absolute and reason must stay explicit for failed surfaces.
  if (forceAbsolute && capability?.absolutePathFallback && capability?.fallbackReason) {
    line += `\n  ${catalog.absolutePath}${colon}${absolute} (${capability.fallbackReason})`
  }
  return line
}

/**
 * Free-text delivery/CP table classifier (PF-175).
 * @returns {'not-claimed'|'present'|'missing-path-column'|'legacy-bare-path'}
 */
function classifyArtifactPathColumnSample(sample) {
  const textSample = String(sample || '')
  if (!textSample.trim()) return 'not-claimed'
  // Legacy bare-path lists are a claim form even without allowed action headings.
  if (/(?:主要产物|核心文件|路径列表)\s*[:：]?\s*\n(?:[-*]\s*)?(?:[A-Za-z]:[\\/]|\/)/.test(textSample) &&
      !/用途|操作：|\|\s*路径\s*\|/.test(textSample)) {
    return 'legacy-bare-path'
  }
  const claimsDelivery = /需要你确认的文件|本批交付文件|完成交付文件|阻断证据|交付表|确认文件/.test(textSample)
  if (!claimsDelivery) return 'not-claimed'
  const hasPathColumn =
    /路径\s*[:：]/.test(textSample) ||
    /\|\s*路径\s*\|/.test(textSample) ||
    /路径\s*\|\s*/.test(textSample)
  return hasPathColumn ? 'present' : 'missing-path-column'
}

function unique(items) {
  const result = []
  for (const item of items) {
    if (!result.includes(item)) result.push(item)
  }
  return result
}

/**
 * Dialogue-Primary Closeout (DPC): readable narrative without opening the report.
 * Shared helper — intentionally lenient (DPC-013).
 */
function stripMarkdownLinks(text) {
  return String(text || '')
    .replace(/\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/`[^`]+`/g, ' ')
}

function hasUserNarrativeOverride(text) {
  return /user-override|用户要求只要路径|不要摘要|只要路径|全文贴对话|跳过对话摘要/i.test(String(text || ''))
}

function hasReadableNarrativeSnippet(sample) {
  const text = String(sample || '')
  if (!text.trim()) return false
  if (hasUserNarrativeOverride(text)) return true

  const plain = stripMarkdownLinks(text).replace(/\r\n/g, '\n')
  const resultSignal =
    /(?:^|\n)\s*(?:#{1,3}\s*)?(?:结果|结论|推荐|执行结果|分析结论)\s*[:：]/im.test(plain) ||
    /(?:结果|结论|推荐)\s*[:：].{8,}/m.test(plain) ||
    /(?:本次完成|做成了|方案审阅结论|分析完成|收口结论)/.test(plain) ||
    /(?:推荐\s*[:：]|推荐方案|推荐结论)/.test(plain)

  const bulletLines = plain
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^[-*•]|\d+[.)、]/.test(line))
    .map(line => line.replace(/^[-*•]\s*|\d+[.)、]\s*/, '').trim())
    .filter(line => line.length >= 6)
    .filter(line => !/^(?:详见|见)?报告|路径[:：]|reports\//i.test(line))

  const substantiveBullet = bulletLines.length >= 1
  const reasonInSentence =
    /(?:因为|原因|关键|包括|变更|结论).{6,}/.test(plain) &&
    plain.replace(/\s+/g, '').length >= 20

  // Single short verdict with substance (e.g. "方案审阅结论：合理，因边界清晰。")
  const shortVerdict =
    /(?:结论|合理|可行|通过|完成)[:：，,\s].{4,}/.test(plain) &&
    plain.replace(/\s+/g, '').length >= 12

  if (substantiveBullet) return true
  if (resultSignal && (reasonInSentence || shortVerdict || plain.replace(/\s+/g, '').length >= 16)) return true
  if (shortVerdict && plain.replace(/\s+/g, '').length >= 16) return true
  return false
}

/**
 * Classify dialogue-primary narrative for final-result / completion / analyze closeout.
 * @returns {'not-claimed'|'waived'|'present'|'narrative-missing'}
 */
function analyzeDialogueNarrativeSample(sample, options = {}) {
  const textSample = String(sample || '')
  const forceClaimed = options.forceClaimed === true
  const claimedCloseout =
    forceClaimed ||
    /DevCodexVisibleEnvelopeV(?:1|2)\s*·\s*(?:completion-check|final-result)/i.test(textSample) ||
    /###\s*DevCodex\s*·\s*(?:完成检查|执行结果)/i.test(textSample) ||
    /🛡️\s*DEV\s*模式\s*\|\s*合规检查/i.test(textSample) ||
    /(?:完成检查|completion-check|CompletionEvidenceGate|final-result)/i.test(textSample) ||
    /(?:分析完成|审阅结论|方案审阅|收敛交付|执行结果|推荐结论|本次完成|已完成交付)/i.test(textSample)

  if (!textSample.trim() || !claimedCloseout) {
    return {
      schemaVersion: 'DialogueNarrativeAnalysisV1',
      claimed: false,
      status: 'not-claimed',
      classification: 'not-claimed',
      hasNarrative: false,
      waived: false
    }
  }

  if (hasUserNarrativeOverride(textSample)) {
    return {
      schemaVersion: 'DialogueNarrativeAnalysisV1',
      claimed: true,
      status: 'verified-present',
      classification: 'waived',
      hasNarrative: true,
      waived: true
    }
  }

  const hasNarrative = hasReadableNarrativeSnippet(textSample)
  return {
    schemaVersion: 'DialogueNarrativeAnalysisV1',
    claimed: true,
    status: hasNarrative ? 'verified-present' : 'verified-missing',
    classification: hasNarrative ? 'present' : 'narrative-missing',
    hasNarrative,
    waived: false
  }
}

function classifyDialogueNarrativeSample(sample, options = {}) {
  return analyzeDialogueNarrativeSample(sample, options).classification
}

/**
 * DevModeCompletionCheckDetailGate / FinalValidationSummaryV1 free-text classifier.
 *
 * It keeps the final reply short, but requires enough fields for a reviewer to
 * verify completion without opening every raw report: command + exitCode,
 * runId/key count, workspace sync, dirty boundary and release action boundary.
 * A commit claim additionally requires post-commit replay evidence.
 */
function analyzeFinalValidationSummarySample(sample, options = {}) {
  const textSample = String(sample || '')
  // NoisePolicy: short FVS alone is a valid completion scaffold (no full FC table required).
  const claimedCompletion =
    /FinalValidationSummaryV1|###\s*FinalValidationSummary/i.test(textSample) ||
    /DevCodexVisibleEnvelopeV(?:1|2)\s*·\s*completion-check/i.test(textSample) ||
    /###\s*DevCodex\s*·\s*完成检查/i.test(textSample) ||
    /🛡️\s*DEV\s*模式\s*\|\s*合规检查/i.test(textSample) ||
    /####\s*验证摘要|权威验证命令与\s*exitCode/i.test(textSample)

  if (!textSample.trim() || !claimedCompletion) {
    return {
      schemaVersion: 'FinalValidationSummaryAnalysisV1',
      claimed: false,
      status: 'not-claimed',
      classification: 'not-claimed',
      missingItems: [],
      evidence: {
        command: false,
        exitCode: false,
        runIdOrKeyCount: false,
        workspaceSync: false,
        dirtyBoundary: false,
        releaseActionBoundary: false,
        postCommitReplay: false,
        commitClaimed: false,
        reportOnly: false,
        thinGreen: false
      }
    }
  }

  const normalized = textSample.replace(/\r\n/g, '\n')
  const commandRe = /`?(?:npm|node|pnpm|yarn|npx|grok|devcodex)\s+(?:run\s+)?[A-Za-z0-9:_./@=-][^`\n|;]*/i
  const commandWithLabelRe = /(?:命令|command|验证|测试|TestRoute|权威)[^\n]{0,80}(?:npm|node|pnpm|yarn|npx|grok|devcodex)\s+/i
  const hasCommand = commandRe.test(normalized) || commandWithLabelRe.test(normalized)
  const hasExitCode = /\bexitCode\s*(?:[:=])?\s*(?:0|[1-9]\d*)\b|退出码\s*[:：=]?\s*(?:0|[1-9]\d*)/i.test(normalized)
  const hasRunIdOrKeyCount =
    /\brunId\s*[:=]\s*[A-Za-z0-9_.:-]+/i.test(normalized) ||
    /关键计数|key count|counts?\s*[:=]|计数\s*[:：]/i.test(normalized) ||
    /\bV\d+\s*(?:~|-|至|到)\s*V?\d+\b/i.test(normalized) ||
    /(?:checks?|probes?|nodes?|files?|routes?|关键计数|计数|通过|passed)[^\n]{0,24}\b\d+\s*\/\s*\d+\b|\b\d+\s*\/\s*\d+\b[^\n]{0,24}(?:checks?|probes?|nodes?|files?|routes?|项|通过|passed)/i.test(normalized) ||
    /\b(?:checks?|probes?|nodes?|files?|routes?)\s*[:=]\s*\d+\b/i.test(normalized) ||
    /\b\d+\s*(?:项|个|条|个探针|项检查)\b/.test(normalized)
  const hasWorkspaceSync =
    /WorkspaceSyncStatus|workspace\s*sync|工作区(?:副本)?同步|部署副本同步|hostsSynced/i.test(normalized) &&
    /synced|skipped|blocked|N\/A|不适用|未触发|无需同步|已同步|跳过/i.test(normalized)
  const hasDirtyBoundary =
    /(?:dirty\s*boundary|dirty\s*边界|git\s+status|工作树|dirty\s*status|tracked\s+clean|clean[-\s]tree|无关\s*dirty|未跟踪)[^\n]{0,180}(?:clean|dirty|干净|无关|未跟踪|tracked|empty|0)|(?:clean[-\s]tree|tracked\s+clean|git\s+status\s+(?:--short\s+)?(?:clean|empty|0)|工作树[^\n]{0,120}(?:干净|clean|无关))/i.test(normalized)
  const hasReleaseBoundary =
    /(?:push|tag|release|publish|发布动作|Release actions?|发布边界)[^\n]{0,120}(?:未执行|N\/A|skipped|not\s+run|not\s+executed|不执行|none)|(?:未执行|N\/A|skipped|not\s+run|不执行)[^\n]{0,120}(?:push|tag|release|publish)/i.test(normalized)
  const commitClaimed =
    /\bcommit\b\s*`?[a-f0-9]{7,40}`?|\bcommit\s+[a-f0-9]{7,40}\b|提交\s*`?[a-f0-9]{7,40}`?/i.test(normalized)
  const hasPostCommitReplay =
    /post-commit|commit\s+replay|clean-tree\s+replay|提交后|commit\s*后|提交后复放|提交后验证/i.test(normalized)
  const reportOnly =
    /\[[^\]]*(?:报告|report)[^\]]*\]\([^)]+\.md[^)]*\)/i.test(normalized) &&
    !hasCommand
  const thinGreen =
    /全绿|全部通过|已通过|PASS|通过/i.test(normalized) &&
    !hasCommand &&
    !hasExitCode

  const missing = []
  if (!hasCommand) missing.push(thinGreen ? 'thin-green-summary' : reportOnly ? 'report-link-only' : 'validation-command')
  if (hasCommand && !hasExitCode) missing.push('exit-code')
  if (!hasRunIdOrKeyCount) missing.push('run-id-or-key-count')
  if (!hasWorkspaceSync) missing.push('workspace-sync')
  if (!hasDirtyBoundary) missing.push('dirty-boundary')
  if (!hasReleaseBoundary) missing.push('release-action-boundary')
  if (commitClaimed && !hasPostCommitReplay) missing.push('post-commit-replay')

  if (options.requirePostCommitReplay === true && !hasPostCommitReplay) {
    missing.push('post-commit-replay')
  }

  const missingItems = unique(missing)
  const status = missingItems.length ? 'verified-missing' : 'verified-present'
  return {
    schemaVersion: 'FinalValidationSummaryAnalysisV1',
    claimed: true,
    status,
    classification: status === 'verified-present' ? 'present' : missingItems[0],
    missingItems,
    evidence: {
      command: hasCommand,
      exitCode: hasExitCode,
      runIdOrKeyCount: hasRunIdOrKeyCount,
      workspaceSync: hasWorkspaceSync,
      dirtyBoundary: hasDirtyBoundary,
      releaseActionBoundary: hasReleaseBoundary,
      postCommitReplay: hasPostCommitReplay,
      commitClaimed,
      reportOnly,
      thinGreen
    }
  }
}

function classifyFinalValidationSummarySample(sample, options = {}) {
  return analyzeFinalValidationSummarySample(sample, options).classification
}

function renderVisibleEnvelope(envelope, {
  tier = null,
  compact = false,
  languageContext = null,
  audience = 'human',
  includeMachineMarker = audience === 'audit'
} = {}) {
  if (!['human', 'audit'].includes(audience)) throw new Error(`unsupported visible audience: ${audience}`)
  const localeDecision = resolveVisibleLocale(languageContext)
  const catalog = localeDecision.catalog
  const sep = localeDecision.renderedLanguage === 'zh-CN' ? '；' : '; '
  const colon = localeDecision.renderedLanguage === 'zh-CN' ? '：' : ': '
  const compatible = normalizeCompatibleVisibleEnvelope(envelope)
  const validContract = compatible.validation.valid
  envelope = compatible.envelope
  if (!validContract) envelope = invalidEnvelope(compatible.validation.errors)
  const postCompletionActions = validContract
    ? compatible.postCompletionActions
    : envelope.postCompletionActions
  const effectiveTier = validContract ? (tier || envelope.presentation?.effectiveTier || 'portable-markdown') : 'portable-markdown'
  if (!PRESENTATION_TIERS.has(effectiveTier)) throw new Error(`unsupported presentation tier: ${effectiveTier}`)
  const kindLabel = catalog.kindLabels[envelope.messageKind]
  const project = envelope.context?.project || catalog.unknownProject
  const marker = `${envelope.schemaVersion} · ${envelope.messageKind} · ${envelope.status} · ${envelope.semanticDigest}`
  const localeFallbackLine = localeDecision.fallbackReason
    ? catalog.localeFallback(localeDecision.requestedLanguage, localeDecision.fallbackReason)
    : null
  const primaryLabel = postCompletionActions?.primaryAction?.label || null
  const compactAllowed = validContract && ['entry-check', 'progress'].includes(envelope.messageKind) &&
    envelope.checks.every(check => ['PASS', 'N/A'].includes(check.status))
  if (compact && compactAllowed) {
    const ids = envelope.checks.map(check => `${check.id}=${check.status}`).join(' · ')
    const compactAction = primaryLabel ? `${catalog.next}: ${primaryLabel}` : null
    return effectiveTier === 'plain-text'
      ? [includeMachineMarker ? marker : null, `${project} | ${ids}`, catalog.statusUnchanged,
          localeFallbackLine, compactAction].filter(Boolean).join('\n')
      : [`### DevCodex · ${kindLabel}`, `\`${envelope.status}\` · \`${project}\` · ${catalog.statusUnchanged}`,
          localeFallbackLine, '', ids, compactAction, includeMachineMarker ? `\`${marker}\`` : null]
          .filter(value => value !== null && value !== undefined).join('\n')
  }
  let renderedChecks = envelope.checks
  if (audience === 'human' && envelope.messageKind !== 'entry-check') {
    const attention = envelope.checks.filter(check => !['PASS', 'N/A'].includes(check.status))
    renderedChecks = attention.length ? attention : envelope.checks
  }
  const checkLines = renderedChecks.map(check => {
    const action = check.requiredAction ? `${sep}${catalog.checkAction}${colon}${check.requiredAction}` : ''
    return audience === 'audit' || envelope.messageKind === 'entry-check'
      ? `- ${check.id} [${check.status}] ${check.summary}${action}`
      : `- [${check.status}] ${check.summary}${action}`
  })
  const decisionLines = envelope.decision ? [
    '', `${catalog.confirm}${colon}${envelope.decision.question || envelope.decision.fallbackText || ''}`,
    `${catalog.recommend}${colon}${envelope.decision.recommendedOption || primaryLabel || 'N/A'}`
  ] : []
  const artifactSet = envelope.userFacingArtifactSet
  const deliveryAttemptByArtifact = new Map((envelope.artifactDeliveryAttempts || []).map(attempt => [attempt.artifactId, attempt]))
  const artifactLines = artifactSet ? [
    '', effectiveTier === 'plain-text'
      ? catalog.actionHeadings[envelope.messageKind]
      : `#### ${catalog.actionHeadings[envelope.messageKind]}`,
    ...artifactSet.items.map(item => renderArtifactItem(
      item,
      envelope.linkCapability,
      effectiveTier,
      deliveryAttemptByArtifact.get(item.artifactId) || null,
      localeDecision
    )),
    `${catalog.listed} ${artifactSet.counts.listed} / ${catalog.total} ${artifactSet.counts.total}${sep}${catalog.hidden} ${artifactSet.counts.remaining}`
  ] : []
  const actionLines = []
  for (const action of postCompletionActions?.requiredNow || []) {
    actionLines.push('', `${catalog.requiredNow}${colon}${action.label} (${action.reason})`)
  }
  if (postCompletionActions?.primaryAction) {
    const legacy = compatible.migrationStatus === 'legacy-v1-read-only' ? ` (${catalog.legacyV1})` : ''
    actionLines.push('', `${catalog.next}${legacy}${colon}${postCompletionActions.primaryAction.label} (${postCompletionActions.primaryAction.reason})`)
  }
  for (const action of postCompletionActions?.conditionalActions || []) {
    actionLines.push(`${catalog.conditionalAction}${colon}${action.label} (${action.reason})`)
  }
  if (effectiveTier === 'plain-text') {
    return [includeMachineMarker ? marker : null, `DevCodex ${kindLabel} | ${envelope.status} | ${project}`,
      localeFallbackLine, ...checkLines, ...decisionLines, ...artifactLines, ...actionLines]
      .filter(value => value !== null && value !== undefined).join('\n')
  }
  const prefix = effectiveTier === 'rich-markdown' ? '### DevCodex · ' : '### DevCodex · '
  return [
    `${prefix}${kindLabel}`,
    `\`${envelope.status}\` · \`${project}\``,
    localeFallbackLine,
    '', ...checkLines, ...decisionLines, ...artifactLines, ...actionLines,
    includeMachineMarker ? '' : null,
    includeMachineMarker ? `\`${marker}\`` : null
  ].filter(value => value !== null && value !== undefined).join('\n')
}

module.exports = {
  ACTION_HEADINGS,
  DELIVERY_REQUIREMENTS,
  EVIDENCE_STATES,
  INTERNAL_ARTIFACT_CLASSES,
  LIFECYCLE_OPERATIONS,
  LINK_MODES,
  HOST_LINK_OPEN_MODES,
  ARTIFACT_DELIVERY_ACTION_STATUSES,
  ARTIFACT_DELIVERY_READBACK_STATUSES,
  ARTIFACT_DELIVERY_STATUSES,
  MESSAGE_KINDS,
  PRESENTATION_TIERS,
  STATUSES,
  TRUTH_SOURCE_KINDS,
  VISIBILITIES,
  ARTIFACT_ANCHOR_STATUSES,
  VISIBLE_LOCALE_CATALOGS,
  classifyArtifactTruthSource,
  createArtifactAnchor,
  createArtifactDeliveryManifest,
  createLinkCapabilityDecision,
  createHostLinkCapabilityDecisionV2,
  createArtifactDeliveryAttemptV1,
  resolveArtifactDelivery,
  validateLinkCapabilityDecision,
  createPostCompletionActionSet,
  createEntryCheckModelV3,
  createLegacyVisibleEnvelopeV1,
  createVisibleEnvelopeV2,
  createVisibleEnvelope,
  normalizeCompatibleVisibleEnvelope,
  analyzeFinalValidationSummarySample,
  analyzeDialogueNarrativeSample,
  buildSimpleGovernanceFastPathDecision,
  classifyArtifactPathColumnSample,
  classifyDialogueNarrativeSample,
  classifyFinalValidationSummarySample,
  hasReadableNarrativeSnippet,
  hasUserNarrativeOverride,
  digest,
  isSemanticDisplayName,
  portableTarget,
  projectArtifactAnchorsFromManifest,
  projectUserFacingArtifactSet,
  renderArtifactItem,
  resolveArtifactPathCell,
  resolveVisibleLocale,
  renderVisibleEnvelope,
  shouldUseCompact
}
