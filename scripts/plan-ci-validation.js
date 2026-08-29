#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const { sha256, stableStringify } = require('../hooks/_runtime/content-identity.cjs')
const {
  buildCandidateIdentity,
  buildValidationImpactGraph,
  planValidation,
  readValidationManifest
} = require('./lib/validation-dag')

const ROOT = path.resolve(__dirname, '..')
const DEFAULT_MANIFEST = path.join(__dirname, 'validation-manifest.json')
const PLAN_SCHEMA = 'CiValidationPlanV1'
const AGGREGATE_SCHEMA = 'CiValidationAggregateReceiptV1'
const MAX_CHANGED_FILES = 4096
const ZERO_SHA = /^0+$/
const MANUAL_SCOPES = new Set(['affected', 'full'])

class CiValidationPlanError extends Error {
  constructor(code, message, details = null) {
    super(message)
    this.name = 'CiValidationPlanError'
    this.code = code
    this.details = details
  }
}

function normalizeEvent(value) {
  const event = String(value || 'push').trim()
  if (!event) throw new CiValidationPlanError('CI_PLAN_EVENT_INVALID', 'event must be non-empty')
  return event
}

function assertGitRef(value, field) {
  const ref = String(value || '').trim()
  if (!ref || ref.startsWith('-') || /[\0\r\n]/.test(ref)) {
    throw new CiValidationPlanError('CI_PLAN_GIT_REF_INVALID', `${field} must be a safe, non-empty git ref`)
  }
  return ref
}

function git(repoRoot, args, encoding = 'utf8') {
  return execFileSync('git', args, { cwd: repoRoot, encoding, windowsHide: true })
}

function splitNull(value) {
  return String(value || '').split('\0').filter(Boolean)
}

