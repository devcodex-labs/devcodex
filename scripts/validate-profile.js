#!/usr/bin/env node
/**
 * DevCodex — Profile drift detection (v1.9.5+)
 *
 * 检查项目级 .devcodex/profile/ 与 plugin 当前要求是否漂移：
 * - config.json 字段：mode / agent fallback hint / version 是否匹配 plugin.json
 * - config.local.json（如存在）是否符合用户 / 项目指定的本地 overlay schema / env 引用 / 扩展位规则
 * - README.md / 01-项目信息.md / 02-架构约束.md / 03-代码风格.md 是否存在
 *
 * Exit: 0=OK, 1=missing required, 2=drift warnings only
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const {
  PROFILE_DEFAULT_FILES,
  PROFILE_TIERS,
  extractProfileTierDeclarations,
  hasFeatureInventorySource: contractHasFeatureInventorySource,
  inspectProfileLifecycle,
  inspectFeatureInventoryDocument,
  parseMarkdownTables,
  FEATURE_INVENTORY_COLUMN_LABELS,
  FEATURE_INVENTORY_V1_COLUMNS
} = require('../mcp/profile-contract')
const { resolveProfileDir } = require('../hooks/_runtime/workspace-layout.cjs')
const {
  parseProfileCurrentTruth,
  validateDevCodexCurrentTruth
} = require('./lib/profile-current-truth')
const { buildCandidateIdentity } = require('./lib/validation-dag')

// ProfileGenerationContractGate / FeatureInventorySchemaGate / ProfileTierMigrationSafetyGate
// share the tier vocabulary: profile-lite | profile-standard | profile-closed-loop.
// ProfileLifecycleClassificationGate keeps the historical "conditional-required/local docs" contract anchor;
// user diagnostics expose its precise category key as "conditional-or-local-docs".

const PLUGIN_ROOT = path.resolve(__dirname, '..')
const args = process.argv.slice(2)

function argValue(name) {
  const index = args.indexOf(name)
  if (index === -1 || index + 1 >= args.length) return ''
  return args[index + 1]
}

const explicitProfileDir = argValue('--profile-dir')
const explicitWorkspaceProfileDir = argValue('--workspace-profile')
const explicitProjectRoot = argValue('--project-root')
const sourceRepoProfileFlag = args.includes('--source-repo-profile')
const cwd = explicitProjectRoot ? path.resolve(explicitProjectRoot) : process.cwd()

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function samePath(a, b) {
  if (!a || !b) return false
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
}

function deriveWorkspaceProfileDir(fromProfileDir) {
  let current = path.resolve(fromProfileDir)
  while (true) {
    if (path.basename(current).toLowerCase() === '.devcodex') {
      return path.join(current, 'workspace', 'profile')
    }
    const parent = path.dirname(current)
    if (parent === current) return ''
    current = parent
  }
}

const profileDir = explicitProfileDir ? path.resolve(explicitProfileDir) : resolveProfileDir(cwd)
const workspaceProfileDir = explicitWorkspaceProfileDir
  ? path.resolve(explicitWorkspaceProfileDir)
  : deriveWorkspaceProfileDir(profileDir)

const errors = []
const warnings = []
const pluginVersion = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'plugin.json'), 'utf8')).version
  } catch {
    return ''
  }
})()
function err(msg) { errors.push(msg) }
function warn(msg) { warnings.push(msg) }

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractVersion(label, text) {
  const safeLabel = escapeRegExp(label)
  const patterns = [
    new RegExp(`\\|\\s*\\*\\*${safeLabel}\\*\\*\\s*\\|\\s*v?(\\d+\\.\\d+\\.\\d+)`),
    new RegExp(`^\\s*[-*]\\s*${safeLabel}[：:]\\s*v?(\\d+\\.\\d+\\.\\d+)`, 'm')
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) return match[1]
  }
  return ''
}

function readFileIfExists(filePath) {
  return filePath && fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
}

function extractCurrentReleaseClaims(fileName, text) {
  const claims = []
  const patterns = fileName === '01-项目信息.md'
    ? [
        ['tag/publish 触发链', /\|\s*(?:\*\*)?tag\/publish 触发链(?:\*\*)?\s*\|\s*v?(\d+\.\d+\.\d+)/],
        ['registry/tag 验收', /\|\s*(?:\*\*)?registry\/tag 验收(?:\*\*)?\s*\|\s*v?(\d+\.\d+\.\d+)/]
      ]
    : fileName === '05-发布规范.md'
      ? [
          ['当前发布事实', /当前发布事实[：:][^\r\n]*?\bv?(\d+\.\d+\.\d+)/]
        ]
      : fileName === '07-用户文档与契约规范.md'
        ? [
            ['当前发布基线', /当前发布基线[：:][^\r\n]*?\bv?(\d+\.\d+\.\d+)/],
            ['版本语义契约', /\|\s*版本语义契约\s*\|[^\r\n]*?package\s+`?v?(\d+\.\d+\.\d+)/],
            ['当前发布分发', /\|\s*v?(\d+\.\d+\.\d+)\s+发布分发\s*\|/]
          ]
        : []
  for (const [label, pattern] of patterns) {
    const globalPattern = new RegExp(pattern.source, `${pattern.flags.replace(/g/g, '')}g`)
    for (const match of String(text || '').matchAll(globalPattern)) {
      claims.push({ label, version: match[1] })
    }
  }
  return claims
}

function compareSemver(left, right) {
  const a = String(left || '').split('.').map(Number)
  const b = String(right || '').split('.').map(Number)
  if (a.length !== 3 || b.length !== 3 || [...a, ...b].some(value => !Number.isInteger(value))) return 0
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1
  }
  return 0
}

function expectedValidationRouteCounts() {
  const manifestPath = path.join(PLUGIN_ROOT, 'scripts', 'validation-manifest.json')
  if (!fs.existsSync(manifestPath)) return null
  const { planValidation } = require('./lib/validation-dag')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const counts = { manifest: manifest.nodes.length }
  for (const route of ['fast', 'full', 'profile-deploy', 'package-release']) {
    counts[route] = planValidation({ manifest, route }).selectedNodeCount
  }
  return counts
}

function validationRouteCountSummary(counts) {
  return `validation-manifest ${counts.manifest} nodes / fast ${counts.fast} / full ${counts.full} / profile-deploy ${counts['profile-deploy']} / package-release ${counts['package-release']}`
}

function countFiles(root, predicate, options = {}) {
  if (!fs.existsSync(root)) return 0
  let count = 0
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (options.recursive) count += countFiles(path.join(root, entry.name), predicate, options)
      continue
    }
    if (entry.isFile() && predicate(entry.name)) count += 1
  }
  return count
}

function countDirectories(root, predicate) {
  if (!fs.existsSync(root)) return 0
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && predicate(entry.name))
    .length
}

function extractCurrentAssetCount(label, text) {
  const pattern = new RegExp(`\\|\\s*\\*\\*${escapeRegExp(label)}\\*\\*\\s*\\|\\s*(\\d+)\\s*\\|`)
  const match = String(text || '').match(pattern)
  return match ? Number(match[1]) : null
}

/** CurrentAssetInventoryTruthGate binds manually readable Profile counts to source inventory. */
function checkCurrentAssetInventoryTruth(projectInfoText) {
  if (!isSourceRepoProfileTarget() || !/当前规范资产清单/.test(projectInfoText)) return
  const expected = new Map([
    ['Agent', countFiles(path.join(PLUGIN_ROOT, 'agents'), name => name.endsWith('.agent.md'))],
    ['Skill', countDirectories(path.join(PLUGIN_ROOT, 'content', 'skills'), name => !name.startsWith('_'))],
    ['Instruction', countFiles(path.join(PLUGIN_ROOT, 'content', 'instructions'), name => name.endsWith('.instructions.md'))],
    ['Prompt', countFiles(path.join(PLUGIN_ROOT, 'content', 'prompts'), name => name.endsWith('.prompt.md'))],
    ['Hooks runtime', countFiles(path.join(PLUGIN_ROOT, 'hooks', '_runtime'), name => name.endsWith('.cjs'))],
    ['data 模板', countFiles(path.join(PLUGIN_ROOT, 'data', 'templates'), name => name.endsWith('.md'))],
    ['CLI 工程脚本', countFiles(path.join(PLUGIN_ROOT, 'scripts'), name => name.endsWith('.js'), { recursive: true })]
  ])
  for (const [label, actual] of expected) {
    const claimed = extractCurrentAssetCount(label, projectInfoText)
    if (claimed === null) {
      err(`[profile] CurrentAssetInventoryTruthGate missing current asset row: ${label}`)
    } else if (claimed !== actual) {
      err(`[profile] CurrentAssetInventoryTruthGate ${label} drift: ${claimed} → ${actual}`)
    }
  }
}

