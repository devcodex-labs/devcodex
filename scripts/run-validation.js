#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const {
  REQUIRED_ROUTES,
  RISK_CLASSES,
  ValidationDagError,
  buildCandidateIdentity,
  manifestIdentity,
  planValidation,
  readValidationManifest
} = require('./lib/validation-dag')
const {
  ACTOR_TYPES,
  approvePlanFromBudgetAuthority,
  candidateBinding,
  createBudgetConfirmationReceipt,
  createPendingBudgetCardBinding,
  createValidationContinuationAuthorization,
  planBudgetProjection,
  createVerificationExecutionLease
} = require('./lib/validation-execution-authority')
const { createValidationEvidenceStore } = require('./lib/validation-evidence-store')
const { runManagedValidation } = require('./lib/managed-validation-runner')
const {
  resolveActiveRuntimeRoot
} = require('../hooks/_runtime/workspace-layout.cjs')
const { resolveExecutionFeatureDecisionForCwd } = require('../hooks/_runtime/execution-optimization-routing.cjs')
const {
  readTaskRecoveryState,
  resolveTaskRecoveryMetaDir
} = require('../hooks/_runtime/task-recovery-store-v5.cjs')
const {
  VERIFICATION_LEVELS,
  VERIFICATION_PURPOSES,
  validateValidationControlIngressReceipt,
  validationProjectRootIdentity
} = require('../hooks/_runtime/workflow-completion-contract.cjs')
const { sha256 } = require('../hooks/_runtime/content-identity.cjs')

const ROOT = path.resolve(__dirname, '..')
const DEFAULT_MANIFEST = path.join(__dirname, 'validation-manifest.json')
const CLI_SCHEMA = 'ValidationCliEnvelopeV1'
const DIGEST_RE = /^[a-f0-9]{64}$/

function parseArgs(argv) {
  const options = {
    route: 'changed',
    riskClass: 'normal',
    purpose: null,
    level: null,
    affectedBoundaries: [],
    releaseAuthorized: false,
    explicitFullAudit: false,
    actorType: null,
    authoritySourceRef: null,
    sourceMessageDigest: null,
    policyDigest: null,
    taskRecoveryKey: null,
    contextEpoch: null,
    sessionKey: null,
    leasePath: null,
    approvePlanDigest: null,
    changedFiles: [],
    changedSpecified: false,
    json: false,
    planOnly: false,
    useCache: true,
    manifestPath: DEFAULT_MANIFEST,
    help: false
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') options.json = true
    else if (arg === '--plan') options.planOnly = true
    else if (arg === '--no-cache') options.useCache = false
    else if (arg === '--release-authorized') options.releaseAuthorized = true
    else if (arg === '--full-audit') options.explicitFullAudit = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (['--route', '--risk', '--changed', '--manifest', '--intent', '--purpose', '--level', '--boundary', '--approve-plan',
      '--actor', '--authority-source', '--source-message-digest', '--policy-digest', '--task-recovery-key', '--context-epoch',
      '--session-key', '--lease'].includes(arg)) {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        throw new ValidationDagError('VALIDATION_ARGUMENT_MISSING', arg + ' requires a value')
      }
      index += 1
      if (arg === '--route') options.route = value
      else if (arg === '--risk') options.riskClass = value
      else if (arg === '--manifest') options.manifestPath = path.resolve(value)
      else if (arg === '--intent' || arg === '--purpose') options.purpose = value
      else if (arg === '--level') options.level = value
      else if (arg === '--boundary') options.affectedBoundaries.push(value)
      else if (arg === '--approve-plan') options.approvePlanDigest = value
      else if (arg === '--actor') options.actorType = value
      else if (arg === '--authority-source') options.authoritySourceRef = value
      else if (arg === '--source-message-digest') options.sourceMessageDigest = value
      else if (arg === '--policy-digest') options.policyDigest = value
      else if (arg === '--task-recovery-key') options.taskRecoveryKey = value
      else if (arg === '--context-epoch') options.contextEpoch = value
      else if (arg === '--session-key') options.sessionKey = value
      else if (arg === '--lease') options.leasePath = path.resolve(value)
      else {
        options.changedSpecified = true
        options.changedFiles.push(value)
      }
    } else if (arg.startsWith('--route=')) options.route = arg.slice('--route='.length)
    else if (arg.startsWith('--risk=')) options.riskClass = arg.slice('--risk='.length)
    else if (arg.startsWith('--manifest=')) options.manifestPath = path.resolve(arg.slice('--manifest='.length))
    else if (arg.startsWith('--intent=')) options.purpose = arg.slice('--intent='.length)
    else if (arg.startsWith('--purpose=')) options.purpose = arg.slice('--purpose='.length)
    else if (arg.startsWith('--level=')) options.level = arg.slice('--level='.length)
    else if (arg.startsWith('--boundary=')) options.affectedBoundaries.push(arg.slice('--boundary='.length))
    else if (arg.startsWith('--approve-plan=')) options.approvePlanDigest = arg.slice('--approve-plan='.length)
    else if (arg.startsWith('--actor=')) options.actorType = arg.slice('--actor='.length)
    else if (arg.startsWith('--authority-source=')) options.authoritySourceRef = arg.slice('--authority-source='.length)
    else if (arg.startsWith('--source-message-digest=')) options.sourceMessageDigest = arg.slice('--source-message-digest='.length)
    else if (arg.startsWith('--policy-digest=')) options.policyDigest = arg.slice('--policy-digest='.length)
    else if (arg.startsWith('--task-recovery-key=')) options.taskRecoveryKey = arg.slice('--task-recovery-key='.length)
    else if (arg.startsWith('--context-epoch=')) options.contextEpoch = arg.slice('--context-epoch='.length)
    else if (arg.startsWith('--session-key=')) options.sessionKey = arg.slice('--session-key='.length)
    else if (arg.startsWith('--lease=')) options.leasePath = path.resolve(arg.slice('--lease='.length))
    else if (arg.startsWith('--changed=')) {
      options.changedSpecified = true
      options.changedFiles.push(arg.slice('--changed='.length))
    } else {
      throw new ValidationDagError('VALIDATION_ARGUMENT_UNKNOWN', 'unknown argument: ' + arg)
    }
  }
  if (!REQUIRED_ROUTES.includes(options.route)) {
    throw new ValidationDagError('VALIDATION_ROUTE_UNKNOWN', 'unknown route: ' + options.route)
  }
  if (!RISK_CLASSES.has(options.riskClass)) {
    throw new ValidationDagError('VALIDATION_RISK_UNKNOWN', 'unknown risk class: ' + options.riskClass)
  }
  if (options.level !== null && !VERIFICATION_LEVELS.has(options.level)) {
    throw new ValidationDagError('VALIDATION_LEVEL_UNKNOWN', 'unknown verification level: ' + options.level)
  }
  if (options.purpose !== null && !VERIFICATION_PURPOSES.has(options.purpose)) {
    throw new ValidationDagError('VALIDATION_PURPOSE_UNKNOWN', 'unknown verification purpose: ' + options.purpose)
  }
  if (options.changedSpecified && options.changedFiles.some(file => !String(file).trim())) {
    throw new ValidationDagError('VALIDATION_CHANGED_EMPTY', '--changed values must be non-empty')
  }
  if (options.actorType !== null && !ACTOR_TYPES.has(options.actorType)) {
    throw new ValidationDagError('VALIDATION_ACTOR_UNKNOWN', 'unknown validation actor: ' + options.actorType)
  }
  return options
}

