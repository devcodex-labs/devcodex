#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  buildBrandVisualQualityChecks,
  classifyBrandVisualEvidence
} = require('./lib/validate-brand-visual-quality')

const complete = {
  masterLineage: true,
  themeGeometryParity: true,
  microOpticalVariant: true,
  monoMaster: true,
  visualEvidencePack: true,
  humanVisualConclusion: true
}

assert.strictEqual(classifyBrandVisualEvidence({ ...complete, reviewerVerdict: 'accepted' }), 'accepted')
assert.strictEqual(classifyBrandVisualEvidence({ ...complete, monoMaster: false, reviewerVerdict: 'accepted' }), 'verification-pending')
assert.strictEqual(classifyBrandVisualEvidence({ ...complete, blockerDetected: true, blockerResetComplete: false, reviewerVerdict: 'accepted' }), 'blocked')
assert.strictEqual(classifyBrandVisualEvidence({ ...complete, reviewerVerdict: 'rejected' }), 'rejected')
assert.strictEqual(classifyBrandVisualEvidence({ ...complete, blockerDetected: true, blockerResetComplete: true, reviewerVerdict: 'accepted' }), 'accepted')

const root = path.resolve(__dirname, '..')
const cleanCheckoutErrors = []
const cleanCheckoutChecks = buildBrandVisualQualityChecks({
  ROOT: root,
  ACTIVE_DEVCODEX_ROOT: path.join(root, '.nonexistent-active-root'),
  fs,
  path,
  read: file => fs.readFileSync(file, 'utf8'),
  err: message => cleanCheckoutErrors.push(message),
  console: { log() {} }
})
cleanCheckoutChecks.checkV97()
assert.deepStrictEqual(cleanCheckoutErrors, [], 'clean checkout without active Profile must use repository consumers')

console.log('✓ brand visual quality positive, incomplete, rejected, blocker-reset and clean-checkout fixtures passed')
