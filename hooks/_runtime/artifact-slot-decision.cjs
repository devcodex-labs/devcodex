'use strict'

const fs = require('fs')
const path = require('path')

const { sha256, stableStringify } = require('./content-identity.cjs')
const {
  extractMutationFootprint,
  validateMutationFootprint
} = require('./mutation-footprint.cjs')

const REGISTRY_PATH = path.join(__dirname, 'artifact-slot-registry.v2.json')
const LEGACY_REGISTRY_PATH = path.join(__dirname, 'artifact-slot-registry.v1.json')
const DECISION_SCHEMA = 'ArtifactSlotDecisionV2'
const LEGACY_DECISION_SCHEMA = 'ArtifactSlotDecisionV1'
const REGISTRY_SCHEMA = 'ArtifactSlotRegistryV2'
const LEGACY_REGISTRY_SCHEMA = 'ArtifactSlotRegistryV1'
const LAYERED_REGISTRY_SCHEMA = 'LayeredArtifactSlotRegistryV2'
const OVERLAY_SCHEMA = 'ArtifactSlotRegistryOverlayV2'
const DIGEST_RE = /^[a-f0-9]{64}$/
const PHASE_CLASSES = Object.freeze({ CP1: 'cp1', CP2: 'cp2', CP3: 'cp3-plan' })
const DIRECT_TRUTH_MATCH_TYPES = new Set(['canonical', 'legacy-read'])

function digest(value) {
  return sha256(Buffer.from(stableStringify(value), 'utf8'))
}

function slash(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '')
}

function isLogicalTarget(value) {
  return /^[a-z][a-z0-9+.-]*:/i.test(String(value || '')) && !/^[a-z]:[\\/]/i.test(String(value || ''))
}

