'use strict'

/**
 * Build-time only DevCodex Skill sidecar contract.
 * Never import/require/spawn paths declared in the sidecar.
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const SCHEMA_VERSION = 'DevCodexSkillContractV1'
const SIDECAR_BASENAME = 'devcodex.skill.json'
const FORBIDDEN_FIELDS = new Set([
  'name',
  'description',
  'entrypoint',
  'lifecycle',
  'lifecycleState',
  'requires',
  'conflictsWith',
  'conflicts',
  'hostCaps',
  'budget',
  'validationProfile',
  'owner',
  'workflow',
  'priority'
])

const ERROR = Object.freeze({
  SIDECAR_JSON_INVALID: 'SIDECAR_JSON_INVALID',
  SIDECAR_SCHEMA_UNSUPPORTED: 'SIDECAR_SCHEMA_UNSUPPORTED',
  SIDECAR_FIELD_FORBIDDEN: 'SIDECAR_FIELD_FORBIDDEN',
  RESOURCE_ID_DUPLICATE: 'RESOURCE_ID_DUPLICATE',
  RESOURCE_PATH_ESCAPE: 'RESOURCE_PATH_ESCAPE',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  SCRIPT_INVOCATION_FORBIDDEN: 'SCRIPT_INVOCATION_FORBIDDEN',
  SCRIPT_RUNTIME_FORBIDDEN: 'SCRIPT_RUNTIME_FORBIDDEN',
  PATH_INVALID: 'PATH_INVALID'
})

function sha256 (value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function canonicalizeText (value) {
  return String(value).replace(/\r\n?/g, '\n')
}

function sidecarRelativePath (skillId) {
  return `content/skills/${skillId}/${SIDECAR_BASENAME}`
}

function isSafeRelativePath (rel) {
  if (typeof rel !== 'string' || !rel || rel.length > 512) return false
  if (path.isAbsolute(rel)) return false
  if (/^[A-Za-z]:[\\/]/.test(rel) || rel.startsWith('\\\\') || rel.includes('\0')) return false
  if (rel.includes('\\')) return false
  const segments = rel.split('/')
  if (segments.some(seg => !seg || seg === '.' || seg === '..')) return false
  return true
}

function assertWithinSkillRoot (skillRootAbs, targetAbs) {
  const rootReal = fs.realpathSync(skillRootAbs)
  let targetReal
  try {
    targetReal = fs.realpathSync(targetAbs)
  } catch {
    // For missing files, resolve parent realpath + basename
    const parent = path.dirname(targetAbs)
    const parentReal = fs.realpathSync(parent)
    targetReal = path.join(parentReal, path.basename(targetAbs))
  }
  const rel = path.relative(rootReal, targetReal)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    const err = new Error(`path escapes skill root: ${targetAbs}`)
    err.code = ERROR.RESOURCE_PATH_ESCAPE
    throw err
  }
  return { rootReal, targetReal, relative: rel.replace(/\\/g, '/') }
}

function validateDeclaredPath (skillRootAbs, declaredPath, allowedPrefixes) {
  if (!isSafeRelativePath(declaredPath)) {
    const err = new Error(`invalid relative path: ${declaredPath}`)
    err.code = ERROR.PATH_INVALID
    throw err
  }
  if (!allowedPrefixes.some(prefix => declaredPath === prefix.slice(0, -1) || declaredPath.startsWith(prefix))) {
    const err = new Error(`path not under allowed prefix (${allowedPrefixes.join(', ')}): ${declaredPath}`)
    err.code = ERROR.RESOURCE_PATH_ESCAPE
    throw err
  }
  const abs = path.join(skillRootAbs, ...declaredPath.split('/'))
  assertWithinSkillRoot(skillRootAbs, abs)
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    const err = new Error(`declared path not found: ${declaredPath}`)
    err.code = ERROR.RESOURCE_NOT_FOUND
    throw err
  }
  return abs
}

function rejectForbiddenFields (obj, prefix = '') {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_FIELDS.has(key)) {
      const err = new Error(`forbidden field: ${prefix}${key}`)
      err.code = ERROR.SIDECAR_FIELD_FORBIDDEN
      throw err
    }
  }
}

/**
 * Parse and validate a sidecar document.
 * @param {object} options
 * @param {string} options.skillId
 * @param {string} options.skillRootAbs absolute path to skills/<id>
 * @param {string} options.rawText file contents
 * @param {string} [options.repoRootAbs] package root for optional checks
 */
