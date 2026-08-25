'use strict'

const crypto = require('crypto')
const childProcess = require('child_process')
const fs = require('fs')
const path = require('path')
const {
  CANDIDATE_CLASSIFIER_VERSION,
  buildCandidateReviewBundleReceipt,
  candidateClassifierRuleDigest
} = require('./candidate-review-bundle')

const SUPPORTED_PHASES = Object.freeze(['CP1', 'CP2', 'CP3', 'ECR'])
const DEFAULT_MAX_CANDIDATE_BYTES = 4 * 1024 * 1024
const DEFAULT_MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_UNTRACKED_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_DIRTY_ENTRIES = 4096
const HEX_DIGEST = /^[a-f0-9]{64}$/i
const GIT_OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i

const ACTUAL_CANDIDATE_EVIDENCE_CONTRACT = Object.freeze({
  schemaVersion: 'ActualCandidateEvidenceContractV1',
  receiptSchema: 'ActualCandidateEvidenceReceiptV1',
  classifierReceiptSchema: 'CandidateReviewBundleReceiptV1',
  classifierVersion: CANDIDATE_CLASSIFIER_VERSION,
  supportedPhases: SUPPORTED_PHASES,
  requiredBindings: Object.freeze([
    'candidatePath',
    'candidateDigest',
    'requestedPhase',
    'sourceRoot',
    'sourceHead',
    'dirtyScopeDigest',
    'classifierRuleDigest'
  ]),
  passConditions: Object.freeze([
    'actual-file',
    'git-observed-source-identity',
    'phase-match',
    'review-ready',
    'validation-issues-empty',
    'open-blockers-zero-or-not-applicable',
    'binding-drift-empty'
  ]),
  fixtureOnlyQualifies: false,
  releaseAuthority: false
})

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
  }
  return value
}

