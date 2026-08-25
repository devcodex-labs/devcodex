'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
  buildContentIdentity,
  buildJsonContentIdentity,
  sha256,
  stableStringify
} = require('./content-identity.cjs')
const { createRuntimeStateStore } = require('./runtime-state-store.cjs')
const { resolveExecutionFeatureDecisionForCwd } = require('./execution-optimization-routing.cjs')
const {
  collectWorkspaceProjectNamespaces,
  collectWorkspaceRuntimeNamespaces,
  findLayoutInfo,
  inferProjectFromCwd,
  namespaceRootPath,
  normalizeProjectNamespace
} = require('./workspace-layout.cjs')

const TASK_IDENTITY_SCHEMA = 'TaskIdentityV1'
const TASK_IDENTITY_V2_SCHEMA = 'TaskIdentityV2'
const TASK_INDEX_SCHEMA = 'TaskContinuationIndexV1'
const TASK_RESOLUTION_SCHEMA = 'TaskResolutionV1'
const TASK_KINDS = Object.freeze(['requirements', 'bugs', 'optimizations', 'scenario-tests'])
const TASK_INDEX_RELATIVE_PATH = 'task-continuation-index.json'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

class TaskContinuationError extends Error {
  constructor(code, message, nextStep = '') {
    super(message)
    this.name = 'TaskContinuationError'
    this.code = code
    this.nextStep = nextStep
  }
}

function normalizeTaskName(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .replace(/[A-Z]/g, character => character.toLowerCase())
}

function canonicalTaskIdentityLabel(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/gu, ' ')
}

function isStableTaskId(value) {
  return UUID_PATTERN.test(String(value || '').trim())
}

function splitContinuationProjectQualifier(value) {
  const text = String(value || '').trim()
  const suffix = text.match(/^(.+?)[,，;；]\s*(?:项目|project)\s*[:=：]\s*(.+)$/iu)
  if (!suffix) return { displayQuery: text, projectQuery: '', qualifierForm: '' }
  return {
    displayQuery: String(suffix[1] || '').trim(),
    projectQuery: String(suffix[2] || '').trim(),
    qualifierForm: 'explicit-project-suffix'
  }
}

function parseContinuationCommand(prompt) {
  const normalizedPrompt = String(prompt || '').normalize('NFKC').trim().replace(/\s+/gu, ' ')
  if (!normalizedPrompt.startsWith('继续')) return null
  const spaced = normalizedPrompt.match(/^继续\s+(.+?)$/u)
  const compact = normalizedPrompt.match(/^继续([^\s].*?)任务$/u)
  const match = spaced || compact
  const form = spaced ? 'continue-space-name' : 'continue-name-task'
  if (!match) return null
  const qualified = splitContinuationProjectQualifier(match[1])
  const displayQuery = qualified.displayQuery
  const normalizedQuery = normalizeTaskName(displayQuery)
  if (!normalizedQuery) return null
  return Object.freeze({
    schemaVersion: 'TaskContinuationCommandV1',
    form,
    displayQuery,
    normalizedQuery,
    ...(qualified.projectQuery
      ? {
          projectQuery: qualified.projectQuery,
          projectQualifierForm: qualified.qualifierForm
        }
      : {})
  })
}

function normalizeAliases(aliases, displayName) {
  const displayKey = normalizeTaskName(displayName)
  const seen = new Set()
  const values = []
  for (const alias of Array.isArray(aliases) ? aliases : []) {
    const current = String(alias || '').normalize('NFKC').trim().replace(/\s+/gu, ' ')
    const key = normalizeTaskName(current)
    if (!key || key === displayKey || seen.has(key)) continue
    seen.add(key)
    values.push(current)
  }
  return values
}

function createTaskIdentity({ taskId = crypto.randomUUID(), displayName, aliases = [], createdAt = new Date().toISOString(), identityRevision = 1 }) {
  const identity = {
    schemaVersion: TASK_IDENTITY_SCHEMA,
    taskId: String(taskId || '').toLowerCase(),
    displayName: String(displayName || '').normalize('NFKC').trim().replace(/\s+/gu, ' '),
    aliases: normalizeAliases(aliases, displayName),
    createdAt: String(createdAt || ''),
    identityRevision
  }
  const validation = validateTaskIdentity(identity)
  if (!validation.valid) {
    throw new TaskContinuationError('TASK_IDENTITY_INVALID', validation.errors.join('; '), 'Repair .memory/task.json without changing an existing taskId.')
  }
  return Object.freeze(identity)
}

