#!/usr/bin/env node
/**
 * DevCodex — 零依赖规范校验
 *
 * V1 frontmatter schema（Instructions/Skills）
 * V2 相对链接有效性
 * V3 "五处同步"联动（路由子类型一致性）
 * V4 版本一致性（package.json / plugin.json / RULES.md / SECURITY.md）
 * V5 PC4 输出格式唯一定义
 * V6 npm pack 白名单不含维护者状态
 * V7 Hooks 运行时 bootstrap 行为冒烟
 *
 * Exit: 0=OK, 1=error, 2=warnings only
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const errors = []
const warnings = []

function err(msg) { errors.push(msg) }
function warn(msg) { warnings.push(msg) }
function walk(dir) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}
function read(p) { return fs.readFileSync(p, 'utf8') }

// ── V1: frontmatter schema ──────────────────────────────────────────────────
function checkV1() {
  const instructionFiles = walk(path.join(ROOT, 'instructions'))
    .filter(f => f.endsWith('.instructions.md'))
  for (const f of instructionFiles) {
    const content = read(f)
    const fm = content.match(/^---\n([\s\S]*?)\n---/)
    if (!fm) {
      err(`[V1] Missing frontmatter: ${path.relative(ROOT, f)}`)
      continue
    }
    if (!/^applyTo:\s*["'].+["']/m.test(fm[1])) {
      err(`[V1] Missing applyTo in: ${path.relative(ROOT, f)}`)
    }
  }
  const skillFiles = walk(path.join(ROOT, 'skills'))
    .filter(f => path.basename(f) === 'SKILL.md')
  for (const f of skillFiles) {
    const content = read(f)
    const fm = content.match(/^---\n([\s\S]*?)\n---/)
    if (!fm) {
      err(`[V1] Missing frontmatter: ${path.relative(ROOT, f)}`)
      continue
    }
    if (!/^name:\s*\S+/m.test(fm[1])) {
      err(`[V1] Missing name in: ${path.relative(ROOT, f)}`)
    }
    if (!/^description:/m.test(fm[1])) {
      err(`[V1] Missing description in: ${path.relative(ROOT, f)}`)
    }
  }
  console.log(`[V1] frontmatter checked: ${instructionFiles.length} instructions + ${skillFiles.length} skills`)
}

// ── V2: relative links ──────────────────────────────────────────────────────
function checkV2() {
  const roots = ['instructions', 'skills', 'prompts']
  const files = roots.flatMap(r => walk(path.join(ROOT, r))).filter(f => f.endsWith('.md'))
  let checked = 0
  for (const f of files) {
    let content = read(f)
    // strip fenced code blocks and inline code to avoid matching links in examples/templates
    content = content.replace(/```[\s\S]*?```/g, '')
    content = content.replace(/`[^`\n]+`/g, '')
    const linkRe = /\]\(([^)]+)\)/g
    let m
    while ((m = linkRe.exec(content))) {
      const target = m[1].split('#')[0].trim()
      if (!target || /^https?:|^mailto:|^file:/.test(target)) continue
      const base = path.dirname(f)
      const abs = path.resolve(base, target)
      if (target.endsWith('.md') && !fs.existsSync(abs)) {
        warn(`[V2] Broken link in ${path.relative(ROOT, f)}: ${target}`)
      }
      checked++
    }
  }
  console.log(`[V2] links scanned: ${checked}`)
}

// ── V3: five-place sync ─────────────────────────────────────────────────────
function extractSubtypes(content, workflow) {
  const re = new RegExp(`${workflow}\\.([\\u4e00-\\u9fa5][\\u4e00-\\u9fa5\\w-]*|[a-z][a-z0-9-]*)`, 'g')
  const set = new Set()
  let m
  const skip = new Set(['instructions', 'instruction', 'md'])
  while ((m = re.exec(content))) {
    if (!skip.has(m[1])) set.add(m[1])
  }
  return set
}
function checkV3() {
  const pluginContent = read(path.join(ROOT, 'plugin.json'))
  const commonContent = read(path.join(ROOT, 'instructions/01-common.instructions.md'))
  for (const wf of ['dev', 'fix', 'audit']) {
    const inCommon = extractSubtypes(commonContent, wf)
    const inPlugin = extractSubtypes(pluginContent, wf)
    const missingInCommon = [...inPlugin].filter(s => !inCommon.has(s))
    if (missingInCommon.length) {
      warn(`[V3] ${wf} subtypes in plugin.json but not in 01-common: ${missingInCommon.join(', ')}`)
    }
  }
  console.log('[V3] subtype sync checked (dev/fix/audit)')
}

// ── V4: version consistency ─────────────────────────────────────────────────
function checkV4() {
  const pkg = JSON.parse(read(path.join(ROOT, 'package.json')))
  const plugin = JSON.parse(read(path.join(ROOT, 'plugin.json')))
  if (pkg.version !== plugin.version) {
    err(`[V4] package.json (${pkg.version}) ≠ plugin.json (${plugin.version})`)
  }
  const rulesContent = read(path.join(ROOT, 'RULES.md'))
  const rulesMatch = rulesContent.match(/版本[：: ]*v?(\d+\.\d+\.\d+)/)
  if (rulesMatch && rulesMatch[1] !== pkg.version) {
    warn(`[V4] RULES.md version (${rulesMatch[1]}) ≠ package.json (${pkg.version})`)
  }
  const secContent = read(path.join(ROOT, 'SECURITY.md'))
  const secMatch = secContent.match(/(\d+)\.(\d+)\.x/)
  if (secMatch) {
    const [major, minor] = pkg.version.split('.')
    if (secMatch[1] !== major || secMatch[2] !== minor) {
      warn(`[V4] SECURITY.md references ${secMatch[0]} but current is ${major}.${minor}.x`)
    }
  }
  console.log(`[V4] versions aligned at ${pkg.version}`)
}

// ── V5: PC4 format single source ────────────────────────────────────────────
function checkV5() {
  const files = walk(path.join(ROOT, 'instructions')).filter(f => f.endsWith('.md'))
  let defCount = 0
  const hits = []
  for (const f of files) {
    const content = read(f)
    const matches = content.match(/PC4 规范雷达：\[Axis A/g)
    if (matches) {
      defCount += matches.length
      hits.push(`${path.relative(ROOT, f)}×${matches.length}`)
    }
  }
  if (defCount > 1) {
    warn(`[V5] PC4 format defined ${defCount} times (expected 1): ${hits.join('; ')}`)
  }
  console.log(`[V5] PC4 format occurrences: ${defCount} (${hits.join('; ') || 'none'})`)
}

// ── V6: npm pack whitelist ──────────────────────────────────────────────────
function checkV6() {
  try {
    const out = execSync('npm pack --dry-run --json', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const arr = JSON.parse(out)
    const files = arr[0]?.files?.map(f => f.path) || []
    const required = [
      'hooks/devcodex.lifecycle.json',
      'hooks/_runtime/lifecycle.cjs',
      'assets/icon-512.png'
    ]
    const forbidden = files.filter(f =>
      (/^assets\/hooks\//i.test(f) ||
       /violations\.md$/i.test(f) ||
       /pending-fixes\.md$/i.test(f) ||
       /process-improvements\.md$/i.test(f) ||
       /gap-registry\.md$/i.test(f)) &&
      !f.startsWith('data/templates/')
    )
    const missingRequired = required.filter(f => !files.includes(f))
    if (forbidden.length) {
      err(`[V6] Forbidden files in pack: ${forbidden.join(', ')}`)
    }
    if (missingRequired.length) {
      err(`[V6] Missing hooks assets in pack: ${missingRequired.join(', ')}`)
    }
    const hookConfig = JSON.parse(read(path.join(ROOT, 'hooks/devcodex.lifecycle.json')))
    const hookCommands = Object.values(hookConfig.hooks).flat().map(entry => entry.command)
    const expectedCommand = 'node ./.github/hooks/_runtime/lifecycle.cjs'
    const invalidCommands = hookCommands.filter(command => command !== expectedCommand)
    if (invalidCommands.length) {
      err(`[V6] Hook commands must use workspace runtime path: ${invalidCommands.join(', ')}`)
    }
    const packed = execSync('npm pack --dry-run 2>&1', { cwd: ROOT, encoding: 'utf8' })
    if (/schema-dsl|vext-test/.test(packed)) {
      err('[V6] Pack contains real project names (schema-dsl/vext-test)')
    }
    console.log(`[V6] pack contains ${files.length} files, no forbidden content`)
  } catch (e) {
    warn(`[V6] npm pack failed: ${e.message.split('\n')[0]}`)
  }
}

// ── V7: hooks runtime bootstrap smoke test ─────────────────────────────────
function checkV7() {
  try {
    execSync('node scripts/test-hooks-runtime.js', { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    console.log('[V7] hooks runtime smoke test passed')
  } catch (e) {
    const detail = String((e.stderr || e.stdout || e.message || '')).trim().split('\n')[0]
    err(`[V7] hooks runtime smoke test failed${detail ? `: ${detail}` : ''}`)
  }
}

checkV1()
checkV2()
checkV3()
checkV4()
checkV5()
checkV6()
checkV7()

console.log('')
if (errors.length) {
  console.error(`\x1b[31m✗ ${errors.length} error(s):\x1b[0m`)
  errors.forEach(e => console.error('  ' + e))
}
if (warnings.length) {
  console.warn(`\x1b[33m⚠ ${warnings.length} warning(s):\x1b[0m`)
  warnings.forEach(w => console.warn('  ' + w))
}
if (!errors.length && !warnings.length) {
  console.log('\x1b[32m✓ All checks passed\x1b[0m')
}
process.exit(errors.length ? 1 : (warnings.length ? 2 : 0))
