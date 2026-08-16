'use strict'

const { createDerivedStateStore } = require('./derived-state-store.cjs')
const { resolveRuntimeStateRoots } = require('./workspace-layout.cjs')

/**
 * Canonical workspace-aware derived-state store. Reads prefer the canonical
 * partition and may fall back to an old project-local entry. Writes never
 * touch compatibility roots, preventing split-brain state.
 */
function createRuntimeStateStore({ activeRoot, project = '', relativePath, ...options }) {
  const roots = resolveRuntimeStateRoots(activeRoot, project)
  const primary = createDerivedStateStore({ root: roots.primaryRoot, relativePath, ...options })
  const compatibility = roots.legacyReadRoots.map(root => ({
    root,
    store: createDerivedStateStore({ root, relativePath, ...options, maxWrites: 0 })
  }))

  function read(readOptions = {}) {
    const current = primary.read(readOptions)
    if (current.status !== 'missing') return { ...current, stateSource: 'canonical' }
    for (const candidate of compatibility) {
      const observed = candidate.store.read(readOptions)
      if (observed.status !== 'missing') {
        return {
          ...observed,
          stateSource: 'legacy-read-only',
          canonicalFilePath: primary.filePath,
          legacyRoot: candidate.root
        }
      }
    }
    return { ...current, stateSource: 'canonical' }
  }

  return Object.freeze({
    filePath: primary.filePath,
    lockPath: primary.lockPath,
    roots,
    read,
    write: primary.write,
    update: primary.update
  })
}

module.exports = {
  createRuntimeStateStore
}