function validateTaskIdentity(value) {
  if (value?.schemaVersion === TASK_IDENTITY_V2_SCHEMA) return validateTaskIdentityV2(value)
  const errors = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false, errors: ['identity must be an object'] }
  if (value.schemaVersion !== TASK_IDENTITY_SCHEMA) errors.push(`schemaVersion must be ${TASK_IDENTITY_SCHEMA}`)
  if (!UUID_PATTERN.test(String(value.taskId || ''))) errors.push('taskId must be a UUID')
  const canonicalDisplayName = canonicalTaskIdentityLabel(value.displayName)
  if (!canonicalDisplayName) errors.push('displayName is required')
  if (value.displayName !== canonicalDisplayName || Buffer.byteLength(canonicalDisplayName, 'utf8') > 160 ||
      /[\u0000-\u001f\u007f<>:"/\\|?*]/u.test(canonicalDisplayName) || /[. ]$/u.test(canonicalDisplayName)) {
    errors.push('displayName must be one canonical filesystem-safe NFKC label')
  }
  if (!Array.isArray(value.aliases) || value.aliases.length > 32 ||
      value.aliases.some(alias => !canonicalTaskIdentityLabel(alias) || alias !== canonicalTaskIdentityLabel(alias) ||
        Buffer.byteLength(alias, 'utf8') > 300)) {
    errors.push('aliases must be canonical non-empty strings')
  }
  if (Array.isArray(value.aliases)) {
    const normalized = value.aliases.map(normalizeTaskName)
    if (new Set(normalized).size !== normalized.length) errors.push('aliases must be unique after normalization')
    if (normalized.includes(normalizeTaskName(value.displayName))) errors.push('aliases must not repeat displayName')
  }
  if (!Number.isInteger(value.identityRevision) || value.identityRevision < 1) errors.push('identityRevision must be a positive integer')
  if (!Number.isFinite(Date.parse(String(value.createdAt || '')))) errors.push('createdAt must be an ISO-compatible timestamp')
  return { valid: errors.length === 0, errors }
}

function validateTaskIdentityV2(value) {
  const errors = []
  const allowedFields = [
    'schemaVersion', 'taskId', 'displayName', 'aliases', 'project',
    'projectRootIdentityDigest', 'taskKind', 'entryVariant',
    'taskRootRelative', 'createdAt', 'identityVersion', 'identityDigest'
  ]
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, errors: ['identity must be an object'] }
  }
  if (value.schemaVersion !== TASK_IDENTITY_V2_SCHEMA) errors.push(`schemaVersion must be ${TASK_IDENTITY_V2_SCHEMA}`)
  if (!Object.keys(value).every(field => allowedFields.includes(field)) ||
      !allowedFields.every(field => Object.prototype.hasOwnProperty.call(value, field))) {
    errors.push('TaskIdentityV2 fields must exactly match the published immutable core')
  }
  if (!UUID_PATTERN.test(String(value.taskId || ''))) errors.push('taskId must be a UUID')
  if (!normalizeTaskName(value.displayName)) errors.push('displayName is required')
  if (!Array.isArray(value.aliases) || value.aliases.some(alias => !normalizeTaskName(alias))) errors.push('aliases must be non-empty strings')
  if (Array.isArray(value.aliases)) {
    const normalized = value.aliases.map(normalizeTaskName)
    if (new Set(normalized).size !== normalized.length) errors.push('aliases must be unique after normalization')
    if (normalized.includes(normalizeTaskName(value.displayName))) errors.push('aliases must not repeat displayName')
  }
  if (!String(value.project || '').trim()) errors.push('project is required')
  if (!/^[a-f0-9]{64}$/.test(String(value.projectRootIdentityDigest || ''))) errors.push('projectRootIdentityDigest must be sha256')
  if (!TASK_KINDS.includes(value.taskKind)) errors.push(`taskKind must be one of: ${TASK_KINDS.join(', ')}`)
  const variants = {
    requirements: ['new', 'product-provided', 'change', 'continue', 'reopen'],
    bugs: ['new', 'fix', 'continue', 'reopen'],
    optimizations: ['new', 'continue', 'reopen'],
    'scenario-tests': ['new', 'continue', 'reopen']
  }
  if (!variants[value.taskKind]?.includes(value.entryVariant)) errors.push('entryVariant is invalid for taskKind')
  const taskRootRelative = String(value.taskRootRelative || '').replace(/\\/g, '/')
  const taskRootSegments = taskRootRelative.split('/')
  if (!taskRootRelative || path.isAbsolute(taskRootRelative) || taskRootSegments.length !== 2 ||
      taskRootSegments.some(segment => !segment || segment === '.' || segment === '..') ||
      taskRootSegments[0] !== value.taskKind || taskRootSegments[1] !== canonicalTaskIdentityLabel(taskRootSegments[1])) {
    errors.push('taskRootRelative must be an exact two-segment canonical task path')
  }
  if (!Number.isFinite(Date.parse(String(value.createdAt || '')))) errors.push('createdAt must be an ISO-compatible timestamp')
  if (value.identityVersion !== 2) errors.push('identityVersion must be 2')
  const { identityDigest, ...core } = value
  if (!/^[a-f0-9]{64}$/.test(String(identityDigest || '')) ||
      identityDigest !== sha256(stableStringify(core))) errors.push('identityDigest mismatch')
  return { valid: errors.length === 0, errors }
}

