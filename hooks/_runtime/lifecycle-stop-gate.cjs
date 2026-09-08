'use strict'

/**
 * Stop completion / process gate (Grok Stop hard-continue + process gaps).
 * Spec: requirements/20260726-grok-stop-enforcement-honesty/02-技术方案.md §3 / §9b
 * R11 processGaps (canonical):
 *   entry-check-missing | completion-check-missing | final-validation-summary |
 *   report-missing | memory-missing | pr1-skipped | pr1-task-binding-missing | cp2-unconfirmed-write |
 *   stop-continuation-exhausted
 */

const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { evaluateEvidenceSaturation, createReviewStateSnapshot } = require('./review-execution-contract.cjs')
const { evaluatePortableTaskIdentityBinding, validateTaskIdentity } = require('./task-continuation-contract.cjs')

let analyzeFinalValidationSummarySample
try {
  ;({ analyzeFinalValidationSummarySample } = require('./visible-output-contract.cjs'))
} catch {
  analyzeFinalValidationSummarySample = () => ({ classification: 'not-claimed', status: 'not-claimed' })
}

let classifyReviewChecklistCompletion
let classifyProcessArtifactCompleteness
let classifyDeliveryHonesty
let classifyEcrClosure
try {
  ;({
    classifyReviewChecklistCompletion,
    classifyProcessArtifactCompleteness,
    classifyDeliveryHonesty,
    classifyEcrClosure
  } = require('../../scripts/lib/process-enforcement.js'))
} catch {
  classifyReviewChecklistCompletion = () => ({ ok: true, code: null, gap: null })
  classifyProcessArtifactCompleteness = () => ({ ok: true, code: null, gap: null, missing: [] })
  classifyDeliveryHonesty = () => ({ ok: true, gaps: [], code: null, gap: null })
  classifyEcrClosure = () => ({ ok: true, code: null, gap: null })
}

function extractLastAssistantMessage (payload) {
  if (!payload || typeof payload !== 'object') return ''
  const direct = payload.lastAssistantMessage || payload.last_assistant_message || payload.assistantMessage
  if (typeof direct === 'string' && direct.trim()) return direct
  if (payload.message && typeof payload.message.content === 'string') return payload.message.content
  if (Array.isArray(payload.message?.content)) {
    return payload.message.content.map(p => (typeof p === 'string' ? p : p?.text || '')).join('\n')
  }
  return ''
}

/**
 * UserVisibleNoisePolicyV1:
 * - Scaffold (完成检查 / FVS 标题) is structural chrome — does NOT mean work is done.
 * - workDoneClaimed is a strong completion / closure claim for users.
 */
function workDoneClaimed (text) {
  return /已完成|任务完成|all work is complete|宣告完成|可关闭需求|本需求.*闭环|DoD.*闭环|只差验收|需求已完成|关账完成|实施交付收尾|版式规范关账|修复已验证通过并已提交/i.test(
    text || ''
  )
}

/** @deprecated prefer workDoneClaimed; export keeps name for older callers */
function completionClaimed (text) {
  // Strong work-done only (NoisePolicy). Mere "### 完成检查" / FVS heading is NOT enough.
  return workDoneClaimed(text)
}

function askingCp2Confirm (text) {
  // F-05: cover confirm-request presentation, not only "确认 CP2" shorthand
  return /确认\s*CP2|CP2\s*确认|请确认(?:技术方案|方案)|确认(?:本|该)?技术方案|确认\s*CP2|技术方案\s*待确认|请求确认\s*CP2|CP2\s*（?待确认）?/i.test(text || '')
}

function hasEntryCheck (text) {
  return /###\s*DevCodex\s*·\s*入口检查|PC0\s*[|：:]|PC0~PC(?:7|10)|入口检查块|DevCodexVisibleEnvelopeV(?:1|2|3)\s*·\s*entry-check/i.test(text || '')
}

/** F-14/F-16: completion-check OR short FinalValidationSummary scaffold */
function hasCompletionCheck (text) {
  return (
    /###\s*DevCodex\s*·\s*完成检查/i.test(text || '') ||
    /DevCodexVisibleEnvelopeV(?:1|2|3)\s*·\s*completion-check/i.test(text || '') ||
    /🛡️\s*DEV\s*模式\s*\|\s*合规检查/i.test(text || '') ||
    /###\s*FinalValidationSummaryV1/i.test(text || '')
  )
}

function hasFinalValidationSummary (text) {
  return /FinalValidationSummaryV1|####\s*验证摘要|权威验证命令与\s*exitCode/i.test(text || '')
}

/**
 * F-08: skip report/memory hard gaps when explicit N/A or simple/probe skipReason.
 */
