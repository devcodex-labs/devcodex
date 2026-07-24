'use strict'

/**
 * HostParityScorecardV1 — Grok vs Codex capability honesty for doctor/status.
 * Full ≠ Codex API isomorphism; Full = launcher rules bind + PreTool deny path + path-observable.
 * PF-165: GrokTurnChecklist + Intent→Skill bundle + doctor repairSteps (no parallel system).
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

/** Scannable always-on checklist for passive-hook hosts (Grok). */
const GROK_TURN_EXECUTION_CHECKLIST = Object.freeze([
  { id: 'entry-pc0-pc7', text: 'First user-visible block: full PC0~PC7 (S07); compaction/resume re-emit' },
  { id: 'intent-route', text: 'IntentSeed → final route (dev/fix/analyze/audit/…); chat/resume only when true' },
  { id: 'skill-bundle', text: 'Load Intent→Skill mandatory bundle before substantive work (minimal-sufficient; no full Skill encyclopedia preload)' },
  { id: 'context-plan', text: 'ContextReadPlanV2 + receipts; no unbounded full Profile read without fullReadReason' },
  { id: 'scan-hygiene', text: 'C16 WorkspaceRootScanBan: no monorepo/workspace-root Get-ChildItem -Recurse; bind project path; exclude node_modules/dist' },
  { id: 'ttfv-first-delivery', text: 'C16 TimeToFirstValueGate: same visible turn delivers scope card OR first findings/conclusion OR hard block (non-chat)' },
  { id: 'work-and-gates', text: 'Execute workflow gates (CP/ECR as applicable); no skip for missing inject' },
  { id: 'report-memory', text: 'Non-chat: write report + memory (+ ledger when governance hits); chat exempt' },
  { id: 'honest-ceiling', text: 'Do not claim UserPromptSubmit inject / Stop hard-block / Grok===Codex bootstrap' }
])

/**
 * Non-chat Intent → mandatory Skill ids (model must load; passive host has no inject reminder).
 * chat: empty mandatory (optional intent only). resume: rehydrate then inherit prior workflow bundle.
 */
const GROK_INTENT_SKILL_BUNDLES = Object.freeze({
  chat: Object.freeze([]),
  resume: Object.freeze(['intent', 'compliance', 'memory', 'user-visible-output-contract']),
  analyze: Object.freeze(['intent', 'compliance', 'user-visible-output-contract', 'analyze-default', 'report', 'memory']),
  audit: Object.freeze(['intent', 'compliance', 'user-visible-output-contract', 'audit-common', 'report', 'memory']),
  dev: Object.freeze(['intent', 'compliance', 'user-visible-output-contract', 'dev-default', 'cp-gate', 'report', 'memory']),
  fix: Object.freeze(['intent', 'compliance', 'user-visible-output-contract', 'fix-default', 'cp-gate', 'report', 'memory']),
  'self-fix': Object.freeze(['intent', 'compliance', 'user-visible-output-contract', 'fix-default', 'cp-gate', 'report', 'memory']),
  other: Object.freeze(['intent', 'compliance', 'user-visible-output-contract', 'plan', 'report', 'memory'])
})

/** Minimum cannotClaim strings that must remain unless ParityUpgradeDecision allows shrink (E3). */
const MIN_CANNOT_CLAIM = Object.freeze([
  'UserPromptSubmit context injection (passive stdout ignored on Grok)',
  'Stop hard-block of incomplete turns',
  'verified-present PC0 without assistant payload on Stop',
  'Grok === Codex hook-enforced bootstrap'
])

/**
 * @param {string[]} cannotClaim
 * @returns {{ ok: true } | never}
 */
function assertCannotClaimFloor(cannotClaim) {
  const list = Array.isArray(cannotClaim) ? cannotClaim.map(String) : []
  for (const required of MIN_CANNOT_CLAIM) {
    if (!list.includes(required)) {
      throw new Error(`CANNOT_CLAIM_FLOOR_VIOLATION: missing required claim: ${required}`)
    }
  }
  if (list.length < MIN_CANNOT_CLAIM.length) {
    throw new Error(`CANNOT_CLAIM_FLOOR_VIOLATION: length ${list.length} < ${MIN_CANNOT_CLAIM.length}`)
  }
  return { ok: true }
}

