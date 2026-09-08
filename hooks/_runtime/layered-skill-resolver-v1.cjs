'use strict'

const fs = require('fs')
const path = require('path')
const { isUtf8 } = require('buffer')

const {
  MAX_LAYERED_SKILL_BYTES,
  isUnderPhysical,
  isValidSkillId,
  resolveSkillRead
} = require('./skill-resolution.cjs')
const {
  byteLength,
  parseFrontmatter,
  portable,
  sha256
} = require('./progressive-skill-route-contract.cjs')
const {
  resolveGlobalSkillRuntimeRoot
} = require('./global-skill-runtime-root.cjs')

const EXACT_BODY_PAGE_BYTES = 40 * 1024
const EXACT_RESPONSE_LIMIT_BYTES = 64 * 1024
const MAX_DEPENDENCY_NODES = 32
const MAX_DEPENDENCY_DEPTH = 8

function exactError (code, details = {}) {
  const error = new Error(code)
  error.code = code
  error.details = {
    schemaVersion: 'SkillExactResolutionErrorV1',
    scope: 'selected-skill-step-only',
    baselineTaskMayContinue: true,
    ...details
  }
  return error
}

function encodeExactCursor (payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${body}.${sha256(payload).slice(0, 24)}`
}

function decodeExactCursor (cursor) {
  if (!cursor) return null
  const [body, signature, ...rest] = String(cursor).split('.')
  if (!body || !signature || rest.length) return null
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    return sha256(parsed).slice(0, 24) === signature ? parsed : null
  } catch {
    return null
  }
}

function parseDependencyList (value) {
  if (Array.isArray(value)) return [...new Set(value.map(String).filter(isValidSkillId))].sort()
  const raw = String(value || '').trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parseDependencyList(parsed)
  } catch {}
  return [...new Set(raw
    .replace(/^\[|\]$/g, '')
    .split(/[\s,;]+/)
    .map(item => item.replace(/^['"]|['"]$/g, '').trim())
    .filter(isValidSkillId))].sort()
}

function readPortfolioTopology (options = {}) {
  const fsImpl = options.fs || fs
  const runtime = options.globalRuntime || resolveGlobalSkillRuntimeRoot({
    runtimeRoot: options.runtimeRoot,
    packageRoot: options.packageRoot,
    globalSkillsRoot: options.globalSkillsRoot,
    env: options.env,
    home: options.home,
    fs: fsImpl
  })
  if (runtime.status !== 'resolved') {
    return { byId: new Map(), warning: runtime.errorCode || 'GLOBAL_SKILL_RUNTIME_ROOT_UNRESOLVED' }
  }
  try {
    const portfolio = JSON.parse(fsImpl.readFileSync(runtime.portfolioPath, 'utf8'))
    if (!Array.isArray(portfolio.skills)) throw new Error('skills missing')
    return {
      byId: new Map(portfolio.skills.map(skill => [String(skill.id), skill])),
      warning: null
    }
  } catch {
    return { byId: new Map(), warning: 'SKILL_PORTFOLIO_READ_FAILED' }
  }
}

function portfolioDependencies (skill) {
  const value = skill?.skillIndex?.requires ?? skill?.dependencies ?? []
  return parseDependencyList(value)
}

// Exact reads and the progressive route share the same declared topology.
function skillTopology (frontmatter = {}, portfolioSkill, layer = 'project') {
  const index = layer === 'global' ? (portfolioSkill?.skillIndex || {}) : {}
  const declared = parseDependencyList(frontmatter.requires || frontmatter.dependencies)
  const conflicts = parseDependencyList(frontmatter.conflictsWith || frontmatter.conflicts)
  return {
    requires: [...new Set([
      ...(layer === 'global' ? portfolioDependencies(portfolioSkill) : []), ...declared
    ])].sort(),
    conflicts: [...new Set([
      ...(layer === 'global' ? parseDependencyList(index.conflictsWith || portfolioSkill?.conflicts) : []),
      ...conflicts
    ])].sort(),
    priority: Number.isFinite(Number(frontmatter.priority ?? index.priority))
      ? Number(frontmatter.priority ?? index.priority)
      : (layer === 'global' ? 100 : 50)
  }
}

function metadataForSkill (skillId, preferredLayer, topology, options = {}) {
  const fsImpl = options.fs || fs
  const resolved = resolveSkillRead(skillId, {
    ...options,
    fs: fsImpl,
    includeContent: true,
    metadataOnly: true,
    metadataMaxBytes: MAX_LAYERED_SKILL_BYTES,
    preferredLayer
  })
  const trace = resolved.trace
  if (!resolved.content || !['project', 'workspace', 'global'].includes(trace.selectedLayer)) {
    const errorCode = trace.reasonCode === 'oversize'
      ? 'SKILL_BODY_TOO_LARGE'
      : (trace.reasonCode === 'preferred-layer-unavailable'
          ? 'SKILL_PREFERRED_LAYER_UNAVAILABLE'
          : 'SKILL_EXACT_NOT_FOUND')
    throw exactError(errorCode, {
      skillId,
      preferredLayer: preferredLayer || null,
      reasonCode: trace.reasonCode || 'missing',
      fallbackReason: trace.fallbackReason || ''
    })
  }
  if (preferredLayer && trace.selectedLayer !== preferredLayer) {
    throw exactError('SKILL_PREFERRED_LAYER_UNAVAILABLE', {
      skillId,
      preferredLayer,
      observedLayer: trace.selectedLayer
    })
  }
  const parsed = parseFrontmatter(resolved.content)
  const dependencies = skillTopology(
    parsed.frontmatter, topology.byId.get(skillId), trace.selectedLayer
  ).requires
  const intentPath = path.join(path.dirname(trace.selectedPath), 'intent.json')
  return {
    skillId,
    selectedLayer: trace.selectedLayer,
    selectedPath: trace.selectedPath,
    selectedRoot: trace.selectedRoot || portable(path.dirname(path.dirname(trace.selectedPath))),
    metadataDigest: trace.metadataDigest || trace.digest,
    fileIdentity: trace.fileIdentity,
    bodyBytes: trace.contentBytes,
    dependencies,
    intentPresent: fsImpl.existsSync(intentPath)
  }
}

function buildMetadataClosure (skillId, preferredLayer, options = {}) {
  if (!isValidSkillId(skillId)) {
    throw exactError('SKILL_ID_INVALID', { skillId: String(skillId || '') })
  }
  const topology = readPortfolioTopology(options)
  const byId = new Map()
  const visiting = []
  const loadOrder = []

  const visit = (currentId, depth, layerPreference = null) => {
    if (depth > MAX_DEPENDENCY_DEPTH) {
      throw exactError('SKILL_DEPENDENCY_DEPTH_EXCEEDED', {
        skillId: currentId,
        depth,
        maximumDepth: MAX_DEPENDENCY_DEPTH
      })
    }
    const cycleIndex = visiting.indexOf(currentId)
    if (cycleIndex >= 0) {
      throw exactError('SKILL_DEPENDENCY_CYCLE', {
        cycle: [...visiting.slice(cycleIndex), currentId]
      })
    }
    if (byId.has(currentId)) return
    if (byId.size >= MAX_DEPENDENCY_NODES) {
      throw exactError('SKILL_DEPENDENCY_NODE_LIMIT', {
        maximumNodes: MAX_DEPENDENCY_NODES,
        nextSkillId: currentId
      })
    }
    visiting.push(currentId)
    const metadata = metadataForSkill(currentId, layerPreference, topology, options)
    byId.set(currentId, metadata)
    for (const dependencyId of metadata.dependencies) visit(dependencyId, depth + 1)
    visiting.pop()
    loadOrder.push(currentId)
  }

  visit(skillId, 0, preferredLayer || null)
  return {
    byId,
    loadOrder,
    warnings: [
      ...(topology.warning ? [{ code: topology.warning }] : []),
      ...[...byId.values()]
        .filter(item => !item.intentPresent)
        .map(item => ({ code: 'SKILL_INTENT_ABSENT', skillId: item.skillId }))
    ]
  }
}

function sameFileIdentity (expected, observed) {
  if (!expected || !observed) return false
  return expected.realPath === observed.realPath &&
    Number(expected.size) === Number(observed.size) &&
    Number(expected.mtimeMs) === Number(observed.mtimeMs) &&
    (expected.device == null || observed.device == null || Number(expected.device) === Number(observed.device)) &&
    (expected.inode == null || observed.inode == null || Number(expected.inode) === Number(observed.inode))
}

function hydrateExactSkill (metadata, options = {}) {
  const fsImpl = options.fs || fs
  const rawBuffer = fsImpl.readFileSync(metadata.selectedPath)
  if (!isUtf8(rawBuffer)) {
    throw exactError('SKILL_BODY_UTF8_INVALID', { skillId: metadata.skillId })
  }
  const resolved = resolveSkillRead(metadata.skillId, {
    ...options,
    fs: fsImpl,
    includeContent: true,
    maxBytes: MAX_LAYERED_SKILL_BYTES,
    preferredLayer: metadata.selectedLayer
  })
  if (!resolved.content ||
      resolved.trace.selectedLayer !== metadata.selectedLayer ||
      portable(resolved.trace.selectedPath) !== portable(metadata.selectedPath)) {
    throw exactError('SKILL_METADATA_BODY_DRIFT', {
      skillId: metadata.skillId,
      expectedLayer: metadata.selectedLayer,
      observedLayer: resolved.trace.selectedLayer
    })
  }
  const stat = fsImpl.statSync(metadata.selectedPath)
  const realPath = fsImpl.realpathSync(metadata.selectedPath)
  const observedIdentity = {
    realPath: portable(realPath),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    device: Number.isFinite(Number(stat.dev)) ? Number(stat.dev) : null,
    inode: Number.isFinite(Number(stat.ino)) ? Number(stat.ino) : null
  }
  if (!sameFileIdentity(metadata.fileIdentity, observedIdentity) ||
      !isUnderPhysical(metadata.selectedRoot, realPath, fsImpl)) {
    throw exactError('SKILL_METADATA_BODY_DRIFT', {
      skillId: metadata.skillId,
      expectedFileIdentity: metadata.fileIdentity,
      observedFileIdentity: observedIdentity
    })
  }
  return {
    ...metadata,
    content: resolved.content,
    contentDigest: resolved.trace.digest,
    bodyBytes: resolved.trace.contentBytes,
    fileIdentity: observedIdentity
  }
}

function splitUtf8Pages (text, maxBytes = EXACT_BODY_PAGE_BYTES) {
  const pages = []
  let current = ''
  let bytes = 0
  for (const character of String(text || '')) {
    const size = Buffer.byteLength(character, 'utf8')
    if (current && bytes + size > maxBytes) {
      pages.push(current)
      current = character
      bytes = size
    } else {
      current += character
      bytes += size
    }
  }
  pages.push(current)
  return pages
}

function resolveExactSkillPage (input, target, options = {}) {
  const preferredLayer = input.preferredLayer == null ? null : String(input.preferredLayer)
  const closure = buildMetadataClosure(input.skillId, preferredLayer, {
    ...options,
    cwd: target.projectRoot,
    project: target.project,
    activeRoot: target.activeRoot
  })
  const hydrated = closure.loadOrder.map(skillId =>
    hydrateExactSkill(closure.byId.get(skillId), {
      ...options,
      cwd: target.projectRoot,
      project: target.project,
      activeRoot: target.activeRoot
    })
  )
  const root = hydrated.find(item => item.skillId === input.skillId)
  if (input.expectedContentDigest && root.contentDigest !== input.expectedContentDigest) {
    throw exactError('SKILL_CONTENT_DIGEST_MISMATCH', {
      skillId: input.skillId,
      expectedContentDigest: input.expectedContentDigest,
      observedContentDigest: root.contentDigest
    })
  }
  const bodyPages = []
  for (const skill of hydrated) {
    const pages = splitUtf8Pages(skill.content)
    pages.forEach((content, skillPageIndex) => bodyPages.push({
      skillId: skill.skillId,
      effectiveLayer: skill.selectedLayer,
      bodyDigest: skill.contentDigest,
      bytes: Buffer.byteLength(content, 'utf8'),
      content,
      skillPage: skillPageIndex + 1,
      skillTotalPages: pages.length
    }))
  }
  const resolutionIdentity = {
    project: input.project,
    turnBinding: input.turnBinding,
    contextEpoch: input.contextEpoch,
    skillId: input.skillId,
    preferredLayer,
    metadataDigests: hydrated.map(item => [item.skillId, item.metadataDigest]),
    contentDigests: hydrated.map(item => [item.skillId, item.contentDigest]),
    loadOrder: closure.loadOrder
  }
  const resolutionDigest = sha256(resolutionIdentity)
  let pageIndex = 0
  if (input.cursor) {
    const cursor = decodeExactCursor(input.cursor)
    if (!cursor ||
        cursor.schemaVersion !== 'SkillExactCursorV1' ||
        cursor.project !== input.project ||
        cursor.turnBinding !== input.turnBinding ||
        cursor.contextEpoch !== input.contextEpoch ||
        cursor.skillId !== input.skillId ||
        cursor.resolutionDigest !== resolutionDigest ||
        !Number.isInteger(cursor.pageIndex) ||
        cursor.pageIndex < 0 ||
        cursor.pageIndex >= bodyPages.length) {
      throw exactError('SKILL_EXACT_CURSOR_INVALID', { skillId: input.skillId })
    }
    pageIndex = cursor.pageIndex
  }
  const bodyPage = bodyPages[pageIndex]
  const nextCursor = pageIndex + 1 < bodyPages.length
    ? encodeExactCursor({
        schemaVersion: 'SkillExactCursorV1',
        project: input.project,
        turnBinding: input.turnBinding,
        contextEpoch: input.contextEpoch,
        skillId: input.skillId,
        resolutionDigest,
        pageIndex: pageIndex + 1
      })
    : null
  const receipt = {
    schemaVersion: 'SkillExactResolutionReceiptV1',
    status: nextCursor ? 'loading' : 'loaded',
    project: input.project,
    turnBinding: input.turnBinding,
    contextEpoch: input.contextEpoch,
    skillId: input.skillId,
    selected: {
      layer: root.selectedLayer,
      root: root.selectedRoot,
      path: portable(root.selectedPath),
      fileIdentity: root.fileIdentity
    },
    metadataDigest: root.metadataDigest,
    contentDigest: root.contentDigest,
    bodyBytes: root.bodyBytes,
    page: pageIndex + 1,
    totalPages: bodyPages.length,
    bodyPage: {
      skillId: bodyPage.skillId,
      skillPage: bodyPage.skillPage,
      skillTotalPages: bodyPage.skillTotalPages,
      bytes: bodyPage.bytes
    },
    dependencies: hydrated
      .filter(item => item.skillId !== input.skillId)
      .map(item => ({
        skillId: item.skillId,
        layer: item.selectedLayer,
        metadataDigest: item.metadataDigest,
        contentDigest: item.contentDigest,
        bodyBytes: item.bodyBytes
      })),
    loadOrder: closure.loadOrder,
    warnings: closure.warnings,
    fallback: 'no-skill-baseline-available',
    nextCursor,
    hostNativePersonal: 'host-managed-excluded',
    resolutionDigest,
    receiptDigest: ''
  }
  receipt.receiptDigest = sha256({ ...receipt, receiptDigest: null })
  const response = {
    schemaVersion: 'SkillRouteToolResultV1',
    ok: true,
    op: 'resolve_exact',
    stateChanged: false,
    idempotencyKey: sha256({ resolutionDigest, pageIndex }),
    receipt,
    bodyChunks: [bodyPage],
    delivery: {
      channel: 'mcp-tool-result',
      serializedBytes: 0,
      limitBytes: EXACT_RESPONSE_LIMIT_BYTES,
      runtimeServed: true,
      modelObserved: 'unverified'
    }
  }
  response.delivery.serializedBytes = byteLength(response)
  if (response.delivery.serializedBytes > EXACT_RESPONSE_LIMIT_BYTES) {
    throw exactError('SKILL_EXACT_RESPONSE_BUDGET', {
      serializedBytes: response.delivery.serializedBytes,
      limitBytes: EXACT_RESPONSE_LIMIT_BYTES
    })
  }
  return response
}

module.exports = {
  EXACT_BODY_PAGE_BYTES,
  EXACT_RESPONSE_LIMIT_BYTES,
  MAX_DEPENDENCY_NODES,
  MAX_DEPENDENCY_DEPTH,
  encodeExactCursor,
  decodeExactCursor,
  parseDependencyList,
  skillTopology,
  buildMetadataClosure,
  hydrateExactSkill,
  splitUtf8Pages,
  resolveExactSkillPage
}
