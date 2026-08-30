#!/usr/bin/env node
'use strict'

/**
 * DevCodex MCP Profile Server — user-global stdio process (deployed under a host runtime; workspace owns only .devcodex state)
 *
 * Implements MCP 2024-11-05 protocol over stdin/stdout (JSON-RPC 2.0).
 *
 * Tools:
 *   profile_context_plan — Build an intent-scoped Profile read plan without pre-reading selected documents
 *   profile_load     — Read whole Profile files or explicitly selected whole Markdown sections
 *   profile_skill_plan — Build a dependency-closed, whole-SKILL read plan
 *   profile_get_mode — Return ENV_MODE (dev/prod) and resolved runtime agent
 *   skill_route      — Serve the bounded progressive Skill routing protocol
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { assertSingleSegment, resolveInside } = require('./path-guard')
const { createJsonLineServer } = require('./stdio-jsonrpc.cjs')
const {
  PROFILE_BASE_FILES,
  PROFILE_RELEASE_FILES,
  buildBundleDecisionV2,
  detectProfileTier,
  filesForProfileTier,
  parseMarkdownTables
} = require('./profile-contract')
const {
  selectProfileSectionsFromFileSync
} = require('./profile-section-selector.cjs')
const { readBoundedTextFileSync } = require('./bounded-text-reader.cjs')
const {
  CONTEXT_READ_CONTRACT,
  buildContextReadError,
  buildContextReadPlan,
  normalizeIntentSeed,
  stableDigest,
  validateContextReadPlan
} = require('../hooks/_runtime/context-read-contract.cjs')
const STATIC_WORKFLOW_ROUTE_REGISTRY_V2 = require('../hooks/_runtime/workflow-root-registry.v2.json')
const {
  resolveWorkflowRouteDescriptor
} = require('../hooks/_runtime/workflow-route-decision-v2.cjs')
const { buildContentIdentity, buildJsonContentIdentity, validateContentIdentity } = require('../hooks/_runtime/content-identity.cjs')
const { createRuntimeStateStore } = require('../hooks/_runtime/runtime-state-store.cjs')
const {
  persistContextPlanObservation
} = require('../hooks/_runtime/context-plan-observation.cjs')
const {
  authorizeContextRead,
  recordMcpContextSourceObservations
} = require('../hooks/_runtime/context-source-observation.cjs')
const { getContextDeliveryDecision } = require('../hooks/_runtime/context-delivery-ledger-v2.cjs')
const { resolveTaskRecoveryMetaDir } = require('../hooks/_runtime/task-recovery-store-v5.cjs')
const { resolveExecutionFeatureDecisionForCwd } = require('../hooks/_runtime/execution-optimization-routing.cjs')
const { resolveGlobalSkillRuntimeRoot } = require('../hooks/_runtime/global-skill-runtime-root.cjs')
const {
  bootstrapSkillRouteForTurn,
  formatSkillRouteBootstrapInjection,
  handleSkillRoute
} = require('../hooks/_runtime/skill-route-tool.cjs')
const {
  deriveTurnBinding,
  loadEnvelope
} = require('../hooks/_runtime/skill-route-state.cjs')
const { getBootRuntimeContractDigest } = require('../hooks/_runtime/skill-route-mode.cjs')
const {
  getLifecycleHostAdapterDigest
} = require('../hooks/_runtime/host-adapter-identity.cjs')
const {
  captureRuntimeProcessIdentity,
  readRuntimeGenerationStatus
} = require('../hooks/_runtime/runtime-generation-identity.cjs')
const { resolveLanguageContext } = require('../hooks/_runtime/language-context.cjs')
const { buildWorkflowPlanDecision } = require('../hooks/_runtime/workflow-plan-decision-v1.cjs')
const {
  createEntryCheckModelV3,
  resolveVisibleLocale
} = require('../hooks/_runtime/visible-output-contract.cjs')
const {
  findLayoutInfo,
  namespaceRootPath,
  normalizeExecutionOptimizationMode,
  PROJECT_NAMESPACE_SCHEMA_PATTERN,
  normalizeProjectNamespace,
  resolveHostWorkspaceBinding,
  resolveLegacyProjectRoot,
  resolveRuntimeStateRoot
} = require('../hooks/_runtime/workspace-layout.cjs')

const INPUT_ROOT = process.argv[2]
  ? path.resolve(process.argv[2])
  : process.cwd()

const PROFILE_PROCESS_IDENTITY = captureRuntimeProcessIdentity({
  role: 'profile-mcp',
  runtimeRoot: path.resolve(__dirname, '..'),
  bootRuntimeContractDigest: getBootRuntimeContractDigest()
})
const PROFILE_INIT_BOOTSTRAP_AUTHORITY = Symbol('devcodex-init-profile-bootstrap')
const WORKSPACE_CONTEXT_PROJECT = '__workspace__'
const SKILL_ROUTE_TRACE_MAX_BYTES = 256 * 1024
const SKILL_ROUTE_TRACE_RECORD_MAX_BYTES = 16 * 1024

function traceSkillRouteCall(args, result) {
  const configured = String(process.env.DEVCODEX_SKILL_ROUTE_TRACE || '').trim()
  if (!configured) return
  const target = path.resolve(configured)
  const relative = path.relative(INPUT_ROOT, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return
  const lockPath = `${target}.lock`
  let descriptor
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    descriptor = fs.openSync(lockPath, 'wx')
    const response = {
      ok: result?.ok === true,
      op: result?.op || args?.op || null,
      errorCode: result?.errorCode || null,
      receiptSchema: result?.receipt?.schemaVersion || null,
      serializedBytes: result?.delivery?.serializedBytes || null
    }
    const requestJson = JSON.stringify(args || {})
    let record = {
      schemaVersion: 'SkillRouteCallTraceV1',
      observedAt: new Date().toISOString(),
      request: args,
      response
    }
    let line = `${JSON.stringify(record)}\n`
    if (Buffer.byteLength(line, 'utf8') > SKILL_ROUTE_TRACE_RECORD_MAX_BYTES) {
      record = {
        schemaVersion: 'SkillRouteCallTraceV1',
        observedAt: record.observedAt,
        compacted: true,
        requestBytes: Buffer.byteLength(requestJson, 'utf8'),
        requestDigest: crypto.createHash('sha256').update(requestJson).digest('hex'),
        requestOp: String(args?.op || '').slice(0, 64),
        response
      }
      line = `${JSON.stringify(record)}\n`
    }
    const lineBytes = Buffer.byteLength(line, 'utf8')
    if (lineBytes > SKILL_ROUTE_TRACE_RECORD_MAX_BYTES) return
    const currentBytes = fs.existsSync(target) ? fs.statSync(target).size : 0
    if (currentBytes + lineBytes > SKILL_ROUTE_TRACE_MAX_BYTES) return
    fs.appendFileSync(target, line, 'utf8')
  } catch {
    // Diagnostics must never alter Tool behavior.
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor) } catch {}
      try { fs.unlinkSync(lockPath) } catch {}
    }
  }
}

// ─── Server metadata ──────────────────────────────────────────────────────────

const SERVER_INFO = {
  name: 'devcodex-profile',
  version: '1.0.0'
}

const {
  VALID_AGENTS,
  normalizeAgent,
  detectRuntimeAgent
} = require('./agent-identity.cjs')

// Prefer DEVCODEX_AGENT; otherwise infer host env (incl. grok). Never default to claude-code.
const DEFAULT_AGENT = detectRuntimeAgent()

const EXECUTION_OPTIMIZATION_BINDING_SCHEMA = {
  type: 'object',
  required: ['schemaVersion', 'requested', 'mode', 'status', 'errorCode', 'configIdentity', 'bindingDigest'],
  description: 'Copy the exact ExecutionOptimizationPlanBindingV1 returned by the plan.'
}

const CONTEXT_READ_BINDING_SCHEMA = {
  type: 'object',
  required: ['schemaVersion', 'contextEpoch', 'planId', 'planContentId', 'activeRoot', 'project'],
  properties: {
    schemaVersion: { const: 'ContextReadBindingV1' },
    contextEpoch: { type: 'string', minLength: 1, maxLength: 256 },
    planId: { type: 'string', minLength: 1, maxLength: 256 },
    planContentId: { type: 'string', minLength: 1, maxLength: 256 },
    activeRoot: { type: 'string', minLength: 1, maxLength: 4096 },
    project: {
      type: 'string',
      minLength: 1,
      maxLength: 255,
      pattern: PROJECT_NAMESPACE_SCHEMA_PATTERN
    }
  },
  additionalProperties: false
}

const SKILL_ROUTE_VALUE_SCHEMA_BY_FIELD = Object.freeze({
  project: { type: 'string' },
  turnBinding: { type: 'string' },
  contextEpoch: { type: 'string' },
  cursor: { type: 'string' },
  catalogDigest: { type: 'string' },
  skillId: {},
  contextBinding: { type: 'object' },
  previousPlanDigest: { type: 'string' },
  lateConditionId: { type: 'string' },
  generation: { type: 'integer', minimum: 0 },
  planDigest: { type: 'string' },
  stageId: { type: 'string' },
  triggerRef: { type: 'string' }
})

function skillRouteOpSchema (op, required, optional = []) {
  const properties = { op: { const: op } }
  for (const field of [...required, ...optional]) {
    if (field !== 'op') properties[field] = SKILL_ROUTE_VALUE_SCHEMA_BY_FIELD[field] || {}
  }
  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties
  }
}

const SKILL_ROUTE_INPUT_SCHEMA = {
  type: 'object',
  oneOf: [
    skillRouteOpSchema('catalog', ['op', 'project', 'turnBinding', 'contextEpoch'], ['cursor']),
    skillRouteOpSchema('commit', [
      'op', 'project', 'turnBinding', 'contextEpoch', 'catalogDigest', 'skillId', 'contextBinding'
    ], ['previousPlanDigest', 'lateConditionId']),
    skillRouteOpSchema('rebind', [
      'op', 'project', 'turnBinding', 'contextEpoch', 'generation', 'planDigest', 'contextBinding'
    ]),
    skillRouteOpSchema('load_stage', [
      'op', 'project', 'turnBinding', 'contextEpoch', 'generation', 'planDigest', 'stageId'
    ], ['cursor', 'triggerRef']),
    skillRouteOpSchema('status', ['op', 'project', 'turnBinding'], ['contextEpoch'])
  ]
}

const TOOLS = [
  {
    name: 'skill_route',
    description: 'Skill 路由：catalog/commit/rebind/load_stage/status；参数见 schema。',
    inputSchema: SKILL_ROUTE_INPUT_SCHEMA
  },
  {
    name: 'profile_context_plan',
    description: '生成 ContextReadPlanV2。',
    inputSchema: {
      type: 'object',
      required: ['intent'],
      properties: {
        intent: {
          type: 'string',
          enum: CONTEXT_READ_CONTRACT.intents
        },
        changeTypes: {
          type: 'array',
          uniqueItems: true,
          items: { type: 'string', enum: CONTEXT_READ_CONTRACT.changeTypes }
        },
        routeKey: { type: 'string', minLength: 1, maxLength: 128 },
        subtype: { type: 'string', minLength: 1, maxLength: 128 },
        stage: { type: 'string', minLength: 1, maxLength: 64 },
        contextEpoch: { type: 'string', minLength: 1 },
        project: { type: 'string' },
        scope: { type: 'string', enum: ['project', 'workspace'] },
        host: { type: 'string' },
        explicitSkillId: {
          type: 'string',
          minLength: 1
        },
        risk: { type: 'string', enum: CONTEXT_READ_CONTRACT.risks },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        profileSelectors: {
          type: 'array',
          items: {
            type: 'object',
            required: ['file', 'reason', 'authority'],
            properties: {
              file: { type: 'string' },
              reason: { type: 'string', minLength: 1 },
              authority: { type: 'string', minLength: 1 }
            },
            additionalProperties: false
          }
        },
        baselineDigest: { type: 'string' },
        explicitFull: { type: 'boolean' },
        fullReadReason: { type: 'string' },
        configLocalRequested: { type: 'boolean' },
        crossService: { type: 'boolean' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'profile_load',
    description: '有界加载计划内 Profile 正文。',
    inputSchema: {
      type: 'object',
      required: ['contextBinding'],
      properties: {
        project: { type: 'string' },
        scope: { type: 'string', enum: ['project', 'workspace'] },
        files: {
          type: 'array',
          items: { type: 'string' }
        },
        maxFiles: {
          type: 'integer',
          minimum: 1,
          maximum: 50
        },
        maxBytes: {
          type: 'integer',
          minimum: 1024,
          maximum: 2000000
        },
        sectionSelectors: {
          type: 'array',
          uniqueItems: true,
          items: {
            type: 'object',
            required: ['file', 'headingQueries'],
            properties: {
              file: { type: 'string', minLength: 1 },
              headingQueries: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', minLength: 1 } },
              requiredQueries: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
              includePreamble: { type: 'boolean' },
              includeDescendants: { type: 'boolean' },
              maxBytes: { type: 'integer', minimum: 1024, maximum: 2000000 },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              parser: { type: 'string', enum: ['atx-v1'] }
            },
            additionalProperties: false
          }
        },
        explicitFull: { type: 'boolean' },
        fullReadReason: { type: 'string' },
        executionOptimization: EXECUTION_OPTIMIZATION_BINDING_SCHEMA,
        contextBinding: CONTEXT_READ_BINDING_SCHEMA
      },
      additionalProperties: false
    }
  },
  {
    name: 'profile_skill_plan',
    description: '生成计划绑定的 BundleDecisionV2。',
    inputSchema: {
      type: 'object',
      required: ['candidateIds', 'contextBinding'],
      properties: {
        project: { type: 'string' },
        scope: { type: 'string', enum: ['project', 'workspace'] },
        candidateIds: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', minLength: 1 } },
        mandatoryIds: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
        includeGray: { type: 'boolean' },
        maxSkills: { type: 'integer', minimum: 1, maximum: 78 },
        maxBytes: { type: 'integer', minimum: 1024, maximum: 2000000 },
        maxTokens: { type: 'integer', minimum: 1 },
        budgetKind: { type: 'string', enum: ['profile-context', 'skill-bundle', 'artifact-projection'] },
        enterpriseCompleteFlow: { type: 'boolean' },
        hostTokenCounter: { type: 'boolean' },
        tokenCounts: { type: 'object', additionalProperties: { type: 'integer', minimum: 0 } },
        hostCapability: { type: 'string', enum: ['bundle-v2', 'native-oracle', 'unsupported'] },
        executionOptimization: EXECUTION_OPTIMIZATION_BINDING_SCHEMA,
        contextBinding: CONTEXT_READ_BINDING_SCHEMA
      },
      additionalProperties: false
    }
  },
  {
    name: 'profile_get_mode',
    description: '读取 ENV_MODE 与当前宿主。',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' }
      }
    }
  },
  {
    name: 'profile_compose_entry_check',
    description: 'PC0-PC10.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        status: { type: 'string' },
        nextStep: { type: 'string' },
        semanticDigest: { type: 'string' },
        entry: { type: 'object' }
      },
      additionalProperties: false
    }
  }
]

// ─── Prompts ──────────────────────────────────────────────────────────────────

const PROMPTS = [
  {
    name: 'devcodex-init',
    description: '一键加载 DevCodex 工作流规范与当前项目 Profile。在新建会话时使用，实现免手敲挂载规范。',
    arguments: [
      {
        name: 'project',
        description: 'workspace-namespace 下的目标项目命名空间；从工作区根启动 MCP 时必填。',
        required: false
      }
    ]
  }
]

// ─── Standard profile files ───────────────────────────────────────────────────

const REQUIRED_FILES = new Set(PROFILE_BASE_FILES)
const PROFILE_SOURCE_MAX_BYTES = 2 * 1024 * 1024
const PROFILE_AGGREGATE_SOURCE_MAX_BYTES = 8 * 1024 * 1024
const PROFILE_CONFIG_SOURCE_MAX_BYTES = 256 * 1024

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readProfileTextDocument(filePath, options = {}) {
  return readBoundedTextFileSync(filePath, {
    maxBytes: options.maxBytes || PROFILE_SOURCE_MAX_BYTES,
    allowMissing: true
  })
}

function readFileText(filePath, options = {}) {
  const document = readProfileTextDocument(filePath, options)
  return document.exists ? document.content : null
}

function profileSourceSnapshot(filePath, document) {
  const exists = document?.exists === true
  return {
    schemaVersion: 'ProfileSourceSnapshotV1',
    path: path.resolve(filePath),
    exists,
    logicalBytes: exists ? Number(document.logicalBytes || 0) : 0,
    sourceBytesRead: exists ? Number(document.sourceBytesRead || 0) : 0,
    sourceDigest: exists ? (document.sourceDigest || null) : null,
    sourcePrefixDigest: exists ? (document.sourcePrefixDigest || document.sourceDigest || null) : null,
    identity: exists && document.identity
      ? {
          dev: String(document.identity.dev),
          ino: String(document.identity.ino),
          size: Number(document.identity.size),
          mtimeMs: Number(document.identity.mtimeMs)
        }
      : null
  }
}

function readRuntimeKernelText() {
  const candidates = [
    path.join(__dirname, '..', 'AGENTS.md'),
    path.join(__dirname, '..', 'host-projections', 'AGENTS.md'),
    path.join(__dirname, '..', 'instructions.full.md')
  ]
  for (const candidate of candidates) {
    const content = readFileText(candidate)
    if (content) return { path: candidate, content }
  }
  return {
    path: null,
    content: '（⚠️ user-global DevCodex runtime kernel 未找到；请先执行 npm install -g devcodex）'
  }
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function profileConfigError(filePath, reason) {
  const error = new Error(`PROFILE_CONFIG_INVALID: ${filePath}: ${reason}`)
  error.code = 'PROFILE_CONFIG_INVALID'
  error.filePath = filePath
  return error
}

function readProfileConfigFile(filePath, options = {}) {
  const document = readBoundedTextFileSync(filePath, {
    maxBytes: Math.min(
      PROFILE_CONFIG_SOURCE_MAX_BYTES,
      Number.isInteger(options.maxBytes) && options.maxBytes > 0
        ? options.maxBytes
        : PROFILE_CONFIG_SOURCE_MAX_BYTES
    ),
    allowMissing: true
  })
  if (!document.exists) {
    return options.captureMissingSnapshot === true
      ? {
          exists: false,
          content: null,
          config: null,
          logicalBytes: 0,
          sourceBytesRead: 0,
          sourceSnapshot: profileSourceSnapshot(filePath, document)
        }
      : null
  }
  const content = document.content
  let config
  try {
    config = JSON.parse(content)
  } catch (error) {
    throw profileConfigError(filePath, error.message)
  }
  if (!isPlainObject(config)) {
    throw profileConfigError(filePath, 'root value must be a JSON object')
  }
  return {
    content,
    config,
    logicalBytes: document.logicalBytes,
    sourceBytesRead: document.sourceBytesRead,
    sourceSnapshot: profileSourceSnapshot(filePath, document)
  }
}

function mergeConfig(workspaceConfig, projectConfig) {
  function mergeLayer(base, overlay) {
    const merged = {}
    if (isPlainObject(base)) {
      for (const [key, value] of Object.entries(base)) {
        merged[key] = Array.isArray(value)
          ? value.slice()
          : isPlainObject(value)
            ? mergeLayer({}, value)
            : value
      }
    }
    if (isPlainObject(overlay)) {
      for (const [key, value] of Object.entries(overlay)) {
        merged[key] = Array.isArray(value)
          ? value.slice()
          : isPlainObject(value)
            ? mergeLayer(isPlainObject(merged[key]) ? merged[key] : {}, value)
            : value
      }
    }
    return merged
  }
  return mergeLayer(workspaceConfig, projectConfig)
}

const LAYOUT = findLayoutInfo(INPUT_ROOT)

function inferContextProject() {
  const binding = resolveHostWorkspaceBinding({
    cwd: INPUT_ROOT,
    layout: LAYOUT,
    capability: process.env.DEVCODEX_HOST_WORKSPACE_CAPABILITY || 'physical',
    allowUniqueProject: false
  })
  return binding.status === 'resolved' ? binding.projectNamespace : ''
}

const CONTEXT_PROJECT = inferContextProject()

function throwWorkspaceBindingError(binding) {
  const error = new Error(binding?.error?.message || 'host workspace binding failed')
  error.code = binding?.error?.code || 'HOST_WORKSPACE_UNRESOLVED'
  error.candidates = binding?.error?.candidates || []
  error.workspaceBinding = binding
  throw error
}

function resolveProjectBinding(projectName, { requireProfile = true } = {}) {
  if (!LAYOUT.enabled) return null
  if (projectName === WORKSPACE_CONTEXT_PROJECT) return null
  const target = String(projectName || CONTEXT_PROJECT || '').trim()
  if (!target) return null
  const binding = resolveHostWorkspaceBinding({
    cwd: INPUT_ROOT,
    layout: LAYOUT,
    explicitProject: target,
    capability: process.env.DEVCODEX_HOST_WORKSPACE_CAPABILITY || 'physical',
    requireProfile,
    allowUniqueProject: false
  })
  if (binding.status !== 'resolved') throwWorkspaceBindingError(binding)
  return binding
}

function readPackageVersionAt(root) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    return String(parsed.version || '').trim() || null
  } catch {
    return null
  }
}

function composeEntryVersionFacts(projectName) {
  const runtimeRoot = path.resolve(__dirname, '..')
  const runtimeStatus = readRuntimeGenerationStatus(runtimeRoot)
  const installedPackageVersion = runtimeStatus.receiptStatus === 'resolved'
    ? runtimeStatus.installedPackageVersion
    : (readPackageVersionAt(runtimeRoot) || PROFILE_PROCESS_IDENTITY.packageVersion || 'unverified')
  const activeRuntimeGeneration = {
    generationId: PROFILE_PROCESS_IDENTITY.generationId || 'unverified',
    packageVersion: PROFILE_PROCESS_IDENTITY.packageVersion || 'unverified',
    manifestStatus: PROFILE_PROCESS_IDENTITY.manifestStatus || 'unverified'
  }
  const configuredRuntimeGeneration = runtimeStatus.configuredRuntimeGeneration
    ? {
        generationId: runtimeStatus.configuredRuntimeGeneration.generationId,
        packageVersion: runtimeStatus.configuredRuntimeGeneration.packageVersion,
        manifestStatus: runtimeStatus.configuredRuntimeGeneration.manifestStatus
      }
    : null
  let sourceCandidate = null
  let sourceObserved = false
  try {
    const binding = resolveProjectBinding(projectName, { requireProfile: false })
    const sourceRoot = binding?.physicalRoot || (!LAYOUT.enabled ? resolveProjectRoot(projectName) : null)
    const packageVersion = sourceRoot ? readPackageVersionAt(sourceRoot) : null
    if (sourceRoot && packageVersion) {
      let shortHead = 'unverified'
      let dirty = false
      try {
        shortHead = execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], {
          cwd: sourceRoot, encoding: 'utf8', timeout: 2000, maxBuffer: 64 * 1024, windowsHide: true
        }).trim() || 'unverified'
        dirty = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=normal'], {
          cwd: sourceRoot, encoding: 'utf8', timeout: 3000, maxBuffer: 256 * 1024, windowsHide: true
        }).trim().length > 0
        sourceObserved = true
      } catch {}
      sourceCandidate = { root: sourceRoot, packageVersion, shortHead, dirty }
    }
  } catch {}
  let alignment = runtimeStatus.alignment
  let restartRequired = runtimeStatus.restartRequired
  let restartReason = runtimeStatus.reasonCode
  if (activeRuntimeGeneration.packageVersion !== installedPackageVersion) {
    alignment = 'runtime-mismatch'
    restartRequired = true
    restartReason = configuredRuntimeGeneration
      ? 'active-runtime-generation-superseded'
      : 'active-runtime-package-version-superseded'
  } else if (alignment !== 'runtime-mismatch') {
    if (!sourceCandidate) alignment = alignment === 'aligned' ? 'aligned' : 'version-only'
    else if (!sourceObserved) alignment = 'unverified'
    else if (sourceCandidate.dirty || sourceCandidate.packageVersion !== activeRuntimeGeneration.packageVersion) alignment = 'source-ahead'
    else alignment = alignment === 'aligned' ? 'aligned' : 'version-only'
  }
  return {
    installedPackageVersion,
    activeRuntimeGeneration,
    configuredRuntimeGeneration,
    sourceCandidate,
    alignment,
    restartRequired,
    restartReason
  }
}

function resolveProjectName(projectName) {
  if (LAYOUT.enabled) {
    return resolveProjectBinding(projectName)?.projectNamespace || ''
  }
  const raw = String(projectName || '').trim()
  if (!raw) return ''
  return path.basename(resolveLegacyProjectRoot(INPUT_ROOT, raw))
}

function resolveProjectRoot(projectName) {
  return resolveLegacyProjectRoot(INPUT_ROOT, projectName)
}

function getWorkspaceProfileDir() {
  if (LAYOUT.enabled) {
    // workspace-namespace: workspace base profile
    return path.join(LAYOUT.workspaceRoot, '.devcodex', 'workspace', 'profile')
  }
  return path.join(LAYOUT.workspaceRoot, '.devcodex', 'profile')
}

function getProjectNamespaceProfileDir(projectName) {
  if (projectName === WORKSPACE_CONTEXT_PROJECT) return null
  const name = resolveProjectName(projectName)
  if (!LAYOUT.enabled || !name) return null
  return path.join(namespaceRootPath(LAYOUT.workspaceRoot, name), 'profile')
}

function getLegacyProfileDirs(projectName) {
  const primary = path.join(resolveProjectRoot(projectName), '.devcodex', 'profile')
  const roots = [primary]
  const workspaceProfile = path.join(LAYOUT.workspaceRoot, '.devcodex', 'profile')
  if (primary !== workspaceProfile) roots.push(workspaceProfile)
  return roots
}

function getLegacySourceLabel(dir, projectName) {
  const projectRoot = resolveProjectRoot(projectName)
  const projectDir = path.join(projectRoot, '.devcodex', 'profile')
  return dir === projectDir ? `项目根（${path.basename(projectRoot)}）` : '工作区根'
}

function resolveProfileFile(name, projectName, options = {}) {
  const safeName = assertSingleSegment(name, 'profile file')
  if (!/\.md$/i.test(safeName) && safeName !== 'config.json' && safeName !== 'config.local.json') {
    throw new Error('invalid profile file')
  }
  if (safeName === 'config.json') return resolveConfigFile(projectName, options)

  if (!LAYOUT.enabled) {
    const sourceSnapshots = []
    for (const dir of getLegacyProfileDirs(projectName)) {
      const fullPath = resolveInside(dir, safeName)
      const document = readProfileTextDocument(fullPath, options)
      sourceSnapshots.push(profileSourceSnapshot(fullPath, document))
      if (document.exists) {
        return {
          exists: true,
          content: document.content,
          fullPath,
          sourceLabel: getLegacySourceLabel(dir, projectName),
          sourcePaths: [fullPath],
          sourceSnapshots,
          sourceBytesRead: document.sourceBytesRead
        }
      }
    }
    return options.captureMissingSnapshots === true
      ? { exists: false, content: null, fullPath: null, sourceLabel: '未命中', sourcePaths: [], sourceSnapshots, sourceBytesRead: 0 }
      : null
  }

  const projectDir = getProjectNamespaceProfileDir(projectName)
  const workspaceDir = getWorkspaceProfileDir()
  const projectPath = projectDir ? resolveInside(projectDir, safeName) : null
  const workspacePath = resolveInside(workspaceDir, safeName)
  const sourceSnapshots = []

  if (projectPath) {
    const projectDocument = readProfileTextDocument(projectPath, options)
    sourceSnapshots.push(profileSourceSnapshot(projectPath, projectDocument))
    if (projectDocument.exists) {
      return {
        exists: true,
        content: projectDocument.content,
        fullPath: projectPath,
        sourceLabel: `项目命名空间（${resolveProjectName(projectName)}）`,
        sourcePaths: [projectPath],
        sourceSnapshots,
        sourceBytesRead: projectDocument.sourceBytesRead
      }
    }
  }

  const workspaceDocument = readProfileTextDocument(workspacePath, options)
  sourceSnapshots.push(profileSourceSnapshot(workspacePath, workspaceDocument))
  if (workspaceDocument.exists) {
    return {
      exists: true,
      content: workspaceDocument.content,
      fullPath: workspacePath,
      sourceLabel: '工作区基座（workspace）',
      sourcePaths: [workspacePath],
      sourceSnapshots,
      sourceBytesRead: workspaceDocument.sourceBytesRead
    }
  }

  return options.captureMissingSnapshots === true
    ? { exists: false, content: null, fullPath: null, sourceLabel: '未命中', sourcePaths: [], sourceSnapshots, sourceBytesRead: 0 }
    : null
}

function resolveProfileSectionFile(name, projectName, options = {}) {
  const safeName = assertSingleSegment(name, 'profile file')
  if (!/\.md$/i.test(safeName)) {
    const error = new Error(`Profile section selectors only support Markdown files: ${safeName}`)
    error.code = 'PROFILE_SECTION_SELECTOR_INVALID'
    throw error
  }
  const sourceSnapshots = []
  const selectAt = (fullPath, sourceLabel) => {
    const selected = selectProfileSectionsFromFileSync({
      file: safeName,
      filePath: fullPath,
      selector: options.selector,
      maxScanBytes: options.maxScanBytes,
      maxTotalSourceBytes: options.maxTotalSourceBytes
    })
    sourceSnapshots.push(profileSourceSnapshot(fullPath, selected.scan))
    if (!selected.exists) return null
    return {
      exists: true,
      content: selected.body,
      fullPath,
      sourceLabel,
      sourcePaths: [fullPath],
      sourceSnapshots: [...sourceSnapshots],
      sourceBytesRead: selected.sourceBytesRead,
      selection: selected
    }
  }

  if (!LAYOUT.enabled) {
    for (const dir of getLegacyProfileDirs(projectName)) {
      const fullPath = resolveInside(dir, safeName)
      const selected = selectAt(fullPath, getLegacySourceLabel(dir, projectName))
      if (selected) return selected
    }
    return options.captureMissingSnapshots === true
      ? { exists: false, content: null, fullPath: null, sourceLabel: '未命中', sourcePaths: [], sourceSnapshots, sourceBytesRead: 0 }
      : null
  }

  const projectDir = getProjectNamespaceProfileDir(projectName)
  if (projectDir) {
    const projectPath = resolveInside(projectDir, safeName)
    const selected = selectAt(projectPath, `项目命名空间（${resolveProjectName(projectName)}）`)
    if (selected) return selected
  }
  const workspacePath = resolveInside(getWorkspaceProfileDir(), safeName)
  const selected = selectAt(workspacePath, '工作区基座（workspace）')
  return selected || (options.captureMissingSnapshots === true
    ? { exists: false, content: null, fullPath: null, sourceLabel: '未命中', sourcePaths: [], sourceSnapshots, sourceBytesRead: 0 }
    : null)
}

function resolveConfigFile(projectName, options = {}) {
  let remainingSourceBytes = Number.isInteger(options.maxBytes) && options.maxBytes > 0
    ? options.maxBytes
    : Number.POSITIVE_INFINITY
  const loadConfig = filePath => {
    if (remainingSourceBytes < 1 && fs.existsSync(filePath)) {
      const error = new Error(`Context source exceeds the aggregate Profile read budget: ${filePath}`)
      error.code = 'SOURCE_TOO_LARGE'
      error.filePath = filePath
      error.logicalBytes = fs.statSync(filePath).size
      error.maxBytes = 0
      error.sourceBytesRead = 0
      throw error
    }
    const loaded = readProfileConfigFile(filePath, {
      maxBytes: Number.isFinite(remainingSourceBytes)
        ? Math.max(1, remainingSourceBytes)
        : PROFILE_CONFIG_SOURCE_MAX_BYTES,
      captureMissingSnapshot: options.captureMissingSnapshots === true
    })
    remainingSourceBytes -= Number(loaded?.sourceBytesRead || 0)
    return loaded
  }
  if (!LAYOUT.enabled) {
    const sourceSnapshots = []
    for (const dir of getLegacyProfileDirs(projectName)) {
      const fullPath = path.join(dir, 'config.json')
      const loaded = loadConfig(fullPath)
      if (loaded?.sourceSnapshot) sourceSnapshots.push(loaded.sourceSnapshot)
      if (loaded?.config !== null && loaded?.config !== undefined) {
        return {
          exists: true,
          content: loaded.content,
          fullPath,
          sourceLabel: getLegacySourceLabel(dir, projectName),
          sourcePaths: [fullPath],
          sourceSnapshots,
          config: loaded.config,
          sourceBytesRead: loaded.sourceBytesRead
        }
      }
    }
    return {
      exists: false,
      content: null,
      fullPath: null,
      sourceLabel: '未命中',
      sourcePaths: [],
      sourceSnapshots,
      config: null,
      sourceBytesRead: 0
    }
  }

  const workspaceDir = getWorkspaceProfileDir()
  const projectDir = getProjectNamespaceProfileDir(projectName)
  const workspacePath = path.join(workspaceDir, 'config.json')
  const projectPath = projectDir ? path.join(projectDir, 'config.json') : null
  const workspaceLoaded = loadConfig(workspacePath)
  const projectLoaded = projectPath ? loadConfig(projectPath) : null
  const workspaceConfig = workspaceLoaded?.config || null
  const projectConfig = projectLoaded?.config || null
  const exists = workspaceConfig !== null || projectConfig !== null
  const merged = mergeConfig(workspaceConfig, projectConfig)
  const sourcePaths = []
  if (workspaceConfig !== null) sourcePaths.push(workspacePath)
  if (projectConfig !== null && projectPath) sourcePaths.push(projectPath)
  return {
    exists,
    content: exists ? JSON.stringify(merged, null, 2) : null,
    fullPath: projectConfig !== null && projectPath ? projectPath : (workspaceConfig !== null ? workspacePath : null),
    sourceLabel: projectConfig !== null
      ? `工作区基座（workspace） + 项目命名空间（${resolveProjectName(projectName)}）`
      : (workspaceConfig !== null ? '工作区基座（workspace）' : '未命中'),
    sourcePaths,
    sourceSnapshots: [workspaceLoaded?.sourceSnapshot, projectLoaded?.sourceSnapshot].filter(Boolean),
    config: exists ? merged : null,
    sourceBytesRead: Number(workspaceLoaded?.sourceBytesRead || 0) + Number(projectLoaded?.sourceBytesRead || 0)
  }
}

const CONTEXT_PLAN_ARG_FIELDS = new Set([
  'intent', 'changeTypes', 'routeKey', 'subtype', 'stage', 'contextEpoch', 'project', 'scope', 'host', 'explicitSkillId', 'risk', 'confidence',
  'profileSelectors', 'baselineDigest', 'explicitFull', 'fullReadReason',
  'configLocalRequested', 'crossService'
])
const CONTEXT_PLAN_ROUTE_FIELDS = Object.freeze(['routeKey', 'subtype', 'stage'])
const CONTEXT_PLAN_EPOCHS = new Map()
const CONTEXT_CACHE_MAX_BYTES = 32 * 1024 * 1024
const CONTEXT_CACHE_MAX_ENTRIES = 4096

function resolveProfilePlanTarget(projectName, scope) {
  if (scope !== undefined && !['project', 'workspace'].includes(scope)) {
    throw new Error('scope must be project or workspace')
  }
  if (scope === 'workspace' && projectName !== undefined) {
    throw new Error('project must be omitted when scope is workspace')
  }
  if (LAYOUT.enabled) {
    if (scope === 'workspace') {
      return {
        project: WORKSPACE_CONTEXT_PROJECT,
        activeRoot: path.join(LAYOUT.workspaceRoot, '.devcodex', 'workspace')
      }
    }
    const binding = resolveProjectBinding(projectName)
    const project = binding?.projectNamespace || ''
    if (!project) throw new Error('project is required for profile_context_plan when MCP runs from workspace root')
    return {
      project,
      activeRoot: binding.activeRoot,
      workspaceBinding: binding
    }
  }
  if (scope === 'workspace') {
    throw new Error('scope workspace requires workspace-namespace layout')
  }
  const projectRoot = resolveProjectRoot(projectName)
  return {
    project: path.basename(projectRoot),
    activeRoot: path.join(projectRoot, '.devcodex')
  }
}

function getProfilePlanLayers(project) {
  if (LAYOUT.enabled) {
    return [
      { dir: getWorkspaceProfileDir(), layer: 'workspace', authority: 'workspace-profile' },
      {
        dir: getProjectNamespaceProfileDir(project),
        layer: `project:${project}`,
        authority: `project-profile:${project}`
      }
    ].filter(item => item.dir)
  }
  const dirs = getLegacyProfileDirs(project)
  const primary = path.resolve(dirs[0])
  const ordered = [...new Set(dirs.map(dir => path.resolve(dir)))].reverse()
  return ordered.map(dir => ({
    dir,
    layer: dir === primary ? `project:${project}` : 'workspace-fallback',
    authority: dir === primary ? `project-profile:${project}` : 'workspace-profile-fallback'
  }))
}

function profileLayerForPath(project, sourcePath) {
  const normalized = path.resolve(sourcePath)
  const layers = getProfilePlanLayers(project)
  const match = layers.find(item => {
    const dir = path.resolve(item.dir)
    const relative = path.relative(dir, normalized)
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
  })
  return match?.layer || ''
}

function combineProfileLayers(project, sourcePaths) {
  const layers = [...new Set(sourcePaths.map(sourcePath => profileLayerForPath(project, sourcePath)).filter(Boolean))]
  if (layers.length <= 1) return layers[0] || ''
  const projectLayer = `project:${project}`
  if (layers.includes(projectLayer) && layers.includes('workspace')) return `${projectLayer}+workspace`
  return layers.sort().join('+')
}

function statProfileRef(filePath, layer) {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) throw new Error('not a file')
    return { path: filePath, layer, exists: true, size: stat.size, mtimeMs: stat.mtimeMs }
  } catch {
    return { path: filePath, layer, exists: false, size: null, mtimeMs: null }
  }
}

function parseReadmeCatalog(markdown, authority) {
  const tables = parseMarkdownTables(markdown)
  const table = tables.find(candidate => {
    const fileIndex = candidate.headers.findIndex(header => /^(文件|file)$/i.test(header.trim()))
    const descriptionIndex = candidate.headers.findIndex(header => /说明|description/i.test(header))
    const requiredIndex = candidate.headers.findIndex(header => /必须|required/i.test(header))
    if (fileIndex < 0 || (descriptionIndex < 0 && requiredIndex < 0)) return false
    return candidate.rows.some(row => !!extractFile(row[fileIndex]))
  })
  if (!table) return []
  const fileIndex = table.headers.findIndex(header => /^(文件|file)$/i.test(header.trim()))
  const descriptionIndex = table.headers.findIndex(header => /说明|description/i.test(header))
  const requiredIndex = table.headers.findIndex(header => /必须|required/i.test(header))
  return table.rows.map(row => {
    const file = extractFile(row[fileIndex])
    if (!file) return null
    const requiredText = requiredIndex >= 0 ? String(row[requiredIndex] || '').trim() : ''
    return {
      file,
      description: descriptionIndex >= 0 ? String(row[descriptionIndex] || '').trim() : '',
      requiredToExist: !!requiredText && !/(按需|可选|条件|否|n\/a|—|-)/i.test(requiredText),
      authority
    }
  }).filter(Boolean)

  function extractFile(cell) {
    const text = String(cell || '').trim()
    const link = text.match(/\]\(([^)]+)\)/)
    let candidate = link ? link[1].trim().replace(/^\.\//, '') : text.replace(/[`*_]/g, '').trim()
    try { candidate = decodeURIComponent(candidate) } catch {}
    if (!candidate || /[\\/]/.test(candidate) || !(/\.md$/i.test(candidate) || ['config.json', 'config.local.json'].includes(candidate))) return ''
    try { return assertSingleSegment(candidate, 'profile catalog file') } catch { return '' }
  }
}

/** Collect lossless baseline bodies plus bounded top-level metadata without reading 01~09/local content. */
function collectProfilePlanInputs(target) {
  const layers = getProfilePlanLayers(target.project)
  const readmeLayers = []
  const actualNames = new Set()
  for (const layer of layers) {
    const readmePath = path.join(layer.dir, 'README.md')
    const content = readFileText(readmePath)
    if (content !== null) {
      readmeLayers.push({ ...layer, content, ref: statProfileRef(readmePath, layer.layer) })
    }
    let entries = []
    try { entries = fs.readdirSync(layer.dir, { withFileTypes: true }) } catch {}
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const file = String(entry.name || '').trim()
      if (/\.md$/i.test(file) || ['config.json', 'config.local.json'].includes(file)) actualNames.add(file)
    }
  }
  if (!readmeLayers.length) throw new Error('Profile README.md is missing for the active target')
  const effectiveReadme = readmeLayers[readmeLayers.length - 1]
  const profileTier = detectProfileTier(effectiveReadme.content)

  const catalogByFile = new Map()
  for (const item of readmeLayers) {
    for (const entry of parseReadmeCatalog(item.content, `profile-readme:${item.layer}`)) {
      catalogByFile.set(entry.file, entry)
    }
  }
  const tierFiles = filesForProfileTier(profileTier, { includeConfig: false })
  for (const expected of tierFiles) {
    let file = expected
    if (expected === '05-发布规范.md') {
      file = PROFILE_RELEASE_FILES.find(candidate => actualNames.has(candidate) || catalogByFile.has(candidate)) || expected
    }
    const prior = catalogByFile.get(file)
    catalogByFile.set(file, {
      file,
      description: prior?.description || `Required by ${profileTier}.`,
      requiredToExist: true,
      authority: prior?.authority || `profile-tier:${profileTier}`
    })
  }

  const candidateNames = new Set([
    ...actualNames,
    ...catalogByFile.keys(),
    'README.md',
    'config.json',
    'config.local.json'
  ])
  const inventory = [...candidateNames].sort().map(file => {
    const refs = layers.map(layer => statProfileRef(path.join(layer.dir, file), layer.layer))
    const effectiveRef = [...refs].reverse().find(ref => ref.exists) || refs[refs.length - 1]
    return {
      file,
      sourceLayer: effectiveRef.layer,
      sourceRefs: [effectiveRef],
      authority: 'bounded-top-level-profile-inventory'
    }
  })

  const config = resolveConfigFile(target.project)
  let configSourceRefs = (config.sourcePaths || []).map(sourcePath => {
    const layer = [...layers].reverse().find(item => path.dirname(sourcePath) === path.resolve(item.dir) || path.dirname(sourcePath) === item.dir)
    return statProfileRef(sourcePath, layer?.layer || 'profile-config')
  })
  if (!configSourceRefs.length) {
    const strongest = layers[layers.length - 1]
    configSourceRefs = [statProfileRef(path.join(strongest.dir, 'config.json'), strongest.layer)]
  }
  const mode = String(config.config?.mode || '').toLowerCase() === 'dev' ? 'dev' : 'prod'
  return {
    baselineContext: {
      layout: LAYOUT.mode,
      project: target.project,
      mode,
      agent: DEFAULT_AGENT,
      profileTier,
      effectiveConfig: config.config || {},
      readme: {
        content: effectiveReadme.content,
        sourceRefs: readmeLayers.map(item => item.ref)
      },
      configSourceRefs,
      catalog: [...catalogByFile.values()].sort((left, right) => left.file.localeCompare(right.file)),
      inventory
    }
  }
}

