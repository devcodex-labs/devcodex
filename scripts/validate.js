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
 * V8 父级部署同步检查（.claude/ 与 .github/ vs 源仓库关键文件 mtime）
 * V9 报告/记忆日期格式（YYYY-MM-DD HH:MM）一致性
 * V10 audit-state regressionProbes 回归扫描（已 fixed 项的 grep 计数验证）
 * V11 AskUserQuestion / 决策点格式（FC7：1 个 (推荐) 标签 + "推荐理由：" 前缀）
 * V12 源仓库不得保留 `copilot-instructions.md`（v1.9.8 单源规范，由 `instructions.md` 替代）
 * V13 关键模板语义探针（防止 prompts/skills 与权威 instructions 漂移）
 * V14 auto v1.1 语义联动（agent/common/cp-gate/compliance/runtime/test/README）
 * V15 audit-state 状态机一致性（状态枚举 + converged 门禁）
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
    const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
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
    const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
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
    // F-012: 单次 --json 调用同时提供 files 与 name/tarball 串，避免重复执行 npm pack
    const out = execSync('npm pack --dry-run --json', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const arr = JSON.parse(out)
    const files = arr[0]?.files?.map(f => f.path) || []
    const packName = arr[0]?.name || ''
    const packFilename = arr[0]?.filename || ''
    const required = [
      'instructions.md',
      'plugin.json',
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
      err(`[V6] Missing required package assets in pack: ${missingRequired.join(', ')}`)
    }
    // Copilot 分支：hooks/devcodex.lifecycle.json 必须使用 .github/hooks/_runtime/ 路径
    const hookConfig = JSON.parse(read(path.join(ROOT, 'hooks/devcodex.lifecycle.json')))
    const hookCommands = Object.values(hookConfig.hooks).flat().map(entry => entry.command)
    const expectedCommand = 'node ./.github/hooks/_runtime/lifecycle.cjs'
    const invalidCommands = hookCommands.filter(command => command !== expectedCommand)
    if (invalidCommands.length) {
      err(`[V6] Copilot hook commands must use workspace runtime path: ${invalidCommands.join(', ')}`)
    }
    // Claude Code 分支：index.js 必须定义 CLAUDE_HOOK_COMMAND 常量并使用向上爬路径模式（避免相对路径解析失败）
    const indexSrc = read(path.join(ROOT, 'index.js'))
    if (!/const\s+CLAUDE_HOOK_COMMAND\s*=/.test(indexSrc)) {
      err('[V6] Claude Code adapter missing CLAUDE_HOOK_COMMAND constant in index.js (required for hooks settings.json injection)')
    } else {
      const claudeHookMatch = indexSrc.match(/CLAUDE_HOOK_COMMAND\s*=\s*`([^`]+)`/)
      if (claudeHookMatch && !/process\.cwd\(\)|while\s*\(/.test(claudeHookMatch[1])) {
        err('[V6] CLAUDE_HOOK_COMMAND must use upward-walk pattern (cwd→parent→...→root) to survive subdir invocation; relative `.claude/hooks/_runtime/lifecycle.cjs` alone fails')
      }
    }
    if (!/CLAUDE_SETTINGS_HOOKS/.test(indexSrc)) {
      err('[V6] Claude Code adapter missing CLAUDE_SETTINGS_HOOKS constant in index.js (required to write .claude/settings.json)')
    }
    // F-012: 复用 --json 输出的 files 列表 + 包名做项目名污染检查（无需二次 npm pack）
    const combined = files.join('\n') + '\n' + packName + '\n' + packFilename
    if (/schema-dsl|vext-test/.test(combined)) {
      err('[V6] Pack contains real project names (schema-dsl/vext-test)')
    }
    console.log(`[V6] pack contains ${files.length} files, no forbidden content`)
  } catch (e) {
    // F-013: 保留 stderr 前 8 行 + message 首行，便于诊断
    const detail = String((e.stderr || e.stdout || e.message || '')).trim().split('\n').slice(0, 8).join(' | ')
    warn(`[V6] npm pack failed: ${detail}`)
  }
}

// ── V7: hooks runtime bootstrap smoke test ─────────────────────────────────
function checkV7() {
  try {
    execSync('node scripts/test-hooks-runtime.js', { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    console.log('[V7] hooks runtime smoke test passed')
  } catch (e) {
    // F-013: 保留 stderr 前 8 行
    const detail = String((e.stderr || e.stdout || e.message || '')).trim().split('\n').slice(0, 8).join(' | ')
    err(`[V7] hooks runtime smoke test failed${detail ? `: ${detail}` : ''}`)
  }
}

// ── V8: deployment sync check ─────────────────────────────────────────────
// 验证工作区根的部署体（父级 .claude/ 与 .github/）是否同步源仓库的关键文件。
// 仅在父级部署体存在时运行；不存在则跳过（属于纯 plugin 仓库场景）。
function checkV8() {
  const PARENT = path.dirname(ROOT)
  const claudeDir = path.join(PARENT, '.claude')
  const githubDir = path.join(PARENT, '.github')
  const claudeExists = fs.existsSync(claudeDir)
  const githubExists = fs.existsSync(githubDir)

  if (!claudeExists && !githubExists) {
    console.log('[V8] no parent deployment (.claude/ / .github/) detected — skip')
    return
  }

  // F-005: 关键文件清单扩展至 prompts/skills/instructions/hooks/CLAUDE.md 全维度
  // 注：CLAUDE.md 仅在 .claude/ 同步（Copilot 不需要），agents/ 同理；prompts/ 在 .claude/ 和 .github/ 均同步
  const checkPairs = [
    // Instructions（12 files）
    { src: 'instructions/00-safety.instructions.md', claude: 'instructions/00-safety.instructions.md', github: 'instructions/00-safety.instructions.md' },
    { src: 'instructions/01-common.instructions.md', claude: 'instructions/01-common.instructions.md', github: 'instructions/01-common.instructions.md' },
    { src: 'instructions/02-output-paths.instructions.md', claude: 'instructions/02-output-paths.instructions.md', github: 'instructions/02-output-paths.instructions.md' },
    { src: 'instructions/10-dev.instructions.md', claude: 'instructions/10-dev.instructions.md', github: 'instructions/10-dev.instructions.md' },
    { src: 'instructions/11-fix.instructions.md', claude: 'instructions/11-fix.instructions.md', github: 'instructions/11-fix.instructions.md' },
    { src: 'instructions/12-audit.instructions.md', claude: 'instructions/12-audit.instructions.md', github: 'instructions/12-audit.instructions.md' },
    { src: 'instructions/13-analyze.instructions.md', claude: 'instructions/13-analyze.instructions.md', github: 'instructions/13-analyze.instructions.md' },
    { src: 'instructions/14-self-fix.instructions.md', claude: 'instructions/14-self-fix.instructions.md', github: 'instructions/14-self-fix.instructions.md' },
    { src: 'instructions/15-memory.instructions.md', claude: 'instructions/15-memory.instructions.md', github: 'instructions/15-memory.instructions.md' },
    { src: 'instructions/16-report.instructions.md', claude: 'instructions/16-report.instructions.md', github: 'instructions/16-report.instructions.md' },
    { src: 'instructions/17-compliance.instructions.md', claude: 'instructions/17-compliance.instructions.md', github: 'instructions/17-compliance.instructions.md' },
    { src: 'instructions/18-spec-radar.instructions.md', claude: 'instructions/18-spec-radar.instructions.md', github: 'instructions/18-spec-radar.instructions.md' },
    // Skills（核心 8 files）
    { src: 'skills/cp-gate/SKILL.md', claude: 'skills/cp-gate/SKILL.md', github: 'skills/cp-gate/SKILL.md' },
    { src: 'skills/report/SKILL.md', claude: 'skills/report/SKILL.md', github: 'skills/report/SKILL.md' },
    { src: 'skills/compliance/SKILL.md', claude: 'skills/compliance/SKILL.md', github: 'skills/compliance/SKILL.md' },
    { src: 'skills/memory/SKILL.md', claude: 'skills/memory/SKILL.md', github: 'skills/memory/SKILL.md' },
    { src: 'skills/audit-common/SKILL.md', claude: 'skills/audit-common/SKILL.md', github: 'skills/audit-common/SKILL.md' },
    { src: 'skills/audit-session/SKILL.md', claude: 'skills/audit-session/SKILL.md', github: 'skills/audit-session/SKILL.md' },
    { src: 'skills/intent/SKILL.md', claude: 'skills/intent/SKILL.md', github: 'skills/intent/SKILL.md' },
    { src: 'skills/routing/SKILL.md', claude: 'skills/routing/SKILL.md', github: 'skills/routing/SKILL.md' },
    // Prompts（关键模板）
    { src: 'prompts/precheck-status.prompt.md', claude: 'prompts/precheck-status.prompt.md', github: 'prompts/precheck-status.prompt.md' },
    { src: 'prompts/token-setup.prompt.md', claude: 'prompts/token-setup.prompt.md', github: 'prompts/token-setup.prompt.md' },
    { src: 'prompts/reply-summary.prompt.md', claude: 'prompts/reply-summary.prompt.md', github: 'prompts/reply-summary.prompt.md' },
    { src: 'prompts/memory-session.prompt.md', claude: 'prompts/memory-session.prompt.md', github: 'prompts/memory-session.prompt.md' },
    { src: 'prompts/api-verification.prompt.md', claude: 'prompts/api-verification.prompt.md', github: 'prompts/api-verification.prompt.md' },
    { src: 'prompts/report-analysis.prompt.md', claude: 'prompts/report-analysis.prompt.md', github: 'prompts/report-analysis.prompt.md' },
    { src: 'prompts/report-dev.prompt.md', claude: 'prompts/report-dev.prompt.md', github: 'prompts/report-dev.prompt.md' },
    { src: 'prompts/report-fix.prompt.md', claude: 'prompts/report-fix.prompt.md', github: 'prompts/report-fix.prompt.md' },
    { src: 'prompts/report-optimization.prompt.md', claude: 'prompts/report-optimization.prompt.md', github: 'prompts/report-optimization.prompt.md' },
    { src: 'prompts/report-scenario-test.prompt.md', claude: 'prompts/report-scenario-test.prompt.md', github: 'prompts/report-scenario-test.prompt.md' },
    // Hooks（1 file，双平台共享 _runtime）
    { src: 'hooks/_runtime/lifecycle.cjs', claude: 'hooks/_runtime/lifecycle.cjs', github: 'hooks/_runtime/lifecycle.cjs' },
    // Workspace CLAUDE.md is generated from the v1.9.8+ single source instructions.md.
    { src: 'instructions.md', claude: '../CLAUDE.md', github: null }
  ]

  let stale = 0
  for (const pair of checkPairs) {
    const srcPath = path.join(ROOT, pair.src)
    if (!fs.existsSync(srcPath)) continue
    const srcStat = fs.statSync(srcPath)
    const srcMtime = srcStat.mtimeMs

    if (claudeExists && pair.claude) {
      const dest = path.join(claudeDir, pair.claude)
      if (fs.existsSync(dest)) {
        const dStat = fs.statSync(dest)
        if (dStat.mtimeMs < srcMtime - 1000) {
          warn(`[V8] .claude/ stale: ${pair.claude} (run: npx devcodex update --claude)`)
          stale++
        }
      } else {
        warn(`[V8] .claude/ missing: ${pair.claude} (source repo has v1.9.2+ addition)`)
        stale++
      }
    }
    if (githubExists && pair.github) {
      const dest = path.join(githubDir, pair.github)
      if (fs.existsSync(dest)) {
        const dStat = fs.statSync(dest)
        if (dStat.mtimeMs < srcMtime - 1000) {
          warn(`[V8] .github/ stale: ${pair.github} (run: npx devcodex update)`)
          stale++
        }
      } else {
        warn(`[V8] .github/ missing: ${pair.github}`)
        stale++
      }
    }
  }
  if (stale === 0) {
    console.log('[V8] parent deployment (.claude/ / .github/) in sync with source repo')
  } else {
    console.log(`[V8] parent deployment has ${stale} stale/missing file(s) — see warnings`)
  }
}

// ── V9: date format consistency (YYYY-MM-DD or YYYY-MM-DD HH:MM) ─────────
function checkV9() {
  const roots = ['instructions', 'skills', 'prompts']
  const files = roots.flatMap(r => walk(path.join(ROOT, r))).filter(f => f.endsWith('.md'))
  let bad = 0
  const badRe = /\b(YYYY\/MM\/DD|MM-DD-YYYY|DD-MM-YYYY|YYYY\.MM\.DD)\b/g
  for (const f of files) {
    const content = read(f)
    const matches = content.match(badRe)
    if (matches) {
      warn(`[V9] non-standard date placeholder in ${path.relative(ROOT, f)}: ${[...new Set(matches)].join(', ')}`)
      bad += matches.length
    }
  }
  console.log(`[V9] date format scanned: ${files.length} files, ${bad} non-standard placeholder(s)`)
}

// ── V10: regression probes on audit-state.findings[status=fixed] ────────────
function stripOuterQuotes(text) {
  const value = String(text || '').trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

function resolveProbeFiles(probe) {
  if (typeof probe.file === 'string') return [stripOuterQuotes(probe.file)].filter(Boolean)
  if (typeof probe.include === 'string') return [stripOuterQuotes(probe.include)].filter(Boolean)
  if (Array.isArray(probe.include)) {
    return probe.include
      .filter(entry => typeof entry === 'string')
      .map(stripOuterQuotes)
      .filter(Boolean)
  }
  return []
}

function normalizeRegressionProbe(probe) {
  if (!probe || typeof probe.expectedMatches !== 'number') return { kind: 'skip' }

  if (probe.type === 'grepCount') {
    const files = resolveProbeFiles(probe)
    if (typeof probe.pattern !== 'string' || !files.length) {
      return { kind: 'invalid', reason: 'missing pattern/include' }
    }
    return {
      kind: 'grepCount',
      findingId: probe.findingId || 'unknown',
      expectedMatches: probe.expectedMatches,
      pattern: probe.pattern,
      files
    }
  }

  if (typeof probe.scanCmd === 'string') {
    const match = probe.scanCmd.trim().match(/^grep\s+-c\s+(['"])(.*?)\1\s+(.+)$/)
    if (!match) {
      return { kind: 'invalid', reason: `unsupported legacy scanCmd: ${probe.scanCmd}` }
    }
    return {
      kind: 'grepCount',
      findingId: probe.findingId || 'unknown',
      expectedMatches: probe.expectedMatches,
      pattern: match[2],
      files: [stripOuterQuotes(match[3])]
    }
  }

  return { kind: 'skip' }
}

function countProbeMatches(pattern, files) {
  let total = 0
  for (const file of files) {
    const abs = path.join(ROOT, file)
    if (!fs.existsSync(abs)) continue
    const lines = read(abs).split(/\r?\n/)
    total += lines.filter(line => line.includes(pattern)).length
  }
  return total
}

function checkV10() {
  const stateDir = path.join(ROOT, '.devcodex/.audit-state')
  if (!fs.existsSync(stateDir)) {
    console.log('[V10] no audit-state directory — skip')
    return
  }
  const stateFiles = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'))
  if (!stateFiles.length) {
    console.log('[V10] no audit-state files — skip')
    return
  }
  let totalProbes = 0
  let regressions = 0
  for (const sf of stateFiles) {
    let state
    try { state = JSON.parse(read(path.join(stateDir, sf))) } catch { continue }
    const probes = state.regressionProbes || []
    for (const probe of probes) {
      totalProbes++
      const normalized = normalizeRegressionProbe(probe)
      if (normalized.kind === 'skip') continue
      if (normalized.kind === 'invalid') {
        warn(`[V10] invalid probe on ${probe.findingId || 'unknown'}: ${normalized.reason}`)
        regressions++
        continue
      }
      const actual = countProbeMatches(normalized.pattern, normalized.files)
      if (actual !== normalized.expectedMatches) {
        warn(
          `[V10] regression on ${normalized.findingId}: expected ${normalized.expectedMatches}, ` +
          `got ${actual} (pattern: ${normalized.pattern}; files: ${normalized.files.join(', ')})`
        )
        regressions++
      }
    }
  }
  console.log(`[V10] regression probes: ${totalProbes} evaluated, ${regressions} regression(s)`)
}

// ── V11: AskUserQuestion / decision-point format (FC7) ──────────────────────
function checkV11() {
  const roots = ['instructions', 'skills', 'prompts']
  const files = roots.flatMap(r => walk(path.join(ROOT, r))).filter(f => f.endsWith('.md'))
  let blocks = 0
  let violations = 0
  for (const f of files) {
    let content = read(f)
    content = content.replace(/```[\s\S]*?```/g, '')
    const optionBlocks = content.match(/(?:## 选项|\*\*选项\*\*)[\s\S]{0,800}/g) || []
    for (const blk of optionBlocks) {
      blocks++
      const recommended = (blk.match(/\(推荐\)|🟢/g) || []).length
      const reason = /推荐理由[:：]/.test(blk)
      if (recommended === 0) {
        warn(`[V11] decision block in ${path.relative(ROOT, f)} missing (推荐) marker (FC7)`)
        violations++
      } else if (!reason) {
        warn(`[V11] decision block in ${path.relative(ROOT, f)} missing "推荐理由：" prefix (FC7)`)
        violations++
      }
    }
  }
  console.log(`[V11] decision blocks scanned: ${blocks}, ${violations} FC7 violation(s)`)
}

function checkV12() {
  const legacy = path.join(ROOT, 'copilot-instructions.md')
  if (fs.existsSync(legacy)) {
    err(`[V12] legacy file 'copilot-instructions.md' must be removed (v1.9.8 single-source: use 'instructions.md')`)
  } else {
    console.log(`[V12] single-source check passed (no copilot-instructions.md in repo root)`)
  }
}

// ── V13: template semantic probes ───────────────────────────────────────────
function mustInclude(file, needle, label) {
  const content = read(path.join(ROOT, file))
  if (!content.includes(needle)) err(`[V13] ${label || file} missing required text: ${needle}`)
}

function mustNotInclude(file, needle, label) {
  const content = read(path.join(ROOT, file))
  if (content.includes(needle)) err(`[V13] ${label || file} contains forbidden legacy text: ${needle}`)
}

function checkV13() {
  mustInclude('prompts/precheck-status.prompt.md', 'PC7 新会话首步 resume 强制检测', 'precheck prompt')
  mustNotInclude('prompts/precheck-status.prompt.md', 'chat：不输出预检查块', 'precheck prompt')

  mustInclude('prompts/token-setup.prompt.md', '当前版本所有功能全量开放', 'token prompt')
  mustInclude('prompts/token-setup.prompt.md', 'DEVCODEX_TOKEN` 是未来服务端授权预留环境变量', 'token prompt')
  mustNotInclude('prompts/token-setup.prompt.md', 'your_token_here', 'token prompt')
  mustNotInclude('prompts/token-setup.prompt.md', 'echo $DEVCODEX_TOKEN', 'token prompt')

  const reportPrompts = [
    'prompts/report-analysis.prompt.md',
    'prompts/report-dev.prompt.md',
    'prompts/report-fix.prompt.md',
    'prompts/report-optimization.prompt.md',
    'prompts/report-scenario-test.prompt.md'
  ]
  for (const file of reportPrompts) {
    mustInclude(file, '**类型**', file)
    mustInclude(file, '**Agent**', file)
    mustInclude(file, '验证状态', file)
    mustInclude(file, '影响范围', file)
  }
  mustInclude('prompts/report-fix.prompt.md', 'CP 确认记录', 'fix report prompt')
  mustInclude('prompts/report-fix.prompt.md', '修复三步扫描', 'fix report prompt')
  mustInclude('prompts/report-fix.prompt.md', '**事件时间**: YYYY-MM-DD HH:MM:SS', 'fix report prompt')

  mustInclude('prompts/reply-summary.prompt.md', 'tasks/YYYYMMDD.md', 'reply summary prompt')
  mustInclude('prompts/reply-summary.prompt.md', 'chat 豁免报告，不豁免记忆', 'reply summary prompt')
  mustNotInclude('prompts/reply-summary.prompt.md', '.devcodex/.memory/clients/<agent>/chat/YYYYMMDD.md', 'reply summary prompt')
  mustNotInclude('prompts/reply-summary.prompt.md', '保留 7 天', 'reply summary prompt')
  mustInclude('prompts/memory-session.prompt.md', '收到首条用户消息时', 'memory session prompt')

  mustInclude('prompts/api-verification.prompt.md', '不在脚本内自启服务', 'api verification prompt')
  mustNotInclude('prompts/api-verification.prompt.md', 'tests/api/<module>.test.cjs', 'api verification prompt')
  mustInclude('skills/api-verification/SKILL.md', '禁止自启服务', 'api verification skill')
  mustInclude('skills/dev-scenario-test/SKILL.md', '.devcodex/scenario-tests', 'scenario test skill')
  mustInclude('skills/dev-testing/SKILL.md', '项目自身 API 测试可另存 `tests/api/`', 'dev testing skill')

  mustInclude('skills/cp-gate/SKILL.md', 'CP3: N/A', 'cp gate skill')
  mustInclude('hooks/_runtime/lifecycle.cjs', 'CP3Exempt', 'lifecycle runtime')
  console.log('[V13] template semantic probes passed')
}

