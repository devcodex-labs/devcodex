'use strict'

const crypto = require('crypto')
const {
  stableStringify,
  validateContentIdentity
} = require('./content-identity.cjs')

const CONTEXT_CONTINUITY_SCHEMAS = Object.freeze({
  contextSnapshot: 'ContextSnapshotV1',
  observationLease: 'ContextObservationLeaseV1',
  snapshotHandoff: 'ContextSnapshotHandoffV1',
  routeBinding: 'ContextRouteBindingV1'
})

function digest(value) {
  return crypto.createHash('sha256').update(stableStringify(value), 'utf8').digest('hex')
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function portable(value) {
  return String(value || '').trim().replace(/\\/g, '/')
}

function orderedContextSourceIdentities(plan, sourceIdentities) {
  const bySource = new Map()
  for (const item of Array.isArray(sourceIdentities) ? sourceIdentities : []) {
    const sourceId = String(item?.sourceId || '').trim()
    if (!sourceId || !validateContentIdentity(item?.contentIdentity).valid) continue
    bySource.set(sourceId, { sourceId, contentIdentity: clone(item.contentIdentity) })
  }
  return (Array.isArray(plan?.selectedSources) ? plan.selectedSources : [])
    .map(source => bySource.get(String(source?.sourceId || '')))
    .filter(Boolean)
}

function buildContextSnapshot(plan, sourceIdentities) {
  if (!plan || plan.schemaVersion !== 'ContextReadPlanV2' || !String(plan.planContentId || '')) return null
  const ordered = orderedContextSourceIdentities(plan, sourceIdentities)
  const available = new Set(ordered.map(item => item.sourceId))
  if ((plan.mandatorySourceIds || []).some(sourceId => !available.has(sourceId))) return null
  const core = {
    schemaVersion: CONTEXT_CONTINUITY_SCHEMAS.contextSnapshot,
    planContentId: plan.planContentId,
    sourceFinalIdentities: ordered.map(item => ({
      sourceId: item.sourceId,
      contentIdentityDigest: item.contentIdentity.digest,
      contentIdentitySchema: item.contentIdentity.schemaVersion
    }))
  }
  return { ...core, contextSnapshotId: `context-snapshot-${digest(core)}` }
}

function deriveContextTurnBinding(plan) {
  if (!plan?.identity?.project || !plan?.identity?.activeRoot || !plan?.identity?.contextEpoch) return ''
  return `turn-${digest({
    schemaVersion: 'SkillRouteTurnV1',
    project: plan.identity.project,
    activeRoot: portable(plan.identity.activeRoot),
    contextEpoch: plan.identity.contextEpoch
  }).slice(0, 40)}`
}

function buildContextObservationLease(plan, contextSnapshot, options = {}) {
  if (!contextSnapshot?.contextSnapshotId) return null
  const core = {
    schemaVersion: CONTEXT_CONTINUITY_SCHEMAS.observationLease,
    contextEpoch: plan.identity.contextEpoch,
    hostSessionId: String(options.hostSessionId || ''),
    turnBinding: String(options.turnBinding || deriveContextTurnBinding(plan)),
    contextSnapshotId: contextSnapshot.contextSnapshotId
  }
  return { ...core, leaseDigest: digest(core) }
}

function buildContextRouteBinding(input = {}) {
  const contextSnapshotId = String(input.contextSnapshotId || '').trim()
  const workflowRouteDigest = String(input.workflowRouteDigest || '').trim()
  const skillPlanDigest = String(input.skillPlanDigest || '').trim()
  if (!/^context-snapshot-[a-f0-9]{64}$/.test(contextSnapshotId) ||
      !/^[a-f0-9]{64}$/.test(workflowRouteDigest) ||
      !/^[a-f0-9]{64}$/.test(skillPlanDigest)) return null
  const core = {
    schemaVersion: CONTEXT_CONTINUITY_SCHEMAS.routeBinding,
    contextSnapshotId,
    workflowRouteDigest,
    skillPlanDigest
  }
  return { ...core, bindingDigest: digest(core) }
}

function buildContextSnapshotHandoff(plan, receipt) {
  if (!plan || !receipt || !['relevant-complete', 'completed'].includes(receipt.status) ||
      receipt.delivery?.bodyObserved !== true || !receipt.contextSnapshotId) return null
  const sourceIdentities = orderedContextSourceIdentities(plan, receipt.sourceIdentities)
  const snapshot = buildContextSnapshot(plan, sourceIdentities)
  if (!snapshot || snapshot.contextSnapshotId !== receipt.contextSnapshotId) return null
  const core = {
    schemaVersion: CONTEXT_CONTINUITY_SCHEMAS.snapshotHandoff,
    activeRoot: plan.identity.activeRoot,
    project: plan.identity.project,
    priorContextEpoch: plan.identity.contextEpoch,
    priorPlanId: plan.planId,
    planContentId: plan.planContentId,
    contextSnapshotId: snapshot.contextSnapshotId,
    sourceIdentities,
    hostSessionId: String(receipt.identity?.hostSessionId || ''),
    receiptId: receipt.receiptId,
    observationLeaseDigest: receipt.observationLease?.leaseDigest || null
  }
  return { ...core, handoffDigest: digest(core) }
}

function normalizeContextSnapshotHandoff(raw, plan) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      raw.schemaVersion !== CONTEXT_CONTINUITY_SCHEMAS.snapshotHandoff) return null
  const value = clone(raw)
  const handoffDigest = value.handoffDigest
  delete value.handoffDigest
  if (!/^[a-f0-9]{64}$/.test(String(handoffDigest || '')) || digest(value) !== handoffDigest) return null
  if (portable(value.activeRoot) !== portable(plan?.identity?.activeRoot) ||
      value.project !== plan?.identity?.project || value.planContentId !== plan?.planContentId) return null
  const snapshot = buildContextSnapshot(plan, value.sourceIdentities)
  if (!snapshot || snapshot.contextSnapshotId !== value.contextSnapshotId) return null
  return { ...value, handoffDigest }
}

module.exports = {
  CONTEXT_CONTINUITY_SCHEMAS,
  buildContextObservationLease,
  buildContextRouteBinding,
  buildContextSnapshot,
  buildContextSnapshotHandoff,
  normalizeContextSnapshotHandoff,
  orderedContextSourceIdentities
}
