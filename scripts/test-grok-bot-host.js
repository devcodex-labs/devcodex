#!/usr/bin/env node
'use strict'

// grok-bot host: identity registration + split-mode end-to-end through the CLI
// (turn-begin, independently spawned MCP servers bracketed by observe-tool,
// through memory_task_admit_v2).

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn, spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const CLI = path.join(ROOT, 'index.js')
const identity = require('../hooks/_runtime/host-adapter-identity.cjs')
const { normalizeAgent } = require('../mcp/agent-identity.cjs')
const adapters = require('../hooks/_runtime/lifecycle-host-adapters.cjs')
const capabilities = require('../hooks/_runtime/host-skill-route-capabilities.v1.json')

function staticChecks () {
  assert.strictEqual(identity.HOST_VARIANTS.grokbot, 'grok-bot/driver-synthesized-local-stdio')
  assert.strictEqual(identity.normalizeHostId('grok-bot'), 'grokbot')
  assert.strictEqual(identity.normalizeHostVariant('grok-bot'), 'grok-bot/driver-synthesized-local-stdio')
  assert.strictEqual(normalizeAgent('grok-bot'), 'grok')
  assert.ok(adapters.DRIVER_HOSTS['grok-bot'])
  const env = {}
  const driven = adapters.resolveDriverHost('grok-bot', { hook_event_name: 'SessionStart' }, env)
  assert.strictEqual(driven.host, 'grok')
  assert.strictEqual(driven.payload.devcodexEventProvenance, 'driver-synthesized')
  assert.strictEqual(env.DEVCODEX_AGENT, 'grok-bot')
  const entry = capabilities.capabilities.find(item => item.hostVariant === 'grok-bot/driver-synthesized-local-stdio')
  assert.ok(entry && entry.status === 'UNVERIFIED' && entry.defaultEligible === false)
  assert.strictEqual(driven.payload.devcodexExecutionSurface, 'grok-bot-driver')
  assert.strictEqual(env.DEVCODEX_HOST_VARIANT, 'grok-bot/driver-synthesized-local-stdio')
  const driver = require('./lib/grok-bot-driver.js')
  assert.strictEqual(driver.qualifiedToolName('profile_load'), 'devcodex-profile__profile_load')
  assert.strictEqual(driver.qualifiedToolName('memory_status'), 'devcodex-memory__memory_status')
  assert.strictEqual(driver.qualifiedToolName('skill_route'), 'devcodex-profile__skill_route')
  assert.strictEqual(driver.qualifiedToolName('Write'), 'Write')
  const scorecard = require('./lib/host-parity-scorecard.js')
  assert.strictEqual(scorecard.composeDriverHostEvidence({ env: {} }), null)
  assert.strictEqual(scorecard.composeDriverHostEvidence({ env: { DEVCODEX_AGENT: 'grok-bot' } }).status, 'WARN')
  const legacy = scorecard.composeEntryCheckBlock({ project: 'p' })
  assert.match(legacy, /\| PC5 [^|]*\| `UNVERIFIED` \|/)
  assert.match(legacy, /\| PC6 [^|]*\| `UNVERIFIED` \|/)
  const aie = require('../hooks/_runtime/actual-instruction-envelope.cjs')
  const mk = hostVariant => aie.buildActualInstructionEnvelope({ hook_event_name: 'UserPromptSubmit', prompt: 'fix it', session_id: 's1', turn_id: 't1', event_id: 'e1' }, { hostVariant, hostSessionId: 's1', trustedHostEvent: true, contextEpoch: 'ctx-1' })
  const driverEnvelope = mk('grok-bot/driver-synthesized-local-stdio')
  const nativeEnvelope = mk('codex/desktop')
  if (driverEnvelope && nativeEnvelope) {
    assert.strictEqual(driverEnvelope.provenanceLevel, 'driver-synthesized-host-event')
    assert.strictEqual(nativeEnvelope.provenanceLevel, 'trusted-host-event')
    assert.strictEqual(aie.isTrustedHostIngressEnvelope(driverEnvelope), true)
    assert.strictEqual(aie.validateActualInstructionEnvelope(driverEnvelope).valid, true)
    const forged = { ...nativeEnvelope, provenanceLevel: 'driver-synthesized-host-event' }
    assert.ok(aie.validateActualInstructionEnvelope(forged).errors.includes('driver-provenance-host-variant'))
    assert.strictEqual(aie.isTrustedHostIngressEnvelope(forged), false)
  }
  assert.strictEqual(aie.isTrustedHostIngressEnvelope({ provenanceLevel: 'driver-synthesized-host-event', hostVariant: 'codex/desktop' }), false)
  console.log('  ✓ grok-bot identity / adapter / capability registration')
}

