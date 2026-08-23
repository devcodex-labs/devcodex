'use strict'

/**
 * Hook-level replay matrix for Stop completion gate (R-T3 / R-T5 / R-T6).
 * Uses deployed Grok lifecycle when present; falls back to package source.
 * Isolated temp cwd — no workspace skills.
 *
 * Usage: node scripts/replay-stop-gate-hook-matrix.js
 */

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')
const {
  updateLifecycleStateCommit
} = require('../hooks/_runtime/lifecycle-state-commit.cjs')

const tempRoots = []

function makeTempRoot (prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

function cleanupTempRoots () {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true })
}

process.once('exit', cleanupTempRoots)

const packageRoot = path.resolve(__dirname, '..')
const packageLifecycle = path.join(packageRoot, 'hooks', '_runtime', 'lifecycle.cjs')
const deployedLifecycle = path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  '.grok',
  'devcodex',
  'runtime',
  'hooks',
  '_runtime',
  'lifecycle.cjs'
)
// Prefer package source so local fixes are tested; set DEVCODEX_REPLAY_USE_DEPLOYED=1 for deployed runtime.
const lifecycle = process.env.DEVCODEX_REPLAY_USE_DEPLOYED === '1' && fs.existsSync(deployedLifecycle)
  ? deployedLifecycle
  : packageLifecycle

const FULL_ENTRY = [
  '### DevCodex · 入口检查',
  '- PC0 [PASS] Context plan',
  '- PC1 [PASS] Intent',
  '- PC2 [PASS] Session',
  '- PC3 [PASS] Project',
  '- PC4 [N/A] skipReason=non-dev',
  '- PC5 [PASS] Host',
  '- PC6 [PASS] Git',
  '- PC7 [PASS] Next'
].join('\n')

const FINAL_VALIDATION_GOOD = [
  '#### 验证摘要',
  '| 类型 | 命令 | exitCode | runId/计数 |',
  '| 权威 | `npm run test:visible-output` | exitCode 0 | runId=validation-202607230001 / checks=42 |',
  'WorkspaceSyncStatus: skipped (无需同步)',
  'dirty boundary: git status clean; no unrelated dirty',
  'Release actions: push/tag/release/publish 未执行'
].join('\n')

// Match scripts/test-visible-output-contract.js finalValidationGood (verified-present)
const COMPLETE_BODY = [
  FULL_ENTRY,
  '',
  '### DevCodex · 完成检查',
  '| 类型 | 命令 | exitCode | runId/计数 |',
  '| 权威 | `npm run test:visible-output` | exitCode 0 | runId=validation-202607230001 / checks=42 |',
  'WorkspaceSyncStatus: skipped (无需同步)',
  'dirty boundary: git status clean; no unrelated dirty',
  'Release actions: push/tag/release/publish 未执行',
  '`DevCodexVisibleEnvelopeV1 · completion-check · PASS · ' + 'c'.repeat(64) + '`',
  '',
  '阶段报告: reports/requirements/grok/20260723/01--stop-gate-replay.md',
  '## ECR 执行闭环复审',
  '| DoD | 结果 |',
  '| D1 | ✅ |',
  '| ECR-1 | ✅ |',
  '工作已完成并收口。'
].join('\n')

const INCOMPLETE_BODY =
  '任务已完成、已收口。All work is complete. 无需入口检查。'

function makeEnv (sessionTag) {
  return {
    ...process.env,
    DEVCODEX_HOST_PLATFORM: 'grok',
    GROK_HOME: path.join(process.env.USERPROFILE || process.env.HOME || '', '.grok'),
    GROK_SESSION_ID: sessionTag,
    GROK_BUILD: '1'
  }
}

function runLifecycle (cwd, env, payload) {
  const r = spawnSync(process.execPath, [lifecycle], {
    cwd,
    env,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 4 * 1024 * 1024
  })
  let json = null
  try {
    json = JSON.parse(String(r.stdout || '').trim() || '{}')
  } catch {
    json = null
  }
  return {
    status: r.status,
    stdout: String(r.stdout || ''),
    stderr: String(r.stderr || ''),
    json
  }
}

