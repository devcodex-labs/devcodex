#!/usr/bin/env node
'use strict'

const path = require('path')
const {
  buildRuntimeStateIndex,
  loadRuntimeStateIndex,
  resolveDefaultActiveRoot,
  writeDerivedIndex,
  writeRuntimeStateProjection
} = require('./lib/runtime-state-index')

const ROOT = path.resolve(__dirname, '..')
const argv = process.argv.slice(2)
const rootIndex = argv.indexOf('--root')
const activeRoot = rootIndex >= 0 ? path.resolve(argv[rootIndex + 1]) : resolveDefaultActiveRoot(ROOT)
const shouldWrite = argv.includes('--write-index')
const loaded = shouldWrite
  ? { index: buildRuntimeStateIndex(activeRoot), receipt: { route: 'source-scan', freshnessTier: 'content-verified' } }
  : loadRuntimeStateIndex(activeRoot)
const index = loaded.index

console.log(`runtime-state: sources=${index.summary.sourceFileCount} records=${index.summary.recordCount} conflicts=${index.summary.conflictCount} alerts=${index.summary.alertCount}`)
console.log(`runtime-state-source: route=${loaded.receipt.route} freshness=${loaded.receipt.freshnessTier}`)
for (const alert of index.consistencyAlerts.slice(0, 20)) console.log(`- ${alert.code} ${alert.recordId}: ${alert.message}`)
if (index.consistencyAlerts.length > 20) console.log(`- … ${index.consistencyAlerts.length - 20} additional alerts omitted`)

if (shouldWrite) {
  console.log(`wrote: ${writeDerivedIndex(activeRoot, index)}`)
  const projection = writeRuntimeStateProjection(activeRoot, index)
  console.log(`wrote-derived: status=${projection.status} generation=${projection.generation || 'n/a'}`)
  if (!['persisted', 'reused'].includes(projection.status)) process.exitCode = 1
}
if (argv.includes('--strict') && index.consistencyAlerts.length) process.exit(1)
