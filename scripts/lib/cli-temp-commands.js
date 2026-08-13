'use strict'

const { createCliFailure, createCliSuccess, printCliJson } = require('./cli-json-contract.js')
const { inspectWorkspaceTemp, pruneWorkspaceTemp } = require('./workspace-temp.js')

function buildCliTempCommands({ process, console, c, cliMetadata = {} }) {
  function fail(message, json) {
    const failure = createCliFailure(
      'tmp',
      'CLI_INVALID_OPTION',
      message,
      'Use `devcodex tmp status [--json]` or `devcodex tmp prune [--dry-run|--apply] [--json]`.',
      cliMetadata
    )
    if (json) printCliJson(console, failure)
    else console.log(c.red(`  ${failure.errorCode}: ${failure.message}`))
    process.exitCode = 2
    return failure
  }

  function failOperation(operation, error, json) {
    const causeCode = /^[A-Z][A-Z0-9_]+$/.test(String(error?.code || ''))
      ? String(error.code)
      : 'WORKSPACE_TEMP_OPERATION_FAILED'
    const failure = createCliFailure(
      `tmp.${operation}`,
      causeCode,
      String(error?.message || 'Workspace temporary artifact operation failed.'),
      'Resolve the reported filesystem or manifest problem, then run `devcodex tmp status` again.',
      cliMetadata
    )
    if (json) printCliJson(console, failure)
    else console.log(c.red(`  ${failure.errorCode}: ${failure.message}`))
    process.exitCode = 2
    return failure
  }

  function cmdTemp(argv = []) {
    const operation = argv[0]
    const options = argv.slice(1)
    const json = argv.includes('--json')
    const unknown = options.filter(item => !['--json', '--dry-run', '--apply'].includes(item))
    if (!['status', 'prune'].includes(operation) || unknown.length) {
      return fail(unknown.length ? `Unknown tmp option: ${unknown[0]}` : `Unknown tmp subcommand: ${operation || '(none)'}`, json)
    }
    if (operation === 'status' && options.some(item => item === '--dry-run' || item === '--apply')) {
      return fail('tmp status accepts --json only.', json)
    }
    if (operation === 'prune' && options.includes('--dry-run') && options.includes('--apply')) {
      return fail('--dry-run and --apply are mutually exclusive.', json)
    }

    if (operation === 'status') {
      let status
      try { status = inspectWorkspaceTemp(process.cwd()) } catch (error) {
        return failOperation(operation, error, json)
      }
      if (json) printCliJson(console, createCliSuccess('tmp.status', status, cliMetadata))
      else {
        console.log(`\n  ${c.bold('DevCodex workspace temp')} in ${status.cwd}`)
        console.log(`  ${c.cyan('canonical root'.padEnd(18))} ${status.canonicalRoot}`)
        console.log(`  manifests: ${status.totals.manifests}; prune candidates: ${status.totals.candidates}; blocked: ${status.totals.blocked}`)
        console.log(`  inspected: ${status.totals.observedEntries}/${status.totals.maxEntries}; truncated: ${status.totals.truncated}`)
        if (!status.exists) console.log(c.dim('  The canonical temp root has not been created yet.'))
        for (const legacy of status.legacyRoots) {
          console.log(c.yellow(`  legacy root: ${legacy.root} (${legacy.files} files, ${legacy.bytes} bytes)`))
        }
        for (const external of status.externalRoots) {
          console.log(c.yellow(`  external root (report-only): ${external.root}`))
        }
        for (const record of status.blocked.slice(0, 10)) {
          console.log(c.dim(`  blocked: ${record.targetPath || record.manifestPath} — ${(record.reasons || []).join(', ')}`))
        }
        if (status.blocked.length > 10) console.log(c.dim(`  … ${status.blocked.length - 10} additional blocked entries omitted`))
      }
      return status
    }

    const apply = options.includes('--apply')
    let payload
    try { payload = pruneWorkspaceTemp(process.cwd(), { apply }) } catch (error) {
      return failOperation(operation, error, json)
    }
    if (json) printCliJson(console, createCliSuccess('tmp.prune', payload, cliMetadata))
    else {
      console.log(`\n  ${c.bold('DevCodex workspace temp prune')} (${payload.mode})`)
      console.log(`  candidates: ${payload.candidates.length}; removed: ${payload.removed.length}; blocked: ${payload.blocked.length}; failed: ${payload.failed.length}`)
      if (payload.inspection.truncated) console.log(c.red('  bounded inspection was truncated; apply is fail-closed and removes nothing'))
      for (const candidate of payload.candidates) {
        const removed = payload.removed.some(item => item.artifactId === candidate.artifactId)
        console.log(`  ${apply && removed ? c.green('removed') : c.yellow('would remove')} ${candidate.targetPath}`)
      }
      for (const failure of payload.failed) console.log(c.red(`  ${failure.errorCode}: ${failure.targetPath}`))
    }
    if (payload.failed.length) process.exitCode = 2
    return payload
  }

  return { cmdTemp }
}

module.exports = { buildCliTempCommands }
