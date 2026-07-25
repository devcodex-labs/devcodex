'use strict'

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const {
  findLayoutInfo,
  inferProjectFromCwd,
  resolveActiveRuntimeRoot
} = require('../../hooks/_runtime/workspace-layout.cjs')

const HOST_SCOPE = Object.freeze({
  WORKSPACE_NATIVE: 'workspace-native',
  USER_REGISTERED_WORKSPACE: 'user-registered-workspace',
  PROJECT_PORTABLE: 'project-portable'
})

const GROK_WORKSPACE_PLUGIN_RELATIVE = Object.freeze(['.grok', 'devcodex', 'plugins', 'devcodex-workspace'])
const GROK_LEGACY_WORKSPACE_PLUGIN_RELATIVES = Object.freeze([
  Object.freeze(['.grok', 'plugins', 'devcodex-workspace'])
])

function portable(value) {
  return String(value).replace(/\\/g, '/')
}

function samePath(left, right) {
  const a = path.resolve(left)
  const b = path.resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function isPathWithin(root, candidate) {
  if (!root || !candidate) return false
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function contentDigest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function resolveHostAdapterScope(cwd, host = 'grok', options = {}) {
  const absoluteCwd = path.resolve(cwd)
  const requested = String(options.requestedScope || '').trim() || null
  const layout = findLayoutInfo(absoluteCwd)
  const workspaceNamespace = layout.enabled && layout.mode === 'workspace-namespace'
  const workspaceRoot = workspaceNamespace ? path.resolve(layout.workspaceRoot) : null
  const project = workspaceNamespace ? inferProjectFromCwd(absoluteCwd, layout) : null
  const projectRoot = project
    ? path.join(workspaceRoot, ...String(project).split('/').filter(Boolean))
    : null

  if (requested && !Object.values(HOST_SCOPE).includes(requested)) {
    const error = new Error(`HOST_SCOPE_UNSUPPORTED: ${requested}`)
    error.code = 'HOST_SCOPE_UNSUPPORTED'
    throw error
  }

  let scope
  if (requested) scope = requested
  else if (workspaceNamespace && host === 'grok') scope = HOST_SCOPE.USER_REGISTERED_WORKSPACE
  else if (workspaceNamespace) scope = HOST_SCOPE.WORKSPACE_NATIVE
  else scope = HOST_SCOPE.PROJECT_PORTABLE

  if (scope !== HOST_SCOPE.PROJECT_PORTABLE && !workspaceNamespace) {
    const error = new Error('HOST_SCOPE_WORKSPACE_MISSING: workspace-namespace marker not found')
    error.code = 'HOST_SCOPE_WORKSPACE_MISSING'
    throw error
  }
  if (scope === HOST_SCOPE.PROJECT_PORTABLE && workspaceNamespace && !options.explicitPortable) {
    const error = new Error('HOST_SCOPE_PORTABLE_REQUIRES_EXPLICIT_OPT_IN')
    error.code = 'HOST_SCOPE_PORTABLE_REQUIRES_EXPLICIT_OPT_IN'
    throw error
  }

  const ownerRoot = scope === HOST_SCOPE.PROJECT_PORTABLE ? absoluteCwd : workspaceRoot
  const pluginRoot = host === 'grok' && scope === HOST_SCOPE.USER_REGISTERED_WORKSPACE
    ? path.join(ownerRoot, ...GROK_WORKSPACE_PLUGIN_RELATIVE)
    : null
  const legacyPluginRoots = host === 'grok' && scope === HOST_SCOPE.USER_REGISTERED_WORKSPACE
    ? GROK_LEGACY_WORKSPACE_PLUGIN_RELATIVES.map(relative => path.join(ownerRoot, ...relative))
    : []
  const result = {
    schemaVersion: 'HostAdapterScopeV1',
    host,
    scope,
    cwd: absoluteCwd,
    workspaceRoot,
    project: project || null,
    projectRoot: projectRoot ? path.resolve(projectRoot) : null,
    ownerRoot,
    pluginRoot,
    legacyPluginRoots,
    activation: scope === HOST_SCOPE.USER_REGISTERED_WORKSPACE
      ? 'user-plugin-registration'
      : (scope === HOST_SCOPE.WORKSPACE_NATIVE ? 'workspace-native-discovery' : 'project-local-discovery'),
    projectGeneratedHostArtifactsAllowed: scope === HOST_SCOPE.PROJECT_PORTABLE,
    evidenceCeiling: 'unverified'
  }
  result.identity = contentDigest(JSON.stringify(result))
  return result
}

function parseTomlStringArray(raw, key) {
  const text = String(raw || '')
  let open = -1
  let close = -1
  let quote = null
  let escaped = false
  let comment = false
  const tokens = []
  for (let index = 0; index < text.length; index++) {
    const character = text[index]
    if (comment) {
      if (character === '\n') comment = false
      continue
    }
    if (quote) {
      if (quote === '"' && escaped) {
        escaped = false
        continue
      }
      if (quote === '"' && character === '\\') {
        escaped = true
        continue
      }
      if (character === quote) {
        const token = tokens[tokens.length - 1]
        token.end = index + 1
        token.value = quote === '"'
          ? JSON.parse(text.slice(token.start, token.end))
          : text.slice(token.start + 1, token.end - 1)
        quote = null
      }
      continue
    }
    if (character === '#') {
      comment = true
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      tokens.push({ start: index, end: null, value: null })
      continue
    }
    if (character === '[' && open < 0) {
      open = index
      continue
    }
    if (character === ']' && open >= 0) {
      close = index
      break
    }
    if (open >= 0 && !/[\s,]/.test(character)) {
      const error = new Error(`GROK_PLUGIN_CONFIG_UNSUPPORTED: ${key} contains a non-string value`)
      error.code = 'GROK_PLUGIN_CONFIG_UNSUPPORTED'
      throw error
    }
  }
  if (open < 0 || close < 0 || quote || tokens.some(token => token.end === null)) {
    const error = new Error(`GROK_PLUGIN_CONFIG_UNSUPPORTED: ${key} must be a string array`)
    error.code = 'GROK_PLUGIN_CONFIG_UNSUPPORTED'
    throw error
  }
  const suffix = text.slice(close + 1)
  if (suffix.split('\n')[0].trim() && !/^\s*#/.test(suffix.split('\n')[0])) {
    const error = new Error(`GROK_PLUGIN_CONFIG_UNSUPPORTED: ${key} contains trailing content`)
    error.code = 'GROK_PLUGIN_CONFIG_UNSUPPORTED'
    throw error
  }
  const tailStart = tokens.length ? tokens[tokens.length - 1].end : open + 1
  const tail = text.slice(tailStart, close).replace(/#[^\r\n]*/g, '')
  return {
    values: tokens.map(token => token.value),
    tokens,
    open,
    close,
    suffix,
    trailingComma: tail.includes(',')
  }
}

function formatTomlStringArray(values) {
  return `[${values.map(value => JSON.stringify(String(value))).join(', ')}]`
}

function findTomlSection(lines, name) {
  const header = new RegExp(`^\\s*\\[${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\s*(?:#.*)?$`)
  const start = lines.findIndex(line => header.test(line))
  if (start < 0) return null
  let end = lines.length
  for (let index = start + 1; index < lines.length; index++) {
    if (/^\s*\[[^\]]+\]\s*(?:#.*)?$/.test(lines[index])) {
      end = index
      break
    }
  }
  return { start, end }
}

function readArrayAssignment(lines, section, key) {
  const matcher = new RegExp(`^(\\s*)${key}\\s*=\\s*(.*)$`)
  for (let index = section.start + 1; index < section.end; index++) {
    const match = lines[index].match(matcher)
    if (!match) continue
    const parts = [match[2]]
    let parsed = null
    let endIndex = index
    while (endIndex < section.end) {
      try {
        parsed = parseTomlStringArray(parts.join('\n'), key)
        break
      } catch (error) {
        if (error.code !== 'GROK_PLUGIN_CONFIG_UNSUPPORTED' || !/must be a string array/.test(error.message)) throw error
        endIndex++
        if (endIndex >= section.end) throw error
        parts.push(lines[endIndex])
      }
    }
    const raw = parts.join('\n')
    return {
      index,
      startIndex: index,
      endIndex,
      indent: match[1],
      valueColumn: lines[index].length - match[2].length,
      values: parsed.values,
      tokens: parsed.tokens,
      raw,
      close: parsed.close,
      suffix: parsed.suffix,
      trailingComma: parsed.trailingComma,
      multiline: endIndex > index
    }
  }
  return null
}

function tokenLinePosition(raw, offset) {
  const prefix = raw.slice(0, offset)
  const segments = prefix.split('\n')
  return { lineOffset: segments.length - 1, column: segments[segments.length - 1].length }
}

function assignmentTokenPosition(assignment, offset) {
  const position = tokenLinePosition(assignment.raw, offset)
  if (position.lineOffset === 0) position.column += assignment.valueColumn
  return position
}

function removeArrayValues(lines, assignment, shouldRemove) {
  const removals = assignment.tokens.filter(token => shouldRemove(token.value)).reverse()
  for (const token of removals) {
    const start = assignmentTokenPosition(assignment, token.start)
    const end = assignmentTokenPosition(assignment, token.end)
    if (start.lineOffset !== end.lineOffset) {
      const error = new Error('GROK_PLUGIN_CONFIG_UNSUPPORTED: multiline TOML strings are not supported')
      error.code = 'GROK_PLUGIN_CONFIG_UNSUPPORTED'
      throw error
    }
    const lineIndex = assignment.startIndex + start.lineOffset
    const line = lines[lineIndex]
    let before = line.slice(0, start.column)
    let after = line.slice(end.column)
    const followingComma = after.match(/^\s*,\s*/)
    if (followingComma) after = after.slice(followingComma[0].length)
    else {
      const precedingComma = before.match(/,\s*$/)
      if (precedingComma) before = before.slice(0, precedingComma.index)
    }
    const desired = before + after
    if (lineIndex > assignment.startIndex && /^\s*$/.test(desired)) lines.splice(lineIndex, 1)
    else lines[lineIndex] = desired
  }
  return removals.length > 0
}

function appendMultilineArrayValue(lines, assignment, value, key) {
  const closePrefix = assignment.raw.slice(0, assignment.close).split('\n').pop()
  if (closePrefix.trim()) {
    const error = new Error(`GROK_PLUGIN_CONFIG_UNSUPPORTED: ${key} multiline closing bracket must be on its own line`)
    error.code = 'GROK_PLUGIN_CONFIG_UNSUPPORTED'
    throw error
  }
  let valueIndent = `${assignment.indent}  `
  if (assignment.tokens.length) {
    const lastToken = assignment.tokens[assignment.tokens.length - 1]
    const position = assignmentTokenPosition(assignment, lastToken.end)
    const sourceLine = lines[assignment.startIndex + position.lineOffset]
    valueIndent = (sourceLine.match(/^\s*/) || [''])[0] || valueIndent
    if (!assignment.trailingComma) {
      const lineIndex = assignment.startIndex + position.lineOffset
      lines[lineIndex] = `${sourceLine.slice(0, position.column)},${sourceLine.slice(position.column)}`
    }
  }
  lines.splice(assignment.endIndex, 0, `${valueIndent}${JSON.stringify(String(value))},`)
}

function mergeGrokPluginRegistration(content, pluginPath, options = {}) {
  const pluginName = options.pluginName || 'devcodex-workspace'
  const newline = String(content).includes('\r\n') ? '\r\n' : '\n'
  const lines = String(content || '').split(/\r?\n/)
  if (lines.length === 1 && lines[0] === '') lines.length = 0
  let section = findTomlSection(lines, 'plugins')
  if (!section) {
    if (lines.length && lines[lines.length - 1].trim()) lines.push('')
    lines.push('[plugins]')
    section = { start: lines.length - 1, end: lines.length }
  }

  const disabled = readArrayAssignment(lines, section, 'disabled')
  if (disabled && disabled.values.includes(pluginName)) {
    const error = new Error(`GROK_PLUGIN_DISABLED_BY_USER: ${pluginName}`)
    error.code = 'GROK_PLUGIN_DISABLED_BY_USER'
    throw error
  }

  const canonicalPath = portable(path.resolve(pluginPath))
  const managedPaths = [canonicalPath, ...(options.legacyPluginPaths || []).map(item => portable(path.resolve(item)))]
  section = findTomlSection(lines, 'plugins')
  const legacyPathAssignment = readArrayAssignment(lines, section, 'paths')
  if (legacyPathAssignment) {
    removeArrayValues(lines, legacyPathAssignment, value => managedPaths.some(candidate => samePath(value, candidate)))
  }
  const upserts = [
    { key: 'enabled', value: pluginName, same: (left, right) => left === right }
  ]
  for (const upsert of upserts) {
    section = findTomlSection(lines, 'plugins')
    const assignment = readArrayAssignment(lines, section, upsert.key)
    if (assignment) {
      if (assignment.values.some(value => upsert.same(value, upsert.value))) continue
      if (assignment.multiline) appendMultilineArrayValue(lines, assignment, upsert.value, upsert.key)
      else {
        const values = [...assignment.values, upsert.value]
        lines[assignment.index] = `${assignment.indent}${upsert.key} = ${formatTomlStringArray(values)}${assignment.suffix}`
      }
    } else {
      lines.splice(section.end, 0, `${upsert.key} = ${formatTomlStringArray([upsert.value])}`)
    }
  }

  const desired = lines.join(newline)
  return {
    schemaVersion: 'GrokPluginRegistrationMergeV1',
    desired,
    changed: desired !== String(content || ''),
    pluginName,
    pluginPath: canonicalPath,
    legacyPluginPaths: managedPaths.slice(1),
    beforeDigest: contentDigest(content || ''),
    afterDigest: contentDigest(desired)
  }
}

function removeGrokPluginRegistration(content, pluginPath, options = {}) {
  const pluginName = options.pluginName || 'devcodex-workspace'
  const newline = String(content).includes('\r\n') ? '\r\n' : '\n'
  const lines = String(content || '').split(/\r?\n/)
  const section = findTomlSection(lines, 'plugins')
  if (!section) return { desired: String(content || ''), changed: false }
  for (const item of [
    { key: 'paths', value: portable(path.resolve(pluginPath)), same: samePath },
    { key: 'enabled', value: pluginName, same: (left, right) => left === right }
  ]) {
    const current = findTomlSection(lines, 'plugins')
    const assignment = readArrayAssignment(lines, current, item.key)
    if (!assignment) continue
    removeArrayValues(lines, assignment, value => item.same(value, item.value))
  }
  const desired = lines.join(newline)
  return { desired, changed: desired !== String(content || ''), pluginName, pluginPath: portable(path.resolve(pluginPath)) }
}

function grokUserConfigPath(env = process.env) {
  const home = env.GROK_HOME ? path.resolve(env.GROK_HOME) : path.join(os.homedir(), '.grok')
  return path.join(home, 'config.toml')
}

function grokHomePath(env = process.env) {
  return env.GROK_HOME ? path.resolve(env.GROK_HOME) : path.join(os.homedir(), '.grok')
}

function isGrokCliUnavailableResult(result) {
  if (result?.error?.code === 'ENOENT' || result?.error?.code === 'EACCES') return true
  return Boolean(result && result.status === null && !result.signal && !result.stdout && !result.stderr)
}

function formatGrokCommandOutput(result) {
  const output = String(result?.stderr || result?.stdout || '').trim()
  return output || result?.error?.message || 'no output'
}

function readInstalledPluginRegistry(env = process.env) {
  const registryFile = path.join(grokHomePath(env), 'installed-plugins', 'registry.json')
  if (!fs.existsSync(registryFile)) return { registryFile, value: { version: 1, repos: {} } }
  return { registryFile, value: JSON.parse(fs.readFileSync(registryFile, 'utf8')) }
}

function findInstalledLocalPlugin(pluginPath, env = process.env) {
  const state = readInstalledPluginRegistry(env)
  const match = Object.entries(state.value.repos || {}).find(([, entry]) =>
    entry?.kind?.type === 'Local' && entry.kind.source_path && samePath(entry.kind.source_path, pluginPath)
  )
  if (!match) return { registryFile: state.registryFile, repoId: null, entry: null }
  return { registryFile: state.registryFile, repoId: match[0], entry: match[1] }
}

function directoryDigest(root) {
  if (!fs.existsSync(root)) return null
  const records = []
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) visit(full)
      else records.push(`${portable(path.relative(root, full))}:${contentDigest(fs.readFileSync(full))}`)
    }
  }
  visit(root)
  return contentDigest(records.join('\n'))
}

