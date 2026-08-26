#!/usr/bin/env node
'use strict'

/**
 * DevCodex unified lifecycle hook — Copilot, Claude Code, Codex, Gemini, Grok & Cursor local Beta
 *
 * Auto-detects platform from tool name casing:
 *   Claude Code  → PascalCase tools (Write, Edit, Bash, Read …)
 *   Copilot      → snake_case / lowercase tools (apply_patch, create_file …)
 *
 * Handles normalized: UserPromptSubmit · PreToolUse · PostToolUse · PreCompact · Stop
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { buildLifecycleBootstrapStateUtils } = require('./lifecycle-bootstrap-state.cjs')
const {
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
  validateContextReadPlan
} = require('./context-read-contract.cjs')
const { buildLifecycleDangerousCommandUtils } = require('./lifecycle-dangerous-command.cjs')
const { buildLifecycleGovernanceIntakeUtils } = require('./lifecycle-governance-intake.cjs')
const { buildLifecycleHookOutput } = require('./lifecycle-hook-output.cjs')
const { buildLifecycleNamespaceStateUtils } = require('./lifecycle-namespace-state.cjs')
const { buildLifecyclePayloadUtils } = require('./lifecycle-payload-utils.cjs')
const { buildLifecycleProjectTargetUtils } = require('./lifecycle-project-target.cjs')
const {
  applyWorkflowTaskTerminalReceipt,
  completeToolLease,
  createTurnLivenessState,
  formatTurnRecoveryMessage,
  markTurnTerminal,
  normalizeTurnLivenessState,
  observeTurnEvent,
  startToolLease
} = require('./lifecycle-turn-liveness.cjs')
const { buildLifecycleVisibleReplyUtils } = require('./lifecycle-visible-reply.cjs')
const { formatLanguageContextInstruction, resolveLanguageContext } = require('./language-context.cjs')
const {
  reconcileProgressiveSkillRoute
} = require('./lifecycle-skill-route-coordinator.cjs')
const {
  resolveProgressiveSkillRouteEnforcement
} = require('./progressive-skill-route-enforcement.cjs')
const { observeWorkflowCompletionEvent } = require('./lifecycle-workflow-completion.cjs')
const { observeContextDeliveryFromPayload } = require('./context-delivery-ledger-v2.cjs')
const { resolveTaskRecoveryConfigForCwd } = require('./task-recovery-config-v1.cjs')
const {
  appendTaskRecoveryTelemetry,
  readFencedTaskWriteOwner,
  resolveTaskRecoveryMetaDir,
  validateWorkflowTaskTerminalReceipt
} = require('./task-recovery-store-v5.cjs')
const { extractMutationFootprint } = require('./mutation-footprint.cjs')
const { classifyHostToolMutation } = require('./host-tool-mutation-adapters.cjs')
const {
  createMutationPreObservation,
  createTaskOwnedMutationLease,
  observeMutationEffects,
  projectMutationFootprintForRecovery,
  validateMutationObservationReceipt,
  validateTaskOwnedMutationLease
} = require('./mutation-observation.cjs')
const { createWorkspaceSessionRouteIndex } = require('./workspace-session-route-index-v1.cjs')
const {
  buildHostIdentityV2,
  getLifecycleHostAdapterDigest,
  normalizeHostVariant
} = require('./host-adapter-identity.cjs')
const {
  buildActualInstructionEnvelope,
  buildWorkItemSet
} = require('./actual-instruction-envelope.cjs')
const {
  buildWorkflowRouteDecision,
  resolveWorkflowRouteDescriptor,
  verifyWorkflowRouteDecision
} = require('./workflow-route-decision-v2.cjs')
const {
  applyValidationControlIngress,
  createValidationControlIngressReceipt,
  validationProjectRootIdentity
} = require('./workflow-completion-contract.cjs')
const {
  canonicalArtifactName,
  decideArtifactMutation,
  hasTaskArtifact: registryHasTaskArtifact,
  readLayeredArtifactSlotRegistry,
  validateArtifactSlotDecision
} = require('./artifact-slot-decision.cjs')
const {
  validateWorkflowOperationalWriteLease
} = require('./workflow-operational-write-lease.cjs')
const {
  consumeSimpleTaskFastPathUsage,
  validateSimpleTaskFastPathLease,
  validateSimpleTaskFastPathUsage
} = require('./simple-task-fast-path-lease.cjs')
const {
  collectWorkspaceProjectNamespaces,
  findLayoutInfo,
  PROJECT_ROOT_MARKERS,
  resolveHostWorkspaceBinding,
  resolveWorkspaceProjectTarget
} = require('./workspace-layout.cjs')
const {
  evaluatePortableTaskIdentityBinding,
  TaskContinuationError,
  parseContinuationCommand,
  resolveTaskContinuation,
  validateTaskIdentity
} = require('./task-continuation-contract.cjs')
const {
  decideTaskContinuationTarget
} = require('./task-continuation-ingress.cjs')
const {
  evaluateStopCompletionGate,
  extractLastAssistantMessage
} = require('./lifecycle-stop-gate.cjs')
const {
  shouldHardDenyCpMutation,
  classifyPathsForArtifacts,
  isStrictProtectedPath,
  classifyImplementStartGate,
  ERROR_CODES: PROCESS_ENFORCEMENT_CODES
} = require('../../scripts/lib/process-enforcement.js')

const CONTEXT_ROOT = process.cwd()
const PAYLOAD_PREVIEW_LIMIT = 160
const TRANSCRIPT_TAIL_LIMIT = 2 * 1024 * 1024
const STICKY_PROJECT_TTL_MS = 30 * 60 * 1000

// ─── CP Gate constants ────────────────────────────────────────────────────────
const CP3_RUNTIME_FILE_THRESHOLD = 5
const CP3_FILE = canonicalArtifactName('implementation-plan')
// Dual-Track Closure (PI-154 / PF-171): control-plane source paths that require a bound task+CP when mutated.
// PF-process-enforcement: full website/docs + skills/mcp/prompts (aligned with process-enforcement STRICT_PROTECTED).
const CONTROL_PLANE_SOURCE_RE = /(?:^|[/\\])(?:scripts|hooks|instructions|host-projections|mcp|prompts|agents)(?:[/\\]|$)|(?:^|[/\\])package\.json$|(?:^|[/\\])plugin\.json$|(?:^|[/\\])skills[/\\]|(?:^|[/\\])website[/\\]docs(?:[/\\]|$)/i
const EXECUTION_MODE = { CONFIRM: 'confirm', AUTO: 'auto' }
const ENFORCEMENT_MODE = (() => {
  const mode = String(process.env.DEVCODEX_HOOK_ENFORCEMENT || 'safety-only').trim().toLowerCase()
  return mode === 'strict' ? 'strict' : 'safety-only'
})()
const AUTO_ALLOWED_PATH_PATTERNS = [
  /^\.devcodex\/(?:workspace|[A-Za-z0-9][A-Za-z0-9._-]*|profile|requirements|bugs|optimizations|scenario-tests|reports|\.memory|\.audit-state)(?:\/|$)/,
  /^agents\/devcodex-auto\.agent\.md$/i,
  /^instructions\/01-common\.instructions\.md$/i,
  /^skills\/cp-gate\/SKILL\.md$/i,
  /^skills\/compliance\/SKILL\.md$/i,
  /^hooks\/_runtime\/lifecycle\.cjs$/i,
  /^scripts\/test-hooks-runtime\.js$/i,
  /^scripts\/validate\.js$/i,
  /^README\.md$/i,
  /^AGENTS\.md$/i,
  /^\.agents\/(?:skills)(?:\/|$)/i,
  /^\.codex\/(?:hooks\.json|hooks\/_runtime)(?:\/|$)/i,
  /^codex\/hooks\.json$/i,
  /^\.(?:claude|github)\/(?:instructions|skills|hooks|agents|prompts|data|settings\.json|settings\.local\.json)(?:\/|$)/i
]

// ─── Multi-project workspace guard (v1.9.8+) ─────────────────────────────────────
const MULTI_PROJECT_EXEMPTION_KEYWORDS = [
  'workspace', 'monorepo', '全工作区', 'all projects', '所有项目'
]

// ─── Tiny helpers ─────────────────────────────────────────────────────────────

function readStdin() {
  return new Promise((resolve, reject) => {
    let buf = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', c => { buf += c })
    process.stdin.on('end', () => resolve(buf))
    process.stdin.on('error', reject)
  })
}

function safeJsonParse(text) {
  if (!text || !text.trim()) return {}
  try { return JSON.parse(text) } catch { return null }
}

function writeStdout(obj) {
  process.stdout.write(JSON.stringify(obj))
}

function readJsonFile(p) {
  if (!fs.existsSync(p)) return null
  let raw
  try { raw = fs.readFileSync(p, 'utf8') } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
  try { return JSON.parse(raw) } catch { return null }
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasMatchingSkillRouteBootstrapDelivery(payload, bootstrap) {
  if (!bootstrap?.turnBinding || !bootstrap?.bootstrapDigest) return false
  const seen = new WeakSet()
  function visit(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 8 || seen.has(value)) return false
    seen.add(value)
    const delivery = value._meta?.devcodexSkillRouteBootstrap ||
      value.meta?.devcodexSkillRouteBootstrap ||
      value.devcodexSkillRouteBootstrap
    if (delivery && delivery.status !== 'error' &&
        delivery.turnBinding === bootstrap.turnBinding &&
        delivery.bootstrapDigest === bootstrap.bootstrapDigest) {
      return true
    }
    for (const key of ['tool_response', 'toolResponse', 'tool_result', 'toolResult', 'result', 'output', 'structuredContent']) {
      if (visit(value[key], depth + 1)) return true
    }
    return false
  }
  return visit(payload)
}

function mergeConfig(baseConfig, overlayConfig) {
  const merged = {}
  for (const source of [baseConfig, overlayConfig]) {
    if (!isPlainObject(source)) continue
    for (const [key, value] of Object.entries(source)) {
      if (Array.isArray(value)) {
        merged[key] = value.slice()
      } else if (isPlainObject(value) && isPlainObject(merged[key])) {
        merged[key] = { ...merged[key], ...value }
      } else if (isPlainObject(value)) {
        merged[key] = { ...value }
      } else {
        merged[key] = value
      }
    }
  }
  return merged
}

const LAYOUT = findLayoutInfo(CONTEXT_ROOT)
const WORKSPACE_ROOT = LAYOUT.workspaceRoot

function inferContextProject() {
  const binding = resolveHostWorkspaceBinding({
    cwd: CONTEXT_ROOT,
    layout: LAYOUT,
    capability: process.env.DEVCODEX_HOST_WORKSPACE_CAPABILITY || 'physical',
    allowUniqueProject: false
  })
  return binding.status === 'resolved' ? binding.projectNamespace : ''
}

const CONTEXT_PROJECT = inferContextProject()
const DEFAULT_SCOPE = LAYOUT.enabled ? (CONTEXT_PROJECT ? 'project' : 'workspace') : 'project'
const ACTIVE_RUNTIME_ROOT = LAYOUT.enabled
  ? path.join(WORKSPACE_ROOT, '.devcodex', CONTEXT_PROJECT || 'workspace')
  : path.join(WORKSPACE_ROOT, '.devcodex')
const META_STATE_SCOPE_KEY = LAYOUT.enabled ? 'workspace' : 'legacy'
const INTERCEPTION_ACTION = {
  FORBID: 'forbid',
  REQUIRE_COMPLETION: 'require_completion',
  WARN_CONTINUE: 'warn_continue',
  LOG_ONLY: 'log_only'
}
const APPROVAL_TTL_MS = 10 * 60 * 1000

function formatDateStamp(date) {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function getRecentBootstrapTaskStamps() {
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  return [formatDateStamp(today), formatDateStamp(yesterday)]
}

function isRecentBootstrapTaskPath(input) {
  const normalized = normalizeText(input)
  return getRecentBootstrapTaskStamps().some(stamp => normalized.endsWith(`/tasks/${stamp}.md`))
}

function normalizeText(v) {
  return String(v || '').replace(/\\/g, '/').trim().toLowerCase()
}

function normalizeKeyPath(v) {
  return String(v || '')
    .replace(/\[\d+\]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/\\/g, '/')
    .toLowerCase()
}

function isProjectPayloadKeyPath(keyPath) {
  const normalized = normalizeKeyPath(keyPath)
  return /(^|[./_-])(cwd|workspace|workspace_folder|workspace_folders|folder|folders|root|project|project_root|project_path|repo|repository|path|paths|file|files|uri|uris|url|urls|directory|directories|dir|dirs|location)($|[./_-])/.test(normalized)
}

function normalizePreview(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, PAYLOAD_PREVIEW_LIMIT)
}

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ─── Platform detection ───────────────────────────────────────────────────────

/**
 * Detect which AI platform is running the hook.
 * v1.9.6+: env vars take priority over tool-name heuristic.
 * - CLAUDE_CODE_VERSION / CLAUDE_HOOK_COMMAND → claude
 * - IDEA_INITIAL_DIRECTORY / JETBRAINS_IDE / IDEA_* → jetbrains-copilot
 * - TERM_PROGRAM=vscode → vscode-copilot (when not Claude)
 * Fallback: PascalCase tool name → claude; otherwise copilot.
 */
// ─── Platform-specific output builders ───────────────────────────────────────

const {
  detectPlatform,
  noopOutput,
  isStrictEnforcement,
  decorateHookOutput,
  blockOutput,
  systemMessageOutput,
  contextMessageOutput,
  formatProgressiveSkillRouteRecoveryCard,
  warningOutput,
  eventSupportsHardBlock
} = buildLifecycleHookOutput({
  env: process.env,
  enforcementMode: ENFORCEMENT_MODE
})

const {
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
  META_STATE_PATHS
} = buildLifecycleNamespaceStateUtils({
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
})

const STATE_DIR = META_STATE_PATHS.dir
const STATE_FILE = META_STATE_PATHS.file
const FINAL_PAYLOAD_FLAG = META_STATE_PATHS.finalPayloadFlag
const FINAL_PAYLOAD_LOG = META_STATE_PATHS.finalPayloadLog
const INTERCEPTION_LOG = META_STATE_PATHS.interceptionLog
const WORKSPACE_SESSION_ROUTE_INDEX = createWorkspaceSessionRouteIndex({
  metaDir: META_STATE_PATHS.dir,
  fs,
  path
})

const {
  emptyGovernanceIntakeState,
  normalizeGovernanceIntakeState,
  registerGovernanceIntakeCandidate,
  buildGovernanceIntakeContextMessage,
  observeGovernanceLedgerWrite,
  updateGovernanceIntakeResolutionState,
  buildGovernanceIntakeReminderItem
} = buildLifecycleGovernanceIntakeUtils()

function appendInterception(state, entry) {
  const record = {
    time: new Date().toISOString(),
    eventName: entry.eventName || '',
    platform: entry.platform || 'unknown',
    action: entry.action || INTERCEPTION_ACTION.LOG_ONLY,
    code: entry.code || '',
    effective: !!entry.effective,
    reason: entry.reason || '',
    nextStep: entry.nextStep || '',
    mode: state?.mode || '',
    enforcementMode: ENFORCEMENT_MODE,
    activeProject: state?.activeProject || ''
  }
  const targets = [getStatePaths(state)]
  if (LAYOUT.enabled && targets[0].file !== META_STATE_PATHS.file) targets.push(META_STATE_PATHS)
  for (const target of targets) {
    const telemetry = appendTaskRecoveryTelemetry(target.dir, {
      schemaVersion: 'LifecycleInterceptionTelemetryV1',
      recordType: 'interception',
      observedAt: record.time,
      ...record
    })
    if (telemetry.status !== 'persisted') {
      state.taskRecoveryTelemetryWarning = {
        schemaVersion: 'TaskRecoveryTelemetryWarningV1',
        recordType: 'interception',
        errorCode: telemetry.errorCode || 'LIFECYCLE_TELEMETRY_WRITE_FAILED',
        observedAt: new Date().toISOString()
      }
    }
  }
}

function recordInterception(state, eventName, platform, action, code, reason, nextStep, effective) {
  state.lastReason = code || reason || state.lastReason
  appendInterception(state, { eventName, platform, action, code, reason, nextStep, effective })
}

function buildInterceptionOutput(state, platform, eventName, action, code, reason, detail, nextStep) {
  const strict = isStrictEnforcement()
  const effective = action === INTERCEPTION_ACTION.FORBID ||
    (action === INTERCEPTION_ACTION.REQUIRE_COMPLETION && strict && eventSupportsHardBlock(platform, eventName))
  const output = effective
    ? blockOutput(platform, eventName, reason, detail)
    : warningOutput(reason, detail, eventName)
  recordInterception(state, eventName, platform, action, code, reason, nextStep, effective)
  return decorateHookOutput(output, {
    devcodexAction: action,
    devcodexCode: code,
    devcodexEffective: effective,
    devcodexNextStep: nextStep
  })
}

// ─── Multi-project workspace detection (v1.9.8+) ──────────────────────────────
const {
  listWorkspaceProjects,
  isMultiProjectWorkspace,
  extractUserPrompt,
  hasMultiProjectExemption,
  detectProjectCandidate,
  getPayloadSessionKey,
  resolveProjectTargetIdentity,
  validateStickyProjectLease,
  resolvePromptTarget,
  readModeForPromptTarget,
  applyPromptTarget,
  setStickyProject,
  shouldSuppressMultiProjectWarning,
  detectExecutionMode,
  buildExecutionModeContextMessage,
  buildMultiProjectBlockMessage
} = buildLifecycleProjectTargetUtils({
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
})

function readWorkspaceSessionRouteHint(input) {
  return WORKSPACE_SESSION_ROUTE_INDEX.read(input)
}

function currentRouteAuthorityRef(state, payload) {
  return getPayloadSessionKey(payload) ||
    String(state?.contextAcquisition?.hostSessionId || '').trim() ||
    String(state?.turnLiveness?.turnKey || '').trim()
}

function writeWorkspaceSessionRouteHint(state, payload, trigger, options = {}) {
  const lease = state?.stickyProject
  const authorityRef = currentRouteAuthorityRef(state, payload)
  if (!authorityRef || lease?.schemaVersion !== 'ProjectTargetLeaseV2' || !lease.rootIdentityDigest) {
    const result = {
      schemaVersion: 'WorkspaceSessionRouteIndexReceiptV1',
      status: 'missing',
      authority: false,
      hintOnly: true,
      errorCode: 'WORKSPACE_SESSION_ROUTE_PROJECT_LEASE_UNAVAILABLE'
    }
    state.workspaceSessionRouteHint = result
    return result
  }
  const taskId = String(options.taskId || state.taskRecoveryBinding?.taskId || '').trim()
  const result = WORKSPACE_SESSION_ROUTE_INDEX.update({
    sessionRef: authorityRef,
    projectRootIdentityDigest: lease.rootIdentityDigest,
    taskId,
    routeRevision: lease.routeRevision || 'pending',
    trigger,
    ...(options.lastTerminalReceiptDigest
      ? { lastTerminalReceiptDigest: options.lastTerminalReceiptDigest }
      : {})
  })
  state.workspaceSessionRouteHint = result
  return result
}

function renewProjectTargetLeaseForCurrentRoute(state, payload, source = '') {
  if (!state?.activeProject) return null
  setStickyProject(
    state,
    state.activeProject,
    source || state.activeProjectSource || 'route-bind',
    payload
  )
  return validateStickyProjectLease(state, payload)
}

// ─── Payload helpers ──────────────────────────────────────────────────────────

function getEventName(payload) {
  const raw = String(
    payload.hookEventName || payload.hook_event_name ||
    payload.eventName || payload.event || payload.phase || ''
  ).trim()
  if (!raw) return ''
  // Normalize Grok/Cursor snake_case and Claude PascalCase to lifecycle canonical names.
  const token = raw.toLowerCase().replace(/[^a-z]/g, '')
  const canonical = {
    pretooluse: 'PreToolUse',
    posttooluse: 'PostToolUse',
    posttoolusefailure: 'PostToolUse',
    userpromptsubmit: 'UserPromptSubmit',
    sessionstart: 'SessionStart',
    sessionend: 'SessionEnd',
    stop: 'Stop',
    stopfailure: 'Stop',
    precompact: 'PreCompact',
    postcompact: 'PostCompact',
    subagentstart: 'SubagentStart',
    subagentstop: 'SubagentStop',
    subagentend: 'SubagentStop',
    notification: 'Notification',
    beforeagent: 'UserPromptSubmit',
    afteragent: 'Stop',
    beforetool: 'PreToolUse',
    aftertool: 'PostToolUse',
    precompress: 'PreCompact'
  }
  return canonical[token] || raw
}

function getToolName(payload) {
  return String(payload.tool_name || payload.toolName || '').trim()
}

function workflowIngressError(error, phase) {
  return {
    schemaVersion: 'WorkflowIngressErrorV1',
    phase,
    errorCode: String(error?.code || error?.message || 'WORKFLOW_INGRESS_FAILED'),
    message: String(error?.message || 'workflow ingress failed').slice(0, 2048),
    observedAt: new Date().toISOString()
  }
}

function workflowRouteUnresolvedError(reasonCode, detail = '') {
  const error = new Error(`WORKFLOW_ROUTE_UNRESOLVED: ${reasonCode}${detail ? `: ${detail}` : ''}`)
  error.code = 'WORKFLOW_ROUTE_UNRESOLVED'
  error.reasonCode = reasonCode
  return error
}

function workflowRoutePending(state, envelope, workItemSet, reasonCode) {
  state.workflowRoutePending = {
    schemaVersion: 'WorkflowRoutePendingV1',
    contextEpoch: envelope?.contextEpoch || state.contextAcquisition?.contextEpoch || '',
    envelopeDigest: envelope?.envelopeDigest || null,
    workItemSetDigest: workItemSet?.setDigest || null,
    reasonCode
  }
}

function buildWorkflowRoutePlanBinding(state, plan, decision) {
  const { buildTrustedContextSemanticCore } = require('./skill-route-tool.cjs')
  const contextSemanticCore = buildTrustedContextSemanticCore({
    plan,
    receipt: state.contextAcquisition?.receipt,
    contextEpoch: state.contextAcquisition?.contextEpoch,
    activeRoot: state.contextAcquisition?.activeRoot,
    project: state.contextAcquisition?.project,
    hostSessionId: state.contextAcquisition?.hostSessionId
  })
  const core = {
    schemaVersion: 'WorkflowRoutePlanBindingV1',
    contextEpoch: state.contextAcquisition?.contextEpoch || '',
    planId: String(plan.planId || ''),
    planContentId: String(plan.planContentId || ''),
    routeKey: decision.routeKey,
    subtype: decision.subtype,
    stage: decision.stage,
    routeRevision: decision.routeRevision,
    routeRegistryDigest: decision.routeRegistryDigest,
    decisionDigest: decision.decisionDigest,
    contextSemanticDigest: stableDigest(contextSemanticCore)
  }
  return { ...core, bindingDigest: stableDigest(core) }
}