function envelope(ok, data = null, error = null) {
  return { schemaVersion: CLI_SCHEMA, ok, data, error }
}

function printJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n')
}

function printHelp() {
  process.stdout.write([
    'Usage: node scripts/run-validation.js [options]',
    '',
    'Options:',
    '  --route <fast|changed|delivery|boundary|profile-deploy|package-release|full>',
    '  --changed <relative-path>   Repeat for explicit changed inputs',
    '  --risk <normal|high|release|security|destructive>',
    '  --intent <edit-loop|delivery|boundary|full-audit|release>',
    '  --purpose <value>           Compatibility alias for --intent',
    '  --level <V0|V1|V2|V3>      May widen a route; V3 still requires explicit authority',
    '  --boundary <id>             Repeat for explicit V2 boundaries',
    '  --full-audit                Request V3 audit; this flag does not grant execution authority',
    '  --release-authorized        Compatibility request flag; never grants execution authority',
    '  --approve-plan <digest>     Confirm the exact BudgetCardV1 digest',
    '  --actor <type>              ai-hook|human-cli|trusted-ci|release-pipeline',
    '  --authority-source <ref>    Current message, TTY attestation, CI policy or release policy reference',
    '  --source-message-digest <d> Required for ai-hook authority',
    '  --policy-digest <digest>    Required for trusted-ci and release-pipeline authority',
    '  --task-recovery-key <key>   Bind AI authority to the current formal task',
    '  --context-epoch <epoch>     Bind AI authority to the current context epoch',
    '  --session-key <key>         Persist task-bound authority through TaskRecoveryStoreV5',
    '  --lease <path>              Consume an externally issued exact VerificationExecutionLeaseV2',
    '  --plan                      Resolve the DAG without executing nodes',
    '  --no-cache                  Disable candidate-bound evidence reuse',
    '  --json                      Emit one machine-readable JSON document',
    '  --manifest <path>           Override the manifest for fixtures',
    '  --help                      Show this help',
    ''
  ].join('\n'))
}

function compactPlan(plan, executionOptimization = null) {
  return {
    schemaVersion: plan.schemaVersion,
    manifestIdentity: plan.manifestIdentity,
    routeRequested: plan.routeRequested,
    routeResolved: plan.routeResolved,
    riskClass: plan.riskClass,
    verificationIntent: plan.verificationIntent,
    verificationLevel: plan.verificationLevel,
    verificationPurpose: plan.verificationPurpose,
    affectedBoundaries: plan.affectedBoundaries,
    requestDigest: plan.requestDigest,
    changedScopeDigest: plan.changedScopeDigest,
    claimCeiling: plan.claimCeiling,
    executionState: plan.executionState,
    executionBlockers: plan.executionBlockers,
    validationLayer: plan.validationLayer,
    candidateId: plan.candidateId,
    candidateStable: plan.candidateStable,
    changedSource: plan.changedSource,
    changedFiles: plan.changedFiles,
    recognizedNoJsInputs: plan.recognizedNoJsInputs,
    executableChangedFiles: plan.executableChangedFiles,
    validationDisposition: plan.validationDisposition,
    javascriptCommandCount: plan.javascriptCommandCount,
    changeDescriptors: plan.changeDescriptors,
    impactGraphDigest: plan.impactGraphDigest,
    planDigest: plan.planDigest,
    fullFallback: plan.fullFallback,
    selectedNodes: plan.selectedNodes.map(node => node.id),
    selectionReasons: plan.selectionReasons,
    budget: plan.budget,
    budgetCard: plan.budgetCard,
    invalidationFrontier: plan.invalidationFrontier,
    delegatedParentIds: plan.delegatedParentIds,
    skipped: plan.skipped,
    selectedNodeCount: plan.selectedNodeCount,
    fullNodeCount: plan.fullNodeCount,
    duplicateLeafCount: plan.duplicateLeafCount,
    requiredNodeMisses: plan.requiredNodeMisses,
    executionOptimization
  }
}

function errorPayload(error, nextStep) {
  return {
    code: error.code || 'VALIDATION_ERROR',
    message: error.message,
    nextStep,
    details: error.details || null
  }
}

function detectedActorType(env = process.env) {
  if (env.CODEX_THREAD_ID || /codex/i.test(String(env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE || ''))) return 'ai-hook'
  if (env.GITHUB_ACTIONS === 'true') return env.GITHUB_REF_TYPE === 'tag' ? 'release-pipeline' : 'trusted-ci'
  if (env.DEVCODEX_VALIDATION_ACTOR && ACTOR_TYPES.has(env.DEVCODEX_VALIDATION_ACTOR)) return env.DEVCODEX_VALIDATION_ACTOR
  return 'human-cli'
}

function resolveActorType(requested, env = process.env) {
  const detected = detectedActorType(env)
  if (requested && requested !== detected) {
    throw new ValidationDagError(
      'VALIDATION_ACTOR_SPOOF_REJECTED',
      `the detected ${detected} invocation cannot self-attest as ${requested}`
    )
  }
  return detected
}

function ciAuthoritySource(env = process.env) {
  return [
    'github-actions',
    env.GITHUB_WORKFLOW || 'unknown-workflow',
    env.GITHUB_EVENT_NAME || 'unknown-event',
    env.GITHUB_REPOSITORY || 'unknown-repository',
    env.GITHUB_REF || 'unknown-ref',
    env.GITHUB_SHA || 'unknown-commit'
  ].join(':')
}

function expectedCiPolicyDigest(actorType, plan, env = process.env) {
  const identity = {
    workflow: env.GITHUB_WORKFLOW,
    event: env.GITHUB_EVENT_NAME,
    repository: env.GITHUB_REPOSITORY,
    ref: env.GITHUB_REF,
    commit: env.GITHUB_SHA
  }
  if (Object.values(identity).some(value => typeof value !== 'string' || value.length === 0)) return null
  return sha256(JSON.stringify(actorType === 'release-pipeline'
    ? { ...identity, purpose: plan.verificationPurpose }
    : { ...identity, level: plan.verificationLevel }))
}

function directActorIdentityEvidence(actorType, env = process.env) {
  if (actorType === 'ai-hook') {
    return {
      host: 'codex',
      threadId: env.CODEX_THREAD_ID || null,
      originator: env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE || null
    }
  }
  if (['trusted-ci', 'release-pipeline'].includes(actorType)) {
    return {
      workflow: env.GITHUB_WORKFLOW || null,
      event: env.GITHUB_EVENT_NAME || null,
      repository: env.GITHUB_REPOSITORY || null,
      ref: env.GITHUB_REF || null,
      commit: env.GITHUB_SHA || null,
      runId: env.GITHUB_RUN_ID || null,
      runAttempt: env.GITHUB_RUN_ATTEMPT || null,
      job: env.GITHUB_JOB || null
    }
  }
  return {
    ttyInput: process.stdin.isTTY === true,
    ttyOutput: process.stdout.isTTY === true,
    executable: process.execPath
  }
}

