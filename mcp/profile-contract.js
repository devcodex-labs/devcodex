'use strict'

const PROFILE_TIERS = new Set(['profile-lite', 'profile-standard', 'profile-closed-loop'])
const PROFILE_BASE_FILES = ['README.md', '01-项目信息.md', '02-架构约束.md', '03-代码风格.md']
const PROFILE_STANDARD_FILES = [...PROFILE_BASE_FILES, '04-测试规范.md', '05-发布规范.md', '06-功能清单.md']
const PROFILE_CLOSED_LOOP_FILES = [...PROFILE_STANDARD_FILES, '07-用户文档与契约规范.md']
const PROFILE_DEFAULT_FILES = [...PROFILE_CLOSED_LOOP_FILES, 'config.json', 'config.local.json']
const PROFILE_RELEASE_FILES = ['05-发布规范.md', '05-交付发布规范.md']
const PROFILE_TIER_ORDER = Object.freeze(['profile-lite', 'profile-standard', 'profile-closed-loop'])
const FEATURE_INVENTORY_LEGACY_SCHEMA_VERSION = 'FeatureInventorySchemaV1'
const FEATURE_INVENTORY_SCHEMA_VERSION = 'FeatureInventorySchemaV2'
const FEATURE_INVENTORY_V1_COLUMNS = Object.freeze([
  'featureId',
  'capabilityGroup',
  'publicSurface',
  'configEntrypoint',
  'primaryConsumers',
  'docsEntrypoint',
  'validationRoute',
  'sourceEvidence',
  'maintenanceOwner',
  'releaseState'
])
const FEATURE_INVENTORY_COLUMNS = Object.freeze([
  ...FEATURE_INVENTORY_V1_COLUMNS,
  'lifecycleState',
  'evidenceState',
  'asOf',
  'evidenceRefs'
])
const FEATURE_INVENTORY_COLUMN_LABELS = Object.freeze({
  featureId: '能力 ID',
  capabilityGroup: '能力组',
  publicSurface: '公开面',
  configEntrypoint: '配置入口',
  primaryConsumers: '主要消费者',
  docsEntrypoint: '文档入口',
  validationRoute: '验证路线',
  sourceEvidence: '事实来源',
  maintenanceOwner: '维护责任',
  releaseState: '发布状态',
  lifecycleState: '生命周期状态',
  evidenceState: '证据状态',
  asOf: '证据日期',
  evidenceRefs: '证据引用'
})
const FEATURE_LIFECYCLE_STATES = new Set(['planned', 'implemented', 'validated', 'released', 'historical'])
const FEATURE_EVIDENCE_STATES = new Set(['unverified', 'source-backed', 'validated'])
const PROFILE_GENERATION_CONTRACT = Object.freeze({
  version: 2,
  tiers: Object.freeze({
    'profile-lite': Object.freeze({
      requiredFiles: Object.freeze([...PROFILE_BASE_FILES]),
      defaultGeneratedFiles: Object.freeze([...PROFILE_BASE_FILES, 'config.json']),
      semanticChecks: Object.freeze(['tier-declaration']),
      optionalFiles: Object.freeze(['config.local.json', '08-*', '09-*'])
    }),
    'profile-standard': Object.freeze({
      requiredFiles: Object.freeze([...PROFILE_BASE_FILES, '04-测试规范.md', '05-release']),
      defaultGeneratedFiles: Object.freeze([...PROFILE_STANDARD_FILES, 'config.json']),
      semanticChecks: Object.freeze(['tier-declaration', 'feature-inventory-source']),
      optionalFiles: Object.freeze(['config.local.json', '07-用户文档与契约规范.md', '08-*', '09-*'])
    }),
    'profile-closed-loop': Object.freeze({
      requiredFiles: Object.freeze([...PROFILE_CLOSED_LOOP_FILES]),
      defaultGeneratedFiles: Object.freeze([...PROFILE_CLOSED_LOOP_FILES, 'config.json']),
      semanticChecks: Object.freeze(['tier-declaration', 'feature-inventory-schema', 'profile-lifecycle']),
      optionalFiles: Object.freeze(['config.local.json', '08-*', '09-*'])
    })
  }),
  featureInventory: Object.freeze({
    version: FEATURE_INVENTORY_SCHEMA_VERSION,
    columns: FEATURE_INVENTORY_COLUMNS,
    labels: FEATURE_INVENTORY_COLUMN_LABELS,
    canonicalFile: '06-功能清单.md'
  })
})

