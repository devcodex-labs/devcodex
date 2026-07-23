'use strict'

const crypto = require('crypto')
const path = require('path')

const MESSAGE_KINDS = new Set([
  'entry-check', 'completion-check', 'confirmation', 'progress', 'final-result', 'error-block'
])
const STATUSES = new Set(['PASS', 'WARN', 'BLOCK', 'UNVERIFIED', 'N/A'])
const LIFECYCLE_OPERATIONS = new Set(['create', 'update', 'rename', 'move', 'delete', 'unchanged-evidence'])
const VISIBILITIES = new Set(['decision-required', 'result', 'evidence', 'optional-detail', 'internal-only'])
const DELIVERY_REQUIREMENTS = new Set(['required', 'supporting', 'internal'])
const PRESENTATION_TIERS = new Set(['rich-markdown', 'portable-markdown', 'plain-text'])
const LINK_MODES = new Set(['clickable', 'portable', 'plain', 'failed'])
const EVIDENCE_STATES = new Set(['verified', 'unverified', 'failed'])
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
  if (!capability || capability.schemaVersion !== 'LinkCapabilityDecisionV1') return ['linkCapability-shape-invalid']
  const errors = []
  if (!hasExactKeys(capability, [
    'schemaVersion', 'surface', 'evidenceState', 'mode', 'workspaceRoot', 'targetRelation',
    'absolutePathFallback', 'fallbackReason', 'evidenceRefs', 'decisionId', 'validation'
  ])) errors.push('linkCapability-sibling-fields-invalid')
  if (!capability.validation?.valid) errors.push('linkCapability-invalid')
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

function deriveStatus(checks) {
  if (!checks.length) return 'N/A'
  return checks.slice().sort((left, right) => STATUS_SEVERITY.get(right.status) - STATUS_SEVERITY.get(left.status))[0].status
}

