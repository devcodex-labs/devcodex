'use strict'

/**
 * HostParityScorecardV1 — Grok vs Codex capability honesty for doctor/status.
 * Full ≠ Codex API isomorphism; Full = launcher rules bind + PreTool deny path + path-observable.
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

function fileExists(filePath) {
  try {
    return Boolean(filePath && fs.existsSync(filePath))
  } catch {
    return false
  }
}

function readAdapterDenyContract(adapterPath) {
  if (!fileExists(adapterPath)) {
    return { present: false, hasAdaptGrok: false, hasDenyDecision: false }
  }
  try {
    const text = fs.readFileSync(adapterPath, 'utf8')
    return {
      present: true,
      hasAdaptGrok: /function adaptGrokOutput|adaptGrokOutput\s*\(/.test(text),
      hasDenyDecision: /decision:\s*['"]deny['"]/.test(text)
    }
  } catch {
    return { present: false, hasAdaptGrok: false, hasDenyDecision: false }
  }
}

function readBootstrapCapability(bootstrapPath) {
  if (!fileExists(bootstrapPath)) {
    return { present: false, grokPathObservable: false }
  }
  try {
    const text = fs.readFileSync(bootstrapPath, 'utf8')
    return {
      present: true,
      grokPathObservable: /platform === ['"]grok['"][\s\S]{0,120}path-observable|codex' \|\| platform === 'grok'/.test(text)
        || /platform === 'codex' \|\| platform === 'grok'/.test(text)
    }
  } catch {
    return { present: false, grokPathObservable: false }
  }
}

function normalizeEnvMode(value) {
  const mode = String(value || '').trim().toLowerCase()
  if (mode === 'dev' || mode === 'prod') return mode
  return 'unknown'
}

function composePc4Line(options = {}) {
  const mode = normalizeEnvMode(options.envMode || options.mode || options.profileMode)
  if (mode === 'dev') {
    return '- PC4 [UNVERIFIED] dev 模式：必须输出完整规范雷达，并绑定所用 Skills/Profile/Owner/TestRoute'
  }
  if (mode === 'prod') {
    return '- PC4 [N/A] prod 模式：不展开 dev 规范雷达；安全底线与 CP 门控仍强制'
  }
  return '- PC4 [UNVERIFIED] ENV_MODE unknown：需先读取 Profile config 后判定 dev/prod 与 PC4 展开方式'
}

/**
 * @param {object} input
 * @param {string} input.cwd
 * @param {string} [input.hostRoot]
 * @param {object} [input.instructionProjection]
 * @param {boolean} [input.hasAgentsMd]
 * @param {boolean} [input.hasCodexLifecycle]
 * @param {boolean} [input.hasGrokWorkspacePlugin]
 * @param {boolean} [input.hasGrokPluginRegistration]
 * @param {string} [input.platform]
 */
