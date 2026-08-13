#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { applyGlobalHostConfig } = require('./lib/global-host-config.js')
const {
  applyGlobalHostRemoval,
  buildGrokConfigCompensationOperation,
  buildGlobalHostRemovalPlan,
  cleanupGrokRecoveryArtifact,
  digestText
} = require('./lib/global-host-removal.js')
const { removeGrokPluginRegistration } = require('./lib/host-adapter-scope.js')
const { resolveGlobalHostTargets } = require('./lib/global-host-target.js')
const { executeGlobalHostTransaction } = require('./lib/global-host-config-transaction.js')
const { operationDigest } = require('./lib/global-host-config-transaction.js')
const { mergeManagedBlock, removeManagedBlock } = require('./lib/global-host-config-merge.js')

const packageRoot = path.resolve(__dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-global-host-removal-'))
let cleaned = false
function cleanup() {
  if (cleaned) return
  fs.rmSync(tmp, { recursive: true, force: true })
  cleaned = true
}

// A tampered recovery manifest is reported and preserved instead of being deleted.
{
  const root = path.join(tmp, 'recovery-proof', '.tmp', 'devcodex')
  const backupPath = path.join(root, 'backups', 'grok', 'config.toml.bak')
  const manifestPath = path.join(root, 'manifests', 'backup-tampered.json')
  fs.mkdirSync(path.dirname(backupPath), { recursive: true })
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
  fs.writeFileSync(backupPath, 'user config\n')
  fs.writeFileSync(manifestPath, JSON.stringify({
    schemaVersion: 'WorkspaceTempManifestV1',
    owner: 'different-owner',
    producer: 'grok-plugin-uninstall',
    targetPath: backupPath
  }, null, 2) + '\n')
  const cleanupResult = cleanupGrokRecoveryArtifact({
    backupPath,
    backupManifestPath: manifestPath,
    beforeDigest: digestText('user config\n')
  })
  assert.strictEqual(cleanupResult.status, 'blocked')
  assert.strictEqual(fs.existsSync(backupPath), true)
  assert.strictEqual(fs.existsSync(manifestPath), true)
}
process.once('exit', cleanup)

function fixture(name) {
  const home = path.join(tmp, name)
  fs.mkdirSync(home, { recursive: true })
  const env = {
    ...process.env,
    DEVCODEX_TEST_HOME: home,
    USERPROFILE: home,
    HOME: home,
    CODEX_HOME: path.join(home, '.codex'),
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    GEMINI_CLI_HOME: path.join(home, 'gemini-cli-home'),
    GROK_HOME: path.join(home, '.grok'),
    CURSOR_HOME: path.join(home, '.cursor'),
    COPILOT_HOME: path.join(home, '.copilot'),
    DEVCODEX_VSCODE_USER_DIR: path.join(home, 'vscode-user')
  }
  return { home, env }
}

function fakeGrokUninstall() {
  return {
    schemaVersion: 'GrokPluginUninstallReceiptV1',
    status: 'already-absent',
    installedRepoId: null,
    dryRun: false
  }
}

// Mixed write/remove transaction rollback is atomic.
{
  const root = path.join(tmp, 'transaction')
  fs.mkdirSync(root, { recursive: true })
  const removeFile = path.join(root, 'remove.txt')
  const writeFile = path.join(root, 'write.txt')
  fs.writeFileSync(removeFile, 'owned\n')
  fs.writeFileSync(writeFile, 'before\n')
  assert.throws(() => executeGlobalHostTransaction([
    { host: 'test', action: 'remove', path: removeFile, kind: 'text' },
    { host: 'test', action: 'write', path: writeFile, kind: 'text', content: 'after\n' }
  ], {
    allowedRoots: [root],
    allowedByHost: { test: { allowedRoots: [root], allowedFiles: [] } },
    failAfter: 1
  }), /GLOBAL_HOST_TEST_INJECTED_FAILURE/)
  assert.strictEqual(fs.readFileSync(removeFile, 'utf8'), 'owned\n')
  assert.strictEqual(fs.readFileSync(writeFile, 'utf8'), 'before\n')
  const expectedDigest = operationDigest(fs.readFileSync(removeFile))
  fs.writeFileSync(removeFile, 'concurrent user change\n')
  assert.throws(() => executeGlobalHostTransaction([
    { host: 'test', action: 'remove', path: removeFile, kind: 'text', expectedDigest }
  ], {
    allowedRoots: [root],
    allowedByHost: { test: { allowedRoots: [root], allowedFiles: [] } }
  }), error => error.code === 'GLOBAL_HOST_OPERATION_PRECONDITION_FAILED')
  assert.strictEqual(fs.readFileSync(removeFile, 'utf8'), 'concurrent user change\n')

  assert.throws(() => executeGlobalHostTransaction([
    { host: 'test', action: 'remove', path: removeFile, kind: 'text', expectAbsent: true }
  ], {
    allowedRoots: [root],
    allowedByHost: { test: { allowedRoots: [root], allowedFiles: [] } }
  }), error => error.code === 'GLOBAL_HOST_OPERATION_PRECONDITION_FAILED')
  assert.strictEqual(fs.readFileSync(removeFile, 'utf8'), 'concurrent user change\n')

  let destinationChecks = 0
  const revalidatingFs = Object.create(fs)
  revalidatingFs.lstatSync = file => {
    const stat = fs.lstatSync(file)
    if (path.resolve(file) === path.resolve(writeFile) && ++destinationChecks > 1) {
      return { isSymbolicLink: () => true, isFile: () => true }
    }
    return stat
  }
  assert.throws(() => executeGlobalHostTransaction([
    { host: 'test', action: 'write', path: writeFile, kind: 'text', content: 'unsafe\n' }
  ], {
    fs: revalidatingFs,
    allowedRoots: [root],
    allowedByHost: { test: { allowedRoots: [root], allowedFiles: [] } }
  }), error => ['GLOBAL_HOST_OPERATION_REPARSE', 'GLOBAL_HOST_OPERATION_SYMLINK'].includes(error.code))
  assert.strictEqual(fs.readFileSync(writeFile, 'utf8'), 'before\n')
}

// Managed block removal preserves suffix bytes and only collapses its own append separator.
{
  const installed = mergeManagedBlock('user prefix\n', 'managed body', {
    kind: 'markdown',
    id: 'preservation-test'
  })
  assert.strictEqual(removeManagedBlock(installed, {
    kind: 'markdown',
    id: 'preservation-test'
  }), 'user prefix\n')
  const withSuffix = `${installed}  user suffix  \n\n`
  assert.strictEqual(removeManagedBlock(withSuffix, {
    kind: 'markdown',
    id: 'preservation-test'
  }), 'user prefix\n\n  user suffix  \n\n')
}

// Six-host apply → preview → remove, preserving user-owned content.
{
  const { home, env } = fixture('six-host')
  const targets = resolveGlobalHostTargets({ home, env, packageRoot })
  fs.mkdirSync(path.dirname(targets.find(item => item.host === 'codex').files.instructions), { recursive: true })
  fs.writeFileSync(targets.find(item => item.host === 'codex').files.instructions, '# User Codex instruction\n')
  fs.mkdirSync(path.dirname(targets.find(item => item.host === 'claude').files.settings), { recursive: true })
  fs.writeFileSync(targets.find(item => item.host === 'claude').files.settings, JSON.stringify({
    theme: 'dark',
    hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'node user-hook.cjs' }] }] }
  }, null, 2) + '\n')
  fs.mkdirSync(path.dirname(targets.find(item => item.host === 'codex').files.config), { recursive: true })
  fs.writeFileSync(targets.find(item => item.host === 'codex').files.config, 'model = "gpt-user"\n')
  const preservedCopilotHooksRoot = path.dirname(targets.find(item => item.host === 'copilot').files.hooks)
  const preservedSharedSkillsRoot = targets[0].shared.skills
  fs.mkdirSync(preservedCopilotHooksRoot, { recursive: true })
  fs.mkdirSync(preservedSharedSkillsRoot, { recursive: true })

  const applied = applyGlobalHostConfig({ packageRoot, home, env })
  assert.strictEqual(applied.transaction.status, 'committed')
  const cursorTarget = targets.find(item => item.host === 'cursor')
  const legacyRuntime = path.join(cursorTarget.runtimeBaseRoot, 'runtime-legacy-removal-fixture')
  fs.cpSync(cursorTarget.runtimeRoot, legacyRuntime, { recursive: true })
  const legacyReceipt = JSON.parse(fs.readFileSync(cursorTarget.receiptFile, 'utf8'))
  const remapLegacy = file => path.resolve(file).startsWith(path.resolve(cursorTarget.runtimeRoot) + path.sep)
    ? path.join(legacyRuntime, path.relative(cursorTarget.runtimeRoot, path.resolve(file))).replace(/\\/g, '/')
    : String(file).replace(/\\/g, '/')
  legacyReceipt.runtimeRoot = legacyRuntime.replace(/\\/g, '/')
  legacyReceipt.managedPaths = legacyReceipt.managedPaths.map(remapLegacy)
  legacyReceipt.configFiles = legacyReceipt.configFiles.map(remapLegacy)
  legacyReceipt.managedFileDigests = Object.fromEntries(
    Object.entries(legacyReceipt.managedFileDigests).map(([file, digest]) => [remapLegacy(file), digest])
  )
  delete legacyReceipt.managedArtifacts
  delete legacyReceipt.retainedManagedArtifacts
  delete legacyReceipt.retainedRuntimeRoots
  fs.writeFileSync(cursorTarget.receiptFile, JSON.stringify(legacyReceipt, null, 2) + '\n')
  const upgraded = applyGlobalHostConfig({ packageRoot, home, env })
  assert.strictEqual(upgraded.transaction.status, 'committed')
  const upgradedCursorReceipt = JSON.parse(fs.readFileSync(cursorTarget.receiptFile, 'utf8'))
  assert.ok(upgradedCursorReceipt.retainedManagedArtifacts.length > 0, 'upgraded receipt must retain old runtime ownership')
  const missingManagedRuntimeFile = upgradedCursorReceipt.managedPaths
    .map(file => path.resolve(file))
    .find(file => file.startsWith(path.resolve(cursorTarget.runtimeRoot) + path.sep) && fs.lstatSync(file).isFile())
  assert.ok(missingManagedRuntimeFile)
  fs.rmSync(missingManagedRuntimeFile)
  const beforePreview = fs.readFileSync(targets.find(item => item.host === 'codex').files.instructions, 'utf8')
  const preview = applyGlobalHostRemoval({
    packageRoot,
    home,
    env,
    dryRun: true,
    uninstallGrokPluginInstallation: fakeGrokUninstall
  })
  assert.strictEqual(preview.status, 'planned')
  assert.strictEqual(fs.readFileSync(targets.find(item => item.host === 'codex').files.instructions, 'utf8'), beforePreview)

  const removed = applyGlobalHostRemoval({
    packageRoot,
    home,
    env,
    uninstallGrokPluginInstallation: fakeGrokUninstall
  })
  assert.strictEqual(removed.status, 'committed')
  for (const target of targets) assert.strictEqual(fs.existsSync(target.receiptFile), false, target.host)
  assert.strictEqual(fs.readFileSync(targets.find(item => item.host === 'codex').files.instructions, 'utf8'), '# User Codex instruction\n')
  assert.match(fs.readFileSync(targets.find(item => item.host === 'codex').files.config, 'utf8'), /model = "gpt-user"/)
  const claude = JSON.parse(fs.readFileSync(targets.find(item => item.host === 'claude').files.settings, 'utf8'))
  assert.strictEqual(claude.theme, 'dark')
  assert.strictEqual(Object.prototype.hasOwnProperty.call(claude, '$schema'), false)
  assert.match(JSON.stringify(claude.hooks), /user-hook\.cjs/)
  assert.doesNotMatch(JSON.stringify(claude), /devcodex/i)
  assert.strictEqual(fs.existsSync(legacyRuntime), false, 'retained legacy runtime must be removed')
  assert.strictEqual(fs.existsSync(cursorTarget.runtimeBaseRoot), false, 'exclusive Cursor runtime root must be pruned')
  assert.strictEqual(fs.existsSync(preservedCopilotHooksRoot), true, 'pre-existing host hook root must be preserved')
  assert.strictEqual(fs.existsSync(preservedSharedSkillsRoot), true, 'shared native skill scan root must be preserved')

  const second = applyGlobalHostRemoval({
    packageRoot,
    home,
    env,
    uninstallGrokPluginInstallation: fakeGrokUninstall
  })
  assert.strictEqual(second.status, 'already-absent')
}

