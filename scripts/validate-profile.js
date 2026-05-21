#!/usr/bin/env node
/**
 * DevCodex — Profile drift detection (v1.9.5+)
 *
 * 检查项目级 .devcodex/profile/ 与 plugin 当前要求是否漂移：
 * - config.json 字段：mode / agent / version 是否匹配 plugin.json
 * - README.md / 01-项目信息.md / 02-架构约束.md / 03-代码风格.md 是否存在
 *
 * Exit: 0=OK, 1=missing required, 2=drift warnings only
 */
'use strict'

const fs = require('fs')
const path = require('path')

const PLUGIN_ROOT = path.resolve(__dirname, '..')
const cwd = process.cwd()
const profileDir = path.join(cwd, '.devcodex', 'profile')

const errors = []
const warnings = []

function err(msg) { errors.push(msg) }
function warn(msg) { warnings.push(msg) }

if (!fs.existsSync(profileDir)) {
  console.log(`[profile] no .devcodex/profile/ in ${cwd} — skip (run \`devcodex profile-init\` to bootstrap)`)
  process.exit(0)
}

// Required files
const REQUIRED = ['README.md', '01-项目信息.md', '02-架构约束.md', '03-代码风格.md']
for (const f of REQUIRED) {
  if (!fs.existsSync(path.join(profileDir, f))) {
    err(`[profile] missing required: ${f}`)
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
  const validAgents = ['copilot', 'claude-code', 'codex', 'cursor', 'vscode-copilot', 'unknown-agent']
  if (!cfg.agent) warn('[profile] config.json missing "agent" (inferred at runtime)')
  else if (!validAgents.includes(cfg.agent)) err(`[profile] invalid agent: ${cfg.agent} (expected: ${validAgents.join('|')})`)
  // plugin version drift
  if (cfg.pluginVersion) {
    try {
      const pluginVer = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'plugin.json'), 'utf8')).version
      if (cfg.pluginVersion !== pluginVer) {
        warn(`[profile] pluginVersion drift: profile says ${cfg.pluginVersion}, plugin is ${pluginVer} (run \`devcodex update\`)`)
      }
    } catch { /* plugin.json missing — skip */ }
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
