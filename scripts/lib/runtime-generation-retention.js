'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
  LEASE_ROOT_NAME,
  RUNTIME_GENERATION_GC_CLAIM_SCHEMA,
  RUNTIME_GENERATION_LEASE_SCHEMA,
  defaultPidProbe,
  inspectRuntimeGenerationLeases,
  readGenerationManifest,
  readRuntimeGenerationGcClaim,
  resolveLeasePaths,
  validateGcClaim
} = require('../../hooks/_runtime/runtime-generation-lease.cjs')

const RUNTIME_GENERATION_RETENTION_STATE_SCHEMA = 'RuntimeGenerationRetentionStateV1'
const RUNTIME_GENERATION_GC_PLAN_SCHEMA = 'RuntimeGenerationGcPlanV1'
const RUNTIME_GENERATION_GC_APPLY_SCHEMA = 'RuntimeGenerationGcApplyReceiptV1'
const RUNTIME_RETENTION_PROTOCOL_VERSION = 1
const RETENTION_STATE_FILE = '.runtime-generation-retention.json'
const DEFAULT_ADOPTION_GRACE_MS = 24 * 60 * 60 * 1000
const DEFAULT_GENERATION_GRACE_MS = 24 * 60 * 60 * 1000
const DEFAULT_GC_CLAIM_STALE_MS = 5 * 60 * 1000
const MAX_GENERATIONS = 4096
const MAX_GENERATION_ENTRIES = 20000
const MAX_GENERATION_FILE_BYTES = 32 * 1024 * 1024
const MAX_GENERATION_TREE_BYTES = 512 * 1024 * 1024
const MAX_RECEIPT_BYTES = 8 * 1024 * 1024
const DIGEST_RE = /^[a-f0-9]{64}$/
const GENERATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/
const ADOPTION_AUTHORITIES = new Set(['protocol-adoption', 'generation-adoption'])

function portable (value) {
  return path.resolve(String(value || '')).replace(/\\/g, '/')
}

function stableValue (value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
}

function sha256 (value) {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(
    typeof value === 'string' ? value : JSON.stringify(stableValue(value))
  )
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

function readJsonFile (file, maxBytes, fsImpl = fs) {
  try {
    const stat = fsImpl.statSync(file)
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) {
      return { status: 'invalid', value: null, digest: null, errorCode: 'file-size-invalid' }
    }
    const body = fsImpl.readFileSync(file, 'utf8')
    const value = JSON.parse(body)
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { status: 'invalid', value: null, digest: sha256(body), errorCode: 'json-object-required' }
    }
    return { status: 'resolved', value, digest: sha256(body), bytes: Buffer.byteLength(body, 'utf8') }
  } catch (error) {
    return { status: 'invalid', value: null, digest: null, errorCode: error.code || 'json-read-failed' }
  }
}

function validateRetentionState (state, runtimeBaseRoot) {
  if (!state || state.schemaVersion !== RUNTIME_GENERATION_RETENTION_STATE_SCHEMA ||
      state.leaseSchema !== RUNTIME_GENERATION_LEASE_SCHEMA ||
      state.protocolVersion !== RUNTIME_RETENTION_PROTOCOL_VERSION ||
      !Number.isFinite(Date.parse(state.installedAt)) ||
      !Number.isInteger(state.adoptionGraceMs) || state.adoptionGraceMs < 60 * 60 * 1000 ||
      !Number.isInteger(state.generationGraceMs) || state.generationGraceMs < 60 * 60 * 1000 ||
      state.runtimeBaseRoot !== portable(runtimeBaseRoot) ||
      state.gcPolicy !== 'preview-digest-explicit-apply') {
    return { valid: false, reasonCode: 'runtime-retention-state-invalid' }
  }
  if (state.generationAdoptions !== undefined) {
    if (!Array.isArray(state.generationAdoptions) || state.generationAdoptions.length > MAX_GENERATIONS) {
      return { valid: false, reasonCode: 'runtime-retention-adoptions-invalid' }
    }
    const seen = new Set()
    for (const adoption of state.generationAdoptions) {
      if (!adoption || !GENERATION_ID_RE.test(String(adoption.generationId || '')) ||
          !Number.isFinite(Date.parse(adoption.adoptedAt)) ||
          !ADOPTION_AUTHORITIES.has(adoption.authority) ||
          seen.has(adoption.generationId)) {
        return { valid: false, reasonCode: 'runtime-retention-adoptions-invalid' }
      }
      seen.add(adoption.generationId)
    }
  }
  return { valid: true, reasonCode: 'runtime-retention-state-valid', state }
}

function listOwnedRuntimeGenerations (runtimeBaseRoot, fsImpl = fs) {
  const root = path.resolve(runtimeBaseRoot)
  if (!fsImpl.existsSync(root)) return []
  let entries
  try {
    entries = fsImpl.readdirSync(root, { withFileTypes: true })
  } catch (error) {
    const failure = new Error(`RUNTIME_GENERATION_RETENTION_INVENTORY_FAILED: ${root}`)
    failure.code = error.code || 'RUNTIME_GENERATION_RETENTION_INVENTORY_FAILED'
    throw failure
  }
  const runtimeEntries = entries.filter(entry => entry.name.startsWith('runtime-'))
  if (runtimeEntries.length > MAX_GENERATIONS) {
    const error = new Error(`RUNTIME_GENERATION_RETENTION_INVENTORY_LIMIT: ${root}`)
    error.code = 'RUNTIME_GENERATION_RETENTION_INVENTORY_LIMIT'
    throw error
  }
  return runtimeEntries
    .filter(entry => entry.isDirectory())
    .map(entry => readGenerationManifest(path.join(root, entry.name), fsImpl))
    .filter(item => item.status === 'resolved')
    .map(item => ({
      generationId: item.manifest.generationId,
      manifestCreatedAt: Number.isFinite(Date.parse(item.manifest.createdAt || ''))
        ? item.manifest.createdAt
        : null
    }))
}

