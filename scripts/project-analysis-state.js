#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const {
  ProjectKnowledgeError,
  acceptKnowledgeBatch,
  bootstrapProjectKnowledge,
  buildIncrementalAnalysisPlan,
  buildRepoIdentity,
  persistAcceptedKnowledge,
  readKnowledgeSnapshot,
  scanProjectInventory,
  verifyReuseSample
} = require('./lib/project-knowledge-store')
const { resolveExecutionFeatureDecisionForCwd } = require('../hooks/_runtime/execution-optimization-routing.cjs')

function parseArgs(argv) {
  const values = Array.isArray(argv) ? argv : []
  const options = {
    action: values[0] || '',
    repoRoot: process.cwd(),
    activeRoot: '',
    taskRoot: '',
    lensId: 'default',
    lensVersion: '1',
    questionFingerprint: 'default',
    policyVersion: '1',
    maxFiles: 20000,
    maxBytes: 256 * 1024 * 1024,
    maxBatchFiles: 50,
    input: '',
    runId: '',
    analysisConfigIdentity: '',
    parserIdentity: '',
    testIdentity: '',
    profileIdentity: '',
    json: false,
    errors: []
  }
  const valueFlags = new Set(['--repo', '--active-root', '--task-root', '--lens', '--lens-version', '--question', '--policy-version', '--max-files', '--max-bytes', '--max-batch-files', '--input', '--run-id', '--analysis-config-identity', '--parser-identity', '--test-identity', '--profile-identity'])
  for (let index = 1; index < values.length; index += 1) {
    const arg = String(values[index])
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (!valueFlags.has(arg)) {
      options.errors.push(`unsupported option: ${arg}`)
      continue
    }
    const value = values[index + 1]
    if (!value || String(value).startsWith('--')) {
      options.errors.push(`${arg} requires a value`)
      continue
    }
    index += 1
    if (arg === '--repo') options.repoRoot = path.resolve(String(value))
    else if (arg === '--active-root') options.activeRoot = path.resolve(String(value))
    else if (arg === '--task-root') options.taskRoot = path.resolve(String(value))
    else if (arg === '--lens') options.lensId = String(value)
    else if (arg === '--lens-version') options.lensVersion = String(value)
    else if (arg === '--question') options.questionFingerprint = String(value)
    else if (arg === '--policy-version') options.policyVersion = String(value)
    else if (['--max-files', '--max-bytes', '--max-batch-files'].includes(arg)) {
      if (!/^\d+$/.test(String(value)) || Number(value) < 1) options.errors.push(`${arg} requires a positive integer`)
      else if (arg === '--max-files') options.maxFiles = Number(value)
      else if (arg === '--max-bytes') options.maxBytes = Number(value)
      else options.maxBatchFiles = Number(value)
    } else if (arg === '--input') options.input = path.resolve(String(value))
    else if (arg === '--run-id') options.runId = String(value)
    else if (arg === '--analysis-config-identity') options.analysisConfigIdentity = String(value)
    else if (arg === '--parser-identity') options.parserIdentity = String(value)
    else if (arg === '--test-identity') options.testIdentity = String(value)
    else if (arg === '--profile-identity') options.profileIdentity = String(value)
  }
  if (!['status', 'plan', 'observe', 'bootstrap', 'accept'].includes(options.action)) options.errors.push(`unknown action: ${options.action || '(none)'}`)
  options.activeRoot = options.activeRoot || path.join(options.repoRoot, '.devcodex')
  if (options.action === 'accept' && !options.input) options.errors.push('accept requires --input <candidate.json>')
  if (['accept', 'bootstrap'].includes(options.action) && !options.taskRoot) options.errors.push(`${options.action} requires --task-root <task-root>`)
  return options
}

function envelope(ok, action, data = null, error = null) {
  return { schemaVersion: 'ProjectAnalysisStateCliV2', ok, action, data, error }
}

