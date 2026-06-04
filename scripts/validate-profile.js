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
const { resolveProfileDir } = require('../hooks/_runtime/workspace-layout.cjs')

const PLUGIN_ROOT = path.resolve(__dirname, '..')
const cwd = process.cwd()

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

const profileDir = resolveProfileDir(cwd)

const errors = []
const warnings = []
const pluginVersion = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'plugin.json'), 'utf8')).version
  } catch {
    return ''
  }
})()
const pluginPackageName = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'package.json'), 'utf8')).name || ''
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
  if (path.resolve(cwd) === PLUGIN_ROOT) return true
  const cwdPackage = readJsonIfExists(path.join(cwd, 'package.json'))
  return !!(pluginPackageName && cwdPackage && cwdPackage.name === pluginPackageName)
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
    if (key !== 'autoAliases') {
      err(`[profile] ${sourceName}.extensions.devcodex contains unsupported key: ${key}`)
    }
  }
  validateAutoAliases(devcodex.autoAliases, sourceName)
  if (Array.isArray(devcodex.autoAliases) && devcodex.autoAliases.length > 0) {
    const combined = `${projectInfoText}\n${readmeText}`
    if (!/extensions\.devcodex\.autoAliases|autoAliases|auto 别名|Auto 别名/i.test(combined)) {
      warn(`[profile] ${sourceName}.extensions.devcodex.autoAliases is configured but Profile README / 01-项目信息.md does not document it`)
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

// Required files
const REQUIRED = ['README.md', '01-项目信息.md', '02-架构约束.md', '03-代码风格.md']
for (const f of REQUIRED) {
  if (!fs.existsSync(path.join(profileDir, f))) {
    err(`[profile] missing required: ${f}`)
  }
}

const projectInfoPath = path.join(profileDir, '01-项目信息.md')
const readmePath = path.join(profileDir, 'README.md')
const architecturePath = path.join(profileDir, '02-架构约束.md')
const stylePath = path.join(profileDir, '03-代码风格.md')
const readmeText = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf8') : ''
const architectureText = fs.existsSync(architecturePath) ? fs.readFileSync(architecturePath, 'utf8') : ''
const styleText = fs.existsSync(stylePath) ? fs.readFileSync(stylePath, 'utf8') : ''
if (pluginVersion && fs.existsSync(projectInfoPath)) {
  const projectInfo = fs.readFileSync(projectInfoPath, 'utf8')
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

  if (isSourceRepoProfileTarget()) {
    checkProjectInfoSemantics(projectInfo)
  }
}

checkS02ProfileFreshness({
  'README.md': readmeText,
  '02-架构约束.md': architectureText,
  '03-代码风格.md': styleText
})

// config.json checks
const cfgPath = path.join(profileDir, 'config.json')
if (fs.existsSync(cfgPath)) {
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
  const projectInfoText = fs.existsSync(projectInfoPath) ? fs.readFileSync(projectInfoPath, 'utf8') : ''
  validateProfileConfigExtensions(cfg, 'config.json', projectInfoText, readmeText)
} else {
  warn('[profile] config.json missing — defaults applied (mode=prod, agent inferred)')
}

const localCfgPath = path.join(profileDir, 'config.local.json')
if (fs.existsSync(localCfgPath)) {
  let localCfg
  try {
    localCfg = JSON.parse(fs.readFileSync(localCfgPath, 'utf8'))
  } catch (e) {
    err(`[profile] config.local.json invalid JSON: ${e.message}`)
    localCfg = null
  }
  if (localCfg !== null) {
    const projectInfoText = fs.existsSync(projectInfoPath) ? fs.readFileSync(projectInfoPath, 'utf8') : ''
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