function resolveValidationAuthorityContext({ actorType, options, activeRoot, env = process.env,
  readTaskState = readTaskRecoveryState }) {
  const context = {
    authoritySourceRef: options.authoritySourceRef || env.DEVCODEX_VALIDATION_AUTHORITY_SOURCE || null,
    contextEpoch: options.contextEpoch || env.DEVCODEX_CONTEXT_EPOCH || null,
    sessionKey: options.sessionKey || env.DEVCODEX_VALIDATION_SESSION_KEY || null,
    sourceMessageDigest: options.sourceMessageDigest || env.DEVCODEX_SOURCE_MESSAGE_DIGEST || null,
    taskIdentity: null,
    taskState: null,
    validationControlIngress: null,
    taskRecoveryKey: options.taskRecoveryKey || env.DEVCODEX_TASK_RECOVERY_KEY || null
  }
  if (actorType !== 'ai-hook') return context

  context.sessionKey = context.sessionKey || env.CODEX_THREAD_ID || null
  if (!context.sessionKey) {
    throw new ValidationDagError(
      'VALIDATION_AI_SESSION_BINDING_REQUIRED',
      'AI validation planning requires the current host session binding',
      { nextStep: 'Run from a bound task session or pass the server-owned session key.' }
    )
  }
  if (!context.contextEpoch) {
    throw new ValidationDagError(
      'VALIDATION_AI_CONTEXT_EPOCH_REQUIRED',
      'AI validation planning requires the current ContextRead epoch',
      { nextStep: 'Rebuild ContextRead, then pass its exact context epoch before generating a BudgetCard.' }
    )
  }

  const metaDir = resolveTaskRecoveryMetaDir({ activeRoot, project: 'devcodex' })
  const recovered = readTaskState({
    metaDir,
    sessionKey: context.sessionKey,
    expectedIdentity: { activeRoot, project: 'devcodex' }
  })
  if (recovered.status !== 'fresh' || !recovered.identity?.taskId) {
    throw new ValidationDagError(
      'VALIDATION_AI_TASK_BINDING_REQUIRED',
      'AI validation planning requires one fresh server-owned formal task binding',
      {
        observedStatus: recovered.status || 'missing',
        errorCode: recovered.errorCode || null,
        nextStep: 'Restore or admit the exact formal task for this session before generating a BudgetCard.'
      }
    )
  }
  const resolvedTaskKey = String(recovered.identity.taskId).trim().toLowerCase()
  if (context.taskRecoveryKey && String(context.taskRecoveryKey).trim().toLowerCase() !== resolvedTaskKey) {
    throw new ValidationDagError(
      'VALIDATION_AI_TASK_BINDING_MISMATCH',
      'the requested task recovery key does not match the current server-owned session task',
      {
        currentTaskId: resolvedTaskKey,
        nextStep: 'Re-resolve the intended task; do not reuse another task or session authority.'
      }
    )
  }
  context.taskRecoveryKey = resolvedTaskKey
  context.taskIdentity = recovered.identity
  context.taskState = recovered.state || null
  context.validationControlIngress = recovered.state?.validationControlIngress || null
  const control = context.validationControlIngress
  if (control?.sourceMessageDigest) {
    if (context.sourceMessageDigest && context.sourceMessageDigest !== control.sourceMessageDigest) {
      throw new ValidationDagError(
        'VALIDATION_AI_CONFIRMATION_EVIDENCE_MISMATCH',
        'caller-provided message digest does not match the current server-owned user instruction'
      )
    }
    context.sourceMessageDigest = control.sourceMessageDigest
    context.authoritySourceRef = `validation-control:${control.receiptDigest}`
  } else {
    context.authoritySourceRef = context.authoritySourceRef ||
      `ai-hook:codex:${String(env.CODEX_THREAD_ID || context.sessionKey)}:task:${resolvedTaskKey}`
  }
  return context
}

function acceptedValidationStateWrite(status) {
  return ['committed', 'semantic-noop', 'persisted'].includes(status)
}

function exactPendingMatchesPlan(pending, plan, candidate, projectRoot) {
  if (!pending) return false
  try {
    const expected = createPendingBudgetCardBinding({
      plan,
      candidate,
      repoRoot: ROOT,
      project: 'devcodex',
      taskRecoveryKey: pending.taskRecoveryKey,
      hostSessionDigest: pending.hostSessionDigest,
      contextEpoch: pending.contextEpoch,
      stateRevision: pending.stateRevision,
      createdAt: pending.createdAt,
      expiresAt: pending.expiresAt,
      projectRootIdentity: projectRoot
    }, { nowMs: Math.min(Date.now(), Date.parse(pending.expiresAt) - 1) })
    return expected.bindingDigest === pending.bindingDigest
  } catch {
    return false
  }
}

function assertRootReplacementSafe(store, currentRoot, plan, candidate) {
  const root = currentRoot?.rootBudgetConfirmation
  const currentCandidate = candidateBinding(candidate)
  const exactRoot = root &&
    root.planDigest === plan.planDigest &&
    root.budgetDigest === plan.budgetCard.digest &&
    root.candidateId === candidate.candidateId &&
    root.candidateDigest === currentCandidate.candidateDigest
  if (!root || exactRoot) return
  const liveLease = store.readLease()
  if (liveLease.status === 'fresh' && liveLease.lease) {
    throw new ValidationDagError(
      'VALIDATION_BUDGET_CONFIRMATION_CAS_CONFLICT',
      'a different validation root still owns the current task execution lease'
    )
  }
}

function isSubset(current = [], allowed = []) {
  const allowedSet = new Set((allowed || []).map(value => String(value)))
  return (current || []).every(value => allowedSet.has(String(value)))
}

function isStrictGitDescendant(repoRoot, ancestor, descendant) {
  const previous = String(ancestor || '').trim().toLowerCase()
  const current = String(descendant || '').trim().toLowerCase()
  if (!/^[a-f0-9]{40,64}$/.test(previous) || !/^[a-f0-9]{40,64}$/.test(current) || previous === current) {
    return false
  }
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', previous, current], {
      cwd: repoRoot,
      stdio: 'ignore',
      windowsHide: true
    })
    return true
  } catch {
    return false
  }
}

