#!/usr/bin/env node
'use strict'

/**
 * DevCodex MCP Profile Server — local stdio process (no deployment needed)
 *
 * Implements MCP 2024-11-05 protocol over stdin/stdout (JSON-RPC 2.0).
 *
 * Tools:
 *   profile_context_plan — Build an intent-scoped Profile read plan without pre-reading selected documents
 *   profile_load     — Read all standard profile files for a project (including optional local overlay metadata)
 *   profile_get_mode — Return ENV_MODE (dev/prod) and resolved runtime agent
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { assertSingleSegment, resolveInside } = require('./path-guard')
const {
  PROFILE_BASE_FILES,
  PROFILE_RELEASE_FILES,
  detectProfileTier,
  filesForProfileTier,
  parseMarkdownTables
} = require('./profile-contract')
const {
  CONTEXT_READ_CONTRACT,
  buildContextReadError,
  buildContextReadPlan,
  normalizeIntentSeed
} = require('../hooks/_runtime/context-read-contract.cjs')
const {
  findLayoutInfo,
  inferProjectFromCwd,
  namespaceRootPath,
  normalizeProjectNamespace,
  readJsonFile,
  resolveLegacyProjectRoot
} = require('../hooks/_runtime/workspace-layout.cjs')

const INPUT_ROOT = process.argv[2]
  ? path.resolve(process.argv[2])
  : process.cwd()

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

const TOOLS = [
  {
    name: 'profile_context_plan',
    description: '按 canonical intent 与 changeTypes 生成 ContextReadPlanV1。计划无损返回 README/index 与 effective non-local config；其余 Profile 文件仅收集顶层 metadata，不预读正文。',
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
    description: '按需加载 Profile 文件正文。默认有 maxFiles/maxBytes 硬预算；省略 files 时须 explicitFull=true + fullReadReason，否则返回 inventory/错误（禁止默认真全量）。',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: '可选。指定目标项目命名空间。旧布局下仅允许当前项目；集中布局下命中 <workspace>/.devcodex/<project-namespace>/profile 并按 workspace base + project overlay 解析。'
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: '指定要加载的文件名列表（如 ["01-项目信息.md"]）；省略时须 explicitFull'
        },
        maxFiles: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: '单次最多加载文件数，默认 2（explicitFull 时放宽到档位全集）'
        },
        maxBytes: {
          type: 'integer',
          minimum: 1024,
          maximum: 2000000,
          description: '单次拼接正文最大字节，默认 32768；超限截断并 truncated=true'
        },
        explicitFull: {
          type: 'boolean',
          description: 'true 时允许无 files 的档位全量 load（仍受 maxBytes）'
        },
        fullReadReason: {
          type: 'string',
          description: 'explicitFull=true 时必填原因'
        }
      }
    }
  },
  {
    name: 'profile_get_mode',
    description: '从 .devcodex/profile/config.json 读取 ENV_MODE（dev 或 prod），并返回当前实际宿主 agent；config.json 的 agent 仅作为兜底提示。',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: '可选。指定目标项目命名空间。旧布局下仅允许当前项目；集中布局下命中 <workspace>/.devcodex/<project-namespace>/profile 并按 workspace base + project overlay 解析。'
        }
      }
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

// ─── Tool handlers ────────────────────────────────────────────────────────────

function contextPlanResult(value) {
  const isError = value?.schemaVersion === CONTEXT_READ_CONTRACT.schemas.error
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
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
    return contextPlanResult(buildContextReadPlan({
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
      planningTelemetry: { latencyMs }
    }))
  } catch (error) {
    return contextPlanResult(buildContextReadError(
      'CONTEXT_PLAN_INVALID',
      error.message,
      'Repair the Profile README/config baseline and retry once.'
    ))
  }
}

const DEFAULT_PROFILE_LOAD_MAX_FILES = 2
const DEFAULT_PROFILE_LOAD_MAX_BYTES = 32 * 1024

function handleProfileLoad(args = {}) {
  const hasFiles = Array.isArray(args.files) && args.files.length > 0
  const explicitFull = args.explicitFull === true
  if (!hasFiles && !explicitFull) {
    const inventory = resolveDefaultProfileFiles(args.project)
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          schemaVersion: 'ProfileLoadBudgetErrorV1',
          errorCode: 'PROFILE_LOAD_BUDGET',
          message: 'profile_load without files requires explicitFull=true and fullReadReason (hard budget; no silent full-tier load).',
          nextStep: 'Pass files: [...] for targeted load (default maxFiles=2, maxBytes=32768), or explicitFull+fullReadReason for tier full read.',
          inventoryFiles: inventory,
          defaults: { maxFiles: DEFAULT_PROFILE_LOAD_MAX_FILES, maxBytes: DEFAULT_PROFILE_LOAD_MAX_BYTES }
        }, null, 2)
      }],
      isError: true
    }
  }
  if (explicitFull && !hasFiles && !String(args.fullReadReason || '').trim()) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          schemaVersion: 'ProfileLoadBudgetErrorV1',
          errorCode: 'PROFILE_FULL_REASON_REQUIRED',
          message: 'explicitFull profile_load requires non-empty fullReadReason.',
          nextStep: 'Provide fullReadReason describing why tier full read is necessary.'
        }, null, 2)
      }],
      isError: true
    }
  }

  const requested = hasFiles ? args.files : resolveDefaultProfileFiles(args.project)
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
  const loaded = []

  for (const name of selected) {
    const resolved = resolveProfileFile(name, args.project)
    if (resolved) {
      const sourceLines = [`> 来源：${resolved.sourceLabel}`]
      for (const sourcePath of resolved.sourcePaths || []) {
        sourceLines.push(`> 路径：${sourcePath}`)
      }
      let body = resolved.content
      const header = `### ${name}\n\n${sourceLines.join('\n')}\n\n`
      const pieceBudget = maxBytes - usedBytes - Buffer.byteLength(header, 'utf8') - 32
      if (pieceBudget <= 0) {
        truncatedByBytes = true
        deferred.unshift(name, ...selected.slice(selected.indexOf(name) + 1))
        break
      }
      const bodyBytes = Buffer.byteLength(body, 'utf8')
      if (bodyBytes > pieceBudget) {
        body = body.slice(0, Math.max(0, Math.floor(pieceBudget * 0.5))) + '\n\n…(truncated by maxBytes)…\n'
        truncatedByBytes = true
      }
      const block = `${header}${body}`
      usedBytes += Buffer.byteLength(block, 'utf8')
      parts.push(block)
      loaded.push(name)
      if (truncatedByBytes && bodyBytes > pieceBudget) {
        const rest = selected.slice(selected.indexOf(name) + 1)
        deferred.unshift(...rest)
        break
      }
    } else if (REQUIRED_FILES.has(name)) {
      parts.push(`### ${name}\n\n（⚠️ 必需文件不存在）`)
      missing.push(name)
      loaded.push(name)
    } else {
      parts.push(`### ${name}\n\n（文件不存在，跳过）`)
      loaded.push(name)
    }
  }

  let text = parts.join('\n\n---\n\n')
  const meta = {
    truncated: deferred.length > 0 || truncatedByBytes,
    loadedFiles: loaded,
    deferredFiles: [...new Set(deferred)],
    usedBytes,
    maxFiles,
    maxBytes,
    explicitFull
  }
  const metaBlock = `<!-- profile_load_budget ${JSON.stringify(meta)} -->\n\n`
  if (meta.truncated) {
    text = `⚠️ profile_load 硬预算生效：已加载 ${loaded.length} 文件 / ${usedBytes} bytes（maxFiles=${maxFiles}, maxBytes=${maxBytes}）。未读：${meta.deferredFiles.join('、') || '（字节截断）'}。请按需再次 profile_load(files)。\n\n---\n\n` + text
  }
  if (missing.length > 0) {
    text = `⚠️ 必需 Profile 文件缺失，AI 将以保守降级模式运行：${missing.join('、')}\n\n---\n\n` + text
  }
  text = metaBlock + text

  return {
    content: [{
      type: 'text',
      text
    }]
  }
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

  // 读取 CLAUDE.md
  const claudePath = path.join(LAYOUT.workspaceRoot, 'CLAUDE.md')
  let claudeContent = readFileText(claudePath)
  if (!claudeContent) {
    claudeContent = '（⚠️ 工作区根目录未找到 CLAUDE.md）'
  }

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

  const promptText = `请严格遵循以下工作流规范与项目配置执行后续任务：\n\n## 1. 核心规范 (CLAUDE.md)\n\n${claudeContent}\n\n## 2. 项目专属配置 (Profile)\n\n${profileText}\n\n请在充分理解上述规范后，输出预检查块 (PC0~PC7) 并等待我的进一步指示。`

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
          case 'profile_context_plan': return handleProfileContextPlan(args)
          case 'profile_load': return handleProfileLoad(args)
          case 'profile_get_mode': return handleProfileGetMode(args)
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
