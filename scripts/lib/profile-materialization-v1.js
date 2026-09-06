'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
  PROFILE_MATERIALIZATION_RECEIPT_FILE,
  lifecycleForProfile
} = require('../../hooks/_runtime/profile-availability-v1.cjs')

const SCHEMA_VERSION = 'ProfileMaterializationReceiptV1'
const SAFE_OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/
const PROFILE_LOCK_LEASE_MS = 30 * 60 * 1000

function normalizeForDigest(value) {
  if (Array.isArray(value)) return value.map(normalizeForDigest)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalizeForDigest(value[key])]))
}

function digest(value) {
  const payload = Buffer.isBuffer(value) || typeof value === 'string'
    ? value
    : JSON.stringify(normalizeForDigest(value))
  return crypto.createHash('sha256').update(payload).digest('hex')
}

function isWithin(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function createError(code, message, details = {}) {
  const error = new Error(message)
  error.code = code
  Object.assign(error, details)
  return error
}

function assertSafeInputs(input) {
  const projectRoot = path.resolve(String(input.projectRoot || ''))
  const runtimeRoot = path.resolve(String(input.runtimeRoot || path.dirname(String(input.profileRoot || ''))))
  const profileRoot = path.resolve(String(input.profileRoot || ''))
  if (!String(input.projectRoot || '').trim() || !String(input.profileRoot || '').trim()) {
    throw createError('PROFILE_MATERIALIZATION_TARGET_INVALID', 'projectRoot and profileRoot are required')
  }
  if (path.parse(projectRoot).root.toLowerCase() !== path.parse(profileRoot).root.toLowerCase()) {
    throw createError('PROFILE_MATERIALIZATION_CROSS_VOLUME', 'project staging and Profile target must be on the same volume')
  }
  if (!isWithin(runtimeRoot, profileRoot) || path.basename(profileRoot).toLowerCase() !== 'profile') {
    throw createError('PROFILE_MATERIALIZATION_TARGET_INVALID', 'Profile target must be the profile directory inside the resolved runtime root')
  }
  return { projectRoot, runtimeRoot, profileRoot }
}

function normalizeContents(contents) {
  if (!contents || typeof contents !== 'object' || Array.isArray(contents)) {
    throw createError('PROFILE_MATERIALIZATION_CONTENT_INVALID', 'generated Profile contents must be an object')
  }
  const normalized = {}
  for (const [file, value] of Object.entries(contents)) {
    if (!file || path.basename(file) !== file || file === PROFILE_MATERIALIZATION_RECEIPT_FILE) {
      throw createError('PROFILE_MATERIALIZATION_CONTENT_INVALID', `unsafe generated Profile file: ${file}`)
    }
    if (typeof value !== 'string') {
      throw createError('PROFILE_MATERIALIZATION_CONTENT_INVALID', `generated Profile file must be text: ${file}`)
    }
    normalized[file] = value
  }
  return normalized
}

function buildManifest(contents) {
  const files = Object.keys(contents).sort().map(file => ({
    file,
    bytes: Buffer.byteLength(contents[file], 'utf8'),
    sha256: digest(contents[file])
  }))
  return { files, manifestDigest: digest(files) }
}

function verifyReadback(profileRoot, manifest) {
  const files = []
  const errors = []
  for (const expected of manifest.files) {
    const filePath = path.join(profileRoot, expected.file)
    try {
      const content = fs.readFileSync(filePath)
      const actual = { file: expected.file, bytes: content.length, sha256: digest(content) }
      files.push(actual)
      if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) errors.push(`digest-mismatch:${expected.file}`)
    } catch {
      errors.push(`missing:${expected.file}`)
    }
  }
  return {
    ok: errors.length === 0,
    files,
    errors,
    readbackDigest: digest(files)
  }
}

