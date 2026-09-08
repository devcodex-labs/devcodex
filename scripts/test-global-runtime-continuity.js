#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')
const { applyGlobalHostRemoval, buildGlobalHostRemovalPlan } = require('./lib/global-host-removal.js')
const { acquireRuntimeGenerationLease, releaseRuntimeGenerationLease } = require('../hooks/_runtime/runtime-generation-lease.cjs')
const { mergeManagedBlock } = require('./lib/global-host-config-merge.js')
const { buildGlobalHostConfigPlan } = require('./lib/global-host-config.js')
const { resolveRuntimeGenerationRetentionState } = require('./lib/runtime-generation-retention.js')

const packageRoot = path.resolve(__dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-runtime-continuity-'))
const digest = value => crypto.createHash('sha256').update(value).digest('hex')
const portable = file => path.resolve(file).replace(/\\/g, '/')
function fixture(name) {
  const home = path.join(tmp, name)
  const base = path.join(home, '.codex', 'devcodex')
  const generationId = 'fixture-generation'
  const root = path.join(base, `runtime-${generationId}`)
  fs.mkdirSync(path.join(root, 'nested'), { recursive: true })
  const files = new Map([
    [path.join(root, 'runtime-generation.json'), JSON.stringify({
      schemaVersion: 'RuntimeGenerationManifestV1', generationId,
      runtimeRoot: '.', immutable: true, sourceDigest: digest(name)
    })],
    [path.join(root, 'nested', 'late-module.cjs'), 'module.exports = 17\n'],
    [path.join(base, '.runtime-generation-retention.json'), resolveRuntimeGenerationRetentionState(base, { generationId }).content]
  ])
  const instructions = path.join(home, '.codex', 'AGENTS.md')
  const managed = '# DevCodex test instruction\n'
  const managedBlock = mergeManagedBlock('', managed, { kind: 'markdown', id: 'global-codex' })
  const body = mergeManagedBlock('# User instruction\n', managed, { kind: 'markdown', id: 'global-codex' })
  files.set(instructions, body)
  for (const [file, text] of files) fs.writeFileSync(file, text)
  const receiptFile = path.join(base, 'global-host-receipt.json')
  fs.writeFileSync(receiptFile, JSON.stringify({
    schemaVersion: 'GlobalHostConfigReceiptV1', host: 'codex', packageName: 'devcodex', result: 'committed',
    runtimeRoot: portable(root), retainedRuntimeRoots: [],
    managedPaths: [...files.keys()].map(portable),
    managedFileDigests: Object.fromEntries([...files].map(([file, text]) =>
      [portable(file), digest(file === instructions ? managedBlock : text)])),
    managedArtifacts: [...files].map(([file, text]) => ({
      path: portable(file), ownershipKind: file === instructions ? 'markdown-block' : 'whole-file',
      managedDigest: digest(file === instructions ? managedBlock : text)
    }))
  }, null, 2) + '\n')
  return { home, base, root, generationId, receiptFile, instructions, options: {
    packageRoot, home, hosts: ['codex'],
    env: { ...process.env, DEVCODEX_TEST_HOME: home, HOME: home, USERPROFILE: home,
      CODEX_HOME: path.join(home, '.codex'), CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
      GEMINI_CLI_HOME: path.join(home, 'gemini-cli-home'), GROK_HOME: path.join(home, '.grok'),
      CURSOR_HOME: path.join(home, '.cursor'), COPILOT_HOME: path.join(home, '.copilot'),
      DEVCODEX_VSCODE_USER_DIR: path.join(home, 'vscode-user'),
      DEVCODEX_GLOBAL_SHARED_ROOT: path.join(home, '.agents') }
  } }
}

const results = []
try {
  const live = fixture('live')
  const lease = acquireRuntimeGenerationLease({ runtimeRoot: live.root, role: 'continuity-test', registerExit: false })
  assert.strictEqual(lease.status, 'active')
  try {
    const preview = buildGlobalHostRemovalPlan(live.options)
    assert.strictEqual(preview.status, 'planned', JSON.stringify(preview.conflicts))
    assert.strictEqual(preview.generations[0].reasonCode, 'live-process-lease')
    const expired = buildGlobalHostRemovalPlan({ ...live.options, nowMs: Date.now() + 3600000 })
    assert.strictEqual(expired.generations[0].reasonCode, 'generation-lease-evidence-incomplete')
    assert.strictEqual(expired.generations[0].leases.unknown[0].reasonCode, 'expired-lease-pid-still-live')
    const first = applyGlobalHostRemoval(live.options)
    assert.strictEqual(first.status, 'cleanup-incomplete')
    assert.strictEqual(fs.readFileSync(live.instructions, 'utf8'), '# User instruction\n')
    assert.strictEqual(fs.readFileSync(path.join(live.root, 'nested', 'late-module.cjs'), 'utf8'), 'module.exports = 17\n')
    assert.strictEqual(JSON.parse(fs.readFileSync(live.receiptFile)).removal.status, 'cleanup-pending')
  } finally { releaseRuntimeGenerationLease(lease) }
  const retry = applyGlobalHostRemoval(live.options)
  assert.strictEqual(retry.status, 'committed', JSON.stringify(retry.pruneFailures))
  assert.strictEqual(fs.existsSync(live.root), false)
  assert.strictEqual(fs.existsSync(live.receiptFile), false)
  assert.strictEqual(applyGlobalHostRemoval(live.options).status, 'already-absent')
  results.push('live lease retained; detach and retry complete')

  const partial = fixture('failed-prune')
  const failingFs = Object.create(fs)
  failingFs.rmdirSync = file => {
    if (path.resolve(file) === path.join(partial.root, 'nested')) {
      const error = new Error('fixture locked directory'); error.code = 'EPERM'; throw error
    }
    return fs.rmdirSync(file)
  }
  const failed = applyGlobalHostRemoval({ ...partial.options, fs: failingFs })
  assert.strictEqual(failed.status, 'cleanup-incomplete')
  assert.strictEqual(fs.existsSync(partial.receiptFile), true)
  assert.strictEqual(applyGlobalHostRemoval(partial.options).status, 'committed')
  assert.strictEqual(fs.existsSync(partial.base), false)
  results.push('failed prune retains ownership and can retry')

  const unknown = fixture('unknown-lease')
  const leaseDir = path.join(unknown.base, '.runtime-generation-leases', unknown.generationId)
  fs.mkdirSync(leaseDir, { recursive: true })
  const invalid = path.join(leaseDir, 'unknown.json')
  fs.writeFileSync(invalid, '{"not":"a lease"}')
  const retained = applyGlobalHostRemoval(unknown.options)
  assert.strictEqual(retained.status, 'cleanup-incomplete')
  assert.strictEqual(fs.existsSync(invalid), true)
  assert.strictEqual(fs.existsSync(unknown.root), true)
  results.push('unknown lease preserved and reported')

  const dead = fixture('dead-lease')
  const child = spawnSync(process.execPath, ['-e', `
    const { acquireRuntimeGenerationLease } = require(process.argv[1]);
    const receipt = acquireRuntimeGenerationLease({ runtimeRoot: process.argv[2], role: 'terminated-child', registerExit: false });
    process.stdout.write(JSON.stringify(receipt));
  `, path.join(packageRoot, 'hooks/_runtime/runtime-generation-lease.cjs'), dead.root], { encoding: 'utf8' })
  assert.strictEqual(child.status, 0, child.stderr)
  const deadReceipt = JSON.parse(child.stdout)
  assert.strictEqual(deadReceipt.status, 'active')
  assert.strictEqual(buildGlobalHostRemovalPlan(dead.options).generations[0].leases.dead.length, 1)
  assert.strictEqual(applyGlobalHostRemoval(dead.options).status, 'committed')
  assert.strictEqual(fs.existsSync(deadReceipt.leaseFile), false)
  results.push('dead child lease removed with owned runtime')

  const racing = fixture('claim-race')
  const claimFs = Object.create(fs)
  const claimDescriptors = new Set()
  let concurrentAcquire = null
  claimFs.openSync = (...args) => {
    const descriptor = fs.openSync(...args)
    if (String(args[0]).endsWith('.gc-claim.json') && args[1] === 'wx') claimDescriptors.add(descriptor)
    return descriptor
  }
  claimFs.closeSync = descriptor => {
    fs.closeSync(descriptor)
    if (claimDescriptors.delete(descriptor)) concurrentAcquire = acquireRuntimeGenerationLease({
      runtimeRoot: racing.root, role: 'racing-reader', registerExit: false
    })
  }
  const raced = applyGlobalHostRemoval({ ...racing.options, fs: claimFs })
  try {
    assert.strictEqual(concurrentAcquire?.status, 'blocked')
    assert.strictEqual(raced.status, 'committed')
  } finally { if (concurrentAcquire?.status === 'active') releaseRuntimeGenerationLease(concurrentAcquire) }
  results.push('GC claim prevents new reader during removal')

  const output = path.join(tmp, 'result.json')
  const shared = fixture('shared-consumer')
  const sharedSkill = path.join(shared.home, '.agents', 'devcodex', 'skills', 'legacy', 'SKILL.md')
  fs.mkdirSync(path.dirname(sharedSkill), { recursive: true })
  fs.writeFileSync(sharedSkill, 'old shared source\n')
  const sharedReceipt = JSON.parse(fs.readFileSync(shared.receiptFile))
  sharedReceipt.managedPaths.push(portable(sharedSkill))
  sharedReceipt.managedFileDigests[portable(sharedSkill)] = digest('old shared source\n')
  fs.writeFileSync(shared.receiptFile, JSON.stringify(sharedReceipt, null, 2) + '\n')
  const consumerReceipt = path.join(shared.home, '.claude', 'devcodex', 'global-host-receipt.json')
  fs.mkdirSync(path.dirname(consumerReceipt), { recursive: true })
  fs.writeFileSync(consumerReceipt, JSON.stringify({
    schemaVersion: 'GlobalHostConfigReceiptV1', host: 'claude', packageName: 'devcodex', result: 'committed',
    managedPaths: [], managedFileDigests: {}
  }))
  const sharedRemoval = applyGlobalHostRemoval(shared.options)
  assert.strictEqual(sharedRemoval.status, 'cleanup-incomplete')
  assert.strictEqual(fs.readFileSync(sharedSkill, 'utf8'), 'old shared source\n')
  assert.deepStrictEqual(sharedRemoval.sharedConsumers, [{ host: 'claude', status: 'PASS' }])
  const consumerReceiptBytes = fs.readFileSync(consumerReceipt)
  fs.unlinkSync(consumerReceipt)
  const missingConsumerReceipt = applyGlobalHostRemoval(shared.options)
  assert.strictEqual(missingConsumerReceipt.status, 'cleanup-incomplete')
  assert(missingConsumerReceipt.sharedConsumers.some(item => item.host === 'claude' && item.status === 'UNVERIFIED' && item.reasonCode === 'consumer-receipt-missing'))
  assert.strictEqual(fs.readFileSync(sharedSkill, 'utf8'), 'old shared source\n')
  fs.writeFileSync(consumerReceipt, consumerReceiptBytes)
  assert.strictEqual(applyGlobalHostRemoval({ ...shared.options, hosts: ['claude'] }).status, 'committed')
  assert.strictEqual(applyGlobalHostRemoval(shared.options).status, 'committed')
  assert.strictEqual(fs.existsSync(sharedSkill), false)
  results.push('shared source retained until the other installed host detaches')

  const oldConfig = fixture('old-config')
  const configPlan = buildGlobalHostConfigPlan(oldConfig.options)
  const configTarget = configPlan.targets[0]
  const operation = configPlan.operations.find(item => item.path === configTarget.files.config)
  const remap = text => text.split(portable(configTarget.runtimeRoot)).join(portable(oldConfig.root))
  fs.writeFileSync(configTarget.files.config, 'model = "user-choice"\n\n' + remap(operation.content))
  const oldReceipt = JSON.parse(fs.readFileSync(oldConfig.receiptFile))
  oldReceipt.managedPaths.push(portable(configTarget.files.config))
  oldReceipt.managedFileDigests[portable(configTarget.files.config)] = digest(remap(operation.managedContent))
  oldReceipt.managedArtifacts.push({
    path: portable(configTarget.files.config), ownershipKind: 'codex-toml-block',
    managedDigest: digest(remap(operation.managedContent))
  })
  fs.writeFileSync(oldConfig.receiptFile, JSON.stringify(oldReceipt, null, 2) + '\n')
  const oldConfigPreview = buildGlobalHostRemovalPlan(oldConfig.options)
  if (oldConfigPreview.status === 'blocked') fs.writeFileSync(path.join(tmp, 'old-config-baseline.json'),
    JSON.stringify({ status: oldConfigPreview.status, conflicts: oldConfigPreview.conflicts }, null, 2) + '\n')
  assert.strictEqual(oldConfigPreview.status, 'planned', JSON.stringify(oldConfigPreview.conflicts))
  assert.strictEqual(applyGlobalHostRemoval(oldConfig.options).status, 'committed')
  assert.strictEqual(fs.readFileSync(configTarget.files.config, 'utf8'), 'model = "user-choice"\n')
  results.push('older recorded MCP configuration removed using its own ownership identity')
  fs.writeFileSync(output, JSON.stringify({ status: 'PASS', results }, null, 2) + '\n')
  console.log(JSON.stringify({ status: 'PASS', evidence: output, results }))
} finally {
  if (process.env.DEVCODEX_TEST_KEEP_TEMP === '1') console.log('Retained continuity fixture:', tmp)
  else fs.rmSync(tmp, { recursive: true, force: true })
}
