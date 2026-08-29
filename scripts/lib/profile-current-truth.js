'use strict'

const PROFILE_CURRENT_TRUTH_SCHEMA = 'ProfileCurrentTruthV1'
const SOURCE_CANDIDATE_TRUTH_SCHEMA = 'SourceCandidateTruthV1'
const PROFILE_CURRENT_TRUTH_HEADING = '## ProfileCurrentTruthV1'
const PROFILE_CURRENT_TRUTH_REF = 'currentTruthRef=05-发布规范.md#ProfileCurrentTruthV1'
const REQUIRED_FIELDS = Object.freeze([
  'schemaVersion',
  'sourceVersion',
  'releaseState',
  'npmLatest',
  'gitHead',
  'ciRun',
  'publishRun',
  'githubRelease',
  'asOf'
])
const CURRENT_STATUSES = new Set(['PASS', 'WARN', 'BLOCK', 'UNVERIFIED'])
const CANDIDATE_STATUSES = new Set([
  'LOCAL_QUALIFICATION',
  'QUALIFICATION_BLOCKED',
  'SOURCE_QUALIFIED',
  'CI_PENDING',
  'PUBLISH_PENDING'
])
const SOURCE_CANDIDATE_STATUSES = new Set([
  'LOCAL_PENDING',
  'INVALIDATED',
  'LOCAL_QUALIFIED',
  'CI_PENDING',
  'CI_PASS',
  'CI_FAILED',
  'RELEASED'
])
const SOURCE_EVIDENCE_STATUSES = new Set(['PASS', 'BLOCK', 'UNVERIFIED'])

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isIsoTimestamp(value) {
  return typeof value === 'string' && value.length >= 20 && Number.isFinite(Date.parse(value))
}

function validateObservedObject(value, label, identityField, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${label} must be an object`)
    return
  }
  if (typeof value[identityField] !== 'string' || !value[identityField].trim()) {
    errors.push(`${label}.${identityField} must be a non-empty string`)
  }
  if (!CURRENT_STATUSES.has(value.status)) {
    errors.push(`${label}.status must be PASS, WARN, BLOCK, or UNVERIFIED`)
  }
  if (!isIsoTimestamp(value.observedAt)) {
    errors.push(`${label}.observedAt must be an ISO timestamp`)
  }
}

function validateCandidateObject(value, errors) {
  if (!isPlainObject(value)) {
    errors.push('candidate must be an object when releaseState is candidate')
    return
  }
  if (!/^\d+\.\d+\.\d+$/.test(String(value.targetVersion || ''))) {
    errors.push('candidate.targetVersion must be an exact semver')
  }
  if (!/^v\d+\.\d+\.\d+$/.test(String(value.targetTag || ''))) {
    errors.push('candidate.targetTag must be an exact v-prefixed semver tag')
  }
  if (!CANDIDATE_STATUSES.has(value.status)) {
    errors.push(`candidate.status must be one of: ${Array.from(CANDIDATE_STATUSES).join(', ')}`)
  }
  if (typeof value.releaseAuthorized !== 'boolean') {
    errors.push('candidate.releaseAuthorized must be a boolean')
  }
  if (value.status === 'QUALIFICATION_BLOCKED' && value.releaseAuthorized !== false) {
    errors.push('candidate.releaseAuthorized must be false for QUALIFICATION_BLOCKED')
  }
  if (['LOCAL_QUALIFICATION', 'SOURCE_QUALIFIED', 'CI_PENDING', 'PUBLISH_PENDING'].includes(value.status) &&
      value.releaseAuthorized !== true) {
    errors.push(`candidate.releaseAuthorized must be true for ${value.status}`)
  }
  if (value.externalState !== 'pending') {
    errors.push('candidate.externalState must equal pending before release closure')
  }
}

function validateSourceEvidenceObject(value, label, identityField, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${label} must be an object`)
    return
  }
  if (typeof value[identityField] !== 'string' || !value[identityField].trim()) {
    errors.push(`${label}.${identityField} must be a non-empty string`)
  }
  if (!SOURCE_EVIDENCE_STATUSES.has(value.status)) {
    errors.push(`${label}.status must be PASS, BLOCK, or UNVERIFIED`)
  }
  if (!isIsoTimestamp(value.observedAt)) {
    errors.push(`${label}.observedAt must be an ISO timestamp`)
  }
}

