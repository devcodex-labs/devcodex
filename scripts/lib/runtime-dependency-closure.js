'use strict'

const fs = require('fs')
const path = require('path')

const DEFAULT_RUNTIME_ROOTS = Object.freeze([
  'hooks/_runtime',
  'mcp'
])

function portable(filePath) {
  return String(filePath || '').replace(/\\/g, '/')
}

function walkRuntimeFiles(packageRoot, relativeRoot, fsImpl = fs) {
  const root = path.join(packageRoot, ...portable(relativeRoot).split('/'))
  if (!fsImpl.existsSync(root)) return []
  const stat = fsImpl.statSync(root)
  if (stat.isFile()) return /\.(?:cjs|js)$/i.test(root) ? [portable(relativeRoot)] : []
  const result = []
  const stack = [root]
  while (stack.length) {
    const current = stack.pop()
    for (const entry of fsImpl.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile() && /\.(?:cjs|js)$/i.test(entry.name)) {
        result.push(portable(path.relative(packageRoot, full)))
      }
    }
  }
  return result.sort()
}

function resolveRelativeModule(packageRoot, fromRelative, request, fsImpl = fs) {
  if (!request || !request.startsWith('.')) return null
  const fromDir = path.posix.dirname(portable(fromRelative))
  const base = path.posix.normalize(path.posix.join(fromDir, request))
  const candidates = /\.(?:cjs|js)$/i.test(base)
    ? [base]
    : [`${base}.js`, `${base}.cjs`, path.posix.join(base, 'index.js')]
  return candidates.find(candidate => fsImpl.existsSync(path.join(packageRoot, ...candidate.split('/')))) || null
}

function readPackageText(packageRoot, relative, fsImpl = fs) {
  return fsImpl.readFileSync(path.join(packageRoot, ...portable(relative).split('/')), 'utf8')
}

function collectRequireRequests(source) {
  const requests = []
  const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g
  let match
  while ((match = re.exec(source)) !== null) requests.push(match[1])
  return requests
}

/**
 * Capture path.join(__dirname, '..', '..', 'scripts', 'lib', 'file.js') style
 * runtime deps used when require() is dynamic after existsSync.
 * Returns portable package-relative paths under scripts/lib.
 */
function collectPathJoinScriptLibDeps(source) {
  const deps = []
  const patterns = [
    /path\.join\(\s*__dirname\s*,\s*(?:['"]\.\.['"]\s*,\s*){2}['"]scripts['"]\s*,\s*['"]lib['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g,
    /path\.join\(\s*__dirname\s*,\s*['"]\.\.\/\.\.\/scripts\/lib\/([^'"]+)['"]\s*\)/g
  ]
  for (const re of patterns) {
    let match
    while ((match = re.exec(source)) !== null) {
      const name = String(match[1] || '').replace(/\\/g, '/')
      if (!name) continue
      deps.push(portable(path.posix.join('scripts/lib', name)))
    }
  }
  return deps
}

function collectEdgesFromSource(packageRoot, fromRelative, source, fsImpl) {
  const edges = []
  for (const request of collectRequireRequests(source)) {
    const resolved = resolveRelativeModule(packageRoot, fromRelative, request, fsImpl)
    if (resolved) edges.push(resolved)
  }
  for (const dep of collectPathJoinScriptLibDeps(source)) {
    if (fsImpl.existsSync(path.join(packageRoot, ...dep.split('/')))) edges.push(dep)
  }
  return edges
}

function collectRuntimeScriptDeps(packageRoot, options = {}) {
  const fsImpl = options.fs || fs
  const roots = Array.isArray(options.roots) && options.roots.length
    ? options.roots
    : DEFAULT_RUNTIME_ROOTS
  const boundary = portable(options.boundary || 'scripts/lib')
  const required = new Set()
  const queue = []
  const entryFiles = roots.flatMap(root => walkRuntimeFiles(packageRoot, root, fsImpl))

  function enqueue(relative) {
    const normalized = portable(relative)
    if (!normalized.startsWith(`${boundary}/`)) return
    if (required.has(normalized)) return
    required.add(normalized)
    queue.push(normalized)
  }

  for (const entry of entryFiles) {
    const source = readPackageText(packageRoot, entry, fsImpl)
    for (const edge of collectEdgesFromSource(packageRoot, entry, source, fsImpl)) {
      enqueue(edge)
    }
  }

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]
    const source = readPackageText(packageRoot, current, fsImpl)
    for (const edge of collectEdgesFromSource(packageRoot, current, source, fsImpl)) {
      enqueue(edge)
    }
  }

  return [...required].sort()
}

function runtimeClosureCoverage(packageRoot, allowlist, options = {}) {
  const expected = collectRuntimeScriptDeps(packageRoot, options)
  const actual = new Set((allowlist || []).map(portable))
  const missing = expected.filter(dep => !actual.has(dep))
  const extra = [...actual].filter(dep => dep.startsWith('scripts/lib/') && !expected.includes(dep)).sort()
  return { expected, actual: [...actual].sort(), missing, extra }
}

function assertRuntimeClosureCovered(packageRoot, allowlist, options = {}) {
  const label = options.label || 'runtime dependency allowlist'
  const coverage = runtimeClosureCoverage(packageRoot, allowlist, options)
  if (coverage.missing.length) {
    const error = new Error(`${label} missing runtime closure deps: ${coverage.missing.join(', ')}`)
    error.code = 'RUNTIME_CLOSURE_ALLOWLIST_MISSING'
    error.coverage = coverage
    throw error
  }
  return coverage
}

module.exports = {
  DEFAULT_RUNTIME_ROOTS,
  collectRequireRequests,
  collectPathJoinScriptLibDeps,
  collectRuntimeScriptDeps,
  runtimeClosureCoverage,
  assertRuntimeClosureCovered
}