// Grok's official uninstall may authoritatively remove its own registration before the file transaction.
{
  const { home, env } = fixture('grok-authorized-mutation')
  const applied = applyGlobalHostConfig({ packageRoot, home, env, hosts: ['grok'] })
  assert.strictEqual(applied.transaction.status, 'committed')
  const target = resolveGlobalHostTargets({ home, env, packageRoot, hosts: ['grok'] })[0]
  const before = fs.readFileSync(target.files.config, 'utf8')
  const after = removeGrokPluginRegistration(before, target.files.plugin).desired
  const tempRoot = path.join(home, '.tmp', 'devcodex')
  const backupPath = path.join(tempRoot, 'backups', 'grok', 'config.toml.bak')
  const backupManifestPath = path.join(tempRoot, 'manifests', 'backup-grok-removal.json')
  fs.mkdirSync(path.dirname(backupPath), { recursive: true })
  fs.mkdirSync(path.dirname(backupManifestPath), { recursive: true })
  fs.writeFileSync(backupPath, before)
  fs.writeFileSync(backupManifestPath, JSON.stringify({
    schemaVersion: 'WorkspaceTempManifestV1',
    artifactId: 'backup-grok-removal',
    type: 'backup',
    owner: 'devcodex-grok-adapter',
    project: 'grok',
    producer: 'grok-plugin-uninstall',
    targetPath: backupPath.replace(/\\/g, '/'),
    cleanupPolicy: 'delete',
    transactionStatus: 'completed'
  }, null, 2) + '\n')
  const uninstall = ({ dryRun }) => {
    if (dryRun) {
      return {
        schemaVersion: 'GrokPluginUninstallReceiptV1',
        status: 'planned-uninstall',
        installedRepoId: 'local:devcodex-workspace',
        configChanged: true,
        dryRun: true
      }
    }
    if (after === '') fs.rmSync(target.files.config)
    else fs.writeFileSync(target.files.config, after)
    return {
      schemaVersion: 'GrokPluginUninstallReceiptV1',
      status: 'uninstalled',
      installedRepoId: 'local:devcodex-workspace',
      configChanged: true,
      beforeDigest: digestText(before),
      afterDigest: digestText(after),
      backupPath,
      backupManifestPath,
      dryRun: false
    }
  }
  const removed = applyGlobalHostRemoval({
    packageRoot,
    home,
    env,
    hosts: ['grok'],
    uninstallGrokPluginInstallation: uninstall
  })
  assert.strictEqual(removed.status, 'committed')
  assert.strictEqual(fs.existsSync(target.receiptFile), false)
  assert.strictEqual(fs.existsSync(target.files.config), false)
  assert.strictEqual(removed.grokRecoveryCleanup.status, 'committed')
  assert.strictEqual(fs.existsSync(backupPath), false)
  assert.strictEqual(fs.existsSync(backupManifestPath), false)
}

