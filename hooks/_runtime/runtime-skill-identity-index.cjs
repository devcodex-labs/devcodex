'use strict'

const fs = require('fs')
const path = require('path')

const {
  MAX_LAYERED_SKILL_BYTES,
  isUnderPhysical,
  isReservedSkillId,
  isValidSkillId,
  resolveSkillRead,
  resolveGlobalSkillsRoot,
  resolveProjectSkillsRoot,
  resolveWorkspaceSkillsRoot
} = require('./skill-resolution.cjs')
const {
  resolveGlobalSkillRuntimeRoot
} = require('./global-skill-runtime-root.cjs')
const {
  byteLength,
  parseFrontmatter,
  portable,
  sanitizeModelText,
  sha256,
  validateSkillIntent
} = require('./progressive-skill-route-contract.cjs')

const INDEX_POLICY_VERSION = 'RuntimeSkillIdentityIndexV1.3'
const DEFAULT_INDEX_TIME_SLICE_MS = 5 * 1000

function extractMustReplyCore (body) {
  const text = String(body || '')
  const section = text.match(/##\s*必须回复[^\n]*\r?\n([\s\S]*?)(?=\r?\n##\s|\s*$)/i)
  const candidate = section
    ? section[1]
      .split(/\r?\n/)
      .map(line => line.replace(/^[-*]\s*/, '').trim())
      .find(line => line && !line.startsWith('#') && !/^不要|^仅此/.test(line))
    : (text.match(/(?:固定话术|必须回复|仅此)[：:]\s*([^\r\n]+)/i)?.[1] || '')
  const value = String(candidate || '').replace(/\s+/g, ' ').trim()
  if (!value || /[\u0000-\u001f\u007f-\u009f]/.test(value)) return ''
  return Array.from(value).slice(0, 256).join('')
}

function readJson (file, fsImpl = fs) {
  try {
    return JSON.parse(fsImpl.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function listSkillIds (skillsRoot, fsImpl = fs) {
  if (!skillsRoot || !fsImpl.existsSync(skillsRoot)) return []
  try {
    return fsImpl.readdirSync(skillsRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && isValidSkillId(entry.name))
      .map(entry => entry.name)
  } catch {
    return []
  }
}

function topologyForPortfolioSkill (skill) {
  const index = skill?.skillIndex || {}
  const requires = Array.isArray(index.requires)
    ? index.requires.map(String)
    : (Array.isArray(skill?.dependencies) ? skill.dependencies.map(String) : [])
  const conflicts = Array.isArray(index.conflictsWith)
    ? index.conflictsWith.map(String)
    : (Array.isArray(skill?.conflicts) ? skill.conflicts.map(String) : [])
  return {
    requires: [...new Set(requires)].sort(),
    conflicts: [...new Set(conflicts)].sort(),
    priority: Number.isFinite(Number(index.priority)) ? Number(index.priority) : 100
  }
}

function completePrefix (value, maxChars) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (text.length <= maxChars) return text
  const pieces = text.match(/[^。！？.!?;；]+[。！？.!?;；]?/g) || []
  let result = ''
  for (const piece of pieces) {
    if (!piece.trim()) continue
    if ((result + piece).length > maxChars) break
    result += piece
  }
  return result.trim()
}

function modelCardFromSources (skillId, frontmatter, intentResult) {
  const name = sanitizeModelText(frontmatter.name || skillId, { maxChars: 80 })
  if (!name.ok || !name.value) return { ok: false, reasonCode: name.reasonCode || 'sanitize-fail' }

  if (intentResult?.ok) {
    let whenToUse = intentResult.value.summary
    let omittedLabelCount = 0
    if (!whenToUse) {
      const labels = intentResult.value.intents.map(item => item.label)
      const accepted = []
      for (const label of labels) {
        const next = [...accepted, label].join('；')
        if (next.length > 160) break
        accepted.push(label)
      }
      whenToUse = accepted.join('；')
      omittedLabelCount = labels.length - accepted.length
    }
    const avoidWhen = intentResult.value.examples.negative.slice(0, 2).join('；')
    const card = {
      skillId,
      name: name.value,
      whenToUse,
      avoidWhen,
      domains: [...new Set(intentResult.value.intents.map(item => item.id))].slice(0, 6)
    }
    if (byteLength(card) > 768) return { ok: false, reasonCode: 'oversize' }
    return { ok: true, card, omittedLabelCount, source: 'intent' }
  }

  const description = completePrefix(frontmatter.description || '', 160)
  const whenToUse = sanitizeModelText(description, { maxChars: 160 })
  if (!whenToUse.ok) return { ok: false, reasonCode: whenToUse.reasonCode }
  const card = {
    skillId,
    name: name.value,
    whenToUse: whenToUse.value,
    avoidWhen: '',
    domains: []
  }
  if (byteLength(card) > 768) return { ok: false, reasonCode: 'oversize' }
  return { ok: true, card, omittedLabelCount: 0, source: 'frontmatter-fallback' }
}

function readIntent (skillId, skillPath, fsImpl = fs) {
  const intentPath = path.join(path.dirname(skillPath), 'intent.json')
  if (!fsImpl.existsSync(intentPath)) {
    return { exists: false, ok: false, reasonCode: 'intent-absent', intentPath, digest: null }
  }
  let stat
  try {
    stat = fsImpl.statSync(intentPath)
  } catch {
    return { exists: true, ok: false, reasonCode: 'malformed-intent', intentPath, digest: null }
  }
  if (!stat.isFile() || stat.size > 16 * 1024) {
    return { exists: true, ok: false, reasonCode: 'oversize', intentPath, digest: null }
  }
  const rawText = fsImpl.readFileSync(intentPath, 'utf8')
  let raw
  try {
    raw = JSON.parse(rawText)
  } catch {
    return { exists: true, ok: false, reasonCode: 'malformed-intent', intentPath, digest: sha256(rawText) }
  }
  const result = validateSkillIntent(raw, { skillId })
  return {
    ...result,
    exists: true,
    intentPath,
    digest: result.ok ? result.digest : sha256(rawText)
  }
}

function rejection (skillId, effectiveLayer, reasonCode, sourceKey, extra = {}) {
  const detail = {
    skillId,
    effectiveLayer: effectiveLayer || null,
    reasonCode,
    sourceKey: portable(sourceKey || ''),
    sourceIdentity: extra.sourceIdentity || null,
    action: extra.action || 'exclude-model-card'
  }
  return {
    ...detail,
    detailDigest: sha256(detail)
  }
}

function buildRuntimeSkillIdentityIndex (options = {}) {
  const fsImpl = options.fs || fs
  const cwd = path.resolve(options.cwd || process.cwd())
  const resolvedGlobalRuntime = options.globalRuntime || resolveGlobalSkillRuntimeRoot({
    runtimeRoot: options.runtimeRoot,
    packageRoot: options.packageRoot,
    globalSkillsRoot: options.globalSkillsRoot,
    env: options.env,
    home: options.home,
    fs: fsImpl
  })
  const globalRoot = resolvedGlobalRuntime.status === 'resolved'
    ? resolvedGlobalRuntime.root
    : resolveGlobalSkillsRoot(options)
  const globalRuntime = resolvedGlobalRuntime.status === 'resolved'
    ? resolvedGlobalRuntime
    : {
        ...resolvedGlobalRuntime,
        status: 'degraded',
        root: globalRoot,
        portfolioPath: path.join(globalRoot, 'portfolio.json')
      }
  const parsedPortfolio = readJson(globalRuntime.portfolioPath, fsImpl)
  const portfolioAvailable = Boolean(parsedPortfolio && Array.isArray(parsedPortfolio.skills))
  const portfolio = parsedPortfolio && Array.isArray(parsedPortfolio.skills)
    ? parsedPortfolio
    : { skills: [] }

  const projectSkillsRoot = resolveProjectSkillsRoot(cwd, {
    ...options,
    fs: fsImpl
  })
  const workspaceSkillsRoot = resolveWorkspaceSkillsRoot(cwd, {
    ...options,
    fs: fsImpl
  })
  const projectIds = listSkillIds(projectSkillsRoot, fsImpl)
  const workspaceIds = listSkillIds(workspaceSkillsRoot, fsImpl)
  const globalIds = listSkillIds(globalRoot, fsImpl)
  const portfolioById = new Map(portfolio.skills.map(skill => [String(skill.id), skill]))
  const allIds = [...new Set([
    ...portfolioById.keys(),
    ...globalIds,
    ...workspaceIds,
    ...projectIds
  ])].sort()
  const entries = []
  const cards = []
  const rejections = []
  const warnings = []
  if (resolvedGlobalRuntime.status !== 'resolved') {
    warnings.push({
      code: resolvedGlobalRuntime.errorCode || 'GLOBAL_SKILL_RUNTIME_ROOT_UNRESOLVED',
      action: 'continue-with-project-workspace-and-physical-global-fallback'
    })
  }
  if (!parsedPortfolio || !Array.isArray(parsedPortfolio.skills)) {
    warnings.push({
      code: 'SKILL_PORTFOLIO_READ_FAILED',
      action: 'continue-with-derived-metadata-and-empty-global-topology'
    })
  }
  const coverage = {
    scannedP: projectIds.length,
    scannedW: workspaceIds.length,
    scannedG: globalIds.length || portfolioById.size,
    effective: 0,
    autoSelectable: 0,
    reserved: 0,
    gray: 0,
    rejected: 0,
    fallbackFrontmatter: 0,
    intentBacked: 0,
    scanTimedOut: false,
    remainingCount: 0
  }
  const scanStartedAt = Date.now()
  const timeSliceMs = Number.isFinite(Number(options.indexTimeSliceMs))
    ? Math.max(1, Number(options.indexTimeSliceMs))
    : DEFAULT_INDEX_TIME_SLICE_MS

  for (let skillIndex = 0; skillIndex < allIds.length; skillIndex += 1) {
    if (skillIndex > 0 && Date.now() - scanStartedAt >= timeSliceMs) {
      coverage.scanTimedOut = true
      coverage.remainingCount = allIds.length - skillIndex
      warnings.push({
        code: 'SKILL_METADATA_SCAN_TIME_SLICE',
        remainingCount: coverage.remainingCount,
        action: 'continue-with-bounded-shortlist-or-no-skill-baseline'
      })
      break
    }
    const skillId = allIds[skillIndex]
    const resolved = resolveSkillRead(skillId, {
      ...options,
      cwd,
      fs: fsImpl,
      globalSkillsRoot: globalRoot,
      includeContent: true,
      metadataOnly: true,
      metadataMaxBytes: options.metadataMaxBytes || MAX_LAYERED_SKILL_BYTES
    })
    const trace = resolved.trace
    if (!resolved.content || !['project', 'workspace', 'global'].includes(trace.selectedLayer)) {
      rejections.push(rejection(
        skillId,
        trace.selectedLayer,
        trace.reasonCode || 'missing',
        trace.selectedPath || trace.pPath || trace.wPath || trace.gPath,
        { sourceIdentity: trace.digest }
      ))
      continue
    }

    coverage.effective += 1
    const layer = trace.selectedLayer
    const portfolioSkill = portfolioById.get(skillId)
    const topology = layer === 'global'
      ? topologyForPortfolioSkill(portfolioSkill)
      : { requires: [], conflicts: [], priority: 50 }
    const lifecycle = layer === 'global'
      ? String(portfolioSkill?.lifecycleState || (portfolioAvailable ? 'gray' : 'active'))
      : 'active'
    const reserved = isReservedSkillId(skillId)
    if (reserved) coverage.reserved += 1
    if (lifecycle !== 'active') coverage.gray += 1

    const parsed = parseFrontmatter(resolved.content)
    const intent = readIntent(skillId, trace.selectedPath, fsImpl)
    const intentInvalid = intent.exists && !intent.ok
    const cardResult = intentInvalid
      ? { ok: false, reasonCode: intent.reasonCode }
      : modelCardFromSources(skillId, parsed.frontmatter, intent)
    const sourceIdentity = sha256({
      skillId,
      layer,
      metadataDigest: trace.metadataDigest || trace.digest,
      fileIdentity: trace.fileIdentity || null,
      intentDigest: intent.digest,
      topology,
      lifecycle,
      reserved
    })
    const entry = {
      skillId,
      effectiveLayer: layer,
      resolvedPath: portable(trace.selectedPath),
      sourceIdentity,
      metadataDigest: trace.metadataDigest || trace.digest,
      fileIdentity: trace.fileIdentity || null,
      bodyDigest: trace.digest,
      bodyDigestKind: 'metadata',
      intentDigest: intent.digest,
      topologyDigest: sha256(topology),
      bodyBytes: trace.contentBytes,
      bodyChunkBytes: trace.contentBytes + byteLength({
        skillId,
        effectiveLayer: layer,
        bodyDigest: trace.digest,
        bytes: trace.contentBytes,
        content: ''
      }),
      mustReplyCore: extractMustReplyCore(resolved.content),
      requires: topology.requires,
      conflicts: topology.conflicts,
      priority: topology.priority,
      reserved,
      lifecycle: lifecycle === 'active' ? 'green' : 'gray',
      autoSelectable: false,
      cardDigest: null,
      cardSource: null
    }

    if (reserved) {
      rejections.push(rejection(skillId, layer, 'reserved-filtered', trace.selectedPath, { sourceIdentity }))
    } else if (lifecycle !== 'active') {
      rejections.push(rejection(skillId, layer, 'gray-lifecycle', trace.selectedPath, { sourceIdentity }))
    } else if (!cardResult.ok) {
      rejections.push(rejection(
        skillId,
        layer,
        cardResult.reasonCode || 'sanitize-fail',
        intent.exists ? intent.intentPath : trace.selectedPath,
        { sourceIdentity }
      ))
    } else {
      entry.autoSelectable = true
      entry.cardDigest = sha256(cardResult.card)
      entry.cardSource = cardResult.source
      cards.push(cardResult.card)
      coverage.autoSelectable += 1
      if (cardResult.source === 'intent') coverage.intentBacked += 1
      else coverage.fallbackFrontmatter += 1
    }
    entries.push(entry)
  }

  rejections.sort((left, right) =>
    [left.skillId, left.reasonCode, left.effectiveLayer || '', left.sourceKey, left.detailDigest]
      .join('\u0000')
      .localeCompare(
        [right.skillId, right.reasonCode, right.effectiveLayer || '', right.sourceKey, right.detailDigest]
          .join('\u0000')
      )
  )
  coverage.rejected = rejections.length
  const semanticEntries = entries.map(entry => {
    const { resolvedPath: _resolvedPath, ...semantic } = entry
    return semantic
  })
  const index = {
    schemaVersion: 'RuntimeSkillIdentityIndexV1',
    project: String(options.project || path.basename(cwd)),
    activeRoot: portable(options.activeRoot || ''),
    globalRuntime,
    roots: {
      project: projectSkillsRoot ? portable(projectSkillsRoot) : null,
      workspace: workspaceSkillsRoot ? portable(workspaceSkillsRoot) : null,
      global: portable(globalRoot),
      hostNativePersonal: 'host-managed-excluded'
    },
    entries,
    cards: cards.sort((left, right) => left.skillId.localeCompare(right.skillId)),
    rejections,
    warnings,
    coverage,
    resolverPolicyVersion: INDEX_POLICY_VERSION
  }
  index.indexDigest = sha256({
    entries: semanticEntries,
    cards: index.cards,
    rejections,
    warnings,
    coverage,
    resolverPolicyVersion: INDEX_POLICY_VERSION
  })
  return index
}

/**
 * Hydrate only the entries a plan actually selected. The metadata index digest
 * remains the catalog identity; full body digests belong to the executable plan.
 */
function hydrateRuntimeSkillIdentityIndex (index, skillIds, options = {}) {
  const fsImpl = options.fs || fs
  const requested = new Set(Array.isArray(skillIds) ? skillIds.map(String) : [])
  const entries = index.entries.map(entry => ({ ...entry }))
  const hydrated = []
  for (const entry of entries) {
    if (!requested.has(entry.skillId)) continue
    const resolved = resolveSkillRead(entry.skillId, {
      ...options,
      fs: fsImpl,
      projectSkillsRoot: index.roots?.project || options.projectSkillsRoot,
      workspaceSkillsRoot: index.roots?.workspace || options.workspaceSkillsRoot,
      globalSkillsRoot: index.roots?.global || options.globalSkillsRoot,
      includeContent: true,
      maxBytes: options.maxHydratedBytes || MAX_LAYERED_SKILL_BYTES
    })
    if (!resolved.content || resolved.trace.selectedLayer !== entry.effectiveLayer) {
      const error = new Error('SKILL_METADATA_BODY_DRIFT')
      error.code = 'SKILL_METADATA_BODY_DRIFT'
      error.skillId = entry.skillId
      throw error
    }
    let observedIdentity
    try {
      const stat = fsImpl.statSync(resolved.trace.selectedPath)
      observedIdentity = {
        realPath: portable(fsImpl.realpathSync(resolved.trace.selectedPath)),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        device: Number.isFinite(Number(stat.dev)) ? Number(stat.dev) : null,
        inode: Number.isFinite(Number(stat.ino)) ? Number(stat.ino) : null
      }
    } catch {
      observedIdentity = null
    }
    const expectedIdentity = entry.fileIdentity
    const sameIdentity = Boolean(expectedIdentity && observedIdentity &&
      expectedIdentity.realPath === observedIdentity.realPath &&
      Number(expectedIdentity.size) === Number(observedIdentity.size) &&
      Number(expectedIdentity.mtimeMs) === Number(observedIdentity.mtimeMs) &&
      (expectedIdentity.device == null || observedIdentity.device == null || Number(expectedIdentity.device) === Number(observedIdentity.device)) &&
      (expectedIdentity.inode == null || observedIdentity.inode == null || Number(expectedIdentity.inode) === Number(observedIdentity.inode)))
    const selectedRoot = index.roots?.[entry.effectiveLayer]
    if (!sameIdentity || !selectedRoot || !isUnderPhysical(selectedRoot, resolved.trace.selectedPath, fsImpl)) {
      const error = new Error('SKILL_METADATA_BODY_DRIFT')
      error.code = 'SKILL_METADATA_BODY_DRIFT'
      error.skillId = entry.skillId
      error.expectedFileIdentity = expectedIdentity || null
      error.observedFileIdentity = observedIdentity
      throw error
    }
    entry.resolvedPath = portable(resolved.trace.selectedPath)
    entry.bodyDigest = resolved.trace.digest
    entry.bodyDigestKind = 'full'
    entry.fileIdentity = observedIdentity
    entry.bodyBytes = resolved.trace.contentBytes
    entry.bodyChunkBytes = byteLength({
      skillId: entry.skillId,
      effectiveLayer: entry.effectiveLayer,
      bodyDigest: entry.bodyDigest,
      bytes: entry.bodyBytes,
      content: resolved.content
    })
    entry.mustReplyCore = extractMustReplyCore(resolved.content)
    hydrated.push(entry.skillId)
  }
  return {
    ...index,
    entries,
    hydration: {
      requestedSkillIds: [...requested].sort(),
      hydratedSkillIds: hydrated.sort(),
      unselectedBodyReads: 0
    }
  }
}

module.exports = {
  INDEX_POLICY_VERSION,
  DEFAULT_INDEX_TIME_SLICE_MS,
  buildRuntimeSkillIdentityIndex,
  hydrateRuntimeSkillIdentityIndex,
  modelCardFromSources,
  extractMustReplyCore,
  topologyForPortfolioSkill,
  completePrefix,
  readIntent,
  listSkillIds
}
