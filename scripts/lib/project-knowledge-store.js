'use strict'

const fs = require('fs')
const path = require('path')
const childProcess = require('child_process')
const {
  buildContentIdentity,
  buildJsonContentIdentity,
  stableStringify
} = require('../../hooks/_runtime/content-identity.cjs')
const { createDerivedStateStore } = require('../../hooks/_runtime/derived-state-store.cjs')
const { createRuntimeStateStore } = require('../../hooks/_runtime/runtime-state-store.cjs')

const LEGACY_SNAPSHOT_SCHEMA = 'ProjectKnowledgeSnapshotV1'
const LEGACY_FILE_RECORD_SCHEMA = 'FileKnowledgeRecordV1'
const SNAPSHOT_SCHEMA = 'ProjectKnowledgeSnapshotV2'
const FILE_RECORD_SCHEMA = 'FileKnowledgeRecordV2'
const SEMANTIC_CLAIM_SCHEMA = 'SemanticClaimV1'
const BINDING_SCHEMA = 'ProjectKnowledgeBindingV1'
const IMPACT_GRAPH_SCHEMA = 'ImpactGraphV1'
const LENS_RECORD_SCHEMA = 'AnalysisLensRecordV1'
const PLAN_SCHEMA = 'IncrementalAnalysisPlanV2'
const RECEIPT_SCHEMA = 'IncrementalAnalysisReceiptV2'
const BACKLOG_SCHEMA = 'GlobalOptimizationBacklogV1'
const POLICY_VERSION = '2'
const GRAPH_BUILDER_VERSION = 'static-relative-v1'
const EVIDENCE_STRENGTH = new Set(['agent-semantic', 'content-structured', 'inventory-only'])
const COVERAGE_LEVEL = new Set(['deep', 'standard', 'light', 'inventory'])
const EDGE_TYPES = new Set(['dependency', 'consumer', 'config', 'contract', 'generated', 'test', 'docs'])
const CLAIM_TYPES = new Set(['inventory', 'structure', 'responsibility', 'symbol', 'import', 'config', 'contract', 'test', 'profile', 'dependency', 'risk', 'recommendation'])

class ProjectKnowledgeError extends Error {
  constructor(code, message, nextStep = '') {
    super(message)
    this.name = 'ProjectKnowledgeError'
    this.code = code
    this.nextStep = nextStep
  }
}

function normalizeRelative(value) {
  const normalized = String(value || '').normalize('NFKC').replace(/\\/g, '/').replace(/^\.\//, '')
  if (!normalized || normalized === '.' || normalized.startsWith('../') || path.posix.isAbsolute(normalized) || /^[a-zA-Z]:\//.test(normalized)) {
    throw new ProjectKnowledgeError('KNOWLEDGE_PATH_INVALID', `invalid project-relative path: ${value}`)
  }
  return normalized
}

function normalizeStringList(values) {
  if (!Array.isArray(values)) return []
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))].sort()
}

function normalizeIdentity(value, sourceKey) {
  if (value && typeof value === 'object' && typeof value.digest === 'string') {
    return { ...value, digest: String(value.digest) }
  }
  const normalized = value === undefined || value === null || value === '' ? 'default' : value
  return buildJsonContentIdentity({ sourceKey, value: normalized, contractVersion: POLICY_VERSION }).identity
}

function buildMerkleRoot(records) {
  let level = records.map(record => buildJsonContentIdentity({
    sourceKey: `project-inventory-leaf/${record.path}`,
    value: { path: record.path, digest: record.contentIdentity.digest, bytes: record.contentIdentity.bytes, kind: record.kind },
    contractVersion: POLICY_VERSION
  }).identity.digest)
  const leafCount = level.length
  if (!level.length) {
    level = [buildJsonContentIdentity({ sourceKey: 'project-inventory-empty', value: [], contractVersion: POLICY_VERSION }).identity.digest]
  }
  while (level.length > 1) {
    const next = []
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index]
      const right = level[index + 1] || left
      next.push(buildJsonContentIdentity({ sourceKey: 'project-inventory-node', value: [left, right], contractVersion: POLICY_VERSION }).identity.digest)
    }
    level = next
  }
  return { schemaVersion: 'ProjectInventoryMerkleRootV1', algorithm: 'sha256-pairwise', leafCount, digest: level[0] }
}

function buildRangeIdentity(relativePath, content, sourceRange) {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : String(content ?? '')
  const lines = text.split(/\r?\n/)
  const startLine = Number(sourceRange?.startLine)
  const endLine = Number(sourceRange?.endLine)
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || endLine > Math.max(1, lines.length)) {
    throw new ProjectKnowledgeError('KNOWLEDGE_CLAIM_RANGE_INVALID', `invalid source range for ${relativePath}`)
  }
  const selected = lines.slice(startLine - 1, endLine).join('\n')
  return buildContentIdentity({ sourceKey: `${relativePath}#L${startLine}-L${endLine}`, content: selected, contractVersion: POLICY_VERSION })
}

function canonicalClaimCore(claim) {
  if (!claim || typeof claim !== 'object') return null
  const { claimId, claimDigest, status, ...core } = claim
  return { ...core, status: 'candidate' }
}

function buildSemanticClaim({ path: relativePath, type, statement, authority, sourceRange, content, lens = {}, dependsOn = [], status = 'candidate' }) {
  const normalizedPath = normalizeRelative(relativePath)
  const normalizedType = CLAIM_TYPES.has(type) ? type : 'structure'
  const normalizedAuthority = EVIDENCE_STRENGTH.has(authority) ? authority : 'content-structured'
  const normalizedRange = { startLine: Number(sourceRange?.startLine), endLine: Number(sourceRange?.endLine) }
  const core = {
    schemaVersion: SEMANTIC_CLAIM_SCHEMA,
    path: normalizedPath,
    type: normalizedType,
    statement: String(statement || '').trim(),
    authority: normalizedAuthority,
    sourceRange: normalizedRange,
    rangeIdentity: buildRangeIdentity(normalizedPath, content, normalizedRange),
    sourceContentDigest: buildContentIdentity({ sourceKey: normalizedPath, content, contractVersion: POLICY_VERSION }).digest,
    lensId: String(lens.lensId || 'default'),
    lensVersion: String(lens.version || '1'),
    policyVersion: String(lens.policyVersion || POLICY_VERSION),
    dependsOn: normalizeStringList(dependsOn),
    status: 'candidate'
  }
  if (!core.statement) throw new ProjectKnowledgeError('KNOWLEDGE_CLAIM_EMPTY', `empty semantic claim: ${normalizedPath}`)
  const claimDigest = buildJsonContentIdentity({ sourceKey: `${normalizedPath}#semantic-claim`, value: core, contractVersion: POLICY_VERSION }).identity.digest
  return { ...core, claimId: `claim-${claimDigest.slice(0, 24)}`, claimDigest, status: status === 'accepted' ? 'accepted' : 'candidate' }
}

function inferLanguage(relativePath) {
  const extension = path.extname(relativePath).toLowerCase()
  return ({
    '.js': 'javascript', '.cjs': 'javascript', '.mjs': 'javascript', '.ts': 'typescript', '.tsx': 'typescript',
    '.jsx': 'javascript', '.json': 'json', '.md': 'markdown', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
    '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java', '.kt': 'kotlin', '.cs': 'csharp',
    '.html': 'html', '.css': 'css', '.scss': 'scss', '.sql': 'sql', '.sh': 'shell', '.ps1': 'powershell'
  })[extension] || 'unknown'
}

function inferKind(relativePath) {
  const lower = relativePath.toLowerCase()
  const base = path.posix.basename(lower)
  if (/^(package|plugin|tsconfig|jsconfig|composer|cargo|go\.mod)/.test(base) || /\.(json|ya?ml|toml|ini|env)$/.test(lower)) return 'config'
  if (/(^|\/)(test|tests|__tests__|spec|fixtures)(\/|$)|\.(test|spec)\.[^.]+$/.test(lower)) return 'test'
  if (/\.(md|mdx|rst|adoc)$/.test(lower) || /(^|\/)(docs?|website)(\/|$)/.test(lower)) return 'docs'
  if (/(^|\/)(generated|dist|build)(\/|$)/.test(lower)) return 'generated'
  return 'source'
}

