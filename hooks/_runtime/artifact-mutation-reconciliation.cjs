'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const { sha256, stableStringify } = require('./content-identity.cjs')
const {
  MAX_HASH_BYTES,
  MAX_OBSERVATION_ENTRIES,
  projectMutationFootprintForRecovery,
  snapshotMutationTargets,
  validateArtifactMutationCloseoutReceipt,
  validateMutationFootprintRecoveryProjection,
  validateMutationPreObservation,
  validateMutationObservationReceipt
} = require('./mutation-observation.cjs')

const RECEIPT_SCHEMA = 'ArtifactMutationReconciliationReceiptV1'
const PROJECTION_SCHEMA = 'ArtifactMutationReconciliationProjectionV1'
const INPUT_SCHEMA = 'ArtifactMutationReconciliationInputV1'
const DIGEST_RE = /^[a-f0-9]{64}$/
const MAX_PATH_BYTES = 1024

class ArtifactMutationReconciliationError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'ArtifactMutationReconciliationError'
    this.code = code
    this.details = details
  }
}

function digest(value) {
  return sha256(Buffer.from(stableStringify(value), 'utf8'))
}

function comparable(value) {
  const normalized = path.normalize(String(value || ''))
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function isInsideOrSame(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function stableStatIdentity(stat) {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    size: Number(stat.size),
    mtimeMs: Number(stat.mtimeMs),
    ctimeMs: Number(stat.ctimeMs)
  }
}

function sameStatIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs
}

function sameObjectIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino
}

function validStatIdentity(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    String(value.dev || '').trim() && String(value.ino || '').trim() &&
    Number.isFinite(value.size) && value.size >= 0 &&
    Number.isFinite(value.mtimeMs) && Number.isFinite(value.ctimeMs)
}

function canonicalRoot(root, kind, fsImpl) {
  const resolved = path.resolve(String(root || ''))
  let stat
  let canonical
  try {
    stat = fsImpl.lstatSync(resolved)
    canonical = fsImpl.realpathSync(resolved)
  } catch (error) {
    throw new ArtifactMutationReconciliationError(
      'ARTIFACT_RECONCILIATION_ROOT_UNAVAILABLE',
      `${kind} is unavailable for reconciliation`,
      { root: resolved, cause: error.code }
    )
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new ArtifactMutationReconciliationError('ARTIFACT_RECONCILIATION_ROOT_UNSAFE', `${kind} must be an ordinary directory`, { root: resolved })
  }
  return {
    kind,
    path: resolved,
    canonical: path.resolve(canonical),
    identity: stableStatIdentity(stat),
    digest: digest({ kind, canonical: comparable(canonical) })
  }
}

function selectRoot(target, roots) {
  const matches = roots.filter(root => isInsideOrSame(target, root.path))
    .sort((left, right) => right.path.length - left.path.length)
  if (!matches.length) {
    throw new ArtifactMutationReconciliationError(
      'ARTIFACT_RECONCILIATION_PATH_OUTSIDE_ROOT',
      'observed mutation path is outside activeRoot and projectRoot',
      { target }
    )
  }
  return matches[0]
}

function assertSafeAncestors(root, target, fsImpl) {
  let rootStat
  let rootCanonical
  try {
    rootStat = fsImpl.lstatSync(root.path)
    rootCanonical = fsImpl.realpathSync(root.path)
  } catch (error) {
    throw new ArtifactMutationReconciliationError(
      'ARTIFACT_RECONCILIATION_ROOT_DRIFT',
      'authorized reconciliation root changed during readback',
      { root: root.path, cause: error.code }
    )
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() ||
      !sameObjectIdentity(stableStatIdentity(rootStat), root.identity) ||
      comparable(rootCanonical) !== comparable(root.canonical)) {
    throw new ArtifactMutationReconciliationError(
      'ARTIFACT_RECONCILIATION_ROOT_DRIFT',
      'authorized reconciliation root identity changed during readback',
      { root: root.path }
    )
  }
  const relative = path.relative(root.path, target)
  const segments = relative ? relative.split(path.sep).filter(Boolean) : []
  let current = root.path
  for (const segment of segments) {
    current = path.join(current, segment)
    let stat
    try { stat = fsImpl.lstatSync(current) } catch (error) {
      if (error?.code === 'ENOENT') break
      throw new ArtifactMutationReconciliationError(
        'ARTIFACT_RECONCILIATION_PATH_UNAVAILABLE',
        'observed mutation path cannot be inspected',
        { target, current, cause: error.code }
      )
    }
    if (stat.isSymbolicLink()) {
      throw new ArtifactMutationReconciliationError(
        'ARTIFACT_RECONCILIATION_REPARSE_BLOCKED',
        'observed mutation path crosses a symbolic link or junction',
        { target, current }
      )
    }
    let canonical
    try { canonical = fsImpl.realpathSync(current) } catch (error) {
      throw new ArtifactMutationReconciliationError(
        'ARTIFACT_RECONCILIATION_REALPATH_FAILED',
        'observed mutation path realpath cannot be verified',
        { target, current, cause: error.code }
      )
    }
    if (!isInsideOrSame(canonical, root.canonical)) {
      throw new ArtifactMutationReconciliationError(
        'ARTIFACT_RECONCILIATION_REPARSE_ESCAPE',
        'observed mutation path resolves outside its authorized root',
        { target, current }
      )
    }
  }
}

