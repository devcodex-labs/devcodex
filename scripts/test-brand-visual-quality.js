#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { classifyBrandVisualEvidence } = require('./lib/validate-brand-visual-quality')

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

console.log('✓ brand visual quality positive, incomplete, rejected and blocker-reset fixtures passed')
