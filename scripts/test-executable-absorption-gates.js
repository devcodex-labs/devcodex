#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
  classifyProgressReportFastPathSample,
  classifyTaskPhaseProjectionSample,
  classifyClosedArtifactNoReviveSample,
  classifyFormalRerunLightSample,
  classifyFindingObjectLayerSample
} = require('./lib/executable-absorption-gates')

// R1 ProgressReportFastPath
assert.strictEqual(
  classifyProgressReportFastPathSample('正在扫描 workspace 根，请稍候定位项目中', { isProgressQuery: true }),
  'progress-fail'
)
assert.strictEqual(
  classifyProgressReportFastPathSample(
    '绑定 vext-test；总进度 open/fixed-awaiting 见 verification/issues/README；当前阻断 B01；可否发版：否',
    { isProgressQuery: true }
  ),
  'progress-pass'
)
assert.strictEqual(classifyProgressReportFastPathSample('解释一下 TTFV'), 'progress-na')

// R2 TaskPhaseProjection
assert.strictEqual(
  classifyTaskPhaseProjectionSample('继续刚才的任务，开始实施吧', { continueIntent: true }),
  'phase-fail'
)
assert.strictEqual(
  classifyTaskPhaseProjectionSample(
    'activeTask: MCP能力；phaseKind=CP3 pending；sourceDelivery=none；下一步：确认 CP3',
    { multiTask: true }
  ),
  'phase-pass'
)
assert.strictEqual(
  classifyTaskPhaseProjectionSample(
    '04-实施计划 已有，CP3 pending，sourceDelivery=none，但已在实施写代码',
    { multiTask: true }
  ),
  'phase-fail'
)

// R3 ClosedArtifactNoRevive
assert.strictEqual(
  classifyClosedArtifactNoReviveSample({
    headerStatus: 'closed / user-canceled',
    intendedAction: 'update same 01-需求确认.md to candidate'
  }),
  'revive-allowed-invalid'
)
assert.strictEqual(
  classifyClosedArtifactNoReviveSample({
    headerStatus: 'canceled',
    intendedAction: 'create new directory with superseded marker'
  }),
  'revive-ok-new'
)
assert.strictEqual(
  classifyClosedArtifactNoReviveSample({ headerStatus: 'active', intendedAction: 'update 01' }),
  'revive-na'
)

// R4 FormalRerunLightClassify
assert.strictEqual(
  classifyFormalRerunLightSample({ startingFullFormal: true, classified: false }),
  'rerun-fail'
)
assert.strictEqual(
  classifyFormalRerunLightSample({
    startingFullFormal: true,
    classified: true,
    class: 'shared-rerun',
    hasSharedBenefit: true
  }),
  'rerun-pass'
)
assert.strictEqual(
  classifyFormalRerunLightSample({ startingFullFormal: true, classified: true, class: 'need-full-per-finding', hasSharedBenefit: false }),
  'rerun-fail'
)
assert.strictEqual(classifyFormalRerunLightSample({ applicable: false, startingFullFormal: true }), 'rerun-na')

// T2 Finding object layer
assert.strictEqual(
  classifyFindingObjectLayerSample({ objectLayer: 'verification-system', text: '产品已修复可关闭' }),
  'layer-fail'
)
assert.strictEqual(
  classifyFindingObjectLayerSample({
    objectLayer: 'source-product',
    text: 'source patch landed, product finding closed after rerun'
  }),
  'layer-pass'
)
assert.strictEqual(
  classifyFindingObjectLayerSample({ text: 'finding fixed but no object layer field' }),
  'layer-fail'
)

console.log('executable absorption gates tests passed')