function hashStableFile(target, fsImpl) {
  let descriptor
  try {
    descriptor = fsImpl.openSync(target, 'r')
    const before = fsImpl.fstatSync(descriptor)
    if (!before.isFile() || before.size > MAX_HASH_BYTES) {
      throw new ArtifactMutationReconciliationError(
        before.isFile() ? 'ARTIFACT_RECONCILIATION_FILE_TOO_LARGE' : 'ARTIFACT_RECONCILIATION_KIND_UNSUPPORTED',
        'reconciliation accepts only bounded ordinary files',
        { target, bytes: before.size }
      )
    }
    const hasher = crypto.createHash('sha256')
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let offset = 0
    while (offset < before.size) {
      const read = fsImpl.readSync(descriptor, buffer, 0, Math.min(buffer.length, before.size - offset), offset)
      if (!read) break
      hasher.update(buffer.subarray(0, read))
      offset += read
    }
    const after = fsImpl.fstatSync(descriptor)
    const current = fsImpl.lstatSync(target)
    if (!current.isFile() || current.isSymbolicLink()) {
      throw new ArtifactMutationReconciliationError(
        'ARTIFACT_RECONCILIATION_REPARSE_BLOCKED',
        'observed mutation file changed into a reparse or non-file target during readback',
        { target }
      )
    }
    const beforeIdentity = stableStatIdentity(before)
    const afterIdentity = stableStatIdentity(after)
    const currentIdentity = stableStatIdentity(current)
    if (offset !== before.size || !sameStatIdentity(beforeIdentity, afterIdentity) ||
        !sameStatIdentity(afterIdentity, currentIdentity)) {
      throw new ArtifactMutationReconciliationError(
        'ARTIFACT_RECONCILIATION_FILE_DRIFT',
        'observed mutation file changed during reconciliation readback',
        { target }
      )
    }
    return { kind: 'file', bytes: before.size, contentDigest: hasher.digest('hex'), identity: currentIdentity }
  } finally {
    if (descriptor !== undefined) fsImpl.closeSync(descriptor)
  }
}

function inspectExpectedPath(target, expectedState, roots, fsImpl) {
  if (!target || Buffer.byteLength(String(target), 'utf8') > MAX_PATH_BYTES || !path.isAbsolute(String(target))) {
    throw new ArtifactMutationReconciliationError('ARTIFACT_RECONCILIATION_PATH_INVALID', 'reconciliation path must be one bounded absolute path', { target })
  }
  const resolved = path.resolve(String(target))
  const root = selectRoot(resolved, roots)
  assertSafeAncestors(root, resolved, fsImpl)
  let stat
  try { stat = fsImpl.lstatSync(resolved) } catch (error) {
    if (error?.code === 'ENOENT' && expectedState === 'absent') {
      assertSafeAncestors(root, resolved, fsImpl)
      try {
        fsImpl.lstatSync(resolved)
        throw new ArtifactMutationReconciliationError(
          'ARTIFACT_RECONCILIATION_DELETE_DRIFT',
          'a deleted or moved source path reappeared during reconciliation readback',
          { target: resolved }
        )
      } catch (recheckError) {
        if (recheckError instanceof ArtifactMutationReconciliationError) throw recheckError
        if (recheckError?.code !== 'ENOENT') {
          throw new ArtifactMutationReconciliationError(
            'ARTIFACT_RECONCILIATION_PATH_UNAVAILABLE',
            'a deleted or moved source path could not be rechecked safely',
            { target: resolved, cause: recheckError.code }
          )
        }
      }
      return { path: resolved, rootKind: root.kind, expectedState, state: 'absent', kind: 'missing', bytes: 0, contentDigest: null, identity: null }
    }
    throw new ArtifactMutationReconciliationError(
      expectedState === 'absent' ? 'ARTIFACT_RECONCILIATION_DELETE_DRIFT' : 'ARTIFACT_RECONCILIATION_EFFECT_MISSING',
      expectedState === 'absent' ? 'a previously absent effect path cannot be inspected safely' : 'an observed created or modified path is missing',
      { target: resolved, cause: error.code }
    )
  }
  if (expectedState === 'absent') {
    throw new ArtifactMutationReconciliationError('ARTIFACT_RECONCILIATION_DELETE_DRIFT', 'a deleted or moved source path exists again', { target: resolved })
  }
  if (stat.isSymbolicLink()) {
    throw new ArtifactMutationReconciliationError('ARTIFACT_RECONCILIATION_REPARSE_BLOCKED', 'reconciliation target is a symbolic link or junction', { target: resolved })
  }
  let observed
  if (stat.isFile()) {
    observed = hashStableFile(resolved, fsImpl)
    assertSafeAncestors(root, resolved, fsImpl)
  } else if (stat.isDirectory()) {
    const before = stableStatIdentity(stat)
    const children = fsImpl.readdirSync(resolved).sort()
    const afterStat = fsImpl.lstatSync(resolved)
    const after = stableStatIdentity(afterStat)
    if (!afterStat.isDirectory() || afterStat.isSymbolicLink() ||
        children.length > MAX_OBSERVATION_ENTRIES || !sameStatIdentity(before, after)) {
      throw new ArtifactMutationReconciliationError(
        children.length > MAX_OBSERVATION_ENTRIES
          ? 'ARTIFACT_RECONCILIATION_DIRECTORY_TOO_LARGE'
          : 'ARTIFACT_RECONCILIATION_DIRECTORY_DRIFT',
        'directory reconciliation requires one stable bounded ordinary directory',
        { target: resolved, entries: children.length }
      )
    }
    assertSafeAncestors(root, resolved, fsImpl)
    observed = { kind: 'directory', bytes: 0, contentDigest: digest(children), identity: after }
  } else {
    throw new ArtifactMutationReconciliationError('ARTIFACT_RECONCILIATION_KIND_UNSUPPORTED', 'reconciliation target is not an ordinary file or directory', { target: resolved })
  }
  return { path: resolved, rootKind: root.kind, expectedState, state: 'present', ...observed }
}

