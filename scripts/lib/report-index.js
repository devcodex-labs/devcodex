'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
  buildContentIdentity,
  stableStringify
} = require('../../hooks/_runtime/content-identity.cjs')
const {
  buildQueryEnvelope,
  createDerivedIndexStore
} = require('./derived-index-contract.js')

const REPORT_CLASSIFICATIONS = Object.freeze([
  'primary-report',
  'evidence',
  'artifact',
  'generated-copy',
  'unknown'
])
const REPORT_CATALOG_SCHEMA = 'ReportCatalogPartitionV1'
const REPORT_ENTRY_SCHEMA = 'ReportEntryPartitionV1'
const REPORT_ORDERED_SCHEMA = 'ReportOrderedEntryPartitionV1'
const REPORT_SNAPSHOT_CURSOR_SCHEMA = 'ReportSnapshotCursorV1'
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const MAX_HYDRATE_BYTES = 256 * 1024
const ORDERED_CHUNK_SIZE = 200
const REPORT_PROJECTIONS = new Set(['full', 'compact'])

function normalizeRoot(activeRoot) {
  const value = String(activeRoot || '').trim()
  if (!value) throw new Error('report index activeRoot is required')
  return path.resolve(value)
}

function normalizedRelative(activeRoot, filePath) {
  const relative = path.relative(activeRoot, path.resolve(filePath))
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`report path escapes activeRoot: ${filePath}`)
  }
  return relative.replace(/\\/g, '/')
}

function isInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function resolveReportRoots(activeRoot) {
  const root = normalizeRoot(activeRoot)
  const roots = []
  const projectReports = path.join(root, 'reports')
  if (fs.existsSync(projectReports) && fs.lstatSync(projectReports).isDirectory()) {
    roots.push({ path: projectReports, scope: 'project', taskKind: null, task: null })
  }
  for (const taskKind of ['requirements', 'bugs', 'optimizations', 'scenario-tests']) {
    const categoryRoot = path.join(root, taskKind)
    if (!fs.existsSync(categoryRoot) || !fs.lstatSync(categoryRoot).isDirectory()) continue
    for (const entry of fs.readdirSync(categoryRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      const reportsRoot = path.join(categoryRoot, entry.name, 'reports')
      if (fs.existsSync(reportsRoot) && fs.lstatSync(reportsRoot).isDirectory()) {
        roots.push({
          path: reportsRoot,
          scope: 'task',
          taskKind,
          task: entry.name
        })
      }
    }
  }
  return roots.sort((left, right) => left.path.localeCompare(right.path))
}

function classifyReportPath(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/').toLowerCase()
  const segments = normalized.split('/')
  const extension = path.extname(normalized)
  if (segments.some(segment => ['generated', 'coverage', 'build', 'dist', 'deploy', 'deployed', 'copies', 'package-copy', 'smoke', 'smoke-package', 'node_modules'].includes(segment))) {
    return 'generated-copy'
  }
  if (segments.some(segment => ['evidence', 'evidences'].includes(segment))) return 'evidence'
  if (segments.some(segment => ['artifact', 'artifacts'].includes(segment))) return 'artifact'
  if (extension === '.md') return 'primary-report'
  if (['.json', '.jsonl', '.txt', '.log', '.xml', '.html', '.png', '.jpg', '.jpeg', '.gif', '.zip', '.tgz', '.gz', '.js', '.cjs', '.mjs', '.ps1', '.sh', '.http'].includes(extension)) {
    return 'artifact'
  }
  return 'unknown'
}

function reportDate(relativePath, modifiedAt) {
  const match = String(relativePath).match(/(?:^|\/)(20\d{2})(\d{2})(\d{2})(?:\/|$)/)
  if (match) return `${match[1]}-${match[2]}-${match[3]}`
  return String(modifiedAt || '').slice(0, 10)
}

function filenameTitle(filePath) {
  return path.basename(filePath, path.extname(filePath))
    .replace(/^\d+--/, '')
    .replace(/[-_]+/g, ' ')
    .trim()
}

function readBoundedTitle(filePath, maxBytes = 8192) {
  const descriptor = fs.openSync(filePath, 'r')
  try {
    const buffer = Buffer.alloc(maxBytes)
    const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, 0)
    const content = buffer.subarray(0, bytesRead).toString('utf8')
    const heading = content.match(/^#\s+(.+)$/m)
    return { title: heading ? heading[1].trim().slice(0, 240) : filenameTitle(filePath), bytesRead }
  } finally {
    fs.closeSync(descriptor)
  }
}

function entryId(relativePath) {
  return crypto.createHash('sha256').update(relativePath).digest('hex').slice(0, 24)
}

function stableDigest(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex')
}

function sortReportEntries(entries) {
  return entries.slice().sort((left, right) =>
    right.date.localeCompare(left.date) ||
    right.modifiedAt.localeCompare(left.modifiedAt) ||
    left.path.localeCompare(right.path))
}

function scanReportCatalog(activeRoot, options = {}) {
  const root = normalizeRoot(activeRoot)
  const roots = resolveReportRoots(root)
  const entries = []
  const warnings = []
  let warningCount = 0
  let sourceBytesRead = 0

  function warn(code, filePath) {
    warningCount += 1
    if (warnings.length < 100) warnings.push({ code, path: normalizedRelative(root, filePath) })
  }

  function visit(reportRoot, current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isSymbolicLink()) {
        warn('REPORT_SYMLINK_SKIPPED', full)
        continue
      }
      if (entry.isDirectory()) {
        visit(reportRoot, full)
        continue
      }
      if (!entry.isFile()) continue
      const relativePath = normalizedRelative(root, full)
      const stat = fs.statSync(full)
      const classification = classifyReportPath(relativePath)
      const titleResult = options.readHeaders === true && path.extname(full).toLowerCase() === '.md'
        ? readBoundedTitle(full)
        : { title: filenameTitle(full), bytesRead: 0 }
      sourceBytesRead += titleResult.bytesRead
      if (classification === 'unknown') warn('REPORT_CLASSIFICATION_UNKNOWN', full)
      const date = reportDate(relativePath, stat.mtime.toISOString())
      entries.push({
        schemaVersion: 'ReportCatalogEntryV1',
        id: entryId(relativePath),
        path: relativePath,
        pointer: { path: relativePath },
        scope: reportRoot.scope,
        taskKind: reportRoot.taskKind,
        task: reportRoot.task,
        classification,
        title: titleResult.title,
        date,
        month: date.slice(0, 7),
        bytes: stat.size,
        modifiedAt: stat.mtime.toISOString()
      })
    }
  }

  for (const reportRoot of roots) {
    const stat = fs.lstatSync(reportRoot.path)
    if (stat.isSymbolicLink()) {
      warn('REPORT_ROOT_SYMLINK_SKIPPED', reportRoot.path)
      continue
    }
    visit(reportRoot, reportRoot.path)
  }
  entries.sort((left, right) => left.path.localeCompare(right.path))
  return {
    schemaVersion: 'ReportCatalogScanV1',
    activeRoot: root,
    roots: roots.map(item => ({
      path: normalizedRelative(root, item.path),
      scope: item.scope,
      taskKind: item.taskKind,
      task: item.task
    })),
    entries,
    warnings,
    warningCount,
    sourceBytesRead,
    sourceCorpusBytes: entries.reduce((total, item) => total + item.bytes, 0)
  }
}

function catalogSourceIdentity(scan) {
  return buildContentIdentity({
    sourceKey: `report://${path.basename(scan.activeRoot)}/catalog-metadata`,
    content: stableStringify(scan.entries.map(entry => ({
      path: entry.path,
      scope: entry.scope,
      taskKind: entry.taskKind,
      task: entry.task,
      classification: entry.classification,
      date: entry.date,
      bytes: entry.bytes,
      modifiedAt: entry.modifiedAt
    }))),
    contractVersion: '1'
  })
}

function reportStore(activeRoot) {
  const root = normalizeRoot(activeRoot)
  return createDerivedIndexStore({
    activeRoot: root,
    domain: 'report',
    scopeIdentity: {
      project: path.basename(root),
      scope: 'catalog'
    }
  })
}