function inspectGrokPluginInstallation(pluginPath, env = process.env) {
  const source = path.resolve(pluginPath)
  const installed = findInstalledLocalPlugin(source, env)
  const installedPath = installed.entry?.path ? path.resolve(installed.entry.path) : null
  const sourceDigest = directoryDigest(source)
  const installedDigest = installedPath ? directoryDigest(installedPath) : null
  return {
    schemaVersion: 'GrokPluginInstallationStateV1',
    pluginPath: portable(source),
    registryFile: installed.registryFile,
    repoId: installed.repoId,
    installedPath: installedPath ? portable(installedPath) : null,
    sourceDigest,
    installedDigest,
    registered: Boolean(installed.repoId),
    current: Boolean(installed.repoId && sourceDigest && sourceDigest === installedDigest)
  }
}

function syncGrokPluginInstallation({ pluginPath, dryRun = false, env = process.env }) {
  const source = path.resolve(pluginPath)
  const probe = spawnSync('grok', ['version'], { encoding: 'utf8', windowsHide: true, env })
  if (isGrokCliUnavailableResult(probe)) {
    return {
      schemaVersion: 'GrokPluginInstallationReceiptV1',
      status: 'unavailable',
      reason: 'grok-cli-not-found',
      pluginPath: portable(source),
      dryRun
    }
  }
  if (probe.status !== 0) {
    const error = new Error(`GROK_PLUGIN_CLI_UNAVAILABLE: ${formatGrokCommandOutput(probe)}`)
    error.code = 'GROK_PLUGIN_CLI_UNAVAILABLE'
    throw error
  }
  const before = findInstalledLocalPlugin(source, env)
  let refreshMode = before.repoId ? 'official-update' : 'official-install'
  if (!dryRun) {
    const configPath = grokUserConfigPath(env)
    const configBefore = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : null
    const restoreConfig = () => {
      if (configBefore === null) return
      const configAfter = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : null
      if (configAfter === configBefore) return
      const temp = `${configPath}.tmp-${process.pid}`
      fs.writeFileSync(temp, configBefore, 'utf8')
      fs.renameSync(temp, configPath)
    }
    const runPluginCommand = args => {
      const result = spawnSync('grok', args, { encoding: 'utf8', windowsHide: true, env })
      restoreConfig()
      if (result.status !== 0) {
        const error = new Error(`GROK_PLUGIN_INSTALL_FAILED: ${String(result.stderr || result.stdout).trim()}`)
        error.code = 'GROK_PLUGIN_INSTALL_FAILED'
        throw error
      }
      return result
    }
    const installedPluginName = Object.keys(before.entry?.plugins || {}).find(name => name === 'devcodex-workspace')
    const args = before.repoId
      ? ['plugin', 'update', installedPluginName || 'devcodex-workspace']
      : ['plugin', 'install', source, '--trust']
    runPluginCommand(args)
    if (before.repoId) {
      const updated = findInstalledLocalPlugin(source, env)
      const updatedPath = updated.entry?.path ? path.resolve(updated.entry.path) : null
      if (!updatedPath || directoryDigest(source) !== directoryDigest(updatedPath)) {
        runPluginCommand(['plugin', 'uninstall', installedPluginName || 'devcodex-workspace', '--confirm', '--keep-data'])
        runPluginCommand(['plugin', 'install', source, '--trust'])
        refreshMode = 'official-reinstall-after-stale-local-update'
      }
    }
  }
  const after = dryRun ? before : findInstalledLocalPlugin(source, env)
  const installedPath = after.entry?.path ? path.resolve(after.entry.path) : null
  const sourceDigest = directoryDigest(source)
  const installedDigest = installedPath ? directoryDigest(installedPath) : null
  const status = dryRun
    ? (before.repoId ? 'planned-update' : 'planned-install')
    : (after.repoId && sourceDigest === installedDigest ? 'verified' : 'mismatch')
  if (!dryRun && status !== 'verified') {
    const error = new Error('GROK_PLUGIN_INSTALL_MISMATCH: installed plugin bytes differ from workspace owner')
    error.code = 'GROK_PLUGIN_INSTALL_MISMATCH'
    throw error
  }
  return {
    schemaVersion: 'GrokPluginInstallationReceiptV1',
    status,
    pluginPath: portable(source),
    repoId: after.repoId,
    installedPath: installedPath ? portable(installedPath) : null,
    sourceDigest,
    installedDigest,
    grokVersion: String(probe.stdout || probe.stderr || '').trim(),
    refreshMode,
    dryRun
  }
}