function comparable(value) {
  const normalized = path.normalize(String(value || ''))
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function insideOrSame(child, parent) {
  const c = comparable(child)
  const p = comparable(parent)
  return c === p || c.startsWith(p + path.sep)
}

function readJsonFile(file, fsImpl = fs) {
  return JSON.parse(fsImpl.readFileSync(file, 'utf8'))
}

function validateBaseRegistry(registry) {
  const errors = []
  if (registry?.schemaVersion !== REGISTRY_SCHEMA || !Array.isArray(registry.slots)) errors.push('base-schema')
  if (!Array.isArray(registry?.rootClasses) || !Array.isArray(registry?.taskKinds) || !Array.isArray(registry?.formalRoots)) errors.push('base-roots')
  const ids = new Set()
  for (const slot of registry?.slots || []) {
    if (!slot?.slotId || ids.has(slot.slotId)) errors.push(`slot-id:${slot?.slotId || 'missing'}`)
    ids.add(slot?.slotId)
    if (!registry.rootClasses.includes(slot.rootClass)) errors.push(`slot-root:${slot.slotId}`)
    if (!['task', 'project'].includes(slot.scope)) errors.push(`slot-scope:${slot.slotId}`)
    if (!slot.owner || !slot.writePolicy || !slot.mutability || !['forbid', 'confirm', 'allow'].includes(slot.destructivePolicy)) errors.push(`slot-policy:${slot.slotId}`)
    if (typeof slot.protected !== 'boolean') errors.push(`slot-protected:${slot.slotId}`)
    for (const pattern of [...(slot.relativePatterns || []), ...(slot.projectRelativePatterns || []), ...(slot.candidatePatterns || []), ...(slot.legacyReadPatterns || []), ...(slot.reportReadPatterns || [])]) {
      try { new RegExp(pattern, 'i') } catch { errors.push(`slot-pattern:${slot.slotId}`) }
    }
  }
  return { valid: errors.length === 0, errors }
}

function safeOverlayPattern(value) {
  const text = String(value || '')
  return text.startsWith('^') && !/(?:^|[/\\])\.\.(?:[/\\]|$)|^[a-z]:|^[/\\]{1,2}/i.test(text)
}

function validateOverlay(overlay, base, input = {}) {
  const errors = []
  if (overlay?.schemaVersion !== OVERLAY_SCHEMA || !Array.isArray(overlay?.slots) || !Array.isArray(overlay?.slotExtensions)) errors.push('overlay-schema')
  if (String(input.project || '') && overlay?.project !== input.project) errors.push('overlay-project-mismatch')
  if (overlay?.baseRegistryId !== base.registryId) errors.push('overlay-base-mismatch')
  if (overlay?.constraints?.mayWidenProtected !== false) errors.push('overlay-protected-policy')
  const baseIds = new Set(base.slots.map(slot => slot.slotId))
  const addedIds = new Set()
  for (const slot of overlay?.slots || []) {
    if (!slot?.slotId || baseIds.has(slot.slotId) || addedIds.has(slot.slotId)) errors.push(`overlay-slot-conflict:${slot?.slotId || 'missing'}`)
    addedIds.add(slot?.slotId)
    if (!base.rootClasses.includes(slot.rootClass)) errors.push(`overlay-slot-root:${slot.slotId}`)
    if (slot.protected !== false || slot.owner !== 'task-owner' || slot.writePolicy !== 'bounded-path' || slot.destructivePolicy !== 'forbid') errors.push(`overlay-slot-policy:${slot.slotId}`)
    const patterns = [...(slot.relativePatterns || []), ...(slot.projectRelativePatterns || [])]
    if (!patterns.length || patterns.some(pattern => !safeOverlayPattern(pattern))) errors.push(`overlay-slot-pattern:${slot.slotId}`)
  }
  for (const extension of overlay?.slotExtensions || []) {
    const baseSlot = base.slots.find(slot => slot.slotId === extension?.slotId)
    if (!baseSlot) errors.push(`overlay-extension-missing:${extension?.slotId || 'missing'}`)
    const keys = Object.keys(extension || {}).filter(key => key !== 'slotId' && key !== 'consumers')
    if (keys.length || !Array.isArray(extension?.consumers)) errors.push(`overlay-extension-widening:${extension?.slotId || 'missing'}`)
  }
  return { valid: errors.length === 0, errors }
}

function readArtifactSlotRegistry(registryPath = REGISTRY_PATH, options = {}) {
  const fsImpl = options.fs || fs
  const registry = readJsonFile(registryPath, fsImpl)
  if (registry?.schemaVersion === LEGACY_REGISTRY_SCHEMA && Array.isArray(registry.slots)) return registry
  const validation = validateBaseRegistry(registry)
  if (!validation.valid) {
    const error = new Error('ArtifactSlotRegistryV2 is invalid')
    error.code = 'ARTIFACT_SLOT_REGISTRY_INVALID'
    error.details = validation.errors
    throw error
  }
  return registry
}

function readLayeredArtifactSlotRegistry(input = {}) {
  const fsImpl = input.fs || fs
  const basePath = input.baseRegistryPath || input.registryPath || REGISTRY_PATH
  const base = input.baseRegistry || readArtifactSlotRegistry(basePath, { fs: fsImpl })
  if (base.schemaVersion !== REGISTRY_SCHEMA) {
    const error = new Error('ArtifactSlotRegistryV1 is reader compatibility only')
    error.code = 'ARTIFACT_SLOT_REGISTRY_V2_REQUIRED'
    throw error
  }
  const baseRegistryDigest = digest(base)
  const overlayPath = input.overlayPath || (input.activeRoot
    ? path.join(input.activeRoot, 'profile', 'artifact-slot-registry.overlay.v2.json')
    : '')
  let overlay = null
  if (overlayPath && fsImpl.existsSync(overlayPath)) overlay = readJsonFile(overlayPath, fsImpl)
  if (overlay) {
    const validation = validateOverlay(overlay, base, input)
    if (!validation.valid) {
      const error = new Error('ArtifactSlotRegistryOverlayV2 is invalid')
      error.code = 'ARTIFACT_SLOT_REGISTRY_OVERLAY_INVALID'
      error.details = validation.errors
      throw error
    }
  }
  const extensions = new Map((overlay?.slotExtensions || []).map(item => [item.slotId, item]))
  const slots = base.slots.map(slot => {
    const extension = extensions.get(slot.slotId)
    return extension ? { ...slot, consumers: [...new Set([...(slot.consumers || []), ...extension.consumers])].sort() } : { ...slot }
  })
  slots.push(...(overlay?.slots || []).map(slot => ({ ...slot, overlayOwned: true })))
  const overlayDigest = overlay ? digest(overlay) : null
  const semantic = {
    schemaVersion: LAYERED_REGISTRY_SCHEMA,
    contractVersion: '2',
    baseRegistryId: base.registryId,
    baseRegistryDigest,
    overlayDigest,
    overlayProject: overlay?.project || null,
    rootClasses: base.rootClasses,
    taskKinds: base.taskKinds,
    formalRoots: base.formalRoots,
    protectedConstraints: base.protectedConstraints,
    slots
  }
  return Object.freeze({ ...semantic, mergedRegistryDigest: digest(semantic) })
}

function canonicalArtifactName(slotId, registry = null) {
  const source = registry || readLayeredArtifactSlotRegistry()
  const slot = source.slots.find(item => item.slotId === slotId)
  return slot?.canonicalNames?.[0] || ''
}

/**
 * Candidate and report alternatives are discoverable inventory entries, not
 * standalone process authority. A versioned candidate becomes authoritative
 * only when its exact confirmation/evidence binding is verified by the caller.
 */
function isAuthoritativeTaskArtifact(artifact, options = {}) {
  if (!artifact?.slot) return false
  if (DIRECT_TRUTH_MATCH_TYPES.has(artifact.matchType)) return true
  return artifact.matchType === 'versioned-candidate' && options.actualCandidateQualified === true
}

function realpathExisting(value, fsImpl = fs) {
  const method = fsImpl.realpathSync?.native || fsImpl.realpathSync
  return method.call(fsImpl.realpathSync?.native ? fsImpl.realpathSync : fsImpl, value)
}

function canonicalizeTarget(target, activeRoot, options = {}) {
  const fsImpl = options.fs || fs
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)) {
    return { status: 'logical', canonical: target, relative: target }
  }
  const absolute = path.resolve(options.cwd || process.cwd(), target)
  const rootAbsolute = path.resolve(activeRoot)
  let rootReal
  try { rootReal = realpathExisting(rootAbsolute, fsImpl) } catch (error) {
    return { status: 'invalid', errorCode: 'ARTIFACT_ACTIVE_ROOT_UNAVAILABLE', message: error.message }
  }
  let cursor = absolute
  const missing = []
  while (true) {
    try {
      const ancestorReal = realpathExisting(cursor, fsImpl)
      const canonical = path.join(ancestorReal, ...missing.reverse())
      if (!insideOrSame(canonical, rootReal)) {
        return { status: 'outside', errorCode: 'ARTIFACT_TARGET_OUTSIDE_ACTIVE_ROOT', canonical, activeRoot: rootReal }
      }
      return {
        status: 'inside',
        canonical,
        activeRoot: rootReal,
        relative: slash(path.relative(rootReal, canonical)),
        exists: missing.length === 0
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        return { status: 'invalid', errorCode: 'ARTIFACT_TARGET_REALPATH_FAILED', message: error.message }
      }
    }
    const parent = path.dirname(cursor)
    if (parent === cursor) return { status: 'outside', errorCode: 'ARTIFACT_TARGET_ANCESTOR_UNAVAILABLE' }
    missing.push(path.basename(cursor))
    cursor = parent
  }
}

