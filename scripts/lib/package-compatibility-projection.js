'use strict'

const crypto = require('crypto')
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { buildBundle } = require('./control-content-source')

const SCHEMA_VERSION = 'PackageCompatibilityProjectionV1'
const RECEIPT_SCHEMA = 'PackageCompatibilityProjectionReceiptV1'
const LOCK_SCHEMA = 'PackageCompatibilityProjectionLockV1'
const DEFAULT_LOCK = 'package-compatibility-projection.lock.json'
const DEFAULT_RECEIPT = 'package-compatibility-projection.receipt.json'
const DEFAULT_MALFORMED_LOCK_STALE_MS = 60 * 1000

function portable (value) {
  return String(value || '').replace(/\\/g, '/')
}

function sha256 (value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function packageProjectionStateRoot (root) {
  const resolved = path.resolve(root)
  let physicalRoot = resolved
  try { physicalRoot = fs.realpathSync.native(resolved) } catch {}
  const identitySource = process.platform === 'win32'
    ? physicalRoot.toLocaleLowerCase('en-US')
    : physicalRoot
  const identity = sha256(portable(identitySource)).slice(0, 24)
  return path.join(os.tmpdir(), 'devcodex-package-compatibility-projection', identity)
}

function resolvePackageProjectionStatePaths (root, options = {}) {
  const resolvedRoot = path.resolve(root)
  const stateRoot = packageProjectionStateRoot(resolvedRoot)
  const resolveConfigured = (value, fallback) => value
    ? (path.isAbsolute(value) ? path.resolve(value) : path.join(resolvedRoot, value))
    : path.join(stateRoot, fallback)
  return {
    stateRoot,
    lockPath: resolveConfigured(options.lockFile, DEFAULT_LOCK),
    receiptPath: resolveConfigured(options.receiptFile, DEFAULT_RECEIPT),
    usesDefaultLock: !options.lockFile,
    usesDefaultReceipt: !options.receiptFile
  }
}

function stableStringify (value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${stableStringify(value[key])}`
  ).join(',')}}`
}

function walkFiles (root) {
  if (!fs.existsSync(root)) return []
  const files = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(full))
    else if (entry.isFile()) files.push(full)
  }
  return files.sort()
}

function assertSafeTarget (relative) {
  const value = portable(relative)
  const safe = value === 'instructions.md' ||
    value === 'skills/portfolio.json' ||
    /^instructions\/[^/].+$/.test(value) ||
    /^prompts\/[^/].*\.md$/.test(value) ||
    /^skills\/(?:_schemas\/[^/].+|[^/]+\/[^/].*)$/.test(value)
  if (!safe || value.includes('..') || path.isAbsolute(relative)) {
    const error = new Error(`PACKAGE_PROJECTION_TARGET_UNSAFE: ${relative}`)
    error.code = 'PACKAGE_PROJECTION_TARGET_UNSAFE'
    throw error
  }
  return value
}

function buildPackageProjectionPlan (root) {
  const entries = new Map()
  const bundle = buildBundle(root)
  for (const file of bundle.files) {
    const target = assertSafeTarget(file.relative)
    entries.set(target, { target, content: file.content, digest: file.outputDigest })
  }

  const contentSkillsRoot = path.join(root, 'content', 'skills')
  for (const file of walkFiles(contentSkillsRoot)) {
    const relative = portable(path.relative(contentSkillsRoot, file))
    if (relative.endsWith('/SKILL.md') || relative.endsWith('/devcodex.skill.json')) continue
    if (relative === 'portfolio-evidence.json') continue
    const target = assertSafeTarget(`skills/${relative}`)
    if (entries.has(target)) throw new Error(`duplicate package projection target: ${target}`)
    const content = fs.readFileSync(file)
    entries.set(target, { target, content, digest: sha256(content) })
  }

  const contentInstructionsRoot = path.join(root, 'content', 'instructions')
  for (const file of walkFiles(contentInstructionsRoot)) {
    const relative = portable(path.relative(contentInstructionsRoot, file))
    if (relative.endsWith('.md')) continue
    const target = assertSafeTarget(`instructions/${relative}`)
    if (entries.has(target)) throw new Error(`duplicate package projection target: ${target}`)
    const content = fs.readFileSync(file)
    entries.set(target, { target, content, digest: sha256(content) })
  }

  const files = [...entries.values()].sort((left, right) => left.target.localeCompare(right.target))
  const planDigest = sha256(stableStringify(files.map(file => ({
    target: file.target,
    digest: file.digest
  }))))
  return {
    schemaVersion: SCHEMA_VERSION,
    root: path.resolve(root),
    files,
    entryCount: files.length,
    planDigest,
    inputDigest: sha256(stableStringify({
      bundleDigest: bundle.receipt.bundleDigest,
      planDigest
    }))
  }
}