function expectedEffectStates(observedEffects, options = {}) {
  const expected = new Map()
  const add = (target, state) => {
    const key = comparable(target)
    const prior = expected.get(key)
    if (prior && prior.state !== state) {
      throw new ArtifactMutationReconciliationError('ARTIFACT_RECONCILIATION_EFFECT_CONFLICT', 'one observed path has conflicting final states', { target })
    }
    expected.set(key, { path: target, state })
  }
  for (const target of [...(observedEffects.created || []), ...(observedEffects.modified || [])]) add(target, 'present')
  for (const target of observedEffects.deleted || []) add(target, 'absent')
  for (const move of observedEffects.moved || []) {
    add(move.source, 'absent')
    add(move.target, 'present')
  }
  if ((!expected.size && options.allowEmpty !== true) || expected.size > MAX_OBSERVATION_ENTRIES) {
    throw new ArtifactMutationReconciliationError(
      expected.size ? 'ARTIFACT_RECONCILIATION_EFFECT_LIMIT_EXCEEDED' : 'ARTIFACT_RECONCILIATION_EFFECTS_REQUIRED',
      'reconciliation requires 1-24 exact observed effect paths',
      { count: expected.size }
    )
  }
  return [...expected.values()].sort((left, right) => comparable(left.path).localeCompare(comparable(right.path)))
}

function createArtifactMutationReconciliationInput(input = {}) {
  const footprint = input.footprint?.schemaVersion === 'MutationFootprintRecoveryProjectionV2'
    ? JSON.parse(JSON.stringify(input.footprint))
    : projectMutationFootprintForRecovery(input.footprint)
  const semantic = {
    schemaVersion: INPUT_SCHEMA,
    operationId: String(input.operationId || ''),
    footprint,
    preObservation: JSON.parse(JSON.stringify(input.preObservation || null))
  }
  const value = Object.freeze({ ...semantic, inputDigest: digest(semantic) })
  const validation = validateArtifactMutationReconciliationInput(value)
  if (!validation.valid) {
    throw new ArtifactMutationReconciliationError(
      'ARTIFACT_RECONCILIATION_INPUT_INVALID',
      'mutation reconciliation input is incomplete or invalid',
      { errors: validation.errors }
    )
  }
  return value
}

function recoveryFootprintTargets(footprint) {
  const values = [
    ...(footprint?.plannedCreates || []),
    ...(footprint?.plannedModifies || []),
    ...(footprint?.plannedDeletes || []),
    ...(footprint?.plannedMoves || []).flatMap(item => [item?.source, item?.target]),
    ...(footprint?.sourceTargets || []),
    ...(footprint?.targetTargets || []),
    ...(footprint?.normalizedTargets || [])
  ].filter(Boolean)
  const targets = new Map()
  for (const target of values) targets.set(comparable(target), target)
  return [...targets.values()]
}

function validateArtifactMutationReconciliationInput(value, binding = null) {
  const errors = []
  if (value?.schemaVersion !== INPUT_SCHEMA || !String(value?.operationId || '').trim()) {
    errors.push('artifact-reconciliation-input-schema-or-operation')
  }
  const footprintValidation = validateMutationFootprintRecoveryProjection(value?.footprint)
  const preValidation = validateMutationPreObservation(value?.preObservation, {
    operationId: value?.operationId,
    footprintDigest: value?.footprint?.footprintDigest,
    plannedSetDigest: value?.footprint?.plannedSetDigest
  })
  if (!footprintValidation.valid) errors.push(...footprintValidation.errors)
  if (!preValidation.valid) errors.push(...preValidation.errors)
  if (footprintValidation.valid && preValidation.valid) {
    const footprintTargets = recoveryFootprintTargets(value.footprint)
    const preTargetValues = value.preObservation.entries.map(entry => entry.path)
    const preTargets = new Set(preTargetValues.map(target => comparable(target)))
    const footprintTargetSet = new Set(footprintTargets.map(target => comparable(target)))
    if (preTargets.size !== preTargetValues.length) {
      errors.push('artifact-reconciliation-input-preobservation-target-duplicate')
    }
    if (footprintTargets.some(target => !preTargets.has(comparable(target)))) {
      errors.push('artifact-reconciliation-input-preobservation-target-binding')
    }
    const granularity = value.footprint?.observationPlan?.targetGranularity || 'exact-target'
    if (granularity === 'exact-target') {
      if (preTargets.size !== footprintTargetSet.size ||
          preTargetValues.some(target => !footprintTargetSet.has(comparable(target)))) {
        errors.push('artifact-reconciliation-input-preobservation-exact-target-set')
      }
    } else if (granularity === 'controlled-root') {
      const controlledRoots = footprintTargets
        .filter(target => path.isAbsolute(String(target || '')))
        .map(target => path.resolve(String(target)))
      if (controlledRoots.length !== footprintTargets.length || preTargetValues.some(target => {
        if (!path.isAbsolute(String(target || ''))) return true
        const resolved = path.resolve(String(target))
        return !controlledRoots.some(root => isInsideOrSame(resolved, root))
      })) {
        errors.push('artifact-reconciliation-input-preobservation-controlled-root-scope')
      }
    } else {
      errors.push('artifact-reconciliation-input-preobservation-granularity')
    }
  }
  const { inputDigest, ...semantic } = value || {}
  if (!DIGEST_RE.test(String(inputDigest || '')) || digest(semantic) !== inputDigest) {
    errors.push('artifact-reconciliation-input-digest')
  }
  if (binding && String(value?.operationId || '') !== String(binding.operationId || '')) {
    errors.push('artifact-reconciliation-input-operation-binding')
  }
  if (binding?.footprintDigest &&
      String(value?.footprint?.footprintDigest || '') !== String(binding.footprintDigest)) {
    errors.push('artifact-reconciliation-input-footprint-binding')
  }
  if (binding?.plannedSetDigest &&
      String(value?.footprint?.plannedSetDigest || '') !== String(binding.plannedSetDigest)) {
    errors.push('artifact-reconciliation-input-planned-set-binding')
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] }
}