function timestampSuffix() {
  return `${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 17)}-${process.pid}`
}

function writeTextAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(temp, content, 'utf8')
  fs.renameSync(temp, file)
}

function runGrokPluginCommandPreservingConfig(args, env, configSnapshot, spawnCommand = spawnSync) {
  const result = spawnCommand('grok', args, { encoding: 'utf8', windowsHide: true, env })
  if (configSnapshot.existed) writeTextAtomic(configSnapshot.path, configSnapshot.content)
  if (result.error?.code === 'ENOENT') {
    const error = new Error('GROK_PLUGIN_CLI_UNAVAILABLE: grok CLI not found')
    error.code = 'GROK_PLUGIN_CLI_UNAVAILABLE'
    throw error
  }
  if (result.status !== 0) {
    const error = new Error(`GROK_PLUGIN_COMMAND_FAILED: ${String(result.stderr || result.stdout).trim()}`)
    error.code = 'GROK_PLUGIN_COMMAND_FAILED'
    throw error
  }
  return result
}

function listInstalledPluginsByName(pluginName, env = process.env) {
  const state = readInstalledPluginRegistry(env)
  const identities = Object.entries(state.value.repos || {})
    .filter(([, entry]) => Object.prototype.hasOwnProperty.call(entry?.plugins || {}, pluginName))
    .map(([repoId, entry]) => ({
      repoId,
      source: entry?.kind?.source_path ? path.resolve(entry.kind.source_path) : null,
      installedPath: entry?.path ? path.resolve(entry.path) : null,
      entry
    }))
  return { registryFile: state.registryFile, identities }
}