function digest(value) {
  const bytes = Buffer.isBuffer(value)
    ? value
    : Buffer.from(typeof value === 'string' ? value : JSON.stringify(stableValue(value)))
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function issue(code, details = {}) {
  return { code, severity: 'BLOCK', ...details }
}

function normalizedPhase(value) {
  const phase = String(value || '').trim().toUpperCase()
  return SUPPORTED_PHASES.includes(phase) ? phase : null
}

function normalizedDigest(value) {
  const digestValue = String(value || '').trim().toLowerCase()
  return HEX_DIGEST.test(digestValue) ? digestValue : null
}

function normalizedSourceHead(value) {
  const sourceHead = String(value || '').trim().toLowerCase()
  return GIT_OBJECT_ID.test(sourceHead) ? sourceHead : null
}

function isWithinRoot(filePath, rootPath) {
  const relative = path.relative(rootPath, filePath)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function pathLooksLikeFixture(filePath) {
  return path.resolve(filePath).split(path.sep).some(segment => segment.toLowerCase() === 'fixtures')
}

function extractCandidateVersion(content) {
  const normalized = String(content || '').replace(/[`_*]/g, '')
  const declared = normalized.match(/(?:^|\n)\s*(?:-\s*)?(?:candidateVersion|ArtifactVersion|版本)\s*[:：]\s*([^\r\n]+?)\s*(?:\r?\n|$)/i)
  if (declared?.[1]) return declared[1].trim()
  return normalized.match(/^\s*#\s+[^\r\n]*\b(v\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?)\b/im)?.[1] || null
}

function extractDeclaredSourceHead(content) {
  const normalized = String(content || '').replace(/[`_*]/g, '')
  const match = normalized.match(
    /(?:^|\n)\s*(?:-\s*)?(?:sourceHead|source\s+(?:HEAD|baseline)|源码基线|源代码基线)\s*[:：=]\s*([a-f0-9]{40}|[a-f0-9]{64})\b/i
  ) || normalized.match(
    /(?:source\s+(?:HEAD|baseline)|源码基线|源代码基线)\s*[:：=]\s*([a-f0-9]{40}|[a-f0-9]{64})\b/i
  )
  return match?.[1]?.toLowerCase() || null
}

function runGit(sourceRoot, args, maxBuffer) {
  return childProcess.execFileSync('git', ['-C', sourceRoot, ...args], {
    encoding: args.includes('-z') ? null : 'utf8',
    windowsHide: true,
    maxBuffer
  })
}

function parsePorcelainEntries(rawStatus) {
  const tokens = rawStatus.toString('utf8').split('\0').filter(Boolean)
  const entries = []
  for (let index = 0; index < tokens.length; index += 1) {
    const record = tokens[index]
    const status = record.slice(0, 2)
    const relativePath = record.slice(3)
    const entry = { status, relativePath, originalPath: null }
    if (/[RC]/.test(status) && index + 1 < tokens.length) entry.originalPath = tokens[++index]
    entries.push(entry)
  }
  return entries
}

/** Collects bounded, Git-observed HEAD and dirty-scope identity without mutating the worktree. */
function collectGitSourceIdentity(sourceRoot, options = {}) {
  if (typeof sourceRoot !== 'string' || !sourceRoot.trim() || !path.isAbsolute(sourceRoot)) {
    throw new Error('sourceRoot must be an absolute Git worktree path')
  }
  const requestedRoot = fs.realpathSync(sourceRoot)
  const maxGitOutputBytes = Number.isInteger(options.maxGitOutputBytes) && options.maxGitOutputBytes > 0
    ? options.maxGitOutputBytes
    : DEFAULT_MAX_GIT_OUTPUT_BYTES
  const maxUntrackedBytes = Number.isInteger(options.maxUntrackedBytes) && options.maxUntrackedBytes > 0
    ? options.maxUntrackedBytes
    : DEFAULT_MAX_UNTRACKED_BYTES
  const maxDirtyEntries = Number.isInteger(options.maxDirtyEntries) && options.maxDirtyEntries > 0
    ? options.maxDirtyEntries
    : DEFAULT_MAX_DIRTY_ENTRIES
  const gitRootText = runGit(requestedRoot, ['rev-parse', '--show-toplevel'], maxGitOutputBytes).trim()
  const gitRoot = fs.realpathSync(gitRootText)
  if (!isWithinRoot(requestedRoot, gitRoot)) throw new Error('sourceRoot is outside the resolved Git worktree')
  const sourceHead = runGit(gitRoot, ['rev-parse', 'HEAD'], maxGitOutputBytes).trim().toLowerCase()
  if (!GIT_OBJECT_ID.test(sourceHead)) throw new Error('Git HEAD is not a supported object id')

  const rawStatus = runGit(gitRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], maxGitOutputBytes)
  const entries = parsePorcelainEntries(rawStatus)
  if (entries.length > maxDirtyEntries) throw new Error(`dirty entry count exceeds ${maxDirtyEntries}`)
  const workingDiff = runGit(gitRoot, ['diff', '--binary', '--no-ext-diff'], maxGitOutputBytes)
  const stagedDiff = runGit(gitRoot, ['diff', '--cached', '--binary', '--no-ext-diff'], maxGitOutputBytes)
  const untracked = entries.filter(entry => entry.status === '??').sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  let untrackedBytes = 0
  const untrackedDigests = []
  for (const entry of untracked) {
    const filePath = path.resolve(gitRoot, entry.relativePath)
    if (!isWithinRoot(filePath, gitRoot)) throw new Error(`untracked path escapes source root: ${entry.relativePath}`)
    const stat = fs.lstatSync(filePath)
    const bytes = stat.isSymbolicLink()
      ? Buffer.from(fs.readlinkSync(filePath), 'utf8')
      : stat.isFile()
          ? fs.readFileSync(filePath)
          : null
    if (!bytes) throw new Error(`untracked path is not a file or symlink: ${entry.relativePath}`)
    untrackedBytes += bytes.length
    if (untrackedBytes > maxUntrackedBytes) throw new Error(`untracked bytes exceed ${maxUntrackedBytes}`)
    untrackedDigests.push({
      relativePath: entry.relativePath.replace(/\\/g, '/'),
      kind: stat.isSymbolicLink() ? 'symlink' : 'file',
      digest: digest(bytes)
    })
  }

  const dirtyHasher = crypto.createHash('sha256')
  dirtyHasher.update('GitDirtyScopeV1\0')
  dirtyHasher.update(rawStatus)
  dirtyHasher.update('\0working-diff\0')
  dirtyHasher.update(workingDiff)
  dirtyHasher.update('\0staged-diff\0')
  dirtyHasher.update(stagedDiff)
  dirtyHasher.update('\0untracked\0')
  dirtyHasher.update(JSON.stringify(untrackedDigests))
  const dirtyScopeDigest = dirtyHasher.digest('hex')
  const stagedEntryCount = entries.filter(entry => ![' ', '?'].includes(entry.status[0])).length
  const worktreeEntryCount = entries.filter(entry => ![' ', '?'].includes(entry.status[1])).length
  const core = {
    schemaVersion: 'GitSourceIdentityV1',
    requestedRoot,
    gitRoot,
    sourceHead,
    dirtyScopeDigest,
    dirtyEntryCount: entries.length,
    stagedEntryCount,
    worktreeEntryCount,
    untrackedEntryCount: untracked.length,
    untrackedBytes
  }
  return { ...core, sourceIdentityDigest: digest(core) }
}

function collectStableGitSourceIdentity(sourceRoot, options = {}) {
  const first = collectGitSourceIdentity(sourceRoot, options)
  const second = collectGitSourceIdentity(sourceRoot, options)
  if (
    first.sourceHead !== second.sourceHead ||
    first.dirtyScopeDigest !== second.dirtyScopeDigest ||
    first.sourceIdentityDigest !== second.sourceIdentityDigest
  ) {
    throw new Error('Git source identity changed during observation')
  }
  return second
}

function readCandidate(candidatePath, options, issues) {
  if (typeof candidatePath !== 'string' || !candidatePath.trim()) {
    issues.push(issue('candidate-path-required'))
    return null
  }
  if (!path.isAbsolute(candidatePath)) {
    issues.push(issue('candidate-path-not-absolute', { candidatePath }))
    return null
  }

  const logicalPath = path.resolve(candidatePath)
  let stat
  let realPath
  try {
    stat = fs.statSync(logicalPath)
    realPath = fs.realpathSync(logicalPath)
  } catch (error) {
    issues.push(issue('candidate-file-unreadable', { candidatePath: logicalPath, message: error.message }))
    return null
  }
  if (!stat.isFile()) {
    issues.push(issue('candidate-not-ordinary-file', { candidatePath: logicalPath }))
    return null
  }

  const maxBytes = Number.isInteger(options.maxCandidateBytes) && options.maxCandidateBytes > 0
    ? options.maxCandidateBytes
    : DEFAULT_MAX_CANDIDATE_BYTES
  if (stat.size > maxBytes) {
    issues.push(issue('candidate-size-limit-exceeded', { actualBytes: stat.size, maxBytes }))
    return null
  }

  const allowedRoots = Array.isArray(options.allowedRoots)
    ? options.allowedRoots.filter(item => typeof item === 'string' && item.trim()).map(item => path.resolve(item))
    : []
  if (allowedRoots.length && !allowedRoots.some(root => isWithinRoot(realPath, root))) {
    issues.push(issue('candidate-outside-allowed-root', { candidatePath: logicalPath, realPath }))
  }

  try {
    const bytes = fs.readFileSync(realPath)
    return {
      logicalPath,
      realPath,
      bytes,
      content: bytes.toString('utf8'),
      size: bytes.length
    }
  } catch (error) {
    issues.push(issue('candidate-file-unreadable', { candidatePath: logicalPath, message: error.message }))
    return null
  }
}

/** Reads and qualifies one exact CP/ECR candidate against an observed source identity. */
function buildActualCandidateEvidenceReceipt(options = {}) {
  const issues = []
  const requestedPhase = normalizedPhase(options.requestedPhase || options.phaseKind)
  const classifierRuleDigest = candidateClassifierRuleDigest()
  let sourceIdentity = null

  try {
    sourceIdentity = collectStableGitSourceIdentity(options.sourceRoot, options)
  } catch (error) {
    issues.push(issue('source-identity-unavailable', { message: error.message }))
  }
  const sourceHead = sourceIdentity?.sourceHead || null
  const dirtyScopeDigest = sourceIdentity?.dirtyScopeDigest || null

  if (!requestedPhase) issues.push(issue('requested-phase-invalid', { actual: options.requestedPhase || options.phaseKind || null }))

  const candidate = readCandidate(options.candidatePath, options, issues)
  const fixtureOnly = options.fixtureOnly === true || (candidate ? pathLooksLikeFixture(candidate.logicalPath) : false)
  if (fixtureOnly) issues.push(issue('fixture-only-evidence'))

  const candidateDigest = candidate ? digest(candidate.bytes) : null
  const expectedCandidateDigest = options.expectedCandidateDigest == null
    ? null
    : normalizedDigest(options.expectedCandidateDigest)
  const suppliedExpectedSourceHead = options.expectedSourceHead ?? options.sourceHead
  const suppliedExpectedDirtyScopeDigest = options.expectedDirtyScopeDigest ?? options.dirtyScopeDigest
  const expectedSourceHead = suppliedExpectedSourceHead == null
    ? null
    : normalizedSourceHead(suppliedExpectedSourceHead)
  const expectedDirtyScopeDigest = suppliedExpectedDirtyScopeDigest == null
    ? null
    : normalizedDigest(suppliedExpectedDirtyScopeDigest)
  const expectedClassifierRuleDigest = options.expectedClassifierRuleDigest == null
    ? null
    : normalizedDigest(options.expectedClassifierRuleDigest)

  if (options.expectedCandidateDigest != null && !expectedCandidateDigest) {
    issues.push(issue('expected-candidate-digest-invalid'))
  } else if (expectedCandidateDigest && candidateDigest !== expectedCandidateDigest) {
    issues.push(issue('candidate-digest-mismatch', { expected: expectedCandidateDigest, actual: candidateDigest }))
  }
  if (suppliedExpectedSourceHead != null && !expectedSourceHead) {
    issues.push(issue('expected-source-head-invalid'))
  } else if (expectedSourceHead && sourceHead !== expectedSourceHead) {
    issues.push(issue('source-head-mismatch', { expected: expectedSourceHead, actual: sourceHead }))
  }
  if (suppliedExpectedDirtyScopeDigest != null && !expectedDirtyScopeDigest) {
    issues.push(issue('expected-dirty-scope-digest-invalid'))
  } else if (expectedDirtyScopeDigest && dirtyScopeDigest !== expectedDirtyScopeDigest) {
    issues.push(issue('dirty-scope-digest-mismatch', { expected: expectedDirtyScopeDigest, actual: dirtyScopeDigest }))
  }
  if (options.expectedClassifierRuleDigest != null && !expectedClassifierRuleDigest) {
    issues.push(issue('expected-classifier-rule-digest-invalid'))
  } else if (expectedClassifierRuleDigest && classifierRuleDigest !== expectedClassifierRuleDigest) {
    issues.push(issue('classifier-rule-digest-mismatch', { expected: expectedClassifierRuleDigest, actual: classifierRuleDigest }))
  }

  let candidateReviewReceipt = null
  let candidateVersion = null
  let declaredSourceHead = null
  if (candidate && requestedPhase) {
    candidateVersion = extractCandidateVersion(candidate.content)
    declaredSourceHead = extractDeclaredSourceHead(candidate.content)
    candidateReviewReceipt = buildCandidateReviewBundleReceipt(candidate.content, { phase: requestedPhase })
    const candidatePhases = [...new Set(
      candidateReviewReceipt.phaseSources.filter(item => item.source !== 'option').map(item => item.phase)
    )]
    if (candidateReviewReceipt.phase !== requestedPhase || candidatePhases.some(phase => phase !== requestedPhase)) {
      issues.push(issue('candidate-phase-mismatch', {
        expected: requestedPhase,
        actual: candidatePhases.length ? candidatePhases : candidateReviewReceipt.phase,
        sources: candidateReviewReceipt.phaseSources
      }))
    }
    if (declaredSourceHead && sourceHead && declaredSourceHead !== sourceHead) {
      issues.push(issue('candidate-source-head-mismatch', { expected: declaredSourceHead, actual: sourceHead }))
    }
    if (requestedPhase === 'ECR' && !declaredSourceHead) {
      issues.push(issue('candidate-source-head-missing'))
    }
    if (!candidateReviewReceipt.passed || candidateReviewReceipt.validationIssues.length || candidateReviewReceipt.missingFields.length) {
      issues.push(issue('candidate-review-not-ready', {
        classification: candidateReviewReceipt.classification,
        missingFields: candidateReviewReceipt.missingFields,
        validationIssues: candidateReviewReceipt.validationIssues
      }))
    }
    if (Number.isFinite(candidateReviewReceipt.openBlockers) && candidateReviewReceipt.openBlockers > 0) {
      issues.push(issue('candidate-open-blockers', { openBlockers: candidateReviewReceipt.openBlockers }))
    }
  }

  const generatedAt = options.generatedAt || new Date().toISOString()
  const core = {
    schemaVersion: 'ActualCandidateEvidenceReceiptV1',
    gate: 'ActualCandidateEvidenceGateV1',
    candidatePath: candidate?.logicalPath || (typeof options.candidatePath === 'string' ? options.candidatePath : null),
    candidateRealPath: candidate?.realPath || null,
    candidateDigest,
    candidateBytes: candidate?.size ?? null,
    candidateVersion,
    requestedPhase,
    detectedPhase: candidateReviewReceipt?.phase || null,
    sourceRoot: sourceIdentity?.gitRoot || null,
    sourceHead,
    declaredSourceHead,
    dirtyScopeDigest,
    sourceIdentity,
    sourceIdentityMode: sourceIdentity ? 'git-observed' : 'unavailable',
    sourceIdentityObservationCount: sourceIdentity ? 2 : 0,
    classifierVersion: CANDIDATE_CLASSIFIER_VERSION,
    classifierRuleDigest,
    candidateReviewReceipt,
    fixtureOnly,
    actualPathEvidence: Boolean(candidate),
    releaseAuthority: false,
    generatedAt,
    issues,
    passed: issues.length === 0
  }
  return { ...core, receiptDigest: digest(core) }
}

/** Validates receipt structure and internal semantic bindings without trusting its pass flag. */
function validateActualCandidateEvidenceReceipt(receipt) {
  const issues = []
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return { valid: false, issues: [issue('receipt-object-required')] }
  }
  if (receipt.schemaVersion !== 'ActualCandidateEvidenceReceiptV1') issues.push(issue('receipt-schema-invalid'))
  if (receipt.gate !== 'ActualCandidateEvidenceGateV1') issues.push(issue('receipt-gate-invalid'))
  if (receipt.requestedPhase != null && !normalizedPhase(receipt.requestedPhase)) issues.push(issue('receipt-phase-invalid'))
  if (receipt.candidatePath != null && !path.isAbsolute(String(receipt.candidatePath))) issues.push(issue('receipt-candidate-path-invalid'))
  if (!normalizedDigest(receipt.classifierRuleDigest)) issues.push(issue('receipt-classifier-rule-digest-invalid'))
  if (typeof receipt.fixtureOnly !== 'boolean') issues.push(issue('receipt-fixture-state-invalid'))
  if (typeof receipt.actualPathEvidence !== 'boolean') issues.push(issue('receipt-actual-path-state-invalid'))
  if (receipt.releaseAuthority !== false) issues.push(issue('receipt-release-authority-invalid'))
  const recordedIssues = Array.isArray(receipt.issues) ? receipt.issues : []
  const recordedIssueCodes = new Set(recordedIssues.map(item => item?.code).filter(Boolean))
  if (!Array.isArray(receipt.issues) || recordedIssues.some(item => !item || typeof item.code !== 'string' || item.severity !== 'BLOCK')) {
    issues.push(issue('receipt-issues-invalid'))
  }

  if (receipt.sourceIdentityMode === 'git-observed') {
    if (!path.isAbsolute(String(receipt.sourceRoot || ''))) issues.push(issue('receipt-source-root-invalid'))
    if (!normalizedSourceHead(receipt.sourceHead)) issues.push(issue('receipt-source-head-invalid'))
    if (!normalizedDigest(receipt.dirtyScopeDigest)) issues.push(issue('receipt-dirty-scope-digest-invalid'))
    if (receipt.sourceIdentityObservationCount !== 2) issues.push(issue('receipt-source-identity-observations-invalid'))
    const { sourceIdentityDigest, ...sourceIdentityCore } = receipt.sourceIdentity || {}
    if (
      receipt.sourceIdentity?.schemaVersion !== 'GitSourceIdentityV1' ||
      receipt.sourceIdentity?.sourceHead !== receipt.sourceHead ||
      receipt.sourceIdentity?.dirtyScopeDigest !== receipt.dirtyScopeDigest ||
      !normalizedDigest(sourceIdentityDigest) ||
      sourceIdentityDigest !== digest(sourceIdentityCore)
    ) {
      issues.push(issue('receipt-source-identity-invalid'))
    }
  } else if (receipt.sourceIdentityMode !== 'unavailable' || !recordedIssueCodes.has('source-identity-unavailable')) {
    issues.push(issue('receipt-source-identity-state-invalid'))
  }

  if (receipt.actualPathEvidence === true) {
    if (!path.isAbsolute(String(receipt.candidatePath || ''))) issues.push(issue('receipt-candidate-path-invalid'))
    if (!path.isAbsolute(String(receipt.candidateRealPath || ''))) issues.push(issue('receipt-candidate-real-path-invalid'))
    if (!normalizedDigest(receipt.candidateDigest)) issues.push(issue('receipt-candidate-digest-invalid'))
    if (!Number.isInteger(receipt.candidateBytes) || receipt.candidateBytes < 0) issues.push(issue('receipt-candidate-bytes-invalid'))
    if (
      receipt.candidateReviewReceipt?.schemaVersion !== 'CandidateReviewBundleReceiptV1' &&
      !recordedIssueCodes.has('requested-phase-invalid')
    ) {
      issues.push(issue('receipt-candidate-review-missing'))
    } else if (receipt.candidateReviewReceipt.classifierRuleDigest !== receipt.classifierRuleDigest) {
      issues.push(issue('receipt-classifier-binding-mismatch'))
    }
  } else if (!recordedIssues.some(item => /^candidate-(?:path|required|file|not|size)/.test(item.code))) {
    issues.push(issue('receipt-missing-candidate-state-unexplained'))
  }

  const reviewNotReady = receipt.candidateReviewReceipt && (
    receipt.candidateReviewReceipt.classification !== 'review-ready' ||
    receipt.candidateReviewReceipt.passed !== true ||
    receipt.candidateReviewReceipt.missingFields?.length > 0 ||
    receipt.candidateReviewReceipt.validationIssues?.length > 0
  )
  if (reviewNotReady && !recordedIssueCodes.has('candidate-review-not-ready')) {
    issues.push(issue('receipt-review-failure-unexplained'))
  }
  const candidatePhases = [...new Set(
    (receipt.candidateReviewReceipt?.phaseSources || [])
      .filter(item => item.source !== 'option')
      .map(item => item.phase)
  )]
  if (
    candidatePhases.some(phase => phase !== receipt.requestedPhase) &&
    !recordedIssueCodes.has('candidate-phase-mismatch')
  ) {
    issues.push(issue('receipt-phase-mismatch-unexplained'))
  }
  if (
    receipt.declaredSourceHead &&
    receipt.sourceHead &&
    receipt.declaredSourceHead !== receipt.sourceHead &&
    !recordedIssueCodes.has('candidate-source-head-mismatch')
  ) {
    issues.push(issue('receipt-source-head-mismatch-unexplained'))
  }
  if (
    receipt.requestedPhase === 'ECR' &&
    !receipt.declaredSourceHead &&
    !recordedIssueCodes.has('candidate-source-head-missing')
  ) {
    issues.push(issue('receipt-ecr-source-head-missing-unexplained'))
  }
  if (
    Number.isFinite(receipt.candidateReviewReceipt?.openBlockers) &&
    receipt.candidateReviewReceipt.openBlockers > 0 &&
    !recordedIssueCodes.has('candidate-open-blockers')
  ) {
    issues.push(issue('receipt-open-blockers-unexplained'))
  }
  if (receipt.fixtureOnly === true && !recordedIssueCodes.has('fixture-only-evidence')) {
    issues.push(issue('receipt-fixture-state-unexplained'))
  }
  const { receiptDigest, ...core } = receipt
  if (!normalizedDigest(receiptDigest) || receiptDigest !== digest(core)) issues.push(issue('receipt-digest-mismatch'))
  const expectedPass = Array.isArray(receipt.issues) && receipt.issues.length === 0 &&
    receipt.candidateReviewReceipt?.classification === 'review-ready' &&
    receipt.candidateReviewReceipt?.passed === true &&
    receipt.sourceIdentityMode === 'git-observed' &&
    receipt.fixtureOnly === false && receipt.actualPathEvidence === true
  if (receipt.passed !== expectedPass) issues.push(issue('receipt-pass-state-mismatch'))
  return { valid: issues.length === 0, issues }
}