function observedEffectsFromSnapshots(preEntries, postEntries, plannedMoves = []) {
  const before = new Map((preEntries || []).map(entry => [comparable(entry.path), entry]))
  const after = new Map((postEntries || []).map(entry => [comparable(entry.path), entry]))
  const created = []
  const modified = []
  const deleted = []
  for (const key of [...new Set([...before.keys(), ...after.keys()])]) {
    const left = before.get(key) || { path: after.get(key)?.path, exists: false, kind: 'missing', digest: null, bytes: 0 }
    const right = after.get(key) || { path: left.path, exists: false, kind: 'missing', digest: null, bytes: 0 }
    if (!left.exists && right.exists) created.push(right.path)
    else if (left.exists && !right.exists) deleted.push(left.path)
    else if (left.exists && right.exists &&
        (left.digest !== right.digest || left.kind !== right.kind || left.bytes !== right.bytes)) modified.push(right.path)
  }
  const moved = []
  for (const planned of plannedMoves || []) {
    const sourceBefore = before.get(comparable(planned.source))
    const sourceAfter = after.get(comparable(planned.source))
    const targetAfter = after.get(comparable(planned.target))
    if (sourceBefore?.exists && sourceAfter?.exists === false && targetAfter?.exists &&
        (!sourceBefore.digest || !targetAfter.digest || sourceBefore.digest === targetAfter.digest)) {
      moved.push({ source: planned.source, target: planned.target })
    }
  }
  return {
    created: [...new Set(created)].sort(),
    modified: [...new Set(modified)].sort(),
    deleted: [...new Set(deleted)].sort(),
    moved
  }
}

function reobserveFromReconciliationInput(value, roots, fsImpl, binding) {
  const validation = validateArtifactMutationReconciliationInput(value, binding)
  if (!validation.valid) {
    throw new ArtifactMutationReconciliationError(
      'ARTIFACT_RECONCILIATION_INPUT_INVALID',
      'partial or empty prior observation requires one valid recovery input',
      { errors: validation.errors }
    )
  }
  const boundedTargets = new Map()
  for (const target of [
    ...recoveryFootprintTargets(value.footprint),
    ...value.preObservation.entries.map(entry => entry.path)
  ]) boundedTargets.set(comparable(target), target)
  if (boundedTargets.size > MAX_OBSERVATION_ENTRIES) {
    throw new ArtifactMutationReconciliationError(
      'ARTIFACT_RECONCILIATION_EFFECT_LIMIT_EXCEEDED',
      're-observation requires 1-24 exact target paths',
      { count: boundedTargets.size }
    )
  }
  for (const target of boundedTargets.values()) {
    if (!path.isAbsolute(String(target || ''))) {
      throw new ArtifactMutationReconciliationError(
        'ARTIFACT_RECONCILIATION_LOGICAL_TARGET_UNSUPPORTED',
        'filesystem reconciliation does not accept logical mutation targets',
        { target }
      )
    }
    const resolved = path.resolve(String(target))
    const root = selectRoot(resolved, roots)
    assertSafeAncestors(root, resolved, fsImpl)
  }
  const post = snapshotMutationTargets(value.footprint, { fs: fsImpl, phase: 'post' })
  if (post.coverage !== 'complete' || post.errorCodes.length) {
    throw new ArtifactMutationReconciliationError(
      'ARTIFACT_RECONCILIATION_REOBSERVATION_INCOMPLETE',
      'current mutation targets cannot be re-observed completely',
      { errors: post.errorCodes }
    )
  }
  const effects = observedEffectsFromSnapshots(
    value.preObservation.entries,
    post.entries,
    value.footprint.plannedMoves
  )
  const states = new Map()
  for (const entry of [...value.preObservation.entries, ...post.entries]) {
    const current = post.entries.find(item => comparable(item.path) === comparable(entry.path))
    states.set(comparable(entry.path), {
      path: current?.path || entry.path,
      state: current?.exists === true ? 'present' : 'absent'
    })
  }
  if (!states.size || states.size > MAX_OBSERVATION_ENTRIES) {
    throw new ArtifactMutationReconciliationError(
      'ARTIFACT_RECONCILIATION_EFFECT_LIMIT_EXCEEDED',
      're-observation requires 1-24 exact target paths',
      { count: states.size }
    )
  }
  return {
    mode: 'reobserved-from-preflight',
    recoveryInputDigest: value.inputDigest,
    observedEffects: effects,
    expectedStates: [...states.values()].sort((left, right) => comparable(left.path).localeCompare(comparable(right.path)))
  }
}