function touchMutation (cwd, env, name) {
  const tmp = path.join(cwd, name)
  fs.writeFileSync(tmp, 'replay-only\n', 'utf8')
  return runLifecycle(cwd, env, {
    hookEventName: 'PostToolUse',
    tool_name: 'create_file',
    tool_input: { path: tmp, content: 'replay-only' },
    cwd
  })
}

function isolateStopCompletionGate (cwd, env) {
  const statePath = path.join(cwd, '.devcodex', '.memory', 'hooks', 'legacy', 'lifecycle-state.json')
  if (!fs.existsSync(statePath)) {
    throw new Error(`Stop completion fixture state is missing: ${statePath}`)
  }
  // This replay owns the Stop completion gate only. A deliberately unfinished
  // progressive route has its own lifecycle matrix and would otherwise replace
  // the completion decision with the correct route-recovery decision.
  const commit = updateLifecycleStateCommit({
    metaDir: path.dirname(statePath),
    identity: { sessionKey: env.GROK_SESSION_ID },
    readFallback: () => JSON.parse(fs.readFileSync(statePath, 'utf8'))
  }, state => {
    state.contextAcquisition = {
      ...(state.contextAcquisition || {}),
      contextEpoch: ''
    }
    return state
  }, { fs })
  if (commit.status !== 'committed') {
    throw new Error(`Stop completion fixture isolation failed: ${commit.errorCode || commit.status}`)
  }
  fs.writeFileSync(statePath, JSON.stringify(commit.state, null, 2) + '\n', 'utf8')
}

function readHonesty (cwd) {
  const statePath = path.join(cwd, '.devcodex', '.memory', 'hooks', 'legacy', 'lifecycle-state.json')
  if (!fs.existsSync(statePath)) return null
  try {
    const st = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    return {
      mutated: !!st.mutated,
      reportTouched: !!st.reportTouched,
      memoryTouched: !!st.memoryTouched,
      mode: st.mode,
      honesty: st.enforcementHonesty || null
    }
  } catch {
    return null
  }
}

function classifyStop (json) {
  if (!json || typeof json !== 'object') return 'unknown'
  if (json.decision === 'block') return 'block'
  if (json.decision === 'allow') return 'allow'
  if (json.continue === true && !json.decision) return 'soft-or-allow'
  return 'other'
}

function scenarioRt5 () {
  const cwd = makeTempRoot('devcodex-rt5-')
  fs.writeFileSync(path.join(cwd, 'README.md'), 'rt5-chat\n', 'utf8')
  const env = makeEnv('rt5-' + Date.now())
  runLifecycle(cwd, env, {
    hookEventName: 'UserPromptSubmit',
    prompt: '今天天气怎样，只闲聊，不要写任何文件',
    cwd
  })
  isolateStopCompletionGate(cwd, env)
  // no mutation
  const stop = runLifecycle(cwd, env, {
    hookEventName: 'Stop',
    lastAssistantMessage: '今天天气不错，适合散步。纯闲聊，无代码变更。',
    stopHookActive: false,
    cwd
  })
  const kind = classifyStop(stop.json)
  const state = readHonesty(cwd)
  const pass =
    kind !== 'block' &&
    !/Stop gate: incomplete/i.test(String(stop.json?.reason || ''))
  return {
    id: 'R-T5',
    pass,
    kind,
    decision: stop.json?.decision || null,
    reason: stop.json?.reason || stop.json?.systemMessage || '',
    state,
    cwd
  }
}

function scenarioRt3 () {
  const cwd = makeTempRoot('devcodex-rt3-')
  fs.writeFileSync(path.join(cwd, 'README.md'), 'rt3\n', 'utf8')
  const env = makeEnv('rt3-' + Date.now())
  runLifecycle(cwd, env, {
    hookEventName: 'UserPromptSubmit',
    prompt: 'write tmp then claim complete without entry check',
    cwd
  })
  isolateStopCompletionGate(cwd, env)
  touchMutation(cwd, env, '_replay_stop_gate_tmp.txt')
  const stop = runLifecycle(cwd, env, {
    hookEventName: 'Stop',
    lastAssistantMessage: INCOMPLETE_BODY,
    stopHookActive: false,
    cwd
  })
  const kind = classifyStop(stop.json)
  const reason = String(stop.json?.reason || '')
  const pass =
    kind === 'block' &&
    /Stop gate|incomplete|entry-check/i.test(reason)
  // F-13: adapter must preserve block
  const { adaptHostOutput } = require('../hooks/_runtime/lifecycle-host-adapters.cjs')
  if (pass && stop.json) {
    const adapted = adaptHostOutput('grok', 'Stop', stop.json)
    if (adapted.decision !== 'block') {
      return { id: 'R-T3', pass: false, kind, decision: adapted.decision, reason: 'adapter-stripped-block', state: readHonesty(cwd), cwd }
    }
  }
  return {
    id: 'R-T3',
    pass,
    kind,
    decision: stop.json?.decision || null,
    reason,
    state: readHonesty(cwd),
    cwd
  }
}