// If Grok mutates configuration and then throws, restore the snapshot and official registration.
{
  const { home, env } = fixture('grok-compensation')
  const applied = applyGlobalHostConfig({ packageRoot, home, env, hosts: ['grok'] })
  assert.strictEqual(applied.transaction.status, 'committed')
  const target = resolveGlobalHostTargets({ home, env, packageRoot, hosts: ['grok'] })[0]
  const before = fs.readFileSync(target.files.config, 'utf8')
  let syncCalls = 0
  let capturedError = null
  try {
    applyGlobalHostRemoval({
      packageRoot,
      home,
      env,
      hosts: ['grok'],
      uninstallGrokPluginInstallation: ({ dryRun }) => {
        if (dryRun) {
          return {
            schemaVersion: 'GrokPluginUninstallReceiptV1',
            status: 'planned-uninstall',
            installedRepoId: 'local:devcodex-workspace',
            configChanged: true,
            dryRun: true
          }
        }
        fs.rmSync(target.files.config)
        const error = new Error('GROK_TEST_FAILURE_AFTER_MUTATION')
        error.code = 'GROK_TEST_FAILURE_AFTER_MUTATION'
        throw error
      },
      syncGrokWorkspacePluginInstallation: () => {
        syncCalls += 1
        return { status: 'verified' }
      }
    })
  } catch (error) {
    capturedError = error
  }
  assert.ok(capturedError)
  assert.strictEqual(capturedError.code, 'GROK_TEST_FAILURE_AFTER_MUTATION')
  assert.deepStrictEqual(capturedError.removalCompensation, {
    applicable: true,
    configRestored: true,
    registrationRestored: true,
    errors: []
  })
  assert.strictEqual(syncCalls, 1)
  assert.strictEqual(fs.readFileSync(target.files.config, 'utf8'), before)
  assert.strictEqual(fs.existsSync(target.receiptFile), true)
}

