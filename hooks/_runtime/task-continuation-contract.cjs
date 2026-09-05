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
const TASK_LOCATOR_PAGE_SIZE = 256
const TASK_LOCATOR_IDENTITY_MAX_BYTES = 64 * 1024
const TASK_LOCATOR_SESSION_PREFIX_BYTES = 16 * 1024
const TASK_LOCATOR_PAGE_MAX_BYTES = 16 * 1024 * 1024
const TASK_CANONICAL_CANDIDATE_LIMIT = 5
const TASK_CANONICAL_FILE_MAX_BYTES = 8 * 1024 * 1024

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
  if (/^继续(?:任务)?[。！!？?]?$/u.test(normalizedPrompt)) {
    return Object.freeze({
      schemaVersion: 'TaskContinuationCommandV1',
      form: 'continue-bare',
      displayQuery: '',
      normalizedQuery: '',
      bare: true
    })
  }
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

function evaluatePortableTaskIdentityBinding(value, expected = {}) {
  const errors = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      schemaVersion: 'PortableTaskIdentityBindingDecisionV1',
      valid: false,
      errors: ['identity is required'],
      relocated: false
    }
  }
  if (expected.taskId && String(value.taskId || '').toLowerCase() !== String(expected.taskId).toLowerCase()) {
    errors.push('taskId mismatch')
  }
  if (value.schemaVersion === TASK_IDENTITY_V2_SCHEMA) {
    const identityValidation = validateTaskIdentityV2(value)
    if (!identityValidation.valid) {
      errors.push(...identityValidation.errors.map(error => `identity invalid: ${error}`))
    }
    if (expected.project && value.project !== expected.project) errors.push('project mismatch')
    if (expected.taskKind && value.taskKind !== expected.taskKind) errors.push('taskKind mismatch')
    if (expected.taskRootRelative && value.taskRootRelative !== String(expected.taskRootRelative).replace(/\\/g, '/')) {
      errors.push('taskRootRelative mismatch')
    }
  } else {
    errors.push(`schemaVersion must be ${TASK_IDENTITY_V2_SCHEMA}`)
  }
  const originProjectRootIdentityDigest = value.schemaVersion === TASK_IDENTITY_V2_SCHEMA
    ? String(value.projectRootIdentityDigest || '')
    : ''
  const currentProjectRootIdentityDigest = String(expected.currentProjectRootIdentityDigest || '')
  return {
    schemaVersion: 'PortableTaskIdentityBindingDecisionV1',
    valid: errors.length === 0,
    errors,
    relocated: Boolean(
      originProjectRootIdentityDigest && currentProjectRootIdentityDigest &&
      originProjectRootIdentityDigest !== currentProjectRootIdentityDigest
    ),
    originProjectRootIdentityDigest: originProjectRootIdentityDigest || null,
    currentProjectRootIdentityDigest: currentProjectRootIdentityDigest || null,
    liveAuthority: 'ProjectTargetLeaseV2+active-root-containment'
  }
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
    pageSize: TASK_LOCATOR_PAGE_SIZE,
    maxIdentityBytes: TASK_LOCATOR_IDENTITY_MAX_BYTES,
    maxPageBytes: TASK_LOCATOR_PAGE_MAX_BYTES,
    maxCandidates: TASK_CANONICAL_CANDIDATE_LIMIT,
    directories: 0,
    bytes: 0,
    identityBytes: 0,
    canonicalBytes: 0,
    identityReads: 0,
    sessionPrefixReads: 0,
    archivedReads: 0,
    canonicalReads: 0,
    exactHitStopped: false,
    pages: 0,
    pageIdentityBytes: 0,
    localizedErrors: 0
  }
}

function consumeDirectory(budget) {
  if (budget.directories % budget.pageSize === 0) {
    budget.pages += 1
    budget.pageIdentityBytes = 0
  }
  budget.directories += 1
}