function normalizeProfileTier(value, fallback = 'profile-lite') {
  const tier = String(value || '').trim().toLowerCase()
  if (PROFILE_TIERS.has(tier)) return tier
  if (fallback && PROFILE_TIERS.has(fallback)) return fallback
  throw new Error(`invalid profile tier: ${value}`)
}

function extractProfileTierDeclarations(contents) {
  const text = String(contents || '')
  return [...text.matchAll(/Profile\s*(?:档位|tier)[^\r\n]*?\b(profile-(?:lite|standard|closed-loop))\b/gi)]
    .map(match => match[1].toLowerCase())
}

function detectProfileTier(contents, fallback = 'profile-lite') {
  const text = String(contents || '')
  const declarations = extractProfileTierDeclarations(text)
  const declared = [...new Set(declarations)]
  if (declared.length > 1) throw new Error(`multiple profile tiers declared: ${declared.join(', ')}`)
  if (declared.length === 1) return normalizeProfileTier(declared[0], fallback)

  const matches = [...text.matchAll(/\bprofile-(?:lite|standard|closed-loop)\b/g)].map(match => match[0])
  const unique = [...new Set(matches)]
  if (unique.length > 1) throw new Error(`multiple profile tiers declared: ${unique.join(', ')}`)
  return normalizeProfileTier(unique[0], fallback)
}

function filesForProfileTier(tier, { includeConfig = true } = {}) {
  const normalized = normalizeProfileTier(tier)
  const files = PROFILE_GENERATION_CONTRACT.tiers[normalized].defaultGeneratedFiles
  return includeConfig ? [...files] : files.filter(file => file !== 'config.json')
}

function hasFeatureInventorySource(files, corpus) {
  if (files.has('06-功能清单.md')) return true
  return /(?:Feature inventory source|功能清单来源)\s*[：:]\s*`?([^`\r\n]+\.md)`?/i.test(String(corpus || ''))
}

function compareProfileTiers(left, right) {
  return PROFILE_TIER_ORDER.indexOf(normalizeProfileTier(left)) - PROFILE_TIER_ORDER.indexOf(normalizeProfileTier(right))
}

function updateProfileTierDeclaration(contents, tier) {
  const normalized = normalizeProfileTier(tier)
  const text = String(contents || '')
  const pattern = /(Profile\s*(?:档位|tier)\s*[：:]\s*`?)profile-(?:lite|standard|closed-loop)(`?)/i
  if (pattern.test(text)) return text.replace(pattern, `$1${normalized}$2`)
  const lines = text.split(/\r?\n/)
  const insertAt = lines[0]?.startsWith('#') ? 1 : 0
  lines.splice(insertAt, 0, '', `> Profile 档位：\`${normalized}\`。`)
  return lines.join('\n')
}

function splitMarkdownRow(line) {
  const trimmed = String(line || '').trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return []
  return trimmed.slice(1, -1)
    .replace(/\\\|/g, '\u0000')
    .split('|')
    .map(cell => cell.replace(/\u0000/g, '|').trim())
}