/** ValidationRouteTruthGate binds the Profile claim to the executable DAG instead of historical receipts. */
function checkValidationRouteTruth(inventoryResult) {
  if (!isSourceRepoProfileTarget() || !inventoryResult || !inventoryResult.valid) return
  const row = (inventoryResult.validRows || []).find(entry => entry.featureId === 'validation-execution')
  if (!row) return
  const rowText = Object.values(row).join(' ')
  let expected
  try {
    expected = expectedValidationRouteCounts()
  } catch (error) {
    err(`[profile] ValidationRouteTruthGate cannot read executable validation DAG: ${error.message}`)
    return
  }
  if (!expected) {
    err('[profile] ValidationRouteTruthGate missing scripts/validation-manifest.json')
    return
  }
  const summary = validationRouteCountSummary(expected)
  const claim = rowText.match(/validation-manifest\s+(\d+)\s+nodes\s*\/\s*fast\s+(\d+)\s*\/\s*full\s+(\d+)\s*\/\s*profile-deploy\s+(\d+)\s*\/\s*package-release\s+(\d+)/i)
  if (!claim) {
    warn(`[profile] ValidationRouteTruthGate validation-execution uses a legacy or missing count claim; expected: ${summary}`)
    return
  }
  const actual = {
    manifest: Number(claim[1]),
    fast: Number(claim[2]),
    full: Number(claim[3]),
    'profile-deploy': Number(claim[4]),
    'package-release': Number(claim[5])
  }
  if (Object.keys(actual).some(key => actual[key] !== expected[key])) {
    warn(`[profile] ValidationRouteTruthGate validation-execution count drift: ${validationRouteCountSummary(actual)} → ${summary}`)
  }
}

/** ProfileReleaseTruthAuthorityMatrixGate checks explicit current consumers only; historical release text is intentionally ignored. */
function checkProfileReleaseTruthAuthorityMatrix(projectInfoText) {
  if (!pluginVersion) return
  const directProjectInfoPath = path.join(profileDir, '01-项目信息.md')
  const directProjectInfo = readFileIfExists(directProjectInfoPath)
  // Real DevCodex project profiles declare npm package name `devcodex` (unscoped).
  // Keep legacy @vextjs/devcodex match for old fixtures; do not match bare "devcodex" words alone.
  const devcodexProject = isSourceRepoProfileTarget() ||
    /\|\s*\*\*npm 包名\*\*\s*\|\s*`devcodex`/.test(directProjectInfo) ||
    /@vextjs\/devcodex/.test(directProjectInfo)
  const checked = new Set()

  function checkClaim(source, label, version) {
    if (!version) return
    const key = `${source}:${label}:${version}`
    if (checked.has(key)) return
    checked.add(key)
    if (version !== pluginVersion) {
      warn(`[profile] ProfileReleaseTruthAuthorityMatrixGate ${source} ${label}漂移: ${version} → ${pluginVersion}`)
    }
  }

  if (devcodexProject) {
    checkClaim('01-项目信息.md', '当前版本', extractVersion('当前版本', projectInfoText))
    checkClaim('01-项目信息.md', '当前阶段', extractVersion('当前阶段', projectInfoText))
    for (const fileName of ['01-项目信息.md', '05-发布规范.md', '07-用户文档与契约规范.md']) {
      const directText = fileName === '01-项目信息.md'
        ? projectInfoText
        : readFileIfExists(path.join(profileDir, fileName))
      const claims = extractCurrentReleaseClaims(fileName, directText)
      const counts = new Map()
      for (const claim of claims) {
        counts.set(claim.label, (counts.get(claim.label) || 0) + 1)
        checkClaim(fileName, claim.label, claim.version)
      }
      for (const [label, count] of counts) {
        if (count > 1) warn(`[profile] ProfileReleaseTruthAuthorityMatrixGate ${fileName} duplicates current claim ${label}: ${count}`)
      }
    }
  }

  const workspaceInfoPath = workspaceProfileDir ? path.join(workspaceProfileDir, '01-项目信息.md') : ''
  const workspaceInfo = readFileIfExists(workspaceInfoPath)
  if (/DevCodex\s*工作区规范版本/.test(workspaceInfo)) {
    checkClaim('workspace/01-项目信息.md', '当前版本', extractVersion('当前版本', workspaceInfo))
    checkClaim('workspace/01-项目信息.md', '当前阶段', extractVersion('当前阶段', workspaceInfo))
  }
}

