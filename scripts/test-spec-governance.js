#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const failures = []

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8')
}

function mustInclude(file, needle) {
  if (!read(file).includes(needle)) failures.push(`${file} missing "${needle}"`)
}

const probes = [
  ['skills/spec-governance/SKILL.md', 'RecordRouter'],
  ['skills/spec-governance/SKILL.md', 'SCV-0'],
  ['skills/spec-governance/SKILL.md', 'record.violation'],
  ['skills/spec-governance/SKILL.md', 'record.ambiguous'],
  ['instructions.md', '规范治理生命周期（RecordRouter + SCV）'],
  ['instructions/18-spec-radar.instructions.md', 'Intent Detection → RecordRouter'],
  ['instructions/14-self-fix.instructions.md', 'T_RECORD / RecordRouter'],
  ['skills/intent/SKILL.md', 'record.spec-defect'],
  ['data/templates/violations.md', 'record.violation'],
  ['data/templates/pending-fixes.md', 'record.spec-defect'],
  ['data/templates/process-improvements.md', 'record.process-improvement'],
  ['data/templates/pending-issues.md', 'record.pending-issue'],
  ['data/templates/gap-registry.md', 'record.audit-gap'],
  ['skills/report/SKILL.md', 'SCV-0~SCV-7']
]

for (const [file, needle] of probes) mustInclude(file, needle)

const plugin = JSON.parse(read('plugin.json'))
if (!plugin.skills.some(skill => skill.id === 'spec-governance' && skill.file === 'skills/spec-governance/SKILL.md')) {
  failures.push('plugin.json missing spec-governance skill entry')
}

if (failures.length) {
  console.error('Spec governance checks failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Spec governance checks passed')