function printResult(options, result) {
  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return
  }
  if (!result.ok) {
    process.stdout.write(`[${result.error.code}] ${result.error.message}\n${result.error.nextStep || ''}\n`)
    return
  }
  const data = result.data
  if (options.action === 'status') {
    process.stdout.write(`ProjectKnowledge status: ${data.status}; repoId=${data.repoId}; records=${data.records}\n`)
  } else if (options.action === 'plan') {
    process.stdout.write(`Incremental analysis plan: ${data.planId}; read=${data.readPaths.length}; reused=${data.reusedPaths.length}; batches=${data.batches.length}; fullRequired=${data.fullRequired}\n`)
  } else if (options.action === 'observe') {
    process.stdout.write(`ProjectKnowledge observation: plan=${data.plan.planId}; candidates=${data.observation.candidateRecords.length}; samples=${data.observation.sampleRecords.length}; writes=0\n`)
  } else if (options.action === 'bootstrap') {
    process.stdout.write(`ProjectKnowledge bootstrap: ${data.bootstrap.status}; batches=${data.bootstrap.receipts.length}; persisted=${Boolean(data.persistReceipt)}\n`)
  } else {
    process.stdout.write(`Knowledge batch ${data.receipt.batchId}: ${data.receipt.status}; next=${data.receipt.nextBatchId || 'none'}\n`)
  }
}

