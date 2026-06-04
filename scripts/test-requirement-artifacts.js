#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  RECENT_REQUIREMENT_ARTIFACT_DAYS,
  hasSimpleTaskFastPathMarker,
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

  write(path.join(requirementsRoot, 'good-requirement', '01-需求概述.md'), [
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

  write(path.join(requirementsRoot, 'bad-requirement', '01-需求概述.md'), '# bad\n')
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
    '01-需求概述.md: N/A + skipReason',
    '04-实施计划.md: N/A + skipReason'
  ].join('\n'))

  const { checkedDirs, issues } = collectRecentRequirementArtifactIssues({
    activeRoot: tempRoot,
    recentDays: RECENT_REQUIREMENT_ARTIFACT_DAYS
  })

  assert(checkedDirs.includes('good-requirement'))
  assert(checkedDirs.includes('bad-requirement'))
  assert(!checkedDirs.includes('old-requirement'))
  assert(!checkedDirs.includes('simple-fast-path'))
  assert(hasSimpleTaskFastPathMarker(path.join(requirementsRoot, 'simple-fast-path')))
  assert(issues.some(item => item.includes('bad-requirement/01-需求概述.md missing "## 目录导航"')))
  assert(issues.some(item => item.includes('bad-requirement/04-实施计划.md missing plan mode')))
  assert(issues.some(item => item.includes('bad-requirement/04-实施计划.md missing rollback section')))
  assert(issues.some(item => item.includes('bad-requirement/05-实施进度.md missing "支撑产物状态"')))
  assert(!issues.some(item => item.includes('good-requirement')))

  console.log('Requirement runtime artifact checks passed')
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
