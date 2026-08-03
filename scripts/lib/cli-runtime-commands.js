'use strict'

const fs = require('fs')
const path = require('path')
const { createCliFailure, createCliSuccess, printCliJson } = require('./cli-json-contract.js')
const { resolveActiveRuntimeRoot, resolveRuntimeStateRoots } = require('../../hooks/_runtime/workspace-layout.cjs')

const STATUS_SCHEMA = 'RuntimeStateStatusV1'
const PRUNE_SCHEMA = 'RuntimeStatePruneV1'
const MAX_ENTRIES = 10000
const TEMP_TTL_MS = 24 * 60 * 60 * 1000

const OWNER_BY_CATEGORY = Object.freeze({
  'context-plan-cache': 'profile-context-plan',
  'context-plan-observations': 'context-read',
  'derived-indexes': 'derived-index-store',
  'execution-optimization': 'execution-optimization',
  'memory-locks': 'memory-server',
  'project-knowledge': 'project-knowledge',
  'skill-route': 'skill-route',
  'validation-evidence': 'validation-dag',
  'workflow-completion': 'workflow-completion'
})

function walkBounded(root, { excludedTopLevel = [] } = {}) {
  if (!fs.existsSync(root)) return { entries: [], truncated: false }
  const excluded = new Set(excludedTopLevel)
  const pending = [{ dir: root, depth: 0 }]
  const entries = []
  while (pending.length && entries.length < MAX_ENTRIES) {
    const { dir: current, depth } = pending.pop()
    let children
    try { children = fs.readdirSync(current, { withFileTypes: true }) } catch { continue }
    for (const child of children) {
      const absolute = path.join(current, child.name)
      if (child.isDirectory() && !(depth === 0 && excluded.has(child.name))) pending.push({ dir: absolute, depth: depth + 1 })
      else if (child.isFile()) {
        let stats
        try { stats = fs.statSync(absolute) } catch { continue }
        entries.push({ path: absolute, bytes: stats.size, modifiedMs: stats.mtimeMs })
        if (entries.length >= MAX_ENTRIES) break
      }
    }
  }
  return { entries, truncated: pending.length > 0 }
}

function summarizeRoot(root, role, nowMs) {
  const observed = walkBounded(root, { excludedTopLevel: role === 'legacy-read-only' ? ['workspace', 'projects'] : [] })
  const categories = new Map()
  const candidates = []
  const blocked = []
  for (const entry of observed.entries) {
    const relative = path.relative(root, entry.path)
    const category = relative.split(path.sep)[0] || '(root)'
    const current = categories.get(category) || {
      category,
      owner: OWNER_BY_CATEGORY[category] || 'runtime-kernel',
      files: 0,
      bytes: 0,
      lastUsedAt: null
    }
    current.files += 1
    current.bytes += entry.bytes
    if (!current.lastUsedAt || entry.modifiedMs > Date.parse(current.lastUsedAt)) {
      current.lastUsedAt = new Date(entry.modifiedMs).toISOString()
    }
    categories.set(category, current)

    const name = path.basename(entry.path)
    const ageMs = Math.max(0, nowMs - entry.modifiedMs)
    if (name.endsWith('.lock')) {
      blocked.push({ path: entry.path, reason: 'lock-file-never-auto-pruned', ageMs })
    } else if (/\.tmp-[A-Za-z0-9._-]+$/.test(name) && ageMs >= TEMP_TTL_MS) {
      candidates.push({ path: entry.path, reason: 'expired-atomic-write-temp', ageMs, bytes: entry.bytes })
    }
  }
  return {
    root,
    role,
    exists: fs.existsSync(root),
    files: observed.entries.length,
    bytes: observed.entries.reduce((total, entry) => total + entry.bytes, 0),
    truncated: observed.truncated,
    categories: [...categories.values()].sort((a, b) => a.category.localeCompare(b.category)),
    candidates,
    blocked
  }
}