function createArtifactRootIdentity(value, options = {}) {
  const resolved = path.resolve(String(value || ''))
  const canonical = canonicalizeTarget(resolved, resolved, options).activeRoot || resolved
  return {
    canonicalPath: canonical,
    digest: digest(comparable(canonical))
  }
}

function normalizeArtifactRoots(value, options = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return {
      activeRoot: value.activeRoot ? path.resolve(value.activeRoot) : null,
      projectRoot: value.projectRoot ? path.resolve(value.projectRoot) : null
    }
  }
  return {
    activeRoot: value ? path.resolve(value) : null,
    projectRoot: options.projectRoot ? path.resolve(options.projectRoot) : null
  }
}

function canonicalizeAgainstRoots(target, rootsInput, options = {}) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)) {
    return { status: 'logical', canonical: target, relative: target, rootClass: 'logical' }
  }
  const roots = normalizeArtifactRoots(rootsInput, options)
  const attempts = []
  for (const [rootClass, root] of [['active-root', roots.activeRoot], ['project-root', roots.projectRoot]]) {
    if (!root || attempts.some(item => item.root && comparable(item.root) === comparable(root))) continue
    const attempt = canonicalizeTarget(target, root, options)
    attempts.push({ root, rootClass, attempt })
    if (attempt.status === 'inside') return { ...attempt, rootClass, root }
  }
  const invalid = attempts.find(item => item.attempt.status === 'invalid')
  if (invalid) return { ...invalid.attempt, rootClass: invalid.rootClass, root: invalid.root }
  return {
    status: 'outside',
    errorCode: 'ARTIFACT_TARGET_OUTSIDE_ALLOWED_ROOTS',
    canonical: path.resolve(options.cwd || process.cwd(), target),
    roots
  }
}

function regexes(values) {
  return (values || []).map(value => new RegExp(value, 'i'))
}

function matchesAny(value, patterns) {
  return regexes(patterns).some(pattern => pattern.test(value))
}

function classifyLogicalTarget(target, registry) {
  const scheme = String(target).match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase()
  const matches = registry.slots.filter(item =>
    (item.rootClass === 'logical' || (!item.rootClass && item.logicalSchemes?.length)) &&
    (item.logicalSchemes || []).includes(scheme)
  )
  if (matches.length !== 1) {
    return {
      slot: null,
      matchType: matches.length ? 'ambiguous-slot' : 'unknown-logical',
      matches: matches.map(slot => slot.slotId),
      taskKind: null,
      taskName: null,
      taskRelative: target,
      rootClass: 'logical'
    }
  }
  return { slot: matches[0], matchType: 'logical', taskKind: null, taskName: null, taskRelative: target, rootClass: 'logical' }
}

