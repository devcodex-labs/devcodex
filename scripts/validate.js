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
 * V8 父级/目标工作区部署同步检查 + 源码仓根宿主副本禁止检查
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
 * V39 Governance improvement intake sync（全模式主动优化清单、统一回执、PI/PF 联动与强制探针）
 * V40 Profile local config sync（config.local schema、用户指定 env 引用、受控扩展位与本地 overlay 消费链）
 * V41 Requirement runtime artifact structure sync（recent requirements 的 01/04/05 运行时结构探针）
 * V42 Release gate + package completeness sync（test:audit、metadata gate、prepublishOnly、pack forbidden 与 GitHub Packages 文档边界）
 * V43 Host docs / README audit route sync（宿主文档、README 排错、audit-readme 路由）
 * V44 Context rehydration / CP3 rollback sync（压缩恢复优先级、Intent Expansion 可见性、执行期 CP3 回退与 ConfirmationRequest 抽象）
 * V45 Single-source aggregate vs split instructions sync（instructions.md 与 instructions/ 关键概念双向联查）
 * V46 Tenant example coverage（tenants 示例目录与最小覆盖样例）
 * V47 Source template hygiene（.npmignore 失效项、assets/hooks 边界说明、codex/ 源模板边界）
 * V48 Split common instruction structure sync（01-common 锚点文件与 01a/01b/01c 拆分视图）
 * V49 Backlog truth review + ledger writeback sync（backlog 来源真相复核、状态回写闭环、规范源/模板/当前消费者与探针联查）
 * V50 Release audit governance sync（audit-release、RL-1~RL-10、发布审查/发布验证职责边界）
 * V51 Client artifact + MCP fallback sync（ArtifactLinkSet、跨客户端产物点击矩阵、Copilot/Codex MCP bridge fallback）
 * V52 Codex PreCompact adapter sync（Codex compaction runtime 兜底、adapter 模板、CLI/validate/direct replay 探针）
 * V53 Security exception / API variables / changelog releases / profile freshness sync（安全例外、接口变量、发布日志结构、Profile 新鲜度审查）
 * V54 Official docs evidence + Profile impact sync（官方文档证据前置与 Profile 联动判定）
 * V55 Service lifecycle cleanup sync（AI 自启动服务清理）
 * V56 Platform framing + validation hygiene sync（平台工程前置、包边界串行、依赖树优先、导航顺序同步）
 * V57 Audit review coverage delta sync（复审覆盖增量）
 * V58 Concurrency policy sync（并发策略）
 * V59 Project audit resource lifecycle leak-risk sync（项目工程资源生命周期与泄漏风险审查）
 * V60 Leak-risk stability pressure test sync（写测试/回归验证时的泄漏风险稳定性压测条件路线）
 * V61 Frontend experience / learned guards sync（前端 UI/交互体验门禁与跨项目已吸纳守门）
 * V62 Data absorption guard extensions sync（剩余 data 吸纳守门扩展）
 * V63 Latest data absorption guard sync（全工作区 data 扫描、遗漏专审、文档站体验、方法级泄漏压测与 v2 正式方案包）
 * V64 Review finding intake gate sync（审查发现 intake 分流门禁）
 * V65 High-fidelity UI / commit authorization / compatibility sync（高保真 UI、提交授权、兼容契约与公开文档版本边界）
 * V66 Review dimension / user docs / artifact dedupe / runtime network sync（复审维度、使用者文档、产物去重与运行态网络）
 * V67 Public user docs / active final response sync（公开用户文档维护边界与最终回复 active 范围）
 * V68 Latest data absorption guards sync（最新 data 吸纳守门：数据库记录迁移、浏览器验证预算、finding 矩阵、多阶段关闭、验证副作用等）
 * V69 User docs primary surface and verdict-state sync（用户文档主面与需求复审状态同步）
 * V70 User-facing delivery chain / evidence execution sync（用户文档驱动交付链、复审证据化、构建产物与生成站点验证）
 * V71 Skill-first absorption / user manual and review checklist skills sync（Skill-first 吸纳架构、最终用户文档与复审清单 Skill）
 * V72 Layered absorption / proactive better alternative sync（分层吸纳架构与主动更优建议门禁）
 * V73 confirmed absorption completeness / evolution governance sync（完整吸纳补强与自我进化治理 Skill）
 * V74 historical common norm layering sync（历史通用规范分层迁移、逐文件矩阵与消费者闭环）
 * V75 prompt long gate list drift sync（Prompt/README/website 长清单回流探针与 SCV 负向样例）
 * V76 review escape record sync（复审遗漏 escape record、防复发字段与报告/探针闭环）
 * V77 native command exit code sync（发布 / pack / install smoke 原生命令真实退出码防假阳性）
 * V78 review scope drift docs IA sync（确认后复审、开发偏移、验证计划、用户建议根因与文档 IA）
 * V79 coverage gate and external runtime lifecycle matrix sync（coverage 独立门禁、外部 runtime/plugin/registry 生命周期矩阵、函数源码 fingerprint 与同风险簇分层验证）
 * V80 audit-user-manual aggregation skill sync（用户侧文档 review 聚合入口、项目文档、菜单导航、信息架构与报告证据）
 * V81~V86 规范吸纳执行、最新吸纳执行包、Profile 三档 / 全工作区校验、专家型产物质量、专家 Owner Skill 与记忆启动链真相源同步
 *
 * Exit: 0=OK, 1=error, 2=warnings only
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { execSync, execFileSync } = require('child_process')
const {
  RECENT_REQUIREMENT_ARTIFACT_DAYS,
  collectRecentBugArtifactIssues,
  collectRecentRequirementArtifactIssues
} = require('./lib/requirement-artifact-check')
const { buildGovernanceTailChecks } = require('./lib/validate-governance-tail')
const { buildGovernanceMidChecks } = require('./lib/validate-governance-mid')
const { buildGovernanceControlChecks } = require('./lib/validate-governance-control')
const { buildGovernancePromptChecks } = require('./lib/validate-governance-prompts')
const { buildGovernancePackageDeploymentChecks } = require('./lib/validate-governance-package-deployment')
const { buildGovernanceSupportChecks } = require('./lib/validate-governance-support')

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
    if (!/^description:\s*.+/m.test(fm[1])) {
      err(`[V1] Missing description in: ${path.relative(ROOT, f)}`)
    }
    if (!/^priority:\s*P[1-5](?:\.[0-9]+)?/m.test(fm[1])) {
      err(`[V1] Missing or invalid priority in: ${path.relative(ROOT, f)}`)
    }
    if (!/^version:\s*\d+\.\d+\.\d+/m.test(fm[1])) {
      err(`[V1] Missing or invalid version in: ${path.relative(ROOT, f)}`)
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
    { token: 'analyze.default', files: ['instructions/01-common.instructions.md', 'skills/routing/SKILL.md', 'instructions/13-analyze.instructions.md', 'skills/analyze-default/SKILL.md', 'prompts/report-analysis.prompt.md'] },
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

// V6 moved to scripts/lib/validate-governance-package-deployment.js

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

// V8 moved to scripts/lib/validate-governance-package-deployment.js

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

const {
  checkV39,
  checkV40,
  checkV41,
  checkV42,
  checkV43,
  checkV44,
  checkV45,
  checkV46,
  checkV47,
  checkV48,
  checkV49,
  checkV50,
  checkV51,
  checkV52,
  checkV53,
  checkV54,
  checkV55,
  checkV56,
  checkV57,
  checkV58,
  checkV59,
  checkV60,
  checkV61,
  checkV62,
  checkV63,
  checkV64,
  checkV65,
  checkV66,
  checkV67,
  checkV68,
  checkV69,
  checkV70,
  checkV71,
  checkV72,
  checkV73,
  checkV74,
  checkV75,
  checkV76,
  checkV77,
  checkV78,
  checkV79,
  checkV80,
  checkV81,
  checkV82,
  checkV83,
  checkV84,
  checkV85,
  checkV86,
  checkV87,
  checkV88,
  checkV89,
  checkV90,
  checkV91
} = buildGovernanceTailChecks({
  ROOT,
  ACTIVE_DEVCODEX_ROOT,
  RECENT_REQUIREMENT_ARTIFACT_DAYS,
  collectRecentBugArtifactIssues,
  collectRecentRequirementArtifactIssues,
  fs,
  path,
  execSync,
  read,
  err,
  mustInclude
})

const {
  checkV29,
  checkV30,
  checkV31,
  checkV32,
  checkV33,
  checkV34,
  checkV35,
  checkV36,
  checkV37,
  checkV38
} = buildGovernanceMidChecks({
  ROOT,
  fs,
  path,
  read,
  err
})

const {
  checkV20,
  checkV21,
  checkV22,
  checkV23,
  checkV24
} = buildGovernanceControlChecks({
  ROOT,
  fs,
  path,
  read,
  err,
  execSync,
  activePath
})

const {
  checkV25,
  checkV26,
  checkV27,
  checkV28
} = buildGovernanceSupportChecks({
  ROOT,
  fs,
  path,
  read,
  err,
  warn,
  execSync,
  activePath,
  mustInclude
})

const {
  checkV13,
  checkV14
} = buildGovernancePromptChecks({
  mustInclude,
  mustNotInclude,
  console
})

const {
  checkV6,
  checkV8
} = buildGovernancePackageDeploymentChecks({
  ROOT,
  fs,
  path,
  execSync,
  read,
  walk,
  fileHash,
  err,
  warn,
  console
})

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
  const instructionCount = fs.readdirSync(path.join(ROOT, 'instructions')).filter(f => f.endsWith('.instructions.md')).length
  const hookRuntimeFiles = walk(path.join(ROOT, 'hooks', '_runtime')).filter(f => f.endsWith('.cjs'))
  const hookRuntimeCount = hookRuntimeFiles.length
  const checks = [
    { file: 'README.md', needle: `Instructions 约束（${instructionCount} 个，含全部工作流规则）` },
    { file: 'README.md', needle: `全局 Instructions（${instructionCount} 个，含工作流规则摘要，自动注入）` },
    { file: 'README.md', needle: `Skill 详细检查标准（${skillCount} 个，按需读取，含默认分析、用户文档、用户侧文档 review 聚合、专家型产物质量、21 个专家 Owner Skill、复审清单、自我进化治理、README 专项能力、spec-governance、spec-absorption 与 5 个支撑型 Skill）` },
    { file: 'README.md', needle: `Skill 详细检查标准（${skillCount} 个，按 01-common §按需读取表 路由读取）` },
    { file: 'README.md', needle: `Prompt 模板（${promptCount} 个）` },
    { file: activePath('profile', '01-项目信息.md'), needle: `| **Skill** | ${skillCount} |`, rawPath: false },
    { file: activePath('profile', '01-项目信息.md'), needle: `| **Instruction** | ${instructionCount} |`, rawPath: false },
    { file: activePath('profile', '01-项目信息.md'), needle: `| **Prompt** | ${promptCount} |`, rawPath: false },
    { file: activePath('profile', '01-项目信息.md'), needle: `| **Hooks runtime** | ${hookRuntimeCount} |`, rawPath: false },
    { file: activePath('profile', '01-项目信息.md'), needle: `prompts ${promptCount}`, rawPath: false },
    { file: activePath('profile', '01-项目信息.md'), needle: `skills ${skillCount}`, rawPath: false },
    { file: activePath('profile', '02-架构约束.md'), needle: `Skill 文件 ${skillCount} 个`, rawPath: false },
    { file: activePath('profile', '02-架构约束.md'), needle: `Prompt 模板文件（.prompt.md，中文）${promptCount} 个`, rawPath: false },
    { file: activePath('profile', '02-架构约束.md'), needle: 'lifecycle-governance-intake.cjs', rawPath: false },
    { file: activePath('profile', '02-架构约束.md'), needle: 'workspace-layout.cjs', rawPath: false },
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

  const activeRequirementsIndex = read(path.join(ROOT, 'website/docs/versions/v1/1.0.1/requirements/index.md'))
  const activeRequirementsChangelog = read(path.join(ROOT, 'website/docs/versions/v1/1.0.1/CHANGELOG.md'))
  for (const stale of ['light-api', 'frontend-api', 'Claude MCP/合规漂移修复']) {
    if (activeRequirementsIndex.includes(stale)) {
      err(`[V19] active requirements index contains stale unbacked summary text: ${stale}`)
    }
  }
  if (!activeRequirementsIndex.includes('template-flow-alignment')) {
    err('[V19] active requirements index must link the existing template-flow-alignment requirement detail')
  }
  if (!activeRequirementsChangelog.includes('模板边界与开发流程收口')) {
    err('[V19] active version CHANGELOG must record the existing template-flow-alignment requirement detail')
  }

  console.log(`[V19] asset counts checked: instructions=${instructionCount}, skills=${skillCount}, prompts=${promptCount}, hook-runtime=${hookRuntimeCount}, data-templates=${dataTemplateCount}, scripts=${scriptCount}`)
}

// V29~V38 moved to scripts/lib/validate-governance-mid.js
// V39~V57 moved to scripts/lib/validate-governance-tail.js

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
checkV39()
checkV40()
checkV41()
checkV42()
checkV43()
checkV44()
checkV45()
checkV46()
checkV47()
checkV48()
checkV49()
checkV50()
checkV51()
checkV52()
checkV53()
checkV54()
checkV55()
checkV56()
checkV57()
checkV58()
checkV59()
checkV60()
checkV61()
checkV62()
checkV63()
checkV64()
checkV65()
checkV66()
checkV67()
checkV68()
checkV69()
checkV70()
checkV71()
checkV72()
checkV73()
checkV74()
checkV75()
checkV76()
checkV77()
checkV78()
checkV79()
checkV80()
// V81 spec absorption execution skill sync
checkV81()
// V82 latest absorption execution pack sync
checkV82()
// V83 profile tier and workspace validation sync
checkV83()
// V84 expert output quality skill sync
checkV84()
// V85 expert owner skill sync
checkV85()
// V86 memory bootstrap truth source sync
checkV86()
// V87 repair collaboration contract sync
checkV87()
// V88 profile truth reconciliation sync
checkV88()
// V89 authorized local security audit presentation sync
checkV89()
// V90 publisher credential topology sync
checkV90()
// V91 skill gap, scale routing and specialist skills sync
checkV91()

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
