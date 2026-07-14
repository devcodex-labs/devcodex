#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  CheckedCommandError,
  runChecked,
  runSequenceChecked
} = require('./lib/checked-command')
const { buildPublishArgs, packageScope } = require('./publish-dry-run')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-checked-command-'))
const marker = path.join(root, 'should-not-exist.txt')

function expectFailure(fn, predicate, message) {
  let error = null
  try { fn() } catch (caught) { error = caught }
  assert.ok(error instanceof CheckedCommandError, message)
  assert.ok(predicate(error), `${message}: unexpected evidence ${JSON.stringify(error.evidence)}`)
}

try {
  const success = runChecked(process.execPath, ['-e', 'process.stdout.write("ok")'], { cwd: root })
  assert.strictEqual(success.exitCode, 0)
  assert.strictEqual(success.stdout, 'ok')
  assert.ok(success.durationMs >= 0)

  expectFailure(
    () => runSequenceChecked([
      { command: process.execPath, args: ['-e', 'process.exit(7)'] },
      { command: process.execPath, args: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'bad')`] }
    ], { cwd: root }),
    error => error.evidence.exitCode === 7,
    'sequence must surface the first non-zero exit'
  )
  assert.ok(!fs.existsSync(marker), 'steps after a failure must not execute')

  expectFailure(
    () => runChecked('devcodex-command-that-does-not-exist', [], { cwd: root }),
    error => ['ENOENT', 'EINVAL'].includes(error.evidence.code) || error.evidence.exitCode !== 0,
    'missing executable must fail'
  )

  expectFailure(
    () => runChecked(process.execPath, ['*.js'], { cwd: root }),
    error => error.code === 'ELITERALGLOB',
    'literal positional glob must fail before spawn'
  )

  const legalGlob = runChecked(process.execPath, ['-e', 'process.exit(0)', '--', '--glob', '*.js'], { cwd: root })
  assert.strictEqual(legalGlob.exitCode, 0)

  assert.throws(
    () => runChecked(process.execPath, ['-e', 'process.exit(0)'], { cwd: root, shell: true }),
    /allowShellReason/
  )

  assert.strictEqual(packageScope('@vextjs/devcodex'), '@vextjs')
  assert.strictEqual(packageScope('unscoped-package'), null)
  const npmjsPublishArgs = buildPublishArgs('npmjs')
  const githubPublishArgs = buildPublishArgs('github')
  assert.ok(npmjsPublishArgs.includes('--registry=https://registry.npmjs.org/'))
  assert.ok(npmjsPublishArgs.includes('--@vextjs:registry=https://registry.npmjs.org/'), 'npmjs must override scoped .npmrc routing')
  assert.ok(githubPublishArgs.includes('--registry=https://npm.pkg.github.com/'))
  assert.ok(githubPublishArgs.includes('--@vextjs:registry=https://npm.pkg.github.com/'), 'GitHub Packages target must bind the package scope explicitly')
  assert.throws(() => buildPublishArgs('unknown'), /Unknown registry target/)

  console.log('✓ checked-command fail-fast, literal-glob and scoped registry fixtures passed')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
