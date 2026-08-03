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
  resolveWorkspaceProjectTarget,
  escapeRegExp,
  collectProjectPayloadStrings,
  normalizeText,
  readProfileMode,
  readProjectProfileConfig,
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
    const projects = listWorkspaceProjects()
    const matches = []
    const aliases = [...new Set(projects.flatMap(projectName => {
      const leaf = String(projectName).split('/').filter(Boolean).at(-1)
      return leaf && leaf.toLowerCase() !== String(projectName).toLowerCase()
        ? [projectName, leaf]
        : [projectName]
    }))]
    for (const alias of aliases) {
      const escaped = escapeRegExp(alias)
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
      if (!patterns.some(pattern => pattern.test(prompt))) continue
      try {
        const resolved = resolveWorkspaceProjectTarget(WORKSPACE_ROOT, alias)
        matches.push(resolved.namespace)
      } catch (error) {
        if (error?.code === 'PROFILE_TARGET_AMBIGUOUS') matches.push(...(error.candidates || []))
      }
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
    if (projectCandidate.project) {
      return { activeProject: projectCandidate.project, activeScope: 'project', source: projectCandidate.source || 'explicit' }
    }
    if (hasMultiProjectExemption(prompt)) {
      return { activeProject: '', activeScope: LAYOUT.enabled ? 'workspace' : 'project', source: 'workspace-exemption', clearSticky: true }
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

  function isValidAutoAlias(alias) {
    if (typeof alias !== 'string') return false
    const normalized = alias.trim()
    if (normalized.length > 65) return false
    if (!/^@[A-Za-z][A-Za-z0-9_-]*$/.test(normalized)) return false
    const lower = normalized.toLowerCase()
    return !['@devcodex', '@devcodex-auto', '@auto'].includes(lower)
  }

  function hasMentionToken(prompt, alias) {
    const escaped = escapeRegExp(alias)
    // Loose token boundary: allow CJK/punctuation adjacency (请@rocky执行 / （@rocky）),
    // but reject alias glued to other identifier chars (ok@rocky / @rockyish).
    return new RegExp(`(?:^|[^A-Za-z0-9_@])${escaped}(?=$|[^A-Za-z0-9_-])`, 'i').test(String(prompt || ''))
  }

  const DEFAULT_AUTO_ALIASES = ['@rocky']

  function emptyStickyAuto(reason) {
    return {
      active: false,
      source: '',
      kind: '',
      sessionKey: '',
      updatedAt: '',
      updatedAtMs: 0,
      authorityRef: '',
      reason: reason || ''
    }
  }

  function getConfiguredAutoAliases(state, target) {
    if (typeof readProjectProfileConfig !== 'function') return DEFAULT_AUTO_ALIASES.slice()
    const activeProject = target?.activeProject || state?.activeProject || ''
    const cfg = readProjectProfileConfig(state || {}, activeProject)
    const aliases = cfg?.extensions?.devcodex?.autoAliases
    if (aliases === undefined) return DEFAULT_AUTO_ALIASES.slice()
    if (!Array.isArray(aliases)) return []
    const seen = new Set()
    const validAliases = []
    for (const alias of aliases) {
      if (!isValidAutoAlias(alias)) continue
      const normalized = alias.trim()
      const key = normalized.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      validAliases.push(normalized)
    }
    return validAliases
  }

  function resolveAutoAuthorization(prompt, state, target) {
    const text = String(prompt || '')
    if (hasMentionToken(text, '@devcodex-auto')) {
      return { authorized: true, source: '@devcodex-auto', kind: 'explicit' }
    }
    for (const alias of getConfiguredAutoAliases(state, target)) {
      if (hasMentionToken(text, alias)) {
        return { authorized: true, source: alias, kind: 'alias' }
      }
    }
    const normalized = text.replace(/\s+/g, ' ').trim()
    const naturalLanguageAutoPatterns = [
      /(?:进入|启用|开启|使用|切换到)\s*(?:auto|自动|全自动)\s*(?:模式|执行|推进|处理)?/i,
      /(?:auto|自动|全自动)\s*(?:模式)?\s*(?:开始|继续|执行|推进|处理|修复|实施)/i,
      /(?:run|continue|proceed)\s+(?:in\s+)?auto\s+mode/i
    ]
    if (naturalLanguageAutoPatterns.some(pattern => pattern.test(normalized))) {
      return { authorized: true, source: 'natural-language', kind: 'nl' }
    }
    return { authorized: false, source: '', kind: '' }
  }

  function hasAutoAuthorizationPrompt(prompt, state, target) {
    return resolveAutoAuthorization(prompt, state, target).authorized === true
  }

  function hasAutoExitPrompt(prompt) {
    const normalized = String(prompt || '').replace(/\s+/g, ' ').trim()
    if (!normalized) return false
    const exitPatterns = [
      /(?:退出|关闭|停用|结束)\s*(?:auto|自动|全自动)\s*(?:模式)?/i,
      /(?:exit|leave|disable|turn\s+off)\s+(?:auto\s+mode|auto)\b/i,
      /(?:切回|切换到)\s*确认模式/i
    ]
    return exitPatterns.some(pattern => pattern.test(normalized))
  }

  function getValidStickyAuto(state, payload) {
    const sticky = state?.stickyAuto || {}
    if (!sticky.active) return null
    const updatedAtMs = Number(sticky.updatedAtMs || 0)
    if (!updatedAtMs || Date.now() - updatedAtMs > STICKY_PROJECT_TTL_MS) return null
    const currentSessionKey = getPayloadSessionKey(payload)
    const stickySessionKey = String(sticky.sessionKey || '').trim()
    // Fail only on explicit session mismatch. Allow:
    // - both empty (file-scoped sticky for hosts without session ids)
    // - sticky has session but current prompt omits it (common host payload gaps)
    // Reject when both present and differ.
    if (currentSessionKey && stickySessionKey && currentSessionKey !== stickySessionKey) {
      return null
    }
    return sticky
  }

  function setStickyAuto(state, source, kind, payload) {
    if (!state || typeof state !== 'object') return
    const sessionKey = getPayloadSessionKey(payload)
    const now = Date.now()
    const authorityRef = `auto:${source || 'unknown'}:${sessionKey || 'no-session'}:${now}`
    state.stickyAuto = {
      active: true,
      source: source || 'unknown',
      kind: kind || 'unknown',
      sessionKey,
      updatedAt: new Date().toISOString(),
      updatedAtMs: now,
      authorityRef,
      reason: ''
    }
  }

  function clearStickyAuto(state, reason) {
    if (!state || typeof state !== 'object') return
    state.stickyAuto = emptyStickyAuto(reason || '')
  }

  function detectExecutionMode(payload, state, target) {
    const prompt = extractUserPrompt(payload)
    if (hasAutoExitPrompt(prompt)) {
      clearStickyAuto(state, 'user-exit')
      return EXECUTION_MODE.CONFIRM
    }
    const auth = resolveAutoAuthorization(prompt, state, target)
    if (auth.authorized) {
      setStickyAuto(state, auth.source, auth.kind, payload)
      return EXECUTION_MODE.AUTO
    }
    const sticky = getValidStickyAuto(state, payload)
    if (sticky) {
      // Refresh TTL while the same session keeps working under auto.
      state.stickyAuto = {
        ...sticky,
        updatedAt: new Date().toISOString(),
        updatedAtMs: Date.now(),
        reason: ''
      }
      return EXECUTION_MODE.AUTO
    }
    if (state?.stickyAuto?.active) clearStickyAuto(state, 'sticky-expired')
    return EXECUTION_MODE.CONFIRM
  }

  function buildExecutionModeContextMessage(state) {
    const mode = state?.executionMode === EXECUTION_MODE.AUTO ? EXECUTION_MODE.AUTO : EXECUTION_MODE.CONFIRM
    const sticky = state?.stickyAuto || {}
    const stickyActive = mode === EXECUTION_MODE.AUTO && sticky.active === true
    const source = sticky.source || (mode === EXECUTION_MODE.AUTO ? 'prompt' : 'none')
    const authority = sticky.authorityRef ? ` authorityRef=${sticky.authorityRef}` : ''
    if (mode === EXECUTION_MODE.AUTO) {
      return [
        `ExecutionModeV1: auto`,
        `sticky=${stickyActive ? 'true' : 'false'}`,
        `source=${source}${authority}`,
        'CP1/CP2/CP3 auto-pass; do not wait for per-gate user confirmation; S01/S03-S07/C01/C10/C18 not waived; auto whitelist boundary unchanged; exit with 退出auto / exit auto mode'
      ].join(' | ')
    }
    return [
      'ExecutionModeV1: confirm',
      'sticky=false',
      'source=none',
      'confirm mode: wait for explicit CP confirmation'
    ].join(' | ')
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
    hasAutoAuthorizationPrompt,
    hasAutoExitPrompt,
    resolveAutoAuthorization,
    getValidStickyAuto,
    setStickyAuto,
    clearStickyAuto,
    detectExecutionMode,
    buildExecutionModeContextMessage,
    buildMultiProjectBlockMessage
  }
}

module.exports = { buildLifecycleProjectTargetUtils }