function checkV14() {
  mustInclude('agents/devcodex-auto.agent.md', '@devcodex-auto', 'auto agent')
  mustInclude('agents/devcodex-auto.agent.md', '白名单', 'auto agent')
  mustInclude('instructions/01-common.instructions.md', 'Auto v1.1 **唯一正式入口**为显式 `@devcodex-auto`', '01-common auto mode')
  mustInclude('instructions/01-common.instructions.md', '非白名单路径默认切回确认模式', '01-common auto mode')
  mustInclude('skills/cp-gate/SKILL.md', '白名单路径', 'cp-gate auto mode')
  mustInclude('skills/cp-gate/SKILL.md', 'instruction-fallback', 'cp-gate auto mode')
  mustInclude('skills/compliance/SKILL.md', 'hook-enforced', 'compliance auto mode')
  mustInclude('skills/compliance/SKILL.md', 'instruction-fallback', 'compliance auto mode')
  mustInclude('hooks/_runtime/lifecycle.cjs', 'AUTO_ALLOWED_PATH_PATTERNS', 'lifecycle runtime auto mode')
  mustInclude('hooks/_runtime/lifecycle.cjs', 'detectExecutionMode', 'lifecycle runtime auto mode')
  mustInclude('scripts/test-hooks-runtime.js', 'autoWhitelistAllowed', 'hooks runtime test')
  mustInclude('scripts/test-hooks-runtime.js', 'autoNonWhitelistBlocked', 'hooks runtime test')
  mustInclude('README.md', '白名单路径提供 runtime 级硬保证', 'README auto mode')
  mustInclude('README.md', '不承诺完全等价的自动放行', 'README auto mode')
  console.log('[V14] auto mode semantic probes passed')
}

