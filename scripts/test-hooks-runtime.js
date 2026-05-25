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
const TEST_AGENT = 'claude-code'
const FALLBACK_BOOTSTRAP_AGENT = (() => {
  if (process.env.CLAUDE_CODE_VERSION || process.env.CLAUDE_HOOK_COMMAND) return 'claude-code'
  if (process.env.IDEA_INITIAL_DIRECTORY || process.env.JETBRAINS_IDE) return 'jetbrains-copilot'
  if (process.env.TERM_PROGRAM === 'vscode' || process.env.VSCODE_PID) return 'vscode-copilot'
  return 'copilot'
})()
const WRONG_FALLBACK_AGENT = FALLBACK_BOOTSTRAP_AGENT === 'claude-code' ? 'copilot' : 'claude-code'

function formatDateStamp(date) {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function getTaskStamp(dayOffset) {
  const date = new Date()
  date.setDate(date.getDate() + dayOffset)
  return formatDateStamp(date)
}

function getMemoryFilePath(agent, ...segments) {
  return path.posix.join('.devcodex', '.memory', 'clients', agent, ...segments)
}

function runBootstrapReads(agent = TEST_AGENT) {
  run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: { filePath: '.devcodex/profile/config.json' }
  })
  run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: { filePath: getMemoryFilePath(agent, 'SUMMARY.md') }
  })
  run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: { filePath: getMemoryFilePath(agent, 'tasks', `${getTaskStamp(0)}.md`) }
  })
}

