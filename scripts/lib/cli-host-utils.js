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

  /** Managed block markers for Codex config.toml MCP merge (idempotent). */
  const CODEX_MCP_MANAGED_BEGIN = '# BEGIN DEVCODEX-MCP-MANAGED'
  const CODEX_MCP_MANAGED_END = '# END DEVCODEX-MCP-MANAGED'
  const CODEX_MCP_SERVER_NAMES = Object.freeze(['devcodex-memory', 'devcodex-profile'])

  function toTomlPath(filePath) {
    return String(filePath || '').replace(/\\/g, '/')
  }

  /**
   * Count managed-block markers. Fail-closed requires 0 pairs (will append) or exactly one ordered pair.
   * @returns {{ begin: number, end: number, ok: boolean, code: string|null }}
   */
  function validateCodexMcpManagedMarkers(tomlText) {
    const text = String(tomlText || '')
    const begin = (text.match(new RegExp(CODEX_MCP_MANAGED_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
    const end = (text.match(new RegExp(CODEX_MCP_MANAGED_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
    if (begin === 0 && end === 0) return { begin, end, ok: true, code: null }
    if (begin === 1 && end === 1) {
      const bi = text.indexOf(CODEX_MCP_MANAGED_BEGIN)
      const ei = text.indexOf(CODEX_MCP_MANAGED_END)
      if (bi !== -1 && ei !== -1 && ei > bi) return { begin, end, ok: true, code: null }
      return { begin, end, ok: false, code: 'CODEX_MCP_MARKER_INVALID' }
    }
    return { begin, end, ok: false, code: 'CODEX_MCP_MARKER_INVALID' }
  }

  /**
   * Detect conflicting bare / quoted / dotted identity forms for DevCodex MCP servers.
   * Why fail-closed: regex merge only owns bare `[mcp_servers.devcodex-*]` tables; other forms create illegal TOML or silent skips.
   * @returns {{ ok: boolean, code: string|null, forms: Record<string, string[]> }}
   */
  function assertCodexMcpServerIdentity(tomlText, { allowBareManaged = true } = {}) {
    const text = String(tomlText || '')
    const forms = {}
    for (const name of CODEX_MCP_SERVER_NAMES) {
      const found = []
      if (new RegExp(String.raw`^\s*\[mcp_servers\.${name}\]\s*$`, 'm').test(text)) found.push('bare')
      if (new RegExp(String.raw`^\s*\[\s*"mcp_servers"\s*\.\s*"${name}"\s*\]\s*$`, 'm').test(text)) found.push('quoted')
      if (new RegExp(String.raw`^\s*mcp_servers\.${name}(?:\.|[\s=])`, 'm').test(text)) found.push('dotted')
      forms[name] = found
      const nonBare = found.filter(f => f !== 'bare')
      if (nonBare.length > 0) {
        return { ok: false, code: 'CODEX_MCP_IDENTITY_CONFLICT', forms }
      }
      if (!allowBareManaged && found.includes('bare')) {
        // still ok when bare is only form — allowBareManaged only gates future strip policy
      }
    }
    return { ok: true, code: null, forms }
  }

  /**
   * Build Codex [mcp_servers.*] managed block reusing .claude/mcp/* servers.
   * @param {string} ownerRoot workspace/project owner root (INPUT_ROOT for servers)
   */
  function buildCodexMcpManagedBlock(ownerRoot) {
    const root = path.resolve(ownerRoot)
    const memoryJs = path.join(root, '.claude', 'mcp', 'memory-server.js')
    const profileJs = path.join(root, '.claude', 'mcp', 'profile-server.js')
    return [
      CODEX_MCP_MANAGED_BEGIN,
      '# Legacy workspace MCP block; user-global adapters are refreshed by npm update -g devcodex.',
      '[mcp_servers.devcodex-memory]',
      'command = "node"',
      'args = [',
      `  "${toTomlPath(memoryJs)}",`,
      `  "${toTomlPath(root)}"`,
      ']',
      'startup_timeout_sec = 30',
      '',
      '[mcp_servers.devcodex-profile]',
      'command = "node"',
      'args = [',
      `  "${toTomlPath(profileJs)}",`,
      `  "${toTomlPath(root)}"`,
      ']',
      'startup_timeout_sec = 30',
      CODEX_MCP_MANAGED_END
    ].join('\n')
  }

  /**
   * Remove legacy/unmanaged [mcp_servers.devcodex-memory|profile] tables so only the managed block remains.
   */
  function stripUnmanagedDevcodexMcpTables(tomlText) {
    const lines = String(tomlText || '').split(/\r?\n/)
    const out = []
    let skipping = false
    for (const line of lines) {
      const header = line.match(/^\s*\[mcp_servers\.(devcodex-memory|devcodex-profile)\]\s*$/)
      if (header) {
        skipping = true
        continue
      }
      if (skipping) {
        if (/^\s*\[/.test(line)) {
          skipping = false
          out.push(line)
        }
        // else drop lines belonging to the unmanaged table
        continue
      }
      out.push(line)
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n')
  }

  /**
   * Merge DevCodex MCP servers into Codex config.toml text without removing user keys.
   * Fail-closed: invalid markers or conflicting server identity returns ok:false and does not invent write content.
   * @returns {{ ok: boolean, content?: string, changed?: boolean, code?: string|null, error?: string }}
   */
  function mergeCodexConfigToml(existingContent, ownerRoot) {
    const text = String(existingContent || '')
    const markers = validateCodexMcpManagedMarkers(text)
    if (!markers.ok) {
      return {
        ok: false,
        code: markers.code,
        error: `Invalid DevCodex MCP managed markers (begin=${markers.begin}, end=${markers.end}). Fix or remove incomplete BEGIN/END markers, then re-run.`
      }
    }
    // When a valid managed pair exists, strip only outside the block after extract; when none, strip bare unmanaged tables.
    // Identity: reject quoted/dotted forms anywhere (including outside managed block).
    const identity = assertCodexMcpServerIdentity(text)
    if (!identity.ok) {
      return {
        ok: false,
        code: identity.code,
        error: 'Conflicting Codex MCP server identity forms detected (quoted/dotted). Remove non-bare devcodex-memory/profile tables, then re-run.'
      }
    }

    const block = buildCodexMcpManagedBlock(ownerRoot)
    const begin = text.indexOf(CODEX_MCP_MANAGED_BEGIN)
    const end = text.indexOf(CODEX_MCP_MANAGED_END)
    let next
    if (begin !== -1 && end !== -1 && end > begin) {
      const before = stripUnmanagedDevcodexMcpTables(text.slice(0, begin))
      const after = stripUnmanagedDevcodexMcpTables(text.slice(end + CODEX_MCP_MANAGED_END.length).replace(/^\r?\n/, ''))
      next = before.replace(/\s+$/, '') + (before.replace(/\s+$/, '') ? '\n\n' : '') + block +
        (after.replace(/^\s+/, '') ? '\n' + after.replace(/^\s+/, '') : '')
    } else {
      const stripped = stripUnmanagedDevcodexMcpTables(text).replace(/\s+$/, '')
      next = (stripped ? stripped + '\n\n' : '') + block + '\n'
    }
    if (!next.endsWith('\n')) next += '\n'

    const postMarkers = validateCodexMcpManagedMarkers(next)
    if (!postMarkers.ok) {
      return { ok: false, code: postMarkers.code, error: 'Merge produced invalid managed markers (internal).' }
    }
    const postIdentity = assertCodexMcpServerIdentity(next)
    if (!postIdentity.ok) {
      return { ok: false, code: postIdentity.code, error: 'Merge produced conflicting MCP server identity (internal).' }
    }

    return { ok: true, content: next, changed: next !== text, code: null }
  }

  /**
   * Extract args for one server from its bare table only (stop at next table header).
   * Prevents cross-table false positives when a later server has args and the earlier does not.
   */
  function extractCodexMcpServerTable(tomlText, serverName) {
    const text = String(tomlText || '')
    const headerRe = new RegExp(String.raw`^\s*\[mcp_servers\.${serverName}\]\s*$`, 'im')
    const headerMatch = headerRe.exec(text)
    if (!headerMatch) return ''
    const start = headerMatch.index + headerMatch[0].length
    const rest = text.slice(start)
    const nextHeader = rest.search(/^\s*\[/m)
    return nextHeader === -1 ? rest : rest.slice(0, nextHeader)
  }

  function extractCodexMcpServerArgs(tomlText, serverName) {
    const table = extractCodexMcpServerTable(tomlText, serverName)
    if (!table) return []
    const match = table.match(/args\s*=\s*\[([^\]]*)\]/i)
    if (!match) return []
    return Array.from(String(match[1]).matchAll(/"([^"]+)"/g)).map(item => item[1])
  }

  /**
   * Minimal doctor probe: workspace .codex/config.toml DevCodex MCP managed entries + server file existence.
   * @returns {{
   *   hasWorkspaceConfig: boolean,
   *   hasManagedBlock: boolean,
   *   hasDevcodexMemory: boolean,
   *   hasDevcodexProfile: boolean,
   *   memoryServerPath: string|null,
   *   profileServerPath: string|null,
   *   memoryServerExists: boolean,
   *   profileServerExists: boolean,
   *   memoryHasArgs: boolean,
   *   profileHasArgs: boolean,
   *   status: 'missing'|'partial'|'stale'|'ok'
   * }}
   */
  function inspectCodexMcpManagedConfig(ownerRoot) {
    const root = path.resolve(ownerRoot || process.cwd())
    const workspaceConfig = path.join(root, '.codex', 'config.toml')
    const expectedMemory = path.join(root, '.claude', 'mcp', 'memory-server.js')
    const expectedProfile = path.join(root, '.claude', 'mcp', 'profile-server.js')
    const result = {
      hasWorkspaceConfig: fs.existsSync(workspaceConfig),
      hasManagedBlock: false,
      hasDevcodexMemory: false,
      hasDevcodexProfile: false,
      memoryServerPath: null,
      profileServerPath: null,
      memoryServerExists: false,
      profileServerExists: false,
      memoryHasArgs: false,
      profileHasArgs: false,
      status: 'missing'
    }
    if (!result.hasWorkspaceConfig) return result

    let text = ''
    try { text = fs.readFileSync(workspaceConfig, 'utf8') } catch { return result }

    result.hasManagedBlock = text.includes(CODEX_MCP_MANAGED_BEGIN) && text.includes(CODEX_MCP_MANAGED_END)
    result.hasDevcodexMemory = /^\s*\[mcp_servers\.devcodex-memory\]\s*$/m.test(text)
    result.hasDevcodexProfile = /^\s*\[mcp_servers\.devcodex-profile\]\s*$/m.test(text)

    const memoryArgs = extractCodexMcpServerArgs(text, 'devcodex-memory')
    const profileArgs = extractCodexMcpServerArgs(text, 'devcodex-profile')
    result.memoryHasArgs = memoryArgs.length > 0
    result.profileHasArgs = profileArgs.length > 0
    result.memoryServerPath = memoryArgs[0] || null
    result.profileServerPath = profileArgs[0] || null

    // Missing args must not fall back to "expected path exists" as ok — that was the F-004 false positive.
    const memoryCandidate = memoryArgs[0] ? path.resolve(memoryArgs[0]) : null
    const profileCandidate = profileArgs[0] ? path.resolve(profileArgs[0]) : null
    result.memoryServerExists = Boolean(memoryCandidate && fs.existsSync(memoryCandidate))
    result.profileServerExists = Boolean(profileCandidate && fs.existsSync(profileCandidate))

    if (
      result.hasDevcodexMemory &&
      result.hasDevcodexProfile &&
      result.memoryHasArgs &&
      result.profileHasArgs &&
      result.memoryServerExists &&
      result.profileServerExists
    ) {
      result.status = 'ok'
    } else if (result.hasDevcodexMemory || result.hasDevcodexProfile || result.hasManagedBlock) {
      result.status = (result.memoryServerExists || result.profileServerExists) ? 'partial' : 'stale'
    }
    return result
  }

  /**
   * Claude adapter ownership evidence — shared .claude/mcp alone is not Claude installation.
   * Why: Codex reuses .claude/mcp runtime; counting any .claude dir polluted host identity (F-007).
   */
  function hasClaudeAdapterEvidence(cwd) {
    if (fs.existsSync(path.join(cwd, 'CLAUDE.md'))) return true
    if (fs.existsSync(path.join(cwd, '.claude', 'settings.json'))) return true
    if (fs.existsSync(path.join(cwd, '.claude', 'settings.local.json'))) return true
    if (fs.existsSync(path.join(cwd, '.claude', 'hooks'))) return true
    if (fs.existsSync(path.join(cwd, '.claude', 'instructions'))) return true
    if (fs.existsSync(path.join(cwd, '.claude', 'skills'))) return true
    // Project .mcp.json with servers is a Claude-oriented install signal (not mcp runtime alone).
    if (fs.existsSync(path.join(cwd, '.mcp.json'))) return true
    return false
  }

  function detectInstalledHostAssets(cwd) {
    const installed = []
    // AGENTS.md/.agents are shared by Codex, Gemini and Grok; only .codex is host-specific.
    const hasCodex = fs.existsSync(path.join(cwd, '.codex'))
    const hasClaude = hasClaudeAdapterEvidence(cwd)
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
        sharedKernelPointer: definition.role !== 'wrapper' ||
          content.includes('@AGENTS.md') ||
          content.includes('@devcodex/runtime/AGENTS.md')
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
    const explicitAgent = String(env.DEVCODEX_AGENT || '').trim().toLowerCase().replace(/[_\s]+/g, '-')
    const explicitPlatforms = {
      codex: 'codex',
      grok: 'grok',
      gemini: 'gemini',
      claude: 'claude',
      'claude-code': 'claude',
      copilot: 'copilot',
      'vscode-copilot': 'vscode-copilot',
      'jetbrains-copilot': 'jetbrains-copilot'
    }
    if (explicitPlatforms[explicitAgent]) {
      return { platform: explicitPlatforms[explicitAgent], source: 'explicit-agent' }
    }
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
    CODEX_MCP_MANAGED_BEGIN,
    CODEX_MCP_MANAGED_END,
    CODEX_MCP_SERVER_NAMES,
    buildCodexMcpManagedBlock,
    validateCodexMcpManagedMarkers,
    assertCodexMcpServerIdentity,
    mergeCodexConfigToml,
    extractCodexMcpServerTable,
    extractCodexMcpServerArgs,
    inspectCodexMcpManagedConfig,
    hasClaudeAdapterEvidence,
    detectInstalledHostAssets,
    detectHostPlatform,
    inspectHostInstructionSurfaces
  }
}

module.exports = {
  buildCliHostUtils
}