function reconcileGenerationAdoptions (state, runtimeBaseRoot, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  const currentGenerationId = GENERATION_ID_RE.test(String(options.generationId || ''))
    ? String(options.generationId)
    : null
  const discovered = listOwnedRuntimeGenerations(runtimeBaseRoot, options.fs || fs)
  const discoveredById = new Map(discovered.map(item => [item.generationId, item]))
  const legacyState = !Array.isArray(state.generationAdoptions)
  const allowed = new Set([...discoveredById.keys(), ...(currentGenerationId ? [currentGenerationId] : [])])
  const adoptions = new Map((state.generationAdoptions || [])
    .filter(item => allowed.has(item.generationId))
    .map(item => [item.generationId, item]))
  const baselineMs = Date.parse(state.installedAt)
  const add = (generationId, authority, fallbackMs) => {
    if (!generationId || adoptions.has(generationId)) return
    const manifestMs = Date.parse(discoveredById.get(generationId)?.manifestCreatedAt || '')
    const adoptedMs = Math.max(fallbackMs, Number.isFinite(manifestMs) ? manifestMs : fallbackMs)
    adoptions.set(generationId, {
      generationId,
      adoptedAt: new Date(adoptedMs).toISOString(),
      authority
    })
  }
  for (const generationId of discoveredById.keys()) {
    add(
      generationId,
      legacyState ? 'protocol-adoption' : 'generation-adoption',
      legacyState ? baselineMs : nowMs
    )
  }
  add(
    currentGenerationId,
    legacyState ? 'protocol-adoption' : 'generation-adoption',
    legacyState ? baselineMs : nowMs
  )
  return [...adoptions.values()].sort((left, right) =>
    left.generationId.localeCompare(right.generationId)
  )
}

function resolveRuntimeGenerationRetentionState (runtimeBaseRoot, options = {}) {
  const fsImpl = options.fs || fs
  const root = path.resolve(runtimeBaseRoot)
  const file = path.join(root, RETENTION_STATE_FILE)
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  if (fsImpl.existsSync(file)) {
    const observed = readJsonFile(file, MAX_RECEIPT_BYTES, fsImpl)
    const validation = validateRetentionState(observed.value, root)
    if (!validation.valid) {
      const error = new Error(`RUNTIME_GENERATION_RETENTION_STATE_INVALID: ${file}`)
      error.code = 'RUNTIME_GENERATION_RETENTION_STATE_INVALID'
      error.file = file
      throw error
    }
    const state = {
      ...validation.state,
      generationAdoptions: reconcileGenerationAdoptions(validation.state, root, {
        fs: fsImpl,
        nowMs,
        generationId: options.generationId
      })
    }
    const content = `${JSON.stringify(state, null, 2)}\n`
    return {
      status: observed.digest === sha256(content) ? 'existing' : 'planned-update',
      file,
      state,
      content,
      digest: sha256(content)
    }
  }
  const baseState = {
    schemaVersion: RUNTIME_GENERATION_RETENTION_STATE_SCHEMA,
    runtimeBaseRoot: portable(root),
    leaseSchema: RUNTIME_GENERATION_LEASE_SCHEMA,
    protocolVersion: RUNTIME_RETENTION_PROTOCOL_VERSION,
    installedAt: new Date(nowMs).toISOString(),
    installedByGeneration: String(options.generationId || 'unknown'),
    adoptionGraceMs: DEFAULT_ADOPTION_GRACE_MS,
    generationGraceMs: DEFAULT_GENERATION_GRACE_MS,
    gcPolicy: 'preview-digest-explicit-apply'
  }
  const state = {
    ...baseState,
    generationAdoptions: reconcileGenerationAdoptions(baseState, root, {
      fs: fsImpl,
      nowMs,
      generationId: options.generationId
    })
  }
  const content = `${JSON.stringify(state, null, 2)}\n`
  return { status: 'planned', file, state, content, digest: sha256(content) }
}

function readDirectoryEntriesBounded (directory, remaining, fsImpl = fs) {
  if (remaining < 0) return { entries: [], overflow: true }
  if (fsImpl === fs && typeof fsImpl.opendirSync === 'function') {
    const entries = []
    const handle = fsImpl.opendirSync(directory)
    try {
      let entry
      while ((entry = handle.readSync()) !== null) {
        if (entries.length >= remaining) return { entries, overflow: true }
        entries.push(entry)
      }
    } finally {
      handle.closeSync()
    }
    return { entries, overflow: false }
  }
  const entries = fsImpl.readdirSync(directory, { withFileTypes: true })
  return entries.length > remaining
    ? { entries: entries.slice(0, remaining), overflow: true }
    : { entries, overflow: false }
}

function inspectGenerationTree (runtimeRoot, options = {}) {
  const fsImpl = options.fs || fs
  const hashFiles = options.hashFiles === true
  const root = path.resolve(runtimeRoot)
  const pending = [{ absolute: root, relative: '' }]
  const entries = []
  let files = 0
  let directories = 0
  let bytes = 0
  while (pending.length) {
    if (entries.length >= MAX_GENERATION_ENTRIES) {
      return {
        complete: false,
        reasonCode: 'generation-entry-limit-exceeded',
        files, directories, bytes, treeDigest: null
      }
    }
    const current = pending.pop()
    let stat
    try { stat = fsImpl.lstatSync(current.absolute) } catch (error) {
      return { complete: false, reasonCode: error.code || 'generation-stat-failed', files, directories, bytes, treeDigest: null }
    }
    if (stat.isSymbolicLink()) {
      return { complete: false, reasonCode: 'generation-reparse-or-symlink', files, directories, bytes, treeDigest: null }
    }
    if (stat.isDirectory()) {
      directories += 1
      entries.push({ path: current.relative || '.', type: 'directory' })
      let observation
      try {
        observation = readDirectoryEntriesBounded(
          current.absolute,
          MAX_GENERATION_ENTRIES - entries.length - pending.length,
          fsImpl
        )
      } catch (error) {
        return { complete: false, reasonCode: error.code || 'generation-read-failed', files, directories, bytes, treeDigest: null }
      }
      if (observation.overflow) {
        return { complete: false, reasonCode: 'generation-entry-limit-exceeded', files, directories, bytes, treeDigest: null }
      }
      for (const child of observation.entries.sort((a, b) => a.name.localeCompare(b.name)).reverse()) {
        const absolute = path.join(current.absolute, child.name)
        const relative = current.relative ? `${current.relative}/${child.name}` : child.name
        pending.push({ absolute, relative })
      }
      continue
    }
    if (!stat.isFile()) {
      return { complete: false, reasonCode: 'generation-entry-type-unsupported', files, directories, bytes, treeDigest: null }
    }
    files += 1
    if (stat.size > MAX_GENERATION_FILE_BYTES) {
      return { complete: false, reasonCode: 'generation-file-size-limit-exceeded', files, directories, bytes, treeDigest: null }
    }
    bytes += stat.size
    if (bytes > MAX_GENERATION_TREE_BYTES) {
      return { complete: false, reasonCode: 'generation-tree-size-limit-exceeded', files, directories, bytes, treeDigest: null }
    }
    const entry = { path: current.relative, type: 'file', bytes: stat.size }
    if (hashFiles) {
      try { entry.digest = sha256(fsImpl.readFileSync(current.absolute)) } catch (error) {
        return { complete: false, reasonCode: error.code || 'generation-hash-failed', files, directories, bytes, treeDigest: null }
      }
    }
    entries.push(entry)
  }
  return {
    complete: true,
    reasonCode: 'generation-tree-complete',
    files,
    directories,
    bytes,
    treeDigest: sha256(entries)
  }
}

