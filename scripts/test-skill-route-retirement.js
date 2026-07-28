'use strict'

const assert = require('assert')
const crypto = require('crypto')

const {
  POLICY_PATH,
  evaluateSkillRouteRetirement,
  validateRetirementPolicy
} = require('../hooks/_runtime/skill-route-retirement-gate.cjs')
const {
  HOST_VARIANTS
} = require('../hooks/_runtime/host-adapter-identity.cjs')

const policy = require(POLICY_PATH)
const runtimeDigest = crypto.createHash('sha256').update('runtime').digest('hex')
const currentHostAdapterDigests = Object.fromEntries(
  Object.values(HOST_VARIANTS).map(hostVariant => [
    hostVariant,
    crypto.createHash('sha256').update(`adapter:${hostVariant}`).digest('hex')
  ])
)

assert.deepStrictEqual(validateRetirementPolicy(policy), { valid: true, errors: [] })

function evidence (hostVariant, index, completedAt, overrides = {}) {
  const hostAdapterDigest = crypto.createHash('sha256')
    .update(`adapter:${hostVariant}`)
    .digest('hex')
  const base = {
    schemaVersion: 'SkillRouteS15EvidenceV1',
    status: 'PASS',
    probeRunId: `${hostVariant}:${index}`,
    hostVariant,
    authorizationSource: 'capability-pass',
    routeActivation: { effective: 'unified' },
    processComplete: true,
    runtimeDigest,
    hostAdapterDigest,
    completedAt,
    transport: {
      kind: 'local-stdio',
      networkListener: false,
      longRunningServiceStarted: false,
      childExitedWithHost: true
    },
    retirementAnomalies: Object.fromEntries(policy.zeroTolerance.map(key => [key, 0]))
  }
  base.evidenceDigest = crypto.createHash('sha256')
    .update(JSON.stringify({ ...base, evidenceDigest: null }))
    .digest('hex')
  return { ...base, ...overrides }
}

const start = new Date('2026-07-20T00:00:00.000Z')
const records = []
for (const [hostIndex, hostVariant] of policy.requiredHostVariants.entries()) {
  for (let index = 0; index < policy.minimumDistinctRunsPerHost; index += 1) {
    const ratio = (hostIndex * policy.minimumDistinctRunsPerHost + index) /
      (policy.minimumDistinctRunsTotal - 1)
    const completedAt = new Date(
      start.getTime() + ratio * policy.minimumWindowHours * 60 * 60 * 1000
    ).toISOString()
    records.push(evidence(hostVariant, index, completedAt))
  }
}

const pass = evaluateSkillRouteRetirement({
  policy,
  evidence: records,
  currentRuntimeDigest: runtimeDigest,
  currentHostAdapterDigests,
  now: new Date(start.getTime() + 80 * 60 * 60 * 1000).toISOString()
})
assert.strictEqual(pass.status, 'PASS')
assert.strictEqual(pass.summary.acceptedRuns, 100)
assert.strictEqual(pass.summary.windowHours, 72)

const lowVolume = evaluateSkillRouteRetirement({
  policy,
  evidence: records.slice(1),
  currentRuntimeDigest: runtimeDigest,
  currentHostAdapterDigests,
  now: '2026-07-24T12:00:00.000Z'
})
assert.strictEqual(lowVolume.status, 'BLOCK')
assert(lowVolume.reasons.some(reason => reason.startsWith('host-sample-floor:')))
assert(lowVolume.reasons.includes('total-sample-floor'))

const shortWindow = evaluateSkillRouteRetirement({
  policy,
  evidence: records.map((record, index) => ({
    ...record,
    completedAt: new Date(start.getTime() + index * 60 * 1000).toISOString()
  })),
  currentRuntimeDigest: runtimeDigest,
  currentHostAdapterDigests,
  now: '2026-07-24T12:00:00.000Z'
})
assert.strictEqual(shortWindow.status, 'BLOCK')
assert(shortWindow.reasons.includes('window-duration'))

const changedDigest = [...records]
changedDigest[0] = evidence(
  policy.requiredHostVariants[0],
  0,
  records[0].completedAt,
  { runtimeDigest: 'f'.repeat(64) }
)
const digestBlocked = evaluateSkillRouteRetirement({
  policy,
  evidence: changedDigest,
  currentRuntimeDigest: runtimeDigest,
  currentHostAdapterDigests,
  now: '2026-07-24T12:00:00.000Z'
})
assert.strictEqual(digestBlocked.status, 'BLOCK')
assert.strictEqual(digestBlocked.summary.rejectedRuns, 1)
assert.strictEqual(
  digestBlocked.rejected[0].errors[0],
  'evidence-current-runtime-digest-mismatch'
)

const anomaly = [...records]
anomaly[0] = evidence(
  policy.requiredHostVariants[0],
  0,
  records[0].completedAt,
  { retirementAnomalies: { legacyFallback: 1 } }
)
const anomalyBlocked = evaluateSkillRouteRetirement({
  policy,
  evidence: anomaly,
  currentRuntimeDigest: runtimeDigest,
  currentHostAdapterDigests,
  now: '2026-07-24T12:00:00.000Z'
})
assert.strictEqual(anomalyBlocked.status, 'BLOCK')
assert.strictEqual(anomalyBlocked.summary.rejectedRuns, 1)

const unboundCurrentContract = evaluateSkillRouteRetirement({
  policy,
  evidence: records,
  now: '2026-07-24T12:00:00.000Z'
})
assert.strictEqual(unboundCurrentContract.status, 'BLOCK')
assert(unboundCurrentContract.reasons.includes('current-runtime-digest-unbound'))

console.log('skill route retirement gate passed: hosts=5 runs=100 windowHours=72 negativeProbes=5')
