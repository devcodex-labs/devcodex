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

function normalizeSkillIds(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))].sort()
}

function skillPriority(skill) {
  return Number.isInteger(skill?.skillIndex?.priority) ? skill.skillIndex.priority : 100
}

function skillRequires(skill) {
  return normalizeSkillIds(skill?.skillIndex?.requires || skill?.dependencies)
}

function skillConflicts(skill) {
  return normalizeSkillIds(skill?.skillIndex?.conflictsWith || skill?.conflicts)
}

function orderSkillClosure(ids, byId) {
  const selected = new Set(ids)
  const indegree = new Map([...selected].map(id => [id, 0]))
  const outgoing = new Map([...selected].map(id => [id, []]))
  for (const id of selected) {
    for (const dependency of skillRequires(byId.get(id))) {
      if (!selected.has(dependency)) continue
      outgoing.get(dependency).push(id)
      indegree.set(id, indegree.get(id) + 1)
    }
  }
  const compare = (left, right) => skillPriority(byId.get(left)) - skillPriority(byId.get(right)) || left.localeCompare(right)
  const ready = [...selected].filter(id => indegree.get(id) === 0).sort(compare)
  const ordered = []
  while (ready.length) {
    const id = ready.shift()
    ordered.push(id)
    for (const dependent of outgoing.get(id).sort(compare)) {
      indegree.set(dependent, indegree.get(dependent) - 1)
      if (indegree.get(dependent) === 0) {
        ready.push(dependent)
        ready.sort(compare)
      }
    }
  }
  return ordered.length === selected.size ? ordered : []
}

function buildBundleStages(selected, budget) {
  if (!selected.length) return []
  const stages = []
  let current = []
  let bytes = 0
  let tokens = 0
  const flush = () => {
    if (!current.length) return
    stages.push({ index: stages.length + 1, skillIds: current.map(item => item.id), bytes, tokens: budget.tokens.status === 'enforced' ? tokens : null })
    current = []
    bytes = 0
    tokens = 0
  }
  for (const item of selected) {
    const exceedsSkills = budget.maxSkills !== null && current.length >= budget.maxSkills
    const exceedsBytes = budget.maxBytes !== null && current.length > 0 && bytes + item.sourceBytes > budget.maxBytes
    const exceedsTokens = budget.tokens.status === 'enforced' && current.length > 0 && tokens + item.tokenCount > budget.tokens.limit
    if (exceedsSkills || exceedsBytes || exceedsTokens) flush()
    current.push(item)
    bytes += item.sourceBytes
    tokens += item.tokenCount || 0
  }
  flush()
  return stages.map(stage => ({
    ...stage,
    overBudgetSingle: stage.skillIds.length === 1 && (
      (budget.maxBytes !== null && stage.bytes > budget.maxBytes) ||
      (budget.tokens.status === 'enforced' && stage.tokens > budget.tokens.limit)
    )
  }))
}

function createBudgetDecisionV1(input = {}) {
  const maxBytes = Number.isInteger(input.maxBytes) && input.maxBytes > 0 ? input.maxBytes : null
  const maxTokens = Number.isInteger(input.maxTokens) && input.maxTokens > 0 ? input.maxTokens : null
  const completion = typeof input.completion === 'string' ? input.completion : 'unknown'
  const budgetStatus = typeof input.budgetStatus === 'string' ? input.budgetStatus : 'unknown'
  const enterpriseCompleteFlow = input.enterpriseCompleteFlow === true
  let enforcementStatus = 'not-requested'
  let fallbackReason = maxBytes === null ? 'maxBytes-not-requested' : null

  if (completion === 'fallback-full') {
    enforcementStatus = 'fallback-full'
    fallbackReason = input.fallbackReason || 'full-skill-read'
  } else if (completion === 'blocked' || budgetStatus === 'over-budget-mandatory') {
    enforcementStatus = 'blocked'
    fallbackReason = budgetStatus === 'over-budget-mandatory' ? 'mandatory-over-budget' : 'bundle-blocked'
  } else if (maxBytes !== null) {
    enforcementStatus = 'enforced'
    fallbackReason = null
  }

  const optimizedHit = enforcementStatus === 'enforced' && budgetStatus === 'within-limit' && completion === 'complete'
  const warnings = []
  if (enterpriseCompleteFlow && maxBytes === null) warnings.push('enterprise-complete-maxBytes-missing')
  if (maxTokens === null) warnings.push('maxTokens-not-enforced')

  return {
    schemaVersion: 'BudgetDecisionV1',
    budgetKind: input.budgetKind || 'skill-bundle',
    maxBytes,
    maxTokens,
    enforcementStatus,
    optimizedHit,
    fallbackReason,
    sourceBudgetStatus: budgetStatus,
    sourceCompletion: completion,
    enterpriseCompleteFlow,
    validation: {
      valid: !(optimizedHit && maxBytes === null),
      warnings
    }
  }
}