function readHostReceipt (target, fsImpl = fs) {
  if (!fsImpl.existsSync(target.receiptFile)) {
    return {
      host: target.host,
      receiptFile: portable(target.receiptFile),
      status: 'missing',
      digest: null,
      receiptSummary: null,
      currentRefs: [portable(target.runtimeRoot)]
    }
  }
  const observed = readJsonFile(target.receiptFile, MAX_RECEIPT_BYTES, fsImpl)
  if (observed.status !== 'resolved') {
    return {
      host: target.host,
      receiptFile: portable(target.receiptFile),
      status: 'invalid',
      digest: observed.digest,
      errorCode: observed.errorCode,
      receiptSummary: null,
      currentRefs: [portable(target.runtimeRoot)]
    }
  }
  const receipt = observed.value
  const currentRefs = [target.runtimeRoot, receipt.runtimeRoot]
    .filter(Boolean)
    .map(portable)
  for (const managed of receipt.managedPaths || []) {
    if (typeof managed !== 'string') continue
    const managedPath = path.resolve(managed)
    if (!isInside(target.runtimeBaseRoot, managedPath)) continue
    const relative = path.relative(path.resolve(target.runtimeBaseRoot), managedPath)
    const generationDirectory = relative.split(path.sep)[0]
    if (generationDirectory.startsWith('runtime-')) {
      currentRefs.push(portable(path.join(target.runtimeBaseRoot, generationDirectory)))
    }
  }
  return {
    host: target.host,
    receiptFile: portable(target.receiptFile),
    status: 'resolved',
    digest: observed.digest,
    receiptSummary: {
      schemaVersion: receipt.schemaVersion || null,
      runtimeRoot: receipt.runtimeRoot || null,
      generationId: receipt.runtimeGeneration?.generationId || null,
      result: receipt.result || null,
      managedPathCount: Array.isArray(receipt.managedPaths) ? receipt.managedPaths.length : 0,
      retainedRuntimeRootCount: Array.isArray(receipt.retainedRuntimeRoots)
        ? receipt.retainedRuntimeRoots.length
        : 0
    },
    currentRefs: [...new Set(currentRefs)]
  }
}

function rootIsCurrent (runtimeRoot, currentRefs) {
  return currentRefs.some(reference => samePath(runtimeRoot, reference) || isInside(runtimeRoot, reference))
}

function leaseEvidenceDigest (leases) {
  if (!leases) return null
  const itemIdentity = item => ({
    path: item.path,
    leaseId: item.lease?.leaseId || null,
    pidStatus: item.pidStatus || null,
    reasonCode: item.reasonCode || null
  })
  return sha256({
    complete: leases.complete,
    live: leases.live.map(itemIdentity),
    dead: leases.dead.map(itemIdentity),
    unknown: leases.unknown.map(itemIdentity),
    transient: leases.transient.map(item => ({ path: item.path, reasonCode: item.reasonCode }))
  })
}

function claimMapKey (runtimeBaseRoot, generationId) {
  return `${portable(runtimeBaseRoot)}|${String(generationId || '')}`
}

