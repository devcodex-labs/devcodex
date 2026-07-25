'use strict'

const fs = require('fs')
const path = require('path')

/**
 * HomologousDeployFilterGate helper: gray skills stay in source/plugin registry
 * but are excluded from default host deployment copy + deployment descriptors.
 */
function loadPluginSkills(packageRoot) {
  const pluginPath = path.join(packageRoot, 'plugin.json')
  if (!fs.existsSync(pluginPath)) return []
  try {
    const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf8'))
    return Array.isArray(plugin.skills) ? plugin.skills : []
  } catch {
    return []
  }
}

function graySkillIds(packageRoot) {
  return loadPluginSkills(packageRoot)
    .filter(skill => skill && skill.lifecycleState === 'gray' && skill.id)
    .map(skill => String(skill.id))
}

function graySkillIdSet(packageRoot) {
  return new Set(graySkillIds(packageRoot))
}

function isDeployableSkill(skill) {
  const state = String(skill?.lifecycleState || '').trim()
  return Boolean(skill?.id) && (!state || state === 'active')
}

function nonActiveSkillIdSet(packageRoot) {
  return new Set(
    loadPluginSkills(packageRoot)
      .filter(skill => skill?.id && !isDeployableSkill(skill))
      .map(skill => String(skill.id))
  )
}

/**
 * @param {string} relativePath portable path under skills/
 * @param {Set<string>} grayIds
 * @returns {boolean} true when the file should be deployed
 */
function shouldDeploySkillRelative(relativePath, grayIds) {
  const rel = String(relativePath || '').replace(/\\/g, '/')
  if (!rel) return true
  const top = rel.split('/')[0]
  if (!top) return true
  return !grayIds.has(top)
}

function createSkillDeployFileFilter(packageRoot) {
  const excludedIds = nonActiveSkillIdSet(packageRoot)
  return function skillDeployFileFilter(relativePath) {
    return shouldDeploySkillRelative(relativePath, excludedIds)
  }
}

function isSkillsSource(source) {
  const normalized = String(source || '').replace(/\\/g, '/')
  return normalized === 'skills' || normalized.endsWith('/skills')
}

module.exports = {
  loadPluginSkills,
  graySkillIds,
  graySkillIdSet,
  isDeployableSkill,
  nonActiveSkillIdSet,
  shouldDeploySkillRelative,
  createSkillDeployFileFilter,
  isSkillsSource
}
