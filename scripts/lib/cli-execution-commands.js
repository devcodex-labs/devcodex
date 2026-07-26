'use strict'

const fs = require('fs')
const path = require('path')
const PACKAGE_JSON = require('../../package.json')
const {
  TaskContinuationError,
  resolveTaskContinuation,
  resolveUniqueActiveTaskContinuation
} = require('../../hooks/_runtime/task-continuation-contract.cjs')
const {
  WorkflowCompletionLifecycleError,
  appendRiskAcceptanceDecision,
  inspectTaskWorkflowCompletion,
  verifyTaskWorkflowCompletion
} = require('../../hooks/_runtime/lifecycle-workflow-completion.cjs')
const { buildBundleDecisionV2 } = require('../../mcp/profile-contract.js')
const { resolveExecutionFeatureDecisionForCwd } = require('../../hooks/_runtime/execution-optimization-routing.cjs')
const { createCliFailure, createCliSuccess, printCliJson } = require('./cli-json-contract.js')

function resolveCompletionTask({ cwd, task, project, resolveTask = resolveTaskContinuation, resolveUniqueTask = resolveUniqueActiveTaskContinuation }) {
  const resolution = task
    ? resolveTask({ cwd, name: task, project })
    : resolveUniqueTask({ cwd, project })
  if (resolution?.status === 'resolved-active' && (resolution.candidate?.legacy || !resolution.candidate?.taskId)) {
    return {
      ...resolution,
      status: 'stale-confirmation',
      errorCode: 'TASK_IDENTITY_INVALID',
      message: `Task ${resolution.candidate?.displayName || '(unknown)'} needs a stable TaskIdentityV1 before completion verification.`,
      nextStep: 'Materialize .memory/task.json with a stable taskId, then retry.'
    }
  }
  return resolution
}

function completionTaskContext(resolution) {
  const candidate = resolution?.candidate
  if (resolution?.status !== 'resolved-active' || !candidate?.taskRoot) return null
  return {
    taskRoot: candidate.taskRoot,
    activeRoot: path.resolve(candidate.taskRoot, '..', '..'),
    taskKey: `${candidate.project}:${candidate.kind}:${candidate.taskId}`,
    taskResolution: resolution
  }
}

function readCompletionForCli({ cwd, task = '', project = '', verify = false, persist = false, nowMs, resolveTask, resolveUniqueTask }) {
  const taskResolution = resolveCompletionTask({ cwd, task, project, resolveTask, resolveUniqueTask })
  const context = completionTaskContext(taskResolution)
  if (!context) return { taskResolution, completion: null }
  const completion = verify
    ? verifyTaskWorkflowCompletion({ ...context, persist, nowMs })
    : inspectTaskWorkflowCompletion({ ...context, nowMs })
  return { taskResolution, completion }
}

