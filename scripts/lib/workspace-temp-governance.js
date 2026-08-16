'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
  ARTIFACT_PARTITIONS,
  MAX_CONTROL_FILE_BYTES,
  MAX_ENTRIES,
  applyWorkspaceTempCandidate,
  collectLeafEntries,
  inspectLegacyWorkspaceTempRoots,
  inspectManifest,
  inspectTarget,
  isContained,
  normalizeTempProject,
  pathComparisonKey
} = require('./workspace-temp.js')
const {
  resolveWorkspaceTempProject,
  resolveWorkspaceTempRoot
} = require('./workspace-temp-layout.js')

const GOVERNANCE_SCHEMA = 'WorkspaceTempGovernanceStatusV2'
const MAINTENANCE_PLAN_SCHEMA = 'WorkspaceTempMaintenancePlanV2'
const MAINTENANCE_RECEIPT_SCHEMA = 'WorkspaceTempMaintenanceReceiptV2'
const DEFAULT_PAGE_SIZE = 100
const DEFAULT_MAX_DELETES = 100
const DEFAULT_MAX_DELETE_BYTES = 512 * 1024 * 1024

function governanceError(code, message = code) {
  const error = new Error(message)
  error.name = 'WorkspaceTempGovernanceError'
  error.code = code
  return error
}

function directoryEntriesBounded(directory, limit) {
  if (!fs.existsSync(directory)) return { entries: [], complete: true, unreadable: false }
  const entries = []
  let handle
  try { handle = fs.opendirSync(directory) } catch {
    return { entries, complete: false, unreadable: true }
  }
  let complete = true
  try {
    let entry
    while ((entry = handle.readSync()) !== null) {
      if (entries.length >= limit) {
        complete = false
        break
      }
      entries.push(entry)
    }
  } catch {
    complete = false
  } finally {
    try { handle.closeSync() } catch { complete = false }
  }
  return { entries, complete, unreadable: false }
}

