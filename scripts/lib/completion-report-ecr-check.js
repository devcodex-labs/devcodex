'use strict'

/**
 * Dual-Track Closure M2 (PI-154 / PF-173): recent completed dev/fix reports must
 * show substance ECR evidence — not checkbox-only "ECR ✅".
 * Offline validate probe (P3). Does not hard-block live Grok turns.
 */

const fs = require('fs')
const path = require('path')
const { resolveRuntimeStateRoots } = require('../../hooks/_runtime/workspace-layout.cjs')
const {
  createCommitValidationResult,
  createWorkflowCompletionCommit,
  projectWorkflowCompletion,
  validateWorkflowCompletionSnapshot
} = require('../../hooks/_runtime/workflow-completion-contract.cjs')
const { buildContentIdentity, sha256, stableStringify } = require('../../hooks/_runtime/content-identity.cjs')
const { retryTransientWindowsFs } = require('../../hooks/_runtime/windows-fs-retry.cjs')

const RECENT_COMPLETION_REPORT_DAYS = 2
const REPORT_NAME_RE = /\.md$/i
const SKIP_DIR_RE = /(?:^|[\\/])(?:node_modules|\.git|website[\\/]node_modules)(?:[\\/]|$)/i
const REPORT_REF_PREFIX = '<!-- DEVCODEX-WORKFLOW-COMPLETION-REF '
const MEMORY_REF_PREFIX = '<!-- DEVCODEX-WORKFLOW-COMPLETION-MEMORY-REF '
const SENTINEL_SUFFIX = ' -->'
const CANDIDATE_ID_RE = /^workflow-candidate-[a-f0-9]{64}$/
const DIGEST_RE = /^[a-f0-9]{64}$/
const MAX_DERIVED_FILES = 100
const MAX_DERIVED_BYTES = 4 * 1024 * 1024

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function reportRefValidationErrors(ref) {
  const errors = []
  const keys = ref && typeof ref === 'object' && !Array.isArray(ref) ? Object.keys(ref).sort() : []
  if (ref?.schemaVersion !== 'WorkflowCompletionReportRefV1') errors.push('report-ref-schema-invalid')
  if (!CANDIDATE_ID_RE.test(ref?.candidateId || '')) errors.push('report-ref-candidate-invalid')
  if (!DIGEST_RE.test(ref?.coreSnapshotDigest || '')) errors.push('report-ref-snapshot-digest-invalid')
  if (typeof ref?.sidecarPath !== 'string' || !/^[^\r\n]+\.completion\.json$/.test(ref.sidecarPath)) errors.push('report-ref-sidecar-invalid')
  if (keys.join(',') !== ['candidateId', 'coreSnapshotDigest', 'schemaVersion', 'sidecarPath'].join(',')) errors.push('report-ref-fields-invalid')
  return errors
}

function formatWorkflowCompletionReportRef(ref) {
  const errors = reportRefValidationErrors(ref)
  if (errors.length) throw Object.assign(new Error(errors.join('; ')), { code: 'WORKFLOW_REPORT_REF_INVALID', details: errors })
  return `${REPORT_REF_PREFIX}${stableStringify(ref)}${SENTINEL_SUFFIX}`
}

function formatWorkflowCompletionMemoryRef(ref) {
  if (ref?.schemaVersion !== 'WorkflowCompletionMemoryRefV1' || !CANDIDATE_ID_RE.test(ref?.candidateId || '') ||
      !DIGEST_RE.test(ref?.coreSnapshotDigest || '') || !['task', 'daily', 'summary'].includes(ref?.memoryKind) ||
      typeof ref?.sidecarPath !== 'string' || !ref.sidecarPath.endsWith('.completion.json') || !ref?.contentIdentity) {
    throw Object.assign(new Error('workflow completion memory ref is invalid'), { code: 'WORKFLOW_MEMORY_REF_INVALID' })
  }
  return `${MEMORY_REF_PREFIX}${stableStringify(ref)}${SENTINEL_SUFFIX}`
}

function parseSentinel(text, prefix) {
  const lines = String(text || '').split(/\r?\n/).filter(line => line.startsWith(prefix) && line.endsWith(SENTINEL_SUFFIX))
  if (lines.length === 0) return { status: 'missing', value: null, errors: [] }
  if (lines.length !== 1) return { status: 'invalid', value: null, errors: ['sentinel-cardinality-invalid'] }
  try {
    return { status: 'present', value: JSON.parse(lines[0].slice(prefix.length, -SENTINEL_SUFFIX.length)), errors: [] }
  } catch {
    return { status: 'invalid', value: null, errors: ['sentinel-json-invalid'] }
  }
}