function buildReportPartitions(scan) {
  const classCounts = Object.fromEntries(REPORT_CLASSIFICATIONS.map(classification => [
    classification,
    scan.entries.filter(entry => entry.classification === classification).length
  ]))
  const partitions = [{
    key: 'catalog',
    metadata: { entryCount: scan.entries.length },
    payload: {
      schemaVersion: REPORT_CATALOG_SCHEMA,
      roots: scan.roots,
      entryCount: scan.entries.length,
      classCounts,
      warningCount: scan.warningCount,
      warnings: scan.warnings
    }
  }]
  const groups = new Map()
  for (const entry of scan.entries) {
    const scopeKey = entry.scope === 'task'
      ? `task-${entryId(`${entry.taskKind}/${entry.task}`)}`
      : 'project'
    const key = `${scopeKey}:${entry.month}:${entry.classification}`
    if (!groups.has(key)) {
      groups.set(key, {
        scope: entry.scope,
        taskKind: entry.taskKind,
        task: entry.task,
        month: entry.month,
        classification: entry.classification,
        entries: []
      })
    }
    groups.get(key).entries.push(entry)
  }
  for (const [key, group] of Array.from(groups).sort(([left], [right]) => left.localeCompare(right))) {
    partitions.push({
      key: `entries:${key}`,
      metadata: {
        scope: group.scope,
        taskKind: group.taskKind,
        task: group.task,
        month: group.month,
        classification: group.classification,
        entryCount: group.entries.length
      },
      payload: {
        schemaVersion: REPORT_ENTRY_SCHEMA,
        scope: group.scope,
        taskKind: group.taskKind,
        task: group.task,
        month: group.month,
        classification: group.classification,
        entries: group.entries
      }
    })
  }
  for (const classification of REPORT_CLASSIFICATIONS) {
    const entries = sortReportEntries(scan.entries.filter(entry => entry.classification === classification))
    for (let index = 0; index < entries.length; index += ORDERED_CHUNK_SIZE) {
      const chunk = entries.slice(index, index + ORDERED_CHUNK_SIZE)
      const chunkIndex = String(index / ORDERED_CHUNK_SIZE).padStart(6, '0')
      partitions.push({
        key: `ordered:${classification}:${chunkIndex}`,
        metadata: {
          classification,
          chunkIndex: index / ORDERED_CHUNK_SIZE,
          entryCount: chunk.length,
          startDate: chunk[0]?.date || null,
          endDate: chunk[chunk.length - 1]?.date || null,
          firstSortKey: chunk[0]
            ? [chunk[0].date, chunk[0].modifiedAt, chunk[0].path]
            : null,
          lastSortKey: chunk[chunk.length - 1]
            ? [chunk[chunk.length - 1].date, chunk[chunk.length - 1].modifiedAt, chunk[chunk.length - 1].path]
            : null
        },
        payload: {
          schemaVersion: REPORT_ORDERED_SCHEMA,
          classification,
          chunkIndex: index / ORDERED_CHUNK_SIZE,
          entries: chunk
        }
      })
    }
  }
  return partitions
}

function rebuildReportIndex(activeRoot, options = {}) {
  const scan = scanReportCatalog(activeRoot, { readHeaders: options.readHeaders !== false })
  const sourceIdentity = catalogSourceIdentity(scan)
  const commit = reportStore(activeRoot).commit({
    sourceIdentity,
    freshnessTier: 'metadata-reconciled',
    partitions: buildReportPartitions(scan)
  })
  return {
    schemaVersion: 'ReportIndexRebuildReceiptV1',
    status: commit.status,
    generation: commit.generation || null,
    entryCount: scan.entries.length,
    classCounts: Object.fromEntries(REPORT_CLASSIFICATIONS.map(classification => [
      classification,
      scan.entries.filter(entry => entry.classification === classification).length
    ])),
    sourceCorpusBytes: scan.sourceCorpusBytes,
    sourceBytesRead: scan.sourceBytesRead,
    sourceIdentity,
    commit
  }
}

function normalizeQuery(query = {}) {
  const classifications = query.classifications === undefined
    ? ['primary-report']
    : Array.from(new Set(query.classifications.map(String)))
  if (!classifications.length || classifications.some(item => !REPORT_CLASSIFICATIONS.includes(item))) {
    throw new Error('report classifications must contain supported values')
  }
  const limit = query.limit === undefined ? DEFAULT_LIMIT : Number(query.limit)
  const offset = query.offset === undefined ? 0 : Number(query.offset)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new Error(`report limit must be 1-${MAX_LIMIT}`)
  if (!Number.isInteger(offset) || offset < 0) throw new Error('report offset must be a non-negative integer')
  return {
    classifications,
    taskKind: query.taskKind ? String(query.taskKind) : null,
    task: query.task ? String(query.task) : null,
    dateFrom: query.dateFrom ? String(query.dateFrom) : null,
    dateTo: query.dateTo ? String(query.dateTo) : null,
    text: query.text ? String(query.text).toLowerCase() : null,
    limit,
    offset,
    hydrate: query.hydrate === true,
    maxHydrateBytes: query.maxHydrateBytes === undefined
      ? 64 * 1024
      : Math.min(MAX_HYDRATE_BYTES, Number(query.maxHydrateBytes)),
    projection: query.projection === undefined ? 'full' : String(query.projection),
    snapshotCursor: query.snapshotCursor || null
  }
}