function resolveCommit(repoRoot, value, field) {
  const ref = assertGitRef(value, field)
  try {
    return String(git(repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`])).trim()
  } catch {
    throw new CiValidationPlanError('CI_PLAN_GIT_REF_UNRESOLVED', `${field} could not be resolved: ${ref}`)
  }
}

function resolveCiChangedFiles({ repoRoot = ROOT, base = null, head = 'HEAD', explicitChangedFiles = null,
  maxChangedFiles = MAX_CHANGED_FILES } = {}) {
  if (explicitChangedFiles) {
    const changedFiles = [...new Set(explicitChangedFiles.map(String))].sort()
    return {
      base: base || null,
      head: head || 'HEAD',
      changedFiles: changedFiles.slice(0, maxChangedFiles),
      changedSource: 'explicit',
      truncated: changedFiles.length > maxChangedFiles,
      totalChangedFiles: changedFiles.length
    }
  }

  const resolvedHead = resolveCommit(repoRoot, head || 'HEAD', 'head')
  let resolvedBase = null
  if (base && !ZERO_SHA.test(String(base))) {
    resolvedBase = resolveCommit(repoRoot, base, 'base')
  } else {
    try {
      resolvedBase = resolveCommit(repoRoot, `${resolvedHead}^`, 'base')
    } catch {
      resolvedBase = null
    }
  }

  const listed = resolvedBase
    ? splitNull(git(repoRoot, ['diff', '--name-only', '-z', '--diff-filter=ACDMRTUXB', resolvedBase, resolvedHead, '--']))
    : splitNull(git(repoRoot, ['ls-tree', '-r', '--name-only', '-z', resolvedHead]))
  const changedFiles = [...new Set(listed.map(String))].sort()
  return {
    base: resolvedBase,
    head: resolvedHead,
    changedFiles: changedFiles.slice(0, maxChangedFiles),
    changedSource: resolvedBase ? 'git-range' : 'git-initial-tree',
    truncated: changedFiles.length > maxChangedFiles,
    totalChangedFiles: changedFiles.length
  }
}

function compatibilityMatrix(manifest) {
  const matrix = manifest?.ciCompatibilityMatrix
  if (!Array.isArray(matrix) || matrix.length === 0) {
    throw new CiValidationPlanError('CI_PLAN_COMPATIBILITY_MATRIX_MISSING', 'validation manifest must define ciCompatibilityMatrix')
  }
  const ids = new Set()
  return matrix.map((entry, index) => {
    const value = {
      id: String(entry?.id || ''),
      os: String(entry?.os || ''),
      node: String(entry?.node || ''),
      kind: String(entry?.kind || ''),
      command: String(entry?.command || '')
    }
    if (!value.id || !value.os || !value.node || value.kind !== 'compatibility' || !value.command || ids.has(value.id)) {
      throw new CiValidationPlanError('CI_PLAN_COMPATIBILITY_MATRIX_INVALID', `invalid compatibility entry at index ${index}`)
    }
    ids.add(value.id)
    return value
  })
}

function compactPlan(plan) {
  return {
    planDigest: plan.planDigest,
    impactGraphDigest: plan.impactGraphDigest,
    verificationLevel: plan.verificationLevel,
    verificationPurpose: plan.verificationPurpose,
    routeResolved: plan.routeResolved,
    affectedBoundaries: plan.affectedBoundaries,
    executionState: plan.executionState,
    executionBlockers: plan.executionBlockers,
    selectedNodeCount: plan.selectedNodeCount,
    selectedNodeIds: plan.selectedNodes.map(node => node.id).sort(),
    estimatedDurationMs: plan.budget.estimatedDurationMs,
    heavyNodeIds: plan.budget.heavyNodeIds
  }
}

function buildCiValidationPlan({ manifest, repoRoot = ROOT, event = 'push', manualScope = 'affected',
  base = null, head = 'HEAD', changedFiles = null, maxChangedFiles = MAX_CHANGED_FILES } = {}) {
  const normalizedEvent = normalizeEvent(event)
  const normalizedManualScope = String(manualScope || 'affected').trim()
  if (!MANUAL_SCOPES.has(normalizedManualScope)) {
    throw new CiValidationPlanError('CI_PLAN_MANUAL_SCOPE_INVALID', `unknown manual scope: ${normalizedManualScope}`)
  }
  const diff = resolveCiChangedFiles({ repoRoot, base, head, explicitChangedFiles: changedFiles, maxChangedFiles })
  const candidate = buildCandidateIdentity({
    repoRoot,
    explicitChangedFiles: diff.changedFiles,
    narrativeMarkdownExclusions: manifest.narrativeMarkdownExclusions
  })
  const impactPlan = planValidation({
    manifest,
    route: 'changed',
    changedFiles: diff.changedFiles,
    changedSource: diff.changedSource,
    candidateStable: candidate.stable,
    candidateId: candidate.candidateId,
    requesterClass: 'trusted-ci',
    requestSourceRef: `github-actions:${normalizedEvent}:impact-plan`
  })
  const directImpactGraph = buildValidationImpactGraph({
    manifest,
    changedFiles: diff.changedFiles,
    changeDescriptors: impactPlan.changeDescriptors,
    invariantNodeIds: impactPlan.verificationLevel === 'V3'
      ? manifest.invariantNodes
      : (manifest.iterativeInvariantNodes || manifest.invariantNodes),
    verificationLevel: impactPlan.verificationLevel
  })
  if (directImpactGraph.impactGraphDigest !== impactPlan.impactGraphDigest) {
    throw new CiValidationPlanError('CI_PLAN_IMPACT_GRAPH_DRIFT', 'planValidation and buildValidationImpactGraph disagreed')
  }

  const fullReasonCodes = []
  if (normalizedEvent === 'schedule') fullReasonCodes.push('nightly')
  if (normalizedEvent === 'release') fullReasonCodes.push('release')
  if (normalizedEvent === 'workflow_dispatch' && normalizedManualScope === 'full') fullReasonCodes.push('manual-full')
  if (diff.truncated) fullReasonCodes.push('changed-file-limit')
  if (!directImpactGraph.complete) fullReasonCodes.push('impact-graph-incomplete')
  if (impactPlan.executionBlockers.length > 0) fullReasonCodes.push('impact-plan-blocked')
  const runFullQuality = fullReasonCodes.length > 0
  const effectivePlan = runFullQuality
    ? planValidation({
        manifest,
        route: 'full',
        changedFiles: diff.changedFiles,
        changedSource: diff.changedSource,
        candidateStable: candidate.stable,
        candidateId: candidate.candidateId,
        purpose: 'full-audit',
        level: 'V3',
        explicitFullAudit: true,
        requesterClass: 'trusted-ci',
        requestSourceRef: `github-actions:${normalizedEvent}:full-plan`
      })
    : impactPlan

  const requiredNodeIds = effectivePlan.selectedNodes.map(node => node.id).sort()
  const runImpactValidation = !runFullQuality && requiredNodeIds.length > 0
  const matrix = runFullQuality
    ? compatibilityMatrix(manifest)
    : (runImpactValidation
        ? [{ id: 'impact', os: 'ubuntu-latest', node: '24.17.0', kind: 'impact', command: 'run-validation:changed' }]
        : [])
  const packageBoundary = impactPlan.affectedBoundaries.includes('package')
  const core = {
    schemaVersion: PLAN_SCHEMA,
    event: normalizedEvent,
    manualScope: normalizedManualScope,
    base: diff.base,
    head: candidate.head || diff.head,
    changedSource: diff.changedSource,
    changedFiles: diff.changedFiles,
    changedFilesTruncated: diff.truncated,
    totalChangedFiles: diff.totalChangedFiles,
    candidateId: candidate.candidateId,
    impact: compactPlan(impactPlan),
    effective: compactPlan(effectivePlan),
    requiredNodeIds,
    fullReasonCodes,
    jobs: {
      affected: matrix.length > 0,
      impactValidation: runImpactValidation,
      fullQuality: runFullQuality,
      packageBoundary
    },
    matrix: { include: matrix }
  }
  return Object.freeze({ ...core, plannerDigest: sha256(Buffer.from(stableStringify(core), 'utf8')) })
}

function parseExecutionResults(resultsDir) {
  if (!resultsDir || !fs.existsSync(resultsDir)) return []
  const values = []
  const queue = [path.resolve(resultsDir)]
  while (queue.length) {
    const current = queue.shift()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name)
      if (entry.isDirectory()) queue.push(target)
      else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const value = JSON.parse(fs.readFileSync(target, 'utf8'))
          if (value?.data?.receipt) values.push(value)
        } catch {}
      }
    }
  }
  return values
}

function aggregateCiValidation({ plan, jobResults, executionResults = [] } = {}) {
  if (plan?.schemaVersion !== PLAN_SCHEMA) {
    throw new CiValidationPlanError('CI_AGGREGATE_PLAN_INVALID', 'aggregate requires CiValidationPlanV1')
  }
  const errors = []
  const resultOf = name => String(jobResults?.[name] || '')
  if (resultOf('plan') !== 'success') errors.push('plan-job-not-successful')
  for (const [job, required] of [
    ['affected', plan.jobs.affected],
    ['fullQuality', plan.jobs.fullQuality],
    ['packageBoundary', plan.jobs.packageBoundary]
  ]) {
    const result = resultOf(job)
    if (required && result !== 'success') errors.push(`${job}-job-not-successful`)
    if (!required && !['skipped', 'success'].includes(result)) errors.push(`${job}-job-unexpected-${result || 'missing'}`)
  }

  const receiptEnvelopes = executionResults.filter(value => value?.ok === true && value?.data?.receipt)
  const qualifyingReceipts = receiptEnvelopes.map(value => value.data.receipt).filter(receipt =>
    receipt.terminalStatus === 'completed' && !receipt.failedNode && receipt.candidateHead === plan.head)
  if (plan.jobs.impactValidation || plan.jobs.fullQuality) {
    const provenNodes = new Set(qualifyingReceipts.flatMap(receipt => Object.keys(receipt.nodeReceiptDigests || {})))
    const missingNodes = plan.requiredNodeIds.filter(nodeId => !provenNodes.has(nodeId))
    if (qualifyingReceipts.length === 0) errors.push('validation-terminal-receipt-missing')
    if (missingNodes.length) errors.push(`required-node-receipt-missing:${missingNodes.join(',')}`)
  }

  const core = {
    schemaVersion: AGGREGATE_SCHEMA,
    plannerDigest: plan.plannerDigest,
    head: plan.head,
    jobResults,
    requiredNodeIds: plan.requiredNodeIds,
    receiptIds: qualifyingReceipts.map(receipt => receipt.receiptId).filter(Boolean).sort(),
    status: errors.length ? 'BLOCK' : 'PASS',
    errors
  }
  return { ...core, aggregateDigest: sha256(Buffer.from(stableStringify(core), 'utf8')) }
}

function appendGithubOutputs(target, plan) {
  const outputs = {
    'run-affected': String(plan.jobs.affected),
    'run-impact-validation': String(plan.jobs.impactValidation),
    'run-full-quality': String(plan.jobs.fullQuality),
    'run-package-boundary': String(plan.jobs.packageBoundary),
    matrix: JSON.stringify(plan.matrix),
    'planner-digest': plan.plannerDigest,
    'changed-files-b64': Buffer.from(JSON.stringify(plan.changedFiles), 'utf8').toString('base64'),
    'plan-b64': Buffer.from(JSON.stringify(plan), 'utf8').toString('base64')
  }
  fs.appendFileSync(path.resolve(target), Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(''))
}

function argumentValue(argv, name, fallback = null) {
  const direct = argv.indexOf(name)
  if (direct >= 0) return argv[direct + 1]
  const prefix = `${name}=`
  const inline = argv.find(value => value.startsWith(prefix))
  return inline ? inline.slice(prefix.length) : fallback
}

function repeatedArguments(argv, name) {
  const values = []
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === name && argv[index + 1]) values.push(argv[++index])
    else if (argv[index].startsWith(`${name}=`)) values.push(argv[index].slice(name.length + 1))
  }
  return values
}

function main(argv = process.argv.slice(2)) {
  const command = argv[0] === 'aggregate' ? 'aggregate' : 'plan'
  const args = command === 'aggregate' ? argv.slice(1) : argv
  try {
    if (command === 'aggregate') {
      const planB64 = argumentValue(args, '--plan-b64') || process.env.DEVCODEX_CI_PLAN_B64
      const jobsJson = argumentValue(args, '--job-results') || process.env.DEVCODEX_CI_JOB_RESULTS
      if (!planB64 || !jobsJson) throw new CiValidationPlanError('CI_AGGREGATE_INPUT_MISSING', 'plan and job results are required')
      const plan = JSON.parse(Buffer.from(planB64, 'base64').toString('utf8'))
      const receipt = aggregateCiValidation({
        plan,
        jobResults: JSON.parse(jobsJson),
        executionResults: parseExecutionResults(argumentValue(args, '--results-dir'))
      })
      process.stdout.write(`${JSON.stringify(receipt)}\n`)
      return receipt.status === 'PASS' ? 0 : 1
    }

    const repoRoot = path.resolve(argumentValue(args, '--repo-root', ROOT))
    const manifest = readValidationManifest(path.resolve(argumentValue(args, '--manifest', DEFAULT_MANIFEST)))
    const explicit = repeatedArguments(args, '--changed')
    const plan = buildCiValidationPlan({
      manifest,
      repoRoot,
      event: argumentValue(args, '--event', process.env.GITHUB_EVENT_NAME || 'push'),
      manualScope: argumentValue(args, '--manual-scope', 'affected'),
      base: argumentValue(args, '--base'),
      head: argumentValue(args, '--head', process.env.GITHUB_SHA || 'HEAD'),
      changedFiles: explicit.length ? explicit : null
    })
    const githubOutput = argumentValue(args, '--github-output')
    if (githubOutput) appendGithubOutputs(githubOutput, plan)
    process.stdout.write(`${JSON.stringify(plan)}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`${error.code || 'CI_VALIDATION_PLAN_FAILED'}: ${error.message}\n`)
    return 1
  }
}

if (require.main === module) process.exitCode = main()

module.exports = {
  AGGREGATE_SCHEMA,
  CiValidationPlanError,
  MAX_CHANGED_FILES,
  PLAN_SCHEMA,
  aggregateCiValidation,
  appendGithubOutputs,
  buildCiValidationPlan,
  compatibilityMatrix,
  parseExecutionResults,
  resolveCiChangedFiles
}