function parseWorkflowCompletionReportRef(text) {
  const parsed = parseSentinel(text, REPORT_REF_PREFIX)
  if (parsed.status !== 'present') return parsed
  const errors = reportRefValidationErrors(parsed.value)
  return errors.length ? { status: 'invalid', value: null, errors } : parsed
}

function resolveSidecarPath(activeRoot, reportPath, sidecarPath) {
  if (path.isAbsolute(sidecarPath) || sidecarPath.split(/[\\/]/).includes('..')) {
    throw Object.assign(new Error('completion sidecar path escaped the report directory'), { code: 'WORKFLOW_SIDECAR_PATH_UNSAFE' })
  }
  const resolvedReport = path.resolve(reportPath)
  const resolved = path.resolve(path.dirname(resolvedReport), sidecarPath)
  if (!isInside(activeRoot, resolved) || resolved !== path.resolve(`${resolvedReport}.completion.json`)) {
    throw Object.assign(new Error('completion sidecar must be <report>.completion.json below active-root'), { code: 'WORKFLOW_SIDECAR_PATH_UNSAFE' })
  }
  const realParent = fs.realpathSync(path.dirname(resolved))
  if (!isInside(fs.realpathSync(activeRoot), realParent)) {
    throw Object.assign(new Error('completion sidecar parent resolves outside active-root'), { code: 'WORKFLOW_SIDECAR_SYMLINK_UNSAFE' })
  }
  return resolved
}

