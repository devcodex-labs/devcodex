'use strict'

/**
 * HostEnforcementMatrixV1 — five hosts, process-enforcement truth source.
 * hard-deny | stop-block | honesty-only | N/A+platform-limit
 */

const HOST_ENFORCEMENT_MATRIX_V1 = Object.freeze({
  schemaVersion: 'HostEnforcementMatrixV1',
  hosts: Object.freeze({
    copilot: Object.freeze({
      id: 'copilot',
      label: 'GitHub Copilot',
      preToolMutationNoCp2: 'hard-deny',
      preToolNotes: 'CLI hooks when configured; IDE may be instruction-fallback → honesty-only for some surfaces',
      stopCompletion: 'stop-block',
      upsInject: 'N/A+platform-limit',
      upsNotes: 'CLI vs IDE ceilings differ; never claim full IDE hook parity'
    }),
    claude: Object.freeze({
      id: 'claude',
      label: 'Claude Code',
      preToolMutationNoCp2: 'hard-deny',
      stopCompletion: 'stop-block',
      upsInject: 'hard-deny',
      upsNotes: 'additionalContext / inject when hook-enforced'
    }),
    codex: Object.freeze({
      id: 'codex',
      label: 'Codex',
      preToolMutationNoCp2: 'hard-deny',
      stopCompletion: 'stop-block',
      upsInject: 'hard-deny',
      upsNotes: 'systemMessage + additionalContext when configured'
    }),
    gemini: Object.freeze({
      id: 'gemini',
      label: 'Gemini CLI',
      preToolMutationNoCp2: 'hard-deny',
      preToolNotes: 'When Gemini hooks/settings support PreTool deny; otherwise document honesty-only in runtime probe',
      stopCompletion: 'stop-block',
      upsInject: 'N/A+platform-limit',
      upsNotes: 'Do not claim UPS inject without host evidence'
    }),
    grok: Object.freeze({
      id: 'grok',
      label: 'Grok Build',
      preToolMutationNoCp2: 'hard-deny',
      preToolNotes: 'decision:deny supported on PreToolUse',
      stopCompletion: 'stop-block',
      stopNotes: 'conditional decision:block when lastAssistantMessage present',
      upsInject: 'N/A+platform-limit',
      upsNotes: 'UPS stdout ignored; never claim inject'
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

function assertFiveHosts() {
  const ids = listHostIds()
  const required = ['copilot', 'claude', 'codex', 'gemini', 'grok']
  for (const r of required) {
    if (!ids.includes(r)) throw new Error(`HostEnforcementMatrix missing host: ${r}`)
  }
  if (ids.length !== 5) throw new Error(`HostEnforcementMatrix expected 5 hosts, got ${ids.length}`)
  return true
}

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
  summarizeMatrix
}
