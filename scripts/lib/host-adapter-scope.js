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
  if (probe.error?.code === 'ENOENT') {
    return {
      schemaVersion: 'GrokPluginInstallationReceiptV1',
      status: 'unavailable',
      reason: 'grok-cli-not-found',
      pluginPath: portable(source),
      dryRun
    }
  }
  if (probe.status !== 0) {
    const error = new Error(`GROK_PLUGIN_CLI_UNAVAILABLE: ${String(probe.stderr || probe.stdout).trim()}`)
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

function runGrokPluginCommandPreservingConfig(args, env, configSnapshot) {
  const result = spawnSync('grok', args, { encoding: 'utf8', windowsHide: true, env })
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

/**
 * Migrate the managed workspace plugin between local-source identities without
 * deleting the legacy source or allowing Grok to rewrite unrelated user config.
 */
function syncGrokWorkspacePluginInstallation({
  pluginPath,
  legacyPluginPaths = [],
  activeRoot,
  backupDir,
  dryRun = false,
  env = process.env
}) {
  const canonical = path.resolve(pluginPath)
  const legacy = legacyPluginPaths.map(item => path.resolve(item)).filter(item => !samePath(item, canonical))
  const canonicalInstalled = findInstalledLocalPlugin(canonical, env)
  const legacyInstalled = legacy
    .map(source => ({ source, installed: findInstalledLocalPlugin(source, env) }))
    .filter(item => item.installed.repoId)
  const registeredIdentities = [
    ...(canonicalInstalled.repoId ? [{ source: canonical, installed: canonicalInstalled }] : []),
    ...legacyInstalled
  ]
  if (registeredIdentities.length > 1) {
    const error = new Error('GROK_PLUGIN_MIGRATION_IDENTITY_CONFLICT: multiple managed local registrations exist')
    error.code = 'GROK_PLUGIN_MIGRATION_IDENTITY_CONFLICT'
    throw error
  }

  const legacySources = legacy.filter(source => fs.existsSync(source))
  const configPath = grokUserConfigPath(env)
  const configSnapshot = {
    path: configPath,
    existed: fs.existsSync(configPath),
    content: fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : ''
  }
  const planned = Boolean(legacyInstalled.length || legacySources.length)
  if (dryRun) {
    return {
      schemaVersion: 'GrokWorkspacePluginMigrationReceiptV1',
      status: planned ? 'planned-migration' : (canonicalInstalled.repoId ? 'planned-update' : 'planned-install'),
      pluginPath: portable(canonical),
      legacyPluginPaths: legacy.map(portable),
      legacyRegistered: legacyInstalled.map(item => item.installed.repoId),
      legacySources: legacySources.map(portable),
      backupPaths: [],
      dryRun: true
    }
  }

  const probe = spawnSync('grok', ['version'], { encoding: 'utf8', windowsHide: true, env })
  if (probe.error?.code === 'ENOENT') {
    const configBase = configSnapshot.existed
      ? configSnapshot.content
      : (fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '')
    const merge = mergeGrokPluginRegistration(configBase, canonical, { legacyPluginPaths: legacy })
    if (merge.changed || !configSnapshot.existed) writeTextAtomic(configPath, merge.desired)
    const configAfter = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : ''
    const receipt = {
      schemaVersion: 'GrokWorkspacePluginMigrationReceiptV1',
      status: 'unavailable',
      reason: 'grok-cli-not-found-legacy-source-retained',
      pluginPath: portable(canonical),
      legacyPluginPaths: legacy.map(portable),
      legacySources: legacySources.map(portable),
      backupPaths: [],
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
    return {
      ...receipt
    }
  }
  if (probe.status !== 0) {
    const error = new Error(`GROK_PLUGIN_CLI_UNAVAILABLE: ${String(probe.stderr || probe.stdout).trim()}`)
    error.code = 'GROK_PLUGIN_CLI_UNAVAILABLE'
    throw error
  }

  const backupRoot = path.resolve(backupDir || path.join(activeRoot || resolveActiveRuntimeRoot(process.cwd()), '.tmp', 'backups'))
  const backupPaths = []
  let canonicalSynchronized = false
  try {
    if (legacyInstalled.length) {
      const legacyState = legacyInstalled[0]
      const pluginName = Object.keys(legacyState.installed.entry?.plugins || {})
        .find(name => name === 'devcodex-workspace') || 'devcodex-workspace'
      runGrokPluginCommandPreservingConfig(
        ['plugin', 'uninstall', pluginName, '--confirm', '--keep-data'],
        env,
        configSnapshot
      )
      if (findInstalledLocalPlugin(legacyState.source, env).repoId) {
        const error = new Error('GROK_PLUGIN_MIGRATION_UNINSTALL_MISMATCH: legacy registry identity remains')
        error.code = 'GROK_PLUGIN_MIGRATION_UNINSTALL_MISMATCH'
        throw error
      }
    }

    const installation = syncGrokPluginInstallation({ pluginPath: canonical, dryRun: false, env })
    canonicalSynchronized = installation.status === 'verified'
    if (!canonicalSynchronized) {
      const error = new Error(`GROK_PLUGIN_MIGRATION_INSTALL_MISMATCH: ${installation.status}`)
      error.code = 'GROK_PLUGIN_MIGRATION_INSTALL_MISMATCH'
      throw error
    }

    for (const source of legacySources) {
      fs.mkdirSync(backupRoot, { recursive: true })
      const destination = path.join(backupRoot, `grok-workspace-plugin-legacy.${timestampSuffix()}`)
      fs.renameSync(source, destination)
      backupPaths.push({ previousPath: portable(source), backupPath: portable(destination) })
    }

    const configBase = configSnapshot.existed
      ? configSnapshot.content
      : (fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '')
    const merge = mergeGrokPluginRegistration(configBase, canonical, { legacyPluginPaths: legacy })
    if (merge.changed || !configSnapshot.existed) writeTextAtomic(configPath, merge.desired)
    const receipt = {
      schemaVersion: 'GrokWorkspacePluginMigrationReceiptV1',
      status: planned ? 'migrated' : 'verified',
      pluginPath: portable(canonical),
      legacyPluginPaths: legacy.map(portable),
      legacyRegistered: legacyInstalled.map(item => item.installed.repoId),
      backupPaths,
      installation,
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
    const rollback = { sourceRestored: true, registrationRestored: !legacyInstalled.length, configRestored: false }
    for (const moved of [...backupPaths].reverse()) {
      try {
        if (!fs.existsSync(moved.previousPath) && fs.existsSync(moved.backupPath)) {
          fs.renameSync(moved.backupPath, moved.previousPath)
        }
      } catch { rollback.sourceRestored = false }
    }
    try {
      if (canonicalSynchronized && findInstalledLocalPlugin(canonical, env).repoId) {
        runGrokPluginCommandPreservingConfig(
          ['plugin', 'uninstall', 'devcodex-workspace', '--confirm', '--keep-data'],
          env,
          configSnapshot
        )
      }
      if (legacyInstalled.length && fs.existsSync(legacyInstalled[0].source)) {
        runGrokPluginCommandPreservingConfig(
          ['plugin', 'install', legacyInstalled[0].source, '--trust'],
          env,
          configSnapshot
        )
        rollback.registrationRestored = Boolean(findInstalledLocalPlugin(legacyInstalled[0].source, env).repoId)
      }
      if (configSnapshot.existed) {
        writeTextAtomic(configPath, configSnapshot.content)
        rollback.configRestored = fs.readFileSync(configPath, 'utf8') === configSnapshot.content
      } else if (fs.existsSync(configPath)) {
        fs.mkdirSync(backupRoot, { recursive: true })
        fs.renameSync(configPath, path.join(backupRoot, `grok-user-config.rollback.${timestampSuffix()}`))
        rollback.configRestored = true
      } else rollback.configRestored = true
    } catch { }
    error.migrationRollback = rollback
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