function assessAutoRootRollover({ store, currentRoot, plan, candidate, control, authorityContext, repoRoot = ROOT }) {
  const root = currentRoot?.rootBudgetConfirmation
  if (!root || control?.action !== 'auto-authorize' || root.authorityKind !== 'auto') {
    return { eligible: false, reasonCode: 'auto-root-rollover-authority-missing' }
  }
  if (root.autoAuthorityRef !== control.autoAuthorityRef ||
      root.taskRecoveryKey !== authorityContext.taskRecoveryKey ||
      root.project !== 'devcodex' ||
      root.hostSessionDigest !== control.hostSessionDigest ||
      root.contextEpoch !== authorityContext.contextEpoch ||
      root.revocationEpoch !== currentValidationRevocationEpoch(authorityContext)) {
    return { eligible: false, reasonCode: 'auto-root-rollover-binding-mismatch' }
  }
  const lease = store.readLease()
  if (lease.status === 'fresh' && lease.lease) {
    return { eligible: false, reasonCode: 'auto-root-rollover-live-lease' }
  }
  const terminalRead = store.readTerminal()
  const rootProjectionRead = store.readRootBudgetProjection()
  if (terminalRead.status !== 'fresh' || rootProjectionRead.status !== 'fresh') {
    return { eligible: false, reasonCode: 'auto-root-rollover-parent-state-missing' }
  }
  const terminal = terminalRead.receipt
  if (!['completed', 'failed', 'blocked', 'timed-out', 'cancelled'].includes(String(terminal.terminalStatus || ''))) {
    return { eligible: false, reasonCode: 'auto-root-rollover-parent-not-terminal' }
  }
  const continuationRead = store.readContinuationAuthorization()
  const continuation = continuationRead.continuationAuthorization || null
  const directLineage = terminal.authoritySourceRef === `budget-confirmation:${root.receiptDigest}`
  const continuationLineage = continuation &&
    terminal.authoritySourceRef === `validation-continuation:${continuation.continuationDigest}` &&
    continuation.rootConfirmationDigest === root.receiptDigest
  if (!directLineage && !continuationLineage) {
    return { eligible: false, reasonCode: 'auto-root-rollover-lineage-mismatch' }
  }
  if (!isStrictGitDescendant(repoRoot, terminal.candidateHead, candidate.head)) {
    return { eligible: false, reasonCode: 'auto-root-rollover-head-not-descendant' }
  }
  const projection = rootProjectionRead.rootBudgetProjection
  const selectedNodeIds = (plan.selectedNodes || []).map(node => String(node.id || '')).filter(Boolean)
  const budget = plan.budgetCard || {}
  const sameScope = plan.verificationLevel === root.maxLevel &&
    plan.verificationPurpose === root.purpose &&
    isSubset(plan.affectedBoundaries, projection.affectedBoundaries) &&
    isSubset(selectedNodeIds, projection.selectedNodeIds) &&
    isSubset(budget.heavyNodeIds, projection.heavyNodeIds) &&
    isSubset(budget.sideEffectCategories, projection.sideEffectCategories) &&
    Number(plan.selectedNodeCount || selectedNodeIds.length) <= Number(projection.selectedNodeCount || 0) &&
    Number(budget.estimatedDurationMs || 0) <= Number(projection.estimatedDurationMs || 0) &&
    Number(budget.hardTimeoutUpperBoundMs || 0) <= Number(projection.hardTimeoutUpperBoundMs || 0) &&
    Number(budget.logBudgetBytes || 0) <= Number(projection.logBudgetBytes || 0)
  if (!sameScope) {
    return { eligible: false, reasonCode: 'auto-root-rollover-scope-widened' }
  }
  return {
    eligible: true,
    reasonCode: 'strict-descendant-same-scope',
    parentRootReceiptDigest: root.receiptDigest,
    parentTerminalDigest: terminal.terminalDigest,
    previousCandidateHead: terminal.candidateHead,
    currentCandidateHead: candidate.head
  }
}

function currentValidationRevocationEpoch(authorityContext) {
  return Number(authorityContext.taskState?.validationExecution?.revocationEpoch || 0)
}

function normalizeRepoMutationPath(value) {
  const raw = String(value || '').trim()
  if (!raw || /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return null
  const absolute = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(ROOT, raw)
  const relative = path.relative(ROOT, absolute)
  if (!relative || relative === '.') return null
  if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
    return `outside-root:${absolute.replace(/\\/g, '/')}`
  }
  return relative.replace(/\\/g, '/')
}

function mutationRepairProof(authorityContext, candidate, terminal) {
  const closeout = authorityContext.taskState?.turnLiveness?.lastMutationCloseout || null
  const observation = closeout?.observation || null
  const effects = observation?.observedEffects || {}
  const observedPaths = [
    ...(effects.created || []),
    ...(effects.modified || []),
    ...(effects.deleted || []),
    ...(effects.moved || []).flatMap(item => [item?.source, item?.target])
  ].map(normalizeRepoMutationPath).filter(Boolean)
  const observed = [...new Set(observedPaths)].sort()
  const currentChanged = [...new Set((candidate.changedFiles || []).map(normalizeRepoMutationPath).filter(Boolean))].sort()
  const priorChanged = [...new Set((terminal.candidateChangedFiles || []).map(normalizeRepoMutationPath).filter(Boolean))].sort()
  const currentSet = new Set(currentChanged)
  const priorSet = new Set(priorChanged)
  const observedSet = new Set(observed)
  const unrelatedDirtyFiles = [...new Set([
    ...currentChanged.filter(file => !priorSet.has(file) && !observedSet.has(file)),
    ...observed.filter(file => !currentSet.has(file))
  ])].sort()
  const footprintDigest = String(observation?.plannedSetDigest || '')
  const observationDigest = String(observation?.receiptDigest || '')
  const proven = closeout?.result === 'success' &&
    Array.isArray(closeout.authorizationErrors) && closeout.authorizationErrors.length === 0 &&
    observation?.status === 'consumed' && observation?.observationCoverage === 'complete' &&
    observation?.reconcileRequired !== true && Array.isArray(observation?.drift) && observation.drift.length === 0 &&
    DIGEST_RE.test(footprintDigest) && DIGEST_RE.test(observationDigest) && observed.length > 0 &&
    terminal.candidateChangedFilesTruncated !== true && unrelatedDirtyFiles.length === 0
  return {
    proven,
    footprintDigest,
    observationDigest,
    unrelatedDirtyFiles,
    observedPaths: observed
  }
}

function continuationRetryOrdinal(continuationState, rootConfirmationDigest) {
  const value = continuationState?.continuationAuthorization || null
  if (!value || value.rootConfirmationDigest !== rootConfirmationDigest) return 1
  return Number(value.retryOrdinal || 0) + 1
}

function continuationConsumerEdgeTypes(plan, rootProjection, manifest) {
  const rootIds = new Set(rootProjection.selectedNodeIds || [])
  const releaseIds = new Set(plan.budgetCard?.releaseConsumerNodeIds || [])
  return [...new Set((plan.selectedNodes || [])
    .map(node => String(node.id || ''))
    .filter(id => id && !rootIds.has(id))
    .map(id => {
      if (releaseIds.has(id)) return 'releaseConsumer'
      return manifest?.nodeVerificationPolicies?.[id]?.consumerEdgeType || 'runtimeConsumer'
    }))].sort()
}