function hasManagedGrokPluginSignature(root) {
  if (!root || !fs.existsSync(root)) return false
  const manifestFiles = [
    path.join(root, '.claude-plugin', 'plugin.json'),
    path.join(root, 'plugin.json')
  ]
  const manifest = manifestFiles.map(file => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
  }).find(Boolean)
  return manifest?.name === 'devcodex-workspace' &&
    fs.existsSync(path.join(root, 'hooks', 'devcodex-workspace.cjs')) &&
    fs.existsSync(path.join(root, 'skills', 'devcodex-workspace', 'SKILL.md'))
}

function isKnownLegacyGrokPluginPath(source) {
  if (!source) return false
  const normalized = portable(path.resolve(source)).toLowerCase()
  return normalized.endsWith('/.grok/devcodex/plugins/devcodex-workspace') ||
    normalized.endsWith('/.grok/plugins/devcodex-workspace')
}

function classifyManagedGrokIdentity(identity, canonical, explicitLegacy, recoveryRoots = []) {
  if (identity.source && samePath(identity.source, canonical)) return 'canonical'
  const explicit = identity.source && explicitLegacy.some(source => samePath(source, identity.source))
  const knownPath = explicit || isKnownLegacyGrokPluginPath(identity.source)
  const recoveryPath = identity.source &&
    recoveryRoots.some(root => isPathWithin(root, identity.source))
  const signed = hasManagedGrokPluginSignature(identity.source) ||
    hasManagedGrokPluginSignature(identity.installedPath)
  if (knownPath && signed) return 'legacy-managed'
  return recoveryPath && signed ? 'recovery-managed' : 'unknown'
}

