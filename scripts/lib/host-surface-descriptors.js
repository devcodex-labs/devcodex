'use strict'

const HOST_IDS = Object.freeze(['copilot', 'claude', 'codex', 'gemini', 'grok'])
const DEFAULT_HOSTS = HOST_IDS
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

function legacyWorkspaceProjectionDescriptors(hosts, { grokWorkspaceBridge = false, grokWorkspaceScope = false } = {}) {
  const selected = new Set(normalizeHostList(hosts))
  const descriptors = []
  if (!selected.size) return descriptors
  const workspaceRegisteredGrok = (grokWorkspaceScope || grokWorkspaceBridge) && selected.has('grok')

  descriptors.push({
    surface: 'full-fallback',
    source: 'instructions.md',
    destination: '.agents/devcodex/instructions.full.md',
    role: 'full-fallback'
  })
  if (['claude', 'codex', 'gemini', 'grok'].some(host => selected.has(host))) {
    descriptors.push({
      surface: 'shared-kernel',
      source: 'host-projections/AGENTS.md',
      destination: 'AGENTS.md',
      role: 'kernel'
    })
  }
  if (['codex', 'gemini', 'grok'].some(host => selected.has(host))) {
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
    if (workspaceRegisteredGrok) {
      descriptors.push({
        surface: 'grok-workspace-plugin',
        source: 'grok/plugins/devcodex-workspace',
        destination: '.grok/devcodex/plugins/devcodex-workspace',
        role: 'workspace-plugin',
        replacesSurfaces: ['grok', 'grok-workspace-bridge']
      })
    } else {
      descriptors.push(
        { surface: 'grok', source: 'grok/hooks/devcodex.json', destination: '.grok/hooks/devcodex.json', role: 'host-config' },
        { surface: 'grok', source: 'hooks/_runtime', destination: '.grok/hooks/_runtime', role: 'hook-runtime' }
      )
    }
  }
  return descriptors
}

function projectionDescriptors(hosts) {
  const selected = new Set(normalizeHostList(hosts))
  const descriptors = []
  const add = (surface, destination, role, support) => descriptors.push({
    schemaVersion: 'GlobalHostSurfaceDescriptorV1',
    surface,
    source: 'npm-global-package',
    destination,
    role,
    scope: 'user-global',
    support,
    workspaceWrite: false
  })
  if (selected.size) {
    add('shared-agent-runtime', 'user://agents/devcodex/instructions.full.md', 'full-fallback', 'managed')
    add('shared-agent-runtime', 'user://agents/skills', 'skills', 'managed')
  }
  if (selected.has('copilot')) {
    add('copilot', 'user://copilot/copilot-instructions.md', 'instruction', 'contract-fixture')
    add('copilot', 'user://copilot/hooks/devcodex.json', 'host-config', 'contract-fixture')
    add('copilot', 'user://copilot/mcp-config.json', 'mcp-config', 'contract-fixture')
    add('copilot', 'user://copilot/skills', 'skills', 'contract-fixture')
  }
  if (selected.has('claude')) {
    add('claude', 'user://claude/CLAUDE.md', 'instruction', 'contract-fixture')
    add('claude', 'user://claude/settings.json', 'host-config', 'contract-fixture')
    add('claude', 'user://claude.json', 'mcp-config', 'contract-fixture')
  }
  if (selected.has('codex')) {
    add('codex', 'user://codex/AGENTS.md', 'instruction', 'direct-probe')
    add('codex', 'user://codex/hooks.json', 'host-config', 'direct-probe')
    add('codex', 'user://codex/config.toml', 'mcp-config', 'direct-probe')
  }
  if (selected.has('gemini')) {
    add('gemini', 'user://gemini/GEMINI.md', 'instruction', 'contract-fixture')
    add('gemini', 'user://gemini/settings.json', 'host-config', 'contract-fixture')
  }
  if (selected.has('grok')) {
    add('grok', 'user://grok/config.toml', 'host-config', 'direct-probe')
    add('grok', 'user://grok/devcodex/plugins/devcodex-workspace', 'plugin', 'direct-probe')
  }
  for (const host of selected) {
    add(host, `user://${host}/devcodex/runtime-<generation>`, 'immutable-runtime-generation', 'managed')
  }
  return descriptors
}

function hostEntryPairs(host, options = {}) {
  const hosts = host === 'all' ? HOST_IDS : [host]
  return legacyWorkspaceProjectionDescriptors(hosts, options)
    .filter(item => ['kernel', 'wrapper'].includes(item.role))
    .map(item => ({ host, source: item.source, destination: item.destination, role: item.role }))
}

module.exports = {
  DEFAULT_HOSTS,
  HOST_ALIASES,
  HOST_IDS,
  hostEntryPairs,
  legacyWorkspaceProjectionDescriptors,
  normalizeHostList,
  projectionDescriptors
}