function responseShapingChecks () {
  const { shapeToolResponse } = require('./lib/grok-bot-driver.js')
  const wrapped = shapeToolResponse('<cursor_untrusted_data_1337 source="CallDynamicTool">\n\n{\n  "schemaVersion": "X",\n  "ok": true\n}\ntrailing guidance\n</cursor_untrusted_data_1337>')
  assert.deepStrictEqual(wrapped.content.map(item => item.text), ['{\n  "schemaVersion": "X",\n  "ok": true\n}', 'trailing guidance'])
  assert.strictEqual(wrapped.isError, undefined)
  assert.strictEqual(shapeToolResponse('{"errorCode":"E"}').isError, true)
  assert.strictEqual(shapeToolResponse('<!-- profile_load_budget --> text').content[0].text, '<!-- profile_load_budget --> text')
  const passthrough = { content: [{ type: 'text', text: 'x' }], isError: true }
  assert.deepStrictEqual(shapeToolResponse(JSON.stringify(passthrough)), passthrough)
  console.log('  ✓ observe-tool response shaping strips host wrapper')
}

function sourceProfileTruthChecks () {
  const truth = require('./lib/devcodex-source-profile-truth.js')
  assert.strictEqual(truth.isDevCodexSourceRoot(ROOT), true)
  assert.strictEqual(truth.isDevCodexSourceRoot(os.tmpdir()), false)
  const untouched = { 'README.md': 'x' }
  assert.strictEqual(truth.augmentDevCodexSourceProfileContents(untouched, os.tmpdir()), untouched)
  const sha = 'a'.repeat(40)
  const evidence = {
    release: { tag_name: 'v' + require('../package.json').version, draft: false },
    publish: { id: 1, head_sha: sha, status: 'completed', conclusion: 'success' },
    ci: { id: 2, head_sha: sha, status: 'completed', conclusion: 'success' }
  }
  const out = truth.augmentDevCodexSourceProfileContents({ '01-项目信息.md': '# 01\n' }, ROOT, { evidence, candidateId: 'validation-candidate-' + 'b'.repeat(64), gitHead: 'c'.repeat(40) })
  const { parseProfileCurrentTruth, PROFILE_CURRENT_TRUTH_REF } = require('./lib/profile-current-truth')
  const parsed = parseProfileCurrentTruth(out['05-发布规范.md'], { required: true })
  assert.deepStrictEqual(parsed.errors, [])
  assert.strictEqual(parsed.record.releaseCommit, sha)
  assert.strictEqual(parsed.record.sourceCandidate.status, 'LOCAL_PENDING')
  assert.strictEqual(parsed.record.sourceCandidate.releaseAuthorized, false)
  for (const file of ['01-项目信息.md', '04-测试规范.md', '07-用户文档与契约规范.md']) {
    assert.strictEqual(out[file].split(PROFILE_CURRENT_TRUTH_REF).length - 1, 1, file)
  }
  const missing = truth.buildDevCodexSourceTruthRecord(ROOT, { evidence: {}, candidateId: 'validation-candidate-' + 'b'.repeat(64), gitHead: 'c'.repeat(40) })
  assert.strictEqual(missing.publishRun.status, 'UNVERIFIED')
  assert.strictEqual(missing.githubRelease.status, 'UNVERIFIED')
  console.log('  ✓ DevCodex source Profile truth is built only from observed evidence')
}

function cli (args, opts) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', maxBuffer: 64 << 20, ...opts })
  if (result.status !== 0) throw new Error(`devcodex ${args.slice(0, 2).join(' ')} failed (${result.status}): ${result.stderr || result.stdout}`)
  return result.stdout
}

