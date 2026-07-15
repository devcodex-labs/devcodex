#!/usr/bin/env node
'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
  classifyTurnLiveness,
  normalizeTurnLivenessState
} = require('../hooks/_runtime/lifecycle-turn-liveness.cjs')
const {
  findLayoutInfo,
  inferProjectFromCwd,
  namespaceRootPath
} = require('../hooks/_runtime/workspace-layout.cjs')

const SIDECAR_MODE = 'gray-read-only-one-shot'

function parseArgs(argv) {
  const options = { json: false, help: false, stateFile: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--state') {
      if (!argv[index + 1]) throw new Error('--state requires a lifecycle-state.json path')
      options.stateFile = path.resolve(argv[++index])
    } else {
      throw new Error(`unsupported option: ${arg}`)
    }
  }
  return options
}

function resolveDefaultStateFile(cwd) {
  const layout = findLayoutInfo(cwd)
  if (!layout.enabled) {
    return path.join(path.resolve(cwd), '.devcodex', '.memory', 'hooks', 'legacy', 'lifecycle-state.json')
  }
  const project = inferProjectFromCwd(cwd, layout)
  const activeRoot = project
    ? namespaceRootPath(layout.workspaceRoot, project)
    : path.join(layout.workspaceRoot, '.devcodex', 'workspace')
  return path.join(activeRoot, '.memory', 'hooks', project || 'workspace', 'lifecycle-state.json')
}

function inspectTurnLiveness(stateFile, options = {}) {
  const observedAtMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  const bytes = fs.readFileSync(stateFile)
  const parsed = JSON.parse(bytes.toString('utf8'))
  const sourceShape = parsed?.turnLiveness && typeof parsed.turnLiveness === 'object'
    ? 'lifecycle-state.turnLiveness'
    : 'direct-turn-liveness'
  const state = normalizeTurnLivenessState(parsed?.turnLiveness || parsed, { nowMs: observedAtMs })
  const classification = classifyTurnLiveness(state, { nowMs: observedAtMs })
  return {
    schemaVersion: 1,
    sidecarMode: SIDECAR_MODE,
    evidenceMode: 'sidecar-observed',
    observedAt: new Date(observedAtMs).toISOString(),
    stateFile: path.resolve(stateFile),
    sourceShape,
    sourceSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    turnKey: state.turnKey,
    persistedState: state.state,
    classification,
    lastEventType: state.lastEventType,
    lastEventAt: state.lastEventAt,
    lastToolOutputAt: state.lastToolOutputAt,
    continuationAckAt: state.continuationAckAt,
    inFlightOperation: state.inFlightOperation,
    checkpoint: state.checkpoint,
    thresholds: state.thresholds,
    capabilityBoundary: {
      readOnly: true,
      oneShot: true,
      hostWakeup: false,
      stateMutation: false,
      operationReplay: false,
      processControl: false
    }
  }
}

function formatHuman(result) {
  return [
    `turn-liveness: state=${result.classification.state} reason=${result.classification.reason} ageMs=${result.classification.ageMs}`,
    `evidence=${result.evidenceMode} mode=${result.sidecarMode} source=${result.stateFile}`,
    'boundary=read-only, one-shot, no host wakeup, no state mutation, no replay, no process control'
  ].join('\n')
}

function printHelp() {
  process.stdout.write([
    'Usage: node scripts/check-turn-liveness.js [--state <lifecycle-state.json>] [--json]',
    '',
    'Gray one-shot sidecar: reads and classifies DevCodex Turn Liveness state.',
    'It never watches, writes state, wakes a host, replays an operation, or controls a process.'
  ].join('\n') + '\n')
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.help) return printHelp()
    const stateFile = options.stateFile || resolveDefaultStateFile(process.cwd())
    const result = inspectTurnLiveness(stateFile)
    process.stdout.write((options.json ? JSON.stringify(result, null, 2) : formatHuman(result)) + '\n')
  } catch (error) {
    process.stderr.write(`turn-liveness sidecar error: ${error.message}\n`)
    process.exitCode = 2
  }
}

if (require.main === module) main()

module.exports = {
  SIDECAR_MODE,
  formatHuman,
  inspectTurnLiveness,
  parseArgs,
  resolveDefaultStateFile
}
