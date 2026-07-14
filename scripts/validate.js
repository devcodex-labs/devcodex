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
 * V92 项目工程与治理闭环优化（CI/coverage/checked-command/portfolio/runtime-state/manifest/docs）
 * V93 控制面模块化边界与探针注册表
 * V94 返工预防、审查/产物信任链与发布/配置/交互 Owner 子门禁
 * V95 Agent/用户文档/跨仓消费者/模块性能完整性门禁
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
const { buildValidateCoreChecks } = require('./lib/validate-core-checks')
const { createProbeRegistry, runProbeRegistry } = require('./lib/probe-registry')
const { buildModularityControlChecks } = require('./lib/validate-modularity-controls')
const { buildGovernanceTailChecks } = require('./lib/validate-governance-tail')
const { buildGovernanceMidChecks } = require('./lib/validate-governance-mid')
const { buildGovernanceControlChecks } = require('./lib/validate-governance-control')
const { buildGovernancePromptChecks } = require('./lib/validate-governance-prompts')
const { buildGovernancePackageDeploymentChecks } = require('./lib/validate-governance-package-deployment')
const { buildOptimizationControlChecks } = require('./lib/validate-optimization-controls')
const { buildReworkTrustControlChecks } = require('./lib/validate-rework-trust-controls')
const { buildConsumerEvolutionControlChecks } = require('./lib/validate-consumer-evolution-controls')
const { buildGovernanceSupportChecks } = require('./lib/validate-governance-support')
const { resolveActiveRuntimeRoot } = require('../hooks/_runtime/workspace-layout.cjs')

const ROOT = path.resolve(__dirname, '..')
const WORKSPACE_ROOT = path.dirname(ROOT)
const TARGET_DEPLOYMENT_RUNTIME_ROOT = resolveActiveRuntimeRoot(WORKSPACE_ROOT)
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
// ── V2: relative links ──────────────────────────────────────────────────────
// ── V3: five-place sync ─────────────────────────────────────────────────────
// ── V4: version consistency ─────────────────────────────────────────────────
// ── V5: PC4 format single source ────────────────────────────────────────────
// V6 moved to scripts/lib/validate-governance-package-deployment.js

// ── V7: hooks runtime bootstrap smoke test ─────────────────────────────────
// V8 moved to scripts/lib/validate-governance-package-deployment.js

// ── V9: date format consistency (YYYY-MM-DD or YYYY-MM-DD HH:MM) ─────────
// ── V10: regression probes on audit-state.findings[status=fixed] ────────────
// ── V11: AskUserQuestion / decision-point format (FC7) ──────────────────────
// ── V13: template semantic probes ───────────────────────────────────────────
function mustInclude(file, needle, label) {
  const content = read(path.join(ROOT, file))
  if (!content.includes(needle)) err(`[V13] ${label || file} missing required text: ${needle}`)
}

function mustNotInclude(file, needle, label) {
  const content = read(path.join(ROOT, file))
  if (content.includes(needle)) err(`[V13] ${label || file} contains forbidden legacy text: ${needle}`)
}

const coreChecks = buildValidateCoreChecks({
  ROOT,
  ACTIVE_DEVCODEX_ROOT,
  TARGET_DEPLOYMENT_RUNTIME_ROOT,
  RECENT_REQUIREMENT_ARTIFACT_DAYS,
  collectRecentBugArtifactIssues,
  collectRecentRequirementArtifactIssues,
  fs,
  os,
  path,
  crypto,
  execSync,
  execFileSync,
  read,
  err,
  warn,
  walk,
  fileHash,
  activePath,
  resolveActiveDevcodexRoot,
  readJsonIfExists,
  mustInclude,
  mustNotInclude
})

const tailChecks = buildGovernanceTailChecks({
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

const midChecks = buildGovernanceMidChecks({
  ROOT,
  fs,
  path,
  read,
  err
})

const controlChecks = buildGovernanceControlChecks({
  ROOT,
  fs,
  path,
  read,
  err,
  execSync,
  activePath
})

const supportChecks = buildGovernanceSupportChecks({
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

const promptChecks = buildGovernancePromptChecks({
  mustInclude,
  mustNotInclude,
  console
})

const packageChecks = buildGovernancePackageDeploymentChecks({
  ROOT,
  fs,
  path,
  execSync,
  read,
  walk,
  fileHash,
  err,
  warn,
  console,
  ACTIVE_DEVCODEX_ROOT,
  TARGET_DEPLOYMENT_RUNTIME_ROOT
})

const optimizationChecks = buildOptimizationControlChecks({
  ROOT,
  ACTIVE_DEVCODEX_ROOT,
  fs,
  path,
  read,
  err,
  console
})

const modularityChecks = buildModularityControlChecks({ ROOT, fs, path, read, err, console })
const reworkTrustChecks = buildReworkTrustControlChecks({ ROOT, fs, path, read, err, console })
const consumerEvolutionChecks = buildConsumerEvolutionControlChecks({ ROOT, fs, path, read, err, console })

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

const expectedProbeIds = Array.from({ length: 95 }, (_, index) => `V${index + 1}`)
const probeRegistry = createProbeRegistry([
  { owner: 'core-contract', checks: Object.values(coreChecks) },
  { owner: 'package-deployment', checks: Object.values(packageChecks) },
  { owner: 'prompt-contract', checks: Object.values(promptChecks) },
  { owner: 'governance-control', checks: Object.values(controlChecks) },
  { owner: 'governance-support', checks: Object.values(supportChecks) },
  { owner: 'governance-mid', checks: Object.values(midChecks) },
  { owner: 'governance-tail', checks: Object.values(tailChecks) },
  {
    owner: 'optimization-controls',
    checks: Object.values(optimizationChecks),
    dependencies: { V92: ['V19', 'V77', 'V91'] }
  },
  { owner: 'modularity-controls', checks: Object.values(modularityChecks), dependencies: { V93: ['V19', 'V26', 'V92'] } },
  { owner: 'rework-trust-controls', checks: Object.values(reworkTrustChecks), dependencies: { V94: ['V29', 'V39', 'V73', 'V91', 'V93'] } },
  { owner: 'consumer-evolution-controls', checks: Object.values(consumerEvolutionChecks), dependencies: { V95: ['V73', 'V85', 'V91', 'V93', 'V94'] } }
], { expectedIds: expectedProbeIds })

runProbeRegistry(probeRegistry, {
  afterRun: descriptor => {
    if (descriptor.id === 'V7') checkV7b()
  }
})

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
