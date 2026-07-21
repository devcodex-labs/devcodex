#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
  classifyOptimizationBacklogEvidenceSample,
  classifyAnalysisArtifactDeliverySample,
  classifyResidualOptimizationListSample,
  buildEvidenceFamilyReceipt
} = require('./lib/optimization-backlog-evidence')

// PF-168 negative: must-optimize list without grades
assert.strictEqual(
  classifyOptimizationBacklogEvidenceSample('# 完整优化清单\n1. 必须优化 A\n2. 必须改 B'),
  'thin'
)
// PF-168 positive
assert.strictEqual(
  classifyOptimizationBacklogEvidenceSample([
    '# 优化问题表',
    '| 问题 | 证据等级 | 命令 | 状态 |',
    '| x | A | npm run test:core exit=0 | ✅已验证 |',
    '| y | C | 未跑 | ⚠️待验证 |'
  ].join('\n')),
  'ready'
)

// PF-169 negative: analysis claim chat-only
assert.strictEqual(
  classifyAnalysisArtifactDeliverySample('技术方案分析完成。总体合理。' + '细节。'.repeat(200)),
  'chat-only'
)
// PF-169 positive
assert.strictEqual(
  classifyAnalysisArtifactDeliverySample(
    '方案审阅结论：合理。详细报告：[04--审阅.md](./reports/analysis/grok/20260721/04--审阅.md)'
  ),
  'ready'
)

// PF-170 negative residual without benefit
assert.strictEqual(
  classifyResidualOptimizationListSample('还可以优化：\n1. 加速\n2. 简化'),
  'thin'
)
// PF-170 positive
assert.strictEqual(
  classifyResidualOptimizationListSample([
    '## 残留可优化',
    '| 项 | 证据等级 | 预期收益 | 影响风险 | 前置条件 |',
    '| 缓存 | B | 降延迟 | 低 | 无 |'
  ].join('\n')),
  'ready'
)

const receipt = buildEvidenceFamilyReceipt('普通闲聊')
assert.strictEqual(receipt.backlog, 'not-optimization-backlog')

console.log('optimization-backlog-evidence tests passed')
