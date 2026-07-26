'use strict'

/**
 * C1 acceptance: deployed Grok lifecycle AutoMatch path (no Stop semantics change).
 * UPS match on "test" → Stop force if Ready → allow if 小朋友真可爱
 */

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

const cwd = path.resolve(process.env.DEVCODEX_ACCEPT_CWD || 'E:/Worker')
const hostAdapter = path.join(
  process.env.USERPROFILE || os.homedir(),
  '.grok',
  'devcodex',
  'runtime',
  'hooks',
  '_runtime',
  'lifecycle-host-adapters.cjs'
)

function run (payload) {
  if (!fs.existsSync(hostAdapter)) {
    return { error: 'adapter-missing', hostAdapter }
  }
  const env = {
    ...process.env,
    DEVCODEX_HOST_PLATFORM: 'grok',
    GROK_AGENT: '1',
    GROK_SESSION_ID: process.env.GROK_SESSION_ID || `ui-accept-skill-${Date.now()}`,
    DEVCODEX_HOOK_ENFORCEMENT: 'safety-only'
  }
  const r = spawnSync(process.execPath, [hostAdapter, 'grok'], {
    cwd,
    env,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 25000,
    maxBuffer: 4 * 1024 * 1024
  })
  let out = {}
  try {
    out = JSON.parse(String(r.stdout || '').trim() || '{}')
  } catch {
    out = { parseError: true, stdout: r.stdout, stderr: r.stderr, status: r.status }
  }
  return {
    status: r.status,
    stderr: String(r.stderr || '').slice(0, 500),
    out
  }
}

const sessionId = `ui-accept-skill-${Date.now()}`
process.env.GROK_SESSION_ID = sessionId

const ups = run({
  hookEventName: 'user_prompt_submit',
  sessionId,
  cwd,
  workspaceRoot: cwd,
  prompt: 'test',
  userPrompt: 'test'
})

const stopBad = run({
  hookEventName: 'stop',
  sessionId,
  cwd,
  workspaceRoot: cwd,
  reason: 'end_turn',
  lastAssistantMessage: 'Ready - systems are up',
  stopHookActive: false
})

const stopGood = run({
  hookEventName: 'stop',
  sessionId,
  cwd,
  workspaceRoot: cwd,
  reason: 'end_turn',
  lastAssistantMessage: '小朋友真可爱',
  stopHookActive: false
})

const badReason = String(stopBad.out.reason || '')
const skillForce = stopBad.out.decision === 'block' &&
  /WorkspaceSkillAutoMatch|小朋友真可爱|workspace-skill-auto-match/i.test(badReason)
const goodOk = stopGood.out.decision !== 'block' ||
  !/WorkspaceSkillAutoMatch/i.test(String(stopGood.out.reason || ''))

const report = {
  schemaVersion: 'WorkspaceSkillAutoMatchAcceptReplayV1',
  cwd,
  hostAdapter,
  adapterExists: fs.existsSync(hostAdapter),
  sessionId,
  ups: {
    status: ups.status,
    decision: ups.out.decision,
    evidenceMode: ups.out.devcodexGrokEvidenceMode,
    stdoutHasSkillText: /WorkspaceSkillAutoMatch|小朋友真可爱/.test(JSON.stringify(ups.out))
  },
  stopBad: {
    status: stopBad.status,
    decision: stopBad.out.decision,
    skillForce,
    reasonHead: badReason.slice(0, 240)
  },
  stopGood: {
    status: stopGood.status,
    decision: stopGood.out.decision || null,
    evidenceMode: stopGood.out.devcodexGrokEvidenceMode || null,
    notSkillForce: goodOk,
    reasonHead: String(stopGood.out.reason || '').slice(0, 160)
  },
  verdict: skillForce && goodOk ? 'PASS' : 'FAIL',
  note: 'Grok UPS passive: match state is for Stop force; inject not claimed'
}

console.log(JSON.stringify(report, null, 2))
process.exit(report.verdict === 'PASS' ? 0 : 1)