function initializeWorkflowIngress(
  state,
  payload,
  platform,
  prompt,
  projectCandidate,
  priorEnvelope,
  continuationCommand,
  priorRouteDecision
) {
  let envelope
  try {
    const serverOwnedSourceEventId = `workflow-ingress:${stableDigest({
      schemaVersion: 'HostWorkflowIngressEventIdentityV1',
      hostIdentityDigest: state.hostIdentity?.identityDigest || null,
      hostVariant: state.hostIdentity?.hostVariant || platform,
      hostSessionDigest: stableDigest(String(getPayloadSessionKey(payload) || 'turn-only')),
      turnId: state.turnLiveness?.turnKey || null,
      eventSequence: Number(state.turnLiveness?.eventSequence || 0),
      contextEpoch: state.contextAcquisition?.contextEpoch || null,
      actualInstructionDigest: stableDigest(String(prompt || ''))
    })}`
    envelope = buildActualInstructionEnvelope({
      ...payload,
      sourceEventId: serverOwnedSourceEventId
    }, {
      actualInstruction: prompt,
      hostVariant: state.hostIdentity?.hostVariant || platform,
      hostSessionId: getPayloadSessionKey(payload),
      turnId: state.turnLiveness?.turnKey,
      contextEpoch: state.contextAcquisition?.contextEpoch,
      trustedHostEvent: true,
      priorEnvelope,
      projectObservations: [projectCandidate].filter(candidate => candidate?.project)
    })
    state.actualInstructionEnvelope = envelope
  } catch (error) {
    state.actualInstructionEnvelope = null
    state.workItemSet = null
    state.workflowRouteDecision = null
    state.workflowResumeTargetDecision = null
    state.workflowRoutePlanBinding = null
    state.workflowRoutePending = null
    state.workflowIngressError = workflowIngressError(error, 'actual-instruction')
    return { ok: false, error }
  }

  let workItemSet
  try {
    workItemSet = buildWorkItemSet(envelope, continuationCommand
      ? { workItems: [{ taskKind: 'resume', routeCandidate: 'resume' }] }
      : {})
    state.workItemSet = workItemSet
    state.workflowRouteDecision = null
    state.workflowResumeTargetDecision = null
    state.workflowRoutePlanBinding = null
    workflowRoutePending(state, envelope, workItemSet, 'context-plan-required')
    state.workflowIngressError = null
    if (continuationCommand) {
      if (!priorRouteDecision || priorRouteDecision.routeKey === 'resume') {
        throw workflowRouteUnresolvedError('resume-target-missing')
      }
      const targetVerification = verifyWorkflowRouteDecision(priorRouteDecision, {
        environmentMode: state.mode
      })
      if (!targetVerification.fresh) {
        throw workflowRouteUnresolvedError('resume-target-stale', targetVerification.errors.join(','))
      }
      state.workflowResumeTargetDecision = JSON.parse(JSON.stringify(priorRouteDecision))
      state.workflowRouteDecision = buildWorkflowRouteDecision({
        actualInstructionEnvelope: envelope,
        workItemSet,
        environmentMode: state.mode,
        topIntent: 'resume',
        routeKey: 'resume'
      })
      state.workflowRoutePending = null
    }
    return { ok: true, envelope, workItemSet, decision: state.workflowRouteDecision }
  } catch (error) {
    state.workItemSet = workItemSet || null
    state.workflowRouteDecision = null
    state.workflowResumeTargetDecision = null
    state.workflowRoutePlanBinding = null
    workflowRoutePending(state, envelope, workItemSet, String(error.reasonCode || error.code || 'route-decision-failed'))
    state.workflowIngressError = workflowIngressError(
      error,
      continuationCommand ? 'resume-route-decision' : 'work-item-set'
    )
    return { ok: false, error }
  }
}

function bindWorkflowRouteFromObservedPlan(state) {
  const plan = state.contextAcquisition?.plan
  const envelope = state.actualInstructionEnvelope
  const workItemSet = state.workItemSet
  if (!plan || !envelope || !workItemSet) {
    const error = new Error('WORKFLOW_ROUTE_INPUT_MISSING')
    error.code = 'WORKFLOW_ROUTE_INPUT_MISSING'
    state.workflowIngressError = workflowIngressError(error, 'route-decision')
    return { ok: false, error }
  }
  if (String(envelope.contextEpoch || '') !== String(state.contextAcquisition?.contextEpoch || '')) {
    const error = new Error('WORKFLOW_ROUTE_CONTEXT_EPOCH_MISMATCH')
    error.code = 'WORKFLOW_ROUTE_CONTEXT_EPOCH_MISMATCH'
    state.workflowIngressError = workflowIngressError(error, 'route-decision')
    return { ok: false, error }
  }
  try {
    const topIntent = String(plan.identity?.finalIntent || plan.finalIntent || '').trim()
    const structuredRoute = plan.workflowRoute && typeof plan.workflowRoute === 'object' && !Array.isArray(plan.workflowRoute)
      ? plan.workflowRoute
      : null
    if (structuredRoute) {
      const requiredFields = ['routeKey', 'subtype', 'stage']
      if (requiredFields.some(field => !String(structuredRoute[field] || '').trim())) {
        throw workflowRouteUnresolvedError('structured-route-incomplete', requiredFields.join(','))
      }
    }
    const routeInput = {
      topIntent,
      changeTypes: plan.changeTypes || [],
      ...(structuredRoute
        ? {
            routeKey: structuredRoute.routeKey,
            subtype: structuredRoute.subtype,
            stage: structuredRoute.stage,
            routeRevision: structuredRoute.routeRevision,
            routeRegistryDigest: structuredRoute.routeRegistryDigest
          }
        : {})
    }
    const resolvedRoute = resolveWorkflowRouteDescriptor(routeInput)
    const reboundWorkItemSet = buildWorkItemSet(envelope, {
      workItems: [{ taskKind: resolvedRoute.topIntent, routeCandidate: resolvedRoute.routeKey }]
    })
    const decision = buildWorkflowRouteDecision({
      actualInstructionEnvelope: envelope,
      workItemSet: reboundWorkItemSet,
      environmentMode: state.mode,
      ...routeInput
    })
    const verification = verifyWorkflowRouteDecision(decision, {
      environmentMode: state.mode,
      envelopeDigest: envelope.envelopeDigest,
      workItemDigest: reboundWorkItemSet.items[0]?.workItemDigest,
      routeKey: resolvedRoute.routeKey,
      topIntent: resolvedRoute.topIntent,
      subtype: resolvedRoute.route.subtype,
      stage: resolvedRoute.stage,
      routeRevision: resolvedRoute.registry.routeRevision,
      routeRegistryDigest: resolvedRoute.registry.registryDigest,
      actualInstructionEnvelope: envelope,
      workItemSet: reboundWorkItemSet
    })
    if (!verification.fresh) {
      const error = new Error(`WORKFLOW_ROUTE_DECISION_STALE: ${verification.errors.join(',')}`)
      error.code = 'WORKFLOW_ROUTE_DECISION_STALE'
      throw error
    }
    if (!String(plan.planId || '') || !String(plan.planContentId || '')) {
      throw workflowRouteUnresolvedError('context-plan-identity-missing')
    }
    state.workItemSet = reboundWorkItemSet
    state.workflowRouteDecision = decision
    state.workflowResumeTargetDecision = null
    state.workflowRoutePlanBinding = buildWorkflowRoutePlanBinding(state, plan, decision)
    state.workflowRoutePending = null
    state.workflowIngressError = null
    return { ok: true, decision }
  } catch (error) {
    state.workflowRouteDecision = null
    state.workflowRoutePlanBinding = null
    workflowRoutePending(state, envelope, state.workItemSet || workItemSet, String(error.reasonCode || error.code || 'route-decision-failed'))
    state.workflowIngressError = workflowIngressError(error, 'route-decision')
    return { ok: false, error }
  }
}

function buildWorkflowIngressContextMessage(state) {
  const envelope = state.actualInstructionEnvelope
  const decision = state.workflowRouteDecision
  const pending = state.workflowRoutePending
  const planBinding = state.workflowRoutePlanBinding
  const resumeTarget = state.workflowResumeTargetDecision
  const error = state.workflowIngressError
  if (!envelope && !error) return ''
  return [
    '### DevCodex · WorkflowIngressV2',
    JSON.stringify({
      schemaVersion: 'WorkflowIngressProjectionV1',
      envelopeId: envelope?.envelopeId || null,
      envelopeDigest: envelope?.envelopeDigest || null,
      provenanceLevel: envelope?.provenanceLevel || null,
      instructionAuthority: envelope?.instructionAuthority === true,
      nonInstructionSegments: envelope ? {
        attachments: envelope.attachments.length,
        quotedDocuments: envelope.quotedDocuments.length,
        ambientState: envelope.ambientState.length,
        evidenceSegments: envelope.evidenceSegments.length
      } : null,
      routeStatus: decision?.decisionStatus || (pending ? 'pending' : 'failed'),
      routeKey: decision?.routeKey || null,
      topIntent: decision?.topIntent || null,
      routeRevision: decision?.routeRevision || null,
      decisionDigest: decision?.decisionDigest || null,
      admissionRef: envelope?.envelopeId && envelope?.envelopeDigest && decision?.decisionDigest && decision?.routeRevision
        ? {
            schemaVersion: 'WorkflowIngressProjectionRefV1',
            envelopeId: envelope.envelopeId,
            envelopeDigest: envelope.envelopeDigest,
            decisionDigest: decision.decisionDigest,
            routeRevision: decision.routeRevision
          }
        : null,
      planContentId: planBinding?.planContentId || null,
      planBindingDigest: planBinding?.bindingDigest || null,
      resumeTargetRouteKey: resumeTarget?.routeKey || null,
      resumeTargetDecisionDigest: resumeTarget?.decisionDigest || null,
      mutationAuthority: false,
      releaseAuthority: false,
      errorCode: error?.errorCode || null
    }),
    decision
      ? 'Use the selected route identity; environmentMode is not a workflow and this receipt grants no mutation, validation or release authority.'
      : 'Only the actual user-instruction segment is authoritative. Wait for the structured ContextRead plan before selecting a non-resume workflow route.'
  ].join('\n')
}

function terminalToolResultRoots(payload) {
  return [
    payload?.tool_response,
    payload?.toolResponse,
    payload?.tool_result,
    payload?.toolResult,
    payload?.result,
    payload?.output,
    payload?.structuredContent,
    payload?.structured_content
  ].filter(value => value !== undefined && value !== null)
}