function hasLegacyStageDraft(text) {
  return /##\s*当前阶段/m.test(text) &&
    /^\s*[-*]\s*主版本分支[：:]/m.test(text) &&
    /^\s*[-*]\s*阶段摘要[：:]/m.test(text)
}

function isSourceRepoProfileTarget() {
  if (sourceRepoProfileFlag) return true
  return path.resolve(cwd) === PLUGIN_ROOT
}

function isActiveDevCodexProfileTarget() {
  return path.resolve(cwd) === PLUGIN_ROOT
}

function currentSourceGitHead() {
  if (!isActiveDevCodexProfileTarget()) return ''
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: PLUGIN_ROOT,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch {
    return ''
  }
}

function currentSourceCandidateId() {
  if (!isActiveDevCodexProfileTarget()) return ''
  try {
    return buildCandidateIdentity({ repoRoot: PLUGIN_ROOT }).candidateId
  } catch {
    return ''
  }
}

function profileFileInfo(fileName) {
  const directPath = path.join(profileDir, fileName)
  if (fs.existsSync(directPath)) {
    return { path: directPath, source: 'project' }
  }
  const fallbackPath = workspaceProfileDir ? path.join(workspaceProfileDir, fileName) : ''
  if (fallbackPath && !samePath(profileDir, workspaceProfileDir) && fs.existsSync(fallbackPath)) {
    return { path: fallbackPath, source: 'workspace fallback' }
  }
  return { path: directPath, source: 'missing' }
}

function hasProfileFile(fileName) {
  return profileFileInfo(fileName).source !== 'missing'
}

function hasAnyProfileFile(fileNames) {
  return fileNames.some(fileName => hasProfileFile(fileName))
}

function readProfileFile(fileName) {
  const info = profileFileInfo(fileName)
  if (info.source === 'missing') return ''
  return fs.readFileSync(info.path, 'utf8')
}

function profileCorpus(fileNames) {
  return fileNames
    .map(fileName => `\n--- ${fileName} ---\n${readProfileFile(fileName)}`)
    .join('\n')
}

function profileCorpusEntries(fileNames) {
  return fileNames.map(fileName => {
    const info = profileFileInfo(fileName)
    const text = info.source === 'missing' ? '' : fs.readFileSync(info.path, 'utf8')
    return { fileName, info, text }
  })
}

function extractExplicitProfileTiers(text) {
  return extractProfileTierDeclarations(text)
}

function hasCurrentAgentsDistribution(text) {
  return /GlobalOnlyHostConfigModeV1/.test(text) &&
    /GlobalOnlyWorkspaceCleanModeV1/.test(text) &&
    /npm install -g devcodex/.test(text) &&
    /(agents[^\n。]*(不向|不再向)[^\n。]*workspace|(不向|不再向)[^\n。]*workspace[^\n。]*agents|workspace[^\n。]*不生成[^\n。]*宿主)/i.test(text)
}

function checkProjectInfoSemantics(text) {
  if (/不再作为目标项目默认分发路径/.test(text)) {
    warn('[profile] 01-项目信息.md still contains legacy agents distribution wording')
  }
  if (!hasCurrentAgentsDistribution(text)) {
    warn('[profile] 01-项目信息.md missing current agents distribution truth')
  }
  if (/##\s*授权层级/m.test(text) || /\|\s*\*\*Free\*\*\s*\|/.test(text) || /\|\s*\*\*Pro\*\*\s*\|/.test(text)) {
    warn('[profile] 01-项目信息.md still contains legacy Free/Pro authorization tiers')
  }
  if (!/授权占位/.test(text) || !/全量开放/.test(text)) {
    warn('[profile] 01-项目信息.md missing current authorization placeholder truth')
  }
  if (!/website\/docs\/versions\/v1\/<active-version>\/requirements\//.test(text)) {
    warn('[profile] 01-项目信息.md missing current formal requirement entry')
  }
}

const STALE_S02_PROFILE_PATTERNS = [
  {
    pattern: /不改变 S02 对其他敏感信息的默认禁止规则/,
    message: '02-架构约束.md contains legacy S02 default-forbid wording'
  },
  {
    pattern: /\|\s*硬编码 API Key \/ Token \/ 密码\s*\|\s*S02 安全底线\s*\|/,
    message: '03-代码风格.md treats hardcoded API Key / Token / password as a default S02 violation'
  },
  {
    pattern: /禁止硬编码敏感信息/,
    message: 'Profile contains legacy hardcoded-sensitive-info prohibition wording'
  }
]