function artifactGapsExempt (text) {
  return /SimpleTaskFastPath|报告\s*[：:]\s*N\/A|report\s*[：:=]\s*N\/A|记忆\s*[：:]\s*N\/A|memory\s*[：:=]\s*N\/A|skipReason\s*[：:=]\s*(?:simple-task|simple_task|probe|temp|tmp)|产物\s*N\/A\s*\+\s*skipReason/i.test(text || '')
}

function insideOrSamePath (child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function readBoundTaskIdentity (taskRoot) {
  for (const file of [
    path.join(taskRoot, '.memory', 'task-identity-v2.json'),
    path.join(taskRoot, '.memory', 'task.json')
  ]) {
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (value && typeof value === 'object' && !Array.isArray(value)) return value
    } catch { }
  }
  return null
}

/**
 * Compatibility export with target-first semantics. It no longer scans task
 * directories or selects by mtime; only the session-bound task may be used.
 */
function findActiveTaskRoot (state) {
  try {
    const binding = state?.taskRecoveryBinding
    const lease = state?.stickyProject
    if (binding?.schemaVersion !== 'TaskRecoveryBindingV1' || binding.status !== 'active') return null
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(binding.taskId || ''))) return null
    const activeRoot = String(lease?.activeRoot || state?.activeNamespaceRoot || '').trim()
    const expectedProject = String(lease?.project || state?.activeProject || '').trim()
    if (!activeRoot || !expectedProject || binding.project !== expectedProject) return null
    const taskRoot = path.resolve(String(binding.taskRoot || ''))
    if (!insideOrSamePath(taskRoot, activeRoot) || !fs.existsSync(taskRoot) || fs.existsSync(path.join(taskRoot, '.archived'))) return null
    const relative = path.relative(path.resolve(activeRoot), taskRoot).replace(/\\/g, '/')
    const segments = relative.split('/').filter(Boolean)
    if (segments.length !== 2 || !['requirements', 'bugs', 'optimizations', 'scenario-tests'].includes(segments[0])) return null
    if (binding.kind && binding.kind !== segments[0]) return null
    const identity = readBoundTaskIdentity(taskRoot)
    if (!identity || String(identity.taskId || '').toLowerCase() !== String(binding.taskId).toLowerCase()) return null
    if (identity.schemaVersion === 'TaskIdentityV2') {
      const identityBinding = evaluatePortableTaskIdentityBinding(identity, {
        taskId: binding.taskId,
        project: expectedProject,
        taskKind: segments[0],
        taskRootRelative: relative,
        currentProjectRootIdentityDigest: lease?.rootIdentityDigest
      })
      if (!identityBinding.valid) return null
    } else if (!validateTaskIdentity(identity).valid) return null
    return taskRoot
  } catch {
    return null
  }
}

// PR-1 has no minimum prose length; evidence identities drive its diagnostic.

/**
 * F-04 / SkillsDeployMode PR-1 strengthen:
 * When 02-技术方案 exists, require an independent 03 review file with
 * candidate/report digests and observed evidence identities. Prose is not proof.
 */
function findPr1ReviewFileName (taskRoot) {
  if (!taskRoot || !fs.existsSync(taskRoot)) return null
  try {
    const files = fs.readdirSync(taskRoot)
    return files.find(f =>
      /^03-.*方案复审/i.test(f) ||
      /^03-.*方案自审/i.test(f) ||
      /^04-.*方案复审/i.test(f) ||
      /方案复审/i.test(f)
    ) || null
  } catch {
    return null
  }
}

// The report is explanatory text. Only its candidate-bound ReviewState and
// read-back evidence may support PR-1; prose, headings and examples are not votes.
function pr1ReviewBodyOk (body, taskRoot) {
  return pr1EvidenceOk(taskRoot, { reviewBody: String(body || '') })
}