function validateGeneratedContents(contents, tier) {
  const required = ['README.md', '01-项目信息.md', '02-架构约束.md', '03-代码风格.md', 'config.json']
  const errors = []
  for (const file of required) {
    if (!Object.prototype.hasOwnProperty.call(contents, file)) errors.push(`missing:${file}`)
  }
  const readme = String(contents['README.md'] || '')
  if (!/portable-v1/i.test(readme)) errors.push('README.md:portable-v1-missing')
  if (tier && !readme.includes(tier)) errors.push('README.md:tier-mismatch')
  try { JSON.parse(String(contents['config.json'] || '')) } catch { errors.push('config.json:invalid-json') }
  for (const [file, text] of Object.entries(contents)) {
    if (text.charCodeAt(0) === 0xfeff) errors.push(`${file}:utf8-bom`)
    if (text.includes('\uFFFD')) errors.push(`${file}:replacement-character`)
  }
  return { ok: errors.length === 0, errors, validator: 'ProfileGeneratedContentValidatorV1' }
}

function existingReceipt(profileRoot) {
  const file = path.join(profileRoot, PROFILE_MATERIALIZATION_RECEIPT_FILE)
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (value?.schemaVersion !== SCHEMA_VERSION) return null
    const expectedDigest = digest({ ...value, receiptDigest: undefined })
    if (value.receiptDigest !== expectedDigest) return null
    if (!value.manifest || !Array.isArray(value.manifest.files) || !verifyReadback(profileRoot, value.manifest).ok) return null
    return value
  } catch {
    return null
  }
}

function numericNow(deps = {}) {
  const value = typeof deps.now === 'function' ? deps.now() : (deps.now ?? Date.now())
  const parsed = value instanceof Date ? value.getTime() : Number(value)
  return Number.isFinite(parsed) ? parsed : Date.now()
}

function readLockOwner(lockPath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8'))
  } catch {
    return null
  }
}

function lockIsRecoverable(lockPath, expectedProfileRoot, deps = {}) {
  let stat
  try {
    stat = fs.statSync(lockPath)
  } catch {
    return { recoverable: false, owner: null }
  }
  const owner = readLockOwner(lockPath)
  if (owner?.profileRoot && path.resolve(owner.profileRoot) !== path.resolve(expectedProfileRoot)) {
    return { recoverable: false, owner }
  }
  const expiresAt = Date.parse(String(owner?.expiresAt || ''))
  const now = numericNow(deps)
  const recoverable = Number.isFinite(expiresAt)
    ? expiresAt <= now
    : now - stat.mtimeMs >= PROFILE_LOCK_LEASE_MS
  return { recoverable, owner }
}

function writeLockOwner(lockPath, owner, deps = {}) {
  const now = numericNow(deps)
  const updated = {
    ...owner,
    schemaVersion: 'ProfileMaterializationLockOwnerV1',
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PROFILE_LOCK_LEASE_MS).toISOString()
  }
  fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify(updated, null, 2), 'utf8')
  return updated
}

function lockOwnedBy(lockPath, ownerToken) {
  return Boolean(ownerToken && readLockOwner(lockPath)?.ownerToken === ownerToken)
}

function recoverInterruptedCommit(profileRoot, prior) {
  if (!prior || prior.commit?.status === 'readback-verified') return prior
  if (!prior.manifest || !Array.isArray(prior.manifest.files)) return prior
  const readback = verifyReadback(profileRoot, prior.manifest)
  if (!readback.ok) {
    const invalid = {
      ...prior,
      status: 'committed-invalid',
      lifecycleState: 'partial-invalid',
      commit: { status: 'readback-failed', readbackDigest: readback.readbackDigest, errors: readback.errors }
    }
    invalid.receiptDigest = digest({ ...invalid, receiptDigest: undefined })
    fs.writeFileSync(path.join(profileRoot, PROFILE_MATERIALIZATION_RECEIPT_FILE), `${JSON.stringify(invalid, null, 2)}\n`, 'utf8')
    throw createError('PROFILE_MATERIALIZATION_EXISTING_TARGET_INVALID', 'interrupted Profile commit failed recovery readback', { receipt: invalid })
  }
  const recovered = {
    ...prior,
    status: 'committed',
    commit: { status: 'readback-verified', readbackDigest: readback.readbackDigest }
  }
  recovered.receiptDigest = digest({ ...recovered, receiptDigest: undefined })
  fs.writeFileSync(path.join(profileRoot, PROFILE_MATERIALIZATION_RECEIPT_FILE), `${JSON.stringify(recovered, null, 2)}\n`, 'utf8')
  return recovered
}

