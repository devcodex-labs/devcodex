'use strict'
/** Real-cwd acceptance: mode=dev + lastAssistantMessage completion-check recognition (F-03/F-14). */
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const lifecycle = path.join(__dirname, '../hooks/_runtime/lifecycle.cjs')
const cwd = path.resolve(__dirname, '..')
const statePath = path.join(
  path.dirname(cwd),
  '.devcodex',
  'devcodex-v1',
  '.memory',
  'hooks',
  'devcodex-v1',
  'lifecycle-state.json'
)
const env = {
  ...process.env,
  DEVCODEX_HOST_PLATFORM: 'grok',
  GROK_BUILD: '1',
  GROK_HOME: path.join(process.env.USERPROFILE || '', '.grok')
}

function run (payload) {
  const r = spawnSync(process.execPath, [lifecycle], {
    cwd,
    env,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 60000
  })
  try {
    return JSON.parse(String(r.stdout || '').trim() || '{}')
  } catch {
    return { _raw: r.stdout, _err: r.stderr }
  }
}

run({
  hookEventName: 'UserPromptSubmit',
  prompt: 'mode dev completion acceptance',
  cwd: cwd.replace(/\\/g, '/')
})
const tmp = path.join(cwd, '_mode_probe_tmp.txt')
fs.writeFileSync(tmp, 'x\n')
run({
  hookEventName: 'PostToolUse',
  tool_name: 'create_file',
  tool_input: { path: tmp, content: 'x' },
  cwd: cwd.replace(/\\/g, '/')
})

const body = [
  '### DevCodex · 入口检查',
  '- PC0 [PASS]',
  '- PC1 [PASS]',
  '- PC2 [PASS]',
  '- PC3 [PASS]',
  '- PC4 [N/A] skipReason=probe',
  '- PC5 [PASS]',
  '- PC6 [PASS]',
  '- PC7 [PASS]',
  '',
  '### DevCodex · 完成检查',
  '| 类型 | 命令 | exitCode | runId/计数 |',
  '| 权威 | `npm run test:visible-output` | exitCode 0 | runId=validation-202607230001 / checks=42 |',
  'WorkspaceSyncStatus: skipped (无需同步)',
  'dirty boundary: git status clean; no unrelated dirty',
  'Release actions: push/tag/release/publish 未执行',
  '`DevCodexVisibleEnvelopeV1 · completion-check · PASS · ' + 'c'.repeat(64) + '`',
  '报告: N/A',
  '记忆: N/A',
  'skipReason: probe'
].join('\n')

const stop = run({
  hookEventName: 'Stop',
  lastAssistantMessage: body,
  stopHookActive: false,
  cwd: cwd.replace(/\\/g, '/')
})

const st = JSON.parse(fs.readFileSync(statePath, 'utf8'))
const summary = {
  stopDecision: stop.decision || null,
  mode: st.mode,
  replyEvidence: st.visible?.replyEvidence,
  replySource: st.visible?.replySource,
  compliance: st.visible?.compliance,
  precheckStatus: st.visible?.precheckStatus,
  fvs: st.visible?.finalValidationSummaryStatus,
  gaps: st.enforcementHonesty?.processGaps || []
}
console.log(JSON.stringify(summary, null, 2))

const ok =
  summary.mode === 'dev' &&
  summary.replyEvidence === 'verified-present' &&
  summary.replySource === 'lastAssistantMessage' &&
  summary.compliance === true &&
  summary.stopDecision !== 'block'

if (!ok) {
  console.error('ACCEPTANCE_FAIL')
  process.exitCode = 1
} else {
  console.log('ACCEPTANCE_PASS mode=dev lastAssistantMessage completion-check recognized')
}

try { fs.unlinkSync(tmp) } catch { /* ignore */ }
