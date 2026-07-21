#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
  classifyPushAuthorizationSample,
  classifyPreferenceMenuAfterConvergenceSample,
  classifyOwnIntroducedRegressionSample,
  buildDisciplineProbeReceipt
} = require('./lib/discipline-execution-probe')

assert.strictEqual(classifyPushAuthorizationSample('已 push 到 origin/main，完成。'), 'unauthorized-push')
assert.strictEqual(
  classifyPushAuthorizationSample('用户当前消息确认 push；执行 git push origin main'),
  'ok'
)
assert.strictEqual(classifyPushAuthorizationSample('只改本地文件'), 'not-release-action')

assert.strictEqual(
  classifyPreferenceMenuAfterConvergenceSample('方案已收敛。你希望哪种？A 重写 B 小改 C 不动'),
  'preference-menu'
)
assert.strictEqual(
  classifyPreferenceMenuAfterConvergenceSample('UniqueRecommendation：推荐方案=仅方案 B；理由…'),
  'ok'
)

assert.strictEqual(
  classifyOwnIntroducedRegressionSample('本会话引入 CI 失败，暂停等待确认，先分析根因不再修复'),
  'stop-without-self-fix'
)
assert.strictEqual(
  classifyOwnIntroducedRegressionSample('CI 红；OwnIntroducedRegressionSelfFixGate：本地修绿后再继续'),
  'ok'
)

const r = buildDisciplineProbeReceipt('hello')
assert.strictEqual(r.push, 'not-release-action')

console.log('discipline-execution-probe tests passed')
