#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  createGitExecutionContext,
  inspectGitRepository,
  summarizePorcelain,
  validateSerializedGitExecutionContext
} = require('./lib/git-execution-context')

const ROOT = path.resolve(__dirname, '..')
const HEAD_A = 'a'.repeat(40)
const HEAD_B = 'b'.repeat(40)
const HEAD_C = 'c'.repeat(40)
const clean = { clean: true, staged: 0, tracked: 0, untracked: 0, conflicted: 0 }
const disclosure = (kind, authorization = 'explicit-confirmed', target = (kind === 'push' ? 'origin/main' : 'main')) => ({
  kind,
  reason: `需要执行 ${kind}`,
  impact: `${kind} 会改变 Git 共享状态`,
  alternative: '保持当前分支并停止在已验证提交',
  target,
  recovery: '停止并报告当前 HEAD；不自动 stash/reset/continue/abort',
  authorization,
  authorizationEvidenceRefs: authorization === 'pending' ? [] : [`authorization:${kind}`],
  executionEvidenceRefs: authorization === 'completed' ? [`execution:${kind}`] : []
})
const base = {
  repoRoot: ROOT,
  headBranch: 'main',
  headCommit: HEAD_A,
  detached: false,
  dirtySummary: clean,
  collaborationMode: 'solo',
  collaborationEvidenceRefs: ['profile:extensions.devcodex.git.collaborationMode'],
  branchPolicy: 'keep-current',
  worktreePolicy: 'explicit-only',
  scenario: 'same-branch',
  integrationPolicy: 'none',
  targetBranch: 'main',
  sourceCommitIds: [],
  targetBefore: null,
  targetAfter: null,
  conflictStatus: 'none',
  postIntegrationValidationRefs: [],
  plannedActions: []
}

const sameBranch = createGitExecutionContext(base)
assert.strictEqual(sameBranch.validation.valid, true, sameBranch.validation.errors.join(', '))
assert.strictEqual(sameBranch.validation.executable, false)
assert.strictEqual(sameBranch.validation.nextAction, null)
assert.strictEqual(validateSerializedGitExecutionContext(sameBranch).valid, true)

const sameBranchCommit = createGitExecutionContext({ ...base, plannedActions: [disclosure('commit')] })
assert.strictEqual(sameBranchCommit.validation.valid, true)
assert.strictEqual(sameBranchCommit.validation.executable, true)
assert.strictEqual(sameBranchCommit.validation.nextAction, 'execute:commit')

const hiddenBranch = createGitExecutionContext({ ...base, plannedActions: [disclosure('branch-create')] })
assert.strictEqual(hiddenBranch.validation.valid, false)
assert(hiddenBranch.validation.errors.includes('same-branch-integration-action-forbidden'))

const branchPending = createGitExecutionContext({
  ...base,
  scenario: 'branch-exception',
  branchPolicy: 'explicit-exception',
  integrationPolicy: 'none',
  targetBranch: 'feature/explicit',
  plannedActions: [disclosure('branch-create', 'pending', 'feature/explicit')]
})
assert.strictEqual(branchPending.validation.valid, true)
assert.strictEqual(branchPending.validation.executable, false)
assert.strictEqual(branchPending.validation.nextAction, 'authorize:branch-create')

const crossBranch = createGitExecutionContext({
  ...base,
  collaborationMode: 'unverified',
  branchPolicy: 'no-auto-branch',
  headBranch: 'dev',
  scenario: 'cross-branch-selective',
  integrationPolicy: 'ordered-cherry-pick',
  targetBranch: 'main',
  sourceCommitIds: [HEAD_B, HEAD_C],
  targetBefore: HEAD_A,
  plannedActions: [disclosure('switch'), disclosure('cherry-pick')]
})
assert.strictEqual(crossBranch.validation.valid, true, crossBranch.validation.errors.join(', '))
assert.strictEqual(crossBranch.validation.executable, true)

const crossMissingIds = createGitExecutionContext({ ...crossBranch, sourceCommitIds: [], validation: undefined })
assert.strictEqual(crossMissingIds.validation.valid, false)
assert(crossMissingIds.validation.errors.includes('cross-branch-sourceCommitIds-required'))

const crossDirty = createGitExecutionContext({
  ...crossBranch,
  validation: undefined,
  dirtySummary: { clean: false, staged: 0, tracked: 1, untracked: 0, conflicted: 0 }
})
assert.strictEqual(crossDirty.validation.valid, false)
assert(crossDirty.validation.errors.includes('cross-branch-clean-worktree-required'))

