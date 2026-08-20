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

function forbiddenPlaywrightPaths(paths) {
  return paths
    .map(item => String(item || '').replace(/\\/g, '/').replace(/^\.\//, ''))
    .filter(item => item === '.playwright-cli' || item.startsWith('.playwright-cli/'))
}

const sourceRoot = path.resolve(__dirname, '..')
const rootIgnore = fs.readFileSync(path.join(sourceRoot, '.gitignore'), 'utf8').replace(/\r\n/g, '\n')
assert(rootIgnore.split('\n').includes('/.playwright-cli/'), 'repository root ignore must contain exact /.playwright-cli/ rule')
const ignoreProbe = spawnSync('git', ['check-ignore', '--no-index', '--quiet', '--', '.playwright-cli/contract-probe'], {
  cwd: sourceRoot,
  encoding: 'utf8'
})
assert.strictEqual(ignoreProbe.status, 0, `root ignore probe failed: ${ignoreProbe.stderr || ignoreProbe.stdout}`)
const sourceTracked = git(sourceRoot, ['ls-files', '-z']).split('\0').filter(Boolean)
assert.deepStrictEqual(forbiddenPlaywrightPaths(sourceTracked), [], 'source index contains forbidden .playwright-cli path')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-index-isolation-'))
try {
  git(root, ['init', '--quiet'])
  git(root, ['config', 'user.email', 'test@example.com'])
  git(root, ['config', 'user.name', 'DevCodex Test'])
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'base\n')
  git(root, ['add', 'tracked.txt'])
  git(root, ['commit', '--quiet', '-m', 'base'])

  fs.writeFileSync(path.join(root, '.gitignore'), '/.playwright-cli/\n')
  fs.mkdirSync(path.join(root, '.playwright-cli'), { recursive: true })
  fs.writeFileSync(path.join(root, '.playwright-cli', 'forced.txt'), 'forced path-set fixture\n')
  git(root, ['add', '-f', '--', '.playwright-cli/forced.txt'])
  const forcedTracked = git(root, ['ls-files', '-z']).split('\0').filter(Boolean)
  assert.deepStrictEqual(
    forbiddenPlaywrightPaths(forcedTracked),
    ['.playwright-cli/forced.txt'],
    'forced tracked .playwright-cli fixture must be detected from the path set'
  )
  git(root, ['reset', '--quiet', 'HEAD', '--', '.playwright-cli/forced.txt'])

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
  if (process.env.DEVCODEX_KEEP_TEST_ARTIFACTS === '1') {
    console.log(`kept isolated Git fixture: ${root}`)
  } else {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

console.log('✓ Git index isolation + repository-owned .playwright-cli path-set guards passed')
