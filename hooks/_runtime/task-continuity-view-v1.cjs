'use strict'

const {
  digestValue,
  validateTaskCheckpointEpochSet
} = require('./task-checkpoint-epoch-v1.cjs')

const TASK_CONTINUITY_VIEW_SCHEMA = 'TaskContinuityViewV1'
const TASK_CONTINUITY_DISAMBIGUATION_SCHEMA = 'TaskContinuityDisambiguationReceiptV1'
const TASK_CONTINUITY_VIEW_MAX_BYTES = 64 * 1024
const TASK_CONTINUITY_CANDIDATE_MAX = 5
const TASK_CONTINUITY_LIST_MAX = 8
const TASK_CONTINUITY_MAX_AGE_MS = 5000
const ACTIONS = new Set([
  'continue-read',
  'continue-analysis',
  'adopt-writer',
  'confirm-cp',
  'mutate-scoped',
  'disambiguate-once',
  'repair-projection',
  'upgrade-runtime',
  'reopen-task'
])
const LEVELS = new Set(['baseline', 'step-local', 'mutation-local'])

class TaskContinuityViewV1Error extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'TaskContinuityViewV1Error'
    this.code = code
    this.details = details
  }
}

function text(value, maximum = 512) {
  const normalized = String(value || '').trim()
  return Buffer.byteLength(normalized, 'utf8') <= maximum
    ? normalized
    : `${Buffer.from(normalized, 'utf8').subarray(0, Math.max(0, maximum - 3)).toString('utf8').replace(/\uFFFD+$/u, '')}...`
}

function digestOrNull(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null
}

function uniqueBounded(values, maximum = TASK_CONTINUITY_LIST_MAX) {
  return [...new Set(values.filter(Boolean))].slice(0, maximum)
}

function candidateProjection(value = {}, rank = 1) {
  return {
    taskId: text(value.taskId, 128) || null,
    displayName: text(value.displayName, 160) || null,
    project: text(value.project, 128) || null,
    kind: text(value.kind, 64) || null,
    relativeTaskPath: text(value.relativeTaskPath, 512) || null,
    evidenceClass: text(value.evidenceClass || 'provisional', 32),
    rank,
    reasonCodes: uniqueBounded(
      Array.isArray(value.reasonCodes) ? value.reasonCodes.map(item => text(item, 128)) : [],
      TASK_CONTINUITY_LIST_MAX
    )
  }
}

function resolutionCandidates(resolution = {}) {
  const raw = resolution.status === 'resolved-active' && resolution.candidate
    ? [resolution.candidate]
    : (resolution.candidates || resolution.suggestions || [])
  return raw.slice(0, TASK_CONTINUITY_CANDIDATE_MAX).map((candidate, index) => candidateProjection({
    ...candidate,
    evidenceClass: resolution.status === 'resolved-active' ? 'strong' : 'provisional',
    reasonCodes: [
      resolution.recoveryEvidence?.source,
      candidate.selectionDigest ? 'canonical-task-identity' : null,
      resolution.index?.state ? `index:${resolution.index.state}` : null
    ]
  }, index + 1))
}

function createDisambiguationReceipt(project, candidates, resolution = {}) {
  const candidateSetDigest = digestValue(candidates.map(item => ({
    taskId: item.taskId,
    project: item.project,
    kind: item.kind,
    relativeTaskPath: item.relativeTaskPath,
    reasonCodes: item.reasonCodes
  })))
  const evidenceDigest = digestValue({
    source: resolution.recoveryEvidence?.source || null,
    sourceDigest: resolution.recoveryEvidence?.sourceDigest || null,
    indexIdentity: resolution.index?.sourceIdentity?.digest || resolution.index?.sourceIdentity || null,
    scan: resolution.scan || null
  })
  const semantic = {
    schemaVersion: TASK_CONTINUITY_DISAMBIGUATION_SCHEMA,
    project: text(project, 128) || null,
    candidateSetDigest,
    evidenceDigest,
    mutationAuthority: false
  }
  return Object.freeze({ ...semantic, receiptDigest: digestValue(semantic) })
}

