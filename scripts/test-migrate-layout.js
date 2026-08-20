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
const { inferProjectFromCwd, resolveActiveRuntimeRoot, resolveGitignoreRoot } = require(INDEX)
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
  writeFileIn(TEMP_ROOT, relativePath, content)
}

function writeFileIn(root, relativePath, content) {
  const fullPath = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath, content, 'utf8')
}

function setupNestedFixture(root) {
  writeFileIn(root, 'packages/package.json', '{}')
  writeFileIn(root, 'packages/app-a/.devcodex/profile/config.json', JSON.stringify({ mode: 'dev', agent: 'claude-code' }, null, 2))
  writeFileIn(root, 'packages/app-a/.devcodex/.memory/clients/claude-code/tasks/20260525.md', '# app-a memory\n')
  writeFileIn(root, 'packages/app-b/.devcodex/profile/config.json', JSON.stringify({ mode: 'prod', agent: 'claude-code' }, null, 2))
  writeFileIn(root, 'packages/app-b/.devcodex/bugs/修复问题/01-问题概述.md', '# app-b bug\n')
  writeFileIn(root, 'packages/app-a/package.json', '{}')
  writeFileIn(root, 'packages/app-b/package.json', '{}')
  writeFileIn(root, 'tools/package.json', '{}')
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
  assert.strictEqual(inferProjectFromCwd(path.join(TEMP_ROOT, 'chat')), '')
  assert.strictEqual(resolveActiveRuntimeRoot(path.join(TEMP_ROOT, 'chat')), path.join(TEMP_ROOT, '.devcodex', 'workspace'))
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
  assert.strictEqual(inferProjectFromCwd(path.join(TEMP_ROOT, 'newapp')), '')
  assert.ok(fs.existsSync(path.join(TEMP_ROOT, '.devcodex', 'workspace', 'profile', 'config.json')))
  assert.ok(!fs.existsSync(path.join(TEMP_ROOT, '.devcodex', 'newapp', 'profile', 'config.json')))
  assert.ok(!fs.existsSync(path.join(TEMP_ROOT, 'newapp', '.devcodex', 'profile', 'config.json')))

  const rolledBack = run(['rollback', '--manifest', manifest.manifestPath, '--json'])
  assert.ok(rolledBack.lastRolledBackAt)
  assert.ok(!fs.existsSync(path.join(TEMP_ROOT, '.devcodex', 'layout.json')))
  assert.ok(fs.existsSync(path.join(TEMP_ROOT, 'chat', '.devcodex', 'profile', 'config.json')))
  assert.ok(fs.existsSync(path.join(TEMP_ROOT, 'admin', '.devcodex', 'requirements', '整理命名空间', '01-需求概述.md')))

  const nestedRoot = path.join(TEMP_ROOT, 'nested-workspace')
  fs.mkdirSync(nestedRoot, { recursive: true })
  setupNestedFixture(nestedRoot)

  const nestedManifest = run(['plan', '--json'], nestedRoot)
  assert.deepStrictEqual(nestedManifest.projects.map(project => project.name), ['packages/app-a', 'packages/app-b'])
  assert.ok(!nestedManifest.projects.some(project => project.name === 'tools'))

  const nestedApplied = run(['apply', '--manifest', nestedManifest.manifestPath, '--json'], nestedRoot)
  assert.strictEqual(nestedApplied.lastAppliedBatch, 'all')
  assert.ok(fs.existsSync(path.join(nestedRoot, '.devcodex', 'packages', 'app-a', 'profile', 'config.json')))
  assert.ok(fs.existsSync(path.join(nestedRoot, '.devcodex', 'packages', 'app-b', 'profile', 'config.json')))
  assert.ok(!fs.existsSync(path.join(nestedRoot, 'packages', 'app-a', '.devcodex')))
  assert.ok(!fs.existsSync(path.join(nestedRoot, 'packages', 'app-b', '.devcodex')))

  const nestedRolledBack = run(['rollback', '--manifest', nestedManifest.manifestPath, '--json'], nestedRoot)
  assert.ok(nestedRolledBack.lastRolledBackAt)
  assert.ok(fs.existsSync(path.join(nestedRoot, 'packages', 'app-a', '.devcodex', 'profile', 'config.json')))
  assert.ok(fs.existsSync(path.join(nestedRoot, 'packages', 'app-b', '.devcodex', 'profile', 'config.json')))
}

try {
  main()
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
  process.stdout.write('migrate-layout smoke test passed\n')
} catch (error) {
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
  throw error
}
