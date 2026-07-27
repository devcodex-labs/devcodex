'use strict'

/**
 * Process enforcement: MutationCpGate helpers, ArtifactPathGate, completion checklist.
 * Consumed by hooks/_runtime/lifecycle*.cjs and E2E tests.
 */

const path = require('path')

const ERROR_CODES = Object.freeze({
  CP2_REQUIRED: 'CP2_REQUIRED',
  CP3_REQUIRED: 'CP3_REQUIRED',
  ORPHAN_CONTROL_PLANE: 'ORPHAN_CONTROL_PLANE',
  SIMPLE_TASK_PATH_FORBIDDEN: 'SIMPLE_TASK_PATH_FORBIDDEN',
  ARTIFACT_PATH_INVALID: 'ARTIFACT_PATH_INVALID',
  REVIEW_CHECKLIST_MISSING: 'review-checklist-missing',
  /** Control-plane / multi-batch completion without 05 progress file path evidence */
  PROGRESS_ARTIFACT_MISSING: 'progress-artifact-missing',
  /** Formal R3 process package incomplete (04/05/checklist triad) */
  PROCESS_ARTIFACT_INCOMPLETE: 'process-artifact-incomplete',
  /**
   * Control-plane mutation (hooks/skills/…) started without 04/05/review-checklist triad.
   * yes-implement / Batch mutation must not skip CP3 materialization (ESC-01 / P0-1 process gate).
   */
  IMPLEMENT_START_WITHOUT_PROCESS: 'implement-start-without-process',
  /**
   * Control-plane mutation with no bound requirement/bug task root.
   * Fail-closed so "do the feature" cannot mutate scripts/hooks without a task package
   * (promise-to-follow-process then skip was an unbound-task loophole).
   */
  IMPLEMENT_START_WITHOUT_TASK_BINDING: 'implement-start-without-task-binding',
  /**
   * Control-plane mutation without CP1/CP2 design artifacts (01 需求确认 and/or 02 技术方案方案).
   */
  IMPLEMENT_START_WITHOUT_DESIGN: 'implement-start-without-design',
  /** Completion claim without discoverable stage report path */
  STAGE_REPORT_MISSING: 'stage-report-missing',
  /** Over-claim progress without validation evidence rows */
  PROGRESS_OVERCLAIM: 'progress-overclaim',
  /** Strong completion without ECR / execution-closure review evidence */
  ECR_MISSING: 'ecr-missing'
})

/** Paths that use hard-deny for unconfirmed CP even under default safety-only (D1). */
const STRICT_PROTECTED_PATH_RE =
  /(?:^|[/\\])(?:hooks|skills|instructions|mcp|prompts|host-projections|agents|scripts[/\\]lib)(?:[/\\]|$)|(?:^|[/\\])(?:package\.json|plugin\.json|index\.js)$|(?:^|[/\\])website[/\\]docs(?:[/\\]|$)|(?:^|[/\\])website[/\\]rspress\.config\.(?:ts|js|mjs)$/i

/** Analysis / inventory names that must not occupy requirements/02-* technical-design slot. */
const FORBIDDEN_02_NAME_RE =
  /功能清单|盘点|遗漏扫|inventory|feature-inventory|converged|完整功能|扫描确认|台账|Pass4|pass-4/i

const TECH_DESIGN_NAME_RE = /技术方案|technical-design|tech-design|设计方案/i

function normalizePath(p) {
  return String(p || '').replace(/\\/g, '/')
}

function isStrictProtectedPath(filePath) {
  const n = normalizePath(filePath)
  if (!n) return false
  return STRICT_PROTECTED_PATH_RE.test(n)
}

function pathsIncludeStrictProtected(paths) {
  return (paths || []).some((p) => isStrictProtectedPath(p))
}

/**
 * @param {{ phase?: string, code?: string }|null} gate
 * @param {string[]} paths
 * @param {{ strictEnv?: boolean }} opts
 * @returns {{ hardDeny: boolean, reason: string|null }}
 */