function fail(options, code, message, nextStep, exitCode) {
  printResult(options, envelope(false, options.action || 'unknown', null, { code, message, nextStep }))
  process.exitCode = exitCode
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.errors.length) {
    fail(options, 'CLI_INVALID_OPTION', options.errors.join('; '), 'Use status|plan|observe|bootstrap|accept with explicit --repo/--active-root and --task-root for write actions.', 2)
    return
  }
  try {
    const inventory = scanProjectInventory(options.repoRoot, { maxFiles: options.maxFiles, maxBytes: options.maxBytes })
    const repoIdentity = buildRepoIdentity(options.repoRoot, inventory)
    const featureDecision = resolveExecutionFeatureDecisionForCwd({
      cwd: options.repoRoot,
      activeRoot: options.activeRoot,
      featureId: 'project-knowledge-reuse'
    })
    const optimizationProjection = {
      schemaVersion: featureDecision.schemaVersion,
      lifecycleState: featureDecision.lifecycleState,
      optimizationAllowed: featureDecision.optimizationAllowed,
      reasonCode: featureDecision.reasonCode,
      stateStatus: featureDecision.stateStatus
    }
    const snapshotReceipt = readKnowledgeSnapshot(options.activeRoot, repoIdentity.repoId)
    const acceptedSnapshot = snapshotReceipt.status === 'fresh' ? snapshotReceipt.value : null
    const snapshot = featureDecision.optimizationAllowed ? acceptedSnapshot : null
    if (options.action === 'status') {
      const data = {
        schemaVersion: 'ProjectKnowledgeStatusV2',
        repoId: repoIdentity.repoId,
        status: acceptedSnapshot?.status || snapshotReceipt.status,
        snapshotReadStatus: snapshotReceipt.status,
        records: (acceptedSnapshot || snapshotReceipt.value)?.records?.length || 0,
        tombstones: (acceptedSnapshot || snapshotReceipt.value)?.tombstones?.length || 0,
        pendingPlanId: acceptedSnapshot?.pendingPlan?.planId || null,
        inventoryIdentity: inventory.inventoryIdentity,
        inventoryMerkleRoot: inventory.merkleRoot,
        migrationRequired: snapshotReceipt.migrationRequired === true,
        executionOptimizationMode: featureDecision.configurationMode,
        reuseAllowed: featureDecision.optimizationAllowed && snapshotReceipt.status === 'fresh',
        executionOptimization: optimizationProjection
      }
      printResult(options, envelope(true, 'status', data))
      process.exitCode = 0
      return data
    }
    if (['plan', 'observe', 'bootstrap'].includes(options.action)) {
      const forceFullReasons = []
      if (!featureDecision.optimizationAllowed) forceFullReasons.push('execution-optimization-disabled')
      if (snapshotReceipt.status === 'compatibility-v1') forceFullReasons.push('legacy-v1-read-only')
      const plan = buildIncrementalAnalysisPlan({
        snapshot,
        inventory,
        repoIdentity,
        graph: snapshot?.impactGraph || {},
        lens: {
          lensId: options.lensId,
          version: options.lensVersion,
          questionFingerprint: options.questionFingerprint,
          policyVersion: options.policyVersion
        },
        options: {
          maxBatchFiles: options.maxBatchFiles,
          analysisConfigIdentity: options.analysisConfigIdentity,
          parserIdentity: options.parserIdentity,
          testIdentity: options.testIdentity,
          profileIdentity: options.profileIdentity,
          forceFullReasons
        }
      })
      const planWithDecision = { ...plan, executionOptimization: optimizationProjection }
      if (options.action === 'plan') {
        printResult(options, envelope(true, 'plan', planWithDecision))
        process.exitCode = 0
        return planWithDecision
      }
      const bootstrap = bootstrapProjectKnowledge({
        snapshot,
        inventory,
        repoIdentity,
        plan,
        graph: snapshot?.impactGraph || {}
      })
      if (options.action === 'observe') {
        const data = { plan: planWithDecision, observation: bootstrap.observation, sampleOracle: bootstrap.sampleOracle, writeCount: 0 }
        printResult(options, envelope(true, 'observe', data))
        process.exitCode = bootstrap.sampleOracle.status === 'pass' ? 0 : 1
        return data
      }
      if (!['accepted', 'unchanged'].includes(bootstrap.status)) {
        const data = { plan: planWithDecision, bootstrap, persistReceipt: null }
        printResult(options, envelope(true, 'bootstrap', data))
        process.exitCode = 1
        return data
      }
      const persistReceipt = bootstrap.status === 'accepted' ? persistAcceptedKnowledge({
        activeRoot: options.activeRoot,
        taskRoot: options.taskRoot,
        runId: options.runId || plan.planId,
        plan,
        snapshot: bootstrap.snapshot,
        receipt: bootstrap.receipts.at(-1)
      }) : null
      const data = { plan: planWithDecision, bootstrap, persistReceipt }
      printResult(options, envelope(true, 'bootstrap', data))
      process.exitCode = 0
      return data
    }

    const input = JSON.parse(fs.readFileSync(options.input, 'utf8'))
    const suppliedPlan = input.plan
    if (!suppliedPlan || suppliedPlan.repoIdentity?.repoId !== repoIdentity.repoId || suppliedPlan.inventoryIdentity?.digest !== inventory.inventoryIdentity.digest) {
      throw new ProjectKnowledgeError('KNOWLEDGE_ACCEPT_INPUT_STALE', 'accept input does not match the current repo/inventory', 'Run plan again and regenerate candidate records.')
    }
    const priorRecords = snapshot?.records || []
    const observedRecords = Array.isArray(input.sampleRecords) ? input.sampleRecords : []
    const sampleOracle = verifyReuseSample({
      samplePaths: suppliedPlan.samplePaths,
      snapshotRecords: priorRecords,
      observedRecords
    })
    const accepted = acceptKnowledgeBatch({
      snapshot,
      inventory,
      repoIdentity,
      plan: suppliedPlan,
      batchId: input.batchId,
      candidateRecords: input.candidateRecords,
      validationResult: input.validationResult,
      sampleOracle,
      graph: input.graph || snapshot?.impactGraph || {},
      findings: input.findings
    })
    if (accepted.receipt.status !== 'accepted') {
      const rejectedData = { ...accepted, executionOptimization: optimizationProjection }
      printResult(options, envelope(true, 'accept', rejectedData))
      process.exitCode = 1
      return rejectedData
    }
    const persistReceipt = persistAcceptedKnowledge({
      activeRoot: options.activeRoot,
      taskRoot: options.taskRoot,
      runId: options.runId || input.runId,
      plan: suppliedPlan,
      snapshot: accepted.snapshot,
      receipt: accepted.receipt
    })
    const data = { ...accepted, persistReceipt, executionOptimization: optimizationProjection }
    printResult(options, envelope(true, 'accept', data))
    process.exitCode = 0
    return data
  } catch (error) {
    const code = error instanceof ProjectKnowledgeError ? error.code : 'PROJECT_ANALYSIS_STATE_FAILED'
    fail(options, code, error.message, error.nextStep || 'Inspect the candidate file and retry with current identities.', code === 'PROJECT_ANALYSIS_STATE_FAILED' ? 1 : 1)
    return null
  }
}

if (require.main === module) main()

module.exports = { envelope, main, parseArgs }
