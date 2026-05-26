#!/usr/bin/env node
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')
const { execFileSync, execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SCRIPT = path.join(ROOT, 'scripts', 'instruction-fallback-check.js')

function runCheck(cwd) {
  try {
    execFileSync(process.execPath, [SCRIPT], { cwd, stdio: 'pipe', encoding: 'utf8' })
    return { ok: true, output: '' }
  } catch (error) {
    return {
      ok: false,
      output: String(error.stderr || error.stdout || error.message || '')
    }
  }
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function stageFiles(cwd, files = ['src/app.js']) {
  execSync(`git add ${files.join(' ')}`, { cwd, stdio: 'pipe' })
}

function setupRepo() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-fallback-'))
  execSync('git init', { cwd: tempRoot, stdio: 'pipe' })
  write(path.join(tempRoot, 'src', 'app.js'), 'console.log("hello")\n')
  stageFiles(tempRoot)
  return tempRoot
}

function main() {
  {
    const cwd = setupRepo()
    const req = path.join(cwd, '.devcodex', 'requirements', '已归档旧任务')
    write(path.join(req, '01-需求概述.md'), '# req\n')
    write(path.join(req, '.memory', 'sessions.md'), '| CP1 | ✅ |\n')
    write(path.join(req, '.archived'), '')
    const result = runCheck(cwd)
    assert.strictEqual(result.ok, true, 'archived tasks should be ignored by fallback gate')
  }

  {
    const cwd = setupRepo()
    const req = path.join(cwd, '.devcodex', 'requirements', '活跃未完成任务')
    write(path.join(req, '01-需求概述.md'), '# req\n')
    write(path.join(req, '.memory', 'sessions.md'), '| CP1 | ✅ |\n')
    const result = runCheck(cwd)
    assert.strictEqual(result.ok, false, 'active incomplete task should block fallback gate')
    assert.match(result.output, /CP3 unconfirmed/i)
  }

  {
    const cwd = setupRepo()
    const bug = path.join(cwd, '.devcodex', 'bugs', '活跃Bug任务')
    write(path.join(bug, 'reports', 'claude-code', '20260525', '01--问题确认与CP1.md'), '# cp1\n')
    write(path.join(bug, '.memory', 'sessions.md'), '| CP1 | ✅ |\n')
    const result = runCheck(cwd)
    assert.strictEqual(result.ok, false, 'active bug task should also block fallback gate')
  }

  {
    const cwd = setupRepo()
    write(path.join(cwd, 'package.json'), '{"name":"sample"}\n')
    stageFiles(cwd, ['src/app.js', 'package.json'])
    const bug = path.join(cwd, '.devcodex', 'bugs', '配置变更任务')
    write(path.join(bug, '01-需求概述.md'), '# bug\n')
    write(path.join(bug, '.memory', 'sessions.md'), '| CP1 | ✅ |\n| CP2 | ✅ |\n')
    const result = runCheck(cwd)
    assert.strictEqual(result.ok, false, 'staged package.json should be treated as source/config and block without CP3')
  }

  {
    const cwd = setupRepo()
    const opt = path.join(cwd, '.devcodex', 'optimizations', '性能优化任务')
    write(path.join(opt, '01-需求概述.md'), '# opt\n')
    write(path.join(opt, '.memory', 'sessions.md'), '| CP1 | ✅ |\n| CP2 | ✅ |\n')
    const result = runCheck(cwd)
    assert.strictEqual(result.ok, false, 'active optimization task should block fallback gate')
  }

  {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-fallback-ws-'))
    const cwd = path.join(workspace, 'demo')
    fs.mkdirSync(cwd, { recursive: true })
    write(path.join(workspace, '.devcodex', 'layout.json'), '{"mode":"workspace-namespace"}\n')
    execSync('git init', { cwd, stdio: 'pipe' })
    write(path.join(cwd, 'src', 'app.js'), 'console.log("hello")\n')
    stageFiles(cwd)
    const req = path.join(workspace, '.devcodex', 'demo', 'requirements', '命名空间任务')
    write(path.join(req, '01-需求概述.md'), '# req\n')
    write(path.join(req, '.memory', 'sessions.md'), '| CP1 | ✅ |\n| CP2 | ✅ |\n')
    const result = runCheck(cwd)
    assert.strictEqual(result.ok, false, 'workspace-namespace active task should block fallback gate')
  }

  process.stdout.write('instruction fallback smoke test passed\n')
}

main()