function readJsonBounded(filePath, maxBytes = 512 * 1024) {
  const stats = fs.statSync(filePath)
  if (!stats.isFile() || stats.size > maxBytes) throw Object.assign(new Error(`JSON evidence exceeds ${maxBytes} bytes`), { code: 'WORKFLOW_EVIDENCE_CAPACITY_EXCEEDED' })
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function validateCommittedMemoryRefs(activeRoot, commit) {
  const errors = []
  const root = path.resolve(activeRoot)
  const realRoot = fs.realpathSync(root)
  const refs = Array.isArray(commit?.memoryReceiptRefs) ? commit.memoryReceiptRefs : []
  if (!refs.length || refs.length > MAX_DERIVED_FILES) return { valid: false, errors: ['memory-ref-count-invalid'] }
  let totalBytes = 0
  for (const ref of refs) {
    const prefix = 'memory:'
    const memoryPath = String(ref?.evidenceRef || '').startsWith(prefix) ? path.resolve(String(ref.evidenceRef).slice(prefix.length)) : ''
    if (!memoryPath || !isInside(root, memoryPath)) {
      errors.push('memory-ref-path-unsafe')
      continue
    }
    let content
    try {
      const stats = fs.statSync(memoryPath)
      if (!stats.isFile()) throw new Error('memory ref is not a file')
      totalBytes += stats.size
      if (totalBytes > MAX_DERIVED_BYTES) throw new Error('memory refs exceed capacity')
      if (!isInside(realRoot, fs.realpathSync(memoryPath))) throw new Error('memory ref resolves outside active-root')
      content = fs.readFileSync(memoryPath)
    } catch (error) {
      errors.push(`memory-ref-read-failed:${error.message}`)
      continue
    }
    const identity = buildContentIdentity({ sourceKey: memoryPath, content, contractVersion: '1' })
    if (identity.digest !== ref.digest) errors.push(`memory-ref-digest-mismatch:${memoryPath}`)
  }
  return { valid: errors.length === 0, errors }
}

function findSnapshot(activeRoot, ref, suppliedSnapshot = null) {
  if (suppliedSnapshot) return suppliedSnapshot
  for (const runtimeRoot of resolveRuntimeStateRoots(activeRoot).readRoots) {
    const stateRoot = path.join(runtimeRoot, 'workflow-completion')
    if (!fs.existsSync(stateRoot)) continue
    const files = fs.readdirSync(stateRoot).filter(file => file.endsWith('.json')).sort().slice(0, MAX_DERIVED_FILES)
    let totalBytes = 0
    for (const file of files) {
      const filePath = path.join(stateRoot, file)
      const stats = fs.statSync(filePath)
      totalBytes += stats.size
      if (totalBytes > MAX_DERIVED_BYTES) return null
      let value
      try { value = readJsonBounded(filePath) } catch { continue }
      const snapshots = [value.current, value.previous].filter(Boolean)
      const match = snapshots.find(item => item.candidateId === ref.candidateId && item.coreSnapshotDigest === ref.coreSnapshotDigest)
      if (match) return match
    }
  }
  return null
}

function completionResolution(status, reportPath, details = {}) {
  return { schemaVersion: 'WorkflowCompletionReportResolutionV1', status, reportPath: path.resolve(reportPath), ...details }
}

function resolveWorkflowCompletionReport({ activeRoot, reportPath, snapshot = null, deliveryAttempt = null, nowMs = Date.now() }) {
  let reportContent
  try { reportContent = fs.readFileSync(reportPath, 'utf8') } catch (error) {
    return completionResolution('UNVERIFIED', reportPath, { errorCode: 'WORKFLOW_REPORT_READ_FAILED', errors: [error.message], projection: null })
  }
  const parsed = parseWorkflowCompletionReportRef(reportContent)
  if (parsed.status === 'missing') return completionResolution('UNVERIFIED', reportPath, { legacy: true, errorCode: 'WORKFLOW_REPORT_REF_MISSING', errors: [], projection: null })
  if (parsed.status === 'invalid') return completionResolution('UNVERIFIED', reportPath, { legacy: false, errorCode: 'WORKFLOW_REPORT_REF_INVALID', errors: parsed.errors, projection: null })
  const ref = parsed.value
  let sidecarPath
  try { sidecarPath = resolveSidecarPath(activeRoot, reportPath, ref.sidecarPath) } catch (error) {
    return completionResolution('UNVERIFIED', reportPath, { ref, errorCode: error.code, errors: [error.message], projection: null })
  }
  const coreSnapshot = findSnapshot(activeRoot, ref, snapshot)
  const snapshotCheck = validateWorkflowCompletionSnapshot(coreSnapshot)
  if (!snapshotCheck.valid || coreSnapshot?.candidateId !== ref.candidateId || coreSnapshot?.coreSnapshotDigest !== ref.coreSnapshotDigest) {
    return completionResolution('UNVERIFIED', reportPath, { ref, sidecarPath, errorCode: 'WORKFLOW_CORE_SNAPSHOT_INVALID', errors: snapshotCheck.errors, projection: null })
  }
  if (!fs.existsSync(sidecarPath)) {
    const validation = createCommitValidationResult(null, { snapshot: coreSnapshot, deliveryAttempt, now: nowMs })
    const projection = projectWorkflowCompletion(coreSnapshot, validation, { generatedAt: new Date(nowMs).toISOString(), now: nowMs })
    return completionResolution('UNVERIFIED', reportPath, {
      ref, sidecarPath,
      errorCode: projection.completionPhase === 'commit-failed' ? 'WORKFLOW_COMMIT_FAILED' : 'WORKFLOW_COMMIT_NOT_ATTEMPTED',
      errors: [], projection
    })
  }
  let commit
  try { commit = readJsonBounded(sidecarPath) } catch (error) {
    return completionResolution('UNVERIFIED', reportPath, { ref, sidecarPath, errorCode: error.code || 'WORKFLOW_SIDECAR_INVALID', errors: [error.message], projection: null })
  }
  const memoryValidation = validateCommittedMemoryRefs(activeRoot, commit)
  if (!memoryValidation.valid) {
    return completionResolution('UNVERIFIED', reportPath, { ref, sidecarPath, commit, errorCode: 'WORKFLOW_MEMORY_READBACK_INVALID', errors: memoryValidation.errors, projection: null })
  }
  const validation = createCommitValidationResult(commit, { snapshot: coreSnapshot, reportContent, now: nowMs })
  if (validation.state !== 'valid') {
    const failedValidation = createCommitValidationResult(commit, { snapshot: coreSnapshot, reportContent, deliveryAttempt, now: nowMs })
    const projection = projectWorkflowCompletion(coreSnapshot, failedValidation, { generatedAt: new Date(nowMs).toISOString(), now: nowMs })
    return completionResolution('UNVERIFIED', reportPath, {
      ref, sidecarPath, commit,
      errorCode: projection.completionPhase === 'commit-failed' ? 'WORKFLOW_COMMIT_FAILED' : 'WORKFLOW_COMMIT_INVALID',
      errors: failedValidation.validation.errors,
      projection
    })
  }
  const projection = projectWorkflowCompletion(coreSnapshot, validation, { generatedAt: new Date(nowMs).toISOString(), now: nowMs })
  const enforceFalseGreen = coreSnapshot.rollout.mode === 'enforce-candidate' && looksLikeDevFixCompletionReport(reportContent, reportPath) &&
    (!projection.workflowComplete || !projection.deliveryCommitted)
  return completionResolution(enforceFalseGreen ? 'BLOCK' : projection.workflowEvidenceState, reportPath, {
    ref, sidecarPath, commit, projection,
    errorCode: enforceFalseGreen ? 'WORKFLOW_COMPLETION_CLAIM_INVALID' : null,
    errors: enforceFalseGreen ? ['completed-report-requires-valid-complete-commit'] : []
  })
}

function createWorkflowCompletionReportRef(snapshot, reportPath) {
  const check = validateWorkflowCompletionSnapshot(snapshot)
  if (!check.valid) throw Object.assign(new Error('workflow snapshot is invalid'), { code: 'WORKFLOW_CORE_SNAPSHOT_INVALID', details: check.errors })
  return Object.freeze({
    schemaVersion: 'WorkflowCompletionReportRefV1',
    candidateId: snapshot.candidateId,
    coreSnapshotDigest: snapshot.coreSnapshotDigest,
    sidecarPath: `${path.basename(reportPath)}.completion.json`
  })
}

function commitWorkflowCompletionDelivery({
  reportPath,
  memoryPaths,
  artifactManifestEntries,
  snapshot,
  createdAt,
  activeRoot,
  fs: lockFs = fs,
  platform,
  windowsFsRetryMaxAttempts,
  windowsFsRetryDelayMs
}) {
  const lockRetryOptions = {
    platform,
    maxAttempts: windowsFsRetryMaxAttempts,
    delayMs: windowsFsRetryDelayMs
  }
  const reportContent = fs.readFileSync(reportPath, 'utf8')
  const parsed = parseWorkflowCompletionReportRef(reportContent)
  if (parsed.status !== 'present' || parsed.value.candidateId !== snapshot.candidateId || parsed.value.coreSnapshotDigest !== snapshot.coreSnapshotDigest) {
    throw Object.assign(new Error('report prepared ref does not match the completion snapshot'), { code: 'WORKFLOW_REPORT_REF_MISMATCH' })
  }
  const sidecarPath = resolveSidecarPath(activeRoot, reportPath, parsed.value.sidecarPath)
  const root = path.resolve(activeRoot)
  const realRoot = fs.realpathSync(root)
  const memoryRefs = (memoryPaths || []).map(memoryPath => {
    const resolvedMemoryPath = path.resolve(memoryPath)
    if (!isInside(root, resolvedMemoryPath) || !isInside(realRoot, fs.realpathSync(resolvedMemoryPath))) {
      throw Object.assign(new Error('completion memory path must stay below active-root'), { code: 'WORKFLOW_MEMORY_PATH_UNSAFE' })
    }
    const content = fs.readFileSync(resolvedMemoryPath)
    const identity = buildContentIdentity({ sourceKey: resolvedMemoryPath, content, contractVersion: '1' })
    return { kind: 'memory', digest: identity.digest, evidenceRef: `memory:${resolvedMemoryPath}` }
  })
  if (!memoryRefs.length) throw Object.assign(new Error('at least one memory read-back is required'), { code: 'WORKFLOW_MEMORY_RECEIPT_REQUIRED' })
  const manifestEntries = [...new Set((artifactManifestEntries || []).map(item => String(item).trim()).filter(Boolean))].sort()
  const reportIdentity = buildContentIdentity({ sourceKey: path.resolve(reportPath), content: reportContent, contractVersion: '1' })
  const deliveryReceiptRefs = [
    { kind: 'report', digest: reportIdentity.digest, evidenceRef: `report:${path.resolve(reportPath)}` },
    memoryRefs[0],
    { kind: 'manifest', digest: sha256(stableStringify(manifestEntries)), evidenceRef: 'manifest:read-back' }
  ]
  const commit = createWorkflowCompletionCommit({
    snapshot,
    deliveryReceiptRefs,
    reportIdentity,
    memoryReceiptRefs: memoryRefs,
    artifactManifestEntries: manifestEntries,
    commitOutcome: snapshot.coreEvidenceReady ? (snapshot.coreEvidenceState === 'WARN' ? 'warning' : 'complete') : snapshot.riskDeliverable ? 'risk' : 'blocked',
    createdAt
  })
  const serialized = `${JSON.stringify(commit, null, 2)}\n`
  const lockPath = `${sidecarPath}.lock`
  let lockDescriptor
  try {
    lockDescriptor = retryTransientWindowsFs(() => lockFs.openSync(lockPath, 'wx'), lockRetryOptions).value
    if (fs.existsSync(sidecarPath)) {
      const existing = fs.readFileSync(sidecarPath, 'utf8')
      if (existing !== serialized) throw Object.assign(new Error('immutable completion sidecar already exists with different content'), { code: 'WORKFLOW_SIDECAR_CONFLICT' })
    } else {
      const tempPath = `${sidecarPath}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`
      try {
        fs.writeFileSync(tempPath, serialized, { encoding: 'utf8', flag: 'wx' })
        fs.renameSync(tempPath, sidecarPath)
      } catch (error) {
        try { fs.unlinkSync(tempPath) } catch { }
        throw error
      }
    }
  } catch (error) {
    if (error?.code === 'EEXIST') throw Object.assign(new Error('completion sidecar is locked by another writer'), { code: 'WORKFLOW_SIDECAR_LOCKED' })
    throw error
  } finally {
    if (lockDescriptor !== undefined) {
      try { lockFs.closeSync(lockDescriptor) } catch { }
      try { retryTransientWindowsFs(() => lockFs.unlinkSync(lockPath), lockRetryOptions) } catch { }
    }
  }
  const resolved = resolveWorkflowCompletionReport({ activeRoot, reportPath, snapshot, nowMs: Date.parse(createdAt) })
  if (!resolved.projection || resolved.commit?.commitDigest !== commit.commitDigest) {
    throw Object.assign(new Error('completion sidecar read-back validation failed'), { code: 'WORKFLOW_SIDECAR_READBACK_FAILED', details: resolved.errors })
  }
  return { schemaVersion: 'WorkflowCompletionDeliveryCommitResultV1', sidecarPath, commit, projection: resolved.projection }
}

function isRecentFile(filePath, nowMs, recentDays) {
  try {
    const st = fs.statSync(filePath)
    return st.mtimeMs >= nowMs - recentDays * 24 * 60 * 60 * 1000
  } catch {
    return false
  }
}

function walkReportFiles(dir, out, depth = 6) {
  if (!fs.existsSync(dir) || depth < 0) return
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (SKIP_DIR_RE.test(full)) continue
    if (entry.isDirectory()) walkReportFiles(full, out, depth - 1)
    else if (entry.isFile() && REPORT_NAME_RE.test(entry.name)) out.push(full)
  }
}