const completedPick = createGitExecutionContext({
  ...crossBranch,
  validation: undefined,
  targetAfter: HEAD_C,
  postIntegrationValidationRefs: ['test:post-pick'],
  plannedActions: [disclosure('switch', 'completed'), disclosure('cherry-pick', 'completed')]
})
assert.strictEqual(completedPick.validation.valid, true, completedPick.validation.errors.join(', '))
assert.strictEqual(completedPick.validation.executable, false)

const missingPostPickValidation = createGitExecutionContext({
  ...completedPick,
  validation: undefined,
  postIntegrationValidationRefs: []
})
assert.strictEqual(missingPostPickValidation.validation.valid, false)
assert(missingPostPickValidation.validation.errors.includes('completed-integration-post-validation-required'))

const ffOnly = createGitExecutionContext({
  ...base,
  collaborationMode: 'team',
  headBranch: 'dev',
  scenario: 'whole-linear-history',
  integrationPolicy: 'ff-only-explicit',
  targetBranch: 'main',
  targetBefore: HEAD_A,
  plannedActions: [disclosure('switch'), disclosure('merge-ff-only')]
})
assert.strictEqual(ffOnly.validation.valid, true, ffOnly.validation.errors.join(', '))

const defaultMerge = createGitExecutionContext({ ...base, plannedActions: [disclosure('merge-ff-only')] })
assert.strictEqual(defaultMerge.validation.valid, false)

const unverifiedBranchBypass = createGitExecutionContext({
  ...base,
  collaborationMode: 'unverified',
  branchPolicy: 'keep-current'
})
assert.strictEqual(unverifiedBranchBypass.validation.valid, false)
assert(unverifiedBranchBypass.validation.errors.includes('unverified-collaboration-must-not-auto-branch'))

const crossHiddenBranch = createGitExecutionContext({
  ...crossBranch,
  validation: undefined,
  plannedActions: [disclosure('branch-create'), disclosure('switch'), disclosure('cherry-pick')]
})
assert.strictEqual(crossHiddenBranch.validation.valid, false)
assert(crossHiddenBranch.validation.errors.includes('branch-create-requires-explicit-exception'))

const wrongOrder = createGitExecutionContext({
  ...crossBranch,
  validation: undefined,
  plannedActions: [disclosure('cherry-pick'), disclosure('switch')]
})
assert.strictEqual(wrongOrder.validation.valid, false)
assert(wrongOrder.validation.errors.includes('switch-must-precede-cherry-pick'))

const branchCreationAfterSwitch = createGitExecutionContext({
  ...branchPending,
  validation: undefined,
  plannedActions: [
    disclosure('switch', 'explicit-confirmed', 'feature/explicit'),
    disclosure('branch-create', 'explicit-confirmed', 'feature/explicit')
  ]
})
assert(branchCreationAfterSwitch.validation.errors.includes('branch-create-must-precede-switch'))

const mismatchedBranchDisclosure = createGitExecutionContext({
  ...branchPending,
  validation: undefined,
  plannedActions: [disclosure('branch-create', 'explicit-confirmed', 'feature/other')]
})
assert(mismatchedBranchDisclosure.validation.errors.includes('plannedActions.branch-create-targetBranch-mismatch'))

const authorizationWithoutEvidence = createGitExecutionContext({
  ...base,
  plannedActions: [{
    ...disclosure('commit'),
    authorizationEvidenceRefs: []
  }]
})
assert(authorizationWithoutEvidence.validation.errors.includes('plannedActions.0.authorization-evidence-required'))

const completedWithoutExecutionEvidence = createGitExecutionContext({
  ...base,
  plannedActions: [{
    ...disclosure('commit', 'completed'),
    executionEvidenceRefs: []
  }]
})
assert(completedWithoutExecutionEvidence.validation.errors.includes('plannedActions.0.execution-evidence-required'))

const pushPending = createGitExecutionContext({ ...base, plannedActions: [disclosure('push', 'pending')] })
assert.strictEqual(pushPending.validation.valid, true)
assert.strictEqual(pushPending.validation.executable, false)
assert.strictEqual(pushPending.validation.nextAction, 'authorize:push')
const pushConfirmed = createGitExecutionContext({ ...base, plannedActions: [disclosure('push')] })
assert.strictEqual(pushConfirmed.validation.valid, true)
assert.strictEqual(pushConfirmed.validation.executable, true)

