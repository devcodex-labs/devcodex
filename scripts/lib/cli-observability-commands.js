'use strict'

const crypto = require('crypto')
const path = require('path')
const PACKAGE_JSON = require('../../package.json')
const { normalizeTurnLivenessState } = require('../../hooks/_runtime/lifecycle-turn-liveness.cjs')
const { LocalTaskTraceError, replayLocalTaskTrace, validateLocalTaskTrace } = require('../../hooks/_runtime/lifecycle-task-trace.cjs')
const { resolveDefaultStateFile } = require('../check-turn-liveness.js')
const { createCliFailure, createCliSuccess, printCliJson } = require('./cli-json-contract.js')
const { LocalProbeContractError, createLocalProbeRegistry, runLocalProbes } = require('./local-probe.js')

function buildCliObservabilityCommands(ctx) {
  const {
    fs, process, console, c, resolveProfileDir, inspectProfileState,
    detectHostPlatform, detectInstalledHostAssets
  } = ctx
  const cliMetadata = { packageName: PACKAGE_JSON.name, packageVersion: PACKAGE_JSON.version }
  const registry = createLocalProbeRegistry([
    {
      id: 'host',
      owner: 'host-contract-verification',
      description: 'Observe the locally detectable host and installed adapter surfaces.',
      dependencies: [],
      run: ({ cwd }) => ({
        status: 'pass',
        evidence: {
          platform: detectHostPlatform(process.env, cwd),
          installedHosts: detectInstalledHostAssets(cwd),
          localOnly: true
        }
      })
    },
    {
      id: 'workspace',
      owner: 'host-contract-verification',
      description: 'Verify that the current local workspace root is readable.',
      dependencies: [],
      run: ({ cwd }) => {
        const stats = fs.statSync(cwd)
        return {
          status: stats.isDirectory() ? 'pass' : 'fail',
          evidence: { cwd, readableDirectory: stats.isDirectory(), localOnly: true },
          nextStep: 'Run the command from a readable local project directory.'
        }
      }
    },
    {
      id: 'profile',
      owner: 'host-contract-verification',
      description: 'Inspect the active local Profile contract without modifying it.',
      dependencies: ['workspace'],
      run: ({ cwd }) => {
        const directory = resolveProfileDir(cwd)
        const state = inspectProfileState(directory)
        return {
          status: state.complete ? 'pass' : 'fail',
          evidence: {
            directory,
            tier: state.tier,
            complete: state.complete,
            error: state.error,
            required: state.required,
            semantic: state.semantic,
            featureInventory: state.featureInventory || null
          },
          nextStep: 'Run devcodex profile plan and complete the reported Profile contract gaps.'
        }
      }
    }
  ])

  function parseProbeArgs(argv) {
    const options = { json: false, ids: [], errors: [] }
    for (const arg of Array.isArray(argv) ? argv : []) {
      if (arg === '--json') options.json = true
      else if (arg.startsWith('-')) options.errors.push(`unsupported option: ${arg}`)
      else options.ids.push(arg)
    }
    return options
  }

  function renderFailure(options, code, message, nextStep, details, exitCode) {
    if (options.json) {
      printCliJson(console, createCliFailure('probe', code, message, nextStep, cliMetadata, details))
    } else {
      console.log(c.red(`  [${code}] ${message}`))
      console.log(c.dim(`  ${nextStep}`))
    }
    process.exitCode = exitCode
  }

  function formatProbeHuman(run) {
    console.log()
    console.log(c.bold('  DevCodex local probes') + c.dim(` in ${run.cwd}`))
    for (const result of run.results) {
      const color = result.status === 'pass' ? c.green : (result.status === 'skipped' ? c.yellow : c.red)
      console.log(`  ${c.cyan(result.id.padEnd(14))} ${color(result.status)}`)
    }
    console.log(c.dim('  local-only; synchronous; no state mutation, network, watcher, or telemetry'))
    console.log()
  }

  function cmdProbe(argv = []) {
    const options = parseProbeArgs(argv)
    if (options.errors.length) {
      renderFailure(options, 'CLI_INVALID_OPTION', options.errors.join('; '), 'Use: devcodex probe [id ...] [--json]', { options: options.errors }, 2)
      return null
    }
    let run
    try {
      run = { ...runLocalProbes(registry, { ids: options.ids, context: { cwd: process.cwd() } }), cwd: process.cwd() }
    } catch (error) {
      if (!(error instanceof LocalProbeContractError)) throw error
      renderFailure(options, error.code, error.message, error.nextStep, { requested: options.ids, available: registry.map(item => item.id) }, 2)
      return null
    }

    const firstFailure = run.results.find(result => result.status !== 'pass')
    if (firstFailure) {
      renderFailure(
        options,
        firstFailure.errorCode,
        `Local probe ${firstFailure.id} finished with status ${firstFailure.status}.`,
        firstFailure.nextStep,
        run,
        1
      )
      return run
    }
    if (options.json) printCliJson(console, createCliSuccess('probe', run, cliMetadata))
    else formatProbeHuman(run)
    return run
  }

  function parseTraceArgs(argv) {
    const options = { action: '', json: false, stateFile: '', errors: [] }
    const values = Array.isArray(argv) ? argv : []
    for (let index = 0; index < values.length; index += 1) {
      const arg = values[index]
      if (arg === '--json') options.json = true
      else if (arg === '--state') {
        const candidate = values[index + 1]
        if (!candidate || String(candidate).startsWith('-')) options.errors.push('--state requires a lifecycle-state.json path')
        else options.stateFile = path.resolve(values[++index])
      } else if (arg.startsWith('-')) options.errors.push(`unsupported option: ${arg}`)
      else if (!options.action) options.action = arg
      else options.errors.push(`unsupported trace argument: ${arg}`)
    }
    if (!['show', 'replay'].includes(options.action)) options.errors.push(`unknown trace subcommand: ${options.action || '(none)'}`)
    return options
  }

  function renderTraceFailure(options, code, message, nextStep, details, exitCode) {
    if (options.json) printCliJson(console, createCliFailure('trace', code, message, nextStep, cliMetadata, details))
    else {
      console.log(c.red(`  [${code}] ${message}`))
      console.log(c.dim(`  ${nextStep}`))
    }
    process.exitCode = exitCode
  }

  function readTraceView(stateFile) {
    let bytes
    try { bytes = fs.readFileSync(stateFile) } catch (error) {
      throw new LocalTaskTraceError('TRACE_NOT_FOUND', `Trace state file is unavailable: ${stateFile}`, 'Provide --state with a readable lifecycle-state.json file.')
    }
    let parsed
    try { parsed = JSON.parse(bytes.toString('utf8')) } catch {
      throw new LocalTaskTraceError('TRACE_NOT_FOUND', `Trace state file is not valid JSON: ${stateFile}`, 'Repair the local state file or choose another read-only trace source.')
    }
    const directTrace = parsed?.schemaVersion === 'LocalTaskTraceV1' ? parsed : null
    const rawLiveness = directTrace ? null : (parsed?.turnLiveness || parsed)
    const persistedTrace = directTrace || rawLiveness?.taskTrace || null
    const trace = directTrace || normalizeTurnLivenessState(rawLiveness).taskTrace
    if (!trace) {
      throw new LocalTaskTraceError('TRACE_NOT_FOUND', 'No current LocalTaskTraceV1 is available in the state file.', 'Observe a UserPromptSubmit event or select a state file containing a current trace.')
    }
    return {
      schemaVersion: 'LocalTaskTraceViewV1',
      stateFile: path.resolve(stateFile),
      sourceShape: directTrace ? 'direct-local-task-trace' : (parsed?.turnLiveness ? 'lifecycle-state.turnLiveness' : 'direct-turn-liveness'),
      traceSource: persistedTrace ? 'persisted' : 'legacy-normalized-unverified',
      sourceSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      trace,
      validation: validateLocalTaskTrace(trace),
      capabilityBoundary: {
        readOnly: true,
        stateMutation: false,
        operationReplay: false,
        payloadExecution: false,
        processControl: false
      }
    }
  }

  function formatTraceHuman(view, replay = null) {
    const target = replay || view.trace
    console.log()
    console.log(c.bold(`  DevCodex trace ${replay ? 'replay' : 'show'}`) + c.dim(` from ${view.stateFile}`))
    console.log(`  ${c.cyan('traceId'.padEnd(14))} ${target.traceId}`)
    console.log(`  ${c.cyan('status'.padEnd(14))} ${target.status}`)
    console.log(`  ${c.cyan('events'.padEnd(14))} ${(target.events || []).length}`)
    console.log(c.dim('  read-only data projection; no payload execution, state mutation, process control, or host wakeup'))
    console.log()
  }

  function cmdTrace(argv = []) {
    const options = parseTraceArgs(argv)
    if (options.errors.length) {
      renderTraceFailure(options, 'CLI_INVALID_OPTION', options.errors.join('; '), 'Use: devcodex trace show|replay [--state <lifecycle-state.json>] [--json]', { errors: options.errors }, 2)
      return null
    }
    const stateFile = options.stateFile || resolveDefaultStateFile(process.cwd())
    let view
    try { view = readTraceView(stateFile) } catch (error) {
      if (!(error instanceof LocalTaskTraceError)) throw error
      renderTraceFailure(options, error.code, error.message, error.nextStep, { stateFile }, 1)
      return null
    }
    if (options.action === 'show') {
      if (options.json) printCliJson(console, createCliSuccess('trace', view, cliMetadata))
      else formatTraceHuman(view)
      return view
    }
    const replay = replayLocalTaskTrace(view.trace)
    if (!replay.ok) {
      renderTraceFailure(options, replay.errorCode, 'Local task trace replay validation failed.', 'Repair the trace identity, sequence, duplicate, or terminal violation before replaying the data projection.', { view, replay }, 1)
      return replay
    }
    const payload = { ...replay, stateFile: view.stateFile, sourceSha256: view.sourceSha256 }
    if (options.json) printCliJson(console, createCliSuccess('trace', payload, cliMetadata))
    else formatTraceHuman(view, payload)
    return payload
  }

  return { cmdProbe, cmdTrace }
}

module.exports = { buildCliObservabilityCommands }
