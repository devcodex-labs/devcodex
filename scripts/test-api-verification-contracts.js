#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const prompt = fs.readFileSync(path.join(ROOT, 'prompts/api-verification.prompt.md'), 'utf8')
const skill = fs.readFileSync(path.join(ROOT, 'skills/api-verification/SKILL.md'), 'utf8')

for (const content of [prompt, skill]) {
  for (const needle of ['process.env.API_BASE_URL', 'Endpoint matrix is empty', 'ENDPOINTS.length', 'runTests()', 'getPath']) {
    assert.ok(content.includes(needle), `API verification contract missing ${needle}`)
  }
}
assert.ok(prompt.includes('CONTRACT.createdIdPath'))
assert.ok(prompt.includes('CONTRACT.listItemsPath'))
assert.ok(!prompt.includes('list.data.items'), 'prompt must not hard-code root response shape')
assert.ok(!prompt.includes('created.data.id'), 'prompt must not hard-code root response shape')
assert.match(skill, /响应 extractor\/jsonPath 必须来自/)

function validateEndpointMatrix(endpoints) {
  if (!Array.isArray(endpoints) || endpoints.length === 0) {
    throw new Error('Endpoint matrix is empty; refusing a false-green API verification')
  }
  for (const endpoint of endpoints) {
    assert.ok(endpoint.method && endpoint.path && endpoint.expectedStatus)
    assert.strictEqual(typeof endpoint.assertResponse, 'function')
  }
}

assert.throws(() => validateEndpointMatrix([]), /false-green/)
assert.doesNotThrow(() => validateEndpointMatrix([{ method: 'GET', path: '/health', expectedStatus: 200, assertResponse: () => {} }]))

console.log('✓ API endpoint matrix, execution entry and response extractor contracts passed')
