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
const { assertSingleSegment, resolveInside } = require('./path-guard')
const {
  PROFILE_BASE_FILES,
  PROFILE_RELEASE_FILES,
  buildBundleDecisionV2,
  detectProfileTier,
  filesForProfileTier,
  parseMarkdownTables
} = require('./profile-contract')
const { selectProfileSections } = require('./profile-section-selector.cjs')
const {
  CONTEXT_READ_CONTRACT,
  buildContextReadError,
  buildContextReadPlan,
  normalizeIntentSeed,
  stableDigest,
  validateContextReadPlan
} = require('../hooks/_runtime/context-read-contract.cjs')
const { buildContentIdentity, buildJsonContentIdentity, validateContentIdentity } = require('../hooks/_runtime/content-identity.cjs')
const { createRuntimeStateStore } = require('../hooks/_runtime/runtime-state-store.cjs')
const { persistContextPlanObservation } = require('../hooks/_runtime/context-plan-observation.cjs')
const { recordMcpContextSourceObservations } = require('../hooks/_runtime/context-source-observation.cjs')
const { resolveExecutionFeatureDecisionForCwd } = require('../hooks/_runtime/execution-optimization-routing.cjs')
const { resolveGlobalSkillRuntimeRoot } = require('../hooks/_runtime/global-skill-runtime-root.cjs')
const { handleSkillRoute } = require('../hooks/_runtime/skill-route-tool.cjs')
const { getBootRuntimeContractDigest } = require('../hooks/_runtime/skill-route-mode.cjs')
const { captureRuntimeProcessIdentity } = require('../hooks/_runtime/runtime-generation-identity.cjs')
const {
  findLayoutInfo,
  inferProjectFromCwd,
  namespaceRootPath,
  normalizeExecutionOptimizationMode,
  normalizeProjectNamespace,
  readJsonFile,
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

function traceSkillRouteCall(args, result) {
  const configured = String(process.env.DEVCODEX_SKILL_ROUTE_TRACE || '').trim()
  if (!configured) return
  const target = path.resolve(configured)
  const relative = path.relative(INPUT_ROOT, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return
  try {
    if (fs.existsSync(target) && fs.statSync(target).size > 256 * 1024) return
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.appendFileSync(target, `${JSON.stringify({
      schemaVersion: 'SkillRouteCallTraceV1',
      observedAt: new Date().toISOString(),
      request: args,
      response: {
        ok: result?.ok === true,
        op: result?.op || args?.op || null,
        errorCode: result?.errorCode || null,
        receiptSchema: result?.receipt?.schemaVersion || null,
        serializedBytes: result?.delivery?.serializedBytes || null
      }
    })}\n`, 'utf8')
  } catch {
    // Diagnostics must never alter Tool behavior.
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
      pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$'
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
    description: '渐进式 Skill 路由：catalog 建目录，commit 选 Skill，rebind 换绑，load_stage 分阶段加载，status 查状态；参数以 input schema 为准。',
    inputSchema: SKILL_ROUTE_INPUT_SCHEMA
  },
  {
    name: 'profile_context_plan',
    description: '按 canonical intent 与 changeTypes 生成 ContextReadPlanV2。稳定 planContentId 与单次 planId 分离；计划无损返回 README/index 与 effective non-local config，其余 Profile 文件仅收集顶层 metadata，不预读正文。',
    inputSchema: {
      type: 'object',
      required: ['intent'],
      properties: {
        intent: {
          type: 'string',
          enum: CONTEXT_READ_CONTRACT.intents,
          description: 'canonical top-level intent'
        },
        changeTypes: {
          type: 'array',
          uniqueItems: true,
          items: { type: 'string', enum: CONTEXT_READ_CONTRACT.changeTypes },
          description: '高置信非 chat/resume 任务必填；docs/testing/release 等均在此表达。'
        },
        contextEpoch: { type: 'string', minLength: 1 },
        project: { type: 'string' },
        host: { type: 'string' },
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
    description: '按计划、文件或 Markdown section 有界加载 Profile 正文。',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
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
    description: '按 Skill portfolio、依赖和预算生成只读 BundleDecisionV2。',
    inputSchema: {
      type: 'object',
      required: ['candidateIds'],
      properties: {
        project: { type: 'string' },
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
    description: '生成 PC0~PC7 portable 入口检查块。',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        status: { type: 'string' },
        nextStep: { type: 'string' },
        semanticDigest: { type: 'string' }
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readFileText(filePath) {
  try { return fs.readFileSync(filePath, 'utf8') } catch { return null }
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

function mergeConfig(workspaceConfig, projectConfig) {
  const merged = {}
  for (const source of [workspaceConfig, projectConfig]) {
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

const LAYOUT = findLayoutInfo(INPUT_ROOT)

function inferContextProject() {
  return inferProjectFromCwd(INPUT_ROOT, LAYOUT)
}

const CONTEXT_PROJECT = inferContextProject()

function resolveProjectName(projectName) {
  if (LAYOUT.enabled) {
    return normalizeProjectNamespace(projectName, {
      layout: LAYOUT,
      contextProject: CONTEXT_PROJECT,
      allowEmpty: true
    })
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

function resolveProfileFile(name, projectName) {
  const safeName = assertSingleSegment(name, 'profile file')
  if (!/\.md$/i.test(safeName) && safeName !== 'config.json' && safeName !== 'config.local.json') {
    throw new Error('invalid profile file')
  }
  if (safeName === 'config.json') return resolveConfigFile(projectName)

  if (!LAYOUT.enabled) {
    for (const dir of getLegacyProfileDirs(projectName)) {
      const fullPath = resolveInside(dir, safeName)
      const content = readFileText(fullPath)
      if (content !== null) {
        return {
          exists: true,
          content,
          fullPath,
          sourceLabel: getLegacySourceLabel(dir, projectName),
          sourcePaths: [fullPath]
        }
      }
    }
    return null
  }

  const projectDir = getProjectNamespaceProfileDir(projectName)
  const workspaceDir = getWorkspaceProfileDir()
  const projectPath = projectDir ? resolveInside(projectDir, safeName) : null
  const workspacePath = resolveInside(workspaceDir, safeName)

  if (projectPath) {
    const projectContent = readFileText(projectPath)
    if (projectContent !== null) {
      return {
        exists: true,
        content: projectContent,
        fullPath: projectPath,
        sourceLabel: `项目命名空间（${resolveProjectName(projectName)}）`,
        sourcePaths: [projectPath]
      }
    }
  }

  const workspaceContent = readFileText(workspacePath)
  if (workspaceContent !== null) {
    return {
      exists: true,
      content: workspaceContent,
      fullPath: workspacePath,
      sourceLabel: '工作区基座（workspace）',
      sourcePaths: [workspacePath]
    }
  }

  return null
}

function resolveConfigFile(projectName) {
  if (!LAYOUT.enabled) {
    for (const dir of getLegacyProfileDirs(projectName)) {
      const fullPath = path.join(dir, 'config.json')
      const content = readFileText(fullPath)
      if (content !== null) {
        return {
          exists: true,
          content,
          fullPath,
          sourceLabel: getLegacySourceLabel(dir, projectName),
          sourcePaths: [fullPath],
          config: readJsonFile(fullPath) || {}
        }
      }
    }
    return { exists: false, content: null, fullPath: null, sourceLabel: '未命中', sourcePaths: [], config: null }
  }

  const workspaceDir = getWorkspaceProfileDir()
  const projectDir = getProjectNamespaceProfileDir(projectName)
  const workspacePath = path.join(workspaceDir, 'config.json')
  const projectPath = projectDir ? path.join(projectDir, 'config.json') : null
  const workspaceConfig = readJsonFile(workspacePath)
  const projectConfig = projectPath ? readJsonFile(projectPath) : null
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
    config: exists ? merged : null
  }
}

const CONTEXT_PLAN_ARG_FIELDS = new Set([
  'intent', 'changeTypes', 'contextEpoch', 'project', 'host', 'risk', 'confidence',
  'profileSelectors', 'baselineDigest', 'explicitFull', 'fullReadReason',
  'configLocalRequested', 'crossService'
])
const CONTEXT_PLAN_EPOCHS = new Map()
const CONTEXT_CACHE_MAX_BYTES = 32 * 1024 * 1024
const CONTEXT_CACHE_MAX_ENTRIES = 4096

function resolveProfilePlanTarget(projectName) {
  if (LAYOUT.enabled) {
    const project = resolveProjectName(projectName)
    if (!project) throw new Error('project is required for profile_context_plan when MCP runs from workspace root')
    return {
      project,
      activeRoot: namespaceRootPath(LAYOUT.workspaceRoot, project)
    }
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

function resolveProfileOptimizationFeature(project, optimizationMode, featureId) {
  try {
    const target = resolveProfilePlanTarget(project)
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

function resolveContextReadBinding(binding, target) {
  if (binding === undefined || binding === null) {
    return {
      schemaVersion: 'ContextReadBindingV1',
      contextEpoch: null,
      planId: null,
      planContentId: null,
      activeRoot: target.activeRoot,
      project: target.project,
      bindingStatus: 'legacy-unbound',
      verificationMode: 'legacy-unbound'
    }
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
  return {
    schemaVersion: 'ContextReadBindingV1',
    contextEpoch: binding.contextEpoch.trim(),
    planId: binding.planId.trim(),
    planContentId: binding.planContentId.trim(),
    activeRoot: binding.activeRoot.trim(),
    project: binding.project.trim(),
    bindingStatus: 'verified',
    verificationMode: 'request-bound'
  }
}

// ─── Tool handlers ────────────────────────────────────────────────────────────

function contextPlanResult(value) {
  const isError = value?.schemaVersion === CONTEXT_READ_CONTRACT.schemas.error
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    _meta: {
      devcodexRuntimeProcessIdentity: PROFILE_PROCESS_IDENTITY
    },
    ...(isError ? { isError: true } : {})
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
    target = resolveProfilePlanTarget(args.project)
  } catch (error) {
    return contextPlanResult(buildContextReadError(
      'CONTEXT_ACTIVE_TARGET_MISMATCH',
      error.message,
      'Resolve one active project before planning Profile context.'
    ))
  }

  const startedAt = process.hrtime.bigint()
  try {
    const inputs = collectProfilePlanInputs(target)
    const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1e6
    const candidate = buildContextReadPlan({
      intentSeed: { ...seed, targetHint: target.project },
      identity: {
        activeRoot: target.activeRoot,
        project: target.project,
        host: String(args.host || DEFAULT_AGENT),
        finalIntent: seed.semantic
      },
      changeTypes,
      baselineContext: inputs.baselineContext,
      profileSelectors: args.profileSelectors,
      baselineDigest: args.baselineDigest,
      explicitFull: args.explicitFull === true,
      fullReadReason: args.fullReadReason,
      configLocalRequested: args.configLocalRequested === true,
      crossService: args.crossService === true,
      planningTelemetry: { latencyMs },
      stageTiming: { latencyMs, sourceReadMs: latencyMs }
    })
    if (candidate.schemaVersion === CONTEXT_READ_CONTRACT.schemas.error) return contextPlanResult(candidate)
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
    return contextPlanResult(plan)
  } catch (error) {
    const message = String(error?.message || '')
    const profileMissing = /Profile README\.md is missing/i.test(message)
    return contextPlanResult(buildContextReadError(
      'CONTEXT_PLAN_INVALID',
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

function handleProfileLoad(args = {}) {
  const hasFiles = Array.isArray(args.files) && args.files.length > 0
  const explicitFull = args.explicitFull === true
  if (!hasFiles && !explicitFull) {
    const inventory = resolveDefaultProfileFiles(args.project)
    return profileLoadError(
      'PROFILE_LOAD_BUDGET',
      'profile_load without files requires explicitFull=true and fullReadReason (hard budget; no silent full-tier load).',
      'Pass files: [...] for targeted load (default maxFiles=2, maxBytes=32768), or explicitFull+fullReadReason for tier full read.',
      { inventoryFiles: inventory, defaults: { maxFiles: DEFAULT_PROFILE_LOAD_MAX_FILES, maxBytes: DEFAULT_PROFILE_LOAD_MAX_BYTES } }
    )
  }
  if (explicitFull && !hasFiles && !String(args.fullReadReason || '').trim()) {
    return profileLoadError(
      'PROFILE_FULL_REASON_REQUIRED',
      'explicitFull profile_load requires non-empty fullReadReason.',
      'Provide fullReadReason describing why tier full read is necessary.'
    )
  }

  let contextBinding
  try {
    contextBinding = resolveContextReadBinding(args.contextBinding, resolveProfilePlanTarget(args.project))
  } catch (error) {
    return profileLoadError(
      error.contextReadCode || 'CONTEXT_BINDING_INVALID',
      error.message,
      'Regenerate the ContextReadPlanV2 for the resolved active target and pass its exact ContextReadBindingV1.'
    )
  }

  const requested = hasFiles ? args.files : resolveDefaultProfileFiles(args.project)
  const suppliedSelectors = args.sectionSelectors === undefined ? [] : args.sectionSelectors
  if (!Array.isArray(suppliedSelectors)) {
    return profileLoadError('PROFILE_SECTION_SELECTORS_INVALID', 'sectionSelectors must be an array.', 'Pass one selector object per requested Profile file.')
  }
  const optimizationMode = resolveExecutionOptimizationBinding(args.executionOptimization)
  const featureDecision = resolveProfileOptimizationFeature(args.project, optimizationMode, 'profile-section-load')
  const rawSelectors = featureDecision.optimizationAllowed ? suppliedSelectors : []
  if (rawSelectors.length && !hasFiles) {
    return profileLoadError(
      'PROFILE_SECTION_FILES_REQUIRED',
      'sectionSelectors require an explicit files list selected by the ContextReadPlan.',
      'Pass files: [...] and keep every selector.file inside that list.'
    )
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
  // No-files + explicitFull: tier full set. Otherwise default maxFiles=2.
  const maxFiles = Number.isInteger(args.maxFiles) && args.maxFiles > 0
    ? args.maxFiles
    : (hasFiles || explicitFull ? requested.length : DEFAULT_PROFILE_LOAD_MAX_FILES)
  const maxBytes = Number.isInteger(args.maxBytes) && args.maxBytes >= 1024
    ? args.maxBytes
    : (explicitFull ? 512 * 1024 : DEFAULT_PROFILE_LOAD_MAX_BYTES)

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

  for (let selectedIndex = 0; selectedIndex < selected.length; selectedIndex += 1) {
    const name = selected[selectedIndex]
    const resolved = resolveProfileFile(name, args.project)
    if (resolved) {
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
      const selector = selectorByFile.get(name)
      const selection = selector
        ? selectProfileSections({
          file: name,
          content: resolved.content,
          selector: {
            ...selector,
            maxBytes: Math.min(
              Number.isInteger(selector.maxBytes) ? selector.maxBytes : pieceBudget,
              pieceBudget
            )
          }
        })
        : null
      const body = selection ? selection.body : resolved.content
      const block = `${header}${body}`
      const blockBytes = Buffer.byteLength(separator + block, 'utf8')
      if (blockBytes > maxBytes - usedBytes) {
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
        sourcePaths: [],
        missing: true
      })
    }
  }

  let text = parts.join('\n\n---\n\n')
  const meta = {
    schemaVersion: 'ProfileLoadReceiptV2',
    completion: missing.length ? 'failed' : (deferred.length > 0 || truncatedByBytes || truncatedBySections ? 'partial' : 'complete'),
    truncated: deferred.length > 0 || truncatedByBytes || truncatedBySections,
    loadedFiles: loaded,
    deferredFiles: [...new Set(deferred)],
    usedBytes,
    maxFiles,
    maxBytes,
    explicitFull,
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
  let contextObservation
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
  meta.contextObservation = {
    schemaVersion: 'ContextSourceObservationWriteReceiptV1',
    status: contextObservation?.status || 'degraded',
    errorCode: contextObservation?.errorCode || null,
    ledgerStatus: contextObservation?.ledgerStatus || null,
    lifecycleStatus: contextObservation?.lifecycleStatus || null,
    receiptStatus: contextObservation?.receiptStatus || null,
    satisfiedSourceIds: (contextObservation?.satisfiedSourceIds || []).slice(0, 20),
    missingSourceIds: (contextObservation?.missingSourceIds || []).slice(0, 20)
  }
  text = `<!-- profile_load_budget ${JSON.stringify(meta)} -->\n\n` + text

  return {
    content: [{
      type: 'text',
      text
    }]
  }
}

function handleProfileSkillPlan(args = {}) {
  let contextBinding
  try {
    contextBinding = resolveContextReadBinding(args.contextBinding, resolveProfilePlanTarget(args.project))
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
  const { executionOptimization, contextBinding: _contextBinding, project: _project, ...bundleArgs } = args
  const optimizationMode = resolveExecutionOptimizationBinding(executionOptimization)
  const featureDecision = resolveProfileOptimizationFeature(args.project, optimizationMode, 'skill-bundle')
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
  })
  if (profileResponse.isError) {
    throw new Error(profileResponse.content?.[0]?.text || 'profile_load failed for devcodex-init')
  }
  const profileText = profileResponse.content[0].text

  const promptText = `请严格遵循以下工作流规范与项目配置执行后续任务：\n\n## 1. 核心规范 (user-global runtime kernel)\n\n来源：${runtimeKernel.path || 'unavailable'}\n\n${runtimeKernel.content}\n\n## 2. 项目专属配置 (Profile)\n\n${profileText}\n\n请在充分理解上述规范后，输出预检查块 (PC0~PC7) 并等待我的进一步指示。`

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
              env: process.env
            })
            traceSkillRouteCall(args, result)
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
              structuredContent: result,
              isError: result.ok !== true
            }
          }
          case 'profile_context_plan': return handleProfileContextPlan(args)
          case 'profile_load': return handleProfileLoad(args)
          case 'profile_skill_plan': return handleProfileSkillPlan(args)
          case 'profile_get_mode': return handleProfileGetMode(args)
          case 'profile_compose_entry_check': {
            const { composeEntryCheckBlock } = require('../scripts/lib/host-parity-scorecard.js')
            const block = composeEntryCheckBlock({
              project: args.project,
              status: args.status,
              nextStep: args.nextStep,
              semanticDigest: args.semanticDigest
            })
            return {
              content: [{ type: 'text', text: block }],
              structuredContent: {
                schemaVersion: 'EntryCheckComposeV1',
                block,
                note: 'Paste into the user-visible reply before substantive work. Grok hooks cannot inject this.'
              }
            }
          }
          default:
            throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32601 })
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
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
        return {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true
        }
      }
    }

    default:
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 })
  }
}

// ─── stdio transport ──────────────────────────────────────────────────────────

function sendResponse(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}

function sendError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')
}

let buffer = ''

process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  const lines = buffer.split('\n')
  buffer = lines.pop()
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let req
    try { req = JSON.parse(trimmed) } catch {
      sendError(null, -32700, 'Parse error')
      continue
    }
    try {
      const result = dispatch(req.method, req.params)
      if (req.id !== undefined) sendResponse(req.id, result)
    } catch (err) {
      if (req.id !== undefined) sendError(req.id, err.code || -32603, err.message)
    }
  }
})

process.stdin.on('end', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