function checkV15() {
  const stateDir = path.join(ROOT, '.devcodex/.audit-state')
  if (!fs.existsSync(stateDir)) {
    console.log('[V15] no audit-state directory — skip')
    return
  }
  const stateFiles = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'))
  if (!stateFiles.length) {
    console.log('[V15] no audit-state files — skip')
    return
  }

  const allowedStates = new Set(['active', 'paused', 'resumed', 'converged', 'closed'])
  let violations = 0

  for (const sf of stateFiles) {
    let state
    try { state = JSON.parse(read(path.join(stateDir, sf))) } catch {
      warn(`[V15] invalid JSON: .devcodex/.audit-state/${sf}`)
      violations++
      continue
    }

    if (!allowedStates.has(state.state)) {
      warn(`[V15] invalid state in .devcodex/.audit-state/${sf}: ${state.state || 'missing'}`)
      violations++
    }

    if (state.state === 'converged') {
      const convergedOk = state.zeroFindingStreak >= 3 && state.crsPassed === true && state.pcvPassed === true
      if (!convergedOk) {
        warn(
          `[V15] invalid converged gate in .devcodex/.audit-state/${sf}: ` +
          `zeroFindingStreak=${state.zeroFindingStreak}, crsPassed=${state.crsPassed}, pcvPassed=${state.pcvPassed}`
        )
        violations++
      }
    }
  }

  console.log(`[V15] audit-state consistency checked: ${stateFiles.length} files, ${violations} violation(s)`)
}

checkV1()
checkV2()
checkV3()
checkV4()
checkV5()
checkV6()
checkV7()
checkV8()
checkV9()
checkV10()
checkV11()
checkV12()
checkV13()
checkV14()
checkV15()

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