function materializeTaskIdentity({ taskRoot, displayName, aliases = [], taskId, createdAt, identityRevision = 1 }) {
  const absoluteTaskRoot = path.resolve(String(taskRoot || ''))
  if (!String(taskRoot || '').trim()) throw new TaskContinuationError('TASK_ROOT_REQUIRED', 'taskRoot is required')
  const memoryRoot = path.join(absoluteTaskRoot, '.memory')
  const identityPath = path.join(memoryRoot, 'task.json')
  const identity = createTaskIdentity({ taskId, displayName, aliases, createdAt, identityRevision })
  fs.mkdirSync(memoryRoot, { recursive: true })
  if (fs.existsSync(identityPath)) {
    throw new TaskContinuationError('TASK_IDENTITY_EXISTS', `task identity already exists: ${identityPath}`, 'Read and validate the existing identity; never replace its taskId during materialization.')
  }
  const tempPath = path.join(memoryRoot, `.task.json.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`)
  try {
    fs.writeFileSync(tempPath, JSON.stringify(identity, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
    fs.linkSync(tempPath, identityPath)
    return { identityPath, identity }
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new TaskContinuationError('TASK_IDENTITY_EXISTS', `task identity already exists: ${identityPath}`, 'Preserve the established taskId and increment identityRevision for later edits.')
    }
    throw error
  } finally {
    try { fs.unlinkSync(tempPath) } catch { }
  }
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return !relative.startsWith('..') && !path.isAbsolute(relative)
}

function safeRelative(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new TaskContinuationError('TASK_PATH_UNSAFE', `task path escapes its resolution root: ${candidate}`)
  }
  return relative.split(path.sep).join('/')
}

function createBudget(scope, overrides = {}) {
  const workspace = scope === 'workspace'
  return {
    maxDirectories: overrides.maxDirectories || (workspace ? 2000 : 500),
    maxBytes: overrides.maxBytes || (workspace ? 16 * 1024 * 1024 : 4 * 1024 * 1024),
    directories: 0,
    bytes: 0
  }
}

function consumeDirectory(budget) {
  budget.directories += 1
  if (budget.directories > budget.maxDirectories) {
    throw new TaskContinuationError('TASK_INDEX_SCALE_BLOCKED', `task inventory exceeds ${budget.maxDirectories} directories`, 'Specify --project to narrow the task search.')
  }
}

function readMetadata(filePath, budget) {
  let stats
  try { stats = fs.statSync(filePath) } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, text: '', digest: '', bytes: 0 }
    throw error
  }
  if (!stats.isFile()) return { exists: true, text: '', digest: '', bytes: 0, nonFile: true }
  budget.bytes += stats.size
  if (budget.bytes > budget.maxBytes) {
    throw new TaskContinuationError('TASK_INDEX_SCALE_BLOCKED', `task metadata exceeds ${budget.maxBytes} bytes`, 'Specify --project to narrow the task search.')
  }
  const bytes = fs.readFileSync(filePath)
  return { exists: true, text: bytes.toString('utf8'), digest: sha256(bytes), bytes: bytes.length }
}

