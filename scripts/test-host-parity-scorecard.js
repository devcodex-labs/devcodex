#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
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
  GROK_TURN_EXECUTION_CHECKLIST,
  GROK_INTENT_SKILL_BUNDLES,
  MIN_CANNOT_CLAIM,
  assertCannotClaimFloor
} = require('./lib/host-parity-scorecard.js')
const { adaptHostOutput } = require('../hooks/_runtime/lifecycle-host-adapters.cjs')
const { buildLifecyclePayloadUtils } = require('../hooks/_runtime/lifecycle-payload-utils.cjs')
const { resolveGlobalHostTarget } = require('./lib/global-host-target.js')

// --- scorecard pure helpers ---
const block = composeEntryCheckBlock({ project: 'demo', status: 'PASS', nextStep: 'go' })
assert.match(block, /### DevCodex · 入口检查/)
assert.match(block, /`PASS` · `demo`/)
assert.match(block, /PC0/)
assert.match(block, /PC4 \[UNVERIFIED\] ENV_MODE unknown/)
assert.match(composeEntryCheckBlock({ project: 'demo', envMode: 'dev' }), /PC4 \[UNVERIFIED\] dev 模式/)
assert.match(composeEntryCheckBlock({ project: 'demo', envMode: 'prod' }), /PC4 \[N\/A\] prod 模式/)
assert.match(composePc4Line({ envMode: 'unexpected' }), /ENV_MODE unknown/)
assert.match(entryCheckAssistSuffix({ project: 'x' }), /S07 assist/)

// Isolated user-global layout for hardReady
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-host-parity-'))
let tempCleaned = false
function cleanupTempFixture() {
  if (tempCleaned) return
  fs.rmSync(root, { recursive: true, force: true })
  tempCleaned = true
}
process.once('exit', cleanupTempFixture)
const isolatedEnv = {
  ...process.env,
  DEVCODEX_TEST_HOME: root,
  USERPROFILE: root,
  HOME: root
}
const codexTarget = resolveGlobalHostTarget('codex', {
  env: isolatedEnv,
  home: root,
  packageRoot: path.resolve(__dirname, '..')
})
const codexRuntime = codexTarget.runtimeRoot
const grokPlugin = path.join(root, '.grok', 'devcodex', 'plugins', 'devcodex-workspace')
fs.mkdirSync(path.join(codexRuntime, 'hooks', '_runtime'), { recursive: true })
fs.mkdirSync(path.join(grokPlugin, 'hooks'), { recursive: true })
fs.writeFileSync(path.join(root, '.codex', 'AGENTS.md'), '# kernel\n')
fs.writeFileSync(path.join(codexRuntime, 'AGENTS.md'), '# runtime kernel\n')
fs.writeFileSync(path.join(root, '.grok', 'config.toml'), 'plugins = []\n')
fs.writeFileSync(path.join(grokPlugin, 'hooks', 'hooks.json'), '{}\n')
const adapterSrc = fs.readFileSync(path.join(__dirname, '../hooks/_runtime/lifecycle-host-adapters.cjs'), 'utf8')
const bootstrapSrc = fs.readFileSync(path.join(__dirname, '../hooks/_runtime/lifecycle-bootstrap-state.cjs'), 'utf8')
fs.writeFileSync(path.join(codexRuntime, 'hooks', '_runtime', 'lifecycle-host-adapters.cjs'), adapterSrc)
fs.writeFileSync(path.join(codexRuntime, 'hooks', '_runtime', 'lifecycle-bootstrap-state.cjs'), bootstrapSrc)
fs.writeFileSync(path.join(codexRuntime, 'hooks', '_runtime', 'lifecycle.cjs'), 'module.exports={}\n')
fs.writeFileSync(
  path.join(codexRuntime, 'runtime-generation.json'),
  `${JSON.stringify(codexTarget.runtimeGeneration, null, 2)}\n`
)
const globalHostConfig = {
  hosts: [
    { host: 'codex', adapterReady: true, ready: false, nativeStatus: 'unverified' },
    { host: 'grok', adapterReady: true, ready: false, nativeStatus: 'unverified' }
  ]
}
const ready = evaluateGrokHostParity({
  cwd: root,
  hostRoot: root,
  env: isolatedEnv,
  globalHostConfig
})
assert.strictEqual(ready.hardReady, true)
assert.strictEqual(ready.tier, 'full-capable')
assert.strictEqual(ready.failedChecks.length, 0)
assert.ok(!ready.repairSteps.some((step) => step.status === 'failed'))
assert.ok(ready.checks.denyAdapterContract)
assert.ok(ready.checks.pathObservableCapability)
assert.ok(Array.isArray(ready.cannotClaim) && ready.cannotClaim.length >= 3)
assert.strictEqual(MIN_CANNOT_CLAIM.length, 4)
assertCannotClaimFloor(ready.cannotClaim)
assert.ok(ready.recommendedEntry.includes('devcodex grok'))

// Managed config drift must not be projected as missing physical kernel/lifecycle files.
const drifted = evaluateGrokHostParity({
  cwd: root,
  hostRoot: root,
  env: isolatedEnv,
  globalHostConfig: {
    hosts: [
      {
        host: 'codex',
        adapterReady: false,
        adapterContractStatus: 'passed',
        configurationIssues: [{ code: 'GLOBAL_HOST_MANAGED_CONFIG_DRIFT' }]
      },
      { host: 'grok', adapterReady: true, adapterContractStatus: 'passed', configurationIssues: [] }
    ]
  }
})
assert.strictEqual(drifted.checks.globalKernelAgentsMd, true)
assert.strictEqual(drifted.checks.globalCodexLifecycleReachable, true)
assert.strictEqual(drifted.checks.codexAdapterContractReady, true)
assert.strictEqual(drifted.checks.managedConfigCurrent, false)
assert.strictEqual(drifted.hardReady, false)
assert.ok(!drifted.failedChecks.includes('globalKernelAgentsMd'))
assert.ok(!drifted.failedChecks.includes('globalCodexLifecycleReachable'))
assert.deepStrictEqual(
  drifted.repairSteps.filter(step => step.status === 'failed').map(step => step.command),
  ['devcodex global-adapters apply']
)

const partial = evaluateGrokHostParity({
  cwd: root,
  hostRoot: root,
  env: isolatedEnv,
  globalHostConfig,
  hasGlobalKernel: false,
  hasGlobalCodexLifecycle: false,
  hasGlobalGrokPlugin: false,
  hasGlobalGrokConfig: false
})
assert.strictEqual(partial.hardReady, false)
assert.strictEqual(partial.tier, 'partial')
assert.ok(Array.isArray(partial.failedChecks) && partial.failedChecks.includes('globalKernelAgentsMd'))
assert.ok(Array.isArray(partial.repairSteps) && partial.repairSteps.length >= 1)
// R1a: source package root must recommend global-adapters apply (not only npm -g)
assert.ok(
  partial.repairSteps.some((s) => /devcodex global-adapters apply/.test(s.command)),
  'source HostParity repairSteps must recommend global-adapters apply'
)
assert.ok(
  !partial.repairSteps.some((s) => s.status === 'failed' && s.command === 'npm install -g devcodex'),
  'source HostParity failed repair must not hardcode npm install -g only'
)
assert.match(partial.userVisibleSummary, /partial|failed/i)
assert.match(partial.userVisibleSummary, /global-adapters apply/)
assert.strictEqual(partial.evidence.adapterRefreshSourceCheckout, true)
assert.match(String(partial.evidence.adapterRefreshPrimary || ''), /global-adapters apply/)
assert.ok(Array.isArray(partial.turnChecklist) && partial.turnChecklist.includes('skill-bundle'))
assert.ok(partial.intentSkillBundles && partial.intentSkillBundles.analyze)

// PF-165: Intent→Skill bundle
const analyzeBundle = resolveGrokIntentSkillBundle('analyze')
assert.deepStrictEqual(analyzeBundle.mandatorySkillIds.slice(0, 3), ['intent', 'compliance', 'user-visible-output-contract'])
assert.ok(analyzeBundle.mandatorySkillIds.includes('report'))
assert.ok(analyzeBundle.mandatorySkillIds.includes('memory'))
assert.strictEqual(resolveGrokIntentSkillBundle('chat').mandatorySkillIds.length, 0)
assert.ok(GROK_INTENT_SKILL_BUNDLES.fix.includes('fix-default'))
assert.ok(GROK_TURN_EXECUTION_CHECKLIST.length >= 8)
assert.ok(GROK_TURN_EXECUTION_CHECKLIST.some((i) => i.id === 'scan-hygiene'))
assert.ok(GROK_TURN_EXECUTION_CHECKLIST.some((i) => i.id === 'ttfv-first-delivery'))
assert.match(formatGrokTurnChecklistMarkdown(), /GrokTurnChecklist/)
assert.match(formatGrokTurnChecklistMarkdown(), /scan-hygiene|ttfv-first-delivery/)

// PF-165: repair catalog for registration gap
const regOnly = buildGrokRepairSteps({
  globalKernelAgentsMd: true,
  globalCodexLifecycleReachable: true,
  denyAdapterContract: true,
  pathObservableCapability: true,
  globalGrokPluginInstalled: true,
  globalGrokPluginConfigured: false
})
assert.ok(regOnly.some((s) =>
  s.check === 'globalGrokPluginConfigured' && /devcodex global-adapters apply/.test(s.command)
))
assert.ok(regOnly.some((s) => s.check === 'full-session-entry' && s.command === 'devcodex grok'))

// published-package guidance path (no .git) still uses npm -g primary
const publishedRepair = buildGrokRepairSteps(
  { globalKernelAgentsMd: false },
  {
    guidance: {
      primary: 'npm update -g devcodex',
      nextStepShort: 'npm update -g devcodex',
      sourceCheckout: false
    }
  }
)
assert.ok(publishedRepair.some((s) => s.status === 'failed' && /npm update -g devcodex/.test(s.command)))

// PF-165 negative: claim full Grok workflow without checklist anchors → thin
assert.strictEqual(
  classifyGrokTurnOmissionSample('Grok 完整工作流已执行完毕，任务完成。'),
  'checklist-thin'
)
assert.strictEqual(
  classifyGrokTurnOmissionSample([
    '按 GrokTurnChecklist 完整执行工作流：',
    'PC0~PC7 已输出；Skill bundle intent+compliance+user-visible-output-contract+report+memory；',
    '已写报告与记忆 S05；platform ceiling: cannot claim inject/Stop hard-block'
  ].join(' ')),
  'checklist-ready'
)
assert.strictEqual(classifyGrokTurnOmissionSample('普通修 bug 完成'), 'not-grok-turn-claim')

// C16 / PI-20260724-01: workspace-root recurse ban + TTFV
assert.strictEqual(
  classifyWorkspaceRootScanSample(
    'Get-ChildItem -Path "E:\\Worker" -Directory -Filter "*queuebit*" -Recurse -Depth 3',
    { workspaceRoot: 'E:\\Worker' }
  ),
  'workspace-root-recurse'
)
assert.strictEqual(
  classifyWorkspaceRootScanSample(
    'Get-ChildItem -Path "E:\\Worker\\queuebit\\docs" -Recurse -Filter *.md',
    { workspaceRoot: 'E:\\Worker' }
  ),
  'project-scoped-ok'
)
// R-04: first-level child without trailing slash must be ok
assert.strictEqual(
  classifyWorkspaceRootScanSample(
    'Get-ChildItem -Path "E:\\Worker\\queuebit" -Recurse',
    { workspaceRoot: 'E:\\Worker' }
  ),
  'project-scoped-ok'
)
// R-02 / R-03 probe
assert.strictEqual(
  classifyWorkspaceRootScanSample('dir /s E:\\Worker', { workspaceRoot: 'E:\\Worker' }),
  'workspace-root-recurse'
)
assert.strictEqual(
  classifyWorkspaceRootScanSample('Get-ChildItem -Recurse -Depth 3', {
    workspaceRoot: 'E:\\Worker',
    cwd: 'E:\\Worker'
  }),
  'workspace-root-recurse'
)
assert.strictEqual(classifyWorkspaceRootScanSample('npm test'), 'not-inventory-command')
assert.strictEqual(
  classifyTtfvOmissionSample('### 入口检查\n正在加载全部 audit Skill 并扫描工作区，请稍候…', { intent: 'audit' }),
  'ttfv-fail'
)
assert.strictEqual(
  classifyTtfvOmissionSample('范围：docs/v01 全量；B1 发现：README 与 package version 一致', { intent: 'audit' }),
  'ttfv-pass'
)
assert.strictEqual(classifyTtfvOmissionSample('解释一下 C16 是什么', { intent: 'chat' }), 'ttfv-na-chat')

const { classifyProgressReportFastPathSample } = require('./lib/host-parity-scorecard')
assert.strictEqual(
  classifyProgressReportFastPathSample('workspace 根 Get-ChildItem -Recurse 摸底，请稍候', { isProgressQuery: true }),
  'progress-fail'
)
assert.strictEqual(
  classifyProgressReportFastPathSample('绑定 vext-test；verification/issues/README 总进度；当前阻断；可否发版：否', { isProgressQuery: true }),
  'progress-pass'
)

// S07 assist includes skill bundle line
assert.match(entryCheckAssistSuffix({ project: 'x', intent: 'fix' }), /Intent→Skill bundle \(fix\)/)
assert.match(entryCheckAssistSuffix({ project: 'x', intent: 'fix' }), /fix-default/)
assert.match(entryCheckAssistSuffix({ project: 'x', intent: 'audit' }), /TTFV|workspace-root|scan-hygiene/i)

// Smoke: deny path used by PreToolUse
const deny = adaptHostOutput('grok', 'PreToolUse', {
  hookSpecificOutput: {
    permissionDecision: 'deny',
    permissionDecisionReason: 'dangerous-command'
  }
})
assert.deepStrictEqual(deny, { decision: 'deny', reason: 'dangerous-command' })

// W8: extra field names for assistant text
const payloadApi = buildLifecyclePayloadUtils({
  fs,
  path,
  payloadPreviewLimit: 2000,
  transcriptTailLimit: 2000,
  safeJsonParse: (t) => { try { return JSON.parse(t) } catch { return null } },
  normalizeText: (s) => String(s || '')
})
const hit = payloadApi.getVisibleReplyEvidence({
  finalMessage: '### DevCodex · 入口检查\n`PASS` · `p`'
})
assert.strictEqual(hit.observed, true)
assert.strictEqual(hit.source, 'finalMessage')

// Stop block is preserved (official Grok Stop Decision Control); UPS remains passive for inject.
const stopBlock = adaptHostOutput('grok', 'Stop', { decision: 'block', reason: 'x' })
assert.strictEqual(stopBlock.decision, 'block')
assert.strictEqual(stopBlock.reason, 'x')
assert.strictEqual(stopBlock.devcodexGrokEvidenceMode, 'stop-decision-block')
const upsPassive = adaptHostOutput('grok', 'UserPromptSubmit', { decision: 'block', reason: 'no-ups-block' })
assert.strictEqual(upsPassive.continue, true)
assert.strictEqual(Object.prototype.hasOwnProperty.call(upsPassive, 'decision'), false)

// SessionStart creates one private owner root and exits 0
const sessionStart = path.join(__dirname, '../grok/plugins/devcodex-workspace/hooks/session-start.cjs')
assert.ok(fs.existsSync(sessionStart))
const { spawnSync } = require('child_process')
const stampRun = spawnSync(process.execPath, [sessionStart], {
  env: { ...process.env, GROK_PLUGIN_DATA: path.join(root, 'plugin-data'), GROK_SESSION_ID: 'test-session' },
  encoding: 'utf8'
})
assert.strictEqual(stampRun.status, 0)
const sessionPrivateRoot = path.join(root, 'plugin-data', 'private-sessions')
const sessionOwners = fs.readdirSync(sessionPrivateRoot)
assert.strictEqual(sessionOwners.length, 1)
const sessionOwner = JSON.parse(fs.readFileSync(path.join(sessionPrivateRoot, sessionOwners[0], 'session.json'), 'utf8'))
assert.strictEqual(sessionOwner.schemaVersion, 'GrokSessionPrivateOwnerV1')
assert.strictEqual(sessionOwner.sessionIdPresent, true)

cleanupTempFixture()
assert.strictEqual(fs.existsSync(root), false, 'host parity temporary fixture must be removed before success')
console.log('host parity scorecard + smoke tests + temp cleanup passed')