function checkpointState(slot) {
  if (!slot) return 'unknown'
  if (slot.state === 'confirmed') return 'confirmed'
  if (slot.state === 'invalidated') return 'invalidated'
  return slot.phase === 'CP1' ? 'pending' : 'not-started'
}

function ownerProjection(owner, nowMs) {
  if (!owner) return { status: 'missing', ownerGeneration: null, leaseDigest: null }
  const expiresAt = Date.parse(String(owner.expiresAt || ''))
  const activeExpiryValid = owner.status !== 'active' || Number.isFinite(expiresAt)
  const expired = owner.status === 'active' && activeExpiryValid && expiresAt <= nowMs
  const status = !activeExpiryValid
    ? 'conflict'
    : (expired
        ? 'expired'
        : (owner.status === 'active'
            ? 'active'
            : (['released', 'terminal'].includes(owner.status) ? 'missing' : 'conflict')))
  return {
    status,
    ownerGeneration: Number.isSafeInteger(owner.ownerGeneration) ? owner.ownerGeneration : null,
    leaseDigest: digestOrNull(owner.leaseDigest)
  }
}

function contextPlanContentId(state = {}) {
  return text(
    state.contextAcquisition?.plan?.planContentId ||
    state.contextAcquisition?.binding?.planContentId ||
    state.contextAcquisition?.planContentId ||
    state.contextHandoffCard?.planContentId || '',
    256
  ) || null
}

function validationAuthorityDigest(state = {}) {
  return digestOrNull(
    state.validationExecution?.authorityDigest ||
    state.validationControl?.authorityDigest ||
    state.validationAuthority?.authorityDigest
  )
}

function currentAuthorityBinding(state = {}) {
  const transaction = state.admissionTransaction || null
  const owner = state.fencedWriteOwner || null
  const canonical = state.taskCanonicalRevision || null
  return {
    admissionId: transaction?.admissionId || null,
    owner: owner
      ? {
          ownerGeneration: owner.ownerGeneration,
          leaseRevision: owner.leaseRevision,
          leaseDigest: owner.leaseDigest
        }
      : null,
    lineage: canonical
      ? {
          canonicalRevision: canonical.revision,
          canonicalHeadDigest: canonical.currentOverviewDigest,
          canonicalParentRevision: canonical.revision > 1 ? canonical.revision - 1 : null,
          scopeDigest: transaction?.workItemDigest || null
        }
      : null,
    context: {
      contextEpoch: owner?.contextEpoch || state.contextAcquisition?.contextEpoch || null,
      planContentId: contextPlanContentId(state),
      autoGrantDigest: digestOrNull(state.taskScopedAutoContinuationGrant?.grantDigest),
      autoDecisionDigest: digestOrNull(state.autoCheckpointDecision?.decisionDigest),
      validationAuthorityDigest: validationAuthorityDigest(state)
    }
  }
}

function lineageErrors(epoch, state = {}) {
  if (!epoch) return ['epoch-current-missing']
  const binding = currentAuthorityBinding(state)
  const transaction = state.admissionTransaction || {}
  const owner = state.fencedWriteOwner || {}
  const canonical = state.taskCanonicalRevision || {}
  const errors = []
  if (epoch.task.taskId !== String(transaction.taskId || '').toLowerCase()) errors.push('epoch-task')
  if (epoch.task.project !== transaction.project) errors.push('epoch-project')
  if (epoch.task.admissionId !== binding.admissionId) errors.push('epoch-admission')
  if (!binding.owner || epoch.owner.ownerGeneration !== binding.owner.ownerGeneration ||
      epoch.owner.leaseRevision !== binding.owner.leaseRevision || epoch.owner.leaseDigest !== binding.owner.leaseDigest) {
    errors.push('epoch-owner')
  }
  if (!binding.lineage || epoch.lineage.canonicalRevision !== binding.lineage.canonicalRevision ||
      epoch.lineage.canonicalHeadDigest !== binding.lineage.canonicalHeadDigest ||
      epoch.lineage.scopeDigest !== binding.lineage.scopeDigest) {
    errors.push('epoch-canonical')
  }
  if (canonical.taskId && canonical.taskId !== epoch.task.taskId) errors.push('canonical-task')
  for (const field of ['contextEpoch', 'planContentId', 'autoGrantDigest', 'autoDecisionDigest', 'validationAuthorityDigest']) {
    const expected = binding.context[field]
    if (expected && epoch.context[field] !== expected) errors.push(`epoch-${field}`)
  }
  return uniqueBounded(errors)
}

