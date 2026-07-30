#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

function portable (value) {
  return String(value || '').replace(/\\/g, '/')
}

function excludesLegacySource (source) {
  const relative = portable(path.relative(ROOT, source))
  if (!relative) return true
  const segments = relative.split('/')
  const top = segments[0]
  if (['.git', '.devcodex', '.tmp', 'content-source', 'coverage', 'node_modules'].includes(top)) {
    return false
  }
  if (segments.some(segment => ['node_modules', 'coverage', 'dist', 'doc_build'].includes(segment))) {
    return false
  }
  if (relative === 'instructions.md') return false
  if (['instructions', 'prompts', 'skills'].includes(top)) return false
  return true
}

function run (root, command, args) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 128 * 1024 * 1024
  })
}

const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-content-root-isolation-'))
try {
  fs.cpSync(ROOT, isolated, {
    recursive: true,
    filter: excludesLegacySource
  })
  run(isolated, 'git', ['init', '--quiet'])
  run(isolated, 'git', ['config', 'user.email', 'test@example.com'])
  run(isolated, 'git', ['config', 'user.name', 'DevCodex Test'])
  run(isolated, 'git', ['add', '.'])

  assert.strictEqual(fs.existsSync(path.join(isolated, 'content-source')), false)
  assert.strictEqual(fs.existsSync(path.join(isolated, 'instructions.md')), false)
  assert.strictEqual(fs.existsSync(path.join(isolated, 'instructions')), false)
  assert.strictEqual(fs.existsSync(path.join(isolated, 'prompts')), false)
  assert.strictEqual(fs.existsSync(path.join(isolated, 'skills')), false)
  assert.strictEqual(fs.existsSync(path.join(isolated, 'content', 'instructions.md')), true)

  run(isolated, process.execPath, ['scripts/generate-skill-portfolio.js'])
  run(isolated, process.execPath, ['scripts/generate-skill-portfolio.js', '--check'])
  run(isolated, 'npm', ['run', 'test:control-content'])
  run(isolated, 'npm', ['run', 'test:skill-intents'])
  run(isolated, 'npm', ['run', 'test:skill-resolve'])
  run(isolated, 'npm', ['run', 'test:pack-clean'])
  run(isolated, process.execPath, ['scripts/test-host-installation.js'])

  assert.strictEqual(
    fs.existsSync(path.join(isolated, '.tmp', 'package-compatibility-projection.receipt.json')),
    false
  )
  assert.strictEqual(fs.existsSync(path.join(isolated, 'instructions.md')), false)
  assert.strictEqual(fs.existsSync(path.join(isolated, 'instructions')), false)
  assert.strictEqual(fs.existsSync(path.join(isolated, 'prompts')), false)
  assert.strictEqual(fs.existsSync(path.join(isolated, 'skills')), false)
  assert.strictEqual(fs.existsSync(path.join(isolated, 'skills', 'routing', 'SKILL.md')), false)
  assert.strictEqual(fs.existsSync(path.join(isolated, 'skills', 'routing', 'intent.json')), false)
  assert.strictEqual(fs.existsSync(path.join(isolated, 'content', 'skills', 'routing', 'SKILL.md')), true)

  console.log('content root isolation tests passed old-roots=absent pack=materialize+cleanup hosts=5')
} finally {
  fs.rmSync(isolated, { recursive: true, force: true, maxRetries: 10 })
}