function checkS02ProfileFreshness(profileTexts) {
  const combined = Object.entries(profileTexts)
    .map(([name, text]) => `\n--- ${name} ---\n${text || ''}`)
    .join('\n')

  for (const { pattern, message } of STALE_S02_PROFILE_PATTERNS) {
    if (pattern.test(combined)) {
      warn(`[profile] ${message}; current S02 defaults allow sensitive information and hardcoding unless user/project policy explicitly restricts them`)
    }
  }
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const RESERVED_AUTO_ALIASES = new Set(['@devcodex', '@devcodex-auto', '@auto'])
const CONCURRENCY_MODES = new Set(['auto', 'serial'])
const CORE_SINGLE_WRITER_SCOPES = new Set([
  'active-root',
  'memory',
  'report',
  'ledger',
  'audit-session',
  'cp-state',
  'source-mutation',
  'package-boundary',
  'dangerous-operation'
])

function validateIntegerRange(value, sourceName, pathLabel, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    err(`[profile] ${sourceName}.${pathLabel} must be an integer between ${min} and ${max}`)
  }
}

function validateAutoAliases(autoAliases, sourceName) {
  if (autoAliases === undefined) return
  if (!Array.isArray(autoAliases)) {
    err(`[profile] ${sourceName}.extensions.devcodex.autoAliases must be an array`)
    return
  }
  const seen = new Set()
  for (let i = 0; i < autoAliases.length; i += 1) {
    const alias = autoAliases[i]
    if (typeof alias !== 'string') {
      err(`[profile] ${sourceName}.extensions.devcodex.autoAliases[${i}] must be a string`)
      continue
    }
    const normalized = alias.trim()
    const lower = normalized.toLowerCase()
    if (alias !== normalized) {
      err(`[profile] ${sourceName}.extensions.devcodex.autoAliases[${i}] must not contain leading or trailing whitespace`)
    }
    if (!/^@[A-Za-z][A-Za-z0-9_-]*$/.test(normalized) || normalized.length > 65) {
      err(`[profile] ${sourceName}.extensions.devcodex.autoAliases[${i}] must be an exact mention token like "@rocky"`)
    }
    if (RESERVED_AUTO_ALIASES.has(lower)) {
      err(`[profile] ${sourceName}.extensions.devcodex.autoAliases[${i}] is reserved: ${normalized}`)
    }
    if (seen.has(lower)) {
      err(`[profile] ${sourceName}.extensions.devcodex.autoAliases[${i}] duplicates another alias: ${normalized}`)
    }
    seen.add(lower)
  }
}

function validateConcurrencyLane(lane, sourceName, pathLabel, allowedKeys, maxParallelRange) {
  if (lane === undefined) return
  if (!isPlainObject(lane)) {
    err(`[profile] ${sourceName}.${pathLabel} must be an object`)
    return
  }
  for (const key of Object.keys(lane)) {
    if (!allowedKeys.has(key)) {
      err(`[profile] ${sourceName}.${pathLabel} contains unsupported key: ${key}`)
    }
  }
  if (lane.enabled !== undefined && typeof lane.enabled !== 'boolean') {
    err(`[profile] ${sourceName}.${pathLabel}.enabled must be a boolean`)
  }
  if (lane.allowAgents !== undefined && typeof lane.allowAgents !== 'boolean') {
    err(`[profile] ${sourceName}.${pathLabel}.allowAgents must be a boolean`)
  }
  if (lane.maxParallel !== undefined) {
    validateIntegerRange(lane.maxParallel, sourceName, `${pathLabel}.maxParallel`, maxParallelRange[0], maxParallelRange[1])
  }
}

function validateConcurrencyLocks(locks, sourceName) {
  if (locks === undefined) return
  if (!isPlainObject(locks)) {
    err(`[profile] ${sourceName}.extensions.devcodex.concurrency.locks must be an object`)
    return
  }
  for (const key of Object.keys(locks)) {
    if (key !== 'additionalSingleWriterScopes') {
      err(`[profile] ${sourceName}.extensions.devcodex.concurrency.locks contains unsupported key: ${key}`)
    }
  }
  const scopes = locks.additionalSingleWriterScopes
  if (scopes === undefined) return
  if (!Array.isArray(scopes)) {
    err(`[profile] ${sourceName}.extensions.devcodex.concurrency.locks.additionalSingleWriterScopes must be an array`)
    return
  }
  const seen = new Set()
  for (let i = 0; i < scopes.length; i += 1) {
    const scope = scopes[i]
    if (typeof scope !== 'string') {
      err(`[profile] ${sourceName}.extensions.devcodex.concurrency.locks.additionalSingleWriterScopes[${i}] must be a string`)
      continue
    }
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(scope)) {
      err(`[profile] ${sourceName}.extensions.devcodex.concurrency.locks.additionalSingleWriterScopes[${i}] must be kebab-case`)
    }
    if (CORE_SINGLE_WRITER_SCOPES.has(scope)) {
      err(`[profile] ${sourceName}.extensions.devcodex.concurrency.locks.additionalSingleWriterScopes[${i}] must not duplicate a core single-writer scope: ${scope}`)
    }
    if (seen.has(scope)) {
      err(`[profile] ${sourceName}.extensions.devcodex.concurrency.locks.additionalSingleWriterScopes[${i}] duplicates another additional scope: ${scope}`)
    }
    seen.add(scope)
  }
}

function validateConcurrencyPolicy(concurrency, sourceName) {
  if (concurrency === undefined) return
  if (!isPlainObject(concurrency)) {
    err(`[profile] ${sourceName}.extensions.devcodex.concurrency must be an object`)
    return
  }
  for (const key of Object.keys(concurrency)) {
    if (!['mode', 'readOnly', 'validation', 'locks'].includes(key)) {
      err(`[profile] ${sourceName}.extensions.devcodex.concurrency contains unsupported key: ${key}`)
    }
  }
  if (concurrency.mode !== undefined && !CONCURRENCY_MODES.has(concurrency.mode)) {
    err(`[profile] ${sourceName}.extensions.devcodex.concurrency.mode must be one of: auto, serial`)
  }
  validateConcurrencyLane(
    concurrency.readOnly,
    sourceName,
    'extensions.devcodex.concurrency.readOnly',
    new Set(['enabled', 'maxParallel', 'allowAgents']),
    [1, 8]
  )
  validateConcurrencyLane(
    concurrency.validation,
    sourceName,
    'extensions.devcodex.concurrency.validation',
    new Set(['enabled', 'maxParallel']),
    [1, 4]
  )
  validateConcurrencyLocks(concurrency.locks, sourceName)
}