function findWorkflowTaskTerminalReceipts(payload) {
  const found = new Map()
  const seen = new WeakSet()
  let visited = 0
  function visit(value, depth = 0) {
    if (value === null || value === undefined || depth > 10 || visited >= 512) return
    visited += 1
    if (typeof value === 'string') {
      const text = value.trim()
      if (text.length > 0 && text.length <= 1024 * 1024 && (text.startsWith('{') || text.startsWith('['))) {
        try { visit(JSON.parse(text), depth + 1) } catch { }
      }
      return
    }
    if (typeof value !== 'object') return
    if (seen.has(value)) return
    seen.add(value)
    if (value.schemaVersion === 'WorkflowTaskTerminalReceiptV1' && typeof value.receiptDigest === 'string') {
      found.set(value.receiptDigest, value)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    for (const item of Object.values(value)) visit(item, depth + 1)
  }
  for (const root of terminalToolResultRoots(payload)) visit(root)
  return [...found.values()]
}

function findWorkflowOperationalWriteLeases(payload) {
  const found = new Map()
  const seen = new WeakSet()
  let visited = 0
  function visit(value, depth = 0) {
    if (value === null || value === undefined || depth > 10 || visited >= 512) return
    visited += 1
    if (typeof value === 'string') {
      const text = value.trim()
      if (text.length > 0 && text.length <= 1024 * 1024 && (text.startsWith('{') || text.startsWith('['))) {
        try { visit(JSON.parse(text), depth + 1) } catch { }
      }
      return
    }
    if (typeof value !== 'object') return
    if (seen.has(value)) return
    seen.add(value)
    if (value.schemaVersion === 'WorkflowOperationalWriteLeaseV1' && typeof value.leaseDigest === 'string') {
      found.set(value.leaseDigest, value)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    for (const item of Object.values(value)) visit(item, depth + 1)
  }
  for (const root of terminalToolResultRoots(payload)) visit(root)
  return [...found.values()]
}

function findSimpleTaskFastPathLeaseReceipts(payload) {
  const found = []
  const seen = new WeakSet()
  let visited = 0
  function visit(value, depth = 0) {
    if (value === null || value === undefined || depth > 10 || visited >= 512) return
    visited += 1
    if (typeof value === 'string') {
      const text = value.trim()
      if (text.length > 0 && text.length <= 1024 * 1024 && (text.startsWith('{') || text.startsWith('['))) {
        try { visit(JSON.parse(text), depth + 1) } catch { }
      }
      return
    }
    if (typeof value !== 'object') return
    if (seen.has(value)) return
    seen.add(value)
    if (value.schemaVersion === 'SimpleTaskFastPathLeaseReceiptV1') {
      found.push(value)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    for (const item of Object.values(value)) visit(item, depth + 1)
  }
  for (const root of terminalToolResultRoots(payload)) visit(root)
  return found
}

function operationalLeaseValidationInput(state, extra = {}) {
  return {
    state,
    activeRoot: getActiveNamespaceRoot(state),
    projectRoot: state.stickyProject?.physicalRoot || CONTEXT_ROOT,
    project: state.activeProject || CONTEXT_PROJECT || '',
    ...extra
  }
}

function observeWorkflowOperationalWriteLease(state, payload) {
  const toolName = String(getToolName(payload) || '').trim()
  if (!/(?:^|__)memory_workflow_operational_write_lease$/i.test(toolName) ||
      payload.success === false || payload.is_error === true || payload.isError === true) return null
  const leases = findWorkflowOperationalWriteLeases(payload)
  if (leases.length !== 1) {
    state.workflowOperationalWriteLeaseObservationError = leases.length > 1
      ? 'WORKFLOW_OPERATIONAL_LEASE_AMBIGUOUS'
      : 'WORKFLOW_OPERATIONAL_LEASE_MISSING'
    return null
  }
  if (state.workflowOperationalWriteLeaseCloseout?.leaseDigest === leases[0].leaseDigest) {
    state.workflowOperationalWriteLeaseObservationError = 'WORKFLOW_OPERATIONAL_LEASE_ALREADY_CONSUMED'
    return null
  }
  const toolInput = payload.tool_input || payload.toolInput || payload.arguments || payload.args || {}
  const validation = validateWorkflowOperationalWriteLease(leases[0], operationalLeaseValidationInput(state, {
    relativeTargets: toolInput.targets,
    operation: toolInput.operation
  }))
  if (!validation.valid) {
    state.workflowOperationalWriteLeaseObservationError = validation.errors.join(',') || 'WORKFLOW_OPERATIONAL_LEASE_INVALID'
    return null
  }
  state.workflowOperationalWriteLeaseObservationError = null
  state.workflowOperationalWriteLease = leases[0]
  return leases[0]
}

function observeSimpleTaskFastPathLease(state, payload) {
  const toolName = String(getToolName(payload) || '').trim()
  if (!/(?:^|__)memory_task_fast_path_lease$/i.test(toolName) ||
      payload.success === false || payload.is_error === true || payload.isError === true) return null
  const receipts = findSimpleTaskFastPathLeaseReceipts(payload)
  if (receipts.length !== 1) {
    state.simpleTaskFastPathLeaseObservationError = receipts.length > 1
      ? 'SIMPLE_TASK_FAST_PATH_LEASE_AMBIGUOUS'
      : 'SIMPLE_TASK_FAST_PATH_LEASE_MISSING'
    return null
  }
  const receipt = receipts[0]
  const lease = receipt.lease
  if (state.simpleTaskFastPathLeaseCloseout?.leaseDigest === lease?.leaseDigest) {
    state.simpleTaskFastPathLeaseObservationError = 'SIMPLE_TASK_FAST_PATH_LEASE_ALREADY_CLOSED'
    return null
  }
  const toolInput = payload.tool_input || payload.toolInput || payload.arguments || payload.args || {}
  const validation = validateSimpleTaskFastPathLease(lease, {
    state,
    activeRoot: getActiveNamespaceRoot(state),
    projectRoot: state.stickyProject?.physicalRoot || CONTEXT_ROOT,
    relativeTargets: toolInput.targets,
    operation: toolInput.operation,
    riskAssessment: toolInput.riskAssessment,
    skipUsage: true
  })
  const usageValidation = validateSimpleTaskFastPathUsage(receipt.usage, lease)
  const receiptAuthorityValid = receipt.mutationAuthority === true &&
    receipt.productMutationAuthority === true &&
    receipt.formalArtifactAuthority === false &&
    receipt.controlPlaneAuthority === false &&
    receipt.releaseAuthority === false
  if (!validation.valid || !usageValidation.valid || !receiptAuthorityValid) {
    state.simpleTaskFastPathLeaseObservationError = [
      ...validation.errors,
      ...usageValidation.errors,
      ...(receiptAuthorityValid ? [] : ['simple-task-receipt-authority-invalid'])
    ].join(',') || 'SIMPLE_TASK_FAST_PATH_LEASE_INVALID'
    return null
  }
  state.simpleTaskFastPathLeaseObservationError = null
  state.simpleTaskFastPathLease = lease
  state.simpleTaskFastPathUsage = receipt.usage
  return receipt
}

function observeWorkflowTaskTerminalReceipt(state, payload) {
  const toolName = String(getToolName(payload) || '').trim()
  if (!/(?:^|__)memory_task_(?:terminal_v1|closeout_reconcile_v1)$/i.test(toolName) ||
      payload.success === false || payload.is_error === true || payload.isError === true) return null
  const receipts = findWorkflowTaskTerminalReceipts(payload)
  if (receipts.length !== 1) {
    if (receipts.length > 1) state.workflowTaskTerminalObservationError = 'WORKFLOW_TASK_TERMINAL_RECEIPT_AMBIGUOUS'
    return null
  }
  const receipt = receipts[0]
  const project = String(state.activeProject || CONTEXT_PROJECT || '').trim()
  const activeRoot = getActiveNamespaceRoot(state)
  const validation = validateWorkflowTaskTerminalReceipt(receipt, {
    activeRoot,
    project,
    taskId: receipt.taskId,
    taskStatus: 'completed'
  })
  const toolInput = payload.tool_input || payload.toolInput || {}
  const inputTaskId = String(toolInput.taskId || '').trim().toLowerCase()
  const boundTaskId = String(state.taskRecoveryBinding?.taskId || '').trim().toLowerCase()
  const rootIdentityMatches = receipt.projectRootIdentity === state.stickyProject?.rootIdentityDigest
  const taskMatches = (!inputTaskId || inputTaskId === receipt.taskId) && (!boundTaskId || boundTaskId === receipt.taskId)
  if (!validation.valid || !rootIdentityMatches || !taskMatches) {
    state.workflowTaskTerminalObservationError = [
      ...validation.errors,
      ...(rootIdentityMatches ? [] : ['project-root-identity']),
      ...(taskMatches ? [] : ['task-binding'])
    ].join(',') || 'WORKFLOW_TASK_TERMINAL_RECEIPT_INVALID'
    return null
  }
  state.workflowTaskTerminalObservationError = null
  return receipt
}

function resolveContinuationProjectQualifier(command, detectedCandidate) {
  const detected = detectedCandidate?.project
    ? { project: detectedCandidate.project, source: detectedCandidate.source || 'detected' }
    : { project: '', source: '' }
  const raw = String(command?.projectQuery || '').trim()
  if (!raw) {
    return {
      projectCandidate: detected,
      explicitProject: detected.project,
      explicitProjectSource: detected.source,
      error: null
    }
  }
  if (/^(?:workspace|工作区)$/iu.test(raw)) {
    if (detected.project) {
      return {
        projectCandidate: detected,
        explicitProject: '',
        explicitProjectSource: '',
        error: {
          code: 'TASK_PROJECT_QUALIFIER_CONFLICT',
          message: `The continuation names both workspace and project ${detected.project}.`
        }
      }
    }
    return {
      projectCandidate: detected,
      explicitProject: 'workspace',
      explicitProjectSource: 'continuation-project-qualifier',
      error: null
    }
  }
  try {
    const resolved = resolveWorkspaceProjectTarget(WORKSPACE_ROOT, raw)
    if (detected.project && detected.project !== resolved.namespace) {
      return {
        projectCandidate: detected,
        explicitProject: '',
        explicitProjectSource: '',
        error: {
          code: 'TASK_PROJECT_QUALIFIER_CONFLICT',
          message: `The continuation project qualifier ${resolved.namespace} conflicts with ${detected.project}.`
        }
      }
    }
    return {
      projectCandidate: {
        project: resolved.namespace,
        source: 'continuation-project-qualifier'
      },
      explicitProject: resolved.namespace,
      explicitProjectSource: 'continuation-project-qualifier',
      error: null
    }
  } catch (error) {
    return {
      projectCandidate: detected,
      explicitProject: '',
      explicitProjectSource: '',
      error: {
        code: error?.code || 'TASK_PROJECT_QUALIFIER_INVALID',
        message: error?.message || `The continuation project qualifier cannot be resolved: ${raw}`
      }
    }
  }
}

function currentWorkflowRouteRevision() {
  try {
    return resolveWorkflowRouteDescriptor({ topIntent: 'resume', routeKey: 'resume' }).registry.routeRevision
  } catch {
    return ''
  }
}

function resolveContinuationAtIngress(command, state, payload, promptTarget, projectQualifier) {
  if (!command) return { command: null, resolution: null, recoveryHint: null, targetDecision: null }
  const leaseValidation = promptTarget?.source === 'sticky'
    ? validateStickyProjectLease(state, payload)
    : { valid: false, reason: 'not-sticky', lease: null }
  const targetDecision = decideTaskContinuationTarget({
    command,
    layoutEnabled: LAYOUT.enabled,
    legacyProject: path.basename(CONTEXT_ROOT),
    contextProject: CONTEXT_PROJECT,
    explicitProject: projectQualifier?.explicitProject || '',
    explicitProjectSource: projectQualifier?.explicitProjectSource || '',
    projectQualifierError: projectQualifier?.error || null,
    actualInstructionBound: ['prompt', 'continuation-project-qualifier'].includes(projectQualifier?.explicitProjectSource),
    promptTarget,
    sessionRef: getPayloadSessionKey(payload),
    projectLeaseValidation: leaseValidation,
    routeHint: state.workspaceSessionRouteHint,
    currentRouteRevision: currentWorkflowRouteRevision()
  })
  if (!targetDecision.verified) {
    return {
      command,
      targetDecision,
      resolution: {
        schemaVersion: 'TaskResolutionV1',
        status: targetDecision.status === 'stale' ? 'stale-route' : 'target-required',
        errorCode: targetDecision.errorCode,
        message: targetDecision.message,
        nextStep: targetDecision.nextStep,
        targetDecision
      },
      recoveryHint: null
    }
  }
  let resolution
  try {
    resolution = resolveTaskContinuation({
      cwd: CONTEXT_ROOT,
      name: command.displayQuery,
      project: targetDecision.project,
      scope: targetDecision.scope
    })
  } catch (error) {
    if (!(error instanceof TaskContinuationError)) throw error
    resolution = {
      schemaVersion: 'TaskResolutionV1',
      status: 'not-found',
      errorCode: error.code,
      message: error.message,
      nextStep: error.nextStep || 'Specify the exact task name and project.'
    }
  }
  resolution = { ...resolution, targetDecision }
  const candidate = resolution?.status === 'resolved-active' ? resolution.candidate : null
  return {
    command,
    resolution,
    targetDecision,
    recoveryHint: candidate?.taskId && candidate?.project
      ? {
          taskId: candidate.taskId,
          project: candidate.project,
          taskStatus: candidate.status || 'active'
        }
      : null
  }
}

function collectProjectPayloadStrings(value, keyPath = '', out = []) {
  if (typeof value === 'string') {
    if (isProjectPayloadKeyPath(keyPath)) out.push(value)
    return out
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectProjectPayloadStrings(item, `${keyPath}[${index}]`, out))
    return out
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      collectProjectPayloadStrings(item, keyPath ? `${keyPath}.${key}` : key, out)
    }
  }
  return out
}

const {
  collectStrings,
  collectInterestingStrings,
  extractAssistantRecordContent,
  getVisibleReplyEvidence,
  getVisibleReplyText,
  getToolInputStrings,
  getCommandText,
  touchesPath
} = buildLifecyclePayloadUtils({
  fs,
  path,
  payloadPreviewLimit: PAYLOAD_PREVIEW_LIMIT,
  transcriptTailLimit: TRANSCRIPT_TAIL_LIMIT,
  safeJsonParse,
  normalizeText
})

const {
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
  buildBootstrapMessage,
  buildBootstrapDenyOutput,
  buildDedupedBootstrapWarningOutput
} = buildLifecycleBootstrapStateUtils({
  fs,
  path,
  crypto,
  env: process.env,
  resolveTaskRecoveryConfigForCwd,
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
  setStickyProject,
  validateStickyProjectLease,
  readWorkspaceSessionRouteHint,
  resolveProjectTargetIdentity,
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
})

// ─── CP Gate ─────────────────────────────────────────────────────────────────

function readCpConfirmations(reqPath) {
  const p = path.join(reqPath, '.memory', 'sessions.md')
  const none = { CP1: false, CP2: false, CP3: false, CP3Exempt: false }
  if (!fs.existsSync(p)) return none
  let text
  try { text = fs.readFileSync(p, 'utf8') } catch { return none }
  const confirmed = { CP1: false, CP2: false, CP3: false, CP3Exempt: false }

  // ConfirmBindingGate: prefer digest-aware parser when available.
  // Legacy tables without sha256 remain valid (ok + legacy).
  // Extended tables with sha256 must match on-disk artifact or confirmation is rejected.
  try {
    const cpDigestPath = path.join(__dirname, '..', '..', 'scripts', 'lib', 'cp-digest.js')
    if (fs.existsSync(cpDigestPath)) {
      const { parseCpSessions, verifyArtifactDigest } = require(cpDigestPath)
      const parsed = parseCpSessions(text)
      for (const phase of ['CP1', 'CP2', 'CP3']) {
        const row = parsed[phase]
        if (!row || !row.confirmed) continue
        if (row.artifactSha256) {
          const verify = verifyArtifactDigest(reqPath, row)
          if (!verify.ok) continue
        }
        confirmed[phase] = true
      }
      if (parsed.CP3Exempt) {
        confirmed.CP3 = true
        confirmed.CP3Exempt = true
      }
      return confirmed
    }
  } catch (_) {
    // fall through to legacy regex
  }

  const re = /\|\s*(CP[123])\s*\|\s*✅/g
  let m
  while ((m = re.exec(text)) !== null) {
    if (m[1] in confirmed) confirmed[m[1]] = true
  }
  const cp3Exempt = /(?:\|\s*CP3\s*\|\s*N\/A\b|CP3\s*[:：]\s*N\/A)/i.test(text)
  if (cp3Exempt) {
    confirmed.CP3 = true
    confirmed.CP3Exempt = true
  }
  return confirmed
}

function hasTaskArtifact(task, phase, state) {
  const activeRoot = state ? getActiveNamespaceRoot(state) : path.dirname(path.dirname(path.resolve(task.fullPath || task)))
  const project = String(state?.activeProject || CONTEXT_PROJECT || path.basename(activeRoot)).trim()
  try { return registryHasTaskArtifact(task, phase, { fs, activeRoot, project }) } catch { return false }
}

function listTaskDirs(state) {
  const taskRoots = getTaskRoots(state)
  const out = []
  for (const root of taskRoots) {
    if (!fs.existsSync(root.dir)) continue
    let entries
    try { entries = fs.readdirSync(root.dir) } catch { continue }
    for (const name of entries) {
      const fullPath = path.join(root.dir, name)
      try {
        const s = fs.statSync(fullPath)
        if (s.isDirectory()) out.push({ kind: root.kind, name, fullPath })
      } catch { }
    }
  }
  return out.sort((left, right) =>
    `${left.kind}/${left.name}`.localeCompare(`${right.kind}/${right.name}`, 'en')
  )
}

function getTaskRoots(state) {
  const namespaceRoot = getActiveNamespaceRoot(state)
  return [
    { kind: 'requirements', dir: path.join(namespaceRoot, 'requirements') },
    { kind: 'bugs', dir: path.join(namespaceRoot, 'bugs') },
    { kind: 'optimizations', dir: path.join(namespaceRoot, 'optimizations') },
    { kind: 'scenario-tests', dir: path.join(namespaceRoot, 'scenario-tests') }
  ]
}

function taskRuntimeStatus(task, fallback = 'active') {
  const explicit = String(task?.status || '').trim().toLowerCase()
  if (['active', 'completed', 'rejected'].includes(explicit)) return explicit
  const sessionsFile = task?.fullPath ? path.join(task.fullPath, '.memory', 'sessions.md') : ''
  let text = ''
  try { text = fs.readFileSync(sessionsFile, 'utf8') } catch { }
  const statusLine = text.split(/\r?\n/u).find(line => /(?:当前状态|\bstatus\b)/iu.test(line)) || ''
  if (/❌|rejected|已拒绝|已废弃/iu.test(statusLine)) return 'rejected'
  if (/✅|completed|已完成|closed/iu.test(statusLine)) return 'completed'
  return fallback
}

function readTaskIdentityForRecoveryBinding(taskRoot) {
  for (const candidate of [
    path.join(taskRoot, '.memory', 'task-identity-v2.json'),
    path.join(taskRoot, '.memory', 'task.json')
  ]) {
    try {
      const value = JSON.parse(fs.readFileSync(candidate, 'utf8'))
      if (value && typeof value === 'object' && !Array.isArray(value)) return { value, file: candidate }
    } catch { }
  }
  return null
}

function bindTaskRecoveryState(state, task) {
  const rawTaskRoot = String(task?.taskRoot || task?.fullPath || '').trim()
  if (!rawTaskRoot) return false
  const taskRoot = path.resolve(rawTaskRoot)
  if (!fs.existsSync(taskRoot)) return false
  const identityRead = readTaskIdentityForRecoveryBinding(taskRoot)
  if (!identityRead) return false
  const identity = identityRead.value
  const taskId = String(identity?.taskId || task?.taskId || '').trim().toLowerCase()
  const displayName = String(identity?.displayName || task?.displayName || task?.name || '').trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId) || !displayName) return false
  const project = String(
    identity?.project || task?.project || (state.activeScope === 'workspace' ? 'workspace' : state.activeProject || CONTEXT_PROJECT)
  ).trim()
  if (!project) return false
  const expectedProject = String(state.activeScope === 'workspace' ? 'workspace' : state.activeProject || CONTEXT_PROJECT || '').trim()
  if (expectedProject && project !== expectedProject) return false
  const activeRoot = getActiveNamespaceRoot(state)
  const relativeTaskRoot = path.relative(path.resolve(activeRoot), taskRoot)
  if (!relativeTaskRoot || relativeTaskRoot === '..' || relativeTaskRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeTaskRoot)) return false
  if (identity.schemaVersion === 'TaskIdentityV2' && !evaluatePortableTaskIdentityBinding(identity, {
    taskId,
    project,
    taskKind: String(task?.kind || ''),
    taskRootRelative: relativeTaskRoot,
    currentProjectRootIdentityDigest: state.stickyProject?.rootIdentityDigest
  }).valid) return false
  if (identity.schemaVersion !== 'TaskIdentityV2' && !validateTaskIdentity(identity).valid) return false
  const ownerRead = readFencedTaskWriteOwner({
    metaDir: resolveTaskRecoveryMetaDir({ activeRoot, project, taskId }),
    identity: { activeRoot, project, taskId, taskStatus: 'active' }
  }, { fs })
  if (ownerRead.state) {
    state.fencedWriteOwner = ownerRead.owner || ownerRead.state.fencedWriteOwner || null
    state.admissionTransaction = ownerRead.transaction || state.admissionTransaction || null
    state.workflowTaskTerminalReceipt = ownerRead.terminalReceipt || null
  }
  if (ownerRead.status === 'fresh' && ownerRead.owner?.status === 'terminal') {
    const terminalReceipt = ownerRead.terminalReceipt || null
    const terminalValidation = validateWorkflowTaskTerminalReceipt(terminalReceipt, {
      activeRoot,
      project,
      taskId,
      taskStatus: 'completed'
    })
    state.taskRecoveryBinding = state.taskRecoveryBinding?.taskId === taskId ? null : state.taskRecoveryBinding
    state.workflowTaskTerminalReceipt = terminalValidation.valid ? terminalReceipt : null
    state.workflowTaskTerminalObservationError = terminalValidation.valid
      ? null
      : `WORKFLOW_TASK_TERMINAL_RECEIPT_INVALID:${terminalValidation.errors.join(',')}`
    if (terminalValidation.valid) {
      state.turnLiveness = applyWorkflowTaskTerminalReceipt(state.turnLiveness, terminalReceipt)
    }
    return false
  }
  const runtimeStatus = ownerRead.status === 'fresh' && ownerRead.owner?.status === 'active'
    ? 'active'
    : taskRuntimeStatus({ ...task, fullPath: taskRoot })
  if (['completed', 'rejected'].includes(runtimeStatus)) return false
  if (state.workflowTaskTerminalReceipt?.taskId === taskId) state.workflowTaskTerminalReceipt = null
  if (state.turnLiveness?.workflowTaskTerminal?.taskId === taskId) state.turnLiveness.workflowTaskTerminal = null
  state.taskRecoveryBinding = {
    schemaVersion: 'TaskRecoveryBindingV1',
    taskId,
    displayName,
    project,
    kind: String(task?.kind || ''),
    taskRoot,
    status: runtimeStatus,
    identityRevision: Number(identity.identityRevision || identity.identityVersion) || 1,
    boundAt: state.taskRecoveryBinding?.taskId === taskId
      ? state.taskRecoveryBinding.boundAt
      : new Date().toISOString()
  }
  return true
}

function observeValidationControlIngress(state, prompt) {
  const envelope = state.actualInstructionEnvelope
  const task = state.taskRecoveryBinding
  const projectRoot = state.stickyProject?.physicalRoot
  if (!envelope || !task?.taskId || !task.project || !projectRoot) {
    state.validationControlIngress = null
    return null
  }
  try {
    const receipt = createValidationControlIngressReceipt({
      actualInstructionEnvelope: envelope,
      actualInstruction: prompt,
      executionMode: state.executionMode,
      taskRecoveryKey: task.taskId,
      project: task.project,
      projectRootIdentity: validationProjectRootIdentity(projectRoot)
    })
    applyValidationControlIngress(state, receipt)
    state.validationControlIngressError = null
    return receipt
  } catch (error) {
    state.validationControlIngress = null
    state.validationControlIngressError = {
      code: error.code || 'VALIDATION_CONTROL_INGRESS_FAILED',
      message: error.message
    }
    return null
  }
}

function refreshTaskRecoveryBinding(state) {
  const binding = state?.taskRecoveryBinding
  if (!binding?.taskRoot || !binding?.taskId) return false
  return bindTaskRecoveryState(state, {
    ...binding,
    fullPath: binding.taskRoot,
    name: binding.displayName
  })
}

function isTaskAuthorityControlTool(payload) {
  return /(?:^|__)memory_task_(?:admit_v2|write_owner|fast_path_lease|terminal_v1|closeout_reconcile_v1)$/i.test(
    String(getToolName(payload) || '').trim()
  )
}

function evaluateFencedTaskMutationAuthority(state) {
  const binding = state?.taskRecoveryBinding
  if (!binding?.taskId || !binding?.project) {
    return { valid: false, errorCode: 'TASK_WRITE_OWNER_BINDING_REQUIRED' }
  }
  const activeRoot = getActiveNamespaceRoot(state)
  const ownerRead = readFencedTaskWriteOwner({
    metaDir: resolveTaskRecoveryMetaDir({ activeRoot, project: binding.project, taskId: binding.taskId }),
    identity: {
      activeRoot,
      project: binding.project,
      taskId: binding.taskId,
      taskStatus: 'active'
    }
  }, { fs })
  if (ownerRead.state) {
    state.fencedWriteOwner = ownerRead.owner || ownerRead.state.fencedWriteOwner || null
    state.admissionTransaction = ownerRead.transaction || ownerRead.state.admissionTransaction || null
    state.workflowTaskTerminalReceipt = ownerRead.terminalReceipt || ownerRead.state.workflowTaskTerminalReceipt || null
  }
  if (ownerRead.status !== 'fresh' || ownerRead.source !== 'primary') {
    return {
      valid: false,
      errorCode: ownerRead.errorCode || 'TASK_WRITE_OWNER_REQUIRED',
      observedStatus: ownerRead.status,
      observedSource: ownerRead.source || null
    }
  }
  const owner = ownerRead.owner
  const transaction = ownerRead.transaction
  const nowMs = Date.now()
  const checks = {
    ownerActive: owner?.status === 'active' && Date.parse(String(owner.expiresAt || '')) > nowMs,
    task: owner?.taskId === binding.taskId && transaction?.taskId === binding.taskId,
    projectRoot: owner?.projectRootIdentity === state.stickyProject?.rootIdentityDigest &&
      transaction?.projectRootIdentityDigest === state.stickyProject?.rootIdentityDigest,
    session: owner?.sessionDigest === state.stickyProject?.authorityDigest,
    context: owner?.contextEpoch === state.actualInstructionEnvelope?.contextEpoch,
    route: owner?.routeRevision === state.workflowRouteDecision?.routeRevision &&
      transaction?.routeRevision === state.workflowRouteDecision?.routeRevision,
    admission: transaction?.phase === 'finalized' && transaction?.status === 'finalized',
    cp: transaction?.effects?.cpState?.status === 'confirmed' && transaction?.effects?.cpState?.cp1Confirmed === true
  }
  const failed = Object.entries(checks).filter(([, value]) => value !== true).map(([key]) => key)
  return failed.length
    ? {
        valid: false,
        errorCode: failed.includes('cp') ? 'TASK_WRITE_OWNER_CP_CONFIRMATION_REQUIRED' : 'TASK_WRITE_OWNER_AUTHORITY_MISMATCH',
        failed,
        ownerGeneration: owner?.ownerGeneration || null,
        leaseRevision: owner?.leaseRevision || null
      }
    : {
        valid: true,
        ownerGeneration: owner.ownerGeneration,
        leaseRevision: owner.leaseRevision,
        leaseDigest: owner.leaseDigest,
        admissionId: transaction.admissionId,
        admissionGeneration: transaction.admissionGeneration
      }
}

function taskNeedsCpGate(task, state, options = {}) {
  if (!task?.fullPath || fs.existsSync(path.join(task.fullPath, '.archived'))) return false
  if (options.requireCp1 !== false && !hasTaskArtifact(task, 'CP1', state)) return false
  const cp = readCpConfirmations(task.fullPath)
  if (cp.CP3) {
    clearTaskCp3RuntimeRecord(state, task)
    return false
  }
  if (!hasTaskArtifact(task, 'CP3', state)) return true
  return !cp.CP3
}

function taskSelectionFailure(state, reason, candidates = []) {
  return {
    kind: 'task',
    name: 'session-bound-task-required',
    fullPath: getActiveNamespaceRoot(state),
    taskSelectionError: String(reason || 'task-binding-required'),
    candidateCount: candidates.length,
    candidateRefs: candidates.slice(0, 8).map(task => `${task.kind}/${task.name}`)
  }
}

function resolveSessionBoundTask(state) {
  const bindingHint = state?.taskRecoveryBinding
  if (!bindingHint?.taskRoot && !bindingHint?.taskId) return { status: 'missing', task: null }
  if (!refreshTaskRecoveryBinding(state)) return { status: 'stale', task: null }
  const binding = state.taskRecoveryBinding
  const task = getTaskScopeFromPath(binding.taskRoot, state)
  if (!task || !sameResolvedPath(task.fullPath, binding.taskRoot)) {
    return { status: 'invalid', task: null }
  }
  return { status: 'fresh', task }
}

function findIncompleteTask(state) {
  const bindingResolution = resolveSessionBoundTask(state)
  if (bindingResolution.status !== 'missing') {
    if (bindingResolution.status !== 'fresh') {
      return taskSelectionFailure(state, `${bindingResolution.status}-task-recovery-binding`)
    }
    const boundTask = bindingResolution.task
    // A fresh session binding is authoritative even when another task has a
    // newer directory mtime. A bound task without CP1 is still incomplete for
    // source mutation and must fail at CP2 instead of falling through.
    if (!hasTaskArtifact(boundTask, 'CP1', state)) return boundTask
    return taskNeedsCpGate(boundTask, state) ? boundTask : null
  }

  const candidates = listTaskDirs(state).filter(task => taskNeedsCpGate(task, state))
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]
  // Compatibility may infer an unbound target only when there is exactly one
  // eligible task. Multiple tasks require session-owned target authority;
  // mtime is discovery metadata, never an authorization signal.
  return taskSelectionFailure(state, 'ambiguous-active-tasks', candidates)
}

function getTaskRuntimeKey(task) {
  return `${task.kind}:${path.normalize(task.fullPath).toLowerCase()}`
}

function getTaskCp3RuntimeRecord(state, task) {
  if (!isPlainObject(state.cp3Runtime)) state.cp3Runtime = {}
  const key = getTaskRuntimeKey(task)
  if (!isPlainObject(state.cp3Runtime[key])) {
    state.cp3Runtime[key] = {
      kind: task.kind,
      name: task.name,
      reqPath: task.fullPath,
      trackedFiles: [],
      trackedFileDigests: [],
      triggered: false,
      triggerType: '',
      triggerReason: '',
      triggerCount: 0,
      triggeredAt: '',
      updatedAt: ''
    }
  }
  return state.cp3Runtime[key]
}

function clearTaskCp3RuntimeRecord(state, task) {
  if (!isPlainObject(state.cp3Runtime)) return
  delete state.cp3Runtime[getTaskRuntimeKey(task)]
}

function extractToolPaths(payload) {
  return extractMutationFootprint(payload, { cwd: CONTEXT_ROOT }).normalizedTargets
}

function extractSourceMutationTargets(payload, state) {
  return [...new Set(extractToolPaths(payload))]
    .map(resolveRelativeToContext)
    .filter(target => SOURCE_EXT_RE.test(target) && !isDevCodexManagedPath(target, state))
}

function isHighRiskCp3RuntimeTarget(target) {
  const rel = toWorkspaceRelativePath(target)
  return [
    /(^|\/)package\.json$/i,
    /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i,
    /(^|\/)\.env(?:\.[^\/]+)?$/i,
    /(^|\/)(Dockerfile|docker-compose(?:\.[^\/]+)?\.ya?ml)$/i,
    /(^|\/)\.github\/workflows\/.+\.ya?ml$/i,
    /(^|\/)(?:prisma\/schema\.prisma|schema\.prisma)$/i,
    /(^|\/)(?:migrations?|db\/migrations?)\//i
  ].some(re => re.test(rel))
}

