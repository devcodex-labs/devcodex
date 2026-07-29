#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const {
  analyzeDuplication,
  inventoryPath,
  serializeInventory,
  validateDispositions
} = require('./lib/control-content-duplication')

const ROOT = path.resolve(__dirname, '..')
const flags = new Set(process.argv.slice(2))
const known = new Set(['--check', '--write-inventory', '--json'])
for (const flag of flags) {
  if (!known.has(flag)) {
    console.error(`[control-content-duplication] unknown option: ${flag}`)
    process.exit(2)
  }
}
if (flags.has('--check') === flags.has('--write-inventory')) {
  console.error('[control-content-duplication] select exactly one of --check or --write-inventory')
  process.exit(2)
}

try {
  const inventory = analyzeDuplication(ROOT)
  const serialized = serializeInventory(inventory)
  const target = inventoryPath(ROOT)
  if (flags.has('--write-inventory')) {
    fs.writeFileSync(target, serialized, 'utf8')
  } else {
    const actual = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null
    if (actual !== serialized) {
      console.error('[control-content-duplication] stale duplication inventory')
      process.exit(1)
    }
  }
  const dispositions = validateDispositions(ROOT, inventory)
  const receipt = {
    schemaVersion: 'ControlContentDuplicationReceiptV1',
    counts: inventory.counts,
    dispositionCount: dispositions.assignments.length,
    valid: dispositions.ok,
    errors: dispositions.errors
  }
  if (flags.has('--json')) process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
  else console.log(
    `[control-content-duplication] ${receipt.valid ? 'valid' : 'BLOCK'} ` +
    `candidates=${inventory.counts.total} dispositions=${receipt.dispositionCount}`
  )
  if (!receipt.valid) {
    for (const error of receipt.errors) console.error(`- ${error}`)
    process.exit(1)
  }
} catch (error) {
  console.error(`[control-content-duplication] BLOCK ${error.message}`)
  process.exit(1)
}
