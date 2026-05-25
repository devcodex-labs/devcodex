#!/usr/bin/env node
/**
 * DevCodex v1.9.6+ instruction-fallback soft-gate (P-002/P-003 mitigation)
 *
 * For hosts without Workspace Hooks (jetbrains-copilot / cursor / instruction-fallback),
 * this script enforces CP gating at git-commit time:
 *   1. If staged changes include source files (non-doc, non-.devcodex)
 *      AND there exists an active task under .devcodex/{requirements,bugs}/ without CP3 confirmed
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

function directoryContainsFileMatching(dir, matcher, depth = 4) {
  if (!fs.existsSync(dir) || depth < 0) return false
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return false }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isFile() && matcher(entry.name, full)) return true
    if (entry.isDirectory() && directoryContainsFileMatching(full, matcher, depth - 1)) return true
  }
  return false
}

function hasTaskArtifact(kind, full, phase) {
  if (phase === 'CP1') {
    if (fs.existsSync(path.join(full, '01-需求概述.md'))) return true
    if (kind === 'bugs') {
      return directoryContainsFileMatching(path.join(full, 'reports'), name => /^01--.*CP1.*\.md$/i.test(name))
    }
    return false
  }
  if (phase === 'CP2') {
    if (fs.existsSync(path.join(full, '02-技术方案.md'))) return true
    if (kind === 'bugs') {
      return directoryContainsFileMatching(path.join(full, 'reports'), name => /^02--.*CP2.*\.md$/i.test(name))
    }
    return false
  }
  if (phase === 'CP3') return fs.existsSync(path.join(full, '04-实施计划.md'))
  return false
}

function findActiveTasks() {
  const taskRoots = [
    { kind: 'requirements', dir: path.join(cwd, '.devcodex', 'requirements') },
    { kind: 'bugs', dir: path.join(cwd, '.devcodex', 'bugs') }
  ]
  const out = []
  for (const root of taskRoots) {
    if (!fs.existsSync(root.dir)) continue
    let entries
    try { entries = fs.readdirSync(root.dir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const full = path.join(root.dir, entry.name)
      if (fs.existsSync(path.join(full, '.archived'))) continue
      const sessions = path.join(full, '.memory', 'sessions.md')
      if (!hasTaskArtifact(root.kind, full, 'CP1') || !fs.existsSync(sessions)) continue
      const text = fs.readFileSync(sessions, 'utf8')
      const cp3Done = /CP3[^\n]*✅|CP3[^\n]*已确认|CP3[^\n]*confirmed|CP3[^\n]*N\/A/i.test(text)
      if (!cp3Done) {
        let mtimeMs = 0
        try { mtimeMs = fs.statSync(full).mtimeMs || 0 } catch { }
        out.push({ rel: path.relative(cwd, full), mtimeMs })
      }
    }
  }
  return out
    .sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0))
    .map(item => item.rel)
}

const staged = getStagedFiles()
const sourceStaged = staged.filter(isSourceFile)
if (sourceStaged.length === 0) {
  process.exit(0)
}

const incomplete = findActiveTasks()
if (incomplete.length > 0) {
  console.error('')
  console.error('❌ DevCodex instruction-fallback gate (v1.9.6+): CP3 unconfirmed for active task(s).')
  console.error('   Staged source files:')
  sourceStaged.slice(0, 10).forEach(f => console.error(`     - ${f}`))
  console.error('   Incomplete task(s):')
  incomplete.slice(0, 5).forEach(r => console.error(`     - ${r}`))
  console.error('')
  console.error('   Fix: complete CP3 confirmation in <task>/.memory/sessions.md, or bypass with SKIP_DEVCODEX_FALLBACK=1.')
  process.exit(1)
}

process.exit(0)
