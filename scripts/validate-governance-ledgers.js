#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { inspectGovernanceLedgerFile } = require('../hooks/_runtime/governance-ledger-integrity.cjs')

const LEDGERS = Object.freeze([
  ['process-improvements.md', 'PI-'],
  ['pending-fixes.md', 'PF-'],
  ['violations.md', 'VL-'],
  ['gap-registry.md', 'GR-'],
  ['pending-issues.md', 'ISSUE-']
])

function validateGovernanceLedgers (activeRoot) {
  const root = path.resolve(activeRoot)
  const dataRoot = path.join(root, 'data')
  const receipts = []
  for (const [name, prefix] of LEDGERS) {
    const file = path.join(dataRoot, name)
    if (!fs.existsSync(file)) continue
    receipts.push(inspectGovernanceLedgerFile(file, { expectedPrefix: prefix }))
  }
  const failures = receipts.filter(receipt => !receipt.valid)
  return {
    schemaVersion: 'GovernanceLedgerValidationReceiptV1',
    activeRoot: root,
    ledgerCount: receipts.length,
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