function looksLikeDevFixCompletionReport(text, relPath) {
  const t = String(text || '')
  // Only real report markdown under reports/ — never .memory/sessions.md or random md
  if (!/(?:^|[\\/])reports[\\/]/i.test(relPath)) return false
  if (/(?:^|[\\/])\.memory[\\/]/i.test(relPath)) return false
  // CP/plan-phase reports often say 已完成 without implementation ECR — not M2 targets
  if (/(?:CP1|CP2|前置复审|需求整理|方案候选|方案生成|复审清单|缺陷记录)/i.test(relPath)) return false
  const completed = /\*\*状态\*\*[：:]\s*已完成|(?:^|>)\s*\*?\*?状态\*?\*?[：:]\s*已完成/im.test(t)
  if (!completed) return false
  // Require explicit workflow type; analyze-only exempt
  if (/\*?\*?类型\*?\*?[：:]\s*analyze\b/i.test(t) && !/\*?\*?类型\*?\*?[：:]\s*(dev|fix)\b/i.test(t)) return false
  const isDevFix = /\*?\*?类型\*?\*?[：:]\s*(dev|fix)\b/i.test(t)
  if (!isDevFix) return false
  // Prefer implementation-shaped reports (reduces historical CP noise)
  if (!/(?:实施|开发报告|修复报告|ECR\s*执行闭环|执行闭环复审)/i.test(relPath + '\n' + t.slice(0, 1200))) return false
  return true
}

