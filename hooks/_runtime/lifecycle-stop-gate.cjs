'use strict'

/**
 * Stop completion / process gate (Grok Stop hard-continue + process gaps).
 * Spec: requirements/20260726-grok-stop-enforcement-honesty/02-技术方案.md §3 / §9b
 */

const path = require('path')
const fs = require('fs')

let analyzeFinalValidationSummarySample
try {
  ;({ analyzeFinalValidationSummarySample } = require('./visible-output-contract.cjs'))
} catch {
  analyzeFinalValidationSummarySample = () => ({ classification: 'not-claimed', status: 'not-claimed' })
}

function extractLastAssistantMessage(payload) {
  if (!payload || typeof payload !== 'object') return ''
  const direct = payload.lastAssistantMessage || payload.last_assistant_message || payload.assistantMessage
  if (typeof direct === 'string' && direct.trim()) return direct
  if (payload.message && typeof payload.message.content === 'string') return payload.message.content
  if (Array.isArray(payload.message?.content)) {
    return payload.message.content.map(p => (typeof p === 'string' ? p : p?.text || '')).join('\n')
  }
  return ''
}

function completionClaimed(text) {
  return /完成检查|completion-check|CompletionEvidenceGate|已完成|已收口|宣告完成|任务完成|FinalValidationSummary|全绿|SC15/i.test(text || '')
}

function askingCp2Confirm(text) {
  return /确认\s*CP2|CP2\s*确认|请确认(?:技术方案|方案)|确认(?:本|该)?技术方案|确认\s*CP2/i.test(text || '')
}

function hasEntryCheck(text) {
  return /###\s*DevCodex\s*·\s*入口检查|PC0\s*[|：:]|PC0~PC7|入口检查块/i.test(text || '')
}

function findActiveTaskRoot(state) {
  try {
    const root = state?.activeNamespaceRoot || state?.workspaceRoot || process.cwd()
    const req = path.join(root, 'requirements')
    if (!fs.existsSync(req)) return null
    const names = fs.readdirSync(req, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .map(d => d.name)
    // Prefer most recently modified task with 02-技术方案
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

function pr1EvidenceOk(taskRoot) {
  if (!taskRoot || !fs.existsSync(taskRoot)) return false
  try {
    const files = fs.readdirSync(taskRoot)
    const review = files.find(f => /^03-.*方案复审/i.test(f) || /^04-.*方案复审/i.test(f) || /方案复审/i.test(f))
    if (review) {
      const body = fs.readFileSync(path.join(taskRoot, review), 'utf8')
      if (/PR-1/i.test(body) && (/zero\s*blocker|open blocker\s*=\s*0|✅\s*通过|通过/i.test(body))) return true
      if (/PR-1/i.test(body) && /通过/.test(body) && !/不通过|阻断.*PR-1/i.test(body)) return true
    }
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

function hasTechDesign(taskRoot) {
  if (!taskRoot) return false
  return fs.existsSync(path.join(taskRoot, '02-技术方案.md'))
}

/**
 * @returns {{ decision: 'allow'|'block'|'unverified', gaps: string[], reason: string, honesty: object }}
 */
function evaluateStopCompletionGate(input = {}) {
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
  if ((wf === 'chat' || mode === 'chat') && !mutated) {
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
  const nonChatWork = ['dev', 'fix', 'self-fix'].includes(String(mode).toLowerCase())
    || ['dev', 'fix', 'self-fix'].includes(wf)
    || mutated
    || reportTouched

  if (nonChatWork) {
    if (!hasEntryCheck(text)) gaps.push('entry-check')
    const summary = analyzeFinalValidationSummarySample(text)
    const classif = summary.classification || summary.status || 'not-claimed'
    if (
      (completionClaimed(text) || reportTouched || mutated)
      && (classif === 'not-claimed' || classif === 'thin-green-summary' || classif === 'report-link-only' || summary.status === 'verified-missing')
    ) {
      if (classif === 'not-claimed' && !completionClaimed(text) && !reportTouched && mutated) {
        // mutated but no completion claim: still require FVS only if completion-ish; Q1 focuses entry-check
      } else if (completionClaimed(text) || reportTouched) {
        gaps.push('final-validation-summary')
      } else if (mutated && summary.status === 'verified-missing') {
        gaps.push('final-validation-summary')
      }
    }
    // Stronger: if completion claimed and thin/not claimed
    if (completionClaimed(text) && (classif === 'not-claimed' || classif === 'thin-green-summary' || summary.status === 'verified-missing')) {
      if (!gaps.includes('final-validation-summary')) gaps.push('final-validation-summary')
    }
    if (mutated && !reportTouched && wf !== 'chat') gaps.push('report')
    if (mutated && !memoryTouched && wf !== 'chat') gaps.push('memory')
  }

  const taskRoot = input.taskRoot || findActiveTaskRoot(input.state)
  if (askingCp2Confirm(text) && hasTechDesign(taskRoot) && !pr1EvidenceOk(taskRoot)) {
    gaps.push('pr1-skipped')
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
  completionClaimed,
  hasEntryCheck,
  findActiveTaskRoot
}