function factDigest(record) {
  const facts = {
    symbols: normalizeStringList(record.symbols),
    imports: normalizeStringList(record.imports),
    configAnchors: normalizeStringList(record.configAnchors),
    contractAnchors: normalizeStringList(record.contractAnchors),
    facts: Array.isArray(record.facts) ? record.facts : [],
    semanticClaims: (Array.isArray(record.semanticClaims) ? record.semanticClaims : [])
      .map(claim => ({ claimId: claim.claimId, claimDigest: claim.claimDigest, status: claim.status }))
      .sort((left, right) => String(left.claimId).localeCompare(String(right.claimId)))
  }
  return buildJsonContentIdentity({ sourceKey: `${record.path}#facts`, value: facts, contractVersion: POLICY_VERSION }).identity.digest
}

function buildFileRecord(relativePath, content, options = {}) {
  const normalizedPath = normalizeRelative(relativePath)
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content ?? ''), 'utf8')
  const record = {
    schemaVersion: FILE_RECORD_SCHEMA,
    path: normalizedPath,
    contentIdentity: buildContentIdentity({ sourceKey: normalizedPath, content: bytes, contractVersion: POLICY_VERSION }),
    language: options.language || inferLanguage(normalizedPath),
    kind: options.kind || inferKind(normalizedPath),
    coverageLevel: options.coverageLevel || 'inventory',
    evidenceStrength: options.evidenceStrength || 'inventory-only',
    symbols: normalizeStringList(options.symbols),
    imports: normalizeStringList(options.imports),
    configAnchors: normalizeStringList(options.configAnchors),
    contractAnchors: normalizeStringList(options.contractAnchors),
    facts: Array.isArray(options.facts) ? options.facts : [],
    semanticClaims: Array.isArray(options.semanticClaims) ? options.semanticClaims : [],
    claimBoundary: options.claimBoundary || {
      maximumAuthority: options.evidenceStrength || 'inventory-only',
      manualDeepReadClaimAllowed: false,
      completeIssueCountClaimAllowed: false
    },
    tombstone: false
  }
  record.factDigest = factDigest(record)
  record.observationDigest = buildJsonContentIdentity({
    sourceKey: `${normalizedPath}#observation`,
    value: { contentDigest: record.contentIdentity.digest, semanticClaims: [] },
    contractVersion: POLICY_VERSION
  }).identity.digest
  Object.defineProperty(record, '__content', { value: bytes, enumerable: false, configurable: false, writable: false })
  return record
}

function buildInventoryFromFiles(files, options = {}) {
  const entries = Array.isArray(files)
    ? files
    : Object.entries(files || {}).map(([relativePath, content]) => ({ path: relativePath, content }))
  const maxFiles = Number.isInteger(options.maxFiles) && options.maxFiles > 0 ? options.maxFiles : 20000
  const maxBytes = Number.isInteger(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : 256 * 1024 * 1024
  const records = []
  let totalBytes = 0
  let overflowReason = options.overflowReason || null
  for (const entry of entries.sort((left, right) => String(left.path).localeCompare(String(right.path)))) {
    if (records.length >= maxFiles) {
      overflowReason = 'max-files-exceeded'
      break
    }
    const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(String(entry.content ?? ''), 'utf8')
    if (totalBytes + content.length > maxBytes) {
      overflowReason = 'max-bytes-exceeded'
      break
    }
    records.push(buildFileRecord(entry.path, content, entry))
    totalBytes += content.length
  }
  const merkleRoot = buildMerkleRoot(records)
  const inventoryCore = records.map(record => ({ path: record.path, contentIdentity: record.contentIdentity, kind: record.kind }))
  const inventoryIdentity = buildJsonContentIdentity({
    sourceKey: 'project-inventory',
    value: { merkleRoot, records: inventoryCore },
    contractVersion: POLICY_VERSION
  }).identity
  return {
    schemaVersion: 'ProjectInventoryV2',
    records,
    fileCount: records.length,
    totalBytes,
    bounded: overflowReason === null,
    overflowReason,
    merkleRoot,
    inventoryIdentity
  }
}

function listProjectFiles(repoRoot, options = {}) {
  if (Array.isArray(options.files)) return options.files.map(normalizeRelative).sort()
  const git = childProcess.spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: repoRoot,
    encoding: 'buffer',
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024
  })
  if (git.status === 0) {
    return git.stdout.toString('utf8').split('\0').filter(Boolean).map(normalizeRelative).sort()
  }
  const ignored = new Set(['.git', 'node_modules', '.devcodex', 'dist', 'build'])
  const output = []
  const maxCandidates = Number.isInteger(options.maxFiles) && options.maxFiles > 0 ? options.maxFiles + 1 : 20001
  const visit = current => {
    if (output.length >= maxCandidates) return
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (output.length >= maxCandidates) break
      if (ignored.has(entry.name)) continue
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) output.push(normalizeRelative(path.relative(repoRoot, absolute)))
    }
  }
  visit(repoRoot)
  return output.sort()
}

function scanProjectInventory(repoRoot, options = {}) {
  const root = path.resolve(repoRoot)
  const files = listProjectFiles(root, options)
  const entries = []
  const maxFiles = Number.isInteger(options.maxFiles) && options.maxFiles > 0 ? options.maxFiles : 20000
  const maxBytes = Number.isInteger(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : 256 * 1024 * 1024
  let totalBytes = 0
  let overflowReason = null
  for (const relativePath of files) {
    if (entries.length >= maxFiles) {
      overflowReason = 'max-files-exceeded'
      break
    }
    const absolute = path.resolve(root, relativePath)
    const boundary = path.relative(root, absolute)
    if (boundary.startsWith('..') || path.isAbsolute(boundary)) continue
    let stats
    try { stats = fs.statSync(absolute) } catch { continue }
    if (!stats.isFile()) continue
    if (totalBytes + stats.size > maxBytes) {
      overflowReason = 'max-bytes-exceeded'
      break
    }
    const content = fs.readFileSync(absolute)
    entries.push({ path: relativePath, content })
    totalBytes += content.length
  }
  return buildInventoryFromFiles(entries, { ...options, overflowReason })
}

function buildRepoIdentity(repoRoot, inventory, options = {}) {
  const normalizedRoot = path.resolve(repoRoot).replace(/\\/g, '/')
  const root = process.platform === 'win32' ? normalizedRoot.toLowerCase() : normalizedRoot
  const head = options.baseIdentity || childProcess.spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot, encoding: 'utf8', windowsHide: true, timeout: 10000
  }).stdout?.trim() || `inventory:${inventory.inventoryIdentity.digest}`
  return {
    repoId: buildContentIdentity({ sourceKey: 'repo-root', content: root, contractVersion: POLICY_VERSION }).digest.slice(0, 24),
    root,
    baseIdentity: head,
    baseReachable: options.baseReachable !== false
  }
}

function normalizeGraph(graph = {}) {
  const edges = []
  for (const raw of Array.isArray(graph.edges) ? graph.edges : []) {
    const from = normalizeRelative(raw.from)
    const to = normalizeRelative(raw.to)
    const type = EDGE_TYPES.has(raw.type) ? raw.type : 'dependency'
    edges.push({
      from,
      to,
      type,
      evidenceStrength: EVIDENCE_STRENGTH.has(raw.evidenceStrength) ? raw.evidenceStrength : 'inventory-only',
      source: String(raw.source || 'declared')
    })
  }
  edges.sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to) || left.type.localeCompare(right.type))
  const stats = {
    eligibleFiles: Number.isInteger(graph.stats?.eligibleFiles) ? graph.stats.eligibleFiles : 0,
    analyzedFiles: Number.isInteger(graph.stats?.analyzedFiles) ? graph.stats.analyzedFiles : 0,
    totalReferences: Number.isInteger(graph.stats?.totalReferences) ? graph.stats.totalReferences : edges.length,
    resolvedReferences: Number.isInteger(graph.stats?.resolvedReferences) ? graph.stats.resolvedReferences : edges.length,
    unresolvedReferences: Number.isInteger(graph.stats?.unresolvedReferences) ? graph.stats.unresolvedReferences : 0,
    unknownConsumerPaths: normalizeStringList(graph.stats?.unknownConsumerPaths)
  }
  const coverage = Number.isFinite(graph.coverage)
    ? Math.max(0, Math.min(1, graph.coverage))
    : (edges.length ? 1 : 0)
  const dynamicDependencyUnknown = graph.dynamicDependencyUnknown === true
  const builderVersion = String(graph.builderVersion || 'legacy')
  return {
    schemaVersion: IMPACT_GRAPH_SCHEMA,
    builderVersion,
    edges,
    coverage,
    dynamicDependencyUnknown,
    stats,
    graphIdentity: buildJsonContentIdentity({
      sourceKey: 'impact-graph',
      value: { builderVersion, edges, coverage, dynamicDependencyUnknown, stats },
      contractVersion: POLICY_VERSION
    }).identity
  }
}