function readLocatorMetadata(filePath, maxBytes, budget, {
  countIdentity = false,
  countSessionPrefix = false,
  countArchived = false
} = {}) {
  if (countIdentity) budget.identityReads += 1
  if (countSessionPrefix) budget.sessionPrefixReads += 1
  if (countArchived) budget.archivedReads += 1
  let stats
  try {
    stats = fs.statSync(filePath)
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, text: '', digest: '', bytes: 0, size: 0, mtimeMs: 0 }
    budget.localizedErrors += 1
    return { exists: false, text: '', digest: '', bytes: 0, size: 0, mtimeMs: 0, readError: error.code || error.message }
  }
  if (!stats.isFile()) {
    budget.localizedErrors += 1
    return { exists: true, text: '', digest: '', bytes: 0, size: 0, mtimeMs: stats.mtimeMs, nonFile: true }
  }
  const size = stats.size
  const tooLarge = size > maxBytes
  const bytesToRead = tooLarge && countIdentity ? 0 : Math.min(size, maxBytes)
  let bytes = Buffer.alloc(0)
  if (bytesToRead > 0) {
    let handle = null
    try {
      handle = fs.openSync(filePath, 'r')
      bytes = Buffer.alloc(bytesToRead)
      const read = fs.readSync(handle, bytes, 0, bytesToRead, 0)
      bytes = bytes.subarray(0, read)
      const after = fs.fstatSync(handle)
      if (after.size !== stats.size || after.mtimeMs !== stats.mtimeMs) {
        budget.localizedErrors += 1
        return { exists: true, text: '', digest: '', bytes: 0, size: after.size, mtimeMs: after.mtimeMs, readError: 'TASK_METADATA_DRIFT' }
      }
    } catch (error) {
      budget.localizedErrors += 1
      return { exists: true, text: '', digest: '', bytes: 0, size, mtimeMs: stats.mtimeMs, readError: error.code || error.message }
    } finally {
      if (handle !== null) {
        try { fs.closeSync(handle) } catch {}
      }
    }
  }
  if (countIdentity) {
    budget.identityBytes += bytes.length
    budget.pageIdentityBytes += bytes.length
    if (budget.pageIdentityBytes > budget.maxPageBytes) {
      budget.localizedErrors += 1
      return { exists: true, text: '', digest: '', bytes: 0, size, mtimeMs: stats.mtimeMs, pageLimitExceeded: true }
    }
  }
  if (tooLarge && countIdentity) budget.localizedErrors += 1
  return {
    exists: true,
    text: bytes.toString('utf8'),
    digest: bytes.length ? sha256(bytes) : '',
    bytes: bytes.length,
    size,
    mtimeMs: stats.mtimeMs,
    truncated: tooLarge && !countIdentity,
    tooLarge: tooLarge && countIdentity
  }
}

