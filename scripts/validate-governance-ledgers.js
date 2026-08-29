#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { inspectGovernanceLedgerFile } = require('../hooks/_runtime/governance-ledger-integrity.cjs')
const {
  LEDGER_DEFINITIONS,
  loadGovernanceLedgerManifest,
  resolveAllGovernanceLedgerFamilies
} = require('./lib/governance-ledger-resolver.js')

const LEDGERS = Object.freeze(Object.values(LEDGER_DEFINITIONS).map(definition => [
  path.basename(definition.activePath),
  definition.prefix
]))

function validateGovernanceLedgers (activeRoot) {
  const root = path.resolve(activeRoot)
  const receipts = []
  let loaded
  try {
    loaded = loadGovernanceLedgerManifest(root)
    for (const resolution of resolveAllGovernanceLedgerFamilies(root, { loaded })) {
      const prefix = LEDGER_DEFINITIONS[resolution.kind].prefix
      for (const document of resolution.documents) {
        if (!fs.existsSync(document.file)) continue
        receipts.push({
          ...inspectGovernanceLedgerFile(document.file, {
            expectedPrefix: prefix,
            exactHeadingLevel: document.role === 'archive' ? 2 : undefined
          }),
          kind: resolution.kind,
          role: document.role,
          relativePath: document.relativePath
        })
      }
    }
  } catch (error) {
    return {
      schemaVersion: 'GovernanceLedgerValidationReceiptV1',
      activeRoot: root,
      ledgerCount: 0,
      manifestOrigin: 'invalid',
      result: 'FAIL',
      failures: [{ file: path.join(root, 'data', 'governance-ledger-manifest.json'), issues: [error.code || error.message] }],
      receipts: []
    }
  }
  const failures = receipts.filter(receipt => !receipt.valid)
  return {
    schemaVersion: 'GovernanceLedgerValidationReceiptV1',
    activeRoot: root,
    ledgerCount: receipts.length,
    manifestOrigin: loaded.origin,
    manifestDigest: loaded.inspection.manifestDigest,
    result: failures.length ? 'FAIL' : 'PASS',
    failures: failures.map(receipt => ({ file: receipt.file, issues: receipt.issues })),
    receipts
  }
}

if (require.main === module) {
  const activeRoot = process.argv[2]
  if (!activeRoot) {
    process.stderr.write('Usage: node scripts/validate-governance-ledgers.js <active-root>\n')
    process.exitCode = 2
  } else {
    const receipt = validateGovernanceLedgers(activeRoot)
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
    if (receipt.result !== 'PASS') process.exitCode = 1
  }
}

module.exports = { LEDGERS, validateGovernanceLedgers }
