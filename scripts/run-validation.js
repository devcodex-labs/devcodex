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
const {
  VERIFICATION_LEVELS,
  VERIFICATION_PURPOSES
} = require('../hooks/_runtime/workflow-completion-contract.cjs')

const ROOT = path.resolve(__dirname, '..')
const DEFAULT_MANIFEST = path.join(__dirname, 'validation-manifest.json')
const CLI_SCHEMA = 'ValidationCliEnvelopeV1'

function parseArgs(argv) {
  const options = {
    route: 'changed',
    riskClass: 'normal',
    purpose: null,
    level: null,
    affectedBoundaries: [],
    releaseAuthorized: false,
    explicitFullAudit: false,
    approvePlanDigest: null,
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
    else if (arg === '--release-authorized') options.releaseAuthorized = true
    else if (arg === '--full-audit') options.explicitFullAudit = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (['--route', '--risk', '--changed', '--manifest', '--intent', '--purpose', '--level', '--boundary', '--approve-plan'].includes(arg)) {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        throw new ValidationDagError('VALIDATION_ARGUMENT_MISSING', arg + ' requires a value')
      }
      index += 1
      if (arg === '--route') options.route = value
      else if (arg === '--risk') options.riskClass = value
      else if (arg === '--manifest') options.manifestPath = path.resolve(value)
      else if (arg === '--intent' || arg === '--purpose') options.purpose = value
      else if (arg === '--level') options.level = value
      else if (arg === '--boundary') options.affectedBoundaries.push(value)
      else if (arg === '--approve-plan') options.approvePlanDigest = value
      else {
        options.changedSpecified = true
        options.changedFiles.push(value)
      }
    } else if (arg.startsWith('--route=')) options.route = arg.slice('--route='.length)
    else if (arg.startsWith('--risk=')) options.riskClass = arg.slice('--risk='.length)
    else if (arg.startsWith('--manifest=')) options.manifestPath = path.resolve(arg.slice('--manifest='.length))
    else if (arg.startsWith('--intent=')) options.purpose = arg.slice('--intent='.length)
    else if (arg.startsWith('--purpose=')) options.purpose = arg.slice('--purpose='.length)
    else if (arg.startsWith('--level=')) options.level = arg.slice('--level='.length)
    else if (arg.startsWith('--boundary=')) options.affectedBoundaries.push(arg.slice('--boundary='.length))
    else if (arg.startsWith('--approve-plan=')) options.approvePlanDigest = arg.slice('--approve-plan='.length)
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
  if (options.level !== null && !VERIFICATION_LEVELS.has(options.level)) {
    throw new ValidationDagError('VALIDATION_LEVEL_UNKNOWN', 'unknown verification level: ' + options.level)
  }
  if (options.purpose !== null && !VERIFICATION_PURPOSES.has(options.purpose)) {
    throw new ValidationDagError('VALIDATION_PURPOSE_UNKNOWN', 'unknown verification purpose: ' + options.purpose)
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
    '  --route <fast|changed|delivery|boundary|profile-deploy|package-release|full>',
    '  --changed <relative-path>   Repeat for explicit changed inputs',
    '  --risk <normal|high|release|security|destructive>',
    '  --intent <edit-loop|delivery|boundary|full-audit|release>',
    '  --purpose <value>           Compatibility alias for --intent',
    '  --level <V0|V1|V2|V3>      May widen a route; V3 still requires explicit authority',
    '  --boundary <id>             Repeat for explicit V2 boundaries',
    '  --full-audit                Explicitly authorize V3 audit (no release actions)',
    '  --release-authorized        Authorize an --intent release verification intent',
    '  --approve-plan <digest>     Approve the exact BudgetCardV1 plan',
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
    manifestIdentity: plan.manifestIdentity,
    routeRequested: plan.routeRequested,
    routeResolved: plan.routeResolved,
    riskClass: plan.riskClass,
    verificationIntent: plan.verificationIntent,
    verificationLevel: plan.verificationLevel,
    verificationPurpose: plan.verificationPurpose,
    affectedBoundaries: plan.affectedBoundaries,
    authorizationDigest: plan.authorizationDigest,
    claimCeiling: plan.claimCeiling,
    executionState: plan.executionState,
    executionBlockers: plan.executionBlockers,
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
    budgetCard: plan.budgetCard,
    invalidationFrontier: plan.invalidationFrontier,
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
    const routeForMode = options.route
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
      candidateId: candidate.candidateId,
      purpose: options.purpose,
      level: options.level,
      affectedBoundaries: options.affectedBoundaries,
      releaseAuthorized: options.releaseAuthorized,
      explicitFullAudit: options.explicitFullAudit,
      authoritySource: options.releaseAuthorized
        ? 'cli:explicit-release-authorization'
        : (options.explicitFullAudit ? 'cli:explicit-full-audit' : `cli:route:${options.route}`),
      approvePlanDigest: options.approvePlanDigest
    })
    const optimizationProjection = {
      mode: featureDecision.configurationMode,
      lifecycleState: featureDecision.lifecycleState,
      stateStatus: featureDecision.stateStatus,
      reasonCode: featureDecision.reasonCode,
      routeInput: options.route,
      routeApplied: routeForMode,
      fallback: null,
      precisionStatus: featureDecision.optimizationAllowed
        ? 'enabled'
        : 'explicit-route-retained-cache-disabled'
    }

    if (options.planOnly) {
      const data = { manifestIdentity: manifestIdentity(manifest), plan: compactPlan(plan, optimizationProjection) }
      if (options.json) printJson(envelope(true, data, null))
      else {
        process.stdout.write('Validation plan: ' + options.route + ' -> ' + plan.routeResolved + '\n')
        process.stdout.write('Intent: ' + plan.verificationLevel + '/' + plan.verificationPurpose +
          ' state=' + plan.executionState + ' claim=' + plan.claimCeiling + '\n')
        if (plan.affectedBoundaries.length) process.stdout.write('Boundaries: ' + plan.affectedBoundaries.join(', ') + '\n')
        process.stdout.write('Layer: ' + plan.validationLayer + ' budget=' + plan.budget.selectionRatio +
          ' estimatedMs=' + plan.budget.estimatedDurationMs + ' confidence=' + plan.budget.estimateConfidence +
          ' timeoutUpperMs=' + plan.budget.hardTimeoutUpperBoundMs + '\n')
        if (plan.budgetCard.nextStep) process.stdout.write('Budget next: ' + plan.budgetCard.nextStep + '\n')
        if (plan.executionBlockers.length) process.stdout.write('Blockers: ' +
          plan.executionBlockers.map(item => item.code).join(', ') + '\n')
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
    const nextStep = error.details?.budgetCard?.nextStep ||
      (Array.isArray(error.details?.blockers) && error.details.blockers.length
        ? 'Resolve: ' + error.details.blockers.map(item => item.code).join(', ')
        : 'Check the manifest, intent, boundary, risk and changed paths; contract errors exit with code 2.')
    const payload = errorPayload(error, nextStep)
    if (wantsJson) printJson(envelope(false, null, payload))
    else process.stderr.write(payload.code + ': ' + payload.message + '\nNext: ' + payload.nextStep + '\n')
    return 2
  }
}

if (require.main === module) process.exitCode = main()

module.exports = { CLI_SCHEMA, compactPlan, envelope, main, parseArgs }