function filterEntries(entries, query) {
  return sortReportEntries(entries
    .filter(entry => query.classifications.includes(entry.classification))
    .filter(entry => !query.taskKind || entry.taskKind === query.taskKind)
    .filter(entry => !query.task || entry.task === query.task)
    .filter(entry => !query.dateFrom || entry.date >= query.dateFrom)
    .filter(entry => !query.dateTo || entry.date <= query.dateTo)
    .filter(entry => !query.text || `${entry.title}\n${entry.path}`.toLowerCase().includes(query.text)))
}

function validateProjection(projection) {
  if (!REPORT_PROJECTIONS.has(projection)) throw new Error('report projection must be full or compact')
  return projection
}

function projectReportEntry(entry, projection) {
  if (projection === 'full') return entry
  const compact = {
    id: entry.id,
    path: entry.path,
    taskKind: entry.taskKind,
    task: entry.task,
    classification: entry.classification,
    title: entry.title,
    date: entry.date,
    bytes: entry.bytes
  }
  if (entry.hydration) compact.hydration = entry.hydration
  return compact
}

function reportQueryDigest(query) {
  return stableDigest({
    classifications: query.classifications,
    taskKind: query.taskKind,
    task: query.task,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    text: query.text,
    projection: query.projection
  })
}

function cursorCore(cursor) {
  return Object.fromEntries(Object.entries(cursor || {}).filter(([key]) => key !== 'cursorDigest'))
}

function decodeSnapshotCursor(value) {
  if (!value) return null
  if (typeof value === 'string') {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
  }
  if (typeof value === 'object' && !Array.isArray(value)) return value
  throw new Error('report snapshotCursor must be an object or base64url string')
}

function encodeSnapshotCursor(cursor) {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

function validateSnapshotCursor(value, query) {
  const cursor = decodeSnapshotCursor(value)
  if (!cursor) return null
  if (cursor.schemaVersion !== REPORT_SNAPSHOT_CURSOR_SCHEMA) {
    throw new Error('report snapshotCursor schemaVersion is invalid')
  }
  if (cursor.cursorDigest !== stableDigest(cursorCore(cursor))) {
    throw new Error('report snapshotCursor digest mismatch')
  }
  if (cursor.queryDigest !== reportQueryDigest(query)) {
    throw new Error('report snapshotCursor query mismatch')
  }
  if (cursor.pageSize !== query.limit) {
    throw new Error('report snapshotCursor pageSize mismatch')
  }
  if (!cursor.position || cursor.position.offset !== query.offset) {
    throw new Error('report snapshotCursor offset mismatch')
  }
  if (!Array.isArray(cursor.segments)) {
    throw new Error('report snapshotCursor segments are invalid')
  }
  return cursor
}

function createSnapshotCursor(input) {
  const core = {
    schemaVersion: REPORT_SNAPSHOT_CURSOR_SCHEMA,
    manifestIdentity: input.manifestIdentity,
    sourceIdentity: input.sourceIdentity,
    queryDigest: input.queryDigest,
    position: { offset: input.offset },
    pageSize: input.pageSize,
    projection: input.projection,
    segments: input.segments,
    totalMatched: input.totalMatched
  }
  return { ...core, cursorDigest: stableDigest(core) }
}

function orderedDescriptorOverlaps(descriptor, query) {
  const metadata = descriptor.metadata || {}
  if (query.dateFrom && metadata.startDate && metadata.startDate < query.dateFrom) return false
  if (query.dateTo && metadata.endDate && metadata.endDate > query.dateTo) return false
  return true
}

function canUseOrderedRoute(query) {
  return !query.taskKind &&
    !query.task &&
    !query.text &&
    query.classifications.length === 1
}

function selectEntryPartitionDescriptors(manifest, query) {
  return manifest.partitions.filter(descriptor =>
    descriptor.key.startsWith('entries:') &&
    query.classifications.includes(descriptor.metadata?.classification) &&
    (!query.taskKind || descriptor.metadata?.taskKind === query.taskKind) &&
    (!query.task || descriptor.metadata?.task === query.task) &&
    (!query.dateFrom || descriptor.metadata?.month >= query.dateFrom.slice(0, 7)) &&
    (!query.dateTo || descriptor.metadata?.month <= query.dateTo.slice(0, 7)))
}

function selectOrderedDescriptors(manifest, query) {
  return manifest.partitions
    .filter(descriptor =>
      descriptor.key.startsWith('ordered:') &&
      query.classifications.includes(descriptor.metadata?.classification) &&
      orderedDescriptorOverlaps(descriptor, query))
    .sort((left, right) =>
      String(left.metadata?.classification || '').localeCompare(String(right.metadata?.classification || '')) ||
      Number(left.metadata?.chunkIndex || 0) - Number(right.metadata?.chunkIndex || 0))
}

function compactSegmentPlan(segments) {
  return segments.map(segment => ({
    key: segment.key,
    count: segment.count,
    classification: segment.classification
  }))
}

function segmentSliceForOffset(segments, offset, limit) {
  const needed = []
  let remainingOffset = offset
  let remainingLimit = limit
  for (const segment of segments) {
    if (remainingOffset >= segment.count) {
      remainingOffset -= segment.count
      continue
    }
    if (remainingLimit <= 0) break
    const take = Math.min(segment.count - remainingOffset, remainingLimit)
    needed.push({
      key: segment.key,
      start: remainingOffset,
      take
    })
    remainingLimit -= take
    remainingOffset = 0
  }
  return needed
}

function manifestEntryCount(manifest) {
  return manifest.partitions.find(descriptor => descriptor.key === 'catalog')?.metadata?.entryCount || 0
}

function assertAllowlistedPointer(activeRoot, relativePath) {
  const root = normalizeRoot(activeRoot)
  const absolute = path.resolve(root, relativePath)
  normalizedRelative(root, absolute)
  const allowed = resolveReportRoots(root).some(item => isInside(item.path, absolute))
  if (!allowed) throw new Error(`report pointer is outside allowlisted report roots: ${relativePath}`)
  const stat = fs.lstatSync(absolute)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`report pointer must identify a regular non-symlink file: ${relativePath}`)
  const realRoot = fs.realpathSync(root)
  const realFile = fs.realpathSync(absolute)
  if (!isInside(realRoot, realFile)) throw new Error(`report pointer resolves outside activeRoot: ${relativePath}`)
  return absolute
}

