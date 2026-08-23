'use strict'

const path = require('path')
const { execFileSync: defaultExecFileSync } = require('child_process')

const COMMIT_RE = /^[a-f0-9]{40}$/
const COLLABORATION_MODES = new Set(['solo', 'team', 'unverified'])
const BRANCH_POLICIES = new Set(['keep-current', 'no-auto-branch', 'explicit-exception'])
const WORKTREE_POLICIES = new Set(['explicit-only', 'team-policy-unverified'])
const SCENARIOS = new Set(['same-branch', 'cross-branch-selective', 'whole-linear-history', 'branch-exception'])
const INTEGRATION_POLICIES = new Set(['none', 'ordered-cherry-pick', 'ff-only-explicit'])
const ACTION_KINDS = new Set(['branch-create', 'switch', 'commit', 'cherry-pick', 'merge-ff-only', 'push'])
const AUTHORIZATION_STATES = new Set(['pending', 'explicit-confirmed', 'completed'])
const CONFLICT_STATES = new Set(['none', 'detected', 'resolved', 'unverified'])
const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])
const DEFAULT_GIT_COMMAND_TIMEOUT_MS = 3000
const DEFAULT_GIT_INSPECTION_BUDGET_MS = 10000
const INPUT_KEYS = new Set([
  'schemaVersion', 'repoRoot', 'headBranch', 'headCommit', 'detached', 'dirtySummary', 'collaborationMode',
  'collaborationEvidenceRefs', 'branchPolicy', 'worktreePolicy', 'scenario', 'integrationPolicy',
  'targetBranch', 'sourceCommitIds', 'targetBefore', 'targetAfter', 'conflictStatus',
  'postIntegrationValidationRefs', 'plannedActions', 'validation'
])
const SERIALIZED_KEYS = Object.freeze([...INPUT_KEYS])