function closeoutFromLifecycle(value) {
  if (value?.schemaVersion !== 'LifecycleMutationCloseoutV2' || value?.result !== 'needs-reconcile') {
    throw new ArtifactMutationReconciliationError('ARTIFACT_RECONCILIATION_CLOSEOUT_NOT_PENDING', 'one pending LifecycleMutationCloseoutV2 is required')
  }
  const observation = value.observation
  const observationValidation = validateMutationObservationReceipt(observation)
  if (!observationValidation.valid) {
    throw new ArtifactMutationReconciliationError(
      'ARTIFACT_RECONCILIATION_OBSERVATION_INVALID',
      'prior mutation observation must be structurally valid',
      { errors: observationValidation.errors }
    )
  }
  const closeout = value.artifactCloseout || observation.closeout
  const closeoutValidation = validateArtifactMutationCloseoutReceipt(closeout, observation)
  if (!closeoutValidation.valid || closeout.decisionStatus !== 'needs-reconcile') {
    throw new ArtifactMutationReconciliationError(
      'ARTIFACT_RECONCILIATION_CLOSEOUT_INVALID',
      'prior artifact closeout is invalid or not pending reconciliation',
      { errors: closeoutValidation.errors }
    )
  }
  if (observation.closeout && observation.closeout.closeoutDigest !== closeout.closeoutDigest) {
    throw new ArtifactMutationReconciliationError('ARTIFACT_RECONCILIATION_CLOSEOUT_CONFLICT', 'nested and lifecycle artifact closeout receipts do not match')
  }
  return { observation, closeout }
}

function createArtifactMutationReconciliationReceipt(input = {}, options = {}) {
  const fsImpl = options.fs || fs
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  if (input.resolution !== 'accept-observed-effects') {
    throw new ArtifactMutationReconciliationError('ARTIFACT_RECONCILIATION_RESOLUTION_INVALID', 'only accept-observed-effects is supported')
  }
  const lifecycleCloseout = input.lifecycleCloseout
  const { observation, closeout } = closeoutFromLifecycle(lifecycleCloseout)
  if (String(input.operationId || '') !== lifecycleCloseout.operationId ||
      String(input.expectedCloseoutDigest || '') !== closeout.closeoutDigest) {
    throw new ArtifactMutationReconciliationError('ARTIFACT_RECONCILIATION_CAS_MISMATCH', 'operationId or expected closeout digest is stale')
  }
  const roots = [
    canonicalRoot(input.activeRoot, 'active-root', fsImpl),
    canonicalRoot(input.projectRoot, 'project-root', fsImpl)
  ]
  const priorEffects = observation.observedEffects || { created: [], modified: [], deleted: [], moved: [] }
  const priorEffectStates = expectedEffectStates(priorEffects, { allowEmpty: true })
  const recovery = observation.observationCoverage === 'complete' && priorEffectStates.length
    ? {
        mode: 'prior-complete-observation',
        recoveryInputDigest: null,
        observedEffects: priorEffects,
        expectedStates: priorEffectStates
      }
    : reobserveFromReconciliationInput(lifecycleCloseout.reconciliationInput, roots, fsImpl, {
        operationId: lifecycleCloseout.operationId,
        plannedSetDigest: observation.plannedSetDigest
      })
  const entries = recovery.expectedStates.map(item => inspectExpectedPath(item.path, item.state, roots, fsImpl))
  const currentEffectSnapshot = {
    schemaVersion: 'ArtifactMutationReconciliationSnapshotV1',
    entries,
    observedAt: new Date(nowMs).toISOString()
  }
  currentEffectSnapshot.snapshotDigest = digest(currentEffectSnapshot)
  const ingress = input.ingress || {}
  const semantic = {
    schemaVersion: RECEIPT_SCHEMA,
    resolution: input.resolution,
    sourceKind: input.sourceKind === 'emergency-reserve' ? 'emergency-reserve' : 'primary',
    reserveSequence: input.sourceKind === 'emergency-reserve' ? Number(input.reserveSequence) : null,
    reserveRecordDigest: input.sourceKind === 'emergency-reserve' ? String(input.reserveRecordDigest || '') : null,
    project: String(input.project || ''),
    taskId: String(input.taskId || '') || null,
    operationId: lifecycleCloseout.operationId,
    priorObservationReceiptDigest: observation.receiptDigest,
    priorCloseoutDigest: closeout.closeoutDigest,
    priorPlannedSetDigest: observation.plannedSetDigest,
    recoveryMode: recovery.mode,
    recoveryInputDigest: recovery.recoveryInputDigest,
    recoveredObservedEffects: recovery.observedEffects,
    recoveredObservedEffectsDigest: digest(recovery.observedEffects),
    activeRootDigest: roots.find(root => root.kind === 'active-root')?.digest || null,
    projectRootDigest: roots.find(root => root.kind === 'project-root')?.digest || null,
    ingressEnvelopeDigest: String(ingress.envelopeDigest || ''),
    ingressDecisionDigest: String(ingress.decisionDigest || ''),
    ingressRouteRevision: String(ingress.routeRevision || ''),
    projectTargetLeaseDigest: String(ingress.projectTargetLeaseDigest || ''),
    hostSessionDigest: String(ingress.hostSessionDigest || ''),
    currentEffectSnapshot,
    mutationAuthority: false,
    reconciledAt: new Date(nowMs).toISOString()
  }
  const receipt = Object.freeze({ ...semantic, receiptDigest: digest(semantic) })
  const validation = validateArtifactMutationReconciliationReceipt(receipt, {
    operationId: lifecycleCloseout.operationId,
    priorCloseoutDigest: closeout.closeoutDigest,
    priorObservationReceiptDigest: observation.receiptDigest
  })
  if (!validation.valid) {
    throw new ArtifactMutationReconciliationError('ARTIFACT_RECONCILIATION_RECEIPT_INVALID', 'generated reconciliation receipt is invalid', { errors: validation.errors })
  }
  return receipt
}

