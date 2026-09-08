#!/usr/bin/env node
'use strict'

const assert = require('assert')
const crypto = require('crypto')
const {
  classifyDocsAudienceSample,
  classifyDocsAudienceDriftSample,
  classifyDocsAudienceDisambiguationSample,
  classifyUserDocsCognitiveAltitudeSample,
  classifyProactiveScenarioExtensionSample
} = require('./lib/docs-audience-intent')

// Protocol/identity checks; actual audience and readability are model reviews,
// evaluated separately against the document and its reader's task.
for (const prose of ['写用户文档', 'maintenance guide', '把 website 写一下', 'public-user']) {
  assert.strictEqual(classifyDocsAudienceSample(prose).status, 'decision-pending')
  assert.strictEqual(classifyDocsAudienceSample(prose).failClosed, false)
}
for (const docsAudience of ['public-user', 'maintainer-dev', 'multi-audience', 'ambiguous']) {
  const result = classifyDocsAudienceSample({
    schemaVersion: 'DocsAudienceDecisionV1', docsAudience, docsSurface: 'guide',
    basis: 'Model considered the current request, project scope and intended reader.'
  })
  assert.strictEqual(result.docsAudience, docsAudience)
  assert.strictEqual(result.semanticOwner, 'model')
}
const review = (body, kind, conclusion, extra = {}) => ({
  schemaVersion: 'DocsContentReviewV1', kind, conclusion,
  contentDigest: crypto.createHash('sha256').update(body).digest('hex'),
  rationale: 'This fixture tests binding only, not semantic quality.',
  evidenceRefs: ['fixture://reviewed-document'], ...extra
})
const body = '# 示例\n引用“安装”“release checklist”不能自行证明文档质量。'
assert.strictEqual(classifyDocsAudienceDriftSample('public-user', body), 'unverified')
const bound = review(body, 'audience-drift', 'drift-maintainer-on-user', { audience: 'public-user' })
assert.strictEqual(classifyDocsAudienceDriftSample('public-user', body, bound), 'drift-maintainer-on-user')
assert.strictEqual(classifyDocsAudienceDriftSample('public-user', body + '\nchanged', bound), 'unverified')
assert.strictEqual(classifyDocsAudienceDriftSample('maintainer-dev', body, bound), 'unverified')
assert.strictEqual(classifyDocsAudienceDisambiguationSample(body), 'unverified')
assert.strictEqual(classifyDocsAudienceDisambiguationSample(body,
  review(body, 'audience-disambiguation', 'ok')), 'ok')
assert.strictEqual(classifyUserDocsCognitiveAltitudeSample(body), 'unverified')
assert.strictEqual(classifyUserDocsCognitiveAltitudeSample(body, {
  review: review(body, 'cognitive-altitude', 'concept-dump-no-task')
}), 'concept-dump-no-task')
const pair = JSON.stringify(['user request', body])
assert.strictEqual(classifyProactiveScenarioExtensionSample('user request', body), 'unverified')
assert.strictEqual(classifyProactiveScenarioExtensionSample('user request', body,
  review(pair, 'scenario-extension', 'missing-extension')), 'missing-extension')
assert.strictEqual(classifyUserDocsCognitiveAltitudeSample(body, {
  review: { ...review(body, 'cognitive-altitude', 'ok'), evidenceRefs: [] }
}), 'unverified')
console.log('docs audience contracts passed: model ownership, no prose decisions, review digest binding')