function projectDigest(project) {
  return crypto.createHash('sha256').update(String(project)).digest('hex')
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function decodeCursor(cursor, scope) {
  if (!cursor) return null
  try {
    const parsed = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'))
    if (parsed?.schemaVersion !== 'WorkspaceTempCursorV1' ||
        parsed.scopeDigest !== scope.scopeDigest ||
        !/^[a-f0-9]{64}$/.test(String(parsed.inventoryDigest || '')) ||
        typeof parsed.after !== 'string') {
      throw new Error('cursor mismatch')
    }
    return parsed
  } catch {
    throw governanceError('WORKSPACE_TEMP_CURSOR_INVALID')
  }
}

function scopeIdentity(project, partition) {
  const normalizedProject = normalizeTempProject(project)
  const normalizedPartition = String(partition)
  if (!ARTIFACT_PARTITIONS.includes(normalizedPartition)) {
    throw governanceError('WORKSPACE_TEMP_PARTITION_INVALID', normalizedPartition)
  }
  return {
    project: normalizedProject,
    partition: normalizedPartition,
    scopeDigest: crypto.createHash('sha256').update(`${normalizedProject}\0${normalizedPartition}`).digest('hex')
  }
}

function scopeManifestDirectory(root, project, partition) {
  return path.join(root, 'manifests', 'v2', projectDigest(project), partition)
}

function inspectV2Scope(root, project, partition, nowMs, options = {}) {
  if (!ARTIFACT_PARTITIONS.includes(partition)) throw governanceError('WORKSPACE_TEMP_PARTITION_INVALID', partition)
  const scope = scopeIdentity(project, partition)
  const maxEntries = Number.isInteger(options.maxEntries)
    ? Math.max(1, Math.min(MAX_ENTRIES, options.maxEntries))
    : MAX_ENTRIES
  const pageSize = Number.isInteger(options.pageSize)
    ? Math.max(1, Math.min(1000, options.pageSize))
    : DEFAULT_PAGE_SIZE
  const cursor = decodeCursor(options.cursor, scope)
  const directory = scopeManifestDirectory(root, project, partition)
  const listing = directoryEntriesBounded(directory, maxEntries + 1)
  const manifestEntries = listing.entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .sort((left, right) => left.name.localeCompare(right.name))
  const records = []
  let targetBudget = maxEntries
  for (const entry of manifestEntries.slice(0, maxEntries)) {
    const record = inspectManifest(root, path.join(directory, entry.name), nowMs, Math.max(1, targetBudget))
    targetBudget = Math.max(0, targetBudget - (record.target?.entries || 0))
    records.push(record)
  }
  const byTarget = new Map()
  for (const record of records) {
    const key = pathComparisonKey(record.targetPath)
    const group = byTarget.get(key) || []
    group.push(record)
    byTarget.set(key, group)
  }
  for (const group of byTarget.values()) {
    if (group.length < 2) continue
    for (const record of group) {
      if (!record.reasons.includes('ownership-overlap')) record.reasons.push('ownership-overlap')
      record.eligible = false
    }
  }
  const inventoryDigest = crypto.createHash('sha256').update(JSON.stringify(records.map(record => ({
    artifactId: record.artifactId,
    manifestDigest: record.manifestDigest,
    targetPath: pathComparisonKey(record.targetPath)
  })))).digest('hex')
  if (cursor && cursor.inventoryDigest !== inventoryDigest) {
    throw governanceError('WORKSPACE_TEMP_CURSOR_STALE')
  }
  const inventoryComplete = listing.complete && listing.entries.length <= maxEntries &&
    records.every(record => !record.target?.truncated)
  const after = cursor?.after || ''
  const pageCandidates = records.filter(record => path.basename(record.manifestPath) > after)
  const page = pageCandidates.slice(0, pageSize)
  const hasMore = pageCandidates.length > page.length
  const nextCursor = hasMore
    ? encodeCursor({
        schemaVersion: 'WorkspaceTempCursorV1',
        scopeDigest: scope.scopeDigest,
        inventoryDigest,
        after: path.basename(page.at(-1).manifestPath)
      })
    : null
  return {
    ...scope,
    schemaVersion: 'WorkspaceTempScopeInventoryV2',
    manifestDirectory: directory,
    inventoryDigest,
    inventoryComplete,
    pageComplete: !hasMore,
    nextCursor,
    records: page,
    allRecords: records,
    candidates: page.filter(record => record.eligible),
    blocked: page.filter(record => !record.eligible),
    totals: {
      registered: records.filter(record => record.category === 'registered').length,
      eligible: records.filter(record => record.eligible).length,
      blocked: records.filter(record => !record.eligible).length,
      files: records.reduce((sum, record) => sum + (record.target?.files || 0), 0),
      bytes: records.reduce((sum, record) => sum + (record.target?.bytes || 0), 0),
      manifestsObserved: manifestEntries.length,
      targetEntriesObserved: maxEntries - targetBudget,
      maxEntries
    }
  }
}

function discoverV2ScopeInventory(root, options = {}) {
  if (options.project && options.partition) {
    return { scopes: [scopeIdentity(options.project, options.partition)], complete: true, errors: [] }
  }
  const v2Root = path.join(root, 'manifests', 'v2')
  const requestedProject = options.project ? normalizeTempProject(options.project) : null
  const requestedPartition = options.partition ? String(options.partition) : null
  if (requestedPartition && !ARTIFACT_PARTITIONS.includes(requestedPartition)) {
    throw governanceError('WORKSPACE_TEMP_PARTITION_INVALID', requestedPartition)
  }
  const projects = requestedProject
    ? {
        entries: [{ name: projectDigest(requestedProject), isDirectory: () => true }],
        complete: true,
        unreadable: false
      }
    : directoryEntriesBounded(v2Root, MAX_ENTRIES)
  const scopes = []
  const errors = []
  let complete = projects.complete && !projects.unreadable
  for (const projectEntry of projects.entries) {
    if (!projectEntry.isDirectory() || !/^[a-f0-9]{64}$/.test(projectEntry.name)) continue
    const projectRoot = path.join(v2Root, projectEntry.name)
    const partitions = directoryEntriesBounded(projectRoot, ARTIFACT_PARTITIONS.length + 1)
    complete = complete && partitions.complete && !partitions.unreadable
    for (const partitionEntry of partitions.entries) {
      if (!partitionEntry.isDirectory() || !ARTIFACT_PARTITIONS.includes(partitionEntry.name)) continue
      if (requestedPartition && partitionEntry.name !== requestedPartition) continue
      const samples = directoryEntriesBounded(path.join(projectRoot, partitionEntry.name), 16)
      complete = complete && samples.complete && !samples.unreadable
      let resolved = false
      for (const sample of samples.entries) {
        if (!sample?.isFile() || !sample.name.endsWith('.json')) continue
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(projectRoot, partitionEntry.name, sample.name), 'utf8'))
          const normalized = normalizeTempProject(raw.project)
          if (projectDigest(normalized) !== projectEntry.name || (requestedProject && normalized !== requestedProject)) continue
          scopes.push(scopeIdentity(normalized, partitionEntry.name))
          resolved = true
          break
        } catch { }
      }
      if (!resolved && samples.entries.length) {
        complete = false
        errors.push({ projectDigest: projectEntry.name, partition: partitionEntry.name, reason: 'scope-project-unresolved' })
      }
    }
  }
  return { scopes, complete, errors }
}

