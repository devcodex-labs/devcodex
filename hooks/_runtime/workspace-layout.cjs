'use strict'

const fs = require('fs')
const path = require('path')

const RESERVED_NAMESPACE_ROOTS = new Set([
  'workspace',
  'profile',
  '.memory',
  'reports',
  'requirements',
  'bugs',
  'optimizations',
  'scenario-tests',
  'migrations',
  'layout.json',
  'task-index.md',
  'readme.md',
  '.devcodex'
])

const PROJECT_ROOT_MARKERS = [
  'package.json',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'composer.json',
  'Gemfile',
  'mix.exs',
  'Package.swift',
  '.git'
]

const CONTAINER_DIR_NAMES = new Set([
  'packages',
  'apps',
  'services',
  'libs',
  'modules',
  'projects'
])

const UTILITY_ROOT_DIR_NAMES = new Set([
  'tools',
  'tooling',
  'scripts',
  'docs',
  'website',
  'examples',
  'fixtures',
  'tests',
  'test'
])

function readJsonFile(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch { return null }
}

function findLayoutInfo(startDir) {
  let current = path.resolve(startDir)
  while (true) {
    const markerPath = path.join(current, '.devcodex', 'layout.json')
    const marker = readJsonFile(markerPath)
    if (marker && String(marker.mode || '').trim() === 'workspace-namespace') {
      return {
        enabled: true,
        mode: 'workspace-namespace',
        workspaceRoot: current,
        markerPath
      }
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return {
    enabled: false,
    mode: 'legacy-project-root',
    workspaceRoot: path.resolve(startDir),
    markerPath: null
  }
}

function normalizeNamespaceInput(value) {
  return String(value || '').trim().replace(/[\\/]+/g, '/')
}

function splitNamespace(value) {
  const normalized = normalizeNamespaceInput(value)
  return normalized.split('/').filter(Boolean)
}

function joinNamespaceSegments(segments) {
  return segments.filter(Boolean).join('/')
}

function namespaceRootPath(workspaceRoot, namespaceValue) {
  const segments = splitNamespace(namespaceValue)
  return path.join(workspaceRoot, '.devcodex', ...segments)
}

function namespaceHasRuntimeState(root) {
  return [
    'profile',
    '.memory',
    '.audit-state',
    'requirements',
    'bugs',
    'optimizations',
    'scenario-tests',
    'reports',
    'data'
  ].some(name => fs.existsSync(path.join(root, name)))
}

function namespaceExists(layout, namespaceValue) {
  if (!layout?.enabled) return false
  if (!namespaceValue) return false
  const root = namespaceRootPath(layout.workspaceRoot, namespaceValue)
  return fs.existsSync(root) && namespaceHasRuntimeState(root)
}

function hasProjectRootMarker(dir) {
  return PROJECT_ROOT_MARKERS.some(marker => fs.existsSync(path.join(dir, marker)))
}

function collectWorkspaceProjectNamespaces(workspaceRoot, { maxDepth = 3 } = {}) {
  const namespaces = new Set()
  const devcodexRoot = path.join(workspaceRoot, '.devcodex')

  function scanExistingNamespaces(root, relativeSegments = [], depth = 5) {
    if (depth < 0 || !fs.existsSync(root)) return
    let entries
    try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const name = String(entry.name || '').trim()
      if (!name) continue
      if (relativeSegments.length === 0 && RESERVED_NAMESPACE_ROOTS.has(name.toLowerCase())) continue
      const nextSegments = [...relativeSegments, name]
      const fullPath = path.join(root, name)
      if (fs.existsSync(path.join(fullPath, 'profile'))) {
        namespaces.add(joinNamespaceSegments(nextSegments))
      }
      scanExistingNamespaces(fullPath, nextSegments, depth - 1)
    }
  }

  function scanWorkspaceDirs(root, relativeSegments = [], depth = maxDepth) {
    if (depth < 0 || !fs.existsSync(root)) return
    let entries
    try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const name = String(entry.name || '').trim()
      if (!name || name.startsWith('.') || name === 'node_modules') continue
      const fullPath = path.join(root, name)
      const nextSegments = [...relativeSegments, name]
      const namespace = joinNamespaceSegments(nextSegments)
      const lowerName = name.toLowerCase()
      const isContainer = CONTAINER_DIR_NAMES.has(lowerName)
      const isUtilityRoot = relativeSegments.length === 0 && UTILITY_ROOT_DIR_NAMES.has(lowerName)
      const hasLegacyProfile = fs.existsSync(path.join(fullPath, '.devcodex', 'profile'))
      const hasNamespaceProfile = fs.existsSync(path.join(devcodexRoot, ...nextSegments, 'profile'))
      const hasMarker = hasProjectRootMarker(fullPath)
      const markerBackedProject = hasMarker && !isContainer && !isUtilityRoot
      if ((hasLegacyProfile || hasNamespaceProfile || markerBackedProject) && !isUtilityRoot) {
        namespaces.add(namespace)
      }
      if (depth > 0 && (isContainer || isUtilityRoot || relativeSegments.length === 0)) {
        scanWorkspaceDirs(fullPath, nextSegments, depth - 1)
      }
    }
  }

  scanExistingNamespaces(devcodexRoot)
  scanWorkspaceDirs(workspaceRoot)
  return [...namespaces].sort((left, right) => left.localeCompare(right))
}