function getContextPlanEpoch(requestedEpoch) {
  const contextEpoch = String(requestedEpoch || '').trim() || `ctx-${crypto.randomUUID()}`
  if (!CONTEXT_PLAN_EPOCHS.has(contextEpoch)) {
    CONTEXT_PLAN_EPOCHS.set(contextEpoch, new Date().toISOString())
    if (CONTEXT_PLAN_EPOCHS.size > 100) CONTEXT_PLAN_EPOCHS.delete(CONTEXT_PLAN_EPOCHS.keys().next().value)
  }
  return { contextEpoch, createdAt: CONTEXT_PLAN_EPOCHS.get(contextEpoch) }
}

const DEV_CODEX_ROUTE_LOAD_MAX_BYTES = 40 * 1024
const DEV_CODEX_ROUTE_LOAD_MINIMUM_HEADROOM_BYTES = 1024
const DEV_CODEX_ROUTE_LOAD_ENTRIES = Object.freeze({
  '01-项目信息.md': Object.freeze({
    headingQueries: ['完整开发需求验证链速查', '当前开发重点'],
    maxBytes: 8192
  }),
  '02-架构约束.md': Object.freeze({
    headingQueries: ['执行链派生状态与回滚边界', '控制面内容物化边界'],
    maxBytes: 4096
  }),
  '03-代码风格.md': Object.freeze({
    headingQueries: ['JavaScript', 'Markdown规范文件', '禁止事项'],
    maxBytes: 8192
  }),
  '04-测试规范.md': Object.freeze({
    headingQueries: ['Profile专项', '基本原则', '控制面内容验证'],
    maxBytes: 4096
  }),
  '06-功能清单.md': Object.freeze({
    headingQueries: ['全项目Profile校验', '公开面维护规则', '近期发布增量'],
    maxBytes: 12 * 1024
  }),
  '07-用户文档与契约规范.md': Object.freeze({
    headingQueries: ['写作与审查原则', '控制面内容契约', '用户文档主面'],
    maxBytes: 4096
  })
})