function validateRecoveredObservedEffects(value, errorPrefix) {
  const errors = []
  const effectPaths = []
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !['created', 'modified', 'deleted', 'moved'].every(field => Array.isArray(value[field]))) {
    return { valid: false, errors: [`${errorPrefix}-invalid`], effectPaths }
  }
  const arrays = [value.created, value.modified, value.deleted, value.moved]
  if (arrays.some(items => items.length > MAX_OBSERVATION_ENTRIES)) {
    errors.push(`${errorPrefix}-limit`)
  }
  const seenEffects = new Map()
  const seenScalarPaths = new Map()
  const seenMoves = new Set()
  let rawPathCount = 0
  const addEffect = (target, state) => {
    rawPathCount += 1
    if (!path.isAbsolute(String(target || '')) || Buffer.byteLength(String(target || ''), 'utf8') > MAX_PATH_BYTES) {
      errors.push(`${errorPrefix}-path-invalid`)
      return
    }
    const key = comparable(target)
    if (seenEffects.has(key) && seenEffects.get(key) !== state) {
      errors.push(`${errorPrefix}-conflict`)
      return
    }
    if (seenEffects.has(key)) return
    seenEffects.set(key, state)
    effectPaths.push({ path: target, state })
  }
  for (const [category, state] of [['created', 'present'], ['modified', 'present'], ['deleted', 'absent']]) {
    for (const target of value[category]) {
      const key = comparable(target)
      if (seenScalarPaths.has(key)) errors.push(`${errorPrefix}-duplicate`)
      else seenScalarPaths.set(key, category)
      addEffect(target, state)
    }
  }
  for (const move of value.moved) {
    if (!move || typeof move !== 'object' || Array.isArray(move) ||
        !path.isAbsolute(String(move.source || '')) || !path.isAbsolute(String(move.target || '')) ||
        Buffer.byteLength(String(move.source || ''), 'utf8') > MAX_PATH_BYTES ||
        Buffer.byteLength(String(move.target || ''), 'utf8') > MAX_PATH_BYTES) {
      errors.push(`${errorPrefix}-move-invalid`)
      continue
    }
    const moveKey = `${comparable(move.source)}\u0000${comparable(move.target)}`
    if (seenMoves.has(moveKey)) errors.push(`${errorPrefix}-duplicate`)
    else seenMoves.add(moveKey)
    addEffect(move.source, 'absent')
    addEffect(move.target, 'present')
  }
  if (effectPaths.length > MAX_OBSERVATION_ENTRIES || rawPathCount > MAX_OBSERVATION_ENTRIES * 2) {
    errors.push(`${errorPrefix}-limit`)
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)], effectPaths }
}