function classifyGeneration (runtimeBaseRoot, runtimeRoot, stateObservation, currentRefs, options = {}) {
  const fsImpl = options.fs || fs
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  const tree = inspectGenerationTree(runtimeRoot, { fs: fsImpl, hashFiles: false })
  const generation = readGenerationManifest(runtimeRoot, fsImpl)
  const leases = generation.status === 'resolved'
    ? inspectRuntimeGenerationLeases(runtimeBaseRoot, generation.manifest.generationId, {
        fs: fsImpl,
        nowMs,
        pidProbe: options.pidProbe,
        runtimeRoot,
        allowedClaimId: options.allowedClaims?.[
          claimMapKey(runtimeBaseRoot, generation.manifest.generationId)
        ]
      })
    : null
  const base = {
    runtimeBaseRoot: portable(runtimeBaseRoot),
    runtimeRoot: portable(runtimeRoot),
    generationId: generation.manifest?.generationId || null,
    manifestPath: portable(path.join(runtimeRoot, 'runtime-generation.json')),
    manifestDigest: generation.status === 'resolved'
      ? sha256(fsImpl.readFileSync(path.join(runtimeRoot, 'runtime-generation.json')))
      : null,
    files: tree.files,
    directories: tree.directories,
    bytes: tree.bytes,
    treeDigest: tree.treeDigest,
    treeComplete: tree.complete,
    leases,
    leaseEvidenceDigest: leaseEvidenceDigest(leases)
  }
  if (rootIsCurrent(runtimeRoot, currentRefs)) {
    return { ...base, classification: 'current', eligible: false, reasonCode: 'current-entry-reference' }
  }
  if (generation.status !== 'resolved') {
    return { ...base, classification: 'blocked-unknown', eligible: false, reasonCode: 'generation-manifest-invalid' }
  }
  if (!tree.complete) {
    return { ...base, classification: 'blocked-unknown', eligible: false, reasonCode: tree.reasonCode }
  }
  if (!base.leases.complete) {
    return { ...base, classification: 'blocked-unknown', eligible: false, reasonCode: 'generation-lease-evidence-incomplete' }
  }
  if (base.leases.live.length) {
    return { ...base, classification: 'retained-live', eligible: false, reasonCode: 'live-process-lease' }
  }
  if (!stateObservation) {
    return { ...base, classification: 'blocked-unknown', eligible: false, reasonCode: 'retention-protocol-not-initialized' }
  }
  const adoption = (stateObservation.generationAdoptions || [])
    .find(item => item.generationId === generation.manifest.generationId)
  if (!adoption) {
    return { ...base, classification: 'blocked-unknown', eligible: false, reasonCode: 'generation-adoption-evidence-missing' }
  }
  const graceBaseMs = Date.parse(adoption.adoptedAt)
  const graceMs = adoption.authority === 'protocol-adoption'
    ? stateObservation.adoptionGraceMs
    : stateObservation.generationGraceMs
  const graceUntilMs = graceBaseMs + graceMs
  if (nowMs < graceUntilMs) {
    return {
      ...base,
      classification: 'retained-grace',
      eligible: false,
      reasonCode: adoption.authority === 'protocol-adoption'
        ? 'lease-protocol-adoption-grace'
        : 'generation-local-adoption-grace',
      graceUntil: new Date(graceUntilMs).toISOString()
    }
  }
  if (options.hashFiles) {
    const hashedTree = inspectGenerationTree(runtimeRoot, { fs: fsImpl, hashFiles: true })
    if (!hashedTree.complete) {
      return { ...base, classification: 'blocked-unknown', eligible: false, reasonCode: hashedTree.reasonCode }
    }
    Object.assign(base, {
      files: hashedTree.files,
      directories: hashedTree.directories,
      bytes: hashedTree.bytes,
      treeDigest: hashedTree.treeDigest,
      treeComplete: true
    })
  }
  return {
    ...base,
    classification: 'orphan-gc-candidate',
    eligible: true,
    reasonCode: 'inactive-owned-generation-after-grace',
    graceUntil: new Date(graceUntilMs).toISOString(),
    leaseRoot: portable(path.join(runtimeBaseRoot, LEASE_ROOT_NAME, generation.manifest.generationId))
  }
}

function inspectRuntimeGenerationRetention (options = {}) {
  const fsImpl = options.fs || fs
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  let targets = options.targets
  if (!targets) {
    const { resolveGlobalHostTargets } = require('./global-host-target.js')
    targets = resolveGlobalHostTargets({
      packageRoot: options.packageRoot,
      home: options.home,
      env: options.env,
      fs: fsImpl
    })
  }
  const groups = new Map()
  for (const target of targets) {
    const key = process.platform === 'win32'
      ? path.resolve(target.runtimeBaseRoot).toLowerCase()
      : path.resolve(target.runtimeBaseRoot)
    if (!groups.has(key)) groups.set(key, { runtimeBaseRoot: path.resolve(target.runtimeBaseRoot), targets: [] })
    groups.get(key).targets.push(target)
  }
  const roots = []
  for (const group of groups.values()) {
    const receipts = group.targets.map(target => readHostReceipt(target, fsImpl))
    const currentRefs = [...new Set(receipts.flatMap(item => item.currentRefs))]
    let state = null
    let stateStatus = 'missing'
    let stateDigest = null
    const stateFile = path.join(group.runtimeBaseRoot, RETENTION_STATE_FILE)
    if (fsImpl.existsSync(stateFile)) {
      const observed = readJsonFile(stateFile, MAX_RECEIPT_BYTES, fsImpl)
      const validation = validateRetentionState(observed.value, group.runtimeBaseRoot)
      if (validation.valid) {
        state = validation.state
        stateStatus = 'resolved'
        stateDigest = observed.digest
      } else stateStatus = 'invalid'
    }
    let entries = []
    let inventoryComplete = true
    let inventoryErrorCode = null
    if (fsImpl.existsSync(group.runtimeBaseRoot)) {
      try {
        entries = fsImpl.readdirSync(group.runtimeBaseRoot, { withFileTypes: true })
          .filter(entry => entry.name.startsWith('runtime-'))
      } catch (error) {
        inventoryComplete = false
        inventoryErrorCode = error.code || 'runtime-base-unreadable'
      }
    }
    if (entries.length > MAX_GENERATIONS) {
      inventoryComplete = false
      inventoryErrorCode = 'runtime-generation-limit-exceeded'
      entries = entries.slice(0, MAX_GENERATIONS)
    }
    const receiptComplete = receipts.every(item => item.status === 'resolved')
    const generations = entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(entry => {
        const runtimeRoot = path.join(group.runtimeBaseRoot, entry.name)
        if (!entry.isDirectory()) {
          return {
            runtimeBaseRoot: portable(group.runtimeBaseRoot),
            runtimeRoot: portable(runtimeRoot),
            generationId: null,
            classification: 'blocked-unknown',
            eligible: false,
            reasonCode: 'runtime-generation-entry-not-directory',
            files: 0,
            directories: 0,
            bytes: 0,
            treeComplete: false
          }
        }
        if (!receiptComplete && !rootIsCurrent(runtimeRoot, currentRefs)) {
          return {
            runtimeBaseRoot: portable(group.runtimeBaseRoot),
            runtimeRoot: portable(runtimeRoot),
            generationId: null,
            classification: 'blocked-unknown',
            eligible: false,
            reasonCode: 'host-receipt-evidence-incomplete',
            files: 0,
            directories: 0,
            bytes: 0,
            treeComplete: false
          }
        }
        return classifyGeneration(group.runtimeBaseRoot, runtimeRoot, state, currentRefs, {
          fs: fsImpl,
          nowMs,
          hashFiles: options.hashCandidates === true,
          pidProbe: options.pidProbe,
          allowedClaims: options.allowedClaims
        })
      })
    roots.push({
      runtimeBaseRoot: portable(group.runtimeBaseRoot),
      hosts: group.targets.map(target => target.host).sort(),
      stateFile: portable(stateFile),
      stateStatus,
      stateDigest,
      state,
      receipts,
      currentRefs,
      inventoryComplete,
      inventoryErrorCode,
      generations
    })
  }
  const generations = roots.flatMap(item => item.generations)
  const counts = Object.fromEntries([
    'current', 'retained-live', 'retained-grace', 'orphan-gc-candidate', 'blocked-unknown'
  ].map(classification => [classification, generations.filter(item => item.classification === classification).length]))
  return {
    schemaVersion: 'RuntimeGenerationRetentionStatusV1',
    observedAt: new Date(nowMs).toISOString(),
    roots,
    counts,
    totals: {
      runtimeBaseRoots: roots.length,
      generations: generations.length,
      files: generations.reduce((sum, item) => sum + Number(item.files || 0), 0),
      bytes: generations.reduce((sum, item) => sum + Number(item.bytes || 0), 0),
      candidateBytes: generations.filter(item => item.eligible).reduce((sum, item) => sum + Number(item.bytes || 0), 0)
    }
  }
}