const GRAPH_SOURCE_EXTENSIONS = ['.js', '.cjs', '.mjs', '.jsx', '.ts', '.tsx', '.json']
const GRAPH_DOC_EXTENSIONS = ['.md', '.mdx']

function resolveInventoryReference(fromPath, specifier, pathSet, extensions) {
  const withoutFragment = String(specifier || '').trim().replace(/^<|>$/g, '').split(/[?#]/, 1)[0]
  if (!withoutFragment || !withoutFragment.startsWith('.')) return null
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), withoutFragment))
  if (!base || base === '.' || base.startsWith('../') || path.posix.isAbsolute(base)) return null
  const candidates = [
    base,
    ...extensions.map(extension => `${base}${extension}`),
    ...extensions.map(extension => path.posix.join(base, `index${extension}`)),
    ...extensions.map(extension => path.posix.join(base, `README${extension}`))
  ]
  return candidates.find(candidate => pathSet.has(candidate)) || null
}

function extractStaticReferences(record) {
  const text = record.__content?.toString('utf8') || ''
  const references = []
  let dynamicDependencyUnknown = false
  if (['javascript', 'typescript'].includes(record.language)) {
    const patterns = [
      /\brequire\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
      /\b(?:import|export)\s+(?:[^'"`]*?\s+from\s+)?['"`]([^'"`]+)['"`]/g,
      /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g
    ]
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) references.push({ specifier: match[1], type: 'consumer', source: 'static-relative-import' })
    }
    if (/\b(?:require|import)\s*\(\s*(?!['"`])/.test(text)) dynamicDependencyUnknown = true
  } else if (record.language === 'markdown') {
    for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+['"][^'"]*['"])?\)/g)) {
      references.push({ specifier: match[1], type: 'docs', source: 'markdown-local-link' })
    }
  }
  return { references, dynamicDependencyUnknown }
}

function buildImpactGraphFromInventory(inventory) {
  const records = Array.isArray(inventory?.records) ? inventory.records : []
  const pathSet = new Set(records.map(record => record.path))
  const edgeMap = new Map()
  let eligibleFiles = 0
  let analyzedFiles = 0
  let totalReferences = 0
  let resolvedReferences = 0
  let unresolvedReferences = 0
  let dynamicDependencyUnknown = false
  const unknownConsumerPaths = new Set()

  for (const record of records) {
    const sourceLike = ['javascript', 'typescript'].includes(record.language)
    const docsLike = record.language === 'markdown'
    if (!sourceLike && !docsLike) continue
    eligibleFiles += 1
    const extracted = extractStaticReferences(record)
    analyzedFiles += 1
    if (extracted.dynamicDependencyUnknown) {
      dynamicDependencyUnknown = true
      unknownConsumerPaths.add(record.path)
    }
    const extensions = sourceLike ? GRAPH_SOURCE_EXTENSIONS : GRAPH_DOC_EXTENSIONS
    for (const reference of extracted.references) {
      if (!String(reference.specifier || '').startsWith('.')) continue
      totalReferences += 1
      const target = resolveInventoryReference(record.path, reference.specifier, pathSet, extensions)
      if (!target) {
        unresolvedReferences += 1
        continue
      }
      resolvedReferences += 1
      const edge = {
        from: target,
        to: record.path,
        type: reference.type,
        evidenceStrength: 'content-structured',
        source: reference.source
      }
      edgeMap.set(`${edge.from}\u0000${edge.to}\u0000${edge.type}`, edge)
    }
  }
  const coverage = totalReferences ? resolvedReferences / totalReferences : (eligibleFiles ? analyzedFiles / eligibleFiles : 1)
  return normalizeGraph({
    builderVersion: GRAPH_BUILDER_VERSION,
    edges: [...edgeMap.values()],
    coverage,
    dynamicDependencyUnknown,
    stats: {
      eligibleFiles,
      analyzedFiles,
      totalReferences,
      resolvedReferences,
      unresolvedReferences,
      unknownConsumerPaths: [...unknownConsumerPaths].sort()
    }
  })
}

function normalizeLens(lens = {}) {
  return {
    schemaVersion: LENS_RECORD_SCHEMA,
    lensId: String(lens.lensId || 'default').trim(),
    version: String(lens.version || '1').trim(),
    questionFingerprint: String(lens.questionFingerprint || 'default').trim(),
    policyVersion: String(lens.policyVersion || POLICY_VERSION),
    dependsOn: normalizeStringList(lens.dependsOn),
    coveragePaths: normalizeStringList(lens.coveragePaths),
    findingAnchors: normalizeStringList(lens.findingAnchors),
    status: lens.status === 'accepted' ? 'accepted' : 'candidate'
  }
}

function buildKnowledgeBinding({ repoIdentity, inventory, lens = {}, analysisConfigIdentity, parserIdentity, testIdentity, profileIdentity }) {
  const normalizedLens = normalizeLens(lens)
  const core = {
    schemaVersion: BINDING_SCHEMA,
    repoId: String(repoIdentity?.repoId || ''),
    root: String(repoIdentity?.root || ''),
    baseIdentity: String(repoIdentity?.baseIdentity || ''),
    inventoryIdentity: inventory?.inventoryIdentity || null,
    inventoryMerkleRoot: inventory?.merkleRoot || null,
    analysisConfigIdentity: normalizeIdentity(analysisConfigIdentity, 'project-knowledge/analysis-config'),
    parserIdentity: normalizeIdentity(parserIdentity, 'project-knowledge/parser'),
    testIdentity: normalizeIdentity(testIdentity, 'project-knowledge/test-route'),
    profileIdentity: normalizeIdentity(profileIdentity, 'project-knowledge/profile'),
    lensIdentity: buildJsonContentIdentity({
      sourceKey: 'project-knowledge/lens',
      value: {
        lensId: normalizedLens.lensId,
        version: normalizedLens.version,
        questionFingerprint: normalizedLens.questionFingerprint,
        policyVersion: normalizedLens.policyVersion,
        dependsOn: normalizedLens.dependsOn
      },
      contractVersion: POLICY_VERSION
    }).identity,
    policyVersion: POLICY_VERSION
  }
  const bindingIdentity = buildJsonContentIdentity({ sourceKey: 'project-knowledge/binding', value: core, contractVersion: POLICY_VERSION }).identity
  return { ...core, bindingIdentity }
}

function bindingEnvironmentMatches(left, right) {
  if (!left || !right || left.schemaVersion !== BINDING_SCHEMA || right.schemaVersion !== BINDING_SCHEMA) return false
  if (left.repoId !== right.repoId || left.root !== right.root || left.policyVersion !== right.policyVersion) return false
  return ['analysisConfigIdentity', 'parserIdentity', 'testIdentity', 'profileIdentity']
    .every(field => left[field]?.digest === right[field]?.digest)
}

function validateSemanticClaim(claim, inventoryRecord) {
  if (!claim || claim.schemaVersion !== SEMANTIC_CLAIM_SCHEMA || !CLAIM_TYPES.has(claim.type) || !EVIDENCE_STRENGTH.has(claim.authority)) return false
  if (claim.path !== inventoryRecord?.path || claim.sourceContentDigest !== inventoryRecord?.contentIdentity?.digest || !claim.claimId || !claim.claimDigest) return false
  let expectedRange
  try {
    expectedRange = buildRangeIdentity(inventoryRecord.path, inventoryRecord.__content, claim.sourceRange)
  } catch {
    return false
  }
  if (expectedRange.digest !== claim.rangeIdentity?.digest) return false
  const identity = buildJsonContentIdentity({ sourceKey: `${claim.path}#semantic-claim`, value: canonicalClaimCore(claim), contractVersion: POLICY_VERSION }).identity
  return claim.claimDigest === identity.digest && claim.claimId === `claim-${identity.digest.slice(0, 24)}`
}

