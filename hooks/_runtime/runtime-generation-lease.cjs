'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const RUNTIME_GENERATION_LEASE_SCHEMA = 'RuntimeGenerationLeaseV1'
const RUNTIME_GENERATION_GC_CLAIM_SCHEMA = 'RuntimeGenerationGcClaimV1'
const RUNTIME_GENERATION_MANIFEST_SCHEMA = 'RuntimeGenerationManifestV1'
const LEASE_ROOT_NAME = '.runtime-generation-leases'
const GC_CLAIM_FILE_NAME = '.gc-claim.json'
const GC_CLAIM_STALE_FILE_NAME = '.gc-claim.stale'
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30 * 1000
const DEFAULT_LEASE_TTL_MS = 120 * 1000
const MAX_LEASE_BYTES = 32 * 1024
const MAX_LEASE_ENTRIES = 4096
const DIGEST_RE = /^[a-f0-9]{64}$/
const activeLeases = new Map()
let signalHandlersRegistered = false

function portable (value) {
  return path.resolve(String(value || '')).replace(/\\/g, '/')
}

function stableValue (value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
}

function sha256 (value) {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(stableValue(value)))
  return crypto.createHash('sha256').update(body).digest('hex')
}

function isInside (root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function samePath (left, right) {
  const first = path.resolve(left)
  const second = path.resolve(right)
  return process.platform === 'win32'
    ? first.toLowerCase() === second.toLowerCase()
    : first === second
}

function pathKey (value) {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function readJsonBounded (file, fsImpl = fs) {
  try {
    const stat = fsImpl.statSync(file)
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_LEASE_BYTES) return null
    const value = JSON.parse(fsImpl.readFileSync(file, 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

function readGenerationManifest (runtimeRoot, fsImpl = fs) {
  const root = path.resolve(runtimeRoot)
  const manifestPath = path.join(root, 'runtime-generation.json')
  const manifest = readJsonBounded(manifestPath, fsImpl)
  if (!manifest || manifest.schemaVersion !== RUNTIME_GENERATION_MANIFEST_SCHEMA ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(String(manifest.generationId || '')) ||
      !DIGEST_RE.test(String(manifest.sourceDigest || '')) ||
      manifest.runtimeRoot !== '.' || manifest.immutable !== true) {
    return { status: 'invalid', root, manifestPath, manifest: null }
  }
  const runtimeBaseRoot = path.dirname(root)
  const expectedRoot = path.join(runtimeBaseRoot, `runtime-${manifest.generationId}`)
  if (!samePath(expectedRoot, root) || !isInside(runtimeBaseRoot, root)) {
    return { status: 'invalid', root, manifestPath, manifest: null }
  }
  return { status: 'resolved', root, runtimeBaseRoot, manifestPath, manifest }
}

function normalizeRole (role) {
  const raw = String(role || '').trim()
  if (!raw || raw.length > 128) return null
  const safe = raw.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+|-+$/g, '')
  if (!safe) return null
  return `${safe.slice(0, 48)}-${sha256(raw).slice(0, 8)}`
}

function resolveLeasePaths (runtimeRoot, role, pid = process.pid, fsImpl = fs) {
  const generation = readGenerationManifest(runtimeRoot, fsImpl)
  const safeRole = normalizeRole(role)
  if (generation.status !== 'resolved' || !safeRole || !Number.isInteger(pid) || pid <= 0) {
    return { status: 'unavailable', generation, safeRole, pid }
  }
  const leaseRoot = path.join(generation.runtimeBaseRoot, LEASE_ROOT_NAME)
  const generationLeaseRoot = path.join(leaseRoot, generation.manifest.generationId)
  const leaseFile = path.join(generationLeaseRoot, `${safeRole}-${pid}.json`)
  return {
    status: 'resolved',
    generation,
    safeRole,
    pid,
    leaseRoot,
    generationLeaseRoot,
    leaseFile,
    tempFile: `${leaseFile}.next.tmp`,
    claimFile: path.join(generationLeaseRoot, GC_CLAIM_FILE_NAME),
    staleClaimFile: path.join(generationLeaseRoot, GC_CLAIM_STALE_FILE_NAME)
  }
}

function resolvePlannedLeasePaths (runtimeBaseRoot, runtimeRoot, generationId, role, pid = process.pid) {
  const baseRoot = path.resolve(runtimeBaseRoot || '')
  const root = path.resolve(runtimeRoot || '')
  const safeRole = normalizeRole(role)
  const expectedRoot = path.join(baseRoot, `runtime-${generationId}`)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(String(generationId || '')) ||
      !safeRole || !Number.isInteger(pid) || pid <= 0 ||
      !isInside(baseRoot, root) || !samePath(expectedRoot, root)) {
    return { status: 'unavailable', generation: null, safeRole, pid }
  }
  const leaseRoot = path.join(baseRoot, LEASE_ROOT_NAME)
  const generationLeaseRoot = path.join(leaseRoot, generationId)
  const leaseFile = path.join(generationLeaseRoot, `${safeRole}-${pid}.json`)
  return {
    status: 'resolved',
    generation: {
      status: 'planned',
      root,
      runtimeBaseRoot: baseRoot,
      manifest: { generationId }
    },
    safeRole,
    pid,
    leaseRoot,
    generationLeaseRoot,
    leaseFile,
    tempFile: `${leaseFile}.next.tmp`,
    claimFile: path.join(generationLeaseRoot, GC_CLAIM_FILE_NAME),
    staleClaimFile: path.join(generationLeaseRoot, GC_CLAIM_STALE_FILE_NAME)
  }
}

function validateGcClaim (value, expected = {}) {
  const claim = value && typeof value === 'object' && !Array.isArray(value) ? value : null
  if (!claim || claim.schemaVersion !== RUNTIME_GENERATION_GC_CLAIM_SCHEMA ||
      !DIGEST_RE.test(String(claim.claimId || '')) ||
      !DIGEST_RE.test(String(claim.planDigest || '')) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(String(claim.generationId || '')) ||
      typeof claim.runtimeRoot !== 'string' ||
      !Number.isInteger(claim.pid) || claim.pid <= 0 ||
      !Number.isFinite(Date.parse(claim.createdAt))) {
    return { valid: false, reasonCode: 'gc-claim-invalid' }
  }
  if (expected.generationId && claim.generationId !== expected.generationId) {
    return { valid: false, reasonCode: 'gc-claim-generation-mismatch' }
  }
  if (expected.runtimeRoot && !samePath(claim.runtimeRoot, expected.runtimeRoot)) {
    return { valid: false, reasonCode: 'gc-claim-runtime-root-mismatch' }
  }
  return { valid: true, reasonCode: 'gc-claim-valid', claim }
}

function readRuntimeGenerationGcClaim (claimFile, expected = {}, fsImpl = fs) {
  if (!fsImpl.existsSync(claimFile)) return { status: 'missing', claim: null, reasonCode: 'gc-claim-missing' }
  const validation = validateGcClaim(readJsonBounded(claimFile, fsImpl), expected)
  return validation.valid
    ? { status: 'resolved', claim: validation.claim, reasonCode: validation.reasonCode }
    : { status: 'invalid', claim: null, reasonCode: validation.reasonCode }
}

function leaseIdentityMaterial (lease) {
  return {
    schemaVersion: lease.schemaVersion,
    generationId: lease.generationId,
    runtimeRoot: lease.runtimeRoot,
    role: lease.role,
    pid: lease.pid,
    processStartedAt: lease.processStartedAt
  }
}

function validateLease (value, expected = {}) {
  const lease = value && typeof value === 'object' && !Array.isArray(value) ? value : null
  if (!lease || lease.schemaVersion !== RUNTIME_GENERATION_LEASE_SCHEMA ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(String(lease.generationId || '')) ||
      typeof lease.runtimeRoot !== 'string' || typeof lease.role !== 'string' ||
      !Number.isInteger(lease.pid) || lease.pid <= 0 ||
      !Number.isFinite(Date.parse(lease.processStartedAt)) ||
      !Number.isFinite(Date.parse(lease.heartbeatAt)) ||
      !Number.isFinite(Date.parse(lease.expiresAt)) ||
      !DIGEST_RE.test(String(lease.leaseId || '')) ||
      sha256(leaseIdentityMaterial(lease)) !== lease.leaseId) {
    return { valid: false, reasonCode: 'lease-invalid' }
  }
  if (expected.generationId && lease.generationId !== expected.generationId) {
    return { valid: false, reasonCode: 'lease-generation-mismatch' }
  }
  if (expected.runtimeRoot && !samePath(lease.runtimeRoot, expected.runtimeRoot)) {
    return { valid: false, reasonCode: 'lease-runtime-root-mismatch' }
  }
  return { valid: true, reasonCode: 'lease-valid', lease }
}

function writeLeaseAtomic (paths, lease, fsImpl = fs) {
  fsImpl.mkdirSync(paths.generationLeaseRoot, { recursive: true })
  const body = `${JSON.stringify(lease, null, 2)}\n`
  if (Buffer.byteLength(body, 'utf8') > MAX_LEASE_BYTES) {
    const error = new Error('RUNTIME_GENERATION_LEASE_TOO_LARGE')
    error.code = 'RUNTIME_GENERATION_LEASE_TOO_LARGE'
    throw error
  }
  let descriptor
  try {
    descriptor = fsImpl.openSync(paths.tempFile, 'w')
    fsImpl.writeFileSync(descriptor, body, 'utf8')
    if (typeof fsImpl.fsyncSync === 'function') fsImpl.fsyncSync(descriptor)
  } finally {
    if (descriptor !== undefined) fsImpl.closeSync(descriptor)
  }
  try {
    fsImpl.renameSync(paths.tempFile, paths.leaseFile)
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code)) throw error
    let replacementDescriptor
    try {
      replacementDescriptor = fsImpl.openSync(paths.leaseFile, 'w')
      fsImpl.writeFileSync(replacementDescriptor, body, 'utf8')
      if (typeof fsImpl.fsyncSync === 'function') fsImpl.fsyncSync(replacementDescriptor)
    } finally {
      if (replacementDescriptor !== undefined) fsImpl.closeSync(replacementDescriptor)
      try { fsImpl.unlinkSync(paths.tempFile) } catch {}
    }
  }
  const readback = readJsonBounded(paths.leaseFile, fsImpl)
  const validation = validateLease(readback, {
    generationId: lease.generationId,
    runtimeRoot: lease.runtimeRoot
  })
  if (!validation.valid || readback.leaseId !== lease.leaseId || readback.heartbeatAt !== lease.heartbeatAt) {
    const error = new Error('RUNTIME_GENERATION_LEASE_READBACK_FAILED')
    error.code = 'RUNTIME_GENERATION_LEASE_READBACK_FAILED'
    throw error
  }
}

function removeLeaseIfOwned (paths, leaseId, fsImpl = fs) {
  const observed = readJsonBounded(paths.leaseFile, fsImpl)
  if (observed?.leaseId !== leaseId) return false
  try {
    fsImpl.unlinkSync(paths.leaseFile)
    return true
  } catch {
    return false
  }
}

function removeEmptyLeaseDirectories (paths, fsImpl = fs) {
  for (const directory of [paths.generationLeaseRoot, paths.leaseRoot]) {
    try { fsImpl.rmdirSync(directory) } catch {}
  }
}

function acquireRuntimeGenerationLease (options = {}) {
  const fsImpl = options.fs || fs
  const runtimeRoot = path.resolve(options.runtimeRoot || path.join(__dirname, '..', '..'))
  const role = String(options.role || '').trim()
  const pid = Number.isInteger(options.pid) ? options.pid : process.pid
  const paths = options.plannedGeneration
    ? resolvePlannedLeasePaths(
        options.plannedGeneration.runtimeBaseRoot,
        runtimeRoot,
        options.plannedGeneration.generationId,
        role,
        pid
      )
    : resolveLeasePaths(runtimeRoot, role, pid, fsImpl)
  if (paths.status !== 'resolved') {
    return { status: 'not-installed-generation', reasonCode: 'runtime-generation-manifest-unavailable' }
  }
  const key = pathKey(paths.leaseFile)
  if (activeLeases.has(key)) return activeLeases.get(key).publicReceipt

  const initialClaim = readRuntimeGenerationGcClaim(paths.claimFile, {
    generationId: paths.generation.manifest.generationId,
    runtimeRoot
  }, fsImpl)
  if (initialClaim.status !== 'missing') {
    return {
      status: 'blocked',
      reasonCode: initialClaim.status === 'resolved'
        ? 'runtime-generation-gc-claimed'
        : 'runtime-generation-gc-claim-invalid'
    }
  }

  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const heartbeatIntervalMs = Number.isInteger(options.heartbeatIntervalMs)
    ? options.heartbeatIntervalMs
    : DEFAULT_HEARTBEAT_INTERVAL_MS
  const leaseTtlMs = Number.isInteger(options.leaseTtlMs)
    ? options.leaseTtlMs
    : DEFAULT_LEASE_TTL_MS
  if (heartbeatIntervalMs <= 0 || leaseTtlMs < heartbeatIntervalMs * 2) {
    return { status: 'failed', reasonCode: 'lease-timing-invalid' }
  }
  const processStartedAt = new Date(now()).toISOString()
  const base = {
    schemaVersion: RUNTIME_GENERATION_LEASE_SCHEMA,
    generationId: paths.generation.manifest.generationId,
    runtimeRoot: portable(runtimeRoot),
    role,
    pid,
    processStartedAt
  }
  base.leaseId = sha256(leaseIdentityMaterial(base))
  let stopped = false
  let lastError = null
  const heartbeat = () => {
    if (stopped) return
    const claim = readRuntimeGenerationGcClaim(paths.claimFile, {
      generationId: paths.generation.manifest.generationId,
      runtimeRoot
    }, fsImpl)
    if (claim.status !== 'missing') {
      const error = new Error('RUNTIME_GENERATION_GC_CLAIMED')
      error.code = claim.status === 'resolved'
        ? 'RUNTIME_GENERATION_GC_CLAIMED'
        : 'RUNTIME_GENERATION_GC_CLAIM_INVALID'
      lastError = error
      return
    }
    const heartbeatMs = now()
    const lease = {
      ...base,
      heartbeatAt: new Date(heartbeatMs).toISOString(),
      expiresAt: new Date(heartbeatMs + leaseTtlMs).toISOString()
    }
    try {
      writeLeaseAtomic(paths, lease, fsImpl)
      lastError = null
    } catch (error) {
      lastError = error
      try { fsImpl.unlinkSync(paths.tempFile) } catch {}
    }
  }
  heartbeat()
  if (lastError) {
    removeLeaseIfOwned(paths, base.leaseId, fsImpl)
    removeEmptyLeaseDirectories(paths, fsImpl)
    return { status: 'failed', reasonCode: lastError.code || 'lease-write-failed' }
  }
  const postWriteClaim = readRuntimeGenerationGcClaim(paths.claimFile, {
    generationId: paths.generation.manifest.generationId,
    runtimeRoot
  }, fsImpl)
  if (postWriteClaim.status !== 'missing') {
    removeLeaseIfOwned(paths, base.leaseId, fsImpl)
    removeEmptyLeaseDirectories(paths, fsImpl)
    return {
      status: 'blocked',
      reasonCode: postWriteClaim.status === 'resolved'
        ? 'runtime-generation-gc-claimed-after-lease-write'
        : 'runtime-generation-gc-claim-invalid-after-lease-write'
    }
  }
  const timer = setInterval(heartbeat, heartbeatIntervalMs)
  if (typeof timer.unref === 'function') timer.unref()
  const cleanup = () => {
    if (stopped) return
    stopped = true
    clearInterval(timer)
    process.removeListener('exit', cleanup)
    try { fsImpl.unlinkSync(paths.tempFile) } catch {}
    removeLeaseIfOwned(paths, base.leaseId, fsImpl)
    removeEmptyLeaseDirectories(paths, fsImpl)
    activeLeases.delete(key)
  }
  if (options.registerExit !== false) {
    process.once('exit', cleanup)
    registerRuntimeGenerationLeaseSignalHandlers()
  }
  const publicReceipt = {
    status: 'active',
    schemaVersion: RUNTIME_GENERATION_LEASE_SCHEMA,
    generationId: base.generationId,
    role,
    pid,
    leaseFile: portable(paths.leaseFile),
    heartbeatIntervalMs,
    leaseTtlMs
  }
  activeLeases.set(key, { cleanup, heartbeat, paths, publicReceipt, fsImpl })
  return publicReceipt
}

function acquirePlannedRuntimeGenerationLease (options = {}) {
  return acquireRuntimeGenerationLease({
    ...options,
    plannedGeneration: {
      runtimeBaseRoot: options.runtimeBaseRoot,
      generationId: options.generationId
    }
  })
}

function releaseRuntimeGenerationLease (receipt) {
  const key = receipt?.leaseFile ? pathKey(receipt.leaseFile) : null
  if (!key || !activeLeases.has(key)) return false
  const active = activeLeases.get(key)
  active.cleanup()
  return !active.fsImpl.existsSync(active.paths.leaseFile)
}

function registerRuntimeGenerationLeaseSignalHandlers () {
  if (signalHandlersRegistered) return
  signalHandlersRegistered = true
  process.once('SIGTERM', () => {
    stopAllRuntimeGenerationLeases()
    process.exit(0)
  })
  process.once('SIGINT', () => {
    stopAllRuntimeGenerationLeases()
    process.exit(130)
  })
}

function defaultPidProbe (pid) {
  try {
    process.kill(pid, 0)
    return { status: 'live', reasonCode: 'pid-visible' }
  } catch (error) {
    if (error.code === 'ESRCH') return { status: 'dead', reasonCode: 'pid-missing' }
    return { status: 'unknown', reasonCode: error.code || 'pid-probe-failed' }
  }
}

function inspectRuntimeGenerationLeases (runtimeBaseRoot, generationId, options = {}) {
  const fsImpl = options.fs || fs
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  const pidProbe = options.pidProbe || defaultPidProbe
  const root = path.join(path.resolve(runtimeBaseRoot), LEASE_ROOT_NAME, generationId)
  if (!fsImpl.existsSync(root)) {
    return { root: portable(root), complete: true, live: [], dead: [], unknown: [], transient: [], claims: [] }
  }
  let entries
  try { entries = fsImpl.readdirSync(root, { withFileTypes: true }) } catch (error) {
    return {
      root: portable(root), complete: false, live: [], dead: [],
      unknown: [{ path: portable(root), reasonCode: error.code || 'lease-root-unreadable' }], transient: [], claims: []
    }
  }
  if (entries.length > MAX_LEASE_ENTRIES) {
    return {
      root: portable(root), complete: false, live: [], dead: [],
      unknown: [{ path: portable(root), reasonCode: 'lease-entry-limit-exceeded' }], transient: [], claims: []
    }
  }
  const result = { root: portable(root), complete: true, live: [], dead: [], unknown: [], transient: [], claims: [] }
  for (const entry of entries) {
    const file = path.join(root, entry.name)
    if (!entry.isFile()) {
      result.complete = false
      result.unknown.push({ path: portable(file), reasonCode: 'lease-entry-not-file' })
      continue
    }
    if (entry.name.endsWith('.next.tmp')) {
      result.complete = false
      result.transient.push({ path: portable(file), reasonCode: 'lease-heartbeat-in-progress' })
      continue
    }
    if (entry.name === GC_CLAIM_FILE_NAME) {
      const validation = validateGcClaim(readJsonBounded(file, fsImpl), {
        generationId,
        runtimeRoot: options.runtimeRoot
      })
      if (!validation.valid) {
        result.complete = false
        result.unknown.push({ path: portable(file), reasonCode: validation.reasonCode })
      } else if (options.allowedClaimId && validation.claim.claimId === options.allowedClaimId) {
        result.claims.push({ path: portable(file), claim: validation.claim, allowed: true })
      } else {
        result.complete = false
        result.claims.push({ path: portable(file), claim: validation.claim, allowed: false })
        result.unknown.push({ path: portable(file), reasonCode: 'generation-gc-claim-active' })
      }
      continue
    }
    if (!entry.name.endsWith('.json')) {
      result.complete = false
      result.unknown.push({ path: portable(file), reasonCode: 'lease-entry-name-unsupported' })
      continue
    }
    const parsed = readJsonBounded(file, fsImpl)
    const validation = validateLease(parsed, { generationId })
    if (!validation.valid) {
      result.complete = false
      result.unknown.push({ path: portable(file), reasonCode: validation.reasonCode })
      continue
    }
    const lease = validation.lease
    const expiresMs = Date.parse(lease.expiresAt)
    const probe = pidProbe(lease.pid, lease)
    const item = { path: portable(file), lease, pidStatus: probe.status, reasonCode: probe.reasonCode }
    if (expiresMs > nowMs && probe.status === 'live') result.live.push(item)
    else if (probe.status === 'unknown' || (expiresMs <= nowMs && probe.status === 'live')) {
      result.complete = false
      result.unknown.push({
        ...item,
        reasonCode: probe.status === 'live'
          ? 'expired-lease-pid-still-live'
          : probe.reasonCode
      })
    } else result.dead.push(item)
  }
  return result
}

function stopAllRuntimeGenerationLeases () {
  for (const active of [...activeLeases.values()]) active.cleanup()
}

module.exports = {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_LEASE_TTL_MS,
  GC_CLAIM_FILE_NAME,
  GC_CLAIM_STALE_FILE_NAME,
  LEASE_ROOT_NAME,
  MAX_LEASE_BYTES,
  MAX_LEASE_ENTRIES,
  RUNTIME_GENERATION_GC_CLAIM_SCHEMA,
  RUNTIME_GENERATION_LEASE_SCHEMA,
  acquirePlannedRuntimeGenerationLease,
  acquireRuntimeGenerationLease,
  defaultPidProbe,
  inspectRuntimeGenerationLeases,
  readGenerationManifest,
  readRuntimeGenerationGcClaim,
  releaseRuntimeGenerationLease,
  resolveLeasePaths,
  resolvePlannedLeasePaths,
  stopAllRuntimeGenerationLeases,
  validateGcClaim,
  validateLease
}
