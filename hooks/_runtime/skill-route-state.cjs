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
const MAX_ROUTE_ROOT_BYTES = 32 * 1024 * 1024
const MAX_RESPONSE_CACHE_BYTES = 512 * 1024
const TURN_BODY_LIMIT_BYTES = 256 * 1024
const LOCK_STALE_MS = 30 * 1000
const TURN_BINDING_RE = /^turn-[a-f0-9]{40}$/

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
    lock: path.join(turnRoot, 'route-envelope.lock')
  }
}

function isInside (root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function recoverEnvelopeBackup (file, fsImpl = fs) {
  if (path.basename(file) !== 'route-envelope.json' || fsImpl.existsSync(file)) {
    return false
  }
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
    if (value?.schemaVersion !== 'TurnRouteEnvelopeV1') continue
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
  const temp = `${file}.tmp.${process.pid}.${Date.now()}`
  const content = `${JSON.stringify(value, null, 2)}\n`
  let fd
  try {
    fd = fsImpl.openSync(temp, 'wx')
    fsImpl.writeFileSync(fd, content, 'utf8')
    fsImpl.fsyncSync(fd)
    fsImpl.closeSync(fd)
    fd = null
    if (fsImpl.existsSync(file)) {
      const backup = `${file}.replace.${process.pid}.${Date.now()}`
      fsImpl.renameSync(file, backup)
      try {
        fsImpl.renameSync(temp, file)
        fsImpl.unlinkSync(backup)
      } catch (error) {
        if (fsImpl.existsSync(file)) fsImpl.unlinkSync(file)
        if (fsImpl.existsSync(backup)) fsImpl.renameSync(backup, file)
        throw error
      }
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
        const stale = `${paths.lock}.stale.${Date.now()}`
        try {
          fsImpl.renameSync(paths.lock, stale)
          try { fsImpl.unlinkSync(stale) } catch {}
          continue
        } catch {}
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
        const stale = `${lockFile}.stale.${Date.now()}`
        try {
          fsImpl.renameSync(lockFile, stale)
          try { fsImpl.unlinkSync(stale) } catch {}
          continue
        } catch {}
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
        const stale = `${lockFile}.stale.${Date.now()}`
        try {
          fsImpl.renameSync(lockFile, stale)
          try { fsImpl.unlinkSync(stale) } catch {}
          continue
        } catch {}
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

function assertCapacity (paths, fsImpl = fs) {
  fsImpl.mkdirSync(paths.turnsRoot, { recursive: true })
  const turnCount = fsImpl.readdirSync(paths.turnsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory()).length
  const bytes = directoryBytesBounded(paths.routeRoot, fsImpl)
  if (turnCount >= MAX_TURNS || bytes >= MAX_ROUTE_ROOT_BYTES) {
    const error = new Error('RUNTIME_STATE_CAPACITY_BLOCKED')
    error.code = 'RUNTIME_STATE_CAPACITY_BLOCKED'
    error.capacity = { turnCount, bytes, maxTurns: MAX_TURNS, maxBytes: MAX_ROUTE_ROOT_BYTES }
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

function collectExpiredTurns (activeRoot, options = {}) {
  const fsImpl = options.fs || fs
  const routeRoot = routeRootForActiveRoot(activeRoot)
  const turnsRoot = path.join(routeRoot, 'turns')
  const quarantineRoot = path.join(routeRoot, 'quarantine')
  const result = {
    scanned: 0,
    quarantined: [],
    removed: [],
    cleanedQuarantine: [],
    skippedLocked: [],
    skippedReferenced: [],
    failures: []
  }
  if (!fsImpl.existsSync(turnsRoot) && !fsImpl.existsSync(quarantineRoot)) return result
  const releaseGc = acquireGcLock(routeRoot, options)
  try {
    const protectedTurnBindings = new Set(
      (options.protectedTurnBindings || []).map(value => String(value))
    )
    if (fsImpl.existsSync(quarantineRoot)) {
      const quarantined = fsImpl.readdirSync(quarantineRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .slice(0, options.maxGcTurns || 256)
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
      .slice(0, options.maxGcTurns || 256)
    for (const entry of entries) {
      result.scanned += 1
      const turnRoot = path.resolve(turnsRoot, entry.name)
      if (!isInside(turnsRoot, turnRoot) || turnRoot === path.resolve(turnsRoot)) {
        result.failures.push({ turnBinding: entry.name, errorCode: 'GC_PATH_GUARD' })
        continue
      }
      if (protectedTurnBindings.has(entry.name)) {
        result.skippedReferenced.push(entry.name)
        continue
      }
      const envelope = readJson(path.join(turnRoot, 'route-envelope.json'), fsImpl)
      const expiresAt = Date.parse(envelope?.expiresAt || '')
      if (!Number.isFinite(expiresAt) || expiresAt > now) continue
      if (envelope?.state?.turnBinding !== entry.name) {
        result.failures.push({ turnBinding: entry.name, errorCode: 'GC_TURN_IDENTITY_MISMATCH' })
        continue
      }
      let releaseTurn
      try {
        releaseTurn = acquireLock(
          turnPaths(activeRoot, entry.name),
          'gc',
          `gc:${entry.name}`,
          {
            ...options,
            lockTimeoutMs: options.gcTurnLockTimeoutMs || 50
          }
        )
      } catch (error) {
        if (error.code === 'TURN_LOCK_TIMEOUT') {
          result.skippedLocked.push(entry.name)
          continue
        }
        result.failures.push({
          turnBinding: entry.name,
          errorCode: error.code || 'GC_TURN_LOCK_FAILED'
        })
        continue
      }
      const quarantineName = `${entry.name}.${Date.now()}.${process.pid}`
      const quarantinedRoot = path.resolve(quarantineRoot, quarantineName)
      try {
        const current = readJson(path.join(turnRoot, 'route-envelope.json'), fsImpl)
        const currentExpiry = Date.parse(current?.expiresAt || '')
        if (!Number.isFinite(currentExpiry) || currentExpiry > now ||
            current?.state?.turnBinding !== entry.name) {
          result.failures.push({ turnBinding: entry.name, errorCode: 'GC_REVALIDATION_FAILED' })
          continue
        }
        fsImpl.mkdirSync(quarantineRoot, { recursive: true })
        if (!isInside(quarantineRoot, quarantinedRoot) ||
            fsImpl.existsSync(quarantinedRoot)) {
          result.failures.push({ turnBinding: entry.name, errorCode: 'GC_QUARANTINE_TARGET_INVALID' })
          continue
        }
        fsImpl.renameSync(turnRoot, quarantinedRoot)
        const moved = readJson(path.join(quarantinedRoot, 'route-envelope.json'), fsImpl)
        if (fsImpl.existsSync(turnRoot) || moved?.state?.turnBinding !== entry.name) {
          if (!fsImpl.existsSync(turnRoot) && fsImpl.existsSync(quarantinedRoot)) {
            try { fsImpl.renameSync(quarantinedRoot, turnRoot) } catch {}
          }
          result.failures.push({ turnBinding: entry.name, errorCode: 'GC_QUARANTINE_READBACK_FAILED' })
          continue
        }
        result.quarantined.push(entry.name)
        try {
          fsImpl.unlinkSync(path.join(quarantinedRoot, 'route-envelope.lock'))
        } catch {}
        fsImpl.rmSync(quarantinedRoot, { recursive: true, force: false })
        if (fsImpl.existsSync(quarantinedRoot)) {
          throw Object.assign(new Error('GC_REMOVE_READBACK_FAILED'), {
            code: 'GC_REMOVE_READBACK_FAILED'
          })
        }
        result.removed.push(entry.name)
      } catch (error) {
        result.failures.push({
          turnBinding: entry.name,
          errorCode: error.code || 'GC_REMOVE_FAILED'
        })
      } finally {
        if (releaseTurn) releaseTurn()
      }
    }
    return result
  } finally {
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
  const turnBinding = deriveTurnBinding(project, activeRoot, contextEpoch)
  const paths = turnPaths(activeRoot, turnBinding)
  collectExpiredTurns(activeRoot, {
    ...options,
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
        paths
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
    return { bootstrap, envelope: readBack, reused: false, paths }
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

function recordSkillRouteProbeObservation (activeRoot, turnBinding, evidence, options = {}) {
  const {
    normalizeHostVariant,
    validateProbeAuthority
  } = require('./skill-route-mode.cjs')
  const hostVariant = normalizeHostVariant(evidence.host)
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
  MAX_ROUTE_ROOT_BYTES,
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
  recordSkillRouteProbeObservation,
  parseExplicitSkillId,
  directoryBytesBounded,
  assertProjectedCapacity,
  collectExpiredTurns
}