function buildRuntimeGenerationGcPlan (options = {}) {
  const status = inspectRuntimeGenerationRetention({ ...options, hashCandidates: true })
  const candidates = status.roots.flatMap(root => root.generations
    .filter(item => item.eligible)
    .map(item => ({
      runtimeBaseRoot: item.runtimeBaseRoot,
      runtimeRoot: item.runtimeRoot,
      generationId: item.generationId,
      manifestDigest: item.manifestDigest,
      treeDigest: item.treeDigest,
      files: item.files,
      directories: item.directories,
      bytes: item.bytes,
      leaseRoot: item.leaseRoot
    })))
  const material = {
    schemaVersion: RUNTIME_GENERATION_GC_PLAN_SCHEMA,
    roots: status.roots.map(root => ({
      runtimeBaseRoot: root.runtimeBaseRoot,
      hosts: root.hosts,
      stateDigest: root.stateDigest,
      inventoryComplete: root.inventoryComplete,
      currentRefs: root.currentRefs.slice().sort(),
      receiptIdentities: root.receipts.map(receipt => ({
        host: receipt.host,
        receiptFile: receipt.receiptFile,
        status: receipt.status,
        digest: receipt.digest
      })),
      generationIdentities: root.generations.map(generation => ({
        runtimeRoot: generation.runtimeRoot,
        generationId: generation.generationId,
        classification: generation.classification,
        eligible: generation.eligible,
        manifestDigest: generation.manifestDigest || null,
        treeDigest: generation.treeDigest || null,
        leaseEvidenceDigest: generation.leaseEvidenceDigest || null,
        reasonCode: generation.reasonCode
      }))
    })),
    candidates
  }
  const planDigest = sha256(material)
  return {
    schemaVersion: RUNTIME_GENERATION_GC_PLAN_SCHEMA,
    mode: 'preview',
    generatedAt: status.observedAt,
    planDigest,
    applyReady: candidates.length > 0 &&
      status.roots.every(root => root.inventoryComplete) &&
      status.roots.every(root => root.receipts.every(receipt => receipt.status === 'resolved')) &&
      status.roots.filter(root => root.generations.some(item => item.eligible))
        .every(root => root.stateStatus === 'resolved') &&
      candidates.every(item =>
        DIGEST_RE.test(String(item.manifestDigest || '')) &&
        DIGEST_RE.test(String(item.treeDigest || ''))
      ),
    candidates,
    retained: status.roots.flatMap(root => root.generations.filter(item => !item.eligible)),
    totals: {
      candidates: candidates.length,
      candidateFiles: candidates.reduce((sum, item) => sum + item.files, 0),
      candidateBytes: candidates.reduce((sum, item) => sum + item.bytes, 0)
    },
    status
  }
}

function ensurePlainDirectory (directory, fsImpl = fs) {
  if (!fsImpl.existsSync(directory)) {
    fsImpl.mkdirSync(directory)
    return
  }
  const stat = fsImpl.lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    const error = new Error(`RUNTIME_GENERATION_GC_REPARSE_BLOCKED: ${directory}`)
    error.code = 'RUNTIME_GENERATION_GC_REPARSE_BLOCKED'
    throw error
  }
}

function recoverStaleRuntimeGenerationGcClaim (paths, candidate, options = {}) {
  const fsImpl = options.fs || fs
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  const staleMs = Number.isInteger(options.gcClaimStaleMs) && options.gcClaimStaleMs >= 60 * 1000
    ? options.gcClaimStaleMs
    : DEFAULT_GC_CLAIM_STALE_MS
  const pidProbe = options.pidProbe || defaultPidProbe
  const expected = {
    generationId: candidate.generationId,
    runtimeRoot: candidate.runtimeRoot
  }
  const cleanupStaleSlot = () => {
    if (!fsImpl.existsSync(paths.staleClaimFile)) return { status: 'empty' }
    const stale = readRuntimeGenerationGcClaim(paths.staleClaimFile, expected, fsImpl)
    if (stale.status !== 'resolved') return { status: 'blocked', reasonCode: 'gc-stale-claim-invalid' }
    const ageMs = nowMs - Date.parse(stale.claim.createdAt)
    const probe = pidProbe(stale.claim.pid, stale.claim)
    if (ageMs < staleMs || probe.status !== 'dead') {
      return { status: 'blocked', reasonCode: 'gc-stale-claim-owner-not-dead' }
    }
    try { fsImpl.unlinkSync(paths.staleClaimFile) } catch (error) {
      return { status: 'blocked', reasonCode: error.code || 'gc-stale-claim-cleanup-failed' }
    }
    return { status: 'cleaned' }
  }
  const staleSlot = cleanupStaleSlot()
  if (staleSlot.status === 'blocked') return staleSlot
  const observed = readRuntimeGenerationGcClaim(paths.claimFile, expected, fsImpl)
  if (observed.status === 'missing') return { status: 'retry' }
  if (observed.status !== 'resolved') return { status: 'blocked', reasonCode: observed.reasonCode }
  const ageMs = nowMs - Date.parse(observed.claim.createdAt)
  const probe = pidProbe(observed.claim.pid, observed.claim)
  if (ageMs < staleMs || probe.status !== 'dead') {
    return { status: 'blocked', reasonCode: 'gc-claim-owner-not-dead' }
  }
  try {
    fsImpl.renameSync(paths.claimFile, paths.staleClaimFile)
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'retry' }
    return { status: 'blocked', reasonCode: error.code || 'gc-claim-stale-rename-failed' }
  }
  const moved = readRuntimeGenerationGcClaim(paths.staleClaimFile, expected, fsImpl)
  if (moved.status !== 'resolved' || moved.claim.claimId !== observed.claim.claimId) {
    return { status: 'blocked', reasonCode: 'gc-claim-stale-readback-failed' }
  }
  try { fsImpl.unlinkSync(paths.staleClaimFile) } catch (error) {
    return { status: 'blocked', reasonCode: error.code || 'gc-claim-stale-cleanup-failed' }
  }
  return { status: 'recovered', claimId: observed.claim.claimId }
}

