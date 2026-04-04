#!/usr/bin/env node
/**
 * DevCodex v5 规范一致性检查工具
 * 检查 v5 目录下所有文件的规范符合性
 * 
 * 用法: node tools/v5-full-audit.js [--fix]
 */

'use strict'

const fs = require('fs')
const path = require('path')

const V5_ROOT = path.join(__dirname, '..')
const ERRORS = []
const WARNINGS = []

// ─── 检查项定义 ───────────────────────────────────────────────────────────────

const CHECKS = [
  {
    name: 'C01: SKILL.md frontmatter 完整性',
    run: checkSkillFrontmatter
  },
  {
    name: 'C02: Agent frontmatter 完整性',
    run: checkAgentFrontmatter
  },
  {
    name: 'C03: Instructions applyTo 存在',
    run: checkInstructionsApplyTo
  },
  {
    name: 'C04: Prompt mode 字段存在',
    run: checkPromptMode
  },
  {
    name: 'C05: routing.skill.md 子类型表完整性',
    run: checkRoutingTable
  },
  {
    name: 'C06: 报告目录路径一致性',
    run: checkReportPaths
  },
  {
    name: 'C07: plugin.json 注册数量一致性',
    run: checkPluginJson
  }
]

// ─── 检查实现 ─────────────────────────────────────────────────────────────────

function getAllFiles(dir, ext) {
  const results = []
  if (!fs.existsSync(dir)) return results
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) results.push(...getAllFiles(full, ext))
    else if (!ext || entry.name.endsWith(ext)) results.push(full)
  }
  return results
}

function parseFrontmatter(content) {
  // Normalize Windows CRLF → LF before matching
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const match = normalized.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null
  const fm = {}
  for (const line of match[1].split('\n')) {
    const [k, ...v] = line.split(':')
    if (k && v.length) fm[k.trim()] = v.join(':').trim()
  }
  return fm
}

function checkSkillFrontmatter() {
  // Official standard: SKILL.md files require 'name' and 'description' only
  const required = ['name', 'description']
  const files = getAllFiles(path.join(V5_ROOT, 'skills'), 'SKILL.md')
  for (const f of files) {
    const content = fs.readFileSync(f, 'utf8')
    const fm = parseFrontmatter(content)
    if (!fm) { ERRORS.push(`[C01] ${path.relative(V5_ROOT, f)}: 缺少 frontmatter`) ; continue }
    for (const field of required) {
      if (!fm[field]) ERRORS.push(`[C01] ${path.relative(V5_ROOT, f)}: 缺少字段 '${field}'`)
    }
    // Non-standard fields should NOT be present
    const nonStandard = ['id', 'version', 'tier', 'workflow', 'source']
    for (const field of nonStandard) {
      if (fm[field]) WARNINGS.push(`[C01] ${path.relative(V5_ROOT, f)}: 含非官方字段 '${field}'（建议移除）`)
    }
  }
}

function checkAgentFrontmatter() {
  // Official standard: agent files require 'description'; 'name' is optional (defaults to filename)
  const required = ['description']
  const files = getAllFiles(path.join(V5_ROOT, 'agents'), '.agent.md')
  for (const f of files) {
    const content = fs.readFileSync(f, 'utf8')
    const fm = parseFrontmatter(content)
    if (!fm) { ERRORS.push(`[C02] ${path.relative(V5_ROOT, f)}: 缺少 frontmatter`) ; continue }
    for (const field of required) {
      if (!fm[field]) ERRORS.push(`[C02] ${path.relative(V5_ROOT, f)}: 缺少字段 '${field}'`)
    }
    // 'tools' is optional but recommended
    if (!content.includes('tools:')) {
      WARNINGS.push(`[C02] ${path.relative(V5_ROOT, f)}: 建议声明 'tools' 字段`)
    }
    // Non-standard fields should NOT be present
    const nonStandard = ['id', 'version', 'tier', 'skills', 'instructions']
    for (const field of nonStandard) {
      if (fm[field]) WARNINGS.push(`[C02] ${path.relative(V5_ROOT, f)}: 含非官方字段 '${field}'（建议移除）`)
    }
  }
}

function checkInstructionsApplyTo() {
  const files = getAllFiles(path.join(V5_ROOT, 'instructions'), '.md')
  for (const f of files) {
    const content = fs.readFileSync(f, 'utf8')
    if (!content.includes('applyTo:')) {
      WARNINGS.push(`[C03] ${path.relative(V5_ROOT, f)}: 缺少 applyTo 字段`)
    }
  }
}

