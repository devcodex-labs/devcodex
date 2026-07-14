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
const {
  PROFILE_DEFAULT_FILES,
  PROFILE_TIERS,
  extractProfileTierDeclarations,
  hasFeatureInventorySource: contractHasFeatureInventorySource,
  hasProfileLifecycle: contractHasProfileLifecycle,
  inspectFeatureInventoryDocument,
  parseMarkdownTables,
  FEATURE_INVENTORY_COLUMN_LABELS
} = require('../mcp/profile-contract')
const { resolveProfileDir } = require('../hooks/_runtime/workspace-layout.cjs')

// ProfileGenerationContractGate / FeatureInventorySchemaGate / ProfileTierMigrationSafetyGate
// share the tier vocabulary: profile-lite | profile-standard | profile-closed-loop.

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

function hasLegacyStageDraft(text) {
  return /##\s*当前阶段/m.test(text) &&
    /^\s*[-*]\s*主版本分支[：:]/m.test(text) &&
    /^\s*[-*]\s*阶段摘要[：:]/m.test(text)
}

function isSourceRepoProfileTarget() {
  if (sourceRepoProfileFlag) return true
  return path.resolve(cwd) === PLUGIN_ROOT
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
  return /devcodex\/agents\/\s*→\s*\.github\/agents\//.test(text) &&
    /(Copilot[^\n。]*默认分发|默认分发[^\n。]*Copilot)/.test(text) &&
    /(Claude Code[^\n。]*不分发|不分发[^\n。]*Claude Code)/.test(text)
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
    if (!['autoAliases', 'concurrency'].includes(key)) {
      err(`[profile] ${sourceName}.extensions.devcodex contains unsupported key: ${key}`)
    }
  }
  validateAutoAliases(devcodex.autoAliases, sourceName)
  validateConcurrencyPolicy(devcodex.concurrency, sourceName)
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
// DevCodex package version is authoritative only for the DevCodex source profile.
if (pluginVersion && projectInfoText && isSourceRepoProfileTarget()) {
  const projectInfo = projectInfoText
  const currentVersion = extractVersion('当前版本', projectInfo)
  const currentStageVersion = extractVersion('当前阶段', projectInfo)

  if (!currentVersion) {
    warn('[profile] 01-项目信息.md missing 当前版本 entry')
  } else if (currentVersion !== pluginVersion) {
    warn(`[profile] 01-项目信息.md 当前版本漂移: ${currentVersion} → ${pluginVersion}`)
  }

  if (!currentStageVersion) {
    if (!hasLegacyStageDraft(projectInfo)) {
      warn('[profile] 01-项目信息.md missing 当前阶段 version entry')
    }
  } else if (currentStageVersion !== pluginVersion) {
    warn(`[profile] 01-项目信息.md 当前阶段漂移: ${currentStageVersion} → ${pluginVersion}`)
  }

  checkProjectInfoSemantics(projectInfo)
}

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
  const labels = Object.values(FEATURE_INVENTORY_COLUMN_LABELS)
  const duplicateTable = parseMarkdownTables(projectInfo).find(table => labels.every(label => table.headers.includes(label)))
  if (duplicateTable) {
    err('[profile] 01-项目信息.md must not duplicate the complete FeatureInventorySchemaV1 table; 06-功能清单.md is canonical')
  }
  const stateFamily = value => {
    const text = String(value || '').toLowerCase()
    if (/\bunreleased\b|\bpreview\b/.test(text)) return 'unreleased'
    if (/\breleased(?:-[a-z0-9._-]+)?\b|\bv?\d+\.\d+\.\d+(?:-[a-z0-9._-]+)?\b/.test(text)) return 'released'
    return ''
  }
  const projectLines = String(projectInfo || '').split(/\r?\n/)
  for (const row of inventoryResult.validRows || []) {
    const canonicalFamily = stateFamily(row.releaseState)
    if (!canonicalFamily) continue
    for (const line of projectLines) {
      if (!line.includes(row.featureId) && !line.includes(row.capabilityGroup)) continue
      const summaryFamily = stateFamily(line)
      if (summaryFamily && summaryFamily !== canonicalFamily) {
        err(`[profile] 01-项目信息.md release state conflicts with 06-功能清单.md for ${row.featureId}: ${summaryFamily} vs ${canonicalFamily}`)
      }
    }
  }
}

function hasProfileLifecycle(combined) {
  return contractHasProfileLifecycle(combined)
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
    if (!hasProfileLifecycle(combined)) {
      err('[profile] profile-closed-loop requires lifecycle wording for stable baseline, living document and conditional-required/local docs')
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
  const validAgents = ['copilot', 'vscode-copilot', 'jetbrains-copilot', 'claude-code', 'codex', 'cursor', 'unknown-agent']
  if (!cfg.agent) warn('[profile] config.json missing "agent" fallback hint (actual host inferred at runtime)')
  else if (!validAgents.includes(cfg.agent)) err(`[profile] invalid agent: ${cfg.agent} (expected: ${validAgents.join('|')})`)
  // plugin version drift
  if (cfg.pluginVersion) {
    if (pluginVersion && cfg.pluginVersion !== pluginVersion) {
      warn(`[profile] pluginVersion drift: profile says ${cfg.pluginVersion}, plugin is ${pluginVersion} (run \`devcodex update\`)`)
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
