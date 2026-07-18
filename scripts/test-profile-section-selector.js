#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
  PROFILE_SECTION_RECEIPT_SCHEMA,
  normalizeHeading,
  parseAtxHeadings,
  selectProfileSections
} = require('../mcp/profile-section-selector.cjs')

const document = [
  'Profile preamble.',
  '',
  '# Project Overview',
  '',
  'Project facts.',
  '',
  '## Runtime Config',
  '',
  'Runtime facts.',
  '',
  '### Runtime Details',
  '',
  'Nested facts.',
  '',
  '## Runtime Operations',
  '',
  'Operations facts.',
  '',
  '```md',
  '# Not A Real Heading',
  '```',
  '',
  '# Testing Strategy',
  '',
  'Testing facts.',
  '',
  '# Large Appendix',
  '',
  'x'.repeat(4096),
  ''
].join('\n')

function select(selector) {
  return selectProfileSections({ file: '01-项目信息.md', content: document, selector })
}

assert.strictEqual(normalizeHeading(' Runtime-Config：V2 '), 'runtimeconfigv2')
const parsed = parseAtxHeadings(document)
assert.strictEqual(parsed.supported, true)
assert.strictEqual(parsed.headings.some(item => item.title === 'Not A Real Heading'), false)

const exact = select({
  headingQueries: ['Runtime Config'],
  requiredQueries: ['Runtime Config'],
  maxBytes: 2048
})
assert.strictEqual(exact.receipt.schemaVersion, PROFILE_SECTION_RECEIPT_SCHEMA)
assert.strictEqual(exact.receipt.completion, 'complete')
assert.match(exact.body, /^## Runtime Config/)
assert(exact.body.includes('Runtime facts.'))
assert(!exact.body.includes('Runtime Details'))
assert(!exact.body.includes('Runtime Operations'))

const descendants = select({
  headingQueries: ['Project Overview'],
  requiredQueries: ['Project Overview'],
  includeDescendants: true,
  maxBytes: 4096
})
assert(descendants.body.includes('Runtime Details'))
assert(descendants.body.includes('Runtime Operations'))
assert(!descendants.body.includes('Testing Strategy'))

const ordered = select({
  headingQueries: ['Testing Strategy', 'Project Overview'],
  requiredQueries: [],
  includeDescendants: false,
  maxBytes: 4096
})
assert(ordered.body.indexOf('# Testing Strategy') < ordered.body.indexOf('# Project Overview'))

const contains = select({
  headingQueries: ['Operations'],
  requiredQueries: ['Operations'],
  maxBytes: 2048
})
assert.strictEqual(contains.receipt.matchedHeadings[0].matchType, 'normalized-contains')
assert.match(contains.body, /^## Runtime Operations/)

const preamble = select({
  headingQueries: ['Testing Strategy'],
  includePreamble: true,
  maxBytes: 2048
})
assert(preamble.body.startsWith('Profile preamble.'))
assert(preamble.body.includes('# Testing Strategy'))

for (const fallback of [
  select({ headingQueries: ['Missing'], requiredQueries: ['Missing'], maxBytes: 2048 }),
  select({ headingQueries: ['Runtime'], requiredQueries: ['Runtime'], maxBytes: 2048 }),
  select({ headingQueries: ['Testing Strategy'], requiredQueries: ['Testing Strategy'], confidence: 0.5, maxBytes: 2048 }),
  select({ headingQueries: ['Testing Strategy'], requiredQueries: ['Testing Strategy'], parser: 'unsupported-v9', maxBytes: 2048 }),
  select({ headingQueries: ['Large Appendix'], requiredQueries: ['Large Appendix'], maxBytes: 256 })
]) {
  assert.strictEqual(fallback.receipt.completion, 'fallback-full')
  assert.strictEqual(fallback.body, document)
  assert.strictEqual(fallback.receipt.selectedBytes, Buffer.byteLength(document, 'utf8'))
}

const optionalPartial = select({
  headingQueries: ['Testing Strategy', 'Large Appendix', 'Missing Optional'],
  requiredQueries: ['Testing Strategy'],
  maxBytes: 256
})
assert.strictEqual(optionalPartial.receipt.completion, 'partial')
assert(optionalPartial.body.includes('Testing facts.'))
assert(!optionalPartial.body.includes('x'.repeat(128)))
assert(optionalPartial.receipt.deferredSections.some(item => item.query === 'Large Appendix'))
assert(optionalPartial.receipt.missing.includes('Missing Optional'))
assert.strictEqual(optionalPartial.receipt.selectedBytes, Buffer.byteLength(optionalPartial.body, 'utf8'))

const fullOracle = select({
  headingQueries: parsed.headings.filter(item => item.level === 1).map(item => item.title),
  includePreamble: true,
  includeDescendants: true,
  maxBytes: Buffer.byteLength(document, 'utf8') + 1024
})
assert.strictEqual(fullOracle.receipt.completion, 'complete')
for (const anchor of ['Project facts.', 'Nested facts.', 'Operations facts.', 'Testing facts.', 'x'.repeat(128)]) {
  assert(fullOracle.body.includes(anchor), 'full oracle missing ' + anchor.slice(0, 24))
}

const overlapping = selectProfileSections({
  file: 'fixture.md',
  content: '# Root\n\nroot\n\n## Child\n\nchild\n',
  selector: {
    headingQueries: ['Root', 'Child'],
    requiredQueries: ['Root'],
    includeDescendants: true,
    maxBytes: 4096
  }
})
assert.strictEqual(overlapping.receipt.completion, 'fallback-full')
assert.strictEqual(overlapping.receipt.fallbackReason, 'overlapping-section-ranges')
assert.match(overlapping.body, /child/)

console.log('profile section selector tests passed: exact/contains/order/descendants/fallback/partial/full-oracle mandatoryMiss=0')