function shouldHardDenyCpMutation(gate, paths, opts = {}) {
  if (!gate) return { hardDeny: false, reason: null }
  if (opts.strictEnv) return { hardDeny: true, reason: 'enforcement-strict' }
  if (gate.code === 'cp-gate-orphan-control-plane') {
    return { hardDeny: true, reason: ERROR_CODES.ORPHAN_CONTROL_PLANE }
  }
  if (gate.phase === 'CP2' && pathsIncludeStrictProtected(paths)) {
    return { hardDeny: true, reason: ERROR_CODES.CP2_REQUIRED }
  }
  if (gate.phase === 'CP3' && pathsIncludeStrictProtected(paths)) {
    return { hardDeny: true, reason: ERROR_CODES.CP3_REQUIRED }
  }
  // Non-protected source files: keep legacy safety-only warning unless strictEnv
  return { hardDeny: false, reason: null }
}

/**
 * Reject analysis reports occupying requirements/<task>/02-* technical-design slot.
 * @param {string} filePath
 * @returns {{ ok: boolean, code: string|null, message: string|null }}
 */
function classifyRequirementsArtifactPath(filePath) {
  const n = normalizePath(filePath)
  if (!n) return { ok: true, code: null, message: null }

  // requirements/<anything>/02-<name>
  const m = n.match(/(?:^|[/\\])requirements[/\\][^/\\]+[/\\](0[24])[-–—]?([^/\\]+)$/i)
  if (!m) return { ok: true, code: null, message: null }

  const slot = m[1]
  const rest = m[2] || ''
  const base = rest.replace(/\.md$/i, '')

  if (slot === '02') {
    if (FORBIDDEN_02_NAME_RE.test(base) && !TECH_DESIGN_NAME_RE.test(base)) {
      return {
        ok: false,
        code: ERROR_CODES.ARTIFACT_PATH_INVALID,
        message:
          'requirements/*/02-* is reserved for 技术方案 (technical design). Analysis/inventory reports must go under reports/analysis/…'
      }
    }
  }
  if (slot === '04') {
    if (FORBIDDEN_02_NAME_RE.test(base) && !/实施计划|implementation-plan|实施計畫/i.test(base)) {
      return {
        ok: false,
        code: ERROR_CODES.ARTIFACT_PATH_INVALID,
        message:
          'requirements/*/04-* is reserved for 实施计划. Do not place analysis reports in the plan slot.'
      }
    }
  }
  return { ok: true, code: null, message: null }
}

function classifyPathsForArtifacts(paths) {
  for (const p of paths || []) {
    const r = classifyRequirementsArtifactPath(p)
    if (!r.ok) return r
  }
  return { ok: true, code: null, message: null }
}

/**
 * Completion / R3 checklist presence for Stop gate.
 * @param {{ completionClaimed?: boolean, reviewClass?: string, text?: string, hasReviewChecklistPath?: boolean }} input
 */
function classifyReviewChecklistCompletion(input = {}) {
  const text = String(input.text || '')
  const claimed =
    input.completionClaimed === true ||
    /已完成|任务完成|all work is complete|宣告完成|可关闭需求/i.test(text)
  const r3 =
    input.reviewClass === 'R3' ||
    input.reviewClass === 'R4' ||
    /reviewClass\s*[=:]\s*R[34]|c19Label[^\n]*全面|控制面.*完成|ECR.*R3/i.test(text)
  const hasPath =
    input.hasReviewChecklistPath === true ||
    /review-checklists[/\\]|复审清单[^\n]{0,80}\.md|03-复审清单/i.test(text)

  if (claimed && r3 && !hasPath) {
    return {
      ok: false,
      code: ERROR_CODES.REVIEW_CHECKLIST_MISSING,
      gap: ERROR_CODES.REVIEW_CHECKLIST_MISSING
    }
  }
  return { ok: true, code: null, gap: null }
}

