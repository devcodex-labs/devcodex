#!/usr/bin/env node
'use strict'

const path = require('path')
const {
  buildBundle,
  inventory,
  materialize
} = require('./lib/control-content-source')

const ROOT = path.resolve(__dirname, '..')
const flags = new Set(process.argv.slice(2))
const known = new Set(['--check', '--write', '--inventory', '--json'])
for (const flag of flags) {
  if (!known.has(flag)) {
    console.error(`[control-content] unknown option: ${flag}`)
    process.exit(2)
  }
}
const modes = ['--check', '--write', '--inventory'].filter(flag => flags.has(flag))
if (modes.length !== 1) {
  console.error('[control-content] select exactly one of --check, --write, --inventory')
  process.exit(2)
}

try {
  let receipt
  if (flags.has('--inventory')) {
    receipt = inventory(ROOT)
  } else if (flags.has('--write')) {
    receipt = materialize(ROOT)
  } else {
    receipt = buildBundle(ROOT, { mode: 'check', compareDelivery: false }).receipt
  }
  if (flags.has('--json')) {
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
  } else if (flags.has('--inventory')) {
    console.log(`[control-content] inventory entries=${receipt.actual}/${receipt.expected}`)
  } else {
    console.log(
      `[control-content] ${receipt.fresh ? 'fresh' : 'stale'} ` +
      `entries=${receipt.entryCount} fragments=${receipt.fragmentCount} mirrors=${receipt.mirrorCount}`
    )
  }
  if (receipt.fresh === false) {
    console.error(`[control-content] stale outputs: ${receipt.stale.join(', ')}`)
    process.exit(1)
  }
} catch (error) {
  console.error(`[control-content] BLOCK ${error.message}`)
  process.exit(1)
}
