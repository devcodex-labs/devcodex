'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { resolveInside, resolveExistingRegularFileInside } = require('./path-guard')
const { validateLinkCapabilityDecision } = require('../hooks/_runtime/visible-output-contract.cjs')

const MAX_ARTIFACT_LINKS = 20
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024
const ARTIFACT_KEYS = new Set(['id', 'label', 'targetPath', 'purpose'])

class ArtifactLinkProjectionError extends Error {
  constructor(code, message, nextStep) {
    super(message)
    this.name = 'ArtifactLinkProjectionError'
    this.code = code
    this.nextStep = nextStep
  }
}

function fail(code, message, nextStep = 'Correct the artifact link request and retry once.') {
  throw new ArtifactLinkProjectionError(code, message, nextStep)
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function nativeRealpath(candidate) {
  return fs.realpathSync.native ? fs.realpathSync.native(candidate) : fs.realpathSync(candidate)
}

function isInside(root, candidate, { allowRoot = false } = {}) {
  const relative = path.relative(root, candidate)
  if (!relative) return allowRoot
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function normalizeRelativePath(value, label) {
  if (typeof value !== 'string') {
    fail('ARTIFACT_LINK_PATH_INVALID', `${label} must be an active-root-relative path.`)
  }
  const portable = value.replace(/\\/g, '/')
  const segments = portable.split('/')
  if (!portable || portable !== portable.trim() || path.isAbsolute(value) || path.posix.isAbsolute(portable) ||
      /^[A-Za-z]:/.test(portable) || /[:\0\r\n<>?#|]/.test(portable) ||
      segments.some(segment => !segment || segment === '.' || segment === '..')) {
    fail(
      'ARTIFACT_LINK_PATH_INVALID',
      `${label} must be a normalized active-root-relative path without traversal, URI schemes, query, or fragment syntax.`
    )
  }
  return portable
}

function normalizeLine(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || /[\r\n]/.test(value) || value.length > maxLength) {
    fail('ARTIFACT_LINK_ARGUMENT_INVALID', `${label} must be one trimmed line of at most ${maxLength} characters.`)
  }
  return value
}

function normalizeArtifact(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('ARTIFACT_LINK_ARGUMENT_INVALID', `artifacts[${index}] must be an object.`)
  }
  const unknown = Object.keys(value).filter(key => !ARTIFACT_KEYS.has(key))
  if (unknown.length) {
    fail('ARTIFACT_LINK_ARGUMENT_INVALID', `artifacts[${index}] contains unsupported fields: ${unknown.join(', ')}.`)
  }
  return {
    id: normalizeLine(value.id, `artifacts[${index}].id`, 80),
    label: normalizeLine(value.label, `artifacts[${index}].label`, 200),
    targetPath: normalizeRelativePath(value.targetPath, `artifacts[${index}].targetPath`),
    purpose: normalizeLine(value.purpose, `artifacts[${index}].purpose`, 300)
  }
}

function inspectRoot(activeRoot) {
  const lexicalRoot = path.resolve(activeRoot || '')
  if (!activeRoot || !fs.existsSync(lexicalRoot) || !fs.statSync(lexicalRoot).isDirectory()) {
    fail('ARTIFACT_LINK_ACTIVE_ROOT_INVALID', 'activeRoot must identify an existing directory.')
  }
  return { lexicalRoot, canonicalRoot: nativeRealpath(lexicalRoot) }
}

function assertNoReparseTraversal(root, portablePath, { allowMissingLeaf = false } = {}) {
  let cursor = root.lexicalRoot
  const segments = portablePath.split('/')
  for (let index = 0; index < segments.length; index += 1) {
    cursor = path.join(cursor, segments[index])
    if (!fs.existsSync(cursor)) {
      if (allowMissingLeaf) break
      fail('ARTIFACT_LINK_TARGET_MISSING', `Local link target does not exist: ${portablePath}.`)
    }
    const stat = fs.lstatSync(cursor)
    if (stat.isSymbolicLink()) {
      fail('ARTIFACT_LINK_REPARSE_REJECTED', `Symbolic-link or reparse traversal is not allowed: ${portablePath}.`)
    }
  }
}

function resolveDocument(root, documentPath, operation) {
  const portablePath = normalizeRelativePath(documentPath, 'documentPath')
  const lexicalPath = resolveInside(root.lexicalRoot, ...portablePath.split('/'))
  assertNoReparseTraversal(root, portablePath, { allowMissingLeaf: operation === 'project' })
  const exists = fs.existsSync(lexicalPath)
  if (operation === 'validate-existing' && !exists) {
    fail('ARTIFACT_LINK_DOCUMENT_MISSING', `validate-existing requires an existing document: ${portablePath}.`)
  }
  if (exists) {
    const canonicalPath = nativeRealpath(lexicalPath)
    if (!isInside(root.canonicalRoot, canonicalPath)) {
      fail('ARTIFACT_LINK_DOCUMENT_ESCAPE', `documentPath escapes activeRoot after canonical resolution: ${portablePath}.`)
    }
    if (!fs.statSync(canonicalPath).isFile()) {
      fail('ARTIFACT_LINK_DOCUMENT_INVALID', `documentPath must identify a regular file: ${portablePath}.`)
    }
  } else {
    let ancestor = path.dirname(lexicalPath)
    while (!fs.existsSync(ancestor) && ancestor !== root.lexicalRoot) ancestor = path.dirname(ancestor)
    if (!fs.existsSync(ancestor) || !fs.statSync(ancestor).isDirectory()) {
      fail('ARTIFACT_LINK_DOCUMENT_PARENT_MISSING', `documentPath has no existing parent inside activeRoot: ${portablePath}.`)
    }
    const canonicalParent = nativeRealpath(ancestor)
    if (!isInside(root.canonicalRoot, canonicalParent, { allowRoot: true })) {
      fail('ARTIFACT_LINK_DOCUMENT_ESCAPE', `documentPath parent escapes activeRoot after canonical resolution: ${portablePath}.`)
    }
  }
  return { portablePath, lexicalPath, exists }
}

function resolveTarget(root, targetPath) {
  let canonicalPath
  try {
    canonicalPath = resolveExistingRegularFileInside(root.lexicalRoot, targetPath, { label: 'targetPath' })
  } catch (error) {
    fail('ARTIFACT_LINK_TARGET_INVALID', error.message)
  }
  if (!isInside(root.canonicalRoot, canonicalPath)) {
    fail('ARTIFACT_LINK_TARGET_ESCAPE', `targetPath escapes activeRoot after canonical resolution: ${targetPath}.`)
  }
  const canonicalRelativePath = path.relative(root.canonicalRoot, canonicalPath).replace(/\\/g, '/')
  const stat = fs.statSync(canonicalPath)
  return {
    canonicalPath,
    canonicalRelativePath,
    identity: digest({ canonicalRelativePath, dev: String(stat.dev), ino: String(stat.ino), size: stat.size })
  }
}

function canonicalKey(value) {
  const normalized = path.normalize(value)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function escapeMarkdownLabel(value) {
  return value.replace(/\\/g, '\\\\').replace(/([\[\]|])/g, '\\$1')
}

function markdownDestination(href) {
  return /[\s()]/.test(href) ? `<${href}>` : href
}

function buildMarkdown(label, href) {
  return `[${escapeMarkdownLabel(label)}](${markdownDestination(href)})`
}

function validateCapability(capability, root) {
  const validation = validateLinkCapabilityDecision(capability)
  if (!validation.valid) {
    fail('ARTIFACT_LINK_CAPABILITY_INVALID', `LinkCapabilityDecisionV1 is invalid: ${validation.errors.join(', ')}.`)
  }
  if (capability.targetRelation !== 'workspace' || capability.absolutePathFallback ||
      !['clickable', 'portable'].includes(capability.mode)) {
    fail(
      'ARTIFACT_LINK_CAPABILITY_UNSUPPORTED',
      'Artifact projection requires a workspace-relative portable or clickable LinkCapabilityDecisionV1 without absolute fallback.'
    )
  }
  if (typeof capability.workspaceRoot !== 'string' || !path.isAbsolute(capability.workspaceRoot)) {
    fail('ARTIFACT_LINK_CAPABILITY_ROOT_INVALID', 'LinkCapabilityDecisionV1.workspaceRoot must be an absolute workspace root.')
  }
  const decisionRoot = path.resolve(capability.workspaceRoot)
  const lexicalContains = isInside(decisionRoot, root.lexicalRoot, { allowRoot: true })
  const canonicalDecisionRoot = fs.existsSync(decisionRoot) ? nativeRealpath(decisionRoot) : decisionRoot
  const canonicalContains = isInside(canonicalDecisionRoot, root.canonicalRoot, { allowRoot: true })
  if (!lexicalContains && !canonicalContains) {
    fail('ARTIFACT_LINK_CAPABILITY_ROOT_MISMATCH', 'LinkCapabilityDecisionV1.workspaceRoot does not contain the resolved activeRoot.')
  }
  return {
    schemaVersion: capability.schemaVersion,
    decisionId: capability.decisionId,
    surface: capability.surface,
    evidenceState: capability.evidenceState,
    mode: capability.mode,
    targetRelation: capability.targetRelation,
    absolutePathFallback: capability.absolutePathFallback
  }
}

function readBoundedDocument(document) {
  const stat = fs.statSync(document.lexicalPath)
  if (stat.size > MAX_DOCUMENT_BYTES) {
    fail('ARTIFACT_LINK_DOCUMENT_TOO_LARGE', `documentPath exceeds the ${MAX_DOCUMENT_BYTES}-byte validation limit.`)
  }
  return fs.readFileSync(document.lexicalPath, 'utf8')
}

function createArtifactLinkProjectionSet(input) {
  const operation = input?.operation || 'project'
  if (!['project', 'validate-existing'].includes(operation)) {
    fail('ARTIFACT_LINK_ARGUMENT_INVALID', 'operation must be project or validate-existing.')
  }
  if (!Array.isArray(input?.artifacts) || input.artifacts.length < 1 || input.artifacts.length > MAX_ARTIFACT_LINKS) {
    fail('ARTIFACT_LINK_ARGUMENT_INVALID', `artifacts must contain 1–${MAX_ARTIFACT_LINKS} entries.`)
  }
  const root = inspectRoot(input.activeRoot)
  const document = resolveDocument(root, input.documentPath, operation)
  const capability = validateCapability(input.linkCapability, root)
  const artifacts = input.artifacts.map(normalizeArtifact)
  const ids = new Set()
  for (const artifact of artifacts) {
    if (ids.has(artifact.id)) fail('ARTIFACT_LINK_ID_DUPLICATE', `Duplicate artifact id: ${artifact.id}.`)
    ids.add(artifact.id)
  }

  const seenTargets = new Map()
  const links = []
  const suppressed = []
  for (const artifact of artifacts) {
    const target = resolveTarget(root, artifact.targetPath)
    const key = canonicalKey(target.canonicalPath)
    const prior = seenTargets.get(key)
    if (prior) {
      suppressed.push({ id: artifact.id, duplicateOf: prior.id, targetPath: artifact.targetPath })
      continue
    }
    const href = path.posix.relative(path.posix.dirname(document.portablePath), artifact.targetPath)
    if (!href) fail('ARTIFACT_LINK_SELF_REFERENCE', `Artifact ${artifact.id} cannot target documentPath itself.`)
    const link = {
      schemaVersion: 'ArtifactLinkProjectionV1',
      id: artifact.id,
      label: artifact.label,
      targetPath: artifact.targetPath,
      canonicalTargetPath: target.canonicalRelativePath,
      purpose: artifact.purpose,
      href,
      markdown: buildMarkdown(artifact.label, href),
      targetIdentity: target.identity
    }
    seenTargets.set(key, link)
    links.push(link)
  }

  let existingValidation = { status: 'not-requested', matched: 0, missingIds: [] }
  if (operation === 'validate-existing') {
    const content = readBoundedDocument(document)
    const missingIds = links.filter(link => !content.includes(link.markdown)).map(link => link.id)
    if (missingIds.length) {
      fail('ARTIFACT_LINK_READBACK_MISSING', `Projected links are missing from documentPath: ${missingIds.join(', ')}.`)
    }
    existingValidation = { status: 'verified', matched: links.length, missingIds: [] }
  }

  const core = {
    schemaVersion: 'ArtifactLinkProjectionSetV1',
    operation,
    documentPath: document.portablePath,
    documentExists: document.exists,
    capability,
    links,
    dedupe: {
      policy: 'canonical-path-first-reference-wins',
      inputCount: artifacts.length,
      projectedCount: links.length,
      suppressedCount: suppressed.length,
      suppressed
    },
    existingValidation
  }
  return {
    ...core,
    projectionId: `artifact-link-projection-${digest(core)}`,
    validation: { valid: true, errors: [] }
  }
}

function renderArtifactLinkBlock(projection, options = {}) {
  if (!projection?.validation?.valid || !Array.isArray(projection.links) || projection.links.length < 1) {
    fail('ARTIFACT_LINK_PROJECTION_INVALID', 'A valid non-empty ArtifactLinkProjectionSetV1 is required.')
  }
  const heading = normalizeLine(options.heading || '关联产物', 'heading', 120)
  return [
    `### ${heading}`,
    `<!-- devcodex:artifact-link-projection v1 set=${projection.projectionId} -->`,
    '',
    ...projection.links.map(link => `- ${link.markdown} — ${link.purpose}`)
  ].join('\n')
}

function resolveExistingLocalLink(root, document, href) {
  let decoded
  try { decoded = decodeURIComponent(href) } catch { decoded = href }
  const withoutFragment = decoded.split('#')[0].split('?')[0]
  if (!withoutFragment) return null
  const portable = withoutFragment.replace(/\\/g, '/')
  if (path.isAbsolute(withoutFragment) || path.posix.isAbsolute(portable) || /^[A-Za-z]:/.test(portable)) {
    fail('ARTIFACT_LINK_ABSOLUTE_REJECTED', `Local Markdown links must be relative to documentPath: ${href}.`)
  }
  const lexicalPath = path.resolve(path.dirname(document.lexicalPath), ...portable.split('/'))
  if (!isInside(root.lexicalRoot, lexicalPath)) {
    fail('ARTIFACT_LINK_TARGET_ESCAPE', `Local Markdown link escapes activeRoot: ${href}.`)
  }
  if (!fs.existsSync(lexicalPath)) {
    fail('ARTIFACT_LINK_TARGET_MISSING', `Local Markdown link target does not exist: ${href}.`)
  }
  const relative = path.relative(root.lexicalRoot, lexicalPath).replace(/\\/g, '/')
  assertNoReparseTraversal(root, relative)
  const canonicalPath = nativeRealpath(lexicalPath)
  if (!isInside(root.canonicalRoot, canonicalPath)) {
    fail('ARTIFACT_LINK_TARGET_ESCAPE', `Local Markdown link escapes activeRoot after canonical resolution: ${href}.`)
  }
  return relative
}

function validateMarkdownLocalLinks(input) {
  const root = inspectRoot(input.activeRoot)
  const document = resolveDocument(root, input.documentPath, 'project')
  const markdown = String(input.markdown || '')
  if (/\]\(\s*[^<)\s]+\s+(?!["'])[^)\r\n]+\)/.test(markdown)) {
    fail('ARTIFACT_LINK_DESTINATION_INVALID', 'Markdown destinations containing spaces must use angle brackets.')
  }
  const links = []
  const linkRe = /!?\[(?:\\.|[^\]\\\r\n])*\]\(\s*(<[^>\r\n]+>|[^)\s\r\n]+)(?:\s+["'][^"'\r\n]*["'])?\s*\)/g
  let match
  while ((match = linkRe.exec(markdown)) !== null) {
    const raw = match[1]
    const href = raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw
    if (/^file:\/\//i.test(href)) {
      fail('ARTIFACT_LINK_FILE_URI_REJECTED', 'file:// Markdown links are not allowed.')
    }
    if (/^(?:https?:|mailto:|tel:)/i.test(href) || href.startsWith('#')) continue
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(href)) {
      fail('ARTIFACT_LINK_SCHEME_REJECTED', `Unsupported Markdown link scheme: ${href}.`)
    }
    const resolvedPath = resolveExistingLocalLink(root, document, href)
    if (resolvedPath) links.push({ href, resolvedPath })
  }
  return {
    schemaVersion: 'MarkdownLocalLinkValidationV1',
    documentPath: document.portablePath,
    localLinkCount: links.length,
    links,
    validation: { valid: true, errors: [] }
  }
}

module.exports = {
  ArtifactLinkProjectionError,
  createArtifactLinkProjectionSet,
  renderArtifactLinkBlock,
  validateMarkdownLocalLinks
}