function copyDirectorySnapshot(source, destination) {
  if (!source || !fs.existsSync(source)) return null
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.cpSync(source, destination, { recursive: true, force: false, errorOnExist: true })
  return destination
}

function readNativeGrokPluginList(env, spawnCommand) {
  const result = spawnCommand('grok', ['plugin', 'list', '--json'], {
    encoding: 'utf8',
    windowsHide: true,
    env
  })
  if (result.status !== 0) {
    const error = new Error(`GROK_PLUGIN_LIST_FAILED: ${formatGrokCommandOutput(result)}`)
    error.code = 'GROK_PLUGIN_LIST_FAILED'
    throw error
  }
  let payload
  try { payload = JSON.parse(String(result.stdout || '')) } catch {
    const error = new Error('GROK_PLUGIN_LIST_FAILED: invalid JSON')
    error.code = 'GROK_PLUGIN_LIST_FAILED'
    throw error
  }
  return (Array.isArray(payload) ? payload : [])
    .filter(item => item?.name === 'devcodex-workspace')
    .map(item => ({
      repoId: item.repo_key || null,
      source: item.source ? path.resolve(item.source) : null,
      installedPath: item.path ? path.resolve(item.path) : null
    }))
}

function sameIdentitySources(left, right) {
  const normalize = values => values
    .map(item => item.source ? portable(path.resolve(item.source)).toLowerCase() : '(missing)')
    .sort()
  const first = normalize(left)
  const second = normalize(right)
  return first.length === second.length && first.every((value, index) => value === second[index])
}

function snapshotManagedGrokIdentities(identities, configSnapshot, registryFile, backupRoot) {
  fs.mkdirSync(backupRoot, { recursive: true })
  const snapshots = []
  if (configSnapshot.existed) fs.copyFileSync(configSnapshot.path, path.join(backupRoot, 'config.toml'))
  if (fs.existsSync(registryFile)) fs.copyFileSync(registryFile, path.join(backupRoot, 'registry.json.evidence'))
  for (const [index, identity] of identities.entries()) {
    const itemRoot = path.join(backupRoot, `identity-${index + 1}`)
    const sourceBackup = copyDirectorySnapshot(identity.source, path.join(itemRoot, 'source'))
    const installedBackup = copyDirectorySnapshot(identity.installedPath, path.join(itemRoot, 'installed'))
    snapshots.push({
      ...identity,
      sourceBackup,
      installedBackup,
      sourceDigest: identity.source ? directoryDigest(identity.source) : null,
      installedDigest: identity.installedPath ? directoryDigest(identity.installedPath) : null
    })
  }
  return snapshots
}

/**
 * Converge all known DevCodex Grok identities to one user-global canonical source.
 * Registry mutations use Grok's official CLI; direct registry writes are forbidden.
 */