// Compensation never overwrites a concurrently changed Grok configuration without after-state proof.
{
  const { home, env } = fixture('grok-compensation-drift')
  const applied = applyGlobalHostConfig({ packageRoot, home, env, hosts: ['grok'] })
  assert.strictEqual(applied.transaction.status, 'committed')
  const target = resolveGlobalHostTargets({ home, env, packageRoot, hosts: ['grok'] })[0]
  const before = fs.readFileSync(target.files.config, 'utf8')
  const concurrent = `${before}\n# concurrent user edit\n`
  let syncCalls = 0
  let capturedError = null
  try {
    applyGlobalHostRemoval({
      packageRoot,
      home,
      env,
      hosts: ['grok'],
      uninstallGrokPluginInstallation: ({ dryRun }) => {
        if (dryRun) {
          return {
            schemaVersion: 'GrokPluginUninstallReceiptV1',
            status: 'planned-uninstall',
            installedRepoId: 'local:devcodex-workspace',
            configChanged: true,
            dryRun: true
          }
        }
        fs.writeFileSync(target.files.config, concurrent)
        const error = new Error('GROK_TEST_FAILURE_WITH_CONCURRENT_EDIT')
        error.code = 'GROK_TEST_FAILURE_WITH_CONCURRENT_EDIT'
        throw error
      },
      syncGrokWorkspacePluginInstallation: () => {
        syncCalls += 1
        return { status: 'verified' }
      }
    })
  } catch (error) {
    capturedError = error
  }
  assert.ok(capturedError)
  assert.strictEqual(capturedError.code, 'GLOBAL_HOST_REMOVAL_ROLLBACK_INCOMPLETE')
  assert.strictEqual(capturedError.removalCompensation.configRestored, false)
  assert.strictEqual(capturedError.removalCompensation.registrationRestored, false)
  assert.match(capturedError.removalCompensation.errors.join('\n'), /COMPENSATION_DRIFT/)
  assert.strictEqual(syncCalls, 0)
  assert.strictEqual(fs.readFileSync(target.files.config, 'utf8'), concurrent)

  assert.throws(() => buildGrokConfigCompensationOperation({
    path: target.files.config,
    existed: false,
    content: ''
  }, null), error => error.code === 'GLOBAL_HOST_REMOVAL_GROK_COMPENSATION_DRIFT')
}