function observationDigest(record) {
  const claims = (Array.isArray(record.semanticClaims) ? record.semanticClaims : [])
    .filter(claim => claim.authority !== 'agent-semantic')
    .map(claim => ({ claimId: claim.claimId, claimDigest: claim.claimDigest }))
    .sort((left, right) => left.claimId.localeCompare(right.claimId))
  return buildJsonContentIdentity({
    sourceKey: `${record.path}#observation`,
    value: { contentDigest: record.contentIdentity.digest, semanticClaims: claims },
    contractVersion: POLICY_VERSION
  }).identity.digest
}

function observeFileRecord(inventoryRecord, lens = {}) {
  if (!inventoryRecord?.__content) {
    throw new ProjectKnowledgeError('KNOWLEDGE_OBSERVE_CONTENT_MISSING', `source bytes unavailable for ${inventoryRecord?.path || '(unknown)'}`)
  }
  const content = inventoryRecord.__content
  const text = content.toString('utf8')
  const lines = text.split(/\r?\n/)
  const rawClaims = []
  const add = (type, statement, lineNumber, authority = 'content-structured') => {
    if (rawClaims.length >= 200) return
    const normalized = String(statement || '').trim().replace(/\s+/g, ' ').slice(0, 500)
    if (!normalized) return
    rawClaims.push({ type, statement: normalized, authority, sourceRange: { startLine: lineNumber, endLine: lineNumber } })
  }
  lines.forEach((line, index) => {
    const lineNumber = index + 1
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)
    if (heading) add('structure', `heading: ${heading[1]}`, lineNumber)
    const importMatch = line.match(/(?:require\(\s*['"]([^'"]+)['"]\s*\)|\bfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"])/)
    if (importMatch) add('import', `import: ${importMatch[1] || importMatch[2] || importMatch[3]}`, lineNumber)
    const symbolMatch = line.match(/\b(?:class|function)\s+([A-Za-z_$][\w$]*)|\b(?:module\.exports|exports\.([A-Za-z_$][\w$]*))\b/)
    if (symbolMatch) add('symbol', `symbol: ${symbolMatch[1] || symbolMatch[2] || 'module.exports'}`, lineNumber)
    if (/\b(?:describe|it|test)\s*\(/.test(line)) add('test', `test declaration: ${line.trim()}`, lineNumber)
    if (inventoryRecord.kind === 'config') {
      const configMatch = line.match(/^\s*["']?([A-Za-z0-9_.-]+)["']?\s*[:=]/)
      if (configMatch) add('config', `config key: ${configMatch[1]}`, lineNumber)
    }
  })
  if (inventoryRecord.language === 'json') {
    try {
      const parsed = JSON.parse(text)
      if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
        for (const key of Object.keys(parsed).sort()) {
          const lineNumber = Math.max(1, lines.findIndex(line => line.includes(`"${key}"`)) + 1)
          add('config', `top-level key: ${key}`, lineNumber)
        }
      }
    } catch {
      // Invalid JSON remains inventory-observed; parser validity is owned by validation.
    }
  }
  const deduped = new Map()
  for (const raw of rawClaims) {
    const key = `${raw.type}:${raw.statement}:${raw.sourceRange.startLine}`
    if (!deduped.has(key)) deduped.set(key, raw)
  }
  if (!deduped.size) {
    deduped.set('inventory', {
      type: 'inventory',
      statement: `file observed: ${inventoryRecord.path}`,
      authority: 'inventory-only',
      sourceRange: { startLine: 1, endLine: 1 }
    })
  }
  const semanticClaims = [...deduped.values()].map(raw => buildSemanticClaim({
    path: inventoryRecord.path,
    content,
    lens,
    ...raw
  })).sort((left, right) => left.claimId.localeCompare(right.claimId))
  const record = {
    ...inventoryRecord,
    schemaVersion: FILE_RECORD_SCHEMA,
    coverageLevel: semanticClaims.some(claim => claim.authority === 'content-structured') ? 'light' : 'inventory',
    evidenceStrength: semanticClaims.some(claim => claim.authority === 'content-structured') ? 'content-structured' : 'inventory-only',
    symbols: semanticClaims.filter(claim => claim.type === 'symbol').map(claim => claim.statement),
    imports: semanticClaims.filter(claim => claim.type === 'import').map(claim => claim.statement),
    configAnchors: semanticClaims.filter(claim => claim.type === 'config').map(claim => claim.statement),
    contractAnchors: semanticClaims.filter(claim => claim.type === 'contract').map(claim => claim.statement),
    facts: semanticClaims.map(claim => ({ anchor: claim.claimId, statement: claim.statement })),
    semanticClaims,
    claimBoundary: {
      maximumAuthority: semanticClaims.some(claim => claim.authority === 'content-structured') ? 'content-structured' : 'inventory-only',
      manualDeepReadClaimAllowed: false,
      completeIssueCountClaimAllowed: false
    },
    tombstone: false
  }
  record.factDigest = factDigest(record)
  record.observationDigest = observationDigest(record)
  return record
}

function observeProjectKnowledge({ inventory, plan, lens = plan?.lens || {} }) {
  if (!plan || !validatePlanIdentity(plan)) throw new ProjectKnowledgeError('KNOWLEDGE_OBSERVE_PLAN_INVALID', 'observe requires a valid current plan')
  const byPath = new Map(inventory.records.map(record => [record.path, record]))
  const observePaths = paths => paths.map(relativePath => observeFileRecord(byPath.get(relativePath), lens))
  const candidateRecords = observePaths(plan.readPaths)
  const sampleRecords = observePaths(plan.samplePaths)
  return {
    schemaVersion: 'ProjectKnowledgeObservationV1',
    planId: plan.planId,
    bindingIdentity: plan.knowledgeBinding?.bindingIdentity || null,
    candidateRecords,
    sampleRecords,
    claimBoundary: 'content-structured-only; no manual-deep-read or complete-issue-count claim',
    observationIdentity: buildJsonContentIdentity({
      sourceKey: `project-knowledge/observation/${plan.planId}`,
      value: {
        candidateRecords: candidateRecords.map(record => ({ path: record.path, observationDigest: record.observationDigest })),
        sampleRecords: sampleRecords.map(record => ({ path: record.path, observationDigest: record.observationDigest }))
      },
      contractVersion: POLICY_VERSION
    }).identity
  }
}

function createSnapshot({ repoIdentity, inventory, graph = {}, policyVersion = POLICY_VERSION, knowledgeBinding = null }) {
  const normalizedGraph = normalizeGraph(graph)
  return {
    schemaVersion: SNAPSHOT_SCHEMA,
    policyVersion: String(policyVersion),
    repoIdentity,
    inventoryIdentity: inventory.inventoryIdentity,
    inventoryMerkleRoot: inventory.merkleRoot || null,
    knowledgeBinding,
    records: [],
    tombstones: [],
    impactGraph: normalizedGraph,
    lenses: [],
    planProgress: {},
    pendingPlan: null,
    status: 'empty',
    snapshotIdentity: null
  }
}

function normalizeSnapshot(snapshot, fallback) {
  if (!snapshot) return createSnapshot(fallback)
  return {
    ...createSnapshot(fallback),
    ...snapshot,
    records: Array.isArray(snapshot.records) ? snapshot.records : [],
    tombstones: Array.isArray(snapshot.tombstones) ? snapshot.tombstones : [],
    lenses: Array.isArray(snapshot.lenses) ? snapshot.lenses : [],
    planProgress: snapshot.planProgress && typeof snapshot.planProgress === 'object' ? snapshot.planProgress : {},
    impactGraph: normalizeGraph(snapshot.impactGraph || fallback.graph)
  }
}

function canonicalPlanCore(plan) {
  if (!plan || typeof plan !== 'object') return null
  const { planId, planIdentity, ...core } = plan
  return {
    ...core,
    resumed: false,
    batches: Array.isArray(core.batches) ? core.batches.map(batch => ({ ...batch, status: 'pending' })) : []
  }
}

function validatePlanIdentity(plan) {
  if (!plan || plan.schemaVersion !== PLAN_SCHEMA || !plan.planIdentity || !String(plan.planId || '').startsWith('knowledge-')) return false
  const identity = buildJsonContentIdentity({ sourceKey: 'incremental-analysis-plan', value: canonicalPlanCore(plan), contractVersion: POLICY_VERSION }).identity
  return identity.digest === plan.planIdentity.digest && plan.planId === `knowledge-${identity.digest.slice(0, 24)}`
}

function validateSnapshotIdentity(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== SNAPSHOT_SCHEMA || !snapshot.snapshotIdentity || !snapshot.repoIdentity?.repoId) return false
  const core = { ...snapshot, snapshotIdentity: null }
  const identity = buildJsonContentIdentity({ sourceKey: `project-knowledge/${snapshot.repoIdentity.repoId}`, value: core, contractVersion: POLICY_VERSION }).identity
  return identity.digest === snapshot.snapshotIdentity.digest
}

function validateLegacySnapshotIdentity(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== LEGACY_SNAPSHOT_SCHEMA || !snapshot.snapshotIdentity || !snapshot.repoIdentity?.repoId) return false
  const core = { ...snapshot, snapshotIdentity: null }
  const identity = buildJsonContentIdentity({ sourceKey: `project-knowledge/${snapshot.repoIdentity.repoId}`, value: core, contractVersion: '1' }).identity
  return identity.digest === snapshot.snapshotIdentity.digest
}

function sameContent(left, right) {
  return !!left && !!right && left.digest === right.digest && left.bytes === right.bytes && left.contractVersion === right.contractVersion
}

function detectDelta(snapshotRecords, currentRecords) {
  const previous = new Map(snapshotRecords.filter(record => !record.tombstone).map(record => [record.path, record]))
  const current = new Map(currentRecords.map(record => [record.path, record]))
  const added = [...current.keys()].filter(key => !previous.has(key)).sort()
  const deleted = [...previous.keys()].filter(key => !current.has(key)).sort()
  const modified = [...current.keys()].filter(key => previous.has(key) && !sameContent(previous.get(key).contentIdentity, current.get(key).contentIdentity)).sort()
  const deletedByDigest = new Map()
  for (const oldPath of deleted) {
    const digest = previous.get(oldPath).contentIdentity.digest
    if (!deletedByDigest.has(digest)) deletedByDigest.set(digest, [])
    deletedByDigest.get(digest).push(oldPath)
  }
  const addedByDigest = new Map()
  for (const newPath of added) {
    const digest = current.get(newPath).contentIdentity.digest
    if (!addedByDigest.has(digest)) addedByDigest.set(digest, [])
    addedByDigest.get(digest).push(newPath)
  }
  const renames = []
  for (const [digest, oldPaths] of deletedByDigest) {
    const newPaths = addedByDigest.get(digest) || []
    if (oldPaths.length === 1 && newPaths.length === 1) renames.push({ from: oldPaths[0], to: newPaths[0], contentDigest: digest })
  }
  const renamedOld = new Set(renames.map(item => item.from))
  const renamedNew = new Set(renames.map(item => item.to))
  return {
    added: added.filter(item => !renamedNew.has(item)),
    modified,
    deleted: deleted.filter(item => !renamedOld.has(item)),
    renames: renames.sort((left, right) => left.from.localeCompare(right.from))
  }
}

function expandImpact(seedPaths, currentRecords, graph) {
  const paths = new Set(currentRecords.map(record => record.path))
  const adjacency = new Map([...paths].map(item => [item, new Set()]))
  for (const edge of graph.edges) {
    if (adjacency.has(edge.from) && adjacency.has(edge.to)) {
      adjacency.get(edge.from).add(edge.to)
      adjacency.get(edge.to).add(edge.from)
    }
  }
  const affected = new Set(seedPaths.filter(item => paths.has(item)))
  const queue = [...affected]
  while (queue.length) {
    const current = queue.shift()
    for (const next of adjacency.get(current) || []) {
      if (affected.has(next)) continue
      affected.add(next)
      queue.push(next)
    }
  }
  return [...affected].sort()
}

function buildBatches(paths, operations, maxBatchFiles) {
  const groups = new Map()
  for (const relativePath of paths) {
    const namespace = relativePath.includes('/') ? relativePath.split('/')[0] : '$root'
    if (!groups.has(namespace)) groups.set(namespace, [])
    groups.get(namespace).push(relativePath)
  }
  const batches = []
  for (const namespace of [...groups.keys()].sort()) {
    const values = groups.get(namespace).sort()
    for (let index = 0; index < values.length; index += maxBatchFiles) {
      batches.push({ namespace, paths: values.slice(index, index + maxBatchFiles) })
    }
  }
  if (!batches.length && operations.length) batches.push({ namespace: '$tombstone', paths: [] })
  return batches.map((batch, index) => ({
    batchId: `batch-${String(index + 1).padStart(3, '0')}`,
    namespace: batch.namespace,
    paths: batch.paths,
    operations: operations.filter(operation =>
      (operation.type === 'rename' && batch.paths.includes(operation.to)) ||
      (operation.type === 'delete' && index === 0)
    ),
    status: 'pending',
    budget: { maxFiles: maxBatchFiles, selectedFiles: batch.paths.length }
  }))
}

function selectDeterministicReuseSample(records, options = {}) {
  const values = Array.isArray(records) ? records : []
  if (!values.length) return []
  const percent = Number.isFinite(options.percent) && options.percent > 0 ? options.percent : 0.05
  const minimum = Number.isInteger(options.minimum) ? options.minimum : 3
  const maximum = Number.isInteger(options.maximum) ? options.maximum : 20
  const count = values.length < minimum ? values.length : Math.min(maximum, Math.max(minimum, Math.ceil(values.length * percent)))
  return [...values]
    .sort((left, right) => left.contentIdentity.digest.localeCompare(right.contentIdentity.digest) || left.path.localeCompare(right.path))
    .slice(0, count)
    .map(record => record.path)
}

function lensMatches(record, lens) {
  return record && record.status === 'accepted' && record.lensId === lens.lensId && record.version === lens.version &&
    record.questionFingerprint === lens.questionFingerprint && record.policyVersion === lens.policyVersion
}

function buildIncrementalAnalysisPlan({ snapshot, inventory, repoIdentity, graph = {}, lens = {}, options = {} }) {
  const currentLens = normalizeLens(lens)
  const normalizedGraph = normalizeGraph(graph.edges ? graph : snapshot?.impactGraph || graph)
  const priorGraph = snapshot ? normalizeGraph(snapshot.impactGraph || {}) : null
  const graphIdentityChanged = Boolean(
    priorGraph &&
    priorGraph.graphIdentity?.digest !== normalizedGraph.graphIdentity?.digest
  )
  const currentBinding = buildKnowledgeBinding({
    repoIdentity,
    inventory,
    lens: currentLens,
    analysisConfigIdentity: options.analysisConfigIdentity,
    parserIdentity: options.parserIdentity,
    testIdentity: options.testIdentity,
    profileIdentity: options.profileIdentity
  })
  const normalizedSnapshot = normalizeSnapshot(snapshot, { repoIdentity, inventory, graph: normalizedGraph, knowledgeBinding: currentBinding })
  const pendingPlanInvalid = !!normalizedSnapshot.pendingPlan && !validatePlanIdentity(normalizedSnapshot.pendingPlan)
  if (!graphIdentityChanged && !pendingPlanInvalid && normalizedSnapshot.pendingPlan && normalizedSnapshot.pendingPlan.inventoryIdentity?.digest === inventory.inventoryIdentity.digest &&
      normalizedSnapshot.pendingPlan.repoIdentity?.repoId === repoIdentity.repoId &&
      normalizedSnapshot.pendingPlan.knowledgeBinding?.bindingIdentity?.digest === currentBinding.bindingIdentity.digest &&
      normalizedSnapshot.pendingPlan.lens?.lensId === currentLens.lensId &&
      normalizedSnapshot.pendingPlan.lens?.version === currentLens.version &&
      normalizedSnapshot.pendingPlan.lens?.questionFingerprint === currentLens.questionFingerprint &&
      normalizedSnapshot.pendingPlan.lens?.policyVersion === currentLens.policyVersion) {
    const accepted = new Set(normalizedSnapshot.planProgress[normalizedSnapshot.pendingPlan.planId]?.acceptedBatchIds || [])
    return {
      ...normalizedSnapshot.pendingPlan,
      batches: normalizedSnapshot.pendingPlan.batches.map(batch => ({ ...batch, status: accepted.has(batch.batchId) ? 'accepted' : 'pending' })),
      resumed: true
    }
  }

  const schemaCompatible = !snapshot || snapshot.schemaVersion === SNAPSHOT_SCHEMA
  const delta = detectDelta(schemaCompatible ? normalizedSnapshot.records : [], inventory.records)
  const currentPaths = inventory.records.map(record => record.path)
  const changedActive = [...delta.added, ...delta.modified, ...delta.renames.map(item => item.to)]
  const configChanged = inventory.records.some(record => changedActive.includes(record.path) && record.kind === 'config')
  const unknownConsumerPaths = normalizeStringList(normalizedGraph.stats?.unknownConsumerPaths)
    .filter(relativePath => currentPaths.includes(relativePath))
  const impacted = configChanged
    ? [...currentPaths]
    : [...new Set([
        ...expandImpact(changedActive, inventory.records, normalizedGraph),
        ...(changedActive.length ? unknownConsumerPaths : [])
      ])].sort()
  const priorLens = normalizedSnapshot.lenses.find(record => record.lensId === currentLens.lensId)
  const lensGap = lensMatches(priorLens, currentLens)
    ? currentLens.dependsOn.filter(relativePath => !priorLens.coveragePaths.includes(relativePath))
    : (currentLens.dependsOn.length ? currentLens.dependsOn.filter(relativePath => currentPaths.includes(relativePath)) : [...currentPaths])
  const fullReasons = []
  if (!snapshot) fullReasons.push('snapshot-missing')
  if (!schemaCompatible) fullReasons.push('snapshot-schema-incompatible')
  if (snapshot && (snapshot.repoIdentity?.repoId !== repoIdentity.repoId || snapshot.repoIdentity?.root !== repoIdentity.root)) fullReasons.push('snapshot-target-binding-mismatch')
  if (snapshot && !bindingEnvironmentMatches(snapshot.knowledgeBinding, currentBinding)) fullReasons.push('analysis-environment-binding-mismatch')
  if (pendingPlanInvalid) fullReasons.push('pending-plan-identity-invalid')
  if (priorGraph && priorGraph.builderVersion !== normalizedGraph.builderVersion) fullReasons.push('impact-graph-builder-migration')
  if (!inventory.bounded) fullReasons.push(`inventory-${inventory.overflowReason}`)
  if (repoIdentity.baseReachable === false) fullReasons.push('base-unreachable')
  if (
    options.dynamicDependencyUnknown === true ||
    changedActive.some(relativePath => unknownConsumerPaths.includes(relativePath))
  ) {
    fullReasons.push('dynamic-dependency-consumer-changed')
  }
  if (options.highRisk === true) fullReasons.push('high-risk-analysis')
  if (snapshot && normalizedGraph.coverage < (Number.isFinite(options.minimumGraphCoverage) ? options.minimumGraphCoverage : 0.8) && changedActive.length) {
    fullReasons.push('impact-graph-coverage-insufficient')
  }
  let readPaths = [...new Set([...changedActive, ...impacted, ...lensGap])].sort()
  const affectedRatio = currentPaths.length ? readPaths.length / currentPaths.length : 0
  if (snapshot && affectedRatio > (Number.isFinite(options.maxAffectedRatio) ? options.maxAffectedRatio : 0.6)) fullReasons.push('affected-closure-too-large')
  for (const reason of normalizeStringList(options.forceFullReasons)) fullReasons.push(reason)
  if (fullReasons.length) readPaths = [...currentPaths]
  const reusedPaths = fullReasons.length ? [] : currentPaths.filter(relativePath => !readPaths.includes(relativePath))
  const operations = [
    ...delta.deleted.map(relativePath => ({ type: 'delete', path: relativePath })),
    ...delta.renames.map(item => ({ type: 'rename', from: item.from, to: item.to, contentDigest: item.contentDigest }))
  ]
  const maxBatchFiles = Number.isInteger(options.maxBatchFiles) && options.maxBatchFiles > 0 ? options.maxBatchFiles : 50
  const completion = inventory.bounded ? 'planned' : 'blocked'
  const core = {
    schemaVersion: PLAN_SCHEMA,
    policyVersion: POLICY_VERSION,
    repoIdentity,
    inventoryIdentity: inventory.inventoryIdentity,
    inventoryMerkleRoot: inventory.merkleRoot || null,
    knowledgeBinding: currentBinding,
    lens: currentLens,
    delta,
    changed: changedActive,
    affected: impacted,
    graphChanged: graphIdentityChanged,
    lensGap: [...new Set(lensGap)].sort(),
    readPaths,
    reusedPaths,
    samplePaths: selectDeterministicReuseSample(inventory.records.filter(record => reusedPaths.includes(record.path))),
    operations,
    fullRequired: fullReasons.length > 0,
    fullReasons: [...new Set(fullReasons)].sort(),
    affectedRatio,
    batches: inventory.bounded ? buildBatches(readPaths, operations, maxBatchFiles) : [],
    completion,
    blockedReason: inventory.bounded ? null : `bounded-inventory-incomplete:${inventory.overflowReason}`,
    resumed: false
  }
  const planIdentity = buildJsonContentIdentity({ sourceKey: 'incremental-analysis-plan', value: core, contractVersion: POLICY_VERSION }).identity
  return { ...core, planId: `knowledge-${planIdentity.digest.slice(0, 24)}`, planIdentity }
}

function verifyReuseSample({ samplePaths = [], snapshotRecords = [], observedRecords = [] }) {
  const prior = new Map(snapshotRecords.map(record => [record.path, record]))
  const observed = new Map(observedRecords.map(record => [record.path, record]))
  const mismatches = []
  for (const relativePath of samplePaths) {
    const expected = prior.get(relativePath)
    const actual = observed.get(relativePath)
    const expectedDigest = expected?.observationDigest || expected?.factDigest
    const actualDigest = actual?.observationDigest || actual?.factDigest
    if (!expected || !actual || !sameContent(expected.contentIdentity, actual.contentIdentity) || expectedDigest !== actualDigest) {
      mismatches.push(relativePath)
    }
  }
  return {
    schemaVersion: 'ProjectKnowledgeSampleOracleV2',
    samplePaths: [...samplePaths],
    checked: samplePaths.length,
    mismatches,
    status: mismatches.length ? 'fail' : 'pass'
  }
}

function normalizeCandidateRecord(candidate, inventoryRecord, lens) {
  if (!candidate || candidate.path !== inventoryRecord.path || !sameContent(candidate.contentIdentity, inventoryRecord.contentIdentity)) {
    throw new ProjectKnowledgeError('KNOWLEDGE_CANDIDATE_IDENTITY_MISMATCH', `candidate identity mismatch: ${inventoryRecord.path}`)
  }
  if (!COVERAGE_LEVEL.has(candidate.coverageLevel) || !EVIDENCE_STRENGTH.has(candidate.evidenceStrength)) {
    throw new ProjectKnowledgeError('KNOWLEDGE_CANDIDATE_COVERAGE_INVALID', `invalid coverage/evidence: ${inventoryRecord.path}`)
  }
  const semanticClaims = Array.isArray(candidate.semanticClaims) ? candidate.semanticClaims : []
  if (!semanticClaims.length) throw new ProjectKnowledgeError('KNOWLEDGE_CANDIDATE_CLAIMS_MISSING', `semantic claims missing: ${inventoryRecord.path}`)
  for (const claim of semanticClaims) {
    if (!validateSemanticClaim(claim, inventoryRecord)) {
      throw new ProjectKnowledgeError('KNOWLEDGE_CLAIM_IDENTITY_INVALID', `semantic claim identity/range mismatch: ${inventoryRecord.path}`)
    }
    if (claim.lensId !== lens.lensId || claim.lensVersion !== lens.version || claim.policyVersion !== lens.policyVersion) {
      throw new ProjectKnowledgeError('KNOWLEDGE_CLAIM_LENS_MISMATCH', `semantic claim lens mismatch: ${inventoryRecord.path}`)
    }
  }
  const record = {
    ...inventoryRecord,
    ...candidate,
    schemaVersion: FILE_RECORD_SCHEMA,
    path: inventoryRecord.path,
    contentIdentity: inventoryRecord.contentIdentity,
    symbols: normalizeStringList(candidate.symbols),
    imports: normalizeStringList(candidate.imports),
    configAnchors: normalizeStringList(candidate.configAnchors),
    contractAnchors: normalizeStringList(candidate.contractAnchors),
    facts: Array.isArray(candidate.facts) ? candidate.facts : [],
    semanticClaims: semanticClaims.map(claim => ({ ...claim, status: 'accepted' })).sort((left, right) => left.claimId.localeCompare(right.claimId)),
    claimBoundary: candidate.claimBoundary || {
      maximumAuthority: candidate.evidenceStrength,
      manualDeepReadClaimAllowed: candidate.evidenceStrength === 'agent-semantic',
      completeIssueCountClaimAllowed: false
    },
    tombstone: false
  }
  record.factDigest = factDigest(record)
  record.observationDigest = observationDigest(record)
  return record
}

function acceptKnowledgeBatch({ snapshot, inventory, repoIdentity, plan, batchId, candidateRecords = [], validationResult, sampleOracle, graph = {}, findings = [] }) {
  const current = normalizeSnapshot(snapshot, { repoIdentity, inventory, graph })
  if (!validatePlanIdentity(plan) || plan.repoIdentity?.repoId !== repoIdentity.repoId || plan.inventoryIdentity?.digest !== inventory.inventoryIdentity.digest) {
    throw new ProjectKnowledgeError('KNOWLEDGE_ACCEPT_PLAN_STALE', 'plan identity does not match the current repo/inventory')
  }
  if (plan.completion === 'blocked' || !inventory.bounded) {
    throw new ProjectKnowledgeError('KNOWLEDGE_ACCEPT_INVENTORY_INCOMPLETE', 'bounded inventory is incomplete; increase the explicit inventory budget before accept')
  }
  const batch = plan.batches.find(item => item.batchId === batchId)
  if (!batch) throw new ProjectKnowledgeError('KNOWLEDGE_BATCH_UNKNOWN', `unknown batch: ${batchId}`)
  const progress = current.planProgress[plan.planId] || { acceptedBatchIds: [] }
  if (progress.acceptedBatchIds.includes(batchId)) {
    return { snapshot: current, receipt: { schemaVersion: RECEIPT_SCHEMA, status: 'duplicate-accepted', planId: plan.planId, batchId } }
  }
  if (validationResult?.status !== 'pass') {
    return {
      snapshot: current,
      receipt: { schemaVersion: RECEIPT_SCHEMA, status: 'provisional', planId: plan.planId, batchId, validationResult, acceptedPointerAdvanced: false }
    }
  }
  const expectedSamplePaths = [...plan.samplePaths].sort()
  const observedSamplePaths = Array.isArray(sampleOracle?.samplePaths) ? [...sampleOracle.samplePaths].sort() : []
  const sampleEvidenceComplete = stableStringify(expectedSamplePaths) === stableStringify(observedSamplePaths) &&
    sampleOracle?.checked === expectedSamplePaths.length
  if (!sampleOracle || sampleOracle.status !== 'pass' || sampleOracle.mismatches?.length || !sampleEvidenceComplete) {
    return {
      snapshot: { ...current, status: 'stale' },
      receipt: { schemaVersion: RECEIPT_SCHEMA, status: 'invalid', planId: plan.planId, batchId, validationResult, sampleOracle, acceptedPointerAdvanced: false, fullRequired: true }
    }
  }
  const inventoryByPath = new Map(inventory.records.map(record => [record.path, record]))
  const candidatesByPath = new Map(candidateRecords.map(record => [record.path, record]))
  const missing = batch.paths.filter(relativePath => !candidatesByPath.has(relativePath))
  if (missing.length) throw new ProjectKnowledgeError('KNOWLEDGE_BATCH_RECORD_MISSING', `candidate records missing: ${missing.join(', ')}`)
  const recordMap = new Map(current.records.map(record => [record.path, record]))
  for (const relativePath of batch.paths) {
    recordMap.set(relativePath, normalizeCandidateRecord(candidatesByPath.get(relativePath), inventoryByPath.get(relativePath), plan.lens))
  }
  const tombstones = new Map(current.tombstones.map(item => [item.path, item]))
  for (const operation of batch.operations || []) {
    if (operation.type === 'delete') {
      recordMap.delete(operation.path)
      tombstones.set(operation.path, { path: operation.path, reason: 'deleted', planId: plan.planId })
    } else if (operation.type === 'rename') {
      recordMap.delete(operation.from)
      tombstones.set(operation.from, { path: operation.from, reason: 'renamed', renamedTo: operation.to, planId: plan.planId })
    }
  }
  const acceptedBatchIds = [...new Set([...progress.acceptedBatchIds, batchId])].sort()
  const allAccepted = plan.batches.every(item => acceptedBatchIds.includes(item.batchId))
  const priorLensRecord = current.lenses.find(item => item.lensId === plan.lens.lensId)
  const nextLens = normalizeLens({
    ...plan.lens,
    coveragePaths: allAccepted ? inventory.records.map(record => record.path) : [...new Set([...(current.lenses.find(item => item.lensId === plan.lens.lensId)?.coveragePaths || []), ...batch.paths])],
    findingAnchors: [...new Set([
      ...(priorLensRecord?.findingAnchors || []),
      ...findings.map(item => String(item.findingId || item.id || '')).filter(Boolean)
    ])],
    status: allAccepted ? 'accepted' : 'candidate'
  })
  const lenses = current.lenses.filter(item => item.lensId !== nextLens.lensId).concat(nextLens).sort((left, right) => left.lensId.localeCompare(right.lensId))
  const next = {
    ...current,
    repoIdentity,
    inventoryIdentity: inventory.inventoryIdentity,
    inventoryMerkleRoot: inventory.merkleRoot || null,
    knowledgeBinding: plan.knowledgeBinding,
    records: [...recordMap.values()].sort((left, right) => left.path.localeCompare(right.path)),
    tombstones: [...tombstones.values()].sort((left, right) => left.path.localeCompare(right.path)),
    impactGraph: normalizeGraph(graph.edges ? graph : current.impactGraph),
    lenses,
    planProgress: { ...current.planProgress, [plan.planId]: { acceptedBatchIds, completed: allAccepted } },
    pendingPlan: allAccepted ? null : plan,
    status: allAccepted ? 'accepted' : 'partial'
  }
  const snapshotCore = { ...next, snapshotIdentity: null }
  next.snapshotIdentity = buildJsonContentIdentity({ sourceKey: `project-knowledge/${repoIdentity.repoId}`, value: snapshotCore, contractVersion: POLICY_VERSION }).identity
  return {
    snapshot: next,
    receipt: {
      schemaVersion: RECEIPT_SCHEMA,
      status: 'accepted',
      planId: plan.planId,
      batchId,
      actualRead: [...batch.paths],
      reused: [...plan.reusedPaths],
      invalidated: [...plan.changed],
      sampleOracle,
      validationResult,
      acceptedPointerAdvanced: true,
      acceptedBatchIds,
      allBatchesAccepted: allAccepted,
      nextBatchId: plan.batches.find(item => !acceptedBatchIds.includes(item.batchId))?.batchId || null
    }
  }
}

function bootstrapProjectKnowledge({ snapshot, inventory, repoIdentity, plan, graph = {}, findings = [] }) {
  if (!validatePlanIdentity(plan) || plan.repoIdentity?.repoId !== repoIdentity.repoId || plan.inventoryIdentity?.digest !== inventory.inventoryIdentity.digest) {
    throw new ProjectKnowledgeError('KNOWLEDGE_BOOTSTRAP_PLAN_STALE', 'bootstrap plan does not match the current repo/inventory')
  }
  if (plan.completion === 'blocked' || !inventory.bounded) {
    throw new ProjectKnowledgeError('KNOWLEDGE_BOOTSTRAP_INVENTORY_INCOMPLETE', 'bootstrap requires a complete bounded inventory')
  }
  const observation = observeProjectKnowledge({ inventory, plan, lens: plan.lens })
  const candidateByPath = new Map(observation.candidateRecords.map(record => [record.path, record]))
  const sampleOracle = verifyReuseSample({
    samplePaths: plan.samplePaths,
    snapshotRecords: snapshot?.records || [],
    observedRecords: observation.sampleRecords
  })
  if (sampleOracle.status !== 'pass') {
    return {
      schemaVersion: 'ProjectKnowledgeBootstrapResultV1',
      status: 'invalid',
      snapshot,
      observation,
      receipts: [],
      sampleOracle,
      acceptedPointerAdvanced: false,
      fullRequired: true
    }
  }
  let nextSnapshot = snapshot
  const receipts = []
  for (const batch of plan.batches) {
    const candidateRecords = batch.paths.map(relativePath => candidateByPath.get(relativePath)).filter(Boolean)
    const validationResult = {
      schemaVersion: 'BatchValidationResultV1',
      status: candidateRecords.length === batch.paths.length && candidateRecords.every(record =>
        record.semanticClaims.length > 0 && record.semanticClaims.every(claim => {
          const inventoryRecord = inventory.records.find(item => item.path === record.path)
          return validateSemanticClaim(claim, inventoryRecord)
        })
      ) ? 'pass' : 'fail',
      route: 'deterministic-content-observation',
      claimBoundary: observation.claimBoundary,
      bindingIdentity: plan.knowledgeBinding.bindingIdentity
    }
    const accepted = acceptKnowledgeBatch({
      snapshot: nextSnapshot,
      inventory,
      repoIdentity,
      plan,
      batchId: batch.batchId,
      candidateRecords,
      validationResult,
      sampleOracle,
      graph,
      findings
    })
    if (accepted.receipt.status !== 'accepted') {
      return {
        schemaVersion: 'ProjectKnowledgeBootstrapResultV1',
        status: accepted.receipt.status,
        snapshot,
        observation,
        receipts: [...receipts, accepted.receipt],
        sampleOracle,
        acceptedPointerAdvanced: false,
        fullRequired: accepted.receipt.fullRequired === true
      }
    }
    nextSnapshot = accepted.snapshot
    receipts.push(accepted.receipt)
  }
  return {
    schemaVersion: 'ProjectKnowledgeBootstrapResultV1',
    status: plan.batches.length ? 'accepted' : 'unchanged',
    snapshot: nextSnapshot,
    observation,
    receipts,
    sampleOracle,
    acceptedPointerAdvanced: plan.batches.length > 0,
    globalValidation: {
      schemaVersion: 'GlobalValidationResultV1',
      status: 'pass',
      batchesChecked: receipts.length,
      recordsChecked: observation.candidateRecords.length,
      bindingIdentity: plan.knowledgeBinding.bindingIdentity
    }
  }
}

function synthesizeGlobalBacklog({ plan, receipts = [], findings = [], globalValidation }) {
  const accepted = new Set(receipts.filter(receipt => receipt.status === 'accepted').map(receipt => receipt.batchId))
  const complete = plan.batches.every(batch => accepted.has(batch.batchId)) && globalValidation?.status === 'pass'
  const rank = { high: 0, medium: 1, low: 2 }
  const unique = new Map()
  for (const finding of findings) {
    const id = String(finding.findingId || finding.id || '').trim()
    if (!id || !['high', 'medium', 'low'].includes(finding.priority)) continue
    if (!unique.has(id)) unique.set(id, { ...finding, findingId: id })
  }
  return {
    schemaVersion: BACKLOG_SCHEMA,
    status: complete ? 'final' : 'provisional',
    items: [...unique.values()].sort((left, right) => rank[left.priority] - rank[right.priority] || left.findingId.localeCompare(right.findingId)),
    batchCoverage: { accepted: accepted.size, total: plan.batches.length },
    globalValidation: globalValidation || { status: 'unverified' },
    completionClaimAllowed: complete
  }
}

function knowledgeSnapshotRelativePath(repoId, version = 'v2') {
  if (!/^[a-f0-9]{24}$/.test(String(repoId || ''))) throw new ProjectKnowledgeError('KNOWLEDGE_REPO_ID_INVALID', 'repoId must be 24 lowercase sha256 characters')
  if (!['v1', 'v2'].includes(version)) throw new ProjectKnowledgeError('KNOWLEDGE_SCHEMA_PATH_INVALID', `unsupported knowledge path version: ${version}`)
  return `.runtime-state/project-knowledge/${version}/${repoId}/snapshot.json`
}

function knowledgeSnapshotStoreRelativePath(repoId, version = 'v2') {
  return knowledgeSnapshotRelativePath(repoId, version).replace(/^\.runtime-state[\\/]/, '')
}

function readKnowledgeSnapshot(activeRoot, repoId) {
  const store = createRuntimeStateStore({
    activeRoot,
    relativePath: knowledgeSnapshotStoreRelativePath(repoId),
    maxBytes: 32 * 1024 * 1024,
    maxWrites: 0
  })
  const receipt = store.read()
  if (receipt.status === 'fresh' && !validateSnapshotIdentity(receipt.value)) {
    return { ...receipt, status: 'invalid', errorCode: 'KNOWLEDGE_SNAPSHOT_IDENTITY_INVALID' }
  }
  if (receipt.status !== 'missing') return receipt
  const legacyStore = createRuntimeStateStore({
    activeRoot,
    relativePath: knowledgeSnapshotStoreRelativePath(repoId, 'v1'),
    maxBytes: 32 * 1024 * 1024,
    maxWrites: 0
  })
  const legacyReceipt = legacyStore.read()
  if (legacyReceipt.status === 'fresh' && validateLegacySnapshotIdentity(legacyReceipt.value)) {
    return {
      ...legacyReceipt,
      status: 'compatibility-v1',
      reuseAllowed: false,
      migrationRequired: true,
      errorCode: 'KNOWLEDGE_V1_READ_ONLY'
    }
  }
  if (legacyReceipt.status === 'fresh') return { ...legacyReceipt, status: 'invalid', errorCode: 'KNOWLEDGE_V1_IDENTITY_INVALID' }
  return receipt
}

function persistAcceptedKnowledge({ activeRoot, taskRoot, runId, plan, snapshot, receipt }) {
  if (receipt.status !== 'accepted') throw new ProjectKnowledgeError('KNOWLEDGE_PERSIST_UNACCEPTED', 'only accepted batches may update the knowledge store')
  if (!validatePlanIdentity(plan) || !validateSnapshotIdentity(snapshot)) {
    throw new ProjectKnowledgeError('KNOWLEDGE_PERSIST_IDENTITY_INVALID', 'plan/snapshot identity must be valid before persistence')
  }
  const safeRunId = String(runId || plan.planId).replace(/[^a-zA-Z0-9._-]/g, '-')
  const artifactBase = `artifacts/knowledge-snapshot/${safeRunId}`
  const artifactWrites = []
  for (const [name, value] of [['plan.json', plan], ['receipt.json', receipt], ['snapshot.json', snapshot]]) {
    const store = createDerivedStateStore({ root: taskRoot, relativePath: `${artifactBase}/${name}`, maxBytes: 32 * 1024 * 1024, maxWrites: 1 })
    const written = store.write(value)
    if (written.status !== 'persisted') throw new ProjectKnowledgeError('KNOWLEDGE_ARTIFACT_WRITE_FAILED', JSON.stringify(written))
    artifactWrites.push(written.filePath)
  }
  const runtimeStore = createRuntimeStateStore({
    activeRoot,
    relativePath: knowledgeSnapshotStoreRelativePath(snapshot.repoIdentity.repoId),
    maxBytes: 32 * 1024 * 1024,
    maxWrites: 1
  })
  const runtimeWrite = runtimeStore.write(snapshot)
  if (runtimeWrite.status !== 'persisted') throw new ProjectKnowledgeError('KNOWLEDGE_RUNTIME_WRITE_FAILED', JSON.stringify(runtimeWrite))
  return {
    schemaVersion: 'ProjectKnowledgePersistReceiptV2',
    runtimeWrite,
    artifactWrites,
    acceptedPointerAdvanced: true,
    transactionBoundary: 'artifact-preflight-and-writes-before-single-runtime-pointer-advance'
  }
}

module.exports = {
  BACKLOG_SCHEMA,
  BINDING_SCHEMA,
  FILE_RECORD_SCHEMA,
  IMPACT_GRAPH_SCHEMA,
  LENS_RECORD_SCHEMA,
  PLAN_SCHEMA,
  POLICY_VERSION,
  ProjectKnowledgeError,
  RECEIPT_SCHEMA,
  SEMANTIC_CLAIM_SCHEMA,
  SNAPSHOT_SCHEMA,
  acceptKnowledgeBatch,
  buildFileRecord,
  buildImpactGraphFromInventory,
  buildKnowledgeBinding,
  buildIncrementalAnalysisPlan,
  buildInventoryFromFiles,
  buildRepoIdentity,
  createSnapshot,
  detectDelta,
  factDigest,
  inferKind,
  knowledgeSnapshotRelativePath,
  normalizeGraph,
  normalizeLens,
  observeFileRecord,
  observeProjectKnowledge,
  bootstrapProjectKnowledge,
  persistAcceptedKnowledge,
  readKnowledgeSnapshot,
  scanProjectInventory,
  selectDeterministicReuseSample,
  synthesizeGlobalBacklog,
  validatePlanIdentity,
  validateSemanticClaim,
  validateSnapshotIdentity,
  validateLegacySnapshotIdentity,
  verifyReuseSample
}
