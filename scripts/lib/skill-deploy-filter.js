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

/** Active/deployable skill ids from plugin registry (deploy set). */
function listManagedSkillIds (packageRoot) {
  return loadPluginSkills(packageRoot)
    .filter(skill => isDeployableSkill(skill))
    .map(skill => String(skill.id))
}

/**
 * Ids that must not remain on host L1 scan roots in hidden mode:
 * all package-registered skills (active + gray + other non-orphan registry rows).
 * Gray was previously copyable or left as residue when only active ids were pruned.
 */
function listPrunableSkillIds (packageRoot) {
  const fromPlugin = loadPluginSkills(packageRoot)
    .filter(skill => skill && skill.id)
    .map(skill => String(skill.id))
  // Always include known gray set even if plugin row missing during partial checkout
  const gray = graySkillIds(packageRoot)
  return Array.from(new Set([...fromPlugin, ...gray]))
}

/**
 * Remove package-managed skill directories under a host scan root.
 * Does NOT use file-only removeStaleManagedPaths (that API only unlinks files).
 */
function pruneManagedSkillDirs (scanRoot, managedIds, fsImpl = fs, options = {}) {
  const removed = []
  const failures = []
  const root = path.resolve(scanRoot || '')
  const ids = Array.isArray(managedIds) ? managedIds : []
  if (!root || !fsImpl.existsSync(root)) {
    return { removed, failures }
  }
  for (const id of ids) {
    if (!id || String(id).includes('..') || String(id).includes('/') || String(id).includes('\\')) continue
    const dir = path.join(root, String(id))
    try {
      if (!fsImpl.existsSync(dir)) continue
      const st = fsImpl.statSync(dir)
      if (!st.isDirectory()) continue
      if (options.dryRun === true) {
        removed.push(dir)
        continue
      }
      fsImpl.rmSync(dir, { recursive: true, force: true })
      removed.push(dir)
    } catch (error) {
      failures.push({
        path: dir.replace(/\\/g, '/'),
        errorCode: error.code || 'PRUNE_MANAGED_SKILL_DIR_FAILED',
        error: error.message
      })
    }
  }
  return { removed, failures }
}

module.exports = {
  loadPluginSkills,
  graySkillIds,
  graySkillIdSet,
  isDeployableSkill,
  nonActiveSkillIdSet,
  listManagedSkillIds,
  listPrunableSkillIds,
  pruneManagedSkillDirs,
  shouldDeploySkillRelative,
  createSkillDeployFileFilter,
  isSkillsSource
}