function cleanState(profileConfig = { mode: 'dev', agent: TEST_AGENT }) {
  if (fs.existsSync(TEMP_ROOT)) {
    fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
  }
  // Bootstrap the temp workspace with a dev-mode profile
  fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'profile'), { recursive: true })
  fs.writeFileSync(
    path.join(TEMP_ROOT, '.devcodex', 'profile', 'config.json'),
    JSON.stringify(profileConfig)
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

  const wrongAgentSummary = run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: {
      filePath: getMemoryFilePath('copilot', 'SUMMARY.md')
    }
  })
  assert.strictEqual(wrongAgentSummary.hookSpecificOutput.permissionDecision, 'deny')

  const staleTaskRead = run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: {
      filePath: getMemoryFilePath(TEST_AGENT, 'tasks', `${getTaskStamp(-7)}.md`)
    }
  })
  assert.strictEqual(staleTaskRead.continue, true)

  run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: {
      filePath: getMemoryFilePath(TEST_AGENT, 'SUMMARY.md')
    }
  })

  run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: {
      filePath: getMemoryFilePath(TEST_AGENT, 'tasks', `${getTaskStamp(0)}.md`)
    }
  })

  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(state.bootstrapComplete, true)

  cleanState({ mode: 'dev' })
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'bootstrap missing agent fallback'
  })
  run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: {
      filePath: '.devcodex/profile/config.json'
    }
  })
  const wrongFallbackSummary = run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: {
      filePath: getMemoryFilePath(WRONG_FALLBACK_AGENT, 'SUMMARY.md')
    }
  })
  assert.strictEqual(wrongFallbackSummary.hookSpecificOutput.permissionDecision, 'deny')
  runBootstrapReads(FALLBACK_BOOTSTRAP_AGENT)
  const fallbackState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(fallbackState.bootstrapComplete, true)

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

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Need a root cure for dev mode drift.'
  })
  runBootstrapReads()
  run({
    hookEventName: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Add File: .devcodex/reports/analysis/claude-code/20260525/01--sample.md\n+# report\n*** End Patch'
    }
  })
  run({
    hookEventName: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: `*** Begin Patch\n*** Update File: ${getMemoryFilePath(TEST_AGENT, 'tasks', `${getTaskStamp(0)}.md`)}\n*** End Patch`
    }
  })
  run({
    hookEventName: 'PreCompact',
    assistantMessage: [
      '---',
      '🔍 预检查（DEV 模式）',
      '- PC0 上下文：项目 devcodex-v1',
      '---'
    ].join('\n')
  })
  const missingComplianceAndPathsReminder = run({
    hookEventName: 'Stop',
    assistantMessage: 'Final answer without compliance block or artifact paths.'
  })
  assert.match(missingComplianceAndPathsReminder.systemMessage || '', /合规检查状态块未输出/)
  assert.match(missingComplianceAndPathsReminder.systemMessage || '', /产物路径未输出/)

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Need a root cure for dev mode drift.'
  })
  runBootstrapReads()
  run({
    hookEventName: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Add File: .devcodex/reports/analysis/claude-code/20260525/01--sample.md\n+# report\n*** End Patch'
    }
  })
  run({
    hookEventName: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: `*** Begin Patch\n*** Update File: ${getMemoryFilePath(TEST_AGENT, 'tasks', `${getTaskStamp(0)}.md`)}\n*** End Patch`
    }
  })
  run({
    hookEventName: 'PreCompact',
    assistantMessage: [
      '---',
      '🔍 预检查（DEV 模式）',
      '- PC0 上下文：项目 devcodex-v1',
      '---',
      '---',
      '🛡️ DEV 模式 | 合规检查',
      'FC: FC1 [✅] FC2 [✅] FC3 [✅] FC4 [✅] FC5 [✅] FC6 [✅]',
      'SC: SC1 [✅]',
      '整体：✅ 全通过',
      '',
      '参考文件：',
      '- [01--sample.md](devcodex-v1/.devcodex/reports/analysis/claude-code/20260525/01--sample.md)',
      '  E:\\Worker\\devcodex-v1\\.devcodex\\reports\\analysis\\claude-code\\20260525\\01--sample.md'
    ].join('\n')
  })
  const artifactSectionRequiredReminder = run({
    hookEventName: 'Stop',
    assistantMessage: 'Final answer still missed the artifact section.'
  })
  assert.ok(!/合规检查状态块未输出/.test(artifactSectionRequiredReminder.systemMessage || ''))
  assert.match(artifactSectionRequiredReminder.systemMessage || '', /产物路径未输出/)

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Need a root cure for dev mode drift.'
  })
  runBootstrapReads()
  run({
    hookEventName: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Add File: .devcodex/reports/analysis/claude-code/20260525/01--sample.md\n+# report\n*** End Patch'
    }
  })
  run({
    hookEventName: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: `*** Begin Patch\n*** Update File: ${getMemoryFilePath(TEST_AGENT, 'tasks', `${getTaskStamp(0)}.md`)}\n*** End Patch`
    }
  })
  run({
    hookEventName: 'PreCompact',
    assistantMessage: [
      '---',
      '🔍 预检查（DEV 模式）',
      '- PC0 上下文：项目 devcodex-v1',
      '---',
      '---',
      '🛡️ DEV 模式 | 合规检查',
      'FC: FC1 [✅] FC2 [✅] FC3 [✅] FC4 [✅] FC5 [✅] FC6 [✅]',
      'SC: SC1 [✅]',
      '整体：✅ 全通过',
      '',
      '📂 本次会话产物：',
      '- [01--sample.md](devcodex-v1/.devcodex/reports/analysis/claude-code/20260525/01--sample.md)',
      '  E:\\Worker\\devcodex-v1\\.devcodex\\reports\\analysis\\claude-code\\20260525\\01--sample.md'
    ].join('\n')
  })
  const completeClosureReply = run({
    hookEventName: 'Stop',
    assistantMessage: 'Completed with compliant final reply.'
  })
  assert.ok(!completeClosureReply.systemMessage)

  // Auto v1.1: explicit @devcodex-auto should write executionMode=auto and only allow whitelisted paths.
  cleanState()
  const autoReq = path.join(TEMP_ROOT, '.devcodex', 'requirements', '自动模式需求')
  fs.mkdirSync(path.join(autoReq, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(autoReq, '01-需求概述.md'), '# auto req\n')
  fs.writeFileSync(path.join(autoReq, '.memory', 'sessions.md'), '| CP1 | ✅ |\n')

  run({ hookEventName: 'UserPromptSubmit', prompt: '@devcodex-auto 修复 auto runtime 行为' })
  runBootstrapReads()
  const autoState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(autoState.executionMode, 'auto')

  const autoWhitelistAllowed = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: README.md\n*** End Patch'
    }
  })
  assert.strictEqual(autoWhitelistAllowed.continue, true)
  assert.ok(!autoWhitelistAllowed.hookSpecificOutput)

  const autoNonWhitelistBlocked = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: src/foo.js\n*** End Patch'
    }
  })
  assert.strictEqual(autoNonWhitelistBlocked.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(autoNonWhitelistBlocked.hookSpecificOutput.additionalContext || '', /白名单|whitelist/i)

  const autoDangerousCommand = run({
    hookEventName: 'PreToolUse',
    tool_name: 'run_in_terminal',
    tool_input: {
      command: 'git reset --hard HEAD~1'
    }
  })
  assert.strictEqual(autoDangerousCommand.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(autoDangerousCommand.hookSpecificOutput.permissionDecisionReason || '', /git reset --hard/i)

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Need a root cure for dev mode drift.'
  })
  runBootstrapReads()

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
  // An unfinished requirement should keep blocking global src/ mutations
  // even if another requirement has already entered implementation.
  cleanState()
  const reqIncomplete = path.join(TEMP_ROOT, '.devcodex', 'requirements', '陈旧未完成需求')
  fs.mkdirSync(path.join(reqIncomplete, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(reqIncomplete, '01-需求概述.md'), '# stale\n')
  fs.writeFileSync(path.join(reqIncomplete, '.memory', 'sessions.md'), '| CP1 | ✅ |\n')

  // Bootstrap first so we can test CP gate cleanly
  run({ hookEventName: 'UserPromptSubmit', prompt: 'cross-req test' })
  runBootstrapReads()

  // Without any CP3-done requirement: src/ mutation must be denied (original behavior)
  const blockedNoCp3 = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/foo.js\n*** End Patch' }
  })
  assert.strictEqual(blockedNoCp3.hookSpecificOutput.permissionDecision, 'deny')

  // Add a second requirement that has CP3 confirmed → stale unfinished task must still block
  const reqDone = path.join(TEMP_ROOT, '.devcodex', 'requirements', '当前实施需求')
  fs.mkdirSync(path.join(reqDone, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(reqDone, '01-需求概述.md'), '# done\n')
  fs.writeFileSync(path.join(reqDone, '02-技术方案.md'), '# plan\n')
  fs.writeFileSync(path.join(reqDone, '04-实施计划.md'), '# impl\n')
  fs.writeFileSync(
    path.join(reqDone, '.memory', 'sessions.md'),
    '| CP1 | ✅ |\n| CP2 | ✅ |\n| CP3 | ✅ |\n'
  )

  const blockedCrossReq = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/foo.js\n*** End Patch' }
  })
  assert.strictEqual(blockedCrossReq.hookSpecificOutput.permissionDecision, 'deny',
    'global src/ mutation should stay blocked while a newer unfinished task still lacks CP3')

  // Path-aware test: writing inside reqIncomplete dir while reqDone has CP3
  // should remain allowed because task artifact writes are not source mutations.
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
  runBootstrapReads()
  const allowedAfterCp3Exempt = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/exempt.js\n*** End Patch' }
  })
  assert.strictEqual(allowedAfterCp3Exempt.continue, true)

  // bug task support: unfinished bug task should block source mutation
  cleanState()
  const bugDir = path.join(TEMP_ROOT, '.devcodex', 'bugs', 'MCP全链路收口')
  fs.mkdirSync(path.join(bugDir, '.memory'), { recursive: true })
  fs.mkdirSync(path.join(bugDir, 'reports', 'claude-code', getTaskStamp(0)), { recursive: true })
  fs.writeFileSync(
    path.join(bugDir, 'reports', 'claude-code', getTaskStamp(0), '01--问题确认与CP1.md'),
    '# cp1\n'
  )
  fs.writeFileSync(path.join(bugDir, '.memory', 'sessions.md'), '| CP1 | ✅ |\n')
  run({ hookEventName: 'UserPromptSubmit', prompt: 'bug task gate test' })
  runBootstrapReads()
  const blockedBugTask = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/bug.js\n*** End Patch' }
  })
  assert.strictEqual(blockedBugTask.hookSpecificOutput.permissionDecision, 'deny')

  // bug task with CP2/CP3 complete should allow source mutation
  fs.writeFileSync(
    path.join(bugDir, 'reports', 'claude-code', getTaskStamp(0), '02--技术方案与CP2.md'),
    '# cp2\n'
  )
  fs.writeFileSync(path.join(bugDir, '04-实施计划.md'), '# cp3\n')
  fs.writeFileSync(
    path.join(bugDir, '.memory', 'sessions.md'),
    '| CP1 | ✅ |\n| CP2 | ✅ |\n| CP3 | ✅ |\n'
  )
  const allowedBugTask = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/bug.js\n*** End Patch' }
  })
  assert.strictEqual(allowedBugTask.continue, true)

  // F-008 (v1.9.5): DEVCODEX_PATH_RE 边缘场景测试
  // Bootstrap a fresh workspace
  cleanState()
  run({ hookEventName: 'UserPromptSubmit', prompt: 'F-008 path-regex tests' })
  runBootstrapReads()

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