function mcp (kind, projectDir, env) {
  const child = spawn(process.execPath, [path.join(ROOT, 'mcp', `${kind}-server.js`), projectDir], { cwd: projectDir, env, stdio: ['pipe', 'pipe', 'ignore'] })
  let buf = ''
  let id = 0
  const pending = new Map()
  child.stdout.on('data', d => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      try { const m = JSON.parse(line); const r = pending.get(m.id); if (r) { pending.delete(m.id); r(m) } } catch { }
    }
  })
  const req = (method, params) => new Promise(resolve => { const n = ++id; pending.set(n, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n') })
  return {
    init: async () => { await req('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'grok-bot-test', version: '1' } }); child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n') },
    call: async (name, args) => { const m = await req('tools/call', { name, arguments: args }); return m.result || {} },
    close: () => child.kill()
  }
}

function body (result) {
  if (result.structuredContent) return result.structuredContent
  try { return JSON.parse(result.content?.[0]?.text) } catch { return { text: result.content?.[0]?.text } }
}

async function splitModeE2E () {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-grok-bot-'))
  const ws = path.join(tmp, 'ws')
  const proj = path.join(ws, 'proj')
  fs.mkdirSync(proj, { recursive: true })
  fs.mkdirSync(path.join(tmp, 'home'))
  spawnSync('git', ['init', '-q'], { cwd: proj })
  fs.writeFileSync(path.join(proj, 'README.md'), '# proj\n')
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A'], { cwd: proj })
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init'], { cwd: proj })
  const env = { ...process.env, HOME: path.join(tmp, 'home'), USERPROFILE: path.join(tmp, 'home'), DEVCODEX_HOST_SESSION_ID: 'grok-bot-test-session', DEVCODEX_AGENT: 'grok-bot', DEVCODEX_HOST_PLATFORM: 'grok' }
  for (const key of ['GROK_HOME', 'CODEX_HOME', 'CLAUDE_CODE_VERSION', 'CURSOR_TRACE_ID']) delete env[key]
  cli(['init'], { cwd: ws, env })
  cli(['profile', 'init'], { cwd: proj, env })
  const prompt = '修复登录页面空指针'
  const begin = JSON.parse(cli(['grok-bot', 'turn-begin', proj, prompt], { cwd: proj, env }))
  assert.strictEqual(begin.provenance, 'driver-synthesized')
  assert.match(begin.contextEpoch, /^ctx-/)
  assert.match(begin.turnBinding, /^turn-/)
  assert.ok(begin.envelopeId && begin.semanticDecisionSourceRef)
  assert.strictEqual(begin.routeStatus, 'pending')
  assert.strictEqual(begin.skillRouteBootstrap.hostVariant, 'grok-bot/driver-synthesized-local-stdio')
  assert.strictEqual(begin.profileFreshness.status, 'fresh', JSON.stringify(begin.profileFreshness))
  const driverLib = require('./lib/grok-bot-driver.js')
  const truthFile = path.join(ws, '.devcodex', 'proj', 'profile', '99-truth-fixture.md')
  fs.writeFileSync(truthFile, '```json\n{"schemaVersion": "ProfileCurrentTruthV1", "gitHead": "0123456789abcdef0123456789abcdef01234567"}\n```\n')
  const drift = driverLib.profileFreshness(proj)
  assert.strictEqual(drift.status, 'stale')
  assert.strictEqual(drift.warnings[0].code, 'PROFILE_TRUTH_DRIFT')
  fs.rmSync(truthFile)
  console.log('  ✓ turn-begin reports Profile freshness and detects current-truth drift')
  console.log('  ✓ turn-begin yields contextEpoch / turnBinding / envelope')

  const servers = { 'devcodex-profile': mcp('profile', proj, env), 'devcodex-memory': mcp('memory', proj, env) }
  await servers['devcodex-profile'].init(); await servers['devcodex-memory'].init()
  let n = 0
  const call = async (server, tool, args) => {
    const id = `t-${++n}`
    const name = `${server}__${tool}`
    const argsFile = path.join(tmp, `${id}.args.json`)
    const responseFile = path.join(tmp, `${id}.response.txt`)
    fs.writeFileSync(argsFile, JSON.stringify(args))
    cli(['grok-bot', 'observe-tool', '--project-dir', proj, '--phase', 'pre', '--tool', name, '--args-file', argsFile, '--tool-use-id', id], { cwd: proj, env })
    const result = await servers[server].call(tool, args)
    // Simulate Grok Bot: the host shows only the text content inside an untrusted-data fence.
    fs.writeFileSync(responseFile, `<cursor_untrusted_data_1337 source="CallDynamicTool">\n\n${(result.content || []).map(item => item.text).join('\n')}\n</cursor_untrusted_data_1337>`)
    const post = JSON.parse(cli(['grok-bot', 'observe-tool', '--project-dir', proj, '--phase', 'post', '--tool', name, '--args-file', argsFile, '--response-file', responseFile, '--tool-use-id', id], { cwd: proj, env }))
    return { result, body: body(result), post }
  }
  try {
    const project = 'proj'
    const entryCheck = await call('devcodex-profile', 'profile_compose_entry_check', {
      project, status: 'UNVERIFIED', nextStep: 'profile_context_plan',
      entry: { prompt, locale: 'en_US.UTF-8', specRadar: 'Skills=fix-default; Profile=01-03', activeTask: 'none' }
    })
    assert.ok(!entryCheck.result.isError, JSON.stringify(entryCheck.body).slice(0, 500))
    const block = entryCheck.body.block
    for (let i = 0; i <= 10; i++) assert.match(block, new RegExp(`\\| PC${i} `))
    assert.match(block, /\| PC5 宿主 \| `WARN` \| Grok Bot 驱动档/)
    assert.doesNotMatch(block, /\| PC6 [^|]*\| `UNVERIFIED`/)
    assert.match(block, /\| PC6 工作区 \| `(PASS|WARN)` \| Git：分支=/)
    assert.match(block, /### DevCodex · 入口检查/)
    console.log('  ✓ profile_compose_entry_check reports grok-bot PC5 tier and observed PC6 git state')
    const plan = await call('devcodex-profile', 'profile_context_plan', {
      project, intent: 'fix', changeTypes: ['source-code'], contextEpoch: begin.contextEpoch, confidence: 0.9,
      semanticDecision: { schemaVersion: 'IntentSemanticDecisionV1', sourceRef: begin.semanticDecisionSourceRef, workflowFacts: { targetKnown: true }, executionDecision: 'confirm' }
    })
    assert.ok(!plan.result.isError, JSON.stringify(plan.body).slice(0, 500))
    assert.strictEqual(plan.post.routeStatus, 'selected')
    assert.ok(plan.post.ingressRef && plan.post.ingressRef.decisionDigest)
    console.log('  ✓ profile_context_plan + post observe-tool routes ingress (selected)')
    const contextBinding = plan.body.contextBinding
    const load = await call('devcodex-profile', 'profile_load', { project, contextBinding, files: plan.body.profile.selectedFiles })
    assert.ok(!load.result.isError, JSON.stringify(load.body).slice(0, 500))
    for (const q of plan.body.memory?.requiredQueries || []) {
      const r = await call('devcodex-memory', q, { project, contextBinding })
      assert.ok(!r.result.isError, `${q}: ${JSON.stringify(r.body).slice(0, 300)}`)
    }
    const boot = begin.skillRouteBootstrap
    let cursor; let page; const seen = []
    do {
      page = await call('devcodex-profile', 'skill_route', { op: 'catalog', project, turnBinding: boot.turnBinding, contextEpoch: boot.contextEpoch, ...(cursor ? { cursor } : {}) })
      assert.strictEqual(page.body.ok, true, JSON.stringify(page.body).slice(0, 300))
      seen.push(...page.body.receipt.cards.map(c => c.skillId))
      cursor = page.body.receipt.nextCursor
    } while (cursor && !seen.includes('fix-default'))
    const commit = await call('devcodex-profile', 'skill_route', { op: 'commit', project, turnBinding: boot.turnBinding, contextEpoch: boot.contextEpoch, catalogDigest: page.body.receipt.catalogDigest, skillId: 'fix-default', contextBinding })
    assert.strictEqual(commit.body.ok, true, JSON.stringify(commit.body).slice(0, 300))
    console.log('  ✓ profile_load / memory_status / skill_route catalog+commit')
    const admit = await call('devcodex-memory', 'memory_task_admit_v2', {
      operation: 'admit', project,
      // Malformed caller ref: server falls back to its own projection but must report it.
      ingressRef: { ...plan.post.ingressRef, decisionDigest: 'PLACEHOLDER' },
      task: { taskKind: 'bugs', entryVariant: 'fix', displayName: prompt }, overview: { content: prompt }
    })
    assert.ok(!admit.result.isError, JSON.stringify(admit.body).slice(0, 500))
    assert.strictEqual(admit.body.schemaVersion, 'FormalTaskAdmissionReceiptV2')
    assert.strictEqual(admit.body.status, 'active')
    assert.ok(admit.body.ingressWarnings.includes('TASK_ADMISSION_INGRESS_REF_INVALID'), JSON.stringify(admit.body.ingressWarnings))
    const lifecycleState = JSON.parse(fs.readFileSync(path.join(ws, '.devcodex', project, '.memory', 'hooks', project, '.sessions', 'grok-bot-test-session', 'lifecycle-state.json'), 'utf8'))
    const envelope = lifecycleState.actualInstructionEnvelope
    assert.strictEqual(envelope.hostVariant, 'grok-bot/driver-synthesized-local-stdio')
    assert.strictEqual(envelope.provenanceLevel, 'driver-synthesized-host-event')
    console.log('  ✓ memory_task_admit_v2 admitted', admit.body.taskRootRelative, 'with driver-synthesized-host-event provenance')
    const reportPath = `${admit.body.taskRootRelative}/reports/grok/20260101/01--验证报告.md`
    const closeout = await call('devcodex-memory', 'memory_turn_closeout_v1', {
      project, title: 'grok-bot e2e', intent: 'fix', sourceMessage: prompt,
      turn: { user: prompt, ai: '定位并修复空指针 | 已验证', status: 'completed' },
      sessionStatus: 'in-progress',
      notes: '关键决策：仅修改空指针分支',
      report: { targetPath: reportPath, content: '# 验证报告\n\n- ok\n' },
      summary: 'grok-bot e2e closeout'
    })
    assert.ok(!closeout.result.isError, JSON.stringify(closeout.body).slice(0, 800))
    assert.strictEqual(closeout.body.schemaVersion, 'MemoryTurnCloseoutReceiptV1')
    const activeRoot = path.join(ws, '.devcodex', project)
    assert.ok(fs.existsSync(path.join(activeRoot, reportPath)))
    const daily = fs.readFileSync(path.join(activeRoot, closeout.body.sessionWrite.file), 'utf8')
    assert.match(daily, /- \*\*状态\*\*：🔄 进行中/)
    assert.doesNotMatch(daily, /待补充内容/)
    assert.match(daily, /\| 1 \| 修复登录页面空指针 \| 定位并修复空指针 \\\| 已验证 \| ✅ \|/)
    assert.match(daily, /✅ \|\n\n关键决策：仅修改空指针分支/)
    assert.ok(closeout.body.summary && closeout.body.summary.ok)
    console.log('  ✓ memory_turn_closeout_v1 writes report + session row/status + SUMMARY in one call')

    // Regression: a task folder removed outside DevCodex must not poison the next admission
    // that omits ingressRef (stale TaskRecoveryBinding / bounded-resume state for a missing task).
    fs.rmSync(path.join(activeRoot, admit.body.taskRootRelative), { recursive: true, force: true })
    {
      // Any next tool event drops the orphaned TaskRecoveryBinding instead of rehydrating its ingress.
      const statePath = path.join(activeRoot, '.memory', 'hooks', project, '.sessions', 'grok-bot-test-session', 'lifecycle-state.json')
      const before = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      assert.ok(before.taskRecoveryBinding?.taskId, 'admission binds the task for recovery')
      const argsFile = path.join(proj, 'probe-args.json')
      fs.writeFileSync(argsFile, JSON.stringify({ project }))
      cli(['grok-bot', 'observe-tool', '--phase', 'pre', '--project-dir', proj, '--tool', 'memory_status', '--args-file', argsFile, '--tool-use-id', 'orphan-probe'], { cwd: proj, env })
      const after = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      assert.strictEqual(after.taskRecoveryBinding, null, JSON.stringify(after.lastResumeIngressRehydrate))
      assert.strictEqual(after.lastResumeIngressRehydrate?.reasonCode, 'task-root-missing')
      const { isTaskRecoveryBindingOrphaned } = require('../hooks/_runtime/task-recovery-store-v5.cjs')
      assert.strictEqual(isTaskRecoveryBindingOrphaned({ taskRoot: proj }), false)
      assert.strictEqual(isTaskRecoveryBindingOrphaned({ taskRoot: path.join(proj, 'nope') }), true)
      assert.strictEqual(isTaskRecoveryBindingOrphaned({ taskId: 'x' }), false)
    }
    const prompt2 = '修复分页 limit 为 0 的错误'
    const begin2 = JSON.parse(cli(['grok-bot', 'turn-begin', proj, prompt2], { cwd: proj, env }))
    const plan2 = await call('devcodex-profile', 'profile_context_plan', {
      project, intent: 'fix', changeTypes: ['source-code'], contextEpoch: begin2.contextEpoch, confidence: 0.9,
      semanticDecision: { schemaVersion: 'IntentSemanticDecisionV1', sourceRef: begin2.semanticDecisionSourceRef, workflowFacts: { targetKnown: true }, executionDecision: 'confirm' }
    })
    assert.strictEqual(plan2.post.routeStatus, 'selected', JSON.stringify(plan2.body).slice(0, 300))
    const binding2 = plan2.body.contextBinding
    await call('devcodex-profile', 'profile_load', { project, contextBinding: binding2, files: plan2.body.profile.selectedFiles })
    for (const q of plan2.body.memory?.requiredQueries || []) await call('devcodex-memory', q, { project, contextBinding: binding2 })
    const boot2 = begin2.skillRouteBootstrap
    let cursor2; let page2; const seen2 = []
    do {
      page2 = await call('devcodex-profile', 'skill_route', { op: 'catalog', project, turnBinding: boot2.turnBinding, contextEpoch: boot2.contextEpoch, ...(cursor2 ? { cursor: cursor2 } : {}) })
      seen2.push(...page2.body.receipt.cards.map(c => c.skillId))
      cursor2 = page2.body.receipt.nextCursor
    } while (cursor2 && !seen2.includes('fix-default'))
    await call('devcodex-profile', 'skill_route', { op: 'commit', project, turnBinding: boot2.turnBinding, contextEpoch: boot2.contextEpoch, catalogDigest: page2.body.receipt.catalogDigest, skillId: 'fix-default', contextBinding: binding2 })
    const admit2 = await call('devcodex-memory', 'memory_task_admit_v2', {
      operation: 'admit', project, task: { taskKind: 'bugs', entryVariant: 'fix', displayName: prompt2 }, overview: { content: prompt2 }
    })
    assert.ok(!admit2.result.isError, JSON.stringify(admit2.body).slice(0, 800))
    assert.strictEqual(admit2.body.status, 'active')
    console.log('  ✓ admission without ingressRef succeeds after the previous task folder was removed')

    // memory_turn_closeout_v1 terminal: sanctioned producer of ECR/completion evidence + fenced terminal.
    const terminalArgs = (n, terminalStatus, ecr) => ({
      project, title: `grok-bot terminal ${n}`, intent: 'fix', turn: { user: prompt2, ai: '验证终态收尾', status: 'completed' },
      sessionStatus: 'completed', report: { targetPath: `${admit2.body.taskRootRelative}/reports/grok/20260101/0${n}--收尾.md`, content: '# 收尾\n\n- 验证\n' },
      terminal: {
        taskId: admit2.body.taskId, terminalStatus,
        ecr: ecr || { summary: '验证终态收尾路径', checks: [{ item: 'grok-bot-host e2e', result: 'PASS' }] },
        completion: { items: [{ item: '终态收尾', status: '已交付' }] }
      }
    })
    const empty = await call('devcodex-memory', 'memory_turn_closeout_v1', terminalArgs(1, 'cancelled', { summary: '', checks: [] }))
    assert.strictEqual(empty.result.isError, true, 'empty ECR data is rejected')
    const noCp1 = await call('devcodex-memory', 'memory_turn_closeout_v1', terminalArgs(2, 'completed'))
    assert.strictEqual(noCp1.result.isError, true)
    assert.match(JSON.stringify(noCp1.body), /CP1|CP_CONFIRMATION/, 'completed still requires a verified CP1')
    await new Promise(resolve => setTimeout(resolve, 1100))
    const terminal = await call('devcodex-memory', 'memory_turn_closeout_v1', terminalArgs(3, 'cancelled'))
    assert.ok(!terminal.result.isError, JSON.stringify(terminal.body).slice(0, 1200))
    const closed = terminal.body.terminal
    assert.strictEqual(closed.schemaVersion, 'MemoryTaskCloseoutReceiptV1')
    assert.deepStrictEqual(closed.evidence.map(e => e.role), ['ecr', 'report', 'memory', 'completion'])
    const ecrText = fs.readFileSync(path.join(activeRoot, closed.evidence[0].path), 'utf8')
    assert.match(ecrText, /grok-bot-host e2e \| PASS/)
    assert.ok(ecrText.includes(closed.evidence[1].sha256), 'ECR cites the report digest')
    assert.ok(closed.terminal.receiptDigest, JSON.stringify(closed.terminal))
    console.log('  ✓ memory_turn_closeout_v1 terminal produces ECR/completion evidence and terminalizes the task')
  } finally {
    Object.values(servers).forEach(s => s.close())
    if (!process.env.DEVCODEX_KEEP_TEST_TMP) fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// Two Grok Bot conversations share one pair of connectors and one project. Each passes its own
// --session-id to the driver and hostSession to every connector call; lifecycle, recovery,
// admission and route state must stay partitioned per session.
async function concurrentSessionsE2E () {
  const hsp = require('../hooks/_runtime/host-session-partition.cjs')
  assert.deepStrictEqual(hsp.hostSessionPartitionSegments({ DEVCODEX_AGENT: 'codex', DEVCODEX_HOST_SESSION_ID: 'x' }), [], 'native hosts keep the per-project partition')
  assert.deepStrictEqual(hsp.hostSessionPartitionSegments({ DEVCODEX_AGENT: 'grok-bot', DEVCODEX_HOST_SESSION_ID: 's1' }), ['.sessions', 's1'])
  assert.throws(() => hsp.hostSessionPartitionSegments({ DEVCODEX_AGENT: 'grok-bot', DEVCODEX_HOST_SESSION_ID: '../x' }), /HOST_SESSION|session/i)
  const passthrough = () => 'same'
  assert.strictEqual(hsp.wrapDispatchWithHostSession(passthrough, { DEVCODEX_AGENT: 'claude' }), passthrough, 'non-driver hosts dispatch unchanged')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-grok-bot-sessions-'))
  const ws = path.join(tmp, 'ws')
  const proj = path.join(ws, 'proj')
  fs.mkdirSync(proj, { recursive: true })
  fs.mkdirSync(path.join(tmp, 'home'))
  spawnSync('git', ['init', '-q'], { cwd: proj })
  fs.writeFileSync(path.join(proj, 'README.md'), '# proj\n')
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A'], { cwd: proj })
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init'], { cwd: proj })
  // Connector process env carries only the shared default; sessions are selected per call.
  const env = { ...process.env, HOME: path.join(tmp, 'home'), USERPROFILE: path.join(tmp, 'home'), DEVCODEX_HOST_SESSION_ID: 'grok-bot-session', DEVCODEX_AGENT: 'grok-bot', DEVCODEX_HOST_PLATFORM: 'grok' }
  for (const key of ['GROK_HOME', 'CODEX_HOME', 'CLAUDE_CODE_VERSION', 'CURSOR_TRACE_ID']) delete env[key]
  cli(['init'], { cwd: ws, env })
  cli(['profile', 'init'], { cwd: proj, env })
  const servers = { 'devcodex-profile': mcp('profile', proj, env), 'devcodex-memory': mcp('memory', proj, env) }
  await servers['devcodex-profile'].init(); await servers['devcodex-memory'].init()
  const project = 'proj'
  const activeRoot = path.join(ws, '.devcodex', project)
  const statePath = session => path.join(activeRoot, '.memory', 'hooks', project, '.sessions', session, 'lifecycle-state.json')
  const readState = session => JSON.parse(fs.readFileSync(statePath(session), 'utf8'))
  let n = 0
  const call = async (session, server, tool, rawArgs) => {
    const args = { ...rawArgs, hostSession: session }
    const id = `${session}-${++n}`
    const argsFile = path.join(tmp, `${id}.args.json`)
    const responseFile = path.join(tmp, `${id}.response.txt`)
    fs.writeFileSync(argsFile, JSON.stringify(args))
    const name = `${server}__${tool}`
    cli(['grok-bot', 'observe-tool', '--session-id', session, '--project-dir', proj, '--phase', 'pre', '--tool', name, '--args-file', argsFile, '--tool-use-id', id], { cwd: proj, env })
    const result = await servers[server].call(tool, args)
    fs.writeFileSync(responseFile, (result.content || []).map(item => item.text).join('\n'))
    const post = JSON.parse(cli(['grok-bot', 'observe-tool', '--session-id', session, '--project-dir', proj, '--phase', 'post', '--tool', name, '--args-file', argsFile, '--response-file', responseFile, '--tool-use-id', id], { cwd: proj, env }))
    return { result, body: body(result), post }
  }
  const begin = (session, prompt) => JSON.parse(cli(['grok-bot', 'turn-begin', proj, prompt, '--session-id', session], { cwd: proj, env }))
  const plan = (session, b) => call(session, 'devcodex-profile', 'profile_context_plan', {
    project, intent: 'fix', changeTypes: ['source-code'], contextEpoch: b.contextEpoch, confidence: 0.9,
    semanticDecision: { schemaVersion: 'IntentSemanticDecisionV1', sourceRef: b.semanticDecisionSourceRef, workflowFacts: { targetKnown: true }, executionDecision: 'confirm' }
  })
  const routeAndAdmit = async (session, b, p, prompt) => {
    const binding = p.body.contextBinding
    await call(session, 'devcodex-profile', 'profile_load', { project, contextBinding: binding, files: p.body.profile.selectedFiles })
    for (const q of p.body.memory?.requiredQueries || []) await call(session, 'devcodex-memory', q, { project, contextBinding: binding })
    const boot = b.skillRouteBootstrap
    let cursor; let page; const seen = []
    do {
      page = await call(session, 'devcodex-profile', 'skill_route', { op: 'catalog', project, turnBinding: boot.turnBinding, contextEpoch: boot.contextEpoch, ...(cursor ? { cursor } : {}) })
      assert.strictEqual(page.body.ok, true, `${session}: ${JSON.stringify(page.body).slice(0, 300)}`)
      seen.push(...page.body.receipt.cards.map(c => c.skillId))
      cursor = page.body.receipt.nextCursor
    } while (cursor && !seen.includes('fix-default'))
    const commit = await call(session, 'devcodex-profile', 'skill_route', { op: 'commit', project, turnBinding: boot.turnBinding, contextEpoch: boot.contextEpoch, catalogDigest: page.body.receipt.catalogDigest, skillId: 'fix-default', contextBinding: binding })
    assert.strictEqual(commit.body.ok, true, `${session}: ${JSON.stringify(commit.body).slice(0, 300)}`)
    return call(session, 'devcodex-memory', 'memory_task_admit_v2', { operation: 'admit', project, task: { taskKind: 'bugs', entryVariant: 'fix', displayName: prompt }, overview: { content: prompt } })
  }
  try {
    const a = 'conv-a'; const b = 'conv-b'
    const promptA = '修复会话A的空指针'; const promptB = '修复会话B的越界'
    // Interleave: A begins, B begins, A plans, B plans, A admits, B admits.
    const beginA = begin(a, promptA)
    const beginB = begin(b, promptB)
    assert.strictEqual(beginA.sessionId, a); assert.strictEqual(beginB.sessionId, b)
    assert.notStrictEqual(beginA.contextEpoch, beginB.contextEpoch)
    assert.strictEqual(readState(a).contextAcquisition.contextEpoch, beginA.contextEpoch, 'B turn-begin must not clobber A')
    assert.strictEqual(readState(b).contextAcquisition.contextEpoch, beginB.contextEpoch)
    assert.ok(!fs.existsSync(path.join(activeRoot, '.memory', 'hooks', project, 'lifecycle-state.json')), 'no shared per-project state for driver sessions')
    const planA = await plan(a, beginA)
    const planB = await plan(b, beginB)
    assert.strictEqual(planA.post.routeStatus, 'selected', JSON.stringify(planA.body).slice(0, 300))
    assert.strictEqual(planB.post.routeStatus, 'selected', JSON.stringify(planB.body).slice(0, 300))
    // A's bound plan is not usable from session B.
    const crossLoad = await servers['devcodex-profile'].call('profile_load', { project, contextBinding: planA.body.contextBinding, files: planA.body.profile.selectedFiles, hostSession: b })
    assert.strictEqual(crossLoad.isError, true, 'session B cannot consume session A context binding')
    console.log('  ✓ two sessions interleave turn-begin / profile_context_plan on one project without clobbering')
    const admitA = await routeAndAdmit(a, beginA, planA, promptA)
    const admitB = await routeAndAdmit(b, beginB, planB, promptB)
    assert.ok(!admitA.result.isError, JSON.stringify(admitA.body).slice(0, 600))
    assert.ok(!admitB.result.isError, JSON.stringify(admitB.body).slice(0, 600))
    assert.notStrictEqual(admitA.body.taskId, admitB.body.taskId)
    assert.strictEqual(readState(a).taskRecoveryBinding?.taskId, admitA.body.taskId)
    assert.strictEqual(readState(b).taskRecoveryBinding?.taskId, admitB.body.taskId)
    console.log('  ✓ concurrent admissions keep per-session task recovery bindings')
    const closeArgs = (taskId, root) => ({
      project, title: 'session close', intent: 'fix', turn: { user: 'x', ai: 'y', status: 'completed' }, sessionStatus: 'completed',
      report: { targetPath: `${root}/reports/grok/20260101/01--close.md`, content: '# close\n' },
      terminal: { taskId, terminalStatus: 'cancelled', ecr: { summary: 'session isolation', checks: [{ item: 'isolation', result: 'PASS' }] }, completion: { items: [{ item: 'isolation', status: 'done' }] } }
    })
    const cross = await call(b, 'devcodex-memory', 'memory_turn_closeout_v1', closeArgs(admitA.body.taskId, admitA.body.taskRootRelative))
    assert.strictEqual(cross.result.isError, true, 'session B must not terminalize session A task')
    assert.match(JSON.stringify(cross.body), /TASK_WRITE_OWNER|TASK_BINDING_REQUIRED|owner/i)
    const own = await call(a, 'devcodex-memory', 'memory_turn_closeout_v1', closeArgs(admitA.body.taskId, admitA.body.taskRootRelative))
    assert.ok(!own.result.isError, JSON.stringify(own.body).slice(0, 800))
    assert.strictEqual(readState(b).taskRecoveryBinding?.taskId, admitB.body.taskId, 'closing A leaves B bound')
    console.log('  ✓ task recovery / terminal close do not cross sessions')
    // Strict identity: invalid hostSession is rejected; driver refuses a bracket/args session mismatch.
    const bad = await servers['devcodex-memory'].call('memory_status', { project, hostSession: '../a' })
    assert.strictEqual(bad.isError, true)
    assert.match(JSON.stringify(bad), /HOST_SESSION_INVALID/)
    const mismatchFile = path.join(tmp, 'mismatch.json')
    fs.writeFileSync(mismatchFile, JSON.stringify({ project, hostSession: a }))
    const mismatch = spawnSync(process.execPath, [CLI, 'grok-bot', 'observe-tool', '--session-id', b, '--project-dir', proj, '--phase', 'pre', '--tool', 'devcodex-memory__memory_status', '--args-file', mismatchFile, '--tool-use-id', 'mm'], { cwd: proj, env, encoding: 'utf8' })
    assert.match(mismatch.stderr + mismatch.stdout, /GROK_BOT_HOST_SESSION_MISMATCH/)
    fs.writeFileSync(mismatchFile, JSON.stringify({ project }))
    const missing = spawnSync(process.execPath, [CLI, 'grok-bot', 'observe-tool', '--session-id', b, '--project-dir', proj, '--phase', 'pre', '--tool', 'devcodex-memory__memory_status', '--args-file', mismatchFile, '--tool-use-id', 'mm2'], { cwd: proj, env, encoding: 'utf8' })
    assert.match(missing.stderr + missing.stdout, /GROK_BOT_HOST_SESSION_REQUIRED/)
    console.log('  ✓ hostSession is validated per call and must match the driver bracket session')
  } finally {
    Object.values(servers).forEach(s => s.close())
    if (!process.env.DEVCODEX_KEEP_TEST_TMP) fs.rmSync(tmp, { recursive: true, force: true })
  }
}

;(async () => {
  staticChecks()
  responseShapingChecks()
  sourceProfileTruthChecks()
  await splitModeE2E()
  await concurrentSessionsE2E()
  console.log('grok-bot host tests passed')
})().catch(error => { console.error(error); process.exit(1) })
