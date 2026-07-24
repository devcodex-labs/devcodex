'use strict'

/**
 * ParityUpgradeDecisionV1 — gate cannotClaim shrink without evidence (E5).
 */

const crypto = require('crypto')

const SCHEMA_VERSION = 'ParityUpgradeDecisionV1'
const EVIDENCE_KINDS = Object.freeze([
  'platform-docs',
  'direct-host-replay',
  'fixture-replay'
])

/**
 * @param {object} decision
 * @returns {object}
 */
function validateParityUpgradeDecision(decision) {
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    throw new Error('PARITY_UPGRADE_INVALID: root must be object')
  }
  if (decision.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`PARITY_UPGRADE_INVALID: schemaVersion must be ${SCHEMA_VERSION}`)
  }
  if (!decision.decisionId || typeof decision.decisionId !== 'string') {
    throw new Error('PARITY_UPGRADE_INVALID: decisionId required')
  }
  if (!decision.createdAt || typeof decision.createdAt !== 'string') {
    throw new Error('PARITY_UPGRADE_INVALID: createdAt required')
  }
  if (!decision.approver || typeof decision.approver !== 'string') {
    throw new Error('PARITY_UPGRADE_INVALID: approver required')
  }
  if (!EVIDENCE_KINDS.includes(decision.evidenceKind)) {
    throw new Error(`PARITY_UPGRADE_INVALID: evidenceKind must be one of ${EVIDENCE_KINDS.join('|')}`)
  }
  if (!Array.isArray(decision.evidenceRefs) || decision.evidenceRefs.length < 1) {
    throw new Error('PARITY_UPGRADE_INVALID: evidenceRefs min 1')
  }
  if (!Array.isArray(decision.allowedCannotClaimRemovals)) {
    throw new Error('PARITY_UPGRADE_INVALID: allowedCannotClaimRemovals must be array')
  }
  if (!Array.isArray(decision.ledgerClosures)) {
    throw new Error('PARITY_UPGRADE_INVALID: ledgerClosures must be array')
  }
  if (!decision.contentDigest || typeof decision.contentDigest !== 'string') {
    throw new Error('PARITY_UPGRADE_INVALID: contentDigest required')
  }
  return decision
}

/**
 * Compute stable digest of decision body excluding contentDigest itself.
 * @param {object} decision
 * @returns {string}
 */
function digestParityUpgradeDecision(decision) {
  const copy = { ...decision }
  delete copy.contentDigest
  return crypto.createHash('sha256').update(JSON.stringify(copy)).digest('hex')
}

/**
 * Assert cannotClaim shrink is allowed by a decision.
 * @param {string[]} previous
 * @param {string[]} next
 * @param {object|null} decision
 * @returns {{ ok: true, removed: string[] } | never}
 */
function assertCannotClaimShrinkAllowed(previous, next, decision) {
  const prev = Array.isArray(previous) ? previous.map(String) : []
  const nxt = Array.isArray(next) ? next.map(String) : []
  const removed = prev.filter((c) => !nxt.includes(c))
  if (removed.length === 0) {
    return { ok: true, removed: [] }
  }
  if (!decision) {
    throw new Error(
      `PARITY_UPGRADE_REQUIRED: cannotClaim removals without decision: ${removed.join(' | ')}`
    )
  }
  const d = validateParityUpgradeDecision(decision)
  const allowed = d.allowedCannotClaimRemovals.map(String)
  for (const claim of removed) {
    const permitted = allowed.some((a) => claim === a || claim.includes(a) || a.includes(claim))
    if (!permitted) {
      throw new Error(`PARITY_UPGRADE_NOT_ALLOWED: removal not in decision: ${claim}`)
    }
  }
  // inject/Stop related shrinks require stronger evidence
  const needsStrong = removed.some((c) =>
    /inject|UserPromptSubmit|Stop hard-block|verified-present PC0|bootstrap/i.test(c)
  )
  if (needsStrong && d.evidenceKind === 'fixture-replay') {
    throw new Error(
      'PARITY_UPGRADE_WEAK_EVIDENCE: inject/Stop cannotClaim shrink requires platform-docs or direct-host-replay'
    )
  }
  return { ok: true, removed }
}

module.exports = {
  SCHEMA_VERSION,
  EVIDENCE_KINDS,
  validateParityUpgradeDecision,
  digestParityUpgradeDecision,
  assertCannotClaimShrinkAllowed
}