function degradation(level, code, nextAction) {
  if (!LEVELS.has(level)) throw new TaskContinuityViewV1Error('TASK_CONTINUITY_DEGRADATION_LEVEL_INVALID', 'invalid degradation level')
  return { level, code: text(code, 128), nextAction: text(nextAction, 256) }
}

function canonicalProjection(state = {}, canonicalEvidence = null) {
  const canonical = canonicalEvidence?.canonicalRevision || state.taskCanonicalRevision || null
  if (!canonical) return { revision: null, headDigest: null, scopeDigest: null, status: 'missing' }
  return {
    revision: Number.isSafeInteger(canonical.revision) ? canonical.revision : null,
    headDigest: digestOrNull(canonical.currentOverviewDigest || canonicalEvidence?.canonicalOverviewDigest),
    scopeDigest: digestOrNull(state.admissionTransaction?.workItemDigest),
    status: canonicalEvidence?.errorCode ? 'drift' : 'current'
  }
}

function viewSemantic(input = {}) {
  const semantic = { ...input }
  delete semantic.viewDigest
  return semantic
}

function validateTaskContinuityView(value) {
  const errors = []
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== TASK_CONTINUITY_VIEW_SCHEMA) {
    return { valid: false, errors: ['view-schema'] }
  }
  if (!['ready', 'degraded', 'provisional', 'ambiguous', 'terminal'].includes(value.status)) errors.push('view-status')
  if (!value.task || !['strong', 'provisional', 'ambiguous', 'none'].includes(value.task.evidenceClass)) errors.push('view-task')
  if (!Array.isArray(value.actions) || value.actions.length > TASK_CONTINUITY_LIST_MAX || value.actions.some(item => !ACTIONS.has(item))) errors.push('view-actions')
  if (!Array.isArray(value.degradations) || value.degradations.length > TASK_CONTINUITY_LIST_MAX || value.degradations.some(item => !LEVELS.has(item?.level))) errors.push('view-degradations')
  if (!Array.isArray(value.candidates) || value.candidates.length > TASK_CONTINUITY_CANDIDATE_MAX || value.candidates.some(item => !Array.isArray(item.reasonCodes) || item.reasonCodes.length > TASK_CONTINUITY_LIST_MAX)) errors.push('view-candidates')
  if (value.mutationAuthority !== false) errors.push('view-authority')
  if (!Number.isFinite(Date.parse(String(value.freshness?.generatedAt || ''))) || value.freshness?.maxAgeMs !== TASK_CONTINUITY_MAX_AGE_MS || !Number.isSafeInteger(value.freshness?.sourceSequence) || value.freshness.sourceSequence < 0) errors.push('view-freshness')
  if (!/^[a-f0-9]{64}$/.test(String(value.viewDigest || '')) || value.viewDigest !== digestValue(viewSemantic(value))) errors.push('view-digest')
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > TASK_CONTINUITY_VIEW_MAX_BYTES) errors.push('view-size')
  return { valid: errors.length === 0, errors: uniqueBounded(errors, 32) }
}

