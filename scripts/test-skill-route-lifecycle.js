'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const {
  createSkillRouteFixture,
  writeContextBindingState
} = require('./lib/skill-route-test-fixture')
const {
  handleSkillRoute,
  shouldEnforceProgressiveSkillRouteStop
} = require('../hooks/_runtime/skill-route-tool.cjs')
const {
  reconcileProgressiveSkillRoute
} = require('../hooks/_runtime/lifecycle-skill-route-coordinator.cjs')
const { resolveRuntimeStateRoot } = require('../hooks/_runtime/workspace-layout.cjs')

const RUNTIME = path.resolve(__dirname, '..', 'hooks', '_runtime', 'lifecycle.cjs')

function runLifecycle (fixture, payload = {}, env = {}, cwd = fixture.projectRoot) {
  const result = spawnSync(process.execPath, [RUNTIME], {
    cwd,
    input: JSON.stringify({
      hookEventName: 'UserPromptSubmit',
      session_id: `skill-route-${Date.now()}`,
      prompt: 'Run the isolated routing probe',
      ...payload
    }),
    encoding: 'utf8',
      env: {
      ...process.env,
      DEVCODEX_HOST_PLATFORM: 'claude',
      DEVCODEX_GLOBAL_SKILLS_RUNTIME: path.join(fixture.packageRoot, 'content', 'skills'),
      ...env
    }
  })
  assert.strictEqual(result.status, 0, result.stderr || result.stdout)
  return {
    output: JSON.parse(result.stdout),
    text: result.stdout
  }
}

