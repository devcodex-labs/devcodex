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
  PROCESS_ARTIFACT_INCOMPLETE: 'process-artifact-incomplete'
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

function simpleTaskForbidsPath(filePath) {
  const n = normalizePath(filePath)
  if (/website[/\\]docs/i.test(n)) return true
  if (STRICT_PROTECTED_PATH_RE.test(n) && !/[/\\]\.devcodex[/\\]/i.test(n)) return true
  return false
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
  simpleTaskForbidsPath,
  normalizePath
}