// Structured modifications, unknown runtime files and receipt path escapes each block globally.
{
  const { home, env } = fixture('preflight-negative')
  const applied = applyGlobalHostConfig({ packageRoot, home, env })
  assert.strictEqual(applied.transaction.status, 'committed')
  const targets = resolveGlobalHostTargets({ home, env, packageRoot })
  const claudeSettings = targets.find(item => item.host === 'claude').files.settings
  const claudeOriginal = fs.readFileSync(claudeSettings, 'utf8')
  const claudeChanged = JSON.parse(claudeOriginal)
  claudeChanged.hooks.PreToolUse[0].hooks[0].timeout = 999
  fs.writeFileSync(claudeSettings, JSON.stringify(claudeChanged, null, 2) + '\n')
  let plan = buildGlobalHostRemovalPlan({ packageRoot, home, env })
  assert.strictEqual(plan.status, 'blocked')
  assert.ok(plan.conflicts.some(item => item.errorCode === 'GLOBAL_HOST_JSON_MANAGED_CONFLICT'))
  fs.writeFileSync(claudeSettings, claudeOriginal)

  const claudeMalformedHook = JSON.parse(claudeOriginal)
  claudeMalformedHook.hooks.PreToolUse = 'npx devcodex hook'
  fs.writeFileSync(claudeSettings, JSON.stringify(claudeMalformedHook, null, 2) + '\n')
  plan = buildGlobalHostRemovalPlan({ packageRoot, home, env })
  assert.strictEqual(plan.status, 'blocked')
  assert.ok(plan.conflicts.some(item => item.errorCode === 'GLOBAL_HOST_JSON_MANAGED_CONFLICT'))
  fs.writeFileSync(claudeSettings, claudeOriginal)

  const claudeMalformedServerMap = JSON.parse(claudeOriginal)
  claudeMalformedServerMap.mcpServers = 'npx devcodex profile'
  fs.writeFileSync(claudeSettings, JSON.stringify(claudeMalformedServerMap, null, 2) + '\n')
  plan = buildGlobalHostRemovalPlan({ packageRoot, home, env })
  assert.strictEqual(plan.status, 'blocked')
  assert.ok(plan.conflicts.some(item => item.errorCode === 'GLOBAL_HOST_JSON_MANAGED_CONFLICT'))
  fs.writeFileSync(claudeSettings, claudeOriginal)

  const copilotInstructions = targets.find(item => item.host === 'copilot').files.instructions
  const copilotOriginal = fs.readFileSync(copilotInstructions, 'utf8')
  fs.writeFileSync(copilotInstructions, copilotOriginal.replace(
    '<!-- END DEVCODEX MANAGED: global-copilot -->',
    'modified managed body\n<!-- END DEVCODEX MANAGED: global-copilot -->'
  ))
  plan = buildGlobalHostRemovalPlan({ packageRoot, home, env })
  assert.strictEqual(plan.status, 'blocked')
  assert.ok(plan.conflicts.some(item => item.errorCode === 'GLOBAL_HOST_REMOVAL_MANAGED_BLOCK_MODIFIED'))
  fs.writeFileSync(copilotInstructions, copilotOriginal)

  fs.writeFileSync(copilotInstructions, copilotOriginal
    .replace('<!-- BEGIN DEVCODEX MANAGED: global-copilot -->', '')
    .replace('<!-- END DEVCODEX MANAGED: global-copilot -->', ''))
  plan = buildGlobalHostRemovalPlan({ packageRoot, home, env })
  assert.strictEqual(plan.status, 'blocked')
  assert.ok(plan.conflicts.some(item => item.errorCode === 'GLOBAL_HOST_REMOVAL_MANAGED_BLOCK_MISSING'))
  fs.writeFileSync(copilotInstructions, copilotOriginal)

  const cursorTarget = targets.find(item => item.host === 'cursor')
  const unknownEmptyDirectory = path.join(cursorTarget.runtimeRoot, 'user-empty-directory')
  fs.mkdirSync(unknownEmptyDirectory)
  plan = buildGlobalHostRemovalPlan({ packageRoot, home, env })
  assert.strictEqual(plan.status, 'blocked')
  assert.ok(plan.conflicts.some(item => item.errorCode === 'GLOBAL_HOST_REMOVAL_UNKNOWN_MANAGED_ROOT_CONTENT'))
  fs.rmdirSync(unknownEmptyDirectory)

  const unknown = path.join(cursorTarget.runtimeRoot, 'user-unknown.txt')
  fs.writeFileSync(unknown, 'preserve and block\n')
  plan = buildGlobalHostRemovalPlan({ packageRoot, home, env })
  assert.strictEqual(plan.status, 'blocked')
  assert.ok(plan.conflicts.some(item => item.errorCode === 'GLOBAL_HOST_REMOVAL_UNKNOWN_MANAGED_ROOT_CONTENT'))
  fs.rmSync(unknown)

  const receipt = JSON.parse(fs.readFileSync(cursorTarget.receiptFile, 'utf8'))
  receipt.managedPaths.push(path.join(tmp, 'outside-owned.txt'))
  receipt.managedFileDigests[path.join(tmp, 'outside-owned.txt').replace(/\\/g, '/')] = '0'.repeat(64)
  fs.writeFileSync(cursorTarget.receiptFile, JSON.stringify(receipt, null, 2) + '\n')
  plan = buildGlobalHostRemovalPlan({ packageRoot, home, env })
  assert.strictEqual(plan.status, 'blocked')
  assert.ok(plan.conflicts.some(item => item.errorCode === 'GLOBAL_HOST_REMOVAL_PATH_OUTSIDE_ROOT'))
}

