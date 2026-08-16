'use strict'

const {
  buildContentIdentity,
  buildJsonContentIdentity,
  validateContentIdentity
} = require('./content-identity.cjs')
const { readContextPlanObservation } = require('./context-plan-observation.cjs')
const {
  atomicWriteJson,
  readLifecycleStateCommit,
  updateLifecycleStateCommit
} = require('./lifecycle-state-commit.cjs')

function parseContextToolIdentity (rawName, explicitServer = '') {
  const raw = String(rawName || '').trim()
  const lower = raw.toLowerCase()
  let server = String(explicitServer || '').trim().toLowerCase()
  let tool = lower
  const mcp = lower.match(/^mcp__(.+)__([a-z0-9_]+)$/)
  const doubleUnderscore = lower.match(/^([^_]+(?:-[^_]+)*)__([a-z0-9_]+)$/)
  const pair = lower.match(/^([^/]+)\/([a-z0-9_]+)$/)
  const copilotFlat = lower.match(/^(devcodex-(?:profile|memory))-([a-z0-9_]+)$/)
  if (mcp) {
    server = mcp[1]
    tool = mcp[2]
  } else if (doubleUnderscore) {
    server = doubleUnderscore[1]
    tool = doubleUnderscore[2]
  } else if (pair) {
    server = pair[1]
    tool = pair[2]
  } else if (copilotFlat) {
    server = copilotFlat[1]
    tool = copilotFlat[2]
  }
  if (server === 'devcodex_profile') server = 'devcodex-profile'
  if (server === 'devcodex_memory') server = 'devcodex-memory'
  return { raw, server, tool }
}

/**
 * Classify whether a bounded Memory response proves complete source coverage.
 * Transport/schema success alone must never become observed source success.
 * @param {Record<string, unknown>} body
 * @returns {{status: string, complete: boolean, errorCode: string|null}}
 */
function classifyMemoryCoverage (body) {
  const status = String(body?.coverage?.status || 'missing').trim().toLowerCase()
  if (status === 'complete' || status === 'legacy-complete') {
    return { status, complete: true, errorCode: null }
  }
  return {
    status,
    complete: false,
    errorCode: status === 'partial' ? 'MEMORY_COVERAGE_PARTIAL' : 'MEMORY_COVERAGE_UNVERIFIED'
  }
}