function validateWorkflowCompletionConfig(workflowCompletion, sourceName) {
  if (workflowCompletion === undefined) return
  if (!isPlainObject(workflowCompletion)) {
    err(`[profile] ${sourceName}.extensions.devcodex.workflowCompletion must be an object`)
    return
  }
  for (const key of Object.keys(workflowCompletion)) {
    if (key !== 'mode') err(`[profile] ${sourceName}.extensions.devcodex.workflowCompletion contains unsupported key: ${key}`)
  }
  if (!['off', 'shadow', 'enforce', 'rolled-back'].includes(workflowCompletion.mode)) {
    err(`[profile] ${sourceName}.extensions.devcodex.workflowCompletion.mode must be one of: off, shadow, enforce, rolled-back`)
  }
}

function validateProfileConfigExtensions(cfg, sourceName, projectInfoText, readmeText) {
  const extensions = cfg.extensions
  if (extensions === undefined) return
  if (!isPlainObject(extensions)) {
    err(`[profile] ${sourceName}.extensions must be an object`)
    return
  }
  const devcodex = extensions.devcodex
  if (devcodex === undefined) return
  if (!isPlainObject(devcodex)) {
    err(`[profile] ${sourceName}.extensions.devcodex must be an object`)
    return
  }
  for (const key of Object.keys(devcodex)) {
    if (!['autoAliases', 'concurrency', 'workflowCompletion'].includes(key)) {
      err(`[profile] ${sourceName}.extensions.devcodex contains unsupported key: ${key}`)
    }
  }
  validateAutoAliases(devcodex.autoAliases, sourceName)
  validateConcurrencyPolicy(devcodex.concurrency, sourceName)
  validateWorkflowCompletionConfig(devcodex.workflowCompletion, sourceName)
  if (Array.isArray(devcodex.autoAliases) && devcodex.autoAliases.length > 0) {
    const combined = `${projectInfoText}\n${readmeText}`
    if (!/extensions\.devcodex\.autoAliases|autoAliases|auto 别名|Auto 别名/i.test(combined)) {
      warn(`[profile] ${sourceName}.extensions.devcodex.autoAliases is configured but Profile README / 01-项目信息.md does not document it`)
    }
  }
  if (devcodex.concurrency !== undefined) {
    const combined = `${projectInfoText}\n${readmeText}`
    if (!/extensions\.devcodex\.concurrency|ConcurrencyPolicy|并发策略/i.test(combined)) {
      warn(`[profile] ${sourceName}.extensions.devcodex.concurrency is configured but Profile README / 01-项目信息.md does not document it`)
    }
  }
  if (devcodex.workflowCompletion !== undefined) {
    const combined = `${projectInfoText}\n${readmeText}`
    if (!/extensions\.devcodex\.workflowCompletion|workflowCompletion|完成证据/i.test(combined)) {
      warn(`[profile] ${sourceName}.extensions.devcodex.workflowCompletion is configured but Profile README / 01-项目信息.md does not document it`)
    }
  }
}

function validateLocalConfigDocumented(projectInfoText, readmeText, hasExtensions) {
  const combined = `${projectInfoText}\n${readmeText}`
  if (!/config\.local\.json/.test(combined)) {
    warn('[profile] config.local.json exists but neither README nor 01-项目信息.md documents it')
  }
  if (hasExtensions && !/extensions\.<namespace>|extensions\./.test(combined)) {
    warn('[profile] config.local.json uses extensions but README / 01-项目信息.md does not explain extensions.<namespace>')
  }
}

const LOCAL_ROOT_KEYS = new Set(['$schema', 'connections', 'extensions', 'notes'])
const LOCAL_CONNECTION_KEYS = new Set([
  'kind',
  'description',
  'host',
  'port',
  'database',
  'schema',
  'username',
  'readonly',
  'ssl',
  'password',
  'token',
  'apiKey',
  'privateKey',
  'clientSecret',
  'signingKey',
  'connectionPassword',
  'connectionString',
  'hostEnv',
  'portEnv',
  'databaseEnv',
  'schemaEnv',
  'usernameEnv',
  'urlEnv',
  'passwordEnv',
  'tokenEnv',
  'apiKeyEnv',
  'privateKeyEnv',
  'clientSecretEnv',
  'signingKeyEnv',
  'connectionPasswordEnv',
  'keyEnv',
  'secretRef',
  'options'
])
const LOCAL_EXTENSION_KEYS = new Set(['kind', 'description', 'refs', 'config'])