function createRuntimeGenerationGcClaim (candidate, planDigest, options = {}) {
  const fsImpl = options.fs || fs
  const pid = Number.isInteger(options.pid) ? options.pid : process.pid
  const paths = resolveLeasePaths(candidate.runtimeRoot, 'generation-gc', pid, fsImpl)
  if (paths.status !== 'resolved' ||
      paths.generation.manifest.generationId !== candidate.generationId ||
      !samePath(paths.generation.runtimeBaseRoot, candidate.runtimeBaseRoot)) {
    const error = new Error('RUNTIME_GENERATION_GC_CLAIM_OWNERSHIP_FAILED')
    error.code = 'RUNTIME_GENERATION_GC_CLAIM_OWNERSHIP_FAILED'
    throw error
  }
  ensurePlainDirectory(path.resolve(candidate.runtimeBaseRoot), fsImpl)
  ensurePlainDirectory(paths.leaseRoot, fsImpl)
  ensurePlainDirectory(paths.generationLeaseRoot, fsImpl)
  if (fsImpl.existsSync(paths.staleClaimFile)) {
    const recovery = recoverStaleRuntimeGenerationGcClaim(paths, candidate, options)
    if (!['cleaned', 'recovered', 'retry'].includes(recovery.status)) {
      const blocked = new Error(`RUNTIME_GENERATION_GC_CLAIM_BLOCKED: ${recovery.reasonCode}`)
      blocked.code = 'RUNTIME_GENERATION_GC_CLAIM_BLOCKED'
      blocked.reasonCode = recovery.reasonCode
      throw blocked
    }
  }
  const createdAt = new Date(Number.isFinite(options.nowMs) ? options.nowMs : Date.now()).toISOString()
  const claim = {
    schemaVersion: RUNTIME_GENERATION_GC_CLAIM_SCHEMA,
    claimId: sha256(`${planDigest}|${candidate.generationId}|${pid}|${createdAt}|${crypto.randomBytes(16).toString('hex')}`),
    planDigest,
    generationId: candidate.generationId,
    runtimeRoot: portable(candidate.runtimeRoot),
    pid,
    createdAt
  }
  const body = `${JSON.stringify(claim, null, 2)}\n`
  let descriptor
  let claimOwned = false
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        descriptor = fsImpl.openSync(paths.claimFile, 'wx')
        break
      } catch (error) {
        if (error.code !== 'EEXIST' || attempt > 0) throw error
        const recovery = recoverStaleRuntimeGenerationGcClaim(paths, candidate, options)
        if (!['recovered', 'retry'].includes(recovery.status)) {
          const blocked = new Error(`RUNTIME_GENERATION_GC_CLAIM_BLOCKED: ${recovery.reasonCode}`)
          blocked.code = 'RUNTIME_GENERATION_GC_CLAIM_BLOCKED'
          blocked.reasonCode = recovery.reasonCode
          throw blocked
        }
      }
    }
    if (descriptor === undefined) {
      const error = new Error('RUNTIME_GENERATION_GC_CLAIM_CREATE_FAILED')
      error.code = 'RUNTIME_GENERATION_GC_CLAIM_CREATE_FAILED'
      throw error
    }
    claimOwned = true
    try {
      fsImpl.writeFileSync(descriptor, body, 'utf8')
      if (typeof fsImpl.fsyncSync === 'function') fsImpl.fsyncSync(descriptor)
    } finally {
      fsImpl.closeSync(descriptor)
      descriptor = undefined
    }
    const observed = readRuntimeGenerationGcClaim(paths.claimFile, {
      generationId: candidate.generationId,
      runtimeRoot: candidate.runtimeRoot
    }, fsImpl)
    const validation = validateGcClaim(observed.claim, {
      generationId: candidate.generationId,
      runtimeRoot: candidate.runtimeRoot
    })
    if (!validation.valid || validation.claim.claimId !== claim.claimId) {
      const error = new Error('RUNTIME_GENERATION_GC_CLAIM_READBACK_FAILED')
      error.code = 'RUNTIME_GENERATION_GC_CLAIM_READBACK_FAILED'
      throw error
    }
    return { claim, claimFile: paths.claimFile, generationLeaseRoot: paths.generationLeaseRoot, leaseRoot: paths.leaseRoot }
  } catch (error) {
    if (descriptor !== undefined) {
      try { fsImpl.closeSync(descriptor) } catch {}
    }
    if (claimOwned) {
      try { fsImpl.unlinkSync(paths.claimFile) } catch {}
    }
    throw error
  }
}

function releaseRuntimeGenerationGcClaim (record, fsImpl = fs) {
  if (!record) return
  const observed = readRuntimeGenerationGcClaim(record.claimFile, {
    generationId: record.claim.generationId,
    runtimeRoot: record.claim.runtimeRoot
  }, fsImpl)
  if (observed.status === 'resolved' && observed.claim.claimId === record.claim.claimId) {
    try { fsImpl.unlinkSync(record.claimFile) } catch {}
  }
  for (const directory of [record.generationLeaseRoot, record.leaseRoot]) {
    try { fsImpl.rmdirSync(directory) } catch {}
  }
}

