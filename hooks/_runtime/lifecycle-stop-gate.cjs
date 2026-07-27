'use strict'

/**
 * Stop completion / process gate (Grok Stop hard-continue + process gaps).
 * Spec: requirements/20260726-grok-stop-enforcement-honesty/02-技术方案.md §3 / §9b
 * R11 processGaps (canonical):
 *   entry-check-missing | completion-check-missing | final-validation-summary |
 *   report-missing | memory-missing | pr1-skipped | cp2-unconfirmed-write |
 *   stop-continuation-exhausted
 */

const path = require('path')
const fs = require('fs')

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

function completionClaimed (text) {
  return /完成检查|completion-check|CompletionEvidenceGate|已完成|已收口|宣告完成|任务完成|FinalValidationSummary|全绿|SC15/i.test(text || '')
}

function askingCp2Confirm (text) {
  // F-05: cover confirm-request presentation, not only "确认 CP2" shorthand
  return /确认\s*CP2|CP2\s*确认|请确认(?:技术方案|方案)|确认(?:本|该)?技术方案|确认\s*CP2|技术方案\s*待确认|请求确认\s*CP2|CP2\s*（?待确认）?/i.test(text || '')
}

function hasEntryCheck (text) {
  return /###\s*DevCodex\s*·\s*入口检查|PC0\s*[|：:]|PC0~PC7|入口检查块|DevCodexVisibleEnvelopeV1\s*·\s*entry-check/i.test(text || '')
}

/** F-14/F-16: standard completion-check block present */
function hasCompletionCheck (text) {
  return (
    /###\s*DevCodex\s*·\s*完成检查/i.test(text || '') ||
    /DevCodexVisibleEnvelopeV1\s*·\s*completion-check/i.test(text || '') ||
    /🛡️\s*DEV\s*模式\s*\|\s*合规检查/i.test(text || '')
  )
}

/**
 * F-08: skip report/memory hard gaps when explicit N/A or simple/probe skipReason.
 */
function artifactGapsExempt (text) {
  return /SimpleTaskFastPath|报告\s*[：:]\s*N\/A|report\s*[：:=]\s*N\/A|记忆\s*[：:]\s*N\/A|memory\s*[：:=]\s*N\/A|skipReason\s*[：:=]\s*(?:simple-task|simple_task|probe|temp|tmp)|产物\s*N\/A\s*\+\s*skipReason/i.test(text || '')
}

function findActiveTaskRoot (state) {
  try {
    const root = state?.activeNamespaceRoot || state?.workspaceRoot || process.cwd()
    const req = path.join(root, 'requirements')
    if (!fs.existsSync(req)) return null
    const names = fs.readdirSync(req, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .map(d => d.name)
    let best = null
    let bestM = 0
    for (const name of names) {
      const full = path.join(req, name)
      const tech = path.join(full, '02-技术方案.md')
      if (!fs.existsSync(tech)) continue
      const m = fs.statSync(tech).mtimeMs
      if (m >= bestM) {
        bestM = m
        best = full
      }
    }
    return best
  } catch {
    return null
  }
}

/** Minimum UTF-8 bytes for a substantive PR-1 review body (blocks two-line green). */
const PR1_MIN_BODY_BYTES = 1200

/**
 * F-04 / SkillsDeployMode PR-1 strengthen:
 * When 02-技术方案 exists, require an independent 03 review file with
 * pass signal AND substance (mapping/contract/CodeTruth/blocker/root-cause).
 * Rejects: open-blocker-only, table-only PR-1 ✅, sessions-only with 02 present.
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

function controlPlaneHint (taskRoot) {
  try {
    const tech = path.join(taskRoot, '02-技术方案.md')
    if (!fs.existsSync(tech)) return false
    const text = fs.readFileSync(tech, 'utf8')
    return /hook|lifecycle|skillsDeploy|applyGlobalHost|control.?plane|控制面|global-host-config|pr1EvidenceOk/i.test(text)
  } catch {
    return false
  }
}

function countPr1Substance (body) {
  let substance = 0
  if (/BlockerSnapshot|阻断项|blockerId/i.test(body)) substance += 1
  if (/验收映射|需求[^\n]{0,12}映射|产品事实源|§0\.5/i.test(body)) substance += 1
  if (/契约矩阵|ContractMatrix|Current\s*→\s*Target|runtimeOwners/i.test(body)) substance += 1
  if (/CodeTruth|currentBehavior|negativeProbe|repoPath/i.test(body)) substance += 1
  if (/根因|Root\s*cause|假绿|pr1EvidenceOk/i.test(body)) substance += 1
  return substance
}

function pr1ReviewBodyOk (body, taskRoot) {
  const text = String(body || '')
  if (!/PR-1/i.test(text)) return false
  if (/PR-1[^\n]{0,40}(?:不通过|阻断|fail|❌)/i.test(text)) return false
  if (Buffer.byteLength(text, 'utf8') < PR1_MIN_BODY_BYTES) return false

  const hasPass =
    /open\s*blocker\s*=\s*0|zero\s*blocker|blockers?\s*=\s*0/i.test(text) ||
    /PR-1[^\n]{0,40}(?:✅\s*通过|通过\s*✅|=\s*pass|:\s*pass)/i.test(text) ||
    /阶段一[^\n]{0,30}PR-1[^\n]{0,30}✅/i.test(text)
  // Bare "| PR-1 | ✅ |" table rows alone are NOT a pass signal (thin-green).
  if (!hasPass) return false

  const substance = countPr1Substance(text)
  const minSubstance = controlPlaneHint(taskRoot) ? 2 : 2
  return substance >= minSubstance
}

function pr1EvidenceOk (taskRoot) {
  if (!taskRoot || !fs.existsSync(taskRoot)) return false
  try {
    const hasTech = hasTechDesign(taskRoot)
    const review = findPr1ReviewFileName(taskRoot)

    // With a tech design, sessions-only is never enough — require independent 03 review.
    if (hasTech) {
      if (!review) return false
      const body = fs.readFileSync(path.join(taskRoot, review), 'utf8')
      return pr1ReviewBodyOk(body, taskRoot)
    }

    if (review) {
      const body = fs.readFileSync(path.join(taskRoot, review), 'utf8')
      return pr1ReviewBodyOk(body, taskRoot)
    }

    // Legacy: no 02 present — sessions row may still count for non-CP2 callers.
    const sessions = path.join(taskRoot, '.memory', 'sessions.md')
    if (fs.existsSync(sessions)) {
      const s = fs.readFileSync(sessions, 'utf8')
      if (/PR-1\s*[|：:]*\s*✅|PR-1\s*=\s*pass|PR-1（CP2 前）\s*\|\s*✅/i.test(s)) return true
    }
  } catch {
    /* ignore */
  }
  return false
}

