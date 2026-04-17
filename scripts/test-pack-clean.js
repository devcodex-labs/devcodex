#!/usr/bin/env node
'use strict'
const { execSync } = require('child_process')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const out = execSync('npm pack --dry-run 2>&1', { cwd: ROOT, encoding: 'utf8' })

const forbidden = [
  /data\/violations\.md/,
  /data\/pending-fixes\.md/,
  /data\/process-improvements\.md/,
  /data\/gap-registry\.md/,
  /schema-dsl/i,
  /vext-test/i,
]

const hits = forbidden.filter(re => re.test(out))
if (hits.length) {
  console.error('\x1b[31m✗ Pack contains forbidden content:\x1b[0m')
  hits.forEach(re => console.error('  ' + re))
  console.error('--- pack output ---')
  console.error(out)
  process.exit(1)
}
console.log('\x1b[32m✓ Pack clean\x1b[0m')