function cleanupEmptyDirectory(dir) {
  try {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
  } catch { }
}

function materializeProfileDraft(input = {}, deps = {}) {
  const roots = assertSafeInputs(input)
  const contents = normalizeContents(input.contents)
  const manifest = buildManifest(contents)
  const tier = String(input.tier || 'profile-lite')
  const projectIdentity = String(input.projectIdentity || path.basename(roots.projectRoot))
  const operationId = String(input.operationId || `profile-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`)
  if (!SAFE_OPERATION_ID.test(operationId)) {
    throw createError('PROFILE_MATERIALIZATION_OPERATION_INVALID', 'operationId contains unsupported characters')
  }
  const actions = Array.isArray(input.actions)
    ? input.actions.map(item => ({ file: String(item.file || ''), action: String(item.action || '') }))
    : manifest.files.map(item => ({ file: item.file, action: 'generate' }))
  const sourceScanDigest = String(input.sourceScanDigest || digest(input.sourceScan || {}))
  const plannedIdentity = {
    projectIdentity,
    projectRoot: roots.projectRoot,
    runtimeRoot: roots.runtimeRoot,
    profileRoot: roots.profileRoot,
    sourceScanDigest,
    tier,
    templateVersion: String(input.templateVersion || 'profile-bootstrap-v1'),
    generatorVersion: String(input.generatorVersion || 'unknown'),
    actions,
    manifest
  }

  if (input.dryRun === true) {
    const lifecycleState = fs.existsSync(roots.profileRoot)
      ? lifecycleForProfile(roots.profileRoot).status
      : 'missing'
    const preview = {
      schemaVersion: SCHEMA_VERSION,
      operationId,
      status: 'planned',
      lifecycleState,
      ...plannedIdentity,
      staging: { policy: 'project-tmp', path: null, written: false },
      validator: { status: 'not-run', digest: null, errors: [], warnings: [] },
      commit: { status: 'not-run', readbackDigest: null },
      cleanup: { policy: 'owner-operation-id', status: 'not-needed' }
    }
    return { ...preview, receiptDigest: digest(preview) }
  }

  if (fs.existsSync(roots.profileRoot)) {
    const prior = recoverInterruptedCommit(roots.profileRoot, existingReceipt(roots.profileRoot))
    const lifecycleState = prior?.lifecycleState || lifecycleForProfile(roots.profileRoot).status
    const unchanged = {
      schemaVersion: SCHEMA_VERSION,
      operationId,
      status: 'unchanged',
      lifecycleState,
      ...plannedIdentity,
      staging: { policy: 'project-tmp', path: null, written: false },
      validator: { status: 'not-run-existing-target', digest: null, errors: [], warnings: [] },
      commit: { status: 'existing-target', readbackDigest: prior?.commit?.readbackDigest || null },
      cleanup: { policy: 'owner-operation-id', status: 'not-needed' }
    }
    return { ...unchanged, receiptDigest: digest(unchanged) }
  }

  const tempBase = path.join(roots.projectRoot, '.tmp', 'devcodex-profile')
  const operationRoot = path.join(tempBase, operationId)
  const stagingProfile = path.join(operationRoot, 'profile')
  const lockBase = path.join(tempBase, '.locks')
  const lockKey = digest({ projectIdentity, profileRoot: roots.profileRoot }).slice(0, 32)
  const lockPath = path.join(lockBase, lockKey)
  let lockHeld = false
  let lockOwner = null
  let committed = false
  let finalReceipt = null

  const fault = phase => {
    if (input.faultAt === phase) throw createError('PROFILE_MATERIALIZATION_FAULT_INJECTED', `fault injected at ${phase}`, { phase })
  }

  try {
    fs.mkdirSync(lockBase, { recursive: true })
    try {
      fs.mkdirSync(lockPath)
      lockHeld = true
    } catch (error) {
      if (error?.code === 'EEXIST') {
        const stale = lockIsRecoverable(lockPath, roots.profileRoot, deps)
        if (!stale.recoverable) {
          throw createError('PROFILE_MATERIALIZATION_BUSY', 'another create-missing operation owns the Profile target lock')
        }
        const staleOperationId = String(stale.owner?.operationId || '')
        const staleOperationRoot = SAFE_OPERATION_ID.test(staleOperationId)
          ? path.join(tempBase, staleOperationId)
          : null
        fs.rmSync(lockPath, { recursive: true, force: true })
        if (staleOperationRoot && isWithin(tempBase, staleOperationRoot)) {
          fs.rmSync(staleOperationRoot, { recursive: true, force: true })
        }
        try {
          fs.mkdirSync(lockPath)
          lockHeld = true
        } catch (retryError) {
          if (retryError?.code === 'EEXIST') {
            throw createError('PROFILE_MATERIALIZATION_BUSY', 'another create-missing operation won stale-lock recovery')
          }
          throw retryError
        }
      }
      if (!lockHeld) throw error
    }
    lockOwner = writeLockOwner(lockPath, {
      operationId,
      operationRoot,
      ownerToken: crypto.randomBytes(16).toString('hex'),
      pid: process.pid,
      profileRoot: roots.profileRoot
    }, deps)
    fault('after-lock')

    if (fs.existsSync(roots.profileRoot)) {
      const prior = existingReceipt(roots.profileRoot)
      const racedBeforeStage = {
        schemaVersion: SCHEMA_VERSION,
        operationId,
        status: 'unchanged-race',
        lifecycleState: prior?.lifecycleState || lifecycleForProfile(roots.profileRoot).status,
        ...plannedIdentity,
        staging: { policy: 'project-tmp', path: null, written: false },
        validator: { status: 'not-run-existing-target', digest: null, errors: [], warnings: [] },
        commit: { status: 'target-won-by-peer', readbackDigest: prior?.commit?.readbackDigest || null },
        cleanup: { policy: 'owner-operation-id', status: 'finally-exact' }
      }
      return { ...racedBeforeStage, receiptDigest: digest(racedBeforeStage) }
    }

    fs.mkdirSync(stagingProfile, { recursive: true })
    for (const [file, text] of Object.entries(contents)) {
      fs.writeFileSync(path.join(stagingProfile, file), text, 'utf8')
    }
    fault('after-stage')

    const structural = validateGeneratedContents(contents, tier)
    lockOwner = writeLockOwner(lockPath, lockOwner, deps)
    const external = typeof deps.validateProfile === 'function'
      ? deps.validateProfile(stagingProfile, roots.projectRoot, plannedIdentity)
      : { ok: true, status: 0, errors: [], warnings: [], validator: 'not-configured' }
    const validator = {
      status: structural.ok && external?.ok !== false ? 'passed' : 'failed',
      structural,
      external: external || null,
      errors: [...structural.errors, ...(Array.isArray(external?.errors) ? external.errors : [])],
      warnings: Array.isArray(external?.warnings) ? external.warnings : []
    }
    validator.digest = digest(validator)
    if (validator.status !== 'passed') {
      throw createError('PROFILE_MATERIALIZATION_VALIDATION_FAILED', 'staged Profile validation failed', { validator })
    }
    lockOwner = writeLockOwner(lockPath, lockOwner, deps)
    fault('after-validation')

    const receiptBase = {
      schemaVersion: SCHEMA_VERSION,
      operationId,
      status: 'committed',
      lifecycleState: 'generated-draft',
      ...plannedIdentity,
      staging: { policy: 'project-tmp', pathIdentity: digest(operationRoot), written: true },
      validator,
      commit: { status: 'directory-renamed', readbackDigest: manifest.manifestDigest },
      cleanup: { policy: 'owner-operation-id', status: 'finally-exact' }
    }
    finalReceipt = { ...receiptBase, receiptDigest: digest(receiptBase) }
    fs.writeFileSync(
      path.join(stagingProfile, PROFILE_MATERIALIZATION_RECEIPT_FILE),
      `${JSON.stringify(finalReceipt, null, 2)}\n`,
      'utf8'
    )
    fault('before-commit')
    if (!lockOwnedBy(lockPath, lockOwner.ownerToken)) {
      throw createError('PROFILE_MATERIALIZATION_LOCK_LOST', 'Profile target lock ownership changed before commit')
    }
    if (typeof deps.beforeCommit === 'function') deps.beforeCommit({ ...plannedIdentity, operationId })
    if (!lockOwnedBy(lockPath, lockOwner.ownerToken)) {
      throw createError('PROFILE_MATERIALIZATION_LOCK_LOST', 'Profile target lock ownership changed during commit preparation')
    }
    if (fs.existsSync(roots.profileRoot)) {
      const raced = {
        ...finalReceipt,
        status: 'unchanged-race',
        lifecycleState: existingReceipt(roots.profileRoot)?.lifecycleState || lifecycleForProfile(roots.profileRoot).status,
        commit: { status: 'target-won-by-peer', readbackDigest: null }
      }
      return { ...raced, receiptDigest: digest({ ...raced, receiptDigest: undefined }) }
    }
    fs.mkdirSync(path.dirname(roots.profileRoot), { recursive: true })
    fs.renameSync(stagingProfile, roots.profileRoot)
    committed = true
    fault('after-commit')

    const readback = verifyReadback(roots.profileRoot, manifest)
    if (!readback.ok) {
      const invalid = {
        ...finalReceipt,
        status: 'committed-invalid',
        lifecycleState: 'partial-invalid',
        commit: { status: 'readback-failed', readbackDigest: readback.readbackDigest, errors: readback.errors }
      }
      invalid.receiptDigest = digest({ ...invalid, receiptDigest: undefined })
      fs.writeFileSync(path.join(roots.profileRoot, PROFILE_MATERIALIZATION_RECEIPT_FILE), `${JSON.stringify(invalid, null, 2)}\n`, 'utf8')
      throw createError('PROFILE_MATERIALIZATION_READBACK_FAILED', 'committed Profile did not match its staging manifest', { receipt: invalid })
    }
    finalReceipt = {
      ...finalReceipt,
      commit: { status: 'readback-verified', readbackDigest: readback.readbackDigest }
    }
    finalReceipt.receiptDigest = digest({ ...finalReceipt, receiptDigest: undefined })
    fs.writeFileSync(path.join(roots.profileRoot, PROFILE_MATERIALIZATION_RECEIPT_FILE), `${JSON.stringify(finalReceipt, null, 2)}\n`, 'utf8')
    fault('after-readback')
    return finalReceipt
  } catch (error) {
    error.profileCommitted = committed
    if (finalReceipt && !error.receipt) error.receipt = finalReceipt
    throw error
  } finally {
    if (fs.existsSync(operationRoot) && isWithin(tempBase, operationRoot)) {
      fs.rmSync(operationRoot, { recursive: true, force: true })
    }
    if (lockHeld && lockOwnedBy(lockPath, lockOwner?.ownerToken) && fs.existsSync(lockPath) && isWithin(lockBase, lockPath)) {
      fs.rmSync(lockPath, { recursive: true, force: true })
    }
    cleanupEmptyDirectory(lockBase)
    cleanupEmptyDirectory(tempBase)
    cleanupEmptyDirectory(path.dirname(tempBase))
  }
}

module.exports = {
  PROFILE_LOCK_LEASE_MS,
  PROFILE_MATERIALIZATION_RECEIPT_FILE,
  buildProfileManifest: buildManifest,
  materializeProfileDraft,
  validateGeneratedProfileContents: validateGeneratedContents,
  verifyProfileReadback: verifyReadback
}