function hasTechDesign (taskRoot) {
  if (!taskRoot) return false
  return fs.existsSync(path.join(taskRoot, '02-技术方案.md'))
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

  if (stopHookActive && Number(continuationCount) >= softCap) {
    honesty.stopDecision = 'allow'
    honesty.processGaps.push('stop-continuation-exhausted')
    return {
      decision: 'allow',
      gaps: [],
      reason: '',
      honesty
    }
  }

  const gaps = []
  const nonChatWork = ['dev', 'fix', 'self-fix'].includes(modeL)
    || ['dev', 'fix', 'self-fix'].includes(wf)
    || mutated
    || reportTouched

  if (nonChatWork) {
    // F-07: R11 canonical names
    if (!hasEntryCheck(text)) gaps.push('entry-check-missing')

    // F-16: completion-check block required for non-chat work that claims complete or mutates under dev/fix
    const needCompletionBlock = completionClaimed(text)
      || reportTouched
      || ['dev', 'fix', 'self-fix'].includes(modeL)
      || ['dev', 'fix', 'self-fix'].includes(wf)
      || mutated
    if (needCompletionBlock && !hasCompletionCheck(text)) {
      gaps.push('completion-check-missing')
    }

    const summary = analyzeFinalValidationSummarySample(text)
    const classif = summary.classification || summary.status || 'not-claimed'
    if (
      (completionClaimed(text) || reportTouched || mutated)
      && (classif === 'not-claimed' || classif === 'thin-green-summary' || classif === 'report-link-only' || summary.status === 'verified-missing')
    ) {
      if (classif === 'not-claimed' && !completionClaimed(text) && !reportTouched && mutated) {
        // mutated without completion claim: entry + completion-check cover Q1; FVS optional until claim
      } else if (completionClaimed(text) || reportTouched) {
        gaps.push('final-validation-summary')
      } else if (mutated && summary.status === 'verified-missing' && hasCompletionCheck(text)) {
        gaps.push('final-validation-summary')
      }
    }
    if (completionClaimed(text) && (classif === 'not-claimed' || classif === 'thin-green-summary' || summary.status === 'verified-missing')) {
      if (!gaps.includes('final-validation-summary')) gaps.push('final-validation-summary')
    }

    // F-08: report/memory with explicit N/A / SimpleTask / probe exemption
    const exempt = artifactGapsExempt(text)
    if (mutated && !reportTouched && wf !== 'chat' && !exempt) gaps.push('report-missing')
    if (mutated && !memoryTouched && wf !== 'chat' && !exempt) gaps.push('memory-missing')
  }

  // F-05 / R9: CP2 confirm request without PR-1 strong evidence
  const taskRoot = input.taskRoot || findActiveTaskRoot(input.state)
  if (askingCp2Confirm(text) && hasTechDesign(taskRoot) && !pr1EvidenceOk(taskRoot)) {
    gaps.push('pr1-skipped')
  }

  // Process-enforcement: R3/R4 completion claim without review-checklist path/status
  const checklist = classifyReviewChecklistCompletion({
    completionClaimed: completionClaimed(text) || input.completionClaimed === true,
    reviewClass: input.reviewClass || '',
    text,
    hasReviewChecklistPath: input.hasReviewChecklistPath === true
  })
  if (!checklist.ok && checklist.gap) {
    gaps.push(checklist.gap)
  }

  // Process package: control-plane / multi-batch must cite or possess 04+05+checklist
  const processPkg = classifyProcessArtifactCompleteness({
    completionClaimed: completionClaimed(text) || input.completionClaimed === true,
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
    honesty.stopDecision = 'block'
    const reason = `DevCodex Stop gate: incomplete closure — missing: ${uniqueGaps.join(', ')}. `
      + 'Add 完成检查/PC0~PC7 / PR-1 as required, then finish. (platform may stop after continuation limit)'
    return { decision: 'block', gaps: uniqueGaps, reason, honesty }
  }

  honesty.stopDecision = 'allow'
  return { decision: 'allow', gaps: [], reason: '', honesty }
}

module.exports = {
  evaluateStopCompletionGate,
  extractLastAssistantMessage,
  askingCp2Confirm,
  pr1EvidenceOk,
  pr1ReviewBodyOk,
  countPr1Substance,
  findPr1ReviewFileName,
  controlPlaneHint,
  PR1_MIN_BODY_BYTES,
  completionClaimed,
  hasEntryCheck,
  hasCompletionCheck,
  artifactGapsExempt,
  findActiveTaskRoot
}
