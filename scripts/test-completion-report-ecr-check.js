#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  collectRecentCompletedReportEcrIssues,
  classifyCheckboxEcrFromReportText
} = require('./lib/completion-report-ecr-check')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-ecr-'))
const repDir = path.join(tmp, 'reports', 'requirements', 'grok', '20260721')
fs.mkdirSync(repDir, { recursive: true })

const bad = path.join(repDir, '01--bad-complete.md')
fs.writeFileSync(bad, [
  '# bad',
  '> **类型**: dev',
  '> **状态**: 已完成',
  '',
  '## ECR 执行闭环复审',
  '| ECR-1 | ✅ |',
  '| ECR-2 | ✅ |'
].join('\n'))

const good = path.join(repDir, '02--good-complete.md')
fs.writeFileSync(good, [
  '# good',
  '> **类型**: dev',
  '> **状态**: 已完成',
  '',
  '## ECR 执行闭环复审',
  '| ECR-1 | ✅ |',
  '',
  'npm run test:core exitCode=0 All checks passed'
].join('\n'))

const { checkedFiles, issues } = collectRecentCompletedReportEcrIssues({
  activeRoot: tmp,
  recentDays: 2
})
assert.ok(checkedFiles.length >= 2, 'should check both reports')
assert.ok(issues.some(i => i.includes('bad-complete') && /lacks production command evidence/i.test(i)))
assert.ok(!issues.some(i => i.includes('good-complete')))

assert.strictEqual(
  classifyCheckboxEcrFromReportText(fs.readFileSync(bad, 'utf8')),
  'checkbox-ecr'
)
assert.strictEqual(
  classifyCheckboxEcrFromReportText(fs.readFileSync(good, 'utf8')),
  'ok'
)

console.log('completion-report-ecr-check tests passed')
