'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const MANAGED_SKILL_MARKER = '.devcodex-managed-skill.json'

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

function portable (filePath) {
  return path.resolve(filePath).replace(/\\/g, '/')
}

function canonicalPath (filePath) {
  const value = portable(filePath)
  return process.platform === 'win32' ? value.toLowerCase() : value
}

function digestFile (file, fsImpl = fs) {
  return crypto.createHash('sha256').update(fsImpl.readFileSync(file)).digest('hex')
}

function isInside (root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function listFilesBounded (root, fsImpl = fs, limit = 256) {
  const files = []
  const stack = [path.resolve(root)]
  while (stack.length && files.length <= limit) {
    const current = stack.pop()
    let entries = []
    try {
      entries = fsImpl.readdirSync(current, { withFileTypes: true })
    } catch {
      return { files, overflow: false, unreadable: true }
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile()) files.push(full)
      else return { files, overflow: false, unreadable: true }
      if (files.length > limit) return { files: files.slice(0, limit), overflow: true, unreadable: false }
    }
  }
  return { files: files.sort(), overflow: false, unreadable: false }
}

function collisionDigest (dir, fsImpl = fs) {
  const skillFile = path.join(dir, 'SKILL.md')
  try {
    if (fsImpl.existsSync(skillFile) && fsImpl.statSync(skillFile).isFile()) {
      const stat = fsImpl.statSync(skillFile)
      if (stat.size <= 256 * 1024) {
        return crypto.createHash('sha256').update(fsImpl.readFileSync(skillFile)).digest('hex')
      }
      return crypto.createHash('sha256').update(`oversize:${stat.size}`).digest('hex')
    }
    const names = fsImpl.readdirSync(dir).slice(0, 64).sort()
    return crypto.createHash('sha256').update(JSON.stringify(names)).digest('hex')
  } catch {
    return crypto.createHash('sha256').update('unreadable').digest('hex')
  }
}

function buildPreservedCollision (dir, id, reasonCode, fsImpl = fs) {
  return {
    path: portable(dir),
    skillId: String(id),
    reasonCode,
    contentDigest: collisionDigest(dir, fsImpl)
  }
}

function verifyManagedSkillDirOwnership (dir, fsImpl = fs, options = {}) {
  const ownershipPaths = new Set(
    (options.ownershipPaths || options.ownedPaths || [])
      .filter(Boolean)
      .map(canonicalPath)
  )
  const ownershipDigests = new Map(
    Object.entries(options.ownershipDigests || {})
      .map(([file, digest]) => [canonicalPath(file), String(digest)])
  )
  const ownedUnderDir = [...ownershipPaths].filter(file => isInside(dir, file))
  if (!ownedUnderDir.length) {
    return { owned: false, reasonCode: 'ownership-proof-missing' }
  }
  const markerFile = path.join(dir, MANAGED_SKILL_MARKER)
  const markerKey = canonicalPath(markerFile)
  if (!fsImpl.existsSync(markerFile)) {
    return { owned: false, reasonCode: 'ownership-marker-missing' }
  }
  if (!ownershipPaths.has(markerKey) || !ownershipDigests.has(markerKey)) {
    return { owned: false, reasonCode: 'ownership-marker-not-receipt-owned' }
  }
  let marker
  try {
    marker = JSON.parse(fsImpl.readFileSync(markerFile, 'utf8'))
  } catch {
    return { owned: false, reasonCode: 'ownership-marker-invalid' }
  }
  if (marker?.schemaVersion !== 'DevCodexManagedSkillOwnershipV1' ||
      marker.owner !== 'devcodex' ||
      marker.skillId !== path.basename(path.resolve(dir)) ||
      !Array.isArray(marker.files) ||
      marker.files.length > 256) {
    return { owned: false, reasonCode: 'ownership-marker-invalid' }
  }
  const inventory = listFilesBounded(dir, fsImpl, options.maxInventoryFiles || 256)
  if (inventory.unreadable || inventory.overflow) {
    return {
      owned: false,
      reasonCode: inventory.unreadable
        ? 'ownership-inventory-unreadable'
        : 'ownership-inventory-overflow'
    }
  }
  const unowned = inventory.files.filter(file => !ownershipPaths.has(canonicalPath(file)))
  if (unowned.length) {
    return { owned: false, reasonCode: 'mixed-user-content' }
  }
  const inventoryByRelative = new Map(
    inventory.files
      .filter(file => canonicalPath(file) !== markerKey)
      .map(file => [
        path.relative(dir, file).replace(/\\/g, '/'),
        file
      ])
  )
  const markerFiles = new Map()
  for (const item of marker.files) {
    const relative = String(item?.path || '')
    if (!relative ||
        relative.startsWith('/') ||
        relative.split('/').includes('..') ||
        markerFiles.has(relative) ||
        !/^[a-f0-9]{64}$/.test(String(item?.digest || ''))) {
      return { owned: false, reasonCode: 'ownership-marker-invalid' }
    }
    markerFiles.set(relative, String(item.digest))
  }
  if (markerFiles.size !== inventoryByRelative.size ||
      [...markerFiles.keys()].some(relative => !inventoryByRelative.has(relative))) {
    return { owned: false, reasonCode: 'ownership-marker-inventory-mismatch' }
  }
  for (const file of inventory.files) {
    const expected = ownershipDigests.get(canonicalPath(file))
    if (!expected) {
      return { owned: false, reasonCode: 'ownership-digest-missing' }
    }
    if (digestFile(file, fsImpl) !== expected) {
      return { owned: false, reasonCode: 'managed-content-modified' }
    }
    if (canonicalPath(file) !== markerKey) {
      const relative = path.relative(dir, file).replace(/\\/g, '/')
      if (markerFiles.get(relative) !== expected) {
        return { owned: false, reasonCode: 'ownership-marker-digest-mismatch' }
      }
    }
  }
  return { owned: true, reasonCode: null }
}

/**
 * Remove only receipt-owned skill directories under a host scan root.
 * Package id equality is never ownership proof. Unknown or mixed-content
 * directories are preserved and returned as observable collisions.
 */
function pruneManagedSkillDirs (scanRoot, managedIds, fsImpl = fs, options = {}) {
  const removed = []
  const failures = []
  const preservedCollisions = []
  const root = path.resolve(scanRoot || '')
  const ids = Array.isArray(managedIds) ? managedIds : []
  if (!root || !fsImpl.existsSync(root)) {
    return { removed, failures, preservedCollisions }
  }
  for (const id of ids) {
    if (!id || String(id).includes('..') || String(id).includes('/') || String(id).includes('\\')) continue
    const dir = path.join(root, String(id))
    try {
      if (!fsImpl.existsSync(dir)) continue
      const st = fsImpl.statSync(dir)
      if (!st.isDirectory()) continue
      const ownership = verifyManagedSkillDirOwnership(dir, fsImpl, options)
      if (!ownership.owned) {
        preservedCollisions.push(buildPreservedCollision(dir, id, ownership.reasonCode, fsImpl))
        continue
      }
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
  return { removed, failures, preservedCollisions }
}

module.exports = {
  MANAGED_SKILL_MARKER,
  loadPluginSkills,
  graySkillIds,
  graySkillIdSet,
  isDeployableSkill,
  nonActiveSkillIdSet,
  listManagedSkillIds,
  listPrunableSkillIds,
  pruneManagedSkillDirs,
  listFilesBounded,
  verifyManagedSkillDirOwnership,
  collisionDigest,
  buildPreservedCollision,
  shouldDeploySkillRelative,
  createSkillDeployFileFilter,
  isSkillsSource
}