function buildLifecycleBootstrapStateUtils(ctx) {
  const {
    fs,
    path,
    crypto,
    env,
    CONTEXT_ROOT,
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
    listWorkspaceProjects,
    getBootstrapAgent,
    getWorkspaceNamespaceRoot,
    readProfileMode,
    getToolName,
    touchesPath,
    getToolInputStrings,
    getCommandText,
    getPayloadSessionKey,
    getRecentBootstrapTaskStamps,
    isRecentBootstrapTaskPath,
    buildInterceptionOutput,
    INTERCEPTION_ACTION,
    noopOutput,
    emptyGovernanceIntakeState,
    normalizeGovernanceIntakeState,
    createTurnLivenessState,
    normalizeTurnLivenessState,
    CONTEXT_READ_CONTRACT,
    createContextReadReceipt,
    evaluateContextReuse,
    extractContextPlanBody,
    extractContextSourceEvidence,
    markContextReadReceiptStale,
    normalizeCompatibleContextReadPlan,
    normalizeContextReadState,
    normalizeContextToolOutcome,
    recordContextReadAttempt,
    recordContextReadOutcome,
    stableDigest,
    validateContextReadPlan,
    extractToolPaths,
    isSourceCodeMutation
  } = ctx

  const PROFILE_SERVER = 'devcodex-profile'
  const MEMORY_SERVER = 'devcodex-memory'
  const MAX_SESSION_STATE_FILES = 64
  const PROFILE_TOOLS = new Set(['profile_context_plan', 'profile_load'])
  const PROFILE_ROUTE_TOOLS = new Set(['skill_route'])
  const MEMORY_READ_TOOLS = new Set([
    'memory_status',
    'memory_session_query',
    'memory_summary_query',
    'memory_session_read',
    'memory_summary_read'
  ])
  const MEMORY_SCHEMAS = Object.freeze({
    memory_status: 'MemoryStatusV1',
    memory_session_query: 'MemorySessionQueryV1',
    memory_summary_query: 'MemorySummaryQueryV1'
  })
  const CONTEXT_READ_BINDING_SCHEMA = 'ContextReadBindingV1'
  const CONTEXT_READ_BINDING_REQUEST_FIELDS = Object.freeze([
    'schemaVersion', 'contextEpoch', 'planId', 'planContentId', 'activeRoot', 'project'
  ])
  const MUTATION_TOOL_RE = /^(?:apply[_-]?patch|create[_-]?file|write|edit|str[_-]?replace|insert[_-]?code|rewrite[_-]?file)$/i
  const READ_TOOL_RE = /^(?:read(?:[_-]?file)?|list[_-]?dir|file[_-]?search|grep(?:[_-]?search)?|semantic[_-]?search|glob|search[_-]?tool|tool[_-]?search)$/i

  function normalizePath(value) {
    return String(value || '').trim().replace(/\\/g, '/')
  }

  function safeProfileFile(value) {
    const file = String(value || '').trim()
    return !!file && file !== '.' && file !== '..' && !/[\\/\0]/.test(file) &&
      (/\.md$/i.test(file) || ['config.json', 'config.local.json'].includes(file))
  }

  function getToolInput(payload) {
    const input = payload?.tool_input ?? payload?.toolInput ?? payload?.input ?? payload?.arguments ?? {}
    return input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  }

  function getToolCallId(payload) {
    return String(
      payload?.tool_use_id || payload?.toolUseId || payload?.tool_call_id ||
      payload?.toolCallId || payload?.call_id || payload?.callId || ''
    ).trim()
  }

  function canonicalContextTool(payload) {
    const { raw, server, tool } = parseContextToolIdentity(
      getToolName(payload),
      payload?.server_name || payload?.serverName
    )
    if (!server && (PROFILE_TOOLS.has(tool) || PROFILE_ROUTE_TOOLS.has(tool) || MEMORY_READ_TOOLS.has(tool))) {
      return { raw, server: '', tool, canonical: '', recognizedName: true }
    }
    const recognized = (server === PROFILE_SERVER && (PROFILE_TOOLS.has(tool) || PROFILE_ROUTE_TOOLS.has(tool))) ||
      (server === MEMORY_SERVER && MEMORY_READ_TOOLS.has(tool))
    return {
      raw,
      server,
      tool,
      canonical: recognized ? `${server}/${tool}` : '',
      recognizedName: recognized
    }
  }

  function targetProject(state) {
    return String(state?.activeProject || CONTEXT_PROJECT || path.basename(CONTEXT_ROOT)).trim()
  }

  function targetMatches(args, state) {
    const expected = targetProject(state)
    return !args.project || String(args.project).trim() === expected
  }

  function expectedContextReadBinding(acquisition) {
    const plan = acquisition?.plan
    if (!plan) return null
    return {
      schemaVersion: CONTEXT_READ_BINDING_SCHEMA,
      contextEpoch: plan.identity.contextEpoch,
      planId: plan.planId,
      planContentId: plan.planContentId,
      activeRoot: plan.identity.activeRoot,
      project: plan.identity.project,
      compatibleAliases: acquisition.compatibleContextBindings || []
    }
  }

  function isRouteContextReceiptReady(acquisition) {
    if (!acquisition?.plan || !acquisition?.receipt) return false
    if (['relevant-complete', 'escalated-full', 'completed'].includes(
      acquisition.receipt.status
    )) return true
    return acquisition.receipt.status === 'baseline-ready' &&
      !(acquisition.plan.selectedSources?.length ||
        acquisition.plan.mandatorySourceIds?.length)
  }

  function validateContextReadBinding(binding, expected, { response = false } = {}) {
    if (!expected) {
      return binding === undefined || binding === null
        ? { valid: true, status: 'legacy-unbound' }
        : { valid: false, errorCode: 'CONTEXT_BINDING_MISMATCH', reason: 'contextBinding has no live authoritative plan' }
    }
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
      return { valid: false, errorCode: 'CONTEXT_BINDING_INVALID', reason: 'ContextReadBindingV1 is required for plan-bound context reads' }
    }
    const allowed = new Set(response
      ? [...CONTEXT_READ_BINDING_REQUEST_FIELDS, 'bindingStatus', 'verificationMode']
      : CONTEXT_READ_BINDING_REQUEST_FIELDS)
    if (Object.keys(binding).some(key => !allowed.has(key)) ||
        CONTEXT_READ_BINDING_REQUEST_FIELDS.some(key => !Object.prototype.hasOwnProperty.call(binding, key))) {
      return { valid: false, errorCode: 'CONTEXT_BINDING_INVALID', reason: 'contextBinding fields do not match the published schema' }
    }
    if (binding.schemaVersion !== CONTEXT_READ_BINDING_SCHEMA ||
        CONTEXT_READ_BINDING_REQUEST_FIELDS.slice(1, 5).some(key => typeof binding[key] !== 'string' || !binding[key].trim()) ||
        typeof binding.project !== 'string') {
      return { valid: false, errorCode: 'CONTEXT_BINDING_INVALID', reason: 'contextBinding contains an invalid schema or empty identity field' }
    }
    const candidates = [expected, ...(expected.compatibleAliases || [])]
    const identityMatches = candidates.some(candidate =>
      binding.contextEpoch === candidate.contextEpoch &&
      binding.planId === candidate.planId &&
      binding.planContentId === candidate.planContentId &&
      normalizePath(binding.activeRoot) === normalizePath(candidate.activeRoot) &&
      binding.project === candidate.project
    )
    if (!identityMatches) {
      return { valid: false, errorCode: 'CONTEXT_BINDING_MISMATCH', reason: 'contextBinding does not match the live plan identity' }
    }
    if (response && (binding.bindingStatus !== 'verified' || binding.verificationMode !== 'request-bound')) {
      return { valid: false, errorCode: 'CONTEXT_BINDING_MISMATCH', reason: 'context tool response is not request-bound and verified' }
    }
    return { valid: true, status: response ? 'verified' : 'request-bound' }
  }

  function contextError(code, message, nextStep) {
    return {
      schemaVersion: CONTEXT_READ_CONTRACT.schemas.error,
      errorCode: code,
      message,
      nextStep: nextStep || 'Correct the context acquisition input before retrying.'
    }
  }

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

  /** Normalize new and legacy lifecycle state into one ContextReadStateV2 aggregate. */
  function normalizeContextAcquisition(state) {
    const raw = state?.contextAcquisition && typeof state.contextAcquisition === 'object'
      ? state.contextAcquisition
      : {}
    const legacyObserved = {
      profileRead: raw.legacyObserved?.profileRead === true || state?.bootstrap?.profileRead === true,
      summaryRead: raw.legacyObserved?.summaryRead === true || state?.bootstrap?.summaryRead === true,
      tasksRead: raw.legacyObserved?.tasksRead === true || state?.bootstrap?.tasksRead === true,
      bootstrapComplete: false
    }
    const normalized = normalizeContextReadState({
      contextAcquisition: raw,
      bootstrap: legacyObserved
    })
    const inFlight = Array.isArray(raw.inFlight)
      ? raw.inFlight.filter(item => item && typeof item === 'object').slice(-20)
      : []
    const postHistory = Array.isArray(raw.postHistory)
      ? raw.postHistory.filter(item => item && typeof item === 'object').slice(-40)
      : []
    return {
      ...normalized,
      activeRoot: normalizePath(raw.activeRoot || normalized.plan?.identity?.activeRoot || getActiveNamespaceRoot(state)),
      project: String(raw.project || normalized.plan?.identity?.project || targetProject(state)),
      hostCapability: ['structured-plan', 'path-observable', 'instruction-only'].includes(raw.hostCapability)
        ? raw.hostCapability
        : 'instruction-only',
      hostSessionId: String(raw.hostSessionId || ''),
      verificationMode: normalized.receipt?.verificationMode ||
        (['structured-plan', 'path-observable', 'instruction-only'].includes(raw.verificationMode)
          ? raw.verificationMode
          : 'instruction-only'),
      stageTiming: raw.stageTiming && raw.stageTiming.schemaVersion === CONTEXT_READ_CONTRACT.schemas.stageTiming
        ? raw.stageTiming
        : (normalized.plan?.stageTiming || null),
      targetResolved: raw.targetResolved === true,
      inFlight,
      postHistory,
      planAttemptKeys: Array.isArray(raw.planAttemptKeys) ? [...new Set(raw.planAttemptKeys.map(String))].slice(-10) : [],
      failedPlanKeys: Array.isArray(raw.failedPlanKeys) ? [...new Set(raw.failedPlanKeys.map(String))].slice(-10) : [],
      replanCount: Math.max(normalized.replanCount, Number.parseInt(raw.replanCount, 10) || 0),
      conditionalReplanCount: Math.max(0, Number.parseInt(raw.conditionalReplanCount, 10) || 0),
      fallbackAttempts: Math.min(1, Math.max(normalized.fallbackAttempts, Number.parseInt(raw.fallbackAttempts, 10) || 0)),
      fallbackActive: raw.fallbackActive === true,
      lastFallbackReason: String(raw.lastFallbackReason || ''),
      lastWarningKey: String(raw.lastWarningKey || ''),
      lastError: raw.lastError && typeof raw.lastError === 'object' ? raw.lastError : null,
      blockedReason: String(raw.blockedReason || ''),
      lastReuseDecision: raw.lastReuseDecision && typeof raw.lastReuseDecision === 'object'
        ? raw.lastReuseDecision
        : null,
      runtimeCompatibility: raw.runtimeCompatibility && typeof raw.runtimeCompatibility === 'object'
        ? raw.runtimeCompatibility
        : null,
      producerRuntimeIdentity: raw.producerRuntimeIdentity && typeof raw.producerRuntimeIdentity === 'object'
        ? raw.producerRuntimeIdentity
        : null,
      compatibleContextBindings: Array.isArray(raw.compatibleContextBindings)
        ? raw.compatibleContextBindings.filter(item => item && typeof item === 'object').slice(0, 2)
        : [],
      sourceRefreshPending: raw.sourceRefreshPending && typeof raw.sourceRefreshPending === 'object'
        ? raw.sourceRefreshPending
        : null,
      handoff: raw.handoff && typeof raw.handoff === 'object' ? raw.handoff : null,
      legacyObserved,
      bootstrap: normalized.bootstrap
    }
  }

  function syncContextProjection(state) {
    state.contextAcquisition = normalizeContextAcquisition(state)
    state.bootstrap = { ...state.contextAcquisition.bootstrap }
    state.bootstrapComplete = state.contextAcquisition.bootstrap.bootstrapComplete === true
    state.phase = state.bootstrapComplete ? 'active' : 'bootstrapping'
    return state.contextAcquisition
  }

  function hostCapabilityFor(platform, payload) {
    const explicit = String(payload?.devcodexContextCapability || payload?.contextCapability || '').trim()
    const capabilities = ['instruction-only', 'path-observable', 'structured-plan']
    const ceiling = platform === 'claude'
      ? 'structured-plan'
      : (platform === 'codex' || platform === 'grok' || platform === 'copilot' || platform === 'cursor'
          ? 'path-observable'
          : 'instruction-only')
    if (!capabilities.includes(explicit)) return ceiling
    return capabilities.indexOf(explicit) <= capabilities.indexOf(ceiling) ? explicit : ceiling
  }

  /** Start one opaque, target-bound acquisition epoch for a UserPromptSubmit event. */
  function beginContextAcquisition(state, payload, platform) {
    const previous = normalizeContextAcquisition(state)
    const project = targetProject(state)
    const targetResolved = !LAYOUT.enabled || !!state.activeProject
    const handoff = previous.contextEpoch
      ? {
          contextEpoch: previous.contextEpoch,
          planId: previous.plan?.planId || '',
          planContentId: previous.plan?.planContentId || '',
          status: previous.receipt?.status || 'unverified',
          activeRoot: previous.activeRoot,
          project: previous.project
        }
      : previous.handoff
    const launcherEpoch = env?.DEVCODEX_GROK_SINGLE_TURN === '1' &&
      /^ctx-[A-Za-z0-9-]{8,251}$/.test(String(env.DEVCODEX_CONTEXT_EPOCH || ''))
      ? String(env.DEVCODEX_CONTEXT_EPOCH)
      : ''
    const adapterEpoch = env?.DEVCODEX_CONTEXT_EPOCH_SOURCE === 'host-adapter-cli' &&
      /^ctx-[A-Za-z0-9-]{8,251}$/.test(String(env.DEVCODEX_CONTEXT_EPOCH || ''))
      ? String(env.DEVCODEX_CONTEXT_EPOCH)
      : ''
    state.contextAcquisition = {
      schemaVersion: CONTEXT_READ_CONTRACT.schemas.state,
      contextEpoch: launcherEpoch || adapterEpoch || `ctx-${crypto.randomUUID()}`,
      activeRoot: normalizePath(getActiveNamespaceRoot(state)),
      project,
      targetResolved,
      hostCapability: hostCapabilityFor(platform, payload),
      hostSessionId: String(getPayloadSessionKey(payload) || ''),
      verificationMode: hostCapabilityFor(platform, payload) === 'structured-plan'
        ? 'structured-plan'
        : hostCapabilityFor(platform, payload),
      plan: null,
      receipt: null,
      stageTiming: null,
      planCallCount: 0,
      replanCount: 0,
      conditionalReplanCount: 0,
      fallbackAttempts: 0,
      fallbackActive: false,
      lastFallbackReason: '',
      inFlight: [],
      postHistory: [],
      planAttemptKeys: [],
      failedPlanKeys: [],
      lastWarningKey: '',
      lastError: targetResolved
        ? null
        : contextError('CONTEXT_ACTIVE_TARGET_MISMATCH', 'A unique active project is required before context planning.'),
      blockedReason: targetResolved ? '' : 'active-target-ambiguous',
      lastReuseDecision: null,
      sourceRefreshPending: null,
      legacyObserved: { profileRead: false, summaryRead: false, tasksRead: false, bootstrapComplete: false },
      handoff
    }
    syncContextProjection(state)
    return state.contextAcquisition
  }

  /** Invalidate reusable evidence without converting a drift event into a full read. */
  function markContextAcquisitionStale(state, reason = 'scope-drift') {
    const acquisition = syncContextProjection(state)
    if (!acquisition.plan || !acquisition.receipt) return acquisition
    acquisition.receipt = markContextReadReceiptStale(acquisition.receipt, acquisition.plan, reason)
    acquisition.replanCount = Math.max(acquisition.replanCount, acquisition.receipt.replanCount)
    state.contextAcquisition = acquisition
    syncContextProjection(state)
    return state.contextAcquisition
  }

  /** Invalidate delivery evidence only after an observed successful mutation of a selected source. */
  function markContextPostMutationStale(state, payload, platform) {
    const acquisition = syncContextProjection(state)
    if (!acquisition.plan || !acquisition.receipt || ['stale', 'blocked'].includes(acquisition.receipt.status)) return false
    if (!normalizeContextToolOutcome(payload).success) return false
    if (classifyContextAction(payload, platform, state) === 'workflow-closeout') {
      acquisition.sourceRefreshPending = {
        schemaVersion: 'ContextSourceRefreshPendingV1',
        required: true,
        reasonCode: 'workflow-closeout-write',
        actionClass: 'workflow-closeout',
        observedAt: new Date().toISOString()
      }
      state.contextAcquisition = acquisition
      syncContextProjection(state)
      return false
    }
    const rawTool = getToolName(payload).toLowerCase()
    const directMutation = /^(?:write|edit|apply[_-]?patch|create[_-]?file|str[_-]?replace(?:[_-].*)?|insert[_-]?code(?:[_-].*)?|rewrite[_-]?file)$/i.test(rawTool)
    const shellMutation = /^(?:bash|powershell|shell[_-]?command|run[_-]?in[_-]?terminal|run[_-]?terminal[_-]?command)$/i.test(rawTool) &&
      /(?:>{1,2}|\btee\b|\bSet-Content\b|\bOut-File\b|\b(?:cp|mv|rm|touch)\b)/i.test(getCommandText(payload))
    if (!directMutation && !shellMutation) return false
    const selectedPaths = acquisition.plan.selectedSources
      .flatMap(source => source.sourceRefs || [])
      .map(ref => String(ref.path || ''))
      .filter(value => value && !/^[a-z]+:\/\//i.test(value))
      .map(value => normalizePath(path.resolve(value)).toLowerCase())
    if (!selectedPaths.length) return false
    const mutatedPaths = [...new Set(extractToolPaths(payload) || [])]
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .map(value => normalizePath(path.isAbsolute(value) ? path.resolve(value) : path.resolve(CONTEXT_ROOT, value)).toLowerCase())
    const memoryRoot = normalizePath(path.join(acquisition.activeRoot, '.memory')).toLowerCase()
    const hasMemorySource = acquisition.plan.selectedSources.some(source => source.kind === 'memory')
    const touchesSelected = mutatedPaths.some(target =>
      selectedPaths.some(selected => selected === target || selected.startsWith(`${target}/`)) ||
      (hasMemorySource && (target === memoryRoot || target.startsWith(`${memoryRoot}/`)))
    )
    if (!touchesSelected) return false
    markContextAcquisitionStale(state, 'source-digest')
    return true
  }

  function buildDefaultState(mode) {
    const normalizedMode = mode === 'dev' ? 'dev' : 'prod'
    const state = {
      version: 2,
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
        artifactPaths: false,
        artifactStatus: 'unverified',
        artifactEvidenceSource: '',
        artifactMissingItems: [],
        s07OrderStatus: 'unverified'
      },
      productMutationBeforePrecheck: false,
      productMutationCountThisTurn: 0,
      s07ProductWarnEmitted: false,
      stickyProject: {
        project: CONTEXT_PROJECT || '',
        source: CONTEXT_PROJECT ? 'context' : '',
        sessionKey: '',
        updatedAt: '',
        updatedAtMs: 0
      },
      stickyAuto: {
        active: false,
        source: '',
        kind: '',
        sessionKey: '',
        updatedAt: '',
        updatedAtMs: 0,
        authorityRef: '',
        reason: ''
      },
      cp3Runtime: {},
      governanceIntake: emptyGovernanceIntakeState(),
      turnLiveness: createTurnLivenessState(),
      progressiveSkillRouteCoordinator: {
        schemaVersion: 'ActiveReconciliationCoordinatorV1',
        stateFingerprint: '',
        lastHookRunId: '',
        noProgressCount: 0,
        progressCount: 0,
        circuitOpen: false,
        lastTrigger: '',
        lastAction: '',
        lastNoticeFingerprint: '',
        updatedAt: ''
      },
      mutated: false,
      reportTouched: false,
      memoryTouched: false,
      dangerousApprovals: {},
      lastEvent: '',
      lastReason: ''
    }
    state.contextAcquisition = {
      schemaVersion: CONTEXT_READ_CONTRACT.schemas.state,
      contextEpoch: '',
      activeRoot: normalizePath(getActiveNamespaceRoot(state)),
      project: targetProject(state),
      targetResolved: !LAYOUT.enabled || !!state.activeProject,
      hostCapability: 'instruction-only',
      hostSessionId: '',
      verificationMode: 'instruction-only',
      plan: null,
      receipt: null,
      stageTiming: null,
      planCallCount: 0,
      replanCount: 0,
      conditionalReplanCount: 0,
      fallbackAttempts: 0,
      fallbackActive: false,
      inFlight: [],
      postHistory: [],
      planAttemptKeys: [],
      failedPlanKeys: [],
      lastReuseDecision: null,
      sourceRefreshPending: null,
      legacyObserved: { profileRead: false, summaryRead: false, tasksRead: false, bootstrapComplete: false }
    }
    return state
  }

  function sessionStateFile(state, sessionKey) {
    const key = String(sessionKey || '').trim()
    if (!key) return ''
    // Workspace sessions are indexed independently of the last active project;
    // otherwise meta-project drift makes a valid session snapshot unreachable.
    const owner = LAYOUT.enabled ? META_STATE_PATHS : getStatePaths(state)
    const dir = path.join(owner.dir, 'sessions')
    const digest = crypto.createHash('sha256').update(key).digest('hex')
    return path.join(dir, `${digest}.json`)
  }

  function legacySessionStateFiles(sessionKey, metaState) {
    const key = String(sessionKey || '').trim()
    if (!key || !LAYOUT.enabled) return []
    const digest = crypto.createHash('sha256').update(key).digest('hex')
    const projects = new Set([
      String(metaState?.activeProject || '').trim(),
      String(CONTEXT_PROJECT || '').trim(),
      ...listWorkspaceProjects()
    ])
    return [...projects]
      .filter(Boolean)
      .map(project => path.join(getStatePathsFor(project, 'project').dir, 'sessions', `${digest}.json`))
  }

  function pruneSessionStates(dir) {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter(entry => entry.isFile() && /^[a-f0-9]{64}\.json$/.test(entry.name))
        .map(entry => {
          const file = path.join(dir, entry.name)
          return { file, mtimeMs: fs.statSync(file).mtimeMs }
        })
        .sort((left, right) => right.mtimeMs - left.mtimeMs)
    } catch {
      return
    }
    for (const entry of entries.slice(MAX_SESSION_STATE_FILES)) {
      try { fs.unlinkSync(entry.file) } catch {}
    }
  }

  function preferNewerSameSessionContext(sessionState, activeState, sessionKey) {
    if (!sessionState || typeof sessionState !== 'object' ||
        !activeState || typeof activeState !== 'object') return sessionState

    const key = String(sessionKey || '').trim()
    const sessionAcquisition = sessionState.contextAcquisition
    const activeAcquisition = activeState.contextAcquisition
    if (!key || !sessionAcquisition || typeof sessionAcquisition !== 'object' ||
        !activeAcquisition || typeof activeAcquisition !== 'object' ||
        String(sessionAcquisition.hostSessionId || '').trim() !== key ||
        String(activeAcquisition.hostSessionId || '').trim() !== key) return sessionState

    const sessionProject = String(sessionState.activeProject || sessionAcquisition.project || '').trim()
    const activeProject = String(activeState.activeProject || activeAcquisition.project || '').trim()
    if (!sessionProject || activeProject !== sessionProject) return sessionState

    const activeUpdatedAt = Date.parse(String(activeState.updatedAt || ''))
    const sessionUpdatedAt = Date.parse(String(sessionState.updatedAt || ''))
    if (!Number.isFinite(activeUpdatedAt) ||
        (Number.isFinite(sessionUpdatedAt) && activeUpdatedAt <= sessionUpdatedAt)) return sessionState

    return {
      ...sessionState,
      updatedAt: activeState.updatedAt,
      contextAcquisition: JSON.parse(JSON.stringify(activeAcquisition))
    }
  }

  function loadState(modeHint, sessionKey = '') {
    const committed = readLifecycleStateCommit({
      metaDir: META_STATE_PATHS.dir,
      sessionKey
    }, { fs })
    const committedState = committed.status === 'fresh' ? committed.state : null
    const metaState = committedState || readJsonFile(META_STATE_PATHS.file)
    let sessionState = committedState
    if (!(sessionState && typeof sessionState === 'object')) {
      const canonicalSessionFile = sessionStateFile(metaState || buildDefaultState(modeHint), sessionKey)
      sessionState = canonicalSessionFile ? readJsonFile(canonicalSessionFile) : null
      if (!(sessionState && typeof sessionState === 'object')) {
        for (const legacyFile of legacySessionStateFiles(sessionKey, metaState)) {
          const legacy = readJsonFile(legacyFile)
          if (legacy && typeof legacy === 'object') {
            sessionState = legacy
            break
          }
        }
      }
    }
    let saved = sessionState
    if (committed.status !== 'fresh' && saved && typeof saved === 'object' && LAYOUT.enabled) {
      const preferredProject = String(
        saved.activeProject || saved.contextAcquisition?.project || CONTEXT_PROJECT || ''
      ).trim()
      const preferredScope = saved.activeScope || (preferredProject ? 'project' : DEFAULT_SCOPE)
      const activeState = readJsonFile(getStatePathsFor(preferredProject, preferredScope).file)
      saved = preferNewerSameSessionContext(saved, activeState, sessionKey)
    }
    if (!(saved && typeof saved === 'object')) {
      saved = metaState
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
    }
    const startsFreshGovernanceSession = !!sessionKey && !(sessionState && typeof sessionState === 'object')
    const sessionBound = !!(sessionState && typeof sessionState === 'object')
    const mode = modeHint || readProfileMode(saved || metaState || null, saved?.activeProject || metaState?.activeProject || '')
    const current = buildDefaultState(mode)
    if (!saved || typeof saved !== 'object') return current
    const state = {
      ...current,
      ...saved,
      version: 2,
      mode,
      bootstrap: { ...current.bootstrap, ...(saved.bootstrap || {}) },
      visible: { ...current.visible, ...(saved.visible || {}) },
      stickyProject: {
        ...current.stickyProject,
        ...(saved.stickyProject || {}),
        ...(sessionBound ? {} : (metaState?.stickyProject || {}))
      },
      stickyAuto: {
        ...current.stickyAuto,
        ...(saved.stickyAuto || {}),
        ...(sessionBound ? {} : (metaState?.stickyAuto || {}))
      },
      cp3Runtime: { ...current.cp3Runtime, ...(saved.cp3Runtime || {}) },
      governanceIntake: normalizeGovernanceIntakeState(
        startsFreshGovernanceSession ? emptyGovernanceIntakeState() : saved.governanceIntake
      ),
      turnLiveness: normalizeTurnLivenessState(saved.turnLiveness),
      progressiveSkillRouteCoordinator: {
        ...current.progressiveSkillRouteCoordinator,
        ...(saved.progressiveSkillRouteCoordinator || {})
      },
      dangerousApprovals: { ...current.dangerousApprovals, ...(saved.dangerousApprovals || {}) }
    }
    syncContextProjection(state)
    return state
  }

  function saveState(state) {
    syncContextProjection(state)
    state.updatedAt = new Date().toISOString()
    const activePaths = getStatePaths(state)
    const sessionKey = state.contextAcquisition?.hostSessionId
    const sessionFile = sessionStateFile(state, sessionKey)
    const targets = [{ role: 'active', dir: activePaths.dir }]
    if (LAYOUT.enabled && activePaths.file !== META_STATE_PATHS.file) {
      targets.push({ role: 'meta', dir: META_STATE_PATHS.dir })
    }
    if (sessionFile) targets.push({ role: 'session', dir: path.dirname(sessionFile) })
    const commit = updateLifecycleStateCommit({
      metaDir: META_STATE_PATHS.dir,
      identity: {
        project: state.activeProject || state.contextAcquisition?.project || '',
        scope: state.activeScope || DEFAULT_SCOPE,
        sessionKey: sessionKey || ''
      },
      targets,
      readFallback: () => readJsonFile(activePaths.file) || readJsonFile(META_STATE_PATHS.file)
    }, current => preferNewerSameSessionContext(state, current, sessionKey), { fs })
    if (commit.status !== 'committed') {
      const error = new Error(`LifecycleStateCommitV3 failed: ${commit.errorCode || commit.status}`)
      error.code = commit.errorCode || 'LIFECYCLE_STATE_COMMIT_FAILED'
      throw error
    }
    const committedState = commit.state || state
    if (committedState.contextAcquisition) {
      state.contextAcquisition = JSON.parse(JSON.stringify(committedState.contextAcquisition))
    }
    state.updatedAt = committedState.updatedAt || state.updatedAt

    const projectionWarnings = []
    try { atomicWriteJson(activePaths.file, committedState, { fs }) } catch (error) {
      projectionWarnings.push({ role: 'active', file: activePaths.file, message: error.message })
    }
    if (LAYOUT.enabled && activePaths.file !== META_STATE_PATHS.file) {
      const metaState = {
        ...committedState,
        bootstrap: { ...(committedState.bootstrap || {}) },
        visible: { ...(committedState.visible || {}) },
        stickyProject: { ...(committedState.stickyProject || {}) },
        stickyAuto: { ...(committedState.stickyAuto || {}) },
        dangerousApprovals: { ...(committedState.dangerousApprovals || {}) }
      }
      try { atomicWriteJson(META_STATE_PATHS.file, metaState, { fs }) } catch (error) {
        projectionWarnings.push({ role: 'meta', file: META_STATE_PATHS.file, message: error.message })
      }
    }
    if (sessionFile) {
      try {
        atomicWriteJson(sessionFile, committedState, { fs })
        pruneSessionStates(path.dirname(sessionFile))
      } catch (error) {
        projectionWarnings.push({ role: 'session', file: sessionFile, message: error.message })
      }
    }
    return { ...commit, projectionStatus: projectionWarnings.length ? 'warn' : 'persisted', projectionWarnings }
  }

  function resetState(mode, previousState) {
    const state = buildDefaultState(mode)
    state.promptCount = 1
    state.activeProject = previousState?.activeProject || CONTEXT_PROJECT || ''
    state.activeScope = previousState?.activeScope || DEFAULT_SCOPE
    state.activeProjectSource = previousState?.activeProjectSource || (CONTEXT_PROJECT ? 'context' : '')
    state.lastMultiProjectWarningKey = previousState?.lastMultiProjectWarningKey || ''
    state.stickyProject = { ...state.stickyProject, ...(previousState?.stickyProject || {}) }
    state.stickyAuto = { ...state.stickyAuto, ...(previousState?.stickyAuto || {}) }
    state.cp3Runtime = { ...(previousState?.cp3Runtime || {}) }
    state.governanceIntake = normalizeGovernanceIntakeState(previousState?.governanceIntake)
    state.turnLiveness = normalizeTurnLivenessState(previousState?.turnLiveness)
    state.dangerousApprovals = { ...(previousState?.dangerousApprovals || {}) }
    // Per-turn only: set after reset on UserPromptSubmit; never inherit prior match/enforceCount
    state.workspaceSkillAutoMatch = null
    const previousAcquisition = previousState ? normalizeContextAcquisition(previousState) : null
    if (previousAcquisition?.contextEpoch) {
      state.contextAcquisition.handoff = {
        contextEpoch: previousAcquisition.contextEpoch,
        planId: previousAcquisition.plan?.planId || '',
        planContentId: previousAcquisition.plan?.planContentId || '',
        status: previousAcquisition.receipt?.status || 'unverified',
        activeRoot: previousAcquisition.activeRoot,
        project: previousAcquisition.project
      }
    }
    saveState(state)
    return state
  }

  function isReadOnlyBootstrapShellCommand(payload) {
    const command = getCommandText(payload)
    if (!command || !command.trim()) return false
    const lowerCommand = command.toLowerCase()
    if (
      /[`]|\$\(/.test(command) ||
      />{1,2}/.test(command) ||
      /\b(set-content|add-content|out-file|tee|copy-item|move-item|remove-item|new-item|rename-item)\b/i.test(command) ||
      /\b(sc|ac|ni|ri|mi)\b/i.test(command) ||
      /\b(cp|mv|rm|del|erase|touch|mkdir|rmdir|git\s+(?:add|commit|push|tag|checkout|switch|reset|clean)|npm\s+(?:install|publish)|pnpm\s+(?:install|publish)|yarn\s+(?:add|publish))\b/i.test(command)
    ) {
      return false
    }
    const segments = command
      .split(/\s*(?:;|&&|\|\||\|)\s*/)
      .map(value => value.trim())
      .filter(Boolean)
    if (!segments.length) return false
    const safeSegment = /^(?:get-content|cat|type|get-childitem|ls|dir|rg|findstr|select-string|head|tail|more|echo|write-output|test-path|resolve-path|select-object|sort-object|where-object|measure-object|format-(?:table|list)|out-string|convertto-json|git\s+(?:status|diff|show|log|rev-parse|branch)|npm\s+(?:ls|view)|pnpm\s+ls|yarn\s+list|node\s+(?:--check|-[pev]))\b/i
    return segments.every(segment => safeSegment.test(segment)) &&
      /\b(get-content|cat|type|get-childitem|ls|dir|rg|findstr|select-string|head|tail|more|echo|write-output|test-path|resolve-path|git\s+(?:status|diff|show|log|rev-parse|branch)|npm\s+(?:ls|view)|node\s+(?:--check|-[pev]))\b/.test(lowerCommand)
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
      /^run[_-]?terminal[_-]?command$/,
      /^bash$/,
      /^powershell$/,
      /^exec[_-]?command$/
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

  function classifyContextAcquisitionTool(payload, state) {
    const acquisition = syncContextProjection(state)
    const identity = canonicalContextTool(payload)
    const args = getToolInput(payload)
    if (identity.recognizedName && !identity.canonical) {
      return { allowed: false, suspicious: true, reason: 'context tool requires an exact server/tool identity' }
    }
    if (identity.canonical) {
      const requestedProject = String(args.project || '').trim()
      const pendingPlanTarget = identity.tool === 'profile_context_plan' &&
        !acquisition.targetResolved &&
        requestedProject &&
        listWorkspaceProjects().includes(requestedProject)
      if (!targetMatches(args, state) && !pendingPlanTarget) {
        return { allowed: false, suspicious: true, reason: 'context tool target does not match the active project' }
      }
      if (identity.tool === 'skill_route') {
        const op = String(args.op || '').trim()
        const epoch = String(args.contextEpoch || '').trim()
        if (!['catalog', 'commit', 'rebind', 'load_stage', 'status'].includes(op)) {
          return { allowed: false, suspicious: true, reason: 'skill_route requires a published route operation' }
        }
        if (epoch && epoch !== acquisition.contextEpoch) {
          return { allowed: false, suspicious: true, reason: 'skill_route contextEpoch does not match the active acquisition' }
        }
        if (op === 'commit' || op === 'rebind') {
          if (!isRouteContextReceiptReady(acquisition)) {
            return { allowed: false, suspicious: true, reason: `skill_route ${op} requires a completed bound context receipt` }
          }
          const binding = validateContextReadBinding(args.contextBinding, expectedContextReadBinding(acquisition))
          if (!binding.valid) {
            return { allowed: false, suspicious: true, errorCode: binding.errorCode, reason: binding.reason }
          }
        }
        return {
          allowed: true,
          kind: 'route-control',
          ...identity,
          args,
          argsDigest: stableDigest(args),
          sourceIds: []
        }
      }
      if (identity.tool === 'profile_context_plan') {
        const epoch = String(args.contextEpoch || '').trim()
        const planKey = stableDigest({ contextEpoch: acquisition.contextEpoch, canonical: identity.canonical, args })
        if ((!acquisition.targetResolved && !pendingPlanTarget) ||
            !epoch ||
            epoch !== acquisition.contextEpoch) {
          return { allowed: false, suspicious: true, reason: 'profile plan must use the current bound contextEpoch' }
        }
        if (acquisition.failedPlanKeys.includes(planKey)) {
          return { allowed: false, suspicious: true, reason: 'the same failed plan call cannot be retried in this epoch' }
        }
        if (acquisition.planAttemptKeys.includes(planKey) && acquisition.plan) {
          return { allowed: false, suspicious: true, reason: 'the same installed plan call is already recorded for this epoch' }
        }
        return {
          allowed: true,
          kind: 'plan',
          ...identity,
          args,
          argsDigest: stableDigest(args),
          planKey,
          targetProject: pendingPlanTarget ? requestedProject : acquisition.project,
          targetActiveRoot: pendingPlanTarget
            ? normalizePath(getActiveNamespaceRoot(state, requestedProject, 'project'))
            : acquisition.activeRoot,
          sourceIds: []
        }
      }
      if (identity.tool === 'profile_load') {
        const files = Array.isArray(args.files) ? args.files.map(String) : []
        if (args.files !== undefined && !Array.isArray(args.files)) {
          return { allowed: false, suspicious: true, reason: 'profile_load files must be an array' }
        }
        if (files.some(file => !safeProfileFile(file)) || new Set(files).size !== files.length) {
          return { allowed: false, suspicious: true, reason: 'profile_load files must be unique safe top-level Profile names' }
        }
        if (!files.length) {
          return {
            allowed: true,
            kind: 'legacy-profile-full',
            legacyFull: true,
            fallback: true,
            ...identity,
            args,
            argsDigest: stableDigest(args),
            sourceIds: []
          }
        }
        if (acquisition.plan) {
          const selected = new Set(acquisition.plan.profile.selectedFiles)
          if (files.some(file => !selected.has(file))) {
            return { allowed: false, suspicious: true, reason: 'profile_load files exceed the authoritative plan selection' }
          }
          const binding = validateContextReadBinding(args.contextBinding, expectedContextReadBinding(acquisition))
          if (!binding.valid) {
            return { allowed: false, suspicious: true, errorCode: binding.errorCode, reason: binding.reason }
          }
        }
        return {
          allowed: true,
          kind: 'profile-load',
          fallback: !acquisition.plan,
          ...identity,
          args,
          argsDigest: stableDigest(args),
          sourceIds: files.map(file => `profile:${file}`)
        }
      }
      const legacyFull = ['memory_session_read', 'memory_summary_read'].includes(identity.tool)
      const sourceId = `memory:${identity.tool}`
      if (!legacyFull && acquisition.plan && !acquisition.plan.selectedSources.some(source => source.sourceId === sourceId)) {
        return { allowed: false, suspicious: true, reason: 'memory query is not selected by the authoritative plan' }
      }
      if (!legacyFull && acquisition.plan) {
        const binding = validateContextReadBinding(args.contextBinding, expectedContextReadBinding(acquisition))
        if (!binding.valid) {
          return { allowed: false, suspicious: true, errorCode: binding.errorCode, reason: binding.reason }
        }
      }
      return {
        allowed: true,
        kind: legacyFull ? 'legacy-memory-full' : 'memory-query',
        legacyFull,
        fallback: !acquisition.plan || legacyFull,
        ...identity,
        args,
        argsDigest: stableDigest(args),
        sourceIds: legacyFull ? [] : [sourceId]
      }
    }
    if (isBootstrapReadTool(payload, state)) {
      return {
        allowed: true,
        kind: 'raw-targeted',
        canonical: `raw/${getToolName(payload).toLowerCase()}`,
        server: 'raw',
        tool: getToolName(payload).toLowerCase(),
        args,
        argsDigest: stableDigest(args),
        sourceIds: [],
        fallback: true
      }
    }
    return { allowed: false, suspicious: false, reason: '' }
  }

  function docsOnlyPaths(payload) {
    const paths = [...new Set(extractToolPaths(payload) || [])]
    return paths.length > 0 && paths.every(file => {
      const normalized = normalizePath(file).toLowerCase()
      return /(?:^|\/)(?:docs?|website|changelogs?|requirements|bugs|reports?|review-checklists?)(?:\/|$)/.test(normalized) ||
        /(?:\.md|\.mdx|\.txt)$/.test(normalized) || /(?:^|\/)readme(?:\.[^/]+)?$/.test(normalized)
    })
  }

  function workflowCloseoutPaths(payload, state) {
    const rawTool = getToolName(payload).toLowerCase()
    if (/memory_(?:session_write|summary_append|cp_confirm)|memory-(?:session-write|summary-append|cp-confirm)/.test(rawTool)) {
      return true
    }
    const paths = [...new Set(extractToolPaths(payload) || [])]
    if (!paths.length) return false
    const activeRoot = normalizePath(path.resolve(getActiveNamespaceRoot(state))).toLowerCase()
    return paths.every(file => {
      const absolute = normalizePath(path.isAbsolute(file)
        ? path.resolve(file)
        : path.resolve(CONTEXT_ROOT, file)).toLowerCase()
      if (absolute !== activeRoot && !absolute.startsWith(`${activeRoot}/`)) return false
      const relative = absolute.slice(activeRoot.length).replace(/^\/+/, '')
      if (/^(?:profile|skills|prompts|instructions|\.runtime-state)(?:\/|$)/.test(relative)) return false
      return /^(?:\.memory|reports?|data)(?:\/|$)/.test(relative) ||
        /^(?:requirements|bugs|optimizations|scenario-tests)\/[^/]+\/(?:reports?|\.memory|data)(?:\/|$)/.test(relative)
    })
  }

  function classifyContextAction(payload, platform, state, knownAcquisition) {
    const acquisition = knownAcquisition || classifyContextAcquisitionTool(payload, state)
    if (acquisition.allowed) return 'context-read'
    if (isClarificationTool(payload) || READ_TOOL_RE.test(getToolName(payload))) return 'analysis-read'
    const tool = getToolName(payload).toLowerCase()
    const command = getCommandText(payload)
    if (/\b(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:test|check|validate)|\bnode\s+scripts\/(?:test|check|validate)[^\s]*/i.test(command) ||
      /(?:^|[_-])(?:test|validate|check)(?:[_-]|$)/i.test(tool)) return 'test-execution'
    if (/\b(?:npm\s+publish|git\s+(?:push|tag)|gh\s+release|devcodex\s+release)\b/i.test(command) || /(?:publish|release)/i.test(tool)) {
      return 'release'
    }
    const mutationTool = MUTATION_TOOL_RE.test(tool) || isSourceCodeMutation(payload, platform, state)
    if (workflowCloseoutPaths(payload, state) && (mutationTool || /memory_(?:session_write|summary_append|cp_confirm)/.test(tool))) {
      return 'workflow-closeout'
    }
    if (mutationTool) return docsOnlyPaths(payload) ? 'docs-mutation' : 'source-mutation'
    if (/^(?:shell[_-]?command|run[_-]?in[_-]?terminal|send[_-]?to[_-]?terminal|run[_-]?terminal[_-]?command|bash|powershell|exec[_-]?command)$/i.test(tool)) {
      if (isReadOnlyBootstrapShellCommand(payload) ||
        /^\s*(?:git\s+(?:status|diff|show|log)|npm\s+(?:ls|view)|node\s+-[pev]|rg\b|get-|ls\b|dir\b)/i.test(command)) {
        return 'analysis-read'
      }
    }
    return 'dangerous'
  }

  function activateFallback(acquisition, reason) {
    if (!acquisition.fallbackActive) {
      acquisition.fallbackActive = true
      acquisition.fallbackAttempts = 1
      acquisition.lastFallbackReason = String(reason || 'structured context acquisition unavailable')
    }
    if (acquisition.hostCapability !== 'instruction-only') acquisition.verificationMode = 'path-observable'
  }

  /** Record a bounded attempt and action-envelope decision; never records read success. */
  function recordContextPreToolUse(state, payload, platform) {
    const acquisition = syncContextProjection(state)
    const classified = classifyContextAcquisitionTool(payload, state)
    const actionClass = classifyContextAction(payload, platform, state, classified)
    const priorStatus = acquisition.receipt?.status || ''
    if (classified.suspicious) {
      acquisition.lastError = contextError(classified.errorCode || 'CONTEXT_PLAN_INVALID', classified.reason)
    }
    if (classified.allowed) {
      if (classified.fallback) activateFallback(acquisition, classified.kind)
      if (classified.kind === 'plan') {
        acquisition.planCallCount += 1
        if (!acquisition.planAttemptKeys.includes(classified.planKey)) {
          acquisition.planAttemptKeys.push(classified.planKey)
          acquisition.planAttemptKeys = acquisition.planAttemptKeys.slice(-10)
        }
      } else if (acquisition.plan &&
          acquisition.receipt &&
          !classified.legacyFull &&
          classified.kind !== 'route-control') {
        acquisition.receipt = recordContextReadAttempt(acquisition.receipt, acquisition.plan, {
          toolCallId: getToolCallId(payload),
          actionClass,
          activeRoot: acquisition.activeRoot,
          riskHint: acquisition.plan.identity.intentSeed.riskHint,
          sourceIds: classified.sourceIds
        })
      }
      const entry = {
        attemptId: `pre-${crypto.randomUUID()}`,
        toolCallId: getToolCallId(payload),
        contextEpoch: acquisition.contextEpoch,
        activeRoot: classified.targetActiveRoot || acquisition.activeRoot,
        project: classified.targetProject || acquisition.project,
        canonical: classified.canonical,
        server: classified.server,
        tool: classified.tool,
        kind: classified.kind,
        args: classified.args,
        argsDigest: classified.argsDigest,
        planKey: classified.planKey || '',
        sourceIds: classified.sourceIds,
        actionClass,
        startedAt: new Date().toISOString()
      }
      const duplicatePre = entry.toolCallId && acquisition.inFlight.some(item =>
        item.toolCallId === entry.toolCallId && item.contextEpoch === entry.contextEpoch
      )
      if (!duplicatePre) acquisition.inFlight = [...acquisition.inFlight, entry].slice(-20)
      if (classified.kind === 'legacy-profile-full') acquisition.legacyObserved.profileRead = true
      if (classified.kind === 'legacy-memory-full') {
        if (classified.tool === 'memory_summary_read') acquisition.legacyObserved.summaryRead = true
        if (classified.tool === 'memory_session_read') acquisition.legacyObserved.tasksRead = true
      }
    } else if (acquisition.plan && acquisition.receipt) {
      acquisition.receipt = recordContextReadAttempt(acquisition.receipt, acquisition.plan, {
        toolCallId: getToolCallId(payload),
        actionClass,
        activeRoot: acquisition.activeRoot,
        riskHint: acquisition.plan.identity.intentSeed.riskHint,
        sourceIds: []
      })
    }
    if (acquisition.receipt?.status === 'stale' && priorStatus !== 'stale') {
      acquisition.replanCount = Math.max(acquisition.replanCount, acquisition.receipt.replanCount)
    }
    state.contextAcquisition = acquisition
    if (classified.kind === 'raw-targeted') updateBootstrapState(state, payload)
    else syncContextProjection(state)
    return { acquisition: state.contextAcquisition, classified, actionClass }
  }

  /** Return only context-gate strength; Auto, CP, permission, and danger remain downstream owners. */
  function getContextAcquisitionDecision(state, preResult) {
    const acquisition = syncContextProjection(state)
    if (acquisition.bootstrap.bootstrapComplete) return { status: 'complete', hardBlockEligible: false }
    if (preResult?.classified?.allowed || preResult?.actionClass === 'analysis-read') {
      return { status: 'allowed-read', hardBlockEligible: false }
    }
    const hardBlockEligible = acquisition.hostCapability === 'structured-plan' &&
      acquisition.targetResolved && !acquisition.fallbackActive
    return {
      status: acquisition.receipt?.status || (acquisition.plan ? 'planned' : 'unverified'),
      hardBlockEligible,
      reason: acquisition.receipt?.status === 'stale' ? 'scope-drift requires one replan' : 'context evidence is incomplete'
    }
  }

  function parseExactJson(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value
    if (typeof value !== 'string') return null
    let text = value.trim()
    const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
    if (fenced) text = fenced[1].trim()
    try {
      const parsed = JSON.parse(text)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  function invalidateStructuredReceipt(acquisition, message) {
    if (acquisition.plan) {
      acquisition.receipt = createContextReadReceipt(acquisition.plan, {
        verificationMode: 'instruction-only',
        hostSessionId: acquisition.hostSessionId
      })
    }
    acquisition.verificationMode = acquisition.hostCapability === 'instruction-only'
      ? 'instruction-only'
      : 'path-observable'
    acquisition.lastError = contextError('CONTEXT_PLAN_INVALID', message)
    acquisition.blockedReason = 'ambiguous-post-evidence'
  }

  function findPostAttempt(acquisition, state, payload, resultDigest) {
    const identity = canonicalContextTool(payload)
    const canonical = identity.canonical ||
      (isBootstrapReadTool(payload, state)
        ? `raw/${getToolName(payload).toLowerCase()}`
        : '')
    const toolCallId = getToolCallId(payload)
    if (toolCallId) {
      const prior = acquisition.postHistory.find(item =>
        item.toolCallId === toolCallId && item.contextEpoch === acquisition.contextEpoch && item.canonical === canonical
      )
      if (prior) return { prior, canonical, toolCallId, attempt: null }
      const attempt = acquisition.inFlight.find(item =>
        item.toolCallId === toolCallId && item.contextEpoch === acquisition.contextEpoch && item.canonical === canonical
      )
      return { prior: null, canonical, toolCallId, attempt: attempt || null }
    }
    const candidates = acquisition.inFlight.filter(item =>
      item.contextEpoch === acquisition.contextEpoch && item.canonical === canonical
    )
    const priorCandidates = candidates.length === 0
      ? acquisition.postHistory.filter(item => item.contextEpoch === acquisition.contextEpoch && item.canonical === canonical)
      : []
    return {
      prior: priorCandidates.length === 1 ? priorCandidates[0] : null,
      canonical,
      toolCallId: '',
      attempt: candidates.length === 1 ? candidates[0] : null,
      ambiguous: candidates.length > 1 || priorCandidates.length > 1,
      digestMatch: priorCandidates.length === 1 && priorCandidates[0].resultDigest === resultDigest
    }
  }

  function currentRefDigest(ref) {
    try {
      const stat = fs.statSync(ref.path)
      if (!stat.isFile()) return null
      return stableDigest({
        path: normalizePath(ref.path),
        layer: ref.layer,
        exists: true,
        size: stat.size,
        mtimeMs: stat.mtimeMs
      })
    } catch {
      return null
    }
  }

  function splitProfileSections(text) {
    const headings = []
    const regex = /^### ([^\r\n]+)\r?$/gm
    let match
    while ((match = regex.exec(text)) !== null) {
      const file = match[1].trim()
      if (safeProfileFile(file)) headings.push({ file, start: match.index, bodyStart: regex.lastIndex })
    }
    return headings.map((heading, index) => ({
      ...heading,
      body: text.slice(heading.bodyStart, headings[index + 1]?.start ?? text.length).trim()
    }))
  }

  function parseProfileSectionEnvelope(body) {
    const lines = String(body || '').replace(/\r\n/g, '\n').split('\n')
    while (lines[0] === '') lines.shift()
    while (lines[lines.length - 1] === '') lines.pop()
    if (lines[lines.length - 1]?.trim() === '---') lines.pop()
    while (lines[lines.length - 1] === '') lines.pop()
    if (!/^> 来源：.+$/.test(lines[0] || '')) return { valid: false, paths: [], content: '' }
    let index = 1
    const paths = []
    while (/^> 路径：.+$/.test(lines[index] || '')) {
      paths.push(normalizePath(lines[index].slice('> 路径：'.length)))
      index += 1
    }
    if (!paths.length) return { valid: false, paths: [], content: '' }
    if (lines[index] === '') index += 1
    return {
      valid: true,
      paths,
      content: lines.slice(index).join('\n')
    }
  }

  function parseProfileLoadReceipt(text) {
    const match = /<!-- profile_load_budget (\{[^\r\n]*\}) -->/.exec(String(text || ''))
    if (!match) return null
    try {
      const parsed = JSON.parse(match[1])
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  function buildFailedSourceEvidence(plan, attempt, outcome) {
    return attempt.sourceIds.map(sourceId => {
      const selected = plan.selectedSources.find(source => source.sourceId === sourceId)
      return {
        observationId: `post-${attempt.attemptId}-${sourceId}`,
        toolCallId: attempt.toolCallId,
        sourceId,
        contextEpoch: attempt.contextEpoch,
        planId: plan.planId,
        activeRoot: attempt.activeRoot,
        sourceLayer: selected?.sourceLayer || '',
        outcome: outcome.error ? 'failed' : 'unobservable',
        successful: false,
        observable: outcome.observable,
        transportSuccess: outcome.transportSuccess,
        sourceRefsMatch: false,
        schemaMatch: false,
        targetMatch: false,
        resultDigest: outcome.resultDigest
      }
    })
  }

  function profileSourceResults(acquisition, attempt, outcome) {
    const plan = acquisition.plan
    if (!outcome.transportSuccess) return { sourceResults: buildFailedSourceEvidence(plan, attempt, outcome), drift: false }
    const sections = splitProfileSections(outcome.text)
    const requestedFiles = attempt.args.files.map(String)
    const headingFiles = sections.map(section => section.file)
    const duplicate = new Set(headingFiles).size !== headingFiles.length
    const extra = headingFiles.some(file => !requestedFiles.includes(file))
    const receipt = parseProfileLoadReceipt(outcome.text)
    const binding = validateContextReadBinding(
      receipt?.contextBinding,
      expectedContextReadBinding(acquisition),
      { response: true }
    )
    if (!binding.valid) acquisition.lastError = contextError(binding.errorCode, binding.reason)
    let drift = false
    const sourceResults = requestedFiles.map(file => {
      const sourceId = `profile:${file}`
      const selected = plan.selectedSources.find(source => source.sourceId === sourceId)
      const matches = sections.filter(section => section.file === file)
      const section = matches[0]
      const missingMarker = /（(?:⚠️\s*)?必需文件不存在）|（文件不存在，跳过）/.test(section?.body || '')
      const envelope = parseProfileSectionEnvelope(section?.body)
      const paths = envelope.paths
      const expectedRefs = new Map((selected?.sourceRefs || []).map(ref => [normalizePath(ref.path).toLowerCase(), ref]))
      const observedRefs = paths.map(value => expectedRefs.get(value.toLowerCase())).filter(Boolean)
      const refsMatch = !!selected && paths.length > 0 && observedRefs.length === paths.length &&
        new Set(paths.map(value => value.toLowerCase())).size === paths.length
      for (const ref of observedRefs) {
        if (!ref.exists || currentRefDigest(ref) !== ref.metadataDigest) drift = true
      }
      const layers = [...new Set(observedRefs.map(ref => ref.layer))]
      const valid = binding.valid && !!selected && matches.length === 1 && !duplicate && !extra && !missingMarker &&
        envelope.valid && refsMatch && !drift
      const contentIdentity = envelope.valid
        ? buildContentIdentity({
            sourceKey: `profile://${acquisition.project}/${file}#delivered`,
            content: envelope.content,
            contractVersion: 'ProfileBodyV1'
          })
        : null
      return {
        observationId: `post-${attempt.attemptId}-${sourceId}`,
        toolCallId: attempt.toolCallId,
        sourceId,
        contextEpoch: attempt.contextEpoch,
        planId: plan.planId,
        activeRoot: attempt.activeRoot,
        sourceLayer: layers.length === 1 ? layers[0] : selected?.sourceLayer,
        outcome: valid ? 'observed-success' : (missingMarker || !section ? 'missing' : 'invalid'),
        successful: valid,
        observable: outcome.observable,
        transportSuccess: outcome.transportSuccess,
        sourceRefsMatch: refsMatch && !duplicate && !extra,
        schemaMatch: binding.valid,
        targetMatch: binding.valid,
        contentIdentity,
        bodyObserved: valid,
        hostSessionId: acquisition.hostSessionId,
        bytes: Buffer.byteLength(envelope.content, 'utf8'),
        chars: envelope.content.length,
        hostDeliveredBytes: Buffer.byteLength(envelope.content, 'utf8')
      }
    })
    return { sourceResults, drift }
  }

  function memorySourceResults(acquisition, attempt, outcome) {
    const plan = acquisition.plan
    const sourceId = attempt.sourceIds[0]
    const selected = plan.selectedSources.find(source => source.sourceId === sourceId)
    const body = outcome.transportSuccess ? parseExactJson(outcome.payload) : null
    const expectedSchema = MEMORY_SCHEMAS[attempt.tool]
    const schemaMatch = !!body && body.schemaVersion === expectedSchema
    const source = body?.source && typeof body.source === 'object' ? body.source : {}
    const target = body?.target && typeof body.target === 'object' ? body.target : source
    const resultRoot = normalizePath(body?.activeRoot || target.activeRoot || source.activeRoot)
    const resultProject = String(body?.project || target.project || source.project || '').trim()
    const targetMatch = resultRoot === acquisition.activeRoot && resultProject === acquisition.project
    const query = body?.query && typeof body.query === 'object' ? body.query : {}
    const queryFields = ['date', 'sessionId', 'status', 'handoffOnly', 'since']
    const queryMatch = attempt.tool === 'memory_status' || queryFields.every(field =>
      attempt.args[field] === undefined || stableDigest(query[field]) === stableDigest(attempt.args[field])
    )
    const binding = validateContextReadBinding(
      body?.contextBinding,
      expectedContextReadBinding(acquisition),
      { response: true }
    )
    if (!binding.valid) acquisition.lastError = contextError(binding.errorCode, binding.reason)
    const identityProjection = body && typeof body === 'object'
      ? Object.fromEntries(Object.entries(body).filter(([key]) => ![
          'contentIdentity',
          'contextObservation',
          'telemetry'
        ].includes(key)))
      : null
    const computedProjectionIdentity = identityProjection
      ? buildJsonContentIdentity({
          sourceKey: `memory://${acquisition.project}/${attempt.tool}#delivered`,
          value: identityProjection,
          contractVersion: expectedSchema
        })
      : null
    const computedIdentity = computedProjectionIdentity?.identity || null
    const suppliedIdentityValid = !body?.contentIdentity || (
      validateContentIdentity(body.contentIdentity).valid &&
      stableDigest(body.contentIdentity) === stableDigest(computedIdentity)
    )
    const coverage = classifyMemoryCoverage(body || {})
    if (outcome.transportSuccess && !coverage.complete && binding.valid) {
      acquisition.lastError = contextError(
        coverage.errorCode,
        `Memory response coverage=${coverage.status}; continue the bounded query before claiming source completion.`
      )
    }
    const successful = outcome.transportSuccess && schemaMatch && targetMatch && queryMatch &&
      binding.valid && !!selected && suppliedIdentityValid && coverage.complete
    return [{
      observationId: `post-${attempt.attemptId}-${sourceId}`,
      toolCallId: attempt.toolCallId,
      sourceId,
      contextEpoch: attempt.contextEpoch,
      planId: plan.planId,
      activeRoot: attempt.activeRoot,
      sourceLayer: 'memory-query',
      outcome: successful
        ? 'observed-success'
        : (outcome.error ? 'failed' : (!coverage.complete ? 'partial' : 'invalid')),
      successful,
      observable: outcome.observable,
      transportSuccess: outcome.transportSuccess,
      sourceRefsMatch: !!selected && queryMatch,
      schemaMatch: schemaMatch && suppliedIdentityValid && binding.valid,
      targetMatch: targetMatch && binding.valid,
      contentIdentity: computedIdentity,
      bodyObserved: successful,
      hostSessionId: acquisition.hostSessionId,
      coverageStatus: coverage.status,
      errorCode: successful ? null : coverage.errorCode,
      bytes: computedIdentity?.bytes ?? null,
      chars: computedProjectionIdentity?.canonicalJson.length ?? null,
      hostDeliveredBytes: outcome.telemetry.bytes
    }]
  }

  function applySourceResults(acquisition, attempt, payload, sourceResults) {
    const extracted = extractContextSourceEvidence(acquisition.plan, payload, {
      sourceResults,
      toolCallId: attempt.toolCallId,
      contextEpoch: attempt.contextEpoch,
      planId: acquisition.plan.planId,
      activeRoot: attempt.activeRoot
    })
    const evidence = extracted.evidence.length ? extracted.evidence : sourceResults
    for (const item of evidence) {
      acquisition.receipt = recordContextReadOutcome(acquisition.receipt, acquisition.plan, item)
    }
    if (acquisition.stageTiming?.schemaVersion === CONTEXT_READ_CONTRACT.schemas.stageTiming) {
      const successful = evidence.filter(item => item.successful === true && item.bodyObserved === true)
      const sum = field => successful.reduce((total, item) => total + (Number.isFinite(item[field]) ? item[field] : 0), 0)
      acquisition.stageTiming = {
        ...acquisition.stageTiming,
        returnedBodyBytes: Number(acquisition.stageTiming.returnedBodyBytes || 0) + sum('bytes'),
        hostDeliveredBytes: Number(acquisition.stageTiming.hostDeliveredBytes || 0) + sum('hostDeliveredBytes')
      }
    }
  }

  function installObservedPlan(acquisition, attempt, payload) {
    let extracted = extractContextPlanBody(payload)
    let plan = extracted.plan
    const inlineBody = extracted.outcome?.transportSuccess
      ? parseExactJson(extracted.outcome.payload)
      : null
    if (!plan && extracted.outcome?.transportSuccess && typeof extracted.outcome.payload === 'string' && !inlineBody) {
      const recovered = readContextPlanObservation({
        activeRoot: attempt.activeRoot,
        project: attempt.project,
        contextEpoch: acquisition.contextEpoch,
        notBefore: attempt.startedAt
      })
      if (recovered.status === 'fresh') {
        plan = recovered.plan
        extracted = {
          ...extracted,
          plan,
          originalPlan: recovered.originalPlan,
          originalContextBinding: recovered.originalContextBinding,
          producerIdentity: recovered.producerIdentity,
          compatibilityReceipt: recovered.compatibilityReceipt,
          error: null,
          recoveredFrom: 'workspace-context-plan-observation'
        }
      } else {
        extracted = {
          ...extracted,
          error: contextError(
            'CONTEXT_PLAN_INVALID',
            `Truncated plan result has no matching exact workspace observation: ${recovered.errorCode || recovered.status}.`
          )
        }
      }
    }
    const compatibility = plan
      ? normalizeCompatibleContextReadPlan(plan, {
          producerIdentity: extracted.producerIdentity || null
        })
      : null
    if (compatibility && !compatibility.valid) {
      if (!acquisition.failedPlanKeys.includes(attempt.planKey)) acquisition.failedPlanKeys.push(attempt.planKey)
      activateFallback(acquisition, compatibility.error.message)
      acquisition.lastError = compatibility.error
      return false
    }
    if (compatibility?.valid) {
      plan = compatibility.plan
      extracted.compatibilityReceipt = extracted.compatibilityReceipt || compatibility.receipt
    }
    const identityMatches = !!plan && !!plan.identity &&
      plan.identity.contextEpoch === acquisition.contextEpoch &&
      normalizePath(plan.identity.activeRoot) === normalizePath(attempt.activeRoot) &&
      plan.identity.project === attempt.project &&
      String(attempt.args.contextEpoch || '') === acquisition.contextEpoch
    if (!identityMatches) {
      if (!acquisition.failedPlanKeys.includes(attempt.planKey)) acquisition.failedPlanKeys.push(attempt.planKey)
      acquisition.failedPlanKeys = acquisition.failedPlanKeys.slice(-10)
      activateFallback(acquisition, extracted.error?.message || 'plan result identity is not observable or does not match')
      acquisition.lastError = extracted.error || contextError(
        'CONTEXT_ACTIVE_TARGET_MISMATCH',
        'Observed plan does not match the current epoch, root, or project.'
      )
      return false
    }
    const validation = validateContextReadPlan(plan)
    if (!validation.valid) {
      if (!acquisition.failedPlanKeys.includes(attempt.planKey)) acquisition.failedPlanKeys.push(attempt.planKey)
      activateFallback(acquisition, validation.error.message)
      acquisition.lastError = validation.error
      return false
    }
    const priorPlan = acquisition.plan
    const priorReceipt = acquisition.receipt
    if (priorPlan && priorPlan.planId !== plan.planId) {
      const conditional = Array.isArray(attempt.args.profileSelectors) && attempt.args.profileSelectors.length > 0 &&
        !!attempt.args.baselineDigest && acquisition.conditionalReplanCount < 1
      const driftReplan = ['stale', 'blocked'].includes(acquisition.receipt?.status)
      if (!conditional && !driftReplan) {
        invalidateStructuredReceipt(acquisition, 'A different plan cannot replace a live plan without a conditional selector or scope drift.')
        return false
      }
      if (conditional) acquisition.conditionalReplanCount += 1
    }
    const priorReplanCount = acquisition.replanCount
    const reuseDecision = evaluateContextReuse({
      plan,
      priorPlan,
      priorReceipt,
      hostSessionId: acquisition.hostSessionId,
      sourceIdentities: []
    })
    let receipt = createContextReadReceipt(plan, {
      verificationMode: 'structured-plan',
      planObserved: true,
      toolCallId: attempt.toolCallId,
      hostSessionId: acquisition.hostSessionId,
      priorPlan,
      priorReceipt,
      sourceIdentities: [],
      reuseDecision
    })
    receipt.replanCount = priorReplanCount
    if (plan.exitCondition === 'blocked') {
      receipt = {
        ...receipt,
        status: 'blocked',
        satisfiedSourceIds: [],
        missingSourceIds: [...plan.mandatorySourceIds],
        completedAt: null
      }
      acquisition.blockedReason = 'plan-exit-blocked'
    } else {
      acquisition.blockedReason = ''
    }
    acquisition.plan = plan
    acquisition.receipt = receipt
    acquisition.activeRoot = normalizePath(plan.identity.activeRoot)
    acquisition.project = plan.identity.project
    acquisition.targetResolved = true
    acquisition.stageTiming = {
      ...plan.stageTiming,
      hostDeliveredBytes: extracted.outcome?.telemetry?.bytes ?? null
    }
    acquisition.lastReuseDecision = reuseDecision
    acquisition.runtimeCompatibility = extracted.compatibilityReceipt || null
    acquisition.producerRuntimeIdentity = extracted.producerIdentity || null
    acquisition.compatibleContextBindings = extracted.originalContextBinding &&
      stableDigest(extracted.originalContextBinding) !== stableDigest(plan.contextBinding)
      ? [extracted.originalContextBinding]
      : []
    acquisition.verificationMode = 'structured-plan'
    acquisition.fallbackActive = false
    acquisition.lastError = null
    return true
  }

  /** Correlate an observable PostToolUse result and advance only independently proven sources. */
  function recordContextPostToolUse(state, payload) {
    const acquisition = syncContextProjection(state)
    const targetWasResolved = acquisition.targetResolved === true
    const identity = canonicalContextTool(payload)
    if (!identity.canonical && !isBootstrapReadTool(payload, state)) {
      return { observed: false, ignored: true }
    }
    const outcome = normalizeContextToolOutcome(payload)
    const correlation = findPostAttempt(acquisition, state, payload, outcome.resultDigest)
    if (correlation.prior) {
      if (correlation.prior.resultDigest !== outcome.resultDigest) {
        invalidateStructuredReceipt(acquisition, 'Conflicting duplicate PostToolUse evidence cannot be correlated safely.')
      }
      state.contextAcquisition = acquisition
      syncContextProjection(state)
      return { observed: false, duplicate: true, conflicting: correlation.prior.resultDigest !== outcome.resultDigest }
    }
    if (!correlation.attempt) {
      acquisition.lastError = contextError(
        'CONTEXT_PLAN_INVALID',
        correlation.ambiguous
          ? 'PostToolUse without a call id matches multiple in-flight context reads.'
          : 'PostToolUse does not match an in-flight context read in the current epoch.'
      )
      state.contextAcquisition = acquisition
      syncContextProjection(state)
      return { observed: false, ambiguous: correlation.ambiguous === true }
    }
    const attempt = correlation.attempt
    const explicitPostInput = ['tool_input', 'toolInput', 'input', 'arguments']
      .some(key => Object.prototype.hasOwnProperty.call(payload || {}, key))
    const inputMismatch = explicitPostInput && stableDigest(getToolInput(payload)) !== attempt.argsDigest
    if (inputMismatch) {
      if (acquisition.plan) invalidateStructuredReceipt(acquisition, 'PostToolUse input does not match the correlated PreToolUse attempt.')
      else {
        activateFallback(acquisition, 'PostToolUse input mismatch')
        acquisition.lastError = contextError('CONTEXT_PLAN_INVALID', 'PostToolUse input does not match the correlated PreToolUse attempt.')
      }
    } else if (attempt.kind === 'plan') {
      const installed = installObservedPlan(acquisition, attempt, payload)
      if (installed && !targetWasResolved) {
        state.activeProject = acquisition.project
        state.activeScope = 'project'
        state.activeProjectSource = 'context-plan'
        state.mode = readProfileMode(state, acquisition.project)
        state.stickyProject = {
          project: acquisition.project,
          source: 'context-plan',
          sessionKey: acquisition.hostSessionId,
          updatedAt: new Date().toISOString(),
          updatedAtMs: Date.now()
        }
      }
    } else if (attempt.kind === 'profile-load' && acquisition.plan && acquisition.receipt) {
      const parsed = profileSourceResults(acquisition, attempt, outcome)
      if (parsed.drift) {
        acquisition.receipt = markContextReadReceiptStale(acquisition.receipt, acquisition.plan, 'profile-drift')
        acquisition.replanCount = Math.max(acquisition.replanCount, acquisition.receipt.replanCount)
      } else {
        applySourceResults(acquisition, attempt, payload, parsed.sourceResults)
      }
    } else if (attempt.kind === 'memory-query' && acquisition.plan && acquisition.receipt) {
      applySourceResults(acquisition, attempt, payload, memorySourceResults(acquisition, attempt, outcome))
    }
    acquisition.inFlight = acquisition.inFlight.filter(item => item.attemptId !== attempt.attemptId)
    acquisition.postHistory = [...acquisition.postHistory, {
      toolCallId: attempt.toolCallId,
      attemptId: attempt.attemptId,
      contextEpoch: attempt.contextEpoch,
      canonical: attempt.canonical,
      resultDigest: outcome.resultDigest,
      outcome: inputMismatch ? 'invalid' : (outcome.error ? 'failed' : (outcome.transportSuccess ? 'observed' : 'unobservable')),
      observedAt: new Date().toISOString()
    }].slice(-40)
    state.contextAcquisition = acquisition
    syncContextProjection(state)
    return {
      observed: true,
      attempt,
      outcome,
      targetRebound: !targetWasResolved && acquisition.targetResolved === true,
      project: acquisition.project,
      activeRoot: acquisition.activeRoot
    }
  }

  function updateBootstrapState(state, payload) {
    const scopes = getBootstrapScopes(state, payload)
    const inputStrings = getToolInputStrings(payload)
    const acquisition = normalizeContextAcquisition(state)
    if (touchesPath(payload, ...scopes.profileNeedles)) acquisition.legacyObserved.profileRead = true
    if ((scopes.summaryNeedles.length && touchesPath(payload, ...scopes.summaryNeedles)) ||
      (!scopes.summaryNeedles.length &&
        touchesPath(payload, ...scopes.memoryNeedles) &&
        inputStrings.some(input => input.includes('/summary.md')))) {
      acquisition.legacyObserved.summaryRead = true
    }
    if ((scopes.taskNeedles.length && touchesPath(payload, ...scopes.taskNeedles)) ||
      (!scopes.taskNeedles.length &&
        touchesPath(payload, ...scopes.memoryNeedles) &&
        inputStrings.some(isRecentBootstrapTaskPath))) {
      acquisition.legacyObserved.tasksRead = true
    }
    state.contextAcquisition = acquisition
    syncContextProjection(state)
  }

  function buildBootstrapMessage(state) {
    const acquisition = syncContextProjection(state)
    const targetHandoff = acquisition.targetResolved
      ? `Use the opaque contextEpoch=${acquisition.contextEpoch} unchanged when calling mcp__devcodex-profile__profile_context_plan for project=${acquisition.project}.`
      : `contextEpoch=${acquisition.contextEpoch} is unbound; resolve one active project before requesting a Profile plan.`
    return [
      'DevCodex intent-driven context acquisition is active for this user message.',
      'Classify the canonical intent first, then obtain ContextReadPlanV2 and load only its selected Profile files and bounded memory queries.',
      'If this host exposes DevCodex MCP tools only after deferred tool discovery/search, perform that discovery first; hidden tools are not a reason to skip ContextReadPlanV2, profile_load, memory_status, or SkillRoute.',
      'Resolve the active target against legacy .devcodex/profile/ or workspace-namespace base + project overlay roots before reading.',
      targetHandoff,
      'A full Profile/SUMMARY/tasks read is a legacy or explicit escalation path, not the normal bootstrap default.',
      'Your first user-visible block must be the entry check PC0-PC7 before substantive task content; dev mode adds full PC4 diagnostics.',
      '*** S07 compaction trigger (v1.9.6+): if this turn resumes from /compact, /resume, or summary-restore,',
      'this also counts as "first user-visible reply" — you MUST re-output PC0-PC7 even when instructed to "continue without acknowledging".'
    ].join(' ')
  }

  function buildBootstrapDenyOutput(state, payload, eventName, platform) {
    const acquisition = syncContextProjection(state)
    const missing = acquisition.receipt?.missingSourceIds || ['authoritative-plan']
    const toolName = getToolName(payload) || 'tool'
    let detail = `Missing sources: ${missing.join(', ') || 'none'}. Use contextEpoch=${acquisition.contextEpoch}; do not replace the plan with an unbounded full read.`
    // Grok cannot inject UserPromptSubmit context; attach S07 portable block to deny reason (W7 assist).
    // Keep template inline so deployed .codex/hooks/_runtime copies do not depend on package scripts/.
    if (platform === 'grok') {
      const project = acquisition.project || state.activeProject || '未识别'
      detail += [
        '',
        '--- DevCodex S07 assist (Grok cannot inject this; emit in the user-visible reply) ---',
        '### DevCodex · 入口检查',
        `\`BLOCK\` · \`${project}\``,
        '',
        '- PC0 [UNVERIFIED] ContextReadPlan 与必要来源回执',
        '- PC1 [UNVERIFIED] 语义初判 → 最终路由',
        '- PC2 [UNVERIFIED] 会话/Token/待跟进',
        '- PC3 [UNVERIFIED] 唯一项目与产物落点',
        '- PC4 [N/A] 非 dev 时 N/A',
        '- PC5 [UNVERIFIED] Grok HostParity（Partial unless Full launcher）',
        '- PC6 [UNVERIFIED] dirty/active task',
        '- PC7 [UNVERIFIED] resume/continuation',
        '',
        '下一步：先输出完整 PC0~PC7，再完成 ContextReadPlan 证据后重试工具',
        'GrokTurnChecklist: PC0~PC7 → Intent→Skill bundle → context plan → work → report+memory → honest ceiling',
        'Skill bundle (non-chat): intent+compliance+user-visible-output-contract+workflow+report+memory',
        'DevCodexVisibleEnvelopeV1 · entry-check · BLOCK · s07-assist-context-incomplete',
        '--- end S07 assist ---'
      ].join('\n')
    }
    return buildInterceptionOutput(
      state,
      platform || 'copilot',
      eventName,
      INTERCEPTION_ACTION.REQUIRE_COMPLETION,
      'context-acquisition-incomplete',
      `Blocked ${toolName} until the current context plan has verifiable evidence`,
      detail,
      'Complete the exact plan/query evidence or replan once after scope drift, then retry the tool.'
    )
  }

  function buildBootstrapWarningOutput(state, payload, eventName, platform) {
    const acquisition = syncContextProjection(state)
    const missing = acquisition.receipt?.missingSourceIds || ['authoritative-plan']
    const toolName = getToolName(payload) || 'tool'
    return buildInterceptionOutput(
      state,
      platform || 'copilot',
      eventName,
      INTERCEPTION_ACTION.WARN_CONTINUE,
      'context-acquisition-unverified',
      `Context evidence is unverified before ${toolName}`,
      `Missing sources: ${missing.join(', ') || 'none'}. Continue through downstream Auto/CP/permission gates; use targeted fallback at most once if structured results are unavailable.`,
      'Use the current epoch plan or one bounded targeted fallback; do not infer completion from a PreToolUse path touch.'
    )
  }

  function buildBootstrapWarningKey(state) {
    const acquisition = syncContextProjection(state)
    const missing = acquisition.receipt?.missingSourceIds || ['authoritative-plan']
    return [acquisition.contextEpoch, acquisition.receipt?.status || 'unverified', missing.join(',')].join('|')
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
    beginContextAcquisition,
    markContextAcquisitionStale,
    markContextPostMutationStale,
    recordContextPreToolUse,
    recordContextPostToolUse,
    getContextAcquisitionDecision,
    isBootstrapReadTool,
    isPureReadTool,
    isClarificationTool,
    updateBootstrapState,
    isReadOnlyBootstrapShellCommand,
    buildBootstrapMessage,
    buildBootstrapDenyOutput,
    buildBootstrapWarningOutput,
    buildBootstrapWarningKey,
    buildDedupedBootstrapWarningOutput,
    hostCapabilityFor,
    isRouteContextReceiptReady
  }
}

module.exports = {
  buildLifecycleBootstrapStateUtils,
  parseContextToolIdentity,
  classifyMemoryCoverage
}