function parseAndValidateSidecar ({ skillId, skillRootAbs, rawText }) {
  let doc
  try {
    doc = JSON.parse(rawText)
  } catch (error) {
    const err = new Error(`invalid JSON: ${error.message}`)
    err.code = ERROR.SIDECAR_JSON_INVALID
    throw err
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    const err = new Error('sidecar root must be an object')
    err.code = ERROR.SIDECAR_JSON_INVALID
    throw err
  }
  rejectForbiddenFields(doc)
  if (doc.schemaVersion !== SCHEMA_VERSION) {
    const err = new Error(`unsupported schemaVersion: ${doc.schemaVersion}`)
    err.code = ERROR.SIDECAR_SCHEMA_UNSUPPORTED
    throw err
  }

  const knownKeys = new Set(['schemaVersion', 'triggerFixtures', 'resources', 'scripts'])
  for (const key of Object.keys(doc)) {
    if (!knownKeys.has(key)) {
      const err = new Error(`unknown field: ${key}`)
      err.code = ERROR.SIDECAR_FIELD_FORBIDDEN
      throw err
    }
  }

  const triggerFixtures = {
    positive: [],
    negative: [],
    ambiguous: []
  }
  if (doc.triggerFixtures != null) {
    if (typeof doc.triggerFixtures !== 'object' || Array.isArray(doc.triggerFixtures)) {
      const err = new Error('triggerFixtures must be an object')
      err.code = ERROR.SIDECAR_JSON_INVALID
      throw err
    }
    rejectForbiddenFields(doc.triggerFixtures, 'triggerFixtures.')
    for (const bucket of ['positive', 'negative', 'ambiguous']) {
      const list = doc.triggerFixtures[bucket]
      if (list == null) continue
      if (!Array.isArray(list) || list.length > 50) {
        const err = new Error(`triggerFixtures.${bucket} invalid`)
        err.code = ERROR.SIDECAR_JSON_INVALID
        throw err
      }
      for (const item of list) {
        if (typeof item !== 'string' || !item.trim()) {
          const err = new Error(`triggerFixtures.${bucket} items must be non-empty strings`)
          err.code = ERROR.SIDECAR_JSON_INVALID
          throw err
        }
      }
      triggerFixtures[bucket] = list.map(s => s.trim())
    }
    for (const key of Object.keys(doc.triggerFixtures)) {
      if (!['positive', 'negative', 'ambiguous'].includes(key)) {
        const err = new Error(`unknown triggerFixtures field: ${key}`)
        err.code = ERROR.SIDECAR_FIELD_FORBIDDEN
        throw err
      }
    }
  }

  const seenIds = new Set()
  const resourceContracts = []
  if (doc.resources != null) {
    if (!Array.isArray(doc.resources) || doc.resources.length > 100) {
      const err = new Error('resources must be an array (max 100)')
      err.code = ERROR.SIDECAR_JSON_INVALID
      throw err
    }
    for (const item of doc.resources) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        const err = new Error('resource item must be an object')
        err.code = ERROR.SIDECAR_JSON_INVALID
        throw err
      }
      rejectForbiddenFields(item, 'resources[].')
      for (const key of Object.keys(item)) {
        if (!['id', 'type', 'path', 'load', 'required'].includes(key)) {
          const err = new Error(`unknown resource field: ${key}`)
          err.code = ERROR.SIDECAR_FIELD_FORBIDDEN
          throw err
        }
      }
      if (!item.id || typeof item.id !== 'string') {
        const err = new Error('resource.id required')
        err.code = ERROR.SIDECAR_JSON_INVALID
        throw err
      }
      if (seenIds.has(item.id)) {
        const err = new Error(`duplicate id: ${item.id}`)
        err.code = ERROR.RESOURCE_ID_DUPLICATE
        throw err
      }
      seenIds.add(item.id)
      if (!['reference', 'asset'].includes(item.type)) {
        const err = new Error(`invalid resource.type: ${item.type}`)
        err.code = ERROR.SIDECAR_JSON_INVALID
        throw err
      }
      if (!['on-demand', 'manual'].includes(item.load)) {
        const err = new Error(`invalid resource.load: ${item.load}`)
        err.code = ERROR.SIDECAR_JSON_INVALID
        throw err
      }
      const prefixes = item.type === 'reference' ? ['references/'] : ['assets/']
      const abs = validateDeclaredPath(skillRootAbs, item.path, prefixes)
      const content = fs.readFileSync(abs)
      const contentDigest = sha256(content)
      resourceContracts.push({
        id: item.id,
        type: item.type,
        path: item.path,
        load: item.load,
        required: item.required === true,
        contentDigest,
        sourceBytes: content.length
      })
    }
  }

  const manualScriptContracts = []
  if (doc.scripts != null) {
    if (!Array.isArray(doc.scripts) || doc.scripts.length > 50) {
      const err = new Error('scripts must be an array (max 50)')
      err.code = ERROR.SIDECAR_JSON_INVALID
      throw err
    }
    for (const item of doc.scripts) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        const err = new Error('script item must be an object')
        err.code = ERROR.SIDECAR_JSON_INVALID
        throw err
      }
      rejectForbiddenFields(item, 'scripts[].')
      for (const key of Object.keys(item)) {
        if (!['id', 'path', 'runtime', 'purpose', 'invocation', 'requiredCapabilities'].includes(key)) {
          const err = new Error(`unknown script field: ${key}`)
          err.code = ERROR.SIDECAR_FIELD_FORBIDDEN
          throw err
        }
      }
      if (!item.id || typeof item.id !== 'string') {
        const err = new Error('script.id required')
        err.code = ERROR.SIDECAR_JSON_INVALID
        throw err
      }
      if (seenIds.has(item.id)) {
        const err = new Error(`duplicate id: ${item.id}`)
        err.code = ERROR.RESOURCE_ID_DUPLICATE
        throw err
      }
      seenIds.add(item.id)
      if (item.runtime !== 'node') {
        const err = new Error(`script.runtime must be node: ${item.runtime}`)
        err.code = ERROR.SCRIPT_RUNTIME_FORBIDDEN
        throw err
      }
      if (item.invocation !== 'manual-only') {
        const err = new Error(`script.invocation must be manual-only: ${item.invocation}`)
        err.code = ERROR.SCRIPT_INVOCATION_FORBIDDEN
        throw err
      }
      if (typeof item.purpose !== 'string' || !item.purpose.trim()) {
        const err = new Error('script.purpose required')
        err.code = ERROR.SIDECAR_JSON_INVALID
        throw err
      }
      const abs = validateDeclaredPath(skillRootAbs, item.path, ['scripts/'])
      const content = fs.readFileSync(abs)
      manualScriptContracts.push({
        id: item.id,
        path: item.path,
        runtime: 'node',
        purpose: item.purpose.trim(),
        invocation: 'manual-only',
        requiredCapabilities: Array.isArray(item.requiredCapabilities) ? [...item.requiredCapabilities] : [],
        contentDigest: sha256(content),
        sourceBytes: content.length
      })
    }
  }

  const digest = sha256(canonicalizeText(rawText))
  return {
    schemaVersion: SCHEMA_VERSION,
    skillId,
    path: sidecarRelativePath(skillId),
    digest,
    state: 'valid',
    triggerFixtures,
    resourceContracts: resourceContracts.sort((a, b) => a.id.localeCompare(b.id)),
    manualScriptContracts: manualScriptContracts.sort((a, b) => a.id.localeCompare(b.id)),
    fallbackPolicy: 'full-skill-read'
  }
}

