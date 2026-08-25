#!/usr/bin/env node
/**
 * DevCodex v1.9.6+ instruction-fallback soft-gate (P-002/P-003 mitigation)
 *
 * For hosts without an active local Hook surface (jetbrains-copilot / Cursor Cloud / instruction-fallback),
 * this script enforces CP gating at git-commit time:
 *   1. If staged changes include source files (non-doc, non-.devcodex)
 *      AND there exists an active task under .devcodex/{requirements,bugs,optimizations,scenario-tests}/ without CP3 confirmed
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
const {
  resolveActiveRuntimeRoot,
  resolveHostWorkspaceBinding
} = require('../hooks/_runtime/workspace-layout.cjs')
const {
  hasTaskArtifact: registryHasTaskArtifact
} = require('../hooks/_runtime/artifact-slot-decision.cjs')
const {
  parseCpSessions,
  verifyArtifactDigest
} = require('./lib/cp-digest.js')

if (process.env.SKIP_DEVCODEX_FALLBACK === '1') {
  console.log('[devcodex] instruction-fallback-check skipped via SKIP_DEVCODEX_FALLBACK=1')
  process.exit(0)
}

const cwd = process.cwd()

function getActiveRoot() {
  return resolveActiveRuntimeRoot(cwd)
}

function getStagedFiles() {
  try {
    return execSync('git diff --cached --name-only', { encoding: 'utf8' })
      .split('\n').filter(Boolean)
  } catch { return [] }
}

const SOURCE_EXTS = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.kt', '.swift', '.rb', '.php', '.c', '.cc', '.cpp', '.h', '.hpp', '.sql'])
function isSourceFile(p) {
  if (p.startsWith('.devcodex/') || p.startsWith('.claude/') || p.startsWith('.github/')) return false
  if (p.startsWith('docs/') || p.endsWith('.md')) return false
  return SOURCE_EXTS.has(path.extname(p))
}

function getArtifactContext() {
  const binding = resolveHostWorkspaceBinding({ cwd })
  const activeRoot = binding?.activeRoot || getActiveRoot()
  return {
    activeRoot,
    project: binding?.projectNamespace || path.basename(cwd)
  }
}

function hasTaskArtifact(kind, full, phase) {
  const context = getArtifactContext()
  try {
    return registryHasTaskArtifact({ kind, fullPath: full }, phase, { fs, ...context })
  } catch {
    return false
  }
}

function hasConfirmedCp3(kind, full, sessionsText) {
  const parsed = parseCpSessions(sessionsText)
  if (parsed.CP3Exempt) return true
  const row = parsed.CP3
  if (!row?.confirmed) return false
  if (row.artifactSha256) return verifyArtifactDigest(full, row).ok === true
  return hasTaskArtifact(kind, full, 'CP3')
}

function findActiveTasks() {
  const taskRoots = [
    { kind: 'requirements', dir: path.join(getActiveRoot(), 'requirements') },
    { kind: 'bugs', dir: path.join(getActiveRoot(), 'bugs') },
    { kind: 'optimizations', dir: path.join(getActiveRoot(), 'optimizations') },
    { kind: 'scenario-tests', dir: path.join(getActiveRoot(), 'scenario-tests') }
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
      const cp3Done = hasConfirmedCp3(root.kind, full, text)
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