/**
 * Control-plane / multi-batch process package: 04 plan + 05 progress + review checklist.
 * Used by Stop gate so agents cannot claim completion with only code/E2E green.
 *
 * @param {{
 *   completionClaimed?: boolean,
 *   text?: string,
 *   controlPlaneTask?: boolean,
 *   multiBatch?: boolean,
 *   hasImplementationPlan?: boolean,
 *   hasProgressFile?: boolean,
 *   hasReviewChecklist?: boolean,
 *   taskRoot?: string|null,
 *   fs?: { existsSync?: Function }
 * }} input
 */
function classifyProcessArtifactCompleteness(input = {}) {
  const text = String(input.text || '')
  const claimed =
    input.completionClaimed === true ||
    /已完成|任务完成|all work is complete|宣告完成|可关闭需求|本需求.*闭环|DoD.*闭环/i.test(text)

  const controlPlane =
    input.controlPlaneTask === true ||
    /控制面|hooks\/|process-enforcement|MutationCpGate|HostEnforcementMatrix|lifecycle\.cjs/i.test(text)
  const multiBatch =
    input.multiBatch === true ||
    /Phase-[A-F]|Batch\s*[A-F1-9]|多批次|多阶段实施/i.test(text)
  const highProcess = controlPlane || multiBatch ||
    input.reviewClass === 'R3' ||
    input.reviewClass === 'R4' ||
    /reviewClass\s*[=:]\s*R[34]|c19Label[^\n]*全面/i.test(text)

  if (!claimed || !highProcess) {
    return { ok: true, code: null, gap: null, missing: [] }
  }

  let hasPlan = input.hasImplementationPlan === true || /04-实施计划\.md/i.test(text)
  let hasProgress = input.hasProgressFile === true || /05-实施进度\.md/i.test(text)
  let hasChecklist =
    input.hasReviewChecklist === true ||
    /review-checklists[/\\]|03-复审清单|复审清单[^\n]{0,80}\.md/i.test(text)

  // Optional disk probe when taskRoot + fs provided (Stop gate)
  const root = input.taskRoot
  const fsys = input.fs
  if (root && fsys && typeof fsys.existsSync === 'function') {
    const pathMod = require('path')
    if (fsys.existsSync(pathMod.join(root, '04-实施计划.md'))) hasPlan = true
    if (fsys.existsSync(pathMod.join(root, '05-实施进度.md'))) hasProgress = true
    try {
      const names = fsys.readdirSync ? fsys.readdirSync(root) : []
      if (names.some(n => /复审清单|review-checklist/i.test(String(n)))) hasChecklist = true
    } catch {
      /* ignore */
    }
  }

  const missing = []
  if (!hasPlan) missing.push('04-实施计划')
  if (!hasProgress) missing.push('05-实施进度')
  if (!hasChecklist) missing.push('review-checklist')

  if (missing.length) {
    const gap =
      !hasProgress && missing.length === 1
        ? ERROR_CODES.PROGRESS_ARTIFACT_MISSING
        : !hasChecklist && missing.length === 1
          ? ERROR_CODES.REVIEW_CHECKLIST_MISSING
          : ERROR_CODES.PROCESS_ARTIFACT_INCOMPLETE
    return {
      ok: false,
      code: gap,
      gap,
      missing
    }
  }
  return { ok: true, code: null, gap: null, missing: [] }
}

/**
 * Probe 04 + 05 + review checklist under a requirement/bug task root.
 * @param {string} taskRoot
 * @param {{ existsSync?: Function, readdirSync?: Function }} [fsys]
 * @returns {{ hasPlan: boolean, hasProgress: boolean, hasChecklist: boolean, missing: string[] }}
 */