function pr1EvidenceOk (taskRoot, options = {}) {
  if (!taskRoot) return false
  try {
    const root = fs.realpathSync(taskRoot)
    let readBytes = 0
    const readOwned = relative => {
      if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error('review-path')
      const file = path.resolve(root, relative)
      const physical = fs.realpathSync(file)
      const inside = path.relative(root, physical)
      const stat = fs.lstatSync(file)
      if (!inside || inside === '..' || inside.startsWith('..' + path.sep) || path.isAbsolute(inside) ||
          !stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw new Error('review-boundary')
      readBytes += stat.size
      if (readBytes > 8 * 1024 * 1024) throw new Error('review-budget')
      const bytes = fs.readFileSync(file)
      const after = fs.lstatSync(file)
      if (after.ino !== stat.ino || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs ||
          after.ctimeMs !== stat.ctimeMs || bytes.length !== after.size || fs.realpathSync(file) !== physical) {
        throw new Error('review-read-raced')
      }
      return { content: bytes.toString('utf8'), digest: crypto.createHash('sha256').update(bytes).digest('hex') }
    }
    const evidence = JSON.parse(readOwned('.memory/review-execution-pr1.json').content)
    if (evidence.schemaVersion !== 'ReviewExecutionEvidenceV1') return false
    const design = findDesignArtifactPath(taskRoot)
    const review = findPr1ReviewFileName(taskRoot)
    if (!design || !review || evidence.candidate?.path !== path.relative(taskRoot, design).replace(/\\/g, '/') ||
        evidence.review?.path !== review) return false
    const candidate = readOwned(evidence.candidate.path)
    const report = readOwned(evidence.review.path)
    if (candidate.digest !== evidence.candidate.digest || report.digest !== evidence.review.digest ||
        (options.reviewBody !== undefined && options.reviewBody !== report.content)) return false
    const { plan, receipts, saturationInput, snapshot } = evidence
    if (!plan || !Array.isArray(receipts) || receipts.length < 1 || receipts.length > 128 ||
        plan.candidateDigest !== candidate.digest || plan.stage !== 'pre-confirmation' ||
        !Array.isArray(evidence.artifacts) || evidence.artifacts.length > 128) return false
    const observed = new Map()
    for (const item of evidence.artifacts) {
      if (!item.ref || observed.has(item.ref) || readOwned(item.path).digest !== item.digest) return false
      observed.set(item.ref, item.digest)
    }
    if (receipts.some(receipt => !Array.isArray(receipt.evidenceRefs) || receipt.evidenceRefs.length === 0 ||
        receipt.evidenceRefs.some(ref => !observed.has(ref)))) return false
    const saturation = evaluateEvidenceSaturation(plan, { ...saturationInput, receipts })
    const expected = createReviewStateSnapshot(plan, {
      saturation, receiptDigests: saturation.freshReceiptDigests,
      open: saturationInput?.openCount, blocker: saturationInput?.blockerCount,
      stale: receipts.length - saturation.freshReceiptDigests.length,
      unreviewed: saturation.unboundedRelatedCount,
      dirtyBoundary: saturationInput?.dirtyBoundaryMatches === true ? 'matched' : 'unverified'
    })
    return expected.nextAction === 'accept' && expected.snapshotDigest === snapshot?.snapshotDigest
  } catch {
    return false
  }
}

function hasTechDesign (taskRoot) {
  return findDesignArtifactPath(taskRoot) !== null
}

function findDesignArtifactPath (taskRoot) {
  if (!taskRoot) return null
  for (const name of ['02-技术方案.md', '02-修复方案.md']) {
    const candidate = path.join(taskRoot, name)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

/**
 * @returns {{ decision: 'allow'|'block'|'unverified', gaps: string[], reason: string, honesty: object }}
 */
function evaluateStopCompletionGate (input = {}) {
  const {
    mode = '',
    workflow = '',
    mutated = false,
    reportTouched = false,
    memoryTouched = false,
    lastAssistantMessage = '',
    stopHookActive = false,
    continuationCount = 0,
    softCap = 8,
    text: textOverride = null
  } = input

  const text = String(textOverride != null ? textOverride : lastAssistantMessage || '')
  const honesty = {
    stopDecision: 'allow',
    processGaps: [],
    uninterceptable: []
  }

  // A Stop continuation is already the result of a prior Stop decision. It may
  // be observed, but blocking it again would recursively create another
  // continuation. One initial Stop decision is the only enforcement boundary.
  if (stopHookActive) {
    honesty.stopDecision = 'allow'
    honesty.processGaps.push('stop-reentrant-observation-only')
    return {
      decision: 'allow',
      gaps: [],
      reason: '',
      honesty
    }
  }

  const wf = String(workflow || '').toLowerCase()
  const modeL = String(mode || '').toLowerCase()
  if ((wf === 'chat' || modeL === 'chat') && !mutated) {
    return { decision: 'allow', gaps: [], reason: '', honesty }
  }

  if (!text.trim()) {
    honesty.stopDecision = 'unverified'
    honesty.uninterceptable.push('no-last-assistant-message')
    return {
      decision: 'unverified',
      gaps: [],
      reason: 'DevCodex Stop gate: no lastAssistantMessage; cannot hard-block (unverified).',
      honesty
    }
  }

  const gaps = []
  const nonChatWork = ['dev', 'fix', 'self-fix'].includes(modeL)
    || ['dev', 'fix', 'self-fix'].includes(wf)
    || mutated
    || reportTouched
  const done = workDoneClaimed(text) || input.completionClaimed === true

  if (nonChatWork) {
    // F-07: entry always required for non-chat (NoisePolicy P1)
    if (!hasEntryCheck(text)) gaps.push('entry-check-missing')

    // NoisePolicy P3/P5: completion scaffold + FVS only when work is claimed done
    // (not merely because mode=dev or mutation occurred mid-task).
    if (done) {
      if (!hasCompletionCheck(text) && !hasFinalValidationSummary(text)) {
        gaps.push('completion-check-missing')
      }
      const summary = analyzeFinalValidationSummarySample(text)
      const classif = summary.classification || summary.status || 'not-claimed'
      if (
        classif === 'not-claimed' ||
        classif === 'thin-green-summary' ||
        classif === 'report-link-only' ||
        summary.status === 'verified-missing'
      ) {
        gaps.push('final-validation-summary')
      }
    } else if (hasCompletionCheck(text) || hasFinalValidationSummary(text)) {
      // Optional scaffold present without work-done claim: if FVS body is incomplete, still flag.
      const summary = analyzeFinalValidationSummarySample(text)
      if (summary.claimed && summary.status === 'verified-missing') {
        gaps.push('final-validation-summary')
      }
    }

    // F-08: report/memory with explicit N/A / SimpleTask / probe exemption
    const exempt = artifactGapsExempt(text)
    if (mutated && !reportTouched && wf !== 'chat' && !exempt) gaps.push('report-missing')
    if (mutated && !memoryTouched && wf !== 'chat' && !exempt) gaps.push('memory-missing')
  }

  // F-05 / R9: CP2 confirm request without PR-1 strong evidence
  const taskRoot = input.taskBindingVerified === false
    ? null
    : (input.taskRoot || findActiveTaskRoot(input.state))
  if (askingCp2Confirm(text)) {
    if (!taskRoot) gaps.push('pr1-task-binding-missing')
    else if (!hasTechDesign(taskRoot) || !pr1EvidenceOk(taskRoot)) gaps.push('pr1-skipped')
  }

  // Process-enforcement: only when strong work-done claim (NoisePolicy)
  const checklist = classifyReviewChecklistCompletion({
    completionClaimed: done,
    reviewClass: input.reviewClass || '',
    text,
    hasReviewChecklistPath: input.hasReviewChecklistPath === true
  })
  if (!checklist.ok && checklist.gap) {
    gaps.push(checklist.gap)
  }

  // Process package: control-plane / multi-batch must cite or possess 04+05+checklist
  const processPkg = classifyProcessArtifactCompleteness({
    completionClaimed: done,
    reviewClass: input.reviewClass || '',
    text,
    controlPlaneTask: input.controlPlaneTask === true,
    multiBatch: input.multiBatch === true,
    hasImplementationPlan: input.hasImplementationPlan === true,
    hasProgressFile: input.hasProgressFile === true,
    hasReviewChecklist: input.hasReviewChecklist === true || input.hasReviewChecklistPath === true,
    taskRoot,
    fs
  })
  if (!processPkg.ok && processPkg.gap) {
    gaps.push(processPkg.gap)
  }

  // Delivery honesty (A/B): strong closure claim + report path / over-claim
  // Note: do not pass completionClaimed=true from mere 完成检查 block — classifier uses strong phrases.
  if (typeof classifyDeliveryHonesty === 'function') {
    const honestyGaps = classifyDeliveryHonesty({
      text,
      mode: modeL || mode,
      workflow: wf || workflow,
      mutated
    })
    if (!honestyGaps.ok && Array.isArray(honestyGaps.gaps)) {
      for (const g of honestyGaps.gaps) {
        if (g && !gaps.includes(g)) gaps.push(g)
      }
    }
  }

  // ECR / N6 execution-closure evidence (ecr-missing)
  if (typeof classifyEcrClosure === 'function') {
    const ecr = classifyEcrClosure({
      text,
      mode: modeL || mode,
      workflow: wf || workflow
    })
    if (!ecr.ok && ecr.gap && !gaps.includes(ecr.gap)) {
      gaps.push(ecr.gap)
    }
  }

  const uniqueGaps = [...new Set(gaps)]
  honesty.processGaps = uniqueGaps

  if (uniqueGaps.length) {
    // Natural-language/template observations are quality diagnostics, never
    // authority to force another model turn or prevent an honest handoff.
    honesty.stopDecision = 'allow'
    const reason = `DevCodex Stop gate: incomplete closure — missing: ${uniqueGaps.join(', ')}. `
      + 'Record unfinished work and recoverable content; continue available work. Do not claim unverified completion.'
    return { decision: 'allow', gaps: uniqueGaps, reason, honesty }
  }

  honesty.stopDecision = 'allow'
  return { decision: 'allow', gaps: [], reason: '', honesty }
}

module.exports = {
  evaluateStopCompletionGate,
  extractLastAssistantMessage,
  askingCp2Confirm,
  workDoneClaimed,
  hasFinalValidationSummary,
  pr1EvidenceOk,
  pr1ReviewBodyOk,
  findPr1ReviewFileName,
  findDesignArtifactPath,
  completionClaimed,
  hasEntryCheck,
  hasCompletionCheck,
  artifactGapsExempt,
  findActiveTaskRoot
}