{
  const state = {}
  const pending = {
    present: true,
    complete: false,
    processComplete: false,
    businessSatisfied: true,
    turnBinding: 'turn-coordinator',
    contextEpoch: 'ctx-coordinator',
    planDigest: 'plan-coordinator',
    pendingStageIds: ['closeout'],
    errorCode: null,
    nextOp: 'load_stage',
    nextCall: {
      op: 'load_stage',
      project: 'sample',
      turnBinding: 'turn-coordinator',
      contextEpoch: 'ctx-coordinator',
      generation: 1,
      planDigest: 'plan-coordinator',
      stageId: 'closeout'
    }
  }
  const unrelated = reconcileProgressiveSkillRoute(state, pending, {
    trigger: 'PreToolUse',
    sessionKey: 'session-coordinator',
    payload: { hook_run_id: 'hook-pre-1', tool_name: 'exec_command', tool_input: { cmd: 'git status' } }
  })
  assert.strictEqual(unrelated.required, true)
  assert.strictEqual(unrelated.allowAction, false)
  assert.strictEqual(unrelated.envelope.schemaVersion, 'NextActionEnvelopeV1')

  const expected = reconcileProgressiveSkillRoute(state, pending, {
    trigger: 'PreToolUse',
    sessionKey: 'session-coordinator',
    payload: {
      hook_run_id: 'hook-pre-2',
      tool_name: 'mcp__devcodex_profile__skill_route',
      tool_input: pending.nextCall
    }
  })
  assert.strictEqual(expected.allowAction, true)

  const proactiveContextRefresh = reconcileProgressiveSkillRoute(state, pending, {
    trigger: 'PreToolUse',
    sessionKey: 'session-coordinator',
    payload: {
      hook_run_id: 'hook-pre-context-refresh',
      tool_name: 'mcp__devcodex_profile__profile_context_plan',
      tool_input: {
        intent: 'dev',
        changeTypes: ['source-code', 'testing', 'docs'],
        contextEpoch: 'ctx-coordinator',
        project: 'sample'
      }
    }
  })
  assert.strictEqual(
    proactiveContextRefresh.allowAction,
    true,
    'the read-only ContextRead planner must be able to make a pending route stale before rebind'
  )
  const prematureProfileLoad = reconcileProgressiveSkillRoute(state, pending, {
    trigger: 'PreToolUse',
    sessionKey: 'session-coordinator',
    payload: {
      hook_run_id: 'hook-pre-premature-profile-load',
      tool_name: 'mcp__devcodex_profile__profile_load',
      tool_input: { project: 'sample', files: ['01-项目信息.md'] }
    }
  })
  assert.strictEqual(
    prematureProfileLoad.allowAction,
    false,
    'only the planner is a proactive refresh entry; remaining reads wait for the rebind recovery state'
  )

  const firstStop = reconcileProgressiveSkillRoute(state, pending, {
    trigger: 'Stop', sessionKey: 'session-coordinator', payload: { hook_run_id: 'hook-stop-1' }
  })
  const duplicateStop = reconcileProgressiveSkillRoute(state, pending, {
    trigger: 'Stop', sessionKey: 'session-coordinator', payload: { hook_run_id: 'hook-stop-1' }
  })
  assert.strictEqual(firstStop.coordinator.noProgressCount, 1)
  assert.strictEqual(duplicateStop.coordinator.noProgressCount, 1, 'same hookRunId + fingerprint must be idempotent')
  assert.strictEqual(duplicateStop.noticeSuppressed, true, 'duplicate Stop must not replay the same envelope')
  reconcileProgressiveSkillRoute(state, pending, {
    trigger: 'Stop', sessionKey: 'session-coordinator', payload: { hook_run_id: 'hook-stop-2' }
  })
  const circuit = reconcileProgressiveSkillRoute(state, pending, {
    trigger: 'Stop', sessionKey: 'session-coordinator', payload: { hook_run_id: 'hook-stop-3' }
  })
  assert.strictEqual(circuit.coordinator.circuitOpen, true)
  assert.strictEqual(circuit.allowAction, false, 'circuit breaker must not fail open')
  let saturated = circuit
  for (let index = 4; index <= 100; index += 1) {
    saturated = reconcileProgressiveSkillRoute(state, pending, {
      trigger: 'Stop',
      sessionKey: 'session-coordinator',
      payload: { hook_run_id: `hook-stop-${index}` }
    })
  }
  assert.strictEqual(saturated.coordinator.noProgressCount, 3, 'no-progress counter must saturate')
  assert.strictEqual(saturated.envelope.noProgressCount, 3)
  assert.strictEqual(saturated.noticeSuppressed, true, 'saturated identical Stop must suppress repeated envelope injection')
  assert.match(saturated.message, /actionable field/)

  const progressed = reconcileProgressiveSkillRoute(state, {
    ...pending,
    pendingStageIds: ['execution:test-validation'],
    nextCall: { ...pending.nextCall, stageId: 'execution:test-validation' }
  }, {
    trigger: 'PostToolUse',
    sessionKey: 'session-coordinator',
    payload: { hook_run_id: 'hook-post-progress' }
  })
  assert.strictEqual(progressed.progressObserved, true)
  assert.strictEqual(progressed.coordinator.noProgressCount, 0)

  const impossible = reconcileProgressiveSkillRoute({}, {
    present: true,
    complete: false,
    processComplete: false,
    businessSatisfied: true,
    turnBinding: 'turn-impossible',
    contextEpoch: 'ctx-impossible',
    pendingStageIds: [],
    errorCode: 'TURN_ENVELOPE_READBACK_FAILED',
    nextOp: null,
    nextCall: null,
    recovery: null
  }, {
    trigger: 'Stop',
    sessionKey: 'session-impossible',
    payload: { hook_run_id: 'hook-impossible' },
    requireBusiness: true
  })
  assert.strictEqual(impossible.required, false)
  assert.strictEqual(impossible.allowAction, true)
  assert.strictEqual(impossible.envelope.status, 'retired')
  assert.strictEqual(impossible.envelope.retirementReason, 'TURN_ENVELOPE_READBACK_FAILED')
  assert.strictEqual(impossible.envelope.recovery.action, 'retire-and-rebootstrap-next-user-prompt')
}

