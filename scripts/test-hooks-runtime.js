#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { buildTestHooksRuntimeFixtures } = require('./lib/test-hooks-runtime-fixtures')
const { runHooksRuntimeBootstrapLayoutScenarios } = require('./lib/test-hooks-runtime-bootstrap-layout')
const { runHooksRuntimeVisibilityScenarios } = require('./lib/test-hooks-runtime-visibility')

const ROOT = path.resolve(__dirname, '..')
const RUNTIME = path.join(ROOT, 'hooks', '_runtime', 'lifecycle.cjs')

// Use a temp directory as the workspace root to isolate from real requirements
const TEMP_ROOT = path.join(os.tmpdir(), `devcodex-hooks-test-${process.pid}`)
const STATE_DIR = path.join(TEMP_ROOT, '.devcodex', '.memory', 'hooks', 'legacy')
const STATE_FILE = path.join(STATE_DIR, 'lifecycle-state.json')
const CAPTURE_FLAG = path.join(STATE_DIR, 'capture-final-payload.flag')
const CAPTURE_LOG = path.join(STATE_DIR, 'captured-final-payloads.ndjson')
const INTERCEPTION_LOG = path.join(STATE_DIR, 'interceptions.jsonl')
const TEST_AGENT = 'claude-code'
const FALLBACK_BOOTSTRAP_AGENT = (() => {
  if (process.env.CLAUDE_CODE_VERSION || process.env.CLAUDE_HOOK_COMMAND) return 'claude-code'
  if (process.env.IDEA_INITIAL_DIRECTORY || process.env.JETBRAINS_IDE) return 'jetbrains-copilot'
  if (process.env.TERM_PROGRAM === 'vscode' || process.env.VSCODE_PID) return 'vscode-copilot'
  return 'copilot'
})()
const WRONG_FALLBACK_AGENT = FALLBACK_BOOTSTRAP_AGENT === 'claude-code' ? 'copilot' : 'claude-code'
const {
  getTaskStamp,
  getMemoryFilePath,
  getLayoutStateFile,
  getLayoutCaptureLog,
  getWorkspaceLayoutStateFile,
  runBootstrapReads,
  runLayoutBootstrapReads,
  cleanState,
  cleanLayoutState,
  cleanMultiProjectState,
  cleanLayoutMultiProjectState,
  cleanNestedLayoutMultiProjectState,
  cleanToolingSiblingState,
  run,
  readInterceptionEntries,
  writeTranscript,
  writeTranscriptEntries
} = buildTestHooksRuntimeFixtures({
  fs,
  path,
  process,
  spawnSync,
  RUNTIME,
  TEMP_ROOT,
  TEST_AGENT
})

const runtimeScenarioContext = {
  assert,
  fs,
  path,
  TEMP_ROOT,
  STATE_DIR,
  STATE_FILE,
  CAPTURE_FLAG,
  CAPTURE_LOG,
  TEST_AGENT,
  FALLBACK_BOOTSTRAP_AGENT,
  WRONG_FALLBACK_AGENT,
  getTaskStamp,
  getMemoryFilePath,
  getLayoutStateFile,
  getWorkspaceLayoutStateFile,
  runBootstrapReads,
  runLayoutBootstrapReads,
  cleanState,
  cleanLayoutState,
  cleanMultiProjectState,
  cleanLayoutMultiProjectState,
  cleanNestedLayoutMultiProjectState,
  cleanToolingSiblingState,
  run,
  readInterceptionEntries,
  writeTranscript,
  writeTranscriptEntries
}

