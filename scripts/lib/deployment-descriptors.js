'use strict'

const path = require('path')
const { createSkillDeployFileFilter, isSkillsSource } = require('./skill-deploy-filter')
const { normalizeHostList, projectionDescriptors } = require('./host-surface-descriptors')
const { shouldIncludeInstructionFile } = require('./tenant-selection')

/**
 * Build managed-deployment descriptors for copilot/claude/codex surfaces.
 * HomologousDeployFilterGate: skills trees share the same gray filter as CLI copy.
 */
function buildDeploymentDescriptors(packageRoot, surfaces, {
  SOURCES,
  CLAUDE_SOURCES,
  CLAUDE_MCP_RUNTIME_SCRIPT_DEPS = [],
  CODEX_SOURCES,
  tenantId = null,
  grokWorkspaceBridge = false,
  grokWorkspaceScope = false
} = {}) {
  const selected = new Set(normalizeHostList(surfaces))
  const descriptors = []
  const skillFilter = createSkillDeployFileFilter(packageRoot)
  const descriptor = (surface, source, destination, role = null, replacesSurfaces = null) => {
    const filters = []
    if (source === 'instructions') {
      filters.push(relative => shouldIncludeInstructionFile(relative, tenantId))
    }
    if (isSkillsSource(source)) filters.push(skillFilter)
    return {
      surface,
      source,
      destination,
      ...(role ? { role } : {}),
      ...(Array.isArray(replacesSurfaces) && replacesSurfaces.length ? { replacesSurfaces } : {}),
      ...(filters.length ? { fileFilter: relative => filters.every(fn => fn(relative)) } : {})
    }
  }
  if (selected.has('copilot')) {
    descriptors.push(...SOURCES.map(item => descriptor('copilot', item.from, path.join('.github', item.to))))
    descriptors.push({ surface: 'copilot', source: 'RULES.md', destination: path.join('.github', 'RULES.md') })
  }
  if (selected.has('claude')) {
    descriptors.push(...CLAUDE_SOURCES.map(item => descriptor('claude', item.from, path.join('.claude', item.to))))
    // MCP runtime script deps for Claude: map package scripts/lib into .claude/scripts/lib
    for (const rel of CLAUDE_MCP_RUNTIME_SCRIPT_DEPS) {
      const portable = String(rel || '').replace(/\\/g, '/')
      if (!portable) continue
      descriptors.push(descriptor('claude', portable, path.join('.claude', ...portable.split('/'))))
    }
  }
  if (selected.has('codex')) {
    descriptors.push(...CODEX_SOURCES
      .filter(item => item.from !== 'skills')
      .map(item => descriptor('codex', item.from, item.to)))
  }
  for (const item of projectionDescriptors([...selected], { grokWorkspaceBridge, grokWorkspaceScope })) {
    descriptors.push(descriptor(item.surface, item.source, item.destination, item.role, item.replacesSurfaces))
  }
  return descriptors
}

module.exports = { buildDeploymentDescriptors }
