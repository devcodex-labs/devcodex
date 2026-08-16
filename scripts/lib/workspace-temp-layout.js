'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  PROJECT_ROOT_MARKERS,
  findLayoutInfo,
  inferProjectFromCwd,
  joinNamespaceSegments,
  normalizeProjectNamespace,
  splitNamespace
} = require('../../hooks/_runtime/workspace-layout.cjs')

const RUNTIME_CONTENT_ROOTS = new Set([
  'profile', '.memory', '.audit-state', '.runtime-state', 'requirements', 'bugs',
  'optimizations', 'scenario-tests', 'reports', 'data', 'migrations'
])

function resolveLegacyWorkspaceRoot(absoluteInput) {
  const absolute = path.resolve(absoluteInput)
  const tempBoundary = path.resolve(os.tmpdir())
  let current = absolute
  while (true) {
    if (path.basename(current).toLocaleLowerCase('en-US') === '.devcodex') {
      return path.dirname(current)
    }
    if (current === tempBoundary) return absolute
    if (fs.existsSync(path.join(current, '.devcodex')) ||
        PROJECT_ROOT_MARKERS.some(marker => fs.existsSync(path.join(current, marker)))) {
      return current
    }
    const parent = path.dirname(current)
    if (parent === current) return absolute
    current = parent
  }
}

/** Resolve the only write root for disposable workspace artifacts. */
function resolveWorkspaceTempRoot(cwdOrActiveRoot) {
  const absolute = path.resolve(cwdOrActiveRoot)
  const layout = findLayoutInfo(absolute)
  if (layout.enabled) {
    return path.join(layout.workspaceRoot, '.tmp', 'devcodex')
  }
  return path.join(resolveLegacyWorkspaceRoot(absolute), '.tmp', 'devcodex')
}

/** Return the namespace used to partition project-owned temporary artifacts. */
function resolveWorkspaceTempProject(cwdOrActiveRoot, explicitProject = '') {
  const absolute = path.resolve(cwdOrActiveRoot)
  const layout = findLayoutInfo(absolute)
  if (layout.enabled) {
    if (String(explicitProject || '').trim()) {
      return normalizeProjectNamespace(explicitProject, { layout, allowEmpty: false })
    }
    const inferred = inferProjectFromCwd(absolute, layout)
    if (inferred) return normalizeProjectNamespace(inferred, { layout, allowEmpty: false })

    const namespaceBase = path.join(layout.workspaceRoot, '.devcodex')
    const relative = path.relative(namespaceBase, absolute)
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      const segments = relative.split(path.sep).filter(Boolean)
      const boundaryIndex = segments.findIndex((segment, index) => (
        index > 0 && RUNTIME_CONTENT_ROOTS.has(segment.toLocaleLowerCase('en-US'))
      ))
      const namespaceSegments = segments.slice(0, boundaryIndex < 0 ? segments.length : boundaryIndex)
      let current = path.join(namespaceBase, ...namespaceSegments)
      while (current !== namespaceBase) {
        if (fs.existsSync(path.join(current, 'profile'))) {
          const runtimeNamespace = joinNamespaceSegments(path.relative(namespaceBase, current).split(path.sep).filter(Boolean))
          if (runtimeNamespace === 'workspace') return 'workspace'
          if (runtimeNamespace) return normalizeProjectNamespace(runtimeNamespace, { layout, allowEmpty: false })
        }
        const parent = path.dirname(current)
        const parentRelative = path.relative(namespaceBase, parent)
        if (parent === current || parentRelative.startsWith('..') || path.isAbsolute(parentRelative)) break
        current = parent
      }
      const derived = joinNamespaceSegments(namespaceSegments)
      if (derived && derived !== 'workspace') {
        return normalizeProjectNamespace(derived, { layout, allowEmpty: false })
      }
    }
    return 'workspace'
  }

  const projectRoot = resolveLegacyWorkspaceRoot(absolute)
  const project = String(explicitProject || '') || path.basename(projectRoot) || 'workspace'
  if (!explicitProject && project === 'workspace') return 'workspace'
  return normalizeProjectNamespace(project, { layout, allowEmpty: false })
}

/** Resolve the project-partitioned backup root beneath the canonical temp root. */
function resolveWorkspaceTempBackupRoot(cwdOrActiveRoot, explicitProject = '') {
  const project = resolveWorkspaceTempProject(cwdOrActiveRoot, explicitProject)
  return path.join(resolveWorkspaceTempRoot(cwdOrActiveRoot), 'backups', ...splitNamespace(project))
}

module.exports = {
  resolveWorkspaceTempBackupRoot,
  resolveWorkspaceTempProject,
  resolveWorkspaceTempRoot
}