function parseMarkdownTables(markdown) {
  const lines = String(markdown || '').split(/\r?\n/)
  const tables = []
  for (let index = 0; index < lines.length - 1; index++) {
    const headers = splitMarkdownRow(lines[index])
    const divider = splitMarkdownRow(lines[index + 1])
    if (!headers.length || headers.length !== divider.length) continue
    if (!divider.every(cell => /^:?-{3,}:?$/.test(cell))) continue
    const rows = []
    let cursor = index + 2
    while (cursor < lines.length) {
      const cells = splitMarkdownRow(lines[cursor])
      if (!cells.length || cells.length !== headers.length) break
      rows.push(cells)
      cursor++
    }
    tables.push({ headers, rows, line: index + 1 })
    index = cursor - 1
  }
  return tables
}

function projectFeatureInventoryState(schemaVersion, rows) {
  if (schemaVersion !== FEATURE_INVENTORY_SCHEMA_VERSION) {
    return {
      schemaVersion,
      featureCount: rows.length,
      lifecycleCounts: { unknown: rows.length },
      evidenceCounts: { unverified: rows.length },
      evidenceState: 'unverified',
      asOf: null
    }
  }
  if (!rows.length) {
    return {
      schemaVersion,
      featureCount: 0,
      lifecycleCounts: {},
      evidenceCounts: { unverified: 0 },
      evidenceState: 'unverified',
      asOf: null
    }
  }
  const lifecycleCounts = {}
  const evidenceCounts = {}
  for (const row of rows) {
    lifecycleCounts[row.lifecycleState] = (lifecycleCounts[row.lifecycleState] || 0) + 1
    evidenceCounts[row.evidenceState] = (evidenceCounts[row.evidenceState] || 0) + 1
  }
  const dates = rows.map(row => row.asOf).filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value)).sort()
  const evidenceState = rows.some(row => row.evidenceState === 'unverified')
    ? 'unverified'
    : (rows.length > 0 && rows.every(row => row.evidenceState === 'validated') ? 'validated' : 'source-backed')
  return {
    schemaVersion,
    featureCount: rows.length,
    lifecycleCounts,
    evidenceCounts,
    evidenceState,
    asOf: dates.length ? dates[dates.length - 1] : null
  }
}