function tryResolveAutoContinuation({ plan, candidate, authorityContext, store, currentRoot, control, manifest,
  persist = true }) {
  const root = currentRoot.rootBudgetConfirmation
  if (!root) return { authority: null, fallbackCode: 'root-missing' }
  const rootProjectionRead = store.readRootBudgetProjection()
  const terminalRead = store.readTerminal()
  const continuationRead = store.readContinuationAuthorization()
  if (rootProjectionRead.status !== 'fresh' || terminalRead.status !== 'fresh') {
    return { authority: null, fallbackCode: 'continuation-parent-state-missing' }
  }
  const rootProjection = rootProjectionRead.rootBudgetProjection
  const terminal = terminalRead.receipt
  const parentRecoverable = ['failed', 'blocked', 'timed-out'].includes(terminal.terminalStatus) ||
    (terminal.terminalStatus === 'cancelled' && Number(terminal.nativeExitCode) === 124)
  const terminalRootDigest = terminal.authoritySourceRef === `budget-confirmation:${root.receiptDigest}`
    ? root.receiptDigest
    : continuationRead.continuationAuthorization?.rootConfirmationDigest
  if (terminalRootDigest !== root.receiptDigest) {
    return { authority: null, fallbackCode: 'continuation-parent-root-mismatch', parentRecoverable }
  }
  const proof = mutationRepairProof(authorityContext, candidate, terminal)
  try {
    const rootNodeIds = new Set(rootProjection.selectedNodeIds || [])
    const allowedAddedNodeIds = (plan.selectedNodes || [])
      .map(node => String(node.id || ''))
      .filter(id => id && !rootNodeIds.has(id))
      .sort()
    const authorization = createValidationContinuationAuthorization({
      rootConfirmation: root,
      rootBudgetProjection: rootProjection,
      newPlan: plan,
      parentRunIdentity: terminal.runIdentity,
      parentTerminal: terminal,
      originalAuthorityRef: terminal.authoritySourceRef,
      taskRecoveryKey: authorityContext.taskRecoveryKey,
      project: 'devcodex',
      projectRootIdentity: root.projectRootIdentity,
      hostSessionDigest: root.hostSessionDigest,
      oldContextEpoch: terminal.runIdentity?.contextEpoch,
      newContextEpoch: authorityContext.contextEpoch,
      continuationReceiptDigest: control.receiptDigest,
      repairMutationFootprintDigest: proof.footprintDigest,
      repairObservationReceiptDigest: proof.observationDigest,
      repairFootprintProven: proof.proven,
      repairProofKind: proof.proven ? 'mutation-observation' : 'same-scope-retry',
      newCandidate: candidate,
      allowedAddedNodeIds,
      addedConsumerEdgeTypes: continuationConsumerEdgeTypes(plan, rootProjection, manifest),
      unrelatedDirtyFiles: proof.unrelatedDirtyFiles,
      retryOrdinal: continuationRetryOrdinal(continuationRead, root.receiptDigest),
      revocationEpoch: currentValidationRevocationEpoch(authorityContext)
    }, {
      serverOwnedContextContinuationReceiptDigest: control.receiptDigest
    })
    if (persist) {
      const write = store.writeContinuationAuthorization(authorization, {
        expectedContinuationDigest: continuationRead.continuationAuthorization?.continuationDigest || null
      })
      if (!acceptedValidationStateWrite(write.status)) {
        throw new ValidationDagError(write.errorCode || 'VALIDATION_CONTINUATION_PERSISTENCE_FAILED',
          'failed to persist and read back the bounded validation continuation', write)
      }
    }
    return { authority: authorization, fallbackCode: null, parentRecoverable }
  } catch (error) {
    if (error instanceof ValidationDagError) throw error
    if (String(error?.code || '').startsWith('VALIDATION_CONTINUATION_')) {
      return { authority: null, fallbackCode: error.code, parentRecoverable }
    }
    throw error
  }
}

