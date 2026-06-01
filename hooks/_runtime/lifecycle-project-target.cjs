'use strict'

function buildLifecycleProjectTargetUtils({
  fs,
  path,
  WORKSPACE_ROOT,
  LAYOUT,
  CONTEXT_PROJECT,
  DEFAULT_SCOPE,
  STICKY_PROJECT_TTL_MS,
  EXECUTION_MODE,
  MULTI_PROJECT_EXEMPTION_KEYWORDS,
  collectWorkspaceProjectNamespaces,
  escapeRegExp,
  collectProjectPayloadStrings,
  normalizeText,
  readProfileMode,
  isStrictEnforcement
}) {
  function listWorkspaceProjects() {
    if (LAYOUT.enabled) {
      return collectWorkspaceProjectNamespaces(WORKSPACE_ROOT)
    }
    let entries
    try { entries = fs.readdirSync(WORKSPACE_ROOT) } catch { return [] }
    const projects = []
    for (const name of entries) {
      if (name.startsWith('.') || name === 'node_modules') continue
      const dir = path.join(WORKSPACE_ROOT, name)
      let stat
      try { stat = fs.statSync(dir) } catch { continue }
      if (!stat.isDirectory()) continue
      const hasPkg = fs.existsSync(path.join(dir, 'package.json'))
      const hasProfile = fs.existsSync(path.join(dir, '.devcodex', 'profile'))
      if (hasPkg || hasProfile) {
        projects.push(name)
      }
    }
    return projects
  }

  function isMultiProjectWorkspace() {
    return listWorkspaceProjects().length >= 2
  }

  function extractUserPrompt(payload) {
    return String(
      payload.prompt || payload.user_prompt || payload.userPrompt ||
      payload.message || payload.text || ''
    )
  }

  function hasMultiProjectExemption(prompt) {
    if (!prompt) return false
    const lower = prompt.toLowerCase()
    return MULTI_PROJECT_EXEMPTION_KEYWORDS.some(k => lower.includes(k.toLowerCase()))
  }

  function detectProjectFromPrompt(prompt) {
    if (!prompt) return ''
    const matches = detectPromptProjectMentions(prompt)
    return matches.length === 1 ? matches[0] : ''
  }

  function detectPromptProjectMentions(prompt) {
    if (!prompt) return []
    const matches = []
    for (const projectName of listWorkspaceProjects()) {
      const escaped = escapeRegExp(projectName)
      const boundary = '(?=$|[\\s,.;:，。；：])'
      const patterns = [
        new RegExp(`\\bin\\s+${escaped}(?:[\\\\/]|${boundary})`, 'i'),
        new RegExp(`\\bfor\\s+${escaped}(?:[\\\\/]|${boundary})`, 'i'),
        new RegExp(`对\\s*${escaped}\\s*项目`, 'i'),
        new RegExp(`项目\\s*${escaped}${boundary}`, 'i'),
        new RegExp(`project\\s+${escaped}${boundary}`, 'i'),
        new RegExp(`${escaped}\\s*(?:项目|的|中|里|下)`, 'i'),
        new RegExp(`${escaped}\\s+project\\b`, 'i'),
        new RegExp(`${escaped}(?:/|\\\\)`, 'i')
      ]
      if (patterns.some(pattern => pattern.test(prompt))) matches.push(projectName)
    }
    return [...new Set(matches)]
  }

  function detectProjectFromPayload(payload) {
    const strings = collectProjectPayloadStrings(payload).map(normalizeText).filter(Boolean)
    const projects = listWorkspaceProjects()
    const matches = []
    for (const projectName of projects) {
      const hit = strings.some(value => payloadValueMatchesProject(value, projectName))
      if (hit) matches.push(projectName)
    }
    return matches.length === 1 ? matches[0] : ''
  }

  function detectProjectCandidate(prompt, payload) {
    const promptProject = detectProjectFromPrompt(prompt)
    if (promptProject) return { project: promptProject, source: 'prompt' }
    const payloadProject = detectProjectFromPayload(payload)
    if (payloadProject) return { project: payloadProject, source: 'payload' }
    return { project: '', source: '' }
  }

  function detectProjectMentions(prompt, payload) {
    const matches = new Set(detectPromptProjectMentions(prompt))
    const strings = collectProjectPayloadStrings(payload).map(normalizeText).filter(Boolean)
    for (const projectName of listWorkspaceProjects()) {
      if (strings.some(value => payloadValueMatchesProject(value, projectName))) {
        matches.add(projectName)
      }
    }
    return [...matches]
  }

  function payloadValueMatchesProject(value, projectName) {
    const normalizedValue = normalizeText(value)
    const normalizedProject = normalizeText(projectName)
    const projectRoot = normalizeText(path.join(WORKSPACE_ROOT, projectName))
    const workspaceRoot = normalizeText(WORKSPACE_ROOT)
    if (!normalizedValue || !normalizedProject) return false
    if (normalizedValue === normalizedProject) return true
    if (normalizedValue === projectRoot || normalizedValue.startsWith(`${projectRoot}/`)) return true
    const isRemoteUrl = /^[a-z][a-z0-9+.-]*:\/\//.test(normalizedValue) &&
      !normalizedValue.startsWith('file://') &&
      !normalizedValue.includes(workspaceRoot)
    if (isRemoteUrl) return false
    return normalizedValue.startsWith(`${normalizedProject}/`) ||
      normalizedValue.includes(`/${normalizedProject}/`) ||
      normalizedValue.endsWith(`/${normalizedProject}`)
  }

  function getPayloadSessionKey(payload) {
    const candidates = [
      payload.session_id, payload.sessionId, payload.conversation_id, payload.conversationId,
      payload.thread_id, payload.threadId, payload.chat_id, payload.chatId,
      payload.transcript_path, payload.transcriptPath
    ]
    return candidates.map(value => String(value || '').trim()).find(Boolean) || ''
  }

  function getValidStickyProject(previousState, payload) {
    const sticky = previousState?.stickyProject || {}
    const project = String(sticky.project || '').trim()
    if (!project) return null
    const now = Date.now()
    const updatedAtMs = Number(sticky.updatedAtMs || 0)
    if (!updatedAtMs || now - updatedAtMs > STICKY_PROJECT_TTL_MS) return null
    const currentSessionKey = getPayloadSessionKey(payload)
    const stickySessionKey = String(sticky.sessionKey || '').trim()
    if (!currentSessionKey || !stickySessionKey) return null
    if (currentSessionKey && stickySessionKey && currentSessionKey !== stickySessionKey) return null
    return { project, source: sticky.source || 'sticky', sessionKey: stickySessionKey }
  }

  function setStickyProject(state, project, source, payload) {
    if (!project) return
    state.stickyProject = {
      project,
      source: source || 'unknown',
      sessionKey: getPayloadSessionKey(payload),
      updatedAt: new Date().toISOString(),
      updatedAtMs: Date.now()
    }
  }

  function clearStickyProject(state, reason) {
    state.stickyProject = { project: '', source: '', sessionKey: '', updatedAt: '', updatedAtMs: 0, reason: reason || '' }
  }

  function resolvePromptTarget(previousState, payload, prompt, projectCandidate) {
    if (hasMultiProjectExemption(prompt)) {
      return { activeProject: '', activeScope: LAYOUT.enabled ? 'workspace' : 'project', source: 'workspace-exemption', clearSticky: true }
    }
    if (projectCandidate.project) {
      return { activeProject: projectCandidate.project, activeScope: 'project', source: projectCandidate.source || 'explicit' }
    }
    if (CONTEXT_PROJECT) {
      return { activeProject: CONTEXT_PROJECT, activeScope: 'project', source: 'context' }
    }
    if (detectProjectMentions(prompt, payload).length > 1) {
      return { activeProject: '', activeScope: LAYOUT.enabled ? 'workspace' : 'project', source: 'ambiguous-projects', clearSticky: true }
    }
    const sticky = getValidStickyProject(previousState, payload)
    if (sticky) {
      return { activeProject: sticky.project, activeScope: 'project', source: 'sticky' }
    }
    return { activeProject: '', activeScope: LAYOUT.enabled ? 'workspace' : DEFAULT_SCOPE, source: 'workspace' }
  }

  function readModeForPromptTarget(previousState, target) {
    if (target?.activeProject) return readProfileMode(previousState || null, target.activeProject)
    if (target?.activeScope === 'workspace') {
      return readProfileMode({ ...(previousState || {}), activeProject: '', activeScope: 'workspace' }, '')
    }
    return readProfileMode(previousState || null)
  }

  function applyPromptTarget(state, target, payload) {
    state.activeProject = target?.activeProject || ''
    state.activeScope = target?.activeScope || DEFAULT_SCOPE
    state.activeProjectSource = target?.source || ''
    if (target?.clearSticky) {
      clearStickyProject(state, target.source)
    } else if (target?.activeProject && target.source !== 'sticky') {
      setStickyProject(state, target.activeProject, target.source, payload)
    }
  }

  function buildMultiProjectWarningKey(payload) {
    return [
      getPayloadSessionKey(payload) || 'no-session',
      LAYOUT.enabled ? 'workspace-namespace' : 'legacy',
      listWorkspaceProjects().sort().join(',')
    ].join('|')
  }

  function shouldSuppressMultiProjectWarning(state, payload) {
    if (isStrictEnforcement()) return false
    const key = buildMultiProjectWarningKey(payload)
    if (state.lastMultiProjectWarningKey === key) return true
    state.lastMultiProjectWarningKey = key
    return false
  }

  function detectExecutionMode(payload) {
    const prompt = extractUserPrompt(payload)
    return /@devcodex-auto\b/i.test(prompt) ? EXECUTION_MODE.AUTO : EXECUTION_MODE.CONFIRM
  }

  function buildMultiProjectBlockMessage() {
    const profilePath = LAYOUT.enabled ? '.devcodex/workspace/profile/' : '.devcodex/profile/'
    const profileConfigPath = LAYOUT.enabled
      ? '.devcodex/workspace/profile/config.json'
      : '.devcodex/profile/config.json'
    return [
      '⚠️ Multi-project workspace detected.',
      `检测到当前工作区包含多个项目且未在工作区根配置 ${profilePath}。`,
      '请在提示词中明确指定目标项目（如“in cacheHub/”或“对 payment 项目”）后重发。',
      `当前布局期望的 workspace profile 配置为 ${profileConfigPath}；可在工作区根运行 devcodex profile init 生成。`,
      '豁免词：workspace / monorepo / 全工作区 / all projects / 所有项目。'
    ].join(' ')
  }

  return {
    listWorkspaceProjects,
    isMultiProjectWorkspace,
    extractUserPrompt,
    hasMultiProjectExemption,
    detectProjectFromPrompt,
    detectPromptProjectMentions,
    detectProjectFromPayload,
    detectProjectCandidate,
    detectProjectMentions,
    payloadValueMatchesProject,
    getPayloadSessionKey,
    getValidStickyProject,
    setStickyProject,
    clearStickyProject,
    resolvePromptTarget,
    readModeForPromptTarget,
    applyPromptTarget,
    buildMultiProjectWarningKey,
    shouldSuppressMultiProjectWarning,
    detectExecutionMode,
    buildMultiProjectBlockMessage
  }
}

module.exports = { buildLifecycleProjectTargetUtils }