function buildDevCodexRouteLoadRecipe(project, selectedFiles, fullRead) {
  if (String(project || '').trim() !== 'devcodex' || fullRead === true) return null
  const files = Array.isArray(selectedFiles) ? [...selectedFiles].sort() : []
  if (!files.length || files.some(file => !DEV_CODEX_ROUTE_LOAD_ENTRIES[file])) return null
  const entries = files.map(file => {
    const template = DEV_CODEX_ROUTE_LOAD_ENTRIES[file]
    return {
      file,
      headingQueries: [...template.headingQueries],
      requiredQueries: [...template.headingQueries],
      includePreamble: false,
      includeDescendants: true,
      boundedOnly: true,
      maxBytes: template.maxBytes
    }
  })
  const material = {
    schemaVersion: 'ProfileRouteLoadRecipeV2',
    strategy: 'bounded-section-selectors',
    maxFiles: entries.length,
    maxBytes: DEV_CODEX_ROUTE_LOAD_MAX_BYTES,
    minimumHeadroomBytes: DEV_CODEX_ROUTE_LOAD_MINIMUM_HEADROOM_BYTES,
    entries
  }
  return { ...material, recipeDigest: stableDigest(material) }
}

function buildProfileRouteRecoveryRecipe(file, recipeEntry, sectionReceipt) {
  const deferredByQuery = new Map((sectionReceipt?.deferredSections || [])
    .map(item => [String(item?.query || ''), item]))
  const missing = new Set(sectionReceipt?.missing || [])
  const ambiguous = new Set((sectionReceipt?.ambiguous || []).map(item => item.query))
  const sourceLineByQuery = new Map((sectionReceipt?.matchedHeadings || [])
    .map(item => [String(item?.query || ''), Number(item?.line || Number.MAX_SAFE_INTEGER)]))
  const sourceOrderedQueries = recipeEntry.headingQueries
    .map((query, recipeOrder) => ({
      query,
      recipeOrder,
      sourceLine: sourceLineByQuery.get(query) || Number.MAX_SAFE_INTEGER
    }))
    .sort((left, right) => left.sourceLine - right.sourceLine || left.recipeOrder - right.recipeOrder)
  const calls = sourceOrderedQueries.map(({ query, sourceLine }, sourceOrder) => {
    const deferred = deferredByQuery.get(query)
    const measuredBytes = Number(deferred?.bytes || 0)
    const selectorMaxBytes = Math.min(2_000_000, Math.max(
      1024,
      measuredBytes > 0 ? measuredBytes + 512 : recipeEntry.maxBytes
    ))
    return {
      tool: 'profile_load',
      arguments: {
        files: [file],
        maxFiles: 1,
        maxBytes: selectorMaxBytes + 1024,
        sectionSelectors: [{
          file,
          headingQueries: [query],
          requiredQueries: [query],
          includePreamble: recipeEntry.includePreamble === true,
          includeDescendants: recipeEntry.includeDescendants === true,
          boundedOnly: true,
          maxBytes: selectorMaxBytes
        }]
      },
      query,
      sourceOrder,
      sourceLine: Number.isSafeInteger(sourceLine) ? sourceLine : null,
      status: missing.has(query) ? 'heading-missing' : (ambiguous.has(query) ? 'heading-ambiguous' : 'replayable')
    }
  })
  const material = {
    schemaVersion: 'ProfileSectionRecoveryRecipeV1',
    strategy: 'one-heading-per-call-in-source-document',
    file,
    sourceDigest: sectionReceipt?.sourceDigest || null,
    contextBindingRequired: true,
    satisfiedQueries: (sectionReceipt?.matchedHeadings || [])
      .map(item => item.query)
      .filter(query => !deferredByQuery.has(query)),
    blockedQueries: calls.filter(call => call.status !== 'replayable').map(call => call.query),
    calls
  }
  return { ...material, recipeDigest: stableDigest(material) }
}