function resolveAiBudgetAuthority({ options, plan, candidate, authorityContext, activeRoot, execute, manifest = null }) {
  if (!authorityContext.taskIdentity || !authorityContext.sessionKey || !authorityContext.taskRecoveryKey) {
    throw new ValidationDagError('VALIDATION_AI_TASK_BINDING_REQUIRED', 'AI BudgetCard authority requires one current formal task session')
  }
  const projectRoot = validationProjectRootIdentity(ROOT)
  const control = authorityContext.validationControlIngress
  const store = createValidationEvidenceStore({
    activeRoot,
    project: 'devcodex',
    actorType: 'ai-hook',
    taskIdentity: authorityContext.taskIdentity,
    taskRecoveryKey: authorityContext.taskRecoveryKey,
    sessionKey: authorityContext.sessionKey
  })
  const currentPending = store.readPendingBudgetCard()
  const currentRoot = store.readRootBudgetConfirmation()
  const revocationEpoch = currentValidationRevocationEpoch(authorityContext)
  const controlValidation = validateValidationControlIngressReceipt(control, {
    taskRecoveryKey: authorityContext.taskRecoveryKey,
    project: 'devcodex',
    projectRootIdentity: projectRoot,
    contextEpoch: authorityContext.contextEpoch
  }, { now: Number.isFinite(options.nowMs) ? options.nowMs : Date.now() })
  const expiredRootContinuation = control?.action === 'auto-authorize' &&
    controlValidation.errors.length === 1 &&
    controlValidation.errors[0] === 'validation-control-ingress-expired' &&
    currentRoot.status === 'fresh' &&
    currentRoot.rootBudgetConfirmation?.revocationEpoch === revocationEpoch
  const rootRollover = assessAutoRootRollover({
    store,
    currentRoot,
    plan,
    candidate,
    control,
    authorityContext
  })
  if (!controlValidation.valid && !expiredRootContinuation) {
    if (!execute) {
      return {
        plan,
        authority: null,
        decision: 'plan-only-control-unavailable',
        controlErrors: controlValidation.errors
      }
    }
    throw new ValidationDagError(
      'VALIDATION_AI_CONTROL_INGRESS_REQUIRED',
      'AI validation execution requires the current server-owned user/Auto control receipt',
      { errors: controlValidation.errors }
    )
  }
  if (control.action === 'revoke') {
    throw new ValidationDagError('VALIDATION_CONTINUATION_REVOKED', 'validation execution is paused or revoked by the current user instruction')
  }
  if (plan.verificationLevel === 'V3' || ['full-audit', 'release'].includes(plan.verificationPurpose)) {
    throw new ValidationDagError(
      'VALIDATION_INDEPENDENT_V3_AUTHORITY_REQUIRED',
      'V3/full/release validation cannot inherit scoped Auto or current-card continuation authority'
    )
  }
  const currentCandidate = candidateBinding(candidate)
  if (currentRoot.status === 'fresh' && currentRoot.rootBudgetConfirmation?.budgetDigest === plan.budgetCard.digest &&
      currentRoot.rootBudgetConfirmation?.planDigest === plan.planDigest &&
      currentRoot.rootBudgetConfirmation?.candidateId === candidate.candidateId &&
      currentRoot.rootBudgetConfirmation?.candidateDigest === currentCandidate.candidateDigest &&
      currentRoot.rootBudgetConfirmation.revocationEpoch === revocationEpoch) {
    if (control.action === 'auto-authorize') {
      const continuation = tryResolveAutoContinuation({
        plan, candidate, authorityContext, store, currentRoot, control, manifest, persist: execute
      })
      if (continuation.authority) {
        if (!execute) {
          return {
            plan,
            authority: null,
            store,
            control,
            decision: 'root-continuation-plan-only'
          }
        }
        return {
          plan: approvePlanFromBudgetAuthority(plan, continuation.authority),
          authority: continuation.authority,
          store,
          control,
          decision: 'auto-continuation-authorized'
        }
      }
      if (continuation.parentRecoverable && continuation.fallbackCode !== 'continuation-parent-state-missing') {
        throw new ValidationDagError(
          continuation.fallbackCode || 'VALIDATION_CONTINUATION_UNAVAILABLE',
          'the failed validation root cannot be replayed without a bounded continuation'
        )
      }
    }
    const rootRefresh = store.writeRootBudgetConfirmation(currentRoot.rootBudgetConfirmation, {
      expectedRootReceiptDigest: currentRoot.rootBudgetConfirmation.receiptDigest,
      rootBudgetProjection: planBudgetProjection(plan)
    })
    if (!acceptedValidationStateWrite(rootRefresh.status)) {
      throw new ValidationDagError(rootRefresh.errorCode || 'VALIDATION_BUDGET_CONFIRMATION_CAS_CONFLICT',
        'failed to verify the immutable root BudgetCard projection', rootRefresh)
    }
    return {
      plan: approvePlanFromBudgetAuthority(plan, currentRoot.rootBudgetConfirmation),
      authority: currentRoot.rootBudgetConfirmation,
      store,
      control,
      decision: 'root-replay-or-reconcile'
    }
  }
  const currentPendingExact = currentPending.status === 'fresh' &&
    exactPendingMatchesPlan(currentPending.pendingBudgetCard, plan, candidate, projectRoot)
  const pendingInput = {
    plan,
    candidate,
    repoRoot: ROOT,
    projectRootIdentity: projectRoot,
    project: 'devcodex',
    taskRecoveryKey: authorityContext.taskRecoveryKey,
    hostSessionDigest: control.hostSessionDigest,
    contextEpoch: authorityContext.contextEpoch,
    stateRevision: currentPendingExact
      ? currentPending.pendingBudgetCard.stateRevision
      : (currentPending.status === 'fresh'
      ? Number(currentPending.pendingBudgetCard.stateRevision || 0) + 1
      : 1)
  }

  if (control.action === 'confirm-current-budget') {
    if (currentPending.status !== 'fresh' ||
        !exactPendingMatchesPlan(currentPending.pendingBudgetCard, plan, candidate, projectRoot)) {
      throw new ValidationDagError(
        currentPending.status === 'fresh' ? 'VALIDATION_PENDING_BUDGET_STALE' : 'VALIDATION_PENDING_BUDGET_MISSING',
        'the current confirmation does not match one previously displayed exact BudgetCard'
      )
    }
    if (!execute) {
      return { plan, authority: null, store, control, decision: 'confirmation-ready' }
    }
    const receipt = createBudgetConfirmationReceipt({
      pendingBudgetCard: currentPending.pendingBudgetCard,
      authorityKind: 'user-confirmation',
      sourceMessageDigest: control.sourceMessageDigest,
      revocationEpoch
    }, {
      currentUserInstruction: true,
      currentSourceMessageDigest: control.sourceMessageDigest
    })
    assertRootReplacementSafe(store, currentRoot, plan, candidate)
    const write = store.writeRootBudgetConfirmation(receipt, {
      expectedRootReceiptDigest: currentRoot.rootBudgetConfirmation?.receiptDigest || null,
      rootBudgetProjection: planBudgetProjection(plan)
    })
    if (!acceptedValidationStateWrite(write.status)) {
      throw new ValidationDagError(write.errorCode || 'VALIDATION_BUDGET_CONFIRMATION_CAS_CONFLICT',
        'failed to persist and read back the current BudgetCard confirmation', write)
    }
    return { plan: approvePlanFromBudgetAuthority(plan, receipt), authority: receipt, store, control, decision: 'user-confirmed' }
  }

  if (control.action === 'auto-authorize') {
    if (!execute) {
      if (currentRoot.status === 'fresh') {
        const continuation = tryResolveAutoContinuation({
          plan, candidate, authorityContext, store, currentRoot, control, manifest, persist: false
        })
        if (continuation.authority) {
          return { plan, authority: null, store, control, decision: 'root-continuation-plan-only' }
        }
        const rootRevocationEpochChanged = currentRoot.rootBudgetConfirmation &&
          currentRoot.rootBudgetConfirmation.revocationEpoch !== revocationEpoch
        if (continuation.parentRecoverable && !rootRevocationEpochChanged && !rootRollover.eligible) {
          throw new ValidationDagError(
            continuation.fallbackCode || 'VALIDATION_CONTINUATION_UNAVAILABLE',
            'the failed validation root cannot be replaced by a new Auto root'
          )
        }
      }
      if (expiredRootContinuation && !rootRollover.eligible) {
        throw new ValidationDagError(
          'VALIDATION_FRESH_CONTROL_REQUIRED',
          'expired Auto ingress can continue its immutable root but cannot create or replace a root'
        )
      }
      assertRootReplacementSafe(store, currentRoot, plan, candidate)
      const previewPending = currentPendingExact
        ? currentPending.pendingBudgetCard
        : createPendingBudgetCardBinding(pendingInput)
      const previewWrite = store.writePendingBudgetCard(previewPending, {
        expectedBindingDigest: currentPending.pendingBudgetCard?.bindingDigest || null,
        expectedStateRevision: currentPending.pendingBudgetCard?.stateRevision
      })
      if (!acceptedValidationStateWrite(previewWrite.status)) {
        throw new ValidationDagError(previewWrite.errorCode || 'VALIDATION_BUDGET_CONFIRMATION_CAS_CONFLICT',
          'failed to persist the exact Auto BudgetCard preview', previewWrite)
      }
      return {
        plan,
        authority: null,
        store,
        control,
        pending: previewPending,
        decision: rootRollover.eligible ? 'auto-root-rollover-plan-only' : 'auto-ready-plan-only'
      }
    }
    const continuation = currentRoot.status === 'fresh'
      ? tryResolveAutoContinuation({ plan, candidate, authorityContext, store, currentRoot, control, manifest })
      : { authority: null, fallbackCode: 'root-missing' }
    if (continuation.authority) {
      return {
        plan: approvePlanFromBudgetAuthority(plan, continuation.authority),
        authority: continuation.authority,
        store,
        control,
        decision: 'auto-continuation-authorized'
      }
    }
    const rootRevocationEpochChanged = currentRoot.rootBudgetConfirmation &&
      currentRoot.rootBudgetConfirmation.revocationEpoch !== revocationEpoch
    if (continuation.parentRecoverable && !rootRevocationEpochChanged && !rootRollover.eligible) {
      throw new ValidationDagError(
        continuation.fallbackCode || 'VALIDATION_CONTINUATION_UNAVAILABLE',
        'the failed validation root cannot be replaced by a new Auto root'
      )
    }
    if (expiredRootContinuation && !rootRollover.eligible) {
      throw new ValidationDagError(
        'VALIDATION_FRESH_CONTROL_REQUIRED',
        'expired Auto ingress can continue its immutable root but cannot create or replace a root'
      )
    }
    assertRootReplacementSafe(store, currentRoot, plan, candidate)
    const pending = currentPendingExact
      ? currentPending.pendingBudgetCard
      : createPendingBudgetCardBinding(pendingInput)
    const pendingWrite = store.writePendingBudgetCard(pending, {
      expectedBindingDigest: currentPending.pendingBudgetCard?.bindingDigest || null,
      expectedStateRevision: currentPending.pendingBudgetCard?.stateRevision
    })
    if (!acceptedValidationStateWrite(pendingWrite.status)) {
      throw new ValidationDagError(pendingWrite.errorCode || 'VALIDATION_BUDGET_CONFIRMATION_CAS_CONFLICT',
        'failed to persist the exact Auto BudgetCard', pendingWrite)
    }
    const receipt = createBudgetConfirmationReceipt({
      pendingBudgetCard: pending,
      authorityKind: 'auto',
      autoAuthorityRef: control.autoAuthorityRef,
      ...(rootRollover.eligible
        ? {
            parentRootReceiptDigest: rootRollover.parentRootReceiptDigest,
            parentTerminalDigest: rootRollover.parentTerminalDigest,
            rootRolloverReason: rootRollover.reasonCode
          }
        : {}),
      revocationEpoch
    }, { serverOwnedAutoAuthorityRef: control.autoAuthorityRef })
    const rootWrite = store.writeRootBudgetConfirmation(receipt, {
      expectedRootReceiptDigest: currentRoot.rootBudgetConfirmation?.receiptDigest || null,
      rootBudgetProjection: planBudgetProjection(plan)
    })
    if (!acceptedValidationStateWrite(rootWrite.status)) {
      throw new ValidationDagError(rootWrite.errorCode || 'VALIDATION_BUDGET_CONFIRMATION_CAS_CONFLICT',
        'failed to persist and read back the server-owned Auto BudgetCard receipt', rootWrite)
    }
    return {
      plan: approvePlanFromBudgetAuthority(plan, receipt),
      authority: receipt,
      store,
      control,
      decision: rootRollover.eligible ? 'auto-root-rollover-authorized' : 'auto-authorized',
      continuationFallbackCode: continuation.fallbackCode
    }
  }

  if (!plan.budgetCard.confirmationRequired) {
    return { plan, authority: null, store, control, decision: 'scoped-current-instruction' }
  }
  const pending = currentPendingExact
    ? currentPending.pendingBudgetCard
    : createPendingBudgetCardBinding(pendingInput)
  const pendingWrite = store.writePendingBudgetCard(pending, {
    expectedBindingDigest: currentPending.pendingBudgetCard?.bindingDigest || null,
    expectedStateRevision: currentPending.pendingBudgetCard?.stateRevision
  })
  if (!acceptedValidationStateWrite(pendingWrite.status)) {
    throw new ValidationDagError(pendingWrite.errorCode || 'VALIDATION_BUDGET_CONFIRMATION_CAS_CONFLICT',
      'failed to persist the exact pending BudgetCard', pendingWrite)
  }
  if (execute) {
    throw new ValidationDagError('VALIDATION_BUDGET_APPROVAL_REQUIRED', 'the exact validation budget requires current-card confirmation', {
      budgetCard: plan.budgetCard,
      nextStep: '回复“确认当前验证卡”；无需复制摘要或 digest。'
    })
  }
  return { plan, authority: null, store, control, pending, decision: 'awaiting-current-budget-confirmation' }
}