function hasEcrSection(text) {
  return /ECR\s*执行闭环复审|##\s*[^#\n]*ECR|ECR-1\b|执行闭环复审/i.test(text)
}

function hasProductionEvidence(text) {
  return /test:core|npm\s+run\s+test|exitCode\s*[=:]\s*0|exit\s*=\s*0|CORE\s*=\s*0|All checks passed|node\s+scripts\/test-/i.test(text)
}

/**
 * @param {{ activeRoot: string, recentDays?: number, nowMs?: number }} opts
 * @returns {{ checkedFiles: string[], issues: string[] }}
 */
function collectRecentCompletedReportEcrIssues(opts) {
  const activeRoot = opts.activeRoot
  const recentDays = opts.recentDays != null ? opts.recentDays : RECENT_COMPLETION_REPORT_DAYS
  const nowMs = opts.nowMs != null ? opts.nowMs : Date.now()
  const checkedFiles = []
  const issues = []
  const results = []

  if (!activeRoot || !fs.existsSync(activeRoot)) {
    return { checkedFiles, issues, results }
  }

  const roots = [
    path.join(activeRoot, 'reports'),
    path.join(activeRoot, 'requirements'),
    path.join(activeRoot, 'bugs'),
    path.join(activeRoot, 'optimizations')
  ]
  const files = []
  for (const root of roots) walkReportFiles(root, files)

  for (const filePath of files) {
    if (!isRecentFile(filePath, nowMs, recentDays)) continue
    let text
    try {
      text = fs.readFileSync(filePath, 'utf8')
    } catch {
      continue
    }
    const rel = path.relative(activeRoot, filePath).replace(/\\/g, '/')
    if (!looksLikeDevFixCompletionReport(text, rel)) continue
    checkedFiles.push(rel)

    const parsedRef = parseWorkflowCompletionReportRef(text)
    if (parsedRef.status === 'present') {
      const resolution = resolveWorkflowCompletionReport({ activeRoot, reportPath: filePath, nowMs })
      results.push({ relativePath: rel, ...resolution })
      if (resolution.errorCode && !['WORKFLOW_COMMIT_NOT_ATTEMPTED'].includes(resolution.errorCode)) {
        issues.push(`${rel}: structured completion evidence invalid (${resolution.errorCode})`)
      }
    } else {
      results.push({
        schemaVersion: 'WorkflowCompletionReportResolutionV1',
        relativePath: rel,
        status: 'UNVERIFIED',
        legacy: true,
        errorCode: parsedRef.status === 'invalid' ? 'WORKFLOW_REPORT_REF_INVALID' : 'WORKFLOW_REPORT_REF_MISSING',
        errors: parsedRef.errors
      })
      if (parsedRef.status === 'invalid') issues.push(`${rel}: strict WorkflowCompletionReportRefV1 sentinel is invalid`)
    }
  }

  return { checkedFiles, issues, results }
}