function sameCandidateEvidence (expected, observed) {
  return Boolean(observed?.eligible) &&
    samePath(expected.runtimeRoot, observed.runtimeRoot) &&
    expected.generationId === observed.generationId &&
    expected.manifestDigest === observed.manifestDigest &&
    expected.treeDigest === observed.treeDigest &&
    expected.leaseEvidenceDigest === observed.leaseEvidenceDigest
}

function retentionRootControlDigest (root) {
  return sha256({
    runtimeBaseRoot: root.runtimeBaseRoot,
    stateDigest: root.stateDigest || null,
    currentRefs: (root.currentRefs || []).slice().sort(),
    receiptIdentities: (root.receipts || []).map(receipt => ({
      host: receipt.host,
      receiptFile: receipt.receiptFile,
      status: receipt.status,
      digest: receipt.digest
    })).sort((left, right) => left.host.localeCompare(right.host))
  })
}

function inspectCandidateBeforeDelete (candidate, options = {}, allowedClaims = {}) {
  const fsImpl = options.fs || fs
  let targets = options.targets
  if (!targets) {
    const { resolveGlobalHostTargets } = require('./global-host-target.js')
    targets = resolveGlobalHostTargets({
      packageRoot: options.packageRoot,
      home: options.home,
      env: options.env,
      fs: fsImpl
    })
  }
  const groupTargets = targets.filter(target => samePath(target.runtimeBaseRoot, candidate.runtimeBaseRoot))
  if (!groupTargets.length) return { complete: false, reasonCode: 'runtime-base-target-missing' }
  const receipts = groupTargets.map(target => readHostReceipt(target, fsImpl))
  if (!receipts.every(receipt => receipt.status === 'resolved')) {
    return { complete: false, reasonCode: 'host-receipt-evidence-incomplete' }
  }
  const stateFile = path.join(path.resolve(candidate.runtimeBaseRoot), RETENTION_STATE_FILE)
  const stateObservation = readJsonFile(stateFile, MAX_RECEIPT_BYTES, fsImpl)
  const stateValidation = validateRetentionState(stateObservation.value, candidate.runtimeBaseRoot)
  if (!stateValidation.valid) return { complete: false, reasonCode: stateValidation.reasonCode }
  const currentRefs = [...new Set(receipts.flatMap(receipt => receipt.currentRefs))]
  const generation = classifyGeneration(
    candidate.runtimeBaseRoot,
    candidate.runtimeRoot,
    stateValidation.state,
    currentRefs,
    {
      fs: fsImpl,
      nowMs: options.nowMs,
      hashFiles: true,
      pidProbe: options.pidProbe,
      allowedClaims
    }
  )
  const root = {
    runtimeBaseRoot: portable(candidate.runtimeBaseRoot),
    stateDigest: stateObservation.digest,
    currentRefs,
    receipts
  }
  return {
    complete: true,
    reasonCode: 'candidate-preflight-complete',
    generation,
    rootControlDigest: retentionRootControlDigest(root)
  }
}