/** Replays candidate, classifier and Git identity readback to decide whether a receipt is fresh. */
function verifyActualCandidateEvidenceReceipt(receipt, binding = {}) {
  const issues = [...validateActualCandidateEvidenceReceipt(receipt).issues]
  if (!receipt || typeof receipt !== 'object') return { fresh: false, status: 'stale', issues }

  const expectedReceiptDigest = binding.expectedReceiptDigest == null
    ? null
    : normalizedDigest(binding.expectedReceiptDigest)
  if (binding.expectedReceiptDigest != null && !expectedReceiptDigest) {
    issues.push(issue('expected-receipt-digest-invalid'))
  } else if (expectedReceiptDigest && receipt.receiptDigest !== expectedReceiptDigest) {
    issues.push(issue('confirmation-receipt-digest-mismatch', { expected: expectedReceiptDigest, actual: receipt.receiptDigest }))
  }

  const checks = [
    ['requestedPhase', normalizedPhase(binding.requestedPhase)],
    ['sourceHead', normalizedSourceHead(binding.sourceHead)],
    ['dirtyScopeDigest', normalizedDigest(binding.dirtyScopeDigest)]
  ]
  for (const [field, expected] of checks) {
    if (binding[field] != null && !expected) issues.push(issue(`verification-${field}-invalid`))
    else if (expected && receipt[field] !== expected) issues.push(issue(`verification-${field}-mismatch`, { expected, actual: receipt[field] }))
  }

  const liveRuleDigest = candidateClassifierRuleDigest()
  if (receipt.classifierRuleDigest !== liveRuleDigest) {
    issues.push(issue('classifier-rule-drift', { expected: receipt.classifierRuleDigest, actual: liveRuleDigest }))
  }

  if (receipt.sourceRoot) {
    try {
      const liveSourceIdentity = collectStableGitSourceIdentity(receipt.sourceRoot, binding)
      if (liveSourceIdentity.sourceHead !== receipt.sourceHead) {
        issues.push(issue('source-head-drift', { expected: receipt.sourceHead, actual: liveSourceIdentity.sourceHead }))
      }
      if (liveSourceIdentity.dirtyScopeDigest !== receipt.dirtyScopeDigest) {
        issues.push(issue('dirty-scope-drift', { expected: receipt.dirtyScopeDigest, actual: liveSourceIdentity.dirtyScopeDigest }))
      }
      if (liveSourceIdentity.sourceIdentityDigest !== receipt.sourceIdentity?.sourceIdentityDigest) {
        issues.push(issue('source-identity-drift'))
      }
    } catch (error) {
      issues.push(issue('source-identity-readback-failed', { message: error.message }))
    }
  }

  if (receipt.candidateRealPath) {
    try {
      const realPath = fs.realpathSync(receipt.candidatePath)
      const bytes = fs.readFileSync(realPath)
      const liveDigest = digest(bytes)
      if (realPath !== receipt.candidateRealPath) issues.push(issue('candidate-real-path-drift', { expected: receipt.candidateRealPath, actual: realPath }))
      if (liveDigest !== receipt.candidateDigest) issues.push(issue('candidate-content-drift', { expected: receipt.candidateDigest, actual: liveDigest }))
      const liveReview = buildCandidateReviewBundleReceipt(bytes.toString('utf8'), { phase: receipt.requestedPhase })
      if (digest(liveReview) !== digest(receipt.candidateReviewReceipt)) issues.push(issue('candidate-review-receipt-drift'))
    } catch (error) {
      issues.push(issue('candidate-readback-failed', { message: error.message }))
    }
  }
  if (receipt.passed !== true) issues.push(issue('receipt-not-passing'))

  return {
    schemaVersion: 'ActualCandidateEvidenceVerificationV1',
    receiptDigest: receipt.receiptDigest || null,
    fresh: issues.length === 0,
    status: issues.length ? 'stale' : 'fresh',
    issues
  }
}

