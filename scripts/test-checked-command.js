#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  CheckedCommandError,
  resolveExecutableOnPath,
  resolveNpmInvocation,
  resolveWindowsBatchInvocation,
  runChecked,
  runSequenceChecked
} = require('./lib/checked-command')
const {
  assertTargetSupported,
  allowsExistingVersion,
  buildPublishArgs,
  isPublishedVersionCollision,
  packageScope,
  parsePackJson,
  runPublishDryRun,
  supportedTargets
} = require('./publish-dry-run')

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

  for (const expression of ['[1,2]', '["alpha","beta"]', '[unclosed']) {
    const legalExpression = runChecked(process.execPath, ['-e', 'process.exit(0)', '--', expression], { cwd: root })
    assert.strictEqual(legalExpression.exitCode, 0, `${expression} must not be treated as a path glob`)
  }
  for (const pathGlob of ['src/[ab].js', 'src/[!a].js', 'src\\[a-z].cjs']) {
    expectFailure(
      () => runChecked(process.execPath, [pathGlob], { cwd: root }),
      error => error.code === 'ELITERALGLOB',
      `bracket path glob ${pathGlob} must fail before spawn`
    )
  }

  assert.throws(
    () => runChecked(process.execPath, ['-e', 'process.exit(0)'], { cwd: root, shell: true }),
    /allowShellReason/
  )

  if (process.platform === 'win32') {
    const fakeBin = path.join(root, 'fake-bin')
    fs.mkdirSync(fakeBin, { recursive: true })
    const fakeNpmCmd = path.join(fakeBin, 'npm.cmd')
    const fakeNpmExe = path.join(fakeBin, 'npm.exe')
    fs.writeFileSync(fakeNpmCmd, [
      '@echo off',
      'setlocal DisableDelayedExpansion',
      '<nul set /p "=%~1|%~2|%~3"',
      'exit /b 0',
      ''
    ].join('\r\n'))
    fs.writeFileSync(fakeNpmExe, '')
    assert.strictEqual(
      resolveExecutableOnPath('npm.exe', { PATH: fakeBin }),
      fakeNpmExe
    )
    const preferredInvocation = resolveNpmInvocation('npm', ['--version'], {
      PATH: fakeBin,
      npm_execpath: ''
    })
    assert.ok(
      preferredInvocation.command === fakeNpmExe ||
      (preferredInvocation.command === process.execPath && /npm-cli\.js$/i.test(preferredInvocation.args[0])),
      'npm resolver must prefer a directly executable npm implementation'
    )

    fs.rmSync(fakeNpmExe, { force: true })
    assert.throws(() => resolveWindowsBatchInvocation(fakeNpmCmd, [
      '%DEVCODEX_CMD_EXPAND%',
      '!DEVCODEX_CMD_EXPAND!',
      '& whoami'
    ], {
      ComSpec: process.env.ComSpec || process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe'
    }), error => error instanceof CheckedCommandError && error.code === 'EWINDOWSBATCHARGV')
    const batchInvocation = resolveWindowsBatchInvocation(fakeNpmCmd, ['run', 'test:full'], {
      ComSpec: process.env.ComSpec || process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe'
    })
    assert.strictEqual(path.resolve(batchInvocation.command), path.resolve(process.env.ComSpec || process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe'))
    assert.deepStrictEqual(batchInvocation.args.slice(0, 4), ['/d', '/v:off', '/s', '/c'])
    const batchProbe = require('child_process').spawnSync(batchInvocation.command, batchInvocation.args, {
      cwd: root,
      env: { ...process.env, DEVCODEX_CMD_EXPAND: 'EXPANDED' },
      encoding: 'utf8',
      windowsHide: true
    })
    assert.strictEqual(
      batchProbe.status,
      0,
      `${batchProbe.stderr || batchProbe.stdout}\n${JSON.stringify(batchInvocation)}`
    )
    assert.strictEqual(batchProbe.stdout, 'run|test:full|')
  }

  // package is unscoped `devcodex` (org owns GitHub repo; npm module is not scoped)
  assert.strictEqual(packageScope('devcodex'), null)
  assert.strictEqual(packageScope('@devcodex/devcodex'), '@devcodex')
  assert.strictEqual(packageScope('unscoped-package'), null)
  assert.deepStrictEqual(supportedTargets('devcodex'), ['npmjs'])
  assert.deepStrictEqual(supportedTargets('@devcodex/devcodex'), ['npmjs', 'github'])
  assert.throws(
    () => assertTargetSupported('github', 'devcodex'),
    error => error?.code === 'REGISTRY_TARGET_UNSUPPORTED' && /scoped npm package/.test(error.message)
  )
  const candidateTarball = path.join(root, 'devcodex-1.16.4.tgz')
  const npmjsPublishArgs = buildPublishArgs('npmjs', 'devcodex', candidateTarball)
  const githubPublishArgs = buildPublishArgs('github', '@devcodex/devcodex', candidateTarball)
  assert.ok(npmjsPublishArgs.includes('--registry=https://registry.npmjs.org/'))
  assert.strictEqual(npmjsPublishArgs[1], candidateTarball)
  assert.ok(!npmjsPublishArgs.includes('--ignore-scripts'))
  assert.ok(!npmjsPublishArgs.some((a) => a.startsWith('--@') && a.includes(':registry=')), 'unscoped package must not emit scope registry override')
  assert.ok(githubPublishArgs.includes('--registry=https://npm.pkg.github.com/'))
  assert.ok(githubPublishArgs.includes('--@devcodex:registry=https://npm.pkg.github.com/'))
  const scopedNpmjs = buildPublishArgs('npmjs', '@devcodex/devcodex', candidateTarball)
  assert.ok(scopedNpmjs.includes('--@devcodex:registry=https://registry.npmjs.org/'))
  assert.throws(() => buildPublishArgs('unknown'), /Unknown registry target/)
  assert.deepStrictEqual(
    parsePackJson('npm notice ignored\n[{"filename":"devcodex-1.16.4.tgz"}]\n'),
    { filename: 'devcodex-1.16.4.tgz' }
  )
  assert.strictEqual(allowsExistingVersion(['--registry', 'all']), false)
  assert.strictEqual(allowsExistingVersion(['--allow-existing-version']), true)

  const publishedVersion = '1.19.3'
  const collisionEvidence = {
    code: 'ECOMMAND',
    command: 'npm',
    resolvedCommand: 'npm',
    args: [
      'publish',
      candidateTarball,
      '--dry-run',
      '--json',
      '--registry=https://registry.npmjs.org/',
      '--access=public'
    ],
    cwd: root,
    exitCode: 1,
    signal: null,
    durationMs: 12,
    stdout: '',
    stderr: [
      'npm warn This command requires you to be logged in to https://registry.npmjs.org/ (dry-run)',
      `npm error You cannot publish over the previously published versions: ${publishedVersion}.`,
      'npm error A complete log of this run can be found in: /tmp/npm-debug.log'
    ].join('\n')
  }
  const collisionError = new CheckedCommandError('published version collision', collisionEvidence)
  assert.strictEqual(isPublishedVersionCollision(collisionError, publishedVersion), true)
  const acceptedCollision = runPublishDryRun(
    'npmjs',
    'devcodex',
    publishedVersion,
    candidateTarball,
    {
      cwd: root,
      allowExistingVersion: true,
      run: () => { throw collisionError }
    }
  )
  assert.strictEqual(acceptedCollision.acceptedFailure, 'PUBLISHED_VERSION_EXISTS')
  assert.strictEqual(acceptedCollision.exitCode, 1)
  assert.throws(
    () => runPublishDryRun('npmjs', 'devcodex', publishedVersion, candidateTarball, {
      cwd: root,
      allowExistingVersion: false,
      run: () => { throw collisionError }
    }),
    error => error === collisionError
  )
  const unrelatedFailure = new CheckedCommandError('authentication failed', {
    ...collisionEvidence,
    stderr: 'npm error code ENEEDAUTH\nnpm error need auth This command requires you to be logged in.'
  })
  assert.strictEqual(isPublishedVersionCollision(unrelatedFailure, publishedVersion), false)
  assert.throws(
    () => runPublishDryRun('npmjs', 'devcodex', publishedVersion, candidateTarball, {
      cwd: root,
      allowExistingVersion: true,
      run: () => { throw unrelatedFailure }
    }),
    error => error === unrelatedFailure
  )
  assert.strictEqual(isPublishedVersionCollision(collisionError, '1.19.4'), false)

  console.log('✓ checked-command fail-fast, literal-glob and registry fixtures passed')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
