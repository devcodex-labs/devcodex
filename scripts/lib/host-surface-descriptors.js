'use strict'

const HOST_IDS = Object.freeze(['copilot', 'claude', 'codex', 'gemini', 'grok'])
const DEFAULT_HOSTS = Object.freeze(['copilot', 'claude', 'codex'])
const HOST_ALIASES = Object.freeze({
  '--claude': 'claude',
  '--codex': 'codex',
  '--gemini': 'gemini',
  '--grok': 'grok'
})

function normalizeHostList(hosts) {
  const values = Array.isArray(hosts) ? hosts : [hosts]
  const expanded = values.includes('all') ? HOST_IDS : values
  return Array.from(new Set(expanded.filter(host => HOST_IDS.includes(host))))
}

function projectionDescriptors(hosts, { grokWorkspaceBridge = false } = {}) {
  const selected = new Set(normalizeHostList(hosts))
  const descriptors = []
  if (!selected.size) return descriptors
  const bridgeGrokOnly = grokWorkspaceBridge && selected.size === 1 && selected.has('grok')

  if (!bridgeGrokOnly) {
    descriptors.push({
      surface: 'full-fallback',
      source: 'instructions.md',
      destination: '.agents/devcodex/instructions.full.md',
      role: 'full-fallback'
    })
  }
  if (!bridgeGrokOnly && ['claude', 'codex', 'gemini', 'grok'].some(host => selected.has(host))) {
    descriptors.push({
      surface: 'shared-kernel',
      source: 'host-projections/AGENTS.md',
      destination: 'AGENTS.md',
      role: 'kernel'
    })
  }
  if (!bridgeGrokOnly && ['codex', 'gemini', 'grok'].some(host => selected.has(host))) {
    descriptors.push({
      surface: 'shared-agent-skills',
      source: 'skills',
      destination: '.agents/skills',
      role: 'skills'
    })
  }
  if (selected.has('copilot')) {
    descriptors.push({
      surface: 'copilot',
      source: 'host-projections/copilot-instructions.md',
      destination: '.github/copilot-instructions.md',
      role: 'kernel'
    })
  }
  if (selected.has('claude')) {
    descriptors.push({
      surface: 'claude',
      source: 'host-projections/CLAUDE.md',
      destination: 'CLAUDE.md',
      role: 'wrapper'
    })
  }
  if (selected.has('gemini')) {
    descriptors.push(
      { surface: 'gemini', source: 'host-projections/GEMINI.md', destination: 'GEMINI.md', role: 'wrapper' },
      { surface: 'gemini', source: 'gemini/settings.json', destination: '.gemini/settings.json', role: 'host-config' },
      { surface: 'gemini', source: 'hooks/_runtime', destination: '.gemini/hooks/_runtime', role: 'hook-runtime' }
    )
  }
  if (selected.has('grok')) {
    if (bridgeGrokOnly) {
      descriptors.push(
        {
          surface: 'grok-workspace-bridge',
          source: 'host-projections/AGENTS.workspace-bridge.md',
          destination: 'AGENTS.md',
          role: 'kernel'
        },
        {
          surface: 'grok-workspace-bridge',
          source: 'grok/skills/devcodex-workspace',
          destination: '.grok/skills/devcodex-workspace',
          role: 'bridge-skill'
        },
        {
          surface: 'grok-workspace-bridge',
          source: 'grok/mcp',
          destination: '.grok/mcp',
          role: 'mcp-bridge'
        }
      )
    }
    descriptors.push(
      { surface: 'grok', source: 'grok/hooks/devcodex.json', destination: '.grok/hooks/devcodex.json', role: 'host-config' },
      { surface: 'grok', source: 'hooks/_runtime', destination: '.grok/hooks/_runtime', role: 'hook-runtime' }
    )
  }
  return descriptors
}

function hostEntryPairs(host, options = {}) {
  const hosts = host === 'all' ? HOST_IDS : [host]
  return projectionDescriptors(hosts, options)
    .filter(item => ['kernel', 'wrapper'].includes(item.role))
    .map(item => ({ host, source: item.source, destination: item.destination, role: item.role }))
}

module.exports = {
  DEFAULT_HOSTS,
  HOST_ALIASES,
  HOST_IDS,
  hostEntryPairs,
  normalizeHostList,
  projectionDescriptors
}