function inspectFeatureInventoryDocument(markdown, { requireV1 = false, requireV2 = false } = {}) {
  const text = String(markdown || '')
  const tables = parseMarkdownTables(text)
  const v1Labels = FEATURE_INVENTORY_V1_COLUMNS.map(key => FEATURE_INVENTORY_COLUMN_LABELS[key])
  const v2Labels = FEATURE_INVENTORY_COLUMNS.map(key => FEATURE_INVENTORY_COLUMN_LABELS[key])
  const v2Table = tables.find(candidate => v2Labels.every(label => candidate.headers.includes(label)))
  const v1Table = tables.find(candidate => v1Labels.every(label => candidate.headers.includes(label)))
  const declaresV2 = text.includes(FEATURE_INVENTORY_SCHEMA_VERSION)
  const declaresV1 = text.includes(FEATURE_INVENTORY_LEGACY_SCHEMA_VERSION)
  const table = v2Table || v1Table
  const schemaVersion = v2Table ? FEATURE_INVENTORY_SCHEMA_VERSION : FEATURE_INVENTORY_LEGACY_SCHEMA_VERSION
  const errors = []
  if ((requireV2 || declaresV2) && !v2Table) {
    errors.push(`feature inventory must contain ${FEATURE_INVENTORY_SCHEMA_VERSION} columns: ${v2Labels.join(' | ')}`)
  } else if ((requireV1 || declaresV1) && !table) {
    errors.push(`feature inventory must contain columns: ${v1Labels.join(' | ')}`)
  }
  if (!table) {
    const legacyHeaderGroups = [
      /^(能力|能力组|Feature|Capability)$/i,
      /^(公开面|当前口径|Public Surface|Current Contract)$/i,
      /^(消费者|主要消费者|主要证据|Consumer|Consumers|Evidence)$/i,
      /^(验证路线|Validation Route)$/i
    ]
    const legacyTable = tables.find(candidate => legacyHeaderGroups.every(pattern => candidate.headers.some(header => pattern.test(header))))
    if (!legacyTable && !errors.length) errors.push('feature inventory requires a structured Markdown table with capability, public surface, consumers and validation route columns')
    const validRows = legacyTable
      ? legacyTable.rows.filter(cells => cells.every(value => value.trim()) && !cells.some(value => /^(待补充|待维护者补充|todo|tbd)$/i.test(value.trim())))
      : []
    if (legacyTable && !validRows.length) errors.push('feature inventory requires at least one non-placeholder row')
    return {
      schemaVersion: declaresV2 ? FEATURE_INVENTORY_SCHEMA_VERSION : (declaresV1 ? FEATURE_INVENTORY_LEGACY_SCHEMA_VERSION : 'legacy'),
      valid: !!legacyTable && errors.length === 0,
      headers: legacyTable ? legacyTable.headers : [],
      rows: legacyTable ? legacyTable.rows : [],
      validRows,
      errors,
      projection: projectFeatureInventoryState('legacy', validRows)
    }
  }

  const columns = schemaVersion === FEATURE_INVENTORY_SCHEMA_VERSION ? FEATURE_INVENTORY_COLUMNS : FEATURE_INVENTORY_V1_COLUMNS
  const rows = table.rows.map(cells => Object.fromEntries(columns.map(key => [key, cells[table.headers.indexOf(FEATURE_INVENTORY_COLUMN_LABELS[key])] || ''])))
  const validRows = rows.filter(row => {
    const values = Object.values(row).map(value => value.trim())
    if (values.some(value => !value)) return false
    if (/^(待补充|待维护者补充|todo|tbd)$/i.test(row.featureId)) return false
    if (!/package\.json|plugin\.json|scripts\/|mcp\/|hooks\/|skills\/|instructions\/|prompts\/|changelogs\/|index\.js|README\.md|website\/|unverified|待人工确认/i.test(row.sourceEvidence)) return false
    if (schemaVersion === FEATURE_INVENTORY_SCHEMA_VERSION) {
      if (!FEATURE_LIFECYCLE_STATES.has(row.lifecycleState)) return false
      if (!FEATURE_EVIDENCE_STATES.has(row.evidenceState)) return false
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.asOf)) return false
      if (!row.evidenceRefs.trim()) return false
    }
    return true
  })
  if (!validRows.length) errors.push('feature inventory requires at least one non-placeholder row with source evidence')
  if (schemaVersion === FEATURE_INVENTORY_SCHEMA_VERSION) {
    rows.forEach((row, index) => {
      if (!FEATURE_LIFECYCLE_STATES.has(row.lifecycleState)) errors.push(`feature inventory row ${index + 1} has invalid lifecycleState: ${row.lifecycleState || '(missing)'}`)
      if (!FEATURE_EVIDENCE_STATES.has(row.evidenceState)) errors.push(`feature inventory row ${index + 1} has invalid evidenceState: ${row.evidenceState || '(missing)'}`)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.asOf)) errors.push(`feature inventory row ${index + 1} has invalid asOf: ${row.asOf || '(missing)'}`)
      if (!row.evidenceRefs.trim()) errors.push(`feature inventory row ${index + 1} is missing evidenceRefs`)
    })
  }
  return {
    schemaVersion,
    valid: errors.length === 0,
    headers: table.headers,
    rows,
    validRows,
    errors,
    projection: projectFeatureInventoryState(schemaVersion, validRows)
  }
}

function inspectProfileLifecycle(corpus) {
  const text = String(corpus || '')
  const result = {
    stableBaseline: /\bstable[\s-]+baseline\b|稳定基线/i.test(text),
    livingDocument: /\bliving[\s-]+documents?\b|活文档/i.test(text),
    conditionalOrLocalDocs: /\bconditional(?:-required)?\s*(?:(?:\/|or|and)\s*)?local\s+docs?\b|条件(?:必需)?\s*(?:\/|或|和)\s*本地文档/i.test(text)
  }
  const missing = []
  if (!result.stableBaseline) missing.push('stable-baseline')
  if (!result.livingDocument) missing.push('living-document')
  if (!result.conditionalOrLocalDocs) missing.push('conditional-or-local-docs')
  return {
    ...result,
    missing,
    valid: missing.length === 0
  }
}