function probeProcessTriad (taskRoot, fsys = null) {
  const pathMod = require('path')
  const fsImpl = fsys || require('fs')
  const root = String(taskRoot || '')
  const missing = []
  let hasPlan = false
  let hasProgress = false
  let hasChecklist = false
  if (!root) {
    return { hasPlan: false, hasProgress: false, hasChecklist: false, missing: ['taskRoot'] }
  }
  try {
    if (fsImpl.existsSync(pathMod.join(root, '04-实施计划.md'))) hasPlan = true
    else missing.push('04-实施计划')
    if (fsImpl.existsSync(pathMod.join(root, '05-实施进度.md'))) hasProgress = true
    else missing.push('05-实施进度')
    const names = fsImpl.readdirSync ? fsImpl.readdirSync(root) : []
    if (names.some((n) => /复审清单|review-checklist/i.test(String(n)))) hasChecklist = true
    else missing.push('review-checklist')
  } catch {
    return {
      hasPlan: false,
      hasProgress: false,
      hasChecklist: false,
      missing: ['taskRoot-unreadable']
    }
  }
  return { hasPlan, hasProgress, hasChecklist, missing }
}

/**
 * Implement-start / control-plane mutation gate (pre-coding, not only completion).
 * When mutating protected control-plane paths for an active task, 04+05+checklist must exist.
 *
 * @param {{
 *   controlPlaneMutation?: boolean,
 *   implementStart?: boolean,
 *   taskRoot?: string|null,
 *   fs?: { existsSync?: Function, readdirSync?: Function },
 *   skip?: boolean
 * }} input
 * @returns {{ ok: boolean, code: string|null, missing: string[], triad: object|null }}
 */
function listDirNames (root, fsImpl) {
  try {
    if (!fsImpl || typeof fsImpl.readdirSync !== 'function') return []
    return fsImpl.readdirSync(root)
  } catch {
    return []
  }
}

function probeDesignArtifacts (taskRoot, fsImpl) {
  const fsx = fsImpl || { existsSync: () => false, readdirSync: () => [] }
  const names = listDirNames(taskRoot, fsx)
  const has01 = names.some(n =>
    /^01-.*需求确认/i.test(n) ||
    /^01-.*问题确认/i.test(n) ||
    /^01-.*产品需求/i.test(n) ||
    n === '01-需求确认.md' ||
    n === '01-问题确认.md'
  ) || (fsx.existsSync && (
    fsx.existsSync(path.join(taskRoot, '01-需求确认.md')) ||
    fsx.existsSync(path.join(taskRoot, '01-问题确认.md'))
  ))
  const has02 = names.some(n =>
    /^02-.*技术方案/i.test(n) ||
    n === '02-技术方案.md'
  ) || (fsx.existsSync && fsx.existsSync(path.join(taskRoot, '02-技术方案.md')))
  const has00 = names.some(n =>
    /^00-.*概况/i.test(n) ||
    n === '00-需求概况.md' ||
    n === '00-问题概况.md'
  ) || (fsx.existsSync && (
    fsx.existsSync(path.join(taskRoot, '00-需求概况.md')) ||
    fsx.existsSync(path.join(taskRoot, '00-问题概况.md'))
  ))
  return { has00, has01, has02 }
}

function classifyImplementStartGate (input = {}) {
  if (input.skip === true) {
    return { ok: true, code: null, missing: [], triad: null }
  }
  const needsGate =
    input.controlPlaneMutation === true ||
    input.implementStart === true
  if (!needsGate) {
    return { ok: true, code: null, missing: [], triad: null }
  }
  const root = input.taskRoot
  if (!root) {
    // Fail-closed: unbound control-plane mutation was the loophole for
    // "will follow process" then edit scripts/hooks without any requirement dir.
    return {
      ok: false,
      code: ERROR_CODES.IMPLEMENT_START_WITHOUT_TASK_BINDING,
      missing: ['bound-requirement-or-bug-task'],
      triad: null,
      unbound: true
    }
  }
  const fsImpl = input.fs || null
  const triad = probeProcessTriad(root, fsImpl)
  if (triad.missing.length) {
    return {
      ok: false,
      code: ERROR_CODES.IMPLEMENT_START_WITHOUT_PROCESS,
      missing: triad.missing,
      triad
    }
  }
  // Control-plane / implement-start also need design artifacts (概况/确认/方案 at least 01+02 or 02)
  const requireDesign = input.requireDesignArtifacts !== false
  if (requireDesign && input.controlPlaneMutation === true) {
    const design = probeDesignArtifacts(root, fsImpl)
    const missingDesign = []
    if (!design.has02) missingDesign.push('02-技术方案.md')
    if (!design.has01 && !design.has00) missingDesign.push('00-概况-or-01-确认')
    // Prefer 02 always; also require 00 or 01 so pure-02 without product intake is not enough alone for full CP story
    if (!design.has02 || (!design.has01 && !design.has00)) {
      return {
        ok: false,
        code: ERROR_CODES.IMPLEMENT_START_WITHOUT_DESIGN,
        missing: missingDesign.length ? missingDesign : ['01-需求确认.md', '02-技术方案.md'],
        triad,
        design
      }
    }
  }
  return { ok: true, code: null, missing: [], triad }
}

