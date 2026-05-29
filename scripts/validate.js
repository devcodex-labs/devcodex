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
 * V8 父级部署同步检查（.claude/ / .github/ / Codex adapter vs 源仓库关键文件内容）
 * V9 报告/记忆日期格式（YYYY-MM-DD HH:MM）一致性
 * V10 audit-state regressionProbes 回归扫描（已 fixed 项的 grep 计数验证）
 * V11 AskUserQuestion / 决策点格式（FC7：1 个 (推荐) 标签 + "推荐理由：" 前缀）
 * V12 源仓库不得保留 `copilot-instructions.md`（v1.9.8 单源规范，由 `instructions.md` 替代）
 * V13 关键模板语义探针（防止 prompts/skills 与权威 instructions 漂移）
 * V14 auto v1.1 语义联动（agent/common/cp-gate/compliance/runtime/test/README）
 * V15 audit-state 状态机一致性（状态枚举 + converged 门禁）
 * V16 MCP servers smoke test（profile prompts + memory default agent）
 * V17 Profile drift detection（当前源码仓 profile 不得落后 package/plugin）
 * V18 Claude Code MCP/settings schema（mcpServers + permissions allowlist）
 * V19 Asset count sync（README/Profile 资产数量不得漂移）
 * V20 Release/changelog dual-track semantics（unreleased 默认流 + release 显式触发）
 * V21 Workflow control-plane semantics（前置复审显式输出 / 控制面交叉验证 / 语义批次提交 / 工作区 AGENTS 副本同步）
 * V22 Workspace namespace layout + migrate-layout semantics（layout.json / active-root / 迁移器 smoke）
 * V23 Independent evaluation semantics（独立验证可采纳，不机械唱反调）
 * V24 Governance/template/client narrative sync（pending-issues 模板链 / 多客户端真相源 / agent 枚举一致性）
 * V25~V27 ECR/RecordRouter/SCV 与 active-root 落点边界语义
 * V28 Support skills / progress / release verification sync（五个支撑型 Skill、进度强触发与资产计数）
 * V29 Hook visible reply / sticky project / intent expansion sync（Stop 三态、workspace profile 路径、意图扩展摘要）
 * V30~V34 规范资产漂移收敛（resume 顺序 / PC5 部署面 / audit-state / audit 收敛 / contributing 模板）
 * V35 Concept Sync Map sync（真相源、当前消费者、历史镜像、探针、部署副本、黄色偏离）
 * V36 Host contract verification sync（宿主契约验证路线、HostContractRoute、报告证据）
 * V37 Namespace safety / CLI protection / deterministic test chain（容器命名空间、防 clobber、test:all 拆链）
 * V38 README authoring/review governance sync（README 用户视角写作、专项 review、targeted test 与消费者链）
 *
 * Exit: 0=OK, 1=error, 2=warnings only
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { execSync, execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const WORKSPACE_ROOT = path.dirname(ROOT)
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

function fileHash(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function resolveActiveDevcodexRoot(repoRoot) {
  const legacyRoot = path.join(repoRoot, '.devcodex')
  const workspaceRoot = path.dirname(repoRoot)
  const layout = readJsonIfExists(path.join(workspaceRoot, '.devcodex', 'layout.json'))
  if (layout && layout.mode === 'workspace-namespace') {
    const namespacedRoot = path.join(workspaceRoot, '.devcodex', path.basename(repoRoot))
    if (fs.existsSync(namespacedRoot)) return namespacedRoot
  }

  const legacyLooksComplete = ['profile', 'requirements', 'bugs', '.memory'].some(name => {
    return fs.existsSync(path.join(legacyRoot, name))
  })
  if (legacyLooksComplete) return legacyRoot

  return legacyRoot
}

const ACTIVE_DEVCODEX_ROOT = resolveActiveDevcodexRoot(ROOT)
function activePath(...segments) {
  return path.join(ACTIVE_DEVCODEX_ROOT, ...segments)
}

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
  const roots = ['instructions', 'skills', 'prompts', 'website/docs', 'changelogs']
  const topFiles = ['README.md', 'CHANGELOG.md', 'RULES.md']
  const files = roots.flatMap(r => walk(path.join(ROOT, r))).filter(f => f.endsWith('.md'))
    .concat(topFiles.map(f => path.join(ROOT, f)).filter(f => fs.existsSync(f)))
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
  const commonContent = read(path.join(ROOT, 'instructions/01-common.instructions.md'))
  const routingContent = read(path.join(ROOT, 'skills/routing/SKILL.md'))
  const probes = [
    { token: 'dev.default', files: ['instructions/01-common.instructions.md', 'skills/routing/SKILL.md', 'instructions/10-dev.instructions.md'] },
    { token: 'dev.docs', files: ['instructions/01-common.instructions.md', 'skills/routing/SKILL.md', 'instructions/10-dev.instructions.md'] },
    { token: 'dev.refactor', files: ['instructions/01-common.instructions.md', 'skills/routing/SKILL.md'] },
    { token: 'dev.database', files: ['instructions/01-common.instructions.md', 'skills/routing/SKILL.md'] },
    { token: 'dev.optimization', files: ['instructions/01-common.instructions.md', 'skills/routing/SKILL.md'] },
    { token: 'dev.scenario-test', files: ['instructions/01-common.instructions.md', 'skills/routing/SKILL.md'] },
    { token: 'dev.plan-review', files: ['instructions/01-common.instructions.md', 'skills/routing/SKILL.md'] },
    { token: 'fix.default', files: ['instructions/01-common.instructions.md', 'skills/routing/SKILL.md', 'instructions/11-fix.instructions.md'] },
    { token: 'fix.security', files: ['instructions/01-common.instructions.md', 'skills/routing/SKILL.md'] },
    { token: 'analyze.default', files: ['instructions/01-common.instructions.md', 'skills/routing/SKILL.md', 'instructions/13-analyze.instructions.md', 'prompts/report-analysis.prompt.md'] },
    { token: 'analyze.research', files: ['skills/routing/SKILL.md', 'skills/analyze-research/SKILL.md', 'prompts/report-analysis.prompt.md'] }
  ]
  for (const probe of probes) {
    for (const file of probe.files) {
      const content = file === 'instructions/01-common.instructions.md'
        ? commonContent
        : file === 'skills/routing/SKILL.md'
          ? routingContent
          : read(path.join(ROOT, file))
      if (!content.includes(probe.token)) warn(`[V3] ${file} missing subtype token: ${probe.token}`)
    }
  }
  console.log('[V3] subtype sync checked (dev/fix/audit/analyze)')
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
    const pkg = JSON.parse(read(path.join(ROOT, 'package.json')))
    const plugin = JSON.parse(read(path.join(ROOT, 'plugin.json')))
    const packageFiles = new Set((pkg.files || []).filter(item => !item.endsWith('/')))
    const pluginFiles = new Set((plugin.skills || []).map(item => item.file).filter(Boolean))
    const promptFiles = walk(path.join(ROOT, 'prompts'))
      .filter(file => file.endsWith('.prompt.md'))
      .map(file => path.relative(ROOT, file).replace(/\\/g, '/'))
    const dataTemplateFiles = walk(path.join(ROOT, 'data', 'templates'))
      .filter(file => file.endsWith('.md'))
      .map(file => path.relative(ROOT, file).replace(/\\/g, '/'))
    const required = [
      'instructions.md',
      'plugin.json',
      '.mcp.json',
      'codex/hooks.json',
      'hooks/devcodex.lifecycle.json',
      'hooks/_runtime/lifecycle.cjs',
      'mcp/memory-server.js',
      'mcp/profile-server.js',
      'scripts/instruction-fallback-check.js',
      'scripts/migrate-layout.js',
      'assets/icon-512.png'
    ].concat([...packageFiles], [...pluginFiles], promptFiles, dataTemplateFiles)
      .filter(file => file && !file.endsWith('/'))
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
    const codexHookConfig = JSON.parse(read(path.join(ROOT, 'codex/hooks.json')))
    const codexHookCommands = Object.values(codexHookConfig.hooks || {})
      .flat()
      .flatMap(entry => entry.command ? [entry.command] : (entry.hooks || []).map(hook => hook.command).filter(Boolean))
    const expectedCodexCommand = 'node ./.codex/hooks/_runtime/lifecycle.cjs'
    const invalidCodexCommands = codexHookCommands.filter(command => command !== expectedCodexCommand)
    if (!codexHookCommands.length || invalidCodexCommands.length) {
      err(`[V6] Codex hook commands must use workspace runtime path: ${invalidCodexCommands.join(', ') || '(none found)'}`)
    }
    for (const probe of ['CODEX_SOURCES', 'CODEX_HOOK_COMMAND', 'cmdInitCodex', '--codex']) {
      if (!indexSrc.includes(probe)) {
        err(`[V6] Codex adapter missing index.js probe: ${probe}`)
      }
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
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-v7-hooks-'))
    try {
      fs.mkdirSync(path.join(tmp, '.devcodex', 'profile'), { recursive: true })
      fs.writeFileSync(path.join(tmp, '.devcodex', 'profile', 'config.json'), JSON.stringify({ mode: 'dev', agent: 'codex' }))
      const runHook = (payload, env = {}) => JSON.parse(execFileSync(
        process.execPath,
        [path.join(ROOT, 'hooks', '_runtime', 'lifecycle.cjs')],
        { cwd: tmp, input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, ...env } }
      ) || '{}')
      runHook({ hookEventName: 'UserPromptSubmit', prompt: 'validate codex hook contract' }, { CODEX_HOME: '1' })
      runHook({
        hookEventName: 'PostToolUse',
        tool_name: 'apply_patch',
        tool_input: { input: '*** Begin Patch\n*** Add File: src/contract.js\n+contract\n*** End Patch' }
      }, { CODEX_HOME: '1' })
      const precompact = runHook(
        { hookEventName: 'PreCompact', assistantMessage: 'progress' },
        { CODEX_HOME: '1', DEVCODEX_HOOK_ENFORCEMENT: 'strict' }
      )
      if (precompact.continue !== false || precompact.hookSpecificOutput?.decision) {
        err('[V7] Codex PreCompact contract probe failed: expected continue:false without nested hookSpecificOutput.decision')
      }
      const stop = runHook(
        { hookEventName: 'Stop', assistantMessage: 'done' },
        { CODEX_HOME: '1', DEVCODEX_HOOK_ENFORCEMENT: 'strict' }
      )
      if (stop.decision !== 'block' || stop.hookSpecificOutput?.decision) {
        err('[V7] Codex Stop contract probe failed: expected top-level decision:block without nested hookSpecificOutput.decision')
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
    console.log('[V7] hooks runtime smoke test passed')
  } catch (e) {
    // F-013: 保留 stderr 前 8 行
    const detail = String((e.stderr || e.stdout || e.message || '')).trim().split('\n').slice(0, 8).join(' | ')
    err(`[V7] hooks runtime smoke test failed${detail ? `: ${detail}` : ''}`)
  }
}

// ── V8: deployment sync check ─────────────────────────────────────────────
// 验证工作区根的部署体（父级 .claude/ / .github/ / Codex adapter）是否同步源仓库的关键文件。
// 仅在父级部署体存在时运行；不存在则跳过（属于纯 plugin 仓库场景）。
function checkV8() {
  const PARENT = path.dirname(ROOT)
  const claudeDir = path.join(PARENT, '.claude')
  const githubDir = path.join(PARENT, '.github')
  const agentsDir = path.join(PARENT, '.agents')
  const codexDir = path.join(PARENT, '.codex')
  const claudeExists = fs.existsSync(claudeDir)
  const githubExists = fs.existsSync(githubDir)
  const codexExists = fs.existsSync(path.join(PARENT, 'AGENTS.md')) || fs.existsSync(agentsDir) || fs.existsSync(codexDir)

  if (!claudeExists && !githubExists && !codexExists) {
    console.log('[V8] no parent deployment (.claude/ / .github/ / Codex adapter) detected — skip')
    return
  }

  // F-005: 关键文件清单扩展至 prompts/skills/instructions/hooks/CLAUDE.md/mcp 全维度
  // 注：CLAUDE.md 与 mcp/ 仅在 .claude/ 同步（Copilot 不需要）；agents/ 同理；prompts/ 在 .claude/ 和 .github/ 均同步
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
    // MCP（Claude Code only）
    { src: 'mcp/memory-server.js', claude: 'mcp/memory-server.js', github: null },
    { src: 'mcp/profile-server.js', claude: 'mcp/profile-server.js', github: null },
    // Workspace CLAUDE.md is generated from the v1.9.8+ single source instructions.md.
    { src: 'instructions.md', claude: '../CLAUDE.md', github: null }
  ]
  const seenPairs = new Set(checkPairs.map(pair => pair.src))
  function addPair(src, claude = src, github = src) {
    if (seenPairs.has(src)) return
    seenPairs.add(src)
    checkPairs.push({ src, claude, github })
  }
  for (const dir of ['instructions', 'skills', 'prompts']) {
    for (const file of walk(path.join(ROOT, dir)).filter(file => file.endsWith('.md'))) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/')
      addPair(rel)
    }
  }
  for (const file of walk(path.join(ROOT, 'data', 'templates')).filter(file => file.endsWith('.md'))) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/')
    addPair(rel, rel.replace(/^data\/templates\//, 'data/'), rel.replace(/^data\/templates\//, 'data/'))
  }
  for (const file of walk(path.join(ROOT, 'agents')).filter(file => file.endsWith('.md'))) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/')
    addPair(rel, null, rel)
  }
  addPair('RULES.md', null, 'RULES.md')
  addPair('hooks/devcodex.lifecycle.json', null, 'hooks/devcodex.lifecycle.json')

  let stale = 0
  function compareDeployment(srcRel, destPath, label, fixHint) {
    const srcPath = path.join(ROOT, srcRel)
    if (!fs.existsSync(srcPath)) return
    if (!fs.existsSync(destPath)) {
      warn(`[V8] ${label} missing (run: ${fixHint})`)
      stale++
      return
    }
    if (fileHash(destPath) !== fileHash(srcPath)) {
      warn(`[V8] ${label} stale (run: ${fixHint})`)
      stale++
    }
  }

  for (const pair of checkPairs) {
    const srcPath = path.join(ROOT, pair.src)
    if (!fs.existsSync(srcPath)) continue

    if (claudeExists && pair.claude) {
      const dest = path.join(claudeDir, pair.claude)
      if (fs.existsSync(dest)) {
        if (fileHash(dest) !== fileHash(srcPath)) {
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
        if (fileHash(dest) !== fileHash(srcPath)) {
          warn(`[V8] .github/ stale: ${pair.github} (run: npx devcodex update)`)
          stale++
        }
      } else {
        warn(`[V8] .github/ missing: ${pair.github}`)
        stale++
      }
    }
  }

  if (githubExists) {
    compareDeployment(
      'instructions.md',
      path.join(githubDir, 'copilot-instructions.md'),
      '.github/copilot-instructions.md',
      'npx devcodex update'
    )
  }

  if (codexExists) {
    compareDeployment('instructions.md', path.join(PARENT, 'AGENTS.md'), 'AGENTS.md', 'npx devcodex update --codex')
    compareDeployment('codex/hooks.json', path.join(codexDir, 'hooks.json'), '.codex/hooks.json', 'npx devcodex update --codex')

    for (const file of walk(path.join(ROOT, 'skills'))) {
      const rel = path.relative(path.join(ROOT, 'skills'), file)
      compareDeployment(
        path.join('skills', rel).replace(/\\/g, '/'),
        path.join(agentsDir, 'skills', rel),
        `.agents/skills/${rel.replace(/\\/g, '/')}`,
        'npx devcodex update --codex'
      )
    }
    for (const file of walk(path.join(ROOT, 'hooks', '_runtime'))) {
      const rel = path.relative(path.join(ROOT, 'hooks', '_runtime'), file)
      compareDeployment(
        path.join('hooks/_runtime', rel).replace(/\\/g, '/'),
        path.join(codexDir, 'hooks', '_runtime', rel),
        `.codex/hooks/_runtime/${rel.replace(/\\/g, '/')}`,
        'npx devcodex update --codex'
      )
    }

    const codexRuntime = path.join(codexDir, 'hooks', '_runtime', 'lifecycle.cjs')
    if (fs.existsSync(codexRuntime)) {
      try {
        const probePrompt = `in ${path.basename(ROOT)}/ validate DevCodex Codex bootstrap`
        const out = execSync('node ./.codex/hooks/_runtime/lifecycle.cjs', {
          cwd: PARENT,
          input: JSON.stringify({ hookEventName: 'UserPromptSubmit', prompt: probePrompt }),
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe']
        })
        const payload = JSON.parse(out || '{}')
        const context = payload.hookSpecificOutput?.additionalContext || ''
        if (!payload.systemMessage || !/PC0-PC7/.test(context) || payload.hookSpecificOutput?.hookEventName !== 'UserPromptSubmit') {
          warn('[V8] Codex UserPromptSubmit output missing systemMessage/additionalContext PC0-PC7 bootstrap context')
          stale++
        }
      } catch (e) {
        warn(`[V8] Codex hook semantic probe failed: ${String(e.message || e).split('\n')[0]}`)
        stale++
      }
    }
  }

  if (stale === 0) {
    console.log('[V8] parent deployment (.claude/ / .github/ / Codex adapter) in sync with source repo')
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
  const stateDir = activePath('.audit-state')
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
  mustInclude('prompts/precheck-status.prompt.md', '全模式入口检查', 'precheck prompt')
  mustInclude('prompts/precheck-status.prompt.md', '项目现实扩展后', 'precheck prompt')
  mustInclude('prompts/precheck-status.prompt.md', 'prod：输出 PC0~PC7 基础入口检查', 'precheck prompt')
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
  mustInclude('instructions.md', '当前实际宿主优先', 'instructions actual host agent priority')
  mustInclude('instructions/15-memory.instructions.md', '当前实际宿主（优先）', '15-memory actual host agent priority')
  mustInclude('instructions/15-memory.instructions.md', 'Profile agent 兜底', '15-memory profile agent fallback')
  mustInclude('skills/memory/SKILL.md', '当前实际宿主（优先）', 'memory skill actual host agent priority')
  mustInclude('skills/memory/SKILL.md', 'Profile agent 兜底', 'memory skill profile agent fallback')
  mustInclude('skills/load-profile/SKILL.md', 'config.json.agent` 只用于当前实际宿主无法可靠判断时的 fallback hint', 'load-profile agent fallback')
  mustInclude('mcp/profile-server.js', 'profileAgent', 'profile MCP exposes fallback agent')
  mustInclude('mcp/memory-server.js', 'DEVCODEX_AGENT', 'memory MCP runtime agent')
  mustInclude('scripts/test-mcp-servers.js', 'testProfileAgentUsesRuntimeBeforeProfileFallback', 'MCP actual host agent test')
  mustInclude('scripts/test-mcp-servers.js', 'testMemoryActualHostEnvAgent', 'MCP memory actual host test')
  mustInclude('mcp/memory-server.js', 'workspace-namespace memory scope is ambiguous', 'memory MCP explicit workspace scope')
  mustInclude('scripts/test-mcp-servers.js', 'testWorkspaceRootMemoryScopeRequiresExplicitTarget', 'MCP workspace scope ambiguity test')
  mustInclude('instructions/15-memory.instructions.md', 'MCP memory scope（workspace-namespace）', '15-memory explicit MCP scope')
  mustInclude('skills/memory/SKILL.md', 'MCP memory scope（workspace-namespace）', 'memory skill explicit MCP scope')
  mustNotInclude('instructions/15-memory.instructions.md', 'Profile 显式配置**（优先）', '15-memory legacy profile-priority agent')
  mustNotInclude('skills/memory/SKILL.md', 'Profile 显式配置**（优先）', 'memory skill legacy profile-priority agent')

  mustInclude('prompts/api-verification.prompt.md', '不在脚本内自启服务', 'api verification prompt')
  mustInclude('prompts/api-verification.prompt.md', '仅作为人工检查提示', 'api verification prompt')
  mustInclude('prompts/api-verification.prompt.md', '@resourceId = replace-with-created-id', 'api verification prompt')
  mustInclude('prompts/api-verification.prompt.md', 'new URL(path, BASE_URL)', 'api verification prompt')
  mustNotInclude('prompts/api-verification.prompt.md', '// ... HTTP 请求实现', 'api verification prompt')
  mustNotInclude('prompts/api-verification.prompt.md', 'tests/api/<module>.test.cjs', 'api verification prompt')
  mustInclude('skills/api-verification/SKILL.md', '禁止自启服务', 'api verification skill')
  mustInclude('skills/api-verification/SKILL.md', "const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000'", 'api verification skill')
  mustInclude('skills/api-verification/SKILL.md', 'headers = {}', 'api verification skill')
  mustInclude('skills/api-verification/SKILL.md', '请求样本 + 可选轻提示', 'api verification skill')
  mustNotInclude('skills/api-verification/SKILL.md', "hostname: 'localhost'", 'api verification skill')
  mustInclude('skills/dev-scenario-test/SKILL.md', '.devcodex/scenario-tests', 'scenario test skill')
  mustInclude('skills/dev-testing/SKILL.md', '项目自身 API 测试可另存 `tests/api/`', 'dev testing skill')
  mustInclude('skills/dev-testing/SKILL.md', 'tsc --noEmit', 'dev testing skill')
  mustInclude('skills/dev-testing/SKILL.md', '临时创建 `tsconfig`', 'dev testing skill')
  mustInclude('instructions/10-dev.instructions.md', 'tsc --noEmit', '10-dev typecheck rule')
  mustInclude('instructions/11-fix.instructions.md', 'tsc --noEmit', '11-fix typecheck rule')
  mustInclude('instructions/17-compliance.instructions.md', '入口检查（所有模式', '17-compliance all-mode entry check')
  mustInclude('instructions/17-compliance.instructions.md', '项目现实扩展后', '17-compliance project reality expansion')
  mustInclude('instructions/01-common.instructions.md', '项目现实扩展（Project Reality Expansion）', '01-common project reality expansion')
  mustInclude('skills/intent/SKILL.md', '项目现实扩展衔接', 'intent project reality expansion')
  mustInclude('skills/load-profile/SKILL.md', '项目现实扩展输出', 'load-profile project reality expansion')
  mustInclude('hooks/_runtime/lifecycle.cjs', 'entry check PC0-PC7', 'lifecycle all-mode entry check')
  mustInclude('hooks/_runtime/lifecycle.cjs', 'contextMessageOutput', 'lifecycle Codex UserPromptSubmit context')
  mustInclude('hooks/_runtime/lifecycle.cjs', 'additionalContext', 'lifecycle Codex UserPromptSubmit context')
  mustInclude('hooks/_runtime/lifecycle.cjs', 'warningOutput(reason, detail, eventName)', 'lifecycle Codex warning context')
  mustInclude('hooks/_runtime/lifecycle.cjs', 'INTERCEPTION_ACTION', 'lifecycle interception action model')
  mustInclude('hooks/_runtime/lifecycle.cjs', 'interceptions.jsonl', 'lifecycle interception audit log')
  mustInclude('hooks/_runtime/lifecycle.cjs', 'eventSupportsHardBlock', 'lifecycle host hard-block capability')
  mustInclude('hooks/_runtime/lifecycle.cjs', 'normalizeHookEvent', 'lifecycle host event normalization')
  mustInclude('hooks/_runtime/lifecycle.cjs', 'dangerous-command-confirmed', 'lifecycle dangerous command confirmation audit')
  mustInclude('hooks/_runtime/lifecycle.cjs', 'stopReason', 'lifecycle Codex PreCompact contract output')
  mustInclude('hooks/_runtime/lifecycle.cjs', 'devcodex-approve', 'lifecycle dangerous command approval marker')
  mustInclude('scripts/test-hooks-runtime.js', 'autoCodexEntryAllowed', 'hooks runtime Codex governance test')
  mustInclude('scripts/test-hooks-runtime.js', 'autoCodexHookAllowed', 'hooks runtime Codex governance test')
  mustInclude('scripts/test-hooks-runtime.js', 'multiProjectPromptWarning', 'hooks runtime Codex multi-project warning context')
  mustInclude('scripts/test-hooks-runtime.js', 'dangerous-command-approved', 'hooks runtime dangerous command audit test')
  mustInclude('scripts/test-hooks-runtime.js', 'strictStopBlock', 'hooks runtime strict Stop block test')
  mustInclude('index.js', 'cmdInitCodex', 'index Codex adapter')
  mustInclude('index.js', 'CODEX_HOOK_COMMAND', 'index Codex adapter')
  mustInclude('index.js', 'readCodexHookCommands', 'index Codex hook command diagnostics')
  mustInclude('index.js', 'Codex trust/config', 'index Codex trust/config diagnostics')
  mustInclude('index.js', 'hook guardrail (Codex; event-dependent)', 'index Codex event-dependent guardrail diagnostics')
  mustInclude('index.js', 'workspace-hooks detected (VS Code Copilot preview; verify target IDE)', 'index VS Code hook preview diagnostics')
  mustInclude('index.js', 'default safety-only warns/continues', 'index enforcement default diagnostics')
  mustInclude('codex/hooks.json', '.codex/hooks/_runtime/lifecycle.cjs', 'Codex hook config')
  mustInclude('README.md', 'OpenAI Codex app/CLI', 'README Codex support matrix')
  mustInclude('README.md', 'Codex hook guardrail', 'README Codex support matrix capability caveat')
  mustInclude('README.md', 'Hook 拦截动作语义', 'README interception action semantics')
  mustInclude('instructions.md', 'Hook 拦截动作语义', 'instructions interception action semantics')
  mustNotInclude('README.md', 'ChatGPT / OpenAI Codex', 'README Codex support matrix')
  mustNotInclude('README.md', '仅 instruction 注入，无运行时拦截', 'README support-level legend')
  mustNotInclude('README.md', 'OpenAI Codex app/CLI** | `AGENTS.md` + `.agents/skills/` + `.codex/hooks.json` | ✅ `lifecycle.cjs` | ✅ Hook | ❌ 未内置 MCP', 'README Codex MCP overclaim')
  mustInclude('prompts/technical-design.prompt.md', 'tsc --noEmit', 'technical design prompt')
  mustInclude('prompts/report-dev.prompt.md', '静态/类型检查', 'report dev prompt')
  mustInclude('prompts/report-fix.prompt.md', '静态/类型检查', 'report fix prompt')

  mustInclude('prompts/requirement.prompt.md', '## 目录导航', 'requirement prompt')
  mustInclude('prompts/requirement.prompt.md', '§0 需求类型判定', 'requirement prompt')
  mustInclude('prompts/requirement.prompt.md', '§2.1 核心定义', 'requirement prompt')
  mustInclude('prompts/requirement.prompt.md', '§2.2 作用域与边界判定', 'requirement prompt')
  mustInclude('prompts/requirement.prompt.md', '§9 当前阶段结论', 'requirement prompt')

  mustInclude('prompts/technical-design.prompt.md', '## 目录导航', 'technical design prompt')
  mustInclude('prompts/technical-design.prompt.md', '§1.3 关联目标文档', 'technical design prompt')
  mustInclude('prompts/technical-design.prompt.md', '§2.6 实施映射与范围边界', 'technical design prompt')
  mustInclude('prompts/technical-design.prompt.md', '偏移触发器', 'technical design prompt')

  mustInclude('prompts/implementation-plan.prompt.md', '## 目录导航', 'implementation plan prompt')
  mustInclude('prompts/implementation-plan.prompt.md', '§3 分批执行策略', 'implementation plan prompt')
  mustInclude('prompts/implementation-plan.prompt.md', '§4 关键实施约束', 'implementation plan prompt')
  mustInclude('prompts/implementation-plan.prompt.md', '§5 独立验证方式', 'implementation plan prompt')
  mustInclude('prompts/implementation-plan.prompt.md', '回滚触发条件', 'implementation plan prompt')

  mustInclude('prompts/implementation-progress.prompt.md', '## 目录导航', 'implementation progress prompt')
  mustInclude('prompts/implementation-progress.prompt.md', '是否阻断主线', 'implementation progress prompt')
  mustInclude('prompts/implementation-progress.prompt.md', '责任方', 'implementation progress prompt')
  mustInclude('prompts/implementation-progress.prompt.md', '预计解除时间', 'implementation progress prompt')
  mustInclude('prompts/implementation-progress.prompt.md', '下次检查点', 'implementation progress prompt')
  mustInclude('prompts/implementation-progress.prompt.md', '本轮验证结果', 'implementation progress prompt')

  mustInclude('prompts/project-readme.prompt.md', '## 目录导航', 'project readme prompt')
  mustInclude('prompts/project-readme.prompt.md', '**项目类型**', 'project readme prompt')
  mustInclude('prompts/project-readme.prompt.md', '用户 / 使用者优先', 'project readme prompt')
  mustInclude('prompts/project-readme.prompt.md', '## 适用对象与使用场景', 'project readme prompt')
  mustInclude('prompts/project-readme.prompt.md', '## 常见用法', 'project readme prompt')
  mustInclude('prompts/project-readme.prompt.md', '## 常见问题与排错', 'project readme prompt')
  mustInclude('prompts/project-readme.prompt.md', '## 开发与贡献', 'project readme prompt')
  mustInclude('prompts/project-readme.prompt.md', '### service / backend', 'project readme prompt')

  mustInclude('prompts/light-api-doc.prompt.md', '## 目录导航', 'light api doc prompt')
  mustInclude('prompts/light-api-doc.prompt.md', 'curl -X', 'light api doc prompt')
  mustInclude('prompts/light-api-doc.prompt.md', '典型成功响应', 'light api doc prompt')
  mustInclude('prompts/light-api-doc.prompt.md', '典型错误响应', 'light api doc prompt')

  mustInclude('prompts/general-doc.prompt.md', '## 目录导航', 'general doc prompt')
  mustInclude('prompts/general-doc.prompt.md', '**文档类型**', 'general doc prompt')
  mustInclude('prompts/general-doc.prompt.md', '## 4. 核心内容', 'general doc prompt')

  mustInclude('skills/dev-docs/SKILL.md', 'general-doc', 'dev docs skill')
  mustInclude('skills/dev-docs/SKILL.md', '所有 Markdown 文档必须包含 `## 目录导航`', 'dev docs skill')
  mustInclude('instructions/10-dev.instructions.md', 'Markdown 文档可读性要求', '10-dev docs readability rule')
  mustInclude('instructions/10-dev.instructions.md', '目标文档路径、文档模式', '10-dev target doc anchor rule')
  mustInclude('skills/dev-default/SKILL.md', '目标文档路径/模式/契约范围', 'dev default skill')
  mustInclude('skills/dev-default/SKILL.md', '目录导航', 'dev default skill')

  mustInclude('skills/cp-gate/SKILL.md', 'CP3: N/A', 'cp gate skill')
  mustInclude('skills/cp-gate/SKILL.md', '问题 ID 映射', 'cp gate audit-to-fix issue mapping')
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
  const stateDir = activePath('.audit-state')
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
  const allowedFindingStates = new Set(['open', 'pending', 'in-progress', 'fixed', 'wontfix', 'accepted', 'recorded', 'transferred', 'superseded'])
  const unresolvedFindingStates = new Set(['open', 'pending', 'in-progress'])
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

    if (Array.isArray(state.findings)) {
      for (const finding of state.findings) {
        const status = String(finding.status || '').toLowerCase()
        if (!allowedFindingStates.has(status)) {
          warn(`[V15] invalid finding status in .devcodex/.audit-state/${sf}: ${finding.id || 'unknown'}=${finding.status || 'missing'}`)
          violations++
        }
      }
    }

    if (state.state === 'converged' || state.state === 'closed') {
      const unresolved = Array.isArray(state.findings)
        ? state.findings.filter(finding => unresolvedFindingStates.has(String(finding.status || '').toLowerCase()))
        : []
      if (unresolved.length) {
        warn(`[V15] terminal audit-state has unresolved findings: .devcodex/.audit-state/${sf} (${unresolved.length})`)
        violations++
      }
    }

    if (state.state === 'paused') {
      const unresolved = Array.isArray(state.findings)
        ? state.findings.filter(finding => unresolvedFindingStates.has(String(finding.status || '').toLowerCase()))
        : []
      if (unresolved.length && (!state.linkedReport || !state.lastCheckpoint || !state.lastCheckpoint.reason)) {
        warn(`[V15] paused audit-state with unresolved findings must include linkedReport and lastCheckpoint.reason: .devcodex/.audit-state/${sf}`)
        violations++
      }
    }
  }

  console.log(`[V15] audit-state consistency checked: ${stateFiles.length} files, ${violations} violation(s)`)
}

function checkV16() {
  try {
    execSync('node scripts/test-mcp-servers.js', { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    console.log('[V16] MCP servers smoke test passed')
  } catch (e) {
    const detail = String((e.stderr || e.stdout || e.message || '')).trim().split('\n').slice(0, 8).join(' | ')
    err(`[V16] MCP servers smoke test failed${detail ? `: ${detail}` : ''}`)
  }
}

function checkV17() {
  try {
    execSync('node scripts/validate-profile.js', { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    console.log('[V17] profile drift check passed')
  } catch (e) {
    const detail = String((e.stderr || e.stdout || e.message || '')).trim().split('\n').slice(0, 8).join(' | ')
    err(`[V17] profile drift check failed${detail ? `: ${detail}` : ''}`)
  }
}

function checkV18() {
  let mcp
  try {
    mcp = JSON.parse(read(path.join(ROOT, '.mcp.json')))
  } catch (e) {
    err(`[V18] .mcp.json invalid JSON: ${e.message}`)
    return
  }

  if (!mcp.mcpServers || typeof mcp.mcpServers !== 'object') {
    err('[V18] .mcp.json must use Claude Code project schema root "mcpServers"')
  }
  if (Object.prototype.hasOwnProperty.call(mcp, 'servers')) {
    err('[V18] .mcp.json must not use VS Code-style root "servers" for Claude Code')
  }
  for (const name of ['devcodex-memory', 'devcodex-profile']) {
    const server = mcp.mcpServers && mcp.mcpServers[name]
    if (!server) {
      err(`[V18] .mcp.json missing MCP server: ${name}`)
      continue
    }
    const expectedScript = name === 'devcodex-memory'
      ? '.claude/mcp/memory-server.js'
      : '.claude/mcp/profile-server.js'
    if (server.command !== 'node') {
      err(`[V18] ${name} command must be node`)
    }
    if (!Array.isArray(server.args) || server.args.length !== 2) {
      err(`[V18] ${name} args must be ["${expectedScript}", "."]`)
      continue
    }
    if (server.args[0] !== expectedScript || server.args[1] !== '.') {
      err(`[V18] ${name} args must be ["${expectedScript}", "."]`)
    }
    if (server.args.some(arg => /\$\{/.test(String(arg)))) {
      err(`[V18] ${name} args must not require shell parameter expansion`)
    }
  }

  const indexSrc = read(path.join(ROOT, 'index.js'))
  if (!indexSrc.includes('mcpServers:')) {
    err('[V18] index.js CLAUDE_MCP_JSON must generate "mcpServers"')
  }
  if (/\n\s+servers:\s*\{/.test(indexSrc)) {
    err('[V18] index.js still contains VS Code-style "servers" root in generated MCP config')
  }
  if (indexSrc.includes('${CLAUDE_PROJECT_DIR:-.}')) {
    err('[V18] index.js must not generate shell-only MCP args with ${CLAUDE_PROJECT_DIR:-.}')
  }
  for (const required of [
    'CLAUDE_SETTINGS_PERMISSIONS',
    'enableAllProjectMcpServers',
    'permissions.allow',
    'mcp__devcodex-memory__*',
    'mcp__devcodex-profile__*'
  ]) {
    if (!indexSrc.includes(required)) {
      err(`[V18] index.js missing Claude Code settings permission probe text: ${required}`)
    }
  }
  console.log('[V18] Claude Code MCP/settings schema checked')
}

function checkV19() {
  const promptCount = walk(path.join(ROOT, 'prompts')).filter(f => f.endsWith('.prompt.md')).length
  const dataTemplateCount = walk(path.join(ROOT, 'data', 'templates')).filter(f => f.endsWith('.md')).length
  const scriptCount = walk(path.join(ROOT, 'scripts')).filter(f => f.endsWith('.js')).length
  const skillCount = walk(path.join(ROOT, 'skills')).filter(f => path.basename(f) === 'SKILL.md').length
  const checks = [
    { file: 'README.md', needle: `Skill 详细检查标准（${skillCount} 个，按需读取，含 README 专项能力、spec-governance 与 5 个支撑型 Skill）` },
    { file: 'README.md', needle: `Skill 详细检查标准（${skillCount} 个，按 01-common §按需读取表 路由读取）` },
    { file: 'README.md', needle: `Prompt 模板（${promptCount} 个）` },
    { file: activePath('profile', '01-项目信息.md'), needle: `| **Skill** | ${skillCount} |`, rawPath: false },
    { file: activePath('profile', '01-项目信息.md'), needle: `| **Prompt** | ${promptCount} |`, rawPath: false },
    { file: activePath('profile', '01-项目信息.md'), needle: `prompts ${promptCount}`, rawPath: false },
    { file: activePath('profile', '01-项目信息.md'), needle: `skills ${skillCount}`, rawPath: false },
    { file: activePath('profile', '02-架构约束.md'), needle: `Skill 文件 ${skillCount} 个`, rawPath: false },
    { file: activePath('profile', '02-架构约束.md'), needle: `Prompt 模板文件（.prompt.md，中文）${promptCount} 个`, rawPath: false },
    { file: activePath('profile', '01-项目信息.md'), needle: `| **data 模板** | ${dataTemplateCount} |`, rawPath: false },
    { file: activePath('profile', '01-项目信息.md'), needle: `| **CLI 工程脚本** | ${scriptCount} |`, rawPath: false },
    { file: activePath('profile', '01-项目信息.md'), needle: 'scripts/check-syntax.js', rawPath: false },
    { file: 'website/docs/index.md', needle: `🛠️ ${skillCount} 个 Skills` },
    { file: 'website/docs/intro/index.md', needle: `${skillCount} 个按需触发的工作流技能` },
    { file: 'website/docs/specs/directory-structure.md', needle: `扁平一级 Skill（${skillCount} 个）` }
  ]
  for (const check of checks) {
    const filePath = check.rawPath === false ? check.file : path.join(ROOT, check.file)
    if (!fs.existsSync(filePath)) {
      warn(`[V19] asset count source missing, skip: ${path.relative(ROOT, filePath)}`)
      continue
    }
    const content = read(filePath)
    if (!content.includes(check.needle)) {
      err(`[V19] asset count drift in ${check.rawPath === false ? path.relative(ROOT, check.file) : check.file}: expected text "${check.needle}"`)
    }
  }
  console.log(`[V19] asset counts checked: skills=${skillCount}, prompts=${promptCount}, data-templates=${dataTemplateCount}, scripts=${scriptCount}`)
}

function checkV20() {
  const probes = [
    {
      file: 'instructions/02-output-paths.instructions.md',
      needles: [
        'changelogs/unreleased.md',
        '用户**未明确要求** `tag` / `release` / `publish` 时',
        '仅在用户明确确认 release 后执行'
      ]
    },
    {
      file: 'website/docs/guide/release.md',
      needles: [
        '三层日志',
        'changelogs/unreleased.md',
        '用户**未明确要求** `tag` / `release` / `publish` 时'
      ]
    },
    {
      file: 'skills/document-sync/SKILL.md',
      needles: [
        '`changelogs/unreleased.md`',
        '仅正式发版时更新已发布版本索引'
      ]
    },
    {
      file: 'prompts/report-dev.prompt.md',
      needles: [
        'Release 状态',
        '日志落点'
      ]
    },
    {
      file: 'prompts/report-fix.prompt.md',
      needles: [
        'Release 状态',
        'CHANGELOG / unreleased 已按发布状态更新'
      ]
    }
  ]

  for (const probe of probes) {
    const content = read(path.join(ROOT, probe.file))
    for (const needle of probe.needles) {
      if (!content.includes(needle)) {
        err(`[V20] release/changelog dual-track drift in ${probe.file}: missing "${needle}"`)
      }
    }
  }
  const unreleased = read(path.join(ROOT, 'changelogs', 'unreleased.md'))
  if (unreleased.includes('暂无未发布变更')) {
    const dateHeadings = [...unreleased.matchAll(/^## \d{4}-\d{2}-\d{2}/gm)]
    const contentAfterEmptyMarker = unreleased.split('暂无未发布变更').slice(1).join('暂无未发布变更')
    if (dateHeadings.length > 1 || /^## \d{4}-\d{2}-\d{2}/m.test(contentAfterEmptyMarker)) {
      err('[V20] changelogs/unreleased.md mixes empty-template marker with archived date sections')
    }
  }
  console.log('[V20] release/changelog dual-track semantics checked')
}

function checkV21() {
  const probes = [
    {
      file: 'instructions/01-common.instructions.md',
      needles: [
        '默认更新 `changelogs/unreleased.md`',
        '`commit` 默认**不自动执行**',
        '按**语义批次**提交',
        '显式输出结果',
        '必须追加交叉验证'
      ]
    },
    {
      file: 'skills/cp-gate/SKILL.md',
      needles: [
        '显式输出结果',
        '必须追加交叉验证',
        '前置复审结果：✅ 无阻断，可进入下一阶段'
      ]
    },
    {
      file: 'instructions/10-dev.instructions.md',
      needles: [
        '已验证的语义变更批次',
        '必须追加交叉验证',
        '前置复审结果：✅ 无阻断，可进入下一阶段'
      ]
    },
    {
      file: 'instructions/11-fix.instructions.md',
      needles: [
        '已验证的语义修复批次',
        '必须追加交叉验证',
        '前置复审结果：✅ 无阻断，可进入下一阶段'
      ]
    },
    {
      file: 'instructions/01-common.instructions.md',
      needles: [
        '统一联查矩阵（C11 扩展）',
        'L1 最小联查',
        'L2 标准联查',
        'L3 强联查',
        '控制面规则变更'
      ]
    },
    {
      file: 'instructions/10-dev.instructions.md',
      needles: [
        '统一联查矩阵（dev 最小动作）',
        '高联动场景默认升为 L2 标准联查',
        'L3 强联查'
      ]
    },
    {
      file: 'instructions/11-fix.instructions.md',
      needles: [
        '统一联查矩阵映射（fix）',
        'fix 默认按 **L2 标准联查** 起步',
        '工作区真相源 / 部署副本 / 分发链修复'
      ]
    },
    {
      file: 'instructions/13-analyze.instructions.md',
      needles: [
        '相关文件联查（analyze-lite）',
        '建立关联文件集合',
        '收敛前必须再跑一次 `CRS`'
      ]
    },
    {
      file: 'skills/fix-default/SKILL.md',
      needles: [
        '模板/示例不可直接执行',
        '自动化校验假绿'
      ]
    },
    {
      file: 'skills/dev-default/SKILL.md',
      needles: [
        '统一联查矩阵（F-25）',
        '默认升为 L2 标准联查',
        '高联动场景不得只做单文件修改'
      ]
    },
    {
      file: 'skills/fix-default/SKILL.md',
      needles: [
        '统一联查矩阵视为 L2 起步',
        '必须升为 L3'
      ]
    },
    {
      file: 'skills/analyze-research/SKILL.md',
      needles: [
        '建立关联文件集合',
        '收敛前再跑一次 CRS',
        '统一联查矩阵（research 最小动作）'
      ]
    },
    {
      file: 'skills/audit-common/SKILL.md',
      needles: [
        '统一联查矩阵映射（audit = L3）',
        'L3 强联查',
        '不被其他轻量联查规则替代'
      ]
    }
  ]

  for (const probe of probes) {
    const content = read(path.join(ROOT, probe.file))
    for (const needle of probe.needles) {
      if (!content.includes(needle)) {
        err(`[V21] workflow control-plane drift in ${probe.file}: missing "${needle}"`)
      }
    }
  }

  const workspaceAgents = path.resolve(ROOT, '..', 'AGENTS.md')
  if (fs.existsSync(workspaceAgents)) {
    const content = read(workspaceAgents)
    for (const needle of [
      '强制约束（C01~C19）',
      '全量 FC1~FC7 + SC1~SC15 + RC1~RC4 + T1~T9',
      'CHANGELOG / unreleased 已按发布状态追加'
    ]) {
      if (!content.includes(needle)) {
        err(`[V21] workspace AGENTS drift: missing "${needle}" in ../AGENTS.md`)
      }
    }
  }

  console.log('[V21] workflow control-plane semantics checked')
}

function checkV22() {
  try {
    execSync('node scripts/test-migrate-layout.js', { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    console.log('[V22] migrate-layout smoke test passed')
  } catch (e) {
    const detail = String((e.stderr || e.stdout || e.message || '')).trim().split('\n').slice(0, 8).join(' | ')
    err(`[V22] migrate-layout smoke test failed${detail ? `: ${detail}` : ''}`)
  }

  const probes = [
    {
      file: 'instructions/01-common.instructions.md',
      needles: ['workspace-namespace', 'single active scope write', 'workspace base + project overlay']
    },
    {
      file: 'instructions/02-output-paths.instructions.md',
      needles: ['<active-root>', 'layout.json', '<工作区根>/.devcodex/workspace/']
    },
    {
      file: 'mcp/profile-server.js',
      needles: ['workspace-namespace', '.devcodex', 'mergeConfig']
    },
    {
      file: 'mcp/memory-server.js',
      needles: ['scope', 'workspace-namespace', 'getActiveRoot']
    },
    {
      file: 'hooks/_runtime/lifecycle.cjs',
      needles: ['activeScope', 'workspace-namespace', 'getActiveNamespaceRoot']
    },
    {
      file: 'README.md',
      needles: ['migrate-layout', 'layout.json', '.devcodex/workspace']
    }
  ]

  for (const probe of probes) {
    const content = read(path.join(ROOT, probe.file))
    for (const needle of probe.needles) {
      if (!content.includes(needle)) {
        err(`[V22] workspace namespace drift in ${probe.file}: missing "${needle}"`)
      }
    }
  }
  console.log('[V22] workspace namespace semantics checked')
}

function checkV23() {
  const probes = [
    {
      file: 'instructions/01-common.instructions.md',
      needles: ['机械唱反调', '用户方案已是当前最优', '不得直接顺从论证']
    },
    {
      file: 'instructions/10-dev.instructions.md',
      needles: ['机械反对', '用户给出的目录结构、实施顺序或方案本身经验证已是当前最优']
    },
    {
      file: 'instructions/11-fix.instructions.md',
      needles: ['机械反对', '修复路径经验证已是当前最优']
    },
    {
      file: 'instructions/12-audit.instructions.md',
      needles: ['已验证成立', '不得为了显得客观而反向挑错']
    },
    {
      file: 'instructions/13-analyze.instructions.md',
      needles: ['独立取证', '机械反对']
    },
    {
      file: 'skills/audit-common/SKILL.md',
      needles: ['判断独立性', '机械唱反调']
    },
    {
      file: 'skills/report/SKILL.md',
      needles: ['经独立验证后采纳', '证据来源']
    },
    {
      file: 'skills/cp-gate/SKILL.md',
      needles: ['推荐项可以与用户原始方案相同', '客观依据']
    }
  ]

  for (const probe of probes) {
    const content = read(path.join(ROOT, probe.file))
    for (const needle of probe.needles) {
      if (!content.includes(needle)) {
        err(`[V23] independent-evaluation drift in ${probe.file}: missing "${needle}"`)
      }
    }
  }

  const workspaceAgents = path.resolve(ROOT, '..', 'AGENTS.md')
  if (fs.existsSync(workspaceAgents)) {
    const content = read(workspaceAgents)
    for (const needle of ['workspace-namespace', '机械唱反调']) {
      if (!content.includes(needle)) {
        err(`[V23] workspace AGENTS drift: missing "${needle}" in ../AGENTS.md`)
      }
    }
  }

  console.log('[V23] independent evaluation semantics checked')
}

function checkV24() {
  const requiredFiles = [
    'data/templates/pending-issues.md',
    'data/README.md',
    'README.md',
    'RULES.md',
    activePath('profile', '01-项目信息.md'),
    activePath('profile', '02-架构约束.md'),
    'website/rspress.config.ts',
    'website/docs/index.md',
    'website/docs/intro/index.md',
    'skills/audit-report/SKILL.md',
    'skills/report/SKILL.md',
    'instructions.md',
    'instructions/12-audit.instructions.md',
    'instructions/15-memory.instructions.md',
    'skills/memory/SKILL.md',
    'scripts/validate-profile.js',
    'codex/hooks.json',
    'index.js',
    'package.json',
    'plugin.json'
  ]

  const missingFiles = requiredFiles.filter(file => !fs.existsSync(path.isAbsolute(file) ? file : path.join(ROOT, file)))
  if (missingFiles.length) {
    err(`[V24] missing governance/client/template files: ${missingFiles.map(file => path.isAbsolute(file) ? path.relative(ROOT, file) : file).join(', ')}`)
    return
  }

  const musts = [
    { file: 'instructions.md', needle: '阻断/非阻断分流' },
    { file: 'instructions.md', needle: 'data/pending-issues.md' },
    { file: 'instructions/12-audit.instructions.md', needle: '阻断/非阻断分流' },
    { file: 'instructions/12-audit.instructions.md', needle: 'data/pending-issues.md' },
    { file: 'data/README.md', needle: 'pending-issues.md' },
    { file: 'data/templates/pending-issues.md', needle: 'ISSUE-000' },
    { file: 'README.md', needle: 'Copilot / Claude Code 双主支持' },
    { file: 'README.md', needle: 'init --claude' },
    { file: 'README.md', needle: 'init --codex' },
    { file: 'README.md', needle: 'AGENTS.md' },
    { file: 'README.md', needle: 'OpenAI Codex app/CLI' },
    { file: 'README.md', needle: 'pending-issues / process-improvements' },
    { file: 'RULES.md', needle: 'Copilot / Claude Code' },
    { file: 'RULES.md', needle: 'init --claude' },
    { file: 'RULES.md', needle: 'init --codex' },
    { file: 'RULES.md', needle: 'AGENTS.md' },
    { file: activePath('profile', '01-项目信息.md'), needle: 'CLAUDE.md', rawPath: false },
    { file: activePath('profile', '01-项目信息.md'), needle: 'AGENTS.md', rawPath: false },
    { file: activePath('profile', '01-项目信息.md'), needle: 'pending-issues.md', rawPath: false },
    { file: activePath('profile', '01-项目信息.md'), needle: '当前阶段', rawPath: false },
    { file: activePath('profile', '02-架构约束.md'), needle: '.codex/hooks.json', rawPath: false },
    { file: activePath('profile', '02-架构约束.md'), needle: 'pending-issues', rawPath: false },
    { file: activePath('profile', '02-架构约束.md'), needle: 'process-improvements', rawPath: false },
    { file: 'website/rspress.config.ts', needle: 'Copilot / Claude Code' },
    { file: 'website/docs/index.md', needle: 'Copilot / Claude Code' },
    { file: 'website/docs/index.md', needle: 'Codex' },
    { file: 'website/docs/index.md', needle: 'Hook 能力按宿主/事件降级' },
    { file: 'website/docs/intro/index.md', needle: 'Copilot / Claude Code' },
    { file: 'website/docs/intro/index.md', needle: 'Codex' },
    { file: 'website/docs/intro/index.md', needle: 'Hook 能力按宿主/事件降级' },
    { file: 'package.json', needle: 'Claude Code' },
    { file: 'package.json', needle: 'Codex' },
    { file: 'plugin.json', needle: 'Claude Code' },
    { file: 'skills/audit-report/SKILL.md', needle: '两层结构' },
    { file: 'skills/report/SKILL.md', needle: '两层问题清单' },
    { file: 'instructions.md', needle: 'jetbrains-copilot' },
    { file: 'instructions/15-memory.instructions.md', needle: 'jetbrains-copilot' },
    { file: 'skills/memory/SKILL.md', needle: 'jetbrains-copilot' },
    { file: 'scripts/validate-profile.js', needle: 'jetbrains-copilot' },
    { file: 'index.js', needle: 'jetbrains-copilot' }
  ]

  for (const probe of musts) {
    const content = probe.rawPath === false ? read(probe.file) : read(path.join(ROOT, probe.file))
    if (!content.includes(probe.needle)) {
      err(`[V24] governance/client drift in ${probe.rawPath === false ? path.relative(ROOT, probe.file) : probe.file}: missing "${probe.needle}"`)
    }
  }

  const mustNots = [
    { file: 'README.md', needle: '不使用 GitHub Copilot 的 IDE/Agent' },
    { file: 'instructions/15-memory.instructions.md', needle: 'zed-copilot' },
    { file: 'skills/memory/SKILL.md', needle: 'zed-copilot' }
  ]

  for (const probe of mustNots) {
    const content = read(path.join(ROOT, probe.file))
    if (content.includes(probe.needle)) {
      err(`[V24] governance/client drift in ${probe.file}: contains legacy text "${probe.needle}"`)
    }
  }

  console.log('[V24] governance/template/client narrative semantics checked')
}

function checkV25() {
  const probes = [
    ['instructions.md', 'Intent Expansion Card', 'instructions single-source intent card'],
    ['instructions.md', 'ConfirmationRequest', 'instructions single-source confirmation abstraction'],
    ['instructions.md', 'ECR 执行闭环复审', 'instructions single-source ECR'],
    ['instructions.md', '推荐结论', 'instructions single-source recommendation'],
    ['instructions/01-common.instructions.md', 'Intent Expansion Card', '01-common intent card'],
    ['instructions/10-dev.instructions.md', 'ECR-1', '10-dev ECR checklist'],
    ['instructions/11-fix.instructions.md', 'ECR-1', '11-fix ECR checklist'],
    ['instructions/13-analyze.instructions.md', '推荐结论', '13-analyze recommendation conclusion'],
    ['instructions/17-compliance.instructions.md', '推荐：无后续动作', '17-compliance recommendation fallback'],
    ['skills/dev-default/SKILL.md', 'ECR-1', 'dev-default ECR checklist'],
    ['skills/fix-default/SKILL.md', 'ECR 执行闭环复审', 'fix-default ECR'],
    ['skills/report/SKILL.md', '推荐结论', 'report recommendation conclusion'],
    ['skills/compliance/SKILL.md', '推荐：无后续动作', 'compliance recommendation fallback'],
    ['skills/intent/SKILL.md', 'Intent Expansion Card', 'intent card'],
    ['skills/load-profile/SKILL.md', 'host-capability', 'load-profile host capability field'],
    ['skills/cp-gate/SKILL.md', 'ConfirmationRequest', 'cp-gate confirmation abstraction'],
    ['prompts/precheck-status.prompt.md', 'Intent Expansion Card', 'precheck prompt intent card'],
    ['prompts/report-analysis.prompt.md', '推荐结论', 'analysis report recommendation'],
    ['prompts/report-audit.prompt.md', '推荐结论', 'audit report recommendation'],
    ['prompts/report-dev.prompt.md', 'ECR 执行闭环复审', 'dev report ECR'],
    ['prompts/report-fix.prompt.md', 'ECR 执行闭环复审', 'fix report ECR'],
    ['prompts/report-optimization.prompt.md', 'ECR 执行闭环复审', 'optimization report ECR'],
    ['prompts/report-scenario-test.prompt.md', 'ECR 执行闭环复审', 'scenario report ECR'],
    ['README.md', 'ECR 执行闭环复审', 'README ECR'],
    ['README.md', '推荐结论', 'README recommendation'],
    ['README.md', 'ConfirmationRequest', 'README confirmation abstraction'],
    ['website/docs/guide/development.md', 'ECR 执行闭环复审', 'website development ECR'],
    ['website/docs/specs/exec-compliance-flow.md', '推荐结论', 'website compliance recommendation'],
    ['website/docs/specs/precheck-flow.md', 'Intent Expansion Card', 'website precheck intent card'],
    ['website/docs/specs/report-output-flow.md', '推荐结论', 'website report recommendation']
  ]
  for (const [file, needle, label] of probes) mustInclude(file, needle, label)
  const pkg = JSON.parse(read(path.join(ROOT, 'package.json')))
  const releaseChangelog = `changelogs/v${pkg.version}.md`
  const releaseNeedleFound = (
    fs.existsSync(path.join(ROOT, releaseChangelog)) &&
    read(path.join(ROOT, releaseChangelog)).includes('Intent Expansion Card')
  ) || read(path.join(ROOT, 'changelogs/unreleased.md')).includes('Intent Expansion Card')
  if (!releaseNeedleFound) {
    err(`[V25] ECR change missing required text in changelogs/unreleased.md or ${releaseChangelog}: Intent Expansion Card`)
  }
  console.log('[V25] ECR / intent card / confirmation / recommendation semantics checked')
}

function checkV26() {
  const probes = [
    {
      file: 'skills/spec-governance/SKILL.md',
      needles: [
        'RecordRouter',
        'SCV-0',
        'SCV-7',
        'record.violation',
        'record.ambiguous',
        'AI 与确定性边界',
        '你刚才漏了/错了/违反流程了',
        'VL/PF 关闭前必须具备修复方案',
        '当前 DevCodex 源仓或规范维护项目的 active-root'
      ]
    },
    {
      file: 'instructions.md',
      needles: [
        '规范治理生命周期（RecordRouter + SCV）',
        'record.spec-defect',
        'SCV（Spec Change Verification）',
        '你刚才漏了/错了/违反流程了',
        'VL/PF 关闭前必须具备修复方案'
      ]
    },
    {
      file: 'instructions/18-spec-radar.instructions.md',
      needles: ['Intent Detection → RecordRouter', 'record.audit-gap', 'skills/spec-governance/SKILL.md']
    },
    {
      file: 'website/docs/specs/precheck-flow.md',
      needles: ['Intent Detection → RecordRouter', 'PF/VL/GAP → RecordRouter']
    },
    {
      file: 'website/docs/specs/spec-radar-flow.md',
      needles: ['RecordRouter 分流口径', 'PF/VL/GAP → RecordRouter']
    },
    {
      file: 'instructions/14-self-fix.instructions.md',
      needles: ['T_RECORD / RecordRouter', 'record.process-improvement', 'record.ambiguous']
    },
    {
      file: 'skills/intent/SKILL.md',
      needles: ['record.violation', 'record.none', 'RecordRouter']
    },
    {
      file: 'skills/report/SKILL.md',
      needles: ['规范化意图', 'SCV-0~SCV-7']
    }
  ]

  for (const probe of probes) {
    const content = read(path.join(ROOT, probe.file))
    for (const needle of probe.needles) {
      if (!content.includes(needle)) {
        err(`[V26] spec governance drift in ${probe.file}: missing "${needle}"`)
      }
    }
  }

  const templateProbes = [
    ['data/templates/violations.md', 'record.violation'],
    ['data/templates/violations.md', '验证证据'],
    ['data/templates/violations.md', '关闭时间'],
    ['data/templates/pending-fixes.md', 'record.spec-defect'],
    ['data/templates/pending-fixes.md', 'SCV要求'],
    ['data/templates/pending-fixes.md', '验证证据'],
    ['data/templates/process-improvements.md', 'record.process-improvement'],
    ['data/templates/pending-issues.md', 'record.pending-issue'],
    ['data/templates/gap-registry.md', 'record.audit-gap']
  ]
  for (const [file, needle] of templateProbes) mustInclude(file, needle, `template ${needle}`)

  const activeRuleFiles = [
    'README.md',
    'instructions.md',
    'instructions/00-safety.instructions.md',
    'instructions/12-audit.instructions.md',
    'instructions/18-spec-radar.instructions.md',
    'skills/cp-gate/SKILL.md',
    'skills/spec-governance/SKILL.md',
    'data/templates/violations.md',
    'data/templates/pending-fixes.md',
    'data/templates/process-improvements.md',
    'data/templates/pending-issues.md',
    'data/templates/gap-registry.md'
  ]
  for (const file of activeRuleFiles) {
    const content = read(path.join(ROOT, file))
    if (content.includes('.devcodex/.maintainer-state')) {
      err(`[V26] current governance rule file must use active-root, not .devcodex/.maintainer-state: ${file}`)
    }
  }

  const genericDistributedFiles = [
    'instructions.md',
    'instructions/00-safety.instructions.md',
    'instructions/12-audit.instructions.md',
    'skills/spec-governance/SKILL.md',
    'data/README.md',
    'data/templates/violations.md',
    'data/templates/pending-fixes.md',
    'data/templates/process-improvements.md',
    'data/templates/pending-issues.md',
    'data/templates/gap-registry.md'
  ]
  for (const file of genericDistributedFiles) {
    const content = read(path.join(ROOT, file))
    const sourceProjectName = ['devcodex', 'v1'].join('-')
    if (content.includes(sourceProjectName)) {
      err(`[V26] generic distributed governance asset must not hard-code source project name: ${file}`)
    }
  }

  try {
    execSync('node scripts/test-spec-governance.js', { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
  } catch (e) {
    const detail = String((e.stderr || e.stdout || e.message || '')).trim().split('\n').slice(0, 8).join(' | ')
    err(`[V26] test-spec-governance failed${detail ? `: ${detail}` : ''}`)
  }
  console.log('[V26] spec governance semantics checked')
}

function checkV27() {
  const workspaceRoot = path.dirname(ROOT)
  const rootArtifactPatterns = [
    /^AGENTS\.md\.bak\./i,
    /^mail.*\.json$/i,
    /^update-mail-temp-content/i,
    /^webstorm-update-mail/i,
    /^hs_err_pid.*\.log$/i,
    /^replay_pid.*\.log$/i
  ]
  const misplacedRootArtifacts = fs.readdirSync(workspaceRoot, { withFileTypes: true })
    .filter(entry => entry.isFile() && rootArtifactPatterns.some(re => re.test(entry.name)))
    .map(entry => entry.name)
  if (misplacedRootArtifacts.length) {
    err(`[V27] workspace root contains transient artifacts that must live under .devcodex/workspace/.tmp: ${misplacedRootArtifacts.join(', ')}`)
  }

  const layout = readJsonIfExists(path.join(workspaceRoot, '.devcodex', 'layout.json'))
  if (layout && String(layout.mode || '').trim() === 'workspace-namespace') {
    const projectTmpLeaks = fs.readdirSync(workspaceRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name !== '.devcodex')
      .flatMap(entry => {
        const tmpDir = path.join(workspaceRoot, entry.name, '.devcodex', '.tmp')
        if (!fs.existsSync(tmpDir)) return []
        const files = walk(tmpDir).filter(file => fs.existsSync(file) && fs.statSync(file).isFile())
        return files.map(file => path.relative(workspaceRoot, file).replace(/\\/g, '/'))
      })
    if (projectTmpLeaks.length) {
      err(`[V27] project-local .devcodex/.tmp leaks found under workspace-namespace: ${projectTmpLeaks.slice(0, 8).join(', ')}`)
    }
  }

  const indexSrc = read(path.join(ROOT, 'index.js'))
  for (const needle of ['resolveActiveRuntimeRoot', 'ensureRuntimeDirs', 'resolveGitignoreRoot', 'backupDir', '.devcodex/*/.tmp/']) {
    if (!indexSrc.includes(needle)) {
      err(`[V27] index.js active-root resolver missing "${needle}"`)
    }
  }

  const lifecycleSrc = read(path.join(ROOT, 'hooks', '_runtime', 'lifecycle.cjs'))
  for (const needle of ['ACTIVE_RUNTIME_ROOT', 'isDevCodexManagedPath', 'DEVCODEX_DEPLOYMENT_PATH_RE']) {
    if (!lifecycleSrc.includes(needle)) {
      err(`[V27] lifecycle runtime active-root guard missing "${needle}"`)
    }
  }
  if (/const\s+DEVCODEX_PATH_RE\s*=\s*\/\\\.devcodex\[\/\\{2}\]\|/.test(lifecycleSrc)) {
    err('[V27] lifecycle runtime still globally whitelists every .devcodex path')
  }

  console.log('[V27] active-root and transient artifact boundary checked')
}

function checkV28() {
  const supportSkills = ['execution-contract', 'test-router', 'release-verification', 'host-contract-verification', 'source-consumer-sync']
  const plugin = JSON.parse(read(path.join(ROOT, 'plugin.json')))
  const skillFiles = walk(path.join(ROOT, 'skills')).filter(file => path.basename(file) === 'SKILL.md')
  const pluginSkillIds = new Set((plugin.skills || []).map(skill => skill.id))

  if ((plugin.skills || []).length !== skillFiles.length) {
    err(`[V28] plugin skill count (${(plugin.skills || []).length}) does not match SKILL.md count (${skillFiles.length})`)
  }

  for (const id of supportSkills) {
    const skill = (plugin.skills || []).find(item => item.id === id)
    const expectedFile = `skills/${id}/SKILL.md`
    if (!skill) {
      err(`[V28] plugin.json missing support skill: ${id}`)
      continue
    }
    if (skill.file !== expectedFile) {
      err(`[V28] plugin.json support skill ${id} has wrong file: ${skill.file}`)
    }
    const filePath = path.join(ROOT, expectedFile)
    if (!fs.existsSync(filePath)) {
      err(`[V28] support skill file missing: ${expectedFile}`)
      continue
    }
    const content = read(filePath)
    if (!content.includes(`name: ${id}`)) {
      err(`[V28] support skill frontmatter mismatch in ${expectedFile}`)
    }
    if (!pluginSkillIds.has(id)) {
      err(`[V28] support skill not registered in plugin ids: ${id}`)
    }
  }

  const probes = [
    {
      file: 'instructions/01-common.instructions.md',
      needles: ['execution-contract', 'test-router', 'release-verification', 'host-contract-verification', 'source-consumer-sync', '不是工作流子类型']
    },
    {
      file: 'instructions/10-dev.instructions.md',
      needles: ['execution-contract/test-router', 'release-verification', '05-实施进度.md', '多批次']
    },
    {
      file: 'instructions/11-fix.instructions.md',
      needles: ['execution-contract/test-router', '05-实施进度.md', '多批次修复']
    },
    {
      file: 'instructions/02-output-paths.instructions.md',
      needles: ['05-实施进度 触发条件', '多批次', '预计修改 ≥10 文件', 'R0~R7']
    },
    {
      file: 'instructions/17-compliance.instructions.md',
      needles: ['ExecutionContract/TestRoute/ReleaseVerification', '实施进度（触发时）']
    },
    {
      file: 'skills/report/SKILL.md',
      needles: ['dev/fix 支撑产物字段', 'ExecutionContract', 'TestRoute', 'ReleaseVerification', '05-实施进度.md']
    },
    {
      file: 'skills/dev-testing/SKILL.md',
      needles: ['与 test-router 的关系', 'TestRoute 包含对外 HTTP API']
    },
    {
      file: 'skills/api-verification/SKILL.md',
      needles: ['与 test-router 的关系', '.http + .cjs']
    },
    {
      file: 'skills/dev-scenario-test/SKILL.md',
      needles: ['TestRoute 中的场景/负载/E2E 路线', 'TestRoute 已确认']
    },
    {
      file: 'prompts/report-dev.prompt.md',
      needles: ['支撑产物状态', 'TestRoute 覆盖', 'ExecutionContract：✅ 完成 / N/A']
    },
    {
      file: 'prompts/report-fix.prompt.md',
      needles: ['支撑产物状态', 'TestRoute 覆盖', 'ExecutionContract：✅ 完成 / N/A']
    },
    {
      file: 'prompts/report-optimization.prompt.md',
      needles: ['支撑产物状态', 'TestRoute 覆盖', 'ConceptSyncMap', 'HostContractVerification', '05-实施进度.md']
    },
    {
      file: 'prompts/report-scenario-test.prompt.md',
      needles: ['支撑产物状态', 'TestRoute 覆盖', 'ConceptSyncMap', 'HostContractVerification', '05-实施进度.md']
    },
    {
      file: 'instructions/10-dev.instructions.md',
      needles: ['host-contract-verification', 'source-consumer-sync', '支撑型 Skill']
    },
    {
      file: 'prompts/technical-design.prompt.md',
      needles: ['§7.0 TestRoute', 'ExecutionContract', 'ReleaseVerification R0~R7']
    },
    {
      file: 'prompts/implementation-plan.prompt.md',
      needles: ['§4.1 执行契约与支持技能', 'ExecutionContract', 'TestRoute', 'ConceptSyncMap 已建立并核对当前消费者/探针/部署副本', 'HostContractVerification 已建立并核对宿主证据/guard/visible reply', '05-实施进度.md']
    },
    {
      file: 'prompts/implementation-progress.prompt.md',
      needles: ['多批次执行', '预计修改 ≥10 文件', '支撑产物状态', 'ExecutionContract', 'ConceptSyncMap', 'HostContractVerification']
    },
    {
      file: 'prompts/delivery-checklist.prompt.md',
      needles: ['预计修改 ≥10 文件', 'ExecutionContract', 'TestRoute', 'ReleaseVerification', 'ConceptSyncMap', 'HostContractVerification']
    },
    {
      file: 'README.md',
      needles: ['支撑型 Skill', 'host-contract-verification', 'source-consumer-sync']
    },
    {
      file: 'website/docs/index.md',
      needles: ['宿主契约验证', '真相源-消费者同步']
    },
    {
      file: 'website/docs/intro/index.md',
      needles: ['host-contract-verification', 'source-consumer-sync']
    },
    {
      file: 'website/docs/specs/directory-structure.md',
      needles: ['host-contract-verification', 'source-consumer-sync']
    },
    {
      file: 'website/docs/guide/development.md',
      needles: ['支撑型 Skill', '05-实施进度.md']
    },
    {
      file: 'website/docs/guide/release.md',
      needles: ['ReleaseVerification R0~R7', 'release-verification']
    },
    {
      file: 'website/docs/guide/requirements.md',
      needles: ['预计修改 ≥10 文件', '05-实施进度.md']
    },
    {
      file: 'agents/devcodex-auto.agent.md',
      needles: ['ExecutionContract', 'allowedPaths']
    },
    {
      file: 'agents/README.md',
      needles: ['ExecutionContract', 'ReleaseVerification']
    },
    {
      file: 'changelogs/unreleased.md',
      needles: ['execution-contract', 'test-router', 'release-verification', 'host-contract-verification', 'source-consumer-sync']
    }
  ]

  for (const probe of probes) {
    const content = read(path.join(ROOT, probe.file))
    for (const needle of probe.needles) {
      if (!content.includes(needle)) {
        err(`[V28] support skill/progress drift in ${probe.file}: missing "${needle}"`)
      }
    }
  }

  const activeProfileProbes = [
    { file: activePath('profile', '01-项目信息.md'), needles: ['host-contract-verification', 'source-consumer-sync'] },
    { file: activePath('profile', '02-架构约束.md'), needles: ['支撑型（5）', 'host-contract-verification'] }
  ]
  for (const probe of activeProfileProbes) {
    if (!fs.existsSync(probe.file)) {
      warn(`[V28] active profile missing, skip support skill profile probe: ${path.relative(ROOT, probe.file)}`)
      continue
    }
    const content = read(probe.file)
    for (const needle of probe.needles) {
      if (!content.includes(needle)) {
        err(`[V28] active profile support skill drift in ${path.relative(ROOT, probe.file)}: missing "${needle}"`)
      }
    }
  }

  const legacyProgressNeedles = [
    ['prompts/implementation-progress.prompt.md', '仅在任务跨多轮/多阶段、存在明确阻塞或用户要求持续跟踪'],
    ['skills/dev-optimization/SKILL.md', '仅在跨多轮、存在明确阻塞或用户要求持续跟踪时启用'],
    ['changelogs/unreleased.md', '当前无未发布条目。'],
    ['skills/document-sync/SKILL.md', '支撑型 Skill（`execution-contract` / `test-router` / `release-verification`）的注册、触发说明、报告模板、validate 探针和用户文档是否一致']
  ]
  for (const [file, needle] of legacyProgressNeedles) {
    const content = read(path.join(ROOT, file))
    if (content.includes(needle)) {
      err(`[V28] legacy progress/release wording remains in ${file}: "${needle}"`)
    }
  }

  console.log('[V28] support skills / progress / release verification sync checked')
}

function checkV35() {
  const probes = [
    {
      file: 'skills/spec-governance/SKILL.md',
      needles: ['Concept Sync Map', 'currentConsumers', 'historicalMirrors', 'validateProbes', 'deployCopies', 'yellowDeviationBoundary', 'source-consumer-sync']
    },
    {
      file: 'skills/source-consumer-sync/SKILL.md',
      needles: ['ConceptSyncMap', 'sourceOfTruth', 'currentConsumers', 'historicalMirrors', 'validateProbes', 'deployCopies', 'yellowDeviationBoundary']
    },
    {
      file: 'skills/execution-contract/SKILL.md',
      needles: ['consumerScope', 'verificationEvidence', 'deviationLog', 'currentConsumers', 'historicalMirrors']
    },
    {
      file: 'skills/document-sync/SKILL.md',
      needles: ['Concept Sync Map', '当前消费者', '历史镜像', 'source-consumer-sync']
    },
    {
      file: 'skills/report/SKILL.md',
      needles: ['ConceptSyncMap', '黄色偏离', '部署同步证据']
    },
    {
      file: 'prompts/technical-design.prompt.md',
      needles: ['Concept Sync Map', 'sourceOfTruth', 'yellowDeviationBoundary']
    },
    {
      file: 'prompts/implementation-plan.prompt.md',
      needles: ['ConceptSyncMap', 'currentConsumers', 'historicalMirrors', 'deployCopies']
    },
    {
      file: 'prompts/report-dev.prompt.md',
      needles: ['ConceptSyncMap', '黄色偏离', '部署同步证据']
    },
    {
      file: 'prompts/report-audit.prompt.md',
      needles: ['Concept Sync Map', '黄色偏离', '部署同步证据']
    },
    {
      file: 'prompts/report-optimization.prompt.md',
      needles: ['ConceptSyncMap', 'currentConsumers', 'yellowDeviationBoundary', '部署同步证据']
    },
    {
      file: 'prompts/report-scenario-test.prompt.md',
      needles: ['ConceptSyncMap', 'currentConsumers', 'yellowDeviationBoundary', '部署同步证据']
    },
    {
      file: 'prompts/implementation-progress.prompt.md',
      needles: ['ConceptSyncMap', 'currentConsumers', 'yellowDeviationBoundary']
    }
  ]

  for (const probe of probes) {
    const content = read(path.join(ROOT, probe.file))
    for (const needle of probe.needles) {
      if (!content.includes(needle)) {
        err(`[V35] concept sync map drift in ${probe.file}: missing "${needle}"`)
      }
    }
  }

  console.log('[V35] concept sync map sync checked')
}

function checkV36() {
  const probes = [
    {
      file: 'skills/host-contract-verification/SKILL.md',
      needles: ['HostContractRoute', 'hostSurface', 'eventScope', 'visibleReplyEvidence', 'workspaceGuard', 'direct replay', 'fixture replay']
    },
    {
      file: 'skills/test-router/SKILL.md',
      needles: ['hostVerificationMode', 'workspaceGuard', 'evidenceSource', 'host-contract-verification']
    },
    {
      file: 'skills/report/SKILL.md',
      needles: ['HostContractVerification', 'hostSurface', 'workspaceGuard']
    },
    {
      file: 'prompts/technical-design.prompt.md',
      needles: ['hostVerificationMode', 'Concept Sync Map', 'HostContractRoute']
    },
    {
      file: 'prompts/implementation-plan.prompt.md',
      needles: ['HostContractVerification', 'hostSurface', 'workspaceGuard', 'bootstrapScope']
    },
    {
      file: 'prompts/report-dev.prompt.md',
      needles: ['HostContractVerification', 'HostContract 验证', 'host-contract probe']
    },
    {
      file: 'prompts/report-fix.prompt.md',
      needles: ['HostContractVerification', 'HostContract 验证', 'host-contract probe']
    },
    {
      file: 'prompts/report-optimization.prompt.md',
      needles: ['HostContractVerification', 'HostContract 验证', 'workspaceGuard', 'visibleReplyEvidence']
    },
    {
      file: 'prompts/report-scenario-test.prompt.md',
      needles: ['HostContractVerification', 'HostContract 验证', 'workspaceGuard', 'visibleReplyEvidence']
    },
    {
      file: 'prompts/implementation-progress.prompt.md',
      needles: ['HostContractVerification', 'workspaceGuard', 'bootstrapScope']
    },
    {
      file: 'README.md',
      needles: ['host-contract-verification', 'source-consumer-sync']
    },
    {
      file: 'website/docs/guide/development.md',
      needles: ['host-contract-verification', 'source-consumer-sync']
    }
  ]

  for (const probe of probes) {
    const content = read(path.join(ROOT, probe.file))
    for (const needle of probe.needles) {
      if (!content.includes(needle)) {
        err(`[V36] host contract verification drift in ${probe.file}: missing "${needle}"`)
      }
    }
  }

  console.log('[V36] host contract verification sync checked')
}

function checkV37() {
  const probes = [
    {
      file: 'hooks/_runtime/workspace-layout.cjs',
      needles: ['namespaceHasRuntimeState', 'collectWorkspaceProjectNamespaces', 'UTILITY_ROOT_DIR_NAMES', 'CONTAINER_DIR_NAMES']
    },
    {
      file: 'hooks/_runtime/lifecycle.cjs',
      needles: ['collectWorkspaceProjectNamespaces', '!currentSessionKey || !stickySessionKey']
    },
    {
      file: 'index.js',
      needles: ['writeManagedJsonFile', 'mergeClaudeHooks', 'mergeClaudeMcpConfig', 'detectHostPlatform', 'installed hosts:']
    },
    {
      file: 'scripts/test-cli-behavior.js',
      needles: ['testClaudeUpdateBacksUpAndPreservesCustomConfig', 'testDoctorAvoidsCodexBiasInMixedHostRepo', 'testProfileInitUsesNestedNamespaceRoot']
    },
    {
      file: 'scripts/test-hooks-runtime.js',
      needles: ['noSessionFollowup', 'nestedWorkspaceAmbiguity', 'toolingSiblingPrompt']
    },
    {
      file: 'scripts/test-migrate-layout.js',
      needles: ['nestedManifest', 'packages/app-a', 'tools']
    }
  ]

  for (const probe of probes) {
    const content = read(path.join(ROOT, probe.file))
    for (const needle of probe.needles) {
      if (!content.includes(needle)) {
        err(`[V37] namespace safety / CLI protection drift in ${probe.file}: missing "${needle}"`)
      }
    }
  }

  const pkg = JSON.parse(read(path.join(ROOT, 'package.json')))
  const scripts = pkg.scripts || {}
  if (!scripts['test:audit']) {
    err('[V37] package.json missing deterministic follow-up audit script: test:audit')
  }
  if ((scripts['test:all'] || '').includes('npm audit')) {
    err('[V37] package.json test:all must stay deterministic and must not invoke npm audit directly')
  }
  if (!(scripts['test:all:with-audit'] || '').includes('npm run test:audit')) {
    err('[V37] package.json test:all:with-audit must chain npm run test:audit')
  }

  console.log('[V37] namespace safety / CLI protection / deterministic test chain checked')
}

function checkV38() {
  const plugin = JSON.parse(read(path.join(ROOT, 'plugin.json')))
  const requiredSkills = [
    ['readme-authoring', 'skills/readme-authoring/SKILL.md'],
    ['audit-readme', 'skills/audit-readme/SKILL.md']
  ]

  for (const [id, file] of requiredSkills) {
    const entry = (plugin.skills || []).find(skill => skill.id === id)
    if (!entry) {
      err(`[V38] plugin.json missing README governance skill: ${id}`)
      continue
    }
    if (entry.file !== file) {
      err(`[V38] plugin.json ${id} has wrong file: ${entry.file}`)
    }
    const filePath = path.join(ROOT, file)
    if (!fs.existsSync(filePath)) {
      err(`[V38] README governance skill file missing: ${file}`)
      continue
    }
    const content = read(filePath)
    if (!content.includes(`name: ${id}`)) {
      err(`[V38] README governance skill frontmatter mismatch in ${file}`)
    }
  }

  const probes = [
    {
      file: 'skills/readme-authoring/SKILL.md',
      needles: ['primaryAudience', 'userJourney', 'consumerMap', '用户 / 使用者']
    },
    {
      file: 'skills/audit-readme/SKILL.md',
      needles: ['RM-1 用户路径完整性', 'RM-6 消费链一致性', '快速开始可执行性']
    },
    {
      file: 'skills/dev-docs/SKILL.md',
      needles: ['readme-authoring', 'audit-readme', 'README 专项写作分支']
    },
    {
      file: 'skills/dev-init/SKILL.md',
      needles: ['readme-authoring', 'audit-readme']
    },
    {
      file: 'skills/document-sync/SKILL.md',
      needles: ['readme-authoring', 'audit-readme', '目标用户 / 使用者是否明确']
    },
    {
      file: 'skills/audit-document/SKILL.md',
      needles: ['audit-readme', 'README 叠加规则']
    },
    {
      file: 'skills/audit-execution-guide/SKILL.md',
      needles: ['audit-readme', 'README / 用户使用文档']
    },
    {
      file: 'prompts/project-readme.prompt.md',
      needles: ['用户 / 使用者优先', '## 适用对象与使用场景', '## 常见用法', '## 常见问题与排错', '## 开发与贡献']
    },
    {
      file: 'README.md',
      needles: ['readme-authoring', 'audit-readme', 'README 专项能力']
    },
    {
      file: 'website/docs/intro/index.md',
      needles: ['readme-authoring', 'audit-readme']
    },
    {
      file: 'website/docs/specs/directory-structure.md',
      needles: ['readme-authoring', 'audit-readme']
    },
    {
      file: 'website/docs/guide/development.md',
      needles: ['readme-authoring', 'audit-readme']
    },
    {
      file: 'package.json',
      needles: ['test:readme-governance', 'node scripts/test-readme-governance.js']
    }
  ]

  for (const probe of probes) {
    const content = read(path.join(ROOT, probe.file))
    for (const needle of probe.needles) {
      if (!content.includes(needle)) {
        err(`[V38] README governance drift in ${probe.file}: missing "${needle}"`)
      }
    }
  }

  console.log('[V38] README authoring/review governance sync checked')
}

function checkV29() {
  const probes = [
    {
      file: 'hooks/_runtime/lifecycle.cjs',
      needles: ['getVisibleReplyEvidence', 'precheckStatus', 'stickyProject', 'collectProjectPayloadStrings', '.devcodex/workspace/profile/']
    },
    {
      file: 'scripts/test-hooks-runtime.js',
      needles: ['stickyFollowup', 'roleUserPayloadAmbiguity', 'prefixProjectPayload', 'promptUserWordAmbiguity', 'stickyPromptUserWordFollowup', 'stickyRoleUserPayloadFollowup', 'stickyFuzzyPayloadFollowup', 'contentPartsStop', 'variantTranscriptStop', 'unverifiedStop']
    },
    {
      file: 'instructions.md',
      needles: ['意图扩展摘要', 'verified-present', 'unverified', '.devcodex/workspace/profile/']
    },
    {
      file: 'instructions/01-common.instructions.md',
      needles: ['用户可见意图扩展摘要', 'Stop 可见回复证据三态', 'sticky `activeProject`', '.devcodex/workspace/profile/']
    },
    {
      file: 'instructions/10-dev.instructions.md',
      needles: ['意图扩展摘要', '控制面或宿主能力差异']
    },
    {
      file: 'instructions/11-fix.instructions.md',
      needles: ['意图扩展摘要', '控制面或宿主能力差异']
    },
    {
      file: 'prompts/precheck-status.prompt.md',
      needles: ['意图扩展摘要', '备选路径']
    },
    {
      file: 'prompts/technical-design.prompt.md',
      needles: ['意图扩展摘要', '项目现实扩展后路由']
    },
    {
      file: 'prompts/report-dev.prompt.md',
      needles: ['Hook closure 三态证据', 'verified-present / verified-missing / unverified']
    },
    {
      file: 'prompts/report-fix.prompt.md',
      needles: ['Hook closure 三态证据', 'verified-present / verified-missing / unverified']
    },
    {
      file: 'skills/profile-bootstrap/SKILL.md',
      needles: ['.devcodex/workspace/profile/', 'workspace-namespace']
    },
    {
      file: 'README.md',
      needles: ['意图扩展摘要', 'Hook closure 三态', '.devcodex/workspace/profile/']
    },
    {
      file: 'website/docs/guide/development.md',
      needles: ['意图扩展摘要', 'Hook closure 三态', 'unverified']
    },
    {
      file: 'website/docs/specs/directory-structure.md',
      needles: ['.devcodex/workspace/profile/', 'Hook warning']
    },
    {
      file: 'changelogs/unreleased.md',
      needles: ['verified-present', 'sticky `activeProject`', '意图扩展摘要']
    }
  ]

  for (const probe of probes) {
    const content = read(path.join(ROOT, probe.file))
    for (const needle of probe.needles) {
      if (!content.includes(needle)) {
        err(`[V29] Hook visible reply / intent expansion drift in ${probe.file}: missing "${needle}"`)
      }
    }
  }

  console.log('[V29] Hook visible reply / sticky project / intent expansion sync checked')
}

function checkV30() {
  const file = 'skills/routing/SKILL.md'
  const content = read(path.join(ROOT, file))
  for (const needle of ['先读今日 tasks/YYYYMMDD.md', '再读 Agent SUMMARY.md']) {
    if (!content.includes(needle)) {
      err(`[V30] resume restore ordering drift in ${file}: missing "${needle}"`)
    }
  }
  if (content.includes('RESTORE → 先读 Agent SUMMARY.md')) {
    err(`[V30] legacy resume restore ordering remains in ${file}`)
  }
  console.log('[V30] resume restore ordering sync checked')
}

function checkV31() {
  const probes = [
    'instructions/17-compliance.instructions.md',
    'prompts/precheck-status.prompt.md',
    'skills/audit-common/SKILL.md',
    'website/docs/specs/precheck-flow.md',
    'website/docs/specs/flowcharts.md'
  ]
  const required = ['.github/', '.claude/', 'AGENTS.md', '.agents/', '.codex/']
  const forbidden = ['.claude/.github/', '父链 `.claude/.github/`', '无父链 .claude/.github/']

  for (const file of probes) {
    const content = read(path.join(ROOT, file))
    for (const needle of required) {
      if (!content.includes(needle)) {
        err(`[V31] PC5 deployment surface drift in ${file}: missing "${needle}"`)
      }
    }
    for (const needle of forbidden) {
      if (content.includes(needle)) {
        err(`[V31] legacy PC5 deployment wording remains in ${file}: "${needle}"`)
      }
    }
  }

  const complianceContent = read(path.join(ROOT, 'instructions/17-compliance.instructions.md'))
  if (!complianceContent.includes('### PC5 部署体状态（v1.11.0+，全模式基础项）')) {
    err('[V31] PC5 section heading in instructions/17-compliance.instructions.md must be v1.11.0+')
  }

  const auditCommonContent = read(path.join(ROOT, 'skills/audit-common/SKILL.md'))
  if (!auditCommonContent.includes('【v1.11.0+ 父链部署体扫描】')) {
    err('[V31] audit-common parent deployment heading must be v1.11.0+')
  }
  for (const needle of ['.claude/{instructions,skills,prompts,agents,hooks}/', '.github/{instructions,skills,prompts,agents,hooks}/']) {
    if (!auditCommonContent.includes(needle)) {
      err(`[V31] audit-common parent deployment scan missing "${needle}"`)
    }
  }

  console.log('[V31] PC5 deployment surface sync checked')
}

function checkV32() {
  const probes = [
    {
      file: 'instructions/12-audit.instructions.md',
      required: ['<audit-root>/.audit-state/<session-id>.json', '<audit-root>/.audit-state/*.json', '取值与 active-root 一致'],
      forbidden: ['`.devcodex/.audit-state/<session-id>.json`', '扫描 `.audit-state/*.json`']
    },
    {
      file: 'skills/audit-session/SKILL.md',
      required: ['<audit-root>/.audit-state/<session-id>.json', '<audit-root>/.audit-state/', '<audit-root>/.audit-state/*.json'],
      forbidden: ['在 .devcodex/.audit-state/<session-id>.json 持久化', '`.devcodex/.audit-state/` 目录由本 Skill 首次写入时创建', '扫描 `.devcodex/.audit-state/*.json`', '读取 `.devcodex/.audit-state/` 下所有 `.json`']
    }
  ]

  for (const probe of probes) {
    const content = read(path.join(ROOT, probe.file))
    for (const needle of probe.required) {
      if (!content.includes(needle)) {
        err(`[V32] audit-state active-root drift in ${probe.file}: missing "${needle}"`)
      }
    }
    for (const needle of probe.forbidden) {
      if (content.includes(needle)) {
        err(`[V32] legacy audit-state wording remains in ${probe.file}: "${needle}"`)
      }
    }
  }

  console.log('[V32] audit-state active-root sync checked')
}

function checkV33() {
  const probes = [
    'instructions/16-report.instructions.md',
    'skills/report/SKILL.md',
    'prompts/report-audit.prompt.md'
  ]

  for (const file of probes) {
    const content = read(path.join(ROOT, file))
    if (!content.includes('连续 3 轮零发现')) {
      err(`[V33] audit convergence wording drift in ${file}: missing "连续 3 轮零发现"`)
    }
    if (content.includes('R{N}+R{N+1}')) {
      err(`[V33] legacy audit convergence wording remains in ${file}`)
    }
  }

  console.log('[V33] audit convergence wording sync checked')
}

function checkV34() {
  const file = 'prompts/contributing.prompt.md'
  const content = read(path.join(ROOT, file))

  for (const needle of ['<install-command>', '<dev-command>', '<test-command>', '若项目提供行为准则文件']) {
    if (!content.includes(needle)) {
      err(`[V34] contributing template missing generalized placeholder text: ${needle}`)
    }
  }
  for (const needle of ['pnpm install', 'pnpm dev', 'pnpm test', 'pnpm test:unit', 'pnpm test:coverage', 'CODE_OF_CONDUCT.md']) {
    if (content.includes(needle)) {
      err(`[V34] contributing template still hardcodes project-specific text: ${needle}`)
    }
  }

  console.log('[V34] contributing template assumptions checked')
}

function checkV7b() {
  try {
    execSync('node scripts/test-instruction-fallback-check.js', { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    console.log('[V7b] instruction-fallback smoke test passed')
  } catch (e) {
    const detail = String((e.stderr || e.stdout || e.message || '')).trim().split('\n').slice(0, 8).join(' | ')
    err(`[V7b] instruction-fallback smoke test failed${detail ? `: ${detail}` : ''}`)
  }
}

checkV1()
checkV2()
checkV3()
checkV4()
checkV5()
checkV6()
checkV7()
checkV7b()
checkV8()
checkV9()
checkV10()
checkV11()
checkV12()
checkV13()
checkV14()
checkV15()
checkV16()
checkV17()
checkV18()
checkV19()
checkV20()
checkV21()
checkV22()
checkV23()
checkV24()
checkV25()
checkV26()
checkV27()
checkV28()
checkV29()
checkV30()
checkV31()
checkV32()
checkV33()
checkV34()
checkV35()
checkV36()
checkV37()
checkV38()

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