function buildTaskContinuityView(input = {}, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  const generatedAt = new Date(nowMs).toISOString()
  const resolution = input.resolution || {}
  const recoveryRead = input.recoveryRead || { status: 'missing' }
  const state = recoveryRead.state || {}
  const candidates = resolutionCandidates(resolution)
  const selected = resolution.status === 'resolved-active' ? resolution.candidate : null
  const taskId = text(selected?.taskId || state.taskRecoveryBinding?.taskId || state.admissionTransaction?.taskId, 128) || null
  const project = text(selected?.project || state.taskRecoveryBinding?.project || state.admissionTransaction?.project || input.project, 128) || null
  const stateTaskId = text(state.taskRecoveryBinding?.taskId || state.admissionTransaction?.taskId, 128).toLowerCase()
  const selectedTaskId = text(selected?.taskId, 128).toLowerCase()
  const stateProject = text(state.taskRecoveryBinding?.project || state.admissionTransaction?.project, 128)
  const selectedProject = text(selected?.project, 128)
  const identityMismatch = Boolean(selected && (
    (stateTaskId && selectedTaskId && stateTaskId !== selectedTaskId) ||
    (stateProject && selectedProject && stateProject !== selectedProject)
  ))
  const evidenceClass = resolution.status === 'resolved-active'
    ? (recoveryRead.status === 'fresh' ? 'strong' : 'provisional')
    : (resolution.status === 'ambiguous' ? 'ambiguous' : (candidates.length ? 'provisional' : 'none'))
  const degradations = []
  const actions = ['continue-read', 'continue-analysis']

  let epoch = null
  let epochSet = null
  const rawEpochSet = state.taskCheckpointEpochSet
  if (rawEpochSet) {
    const epochValidation = validateTaskCheckpointEpochSet(rawEpochSet)
    if (epochValidation.valid) {
      epochSet = rawEpochSet
      epoch = rawEpochSet.epochs.find(item => item.epochId === rawEpochSet.currentEpochId) || null
      if (!epoch) degradations.push(degradation('mutation-local', 'TASK_CHECKPOINT_CURRENT_EPOCH_MISSING', 'upgrade-runtime'))
    } else {
      degradations.push(degradation(
        'mutation-local',
        rawEpochSet.schemaVersion === 'TaskCheckpointEpochSetV1'
          ? 'TASK_CHECKPOINT_EPOCH_INVALID'
          : 'TASK_CHECKPOINT_EPOCH_VERSION_UNSUPPORTED',
        'upgrade-runtime'
      ))
      actions.push('upgrade-runtime')
    }
  } else if (recoveryRead.status === 'fresh') {
    degradations.push(degradation('baseline', 'TASK_CHECKPOINT_EPOCH_LEGACY', 'upgrade-runtime'))
    actions.push('upgrade-runtime')
  }

  const owner = ownerProjection(state.fencedWriteOwner, nowMs)
  const canonical = canonicalProjection(state, input.canonicalEvidence)
  const projectionMarker = input.projectionMarker || { found: false }
  if (epochSet && (!projectionMarker.found || projectionMarker.epochId !== epochSet.currentEpochId ||
      projectionMarker.projectionDigest !== epochSet.projection.desiredDigest || epochSet.projection.status !== 'current')) {
    degradations.push(degradation('step-local', 'TASK_CHECKPOINT_PROJECTION_STALE', 'repair-projection'))
    actions.push('repair-projection')
  }

  const lineage = epoch ? lineageErrors(epoch, state) : []
  if (lineage.length) {
    degradations.push(degradation('mutation-local', 'TASK_CHECKPOINT_LINEAGE_MISMATCH', 'adopt-writer'))
  }
  if (identityMismatch) {
    degradations.push(degradation('mutation-local', 'TASK_CONTINUITY_IDENTITY_MISMATCH', 'continue-analysis'))
  }
  if (recoveryRead.status !== 'fresh') {
    degradations.push(degradation('baseline', recoveryRead.errorCode || 'TASK_RECOVERY_STATE_UNAVAILABLE', 'continue-analysis'))
  }
  if (resolution.status === 'ambiguous') {
    const receipt = createDisambiguationReceipt(project, candidates, resolution)
    const alreadyPresented = input.priorDisambiguationReceiptDigest === receipt.receiptDigest
    if (!alreadyPresented) actions.push('disambiguate-once')
  }
  if (resolution.status && !['resolved-active', 'ambiguous'].includes(resolution.status)) {
    degradations.push(degradation('baseline', resolution.errorCode || 'TASK_CONTINUITY_PROVISIONAL', 'continue-analysis'))
  }

  const terminal = Boolean(epoch?.terminalStatus || state.fencedWriteOwner?.status === 'terminal' || state.workflowTaskTerminalReceipt)
  if (terminal) actions.push('reopen-task')
  else if (owner.status !== 'active') actions.push('adopt-writer')
  const mutationReady = evidenceClass === 'strong' && epoch && !terminal && !lineage.length && !identityMismatch &&
    owner.status === 'active' && canonical.status === 'current'
  if (mutationReady) actions.push('confirm-cp', 'mutate-scoped')

  const disambiguationReceipt = resolution.status === 'ambiguous'
    ? createDisambiguationReceipt(project, candidates, resolution)
    : null
  const alreadyPresented = Boolean(disambiguationReceipt &&
    input.priorDisambiguationReceiptDigest === disambiguationReceipt.receiptDigest)
  const preferredAction = terminal
    ? 'reopen-task'
    : (resolution.status === 'ambiguous' && !alreadyPresented
        ? 'disambiguate-once'
        : (owner.status !== 'active' && evidenceClass === 'strong'
            ? 'adopt-writer'
            : (mutationReady
                ? 'mutate-scoped'
            : (degradations.some(item => item.code === 'TASK_CHECKPOINT_PROJECTION_STALE')
                ? 'repair-projection'
                : 'continue-analysis'))))
  const status = terminal
    ? 'terminal'
    : (resolution.status === 'ambiguous'
        ? 'ambiguous'
        : (evidenceClass === 'none' || evidenceClass === 'provisional'
            ? 'provisional'
            : (degradations.length ? 'degraded' : 'ready')))
  const semantic = {
    schemaVersion: TASK_CONTINUITY_VIEW_SCHEMA,
    status,
    task: {
      taskId,
      project,
      activeRootDigest: digestOrNull(state.admissionTransaction?.projectRootIdentityDigest) ||
        (input.activeRoot ? digestValue({ activeRoot: text(input.activeRoot, 2048).replace(/\\/gu, '/') }) : null),
      evidenceClass
    },
    epoch: epoch
      ? {
          currentEpochId: epoch.epochId,
          ordinal: epoch.ordinal,
          stageKey: epoch.stageKey,
          status: epoch.status,
          terminalStatus: epoch.terminalStatus,
          epochDigest: epoch.epochDigest
        }
      : null,
    checkpoint: {
      CP1: checkpointState(epoch?.phases?.CP1),
      CP2: checkpointState(epoch?.phases?.CP2),
      CP3: checkpointState(epoch?.phases?.CP3),
      bindingDigests: Object.fromEntries(['CP1', 'CP2', 'CP3'].map(phase => [
        phase,
        digestOrNull(epoch?.phases?.[phase]?.currentBinding?.bindingDigest)
      ]))
    },
    writer: owner,
    canonical,
    actions: uniqueBounded(actions),
    preferredAction,
    degradations: degradations.slice(0, TASK_CONTINUITY_LIST_MAX),
    candidates,
    disambiguation: disambiguationReceipt
      ? { ...disambiguationReceipt, alreadyPresented }
      : null,
    freshness: {
      sourceSequence: Number.isSafeInteger(recoveryRead.envelope?.sequence) ? recoveryRead.envelope.sequence : 0,
      generatedAt,
      maxAgeMs: TASK_CONTINUITY_MAX_AGE_MS
    },
    mutationAuthority: false
  }
  const view = Object.freeze({ ...semantic, viewDigest: digestValue(semantic) })
  const validation = validateTaskContinuityView(view)
  if (!validation.valid) {
    throw new TaskContinuityViewV1Error('TASK_CONTINUITY_VIEW_INVALID', 'generated continuity view is invalid', { errors: validation.errors })
  }
  return view
}

