#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SCRIPT = path.join(ROOT, 'scripts', 'refresh-task-delivery-manifest.js')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-task-manifest-'))
const taskRoot = path.join(tempRoot, 'task')
fs.mkdirSync(path.join(taskRoot, '.memory'), { recursive: true })
fs.writeFileSync(path.join(taskRoot, '05-实施进度.md'), '# 进度\n')
fs.writeFileSync(path.join(taskRoot, '.memory', 'sessions.md'), '| time | event |\n')

function run(args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`command failed ${result.status}\nstdout=${result.stdout}\nstderr=${result.stderr}`)
  }
  return JSON.parse(result.stdout)
}

const first = run(['--task-root', taskRoot, '--json'])
assert.strictEqual(first.ok, true)
assert.strictEqual(first.files, 2)
assert.strictEqual(first.refreshed, true)
const manifest = JSON.parse(fs.readFileSync(path.join(taskRoot, 'delivery-manifest.json'), 'utf8'))
assert.strictEqual(manifest.self.indexed, false)
assert.deepStrictEqual(manifest.entries.map(entry => entry.path).sort(), ['.memory/sessions.md', '05-实施进度.md'])

const clean = run(['--task-root', taskRoot, '--check', '--json'])
assert.strictEqual(clean.ok, true)
assert.strictEqual(clean.stale, false)

fs.appendFileSync(path.join(taskRoot, '05-实施进度.md'), '更新\n')
const stale = spawnSync(process.execPath, [SCRIPT, '--task-root', taskRoot, '--check', '--json'], { encoding: 'utf8' })
assert.notStrictEqual(stale.status, 0)
const staleBody = JSON.parse(stale.stdout)
assert.strictEqual(staleBody.ok, false)
assert(staleBody.errors.includes('manifest-stale'))

const repaired = run(['--task-root', taskRoot, '--json'])
assert.strictEqual(repaired.ok, true)
assert.strictEqual(repaired.refreshed, true)
assert.strictEqual(run(['--task-root', taskRoot, '--check', '--json']).ok, true)
fs.rmSync(tempRoot, { recursive: true, force: true })
console.log('test-task-delivery-manifest PASS')