function assessBugCp3RuntimeEscalation(task, payload, state) {
  const targets = extractSourceMutationTargets(payload, state)
  if (!targets.length) return null

  const record = getTaskCp3RuntimeRecord(state, task)
  if (record.triggered === true) {
    return {
      type: record.triggerType || 'file-threshold',
      reason: record.triggerReason || `执行中已触达 ${record.triggerCount || CP3_RUNTIME_FILE_THRESHOLD} 个源码/配置文件（阈值 ${CP3_RUNTIME_FILE_THRESHOLD}）`,
      count: record.triggerCount || CP3_RUNTIME_FILE_THRESHOLD,
      threshold: CP3_RUNTIME_FILE_THRESHOLD,
      trackedFiles: Array.isArray(record.trackedFiles) ? record.trackedFiles : []
    }
  }

  const previousFiles = Array.isArray(record.trackedFiles) ? record.trackedFiles : []
  const canonicalRuntimeTarget = rel => process.platform === 'win32'
    ? String(rel).toLowerCase()
    : String(rel)
  const tracked = new Set(Array.isArray(record.trackedFileDigests) && record.trackedFileDigests.length
    ? record.trackedFileDigests
    : previousFiles.map(rel => crypto.createHash('sha256').update(canonicalRuntimeTarget(rel)).digest('hex')))
  const nextTargets = targets.map(toWorkspaceRelativePath).filter(Boolean)
  for (const rel of nextTargets) {
    tracked.add(crypto.createHash('sha256').update(canonicalRuntimeTarget(rel)).digest('hex'))
  }

  // CP3 escalation needs only the first five unique identities. Keep bounded
  // previews and stable digests; after the gate triggers the record remains
  // immutable until CP3 confirmation clears it.
  record.trackedFileDigests = [...tracked].sort().slice(0, CP3_RUNTIME_FILE_THRESHOLD)
  record.trackedFiles = [...new Set([...previousFiles, ...nextTargets])]
    .slice(0, CP3_RUNTIME_FILE_THRESHOLD)
  record.updatedAt = new Date().toISOString()

  const highRiskTarget = targets.find(isHighRiskCp3RuntimeTarget)
  if (highRiskTarget) {
    const rel = toWorkspaceRelativePath(highRiskTarget)
    record.triggered = true
    record.triggerType = 'high-risk'
    record.triggerReason = `执行中新增高风险文件 ${rel}`
    record.triggerCount = tracked.size
    record.triggeredAt = record.updatedAt
    return {
      type: 'high-risk',
      reason: record.triggerReason,
      count: tracked.size,
      threshold: CP3_RUNTIME_FILE_THRESHOLD,
      trackedFiles: record.trackedFiles
    }
  }

  if (tracked.size >= CP3_RUNTIME_FILE_THRESHOLD) {
    record.triggered = true
    record.triggerType = 'file-threshold'
    record.triggerReason = `执行中已触达 ${tracked.size} 个源码/配置文件（阈值 ${CP3_RUNTIME_FILE_THRESHOLD}）`
    record.triggerCount = tracked.size
    record.triggeredAt = record.updatedAt
    return {
      type: 'file-threshold',
      reason: record.triggerReason,
      count: tracked.size,
      threshold: CP3_RUNTIME_FILE_THRESHOLD,
      trackedFiles: record.trackedFiles
    }
  }

  return null
}

// Map a file path to its owning task scope (.devcodex/requirements/<X>/... or .devcodex/bugs/<X>/...).
// returns null when the path is not under any supported task directory.
function getTaskScopeFromPath(p, state) {
  if (!p) return null
  let abs = resolveRelativeToContext(p)
  const norm = path.normalize(abs)
  for (const root of getTaskRoots(state)) {
    const rootDir = path.normalize(root.dir)
    if (!norm.toLowerCase().startsWith(rootDir.toLowerCase() + path.sep)) continue
    const rel = path.relative(rootDir, norm)
    const parts = rel.split(path.sep).filter(Boolean)
    if (!parts.length) return null
    return {
      kind: root.kind,
      name: parts[0],
      fullPath: path.join(root.dir, parts[0])
    }
  }
  return null
}