function resolveValidationBudgetAuthority(input) {
  if (input.actorType !== 'ai-hook') {
    return { plan: input.plan, authority: null, decision: 'legacy-or-policy-authority' }
  }
  return resolveAiBudgetAuthority(input)
}

function createCliLease({ options, plan, candidate, actorType, authorityContext, budgetAuthority = null }) {
  if (options.leasePath) {
    const externalLease = JSON.parse(fs.readFileSync(options.leasePath, 'utf8'))
    if (externalLease.actorType !== actorType) {
      throw new ValidationDagError(
        'VALIDATION_EXTERNAL_LEASE_ACTOR_MISMATCH',
        `the current ${actorType} invocation cannot consume a ${externalLease.actorType || 'unknown'} lease`
      )
    }
    return externalLease
  }
  const executionContext = authorityContext || {
    authoritySourceRef: options.authoritySourceRef || process.env.DEVCODEX_VALIDATION_AUTHORITY_SOURCE || null,
    contextEpoch: options.contextEpoch || process.env.DEVCODEX_CONTEXT_EPOCH || null,
    sourceMessageDigest: options.sourceMessageDigest || process.env.DEVCODEX_SOURCE_MESSAGE_DIGEST || null,
    taskRecoveryKey: options.taskRecoveryKey || process.env.DEVCODEX_TASK_RECOVERY_KEY || null
  }
  if (plan.budgetCard.confirmationRequired && plan.budgetCard.status !== 'approved') {
    throw new ValidationDagError('VALIDATION_BUDGET_APPROVAL_REQUIRED', 'the exact validation budget must be confirmed before authority is issued', {
      planDigest: plan.planDigest,
      budgetCard: plan.budgetCard
    })
  }
  if (actorType === 'human-cli' && !(process.stdin.isTTY && process.stdout.isTTY)) {
    throw new ValidationDagError(
      'VALIDATION_HUMAN_ATTESTATION_REQUIRED',
      'non-interactive execution must use an externally issued lease or trusted CI/release policy authority'
    )
  }
  if (actorType === 'ai-hook' && !DIGEST_RE.test(String(executionContext.sourceMessageDigest || ''))) {
    throw new ValidationDagError(
      'VALIDATION_AI_CONFIRMATION_EVIDENCE_REQUIRED',
      'AI validation execution requires the exact current user-confirmation message digest',
      { nextStep: 'Pass --source-message-digest for the message that confirmed this exact BudgetCard.' }
    )
  }
  if (['trusted-ci', 'release-pipeline'].includes(actorType)) {
    const expectedSource = ciAuthoritySource(process.env)
    const expectedPolicy = expectedCiPolicyDigest(actorType, plan, process.env)
    if (process.env.GITHUB_ACTIONS !== 'true' || !expectedPolicy ||
        options.authoritySourceRef !== expectedSource || options.policyDigest !== expectedPolicy) {
      throw new ValidationDagError(
        'VALIDATION_CI_POLICY_MISMATCH',
        'CI execution authority must match the current immutable workflow, ref, commit, level and purpose'
      )
    }
  }
  const authorityClass = plan.verificationPurpose === 'release'
    ? 'release'
    : (plan.verificationLevel === 'V3' ? 'full-audit' : 'scoped')
  const budgetAuthorityRef = budgetAuthority?.schemaVersion === 'BudgetConfirmationReceiptV1'
    ? `budget-confirmation:${budgetAuthority.receiptDigest}`
    : (budgetAuthority?.schemaVersion === 'ValidationContinuationAuthorizationV1'
        ? `validation-continuation:${budgetAuthority.continuationDigest}`
        : null)
  const authoritySourceRef = budgetAuthorityRef || executionContext.authoritySourceRef || (
    actorType === 'human-cli'
      ? `cli:tty:${process.pid}:${ROOT}`
      : (['trusted-ci', 'release-pipeline'].includes(actorType) ? ciAuthoritySource() : '')
  )
  return createVerificationExecutionLease({
    actorType,
    authorityClass,
    actorIdentityEvidence: directActorIdentityEvidence(actorType),
    repoRoot: ROOT,
    plan,
    candidate,
    project: 'devcodex',
    taskRecoveryKey: executionContext.taskRecoveryKey,
    contextEpoch: executionContext.contextEpoch,
    authoritySourceRef,
    sourceMessageDigest: executionContext.sourceMessageDigest,
    policyDigest: options.policyDigest || process.env.DEVCODEX_VALIDATION_POLICY_DIGEST || null,
    revocationEpoch: Number.isInteger(budgetAuthority?.revocationEpoch)
      ? budgetAuthority.revocationEpoch
      : currentValidationRevocationEpoch(authorityContext || {})
  })
}

