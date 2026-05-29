#!/usr/bin/env node
/**
 * DevCodex — Profile drift detection (v1.9.5+)
 *
 * 检查项目级 .devcodex/profile/ 与 plugin 当前要求是否漂移：
 * - config.json 字段：mode / agent fallback hint / version 是否匹配 plugin.json
 * - README.md / 01-项目信息.md / 02-架构约束.md / 03-代码风格.md 是否存在
 *
 * Exit: 0=OK, 1=missing required, 2=drift warnings only
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { resolveProfileDir } = require('../hooks/_runtime/workspace-layout.cjs')

const PLUGIN_ROOT = path.resolve(__dirname, '..')
const cwd = process.cwd()

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

const profileDir = resolveProfileDir(cwd)

const errors = []
const warnings = []
const pluginVersion = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'plugin.json'), 'utf8')).version
  } catch {
    return ''
  }
})()
const pluginPackageName = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'package.json'), 'utf8')).name || ''
  } catch {
    return ''
  }
})()

function err(msg) { errors.push(msg) }
function warn(msg) { warnings.push(msg) }

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractVersion(label, text) {
  const safeLabel = escapeRegExp(label)
  const patterns = [
    new RegExp(`\\|\\s*\\*\\*${safeLabel}\\*\\*\\s*\\|\\s*v?(\\d+\\.\\d+\\.\\d+)`),
    new RegExp(`^\\s*[-*]\\s*${safeLabel}[：:]\\s*v?(\\d+\\.\\d+\\.\\d+)`, 'm')
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) return match[1]
  }
  return ''
}

function hasLegacyStageDraft(text) {
  return /##\s*当前阶段/m.test(text) &&
    /^\s*[-*]\s*主版本分支[：:]/m.test(text) &&
    /^\s*[-*]\s*阶段摘要[：:]/m.test(text)
}

function isSourceRepoProfileTarget() {
  if (path.resolve(cwd) === PLUGIN_ROOT) return true
  const cwdPackage = readJsonIfExists(path.join(cwd, 'package.json'))
  return !!(pluginPackageName && cwdPackage && cwdPackage.name === pluginPackageName)
}

function hasCurrentAgentsDistribution(text) {
  return /devcodex\/agents\/\s*→\s*\.github\/agents\//.test(text) &&
    /(Copilot[^\n。]*默认分发|默认分发[^\n。]*Copilot)/.test(text) &&
    /(Claude Code[^\n。]*不分发|不分发[^\n。]*Claude Code)/.test(text)
}

function checkProjectInfoSemantics(text) {
  if (/不再作为目标项目默认分发路径/.test(text)) {
    warn('[profile] 01-项目信息.md still contains legacy agents distribution wording')
  }
  if (!hasCurrentAgentsDistribution(text)) {
    warn('[profile] 01-项目信息.md missing current agents distribution truth')
  }
  if (/##\s*授权层级/m.test(text) || /\|\s*\*\*Free\*\*\s*\|/.test(text) || /\|\s*\*\*Pro\*\*\s*\|/.test(text)) {
    warn('[profile] 01-项目信息.md still contains legacy Free/Pro authorization tiers')
  }
  if (!/授权占位/.test(text) || !/全量开放/.test(text)) {
    warn('[profile] 01-项目信息.md missing current authorization placeholder truth')
  }
  if (!/website\/docs\/versions\/v1\/<active-version>\/requirements\//.test(text)) {
    warn('[profile] 01-项目信息.md missing current formal requirement entry')
  }
}

if (!fs.existsSync(profileDir)) {
  const displayPath = path.relative(cwd, profileDir) || profileDir
  console.log(`[profile] no profile dir at ${displayPath} — skip (run \`devcodex profile init\` to bootstrap)`)
  process.exit(0)
}

// Required files
const REQUIRED = ['README.md', '01-项目信息.md', '02-架构约束.md', '03-代码风格.md']
for (const f of REQUIRED) {
  if (!fs.existsSync(path.join(profileDir, f))) {
    err(`[profile] missing required: ${f}`)
  }
}

const projectInfoPath = path.join(profileDir, '01-项目信息.md')
if (pluginVersion && fs.existsSync(projectInfoPath)) {
  const projectInfo = fs.readFileSync(projectInfoPath, 'utf8')
  const currentVersion = extractVersion('当前版本', projectInfo)
  const currentStageVersion = extractVersion('当前阶段', projectInfo)

  if (!currentVersion) {
    warn('[profile] 01-项目信息.md missing 当前版本 entry')
  } else if (currentVersion !== pluginVersion) {
    warn(`[profile] 01-项目信息.md 当前版本漂移: ${currentVersion} → ${pluginVersion}`)
  }

  if (!currentStageVersion) {
    if (!hasLegacyStageDraft(projectInfo)) {
      warn('[profile] 01-项目信息.md missing 当前阶段 version entry')
    }
  } else if (currentStageVersion !== pluginVersion) {
    warn(`[profile] 01-项目信息.md 当前阶段漂移: ${currentStageVersion} → ${pluginVersion}`)
  }

  if (isSourceRepoProfileTarget()) {
    checkProjectInfoSemantics(projectInfo)
  }
}

// config.json checks
const cfgPath = path.join(profileDir, 'config.json')
if (fs.existsSync(cfgPath)) {
  let cfg
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) } catch (e) {
    err(`[profile] config.json invalid JSON: ${e.message}`)
    cfg = {}
  }
  // mode
  if (!cfg.mode) warn('[profile] config.json missing "mode" (defaults to prod)')
  else if (!['dev', 'prod'].includes(cfg.mode)) err(`[profile] invalid mode: ${cfg.mode}`)
  // agent
  const validAgents = ['copilot', 'vscode-copilot', 'jetbrains-copilot', 'claude-code', 'codex', 'cursor', 'unknown-agent']
  if (!cfg.agent) warn('[profile] config.json missing "agent" fallback hint (actual host inferred at runtime)')
  else if (!validAgents.includes(cfg.agent)) err(`[profile] invalid agent: ${cfg.agent} (expected: ${validAgents.join('|')})`)
  // plugin version drift
  if (cfg.pluginVersion) {
    if (pluginVersion && cfg.pluginVersion !== pluginVersion) {
      warn(`[profile] pluginVersion drift: profile says ${cfg.pluginVersion}, plugin is ${pluginVersion} (run \`devcodex update\`)`)
    }
  }
} else {
  warn('[profile] config.json missing — defaults applied (mode=prod, agent inferred)')
}

if (errors.length) {
  console.error(`\x1b[31m✗ ${errors.length} error(s):\x1b[0m`)
  errors.forEach(e => console.error('  ' + e))
}
if (warnings.length) {
  console.warn(`\x1b[33m⚠ ${warnings.length} warning(s):\x1b[0m`)
  warnings.forEach(w => console.warn('  ' + w))
}
if (!errors.length && !warnings.length) {
  console.log('\x1b[32m✓ profile validated\x1b[0m')
}
process.exit(errors.length ? 1 : (warnings.length ? 2 : 0))
