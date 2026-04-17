#!/usr/bin/env node
'use strict'
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin.json'), 'utf8'))

if (pkg.version !== plugin.version) {
  console.error(`✗ Version mismatch: package.json (${pkg.version}) ≠ plugin.json (${plugin.version})`)
  process.exit(1)
}
console.log(`✓ Version OK: ${pkg.version}`)