// A poisoned receipt cannot reclassify an arbitrary host file as a whole-file artifact.
{
  const { home, env } = fixture('receipt-poisoning')
  const applied = applyGlobalHostConfig({ packageRoot, home, env })
  assert.strictEqual(applied.transaction.status, 'committed')
  const cursorTarget = resolveGlobalHostTargets({ home, env, packageRoot })
    .find(item => item.host === 'cursor')
  const userFile = path.join(cursorTarget.root, 'user-owned.txt')
  fs.writeFileSync(userFile, 'keep me\n')
  const receipt = JSON.parse(fs.readFileSync(cursorTarget.receiptFile, 'utf8'))
  const portableUserFile = userFile.replace(/\\/g, '/')
  receipt.managedPaths.push(portableUserFile)
  receipt.managedFileDigests[portableUserFile] = digestText('keep me\n')
  receipt.managedArtifacts.push({
    path: portableUserFile,
    ownershipKind: 'whole-file',
    managedDigest: digestText('keep me\n'),
    contentDigest: digestText('keep me\n')
  })
  fs.writeFileSync(cursorTarget.receiptFile, JSON.stringify(receipt, null, 2) + '\n')
  const plan = buildGlobalHostRemovalPlan({ packageRoot, home, env })
  assert.strictEqual(plan.status, 'blocked')
  assert.ok(plan.conflicts.some(item => item.errorCode === 'GLOBAL_HOST_REMOVAL_PATH_NOT_MANAGED'))
  assert.strictEqual(fs.readFileSync(userFile, 'utf8'), 'keep me\n')
}