function validateLocalConfig(cfg, projectInfoText, readmeText) {
  if (!isPlainObject(cfg)) {
    err('[profile] config.local.json must be a JSON object')
    return
  }

  for (const reserved of ['mode', 'agent', 'pluginVersion']) {
    if (Object.prototype.hasOwnProperty.call(cfg, reserved)) {
      err(`[profile] config.local.json must not override "${reserved}"`)
    }
  }

  for (const key of Object.keys(cfg)) {
    if (!LOCAL_ROOT_KEYS.has(key)) {
      err(`[profile] config.local.json contains unsupported root key: ${key}`)
    }
  }

  if (Object.prototype.hasOwnProperty.call(cfg, 'notes')) {
    const notes = cfg.notes
    const validNotes = typeof notes === 'string' || (Array.isArray(notes) && notes.every(item => typeof item === 'string'))
    if (!validNotes) err('[profile] config.local.json "notes" must be a string or string[]')
  }

  const connections = cfg.connections
  if (connections !== undefined) {
    if (!isPlainObject(connections)) {
      err('[profile] config.local.json "connections" must be an object')
    } else {
      for (const [name, connection] of Object.entries(connections)) {
        if (!isPlainObject(connection)) {
          err(`[profile] config.local.json connections.${name} must be an object`)
          continue
        }
        for (const key of Object.keys(connection)) {
          if (!LOCAL_CONNECTION_KEYS.has(key)) {
            err(`[profile] config.local.json connections.${name} contains unsupported key: ${key}`)
          }
        }
        for (const field of ['kind', 'description', 'host', 'database', 'schema', 'username', 'password', 'token', 'apiKey', 'privateKey', 'clientSecret', 'signingKey', 'connectionPassword', 'connectionString']) {
          if (field in connection && typeof connection[field] !== 'string') {
            err(`[profile] config.local.json connections.${name}.${field} must be a string`)
          }
        }
        for (const field of ['readonly', 'ssl']) {
          if (field in connection && typeof connection[field] !== 'boolean') {
            err(`[profile] config.local.json connections.${name}.${field} must be a boolean`)
          }
        }
        if ('port' in connection && !Number.isInteger(connection.port)) {
          err(`[profile] config.local.json connections.${name}.port must be an integer`)
        }
        for (const refKey of ['hostEnv', 'portEnv', 'databaseEnv', 'schemaEnv', 'usernameEnv', 'urlEnv', 'passwordEnv', 'tokenEnv', 'apiKeyEnv', 'privateKeyEnv', 'clientSecretEnv', 'signingKeyEnv', 'connectionPasswordEnv', 'keyEnv', 'secretRef']) {
          if (refKey in connection && typeof connection[refKey] !== 'string') {
            err(`[profile] config.local.json connections.${name}.${refKey} must be a string`)
          }
        }
        if ('options' in connection && !isPlainObject(connection.options)) {
          err(`[profile] config.local.json connections.${name}.options must be an object`)
        }
      }
    }
  }

  const extensions = cfg.extensions
  const extensionKeys = isPlainObject(extensions) ? Object.keys(extensions) : []
  if (extensions !== undefined) {
    if (!isPlainObject(extensions)) {
      err('[profile] config.local.json "extensions" must be an object')
    } else {
      for (const [namespace, extension] of Object.entries(extensions)) {
        if (!/^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*$/.test(namespace)) {
          err(`[profile] config.local.json extension namespace must be kebab or dotted-kebab: ${namespace}`)
        }
        if (!isPlainObject(extension)) {
          err(`[profile] config.local.json extensions.${namespace} must be an object`)
          continue
        }
        for (const key of Object.keys(extension)) {
          if (!LOCAL_EXTENSION_KEYS.has(key)) {
            err(`[profile] config.local.json extensions.${namespace} contains unsupported key: ${key}`)
          }
        }
        if (typeof extension.description !== 'string' || !extension.description.trim()) {
          err(`[profile] config.local.json extensions.${namespace}.description is required`)
        }
        if (extension.kind !== undefined && typeof extension.kind !== 'string') {
          err(`[profile] config.local.json extensions.${namespace}.kind must be a string`)
        }
        if (!('refs' in extension) && !('config' in extension)) {
          err(`[profile] config.local.json extensions.${namespace} must define refs or config`)
        }
        if ('refs' in extension) {
          if (!isPlainObject(extension.refs)) {
            err(`[profile] config.local.json extensions.${namespace}.refs must be an object`)
          } else {
            for (const [refKey, refValue] of Object.entries(extension.refs)) {
              if (!(refKey === 'secretRef' || /Env$/.test(refKey))) {
                err(`[profile] config.local.json extensions.${namespace}.refs key must end with Env or be secretRef: ${refKey}`)
              }
              if (typeof refValue !== 'string') {
                err(`[profile] config.local.json extensions.${namespace}.refs.${refKey} must be a string`)
              }
            }
          }
        }
        if ('config' in extension && !isPlainObject(extension.config)) {
          err(`[profile] config.local.json extensions.${namespace}.config must be an object`)
        }
      }
    }
  }

  validateLocalConfigDocumented(projectInfoText, readmeText, extensionKeys.length > 0)
}

if (!fs.existsSync(profileDir)) {
  const displayPath = path.relative(cwd, profileDir) || profileDir
  console.log(`[profile] no profile dir at ${displayPath} — skip (run \`devcodex profile init\` to bootstrap)`)
  process.exit(0)
}

// Required files for profile-lite, with workspace fallback under workspace-namespace.
const REQUIRED = ['README.md', '01-项目信息.md', '02-架构约束.md', '03-代码风格.md']
for (const f of REQUIRED) {
  if (!hasProfileFile(f)) {
    err(`[profile] missing required: ${f}`)
  }
}

const projectInfoPath = profileFileInfo('01-项目信息.md').path
const readmePath = profileFileInfo('README.md').path
const readmeText = readProfileFile('README.md')
const architectureText = readProfileFile('02-架构约束.md')
const styleText = readProfileFile('03-代码风格.md')
const projectInfoText = readProfileFile('01-项目信息.md')
const releaseProfileText = readProfileFile('05-发布规范.md')
const alternativeReleaseProfileText = readProfileFile('05-交付发布规范.md')
let profileCurrentTruthHeadingCount = 0
for (const [fileName, text] of [
  ['05-发布规范.md', releaseProfileText],
  ['05-交付发布规范.md', alternativeReleaseProfileText]
]) {
  if (!text) continue
  const result = parseProfileCurrentTruth(text)
  profileCurrentTruthHeadingCount += result.headingCount
  for (const message of result.errors) err(`[profile] ${fileName} ${message}`)
}
if (profileCurrentTruthHeadingCount > 1) {
  err(`[profile] ProfileCurrentTruthV1 must appear exactly once across release Profile documents, got ${profileCurrentTruthHeadingCount}`)
}
if (isActiveDevCodexProfileTarget()) {
  const truth = validateDevCodexCurrentTruth({
    releaseProfileText,
    overviewProfileText: projectInfoText,
    testProfileText: readProfileFile('04-测试规范.md'),
    docsProfileText: readProfileFile('07-用户文档与契约规范.md'),
    packageVersion: pluginVersion,
    gitHead: currentSourceGitHead(),
    candidateId: currentSourceCandidateId(),
    requireSourceCandidate: true,
    workflowText: readFileIfExists(path.join(PLUGIN_ROOT, '.github', 'workflows', 'ci.yml'))
  })
  for (const message of truth.errors) err(`[profile] ProfileCurrentTruthGate ${message}`)
}
// DevCodex package version is authoritative only for explicit DevCodex current-release consumers.
if (pluginVersion && projectInfoText && isSourceRepoProfileTarget()) {
  const projectInfo = projectInfoText
  const currentVersion = extractVersion('当前版本', projectInfo)
  const currentStageVersion = extractVersion('当前阶段', projectInfo)

  if (!currentVersion) {
    warn('[profile] 01-项目信息.md missing 当前版本 entry')
  }

  if (!currentStageVersion) {
    if (!hasLegacyStageDraft(projectInfo)) {
      warn('[profile] 01-项目信息.md missing 当前阶段 version entry')
    }
  }

  checkProjectInfoSemantics(projectInfo)
}

