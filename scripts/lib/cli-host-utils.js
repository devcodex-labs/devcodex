function buildCliHostUtils({ fs, path, isPlainObject, claudeMcpJson }) {
  function normalizeStringArray(value) {
    return Array.isArray(value)
      ? value.filter(item => typeof item === 'string' && item.trim())
      : []
  }

  function mergeUniqueStringArrays(...arrays) {
    return Array.from(new Set(arrays.flatMap(normalizeStringArray))).sort()
  }

  function extractClaudeHookEntryCommands(entry) {
    if (!entry || !Array.isArray(entry.hooks)) return []
    return entry.hooks
      .filter(hook => hook && typeof hook === 'object')
      .map(hook => `${String(hook.type || '').trim()}:${String(hook.command || '').trim()}`)
      .filter(text => !/:$/.test(text))
  }

  function sameClaudeHookEntry(left, right) {
    const leftMatcher = Object.prototype.hasOwnProperty.call(left || {}, 'matcher')
      ? String(left.matcher || '')
      : ''
    const rightMatcher = Object.prototype.hasOwnProperty.call(right || {}, 'matcher')
      ? String(right.matcher || '')
      : ''
    if (leftMatcher !== rightMatcher) return false
    const leftCommands = extractClaudeHookEntryCommands(left)
    const rightCommands = extractClaudeHookEntryCommands(right)
    return rightCommands.length > 0 && rightCommands.every(command => leftCommands.includes(command))
  }

  function mergeClaudeHooks(existingHooks, managedHooks) {
    const merged = isPlainObject(existingHooks) ? { ...existingHooks } : {}
    for (const [eventName, managedEntries] of Object.entries(managedHooks || {})) {
      const existingEntries = Array.isArray(merged[eventName]) ? merged[eventName].slice() : []
      for (const entry of managedEntries || []) {
        if (!existingEntries.some(existing => sameClaudeHookEntry(existing, entry))) {
          existingEntries.push(entry)
        }
      }
      merged[eventName] = existingEntries
    }
    return merged
  }

  function mergeClaudeMcpConfig(existingConfig) {
    const base = isPlainObject(existingConfig) ? { ...existingConfig } : {}
    const legacyServers = isPlainObject(base.servers) ? base.servers : {}
    const currentServers = isPlainObject(base.mcpServers) ? base.mcpServers : {}
    delete base.servers
    base.mcpServers = {
      ...legacyServers,
      ...currentServers,
      ...claudeMcpJson.mcpServers
    }
    return base
  }

  function detectInstalledHostAssets(cwd) {
    const installed = []
    const hasCodex = (
      fs.existsSync(path.join(cwd, 'AGENTS.md')) ||
      fs.existsSync(path.join(cwd, '.codex')) ||
      fs.existsSync(path.join(cwd, '.agents'))
    )
    const hasClaude = (
      fs.existsSync(path.join(cwd, 'CLAUDE.md')) ||
      fs.existsSync(path.join(cwd, '.claude'))
    )
    const hasCopilot = (
      fs.existsSync(path.join(cwd, '.github', 'copilot-instructions.md')) ||
      fs.existsSync(path.join(cwd, '.github', 'instructions')) ||
      fs.existsSync(path.join(cwd, '.github', 'hooks', '_runtime', 'lifecycle.cjs'))
    )
    if (hasCodex) installed.push('codex')
    if (hasClaude) installed.push('claude-code')
    if (hasCopilot) installed.push('copilot')
    return installed
  }

  function detectHostPlatform(env = process.env, cwd = process.cwd()) {
    if (env.CLAUDE_CODE_VERSION || env.CLAUDE_HOOK_COMMAND) return { platform: 'claude', source: 'env-derived' }
    if (env.CODEX_HOME || env.CODEX_ENV_PWD || env.OPENAI_CODEX) return { platform: 'codex', source: 'env-derived' }
    if (env.IDEA_INITIAL_DIRECTORY || env.JETBRAINS_IDE) return { platform: 'jetbrains-copilot', source: 'env-derived' }
    if (env.TERM_PROGRAM === 'vscode' || env.VSCODE_PID) return { platform: 'vscode-copilot', source: 'env-derived' }
    if (env.CURSOR_TRACE_ID || env.CURSOR_USER_ID) return { platform: 'cursor', source: 'env-derived' }

    const installed = detectInstalledHostAssets(cwd)
    if (installed.length === 1) {
      const only = installed[0]
      if (only === 'claude-code') return { platform: 'claude', source: 'installed-artifacts' }
      if (only === 'codex') return { platform: 'codex', source: 'installed-artifacts' }
      if (only === 'copilot') return { platform: 'copilot', source: 'installed-artifacts' }
    }
    return { platform: 'unknown', source: 'unknown' }
  }

  return {
    normalizeStringArray,
    mergeUniqueStringArrays,
    mergeClaudeHooks,
    mergeClaudeMcpConfig,
    detectInstalledHostAssets,
    detectHostPlatform
  }
}

module.exports = {
  buildCliHostUtils
}
