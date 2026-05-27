#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const CLI = path.join(ROOT, 'scripts', 'migrate-layout.js')
const INDEX = path.join(ROOT, 'index.js')
const { resolveActiveRuntimeRoot, resolveGitignoreRoot } = require(INDEX)
const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-layout-migrate-'))

function run(args, cwd = TEMP_ROOT) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8'
  })
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'migrate-layout failed').trim())
  }
  return JSON.parse(result.stdout)
}

function writeFile(relativePath, content) {
  const fullPath = path.join(TEMP_ROOT, relativePath)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath, content, 'utf8')
}

function setupFixture() {
  writeFile('chat/.devcodex/profile/config.json', JSON.stringify({ mode: 'dev', agent: 'claude-code' }, null, 2))
  writeFile('chat/.devcodex/.memory/clients/claude-code/tasks/20260525.md', '# chat memory\n')
  writeFile('admin/.devcodex/requirements/整理命名空间/01-需求概述.md', '# admin requirement\n')
  writeFile('.devcodex/.memory/SUMMARY.md', '# workspace summary\n')
  writeFile('.devcodex/reports/analysis/claude-code/20260525/01--smoke.md', '# report\n')
}

function main() {
  setupFixture()

  const manifest = run(['plan', '--json'])
  assert.strictEqual(manifest.projects.length, 2)
  assert.strictEqual(manifest.workspaceEntries.length, 2)
  assert.ok(fs.existsSync(manifest.manifestPath))

  const applied = run(['apply', '--manifest', manifest.manifestPath, '--json'])
  assert.strictEqual(applied.lastAppliedBatch, 'all')
  assert.ok(fs.existsSync(path.join(TEMP_ROOT, '.devcodex', 'layout.json')))
  assert.ok(fs.existsSync(path.join(TEMP_ROOT, '.devcodex', 'chat', 'profile', 'config.json')))
  assert.ok(fs.existsSync(path.join(TEMP_ROOT, '.devcodex', 'workspace', '.memory', 'SUMMARY.md')))
  assert.ok(!fs.existsSync(path.join(TEMP_ROOT, 'chat', '.devcodex')))
  assert.ok(!fs.existsSync(path.join(TEMP_ROOT, 'admin', '.devcodex')))
  assert.strictEqual(resolveActiveRuntimeRoot(path.join(TEMP_ROOT, 'chat')), path.join(TEMP_ROOT, '.devcodex', 'chat'))
  assert.strictEqual(resolveActiveRuntimeRoot(TEMP_ROOT), path.join(TEMP_ROOT, '.devcodex', 'workspace'))
  assert.strictEqual(resolveGitignoreRoot(path.join(TEMP_ROOT, 'chat')), TEMP_ROOT)

  fs.mkdirSync(path.join(TEMP_ROOT, 'newapp'), { recursive: true })
  const profileInit = spawnSync(process.execPath, [INDEX, 'profile', 'init', '--force'], {
    cwd: path.join(TEMP_ROOT, 'newapp'),
    encoding: 'utf8'
  })
  if (profileInit.status !== 0) {
    throw new Error((profileInit.stderr || profileInit.stdout || 'profile init failed').trim())
  }
  assert.ok(fs.existsSync(path.join(TEMP_ROOT, '.devcodex', 'newapp', 'profile', 'config.json')))
  assert.ok(!fs.existsSync(path.join(TEMP_ROOT, 'newapp', '.devcodex', 'profile', 'config.json')))

  const rolledBack = run(['rollback', '--manifest', manifest.manifestPath, '--json'])
  assert.ok(rolledBack.lastRolledBackAt)
  assert.ok(!fs.existsSync(path.join(TEMP_ROOT, '.devcodex', 'layout.json')))
  assert.ok(fs.existsSync(path.join(TEMP_ROOT, 'chat', '.devcodex', 'profile', 'config.json')))
  assert.ok(fs.existsSync(path.join(TEMP_ROOT, 'admin', '.devcodex', 'requirements', '整理命名空间', '01-需求概述.md')))
}

try {
  main()
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
  process.stdout.write('migrate-layout smoke test passed\n')
} catch (error) {
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
  throw error
}
