'use strict'

const {
  DEFAULT_THRESHOLDS,
  classifyTurnLiveness,
  completeToolLease,
  createTurnLivenessState,
  observeTurnEvent,
  startToolLease
} = require('../../hooks/_runtime/lifecycle-turn-liveness.cjs')

function buildTurnLivenessControlChecks(ctx) {
  const { ROOT, ACTIVE_DEVCODEX_ROOT, fs, path, read, err, console } = ctx

  function checkFile(relative, needles) {
    const file = path.join(ROOT, relative)
    if (!fs.existsSync(file)) {
      err(`[V98] missing required artifact: ${relative}`)
      return
    }
    const content = read(file)
    for (const needle of needles) {
      if (!content.includes(needle)) err(`[V98] ${relative} missing: ${needle}`)
    }
  }

  function checkV98() {
    const required = [
      ['hooks/_runtime/lifecycle-turn-liveness.cjs', ['classifyTurnLiveness', 'startToolLease', 'completeToolLease', 'TurnRecoveryCard', 'hook-event-observation-only']],
      ['hooks/_runtime/lifecycle-bootstrap-state.cjs', ['turnLiveness', 'normalizeTurnLivenessState']],
      ['hooks/_runtime/lifecycle.cjs', ['observeTurnEvent', 'startToolLease', 'markTurnTerminal']],
      ['skills/ai-agent-system-architecture/SKILL.md', ['TurnLivenessRecoveryGate', 'terminalInvariant', 'capabilityBoundary']],
      ['skills/execution-contract/SKILL.md', ['turnLivenessContract', 'allowedRecoveryActions', 'forbiddenRecoveryActions']],
      ['skills/host-contract-verification/SKILL.md', ['turnLiveness', 'hook-event-verified', 'sidecar-observed']],
      ['skills/rework-prevention-engineering/SKILL.md', ['Turn Liveness Prevention Trial', 'FalseStallRate', 'DuplicateMutationRate']],
      ['skills/test-router/SKILL.md', ['agent-turn-liveness', 'no-continuation', 'restart rehydrate']],
      ['skills/report/report-schema.json', ['TurnLivenessRecovery']],
      ['skills/spec-governance/gate-registry.json', ['agent-turn-liveness', 'TurnLivenessReplayMatrix', 'V98']],
      ['prompts/technical-design.prompt.md', ['agent-turn-liveness', 'TurnLivenessRecoveryGate']],
      ['prompts/implementation-plan.prompt.md', ['agent-turn-liveness', 'gray sidecar']],
      ['prompts/report-dev.prompt.md', ['TurnLivenessRecovery']],
      ['prompts/report-fix.prompt.md', ['TurnLivenessRecovery']],
      ['prompts/report-audit.prompt.md', ['TurnLivenessRecovery']],
      ['scripts/check-turn-liveness.js', ['gray-read-only-one-shot', 'sidecar-observed', 'operationReplay', 'processControl']],
      ['package.json', ['check:turn-liveness', 'scripts/check-turn-liveness.js']],
      ['README.md', ['TurnLivenessRecoveryGate', 'stalled-recoverable', 'Hook 本身无法主动唤醒任务']],
      ['website/docs/intro/index.md', ['长任务停滞可诊断', 'TurnLivenessRecoveryGate']],
      ['website/docs/guide/development.md', ['Turn Liveness', 'PostToolUse', '不得自行唤醒宿主']],
      ['changelogs/unreleased.md', ['ISSUE-043', 'Turn Liveness', 'V98']],
      ['scripts/test-turn-liveness.js', ['active-operation-lease', 'stalled-recoverable']],
      ['scripts/test-turn-liveness-controls.js', ['zero-write', 'gray-read-only-one-shot']],
      ['scripts/test-hooks-runtime.js', ['liveness-turn-2', 'TurnRecoveryCard']]
    ]
    for (const [file, needles] of required) checkFile(file, needles)

    let state = createTurnLivenessState({ nowMs: 0 })
    state = observeTurnEvent(state, 'UserPromptSubmit', { session_id: 'v98-turn' }, { nowMs: 1000 }).state
    if (classifyTurnLiveness(state, { nowMs: 5 * 60 * 1000 }).state !== 'running') {
      err('[V98] running agent turn must remain covered by the long agent lease')
    }
    state = observeTurnEvent(state, 'PreToolUse', { tool_use_id: 'v98-tool' }, { nowMs: 2000 }).state
    state = startToolLease(state, { tool_use_id: 'v98-tool' }, 'read_file', { nowMs: 2000 })
    state = observeTurnEvent(state, 'PostToolUse', { tool_use_id: 'v98-tool' }, { nowMs: 3000 }).state
    state = completeToolLease(state, { tool_use_id: 'v98-tool' }, { nowMs: 3000 })
    const stalled = classifyTurnLiveness(state, { nowMs: 3000 + DEFAULT_THRESHOLDS.stalledAfterMs })
    if (stalled.state !== 'stalled-recoverable') err(`[V98] no-continuation fixture expected stalled-recoverable, got ${stalled.state}`)

    const profileRoot = path.join(ACTIVE_DEVCODEX_ROOT, 'profile')
    if (fs.existsSync(profileRoot)) {
      for (const [file, needle] of [
        ['01-项目信息.md', 'Turn Liveness'],
        ['02-架构约束.md', 'lifecycle-turn-liveness.cjs'],
        ['04-测试规范.md', 'V98'],
        ['06-功能清单.md', 'turn-liveness'],
        ['07-用户文档与契约规范.md', 'Turn Liveness']
      ]) {
        const target = path.join(profileRoot, file)
        if (!fs.existsSync(target) || !fs.readFileSync(target, 'utf8').includes(needle)) {
          err(`[V98] active Profile missing ${needle}: ${file}`)
        }
      }
    } else {
      console.log('[V98] active Profile corpus unavailable — repository consumers remain authoritative')
    }
    console.log('[V98] turn liveness core, host boundary and consumer controls checked')
  }

  return { checkV98 }
}

module.exports = { buildTurnLivenessControlChecks }