function resolveRootContext({ cwd, project = '', scope = 'auto' }) {
  const absoluteCwd = path.resolve(cwd || process.cwd())
  const layout = findLayoutInfo(absoluteCwd)
  if (!layout.enabled) {
    const activeRoot = path.basename(absoluteCwd).toLowerCase() === '.devcodex'
      ? absoluteCwd
      : path.join(absoluteCwd, '.devcodex')
    return {
      layout,
      scope: 'project',
      project: String(project || path.basename(absoluteCwd)),
      roots: [{ project: String(project || path.basename(absoluteCwd)), activeRoot }],
      relativeBase: activeRoot,
      storeActiveRoot: activeRoot,
      storeRelativePath: TASK_INDEX_RELATIVE_PATH
    }
  }

  const inferred = inferProjectFromCwd(absoluteCwd, layout)
  const requestedScope = scope === 'workspace' || (!project && !inferred && scope !== 'project') ? 'workspace' : 'project'
  if (requestedScope === 'project') {
    let normalized
    try {
      normalized = normalizeProjectNamespace(project || inferred, { layout, allowEmpty: false })
    } catch (error) {
      throw new TaskContinuationError('TASK_PROJECT_REQUIRED', error.message, 'Specify the target project or use workspace scope.')
    }
    return {
      layout,
      scope: 'project',
      project: normalized,
      roots: [{ project: normalized, activeRoot: namespaceRootPath(layout.workspaceRoot, normalized) }],
      relativeBase: layout.workspaceRoot,
      storeActiveRoot: path.join(layout.workspaceRoot, '.devcodex', 'workspace'),
      storeRelativePath: TASK_INDEX_RELATIVE_PATH
    }
  }

  const projects = [...new Set([
    ...collectWorkspaceProjectNamespaces(layout.workspaceRoot),
    ...collectWorkspaceRuntimeNamespaces(layout.workspaceRoot)
  ])].sort((left, right) => left.localeCompare(right))
  const workspaceNamespaceRoot = path.join(layout.workspaceRoot, '.devcodex', 'workspace')
  return {
    layout,
    scope: 'workspace',
    project: '',
    roots: [
      { project: 'workspace', activeRoot: workspaceNamespaceRoot },
      ...projects.map(namespace => ({ project: namespace, activeRoot: namespaceRootPath(layout.workspaceRoot, namespace) }))
    ],
    relativeBase: layout.workspaceRoot,
    storeActiveRoot: workspaceNamespaceRoot,
    storeRelativePath: TASK_INDEX_RELATIVE_PATH
  }
}

function collectTaskInventory(rootContext, budget) {
  const descriptors = []
  for (const root of rootContext.roots) {
    for (const kind of TASK_KINDS) {
      const kindRoot = path.join(root.activeRoot, kind)
      let children
      try { children = fs.readdirSync(kindRoot, { withFileTypes: true }) } catch { continue }
      for (const child of children) {
        if (!child.isDirectory()) continue
        consumeDirectory(budget)
        const taskRoot = path.join(kindRoot, child.name)
        const identityPath = path.join(taskRoot, '.memory', 'task.json')
        const sessionsPath = path.join(taskRoot, '.memory', 'sessions.md')
        const archivedPath = path.join(taskRoot, '.archived')
        const identitySource = readMetadata(identityPath, budget)
        const sessionsSource = readMetadata(sessionsPath, budget)
        const archivedSource = readMetadata(archivedPath, budget)
        descriptors.push({
          project: root.project,
          activeRoot: root.activeRoot,
          kind,
          directoryName: child.name,
          taskRoot,
          relativeTaskPath: safeRelative(rootContext.relativeBase, taskRoot),
          identityPath,
          sessionsPath,
          identitySource,
          sessionsSource,
          archivedSource
        })
      }
    }
  }
  descriptors.sort((left, right) => left.relativeTaskPath.localeCompare(right.relativeTaskPath))
  const identityValue = descriptors.map(item => ({
    path: item.relativeTaskPath,
    identity: item.identitySource.digest,
    sessions: item.sessionsSource.digest,
    archived: item.archivedSource.exists
  }))
  return {
    descriptors,
    sourceIdentity: buildJsonContentIdentity({
      sourceKey: `task-continuation-inventory:${rootContext.scope}:${rootContext.project || '*'}`,
      value: identityValue,
      contractVersion: '1'
    }).identity
  }
}

function parseTaskIdentity(descriptor) {
  if (!descriptor.identitySource.exists) return { identity: null, valid: true, errors: [], legacy: true }
  let value
  try { value = JSON.parse(descriptor.identitySource.text) } catch (error) {
    return { identity: null, valid: false, errors: [`invalid JSON: ${error.message}`], legacy: false }
  }
  const validation = validateTaskIdentity(value)
  return { identity: validation.valid ? value : null, valid: validation.valid, errors: validation.errors, legacy: false }
}

function deriveTaskStatus(descriptor) {
  if (descriptor.archivedSource.exists) return 'completed'
  const statusLine = descriptor.sessionsSource.text.split(/\r?\n/u).find(line => /(?:当前状态|\bstatus\b)/iu.test(line)) || ''
  if (/❌|rejected|已拒绝|已废弃/iu.test(statusLine)) return 'rejected'
  if (/🔄|进行中|active|执行中/iu.test(statusLine)) return 'active'
  if (/✅|completed|已完成|closed/iu.test(statusLine)) return 'completed'
  return 'active'
}

