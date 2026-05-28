#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const failures = []
const SOURCE_PROJECT_NAME = ['devcodex', 'v1'].join('-')

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8')
}

function mustInclude(file, needle) {
  if (!read(file).includes(needle)) failures.push(`${file} missing "${needle}"`)
}

function mustNotInclude(file, needle, reason) {
  if (read(file).includes(needle)) failures.push(`${file} must not include "${needle}" (${reason})`)
}

const probes = [
  ['skills/spec-governance/SKILL.md', 'RecordRouter'],
  ['skills/spec-governance/SKILL.md', 'SCV-0'],
  ['skills/spec-governance/SKILL.md', 'record.violation'],
  ['skills/spec-governance/SKILL.md', 'record.ambiguous'],
  ['skills/spec-governance/SKILL.md', '你刚才漏了/错了/违反流程了'],
  ['skills/spec-governance/SKILL.md', 'VL/PF 关闭前必须具备修复方案'],
  ['skills/spec-governance/SKILL.md', '当前 DevCodex 源仓或规范维护项目的 active-root'],
  ['instructions.md', '规范治理生命周期（RecordRouter + SCV）'],
  ['instructions.md', '你刚才漏了/错了/违反流程了'],
  ['instructions.md', 'VL/PF 关闭前必须具备修复方案'],
  ['instructions/18-spec-radar.instructions.md', 'Intent Detection → RecordRouter'],
  ['instructions/14-self-fix.instructions.md', 'T_RECORD / RecordRouter'],
  ['skills/intent/SKILL.md', 'record.spec-defect'],
  ['data/templates/violations.md', 'record.violation'],
  ['data/templates/violations.md', '验证证据'],
  ['data/templates/violations.md', '关闭时间'],
  ['data/templates/pending-fixes.md', 'record.spec-defect'],
  ['data/templates/pending-fixes.md', 'SCV要求'],
  ['data/templates/pending-fixes.md', '验证证据'],
  ['data/templates/process-improvements.md', 'record.process-improvement'],
  ['data/templates/pending-issues.md', 'record.pending-issue'],
  ['data/templates/gap-registry.md', 'record.audit-gap'],
  ['data/README.md', '旧 `.devcodex/.maintainer-state/` 只作为历史迁移口径'],
  ['skills/report/SKILL.md', 'SCV-0~SCV-7']
]

for (const [file, needle] of probes) mustInclude(file, needle)

const activeRuleFiles = [
  'README.md',
  'instructions.md',
  'instructions/00-safety.instructions.md',
  'instructions/12-audit.instructions.md',
  'instructions/18-spec-radar.instructions.md',
  'skills/cp-gate/SKILL.md',
  'skills/spec-governance/SKILL.md',
  'data/templates/violations.md',
  'data/templates/pending-fixes.md',
  'data/templates/process-improvements.md',
  'data/templates/pending-issues.md',
  'data/templates/gap-registry.md'
]

for (const file of activeRuleFiles) {
  mustNotInclude(file, '.devcodex/.maintainer-state', 'current governance ledgers must use active-root')
}

const genericDistributedFiles = [
  'instructions.md',
  'instructions/00-safety.instructions.md',
  'instructions/12-audit.instructions.md',
  'skills/spec-governance/SKILL.md',
  'data/README.md',
  'data/templates/violations.md',
  'data/templates/pending-fixes.md',
  'data/templates/process-improvements.md',
  'data/templates/pending-issues.md',
  'data/templates/gap-registry.md'
]

for (const file of genericDistributedFiles) {
  mustNotInclude(file, SOURCE_PROJECT_NAME, 'generic distributed governance assets must not hard-code the source project name')
}

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