function buildProfileRouteAggregateRecoveryRecipe(routeLoadRecipe, sectionReceipts = []) {
  const perFile = routeLoadRecipe.entries.map(entry => buildProfileRouteRecoveryRecipe(
    entry.file,
    entry,
    sectionReceipts.find(receipt => receipt.file === entry.file) || null
  ))
  const material = {
    schemaVersion: 'ProfileRouteRecoveryRecipeV1',
    strategy: 'one-file-one-heading-per-call',
    sourceRecipeDigest: routeLoadRecipe.recipeDigest,
    contextBindingRequired: true,
    files: perFile
  }
  return { ...material, recipeDigest: stableDigest(material) }
}

function contextPlanStableProjection(plan) {
  const projection = {}
  for (const [key, value] of Object.entries(plan)) {
    if (['planId', 'contextBinding', 'identity', 'planningTelemetry', 'stageTiming', 'cacheDecision'].includes(key)) continue
    projection[key] = value
  }
  return projection
}

function contextCacheUsage(activeRoot) {
  const cacheDir = path.join(resolveRuntimeStateRoot(activeRoot).root, 'context-plan-cache')
  let entries
  try { entries = fs.readdirSync(cacheDir, { withFileTypes: true }) } catch (error) {
    if (error?.code === 'ENOENT') return { cacheDir, entries: 0, bytes: 0, exceeded: false }
    return { cacheDir, entries: 0, bytes: 0, exceeded: false, error }
  }
  if (entries.length > CONTEXT_CACHE_MAX_ENTRIES) {
    return { cacheDir, entries: entries.length, bytes: null, exceeded: true, reasonCode: 'entry-bound-exceeded' }
  }
  let bytes = 0
  let files = 0
  for (const entry of entries) {
    if (!entry.isFile()) continue
    try {
      bytes += fs.statSync(path.join(cacheDir, entry.name)).size
      files += 1
    } catch { }
    if (bytes > CONTEXT_CACHE_MAX_BYTES) {
      return { cacheDir, entries: files, bytes, exceeded: true, reasonCode: 'metadata-budget-exceeded' }
    }
  }
  return { cacheDir, entries: files, bytes, exceeded: false }
}

function finalizeContextPlanResponseBytes(plan) {
  let observed = Number(plan.stageTiming?.plannerResponseBytes) || 0
  for (let attempt = 0; attempt < 4; attempt += 1) {
    plan.stageTiming.plannerResponseBytes = observed
    const next = Buffer.byteLength(JSON.stringify(plan, null, 2), 'utf8')
    if (next === observed) break
    observed = next
  }
  plan.stageTiming.plannerResponseBytes = Buffer.byteLength(JSON.stringify(plan, null, 2), 'utf8')
  return plan
}

function applyContextPlanComputationCache(candidate, target, featureDecision) {
  const lookupStarted = process.hrtime.bigint()
  const usage = contextCacheUsage(target.activeRoot)
  const baseDecision = {
    schemaVersion: 'ContextComputationCacheDecisionV1',
    cacheKey: candidate.planContentId,
    scope: target.activeRoot.replace(/\\/g, '/'),
    reusedArtifacts: [],
    bodyDeliverySkipped: false,
    bytes: usage.bytes,
    maxBytes: CONTEXT_CACHE_MAX_BYTES
  }
  if (!featureDecision.optimizationAllowed) {
    candidate.cacheDecision = {
      ...baseDecision,
      status: 'bypassed',
      reasonCode: featureDecision.reasonCode
    }
    candidate.stageTiming.cacheLookupMs = Number(process.hrtime.bigint() - lookupStarted) / 1e6
    return finalizeContextPlanResponseBytes(candidate)
  }
  if (usage.error || usage.exceeded) {
    candidate.cacheDecision = {
      ...baseDecision,
      status: usage.error ? 'error' : 'bypassed',
      reasonCode: usage.error ? 'cache-inventory-error' : usage.reasonCode
    }
    candidate.stageTiming.cacheLookupMs = Number(process.hrtime.bigint() - lookupStarted) / 1e6
    return finalizeContextPlanResponseBytes(candidate)
  }

  const sourceIdentity = buildJsonContentIdentity({
    sourceKey: `context-plan://${target.activeRoot.replace(/\\/g, '/')}/${candidate.planContentId}`,
    value: candidate.identityInputs,
    contractVersion: candidate.schemaVersion
  }).identity
  const relativePath = path.join('context-plan-cache', `${candidate.planContentId}.json`)
  const store = createRuntimeStateStore({
    activeRoot: target.activeRoot,
    project: target.project,
    relativePath,
    maxBytes: CONTEXT_CACHE_MAX_BYTES,
    lockWaitMs: 2000,
    maxWrites: 1
  })
  const cached = store.read({ expectedIdentity: sourceIdentity })
  if (cached.status === 'fresh' && cached.value?.schemaVersion === 'ContextPlanComputationCacheV1' &&
      cached.value.planContentId === candidate.planContentId && cached.value.projection) {
    const reused = {
      ...candidate,
      ...cached.value.projection,
      identity: candidate.identity,
      planningTelemetry: candidate.planningTelemetry,
      stageTiming: candidate.stageTiming,
      cacheDecision: candidate.cacheDecision
    }
    const validation = validateContextReadPlan(reused)
    if (validation.valid) {
      reused.cacheDecision = {
        ...baseDecision,
        status: 'hit',
        reasonCode: 'content-identity-match',
        reusedArtifacts: ['plan-content-projection'],
        bytes: cached.bytes
      }
      reused.stageTiming.cacheLookupMs = Number(process.hrtime.bigint() - lookupStarted) / 1e6
      return finalizeContextPlanResponseBytes(reused)
    }
  }

  const serializedEntry = {
    schemaVersion: 'ContextPlanComputationCacheV1',
    sourceIdentity,
    planContentId: candidate.planContentId,
    projection: contextPlanStableProjection(candidate)
  }
  const prospectiveBytes = Buffer.byteLength(JSON.stringify(serializedEntry, null, 2) + '\n', 'utf8')
  const capacityAvailable = Number(usage.bytes || 0) + prospectiveBytes <= CONTEXT_CACHE_MAX_BYTES
  const write = capacityAvailable ? store.write(serializedEntry) : { status: 'bypassed', errorCode: 'DERIVED_STATE_CAPACITY_EXCEEDED' }
  const corrupted = ['invalid', 'stale'].includes(cached.status)
  candidate.cacheDecision = {
    ...baseDecision,
    status: corrupted ? 'error' : (write.status === 'persisted' ? 'miss' : 'bypassed'),
    reasonCode: corrupted
      ? 'cache-entry-invalid'
      : (write.status === 'persisted' ? 'cache-entry-missing' : String(write.errorCode || 'cache-write-bypassed').toLowerCase()),
    bytes: write.bytes ?? usage.bytes
  }
  candidate.stageTiming.cacheLookupMs = Number(process.hrtime.bigint() - lookupStarted) / 1e6
  return finalizeContextPlanResponseBytes(candidate)
}

function resolveDefaultProfileFiles(projectName) {
  const tierCorpus = ['README.md', '01-项目信息.md', '06-功能清单.md', '07-用户文档与契约规范.md']
    .map(name => resolveProfileFile(name, projectName)?.content || '')
    .join('\n')
  const tier = detectProfileTier(tierCorpus)
  const names = filesForProfileTier(tier, { includeConfig: false })
  const releaseIndex = names.indexOf('05-发布规范.md')
  if (releaseIndex >= 0 && !resolveProfileFile('05-发布规范.md', projectName)) {
    const alternative = PROFILE_RELEASE_FILES.find(name => resolveProfileFile(name, projectName))
    if (alternative) names[releaseIndex] = alternative
  }
  return [...names, 'config.json', 'config.local.json']
}

function resolveExecutionOptimizationBinding(binding) {
  const errors = []
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
    errors.push('binding must be an object')
  } else {
    const allowed = new Set(['schemaVersion', 'requested', 'mode', 'status', 'errorCode', 'configIdentity', 'bindingDigest'])
    if (Object.keys(binding).some(key => !allowed.has(key))) errors.push('binding contains unsupported fields')
    if (binding.schemaVersion !== CONTEXT_READ_CONTRACT.schemas.executionOptimizationBinding) errors.push('binding schema is invalid')
    if (!['safe-auto', 'full-only'].includes(binding.mode)) errors.push('binding mode is invalid')
    if (!['defaulted', 'configured', 'fail-closed'].includes(binding.status)) errors.push('binding status is invalid')
    if (!validateContentIdentity(binding.configIdentity).valid) errors.push('binding config identity is invalid')
    const digestInput = {
      schemaVersion: binding.schemaVersion,
      requested: binding.requested,
      mode: binding.mode,
      status: binding.status,
      errorCode: binding.errorCode,
      configIdentity: binding.configIdentity
    }
    if (binding.bindingDigest !== stableDigest(digestInput)) errors.push('binding digest is invalid')
    if (binding.status === 'defaulted' && (binding.requested !== null || binding.mode !== 'safe-auto' || binding.errorCode !== null)) errors.push('defaulted binding is non-canonical')
    if (binding.status === 'configured' && (!['safe-auto', 'full-only'].includes(binding.requested) || binding.mode !== binding.requested || binding.errorCode !== null)) errors.push('configured binding is non-canonical')
    if (binding.status === 'fail-closed' && (['safe-auto', 'full-only'].includes(binding.requested) || binding.mode !== 'full-only' || binding.errorCode !== 'EXECUTION_OPTIMIZATION_MODE_INVALID')) errors.push('fail-closed binding is non-canonical')
  }
  const validation = { valid: errors.length === 0, errors }
  if (!validation.valid) {
    return {
      ...normalizeExecutionOptimizationMode('invalid-plan-binding'),
      errorCode: 'EXECUTION_OPTIMIZATION_BINDING_INVALID',
      bindingValid: false,
      validationErrors: validation.errors
    }
  }
  return {
    requested: binding.requested,
    effective: binding.mode,
    status: binding.status,
    errorCode: binding.errorCode,
    bindingValid: true,
    configIdentity: binding.configIdentity,
    bindingDigest: binding.bindingDigest
  }
}

