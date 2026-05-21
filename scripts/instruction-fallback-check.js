#!/usr/bin/env node
/**
 * DevCodex v1.9.6+ instruction-fallback soft-gate (P-002/P-003 mitigation)
 *
 * For hosts without Workspace Hooks (jetbrains-copilot / cursor / instruction-fallback),
 * this script enforces CP gating at git-commit time:
 *   1. If staged changes include source files (non-doc, non-.devcodex)
 *      AND there exists an active requirement under requirements/ without CP3 confirmed
 *      → exit 1 with explanation.
 *   2. If commit message indicates dev work but no CP markers visible in recent memory
 *      → warning (exit 0).
 *
 * Wire as `.husky/pre-commit` or git pre-commit hook:
 *   node scripts/instruction-fallback-check.js || exit 1
 *
 * Skip via SKIP_DEVCODEX_FALLBACK=1 env var.
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

if (process.env.SKIP_DEVCODEX_FALLBACK === '1') {
  console.log('[devcodex] instruction-fallback-check skipped via SKIP_DEVCODEX_FALLBACK=1')
  process.exit(0)
}

const cwd = process.cwd()

function getStagedFiles() {
  try {
    return execSync('git diff --cached --name-only', { encoding: 'utf8' })
      .split('\n').filter(Boolean)
  } catch { return [] }
}

const SOURCE_EXTS = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.kt', '.swift', '.rb', '.php', '.c', '.cc', '.cpp', '.h', '.hpp', '.sql'])
function isSourceFile(p) {
  if (p.startsWith('.devcodex/') || p.startsWith('.claude/') || p.startsWith('.github/')) return false
  if (p.startsWith('docs/') || p.endsWith('.md') || p.endsWith('.json')) return false
  return SOURCE_EXTS.has(path.extname(p))
}

function findActiveRequirements() {
  const reqRoot = path.join(cwd, 'requirements')
  if (!fs.existsSync(reqRoot)) return []
  const out = []
  function walk(dir, depth) {
    if (depth > 4) return
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const full = path.join(dir, e.name)
      const cp1 = path.join(full, '01-需求概述.md')
      const sessions = path.join(full, '.memory', 'sessions.md')
      if (fs.existsSync(cp1) && fs.existsSync(sessions)) {
        const text = fs.readFileSync(sessions, 'utf8')
        const cp3Done = /CP3[^\n]*✅|CP3[^\n]*已确认|CP3[^\n]*confirmed|CP3[^\n]*N\/A/i.test(text)
        if (!cp3Done) out.push(path.relative(cwd, full))
      } else {
        walk(full, depth + 1)
      }
    }
  }
  walk(reqRoot, 0)
  return out
}

const staged = getStagedFiles()
const sourceStaged = staged.filter(isSourceFile)
if (sourceStaged.length === 0) {
  process.exit(0)
}

const incomplete = findActiveRequirements()
if (incomplete.length > 0) {
  console.error('')
  console.error('❌ DevCodex instruction-fallback gate (v1.9.6+): CP3 unconfirmed for active requirement(s).')
  console.error('   Staged source files:')
  sourceStaged.slice(0, 10).forEach(f => console.error(`     - ${f}`))
  console.error('   Incomplete requirement(s):')
  incomplete.slice(0, 5).forEach(r => console.error(`     - ${r}`))
  console.error('')
  console.error('   Fix: complete CP3 confirmation in <requirement>/.memory/sessions.md, or bypass with SKIP_DEVCODEX_FALLBACK=1.')
  process.exit(1)
}

process.exit(0)