function discoverV2Scopes(root, options = {}) {
  return discoverV2ScopeInventory(root, options).scopes
}

function inspectLegacyManifestCategory(root, nowMs) {
  const manifestRoot = path.join(root, 'manifests')
  const listing = directoryEntriesBounded(manifestRoot, MAX_ENTRIES)
  const records = listing.entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => inspectManifest(root, path.join(manifestRoot, entry.name), nowMs, MAX_ENTRIES))
  return { records, complete: listing.complete, observed: listing.entries.length }
}

function inspectScopeOrphans(root, scope, maxEntries = MAX_ENTRIES) {
  const projectRoot = path.join(root, scope.partition, ...scope.project.split('/'))
  const registeredByArtifactRoot = new Map(scope.allRecords.map(record => [
    pathComparisonKey(path.dirname(record.targetPath)),
    record
  ]))
  const roots = []
  let observed = 0
  let complete = true

  function observeCandidate(candidate, reason) {
    if (observed >= maxEntries) {
      complete = false
      return
    }
    const budget = Math.max(1, maxEntries - observed)
    const summary = inspectTarget(candidate, budget)
    observed += summary.entries
    complete = complete && !summary.truncated && !summary.unreadable
    roots.push({ path: candidate, reason, ...summary })
  }

  const producers = directoryEntriesBounded(projectRoot, Math.max(1, maxEntries - observed))
  observed += producers.entries.length
  complete = complete && producers.complete && !producers.unreadable
  for (const producer of producers.entries) {
    if (observed >= maxEntries) {
      complete = false
      break
    }
    const producerPath = path.join(projectRoot, producer.name)
    if (!producer.isDirectory()) {
      observeCandidate(producerPath, 'orphan-producer-entry')
      continue
    }
    const artifacts = directoryEntriesBounded(producerPath, Math.max(1, maxEntries - observed))
    observed += artifacts.entries.length
    complete = complete && artifacts.complete && !artifacts.unreadable
    for (const artifact of artifacts.entries) {
      if (observed >= maxEntries) {
        complete = false
        break
      }
      const artifactRoot = path.join(producerPath, artifact.name)
      const registered = registeredByArtifactRoot.get(pathComparisonKey(artifactRoot))
      if (!registered || !artifact.isDirectory()) {
        observeCandidate(artifactRoot, registered ? 'orphan-artifact-type' : 'orphan-artifact-root')
        continue
      }
      const children = directoryEntriesBounded(artifactRoot, Math.max(1, maxEntries - observed))
      observed += children.entries.length
      complete = complete && children.complete && !children.unreadable
      for (const child of children.entries) {
        if (observed >= maxEntries) {
          complete = false
          break
        }
        const childPath = path.join(artifactRoot, child.name)
        if (pathComparisonKey(childPath) !== pathComparisonKey(registered.targetPath)) {
          observeCandidate(childPath, 'orphan-artifact-entry')
        }
      }
    }
  }
  if (observed > maxEntries) complete = false
  return {
    roots,
    observedEntries: observed,
    complete,
    totals: {
      roots: roots.length,
      files: roots.reduce((sum, item) => sum + (item.files || 0), 0),
      bytes: roots.reduce((sum, item) => sum + (item.bytes || 0), 0)
    }
  }
}

