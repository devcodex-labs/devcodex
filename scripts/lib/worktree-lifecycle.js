'use strict'

const path = require('path')
const { execFileSync: defaultExecFileSync } = require('child_process')

const COMMIT_RE = /^[a-f0-9]{40}$/
const OWNER_VALUES = new Set(['devcodex-guided', 'host-owned', 'external-unowned', 'unverified'])
const DIRTY_VALUES = new Set(['clean', 'dirty', 'unverified'])
const LOCK_VALUES = new Set(['unlocked', 'locked', 'unverified'])
const JOB_VALUES = new Set(['none', 'active', 'unverified'])
const AUTHORIZATION_VALUES = new Set(['not-requested', 'explicit-confirmed', 'forbidden'])
const MAX_WORKTREES = 64
const DEFAULT_COMMAND_TIMEOUT_MS = 1500
const DEFAULT_TOTAL_BUDGET_MS = 8000
const RECEIPT_KEYS = Object.freeze([
  'schemaVersion', 'worktreePath', 'gitCommonDir', 'headRef', 'headCommit', 'owner',
  'ownershipEvidenceRefs', 'dirtyState', 'lockState', 'activeJobState', 'createdByRunId',
  'teardownPlan', 'cleanupAuthorization', 'cleanupAuthorizationEvidenceRefs',
  'safeDirectoryMutationAllowed', 'validation'
])

function text (value) {
  return typeof value === 'string' && value.trim().length > 0
}

function textList (value) {
  return Array.isArray(value) && value.every(text) && new Set(value).size === value.length
}

function hasExactKeys (value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function pathKey (value) {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function createWorktreeLifecycleReceipt (input = {}) {
  const errors = []
  if (!text(input.worktreePath) || !path.isAbsolute(input.worktreePath)) errors.push('worktreePath-must-be-absolute')
  if (!text(input.gitCommonDir) || !path.isAbsolute(input.gitCommonDir)) errors.push('gitCommonDir-must-be-absolute')
  if (input.headRef !== null && !text(input.headRef)) errors.push('headRef-invalid')
  if (!COMMIT_RE.test(String(input.headCommit || '').toLowerCase())) errors.push('headCommit-invalid')
  if (!OWNER_VALUES.has(input.owner)) errors.push('owner-invalid')
  if (!textList(input.ownershipEvidenceRefs) || !input.ownershipEvidenceRefs.length) {
    errors.push('ownershipEvidenceRefs-required')
  }
  if (!DIRTY_VALUES.has(input.dirtyState)) errors.push('dirtyState-invalid')
  if (!LOCK_VALUES.has(input.lockState)) errors.push('lockState-invalid')
  if (!JOB_VALUES.has(input.activeJobState)) errors.push('activeJobState-invalid')
  if (input.createdByRunId !== null && !text(input.createdByRunId)) errors.push('createdByRunId-invalid')
  if (input.teardownPlan !== null && !text(input.teardownPlan)) errors.push('teardownPlan-invalid')
  if (!AUTHORIZATION_VALUES.has(input.cleanupAuthorization)) errors.push('cleanupAuthorization-invalid')
  if (!textList(input.cleanupAuthorizationEvidenceRefs)) errors.push('cleanupAuthorizationEvidenceRefs-invalid')
  if (input.cleanupAuthorization === 'explicit-confirmed' && !input.cleanupAuthorizationEvidenceRefs?.length) {
    errors.push('cleanupAuthorizationEvidenceRefs-required')
  }
  if (input.cleanupAuthorization !== 'explicit-confirmed' && input.cleanupAuthorizationEvidenceRefs?.length) {
    errors.push('cleanupAuthorizationEvidenceRefs-forbidden')
  }
  if (input.safeDirectoryMutationAllowed !== false) errors.push('safeDirectoryMutationAllowed-must-be-false')

  if (input.owner === 'devcodex-guided') {
    if (!text(input.createdByRunId)) errors.push('devcodex-guided-createdByRunId-required')
    if (!text(input.teardownPlan)) errors.push('devcodex-guided-teardownPlan-required')
  } else {
    if (input.createdByRunId !== null) errors.push('external-createdByRunId-must-be-null')
    if (input.teardownPlan !== null) errors.push('external-teardownPlan-must-be-null')
    if (input.cleanupAuthorization !== 'forbidden') errors.push('external-cleanup-authorization-forbidden')
  }

  const cleanupEligible = errors.length === 0 &&
    input.owner === 'devcodex-guided' &&
    input.cleanupAuthorization === 'explicit-confirmed' &&
    input.dirtyState === 'clean' &&
    input.lockState === 'unlocked' &&
    input.activeJobState === 'none'

  return {
    schemaVersion: 'WorktreeLifecycleReceiptV1',
    worktreePath: input.worktreePath,
    gitCommonDir: input.gitCommonDir,
    headRef: input.headRef ?? null,
    headCommit: String(input.headCommit || '').toLowerCase(),
    owner: input.owner,
    ownershipEvidenceRefs: input.ownershipEvidenceRefs || [],
    dirtyState: input.dirtyState,
    lockState: input.lockState,
    activeJobState: input.activeJobState,
    createdByRunId: input.createdByRunId ?? null,
    teardownPlan: input.teardownPlan ?? null,
    cleanupAuthorization: input.cleanupAuthorization,
    cleanupAuthorizationEvidenceRefs: input.cleanupAuthorizationEvidenceRefs || [],
    safeDirectoryMutationAllowed: false,
    validation: { valid: errors.length === 0, errors, cleanupEligible }
  }
}

function validateSerializedWorktreeLifecycleReceipt (value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const errors = []
  if (!hasExactKeys(source, RECEIPT_KEYS)) errors.push('serialized-fields-invalid')
  if (source.schemaVersion !== 'WorktreeLifecycleReceiptV1') errors.push('serialized-schemaVersion-invalid')
  const canonical = createWorktreeLifecycleReceipt(source)
  if (!canonical.validation.valid) {
    errors.push(...canonical.validation.errors.map(error => `serialized.${error}`))
  }
  for (const key of RECEIPT_KEYS.filter(key => key !== 'validation')) {
    if (JSON.stringify(source[key]) !== JSON.stringify(canonical[key])) errors.push(`serialized-${key}-mismatch`)
  }
  if (!hasExactKeys(source.validation, ['valid', 'errors', 'cleanupEligible']) ||
      JSON.stringify(source.validation) !== JSON.stringify(canonical.validation)) {
    errors.push('serialized-validation-mismatch')
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)], canonical }
}

