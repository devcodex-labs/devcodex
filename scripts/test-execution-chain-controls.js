'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { buildExecutionChainControlChecks } = require('./lib/validate-execution-chain-controls')

const ROOT = path.resolve(__dirname, '..')

function createProfileFixture(root, valid) {
  const profile = path.join(root, 'profile')
  fs.mkdirSync(profile, { recursive: true })
  const anchors = {
    '01-项目信息.md': ['executionOptimization.mode', 'ExecutionOptimizationFeatureDecisionV1', 'safe-auto'],
    '02-架构约束.md': ['ExecutionOptimizationStateV2', 'ExecutionOptimizationFeatureDecisionV1', 'full-only'],
    '03-代码风格.md': ['OptimizationFeatureStateV1', 'ExecutionOptimizationFeatureDecisionV1', 'fail-closed'],
    '04-测试规范.md': ['V101', 'ExecutionOptimizationFeatureDecisionV1', 'test:execution-chain-evolution'],
    '06-功能清单.md': ['ProjectKnowledgeSnapshotV2', 'SemanticClaimV1', 'ExecutionOptimizationStateV2', 'ExecutionOptimizationFeatureDecisionV1'],
    '07-用户文档与契约规范.md': ['继续<任务名>任务', 'ExecutionOptimizationFeatureDecisionV1', 'benchmark:execution-chain']
  }
  for (const [file, values] of Object.entries(anchors)) {
    fs.writeFileSync(path.join(profile, file), valid ? values.join('\n') : '# incomplete\n')
  }
}

function runCheck(root, activeRoot, loadExecutionOptimization) {
  const errors = []
  const logs = []
  const checks = buildExecutionChainControlChecks({
    ROOT: root,
    ACTIVE_DEVCODEX_ROOT: activeRoot,
    fs,
    path,
    read: file => fs.readFileSync(file, 'utf8'),
    err: message => errors.push(message),
    console: { log: message => logs.push(message) },
    ...(loadExecutionOptimization ? { loadExecutionOptimization } : {})
  })
  assert.deepStrictEqual(Object.keys(checks), ['checkV101'])
  checks.checkV101()
  return { errors, logs }
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-v101-direct-'))
try {
  const validActive = path.join(temp, 'valid-active')
  createProfileFixture(validActive, true)
  const positive = runCheck(ROOT, validActive)
  assert.deepStrictEqual(positive.errors, [])
  assert.ok(positive.logs.some(item => item.includes('[V101]')))

  const missingRoot = path.join(temp, 'missing-root')
  fs.mkdirSync(missingRoot, { recursive: true })
  const invalidActive = path.join(temp, 'invalid-active')
  createProfileFixture(invalidActive, false)
  const missing = runCheck(missingRoot, invalidActive)
  assert.ok(missing.errors.some(item => item.includes('missing execution-chain artifact')))
  assert.ok(missing.errors.some(item => item.includes('package/manifest JSON cannot be parsed')))
  assert.ok(missing.errors.some(item => item.includes('active Profile')))

  const malformedRoot = path.join(temp, 'malformed-root')
  fs.mkdirSync(path.join(malformedRoot, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(malformedRoot, 'package.json'), '{')
  fs.writeFileSync(path.join(malformedRoot, 'scripts', 'validation-manifest.json'), '{')
  const malformed = runCheck(malformedRoot, '')
  assert.ok(malformed.errors.some(item => item.includes('cannot be parsed')))

  const actualRuntime = require('./lib/execution-optimization')
  const runtimeCases = [
    () => { throw new Error('fixture load failure') },
    () => ({ ...actualRuntime, FEATURE_DEFINITIONS: actualRuntime.FEATURE_DEFINITIONS.slice(1) }),
    () => ({ ...actualRuntime, validateOptimizationState: () => false }),
    () => ({ ...actualRuntime, decideFeatureRoute: () => ({ optimizationAllowed: true, route: 'unsafe' }) }),
    () => ({ ...actualRuntime, normalizeModeValue: () => ({ effective: 'unsafe' }) }),
    () => ({ ...actualRuntime, transitionFeature: () => ({ receipt: { promotionAllowed: true, to: 'active' } }) }),
    () => ({ ...actualRuntime, transitionFeature: () => { throw new Error('fixture transition failure') } })
  ]
  const runtimeErrors = runtimeCases.flatMap(loadRuntime => runCheck(ROOT, validActive, loadRuntime).errors)
  for (const expected of [
    'runtime cannot load', 'controlled feature set drifted', 'not identity-valid V2',
    'full-only route is not fail-closed', 'unknown execution optimization mode',
    'harmful prospective candidate escaped', 'harmful-candidate fixture failed'
  ]) {
    assert.ok(runtimeErrors.some(item => item.includes(expected)), `missing runtime negative: ${expected}`)
  }

  const driftRoot = path.join(temp, 'drift-root')
  fs.mkdirSync(path.join(driftRoot, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(driftRoot, 'package.json'), JSON.stringify({
    scripts: { 'test:execution-chain-evolution': 'wrong', 'test:coverage': '' },
    files: []
  }))
  fs.writeFileSync(path.join(driftRoot, 'scripts', 'validation-manifest.json'), JSON.stringify({
    nodes: [{ id: 'execution-chain-evolution', command: 'node', args: ['scripts/test-execution-chain-evolution.js'], dependencies: [] }],
    routes: { fast: { nodes: [] }, full: { nodes: [] }, 'profile-deploy': { nodes: [] } }
  }))
  const drift = runCheck(driftRoot, '')
  for (const expected of ['package script drift', 'package files missing', 'omit hook runtime', 'does not consume', 'coverage route omits', 'dependency missing', 'route omits']) {
    assert.ok(drift.errors.some(item => item.includes(expected)), `missing package/manifest negative: ${expected}`)
  }

  fs.writeFileSync(path.join(driftRoot, 'scripts', 'validation-manifest.json'), JSON.stringify({
    nodes: [{ id: 'execution-chain-evolution', command: 'future', args: [], dependencies: [] }],
    routes: { fast: { nodes: [] }, full: { nodes: [] }, 'profile-deploy': { nodes: [] } }
  }))
  const malformedNode = runCheck(driftRoot, '')
  assert.ok(malformedNode.errors.some(item => item.includes('canonical validation node')))

  const missingProfileActive = path.join(temp, 'missing-profile-active')
  createProfileFixture(missingProfileActive, true)
  fs.rmSync(path.join(missingProfileActive, 'profile', '04-测试规范.md'))
  const missingProfile = runCheck(ROOT, missingProfileActive)
  assert.ok(missingProfile.errors.some(item => item.includes('active Profile consumer missing')))
} finally {
  fs.rmSync(temp, { recursive: true, force: true })
}

console.log('execution-chain control builder direct positive/negative fixtures passed')
