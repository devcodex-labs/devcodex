#!/usr/bin/env node
'use strict'
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'))
const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin.json'), 'utf8'))
const cursorPlugin = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'cursor', 'plugins', 'devcodex-workspace', '.cursor-plugin', 'plugin.json'),
  'utf8'
))

function walk(dir) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

if (pkg.version !== plugin.version) {
  console.error(`✗ Version mismatch: package.json (${pkg.version}) ≠ plugin.json (${plugin.version})`)
  process.exit(1)
}

if (pkg.version !== cursorPlugin.version) {
  console.error(`✗ Version mismatch: package.json (${pkg.version}) ≠ Cursor plugin (${cursorPlugin.version})`)
  process.exit(1)
}

const rules = fs.readFileSync(path.join(ROOT, 'RULES.md'), 'utf8')
const mismatches = []
if (lock.name !== pkg.name || lock.version !== pkg.version) {
  mismatches.push(`package-lock.json root ${lock.name}@${lock.version} ≠ ${pkg.name}@${pkg.version}`)
}
if (lock.packages?.['']?.name !== pkg.name || lock.packages?.['']?.version !== pkg.version) {
  mismatches.push(`package-lock.json packages[""] ${lock.packages?.['']?.name}@${lock.packages?.['']?.version} ≠ ${pkg.name}@${pkg.version}`)
}
if (!rules.includes(`# DevCodex v${pkg.version}`) || !rules.includes(`version: ${pkg.version}`)) {
  mismatches.push(`RULES.md does not reference version ${pkg.version}`)
}

for (const file of walk(path.join(ROOT, 'content', 'instructions')).filter(item => item.endsWith('.md'))) {
  const content = fs.readFileSync(file, 'utf8')
  const match = content.match(/^version:\s*([^\r\n]+)/m)
  if (match && match[1].trim() !== pkg.version) {
    mismatches.push(`${path.relative(ROOT, file)} version ${match[1].trim()} ≠ ${pkg.version}`)
  }
}

if (mismatches.length) {
  console.error('✗ Version metadata mismatch:')
  for (const mismatch of mismatches) {
    console.error(`  - ${mismatch}`)
  }
  process.exit(1)
}

console.log(`✓ Version OK: ${pkg.version}`)