async function main(argv = process.argv.slice(2)) {
  const wantsJson = argv.includes('--json')
  try {
    const options = parseArgs(argv)
    if (options.help) {
      if (options.json) printJson(envelope(true, { help: true, routes: REQUIRED_ROUTES }, null))
      else printHelp()
      return 0
    }
    const manifest = readValidationManifest(options.manifestPath)
    const actorType = resolveActorType(options.actorType)
    const activeRoot = process.env.DEVCODEX_VALIDATION_ACTIVE_ROOT
      ? path.resolve(process.env.DEVCODEX_VALIDATION_ACTIVE_ROOT)
      : resolveActiveRuntimeRoot(ROOT)
    const authorityContext = resolveValidationAuthorityContext({
      actorType,
      options,
      activeRoot,
      env: process.env
    })
    const featureDecision = resolveExecutionFeatureDecisionForCwd({
      cwd: ROOT,
      activeRoot,
      featureId: 'validation-changed-scope'
    })
    const routeForMode = options.route
    const candidate = buildCandidateIdentity({
      repoRoot: ROOT,
      explicitChangedFiles: options.changedSpecified ? options.changedFiles : null,
      narrativeMarkdownExclusions: manifest.narrativeMarkdownExclusions
    })
    let plan = planValidation({
      manifest,
      route: routeForMode,
      changedFiles: candidate.changedFiles,
      changedSource: candidate.changedSource,
      riskClass: options.riskClass,
      candidateStable: candidate.stable,
      candidateId: candidate.candidateId,
      purpose: options.purpose,
      level: options.level,
      affectedBoundaries: options.affectedBoundaries,
      releaseAuthorized: options.releaseAuthorized,
      explicitFullAudit: options.explicitFullAudit,
      requesterClass: actorType,
      project: 'devcodex',
      taskRecoveryKey: authorityContext.taskRecoveryKey,
      contextEpoch: authorityContext.contextEpoch,
      requestSourceRef: authorityContext.authoritySourceRef || (options.releaseAuthorized
        ? 'cli:explicit-release-authorization'
        : (options.explicitFullAudit ? 'cli:explicit-full-audit-request' : `cli:route:${options.route}`)),
      approvePlanDigest: options.approvePlanDigest
    })
    const budgetAuthorityResolution = resolveValidationBudgetAuthority({
      options,
      plan,
      candidate,
      actorType,
      authorityContext,
      activeRoot,
      manifest,
      execute: !options.planOnly && plan.selectedNodeCount > 0
    })
    plan = budgetAuthorityResolution.plan
    const optimizationProjection = {
      mode: featureDecision.configurationMode,
      lifecycleState: featureDecision.lifecycleState,
      stateStatus: featureDecision.stateStatus,
      reasonCode: featureDecision.reasonCode,
      routeInput: options.route,
      routeApplied: routeForMode,
      fallback: null,
      precisionStatus: featureDecision.optimizationAllowed
        ? 'enabled'
        : 'explicit-route-retained-cache-disabled'
    }

    if (options.planOnly) {
      const data = {
        manifestIdentity: manifestIdentity(manifest),
        plan: compactPlan(plan, optimizationProjection),
        budgetAuthority: {
          decision: budgetAuthorityResolution.decision,
          authoritySchema: budgetAuthorityResolution.authority?.schemaVersion || null,
          authorityDigest: budgetAuthorityResolution.authority?.receiptDigest ||
            budgetAuthorityResolution.authority?.continuationDigest || null,
          pendingDigest: budgetAuthorityResolution.pending?.bindingDigest || null,
          controlErrors: budgetAuthorityResolution.controlErrors || []
        }
      }
      if (options.json) printJson(envelope(true, data, null))
      else {
        process.stdout.write('Validation plan: ' + options.route + ' -> ' + plan.routeResolved + '\n')
        process.stdout.write('Intent: ' + plan.verificationLevel + '/' + plan.verificationPurpose +
          ' state=' + plan.executionState + ' claim=' + plan.claimCeiling + '\n')
        if (plan.affectedBoundaries.length) process.stdout.write('Boundaries: ' + plan.affectedBoundaries.join(', ') + '\n')
        process.stdout.write('Layer: ' + plan.validationLayer + ' budget=' + plan.budget.selectionRatio +
          ' estimatedMs=' + plan.budget.estimatedDurationMs + ' confidence=' + plan.budget.estimateConfidence +
          ' timeoutUpperMs=' + plan.budget.hardTimeoutUpperBoundMs + '\n')
        if (plan.budgetCard.nextStep) process.stdout.write('Budget next: ' + plan.budgetCard.nextStep + '\n')
        if (plan.executionBlockers.length) process.stdout.write('Blockers: ' +
          plan.executionBlockers.map(item => item.code).join(', ') + '\n')
        process.stdout.write('Selected (' + plan.selectedNodeCount + '): ' +
          plan.selectedNodes.map(node => node.id).join(', ') + '\n')
      }
      return 0
    }

    if (plan.selectedNodeCount === 0 && plan.executionBlockers.length === 0) {
      const data = {
        manifestIdentity: manifestIdentity(manifest),
        plan: compactPlan(plan, optimizationProjection),
        noExecution: true
      }
      if (options.json) printJson(envelope(true, data, null))
      else process.stdout.write('Validation complete: no executable nodes for the recognized changed scope.\n')
      return 0
    }

    const onNode = options.json ? null : result => {
      const marker = result.status === 'passed' ? '✓' : (result.status === 'cache-hit' ? '↺' : '✗')
      process.stdout.write(marker + ' ' + result.nodeId + ' [' + result.status + '] ' +
        Number(result.durationMs || 0) + 'ms\n')
      if (result.status === 'failed') {
        if (result.stdout) process.stderr.write(result.stdout + '\n')
        if (result.stderr) process.stderr.write(result.stderr + '\n')
      }
    }
    const lease = createCliLease({
      options,
      plan,
      candidate,
      actorType,
      authorityContext,
      budgetAuthority: budgetAuthorityResolution.authority
    })
    const execution = await runManagedValidation({
      manifest,
      plan,
      candidate,
      repoRoot: ROOT,
      activeRoot,
      lease,
      actorType,
      project: 'devcodex',
      taskRecoveryKey: plan.verificationIntent.taskRecoveryKey,
      contextEpoch: plan.verificationIntent.contextEpoch,
      taskIdentity: authorityContext.taskIdentity,
      sessionKey: authorityContext.sessionKey || '',
      revocationEpoch: lease.revocationEpoch,
      useCache: options.useCache && featureDecision.optimizationAllowed,
      onNode
    })
    const failed = execution.receipt.nativeExitCode !== 0
    const data = { receipt: execution.receipt, persistence: execution.persistence, executionOptimization: optimizationProjection }
    if (options.json) {
      printJson(envelope(!failed, data, failed
        ? errorPayload(new ValidationDagError('VALIDATION_NODE_FAILED',
          'validation node failed: ' + execution.receipt.failedNode),
        'Fix the failing node and rerun the same route; do not reuse failed evidence.')
        : null))
    } else if (!failed) {
      process.stdout.write('Validation passed: route=' + execution.receipt.routeResolved +
        ' selected=' + execution.receipt.selectedNodeCount +
        ' executed=' + execution.receipt.executionCount +
        ' cacheHits=' + execution.receipt.cacheHitCount +
        ' runId=' + execution.receipt.runId + '\n')
    }
    return failed ? 1 : 0
  } catch (error) {
    const nextStep = error.details?.nextStep || error.details?.budgetCard?.nextStep ||
      (Array.isArray(error.details?.blockers) && error.details.blockers.length
        ? 'Resolve: ' + error.details.blockers.map(item => item.code).join(', ')
        : 'Check the manifest, intent, boundary, risk and changed paths; contract errors exit with code 2.')
    const payload = errorPayload(error, nextStep)
    if (wantsJson) printJson(envelope(false, null, payload))
    else process.stderr.write(payload.code + ': ' + payload.message + '\nNext: ' + payload.nextStep + '\n')
    return 2
  }
}

if (require.main === module) {
  main().then(code => { process.exitCode = code }).catch(error => {
    process.stderr.write((error.code || 'VALIDATION_ERROR') + ': ' + error.message + '\n')
    process.exitCode = 2
  })
}

module.exports = {
  CLI_SCHEMA,
  compactPlan,
  createCliLease,
  directActorIdentityEvidence,
  detectedActorType,
  envelope,
  expectedCiPolicyDigest,
  main,
  parseArgs,
  resolveAiBudgetAuthority,
  resolveValidationBudgetAuthority,
  resolveValidationAuthorityContext,
  resolveActorType
}