function resolveProfileOptimizationFeature(project, optimizationMode, featureId, scope) {
  try {
    const target = resolveProfilePlanTarget(project, scope)
    return resolveExecutionFeatureDecisionForCwd({
      cwd: INPUT_ROOT,
      activeRoot: target.activeRoot,
      modeDecision: optimizationMode,
      featureId
    })
  } catch (error) {
    return {
      ...resolveExecutionFeatureDecisionForCwd({
        cwd: INPUT_ROOT,
        activeRoot: path.join(INPUT_ROOT, '.devcodex'),
        modeDecision: {
          requested: null,
          effective: 'full-only',
          status: 'fail-closed',
          errorCode: 'EXECUTION_OPTIMIZATION_TARGET_INVALID'
        },
        state: null,
        featureId
      }),
      reasonCode: 'execution-optimization-target-invalid',
      targetError: error.message
    }
  }
}

function contextBindingError(errorCode, message) {
  const error = new Error(message)
  error.contextReadCode = errorCode
  return error
}

function comparableActiveRoot(value) {
  const resolved = path.resolve(String(value || ''))
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function resolveContextReadAuthorization(binding, target, requested = {}) {
  if (binding === undefined || binding === null) {
    throw contextBindingError(
      'CONTEXT_BINDING_REQUIRED',
      'A current ContextReadBindingV1 is required before reading governed Profile content.'
    )
  }
  if (typeof binding !== 'object' || Array.isArray(binding)) {
    throw contextBindingError('CONTEXT_BINDING_INVALID', 'contextBinding must be an object.')
  }
  const allowed = new Set(['schemaVersion', 'contextEpoch', 'planId', 'planContentId', 'activeRoot', 'project'])
  const unknown = Object.keys(binding).filter(key => !allowed.has(key))
  const requiredStrings = ['contextEpoch', 'planId', 'planContentId', 'activeRoot']
  if (unknown.length || binding.schemaVersion !== 'ContextReadBindingV1' ||
      requiredStrings.some(field => typeof binding[field] !== 'string' || !binding[field].trim()) ||
      typeof binding.project !== 'string') {
    throw contextBindingError('CONTEXT_BINDING_INVALID', 'contextBinding does not match the published ContextReadBindingV1 request schema.')
  }
  if (comparableActiveRoot(binding.activeRoot) !== comparableActiveRoot(target.activeRoot) ||
      binding.project.trim() !== String(target.project || '').trim()) {
    throw contextBindingError('CONTEXT_BINDING_MISMATCH', 'contextBinding target does not match the resolved active root and project.')
  }
  const authorization = authorizeContextRead({
    activeRoot: target.activeRoot,
    project: target.project,
    contextBinding: binding,
    requestedSources: requested.sourceIds,
    requestedSections: requested.sections
  })
  if (authorization.status !== 'authorized') {
    throw contextBindingError(
      authorization.errorCode || 'CONTEXT_BINDING_INVALID',
      authorization.message || 'Context read authorization failed.'
    )
  }
  return authorization
}

function resolveContextReadBinding(binding, target) {
  return resolveContextReadAuthorization(binding, target).binding
}

// ─── Tool handlers ────────────────────────────────────────────────────────────

function contextPlanResult(value, skillRoute = null) {
  const isError = value?.schemaVersion === CONTEXT_READ_CONTRACT.schemas.error
  return {
    content: [
      { type: 'text', text: JSON.stringify(value, null, 2) },
      ...(skillRoute?.injectionText
        ? [{ type: 'text', text: skillRoute.injectionText }]
        : [])
    ],
    _meta: {
      devcodexRuntimeProcessIdentity: PROFILE_PROCESS_IDENTITY,
      ...(skillRoute
        ? {
            devcodexSkillRouteBootstrap: {
              schemaVersion: 'ContextPlanSkillRouteBootstrapV1',
              status: skillRoute.status,
              source: skillRoute.source,
              turnBinding: skillRoute.bootstrap?.turnBinding || null,
              bootstrapDigest: skillRoute.bootstrap?.bootstrapDigest || null,
              errorCode: skillRoute.errorCode || null
            }
          }
        : {})
    },
    ...(isError ? { isError: true } : {})
  }
}

function contextPlanSkillRouteBootstrap(plan, target, args = {}) {
  if (!plan || plan.schemaVersion !== CONTEXT_READ_CONTRACT.schemas.plan ||
      !target?.project || target.project === WORKSPACE_CONTEXT_PROJECT) {
    return null
  }
  const contextEpoch = String(plan.contextBinding?.contextEpoch || '').trim()
  const host = String(args.host || process.env.DEVCODEX_HOST_PLATFORM || DEFAULT_AGENT).trim().toLowerCase()
  const hasExplicitSkillId = Object.prototype.hasOwnProperty.call(args, 'explicitSkillId')
  const explicitSkillId = hasExplicitSkillId ? String(args.explicitSkillId || '').trim() : null
  if (!contextEpoch || !host || host === 'unknown-agent') return null
  try {
    const turnBinding = deriveTurnBinding(target.project, target.activeRoot, contextEpoch)
    try {
      const existing = loadEnvelope(target.activeRoot, turnBinding)
      const existingExplicitSkillId = existing.envelope.state?.explicit?.requestedSkillId || null
      if (hasExplicitSkillId && existingExplicitSkillId !== explicitSkillId) {
        const mismatch = new Error('BOOTSTRAP_IDENTITY_COLLISION')
        mismatch.code = 'BOOTSTRAP_IDENTITY_COLLISION'
        throw mismatch
      }
      if (existing.envelope.state?.decision) {
        return {
          status: 'reused-active-route',
          source: 'existing-route-envelope',
          bootstrap: existing.envelope.state.bootstrap,
          injectionText: ''
        }
      }
      const bootstrap = existing.envelope.state?.bootstrap
      return {
        status: 'ready',
        source: 'existing-route-envelope',
        bootstrap,
        injectionText: formatSkillRouteBootstrapInjection(bootstrap, { host })
      }
    } catch (error) {
      if (error.code !== 'TURN_NOT_FOUND') throw error
    }
    const hostVariant = String(process.env.DEVCODEX_HOST_VARIANT || host).trim()
    const route = bootstrapSkillRouteForTurn({
      project: target.project,
      contextEpoch,
      host,
      cwd: INPUT_ROOT,
      ...(hasExplicitSkillId ? { explicitSkillId } : {})
    }, {
      inputRoot: INPUT_ROOT,
      env: process.env,
      hostVariant,
      hostAdapterDigest: getLifecycleHostAdapterDigest(hostVariant, {
        env: process.env
      }),
      runtimeRole: 'profile-mcp'
    })
    return {
      status: route.active === true ? 'ready' : 'inactive',
      source: 'profile-context-plan-fallback',
      bootstrap: route.bootstrap,
      injectionText: route.injectionText || ''
    }
  } catch (error) {
    return {
      status: 'error',
      source: 'profile-context-plan-fallback',
      bootstrap: null,
      injectionText: [
        '### DevCodex · SkillRouteBootstrapErrorV1',
        `errorCode: ${String(error.code || error.message || 'SKILL_ROUTE_BOOTSTRAP_FAILED')}`,
        'Do not invent a turnBinding or claim that Skill routing completed.'
      ].join('\n'),
      errorCode: String(error.code || error.message || 'SKILL_ROUTE_BOOTSTRAP_FAILED')
    }
  }
}

function handleProfileContextPlan(args = {}) {
  const unknown = Object.keys(args).filter(key => !CONTEXT_PLAN_ARG_FIELDS.has(key))
  if (unknown.length) {
    return contextPlanResult(buildContextReadError(
      'CONTEXT_PLAN_INVALID',
      `Unsupported profile_context_plan fields: ${unknown.join(', ')}.`,
      'Remove fields outside the published input schema.'
    ))
  }
  if (args.changeTypes !== undefined && !Array.isArray(args.changeTypes)) {
    return contextPlanResult(buildContextReadError('CONTEXT_PLAN_INVALID', 'changeTypes must be an array.'))
  }
  if (args.profileSelectors !== undefined && !Array.isArray(args.profileSelectors)) {
    return contextPlanResult(buildContextReadError('CONTEXT_PLAN_INVALID', 'profileSelectors must be an array.'))
  }
  for (const field of ['explicitFull', 'configLocalRequested', 'crossService']) {
    if (args[field] !== undefined && typeof args[field] !== 'boolean') {
      return contextPlanResult(buildContextReadError('CONTEXT_PLAN_INVALID', `${field} must be boolean.`))
    }
  }
  if (args.contextEpoch !== undefined && !String(args.contextEpoch || '').trim()) {
    return contextPlanResult(buildContextReadError('CONTEXT_PLAN_INVALID', 'contextEpoch must be non-empty when supplied.'))
  }
  if (args.explicitSkillId !== undefined &&
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(args.explicitSkillId || '').trim())) {
    return contextPlanResult(buildContextReadError(
      'CONTEXT_PLAN_INVALID',
      'explicitSkillId must be a non-empty canonical Skill id when supplied.'
    ))
  }
  if (args.scope !== undefined && !['project', 'workspace'].includes(args.scope)) {
    return contextPlanResult(buildContextReadError('CONTEXT_PLAN_INVALID', 'scope must be project or workspace.'))
  }
  if (args.scope === 'workspace' && args.project !== undefined) {
    return contextPlanResult(buildContextReadError(
      'CONTEXT_PLAN_INVALID',
      'project must be omitted when scope is workspace.',
      'Use scope:"workspace" by itself, or use scope:"project" with one project.'
    ))
  }

  const epoch = getContextPlanEpoch(args.contextEpoch)
  const seed = normalizeIntentSeed({
    schemaVersion: CONTEXT_READ_CONTRACT.schemas.intentSeed,
    contextEpoch: epoch.contextEpoch,
    semantic: args.intent,
    targetHint: typeof args.project === 'string' && args.project.trim() ? args.project.trim() : null,
    continuationHint: args.intent === 'resume',
    riskHint: args.risk || 'normal',
    confidence: args.confidence,
    createdAt: epoch.createdAt
  })
  if (seed.schemaVersion === CONTEXT_READ_CONTRACT.schemas.error) return contextPlanResult(seed)
  const changeTypes = Array.isArray(args.changeTypes) ? args.changeTypes : []
  if (new Set(changeTypes).size !== changeTypes.length || changeTypes.some(item => !CONTEXT_READ_CONTRACT.changeTypes.includes(item))) {
    return contextPlanResult(buildContextReadError('CONTEXT_PLAN_INVALID', 'changeTypes contains an unsupported or duplicate value.'))
  }
  const suppliedRouteFields = CONTEXT_PLAN_ROUTE_FIELDS
    .filter(field => Object.prototype.hasOwnProperty.call(args, field))
  if (suppliedRouteFields.length !== 0 && suppliedRouteFields.length !== CONTEXT_PLAN_ROUTE_FIELDS.length) {
    const missing = CONTEXT_PLAN_ROUTE_FIELDS.filter(field => !suppliedRouteFields.includes(field))
    return contextPlanResult(buildContextReadError(
      'WORKFLOW_ROUTE_UNRESOLVED',
      `routeKey, subtype, and stage are an all-or-none route identity; missing: ${missing.join(', ')}.`,
      'Provide all three registry-owned route fields or omit all three for the compatibility default.'
    ))
  }
  for (const [field, maxLength] of [['routeKey', 128], ['subtype', 128], ['stage', 64]]) {
    if (!suppliedRouteFields.includes(field)) continue
    const value = args[field]
    if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > maxLength) {
      return contextPlanResult(buildContextReadError(
        'WORKFLOW_ROUTE_UNRESOLVED',
        `${field} must be a canonical non-empty string no longer than ${maxLength} characters.`,
        'Use the exact route identity published by WorkflowRootRegistryV2.'
      ))
    }
  }
  let workflowRoute
  try {
    const resolved = resolveWorkflowRouteDescriptor({
      topIntent: seed.semantic,
      changeTypes,
      ...(suppliedRouteFields.length
        ? {
            routeKey: args.routeKey,
            subtype: args.subtype,
            stage: args.stage
          }
        : {})
    }, { registry: STATIC_WORKFLOW_ROUTE_REGISTRY_V2 })
    workflowRoute = {
      routeKey: resolved.routeKey,
      subtype: resolved.route.subtype,
      stage: resolved.stage
    }
  } catch (error) {
    return contextPlanResult(buildContextReadError(
      'WORKFLOW_ROUTE_UNRESOLVED',
      String(error?.message || error),
      'Use one active registry-owned route whose intent, subtype, and stage match exactly.'
    ))
  }
  if (seed.confidence >= 0.6 && !['chat', 'resume'].includes(seed.semantic) && !changeTypes.length && args.explicitFull !== true) {
    return contextPlanResult(buildContextReadError(
      'CONTEXT_CHANGE_TYPES_REQUIRED',
      'High-confidence non-chat work requires changeTypes or explicitFull.',
      'Provide precise changeTypes before reading Profile context.'
    ))
  }
  if (args.explicitFull === true && !String(args.fullReadReason || '').trim()) {
    return contextPlanResult(buildContextReadError('CONTEXT_FULL_REASON_REQUIRED', 'Explicit full Profile reads require fullReadReason.'))
  }
  if (args.profileSelectors?.length && !String(args.baselineDigest || '').trim()) {
    return contextPlanResult(buildContextReadError('CONTEXT_BASELINE_STALE', 'profileSelectors require the current baselineDigest.'))
  }
  for (const selector of args.profileSelectors || []) {
    if (!selector || typeof selector !== 'object' || Array.isArray(selector)) {
      return contextPlanResult(buildContextReadError('CONTEXT_PLAN_INVALID', 'Each profile selector must be an object.'))
    }
    const unsupported = Object.keys(selector).filter(key => !['file', 'reason', 'authority'].includes(key))
    if (unsupported.length) {
      return contextPlanResult(buildContextReadError(
        'CONTEXT_PLAN_INVALID',
        `Unsupported profile selector fields: ${unsupported.join(', ')}.`
      ))
    }
    if (!String(selector.reason || '').trim() || !String(selector.authority || '').trim()) {
      return contextPlanResult(buildContextReadError(
        'CONTEXT_PLAN_INVALID',
        'Each profile selector requires non-empty reason and authority.'
      ))
    }
    try { assertSingleSegment(selector?.file, 'profile selector file') } catch (error) {
      return contextPlanResult(buildContextReadError('CONTEXT_PLAN_INVALID', error.message, 'Use a bounded top-level Profile file.'))
    }
    if (selector.file === 'config.local.json' && args.configLocalRequested !== true) {
      return contextPlanResult(buildContextReadError('CONTEXT_PLAN_INVALID', 'config.local.json requires explicit user or project policy.'))
    }
  }

  let target
  try {
    target = resolveProfilePlanTarget(args.project, args.scope)
  } catch (error) {
    return contextPlanResult(buildContextReadError(
      error.code || 'CONTEXT_ACTIVE_TARGET_MISMATCH',
      error.message,
      error.workspaceBinding?.error?.nextStep || 'Resolve one active project before planning Profile context.'
    ))
  }

  const startedAt = process.hrtime.bigint()
  try {
    const inputs = collectProfilePlanInputs(target)
    const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1e6
    const planInput = {
      intentSeed: { ...seed, targetHint: target.project },
      identity: {
        activeRoot: target.activeRoot,
        project: target.project,
        host: String(args.host || DEFAULT_AGENT),
        finalIntent: seed.semantic
      },
      changeTypes,
      workflowRoute,
      baselineContext: inputs.baselineContext,
      profileSelectors: args.profileSelectors,
      baselineDigest: args.baselineDigest,
      explicitFull: args.explicitFull === true,
      fullReadReason: args.fullReadReason,
      configLocalRequested: args.configLocalRequested === true,
      crossService: args.crossService === true,
      planningTelemetry: { latencyMs },
      stageTiming: { latencyMs, sourceReadMs: latencyMs }
    }
    let candidate = buildContextReadPlan(planInput)
    if (candidate.schemaVersion === CONTEXT_READ_CONTRACT.schemas.error) return contextPlanResult(candidate)
    const routeLoadRecipe = buildDevCodexRouteLoadRecipe(
      target.project,
      candidate.profile?.selectedFiles,
      candidate.fullRead
    )
    if (routeLoadRecipe) {
      candidate = buildContextReadPlan({ ...planInput, profileRouteLoadRecipe: routeLoadRecipe })
      if (candidate.schemaVersion === CONTEXT_READ_CONTRACT.schemas.error) return contextPlanResult(candidate)
    }
    const optimizationMode = resolveExecutionOptimizationBinding(candidate.executionOptimization)
    const plan = applyContextPlanComputationCache(
      candidate,
      target,
      resolveProfileOptimizationFeature(target.project, optimizationMode, 'context-computation-reuse')
    )
    const observation = persistContextPlanObservation({
      activeRoot: target.activeRoot,
      project: target.project,
      contextEpoch: epoch.contextEpoch,
      plan,
      producerIdentity: PROFILE_PROCESS_IDENTITY
    })
    if (observation.status !== 'persisted') {
      return contextPlanResult(buildContextReadError(
        'CONTEXT_PLAN_INVALID',
        `Exact context plan observation could not be persisted: ${observation.errorCode || observation.status}.`,
        'Repair the workspace runtime-state path or reduce the bounded Profile catalog, then retry once.'
      ))
    }
    return contextPlanResult(
      plan,
      contextPlanSkillRouteBootstrap(plan, target, args)
    )
  } catch (error) {
    const message = String(error?.message || '')
    const profileMissing = /Profile README\.md is missing/i.test(message)
    return contextPlanResult(buildContextReadError(
      error?.code === 'WORKFLOW_ROUTE_UNRESOLVED' ? 'WORKFLOW_ROUTE_UNRESOLVED' : 'CONTEXT_PLAN_INVALID',
      message,
      profileMissing
        ? 'Run devcodex init in the workspace root. After initialization completes, open a new host session and retry.'
        : 'Repair the Profile README/config baseline and retry once.'
    ))
  }
}

