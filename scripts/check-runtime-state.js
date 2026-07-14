#!/usr/bin/env node
'use strict'

const path = require('path')
const {
  buildRuntimeStateIndex,
  resolveDefaultActiveRoot,
  writeDerivedIndex
} = require('./lib/runtime-state-index')

const ROOT = path.resolve(__dirname, '..')
const argv = process.argv.slice(2)
const rootIndex = argv.indexOf('--root')
const activeRoot = rootIndex >= 0 ? path.resolve(argv[rootIndex + 1]) : resolveDefaultActiveRoot(ROOT)
const index = buildRuntimeStateIndex(activeRoot)

console.log(`runtime-state: sources=${index.summary.sourceFileCount} records=${index.summary.recordCount} conflicts=${index.summary.conflictCount} alerts=${index.summary.alertCount}`)
for (const alert of index.consistencyAlerts.slice(0, 20)) console.log(`- ${alert.code} ${alert.recordId}: ${alert.message}`)
if (index.consistencyAlerts.length > 20) console.log(`- … ${index.consistencyAlerts.length - 20} additional alerts omitted`)

if (argv.includes('--write-index')) {
  console.log(`wrote: ${writeDerivedIndex(activeRoot, index)}`)
}
if (argv.includes('--strict') && index.consistencyAlerts.length) process.exit(1)
