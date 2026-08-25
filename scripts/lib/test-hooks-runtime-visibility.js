'use strict'

const {
  commitLifecycleState
} = require('../../hooks/_runtime/lifecycle-state-commit.cjs')
const {
  createWorkflowOperationalWriteLease
} = require('../../hooks/_runtime/workflow-operational-write-lease.cjs')
const {
  createSimpleTaskFastPathLease,
  createSimpleTaskFastPathUsage
} = require('../../hooks/_runtime/simple-task-fast-path-lease.cjs')

function runHooksRuntimeVisibilityScenarios(context) {
  const {
    assert,
    fs,
    path,
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

  function readCaptureEntries() {
    const telemetryRoot = path.dirname(CAPTURE_LOG)
    return [0, 1, 2, 3]
      .map(index => path.join(telemetryRoot, `telemetry-${index}.ndjson`))
      .filter(file => fs.existsSync(file))
      .flatMap(file => fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)))
      .filter(entry => entry.recordType === 'final-payload-sample')
      .sort((left, right) => Date.parse(left.capturedAt || left.observedAt || '') - Date.parse(right.capturedAt || right.observedAt || ''))
  }

  const FULL_ENTRY_CHECK_LINES = [
    '### DevCodex · 入口检查',
    '- PC0 [PASS] Context plan',
    '- PC1 [PASS] Intent',
    '- PC2 [PASS] Session',
    '- PC3 [PASS] Project',
    '- PC4 [N/A] skipReason=non-dev',
    '- PC5 [PASS] Host',
    '- PC6 [PASS] Git',
    '- PC7 [PASS] Next'
  ]

  const FINAL_VALIDATION_SUMMARY_LINES = [
    '#### 验证摘要',
    '| 类型 | 命令 | exitCode | runId/计数 |',
    '| 权威 | `npm run test:visible-output` | exitCode 0 | runId=validation-202607230001 / checks=42 |',
    'WorkspaceSyncStatus: skipped (无需同步)',
    'dirty boundary: git status clean; no unrelated dirty',
    'Release actions: push/tag/release/publish 未执行'
  ]

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
      const governanceResetCommit = commitLifecycleState({
        metaDir: STATE_DIR,
        state,
        identity: {
          project: state.activeProject || state.contextAcquisition?.project || '',
          scope: state.activeScope || '',
          sessionKey: state.contextAcquisition?.hostSessionId || ''
        },
        targets: [{ role: 'active', dir: STATE_DIR }]
      }, { fs })
      assert.strictEqual(governanceResetCommit.status, 'committed')
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
    }
    return output
  }

  let operationalLeaseCounter = 0
  function issueWorkflowOperationalCreateLease(targetPath) {
    operationalLeaseCounter += 1
    const activeRoot = path.join(TEMP_ROOT, '.devcodex')
    const relativeTarget = path.relative(activeRoot, targetPath).replace(/\\/g, '/')
    const toolUseId = `workflow-operational-lease-${operationalLeaseCounter}`
    const before = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    const toolInput = {
      ingressRef: {
        schemaVersion: 'WorkflowIngressProjectionRefV1',
        envelopeId: before.actualInstructionEnvelope.envelopeId,
        envelopeDigest: before.actualInstructionEnvelope.envelopeDigest,
        decisionDigest: before.workflowRouteDecision.decisionDigest,
        routeRevision: before.workflowRouteDecision.routeRevision
      },
      operation: 'create',
      targets: [relativeTarget]
    }
    run({
      hookEventName: 'PreToolUse',
      tool_use_id: toolUseId,
      tool_name: 'mcp__devcodex_memory__memory_workflow_operational_write_lease',
      tool_input: toolInput
    })
    const current = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    const lease = createWorkflowOperationalWriteLease({
      state: current,
      activeRoot,
      projectRoot: TEMP_ROOT,
      project: current.activeProject,
      relativeTargets: [relativeTarget],
      operation: 'create'
    }, {
      fs,
      leaseIdFactory: () => `operational-${String(operationalLeaseCounter).padStart(40, '0')}`
    })
    const receipt = {
      schemaVersion: 'WorkflowOperationalWriteLeaseReceiptV1',
      lease,
      mutationAuthority: true,
      productMutationAuthority: false,
      formalArtifactAuthority: false,
      releaseAuthority: false
    }
    run({
      hookEventName: 'PostToolUse',
      tool_use_id: toolUseId,
      tool_name: 'mcp__devcodex_memory__memory_workflow_operational_write_lease',
      tool_input: toolInput,
      tool_result: receipt,
      success: true
    })
    const stored = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    assert.strictEqual(stored.workflowOperationalWriteLease?.leaseDigest, lease.leaseDigest)
    return { lease, receipt, toolInput, toolUseId }
  }

  let simpleLeaseCounter = 0
  function issueSimpleTaskFastPathLease(targetPaths) {
    simpleLeaseCounter += 1
    const activeRoot = path.join(TEMP_ROOT, '.devcodex')
    const relativeTargets = targetPaths.map(targetPath => path.relative(TEMP_ROOT, targetPath).replace(/\\/g, '/'))
    const toolUseId = `simple-task-fast-path-lease-${simpleLeaseCounter}`
    const before = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    const riskAssessment = {
      changeClass: 'local-implementation',
      crossModule: false,
      sharedContract: false,
      publicApiOrSchema: false,
      securitySensitive: false,
      dependencyChange: false,
      releaseImpact: false
    }
    const toolInput = {
      ingressRef: {
        schemaVersion: 'WorkflowIngressProjectionRefV1',
        envelopeId: before.actualInstructionEnvelope.envelopeId,
        envelopeDigest: before.actualInstructionEnvelope.envelopeDigest,
        decisionDigest: before.workflowRouteDecision.decisionDigest,
        routeRevision: before.workflowRouteDecision.routeRevision
      },
      operation: 'create-or-update',
      targets: relativeTargets,
      riskAssessment
    }
    run({
      hookEventName: 'PreToolUse',
      tool_use_id: toolUseId,
      tool_name: 'mcp__devcodex_memory__memory_task_fast_path_lease',
      tool_input: toolInput
    })
    const current = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    const lease = createSimpleTaskFastPathLease({
      state: current,
      activeRoot,
      projectRoot: TEMP_ROOT,
      project: current.activeProject,
      relativeTargets,
      operation: 'create-or-update',
      riskAssessment
    }, {
      fs,
      leaseIdFactory: () => `simple-${simpleLeaseCounter.toString(16).padStart(40, '0')}`
    })
    const usage = createSimpleTaskFastPathUsage(lease)
    const receipt = {
      schemaVersion: 'SimpleTaskFastPathLeaseReceiptV1',
      lease,
      usage,
      mutationAuthority: true,
      productMutationAuthority: true,
      formalArtifactAuthority: false,
      controlPlaneAuthority: false,
      releaseAuthority: false
    }
    run({
      hookEventName: 'PostToolUse',
      tool_use_id: toolUseId,
      tool_name: 'mcp__devcodex_memory__memory_task_fast_path_lease',
      tool_input: toolInput,
      tool_result: receipt,
      success: true
    })
    const stored = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    assert.strictEqual(stored.simpleTaskFastPathLease?.leaseDigest, lease.leaseDigest)
    assert.strictEqual(stored.simpleTaskFastPathUsage?.useCount, 0)
    return { lease, usage, receipt, toolInput, toolUseId }
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
  assert.strictEqual(readCaptureEntries().length, 0)

  fs.mkdirSync(STATE_DIR, { recursive: true })
  fs.writeFileSync(CAPTURE_FLAG, 'capture final payload once\n')

  run({
    hookEventName: 'PreCompact',
    assistantMessage: 'Visible reply sample before stop.'
  })

  assert.ok(fs.existsSync(CAPTURE_LOG))
  let captureEntries = readCaptureEntries()
  assert.strictEqual(captureEntries[0].eventName, 'PreCompact')
  assert.strictEqual(captureEntries[0].visiblePayloadDetected, true)
  assert.ok(captureEntries[0].interestingStrings.some(entry => entry.path === 'assistantMessage'))
  assert.strictEqual(fs.existsSync(CAPTURE_FLAG), true)

  const formalMutationWithoutTask = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: README.md\n*** End Patch'
    }
  })
  assert.strictEqual(formalMutationWithoutTask.continue, true)
  assert.strictEqual(formalMutationWithoutTask.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(
    formalMutationWithoutTask.hookSpecificOutput.permissionDecisionReason || '',
    /Formal artifact mutation denied|Fenced task write owner authority unavailable|TASK_|ARTIFACT_/i,
    'completed context acquisition alone must not authorize an unbound public README mutation'
  )

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
  assert.strictEqual(deleteWithWhere.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(
    deleteWithWhere.hookSpecificOutput.permissionDecisionReason || '',
    /Fenced task write owner authority unavailable|Mutation target observation unavailable/i
  )
  assert.doesNotMatch(
    deleteWithWhere.hookSpecificOutput.permissionDecisionReason || '',
    /DELETE FROM.*without WHERE|unscoped DELETE/i,
    'DELETE with WHERE is not dangerous syntax even though an unbound mutation remains unauthorized'
  )

  const dangerousApprovalId = String(
    dangerousCommand.hookSpecificOutput.additionalContext || ''
  ).match(/devcodex-approve:([a-f0-9]{12})/)?.[1]
  assert.ok(dangerousApprovalId, 'dangerous command should return one-time approval id')
  let dangerousApprovalState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(dangerousApprovalState.dangerousApprovals[dangerousApprovalId].status, 'pending')

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
  dangerousApprovalState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(
    dangerousApprovalState.dangerousApprovals[dangerousApprovalId]?.status,
    'confirmed',
    'UserPromptSubmit must persist the exact dangerous approval across the turn reset'
  )
  runBootstrapReads()
  dangerousApprovalState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(
    dangerousApprovalState.dangerousApprovals[dangerousApprovalId]?.status,
    'confirmed',
    'ContextRead and SkillRoute bootstrap must preserve a pending one-time dangerous approval'
  )
  const approvedDangerousCommand = run({
    hookEventName: 'PreToolUse',
    tool_name: 'run_in_terminal',
    tool_input: {
      command: `git reset --hard HEAD~1 # devcodex-approve:${dangerousApprovalId}`
    }
  })
  assert.strictEqual(approvedDangerousCommand.continue, true)
  assert.strictEqual(approvedDangerousCommand.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(
    approvedDangerousCommand.hookSpecificOutput.permissionDecisionReason || '',
    /Fenced task write owner authority unavailable|Mutation target observation unavailable|Formal artifact mutation denied/i,
    'one-time destructive approval clears only the dangerous-command gate, not mutation authority or observability gates'
  )
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
  assert.match(missingPrecheckReminder.systemMessage || '', /closure incomplete|entry check block/i)
  const duplicateMissingPrecheckReminder = run({
    hookEventName: 'Stop',
    assistantMessage: 'All work is complete.'
  })
  const duplicateMessage = duplicateMissingPrecheckReminder.systemMessage || ''
  assert.strictEqual(
    duplicateMessage,
    '',
    'an identical repeated Stop must reuse the stable terminal decision without injecting another reminder'
  )
  captureEntries = readCaptureEntries()
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
  assert.match(strictStopBlock.reason || '', /Stop gate incomplete|incomplete closure|entry-check-missing|entry check block/i)
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
      ...FULL_ENTRY_CHECK_LINES,
      '---'
    ].join('\n')
  })
  const missingComplianceAndPathsReminder = run({
    hookEventName: 'Stop',
    assistantMessage: 'Final answer without compliance block or artifact paths.'
  })
  assert.match(missingComplianceAndPathsReminder.systemMessage || '', /合规检查状态块未输出|完成检查未输出/)
  assert.match(missingComplianceAndPathsReminder.systemMessage || '', /用户可见交付不完整.*VisibleOutputHostEvidenceGate/)
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
      ...FULL_ENTRY_CHECK_LINES,
      '---',
      '---',
      '🛡️ DEV 模式 | 合规检查',
      'FC: FC1 [✅] FC2 [✅] FC3 [✅] FC4 [✅] FC5 [✅] FC6 [✅]',
      'SC: SC1 [✅]',
      '整体：✅ 全通过',
      '',
      '参考文件：',
      '- [01--sample.md](devcodex/.devcodex/reports/analysis/claude-code/20260525/01--sample.md)',
      '  E:\\Worker\\devcodex\\.devcodex\\reports\\analysis\\claude-code\\20260525\\01--sample.md'
    ].join('\n')
  })
  const artifactSectionRequiredReminder = run({
    hookEventName: 'Stop',
    assistantMessage: 'Final answer still missed the artifact section.'
  })
  assert.ok(!/合规检查状态块未输出/.test(artifactSectionRequiredReminder.systemMessage || ''))
  assert.match(artifactSectionRequiredReminder.systemMessage || '', /用户可见交付不完整.*VisibleOutputHostEvidenceGate/)

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Need a root cure for thin validation summary.'
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
  const thinValidationSummaryReply = run({
    hookEventName: 'Stop',
    assistantMessage: [
      '### DevCodex · 入口检查',
      ...FULL_ENTRY_CHECK_LINES,
      '🛡️ DEV 模式 | 合规检查',
      'FC: FC1 [✅] FC2 [✅] FC3 [✅] FC4 [✅] FC5 [✅] FC6 [✅]',
      '整体：✅ 全通过',
      '',
      '#### 完成交付文件',
      '- [最终执行与验证报告](/E:/Worker/devcodex/.devcodex/reports/analysis/claude-code/20260525/01--sample.md) — 说明本次执行与验证结论；路径：`.devcodex/reports/analysis/claude-code/20260525/01--sample.md`；操作：查看结论',
      '`DevCodexVisibleEnvelopeV1 · completion-check · PASS · cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc`'
    ].join('\n')
  })
  assert.match(thinValidationSummaryReply.systemMessage || '', /开发模式最终验证摘要不完整|DevModeCompletionCheckDetailGate/)
  const thinValidationSummaryState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(thinValidationSummaryState.visible.finalValidationSummaryStatus, 'verified-missing')
  assert.ok(thinValidationSummaryState.visible.finalValidationSummaryMissingItems.includes('thin-green-summary'))

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
      ...FULL_ENTRY_CHECK_LINES,
      '---',
      '---',
      '🛡️ DEV 模式 | 合规检查',
      'FC: FC1 [✅] FC2 [✅] FC3 [✅] FC4 [✅] FC5 [✅] FC6 [✅]',
      'SC: SC1 [✅]',
      '整体：✅ 全通过',
      '',
      ...FINAL_VALIDATION_SUMMARY_LINES,
      '',
      '#### 完成交付文件',
      '- [最终执行与验证报告](/E:/Worker/devcodex/.devcodex/reports/analysis/claude-code/20260525/01--sample.md) — 说明本次执行与验证结论；路径：`.devcodex/reports/analysis/claude-code/20260525/01--sample.md`；操作：查看结论',
      '`DevCodexVisibleEnvelopeV1 · final-result · PASS · aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`'
    ].join('\n')
  })
  const completeClosureReply = run({
    hookEventName: 'Stop',
    assistantMessage: [
      '🛡️ DEV 模式 | 合规检查',
      'FC: FC1 [✅] FC2 [✅] FC3 [✅] FC4 [✅] FC5 [✅] FC6 [✅]',
      ...FINAL_VALIDATION_SUMMARY_LINES,
      '#### 完成交付文件',
      '- [最终执行与验证报告](/E:/Worker/devcodex/.devcodex/reports/analysis/claude-code/20260525/01--sample.md) — 说明本次执行与验证结论；路径：`.devcodex/reports/analysis/claude-code/20260525/01--sample.md`；操作：查看结论',
      '`DevCodexVisibleEnvelopeV1 · final-result · PASS · aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`'
    ].join('\n')
  })
  // Product writes preceded Stop precheck evidence → S07 order late (VL-004); other closure items clean
  assert.match(completeClosureReply.systemMessage || '', /S07 order|product mutation before entry-check|VL-004/i)
  assert.ok(!/合规检查状态块未输出/.test(completeClosureReply.systemMessage || ''))
  assert.ok(!/最终验证摘要不完整/.test(completeClosureReply.systemMessage || ''))
  assert.ok(!/用户可见交付不完整/.test(completeClosureReply.systemMessage || ''))
  const completeClosureState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(completeClosureState.visible.s07OrderStatus, 'late')
  assert.strictEqual(completeClosureState.visible.finalValidationSummaryStatus, 'verified-present')

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
      ...FULL_ENTRY_CHECK_LINES,
      '---',
      '---',
      '🛡️ DEV 模式 | 合规检查',
      'FC: FC1 [✅] FC2 [✅] FC3 [✅] FC4 [✅] FC5 [✅] FC6 [✅]',
      'SC: SC1 [✅]',
      '整体：✅ 全通过',
      '',
      '📂 本次会话产物：',
      '主要产物：',
      '- [01--sample.md](/E:/Worker/devcodex/.devcodex/reports/analysis/claude-code/20260525/01--sample.md)'
    ].join('\n')
  })
  const singleLineArtifactClosureReply = run({
    hookEventName: 'Stop',
    assistantMessage: [
      '🛡️ DEV 模式 | 合规检查',
      'FC: FC1 [✅] FC2 [✅] FC3 [✅] FC4 [✅] FC5 [✅] FC6 [✅]',
      '📂 本次会话产物：',
      '主要产物：',
      '- [01--sample.md](/E:/Worker/devcodex/.devcodex/reports/analysis/claude-code/20260525/01--sample.md)'
    ].join('\n')
  })
  assert.match(singleLineArtifactClosureReply.systemMessage || '', /无法验证最终用户可见回复的产物交付/)
  const legacyArtifactState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(legacyArtifactState.visible.artifactStatus, 'unverified')
  assert.ok(legacyArtifactState.visible.artifactMissingItems.includes('legacy-artifact-format'))

  // PF-163: bare path list without allowed semantic headings
  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Finish delivery with bare path list only.'
  })
  runBootstrapReads()
  run({
    hookEventName: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Add File: .devcodex/reports/analysis/claude-code/20260525/02--bare.md\n+# report\n*** End Patch'
    }
  })
  run({
    hookEventName: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: `*** Begin Patch\n*** Update File: ${getMemoryFilePath(TEST_AGENT, 'tasks', `${getTaskStamp(0)}.md`)}\n*** End Patch`
    }
  })
  const barePathListReply = run({
    hookEventName: 'Stop',
    assistantMessage: [
      '### DevCodex · 入口检查',
      ...FULL_ENTRY_CHECK_LINES,
      '🛡️ DEV 模式 | 合规检查',
      'FC: FC1 [✅] FC2 [✅]',
      '',
      '核心文件：',
      '- reports/analysis/claude-code/20260525/02--bare.md',
      '- E:\\Worker\\devcodex\\.devcodex\\reports\\analysis\\claude-code\\20260525\\02--bare.md'
    ].join('\n')
  })
  assert.match(barePathListReply.systemMessage || '', /用户可见交付不完整|无法验证最终用户可见回复的产物交付/)
  const barePathState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.notStrictEqual(barePathState.visible.artifactStatus, 'verified-present')
  assert.ok(
    barePathState.visible.artifactMissingItems.includes('bare-path-list') ||
    barePathState.visible.artifactMissingItems.includes('bare-path-items') ||
    barePathState.visible.artifactMissingItems.includes('legacy-artifact-format') ||
    barePathState.visible.artifactMissingItems.includes('artifact-section'),
    'bare path delivery must be flagged: ' + JSON.stringify(barePathState.visible.artifactMissingItems)
  )

  // PF-163: allowed heading but absolute paths without 操作 clause
  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Finish delivery with absolute paths only under completion heading.'
  })
  runBootstrapReads()
  run({
    hookEventName: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Add File: .devcodex/reports/analysis/claude-code/20260525/03--abs.md\n+# report\n*** End Patch'
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
    hookEventName: 'Stop',
    assistantMessage: [
      '### DevCodex · 入口检查',
      ...FULL_ENTRY_CHECK_LINES,
      '🛡️ DEV 模式 | 合规检查',
      'FC: FC1 [✅]',
      '',
      '#### 完成交付文件',
      '- E:\\Worker\\devcodex\\.devcodex\\reports\\analysis\\claude-code\\20260525\\03--abs.md',
      '`DevCodexVisibleEnvelopeV1 · final-result · PASS · aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`'
    ].join('\n')
  })
  const absPathState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(absPathState.visible.artifactStatus, 'verified-missing')
  assert.ok(
    absPathState.visible.artifactMissingItems.includes('semantic-artifact-items') ||
    absPathState.visible.artifactMissingItems.includes('bare-absolute-paths'),
    'absolute path without action must not be verified-present: ' + JSON.stringify(absPathState.visible.artifactMissingItems)
  )

  // PF-163: unobserved Stop payload still records semantic-artifact-items for completion evidence
  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Finish with report but host omits Stop body.'
  })
  runBootstrapReads()
  run({
    hookEventName: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Add File: .devcodex/reports/analysis/claude-code/20260525/04--unobs.md\n+# report\n*** End Patch'
    }
  })
  run({
    hookEventName: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: `*** Begin Patch\n*** Update File: ${getMemoryFilePath(TEST_AGENT, 'tasks', `${getTaskStamp(0)}.md`)}\n*** End Patch`
    }
  })
  const unobservedReply = run({
    hookEventName: 'Stop'
    // no assistantMessage / transcript — payload unobserved
  })
  assert.match(unobservedReply.systemMessage || '', /无法验证最终用户可见回复的产物交付/)
  assert.match(unobservedReply.systemMessage || '', /semantic-artifact-items|missingItems=/)
  const unobservedState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(unobservedState.visible.artifactStatus, 'unverified')
  assert.ok(unobservedState.visible.artifactMissingItems.includes('semantic-artifact-items'))
  assert.ok(unobservedState.visible.artifactMissingItems.includes('visible-payload-unobserved'))

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
    ...FULL_ENTRY_CHECK_LINES,
    '---',
    '---',
    '🛡️ DEV 模式 | 合规检查',
    'FC: FC1 [✅] FC2 [✅] FC3 [✅] FC4 [✅] FC5 [✅] FC6 [✅]',
    'SC: SC1 [✅]',
    '整体：✅ 全通过',
    '',
    ...FINAL_VALIDATION_SUMMARY_LINES,
    '',
    '#### 完成交付文件',
    '- [最终执行与验证报告](/E:/Worker/devcodex/.devcodex/reports/analysis/claude-code/20260525/01--sample.md) — 说明本次执行与验证结论；路径：`.devcodex/reports/analysis/claude-code/20260525/01--sample.md`；操作：查看结论',
    '`DevCodexVisibleEnvelopeV1 · final-result · PASS · bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`'
  ].join('\n'))
  const transcriptBackedClosureReply = run({
    hook_event_name: 'Stop',
    session_id: 'copilot-transcript-stop',
    transcript_path: transcriptPath,
    cwd: TEMP_ROOT
  })
  // Reports/memory mutations before transcript PC evidence → late order reminder only
  assert.match(transcriptBackedClosureReply.systemMessage || '', /S07 order|product mutation before entry-check|VL-004/i)
  const transcriptBackedState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(transcriptBackedState.visible.payloadObserved, true)
  assert.strictEqual(transcriptBackedState.visible.precheck, true)
  assert.strictEqual(transcriptBackedState.visible.compliance, true)
  assert.strictEqual(transcriptBackedState.visible.finalValidationSummaryStatus, 'verified-present')
  assert.strictEqual(transcriptBackedState.visible.artifactPaths, true)
  assert.strictEqual(transcriptBackedState.visible.artifactStatus, 'verified-present')
  assert.strictEqual(transcriptBackedState.visible.artifactEvidenceSource, 'transcript_path')
  assert.strictEqual(transcriptBackedState.visible.s07OrderStatus, 'late')

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Stop content parts should be visible.'
  })
  const contentPartsStop = run({
    hookEventName: 'Stop',
    assistantMessage: [
      { type: 'text', text: '### DevCodex · 入口检查\n- PC0 [PASS] Context plan\n- PC1 [PASS] Intent\n- PC2 [PASS] Session\n- PC3 [PASS] Project\n- PC4 [N/A] skipReason=non-dev\n- PC5 [PASS] Host\n- PC6 [PASS] Git\n- PC7 [PASS] Next' }
    ]
  })
  assert.ok(!/entry check block 未输出|entry-check-missing/i.test(contentPartsStop.systemMessage || ''))
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
      { role: 'assistant', content: [{ type: 'text', text: '### DevCodex · 入口检查\n- PC0 [PASS] Context plan\n- PC1 [PASS] Intent\n- PC2 [PASS] Session\n- PC3 [PASS] Project\n- PC4 [N/A] skipReason=non-dev\n- PC5 [PASS] Host\n- PC6 [PASS] Git\n- PC7 [PASS] Next' }] }
    ]
  })
  assert.ok(!/entry check block 未输出|entry-check-missing/i.test(messagesStop.systemMessage || ''))

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Stop choices should be parsed.'
  })
  const choicesStop = run({
    hookEventName: 'Stop',
    choices: [
      { message: { role: 'assistant', content: [{ text: '### DevCodex · 入口检查\n- PC0 [PASS] Context plan\n- PC1 [PASS] Intent\n- PC2 [PASS] Session\n- PC3 [PASS] Project\n- PC4 [N/A] skipReason=non-dev\n- PC5 [PASS] Host\n- PC6 [PASS] Git\n- PC7 [PASS] Next' }] } }
    ]
  })
  assert.ok(!/entry check block 未输出|entry-check-missing/i.test(choicesStop.systemMessage || ''))

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Transcript variants should be parsed.'
  })
  const variantTranscriptPath = writeTranscriptEntries('copilot-stop-transcript-variant.jsonl', [
    { role: 'user', content: 'trigger prompt' },
    { role: 'assistant', message: { content: [{ type: 'text', text: '### DevCodex · 入口检查\n- PC0 [PASS] Context plan\n- PC1 [PASS] Intent\n- PC2 [PASS] Session\n- PC3 [PASS] Project\n- PC4 [N/A] skipReason=non-dev\n- PC5 [PASS] Host\n- PC6 [PASS] Git\n- PC7 [PASS] Next' }] } }
  ])
  const variantTranscriptStop = run({
    hookEventName: 'Stop',
    transcript_path: variantTranscriptPath
  })
  assert.ok(!/entry check block 未输出|entry-check-missing/i.test(variantTranscriptStop.systemMessage || ''))

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
  assert.strictEqual(visibleState.visible.s07OrderStatus || 'unverified', 'unverified')

  // ── SimpleTaskFastPath: server-owned exact lease, bounded usage and replay closeout ──
  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: '修复 src 中两个局部实现文件的小问题'
  })
  runBootstrapReads(TEST_AGENT, 'fix', ['source-code'])
  const simpleFirstPath = path.join(TEMP_ROOT, 'src', 'simple-first.js')
  const simpleSecondPath = path.join(TEMP_ROOT, 'src', 'simple-second.js')
  const simpleThirdPath = path.join(TEMP_ROOT, 'src', 'simple-third.js')
  const simpleIssued = issueSimpleTaskFastPathLease([simpleFirstPath, simpleSecondPath])
  const firstSimpleInput = { file_path: simpleFirstPath, content: 'module.exports = 1\n' }
  const firstSimplePre = run({
    hookEventName: 'PreToolUse',
    tool_use_id: 'simple-write-1',
    tool_name: 'Write',
    tool_input: firstSimpleInput
  })
  assert.strictEqual(firstSimplePre.continue, true)
  assert.notStrictEqual(
    firstSimplePre.hookSpecificOutput?.permissionDecision,
    'deny',
    JSON.stringify(firstSimplePre)
  )
  let simpleState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(simpleState.turnLiveness?.inFlightOperation?.mutationLease?.ownerKind, 'simple-task-fast-path')
  fs.mkdirSync(path.dirname(simpleFirstPath), { recursive: true })
  fs.writeFileSync(simpleFirstPath, firstSimpleInput.content)
  run({
    hookEventName: 'PostToolUse',
    tool_use_id: 'simple-write-1',
    tool_name: 'Write',
    tool_input: firstSimpleInput,
    success: true
  })
  simpleState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(simpleState.turnLiveness.lastMutationCloseout?.result, 'success')
  assert.strictEqual(simpleState.simpleTaskFastPathUsage?.useCount, 1)
  assert.strictEqual(simpleState.simpleTaskFastPathUsage?.status, 'active')
  assert.strictEqual(simpleState.simpleTaskFastPathLease?.leaseDigest, simpleIssued.lease.leaseDigest)

  const pathDrift = run({
    hookEventName: 'PreToolUse',
    tool_use_id: 'simple-write-drift',
    tool_name: 'Write',
    tool_input: { file_path: simpleThirdPath, content: 'module.exports = 3\n' }
  })
  assert.strictEqual(pathDrift.hookSpecificOutput?.permissionDecision, 'deny')
  assert.match(
    pathDrift.hookSpecificOutput?.permissionDecisionReason || pathDrift.systemMessage || '',
    /TASK_WRITE_OWNER_BINDING_REQUIRED|Fenced task write owner authority unavailable/i
  )
  simpleState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(simpleState.simpleTaskFastPathUsage?.useCount, 1)

  const secondSimpleInput = { file_path: simpleSecondPath, content: 'module.exports = 2\n' }
  const secondSimplePre = run({
    hookEventName: 'PreToolUse',
    tool_use_id: 'simple-write-2',
    tool_name: 'Write',
    tool_input: secondSimpleInput
  })
  assert.strictEqual(secondSimplePre.continue, true)
  assert.notStrictEqual(
    secondSimplePre.hookSpecificOutput?.permissionDecision,
    'deny',
    JSON.stringify(secondSimplePre)
  )
  fs.writeFileSync(simpleSecondPath, secondSimpleInput.content)
  run({
    hookEventName: 'PostToolUse',
    tool_use_id: 'simple-write-2',
    tool_name: 'Write',
    tool_input: secondSimpleInput,
    success: true
  })
  simpleState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(simpleState.simpleTaskFastPathLease, null)
  assert.strictEqual(simpleState.simpleTaskFastPathUsage, null)
  assert.strictEqual(simpleState.simpleTaskFastPathLeaseCloseout?.status, 'consumed')
  assert.strictEqual(simpleState.simpleTaskFastPathLeaseCloseout?.useCount, 2)

  run({
    hookEventName: 'PostToolUse',
    tool_use_id: simpleIssued.toolUseId,
    tool_name: 'mcp__devcodex_memory__memory_task_fast_path_lease',
    tool_input: simpleIssued.toolInput,
    tool_result: simpleIssued.receipt,
    success: true
  })
  simpleState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(simpleState.simpleTaskFastPathLease, null, 'closed simple-task authority must reject result replay')
  assert.strictEqual(simpleState.simpleTaskFastPathLeaseObservationError, 'SIMPLE_TASK_FAST_PATH_LEASE_ALREADY_CLOSED')

  // ── S07 product-artifact order (VL-004 / PI-016) ───────────────────────────
  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 's07 product write before entry-check safety-only'
  })
  runBootstrapReads(TEST_AGENT)
  const firstReportPath = path.join(TEMP_ROOT, '.devcodex', 'reports', 'analysis', 'test', '20260824', '01--sample.md')
  const firstOperationalLease = issueWorkflowOperationalCreateLease(firstReportPath)
  const productWriteWarn = run({
    hookEventName: 'PreToolUse',
    tool_use_id: 's07-operational-report-1',
    tool_name: 'Write',
    tool_input: {
      file_path: firstReportPath,
      content: '# report\n'
    }
  })
  assert.strictEqual(productWriteWarn.continue, true)
  assert.match(
    productWriteWarn.systemMessage || productWriteWarn.hookSpecificOutput?.permissionDecisionReason || '',
    /s07-product-before-entry-check|S07/i
  )
  assert.notStrictEqual(productWriteWarn.hookSpecificOutput?.permissionDecision, 'deny')
  let s07State = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(s07State.productMutationBeforePrecheck, true)
  assert.strictEqual(s07State.s07ProductWarnEmitted, true)
  assert.strictEqual(s07State.turnLiveness?.inFlightOperation?.artifactDecision?.slotId, 'project-report')
  assert.strictEqual(s07State.turnLiveness?.inFlightOperation?.artifactDecision?.decisionStatus, 'allow')
  assert.strictEqual(s07State.turnLiveness?.inFlightOperation?.mutationLease?.ownerKind, 'workflow-operational')
  fs.mkdirSync(path.dirname(firstReportPath), { recursive: true })
  fs.writeFileSync(firstReportPath, '# report\n')
  run({
    hookEventName: 'PostToolUse',
    tool_use_id: 's07-operational-report-1',
    tool_name: 'Write',
    tool_input: { file_path: firstReportPath, content: '# report\n' },
    success: true
  })
  s07State = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(s07State.turnLiveness.lastMutationCloseout?.result, 'success')
  assert.strictEqual(s07State.workflowOperationalWriteLease, null)
  run({
    hookEventName: 'PostToolUse',
    tool_use_id: firstOperationalLease.toolUseId,
    tool_name: 'mcp__devcodex_memory__memory_workflow_operational_write_lease',
    tool_input: firstOperationalLease.toolInput,
    tool_result: firstOperationalLease.receipt,
    success: true
  })
  s07State = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(s07State.workflowOperationalWriteLease, null, 'a consumed operational lease must not be restored by result replay')
  assert.strictEqual(s07State.workflowOperationalWriteLeaseObservationError, 'WORKFLOW_OPERATIONAL_LEASE_ALREADY_CONSUMED')

  const secondReportPath = path.join(TEMP_ROOT, '.devcodex', 'reports', 'analysis', 'test', '20260824', '02--sample.md')
  issueWorkflowOperationalCreateLease(secondReportPath)
  const productWriteSecond = run({
    hookEventName: 'PreToolUse',
    tool_use_id: 's07-operational-report-2',
    tool_name: 'Write',
    tool_input: {
      file_path: secondReportPath,
      content: '# report2\n'
    }
  })
  assert.strictEqual(productWriteSecond.continue, true)
  fs.writeFileSync(secondReportPath, '# report2\n')
  run({
    hookEventName: 'PostToolUse',
    tool_use_id: 's07-operational-report-2',
    tool_name: 'Write',
    tool_input: { file_path: secondReportPath, content: '# report2\n' },
    success: true
  })

  const lateOrderStop = run({
    hookEventName: 'Stop',
    assistantMessage: [
      '### DevCodex · 入口检查',
      ...FULL_ENTRY_CHECK_LINES,
      '### 结论',
      'done'
    ].join('\n')
  })
  assert.match(lateOrderStop.systemMessage || '', /S07 order|product mutation before entry-check|VL-004/i)
  s07State = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(s07State.visible.s07OrderStatus, 'late')

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 's07 product write strict deny'
  })
  runBootstrapReads(TEST_AGENT)
  const strictReportPath = path.join(TEMP_ROOT, '.devcodex', 'reports', 'analysis', 'test', '20260824', '01--strict.md')
  issueWorkflowOperationalCreateLease(strictReportPath)
  const productWriteStrict = run({
    hookEventName: 'PreToolUse',
    tool_name: 'Write',
    tool_input: {
      file_path: strictReportPath,
      content: '# report\n'
    }
  }, TEMP_ROOT, { DEVCODEX_HOOK_ENFORCEMENT: 'strict', CLAUDE_HOOK_COMMAND: '1' })
  assert.strictEqual(productWriteStrict.hookSpecificOutput?.permissionDecision, 'deny')
  assert.match(
    productWriteStrict.hookSpecificOutput?.permissionDecisionReason || productWriteStrict.systemMessage || '',
    /s07-product-before-entry-check|S07/i
  )

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 's07 readonly tools are not product mutations'
  })
  runBootstrapReads(TEST_AGENT)
  const readOnlyOk = run({
    hookEventName: 'PreToolUse',
    tool_name: 'Read',
    tool_input: {
      file_path: path.join(TEMP_ROOT, '.devcodex', 'reports', 'analysis', 'test', '01--sample.md')
    }
  })
  assert.strictEqual(readOnlyOk.continue, true)
  assert.ok(!/s07-product-before-entry-check/i.test(
    readOnlyOk.systemMessage || readOnlyOk.hookSpecificOutput?.permissionDecisionReason || ''
  ))

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'formal artifact unknown slot must fail closed'
  })
  runBootstrapReads(TEST_AGENT)
  const unknownFormalSlot = run({
    hookEventName: 'PreToolUse',
    tool_name: 'Write',
    tool_input: {
      file_path: path.join(TEMP_ROOT, '.devcodex', 'bugs', 'fixture-task', '02-功能清单.md'),
      content: '# misplaced\n'
    }
  })
  assert.strictEqual(unknownFormalSlot.hookSpecificOutput?.permissionDecision, 'deny')
  assert.match(
    unknownFormalSlot.hookSpecificOutput?.permissionDecisionReason || unknownFormalSlot.systemMessage || '',
    /Formal artifact mutation denied|artifact-slot-unknown/i
  )
  s07State = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.notStrictEqual(s07State.productMutationBeforePrecheck, true)

  // --- PF-087: free-text PC0~PC7 completeness (folded / incomplete must not green precheck) ---
  const {
    analyzeEntryCheckCompleteness
  } = require('../../hooks/_runtime/lifecycle-visible-reply.cjs')

  const foldedSample = [
    '### DevCodex · 入口检查',
    '- PC0 [PASS] Context plan',
    '- PC2–PC7 [PASS] 其余合并'
  ].join('\n')
  const folded = analyzeEntryCheckCompleteness(foldedSample)
  assert.strictEqual(folded.claimed, true)
  assert.strictEqual(folded.complete, false)
  assert.ok(folded.missingItems.includes('pc-folded-range'))
  assert.ok(folded.missingPcs.includes('PC1'))

  const incompleteSample = [
    '### DevCodex · 入口检查',
    '- PC0 [PASS] Context plan',
    '- PC1 [PASS] Intent'
  ].join('\n')
  const incomplete = analyzeEntryCheckCompleteness(incompleteSample)
  assert.strictEqual(incomplete.complete, false)
  assert.ok(incomplete.missingPcs.includes('PC7'))

  const devNa = analyzeEntryCheckCompleteness([
    '### DevCodex · 入口检查',
    '- PC0 [PASS] Context plan',
    '- PC1 [PASS] Intent',
    '- PC2 [PASS] Session',
    '- PC3 [PASS] Project',
    '- PC4 [N/A]',
    '- PC5 [PASS] Host',
    '- PC6 [PASS] Git',
    '- PC7 [PASS] Next'
  ].join('\n'), { mode: 'dev' })
  assert.ok(devNa.missingItems.includes('pc4-dev-na-without-skip'))

  const completeSample = FULL_ENTRY_CHECK_LINES.join('\n')
  assert.strictEqual(analyzeEntryCheckCompleteness(completeSample).complete, true)

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'pf087 folded entry check'
  })
  runBootstrapReads(TEST_AGENT)
  const foldedStop = run({
    hookEventName: 'Stop',
    stop_hook_active: true,
    finalMessage: foldedSample
  })
  assert.match(foldedStop.systemMessage || '', /entry check incomplete|PF-087|pc-folded|PC0~PC7/i)
  const foldedState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(foldedState.visible.precheckStatus, 'verified-missing')
  assert.strictEqual(foldedState.visible.precheck, false)
  assert.ok(foldedState.visible.entryCheckCompleteness)
  assert.strictEqual(foldedState.visible.entryCheckCompleteness.complete, false)

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'pf087 complete entry check'
  })
  runBootstrapReads(TEST_AGENT)
  run({
    hookEventName: 'Stop',
    stop_hook_active: true,
    finalMessage: completeSample
  })
  const completeState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(completeState.visible.precheckStatus, 'verified-present')
  assert.strictEqual(completeState.visible.precheck, true)
  assert.strictEqual(completeState.visible.entryCheckCompleteness.complete, true)
}

module.exports = {
  runHooksRuntimeVisibilityScenarios
}