function trackedPaths (root) {
  try {
    const output = execFileSync('git', ['-C', root, 'ls-files', '-z', '--'], {
      encoding: 'buffer',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return new Set(output.toString('utf8').split('\0').filter(Boolean).map(portable))
  } catch {
    return new Set()
  }
}

function isProcessAlive (pid) {
  if (!Number.isInteger(pid) || pid < 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function writeAtomic (target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const temporary = `${target}.devcodex-${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`
  fs.writeFileSync(temporary, content)
  try {
    fs.renameSync(temporary, target)
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}

function removeEmptyProjectionParents (root, relative) {
  const boundary = path.resolve(root)
  let current = path.dirname(path.join(boundary, relative))
  while (current !== boundary && current.startsWith(`${boundary}${path.sep}`)) {
    try {
      fs.rmdirSync(current)
    } catch (error) {
      if (error.code === 'ENOENT') {
        current = path.dirname(current)
        continue
      }
      if (error.code === 'ENOTEMPTY') break
      throw error
    }
    current = path.dirname(current)
  }
}

function publishLockFile (lockPath, content) {
  const candidate = `${lockPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.candidate`
  fs.writeFileSync(candidate, content, { encoding: 'utf8', flag: 'wx' })
  try {
    fs.linkSync(candidate, lockPath)
  } finally {
    if (fs.existsSync(candidate)) fs.unlinkSync(candidate)
  }
}

function acquireLock (root, options = {}) {
  const statePaths = resolvePackageProjectionStatePaths(root, options)
  const lockPath = statePaths.lockPath
  fs.mkdirSync(path.dirname(lockPath), { recursive: true })
  const lock = {
    schemaVersion: LOCK_SCHEMA,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    operation: options.operation || 'projection',
    planDigest: options.planDigest || null
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      publishLockFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`)
      return { lockPath, lock, stateRoot: statePaths.usesDefaultLock ? statePaths.stateRoot : null }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      let existing = null
      try {
        existing = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
      } catch {}
      if (existing?.schemaVersion === LOCK_SCHEMA && isProcessAlive(Number(existing.pid))) {
        const blocked = new Error(`PACKAGE_PROJECTION_LOCKED: pid=${existing.pid}`)
        blocked.code = 'PACKAGE_PROJECTION_LOCKED'
        throw blocked
      }
      if (!existing) {
        const malformedLockStaleMs = options.malformedLockStaleMs ?? DEFAULT_MALFORMED_LOCK_STALE_MS
        const ageMs = Date.now() - fs.statSync(lockPath).mtimeMs
        if (ageMs < malformedLockStaleMs) {
          const blocked = new Error('PACKAGE_PROJECTION_LOCKED_UNREADABLE')
          blocked.code = 'PACKAGE_PROJECTION_LOCKED_UNREADABLE'
          throw blocked
        }
      }
      try {
        fs.unlinkSync(lockPath)
      } catch (unlinkError) {
        if (unlinkError.code !== 'ENOENT') throw unlinkError
      }
    }
  }
  throw new Error('PACKAGE_PROJECTION_LOCK_ACQUIRE_FAILED')
}

function releaseLock (lock) {
  if (!lock?.lockPath || !fs.existsSync(lock.lockPath)) return
  let current = null
  try {
    current = JSON.parse(fs.readFileSync(lock.lockPath, 'utf8'))
  } catch {}
  if (current?.pid === lock.lock.pid && current?.startedAt === lock.lock.startedAt) {
    fs.unlinkSync(lock.lockPath)
  }
  if (lock.stateRoot && fs.existsSync(lock.stateRoot)) {
    try {
      fs.rmdirSync(lock.stateRoot)
      const parent = path.dirname(lock.stateRoot)
      if (path.basename(parent) === 'devcodex-package-compatibility-projection') fs.rmdirSync(parent)
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error
    }
  }
}

function readReceipt (root, options = {}) {
  const receiptPath = resolvePackageProjectionStatePaths(root, options).receiptPath
  if (!fs.existsSync(receiptPath)) return { receiptPath, receipt: null }
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'))
  if (receipt.schemaVersion !== RECEIPT_SCHEMA || !Array.isArray(receipt.files)) {
    const error = new Error('PACKAGE_PROJECTION_RECEIPT_INVALID')
    error.code = 'PACKAGE_PROJECTION_RECEIPT_INVALID'
    throw error
  }
  return { receiptPath, receipt }
}

function cleanupPackageProjection (root, options = {}) {
  const lock = acquireLock(root, { ...options, operation: 'cleanup' })
  try {
    const { receiptPath, receipt } = readReceipt(root, options)
    if (!receipt) return { status: 'no-op', removed: [], receiptPath }
    const tracked = trackedPaths(root)
    const mismatches = []
    for (const file of receipt.files) {
      const target = assertSafeTarget(file.target)
      const absolute = path.join(root, target)
      if (tracked.has(target) && file.trackedAtMaterialize !== true) {
        mismatches.push(`${target}:tracked`)
      }
      else if (!fs.existsSync(absolute)) mismatches.push(`${target}:missing`)
      else if (sha256(fs.readFileSync(absolute)) !== file.digest) mismatches.push(`${target}:modified`)
    }
    if (mismatches.length) {
      const error = new Error(`PACKAGE_PROJECTION_CLEANUP_BLOCKED: ${mismatches.join(', ')}`)
      error.code = 'PACKAGE_PROJECTION_CLEANUP_BLOCKED'
      error.mismatches = mismatches
      throw error
    }
    const removed = []
    for (const file of [...receipt.files].sort((a, b) => b.target.localeCompare(a.target))) {
      const absolute = path.join(root, file.target)
      fs.unlinkSync(absolute)
      removed.push(file.target)
    }
    for (const file of [...receipt.files].sort((a, b) => b.target.length - a.target.length)) {
      removeEmptyProjectionParents(root, file.target)
    }
    fs.unlinkSync(receiptPath)
    return { status: 'cleaned', removed, receiptPath }
  } finally {
    releaseLock(lock)
  }
}

function validatePluginProjection (root, plan) {
  const plugin = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'))
  const planTargets = new Set(plan.files.map(file => file.target))
  const missing = (plugin.skills || [])
    .map(skill => skill.file)
    .filter(file => !planTargets.has(portable(file)))
  if (missing.length) {
    const error = new Error(`PACKAGE_PROJECTION_PLUGIN_UNRESOLVED: ${missing.join(', ')}`)
    error.code = 'PACKAGE_PROJECTION_PLUGIN_UNRESOLVED'
    throw error
  }
}

function preparePackageProjection (root, options = {}) {
  const plan = buildPackageProjectionPlan(root)
  validatePluginProjection(root, plan)
  const lock = acquireLock(root, {
    ...options,
    operation: 'prepack',
    planDigest: plan.planDigest
  })
  try {
    let tracked = trackedPaths(root)
    const existingReceipt = readReceipt(root, options)
    if (existingReceipt.receipt) {
      releaseLock(lock)
      const cleaned = cleanupPackageProjection(root, options)
      Object.assign(lock, acquireLock(root, {
        ...options,
        operation: 'prepack',
        planDigest: plan.planDigest
      }))
      if (cleaned.status !== 'cleaned') throw new Error('PACKAGE_PROJECTION_STALE_RECEIPT_NOT_CLEANED')
      tracked = trackedPaths(root)
    }

    const existing = plan.files.filter(file => fs.existsSync(path.join(root, file.target)))
    const existingMismatches = existing.filter(file =>
      sha256(fs.readFileSync(path.join(root, file.target))) !== file.digest
    )
    const foreignExisting = existing.filter(file => !tracked.has(file.target))
    const foreignMismatches = existingMismatches.filter(file => !tracked.has(file.target))
    if (foreignMismatches.length) {
      const error = new Error(
        `PACKAGE_PROJECTION_COLLISION: ${foreignMismatches.map(file => file.target).join(', ')}`
      )
      error.code = 'PACKAGE_PROJECTION_COLLISION'
      throw error
    }
    if (existingMismatches.length) {
      const error = new Error(
        `PACKAGE_PROJECTION_VERIFY_FAILED: ${existingMismatches.map(file => file.target).join(', ')}`
      )
      error.code = 'PACKAGE_PROJECTION_VERIFY_FAILED'
      throw error
    }
    const missing = plan.files.filter(file => !fs.existsSync(path.join(root, file.target)))
    const reusableForeignExisting = foreignExisting.filter(file =>
      sha256(fs.readFileSync(path.join(root, file.target))) === file.digest
    )
    if (missing.length === 0 && reusableForeignExisting.length === 0) {
      return {
        schemaVersion: SCHEMA_VERSION,
        mode: 'verify-existing',
        entryCount: plan.entryCount,
        planDigest: plan.planDigest,
        trackedTargetCount: existing.filter(file => tracked.has(file.target)).length,
        receiptWritten: false
      }
    }

    for (const file of missing) writeAtomic(path.join(root, file.target), file.content)
    const receiptPath = resolvePackageProjectionStatePaths(root, options).receiptPath
    const receiptFiles = [...missing, ...reusableForeignExisting]
    const receipt = {
      schemaVersion: RECEIPT_SCHEMA,
      owner: 'devcodex',
      createdAt: new Date().toISOString(),
      root: path.resolve(root),
      planDigest: plan.planDigest,
      files: receiptFiles.map(file => ({
        target: file.target,
        digest: file.digest,
        trackedAtMaterialize: tracked.has(file.target)
      }))
    }
    writeAtomic(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
    return {
      schemaVersion: SCHEMA_VERSION,
      mode: 'materialize',
      entryCount: plan.entryCount,
      planDigest: plan.planDigest,
      trackedTargetCount: existing.filter(file => tracked.has(file.target)).length,
      materializedCount: missing.length,
      adoptedExistingCount: reusableForeignExisting.length,
      reusedExistingCount: existing.length,
      receiptWritten: true,
      receiptPath
    }
  } finally {
    releaseLock(lock)
  }
}

module.exports = {
  DEFAULT_LOCK,
  DEFAULT_MALFORMED_LOCK_STALE_MS,
  DEFAULT_RECEIPT,
  LOCK_SCHEMA,
  RECEIPT_SCHEMA,
  SCHEMA_VERSION,
  acquireLock,
  buildPackageProjectionPlan,
  cleanupPackageProjection,
  preparePackageProjection,
  resolvePackageProjectionStatePaths,
  releaseLock,
  validatePluginProjection
}
