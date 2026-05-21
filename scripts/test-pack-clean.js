#!/usr/bin/env node
'use strict'
const { execSync } = require('child_process')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const out = execSync('npm pack --dry-run --json', { cwd: ROOT, encoding: 'utf8' })
const pack = JSON.parse(out)[0] || {}
const files = (pack.files || []).map(file => file.path)

const forbidden = [
  /data\/violations\.md/,
  /data\/pending-fixes\.md/,
  /data\/process-improvements\.md/,
  /data\/gap-registry\.md/,
  /schema-dsl/i,
  /vext-test/i,
]

const required = [
  'instructions.md',
  'plugin.json',
  'hooks/devcodex.lifecycle.json',
  'hooks/_runtime/lifecycle.cjs',
  'assets/icon-512.png',
]

const combined = files.join('\n') + '\n' + (pack.name || '') + '\n' + (pack.filename || '')
const hits = forbidden.filter(re => re.test(combined))
if (hits.length) {
  console.error('\x1b[31m✗ Pack contains forbidden content:\x1b[0m')
  hits.forEach(re => console.error('  ' + re))
  console.error('--- pack files ---')
  console.error(files.join('\n'))
  process.exit(1)
}

const missing = required.filter(file => !files.includes(file))
if (missing.length) {
  console.error('\x1b[31m✗ Pack missing required content:\x1b[0m')
  missing.forEach(file => console.error('  ' + file))
  process.exit(1)
}
console.log('\x1b[32m✓ Pack clean\x1b[0m')