/**
 * Load sidecar from disk if present.
 * @returns {null | object} null when absent
 */
function loadSkillSidecarFromDisk (repoRootAbs, skillId) {
  const rel = sidecarRelativePath(skillId)
  const abs = path.join(repoRootAbs, rel)
  if (!fs.existsSync(abs)) return null
  const skillRootAbs = path.join(repoRootAbs, 'content', 'skills', skillId)
  const rawText = fs.readFileSync(abs, 'utf8')
  return parseAndValidateSidecar({ skillId, skillRootAbs, rawText })
}

/**
 * Load sidecar using a custom text reader (worktree or git index).
 * Path resolution for resources still uses filesystem under skill root (worktree).
 * For --check-staged, caller should ensure worktree/index consistency for declared files.
 */
function loadSkillSidecarWithReader (repoRootAbs, skillId, readText) {
  const rel = sidecarRelativePath(skillId)
  let rawText
  try {
    rawText = readText(rel)
  } catch {
    return null
  }
  if (rawText == null || rawText === '') return null
  const skillRootAbs = path.join(repoRootAbs, 'content', 'skills', skillId)
  return parseAndValidateSidecar({ skillId, skillRootAbs, rawText })
}

module.exports = {
  ERROR,
  FORBIDDEN_FIELDS,
  SCHEMA_VERSION,
  SIDECAR_BASENAME,
  canonicalizeText,
  isSafeRelativePath,
  loadSkillSidecarFromDisk,
  loadSkillSidecarWithReader,
  parseAndValidateSidecar,
  sha256,
  sidecarRelativePath
}