function validateArtifactMutationReconciliationReceipt(value, binding = null) {
  const errors = []
  if (value?.schemaVersion !== RECEIPT_SCHEMA) errors.push('artifact-reconciliation-schema-invalid')
  if (value?.resolution !== 'accept-observed-effects') errors.push('artifact-reconciliation-resolution-invalid')
  if (!['primary', 'emergency-reserve'].includes(value?.sourceKind)) errors.push('artifact-reconciliation-source-invalid')
  if (value?.sourceKind === 'primary' && (value.reserveSequence !== null || value.reserveRecordDigest !== null)) errors.push('artifact-reconciliation-primary-reserve-fields')
  if (value?.sourceKind === 'emergency-reserve' && (!Number.isInteger(value.reserveSequence) || value.reserveSequence < 1 || !DIGEST_RE.test(String(value.reserveRecordDigest || '')))) {
    errors.push('artifact-reconciliation-reserve-binding-invalid')
  }
  if (!String(value?.project || '').trim() || !String(value?.operationId || '').trim()) errors.push('artifact-reconciliation-identity-invalid')
  if (value?.taskId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value?.taskId || ''))) {
    errors.push('artifact-reconciliation-task-invalid')
  }
  for (const field of [
    'priorObservationReceiptDigest', 'priorCloseoutDigest', 'priorPlannedSetDigest',
    'recoveredObservedEffectsDigest',
    'activeRootDigest', 'projectRootDigest', 'ingressEnvelopeDigest', 'ingressDecisionDigest',
    'ingressRouteRevision', 'projectTargetLeaseDigest', 'hostSessionDigest'
  ]) {
    if (!DIGEST_RE.test(String(value?.[field] || ''))) errors.push(`artifact-reconciliation-${field}-invalid`)
  }
  if (!['prior-complete-observation', 'reobserved-from-preflight'].includes(value?.recoveryMode) ||
      (value?.recoveryMode === 'prior-complete-observation' && value.recoveryInputDigest !== null) ||
      (value?.recoveryMode === 'reobserved-from-preflight' && !DIGEST_RE.test(String(value.recoveryInputDigest || '')))) {
    errors.push('artifact-reconciliation-recovery-mode-invalid')
  }
  const recoveredEffects = value?.recoveredObservedEffects
  const recoveredEffectsValidation = validateRecoveredObservedEffects(
    recoveredEffects,
    'artifact-reconciliation-recovered-effects'
  )
  errors.push(...recoveredEffectsValidation.errors)
  const effectPaths = recoveredEffectsValidation.effectPaths
  if (recoveredEffectsValidation.valid && digest(recoveredEffects) !== value.recoveredObservedEffectsDigest) {
    errors.push('artifact-reconciliation-recovered-effects-digest-invalid')
  }
  const snapshot = value?.currentEffectSnapshot
  if (snapshot?.schemaVersion !== 'ArtifactMutationReconciliationSnapshotV1' || !Array.isArray(snapshot.entries) ||
      snapshot.entries.length < 1 || snapshot.entries.length > MAX_OBSERVATION_ENTRIES ||
      !Number.isFinite(Date.parse(String(snapshot.observedAt || '')))) {
    errors.push('artifact-reconciliation-snapshot-invalid')
  } else {
    const seenSnapshotPaths = new Set()
    for (const entry of snapshot.entries) {
      if (!entry || typeof entry !== 'object' || !path.isAbsolute(String(entry.path || '')) ||
          Buffer.byteLength(String(entry.path || ''), 'utf8') > MAX_PATH_BYTES ||
          !['active-root', 'project-root'].includes(entry.rootKind) || !['present', 'absent'].includes(entry.expectedState) ||
          entry.state !== entry.expectedState || !['file', 'directory', 'missing'].includes(entry.kind) ||
          !Number.isInteger(entry.bytes) || entry.bytes < 0 ||
          (entry.state === 'present' &&
            (!['file', 'directory'].includes(entry.kind) || !DIGEST_RE.test(String(entry.contentDigest || '')) ||
              !validStatIdentity(entry.identity) || (entry.kind === 'file' && entry.bytes !== entry.identity.size))) ||
          (entry.state === 'absent' &&
            (entry.kind !== 'missing' || entry.bytes !== 0 || entry.contentDigest !== null || entry.identity !== null))) {
        errors.push('artifact-reconciliation-snapshot-entry-invalid')
      }
      const key = comparable(entry?.path)
      if (seenSnapshotPaths.has(key)) errors.push('artifact-reconciliation-snapshot-entry-duplicate')
      seenSnapshotPaths.add(key)
    }
    const { snapshotDigest, ...snapshotSemantic } = snapshot
    if (!DIGEST_RE.test(String(snapshotDigest || '')) || digest(snapshotSemantic) !== snapshotDigest) {
      errors.push('artifact-reconciliation-snapshot-digest-invalid')
    }
    const snapshotStates = new Map(snapshot.entries.map(entry => [comparable(entry.path), entry.state]))
    for (const effect of effectPaths) {
      if (snapshotStates.get(comparable(effect.path)) !== effect.state) {
        errors.push('artifact-reconciliation-effect-snapshot-binding-invalid')
      }
    }
  }
  if (value?.mutationAuthority !== false || !Number.isFinite(Date.parse(String(value?.reconciledAt || '')))) {
    errors.push('artifact-reconciliation-authority-or-time-invalid')
  }
  const { receiptDigest, ...semantic } = value || {}
  if (!DIGEST_RE.test(String(receiptDigest || '')) || digest(semantic) !== receiptDigest) errors.push('artifact-reconciliation-digest-invalid')
  if (binding) {
    for (const field of ['operationId', 'priorCloseoutDigest', 'priorObservationReceiptDigest']) {
      if (String(value?.[field] || '') !== String(binding[field] || '')) errors.push(`artifact-reconciliation-binding-${field}`)
    }
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] }
}

function projectArtifactMutationReconciliationReceipt(value) {
  const validation = validateArtifactMutationReconciliationReceipt(value)
  if (!validation.valid) {
    throw new ArtifactMutationReconciliationError(
      'ARTIFACT_RECONCILIATION_RECEIPT_INVALID',
      'only a valid reconciliation receipt can be compacted',
      { errors: validation.errors }
    )
  }
  const semantic = {
    schemaVersion: PROJECTION_SCHEMA,
    sourceReceiptSchema: RECEIPT_SCHEMA,
    sourceReceiptDigest: value.receiptDigest,
    project: value.project,
    taskId: value.taskId,
    operationId: value.operationId,
    priorObservationReceiptDigest: value.priorObservationReceiptDigest,
    priorCloseoutDigest: value.priorCloseoutDigest,
    priorPlannedSetDigest: value.priorPlannedSetDigest,
    recoveryMode: value.recoveryMode,
    recoveryInputDigest: value.recoveryInputDigest,
    recoveredObservedEffects: JSON.parse(JSON.stringify(value.recoveredObservedEffects)),
    recoveredObservedEffectsDigest: value.recoveredObservedEffectsDigest,
    currentEffectSnapshotDigest: value.currentEffectSnapshot.snapshotDigest,
    mutationAuthority: false,
    reconciledAt: value.reconciledAt
  }
  return Object.freeze({ ...semantic, projectionDigest: digest(semantic) })
}

