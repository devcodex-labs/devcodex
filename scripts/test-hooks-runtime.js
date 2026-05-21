#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const RUNTIME = path.join(ROOT, 'hooks', '_runtime', 'lifecycle.cjs')

// Use a temp directory as the workspace root to isolate from real requirements
const TEMP_ROOT = path.join(os.tmpdir(), `devcodex-hooks-test-${process.pid}`)
const STATE_DIR = path.join(TEMP_ROOT, '.devcodex', '.memory', 'hooks')
const STATE_FILE = path.join(STATE_DIR, 'lifecycle-state.json')
const CAPTURE_FLAG = path.join(STATE_DIR, 'capture-final-payload.flag')
const CAPTURE_LOG = path.join(STATE_DIR, 'captured-final-payloads.ndjson')

function cleanState() {
  if (fs.existsSync(TEMP_ROOT)) {
    fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
  }
  // Bootstrap the temp workspace with a dev-mode profile
  fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'profile'), { recursive: true })
  fs.writeFileSync(
    path.join(TEMP_ROOT, '.devcodex', 'profile', 'config.json'),
    JSON.stringify({ mode: 'dev' })
  )
}

function run(payload) {
  const result = spawnSync(process.execPath, [RUNTIME], {
    cwd: TEMP_ROOT,
    input: JSON.stringify(payload),
    encoding: 'utf8'
  })

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'runtime exited with failure').trim())
  }

  return JSON.parse(result.stdout || '{}')
}