function createReportHydrationContext(activeRoot) {
  const root = normalizeRoot(activeRoot)
  return {
    root,
    realRoot: fs.realpathSync(root),
    allowedRoots: resolveReportRoots(root).map(item => ({
      ...item,
      realPath: fs.realpathSync(item.path)
    }))
  }
}

function assertAllowlistedPointerWithContext(context, relativePath) {
  const absolute = path.resolve(context.root, relativePath)
  normalizedRelative(context.root, absolute)
  const allowed = context.allowedRoots.some(item => isInside(item.path, absolute))
  if (!allowed) throw new Error(`report pointer is outside allowlisted report roots: ${relativePath}`)
  const stat = fs.lstatSync(absolute)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`report pointer must identify a regular non-symlink file: ${relativePath}`)
  const realFile = fs.realpathSync(absolute)
  if (!isInside(context.realRoot, realFile)) throw new Error(`report pointer resolves outside activeRoot: ${relativePath}`)
  return absolute
}

function hydrateReportEntry(activeRoot, entry, options = {}) {
  const context = options.context || createReportHydrationContext(activeRoot)
  return hydrateReportEntryWithContext(context, entry, options)
}

function hydrateReportEntryWithContext(context, entry, options = {}) {
  const maxBytes = options.maxBytes === undefined ? 64 * 1024 : Number(options.maxBytes)
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_HYDRATE_BYTES) {
    throw new Error(`report hydration maxBytes must be 1-${MAX_HYDRATE_BYTES}`)
  }
  const filePath = assertAllowlistedPointerWithContext(context, entry?.pointer?.path || entry?.path)
  const stat = fs.statSync(filePath)
  const descriptor = fs.openSync(filePath, 'r')
  try {
    const buffer = Buffer.alloc(Math.min(maxBytes, stat.size))
    const bytesRead = buffer.length ? fs.readSync(descriptor, buffer, 0, buffer.length, 0) : 0
    const content = buffer.subarray(0, bytesRead).toString('utf8')
    const truncated = stat.size > bytesRead
    return {
      schemaVersion: 'ReportHydrationV1',
      status: 'fresh',
      path: normalizedRelative(context.root, filePath),
      freshnessTier: truncated ? 'metadata-reconciled' : 'content-verified',
      content,
      bytesRead,
      totalBytes: stat.size,
      truncated,
      contentIdentity: buildContentIdentity({
        sourceKey: `report-hydration://${normalizedRelative(context.root, filePath)}`,
        content,
        contractVersion: truncated ? '1-partial' : '1'
      })
    }
  } finally {
    fs.closeSync(descriptor)
  }
}