// Receipt ownership proof must itself be a bounded regular file.
{
  const { home, env } = fixture('receipt-not-regular')
  const cursorTarget = resolveGlobalHostTargets({ home, env, packageRoot, hosts: ['cursor'] })[0]
  fs.mkdirSync(cursorTarget.receiptFile, { recursive: true })
  const plan = buildGlobalHostRemovalPlan({ packageRoot, home, env, hosts: ['cursor'] })
  assert.strictEqual(plan.status, 'blocked')
  assert.ok(plan.conflicts.some(item => item.errorCode === 'GLOBAL_HOST_REMOVAL_RECEIPT_NOT_REGULAR'))
}

// End-to-end transaction failure restores all host receipts and files.
{
  const { home, env } = fixture('end-to-end-rollback')
  const applied = applyGlobalHostConfig({ packageRoot, home, env })
  assert.strictEqual(applied.transaction.status, 'committed')
  const targets = resolveGlobalHostTargets({ home, env, packageRoot })
  const receiptSnapshots = new Map(targets.map(target => [target.receiptFile, fs.readFileSync(target.receiptFile, 'utf8')]))
  const removalPlan = buildGlobalHostRemovalPlan({ packageRoot, home, env })
  const firstReceiptIndex = removalPlan.operations.findIndex(operation =>
    /global-host-receipt\.json$/i.test(operation.path)
  )
  assert.ok(firstReceiptIndex > 0)
  assert.throws(() => applyGlobalHostRemoval({
    packageRoot,
    home,
    env,
    failAfter: firstReceiptIndex + 1,
    uninstallGrokPluginInstallation: fakeGrokUninstall
  }), /GLOBAL_HOST_TEST_INJECTED_FAILURE/)
  for (const [file, content] of receiptSnapshots) {
    assert.strictEqual(fs.readFileSync(file, 'utf8'), content, `receipt rollback mismatch: ${file}`)
  }
}

