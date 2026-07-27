'use strict'

/**
 * ImplementStartGate: unbound fail-closed + design artifacts for control-plane.
 * Prevents "will follow process" then mutate scripts/hooks without requirement package.
 */

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  classifyImplementStartGate,
  ERROR_CODES
} = require('./lib/process-enforcement.js')

// unbound control-plane → fail
{
  const r = classifyImplementStartGate({ controlPlaneMutation: true, taskRoot: null })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, ERROR_CODES.IMPLEMENT_START_WITHOUT_TASK_BINDING)
  assert.strictEqual(r.unbound, true)
}

// skip still ok
{
  const r = classifyImplementStartGate({ controlPlaneMutation: true, taskRoot: null, skip: true })
  assert.strictEqual(r.ok, true)
}

// triad only, no 00/01/02 → design fail
{
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-triad-'))
  fs.writeFileSync(path.join(t, '04-实施计划.md'), '#')
  fs.writeFileSync(path.join(t, '05-实施进度.md'), '#')
  fs.writeFileSync(path.join(t, '03-复审清单.md'), '#')
  const r = classifyImplementStartGate({ controlPlaneMutation: true, taskRoot: t, fs })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, ERROR_CODES.IMPLEMENT_START_WITHOUT_DESIGN)
  fs.rmSync(t, { recursive: true, force: true })
}

// full package → ok
{
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-full-'))
  for (const name of [
    '00-需求概况.md',
    '01-需求确认.md',
    '02-技术方案.md',
    '04-实施计划.md',
    '05-实施进度.md',
    '03-复审清单.md'
  ]) {
    fs.writeFileSync(path.join(t, name), '#\n')
  }
  const r = classifyImplementStartGate({ controlPlaneMutation: true, taskRoot: t, fs })
  assert.strictEqual(r.ok, true, JSON.stringify(r))
  fs.rmSync(t, { recursive: true, force: true })
}

// non-control-plane → ok without task
{
  const r = classifyImplementStartGate({ controlPlaneMutation: false, taskRoot: null })
  assert.strictEqual(r.ok, true)
}

console.log('test-implement-start-gate: ok')