function text(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function textList(value, { nonEmpty = false } = {}) {
  return Array.isArray(value) && (!nonEmpty || value.length > 0) && value.every(text) && new Set(value).size === value.length
}

function hasExactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function timeoutError(message) {
  const error = new Error(message)
  error.code = 'ETIMEDOUT'
  return error
}

function summarizePorcelain(output) {
  const summary = { clean: true, staged: 0, tracked: 0, untracked: 0, conflicted: 0 }
  for (const rawLine of String(output || '').split(/\r?\n/)) {
    if (!rawLine) continue
    const code = rawLine.slice(0, 2)
    if (code === '??' || code === '!!') summary.untracked += 1
    else if (CONFLICT_CODES.has(code) || code.includes('U')) summary.conflicted += 1
    else {
      if (code[0] && code[0] !== ' ') summary.staged += 1
      if (code[1] && code[1] !== ' ') summary.tracked += 1
    }
  }
  summary.clean = summary.staged + summary.tracked + summary.untracked + summary.conflicted === 0
  return summary
}

function inspectGitRepository(cwd, options = {}) {
  const execFileSync = options.execFileSync || defaultExecFileSync
  const now = typeof options.now === 'function' ? options.now : Date.now
  const timeoutMs = Number.isInteger(options.timeoutMs)
    ? Math.max(100, options.timeoutMs)
    : DEFAULT_GIT_COMMAND_TIMEOUT_MS
  const totalBudgetMs = Number.isInteger(options.totalBudgetMs)
    ? Math.max(100, options.totalBudgetMs)
    : DEFAULT_GIT_INSPECTION_BUDGET_MS
  const startedAt = now()
  const run = args => {
    const remainingMs = totalBudgetMs - (now() - startedAt)
    if (remainingMs < 100) throw timeoutError(`Git inspection exceeded ${totalBudgetMs}ms total budget`)
    return String(execFileSync('git', args, {
      cwd: path.resolve(cwd),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: Math.min(timeoutMs, remainingMs),
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true
    })).trim()
  }
  const repoRoot = path.resolve(run(['rev-parse', '--show-toplevel']))
  const headCommit = run(['rev-parse', 'HEAD']).toLowerCase()
  let headBranch = null
  try {
    headBranch = run(['symbolic-ref', '--quiet', '--short', 'HEAD']) || null
  } catch (error) {
    if (error?.status === 1) headBranch = null
    else throw error
  }
  const dirtySummary = summarizePorcelain(run([
    'status', '--porcelain=v1', '--untracked-files=normal', '--ignored=matching'
  ]))
  return {
    repoRoot,
    headBranch,
    headCommit,
    detached: headBranch === null,
    dirtySummary,
    evidenceRefs: ['git:rev-parse-root', 'git:rev-parse-head', 'git:symbolic-ref-head', 'git:status-porcelain-v1']
  }
}

function normalizeAction(action) {
  return {
    kind: action?.kind,
    reason: action?.reason,
    impact: action?.impact,
    alternative: action?.alternative,
    target: action?.target,
    recovery: action?.recovery,
    authorization: action?.authorization,
    authorizationEvidenceRefs: action?.authorizationEvidenceRefs ?? [],
    executionEvidenceRefs: action?.executionEvidenceRefs ?? []
  }
}

function validateGitExecutionContext(input = {}) {
  const errors = []
  const serializedValidationProvided = Object.prototype.hasOwnProperty.call(input, 'validation')
  for (const key of Object.keys(input)) {
    if (!INPUT_KEYS.has(key)) errors.push(`unsupported-field:${key}`)
  }
  if (serializedValidationProvided && !hasExactKeys(input, SERIALIZED_KEYS)) errors.push('serialized-fields-invalid')
  if (input.schemaVersion !== 'GitExecutionContextV1') errors.push('schemaVersion-invalid')
  if (!text(input.repoRoot) || !path.isAbsolute(input.repoRoot)) errors.push('repoRoot-must-be-absolute')
  if (!COMMIT_RE.test(String(input.headCommit || ''))) errors.push('headCommit-invalid')
  if (typeof input.detached !== 'boolean') errors.push('detached-required')
  if (input.detached === true && input.headBranch !== null) errors.push('detached-headBranch-must-be-null')
  if (input.detached === false && !text(input.headBranch)) errors.push('attached-headBranch-required')
  if (!COLLABORATION_MODES.has(input.collaborationMode)) errors.push('collaborationMode-invalid')
  if (!textList(input.collaborationEvidenceRefs, { nonEmpty: true })) errors.push('collaborationEvidenceRefs-required')
  if (!BRANCH_POLICIES.has(input.branchPolicy)) errors.push('branchPolicy-invalid')
  if (!WORKTREE_POLICIES.has(input.worktreePolicy)) errors.push('worktreePolicy-invalid')
  if (!SCENARIOS.has(input.scenario)) errors.push('scenario-invalid')
  if (!INTEGRATION_POLICIES.has(input.integrationPolicy)) errors.push('integrationPolicy-invalid')
  if (!CONFLICT_STATES.has(input.conflictStatus)) errors.push('conflictStatus-invalid')
  if (!textList(input.sourceCommitIds || [])) errors.push('sourceCommitIds-invalid')
  if (!textList(input.postIntegrationValidationRefs || [])) errors.push('postIntegrationValidationRefs-invalid')
  const sourceCommitIds = Array.isArray(input.sourceCommitIds) ? input.sourceCommitIds.slice() : []
  if (sourceCommitIds.some(commitId => !COMMIT_RE.test(commitId))) errors.push('sourceCommitIds-invalid')
  if (new Set(sourceCommitIds).size !== sourceCommitIds.length) errors.push('sourceCommitIds-must-be-unique-and-ordered')
  for (const [field, value] of [['targetBefore', input.targetBefore], ['targetAfter', input.targetAfter]]) {
    if (!(value === null || COMMIT_RE.test(String(value || '')))) errors.push(`${field}-invalid`)
  }

  const dirty = input.dirtySummary
  if (!dirty || typeof dirty !== 'object' || Array.isArray(dirty)) errors.push('dirtySummary-required')
  else {
    const expectedKeys = ['clean', 'staged', 'tracked', 'untracked', 'conflicted']
    if (Object.keys(dirty).sort().join('|') !== expectedKeys.sort().join('|')) errors.push('dirtySummary-fields-invalid')
    for (const field of ['staged', 'tracked', 'untracked', 'conflicted']) {
      if (!Number.isInteger(dirty[field]) || dirty[field] < 0) errors.push(`dirtySummary.${field}-invalid`)
    }
    if (typeof dirty.clean !== 'boolean') errors.push('dirtySummary.clean-invalid')
    const count = ['staged', 'tracked', 'untracked', 'conflicted'].reduce((sum, field) => sum + (Number.isInteger(dirty[field]) ? dirty[field] : 0), 0)
    if (dirty.clean !== (count === 0)) errors.push('dirtySummary.clean-count-mismatch')
  }

  const actions = Array.isArray(input.plannedActions) ? input.plannedActions.map(normalizeAction) : []
  if (!Array.isArray(input.plannedActions)) errors.push('plannedActions-invalid')
  const actionKinds = []
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index]
    const expectedKeys = [
      'kind', 'reason', 'impact', 'alternative', 'target', 'recovery', 'authorization',
      'authorizationEvidenceRefs', 'executionEvidenceRefs'
    ]
    if (Object.keys(input.plannedActions[index] || {}).sort().join('|') !== expectedKeys.sort().join('|')) {
      errors.push(`plannedActions.${index}.fields-invalid`)
    }
    if (!ACTION_KINDS.has(action.kind)) errors.push(`plannedActions.${index}.kind-invalid`)
    for (const field of ['reason', 'impact', 'alternative', 'target', 'recovery']) {
      if (!text(action[field])) errors.push(`plannedActions.${index}.${field}-required`)
    }
    if (!AUTHORIZATION_STATES.has(action.authorization)) errors.push(`plannedActions.${index}.authorization-invalid`)
    if (!textList(action.authorizationEvidenceRefs)) errors.push(`plannedActions.${index}.authorizationEvidenceRefs-invalid`)
    if (!textList(action.executionEvidenceRefs)) errors.push(`plannedActions.${index}.executionEvidenceRefs-invalid`)
    if (action.authorization === 'pending') {
      if (action.authorizationEvidenceRefs.length > 0) errors.push(`plannedActions.${index}.pending-authorization-evidence-forbidden`)
      if (action.executionEvidenceRefs.length > 0) errors.push(`plannedActions.${index}.pending-execution-evidence-forbidden`)
    }
    if (action.authorization === 'explicit-confirmed') {
      if (action.authorizationEvidenceRefs.length === 0) errors.push(`plannedActions.${index}.authorization-evidence-required`)
      if (action.executionEvidenceRefs.length > 0) errors.push(`plannedActions.${index}.pre-execution-evidence-forbidden`)
    }
    if (action.authorization === 'completed') {
      if (action.authorizationEvidenceRefs.length === 0) errors.push(`plannedActions.${index}.authorization-evidence-required`)
      if (action.executionEvidenceRefs.length === 0) errors.push(`plannedActions.${index}.execution-evidence-required`)
    }
    actionKinds.push(action.kind)
  }
  if (new Set(actionKinds).size !== actionKinds.length) errors.push('plannedActions-kind-duplicate')

  if (input.collaborationMode === 'solo' && input.branchPolicy !== 'keep-current' && input.scenario !== 'branch-exception') {
    errors.push('solo-default-must-keep-current')
  }
  if (input.collaborationMode === 'unverified' && input.branchPolicy !== 'no-auto-branch') {
    errors.push('unverified-collaboration-must-not-auto-branch')
  }
  if (actionKinds.includes('branch-create') &&
      (input.branchPolicy !== 'explicit-exception' || input.scenario !== 'branch-exception')) {
    errors.push('branch-create-requires-explicit-exception')
  }
  if (input.branchPolicy === 'explicit-exception' && input.scenario !== 'branch-exception') {
    errors.push('explicit-branch-policy-requires-branch-exception-scenario')
  }
  for (const action of actions.filter(item => ['branch-create', 'switch', 'cherry-pick', 'merge-ff-only'].includes(item.kind))) {
    if (!text(input.targetBranch) || action.target !== input.targetBranch) {
      errors.push(`plannedActions.${action.kind}-targetBranch-mismatch`)
    }
  }
  if (input.integrationPolicy === 'none' && actionKinds.some(kind => ['cherry-pick', 'merge-ff-only'].includes(kind))) {
    errors.push('integration-action-forbidden-when-policy-none')
  }
  if (input.scenario === 'same-branch') {
    if (input.detached) errors.push('same-branch-detached-forbidden')
    if (input.integrationPolicy !== 'none') errors.push('same-branch-integration-must-be-none')
    if (sourceCommitIds.length) errors.push('same-branch-sourceCommitIds-must-be-empty')
    if (actionKinds.some(kind => ['branch-create', 'switch', 'cherry-pick', 'merge-ff-only'].includes(kind))) {
      errors.push('same-branch-integration-action-forbidden')
    }
    if (!(input.targetBranch === null || input.targetBranch === input.headBranch)) {
      errors.push('same-branch-target-mismatch')
    }
  }
  if (input.scenario === 'cross-branch-selective') {
    if (input.integrationPolicy !== 'ordered-cherry-pick') errors.push('cross-branch-must-use-ordered-cherry-pick')
    if (!text(input.targetBranch)) errors.push('cross-branch-target-required')
    if (!input.detached && input.targetBranch === input.headBranch) errors.push('cross-branch-target-must-differ')
    if (!sourceCommitIds.length) errors.push('cross-branch-sourceCommitIds-required')
    if (!COMMIT_RE.test(String(input.targetBefore || ''))) errors.push('cross-branch-targetBefore-required')
    if (!actionKinds.includes('cherry-pick')) errors.push('cross-branch-cherry-pick-action-required')
    if ((input.detached || input.targetBranch !== input.headBranch) && !actionKinds.includes('switch')) {
      errors.push('cross-branch-switch-action-required')
    }
    if (!dirty?.clean) errors.push('cross-branch-clean-worktree-required')
  }
  if (input.scenario === 'whole-linear-history') {
    if (input.integrationPolicy !== 'ff-only-explicit') errors.push('whole-history-must-use-ff-only-explicit')
    if (!text(input.targetBranch)) errors.push('whole-history-target-required')
    if (!input.detached && input.targetBranch === input.headBranch) errors.push('whole-history-target-must-differ')
    if (!COMMIT_RE.test(String(input.targetBefore || ''))) errors.push('whole-history-targetBefore-required')
    if (!dirty?.clean) errors.push('whole-history-clean-worktree-required')
    if ((input.detached || input.targetBranch !== input.headBranch) && !actionKinds.includes('switch')) {
      errors.push('whole-history-switch-action-required')
    }
    if (!actionKinds.includes('merge-ff-only')) errors.push('whole-history-ff-only-action-required')
  }
  if (input.scenario === 'branch-exception') {
    if (input.branchPolicy !== 'explicit-exception') errors.push('branch-exception-policy-required')
    if (input.integrationPolicy !== 'none') errors.push('branch-exception-integration-must-be-none')
    if (!text(input.targetBranch)) errors.push('branch-exception-target-required')
    if (!input.detached && input.targetBranch === input.headBranch) errors.push('branch-exception-target-must-differ')
    if (!actionKinds.includes('branch-create')) errors.push('branch-exception-action-required')
  }
  if (actionKinds.includes('push')) {
    const push = actions.find(action => action.kind === 'push')
    if (!push || !AUTHORIZATION_STATES.has(push.authorization)) errors.push('push-authorization-required')
  }
  const actionIndex = kind => actionKinds.indexOf(kind)
  if (actionIndex('switch') !== -1 && actionIndex('cherry-pick') !== -1 && actionIndex('switch') > actionIndex('cherry-pick')) {
    errors.push('switch-must-precede-cherry-pick')
  }
  if (actionIndex('switch') !== -1 && actionIndex('merge-ff-only') !== -1 && actionIndex('switch') > actionIndex('merge-ff-only')) {
    errors.push('switch-must-precede-merge-ff-only')
  }
  if (actionIndex('branch-create') !== -1 && actionIndex('switch') !== -1 && actionIndex('branch-create') > actionIndex('switch')) {
    errors.push('branch-create-must-precede-switch')
  }
  if (actionIndex('commit') !== -1) {
    const integrationIndexes = [actionIndex('switch'), actionIndex('cherry-pick'), actionIndex('merge-ff-only')].filter(index => index !== -1)
    if (integrationIndexes.some(index => actionIndex('commit') > index)) errors.push('commit-must-precede-integration-actions')
  }
  if (actionIndex('push') !== -1 && actionIndex('push') !== actionKinds.length - 1) errors.push('push-must-be-last-action')
  let incompleteActionObserved = false
  for (const action of actions) {
    if (action.authorization !== 'completed') incompleteActionObserved = true
    else if (incompleteActionObserved) errors.push('plannedActions-completion-order-invalid')
  }
  const completedIntegration = actions.some(action => ['cherry-pick', 'merge-ff-only'].includes(action.kind) && action.authorization === 'completed')
  if (completedIntegration) {
    if (!COMMIT_RE.test(String(input.targetAfter || ''))) errors.push('completed-integration-targetAfter-required')
    if (input.targetAfter === input.targetBefore) errors.push('completed-integration-targetAfter-must-change')
    if (!textList(input.postIntegrationValidationRefs, { nonEmpty: true })) errors.push('completed-integration-post-validation-required')
  } else if (input.targetAfter !== null || (input.postIntegrationValidationRefs || []).length > 0) {
    errors.push('pre-integration-post-evidence-forbidden')
  }

  if ((dirty?.conflicted || 0) > 0 && input.conflictStatus !== 'detected') {
    errors.push('conflictStatus-dirtySummary-mismatch')
  }
  const pending = actions.find(action => action.authorization === 'pending')
  const conflictUnverified = input.conflictStatus === 'unverified'
  const conflictBlocked = conflictUnverified || input.conflictStatus === 'detected' || (dirty?.conflicted || 0) > 0
  const remaining = actions.filter(action => action.authorization !== 'completed')
  let valid = errors.length === 0
  let executable = valid && !pending && !conflictBlocked && remaining.length > 0
  let nextAction = !valid
    ? 'fix-git-execution-context'
    : conflictUnverified
      ? 'verify-conflict-status'
      : conflictBlocked
      ? 'report-conflict-and-request-explicit-continue-or-abort'
      : pending
        ? `authorize:${pending.kind}`
        : executable
          ? `execute:${remaining[0].kind}`
          : null
  const canonicalValidation = { valid, errors: [...errors], executable, nextAction }
  if (serializedValidationProvided && (!hasExactKeys(input.validation, ['valid', 'errors', 'executable', 'nextAction']) ||
      JSON.stringify(input.validation) !== JSON.stringify(canonicalValidation))) {
    errors.push('serialized-validation-mismatch')
    valid = false
    executable = false
    nextAction = 'fix-git-execution-context'
  }
  return { valid, errors: [...new Set(errors)], executable, nextAction }
}