function validateSourceCandidateObject(value, record, errors) {
  if (!isPlainObject(value)) {
    errors.push('sourceCandidate must be an object')
    return
  }
  if (value.schemaVersion !== SOURCE_CANDIDATE_TRUTH_SCHEMA) {
    errors.push(`sourceCandidate.schemaVersion must equal ${SOURCE_CANDIDATE_TRUTH_SCHEMA}`)
  }
  if (!/^validation-candidate-[0-9a-f]{64}$/i.test(String(value.candidateId || ''))) {
    errors.push('sourceCandidate.candidateId must be a validation-candidate SHA-256 identity')
  }
  if (!SOURCE_CANDIDATE_STATUSES.has(value.status)) {
    errors.push(`sourceCandidate.status must be one of: ${Array.from(SOURCE_CANDIDATE_STATUSES).join(', ')}`)
  }
  validateSourceEvidenceObject(value.localQualification, 'sourceCandidate.localQualification', 'runId', errors)
  validateSourceEvidenceObject(value.remoteCi, 'sourceCandidate.remoteCi', 'runId', errors)
  if (!/^[0-9a-f]{40}$/i.test(String(value.remoteCi?.head || ''))) {
    errors.push('sourceCandidate.remoteCi.head must be a 40-character commit SHA')
  }
  if (typeof value.releaseAuthorized !== 'boolean') {
    errors.push('sourceCandidate.releaseAuthorized must be a boolean')
  }

  const localPassStates = new Set(['LOCAL_QUALIFIED', 'CI_PENDING', 'CI_PASS', 'CI_FAILED', 'RELEASED'])
  if (localPassStates.has(value.status) && value.localQualification?.status !== 'PASS') {
    errors.push(`sourceCandidate.localQualification.status must be PASS for ${value.status}`)
  }
  if (value.status === 'CI_PENDING' && value.remoteCi?.status !== 'UNVERIFIED') {
    errors.push('sourceCandidate.remoteCi.status must be UNVERIFIED for CI_PENDING')
  }
  if (value.status === 'CI_PASS' && value.remoteCi?.status !== 'PASS') {
    errors.push('sourceCandidate.remoteCi.status must be PASS for CI_PASS')
  }
  if (value.status === 'CI_FAILED' && value.remoteCi?.status !== 'BLOCK') {
    errors.push('sourceCandidate.remoteCi.status must be BLOCK for CI_FAILED')
  }
  if (value.status === 'INVALIDATED' && value.localQualification?.status !== 'BLOCK') {
    errors.push('sourceCandidate.localQualification.status must be BLOCK for INVALIDATED')
  }
  if (value.status === 'INVALIDATED' && value.releaseAuthorized !== false) {
    errors.push('sourceCandidate.releaseAuthorized must be false for INVALIDATED')
  }
  if (['CI_PENDING', 'CI_PASS', 'CI_FAILED'].includes(value.status) && value.remoteCi?.head !== record.gitHead) {
    errors.push(`sourceCandidate.remoteCi.head drift: ${value.remoteCi?.head} != ${record.gitHead}`)
  }
  if (value.status === 'RELEASED') {
    if (value.remoteCi?.status !== 'PASS') errors.push('sourceCandidate.remoteCi.status must be PASS for RELEASED')
    if (record.releaseCommit && record.releaseCommit !== record.gitHead) {
      errors.push(`RELEASED sourceCandidate requires releaseCommit == gitHead: ${record.releaseCommit} != ${record.gitHead}`)
    }
  }
}