function parseCpBindings(descriptor) {
  const bindings = []
  for (const line of descriptor.sessionsSource.text.split(/\r?\n/u)) {
    const match = line.match(/^\|\s*(CP[123])\s*\|\s*([^|]+)\|\s*([^|]+?)\s*\|\s*([^|]+)\|\s*`?([a-fA-F0-9]{64})`?\s*\|/u)
    if (!match || !/✅/u.test(match[2])) continue
    const artifactCell = match[3].trim()
    const projected = /^\[(.*)\]\((?:<[^>]+>|[^)]+)\)$/u.exec(artifactCell)
    const artifactPath = projected
      ? projected[1].replace(/\\([\\\[\]|])/gu, '$1')
      : artifactCell.replace(/^`|`$/gu, '')
    bindings.push({ phase: match[1], artifactPath, expectedSha256: match[5].toLowerCase() })
  }
  return bindings
}

function resolveBindingPath(descriptor, artifactPath) {
  if (!artifactPath || path.isAbsolute(artifactPath)) return null
  const candidates = [
    path.resolve(path.dirname(descriptor.sessionsPath), artifactPath),
    path.resolve(descriptor.taskRoot, artifactPath),
    path.resolve(descriptor.activeRoot, artifactPath)
  ]
  return candidates.find(candidate => isInside(descriptor.activeRoot, candidate) && fs.existsSync(candidate)) ||
    candidates.find(candidate => isInside(descriptor.activeRoot, candidate)) || null
}

function inspectTaskDescriptor(descriptor, budget) {
  const parsedIdentity = parseTaskIdentity(descriptor)
  const displayName = parsedIdentity.identity?.displayName || descriptor.directoryName
  const aliases = parsedIdentity.identity?.aliases || []
  const bindings = parseCpBindings(descriptor)
  const confirmationEvidence = []
  const staleConfirmations = []
  for (const binding of bindings) {
    const artifactFile = resolveBindingPath(descriptor, binding.artifactPath)
    const source = artifactFile ? readMetadata(artifactFile, budget) : { exists: false, digest: '', bytes: 0 }
    const evidence = {
      phase: binding.phase,
      artifactPath: binding.artifactPath,
      expectedSha256: binding.expectedSha256,
      observedSha256: source.digest || '',
      verified: Boolean(source.exists && source.digest === binding.expectedSha256)
    }
    confirmationEvidence.push(evidence)
    if (!evidence.verified) staleConfirmations.push(evidence)
  }
  const sourceIdentity = buildJsonContentIdentity({
    sourceKey: `task-continuation-source:${descriptor.relativeTaskPath}`,
    value: {
      identity: descriptor.identitySource.digest,
      sessions: descriptor.sessionsSource.digest,
      archived: descriptor.archivedSource.exists,
      confirmations: confirmationEvidence.map(item => ({
        phase: item.phase,
        artifactPath: item.artifactPath,
        expectedSha256: item.expectedSha256,
        observedSha256: item.observedSha256
      }))
    },
    contractVersion: '1'
  }).identity
  return {
    taskId: parsedIdentity.identity?.taskId || null,
    displayName,
    normalizedDisplayName: normalizeTaskName(displayName),
    aliases,
    normalizedAliases: aliases.map(normalizeTaskName),
    identityRevision: parsedIdentity.identity?.identityRevision || parsedIdentity.identity?.identityVersion || null,
    identityValid: parsedIdentity.valid,
    identityErrors: parsedIdentity.errors,
    legacy: parsedIdentity.legacy,
    project: descriptor.project,
    kind: descriptor.kind,
    relativeTaskPath: descriptor.relativeTaskPath,
    status: deriveTaskStatus(descriptor),
    sourceIdentity,
    confirmationEvidence,
    staleConfirmations
  }
}

function buildIndex(rootContext, inventory, budget, observedAt) {
  return {
    schemaVersion: TASK_INDEX_SCHEMA,
    indexScope: rootContext.scope,
    project: rootContext.project || null,
    sourceIdentity: inventory.sourceIdentity,
    lastObservedAt: new Date(observedAt).toISOString(),
    entries: inventory.descriptors.map(descriptor => inspectTaskDescriptor(descriptor, budget))
  }
}

function validateIndex(value, rootContext) {
  return Boolean(
    value && value.schemaVersion === TASK_INDEX_SCHEMA &&
    value.indexScope === rootContext.scope &&
    String(value.project || '') === String(rootContext.project || '') &&
    Array.isArray(value.entries)
  )
}

