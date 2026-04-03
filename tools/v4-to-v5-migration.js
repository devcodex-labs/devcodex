#!/usr/bin/env node
/**
 * DevCodex v4 → v5 迁移工具
 * 将 v4 tenants/ 目录转换为 v5 Instructions 格式
 * 
 * 用法: node tools/v4-to-v5-migration.js [--source <v4-path>] [--target <v5-path>] [--dry-run]
 */

'use strict'

const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const SOURCE = getArg('--source') || path.join(__dirname, '../../v4')
const TARGET = getArg('--target') || path.join(__dirname, '..')

function getArg(name) {
  const idx = args.indexOf(name)
  return idx !== -1 ? args[idx + 1] : null
}

// ─── 迁移映射 ──────────────────────────────────────────────────────────────────

const FILE_MAPPING = [
  { from: 'specs/safety.md', to: 'instructions/00-safety.instructions.md', type: 'instructions', applyTo: '**' },
  { from: 'specs/common.md', to: 'instructions/01-common.instructions.md', type: 'instructions', applyTo: '**' },
  { from: 'specs/output-paths.md', to: 'instructions/02-output-paths.instructions.md', type: 'instructions', applyTo: '**' },
  { from: 'specs/dev/README.md', to: 'instructions/10-dev.instructions.md', type: 'instructions', applyTo: 'src/**' },
  { from: 'specs/fix/README.md', to: 'instructions/11-fix.instructions.md', type: 'instructions', applyTo: 'src/**' },
  { from: 'specs/compliance.md', to: 'skills/core/compliance.skill.md', type: 'skill', workflow: 'cross' },
  { from: 'specs/memory.md', to: 'skills/core/memory.skill.md', type: 'skill', workflow: 'cross' },
  { from: 'specs/report.md', to: 'skills/core/report.skill.md', type: 'skill', workflow: 'cross' },
]

// ─── 租户迁移 ──────────────────────────────────────────────────────────────────

function migrateTenants() {
  const tenantsDir = path.join(SOURCE, 'tenants')
  if (!fs.existsSync(tenantsDir)) {
    console.log('ℹ️  没有找到 v4 tenants/ 目录，跳过租户迁移')
    return
  }

  const tenants = fs.readdirSync(tenantsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)

  console.log(`\n📦 发现 ${tenants.length} 个租户: ${tenants.join(', ')}`)

  for (const tenant of tenants) {
    console.log(`\n  迁移租户: ${tenant}`)
    const srcTenant = path.join(tenantsDir, tenant, 'specs')
    const dstTenant = path.join(TARGET, 'instructions', 'tenants', tenant)

    if (!fs.existsSync(srcTenant)) {
      console.log(`  ⚠️  ${tenant}/specs 不存在，跳过`)
      continue
    }

    if (!DRY_RUN) fs.mkdirSync(dstTenant, { recursive: true })

    const specFiles = fs.readdirSync(srcTenant).filter(f => f.endsWith('.md'))
    for (const specFile of specFiles) {
      const baseName = specFile.replace('.md', '')
      const dstFile = path.join(dstTenant, `${baseName}.instructions.md`)
      const srcContent = fs.readFileSync(path.join(srcTenant, specFile), 'utf8')

      // 生成 v5 Instructions 格式头部
      const header = `---\napplyTo: "**"\ndescription: "${tenant} 租户自定义规范 — ${baseName}"\n---\n\n`
      const newContent = header + srcContent

      console.log(`    ${specFile} → instructions/tenants/${tenant}/${baseName}.instructions.md`)
      if (!DRY_RUN) fs.writeFileSync(dstFile, newContent)
    }
  }
}

// ─── 模板迁移 ──────────────────────────────────────────────────────────────────

function migrateTemplates() {
  const templatesDir = path.join(SOURCE, 'templates')
  if (!fs.existsSync(templatesDir)) {
    console.log('ℹ️  没有找到 v4 templates/ 目录，跳过模板迁移')
    return
  }

  console.log('\n📄 迁移模板文件...')
  const targetPromptsDir = path.join(TARGET, 'prompts')
  if (!DRY_RUN) fs.mkdirSync(targetPromptsDir, { recursive: true })

  const templates = fs.readdirSync(templatesDir).filter(f => f.endsWith('.md'))
  for (const tmpl of templates) {
    const baseName = tmpl.replace('.md', '')
    const dstFile = path.join(targetPromptsDir, `${baseName}.prompt.md`)

    // 只迁移不存在的文件
    if (fs.existsSync(dstFile)) {
      console.log(`    ${tmpl} → 已存在，跳过`)
      continue
    }

    const srcContent = fs.readFileSync(path.join(templatesDir, tmpl), 'utf8')
    const header = `---\nmode: agent\ndescription: "${baseName} (从 v4 迁移)"\napplyTo: "**"\n---\n\n`
    const newContent = header + srcContent

    console.log(`    ${tmpl} → prompts/${baseName}.prompt.md`)
    if (!DRY_RUN) fs.writeFileSync(dstFile, newContent)
  }
}

// ─── 主函数 ───────────────────────────────────────────────────────────────────

function main() {
  console.log('🔄 DevCodex v4 → v5 迁移工具')
  console.log(`   源目录: ${SOURCE}`)
  console.log(`   目标目录: ${TARGET}`)
  if (DRY_RUN) console.log('   模式: DRY RUN（仅预览，不写入文件）\n')

  if (!fs.existsSync(SOURCE)) {
    console.error(`❌ 源目录不存在: ${SOURCE}`)
    process.exit(1)
  }

  migrateTenants()
  migrateTemplates()

  console.log('\n✅ 迁移完成')
  if (DRY_RUN) console.log('   （DRY RUN 模式，未实际写入）')
  console.log('\n📋 后续步骤:')
  console.log('   1. 运行 node tools/v5-full-audit.js 验证迁移结果')
  console.log('   2. 检查 instructions/tenants/ 下的覆盖规则是否正确')
  console.log('   3. 更新 plugin.json 注册新增的 Instructions')
}

main()