function currentCheckpointLabel(view, chinese) {
  if (!view.epoch) return chinese ? '代际待恢复' : 'epoch recovery pending'
  const phase = view.checkpoint.CP3 === 'confirmed'
    ? 'CP3'
    : (view.checkpoint.CP2 === 'confirmed' ? 'CP2' : 'CP1')
  const suffix = view.epoch.stageKey ? `${view.epoch.stageKey}/${phase}` : phase
  return suffix
}

function preferredActionLabel(action, chinese) {
  const labels = {
    'continue-analysis': ['继续当前分析', 'continue the current analysis'],
    'disambiguate-once': ['选择一次目标任务', 'choose the target task once'],
    'adopt-writer': ['安全续接当前任务写入者', 'safely adopt the current task writer'],
    'repair-projection': ['自动对账当前任务记录', 'reconcile the current task projection'],
    'upgrade-runtime': ['切换到支持代际的运行时', 'use an epoch-capable runtime'],
    'reopen-task': ['显式续开该任务', 'explicitly reopen the task'],
    'confirm-cp': ['确认当前检查点', 'confirm the current checkpoint'],
    'mutate-scoped': ['继续已围栏的修改', 'continue the fenced mutation']
  }
  const pair = labels[action] || labels['continue-analysis']
  return chinese ? pair[0] : pair[1]
}

