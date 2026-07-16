'use strict'

const CLI_ENVELOPE_SCHEMA_VERSION = 'DevCodexCliEnvelopeV1'

function normalizeMetadata(metadata = {}) {
  return {
    packageName: String(metadata.packageName || '@vextjs/devcodex'),
    packageVersion: String(metadata.packageVersion || 'unknown')
  }
}

/** Build the stable success envelope shared by machine-readable CLI commands. */
function createCliSuccess(command, payload, metadata = {}) {
  const normalized = normalizeMetadata(metadata)
  return {
    schemaVersion: CLI_ENVELOPE_SCHEMA_VERSION,
    ok: true,
    command: String(command || ''),
    ...normalized,
    payload
  }
}

/** Build a stable CLI contract error without exposing stack or host internals. */
function createCliFailure(command, errorCode, message, nextStep, metadata = {}, details = null) {
  const normalized = normalizeMetadata(metadata)
  const envelope = {
    schemaVersion: CLI_ENVELOPE_SCHEMA_VERSION,
    ok: false,
    command: String(command || ''),
    ...normalized,
    errorCode: String(errorCode || 'CLI_ERROR'),
    message: String(message || 'CLI command failed'),
    nextStep: String(nextStep || 'Review the command arguments and retry.')
  }
  if (details !== null && details !== undefined) envelope.details = details
  return envelope
}

/** Parse the common `--json` flag and reject every undeclared option. */
function parseJsonArgs(argv, { allowed = [] } = {}) {
  const allowedSet = new Set(allowed)
  const options = { json: false, errors: [] }
  for (const arg of Array.isArray(argv) ? argv : []) {
    if (arg === '--json') options.json = true
    else if (!allowedSet.has(arg)) options.errors.push(`unsupported option: ${arg}`)
  }
  return options
}

function printCliJson(targetConsole, envelope) {
  targetConsole.log(JSON.stringify(envelope, null, 2))
}

module.exports = {
  CLI_ENVELOPE_SCHEMA_VERSION,
  createCliFailure,
  createCliSuccess,
  parseJsonArgs,
  printCliJson
}