function compareSemver(left, right) {
  const a = String(left || '').split('.').map(Number)
  const b = String(right || '').split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1
  }
  return 0
}

function validateTruthRecord(record) {
  const errors = []
  if (!isPlainObject(record)) return { valid: false, errors: ['record must be a JSON object'] }
  for (const field of REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) errors.push(`missing required field: ${field}`)
  }
  if (record.schemaVersion !== PROFILE_CURRENT_TRUTH_SCHEMA) {
    errors.push(`schemaVersion must equal ${PROFILE_CURRENT_TRUTH_SCHEMA}`)
  }
  for (const field of ['sourceVersion', 'npmLatest']) {
    if (!/^\d+\.\d+\.\d+$/.test(String(record[field] || ''))) {
      errors.push(`${field} must be an exact semver`)
    }
  }
  if (typeof record.releaseState !== 'string' || !record.releaseState.trim()) {
    errors.push('releaseState must be a non-empty string')
  }
  if (/^candidate\b/i.test(String(record.releaseState || ''))) {
    validateCandidateObject(record.candidate, errors)
  }
  if (!/^[0-9a-f]{40}$/i.test(String(record.gitHead || ''))) {
    errors.push('gitHead must be a 40-character commit SHA')
  }
  if (Object.prototype.hasOwnProperty.call(record, 'releaseCommit') &&
      !/^[0-9a-f]{40}$/i.test(String(record.releaseCommit || ''))) {
    errors.push('releaseCommit must be a 40-character commit SHA')
  }
  if (Object.prototype.hasOwnProperty.call(record, 'sourceCandidate')) {
    validateSourceCandidateObject(record.sourceCandidate, record, errors)
  }
  validateObservedObject(record.ciRun, 'ciRun', 'id', errors)
  validateObservedObject(record.publishRun, 'publishRun', 'id', errors)
  validateObservedObject(record.githubRelease, 'githubRelease', 'tag', errors)
  if (!isIsoTimestamp(record.asOf)) errors.push('asOf must be an ISO timestamp')
  return { valid: errors.length === 0, errors }
}

