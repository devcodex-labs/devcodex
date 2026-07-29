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

const RUNTIME = path.resolve(__dirname, '..', 'hooks', '_runtime', 'lifecycle.cjs')

function runLifecycle (fixture, payload = {}, env = {}) {
  const result = spawnSync(process.execPath, [RUNTIME], {
    cwd: fixture.projectRoot,
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
      DEVCODEX_GLOBAL_SKILLS_RUNTIME: path.join(fixture.packageRoot, 'skills'),
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
        fixture.activeRoot,
        '.memory',
        'hooks',
        fixture.project,
        'sessions',
        `${sessionDigest}.json`
      )
      const state = JSON.parse(fs.readFileSync(sessionFile, 'utf8'))
      assert.strictEqual(state.progressiveSkillRoute.modeReceipt.effective, 'unified')
      assert.strictEqual(state.progressiveSkillRoute.modeReceipt.sourceDefault, 'unified')
      assert.strictEqual(state.workspaceSkillAutoMatch, null)
      const turnBinding = state.progressiveSkillRoute.bootstrap.turnBinding
      assert(fs.existsSync(path.join(
        fixture.activeRoot,
        '.runtime-state',
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
      fixture.activeRoot,
      '.memory',
      'hooks',
      fixture.project,
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
    assert.strictEqual(childAfter.progressiveSkillRouteStopCount || 0, 0)

    assert.strictEqual(
      shouldEnforceProgressiveSkillRouteStop({
        present: true,
        complete: false,
        errorCode: 'MODE_CAPABILITY_STALE'
      }, false),
      false
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
      path.join(fixture.packageRoot, 'skills', 'portfolio.json'),
      path.join(alternateSkillsRoot, 'portfolio.json')
    )
    for (const schema of [
      'skill-intent.v1.schema.json',
      'workflow-root-registry.v1.schema.json',
      'progressive-skill-route.v1.schema.json'
    ]) {
      fs.copyFileSync(
        path.join(fixture.packageRoot, 'skills', '_schemas', schema),
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
    assert.strictEqual(staleState.progressiveSkillRouteStopCount || 0, 0)
  } finally {
    fixture.cleanup()
  }
}

console.log('test-skill-route-lifecycle: ok')
