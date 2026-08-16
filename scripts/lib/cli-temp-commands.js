'use strict'

const { createCliFailure, createCliSuccess, printCliJson } = require('./cli-json-contract.js')
const {
  inspectWorkspaceTempGovernance,
  maintainWorkspaceTemp
} = require('./workspace-temp-governance.js')

function buildCliTempCommands({ process, console, c, cliMetadata = {} }) {
  function fail(message, json) {
    const failure = createCliFailure(
      'tmp',
      'CLI_INVALID_OPTION',
      message,
      'Use `devcodex tmp status [--project=<id>] [--partition=<name>] [--json]` or `devcodex tmp maintain [--apply --project=<id> --partition=<name>] [--json]`.',
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
    const valueOptions = Object.fromEntries(options
      .filter(item => /^--(?:project|partition|cursor|page-size|max-deletes|max-delete-bytes)=/.test(item))
      .map(item => {
        const index = item.indexOf('=')
        return [item.slice(2, index), item.slice(index + 1)]
      }))
    const unknown = options.filter(item => !['--json', '--dry-run', '--apply'].includes(item) &&
      !/^--(?:project|partition|cursor|page-size|max-deletes|max-delete-bytes)=.+/.test(item))
    if (!['status', 'prune', 'maintain'].includes(operation) || unknown.length) {
      return fail(unknown.length ? `Unknown tmp option: ${unknown[0]}` : `Unknown tmp subcommand: ${operation || '(none)'}`, json)
    }
    if (operation === 'status' && options.some(item => item === '--dry-run' || item === '--apply')) {
      return fail('tmp status does not accept --dry-run or --apply.', json)
    }
    if (options.includes('--dry-run') && options.includes('--apply')) {
      return fail('--dry-run and --apply are mutually exclusive.', json)
    }
    if (valueOptions.cursor && (!valueOptions.project || !valueOptions.partition || operation !== 'status')) {
      return fail('--cursor requires tmp status with one explicit --project and --partition scope.', json)
    }
    const numericOptions = [
      ['page-size', value => Number.isInteger(value) && value > 0],
      ['max-deletes', value => Number.isInteger(value) && value >= 0],
      ['max-delete-bytes', value => Number.isFinite(value) && value >= 0]
    ]
    for (const [name, valid] of numericOptions) {
      if (valueOptions[name] !== undefined && !valid(Number(valueOptions[name]))) {
        return fail(`--${name} has an invalid numeric value.`, json)
      }
    }

    if (operation === 'status') {
      let status
      try {
        status = inspectWorkspaceTempGovernance(process.cwd(), {
          project: valueOptions.project,
          partition: valueOptions.partition,
          cursor: valueOptions.cursor,
          pageSize: valueOptions['page-size'] ? Number(valueOptions['page-size']) : undefined
        })
      } catch (error) {
        return failOperation(operation, error, json)
      }
      if (json) printCliJson(console, createCliSuccess('tmp.status', status, cliMetadata))
      else {
        console.log(`\n  ${c.bold('DevCodex workspace temp')} in ${status.cwd}`)
        console.log(`  ${c.cyan('canonical root'.padEnd(18))} ${status.canonicalRoot}`)
        console.log(`  registered: ${status.totals.registered}; orphan: ${status.totals.orphan}; legacy: ${status.totals.legacy}; eligible: ${status.totals.eligible}`)
        console.log(`  complete: ${status.completeness.all}; scopes: ${status.scopes.length}`)
        for (const legacy of status.legacyRoots) {
          console.log(c.yellow(`  legacy root: ${legacy.root} (${legacy.files} files, ${legacy.bytes} bytes)`))
        }
        for (const external of status.externalRoots) {
          console.log(c.yellow(`  external root (report-only): ${external.root}`))
        }
        const blocked = status.scopes.flatMap(scope => scope.blocked)
        for (const record of blocked.slice(0, 10)) {
          console.log(c.dim(`  blocked: ${record.targetPath || record.manifestPath} — ${(record.reasons || []).join(', ')}`))
        }
        if (blocked.length > 10) console.log(c.dim(`  … ${blocked.length - 10} additional blocked entries omitted`))
      }
      return status
    }

    const apply = options.includes('--apply')
    let payload
    try {
      payload = maintainWorkspaceTemp(process.cwd(), {
        apply,
        project: valueOptions.project,
        partition: valueOptions.partition,
        cursor: valueOptions.cursor,
        pageSize: valueOptions['page-size'] ? Number(valueOptions['page-size']) : undefined,
        maxDeletes: valueOptions['max-deletes'] ? Number(valueOptions['max-deletes']) : undefined,
        maxDeleteBytes: valueOptions['max-delete-bytes'] ? Number(valueOptions['max-delete-bytes']) : undefined
      })
    } catch (error) {
      return failOperation(operation, error, json)
    }
    if (json) printCliJson(console, createCliSuccess(`tmp.${operation}`, payload, cliMetadata))
    else {
      console.log(`\n  ${c.bold(`DevCodex workspace temp ${operation}`)} (${payload.receipt.mode})`)
      console.log(`  selected: ${payload.plan.selected.length}; removed: ${payload.receipt.removed.length}; failed: ${payload.receipt.failed.length}`)
      if (!payload.plan.applyAllowed) console.log(c.dim('  apply requires one explicit complete --project/--partition scope'))
      for (const candidate of payload.plan.selected) {
        const removed = payload.receipt.removed.some(item => item.artifactId === candidate.artifactId)
        console.log(`  ${apply && removed ? c.green('removed') : c.yellow('would remove')} ${candidate.targetPath}`)
      }
      for (const failure of payload.receipt.failed) console.log(c.red(`  ${failure.errorCode}: ${failure.artifactId}`))
    }
    if (payload.receipt.failed.length) process.exitCode = 2
    return payload
  }

  return { cmdTemp }
}

module.exports = { buildCliTempCommands }
