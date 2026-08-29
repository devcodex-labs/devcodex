'use strict'

const PACKAGE_JSON = require('../../package.json')
const { createCliFailure, createCliSuccess, printCliJson } = require('./cli-json-contract.js')
const {
  buildGovernanceLedgerIndex,
  initializeGovernanceLedgerManifest,
  loadGovernanceLedgerManifest,
  normalizeLedgerKind,
  rebuildGovernanceLedgerIndex
} = require('./governance-ledger-resolver.js')
const {
  applyGapRegistryMigration,
  buildGapRegistryMigrationPlan,
  rollbackGapRegistryMigration
} = require('./governance-ledger-migration.js')

const DIGEST_RE = /^[a-f0-9]{64}$/

function parseLedgerArgs (argv) {
  const values = Array.isArray(argv) ? argv : []
  const options = { action: values[0] || '', json: false, apply: false, kind: '', planDigest: '', errors: [] }
  for (let index = 1; index < values.length; index += 1) {
    const arg = String(values[index])
    if (arg === '--json') options.json = true
    else if (arg === '--apply') options.apply = true
    else if (arg === '--kind' || arg === '--plan') {
      const value = values[index + 1]
      if (!value || String(value).startsWith('--')) options.errors.push(`${arg} requires a value`)
      else {
        if (arg === '--kind') options.kind = String(value)
        else options.planDigest = String(value)
        index += 1
      }
    } else options.errors.push(`unsupported option: ${arg}`)
  }
  return options
}