const CHECK_REPAIR_CATALOG = Object.freeze({
  kernelAgentsMd: {
    check: 'kernelAgentsMd',
    command: 'devcodex update',
    detail: 'Workspace root must have AGENTS.md (shared kernel). Run update from workspace root.'
  },
  codexLifecycleReachable: {
    check: 'codexLifecycleReachable',
    command: 'devcodex update --host codex',
    detail: 'Codex lifecycle runtime under .codex/hooks/_runtime is the deny/path-observable contract source.'
  },
  denyAdapterContract: {
    check: 'denyAdapterContract',
    command: 'devcodex update --host codex && devcodex update --host grok',
    detail: 'lifecycle-host-adapters must export adaptGrokOutput and decision:deny mapping.'
  },
  pathObservableCapability: {
    check: 'pathObservableCapability',
    command: 'devcodex update --host codex',
    detail: 'lifecycle-bootstrap-state must treat Grok as path-observable (same band as Codex tool-path).'
  },
  workspacePluginInstalled: {
    check: 'workspacePluginInstalled',
    command: 'devcodex update --host grok',
    detail: 'Install/refresh workspace plugin under .grok/devcodex/plugins/devcodex-workspace.'
  },
  workspacePluginRegistered: {
    check: 'workspacePluginRegistered',
    command: 'devcodex update --host grok',
    detail: 'Ensure official user-level plugin registration points at workspace plugin source (doctor registrationCurrent).'
  }
})

function resolveGrokIntentSkillBundle(intent) {
  const key = String(intent || '').trim().toLowerCase()
  if (Object.prototype.hasOwnProperty.call(GROK_INTENT_SKILL_BUNDLES, key)) {
    return {
      intent: key,
      mandatorySkillIds: [...GROK_INTENT_SKILL_BUNDLES[key]],
      source: 'GROK_INTENT_SKILL_BUNDLES'
    }
  }
  return {
    intent: key || 'unknown',
    mandatorySkillIds: [...GROK_INTENT_SKILL_BUNDLES.other],
    source: 'GROK_INTENT_SKILL_BUNDLES',
    fallback: true
  }
}

function buildGrokRepairSteps(checks = {}) {
  const steps = []
  for (const [key, ok] of Object.entries(checks || {})) {
    if (ok) continue
    const catalog = CHECK_REPAIR_CATALOG[key]
    if (catalog) {
      steps.push({ ...catalog, status: 'failed' })
    } else {
      steps.push({
        check: key,
        command: 'devcodex update --host grok && devcodex doctor --json',
        detail: `Missing HostParity check: ${key}`,
        status: 'failed'
      })
    }
  }
  if (steps.length) {
    steps.push({
      check: 'full-session-entry',
      command: 'devcodex grok',
      detail: 'After hard path is green, start Full sessions with launcher (binds AGENTS.md via --rules). plain grok in child Git remains Partial.',
      status: 'recommended'
    })
  }
  return steps
}

function formatGrokTurnChecklistMarkdown() {
  return [
    '### GrokTurnChecklist (PF-165)',
    ...GROK_TURN_EXECUTION_CHECKLIST.map((item, i) => `${i + 1}. **${item.id}** — ${item.text}`),
    '',
    'Non-chat Skill bundle: intent + compliance + user-visible-output-contract + workflow Skill + report + memory.',
    'Platform ceiling: no UserPromptSubmit inject; Stop cannot hard-block incomplete turns.'
  ].join('\n')
}

/**
 * Negative-probe classifier: "I finished the Grok workflow" style text without checklist anchors → thin.
 * @returns {'checklist-ready'|'checklist-thin'|'not-grok-turn-claim'}
 */
function classifyGrokTurnOmissionSample(sample) {
  const text = String(sample || '')
  const claimsComplete = /完整(执行|工作流)|GrokTurnChecklist|HostParity|已按.*全流程|workflow complete|full workflow/i.test(text)
  if (!claimsComplete) return 'not-grok-turn-claim'
  const hasPc = /PC0|PC0~PC7|入口检查/i.test(text)
  const hasBundle = /Skill bundle|intent\s*\+|compliance|user-visible-output-contract|mandatorySkill/i.test(text)
  const hasReportMemory = /report|memory|报告|记忆|S05/i.test(text)
  const hasCeiling = /cannot claim|不得宣称|inject|Stop hard|platform ceiling|平台上限/i.test(text)
  const hasTtfvOrScan = /TTFV|TimeToFirstValue|scan-hygiene|WorkspaceRootScanBan|首批 (finding|结论)|范围卡/i.test(text)
  const score = [hasPc, hasBundle, hasReportMemory, hasCeiling, hasTtfvOrScan].filter(Boolean).length
  return score >= 3 ? 'checklist-ready' : 'checklist-thin'
}