{
  const exactRetiredRoute = {
    present: true,
    complete: true,
    turnBinding: 'turn-retired-runtime',
    contextEpoch: 'ctx-retired-runtime',
    planDigest: 'plan-retired-runtime',
    processComplete: false,
    retired: true,
    retirementReason: 'RUNTIME_CONTRACT_STALE',
    completionDisposition: 'retired-stale-identity',
    businessSatisfied: true,
    errorCode: 'RUNTIME_CONTRACT_STALE',
    pendingStageIds: ['closeout'],
    nextOp: null,
    nextCall: null,
    recovery: {
      schemaVersion: 'SkillRouteRetirementRecoveryV1',
      automatic: true,
      action: 'retire-and-allow-stop',
      mustReplyCore: null,
      rebootstrapOnNextUserPrompt: true
    }
  }
  assert.strictEqual(
    shouldEnforceProgressiveSkillRouteStop(exactRetiredRoute, true),
    false,
    'a retired route with satisfied business must not replay impossible stage work'
  )
  const retiredState = {
    progressiveSkillRouteCoordinator: {
      noProgressCount: 2,
      stateFingerprint: 'prior-stale-fingerprint'
    }
  }
  const retiredStop = reconcileProgressiveSkillRoute(retiredState, exactRetiredRoute, {
    trigger: 'Stop',
    sessionKey: 'session-retired-runtime',
    payload: {},
    requireBusiness: true
  })
  assert.strictEqual(retiredStop.required, false)
  assert.strictEqual(retiredStop.allowAction, true)
  assert.strictEqual(retiredStop.envelope.status, 'retired')
  assert.strictEqual(retiredStop.envelope.processComplete, false)
  assert.strictEqual(retiredStop.envelope.retired, true)
  assert.deepStrictEqual(retiredStop.envelope.pendingStageIds, ['closeout'])
  assert.strictEqual(retiredStop.coordinator.noProgressCount, 0)
  assert.strictEqual(retiredStop.coordinator.lastAction, 'retired')

  const businessPendingRoute = {
    ...exactRetiredRoute,
    complete: false,
    businessSatisfied: false,
    mustReplyCore: 'Deliver the selected business result.',
    nextOp: 'satisfy_business',
    recovery: {
      ...exactRetiredRoute.recovery,
      automatic: false,
      action: 'reply-selected-business-core',
      mustReplyCore: 'Deliver the selected business result.'
    }
  }
  const preTool = reconcileProgressiveSkillRoute({}, businessPendingRoute, {
    trigger: 'PreToolUse',
    sessionKey: 'session-retired-business',
    payload: { tool_name: 'exec_command', tool_input: { cmd: 'git status' } },
    requireBusiness: false
  })
  assert.strictEqual(preTool.required, false, 'retired process work must not block PreToolUse')
  const businessStop = reconcileProgressiveSkillRoute({}, businessPendingRoute, {
    trigger: 'Stop',
    sessionKey: 'session-retired-business',
    payload: {},
    requireBusiness: true
  })
  assert.strictEqual(businessStop.required, true)
  assert.strictEqual(businessStop.envelope.status, 'action-required')
  assert.strictEqual(businessStop.envelope.nextOp, 'satisfy_business')
  assert.strictEqual(
    businessStop.envelope.mustReplyCore,
    'Deliver the selected business result.'
  )
  assert.strictEqual(businessStop.envelope.recovery.action, 'reply-selected-business-core')
}

