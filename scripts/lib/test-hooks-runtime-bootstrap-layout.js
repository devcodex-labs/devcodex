'use strict'
const {
  contextPlanObservationRelativePath
} = require('../../hooks/_runtime/context-plan-observation.cjs')
const {
  buildJsonContentIdentity
} = require('../../hooks/_runtime/content-identity.cjs')
const {
  handleSkillRoute
} = require('../../hooks/_runtime/skill-route-tool.cjs')
const {
  commitLifecycleState
} = require('../../hooks/_runtime/lifecycle-state-commit.cjs')
const {
  findLayoutInfo,
  resolveHostWorkspaceBinding,
  resolveRuntimeStateRoot
} = require('../../hooks/_runtime/workspace-layout.cjs')

function runHooksRuntimeBootstrapLayoutScenarios(context) {
  const {
    assert,
    fs,
    path,
    TEMP_ROOT,
    STATE_FILE,
    TEST_AGENT,
    FALLBACK_BOOTSTRAP_AGENT,
    WRONG_FALLBACK_AGENT,
    stableDigest,
    getTaskStamp,
    getMemoryFilePath,
    getLayoutStateFile,
    getWorkspaceLayoutStateFile,
    callProfileTool,
    runBootstrapReads,
    runLayoutBootstrapReads,
    cleanState,
    cleanLayoutState,
    cleanMultiProjectState,
    cleanLayoutMultiProjectState,
    cleanNestedLayoutMultiProjectState,
    cleanToolingSiblingState,
    run
  } = context

  function readLegacyState() {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  }

  function persistWorkspaceLayoutState(state) {
    const workspaceStateFile = getWorkspaceLayoutStateFile()
    const project = String(state.activeProject || '').trim()
    const activeStateFile = project ? getLayoutStateFile(project) : workspaceStateFile
    const targets = [
      { role: 'active', dir: path.dirname(activeStateFile) },
      { role: 'meta', dir: path.dirname(workspaceStateFile) }
    ]
    const receipt = commitLifecycleState({
      metaDir: path.dirname(workspaceStateFile),
      state,
      identity: {
        project,
        scope: state.activeScope || 'workspace',
        sessionKey: state.contextAcquisition?.hostSessionId || ''
      },
      targets
    }, { fs })
    assert.strictEqual(receipt.status, 'committed')
    for (const file of new Set([activeStateFile, workspaceStateFile])) {
      fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`)
    }
  }

  function completeCurrentSkillRoute({ loadStages = true } = {}) {
    const state = readLegacyState()
    const bootstrap = state.progressiveSkillRoute?.bootstrap
    assert(bootstrap, 'SkillRoute bootstrap must exist before completing the route')
    const options = { inputRoot: TEMP_ROOT }
    let cursor = null
    do {
      const page = handleSkillRoute({
        op: 'catalog',
        project: bootstrap.project,
        turnBinding: bootstrap.turnBinding,
        contextEpoch: bootstrap.contextEpoch,
        ...(cursor ? { cursor } : {})
      }, options)
      assert.strictEqual(page.ok, true, JSON.stringify(page))
      cursor = page.receipt.nextCursor
    } while (cursor)
    const commit = handleSkillRoute({
      op: 'commit',
      project: bootstrap.project,
      turnBinding: bootstrap.turnBinding,
      contextEpoch: bootstrap.contextEpoch,
      catalogDigest: bootstrap.catalogDigest,
      skillId: null,
      contextBinding: {
        schemaVersion: 'ContextReadBindingV1',
        contextEpoch: state.contextAcquisition.plan.identity.contextEpoch,
        planId: state.contextAcquisition.plan.planId,
        planContentId: state.contextAcquisition.plan.planContentId,
        activeRoot: state.contextAcquisition.plan.identity.activeRoot,
        project: state.contextAcquisition.plan.identity.project
      }
    }, options)
    assert.strictEqual(commit.ok, true, JSON.stringify(commit))
    if (!loadStages) return commit
    for (const stageId of commit.receipt.obligations.requiredStageIds) {
      let stageCursor = null
      do {
        const stage = handleSkillRoute({
          op: 'load_stage',
          project: bootstrap.project,
          turnBinding: bootstrap.turnBinding,
          contextEpoch: bootstrap.contextEpoch,
          generation: commit.receipt.plan.generation,
          planDigest: commit.receipt.plan.planDigest,
          stageId,
          triggerRef: `hooks-runtime:${stageId}`,
          ...(stageCursor ? { cursor: stageCursor } : {})
        }, options)
        assert.strictEqual(stage.ok, true, JSON.stringify(stage))
        stageCursor = stage.receipt.nextCursor
      } while (stageCursor)
    }
    return commit
  }

  function mutatePlanResult(result, mutate, { recomputePlanId = false } = {}) {
    const cloned = JSON.parse(JSON.stringify(result))
    const plan = JSON.parse(cloned.content[0].text)
    mutate(plan)
    if (recomputePlanId) {
      plan.planId = `plan-${stableDigest({ ...plan, planId: undefined, planningTelemetry: undefined }).slice(0, 24)}`
    }
    cloned.content[0].text = JSON.stringify(plan, null, 2)
    return cloned
  }

  function observePlan({
    intent = 'chat',
    changeTypes,
    callId = 'context-plan-call',
    resultField = 'tool_response',
    mutateResult,
    env = {}
  } = {}) {
    const state = readLegacyState()
    const args = {
      intent,
      contextEpoch: state.contextAcquisition.contextEpoch,
      project: state.contextAcquisition.project,
      ...(changeTypes ? { changeTypes } : {})
    }
    const pre = run({
      hookEventName: 'PreToolUse',
      tool_use_id: callId,
      tool_name: 'mcp__devcodex-profile__profile_context_plan',
      tool_input: args
    }, TEMP_ROOT, env)
    let result = callProfileTool(TEMP_ROOT, 'profile_context_plan', args)
    if (mutateResult) result = mutateResult(result, args)
    const post = run({
      hookEventName: 'PostToolUse',
      tool_use_id: callId,
      tool_name: 'mcp__devcodex-profile__profile_context_plan',
      tool_input: args,
      [resultField]: result
    }, TEMP_ROOT, env)
    return { args, pre, post, result, state: readLegacyState() }
  }

  function observeMemoryStatus(callId = 'memory-status-call', resultOverrides = {}) {
    const state = readLegacyState()
    const contextBinding = {
      schemaVersion: 'ContextReadBindingV1',
      contextEpoch: state.contextAcquisition.contextEpoch,
      planId: state.contextAcquisition.plan.planId,
      planContentId: state.contextAcquisition.plan.planContentId,
      activeRoot: state.contextAcquisition.activeRoot,
      project: state.contextAcquisition.project
    }
    const responseContextBinding = {
      ...contextBinding,
      bindingStatus: 'verified',
      verificationMode: 'request-bound'
    }
    const args = { agent: TEST_AGENT, project: state.contextAcquisition.project, contextBinding }
    run({
      hookEventName: 'PreToolUse',
      tool_use_id: callId,
      tool_name: 'devcodex-memory/memory_status',
      tool_input: args
    })
    const operational = new Set(['contentIdentity', 'contextObservation', 'telemetry'])
    const projectionOverrides = Object.fromEntries(
      Object.entries(resultOverrides).filter(([key]) => !operational.has(key))
    )
    const projection = {
      schemaVersion: 'MemoryStatusV1',
      activeRoot: state.contextAcquisition.activeRoot,
      project: state.contextAcquisition.project,
      agent: TEST_AGENT,
      today: getTaskStamp(0),
      yesterday: getTaskStamp(-1),
      summary: { exists: false },
      latestRows: [],
      activeSessionIds: [],
      conflicts: [],
      coverage: { status: 'complete' },
      contextBinding: responseContextBinding,
      ...projectionOverrides
    }
    const contentIdentity = buildJsonContentIdentity({
      sourceKey: `memory://${state.contextAcquisition.project}/memory_status#delivered`,
      value: projection,
      contractVersion: 'MemoryStatusV1'
    }).identity
    const result = {
      ...projection,
      contentIdentity: resultOverrides.contentIdentity || contentIdentity,
      contextObservation: resultOverrides.contextObservation || {
        schemaVersion: 'ContextSourceObservationWriteReceiptV1',
        status: 'persisted',
        receiptStatus: 'relevant-complete',
        satisfiedSourceIds: state.contextAcquisition.plan.mandatorySourceIds,
        missingSourceIds: []
      },
      telemetry: resultOverrides.telemetry || { bytes: 0, chars: 0, latencyMs: 0, tokens: null }
    }
    run({
      hookEventName: 'PostToolUse',
      tool_use_id: callId,
      tool_name: 'devcodex-memory/memory_status',
      tool_input: args,
      tool_result: result
    })
    return readLegacyState()
  }

  function observeProfileLoad(callId = 'profile-load-call') {
    const state = readLegacyState()
    const args = {
      project: state.contextAcquisition.project,
      files: state.contextAcquisition.plan.profile.selectedFiles,
      contextBinding: {
        schemaVersion: 'ContextReadBindingV1',
        contextEpoch: state.contextAcquisition.contextEpoch,
        planId: state.contextAcquisition.plan.planId,
        planContentId: state.contextAcquisition.plan.planContentId,
        activeRoot: state.contextAcquisition.activeRoot,
        project: state.contextAcquisition.project
      }
    }
    run({
      hookEventName: 'PreToolUse',
      tool_use_id: callId,
      tool_name: 'devcodex-profile/profile_load',
      tool_input: args
    })
    const result = callProfileTool(TEMP_ROOT, 'profile_load', args)
    run({
      hookEventName: 'PostToolUse',
      tool_use_id: callId,
      tool_name: 'devcodex-profile/profile_load',
      tool_input: args,
      tool_response: result
    })
    return readLegacyState()
  }

  cleanMultiProjectState()
  const multiProjectPromptWarning = run({
    hookEventName: 'UserPromptSubmit',
    prompt: '这个项目继续'
  })
  assert.strictEqual(multiProjectPromptWarning.continue, true)
  assert.match(multiProjectPromptWarning.systemMessage || '', /multi-project-workspace/)
  assert.strictEqual(multiProjectPromptWarning.hookSpecificOutput?.hookEventName, 'UserPromptSubmit')
  assert.match(multiProjectPromptWarning.hookSpecificOutput?.additionalContext || '', /Multi-project workspace|多项目|目标项目/)

  cleanLayoutMultiProjectState({ workspaceProfile: true })
  const reboundProfileRoot = path.join(TEMP_ROOT, '.devcodex', 'devcodex', 'profile')
  fs.writeFileSync(path.join(reboundProfileRoot, 'README.md'), [
    '# Rebound project Profile',
    '',
    '> Profile 档位：`profile-lite`。',
    '',
    '| 文件 | 说明 | 必须 |',
    '|------|------|:----:|',
    '| `01-项目信息.md` | project | 是 |',
    '| `02-架构约束.md` | architecture | 是 |',
    '| `03-代码风格.md` | style | 是 |'
  ].join('\n'))
  for (const file of ['01-项目信息.md', '02-架构约束.md', '03-代码风格.md']) {
    fs.writeFileSync(path.join(reboundProfileRoot, file), `# ${file}\n\nREBOUND-PROFILE-BODY\n`)
  }
  const pendingSession = 'pending-project-rebind'
  const pendingPrompt = run({
    hookEventName: 'UserPromptSubmit',
    session_id: pendingSession,
    prompt: '请使用 audit-project skill 检查当前状态'
  }, TEMP_ROOT, {
    DEVCODEX_HOST_PLATFORM: 'codex'
  })
  assert.match(pendingPrompt.systemMessage || '', /SkillRouteBootstrapPendingV1/)
  const pendingState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(pendingState.contextAcquisition.targetResolved, false)
  assert.strictEqual(pendingState.progressiveSkillRoute.pending.explicitSkillId, 'audit-project')
  assert.strictEqual(
    pendingState.progressiveSkillRoute.pending.schemaVersion,
    'SkillRoutePendingEnvelopeV1'
  )
  const pendingStop = run({
    hookEventName: 'Stop',
    session_id: pendingSession,
    last_assistant_message: 'Direct answer without resolving the project or loading the route.'
  }, TEMP_ROOT, {
    DEVCODEX_HOST_PLATFORM: 'codex'
  })
  assert.strictEqual(pendingStop.devcodexCode, 'closure-incomplete')
  assert.notStrictEqual(pendingStop.decision, 'block')
  const pendingAfterStop = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(
    pendingAfterStop.progressiveSkillRouteEnforcement.decisions.Stop.hardEnforcement,
    false
  )
  assert.strictEqual(pendingAfterStop.progressiveSkillRouteStop?.nextOp, 'resolve_context_target')
  const pendingNextCall = pendingAfterStop.progressiveSkillRouteStop?.nextCall
  assert.strictEqual(pendingNextCall?.op, 'profile_context_plan')
  assert.strictEqual(
    pendingNextCall?.host,
    'codex-cli/exec-user-global-local-stdio'
  )
  assert.strictEqual(pendingNextCall?.explicitSkillId, 'audit-project')
  const pendingArgs = {
    intent: 'audit',
    changeTypes: ['testing'],
    contextEpoch: pendingState.contextAcquisition.contextEpoch,
    project: 'devcodex',
    host: pendingNextCall.host,
    explicitSkillId: pendingNextCall.explicitSkillId
  }
  const pendingCallId = 'pending-project-plan'
  run({
    hookEventName: 'PreToolUse',
    session_id: pendingSession,
    tool_use_id: pendingCallId,
    tool_name: 'mcp__devcodex-profile__profile_context_plan',
    tool_input: pendingArgs
  }, TEMP_ROOT, {
    DEVCODEX_HOST_PLATFORM: 'codex'
  })
  const pendingPlanResult = callProfileTool(TEMP_ROOT, 'profile_context_plan', pendingArgs)
  const pendingBootstrapText = pendingPlanResult.content?.[1]?.text || ''
  assert.match(pendingBootstrapText, /^### DevCodex · SkillRouteBootstrapV1/m)
  const pendingBootstrap = JSON.parse(pendingBootstrapText.split(/\r?\n/)[1])
  assert.strictEqual(
    pendingPlanResult._meta?.devcodexSkillRouteBootstrap?.source,
    'profile-context-plan-fallback'
  )
  assert.strictEqual(pendingPlanResult._meta.devcodexSkillRouteBootstrap.status, 'ready')
  assert.strictEqual(pendingBootstrap.explicitStatus, 'ready')
  assert.strictEqual(pendingBootstrap.explicitSkillId, 'audit-project')
  const reboundPost = run({
    hookEventName: 'PostToolUse',
    session_id: pendingSession,
    tool_use_id: pendingCallId,
    tool_name: 'mcp__devcodex-profile__profile_context_plan',
    tool_input: pendingArgs,
    tool_response: pendingPlanResult
  }, TEMP_ROOT, {
    DEVCODEX_HOST_PLATFORM: 'codex'
  })
  assert.doesNotMatch(reboundPost.systemMessage || '', /SkillRouteBootstrapV1/)
  const reboundState = JSON.parse(fs.readFileSync(getLayoutStateFile('devcodex'), 'utf8'))
  assert.strictEqual(reboundState.activeProject, 'devcodex')
  assert.strictEqual(reboundState.activeProjectSource, 'context-plan')
  assert.strictEqual(reboundState.contextAcquisition.targetResolved, true)
  assert.strictEqual(reboundState.contextAcquisition.project, 'devcodex')
  assert.strictEqual(reboundState.progressiveSkillRoute.bootstrap.project, 'devcodex')
  assert.strictEqual(reboundState.progressiveSkillRoute.bootstrap.turnBinding, pendingBootstrap.turnBinding)
  assert.strictEqual(reboundState.progressiveSkillRoute.bootstrap.bootstrapDigest, pendingBootstrap.bootstrapDigest)
  assert.strictEqual(reboundState.progressiveSkillRoute.bootstrap.explicitStatus, 'ready')
  assert.strictEqual(reboundState.progressiveSkillRoute.bootstrap.explicitSkillId, 'audit-project')
  assert(fs.existsSync(path.join(
    TEMP_ROOT,
    '.devcodex',
    'workspace',
    '.runtime-state',
    'projects',
    'devcodex',
    'skill-route',
    'turns',
    reboundState.progressiveSkillRoute.bootstrap.turnBinding,
    'route-envelope.json'
  )))
  assert.strictEqual(
    fs.existsSync(path.join(TEMP_ROOT, '.devcodex', path.basename(TEMP_ROOT))),
    false,
    'an unresolved workspace target must not create a synthetic project namespace'
  )

  // TaskRecoveryStoreV5: an ephemeral owner remains in the fixed A/B ring;
  // no per-session JSON file is created. A same-session stable projection may
  // still carry a newer MCP/SkillRoute observation into the next Hook boundary.
  const legacySessionsDir = path.join(path.dirname(getWorkspaceLayoutStateFile()), 'sessions')
  const newerActiveState = JSON.parse(fs.readFileSync(getLayoutStateFile('devcodex'), 'utf8'))
  const newerPlanId = newerActiveState.contextAcquisition.plan.planId
  newerActiveState.updatedAt = '2026-08-05T00:00:01.000Z'
  fs.writeFileSync(getLayoutStateFile('devcodex'), `${JSON.stringify(newerActiveState, null, 2)}\n`)
  run({
    hookEventName: 'PostToolUse',
    session_id: pendingSession,
    tool_use_id: 'same-session-newer-context-probe',
    tool_name: 'Read',
    tool_input: { file_path: path.join(TEMP_ROOT, 'devcodex', 'package.json') },
    tool_response: { ok: true }
  }, TEMP_ROOT, { DEVCODEX_HOST_PLATFORM: 'codex' })
  const reconciledActiveState = JSON.parse(fs.readFileSync(getLayoutStateFile('devcodex'), 'utf8'))
  assert.strictEqual(reconciledActiveState.contextAcquisition.plan.planId, newerPlanId)
  assert.strictEqual(fs.existsSync(legacySessionsDir), false)

  // A foreign projection must not be adopted for the fixed-ring owner. V5
  // fails closed to the bounded resume stub instead of reading another session.
  const foreignActiveState = JSON.parse(JSON.stringify(reconciledActiveState))
  foreignActiveState.updatedAt = '2030-08-05T00:00:00.000Z'
  foreignActiveState.contextAcquisition.hostSessionId = 'foreign-session'
  fs.writeFileSync(getLayoutStateFile('devcodex'), `${JSON.stringify(foreignActiveState, null, 2)}\n`)
  run({
    hookEventName: 'PostToolUse',
    session_id: pendingSession,
    tool_use_id: 'foreign-session-context-probe',
    tool_name: 'Read',
    tool_input: { file_path: path.join(TEMP_ROOT, 'devcodex', 'package.json') },
    tool_response: { ok: true }
  }, TEMP_ROOT, { DEVCODEX_HOST_PLATFORM: 'codex' })
  const activeAfterForeignState = JSON.parse(fs.readFileSync(getLayoutStateFile('devcodex'), 'utf8'))
  assert.strictEqual(activeAfterForeignState.contextAcquisition.hostSessionId, pendingSession)
  assert.notStrictEqual(activeAfterForeignState.contextAcquisition.hostSessionId, 'foreign-session')
  assert.strictEqual(fs.existsSync(legacySessionsDir), false)

  cleanState()

  // Screenshot regression: an ordinary chat turn still enters the unified
  // SkillRoute. `chat` describes the intent only; it is not a terminal path
  // that may bypass catalog/commit (including the valid null-skill choice).
  const ordinaryChatSession = 'ordinary-chat-skill-route'
  const ordinaryChatPrompt = run({
    hookEventName: 'UserPromptSubmit',
    session_id: ordinaryChatSession,
    prompt: '测试'
  }, TEMP_ROOT, {
    DEVCODEX_HOST_PLATFORM: 'codex'
  })
  assert.match(ordinaryChatPrompt.systemMessage || '', /SkillRouteBootstrapV1/)
  const ordinaryChatState = readLegacyState()
  assert.strictEqual(ordinaryChatState.contextAcquisition.targetResolved, true)
  assert.strictEqual(ordinaryChatState.progressiveSkillRoute.bootstrap.schemaVersion, 'SkillRouteBootstrapV1')
  assert.strictEqual(ordinaryChatState.progressiveSkillRoute.bootstrap.explicitStatus, 'none')
  assert.strictEqual(ordinaryChatState.progressiveSkillRoute.bootstrap.nextOp, 'catalog')

  cleanState()

  const promptOutput = run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Need a root cure for dev mode drift.'
  })
  assert.strictEqual(promptOutput.continue, true)
  assert.match(promptOutput.systemMessage || '', /PC0-PC7/)
  assert.match(promptOutput.systemMessage || '', /entry check/)
  assert.strictEqual(promptOutput.hookSpecificOutput?.hookEventName, 'UserPromptSubmit')
  assert.match(promptOutput.hookSpecificOutput?.additionalContext || '', /PC0-PC7/)
  assert.match(promptOutput.hookSpecificOutput?.additionalContext || '', /entry check/)

  const warningBeforeBootstrap = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: README.md\n*** End Patch'
    }
  })
  assert.strictEqual(warningBeforeBootstrap.continue, true)
  assert.match(warningBeforeBootstrap.systemMessage || '', /progressive-skill-route/i)

  const duplicateWarningBeforeBootstrap = run({
    hookEventName: 'PreToolUse',
    tool_name: 'run_in_terminal',
    tool_input: { command: 'npm test' }
  })
  assert.strictEqual(duplicateWarningBeforeBootstrap.continue, true)
  assert.match(duplicateWarningBeforeBootstrap.systemMessage || '', /progressive-skill-route/i)

  cleanState()
  const codexIngressSession = 'codex-workflow-ingress-authority'
  const codexIngressEnv = { DEVCODEX_HOST_PLATFORM: 'codex' }
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: codexIngressSession,
    prompt: 'Codex mutation requires a resolved workflow route.'
  }, TEMP_ROOT, codexIngressEnv)
  for (const payload of [
    {
      tool_name: 'apply_patch',
      tool_input: { input: '*** Begin Patch\n*** Update File: README.md\n*** End Patch' }
    },
    {
      tool_name: 'shell_command',
      tool_input: { command: 'Get-Content README.md; sc README.md "fixture"' }
    }
  ]) {
    const blockedCodexMutation = run({
      hookEventName: 'PreToolUse',
      session_id: codexIngressSession,
      ...payload
    }, TEMP_ROOT, codexIngressEnv)
    assert.strictEqual(blockedCodexMutation.hookSpecificOutput?.permissionDecision, 'deny')
    assert.strictEqual(blockedCodexMutation.hookSpecificOutput?.devcodexCode, 'WORKFLOW_ROUTE_UNRESOLVED')
    assert.match(blockedCodexMutation.systemMessage || '', /Workflow ingress authority unavailable/i)
  }

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'strict bootstrap gate test'
  }, TEMP_ROOT, { DEVCODEX_HOOK_ENFORCEMENT: 'strict' })
  const blockedBeforeBootstrap = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: README.md\n*** End Patch'
    }
  }, TEMP_ROOT, { DEVCODEX_HOOK_ENFORCEMENT: 'strict' })
  assert.strictEqual(blockedBeforeBootstrap.continue, true)
  assert.strictEqual(blockedBeforeBootstrap.hookSpecificOutput?.permissionDecision, 'deny')
  assert.match(
    blockedBeforeBootstrap.hookSpecificOutput?.additionalContext || '',
    /Next call \(exact\):/
  )
  assert.match(blockedBeforeBootstrap.systemMessage || '', /progressive-skill-route/i)

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'strict structured context gate test'
  }, TEMP_ROOT, { DEVCODEX_HOOK_ENFORCEMENT: 'strict', CLAUDE_CODE_VERSION: 'test' })
  const structuredBlockedBeforePlan = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: README.md\n*** End Patch'
    }
  }, TEMP_ROOT, { DEVCODEX_HOOK_ENFORCEMENT: 'strict', CLAUDE_CODE_VERSION: 'test' })
  assert.strictEqual(structuredBlockedBeforePlan.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(
    structuredBlockedBeforePlan.hookSpecificOutput.permissionDecisionReason || '',
    /progressive-skill-route/i
  )

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Need a root cure for dev mode drift.'
  })

  const sourceReadAllowedDuringBootstrap = run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: {
      filePath: 'package.json'
    }
  })
  assert.strictEqual(sourceReadAllowedDuringBootstrap.continue, true)

  const questionAllowedDuringBootstrap = run({
    hookEventName: 'PreToolUse',
    tool_name: 'vscode_askQuestions',
    tool_input: {
      questions: [{ header: '目标项目', question: '审查哪个项目？' }]
    }
  })
  assert.strictEqual(questionAllowedDuringBootstrap.continue, true)

  const shellReadAllowedDuringBootstrap = run({
    hookEventName: 'PreToolUse',
    tool_name: 'shell_command',
    tool_input: {
      command: 'Get-Content .devcodex/profile/config.json'
    }
  })
  assert.strictEqual(shellReadAllowedDuringBootstrap.continue, true)

  cleanState({ mode: 'prod', agent: TEST_AGENT })
  const prodPromptOutput = run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Explain current workflow.'
  })
  assert.strictEqual(prodPromptOutput.continue, true)
  assert.match(prodPromptOutput.systemMessage || '', /entry check PC0-PC7/)
  const prodWriteWarningBeforeBootstrap = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: README.md\n*** End Patch'
    }
  })
  assert.strictEqual(prodWriteWarningBeforeBootstrap.continue, true)
  assert.match(prodWriteWarningBeforeBootstrap.systemMessage || '', /progressive-skill-route/i)

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Need a root cure for dev mode drift.'
  })

  const shellWriteWarningDuringBootstrap = run({
    hookEventName: 'PreToolUse',
    tool_name: 'shell_command',
    tool_input: {
      command: 'Set-Content .devcodex/profile/config.json "{}"'
    }
  })
  assert.strictEqual(shellWriteWarningDuringBootstrap.continue, true)
  assert.match(shellWriteWarningDuringBootstrap.systemMessage || '', /progressive-skill-route/i)

  const shellAliasWriteWarningDuringBootstrap = run({
    hookEventName: 'PreToolUse',
    tool_name: 'shell_command',
    tool_input: {
      command: 'Get-Content .devcodex/profile/config.json; sc .devcodex/profile/config.json "{}"'
    }
  })
  assert.strictEqual(shellAliasWriteWarningDuringBootstrap.continue, true)
  assert.match(
    shellAliasWriteWarningDuringBootstrap.systemMessage || '',
    /progressive-skill-route/i
  )

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
  assert.strictEqual(wrongAgentSummary.continue, true)

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
  assert.strictEqual(state.bootstrapComplete, false, 'legacy PreToolUse path touches must never form completion')
  assert.deepStrictEqual(state.contextAcquisition.legacyObserved, {
    profileRead: false,
    summaryRead: false,
    tasksRead: false,
    bootstrapComplete: false
  }, 'unbound raw-file reads must not be credited as ContextRead progress')

  cleanState()
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    version: 1,
    mode: 'dev',
    phase: 'active',
    activeProject: '',
    activeScope: 'project',
    bootstrap: { profileRead: true, summaryRead: true, tasksRead: true },
    bootstrapComplete: true
  }, null, 2))
  run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: { filePath: 'src/legacy-state.js' }
  })
  const normalizedLegacyState = readLegacyState()
  assert.strictEqual(normalizedLegacyState.version, 2)
  assert.strictEqual(normalizedLegacyState.bootstrapComplete, false)
  assert.deepStrictEqual(normalizedLegacyState.contextAcquisition.legacyObserved, {
    profileRead: true,
    summaryRead: true,
    tasksRead: true,
    bootstrapComplete: false
  })

  cleanState()
  run({ hookEventName: 'UserPromptSubmit', prompt: 'legacy no-arg profile compatibility' })
  const legacyProfilePre = run({
    hookEventName: 'PreToolUse',
    tool_use_id: 'legacy-profile-load',
    tool_name: 'devcodex-profile/profile_load',
    tool_input: {}
  })
  assert.match(legacyProfilePre.systemMessage || '', /progressive-skill-route/i)
  const legacyProfileResult = callProfileTool(TEMP_ROOT, 'profile_load', {
    explicitFull: true,
    fullReadReason: 'hooks bootstrap legacy full-read fixture',
    maxBytes: 500000
  })
  run({
    hookEventName: 'PostToolUse',
    tool_use_id: 'legacy-profile-load',
    tool_name: 'devcodex-profile/profile_load',
    tool_input: {},
    tool_response: legacyProfileResult
  })
  const legacyProfileState = readLegacyState()
  assert.strictEqual(legacyProfileState.contextAcquisition.plan, null)
  assert.strictEqual(legacyProfileState.contextAcquisition.fallbackAttempts, 0)
  assert.strictEqual(legacyProfileState.bootstrapComplete, false)

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
  assert.strictEqual(wrongFallbackSummary.continue, true)
  runBootstrapReads(FALLBACK_BOOTSTRAP_AGENT)
  const fallbackState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(fallbackState.bootstrapComplete, true)
  assert.strictEqual(
    path.resolve(fallbackState.contextAcquisition.activeRoot),
    path.resolve(TEMP_ROOT, '.devcodex'),
    'legacy ContextReadPlan must bind to the physical project root exactly once'
  )

  // A2: every prompt receives one opaque epoch and a bounded handoff; prompt
  // content is never encoded into the identifier or context message.
  cleanState()
  const epochPrompt = run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'EPOCH-PROMPT-CONTENT-MUST-NOT-BE-ENCODED'
  })
  const firstEpochState = readLegacyState()
  assert.match(firstEpochState.contextAcquisition.contextEpoch, /^ctx-[0-9a-f-]+$/i)
  assert.match(epochPrompt.systemMessage || '', new RegExp(firstEpochState.contextAcquisition.contextEpoch))
  assert.doesNotMatch(epochPrompt.systemMessage || '', /EPOCH-PROMPT-CONTENT-MUST-NOT-BE-ENCODED/)
  run({ hookEventName: 'UserPromptSubmit', prompt: 'next epoch' })
  const secondEpochState = readLegacyState()
  assert.notStrictEqual(secondEpochState.contextAcquisition.contextEpoch, firstEpochState.contextAcquisition.contextEpoch)
  assert.strictEqual(secondEpochState.contextAcquisition.handoff.contextEpoch, firstEpochState.contextAcquisition.contextEpoch)

  // Exact acquisition allowlist: the real plan call is permitted before a
  // plan exists, while write tools, spoofed servers, and traversal are not.
  cleanState()
  run({ hookEventName: 'UserPromptSubmit', prompt: 'allowlist probe' }, TEMP_ROOT, {
    DEVCODEX_HOOK_ENFORCEMENT: 'strict', CLAUDE_CODE_VERSION: 'test'
  })
  const allowlistState = readLegacyState()
  const allowedPlanPre = run({
    hookEventName: 'PreToolUse',
    tool_use_id: 'allow-plan',
    tool_name: 'mcp__devcodex-profile__profile_context_plan',
    tool_input: {
      intent: 'chat',
      contextEpoch: allowlistState.contextAcquisition.contextEpoch,
      project: allowlistState.contextAcquisition.project
    }
  }, TEMP_ROOT, { DEVCODEX_HOOK_ENFORCEMENT: 'strict', CLAUDE_CODE_VERSION: 'test' })
  assert.ok(!allowedPlanPre.hookSpecificOutput?.permissionDecision)
  assert.strictEqual(readLegacyState().contextAcquisition.inFlight.length, 1)
  const blockedMemoryWrite = run({
    hookEventName: 'PreToolUse',
    tool_name: 'mcp__devcodex-memory__memory_summary_append',
    tool_input: { row: '| unsafe acquisition bypass |' }
  }, TEMP_ROOT, { DEVCODEX_HOOK_ENFORCEMENT: 'strict', CLAUDE_CODE_VERSION: 'test' })
  assert.strictEqual(blockedMemoryWrite.hookSpecificOutput.permissionDecision, 'deny')
  assert.strictEqual(readLegacyState().contextAcquisition.inFlight.length, 1)
  for (const spoofedTool of [
    'mcp__evil__profile_context_plan',
    'mcp__evil__memory_status',
    'mcp__evil__skill_route'
  ]) {
    const blockedSpoof = run({
      hookEventName: 'PreToolUse',
      tool_name: spoofedTool,
      tool_input: { contextEpoch: allowlistState.contextAcquisition.contextEpoch }
    }, TEMP_ROOT, { DEVCODEX_HOOK_ENFORCEMENT: 'strict', CLAUDE_CODE_VERSION: 'test' })
    assert.strictEqual(
      blockedSpoof.hookSpecificOutput?.permissionDecision,
      'deny',
      `${spoofedTool}: ${JSON.stringify(blockedSpoof)}`
    )
  }
  const blockedTraversal = run({
    hookEventName: 'PreToolUse',
    tool_name: 'devcodex-profile/profile_load',
    tool_input: { project: allowlistState.contextAcquisition.project, files: ['../01-项目信息.md'] }
  }, TEMP_ROOT, { DEVCODEX_HOOK_ENFORCEMENT: 'strict', CLAUDE_CODE_VERSION: 'test' })
  assert.strictEqual(blockedTraversal.hookSpecificOutput.permissionDecision, 'deny')

  // Grok can truncate a successful MCP result before PostToolUse. Recover only
  // from the exact, current workspace observation written by the planner.
  cleanState()
  run({ hookEventName: 'UserPromptSubmit', prompt: 'truncated plan observation' })
  const truncatedState = readLegacyState()
  const truncatedArgs = {
    intent: 'dev',
    changeTypes: ['source-code'],
    contextEpoch: truncatedState.contextAcquisition.contextEpoch,
    project: truncatedState.contextAcquisition.project
  }
  run({
    hookEventName: 'PreToolUse',
    tool_use_id: 'truncated-plan',
    tool_name: 'devcodex-profile/profile_context_plan',
    tool_input: truncatedArgs
  })
  const fullPlanResult = callProfileTool(TEMP_ROOT, 'profile_context_plan', truncatedArgs)
  const fullPlanText = fullPlanResult.content[0].text
  const truncatedPlanText = fullPlanText.slice(0, Math.min(20 * 1024, fullPlanText.length - 1))
  assert.throws(() => JSON.parse(truncatedPlanText))
  run({
    hookEventName: 'PostToolUse',
    tool_use_id: 'truncated-plan',
    tool_name: 'devcodex-profile/profile_context_plan',
    tool_input: truncatedArgs,
    tool_response: truncatedPlanText
  })
  const recoveredPlanState = readLegacyState()
  assert.strictEqual(recoveredPlanState.contextAcquisition.plan.schemaVersion, 'ContextReadPlanV2')
  assert.strictEqual(recoveredPlanState.contextAcquisition.verificationMode, 'structured-plan')
  assert(
    recoveredPlanState.contextAcquisition.stageTiming.hostDeliveredBytes <
      recoveredPlanState.contextAcquisition.stageTiming.plannerResponseBytes
  )
  for (const [toolName, toolInput] of [
    ['search_tool', { query: 'profile_load', limit: 5 }],
    ['run_terminal_command', { command: 'Get-Content package.json', description: 'Read package metadata' }],
    ['devcodex-profile/skill_route', {
      op: 'catalog',
      project: recoveredPlanState.contextAcquisition.project,
      turnBinding: 'turn-hook-route-control',
      contextEpoch: recoveredPlanState.contextAcquisition.contextEpoch
    }]
  ]) {
    const callId = `grok-read-${toolName}`
    run({
      hookEventName: 'PreToolUse',
      tool_use_id: callId,
      tool_name: toolName,
      tool_input: toolInput
    })
    run({
      hookEventName: 'PostToolUse',
      tool_use_id: callId,
      tool_name: toolName,
      tool_input: toolInput,
      tool_response: { success: true }
    })
    assert.notStrictEqual(readLegacyState().contextAcquisition.receipt.status, 'stale')
  }

  for (const invalidObservation of ['stale', 'epoch', 'digest']) {
    cleanState()
    run({ hookEventName: 'UserPromptSubmit', prompt: `invalid ${invalidObservation} plan observation` })
    const state = readLegacyState()
    const args = {
      intent: 'chat',
      contextEpoch: state.contextAcquisition.contextEpoch,
      project: state.contextAcquisition.project
    }
    run({
      hookEventName: 'PreToolUse',
      tool_use_id: `invalid-observation-${invalidObservation}`,
      tool_name: 'devcodex-profile/profile_context_plan',
      tool_input: args
    })
    const result = callProfileTool(TEMP_ROOT, 'profile_context_plan', args)
    const observationPath = path.join(
      resolveRuntimeStateRoot(state.contextAcquisition.activeRoot, state.contextAcquisition.project).root,
      contextPlanObservationRelativePath(args.contextEpoch)
    )
    const observation = JSON.parse(fs.readFileSync(observationPath, 'utf8'))
    if (invalidObservation === 'stale') observation.observedAt = '2000-01-01T00:00:00.000Z'
    if (invalidObservation === 'epoch') observation.contextEpoch = 'ctx-wrong-observation'
    if (invalidObservation === 'digest') observation.planDigest = '0'.repeat(64)
    fs.writeFileSync(observationPath, JSON.stringify(observation, null, 2) + '\n', 'utf8')
    const text = result.content[0].text
    run({
      hookEventName: 'PostToolUse',
      tool_use_id: `invalid-observation-${invalidObservation}`,
      tool_name: 'devcodex-profile/profile_context_plan',
      tool_input: args,
      tool_response: text.slice(0, text.length - 1)
    })
    const invalidState = readLegacyState()
    assert.strictEqual(invalidState.contextAcquisition.plan, null)
    assert.strictEqual(invalidState.contextAcquisition.fallbackActive, true)
    assert.strictEqual(invalidState.contextAcquisition.targetResolved, state.contextAcquisition.targetResolved)
    assert.strictEqual(invalidState.contextAcquisition.activeRoot, state.contextAcquisition.activeRoot)
    assert.strictEqual(invalidState.contextAcquisition.project, state.contextAcquisition.project)
    assert(invalidState.contextAcquisition.failedPlanKeys.length > 0)
    assert.match(invalidState.contextAcquisition.lastError.message, /no matching exact workspace observation/i)
  }

  // Plan ingestion accepts host result variants, verifies the full identity,
  // and Profile aggregate reads satisfy each selected source independently.
  cleanState()
  run({ hookEventName: 'UserPromptSubmit', session_id: 'context-session-1', prompt: 'dev source change plan' })
  let planned = observePlan({ intent: 'dev', changeTypes: ['source-code'], resultField: 'toolResponse' }).state
  assert.strictEqual(planned.contextAcquisition.plan.schemaVersion, 'ContextReadPlanV2')
  assert.strictEqual(planned.contextAcquisition.verificationMode, 'structured-plan')
  assert.deepStrictEqual(planned.contextAcquisition.plan.profile.selectedFiles,
    ['01-项目信息.md', '02-架构约束.md', '03-代码风格.md'])
  assert(planned.contextAcquisition.receipt.satisfiedSourceIds.includes('profile:README.md'))
  assert(planned.contextAcquisition.receipt.satisfiedSourceIds.includes('profile:config.json'))

  const profileArgs = {
    project: planned.contextAcquisition.project,
    files: planned.contextAcquisition.plan.profile.selectedFiles
  }
  run({
    hookEventName: 'PreToolUse',
    tool_use_id: 'profile-load-call',
    tool_name: 'devcodex-profile/profile_load',
    tool_input: profileArgs
  })
  const profileResult = callProfileTool(TEMP_ROOT, 'profile_load', profileArgs)
  run({
    hookEventName: 'PostToolUse',
    tool_use_id: 'profile-load-call',
    tool_name: 'devcodex-profile/profile_load',
    tool_input: profileArgs,
    tool_response: profileResult
  })
  let profileObserved = readLegacyState()
  assert(profileObserved.contextAcquisition.receipt.satisfiedSourceIds.includes('profile:01-项目信息.md'))
  assert(profileObserved.contextAcquisition.receipt.satisfiedSourceIds.includes('profile:02-架构约束.md'))
  assert(profileObserved.contextAcquisition.receipt.satisfiedSourceIds.includes('profile:03-代码风格.md'))
  assert.deepStrictEqual(profileObserved.contextAcquisition.receipt.missingSourceIds, ['memory:memory_status'])
  profileObserved = observeMemoryStatus()
  assert.strictEqual(profileObserved.contextAcquisition.receipt.schemaVersion, 'ContextReadReceiptV2')
  assert.strictEqual(profileObserved.contextAcquisition.receipt.status, 'relevant-complete')
  assert.strictEqual(profileObserved.contextAcquisition.receipt.sourceIdentities.length,
    profileObserved.contextAcquisition.plan.mandatorySourceIds.length)
  assert.strictEqual(profileObserved.contextAcquisition.receipt.delivery.bodyObserved, true)
  assert.strictEqual(profileObserved.contextAcquisition.receipt.delivery.eligible, true)
  assert.strictEqual(profileObserved.contextAcquisition.receipt.delivery.reused, false)
  assert.strictEqual(profileObserved.contextAcquisition.receipt.delivery.hostSessionId, 'context-session-1')
  assert.strictEqual(profileObserved.contextAcquisition.stageTiming.schemaVersion, 'StageTimingV1')
  assert(Number.isFinite(profileObserved.contextAcquisition.stageTiming.plannerResponseBytes))
  assert(Number.isFinite(profileObserved.contextAcquisition.stageTiming.returnedBodyBytes))
  assert(Number.isFinite(profileObserved.contextAcquisition.stageTiming.hostDeliveredBytes))
  assert(profileObserved.contextAcquisition.stageTiming.hostDeliveredBytes > 0)
  assert.strictEqual(profileObserved.bootstrapComplete, true)

  const planCountBeforeCompatibleRead = profileObserved.contextAcquisition.planCallCount
  run({
    hookEventName: 'PreToolUse',
    tool_use_id: 'compatible-read',
    tool_name: 'read_file',
    tool_input: { filePath: 'src/index.js' }
  })
  let compatibleState = readLegacyState()
  assert.strictEqual(compatibleState.contextAcquisition.planCallCount, planCountBeforeCompatibleRead)
  assert.strictEqual(compatibleState.contextAcquisition.receipt.status, 'relevant-complete')

  run({
    hookEventName: 'PreToolUse',
    tool_use_id: 'codex-composite-read',
    tool_name: 'exec_command',
    tool_input: {
      cmd: 'rg -n "ContextRead" hooks/_runtime | Select-Object -First 20; git status --short'
    }
  })
  const compositeReadState = readLegacyState()
  assert.notStrictEqual(
    compositeReadState.contextAcquisition.receipt.status,
    'stale',
    'bounded composite Codex read commands must remain analysis-read'
  )

  const closeoutReport = path.join(TEMP_ROOT, '.devcodex', 'reports', 'context-closeout.md')
  run({
    hookEventName: 'PostToolUse',
    tool_use_id: 'workflow-closeout-write',
    tool_name: 'Write',
    tool_input: { file_path: closeoutReport, content: '# Closeout\n' },
    success: true,
    tool_response: { content: [{ type: 'text', text: 'updated' }] }
  })
  const closeoutState = readLegacyState()
  assert.strictEqual(closeoutState.contextAcquisition.receipt.status, 'relevant-complete')
  assert.strictEqual(closeoutState.contextAcquisition.sourceRefreshPending.required, true)
  assert.strictEqual(closeoutState.contextAcquisition.sourceRefreshPending.actionClass, 'workflow-closeout')

  const selectedProfilePath = compatibleState.contextAcquisition.plan.selectedSources
    .find(source => source.sourceId === 'profile:01-项目信息.md').sourceRefs[0].path
  run({
    hookEventName: 'PostToolUse',
    tool_use_id: 'selected-profile-mutation',
    tool_name: 'Edit',
    tool_input: { file_path: selectedProfilePath, old_string: 'before', new_string: 'after' },
    success: true,
    tool_response: { content: [{ type: 'text', text: 'updated' }] }
  })
  const sourceStaleState = readLegacyState()
  assert.strictEqual(sourceStaleState.contextAcquisition.receipt.status, 'stale')
  assert.strictEqual(sourceStaleState.contextAcquisition.receipt.delivery.eligible, false)
  assert(sourceStaleState.contextAcquisition.receipt.escalations.some(item => item.trigger === 'source-digest'))

  // A committed route may refresh the same ContextRead inputs once before
  // rebind. The refresh must replace its stale receipt with a fresh observed
  // plan; ordinary duplicate planners remain denied outside this boundary.
  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'route-context-rebind-session',
    prompt: 'route context rebind lifecycle regression'
  })
  let routeRefreshState = observePlan({
    intent: 'dev',
    changeTypes: ['source-code'],
    callId: 'route-context-rebind-initial-plan'
  }).state
  routeRefreshState = observeProfileLoad('route-context-rebind-initial-profile')
  routeRefreshState = observeMemoryStatus('route-context-rebind-initial-memory')
  assert.strictEqual(routeRefreshState.contextAcquisition.receipt.status, 'relevant-complete')
  const uncompletedCommit = completeCurrentSkillRoute({ loadStages: false })
  assert(uncompletedCommit.receipt.obligations.requiredStageIds.length > 0)
  const refreshPlanCount = routeRefreshState.contextAcquisition.planCallCount
  routeRefreshState = observePlan({
    intent: 'dev',
    changeTypes: ['source-code'],
    callId: 'route-context-rebind-refresh-plan'
  }).state
  assert.strictEqual(routeRefreshState.contextAcquisition.planCallCount, refreshPlanCount + 1)
  assert.strictEqual(routeRefreshState.contextAcquisition.replanCount, 1)
  assert.notStrictEqual(routeRefreshState.contextAcquisition.receipt.status, 'stale')
  assert.strictEqual(routeRefreshState.contextAcquisition.lastError, null)

  cleanState()
  run({ hookEventName: 'UserPromptSubmit', session_id: 'context-session-1', prompt: 'release scope expansion' })
  observePlan({ intent: 'chat' })
  const releaseReady = observeMemoryStatus('release-memory-status')
  assert.strictEqual(releaseReady.contextAcquisition.receipt.status, 'relevant-complete')
  completeCurrentSkillRoute()

  const releaseExpansion = run({
    hookEventName: 'PreToolUse',
    tool_use_id: 'release-expansion',
    tool_name: 'shell_command',
    tool_input: { command: 'npm publish --dry-run' }
  })
  assert.match(releaseExpansion.systemMessage || '', /context evidence/i)
  let staleState = readLegacyState()
  assert.strictEqual(staleState.contextAcquisition.receipt.status, 'stale')
  assert.strictEqual(staleState.contextAcquisition.replanCount, 1)
  run({
    hookEventName: 'PreToolUse',
    tool_use_id: 'release-expansion-repeat',
    tool_name: 'shell_command',
    tool_input: { command: 'npm publish --dry-run' }
  })
  staleState = readLegacyState()
  assert.strictEqual(staleState.contextAcquisition.replanCount, 1, 'scope drift must not create a replan loop')
  const priorEpoch = staleState.contextAcquisition.contextEpoch
  const priorContentId = staleState.contextAcquisition.plan.planContentId
  run({ hookEventName: 'UserPromptSubmit', session_id: 'context-session-1', prompt: 'new epoch delivery probe' })
  const nextEpochState = readLegacyState()
  assert.notStrictEqual(nextEpochState.contextAcquisition.contextEpoch, priorEpoch)
  assert.strictEqual(nextEpochState.contextAcquisition.plan, null)
  assert.strictEqual(nextEpochState.contextAcquisition.receipt, null,
    'a new epoch must never inherit a body-observed completion receipt')
  assert.strictEqual(nextEpochState.contextAcquisition.handoff.planContentId, priorContentId)

  // Aggregate transport success is insufficient: removing one section leaves
  // that source missing while the other valid sections remain independently satisfied.
  cleanState()
  run({ hookEventName: 'UserPromptSubmit', prompt: 'partial profile evidence' })
  planned = observePlan({ intent: 'dev', changeTypes: ['source-code'] }).state
  const partialArgs = {
    project: planned.contextAcquisition.project,
    files: planned.contextAcquisition.plan.profile.selectedFiles
  }
  run({
    hookEventName: 'PreToolUse',
    tool_use_id: 'partial-profile',
    tool_name: 'devcodex-profile/profile_load',
    tool_input: partialArgs
  })
  const partialResult = callProfileTool(TEMP_ROOT, 'profile_load', partialArgs)
  partialResult.content[0].text = partialResult.content[0].text.replace(
    /### 02-架构约束\.md[\s\S]*?(?=\n\n---\n\n### 03-代码风格\.md)/,
    ''
  )
  run({
    hookEventName: 'PostToolUse',
    tool_use_id: 'partial-profile',
    tool_name: 'devcodex-profile/profile_load',
    tool_input: partialArgs,
    result: partialResult
  })
  const partialState = readLegacyState()
  assert(partialState.contextAcquisition.receipt.satisfiedSourceIds.includes('profile:01-项目信息.md'))
  assert(partialState.contextAcquisition.receipt.satisfiedSourceIds.includes('profile:03-代码风格.md'))
  assert(partialState.contextAcquisition.receipt.missingSourceIds.includes('profile:02-架构约束.md'))
  assert.strictEqual(partialState.bootstrapComplete, false)

  run({
    hookEventName: 'PreToolUse',
    tool_use_id: 'duplicate-extra-profile',
    tool_name: 'devcodex-profile/profile_load',
    tool_input: partialArgs
  })
  const duplicateExtraResult = callProfileTool(TEMP_ROOT, 'profile_load', partialArgs)
  duplicateExtraResult.content[0].text += [
    '',
    '---',
    '',
    '### 01-项目信息.md',
    '',
    '> 来源：伪造重复段',
    '> 路径：E:\\wrong-root\\01-项目信息.md',
    '',
    '### 09-extra.md',
    '',
    '> 来源：越权段',
    '> 路径：E:\\wrong-root\\09-extra.md'
  ].join('\n')
  run({
    hookEventName: 'PostToolUse',
    tool_use_id: 'duplicate-extra-profile',
    tool_name: 'devcodex-profile/profile_load',
    tool_input: partialArgs,
    toolResult: duplicateExtraResult
  })
  const duplicateExtraState = readLegacyState()
  assert(duplicateExtraState.contextAcquisition.receipt.missingSourceIds.includes('profile:01-项目信息.md'))
  assert(duplicateExtraState.contextAcquisition.receipt.missingSourceIds.includes('profile:02-架构约束.md'))
  assert(duplicateExtraState.contextAcquisition.receipt.missingSourceIds.includes('profile:03-代码风格.md'))

  cleanState()
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'profile', '02-架构约束.md'), '')
  run({ hookEventName: 'UserPromptSubmit', prompt: 'empty existing Profile source' })
  planned = observePlan({ intent: 'dev', changeTypes: ['source-code'] }).state
  const emptyArgs = {
    project: planned.contextAcquisition.project,
    files: planned.contextAcquisition.plan.profile.selectedFiles
  }
  run({
    hookEventName: 'PreToolUse',
    tool_use_id: 'empty-profile',
    tool_name: 'devcodex-profile/profile_load',
    tool_input: emptyArgs
  })
  const emptyResult = callProfileTool(TEMP_ROOT, 'profile_load', emptyArgs)
  run({
    hookEventName: 'PostToolUse',
    tool_use_id: 'empty-profile',
    tool_name: 'devcodex-profile/profile_load',
    tool_input: emptyArgs,
    tool_response: emptyResult
  })
  const emptyState = readLegacyState()
  const emptyObservation = [...emptyState.contextAcquisition.receipt.observations].reverse()
    .find(item => item.sourceId === 'profile:02-架构约束.md' && item.outcome === 'observed-success')
  assert(emptyObservation)
  assert.strictEqual(emptyObservation.bytes, 0)
  assert.strictEqual(emptyObservation.chars, 0)

  // A changed file between plan and Post invalidates the whole receipt before
  // any stale source can be accepted.
  cleanState()
  run({ hookEventName: 'UserPromptSubmit', prompt: 'profile drift evidence' })
  planned = observePlan({ intent: 'dev', changeTypes: ['source-code'] }).state
  const driftArgs = {
    project: planned.contextAcquisition.project,
    files: planned.contextAcquisition.plan.profile.selectedFiles
  }
  run({
    hookEventName: 'PreToolUse',
    tool_use_id: 'drift-profile',
    tool_name: 'devcodex-profile/profile_load',
    tool_input: driftArgs
  })
  const driftResult = callProfileTool(TEMP_ROOT, 'profile_load', driftArgs)
  fs.appendFileSync(path.join(TEMP_ROOT, '.devcodex', 'profile', '02-架构约束.md'), '\nDRIFT-AFTER-PLAN\n')
  run({
    hookEventName: 'PostToolUse',
    tool_use_id: 'drift-profile',
    tool_name: 'devcodex-profile/profile_load',
    tool_input: driftArgs,
    toolResponse: driftResult
  })
  const driftState = readLegacyState()
  assert.strictEqual(driftState.contextAcquisition.receipt.status, 'stale')
  assert.strictEqual(driftState.contextAcquisition.replanCount, 1)

  // A success flag without a result body cannot install a plan; retrying the
  // same failed call is suppressed and fallback activation stays bounded.
  cleanState()
  run({ hookEventName: 'UserPromptSubmit', prompt: 'unobservable plan result' })
  const failedPlanState = readLegacyState()
  const failedArgs = {
    intent: 'chat',
    contextEpoch: failedPlanState.contextAcquisition.contextEpoch,
    project: failedPlanState.contextAcquisition.project
  }
  run({
    hookEventName: 'PreToolUse',
    tool_use_id: 'failed-plan',
    tool_name: 'devcodex-profile/profile_context_plan',
    tool_input: failedArgs
  })
  run({
    hookEventName: 'PostToolUse',
    tool_use_id: 'failed-plan',
    tool_name: 'devcodex-profile/profile_context_plan',
    tool_input: failedArgs,
    success: true
  })
  let unobservableState = readLegacyState()
  assert.strictEqual(unobservableState.contextAcquisition.plan, null)
  assert.strictEqual(unobservableState.contextAcquisition.fallbackAttempts, 1)
  assert.strictEqual(unobservableState.contextAcquisition.planCallCount, 1)
  run({
    hookEventName: 'PreToolUse',
    tool_use_id: 'failed-plan-retry',
    tool_name: 'devcodex-profile/profile_context_plan',
    tool_input: failedArgs
  })
  unobservableState = readLegacyState()
  assert.strictEqual(unobservableState.contextAcquisition.planCallCount, 1)
  assert.strictEqual(unobservableState.contextAcquisition.fallbackAttempts, 1)

  for (const identityMutation of ['epoch', 'root', 'planId']) {
    cleanState()
    run({ hookEventName: 'UserPromptSubmit', prompt: `mismatched ${identityMutation} plan` })
    const mismatched = observePlan({
      callId: `mismatch-${identityMutation}`,
      mutateResult: result => mutatePlanResult(result, plan => {
        if (identityMutation === 'epoch') {
          plan.identity.contextEpoch = 'ctx-other-epoch'
          plan.identity.intentSeed.contextEpoch = 'ctx-other-epoch'
        } else if (identityMutation === 'root') {
          plan.identity.activeRoot = `${plan.identity.activeRoot}-other`
        } else {
          plan.planId = 'plan-forged'
        }
      }, { recomputePlanId: identityMutation !== 'planId' })
    }).state
    assert.strictEqual(mismatched.contextAcquisition.plan, null, `${identityMutation} mismatch must not install a plan`)
    assert.strictEqual(mismatched.contextAcquisition.fallbackAttempts, 1)
    assert.strictEqual(mismatched.bootstrapComplete, false)
  }

  // Duplicate Post is idempotent only when the digest matches. Conflicting
  // evidence drops structured completion instead of trusting the latest body.
  cleanState()
  run({ hookEventName: 'UserPromptSubmit', prompt: 'duplicate post evidence' })
  const duplicatePlan = observePlan({ callId: 'duplicate-plan' })
  const duplicateBefore = duplicatePlan.state.contextAcquisition.receipt.observations.length
  run({
    hookEventName: 'PostToolUse',
    tool_use_id: 'duplicate-plan',
    tool_name: 'mcp__devcodex-profile__profile_context_plan',
    tool_input: duplicatePlan.args,
    tool_response: duplicatePlan.result
  })
  let duplicateState = readLegacyState()
  assert.strictEqual(duplicateState.contextAcquisition.receipt.observations.length, duplicateBefore)
  run({
    hookEventName: 'PostToolUse',
    tool_use_id: 'duplicate-plan',
    tool_name: 'mcp__devcodex-profile__profile_context_plan',
    tool_input: duplicatePlan.args,
    tool_response: { content: [{ type: 'text', text: '{"schemaVersion":"MemoryStatusV1"}' }] }
  })
  duplicateState = readLegacyState()
  assert.notStrictEqual(duplicateState.contextAcquisition.verificationMode, 'structured-plan')
  assert.strictEqual(duplicateState.bootstrapComplete, false)

  // Missing tool-call IDs are accepted only for one unique same-tool in-flight
  // attempt. Two candidates remain unverified instead of using "latest".
  cleanState()
  run({ hookEventName: 'UserPromptSubmit', prompt: 'ambiguous correlation' })
  const ambiguousBase = readLegacyState()
  const ambiguousArgs = {
    intent: 'chat',
    contextEpoch: ambiguousBase.contextAcquisition.contextEpoch,
    project: ambiguousBase.contextAcquisition.project
  }
  for (let index = 0; index < 2; index += 1) {
    run({
      hookEventName: 'PreToolUse',
      tool_name: 'devcodex-profile/profile_context_plan',
      tool_input: ambiguousArgs
    })
  }
  const ambiguousResult = callProfileTool(TEMP_ROOT, 'profile_context_plan', ambiguousArgs)
  run({
    hookEventName: 'PostToolUse',
    tool_name: 'devcodex-profile/profile_context_plan',
    tool_input: ambiguousArgs,
    tool_result: ambiguousResult
  })
  const ambiguousState = readLegacyState()
  assert.strictEqual(ambiguousState.contextAcquisition.plan, null)
  assert.match(ambiguousState.contextAcquisition.lastError.message, /multiple in-flight/i)

  // Memory discriminator/target checks are source-specific; a malformed result
  // cannot complete the plan, while a later correctly correlated call can.
  cleanState()
  run({ hookEventName: 'UserPromptSubmit', prompt: 'memory schema evidence' })
  observePlan()
  let memoryState = observeMemoryStatus('wrong-memory-schema', { schemaVersion: 'MemorySummaryQueryV1' })
  assert.strictEqual(memoryState.bootstrapComplete, false)
  assert(memoryState.contextAcquisition.receipt.missingSourceIds.includes('memory:memory_status'))
  memoryState = observeMemoryStatus('wrong-memory-target', { project: 'other-project' })
  assert.strictEqual(memoryState.bootstrapComplete, false)
  assert(memoryState.contextAcquisition.receipt.missingSourceIds.includes('memory:memory_status'))
  memoryState = observeMemoryStatus('partial-memory-coverage', { coverage: { status: 'partial' } })
  assert.strictEqual(memoryState.bootstrapComplete, false)
  assert.strictEqual(memoryState.contextAcquisition.lastError.errorCode, 'MEMORY_COVERAGE_PARTIAL')
  assert(memoryState.contextAcquisition.receipt.missingSourceIds.includes('memory:memory_status'))
  memoryState = observeMemoryStatus('correct-memory-schema')
  assert.strictEqual(memoryState.bootstrapComplete, true)
  completeCurrentSkillRoute()
  run({
    hookEventName: 'PreToolUse',
    tool_use_id: 'chat-to-source-mutation',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/chat-drift.js\n*** End Patch' }
  })
  let chatDriftState = readLegacyState()
  assert.strictEqual(
    chatDriftState.contextAcquisition.receipt.status,
    'relevant-complete',
    'a planned or blocked mutation that has not touched a selected source must not invalidate observed context'
  )
  assert.strictEqual(chatDriftState.contextAcquisition.replanCount, 0)
  const selectedSourcePath = chatDriftState.contextAcquisition.plan.selectedSources
    .filter(source => source.kind !== 'memory')
    .flatMap(source => source.sourceRefs || [])
    .find(ref => ref.exists === true)?.path
  assert(selectedSourcePath, 'fixture must expose one selected source path for observed mutation drift')
  const selectedSourceStat = fs.statSync(selectedSourcePath)
  const selectedSourceContent = fs.readFileSync(selectedSourcePath, 'utf8')
  fs.writeFileSync(selectedSourcePath, `${selectedSourceContent}\nobserved-context-source-drift\n`, 'utf8')
  run({
    hookEventName: 'PostToolUse',
    tool_use_id: 'chat-selected-source-mutation',
    tool_name: 'apply_patch',
    tool_input: {
      input: `*** Begin Patch\n*** Update File: ${selectedSourcePath}\n*** End Patch`
    },
    success: true
  })
  chatDriftState = readLegacyState()
  assert.strictEqual(chatDriftState.contextAcquisition.receipt.status, 'stale')
  assert.strictEqual(chatDriftState.contextAcquisition.replanCount, 1)
  fs.writeFileSync(selectedSourcePath, selectedSourceContent, 'utf8')
  fs.utimesSync(selectedSourcePath, selectedSourceStat.atime, selectedSourceStat.mtime)

  cleanState()
  run({ hookEventName: 'UserPromptSubmit', prompt: 'compact invalidates context receipt' })
  observePlan()
  let compactState = observeMemoryStatus('compact-memory-status')
  assert.strictEqual(compactState.contextAcquisition.receipt.status, 'relevant-complete')
  run({ hookEventName: 'PreCompact' })
  compactState = readLegacyState()
  assert.strictEqual(compactState.contextAcquisition.receipt.status, 'stale')
  assert.notStrictEqual(compactState.turnLiveness.state, 'completed')

  cleanMultiProjectState()
  const attachmentPrompt = run({
    hookEventName: 'UserPromptSubmit',
    prompt: '审查这个项目',
    attachments: [{ folderPath: path.join(TEMP_ROOT, 'devcodex') }]
  })
  assert.strictEqual(attachmentPrompt.continue, true)
  let multiProjectState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(multiProjectState.activeProject, 'devcodex')

  cleanMultiProjectState()
  const bareProjectPrompt = run({
    hookEventName: 'UserPromptSubmit',
    prompt: '审查 devcodex 项目'
  })
  assert.strictEqual(bareProjectPrompt.continue, true)
  multiProjectState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(multiProjectState.activeProject, 'devcodex')

  cleanLayoutMultiProjectState()
  const workspaceAmbiguity = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'layout-ambiguous-session',
    prompt: '继续'
  })
  assert.match(workspaceAmbiguity.systemMessage || '', /multi-project-workspace/)
  assert.match(workspaceAmbiguity.systemMessage || '', /\.devcodex\/workspace\/profile\//)
  assert.ok(!/未在工作区根配置 \.devcodex\/profile\//.test(workspaceAmbiguity.systemMessage || ''))

  const dedupedWorkspaceAmbiguity = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'layout-ambiguous-session',
    prompt: '继续'
  })
  assert.ok(!/multi-project-workspace/.test(dedupedWorkspaceAmbiguity.systemMessage || ''))
  assert.match(dedupedWorkspaceAmbiguity.systemMessage || '', /PC0-PC7/)

  cleanLayoutMultiProjectState()
  const prefixProjectPayload = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'prefix-project-session',
    prompt: '继续',
    currentFile: path.join(TEMP_ROOT, 'vext-test', 'README.md')
  })
  assert.strictEqual(prefixProjectPayload.continue, true)
  assert.ok(!/multi-project-workspace/.test(prefixProjectPayload.systemMessage || ''))
  const prefixProjectState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(prefixProjectState.activeProject, 'vext-test')
  assert.strictEqual(prefixProjectState.activeProjectSource, 'payload')
  assert.ok(fs.existsSync(getLayoutStateFile('vext-test')))

  cleanLayoutMultiProjectState()
  const roleUserPayloadAmbiguity = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'role-user-payload-session',
    prompt: '继续',
    messages: [{ role: 'user', content: '继续' }]
  })
  assert.match(roleUserPayloadAmbiguity.systemMessage || '', /multi-project-workspace/)
  const roleUserPayloadState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(roleUserPayloadState.activeProject, '')
  assert.notStrictEqual(roleUserPayloadState.activeProjectSource, 'payload')

  cleanLayoutMultiProjectState()
  const promptUserWordAmbiguity = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'prompt-user-word-session',
    prompt: 'for user-visible reply audit'
  })
  assert.match(promptUserWordAmbiguity.systemMessage || '', /multi-project-workspace/)
  const promptUserWordState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(promptUserWordState.activeProject, '')
  assert.notStrictEqual(promptUserWordState.activeProjectSource, 'prompt')

  cleanLayoutMultiProjectState()
  const bindingLayout = findLayoutInfo(TEMP_ROOT)
  const explicitWorkspaceBinding = resolveHostWorkspaceBinding({
    cwd: TEMP_ROOT,
    layout: bindingLayout,
    explicitProject: 'devcodex',
    requireProfile: true,
    allowUniqueProject: false
  })
  assert.strictEqual(explicitWorkspaceBinding.schemaVersion, 'HostWorkspaceBindingV1')
  assert.strictEqual(explicitWorkspaceBinding.status, 'resolved')
  assert.strictEqual(explicitWorkspaceBinding.projectNamespace, 'devcodex')
  assert.strictEqual(explicitWorkspaceBinding.source, 'explicit-target')
  assert.strictEqual(explicitWorkspaceBinding.physicalRoot, path.join(TEMP_ROOT, 'devcodex'))

  const cwdWorkspaceBinding = resolveHostWorkspaceBinding({
    cwd: path.join(TEMP_ROOT, 'payment'),
    layout: bindingLayout,
    allowUniqueProject: false
  })
  assert.strictEqual(cwdWorkspaceBinding.status, 'resolved')
  assert.strictEqual(cwdWorkspaceBinding.projectNamespace, 'payment')
  assert.strictEqual(cwdWorkspaceBinding.source, 'bridge-cwd')

  const unavailableWorkspaceBinding = resolveHostWorkspaceBinding({
    cwd: TEMP_ROOT,
    layout: bindingLayout,
    capability: 'no-bridge',
    explicitProject: 'devcodex'
  })
  assert.strictEqual(unavailableWorkspaceBinding.status, 'unavailable')
  assert.strictEqual(unavailableWorkspaceBinding.error.code, 'HOST_WORKSPACE_UNAVAILABLE')

  const unresolvedWorkspaceBinding = resolveHostWorkspaceBinding({
    cwd: path.join(TEMP_ROOT, 'tools', 'scratch'),
    layout: bindingLayout,
    allowUniqueProject: false
  })
  assert.strictEqual(unresolvedWorkspaceBinding.status, 'unresolved')
  assert.strictEqual(unresolvedWorkspaceBinding.projectNamespace, null)
  assert.strictEqual(unresolvedWorkspaceBinding.error.code, 'HOST_WORKSPACE_UNRESOLVED')

  fs.mkdirSync(path.join(TEMP_ROOT, 'profileless'), { recursive: true })
  fs.writeFileSync(path.join(TEMP_ROOT, 'profileless', 'package.json'), '{}')
  const missingProfileBinding = resolveHostWorkspaceBinding({
    cwd: TEMP_ROOT,
    layout: bindingLayout,
    explicitProject: 'profileless',
    requireProfile: true,
    allowUniqueProject: false
  })
  assert.strictEqual(missingProfileBinding.status, 'profile-missing')
  assert.strictEqual(missingProfileBinding.error.code, 'PROFILE_MISSING')

  fs.mkdirSync(path.join(TEMP_ROOT, 'apps', 'app-a'), { recursive: true })
  fs.mkdirSync(path.join(TEMP_ROOT, 'services', 'app-a'), { recursive: true })
  fs.writeFileSync(path.join(TEMP_ROOT, 'apps', 'app-a', 'package.json'), '{}')
  fs.writeFileSync(path.join(TEMP_ROOT, 'services', 'app-a', 'package.json'), '{}')
  const ambiguousWorkspaceBinding = resolveHostWorkspaceBinding({
    cwd: TEMP_ROOT,
    layout: bindingLayout,
    explicitProject: 'app-a',
    allowUniqueProject: false
  })
  assert.strictEqual(ambiguousWorkspaceBinding.status, 'ambiguous')
  assert.strictEqual(ambiguousWorkspaceBinding.error.code, 'PROFILE_TARGET_AMBIGUOUS')

  cleanLayoutMultiProjectState()
  const layoutExplicitProject = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'sticky-session',
    prompt: '继续 devcodex 的修复'
  })
  assert.strictEqual(layoutExplicitProject.continue, true)
  assert.ok(!/multi-project-workspace/.test(layoutExplicitProject.systemMessage || ''))
  let workspaceLayoutState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(workspaceLayoutState.activeProject, 'devcodex')
  assert.strictEqual(workspaceLayoutState.activeScope, 'project')
  assert.strictEqual(workspaceLayoutState.mode, 'dev')
  assert.strictEqual(workspaceLayoutState.stickyProject.project, 'devcodex')
  assert.strictEqual(workspaceLayoutState.stickyProject.schemaVersion, 'ProjectTargetLeaseV2')
  assert.match(workspaceLayoutState.stickyProject.leaseId, /^project-target-lease-[a-f0-9]{24}$/)
  assert.match(workspaceLayoutState.stickyProject.leaseDigest, /^[a-f0-9]{64}$/)
  assert.match(workspaceLayoutState.stickyProject.targetDigest, /^[a-f0-9]{64}$/)
  assert.match(workspaceLayoutState.stickyProject.rootIdentityDigest, /^[a-f0-9]{64}$/)
  assert.match(workspaceLayoutState.stickyProject.layoutIdentity, /^[a-f0-9]{64}$/)
  assert.strictEqual(workspaceLayoutState.stickyProject.authorityKind, 'session')
  assert.match(workspaceLayoutState.stickyProject.authorityDigest, /^[a-f0-9]{64}$/)
  assert.match(workspaceLayoutState.stickyProject.contextEpoch, /^ctx-/)
  assert.match(workspaceLayoutState.stickyProject.contextBindingDigest, /^[a-f0-9]{64}$/)
  assert.strictEqual(workspaceLayoutState.stickyProject.routeRevision, 'pending')
  assert.strictEqual(workspaceLayoutState.stickyProject.observedSessionRef, '')
  assert.strictEqual(workspaceLayoutState.stickyProject.sessionKey, '')
  assert.ok(workspaceLayoutState.stickyProject.expiresAtMs > workspaceLayoutState.stickyProject.validatedAtMs)
  assert.strictEqual(workspaceLayoutState.activeProjectSource, 'prompt')
  assert.ok(fs.existsSync(getLayoutStateFile('devcodex')))

  const stickyFollowup = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'sticky-session',
    prompt: '继续'
  })
  assert.strictEqual(stickyFollowup.continue, true)
  assert.ok(!/multi-project-workspace/.test(stickyFollowup.systemMessage || ''))
  workspaceLayoutState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(workspaceLayoutState.activeProject, 'devcodex')
  assert.strictEqual(workspaceLayoutState.activeProjectSource, 'sticky')
  assert.strictEqual(workspaceLayoutState.mode, 'dev')

  const stickyPromptUserWordFollowup = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'sticky-session',
    prompt: 'user-visible reply audit'
  })
  assert.strictEqual(stickyPromptUserWordFollowup.continue, true)
  assert.ok(!/multi-project-workspace/.test(stickyPromptUserWordFollowup.systemMessage || ''))
  workspaceLayoutState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(workspaceLayoutState.activeProject, 'devcodex')
  assert.strictEqual(workspaceLayoutState.activeProjectSource, 'sticky')

  const stickyRoleUserPayloadFollowup = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'sticky-session',
    prompt: '继续',
    messages: [{ role: 'user', content: '继续' }]
  })
  assert.strictEqual(stickyRoleUserPayloadFollowup.continue, true)
  assert.ok(!/multi-project-workspace/.test(stickyRoleUserPayloadFollowup.systemMessage || ''))
  workspaceLayoutState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(workspaceLayoutState.activeProject, 'devcodex')
  assert.strictEqual(workspaceLayoutState.activeProjectSource, 'sticky')

  const stickyFuzzyPayloadFollowup = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'sticky-session',
    prompt: '继续',
    metadata: {
      urls: [
        'https://example.test/user-visible-reply',
        'https://example.test/payment-plan'
      ]
    }
  })
  assert.strictEqual(stickyFuzzyPayloadFollowup.continue, true)
  assert.ok(!/multi-project-workspace/.test(stickyFuzzyPayloadFollowup.systemMessage || ''))
  workspaceLayoutState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(workspaceLayoutState.activeProject, 'devcodex')
  assert.strictEqual(workspaceLayoutState.activeProjectSource, 'sticky')

  const workspaceExemption = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'sticky-session',
    prompt: '全工作区继续'
  })
  assert.strictEqual(workspaceExemption.continue, true)
  assert.ok(!/multi-project-workspace/.test(workspaceExemption.systemMessage || ''))
  workspaceLayoutState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(workspaceLayoutState.activeProject, '')
  assert.strictEqual(workspaceLayoutState.activeScope, 'workspace')
  assert.strictEqual(workspaceLayoutState.stickyProject.project, '')

  const explicitProjectWithWorkspaceToken = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'explicit-workspace-token-session',
    prompt: 'Project devcodex. Use workspace-s15-probe.'
  })
  assert.strictEqual(explicitProjectWithWorkspaceToken.continue, true)
  workspaceLayoutState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(workspaceLayoutState.activeProject, 'devcodex')
  assert.strictEqual(workspaceLayoutState.activeScope, 'project')
  assert.strictEqual(workspaceLayoutState.activeProjectSource, 'prompt')

  cleanLayoutMultiProjectState()
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'old-session',
    prompt: '修复 devcodex 项目'
  })
  const newSessionFollowup = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'new-session',
    prompt: '继续'
  })
  assert.match(newSessionFollowup.systemMessage || '', /multi-project-workspace/)
  workspaceLayoutState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(workspaceLayoutState.activeProject, '')
  assert.match(workspaceLayoutState.stickyProject.invalidationReason, /session-or-turn-drift/)

  cleanLayoutMultiProjectState()
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'aged-sticky-session',
    prompt: '修复 devcodex 项目'
  })
  workspaceLayoutState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  workspaceLayoutState.stickyProject.expiresAtMs = 1
  workspaceLayoutState.stickyProject.expiresAt = new Date(1).toISOString()
  persistWorkspaceLayoutState(workspaceLayoutState)
  const agedSameSessionFollowup = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'aged-sticky-session',
    prompt: '继续'
  })
  assert.match(agedSameSessionFollowup.systemMessage || '', /multi-project-workspace/)
  workspaceLayoutState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(workspaceLayoutState.activeProject, '')
  assert.match(workspaceLayoutState.stickyProject.invalidationReason, /ttl-expired/)

  cleanLayoutMultiProjectState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: '修复 devcodex 项目'
  })
  const noSessionFollowup = run({
    hookEventName: 'UserPromptSubmit',
    prompt: '继续'
  })
  assert.match(noSessionFollowup.systemMessage || '', /multi-project-workspace/)
  workspaceLayoutState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(workspaceLayoutState.activeProject, '')
  assert.match(workspaceLayoutState.stickyProject.invalidationReason, /turn-boundary/)

  cleanLayoutMultiProjectState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: '修复 devcodex 项目'
  })
  workspaceLayoutState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  workspaceLayoutState.stickyProject.expiresAtMs = 1
  workspaceLayoutState.stickyProject.expiresAt = new Date(1).toISOString()
  persistWorkspaceLayoutState(workspaceLayoutState)
  const expiredStickyFollowup = run({
    hookEventName: 'UserPromptSubmit',
    prompt: '继续'
  })
  assert.match(expiredStickyFollowup.systemMessage || '', /multi-project-workspace/)

  cleanLayoutMultiProjectState()
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'layout-drift-session',
    prompt: '修复 devcodex 项目'
  })
  workspaceLayoutState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  workspaceLayoutState.stickyProject.layoutIdentity = '0'.repeat(64)
  persistWorkspaceLayoutState(workspaceLayoutState)
  const layoutDriftFollowup = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'layout-drift-rotated-session',
    prompt: '继续'
  })
  assert.match(layoutDriftFollowup.systemMessage || '', /multi-project-workspace/)
  workspaceLayoutState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.match(workspaceLayoutState.stickyProject.invalidationReason, /layout-drift/)

  cleanLayoutMultiProjectState()
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'explicit-conflict-session',
    prompt: '修复 devcodex 项目'
  })
  const explicitConflictFollowup = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'explicit-conflict-session',
    prompt: '切换到 payment 项目'
  })
  assert.ok(!/multi-project-workspace/.test(explicitConflictFollowup.systemMessage || ''))
  workspaceLayoutState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(workspaceLayoutState.activeProject, 'payment')
  assert.strictEqual(workspaceLayoutState.activeProjectSource, 'prompt')
  assert.strictEqual(workspaceLayoutState.stickyProject.project, 'payment')

  cleanLayoutState()
  const layoutProjectRoot = path.join(TEMP_ROOT, 'chat')
  const layoutPromptOutput = run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'chat 项目进入布局复审'
  }, layoutProjectRoot)
  assert.strictEqual(layoutPromptOutput.continue, true)
  const layoutShellRead = run({
    hookEventName: 'PreToolUse',
    tool_name: 'shell_command',
    tool_input: {
      command: 'Get-Content ../.devcodex/workspace/profile/config.json'
    }
  }, layoutProjectRoot)
  assert.strictEqual(layoutShellRead.continue, true)
  runLayoutBootstrapReads(TEST_AGENT, layoutProjectRoot)
  const layoutState = JSON.parse(fs.readFileSync(getLayoutStateFile('chat'), 'utf8'))
  assert.strictEqual(layoutState.bootstrapComplete, true)
  assert.strictEqual(layoutState.activeScope, 'project')
  assert.strictEqual(layoutState.activeProject, 'chat')
  assert.ok(!fs.existsSync(path.join(TEMP_ROOT, '.devcodex', '.memory', 'hooks', 'chat', 'lifecycle-state.json')))

  layoutState.executionMode = 'auto'
  const autoModeCommit = commitLifecycleState({
    metaDir: path.dirname(getWorkspaceLayoutStateFile()),
    state: layoutState,
    identity: {
      project: layoutState.activeProject,
      scope: layoutState.activeScope,
      sessionKey: layoutState.contextAcquisition.hostSessionId || ''
    },
    targets: [
      { role: 'active', dir: path.dirname(getLayoutStateFile('chat')) },
      { role: 'meta', dir: path.dirname(getWorkspaceLayoutStateFile()) }
    ]
  }, { fs })
  assert.strictEqual(autoModeCommit.status, 'committed')
  fs.writeFileSync(getLayoutStateFile('chat'), JSON.stringify(layoutState, null, 2))
  const misplacedTmpWrite = run({
    hookEventName: 'PreToolUse',
    tool_name: 'shell_command',
    tool_input: {
      command: 'Set-Content .devcodex/.tmp/leak.json "{}"'
    }
  }, layoutProjectRoot)
  assert.strictEqual(misplacedTmpWrite.continue, true)
  assert.match(
    misplacedTmpWrite.systemMessage || '',
    /Formal artifact mutation denied/,
    'auto mode must not bypass the layered artifact registry for an unregistered .devcodex/.tmp target'
  )

  cleanNestedLayoutMultiProjectState()
  const nestedLeafProject = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'nested-leaf-session',
    prompt: '检查 app-a 项目'
  })
  assert.strictEqual(nestedLeafProject.continue, true)
  assert.ok(!/multi-project-workspace/.test(nestedLeafProject.systemMessage || ''))
  let nestedLayoutState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(nestedLayoutState.activeProject, 'packages/app-a')
  assert.strictEqual(nestedLayoutState.activeProjectSource, 'prompt')

  cleanNestedLayoutMultiProjectState()
  fs.mkdirSync(path.join(TEMP_ROOT, 'services', 'app-a'), { recursive: true })
  fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'services', 'app-a', 'profile'), { recursive: true })
  fs.writeFileSync(path.join(TEMP_ROOT, 'services', 'app-a', 'package.json'), '{}')
  fs.writeFileSync(
    path.join(TEMP_ROOT, '.devcodex', 'services', 'app-a', 'profile', 'config.json'),
    JSON.stringify({ mode: 'prod', agent: TEST_AGENT })
  )
  const ambiguousLeafProject = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'nested-leaf-ambiguous-session',
    prompt: '检查 app-a 项目'
  })
  assert.match(ambiguousLeafProject.systemMessage || '', /multi-project-workspace/)

  cleanNestedLayoutMultiProjectState()
  const nestedWorkspaceAmbiguity = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'nested-layout-session',
    prompt: '继续'
  })
  assert.match(nestedWorkspaceAmbiguity.systemMessage || '', /multi-project-workspace/)

  const nestedPayloadProject = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'nested-payload-session',
    prompt: '继续',
    currentFile: path.join(TEMP_ROOT, 'packages', 'app-a', 'README.md')
  })
  assert.strictEqual(nestedPayloadProject.continue, true)
  assert.ok(!/multi-project-workspace/.test(nestedPayloadProject.systemMessage || ''))
  nestedLayoutState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(nestedLayoutState.activeProject, 'packages/app-a')
  assert.strictEqual(nestedLayoutState.activeProjectSource, 'payload')
  assert.ok(fs.existsSync(getLayoutStateFile(path.join('packages', 'app-a'))))

  cleanToolingSiblingState()
  const toolingSiblingPrompt = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'tooling-sibling-session',
    prompt: '继续 app 的修复'
  })
  assert.strictEqual(toolingSiblingPrompt.continue, true)
  assert.ok(!/multi-project-workspace/.test(toolingSiblingPrompt.systemMessage || ''))
  const toolingSiblingState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(toolingSiblingState.activeProject, 'app')
  assert.strictEqual(toolingSiblingState.activeProjectSource, 'prompt')
}

module.exports = {
  runHooksRuntimeBootstrapLayoutScenarios
}