function evaluateGrokHostParity(input = {}) {
  const cwd = path.resolve(input.cwd || process.cwd())
  const hostRoot = path.resolve(input.hostRoot || cwd)
  const projection = input.instructionProjection || {}
  const pluginRoot = projection.grokPlugin?.root
    || path.join(hostRoot, '.grok', 'devcodex', 'plugins', 'devcodex-workspace')

  const hasAgentsMd = input.hasAgentsMd !== undefined
    ? input.hasAgentsMd
    : fileExists(path.join(hostRoot, 'AGENTS.md'))
  const hasCodexLifecycle = input.hasCodexLifecycle !== undefined
    ? input.hasCodexLifecycle
    : fileExists(path.join(hostRoot, '.codex', 'hooks', '_runtime', 'lifecycle.cjs'))
  const adapterCandidates = [
    path.join(hostRoot, '.codex', 'hooks', '_runtime', 'lifecycle-host-adapters.cjs'),
    path.join(hostRoot, '.claude', 'hooks', '_runtime', 'lifecycle-host-adapters.cjs'),
    path.join(pluginRoot, 'hooks', 'devcodex-workspace.cjs')
  ]
  const adapterPath = adapterCandidates.find(fileExists) || adapterCandidates[0]
  const bootstrapPath = path.join(path.dirname(adapterPath), 'lifecycle-bootstrap-state.cjs')
  const denyContract = readAdapterDenyContract(
    fileExists(path.join(hostRoot, '.codex', 'hooks', '_runtime', 'lifecycle-host-adapters.cjs'))
      ? path.join(hostRoot, '.codex', 'hooks', '_runtime', 'lifecycle-host-adapters.cjs')
      : adapterPath.includes('lifecycle-host-adapters')
        ? adapterPath
        : path.join(hostRoot, '.codex', 'hooks', '_runtime', 'lifecycle-host-adapters.cjs')
  )
  // Prefer workspace codex runtime adapters for contract source
  const codexAdapter = path.join(hostRoot, '.codex', 'hooks', '_runtime', 'lifecycle-host-adapters.cjs')
  const codexBootstrap = path.join(hostRoot, '.codex', 'hooks', '_runtime', 'lifecycle-bootstrap-state.cjs')
  const deny = fileExists(codexAdapter) ? readAdapterDenyContract(codexAdapter) : denyContract
  const bootstrap = fileExists(codexBootstrap)
    ? readBootstrapCapability(codexBootstrap)
    : readBootstrapCapability(path.join(hostRoot, '.claude', 'hooks', '_runtime', 'lifecycle-bootstrap-state.cjs'))

  const hasGrokWorkspacePlugin = input.hasGrokWorkspacePlugin !== undefined
    ? input.hasGrokWorkspacePlugin
    : Boolean(projection.grokPlugin?.installed)
  const hasGrokPluginRegistration = input.hasGrokPluginRegistration !== undefined
    ? input.hasGrokPluginRegistration
    : Boolean(projection.grokPlugin?.registrationCurrent)

  const checks = {
    kernelAgentsMd: hasAgentsMd,
    codexLifecycleReachable: hasCodexLifecycle,
    denyAdapterContract: Boolean(deny.present && deny.hasAdaptGrok && deny.hasDenyDecision),
    pathObservableCapability: Boolean(bootstrap.present && bootstrap.grokPathObservable),
    workspacePluginInstalled: hasGrokWorkspacePlugin,
    workspacePluginRegistered: hasGrokPluginRegistration
  }

  const hardReady = checks.kernelAgentsMd
    && checks.codexLifecycleReachable
    && checks.denyAdapterContract
    && checks.pathObservableCapability
    && checks.workspacePluginInstalled
    && checks.workspacePluginRegistered

  // Full requires hardReady + recommendation to use launcher; plain child never auto-Full
  const tier = hardReady ? 'full-capable' : 'partial'
  const recommendedEntry = hardReady
    ? 'devcodex grok   # Full evidence: --rules binds workspace AGENTS.md'
    : 'devcodex update --host grok && devcodex grok'

  const cannotClaim = [
    'UserPromptSubmit context injection (passive stdout ignored on Grok)',
    'Stop hard-block of incomplete turns',
    'verified-present PC0 without assistant payload on Stop',
    'Grok === Codex hook-enforced bootstrap'
  ]

  const scorecard = {
    schemaVersion: 'HostParityScorecardV1',
    host: 'grok',
    referenceHost: 'codex',
    evaluatedAt: new Date().toISOString(),
    cwd,
    hostRoot,
    tier,
    hardReady,
    checks,
    evidence: {
      codexAdapter: fileExists(codexAdapter) ? codexAdapter : null,
      codexBootstrap: fileExists(codexBootstrap) ? codexBootstrap : null,
      pluginRoot: hasGrokWorkspacePlugin ? pluginRoot : null,
      deny,
      bootstrap
    },
    recommendedEntry,
    cannotClaim,
    userVisibleSummary: hardReady
      ? 'Grok HostParity: full-capable (PreTool deny + path-observable + kernel). Use `devcodex grok` for Full session evidence. Inject/Stop still Partial.'
      : 'Grok HostParity: partial — fix missing checks before claiming PreTool parity.'
  }

  scorecard.digest = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      tier: scorecard.tier,
      checks: scorecard.checks,
      hardReady: scorecard.hardReady
    }))
    .digest('hex')

  return scorecard
}

function composeEntryCheckBlock(options = {}) {
  const project = String(options.project || '未识别').trim() || '未识别'
  const overall = String(options.status || 'UNVERIFIED').trim() || 'UNVERIFIED'
  const next = String(options.nextStep || '完成 ContextReadPlan 与有界 Profile/memory 读取后继续').trim()
  const digest = String(options.semanticDigest || 'pending-entry-check').trim()
  return [
    '### DevCodex · 入口检查',
    `\`${overall}\` · \`${project}\``,
    '',
    '- PC0 [UNVERIFIED] ContextReadPlan 与必要来源回执（填写 plan + 回执）',
    '- PC1 [UNVERIFIED] 语义初判 → 项目现实扩展后最终路由',
    '- PC2 [UNVERIFIED] 会话/Token 防护/待跟进',
    '- PC3 [UNVERIFIED] 唯一项目、连续性与产物落点',
    composePc4Line(options),
    '- PC5 [UNVERIFIED] 宿主部署/同步/加载证据（Grok: Partial unless Full launcher）',
    '- PC6 [UNVERIFIED] git dirty、active task 与工作区一致性',
    '- PC7 [UNVERIFIED] 新会话或 resume 的 bounded continuation',
    '',
    `下一步：${next}`,
    `DevCodexVisibleEnvelopeV1 · entry-check · ${overall} · ${digest}`
  ].join('\n')
}

function entryCheckAssistSuffix(options = {}) {
  return [
    '',
    '--- DevCodex S07 assist (Grok cannot inject this into the model; emit in the user-visible reply) ---',
    composeEntryCheckBlock(options),
    '--- end S07 assist ---'
  ].join('\n')
}

module.exports = {
  evaluateGrokHostParity,
  composeEntryCheckBlock,
  entryCheckAssistSuffix,
  composePc4Line,
  readAdapterDenyContract,
  readBootstrapCapability
}
