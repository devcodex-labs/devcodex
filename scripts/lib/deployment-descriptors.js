'use strict'

const path = require('path')
const { createSkillDeployFileFilter, isSkillsSource } = require('./skill-deploy-filter')
const { shouldIncludeInstructionFile } = require('./tenant-selection')

/**
 * Build managed-deployment descriptors for copilot/claude/codex surfaces.
 * HomologousDeployFilterGate: skills trees share the same gray filter as CLI copy.
 */
function buildDeploymentDescriptors(packageRoot, surfaces, {
  SOURCES,
  CLAUDE_SOURCES,
  CODEX_SOURCES,
  tenantId = null
} = {}) {
  const selected = new Set(surfaces)
  const descriptors = []
  const skillFilter = createSkillDeployFileFilter(packageRoot)
  const descriptor = (surface, source, destination) => {
    const filters = []
    if (source === 'instructions') {
      filters.push(relative => shouldIncludeInstructionFile(relative, tenantId))
    }
    if (isSkillsSource(source)) filters.push(skillFilter)
    return {
      surface,
      source,
      destination,
      ...(filters.length ? { fileFilter: relative => filters.every(fn => fn(relative)) } : {})
    }
  }
  if (selected.has('copilot')) {
    descriptors.push(...SOURCES.map(item => descriptor('copilot', item.from, path.join('.github', item.to))))
    descriptors.push(
      { surface: 'copilot', source: 'RULES.md', destination: path.join('.github', 'RULES.md') },
      { surface: 'copilot', source: 'instructions.md', destination: path.join('.github', 'copilot-instructions.md') }
    )
  }
  if (selected.has('claude')) {
    descriptors.push(...CLAUDE_SOURCES.map(item => descriptor('claude', item.from, path.join('.claude', item.to))))
    descriptors.push({ surface: 'claude', source: 'instructions.md', destination: 'CLAUDE.md' })
  }
  if (selected.has('codex')) {
    descriptors.push(...CODEX_SOURCES.map(item => descriptor('codex', item.from, item.to)))
    descriptors.push({ surface: 'codex', source: 'instructions.md', destination: 'AGENTS.md' })
  }
  return descriptors
}

module.exports = { buildDeploymentDescriptors }