function markCrossScopeOwnershipOverlaps(scopes) {
  const records = scopes.flatMap(scope => scope.allRecords.map(record => ({ scope, record })))
    .filter(item => item.record.category === 'registered' && item.record.targetPath &&
      !item.record.reasons.some(reason => [
        'path-escape', 'target-relative-identity-mismatch', 'manifest-path-identity-mismatch',
        'project-invalid', 'project-noncanonical', 'partition-mismatch'
      ].includes(reason)))
    .map(item => ({ ...item, targetKey: pathComparisonKey(item.record.targetPath) }))
    .sort((left, right) => left.targetKey.localeCompare(right.targetKey))
  for (let leftIndex = 0; leftIndex < records.length; leftIndex++) {
    const left = records[leftIndex]
    for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex++) {
      const right = records[rightIndex]
      const sameTarget = left.targetKey === right.targetKey
      const descendant = right.targetKey.startsWith(`${left.targetKey}${path.sep}`)
      if (!sameTarget && !descendant) break
      if (left.scope.scopeDigest === right.scope.scopeDigest) continue
      for (const record of [left.record, right.record]) {
        if (!record.reasons.includes('cross-scope-ownership-overlap')) {
          record.reasons.push('cross-scope-ownership-overlap')
        }
        record.eligible = false
      }
    }
  }
  for (const scope of scopes) {
    scope.candidates = scope.records.filter(record => record.eligible)
    scope.blocked = scope.records.filter(record => !record.eligible)
    scope.totals.eligible = scope.allRecords.filter(record => record.eligible).length
    scope.totals.blocked = scope.allRecords.filter(record => !record.eligible).length
  }
}

function inspectUnscopedOrphans(root, scopes, maxEntries = MAX_ENTRIES) {
  const scopeRoots = scopes.map(scope => path.join(root, scope.partition, ...scope.project.split('/')))
  const roots = []
  let observed = 0
  let complete = true
  for (const partition of ARTIFACT_PARTITIONS) {
    const budget = maxEntries - observed
    if (budget <= 0) {
      complete = false
      break
    }
    const partitionRoot = path.join(root, partition)
    const leaves = collectLeafEntries(partitionRoot, budget)
    observed += leaves.visited
    complete = complete && !leaves.truncated
    for (const candidate of leaves.entries) {
      const scoped = scopeRoots.some(scopeRoot =>
        pathComparisonKey(scopeRoot) === pathComparisonKey(candidate) || isContained(scopeRoot, candidate))
      if (scoped) continue
      const summary = inspectTarget(candidate, 1)
      roots.push({ path: candidate, partition, reason: 'orphan-unscoped-entry', ...summary })
    }
  }
  return {
    roots,
    observedEntries: observed,
    complete,
    totals: {
      roots: roots.length,
      files: roots.reduce((sum, item) => sum + (item.files || 0), 0),
      bytes: roots.reduce((sum, item) => sum + (item.bytes || 0), 0)
    }
  }
}