function buildCliExecutionCommands(ctx) {
  const {
    process,
    console,
    c,
    resolveTask = resolveTaskContinuation,
    resolveUniqueTask = resolveUniqueActiveTaskContinuation,
    verifyCompletion = verifyTaskWorkflowCompletion,
    appendRisk = appendRiskAcceptanceDecision,
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

  function parseCompletionTaskArgs(argv) {
    const values = Array.isArray(argv) ? argv : []
    const risk = values[0] === 'risk'
    const options = {
      action: risk ? `risk-${values[1] || ''}` : values[0] || '',
      task: '', project: '', requirementId: '', receiptDigest: '', reason: '', expiresAt: '',
      full: false, json: false, errors: []
    }
    const start = risk ? 2 : 1
    const single = (field, flag, value) => {
      if (!value || String(value).startsWith('--')) options.errors.push(`${flag} requires a value`)
      else if (options[field]) options.errors.push(`${flag} is non-repeatable`)
      else options[field] = String(value)
    }
    for (let index = start; index < values.length; index += 1) {
      const arg = String(values[index])
      if (arg === '--json') options.json = true
      else if (arg === '--full') options.full = true
      else if (['--task', '--project', '--requirement', '--receipt', '--reason', '--expires-at'].includes(arg)) {
        const field = ({ '--task': 'task', '--project': 'project', '--requirement': 'requirementId', '--receipt': 'receiptDigest', '--reason': 'reason', '--expires-at': 'expiresAt' })[arg]
        const value = values[index + 1]
        single(field, arg, value)
        if (value && !String(value).startsWith('--')) index += 1
      } else options.errors.push(`unsupported option: ${arg}`)
    }
    if (!['verify', 'risk-accept', 'risk-revoke'].includes(options.action)) options.errors.push(`unknown task subcommand: ${values.slice(0, 2).join(' ') || '(none)'}`)
    if (options.action.startsWith('risk-') && !options.task) options.errors.push('--task is required for risk mutation')
    if (options.action === 'risk-accept' && !options.requirementId) options.errors.push('--requirement is required')
    if (options.action === 'risk-revoke' && !options.receiptDigest) options.errors.push('--receipt is required')
    if (options.action.startsWith('risk-') && !options.reason) options.errors.push('--reason is required')
    if (options.action === 'risk-revoke' && options.expiresAt) options.errors.push('--expires-at is only valid for risk accept')
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
    if (argv[0] === 'verify' || argv[0] === 'risk') return cmdTaskCompletion(argv)
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

  function renderCompletionFailure(options, operation, code, message, nextStep, details, exitCode) {
    if (options.json) printCliJson(console, createCliFailure(operation, code, message, nextStep, cliMetadata, details))
    else {
      console.log(c.red(`  [${code}] ${message}`))
      console.log(c.dim(`  ${nextStep}`))
    }
    process.exitCode = exitCode
  }

  function printCompletionHuman(payload) {
    const projection = payload.completion?.projection
    console.log()
    console.log(c.bold('  DevCodex workflow completion'))
    console.log(`  ${c.cyan('task'.padEnd(18))} ${payload.taskResolution.candidate.displayName}`)
    console.log(`  ${c.cyan('evidence'.padEnd(18))} ${projection?.workflowEvidenceState || 'UNVERIFIED'}`)
    console.log(`  ${c.cyan('phase'.padEnd(18))} ${projection?.completionPhase || 'unavailable'}`)
    console.log(`  ${c.cyan('workflowComplete'.padEnd(18))} ${projection?.workflowComplete === true}`)
    console.log(`  ${c.cyan('deliveryCommitted'.padEnd(18))} ${projection?.deliveryCommitted === true}`)
    console.log(`  ${c.cyan('projectionDigest'.padEnd(18))} ${projection?.projectionDigest || '(none)'}`)
    if (projection?.diagnostics?.firstBlocker) console.log(`  ${c.yellow('firstBlocker'.padEnd(18))} ${projection.diagnostics.firstBlocker.requirementId}`)
    console.log()
  }

  function cmdTaskCompletion(argv) {
    const options = parseCompletionTaskArgs(argv)
    const operation = options.action === 'verify' ? 'task.verify' : `task.risk.${options.action.split('-')[1] || 'unknown'}`
    if (options.errors.length) {
      renderCompletionFailure(options, operation, 'CLI_INVALID_OPTION', options.errors.join('; '),
        'Use: devcodex task verify [--task <task>] [--project <name>] [--full] [--json] or task risk accept|revoke with explicit --task.',
        { errors: options.errors }, 2)
      return null
    }
    let taskResolution
    try {
      taskResolution = resolveCompletionTask({ cwd: process.cwd(), task: options.task, project: options.project, resolveTask, resolveUniqueTask })
    } catch (error) {
      if (!(error instanceof TaskContinuationError)) throw error
      renderCompletionFailure(options, operation, error.code, error.message, error.nextStep || 'Correct the task selector and retry.', null, 2)
      return null
    }
    const context = completionTaskContext(taskResolution)
    if (!context) {
      renderCompletionFailure(options, operation, taskResolution.errorCode || 'TASK_RESOLUTION_FAILED', taskResolution.message || 'Task resolution failed.', taskResolution.nextStep || 'Choose an exact active task.', taskResolution, 2)
      return taskResolution
    }
    if (options.action === 'verify') {
      const completion = verifyCompletion({ ...context, persist: true, full: options.full })
      const payload = { taskResolution, completion }
      const complete = completion.projection?.workflowComplete === true && completion.projection?.deliveryCommitted === true
      if (options.json) printCliJson(console, createCliSuccess(operation, payload, cliMetadata))
      else printCompletionHuman(payload)
      process.exitCode = complete ? 0 : 1
      return payload
    }
    try {
      const result = appendRisk({
        taskRoot: context.taskRoot,
        action: options.action === 'risk-accept' ? 'accept' : 'revoke',
        requirementId: options.requirementId,
        receiptDigest: options.receiptDigest,
        reason: options.reason,
        expiresAt: options.expiresAt || null,
        actor: process.env.USERNAME || process.env.USER || 'local-cli-user'
      })
      const payload = { taskResolution, risk: result }
      if (options.json) printCliJson(console, createCliSuccess(operation, payload, cliMetadata))
      else console.log(c.green(`  ${operation} persisted: ${result.receipt.receiptDigest}`))
      process.exitCode = 0
      return payload
    } catch (error) {
      if (!(error instanceof WorkflowCompletionLifecycleError)) throw error
      const exitCode = ['RISK_REQUIREMENT_NON_WAIVABLE', 'RISK_SCOPE_INVALID'].includes(error.code) ? 1 : 2
      renderCompletionFailure(options, operation, error.code, error.message, 'Correct the risk scope or inspect task completion diagnostics.', { details: error.details }, exitCode)
      return null
    }
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
    if (!['plan', 'resolve', 'match'].includes(options.action)) {
      options.errors.push(`unknown skill subcommand: ${options.action || '(none)'}`)
    }
    if (options.action === 'plan' && !options.candidateIds.length) {
      options.errors.push('at least one candidate skill id is required')
    }
    if (options.action === 'resolve' && !options.candidateIds.length) {
      options.errors.push('at least one skill id is required for resolve')
    }
    if (options.action === 'match' && !options.candidateIds.length) {
      options.errors.push('match requires a user prompt string (quote multi-word prompts)')
    }
    return options
  }

  function printSkillFailure(options, errorCode, message, nextStep, details, exitCode) {
    const operation = options.action === 'match'
      ? 'skill.match'
      : (options.action === 'resolve' ? 'skill.resolve' : 'skill.plan')
    if (options.json) printCliJson(console, createCliFailure(operation, errorCode, message, nextStep, cliMetadata, details))
    else {
      console.log(c.red(`  [${errorCode}] ${message}`))
      console.log(c.dim(`  ${nextStep}`))
    }
    process.exitCode = exitCode
  }

  function cmdSkillMatch(options) {
    let matchWorkspaceSkills
    try {
      ;({ matchWorkspaceSkills } = require('../../hooks/_runtime/workspace-skill-auto-match.cjs'))
    } catch (error) {
      printSkillFailure(options, 'SKILL_AUTO_MATCH_UNAVAILABLE', error.message, 'Reinstall DevCodex runtime hooks and retry.', null, 1)
      return null
    }
    const prompt = options.candidateIds.join(' ')
    const result = matchWorkspaceSkills(prompt, {
      cwd: process.cwd(),
      consumerAuthority: 'cli'
    })
    // Do not dump full skill body in default human output unless --json
    const publicResult = {
      ...result,
      content: options.json ? result.content : undefined,
      injectionText: options.json ? result.injectionText : (result.matched ? '[present; use --json for full inject text]' : '')
    }
    if (options.json) {
      printCliJson(console, {
        schemaVersion: 'DevCodexCliEnvelopeV1',
        operation: 'skill.match',
        ok: true,
        result
      })
    } else {
      console.log()
      console.log(c.bold('  DevCodex WorkspaceSkillAutoMatch'))
      console.log(`  ${c.cyan('prompt'.padEnd(16))} ${prompt}`)
      console.log(`  ${c.cyan('matched'.padEnd(16))} ${result.matched}`)
      console.log(`  ${c.cyan('skillId'.padEnd(16))} ${result.skillId || '(none)'}`)
      console.log(`  ${c.cyan('score'.padEnd(16))} ${result.score}`)
      console.log(`  ${c.cyan('layer'.padEnd(16))} ${result.selectedLayer || '(none)'}`)
      console.log(`  ${c.cyan('mustReply'.padEnd(16))} ${result.mustReply || '(none)'}`)
      console.log(`  ${c.cyan('reasons'.padEnd(16))} ${(result.reasons || []).join(', ') || '(none)'}`)
      console.log(`  ${c.cyan('scanned'.padEnd(16))} ${result.candidatesScanned}`)
      if (result.matched) {
        console.log(c.dim('  closed-loop: UserPromptSubmit inject (hosts with additionalContext) + Stop force on Grok when reply ignores skill'))
      }
      console.log()
    }
    process.exitCode = 0
    return publicResult
  }

  function cmdSkillResolve(options) {
    let resolveSkillReadPlan
    try {
      ;({ resolveSkillReadPlan } = require('../../hooks/_runtime/skill-resolution.cjs'))
    } catch (error) {
      printSkillFailure(options, 'SKILL_RESOLUTION_UNAVAILABLE', error.message, 'Reinstall DevCodex runtime hooks and retry.', null, 1)
      return null
    }
    const plan = resolveSkillReadPlan(options.candidateIds, {
      cwd: process.cwd(),
      consumerAuthority: 'cli',
      includeContent: false
    })
    if (options.json) {
      printCliJson(console, {
        schemaVersion: 'DevCodexCliEnvelopeV1',
        operation: 'skill.resolve',
        ok: true,
        result: plan
      })
    } else {
      console.log()
      console.log(c.bold('  DevCodex Skill resolve'))
      console.log(`  ${c.cyan('enabled'.padEnd(16))} ${plan.enabled}`)
      console.log(`  ${c.cyan('workspace'.padEnd(16))} ${plan.workspaceRoot || '(none)'}`)
      console.log(`  ${c.cyan('global'.padEnd(16))} ${plan.globalSkillsRoot}`)
      console.log(`  ${c.cyan('covers'.padEnd(16))} ${plan.workspaceCoverCount}`)
      for (const trace of plan.traces) {
        console.log(`  ${c.cyan(trace.skillId.padEnd(16))} ${trace.selectedLayer} ${trace.securityDecision} ${trace.selectedPath || ''}`)
        if (trace.reasonCode === 'missing-SKILL.md' || (trace.fallbackReason && String(trace.fallbackReason).includes('SKILL'))) {
          console.log(c.yellow(`  hint: put file at .devcodex/workspace/skills/${trace.skillId}/SKILL.md (filename must be SKILL.md, not skill.md)`))
        }
        if (trace.reasonCode === 'workspace-accepted-casefold' || (trace.fallbackReason && String(trace.fallbackReason).startsWith('rename-'))) {
          console.log(c.yellow(`  hint: rename to exact SKILL.md for cross-platform compatibility (${trace.fallbackReason || 'casefold'})`))
        }
      }
      console.log()
    }
    process.exitCode = 0
    return plan
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
        'Use: devcodex skill plan <candidate...> | skill resolve <id...> | skill match <prompt...> [--json]',
        { errors: options.errors },
        2
      )
      return null
    }
    if (options.action === 'resolve') return cmdSkillResolve(options)
    if (options.action === 'match') return cmdSkillMatch(options)
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

module.exports = { buildCliExecutionCommands, completionTaskContext, readCompletionForCli, resolveCompletionTask }