module.exports = {
  MEMORY_REF_PREFIX,
  RECENT_COMPLETION_REPORT_DAYS,
  REPORT_REF_PREFIX,
  commitWorkflowCompletionDelivery,
  collectRecentCompletedReportEcrIssues,
  createWorkflowCompletionReportRef,
  formatWorkflowCompletionMemoryRef,
  formatWorkflowCompletionReportRef,
  hasEcrSection,
  hasProductionEvidence,
  looksLikeDevFixCompletionReport,
  parseWorkflowCompletionReportRef,
  resolveSidecarPath,
  resolveWorkflowCompletionReport,
  validateCommittedMemoryRefs,
  classifyCheckboxEcrFromReportText (text) {
    const t = String(text || '')
    if (!/ECR|执行闭环复审/i.test(t)) return 'not-ecr-claim'
    if (!/已完成|SC15\s*PASS|完成检查.*PASS/i.test(t)) return 'not-completion-claim'
    if (hasEcrSection(t) && hasProductionEvidence(t)) return 'ok'
    if (/ECR[\s\S]{0,400}✅[\s\S]{0,200}✅/i.test(t) && !hasProductionEvidence(t)) return 'checkbox-ecr'
    if (!hasProductionEvidence(t)) return 'checkbox-ecr'
    return 'ok'
  }
}