checkProfileReleaseTruthAuthorityMatrix(projectInfoText)
checkCurrentAssetInventoryTruth(projectInfoText)

checkS02ProfileFreshness({
  'README.md': readmeText,
  '02-架构约束.md': architectureText,
  '03-代码风格.md': styleText
})

const PROFILE_TIER_GATES = [
  'ProfileTierStandardGate',
  'ProfileLifecycleClassificationGate',
  'AllDevCodexProfileValidationGate'
]

function detectProfileTier() {
  const tierFiles = [...PROFILE_DEFAULT_FILES.filter(file => file.endsWith('.md')), '05-交付发布规范.md']
  const entries = profileCorpusEntries(tierFiles)
  const combined = entries
    .map(entry => `\n--- ${entry.fileName} (${entry.info.source}) ---\n${entry.text}`)
    .join('\n')

  const projectTiers = entries
    .filter(entry => entry.info.source === 'project')
    .flatMap(entry => extractExplicitProfileTiers(entry.text))
  const uniqueProjectTiers = [...new Set(projectTiers)]
  if (uniqueProjectTiers.length > 1) {
    err(`[profile] multiple project-local profile tiers declared: ${uniqueProjectTiers.join(', ')}`)
  }
  if (uniqueProjectTiers.length >= 1) {
    return { tier: uniqueProjectTiers[0], combined }
  }

  const fallbackTiers = entries
    .filter(entry => entry.info.source !== 'missing')
    .flatMap(entry => extractExplicitProfileTiers(entry.text))
  const uniqueFallbackTiers = [...new Set(fallbackTiers)]
  if (uniqueFallbackTiers.length > 1) {
    err(`[profile] multiple fallback profile tiers declared: ${uniqueFallbackTiers.join(', ')}`)
  }
  if (uniqueFallbackTiers.length >= 1) {
    return { tier: uniqueFallbackTiers[0], combined }
  }

  const matches = [...combined.matchAll(/\bprofile-(?:lite|standard|closed-loop)\b/g)].map(match => match[0])
  const unique = [...new Set(matches)]
  if (unique.length > 1) {
    err(`[profile] multiple profile tiers declared: ${unique.join(', ')}`)
  }
  const tier = unique[0] || ''
  if (!tier) {
    warn('[profile] profile tier missing — defaulting to profile-lite for backward compatibility')
    return { tier: 'profile-lite', combined }
  }
  if (!PROFILE_TIERS.has(tier)) {
    err(`[profile] invalid profile tier: ${tier}`)
    return { tier: 'profile-lite', combined }
  }
  return { tier, combined }
}

function hasFeatureInventorySource(combined) {
  const available = new Set(PROFILE_DEFAULT_FILES.filter(file => hasProfileFile(file)))
  return contractHasFeatureInventorySource(available, combined)
}