function simpleTaskForbidsPath(filePath) {
  const n = normalizePath(filePath)
  if (/website[/\\]docs/i.test(n)) return true
  if (STRICT_PROTECTED_PATH_RE.test(n) && !/[/\\]\.devcodex[/\\]/i.test(n)) return true
  return false
}

function isDeliveryHonestyExempt (text) {
  return /SimpleTaskFastPath|报告\s*[：:]\s*N\/A|report\s*[：:=]\s*N\/A|skipReason\s*[：:=]\s*(?:simple-task|simple_task|probe|chat)|mode\s*[=:]\s*chat/i.test(
    String(text || '')
  )
}

function hasStageReportPath (text) {
  return /reports[/\\]|requirements[/\\][^\n]+[/\\]reports[/\\]|阶段.*报告|\d{8}--.+\.md/i.test(
    String(text || '')
  )
}

function hasValidationEvidence (text) {
  const t = String(text || '')
  return (
    /exitCode\s*[:=]?\s*0|验证摘要|FinalValidationSummary|npm run test:/i.test(t) &&
    /exitCode|exit\s*0|PASS|passed/i.test(t)
  )
}

function looksLikeOverclaim (text) {
  return /5\s*\/\s*6|全部完成|全部✅|全绿|Fix-[0-9A-F].*全\s*✅|只差验收|可关闭需求|需求已完成|100%\s*完成/i.test(
    String(text || '')
  )
}

/**
 * Delivery honesty: stage report path + progress over-claim (A/B/H).
 * @param {{ completionClaimed?: boolean, text?: string, mode?: string, workflow?: string, mutated?: boolean }} input
 */
function classifyDeliveryHonesty (input = {}) {
  const text = String(input.text || '')
  const mode = String(input.mode || '').toLowerCase()
  const wf = String(input.workflow || mode || '').toLowerCase()
  // Strong closure claims only — do not treat mere 「完成检查」block as stage-report duty
  const strongClaim =
    input.completionClaimed === true ||
    /已完成|任务完成|all work is complete|宣告完成|可关闭需求|本需求.*闭环|DoD.*闭环|只差验收/i.test(text)

  if (!strongClaim) return { ok: true, gaps: [], code: null, gap: null }
  if (mode === 'chat' || wf === 'chat') return { ok: true, gaps: [], code: null, gap: null }
  if (isDeliveryHonestyExempt(text)) return { ok: true, gaps: [], code: null, gap: null }

  const gaps = []
  const nonChatWork =
    input.mutated === true ||
    ['dev', 'fix', 'self-fix'].includes(mode) ||
    ['dev', 'fix', 'self-fix'].includes(wf) ||
    /控制面|ECR|实施|Fix-|Phase-|多文件|website\/docs/i.test(text)

  if (nonChatWork && !hasStageReportPath(text)) {
    gaps.push(ERROR_CODES.STAGE_REPORT_MISSING)
  }
  if (looksLikeOverclaim(text) && !hasValidationEvidence(text)) {
    gaps.push(ERROR_CODES.PROGRESS_OVERCLAIM)
  }

  if (gaps.length) {
    return {
      ok: false,
      gaps,
      code: gaps[0],
      gap: gaps[0]
    }
  }
  return { ok: true, gaps: [], code: null, gap: null }
}