function minimalCandidate(entry) {
  return {
    taskId: entry.taskId,
    displayName: entry.displayName,
    project: entry.project,
    kind: entry.kind,
    status: entry.status,
    legacy: Boolean(entry.legacy)
  }
}

function findExactMatches(entries, normalizedQuery) {
  const byId = entries.filter(entry => entry.taskId && String(entry.taskId).toLowerCase() === normalizedQuery)
  if (byId.length) return byId
  const active = entries.filter(entry => entry.status === 'active')
  const byDisplay = active.filter(entry => entry.normalizedDisplayName === normalizedQuery)
  if (byDisplay.length) return byDisplay
  const byAlias = active.filter(entry => entry.normalizedAliases.includes(normalizedQuery))
  if (byAlias.length) return byAlias
  return entries.filter(entry => entry.status !== 'active' && (
    entry.normalizedDisplayName === normalizedQuery ||
    entry.normalizedAliases.includes(normalizedQuery) ||
    (entry.taskId && String(entry.taskId).toLowerCase() === normalizedQuery)
  ))
}

function editDistance(left, right) {
  const a = [...left]
  const b = [...right]
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row]
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1)
      )
    }
    previous.splice(0, previous.length, ...current)
  }
  return previous[b.length]
}

function buildSuggestions(entries, normalizedQuery) {
  const ranked = []
  for (const entry of entries) {
    const names = [entry.normalizedDisplayName, ...entry.normalizedAliases].filter(Boolean)
    let best = Infinity
    let prefix = false
    for (const name of names) {
      const isSubstring = name.includes(normalizedQuery) || normalizedQuery.includes(name)
      const ratio = editDistance(name, normalizedQuery) / Math.max(name.length, normalizedQuery.length, 1)
      if (isSubstring) prefix = true
      if (ratio < best) best = ratio
    }
    if (!prefix && best > 0.35) continue
    ranked.push({ entry, group: prefix ? 0 : 1, score: best })
  }
  ranked.sort((left, right) => left.group - right.group || left.score - right.score || left.entry.displayName.localeCompare(right.entry.displayName))
  return ranked.slice(0, 5).map(item => ({ ...minimalCandidate(item.entry), matchDistanceRatio: Number(item.score.toFixed(3)) }))
}

function baseResolution(rootContext, displayQuery, normalizedQuery, indexEvidence) {
  return {
    schemaVersion: TASK_RESOLUTION_SCHEMA,
    query: displayQuery,
    normalizedQuery,
    scope: rootContext.scope,
    requestedProject: rootContext.project || null,
    index: indexEvidence
  }
}

function descriptorMap(inventory) {
  return new Map(inventory.descriptors.map(descriptor => [descriptor.relativeTaskPath, descriptor]))
}

function resolveUniqueActiveTaskContinuation({ cwd = process.cwd(), project = '', scope = 'auto', budgets = {}, now = () => Date.now() } = {}) {
  let rootContext
  let budget
  let inventory
  try {
    rootContext = resolveRootContext({ cwd, project, scope })
    budget = createBudget(rootContext.scope, budgets)
    inventory = collectTaskInventory(rootContext, budget)
  } catch (error) {
    if (error instanceof TaskContinuationError && error.code === 'TASK_INDEX_SCALE_BLOCKED') {
      return {
        schemaVersion: TASK_RESOLUTION_SCHEMA,
        status: 'scale-blocked',
        errorCode: error.code,
        message: error.message,
        nextStep: error.nextStep
      }
    }
    throw error
  }
  const active = inventory.descriptors.map(descriptor => inspectTaskDescriptor(descriptor, budget)).filter(item => item.status === 'active')
  if (active.length !== 1) {
    return {
      ...baseResolution(rootContext, '', '', { state: 'bounded-unique-active-scan', sourceIdentity: inventory.sourceIdentity }),
      status: active.length ? 'ambiguous' : 'not-found',
      errorCode: active.length ? 'TASK_AMBIGUOUS' : 'TASK_SELECTOR_REQUIRED',
      message: active.length ? `${active.length} active tasks require an explicit --task selector.` : 'No unique active task is available.',
      candidates: active.slice(0, 5).map(minimalCandidate),
      nextStep: 'Specify --task with an exact display name, alias, or stable taskId.',
      scan: { directories: budget.directories, bytes: budget.bytes }
    }
  }
  const selected = active[0]
  return resolveTaskContinuation({
    cwd,
    name: selected.identityValid && selected.taskId ? selected.taskId : selected.displayName,
    project,
    scope,
    budgets,
    now
  })
}

