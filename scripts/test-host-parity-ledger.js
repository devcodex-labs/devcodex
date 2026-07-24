#!/usr/bin/env node
'use strict'

/**
 * HostParity enterprise residual ledger + cannotClaim floor + upgrade gate (E1/E3/E5/E8).
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  loadUnalignedLedger,
  validateUnalignedLedger,
  closeUnalignedItem,
  formatUnalignedLedgerMarkdown,
  REQUIRED_IDS,
  DEFAULT_LEDGER_PATH,
  DEFAULT_SCHEMA_PATH
} = require('./lib/parity-unaligned-ledger.js')
const {
  validateParityUpgradeDecision,
  digestParityUpgradeDecision,
  assertCannotClaimShrinkAllowed,
  SCHEMA_VERSION: UPGRADE_SCHEMA
} = require('./lib/parity-upgrade-decision.js')
const {
  MIN_CANNOT_CLAIM,
  assertCannotClaimFloor,
  evaluateGrokHostParity
} = require('./lib/host-parity-scorecard.js')

assert.ok(fs.existsSync(DEFAULT_LEDGER_PATH), 'unaligned-ledger.v1.json must exist')
assert.ok(fs.existsSync(DEFAULT_SCHEMA_PATH), 'unaligned-ledger.schema.json must exist')

const ledger = loadUnalignedLedger()
assert.strictEqual(ledger.items.length, REQUIRED_IDS.length)
assert.ok(ledger.items.every((i) => i.status === 'open'))
assert.ok(ledger.items.every((i) => Array.isArray(i.evidenceRefs) && i.evidenceRefs.length === 0))

// Illegal close without evidence
assert.throws(
  () => closeUnalignedItem(ledger, 'U-A1', []),
  /UNALIGNED_LEDGER_CLOSE_WITHOUT_EVIDENCE/
)

const closed = closeUnalignedItem(ledger, 'U-A1', [
  { kind: 'platform-docs', ref: 'P-GROK-1', note: 'test only' }
])
assert.strictEqual(closed.items.find((i) => i.id === 'U-A1').status, 'closed')
assert.ok(closed.items.find((i) => i.id === 'U-A1').evidenceRefs.length >= 1)
// original fixture still open on disk
assert.strictEqual(loadUnalignedLedger().items.find((i) => i.id === 'U-A1').status, 'open')

const md = formatUnalignedLedgerMarkdown(ledger)
assert.match(md, /U-A1/)
assert.match(md, /UnalignedLedgerV1/)

// MIN floor
assert.strictEqual(MIN_CANNOT_CLAIM.length, 4)
assertCannotClaimFloor([...MIN_CANNOT_CLAIM])
assert.throws(() => assertCannotClaimFloor(MIN_CANNOT_CLAIM.slice(0, 3)), /CANNOT_CLAIM_FLOOR/)
assert.throws(() => assertCannotClaimFloor([]), /CANNOT_CLAIM_FLOOR/)

// cannotClaim floor is independent of hostRoot layout
assertCannotClaimFloor([...MIN_CANNOT_CLAIM])
const scorePartial = evaluateGrokHostParity({
  cwd: process.cwd(),
  hostRoot: process.cwd(),
  hasAgentsMd: false,
  hasCodexLifecycle: false,
  hasGrokWorkspacePlugin: false,
  hasGrokPluginRegistration: false
})
assertCannotClaimFloor(scorePartial.cannotClaim)
assert.ok(scorePartial.cannotClaim.includes(MIN_CANNOT_CLAIM[0]))

// Upgrade gate: shrink without decision fails
const prev = [...MIN_CANNOT_CLAIM]
const shrunk = prev.slice(0, 3)
assert.throws(
  () => assertCannotClaimShrinkAllowed(prev, shrunk, null),
  /PARITY_UPGRADE_REQUIRED/
)

const decisionBody = {
  schemaVersion: UPGRADE_SCHEMA,
  decisionId: 'test-decision-1',
  createdAt: '2026-07-24T00:00:00.000Z',
  approver: 'test',
  evidenceKind: 'direct-host-replay',
  evidenceRefs: [{ kind: 'replay', ref: 'fixture://test' }],
  allowedCannotClaimRemovals: [prev[3]],
  ledgerClosures: []
}
const decision = {
  ...decisionBody,
  contentDigest: digestParityUpgradeDecision(decisionBody)
}
validateParityUpgradeDecision(decision)
const ok = assertCannotClaimShrinkAllowed(prev, shrunk, decision)
assert.deepStrictEqual(ok.removed, [prev[3]])

// Weak evidence for inject-related claim
const weakBody = {
  ...decisionBody,
  decisionId: 'test-decision-weak',
  evidenceKind: 'fixture-replay',
  allowedCannotClaimRemovals: [prev[0]]
}
const weak = {
  ...weakBody,
  contentDigest: digestParityUpgradeDecision(weakBody)
}
assert.throws(
  () => assertCannotClaimShrinkAllowed(prev, prev.slice(1), weak),
  /PARITY_UPGRADE_WEAK_EVIDENCE|PARITY_UPGRADE_NOT_ALLOWED/
)

// Structural invalid ledger
assert.throws(
  () => validateUnalignedLedger({ schemaVersion: 'x', updatedAt: 't', items: [] }),
  /UNALIGNED_LEDGER_INVALID/
)

console.log('host parity ledger + cannotClaim floor + upgrade gate tests passed')