function classifyRelativeTarget(relative, registry, rootClass = 'active-root') {
  const parts = slash(relative).split('/').filter(Boolean)
  const taskKind = rootClass === 'active-root' && registry.taskKinds.includes(parts[0]) && parts.length >= 3 ? parts[0] : null
  const taskName = taskKind ? parts[1] : null
  const taskRelative = taskKind ? parts.slice(2).join('/') : null
  const basename = taskRelative ? path.posix.basename(taskRelative) : path.posix.basename(slash(relative))
  const matches = []
  for (const slot of registry.slots.filter(item => (item.rootClass || 'active-root') === rootClass)) {
    if (taskKind && slot.taskKinds?.includes(taskKind)) {
      if ((slot.canonicalNames || []).includes(taskRelative)) matches.push({ slot, matchType: 'canonical', taskKind, taskName, taskRelative, rootClass })
      else if (matchesAny(taskRelative, slot.candidatePatterns)) matches.push({ slot, matchType: 'versioned-candidate', taskKind, taskName, taskRelative, rootClass })
      else if (matchesAny(taskRelative, slot.relativePatterns)) matches.push({ slot, matchType: 'bounded', taskKind, taskName, taskRelative, rootClass })
      if (!taskRelative.includes('/') && matchesAny(basename, slot.legacyReadPatterns)) {
        matches.push({ slot, matchType: 'legacy-read', taskKind, taskName, taskRelative, rootClass })
      }
      if (taskRelative.startsWith('reports/') && matchesAny(basename, slot.reportReadPatterns)) {
        matches.push({ slot, matchType: 'report-alternative', taskKind, taskName, taskRelative, rootClass })
      }
    }
    if (!taskKind && matchesAny(slash(relative), slot.projectRelativePatterns)) {
      matches.push({ slot, matchType: 'bounded', taskKind: null, taskName: null, taskRelative: slash(relative), rootClass })
    }
  }
  const unique = matches.filter((item, index, all) => all.findIndex(other => other.slot.slotId === item.slot.slotId && other.matchType === item.matchType) === index)
  if (unique.length === 1) return unique[0]
  if (unique.length > 1) {
    return {
      slot: null,
      matchType: 'ambiguous-slot',
      matches: unique.map(item => ({ slotId: item.slot.slotId, matchType: item.matchType })),
      taskKind,
      taskName,
      taskRelative,
      rootClass
    }
  }
  const formal = rootClass === 'active-root' && registry.formalRoots.includes(parts[0])
  return { slot: null, matchType: formal ? 'unknown-formal' : 'non-formal', taskKind, taskName, taskRelative, rootClass }
}

function inspectTarget(target, roots, registry, options = {}) {
  const canonical = canonicalizeAgainstRoots(target, roots, options)
  if (canonical.status === 'logical') {
    const classified = classifyLogicalTarget(target, registry)
    return { ...canonical, classified }
  }
  if (canonical.status !== 'inside') return { ...canonical, classified: null }
  return { ...canonical, classified: classifyRelativeTarget(canonical.relative, registry, canonical.rootClass) }
}

function boundedWalk(dir, options = {}, relative = '', result = { files: [], overflow: false }) {
  const fsImpl = options.fs || fs
  const maxFiles = Number.isInteger(options.maxFiles) ? options.maxFiles : 512
  const maxDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : 5
  const depth = relative ? relative.split('/').length : 0
  if (result.files.length >= maxFiles || depth > maxDepth) {
    result.overflow = true
    return result
  }
  let entries
  try { entries = fsImpl.readdirSync(dir, { withFileTypes: true }) } catch { return result }
  for (const entry of entries) {
    if (result.files.length >= maxFiles) {
      result.overflow = true
      break
    }
    const rel = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isFile()) result.files.push(rel)
    else if (entry.isDirectory() && depth < maxDepth && ['reports', 'evidence', 'decisions', 'capability-surface-decisions', '.memory'].includes(relative.split('/')[0] || entry.name)) {
      boundedWalk(path.join(dir, entry.name), options, rel, result)
    }
  }
  return result
}

function enumerateTaskArtifacts(input = {}) {
  const taskRoot = path.resolve(input.taskRoot)
  const inferredActiveRoot = input.activeRoot || path.dirname(path.dirname(taskRoot))
  const registry = input.registry || readLayeredArtifactSlotRegistry({
    activeRoot: inferredActiveRoot,
    project: input.project,
    registryPath: input.registryPath,
    overlayPath: input.overlayPath,
    fs: input.fs
  })
  const parentKind = path.basename(path.dirname(taskRoot))
  let taskKind = input.taskKind || (registry.taskKinds.includes(parentKind) ? parentKind : '')
  if (!taskKind) {
    let rootNames = []
    try { rootNames = (input.fs || fs).readdirSync(taskRoot).map(String) } catch { }
    taskKind = rootNames.some(name => /问题|修复方案/i.test(name)) ? 'bugs' : 'requirements'
  }
  const walked = boundedWalk(taskRoot, input)
  const artifacts = []
  const unknownFormal = []
  for (const relative of walked.files) {
    const classified = classifyRelativeTarget(`${taskKind}/${path.basename(taskRoot)}/${relative}`, registry, 'active-root')
    if (classified.slot) artifacts.push({ relativePath: relative, ...classified })
    else if (/^(?:00|01|02|04|05)[-–—].+\.md$/i.test(path.posix.basename(relative))) unknownFormal.push(relative)
  }
  const activeByGroup = new Map()
  for (const artifact of artifacts) {
    if (!artifact.slot.alternativeGroup || ['legacy-read', 'versioned-candidate', 'report-alternative'].includes(artifact.matchType)) continue
    const list = activeByGroup.get(artifact.slot.alternativeGroup) || []
    list.push(artifact.relativePath)
    activeByGroup.set(artifact.slot.alternativeGroup, list)
  }
  const conflicts = [...activeByGroup.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([alternativeGroup, paths]) => ({ alternativeGroup, paths: [...paths].sort() }))
  return {
    schemaVersion: 'TaskArtifactInventoryV2',
    taskRoot,
    taskKind,
    artifacts,
    unknownFormal,
    conflicts,
    overflow: walked.overflow,
    mergedRegistryDigest: registry.mergedRegistryDigest || null,
    inventoryDigest: digest({ taskKind, artifacts: artifacts.map(item => [item.relativePath, item.slot.slotId, item.matchType]), unknownFormal, conflicts, overflow: walked.overflow, mergedRegistryDigest: registry.mergedRegistryDigest || null })
  }
}

