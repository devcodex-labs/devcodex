'use strict'

const { stableDigest } = require('./context-read-contract.cjs')

const CP3_POLICY = 'bounded-bug-without-implementation-plan@1'
const DIGEST_RE = /^[a-f0-9]{64}$/

function highRiskCp3Target(target) {
  return [
    /(^|\/)package\.json$/i,
    /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i,
    /(^|\/)\.env(?:\.[^/]+)?$/i,
    /(^|\/)(Dockerfile|docker-compose(?:\.[^/]+)?\.ya?ml)$/i,
    /(^|\/)\.github\/workflows\/.+\.ya?ml$/i,
    /(^|\/)(?:prisma\/schema\.prisma|schema\.prisma)$/i,
    /(^|\/)(?:migrations?|db\/migrations?)\//i
  ].some(re => re.test(String(target).replace(/\\/g, '/')))
}

// This is a policy observation, never a fabricated CP3 artifact or confirmation.
// Callers supply primary task facts and the current Git-observed candidate.
function observeConditionalBugCp3(input) {
  const candidate = input.candidate
  if (input.taskKind !== 'bugs' || input.hasImplementationPlan !== false ||
      input.runtimeTriggered !== false || candidate?.stable !== true ||
      !Array.isArray(candidate.changedFiles) || !Array.isArray(candidate.dirtyIdentities)) return null
  const paths = [...new Set([
    ...candidate.changedFiles, ...candidate.dirtyIdentities.map(item => item.path),
    ...(input.trackedFiles || [])
  ])].sort()
  if (!paths.length || paths.length >= 5 || paths.some(value => typeof value !== 'string' ||
      !value || value.startsWith('/') || /^[a-z]:/i.test(value) ||
      value.replace(/\\/g, '/').split('/').some(part => ['.', '..', ''].includes(part)) ||
      highRiskCp3Target(value))) return null
  const receipt = {
    schemaVersion: 'ConditionalCp3ApplicabilityV1',
    policy: CP3_POLICY,
    taskKind: 'bugs',
    required: false,
    taskId: input.taskId,
    admissionDigest: input.admissionDigest,
    ownerLeaseDigest: input.ownerLeaseDigest,
    cp2Digest: input.cp2Digest,
    candidateDigest: input.candidateDigest,
    pathCount: paths.length,
    scopeDigest: stableDigest(paths)
  }
  if (!validateConditionalBugCp3(receipt, input)) return null
  return Object.freeze({ ...receipt, observationDigest: stableDigest(receipt) })
}

function validateConditionalBugCp3(value, expected = {}) {
  if (!value || value.schemaVersion !== 'ConditionalCp3ApplicabilityV1' ||
      value.policy !== CP3_POLICY || value.taskKind !== 'bugs' || value.required !== false ||
      !Number.isInteger(value.pathCount) || value.pathCount < 1 || value.pathCount >= 5) return false
  for (const key of ['admissionDigest', 'ownerLeaseDigest', 'cp2Digest', 'candidateDigest', 'scopeDigest']) {
    if (!DIGEST_RE.test(String(value[key] || ''))) return false
  }
  for (const key of ['taskId', 'admissionDigest', 'ownerLeaseDigest', 'cp2Digest', 'candidateDigest']) {
    if (!value[key] || value[key] !== expected[key]) return false
  }
  if (value.observationDigest !== undefined) {
    const { observationDigest, ...body } = value
    if (stableDigest(body) !== observationDigest) return false
  }
  return true
}

module.exports = { highRiskCp3Target, observeConditionalBugCp3, validateConditionalBugCp3 }