function inspectRuntimeState(cwd, nowMs = Date.now()) {
  const activeRoot = resolveActiveRuntimeRoot(cwd)
  const roots = resolveRuntimeStateRoots(activeRoot)
  const partitions = [
    summarizeRoot(roots.primaryRoot, 'canonical-write', nowMs),
    ...roots.legacyReadRoots.map(root => summarizeRoot(root, 'legacy-read-only', nowMs))
  ]
  return {
    schemaVersion: STATUS_SCHEMA,
    cwd: path.resolve(cwd),
    activeRoot,
    canonicalRoot: roots.primaryRoot,
    project: roots.project,
    partitions,
    totals: {
      files: partitions.reduce((total, item) => total + item.files, 0),
      bytes: partitions.reduce((total, item) => total + item.bytes, 0),
      pruneCandidates: partitions.filter(item => item.role === 'canonical-write').reduce((total, item) => total + item.candidates.length, 0),
      blockedLocks: partitions.reduce((total, item) => total + item.blocked.length, 0)
    }
  }
}

function buildCliRuntimeCommands({ process, console, c, cliMetadata = {} }) {
  function fail(message, json) {
    const failure = createCliFailure('runtime', 'CLI_INVALID_OPTION', message, 'Use `devcodex runtime status [--json]` or `devcodex runtime prune [--dry-run|--apply] [--json]`.', cliMetadata)
    if (json) printCliJson(console, failure)
    else console.log(c.red(`  ${failure.errorCode}: ${failure.message}`))
    process.exitCode = 2
    return failure
  }

  function cmdRuntime(argv = []) {
    const operation = argv[0]
    const options = argv.slice(1)
    const json = options.includes('--json')
    const unknown = options.filter(item => !['--json', '--dry-run', '--apply'].includes(item))
    if (!['status', 'prune'].includes(operation) || unknown.length) {
      return fail(unknown.length ? `Unknown runtime option: ${unknown[0]}` : `Unknown runtime subcommand: ${operation || '(none)'}`, json)
    }
    if (operation === 'status' && options.some(item => item === '--dry-run' || item === '--apply')) {
      return fail('runtime status accepts --json only.', json)
    }
    if (operation === 'prune' && options.includes('--dry-run') && options.includes('--apply')) {
      return fail('--dry-run and --apply are mutually exclusive.', json)
    }

    const status = inspectRuntimeState(process.cwd())
    if (operation === 'status') {
      if (json) printCliJson(console, createCliSuccess('runtime.status', status, cliMetadata))
      else {
        console.log(`\n  ${c.bold('DevCodex runtime state')} in ${status.cwd}`)
        for (const partition of status.partitions) {
          console.log(`  ${c.cyan(partition.role.padEnd(18))} ${partition.files} files, ${partition.bytes} bytes — ${partition.root}`)
          for (const category of partition.categories) {
            console.log(`    ${category.category}: owner=${category.owner}; files=${category.files}; bytes=${category.bytes}; last=${category.lastUsedAt}`)
          }
        }
      }
      return status
    }

    const apply = options.includes('--apply')
    const candidates = status.partitions.find(item => item.role === 'canonical-write')?.candidates || []
    const removed = []
    const failed = []
    if (apply) {
      const canonical = path.resolve(status.canonicalRoot)
      for (const candidate of candidates) {
        const target = path.resolve(candidate.path)
        const relative = path.relative(canonical, target)
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
          failed.push({ path: target, errorCode: 'RUNTIME_PRUNE_PATH_ESCAPE' })
          continue
        }
        try { fs.unlinkSync(target); removed.push(target) } catch (error) {
          failed.push({ path: target, errorCode: error.code || 'RUNTIME_PRUNE_FAILED', message: error.message })
        }
      }
    }
    const payload = {
      schemaVersion: PRUNE_SCHEMA,
      mode: apply ? 'apply' : 'dry-run',
      canonicalRoot: status.canonicalRoot,
      candidates,
      removed,
      failed,
      blocked: status.partitions.flatMap(item => item.blocked)
    }
    if (json) printCliJson(console, createCliSuccess('runtime.prune', payload, cliMetadata))
    else {
      console.log(`\n  ${c.bold('DevCodex runtime prune')} (${payload.mode})`)
      console.log(`  candidates: ${candidates.length}; removed: ${removed.length}; blocked locks: ${payload.blocked.length}; failed: ${failed.length}`)
      for (const candidate of candidates) console.log(`  ${apply ? c.green('removed') : c.yellow('would remove')} ${candidate.path}`)
    }
    if (failed.length) process.exitCode = 2
    return payload
  }

  return { cmdRuntime }
}

module.exports = { buildCliRuntimeCommands, inspectRuntimeState, TEMP_TTL_MS }
