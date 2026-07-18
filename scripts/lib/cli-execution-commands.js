'use strict'

const PACKAGE_JSON = require('../../package.json')
const {
  TaskContinuationError,
  resolveTaskContinuation
} = require('../../hooks/_runtime/task-continuation-contract.cjs')
const { createCliFailure, createCliSuccess, printCliJson } = require('./cli-json-contract.js')

function buildCliExecutionCommands(ctx) {
  const {
    process,
    console,
    c,
    resolveTask = resolveTaskContinuation
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

  return { cmdTask }
}

module.exports = { buildCliExecutionCommands }