function readCanonicalMetadata(filePath, budget, maxFileBytes = TASK_CANONICAL_FILE_MAX_BYTES) {
  budget.canonicalReads += 1
  let stats
  try { stats = fs.statSync(filePath) } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, text: '', digest: '', bytes: 0, size: 0 }
    budget.localizedErrors += 1
    return { exists: false, text: '', digest: '', bytes: 0, size: 0, readError: error.code || error.message }
  }
  if (!stats.isFile()) {
    budget.localizedErrors += 1
    return { exists: true, text: '', digest: '', bytes: 0, size: 0, nonFile: true }
  }
  if (stats.size > maxFileBytes) {
    budget.localizedErrors += 1
    return { exists: true, text: '', digest: '', bytes: 0, size: stats.size, tooLarge: true }
  }
  try {
    const bytes = fs.readFileSync(filePath)
    const after = fs.statSync(filePath)
    if (after.size !== stats.size || after.mtimeMs !== stats.mtimeMs || bytes.length !== stats.size) {
      budget.localizedErrors += 1
      return { exists: true, text: '', digest: '', bytes: 0, size: after.size, readError: 'TASK_METADATA_DRIFT' }
    }
    budget.canonicalBytes += bytes.length
    budget.bytes += bytes.length
    return { exists: true, text: bytes.toString('utf8'), digest: sha256(bytes), bytes: bytes.length, size: bytes.length }
  } catch (error) {
    budget.localizedErrors += 1
    return { exists: true, text: '', digest: '', bytes: 0, size: stats.size, readError: error.code || error.message }
  }
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
      try {
        children = fs.readdirSync(kindRoot, { withFileTypes: true })
      } catch (error) {
        if (error?.code !== 'ENOENT') budget.localizedErrors += 1
        continue
      }
      children.sort((left, right) => left.name.localeCompare(right.name))
      for (const child of children) {
        if (!child.isDirectory()) continue
        consumeDirectory(budget)
        const taskRoot = path.join(kindRoot, child.name)
        const identityPath = path.join(taskRoot, '.memory', 'task.json')
        const sessionsPath = path.join(taskRoot, '.memory', 'sessions.md')
        const archivedPath = path.join(taskRoot, '.archived')
        const identitySource = readLocatorMetadata(identityPath, budget.maxIdentityBytes, budget, { countIdentity: true })
        const sessionsSource = readLocatorMetadata(sessionsPath, TASK_LOCATOR_SESSION_PREFIX_BYTES, budget, { countSessionPrefix: true })
        const archivedSource = readLocatorMetadata(archivedPath, 0, budget, { countArchived: true })
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
    identitySize: item.identitySource.size,
    identityMtimeMs: item.identitySource.mtimeMs,
    sessionsPrefix: item.sessionsSource.digest,
    sessionsSize: item.sessionsSource.size,
    sessionsMtimeMs: item.sessionsSource.mtimeMs,
    archived: item.archivedSource.exists,
    archivedMtimeMs: item.archivedSource.mtimeMs
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
  if (descriptor.identitySource.tooLarge) {
    return { identity: null, valid: false, errors: [`identity exceeds ${TASK_LOCATOR_IDENTITY_MAX_BYTES} bytes`], legacy: false }
  }
  if (descriptor.identitySource.nonFile || descriptor.identitySource.readError || descriptor.identitySource.pageLimitExceeded) {
    const reason = descriptor.identitySource.readError || (descriptor.identitySource.nonFile ? 'identity is not a file' : 'locator page byte limit exceeded')
    return { identity: null, valid: false, errors: [reason], legacy: false }
  }
  let value
  try { value = JSON.parse(descriptor.identitySource.text) } catch (error) {
    return { identity: null, valid: false, errors: [`invalid JSON: ${error.message}`], legacy: false }
  }
  const validation = validateTaskIdentity(value)
  const errors = [...validation.errors]
  if (value?.schemaVersion === TASK_IDENTITY_V2_SCHEMA) {
    if (value.project !== descriptor.project) errors.push('identity project does not match its namespace')
    if (value.taskKind !== descriptor.kind) errors.push('identity taskKind does not match its task directory')
    if (value.taskRootRelative !== `${descriptor.kind}/${descriptor.directoryName}`) {
      errors.push('identity taskRootRelative does not match its task directory')
    }
  }
  return { identity: errors.length ? null : value, valid: errors.length === 0, errors, legacy: false }
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

function locatorSourceIdentity(descriptor) {
  return buildJsonContentIdentity({
    sourceKey: `task-continuation-locator:${descriptor.relativeTaskPath}`,
    value: {
      identity: descriptor.identitySource.digest,
      identitySize: descriptor.identitySource.size,
      identityMtimeMs: descriptor.identitySource.mtimeMs,
      sessionsPrefix: descriptor.sessionsSource.digest,
      sessionsSize: descriptor.sessionsSource.size,
      sessionsMtimeMs: descriptor.sessionsSource.mtimeMs,
      archived: descriptor.archivedSource.exists,
      archivedMtimeMs: descriptor.archivedSource.mtimeMs
    },
    contractVersion: '2'
  }).identity
}

function inspectLocatorDescriptor(descriptor) {
  const parsedIdentity = parseTaskIdentity(descriptor)
  const displayName = parsedIdentity.identity?.displayName || descriptor.directoryName
  const aliases = parsedIdentity.identity?.aliases || []
  return {
    taskId: parsedIdentity.identity?.taskId || null,
    displayName,
    normalizedDisplayName: normalizeTaskName(displayName),
    directoryName: descriptor.directoryName,
    normalizedDirectoryName: normalizeTaskName(descriptor.directoryName),
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
    sourceIdentity: locatorSourceIdentity(descriptor),
    confirmationEvidence: [],
    staleConfirmations: [],
    historicalStaleConfirmations: [],
    locatorOnly: true
  }
}

function inspectTaskDescriptor(descriptor, budget) {
  const canonicalDescriptor = {
    ...descriptor,
    identitySource: readCanonicalMetadata(descriptor.identityPath, budget, TASK_LOCATOR_IDENTITY_MAX_BYTES),
    sessionsSource: readCanonicalMetadata(descriptor.sessionsPath, budget),
    archivedSource: readLocatorMetadata(path.join(descriptor.taskRoot, '.archived'), 0, budget)
  }
  const parsedIdentity = parseTaskIdentity(canonicalDescriptor)
  const displayName = parsedIdentity.identity?.displayName || descriptor.directoryName
  const aliases = parsedIdentity.identity?.aliases || []
  const canonicalErrors = []
  if (!canonicalDescriptor.sessionsSource.exists) canonicalErrors.push('sessions metadata is missing')
  if (canonicalDescriptor.sessionsSource.tooLarge) canonicalErrors.push(`sessions metadata exceeds ${TASK_CANONICAL_FILE_MAX_BYTES} bytes`)
  if (canonicalDescriptor.sessionsSource.nonFile) canonicalErrors.push('sessions metadata is not a file')
  if (canonicalDescriptor.sessionsSource.readError) canonicalErrors.push(`sessions metadata read failed: ${canonicalDescriptor.sessionsSource.readError}`)
  const bindings = canonicalErrors.length ? [] : parseCpBindings(canonicalDescriptor)
  const confirmationEvidence = []
  for (const [index, binding] of bindings.entries()) {
    const artifactFile = resolveBindingPath(canonicalDescriptor, binding.artifactPath)
    const source = artifactFile ? readCanonicalMetadata(artifactFile, budget) : { exists: false, digest: '', bytes: 0 }
    const evidence = {
      phase: binding.phase,
      artifactPath: binding.artifactPath,
      expectedSha256: binding.expectedSha256,
      observedSha256: source.digest || '',
      verified: Boolean(source.exists && source.digest === binding.expectedSha256),
      historical: index < bindings.length - 1,
      ...(source.tooLarge ? { errorCode: 'TASK_CP_ARTIFACT_TOO_LARGE' } : {}),
      ...(source.readError || source.nonFile ? { errorCode: 'TASK_CP_ARTIFACT_UNREADABLE' } : {})
    }
    confirmationEvidence.push(evidence)
  }
  const latestConfirmedHead = confirmationEvidence.length ? confirmationEvidence[confirmationEvidence.length - 1] : null
  const staleConfirmations = latestConfirmedHead && !latestConfirmedHead.verified ? [latestConfirmedHead] : []
  const historicalStaleConfirmations = confirmationEvidence.filter(item => item.historical && !item.verified)
  const sourceIdentity = buildJsonContentIdentity({
    sourceKey: `task-continuation-source:${descriptor.relativeTaskPath}`,
    value: {
      identity: canonicalDescriptor.identitySource.digest,
      sessions: canonicalDescriptor.sessionsSource.digest,
      archived: canonicalDescriptor.archivedSource.exists,
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
    directoryName: descriptor.directoryName,
    normalizedDirectoryName: normalizeTaskName(descriptor.directoryName),
    aliases,
    normalizedAliases: aliases.map(normalizeTaskName),
    identityRevision: parsedIdentity.identity?.identityRevision || parsedIdentity.identity?.identityVersion || null,
    identityValid: parsedIdentity.valid,
    identityErrors: parsedIdentity.errors,
    legacy: parsedIdentity.legacy,
    project: descriptor.project,
    kind: descriptor.kind,
    relativeTaskPath: descriptor.relativeTaskPath,
    status: deriveTaskStatus(canonicalDescriptor),
    sourceIdentity,
    confirmationEvidence,
    staleConfirmations,
    historicalStaleConfirmations,
    latestConfirmedHead,
    canonicalErrors,
    locatorOnly: false
  }
}

function buildIndex(rootContext, inventory, budget, observedAt) {
  return {
    schemaVersion: TASK_INDEX_SCHEMA,
    indexScope: rootContext.scope,
    project: rootContext.project || null,
    sourceIdentity: inventory.sourceIdentity,
    lastObservedAt: new Date(observedAt).toISOString(),
    entries: inventory.descriptors.map(inspectLocatorDescriptor)
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
    directoryName: entry.directoryName,
    project: entry.project,
    kind: entry.kind,
    status: entry.status,
    legacy: Boolean(entry.legacy),
    relativeTaskPath: entry.relativeTaskPath,
    selectionDigest: entry.sourceIdentity?.digest || null
  }
}

function findExactMatches(entries, normalizedQuery) {
  const byId = entries.filter(entry => entry.taskId && String(entry.taskId).toLowerCase() === normalizedQuery)
  if (byId.length) return byId
  const active = entries.filter(entry => entry.status === 'active')
  const byDisplay = active.filter(entry => entry.normalizedDisplayName === normalizedQuery)
  if (byDisplay.length) return byDisplay
  const byDirectory = active.filter(entry => entry.normalizedDirectoryName === normalizedQuery)
  if (byDirectory.length) return byDirectory
  const byAlias = active.filter(entry => entry.normalizedAliases.includes(normalizedQuery))
  if (byAlias.length) return byAlias
  return entries.filter(entry => entry.status !== 'active' && (
    entry.normalizedDisplayName === normalizedQuery ||
    entry.normalizedDirectoryName === normalizedQuery ||
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
    const names = [entry.normalizedDisplayName, entry.normalizedDirectoryName, ...entry.normalizedAliases].filter(Boolean)
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
    observedAt: new Date().toISOString(),
    query: displayQuery,
    normalizedQuery,
    scope: rootContext.scope,
    requestedProject: rootContext.project || null,
    index: indexEvidence,
    mutationAuthority: false,
    authority: 'selection-only'
  }
}

function descriptorMap(inventory) {
  return new Map(inventory.descriptors.map(descriptor => [descriptor.relativeTaskPath, descriptor]))
}

function emptyLocatorSource() {
  return { exists: false, text: '', digest: '', bytes: 0, size: 0, mtimeMs: 0 }
}

function identityOnlyDescriptor(rootContext, root, kind, directoryName, budget) {
  const taskRoot = path.join(root.activeRoot, kind, directoryName)
  const identityPath = path.join(taskRoot, '.memory', 'task.json')
  return {
    project: root.project,
    activeRoot: root.activeRoot,
    kind,
    directoryName,
    taskRoot,
    relativeTaskPath: safeRelative(rootContext.relativeBase, taskRoot),
    identityPath,
    sessionsPath: path.join(taskRoot, '.memory', 'sessions.md'),
    identitySource: readLocatorMetadata(identityPath, budget.maxIdentityBytes, budget, { countIdentity: true }),
    sessionsSource: emptyLocatorSource(),
    archivedSource: emptyLocatorSource()
  }
}

function descriptorFromIndexHint(rootContext, entry, budget) {
  const hintedPath = String(entry?.relativeTaskPath || '').replace(/\\/g, '/')
  if (!hintedPath || path.isAbsolute(hintedPath)) return null
  const taskRoot = path.resolve(rootContext.relativeBase, hintedPath)
  const root = rootContext.roots.find(candidate => isInside(candidate.activeRoot, taskRoot))
  if (!root || !isInside(rootContext.relativeBase, taskRoot)) return null
  const rootRelative = path.relative(root.activeRoot, taskRoot).split(path.sep).filter(Boolean)
  if (rootRelative.length !== 2 || !TASK_KINDS.includes(rootRelative[0])) return null
  const [kind, directoryName] = rootRelative
  if ((entry.project && entry.project !== root.project) || (entry.kind && entry.kind !== kind)) return null
  const descriptor = identityOnlyDescriptor(rootContext, root, kind, directoryName, budget)
  if (descriptor.relativeTaskPath !== hintedPath) return null
  return descriptor
}

function scanExactTaskIdIdentityFirst(rootContext, taskId, budget) {
  for (const root of rootContext.roots) {
    for (const kind of TASK_KINDS) {
      const kindRoot = path.join(root.activeRoot, kind)
      let children
      try {
        children = fs.readdirSync(kindRoot, { withFileTypes: true })
      } catch (error) {
        if (error?.code !== 'ENOENT') budget.localizedErrors += 1
        continue
      }
      children.sort((left, right) => left.name.localeCompare(right.name))
      for (const child of children) {
        if (!child.isDirectory()) continue
        consumeDirectory(budget)
        const descriptor = identityOnlyDescriptor(rootContext, root, kind, child.name, budget)
        const parsed = parseTaskIdentity(descriptor)
        if (!parsed.valid || !parsed.identity) continue
        if (String(parsed.identity.taskId || '').toLowerCase() !== taskId) continue
        budget.exactHitStopped = true
        return descriptor
      }
    }
  }
  return null
}

function taskIndexRuntime(rootContext, cwd, project, persistIndex, now) {
  const optimizationActiveRoot = rootContext.scope === 'workspace'
    ? path.join(rootContext.layout.workspaceRoot, '.devcodex', 'workspace')
    : rootContext.roots[0].activeRoot
  const featureDecision = resolveExecutionFeatureDecisionForCwd({
    cwd,
    activeRoot: optimizationActiveRoot,
    project,
    featureId: 'task-index-acceleration'
  })
  const indexEnabled = featureDecision.optimizationAllowed
  const store = createRuntimeStateStore({
    activeRoot: rootContext.storeActiveRoot,
    project: rootContext.scope === 'workspace' ? 'workspace' : rootContext.project,
    relativePath: rootContext.storeRelativePath,
    maxBytes: rootContext.scope === 'workspace' ? 16 * 1024 * 1024 : 4 * 1024 * 1024,
    lockWaitMs: 2000,
    maxWrites: persistIndex && indexEnabled ? 1 : 0,
    now
  })
  return { featureDecision, indexEnabled, store }
}

function featureDecisionEvidence(featureDecision) {
  return {
    schemaVersion: featureDecision.schemaVersion,
    featureId: featureDecision.featureId,
    lifecycleState: featureDecision.lifecycleState,
    optimizationAllowed: featureDecision.optimizationAllowed,
    reasonCode: featureDecision.reasonCode,
    stateStatus: featureDecision.stateStatus
  }
}

function resolveExactTaskIdDescriptor({ rootContext, taskId, budget, cwd, project, persistIndex, useIndex, now }) {
  const runtime = taskIndexRuntime(rootContext, cwd, project, persistIndex, now)
  const indexEnabled = useIndex !== false && runtime.indexEnabled
  const readReceipt = indexEnabled
    ? runtime.store.read()
    : { status: 'bypassed', errorCode: runtime.featureDecision.reasonCode }
  let descriptor = null
  let hintState = 'identity-scan'
  if (readReceipt.status === 'fresh' && validateIndex(readReceipt.value, rootContext)) {
    const matches = readReceipt.value.entries.filter(entry =>
      entry?.taskId && String(entry.taskId).toLowerCase() === taskId
    )
    if (matches.length === 1) {
      const hinted = descriptorFromIndexHint(rootContext, matches[0], budget)
      const parsed = hinted ? parseTaskIdentity(hinted) : null
      if (parsed?.valid && String(parsed.identity?.taskId || '').toLowerCase() === taskId) {
        descriptor = hinted
        budget.exactHitStopped = true
        hintState = 'hint-reused'
      } else {
        hintState = 'hint-stale-fallback'
      }
    } else if (matches.length > 1) {
      hintState = 'hint-ambiguous-fallback'
    }
  } else if (readReceipt.status !== 'missing') {
    hintState = 'hint-unavailable-fallback'
  }
  if (!descriptor) descriptor = scanExactTaskIdIdentityFirst(rootContext, taskId, budget)
  return {
    descriptor,
    indexEvidence: {
      state: descriptor && hintState === 'hint-reused' ? hintState : (descriptor ? 'identity-scan-hit' : 'identity-scan-miss'),
      hintState,
      rebuildReason: null,
      filePath: runtime.store.filePath,
      sourceIdentity: null,
      readStatus: readReceipt.status,
      writeStatus: null,
      featureDecision: featureDecisionEvidence(runtime.featureDecision)
    }
  }
}

function scanReceipt(budget) {
  return {
    directories: budget.directories,
    pages: budget.pages,
    pageSize: budget.pageSize,
    identityBytes: budget.identityBytes,
    canonicalBytes: budget.canonicalBytes,
    identityReads: budget.identityReads,
    sessionPrefixReads: budget.sessionPrefixReads,
    archivedReads: budget.archivedReads,
    canonicalReads: budget.canonicalReads,
    exactHitStopped: budget.exactHitStopped,
    bytes: budget.bytes,
    localizedErrors: budget.localizedErrors
  }
}

function resolveUniqueActiveTaskContinuation({ cwd = process.cwd(), project = '', scope = 'auto', budgets = {}, now = () => Date.now() } = {}) {
  let rootContext
  let budget
  rootContext = resolveRootContext({ cwd, project, scope })
  budget = createBudget(rootContext.scope, budgets)
  const inventory = collectTaskInventory(rootContext, budget)
  const active = inventory.descriptors.map(inspectLocatorDescriptor).filter(item => item.status === 'active')
  if (active.length !== 1) {
    return {
      ...baseResolution(rootContext, '', '', { state: 'bounded-unique-active-scan', sourceIdentity: inventory.sourceIdentity }),
      status: active.length ? 'ambiguous' : 'not-found',
      errorCode: active.length ? 'TASK_AMBIGUOUS' : 'TASK_SELECTOR_REQUIRED',
      message: active.length ? `${active.length} active tasks require an explicit --task selector.` : 'No unique active task is available.',
      candidates: active.slice(0, 5).map(minimalCandidate),
      nextStep: rootContext.scope === 'project'
        ? 'Specify --task with an exact display name, alias, or stable taskId in the current project; current read-only analysis may continue.'
        : 'Specify --task with an exact display name, alias, or stable taskId; current read-only analysis may continue.',
      mutationAuthority: false,
      scan: scanReceipt(budget)
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
  rootContext = resolveRootContext({ cwd, project, scope })
  budget = createBudget(rootContext.scope, budgets)
  if (isStableTaskId(displayQuery)) {
    const exact = resolveExactTaskIdDescriptor({
      rootContext,
      taskId: normalizedQuery,
      budget,
      cwd,
      project,
      persistIndex,
      useIndex,
      now
    })
    const base = baseResolution(rootContext, displayQuery, normalizedQuery, exact.indexEvidence)
    if (!exact.descriptor) {
      return {
        ...base,
        status: 'not-found',
        errorCode: 'TASK_NOT_FOUND',
        message: `No exact taskId match was found for ${displayQuery}.`,
        suggestions: [],
        nextStep: rootContext.scope === 'project'
          ? 'Continue provisionally or provide an exact task name/taskId from the current project.'
          : 'Continue provisionally or provide an exact task name/taskId.',
        scan: scanReceipt(budget)
      }
    }
    return resolveSelectedDescriptor({ base, descriptor: exact.descriptor, rootContext, budget })
  }
  const inventory = collectTaskInventory(rootContext, budget)

  const runtime = taskIndexRuntime(rootContext, cwd, project, persistIndex, now)
  const { featureDecision, store } = runtime
  const indexEnabled = useIndex !== false && featureDecision.optimizationAllowed
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
    index = buildIndex(rootContext, inventory, budget, now())
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
    featureDecision: featureDecisionEvidence(featureDecision)
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
      scan: scanReceipt(budget)
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
      scan: scanReceipt(budget)
    }
  }

  const indexedSelection = matches[0]
  const descriptor = descriptorMap(inventory).get(indexedSelection.relativeTaskPath)
  if (!descriptor) {
    return {
      ...base,
      status: 'not-found',
      errorCode: 'TASK_SOURCE_MISSING',
      message: 'The indexed task path is no longer present in the bounded source inventory.',
      suggestions: [],
      nextStep: 'Retry to rebuild the derived task index.',
      scan: scanReceipt(budget)
    }
  }
  return resolveSelectedDescriptor({ base, descriptor, rootContext, budget })
}

function resolveSelectedDescriptor({ base, descriptor, rootContext, budget }) {
  const selected = inspectTaskDescriptor(descriptor, budget)
  const candidate = minimalCandidate(selected)
  if (!selected.identityValid) {
    return {
      ...base,
      status: 'stale-confirmation',
      errorCode: 'TASK_IDENTITY_INVALID',
      message: `Task identity is invalid: ${selected.identityErrors.join('; ')}`,
      candidate,
      nextStep: 'Repair .memory/task.json while preserving any established taskId.',
      scan: scanReceipt(budget)
    }
  }
  if (selected.canonicalErrors.length) {
    return {
      ...base,
      status: 'stale-confirmation',
      errorCode: 'TASK_CANONICAL_EVIDENCE_UNAVAILABLE',
      message: `Task ${selected.displayName} canonical evidence is unavailable: ${selected.canonicalErrors.join('; ')}`,
      candidate,
      canonicalErrors: selected.canonicalErrors,
      nextStep: 'Continue in provisional context; repair or re-read the exact task metadata before mutating the existing task.',
      scan: scanReceipt(budget)
    }
  }
  if (selected.status === 'completed' || selected.status === 'rejected') {
    return {
      ...base,
      status: selected.status,
      errorCode: selected.status === 'completed' ? 'TASK_COMPLETED' : 'TASK_REJECTED',
      message: `Task ${selected.displayName} is ${selected.status} and will not be reopened automatically.`,
      candidate,
      nextStep: 'Request an explicit reopen or create a new branch task.',
      scan: scanReceipt(budget)
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
      historicalStaleConfirmations: selected.historicalStaleConfirmations,
      nextStep: `Re-verify the latest confirmed ${selected.staleConfirmations[0].phase} head before mutating the existing task.`,
      scan: scanReceipt(budget)
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
    latestConfirmedHead: selected.latestConfirmedHead,
    historicalStaleConfirmations: selected.historicalStaleConfirmations,
    rehydration: {
      identityPath: path.join(taskRoot, '.memory', 'task.json'),
      sessionsPath: path.join(taskRoot, '.memory', 'sessions.md'),
      rule: 'Resolve by identity only; rehydrate sessions and current artifacts before continuing.'
    },
    scan: scanReceipt(budget)
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
  evaluatePortableTaskIdentityBinding,
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
