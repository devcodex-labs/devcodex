'use strict'

const fs = require('fs')
const path = require('path')

const RECENT_REQUIREMENT_ARTIFACT_DAYS = 2
const REQUIREMENT_FILES = [
  '00-需求概况.md',
  '00-需求变更概况.md',
  '01-需求确认.md',
  '01-产品需求.md',
  '01-需求变更确认.md',
  '01-需求概述.md',
  '04-实施计划.md',
  '05-实施进度.md'
]
const BUG_FILES = ['00-问题概况.md', '01-问题确认.md', '04-实施计划.md', '05-实施进度.md']
const SIMPLE_TASK_FAST_PATH_MARKERS = ['SimpleTaskFastPath', '简单任务轻路径', 'N/A + skipReason']

function hasText(filePath, needle) {
  return fs.readFileSync(filePath, 'utf8').includes(needle)
}

function hasAnyText(filePath, needles) {
  const text = fs.readFileSync(filePath, 'utf8')
  return needles.some(needle => text.includes(needle))
}

function hasRecentArtifact(dirPath, nowMs, recentDays, files) {
  const cutoff = nowMs - recentDays * 24 * 60 * 60 * 1000
  return files
    .map(name => path.join(dirPath, name))
    .filter(filePath => fs.existsSync(filePath))
    .some(filePath => fs.statSync(filePath).mtimeMs >= cutoff)
}

function checkPlanAndProgressFiles(dirPath, relDir, issues) {
  const planFile = path.join(dirPath, '04-实施计划.md')
  const progressFile = path.join(dirPath, '05-实施进度.md')

  if (fs.existsSync(planFile)) {
    if (!hasText(planFile, '## 目录导航')) {
      issues.push(`${relDir}/04-实施计划.md missing "## 目录导航"`)
    }
    if (!hasText(planFile, '计划模式')) {
      issues.push(`${relDir}/04-实施计划.md missing plan mode`)
    }
    if (!hasAnyText(planFile, ['验证路线', '独立验证方式', '验证方式'])) {
      issues.push(`${relDir}/04-实施计划.md missing validation section`)
    }
    if (!hasAnyText(planFile, ['回滚摘要', '回滚触发', '回滚方案'])) {
      issues.push(`${relDir}/04-实施计划.md missing rollback section`)
    }
  }

  if (fs.existsSync(progressFile)) {
    const requiredNeedles = [
      '当前轮次',
      '当前 CP',
      '当前批次',
      '## 目录导航',
      '进度总览',
      '支撑产物状态',
      '本轮验证结果',
      '阻塞与恢复',
      '下一步',
      '变更记录'
    ]
    for (const needle of requiredNeedles) {
      if (!hasText(progressFile, needle)) {
        issues.push(`${relDir}/05-实施进度.md missing "${needle}"`)
      }
    }
  }
}

function checkRequirementDir(dirPath) {
  const issues = []
  const relDir = path.basename(dirPath)

  for (const fileName of ['00-需求概况.md', '00-需求变更概况.md']) {
    const filePath = path.join(dirPath, fileName)
    if (fs.existsSync(filePath) && !hasText(filePath, '## 目录导航')) {
      issues.push(`${relDir}/${fileName} missing "## 目录导航"`)
    }
  }

  for (const fileName of ['01-需求确认.md', '01-产品需求.md', '01-需求变更确认.md', '01-需求概述.md']) {
    const filePath = path.join(dirPath, fileName)
    if (fs.existsSync(filePath) && !hasText(filePath, '## 目录导航')) {
      issues.push(`${relDir}/${fileName} missing "## 目录导航"`)
    }
  }

  checkPlanAndProgressFiles(dirPath, relDir, issues)

  return issues
}

function checkBugDir(dirPath) {
  const issues = []
  const relDir = path.basename(dirPath)

  for (const fileName of ['00-问题概况.md', '01-问题确认.md']) {
    const filePath = path.join(dirPath, fileName)
    if (fs.existsSync(filePath) && !hasText(filePath, '## 目录导航')) {
      issues.push(`${relDir}/${fileName} missing "## 目录导航"`)
    }
  }

  checkPlanAndProgressFiles(dirPath, relDir, issues)

  return issues
}

function hasSimpleTaskFastPathMarker(dirPath) {
  const sessionsFile = path.join(dirPath, '.memory', 'sessions.md')
  if (!fs.existsSync(sessionsFile)) return false
  return hasAnyText(sessionsFile, SIMPLE_TASK_FAST_PATH_MARKERS)
}

function collectRecentRequirementArtifactIssues({
  activeRoot,
  recentDays = RECENT_REQUIREMENT_ARTIFACT_DAYS,
  nowMs = Date.now()
}) {
  const requirementsRoot = path.join(activeRoot, 'requirements')
  const checkedDirs = []
  const issues = []

  if (!fs.existsSync(requirementsRoot)) {
    return { checkedDirs, issues }
  }

  for (const entry of fs.readdirSync(requirementsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dirPath = path.join(requirementsRoot, entry.name)
    if (hasSimpleTaskFastPathMarker(dirPath)) continue
    const hasTrackedArtifact = REQUIREMENT_FILES.some(name => fs.existsSync(path.join(dirPath, name)))
    if (!hasTrackedArtifact) continue
    if (!hasRecentArtifact(dirPath, nowMs, recentDays, REQUIREMENT_FILES)) continue
    checkedDirs.push(entry.name)
    issues.push(...checkRequirementDir(dirPath))
  }

  return { checkedDirs, issues }
}

function collectRecentBugArtifactIssues({
  activeRoot,
  recentDays = RECENT_REQUIREMENT_ARTIFACT_DAYS,
  nowMs = Date.now()
}) {
  const bugsRoot = path.join(activeRoot, 'bugs')
  const checkedDirs = []
  const issues = []

  if (!fs.existsSync(bugsRoot)) {
    return { checkedDirs, issues }
  }

  for (const entry of fs.readdirSync(bugsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dirPath = path.join(bugsRoot, entry.name)
    if (hasSimpleTaskFastPathMarker(dirPath)) continue
    const hasTrackedArtifact = BUG_FILES.some(name => fs.existsSync(path.join(dirPath, name)))
    if (!hasTrackedArtifact) continue
    if (!hasRecentArtifact(dirPath, nowMs, recentDays, BUG_FILES)) continue
    checkedDirs.push(entry.name)
    issues.push(...checkBugDir(dirPath))
  }

  return { checkedDirs, issues }
}

module.exports = {
  RECENT_REQUIREMENT_ARTIFACT_DAYS,
  BUG_FILES,
  REQUIREMENT_FILES,
  SIMPLE_TASK_FAST_PATH_MARKERS,
  checkBugDir,
  checkRequirementDir,
  hasSimpleTaskFastPathMarker,
  collectRecentBugArtifactIssues,
  collectRecentRequirementArtifactIssues
}