// A modified whole-file artifact blocks all hosts before mutation.
{
  const { home, env } = fixture('modified')
  const applied = applyGlobalHostConfig({ packageRoot, home, env })
  assert.strictEqual(applied.transaction.status, 'committed')
  const targets = resolveGlobalHostTargets({ home, env, packageRoot })
  const modified = path.join(targets.find(item => item.host === 'cursor').runtimeRoot, 'AGENTS.md')
  fs.appendFileSync(modified, '\nuser modification\n')
  const sentinel = targets.find(item => item.host === 'copilot').receiptFile
  assert.throws(() => applyGlobalHostRemoval({
    packageRoot,
    home,
    env,
    uninstallGrokPluginInstallation: fakeGrokUninstall
  }), error => error.code === 'GLOBAL_HOST_REMOVAL_BLOCKED')
  assert.strictEqual(fs.existsSync(sentinel), true)
  assert.match(fs.readFileSync(modified, 'utf8'), /user modification/)
}

// Missing receipt with managed-looking residue fails closed; a clean home is idempotent.
{
  const { home, env } = fixture('receipt-missing')
  const cursorRoot = path.join(home, '.cursor', 'devcodex')
  fs.mkdirSync(cursorRoot, { recursive: true })
  fs.writeFileSync(path.join(cursorRoot, 'orphan.txt'), 'orphan')
  const plan = buildGlobalHostRemovalPlan({ packageRoot, home, env })
  assert.strictEqual(plan.status, 'blocked')
  assert.ok(plan.conflicts.some(item => item.host === 'cursor' && item.errorCode === 'GLOBAL_HOST_REMOVAL_RECEIPT_MISSING'))
}

{
  const { home, env } = fixture('receipt-missing-empty-runtime')
  const cursorRuntimeBase = path.join(home, '.cursor', 'devcodex')
  fs.mkdirSync(cursorRuntimeBase, { recursive: true })
  const plan = buildGlobalHostRemovalPlan({ packageRoot, home, env, hosts: ['cursor'] })
  assert.strictEqual(plan.status, 'blocked')
  assert.ok(plan.conflicts.some(item => item.errorCode === 'GLOBAL_HOST_REMOVAL_RECEIPT_MISSING'))
}

cleanup()
console.log('global host removal tests passed hosts=6 dryRun=1 atomicRollback=1 receiptLastRollback=1 grokCompensation=1 idempotent=1 userContent=1 receiptPoisoning=blocked failClosed=1')
