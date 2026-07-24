#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const packageRoot = path.resolve(__dirname, '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-global-install-smoke-'))
const packDir = path.join(tmp, 'pack')
const cacheDir = path.join(tmp, 'npm-cache')
const globalHome = path.join(tmp, 'global-home')
const workspaceHome = path.join(tmp, 'workspace-home')
const globalPrefix = path.join(tmp, 'global-prefix')
const workspace = path.join(tmp, 'workspace')
fs.mkdirSync(packDir, { recursive: true })
fs.mkdirSync(cacheDir, { recursive: true })
fs.mkdirSync(globalHome, { recursive: true })
fs.mkdirSync(workspaceHome, { recursive: true })
fs.mkdirSync(globalPrefix, { recursive: true })
fs.mkdirSync(workspace, { recursive: true })

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function runNpm(args, options = {}) {
  const result = spawnSync(npmCommand, args, {
    cwd: options.cwd || packageRoot,
    env: {
      ...process.env,
      npm_config_cache: cacheDir,
      npm_config_update_notifier: 'false',
      npm_config_fund: 'false',
      npm_config_audit: 'false',
      ...options.env
    },
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: options.timeout || 180000
  })
  assert.strictEqual(
    result.status,
    0,
    `npm ${args.join(' ')} failed status=${result.status} signal=${result.signal} error=${result.error?.message || 'none'}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  )
  return result
}

function isolatedHostEnv(home) {
  return {
    DEVCODEX_TEST_HOME: home,
    CODEX_HOME: path.join(home, '.codex'),
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    GEMINI_CLI_HOME: path.join(home, 'gemini-cli-home'),
    GROK_HOME: path.join(home, '.grok'),
    COPILOT_HOME: path.join(home, '.copilot')
  }
}

function receiptPath(home, hostRoot) {
  return path.join(home, hostRoot, 'devcodex', 'global-host-receipt.json')
}

const pack = runNpm(['pack', '--json', '--pack-destination', packDir], { timeout: 180000 })
const packResult = JSON.parse(pack.stdout)
assert.ok(Array.isArray(packResult) && packResult.length === 1)
const tarball = path.join(packDir, packResult[0].filename)
assert.strictEqual(fs.existsSync(tarball), true)

runNpm([
  'install',
  '-g',
  tarball,
  '--prefix',
  globalPrefix,
  '--foreground-scripts'
], {
  env: isolatedHostEnv(globalHome),
  timeout: 240000
})

for (const host of ['.copilot', '.claude', '.codex', path.join('gemini-cli-home', '.gemini'), '.grok']) {
  const file = receiptPath(globalHome, host)
  assert.ok(fs.existsSync(file), `${host} receipt missing after real global install`)
  const receipt = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.strictEqual(receipt.result, 'committed')
  assert.strictEqual(receipt.workspaceHostDirectoriesWritten, false)
  assert.strictEqual(receipt.packageVersion, packageJson.version)
  assert.ok(Array.isArray(receipt.managedPaths), `${host} receipt missing managedPaths`)
}
const binPath = process.platform === 'win32'
  ? path.join(globalPrefix, 'devcodex.cmd')
  : path.join(globalPrefix, 'bin', 'devcodex')
assert.ok(fs.existsSync(binPath), 'global devcodex bin missing')

fs.writeFileSync(path.join(workspace, 'package.json'), `${JSON.stringify({
  name: 'consumer',
  private: true,
  dependencies: {
    [packageJson.name]: `file:${tarball.replace(/\\/g, '/')}`
  }
}, null, 2)}\n`)

runNpm(['install', '--foreground-scripts'], {
  cwd: workspace,
  env: isolatedHostEnv(workspaceHome),
  timeout: 240000
})

for (const host of ['.github', '.claude', '.codex', '.gemini', '.grok']) {
  assert.strictEqual(
    fs.existsSync(path.join(workspace, host)),
    false,
    `${host} must not be written by workspace install`
  )
}
for (const host of ['.copilot', '.claude', '.codex', path.join('gemini-cli-home', '.gemini'), '.grok']) {
  assert.strictEqual(
    fs.existsSync(receiptPath(workspaceHome, host)),
    false,
    `${host} receipt must not be written by workspace install`
  )
}

console.log(`global install smoke passed pack=1 realGlobalInstall=1 workspaceNoHostDirs=1 version=${packageJson.version}`)