function syncGrokWorkspacePluginInstallation({
  pluginPath,
  legacyPluginPaths = [],
  activeRoot,
  backupDir,
  dryRun = false,
  env = process.env,
  spawnSync: spawnCommand = spawnSync
}) {
  const canonical = path.resolve(pluginPath)
  const legacy = legacyPluginPaths.map(item => path.resolve(item)).filter(item => !samePath(item, canonical))
  const pluginName = 'devcodex-workspace'
  const recoveryRoots = [
    backupDir ? path.resolve(backupDir) : null,
    activeRoot ? path.join(path.resolve(activeRoot), '.tmp', 'backups') : null,
    path.join(grokHomePath(env), 'devcodex', 'backups', 'plugin-convergence')
  ].filter(Boolean)
  if (!hasManagedGrokPluginSignature(canonical)) {
    const error = new Error('GROK_PLUGIN_CANONICAL_SOURCE_INVALID: managed plugin signature is incomplete')
    error.code = 'GROK_PLUGIN_CANONICAL_SOURCE_INVALID'
    throw error
  }
  const before = listInstalledPluginsByName(pluginName, env)
  const classified = before.identities.map(identity => ({
    ...identity,
    classification: classifyManagedGrokIdentity(identity, canonical, legacy, recoveryRoots)
  }))
  const unknown = classified.filter(identity => identity.classification === 'unknown')
  if (unknown.length) {
    const error = new Error(`GROK_PLUGIN_UNKNOWN_SAME_NAME_IDENTITY: ${unknown.map(item => item.source || item.repoId).join(', ')}`)
    error.code = 'GROK_PLUGIN_UNKNOWN_SAME_NAME_IDENTITY'
    error.identities = unknown.map(item => ({
      repoId: item.repoId,
      source: item.source ? portable(item.source) : null,
      installedPath: item.installedPath ? portable(item.installedPath) : null
    }))
    throw error
  }
  const configPath = grokUserConfigPath(env)
  const configSnapshot = {
    path: configPath,
    existed: fs.existsSync(configPath),
    content: fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : ''
  }
  const canonicalIdentity = classified.find(identity => identity.classification === 'canonical')
  const canonicalCurrent = classified.length === 1 &&
    Boolean(canonicalIdentity?.installedPath) &&
    directoryDigest(canonical) === directoryDigest(canonicalIdentity.installedPath)
  const planned = !canonicalCurrent
  if (dryRun) {
    return {
      schemaVersion: 'GrokPluginRegistryConvergenceReceiptV2',
      status: planned ? 'planned-convergence' : 'already-current',
      pluginPath: portable(canonical),
      legacyPluginPaths: legacy.map(portable),
      identities: classified.map(item => ({
        repoId: item.repoId,
        source: item.source ? portable(item.source) : null,
        classification: item.classification
      })),
      backupRoot: null,
      dryRun: true
    }
  }

  const probe = spawnCommand('grok', ['version'], { encoding: 'utf8', windowsHide: true, env })
  if (isGrokCliUnavailableResult(probe)) {
    const configBase = configSnapshot.existed
      ? configSnapshot.content
      : (fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '')
    const merge = mergeGrokPluginRegistration(configBase, canonical, { legacyPluginPaths: legacy })
    if (merge.changed || !configSnapshot.existed) writeTextAtomic(configPath, merge.desired)
    const configAfter = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : ''
    const receipt = {
      schemaVersion: 'GrokPluginRegistryConvergenceReceiptV2',
      status: 'unavailable',
      reason: 'grok-cli-not-found-registry-unchanged',
      pluginPath: portable(canonical),
      legacyPluginPaths: legacy.map(portable),
      identities: classified.map(item => ({
        repoId: item.repoId,
        source: item.source ? portable(item.source) : null,
        classification: item.classification
      })),
      backupRoot: null,
      configPath,
      configBeforeDigest: contentDigest(configSnapshot.content),
      configAfterDigest: contentDigest(configAfter),
      dryRun: false
    }
    if (activeRoot) {
      const receiptFile = path.join(activeRoot, 'managed', 'grok-plugin-migration.json')
      writeTextAtomic(receiptFile, JSON.stringify({ ...receipt, recordedAt: new Date().toISOString() }, null, 2) + '\n')
      receipt.receiptFile = receiptFile
    }
    return receipt
  }
  if (probe.status !== 0) {
    const error = new Error(`GROK_PLUGIN_CLI_UNAVAILABLE: ${formatGrokCommandOutput(probe)}`)
    error.code = 'GROK_PLUGIN_CLI_UNAVAILABLE'
    throw error
  }

  const nativeBefore = readNativeGrokPluginList(env, spawnCommand)
  if (!sameIdentitySources(classified, nativeBefore)) {
    const error = new Error('GROK_PLUGIN_REGISTRY_SOURCE_MISMATCH: registry and native list disagree')
    error.code = 'GROK_PLUGIN_REGISTRY_SOURCE_MISMATCH'
    throw error
  }
  const backupRoot = path.resolve(backupDir || (
    activeRoot
      ? path.join(activeRoot, '.tmp', 'backups', `grok-plugin-convergence.${timestampSuffix()}`)
      : path.join(grokHomePath(env), 'devcodex', 'backups', 'plugin-convergence', timestampSuffix())
  ))
  const snapshots = planned
    ? snapshotManagedGrokIdentities(classified, configSnapshot, before.registryFile, backupRoot)
    : []
  let mutationStarted = false
  const runOfficial = args => runGrokPluginCommandPreservingConfig(args, env, configSnapshot, spawnCommand)
  try {
    if (planned) {
      let remaining = listInstalledPluginsByName(pluginName, env).identities
      while (remaining.length) {
        mutationStarted = true
        runOfficial(['plugin', 'uninstall', pluginName, '--confirm', '--keep-data'])
        const next = listInstalledPluginsByName(pluginName, env).identities
        if (next.length !== remaining.length - 1) {
          const error = new Error(`GROK_PLUGIN_CONVERGENCE_FAILED: uninstall count ${remaining.length} -> ${next.length}`)
          error.code = 'GROK_PLUGIN_CONVERGENCE_FAILED'
          throw error
        }
        remaining = next
      }
      mutationStarted = true
      runOfficial(['plugin', 'install', canonical, '--trust'])
    }

    const after = listInstalledPluginsByName(pluginName, env)
    const nativeAfter = readNativeGrokPluginList(env, spawnCommand)
    if (
      after.identities.length !== 1 ||
      !after.identities[0].source ||
      !samePath(after.identities[0].source, canonical) ||
      !sameIdentitySources(after.identities, nativeAfter) ||
      !after.identities[0].installedPath ||
      directoryDigest(canonical) !== directoryDigest(after.identities[0].installedPath)
    ) {
      const error = new Error('GROK_PLUGIN_CONVERGENCE_FAILED: canonical identity verification failed')
      error.code = 'GROK_PLUGIN_CONVERGENCE_FAILED'
      throw error
    }

    const configBase = configSnapshot.existed
      ? configSnapshot.content
      : (fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '')
    const merge = mergeGrokPluginRegistration(configBase, canonical, { legacyPluginPaths: legacy })
    if (merge.changed || !configSnapshot.existed) writeTextAtomic(configPath, merge.desired)
    const receipt = {
      schemaVersion: 'GrokPluginRegistryConvergenceReceiptV2',
      status: 'verified',
      pluginPath: portable(canonical),
      legacyPluginPaths: legacy.map(portable),
      identitiesBefore: classified.map(item => ({
        repoId: item.repoId,
        source: item.source ? portable(item.source) : null,
        classification: item.classification
      })),
      identitiesAfter: after.identities.map(item => ({
        repoId: item.repoId,
        source: item.source ? portable(item.source) : null
      })),
      backupRoot: snapshots.length ? portable(backupRoot) : null,
      refreshMode: planned ? 'official-drain-all-install' : 'already-current',
      sourceDigest: directoryDigest(canonical),
      installedDigest: directoryDigest(after.identities[0].installedPath),
      configPath,
      configBeforeDigest: contentDigest(configSnapshot.content),
      configAfterDigest: contentDigest(fs.readFileSync(configPath, 'utf8')),
      dryRun: false
    }
    if (activeRoot) {
      const receiptFile = path.join(activeRoot, 'managed', 'grok-plugin-migration.json')
      writeTextAtomic(receiptFile, JSON.stringify({ ...receipt, recordedAt: new Date().toISOString() }, null, 2) + '\n')
      receipt.receiptFile = receiptFile
    }
    return receipt
  } catch (error) {
    const rollback = {
      attempted: mutationStarted,
      registrationRestored: !mutationStarted,
      configRestored: false,
      restoredCount: mutationStarted ? 0 : classified.length,
      sourceIdentityChanged: false,
      errors: []
    }
    try {
      if (mutationStarted) {
        let remaining = listInstalledPluginsByName(pluginName, env).identities
        while (remaining.length) {
          runOfficial(['plugin', 'uninstall', pluginName, '--confirm', '--keep-data'])
          const next = listInstalledPluginsByName(pluginName, env).identities
          if (next.length !== remaining.length - 1) throw new Error('rollback uninstall count did not decrease')
          remaining = next
        }
        for (const snapshot of snapshots) {
          const recoverySource = snapshot.source && fs.existsSync(snapshot.source)
            ? snapshot.source
            : (snapshot.sourceBackup || snapshot.installedBackup)
          if (!recoverySource || !fs.existsSync(recoverySource)) {
            throw new Error(`rollback source unavailable for ${snapshot.repoId}`)
          }
          if (!snapshot.source || !samePath(recoverySource, snapshot.source)) {
            rollback.sourceIdentityChanged = true
          }
          runOfficial(['plugin', 'install', recoverySource, '--trust'])
        }
        rollback.restoredCount = listInstalledPluginsByName(pluginName, env).identities.length
        rollback.registrationRestored = rollback.restoredCount === classified.length
      }
      if (configSnapshot.existed) {
        writeTextAtomic(configPath, configSnapshot.content)
        rollback.configRestored = fs.readFileSync(configPath, 'utf8') === configSnapshot.content
      } else if (fs.existsSync(configPath)) {
        fs.mkdirSync(backupRoot, { recursive: true })
        fs.renameSync(configPath, path.join(backupRoot, `grok-user-config.rollback.${timestampSuffix()}`))
        rollback.configRestored = true
      } else rollback.configRestored = true
    } catch (rollbackError) {
      rollback.errors.push(rollbackError.message)
    }
    error.migrationRollback = rollback
    if (!rollback.registrationRestored || !rollback.configRestored) {
      const rollbackError = new Error(`GROK_PLUGIN_ROLLBACK_FAILED: ${error.message}`)
      rollbackError.code = 'GROK_PLUGIN_ROLLBACK_FAILED'
      rollbackError.convergenceError = error
      rollbackError.migrationRollback = rollback
      throw rollbackError
    }
    if (!error.code) error.code = 'GROK_PLUGIN_CONVERGENCE_FAILED'
    throw error
  }
}