function parseProfileCurrentTruth(markdown, options = {}) {
  const text = String(markdown || '').replace(/\r\n/g, '\n')
  const headings = [...text.matchAll(/^## ProfileCurrentTruthV1[ \t]*$/gm)]
  const errors = []
  if (headings.length === 0) {
    if (options.required === true) errors.push(`missing ${PROFILE_CURRENT_TRUTH_HEADING}`)
    return { present: false, valid: errors.length === 0, headingCount: 0, record: null, errors }
  }
  if (headings.length !== 1) errors.push(`${PROFILE_CURRENT_TRUTH_HEADING} must appear exactly once`)

  const heading = headings[0]
  const headingLineEnd = text.indexOf('\n', heading.index)
  const afterHeading = headingLineEnd === -1 ? '' : text.slice(headingLineEnd + 1)
  if (!afterHeading.startsWith('```json\n')) {
    errors.push(`${PROFILE_CURRENT_TRUTH_HEADING} must be immediately followed by a strict json fence`)
    return { present: true, valid: false, headingCount: headings.length, record: null, errors }
  }
  const bodyStart = '```json\n'.length
  const closing = afterHeading.slice(bodyStart).match(/\n```(?:\n|$)/)
  if (!closing) {
    errors.push('ProfileCurrentTruthV1 json fence is not closed')
    return { present: true, valid: false, headingCount: headings.length, record: null, errors }
  }
  const jsonText = afterHeading.slice(bodyStart, bodyStart + closing.index)
  let record = null
  try {
    record = JSON.parse(jsonText)
  } catch (error) {
    errors.push(`ProfileCurrentTruthV1 invalid JSON: ${error.message}`)
  }
  if (record) errors.push(...validateTruthRecord(record).errors)
  return {
    present: true,
    valid: errors.length === 0,
    headingCount: headings.length,
    record,
    errors
  }
}

function workflowJobBlock(workflowText, jobId) {
  const text = String(workflowText || '').replace(/\r\n/g, '\n')
  const startPattern = new RegExp(`^  ${jobId}:\\s*$`, 'm')
  const match = startPattern.exec(text)
  if (!match) return ''
  const start = match.index + match[0].length
  const remainder = text.slice(start)
  const next = /^  [A-Za-z0-9_-]+:\s*$/m.exec(remainder)
  return next ? remainder.slice(0, next.index) : remainder
}

function extractWorkflowCurrentTruth(workflowText, validationManifest = null) {
  const plannerDriven = /scripts\/plan-ci-validation\.js/.test(String(workflowText || ''))
  const control = workflowJobBlock(workflowText, 'supported-control-plane')
  const supportedControlPlane = plannerDriven
    ? (validationManifest?.ciCompatibilityMatrix || []).map(item => ({
        os: String(item.os || ''),
        node: String(item.node || ''),
        route: String(item.command || '')
      }))
    : []
  if (!plannerDriven) {
    const lanePattern = /^\s*- os:\s*(\S+)\s*\n\s*node:\s*(\S+)\s*\n\s*route:\s*(\S+)\s*$/gm
    for (const match of control.matchAll(lanePattern)) {
      supportedControlPlane.push({ os: match[1], node: match[2], route: match[3] })
    }
  }

  const jobIdentity = jobId => {
    const block = workflowJobBlock(workflowText, jobId)
    const os = /^\s* runs-on:\s*(\S+)\s*$/m.exec(block)?.[1] ||
      /^\s*runs-on:\s*(\S+)\s*$/m.exec(block)?.[1] || ''
    const node = /^\s*node-version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(block)?.[1] || ''
    return { os, node }
  }

  return {
    supportedControlPlane,
    fullQuality: jobIdentity('full-quality'),
    packageBoundary: jobIdentity(plannerDriven ? 'package-boundary' : 'website-package')
  }
}

function normalizeCiMatrix(value) {
  if (!isPlainObject(value)) return null
  return {
    supportedControlPlane: Array.isArray(value.supportedControlPlane)
      ? value.supportedControlPlane.map(item => ({
          os: String(item?.os || ''),
          node: String(item?.node || ''),
          route: String(item?.route || '')
        }))
      : [],
    fullQuality: {
      os: String(value.fullQuality?.os || ''),
      node: String(value.fullQuality?.node || '')
    },
    packageBoundary: {
      os: String(value.packageBoundary?.os || ''),
      node: String(value.packageBoundary?.node || '')
    }
  }
}

function countLiteral(text, literal) {
  return String(text || '').split(literal).length - 1
}

function validateDevCodexCurrentTruth(input = {}) {
  const parsed = parseProfileCurrentTruth(input.releaseProfileText, { required: true })
  const errors = [...parsed.errors]
  const record = parsed.record
  if (record) {
    const released = /^released\b/i.test(record.releaseState)
    const candidate = /^candidate\b/i.test(record.releaseState)
    if (input.packageVersion && record.sourceVersion !== input.packageVersion) {
      errors.push(`sourceVersion drift: ${record.sourceVersion} != ${input.packageVersion}`)
    }
    if (input.gitHead && record.gitHead !== input.gitHead) {
      errors.push(`gitHead drift: ${record.gitHead} != ${input.gitHead}`)
    }
    if (input.requireSourceCandidate === true) {
      if (!/^[0-9a-f]{40}$/i.test(String(record.releaseCommit || ''))) {
        errors.push('releaseCommit is required for the active DevCodex Profile')
      }
      if (!isPlainObject(record.sourceCandidate)) {
        errors.push('sourceCandidate is required for the active DevCodex Profile')
      }
    }
    if (input.candidateId && record.sourceCandidate?.candidateId !== input.candidateId) {
      errors.push(`sourceCandidate.candidateId drift: ${record.sourceCandidate?.candidateId} != ${input.candidateId}`)
    }
    if (!released && !candidate) {
      errors.push(`releaseState must describe a released source or an authorized candidate: ${record.releaseState}`)
    } else if (released) {
      if (input.packageVersion && record.npmLatest !== input.packageVersion) {
        errors.push(`npmLatest drift: ${record.npmLatest} != ${input.packageVersion}`)
      }
      if (record.githubRelease?.tag !== `v${record.sourceVersion}`) {
        errors.push(`githubRelease.tag drift: ${record.githubRelease?.tag} != v${record.sourceVersion}`)
      }
      if (Object.prototype.hasOwnProperty.call(record, 'candidate')) {
        errors.push('released Profile must not retain candidate state')
      }
    } else {
      if (compareSemver(record.sourceVersion, record.npmLatest) <= 0) {
        errors.push(`candidate sourceVersion must be newer than npmLatest: ${record.sourceVersion} <= ${record.npmLatest}`)
      }
      if (record.candidate?.targetVersion !== record.sourceVersion) {
        errors.push(`candidate.targetVersion drift: ${record.candidate?.targetVersion} != ${record.sourceVersion}`)
      }
      if (record.candidate?.targetTag !== `v${record.sourceVersion}`) {
        errors.push(`candidate.targetTag drift: ${record.candidate?.targetTag} != v${record.sourceVersion}`)
      }
      if (record.githubRelease?.tag !== `v${record.npmLatest}`) {
        errors.push(`candidate previous githubRelease.tag drift: ${record.githubRelease?.tag} != v${record.npmLatest}`)
      }
    }
    for (const field of ['ciRun', 'publishRun', 'githubRelease']) {
      const stateLabel = released ? 'active released Profile' : 'previous released distribution'
      if (record[field]?.status !== 'PASS') errors.push(`${field}.status must be PASS for the ${stateLabel}`)
    }
    const expectedMatrix = extractWorkflowCurrentTruth(input.workflowText, input.validationManifest)
    const recordedMatrix = normalizeCiMatrix(record.ciMatrix)
    if (!recordedMatrix) errors.push('ciMatrix is required for the active DevCodex Profile')
    else if (JSON.stringify(recordedMatrix) !== JSON.stringify(expectedMatrix)) {
      errors.push(`ciMatrix drift: ${JSON.stringify(recordedMatrix)} != ${JSON.stringify(expectedMatrix)}`)
    }
  }

  const referenceDocuments = [
    ['04-测试规范.md', input.testProfileText],
    ['07-用户文档与契约规范.md', input.docsProfileText]
  ]
  if (input.overviewProfileText !== undefined) {
    referenceDocuments.unshift(['01-项目信息.md', input.overviewProfileText])
  }
  for (const [label, text] of referenceDocuments) {
    const count = countLiteral(text, PROFILE_CURRENT_TRUTH_REF)
    if (count !== 1) errors.push(`${label} must contain exactly one ${PROFILE_CURRENT_TRUTH_REF}`)
    if (/^## ProfileCurrentTruthV1[ \t]*$/m.test(String(text || ''))) {
      errors.push(`${label} must reference, not duplicate, ProfileCurrentTruthV1`)
    }
  }
  return { valid: errors.length === 0, record, errors }
}

module.exports = {
  PROFILE_CURRENT_TRUTH_HEADING,
  PROFILE_CURRENT_TRUTH_REF,
  PROFILE_CURRENT_TRUTH_SCHEMA,
  SOURCE_CANDIDATE_TRUTH_SCHEMA,
  REQUIRED_FIELDS,
  extractWorkflowCurrentTruth,
  parseProfileCurrentTruth,
  validateDevCodexCurrentTruth,
  validateTruthRecord
}
