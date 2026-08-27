'use strict'

/**
 * HostEnforcementMatrixV1 — canonical hosts, process-enforcement truth source.
 * host-owned-advisory | stop-block | honesty-only | N/A+platform-limit
 */

const HOST_ENFORCEMENT_MATRIX_V1 = Object.freeze({
  schemaVersion: 'HostEnforcementMatrixV1',
  hosts: Object.freeze({
    copilot: Object.freeze({
      id: 'copilot',
      label: 'GitHub Copilot',
      preToolMutationNoCp2: 'host-owned-advisory',
      preToolNotes: 'Operation permission belongs to the active host; DevCodex may emit advisory context only',
      stopCompletion: 'stop-block',
      upsInject: 'N/A+platform-limit',
      upsNotes: 'CLI vs IDE ceilings differ; never claim full IDE hook parity'
    }),
    claude: Object.freeze({
      id: 'claude',
      label: 'Claude Code',
      preToolMutationNoCp2: 'host-owned-advisory',
      preToolNotes: 'Operation permission belongs to Claude Code; DevCodex does not emit allow/deny/ask',
      stopCompletion: 'stop-block',
      upsInject: 'hard-deny',
      upsNotes: 'additionalContext / inject when hook-enforced'
    }),
    codex: Object.freeze({
      id: 'codex',
      label: 'Codex',
      preToolMutationNoCp2: 'host-owned-advisory',
      preToolNotes: 'Operation permission belongs to Codex; DevCodex does not emit allow/deny/ask',
      stopCompletion: 'stop-block',
      upsInject: 'hard-deny',
      upsNotes: 'systemMessage + additionalContext when configured'
    }),
    gemini: Object.freeze({
      id: 'gemini',
      label: 'Gemini CLI',
      preToolMutationNoCp2: 'host-owned-advisory',
      preToolNotes: 'Operation permission belongs to Gemini; DevCodex does not emit allow/deny/ask',
      stopCompletion: 'stop-block',
      upsInject: 'N/A+platform-limit',
      upsNotes: 'Do not claim UPS inject without host evidence'
    }),
    grok: Object.freeze({
      id: 'grok',
      label: 'Grok Build',
      preToolMutationNoCp2: 'host-owned-advisory',
      preToolNotes: 'Operation permission belongs to Grok; DevCodex returns no PreTool decision',
      stopCompletion: 'stop-block',
      stopNotes: 'conditional decision:block when lastAssistantMessage present',
      upsInject: 'N/A+platform-limit',
      upsNotes: 'UPS stdout ignored; never claim inject'
    }),
    cursor: Object.freeze({
      id: 'cursor',
      label: 'Cursor Beta',
      preToolMutationNoCp2: 'host-owned-advisory',
      preToolNotes: 'Operation permission belongs to Cursor; Cloud user hooks are unavailable',
      stopCompletion: 'stop-followup',
      stopNotes: 'Local stop uses bounded followup_message with loop_limit=5; not a Cloud claim',
      upsInject: 'session-start-only',
      upsNotes: 'sessionStart may inject initial context; beforeSubmitPrompt can block but does not inject context'
    })
  })
})

function listHostIds() {
  return Object.keys(HOST_ENFORCEMENT_MATRIX_V1.hosts)
}

function getHostEnforcement(hostId) {
  const id = String(hostId || '').toLowerCase()
  return HOST_ENFORCEMENT_MATRIX_V1.hosts[id] || null
}

function assertSixHosts() {
  const ids = listHostIds()
  const required = ['copilot', 'claude', 'codex', 'gemini', 'grok', 'cursor']
  for (const r of required) {
    if (!ids.includes(r)) throw new Error(`HostEnforcementMatrix missing host: ${r}`)
  }
  if (ids.length !== required.length) throw new Error(`HostEnforcementMatrix expected ${required.length} hosts, got ${ids.length}`)
  return true
}

// Backward-compatible export for third-party consumers of the pre-Cursor helper name.
const assertFiveHosts = assertSixHosts

function summarizeMatrix() {
  return listHostIds().map((id) => {
    const h = HOST_ENFORCEMENT_MATRIX_V1.hosts[id]
    return {
      id,
      label: h.label,
      preToolMutationNoCp2: h.preToolMutationNoCp2,
      stopCompletion: h.stopCompletion,
      upsInject: h.upsInject
    }
  })
}

module.exports = {
  HOST_ENFORCEMENT_MATRIX_V1,
  listHostIds,
  getHostEnforcement,
  assertFiveHosts,
  assertSixHosts,
  summarizeMatrix
}