function hydrateReportEntries(activeRoot, entries, options = {}) {
  const context = createReportHydrationContext(activeRoot)
  let bytesRead = 0
  const hydrated = entries.map(entry => {
    const hydration = hydrateReportEntryWithContext(context, entry, {
      ...options,
      context
    })
    bytesRead += hydration.bytesRead
    return { ...entry, hydration }
  })
  return { entries: hydrated, bytesRead }
}

function readReportPartition(store, descriptor, current, expectedSchema) {
  const partition = store.readPartition(descriptor.key, { current })
  const indexBytes = Math.max(0, (partition.bytesRead || 0) - (current.bytesRead || 0))
  if (partition.status !== 'fresh' || partition.payload?.schemaVersion !== expectedSchema) {
    return {
      status: 'invalid',
      partition,
      indexBytes
    }
  }
  return {
    status: 'fresh',
    partition,
    indexBytes,
    entries: partition.payload.entries || []
  }
}

function collectEntriesFromPartitions(store, descriptors, current, query) {
  const candidates = []
  let filesRead = 0
  let indexBytesRead = 0
  for (const descriptor of descriptors) {
    const result = readReportPartition(store, descriptor, current, REPORT_ENTRY_SCHEMA)
    filesRead += 1
    indexBytesRead += result.indexBytes
    if (result.status !== 'fresh') {
      return {
        status: 'invalid',
        receipt: result.partition,
        freshnessTier: result.partition.freshnessTier || 'invalid',
        filesRead,
        indexBytesRead
      }
    }
    candidates.push(...result.entries)
  }
  return {
    status: 'fresh',
    entries: filterEntries(candidates, query),
    filesRead,
    indexBytesRead
  }
}

function buildOrderedPageFromDescriptors(store, descriptors, current, query) {
  const segments = []
  let filesRead = 0
  let indexBytesRead = 0
  for (const descriptor of descriptors) {
    const result = readReportPartition(store, descriptor, current, REPORT_ORDERED_SCHEMA)
    filesRead += 1
    indexBytesRead += result.indexBytes
    if (result.status !== 'fresh') {
      return {
        status: 'invalid',
        receipt: result.partition,
        freshnessTier: result.partition.freshnessTier || 'invalid',
        filesRead,
        indexBytesRead
      }
    }
    const entries = filterEntries(result.entries, query)
    if (entries.length) {
      segments.push({
        key: descriptor.key,
        classification: descriptor.metadata?.classification || null,
        count: entries.length,
        entries
      })
    }
  }
  const totalMatched = segments.reduce((total, segment) => total + segment.count, 0)
  const page = []
  for (const slice of segmentSliceForOffset(segments, query.offset, query.limit)) {
    const segment = segments.find(item => item.key === slice.key)
    page.push(...segment.entries.slice(slice.start, slice.start + slice.take))
  }
  return {
    status: 'fresh',
    route: 'ordered-snapshot',
    entries: page,
    totalMatched,
    segments: compactSegmentPlan(segments),
    filesRead,
    indexBytesRead
  }
}

function buildOrderedPageFromCursor(store, current, query, cursor) {
  const totalMatched = cursor.totalMatched
  const page = []
  let filesRead = 0
  let indexBytesRead = 0
  const segmentMap = new Map(cursor.segments.map(segment => [segment.key, segment]))
  for (const slice of segmentSliceForOffset(cursor.segments, query.offset, query.limit)) {
    const descriptor = current.manifest.partitions.find(item => item.key === slice.key)
    if (!descriptor || !segmentMap.has(slice.key)) {
      return {
        status: 'invalid',
        receipt: { status: 'invalid', errorCode: 'REPORT_CURSOR_SEGMENT_MISSING' },
        freshnessTier: 'invalid',
        filesRead,
        indexBytesRead
      }
    }
    const result = readReportPartition(store, descriptor, current, REPORT_ORDERED_SCHEMA)
    filesRead += 1
    indexBytesRead += result.indexBytes
    if (result.status !== 'fresh') {
      return {
        status: 'invalid',
        receipt: result.partition,
        freshnessTier: result.partition.freshnessTier || 'invalid',
        filesRead,
        indexBytesRead
      }
    }
    const entries = filterEntries(result.entries, query)
    page.push(...entries.slice(slice.start, slice.start + slice.take))
  }
  return {
    status: 'fresh',
    route: 'snapshot-cursor',
    entries: page,
    totalMatched,
    segments: cursor.segments,
    filesRead,
    indexBytesRead
  }
}

