'use strict'

const fs = require('fs')
const path = require('path')
const { resolveRuntimeStateRoot } = require('./workspace-layout.cjs')

const {
  buildRuntimeSkillIdentityIndex
} = require('./runtime-skill-identity-index.cjs')
const {
  buildUnifiedSkillCatalog
} = require('./model-skill-catalog.cjs')
const {
  byteLength,
  portable,
  sha256
} = require('./progressive-skill-route-contract.cjs')

const TURN_TTL_MS = 24 * 60 * 60 * 1000
const MAX_TURNS = 64
const MAX_RAW_TURN_DIRECTORIES = 256
const MAX_QUARANTINE_DIRECTORIES = 256
const MAX_ROUTE_ROOT_BYTES = 32 * 1024 * 1024
const TURN_PRESSURE_HIGH_WATER = 56
const TURN_PRESSURE_LOW_WATER = 48
const ROUTE_BYTES_PRESSURE_HIGH_WATER = 28 * 1024 * 1024
const ROUTE_BYTES_PRESSURE_LOW_WATER = 24 * 1024 * 1024
const EMPTY_TURN_GRACE_MS = 60 * 1000
const PRESSURE_RECLAIM_GRACE_MS = 60 * 1000
const ORPHAN_WRITER_ARTIFACT_RE = /^(?:route-envelope\.lock(?:\.stale)?|(?:route-envelope|catalog-progress)\.json\.(?:next\.tmp|replace\.[A-Za-z0-9._-]+))$/
const MAX_RESPONSE_CACHE_BYTES = 512 * 1024
const TURN_BODY_LIMIT_BYTES = 256 * 1024
const LOCK_STALE_MS = 30 * 1000
const TURN_BINDING_RE = /^turn-[a-f0-9]{40}$/
const CATALOG_PROGRESS_SCHEMA = 'SkillRouteCatalogProgressV1'

function ensureProject (project) {
  const value = String(project || '').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    const error = new Error('PROJECT_BINDING_INVALID')
    error.code = 'PROJECT_BINDING_INVALID'
    throw error
  }
  return value
}

function deriveTurnBinding (project, activeRoot, contextEpoch) {
  return `turn-${sha256({
    schemaVersion: 'SkillRouteTurnV1',
    project: ensureProject(project),
    activeRoot: portable(path.resolve(activeRoot)),
    contextEpoch: String(contextEpoch || '')
  }).slice(0, 40)}`
}

function ensureTurnBinding (turnBinding) {
  const value = String(turnBinding || '')
  if (!TURN_BINDING_RE.test(value)) {
    const error = new Error('TURN_BINDING_INVALID')
    error.code = 'TURN_BINDING_INVALID'
    throw error
  }
  return value
}

function routeRootForActiveRoot (activeRoot) {
  return path.join(resolveRuntimeStateRoot(activeRoot).root, 'skill-route')
}

function turnPaths (activeRoot, turnBinding) {
  const routeRoot = routeRootForActiveRoot(activeRoot)
  const binding = ensureTurnBinding(turnBinding)
  const turnRoot = path.join(routeRoot, 'turns', binding)
  return {
    routeRoot,
    turnsRoot: path.join(routeRoot, 'turns'),
    turnRoot,
    envelope: path.join(turnRoot, 'route-envelope.json'),
    catalogProgress: path.join(turnRoot, 'catalog-progress.json'),
    lock: path.join(turnRoot, 'route-envelope.lock')
  }
}

function isInside (root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function recoverEnvelopeBackup (file, fsImpl = fs) {
  const expectedSchema = {
    'route-envelope.json': 'TurnRouteEnvelopeV1',
    'catalog-progress.json': CATALOG_PROGRESS_SCHEMA
  }[path.basename(file)]
  if (!expectedSchema || fsImpl.existsSync(file)) return false
  const dir = path.dirname(file)
  if (!fsImpl.existsSync(dir)) return false
  const prefix = `${path.basename(file)}.replace.`
  const backups = fsImpl.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.startsWith(prefix))
    .map(entry => {
      const backup = path.join(dir, entry.name)
      let modified = 0
      try { modified = fsImpl.statSync(backup).mtimeMs } catch {}
      return { backup, modified }
    })
    .sort((left, right) => right.modified - left.modified)
    .slice(0, 8)
  for (const candidate of backups) {
    let value
    try {
      value = JSON.parse(fsImpl.readFileSync(candidate.backup, 'utf8'))
    } catch {
      continue
    }
    if (value?.schemaVersion !== expectedSchema) continue
    try {
      fsImpl.renameSync(candidate.backup, file)
      return true
    } catch {
      if (fsImpl.existsSync(file)) return true
    }
  }
  return false
}