const DEFAULT_PROFILE_LOAD_MAX_FILES = 2
const DEFAULT_PROFILE_LOAD_MAX_BYTES = 32 * 1024

function profileLoadError(errorCode, message, nextStep, details = {}) {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ schemaVersion: 'ProfileLoadBudgetErrorV1', errorCode, message, nextStep, ...details }, null, 2)
    }],
    isError: true
  }
}

const PROFILE_SOURCE_RETRY_POLICY = Object.freeze({
  schemaVersion: 'ProfileSourceRetryPolicyV1',
  requiresReplan: true,
  maxRetries: 1,
  onSecondFailure: 'stop-without-body'
})

function profileSourceChangedError(sourcePath, reason, expected, observed) {
  const error = new Error(`Profile source changed before delivery: ${sourcePath} (${reason}).`)
  error.code = 'PROFILE_SOURCE_CHANGED'
  error.contextReadCode = 'PROFILE_SOURCE_CHANGED'
  error.details = {
    schemaVersion: 'ProfileSourceFinalIdentityFailureV1',
    status: 'failed',
    bodyDelivered: false,
    sourcePath,
    reason,
    expected,
    observed,
    retryPolicy: PROFILE_SOURCE_RETRY_POLICY
  }
  return error
}

function sameProfileSourceIdentity(left, right) {
  return !!left && !!right && left.dev === right.dev && left.ino === right.ino &&
    left.size === right.size && left.mtimeMs === right.mtimeMs
}

function observeProfileSourceSnapshot(expected) {
  let document
  try {
    document = readProfileTextDocument(expected.path, {
      maxBytes: Math.max(1, Number(expected.logicalBytes || 0))
    })
  } catch (error) {
    throw profileSourceChangedError(expected.path, error.code || 'final-read-failed', expected, {
      errorCode: error.code || null,
      message: error.message
    })
  }
  const observed = profileSourceSnapshot(expected.path, document)
  if (document.exists && !expected.sourceDigest && expected.sourcePrefixDigest) {
    const prefixBytes = Buffer.from(document.content, 'utf8').subarray(0, expected.sourceBytesRead)
    observed.sourcePrefixDigest = crypto.createHash('sha256').update(prefixBytes).digest('hex')
  }
  return observed
}

function verifyProfileSourceSnapshots(snapshots, options = {}) {
  const observer = typeof options.observe === 'function' ? options.observe : observeProfileSourceSnapshot
  const unique = new Map()
  for (const candidate of snapshots || []) {
    if (!candidate?.path) continue
    const key = process.platform === 'win32' ? path.resolve(candidate.path).toLowerCase() : path.resolve(candidate.path)
    const prior = unique.get(key)
    if (prior && (prior.sourceDigest !== candidate.sourceDigest || !sameProfileSourceIdentity(prior.identity, candidate.identity))) {
      throw profileSourceChangedError(candidate.path, 'initial-snapshot-conflict', prior, candidate)
    }
    unique.set(key, candidate)
  }
  const sources = []
  for (const expected of unique.values()) {
    const observed = observer(expected)
    let reason = null
    if (observed?.exists !== expected.exists) reason = 'existence-changed'
    else if (expected.exists && !sameProfileSourceIdentity(expected.identity, observed.identity)) reason = 'identity-changed'
    else if (expected.exists && expected.sourceDigest && expected.sourceDigest !== observed.sourceDigest) reason = 'content-digest-changed'
    else if (expected.exists && !expected.sourceDigest && expected.sourcePrefixDigest !== observed.sourcePrefixDigest) reason = 'content-prefix-digest-changed'
    if (reason) throw profileSourceChangedError(expected.path, reason, expected, observed)
    sources.push({
      path: expected.path,
      exists: expected.exists,
      logicalBytes: expected.logicalBytes,
      sourceDigest: expected.sourceDigest,
      sourcePrefixDigest: expected.sourcePrefixDigest,
      identity: expected.identity,
      status: 'verified'
    })
  }
  return {
    schemaVersion: 'ProfileSourceFinalIdentityReceiptV1',
    status: 'verified',
    sourceCount: sources.length,
    sources,
    retryPolicy: PROFILE_SOURCE_RETRY_POLICY
  }
}