function uninstallGrokPluginInstallation({ pluginPath, activeRoot, dryRun = false, env = process.env }) {
  const source = path.resolve(pluginPath)
  const configPath = grokUserConfigPath(env)
  const configExisted = fs.existsSync(configPath)
  const configBefore = configExisted ? fs.readFileSync(configPath, 'utf8') : ''
  const removal = removeGrokPluginRegistration(configBefore, source)
  const installedBefore = findInstalledLocalPlugin(source, env)
  const pluginName = Object.keys(installedBefore.entry?.plugins || {})
    .find(name => name === 'devcodex-workspace') || 'devcodex-workspace'
  const changed = Boolean(installedBefore.repoId || removal.changed)

  if (dryRun) {
    return {
      schemaVersion: 'GrokPluginUninstallReceiptV1',
      status: changed ? 'planned-uninstall' : 'already-absent',
      pluginPath: portable(source),
      configPath,
      configChanged: removal.changed,
      installedRepoId: installedBefore.repoId,
      dryRun: true
    }
  }

  let backupPath = null
  if (changed && configExisted) {
    const suffix = `${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 17)}-${process.pid}`
    backupPath = path.join(activeRoot || resolveActiveRuntimeRoot(process.cwd()), '.tmp', 'backups', `grok-user-config.toml.bak.${suffix}`)
    fs.mkdirSync(path.dirname(backupPath), { recursive: true })
    fs.copyFileSync(configPath, backupPath)
  }

  if (installedBefore.repoId) {
    const result = spawnSync('grok', ['plugin', 'uninstall', pluginName, '--confirm', '--keep-data'], {
      encoding: 'utf8', windowsHide: true, env
    })
    if (result.error?.code === 'ENOENT') {
      const error = new Error('GROK_PLUGIN_CLI_UNAVAILABLE: grok CLI not found')
      error.code = 'GROK_PLUGIN_CLI_UNAVAILABLE'
      throw error
    }
    if (result.status !== 0) {
      const error = new Error(`GROK_PLUGIN_UNINSTALL_FAILED: ${String(result.stderr || result.stdout).trim()}`)
      error.code = 'GROK_PLUGIN_UNINSTALL_FAILED'
      throw error
    }
  }

  if (removal.changed || installedBefore.repoId) {
    if (!configExisted && removal.desired === '') {
      if (fs.existsSync(configPath)) fs.rmSync(configPath)
    } else {
      fs.mkdirSync(path.dirname(configPath), { recursive: true })
      const temp = `${configPath}.tmp-${process.pid}`
      fs.writeFileSync(temp, removal.desired, 'utf8')
      fs.renameSync(temp, configPath)
    }
  }

  const installedAfter = findInstalledLocalPlugin(source, env)
  if (installedAfter.repoId) {
    const error = new Error('GROK_PLUGIN_UNINSTALL_MISMATCH: official registry still references workspace plugin')
    error.code = 'GROK_PLUGIN_UNINSTALL_MISMATCH'
    throw error
  }
  const configAfter = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : ''
  if (removeGrokPluginRegistration(configAfter, source).changed) {
    const error = new Error('GROK_PLUGIN_UNINSTALL_MISMATCH: managed user configuration remains')
    error.code = 'GROK_PLUGIN_UNINSTALL_MISMATCH'
    throw error
  }
  return {
    schemaVersion: 'GrokPluginUninstallReceiptV1',
    status: changed ? 'uninstalled' : 'already-absent',
    pluginPath: portable(source),
    configPath,
    configChanged: removal.changed,
    installedRepoId: installedBefore.repoId,
    backupPath,
    beforeDigest: contentDigest(configBefore),
    afterDigest: contentDigest(configAfter),
    workspaceSourceRetained: fs.existsSync(source),
    dryRun: false
  }
}