function readJson (file, fsImpl = fs) {
  try {
    recoverEnvelopeBackup(file, fsImpl)
    return JSON.parse(fsImpl.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function atomicWriteJson (file, value, fsImpl = fs) {
  const dir = path.dirname(file)
  fsImpl.mkdirSync(dir, { recursive: true })
  recoverEnvelopeBackup(file, fsImpl)
  const temp = `${file}.next.tmp`
  const backup = `${file}.replace.v1`
  const content = `${JSON.stringify(value, null, 2)}\n`
  let fd
  try {
    if (fsImpl.existsSync(temp)) fsImpl.unlinkSync(temp)
    fd = fsImpl.openSync(temp, 'wx')
    fsImpl.writeFileSync(fd, content, 'utf8')
    fsImpl.fsyncSync(fd)
    fsImpl.closeSync(fd)
    fd = null
    if (fsImpl.existsSync(file)) {
      if (fsImpl.existsSync(backup)) fsImpl.unlinkSync(backup)
      fsImpl.renameSync(file, backup)
      try {
        fsImpl.renameSync(temp, file)
      } catch (error) {
        if (fsImpl.existsSync(file)) fsImpl.unlinkSync(file)
        if (fsImpl.existsSync(backup)) fsImpl.renameSync(backup, file)
        throw error
      }
      try { fsImpl.unlinkSync(backup) } catch {}
    } else {
      fsImpl.renameSync(temp, file)
    }
  } finally {
    if (fd !== null && fd !== undefined) {
      try { fsImpl.closeSync(fd) } catch {}
    }
    if (fsImpl.existsSync(temp)) {
      try { fsImpl.unlinkSync(temp) } catch {}
    }
  }
  return { bytes: byteLength(content), digest: sha256(content) }
}

function quarantineStaleLock (lockFile, fsImpl = fs) {
  const stale = `${lockFile}.stale`
  try {
    if (fsImpl.existsSync(stale)) fsImpl.unlinkSync(stale)
    fsImpl.renameSync(lockFile, stale)
    try { fsImpl.unlinkSync(stale) } catch {}
    return true
  } catch {
    return false
  }
}

function normalizeCatalogProgressPages(pages, pageCount) {
  if (!Array.isArray(pages)) return null
  const normalized = [...new Set(pages)]
  if (normalized.length !== pages.length || normalized.some(page => !Number.isInteger(page) || page < 0 || page >= pageCount)) {
    return null
  }
  normalized.sort((left, right) => left - right)
  if (normalized.some((page, index) => page !== index)) return null
  return normalized
}

function normalizeCatalogProgressLedger(items, servedCatalogPages, pageCount, contextEpoch) {
  if (!Array.isArray(items)) return null
  if (items.length !== servedCatalogPages.length) return null
  const allowedPages = new Set(servedCatalogPages)
  const seenPages = new Set()
  const normalized = []
  for (const item of items) {
    const pageIndex = item?.pageIndex
    if (!Number.isInteger(pageIndex) || !allowedPages.has(pageIndex) || seenPages.has(pageIndex) ||
        item.stageId !== null || item.sourceBytes !== 0 || item.bodyBytes !== 0 || item.generation !== 0 ||
        !Number.isInteger(item.serializedBytes) || item.serializedBytes < 0 ||
        item.runtimeServedPages !== pageIndex + 1 ||
        item.expectedPages !== pageCount ||
        item.contextEpoch !== contextEpoch ||
        !/^[a-f0-9]{64}$/.test(String(item.responseDigest || '')) ||
        !/^[a-f0-9]{64}$/.test(String(item.idempotencyKey || '')) ||
        typeof item.deliveredAt !== 'string' || !Number.isFinite(Date.parse(item.deliveredAt))) {
      return null
    }
    seenPages.add(pageIndex)
    normalized.push({
      pageIndex,
      stageId: null,
      sourceBytes: 0,
      serializedBytes: item.serializedBytes,
      bodyBytes: 0,
      runtimeServedPages: item.runtimeServedPages,
      expectedPages: item.expectedPages,
      contextEpoch: item.contextEpoch,
      generation: 0,
      responseDigest: item.responseDigest,
      idempotencyKey: item.idempotencyKey,
      deliveredAt: item.deliveredAt
    })
  }
  return normalized.sort((left, right) => left.pageIndex - right.pageIndex)
}

function legacyCatalogProgressLedger(state, servedCatalogPages) {
  const candidates = (Array.isArray(state?.contributionLedger?.items)
    ? state.contributionLedger.items
    : [])
    .filter(item => item?.op === 'catalog' && Number(item.generation || 0) === 0)
  if (candidates.length !== servedCatalogPages.length) return null
  return candidates.map((item, index) => ({
    pageIndex: servedCatalogPages[index],
    stageId: null,
    sourceBytes: 0,
    serializedBytes: item.serializedBytes,
    bodyBytes: 0,
    runtimeServedPages: item.runtimeServedPages,
    expectedPages: item.expectedPages,
    contextEpoch: item.contextEpoch,
    generation: 0,
    responseDigest: item.responseDigest,
    idempotencyKey: item.idempotencyKey,
    deliveredAt: item.observedAt
  }))
}

function buildCatalogProgress(
  state,
  servedCatalogPages,
  now = new Date().toISOString(),
  catalogLedger = []
) {
  const pageCount = Array.isArray(state?.catalog?.pages) ? state.catalog.pages.length : 0
  const pages = normalizeCatalogProgressPages(servedCatalogPages, pageCount)
  const ledger = normalizeCatalogProgressLedger(
    catalogLedger,
    pages || [],
    pageCount,
    state.contextEpoch
  )
  if (!pages || !ledger) {
    const error = new Error('CATALOG_PROGRESS_INVALID')
    error.code = 'CATALOG_PROGRESS_INVALID'
    throw error
  }
  return {
    schemaVersion: CATALOG_PROGRESS_SCHEMA,
    project: state.project,
    turnBinding: state.turnBinding,
    contextEpoch: state.contextEpoch,
    catalogDigest: state.catalog?.catalogDigest || '',
    pageCount,
    servedCatalogPages: pages,
    catalogLedger: ledger,
    updatedAt: now
  }
}

function readCatalogProgress(paths, envelope, fsImpl = fs) {
  const state = envelope?.state || {}
  const pageCount = Array.isArray(state.catalog?.pages) ? state.catalog.pages.length : 0
  const raw = readJson(paths.catalogProgress, fsImpl)
  if (!raw) {
    if (fsImpl.existsSync(paths.catalogProgress)) {
      return { status: 'invalid', errorCode: 'CATALOG_PROGRESS_INVALID' }
    }
    const legacyPages = normalizeCatalogProgressPages(state.servedCatalogPages || [], pageCount)
    if (!legacyPages) return { status: 'invalid', errorCode: 'CATALOG_PROGRESS_INVALID' }
    const legacyLedger = legacyPages.length
      ? legacyCatalogProgressLedger(state, legacyPages)
      : []
    if (!legacyLedger) return { status: 'invalid', errorCode: 'CATALOG_PROGRESS_INVALID' }
    return {
      status: 'legacy',
      progress: buildCatalogProgress(state, legacyPages, new Date().toISOString(), legacyLedger)
    }
  }
  const expected = {
    schemaVersion: CATALOG_PROGRESS_SCHEMA,
    project: state.project,
    turnBinding: state.turnBinding,
    contextEpoch: state.contextEpoch,
    catalogDigest: state.catalog?.catalogDigest || '',
    pageCount
  }
  const matches = Object.entries(expected).every(([field, value]) => raw[field] === value)
  const pages = normalizeCatalogProgressPages(raw.servedCatalogPages, pageCount)
  const ledger = normalizeCatalogProgressLedger(
    raw.catalogLedger || [],
    pages || [],
    pageCount,
    state.contextEpoch
  )
  if (!matches || !pages || !ledger || typeof raw.updatedAt !== 'string' || !Number.isFinite(Date.parse(raw.updatedAt))) {
    return { status: 'invalid', errorCode: 'CATALOG_PROGRESS_INVALID' }
  }
  return {
    status: 'fresh',
    progress: { ...raw, servedCatalogPages: pages, catalogLedger: ledger }
  }
}

function hydrateCatalogProgress(envelope, paths, options = {}) {
  const result = readCatalogProgress(paths, envelope, options.fs || fs)
  if (result.status === 'invalid') {
    const error = new Error(result.errorCode || 'CATALOG_PROGRESS_INVALID')
    error.code = result.errorCode || 'CATALOG_PROGRESS_INVALID'
    throw error
  }
  envelope.state.servedCatalogPages = [...result.progress.servedCatalogPages]
  const contributionItems = Array.isArray(envelope.state.contributionLedger?.items)
    ? envelope.state.contributionLedger.items
    : []
  const priorCatalogItems = new Map()
  let legacyCatalogIndex = 0
  for (const item of contributionItems) {
    if (item?.op !== 'catalog') continue
    const pageIndex = Number.isInteger(item.catalogProgressPageIndex)
      ? item.catalogProgressPageIndex
      : legacyCatalogIndex
    legacyCatalogIndex += 1
    if (!priorCatalogItems.has(pageIndex)) priorCatalogItems.set(pageIndex, item)
  }
  // The sidecar is the single catalog-delivery truth. Retaining legacy catalog
  // rows as well would double-count calls after an in-place rolling upgrade.
  const retainedItems = contributionItems.filter(item => item?.op !== 'catalog')
  const hydratedCatalogItems = result.progress.catalogLedger.map(item => {
    const prior = priorCatalogItems.get(item.pageIndex)
    const hydrated = {
      channel: 'mcp-tool-result',
      modelObserved: prior?.modelObserved === 'direct-pass' ? 'direct-pass' : 'unverified',
      observedAt: prior?.observedAt || item.deliveredAt,
      op: 'catalog',
      catalogProgressPageIndex: item.pageIndex,
      stageId: item.stageId,
      sourceBytes: item.sourceBytes,
      serializedBytes: item.serializedBytes,
      bodyBytes: item.bodyBytes,
      runtimeServedPages: item.runtimeServedPages,
      expectedPages: item.expectedPages,
      contextEpoch: item.contextEpoch,
      generation: item.generation,
      responseDigest: item.responseDigest,
      replayed: false,
      idempotencyKey: item.idempotencyKey
    }
    if (prior?.observationDigest) hydrated.observationDigest = prior.observationDigest
    return hydrated
  })
  if (!envelope.state.contributionLedger) {
    envelope.state.contributionLedger = { schemaVersion: 'ContributionLedgerV1', items: [] }
  }
  envelope.state.contributionLedger.items = [...retainedItems, ...hydratedCatalogItems]
  return result
}

function lockOwnerAlive (lockRecord) {
  const pid = Number(lockRecord?.pid)
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function acquireLock (paths, op, key, options = {}) {
  const fsImpl = options.fs || fs
  fsImpl.mkdirSync(paths.turnRoot, { recursive: true })
  const started = Date.now()
  while (true) {
    try {
      const fd = fsImpl.openSync(paths.lock, 'wx')
      const record = {
        schemaVersion: 'SkillRouteLockV1',
        pid: process.pid,
        op,
        key,
        startedAt: new Date().toISOString()
      }
      fsImpl.writeFileSync(fd, `${JSON.stringify(record)}\n`, 'utf8')
      fsImpl.closeSync(fd)
      return () => {
        try { fsImpl.unlinkSync(paths.lock) } catch {}
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const current = readJson(paths.lock, fsImpl)
      const age = Date.now() - Date.parse(current?.startedAt || 0)
      if (age > (options.lockStaleMs || LOCK_STALE_MS) && !lockOwnerAlive(current)) {
        if (quarantineStaleLock(paths.lock, fsImpl)) continue
      }
      if (Date.now() - started > (options.lockTimeoutMs || 5000)) {
        const timeout = new Error('TURN_LOCK_TIMEOUT')
        timeout.code = 'TURN_LOCK_TIMEOUT'
        throw timeout
      }
      const until = Date.now() + 10
      while (Date.now() < until) {}
    }
  }
}

function acquireGcLock (routeRoot, options = {}) {
  const fsImpl = options.fs || fs
  const lockFile = path.join(routeRoot, 'skill-route-gc.lock')
  fsImpl.mkdirSync(routeRoot, { recursive: true })
  const started = Date.now()
  while (true) {
    try {
      const fd = fsImpl.openSync(lockFile, 'wx')
      const record = {
        schemaVersion: 'SkillRouteGcLockV1',
        pid: process.pid,
        startedAt: new Date().toISOString()
      }
      fsImpl.writeFileSync(fd, `${JSON.stringify(record)}\n`, 'utf8')
      fsImpl.closeSync(fd)
      return () => {
        try { fsImpl.unlinkSync(lockFile) } catch {}
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const current = readJson(lockFile, fsImpl)
      const age = Date.now() - Date.parse(current?.startedAt || 0)
      if (age > (options.lockStaleMs || LOCK_STALE_MS) && !lockOwnerAlive(current)) {
        if (quarantineStaleLock(lockFile, fsImpl)) continue
      }
      if (Date.now() - started > (options.gcLockTimeoutMs || 5000)) {
        const timeout = new Error('GC_LOCK_TIMEOUT')
        timeout.code = 'GC_LOCK_TIMEOUT'
        throw timeout
      }
      const until = Date.now() + 10
      while (Date.now() < until) {}
    }
  }
}

function acquireRootMutationLock (routeRoot, op, key, options = {}) {
  const fsImpl = options.fs || fs
  const lockFile = path.join(routeRoot, 'skill-route-mutation.lock')
  fsImpl.mkdirSync(routeRoot, { recursive: true })
  const started = Date.now()
  while (true) {
    try {
      const fd = fsImpl.openSync(lockFile, 'wx')
      const record = {
        schemaVersion: 'SkillRouteRootMutationLockV1',
        pid: process.pid,
        op,
        key,
        startedAt: new Date().toISOString()
      }
      fsImpl.writeFileSync(fd, `${JSON.stringify(record)}\n`, 'utf8')
      fsImpl.closeSync(fd)
      return () => {
        try { fsImpl.unlinkSync(lockFile) } catch {}
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const current = readJson(lockFile, fsImpl)
      const age = Date.now() - Date.parse(current?.startedAt || 0)
      if (age > (options.lockStaleMs || LOCK_STALE_MS) && !lockOwnerAlive(current)) {
        if (quarantineStaleLock(lockFile, fsImpl)) continue
      }
      if (Date.now() - started > (options.rootLockTimeoutMs || 5000)) {
        const timeout = new Error('ROOT_MUTATION_LOCK_TIMEOUT')
        timeout.code = 'ROOT_MUTATION_LOCK_TIMEOUT'
        throw timeout
      }
      const until = Date.now() + 10
      while (Date.now() < until) {}
    }
  }
}

function directoryBytesBounded (root, fsImpl = fs, limit = MAX_ROUTE_ROOT_BYTES + 1) {
  if (!fsImpl.existsSync(root)) return 0
  let bytes = 0
  const stack = [root]
  while (stack.length) {
    const current = stack.pop()
    let entries = []
    try {
      entries = fsImpl.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile()) {
        try { bytes += fsImpl.statSync(full).size } catch {}
        if (bytes >= limit) return bytes
      }
    }
  }
  return bytes
}

function inspectTurnCapacity (paths, fsImpl = fs) {
  fsImpl.mkdirSync(paths.turnsRoot, { recursive: true })
  const entries = fsImpl.readdirSync(paths.turnsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
  let occupiedTurnCount = 0
  let emptyTurnCount = 0
  for (const entry of entries) {
    const turnRoot = path.join(paths.turnsRoot, entry.name)
    try {
      if (fsImpl.readdirSync(turnRoot).length === 0) {
        emptyTurnCount += 1
        continue
      }
    } catch {
      // An unreadable directory is occupied until a later, verified cleanup.
    }
    occupiedTurnCount += 1
  }
  return {
    rawDirectoryCount: entries.length,
    occupiedTurnCount,
    emptyTurnCount
  }
}

function assertCapacity (paths, fsImpl = fs) {
  const capacity = inspectTurnCapacity(paths, fsImpl)
  let targetAlreadyOccupied = false
  try {
    targetAlreadyOccupied = fsImpl.existsSync(paths.turnRoot) &&
      fsImpl.readdirSync(paths.turnRoot).length > 0
  } catch {
    targetAlreadyOccupied = true
  }
  const projectedTurnCount = capacity.occupiedTurnCount +
    (targetAlreadyOccupied ? 0 : 1)
  const targetDirectoryExists = fsImpl.existsSync(paths.turnRoot)
  const projectedRawDirectoryCount = capacity.rawDirectoryCount +
    (targetDirectoryExists ? 0 : 1)
  const quarantineRoot = path.join(paths.routeRoot, 'quarantine')
  let quarantineDirectoryCount = 0
  try {
    quarantineDirectoryCount = fsImpl.readdirSync(quarantineRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory()).length
  } catch {}
  const bytes = directoryBytesBounded(paths.routeRoot, fsImpl)
  if (projectedTurnCount > MAX_TURNS ||
      projectedRawDirectoryCount > MAX_RAW_TURN_DIRECTORIES ||
      quarantineDirectoryCount >= MAX_QUARANTINE_DIRECTORIES ||
      bytes >= MAX_ROUTE_ROOT_BYTES) {
    const error = new Error('RUNTIME_STATE_CAPACITY_BLOCKED')
    error.code = 'RUNTIME_STATE_CAPACITY_BLOCKED'
    error.capacity = {
      turnCount: capacity.occupiedTurnCount,
      projectedTurnCount,
      rawDirectoryCount: capacity.rawDirectoryCount,
      projectedRawDirectoryCount,
      ignoredEmptyTurnCount: capacity.emptyTurnCount,
      quarantineDirectoryCount,
      bytes,
      maxTurns: MAX_TURNS,
      maxRawTurnDirectories: MAX_RAW_TURN_DIRECTORIES,
      maxQuarantineDirectories: MAX_QUARANTINE_DIRECTORIES,
      maxBytes: MAX_ROUTE_ROOT_BYTES
    }
    throw error
  }
}

function assertProjectedCapacity (paths, nextEnvelope, fsImpl = fs) {
  const bytes = directoryBytesBounded(paths.routeRoot, fsImpl)
  let previousEnvelopeBytes = 0
  try {
    previousEnvelopeBytes = fsImpl.statSync(paths.envelope).size
  } catch {}
  const nextEnvelopeBytes = byteLength(`${JSON.stringify(nextEnvelope, null, 2)}\n`)
  const projectedBytes = Math.max(0, bytes - previousEnvelopeBytes) + nextEnvelopeBytes
  const atomicPeakBytes = bytes + nextEnvelopeBytes
  if (bytes >= MAX_ROUTE_ROOT_BYTES ||
      projectedBytes >= MAX_ROUTE_ROOT_BYTES ||
      atomicPeakBytes >= MAX_ROUTE_ROOT_BYTES) {
    const error = new Error('RUNTIME_STATE_CAPACITY_BLOCKED')
    error.code = 'RUNTIME_STATE_CAPACITY_BLOCKED'
    error.capacity = {
      bytes,
      previousEnvelopeBytes,
      nextEnvelopeBytes,
      projectedBytes,
      atomicPeakBytes,
      maxBytes: MAX_ROUTE_ROOT_BYTES
    }
    throw error
  }
}

function assertProjectedCatalogProgressCapacity (paths, nextProgress, fsImpl = fs) {
  const bytes = directoryBytesBounded(paths.routeRoot, fsImpl)
  let previousProgressBytes = 0
  try {
    previousProgressBytes = fsImpl.statSync(paths.catalogProgress).size
  } catch {}
  const nextProgressBytes = byteLength(`${JSON.stringify(nextProgress, null, 2)}\n`)
  const projectedBytes = Math.max(0, bytes - previousProgressBytes) + nextProgressBytes
  const atomicPeakBytes = bytes + nextProgressBytes
  if (bytes >= MAX_ROUTE_ROOT_BYTES ||
      projectedBytes >= MAX_ROUTE_ROOT_BYTES ||
      atomicPeakBytes >= MAX_ROUTE_ROOT_BYTES) {
    const error = new Error('RUNTIME_STATE_CAPACITY_BLOCKED')
    error.code = 'RUNTIME_STATE_CAPACITY_BLOCKED'
    error.capacity = {
      bytes,
      previousProgressBytes,
      nextProgressBytes,
      projectedBytes,
      atomicPeakBytes,
      maxBytes: MAX_ROUTE_ROOT_BYTES
    }
    throw error
  }
}

function pressureReclaimReason (envelope, entryName, options, now) {
  const state = envelope?.state
  if (!state || state.turnBinding !== entryName) return null
  const expiresAt = Date.parse(envelope.expiresAt || '')
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null
  const updatedAt = Date.parse(envelope.updatedAt || '')
  if (!Number.isFinite(updatedAt) ||
      now - updatedAt < (options.pressureReclaimGraceMs ?? PRESSURE_RECLAIM_GRACE_MS)) {
    return null
  }
  const obligations = state.obligationLedger
  const businessItems = Array.isArray(obligations?.items) ? obligations.items : null
  const requiredStageIds = Array.isArray(obligations?.requiredStageIds)
    ? obligations.requiredStageIds
    : null
  const processComplete = state.plan?.status === 'complete' &&
    businessItems?.length === 0 &&
    requiredStageIds !== null &&
    requiredStageIds.every(stageId => state.stageProgress?.[stageId]?.status === 'loaded')
  if (processComplete) return 'terminal-process-complete'
  if (state.routeRetirement?.schemaVersion === 'SkillRouteRetirementStateV1' &&
      state.routeRetirement.terminal === true && businessItems?.length === 0) {
    return 'terminal-retired'
  }
  const currentHostSessionId = String(options.hostSessionId || '').trim()
  const currentContextEpoch = String(options.contextEpoch || '').trim()
  if (currentHostSessionId && currentContextEpoch &&
      state.hostSessionId === currentHostSessionId &&
      state.contextEpoch !== currentContextEpoch &&
      !state.plan && !state.decision) {
    return 'same-session-uncommitted-superseded'
  }
  return null
}

function collectExpiredTurns (activeRoot, options = {}) {
  const fsImpl = options.fs || fs
  const routeRoot = routeRootForActiveRoot(activeRoot)
  const turnsRoot = path.join(routeRoot, 'turns')
  const quarantineRoot = path.join(routeRoot, 'quarantine')
  const result = {
    schemaVersion: 'SkillRouteRetentionResultV2',
    scanned: 0,
    quarantined: [],
    removed: [],
    removedEmpty: [],
    removedOrphans: [],
    removedExpired: [],
    removedPressure: [],
    cleanedQuarantine: [],
    skippedLocked: [],
    skippedReferenced: [],
    failures: []
  }
  if (!fsImpl.existsSync(turnsRoot) && !fsImpl.existsSync(quarantineRoot)) return result
  const releaseGc = acquireGcLock(routeRoot, options)
  let releaseRoot
  try {
    releaseRoot = acquireRootMutationLock(
      routeRoot,
      'gc',
      sha256({ activeRoot: portable(activeRoot), now: options.now || null }),
      options
    )
    const protectedTurnBindings = new Set(
      (options.protectedTurnBindings || []).map(value => String(value))
    )
    const pushUnique = (items, value) => {
      if (!items.includes(value)) items.push(value)
    }
    if (fsImpl.existsSync(quarantineRoot)) {
      const quarantined = fsImpl.readdirSync(quarantineRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .slice(0, options.maxGcTurns || MAX_QUARANTINE_DIRECTORIES)
      for (const entry of quarantined) {
        const quarantinedRoot = path.resolve(quarantineRoot, entry.name)
        if (!isInside(quarantineRoot, quarantinedRoot) ||
            quarantinedRoot === path.resolve(quarantineRoot)) {
          result.failures.push({ turnBinding: entry.name, errorCode: 'GC_QUARANTINE_PATH_GUARD' })
          continue
        }
        const quarantineLock = readJson(path.join(quarantinedRoot, 'route-envelope.lock'), fsImpl)
        if (lockOwnerAlive(quarantineLock)) {
          result.skippedLocked.push(entry.name)
          continue
        }
        try {
          fsImpl.rmSync(quarantinedRoot, { recursive: true, force: false })
          result.cleanedQuarantine.push(entry.name)
        } catch (error) {
          result.failures.push({
            turnBinding: entry.name,
            errorCode: error.code || 'GC_QUARANTINE_CLEANUP_FAILED'
          })
        }
      }
    }
    if (!fsImpl.existsSync(turnsRoot)) return result
    const now = options.now == null
      ? Date.now()
      : new Date(options.now).getTime()
    const entries = fsImpl.readdirSync(turnsRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .slice(0, options.maxGcTurns || MAX_RAW_TURN_DIRECTORIES)
    const quarantineTurn = (entryName, reason, expectedEnvelope = null) => {
      const turnRoot = path.resolve(turnsRoot, entryName)
      const quarantineName = `${entryName}.${Date.now()}.${process.pid}`
      const quarantinedRoot = path.resolve(quarantineRoot, quarantineName)
      const writerOrphan = reason === 'writer-orphan'
      let releaseTurn
      try {
        if (expectedEnvelope || writerOrphan) {
          if (!TURN_BINDING_RE.test(entryName)) {
            result.failures.push({ turnBinding: entryName, errorCode: 'GC_TURN_BINDING_INVALID' })
            return false
          }
          try {
            releaseTurn = acquireLock(
              turnPaths(activeRoot, entryName),
              'gc',
              `gc:${entryName}:${reason}`,
              {
                ...options,
                lockTimeoutMs: options.gcTurnLockTimeoutMs || 50
              }
            )
          } catch (error) {
            if (error.code === 'TURN_LOCK_TIMEOUT') {
              pushUnique(result.skippedLocked, entryName)
              return false
            }
            result.failures.push({
              turnBinding: entryName,
              errorCode: error.code || 'GC_TURN_LOCK_FAILED'
            })
            return false
          }
          const current = readJson(path.join(turnRoot, 'route-envelope.json'), fsImpl)
          if (writerOrphan) {
            const lockName = path.basename(turnPaths(activeRoot, entryName).lock)
            let currentEntries
            try {
              currentEntries = fsImpl.readdirSync(turnRoot, { withFileTypes: true })
            } catch (error) {
              result.failures.push({ turnBinding: entryName, errorCode: error.code || 'GC_ORPHAN_REVALIDATION_FAILED' })
              return false
            }
            const residual = currentEntries.filter(item => item.name !== lockName)
            const latestModifiedAt = residual.reduce((latest, item) => {
              try { return Math.max(latest, fsImpl.statSync(path.join(turnRoot, item.name)).mtimeMs) } catch { return now }
            }, 0)
            if (current || residual.some(item => !item.isFile() || !ORPHAN_WRITER_ARTIFACT_RE.test(item.name)) ||
                now - latestModifiedAt < (options.emptyTurnGraceMs ?? EMPTY_TURN_GRACE_MS)) {
              result.failures.push({ turnBinding: entryName, errorCode: 'GC_ORPHAN_REVALIDATION_FAILED' })
              return false
            }
          } else if (!current || current.state?.turnBinding !== entryName) {
            result.failures.push({ turnBinding: entryName, errorCode: 'GC_REVALIDATION_FAILED' })
            return false
          } else if (reason === 'expired') {
            const currentExpiry = Date.parse(current.expiresAt || '')
            if (!Number.isFinite(currentExpiry) || currentExpiry > now) {
              result.failures.push({ turnBinding: entryName, errorCode: 'GC_REVALIDATION_FAILED' })
              return false
            }
          } else {
            const currentReason = pressureReclaimReason(current, entryName, options, now)
            if (currentReason !== reason) {
              result.failures.push({ turnBinding: entryName, errorCode: 'GC_PRESSURE_REVALIDATION_FAILED' })
              return false
            }
          }
        } else {
          let currentEntries
          try {
            currentEntries = fsImpl.readdirSync(turnRoot)
          } catch (error) {
            result.failures.push({ turnBinding: entryName, errorCode: error.code || 'GC_EMPTY_REVALIDATION_FAILED' })
            return false
          }
          if (currentEntries.length !== 0) {
            result.failures.push({ turnBinding: entryName, errorCode: 'GC_EMPTY_REVALIDATION_FAILED' })
            return false
          }
        }
        fsImpl.mkdirSync(quarantineRoot, { recursive: true })
        if (!isInside(quarantineRoot, quarantinedRoot) ||
            fsImpl.existsSync(quarantinedRoot)) {
          result.failures.push({ turnBinding: entryName, errorCode: 'GC_QUARANTINE_TARGET_INVALID' })
          return false
        }
        fsImpl.renameSync(turnRoot, quarantinedRoot)
        if (fsImpl.existsSync(turnRoot)) {
          throw Object.assign(new Error('GC_QUARANTINE_READBACK_FAILED'), {
            code: 'GC_QUARANTINE_READBACK_FAILED'
          })
        }
        if (expectedEnvelope) {
          const moved = readJson(path.join(quarantinedRoot, 'route-envelope.json'), fsImpl)
          if (moved?.state?.turnBinding !== entryName) {
            try { fsImpl.renameSync(quarantinedRoot, turnRoot) } catch {}
            result.failures.push({ turnBinding: entryName, errorCode: 'GC_QUARANTINE_READBACK_FAILED' })
            return false
          }
        } else if (writerOrphan) {
          const lockName = path.basename(turnPaths(activeRoot, entryName).lock)
          const movedEntries = fsImpl.readdirSync(quarantinedRoot, { withFileTypes: true })
            .filter(item => item.name !== lockName)
          if (readJson(path.join(quarantinedRoot, 'route-envelope.json'), fsImpl) ||
              movedEntries.some(item => !item.isFile() || !ORPHAN_WRITER_ARTIFACT_RE.test(item.name))) {
            try { fsImpl.renameSync(quarantinedRoot, turnRoot) } catch {}
            result.failures.push({ turnBinding: entryName, errorCode: 'GC_ORPHAN_READBACK_FAILED' })
            return false
          }
        } else if (fsImpl.readdirSync(quarantinedRoot).length !== 0) {
          try { fsImpl.renameSync(quarantinedRoot, turnRoot) } catch {}
          result.failures.push({ turnBinding: entryName, errorCode: 'GC_EMPTY_READBACK_FAILED' })
          return false
        }
        result.quarantined.push(entryName)
        try { fsImpl.unlinkSync(path.join(quarantinedRoot, 'route-envelope.lock')) } catch {}
        fsImpl.rmSync(quarantinedRoot, { recursive: true, force: false })
        if (fsImpl.existsSync(quarantinedRoot)) {
          throw Object.assign(new Error('GC_REMOVE_READBACK_FAILED'), {
            code: 'GC_REMOVE_READBACK_FAILED'
          })
        }
        result.removed.push(entryName)
        if (reason === 'empty-orphan') result.removedEmpty.push(entryName)
        else if (reason === 'writer-orphan') result.removedOrphans.push(entryName)
        else if (reason === 'expired') result.removedExpired.push(entryName)
        else result.removedPressure.push({ turnBinding: entryName, reason })
        return true
      } catch (error) {
        result.failures.push({
          turnBinding: entryName,
          errorCode: error.code || 'GC_REMOVE_FAILED'
        })
        return false
      } finally {
        if (releaseTurn) releaseTurn()
      }
    }

    for (const entry of entries) {
      result.scanned += 1
      const turnRoot = path.resolve(turnsRoot, entry.name)
      if (!isInside(turnsRoot, turnRoot) || turnRoot === path.resolve(turnsRoot)) {
        result.failures.push({ turnBinding: entry.name, errorCode: 'GC_PATH_GUARD' })
        continue
      }
      if (protectedTurnBindings.has(entry.name)) {
        pushUnique(result.skippedReferenced, entry.name)
        continue
      }
      let childEntries
      try {
        childEntries = fsImpl.readdirSync(turnRoot)
      } catch (error) {
        result.failures.push({ turnBinding: entry.name, errorCode: error.code || 'GC_TURN_READ_FAILED' })
        continue
      }
      if (childEntries.length === 0) {
        let modifiedAt = now
        try { modifiedAt = fsImpl.statSync(turnRoot).mtimeMs } catch {}
        if (now - modifiedAt >= (options.emptyTurnGraceMs ?? EMPTY_TURN_GRACE_MS)) {
          quarantineTurn(entry.name, 'empty-orphan')
        }
        continue
      }
      const envelope = readJson(path.join(turnRoot, 'route-envelope.json'), fsImpl)
      if (!envelope) {
        const orphanEntries = fsImpl.readdirSync(turnRoot, { withFileTypes: true })
        const latestModifiedAt = orphanEntries.reduce((latest, item) => {
          try { return Math.max(latest, fsImpl.statSync(path.join(turnRoot, item.name)).mtimeMs) } catch { return now }
        }, 0)
        if (orphanEntries.length > 0 &&
            orphanEntries.every(item => item.isFile() && ORPHAN_WRITER_ARTIFACT_RE.test(item.name)) &&
            now - latestModifiedAt >= (options.emptyTurnGraceMs ?? EMPTY_TURN_GRACE_MS)) {
          quarantineTurn(entry.name, 'writer-orphan')
        } else if (orphanEntries.some(item => !item.isFile() || !ORPHAN_WRITER_ARTIFACT_RE.test(item.name))) {
          result.failures.push({ turnBinding: entry.name, errorCode: 'GC_TURN_ENVELOPE_MISSING' })
        }
        continue
      }
      const expiresAt = Date.parse(envelope?.expiresAt || '')
      if (!Number.isFinite(expiresAt) || expiresAt > now) continue
      if (envelope?.state?.turnBinding !== entry.name) {
        result.failures.push({ turnBinding: entry.name, errorCode: 'GC_TURN_IDENTITY_MISMATCH' })
        continue
      }
      quarantineTurn(entry.name, 'expired', envelope)
    }

    const pressurePaths = {
      routeRoot,
      turnsRoot,
      turnRoot: '',
      envelope: ''
    }
    const beforePressure = inspectTurnCapacity(pressurePaths, fsImpl)
    let pressureBytes = directoryBytesBounded(routeRoot, fsImpl)
    result.capacityBeforePressure = { ...beforePressure, bytes: pressureBytes }
    const pressureEnabled = options.pressureReclaim === true
    const pressureHigh = beforePressure.occupiedTurnCount >= TURN_PRESSURE_HIGH_WATER ||
      pressureBytes >= ROUTE_BYTES_PRESSURE_HIGH_WATER
    if (pressureEnabled && pressureHigh) {
      const candidates = fsImpl.readdirSync(turnsRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && !protectedTurnBindings.has(entry.name))
        .map(entry => {
          const file = path.join(turnsRoot, entry.name, 'route-envelope.json')
          const envelope = readJson(file, fsImpl)
          if (envelope && envelope.state?.turnBinding !== entry.name) {
            result.failures.push({
              turnBinding: entry.name,
              errorCode: 'GC_TURN_IDENTITY_MISMATCH'
            })
          }
          return {
            entryName: entry.name,
            envelope,
            reason: pressureReclaimReason(envelope, entry.name, options, now),
            updatedAt: Date.parse(envelope?.updatedAt || '') || Number.MAX_SAFE_INTEGER,
            bytes: directoryBytesBounded(path.join(turnsRoot, entry.name), fsImpl)
          }
        })
        .filter(candidate => candidate.reason)
        .sort((left, right) => left.updatedAt - right.updatedAt ||
          left.entryName.localeCompare(right.entryName))
      let occupiedTurnCount = beforePressure.occupiedTurnCount
      for (const candidate of candidates) {
        if (occupiedTurnCount <= TURN_PRESSURE_LOW_WATER &&
            pressureBytes <= ROUTE_BYTES_PRESSURE_LOW_WATER) break
        if (quarantineTurn(candidate.entryName, candidate.reason, candidate.envelope)) {
          occupiedTurnCount = Math.max(0, occupiedTurnCount - 1)
          pressureBytes = Math.max(0, pressureBytes - candidate.bytes)
        }
      }
    }
    const afterPressure = inspectTurnCapacity(pressurePaths, fsImpl)
    result.capacityAfterPressure = {
      ...afterPressure,
      bytes: directoryBytesBounded(routeRoot, fsImpl)
    }
    return result
  } finally {
    if (releaseRoot) releaseRoot()
    releaseGc()
  }
}

function parseExplicitSkillId (prompt) {
  const text = String(prompt || '')
  if (/(?:不要|别|无需|不需要|禁止|拒绝)\s*(?:使用|用|加载|执行)/i.test(text)) {
    return null
  }
  if (/(?:为什么|为何|怎么|如何|误触发|触发到|截图|日志|报告|提到|讨论|说明).{0,32}(?:workspace\s+)?skill/i.test(text)) {
    return null
  }
  const match =
    text.match(/(?:使用|用|加载|执行)\s+(?:workspace\s+)?skill\s*[:=]?\s*([A-Za-z0-9][A-Za-z0-9._-]*)/i) ||
    text.match(/(?:使用|用|加载|执行)\s+([A-Za-z0-9][A-Za-z0-9._-]*)\s+(?:skill\b|技能)/i) ||
    text.match(/\b(?:workspace\s+)?skill\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9._-]*)\b/i)
  return match ? match[1] : null
}

function bootstrapSkillRoute (input, options = {}) {
  const {
    getCapabilityDocumentDigest,
    getBootRuntimeContractDigest
  } = require('./skill-route-mode.cjs')
  const fsImpl = options.fs || fs
  const project = ensureProject(input.project)
  const activeRoot = path.resolve(input.activeRoot)
  const contextEpoch = String(input.contextEpoch || '').trim()
  if (!contextEpoch) {
    const error = new Error('CONTEXT_EPOCH_REQUIRED')
    error.code = 'CONTEXT_EPOCH_REQUIRED'
    throw error
  }
  const hostSessionId = String(input.hostSessionId || '').trim()
  const turnBinding = deriveTurnBinding(project, activeRoot, contextEpoch)
  const paths = turnPaths(activeRoot, turnBinding)
  const retention = collectExpiredTurns(activeRoot, {
    ...options,
    pressureReclaim: true,
    hostSessionId,
    contextEpoch,
    protectedTurnBindings: [
      ...(options.protectedTurnBindings || []),
      turnBinding
    ]
  })

  const index = buildRuntimeSkillIdentityIndex({
    ...options,
    cwd: input.cwd || options.cwd,
    project,
    activeRoot,
    runtimeRoot: options.runtimeRoot,
    packageRoot: options.packageRoot,
    env: options.env
  })
  const catalog = buildUnifiedSkillCatalog(index, {
    project,
    turnBinding,
    contextEpoch
  })
  const explicitSkillId = Object.prototype.hasOwnProperty.call(input, 'explicitSkillId')
    ? (String(input.explicitSkillId || '').trim() || null)
    : parseExplicitSkillId(input.prompt)
  const explicitEntry = explicitSkillId
    ? index.entries.find(entry => entry.skillId === explicitSkillId && entry.lifecycle === 'green')
    : null
  const explicitStatus = explicitSkillId
    ? (explicitEntry ? 'ready' : 'rejected')
    : 'none'
  const runtimeContractDigest = input.runtimeContractDigest ||
    getBootRuntimeContractDigest(options)
  const modeReceipt = input.modeReceipt || {
    schemaVersion: 'SkillRouteModeReceiptV1',
    effective: input.mode,
    hostVariant: 'internal/direct',
    capabilityDigest: getCapabilityDocumentDigest(options),
    runtimeContractDigest
  }
  const bootstrap = {
    schemaVersion: 'SkillRouteBootstrapV1',
    project,
    turnBinding,
    contextEpoch,
    generation: 0,
    mode: input.mode,
    hostVariant: modeReceipt.hostVariant || null,
    runtimeContractDigest,
    capabilityDigest: modeReceipt.capabilityDigest || null,
    explicitStatus,
    explicitSkillId: explicitEntry?.skillId || null,
    catalogDigest: catalog.catalogDigest,
    candidateCount: catalog.candidateCount,
    tool: 'skill_route',
    nextOp: explicitStatus === 'ready' ? 'commit' : 'catalog',
    bootstrapDigest: ''
  }
  const { bootstrapDigest: _bootstrapDigest, ...bootstrapMaterial } = bootstrap
  bootstrap.bootstrapDigest = sha256(bootstrapMaterial)
  const releaseRoot = acquireRootMutationLock(
    paths.routeRoot,
    'bootstrap',
    bootstrap.bootstrapDigest,
    options
  )
  let release
  let createdTurn = false
  try {
    createdTurn = !fsImpl.existsSync(paths.envelope)
    if (createdTurn) assertCapacity(paths, fsImpl)
    release = acquireLock(paths, 'bootstrap', bootstrap.bootstrapDigest, options)
    const existing = readJson(paths.envelope, fsImpl)
    if (existing) {
      const now = options.now == null ? Date.now() : new Date(options.now).getTime()
      if (Date.parse(existing.expiresAt) <= now) {
        const error = new Error('TURN_EXPIRED')
        error.code = 'TURN_EXPIRED'
        throw error
      }
      const sameIdentity = existing.state?.project === project &&
        existing.state?.activeRoot === portable(activeRoot) &&
        existing.state?.contextEpoch === contextEpoch &&
        (!hostSessionId || !existing.state?.hostSessionId ||
          existing.state.hostSessionId === hostSessionId) &&
        existing.state?.catalog?.catalogDigest === catalog.catalogDigest &&
        existing.state?.bootstrap?.bootstrapDigest === bootstrap.bootstrapDigest
      if (!sameIdentity) {
        const error = new Error('BOOTSTRAP_IDENTITY_COLLISION')
        error.code = 'BOOTSTRAP_IDENTITY_COLLISION'
        throw error
      }
      return {
        bootstrap,
        envelope: existing,
        reused: true,
        paths,
        retention
      }
    }
    const now = options.now == null ? new Date() : new Date(options.now)
    const envelope = {
      schemaVersion: 'TurnRouteEnvelopeV1',
      version: 1,
      state: {
        project,
        activeRoot: portable(activeRoot),
        turnBinding,
        contextEpoch,
        hostSessionId,
        mode: input.mode,
        modeReceipt,
        runtimeContractDigest,
        bootstrap,
        index,
        catalog,
        explicit: {
          requestedSkillId: explicitSkillId,
          status: explicitStatus,
          skillId: explicitEntry?.skillId || null
        },
        servedCatalogPages: [],
        decision: null,
        plan: null,
        stageProgress: {},
        budget: {
          bodyBytesConsumed: 0,
          bodyLimitBytes: TURN_BODY_LIMIT_BYTES
        },
        bodyChargeLedger: {
          schemaVersion: 'SkillRouteBodyChargeLedgerV1',
          items: [],
          unattributedBodyBytes: 0
        },
        contributionLedger: {
          schemaVersion: 'ContributionLedgerV1',
          items: []
        },
        obligationLedger: {
          schemaVersion: 'ObligationLedgerV1',
          items: [],
          selectedBusinessSkillId: null,
          requiredStageIds: [],
          satisfiedStageIds: []
        }
      },
      responseCache: {},
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + (options.turnTtlMs || TURN_TTL_MS)).toISOString()
    }
    assertProjectedCapacity(paths, envelope, fsImpl)
    atomicWriteJson(paths.envelope, envelope, fsImpl)
    const readBack = readJson(paths.envelope, fsImpl)
    if (!readBack || readBack.state?.bootstrap?.bootstrapDigest !== bootstrap.bootstrapDigest) {
      const error = new Error('TURN_ENVELOPE_READBACK_FAILED')
      error.code = 'TURN_ENVELOPE_READBACK_FAILED'
      throw error
    }
    return { bootstrap, envelope: readBack, reused: false, paths, retention }
  } finally {
    if (release) release()
    if (createdTurn && !fsImpl.existsSync(paths.envelope)) {
      try { fsImpl.rmdirSync(paths.turnRoot) } catch {}
    }
    releaseRoot()
  }
}

function loadEnvelope (activeRoot, turnBinding, options = {}) {
  const paths = turnPaths(activeRoot, turnBinding)
  const envelope = readJson(paths.envelope, options.fs || fs)
  if (!envelope) {
    const error = new Error('TURN_NOT_FOUND')
    error.code = 'TURN_NOT_FOUND'
    throw error
  }
  const now = options.now == null ? Date.now() : new Date(options.now).getTime()
  if (Date.parse(envelope.expiresAt) <= now) {
    const error = new Error('TURN_EXPIRED')
    error.code = 'TURN_EXPIRED'
    error.routeEnvelope = envelope
    throw error
  }
  hydrateCatalogProgress(envelope, paths, options)
  return { envelope, paths }
}

function transactEnvelope (activeRoot, turnBinding, request, mutation, options = {}) {
  const fsImpl = options.fs || fs
  const paths = turnPaths(activeRoot, turnBinding)
  const {
    triggerRef: _nonSemanticTriggerRef,
    ...semanticRequest
  } = request
  const requestDigest = sha256(semanticRequest)
  const idempotencyKey = options.idempotencyKey || sha256({
    project: request.project,
    turnBinding,
    contextEpoch: request.contextEpoch || null,
    generation: request.generation || 0,
    op: request.op,
    catalogDigest: request.catalogDigest || null,
    planDigest: request.planDigest || null,
    previousPlanDigest: request.previousPlanDigest || null,
    lateConditionId: request.lateConditionId || null,
    evidenceDigest: request.evidenceDigest || null,
    contextBindingDigest: request.contextBinding
      ? sha256(request.contextBinding)
      : null,
    skillId: request.skillId === undefined ? null : request.skillId,
    stageId: request.stageId || null,
    cursor: request.cursor || null
  })
  const releaseRoot = acquireRootMutationLock(
    paths.routeRoot,
    request.op,
    idempotencyKey,
    options
  )
  let release
  try {
    release = acquireLock(paths, request.op, idempotencyKey, options)
    const envelope = readJson(paths.envelope, fsImpl)
    if (!envelope) {
      const error = new Error('TURN_NOT_FOUND')
      error.code = 'TURN_NOT_FOUND'
      throw error
    }
    const now = options.now == null ? Date.now() : new Date(options.now).getTime()
    if (Date.parse(envelope.expiresAt) <= now) {
      const error = new Error('TURN_EXPIRED')
      error.code = 'TURN_EXPIRED'
      throw error
    }
    hydrateCatalogProgress(envelope, paths, options)
    const cached = envelope.responseCache?.[idempotencyKey]
    if (cached) {
      if (cached.requestDigest !== requestDigest) {
        const error = new Error('IDEMPOTENCY_COLLISION')
        error.code = 'IDEMPOTENCY_COLLISION'
        throw error
      }
      return {
        response: cached.response,
        replayed: true,
        idempotencyKey,
        envelope
      }
    }
    const outcome = mutation(JSON.parse(JSON.stringify(envelope)), {
      idempotencyKey,
      requestDigest
    })
    const nextEnvelope = outcome.envelope
    const response = outcome.response
    response.idempotencyKey = idempotencyKey
    const responseDigest = sha256(response)
    nextEnvelope.responseCache[idempotencyKey] = {
      requestDigest,
      responseDigest,
      response
    }
    const responseCacheBytes = byteLength(
      `${JSON.stringify({ responseCache: nextEnvelope.responseCache }, null, 2)}\n`
    )
    if (responseCacheBytes > MAX_RESPONSE_CACHE_BYTES) {
      const error = new Error('RESPONSE_CACHE_BUDGET_BLOCKED')
      error.code = 'RESPONSE_CACHE_BUDGET_BLOCKED'
      error.responseCacheBytes = responseCacheBytes
      throw error
    }
    nextEnvelope.version = Number(envelope.version || 0) + 1
    nextEnvelope.updatedAt = new Date().toISOString()
    assertProjectedCapacity(paths, nextEnvelope, fsImpl)
    atomicWriteJson(paths.envelope, nextEnvelope, fsImpl)
    const readBack = readJson(paths.envelope, fsImpl)
    if (readBack?.responseCache?.[idempotencyKey]?.responseDigest !== responseDigest) {
      const error = new Error('TURN_ENVELOPE_READBACK_FAILED')
      error.code = 'TURN_ENVELOPE_READBACK_FAILED'
      throw error
    }
    if (typeof options.afterCommit === 'function') {
      options.afterCommit({ idempotencyKey, responseDigest, envelope: readBack })
    }
    return {
      response,
      replayed: false,
      idempotencyKey,
      envelope: readBack
    }
  } finally {
    if (release) release()
    releaseRoot()
  }
}

function transactCatalogProgress(activeRoot, turnBinding, request, mutation, options = {}) {
  const fsImpl = options.fs || fs
  const paths = turnPaths(activeRoot, turnBinding)
  const {
    triggerRef: _nonSemanticTriggerRef,
    ...semanticRequest
  } = request
  const requestDigest = sha256(semanticRequest)
  const idempotencyKey = options.idempotencyKey || sha256({
    project: request.project,
    turnBinding,
    contextEpoch: request.contextEpoch || null,
    generation: request.generation || 0,
    op: request.op,
    catalogDigest: request.catalogDigest || null,
    planDigest: request.planDigest || null,
    previousPlanDigest: request.previousPlanDigest || null,
    lateConditionId: request.lateConditionId || null,
    evidenceDigest: request.evidenceDigest || null,
    contextBindingDigest: request.contextBinding
      ? sha256(request.contextBinding)
      : null,
    skillId: request.skillId === undefined ? null : request.skillId,
    stageId: request.stageId || null,
    cursor: request.cursor || null
  })
  const releaseRoot = acquireRootMutationLock(
    paths.routeRoot,
    request.op,
    idempotencyKey,
    options
  )
  let release
  try {
    release = acquireLock(paths, request.op, idempotencyKey, options)
    const envelope = readJson(paths.envelope, fsImpl)
    if (!envelope) {
      const error = new Error('TURN_NOT_FOUND')
      error.code = 'TURN_NOT_FOUND'
      throw error
    }
    const now = options.now == null ? Date.now() : new Date(options.now).getTime()
    if (Date.parse(envelope.expiresAt) <= now) {
      const error = new Error('TURN_EXPIRED')
      error.code = 'TURN_EXPIRED'
      throw error
    }
    const hydrated = hydrateCatalogProgress(envelope, paths, options)
    const cached = envelope.responseCache?.[idempotencyKey]
    if (cached) {
      if (cached.requestDigest !== requestDigest) {
        const error = new Error('IDEMPOTENCY_COLLISION')
        error.code = 'IDEMPOTENCY_COLLISION'
        throw error
      }
      return {
        response: cached.response,
        replayed: true,
        idempotencyKey,
        envelope
      }
    }
    const workingEnvelope = JSON.parse(JSON.stringify(envelope))
    const progress = JSON.parse(JSON.stringify(hydrated.progress))
    const outcome = mutation(workingEnvelope, progress, {
      idempotencyKey,
      requestDigest
    })
    const response = outcome.response
    response.idempotencyKey = idempotencyKey
    if (outcome.write === true) {
      const nextProgress = buildCatalogProgress(
        workingEnvelope.state,
        outcome.progress?.servedCatalogPages,
        new Date().toISOString(),
        outcome.progress?.catalogLedger
      )
      assertProjectedCatalogProgressCapacity(paths, nextProgress, fsImpl)
      atomicWriteJson(paths.catalogProgress, nextProgress, fsImpl)
      const readBack = readCatalogProgress(paths, envelope, fsImpl)
      if (readBack.status !== 'fresh' ||
          sha256(readBack.progress.servedCatalogPages) !== sha256(nextProgress.servedCatalogPages)) {
        const error = new Error('CATALOG_PROGRESS_READBACK_FAILED')
        error.code = 'CATALOG_PROGRESS_READBACK_FAILED'
        throw error
      }
      envelope.state.servedCatalogPages = [...nextProgress.servedCatalogPages]
      if (typeof options.afterCommit === 'function') {
        options.afterCommit({
          idempotencyKey,
          responseDigest: sha256(response),
          envelope,
          catalogProgress: readBack.progress
        })
      }
    }
    return {
      response,
      replayed: outcome.replayed === true,
      idempotencyKey,
      envelope
    }
  } finally {
    if (release) release()
    releaseRoot()
  }
}

function resolveProbeObservationHostVariant (evidence, options = {}) {
  const {
    normalizeHostVariant
  } = require('./skill-route-mode.cjs')
  const explicit = String(evidence?.hostVariant || '').trim()
  return normalizeHostVariant(explicit || evidence?.host, {
    env: options.env || process.env,
    entrySurface: options.entrySurface
  })
}

function recordSkillRouteProbeObservation (activeRoot, turnBinding, evidence, options = {}) {
  const {
    validateProbeAuthority
  } = require('./skill-route-mode.cjs')
  const hostVariant = resolveProbeObservationHostVariant(evidence, options)
  const authority = validateProbeAuthority(
    options.authorityPath,
    {
      project: evidence.project,
      hostVariant
    },
    options
  )
  if (!authority.valid) {
    const error = new Error('PROBE_AUTHORITY_INVALID')
    error.code = 'PROBE_AUTHORITY_INVALID'
    error.authority = authority
    throw error
  }
  const evidenceDigest = String(evidence.evidenceDigest || '')
  const expectedEvidenceDigest = sha256({
    ...evidence,
    evidenceDigest: null
  })
  if (evidenceDigest !== expectedEvidenceDigest) {
    const error = new Error('PROBE_EVIDENCE_DIGEST_INVALID')
    error.code = 'PROBE_EVIDENCE_DIGEST_INVALID'
    throw error
  }
  const marker = String(evidence.marker || '')
  if (!marker || String(evidence.markerDigest || '') !== sha256(marker)) {
    const error = new Error('PROBE_MARKER_DIGEST_INVALID')
    error.code = 'PROBE_MARKER_DIGEST_INVALID'
    throw error
  }
  const request = {
    op: 'probe_observation',
    project: evidence.project,
    turnBinding,
    contextEpoch: evidence.contextEpoch,
    evidenceDigest
  }
  return transactEnvelope(
    activeRoot,
    turnBinding,
    request,
    (envelope, transaction) => {
      const state = envelope.state
      if (state.mode !== 'unified' ||
          state.project !== evidence.project ||
          state.contextEpoch !== evidence.contextEpoch ||
          state.turnBinding !== turnBinding) {
        const error = new Error('PROBE_OBSERVATION_BINDING_MISMATCH')
        error.code = 'PROBE_OBSERVATION_BINDING_MISMATCH'
        throw error
      }
      const observedOps = new Set(evidence.observedOps || [])
      for (const item of state.contributionLedger.items) {
        if (observedOps.has(item.op)) {
          item.modelObserved = 'direct-pass'
          item.observationDigest = evidenceDigest
        }
      }
      state.probeObservation = {
        schemaVersion: 'SkillRouteProbeObservationV1',
        probeRunId: evidence.probeRunId,
        hostVariant,
        evidenceDigest,
        observedOps: [...observedOps].sort(),
        markerDigest: evidence.markerDigest,
        observedAt: new Date().toISOString()
      }
      const response = {
        schemaVersion: 'SkillRouteProbeObservationReceiptV1',
        ok: true,
        op: 'probe_observation',
        idempotencyKey: transaction.idempotencyKey,
        evidenceDigest,
        observedOps: [...observedOps].sort()
      }
      return { envelope, response }
    },
    options
  )
}

module.exports = {
  TURN_TTL_MS,
  MAX_TURNS,
  MAX_RAW_TURN_DIRECTORIES,
  MAX_QUARANTINE_DIRECTORIES,
  MAX_ROUTE_ROOT_BYTES,
  TURN_PRESSURE_HIGH_WATER,
  TURN_PRESSURE_LOW_WATER,
  ROUTE_BYTES_PRESSURE_HIGH_WATER,
  ROUTE_BYTES_PRESSURE_LOW_WATER,
  MAX_RESPONSE_CACHE_BYTES,
  TURN_BODY_LIMIT_BYTES,
  TURN_BINDING_RE,
  ensureTurnBinding,
  deriveTurnBinding,
  routeRootForActiveRoot,
  turnPaths,
  atomicWriteJson,
  parseExplicitSkillId,
  bootstrapSkillRoute,
  loadEnvelope,
  transactEnvelope,
  transactCatalogProgress,
  resolveProbeObservationHostVariant,
  recordSkillRouteProbeObservation,
  parseExplicitSkillId,
  directoryBytesBounded,
  assertProjectedCapacity,
  collectExpiredTurns
}
