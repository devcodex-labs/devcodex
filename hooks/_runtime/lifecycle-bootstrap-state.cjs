'use strict'

function buildLifecycleBootstrapStateUtils(ctx) {
  const {
    fs,
    path,
    LAYOUT,
    CONTEXT_PROJECT,
    DEFAULT_SCOPE,
    EXECUTION_MODE,
    readJsonFile,
    META_STATE_PATHS,
    buildPathNeedles,
    getStatePathsFor,
    getStatePaths,
    getActiveScope,
    getActiveNamespaceRoot,
    getBootstrapAgent,
    getWorkspaceNamespaceRoot,
    readProfileMode,
    getToolName,
    touchesPath,
    getToolInputStrings,
    getCommandText,
    getRecentBootstrapTaskStamps,
    isRecentBootstrapTaskPath,
    buildInterceptionOutput,
    INTERCEPTION_ACTION,
    noopOutput
  } = ctx

  function buildScopedNeedles(scopeRoot, segments) {
    return buildPathNeedles(path.join(scopeRoot, ...segments))
  }

  function getBootstrapScopes(state, payload) {
    const namespaceRoot = getActiveNamespaceRoot(state)
    const bootstrapAgent = getBootstrapAgent(state, payload)
    const memorySegments = ['.memory', 'clients']
    const memoryNeedles = bootstrapAgent
      ? buildScopedNeedles(namespaceRoot, [...memorySegments, bootstrapAgent])
      : buildScopedNeedles(namespaceRoot, memorySegments)
    const summaryNeedles = bootstrapAgent
      ? buildScopedNeedles(namespaceRoot, [...memorySegments, bootstrapAgent, 'SUMMARY.md'])
      : []
    const taskNeedles = bootstrapAgent
      ? getRecentBootstrapTaskStamps().flatMap(stamp => buildScopedNeedles(
        namespaceRoot,
        [...memorySegments, bootstrapAgent, 'tasks', `${stamp}.md`]
      ))
      : []
    const profileNeedles = buildScopedNeedles(namespaceRoot, ['profile'])
    if (LAYOUT.enabled && getActiveScope(state) !== 'workspace') {
      profileNeedles.push(...buildScopedNeedles(getWorkspaceNamespaceRoot(), ['profile']))
    }
    return {
      profileNeedles: [...new Set(profileNeedles)],
      memoryNeedles,
      summaryNeedles,
      taskNeedles
    }
  }

  function buildDefaultState(mode) {
    const normalizedMode = mode === 'dev' ? 'dev' : 'prod'
    return {
      version: 1,
      mode: normalizedMode,
      executionMode: EXECUTION_MODE.CONFIRM,
      phase: 'bootstrapping',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      promptCount: 0,
      toolUseCount: 0,
      activeProject: CONTEXT_PROJECT || '',
      activeScope: DEFAULT_SCOPE,
      activeProjectSource: CONTEXT_PROJECT ? 'context' : '',
      bootstrap: { profileRead: false, summaryRead: false, tasksRead: false },
      lastBootstrapWarningKey: '',
      lastClosureReminderKey: '',
      lastMultiProjectWarningKey: '',
      bootstrapComplete: false,
      visible: {
        payloadObserved: false,
        replyEvidence: 'unverified',
        replySource: '',
        precheckStatus: 'unverified',
        precheck: false,
        compliance: false,
        artifactPaths: false
      },
      stickyProject: {
        project: CONTEXT_PROJECT || '',
        source: CONTEXT_PROJECT ? 'context' : '',
        sessionKey: '',
        updatedAt: '',
        updatedAtMs: 0
      },
      cp3Runtime: {},
      mutated: false,
      reportTouched: false,
      memoryTouched: false,
      dangerousApprovals: {},
      lastEvent: '',
      lastReason: ''
    }
  }

  function loadState(modeHint) {
    const metaState = readJsonFile(META_STATE_PATHS.file)
    let saved = metaState
    if (LAYOUT.enabled) {
      const preferredProject = String(metaState?.activeProject || CONTEXT_PROJECT || '').trim()
      const preferredScope = metaState?.activeScope || (preferredProject ? 'project' : DEFAULT_SCOPE)
      const activeState = readJsonFile(getStatePathsFor(preferredProject, preferredScope).file)
      if (activeState && typeof activeState === 'object') {
        saved = activeState
      } else if (CONTEXT_PROJECT) {
        const contextState = readJsonFile(getStatePathsFor(CONTEXT_PROJECT, 'project').file)
        if (contextState && typeof contextState === 'object') saved = contextState
      }
    }
    const mode = modeHint || readProfileMode(saved || metaState || null, saved?.activeProject || metaState?.activeProject || '')
    const current = buildDefaultState(mode)
    if (!saved || typeof saved !== 'object') return current
    return {
      ...current,
      ...saved,
      mode,
      bootstrap: { ...current.bootstrap, ...(saved.bootstrap || {}) },
      visible: { ...current.visible, ...(saved.visible || {}) },
      stickyProject: { ...current.stickyProject, ...(saved.stickyProject || {}), ...(metaState?.stickyProject || {}) },
      cp3Runtime: { ...current.cp3Runtime, ...(saved.cp3Runtime || {}) },
      dangerousApprovals: { ...current.dangerousApprovals, ...(saved.dangerousApprovals || {}) }
    }
  }

  function saveState(state) {
    state.updatedAt = new Date().toISOString()
    const activePaths = getStatePaths(state)
    fs.mkdirSync(activePaths.dir, { recursive: true })
    fs.writeFileSync(activePaths.file, JSON.stringify(state, null, 2))
    if (LAYOUT.enabled && activePaths.file !== META_STATE_PATHS.file) {
      const metaState = {
        ...state,
        bootstrap: { ...(state.bootstrap || {}) },
        visible: { ...(state.visible || {}) },
        stickyProject: { ...(state.stickyProject || {}) },
        dangerousApprovals: { ...(state.dangerousApprovals || {}) }
      }
      fs.mkdirSync(META_STATE_PATHS.dir, { recursive: true })
      fs.writeFileSync(META_STATE_PATHS.file, JSON.stringify(metaState, null, 2))
    }
  }

  function resetState(mode, previousState) {
    const state = buildDefaultState(mode)
    state.promptCount = 1
    state.activeProject = previousState?.activeProject || CONTEXT_PROJECT || ''
    state.activeScope = previousState?.activeScope || DEFAULT_SCOPE
    state.activeProjectSource = previousState?.activeProjectSource || (CONTEXT_PROJECT ? 'context' : '')
    state.lastMultiProjectWarningKey = previousState?.lastMultiProjectWarningKey || ''
    state.stickyProject = { ...state.stickyProject, ...(previousState?.stickyProject || {}) }
    state.cp3Runtime = { ...(previousState?.cp3Runtime || {}) }
    state.dangerousApprovals = { ...(previousState?.dangerousApprovals || {}) }
    saveState(state)
    return state
  }

  function isReadOnlyBootstrapShellCommand(payload) {
    const command = getCommandText(payload)
    if (!command || !command.trim()) return false
    const lowerCommand = command.toLowerCase()
    if (/[;&|`]/.test(command) || /\$\(|\b(?:&&|\|\|)\b/.test(command)) return false
    if (
      />{1,2}/.test(command) ||
      /\b(set-content|add-content|out-file|tee|copy-item|move-item|remove-item|new-item|rename-item)\b/i.test(command) ||
      /\b(sc|ac|ni|ri|mi)\b/i.test(command) ||
      /\b(cp|mv|rm|del|erase|touch|mkdir|rmdir|git\s+add|git\s+commit|npm\s+install)\b/i.test(command)
    ) {
      return false
    }
    return /\b(get-content|cat|type|get-childitem|ls|dir|rg|findstr|select-string|head|tail|more|echo)\b/.test(lowerCommand)
  }

  function isBootstrapReadTool(payload, state) {
    const toolName = getToolName(payload).toLowerCase()
    const scopes = getBootstrapScopes(state, payload)
    const readPatterns = [
      /^read([_-]?file)?$/,
      /^list[_-]?dir$/,
      /^file[_-]?search$/,
      /^grep([_-]?search)?$/,
      /^semantic[_-]?search$/,
      /^glob$/
    ]
    if (readPatterns.some(pattern => pattern.test(toolName))) {
      return (
        touchesPath(payload, ...scopes.profileNeedles) ||
        touchesPath(payload, ...scopes.memoryNeedles)
      )
    }
    const shellReadPatterns = [
      /^shell[_-]?command$/,
      /^run[_-]?in[_-]?terminal$/,
      /^send[_-]?to[_-]?terminal$/,
      /^bash$/,
      /^powershell$/
    ]
    if (!shellReadPatterns.some(pattern => pattern.test(toolName))) return false
    if (!isReadOnlyBootstrapShellCommand(payload)) return false
    return (
      touchesPath(payload, ...scopes.profileNeedles) ||
      touchesPath(payload, ...scopes.memoryNeedles)
    )
  }

  function isPureReadTool(payload) {
    const toolName = getToolName(payload).toLowerCase()
    const readPatterns = [
      /^read([_-]?file)?$/,
      /^list[_-]?dir$/,
      /^file[_-]?search$/,
      /^grep([_-]?search)?$/,
      /^semantic[_-]?search$/,
      /^glob$/
    ]
    return readPatterns.some(pattern => pattern.test(toolName))
  }

  function isClarificationTool(payload) {
    return /^vscode[_-]?askquestions$/.test(getToolName(payload).toLowerCase())
  }

  function updateBootstrapState(state, payload) {
    const scopes = getBootstrapScopes(state, payload)
    const inputStrings = getToolInputStrings(payload)
    if (touchesPath(payload, ...scopes.profileNeedles)) state.bootstrap.profileRead = true
    if ((scopes.summaryNeedles.length && touchesPath(payload, ...scopes.summaryNeedles)) ||
      (!scopes.summaryNeedles.length &&
        touchesPath(payload, ...scopes.memoryNeedles) &&
        inputStrings.some(input => input.includes('/summary.md')))) {
      state.bootstrap.summaryRead = true
    }
    if ((scopes.taskNeedles.length && touchesPath(payload, ...scopes.taskNeedles)) ||
      (!scopes.taskNeedles.length &&
        touchesPath(payload, ...scopes.memoryNeedles) &&
        inputStrings.some(isRecentBootstrapTaskPath))) {
      state.bootstrap.tasksRead = true
    }
    state.bootstrapComplete = !!(
      state.bootstrap.profileRead && state.bootstrap.summaryRead && state.bootstrap.tasksRead
    )
    if (state.bootstrapComplete) state.phase = 'active'
  }

  function buildBootstrapMessage() {
    return [
      'DevCodex hook-enforced bootstrap is active for this user message.',
      'Load the effective profile (legacy .devcodex/profile/ or workspace-namespace profile roots) and memory files under',
      'the active .devcodex namespace before any substantive work.',
      'Your first user-visible block must be the entry check PC0-PC7 before substantive task content; dev mode adds full PC4 diagnostics.',
      '*** S07 compaction trigger (v1.9.6+): if this turn resumes from /compact, /resume, or summary-restore,',
      'this also counts as "first user-visible reply" — you MUST re-output PC0-PC7 even when instructed to "continue without acknowledging".'
    ].join(' ')
  }

  function buildBootstrapDenyOutput(state, payload, eventName, platform) {
    const missing = []
    if (!state.bootstrap.profileRead) missing.push('profile')
    if (!state.bootstrap.summaryRead) missing.push('SUMMARY')
    if (!state.bootstrap.tasksRead) missing.push('tasks')
    const toolName = getToolName(payload) || 'tool'
    return buildInterceptionOutput(
      state,
      platform || 'copilot',
      eventName,
      INTERCEPTION_ACTION.REQUIRE_COMPLETION,
      'bootstrap-incomplete',
      `Blocked tool use before DevCodex bootstrap: ${toolName}`,
      `Read .devcodex/profile/ plus SUMMARY/tasks memory files first. Missing: ${missing.join(', ') || 'none'}.`,
      'Read the effective profile, SUMMARY, and today tasks file, then retry the tool.'
    )
  }

  function buildBootstrapWarningOutput(state, payload, eventName, platform) {
    const missing = []
    if (!state.bootstrap.profileRead) missing.push('profile')
    if (!state.bootstrap.summaryRead) missing.push('SUMMARY')
    if (!state.bootstrap.tasksRead) missing.push('tasks')
    const toolName = getToolName(payload) || 'tool'
    return buildInterceptionOutput(
      state,
      platform || 'copilot',
      eventName,
      INTERCEPTION_ACTION.REQUIRE_COMPLETION,
      'bootstrap-incomplete',
      `Bootstrap incomplete before ${toolName}`,
      `Read .devcodex/profile/ plus SUMMARY/tasks memory files as soon as possible. Missing: ${missing.join(', ') || 'none'}. Tool allowed in safety-only mode.`,
      'Read bootstrap files before substantive work.'
    )
  }

  function buildBootstrapWarningKey(state) {
    const missing = []
    if (!state.bootstrap.profileRead) missing.push('profile')
    if (!state.bootstrap.summaryRead) missing.push('SUMMARY')
    if (!state.bootstrap.tasksRead) missing.push('tasks')
    return [state.promptCount || 0, missing.join(',')].join('|')
  }

  function buildDedupedBootstrapWarningOutput(state, payload, eventName, platform) {
    const key = buildBootstrapWarningKey(state, payload)
    if (state.lastBootstrapWarningKey === key) return noopOutput()
    state.lastBootstrapWarningKey = key
    return buildBootstrapWarningOutput(state, payload, eventName, platform)
  }

  return {
    getBootstrapScopes,
    buildDefaultState,
    loadState,
    saveState,
    resetState,
    isBootstrapReadTool,
    isPureReadTool,
    isClarificationTool,
    updateBootstrapState,
    isReadOnlyBootstrapShellCommand,
    buildBootstrapMessage,
    buildBootstrapDenyOutput,
    buildBootstrapWarningOutput,
    buildBootstrapWarningKey,
    buildDedupedBootstrapWarningOutput
  }
}

module.exports = { buildLifecycleBootstrapStateUtils }