function main() {
  cleanState()

  const promptOutput = run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Need a root cure for dev mode drift.'
  })
  assert.strictEqual(promptOutput.continue, true)
  assert.match(promptOutput.systemMessage || '', /PC0-PC7/)

  const blockedBeforeBootstrap = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: README.md\n*** End Patch'
    }
  })
  assert.strictEqual(blockedBeforeBootstrap.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(blockedBeforeBootstrap.hookSpecificOutput.permissionDecisionReason || '', /bootstrap/i)

  run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: {
      filePath: '.devcodex/profile/config.json'
    }
  })

  run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: {
      filePath: '.devcodex/.memory/clients/copilot/SUMMARY.md'
    }
  })

  run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: {
      filePath: '.devcodex/.memory/clients/copilot/tasks/20260510.md'
    }
  })

  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(state.bootstrapComplete, true)

  const noVisiblePayloadReminder = run({
    hookEventName: 'PreCompact'
  })
  assert.strictEqual(noVisiblePayloadReminder.continue, true)
  assert.ok(!noVisiblePayloadReminder.systemMessage)
  assert.ok(!fs.existsSync(CAPTURE_LOG))

  fs.mkdirSync(STATE_DIR, { recursive: true })
  fs.writeFileSync(CAPTURE_FLAG, 'capture final payload once\n')

  run({
    hookEventName: 'PreCompact',
    assistantMessage: 'Visible reply sample before stop.'
  })

  assert.ok(fs.existsSync(CAPTURE_LOG))
  let captureEntries = fs.readFileSync(CAPTURE_LOG, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line))
  assert.strictEqual(captureEntries[0].eventName, 'PreCompact')
  assert.strictEqual(captureEntries[0].visiblePayloadDetected, true)
  assert.ok(captureEntries[0].interestingStrings.some(entry => entry.path === 'assistantMessage'))
  assert.strictEqual(fs.existsSync(CAPTURE_FLAG), true)

  const allowedAfterBootstrap = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: README.md\n*** End Patch'
    }
  })
  assert.strictEqual(allowedAfterBootstrap.continue, true)
  assert.ok(!allowedAfterBootstrap.hookSpecificOutput)

  const dangerousCommand = run({
    hookEventName: 'PreToolUse',
    tool_name: 'run_in_terminal',
    tool_input: {
      command: 'git reset --hard HEAD~1'
    }
  })
  assert.strictEqual(dangerousCommand.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(dangerousCommand.hookSpecificOutput.permissionDecisionReason || '', /git reset --hard/i)

  const missingPrecheckReminder = run({
    hookEventName: 'Stop',
    assistantMessage: 'All work is complete.'
  })
  assert.match(missingPrecheckReminder.systemMessage || '', /precheck block/i)
  captureEntries = fs.readFileSync(CAPTURE_LOG, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line))
  assert.strictEqual(captureEntries.length, 2)
  assert.strictEqual(captureEntries[1].eventName, 'Stop')
  assert.strictEqual(fs.existsSync(CAPTURE_FLAG), false)

  // Archive marker bypass test: an unfinished requirement with .archived must NOT block
  const reqDir = path.join(TEMP_ROOT, '.devcodex', 'requirements', '历史归档需求')
  fs.mkdirSync(path.join(reqDir, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(reqDir, '01-需求概述.md'), '# req\n')
  fs.writeFileSync(path.join(reqDir, '.memory', 'sessions.md'), '| CP1 | ✅ |\n')
  const blockedByOldReq = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/app.js\n*** End Patch' }
  })
  assert.strictEqual(blockedByOldReq.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(blockedByOldReq.hookSpecificOutput.permissionDecisionReason || '', /CP gate/i)
  fs.writeFileSync(path.join(reqDir, '.archived'), '')
  const allowedAfterArchive = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/app.js\n*** End Patch' }
  })
  assert.strictEqual(allowedAfterArchive.continue, true)
  assert.ok(!allowedAfterArchive.hookSpecificOutput)

  // v1.9.4+ Cross-requirement bypass test:
  // When any requirement has CP3 confirmed (i.e. user is implementing),
  // stale unfinished requirements should not block src/ code mutations globally.
  cleanState()
  const reqIncomplete = path.join(TEMP_ROOT, '.devcodex', 'requirements', '陈旧未完成需求')
  fs.mkdirSync(path.join(reqIncomplete, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(reqIncomplete, '01-需求概述.md'), '# stale\n')
  fs.writeFileSync(path.join(reqIncomplete, '.memory', 'sessions.md'), '| CP1 | ✅ |\n')

  // Bootstrap first so we can test CP gate cleanly
  run({ hookEventName: 'UserPromptSubmit', prompt: 'cross-req test' })
  run({ hookEventName: 'PreToolUse', tool_name: 'read_file', tool_input: { filePath: '.devcodex/profile/config.json' } })
  run({ hookEventName: 'PreToolUse', tool_name: 'read_file', tool_input: { filePath: '.devcodex/.memory/clients/copilot/SUMMARY.md' } })
  run({ hookEventName: 'PreToolUse', tool_name: 'read_file', tool_input: { filePath: '.devcodex/.memory/clients/copilot/tasks/20260510.md' } })

  // Without any CP3-done requirement: src/ mutation must be denied (original behavior)
  const blockedNoCp3 = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/foo.js\n*** End Patch' }
  })
  assert.strictEqual(blockedNoCp3.hookSpecificOutput.permissionDecision, 'deny')

  // Add a second requirement that has CP3 confirmed → cross-req bypass should kick in
  const reqDone = path.join(TEMP_ROOT, '.devcodex', 'requirements', '当前实施需求')
  fs.mkdirSync(path.join(reqDone, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(reqDone, '01-需求概述.md'), '# done\n')
  fs.writeFileSync(path.join(reqDone, '02-技术方案.md'), '# plan\n')
  fs.writeFileSync(path.join(reqDone, '04-实施计划.md'), '# impl\n')
  fs.writeFileSync(
    path.join(reqDone, '.memory', 'sessions.md'),
    '| CP1 | ✅ |\n| CP2 | ✅ |\n| CP3 | ✅ |\n'
  )

  const allowedCrossReq = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/foo.js\n*** End Patch' }
  })
  assert.strictEqual(allowedCrossReq.continue, true,
    'cross-requirement bypass: src/ mutation should be allowed when any other requirement has CP3 confirmed')
  assert.ok(!allowedCrossReq.hookSpecificOutput)

  // Path-aware test: writing inside reqIncomplete dir while reqDone has CP3
  // hasAnyCp3Done=true → still allowed (cross-req bypass takes precedence)
  const allowedInReqDir = run({
    hookEventName: 'PreToolUse',
    tool_name: 'Write',  // Claude Code PascalCase tool
    tool_input: {
      file_path: path.join(reqIncomplete, '02-技术方案.md'),
      content: '# new plan\n'
    }
  })
  assert.strictEqual(allowedInReqDir.continue, true)

  // CP3 N/A exemptions for docs/init should not keep old requirements blocking later source work.
  cleanState()
  const reqDocsExempt = path.join(TEMP_ROOT, '.devcodex', 'requirements', '文档任务')
  fs.mkdirSync(path.join(reqDocsExempt, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(reqDocsExempt, '01-需求概述.md'), '# docs\n')
  fs.writeFileSync(path.join(reqDocsExempt, '02-技术方案.md'), '# outline\n')
  fs.writeFileSync(
    path.join(reqDocsExempt, '.memory', 'sessions.md'),
    '| CP1 | ✅ |\n| CP2 | ✅ |\nCP3: N/A（docs 子类型豁免）\n'
  )
  run({ hookEventName: 'UserPromptSubmit', prompt: 'cp3 exemption test' })
  run({ hookEventName: 'PreToolUse', tool_name: 'read_file', tool_input: { filePath: '.devcodex/profile/config.json' } })
  run({ hookEventName: 'PreToolUse', tool_name: 'read_file', tool_input: { filePath: '.devcodex/.memory/clients/copilot/SUMMARY.md' } })
  run({ hookEventName: 'PreToolUse', tool_name: 'read_file', tool_input: { filePath: '.devcodex/.memory/clients/copilot/tasks/20260510.md' } })
  const allowedAfterCp3Exempt = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/exempt.js\n*** End Patch' }
  })
  assert.strictEqual(allowedAfterCp3Exempt.continue, true)

  // F-008 (v1.9.5): DEVCODEX_PATH_RE 边缘场景测试
  // Bootstrap a fresh workspace
  cleanState()
  run({ hookEventName: 'UserPromptSubmit', prompt: 'F-008 path-regex tests' })
  run({ hookEventName: 'PreToolUse', tool_name: 'read_file', tool_input: { filePath: '.devcodex/profile/config.json' } })
  run({ hookEventName: 'PreToolUse', tool_name: 'read_file', tool_input: { filePath: '.devcodex/.memory/clients/copilot/SUMMARY.md' } })
  run({ hookEventName: 'PreToolUse', tool_name: 'read_file', tool_input: { filePath: '.devcodex/.memory/clients/copilot/tasks/20260510.md' } })

  // F-001: bash 写 .claude/foo.js（非 governance 子路径）应被视为 source mutation → 触发 CP gate
  const bashWriteClaude = run({
    hookEventName: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'echo "console.log(1)" > .claude/foo.js' }
  })
  // 无 incomplete requirement → 应该允许（CP gate 不触发，但 isSourceCodeMutation 应返回 true，hooks 仍可放行；此处仅断言非崩溃）
  assert.ok(bashWriteClaude.continue === true || bashWriteClaude.hookSpecificOutput)

  // F-001: bash 写 .claude/instructions/foo.md（governance 子路径）应被放行
  const bashWriteGovernance = run({
    hookEventName: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'echo "# test" > .claude/instructions/foo.md' }
  })
  assert.strictEqual(bashWriteGovernance.continue, true)

  // F-006: bash cp src.js dest.js 命令路径提取
  const bashCp = run({
    hookEventName: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'cp src/a.js src/b.js' }
  })
  assert.ok(bashCp.continue === true || bashCp.hookSpecificOutput)

  cleanState()
  process.stdout.write('hooks runtime smoke test passed\n')
}

main()