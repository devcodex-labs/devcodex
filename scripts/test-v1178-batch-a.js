'use strict'

const assert = require('assert')
const path = require('path')
const crypto = require('crypto')
const { buildLifecycleProjectTargetUtils } = require('../hooks/_runtime/lifecycle-project-target.cjs')
const { buildLifecycleDangerousCommandUtils } = require('../hooks/_runtime/lifecycle-dangerous-command.cjs')
const { classifyMemoryCoverage } = require('../hooks/_runtime/lifecycle-bootstrap-state.cjs')
const {
  assertGrokSingleTurnSkillRoute,
  launchGrok
} = require('./lib/grok-workspace-launcher.js')
const {
  buildPrivateTempOwnerRecord,
  classifyPrivateTempRecovery,
  validatePrivateTempOwnerRecord
} = require('../grok/plugins/devcodex-workspace/lib/private-temp-contract.cjs')

function projectTargetUtils() {
  return buildLifecycleProjectTargetUtils({
    fs: { readdirSync: () => [] },
    path,
    WORKSPACE_ROOT: process.cwd(),
    LAYOUT: { enabled: true },
    CONTEXT_PROJECT: '',
    DEFAULT_SCOPE: 'workspace',
    STICKY_PROJECT_TTL_MS: 60_000,
    EXECUTION_MODE: { CONFIRM: 'confirm', AUTO: 'auto' },
    MULTI_PROJECT_EXEMPTION_KEYWORDS: ['workspace', 'monorepo', '全工作区', 'all projects', '所有项目'],
    collectWorkspaceProjectNamespaces: () => [],
    resolveWorkspaceProjectTarget: (_root, name) => ({ namespace: name }),
    escapeRegExp: value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    collectProjectPayloadStrings: () => [],
    normalizeText: value => String(value || '').trim().toLowerCase(),
    readProfileMode: () => 'fix',
    readProjectProfileConfig: () => ({}),
    isStrictEnforcement: () => true
  })
}

const targets = projectTargetUtils()
assert.strictEqual(targets.resolveAutoAuthorization('不要进入 auto 模式', {}, {}).authorized, false)
assert.strictEqual(targets.resolveAutoAuthorization('请不要 @rocky 执行', {}, {}).authorized, false)
assert.strictEqual(targets.resolveAutoAuthorization('@rocky 继续', {}, {}).authorized, true)
assert.strictEqual(targets.hasMultiProjectExemption('不要扫描 workspace'), false)
assert.strictEqual(targets.hasMultiProjectExemption('请处理整个 workspace'), true)

const sticky = {}
assert.strictEqual(targets.detectExecutionMode({ prompt: '@rocky 继续', sessionId: '' }, sticky, {}), 'auto')
assert.strictEqual(sticky.stickyAuto.active, false, 'empty sessions must not create reusable sticky auto authority')
assert.strictEqual(targets.detectExecutionMode({ prompt: '继续', sessionId: '' }, sticky, {}), 'confirm')
assert.strictEqual(targets.detectExecutionMode({ prompt: '@rocky 继续', sessionId: 'session-a' }, sticky, {}), 'auto')
assert.strictEqual(targets.detectExecutionMode({ prompt: '继续', sessionId: 'session-a' }, sticky, {}), 'auto')
assert.strictEqual(targets.detectExecutionMode({ prompt: '继续', sessionId: 'session-b' }, sticky, {}), 'confirm')

const dangerUtils = buildLifecycleDangerousCommandUtils({
  path,
  crypto,
  CONTEXT_ROOT: path.resolve('context-root'),
  WORKSPACE_ROOT: path.resolve('workspace-root'),
  APPROVAL_TTL_MS: 60_000,
  DANGEROUS_PATTERNS: [{ re: /Remove-Item/i, reason: 'test danger' }],
  getToolName: payload => payload.tool_name,
  getCommandText: payload => payload.tool_input.command,
  INTERCEPTION_ACTION: { LOG_ONLY: 'log' },
  recordInterception: () => {}
})
const approvalState = { dangerousApprovals: {} }
const toolCwd = path.resolve('actual-tool-cwd')
const otherCwd = path.resolve('other-tool-cwd')
const firstDanger = dangerUtils.checkDangerousCommand({
  tool_name: 'shell_command',
  tool_input: { command: 'Remove-Item target', cwd: toolCwd }
}, 'codex')
assert.strictEqual(firstDanger.cwd, toolCwd)
const approvalId = dangerUtils.createDangerousApproval(approvalState, firstDanger)
dangerUtils.confirmDangerousApprovalsFromPrompt(
  approvalState,
  `yes devcodex-approve:${approvalId}`,
  'UserPromptSubmit',
  'codex'
)
const retryCommand = `Remove-Item target # devcodex-approve:${approvalId}`
const wrongDanger = dangerUtils.checkDangerousCommand({
  tool_name: 'shell_command',
  tool_input: { command: retryCommand, cwd: otherCwd }
}, 'codex')
assert.strictEqual(dangerUtils.consumeDangerousApproval(approvalState, wrongDanger).approved, false)
const exactDanger = dangerUtils.checkDangerousCommand({
  tool_name: 'shell_command',
  tool_input: { command: retryCommand, cwd: toolCwd }
}, 'codex')
assert.strictEqual(dangerUtils.consumeDangerousApproval(approvalState, exactDanger).approved, true)
assert.strictEqual(dangerUtils.consumeDangerousApproval(approvalState, exactDanger).approved, false)

