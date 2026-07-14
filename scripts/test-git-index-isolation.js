#!/usr/bin/env node
'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

function git(cwd, args, env = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  return result.stdout.trim()
}

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-index-isolation-'))
try {
  git(root, ['init', '--quiet'])
  git(root, ['config', 'user.email', 'test@example.com'])
  git(root, ['config', 'user.name', 'DevCodex Test'])
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'base\n')
  git(root, ['add', 'tracked.txt'])
  git(root, ['commit', '--quiet', '-m', 'base'])

  fs.writeFileSync(path.join(root, 'tracked.txt'), 'user staged\n')
  git(root, ['add', 'tracked.txt'])
  const gitDir = git(root, ['rev-parse', '--git-dir'])
  const realIndex = path.resolve(root, gitDir, 'index')
  const beforeDigest = digest(realIndex)
  const beforeStaged = git(root, ['diff', '--cached', '--name-status'])

  fs.writeFileSync(path.join(root, 'candidate.txt'), 'candidate\n')
  const isolatedIndex = path.join(root, '.tmp-candidate-index')
  const env = { GIT_INDEX_FILE: isolatedIndex }
  git(root, ['read-tree', 'HEAD'], env)
  git(root, ['add', '--', 'candidate.txt'], env)
  assert.match(git(root, ['diff', '--cached', '--name-status'], env), /candidate\.txt/)
  git(root, ['diff', '--cached', '--check'], env)

  assert.strictEqual(digest(realIndex), beforeDigest, 'real index digest changed')
  assert.strictEqual(git(root, ['diff', '--cached', '--name-status']), beforeStaged, 'real staged set changed')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

console.log('✓ temporary GIT_INDEX_FILE preserves the user index and staged set')