function inspectWorkspaceTempGovernance(cwd, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  const canonicalRoot = resolveWorkspaceTempRoot(cwd)
  const requestedProject = options.project || null
  const requestedPartition = options.partition || null
  const discovery = discoverV2ScopeInventory(canonicalRoot, {
    project: requestedProject,
    partition: requestedPartition
  })
  const scopes = discovery.scopes.map(scope => inspectV2Scope(canonicalRoot, scope.project, scope.partition, nowMs, options))
  markCrossScopeOwnershipOverlaps(scopes)
  for (const scope of scopes) {
    scope.orphans = inspectScopeOrphans(canonicalRoot, scope, options.maxEntries || MAX_ENTRIES)
  }
  const unscopedOrphans = inspectUnscopedOrphans(canonicalRoot, scopes, options.maxEntries || MAX_ENTRIES)
  const legacyManifests = inspectLegacyManifestCategory(canonicalRoot, nowMs)
  const legacySummary = inspectLegacyWorkspaceTempRoots(cwd, options.maxEntries || MAX_ENTRIES)
  const legacyRoots = legacySummary.roots
  const externalRoots = legacySummary.externalRoots
  const orphan = scopes.reduce((sum, scope) => sum + scope.orphans.totals.roots, 0) + unscopedOrphans.totals.roots
  const orphanComplete = scopes.every(scope => scope.orphans.complete) && unscopedOrphans.complete
  const registeredFiles = scopes.reduce((sum, scope) => sum + scope.totals.files, 0)
  const registeredBytes = scopes.reduce((sum, scope) => sum + scope.totals.bytes, 0)
  const orphanFiles = scopes.reduce((sum, scope) => sum + scope.orphans.totals.files, 0) + unscopedOrphans.totals.files
  const orphanBytes = scopes.reduce((sum, scope) => sum + scope.orphans.totals.bytes, 0) + unscopedOrphans.totals.bytes
  const legacyFiles = legacyManifests.records.reduce((sum, record) => sum + (record.target?.files || 0), 0) +
    legacyRoots.reduce((sum, item) => sum + (item.files || 0), 0)
  const legacyBytes = legacyManifests.records.reduce((sum, record) => sum + (record.target?.bytes || 0), 0) +
    legacyRoots.reduce((sum, item) => sum + (item.bytes || 0), 0)
  const totals = {
    registered: scopes.reduce((sum, scope) => sum + scope.totals.registered, 0),
    orphan,
    legacy: legacyManifests.records.length + legacyRoots.length,
    eligible: scopes.reduce((sum, scope) => sum + scope.totals.eligible, 0),
    blocked: scopes.reduce((sum, scope) => sum + scope.totals.blocked, 0) + legacyManifests.records.length,
    files: registeredFiles + orphanFiles + legacyFiles,
    bytes: registeredBytes + orphanBytes + legacyBytes,
    categories: {
      registered: { files: registeredFiles, bytes: registeredBytes },
      orphan: { files: orphanFiles, bytes: orphanBytes },
      legacy: { files: legacyFiles, bytes: legacyBytes }
    }
  }
  return {
    schemaVersion: GOVERNANCE_SCHEMA,
    cwd: path.resolve(cwd),
    canonicalRoot,
    project: requestedProject || resolveWorkspaceTempProject(cwd),
    scopes,
    scopeDiscovery: discovery,
    unscopedOrphans,
    legacyManifests: legacyManifests.records,
    legacyRoots,
    externalRoots,
    totals,
    completeness: {
      registered: discovery.complete && scopes.every(scope => scope.inventoryComplete),
      orphan: orphanComplete,
      legacy: legacyManifests.complete && !legacySummary.truncated && legacySummary.errors.length === 0 &&
        !legacyRoots.some(item => item.truncated),
      all: discovery.complete && scopes.every(scope => scope.inventoryComplete) && orphanComplete &&
        legacyManifests.complete && !legacySummary.truncated && legacySummary.errors.length === 0 &&
        !legacyRoots.some(item => item.truncated)
    }
  }
}

function buildWorkspaceTempMaintenancePlan(cwd, options = {}) {
  const status = inspectWorkspaceTempGovernance(cwd, options)
  const maxDeletes = Number.isInteger(options.maxDeletes) ? Math.max(0, options.maxDeletes) : DEFAULT_MAX_DELETES
  const maxDeleteBytes = Number.isFinite(options.maxDeleteBytes) && options.maxDeleteBytes >= 0
    ? options.maxDeleteBytes
    : DEFAULT_MAX_DELETE_BYTES
  const selected = []
  let selectedBytes = 0
  for (const scope of status.scopes) {
    for (const candidate of scope.allRecords.filter(record => record.eligible)
      .sort((left, right) => String(left.expiresAt).localeCompare(String(right.expiresAt)))) {
      const bytes = candidate.target?.bytes || 0
      if (selected.length >= maxDeletes || selectedBytes + bytes > maxDeleteBytes) break
      selected.push({ ...candidate, scopeDigest: scope.scopeDigest, project: scope.project, partition: scope.partition })
      selectedBytes += bytes
    }
  }
  return {
    schemaVersion: MAINTENANCE_PLAN_SCHEMA,
    planId: `temp-plan-${crypto.createHash('sha256').update(JSON.stringify({
      canonicalRoot: status.canonicalRoot,
      requestedScope: { project: options.project || null, partition: options.partition || null },
      quota: { maxDeletes, maxDeleteBytes },
      selected: selected.map(item => ({
        artifactId: item.artifactId,
        manifestDigest: item.manifestDigest,
        scopeDigest: item.scopeDigest
      }))
    })).digest('hex')}`,
    mode: 'plan-only',
    canonicalRoot: status.canonicalRoot,
    requestedScope: { project: options.project || null, partition: options.partition || null },
    status,
    selected,
    quota: { maxDeletes, maxDeleteBytes, selectedDeletes: selected.length, selectedBytes },
    applyAllowed: Boolean(
      options.project &&
      options.partition &&
      !options.cursor &&
      status.scopes.length === 1 &&
      status.scopes[0].inventoryComplete &&
      status.scopes[0].orphans.complete &&
      status.completeness.legacy
    )
  }
}