function inferProjectFromCwd(cwd, layout) {
  if (!layout?.enabled) return ''
  const absoluteCwd = path.resolve(cwd)
  const relative = path.relative(layout.workspaceRoot, absoluteCwd)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return ''
  const segments = relative.split(path.sep).filter(Boolean)
  if (!segments.length) return ''
  if (segments[0] === '.devcodex' || segments[0] === 'workspace') return ''

  for (let length = segments.length; length >= 1; length--) {
    const candidate = joinNamespaceSegments(segments.slice(0, length))
    if (namespaceExists(layout, candidate)) return candidate
  }

  for (let length = segments.length; length >= 1; length--) {
    const dir = path.join(layout.workspaceRoot, ...segments.slice(0, length))
    if (hasProjectRootMarker(dir)) return joinNamespaceSegments(segments.slice(0, length))
  }

  return joinNamespaceSegments(segments)
}

function normalizeProjectNamespace(projectName, { layout, contextProject = '', allowEmpty = true } = {}) {
  const raw = normalizeNamespaceInput(projectName || contextProject)
  if (!raw) {
    if (allowEmpty) return ''
    throw new Error('project namespace is required')
  }
  if (path.isAbsolute(String(projectName || contextProject || ''))) {
    throw new Error(`project namespace must be workspace-relative, got absolute path: ${projectName || contextProject}`)
  }
  const segments = splitNamespace(raw)
  if (!segments.length) {
    if (allowEmpty) return ''
    throw new Error('project namespace is required')
  }
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new Error(`project namespace must not contain traversal segments: ${raw}`)
    }
  }
  const first = String(segments[0] || '').trim().toLowerCase()
  if (RESERVED_NAMESPACE_ROOTS.has(first)) {
    throw new Error(`project namespace root is reserved: ${segments[0]}`)
  }
  if (layout?.enabled) {
    const candidateRoot = namespaceRootPath(layout.workspaceRoot, joinNamespaceSegments(segments))
    const relative = path.relative(path.join(layout.workspaceRoot, '.devcodex'), candidateRoot)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`project namespace escapes workspace: ${raw}`)
    }
  }
  return joinNamespaceSegments(segments)
}

function resolveLegacyProjectRoot(inputRoot, projectName) {
  const absoluteInputRoot = path.resolve(inputRoot)
  const raw = String(projectName || '').trim()
  if (!raw || raw === '.' || raw === path.basename(absoluteInputRoot)) return absoluteInputRoot
  if (path.isAbsolute(raw)) {
    throw new Error(`legacy project root must not be absolute: ${raw}`)
  }
  if (/[\\/]/.test(raw)) {
    throw new Error(`legacy project root must not contain path separators: ${raw}`)
  }
  throw new Error(`legacy layout only supports the current project root, got: ${raw}`)
}

function resolveActiveRuntimeRoot(cwd) {
  const layout = findLayoutInfo(cwd)
  if (!layout.enabled) return path.join(path.resolve(cwd), '.devcodex')
  const project = inferProjectFromCwd(cwd, layout)
  return project
    ? namespaceRootPath(layout.workspaceRoot, project)
    : path.join(layout.workspaceRoot, '.devcodex', 'workspace')
}

function resolveProfileDir(cwd) {
  const layout = findLayoutInfo(cwd)
  if (!layout.enabled) return path.join(path.resolve(cwd), '.devcodex', 'profile')

  const project = inferProjectFromCwd(cwd, layout)
  const candidates = []
  if (project) candidates.push(path.join(namespaceRootPath(layout.workspaceRoot, project), 'profile'))
  candidates.push(path.join(layout.workspaceRoot, '.devcodex', 'workspace', 'profile'))
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0]
}

module.exports = {
  PROJECT_ROOT_MARKERS,
  RESERVED_NAMESPACE_ROOTS,
  CONTAINER_DIR_NAMES,
  UTILITY_ROOT_DIR_NAMES,
  collectWorkspaceProjectNamespaces,
  findLayoutInfo,
  inferProjectFromCwd,
  joinNamespaceSegments,
  namespaceRootPath,
  normalizeProjectNamespace,
  readJsonFile,
  resolveActiveRuntimeRoot,
  resolveLegacyProjectRoot,
  resolveProfileDir,
  splitNamespace
}