function applyRuntimeGenerationGcPlan (options = {}) {
  const fsImpl = options.fs || fs
  const expectedPlanDigest = String(options.planDigest || '')
  if (!DIGEST_RE.test(expectedPlanDigest)) {
    return {
      schemaVersion: RUNTIME_GENERATION_GC_APPLY_SCHEMA,
      status: 'blocked',
      errorCode: 'RUNTIME_GENERATION_GC_PLAN_DIGEST_REQUIRED',
      removed: [],
      failed: []
    }
  }
  const plan = buildRuntimeGenerationGcPlan(options)
  if (plan.planDigest !== expectedPlanDigest) {
    return {
      schemaVersion: RUNTIME_GENERATION_GC_APPLY_SCHEMA,
      status: 'blocked',
      errorCode: 'RUNTIME_GENERATION_GC_PLAN_STALE',
      expectedPlanDigest,
      actualPlanDigest: plan.planDigest,
      removed: [],
      failed: []
    }
  }
  if (!plan.applyReady) {
    return {
      schemaVersion: RUNTIME_GENERATION_GC_APPLY_SCHEMA,
      status: 'blocked',
      errorCode: 'RUNTIME_GENERATION_GC_NOT_READY',
      planDigest: plan.planDigest,
      removed: [],
      failed: []
    }
  }
  for (const candidate of plan.candidates) {
    const root = path.resolve(candidate.runtimeBaseRoot)
    const target = path.resolve(candidate.runtimeRoot)
    if (!isInside(root, target) || samePath(root, target) ||
        path.basename(target) !== `runtime-${candidate.generationId}`) {
      return {
        schemaVersion: RUNTIME_GENERATION_GC_APPLY_SCHEMA,
        status: 'blocked',
        errorCode: 'RUNTIME_GENERATION_GC_PATH_ESCAPE',
        planDigest: plan.planDigest,
        removed: [],
        failed: []
      }
    }
    if (candidate.leaseRoot) {
      const leaseBase = path.join(root, LEASE_ROOT_NAME)
      if (!isInside(leaseBase, candidate.leaseRoot) || samePath(leaseBase, candidate.leaseRoot)) {
        return {
          schemaVersion: RUNTIME_GENERATION_GC_APPLY_SCHEMA,
          status: 'blocked',
          errorCode: 'RUNTIME_GENERATION_GC_LEASE_ESCAPE',
          planDigest: plan.planDigest,
          removed: [],
          failed: []
        }
      }
    }
  }
  const claimRecords = []
  const allowedClaims = {}
  try {
    for (const candidate of plan.candidates) {
      const record = createRuntimeGenerationGcClaim(candidate, plan.planDigest, {
        fs: fsImpl,
        nowMs: options.nowMs
      })
      claimRecords.push(record)
      allowedClaims[claimMapKey(candidate.runtimeBaseRoot, candidate.generationId)] = record.claim.claimId
    }
  } catch (error) {
    for (const record of claimRecords.reverse()) releaseRuntimeGenerationGcClaim(record, fsImpl)
    return {
      schemaVersion: RUNTIME_GENERATION_GC_APPLY_SCHEMA,
      status: 'blocked',
      errorCode: error.code || 'RUNTIME_GENERATION_GC_CLAIM_FAILED',
      planDigest: plan.planDigest,
      removed: [],
      failed: []
    }
  }
  const claimedPlan = buildRuntimeGenerationGcPlan({ ...options, allowedClaims })
  if (claimedPlan.planDigest !== plan.planDigest || !claimedPlan.applyReady) {
    for (const record of claimRecords.reverse()) releaseRuntimeGenerationGcClaim(record, fsImpl)
    return {
      schemaVersion: RUNTIME_GENERATION_GC_APPLY_SCHEMA,
      status: 'blocked',
      errorCode: 'RUNTIME_GENERATION_GC_CLAIM_RECHECK_FAILED',
      expectedPlanDigest: plan.planDigest,
      actualPlanDigest: claimedPlan.planDigest,
      removed: [],
      failed: []
    }
  }
  const expectedRoots = new Map(claimedPlan.status.roots.map(root => [
    process.platform === 'win32' ? root.runtimeBaseRoot.toLowerCase() : root.runtimeBaseRoot,
    root
  ]))
  const expectedGenerations = new Map(claimedPlan.status.roots.flatMap(root =>
    root.generations.map(generation => [
      process.platform === 'win32' ? generation.runtimeRoot.toLowerCase() : generation.runtimeRoot,
      generation
    ])
  ))
  for (const candidate of plan.candidates) {
    const rootKey = process.platform === 'win32'
      ? candidate.runtimeBaseRoot.toLowerCase()
      : candidate.runtimeBaseRoot
    const generationKey = process.platform === 'win32'
      ? candidate.runtimeRoot.toLowerCase()
      : candidate.runtimeRoot
    const observed = inspectCandidateBeforeDelete(candidate, { ...options, fs: fsImpl }, allowedClaims)
    if (!observed.complete ||
        observed.rootControlDigest !== retentionRootControlDigest(expectedRoots.get(rootKey) || {}) ||
        !sameCandidateEvidence(expectedGenerations.get(generationKey), observed.generation)) {
      for (const record of [...claimRecords].reverse()) releaseRuntimeGenerationGcClaim(record, fsImpl)
      return {
        schemaVersion: RUNTIME_GENERATION_GC_APPLY_SCHEMA,
        status: 'blocked',
        errorCode: 'RUNTIME_GENERATION_GC_PREFLIGHT_CHANGED',
        planDigest: plan.planDigest,
        removed: [],
        failed: []
      }
    }
  }
  const removed = []
  const failed = []
  try {
    for (const candidate of plan.candidates) {
      try {
        const rootKey = process.platform === 'win32'
          ? candidate.runtimeBaseRoot.toLowerCase()
          : candidate.runtimeBaseRoot
        const generationKey = process.platform === 'win32'
          ? candidate.runtimeRoot.toLowerCase()
          : candidate.runtimeRoot
        const expectedRoot = expectedRoots.get(rootKey)
        const expectedGeneration = expectedGenerations.get(generationKey)
        const observed = inspectCandidateBeforeDelete(candidate, { ...options, fs: fsImpl }, allowedClaims)
        if (!observed.complete ||
            observed.rootControlDigest !== retentionRootControlDigest(expectedRoot || {}) ||
            !sameCandidateEvidence(expectedGeneration, observed.generation)) {
          const error = new Error('generation evidence changed after claim')
          error.code = 'RUNTIME_GENERATION_GC_PREFLIGHT_CHANGED'
          throw error
        }
        fsImpl.rmSync(path.resolve(candidate.runtimeRoot), { recursive: true, force: false })
        if (fsImpl.existsSync(candidate.runtimeRoot)) {
          const error = new Error('generation root still exists after removal')
          error.code = 'RUNTIME_GENERATION_GC_READBACK_FAILED'
          throw error
        }
        const removedItem = { ...candidate, leaseCleanup: 'not-needed' }
        if (candidate.leaseRoot && fsImpl.existsSync(candidate.leaseRoot)) {
          try {
            fsImpl.rmSync(path.resolve(candidate.leaseRoot), { recursive: true, force: true })
            removedItem.leaseCleanup = 'complete'
          } catch (error) {
            removedItem.leaseCleanup = 'failed'
            failed.push({
              ...candidate,
              phase: 'lease-cleanup',
              errorCode: error.code || 'RUNTIME_GENERATION_GC_LEASE_CLEANUP_FAILED',
              message: error.message
            })
          }
        }
        removed.push(removedItem)
      } catch (error) {
        failed.push({
          ...candidate,
          errorCode: error.code || 'RUNTIME_GENERATION_GC_DELETE_FAILED',
          message: error.message
        })
        break
      }
    }
  } finally {
    for (const record of claimRecords.reverse()) releaseRuntimeGenerationGcClaim(record, fsImpl)
  }
  return {
    schemaVersion: RUNTIME_GENERATION_GC_APPLY_SCHEMA,
    status: failed.length ? 'partial' : 'complete',
    planDigest: plan.planDigest,
    removed,
    failed,
    reclaimedBytes: removed.reduce((sum, item) => sum + item.bytes, 0),
    remainingPreview: buildRuntimeGenerationGcPlan(options).totals
  }
}

module.exports = {
  DEFAULT_ADOPTION_GRACE_MS,
  DEFAULT_GC_CLAIM_STALE_MS,
  DEFAULT_GENERATION_GRACE_MS,
  MAX_GENERATION_FILE_BYTES,
  MAX_GENERATION_TREE_BYTES,
  MAX_GENERATIONS,
  RETENTION_STATE_FILE,
  RUNTIME_GENERATION_GC_APPLY_SCHEMA,
  RUNTIME_GENERATION_GC_PLAN_SCHEMA,
  RUNTIME_GENERATION_RETENTION_STATE_SCHEMA,
  RUNTIME_RETENTION_PROTOCOL_VERSION,
  applyRuntimeGenerationGcPlan,
  buildRuntimeGenerationGcPlan,
  createRuntimeGenerationGcClaim,
  inspectGenerationTree,
  inspectRuntimeGenerationRetention,
  releaseRuntimeGenerationGcClaim,
  recoverStaleRuntimeGenerationGcClaim,
  resolveRuntimeGenerationRetentionState,
  validateRetentionState
}
