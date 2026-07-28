'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const {
  getRuntimeContractDigest,
  normalizeHostVariant
} = require('../hooks/_runtime/skill-route-mode.cjs')
const {
  createSkillRouteFixture,
  writeJson
} = require('./lib/skill-route-test-fixture')

const RUNTIME = path.resolve(__dirname, '..', 'hooks', '_runtime', 'lifecycle.cjs')

function runLifecycle (fixture, env = {}) {
  const result = spawnSync(process.execPath, [RUNTIME], {
    cwd: fixture.projectRoot,
    input: JSON.stringify({
      hookEventName: 'UserPromptSubmit',
      session_id: `skill-route-${Date.now()}`,
      prompt: 'Run the isolated routing probe'
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
  const fixture = createSkillRouteFixture({ project: 'legacy' })
  try {
    const result = runLifecycle(fixture, {
      DEVCODEX_SKILL_ROUTE_MODE: 'legacy'
    })
    assert.match(result.text, /WorkspaceSkillIntent/)
    assert.doesNotMatch(result.text, /SkillRouteBootstrapV1/)
  } finally {
    fixture.cleanup()
  }
}

{
  const fixture = createSkillRouteFixture({ project: 'shadow' })
  try {
    const result = runLifecycle(fixture, {
      DEVCODEX_SKILL_ROUTE_MODE: 'shadow'
    })
    assert.match(result.text, /WorkspaceSkillIntent/)
    assert.match(result.text, /SkillRouteBootstrapV1/)
    const stateFile = path.join(
      fixture.activeRoot,
      '.memory',
      'hooks',
      fixture.project,
      'lifecycle-state.json'
    )
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    assert.strictEqual(state.progressiveSkillRoute.modeReceipt.effective, 'shadow')
    assert.strictEqual(state.progressiveSkillRoute.active, true)
  } finally {
    fixture.cleanup()
  }
}

{
  const fixture = createSkillRouteFixture({ project: 'unified' })
  try {
    const now = Date.now()
    const authorityPath = path.join(fixture.root, 'probe-authority.json')
    writeJson(authorityPath, {
      schemaVersion: 'SkillRouteProbeAuthorityV1',
      probeRunId: 'lifecycle-fixture',
      project: fixture.project,
      hostVariant: normalizeHostVariant('claude'),
      runtimeDigest: getRuntimeContractDigest(),
      issuerPid: process.pid,
      issuedAt: new Date(now - 1000).toISOString(),
      expiresAt: new Date(now + 5 * 60 * 1000).toISOString(),
      allowedMode: 'unified',
      probeOnly: true
    })
    const result = runLifecycle(fixture, {
      DEVCODEX_SKILL_ROUTE_MODE: 'unified',
      DEVCODEX_SKILL_ROUTE_PROBE_AUTHORITY: authorityPath
    })
    assert.match(result.text, /SkillRouteBootstrapV1/)
    assert.doesNotMatch(result.text, /WorkspaceSkillIntent/)
    const stateFile = path.join(
      fixture.activeRoot,
      '.memory',
      'hooks',
      fixture.project,
      'lifecycle-state.json'
    )
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    assert.strictEqual(state.progressiveSkillRoute.modeReceipt.effective, 'unified')
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
  } finally {
    fixture.cleanup()
  }
}

console.log('test-skill-route-lifecycle: ok')
