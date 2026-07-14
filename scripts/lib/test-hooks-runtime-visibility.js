'use strict'

function runHooksRuntimeVisibilityScenarios(context) {
  const {
    assert,
    fs,
    TEMP_ROOT,
    STATE_DIR,
    STATE_FILE,
    CAPTURE_FLAG,
    CAPTURE_LOG,
    TEST_AGENT,
    getTaskStamp,
    getMemoryFilePath,
    runBootstrapReads,
    cleanState,
    run: runHook,
    readInterceptionEntries,
    writeTranscript,
    writeTranscriptEntries
  } = context

  function run(payload, ...args) {
    const output = runHook(payload, ...args)
    if (payload?.hookEventName === 'UserPromptSubmit' && fs.existsSync(STATE_FILE)) {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
      state.governanceIntake = {
        ...(state.governanceIntake || {}),
        version: 2,
        candidates: [],
        activeCandidateId: '',
        governanceIntakeCandidate: false,
        pending: false,
        handled: false,
        lastDecisionError: ''
      }
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
    }
    return output
  }

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'resume legacy validation chain'
  })
  runBootstrapReads(TEST_AGENT)

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

  const searchDangerousText = run({
    hookEventName: 'PreToolUse',
    tool_name: 'run_in_terminal',
    tool_input: {
      command: 'rg -n "rm -rf|DROP TABLE|DELETE FROM" docs/example.md'
    }
  })
  assert.strictEqual(searchDangerousText.continue, true)
  assert.ok(!searchDangerousText.hookSpecificOutput)

  const deleteWithoutWhere = run({
    hookEventName: 'PreToolUse',
    tool_name: 'run_in_terminal',
    tool_input: {
      command: 'node -e "db.exec(`DELETE FROM users`)"'
    }
  })
  assert.strictEqual(deleteWithoutWhere.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(deleteWithoutWhere.hookSpecificOutput.permissionDecisionReason || '', /DELETE FROM/i)

  const deleteWithWhere = run({
    hookEventName: 'PreToolUse',
    tool_name: 'run_in_terminal',
    tool_input: {
      command: 'node -e "db.exec(`DELETE FROM users WHERE id=1`)"'
    }
  })
  assert.strictEqual(deleteWithWhere.continue, true)
  assert.ok(!deleteWithWhere.hookSpecificOutput)

  const dangerousApprovalId = String(
    dangerousCommand.hookSpecificOutput.additionalContext || ''
  ).match(/devcodex-approve:([a-f0-9]{12})/)?.[1]
  assert.ok(dangerousApprovalId, 'dangerous command should return one-time approval id')

  const unconfirmedDangerousCommand = run({
    hookEventName: 'PreToolUse',
    tool_name: 'run_in_terminal',
    tool_input: {
      command: `git reset --hard HEAD~1 # devcodex-approve:${dangerousApprovalId}`
    }
  })
  assert.strictEqual(unconfirmedDangerousCommand.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(unconfirmedDangerousCommand.hookSpecificOutput.permissionDecisionReason || '', /git reset --hard/i)

  run({
    hookEventName: 'UserPromptSubmit',
    prompt: `确认执行 devcodex-approve:${dangerousApprovalId}`
  })
  runBootstrapReads()
  const approvedDangerousCommand = run({
    hookEventName: 'PreToolUse',
    tool_name: 'run_in_terminal',
    tool_input: {
      command: `git reset --hard HEAD~1 # devcodex-approve:${dangerousApprovalId}`
    }
  })
  assert.strictEqual(approvedDangerousCommand.continue, true)
  assert.ok(!approvedDangerousCommand.hookSpecificOutput)
  const reusedDangerousCommand = run({
    hookEventName: 'PreToolUse',
    tool_name: 'run_in_terminal',
    tool_input: {
      command: `git reset --hard HEAD~1 # devcodex-approve:${dangerousApprovalId}`
    }
  })
  assert.strictEqual(reusedDangerousCommand.hookSpecificOutput.permissionDecision, 'deny')
  const interceptionEntries = readInterceptionEntries()
  assert.ok(interceptionEntries.some(entry => entry.code === 'dangerous-command' && entry.action === 'forbid' && entry.effective === true))
  assert.ok(interceptionEntries.some(entry => entry.code === 'dangerous-command-confirmed' && entry.action === 'log_only'))
  assert.ok(interceptionEntries.some(entry => entry.code === 'dangerous-command-approved' && entry.action === 'log_only'))

  const missingPrecheckReminder = run({
    hookEventName: 'Stop',
    assistantMessage: 'All work is complete.'
  })
  assert.match(missingPrecheckReminder.systemMessage || '', /entry check block/i)
  const duplicateMissingPrecheckReminder = run({
    hookEventName: 'Stop',
    assistantMessage: 'All work is complete.'
  })
  assert.ok(!duplicateMissingPrecheckReminder.systemMessage)
  captureEntries = fs.readFileSync(CAPTURE_LOG, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line))
  assert.strictEqual(captureEntries.length, 2)
  assert.strictEqual(captureEntries[1].eventName, 'Stop')
  assert.strictEqual(fs.existsSync(CAPTURE_FLAG), false)

  cleanState()
  run({ hookEventName: 'UserPromptSubmit', prompt: 'strict stop closure test' })
  const strictStopBlock = run({
    hookEventName: 'Stop',
    assistantMessage: 'All work is complete.'
  }, TEMP_ROOT, { DEVCODEX_HOOK_ENFORCEMENT: 'strict', CODEX_HOME: '1' })
  assert.strictEqual(strictStopBlock.decision, 'block')
  assert.match(strictStopBlock.reason || '', /entry check block/i)
  assert.ok(!strictStopBlock.hookSpecificOutput?.decision)
  assert.ok(readInterceptionEntries().some(entry => entry.eventName === 'Stop' && entry.code === 'closure-incomplete' && entry.effective === true))

  cleanState()
  run({ hookEventName: 'UserPromptSubmit', prompt: 'codex strict precompact contract test' }, TEMP_ROOT, { CODEX_HOME: '1' })
  run({
    hookEventName: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Add File: src/codex-contract.js\n+contract\n*** End Patch'
    }
  }, TEMP_ROOT, { CODEX_HOME: '1' })
  const codexPreCompactBlock = run({
    hookEventName: 'PreCompact',
    assistantMessage: 'Progress before compact.'
  }, TEMP_ROOT, { DEVCODEX_HOOK_ENFORCEMENT: 'strict', CODEX_HOME: '1' })
  assert.strictEqual(codexPreCompactBlock.continue, false)
  assert.match(codexPreCompactBlock.stopReason || '', /记忆文件尚未写入|memory/i)
  assert.ok(!codexPreCompactBlock.hookSpecificOutput?.decision)

  cleanState()
  run({ hookEventName: 'UserPromptSubmit', prompt: 'claude strict precompact contract test' }, TEMP_ROOT, { CLAUDE_HOOK_COMMAND: '1' })
  run({
    hookEventName: 'PostToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: 'src/claude-contract.js', old_string: 'a', new_string: 'b' }
  }, TEMP_ROOT, { CLAUDE_HOOK_COMMAND: '1' })
  const claudePreCompactBlock = run({
    hook_event_name: 'PreCompact',
    transcript_path: ''
  }, TEMP_ROOT, { DEVCODEX_HOOK_ENFORCEMENT: 'strict', CLAUDE_HOOK_COMMAND: '1' })
  assert.strictEqual(claudePreCompactBlock.decision, 'block')
  assert.match(claudePreCompactBlock.reason || '', /记忆文件尚未写入|memory/i)
  assert.ok(!claudePreCompactBlock.hookSpecificOutput?.decision)

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
      '🔍 入口检查（DEV 模式）',
      '- PC0 上下文：项目 devcodex-v1',
      '---'
    ].join('\n')
  })
  const missingComplianceAndPathsReminder = run({
    hookEventName: 'Stop',
    assistantMessage: 'Final answer without compliance block or artifact paths.'
  })
  assert.match(missingComplianceAndPathsReminder.systemMessage || '', /合规检查状态块未输出/)
  assert.match(missingComplianceAndPathsReminder.systemMessage || '', /产物交付不完整/)
  assert.match(missingComplianceAndPathsReminder.systemMessage || '', /missingItems=.*artifact-section/)

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
      '🔍 入口检查（DEV 模式）',
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
  assert.match(artifactSectionRequiredReminder.systemMessage || '', /产物交付不完整/)

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
      '🔍 入口检查（DEV 模式）',
      '- PC0 上下文：项目 devcodex-v1',
      '---',
      '---',
      '🛡️ DEV 模式 | 合规检查',
      'FC: FC1 [✅] FC2 [✅] FC3 [✅] FC4 [✅] FC5 [✅] FC6 [✅]',
      'SC: SC1 [✅]',
      '整体：✅ 全通过',
      '',
      '📂 本次会话产物：',
      '主要产物：',
      '- [01--sample.md](/E:/Worker/devcodex-v1/.devcodex/reports/analysis/claude-code/20260525/01--sample.md)',
      '  `E:\\Worker\\devcodex-v1\\.devcodex\\reports\\analysis\\claude-code\\20260525\\01--sample.md`'
    ].join('\n')
  })
  const completeClosureReply = run({
    hookEventName: 'Stop',
    assistantMessage: [
      '🛡️ DEV 模式 | 合规检查',
      'FC: FC1 [✅] FC2 [✅] FC3 [✅] FC4 [✅] FC5 [✅] FC6 [✅]',
      '📂 本次会话产物：',
      '主要产物：',
      '- [01--sample.md](/E:/Worker/devcodex-v1/.devcodex/reports/analysis/claude-code/20260525/01--sample.md)',
      '  `E:\\Worker\\devcodex-v1\\.devcodex\\reports\\analysis\\claude-code\\20260525\\01--sample.md`'
    ].join('\n')
  })
  assert.ok(!completeClosureReply.systemMessage)

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Need a root cure for duplicate artifact cards.'
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
      '🔍 入口检查（DEV 模式）',
      '- PC0 上下文：项目 devcodex-v1',
      '---',
      '---',
      '🛡️ DEV 模式 | 合规检查',
      'FC: FC1 [✅] FC2 [✅] FC3 [✅] FC4 [✅] FC5 [✅] FC6 [✅]',
      'SC: SC1 [✅]',
      '整体：✅ 全通过',
      '',
      '📂 本次会话产物：',
      '主要产物：',
      '- [01--sample.md](/E:/Worker/devcodex-v1/.devcodex/reports/analysis/claude-code/20260525/01--sample.md)'
    ].join('\n')
  })
  const singleLineArtifactClosureReply = run({
    hookEventName: 'Stop',
    assistantMessage: [
      '🛡️ DEV 模式 | 合规检查',
      'FC: FC1 [✅] FC2 [✅] FC3 [✅] FC4 [✅] FC5 [✅] FC6 [✅]',
      '📂 本次会话产物：',
      '主要产物：',
      '- [01--sample.md](/E:/Worker/devcodex-v1/.devcodex/reports/analysis/claude-code/20260525/01--sample.md)'
    ].join('\n')
  })
  assert.ok(!singleLineArtifactClosureReply.systemMessage)

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Need a root cure for transcript-backed Stop payloads.'
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
  const transcriptPath = writeTranscript('copilot-stop-transcript.jsonl', [
    '---',
    '🔍 入口检查（DEV 模式）',
    '- PC0 上下文：项目 devcodex-v1',
    '---',
    '---',
    '🛡️ DEV 模式 | 合规检查',
    'FC: FC1 [✅] FC2 [✅] FC3 [✅] FC4 [✅] FC5 [✅] FC6 [✅]',
    'SC: SC1 [✅]',
    '整体：✅ 全通过',
    '',
    '📂 本次会话产物：',
    '主要产物：',
    '- [01--sample.md](/E:/Worker/devcodex-v1/.devcodex/reports/analysis/claude-code/20260525/01--sample.md)'
  ].join('\n'))
  const transcriptBackedClosureReply = run({
    hook_event_name: 'Stop',
    session_id: 'copilot-transcript-stop',
    transcript_path: transcriptPath,
    cwd: TEMP_ROOT
  })
  assert.ok(!transcriptBackedClosureReply.systemMessage)
  const transcriptBackedState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(transcriptBackedState.visible.payloadObserved, true)
  assert.strictEqual(transcriptBackedState.visible.precheck, true)
  assert.strictEqual(transcriptBackedState.visible.compliance, true)
  assert.strictEqual(transcriptBackedState.visible.artifactPaths, true)
  assert.strictEqual(transcriptBackedState.visible.artifactStatus, 'verified-present')
  assert.strictEqual(transcriptBackedState.visible.artifactEvidenceSource, 'transcript_path')

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Stop content parts should be visible.'
  })
  const contentPartsStop = run({
    hookEventName: 'Stop',
    assistantMessage: [
      { type: 'text', text: '---\n🔍 入口检查（DEV 模式）\n- PC0 上下文：项目 devcodex-v1\n---' }
    ]
  })
  assert.ok(!contentPartsStop.systemMessage)
  let visibleState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(visibleState.visible.precheckStatus, 'verified-present')

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Stop messages should use latest assistant message.'
  })
  const messagesStop = run({
    hookEventName: 'Stop',
    messages: [
      { role: 'user', content: 'PC0 上下文 should not count from a user message' },
      { role: 'assistant', content: [{ type: 'text', text: '---\n🔍 入口检查（DEV 模式）\n- PC0 上下文：项目 devcodex-v1\n---' }] }
    ]
  })
  assert.ok(!messagesStop.systemMessage)

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Stop choices should be parsed.'
  })
  const choicesStop = run({
    hookEventName: 'Stop',
    choices: [
      { message: { role: 'assistant', content: [{ text: '---\n🔍 入口检查（DEV 模式）\n- PC0 上下文：项目 devcodex-v1\n---' }] } }
    ]
  })
  assert.ok(!choicesStop.systemMessage)

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Transcript variants should be parsed.'
  })
  const variantTranscriptPath = writeTranscriptEntries('copilot-stop-transcript-variant.jsonl', [
    { role: 'user', content: 'trigger prompt' },
    { role: 'assistant', message: { content: [{ type: 'text', text: '---\n🔍 入口检查（DEV 模式）\n- PC0 上下文：项目 devcodex-v1\n---' }] } }
  ])
  const variantTranscriptStop = run({
    hookEventName: 'Stop',
    transcript_path: variantTranscriptPath
  })
  assert.ok(!variantTranscriptStop.systemMessage)

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Unverified Stop payload should not assert missing entry block.'
  })
  const unverifiedStop = run({ hookEventName: 'Stop' })
  assert.match(unverifiedStop.systemMessage || '', /无法验证最终用户可见回复/)
  assert.ok(!/entry check block 未输出/.test(unverifiedStop.systemMessage || ''))
  visibleState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(visibleState.visible.replyEvidence, 'unverified')
}

module.exports = {
  runHooksRuntimeVisibilityScenarios
}