function hasProfileLifecycle(corpus) {
  return inspectProfileLifecycle(corpus).valid
}

function inspectProfileContract(tier, availableFiles, corpus = '', documents = {}) {
  const normalized = normalizeProfileTier(tier)
  const files = availableFiles instanceof Set ? availableFiles : new Set(availableFiles || [])
  const inventory = documents['06-功能清单.md']
    ? inspectFeatureInventoryDocument(documents['06-功能清单.md'])
    : null
  const requiredChecks = PROFILE_BASE_FILES.map(file => ({ key: file, pass: files.has(file) }))
  const semanticChecks = [{ key: 'tier-declaration', pass: new Set(extractProfileTierDeclarations(corpus)).size === 1 }]

  if (normalized !== 'profile-lite') {
    requiredChecks.push({ key: '04-测试规范.md', pass: files.has('04-测试规范.md') })
    requiredChecks.push({ key: '05-release', pass: PROFILE_RELEASE_FILES.some(file => files.has(file)) })
    semanticChecks.push({ key: 'feature-inventory-source', pass: hasFeatureInventorySource(files, corpus) })
  }
  if (normalized === 'profile-closed-loop') {
    requiredChecks.push({ key: '06-功能清单.md', pass: files.has('06-功能清单.md') })
    requiredChecks.push({ key: '07-用户文档与契约规范.md', pass: files.has('07-用户文档与契约规范.md') })
    semanticChecks.push({ key: 'feature-inventory-schema', pass: inspectFeatureInventoryDocument(documents['06-功能清单.md'] || '', { requireV1: true }).valid })
    semanticChecks.push({ key: 'profile-lifecycle', pass: hasProfileLifecycle(corpus) })
  }

  const configCheck = { key: 'config.json', pass: files.has('config.json') }
  const checks = [...requiredChecks, ...semanticChecks]

  return {
    tier: normalized,
    present: checks.filter(check => check.pass).length,
    total: checks.length,
    complete: checks.every(check => check.pass),
    missing: checks.filter(check => !check.pass).map(check => check.key),
    required: {
      present: requiredChecks.filter(check => check.pass).length,
      total: requiredChecks.length,
      missing: requiredChecks.filter(check => !check.pass).map(check => check.key)
    },
    semantic: {
      present: semanticChecks.filter(check => check.pass).length,
      total: semanticChecks.length,
      missing: semanticChecks.filter(check => !check.pass).map(check => check.key)
    },
    config: configCheck,
    featureInventory: inventory
      ? { valid: inventory.valid, errors: inventory.errors, ...inventory.projection }
      : null
  }
}

module.exports = {
  PROFILE_TIERS,
  PROFILE_BASE_FILES,
  PROFILE_STANDARD_FILES,
  PROFILE_CLOSED_LOOP_FILES,
  PROFILE_DEFAULT_FILES,
  PROFILE_RELEASE_FILES,
  PROFILE_TIER_ORDER,
  PROFILE_GENERATION_CONTRACT,
  FEATURE_INVENTORY_LEGACY_SCHEMA_VERSION,
  FEATURE_INVENTORY_SCHEMA_VERSION,
  FEATURE_INVENTORY_V1_COLUMNS,
  FEATURE_INVENTORY_COLUMNS,
  FEATURE_INVENTORY_COLUMN_LABELS,
  normalizeProfileTier,
  extractProfileTierDeclarations,
  detectProfileTier,
  filesForProfileTier,
  compareProfileTiers,
  updateProfileTierDeclaration,
  parseMarkdownTables,
  inspectFeatureInventoryDocument,
  projectFeatureInventoryState,
  hasFeatureInventorySource,
  inspectProfileLifecycle,
  hasProfileLifecycle,
  inspectProfileContract
}