const conflict = createGitExecutionContext({
  ...base,
  dirtySummary: { clean: false, staged: 0, tracked: 0, untracked: 0, conflicted: 1 },
  conflictStatus: 'detected',
  plannedActions: [disclosure('commit')]
})
assert.strictEqual(conflict.validation.valid, true)
assert.strictEqual(conflict.validation.executable, false)
assert.match(conflict.validation.nextAction, /report-conflict/)

const unverifiedConflict = createGitExecutionContext({ ...base, conflictStatus: 'unverified', plannedActions: [disclosure('commit')] })
assert.strictEqual(unverifiedConflict.validation.valid, true)
assert.strictEqual(unverifiedConflict.validation.executable, false)
assert.strictEqual(unverifiedConflict.validation.nextAction, 'verify-conflict-status')

const detachedSameBranch = createGitExecutionContext({ ...base, detached: true, headBranch: null, targetBranch: null })
assert(detachedSameBranch.validation.errors.includes('same-branch-detached-forbidden'))

const branchExceptionIntegrationBypass = createGitExecutionContext({
  ...branchPending,
  validation: undefined,
  integrationPolicy: 'ordered-cherry-pick'
})
assert(branchExceptionIntegrationBypass.validation.errors.includes('branch-exception-integration-must-be-none'))

const unchangedCompletedPick = createGitExecutionContext({
  ...completedPick,
  validation: undefined,
  targetAfter: completedPick.targetBefore
})
assert(unchangedCompletedPick.validation.errors.includes('completed-integration-targetAfter-must-change'))

const impossibleCompletionOrder = createGitExecutionContext({
  ...crossBranch,
  validation: undefined,
  plannedActions: [disclosure('switch'), disclosure('cherry-pick', 'completed')],
  targetAfter: HEAD_C,
  postIntegrationValidationRefs: ['test:post-pick']
})
assert(impossibleCompletionOrder.validation.errors.includes('plannedActions-completion-order-invalid'))

const forgedSerializedContext = JSON.parse(JSON.stringify(sameBranchCommit))
forgedSerializedContext.validation.executable = false
assert(validateSerializedGitExecutionContext(forgedSerializedContext).errors.includes('serialized-validation-mismatch'))

assert.deepStrictEqual(summarizePorcelain('M  a.js\n M b.js\n?? c.js\n!! ignored/\nUU d.js\n'), {
  clean: false, staged: 1, tracked: 1, untracked: 2, conflicted: 1
})

const inspectionCommands = []
const ignoredOnly = inspectGitRepository(ROOT, {
  execFileSync(_command, args) {
    inspectionCommands.push(args)
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return `${ROOT}\n`
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return `${HEAD_A}\n`
    if (args[0] === 'symbolic-ref') return 'main\n'
    if (args[0] === 'status') return '!! ignored-local/\n'
    throw new Error(`unexpected command: ${args.join(' ')}`)
  }
})
assert.strictEqual(ignoredOnly.dirtySummary.clean, false)
assert.strictEqual(ignoredOnly.dirtySummary.untracked, 1)
assert(inspectionCommands.find(args => args[0] === 'status').includes('--ignored=matching'))

const observed = inspectGitRepository(ROOT)
assert.strictEqual(observed.repoRoot, ROOT)
assert.match(observed.headCommit, /^[a-f0-9]{40}$/)
assert.strictEqual(typeof observed.dirtySummary.clean, 'boolean')

let inspectionClock = 0
assert.throws(
  () => inspectGitRepository(ROOT, {
    totalBudgetMs: 100,
    now: () => {
      inspectionClock += 60
      return inspectionClock
    },
    execFileSync() {
      throw new Error('must not execute after budget exhaustion')
    }
  }),
  error => error.code === 'ETIMEDOUT'
)

for (const schemaPath of [
  'content/skills/execution-contract/git-execution-context.v1.schema.json',
  'content/skills/execution-contract/worktree-lifecycle-receipt.v1.schema.json',
  'content/skills/evolution-governance/evolution-target-decision.v1.schema.json'
]) {
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, schemaPath), 'utf8'))
  assert.strictEqual(schema.additionalProperties, false, schemaPath)
}

console.log('git execution context passed: read-only inspection/same-branch/branch disclosure/ordered cherry-pick/ff-only/push/conflict')