function featureInventorySourceDeclaration(combined) {
  const match = String(combined || '').match(/(?:Feature inventory source|功能清单来源)\s*[：:]\s*`?([^`\r\n]+\.md)`?/i)
  return match ? match[1].trim() : ''
}

function validateFeatureInventoryText(text, label, requireV1) {
  const result = inspectFeatureInventoryDocument(text, { requireV1 })
  for (const message of result.errors) err(`[profile] ${label}: ${message}`)
  return result
}

function validateFeatureInventorySource(combined, requireV1) {
  if (hasProfileFile('06-功能清单.md')) {
    return validateFeatureInventoryText(readProfileFile('06-功能清单.md'), '06-功能清单.md', requireV1)
  }
  const declaration = featureInventorySourceDeclaration(combined)
  if (!declaration) {
    err('[profile] feature inventory source must be 06-功能清单.md or an explicit `Feature inventory source: <path>.md` declaration')
    return null
  }
  const sourcePath = path.resolve(profileDir, declaration)
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    err(`[profile] feature inventory source not found: ${declaration}`)
    return null
  }
  return validateFeatureInventoryText(fs.readFileSync(sourcePath, 'utf8'), `feature inventory source ${declaration}`, requireV1)
}

function validateCanonicalFeatureInventory(projectInfo, inventoryResult) {
  if (!inventoryResult || !inventoryResult.valid || !hasProfileFile('06-功能清单.md')) return
  const labels = FEATURE_INVENTORY_V1_COLUMNS.map(key => FEATURE_INVENTORY_COLUMN_LABELS[key])
  const duplicateTable = parseMarkdownTables(projectInfo).find(table => labels.every(label => table.headers.includes(label)))
  if (duplicateTable) {
    err('[profile] 01-项目信息.md must not duplicate the complete FeatureInventory table; 06-功能清单.md is canonical')
  }
  const stateFamily = value => {
    const text = String(value || '').toLowerCase()
    if (/\bunreleased\b|\bpreview\b|未发布|候选|预览/.test(text)) return 'unreleased'
    if (/\breleased(?:-[a-z0-9._-]+)?\b|\bv?\d+\.\d+\.\d+(?:-[a-z0-9._-]+)?\b|已发布|正式发布/.test(text)) return 'released'
    return ''
  }
  const projectLines = String(projectInfo || '').split(/\r?\n/)
  for (const row of inventoryResult.validRows || []) {
    const canonicalFamily = stateFamily(row.releaseState)
    if (!canonicalFamily) continue
    const staleAnchor = String(row.releaseState || '').match(/\bunreleased(?:-[a-z0-9._-]+)?-after-v(\d+\.\d+\.\d+)\b/i)
    if (isSourceRepoProfileTarget() && staleAnchor && compareSemver(staleAnchor[1], pluginVersion) < 0 &&
        ['implemented', 'validated', 'released', 'historical'].includes(String(row.lifecycleState || '').toLowerCase())) {
      warn(`[profile] 06-功能清单.md release state lags current package for ${row.featureId}: ${row.releaseState} vs v${pluginVersion}`)
    }
    for (const line of projectLines) {
      if (!line.includes(row.featureId) && !line.includes(row.capabilityGroup)) continue
      const summaryFamily = stateFamily(line)
      if (summaryFamily && summaryFamily !== canonicalFamily) {
        err(`[profile] 01-项目信息.md release state conflicts with 06-功能清单.md for ${row.featureId}: ${summaryFamily} vs ${canonicalFamily}`)
      }
    }
  }
  checkValidationRouteTruth(inventoryResult)
}

function validateProfileTier(tier, combined) {
  if (tier === 'profile-lite') return

  if (!hasProfileFile('04-测试规范.md')) {
    err(`[profile] ${tier} requires 04-测试规范.md`)
  }
  if (!hasAnyProfileFile(['05-交付发布规范.md', '05-发布规范.md'])) {
    err(`[profile] ${tier} requires 05-交付发布规范.md or 05-发布规范.md`)
  }
  let inventoryResult = null
  if (!hasFeatureInventorySource(combined)) {
    err(`[profile] ${tier} requires a structured feature inventory source`)
  } else {
    inventoryResult = validateFeatureInventorySource(combined, tier === 'profile-closed-loop')
  }

  if (tier === 'profile-closed-loop') {
    if (!hasProfileFile('06-功能清单.md')) {
      err('[profile] profile-closed-loop requires 06-功能清单.md')
    }
    if (!hasProfileFile('07-用户文档与契约规范.md')) {
      err('[profile] profile-closed-loop requires 07-用户文档与契约规范.md')
    }
    const lifecycle = inspectProfileLifecycle(combined)
    for (const missing of lifecycle.missing) {
      err(`[profile] profile-closed-loop lifecycle missing ${missing}`)
    }
  }
  validateCanonicalFeatureInventory(projectInfoText, inventoryResult)
}

const { tier: profileTier, combined: profileTierCorpus } = detectProfileTier()
validateProfileTier(profileTier, profileTierCorpus)

// config.json checks
const cfgInfo = profileFileInfo('config.json')
const cfgPath = cfgInfo.path
if (cfgInfo.source !== 'missing') {
  let cfg
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) } catch (e) {
    err(`[profile] config.json invalid JSON: ${e.message}`)
    cfg = {}
  }
  // mode
  if (!cfg.mode) warn('[profile] config.json missing "mode" (defaults to prod)')
  else if (!['dev', 'prod'].includes(cfg.mode)) err(`[profile] invalid mode: ${cfg.mode}`)
  // agent
  const validAgents = ['copilot', 'vscode-copilot', 'jetbrains-copilot', 'claude-code', 'codex', 'cursor', 'grok', 'unknown-agent']
  if (!cfg.agent) warn('[profile] config.json missing "agent" fallback hint (actual host inferred at runtime)')
  else if (!validAgents.includes(cfg.agent)) err(`[profile] invalid agent: ${cfg.agent} (expected: ${validAgents.join('|')})`)
  // plugin version drift
  if (cfg.pluginVersion) {
    if (pluginVersion && cfg.pluginVersion !== pluginVersion) {
      warn(`[profile] pluginVersion drift: profile says ${cfg.pluginVersion}, plugin is ${pluginVersion} (sync Profile field and/or run \`devcodex global-adapters apply\` for global adapters)`)
    }
  }
  validateProfileConfigExtensions(cfg, 'config.json', projectInfoText, readmeText)
} else {
  warn('[profile] config.json missing — defaults applied (mode=prod, agent inferred)')
}

const localConfigPaths = []
if (workspaceProfileDir && !samePath(profileDir, workspaceProfileDir)) {
  const workspaceLocal = path.join(workspaceProfileDir, 'config.local.json')
  if (fs.existsSync(workspaceLocal)) localConfigPaths.push({ path: workspaceLocal, sourceName: 'workspace config.local.json' })
}
const projectLocal = path.join(profileDir, 'config.local.json')
if (fs.existsSync(projectLocal)) localConfigPaths.push({ path: projectLocal, sourceName: 'config.local.json' })

for (const localConfig of localConfigPaths) {
  let localCfg
  try {
    localCfg = JSON.parse(fs.readFileSync(localConfig.path, 'utf8'))
  } catch (e) {
    err(`[profile] ${localConfig.sourceName} invalid JSON: ${e.message}`)
    localCfg = null
  }
  if (localCfg !== null) {
    validateLocalConfig(localCfg, projectInfoText, readmeText)
  }
}

if (errors.length) {
  console.error(`\x1b[31m✗ ${errors.length} error(s):\x1b[0m`)
  errors.forEach(e => console.error('  ' + e))
}
if (warnings.length) {
  console.warn(`\x1b[33m⚠ ${warnings.length} warning(s):\x1b[0m`)
  warnings.forEach(w => console.warn('  ' + w))
}
if (!errors.length && !warnings.length) {
  console.log('\x1b[32m✓ profile validated\x1b[0m')
}
process.exit(errors.length ? 1 : (warnings.length ? 2 : 0))