assert.deepStrictEqual(classifyMemoryCoverage({ coverage: { status: 'complete' } }), {
  status: 'complete',
  complete: true,
  errorCode: null
})
assert.strictEqual(classifyMemoryCoverage({ coverage: { status: 'legacy-complete' } }).complete, true)
assert.deepStrictEqual(classifyMemoryCoverage({ coverage: { status: 'partial' } }), {
  status: 'partial',
  complete: false,
  errorCode: 'MEMORY_COVERAGE_PARTIAL'
})
assert.strictEqual(classifyMemoryCoverage({}).complete, false)

assert.throws(
  () => assertGrokSingleTurnSkillRoute({ promptCarrier: { digest: 'a' }, outcome: { active: false, errorCode: 'boom' } }),
  error => error.code === 'GROK_FULL_BOOTSTRAP_ERROR'
)
assert.throws(
  () => assertGrokSingleTurnSkillRoute({ promptCarrier: { digest: 'a' }, outcome: { active: false } }),
  error => error.code === 'GROK_FULL_BOOTSTRAP_INACTIVE'
)
assert.doesNotThrow(() => assertGrokSingleTurnSkillRoute({
  promptCarrier: { digest: 'a' },
  outcome: { active: true, injectionText: 'route' }
}))

let spawnCount = 0
assert.throws(() => launchGrok(['-p', 'test'], {
  buildGrokLaunchPlan: () => ({
    executable: 'grok',
    args: ['--rules', 'base', '-p', 'test'],
    cwd: process.cwd(),
    hostScope: { project: 'devcodex', ownerRoot: process.cwd(), workspaceRoot: process.cwd() },
    evidenceMode: 'fixture'
  }),
  bootstrapSkillRouteForTurn: () => ({ active: false, errorCode: 'fixture-error', injectionText: '' }),
  spawnSync: () => { spawnCount += 1; return { status: 0, signal: null } }
}), error => error.code === 'GROK_FULL_BOOTSTRAP_ERROR')
assert.strictEqual(spawnCount, 0)

const privateRoot = path.resolve('fixture-private-root')
const ownerId = '01234567-89ab-cdef-0123-456789abcdef'
const ownerRoot = path.join(privateRoot, 'owners', ownerId)
const ownerRecord = buildPrivateTempOwnerRecord({
  privateRoot,
  ownerRoot,
  snapshotPath: path.join(ownerRoot, 'prompt.txt'),
  ownerId,
  ownerToken: 'fixture-owner-token',
  promptDigest: 'fixture-prompt-digest',
  nowMs: 1_000,
  ttlMs: 1_000,
  pid: 4242,
  hostname: 'fixture-host'
})
assert.strictEqual(validatePrivateTempOwnerRecord(ownerRecord, privateRoot).valid, true)
assert.deepStrictEqual(
  classifyPrivateTempRecovery(ownerRecord, {
    privateRoot,
    nowMs: 2_001,
    hostname: 'fixture-host',
    kill: () => { const error = new Error('dead'); error.code = 'ESRCH'; throw error }
  }).reason,
  'expired-dead-owner'
)
assert.strictEqual(classifyPrivateTempRecovery(ownerRecord, {
  privateRoot,
  nowMs: 2_001,
  hostname: 'other-host'
}).recoverable, false)
assert.strictEqual(validatePrivateTempOwnerRecord({
  ...ownerRecord,
  snapshotPath: path.resolve(privateRoot, '..', 'escape.txt')
}, privateRoot).valid, false)

console.log('v1.17.8 batch A passed: authority, completeness, Grok fail-closed')
