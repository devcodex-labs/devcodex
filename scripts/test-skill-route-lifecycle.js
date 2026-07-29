'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const {
  createSkillRouteFixture
} = require('./lib/skill-route-test-fixture')

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
  } finally {
    fixture.cleanup()
  }
}

console.log('test-skill-route-lifecycle: ok')