function resolveTaskContinuation({
  cwd = process.cwd(),
  name,
  project = '',
  scope = 'auto',
  budgets = {},
  persistIndex = true,
  useIndex,
  now = () => Date.now()
} = {}) {
  const displayQuery = String(name || '').normalize('NFKC').trim().replace(/\s+/gu, ' ')
  const normalizedQuery = normalizeTaskName(displayQuery)
  if (!normalizedQuery) {
    throw new TaskContinuationError('TASK_NAME_REQUIRED', 'task name is required', 'Use: devcodex task resolve <name> [--project <name>] [--json]')
  }

  let rootContext
  let budget
  let inventory
  try {
    rootContext = resolveRootContext({ cwd, project, scope })
    budget = createBudget(rootContext.scope, budgets)
    inventory = collectTaskInventory(rootContext, budget)
  } catch (error) {
    if (error instanceof TaskContinuationError && error.code === 'TASK_INDEX_SCALE_BLOCKED') {
      return {
        schemaVersion: TASK_RESOLUTION_SCHEMA,
        status: 'scale-blocked',
        query: displayQuery,
        normalizedQuery,
        errorCode: error.code,
        message: error.message,
        nextStep: error.nextStep,
        scan: budget ? { directories: budget.directories, bytes: budget.bytes, maxDirectories: budget.maxDirectories, maxBytes: budget.maxBytes } : null
      }
    }
    throw error
  }

  const optimizationActiveRoot = rootContext.scope === 'workspace'
    ? path.join(rootContext.layout.workspaceRoot, '.devcodex', 'workspace')
    : rootContext.roots[0].activeRoot
  const featureDecision = resolveExecutionFeatureDecisionForCwd({
    cwd,
    activeRoot: optimizationActiveRoot,
    project,
    featureId: 'task-index-acceleration'
  })
  const indexEnabled = useIndex !== false && featureDecision.optimizationAllowed
  const store = createRuntimeStateStore({
    activeRoot: rootContext.storeActiveRoot,
    project: rootContext.scope === 'workspace' ? 'workspace' : rootContext.project,
    relativePath: rootContext.storeRelativePath,
    maxBytes: rootContext.scope === 'workspace' ? 16 * 1024 * 1024 : 4 * 1024 * 1024,
    lockWaitMs: 2000,
    maxWrites: persistIndex && indexEnabled ? 1 : 0,
    now
  })
  const readReceipt = indexEnabled
    ? store.read({ expectedIdentity: inventory.sourceIdentity })
    : { status: 'bypassed', errorCode: featureDecision.reasonCode }
  let index = readReceipt.status === 'fresh' && validateIndex(readReceipt.value, rootContext) ? readReceipt.value : null
  let writeReceipt = null
  const disabledState = featureDecision.configurationMode === 'full-only' || featureDecision.stateMode === 'full-only'
    ? 'disabled-full-only'
    : (['invalid', 'bypassed', 'error'].includes(featureDecision.stateStatus) ? 'disabled-fail-closed' : 'disabled-feature-lifecycle')
  let indexState = index ? 'reused' : (indexEnabled ? 'rebuilt-memory' : disabledState)
  const rebuildReason = index ? null : (readReceipt.status === 'fresh' ? 'invalid-index-contract' : readReceipt.status)
  if (!index) {
    try {
      index = buildIndex(rootContext, inventory, budget, now())
    } catch (error) {
      if (error instanceof TaskContinuationError && error.code === 'TASK_INDEX_SCALE_BLOCKED') {
        return {
          ...baseResolution(rootContext, displayQuery, normalizedQuery, { state: 'scale-blocked', filePath: store.filePath }),
          status: 'scale-blocked',
          errorCode: error.code,
          message: error.message,
          nextStep: error.nextStep,
          scan: { directories: budget.directories, bytes: budget.bytes, maxDirectories: budget.maxDirectories, maxBytes: budget.maxBytes }
        }
      }
      throw error
    }
    if (indexEnabled) {
      writeReceipt = store.write(index)
      if (writeReceipt.status === 'persisted') indexState = 'rebuilt-persisted'
      else if (writeReceipt.status === 'bypassed') indexState = 'rebuilt-bypassed'
      else if (writeReceipt.status === 'error') indexState = 'rebuilt-error'
    }
  }

  const indexEvidence = {
    state: indexState,
    rebuildReason,
    filePath: store.filePath,
    sourceIdentity: inventory.sourceIdentity,
    readStatus: readReceipt.status,
    writeStatus: writeReceipt?.status || null,
    featureDecision: {
      schemaVersion: featureDecision.schemaVersion,
      featureId: featureDecision.featureId,
      lifecycleState: featureDecision.lifecycleState,
      optimizationAllowed: featureDecision.optimizationAllowed,
      reasonCode: featureDecision.reasonCode,
      stateStatus: featureDecision.stateStatus
    }
  }
  const base = baseResolution(rootContext, displayQuery, normalizedQuery, indexEvidence)
  const matches = findExactMatches(index.entries, normalizedQuery)
  if (!matches.length) {
    return {
      ...base,
      status: 'not-found',
      errorCode: 'TASK_NOT_FOUND',
      message: `No exact task match was found for ${displayQuery}.`,
      suggestions: buildSuggestions(index.entries, normalizedQuery),
      nextStep: rootContext.scope === 'workspace' ? 'Choose one suggestion or include the exact task name.' : 'Check the exact name or retry without --project to search the workspace.',
      scan: { directories: budget.directories, bytes: budget.bytes }
    }
  }
  if (matches.length > 1) {
    return {
      ...base,
      status: 'ambiguous',
      errorCode: 'TASK_AMBIGUOUS',
      message: `${matches.length} exact task matches require project or taskId disambiguation.`,
      candidates: matches.slice(0, 5).map(minimalCandidate),
      nextStep: 'Specify --project or use the stable taskId.',
      scan: { directories: budget.directories, bytes: budget.bytes }
    }
  }

  let selected = matches[0]
  if (indexState === 'reused') {
    const descriptor = descriptorMap(inventory).get(selected.relativeTaskPath)
    if (!descriptor) {
      return {
        ...base,
        status: 'not-found',
        errorCode: 'TASK_SOURCE_MISSING',
        message: 'The indexed task path is no longer present in the bounded source inventory.',
        suggestions: [],
        nextStep: 'Retry to rebuild the derived task index.'
      }
    }
    selected = inspectTaskDescriptor(descriptor, budget)
  }

  const candidate = minimalCandidate(selected)
  if (!selected.identityValid) {
    return {
      ...base,
      status: 'stale-confirmation',
      errorCode: 'TASK_IDENTITY_INVALID',
      message: `Task identity is invalid: ${selected.identityErrors.join('; ')}`,
      candidate,
      nextStep: 'Repair .memory/task.json while preserving any established taskId.'
    }
  }
  if (selected.status === 'completed' || selected.status === 'rejected') {
    return {
      ...base,
      status: selected.status,
      errorCode: selected.status === 'completed' ? 'TASK_COMPLETED' : 'TASK_REJECTED',
      message: `Task ${selected.displayName} is ${selected.status} and will not be reopened automatically.`,
      candidate,
      nextStep: 'Request an explicit reopen or create a new branch task.'
    }
  }
  if (selected.staleConfirmations.length) {
    return {
      ...base,
      status: 'stale-confirmation',
      errorCode: 'TASK_CONFIRMATION_STALE',
      message: `Task ${selected.displayName} has ${selected.staleConfirmations.length} stale CP binding(s).`,
      candidate,
      staleConfirmations: selected.staleConfirmations,
      nextStep: `Return to ${selected.staleConfirmations[0].phase} and bind the current artifact digest before continuing.`
    }
  }

  const taskRoot = path.resolve(rootContext.relativeBase, selected.relativeTaskPath)
  if (!isInside(rootContext.relativeBase, taskRoot)) {
    throw new TaskContinuationError('TASK_PATH_UNSAFE', 'resolved task path escaped the bounded root')
  }
  return {
    ...base,
    status: 'resolved-active',
    candidate: { ...candidate, taskRoot, relativeTaskPath: selected.relativeTaskPath },
    sourceIdentity: selected.sourceIdentity,
    confirmationEvidence: selected.confirmationEvidence,
    rehydration: {
      identityPath: path.join(taskRoot, '.memory', 'task.json'),
      sessionsPath: path.join(taskRoot, '.memory', 'sessions.md'),
      rule: 'Resolve by identity only; rehydrate sessions and current artifacts before continuing.'
    },
    scan: { directories: budget.directories, bytes: budget.bytes }
  }
}

module.exports = {
  TASK_IDENTITY_SCHEMA,
  TASK_IDENTITY_V2_SCHEMA,
  TASK_INDEX_SCHEMA,
  TASK_KINDS,
  TASK_RESOLUTION_SCHEMA,
  TaskContinuationError,
  buildSuggestions,
  createTaskIdentity,
  isStableTaskId,
  materializeTaskIdentity,
  normalizeTaskName,
  parseContinuationCommand,
  resolveUniqueActiveTaskContinuation,
  resolveRootContext,
  resolveTaskContinuation,
  validateTaskIdentity,
  validateTaskIdentityV2
}
