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
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const MAX_HYDRATE_BYTES = 256 * 1024

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
      : Math.min(MAX_HYDRATE_BYTES, Number(query.maxHydrateBytes))
  }
}

function filterEntries(entries, query) {
  return entries
    .filter(entry => query.classifications.includes(entry.classification))
    .filter(entry => !query.taskKind || entry.taskKind === query.taskKind)
    .filter(entry => !query.task || entry.task === query.task)
    .filter(entry => !query.dateFrom || entry.date >= query.dateFrom)
    .filter(entry => !query.dateTo || entry.date <= query.dateTo)
    .filter(entry => !query.text || `${entry.title}\n${entry.path}`.toLowerCase().includes(query.text))
    .sort((left, right) =>
      right.date.localeCompare(left.date) ||
      right.modifiedAt.localeCompare(left.modifiedAt) ||
      left.path.localeCompare(right.path))
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

function hydrateReportEntry(activeRoot, entry, options = {}) {
  const maxBytes = options.maxBytes === undefined ? 64 * 1024 : Number(options.maxBytes)
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_HYDRATE_BYTES) {
    throw new Error(`report hydration maxBytes must be 1-${MAX_HYDRATE_BYTES}`)
  }
  const filePath = assertAllowlistedPointer(activeRoot, entry?.pointer?.path || entry?.path)
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
      path: normalizedRelative(activeRoot, filePath),
      freshnessTier: truncated ? 'metadata-reconciled' : 'content-verified',
      content,
      bytesRead,
      totalBytes: stat.size,
      truncated,
      contentIdentity: buildContentIdentity({
        sourceKey: `report-hydration://${normalizedRelative(activeRoot, filePath)}`,
        content,
        contractVersion: truncated ? '1-partial' : '1'
      })
    }
  } finally {
    fs.closeSync(descriptor)
  }
}

function queryReportIndex(activeRoot, input = {}) {
  const root = normalizeRoot(activeRoot)
  const query = normalizeQuery(input)
  const scan = scanReportCatalog(root)
  const sourceIdentity = catalogSourceIdentity(scan)
  const store = reportStore(root)
  const current = store.readCurrent({ expectedSourceIdentity: sourceIdentity })
  let route = 'derived-index'
  let freshnessTier = 'metadata-reconciled'
  let candidates
  let filesRead = current.filesRead || 0
  let indexBytesRead = current.bytesRead || 0
  let receipt = current

  if (current.status === 'fresh') {
    const descriptors = current.manifest.partitions.filter(descriptor =>
      descriptor.key.startsWith('entries:') &&
      query.classifications.includes(descriptor.metadata?.classification) &&
      (!query.taskKind || descriptor.metadata?.taskKind === query.taskKind) &&
      (!query.task || descriptor.metadata?.task === query.task) &&
      (!query.dateFrom || descriptor.metadata?.month >= query.dateFrom.slice(0, 7)) &&
      (!query.dateTo || descriptor.metadata?.month <= query.dateTo.slice(0, 7)))
    candidates = []
    for (const descriptor of descriptors) {
      const partition = store.readPartition(descriptor.key, { current })
      if (partition.status !== 'fresh' || partition.payload?.schemaVersion !== REPORT_ENTRY_SCHEMA) {
        route = 'path-stat-reconcile'
        freshnessTier = partition.freshnessTier || 'invalid'
        receipt = partition
        candidates = scan.entries
        break
      }
      candidates.push(...partition.payload.entries)
      filesRead += 1
      indexBytesRead += Math.max(0, (partition.bytesRead || 0) - (current.bytesRead || 0))
    }
  } else {
    route = 'path-stat-reconcile'
    freshnessTier = current.status === 'invalid' ? 'invalid' : 'metadata-reconciled'
    candidates = scan.entries
  }

  const matched = filterEntries(candidates, query)
  let items = matched.slice(query.offset, query.offset + query.limit)
  let hydrationBytes = 0
  if (query.hydrate) {
    items = items.map(entry => {
      const hydration = hydrateReportEntry(root, entry, { maxBytes: query.maxHydrateBytes })
      hydrationBytes += hydration.bytesRead
      return { ...entry, hydration }
    })
  }
  const deliveredBytes = Buffer.byteLength(JSON.stringify(items))
  const status = route === 'derived-index' ? 'fresh' : 'fallback'
  const envelope = buildQueryEnvelope({
    status,
    freshnessTier,
    coverage: {
      status: route === 'derived-index' ? 'complete' : 'metadata-reconciled',
      sourceIdentity,
      route,
      discoveredEntryCount: scan.entries.length
    },
    items,
    truncated: query.offset + items.length < matched.length,
    nextPointer: query.offset + items.length < matched.length
      ? { offset: query.offset + items.length }
      : null,
    evidencePointers: items.map(item => ({ path: item.path, classification: item.classification })),
    hydrated: query.hydrate,
    telemetry: {
      sourceBytes: scan.sourceBytesRead + hydrationBytes,
      representedSourceBytes: scan.sourceCorpusBytes,
      deliveredBytes,
      indexBytesRead,
      filesRead: filesRead + (query.hydrate ? items.length : 0),
      metadataEntriesStat: scan.entries.length,
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
    warnings: scan.warnings,
    warningCount: scan.warningCount,
    totalMatched: matched.length
  }
}

module.exports = {
  MAX_HYDRATE_BYTES,
  REPORT_CLASSIFICATIONS,
  catalogSourceIdentity,
  classifyReportPath,
  hydrateReportEntry,
  queryReportIndex,
  rebuildReportIndex,
  resolveReportRoots,
  scanReportCatalog
}