function queryReportIndex(activeRoot, input = {}) {
  const root = normalizeRoot(activeRoot)
  const query = normalizeQuery(input)
  validateProjection(query.projection)
  const store = reportStore(root)
  const cursor = validateSnapshotCursor(query.snapshotCursor, query)
  let scan = null
  let sourceIdentity = null
  let current
  if (cursor) {
    const manifestReceipt = store.readManifest(cursor.manifestIdentity)
    if (manifestReceipt.status !== 'fresh') {
      const envelope = buildQueryEnvelope({
        status: 'invalid',
        freshnessTier: 'invalid',
        coverage: {
          status: 'invalid',
          route: 'snapshot-cursor',
          errorCode: 'REPORT_CURSOR_MANIFEST_UNAVAILABLE'
        },
        items: [],
        truncated: false,
        nextPointer: null,
        evidencePointers: [],
        hydrated: query.hydrate,
        telemetry: {
          sourceBytes: 0,
          representedSourceBytes: 0,
          deliveredBytes: 2,
          indexBytesRead: manifestReceipt.bytes || 0,
          filesRead: manifestReceipt.status === 'missing' ? 0 : 1,
          metadataEntriesStat: 0,
          tokens: null
        },
        receipt: {
          status: manifestReceipt.status,
          freshnessTier: 'invalid',
          manifestIdentity: cursor.manifestIdentity,
          errorCode: manifestReceipt.errorCode || 'REPORT_CURSOR_MANIFEST_UNAVAILABLE'
        }
      })
      return {
        ...envelope,
        domain: 'report',
        scope: { activeRoot: root },
        query,
        warnings: [],
        warningCount: 0,
        totalMatched: 0
      }
    }
    current = {
      schemaVersion: 'DerivedIndexReadReceiptV1',
      status: 'fresh',
      freshnessTier: 'metadata-reconciled',
      attestedFreshnessTier: 'metadata-reconciled',
      filesRead: 1,
      bytesRead: manifestReceipt.bytes || 0,
      pointer: null,
      pointerIdentity: null,
      manifest: manifestReceipt.value,
      manifestIdentity: manifestReceipt.identity
    }
    sourceIdentity = current.manifest.sourceIdentity
  } else {
    scan = scanReportCatalog(root)
    sourceIdentity = catalogSourceIdentity(scan)
    current = store.readCurrent({ expectedSourceIdentity: sourceIdentity })
  }
  let route = 'derived-index'
  let freshnessTier = 'metadata-reconciled'
  let matched
  let filesRead = current.filesRead || 0
  let indexBytesRead = current.bytesRead || 0
  let receipt = current
  let segments = []
  let totalMatched = 0

  if (current.status === 'fresh') {
    if (cursor) {
      const page = buildOrderedPageFromCursor(store, current, query, cursor)
      if (page.status === 'fresh') {
        route = page.route
        matched = page.entries
        segments = page.segments
        totalMatched = page.totalMatched
        filesRead += page.filesRead
        indexBytesRead += page.indexBytesRead
      } else {
        route = 'snapshot-cursor-invalid'
        freshnessTier = page.freshnessTier || 'invalid'
        receipt = page.receipt
        matched = []
        totalMatched = 0
        filesRead += page.filesRead
        indexBytesRead += page.indexBytesRead
      }
    } else if (canUseOrderedRoute(query)) {
      const page = buildOrderedPageFromDescriptors(store, selectOrderedDescriptors(current.manifest, query), current, query)
      if (page.status === 'fresh') {
        route = page.route
        matched = page.entries
        segments = page.segments
        totalMatched = page.totalMatched
        filesRead += page.filesRead
        indexBytesRead += page.indexBytesRead
      } else {
        route = 'path-stat-reconcile'
        freshnessTier = page.freshnessTier || 'invalid'
        receipt = page.receipt
        matched = filterEntries(scan.entries, query)
        totalMatched = matched.length
        filesRead += page.filesRead
        indexBytesRead += page.indexBytesRead
      }
    } else {
      const collected = collectEntriesFromPartitions(store, selectEntryPartitionDescriptors(current.manifest, query), current, query)
      if (collected.status === 'fresh') {
        matched = collected.entries
        totalMatched = matched.length
        filesRead += collected.filesRead
        indexBytesRead += collected.indexBytesRead
      } else {
        route = 'path-stat-reconcile'
        freshnessTier = collected.freshnessTier || 'invalid'
        receipt = collected.receipt
        matched = filterEntries(scan.entries, query)
        totalMatched = matched.length
        filesRead += collected.filesRead
        indexBytesRead += collected.indexBytesRead
      }
    }
  } else {
    route = 'path-stat-reconcile'
    freshnessTier = current.status === 'invalid' ? 'invalid' : 'metadata-reconciled'
    matched = filterEntries(scan.entries, query)
    totalMatched = matched.length
  }

  const pageEntries = cursor || route === 'ordered-snapshot' || route === 'snapshot-cursor'
    ? matched
    : matched.slice(query.offset, query.offset + query.limit)
  let items = pageEntries
  let hydrationBytes = 0
  if (query.hydrate) {
    const hydrated = hydrateReportEntries(root, items, { maxBytes: query.maxHydrateBytes })
    hydrationBytes += hydrated.bytesRead
    items = hydrated.entries
  }
  items = items.map(entry => projectReportEntry(entry, query.projection))
  const deliveredBytes = Buffer.byteLength(JSON.stringify(items))
  const status = ['derived-index', 'ordered-snapshot', 'snapshot-cursor'].includes(route)
    ? 'fresh'
    : route === 'snapshot-cursor-invalid'
      ? 'invalid'
      : 'fallback'
  const nextOffset = query.offset + items.length
  const hasMore = nextOffset < totalMatched
  const nextSnapshotCursor = hasMore && ['ordered-snapshot', 'snapshot-cursor'].includes(route)
    ? createSnapshotCursor({
      manifestIdentity: current.manifestIdentity,
      sourceIdentity,
      queryDigest: reportQueryDigest(query),
      offset: nextOffset,
      pageSize: query.limit,
      projection: query.projection,
      segments,
      totalMatched
    })
    : null
  const envelope = buildQueryEnvelope({
    status,
    freshnessTier,
    coverage: {
      status: ['derived-index', 'ordered-snapshot', 'snapshot-cursor'].includes(route)
        ? 'complete'
        : route === 'snapshot-cursor-invalid'
          ? 'invalid'
          : 'metadata-reconciled',
      sourceIdentity,
      route,
      discoveredEntryCount: scan ? scan.entries.length : manifestEntryCount(current.manifest),
      segmentCount: segments.length
    },
    items,
    truncated: hasMore,
    nextPointer: hasMore
      ? { offset: nextOffset }
      : null,
    evidencePointers: items.map(item => ({ path: item.path, classification: item.classification })),
    hydrated: query.hydrate,
    telemetry: {
      sourceBytes: (scan?.sourceBytesRead || 0) + hydrationBytes,
      representedSourceBytes: scan?.sourceCorpusBytes || null,
      deliveredBytes,
      indexBytesRead,
      filesRead: filesRead + (query.hydrate ? items.length : 0),
      metadataEntriesStat: scan ? scan.entries.length : 0,
      tokens: null
    },
    receipt: {
      status: receipt.status,
      freshnessTier,
      attestedFreshnessTier: receipt.attestedFreshnessTier || receipt.freshnessTier || null,
      pointerIdentity: receipt.pointerIdentity || null,
      manifestIdentity: receipt.manifestIdentity || null,
      errorCode: receipt.errorCode || null
    }
  })
  return {
    ...envelope,
    domain: 'report',
    scope: { activeRoot: root },
    query,
    warnings: scan?.warnings || [],
    warningCount: scan?.warningCount || 0,
    totalMatched,
    snapshotCursor: nextSnapshotCursor,
    snapshotCursorEncoded: nextSnapshotCursor ? encodeSnapshotCursor(nextSnapshotCursor) : null
  }
}

module.exports = {
  MAX_HYDRATE_BYTES,
  REPORT_CLASSIFICATIONS,
  catalogSourceIdentity,
  classifyReportPath,
  decodeSnapshotCursor,
  encodeSnapshotCursor,
  hydrateReportEntry,
  hydrateReportEntries,
  queryReportIndex,
  rebuildReportIndex,
  resolveReportRoots,
  scanReportCatalog
}
