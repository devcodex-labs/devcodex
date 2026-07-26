'use strict'

/**
 * F-06 / T11: control-plane path table + safety-only vs strict CP gate honesty notes.
 * Does not boot full lifecycle host; validates CONTROL_PLANE_SOURCE_RE coverage and
 * documents enforcement split (strict deny / safety-only disclose).
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const lifecyclePath = path.join(__dirname, '../hooks/_runtime/lifecycle.cjs')
const src = fs.readFileSync(lifecyclePath, 'utf8')

// Extract CONTROL_PLANE_SOURCE_RE from source
const m = src.match(/const CONTROL_PLANE_SOURCE_RE = (\/.+\/i)/)
assert.ok(m, 'CONTROL_PLANE_SOURCE_RE must exist in lifecycle.cjs')
// eslint-disable-next-line no-new-func
const CONTROL_PLANE_SOURCE_RE = Function(`return ${m[1]}`)()

const mustHit = [
  'hooks/_runtime/lifecycle.cjs',
  'scripts/validate.js',
  'instructions/01-common.instructions.md',
  'skills/cp-gate/SKILL.md',
  'host-projections/foo.md',
  'package.json',
  'website/docs/intro/host-parity-grok.md'
]
for (const p of mustHit) {
  assert.ok(CONTROL_PLANE_SOURCE_RE.test(p), `expected control-plane hit: ${p}`)
}

const mustMiss = [
  'src/app.js',
  'README-user.md',
  'docs/user-guide/getting-started.md',
  'frontend/pages/index.vue'
]
for (const p of mustMiss) {
  assert.ok(!CONTROL_PLANE_SOURCE_RE.test(p), `expected non-control-plane: ${p}`)
}

// safety-only honesty path present
assert.match(src, /cp2-unconfirmed-write/)
assert.match(src, /safety-only/)
// strict uses buildCpDenyOutput / isStrictEnforcement
assert.match(src, /isStrictEnforcement\(\)/)
assert.match(src, /buildCpDenyOutput/)

// F-05 R9 stop wiring present
assert.match(src, /evaluateStopCompletionGate/)
assert.match(src, /stop-completion-gate/)

// Process-enforcement D1: hard-deny protected paths under safety-only
assert.match(src, /shouldHardDenyCpMutation/)
assert.match(src, /process-enforcement\.js/)
assert.match(src, /classifyPathsForArtifacts/)

console.log('r10 control-plane honesty / path table tests passed')
