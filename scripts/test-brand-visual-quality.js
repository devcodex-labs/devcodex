#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  buildBrandVisualQualityChecks,
  classifyBrandVisualEvidence,
  classifyComponentTransparencyTopology
} = require('./lib/validate-brand-visual-quality')

const complete = {
  masterLineage: true,
  themeGeometryParity: true,
  microOpticalVariant: true,
  monoMaster: true,
  visualEvidencePack: true,
  humanVisualConclusion: true,
  componentTransparencyTopology: true
}

assert.strictEqual(classifyBrandVisualEvidence({ ...complete, reviewerVerdict: 'accepted', topologyVerdict: 'pass' }), 'accepted')
assert.strictEqual(classifyBrandVisualEvidence({ ...complete, monoMaster: false, reviewerVerdict: 'accepted' }), 'verification-pending')
assert.strictEqual(classifyBrandVisualEvidence({ ...complete, componentTransparencyTopology: false, reviewerVerdict: 'accepted' }), 'verification-pending')
assert.strictEqual(classifyBrandVisualEvidence({ ...complete, blockerDetected: true, blockerResetComplete: false, reviewerVerdict: 'accepted' }), 'blocked')
assert.strictEqual(classifyBrandVisualEvidence({ ...complete, topologyVerdict: 'topology-fail', reviewerVerdict: 'accepted' }), 'blocked')
assert.strictEqual(classifyBrandVisualEvidence({ ...complete, reviewerVerdict: 'rejected' }), 'rejected')
assert.strictEqual(classifyBrandVisualEvidence({ ...complete, blockerDetected: true, blockerResetComplete: true, reviewerVerdict: 'accepted', topologyVerdict: 'pass' }), 'accepted')

assert.strictEqual(classifyComponentTransparencyTopology({
  canvasCornersTransparent: true,
  globalOpaqueRatio: 0.2,
  centerRoiOpaqueRatio: 1,
  componentFillContract: 'wireframe-holes',
  expectedCenterTransparent: true
}), 'topology-fail')
assert.strictEqual(classifyComponentTransparencyTopology({
  canvasCornersTransparent: true,
  globalOpaqueRatio: 0.2,
  centerRoiOpaqueRatio: 0.3,
  componentFillContract: 'wireframe-holes',
  componentTopologyVerified: true
}), 'pass')

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