function validateSerializedGitExecutionContext(value = {}) {
  if (!Object.prototype.hasOwnProperty.call(value, 'validation')) {
    return {
      valid: false,
      errors: ['serialized-validation-required'],
      executable: false,
      nextAction: 'fix-git-execution-context'
    }
  }
  return validateGitExecutionContext(value)
}

function createGitExecutionContext(input = {}) {
  const normalized = {
    schemaVersion: 'GitExecutionContextV1',
    repoRoot: input.repoRoot,
    headBranch: input.headBranch ?? null,
    headCommit: input.headCommit,
    detached: input.detached,
    dirtySummary: input.dirtySummary,
    collaborationMode: input.collaborationMode,
    collaborationEvidenceRefs: input.collaborationEvidenceRefs || [],
    branchPolicy: input.branchPolicy,
    worktreePolicy: input.worktreePolicy,
    scenario: input.scenario,
    integrationPolicy: input.integrationPolicy,
    targetBranch: input.targetBranch ?? null,
    sourceCommitIds: input.sourceCommitIds || [],
    targetBefore: input.targetBefore ?? null,
    targetAfter: input.targetAfter ?? null,
    conflictStatus: input.conflictStatus || 'unverified',
    postIntegrationValidationRefs: input.postIntegrationValidationRefs || [],
    plannedActions: Array.isArray(input.plannedActions) ? input.plannedActions.map(normalizeAction) : []
  }
  return { ...normalized, validation: validateGitExecutionContext(normalized) }
}

module.exports = {
  ACTION_KINDS,
  AUTHORIZATION_STATES,
  DEFAULT_GIT_COMMAND_TIMEOUT_MS,
  DEFAULT_GIT_INSPECTION_BUDGET_MS,
  createGitExecutionContext,
  inspectGitRepository,
  summarizePorcelain,
  validateGitExecutionContext,
  validateSerializedGitExecutionContext
}