/**
 * Detect monorepo/workspace-root recursive inventory anti-pattern (C16 / PI-20260724-01).
 * @returns {'workspace-root-recurse'|'project-scoped-ok'|'not-inventory-command'}
 */
function classifyWorkspaceRootScanSample(sample, options = {}) {
  const text = String(sample || '')
  const isInventory = /Get-ChildItem|get-childitem|\bgci\b|\bdir\s+\/s\b|\bfind\s+|list_dir|inventory|递归|Recurse/i.test(text)
  if (!isInventory) return 'not-inventory-command'
  const hasRecurse = /-\s*Recurse|\b-Recurse\b|\bdir\s+\/s\b|maxdepth|max-depth|-Depth\s*[1-9]|\b递归\b|\bfind\s+/i.test(text)
  if (!hasRecurse && !/Find.*Directory.*Filter/i.test(text)) return 'project-scoped-ok'
  const workspaceRoot = String(options.workspaceRoot || options.root || '').trim()
  const normalized = text.replace(/\//g, '\\')
  const cwd = String(options.cwd || '').trim()

  if (workspaceRoot) {
    const rootNorm = workspaceRoot.replace(/\//g, '\\').replace(/[\\/]+$/, '')
    const rootEsc = rootNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const mentionsRoot = new RegExp(rootEsc, 'i').test(normalized)
    // R-04: align with Hook — child segment without requiring trailing slash
    const underChild = new RegExp(rootEsc + '[\\\\/][a-z0-9._-]+', 'i').test(normalized)
    if (mentionsRoot) {
      if (underChild) return 'project-scoped-ok'
      return 'workspace-root-recurse'
    }
    // R-03: relative recurse when cwd is workspace root
    if (cwd) {
      const cwdNorm = cwd.replace(/\//g, '\\').replace(/[\\/]+$/, '').toLowerCase()
      if (cwdNorm === rootNorm.toLowerCase()) {
        // relative child token (not only switches / ".")
        if (/\b(?:Get-ChildItem|gci|dir)\b\s+([^\s-][^\s]*)/i.test(text)) {
          const tok = text.match(/\b(?:Get-ChildItem|gci|dir)\b\s+([^\s-][^\s]*)/i)[1]
            .replace(/^["']|["']$/g, '')
          if (tok && tok !== '.' && tok !== '.\\' && tok !== './' && !/^-\w/.test(tok)) {
            return 'project-scoped-ok'
          }
        }
        return 'workspace-root-recurse'
      }
    }
    return 'project-scoped-ok'
  }
  // Heuristic without explicit root
  if (/Get-ChildItem[\s\S]{0,160}-Path\s+["']?[A-Za-z]:\\[^"'\\]*(?:Worker|workspace)?[^"'\\]*["']?[\s\S]{0,120}-Recurse/i.test(text)
    && !/Get-ChildItem[\s\S]{0,160}-Path\s+["']?[A-Za-z]:\\[^"'\\]+\\[^"'\\]+/i.test(text)) {
    return 'workspace-root-recurse'
  }
  if (/\bdir\s+\/s\b/i.test(text) && /[A-Za-z]:\\/i.test(text) && !/[A-Za-z]:\\[^\\\s"']+\\/i.test(text.replace(/\//g, '\\'))) {
    return 'workspace-root-recurse'
  }
  if (/(?:对|from|at)\s+(?:workspace|monorepo|工作区)\s*根/i.test(text) && hasRecurse) {
    return 'workspace-root-recurse'
  }
  return 'project-scoped-ok'
}

/**
 * Non-chat first-turn must deliver value (C16 TTFV).
 * @returns {'ttfv-pass'|'ttfv-fail'|'ttfv-na-chat'}
 */
function classifyTtfvOmissionSample(sample, options = {}) {
  const text = String(sample || '')
  const intent = String(options.intent || '').toLowerCase()
  if (intent === 'chat' || options.chat === true) return 'ttfv-na-chat'
  if (/^chat\b|纯问答|仅说明/i.test(text) && options.forceNonChat !== true) {
    // only treat as chat when explicitly marked and no work claim
    if (!/audit|审查|分析|实现|finding|B1/i.test(text)) return 'ttfv-na-chat'
  }
  const hasScopeCard = /范围|Scope|批次\s*B\d|审查范围|ScaleDecision|默认范围|docs\/v01|FileEvidenceLedger/i.test(text)
  const hasFirstValue = /finding|发现|🔴|🟡|结论|根因|推荐方案|首批|B1|对账|不一致|漂移/i.test(text)
  const hasBlock = /阻断|BLOCK|无法继续|项目不明|权限|环境缺失|skipReason/i.test(text)
  const prepOnly = /正在(加载|读取|扫描|准备)|Skill 预读|全量读取规范|请稍候|定位项目中/i.test(text)
    && !hasScopeCard && !hasFirstValue && !hasBlock
  if (hasScopeCard || hasFirstValue || hasBlock) return 'ttfv-pass'
  if (prepOnly || text.trim().length < 40) return 'ttfv-fail'
  // Long process-only replies without deliverable
  if (/入口检查|ContextReadPlan|memory_status/i.test(text) && !hasScopeCard && !hasFirstValue && !hasBlock) {
    return 'ttfv-fail'
  }
  return 'ttfv-pass'
}

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
  const repairSteps = buildGrokRepairSteps(checks)
  const recommendedEntry = hardReady
    ? 'devcodex grok   # Full evidence: --rules binds workspace AGENTS.md'
    : (repairSteps[0] && repairSteps[0].command) || 'devcodex update --host grok && devcodex grok'

  const cannotClaim = [...MIN_CANNOT_CLAIM]
  assertCannotClaimFloor(cannotClaim)

  const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k)
  const repairPreview = repairSteps
    .filter((s) => s.status === 'failed')
    .slice(0, 3)
    .map((s) => s.command)
    .join(' ; ')

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
    failedChecks,
    repairSteps,
    turnChecklist: GROK_TURN_EXECUTION_CHECKLIST.map((item) => item.id),
    intentSkillBundles: GROK_INTENT_SKILL_BUNDLES,
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
      ? 'Grok HostParity: full-capable (PreTool deny + path-observable + kernel). Use `devcodex grok` for Full session evidence. Inject/Stop still Partial. Follow GrokTurnChecklist + Intent→Skill bundle.'
      : `Grok HostParity: partial — failed: ${failedChecks.join(', ') || 'unknown'}. Fix: ${repairPreview || 'devcodex update --host grok'}. Then doctor --json hostParity.repairSteps.`
  }

  scorecard.digest = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      tier: scorecard.tier,
      checks: scorecard.checks,
      hardReady: scorecard.hardReady,
      failedChecks: scorecard.failedChecks
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
  const intent = options.intent || 'unknown'
  const bundle = resolveGrokIntentSkillBundle(intent)
  return [
    '',
    '--- DevCodex S07 assist (Grok cannot inject this into the model; emit in the user-visible reply) ---',
    composeEntryCheckBlock(options),
    '',
    'GrokTurnChecklist: PC0~PC7 → Intent→Skill → context → scan-hygiene → TTFV → work/gates → report+memory → honest ceiling',
    `Intent→Skill bundle (${bundle.intent}): ${bundle.mandatorySkillIds.join(', ') || '(chat: none mandatory)'}`,
    'C16: no workspace-root Recurse inventory; same-turn TTFV delivery (scope/findings/block)',
    '--- end S07 assist ---'
  ].join('\n')
}

module.exports = {
  GROK_TURN_EXECUTION_CHECKLIST,
  GROK_INTENT_SKILL_BUNDLES,
  CHECK_REPAIR_CATALOG,
  MIN_CANNOT_CLAIM,
  assertCannotClaimFloor,
  evaluateGrokHostParity,
  composeEntryCheckBlock,
  entryCheckAssistSuffix,
  composePc4Line,
  resolveGrokIntentSkillBundle,
  buildGrokRepairSteps,
  formatGrokTurnChecklistMarkdown,
  classifyGrokTurnOmissionSample,
  classifyWorkspaceRootScanSample,
  classifyTtfvOmissionSample,
  readAdapterDenyContract,
  readBootstrapCapability
}
