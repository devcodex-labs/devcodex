#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { normalizeCommandLine, planValidation } = require('./lib/validation-dag')

const ROOT = path.resolve(__dirname, '..')
const map = JSON.parse(fs.readFileSync(path.join(__dirname, 'critical-risk-coverage.json'), 'utf8'))
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'validation-manifest.json'), 'utf8'))
const coverage = JSON.parse(fs.readFileSync(path.join(__dirname, 'critical-coverage.json'), 'utf8'))

assert.strictEqual(map.schemaVersion, 'CriticalRiskCoverageMapV1')
assert.deepStrictEqual(
  map.findings.map(item => item.id),
  Array.from({ length: 15 }, (_, index) => `BUG-${String(index + 1).padStart(2, '0')}`),
  'risk map must cover every accepted bug, including the complete screenshot recovery chain'
)
assert.match(map.subprocessCoveragePolicy, /no line-coverage claim/i)

assert.strictEqual(manifest.routes.fast.dynamic, true, 'fast must remain an impact-driven V0 route')
assert.ok(!Array.isArray(manifest.routes.fast.nodes), 'fast must not retain a static near-full node list')
assert.deepStrictEqual(map.iterativeRoutePolicy.requiredV3Routes, ['full'])
const fullPlan = new Set(planValidation({ manifest, route: 'full' }).selectedNodes.map(node => node.id))
for (const invariant of map.iterativeRoutePolicy.requiredInvariantNodes) {
  assert.ok(manifest.iterativeInvariantNodes.includes(invariant), `iterative invariant missing: ${invariant}`)
}

for (const finding of map.findings) {
  assert.ok(['P1', 'P2', 'P3'].includes(finding.risk), `${finding.id} risk must be explicit`)
  assert.ok(Array.isArray(finding.modules) && finding.modules.length > 0, `${finding.id} modules missing`)
  for (const relative of finding.modules) {
    assert.ok(fs.existsSync(path.join(ROOT, relative)), `${finding.id} module missing: ${relative}`)
  }
  const node = manifest.nodes.find(item => item.id === finding.validationNode)
  assert.ok(node, `${finding.id} validation node missing: ${finding.validationNode}`)
  assert.strictEqual(normalizeCommandLine(node.command, node.args), finding.testCommand, `${finding.id} command drift`)
  const probePath = path.join(ROOT, finding.probeSource)
  assert.ok(fs.existsSync(probePath), `${finding.id} probe source missing`)
  assert.ok(fs.readFileSync(probePath, 'utf8').includes(finding.negativeProbeMarker), `${finding.id} negative probe marker missing`)
  const impactPlan = planValidation({
    manifest,
    route: 'fast',
    changedFiles: finding.modules,
    changedSource: 'critical-risk-map',
    candidateStable: true,
    candidateId: `critical-risk-${finding.id}`
  })
  const impactNodes = new Set(impactPlan.selectedNodes.map(item => item.id))
  assert.notStrictEqual(impactPlan.verificationLevel, 'V3', `${finding.id} risk coverage must not authorize V3`)
  assert.ok(impactNodes.has(finding.validationNode), `${finding.id} authoritative node missing from its impact plan`)
  assert.ok(fullPlan.has(finding.validationNode), `${finding.id} authoritative node missing from explicit full`)
}

const highRiskPlan = planValidation({
  manifest,
  route: 'fast',
  changedFiles: ['scripts/lib/validation-dag.js'],
  changedSource: 'critical-risk-negative-probe',
  riskClass: 'high',
  candidateStable: true,
  candidateId: 'critical-risk-no-v3-authority'
})
assert.strictEqual(highRiskPlan.verificationLevel, 'V2')
assert.strictEqual(highRiskPlan.routeResolved, 'boundary')
assert.strictEqual(highRiskPlan.fullFallback, null)
assert.ok(highRiskPlan.selectedNodeCount < highRiskPlan.fullNodeCount, 'risk label silently expanded to full')

const configuredCoverage = new Set((coverage.modules || []).map(item => item.path))
for (const item of map.directCoverageModules || []) {
  assert.strictEqual(item.coverageMode, 'direct-branch-threshold')
  assert.ok(fs.existsSync(path.join(ROOT, item.path)), `direct coverage module missing: ${item.path}`)
  assert.ok(configuredCoverage.has(item.path), `critical coverage threshold missing: ${item.path}`)
}

const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')
assert.match(workflow, /windows-latest/, 'Windows junction lane missing')
assert.match(workflow, /ubuntu-latest/, 'Unix symlink lane missing')
assert.match(workflow, /node:\s*18\.17\.0/, 'exact minimum Node lane missing')

console.log(`critical risk coverage passed: findings=${map.findings.length} directModules=${map.directCoverageModules.length}`)
