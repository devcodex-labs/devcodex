#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const CHECK_EXTS = new Set(['.js', '.cjs', '.mjs'])
const SKIP_DIRS = new Set(['.git', 'node_modules', 'website/node_modules', 'dist', 'coverage'])

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  const rel = path.relative(ROOT, dir).replace(/\\/g, '/')
  if (SKIP_DIRS.has(rel) || SKIP_DIRS.has(path.basename(dir))) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (CHECK_EXTS.has(path.extname(entry.name))) out.push(full)
  }
  return out
}

const files = walk(ROOT)
const failures = []
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { cwd: ROOT, stdio: 'pipe' })
  } catch (error) {
    failures.push(`${path.relative(ROOT, file)}: ${String(error.stderr || error.message).trim()}`)
  }
}

if (failures.length) {
  console.error('Syntax check failed:')
  failures.forEach(item => console.error(item))
  process.exit(1)
}

console.log(`syntax check passed: ${files.length} files`)