function main() {
  runHooksRuntimeBootstrapLayoutScenarios(runtimeScenarioContext)
  runHooksRuntimeVisibilityScenarios(runtimeScenarioContext)

  // Auto v1.1: explicit @devcodex-auto or explicit natural-language auto authorization
  // writes executionMode=auto; in safety-only mode, non-whitelisted paths warn instead
  // of hard-blocking.
  cleanState()
  const autoReq = path.join(TEMP_ROOT, '.devcodex', 'requirements', '自动模式需求')
  fs.mkdirSync(path.join(autoReq, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(autoReq, '01-需求概述.md'), '# auto req\n')
  fs.writeFileSync(path.join(autoReq, '.memory', 'sessions.md'), '| CP1 | ✅ |\n')

  run({ hookEventName: 'UserPromptSubmit', prompt: '@devcodex-auto 修复 auto runtime 行为' })
  runBootstrapReads()
  const autoState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(autoState.executionMode, 'auto')

  cleanState()
  run({ hookEventName: 'UserPromptSubmit', prompt: '进入 auto 模式执行规范吸纳' })
  runBootstrapReads()
  const naturalAutoState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(naturalAutoState.executionMode, 'auto')

  const autoWhitelistAllowed = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: README.md\n*** End Patch'
    }
  })
  assert.strictEqual(autoWhitelistAllowed.continue, true)
  assert.ok(!autoWhitelistAllowed.hookSpecificOutput)

  const autoCodexEntryAllowed = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: AGENTS.md\n*** End Patch'
    }
  })
  assert.strictEqual(autoCodexEntryAllowed.continue, true)
  assert.ok(!autoCodexEntryAllowed.hookSpecificOutput)

  const autoCodexSkillAllowed = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: .agents/skills/compliance/SKILL.md\n*** End Patch'
    }
  })
  assert.strictEqual(autoCodexSkillAllowed.continue, true)
  assert.ok(!autoCodexSkillAllowed.hookSpecificOutput)

  const autoCodexHookAllowed = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: .codex/hooks.json\n*** End Patch'
    }
  })
  assert.strictEqual(autoCodexHookAllowed.continue, true)
  assert.ok(!autoCodexHookAllowed.hookSpecificOutput)

  const autoNonWhitelistWarning = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: src/foo.js\n*** End Patch'
    }
  })
  assert.strictEqual(autoNonWhitelistWarning.continue, true)
  assert.match(autoNonWhitelistWarning.systemMessage || '', /白名单|whitelist/i)

  const autoNonWhitelistBlockedStrict = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: src/foo.js\n*** End Patch'
    }
  }, TEMP_ROOT, { DEVCODEX_HOOK_ENFORCEMENT: 'strict' })
  assert.strictEqual(autoNonWhitelistBlockedStrict.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(autoNonWhitelistBlockedStrict.hookSpecificOutput.additionalContext || '', /白名单|whitelist/i)

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

  // Archive marker bypass test: in safety-only mode, unfinished requirements warn instead of blocking;
  // archived requirements should not even warn.
  const reqDir = path.join(TEMP_ROOT, '.devcodex', 'requirements', '历史归档需求')
  fs.mkdirSync(path.join(reqDir, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(reqDir, '01-需求概述.md'), '# req\n')
  fs.writeFileSync(path.join(reqDir, '.memory', 'sessions.md'), '| CP1 | ✅ |\n')
  const warningByOldReq = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/app.js\n*** End Patch' }
  })
  assert.strictEqual(warningByOldReq.continue, true)
  assert.match(warningByOldReq.systemMessage || '', /CP gate/i)
  const blockedByOldReqStrict = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/app.js\n*** End Patch' }
  }, TEMP_ROOT, { DEVCODEX_HOOK_ENFORCEMENT: 'strict' })
  assert.strictEqual(blockedByOldReqStrict.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(blockedByOldReqStrict.hookSpecificOutput.permissionDecisionReason || '', /CP gate/i)
  fs.writeFileSync(path.join(reqDir, '.archived'), '')
  const allowedAfterArchive = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/app.js\n*** End Patch' }
  })
  assert.strictEqual(allowedAfterArchive.continue, true)
  assert.ok(!allowedAfterArchive.hookSpecificOutput)

  // v1.9.4+ Cross-requirement bypass test:
  // An unfinished requirement should keep warning on global src/ mutations
  // even if another requirement has already entered implementation.
  cleanState()
  const reqIncomplete = path.join(TEMP_ROOT, '.devcodex', 'requirements', '陈旧未完成需求')
  fs.mkdirSync(path.join(reqIncomplete, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(reqIncomplete, '01-需求概述.md'), '# stale\n')
  fs.writeFileSync(path.join(reqIncomplete, '.memory', 'sessions.md'), '| CP1 | ✅ |\n')

  // Bootstrap first so we can test CP gate cleanly
  run({ hookEventName: 'UserPromptSubmit', prompt: 'cross-req test' })
  runBootstrapReads()

  // Without any CP3-done requirement: src/ mutation warns in safety-only mode.
  const warningNoCp3 = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/foo.js\n*** End Patch' }
  })
  assert.strictEqual(warningNoCp3.continue, true)
  assert.match(warningNoCp3.systemMessage || '', /CP gate/i)

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

  const warningCrossReq = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/foo.js\n*** End Patch' }
  })
  assert.strictEqual(warningCrossReq.continue, true,
    'global src/ mutation should warn while a newer unfinished task still lacks CP3')
  assert.match(warningCrossReq.systemMessage || '', /CP gate/i)

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

  // bug task support: unfinished bug task should warn on source mutation until CP2 is complete
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
  const warningBugTask = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/bug.js\n*** End Patch' }
  })
  assert.strictEqual(warningBugTask.continue, true)
  assert.match(warningBugTask.systemMessage || '', /CP gate/i)

  // bug task with CP2 complete but no CP3 should allow source mutation until runtime threshold is hit
  fs.writeFileSync(
    path.join(bugDir, 'reports', 'claude-code', getTaskStamp(0), '02--技术方案与CP2.md'),
    '# cp2\n'
  )
  fs.writeFileSync(
    path.join(bugDir, '.memory', 'sessions.md'),
    '| CP1 | ✅ |\n| CP2 | ✅ |\n'
  )
  for (const fileName of ['bug-1.js', 'bug-2.js', 'bug-3.js', 'bug-4.js']) {
    const allowedBugTask = run({
      hookEventName: 'PreToolUse',
      tool_name: 'apply_patch',
      tool_input: { input: `*** Begin Patch\n*** Update File: src/${fileName}\n*** End Patch` }
    })
    assert.strictEqual(allowedBugTask.continue, true)
    assert.ok(!/CP gate/i.test(allowedBugTask.systemMessage || ''), 'runtime threshold should not warn before the 5th unique source file')
  }

  const bugRuntimeState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  const bugRuntimeRecord = Object.values(bugRuntimeState.cp3Runtime || {}).find(entry => entry && entry.name === 'MCP全链路收口')
  assert.ok(bugRuntimeRecord, 'runtime CP3 tracking record should exist for bug task')
  assert.strictEqual((bugRuntimeRecord.trackedFiles || []).length, 4)

  const warningBugThreshold = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/bug-5.js\n*** End Patch' }
  })
  assert.strictEqual(warningBugThreshold.continue, true)
  assert.match(warningBugThreshold.systemMessage || '', /执行中已触达 5 个源码\/配置文件/)

  const blockedBugThresholdStrict = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/bug-5.js\n*** End Patch' }
  }, TEMP_ROOT, { DEVCODEX_HOOK_ENFORCEMENT: 'strict' })
  assert.strictEqual(blockedBugThresholdStrict.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(blockedBugThresholdStrict.hookSpecificOutput.permissionDecisionReason || '', /CP gate/i)
  assert.ok(readInterceptionEntries().some(entry =>
    entry.code === 'cp-gate-CP3-runtime-threshold' &&
    entry.effective === true
  ))

  // bug task with CP3 complete should allow source mutation again
  fs.writeFileSync(path.join(bugDir, '04-实施计划.md'), '# cp3\n')
  fs.writeFileSync(
    path.join(bugDir, '.memory', 'sessions.md'),
    '| CP1 | ✅ |\n| CP2 | ✅ |\n| CP3 | ✅ |\n'
  )
  const allowedAfterBugCp3 = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/bug-after-cp3.js\n*** End Patch' }
  })
  assert.strictEqual(allowedAfterBugCp3.continue, true)

  // extended task roots: optimizations and scenario-tests must also participate in CP gate.
  cleanState()
  const optimizationDir = path.join(TEMP_ROOT, '.devcodex', 'optimizations', '性能优化任务')
  fs.mkdirSync(path.join(optimizationDir, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(optimizationDir, '01-需求概述.md'), '# optimization\n')
  fs.writeFileSync(path.join(optimizationDir, '.memory', 'sessions.md'), '| CP1 | ✅ |\n| CP2 | ✅ |\n')
  run({ hookEventName: 'UserPromptSubmit', prompt: 'optimization task gate test' })
  runBootstrapReads()
  const warningOptimizationTask = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/perf.js\n*** End Patch' }
  })
  assert.strictEqual(warningOptimizationTask.continue, true)
  assert.match(warningOptimizationTask.systemMessage || '', /CP gate/i)

  cleanState()
  const scenarioDir = path.join(TEMP_ROOT, '.devcodex', 'scenario-tests', '端到端任务')
  fs.mkdirSync(path.join(scenarioDir, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(scenarioDir, '01-需求概述.md'), '# scenario\n')
  fs.writeFileSync(path.join(scenarioDir, '.memory', 'sessions.md'), '| CP1 | ✅ |\n| CP2 | ✅ |\n')
  run({ hookEventName: 'UserPromptSubmit', prompt: 'scenario task gate test' })
  runBootstrapReads()
  const warningScenarioTask = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/e2e.js\n*** End Patch' }
  })
  assert.strictEqual(warningScenarioTask.continue, true)
  assert.match(warningScenarioTask.systemMessage || '', /CP gate/i)

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

  const bashWriteCodexGovernance = run({
    hookEventName: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'echo "# test" > AGENTS.md && echo "# test" > .agents/skills/foo/SKILL.md && echo "{}" > .codex/hooks.json && echo "{}" > codex/hooks.json' }
  })
  assert.strictEqual(bashWriteCodexGovernance.continue, true)

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