function validateArtifactMutationReconciliationProjection(value, binding = null) {
  const errors = []
  if (value?.schemaVersion !== PROJECTION_SCHEMA || value?.sourceReceiptSchema !== RECEIPT_SCHEMA) {
    errors.push('artifact-reconciliation-projection-schema-invalid')
  }
  if (!String(value?.project || '').trim() || !String(value?.operationId || '').trim()) {
    errors.push('artifact-reconciliation-projection-identity-invalid')
  }
  if (value?.taskId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value?.taskId || ''))) {
    errors.push('artifact-reconciliation-projection-task-invalid')
  }
  for (const field of [
    'sourceReceiptDigest', 'priorObservationReceiptDigest', 'priorCloseoutDigest',
    'priorPlannedSetDigest', 'recoveredObservedEffectsDigest', 'currentEffectSnapshotDigest'
  ]) {
    if (!DIGEST_RE.test(String(value?.[field] || ''))) errors.push(`artifact-reconciliation-projection-${field}-invalid`)
  }
  if (!['prior-complete-observation', 'reobserved-from-preflight'].includes(value?.recoveryMode) ||
      (value?.recoveryMode === 'prior-complete-observation' && value.recoveryInputDigest !== null) ||
      (value?.recoveryMode === 'reobserved-from-preflight' && !DIGEST_RE.test(String(value.recoveryInputDigest || '')))) {
    errors.push('artifact-reconciliation-projection-recovery-mode-invalid')
  }
  const recoveredEffects = value?.recoveredObservedEffects
  const recoveredEffectsValidation = validateRecoveredObservedEffects(
    recoveredEffects,
    'artifact-reconciliation-projection-recovered-effects'
  )
  errors.push(...recoveredEffectsValidation.errors)
  if (recoveredEffectsValidation.valid && digest(recoveredEffects) !== value.recoveredObservedEffectsDigest) {
    errors.push('artifact-reconciliation-projection-recovered-effects-digest-invalid')
  }
  if (value?.mutationAuthority !== false || !Number.isFinite(Date.parse(String(value?.reconciledAt || '')))) {
    errors.push('artifact-reconciliation-projection-authority-or-time-invalid')
  }
  const { projectionDigest, ...semantic } = value || {}
  if (!DIGEST_RE.test(String(projectionDigest || '')) || digest(semantic) !== projectionDigest) {
    errors.push('artifact-reconciliation-projection-digest-invalid')
  }
  if (binding) {
    for (const field of ['operationId', 'priorCloseoutDigest', 'priorObservationReceiptDigest']) {
      if (String(value?.[field] || '') !== String(binding[field] || '')) errors.push(`artifact-reconciliation-projection-binding-${field}`)
    }
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] }
}

function validateArtifactMutationReconciliationEvidence(value, binding = null) {
  return value?.schemaVersion === RECEIPT_SCHEMA
    ? validateArtifactMutationReconciliationReceipt(value, binding)
    : validateArtifactMutationReconciliationProjection(value, binding)
}

function applyArtifactMutationReconciliation(state, lifecycleCloseout, receipt) {
  const { observation, closeout } = closeoutFromLifecycle(lifecycleCloseout)
  const validation = validateArtifactMutationReconciliationReceipt(receipt, {
    operationId: lifecycleCloseout.operationId,
    priorCloseoutDigest: closeout.closeoutDigest,
    priorObservationReceiptDigest: observation.receiptDigest
  })
  if (!validation.valid) {
    throw new ArtifactMutationReconciliationError('ARTIFACT_RECONCILIATION_RECEIPT_INVALID', 'reconciliation receipt does not bind the prior closeout', { errors: validation.errors })
  }
  const next = JSON.parse(JSON.stringify(state || {}))
  next.turnLiveness = { ...(next.turnLiveness || {}) }
  if (next.turnLiveness.inFlightOperation?.operationId === receipt.operationId) {
    next.turnLiveness.inFlightOperation = null
  }
  next.turnLiveness.lastMutationCloseout = {
    ...JSON.parse(JSON.stringify(lifecycleCloseout)),
    result: 'reconciled',
    reconciledAt: receipt.reconciledAt,
    reconciliation: receipt
  }
  delete next.turnLiveness.lastMutationCloseout.reconciliationInput
  if (next.simpleTaskFastPathLeaseCloseout?.operationId === receipt.operationId) {
    next.simpleTaskFastPathLeaseCloseout = {
      ...next.simpleTaskFastPathLeaseCloseout,
      status: 'reconciled',
      reconciliationReceiptDigest: receipt.receiptDigest
    }
  }
  if (next.workflowOperationalWriteLeaseCloseout?.operationId === receipt.operationId) {
    next.workflowOperationalWriteLeaseCloseout = {
      ...next.workflowOperationalWriteLeaseCloseout,
      status: 'reconciled',
      reconciliationReceiptDigest: receipt.receiptDigest
    }
  }
  next.lastReason = 'ARTIFACT_MUTATION_RECONCILED'
  return next
}

module.exports = {
  ARTIFACT_MUTATION_RECONCILIATION_SCHEMA: RECEIPT_SCHEMA,
  ARTIFACT_MUTATION_RECONCILIATION_PROJECTION_SCHEMA: PROJECTION_SCHEMA,
  ARTIFACT_MUTATION_RECONCILIATION_INPUT_SCHEMA: INPUT_SCHEMA,
  ArtifactMutationReconciliationError,
  applyArtifactMutationReconciliation,
  createArtifactMutationReconciliationInput,
  createArtifactMutationReconciliationReceipt,
  projectArtifactMutationReconciliationReceipt,
  validateArtifactMutationReconciliationEvidence,
  validateArtifactMutationReconciliationInput,
  validateArtifactMutationReconciliationProjection,
  validateArtifactMutationReconciliationReceipt
}
