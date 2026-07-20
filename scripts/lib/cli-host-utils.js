'use strict'

const crypto = require('crypto')
const {
  grokUserConfigPath,
  inspectGrokPluginInstallation,
  mergeGrokPluginRegistration,
  resolveHostAdapterScope
} = require('./host-adapter-scope.js')

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
    // AGENTS.md/.agents are shared by Codex, Gemini and Grok; only .codex is host-specific.
    const hasCodex = fs.existsSync(path.join(cwd, '.codex'))
    const hasClaude = (
      fs.existsSync(path.join(cwd, 'CLAUDE.md')) ||
      fs.existsSync(path.join(cwd, '.claude'))
    )
    const hasCopilot = (
      fs.existsSync(path.join(cwd, '.github', 'copilot-instructions.md')) ||
      fs.existsSync(path.join(cwd, '.github', 'instructions')) ||
      fs.existsSync(path.join(cwd, '.github', 'hooks', '_runtime', 'lifecycle.cjs'))
    )
    const hasGemini = (
      fs.existsSync(path.join(cwd, 'GEMINI.md')) ||
      fs.existsSync(path.join(cwd, '.gemini'))
    )
    let grokScope = null
    try { grokScope = resolveHostAdapterScope(cwd, 'grok') } catch { }
    let hasGrok = fs.existsSync(path.join(cwd, '.grok'))
    if (grokScope?.scope === 'user-registered-workspace') {
      const manifest = path.join(grokScope.pluginRoot, '.claude-plugin', 'plugin.json')
      const hook = path.join(grokScope.pluginRoot, 'hooks', 'devcodex-workspace.cjs')
      const installation = inspectGrokPluginInstallation(grokScope.pluginRoot, process.env)
      hasGrok = fs.existsSync(manifest) && fs.existsSync(hook) && installation.registered
    }
    if (hasCodex) installed.push('codex')
    if (hasClaude) installed.push('claude-code')
    if (hasCopilot) installed.push('copilot')
    if (hasGemini) installed.push('gemini')
    if (hasGrok) installed.push('grok')
    return installed
  }

  function inspectHostInstructionSurfaces(cwd) {
    let hostScope = null
    try { hostScope = resolveHostAdapterScope(cwd, 'grok') } catch { }
    const inspectionRoot = hostScope?.scope === 'user-registered-workspace' ? hostScope.ownerRoot : cwd
    const budgets = { kernelMaxBytes: 16 * 1024, kernelMaxLines: 200, wrapperMaxBytes: 2 * 1024 }
    const definitions = [
      { surface: 'shared', role: 'kernel', relative: 'AGENTS.md' },
      { surface: 'copilot', role: 'kernel', relative: path.join('.github', 'copilot-instructions.md') },
      { surface: 'claude', role: 'wrapper', relative: 'CLAUDE.md' },
      { surface: 'gemini', role: 'wrapper', relative: 'GEMINI.md' },
      { surface: 'full-fallback', role: 'fallback', relative: path.join('.agents', 'devcodex', 'instructions.full.md') }
    ]
    const entries = definitions.map(definition => {
      const file = path.join(inspectionRoot, definition.relative)
      if (!fs.existsSync(file)) return { ...definition, path: file, installed: false }
      const content = fs.readFileSync(file, 'utf8')
      const sourceDigest = content.match(/^> sourceDigest: ([a-f0-9]{64})$/m)?.[1] || null
      const workspaceBridge = /^> projectionRole: workspace-bridge$/m.test(content)
      const hostNeutralBridge = workspaceBridge && /^> projectionScope: host-neutral$/m.test(content) &&
        /only when the current host identifies itself as Grok/.test(content) &&
        /Other hosts must not treat `\.grok` as a shared instruction source/.test(content)
      return {
        ...definition,
        path: file,
        installed: true,
        bytes: Buffer.byteLength(content, 'utf8'),
        lines: content.split(/\r?\n/).length,
        digest: crypto.createHash('sha256').update(content).digest('hex'),
        sourceDigest,
        workspaceBridge,
        hostNeutralBridge,
        sharedKernelPointer: definition.role !== 'wrapper' || content.includes('@AGENTS.md')
      }
    })
    const issues = []
    const warnings = []
    const installedEntries = entries.filter(item => item.installed)
    const sharedKernel = entries.find(item => item.surface === 'shared')
    const fallback = entries.find(item => item.role === 'fallback')
    for (const entry of entries.filter(item => item.installed)) {
      if (!entry.bytes) issues.push({ code: 'HOST_INSTRUCTION_EMPTY', path: entry.path })
      if (entry.role === 'wrapper' && !entry.sharedKernelPointer) {
        issues.push({ code: 'HOST_WRAPPER_POINTER_MISSING', path: entry.path })
      }
      if (entry.role === 'wrapper' && !sharedKernel.installed) {
        issues.push({ code: 'HOST_SHARED_KERNEL_MISSING', path: entry.path })
      }
      if (entry.role === 'kernel' && (entry.bytes > budgets.kernelMaxBytes || entry.lines > budgets.kernelMaxLines)) {
        issues.push({
          code: 'HOST_KERNEL_BUDGET_EXCEEDED',
          path: entry.path,
          bytes: entry.bytes,
          lines: entry.lines,
          budgets
        })
      }
      if (entry.role === 'wrapper' && entry.bytes > budgets.wrapperMaxBytes) {
        issues.push({ code: 'HOST_WRAPPER_BUDGET_EXCEEDED', path: entry.path, bytes: entry.bytes, budgets })
      }
    }
    const kernels = entries.filter(item => item.installed && item.role === 'kernel')
    const sourceDigests = new Set(kernels.map(item => item.sourceDigest).filter(Boolean))
    if (sourceDigests.size > 1) issues.push({ code: 'HOST_KERNEL_SOURCE_DRIFT', digests: [...sourceDigests].sort() })
    if (kernels.length && !fallback.installed && !sharedKernel.workspaceBridge) {
      issues.push({ code: 'HOST_FULL_FALLBACK_MISSING', path: fallback.path })
    }
    let grokPlugin = null
    if (hostScope?.scope === 'user-registered-workspace') {
      const manifest = path.join(hostScope.pluginRoot, '.claude-plugin', 'plugin.json')
      const hook = path.join(hostScope.pluginRoot, 'hooks', 'devcodex-workspace.cjs')
      const configPath = grokUserConfigPath(process.env)
      const installation = inspectGrokPluginInstallation(hostScope.pluginRoot, process.env)
      let registrationCurrent = false
      let registrationError = null
      try {
        const config = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : ''
        registrationCurrent = !mergeGrokPluginRegistration(config, hostScope.pluginRoot, {
          legacyPluginPaths: hostScope.legacyPluginRoots
        }).changed
      } catch (error) { registrationError = error.message }
      grokPlugin = {
        root: hostScope.pluginRoot,
        manifest,
        hook,
        configPath,
        sourcePresent: fs.existsSync(manifest) && fs.existsSync(hook),
        installed: fs.existsSync(manifest) && fs.existsSync(hook) && installation.registered,
        installationCurrent: installation.current,
        installation,
        legacySourcesPresent: (hostScope.legacyPluginRoots || []).filter(item => fs.existsSync(item)),
        registrationCurrent,
        registrationError
      }
      if (!grokPlugin.sourcePresent) issues.push({ code: 'HOST_GROK_WORKSPACE_PLUGIN_MISSING', path: hostScope.pluginRoot })
      else if (!installation.registered) issues.push({ code: 'HOST_GROK_PLUGIN_INSTALLATION_MISSING', path: installation.registryFile })
      else if (!installation.current) warnings.push({ code: 'HOST_GROK_PLUGIN_INSTALLATION_STALE', path: installation.installedPath })
      if (!registrationCurrent) {
        issues.push({
          code: registrationError ? 'HOST_GROK_PLUGIN_REGISTRATION_INVALID' : 'HOST_GROK_PLUGIN_REGISTRATION_MISSING',
          path: configPath,
          ...(registrationError ? { detail: registrationError } : {})
        })
      }
      if (grokPlugin.legacySourcesPresent.length) {
        issues.push({ code: 'HOST_GROK_LEGACY_PLUGIN_SOURCE_PRESENT', paths: grokPlugin.legacySourcesPresent })
      }
    }
    if (fallback.installed && sourceDigests.size === 1 && fallback.digest !== [...sourceDigests][0]) {
      issues.push({
        code: 'HOST_FULL_FALLBACK_DRIFT',
        path: fallback.path,
        fallbackDigest: fallback.digest,
        sourceDigest: [...sourceDigests][0]
      })
    }
    const contentGroups = new Map()
    for (const entry of kernels) {
      if (!contentGroups.has(entry.digest)) contentGroups.set(entry.digest, [])
      contentGroups.get(entry.digest).push(entry.path)
    }
    for (const [contentDigest, paths] of contentGroups) {
      if (paths.length > 1) issues.push({ code: 'HOST_KERNEL_DUPLICATE_CONTENT', contentDigest, paths: paths.sort() })
    }
    return {
      schemaVersion: 'HostInstructionSurfaceInspectionV1',
      cwd: path.resolve(cwd),
      inspectionRoot: path.resolve(inspectionRoot),
      hostScope,
      grokPlugin,
      budgets,
      entries,
      issues,
      warnings,
      status: issues.length ? 'collision' : (installedEntries.length ? 'ready' : 'not-installed')
    }
  }

  function detectHostPlatform(env = process.env, cwd = process.cwd()) {
    if (env.GEMINI_CLI || env.GEMINI_AGENT || env.GEMINI_SESSION_ID) return { platform: 'gemini', source: 'env-derived' }
    if (env.CLAUDE_CODE_VERSION || env.CLAUDE_HOOK_COMMAND) return { platform: 'claude', source: 'env-derived' }
    if (env.CODEX_HOME || env.CODEX_ENV_PWD || env.OPENAI_CODEX) return { platform: 'codex', source: 'env-derived' }
    if (
      env.GROK_AGENT ||
      env.GROK_HOME ||
      env.GROK_SESSION ||
      env.GROK_SESSION_ID ||
      env.GROK_BUILD ||
      env.XAI_GROK ||
      env.XAI_AGENT ||
      /grok/i.test(String(env.TERM_PROGRAM || ''))
    ) {
      return { platform: 'grok', source: 'env-derived' }
    }
    if (env.CURSOR_TRACE_ID || env.CURSOR_USER_ID) return { platform: 'cursor', source: 'env-derived' }
    if (env.IDEA_INITIAL_DIRECTORY || env.JETBRAINS_IDE) return { platform: 'jetbrains-copilot', source: 'env-derived' }
    if (env.TERM_PROGRAM === 'vscode' || env.VSCODE_PID) return { platform: 'vscode-copilot', source: 'env-derived' }

    const installed = detectInstalledHostAssets(cwd)
    if (installed.length === 1) {
      const only = installed[0]
      if (only === 'claude-code') return { platform: 'claude', source: 'installed-artifacts' }
      if (only === 'codex') return { platform: 'codex', source: 'installed-artifacts' }
      if (only === 'copilot') return { platform: 'copilot', source: 'installed-artifacts' }
      if (only === 'gemini') return { platform: 'gemini', source: 'installed-artifacts' }
      if (only === 'grok') return { platform: 'grok', source: 'installed-artifacts' }
    }
    return { platform: 'unknown', source: 'unknown' }
  }

  return {
    normalizeStringArray,
    mergeUniqueStringArrays,
    mergeClaudeHooks,
    mergeClaudeMcpConfig,
    detectInstalledHostAssets,
    detectHostPlatform,
    inspectHostInstructionSurfaces
  }
}

module.exports = {
  buildCliHostUtils
}
