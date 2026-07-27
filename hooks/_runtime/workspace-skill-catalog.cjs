'use strict'

/**
 * Workspace skill catalog (name + summary only) for intent selection.
 */

const crypto = require('crypto')
const {
  listWorkspaceSkillCandidates,
  parseFrontmatter
} = require('./workspace-skill-auto-match.cjs')

const MAX_SKILLS = 32
const MAX_SUMMARY = 160

function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex')
}

function truncateSummary(text, max = MAX_SUMMARY) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

/**
 * @returns {object} WorkspaceSkillCatalogV1
 */
function buildWorkspaceSkillCatalog(cwdOrOptions, maybeOptions) {
  const options = typeof cwdOrOptions === 'object' && cwdOrOptions && !maybeOptions
    ? cwdOrOptions
    : { ...(maybeOptions || {}), cwd: cwdOrOptions }
  const maxSkills = options.maxSkills || MAX_SKILLS
  const candidates = listWorkspaceSkillCandidates(options).slice(0, maxSkills)
  const skills = candidates.map(c => {
    const summary = truncateSummary(c.description || c.name || c.skillId)
    return {
      skillId: c.skillId,
      name: c.name || c.skillId,
      summary,
      tags: [],
      triggers: Array.isArray(c.triggers) ? c.triggers.slice(0, 8) : [],
      path: c.path
    }
  })
  const catalog = {
    schemaVersion: 'WorkspaceSkillCatalogV1',
    workspaceRoot: options.workspaceRoot || options.cwd || null,
    skills,
    scannedAt: new Date().toISOString(),
    candidatesScanned: candidates.length
  }
  catalog.digest = sha256Text(JSON.stringify({
    skills: skills.map(s => ({ id: s.skillId, name: s.name, summary: s.summary }))
  }))
  return catalog
}

function formatCatalogForInject(catalog) {
  if (!catalog || !Array.isArray(catalog.skills) || !catalog.skills.length) {
    return '### DevCodex · Workspace skills catalog\n(no workspace skills)\n'
  }
  const lines = [
    '### DevCodex · Workspace skills catalog',
    `digest: ${catalog.digest}`,
    'Only name+summary below are preloaded. Full SKILL.md loads after intent selection.',
    ''
  ]
  for (const s of catalog.skills) {
    lines.push(`- ${s.skillId}: ${s.summary || s.name}`)
  }
  lines.push('')
  return lines.join('\n')
}

module.exports = {
  MAX_SKILLS,
  MAX_SUMMARY,
  buildWorkspaceSkillCatalog,
  formatCatalogForInject,
  truncateSummary,
  sha256Text,
  parseFrontmatter
}
