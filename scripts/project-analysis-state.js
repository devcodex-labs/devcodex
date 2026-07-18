#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const {
  ProjectKnowledgeError,
  acceptKnowledgeBatch,
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
    json: false,
    errors: []
  }
  const valueFlags = new Set(['--repo', '--active-root', '--task-root', '--lens', '--lens-version', '--question', '--policy-version', '--max-files', '--max-bytes', '--max-batch-files', '--input', '--run-id'])
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
  }
  if (!['status', 'plan', 'accept'].includes(options.action)) options.errors.push(`unknown action: ${options.action || '(none)'}`)
  options.activeRoot = options.activeRoot || path.join(options.repoRoot, '.devcodex')
  if (options.action === 'accept' && !options.input) options.errors.push('accept requires --input <candidate.json>')
  if (options.action === 'accept' && !options.taskRoot) options.errors.push('accept requires --task-root <task-root>')
  return options
}

function envelope(ok, action, data = null, error = null) {
  return { schemaVersion: 'ProjectAnalysisStateCliV1', ok, action, data, error }
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
  } else {
    process.stdout.write(`Knowledge batch ${data.receipt.batchId}: ${data.receipt.status}; next=${data.receipt.nextBatchId || 'none'}\n`)
  }
}

function fail(options, code, message, nextStep, exitCode) {
  printResult(options, envelope(false, options.action || 'unknown', null, { code, message, nextStep }))
  process.exitCode = exitCode
}

function loadSnapshot(activeRoot, repoId) {
  const receipt = readKnowledgeSnapshot(activeRoot, repoId)
  return receipt.status === 'fresh' ? receipt.value : null
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.errors.length) {
    fail(options, 'CLI_INVALID_OPTION', options.errors.join('; '), 'Use status|plan|accept with explicit --repo/--active-root and --task-root for accept.', 2)
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
    const acceptedSnapshot = loadSnapshot(options.activeRoot, repoIdentity.repoId)
    const snapshot = featureDecision.optimizationAllowed ? acceptedSnapshot : null
    if (options.action === 'status') {
      const data = {
        schemaVersion: 'ProjectKnowledgeStatusV1',
        repoId: repoIdentity.repoId,
        status: acceptedSnapshot?.status || 'missing',
        records: acceptedSnapshot?.records?.length || 0,
        tombstones: acceptedSnapshot?.tombstones?.length || 0,
        pendingPlanId: acceptedSnapshot?.pendingPlan?.planId || null,
        inventoryIdentity: inventory.inventoryIdentity,
        executionOptimizationMode: featureDecision.configurationMode,
        reuseAllowed: featureDecision.optimizationAllowed,
        executionOptimization: optimizationProjection
      }
      printResult(options, envelope(true, 'status', data))
      process.exitCode = 0
      return data
    }
    if (options.action === 'plan') {
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
        options: { maxBatchFiles: options.maxBatchFiles }
      })
      const planWithDecision = { ...plan, executionOptimization: optimizationProjection }
      printResult(options, envelope(true, 'plan', planWithDecision))
      process.exitCode = 0
      return planWithDecision
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
