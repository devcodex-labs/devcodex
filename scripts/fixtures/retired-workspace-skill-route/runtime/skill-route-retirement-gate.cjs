'use strict'

const fs = require('fs')
const path = require('path')

const POLICY_PATH = path.join(__dirname, 'skill-route-retirement-policy.v1.json')
const DIGEST_RE = /^[a-f0-9]{64}$/

function readJson (file, fsImpl = fs) {
  return JSON.parse(fsImpl.readFileSync(file, 'utf8'))
}

function validateRetirementPolicy (policy) {
  const errors = []
  if (!policy || policy.schemaVersion !== 'SkillRouteRetirementPolicyV1') {
    return { valid: false, errors: ['policy-schema'] }
  }
  if (!policy.policyId || !Array.isArray(policy.requiredHostVariants) ||
      new Set(policy.requiredHostVariants).size !== 5) {
    errors.push('policy-host-variants')
  }
  for (const field of [
    'minimumWindowHours',
    'minimumDistinctRunsPerHost',
    'minimumDistinctRunsTotal'
  ]) {
    if (!Number.isInteger(policy[field]) || policy[field] <= 0) {
      errors.push(`policy-${field}`)
    }
  }
  if (policy.requiredAuthorizationSource !== 'capability-pass' ||
      policy.requiredEffectiveMode !== 'unified' ||
      policy.requireCurrentContractBinding !== true ||
      policy.resetOnDigestChange !== true ||
      !Array.isArray(policy.zeroTolerance) ||
      !policy.zeroTolerance.length) {
    errors.push('policy-retirement-contract')
  }
  return { valid: errors.length === 0, errors }
}

function validateEvidenceRecord (record, policy) {
  const errors = []
  if (!record || record.schemaVersion !== 'SkillRouteS15EvidenceV1' ||
      record.status !== 'PASS') {
    return { valid: false, errors: ['evidence-schema-or-status'] }
  }
  if (!policy.requiredHostVariants.includes(record.hostVariant)) {
    errors.push('evidence-host-variant')
  }
  if (record.authorizationSource !== policy.requiredAuthorizationSource ||
      record.routeActivation?.effective !== policy.requiredEffectiveMode ||
      record.processComplete !== true) {
    errors.push('evidence-route-activation')
  }
  if (!record.probeRunId || !Number.isFinite(Date.parse(record.completedAt))) {
    errors.push('evidence-identity-or-time')
  }
  if (!DIGEST_RE.test(String(record.runtimeDigest || '')) ||
      !DIGEST_RE.test(String(record.hostAdapterDigest || '')) ||
      !DIGEST_RE.test(String(record.evidenceDigest || ''))) {
    errors.push('evidence-digests')
  }
  if (record.transport?.kind !== 'local-stdio' ||
      record.transport?.networkListener !== false ||
      record.transport?.longRunningServiceStarted !== false ||
      record.transport?.childExitedWithHost !== true) {
    errors.push('evidence-transport')
  }
  const anomalies = record.retirementAnomalies || {}
  for (const key of policy.zeroTolerance) {
    if (Number(anomalies[key] || 0) !== 0) errors.push(`evidence-anomaly:${key}`)
  }
  return { valid: errors.length === 0, errors }
}

function evaluateSkillRouteRetirement (options = {}) {
  const policy = options.policy || readJson(options.policyPath || POLICY_PATH, options.fs || fs)
  const policyValidation = validateRetirementPolicy(policy)
  if (!policyValidation.valid) {
    return {
      schemaVersion: 'SkillRouteRetirementGateV1',
      status: 'BLOCK',
      policyId: policy?.policyId || null,
      reasons: policyValidation.errors,
      summary: null
    }
  }
  const nowMs = options.now ? new Date(options.now).getTime() : Date.now()
  const records = Array.isArray(options.evidence) ? options.evidence : []
  const reasons = []
  const currentRuntimeDigest = String(options.currentRuntimeDigest || '')
  const currentHostAdapterDigests = options.currentHostAdapterDigests || {}
  if (!DIGEST_RE.test(currentRuntimeDigest)) {
    reasons.push('current-runtime-digest-unbound')
  }
  for (const host of policy.requiredHostVariants) {
    if (!DIGEST_RE.test(String(currentHostAdapterDigests[host] || ''))) {
      reasons.push(`current-host-adapter-digest-unbound:${host}`)
    }
  }
  const seenRuns = new Set()
  const accepted = []
  const rejected = []
  for (const record of records) {
    const validation = validateEvidenceRecord(record, policy)
    if (!validation.valid || seenRuns.has(record?.probeRunId)) {
      rejected.push({
        probeRunId: record?.probeRunId || null,
        errors: validation.valid ? ['evidence-duplicate-run'] : validation.errors
      })
      continue
    }
    if (record.runtimeDigest !== currentRuntimeDigest) {
      rejected.push({
        probeRunId: record.probeRunId,
        errors: ['evidence-current-runtime-digest-mismatch']
      })
      continue
    }
    if (record.hostAdapterDigest !== currentHostAdapterDigests[record.hostVariant]) {
      rejected.push({
        probeRunId: record.probeRunId,
        errors: ['evidence-current-host-adapter-digest-mismatch']
      })
      continue
    }
    seenRuns.add(record.probeRunId)
    const completedAtMs = Date.parse(record.completedAt)
    if (completedAtMs > nowMs) {
      rejected.push({ probeRunId: record.probeRunId, errors: ['evidence-future-time'] })
      continue
    }
    accepted.push({ ...record, completedAtMs })
  }

  const byHost = Object.fromEntries(policy.requiredHostVariants.map(host => [host, []]))
  for (const record of accepted) byHost[record.hostVariant].push(record)
  for (const host of policy.requiredHostVariants) {
    if (byHost[host].length < policy.minimumDistinctRunsPerHost) {
      reasons.push(`host-sample-floor:${host}`)
    }
    if (policy.resetOnDigestChange) {
      const identities = new Set(byHost[host].map(record =>
        `${record.runtimeDigest}:${record.hostAdapterDigest}`
      ))
      if (identities.size > 1) reasons.push(`host-digest-changed:${host}`)
    }
  }
  if (accepted.length < policy.minimumDistinctRunsTotal) {
    reasons.push('total-sample-floor')
  }
  const times = accepted.map(record => record.completedAtMs).sort((a, b) => a - b)
  const windowHours = times.length > 1
    ? (times[times.length - 1] - times[0]) / (60 * 60 * 1000)
    : 0
  if (windowHours < policy.minimumWindowHours) reasons.push('window-duration')
  const runtimeDigests = new Set(accepted.map(record => record.runtimeDigest))
  if (policy.resetOnDigestChange && runtimeDigests.size > 1) {
    reasons.push('runtime-digest-changed')
  }

  return {
    schemaVersion: 'SkillRouteRetirementGateV1',
    status: reasons.length ? 'BLOCK' : 'PASS',
    policyId: policy.policyId,
    reasons: [...new Set(reasons)].sort(),
    summary: {
      acceptedRuns: accepted.length,
      rejectedRuns: rejected.length,
      windowHours,
      hostRunCounts: Object.fromEntries(
        Object.entries(byHost).map(([host, hostRecords]) => [host, hostRecords.length])
      ),
      runtimeDigestCount: runtimeDigests.size
    },
    rejected
  }
}

module.exports = {
  POLICY_PATH,
  evaluateSkillRouteRetirement,
  validateEvidenceRecord,
  validateRetirementPolicy
}