function hasTaskArtifact(task, phase, options = {}) {
  const artifactClass = PHASE_CLASSES[phase]
  if (!artifactClass) return false
  const fsImpl = options.fs || fs
  const taskRoot = path.resolve(task.fullPath || task.taskRoot || task)
  const registry = options.registry || readLayeredArtifactSlotRegistry({
    activeRoot: options.activeRoot || path.dirname(path.dirname(taskRoot)),
    project: options.project,
    registryPath: options.registryPath,
    overlayPath: options.overlayPath,
    fs: fsImpl
  })
  const taskKind = task.kind || task.taskKind || path.basename(path.dirname(taskRoot))
  const slots = registry.slots.filter(item => item.taskKinds?.includes(taskKind) && item.artifactClass === artifactClass)
  if (!slots.length) return false
  let names = []
  try { names = fsImpl.readdirSync(taskRoot).map(String) } catch { return false }
  for (const slot of slots) {
    if ((slot.canonicalNames || []).some(name => names.includes(name))) return true
    if (names.some(name => matchesAny(name, slot.candidatePatterns))) return true
    if (names.some(name => matchesAny(name, slot.legacyReadPatterns))) return true
  }
  return false
}

function existingTruthForMatch(match, activeRoot, registry, options = {}) {
  if (!match?.classified?.slot?.alternativeGroup || !match.classified.taskKind || !match.classified.taskName) return []
  const taskRoot = path.join(activeRoot, match.classified.taskKind, match.classified.taskName)
  const inventory = enumerateTaskArtifacts({ taskRoot, taskKind: match.classified.taskKind, registry, ...options })
  return inventory.artifacts
    .filter(item => item.slot.alternativeGroup === match.classified.slot.alternativeGroup && item.matchType !== 'legacy-read')
    .map(item => path.join(taskRoot, item.relativePath))
}

