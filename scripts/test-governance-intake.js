#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const failures = []

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8')
}

function mustInclude(file, needle, label = needle) {
  if (!read(file).includes(needle)) {
    failures.push(`${file} missing "${label}"`)
  }
}

function mustNotInclude(file, needle, reason) {
  if (read(file).includes(needle)) {
    failures.push(`${file} must not include "${needle}" (${reason})`)
  }
}

const probes = [
  ['instructions.md', 'Improvement Intake（优化清单）'],
  ['instructions.md', '所有模式命中后都必须显式回执'],
  ['instructions/01-common.instructions.md', 'Improvement Intake（优化清单）'],
  ['instructions/01-common.instructions.md', '所有模式下，每条用户消息完成合理性评估后'],
  ['instructions/01-common.instructions.md', '业务局部诉求'],
  ['skills/spec-governance/SKILL.md', 'Improvement Intake（优化清单）'],
  ['skills/spec-governance/SKILL.md', '在所有模式下'],
  ['skills/spec-governance/SKILL.md', 'PI + PF'],
  ['skills/spec-governance/SKILL.md', '所有模式下，主动 Intake 完成后必须显式回执'],
  ['instructions/18-spec-radar.instructions.md', 'RecordRouter / Improvement Intake'],
  ['instructions/18-spec-radar.instructions.md', '全模式规则执行'],
  ['data/templates/process-improvements.md', '优化清单'],
  ['data/templates/process-improvements.md', '触发来源'],
  ['data/templates/process-improvements.md', '关联缺口'],
  ['data/README.md', '优化清单（PI）'],
  ['data/README.md', '承载 DevCodex 规范资产的 active-root'],
  ['README.md', '规范治理 Intake'],
  ['skills/load-profile/SKILL.md', 'config.local.json'],
  ['skills/load-profile/SKILL.md', 'extensions.<namespace>'],
  ['skills/load-profile/SKILL.md', '不得覆盖 `mode` / `agent` / `pluginVersion`'],
  ['prompts/project-profile.prompt.md', 'config.local.json'],
  ['prompts/project-profile.prompt.md', 'extensions.<namespace>']
]

for (const [file, needle] of probes) {
  mustInclude(file, needle)
}

const forbidden = [
  ['instructions.md', 'dev 模式需显式回执已记录的 `PI-xxx / PF-xxx`', 'Improvement Intake 回执已改为全模式'],
  ['instructions.md', '在 `dev` 模式下，每条用户消息在完成合理性评估后', 'Improvement Intake 不再区分 dev/prod'],
  ['instructions/01-common.instructions.md', 'dev 模式必须回执 `已记录 PI-xxx / PF-xxx`', 'Improvement Intake 回执已改为全模式'],
  ['instructions/01-common.instructions.md', 'dev 模式必须显式回执', 'Improvement Intake 回执已改为全模式'],
  ['skills/spec-governance/SKILL.md', '在 `dev` 模式下，除了处理“记录一下”这类显式记录请求', '主动 Intake 已改为全模式'],
  ['skills/spec-governance/SKILL.md', 'dev 模式下，主动 Intake 完成后必须显式回执', '主动 Intake 回执已改为全模式'],
  ['skills/intent/SKILL.md', 'dev 模式下还要执行主动 Improvement Intake', '主动 Intake 已改为全模式'],
  ['instructions/18-spec-radar.instructions.md', '当前 dev 模式消息经合理性评估后命中', '前置判断不再绑定 dev 消息'],
  ['data/templates/process-improvements.md', 'dev 模式需回执', '模板说明已改为全模式'],
  ['README.md', 'dev 模式下每条用户消息在合理性评估后都会额外检查', 'README 说明已改为全模式'],
  ['README.md', 'dev 模式下每条用户消息还会执行主动 Improvement Intake', 'README 说明已改为全模式'],
  ['website/docs/guide/development.md', 'dev 模式下若用户建议经验证更优且可泛化', '用户文档说明已改为全模式'],
  ['changelogs/unreleased.md', 'dev 模式下对可泛化更优策略或规范缺口执行主动记录', '变更记录已改为全模式']
]

for (const [file, needle, reason] of forbidden) {
  mustNotInclude(file, needle, reason)
}

if (failures.length) {
  console.error('Governance intake checks failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Governance intake checks passed')