function scenarioRt6 () {
  const cwd = makeTempRoot('devcodex-rt6-')
  fs.writeFileSync(path.join(cwd, 'README.md'), 'rt6\n', 'utf8')
  // Minimal product artifact paths so report/memory touches can fire if tool paths hit them
  const reportDir = path.join(cwd, '.devcodex', 'reports', 'analysis', 'grok', '20260726')
  const memDir = path.join(cwd, '.devcodex', '.memory')
  fs.mkdirSync(reportDir, { recursive: true })
  fs.mkdirSync(memDir, { recursive: true })
  const reportFile = path.join(reportDir, '01--rt6.md')
  const sessionsFile = path.join(memDir, 'sessions.md')
  fs.writeFileSync(reportFile, '# rt6 report\n', 'utf8')
  fs.writeFileSync(sessionsFile, '# sessions\n', 'utf8')

  const env = makeEnv('rt6-' + Date.now())
  runLifecycle(cwd, env, {
    hookEventName: 'UserPromptSubmit',
    prompt: 'mutate then complete with full entry and FVS',
    cwd
  })
  isolateStopCompletionGate(cwd, env)
  touchMutation(cwd, env, '_rt6_src.txt')
  // mark report + memory touched via product-like tool paths
  runLifecycle(cwd, env, {
    hookEventName: 'PostToolUse',
    tool_name: 'create_file',
    tool_input: { path: reportFile, content: '# rt6 report\n' },
    cwd
  })
  runLifecycle(cwd, env, {
    hookEventName: 'PostToolUse',
    tool_name: 'create_file',
    tool_input: { path: sessionsFile, content: '# sessions\n' },
    cwd
  })

  const stop = runLifecycle(cwd, env, {
    hookEventName: 'Stop',
    lastAssistantMessage: COMPLETE_BODY,
    stopHookActive: false,
    cwd
  })
  const kind = classifyStop(stop.json)
  const reason = String(stop.json?.reason || stop.json?.systemMessage || '')
  // Expect no completion-gate hard block (allow or soft-only reminder ok)
  const hardCompletionBlock =
    kind === 'block' && /Stop gate: incomplete/i.test(reason)
  const pass = !hardCompletionBlock
  return {
    id: 'R-T6',
    pass,
    kind,
    decision: stop.json?.decision || null,
    reason: reason.slice(0, 400),
    state: readHonesty(cwd),
    cwd
  }
}

function main () {
  console.log('lifecycle:', lifecycle)
  const results = [scenarioRt5(), scenarioRt3(), scenarioRt6()]
  let failed = 0
  for (const r of results) {
    const mark = r.pass ? 'PASS' : 'FAIL'
    if (!r.pass) failed += 1
    console.log(`\n=== ${r.id} ${mark} ===`)
    console.log('kind:', r.kind, 'decision:', r.decision)
    console.log('reason:', String(r.reason || '').slice(0, 280))
    console.log('state:', JSON.stringify(r.state))
    console.log('cwd:', r.cwd)
  }
  console.log('\n=== SUMMARY ===')
  console.log(
    results.map(r => `${r.id}:${r.pass ? 'PASS' : 'FAIL'}`).join(' ')
  )
  cleanupTempRoots()
  const leakedRoots = tempRoots.filter(root => fs.existsSync(root))
  if (leakedRoots.length > 0) {
    failed += 1
    console.error('temp cleanup failed:', leakedRoots.join(', '))
  } else {
    console.log('tempCleanup=1')
  }
  process.exitCode = failed ? 1 : 0
}

main()