function invalidEnvelope(errors, input = {}) {
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

function createVisibleEnvelope(input) {
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
    const expected = Array.from({ length: 8 }, (_, index) => `PC${index}`)
    if (checks.length !== 8 || expected.some((id, index) => checks[index]?.id !== id || checks[index]?.ordinal !== index)) {
      errors.push('entry-check-PC0-PC7-required-in-order')
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
    if (text(input?.context?.hostSurface) && input.linkCapability.surface !== input.context.hostSurface) {
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
  if (errors.length) return invalidEnvelope(errors, input)

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

function renderArtifactItem(item, capability, tier) {
  const { portable, absolute, pathCell, forceAbsolute } = resolveArtifactPathCell(item, capability)
  const linkTarget = tier === 'rich-markdown' && capability?.mode === 'clickable'
    ? absolute
    : portable
  const purpose = text(item.purposeText) || '用途未标注'
  const action = text(item.userAction) || '查看'
  // Path column always present (PF-175); not the same as legacy bare absolute-only lists.
  const pathSuffix = `；路径：\`${pathCell}\`；操作：${action}`
  if (tier === 'plain-text' || capability?.mode === 'plain' || capability?.mode === 'failed') {
    const fallback = capability?.absolutePathFallback && capability?.fallbackReason
      ? `；fallback：${capability.fallbackReason}`
      : ''
    return `- ${item.displayName} — ${purpose}${pathSuffix}${fallback}`
  }
  const escapedTarget = /\s/.test(linkTarget) ? `<${linkTarget}>` : linkTarget
  let line = `- [${item.displayName}](${escapedTarget}) — ${purpose}${pathSuffix}`
  // Absolute line only when path cell is already absolute and reason must stay explicit for failed surfaces.
  if (forceAbsolute && capability?.absolutePathFallback && capability?.fallbackReason) {
    line += `\n  绝对路径：${absolute}（${capability.fallbackReason}）`
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
 * DevModeCompletionCheckDetailGate / FinalValidationSummaryV1 free-text classifier.
 *
 * It keeps the final reply short, but requires enough fields for a reviewer to
 * verify completion without opening every raw report: command + exitCode,
 * runId/key count, workspace sync, dirty boundary and release action boundary.
 * A commit claim additionally requires post-commit replay evidence.
 */
function analyzeFinalValidationSummarySample(sample, options = {}) {
  const textSample = String(sample || '')
  const claimedCompletion =
    /DevCodexVisibleEnvelopeV1\s*·\s*completion-check/i.test(textSample) ||
    /###\s*DevCodex\s*·\s*完成检查/i.test(textSample) ||
    /🛡️\s*DEV\s*模式\s*\|\s*合规检查/i.test(textSample) ||
    /(?:完成检查|completion-check|CompletionEvidenceGate)/i.test(textSample)

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

function renderVisibleEnvelope(envelope, { tier = null, compact = false } = {}) {
  const validContract = envelope?.validation?.valid === true
  if (!validContract) envelope = invalidEnvelope(envelope?.validation?.errors || ['envelope-invalid'])
  const effectiveTier = validContract ? (tier || envelope.presentation?.effectiveTier || 'portable-markdown') : 'portable-markdown'
  if (!PRESENTATION_TIERS.has(effectiveTier)) throw new Error(`unsupported presentation tier: ${effectiveTier}`)
  const kindLabel = {
    'entry-check': '入口检查', 'completion-check': '完成检查', confirmation: '确认',
    progress: '进度', 'final-result': '执行结果', 'error-block': '阻断'
  }[envelope.messageKind]
  const project = envelope.context?.project || 'unverified-project'
  const marker = `DevCodexVisibleEnvelopeV1 · ${envelope.messageKind} · ${envelope.status} · ${envelope.semanticDigest}`
  const compactAllowed = validContract && ['entry-check', 'progress'].includes(envelope.messageKind) &&
    envelope.checks.every(check => ['PASS', 'N/A'].includes(check.status))
  if (compact && compactAllowed) {
    const ids = envelope.checks.map(check => `${check.id}=${check.status}`).join(' · ')
    return effectiveTier === 'plain-text'
      ? `${marker}\n${project} | ${ids}\n状态未变化；${envelope.recommendedAction || '继续当前动作'}`
      : `### DevCodex · ${kindLabel}\n\`${envelope.status}\` · \`${project}\` · 状态未变化\n\n${ids}\n\n${envelope.recommendedAction || '继续当前动作'}\n\n\`${marker}\``
  }
  const checkLines = envelope.checks.map(check => {
    const action = check.requiredAction ? `；动作：${check.requiredAction}` : ''
    return `- ${check.id} [${check.status}] ${check.summary}${action}`
  })
  const decisionLines = envelope.decision ? [
    '', `确认：${envelope.decision.question || envelope.decision.fallbackText || ''}`,
    `建议：${envelope.decision.recommendedOption || envelope.recommendedAction || 'N/A'}`
  ] : []
  const artifactSet = envelope.userFacingArtifactSet
  const artifactLines = artifactSet ? [
    '', effectiveTier === 'plain-text' ? artifactSet.heading : `#### ${artifactSet.heading}`,
    ...artifactSet.items.map(item => renderArtifactItem(item, envelope.linkCapability, effectiveTier)),
    `已列 ${artifactSet.counts.listed} / 总计 ${artifactSet.counts.total}；默认隐藏 ${artifactSet.counts.remaining}`
  ] : []
  const actionLines = envelope.recommendedAction ? ['', `下一步：${envelope.recommendedAction}`] : []
  if (effectiveTier === 'plain-text') {
    return [marker, `DevCodex ${kindLabel} | ${envelope.status} | ${project}`, ...checkLines,
      ...decisionLines, ...artifactLines, ...actionLines].join('\n')
  }
  const prefix = effectiveTier === 'rich-markdown' ? '### DevCodex · ' : '### DevCodex · '
  return [
    `${prefix}${kindLabel}`,
    `\`${envelope.status}\` · \`${project}\``,
    '', ...checkLines, ...decisionLines, ...artifactLines, ...actionLines,
    '', `\`${marker}\``
  ].join('\n')
}

module.exports = {
  ACTION_HEADINGS,
  DELIVERY_REQUIREMENTS,
  EVIDENCE_STATES,
  INTERNAL_ARTIFACT_CLASSES,
  LIFECYCLE_OPERATIONS,
  LINK_MODES,
  MESSAGE_KINDS,
  PRESENTATION_TIERS,
  STATUSES,
  TRUTH_SOURCE_KINDS,
  VISIBILITIES,
  ARTIFACT_ANCHOR_STATUSES,
  classifyArtifactTruthSource,
  createArtifactAnchor,
  createArtifactDeliveryManifest,
  createLinkCapabilityDecision,
  createVisibleEnvelope,
  analyzeFinalValidationSummarySample,
  buildSimpleGovernanceFastPathDecision,
  classifyArtifactPathColumnSample,
  classifyFinalValidationSummarySample,
  digest,
  isSemanticDisplayName,
  portableTarget,
  projectArtifactAnchorsFromManifest,
  projectUserFacingArtifactSet,
  renderArtifactItem,
  resolveArtifactPathCell,
  renderVisibleEnvelope,
  shouldUseCompact
}