/** Projects only a freshly replayed passing receipt into a digest-bound confirmation record. */
function buildCandidateConfirmationBinding(receipt) {
  const verification = verifyActualCandidateEvidenceReceipt(receipt)
  const qualified = verification.fresh && receipt?.passed === true
  return {
    schemaVersion: 'ActualCandidateConfirmationBindingV1',
    phaseKind: receipt?.requestedPhase || null,
    artifactPath: receipt?.candidatePath || null,
    artifactDigest: receipt?.candidateDigest || null,
    receiptDigest: receipt?.receiptDigest || null,
    sourceHead: receipt?.sourceHead || null,
    dirtyScopeDigest: receipt?.dirtyScopeDigest || null,
    classifierRuleDigest: receipt?.classifierRuleDigest || null,
    qualified,
    issues: qualified ? [] : verification.issues
  }
}

module.exports = {
  ACTUAL_CANDIDATE_EVIDENCE_CONTRACT,
  DEFAULT_MAX_CANDIDATE_BYTES,
  DEFAULT_MAX_DIRTY_ENTRIES,
  DEFAULT_MAX_GIT_OUTPUT_BYTES,
  DEFAULT_MAX_UNTRACKED_BYTES,
  SUPPORTED_PHASES,
  buildActualCandidateEvidenceReceipt,
  buildCandidateConfirmationBinding,
  collectGitSourceIdentity,
  digest,
  validateActualCandidateEvidenceReceipt,
  verifyActualCandidateEvidenceReceipt
}
