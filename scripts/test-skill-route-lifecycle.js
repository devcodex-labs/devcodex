'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const {
  createSkillRouteFixture
} = require('./lib/skill-route-test-fixture')
const {
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

  const firstStop = reconcileProgressiveSkillRoute(state, pending, {
    trigger: 'Stop', sessionKey: 'session-coordinator', payload: { hook_run_id: 'hook-stop-1' }
  })
  const duplicateStop = reconcileProgressiveSkillRoute(state, pending, {
    trigger: 'Stop', sessionKey: 'session-coordinator', payload: { hook_run_id: 'hook-stop-1' }
  })
  assert.strictEqual(firstStop.coordinator.noProgressCount, 1)
  assert.strictEqual(duplicateStop.coordinator.noProgressCount, 1, 'same hookRunId + fingerprint must be idempotent')
  reconcileProgressiveSkillRoute(state, pending, {
    trigger: 'Stop', sessionKey: 'session-coordinator', payload: { hook_run_id: 'hook-stop-2' }
  })
  const circuit = reconcileProgressiveSkillRoute(state, pending, {
    trigger: 'Stop', sessionKey: 'session-coordinator', payload: { hook_run_id: 'hook-stop-3' }
  })
  assert.strictEqual(circuit.coordinator.circuitOpen, true)
  assert.strictEqual(circuit.allowAction, false, 'circuit breaker must not fail open')

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
    const staleState = JSON.parse(fs.readFileSync(sessionFile(staleSession), 'utf8'))
    assert.strictEqual(
      staleState.progressiveSkillRouteStop.errorCode,
      'RUNTIME_CONTRACT_STALE'
    )
    assert.strictEqual(staleState.progressiveSkillRouteCoordinator.noProgressCount, 0)
  } finally {
    fixture.cleanup()
  }
}

console.log('test-skill-route-lifecycle: ok')
