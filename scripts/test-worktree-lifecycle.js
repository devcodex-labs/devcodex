#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  createWorktreeLifecycleReceipt,
  inspectWorktreeLifecycle,
  parseWorktreePorcelain,
  validateSerializedWorktreeLifecycleReceipt
} = require('./lib/worktree-lifecycle')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-worktree-lifecycle-'))

try {
  const repoRoot = path.join(root, 'repo')
  const otherRoot = path.join(root, 'other worktree')
  const gitCommonDir = path.join(repoRoot, '.git')
  const headA = 'a'.repeat(40)
  const headB = 'b'.repeat(40)
  const porcelain = [
    `worktree ${repoRoot}`,
    `HEAD ${headA}`,
    'branch refs/heads/main',
    '',
    `worktree ${otherRoot}`,
    `HEAD ${headB}`,
    'detached',
    'locked host-owned',
    'prunable gitdir file points to non-existent location',
    '',
    ''
  ].join('\0')
  assert.strictEqual(parseWorktreePorcelain(porcelain).length, 2)

  const invoked = []
  const fakeExec = (command, args, options) => {
    invoked.push({ command, args: [...args], cwd: options.cwd, options: { ...options } })
    if (args.join(' ') === 'rev-parse --show-toplevel') return `${repoRoot}\n`
    if (args.join(' ') === 'rev-parse --path-format=absolute --git-common-dir') return `${gitCommonDir}\n`
    if (args.join(' ') === 'worktree list --porcelain -z') return porcelain
    if (args.join(' ') === 'status --porcelain=v1 --untracked-files=normal --ignored=matching' && path.resolve(options.cwd) === path.resolve(repoRoot)) return ''
    if (args.join(' ') === 'status --porcelain=v1 --untracked-files=normal --ignored=matching') {
      const error = new Error('detected dubious ownership in repository')
      error.stderr = 'fatal: detected dubious ownership in repository'
      throw error
    }
    throw new Error(`unexpected command: ${args.join(' ')}`)
  }

  const guided = createWorktreeLifecycleReceipt({
    worktreePath: path.resolve(repoRoot),
    gitCommonDir: path.resolve(gitCommonDir),
    headRef: 'refs/heads/main',
    headCommit: headA,
    owner: 'devcodex-guided',
    ownershipEvidenceRefs: ['run-receipt:test'],
    dirtyState: 'clean',
    lockState: 'unlocked',
    activeJobState: 'none',
    createdByRunId: 'run-test-1',
    teardownPlan: 'report and wait for explicit cleanup confirmation',
    cleanupAuthorization: 'explicit-confirmed',
    cleanupAuthorizationEvidenceRefs: ['user-confirmation:test-cleanup'],
    safeDirectoryMutationAllowed: false
  })
  assert.strictEqual(guided.validation.valid, true)
  assert.strictEqual(guided.validation.cleanupEligible, true)
  assert.strictEqual(validateSerializedWorktreeLifecycleReceipt(guided).valid, true)

  const diagnostics = inspectWorktreeLifecycle(repoRoot, {
    execFileSync: fakeExec,
    ownershipReceipts: [guided]
  })
  assert.strictEqual(diagnostics.status, 'WARN')
  assert.strictEqual(diagnostics.boundedInventory.discovered, 2)
  assert.strictEqual(diagnostics.boundedInventory.truncated, false)
  assert.strictEqual(diagnostics.worktrees[0].receipt.owner, 'devcodex-guided')
  assert.strictEqual(diagnostics.worktrees[0].receipt.validation.cleanupEligible, true)
  assert.strictEqual(diagnostics.worktrees[1].receipt.owner, 'external-unowned')
  assert.strictEqual(diagnostics.worktrees[1].receipt.dirtyState, 'unverified')
  assert.strictEqual(diagnostics.worktrees[1].receipt.cleanupAuthorization, 'forbidden')
  assert.deepStrictEqual(diagnostics.worktrees[1].receipt.cleanupAuthorizationEvidenceRefs, [])
  assert.strictEqual(diagnostics.worktrees[1].receipt.safeDirectoryMutationAllowed, false)
  assert.strictEqual(diagnostics.worktrees[1].prunable, true)
  assert.strictEqual(diagnostics.worktrees[1].receipt.validation.cleanupEligible, false)
  assert(diagnostics.issues.some(issue => issue.code === 'WORKTREE_PRUNABLE_NOT_PROBED'))
  assert(diagnostics.issues.some(issue => issue.code === 'WORKTREE_EXTERNAL_UNOWNED'))
  assert.strictEqual(diagnostics.mutationEvidence.mutationCount, 0)
  assert.strictEqual(diagnostics.mutationEvidence.safeDirectoryMutationAttempted, false)

  const untrackedDiagnostics = inspectWorktreeLifecycle(repoRoot, {
    execFileSync(command, args, options) {
      if (args.join(' ') === 'status --porcelain=v1 --untracked-files=normal --ignored=matching' &&
          path.resolve(options.cwd) === path.resolve(repoRoot)) return '?? local-only.txt\n'
      return fakeExec(command, args, options)
    },
    ownershipReceipts: [guided]
  })
  assert.strictEqual(untrackedDiagnostics.worktrees[0].receipt.dirtyState, 'dirty')
  assert.strictEqual(untrackedDiagnostics.worktrees[0].receipt.validation.cleanupEligible, false)
  assert(untrackedDiagnostics.issues.some(issue => issue.code === 'WORKTREE_DIRTY'))

  const ignoredDiagnostics = inspectWorktreeLifecycle(repoRoot, {
    execFileSync(command, args, options) {
      if (args.join(' ') === 'status --porcelain=v1 --untracked-files=normal --ignored=matching' &&
          path.resolve(options.cwd) === path.resolve(repoRoot)) return '!! .env\n'
      return fakeExec(command, args, options)
    },
    ownershipReceipts: [guided]
  })
  assert.strictEqual(ignoredDiagnostics.worktrees[0].receipt.dirtyState, 'dirty')
  assert.strictEqual(ignoredDiagnostics.worktrees[0].receipt.validation.cleanupEligible, false)

  const allowedCommands = new Set([
    'rev-parse --show-toplevel',
    'rev-parse --path-format=absolute --git-common-dir',
    'worktree list --porcelain -z',
    'status --porcelain=v1 --untracked-files=normal --ignored=matching'
  ])
  assert(invoked.every(item => item.command === 'git' && allowedCommands.has(item.args.join(' '))))
  assert(invoked.every(item => !item.args.some(arg => /^(prune|remove|unlock|config)$/.test(arg))))
  assert.strictEqual(invoked.filter(item => item.args[0] === 'status').length, 1, 'prunable external worktrees must not be entered')
  assert(invoked.every(item => !item.options || item.options.timeout <= 1500))

  const bounded = inspectWorktreeLifecycle(repoRoot, { execFileSync: fakeExec, maxWorktrees: 1 })
  assert.strictEqual(bounded.boundedInventory.returned, 1)
  assert.strictEqual(bounded.boundedInventory.truncated, true)
  assert.strictEqual(bounded.worktrees[0].receipt.owner, 'host-owned')

  const malformedOwnership = inspectWorktreeLifecycle(repoRoot, {
    execFileSync: fakeExec,
    ownershipReceipts: [{ owner: 'devcodex-guided' }, null]
  })
  assert.strictEqual(malformedOwnership.worktrees[0].receipt.owner, 'host-owned')
  assert(malformedOwnership.issues.some(issue => issue.code === 'WORKTREE_OWNERSHIP_RECEIPT_INVALID'))

  const forgedOwnership = JSON.parse(JSON.stringify(guided))
  forgedOwnership.dirtyState = 'dirty'
  forgedOwnership.validation = { valid: true, errors: [], cleanupEligible: true }
  const forgedDiagnostics = inspectWorktreeLifecycle(repoRoot, {
    execFileSync: fakeExec,
    ownershipReceipts: [forgedOwnership]
  })
  assert.strictEqual(forgedDiagnostics.worktrees[0].receipt.owner, 'host-owned')
  assert(forgedDiagnostics.issues.some(issue => issue.code === 'WORKTREE_OWNERSHIP_RECEIPT_INVALID'))

  const hostReceipt = createWorktreeLifecycleReceipt({
    ...guided,
    owner: 'host-owned',
    createdByRunId: null,
    teardownPlan: null,
    cleanupAuthorization: 'forbidden',
    cleanupAuthorizationEvidenceRefs: []
  })
  assert.strictEqual(hostReceipt.validation.valid, true)
  const hostWithGuidedProvenance = createWorktreeLifecycleReceipt({
    ...hostReceipt,
    createdByRunId: 'forged-run',
    teardownPlan: 'forged teardown',
    cleanupAuthorization: 'not-requested'
  })
  assert(hostWithGuidedProvenance.validation.errors.includes('external-createdByRunId-must-be-null'))
  assert(hostWithGuidedProvenance.validation.errors.includes('external-teardownPlan-must-be-null'))
  assert(hostWithGuidedProvenance.validation.errors.includes('external-cleanup-authorization-forbidden'))
  const conflictingOwnership = inspectWorktreeLifecycle(repoRoot, {
    execFileSync: fakeExec,
    ownershipReceipts: [guided, hostReceipt]
  })
  assert(conflictingOwnership.issues.some(issue => issue.code === 'WORKTREE_OWNERSHIP_RECEIPT_CONFLICT'))

  const wrongCommonDir = createWorktreeLifecycleReceipt({ ...guided, gitCommonDir: path.join(root, 'other.git') })
  const mismatchedCommonDir = inspectWorktreeLifecycle(repoRoot, {
    execFileSync: fakeExec,
    ownershipReceipts: [wrongCommonDir]
  })
  assert.strictEqual(mismatchedCommonDir.worktrees[0].receipt.owner, 'host-owned')
  assert(mismatchedCommonDir.issues.some(issue => issue.code === 'WORKTREE_OWNERSHIP_GIT_COMMON_DIR_MISMATCH'))

  const staleHeadReceipt = createWorktreeLifecycleReceipt({ ...guided, headCommit: headB })
  const staleHeadDiagnostics = inspectWorktreeLifecycle(repoRoot, {
    execFileSync: fakeExec,
    ownershipReceipts: [staleHeadReceipt]
  })
  assert.strictEqual(staleHeadDiagnostics.worktrees[0].receipt.owner, 'devcodex-guided')
  assert.strictEqual(staleHeadDiagnostics.worktrees[0].receipt.cleanupAuthorization, 'not-requested')
  assert.deepStrictEqual(staleHeadDiagnostics.worktrees[0].receipt.cleanupAuthorizationEvidenceRefs, [])
  assert.strictEqual(staleHeadDiagnostics.worktrees[0].receipt.activeJobState, 'unverified')
  assert.strictEqual(staleHeadDiagnostics.worktrees[0].receipt.validation.cleanupEligible, false)
  assert(staleHeadDiagnostics.issues.some(issue => issue.code === 'WORKTREE_OWNERSHIP_RECEIPT_STALE_HEAD'))

  const cleanupAuthorizationWithoutEvidence = createWorktreeLifecycleReceipt({
    ...guided,
    cleanupAuthorizationEvidenceRefs: []
  })
  assert(cleanupAuthorizationWithoutEvidence.validation.errors.includes('cleanupAuthorizationEvidenceRefs-required'))

  let clock = 0
  const budgeted = inspectWorktreeLifecycle(repoRoot, {
    totalBudgetMs: 100,
    now: () => {
      clock += 40
      return clock
    },
    execFileSync: fakeExec,
    ownershipReceipts: [guided]
  })
  assert.strictEqual(budgeted.status, 'UNVERIFIED')
  assert(budgeted.issues.some(issue => issue.code === 'GIT_DIAGNOSTIC_TIMEOUT'))

  const dubious = inspectWorktreeLifecycle(repoRoot, {
    execFileSync(command, args, options) {
      if (args.join(' ') !== 'status --porcelain=v1 --untracked-files=normal --ignored=matching') return fakeExec(command, args, options)
      const error = new Error('detected dubious ownership in repository')
      error.stderr = 'fatal: detected dubious ownership in repository'
      throw error
    },
    ownershipReceipts: [guided]
  })
  assert(dubious.issues.some(issue => issue.code === 'GIT_DUBIOUS_OWNERSHIP'))

  const externalWithAuthorization = createWorktreeLifecycleReceipt({
    ...guided,
    owner: 'external-unowned',
    createdByRunId: null,
    teardownPlan: null,
    cleanupAuthorization: 'explicit-confirmed',
    cleanupAuthorizationEvidenceRefs: ['user-confirmation:invalid-external-cleanup']
  })
  assert(externalWithAuthorization.validation.errors.includes('external-cleanup-authorization-forbidden'))
  assert.strictEqual(externalWithAuthorization.validation.cleanupEligible, false)

  const unavailable = inspectWorktreeLifecycle(root, {
    execFileSync() {
      const error = new Error('not a git repository')
      error.stderr = 'fatal: not a git repository'
      throw error
    }
  })
  assert.strictEqual(unavailable.status, 'UNVERIFIED')
  assert.strictEqual(unavailable.issues[0].code, 'GIT_REPOSITORY_NOT_FOUND')
  assert.strictEqual(unavailable.mutationEvidence.mutationCount, 0)

  const schema = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'content', 'skills', 'execution-contract', 'worktree-lifecycle-receipt.v1.schema.json'),
    'utf8'
  ))
  assert.strictEqual(schema.title, 'WorktreeLifecycleReceiptV1')
  const diagnosticsSchema = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'content', 'skills', 'execution-contract', 'worktree-diagnostics.v1.schema.json'),
    'utf8'
  ))
  assert.strictEqual(diagnosticsSchema.title, 'WorktreeDiagnosticsV1')

  console.log('worktree lifecycle passed: owned/external/dirty/locked/prunable/bounded/no-mutation/dubious-ownership')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