function decideArtifactMutation(input = {}, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  const registry = input.registry || readLayeredArtifactSlotRegistry({
    activeRoot: input.activeRoot,
    project: input.project,
    registryPath: input.registryPath,
    overlayPath: input.overlayPath,
    fs: options.fs
  })
  const activeRoot = path.resolve(input.activeRoot)
  const projectRoot = input.projectRoot ? path.resolve(input.projectRoot) : path.resolve(input.cwd || process.cwd())
  const roots = { activeRoot, projectRoot }
  const footprint = input.footprint || extractMutationFootprint(input.payload, { cwd: input.cwd })
  const footprintValidation = validateMutationFootprint(footprint)
  const source = footprint.sourceTargets.map(target => inspectTarget(target, roots, registry, { ...options, cwd: input.cwd }))
  const targets = footprint.targetTargets.map(target => inspectTarget(target, roots, registry, { ...options, cwd: input.cwd }))
  const inspected = [...source, ...targets]
  const anyFormal = inspected.some(item => item.status === 'logical' || ['unknown-formal', 'ambiguous-slot'].includes(item.classified?.matchType) || item.classified?.slot)
  const formalIntent = input.formalIntent === true || anyFormal
  const errors = []
  const activeRootIdentity = createArtifactRootIdentity(activeRoot, options)
  const projectRootIdentity = createArtifactRootIdentity(projectRoot, options)

  if (!formalIntent) {
    const semantic = {
      schemaVersion: DECISION_SCHEMA,
      project: String(input.project || ''),
      activeRootIdentity,
      projectRootIdentity,
      mergedRegistryDigest: registry.mergedRegistryDigest,
      baseRegistryDigest: registry.baseRegistryDigest,
      overlayDigest: registry.overlayDigest,
      taskRecoveryKey: input.taskRecoveryKey || null,
      contextEpoch: input.contextEpoch || null,
      intent: String(input.intent || 'non-formal'),
      stage: String(input.stage || 'none'),
      taskKind: null,
      artifactClass: null,
      slotId: null,
      slotIds: [],
      slotDecisions: [],
      operation: footprint.operation,
      sourceTargets: footprint.sourceTargets,
      targetTargets: footprint.targetTargets,
      targetSetDigest: digest(footprint.normalizedTargets),
      footprintDigest: footprint.footprintDigest,
      adapterDigest: footprint.adapterDigest || null,
      plannedSetDigest: footprint.plannedSetDigest || null,
      observability: footprint.observability,
      observationCoverage: footprint.coverage || null,
      targetCount: footprint.normalizedTargets.length,
      existingTruthSource: [],
      alternativeGroup: null,
      lifecycleOperation: 'none',
      authoritySourceRef: String(input.authoritySourceRef || 'not-applicable'),
      decisionStatus: 'not-applicable',
      errorCodes: [],
      issuedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + 10 * 60 * 1000).toISOString(),
      singleUse: true,
      status: 'active'
    }
    return Object.freeze({ ...semantic, decisionDigest: digest(semantic) })
  }

  if (!footprintValidation.valid) errors.push(...footprintValidation.errors)
  if (footprint.schemaVersion !== 'MutationFootprintV2') errors.push('artifact-footprint-v2-required')
  if (footprint.coverage !== 'complete' || footprint.observability !== 'complete') errors.push('artifact-footprint-not-complete')
  if (!inspected.length) errors.push('artifact-target-set-empty')
  if (footprint.operationClass === 'unknown') errors.push('artifact-adapter-unknown')
  if (!DIGEST_RE.test(String(registry.mergedRegistryDigest || ''))) errors.push('artifact-merged-registry-invalid')
  for (const item of inspected) {
    if (item.status === 'outside') errors.push(item.errorCode || 'artifact-target-outside-active-root')
    else if (item.status === 'invalid') errors.push(item.errorCode || 'artifact-target-invalid')
    else if (!item.classified?.slot) {
      if (item.classified?.matchType === 'ambiguous-slot') errors.push('artifact-slot-ambiguous')
      else errors.push(item.classified?.matchType === 'unknown-formal' || item.classified?.matchType === 'unknown-logical' ? 'artifact-slot-unknown' : 'artifact-target-mixed-scope')
    }
    else if (item.classified.matchType === 'legacy-read' && !(footprint.operation === 'move' && source.includes(item))) {
      errors.push('artifact-legacy-alias-read-only')
    } else if (item.classified.matchType === 'report-alternative') {
      errors.push('artifact-report-alternative-read-only')
    }
  }
  const matches = inspected.filter(item => item.classified?.slot)
  const slotIds = [...new Set(matches.map(item => item.classified.slot.slotId))]
  const alternativeGroups = [...new Set(matches.map(item => item.classified.slot.alternativeGroup).filter(Boolean))]
  const taskKeys = [...new Set(matches.filter(item => item.classified.taskKind).map(item => `${item.classified.taskKind}:${item.classified.taskName}`))]
  if (taskKeys.length > 1) errors.push('artifact-multiple-tasks')
  if (input.taskKind && matches.some(item => item.classified.taskKind && item.classified.taskKind !== input.taskKind)) errors.push('artifact-task-kind-mismatch')
  if (input.taskName && matches.some(item => item.classified.taskName && item.classified.taskName !== input.taskName)) errors.push('artifact-task-name-mismatch')
  if (['unknown'].includes(footprint.operation)) errors.push('artifact-operation-unknown')
  if (['move', 'copy'].includes(footprint.operation) && (!source.length || !targets.length)) errors.push('artifact-source-destination-required')

  const authorityRole = String(input.authorityRole || 'task-owner')
  const operationalLeaseDigest = DIGEST_RE.test(String(input.operationalLeaseDigest || ''))
    ? String(input.operationalLeaseDigest)
    : null
  const appendOnlyAuthorized = input.appendOnlyAuthorized === true && operationalLeaseDigest !== null
  for (const match of matches) {
    const slot = match.classified.slot
    const ownerAllowed = slot.owner === authorityRole ||
      (slot.owner === 'task-admission' && slot.artifactClass === 'overview' && authorityRole === 'task-owner')
    if (!ownerAllowed) errors.push(`artifact-owner-required:${slot.owner}`)
    if (slot.mutability === 'immutable' && !(slot.owner === 'task-admission' && authorityRole === 'task-admission' && match.exists === false)) errors.push('artifact-immutable-slot')
    if (match.classified.matchType === 'versioned-candidate' && match.exists === true) errors.push('artifact-versioned-candidate-immutable')
    if (slot.mutability === 'append-only' && match.exists === true && !isLogicalTarget(match.canonical) && !appendOnlyAuthorized) errors.push('artifact-append-only-existing')
    if (slot.writePolicy === 'create-only' && match.exists === true) errors.push('artifact-create-only-existing')
    if (footprint.operation === 'delete' && slot.destructivePolicy !== 'allow' && input.destructiveConfirmed !== true) errors.push('artifact-destructive-confirmation-required')
  }

  const primary = targets.find(item => item.classified?.slot) || source.find(item => item.classified?.slot) || null
  const sourceCanonical = source.map(item => item.canonical).filter(Boolean)
  const targetCanonical = targets.map(item => item.canonical).filter(Boolean)
  const allowedExisting = new Set(footprint.operation === 'move' ? sourceCanonical.map(comparable) : targetCanonical.map(comparable))
  const truthChecks = targets
    .filter(item => item.classified?.slot?.alternativeGroup && item.classified.matchType !== 'versioned-candidate')
    .map(item => existingTruthForMatch(item, activeRoot, registry, options))
  const existingTruthSource = [...new Set(truthChecks.flat())]
  const conflictingTruth = existingTruthSource.filter(value => !allowedExisting.has(comparable(value)))
  if (conflictingTruth.length && ['create-or-update', 'update', 'move', 'copy'].includes(footprint.operation)) errors.push('artifact-alternative-truth-conflict')

  const slotDecisions = slotIds.map(slotId => {
    const slot = matches.find(item => item.classified.slot.slotId === slotId).classified.slot
    return {
      slotId,
      rootClass: slot.rootClass || 'active-root',
      scope: slot.scope,
      artifactClass: slot.artifactClass,
      owner: slot.owner,
      mutability: slot.mutability,
      writePolicy: slot.writePolicy,
      destructivePolicy: slot.destructivePolicy
    }
  })
  const semantic = {
    schemaVersion: DECISION_SCHEMA,
    project: String(input.project || ''),
    activeRootIdentity,
    projectRootIdentity,
    mergedRegistryDigest: registry.mergedRegistryDigest,
    baseRegistryDigest: registry.baseRegistryDigest,
    overlayDigest: registry.overlayDigest,
    taskRecoveryKey: input.taskRecoveryKey || null,
    contextEpoch: input.contextEpoch || null,
    intent: String(input.intent || 'formal-artifact'),
    stage: String(input.stage || primary?.classified?.slot?.stage || 'any'),
    taskKind: primary?.classified?.taskKind || null,
    taskName: primary?.classified?.taskName || null,
    artifactClass: primary?.classified?.slot?.artifactClass || null,
    slotId: primary?.classified?.slot?.slotId || null,
    slotIds,
    slotDecisions,
    operation: footprint.operation,
    sourceTargets: sourceCanonical,
    targetTargets: targetCanonical,
    targetSetDigest: digest([...sourceCanonical, ...targetCanonical].map(comparable).sort()),
    footprintDigest: footprint.footprintDigest,
    adapterDigest: footprint.adapterDigest,
    plannedSetDigest: footprint.plannedSetDigest,
    observability: footprint.observability,
    observationCoverage: footprint.coverage,
    targetCount: [...sourceCanonical, ...targetCanonical].length,
    existingTruthSource: existingTruthSource.sort(),
    alternativeGroup: primary?.classified?.slot?.alternativeGroup || null,
    alternativeGroups,
    lifecycleOperation: ['move', 'copy', 'delete'].includes(footprint.operation) ? footprint.operation : 'write',
    authoritySourceRef: String(input.authoritySourceRef || ''),
    authorityRole,
    operationalLeaseDigest,
    appendOnlyAuthorized,
    decisionStatus: errors.length ? 'forbid' : 'allow',
    errorCodes: [...new Set(errors)].sort(),
    issuedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + (options.ttlMs || 10 * 60 * 1000)).toISOString(),
    singleUse: true,
    status: 'active'
  }
  return Object.freeze({ ...semantic, decisionDigest: digest(semantic) })
}