function toWorkspaceRelativePath(p) {
  if (!p) return ''
  let abs = resolveRelativeToContext(p)
  let rel = abs
  try { rel = path.isAbsolute(abs) ? path.relative(WORKSPACE_ROOT, abs) : abs } catch { }
  return String(rel || '').replace(/\\/g, '/').replace(/^\.\//, '').trim()
}

function isAutoAllowedPath(p) {
  const rel = toWorkspaceRelativePath(p)
  return AUTO_ALLOWED_PATH_PATTERNS.some(re => re.test(rel))
}

function checkAutoWhitelist(payload, platform, state) {
  if (state.executionMode !== EXECUTION_MODE.AUTO) return null
  if (!isSourceCodeMutation(payload, platform, state)) return null
  const paths = [...new Set(extractToolPaths(payload))]
  if (!paths.length) {
    return {
      allowed: false,
      reason: 'Auto v1.1 无法识别当前变更目标路径，不能安全判定是否属于白名单。'
    }
  }
  const nonWhitelisted = paths.filter(p => !isAutoAllowedPath(p))
  if (!nonWhitelisted.length) return { allowed: true }
  const preview = nonWhitelisted.map(toWorkspaceRelativePath).slice(0, 3).join(', ')
  return {
    allowed: false,
    reason: `Auto v1.1 仅对白名单路径自动推进，以下目标不在白名单内：${preview}`
  }
}

// Path-aware CP gate: direct task-artifact paths identify their own scope.
// Mixed/source-code paths use the exact session binding (or the bounded
// single-task compatibility case); they never choose a task by mtime.
function findIncompleteTaskForPaths(payload, state) {
  const paths = extractToolPaths(payload)
  if (paths.length === 0) return findIncompleteTask(state)

  const taskScopes = paths.map(p => getTaskScopeFromPath(p, state))
  const allInTask = taskScopes.every(scope => scope !== null)
  if (!allInTask) return findIncompleteTask(state)  // mixed or source-code → preserve original behavior

  const targetMap = new Map()
  for (const scope of taskScopes) targetMap.set(`${scope.kind}:${scope.name}`, scope)
  if (targetMap.size > 1) {
    return taskSelectionFailure(state, 'multiple-task-targets', [...targetMap.values()])
  }
  const boundRoot = state?.taskRecoveryBinding?.taskRoot
  if (boundRoot && [...targetMap.values()].some(task => !sameResolvedPath(task.fullPath, boundRoot))) {
    return taskSelectionFailure(state, 'target-task-binding-mismatch', [...targetMap.values()])
  }
  for (const task of targetMap.values()) {
    if (!fs.existsSync(task.fullPath)) continue
    if (fs.existsSync(path.join(task.fullPath, '.archived'))) continue
    if (!hasTaskArtifact(task, 'CP1', state)) continue
    const cp = readCpConfirmations(task.fullPath)
    if (cp.CP3) {
      clearTaskCp3RuntimeRecord(state, task)
      continue
    }
    if (!hasTaskArtifact(task, 'CP3', state)) return task
    if (!cp.CP3) return task
  }
  return null  // all target tasks have CP3 confirmed → allow
}

function toControlPlaneRelPath(target) {
  return toWorkspaceRelativePath(target).replace(/\\/g, '/')
}

function isControlPlaneSourcePath(target, state) {
  if (!target || isActiveDevCodexNamespacePath(target, state)) return false
  if (isDevCodexDeploymentPath(target)) return true
  // Workspace custom skills must never be treated as package control-plane skills/
  try {
    const { isWorkspaceSkillPath } = require('./skill-resolution.cjs')
    if (isWorkspaceSkillPath(resolveRelativeToContext(target), { cwd: CONTEXT_ROOT || WORKSPACE_ROOT })) {
      return false
    }
  } catch {
    /* skill-resolution optional during partial deploys */
  }
  const rel = toControlPlaneRelPath(target)
  return CONTROL_PLANE_SOURCE_RE.test(rel)
}

function payloadTouchesControlPlaneSource(payload, state) {
  const paths = [...new Set(extractToolPaths(payload))]
  if (!paths.length) return false
  return paths.some(p => isControlPlaneSourcePath(p, state))
}

/**
 * Dual-Track M1: control-plane source mutation with no CP1-bound task at all → orphan CP3.
 * Incomplete tasks remain handled by findIncompleteTask*; dirs with CP1 keep normal CP2/CP3 gate.
 */
function checkOrphanControlPlaneGate(payload, state) {
  if (!payloadTouchesControlPlaneSource(payload, state)) return null
  if (resolveSessionBoundTask(state).status === 'fresh') return null
  const dirs = listTaskDirs(state).filter(d =>
    !fs.existsSync(path.join(d.fullPath, '.archived')) && hasTaskArtifact(d, 'CP1', state)
  )
  if (dirs.length > 0) {
    return {
      phase: 'CP2',
      reqName: 'session-bound-task-required',
      reqPath: getActiveNamespaceRoot(state),
      kind: 'task',
      code: 'cp-gate-task-binding-required',
      taskSelectionError: 'unbound-control-plane-mutation',
      candidateCount: dirs.length,
      candidateRefs: dirs.slice(0, 8).map(task => `${task.kind}/${task.name}`)
    }
  }
  return {
    phase: 'CP3',
    reqName: 'no-bound-task',
    reqPath: getActiveNamespaceRoot(state),
    kind: 'requirements',
    code: 'cp-gate-orphan-control-plane'
  }
}

function checkCpGate(payload, state) {
  const task = (payload && extractToolPaths(payload).length > 0)
    ? findIncompleteTaskForPaths(payload, state)
    : findIncompleteTask(state)
  if (task?.taskSelectionError) {
    return {
      phase: 'CP2',
      reqName: task.name,
      reqPath: task.fullPath,
      kind: task.kind,
      code: 'cp-gate-task-binding-required',
      taskSelectionError: task.taskSelectionError,
      candidateCount: task.candidateCount,
      candidateRefs: task.candidateRefs
    }
  }
  if (!task) {
    return checkOrphanControlPlaneGate(payload, state)
  }
  const confirmed = readCpConfirmations(task.fullPath)
  if (!hasTaskArtifact(task, 'CP2', state) || !confirmed.CP2) {
    return { phase: 'CP2', reqName: task.name, reqPath: task.fullPath, kind: task.kind }
  }
  if (task.kind === 'bugs' && !confirmed.CP3) {
    const runtimeTrigger = assessBugCp3RuntimeEscalation(task, payload, state)
    if (!runtimeTrigger) return null
    return {
      phase: 'CP3',
      reqName: task.name,
      reqPath: task.fullPath,
      kind: task.kind,
      code: runtimeTrigger.type === 'high-risk'
        ? 'cp-gate-CP3-runtime-risk'
        : 'cp-gate-CP3-runtime-threshold',
      runtimeTrigger
    }
  }
  return { phase: 'CP3', reqName: task.name, reqPath: task.fullPath, kind: task.kind }
}

// Source file extensions that indicate code/config being written
const SOURCE_EXT_RE = /\.(js|ts|tsx|jsx|mjs|cjs|py|go|rs|java|cs|rb|php|c|cpp|h|swift|kt|vue|svelte|css|scss|less|html|sql|sh|bash|zsh|ps1|psm1|json|yaml|yml|toml|ini|xml|env|md|mdx)$/i
// Host governance deployment paths are managed projections for lifecycle
// ownership, but they remain control-plane mutations. Only runtime state in
// the active .devcodex namespace is exempt from source mutation gates.
const DEVCODEX_DEPLOYMENT_PATH_RE = /^(?:(?:AGENTS|CLAUDE|GEMINI)\.md|\.mcp\.json)$|^\.agents\/(?:devcodex\/instructions\.full\.md|skills)(?:\/|$)|^\.github\/(?:copilot-instructions\.md|instructions|skills|hooks|agents|prompts|data)(?:\/|$)|^\.claude\/(?:instructions|skills|hooks|agents|prompts|data|mcp|settings\.json|settings\.local\.json)(?:\/|$)|^\.codex\/(?:hooks\.json|config\.toml|hooks)(?:\/|$)|^codex\/(?:hooks\.json|hooks)(?:\/|$)|^\.gemini\/(?:settings\.json|hooks)(?:\/|$)|^\.grok\/(?:config\.toml|hooks|devcodex\/plugins\/devcodex-workspace)(?:\/|$)|^\.cursor\/(?:hooks\.json|(?:devcodex\/)?plugins\/devcodex-workspace)(?:\/|$)/i

function isDevCodexDeploymentPath(target) {
  return DEVCODEX_DEPLOYMENT_PATH_RE.test(toWorkspaceRelativePath(target))
}

function isInsideOrSamePath(child, parent) {
  if (!child || !parent) return false
  const normChild = path.normalize(child).toLowerCase()
  const normParent = path.normalize(parent).toLowerCase()
  return normChild === normParent || normChild.startsWith(normParent + path.sep)
}

function isActiveDevCodexNamespacePath(target, state) {
  if (!target) return false
  const abs = resolveRelativeToContext(target)
  if (isInsideOrSamePath(abs, getActiveNamespaceRoot(state))) return true
  if (LAYOUT.enabled && getActiveScope(state) !== 'workspace') {
    return isInsideOrSamePath(abs, path.join(getWorkspaceNamespaceRoot(), 'profile'))
  }
  return false
}

function isDevCodexManagedPath(target, state) {
  if (!target) return false
  // Carve-out: workspace skills are user-editable extensions, not managed G/runtime state
  try {
    const { isWorkspaceSkillPath } = require('./skill-resolution.cjs')
    if (isWorkspaceSkillPath(resolveRelativeToContext(target), { cwd: CONTEXT_ROOT || WORKSPACE_ROOT })) {
      return false
    }
  } catch {
    /* optional */
  }
  if (isDevCodexDeploymentPath(target)) return true
  return isActiveDevCodexNamespacePath(target, state)
}

function payloadTouchesOnlyManagedPaths(payload, state) {
  const paths = [...new Set(extractToolPaths(payload))]
  return paths.length > 0 && paths.every(p => isDevCodexManagedPath(p, state))
}

function bashWritesToSourceCode(cmd, state) {
  if (!cmd) return false
  // Detect output redirect  >  or  >>  to a source file
  const redirectRe = />{1,2}\s*['"]?([^\s'";&|]+)/g
  let m
  while ((m = redirectRe.exec(cmd)) !== null) {
    const target = m[1]
    if (SOURCE_EXT_RE.test(target) && !isActiveDevCodexNamespacePath(target, state)) return true
  }
  // Detect tee targeting a source file
  const teeRe = /\btee\s+(?:-a\s+)?['"]?([^\s'";&|]+)/g
  while ((m = teeRe.exec(cmd)) !== null) {
    const target = m[1]
    if (SOURCE_EXT_RE.test(target) && !isActiveDevCodexNamespacePath(target, state)) return true
  }
  // PowerShell Set-Content / Out-File — extract target path before testing
  const setContentMatch = cmd.match(/\bSet-Content\b\s+(?:-Path\s+)?['"]?([^\s'";&|]+)/i)
  if (setContentMatch && SOURCE_EXT_RE.test(setContentMatch[1]) && !isActiveDevCodexNamespacePath(setContentMatch[1], state)) return true
  const outFileMatch = cmd.match(/\bOut-File\b\s+(?:-FilePath\s+)?['"]?([^\s'";&|]+)/i)
  if (outFileMatch && SOURCE_EXT_RE.test(outFileMatch[1]) && !isActiveDevCodexNamespacePath(outFileMatch[1], state)) return true
  return false
}

function isSourceCodeMutation(payload, platform, state) {
  // Server-owned authority controls describe future mutation targets, but do
  // not themselves mutate those targets. Keep their path-shaped request data
  // out of host mutation classification.
  if (isTaskAuthorityControlTool(payload)) return false
  const adapterDecision = classifyHostToolMutation(payload, {
    hostVariant: state?.hostIdentity?.hostVariant,
    platform
  })
  if (adapterDecision.mutationCandidate !== true || adapterDecision.operationClass === 'service-lifecycle') return false
  const footprint = extractMutationFootprint(payload, {
    cwd: CONTEXT_ROOT,
    platform,
    hostVariant: state?.hostIdentity?.hostVariant,
    adapterDecision
  })
  const physicalTargets = footprint.normalizedTargets.filter(target =>
    !/^[a-z][a-z0-9+.-]*:/i.test(target) || /^[a-z]:[\\/]/i.test(target)
  )
  if (!physicalTargets.length) {
    return ['indirect-writer', 'destructive', 'unknown'].includes(adapterDecision.operationClass) ||
      adapterDecision.coverage !== 'complete'
  }
  return physicalTargets.some(target => {
    if (isActiveDevCodexNamespacePath(target, state)) return false
    if (SOURCE_EXT_RE.test(target)) return true
    return ['indirect-writer', 'destructive', 'unknown'].includes(adapterDecision.operationClass)
  })
}

function buildCpDenyOutput(state, platform, eventName, gate, toolName) {
  const msgs = {
    CP2: 'CP2（方案）未完成 — 请先写入任务目录的 canonical 02 方案（需求/优化/场景测试为 02-技术方案.md，Bug 为 02-修复方案.md）并在 .memory/sessions.md 记录用户确认（✅）；reports 下的阶段报告不授予 CP 权威。',
    CP3: `CP3 (实施计划) 未完成 — 请先输出 ${CP3_FILE} 并在 .memory/sessions.md 记录用户确认（✅）后再编码。`
  }
  const orphanDetail = gate.code === 'cp-gate-orphan-control-plane'
    ? `控制面源码 mutation 无绑定任务（orphan）— 请先创建 requirements/bugs 任务并完成 CP1~CP3（含 ${CP3_FILE}）后再改 scripts/hooks/package 等控制面路径。`
    : ''
  const bindingDetail = gate.code === 'cp-gate-task-binding-required'
    ? `源码 mutation 缺少可验证的会话任务绑定（${gate.taskSelectionError || 'task-binding-required'}；候选 ${gate.candidateCount || 0} 个）。禁止按目录修改时间猜测任务，请先恢复 WorkspaceSessionRouteIndex/TaskRecoveryBinding 后重试。`
    : ''
  const runtimeDetail = gate.runtimeTrigger
    ? `${gate.runtimeTrigger.reason}，请先回到 CP3 更新实施计划并获得确认后再继续。`
    : ''
  const msg = bindingDetail || orphanDetail || runtimeDetail || msgs[gate.phase]
  return buildInterceptionOutput(
    state, platform, eventName, INTERCEPTION_ACTION.REQUIRE_COMPLETION, gate.code || `cp-gate-${gate.phase}`,
    `CP gate: ${gate.phase} not confirmed for "${gate.reqName}" — ${toolName} denied`,
    msg,
    `Complete and confirm ${gate.phase}, then retry the source mutation.`
  )
}

function buildCpWarningOutput(state, platform, eventName, gate, toolName) {
  let detail
  if (gate.code === 'cp-gate-task-binding-required') {
    detail = `源码 mutation 缺少可验证的会话任务绑定（${gate.taskSelectionError || 'task-binding-required'}）；不得按 mtime 猜测任务。`
  } else if (gate.code === 'cp-gate-orphan-control-plane') {
    detail = `控制面源码 mutation 无绑定任务（orphan）；请补任务与 ${CP3_FILE}+确认。 Tool allowed in safety-only mode.`
  } else if (gate.runtimeTrigger) {
    detail = `${gate.runtimeTrigger.reason}，请先回到 CP3 更新实施计划并获得确认。 Tool allowed in safety-only mode.`
  } else if (gate.phase === 'CP2') {
    detail = 'CP2 (技术方案) 未完成；请尽快补齐方案产物与用户确认记录。 Tool allowed in safety-only mode.'
  } else {
    detail = `CP3 (实施计划) 未完成；请尽快补齐 ${CP3_FILE} 与用户确认记录。 Tool allowed in safety-only mode.`
  }
  return buildInterceptionOutput(
    state, platform, eventName, INTERCEPTION_ACTION.REQUIRE_COMPLETION, gate.code || `cp-gate-${gate.phase}`,
    `CP gate warning: ${gate.phase} not confirmed for "${gate.reqName}" before ${toolName}`,
    detail,
    `Complete and confirm ${gate.phase}, then retry the source mutation.`
  )
}

// ─── Dangerous command detection ──────────────────────────────────────────────

const DANGEROUS_PATTERNS = [
  { re: /\brm\s+-rf\s+(?:\/|[A-Za-z]:\\?)(?:\s|$)/i, reason: 'Blocked: rm -rf root', neverApprove: true },
  { re: /\brm\s+-rf\b/i, reason: 'Blocked: rm -rf' },
  { re: /\bgit\s+reset\s+--hard\b/i, reason: 'Blocked: git reset --hard' },
  { re: /\bdrop\s+table\b/i, reason: 'Blocked: DROP TABLE', neverApprove: true },
  { re: /\bdelete\s+from\b(?:(?!\bwhere\b|;)[\s\S])*(?:;|$)/i, reason: 'Blocked: DELETE FROM without WHERE', neverApprove: true },
  { re: /\btruncate\b/i, reason: 'Blocked: TRUNCATE', neverApprove: true },
  { re: /\bdel\s+\/f\s+\/q\b/i, reason: 'Blocked: del /f /q' },
  { re: /Remove-Item[\s\S]*-Recurse[\s\S]*-Force|Remove-Item[\s\S]*-Force[\s\S]*-Recurse/i, reason: 'Blocked: Remove-Item -Recurse -Force' }
]

const {
  checkDangerousCommand,
  stripApprovalMarker,
  pruneDangerousApprovals,
  createDangerousApproval,
  confirmDangerousApprovalsFromPrompt,
  consumeDangerousApproval
} = buildLifecycleDangerousCommandUtils({
  path,
  crypto,
  CONTEXT_ROOT,
  WORKSPACE_ROOT,
  APPROVAL_TTL_MS,
  DANGEROUS_PATTERNS,
  getToolName,
  getCommandText,
  INTERCEPTION_ACTION,
  recordInterception
})

// ─── Artifact touches ────────────────────────────────────────────────────────

function isMutatingTool(payload, platform) {
  if (isTaskAuthorityControlTool(payload)) return false
  return classifyHostToolMutation(payload, { platform }).mutationCandidate === true
}

function updateArtifactTouches(state, payload, platform) {
  if (touchesPath(payload, '/reports/')) state.reportTouched = true
  if (touchesPath(payload, '/.memory/', '/sessions.md')) state.memoryTouched = true
  if (isMutatingTool(payload, platform)) state.mutated = true
}

/** Product-artifact paths: reports, memory, runtime ledgers (S07 order / VL-004). */
const PRODUCT_ARTIFACT_PATH_NEEDLES = [
  '/reports/',
  '\\reports\\',
  '/.memory/',
  '\\.memory\\',
  '/data/violations.md',
  '/data/process-improvements.md',
  '/data/pending-fixes.md',
  '/data/pending-issues.md',
  '/data/gap-registry.md'
]

function isWriteLikeToolName(toolName) {
  const tn = String(toolName || '').toLowerCase()
  return (
    /^(?:write|edit|search[_-]?replace|str[_-]?replace|apply[_-]?patch|create[_-]?file|multi[_-]?edit|insert[_-]?code|rewrite[_-]?file)$/i.test(tn) ||
    /memory_(?:session_write|summary_append|cp_confirm)|memory-(?:session-write|summary-append|cp-confirm)/i.test(tn)
  )
}

/**
 * True when a mutating tool targets product artifacts that must not precede first user-visible PC0.
 * Read-only tools never match. Mid-turn precheck is almost never verified-present on tool-loop hosts.
 */
function isProductArtifactMutation(payload, platform) {
  if (isTaskAuthorityControlTool(payload)) return false
  const tool = getToolName(payload)
  const adapterDecision = classifyHostToolMutation(payload, { platform })
  if (adapterDecision.mutationCandidate !== true) return false
  const footprint = extractMutationFootprint(payload, { cwd: CONTEXT_ROOT, platform, adapterDecision })
  if (footprint.normalizedTargets.some(target => PRODUCT_ARTIFACT_PATH_NEEDLES.some(needle =>
    String(target).toLowerCase().includes(String(needle).toLowerCase())
  ))) return true
  if (touchesPath(payload, ...PRODUCT_ARTIFACT_PATH_NEEDLES)) return true
  // MCP memory writes often omit path strings in tool_input
  if (/memory_(?:session_write|summary_append|cp_confirm)|memory-(?:session-write|summary-append|cp-confirm)/i.test(tool)) return true
  return false
}

function markProductMutationOrder(state, payload, platform) {
  if (!isProductArtifactMutation(payload, platform)) return false
  const precheckStatus = getPrecheckEvidenceStatus(state)
  if (precheckStatus !== 'verified-present') {
    state.productMutationBeforePrecheck = true
    state.productMutationCountThisTurn = (state.productMutationCountThisTurn || 0) + 1
  }
  return true
}

function isRecoveryMutation(payload, platform, state) {
  if (isTaskAuthorityControlTool(payload)) return false
  return isSourceCodeMutation(payload, platform, state) || isProductArtifactMutation(payload, platform)
}

function artifactAuthoritySourceRef(state) {
  const taskId = String(state.taskRecoveryBinding?.taskId || '').trim()
  const contextEpoch = String(state.contextAcquisition?.contextEpoch || '').trim()
  const session = String(state.contextAcquisition?.hostSessionId || state.turnLiveness?.turnKey || '').trim()
  return taskId && contextEpoch
    ? `task-recovery:${taskId}:context:${contextEpoch}`
    : `host-session:${session || 'unbound'}`
}

function evaluateWorkflowOperationalWriteAuthority(state, footprint, payload, options = {}) {
  const lease = state?.workflowOperationalWriteLease
  if (!lease) {
    return {
      valid: false,
      errors: ['workflow-operational-lease-missing'],
      lease: null,
      authorityRole: null,
      appendOnlyAuthorized: false
    }
  }
  return validateWorkflowOperationalWriteLease(lease, operationalLeaseValidationInput(state, {
    footprint,
    payload
  }), options)
}

function evaluateSimpleTaskFastPathAuthority(state, footprint, payload, options = {}) {
  const lease = state?.simpleTaskFastPathLease
  if (!lease) {
    return {
      valid: false,
      errors: ['simple-task-fast-path-lease-missing'],
      lease: null,
      usage: null
    }
  }
  return validateSimpleTaskFastPathLease(lease, {
    state,
    activeRoot: getActiveNamespaceRoot(state),
    projectRoot: state.stickyProject?.physicalRoot || CONTEXT_ROOT,
    footprint,
    operation: 'create-or-update',
    usage: state.simpleTaskFastPathUsage,
    operationId: String(options.operationId || lifecycleToolOperationId(payload) || '')
  }, options)
}

function resolveArtifactAuthorityRole(state, payload, footprint, operationalAuthority = null) {
  if (operationalAuthority?.valid === true) return operationalAuthority.authorityRole
  const toolName = String(getToolName(payload) || '').trim().toLowerCase()
  if (isTaskAuthorityControlTool(payload)) return 'task-admission'
  if (/memory_(?:session_write|summary_append|cp_confirm)|memory-(?:session-write|summary-append|cp-confirm)/i.test(toolName)) {
    return 'workflow-owner'
  }
  if (/profile_(?:set|write|update|save)|profile-(?:set|write|update|save)/i.test(toolName)) return 'profile-owner'
  if (/(?:governance|process_improvement|pending_fix|pending_issue|gap_registry)/i.test(toolName)) return 'governance-owner'
  if (/(?:release|publish|tag)/i.test(toolName)) return 'release-owner'
  const activeRoot = path.resolve(getActiveNamespaceRoot(state))
  for (const target of footprint?.normalizedTargets || []) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:[\/]/i.test(target)) continue
    const absolute = path.resolve(target)
    const relative = path.relative(activeRoot, absolute).replace(/\\/g, '/')
    if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) continue
    if (/^profile\//i.test(relative)) return 'profile-owner'
    if (/^data\/(?:process-improvements|pending-fixes|pending-issues|gap-registry|violations)\.md$/i.test(relative)) {
      return 'governance-owner'
    }
  }
  return 'task-owner'
}

function prepareArtifactMutationDecision(state, payload, platform) {
  const adapterDecision = classifyHostToolMutation(payload, {
    hostVariant: state?.hostIdentity?.hostVariant,
    platform
  })
  if (isTaskAuthorityControlTool(payload)) {
    return {
      adapterDecision,
      footprint: null,
      decision: null,
      operationalAuthority: null,
      simpleAuthority: null
    }
  }
  if (adapterDecision.mutationCandidate !== true) return { adapterDecision, footprint: null, decision: null }
  const footprint = extractMutationFootprint(payload, {
    cwd: CONTEXT_ROOT,
    platform,
    hostVariant: state?.hostIdentity?.hostVariant,
    adapterDecision
  })
  const scopes = footprint.normalizedTargets
    .filter(target => !/^[a-z][a-z0-9+.-]*:/i.test(target) || /^[a-z]:[\\/]/i.test(target))
    .map(target => getTaskScopeFromPath(target, state))
    .filter(Boolean)
  const boundScope = resolveSessionBoundTask(state).task
  // The session-owned task is the authority. Feeding that exact scope into the
  // slot decision makes a write into another task fail with a kind/name
  // mismatch instead of borrowing the current owner's lease.
  const scope = boundScope || scopes[0] || null
  const operationalAuthority = evaluateWorkflowOperationalWriteAuthority(state, footprint, payload, { phase: 'pre' })
  const simpleAuthority = operationalAuthority.valid
    ? { valid: false, errors: ['workflow-operational-authority-selected'], lease: null, usage: null }
    : evaluateSimpleTaskFastPathAuthority(state, footprint, payload, { phase: 'pre' })
  const authorityRole = resolveArtifactAuthorityRole(state, payload, footprint, operationalAuthority)
  const decision = decideArtifactMutation({
    footprint,
    activeRoot: getActiveNamespaceRoot(state),
    projectRoot: state.stickyProject?.physicalRoot || CONTEXT_ROOT,
    cwd: CONTEXT_ROOT,
    project: state.activeProject || CONTEXT_PROJECT || 'workspace',
    taskRecoveryKey: state.taskRecoveryBinding?.taskId || null,
    contextEpoch: state.contextAcquisition?.contextEpoch || null,
    intent: state.workflowRouteDecision?.topIntent || 'formal-artifact',
    taskKind: scope?.kind || null,
    taskName: scope?.name || null,
    authoritySourceRef: operationalAuthority.valid
      ? `workflow-operational:${operationalAuthority.lease.leaseId}`
      : (simpleAuthority.valid
          ? `simple-task-fast-path:${simpleAuthority.lease.leaseId}`
          : artifactAuthoritySourceRef(state)),
    authorityRole,
    operationalLeaseDigest: operationalAuthority.valid ? operationalAuthority.lease.leaseDigest : null,
    appendOnlyAuthorized: operationalAuthority.valid && operationalAuthority.appendOnlyAuthorized === true,
    formalIntent: isRecoveryMutation(payload, platform, state)
  })
  return { adapterDecision, footprint, decision, operationalAuthority, simpleAuthority }
}

function artifactDecisionBlock(decision) {
  if (!decision || decision.decisionStatus === 'not-applicable') return null
  const validation = validateArtifactSlotDecision(decision)
  if (decision.decisionStatus !== 'allow' || !validation.valid) {
    return {
      code: decision.errorCodes?.[0] || validation.errors?.[0] || 'ARTIFACT_DECISION_REQUIRED',
      errors: [...new Set([...(decision.errorCodes || []), ...(validation.errors || [])])]
    }
  }
  return null
}

function mutationFootprintBlock(state, payload, platform, adapterDecision, footprint) {
  if (!adapterDecision || adapterDecision.mutationCandidate !== true || !footprint) return null
  if (adapterDecision.operationClass === 'service-lifecycle' || isTaskAuthorityControlTool(payload)) return null
  if (!isRecoveryMutation(payload, platform, state)) return null
  const errors = []
  if (adapterDecision.operationClass === 'unknown') errors.push('host-tool-adapter-unknown')
  if (footprint.coverage !== 'complete') errors.push('mutation-footprint-coverage-incomplete')
  if (footprint.normalizedTargets.length === 0) errors.push('mutation-target-set-empty')
  if (!errors.length) return null
  return {
    code: errors[0],
    errors: [...new Set([...errors, ...(footprint.ambiguityCodes || [])])]
  }
}

function maybeBindTaskRecoveryForPayload(state, payload, platform) {
  if (isTaskAuthorityControlTool(payload)) return false
  if (refreshTaskRecoveryBinding(state)) return true
  for (const target of extractToolPaths(payload)) {
    const scoped = getTaskScopeFromPath(target, state)
    if (scoped && bindTaskRecoveryState(state, scoped)) return true
  }
  if (!isRecoveryMutation(payload, platform, state)) return false
  const task = findIncompleteTaskForPaths(payload, state) || findIncompleteTask(state)
  return task && !task.taskSelectionError ? bindTaskRecoveryState(state, task) : false
}

function lifecycleToolOperationId(payload) {
  return String(
    payload?.tool_use_id || payload?.toolUseId || payload?.tool_call_id || payload?.toolCallId || payload?.call_id || ''
  ).trim()
}

function mutationAuthorizationError(code, message, details = []) {
  const error = new Error(message)
  error.code = code
  error.details = details
  return error
}

function sameResolvedPath(left, right) {
  if (!left || !right) return false
  const a = path.normalize(path.resolve(String(left)))
  const b = path.normalize(path.resolve(String(right)))
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function artifactRootIdentityDigest(value) {
  const normalized = path.normalize(path.resolve(String(value || '')))
  return stableDigest(process.platform === 'win32' ? normalized.toLowerCase() : normalized)
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ''))
}

function validatePersistedArtifactDecision(decision) {
  if (!decision || typeof decision !== 'object') return ['artifact-decision-missing']
  if (decision.projectionKind !== 'digest-only') {
    const validation = validateArtifactSlotDecision(decision)
    return validation.valid ? [] : validation.errors
  }
  const errors = []
  if (decision.schemaVersion !== 'ArtifactSlotDecisionV2') errors.push('artifact-decision-schema-invalid')
  if (decision.decisionStatus !== 'allow' || decision.status !== 'active' || decision.singleUse !== true) {
    errors.push('artifact-decision-not-active')
  }
  for (const field of [
    'decisionDigest', 'targetSetDigest', 'footprintDigest', 'adapterDigest', 'plannedSetDigest',
    'mergedRegistryDigest'
  ]) if (!isSha256(decision[field])) errors.push(`artifact-decision-${field}-invalid`)
  if (decision.baseRegistryDigest !== undefined && !isSha256(decision.baseRegistryDigest)) {
    errors.push('artifact-decision-baseRegistryDigest-invalid')
  }
  if (decision.overlayDigest !== undefined && decision.overlayDigest !== null && !isSha256(decision.overlayDigest)) {
    errors.push('artifact-decision-overlayDigest-invalid')
  }
  if (!isSha256(decision.activeRootIdentity?.digest) || !isSha256(decision.projectRootIdentity?.digest)) {
    errors.push('artifact-decision-root-identity-invalid')
  }
  if (!Number.isFinite(Date.parse(String(decision.expiresAt || ''))) || Date.parse(decision.expiresAt) <= Date.now()) {
    errors.push('artifact-decision-expired')
  }
  return errors
}

function validateMutationAuthorizationBundle(state, operation, options = {}) {
  const errors = []
  if (!operation || operation.mutating !== true) return { valid: false, errors: ['mutation-operation-missing'] }
  const decision = operation.artifactDecision
  const lease = operation.mutationLease
  const footprint = operation.mutationFootprint
  const preObservation = operation.mutationPreObservation
  errors.push(...validatePersistedArtifactDecision(decision))
  if (options.operationId && operation.operationId !== options.operationId) errors.push('mutation-operation-id-mismatch')
  if (footprint?.schemaVersion !== 'MutationFootprintRecoveryProjectionV2') {
    errors.push('mutation-footprint-recovery-projection-required')
  } else {
    if (footprint.coverage !== 'complete') errors.push('mutation-footprint-coverage-incomplete')
    for (const field of ['footprintDigest', 'adapterDigest', 'plannedSetDigest']) {
      if (!isSha256(footprint[field])) errors.push(`mutation-footprint-${field}-invalid`)
    }
    if (footprint.footprintDigest !== decision?.footprintDigest ||
        footprint.adapterDigest !== decision?.adapterDigest ||
        footprint.plannedSetDigest !== decision?.plannedSetDigest) {
      errors.push('mutation-footprint-decision-mismatch')
    }
  }
  if (preObservation?.schemaVersion !== 'MutationPreObservationV1') {
    errors.push('mutation-pre-observation-required')
  } else {
    const { receiptDigest, ...semantic } = preObservation
    if (!isSha256(receiptDigest) || stableDigest(semantic) !== receiptDigest) errors.push('mutation-pre-observation-digest-invalid')
    if (preObservation.operationId !== operation.operationId ||
        preObservation.footprintDigest !== decision?.footprintDigest ||
        preObservation.plannedSetDigest !== decision?.plannedSetDigest) {
      errors.push('mutation-pre-observation-binding-mismatch')
    }
    if (preObservation.observationCoverage !== 'complete') errors.push('mutation-pre-observation-incomplete')
  }
  const leaseBinding = {
    operationId: operation.operationId,
    project: decision?.project || '',
    taskId: decision?.taskRecoveryKey || '',
    contextEpoch: decision?.contextEpoch || '',
    routeRevision: state.workflowRouteDecision?.routeRevision || '',
    adapterDigest: decision?.adapterDigest || '',
    mergedRegistryDigest: decision?.mergedRegistryDigest || '',
    slotDecisionDigest: decision?.decisionDigest || '',
    plannedSetDigest: decision?.plannedSetDigest || ''
  }
  const leaseValidation = validateTaskOwnedMutationLease(lease, leaseBinding)
  if (!leaseValidation.valid) errors.push(...leaseValidation.errors)
  if (lease?.ownerKind === 'fenced-task-owner') {
    if (state.fencedWriteOwner?.status !== 'active' ||
        state.fencedWriteOwner.leaseDigest !== lease.ownerLeaseDigest ||
        state.fencedWriteOwner.ownerGeneration !== lease.ownerGeneration) {
      errors.push('task-mutation-current-owner-mismatch')
    }
  } else if (lease?.ownerKind === 'simple-task-fast-path') {
    const simpleAuthority = evaluateSimpleTaskFastPathAuthority(
      state,
      footprint,
      options.payload || null,
      {
        phase: options.phase === 'post' ? 'post' : 'pre',
        operationId: operation.operationId
      }
    )
    if (!simpleAuthority.valid || simpleAuthority.lease?.leaseDigest !== lease.ownerLeaseDigest) {
      errors.push('task-mutation-simple-lease-mismatch')
      errors.push(...(simpleAuthority.errors || []))
    }
  } else if (lease?.ownerKind === 'workflow-operational') {
    const operationalAuthority = evaluateWorkflowOperationalWriteAuthority(
      state,
      footprint,
      options.payload || null,
      { phase: options.phase === 'post' ? 'post' : 'pre' }
    )
    if (!operationalAuthority.valid || operationalAuthority.lease?.leaseDigest !== lease.ownerLeaseDigest) {
      errors.push('task-mutation-workflow-operational-lease-mismatch')
      errors.push(...(operationalAuthority.errors || []))
    }
    if (decision?.operationalLeaseDigest && decision.operationalLeaseDigest !== lease.ownerLeaseDigest) {
      errors.push('artifact-decision-workflow-operational-lease-mismatch')
    }
  }
  try {
    const registry = readLayeredArtifactSlotRegistry({
      activeRoot: getActiveNamespaceRoot(state),
      project: decision?.project || state.activeProject
    })
    if (registry.mergedRegistryDigest !== decision?.mergedRegistryDigest ||
        (decision?.baseRegistryDigest !== undefined && registry.baseRegistryDigest !== decision.baseRegistryDigest) ||
        (Object.prototype.hasOwnProperty.call(decision || {}, 'overlayDigest') &&
         registry.overlayDigest !== (decision.overlayDigest ?? null))) {
      errors.push('artifact-registry-drift')
    }
  } catch (error) {
    errors.push(error.code || 'artifact-registry-unavailable')
  }
  const currentActiveRoot = getActiveNamespaceRoot(state)
  const currentProjectRoot = state.stickyProject?.physicalRoot || CONTEXT_ROOT
  if ((decision?.activeRootIdentity?.canonicalPath &&
       !sameResolvedPath(decision.activeRootIdentity.canonicalPath, currentActiveRoot)) ||
      decision?.activeRootIdentity?.digest !== artifactRootIdentityDigest(currentActiveRoot)) {
    errors.push('artifact-active-root-drift')
  }
  if ((decision?.projectRootIdentity?.canonicalPath &&
       !sameResolvedPath(decision.projectRootIdentity.canonicalPath, currentProjectRoot)) ||
      decision?.projectRootIdentity?.digest !== artifactRootIdentityDigest(currentProjectRoot)) {
    errors.push('artifact-project-root-drift')
  }
  if (decision?.contextEpoch !== state.contextAcquisition?.contextEpoch ||
      lease?.routeRevision !== state.workflowRouteDecision?.routeRevision) {
    errors.push('mutation-context-route-drift')
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] }
}

function startAllowedToolRecovery(state, payload, platform, artifactDecision = null, footprint = null) {
  const formalMutation = artifactDecision?.decisionStatus === 'allow'
  const mutating = !isTaskAuthorityControlTool(payload) &&
    (isRecoveryMutation(payload, platform, state) || formalMutation)
  const explicitOperationId = lifecycleToolOperationId(payload)
  const existing = state.turnLiveness?.inFlightOperation
  if (mutating && existing?.mutating === true) {
    const sameOperation = explicitOperationId && existing.operationId === explicitOperationId
    const samePlan = sameOperation &&
      existing.artifactDecision?.targetSetDigest === artifactDecision?.targetSetDigest &&
      existing.artifactDecision?.plannedSetDigest === artifactDecision?.plannedSetDigest &&
      existing.artifactDecision?.mergedRegistryDigest === artifactDecision?.mergedRegistryDigest
    const replayValidation = samePlan
      ? validateMutationAuthorizationBundle(state, existing, { operationId: explicitOperationId })
      : { valid: false, errors: ['mutation-replay-plan-mismatch'] }
    if (replayValidation.valid) return { mutating: true, replay: true }
    throw mutationAuthorizationError(
      sameOperation ? 'MUTATION_REPLAY_AUTHORITY_INVALID' : 'MUTATION_OPERATION_ALREADY_IN_FLIGHT',
      `A different or invalid mutating operation is already in flight: ${replayValidation.errors.join(', ')}`,
      replayValidation.errors
    )
  }
  if (mutating && explicitOperationId && state.turnLiveness?.lastMutationCloseout?.operationId === explicitOperationId) {
    throw mutationAuthorizationError(
      'MUTATION_OPERATION_ALREADY_CLOSED',
      'The one-use mutation operation has already reached closeout.'
    )
  }
  state.turnLiveness = startToolLease(
    state.turnLiveness,
    payload,
    getToolName(payload),
    {
      mutating,
      targetPaths: footprint?.normalizedTargets || extractToolPaths(payload),
      artifactDecision: mutating ? artifactDecision : null
    }
  )
  if (!mutating) return { mutating: false, replay: false }
  if (!artifactDecision || artifactDecision.decisionStatus !== 'allow' || !footprint) {
    throw mutationAuthorizationError(
      'MUTATION_ARTIFACT_AUTHORITY_REQUIRED',
      'A mutating recovery operation requires one allowed ArtifactSlotDecisionV2 and complete footprint.'
    )
  }
  const operationId = state.turnLiveness.inFlightOperation.operationId
  const operationalAuthority = evaluateWorkflowOperationalWriteAuthority(state, footprint, payload, { phase: 'pre' })
  if (artifactDecision.operationalLeaseDigest &&
      (!operationalAuthority.valid || operationalAuthority.lease?.leaseDigest !== artifactDecision.operationalLeaseDigest)) {
    throw mutationAuthorizationError(
      'WORKFLOW_OPERATIONAL_WRITE_LEASE_INVALID',
      `Workflow operational write authority is no longer valid: ${(operationalAuthority.errors || []).join(', ')}`,
      operationalAuthority.errors || []
    )
  }
  const simpleAuthority = operationalAuthority.valid
    ? { valid: false, errors: ['workflow-operational-authority-selected'], lease: null }
    : evaluateSimpleTaskFastPathAuthority(state, footprint, payload, { phase: 'pre' })
  const simpleLease = simpleAuthority.valid ? simpleAuthority.lease : null
  const mutationLease = createTaskOwnedMutationLease({
    operationId,
    project: artifactDecision.project,
    taskId: artifactDecision.taskRecoveryKey || '',
    owner: (simpleLease || operationalAuthority.valid) ? null : state.fencedWriteOwner,
    simpleTaskLeaseDigest: simpleLease?.leaseDigest || null,
    workflowOperationalLeaseDigest: operationalAuthority.valid ? operationalAuthority.lease.leaseDigest : null,
    contextEpoch: artifactDecision.contextEpoch,
    routeRevision: state.workflowRouteDecision?.routeRevision,
    decision: artifactDecision
  })
  const preObservation = createMutationPreObservation({ operationId, footprint })
  if (preObservation.observationCoverage !== 'complete') {
    throw mutationAuthorizationError(
      'MUTATION_PRE_OBSERVATION_INCOMPLETE',
      'Mutation pre-observation could not cover the complete planned effect set.',
      preObservation.errorCodes
    )
  }
  const recoveryFootprint = projectMutationFootprintForRecovery(footprint)
  state.turnLiveness.inFlightOperation.mutationLease = mutationLease
  state.turnLiveness.inFlightOperation.mutationFootprint = recoveryFootprint
  state.turnLiveness.inFlightOperation.mutationPreObservation = preObservation
  const validation = validateMutationAuthorizationBundle(state, state.turnLiveness.inFlightOperation, { operationId })
  if (!validation.valid) {
    throw mutationAuthorizationError(
      'MUTATION_AUTHORITY_BUNDLE_INVALID',
      `Mutation authority bundle is invalid: ${validation.errors.join(', ')}`,
      validation.errors
    )
  }
  return { mutating: true, replay: false }
}

function saveAllowedToolState(state, payload, platform, artifactDecision, footprint, contextMilestone = false) {
  let recovery = { mutating: false, replay: false }
  try {
    recovery = startAllowedToolRecovery(state, payload, platform, artifactDecision, footprint)
    if (!recovery.replay) {
      saveState(state, preToolRecoverySaveOptions(recovery.mutating, contextMilestone))
    }
    return { ok: true, ...recovery }
  } catch (error) {
    state.lastReason = error.code || 'LIFECYCLE_MUTATION_PREFLIGHT_FAILED'
    return { ok: false, ...recovery, error }
  }
}

function preToolRecoverySaveOptions(mutating, contextMilestone = false) {
  if (mutating) return { reason: 'mutation-preflight', force: true, touchSessionMapping: true }
  if (contextMilestone) return { reason: 'context-attempt', force: true, touchSessionMapping: true }
  return {}
}

const {
  hasVisibleReplyPayload,
  updateVisibleReplyState,
  captureFinalPayloadSample,
  getPrecheckEvidenceStatus,
  buildClosureReminder,
  buildDedupedClosureReminder
} = buildLifecycleVisibleReplyUtils({
  fs,
  getStatePaths,
  getVisibleReplyEvidence,
  collectInterestingStrings,
  buildGovernanceIntakeReminderItem
})

function evaluateCurrentProgressiveSkillRoute (state, payload, platform, trigger, contextPost = null) {
  if (!state.contextAcquisition?.contextEpoch) return null
  if (!state.contextAcquisition?.targetResolved || !state.contextAcquisition?.project) {
    const pending = state.progressiveSkillRoute?.pending
    if (!pending || pending.schemaVersion !== 'SkillRoutePendingEnvelopeV1') return null
    const routeStop = {
      schemaVersion: 'ProgressiveSkillRouteStopV1',
      present: true,
      complete: false,
      processComplete: false,
      businessSatisfied: true,
      contextEpoch: pending.contextEpoch,
      turnBinding: null,
      planDigest: null,
      pendingStageIds: ['target-resolution'],
      errorCode: 'CONTEXT_TARGET_UNRESOLVED',
      nextOp: 'resolve_context_target',
      nextCall: pending.nextCall,
      recovery: {
        schemaVersion: 'SkillRouteTargetResolutionRecoveryV1',
        automatic: false,
        action: 'call-profile-context-plan-for-one-real-project'
      }
    }
    const coordination = reconcileProgressiveSkillRoute(state, routeStop, {
      trigger,
      payload,
      contextPost,
      sessionKey: pending.hostSessionId || getPayloadSessionKey(payload),
      requireBusiness: trigger === 'Stop',
      consumerIdentity: state.progressiveSkillRoute?.modeReceipt?.processRuntimeIdentity || null
    })
    state.progressiveSkillRouteStop = coordination.routeStop || routeStop
    return coordination
  }
  const {
    evaluateProgressiveSkillRouteStop,
    shouldEnforceProgressiveSkillRouteStop
  } = require('./skill-route-tool.cjs')
  const routeStop = evaluateProgressiveSkillRouteStop({
    project: state.contextAcquisition.project,
    contextEpoch: state.contextAcquisition.contextEpoch,
    hostSessionId: state.contextAcquisition.hostSessionId,
    assistantText: getVisibleReplyText(payload) || ''
  }, {
    inputRoot: CONTEXT_ROOT,
    env: process.env
  })
  const explicitRoutePending =
    state.progressiveSkillRoute?.bootstrap?.explicitStatus === 'ready'
  const enforce = shouldEnforceProgressiveSkillRouteStop(
    routeStop,
    explicitRoutePending,
    trigger
  )
  const effectiveRouteStop = (enforce || routeStop?.retired === true)
    ? routeStop
    : {
        ...routeStop,
        processComplete: true,
        businessSatisfied: true,
        complete: true
      }
  const coordination = reconcileProgressiveSkillRoute(state, effectiveRouteStop, {
    trigger,
    payload,
    contextPost,
    sessionKey: state.contextAcquisition.hostSessionId || getPayloadSessionKey(payload),
    requireBusiness: trigger === 'Stop',
    consumerIdentity: state.progressiveSkillRoute?.modeReceipt?.processRuntimeIdentity || null
  })
  state.progressiveSkillRouteStop = coordination.routeStop || effectiveRouteStop
  return coordination
}

function observeProgressiveSkillRouteEnforcement (state, platform, eventName) {
  const decision = resolveProgressiveSkillRouteEnforcement({
    hostVariant: state.progressiveSkillRoute?.modeReceipt?.hostVariant || platform,
    eventName
  })
  const prior = state.progressiveSkillRouteEnforcement &&
    typeof state.progressiveSkillRouteEnforcement === 'object'
    ? state.progressiveSkillRouteEnforcement
    : {}
  state.progressiveSkillRouteEnforcement = {
    schemaVersion: 'ProgressiveSkillRouteEnforcementStateV1',
    decisions: {
      ...(prior.decisions || {}),
      [eventName]: decision
    },
    lastDecision: decision,
    observedAt: new Date().toISOString()
  }
  return decision
}

function progressiveSkillRouteOutputMeta (coordination, nextStep) {
  const envelope = coordination.envelope || {}
  return {
    devcodexAction: INTERCEPTION_ACTION.REQUIRE_COMPLETION,
    devcodexCode: 'progressive-skill-route',
    devcodexEffective: true,
    devcodexHookRunId: envelope.hookRunId,
    devcodexStateFingerprint: envelope.stateFingerprint,
    devcodexNextAction: envelope,
    devcodexNextStep: nextStep
  }
}

function buildProgressiveSkillRouteContextOutput (eventName, coordination, prefixContext = '') {
  const recoveryCard = formatProgressiveSkillRouteRecoveryCard(coordination)
  const message = [String(prefixContext || '').trim(), recoveryCard].filter(Boolean).join('\n\n')
  return contextMessageOutput(
    eventName,
    message,
    progressiveSkillRouteOutputMeta(coordination, recoveryCard)
  )
}

function buildProgressiveSkillRouteBlockOutput (state, platform, eventName, coordination, enforcement = null) {
  const reason = formatProgressiveSkillRouteRecoveryCard(coordination)
  const decision = enforcement || observeProgressiveSkillRouteEnforcement(state, platform, eventName)
  const meta = {
    ...progressiveSkillRouteOutputMeta(coordination, reason),
    devcodexEffective: decision.hardEnforcement,
    devcodexProgressiveSkillRouteEnforcement: decision
  }
  if (decision.hardEnforcement && eventSupportsHardBlock(platform, eventName)) {
    recordInterception(
      state,
      eventName,
      platform,
      INTERCEPTION_ACTION.REQUIRE_COMPLETION,
      'progressive-skill-route',
      reason,
      reason,
      true
    )
    return decorateHookOutput(
      blockOutput(platform, eventName, 'progressive-skill-route', reason),
      meta
    )
  }
  return decorateHookOutput(warningOutput(
    'Progressive Skill route reconciliation advisory',
    reason,
    eventName
  ), meta)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const raw = await readStdin()
  const payload = safeJsonParse(raw)

  if (payload === null) {
    process.stderr.write('DevCodex hook: invalid JSON input\n')
    process.exit(1)
  }

  const eventName = getEventName(payload)
  const platform = detectPlatform(payload)
  const prompt = eventName === 'UserPromptSubmit' ? extractUserPrompt(payload) : ''
  const continuationCommand = eventName === 'UserPromptSubmit'
    ? parseContinuationCommand(prompt)
    : null
  const detectedProjectCandidate = eventName === 'UserPromptSubmit'
    ? detectProjectCandidate(prompt, payload)
    : { project: '', source: '' }
  const continuationProjectQualifier = continuationCommand
    ? resolveContinuationProjectQualifier(continuationCommand, detectedProjectCandidate)
    : {
        projectCandidate: detectedProjectCandidate,
        explicitProject: detectedProjectCandidate.project,
        explicitProjectSource: detectedProjectCandidate.source,
        error: null
      }
  const projectCandidate = continuationProjectQualifier.projectCandidate
  const eventSessionKey = getPayloadSessionKey(payload)
  let state = loadState(undefined, eventSessionKey, null, {
    userIngress: eventName === 'UserPromptSubmit'
  })
  const promptTarget = eventName === 'UserPromptSubmit'
    ? resolvePromptTarget(state, payload, prompt, projectCandidate)
    : null
  if (eventName === 'UserPromptSubmit') {
    state = loadState(
      readModeForPromptTarget(state, promptTarget),
      eventSessionKey,
      null,
      { userIngress: true }
    )
  }
  const continuationIngress = eventName === 'UserPromptSubmit'
    ? resolveContinuationAtIngress(
        continuationCommand,
        state,
        payload,
        promptTarget,
        continuationProjectQualifier
      )
    : { command: null, resolution: null, recoveryHint: null, targetDecision: null }
  let continuationResolution = continuationIngress.resolution
  if (continuationIngress.recoveryHint) {
    const recoveredProject = String(continuationIngress.recoveryHint.project || '').trim()
    const workspaceTask = recoveredProject === 'workspace'
    state = loadState(
      readModeForPromptTarget(state, {
        activeProject: workspaceTask ? '' : recoveredProject,
        activeScope: workspaceTask ? 'workspace' : 'project'
      }),
      eventSessionKey,
      continuationIngress.recoveryHint,
      { userIngress: true }
    )
  }
  const currentHostIdentity = buildHostIdentityV2(platform, {
    env: process.env,
    payload,
    eventName,
    sessionId: payload.session_id || payload.sessionId,
    trustedHostEvent: Boolean(eventName),
    directReplay: false,
    policyEnabled: isStrictEnforcement()
  })
  state.hostIdentity = currentHostIdentity
  const priorActualInstructionEnvelope = state.actualInstructionEnvelope || null
  const priorWorkflowRouteDecision = state.workflowResumeTargetDecision || state.workflowRouteDecision || null
  const priorActiveProject = String(state.activeProject || '').trim()
  const mode = state.mode

  updateVisibleReplyState(state, payload, eventName)
  if (eventName === 'PreCompact' || eventName === 'Stop') {
    updateGovernanceIntakeResolutionState(state, getVisibleReplyText(payload), eventName, {
      activeRoot: getActiveNamespaceRoot(state),
      contextRoot: CONTEXT_ROOT
    })
  }
  let livenessObservation = null
  const livenessEventName = eventName || (getToolName(payload) ? 'PreToolUse' : '')
  if (livenessEventName && livenessEventName !== 'UserPromptSubmit') {
    livenessObservation = observeTurnEvent(state.turnLiveness, livenessEventName, payload)
    state.turnLiveness = livenessObservation.state
  }
  state.workflowCompletionLifecycle = observeWorkflowCompletionEvent(state.workflowCompletionLifecycle, eventName, payload, { host: platform })
  state.lastEvent = eventName || state.lastEvent

  // ── UserPromptSubmit ───────────────────────────────────────────────────────
  if (eventName === 'UserPromptSubmit') {
    if (payload.devcodex_host_continuation === true) {
      state.lastReason = 'host-route-continuation'
      saveState(state)
      writeStdout(noopOutput())
      return
    }
    if (payload.devcodex_host_transform_only === true &&
        state.contextAcquisition?.contextEpoch) {
      let progressiveSkillRouteMsg = ''
      try {
        const {
          formatSkillRouteBootstrapInjection
        } = require('./skill-route-tool.cjs')
        if (state.progressiveSkillRoute?.bootstrap) {
          progressiveSkillRouteMsg = formatSkillRouteBootstrapInjection(
            state.progressiveSkillRoute.bootstrap
          )
        }
      } catch {}
      state.lastReason = 'copilot-transform-projection'
      saveState(state)
      writeStdout(contextMessageOutput(
        'UserPromptSubmit',
        [
          buildBootstrapMessage(state),
          buildExecutionModeContextMessage(state),
          buildGovernanceIntakeContextMessage(state.governanceIntake),
          progressiveSkillRouteMsg
        ].filter(Boolean).join('\n\n')
      ))
      return
    }
    const workflowCompletionLifecycle = state.workflowCompletionLifecycle
    const priorLanguageContext = state.languageContext
    state = resetState(mode, state)
    state.hostIdentity = currentHostIdentity
    state.workflowCompletionLifecycle = workflowCompletionLifecycle
    state.languageContext = resolveLanguageContext({
      prompt,
      carrier: priorLanguageContext,
      locale: process.env.LC_ALL || process.env.LANG || process.env.LANGUAGE || ''
    })
    livenessObservation = observeTurnEvent(state.turnLiveness, eventName, payload)
    state.turnLiveness = livenessObservation.state
    applyPromptTarget(state, promptTarget, payload)
    if (continuationCommand) {
      const resolvedProject = continuationResolution?.candidate?.project || ''
      if (resolvedProject) {
        const workspaceTask = resolvedProject === 'workspace'
        state.activeProject = workspaceTask ? '' : resolvedProject
        state.activeScope = workspaceTask ? 'workspace' : 'project'
        state.activeProjectSource = 'task-continuation'
        if (!workspaceTask) setStickyProject(state, resolvedProject, 'task-continuation', payload)
        state.mode = readModeForPromptTarget(state, {
          activeProject: workspaceTask ? '' : resolvedProject,
          activeScope: workspaceTask ? 'workspace' : 'project'
        })
      }
      state.taskContinuation = {
        schemaVersion: 'TaskContinuationHookEvidenceV1',
        command: continuationCommand,
        status: continuationResolution.status,
        errorCode: continuationResolution.errorCode || null,
        targetDecision: continuationIngress.targetDecision ? {
          status: continuationIngress.targetDecision.status,
          project: continuationIngress.targetDecision.project || null,
          scope: continuationIngress.targetDecision.scope || null,
          source: continuationIngress.targetDecision.source || null,
          errorCode: continuationIngress.targetDecision.errorCode || null,
          authorityCeiling: continuationIngress.targetDecision.authorityCeiling || null,
          mutationAuthority: false
        } : null,
        candidate: continuationResolution.candidate ? {
          taskId: continuationResolution.candidate.taskId,
          displayName: continuationResolution.candidate.displayName,
          project: continuationResolution.candidate.project,
          kind: continuationResolution.candidate.kind,
          status: continuationResolution.candidate.status
        } : null,
        indexState: continuationResolution.index?.state || null,
        observedAt: new Date().toISOString(),
        capabilityBoundary: {
          payloadExecution: false,
          taskStatusMutation: false,
          cpMutation: false,
          processWakeup: false
        }
      }
      if (continuationResolution.status === 'resolved-active') {
        bindTaskRecoveryState(state, continuationResolution.candidate)
      }
    }
    beginContextAcquisition(state, payload, platform)
    initializeWorkflowIngress(
      state,
      payload,
      platform,
      prompt,
      projectCandidate,
      priorActualInstructionEnvelope,
      continuationCommand,
      priorWorkflowRouteDecision
    )
    renewProjectTargetLeaseForCurrentRoute(state, payload, state.activeProjectSource || 'user-message')
    const routeWriteTrigger = continuationResolution?.status === 'resolved-active'
      ? 'task-bind'
      : (state.activeProject && priorActiveProject && priorActiveProject !== state.activeProject
          ? 'project-switch'
          : 'user-message')
    writeWorkspaceSessionRouteHint(state, payload, routeWriteTrigger)
    state.governanceIntake = registerGovernanceIntakeCandidate(state.governanceIntake, prompt)
    state.executionMode = detectExecutionMode(payload, state, promptTarget)
    observeValidationControlIngress(state, prompt)
    confirmDangerousApprovalsFromPrompt(state, prompt, eventName, platform)
    if (continuationResolution && continuationResolution.status !== 'resolved-active') {
      const candidates = continuationResolution.candidates || continuationResolution.suggestions || []
      const candidateText = candidates.slice(0, 5).map(candidate => `${candidate.project}/${candidate.kind}/${candidate.displayName}`).join(', ')
      const detail = [
        `Task continuation status=${continuationResolution.status}.`,
        continuationResolution.message || '',
        candidateText ? `Candidates: ${candidateText}.` : ''
      ].filter(Boolean).join(' ')
      state.lastReason = `task-continuation-${continuationResolution.status}`
      const output = buildInterceptionOutput(
        state,
        platform,
        eventName,
        INTERCEPTION_ACTION.REQUIRE_COMPLETION,
        `task-continuation-${continuationResolution.status}`,
        `task-continuation-${continuationResolution.status}`,
        detail,
        continuationResolution.nextStep || 'Specify the exact active task and retry.'
      )
      saveState(state)
      writeStdout(output)
      return
    }
    // Multi-project workspace guard (v1.9.8+):
    // when no workspace-root profile exists and ≥2 sibling projects detected,
    // require the user to specify the target project explicitly.
    const hasWorkspaceProfile = fs.existsSync(getWorkspaceProfileConfigPath())
    if (!hasWorkspaceProfile && isMultiProjectWorkspace()) {
      if (!hasMultiProjectExemption(prompt) && !state.activeProject) {
        if (!shouldSuppressMultiProjectWarning(state, payload)) {
          state.lastReason = 'multi-project-workspace-block'
          const detail = isStrictEnforcement()
            ? buildMultiProjectBlockMessage()
            : `${buildMultiProjectBlockMessage()} Prompt allowed in safety-only mode.`
          const output = buildInterceptionOutput(
            state, platform, eventName, INTERCEPTION_ACTION.REQUIRE_COMPLETION, 'multi-project-workspace',
            'multi-project-workspace', detail, 'Specify the target project or use a workspace-level exemption keyword.'
          )
          saveState(state)
          writeStdout(output)
          return
        }
      }
    }
    // The progressive route is the only catalog/body owner after B4 cutover.
    let progressiveSkillRouteMsg = ''
    let progressiveSkillRouteMode = 'unified'
    try {
      const { bootstrapSkillRouteForTurn } = require('./skill-route-tool.cjs')
      if (!state.contextAcquisition?.targetResolved) {
        const { parseExplicitSkillId } = require('./skill-route-state.cjs')
        const requestedSkillId = parseExplicitSkillId(prompt)
        const pendingHostVariant = state.hostIdentity?.hostVariant || normalizeHostVariant(platform, {
          env: process.env,
          sessionId: payload.session_id || payload.sessionId
        })
        const pending = {
          schemaVersion: 'SkillRoutePendingEnvelopeV1',
          contextEpoch: state.contextAcquisition?.contextEpoch,
          hostSessionId: state.contextAcquisition?.hostSessionId || getPayloadSessionKey(payload),
          promptDigest: crypto.createHash('sha256').update(prompt).digest('hex'),
          createdAt: new Date().toISOString(),
          targetResolved: false,
          explicitStatus: requestedSkillId ? 'pending-target' : 'none',
          explicitSkillId: requestedSkillId,
          nextOp: 'resolve_context_target',
          nextCall: {
            op: 'profile_context_plan',
            contextEpoch: state.contextAcquisition?.contextEpoch,
            project: '<one-real-project>',
            host: pendingHostVariant,
            ...(requestedSkillId ? { explicitSkillId: requestedSkillId } : {})
          }
        }
        progressiveSkillRouteMsg = [
          '### DevCodex · SkillRouteBootstrapPendingV1',
          JSON.stringify(pending),
          '',
          'Resolve one real project with `profile_context_plan` using this contextEpoch and the exact nextCall host; when `explicitSkillId` is present in nextCall, pass it unchanged. After the observed plan binds the active-root, the lifecycle will inject the project-bound SkillRouteBootstrapV1.',
          'Do not call `skill_route` with the workspace directory name and do not create a synthetic project namespace.'
        ].join('\n')
        state.progressiveSkillRoute = {
          schemaVersion: 'LifecycleSkillRouteStateV1',
          modeReceipt: null,
          bootstrap: null,
          pending,
          active: false,
          errorCode: null
        }
      } else {
        const route = bootstrapSkillRouteForTurn({
          project: state.contextAcquisition?.project,
          contextEpoch: state.contextAcquisition?.contextEpoch,
          prompt,
          host: platform,
          cwd: CONTEXT_ROOT
        }, {
          inputRoot: CONTEXT_ROOT,
          env: process.env,
          sessionId: payload.session_id || payload.sessionId,
          hostAdapterDigest: getLifecycleHostAdapterDigest(platform, {
            env: process.env,
            sessionId: payload.session_id || payload.sessionId
          })
        })
        progressiveSkillRouteMode = route.modeReceipt?.effective || 'unified'
        progressiveSkillRouteMsg = route.injectionText || ''
        state.progressiveSkillRoute = {
          schemaVersion: 'LifecycleSkillRouteStateV1',
          modeReceipt: route.modeReceipt,
          bootstrap: route.bootstrap,
          active: route.active === true,
          errorCode: null
        }
      }
    } catch (error) {
      state.progressiveSkillRoute = {
        schemaVersion: 'LifecycleSkillRouteStateV1',
        modeReceipt: null,
        bootstrap: null,
        active: false,
        errorCode: String(error.code || error.message || 'SKILL_ROUTE_BOOTSTRAP_FAILED')
      }
      progressiveSkillRouteMsg = [
        '### DevCodex · SkillRouteBootstrapErrorV1',
        `errorCode: ${state.progressiveSkillRoute.errorCode}`,
        'Do not fall back to legacy WorkspaceSkillIntent or preload a skill body. Continue without a free-route skill and report the routing error.'
      ].join('\n')
    }

    state.workspaceSkillAutoMatch = null

    saveState(state)
    writeStdout(contextMessageOutput(
      'UserPromptSubmit',
      [
        buildBootstrapMessage(state),
        buildExecutionModeContextMessage(state),
        formatLanguageContextInstruction(state.languageContext),
        continuationResolution
          ? `TaskResolutionV1 resolved-active: ${continuationResolution.candidate.project}/${continuationResolution.candidate.kind}/${continuationResolution.candidate.displayName}. The name only locates the task; rehydrate identity, sessions, and current bound artifacts before continuing.`
          : '',
        buildGovernanceIntakeContextMessage(state.governanceIntake),
        formatTurnRecoveryMessage(livenessObservation.recoveryCard),
        buildWorkflowIngressContextMessage(state),
        progressiveSkillRouteMsg
      ].filter(Boolean).join('\n\n')
    ))
    return
  }

  // ── PreToolUse ─────────────────────────────────────────────────────────────
  const isToolUse = eventName === 'PreToolUse' || (!eventName && getToolName(payload))

  if (isToolUse) {
    state.toolUseCount += 1
    maybeBindTaskRecoveryForPayload(state, payload, platform)

    // 1. Dangerous command guard
    const danger = checkDangerousCommand(payload, platform)
    if (danger) {
      const approval = consumeDangerousApproval(state, danger)
      if (approval.approved) {
        recordInterception(
          state, eventName, platform, INTERCEPTION_ACTION.LOG_ONLY, 'dangerous-command-approved',
          danger.reason, `One-time approval ${approval.approvalId} consumed.`, true
        )
      } else {
        const approvalId = danger.neverApprove ? '' : createDangerousApproval(state, danger)
        const detail = danger.neverApprove
          ? `${danger.reason} — 该命令属于不可放行危险操作，请改用安全替代方案（S06）。`
          : `${danger.reason} — 请先输出命令预览并等待用户明确确认（S06）。确认后可在同一 cwd、10 分钟内以 devcodex-approve:${approvalId} 重试同一命令。`
        const output = buildInterceptionOutput(
          state, platform, eventName, INTERCEPTION_ACTION.FORBID, 'dangerous-command',
          danger.reason, detail, danger.neverApprove ? 'Use a safe alternative command.' : `Get explicit user approval, then retry with devcodex-approve:${approvalId}.`
        )
        saveState(state)
        writeStdout(output)
        return
      }
      saveState(state)
    }

    // Active reconciliation runs before ordinary work. Exact route/context
    // recovery calls remain allowed; unrelated tools cannot defer a known
    // stage obligation until Stop.
    try {
      const routeCoordination = evaluateCurrentProgressiveSkillRoute(
        state,
        payload,
        platform,
        'PreToolUse'
      )
      if (routeCoordination?.required && !routeCoordination.allowAction) {
        const enforcement = observeProgressiveSkillRouteEnforcement(state, platform, 'PreToolUse')
        state.lastReason = enforcement.reasonCode
        if (enforcement.hardEnforcement) {
          const output = buildProgressiveSkillRouteBlockOutput(
            state,
            platform,
            eventName,
            routeCoordination,
            enforcement
          )
          saveState(state)
          writeStdout(output)
          return
        }
      }
    } catch (error) {
      state.progressiveSkillRouteCoordinatorError = String(
        error.code || error.message || 'SKILL_ROUTE_COORDINATOR_FAILED'
      )
    }

    // 2. Context acquisition: PreToolUse records an attempt only. A compatible
    // action reuses the current plan; a broader/unknown action makes it stale.
    // Fallback warnings are carried forward so Auto/CP/permission gates still run.
    const taskAuthorityControl = isTaskAuthorityControlTool(payload)
    const contextPre = taskAuthorityControl
      ? {
          acquisition: state.contextAcquisition,
          classified: { allowed: true, kind: 'task-authority-control' },
          actionClass: 'control'
        }
      : recordContextPreToolUse(state, payload, platform)
    const contextDecision = getContextAcquisitionDecision(state, contextPre)
    let contextGateOutput = null
    if (!['complete', 'allowed-read'].includes(contextDecision.status)) {
      if (contextDecision.hardBlockEligible && isStrictEnforcement()) {
        state.lastReason = 'context-acquisition-incomplete'
        const output = buildBootstrapDenyOutput(state, payload, eventName, platform)
        saveState(state)
        writeStdout(output)
        return
      }
      contextGateOutput = buildDedupedBootstrapWarningOutput(state, payload, eventName, platform)
    }

    // 2.1 Workflow ingress is a fail-closed prerequisite for every write-like
    // operation. Read-only context acquisition remains available so callers can
    // obtain or repair the structured route plan.
    const workflowMutationCandidate = !taskAuthorityControl &&
      (isWriteLikeToolName(getToolName(payload)) || isMutatingTool(payload, platform))
    if (workflowMutationCandidate &&
        (state.actualInstructionEnvelope?.instructionAuthority !== true || !state.workflowRouteDecision)) {
      const errorCode = state.actualInstructionEnvelope?.instructionAuthority !== true
        ? 'INSTRUCTION_AUTHORITY_UNAVAILABLE'
        : 'WORKFLOW_ROUTE_UNRESOLVED'
      const detail = errorCode === 'INSTRUCTION_AUTHORITY_UNAVAILABLE'
        ? 'No verified actual user-instruction segment is available; attachment, quoted-document and ambient evidence cannot authorize writes.'
        : `No fresh registry-bound workflow route is available (${state.workflowRoutePending?.reasonCode || state.workflowIngressError?.errorCode || 'context-plan-required'}).`
      state.lastReason = errorCode
      saveState(state)
      writeStdout(buildInterceptionOutput(
        state,
        platform,
        eventName,
        INTERCEPTION_ACTION.FORBID,
        errorCode,
        'Workflow ingress authority unavailable',
        detail,
        'Use read-only ContextRead recovery to obtain one exact route, or provide a verified actual instruction, then retry the write.'
      ))
      return
    }
    if (workflowMutationCandidate && state.activeProject) {
      const projectLease = validateStickyProjectLease(state, payload)
      const routeHint = state.workspaceSessionRouteHint || null
      const routeEntry = routeHint?.entry || null
      const routeReady = ['fresh', 'persisted', 'semantic-noop'].includes(String(routeHint?.status || '')) &&
        routeEntry?.state === 'live' &&
        routeEntry.projectRootIdentityDigest === state.stickyProject?.rootIdentityDigest &&
        routeEntry.routeRevision === state.workflowRouteDecision?.routeRevision
      if (!projectLease.valid || !routeReady) {
        const errorCode = !projectLease.valid
          ? `PROJECT_TARGET_LEASE_${String(projectLease.reason || 'INVALID').toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
          : (routeHint?.errorCode || 'WORKSPACE_SESSION_ROUTE_BINDING_UNAVAILABLE')
        state.lastReason = errorCode
        saveState(state)
        writeStdout(buildInterceptionOutput(
          state,
          platform,
          eventName,
          INTERCEPTION_ACTION.FORBID,
          errorCode,
          'Project/session route authority unavailable',
          'The exact ProjectTargetLeaseV2 and workspace session route binding must agree on session/turn, project root, context, and route revision before mutation.',
          'Re-run the read-only context plan for this session and exact project, then retry the mutation.'
        ))
        return
      }
    }

    // 2.25 Formal artifact authority — exact observable target set, canonical slot,
    // active-root containment and a durable V5 prewrite are mandatory before mutation.
    const artifactAuthorization = prepareArtifactMutationDecision(state, payload, platform)
    const mutationAdapterDecision = artifactAuthorization.adapterDecision
    const artifactDecision = artifactAuthorization.decision
    const artifactFootprint = artifactAuthorization.footprint
    const workflowOperationalAuthority = artifactAuthorization.operationalAuthority
    const simpleTaskFastPathAuthority = artifactAuthorization.simpleAuthority
    const footprintBlock = mutationFootprintBlock(
      state,
      payload,
      platform,
      mutationAdapterDecision,
      artifactFootprint
    )
    if (footprintBlock) {
      state.lastReason = footprintBlock.code
      saveState(state)
      writeStdout(buildInterceptionOutput(
        state, platform, eventName, INTERCEPTION_ACTION.FORBID,
        footprintBlock.code,
        'Mutation target observation unavailable',
        `HostToolMutationAdapterDecisionV1/MutationFootprintV2 could not prove one complete target set: ${footprintBlock.errors.join(', ')}`,
        'Use a supported direct writer, or provide an adapter-specific effect manifest/controlled target root before retrying.'
      ))
      return
    }
    const priorMutationCloseout = state.turnLiveness?.lastMutationCloseout
    const pendingReconcile = priorMutationCloseout?.result === 'needs-reconcile' ||
      priorMutationCloseout?.observation?.reconcileRequired === true ||
      priorMutationCloseout?.artifactCloseout?.decisionStatus === 'needs-reconcile'
    if (pendingReconcile && artifactDecision && artifactDecision.decisionStatus !== 'not-applicable') {
      state.lastReason = 'ARTIFACT_RECONCILIATION_REQUIRED'
      saveState(state)
      writeStdout(buildInterceptionOutput(
        state, platform, eventName, INTERCEPTION_ACTION.FORBID,
        'ARTIFACT_RECONCILIATION_REQUIRED',
        'Formal artifact mutation requires reconciliation',
        'The prior formal artifact operation did not reach a verified terminal state. New formal mutation is blocked.',
        'Reconcile the recorded actual effects, then retry with a new ArtifactSlotDecisionV2 and one-use mutation lease.'
      ))
      return
    }
    const artifactBlock = artifactDecisionBlock(artifactDecision)
    if (artifactBlock) {
      state.lastReason = artifactBlock.code
      saveState(state)
      writeStdout(buildInterceptionOutput(
        state, platform, eventName, INTERCEPTION_ACTION.FORBID,
        artifactBlock.code,
        'Formal artifact mutation denied',
        `ArtifactSlotDecisionV2 rejected the exact mutation target set: ${artifactBlock.errors.join(', ')}`,
        'Use the canonical task slot and an observable exact target set inside the active project root.'
      ))
      return
    }

    const formalMutation = !isTaskAuthorityControlTool(payload) && (
      isRecoveryMutation(payload, platform, state) || artifactDecision?.decisionStatus === 'allow'
    )
    if (formalMutation && workflowOperationalAuthority?.valid !== true && simpleTaskFastPathAuthority?.valid !== true) {
      const ownerAuthority = evaluateFencedTaskMutationAuthority(state)
      state.fencedTaskWriteOwnerAuthority = {
        schemaVersion: 'FencedTaskWriteOwnerAuthorityObservationV1',
        ...ownerAuthority,
        observedAt: new Date().toISOString(),
        mutationAuthority: ownerAuthority.valid === true
      }
      if (!ownerAuthority.valid) {
        state.lastReason = ownerAuthority.errorCode
        writeStdout(buildInterceptionOutput(
          state,
          platform,
          eventName,
          INTERCEPTION_ACTION.FORBID,
          ownerAuthority.errorCode,
          'Fenced task write owner authority unavailable',
          `Formal mutation requires the exact active V2 owner and finalized admission; failed checks: ${(ownerAuthority.failed || [ownerAuthority.observedStatus || 'owner']).join(', ')}.`,
          ownerAuthority.errorCode === 'TASK_WRITE_OWNER_CP_CONFIRMATION_REQUIRED'
            ? 'Renew the exact owner through memory_task_write_owner after CP1 confirmation, then retry the mutation.'
            : 'For an eligible change, acquire memory_task_fast_path_lease for at most two exact low-risk paths; otherwise admit/adopt the exact task and acquire its fenced owner.'
        ))
        return
      }
    }

    // 2.5 ArtifactPathGate — requirements/02|04 slot semantics (always hard when invalid)
    if (isSourceCodeMutation(payload, platform, state) || isProductArtifactMutation(payload, platform)) {
      const toolPaths = extractToolPaths(payload)
      const art = classifyPathsForArtifacts(toolPaths)
      if (!art.ok) {
        state.lastReason = art.code || 'ARTIFACT_PATH_INVALID'
        saveState(state)
        writeStdout(buildInterceptionOutput(
          state, platform, eventName, INTERCEPTION_ACTION.REQUIRE_COMPLETION, art.code || 'ARTIFACT_PATH_INVALID',
          `Artifact path denied: ${art.code}`,
          art.message || 'Illegal requirements artifact path.',
          'Place analysis reports under reports/analysis/…; reserve 02- for technical design.'
        ))
        return
      }
    }

    // 2.7 E: implement-start gate — control-plane mutation needs 04+05+复审清单 triad
    // (P0-1 / ESC-01: yes-implement must not skip CP3 materialization)
    if (
      isSourceCodeMutation(payload, platform, state) &&
      simpleTaskFastPathAuthority?.valid !== true
    ) {
      const toolPaths = extractToolPaths(payload)
      const hitsProtected = toolPaths.some(p => isStrictProtectedPath(p))
      if (hitsProtected) {
        const bindingResolution = resolveSessionBoundTask(state)
        const bound = bindingResolution.status === 'fresh' ? bindingResolution.task : null
        // Fail-closed when no bound task: was the loophole for skip-process after promising 概况/方案
        const taskRoot = bound && bound.fullPath ? bound.fullPath : null
        const startGate = classifyImplementStartGate({
          controlPlaneMutation: true,
          taskRoot,
          fs,
          activeRoot: getActiveNamespaceRoot(state),
          project: state.activeProject || CONTEXT_PROJECT || path.basename(getActiveNamespaceRoot(state))
        })
        if (!startGate.ok) {
          const code = startGate.code || PROCESS_ENFORCEMENT_CODES.IMPLEMENT_START_WITHOUT_PROCESS
          state.lastReason = code
          saveState(state)
          let detail
          let next
          if (code === PROCESS_ENFORCEMENT_CODES.IMPLEMENT_START_WITHOUT_TASK_BINDING || startGate.unbound) {
            detail = '控制面 mutation 必须绑定 active 需求/bug 任务目录（禁止无任务包直接改 hooks/scripts/instructions）。'
            next = 'Create or resume a requirements/<name>/ package (00/01/02 + 04/05/checklist), bind the task, then retry the edit.'
          } else if (code === PROCESS_ENFORCEMENT_CODES.IMPLEMENT_START_WITHOUT_DESIGN) {
            detail = `控制面 mutation 前须有概况/确认与 canonical 02 方案产物（缺: ${(startGate.missing || []).join(', ')}）${bound ? `：${bound.name || bound.fullPath}` : ''}`
            next = 'Write 00/01 plus the task-kind canonical 02 design (02-技术方案.md or 02-修复方案.md), then 04/05/checklist, then mutate control-plane files.'
          } else {
            detail = `控制面 mutation 前须在任务目录齐备 04-实施计划.md + 05-实施进度.md + 复审清单（缺: ${(startGate.missing || []).join(', ')}）：${bound ? (bound.name || bound.fullPath) : ''}`
            next = 'Create 04-实施计划.md, 05-实施进度.md, and 03-复审清单*.md under the active requirement before mutating hooks/skills/instructions.'
          }
          writeStdout(buildInterceptionOutput(
            state, platform, eventName, INTERCEPTION_ACTION.FORBID,
            code,
            'Implement process gate required',
            detail,
            next
          ))
          return
        }
      }
    }

    // 3. CP gate — block source code mutations until checkpoints confirmed
    //    PF-process-enforcement: hard-deny for strict-protected paths even under safety-only (D1)
    //    Non-protected paths: legacy safety-only warning + Honesty cp2-unconfirmed-write
    const gate = checkCpGate(payload, state)
    if (gate && isSourceCodeMutation(payload, platform, state) && simpleTaskFastPathAuthority?.valid !== true) {
      const toolPaths = extractToolPaths(payload)
      const hard = shouldHardDenyCpMutation(gate, toolPaths, { strictEnv: isStrictEnforcement() })
      // Missing/ambiguous task authority is an identity failure, not a CP
      // completeness warning, and must fail closed even in safety-only mode.
      const useHardDeny = gate.code === 'cp-gate-task-binding-required' || hard.hardDeny === true
      state.lastReason = `cp-gate-${gate.phase}${useHardDeny ? '-hard' : '-warn'}`
      if (!useHardDeny && (gate.phase === 'CP2' || gate.code === 'cp-gate-orphan-control-plane')) {
        const honesty = state.enforcementHonesty && typeof state.enforcementHonesty === 'object'
          ? { ...state.enforcementHonesty }
          : {}
        const gaps = Array.isArray(honesty.processGaps) ? honesty.processGaps.slice() : []
        if (!gaps.includes('cp2-unconfirmed-write')) gaps.push('cp2-unconfirmed-write')
        honesty.processGaps = gaps
        honesty.thisTurn = {
          ...(honesty.thisTurn || {}),
          preToolHardDeny: false,
          preToolSafetyOnlyAllow: true,
          cpGatePhase: gate.phase
        }
        state.enforcementHonesty = honesty
      }
      if (useHardDeny) {
        const honesty = state.enforcementHonesty && typeof state.enforcementHonesty === 'object'
          ? { ...state.enforcementHonesty }
          : {}
        honesty.thisTurn = {
          ...(honesty.thisTurn || {}),
          preToolHardDeny: true,
          preToolSafetyOnlyAllow: false,
          cpGatePhase: gate.phase,
          processEnforcementReason: hard.reason
        }
        state.enforcementHonesty = honesty
      }
      if (useHardDeny) {
        saveState(state)
      } else {
        updateArtifactTouches(state, payload, platform)
        const persisted = saveAllowedToolState(state, payload, platform, artifactDecision, artifactFootprint)
        if (!persisted.ok) {
          writeStdout(buildInterceptionOutput(
            state, platform, eventName, INTERCEPTION_ACTION.FORBID,
            persisted.error.code || 'LIFECYCLE_MUTATION_PREFLIGHT_FAILED',
            'Mutation preflight persistence failed',
            persisted.error.message,
            'Repair TaskRecoveryStoreV5 capacity/state and retry; no host mutation was authorized.'
          ))
          return
        }
      }
      writeStdout(useHardDeny
        ? buildCpDenyOutput(state, platform, eventName, gate, getToolName(payload) || 'tool')
        : buildCpWarningOutput(state, platform, eventName, gate, getToolName(payload) || 'tool'))
      return
    }

    // 3.5 S07 product-artifact order (VL-004): reports/memory/ledgers vs first user-visible PC
    // Note: tool-loop hosts rarely have verified-present precheck mid-turn; late is expected if products write first.
    if (isProductArtifactMutation(payload, platform)) {
      markProductMutationOrder(state, payload, platform)
      const precheckStatus = getPrecheckEvidenceStatus(state)
      if (precheckStatus !== 'verified-present') {
        const reason = 's07-product-before-entry-check'
        const detailZh = 'S07 时序：产物 mutation（reports/.memory/台账）须在用户首次可见 PC0~PC7 之后；禁止最终文首补 PC 冒充先输出。'
        const detailEn = 'S07 order: product artifact writes require first user-visible PC0-PC7 before reports/memory/ledger mutations.'
        if (isStrictEnforcement()) {
          state.lastReason = reason
          saveState(state)
          writeStdout(buildInterceptionOutput(
            state, platform, eventName, INTERCEPTION_ACTION.REQUIRE_COMPLETION, reason,
            reason, detailZh, detailEn
          ))
          return
        }
        if (!state.s07ProductWarnEmitted) {
          state.s07ProductWarnEmitted = true
          state.lastReason = `${reason}-warn`
          updateArtifactTouches(state, payload, platform)
          const persisted = saveAllowedToolState(state, payload, platform, artifactDecision, artifactFootprint)
          if (!persisted.ok) {
            writeStdout(buildInterceptionOutput(
              state, platform, eventName, INTERCEPTION_ACTION.FORBID,
              persisted.error.code || 'LIFECYCLE_MUTATION_PREFLIGHT_FAILED',
              'Mutation preflight persistence failed',
              persisted.error.message,
              'Repair TaskRecoveryStoreV5 capacity/state and retry; no host mutation was authorized.'
            ))
            return
          }
          writeStdout(buildInterceptionOutput(
            state, platform, eventName, INTERCEPTION_ACTION.REQUIRE_COMPLETION, reason,
            reason,
            `${detailZh} Tool allowed in safety-only mode.`,
            `${detailEn} Tool allowed in safety-only mode.`
          ))
          return
        }
      }
    }

    // 4. Auto path policy is a final execution boundary, never a source of
    // task, owner, CP or mutation authority.  It is evaluated only after the
    // formal workflow gates above so an allowlisted path cannot skip process.
    const autoWhitelist = simpleTaskFastPathAuthority?.valid === true
      ? null
      : checkAutoWhitelist(payload, platform, state)
    if (autoWhitelist && !autoWhitelist.allowed) {
      const autoBoundaryOutput = buildInterceptionOutput(
        state, platform, eventName, INTERCEPTION_ACTION.REQUIRE_COMPLETION, 'auto-whitelist-boundary',
        'auto-whitelist-boundary',
        isStrictEnforcement()
          ? `${autoWhitelist.reason} — 请切回确认模式，或先把变更范围收敛到白名单路径。`
          : `${autoWhitelist.reason} Tool allowed in safety-only mode after formal workflow authorization.`,
        'Switch back to confirm mode or keep the mutation within the auto whitelist.'
      )
      state.lastReason = isStrictEnforcement()
        ? 'auto-non-whitelist-block'
        : 'auto-non-whitelist-warning'
      if (isStrictEnforcement()) {
        saveState(state)
        writeStdout(autoBoundaryOutput)
        return
      }
      if (contextGateOutput?.systemMessage && autoBoundaryOutput?.systemMessage) {
        contextGateOutput = {
          ...contextGateOutput,
          ...autoBoundaryOutput,
          systemMessage: `${contextGateOutput.systemMessage}\n${autoBoundaryOutput.systemMessage}`
        }
      } else {
        contextGateOutput = autoBoundaryOutput
      }
    } else if (autoWhitelist?.allowed) {
      state.lastReason = 'auto-whitelist-authorized'
    }

    updateArtifactTouches(state, payload, platform)
    const persisted = saveAllowedToolState(
      state,
      payload,
      platform,
      artifactDecision,
      artifactFootprint,
      contextPre?.classified?.allowed === true
    )
    if (!persisted.ok) {
      writeStdout(buildInterceptionOutput(
        state, platform, eventName, INTERCEPTION_ACTION.FORBID,
        persisted.error.code || 'LIFECYCLE_MUTATION_PREFLIGHT_FAILED',
        'Mutation preflight persistence failed',
        persisted.error.message,
        'Repair TaskRecoveryStoreV5 capacity/state and retry; no host mutation was authorized.'
      ))
      return
    }
    writeStdout(contextGateOutput || noopOutput())
    return
  }

  // ── PostToolUse ────────────────────────────────────────────────────────────
  if (eventName === 'PostToolUse') {
    maybeBindTaskRecoveryForPayload(state, payload, platform)
    const contextDeliveryObservation = observeContextDeliveryFromPayload(state, payload)
    const completingMutationOperation = state.turnLiveness?.inFlightOperation?.mutating === true
      ? JSON.parse(JSON.stringify(state.turnLiveness.inFlightOperation))
      : null
    const mutationCloseout = completingMutationOperation?.mutating === true
    const artifactDecision = completingMutationOperation?.artifactDecision || null
    const pendingSkillRoute = state.progressiveSkillRoute?.pending || null
    const taskAuthorityControl = isTaskAuthorityControlTool(payload)
    const contextPost = taskAuthorityControl
      ? { observed: false, ignored: true }
      : recordContextPostToolUse(state, payload)
    const observedContextKind = contextPost?.attempt?.kind || ''
    const routeBinding = ['plan', 'plan-refresh'].includes(observedContextKind)
      ? bindWorkflowRouteFromObservedPlan(state)
      : { ok: true, decision: state.workflowRouteDecision }
    const observedWorkflowOperationalLease = observeWorkflowOperationalWriteLease(state, payload)
    const observedSimpleTaskFastPathLease = observeSimpleTaskFastPathLease(state, payload)
    let postSaveOptions = mutationCloseout
      ? { reason: 'mutation-closeout', force: true, touchSessionMapping: true }
      : (observedWorkflowOperationalLease
          ? { reason: 'workflow-operational-lease', force: true, touchSessionMapping: true }
      : (observedSimpleTaskFastPathLease
          ? { reason: 'simple-task-fast-path-lease', force: true, touchSessionMapping: true }
      : (contextPost?.attempt || contextDeliveryObservation.status === 'observed'
          ? { reason: 'context-observation', force: true, touchSessionMapping: true }
          : {})))
    if (!taskAuthorityControl) markContextPostMutationStale(state, payload, platform)
    observeGovernanceLedgerWrite(state, payload, {
      activeRoot: getActiveNamespaceRoot(state),
      contextRoot: CONTEXT_ROOT,
      eventName,
      toolName: getToolName(payload)
    })
    if (!taskAuthorityControl) {
      markProductMutationOrder(state, payload, platform)
      updateArtifactTouches(state, payload, platform)
    }
    state.turnLiveness = completeToolLease(state.turnLiveness, payload)
    const workflowTaskTerminalReceipt = observeWorkflowTaskTerminalReceipt(state, payload)
    if (workflowTaskTerminalReceipt) {
      state.workflowTaskTerminalReceipt = workflowTaskTerminalReceipt
      state.turnLiveness = applyWorkflowTaskTerminalReceipt(state.turnLiveness, workflowTaskTerminalReceipt)
      state.taskRecoveryBinding = null
      const terminalRouteReceipt = writeWorkspaceSessionRouteHint(state, payload, 'terminal-unbind', {
        taskId: '',
        lastTerminalReceiptDigest: workflowTaskTerminalReceipt.receiptDigest
      })
      if (['blocked', 'invalid', 'closeout-continued'].includes(terminalRouteReceipt.status) &&
          terminalRouteReceipt.liveBindingRemoved !== true) {
        state.lastReason = terminalRouteReceipt.errorCode || 'WORKSPACE_SESSION_ROUTE_TERMINAL_UNBIND_FAILED'
      }
      postSaveOptions = { reason: 'workflow-task-terminal-observation', force: true, touchSessionMapping: true }
    }
    let artifactNeedsReconcile = false
    if (artifactDecision && completingMutationOperation) {
      const toolFailed = payload.success === false || payload.is_error === true || payload.isError === true || !!payload.error
      const postOperationId = lifecycleToolOperationId(payload)
      const authorizationErrors = []
      if (postOperationId && postOperationId !== completingMutationOperation.operationId) {
        authorizationErrors.push('mutation-post-operation-id-mismatch')
      }
      if (completingMutationOperation.mutationLease?.ownerKind === 'fenced-task-owner') {
        const ownerAuthority = evaluateFencedTaskMutationAuthority(state)
        if (!ownerAuthority.valid) {
          authorizationErrors.push(ownerAuthority.errorCode || 'task-mutation-current-owner-unavailable')
          authorizationErrors.push(...(ownerAuthority.failed || []))
        }
      }
      const bundleValidation = validateMutationAuthorizationBundle(
        state,
        completingMutationOperation,
        { operationId: completingMutationOperation.operationId, phase: 'post', payload }
      )
      if (!bundleValidation.valid) authorizationErrors.push(...bundleValidation.errors)
      let mutationObservation
      try {
        mutationObservation = observeMutationEffects({
          operationId: completingMutationOperation.operationId,
          decision: artifactDecision,
          lease: completingMutationOperation.mutationLease,
          footprint: completingMutationOperation.mutationFootprint,
          preObservation: completingMutationOperation.mutationPreObservation,
          payload,
          success: !toolFailed && authorizationErrors.length === 0
        })
        const observationValidation = validateMutationObservationReceipt(mutationObservation)
        if (!observationValidation.valid) authorizationErrors.push(...observationValidation.errors)
      } catch (error) {
        authorizationErrors.push(error.code || 'mutation-observation-failed')
        const completedAt = new Date().toISOString()
        const observationSemantic = {
          schemaVersion: 'MutationObservationReceiptV1',
          operationId: completingMutationOperation.operationId,
          decisionDigest: artifactDecision.decisionDigest || null,
          leaseDigest: completingMutationOperation.mutationLease?.leaseDigest || null,
          plannedSetDigest: completingMutationOperation.mutationFootprint?.plannedSetDigest || null,
          observedEffects: { created: [], modified: [], deleted: [], moved: [] },
          observationCoverage: 'unavailable',
          nativeExitCode: null,
          drift: [...new Set(authorizationErrors)].sort(),
          reconcileRequired: true,
          status: 'needs-reconcile',
          completedAt
        }
        const receiptDigest = stableDigest(observationSemantic)
        const closeoutSemantic = {
          schemaVersion: 'ArtifactMutationCloseoutReceiptV2',
          operationId: observationSemantic.operationId,
          decisionDigest: observationSemantic.decisionDigest,
          leaseDigest: observationSemantic.leaseDigest,
          observationReceiptDigest: receiptDigest,
          decisionStatus: 'needs-reconcile',
          reconcileRequired: true,
          completedAt
        }
        mutationObservation = {
          ...observationSemantic,
          receiptDigest,
          decisionStatus: 'needs-reconcile',
          closeout: { ...closeoutSemantic, closeoutDigest: stableDigest(closeoutSemantic) }
        }
      }
      const observationValid = validateMutationObservationReceipt(mutationObservation).valid
      let needsReconcile = mutationObservation.reconcileRequired === true ||
        !observationValid || authorizationErrors.length > 0
      if (completingMutationOperation.mutationLease?.ownerKind === 'simple-task-fast-path') {
        let simpleUsage = null
        try {
          simpleUsage = consumeSimpleTaskFastPathUsage(state.simpleTaskFastPathUsage, {
            lease: state.simpleTaskFastPathLease,
            operationId: completingMutationOperation.operationId,
            observedTargetSetDigest: artifactDecision.targetSetDigest,
            completedAt: mutationObservation.completedAt,
            needsReconcile
          })
          state.simpleTaskFastPathUsage = simpleUsage
        } catch (error) {
          authorizationErrors.push(error.code || 'simple-task-usage-closeout-failed')
          needsReconcile = true
        }
        if (!simpleUsage || simpleUsage.status !== 'active') {
          const closeoutSemantic = {
            schemaVersion: 'SimpleTaskFastPathLeaseCloseoutV1',
            leaseDigest: completingMutationOperation.mutationLease.ownerLeaseDigest,
            operationId: completingMutationOperation.operationId,
            useCount: Number(simpleUsage?.useCount ?? state.simpleTaskFastPathUsage?.useCount) || 0,
            status: needsReconcile ? 'needs-reconcile' : 'consumed',
            completedAt: mutationObservation.completedAt,
            usageDigest: simpleUsage?.usageDigest || state.simpleTaskFastPathUsage?.usageDigest || null,
            receiptDigest: mutationObservation.receiptDigest
          }
          state.simpleTaskFastPathLeaseCloseout = {
            ...closeoutSemantic,
            closeoutDigest: stableDigest(closeoutSemantic)
          }
          state.simpleTaskFastPathLease = null
          state.simpleTaskFastPathUsage = null
        }
      }
      state.turnLiveness.lastMutationCloseout = {
        schemaVersion: 'LifecycleMutationCloseoutV2',
        operationId: completingMutationOperation.operationId,
        toolName: completingMutationOperation.toolName,
        completedAt: mutationObservation.completedAt,
        result: needsReconcile ? 'needs-reconcile' : 'success',
        authorizationErrors: [...new Set(authorizationErrors)].sort(),
        observation: mutationObservation,
        artifactCloseout: mutationObservation.closeout
      }
      if (needsReconcile) {
        artifactNeedsReconcile = true
        state.lastReason = 'ARTIFACT_MUTATION_NEEDS_RECONCILE'
      }
      if (completingMutationOperation.mutationLease?.ownerKind === 'workflow-operational') {
        state.workflowOperationalWriteLeaseCloseout = {
          schemaVersion: 'WorkflowOperationalWriteLeaseCloseoutV1',
          leaseDigest: completingMutationOperation.mutationLease.ownerLeaseDigest,
          operationId: completingMutationOperation.operationId,
          status: needsReconcile ? 'needs-reconcile' : 'consumed',
          completedAt: mutationObservation.completedAt,
          receiptDigest: mutationObservation.receiptDigest
        }
        state.workflowOperationalWriteLease = null
      }
    } else if (mutationCloseout) {
      artifactNeedsReconcile = true
      state.lastReason = 'ARTIFACT_MUTATION_AUTHORITY_LOST'
      state.turnLiveness.lastMutationCloseout = {
        schemaVersion: 'LifecycleMutationCloseoutV2',
        operationId: completingMutationOperation?.operationId || lifecycleToolOperationId(payload),
        completedAt: new Date().toISOString(),
        result: 'needs-reconcile',
        authorizationErrors: ['mutation-authority-bundle-missing'],
        observation: null,
        artifactCloseout: null
      }
    }
    if (['plan', 'plan-refresh'].includes(observedContextKind) && !routeBinding.ok) {
      state.lastReason = routeBinding.error.code || 'WORKFLOW_ROUTE_DECISION_FAILED'
      saveState(state, postSaveOptions)
      writeStdout(contextMessageOutput('PostToolUse', buildWorkflowIngressContextMessage(state)))
      return
    }
    if (['plan', 'plan-refresh'].includes(observedContextKind) && routeBinding.ok) {
      const projectLease = renewProjectTargetLeaseForCurrentRoute(state, payload, 'workflow-route-bind')
      const routeReceipt = projectLease?.valid
        ? writeWorkspaceSessionRouteHint(state, payload, 'admission-bind')
        : {
            schemaVersion: 'WorkspaceSessionRouteIndexReceiptV1',
            status: 'blocked',
            authority: false,
            hintOnly: true,
            errorCode: `PROJECT_TARGET_LEASE_${String(projectLease?.reason || 'UNAVAILABLE').toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
          }
      state.workspaceSessionRouteHint = routeReceipt
      if (['blocked', 'invalid'].includes(routeReceipt.status)) {
        state.lastReason = routeReceipt.errorCode || 'WORKSPACE_SESSION_ROUTE_BIND_FAILED'
      }
    }
    if (contextPost?.targetRebound) {
      try {
        const contextPlanInput = payload.tool_input || payload.toolInput || {}
        const contextPlanHost = String(contextPlanInput.host || '').trim().toLowerCase()
        const hostIdentityOptions = {
          env: process.env,
          sessionId: payload.session_id || payload.sessionId
        }
        const {
          getLifecycleHostAdapterDigest,
          normalizeHostVariant
        } = require('./host-adapter-identity.cjs')
        const expectedHostVariant = normalizeHostVariant(platform, hostIdentityOptions)
        if (contextPlanHost && normalizeHostVariant(contextPlanHost, hostIdentityOptions) !== expectedHostVariant) {
          const mismatch = new Error('CONTEXT_PLAN_HOST_MISMATCH')
          mismatch.code = 'CONTEXT_PLAN_HOST_MISMATCH'
          throw mismatch
        }
        const { bootstrapSkillRouteForTurn } = require('./skill-route-tool.cjs')
        const route = bootstrapSkillRouteForTurn({
          project: state.contextAcquisition.project,
          contextEpoch: state.contextAcquisition.contextEpoch,
          explicitSkillId: pendingSkillRoute?.explicitSkillId ||
            String(contextPlanInput.explicitSkillId || '').trim() || null,
          host: contextPlanHost || expectedHostVariant,
          cwd: CONTEXT_ROOT
        }, {
          inputRoot: CONTEXT_ROOT,
          env: process.env,
          sessionId: payload.session_id || payload.sessionId,
          hostAdapterDigest: getLifecycleHostAdapterDigest(
            contextPlanHost || expectedHostVariant,
            hostIdentityOptions
          )
        })
        state.progressiveSkillRoute = {
          schemaVersion: 'LifecycleSkillRouteStateV1',
          modeReceipt: route.modeReceipt,
          bootstrap: route.bootstrap,
          active: route.active === true,
          errorCode: null
        }
        saveState(state, postSaveOptions)
        const bootstrapAlreadyDelivered = hasMatchingSkillRouteBootstrapDelivery(payload, route.bootstrap)
        writeStdout(contextMessageOutput(
          'PostToolUse',
          [
            buildWorkflowIngressContextMessage(state),
            bootstrapAlreadyDelivered ? '' : (route.injectionText || '')
          ].filter(Boolean).join('\n\n')
        ))
        return
      } catch (error) {
        state.progressiveSkillRoute = {
          schemaVersion: 'LifecycleSkillRouteStateV1',
          modeReceipt: null,
          bootstrap: null,
          active: false,
          errorCode: String(error.code || error.message || 'SKILL_ROUTE_BOOTSTRAP_FAILED')
        }
      }
    }
    try {
      const routeCoordination = evaluateCurrentProgressiveSkillRoute(
        state,
        payload,
        platform,
        'PostToolUse',
        contextPost
      )
      const observedKind = observedContextKind
      if (routeCoordination?.required && [
        'route-control',
        'plan',
        'plan-refresh',
        'profile-load',
        'memory-query'
      ].includes(observedKind)) {
        state.lastReason = 'progressive-skill-route-next-action'
        saveState(state, postSaveOptions)
        const ingressContext = ['plan', 'plan-refresh'].includes(observedKind) && routeBinding.ok
          ? buildWorkflowIngressContextMessage(state)
          : ''
        writeStdout(buildProgressiveSkillRouteContextOutput('PostToolUse', routeCoordination, ingressContext))
        return
      }
    } catch (error) {
      state.progressiveSkillRouteCoordinatorError = String(
        error.code || error.message || 'SKILL_ROUTE_COORDINATOR_FAILED'
      )
    }
    try {
      saveState(state, postSaveOptions)
    } catch (error) {
      if (!mutationCloseout) throw error
      state.lastReason = error.code || 'LIFECYCLE_MUTATION_CLOSEOUT_FAILED'
      writeStdout(buildInterceptionOutput(
        state, platform, eventName, INTERCEPTION_ACTION.REQUIRE_COMPLETION,
        state.lastReason,
        'Mutation closeout persistence requires reconciliation',
        error.message,
        'Use the TaskRecoveryStoreV5 emergency closeout receipt to reconcile this operation before any new mutation.'
      ))
      return
    }
    const routeBoundIngressContext = ['plan', 'plan-refresh'].includes(observedContextKind) && routeBinding.ok
      ? buildWorkflowIngressContextMessage(state)
      : ''
    writeStdout(artifactNeedsReconcile
      ? buildInterceptionOutput(
          state, platform, eventName, INTERCEPTION_ACTION.REQUIRE_COMPLETION,
          'ARTIFACT_MUTATION_NEEDS_RECONCILE',
          'Formal artifact mutation needs reconciliation',
          `PostToolUse could not verify the complete planned/actual effect set: ${[
            ...(state.turnLiveness.lastMutationCloseout?.authorizationErrors || []),
            ...(state.turnLiveness.lastMutationCloseout?.observation?.drift || [])
          ].join(', ')}`,
          'Reconcile the exact observed effects and owner/route bindings before any further formal artifact mutation.'
        )
      : (routeBoundIngressContext
          ? contextMessageOutput('PostToolUse', routeBoundIngressContext)
          : noopOutput()))
    return
  }

  // ── PreCompact / Stop ──────────────────────────────────────────────────────
  if (eventName === 'PreCompact' || eventName === 'Stop') {
    const taskRecoveryBindingFresh = refreshTaskRecoveryBinding(state)
    if (eventName === 'PreCompact') state.contextDeliveryReceipts = []
    const terminalSaveOptions = {
      reason: eventName === 'Stop' ? 'terminal-stop' : 'pre-compact',
      force: true,
      touchSessionMapping: true
    }
    if (eventName === 'PreCompact') markContextAcquisitionStale(state, 'compact')
    captureFinalPayloadSample(payload, eventName, state)
    const stopHookActive = eventName === 'Stop' &&
      !!(payload.stopHookActive || payload.stop_hook_active)
    let stopRouteCoordination = null
    let stopRouteEnforcement = null

    if (state.contextAcquisition?.contextEpoch && !stopHookActive) {
      try {
        const routeCoordination = evaluateCurrentProgressiveSkillRoute(
          state,
          payload,
          platform,
          eventName
        )
        stopRouteCoordination = routeCoordination
        if (routeCoordination?.required) {
          if (eventName === 'PreCompact') {
            state.lastReason = 'progressive-skill-route'
            saveState(state, terminalSaveOptions)
            writeStdout(buildProgressiveSkillRouteContextOutput('PreCompact', routeCoordination))
            return
          }
          stopRouteEnforcement = observeProgressiveSkillRouteEnforcement(state, platform, 'Stop')
          state.lastReason = stopRouteEnforcement.reasonCode
        }
      } catch (error) {
        state.progressiveSkillRouteCoordinatorError = String(
          error.code || error.message || 'SKILL_ROUTE_COORDINATOR_FAILED'
        )
      }
    }

    const reminder = buildDedupedClosureReminder(state, eventName)
    let output = reminder ? systemMessageOutput(reminder) : noopOutput()
    if (reminder) {
      output = buildInterceptionOutput(
        state, platform, eventName, INTERCEPTION_ACTION.REQUIRE_COMPLETION, 'closure-incomplete',
        'DevCodex closure incomplete', reminder,
        eventName === 'Stop'
          ? 'Complete the missing entry/compliance/artifact/memory/report items before ending.'
          : 'Persist missing state before compacting.'
      )
    }
    if (eventName === 'Stop') {
      // B2: evaluateStopCompletionGate — Grok always hard-blocks when supported; others keep strict-only hard path
      const lastAssistantMessage =
        extractLastAssistantMessage(payload) ||
        getVisibleReplyText(payload) ||
        ''
      const continuationCount = Number(state.stopContinuationCount || 0)
      const gateResult = evaluateStopCompletionGate({
        mode: state.mode || '',
        workflow: state.workflowRouteDecision?.topIntent || state.workflow || '',
        mutated: !!state.mutated,
        reportTouched: !!state.reportTouched,
        memoryTouched: !!state.memoryTouched,
        lastAssistantMessage,
        stopHookActive,
        continuationCount,
        softCap: 8,
        taskRoot: taskRecoveryBindingFresh ? state.taskRecoveryBinding?.taskRoot || null : null,
        taskBindingVerified: taskRecoveryBindingFresh,
        state
      })
      const hardEvents = ['pretooluse', 'stop'].filter(ev => eventSupportsHardBlock(platform, ev))
      const priorHonesty = state.enforcementHonesty && typeof state.enforcementHonesty === 'object'
        ? state.enforcementHonesty
        : {}
      state.enforcementHonesty = {
        ...priorHonesty,
        ...gateResult.honesty,
        host: platform,
        hardBlockEventsEnabled: hardEvents,
        processGaps: [
          ...new Set([
            ...(priorHonesty.processGaps || []),
            ...(gateResult.gaps || []),
            ...((gateResult.honesty && gateResult.honesty.processGaps) || [])
          ])
        ],
        evidenceMode: platform === 'grok' ? 'path-observable+stop-conditional' : 'host-native'
      }

      if (gateResult.decision === 'block') {
        const forceHard = platform === 'grok' || isStrictEnforcement()
        if (forceHard && eventSupportsHardBlock(platform, eventName)) {
          state.stopContinuationCount = continuationCount + 1
          output = decorateHookOutput(
            blockOutput(platform, eventName, gateResult.reason, gateResult.reason),
            {
              devcodexAction: INTERCEPTION_ACTION.REQUIRE_COMPLETION,
              devcodexCode: 'stop-completion-gate',
              devcodexEffective: true,
              devcodexNextStep: 'Complete missing entry/PR-1/FVS/report/memory then finish.',
              devcodexProcessGaps: (gateResult.gaps || []).join(',')
            }
          )
          recordInterception(
            state,
            eventName,
            platform,
            INTERCEPTION_ACTION.REQUIRE_COMPLETION,
            'stop-completion-gate',
            gateResult.reason,
            'Complete missing items then finish.',
            true
          )
        } else if (!reminder) {
          output = buildInterceptionOutput(
            state,
            platform,
            eventName,
            INTERCEPTION_ACTION.REQUIRE_COMPLETION,
            'stop-completion-gate',
            'DevCodex Stop gate incomplete',
            gateResult.reason,
            'Complete missing items then finish.'
          )
        }
      }

      if (stopRouteCoordination?.required && stopRouteEnforcement?.hardEnforcement) {
        output = buildProgressiveSkillRouteBlockOutput(
          state,
          platform,
          eventName,
          stopRouteCoordination,
          stopRouteEnforcement
        )
      }

      const failed = payload.success === false || payload.is_error === true || payload.isError === true || !!payload.error
      state.turnLiveness = markTurnTerminal(
        state.turnLiveness,
        failed ? 'error' : 'completed',
        failed ? 'stop-event-error' : 'stop-event-completed'
      )
    }
    saveState(state, terminalSaveOptions)
    writeStdout(output)
    return
  }

  saveState(state)
  writeStdout(noopOutput())
}

main().catch(err => {
  process.stderr.write(`DevCodex hook error: ${err.message}\n`)
  process.exit(1)
})