function writeGrokPluginRegistration({ pluginPath, legacyPluginPaths = [], activeRoot, dryRun = false, env = process.env }) {
  const configPath = grokUserConfigPath(env)
  const current = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : ''
  const merge = mergeGrokPluginRegistration(current, pluginPath, { legacyPluginPaths })
  let backupPath = null
  if (merge.changed && !dryRun) {
    if (current) {
      const suffix = `${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 17)}-${process.pid}`
      backupPath = path.join(activeRoot || resolveActiveRuntimeRoot(process.cwd()), '.tmp', 'backups', `grok-user-config.toml.bak.${suffix}`)
      fs.mkdirSync(path.dirname(backupPath), { recursive: true })
      fs.copyFileSync(configPath, backupPath)
    }
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    const temp = `${configPath}.tmp-${process.pid}`
    fs.writeFileSync(temp, merge.desired, 'utf8')
    fs.renameSync(temp, configPath)
  }
  return {
    schemaVersion: 'GrokPluginRegistrationReceiptV1',
    configPath,
    pluginPath: merge.pluginPath,
    pluginName: merge.pluginName,
    changed: merge.changed,
    dryRun,
    backupPath,
    beforeDigest: merge.beforeDigest,
    afterDigest: merge.afterDigest
  }
}

function retireWorkspaceProjectHostManifest(hostScope, options = {}) {
  if (hostScope?.scope !== HOST_SCOPE.USER_REGISTERED_WORKSPACE || !hostScope.project || !hostScope.projectRoot) {
    return { schemaVersion: 'HostManifestRetirementV1', applicable: false, changed: false }
  }
  const activeRoot = path.join(
    hostScope.workspaceRoot,
    '.devcodex',
    ...String(hostScope.project).split('/').filter(Boolean)
  )
  const manifestFile = path.join(activeRoot, 'managed', 'deployment-manifest.json')
  if (!fs.existsSync(manifestFile)) {
    return { schemaVersion: 'HostManifestRetirementV1', applicable: true, changed: false, manifestFile }
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  const hostSurfaces = new Set([
    'copilot', 'claude', 'codex', 'gemini', 'grok',
    'shared-kernel', 'shared-agent-skills', 'full-fallback',
    'grok-workspace-bridge', 'grok-workspace-plugin'
  ])
  const retired = (manifest.entries || []).filter(entry => hostSurfaces.has(entry.surface))
  const entries = (manifest.entries || []).filter(entry => !hostSurfaces.has(entry.surface))
  const retainedStale = (manifest.staleEntries || []).filter(entry =>
    !hostSurfaces.has(entry.surface) || fs.existsSync(path.join(hostScope.projectRoot, entry.destination))
  )
  const newlyStale = retired.filter(entry => fs.existsSync(path.join(hostScope.projectRoot, entry.destination)))
  const staleByIdentity = new Map()
  for (const entry of [...retainedStale, ...newlyStale]) {
    staleByIdentity.set(`${entry.surface}\0${portable(entry.destination)}\0${entry.source}`, entry)
  }
  const next = {
    ...manifest,
    targetRoot: path.resolve(hostScope.projectRoot),
    generatedAt: new Date().toISOString(),
    entries,
    staleEntries: [...staleByIdentity.values()].sort((a, b) =>
      String(a.destination).localeCompare(String(b.destination)) || String(a.surface).localeCompare(String(b.surface))
    )
  }
  const desired = JSON.stringify(next, null, 2) + '\n'
  const current = fs.readFileSync(manifestFile, 'utf8')
  const changed = desired !== current
  const receipt = {
    schemaVersion: 'HostManifestRetirementV1',
    applicable: true,
    changed,
    manifestFile,
    retiredCurrent: retired.length,
    remainingCurrent: entries.length,
    retainedStale: next.staleEntries.length,
    projectRoot: hostScope.projectRoot,
    workspaceRoot: hostScope.workspaceRoot
  }
  if (changed && !options.dryRun) {
    const temp = `${manifestFile}.tmp-${process.pid}`
    fs.writeFileSync(temp, desired, 'utf8')
    fs.renameSync(temp, manifestFile)
    const receiptFile = path.join(activeRoot, 'managed', 'host-scope-retirement.json')
    fs.writeFileSync(receiptFile, JSON.stringify({ ...receipt, recordedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8')
    receipt.receiptFile = receiptFile
  }
  return receipt
}

module.exports = {
  HOST_SCOPE,
  grokUserConfigPath,
  grokHomePath,
  inspectGrokPluginInstallation,
  mergeGrokPluginRegistration,
  removeGrokPluginRegistration,
  retireWorkspaceProjectHostManifest,
  resolveHostAdapterScope,
  samePath,
  syncGrokPluginInstallation,
  syncGrokWorkspacePluginInstallation,
  uninstallGrokPluginInstallation,
  writeGrokPluginRegistration
}