function validateArtifactSlotDecision(value, binding = null, options = {}) {
  const errors = []
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  if (value?.schemaVersion !== DECISION_SCHEMA) errors.push('artifact-decision-schema-invalid')
  if (!['allow', 'forbid', 'not-applicable'].includes(value?.decisionStatus)) errors.push('artifact-decision-status-invalid')
  if (!['active', 'consumed', 'needs-reconcile', 'revoked'].includes(value?.status)) errors.push('artifact-decision-lifecycle-invalid')
  if (value?.singleUse !== true) errors.push('artifact-decision-single-use-required')
  if (!DIGEST_RE.test(String(value?.targetSetDigest || '')) || !DIGEST_RE.test(String(value?.footprintDigest || ''))) errors.push('artifact-decision-binding-invalid')
  for (const field of ['mergedRegistryDigest', 'baseRegistryDigest', 'adapterDigest', 'plannedSetDigest']) {
    if (!DIGEST_RE.test(String(value?.[field] || ''))) errors.push(`artifact-decision-${field}-invalid`)
  }
  if (value?.overlayDigest !== null && !DIGEST_RE.test(String(value?.overlayDigest || ''))) errors.push('artifact-decision-overlayDigest-invalid')
  if (!value?.activeRootIdentity || !DIGEST_RE.test(String(value.activeRootIdentity.digest || '')) ||
      !value?.projectRootIdentity || !DIGEST_RE.test(String(value.projectRootIdentity.digest || ''))) {
    errors.push('artifact-decision-root-identity-invalid')
  }
  if (!Array.isArray(value?.slotIds) || !Array.isArray(value?.slotDecisions)) errors.push('artifact-decision-slots-invalid')
  if (Array.isArray(value?.sourceTargets) && Array.isArray(value?.targetTargets) &&
      digest([...value.sourceTargets, ...value.targetTargets].map(comparable).sort()) !== value.targetSetDigest) {
    errors.push('artifact-decision-target-set-digest-mismatch')
  }
  const { decisionDigest, ...semantic } = value || {}
  if (!DIGEST_RE.test(String(decisionDigest || '')) || digest(semantic) !== decisionDigest) errors.push('artifact-decision-digest-invalid')
  if (!Number.isFinite(Date.parse(String(value?.expiresAt || ''))) || Date.parse(value.expiresAt) <= nowMs) errors.push('artifact-decision-expired')
  if (value?.status !== 'active') errors.push(`artifact-decision-not-active:${value?.status}`)
  if (binding) {
    for (const field of ['project', 'taskRecoveryKey', 'contextEpoch', 'targetSetDigest', 'footprintDigest', 'adapterDigest', 'plannedSetDigest', 'mergedRegistryDigest']) {
      if ((value?.[field] ?? null) !== (binding[field] ?? null)) errors.push(`artifact-decision-mismatch:${field}`)
    }
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] }
}

