#!/usr/bin/env node
'use strict'

const path = require('path')
const {
  REQUIRED_ROUTES,
  RISK_CLASSES,
  ValidationDagError,
  buildCandidateIdentity,
  executeValidationPlan,
  manifestIdentity,
  planValidation,
  readValidationManifest
} = require('./lib/validation-dag')
const {
  resolveActiveRuntimeRoot
} = require('../hooks/_runtime/workspace-layout.cjs')
const { resolveExecutionFeatureDecisionForCwd } = require('../hooks/_runtime/execution-optimization-routing.cjs')

const ROOT = path.resolve(__dirname, '..')
const DEFAULT_MANIFEST = path.join(__dirname, 'validation-manifest.json')
const CLI_SCHEMA = 'ValidationCliEnvelopeV1'

function parseArgs(argv) {
  const options = {
    route: 'changed',
    riskClass: 'normal',
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
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--route' || arg === '--risk' || arg === '--changed' || arg === '--manifest') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        throw new ValidationDagError('VALIDATION_ARGUMENT_MISSING', arg + ' requires a value')
      }
      index += 1
      if (arg === '--route') options.route = value
      else if (arg === '--risk') options.riskClass = value
      else if (arg === '--manifest') options.manifestPath = path.resolve(value)
      else {
        options.changedSpecified = true
        options.changedFiles.push(value)
      }
    } else if (arg.startsWith('--route=')) options.route = arg.slice('--route='.length)
    else if (arg.startsWith('--risk=')) options.riskClass = arg.slice('--risk='.length)
    else if (arg.startsWith('--manifest=')) options.manifestPath = path.resolve(arg.slice('--manifest='.length))
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
  if (options.changedSpecified && options.changedFiles.some(file => !String(file).trim())) {
    throw new ValidationDagError('VALIDATION_CHANGED_EMPTY', '--changed values must be non-empty')
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
    '  --route <fast|full|changed|profile-deploy|package-release>',
    '  --changed <relative-path>   Repeat for explicit changed inputs',
    '  --risk <normal|high|release|security|destructive>',
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
    routeRequested: plan.routeRequested,
    routeResolved: plan.routeResolved,
    riskClass: plan.riskClass,
    validationLayer: plan.validationLayer,
    candidateId: plan.candidateId,
    candidateStable: plan.candidateStable,
    changedSource: plan.changedSource,
    changedFiles: plan.changedFiles,
    changeDescriptors: plan.changeDescriptors,
    impactGraphDigest: plan.impactGraphDigest,
    planDigest: plan.planDigest,
    fullFallback: plan.fullFallback,
    selectedNodes: plan.selectedNodes.map(node => node.id),
    selectionReasons: plan.selectionReasons,
    budget: plan.budget,
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

function main(argv = process.argv.slice(2)) {
  const wantsJson = argv.includes('--json')
  try {
    const options = parseArgs(argv)
    if (options.help) {
      if (options.json) printJson(envelope(true, { help: true, routes: REQUIRED_ROUTES }, null))
      else printHelp()
      return 0
    }
    const manifest = readValidationManifest(options.manifestPath)
    const activeRoot = process.env.DEVCODEX_VALIDATION_ACTIVE_ROOT
      ? path.resolve(process.env.DEVCODEX_VALIDATION_ACTIVE_ROOT)
      : resolveActiveRuntimeRoot(ROOT)
    const featureDecision = resolveExecutionFeatureDecisionForCwd({
      cwd: ROOT,
      activeRoot,
      featureId: 'validation-changed-scope'
    })
    const routeForMode = !featureDecision.optimizationAllowed && options.route === 'changed'
      ? 'full'
      : options.route
    const candidate = buildCandidateIdentity({
      repoRoot: ROOT,
      explicitChangedFiles: options.changedSpecified ? options.changedFiles : null
    })
    const plan = planValidation({
      manifest,
      route: routeForMode,
      changedFiles: candidate.changedFiles,
      changedSource: candidate.changedSource,
      riskClass: options.riskClass,
      candidateStable: candidate.stable,
      candidateId: candidate.candidateId
    })
    const optimizationProjection = {
      mode: featureDecision.configurationMode,
      lifecycleState: featureDecision.lifecycleState,
      stateStatus: featureDecision.stateStatus,
      reasonCode: featureDecision.reasonCode,
      routeInput: options.route,
      routeApplied: routeForMode,
      fallback: routeForMode !== options.route ? 'full-validation' : null
    }

    if (options.planOnly) {
      const data = { manifestIdentity: manifestIdentity(manifest), plan: compactPlan(plan, optimizationProjection) }
      if (options.json) printJson(envelope(true, data, null))
      else {
        process.stdout.write('Validation plan: ' + options.route + ' -> ' + plan.routeResolved + '\n')
        if (routeForMode !== options.route) process.stdout.write('Execution optimization fallback: full-validation\n')
        if (plan.fullFallback) process.stdout.write('Full fallback: ' + plan.fullFallback + '\n')
        process.stdout.write('Layer: ' + plan.validationLayer + ' budget=' + plan.budget.selectionRatio + '\n')
        process.stdout.write('Selected (' + plan.selectedNodeCount + '): ' +
          plan.selectedNodes.map(node => node.id).join(', ') + '\n')
      }
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
    const execution = executeValidationPlan({
      manifest,
      plan,
      candidate,
      repoRoot: ROOT,
      activeRoot,
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
    const payload = errorPayload(error,
      'Check the manifest, route, risk and changed paths; contract errors exit with code 2.')
    if (wantsJson) printJson(envelope(false, null, payload))
    else process.stderr.write(payload.code + ': ' + payload.message + '\nNext: ' + payload.nextStep + '\n')
    return 2
  }
}

if (require.main === module) process.exitCode = main()

module.exports = { CLI_SCHEMA, compactPlan, envelope, main, parseArgs }
