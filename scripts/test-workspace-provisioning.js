#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  createDefaultProvisioningDecision,
  provisionWorkspaceEvolutionLayout,
  validateProvisioningDecision,
  validateWorkspaceProvisioningReceipt
} = require('./lib/workspace-provisioning')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-workspace-provisioning-'))

try {
  const workspaceRuntimeRoot = path.join(root, '.devcodex', 'workspace')
  const decision = createDefaultProvisioningDecision(workspaceRuntimeRoot)
  assert.strictEqual(decision.validation.valid, true)
  assert.strictEqual(validateProvisioningDecision(decision, workspaceRuntimeRoot).valid, true)

  const planned = provisionWorkspaceEvolutionLayout({
    workspaceRuntimeRoot,
    dryRun: true,
    targetDecision: decision
  })
  assert.strictEqual(planned.schemaVersion, 'WorkspaceProvisioningReceiptV1')
  assert.strictEqual(planned.status, 'planned')
  assert.strictEqual(planned.summary.planned, 3)
  assert.strictEqual(validateWorkspaceProvisioningReceipt(planned).valid, true)
  assert.strictEqual(fs.existsSync(path.join(workspaceRuntimeRoot, 'evolution')), false, 'dry-run must be zero-write')

  const fresh = provisionWorkspaceEvolutionLayout({ workspaceRuntimeRoot, targetDecision: decision })
  assert.strictEqual(fresh.status, 'fresh')
  assert.strictEqual(fresh.summary.fresh, 3)
  assert.strictEqual(validateWorkspaceProvisioningReceipt(fresh).valid, true)
  assert(fresh.paths.every(entry => fs.statSync(entry.path).isDirectory()))
  assert(fresh.paths.every(entry => !entry.path.includes(`${path.sep}skills${path.sep}`)))

  const candidateSentinel = path.join(workspaceRuntimeRoot, 'evolution', 'candidates', 'keep.txt')
  fs.writeFileSync(candidateSentinel, 'preserve', 'utf8')
  const existing = provisionWorkspaceEvolutionLayout({ workspaceRuntimeRoot, targetDecision: decision })
  assert.strictEqual(existing.status, 'existing')
  assert.strictEqual(existing.summary.existing, 3)
  assert.strictEqual(validateWorkspaceProvisioningReceipt(existing).valid, true)
  assert.strictEqual(fs.readFileSync(candidateSentinel, 'utf8'), 'preserve', 'existing content must not be overwritten')

  assert.throws(
    () => provisionWorkspaceEvolutionLayout({ workspaceRuntimeRoot }),
    error => error.code === 'WORKSPACE_PROVISIONING_DECISION_REQUIRED' && error.receipt?.status === 'failed'
  )
  assert.throws(
    () => provisionWorkspaceEvolutionLayout({ workspaceRuntimeRoot: 'relative/workspace', targetDecision: decision }),
    error => error.code === 'WORKSPACE_PROVISIONING_ROOT_INVALID' && error.receipt?.status === 'failed'
  )
  assert.throws(
    () => provisionWorkspaceEvolutionLayout({
      workspaceRuntimeRoot,
      targetDecision: { ...decision, activeRoot: path.join(root, 'other', '.devcodex', 'workspace') }
    }),
    error => error.code === 'WORKSPACE_PROVISIONING_DECISION_INVALID' &&
      error.message.includes('activeRoot-workspace-runtime-mismatch')
  )
  assert.throws(
    () => provisionWorkspaceEvolutionLayout({
      workspaceRuntimeRoot,
      targetDecision: { ...decision, target: 'project-local' }
    }),
    error => error.code === 'WORKSPACE_PROVISIONING_DECISION_INVALID' && error.receipt?.status === 'failed'
  )

  const linkRoot = path.join(root, 'symlink-boundary', '.devcodex', 'workspace')
  const outsideEvolution = path.join(root, 'outside-evolution')
  fs.mkdirSync(linkRoot, { recursive: true })
  fs.mkdirSync(outsideEvolution, { recursive: true })
  fs.symlinkSync(outsideEvolution, path.join(linkRoot, 'evolution'), process.platform === 'win32' ? 'junction' : 'dir')
  const linkDecision = createDefaultProvisioningDecision(linkRoot)
  assert.throws(
    () => provisionWorkspaceEvolutionLayout({ workspaceRuntimeRoot: linkRoot, targetDecision: linkDecision }),
    error => error.code === 'WORKSPACE_PROVISIONING_PATH_UNSAFE'
  )
  assert.strictEqual(fs.existsSync(path.join(outsideEvolution, 'candidates')), false, 'symlink boundary must remain zero-write')

  const failureRoot = path.join(root, 'mkdir-failure', '.devcodex', 'workspace')
  const failureDecision = createDefaultProvisioningDecision(failureRoot)
  const failingFs = {
    ...fs,
    mkdirSync(target, options) {
      if (String(target).endsWith(`${path.sep}decisions`)) {
        const error = new Error('synthetic mkdir denial')
        error.code = 'EACCES'
        throw error
      }
      return fs.mkdirSync(target, options)
    }
  }
  let failedProvisioning = null
  assert.throws(
    () => {
      try {
        provisionWorkspaceEvolutionLayout({
      fsImpl: failingFs,
      workspaceRuntimeRoot: failureRoot,
      targetDecision: failureDecision
        })
      } catch (error) {
        failedProvisioning = error.receipt
        throw error
      }
    },
    error => error.code === 'WORKSPACE_PROVISIONING_MKDIR_FAILED' &&
      error.receipt?.status === 'failed' &&
      error.receipt?.failure?.partialWritesPreserved === true
  )
  assert.strictEqual(validateWorkspaceProvisioningReceipt(failedProvisioning).valid, true)
  const uninspected = failedProvisioning.paths.find(entry => entry.inspectionState === 'not-inspected')
  assert(uninspected)
  assert.strictEqual(uninspected.existedBefore, null)

  const forgedReceipt = JSON.parse(JSON.stringify(fresh))
  forgedReceipt.summary.fresh = 2
  assert.strictEqual(validateWorkspaceProvisioningReceipt(forgedReceipt).valid, false)

  const forgedRelativeRoot = JSON.parse(JSON.stringify(planned))
  forgedRelativeRoot.workspaceRuntimeRoot = path.join('relative', 'workspace')
  forgedRelativeRoot.paths = forgedRelativeRoot.paths.map(entry => ({
    ...entry,
    path: path.join(forgedRelativeRoot.workspaceRuntimeRoot, 'evolution', entry.role)
  }))
  assert.strictEqual(validateWorkspaceProvisioningReceipt(forgedRelativeRoot).valid, false)

  const forgedMissingDecision = JSON.parse(JSON.stringify(planned))
  forgedMissingDecision.targetDecisionId = null
  assert.strictEqual(validateWorkspaceProvisioningReceipt(forgedMissingDecision).valid, false)

  const forgedFailureCode = JSON.parse(JSON.stringify(failedProvisioning))
  forgedFailureCode.failure.code = 'FORGED_FAILURE_CODE'
  assert.strictEqual(validateWorkspaceProvisioningReceipt(forgedFailureCode).valid, false)

  const schema = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'content', 'skills', 'evolution-governance', 'workspace-provisioning-receipt.v1.schema.json'),
    'utf8'
  ))
  assert.strictEqual(schema.title, 'WorkspaceProvisioningReceiptV1')

  const installSource = fs.readFileSync(path.join(__dirname, 'lib', 'cli-install-commands.js'), 'utf8')
  const callerLines = installSource.split(/\r?\n/).filter(line => line.includes('ensureRuntimeDirs('))
  assert(callerLines.length >= 6)
  assert(callerLines.every(line => line.includes('consumeWorkspaceProvisioningReceipt(')))
  assert(!/if\s*\(!dryRun\)\s*{\s*consumeWorkspaceProvisioningReceipt\(ensureRuntimeDirs\(/s.test(installSource),
    'host init dry-runs must still consume a planned workspace provisioning receipt')
  assert(installSource.includes('ensureRuntimeDirs(invocationCwd, options.dryRun === true)'),
    'owner-routed dry-runs must preserve the dryRun flag when provisioning the invocation project')
  const workspaceInitSource = fs.readFileSync(path.join(__dirname, 'lib', 'cli-workspace-init-command.js'), 'utf8')
  assert(workspaceInitSource.includes('workspaceProvisioning = ensureRuntimeDirs('))
  const maintenanceSource = fs.readFileSync(path.join(__dirname, 'lib', 'cli-maintenance-commands.js'), 'utf8')
  assert(!maintenanceSource.includes('ensureRuntimeDirs('), 'status/doctor must not provision implicitly')

  console.log('workspace provisioning passed: planned/fresh/existing/failed/no-overwrite/caller receipts/read-only diagnostics')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