function handleProfileLoad(args = {}, internal = {}) {
  if (args.files !== undefined && !Array.isArray(args.files)) {
    return profileLoadError('PROFILE_FILES_INVALID', 'files must be an array.', 'Pass a bounded array of top-level Profile filenames.')
  }
  for (const file of args.files || []) {
    try {
      const safeFile = assertSingleSegment(file, 'profile file')
      if (!/\.md$/i.test(safeFile) && !['config.json', 'config.local.json'].includes(safeFile)) {
        throw new Error('invalid profile file')
      }
    } catch (error) {
      return profileLoadError('PROFILE_FILE_INVALID', error.message, 'Use one top-level Profile Markdown or config filename.')
    }
  }
  const hasFiles = Array.isArray(args.files) && args.files.length > 0
  const explicitFull = args.explicitFull === true
  const bootstrapAuthorized = internal.bootstrapAuthority === PROFILE_INIT_BOOTSTRAP_AUTHORITY
  if (explicitFull && !hasFiles && !String(args.fullReadReason || '').trim()) {
    return profileLoadError(
      'PROFILE_FULL_REASON_REQUIRED',
      'explicitFull profile_load requires non-empty fullReadReason.',
      'Provide fullReadReason describing why tier full read is necessary.'
    )
  }
  let target
  let contextBinding
  let contextAuthorization = null
  try {
    target = resolveProfilePlanTarget(args.project, args.scope)
    if (bootstrapAuthorized) {
      if (!explicitFull || hasFiles) {
        throw contextBindingError(
          'PROFILE_BOOTSTRAP_AUTHORITY_INVALID',
          'The internal devcodex-init bootstrap authority is restricted to one explicit full Profile load.'
        )
      }
      contextBinding = {
        schemaVersion: 'ProfileBootstrapAuthorityV1',
        authority: 'devcodex-init',
        activeRoot: target.activeRoot,
        project: target.project,
        bindingStatus: 'bootstrap-authorized',
        verificationMode: 'internal-bootstrap'
      }
    } else {
      contextAuthorization = resolveContextReadAuthorization(args.contextBinding, target)
      contextBinding = contextAuthorization.binding
    }
  } catch (error) {
    return profileLoadError(
      error.contextReadCode || error.code || 'CONTEXT_BINDING_INVALID',
      error.message,
      error.workspaceBinding?.error?.nextStep || 'Regenerate the ContextReadPlanV2 for the resolved active target and pass its exact ContextReadBindingV1.'
    )
  }

  const suppliedSelectors = args.sectionSelectors === undefined ? [] : args.sectionSelectors
  if (!Array.isArray(suppliedSelectors)) {
    return profileLoadError('PROFILE_SECTION_SELECTORS_INVALID', 'sectionSelectors must be an array.', 'Pass one selector object per requested Profile file.')
  }
  const optimizationMode = resolveExecutionOptimizationBinding(args.executionOptimization)
  const featureDecision = resolveProfileOptimizationFeature(args.project, optimizationMode, 'profile-section-load', args.scope)
  let routeLoadRecipe = null
  if (!bootstrapAuthorized && !hasFiles && !explicitFull &&
      !suppliedSelectors.length && featureDecision.optimizationAllowed) {
    routeLoadRecipe = contextAuthorization.plan.profile?.routeLoadRecipe || null
  }
  if (!hasFiles && !explicitFull && !routeLoadRecipe) {
    return profileLoadError(
      'PROFILE_ROUTE_RECIPE_UNAVAILABLE',
      'profile_load without files has no verified bounded route recipe for this ContextReadBindingV1.',
      'Pass files: [...] for a targeted load, or regenerate the context plan that owns this binding.',
      {
        inventoryFiles: contextAuthorization?.plan?.profile?.selectedFiles || [],
        defaults: { maxFiles: DEFAULT_PROFILE_LOAD_MAX_FILES, maxBytes: DEFAULT_PROFILE_LOAD_MAX_BYTES }
      }
    )
  }
  const requested = hasFiles
    ? args.files
    : (routeLoadRecipe
        ? routeLoadRecipe.entries.map(entry => entry.file)
        : (bootstrapAuthorized
            ? resolveDefaultProfileFiles(target.project)
            : contextAuthorization.plan.selectedSources
              .filter(source => source.kind.startsWith('profile'))
              .map(source => source.selector)))
  const rawSelectors = featureDecision.optimizationAllowed
    ? (routeLoadRecipe
        ? routeLoadRecipe.entries.map(entry => ({
            file: entry.file,
            headingQueries: [...entry.headingQueries],
            requiredQueries: [...entry.requiredQueries],
            includePreamble: entry.includePreamble,
            includeDescendants: entry.includeDescendants,
            boundedOnly: entry.boundedOnly === true,
            maxBytes: entry.maxBytes
          }))
        : suppliedSelectors)
    : []
  if (rawSelectors.length && !hasFiles) {
    if (!routeLoadRecipe) {
      return profileLoadError(
        'PROFILE_SECTION_FILES_REQUIRED',
        'sectionSelectors require an explicit files list selected by the ContextReadPlan.',
        'Pass files: [...] and keep every selector.file inside that list.'
      )
    }
  }
  if (!bootstrapAuthorized) {
    try {
      contextAuthorization = resolveContextReadAuthorization(args.contextBinding, target, {
        sourceIds: requested.map(file => `profile:${file}`),
        sections: rawSelectors.map(selector => ({
          sourceId: `profile:${selector.file}`,
          headingQueries: selector.headingQueries,
          requireRouteRecipe: !!routeLoadRecipe
        }))
      })
      contextBinding = contextAuthorization.binding
    } catch (error) {
      return profileLoadError(
        error.contextReadCode || 'CONTEXT_BINDING_INVALID',
        error.message,
        'Regenerate a ContextReadPlanV2 that selects the requested Profile sources and retry once.'
      )
    }
  }
  const selectorByFile = new Map()
  for (const selector of rawSelectors) {
    const file = String(selector?.file || '').trim()
    if (!file || !Array.isArray(selector.headingQueries) || !selector.headingQueries.length) {
      return profileLoadError('PROFILE_SECTION_SELECTOR_INVALID', 'each section selector requires file and non-empty headingQueries.', 'Correct the selector and retry.')
    }
    if (!requested.includes(file)) {
      return profileLoadError('PROFILE_SECTION_FILE_NOT_SELECTED', `section selector file is not present in files: ${file}`, 'Add the file to the ContextReadPlan-selected files list or remove the selector.')
    }
    if (selectorByFile.has(file)) {
      return profileLoadError('PROFILE_SECTION_SELECTOR_DUPLICATE', `duplicate section selector for file: ${file}`, 'Merge heading queries into one selector per file.')
    }
    selectorByFile.set(file, selector)
  }
  // Explicit files list: load all named files (still hard-capped by maxBytes).
  // A verified plan-owned route recipe is the only no-files targeted path.
  const maxFiles = Number.isInteger(args.maxFiles) && args.maxFiles > 0
    ? args.maxFiles
    : (routeLoadRecipe ? routeLoadRecipe.maxFiles : (hasFiles || explicitFull ? requested.length : DEFAULT_PROFILE_LOAD_MAX_FILES))
  const maxBytes = Number.isInteger(args.maxBytes) && args.maxBytes >= 1024
    ? args.maxBytes
    : (routeLoadRecipe ? routeLoadRecipe.maxBytes : (explicitFull ? 512 * 1024 : DEFAULT_PROFILE_LOAD_MAX_BYTES))

  const selected = requested.slice(0, maxFiles)
  const deferred = requested.slice(maxFiles)
  const parts = []
  const missing = []
  let usedBytes = 0
  let truncatedByBytes = false
  let truncatedBySections = false
  const loaded = []
  const sectionReceipts = []
  const deliveredProfiles = []
  let sourceBytesRead = 0

  for (let selectedIndex = 0; selectedIndex < selected.length; selectedIndex += 1) {
    const name = selected[selectedIndex]
    const selector = selectorByFile.get(name)
    if (sourceBytesRead >= PROFILE_AGGREGATE_SOURCE_MAX_BYTES) {
      return profileLoadError(
        'SOURCE_TOO_LARGE',
        `The aggregate Profile source read budget is exhausted before ${name}.`,
        'Reduce the selected source set or use narrower section selectors, then retry.',
        {
          file: name,
          maxAggregateSourceBytes: PROFILE_AGGREGATE_SOURCE_MAX_BYTES,
          sourceBytesRead
        }
      )
    }
    let resolved
    try {
      const remainingAggregateSourceBytes = Math.max(
        1,
        PROFILE_AGGREGATE_SOURCE_MAX_BYTES - sourceBytesRead
      )
      resolved = selector
          ? resolveProfileSectionFile(name, target.project, {
            selector: {
              ...selector,
              maxBytes: Math.min(
                Number.isInteger(selector.maxBytes) ? selector.maxBytes : maxBytes,
                Math.max(1, maxBytes - usedBytes)
              )
            },
            maxScanBytes: Math.min(PROFILE_SOURCE_MAX_BYTES, remainingAggregateSourceBytes),
            maxTotalSourceBytes: remainingAggregateSourceBytes,
            captureMissingSnapshots: true
          })
        : resolveProfileFile(name, target.project, {
            maxBytes: Math.min(PROFILE_SOURCE_MAX_BYTES, remainingAggregateSourceBytes),
            captureMissingSnapshots: true
          })
    } catch (error) {
      if (['SOURCE_TOO_LARGE', 'SOURCE_NOT_REGULAR_FILE', 'SOURCE_INVALID_UTF8', 'SOURCE_CHANGED_DURING_READ'].includes(error.code)) {
        return profileLoadError(
          error.code,
          error.message,
          'Reduce or split the Profile source, then regenerate the ContextReadPlanV2 and retry.',
          {
            file: name,
            logicalBytes: error.logicalBytes ?? null,
            maxSourceBytes: error.maxBytes || PROFILE_SOURCE_MAX_BYTES,
            maxAggregateSourceBytes: PROFILE_AGGREGATE_SOURCE_MAX_BYTES,
            sourceBytesRead: error.sourceBytesRead || 0
          }
        )
      }
      throw error
    }
    if (resolved?.exists === true) {
      const resolvedSourceBytes = Number(resolved.sourceBytesRead || Buffer.byteLength(resolved.content || '', 'utf8'))
      if (sourceBytesRead + resolvedSourceBytes > PROFILE_AGGREGATE_SOURCE_MAX_BYTES) {
        return profileLoadError(
          'SOURCE_TOO_LARGE',
          `Profile sources exceed the ${PROFILE_AGGREGATE_SOURCE_MAX_BYTES}-byte aggregate read budget.`,
          'Reduce the selected source set or use narrower section selectors, then retry.',
          {
            file: name,
            maxAggregateSourceBytes: PROFILE_AGGREGATE_SOURCE_MAX_BYTES,
            sourceBytesRead: sourceBytesRead + resolvedSourceBytes
          }
        )
      }
      sourceBytesRead += resolvedSourceBytes
      const sourceLines = [`> 来源：${resolved.sourceLabel}`]
      for (const sourcePath of resolved.sourcePaths || []) {
        sourceLines.push(`> 路径：${sourcePath}`)
      }
      const header = `### ${name}\n\n${sourceLines.join('\n')}\n\n`
      const separator = parts.length ? '\n\n---\n\n' : ''
      const pieceBudget = maxBytes - usedBytes - Buffer.byteLength(separator + header, 'utf8')
      if (pieceBudget < 1) {
        truncatedByBytes = true
        deferred.unshift(name, ...selected.slice(selectedIndex + 1))
        break
      }
      const selection = resolved.selection || null
      if (routeLoadRecipe && selection) {
        const recipeEntry = routeLoadRecipe.entries.find(entry => entry.file === name)
        if (!recipeEntry || selection.receipt.completion !== 'complete' ||
            selection.receipt.selectedBytes > recipeEntry.maxBytes) {
          const recoveryRecipe = recipeEntry
            ? buildProfileRouteRecoveryRecipe(name, recipeEntry, selection.receipt)
            : null
          return profileLoadError(
            'PROFILE_ROUTE_RECIPE_BUDGET_EXCEEDED',
            `The bounded route recipe budget is exhausted for ${name}; it will not fall back to a full Profile body.`,
            'Use an explicit files+sectionSelectors follow-up with a justified bounded maxBytes, or narrow the requested headings.',
            {
              file: name,
              recipeDigest: routeLoadRecipe.recipeDigest,
              entryMaxBytes: recipeEntry?.maxBytes || null,
              sectionReceipt: selection.receipt,
              recoveryRecipe
            }
          )
        }
      }
      const body = selection ? selection.body : resolved.content
      const block = `${header}${body}`
      const blockBytes = Buffer.byteLength(separator + block, 'utf8')
      if (blockBytes > maxBytes - usedBytes) {
        if (routeLoadRecipe) {
          return profileLoadError(
            'PROFILE_ROUTE_RECIPE_BUDGET_EXCEEDED',
            `The bounded route recipe global budget is exhausted before ${name}; it will not fall back to a full Profile body.`,
            'Use an explicit files+sectionSelectors follow-up with a justified bounded maxBytes, or narrow the requested headings.',
            {
              file: name,
              recipeDigest: routeLoadRecipe.recipeDigest,
              usedBytes,
              blockBytes,
              maxBytes,
              minimumHeadroomBytes: routeLoadRecipe.minimumHeadroomBytes,
              recoveryRecipe: buildProfileRouteAggregateRecoveryRecipe(routeLoadRecipe, [
                ...sectionReceipts,
                ...(selection ? [selection.receipt] : [])
              ])
            }
          )
        }
        truncatedByBytes = true
        deferred.unshift(name, ...selected.slice(selectedIndex + 1))
        if (selection) sectionReceipts.push({ ...selection.receipt, bodyDelivered: false, deliveryCompletion: 'deferred-full-file' })
        break
      }
      usedBytes += blockBytes
      parts.push(block)
      loaded.push(name)
      deliveredProfiles.push({
        file: name,
        body,
        sourcePaths: resolved.sourcePaths || [],
        sourceSnapshots: resolved.sourceSnapshots || [],
        missing: false
      })
      if (selection) {
        sectionReceipts.push({ ...selection.receipt, bodyDelivered: true, deliveryCompletion: selection.receipt.completion })
        if (selection.receipt.completion === 'partial') {
          truncatedBySections = true
          deferred.push(name)
        }
      }
    } else {
      const placeholder = REQUIRED_FILES.has(name)
        ? `### ${name}\n\n（⚠️ 必需文件不存在）`
        : `### ${name}\n\n（文件不存在，跳过）`
      const separator = parts.length ? '\n\n---\n\n' : ''
      const placeholderBytes = Buffer.byteLength(separator + placeholder, 'utf8')
      if (placeholderBytes > maxBytes - usedBytes) {
        truncatedByBytes = true
        deferred.unshift(name, ...selected.slice(selectedIndex + 1))
        break
      }
      usedBytes += placeholderBytes
      parts.push(placeholder)
      if (REQUIRED_FILES.has(name)) missing.push(name)
      loaded.push(name)
      deliveredProfiles.push({
        file: name,
        body: '',
        sourcePaths: resolved?.sourcePaths || [],
        sourceSnapshots: resolved?.sourceSnapshots || [],
        missing: true
      })
    }
  }

  if (routeLoadRecipe && usedBytes > maxBytes - routeLoadRecipe.minimumHeadroomBytes) {
    return profileLoadError(
      'PROFILE_ROUTE_RECIPE_BUDGET_EXCEEDED',
      'The bounded route recipe consumed its reserved recovery headroom; no full Profile fallback was attempted.',
      'Use an explicit files+sectionSelectors follow-up with a justified bounded maxBytes, or narrow the requested headings.',
      {
        recipeDigest: routeLoadRecipe.recipeDigest,
        usedBytes,
        maxBytes,
        minimumHeadroomBytes: routeLoadRecipe.minimumHeadroomBytes,
        remainingBytes: maxBytes - usedBytes,
        recoveryRecipe: buildProfileRouteAggregateRecoveryRecipe(routeLoadRecipe, sectionReceipts)
      }
    )
  }

  let text = parts.join('\n\n---\n\n')
  const meta = {
    schemaVersion: 'ProfileLoadReceiptV3',
    completion: missing.length ? 'failed' : (deferred.length > 0 || truncatedByBytes || truncatedBySections ? 'partial' : 'complete'),
    truncated: deferred.length > 0 || truncatedByBytes || truncatedBySections,
    loadedFiles: loaded,
    deferredFiles: [...new Set(deferred)],
    usedBytes,
    sourceBytesRead,
    maxSourceBytesPerFile: PROFILE_SOURCE_MAX_BYTES,
    maxAggregateSourceBytes: PROFILE_AGGREGATE_SOURCE_MAX_BYTES,
    maxFiles,
    maxBytes,
    explicitFull,
    routeLoadRecipe: routeLoadRecipe
      ? {
          schemaVersion: routeLoadRecipe.schemaVersion,
          recipeDigest: routeLoadRecipe.recipeDigest,
          planContentId: contextBinding.planContentId,
          minimumHeadroomBytes: routeLoadRecipe.minimumHeadroomBytes,
          remainingBytes: maxBytes - usedBytes,
          applied: true
        }
      : null,
    executionOptimizationMode: optimizationMode.effective,
    executionOptimizationBinding: optimizationMode.bindingValid ? 'verified' : 'missing-or-invalid-fail-closed',
    executionOptimizationFeature: {
      lifecycleState: featureDecision.lifecycleState,
      stateStatus: featureDecision.stateStatus,
      reasonCode: featureDecision.reasonCode
    },
    optimizationFallback: !featureDecision.optimizationAllowed && suppliedSelectors.length > 0
      ? 'full-profile-file'
      : null,
    sectionReceipts,
    contextBinding
  }
  if (meta.truncated) {
    text = `⚠️ profile_load 边界预算生效：已加载 ${loaded.length} 文件 / ${usedBytes} bytes（maxFiles=${maxFiles}, maxBytes=${maxBytes}）。待补读：${meta.deferredFiles.join('、') || 'section query'}。正文未在段落中间截断；请按 receipt 补读 deferred section 或整文件。\n\n---\n\n` + text
  }
  if (missing.length > 0) {
    text = `⚠️ 必需 Profile 文件缺失，AI 将以保守降级模式运行：${missing.join('、')}\n\n---\n\n` + text
  }
  let sourceFinalIdentity
  try {
    if (typeof internal.beforeFinalSourceVerification === 'function') {
      internal.beforeFinalSourceVerification({
        target,
        loadedFiles: [...loaded],
        sourceSnapshots: deliveredProfiles.flatMap(item => item.sourceSnapshots)
      })
    }
    sourceFinalIdentity = verifyProfileSourceSnapshots(
      deliveredProfiles.flatMap(item => item.sourceSnapshots)
    )
  } catch (error) {
    return profileLoadError(
      'PROFILE_SOURCE_CHANGED',
      error.message,
      'Discard this response, regenerate the ContextReadPlanV2, and retry once. If the retry also changes, stop without using any Profile body.',
      {
        loadReceipt: {
          schemaVersion: 'ProfileLoadReceiptV3',
          completion: 'failed',
          bodyDelivered: false,
          loadedFiles: loaded,
          retryPolicy: PROFILE_SOURCE_RETRY_POLICY
        },
        sourceFinalIdentity: error.details || null
      }
    )
  }
  meta.bodyDelivered = true
  meta.sourceFinalIdentity = sourceFinalIdentity
  let contextObservation
  if (bootstrapAuthorized) {
    contextObservation = {
      status: 'bootstrap-authorized',
      ledgerStatus: 'N/A',
      lifecycleStatus: 'N/A',
      receiptStatus: 'bootstrap-authorized',
      satisfiedSourceIds: [],
      missingSourceIds: []
    }
  } else {
    try {
      contextObservation = recordMcpContextSourceObservations({
        activeRoot: contextBinding.activeRoot,
        project: contextBinding.project,
        workspaceNamespace: LAYOUT.enabled,
        contextBinding,
        hostSessionId: String(process.env.DEVCODEX_HOST_SESSION_ID || ''),
        sourceResults: deliveredProfiles.map(item => {
          const contentIdentity = item.missing
            ? null
            : buildContentIdentity({
                sourceKey: `profile://${contextBinding.project}/${item.file}#delivered`,
                content: item.body,
                contractVersion: 'ProfileBodyV1'
              })
          return {
            sourceId: `profile:${item.file}`,
            sourceLayer: combineProfileLayers(contextBinding.project, item.sourcePaths),
            outcome: item.missing ? 'missing' : 'observed-success',
            successful: !item.missing,
            observable: true,
            transportSuccess: true,
            sourceRefsMatch: !item.missing && item.sourcePaths.length > 0,
            schemaMatch: contextBinding.bindingStatus === 'verified',
            targetMatch: contextBinding.bindingStatus === 'verified',
            contentIdentity,
            bodyObserved: !item.missing,
            bytes: Buffer.byteLength(item.body, 'utf8'),
            chars: item.body.length,
            hostDeliveredBytes: Buffer.byteLength(item.body, 'utf8')
          }
        })
      })
    } catch (error) {
      contextObservation = {
        status: 'degraded',
        errorCode: error.code || 'CONTEXT_SOURCE_OBSERVATION_FAILED',
        message: error.message
      }
    }
  }
  meta.contextObservation = {
    schemaVersion: 'ContextSourceObservationWriteReceiptV1',
    status: contextObservation?.status || 'degraded',
    errorCode: contextObservation?.errorCode || null,
    ledgerStatus: contextObservation?.ledgerStatus || null,
    lifecycleStatus: contextObservation?.lifecycleStatus || null,
    receiptStatus: contextObservation?.receiptStatus || null,
    contextSnapshotId: contextObservation?.contextSnapshotId || null,
    observationLease: contextObservation?.observationLease || null,
    satisfiedSourceIds: (contextObservation?.satisfiedSourceIds || []).slice(0, 20),
    missingSourceIds: (contextObservation?.missingSourceIds || []).slice(0, 20)
  }
  const hostSessionId = String(process.env.DEVCODEX_HOST_SESSION_ID || '').trim()
  const profileSourceDigest = stableDigest({
    planContentId: contextBinding.planContentId,
    loadedFiles: deliveredProfiles.map(item => ({
      file: item.file,
      missing: item.missing,
      bodyDigest: stableDigest(item.body),
      sourcePaths: item.sourcePaths
    })),
    sourceFinalIdentity,
    sectionReceipts,
    routeRecipeDigest: routeLoadRecipe?.recipeDigest || null,
    explicitFull
  })
  const deliveryDecision = contextObservation?.status === 'persisted'
    ? getContextDeliveryDecision({
        metaDir: resolveTaskRecoveryMetaDir({
          activeRoot: contextBinding.activeRoot,
          project: contextBinding.project,
          workspaceNamespace: LAYOUT.enabled
        }),
        activeRoot: contextBinding.activeRoot,
        project: contextBinding.project,
        conversationId: hostSessionId,
        contextEpoch: contextBinding.contextEpoch,
        sourceKey: `profile-load:${contextBinding.planContentId}`,
        sourceDigest: profileSourceDigest,
        bodyCarrier: 'profile-load-text-v1',
        bodyIdentity: text,
        bodyBytes: Buffer.byteLength(text, 'utf8')
      })
    : {
        schemaVersion: 'ContextDeliveryDecisionV2',
        status: 'full-delivery',
        reasonCode: 'context-observation-unverified',
        bodyDeliverySkipped: false,
        descriptor: null
      }
  meta.bodyDeliverySkipped = deliveryDecision.bodyDeliverySkipped === true
  meta.bodyDelivered = !meta.bodyDeliverySkipped
  meta.contextDelivery = {
    schemaVersion: deliveryDecision.schemaVersion,
    status: deliveryDecision.status,
    reasonCode: deliveryDecision.reasonCode,
    bodyDeliverySkipped: meta.bodyDeliverySkipped,
    observedAt: deliveryDecision.observedAt || null,
    deliveredBodyBytes: deliveryDecision.deliveredBodyBytes ?? Buffer.byteLength(text, 'utf8'),
    deduplicatedBodyBytes: deliveryDecision.deduplicatedBodyBytes || 0,
    tokenEquivalentEstimate: deliveryDecision.tokenEquivalentEstimate || null
  }
  if (meta.bodyDeliverySkipped) {
    text = [
      'ContextDeliveryReuseV2: the identical Profile body was already observed for this formal task, conversation, context epoch, and source identity.',
      `sourceDigest=${profileSourceDigest}`,
      'The body is omitted from this tool result. If any identity or source evidence changes, profile_load returns the full bounded body again.'
    ].join('\n')
  }
  text = `<!-- profile_load_budget ${JSON.stringify(meta)} -->\n\n` + text

  return {
    content: [{
      type: 'text',
      text
    }],
    _meta: {
      ...(deliveryDecision.descriptor ? { devcodexContextDelivery: deliveryDecision.descriptor } : {}),
      bodyDeliverySkipped: meta.bodyDeliverySkipped,
      contextDeliveryStatus: deliveryDecision.status
    }
  }
}