/** Build a read-only, dependency-closed Skill bundle using whole SKILL.md byte identities. */
function buildBundleDecisionV2(portfolio, input = {}) {
  const skills = Array.isArray(portfolio?.skills) ? portfolio.skills : []
  const byId = new Map(skills.map(skill => [skill.id, skill]))
  const candidateIds = normalizeSkillIds(input.candidateIds)
  const mandatoryIds = input.mandatoryIds === undefined
    ? [...candidateIds]
    : normalizeSkillIds(input.mandatoryIds)
  const roots = [...new Set([...candidateIds, ...mandatoryIds])].sort()
  const mandatoryRoots = new Set(mandatoryIds)
  const includeGray = input.includeGray === true
  const hostCapability = ['bundle-v2', 'native-oracle', 'unsupported'].includes(input.hostCapability)
    ? input.hostCapability
    : 'bundle-v2'
  const maxSkills = Number.isInteger(input.maxSkills) && input.maxSkills > 0 ? input.maxSkills : null
  const maxBytes = Number.isInteger(input.maxBytes) && input.maxBytes > 0 ? input.maxBytes : null
  const tokenCounts = input.tokenCounts && typeof input.tokenCounts === 'object' && !Array.isArray(input.tokenCounts)
    ? input.tokenCounts
    : {}
  const tokenCounterAvailable = input.hostTokenCounter === true
  const maxTokens = tokenCounterAvailable && Number.isInteger(input.maxTokens) && input.maxTokens > 0
    ? input.maxTokens
    : null
  const ignored = []
  const blockers = []
  const closure = new Set()
  const mandatoryClosure = new Set()

  function inspectRoot(root, mandatory) {
    const local = new Set()
    const visiting = new Set()
    let failure = null
    function visit(id, requiredBy) {
      if (visiting.has(id)) {
        failure = { code: 'dependency-cycle', id, requiredBy }
        return
      }
      if (local.has(id) || failure) return
      const skill = byId.get(id)
      if (!skill) {
        failure = { code: 'unknown', id, requiredBy }
        return
      }
      const eligible = skill.lifecycleState === 'active' || (includeGray && skill.lifecycleState === 'gray')
      if (!eligible) {
        failure = { code: 'inactive', id, requiredBy, lifecycleState: skill.lifecycleState }
        return
      }
      if (!String(skill.owner || '').trim()) {
        failure = { code: 'owner-missing', id, requiredBy }
        return
      }
      if (!Number.isInteger(skill.sourceBytes) || skill.sourceBytes < 1) {
        failure = { code: 'source-bytes-missing', id, requiredBy }
        return
      }
      if (!String(skill.source || '').trim() || !String(skill.hash || '').trim()) {
        failure = { code: 'source-metadata-missing', id, requiredBy }
        return
      }
      visiting.add(id)
      for (const dependency of skillRequires(skill)) visit(dependency, id)
      visiting.delete(id)
      if (!failure) local.add(id)
    }
    visit(root, null)
    if (failure) {
      if (mandatory) blockers.push({ ...failure, root, mandatory: true })
      else ignored.push({ id: root, reason: failure.code, details: failure })
      return
    }
    for (const id of local) {
      closure.add(id)
      if (mandatory) mandatoryClosure.add(id)
    }
  }

  for (const root of roots) inspectRoot(root, mandatoryRoots.has(root))
  const closureIds = orderSkillClosure(closure, byId)
  if (closure.size && !closureIds.length) blockers.push({ code: 'dependency-cycle', mandatory: true })

  const excluded = new Set()
  const conflicts = []
  for (let leftIndex = 0; leftIndex < closureIds.length; leftIndex += 1) {
    const left = closureIds[leftIndex]
    for (let rightIndex = leftIndex + 1; rightIndex < closureIds.length; rightIndex += 1) {
      const right = closureIds[rightIndex]
      if (!skillConflicts(byId.get(left)).includes(right) && !skillConflicts(byId.get(right)).includes(left)) continue
      const leftMandatory = mandatoryClosure.has(left)
      const rightMandatory = mandatoryClosure.has(right)
      const conflict = { left, right, leftMandatory, rightMandatory }
      conflicts.push(conflict)
      if (leftMandatory && rightMandatory) {
        blockers.push({ code: 'mandatory-conflict', ...conflict })
        continue
      }
      let loser
      if (leftMandatory) loser = right
      else if (rightMandatory) loser = left
      else {
        const leftKey = [skillPriority(byId.get(left)), left]
        const rightKey = [skillPriority(byId.get(right)), right]
        loser = leftKey[0] < rightKey[0] || (leftKey[0] === rightKey[0] && leftKey[1] < rightKey[1]) ? right : left
      }
      excluded.add(loser)
      ignored.push({ id: loser, reason: 'conflict', conflictWith: loser === left ? right : left })
    }
  }

  let changed = true
  while (changed) {
    changed = false
    for (const id of closureIds) {
      if (excluded.has(id) || mandatoryClosure.has(id)) continue
      const missingDependency = skillRequires(byId.get(id)).find(dependency => excluded.has(dependency))
      if (missingDependency) {
        excluded.add(id)
        ignored.push({ id, reason: 'dependency-conflict', dependency: missingDependency })
        changed = true
      }
    }
  }

  const reachable = new Set()
  function markReachable(id) {
    if (reachable.has(id) || excluded.has(id) || !closure.has(id)) return
    reachable.add(id)
    for (const dependency of skillRequires(byId.get(id))) markReachable(dependency)
  }
  for (const id of mandatoryClosure) markReachable(id)
  for (const id of candidateIds) markReachable(id)
  for (const id of closureIds) {
    if (mandatoryClosure.has(id) || excluded.has(id) || reachable.has(id)) continue
    excluded.add(id)
    ignored.push({ id, reason: 'orphaned-dependency' })
  }

  const tokens = {
    status: maxTokens === null ? 'N/A' : 'enforced',
    limit: maxTokens,
    reason: maxTokens === null
      ? (tokenCounterAvailable ? 'maxTokens-not-requested' : 'host-token-counter-unavailable')
      : null
  }
  if (maxTokens !== null) {
    for (const id of closureIds.filter(id => !excluded.has(id))) {
      if (Number.isInteger(tokenCounts[id]) && tokenCounts[id] >= 0) continue
      if (mandatoryClosure.has(id)) blockers.push({ code: 'token-count-missing', id, mandatory: true })
      else {
        excluded.add(id)
        ignored.push({ id, reason: 'token-count-missing' })
      }
    }
  }

  let resolutionPlan = null
  const resolutionById = new Map()
  if (input.applySkillResolution !== false) {
    try {
      const {
        resolveSkillReadPlan
      } = require('../hooks/_runtime/skill-resolution.cjs')
      const resolveIds = closureIds.filter(id => !excluded.has(id))
      resolutionPlan = resolveSkillReadPlan(resolveIds, {
        cwd: input.cwd || process.cwd(),
        env: input.env,
        skippedByUser: input.skippedByUser === true,
        forceGlobal: input.forceGlobal === true,
        consumerAuthority: 'profile-skill-plan',
        includeContent: true
      })
      for (const trace of resolutionPlan.traces || []) {
        resolutionById.set(trace.skillId, trace)
      }
    } catch (error) {
      resolutionPlan = {
        schemaVersion: 'ResolvedSkillReadPlanV1',
        error: error.message,
        traces: [],
        selected: []
      }
    }
  }

  const itemFor = id => {
    const skill = byId.get(id)
    const trace = resolutionById.get(id)
    const useResolved = trace && (trace.selectedLayer === 'workspace' || trace.selectedLayer === 'global')
    return {
      id,
      reason: candidateIds.includes(id) ? 'candidate' : 'dependency',
      mandatory: mandatoryClosure.has(id),
      priority: skillPriority(skill),
      source: useResolved ? trace.selectedPath : skill.source,
      sourceBytes: useResolved && Number.isInteger(trace.contentBytes) ? trace.contentBytes : skill.sourceBytes,
      sourceHash: useResolved && trace.digest ? trace.digest : skill.hash,
      selectedLayer: useResolved ? trace.selectedLayer : 'package',
      securityDecision: trace ? trace.securityDecision : 'not-applicable',
      coversGlobal: trace ? trace.coversGlobal === true : false,
      tokenCount: maxTokens === null || !Number.isInteger(tokenCounts[id]) ? null : tokenCounts[id]
    }
  }
  // W/G resolution is an overlay. The package portfolio remains the fallback
  // identity unless a caller explicitly requires a resolved external Skill.
  const requireResolvedSkills = input.requireResolvedSkills === true
  for (const id of closureIds) {
    if (excluded.has(id) || !mandatoryClosure.has(id)) continue
    const trace = resolutionById.get(id)
    if (requireResolvedSkills && trace && trace.selectedLayer === 'missing') {
      blockers.push({
        code: 'skill-resolution-missing',
        id,
        mandatory: true,
        reasonCode: trace.reasonCode || 'missing'
      })
    }
  }
  const mandatoryItems = closureIds.filter(id => mandatoryClosure.has(id) && !excluded.has(id)).map(itemFor)
  const optionalItems = closureIds.filter(id => !mandatoryClosure.has(id) && !excluded.has(id)).map(itemFor)
  const mandatoryBytes = mandatoryItems.reduce((sum, item) => sum + item.sourceBytes, 0)
  const mandatoryTokens = maxTokens === null
    ? null
    : (mandatoryItems.every(item => Number.isInteger(item.tokenCount))
        ? mandatoryItems.reduce((sum, item) => sum + item.tokenCount, 0)
        : null)
  const overBudgetMandatory = (maxSkills !== null && mandatoryItems.length > maxSkills) ||
    (maxBytes !== null && mandatoryBytes > maxBytes) ||
    (maxTokens !== null && mandatoryTokens !== null && mandatoryTokens > maxTokens)
  const selected = [...mandatoryItems]
  let usedBytes = mandatoryBytes
  let usedTokens = mandatoryTokens || 0
  if (!overBudgetMandatory && blockers.length === 0) {
    for (const item of optionalItems) {
      const dependenciesReady = skillRequires(byId.get(item.id)).every(dependency => selected.some(selectedItem => selectedItem.id === dependency))
      const fits = dependenciesReady &&
        (maxSkills === null || selected.length + 1 <= maxSkills) &&
        (maxBytes === null || usedBytes + item.sourceBytes <= maxBytes) &&
        (maxTokens === null || usedTokens + item.tokenCount <= maxTokens)
      if (!fits) {
        ignored.push({ id: item.id, reason: dependenciesReady ? 'budget' : 'dependency-budget' })
        continue
      }
      selected.push(item)
      usedBytes += item.sourceBytes
      usedTokens += item.tokenCount || 0
    }
  } else {
    for (const item of optionalItems) ignored.push({ id: item.id, reason: 'budget' })
  }

  const budget = {
    maxSkills,
    maxBytes,
    tokens,
    mandatory: { skills: mandatoryItems.length, bytes: mandatoryBytes, tokens: mandatoryTokens },
    selected: { skills: selected.length, bytes: selected.reduce((sum, item) => sum + item.sourceBytes, 0), tokens: maxTokens === null ? null : selected.reduce((sum, item) => sum + item.tokenCount, 0) },
    status: overBudgetMandatory ? 'over-budget-mandatory' : 'within-limit'
  }
  let completion = blockers.length ? 'blocked' : (overBudgetMandatory ? 'over-budget-mandatory' : 'complete')
  if (completion === 'complete' && hostCapability === 'unsupported') completion = 'fallback-full'
  const fallback = hostCapability === 'unsupported' && !blockers.length
    ? { required: true, route: 'full-skill-read', reason: 'host-bundle-capability-unavailable' }
    : { required: false, route: null, reason: null }
  const budgetDecision = createBudgetDecisionV1({
    budgetKind: input.budgetKind || 'skill-bundle',
    maxBytes,
    maxTokens,
    completion,
    budgetStatus: budget.status,
    enterpriseCompleteFlow: input.enterpriseCompleteFlow === true,
    fallbackReason: fallback.reason
  })
  return {
    schemaVersion: 'BundleDecisionV2',
    portfolioSchemaVersion: portfolio?.schemaVersion || null,
    candidates: candidateIds,
    mandatoryIds,
    closure: closureIds,
    selected: blockers.length ? [] : selected,
    ignored: ignored.sort((left, right) => left.id.localeCompare(right.id) || left.reason.localeCompare(right.reason)),
    conflicts,
    blockers,
    budget,
    budgetDecision,
    stages: blockers.length ? [] : buildBundleStages(selected, budget),
    completion,
    hostCapability,
    fallback,
    resolutionPlan,
    lifecycleMutationAllowed: false,
    writes: [],
    exitCondition: blockers.length
      ? 'blocked'
      : (overBudgetMandatory ? 'read-stages-in-order' : (hostCapability === 'unsupported' ? 'fallback-full-skill-read' : 'bundle-ready'))
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
  buildBundleDecisionV2,
  createBudgetDecisionV1,
  hasFeatureInventorySource,
  inspectProfileLifecycle,
  hasProfileLifecycle,
  inspectProfileContract
}