{
  const fixture = createSkillRouteFixture({ project: 'five-host-default' })
  try {
    for (const host of ['claude', 'codex', 'copilot', 'gemini', 'grok']) {
      const sessionId = `default-${host}`
      const result = runLifecycle(fixture, {
        session_id: sessionId
      }, {
        DEVCODEX_HOST_PLATFORM: host
      })
      assert.match(result.text, /SkillRouteBootstrapV1/)
      assert.doesNotMatch(result.text, /WorkspaceSkillIntent/)
      const sessionDigest = crypto.createHash('sha256').update(sessionId).digest('hex')
      const sessionFile = path.join(
        fixture.root,
        '.devcodex',
        'workspace',
        '.memory',
        'hooks',
        'workspace',
        'sessions',
        `${sessionDigest}.json`
      )
      const state = JSON.parse(fs.readFileSync(sessionFile, 'utf8'))
      assert.strictEqual(state.progressiveSkillRoute.modeReceipt.effective, 'unified')
      assert.strictEqual(state.progressiveSkillRoute.modeReceipt.sourceDefault, 'unified')
      assert.strictEqual(state.workspaceSkillAutoMatch, null)
      const turnBinding = state.progressiveSkillRoute.bootstrap.turnBinding
      assert(fs.existsSync(path.join(
        resolveRuntimeStateRoot(fixture.activeRoot, fixture.project).root,
        'skill-route',
        'turns',
        turnBinding,
        'route-envelope.json'
      )))
    }

    const parentSession = 'parent-session'
    const childSession = 'child-session'
    runLifecycle(fixture, { session_id: parentSession, prompt: 'Parent task' })
    runLifecycle(fixture, { session_id: childSession, prompt: '请使用 routing skill' })
    const sessionFile = sessionId => path.join(
      fixture.root,
      '.devcodex',
      'workspace',
      '.memory',
      'hooks',
      'workspace',
      'sessions',
      `${crypto.createHash('sha256').update(sessionId).digest('hex')}.json`
    )
    const parentBefore = JSON.parse(fs.readFileSync(sessionFile(parentSession), 'utf8'))
    const childBefore = JSON.parse(fs.readFileSync(sessionFile(childSession), 'utf8'))
    assert.notStrictEqual(
      parentBefore.contextAcquisition.contextEpoch,
      childBefore.contextAcquisition.contextEpoch
    )
    runLifecycle(fixture, {
      hookEventName: 'Stop',
      session_id: parentSession,
      lastAssistantMessage: 'Parent task result'
    })
    const parentAfter = JSON.parse(fs.readFileSync(sessionFile(parentSession), 'utf8'))
    const childAfter = JSON.parse(fs.readFileSync(sessionFile(childSession), 'utf8'))
    assert.strictEqual(
      parentAfter.contextAcquisition.contextEpoch,
      parentBefore.contextAcquisition.contextEpoch
    )
    assert.strictEqual(
      childAfter.contextAcquisition.contextEpoch,
      childBefore.contextAcquisition.contextEpoch
    )
    assert.strictEqual(childAfter.progressiveSkillRouteCoordinator.noProgressCount, 0)

    const languageSession = 'language-carrier-session'
    runLifecycle(fixture, {
      session_id: languageSession,
      prompt: '请检查这个项目并保持中文'
    })
    const languageBefore = JSON.parse(fs.readFileSync(sessionFile(languageSession), 'utf8'))
    assert.strictEqual(languageBefore.languageContext.language, 'zh-CN')
    runLifecycle(fixture, {
      hookEventName: 'UserPromptSubmit',
      session_id: languageSession,
      prompt: 'Progressive Skill route stages remain pending: closeout.',
      devcodex_host_continuation: true
    })
    const languageAfter = JSON.parse(fs.readFileSync(sessionFile(languageSession), 'utf8'))
    assert.deepStrictEqual(
      languageAfter.languageContext,
      languageBefore.languageContext,
      'host-generated route continuations must not reset LanguageContextV1'
    )

    const otherProject = 'other-project'
    const otherProjectRoot = path.join(fixture.root, otherProject)
    const otherActiveRoot = path.join(fixture.root, '.devcodex', otherProject)
    fs.mkdirSync(otherProjectRoot, { recursive: true })
    fs.writeFileSync(path.join(otherProjectRoot, 'package.json'), JSON.stringify({ name: otherProject }))
    fs.mkdirSync(path.join(otherActiveRoot, 'profile'), { recursive: true })
    fs.writeFileSync(path.join(otherActiveRoot, 'profile', 'config.json'), JSON.stringify({ ENV_MODE: 'dev', profileTier: 'profile-lite' }))
    for (const [file, body] of [
      ['README.md', '# Other Profile\n'],
      ['01-项目信息.md', '# Other project\n'],
      ['02-架构约束.md', '# Other architecture\n'],
      ['03-代码风格.md', '# Other style\n']
    ]) fs.writeFileSync(path.join(otherActiveRoot, 'profile', file), body)
    const projectASession = 'session-first-project-a'
    const projectBSession = 'session-first-project-b'
    runLifecycle(fixture, { session_id: projectASession, prompt: 'Project A task' })
    runLifecycle(fixture, { session_id: projectBSession, prompt: 'Project B task' }, {}, otherProjectRoot)
    const projectABefore = JSON.parse(fs.readFileSync(sessionFile(projectASession), 'utf8'))
    const projectBBefore = JSON.parse(fs.readFileSync(sessionFile(projectBSession), 'utf8'))
    assert.strictEqual(projectABefore.activeProject, fixture.project)
    assert.strictEqual(projectBBefore.activeProject, otherProject)
    runLifecycle(fixture, {
      hookEventName: 'Stop',
      session_id: projectASession,
      lastAssistantMessage: 'Project A result'
    })
    const projectAAfterMetaSwitch = JSON.parse(fs.readFileSync(sessionFile(projectASession), 'utf8'))
    assert.strictEqual(projectAAfterMetaSwitch.activeProject, fixture.project)
    assert.strictEqual(
      projectAAfterMetaSwitch.contextAcquisition.contextEpoch,
      projectABefore.contextAcquisition.contextEpoch,
      'session-first lookup must win over the workspace meta active project'
    )

    assert.strictEqual(
      shouldEnforceProgressiveSkillRouteStop({
        present: true,
        complete: false,
        errorCode: 'MODE_CAPABILITY_STALE',
        planDigest: 'committed-plan',
        processComplete: false,
        pendingStageIds: ['closeout']
      }, false),
      true
    )
    assert.strictEqual(
      shouldEnforceProgressiveSkillRouteStop({
        present: true,
        complete: true,
        retired: true,
        retirementReason: 'MODE_CAPABILITY_STALE',
        errorCode: 'MODE_CAPABILITY_STALE',
        planDigest: 'committed-plan',
        processComplete: false,
        pendingStageIds: ['closeout'],
        businessSatisfied: true
      }, true),
      false
    )
    assert.strictEqual(
      shouldEnforceProgressiveSkillRouteStop({
        present: true,
        complete: false,
        retired: true,
        retirementReason: 'MODE_CAPABILITY_STALE',
        errorCode: 'MODE_CAPABILITY_STALE',
        processComplete: false,
        pendingStageIds: ['closeout'],
        businessSatisfied: false
      }, false),
      true
    )
    assert.strictEqual(
      shouldEnforceProgressiveSkillRouteStop({
        present: true,
        complete: false,
        errorCode: 'MODE_CAPABILITY_STALE'
      }, true),
      true
    )

    const staleSession = 'non-explicit-runtime-refresh'
    runLifecycle(fixture, {
      session_id: staleSession,
      prompt: 'Summarize the current implementation status'
    })
    const staleBeforeCommit = JSON.parse(fs.readFileSync(sessionFile(staleSession), 'utf8'))
    const staleBootstrap = staleBeforeCommit.progressiveSkillRoute.bootstrap
    const staleContextBinding = writeContextBindingState(
      fixture,
      staleBeforeCommit.contextAcquisition.contextEpoch,
      'analyze',
      staleSession
    )
    let staleCatalogCursor = null
    do {
      const page = handleSkillRoute({
        op: 'catalog',
        project: fixture.project,
        turnBinding: staleBootstrap.turnBinding,
        contextEpoch: staleBootstrap.contextEpoch,
        ...(staleCatalogCursor ? { cursor: staleCatalogCursor } : {})
      }, fixture.runtimeOptions)
      assert.strictEqual(page.ok, true, JSON.stringify(page))
      staleCatalogCursor = page.receipt.nextCursor
    } while (staleCatalogCursor)
    const staleCommit = handleSkillRoute({
      op: 'commit',
      project: fixture.project,
      turnBinding: staleBootstrap.turnBinding,
      contextEpoch: staleBootstrap.contextEpoch,
      catalogDigest: staleBootstrap.catalogDigest,
      skillId: null,
      contextBinding: staleContextBinding
    }, fixture.runtimeOptions)
    assert.strictEqual(staleCommit.ok, true, JSON.stringify(staleCommit))
    assert(staleCommit.receipt.obligations.requiredStageIds.length > 0)
    const alternateSkillsRoot = path.join(fixture.root, 'alternate-skills')
    fs.mkdirSync(path.join(alternateSkillsRoot, '_schemas'), { recursive: true })
    fs.copyFileSync(
      path.join(fixture.packageRoot, 'content', 'skills', 'portfolio.json'),
      path.join(alternateSkillsRoot, 'portfolio.json')
    )
    for (const schema of [
      'skill-intent.v1.schema.json',
      'workflow-root-registry.v1.schema.json',
      'progressive-skill-route.v1.schema.json'
    ]) {
      fs.copyFileSync(
        path.join(fixture.packageRoot, 'content', 'skills', '_schemas', schema),
        path.join(alternateSkillsRoot, '_schemas', schema)
      )
    }
    fs.appendFileSync(
      path.join(alternateSkillsRoot, '_schemas', 'skill-intent.v1.schema.json'),
      '\n',
      'utf8'
    )
    const staleStop = runLifecycle(fixture, {
      hookEventName: 'Stop',
      session_id: staleSession,
      lastAssistantMessage: 'Implementation status summarized.'
    }, {
      DEVCODEX_GLOBAL_SKILLS_RUNTIME: alternateSkillsRoot
    })
    assert.doesNotMatch(staleStop.text, /Progressive Skill route is incomplete/)
    assert.doesNotMatch(staleStop.text, /Progressive Skill route requires/)
    assert.doesNotMatch(staleStop.text, /NextActionEnvelopeV1/)
    assert.notStrictEqual(staleStop.output.decision, 'block')
    assert.notStrictEqual(staleStop.output.continue, false)
    const staleState = JSON.parse(fs.readFileSync(sessionFile(staleSession), 'utf8'))
    assert.strictEqual(
      staleState.progressiveSkillRouteStop.errorCode,
      'RUNTIME_CONTRACT_STALE'
    )
    assert.strictEqual(staleState.progressiveSkillRouteStop.retired, true)
    assert.strictEqual(staleState.progressiveSkillRouteStop.processComplete, false)
    assert.strictEqual(staleState.progressiveSkillRouteStop.complete, true)
    assert(staleState.progressiveSkillRouteStop.pendingStageIds.length > 0)
    assert.strictEqual(
      staleState.progressiveSkillRouteStop.completionDisposition,
      'retired-stale-identity'
    )
    assert.strictEqual(staleState.progressiveSkillRouteCoordinator.noProgressCount, 0)
    assert.strictEqual(staleState.progressiveSkillRouteCoordinator.lastAction, 'retired')

    const staleTurnBinding = staleState.progressiveSkillRouteStop.turnBinding
    const staleContextEpoch = staleState.contextAcquisition.contextEpoch
    runLifecycle(fixture, {
      hookEventName: 'UserPromptSubmit',
      session_id: staleSession,
      prompt: 'Start the next real task with the current runtime'
    }, {
      DEVCODEX_GLOBAL_SKILLS_RUNTIME: alternateSkillsRoot
    })
    const refreshedState = JSON.parse(fs.readFileSync(sessionFile(staleSession), 'utf8'))
    assert.notStrictEqual(refreshedState.contextAcquisition.contextEpoch, staleContextEpoch)
    assert.notStrictEqual(
      refreshedState.progressiveSkillRoute.bootstrap.turnBinding,
      staleTurnBinding
    )
    assert.strictEqual(refreshedState.progressiveSkillRoute.errorCode, null)
  } finally {
    fixture.cleanup()
  }
}

console.log('test-skill-route-lifecycle: ok')