/**
 * ECR / N6 execution-closure evidence for strong completion claims.
 * @param {{ completionClaimed?: boolean, text?: string, mode?: string, workflow?: string }} input
 */
function classifyEcrClosure (input = {}) {
  const text = String(input.text || '')
  const mode = String(input.mode || '').toLowerCase()
  const wf = String(input.workflow || mode || '').toLowerCase()
  const strongClaim =
    input.completionClaimed === true ||
    /已完成|任务完成|all work is complete|宣告完成|可关闭需求|本需求.*闭环|DoD.*闭环|只差验收|需求已完成/i.test(
      text
    )

  if (!strongClaim) return { ok: true, code: null, gap: null }
  if (mode === 'chat' || wf === 'chat') return { ok: true, code: null, gap: null }
  if (isDeliveryHonestyExempt(text)) return { ok: true, code: null, gap: null }

  // Explicit N/A with whitelist skipReason
  if (/ECR\s*[:：]\s*N\/A/i.test(text) && /skipReason\s*[=:：]\s*(chat|simple-task|simple_task|probe)/i.test(text)) {
    return { ok: true, code: null, gap: null }
  }

  const hasEcrHeading = /ECR|执行闭环复审|Execution\s*Closure\s*Review/i.test(text)
  const hasDodMatrix =
    /DoD|ECR-[1-7]|对账|ECR\s*矩阵|闭环复审/i.test(text) && /\|/.test(text)
  const hasEcrReportPath =
    /reports[/\\][^\s)\]`]+ECR[^\s)\]`]*\.md|ECR[^\n]{0,40}\.md|阶段诚实状态报告|执行闭环/i.test(text)

  if (hasEcrHeading && hasDodMatrix) return { ok: true, code: null, gap: null }
  if (hasEcrReportPath && (hasEcrHeading || hasDodMatrix || /DoD\s*对账/i.test(text))) {
    return { ok: true, code: null, gap: null }
  }
  // Path alone to a report named ECR is enough if strong claim already requires care
  if (/reports[/\\][^\s)\]`]*ECR[^\s)\]`]*\.md/i.test(text)) {
    return { ok: true, code: null, gap: null }
  }

  return {
    ok: false,
    code: ERROR_CODES.ECR_MISSING,
    gap: ERROR_CODES.ECR_MISSING
  }
}

/**
 * Requirement-dir review checklist discoverability (C).
 * @param {{ taskRoot?: string|null, fs?: { readdirSync?: Function }, text?: string }} input
 */
function classifyReviewChecklistDiscoverability (input = {}) {
  const text = String(input.text || '')
  if (/03-复审清单|review-checklists[/\\]/i.test(text)) {
    return { ok: true, gap: null }
  }
  const root = input.taskRoot
  const fsys = input.fs
  if (root && fsys && typeof fsys.readdirSync === 'function') {
    try {
      const names = fsys.readdirSync(root)
      if (names.some((n) => /复审清单|review-checklist/i.test(String(n)))) {
        return { ok: true, gap: null }
      }
    } catch {
      /* ignore */
    }
  }
  // Only fail when completion claimed + R3 (caller combines with classifyReviewChecklistCompletion)
  return { ok: true, gap: null, note: 'use-with-checklist-classifier' }
}

module.exports = {
  ERROR_CODES,
  STRICT_PROTECTED_PATH_RE,
  isStrictProtectedPath,
  pathsIncludeStrictProtected,
  shouldHardDenyCpMutation,
  classifyRequirementsArtifactPath,
  classifyPathsForArtifacts,
  classifyReviewChecklistCompletion,
  classifyProcessArtifactCompleteness,
  probeProcessTriad,
  classifyImplementStartGate,
  classifyDeliveryHonesty,
  classifyEcrClosure,
  classifyReviewChecklistDiscoverability,
  simpleTaskForbidsPath,
  normalizePath,
  hasStageReportPath,
  looksLikeOverclaim,
  hasValidationEvidence
}
