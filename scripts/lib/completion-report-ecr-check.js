'use strict'

/**
 * Dual-Track Closure M2 (PI-154 / PF-173): recent completed dev/fix reports must
 * show substance ECR evidence — not checkbox-only "ECR ✅".
 * Offline validate probe (P3). Does not hard-block live Grok turns.
 */

const fs = require('fs')
const path = require('path')

const RECENT_COMPLETION_REPORT_DAYS = 2
const REPORT_NAME_RE = /\.md$/i
const SKIP_DIR_RE = /(?:^|[\\/])(?:node_modules|\.git|website[\\/]node_modules)(?:[\\/]|$)/i

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

  if (!activeRoot || !fs.existsSync(activeRoot)) {
    return { checkedFiles, issues }
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

    // MVP (Dual-Track M2): fail checkbox-ECR only — claim ECR/completion table without production evidence.
    // Do not fail historical reports that never wrote an ECR section (would red-line entire active-root corpus).
    if (hasEcrSection(text) && !hasProductionEvidence(text)) {
      issues.push(`${rel}: completed report has ECR section but lacks production command evidence (e.g. test:core / exitCode=0)`)
    }
  }

  return { checkedFiles, issues }
}

module.exports = {
  RECENT_COMPLETION_REPORT_DAYS,
  collectRecentCompletedReportEcrIssues,
  hasEcrSection,
  hasProductionEvidence,
  looksLikeDevFixCompletionReport,
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
