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

const plans = Object.fromEntries(['fast', 'full', 'package-release'].map(route => [
  route,
  new Set(planValidation({ manifest, route }).selectedNodes.map(node => node.id))
]))
const directRoutes = Object.fromEntries(['fast', 'full', 'package-release'].map(route => [route, new Set(manifest.routes[route].nodes)]))
assert.ok(
  directRoutes.full.size - directRoutes.fast.size >= map.fastRoutePolicy.minimumDirectNodeDelta,
  'fast route does not preserve the accepted node-count reduction boundary'
)
for (const nodeId of map.fastRoutePolicy.excludedReleaseIntegrationNodes) {
  assert.ok(!directRoutes.fast.has(nodeId), `${nodeId} must stay outside fast`)
  for (const route of map.fastRoutePolicy.requiredReleaseRoutes) {
    assert.ok(directRoutes[route].has(nodeId), `${nodeId} must remain mandatory in ${route}`)
  }
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
  for (const route of Object.keys(plans)) {
    assert.ok(plans[route].has(finding.validationNode), `${finding.id} authoritative node missing from ${route}`)
  }
}

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
