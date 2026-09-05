'use strict'

const crypto = require('crypto')
const { digestSessionRef } = require('./workspace-session-route-index-v1.cjs')
const { separateEmbeddedEvidence } = require('./actual-instruction-envelope.cjs')
const {
  createTaskScopedAutoContinuationGrant,
  transitionTaskScopedAutoContinuationGrant,
  validateTaskScopedAutoContinuationGrant
} = require('./task-recovery-store-v5.cjs')

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
  PROJECT_ROOT_MARKERS,
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

  /**
   * Treat a nearby explicit negation as authoritative for an otherwise positive
   * mode/scope token. This keeps keyword aliases from overriding user intent.
   * @param {string} text
   * @param {number} matchIndex
   * @returns {boolean}
   */
  function isIntentMatchNegated(text, matchIndex) {
    const prefix = String(text || '').slice(Math.max(0, matchIndex - 64), matchIndex)
    return /(?:不要|别|勿|禁止|无需|不(?:要|再|需|应|可|想)?|do\s+not|don['’]?t|dont|never|without|not|no)\s*(?:(?:进入|启用|开启|使用|切换(?:到)?|扫描|处理|覆盖|面向|针对|扩大(?:到)?|执行|继续|调用|采用)|(?:enter|enable|use|switch(?:\s+to)?|scan|process|cover|target|expand(?:\s+to)?|run|continue))?\s*$/i.test(prefix)
  }

  function hasUnnegatedRegexMatch(text, pattern) {
    const source = pattern instanceof RegExp ? pattern.source : String(pattern || '')
    const flags = pattern instanceof RegExp ? pattern.flags.replace(/g/g, '') : 'i'
    const re = new RegExp(source, `${flags}g`)
    let match
    while ((match = re.exec(String(text || ''))) !== null) {
      if (!isIntentMatchNegated(text, match.index)) return true
      if (match[0].length === 0) re.lastIndex += 1
    }
    return false
  }

  function hasMultiProjectExemption(prompt) {
    if (!prompt) return false
    const text = String(prompt)
    return MULTI_PROJECT_EXEMPTION_KEYWORDS.some(keyword => {
      const escaped = escapeRegExp(String(keyword || ''))
      if (!escaped) return false
      return hasUnnegatedRegexMatch(text, new RegExp(escaped, 'i'))
    })
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

  function digestIdentity(value) {
    return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
  }

  function normalizedIdentityPath(value) {
    const resolved = path.resolve(value)
    return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved
  }

  function readPhysicalMarkerIdentity(projectRoot, runtimeRoot) {
    let markerName = (PROJECT_ROOT_MARKERS || []).find(name => fs.existsSync(path.join(projectRoot, name)))
    let markerPath = markerName ? path.join(projectRoot, markerName) : ''
    if (!markerName) {
      markerName = 'canonical-profile'
      markerPath = path.join(runtimeRoot, 'profile')
    }
    let stat
    try { stat = fs.statSync(markerPath) } catch { return null }
    if (markerName === 'canonical-profile' && !stat.isDirectory()) return null
    return {
      markerName,
      markerPath: normalizedIdentityPath(markerPath),
      kind: stat.isDirectory() ? 'directory' : 'file',
      dev: Number.isFinite(Number(stat.dev)) ? Number(stat.dev) : null,
      ino: Number.isFinite(Number(stat.ino)) ? Number(stat.ino) : null
    }
  }

  function currentLayoutIdentity() {
    if (!LAYOUT.enabled) {
      return digestIdentity({ mode: 'legacy-project-root', workspaceRoot: normalizedIdentityPath(WORKSPACE_ROOT) })
    }
    const markerPath = LAYOUT.markerPath || path.join(WORKSPACE_ROOT, '.devcodex', 'layout.json')
    let markerDigest = null
    try { markerDigest = digestIdentity(fs.readFileSync(markerPath, 'utf8')) } catch {}
    return digestIdentity({
      mode: LAYOUT.mode || 'workspace-namespace',
      workspaceRoot: normalizedIdentityPath(WORKSPACE_ROOT),
      markerPath: normalizedIdentityPath(markerPath),
      markerDigest
    })
  }

  function resolveProjectTargetIdentity(project) {
    const raw = String(project || '').trim()
    if (!raw) return null
    let resolved
    if (LAYOUT.enabled) {
      resolved = resolveWorkspaceProjectTarget(WORKSPACE_ROOT, raw)
    } else {
      // In legacy layout the project namespace is the current root basename;
      // it must not be appended as a second path segment.
      if (raw !== path.basename(WORKSPACE_ROOT)) return null
      const physicalRoot = WORKSPACE_ROOT
      resolved = {
        namespace: raw,
        projectRoot: physicalRoot,
        runtimeRoot: path.join(physicalRoot, '.devcodex')
      }
    }
    const physicalMarker = readPhysicalMarkerIdentity(resolved.projectRoot, resolved.runtimeRoot)
    if (!physicalMarker) return null
    const layoutIdentity = currentLayoutIdentity()
    const physicalRoot = path.resolve(resolved.projectRoot)
    const activeRoot = path.resolve(resolved.runtimeRoot)
    const rootIdentityDigest = digestIdentity({
      project: resolved.namespace,
      physicalRoot: normalizedIdentityPath(physicalRoot),
      activeRoot: normalizedIdentityPath(activeRoot),
      physicalMarker
    })
    const targetDigest = digestIdentity({
      rootIdentityDigest,
      layoutIdentity
    })
    return {
      project: resolved.namespace,
      physicalRoot,
      activeRoot,
      physicalMarker,
      layoutIdentity,
      rootIdentityDigest,
      targetDigest
    }
  }

  function projectLeaseAuthority(previousState, payload = {}) {
    const sessionRef = getPayloadSessionKey(payload) ||
      String(previousState?.contextAcquisition?.hostSessionId || '').trim()
    const turnRef = String(previousState?.turnLiveness?.turnKey || '').trim()
    const authorityKind = sessionRef ? 'session' : 'turn'
    const authorityRef = sessionRef || turnRef
    return {
      authorityKind,
      authorityRef,
      authorityDigest: authorityRef ? digestSessionRef(authorityRef) : ''
    }
  }

  function projectLeaseContext(previousState) {
    const acquisition = previousState?.contextAcquisition || {}
    const contextEpoch = String(acquisition.contextEpoch || 'pending').trim()
    const routeRevision = String(
      previousState?.workflowRouteDecision?.routeRevision ||
      previousState?.workflowRoutePlanBinding?.routeRevision ||
      'pending'
    ).trim()
    const explicitBindingDigest = String(previousState?.workflowRoutePlanBinding?.bindingDigest || '').trim()
    const contextBindingDigest = explicitBindingDigest || digestIdentity({
      contextEpoch,
      activeRoot: acquisition.activeRoot ? normalizedIdentityPath(acquisition.activeRoot) : '',
      project: String(acquisition.project || previousState?.activeProject || '').trim(),
      planId: String(acquisition.plan?.planId || acquisition.handoff?.planId || '').trim(),
      planContentId: String(acquisition.plan?.planContentId || acquisition.handoff?.planContentId || '').trim()
    })
    return { contextEpoch, contextBindingDigest, routeRevision }
  }

  function projectLeaseDigestCore(lease) {
    return {
      schemaVersion: 'ProjectTargetLeaseV2',
      project: lease.project,
      targetDigest: lease.targetDigest,
      rootIdentityDigest: lease.rootIdentityDigest,
      layoutIdentity: lease.layoutIdentity,
      physicalRoot: normalizedIdentityPath(lease.physicalRoot),
      activeRoot: normalizedIdentityPath(lease.activeRoot),
      authorityKind: lease.authorityKind,
      authorityDigest: lease.authorityDigest,
      contextEpoch: lease.contextEpoch,
      contextBindingDigest: lease.contextBindingDigest,
      routeRevision: lease.routeRevision,
      revocationEpoch: lease.revocationEpoch,
      issuedAtMs: lease.issuedAtMs,
      expiresAtMs: lease.expiresAtMs
    }
  }

  function validateStickyProjectLease(previousState, payload = {}) {
    const sticky = previousState?.stickyProject || {}
    const project = String(sticky.project || '').trim()
    if (!project) return { valid: false, reason: 'missing-project', lease: null }
    const now = Date.now()
    const expiresAtMs = Number(sticky.expiresAtMs || 0) ||
      Number(Date.parse(sticky.expiresAt || '')) ||
      (Number(sticky.updatedAtMs || 0) + STICKY_PROJECT_TTL_MS)
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
      return { valid: false, reason: 'ttl-expired', lease: null }
    }
    let identity
    try { identity = resolveProjectTargetIdentity(project) } catch (error) {
      return { valid: false, reason: error?.code || 'target-unresolved', lease: null }
    }
    if (!identity) return { valid: false, reason: 'physical-marker-missing', lease: null }
    if (sticky.schemaVersion === 'ProjectTargetLeaseV2') {
      if (sticky.targetDigest !== identity.targetDigest) return { valid: false, reason: 'target-drift', lease: null }
      if (sticky.rootIdentityDigest !== identity.rootIdentityDigest) return { valid: false, reason: 'root-identity-drift', lease: null }
      if (sticky.layoutIdentity !== identity.layoutIdentity) return { valid: false, reason: 'layout-drift', lease: null }
      if (normalizedIdentityPath(sticky.physicalRoot || '') !== normalizedIdentityPath(identity.physicalRoot)) {
        return { valid: false, reason: 'physical-root-drift', lease: null }
      }
      if (normalizedIdentityPath(sticky.activeRoot || '') !== normalizedIdentityPath(identity.activeRoot)) {
        return { valid: false, reason: 'active-root-drift', lease: null }
      }
      const authority = projectLeaseAuthority(previousState, payload)
      if (!authority.authorityDigest) return { valid: false, reason: 'authority-unavailable', lease: null }
      if (sticky.authorityKind !== authority.authorityKind || sticky.authorityDigest !== authority.authorityDigest) {
        return { valid: false, reason: 'session-or-turn-drift', lease: null }
      }
      const context = projectLeaseContext(previousState)
      if (sticky.contextEpoch !== context.contextEpoch) return { valid: false, reason: 'context-epoch-drift', lease: null }
      if (sticky.contextBindingDigest !== context.contextBindingDigest) return { valid: false, reason: 'context-binding-drift', lease: null }
      if (sticky.routeRevision !== context.routeRevision) return { valid: false, reason: 'route-revision-drift', lease: null }
      const expectedLeaseDigest = digestIdentity(projectLeaseDigestCore({ ...sticky, ...identity }))
      if (sticky.leaseDigest !== expectedLeaseDigest) return { valid: false, reason: 'lease-digest-mismatch', lease: null }
    } else if (sticky.schemaVersion === 'ProjectTargetLeaseV1') {
      if (sticky.targetDigest !== identity.targetDigest && sticky.targetDigest !== identity.rootIdentityDigest) {
        return { valid: false, reason: 'target-drift', lease: null }
      }
      if (sticky.layoutIdentity !== identity.layoutIdentity) return { valid: false, reason: 'layout-drift', lease: null }
      const currentSession = getPayloadSessionKey(payload) ||
        String(previousState?.contextAcquisition?.hostSessionId || '').trim()
      if (!currentSession || !String(sticky.sessionKey || '').trim() || currentSession !== String(sticky.sessionKey).trim()) {
        return { valid: false, reason: 'legacy-session-unbound', lease: null }
      }
    } else {
      return { valid: false, reason: 'lease-schema-unsupported', lease: null }
    }
    return {
      valid: true,
      reason: sticky.schemaVersion === 'ProjectTargetLeaseV2' ? '' : 'legacy-revalidated',
      lease: { ...sticky, ...identity, project: identity.project, expiresAtMs }
    }
  }

  function getValidStickyProject(previousState, payload) {
    const validation = validateStickyProjectLease(previousState, payload)
    if (!validation.valid) return null
    if (validation.lease.authorityKind === 'turn' && !getPayloadSessionKey(payload)) return null
    return {
      project: validation.lease.project,
      source: validation.lease.source || 'sticky',
      observedSessionRef: getPayloadSessionKey(payload),
      validationReason: validation.reason,
      lease: validation.lease
    }
  }

  function setStickyProject(state, project, source, payload) {
    if (!project) return
    let identity
    try { identity = resolveProjectTargetIdentity(project) } catch {}
    if (!identity) {
      clearStickyProject(state, 'physical-target-unresolved')
      return
    }
    const validatedAtMs = Date.now()
    const expiresAtMs = validatedAtMs + STICKY_PROJECT_TTL_MS
    const authority = projectLeaseAuthority(state, payload)
    if (!authority.authorityDigest) {
      clearStickyProject(state, 'authority-unavailable')
      return
    }
    const context = projectLeaseContext(state)
    const originalSource = source === 'sticky'
      ? (state?.stickyProject?.source || 'sticky')
      : (source || 'unknown')
    const previous = state?.stickyProject || {}
    const sameBinding = previous.schemaVersion === 'ProjectTargetLeaseV2' &&
      previous.targetDigest === identity.targetDigest &&
      previous.rootIdentityDigest === identity.rootIdentityDigest &&
      previous.layoutIdentity === identity.layoutIdentity &&
      previous.authorityKind === authority.authorityKind &&
      previous.authorityDigest === authority.authorityDigest &&
      previous.contextEpoch === context.contextEpoch &&
      previous.contextBindingDigest === context.contextBindingDigest &&
      previous.routeRevision === context.routeRevision
    const issuedAtMs = sameBinding && Number.isFinite(Number(previous.issuedAtMs))
      ? Number(previous.issuedAtMs)
      : validatedAtMs
    const revocationEpoch = sameBinding
      ? Math.max(0, Number.parseInt(previous.revocationEpoch, 10) || 0)
      : Math.max(0, Number.parseInt(previous.revocationEpoch, 10) || 0) + 1
    const core = {
      schemaVersion: 'ProjectTargetLeaseV2',
      targetDigest: identity.targetDigest,
      rootIdentityDigest: identity.rootIdentityDigest,
      layoutIdentity: identity.layoutIdentity,
      project: identity.project,
      physicalRoot: identity.physicalRoot,
      activeRoot: identity.activeRoot,
      physicalMarker: identity.physicalMarker,
      authorityKind: authority.authorityKind,
      authorityDigest: authority.authorityDigest,
      contextEpoch: context.contextEpoch,
      contextBindingDigest: context.contextBindingDigest,
      routeRevision: context.routeRevision,
      revocationEpoch,
      issuedAt: new Date(issuedAtMs).toISOString(),
      issuedAtMs,
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresAtMs
    }
    const leaseDigest = digestIdentity(projectLeaseDigestCore(core))
    state.stickyProject = {
      ...core,
      leaseId: `project-target-lease-${leaseDigest.slice(0, 24)}`,
      leaseDigest,
      source: originalSource,
      validatedAt: new Date(validatedAtMs).toISOString(),
      validatedAtMs,
      invalidationReason: '',
      observedSessionRef: '',
      sessionKey: '',
      updatedAt: new Date(validatedAtMs).toISOString(),
      updatedAtMs: validatedAtMs
    }
  }

  function clearStickyProject(state, reason) {
    state.stickyProject = {
      schemaVersion: 'ProjectTargetLeaseV2',
      leaseId: '',
      leaseDigest: '',
      targetDigest: '',
      rootIdentityDigest: '',
      layoutIdentity: '',
      project: '',
      physicalRoot: '',
      activeRoot: '',
      authorityKind: '',
      authorityDigest: '',
      contextEpoch: '',
      contextBindingDigest: '',
      routeRevision: '',
      revocationEpoch: 0,
      issuedAt: '',
      issuedAtMs: 0,
      source: '',
      validatedAt: '',
      validatedAtMs: 0,
      expiresAt: '',
      expiresAtMs: 0,
      invalidationReason: reason || '',
      observedSessionRef: '',
      sessionKey: '',
      updatedAt: '',
      updatedAtMs: 0,
      reason: reason || ''
    }
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
    const routeResolution = previousState?.workspaceSessionRouteResolution
    if (routeResolution?.status === 'verified' &&
        routeResolution.source === 'stable-task-id' &&
        String(routeResolution.project || '').trim()) {
      return {
        activeProject: String(routeResolution.project).trim(),
        activeScope: 'project',
        source: 'session-route-task-id'
      }
    }
    if (String(previousState?.stickyProject?.project || '').trim()) {
      const validation = previousState?.stickyProject?.authorityKind === 'turn' && !getPayloadSessionKey(payload)
        ? { valid: false, reason: 'turn-boundary' }
        : validateStickyProjectLease(previousState, payload)
      return {
        activeProject: '',
        activeScope: LAYOUT.enabled ? 'workspace' : DEFAULT_SCOPE,
        source: `sticky-invalid:${validation.reason}`,
        clearSticky: true
      }
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
    } else if (target?.activeProject) {
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

  /** Return the punctuation-bounded clause that owns one authorization candidate. */
  function autoIntentClauseAt(text, matchIndex, matchLength) {
    const source = String(text || '')
    const isBoundary = value => /[\r\n。！？!?；;，,]/.test(value)
    let start = Math.max(0, matchIndex)
    let end = Math.min(source.length, matchIndex + Math.max(0, matchLength))
    while (start > 0 && !isBoundary(source[start - 1])) start -= 1
    while (end < source.length && !isBoundary(source[end])) end += 1
    const rawClause = source.slice(start, end)
    const leadingWhitespace = rawClause.length - rawClause.trimStart().length
    return {
      text: rawClause.trim(),
      matchOffset: Math.max(0, matchIndex - start - leadingWhitespace),
      terminator: source[end] || ''
    }
  }

  /** Keep quoted/code examples outside the authorization channel. */
  function autoIntentMatchIsQuoted(text, matchIndex) {
    const source = String(text || '')
    const pairedQuotes = [['“', '”'], ['‘', '’'], ['「', '」'], ['『', '』']]
    for (const [open, close] of pairedQuotes) {
      if (source.lastIndexOf(open, matchIndex) > source.lastIndexOf(close, matchIndex) &&
          source.indexOf(close, matchIndex) >= 0) return true
    }
    for (const quote of ['`', '"', "'"]) {
      const before = source.slice(0, matchIndex)
      const count = before.split(quote).length - 1
      if (count % 2 === 1 && source.indexOf(quote, matchIndex) >= 0) return true
    }
    return false
  }

  /**
   * Decide one candidate locally so a question cannot authorize, while an
   * independent later clause can still carry an explicit command.
   */
  function autoIntentMatchIsActionable(text, matchIndex, matchLength, options = {}) {
    if (isIntentMatchNegated(text, matchIndex) || autoIntentMatchIsQuoted(text, matchIndex)) return false
    const clause = autoIntentClauseAt(text, matchIndex, matchLength)
    const before = clause.text.slice(0, Math.max(0, clause.matchOffset)).trim()
    const after = clause.text.slice(Math.max(0, clause.matchOffset) + matchLength).trim()
    const questionOrReference = /(?:为什么|为何|怎么|如何|是否|是不是|能否|可否|会不会|有没有|有无|什么意思|\b(?:what|why|how|whether)\b|\bcan\s+(?:we|you|it)\b|\bcould\s+(?:we|you|it)\b|\bwould\s+(?:we|you|it)\b)/i
    if (questionOrReference.test(clause.text)) return false
    if (/[？?]/.test(clause.terminator) || /(?:吗|呢|么)\s*$/.test(clause.text)) return false
    const referenceLead = /(?:检查|核实|验证|测试|分析|审查|评估|讨论|解释|说明|提到|引用|截图|报告|文档|字符串|示例|复现|调查|排查|关于|有关|check|verify|test|analy[sz]e|review|inspect|explain|discuss|quote|mention|document|example)(?:\s*(?:一下|下|过|了|这个|该|当前|有关|关于|the|this))?\s*[:：]?\s*$/i
    if (referenceLead.test(before)) return false
    if (options.kind === 'mention' && /^(?:别名|模式|功能|机制|行为|配置|字符串|示例|是指|是什么意思)/i.test(after)) return false
    if (options.kind === 'natural-language') {
      const commandLead = /^(?:(?:请(?:你)?|麻烦|现在|接下来|然后|随后|直接|马上|立即|好的?|那|就|并|完成(?:检查|修复|验证)?后|根据(?:你的|上述)?建议|按(?:你的|上述)?建议|采纳(?:你的|上述)?建议并?|我(?:确认|同意|授权|要求|决定))\s*)*$/i
      if (!commandLead.test(before)) return false
      if (/^(?:模式|功能|机制|行为|逻辑|实现|问题|bug|缺陷|状态)/i.test(after)) return false
    }
    return true
  }

  function findActionableMentionToken(prompt, alias) {
    const escaped = escapeRegExp(alias)
    const re = new RegExp(`(?:^|[^A-Za-z0-9_@])(${escaped})(?=$|[^A-Za-z0-9_-])`, 'ig')
    const text = String(prompt || '')
    let match
    while ((match = re.exec(text)) !== null) {
      const aliasOffset = match[0].lastIndexOf(match[1])
      const matchIndex = match.index + Math.max(aliasOffset, 0)
      if (autoIntentMatchIsActionable(text, matchIndex, match[1].length, { kind: 'mention' })) return true
    }
    return false
  }

  function hasActionableAutoPattern(text, pattern) {
    const source = pattern instanceof RegExp ? pattern.source : String(pattern || '')
    const flags = pattern instanceof RegExp ? pattern.flags.replace(/g/g, '') : 'i'
    const re = new RegExp(source, `${flags}g`)
    let match
    while ((match = re.exec(String(text || ''))) !== null) {
      if (autoIntentMatchIsActionable(text, match.index, match[0].length, { kind: 'natural-language' })) return true
      if (match[0].length === 0) re.lastIndex += 1
    }
    return false
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
    let text
    try {
      text = separateEmbeddedEvidence(String(prompt || '')).instruction
    } catch {
      return { authorized: false, source: '', kind: '' }
    }
    if (hasMentionToken(text, '@devcodex-auto') && findActionableMentionToken(text, '@devcodex-auto')) {
      return { authorized: true, source: '@devcodex-auto', kind: 'explicit' }
    }
    for (const alias of getConfiguredAutoAliases(state, target)) {
      if (hasMentionToken(text, alias) && findActionableMentionToken(text, alias)) {
        return { authorized: true, source: alias, kind: 'alias' }
      }
    }
    const normalized = text.replace(/[^\S\r\n]+/g, ' ').replace(/\r\n?/g, '\n').trim()
    const naturalLanguageAutoPatterns = [
      /(?:进入|启用|开启|使用|切换到)\s*(?:auto|自动|全自动)\s*(?:模式|执行|推进|处理)?/i,
      /(?:开始|继续)\s*(?:以|按|使用)?\s*(?:auto|自动|全自动)\s*(?:模式|执行|推进|处理)?/i,
      /(?:auto|自动|全自动)\s*(?:模式)?\s*(?:开始|继续|执行|推进|处理|修复|实施)/i,
      /(?:run|continue|proceed)\s+(?:in\s+)?auto\s+mode/i
    ]
    if (naturalLanguageAutoPatterns.some(pattern => hasActionableAutoPattern(normalized, pattern))) {
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
    // Sticky authority is reusable only when both sides expose the same exact,
    // non-empty host session identity. A missing identity remains turn-local.
    if (!currentSessionKey || !stickySessionKey || currentSessionKey !== stickySessionKey) return null
    return sticky
  }

  function setStickyAuto(state, source, kind, payload) {
    if (!state || typeof state !== 'object') return
    const sessionKey = getPayloadSessionKey(payload)
    const now = Date.now()
    const authorityRef = `auto:${source || 'unknown'}:${sessionKey || 'turn-only'}:${now}`
    const sourceMessageDigest = crypto.createHash('sha256').update(extractUserPrompt(payload)).digest('hex')
    if (!sessionKey) {
      state.stickyAuto = {
        ...emptyStickyAuto('missing-session'),
        source: source || 'unknown',
        kind: kind || 'unknown',
        updatedAt: new Date().toISOString(),
        updatedAtMs: now,
        authorityRef,
        sourceMessageDigest
      }
      return
    }
    state.stickyAuto = {
      active: true,
      source: source || 'unknown',
      kind: kind || 'unknown',
      sessionKey,
      updatedAt: new Date().toISOString(),
      updatedAtMs: now,
      authorityRef,
      sourceMessageDigest,
      reason: ''
    }
  }

  function clearStickyAuto(state, reason) {
    if (!state || typeof state !== 'object') return
    state.stickyAuto = emptyStickyAuto(reason || '')
  }

  function formalTaskAutoBinding(state) {
    const task = state?.taskRecoveryBinding
    const projectRootIdentityDigest = String(state?.stickyProject?.rootIdentityDigest || '').trim().toLowerCase()
    if (!task?.taskId || !task.project || !task.taskRoot || !/^[a-f0-9]{64}$/.test(projectRootIdentityDigest)) return null
    const activeRoot = String(state?.stickyProject?.activeRoot || '').trim()
    let taskRootRelative = ''
    if (activeRoot) {
      const relative = path.relative(path.resolve(activeRoot), path.resolve(task.taskRoot)).replace(/\\/g, '/')
      if (relative && relative !== '..' && !relative.startsWith('../') && !path.isAbsolute(relative)) taskRootRelative = relative
    }
    if (!taskRootRelative) taskRootRelative = `${task.kind || 'requirements'}/${task.displayName || task.taskId}`
    return {
      taskId: String(task.taskId).trim().toLowerCase(),
      project: String(task.project).trim(),
      projectRootIdentityDigest,
      taskRootRelative
    }
  }

  function revokeTaskScopedAuto(state, reason) {
    const grant = state?.taskScopedAutoContinuationGrant
    const validation = validateTaskScopedAutoContinuationGrant(grant)
    if (!validation.valid || grant.status === 'revoked' || grant.status === 'terminal-consumed') return false
    state.taskScopedAutoContinuationGrant = transitionTaskScopedAutoContinuationGrant(grant, 'revoked', { reason })
    state.autoCheckpointDecision = null
    state.taskScopedAutoStatus = { status: 'revoked', reason: reason || 'user-exit' }
    return true
  }

  function createTaskScopedAutoFromAuthorization(state, prompt, authorization, sticky = state?.stickyAuto) {
    const binding = formalTaskAutoBinding(state)
    if (!binding || !sticky?.authorityRef) return null
    try {
      const grant = createTaskScopedAutoContinuationGrant({
        ...binding,
        authorityRef: sticky.authorityRef,
        sourceMessageDigest: sticky.sourceMessageDigest || crypto.createHash('sha256').update(String(prompt || '')).digest('hex'),
        allowedScope: {
          scopeClass: 'same-formal-task',
          taskRootRelative: binding.taskRootRelative,
          pathPrefixes: [binding.taskRootRelative],
          actionClasses: ['checkpoint-confirmation', 'same-task-continuation'],
          checkpointPhases: ['CP1', 'CP2', 'CP3']
        },
        riskCeiling: 'R3'
      })
      state.taskScopedAutoContinuationGrant = grant
      state.autoCheckpointDecision = null
      state.taskScopedAutoStatus = {
        status: 'active',
        source: authorization?.source || sticky.source || 'explicit',
        reason: 'explicit-task-scoped-auto-authorization'
      }
      return grant
    } catch (error) {
      state.taskScopedAutoStatus = {
        status: 'reconfirm-required',
        reason: String(error.code || 'task-scoped-auto-grant-invalid')
      }
      return null
    }
  }

  function getValidTaskScopedAuto(state) {
    const grant = state?.taskScopedAutoContinuationGrant
    if (!grant) return null
    const base = validateTaskScopedAutoContinuationGrant(grant)
    if (!base.valid) {
      state.taskScopedAutoStatus = { status: 'reconfirm-required', reason: 'grant-invalid' }
      return null
    }
    const binding = formalTaskAutoBinding(state)
    const expected = binding
      ? validateTaskScopedAutoContinuationGrant(grant, binding)
      : { valid: false, errors: ['task-auto-grant-current-binding-unavailable'] }
    if (!expected.valid) {
      if (grant.status === 'active') {
        state.taskScopedAutoContinuationGrant = transitionTaskScopedAutoContinuationGrant(
          grant,
          'reconfirm-required',
          { reason: expected.errors.join(',') || 'task-root-binding-drift' }
        )
      }
      state.autoCheckpointDecision = null
      state.taskScopedAutoStatus = {
        status: 'reconfirm-required',
        reason: expected.errors.join(',') || 'task-root-binding-drift'
      }
      return null
    }
    if (grant.status !== 'active') {
      state.taskScopedAutoStatus = { status: grant.status, reason: grant.statusReason || grant.status }
      return null
    }
    state.taskScopedAutoStatus = { status: 'active', source: 'durable-task-grant', reason: '' }
    return grant
  }

  function sameTurnNewAdmissionAutoBinding(state, sticky, admissionReadback) {
    const binding = formalTaskAutoBinding(state)
    const transaction = admissionReadback && typeof admissionReadback === 'object'
      ? admissionReadback
      : null
    const envelope = state?.actualInstructionEnvelope
    const route = state?.workflowRouteDecision
    const projectLease = state?.stickyProject
    if (!binding || !transaction || !envelope || !route || !projectLease) {
      return { valid: false, reason: 'same-turn-new-admission-evidence-missing' }
    }
    if (transaction.schemaVersion !== 'TaskAdmissionTransactionV1' ||
        transaction.phase !== 'finalized' || transaction.status !== 'finalized' ||
        transaction.operation !== 'admit' || Number(transaction.admissionGeneration) !== 1) {
      return { valid: false, reason: 'same-turn-new-admission-not-finalized-g1' }
    }
    if (!['new', 'product-provided', 'change', 'fix'].includes(String(transaction.entryVariant || ''))) {
      return { valid: false, reason: 'same-turn-new-admission-entry-invalid' }
    }
    const exactPairs = [
      [transaction.taskId, binding.taskId],
      [transaction.project, binding.project],
      [transaction.projectRootIdentityDigest, binding.projectRootIdentityDigest],
      [transaction.projectRootIdentityDigest, projectLease.rootIdentityDigest],
      [transaction.sessionDigest, projectLease.authorityDigest],
      [transaction.projectTargetLeaseDigest, projectLease.leaseDigest],
      [transaction.hostVariant, envelope.hostVariant],
      [transaction.sourceEventId, envelope.sourceEventId],
      [transaction.actualInstructionDigest, envelope.actualInstructionDigest],
      [transaction.actualInstructionDigest, sticky?.sourceMessageDigest],
      [transaction.workItemId, route.workItemId],
      [transaction.workItemDigest, route.workItemDigest],
      [transaction.workflowRouteDigest, route.decisionDigest],
      [transaction.routeKey, route.routeKey],
      [transaction.routeRevision, route.routeRevision]
    ]
    if (exactPairs.some(([left, right]) => !left || !right || String(left) !== String(right))) {
      return { valid: false, reason: 'same-turn-new-admission-binding-mismatch' }
    }
    const transactionTaskRoot = String(transaction.taskRootRelative || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    const bindingTaskRoot = String(binding.taskRootRelative || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    const unsafeRoot = value => !value || value.split('/').some(segment => !segment || segment === '.' || segment === '..')
    const comparable = value => process.platform === 'win32' ? value.toLowerCase() : value
    if (unsafeRoot(transactionTaskRoot) || unsafeRoot(bindingTaskRoot) ||
        comparable(transactionTaskRoot) !== comparable(bindingTaskRoot)) {
      return { valid: false, reason: 'same-turn-new-admission-task-root-mismatch' }
    }
    return { valid: true, binding }
  }

  function promoteTaskScopedAutoAfterBinding(state, payload, evidence = {}) {
    const existing = state?.taskScopedAutoContinuationGrant || null
    if (existing) {
      const active = getValidTaskScopedAuto(state)
      return active
        ? { status: 'already-active', grant: active }
        : { status: 'not-authorized', reason: state?.taskScopedAutoStatus?.reason || 'existing-grant-not-active' }
    }
    if (state?.executionMode !== EXECUTION_MODE.AUTO) {
      return { status: 'not-authorized', reason: 'execution-mode-not-auto' }
    }
    const sticky = getValidStickyAuto(state, payload)
    if (!sticky) {
      return { status: 'not-authorized', reason: 'same-session-sticky-auto-unavailable' }
    }
    const admissionMatch = sameTurnNewAdmissionAutoBinding(
      state,
      sticky,
      evidence.admissionTransaction
    )
    if (!admissionMatch.valid) {
      return { status: 'not-authorized', reason: admissionMatch.reason }
    }
    const grant = createTaskScopedAutoFromAuthorization(
      state,
      '',
      { source: sticky.source, kind: 'same-turn-task-bind' },
      sticky
    )
    if (!grant) {
      return { status: 'not-authorized', reason: state?.taskScopedAutoStatus?.reason || 'formal-task-binding-unavailable' }
    }
    return { status: 'promoted', grant }
  }

  function detectExecutionMode(payload, state, target) {
    const prompt = extractUserPrompt(payload)
    if (hasAutoExitPrompt(prompt)) {
      revokeTaskScopedAuto(state, 'user-exit')
      clearStickyAuto(state, 'user-exit')
      return EXECUTION_MODE.CONFIRM
    }
    const auth = resolveAutoAuthorization(prompt, state, target)
    if (auth.authorized) {
      setStickyAuto(state, auth.source, auth.kind, payload)
      if (!state?.taskRecoveryBinding?.taskId || createTaskScopedAutoFromAuthorization(state, prompt, auth)) {
        return EXECUTION_MODE.AUTO
      }
      return EXECUTION_MODE.CONFIRM
    }
    if (getValidTaskScopedAuto(state)) {
      return EXECUTION_MODE.AUTO
    }
    const sticky = getValidStickyAuto(state, payload)
    if (sticky) {
      if (state?.taskRecoveryBinding?.taskId) {
        if (createTaskScopedAutoFromAuthorization(state, prompt, { source: sticky.source, kind: 'legacy-sticky' }, sticky)) {
          return EXECUTION_MODE.AUTO
        }
        return EXECUTION_MODE.CONFIRM
      }
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
    const grant = state?.taskScopedAutoContinuationGrant
    const durableActive = mode === EXECUTION_MODE.AUTO && grant?.status === 'active'
    const zh = /^zh/i.test(String(state?.languageContext?.responseLanguage || state?.languageContext?.primaryLanguage || ''))
    if (durableActive) {
      return zh
        ? [
            'ExecutionModeV1: auto',
            '自动续批：已读取当前正式任务的 TaskScopedAutoContinuationGrantV1；授权不依赖 session 或 TTL。',
            `grantDigest=${grant.grantDigest}`,
            '每个 CP 仍须独立冻结候选并生成 AutoCheckpointDecisionV1；只有范围未扩张、风险未增加、无排除副作用且 R3/R4 复审通过才可自动确认。',
            '删除、E 盘修复、验证执行、安装、commit/push/tag、Release、npm publish、权限或 breaking contract 变化必须重新确认；宿主权限不受本授权影响。',
            '可用“退出自动模式”撤销。'
          ].join(' | ')
        : [
            'ExecutionModeV1: auto',
            'Task-scoped automatic continuation is active from TaskScopedAutoContinuationGrantV1 and is independent of session TTL.',
            `grantDigest=${grant.grantDigest}`,
            'Each CP still requires a distinct AutoCheckpointDecisionV1; scope/risk growth or excluded side effects require reconfirmation, and host permissions are unchanged.'
          ].join(' | ')
    }
    if (mode === EXECUTION_MODE.AUTO) {
      return [
        `ExecutionModeV1: auto`,
        `sticky=${stickyActive ? 'true' : 'false'}`,
        `source=${source}${authority}`,
        'CP1/CP2/CP3 auto-pass; do not wait for per-gate user confirmation; S01/S03-S07/C01/C10/C18 not waived; auto whitelist boundary unchanged; exit with 退出auto / exit auto mode'
      ].join(' | ')
    }
    if (grant && grant.status !== 'active') {
      const reason = state?.taskScopedAutoStatus?.reason || grant.statusReason || grant.status
      return zh
        ? `ExecutionModeV1: confirm | 自动续批需要重新确认：${reason}。当前授权不会自动覆盖任务/root、范围、风险或排除项变化。`
        : `ExecutionModeV1: confirm | Task-scoped automatic continuation requires reconfirmation: ${reason}.`
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
    resolveProjectTargetIdentity,
    validateStickyProjectLease,
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
    promoteTaskScopedAutoAfterBinding,
    detectExecutionMode,
    buildExecutionModeContextMessage,
    buildMultiProjectBlockMessage
  }
}

module.exports = { buildLifecycleProjectTargetUtils }
