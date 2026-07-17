'use strict'

function buildLifecycleNamespaceStateUtils(ctx) {
  const {
    fs,
    path,
    CONTEXT_ROOT,
    WORKSPACE_ROOT,
    LAYOUT,
    CONTEXT_PROJECT,
    DEFAULT_SCOPE,
    META_STATE_SCOPE_KEY,
    readJsonFile,
    mergeConfig,
    detectPlatform
  } = ctx

  function resolveProjectName(projectName) {
    return String(projectName || '').trim() || CONTEXT_PROJECT || ''
  }

  function resolveRelativeToContext(p) {
    if (!p) return ''
    try { return path.isAbsolute(p) ? path.normalize(p) : path.resolve(CONTEXT_ROOT, p) } catch { return p }
  }

  function buildPathNeedles(absolutePath) {
    const needles = [absolutePath]
    try {
      const workspaceRelative = path.relative(WORKSPACE_ROOT, absolutePath)
      if (workspaceRelative && workspaceRelative !== '.') needles.push(workspaceRelative)
    } catch { }
    try {
      const contextRelative = path.relative(CONTEXT_ROOT, absolutePath)
      if (contextRelative && contextRelative !== '.') needles.push(contextRelative)
    } catch { }
    return [...new Set(needles)]
  }

  function getWorkspaceNamespaceRoot() {
    return path.join(WORKSPACE_ROOT, '.devcodex', 'workspace')
  }

  function getProjectNamespaceRoot(projectName) {
    return path.join(WORKSPACE_ROOT, '.devcodex', resolveProjectName(projectName))
  }

  function buildStatePaths(namespaceRoot, scopeKey) {
    const dir = path.join(namespaceRoot, '.memory', 'hooks', scopeKey)
    return {
      dir,
      file: path.join(dir, 'lifecycle-state.json'),
      finalPayloadFlag: path.join(dir, 'capture-final-payload.flag'),
      finalPayloadLog: path.join(dir, 'captured-final-payloads.ndjson'),
      interceptionLog: path.join(dir, 'interceptions.jsonl')
    }
  }

  function getMetaStatePaths() {
    const namespaceRoot = LAYOUT.enabled ? getWorkspaceNamespaceRoot() : path.join(WORKSPACE_ROOT, '.devcodex')
    return buildStatePaths(namespaceRoot, META_STATE_SCOPE_KEY)
  }

  function getStatePathsFor(projectName, scope) {
    if (!LAYOUT.enabled) return getMetaStatePaths()
    if (scope === 'workspace' || !projectName) return getMetaStatePaths()
    return buildStatePaths(getProjectNamespaceRoot(projectName), projectName)
  }

  function getStatePaths(state, explicitProject, explicitScope) {
    const scope = explicitScope || state?.activeScope || DEFAULT_SCOPE
    const projectName = resolveProjectName(explicitProject || state?.activeProject || '')
    return getStatePathsFor(projectName, scope)
  }

  function getActiveScope(state) {
    return state?.activeScope || DEFAULT_SCOPE
  }

  function getWorkspaceProfileConfigPath() {
    if (LAYOUT.enabled) {
      return path.join(getWorkspaceNamespaceRoot(), 'profile', 'config.json')
    }
    return path.join(WORKSPACE_ROOT, '.devcodex', 'profile', 'config.json')
  }

  function getProjectRoot(projectName) {
    const name = resolveProjectName(projectName)
    if (name) return path.join(WORKSPACE_ROOT, name)
    return CONTEXT_ROOT
  }

  function getActiveProjectRoot(state) {
    return getProjectRoot(state?.activeProject || CONTEXT_PROJECT || '')
  }

  function getActiveNamespaceRoot(state, explicitProject, explicitScope) {
    if (!LAYOUT.enabled) {
      return path.join(getProjectRoot(explicitProject || state?.activeProject || ''), '.devcodex')
    }
    const scope = explicitScope || getActiveScope(state)
    const projectName = resolveProjectName(explicitProject || state?.activeProject || '')
    if (scope === 'workspace' || !projectName) return getWorkspaceNamespaceRoot()
    return getProjectNamespaceRoot(projectName)
  }

  function readResolvedProfileConfig(state, explicitProject) {
    if (!LAYOUT.enabled) {
      const roots = []
      const projectRoot = getProjectRoot(explicitProject || state?.activeProject || '')
      roots.push(projectRoot)
      if (projectRoot !== WORKSPACE_ROOT) roots.push(WORKSPACE_ROOT)
      for (const root of roots) {
        const cfg = readJsonFile(path.join(root, '.devcodex', 'profile', 'config.json'))
        if (cfg) return cfg
      }
      return null
    }
    const workspaceCfg = readJsonFile(path.join(getWorkspaceNamespaceRoot(), 'profile', 'config.json'))
    const projectName = resolveProjectName(explicitProject || state?.activeProject || '')
    const projectCfg = projectName
      ? readJsonFile(path.join(getProjectNamespaceRoot(projectName), 'profile', 'config.json'))
      : null
    if (!workspaceCfg && !projectCfg) return null
    return mergeConfig(workspaceCfg, projectCfg)
  }

  function readProfileMode(state, explicitProject) {
    const cfg = readResolvedProfileConfig(state, explicitProject)
    return String(cfg?.mode ?? 'prod').trim().toLowerCase() === 'dev' ? 'dev' : 'prod'
  }

  function readProjectProfileConfig(state, explicitProject) {
    return readResolvedProfileConfig(state, explicitProject)
  }

  function listMemoryAgents(state) {
    const clientsDir = path.join(getActiveNamespaceRoot(state), '.memory', 'clients')
    if (!fs.existsSync(clientsDir)) return []
    try {
      return fs.readdirSync(clientsDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => String(entry.name || '').trim().toLowerCase())
        .filter(Boolean)
    } catch {
      return []
    }
  }

  function inferBootstrapAgent(state, payload) {
    const existingAgents = new Set(listMemoryAgents(state))
    const platform = detectPlatform(payload || {})

    if (platform === 'codex') return 'codex'
    if (platform === 'claude') return 'claude-code'
    if (platform === 'grok') return 'grok'
    if (platform === 'cursor') return 'cursor'
    if (platform === 'jetbrains-copilot') return 'jetbrains-copilot'
    if (platform === 'vscode-copilot') {
      if (existingAgents.has('vscode-copilot')) return 'vscode-copilot'
      if (existingAgents.has('copilot')) return 'copilot'
      return 'vscode-copilot'
    }
    if (platform === 'copilot') {
      if (existingAgents.has('copilot')) return 'copilot'
      if (existingAgents.has('vscode-copilot')) return 'vscode-copilot'
      return 'copilot'
    }
    return 'unknown-agent'
  }

  function getBootstrapAgent(state, payload) {
    const inferredAgent = inferBootstrapAgent(state, payload)
    const configuredAgent = String(readProjectProfileConfig(state)?.agent || '').trim().toLowerCase()
    // Profile agent is a fallback hint only. When the host is explicitly
    // detectable (Codex/Claude/VS Code/JetBrains), current host wins.
    if (inferredAgent && !['unknown-agent', 'copilot'].includes(inferredAgent)) return inferredAgent
    return configuredAgent || inferredAgent
  }

  return {
    resolveProjectName,
    resolveRelativeToContext,
    buildPathNeedles,
    getWorkspaceNamespaceRoot,
    getProjectNamespaceRoot,
    getStatePathsFor,
    getStatePaths,
    getActiveScope,
    getWorkspaceProfileConfigPath,
    getProjectRoot,
    getActiveProjectRoot,
    getActiveNamespaceRoot,
    readResolvedProfileConfig,
    readProfileMode,
    readProjectProfileConfig,
    listMemoryAgents,
    inferBootstrapAgent,
    getBootstrapAgent,
    META_STATE_PATHS: getMetaStatePaths()
  }
}

module.exports = { buildLifecycleNamespaceStateUtils }
