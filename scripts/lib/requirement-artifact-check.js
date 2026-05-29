'use strict'

const fs = require('fs')
const path = require('path')

const RECENT_REQUIREMENT_ARTIFACT_DAYS = 2
const REQUIREMENT_FILES = ['01-需求概述.md', '04-实施计划.md', '05-实施进度.md']

function hasText(filePath, needle) {
  return fs.readFileSync(filePath, 'utf8').includes(needle)
}

function hasAnyText(filePath, needles) {
  const text = fs.readFileSync(filePath, 'utf8')
  return needles.some(needle => text.includes(needle))
}

function hasRecentArtifact(dirPath, nowMs, recentDays) {
  const cutoff = nowMs - recentDays * 24 * 60 * 60 * 1000
  return REQUIREMENT_FILES
    .map(name => path.join(dirPath, name))
    .filter(filePath => fs.existsSync(filePath))
    .some(filePath => fs.statSync(filePath).mtimeMs >= cutoff)
}

function checkRequirementDir(dirPath) {
  const issues = []
  const relDir = path.basename(dirPath)
  const requirementFile = path.join(dirPath, '01-需求概述.md')
  const planFile = path.join(dirPath, '04-实施计划.md')
  const progressFile = path.join(dirPath, '05-实施进度.md')

  if (fs.existsSync(requirementFile) && !hasText(requirementFile, '## 目录导航')) {
    issues.push(`${relDir}/01-需求概述.md missing "## 目录导航"`)
  }

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

  return issues
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
    const hasTrackedArtifact = REQUIREMENT_FILES.some(name => fs.existsSync(path.join(dirPath, name)))
    if (!hasTrackedArtifact) continue
    if (!hasRecentArtifact(dirPath, nowMs, recentDays)) continue
    checkedDirs.push(entry.name)
    issues.push(...checkRequirementDir(dirPath))
  }

  return { checkedDirs, issues }
}

module.exports = {
  RECENT_REQUIREMENT_ARTIFACT_DAYS,
  checkRequirementDir,
  collectRecentRequirementArtifactIssues
}