function validateLegacyArtifactSlotDecision(value) {
  const errors = []
  if (value?.schemaVersion !== LEGACY_DECISION_SCHEMA) errors.push('artifact-legacy-decision-schema-invalid')
  if (!['allow', 'forbid', 'not-applicable'].includes(value?.decisionStatus)) errors.push('artifact-legacy-decision-status-invalid')
  const { decisionDigest, ...semantic } = value || {}
  if (!DIGEST_RE.test(String(decisionDigest || '')) || digest(semantic) !== decisionDigest) errors.push('artifact-legacy-decision-digest-invalid')
  return { valid: errors.length === 0, executableAuthority: false, errors }
}

function reconcileArtifactSlotDecision(decision, input = {}, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  const footprint = input.footprint || extractMutationFootprint(input.payload || {}, { cwd: input.cwd })
  const canonicalObserved = target => input.activeRoot
      ? (canonicalizeTarget(target, input.activeRoot, { ...options, cwd: input.cwd }).canonical || target)
      : target
  const observedSourceTargets = footprint.sourceTargets.map(canonicalObserved)
  const observedTargetTargets = footprint.targetTargets.map(canonicalObserved)
  const observedTargets = [...observedSourceTargets, ...observedTargetTargets].map(comparable).sort()
  const errors = []
  if (decision.projectionKind === 'digest-only') {
    if (decision.status !== 'active') errors.push(`artifact-decision-not-active:${decision.status}`)
    if (!Number.isFinite(Date.parse(String(decision.expiresAt || ''))) || Date.parse(decision.expiresAt) <= nowMs) errors.push('artifact-decision-expired')
    if (!DIGEST_RE.test(String(decision.decisionDigest || '')) || !DIGEST_RE.test(String(decision.targetSetDigest || ''))) errors.push('artifact-decision-projection-invalid')
  } else {
    const validation = validateArtifactSlotDecision(decision, null, { nowMs })
    if (!validation.valid) errors.push(...validation.errors)
  }
  if (input.success === false) errors.push('artifact-tool-reported-failure')
  if (digest(observedTargets) !== decision.targetSetDigest) errors.push('artifact-post-target-set-drift')
  const sourceTargets = Array.isArray(decision.sourceTargets) ? decision.sourceTargets : observedSourceTargets
  const targetTargets = Array.isArray(decision.targetTargets) ? decision.targetTargets : observedTargetTargets
  const exists = target => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)) return true
    try { return (options.fs || fs).existsSync(target) } catch { return false }
  }
  if (decision.operation === 'delete') {
    if (sourceTargets.some(exists)) errors.push('artifact-delete-source-still-exists')
  } else if (decision.operation === 'move') {
    if (sourceTargets.some(exists)) errors.push('artifact-move-source-still-exists')
    if (targetTargets.some(target => !exists(target))) errors.push('artifact-move-target-missing')
  } else if (decision.operation === 'copy') {
    if (sourceTargets.some(target => !exists(target))) errors.push('artifact-copy-source-missing')
    if (targetTargets.some(target => !exists(target))) errors.push('artifact-copy-target-missing')
  } else if (targetTargets.some(target => !exists(target))) {
    errors.push('artifact-write-target-missing')
  }
  const semantic = {
    schemaVersion: 'ArtifactSlotCloseoutV1',
    decisionDigest: decision.decisionDigest,
    decisionStatus: errors.length ? 'needs-reconcile' : 'consumed',
    targetSetDigest: decision.targetSetDigest,
    observedFootprintDigest: footprint.footprintDigest,
    errorCodes: [...new Set(errors)].sort(),
    completedAt: new Date(nowMs).toISOString()
  }
  return Object.freeze({ ...semantic, closeoutDigest: digest(semantic) })
}

module.exports = {
  ARTIFACT_DECISION_SCHEMA: DECISION_SCHEMA,
  ARTIFACT_SLOT_REGISTRY_PATH: REGISTRY_PATH,
  ARTIFACT_SLOT_REGISTRY_LEGACY_PATH: LEGACY_REGISTRY_PATH,
  LAYERED_ARTIFACT_SLOT_REGISTRY_SCHEMA: LAYERED_REGISTRY_SCHEMA,
  canonicalArtifactName,
  canonicalizeAgainstRoots,
  canonicalizeTarget,
  classifyRelativeTarget,
  createArtifactRootIdentity,
  decideArtifactMutation,
  enumerateTaskArtifacts,
  hasTaskArtifact,
  inspectTarget,
  isAuthoritativeTaskArtifact,
  readArtifactSlotRegistry,
  readLayeredArtifactSlotRegistry,
  reconcileArtifactSlotDecision,
  validateArtifactSlotDecision,
  validateBaseRegistry,
  validateLegacyArtifactSlotDecision,
  validateOverlay
}