function handleProfileSkillPlan(args = {}) {
  let contextBinding
  try {
    contextBinding = resolveContextReadBinding(
      args.contextBinding,
      resolveProfilePlanTarget(args.project, args.scope)
    )
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          schemaVersion: 'BundleDecisionErrorV1',
          errorCode: error.contextReadCode || 'CONTEXT_BINDING_INVALID',
          message: error.message,
          nextStep: 'Regenerate the ContextReadPlanV2 for the resolved active target and pass its exact ContextReadBindingV1.'
        }, null, 2)
      }],
      isError: true
    }
  }
  const globalSkillRuntime = resolveGlobalSkillRuntimeRoot({
    runtimeRoot: path.resolve(__dirname, '..'),
    packageRoot: path.resolve(__dirname, '..')
  })
  const portfolioPath = globalSkillRuntime.portfolioPath
    ? path.resolve(globalSkillRuntime.portfolioPath)
    : null
  let portfolio
  try {
    if (!portfolioPath) {
      const error = new Error(globalSkillRuntime.errorCode || 'GLOBAL_SKILL_RUNTIME_ROOT_UNRESOLVED')
      error.code = globalSkillRuntime.errorCode || 'GLOBAL_SKILL_RUNTIME_ROOT_UNRESOLVED'
      throw error
    }
    portfolio = JSON.parse(fs.readFileSync(portfolioPath, 'utf8'))
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          schemaVersion: 'BundleDecisionErrorV1',
          errorCode: 'SKILL_PORTFOLIO_READ_FAILED',
          message: error.message,
          globalSkillRuntime,
          nextStep: 'Regenerate or deploy skills/portfolio.json, then retry profile_skill_plan.'
        }, null, 2)
      }],
      isError: true
    }
  }
  const {
    executionOptimization,
    contextBinding: _contextBinding,
    project: _project,
    scope: _scope,
    ...bundleArgs
  } = args
  const optimizationMode = resolveExecutionOptimizationBinding(executionOptimization)
  const featureDecision = resolveProfileOptimizationFeature(args.project, optimizationMode, 'skill-bundle', args.scope)
  const decision = buildBundleDecisionV2(portfolio, {
    ...bundleArgs,
    ...(!featureDecision.optimizationAllowed ? { hostCapability: 'unsupported' } : {})
  })
  const response = {
    ...decision,
    executionOptimization: {
      schemaVersion: featureDecision.schemaVersion,
      lifecycleState: featureDecision.lifecycleState,
      stateStatus: featureDecision.stateStatus,
      reasonCode: featureDecision.reasonCode,
      optimizationAllowed: featureDecision.optimizationAllowed
    },
    globalSkillRuntime,
    contextBinding
  }
  return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] }
}

function handleProfileGetMode(args = {}) {
  const resolved = resolveConfigFile(args.project)
  const raw = resolved?.content || null
  let mode = 'prod'
  let agent = DEFAULT_AGENT
  let profileAgent = null
  let agentSource = DEFAULT_AGENT === 'unknown-agent' ? 'unknown' : 'runtime'

  if (resolved?.config) {
    const cfg = resolved.config
    if (cfg.mode && typeof cfg.mode === 'string') mode = cfg.mode.toLowerCase() === 'dev' ? 'dev' : 'prod'
    profileAgent = normalizeAgent(cfg.agent) || null
    if (agent === 'unknown-agent' && profileAgent) {
      agent = profileAgent
      agentSource = 'profile-fallback'
    }
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        mode,
        agent,
        agentSource,
        profileAgent,
        configExists: raw !== null,
        sourceRoot: resolved ? resolved.fullPath : null,
        sourceRoots: resolved?.sourcePaths || [],
        layoutMode: LAYOUT.mode,
        workspaceRoot: LAYOUT.workspaceRoot,
        project: resolveProjectName(args.project) || null
      }, null, 2)
    }]
  }
}

function handlePromptsList() {
  return { prompts: PROMPTS }
}

function handlePromptsGet(args) {
  if (args.name !== 'devcodex-init') {
    throw Object.assign(new Error(`Unknown prompt: ${args.name}`), { code: -32601 })
  }

  const runtimeKernel = readRuntimeKernelText()

  const project = args.arguments?.project
  if (LAYOUT.enabled && !project && !CONTEXT_PROJECT) {
    throw new Error('project is required for devcodex-init when MCP runs from workspace root')
  }

  // 复用 handleProfileLoad：init prompt 需要档位全量，显式 full + 原因
  const profileResponse = handleProfileLoad({
    project,
    explicitFull: true,
    fullReadReason: 'devcodex-init prompt embeds tier Profile for onboarding',
    maxBytes: 512 * 1024
  }, {
    bootstrapAuthority: PROFILE_INIT_BOOTSTRAP_AUTHORITY
  })
  if (profileResponse.isError) {
    throw new Error(profileResponse.content?.[0]?.text || 'profile_load failed for devcodex-init')
  }
  const profileText = profileResponse.content[0].text

  const promptText = `请严格遵循以下工作流规范与项目配置执行后续任务：\n\n## 1. 核心规范 (user-global runtime kernel)\n\n来源：${runtimeKernel.path || 'unavailable'}\n\n${runtimeKernel.content}\n\n## 2. 项目专属配置 (Profile)\n\n${profileText}\n\n请在充分理解上述规范后，输出预检查块 (PC0~PC10) 并等待我的进一步指示。`

  return {
    description: PROMPTS[0].description,
    messages: [
      {
        role: 'user',
        content: { type: 'text', text: promptText }
      }
    ]
  }
}

// ─── MCP JSON-RPC dispatcher ──────────────────────────────────────────────────

function dispatch(method, params) {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {}, prompts: {} },
        serverInfo: SERVER_INFO
      }

    case 'tools/list':
      return { tools: TOOLS }

    case 'tools/call': {
      const name = params?.name
      const args = params?.arguments || {}
      try {
        switch (name) {
          case 'skill_route': {
            const result = handleSkillRoute(args, {
              inputRoot: INPUT_ROOT,
              env: process.env,
              sessionId: process.env.DEVCODEX_HOST_SESSION_ID || '',
              workspaceNamespace: LAYOUT.enabled
            })
            traceSkillRouteCall(args, result)
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
              structuredContent: result,
              _meta: {
                devcodexRuntimeProcessIdentity: PROFILE_PROCESS_IDENTITY,
                ...(result.delivery?.contextDelivery
                  ? { devcodexContextDelivery: result.delivery.contextDelivery }
                  : {}),
                bodyDeliverySkipped: result.delivery?.bodyDeliverySkipped === true
              },
              isError: result.ok !== true
            }
          }
          case 'profile_context_plan': return handleProfileContextPlan(args)
          case 'profile_load': return handleProfileLoad(args)
          case 'profile_skill_plan': return handleProfileSkillPlan(args)
          case 'profile_get_mode': return handleProfileGetMode(args)
          case 'profile_compose_entry_check': {
            const { composeEntryCheckBlock } = require('../scripts/lib/host-parity-scorecard.js')
            const entry = args.entry && typeof args.entry === 'object' && !Array.isArray(args.entry) ? args.entry : {}
            const languageContext = resolveLanguageContext({
              prompt: entry.prompt,
              taskContext: entry.languageContext || entry.taskLanguageContext,
              conversationContext: entry.conversationLanguageContext,
              workspacePreference: entry.workspacePreference,
              locale: entry.locale || process.env.LC_ALL || process.env.LANG || process.env.LANGUAGE || ''
            })
            const localeDecision = resolveVisibleLocale(languageContext)
            const english = localeDecision.renderedLanguage === 'en'
            const workflowRouting = resolveConfigFile(args.project).config?.extensions?.devcodex?.workflowRouting
            const precheckDecision = buildWorkflowPlanDecision({
              phase: 'precheck', prompt: entry.prompt, config: workflowRouting, facts: entry.facts
            })
            const postContextDecision = entry.postContextFacts
              ? buildWorkflowPlanDecision({
                  phase: 'post-context', prompt: entry.prompt, userIntent: precheckDecision.userIntent,
                  config: workflowRouting, facts: entry.postContextFacts, previousDecision: precheckDecision
                })
              : null
            const entryCheckModel = createEntryCheckModelV3({
              versionFacts: composeEntryVersionFacts(args.project),
              precheckDecision,
              postContextDecision,
              validationPlan: entry.validationPlan,
              continuation: entry.continuation || {
                nextStage: args.nextStep || 'bounded-context-read',
                automatic: false,
                userAction: english
                  ? 'Follow the entry guidance; use none when no action is required'
                  : '按入口提示继续；无需操作时为 none',
                correctionHint: english
                  ? 'State the workflow, design depth, or validation scope to change'
                  : '直接说明要调整的流程、方案深度或验证范围'
              },
              showPlan: entry.showPlan !== false && precheckDecision.showPlan !== false
            })
            const block = composeEntryCheckBlock({
              project: args.project,
              status: args.status,
              nextStep: args.nextStep,
              semanticDigest: args.semanticDigest,
              entryCheckModel,
              languageContext,
              audience: 'human'
            })
            return {
              content: [{ type: 'text', text: block }],
              structuredContent: {
                schemaVersion: 'EntryCheckComposeV3',
                block,
                entryCheckModel,
                languageContext,
                localeDecision: {
                  schemaVersion: localeDecision.schemaVersion,
                  requestedLanguage: localeDecision.requestedLanguage,
                  renderedLanguage: localeDecision.renderedLanguage,
                  confidence: localeDecision.confidence,
                  fallbackReason: localeDecision.fallbackReason
                },
                machineProjection: {
                  semanticDigest: String(args.semanticDigest || 'pending-entry-check'),
                  marker: `DevCodexVisibleEnvelopeV3 · entry-check · ${String(args.status || 'UNVERIFIED')} · ${String(args.semanticDigest || 'pending-entry-check')}`
                },
                note: 'Paste into the user-visible reply before substantive work. Grok hooks cannot inject this.'
              }
            }
          }
          default:
            throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32601 })
        }
      } catch (err) {
        const errorCode = typeof err.code === 'string' ? err.code : null
        return {
          content: [{ type: 'text', text: `Error: ${errorCode ? `${errorCode}: ` : ''}${err.message}` }],
          ...(err.workspaceBinding ? { structuredContent: err.workspaceBinding } : {}),
          isError: true
        }
      }
    }

    case 'prompts/list':
      return handlePromptsList()

    case 'prompts/get': {
      const args = params || {}
      try {
        return handlePromptsGet(args)
      } catch (err) {
        const errorCode = typeof err.code === 'string' ? err.code : null
        return {
          content: [{ type: 'text', text: `Error: ${errorCode ? `${errorCode}: ` : ''}${err.message}` }],
          ...(err.workspaceBinding ? { structuredContent: err.workspaceBinding } : {}),
          isError: true
        }
      }
    }

    default:
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 })
  }
}

// ─── bounded stdio transport ──────────────────────────────────────────────────

if (require.main === module) {
  createJsonLineServer({ dispatch, onEnd: () => process.exit(0) })
  process.on('SIGINT', () => process.exit(0))
  process.on('SIGTERM', () => process.exit(0))
}

module.exports = {
  dispatch,
  handleProfileLoad,
  profileSourceSnapshot,
  verifyProfileSourceSnapshots
}