/** Human-first: one compact conclusion, current state, and one preferred action. */
function renderTaskContinuityViewHuman(view, options = {}) {
  const validation = validateTaskContinuityView(view)
  if (!validation.valid) {
    throw new TaskContinuityViewV1Error('TASK_CONTINUITY_VIEW_INVALID', 'cannot render an invalid continuity view', { errors: validation.errors })
  }
  const locale = String(options.locale || 'en-US').toLowerCase()
  const chinese = locale.startsWith('zh')
  const taskName = view.candidates[0]?.displayName || view.task.taskId || (chinese ? '当前任务' : 'the current task')
  const state = currentCheckpointLabel(view, chinese)
  const action = preferredActionLabel(view.preferredAction, chinese)
  if (view.status === 'ready') {
    return chinese
      ? `已安全恢复“${taskName}”，当前为 ${state}，任务可继续；下一步：${action}。`
      : `Safely recovered “${taskName}” at ${state}; the task can continue. Next: ${action}.`
  }
  if (view.status === 'ambiguous') {
    const suffix = view.disambiguation?.alreadyPresented
      ? (chinese ? '同一候选已提示过，当前分析继续' : 'the same candidates were already shown, so analysis continues')
      : (chinese ? `有 ${view.candidates.length} 个同级候选` : `${view.candidates.length} equally ranked candidates remain`)
    return chinese
      ? `任务恢复未被阻断：${suffix}；下一步：${action}。`
      : `Task recovery is not blocked: ${suffix}. Next: ${action}.`
  }
  if (view.status === 'terminal') {
    return chinese
      ? `“${taskName}”已处于终态，读取与分析仍可继续；下一步：${action}。`
      : `“${taskName}” is terminal; reading and analysis can still continue. Next: ${action}.`
  }
  return chinese
    ? `任务恢复以${view.status === 'provisional' ? '临时' : '降级'}状态继续，当前为 ${state}；下一步：${action}。`
    : `Task recovery continues in ${view.status} mode at ${state}. Next: ${action}.`
}

module.exports = {
  TASK_CONTINUITY_CANDIDATE_MAX,
  TASK_CONTINUITY_DISAMBIGUATION_SCHEMA,
  TASK_CONTINUITY_LIST_MAX,
  TASK_CONTINUITY_MAX_AGE_MS,
  TASK_CONTINUITY_VIEW_MAX_BYTES,
  TASK_CONTINUITY_VIEW_SCHEMA,
  TaskContinuityViewV1Error,
  buildTaskContinuityView,
  createDisambiguationReceipt,
  currentAuthorityBinding,
  renderTaskContinuityViewHuman,
  validateTaskContinuityView
}
