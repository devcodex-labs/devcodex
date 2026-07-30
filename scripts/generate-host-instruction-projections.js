#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { createProjectionBundle } = require('./lib/host-instruction-projection.js')
const { readControlInstructionRoot } = require('./lib/control-content-delivery.js')

const ROOT = path.resolve(__dirname, '..')
const CONFIG_FILE = path.join(ROOT, 'scripts', 'host-instruction-projection.json')
const checkOnly = process.argv.includes('--check')
const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
const source = readControlInstructionRoot(ROOT)
if (source == null) throw new Error(`control instruction source unavailable: ${config.sourceFile}`)
const bundle = createProjectionBundle({ source, config })

if (!bundle.receipt.validation.valid) {
  console.error(`[host-projection] BLOCK ${bundle.receipt.validation.errors.join(' | ')}`)
  process.exit(1)
}

const stale = []
for (const [relative, content] of Object.entries(bundle.files)) {
  const target = path.join(ROOT, relative)
  if (checkOnly) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) stale.push(relative)
    continue
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content, 'utf8')
}

if (stale.length) {
  console.error(`[host-projection] stale generated outputs: ${stale.join(', ')}`)
  process.exit(1)
}

console.log(
  `[host-projection] ${checkOnly ? 'fresh' : 'generated'} ` +
  `coverage=${bundle.receipt.coverage.percentage}% outputs=${Object.keys(bundle.files).length} ` +
  `source=${bundle.receipt.sourceDigest.slice(0, 12)}`
)