function checkPromptMode() {
  const files = getAllFiles(path.join(V5_ROOT, 'prompts'), '.md')
  for (const f of files) {
    const content = fs.readFileSync(f, 'utf8')
    if (!content.includes('mode:')) {
      WARNINGS.push(`[C04] ${path.relative(V5_ROOT, f)}: 缺少 mode 字段`)
    }
  }
}

function checkRoutingTable() {
  // New path: skills/routing/routing/SKILL.md
  const routingFile = path.join(V5_ROOT, 'skills', 'routing', 'routing', 'SKILL.md')
  if (!fs.existsSync(routingFile)) {
    ERRORS.push('[C05] skills/routing/routing/SKILL.md 不存在')
    return
  }
  const content = fs.readFileSync(routingFile, 'utf8')
  const subTypes = ['default', 'refactor', 'database', 'init', 'optimization', 'scenario-test', 'docs', 'plan-review']
  for (const st of subTypes) {
    if (!content.includes(st)) {
      ERRORS.push(`[C05] routing.skill.md: 缺少子类型 '${st}'`)
    }
  }
}

function checkReportPaths() {
  const hooks = path.join(V5_ROOT, 'hooks', 'post-session.hook.md')
  if (!fs.existsSync(hooks)) { ERRORS.push('[C06] post-session.hook.md 不存在') ; return }
  const content = fs.readFileSync(hooks, 'utf8')
  // Check that each workflow's report template is referenced in the hook
  const reportTemplates = {
    dev: 'report-dev.prompt.md',
    fix: 'report-fix.prompt.md',
    analyze: 'report-analysis.prompt.md',
    audit: 'report-audit.prompt.md'
  }
  for (const [wf, tpl] of Object.entries(reportTemplates)) {
    if (!content.includes(tpl)) {
      WARNINGS.push(`[C06] post-session.hook.md: 缺少 ${wf} 报告模板引用 (${tpl})`)
    }
  }
  // Verify no legacy data/reports/ prefix is used
  if (content.includes('data/reports/')) {
    ERRORS.push('[C06] post-session.hook.md: 使用了错误路径前缀 data/reports/，应为 reports/<子目录>/')
  }
}

function checkPluginJson() {
  const pluginFile = path.join(V5_ROOT, 'plugin.json')
  if (!fs.existsSync(pluginFile)) { ERRORS.push('[C07] plugin.json 不存在') ; return }
  const plugin = JSON.parse(fs.readFileSync(pluginFile, 'utf8'))
  const agentFiles = getAllFiles(path.join(V5_ROOT, 'agents'), '.md').length
  const skillFiles = getAllFiles(path.join(V5_ROOT, 'skills'), '.md').length
  const instrFiles = getAllFiles(path.join(V5_ROOT, 'instructions'), '.md')
    .filter(f => !f.includes('tenants')).length

  const registeredAgents = (plugin.agents || []).length
  const registeredSkills = (plugin.skills || []).length
  const registeredInstrs = (plugin.instructions || []).length

  if (registeredAgents !== agentFiles) {
    WARNINGS.push(`[C07] plugin.json agents: 注册 ${registeredAgents} 个，实际文件 ${agentFiles} 个`)
  }
  if (registeredSkills < 7) {
    WARNINGS.push(`[C07] plugin.json skills: 注册 ${registeredSkills} 个（至少应有 7 个核心 skills）`)
  }
  if (registeredInstrs !== instrFiles) {
    WARNINGS.push(`[C07] plugin.json instructions: 注册 ${registeredInstrs} 个，实际文件 ${instrFiles} 个`)
  }
}

// ─── 主函数 ───────────────────────────────────────────────────────────────────

function main() {
  console.log('🔍 DevCodex v5 规范一致性检查\n')

  for (const check of CHECKS) {
    process.stdout.write(`  检查: ${check.name}... `)
    check.run()
    console.log('完成')
  }

  console.log('\n─────────────────────────────────────')
  if (ERRORS.length === 0 && WARNINGS.length === 0) {
    console.log('✅ 全部通过，无问题')
  } else {
    if (ERRORS.length > 0) {
      console.log(`\n❌ 错误 (${ERRORS.length}):`)
      ERRORS.forEach(e => console.log(`  ${e}`))
    }
    if (WARNINGS.length > 0) {
      console.log(`\n⚠️  警告 (${WARNINGS.length}):`)
      WARNINGS.forEach(w => console.log(`  ${w}`))
    }
  }
  console.log('─────────────────────────────────────')

  if (ERRORS.length > 0) process.exit(1)
}

main()
