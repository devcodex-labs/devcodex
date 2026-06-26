#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  RECENT_REQUIREMENT_ARTIFACT_DAYS,
  hasSimpleTaskFastPathMarker,
  collectRecentBugArtifactIssues,
  collectRecentRequirementArtifactIssues
} = require('./lib/requirement-artifact-check')

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
}

function setAge(filePath, daysAgo) {
  const time = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)
  fs.utimesSync(filePath, time, time)
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-v41-'))

try {
  const requirementsRoot = path.join(tempRoot, 'requirements')
  const bugsRoot = path.join(tempRoot, 'bugs')

  write(path.join(requirementsRoot, 'good-requirement', '00-需求概况.md'), [
    '# overview',
    '',
    '## 目录导航',
    '',
    '- [需求一句话](#需求一句话)'
  ].join('\n'))
  write(path.join(requirementsRoot, 'good-requirement', '01-需求确认.md'), [
    '# good',
    '',
    '## 目录导航',
    '',
    '- [背景](#背景)'
  ].join('\n'))
  write(path.join(requirementsRoot, 'good-requirement', '04-实施计划.md'), [
    '# plan',
    '',
    '> 计划模式：轻计划摘要',
    '',
    '## 目录导航',
    '',
    '## 验证路线',
    '',
    '## 回滚摘要'
  ].join('\n'))
  write(path.join(requirementsRoot, 'good-requirement', '05-实施进度.md'), [
    '# progress',
    '',
    '> 当前轮次：R1',
    '> 当前 CP：执行中',
    '> 当前批次：Batch 1 / 3',
    '',
    '## 目录导航',
    '',
    '## 进度总览',
    '',
    '## 支撑产物状态',
    '',
    '**本轮验证结果**：',
    '',
    '## 阻塞与恢复',
    '',
    '## 下一步',
    '',
    '## 变更记录'
  ].join('\n'))

  write(path.join(requirementsRoot, 'good-change', '00-需求变更概况.md'), [
    '# change overview',
    '',
    '## 目录导航',
    '',
    '- [原需求基线](#原需求基线)'
  ].join('\n'))
  write(path.join(requirementsRoot, 'good-change', '01-需求变更确认.md'), [
    '# change',
    '',
    '## 目录导航',
    '',
    '- [变更前后差异](#变更前后差异)'
  ].join('\n'))
  write(path.join(requirementsRoot, 'good-product-requirement', '01-产品需求.md'), [
    '# product requirement',
    '',
    '## 目录导航',
    '',
    '- [产品完整需求](#产品完整需求)'
  ].join('\n'))

  write(path.join(requirementsRoot, 'bad-requirement', '00-需求概况.md'), '# bad overview\n')
  write(path.join(requirementsRoot, 'bad-requirement', '01-需求确认.md'), '# bad\n')
  write(path.join(requirementsRoot, 'bad-product-requirement', '01-产品需求.md'), '# bad product requirement\n')
  write(path.join(requirementsRoot, 'bad-change', '00-需求变更概况.md'), '# bad change overview\n')
  write(path.join(requirementsRoot, 'bad-change', '01-需求变更确认.md'), '# bad change\n')
  write(path.join(requirementsRoot, 'bad-requirement', '04-实施计划.md'), [
    '# bad plan',
    '',
    '## 目录导航',
    '',
    '## 验证路线'
  ].join('\n'))
  write(path.join(requirementsRoot, 'bad-requirement', '05-实施进度.md'), [
    '# bad progress',
    '',
    '> 当前轮次：R1',
    '> 当前 CP：执行中',
    '',
    '## 目录导航',
    '',
    '## 进度总览'
  ].join('\n'))

  write(path.join(requirementsRoot, 'old-requirement', '01-需求概述.md'), '# old\n')
  setAge(path.join(requirementsRoot, 'old-requirement', '01-需求概述.md'), RECENT_REQUIREMENT_ARTIFACT_DAYS + 10)

  write(path.join(requirementsRoot, 'simple-fast-path', '.memory', 'sessions.md'), [
    '# sessions',
    '',
    'SimpleTaskFastPath: applied',
    '00-需求概况.md: N/A + skipReason',
    '01-需求确认.md: N/A + skipReason',
    '01-产品需求.md: N/A + skipReason',
    '04-实施计划.md: N/A + skipReason'
  ].join('\n'))

  write(path.join(bugsRoot, 'good-bug', '00-问题概况.md'), [
    '# bug overview',
    '',
    '## 目录导航',
    '',
    '- [重现步骤](#重现步骤)'
  ].join('\n'))
  write(path.join(bugsRoot, 'good-bug', '01-问题确认.md'), [
    '# bug confirmation',
    '',
    '## 目录导航',
    '',
    '- [根因](#根因)'
  ].join('\n'))
  write(path.join(bugsRoot, 'bad-bug', '00-问题概况.md'), '# bad bug overview\n')
  write(path.join(bugsRoot, 'bad-bug', '01-问题确认.md'), '# bad bug confirmation\n')
  write(path.join(bugsRoot, 'simple-fast-path-bug', '.memory', 'sessions.md'), [
    '# sessions',
    '',
    'SimpleTaskFastPath: applied',
    '00-问题概况.md: N/A + skipReason',
    '01-问题确认.md: N/A + skipReason'
  ].join('\n'))

  const { checkedDirs, issues } = collectRecentRequirementArtifactIssues({
    activeRoot: tempRoot,
    recentDays: RECENT_REQUIREMENT_ARTIFACT_DAYS
  })

  assert(checkedDirs.includes('good-requirement'))
  assert(checkedDirs.includes('good-change'))
  assert(checkedDirs.includes('good-product-requirement'))
  assert(checkedDirs.includes('bad-requirement'))
  assert(checkedDirs.includes('bad-change'))
  assert(checkedDirs.includes('bad-product-requirement'))
  assert(!checkedDirs.includes('old-requirement'))
  assert(!checkedDirs.includes('simple-fast-path'))
  assert(hasSimpleTaskFastPathMarker(path.join(requirementsRoot, 'simple-fast-path')))
  assert(issues.some(item => item.includes('bad-requirement/00-需求概况.md missing "## 目录导航"')))
  assert(issues.some(item => item.includes('bad-requirement/01-需求确认.md missing "## 目录导航"')))
  assert(issues.some(item => item.includes('bad-product-requirement/01-产品需求.md missing "## 目录导航"')))
  assert(issues.some(item => item.includes('bad-change/00-需求变更概况.md missing "## 目录导航"')))
  assert(issues.some(item => item.includes('bad-change/01-需求变更确认.md missing "## 目录导航"')))
  assert(issues.some(item => item.includes('bad-requirement/04-实施计划.md missing plan mode')))
  assert(issues.some(item => item.includes('bad-requirement/04-实施计划.md missing rollback section')))
  assert(issues.some(item => item.includes('bad-requirement/05-实施进度.md missing "支撑产物状态"')))
  assert(!issues.some(item => item.includes('good-requirement')))
  assert(!issues.some(item => item.includes('good-product-requirement')))

  const bugResult = collectRecentBugArtifactIssues({
    activeRoot: tempRoot,
    recentDays: RECENT_REQUIREMENT_ARTIFACT_DAYS
  })

  assert(bugResult.checkedDirs.includes('good-bug'))
  assert(bugResult.checkedDirs.includes('bad-bug'))
  assert(!bugResult.checkedDirs.includes('simple-fast-path-bug'))
  assert(hasSimpleTaskFastPathMarker(path.join(bugsRoot, 'simple-fast-path-bug')))
  assert(bugResult.issues.some(item => item.includes('bad-bug/00-问题概况.md missing "## 目录导航"')))
  assert(bugResult.issues.some(item => item.includes('bad-bug/01-问题确认.md missing "## 目录导航"')))
  assert(!bugResult.issues.some(item => item.includes('good-bug')))

  console.log('Requirement runtime artifact checks passed')
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