function parseWorktreePorcelain (value) {
  const records = []
  let current = null
  for (const token of String(value || '').split('\0')) {
    if (!token) {
      if (current?.worktree) records.push(current)
      current = null
      continue
    }
    const separator = token.indexOf(' ')
    const key = separator === -1 ? token : token.slice(0, separator)
    const fieldValue = separator === -1 ? true : token.slice(separator + 1)
    if (key === 'worktree') {
      if (current?.worktree) records.push(current)
      current = { worktree: fieldValue }
      continue
    }
    if (!current) current = {}
    current[key] = fieldValue
  }
  if (current?.worktree) records.push(current)
  return records
}

function commandFailureCode (error) {
  const message = String(error?.stderr || error?.message || '').toLowerCase()
  if (message.includes('dubious ownership')) return 'GIT_DUBIOUS_OWNERSHIP'
  if (message.includes('not a git repository')) return 'GIT_REPOSITORY_NOT_FOUND'
  if (error?.code === 'ETIMEDOUT') return 'GIT_DIAGNOSTIC_TIMEOUT'
  return 'GIT_DIAGNOSTIC_FAILED'
}

function timeoutError (message) {
  const error = new Error(message)
  error.code = 'ETIMEDOUT'
  return error
}

function inspectWorktreeLifecycle (cwd, options = {}) {
  const execFileSync = options.execFileSync || defaultExecFileSync
  const now = typeof options.now === 'function' ? options.now : Date.now
  const maxWorktrees = Number.isInteger(options.maxWorktrees)
    ? Math.max(1, Math.min(options.maxWorktrees, MAX_WORKTREES))
    : MAX_WORKTREES
  const timeoutMs = Number.isInteger(options.timeoutMs)
    ? Math.max(100, options.timeoutMs)
    : DEFAULT_COMMAND_TIMEOUT_MS
  const totalBudgetMs = Number.isInteger(options.totalBudgetMs)
    ? Math.max(100, options.totalBudgetMs)
    : DEFAULT_TOTAL_BUDGET_MS
  const startedAt = now()
  const commandLog = []
  const run = (commandCwd, args) => {
    const remainingMs = totalBudgetMs - (now() - startedAt)
    if (remainingMs < 100) throw timeoutError(`worktree diagnostic exceeded ${totalBudgetMs}ms total budget`)
    commandLog.push({ command: 'git', args: [...args], cwd: path.resolve(commandCwd) })
    return String(execFileSync('git', args, {
      cwd: path.resolve(commandCwd),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: Math.min(timeoutMs, remainingMs),
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true
    }))
  }

  let repoRoot
  let gitCommonDir
  let rawRecords
  try {
    repoRoot = path.resolve(run(cwd, ['rev-parse', '--show-toplevel']).trim())
    const commonValue = run(repoRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim()
    gitCommonDir = path.isAbsolute(commonValue) ? path.resolve(commonValue) : path.resolve(repoRoot, commonValue)
    rawRecords = parseWorktreePorcelain(run(repoRoot, ['worktree', 'list', '--porcelain', '-z']))
  } catch (error) {
    return {
      schemaVersion: 'WorktreeDiagnosticsV1',
      status: 'UNVERIFIED',
      repoRoot: null,
      gitCommonDir: null,
      boundedInventory: { limit: maxWorktrees, discovered: 0, returned: 0, truncated: false },
      worktrees: [],
      mutationEvidence: { mutationCount: 0, safeDirectoryMutationAttempted: false, commands: commandLog },
      issues: [{ code: commandFailureCode(error), message: String(error?.message || error) }]
    }
  }

  const ownershipByPath = new Map()
  const ownershipConflicts = new Set()
  const ownershipIssues = []
  for (const candidate of Array.isArray(options.ownershipReceipts) ? options.ownershipReceipts : []) {
    const validation = validateSerializedWorktreeLifecycleReceipt(candidate)
    const candidatePath = text(candidate?.worktreePath) && path.isAbsolute(candidate.worktreePath)
      ? path.resolve(candidate.worktreePath)
      : null
    if (!validation.valid) {
      ownershipIssues.push({
        code: 'WORKTREE_OWNERSHIP_RECEIPT_INVALID',
        ...(candidatePath ? { worktreePath: candidatePath } : {}),
        message: validation.errors.join(', ')
      })
      continue
    }
    const key = pathKey(candidatePath)
    const prior = ownershipByPath.get(key)
    if (prior && JSON.stringify(prior) !== JSON.stringify(candidate)) {
      ownershipByPath.delete(key)
      ownershipConflicts.add(key)
      ownershipIssues.push({
        code: 'WORKTREE_OWNERSHIP_RECEIPT_CONFLICT',
        worktreePath: candidatePath,
        message: 'multiple valid ownership receipts disagree for the same worktree path'
      })
      continue
    }
    if (!ownershipConflicts.has(key)) ownershipByPath.set(key, candidate)
  }
  const selected = rawRecords.slice(0, maxWorktrees)
  const worktrees = selected.map(record => {
    const worktreePath = path.resolve(record.worktree)
    const currentWorktree = pathKey(worktreePath) === pathKey(repoRoot)
    let owned = ownershipByPath.get(pathKey(worktreePath))
    if (owned && pathKey(owned.gitCommonDir) !== pathKey(gitCommonDir)) {
      ownershipIssues.push({
        code: 'WORKTREE_OWNERSHIP_GIT_COMMON_DIR_MISMATCH',
        worktreePath,
        message: 'ownership receipt gitCommonDir does not match the inspected repository'
      })
      owned = null
    }
    const recordHeadRef = typeof record.branch === 'string' ? record.branch : null
    const recordHeadCommit = String(record.HEAD || '').toLowerCase()
    const ownershipSnapshotCurrent = Boolean(owned) &&
      owned.headCommit === recordHeadCommit && owned.headRef === recordHeadRef
    if (owned && !ownershipSnapshotCurrent) {
      ownershipIssues.push({
        code: 'WORKTREE_OWNERSHIP_RECEIPT_STALE_HEAD',
        worktreePath,
        message: 'ownership receipt HEAD/ref no longer matches the inspected worktree; cleanup authorization was retired'
      })
    }
    const owner = OWNER_VALUES.has(owned?.owner)
      ? owned.owner
      : (currentWorktree ? 'host-owned' : 'external-unowned')
    const prunable = Object.prototype.hasOwnProperty.call(record, 'prunable')
    let dirtyState = 'unverified'
    let dirtyIssue = null
    if (prunable) {
      dirtyIssue = 'WORKTREE_PRUNABLE_NOT_PROBED'
    } else if (!currentWorktree && owner !== 'devcodex-guided' && options.probeExternalWorktrees !== true) {
      dirtyIssue = 'EXTERNAL_WORKTREE_NOT_PROBED'
    } else {
      try {
        const status = run(worktreePath, [
          'status', '--porcelain=v1', '--untracked-files=normal', '--ignored=matching'
        ])
        dirtyState = status.trim() ? 'dirty' : 'clean'
      } catch (error) {
        dirtyIssue = commandFailureCode(error)
      }
    }
    const receipt = createWorktreeLifecycleReceipt({
      worktreePath,
      gitCommonDir,
      headRef: recordHeadRef,
      headCommit: recordHeadCommit,
      owner,
      ownershipEvidenceRefs: owned?.ownershipEvidenceRefs?.length
        ? owned.ownershipEvidenceRefs
        : (currentWorktree
            ? ['git-worktree-list-read-only', 'current-command-repository']
            : ['git-worktree-list-read-only']),
      dirtyState,
      lockState: Object.prototype.hasOwnProperty.call(record, 'locked') ? 'locked' : 'unlocked',
      activeJobState: ownershipSnapshotCurrent ? owned.activeJobState : 'unverified',
      createdByRunId: owner === 'devcodex-guided' ? owned?.createdByRunId : null,
      teardownPlan: owner === 'devcodex-guided' ? owned?.teardownPlan : null,
      cleanupAuthorization: owner === 'devcodex-guided'
        ? (ownershipSnapshotCurrent ? owned.cleanupAuthorization : 'not-requested')
        : 'forbidden',
      cleanupAuthorizationEvidenceRefs: owner === 'devcodex-guided' && ownershipSnapshotCurrent &&
        owned.cleanupAuthorization === 'explicit-confirmed'
        ? owned.cleanupAuthorizationEvidenceRefs
        : [],
      safeDirectoryMutationAllowed: false
    })
    return {
      receipt,
      detached: Object.prototype.hasOwnProperty.call(record, 'detached'),
      prunable,
      prunableReason: typeof record.prunable === 'string' ? record.prunable : null,
      lockedReason: typeof record.locked === 'string' ? record.locked : null,
      dirtyIssue
    }
  })

  const issues = [...ownershipIssues, ...worktrees.flatMap(item => {
    const itemIssues = []
    if (!item.receipt.validation.valid) itemIssues.push({ code: 'WORKTREE_RECEIPT_INVALID', worktreePath: item.receipt.worktreePath })
    if (item.dirtyIssue) itemIssues.push({ code: item.dirtyIssue, worktreePath: item.receipt.worktreePath })
    if (item.receipt.dirtyState === 'dirty') itemIssues.push({ code: 'WORKTREE_DIRTY', worktreePath: item.receipt.worktreePath })
    if (item.receipt.lockState === 'locked') itemIssues.push({ code: 'WORKTREE_LOCKED', worktreePath: item.receipt.worktreePath })
    if (item.receipt.activeJobState === 'active') itemIssues.push({ code: 'WORKTREE_ACTIVE_JOB', worktreePath: item.receipt.worktreePath })
    if (item.receipt.owner === 'external-unowned') itemIssues.push({ code: 'WORKTREE_EXTERNAL_UNOWNED', worktreePath: item.receipt.worktreePath })
    if (item.receipt.owner === 'unverified') itemIssues.push({ code: 'WORKTREE_OWNER_UNVERIFIED', worktreePath: item.receipt.worktreePath })
    return itemIssues
  })]

  return {
    schemaVersion: 'WorktreeDiagnosticsV1',
    status: issues.length || rawRecords.length > maxWorktrees ? 'WARN' : 'PASS',
    repoRoot,
    gitCommonDir,
    boundedInventory: {
      limit: maxWorktrees,
      discovered: rawRecords.length,
      returned: worktrees.length,
      truncated: rawRecords.length > maxWorktrees
    },
    worktrees,
    mutationEvidence: { mutationCount: 0, safeDirectoryMutationAttempted: false, commands: commandLog },
    issues
  }
}

module.exports = {
  MAX_WORKTREES,
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_TOTAL_BUDGET_MS,
  createWorktreeLifecycleReceipt,
  inspectWorktreeLifecycle,
  parseWorktreePorcelain,
  validateSerializedWorktreeLifecycleReceipt
}