function buildCliGovernanceCommands (ctx) {
  const { process, console, c, resolveActiveRuntimeRoot } = ctx
  const cliMetadata = { packageName: PACKAGE_JSON.name, packageVersion: PACKAGE_JSON.version }

  function fail (command, options, code, message, nextStep) {
    if (options.json) printCliJson(console, createCliFailure(command, code, message, nextStep, cliMetadata))
    else {
      console.log(c.red(`  ${code}: ${message}`))
      console.log(c.dim(`  ${nextStep}`))
    }
    process.exitCode = 2
    return null
  }

  function succeed (command, options, payload, summary) {
    if (options.json) printCliJson(console, createCliSuccess(command, payload, cliMetadata))
    else console.log(summary)
    return payload
  }

  function cmdGovernance (argv) {
    const values = Array.isArray(argv) ? argv : []
    if (values[0] !== 'ledger') {
      return fail(
        'governance',
        { json: values.includes('--json') },
        'GOVERNANCE_SUBCOMMAND_REQUIRED',
        `Unknown governance subcommand: ${values[0] || '(none)'}`,
        'Use: devcodex governance ledger init|plan|apply|rollback|index [options]'
      )
    }
    const options = parseLedgerArgs(values.slice(1))
    const command = `governance ledger ${options.action || ''}`.trim()
    if (options.errors.length) {
      return fail(command, options, 'CLI_INVALID_OPTION', options.errors.join('; '), 'Review `devcodex help governance` and retry.')
    }
    const activeRoot = resolveActiveRuntimeRoot(process.cwd())
    try {
      if (options.action === 'init') {
        if (options.kind || options.planDigest) return fail(command, options, 'CLI_INVALID_OPTION', '--kind/--plan are not valid for init.', 'Use: devcodex governance ledger init [--apply] [--json]')
        if (!options.apply) {
          const loaded = loadGovernanceLedgerManifest(activeRoot)
          return succeed(command, options, {
            schemaVersion: 'GovernanceLedgerInitPlanV1',
            status: loaded.origin === 'manifest' ? 'existing' : 'planned',
            activeRoot,
            manifestFile: loaded.file,
            manifestDigest: loaded.inspection.manifestDigest,
            ledgerFamilies: Object.values(loaded.manifest.ledgerFamilies).map(family => ({
              kind: family.kind,
              activePath: family.activePath,
              nextSequence: family.nextSequence
            }))
          }, `  Governance ledger manifest ${loaded.origin === 'manifest' ? 'already exists' : 'is ready to initialize'} (${loaded.inspection.manifestDigest}).`)
        }
        const initialized = initializeGovernanceLedgerManifest(activeRoot)
        const index = rebuildGovernanceLedgerIndex(activeRoot)
        return succeed(command, options, {
          schemaVersion: 'GovernanceLedgerInitReceiptV1',
          status: initialized.status,
          activeRoot,
          manifestFile: initialized.file,
          manifestDigest: initialized.manifestDigest,
          indexFile: index.receipt.file,
          indexDigest: index.receipt.digest
        }, `  Governance ledger manifest ${initialized.status}; derived index rebuilt.`)
      }

      if (options.action === 'plan') {
        if (options.apply || options.planDigest) return fail(command, options, 'CLI_INVALID_OPTION', '--apply/--plan are not valid for plan.', 'Use: devcodex governance ledger plan --kind GR [--json]')
        if (normalizeLedgerKind(options.kind) !== 'GR') return fail(command, options, 'GOVERNANCE_LEDGER_KIND_REQUIRED', 'The pilot plan requires --kind GR.', 'Use: devcodex governance ledger plan --kind GR [--json]')
        const plan = buildGapRegistryMigrationPlan(activeRoot)
        return succeed(command, options, plan, `  GR migration plan ${plan.planDigest}: ${plan.candidateCount} terminal records, ${plan.shards.length} shard(s).`)
      }

      if (options.action === 'apply') {
        if (options.apply) return fail(command, options, 'CLI_INVALID_OPTION', 'apply is already explicit; do not add --apply.', 'Use: devcodex governance ledger apply --kind GR --plan <sha256> [--json]')
        if (normalizeLedgerKind(options.kind) !== 'GR') return fail(command, options, 'GOVERNANCE_LEDGER_KIND_REQUIRED', 'The pilot apply requires --kind GR.', 'Use: devcodex governance ledger apply --kind GR --plan <sha256> [--json]')
        if (!DIGEST_RE.test(options.planDigest)) return fail(command, options, 'GOVERNANCE_LEDGER_MIGRATION_PLAN_REQUIRED', 'A 64-character dry-run plan digest is required.', 'Run `devcodex governance ledger plan --kind GR --json`, then pass its planDigest.')
        const receipt = applyGapRegistryMigration(activeRoot, options.planDigest)
        return succeed(command, options, receipt, `  GR migration ${receipt.status}: ${receipt.candidateCount} record(s).`)
      }

      if (options.action === 'rollback') {
        if (options.apply) return fail(command, options, 'CLI_INVALID_OPTION', 'rollback is already explicit; do not add --apply.', 'Use: devcodex governance ledger rollback --kind GR --plan <sha256> [--json]')
        if (normalizeLedgerKind(options.kind) !== 'GR') return fail(command, options, 'GOVERNANCE_LEDGER_KIND_REQUIRED', 'The pilot rollback requires --kind GR.', 'Use: devcodex governance ledger rollback --kind GR --plan <sha256> [--json]')
        if (!DIGEST_RE.test(options.planDigest)) return fail(command, options, 'GOVERNANCE_LEDGER_MIGRATION_PLAN_REQUIRED', 'The applied plan digest is required.', 'Pass the planDigest from GovernanceLedgerMigrationReceiptV1.')
        const receipt = rollbackGapRegistryMigration(activeRoot, options.planDigest)
        return succeed(command, options, receipt, `  GR migration ${receipt.status}.`)
      }

      if (options.action === 'index') {
        if (options.kind || options.planDigest) return fail(command, options, 'CLI_INVALID_OPTION', '--kind/--plan are not valid for index.', 'Use: devcodex governance ledger index [--apply] [--json]')
        if (!options.apply) {
          const index = buildGovernanceLedgerIndex(activeRoot)
          return succeed(command, options, {
            schemaVersion: 'GovernanceLedgerIndexPlanV1',
            status: 'planned',
            activeRoot,
            manifestDigest: index.manifestDigest,
            sourceCount: index.sourceCount,
            recordCount: index.recordCount
          }, `  Derived index preview: ${index.recordCount} records from ${index.sourceCount} sources.`)
        }
        const rebuilt = rebuildGovernanceLedgerIndex(activeRoot)
        return succeed(command, options, {
          schemaVersion: 'GovernanceLedgerIndexReceiptV1',
          status: 'rebuilt',
          activeRoot,
          ...rebuilt.receipt
        }, `  Derived governance ledger index rebuilt (${rebuilt.receipt.recordCount} records).`)
      }

      return fail(command, options, 'GOVERNANCE_LEDGER_ACTION_REQUIRED', `Unknown ledger action: ${options.action || '(none)'}`, 'Use: devcodex governance ledger init|plan|apply|rollback|index [options]')
    } catch (error) {
      return fail(command, options, error.code || 'GOVERNANCE_LEDGER_COMMAND_FAILED', error.message, 'Repair the reported manifest/ledger condition, regenerate the dry-run plan if needed, and retry.')
    }
  }

  return { cmdGovernance }
}

module.exports = { buildCliGovernanceCommands, parseLedgerArgs }
