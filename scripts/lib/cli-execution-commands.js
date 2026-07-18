'use strict'

const fs = require('fs')
const path = require('path')
const PACKAGE_JSON = require('../../package.json')
const {
  TaskContinuationError,
  resolveTaskContinuation
} = require('../../hooks/_runtime/task-continuation-contract.cjs')
const { buildBundleDecisionV2 } = require('../../mcp/profile-contract.js')
const { resolveExecutionFeatureDecisionForCwd } = require('../../hooks/_runtime/execution-optimization-routing.cjs')
const { createCliFailure, createCliSuccess, printCliJson } = require('./cli-json-contract.js')

function buildCliExecutionCommands(ctx) {
  const {
    process,
    console,
    c,
    resolveTask = resolveTaskContinuation,
    buildSkillBundle = buildBundleDecisionV2,
    resolveExecutionFeature = resolveExecutionFeatureDecisionForCwd,
    readSkillPortfolio = () => JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'skills', 'portfolio.json'), 'utf8'))
  } = ctx
  const cliMetadata = { packageName: PACKAGE_JSON.name, packageVersion: PACKAGE_JSON.version }

  function parseTaskArgs(argv) {
    const values = Array.isArray(argv) ? argv : []
    const options = { action: values[0] || '', nameParts: [], project: '', json: false, errors: [] }
    for (let index = 1; index < values.length; index += 1) {
      const arg = values[index]
      if (arg === '--json') options.json = true
      else if (arg === '--project') {
        const candidate = values[index + 1]
        if (!candidate || String(candidate).startsWith('-')) options.errors.push('--project requires a project namespace')
        else options.project = String(values[++index])
      } else if (String(arg).startsWith('-')) options.errors.push(`unsupported option: ${arg}`)
      else options.nameParts.push(String(arg))
    }
    if (options.action !== 'resolve') options.errors.push(`unknown task subcommand: ${options.action || '(none)'}`)
    options.name = options.nameParts.join(' ').trim()
    if (options.action === 'resolve' && !options.name) options.errors.push('task name is required')
    return options
  }

  function printFailure(options, errorCode, message, nextStep, details, exitCode) {
    if (options.json) printCliJson(console, createCliFailure('task.resolve', errorCode, message, nextStep, cliMetadata, details))
    else {
      console.log(c.red(`  [${errorCode}] ${message}`))
      console.log(c.dim(`  ${nextStep}`))
    }
    process.exitCode = exitCode
  }

  function printResolutionHuman(resolution) {
    console.log()
    console.log(c.bold('  DevCodex task resolution'))
    console.log(`  ${c.cyan('status'.padEnd(16))} ${resolution.status}`)
    if (resolution.candidate) {
      console.log(`  ${c.cyan('task'.padEnd(16))} ${resolution.candidate.displayName}`)
      console.log(`  ${c.cyan('project/kind'.padEnd(16))} ${resolution.candidate.project}/${resolution.candidate.kind}`)
      if (resolution.candidate.taskRoot) console.log(`  ${c.cyan('taskRoot'.padEnd(16))} ${resolution.candidate.taskRoot}`)
    }
    if (resolution.candidates?.length) {
      for (const candidate of resolution.candidates) {
        console.log(`  ${c.yellow('candidate'.padEnd(16))} ${candidate.project}/${candidate.kind}/${candidate.displayName} (${candidate.status})`)
      }
    }
    if (resolution.suggestions?.length) {
      for (const suggestion of resolution.suggestions) {
        console.log(`  ${c.yellow('suggestion'.padEnd(16))} ${suggestion.project}/${suggestion.kind}/${suggestion.displayName}`)
      }
    }
    console.log(c.dim('  identity locates the task; sessions and bound artifacts remain the continuation truth'))
    console.log()
  }

  function cmdTask(argv = []) {
    const options = parseTaskArgs(argv)
    if (options.errors.length) {
      printFailure(
        options,
        'CLI_INVALID_OPTION',
        options.errors.join('; '),
        'Use: devcodex task resolve <name> [--project <name>] [--json]',
        { errors: options.errors },
        2
      )
      return null
    }

    let resolution
    try {
      resolution = resolveTask({ cwd: process.cwd(), name: options.name, project: options.project })
    } catch (error) {
      if (!(error instanceof TaskContinuationError)) throw error
      printFailure(options, error.code, error.message, error.nextStep || 'Correct the task selector and retry.', null, 2)
      return null
    }

    if (resolution.status === 'resolved-active') {
      if (options.json) printCliJson(console, createCliSuccess('task.resolve', resolution, cliMetadata))
      else printResolutionHuman(resolution)
      process.exitCode = 0
      return resolution
    }

    const exitCode = resolution.status === 'ambiguous' ? 2 : 1
    printFailure(
      options,
      resolution.errorCode || 'TASK_RESOLUTION_FAILED',
      resolution.message || `Task resolution finished with status ${resolution.status}.`,
      resolution.nextStep || 'Choose an exact task and retry.',
      resolution,
      exitCode
    )
    return resolution
  }

  function parseSkillArgs(argv) {
    const values = Array.isArray(argv) ? argv : []
    const options = {
      action: values[0] || '',
      candidateIds: [],
      mandatoryIds: [],
      mandatorySpecified: false,
      includeGray: false,
      maxSkills: null,
      maxBytes: null,
      maxTokens: null,
      hostCapability: 'bundle-v2',
      json: false,
      errors: []
    }
    const parseInteger = (flag, value) => {
      if (!/^\d+$/.test(String(value || '')) || Number(value) < 1) {
        options.errors.push(`${flag} requires a positive integer`)
        return null
      }
      return Number(value)
    }
    for (let index = 1; index < values.length; index += 1) {
      const arg = String(values[index])
      if (arg === '--json') options.json = true
      else if (arg === '--include-gray') options.includeGray = true
      else if (['--mandatory', '--max-skills', '--max-bytes', '--max-tokens', '--host-capability'].includes(arg)) {
        const value = values[index + 1]
        if (!value || String(value).startsWith('--')) {
          options.errors.push(`${arg} requires a value`)
          continue
        }
        index += 1
        if (arg === '--mandatory') {
          options.mandatorySpecified = true
          options.mandatoryIds.push(String(value))
        } else if (arg === '--host-capability') {
          if (!['bundle-v2', 'native-oracle', 'unsupported'].includes(String(value))) options.errors.push('invalid --host-capability')
          else options.hostCapability = String(value)
        } else {
          const parsed = parseInteger(arg, value)
          if (arg === '--max-skills') options.maxSkills = parsed
          else if (arg === '--max-bytes') options.maxBytes = parsed
          else options.maxTokens = parsed
        }
      } else if (arg.startsWith('-')) options.errors.push(`unsupported option: ${arg}`)
      else options.candidateIds.push(arg)
    }
    if (options.action !== 'plan') options.errors.push(`unknown skill subcommand: ${options.action || '(none)'}`)
    if (options.action === 'plan' && !options.candidateIds.length) options.errors.push('at least one candidate skill id is required')
    return options
  }

  function printSkillFailure(options, errorCode, message, nextStep, details, exitCode) {
    if (options.json) printCliJson(console, createCliFailure('skill.plan', errorCode, message, nextStep, cliMetadata, details))
    else {
      console.log(c.red(`  [${errorCode}] ${message}`))
      console.log(c.dim(`  ${nextStep}`))
    }
    process.exitCode = exitCode
  }

  function printSkillPlanHuman(decision) {
    console.log()
    console.log(c.bold('  DevCodex Skill bundle plan'))
    console.log(`  ${c.cyan('completion'.padEnd(16))} ${decision.completion}`)
    console.log(`  ${c.cyan('selected'.padEnd(16))} ${decision.selected.map(item => item.id).join(', ') || '(none)'}`)
    console.log(`  ${c.cyan('bytes'.padEnd(16))} ${decision.budget.selected.bytes}`)
    console.log(`  ${c.cyan('stages'.padEnd(16))} ${decision.stages.length}`)
    if (decision.ignored.length) console.log(`  ${c.yellow('ignored'.padEnd(16))} ${decision.ignored.map(item => `${item.id}:${item.reason}`).join(', ')}`)
    if (decision.fallback.required) console.log(`  ${c.yellow('fallback'.padEnd(16))} ${decision.fallback.route}`)
    console.log(c.dim('  every selected SKILL.md remains whole; this command never mutates lifecycle state'))
    console.log()
  }

  function cmdSkill(argv = []) {
    const options = parseSkillArgs(argv)
    if (options.errors.length) {
      printSkillFailure(
        options,
        'CLI_INVALID_OPTION',
        options.errors.join('; '),
        'Use: devcodex skill plan <candidate...> [--mandatory <id>] [--max-skills N] [--max-bytes N] [--include-gray] [--json]',
        { errors: options.errors },
        2
      )
      return null
    }
    let portfolio
    try {
      portfolio = readSkillPortfolio()
    } catch (error) {
      printSkillFailure(options, 'SKILL_PORTFOLIO_READ_FAILED', error.message, 'Regenerate or reinstall skills/portfolio.json and retry.', null, 1)
      return null
    }
    const featureDecision = resolveExecutionFeature({
      cwd: process.cwd(),
      featureId: 'skill-bundle'
    })
    const bundleDecision = buildSkillBundle(portfolio, {
      candidateIds: options.candidateIds,
      ...(options.mandatorySpecified ? { mandatoryIds: options.mandatoryIds } : {}),
      includeGray: options.includeGray,
      maxSkills: options.maxSkills,
      maxBytes: options.maxBytes,
      maxTokens: options.maxTokens,
      hostTokenCounter: false,
      hostCapability: featureDecision.optimizationAllowed ? options.hostCapability : 'unsupported'
    })
    const decision = {
      ...bundleDecision,
      executionOptimization: {
        schemaVersion: featureDecision.schemaVersion,
        lifecycleState: featureDecision.lifecycleState,
        stateStatus: featureDecision.stateStatus,
        reasonCode: featureDecision.reasonCode,
        optimizationAllowed: featureDecision.optimizationAllowed
      }
    }
    if (decision.completion === 'blocked') {
      printSkillFailure(options, 'SKILL_BUNDLE_BLOCKED', 'Skill bundle contains a mandatory lifecycle, dependency or conflict blocker.', 'Resolve the blockers or use the full existing Skill selection path.', decision, 1)
      return decision
    }
    if (options.json) printCliJson(console, createCliSuccess('skill.plan', decision, cliMetadata))
    else printSkillPlanHuman(decision)
    process.exitCode = 0
    return decision
  }

  return { cmdSkill, cmdTask }
}

module.exports = { buildCliExecutionCommands }