function writeMaintenanceReceipt(root, receipt) {
  const controlRoot = path.join(root, 'manifests', 'maintenance')
  fs.mkdirSync(controlRoot, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') fs.chmodSync(controlRoot, 0o700)
  const file = path.join(controlRoot, `${receipt.runId}.json`)
  const content = `${JSON.stringify(receipt, null, 2)}\n`
  if (Buffer.byteLength(content) > MAX_CONTROL_FILE_BYTES) throw governanceError('WORKSPACE_TEMP_MAINTENANCE_RECEIPT_TOO_LARGE')
  fs.writeFileSync(file, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  if (process.platform !== 'win32') fs.chmodSync(file, 0o600)
  const permission = process.platform === 'win32'
    ? { platform: 'win32', status: 'UNVERIFIED', evidence: 'DACL was not probed' }
    : {
        platform: process.platform,
        mode: fs.statSync(file).mode & 0o777,
        expectedMode: 0o600,
        status: (fs.statSync(file).mode & 0o777) === 0o600 ? 'PASS' : 'WARN'
      }
  return { file, permission }
}

function maintainWorkspaceTemp(cwd, options = {}) {
  const plan = buildWorkspaceTempMaintenancePlan(cwd, options)
  const apply = options.apply === true
  if (apply && !plan.applyAllowed) throw governanceError('WORKSPACE_TEMP_EXPLICIT_COMPLETE_SCOPE_REQUIRED')
  const removed = []
  const failed = []
  if (apply) {
    for (const candidate of plan.selected) {
      try { removed.push(applyWorkspaceTempCandidate(plan.canonicalRoot, candidate, options.nowMs || Date.now())) } catch (error) {
        failed.push({ artifactId: candidate.artifactId, errorCode: error.code || 'WORKSPACE_TEMP_MAINTENANCE_FAILED', message: error.message })
      }
    }
  }
  const receipt = {
    schemaVersion: MAINTENANCE_RECEIPT_SCHEMA,
    runId: `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`,
    planId: plan.planId,
    mode: apply ? 'apply' : 'plan-only',
    scope: plan.requestedScope,
    selected: plan.selected.map(item => ({ artifactId: item.artifactId, manifestDigest: item.manifestDigest })),
    removed,
    failed,
    watermark: {
      observedAt: new Date(options.nowMs || Date.now()).toISOString(),
      scopeCompleteness: plan.status.scopes.map(scope => ({ scopeDigest: scope.scopeDigest, complete: scope.inventoryComplete }))
    }
  }
  const receiptWrite = writeMaintenanceReceipt(plan.canonicalRoot, receipt)
  receipt.receiptPath = receiptWrite.file
  receipt.permission = receiptWrite.permission
  return { plan, receipt }
}

function runWorkspaceTempMaintenanceScheduler(cwd, options = {}) {
  return maintainWorkspaceTemp(cwd, { ...options, apply: false })
}

module.exports = {
  DEFAULT_MAX_DELETE_BYTES,
  DEFAULT_MAX_DELETES,
  DEFAULT_PAGE_SIZE,
  GOVERNANCE_SCHEMA,
  MAINTENANCE_PLAN_SCHEMA,
  MAINTENANCE_RECEIPT_SCHEMA,
  buildWorkspaceTempMaintenancePlan,
  decodeCursor,
  discoverV2Scopes,
  encodeCursor,
  inspectV2Scope,
  inspectWorkspaceTempGovernance,
  inspectScopeOrphans,
  inspectUnscopedOrphans,
  markCrossScopeOwnershipOverlaps,
  maintainWorkspaceTemp,
  runWorkspaceTempMaintenanceScheduler,
  discoverV2ScopeInventory,
  scopeIdentity,
  scopeManifestDirectory
}
