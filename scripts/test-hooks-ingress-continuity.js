'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const os = require('os')
const { spawnSync } = require('child_process')
const assert = require('assert')
if (process.argv.includes('--all')) {
  for (const variant of ['same-session', 'foreign-session', 'semantic']) {
    const child = spawnSync(process.execPath, [__filename, `--variant=${variant}`], {
      cwd: path.resolve(__dirname, '..'), env: process.env, stdio: 'inherit',
      windowsHide: true, timeout: 180000
    })
    if (child.error || child.status !== 0) {
      if (child.error) console.error(child.error.message)
      process.exit(child.status || 1)
    }
  }
  process.exit(0)
}
const variant = process.argv.find(arg => arg.startsWith('--variant='))?.slice(10) || 'same-session'
const repo = path.resolve(__dirname, '..')
const ownedBase = path.resolve(os.tmpdir())
const root = path.join(ownedBase, `r3-ingress-${crypto.randomUUID()}`)
if (!root.startsWith(ownedBase + path.sep) || fs.existsSync(root)) throw new Error('owned fixture boundary invalid')
for (const key of Object.keys(process.env)) {
  if (key.startsWith('DEVCODEX_')) delete process.env[key]
}
process.env.DEVCODEX_TEST_KEEP_TEMP = '1'
process.env.R3_FIXTURE_CLOCK_OFFSET_MS = '0'
const fixture = require(path.join(repo, 'scripts/lib/test-hooks-runtime-fixtures')).buildTestHooksRuntimeFixtures({
  fs, path, process, spawnSync,
  RUNTIME: path.join(repo, 'hooks/_runtime/lifecycle.cjs'),
  PROFILE_SERVER: path.join(repo, 'mcp/profile-server.js'),
  TEMP_ROOT: root,
  STATE_FILE: path.join(root, '.devcodex/.memory/hooks/legacy/lifecycle-state.json'),
  TEST_AGENT: 'codex'
})
fixture.cleanLayoutMultiProjectState()
const clockFile = path.join(root, 'fixture-clock.cjs')
fs.writeFileSync(clockFile, `const NativeDate = Date\nclass FixtureDate extends NativeDate {\n  constructor(...args) { super(...(args.length ? args : [FixtureDate.now()])) }\n  static now() { return NativeDate.now() + Number(process.env.R3_FIXTURE_CLOCK_OFFSET_MS || 0) }\n}\nglobal.Date = FixtureDate\n`)
process.env.NODE_OPTIONS = `--require ${JSON.stringify(clockFile)}`
const profileRoot = path.join(root, '.devcodex/devcodex/profile')
fs.writeFileSync(path.join(profileRoot, 'README.md'), '# Probe Profile\n\n> Profile 档位：`profile-lite`。\n\n| 文件 | 说明 | 必须 |\n|---|---|---|\n| `01-项目信息.md` | project | 是 |\n| `02-架构约束.md` | architecture | 是 |\n| `03-代码风格.md` | code | 是 |\n')
for (const name of ['01-项目信息.md', '02-架构约束.md', '03-代码风格.md']) {
  fs.writeFileSync(path.join(profileRoot, name), `# ${name}\n\nIsolated ingress replay fixture.\n`)
}
let session = `isolated-r3-${crypto.randomUUID()}`
const stateFile = fixture.getLayoutStateFile('devcodex')
const read = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'))
const project = path.join(root, 'devcodex')
const steps = []
let turnEpoch = ''
const workspaceStateFile = fixture.getWorkspaceLayoutStateFile()
const readWorkspace = () => JSON.parse(fs.readFileSync(workspaceStateFile, 'utf8'))
const run = payload => fixture.run({ ...payload, session_id: session }, root, { DEVCODEX_HOST_PLATFORM: 'codex' })
const observe = label => {
  const state = fs.existsSync(stateFile) ? read() : {}
  const row = { label, contextEpoch: state.contextAcquisition?.contextEpoch,
    envelopeEpoch: state.actualInstructionEnvelope?.contextEpoch,
    envelopeDigest: state.actualInstructionEnvelope?.envelopeDigest,
    route: state.workflowRouteDecision?.routeKey, error: state.workflowIngressError?.errorCode }
  const workspace = fs.existsSync(workspaceStateFile) ? readWorkspace() : {}
  row.workspaceEpoch = workspace.contextAcquisition?.contextEpoch
  row.workspaceEnvelopeEpoch = workspace.actualInstructionEnvelope?.contextEpoch
  row.workspaceProject = workspace.activeProject
  steps.push(row)
  return state
}
const plan = (id, routeKey) => {
  const args = { intent: 'dev', project: 'devcodex', scope: 'project', contextEpoch: turnEpoch,
    host: 'codex', routeKey, subtype: routeKey.split('.')[1], stage: 'entry', changeTypes: ['architecture', 'source-code'] }
  if (variant === 'semantic') {
    const envelope = readWorkspace().actualInstructionEnvelope
    args.semanticDecision = {
      schemaVersion: 'IntentSemanticDecisionV1',
      sourceRef: { envelopeId: envelope.envelopeId, envelopeDigest: envelope.envelopeDigest, contextEpoch: turnEpoch },
      workflowPreference: { ceremonyTier: 'standard', designDepth: 'standard', assuranceLevel: 'affected' },
      executionDecision: id === 'first-plan' ? 'enable-auto' : 'retain-current',
      validationDecision: { action: id === 'first-plan' ? 'none' : 'revoke' },
      languageDecision: { replyLocale: 'zh-CN', scope: 'task', kind: id === 'first-plan' ? 'explicit' : 'retain' }
    }
    const before = fs.readFileSync(workspaceStateFile)
    const rejected = fixture.callProfileTool(root, 'profile_context_plan', {
      ...args,
      semanticDecision: { ...args.semanticDecision,
        sourceRef: { ...args.semanticDecision.sourceRef, envelopeDigest: '0'.repeat(64) } }
    })
    assert.strictEqual(rejected.isError, true, 'wrong instruction source must be rejected')
    assert.deepStrictEqual(fs.readFileSync(workspaceStateFile), before, 'rejected semantic input has no ingress effects')
  }
  run({ hookEventName: 'PreToolUse', tool_use_id: id, tool_name: 'devcodex-profile/profile_context_plan', tool_input: args })
  const result = fixture.callProfileTool(root, 'profile_context_plan', args)
  fs.writeFileSync(path.join(root, id + '.json'), JSON.stringify(result, null, 2) + '\n')
  if (result.isError) throw new Error('fixture plan failed: ' + result.content[0].text)
  run({ hookEventName: 'PostToolUse', tool_use_id: id, tool_name: 'devcodex-profile/profile_context_plan', tool_input: args, tool_response: result })
  observe(id)
  if (variant === 'semantic') {
    const state = read()
    assert.strictEqual(state.languageContext.responseLanguage, 'zh-CN')
    assert.strictEqual(state.languageContext.durablePrimaryLocale, 'zh-CN')
    assert.strictEqual(state.workflowPlanDecision.axes.ceremonyTier.value, 'standard')
    assert.strictEqual(state.validationControlIngressError, null)
    assert.strictEqual(state.validationControlIngressIntent?.action || state.validationControlIngress?.action,
      id === 'first-plan' ? 'auto-authorize' : 'revoke')
    if (id === 'first-plan') assert.strictEqual(state.executionMode, 'auto')
  }
}
try {
  run({ hookEventName: 'UserPromptSubmit', prompt: '分析当前 devcodex 项目的接口，不修改文件。' })
  turnEpoch = readWorkspace().contextAcquisition.contextEpoch
  observe('first-prompt')
  run({ hookEventName: 'PreToolUse', tool_use_id: 'r3-read-1', tool_name: 'Read', tool_input: { file_path: path.join(project, 'package.json') } })
  run({ hookEventName: 'PostToolUse', tool_use_id: 'r3-read-1', tool_name: 'Read', tool_input: { file_path: path.join(project, 'package.json') }, tool_response: { ok: true } })
  observe('first-read')
  plan('first-plan', 'dev.docs')
  // Advance only child fixture clocks. Existing envelopes, leases, snapshots
  // and their digests are left byte-for-byte intact.
  process.env.R3_FIXTURE_CLOCK_OFFSET_MS = String(31 * 60 * 1000)
  run({ hookEventName: 'UserPromptSubmit', prompt: '继续按已确认范围自动推进至版本发布' })
  turnEpoch = readWorkspace().contextAcquisition.contextEpoch
  observe('second-prompt')
  const expectedEnvelopeDigest = readWorkspace().actualInstructionEnvelope.envelopeDigest
  if (variant === 'foreign-session') session = `foreign-r3-${crypto.randomUUID()}`
  run({ hookEventName: 'PreToolUse', tool_use_id: 'r3-read-2', tool_name: 'Read', tool_input: { file_path: path.join(project, 'package.json') } })
  run({ hookEventName: 'PostToolUse', tool_use_id: 'r3-read-2', tool_name: 'Read', tool_input: { file_path: path.join(project, 'package.json') }, tool_response: { ok: true } })
  observe('second-read')
  if (variant === 'foreign-session') {
    assert.notStrictEqual(readWorkspace().actualInstructionEnvelope?.envelopeDigest, expectedEnvelopeDigest,
      'another session must not acquire this turn ingress')
  } else {
    assert.strictEqual(readWorkspace().contextAcquisition.contextEpoch, turnEpoch,
      'ordinary reads must preserve the current workspace turn')
    assert.strictEqual(readWorkspace().actualInstructionEnvelope.envelopeDigest, expectedEnvelopeDigest)
    plan('second-plan', 'dev.default')
    assert.strictEqual(read().actualInstructionEnvelope.contextEpoch, turnEpoch)
    assert.strictEqual(read().actualInstructionEnvelope.envelopeDigest, expectedEnvelopeDigest)
    assert.strictEqual(read().workflowRouteDecision.routeKey, 'dev.default')
  }
} catch (error) {
  steps.push({ error: error.stack })
  process.exitCode = 1
} finally {
  const output = { root, repo, variant, passed: !process.exitCode, steps, retained: true, authoritative: false }
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(output, null, 2) + '\n')
  process.stdout.write(JSON.stringify({ root, variant, passed: output.passed, evidence: path.join(root, 'result.json') }) + '\n')
}
