'use strict'

const PHASE_RULES = {
  CP1: {
    requiredFields: [
      'phaseKind',
      'CandidateReviewBundleV1',
      'RQMatrix',
      'DomainRealityMatrix',
      'ClaimEvidenceMatrix',
      'EscapeAbsorptionQueue'
    ]
  },
  CP2: {
    requiredFields: [
      'phaseKind',
      'CandidateReviewBundleV1',
      'TDMatrix',
      'BlockerSnapshot',
      'ClaimEvidenceMatrix'
    ]
  }
}

const MATRIX_CONTRACTS = {
  CP1: {
    RQMatrix: {
      columns: ['dimension', 'status', 'evidence', 'gap', 'disposition', 'skipReason'],
      exactColumns: true,
      requiredRows: Array.from({ length: 8 }, (_, index) => `RQ-${index + 1}`)
    },
    DomainRealityMatrix: {
      columns: ['domain', 'currentReality', 'repoEvidence', 'consumer', 'decision', 'negativeProbe', 'skipReason'],
      exactColumns: true,
      requiredRows: ['sourceTruth', 'packageChannel', 'licensePolicy', 'commandSurface', 'runtimeCapability', 'phaseKind'],
      rowKey: 'domain'
    },
    ClaimEvidenceMatrix: {
      columns: ['claim', 'evidence', 'status'],
      exactColumns: false
    },
    EscapeAbsorptionQueue: {
      columns: ['sourceClaimId', 'finding', 'localEvidence', 'disposition', 'targetArtifact', 'owner', 'status'],
      exactColumns: true
    }
  },
  CP2: {
    TDMatrix: {
      columns: ['dimension', 'priority', 'status', 'evidence', 'blockerId', 'skipReason', 'negativeProbe'],
      exactColumns: true,
      requiredRows: Array.from({ length: 13 }, (_, index) => `TD-${index + 1}`)
    },
    BlockerSnapshot: {
      columns: ['stage', 'blockerId', 'evidence', 'affectedSurface', 'remediation', 'skippedChecks', 'stopReason', 'openBlockers'],
      exactColumns: true,
      objectShape: true
    },
    ClaimEvidenceMatrix: {
      columns: ['claim', 'repoPath', 'currentBehavior', 'targetChange', 'runtimeOwner', 'validation', 'status'],
      exactColumns: true
    }
  }
}

const FIELD_PATTERNS = {
  phaseKind: [/phaseKind\s*[:=]\s*CP[12]/i, /阶段类型\s*[:：]\s*CP[12]/, /phase\s*[:=]\s*CP[12]/i],
  CandidateReviewBundleV1: [/CandidateReviewBundleV1/i, /候选审查包/],
  RQMatrix: [/RQMatrix/i, /RQ-1\s*~\s*RQ-8/i, /需求审查矩阵/, /Requirement\s*Matrix/i],
  DomainRealityMatrix: [
    /DomainRealityMatrix/i,
    /DistributionRequirementRealityGate/i,
    /领域现实矩阵/,
    /分发现实/,
    /package\s+channel/i
  ],
  ClaimEvidenceMatrix: [/ClaimEvidenceMatrix/i, /Claim\s*Evidence/i, /主张证据矩阵/, /主张-证据矩阵/],
  EscapeAbsorptionQueue: [/EscapeAbsorptionQueue/i, /遗漏吸纳队列/, /逃逸吸纳队列/, /外部发现吸纳队列/],
  TDMatrix: [/TDMatrix/i, /TD-1\s*~\s*TD-13/i, /技术方案审查矩阵/, /Technical\s*Design\s*Matrix/i],
  BlockerSnapshot: [/BlockerSnapshot/i, /阻断快照/, /阻断项快照/, /Blocker\s*Aggregation/i]
}

const STALE_PATTERNS = [
  /receiptFreshness"?\s*[:=]\s*"?stale/i,
  /\bfresh"?\s*[:=]\s*"?false/i,
  /candidateDigestMismatch/i,
  /source\s+HEAD\s+mismatch/i,
  /证据已陈旧/,
  /过期回执/
]

const CONFIRMATION_PATTERNS = [
  /确认\s*CP[12]/i,
  /可确认\s*CP[12]/i,
  /CP[12]\s*(?:confirmed|confirmation-ready)/i,
  /ConfirmBindingGate/i
]

const OPEN_BLOCKER_PATTERNS = [
  /openBlockers"?\s*[:=]\s*"?[1-9]/i,
  /blockerStatus\s*[:=]\s*(?:open|blocked)/i,
  /阻断项\s*[:：]\s*(?:open|未关闭|存在)/i,
  /(?:blockerId|blockerSeverity|blockerPriority)\s*[:=]\s*(?:P[01]|BLOCK)\b/i,
  /\bBLOCK\b[^.\n]*(?:open|unresolved|未关闭|存在)/i
]

const MATRIX_FIELDS = new Set([
  'RQMatrix',
  'DomainRealityMatrix',
  'ClaimEvidenceMatrix',
  'EscapeAbsorptionQueue',
  'TDMatrix',
  'BlockerSnapshot'
])

function textOf(input) {
  if (typeof input === 'string') return input
  try {
    return JSON.stringify(input || {})
  } catch {
    return ''
  }
}

function phaseValue(value) {
  return value && /^CP[12]$/i.test(String(value).trim())
    ? String(value).trim().toUpperCase()
    : null
}

function markdownPhaseSources(text) {
  const sources = []
  const frontMatter = text.match(/^\uFEFF?---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|$)/)
  const frontMatterPhase = frontMatter?.[1]?.match(/^\s*(?:phaseKind|phase)\s*:\s*(CP[12])\s*$/im)?.[1]
  if (frontMatterPhase) sources.push({ source: 'front-matter', phase: frontMatterPhase.toUpperCase(), declared: true })

  const documentPhase = text.match(/^\s*(?:phaseKind|phase)\s*[:=]\s*(CP[12])\s*$/im)?.[1]
  if (documentPhase && !frontMatterPhase) {
    sources.push({ source: 'document-field', phase: documentPhase.toUpperCase(), declared: true })
  }

  const primaryHeading = text.match(/^\s*#\s+(.+)$/m)?.[1]
  const fallbackHeading = primaryHeading || text.match(/^\s*#{1,6}\s+(.+)$/m)?.[1]
  if (fallbackHeading) {
    const explicit = fallbackHeading.match(/\b(CP[12])\b/i)?.[1]
    const inferred = explicit
      ? explicit.toUpperCase()
      : /需求确认|需求候选|requirement/i.test(fallbackHeading)
          ? 'CP1'
          : /技术方案|technical\s+design/i.test(fallbackHeading)
              ? 'CP2'
              : null
    if (inferred) sources.push({ source: 'primary-heading', phase: inferred, declared: false })
  }

  if (!sources.length) {
    const hasRq = /(?:^|\n)#{1,6}[^\n]*(?:RQMatrix|DomainRealityMatrix)/i.test(text)
    const hasTd = /(?:^|\n)#{1,6}[^\n]*(?:TDMatrix|BlockerSnapshot)/i.test(text)
    if (hasRq !== hasTd) sources.push({ source: 'matrix-heading-fallback', phase: hasRq ? 'CP1' : 'CP2', declared: false })
  }
  return sources
}

function phaseEvidence(input, options = {}) {
  const sources = []
  const optionPhase = phaseValue(options.phase || options.phaseKind)
  if (optionPhase) sources.push({ source: 'option', phase: optionPhase, declared: false })

  if (input && typeof input === 'object') {
    const objectPhase = phaseValue(input.phaseKind || input.phase)
    if (objectPhase) sources.push({ source: 'object-field', phase: objectPhase, declared: true })
  } else if (typeof input === 'string') {
    sources.push(...markdownPhaseSources(input))
  }

  const phase = sources[0]?.phase || null
  const conflicts = [...new Set(sources.map(item => item.phase))].filter(item => item !== phase)
  return {
    phase,
    sources,
    conflicts,
    candidateDeclaresPhase: sources.some(item => item.declared)
  }
}

function normalizePhase(input, options = {}) {
  return phaseEvidence(input, options).phase
}

function findDeepEntry(value, key, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return { found: false, value: undefined }
  seen.add(value)
  if (Object.prototype.hasOwnProperty.call(value, key)) return { found: true, value: value[key] }
  for (const item of Object.values(value)) {
    const entry = findDeepEntry(item, key, seen)
    if (entry.found) return entry
  }
  return { found: false, value: undefined }
}

function hasCandidateMarker(input, text) {
  if (input && typeof input === 'object') {
    const marker = findDeepEntry(input, 'CandidateReviewBundleV1')
    const schema = findDeepEntry(input, 'schemaVersion')
    return (marker.found && marker.value !== false && marker.value != null) ||
      (schema.found && /CandidateReviewBundleV1/i.test(String(schema.value)))
  }
  return /(?:schemaVersion\s*[:=]\s*CandidateReviewBundleV1|CandidateReviewBundleV1)/i.test(text)
}

function markdownSection(text, field) {
  const lines = text.split(/\r?\n/)
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const headingPattern = new RegExp(`^(#{1,6})\\s+.*(?:${escaped})\\b`, 'i')
  const start = lines.findIndex(line => headingPattern.test(line.trim()))
  if (start < 0) return null
  const level = lines[start].trim().match(/^(#+)/)[1].length
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    const heading = lines[index].trim().match(/^(#{1,6})\s+/)
    if (heading && heading[1].length <= level) {
      end = index
      break
    }
  }
  return lines.slice(start + 1, end).join('\n')
}

function hasField(input, text, field, phaseInfo = phaseEvidence(input)) {
  if (field === 'phaseKind') return phaseInfo.candidateDeclaresPhase
  if (field === 'CandidateReviewBundleV1') return hasCandidateMarker(input, text)
  if (typeof input === 'object' && input) return findDeepEntry(input, field).found
  if (MATRIX_FIELDS.has(field)) return markdownSection(text, field) !== null
  return (FIELD_PATTERNS[field] || []).some(pattern => pattern.test(text))
}

function hasFieldSkipReason(text, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`skipReason\\s*[:=][^\\n]*${escaped}|${escaped}[^\\n]*skipReason`, 'i').test(text)
}

function matchAny(text, patterns) {
  return patterns.some(pattern => pattern.test(text))
}

function normalizeKey(value) {
  return String(value || '')
    .replace(/[`_*]/g, '')
    .replace(/\s+/g, '')
    .replace(/[-_]/g, '')
    .toLowerCase()
}

function isEmptyValue(value) {
  if (value == null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value).length === 0
  return false
}

function parseTableRow(line) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null
  return trimmed.slice(1, -1).split('|').map(cell => cell.trim())
}

function isSeparatorRow(cells) {
  return Array.isArray(cells) && cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell))
}

function parseMarkdownTable(section) {
  const lines = String(section || '').split(/\r?\n/)
  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = parseTableRow(lines[index])
    const separator = parseTableRow(lines[index + 1])
    if (!header || !isSeparatorRow(separator) || header.length !== separator.length) continue
    const rows = []
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const row = parseTableRow(lines[rowIndex])
      if (!row) {
        if (rows.length) break
        continue
      }
      rows.push(row)
    }
    return { headers: header, rows }
  }
  return null
}

function columnsMatch(actual, expected, exact) {
  const actualKeys = actual.map(normalizeKey)
  const expectedKeys = expected.map(normalizeKey)
  if (exact && actualKeys.length !== expectedKeys.length) return false
  return expectedKeys.every(key => actualKeys.includes(key))
}

function rowMatches(value, expected) {
  const normalized = String(value || '').trim().toLowerCase()
  const escaped = expected.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped}(?:\\D|$)`, 'i').test(normalized)
}

function pushColumnIssues(issues, field, actualColumns, contract) {
  if (columnsMatch(actualColumns, contract.columns, contract.exactColumns)) return
  issues.push({
    code: 'matrix-columns-invalid',
    field,
    expected: contract.columns,
    actual: actualColumns
  })
}

function captureOpenBlockers(value, format, issues, metadata) {
  const valid = format === 'object'
    ? Number.isInteger(value) && value >= 0
    : /^(?:0|[1-9]\d*)$/.test(String(value ?? '').trim())
  if (!valid) {
    issues.push({
      code: 'open-blockers-invalid',
      field: 'BlockerSnapshot',
      actual: value
    })
    metadata.openBlockers = null
    return
  }
  metadata.openBlockers = Number(value)
}

function validateMarkdownMatrix(field, section, contract, issues, metadata) {
  const table = parseMarkdownTable(section)
  if (!table) {
    issues.push({ code: 'matrix-table-required', field })
    return
  }

  const normalizedHeaders = table.headers.map(normalizeKey)
  const verticalBlocker = field === 'BlockerSnapshot' &&
    normalizedHeaders.length === 2 &&
    ['field', '字段'].includes(normalizedHeaders[0]) &&
    ['value', '当前值', '值'].includes(normalizedHeaders[1])

  if (verticalBlocker) {
    const keys = table.rows.map(row => row[0])
    pushColumnIssues(issues, field, keys, contract)
    for (const row of table.rows) {
      if (row.length !== 2 || row.some(isEmptyValue)) issues.push({ code: 'matrix-empty-cell', field })
    }
    const blockerRow = table.rows.find(row => normalizeKey(row[0]) === normalizeKey('openBlockers'))
    if (blockerRow) captureOpenBlockers(blockerRow[1], 'markdown', issues, metadata)
    return
  }

  pushColumnIssues(issues, field, table.headers, contract)
  if (!table.rows.length) {
    issues.push({ code: 'matrix-empty', field })
    return
  }

  for (const row of table.rows) {
    if (row.length !== table.headers.length || row.some(isEmptyValue)) {
      issues.push({ code: 'matrix-empty-cell', field })
      break
    }
  }

  if (contract.requiredRows) {
    const rowKeyIndex = contract.rowKey
      ? normalizedHeaders.indexOf(normalizeKey(contract.rowKey))
      : 0
    const values = table.rows.map(row => row[rowKeyIndex])
    for (const requiredRow of contract.requiredRows) {
      const matches = values.filter(value => rowMatches(value, requiredRow))
      if (matches.length !== 1) {
        issues.push({
          code: matches.length ? 'matrix-row-duplicate' : 'matrix-row-missing',
          field,
          row: requiredRow
        })
      }
    }
  }

  if (field === 'BlockerSnapshot') {
    if (table.rows.length !== 1) {
      issues.push({
        code: 'blocker-snapshot-row-count',
        field,
        expected: 1,
        actual: table.rows.length
      })
    }
    const index = normalizedHeaders.indexOf(normalizeKey('openBlockers'))
    if (index >= 0) captureOpenBlockers(table.rows[0]?.[index], 'markdown', issues, metadata)
  }
}

function validateObjectMatrix(field, value, contract, issues, metadata) {
  if (contract.objectShape) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) {
      issues.push({ code: 'matrix-empty', field })
      return
    }
    const keys = Object.keys(value)
    pushColumnIssues(issues, field, keys, contract)
    for (const column of contract.columns) {
      const key = keys.find(item => normalizeKey(item) === normalizeKey(column))
      if (!key || isEmptyValue(value[key])) issues.push({ code: 'matrix-empty-cell', field, column })
    }
    captureOpenBlockers(value.openBlockers, 'object', issues, metadata)
    return
  }

  if (!Array.isArray(value) || !value.length) {
    issues.push({ code: 'matrix-empty', field })
    return
  }
  const rows = value.filter(item => item && typeof item === 'object' && !Array.isArray(item))
  if (rows.length !== value.length) {
    issues.push({ code: 'matrix-row-invalid', field })
    return
  }
  for (const row of rows) {
    const keys = Object.keys(row)
    pushColumnIssues(issues, field, keys, contract)
    for (const column of contract.columns) {
      const key = keys.find(item => normalizeKey(item) === normalizeKey(column))
      if (!key || isEmptyValue(row[key])) issues.push({ code: 'matrix-empty-cell', field, column })
    }
  }
  if (contract.requiredRows) {
    const keyName = contract.rowKey || contract.columns[0]
    const values = rows.map(row => {
      const key = Object.keys(row).find(item => normalizeKey(item) === normalizeKey(keyName))
      return key ? row[key] : ''
    })
    for (const requiredRow of contract.requiredRows) {
      const matches = values.filter(value => rowMatches(value, requiredRow))
      if (matches.length !== 1) {
        issues.push({
          code: matches.length ? 'matrix-row-duplicate' : 'matrix-row-missing',
          field,
          row: requiredRow
        })
      }
    }
  }
}

function validateCandidateReviewBundle(input, options = {}) {
  const text = textOf(input)
  const phaseInfo = phaseEvidence(input, options)
  const phase = phaseInfo.phase
  const issues = []
  const metadata = { openBlockers: null }

  if (phaseInfo.conflicts.length) {
    issues.push({
      code: 'phase-conflict',
      field: 'phaseKind',
      sources: phaseInfo.sources
    })
  }
  if (!phase || !PHASE_RULES[phase]) {
    return {
      phase,
      phaseInfo,
      presentFields: [],
      missingFields: [],
      issues,
      metadata
    }
  }

  const presentFields = PHASE_RULES[phase].requiredFields
    .filter(field => hasField(input, text, field, phaseInfo))
  const missingFields = PHASE_RULES[phase].requiredFields
    .filter(field => !presentFields.includes(field))

  for (const [field, contract] of Object.entries(MATRIX_CONTRACTS[phase] || {})) {
    if (missingFields.includes(field)) continue
    if (input && typeof input === 'object') {
      validateObjectMatrix(field, findDeepEntry(input, field).value, contract, issues, metadata)
    } else {
      validateMarkdownMatrix(field, markdownSection(text, field), contract, issues, metadata)
    }
  }

  return {
    phase,
    phaseInfo,
    presentFields,
    missingFields,
    issues,
    metadata
  }
}

function missingCandidateReviewFields(input, options = {}) {
  const validation = validateCandidateReviewBundle(input, options)
  const phase = validation.phase
  if (!phase || !PHASE_RULES[phase]) return []
  const text = textOf(input)
  return validation.missingFields
    .map(field => ({
      field,
      skipReason: hasFieldSkipReason(text, field)
    }))
}

function classifyCandidateReviewBundle(input, options = {}) {
  const validation = validateCandidateReviewBundle(input, options)
  const phase = validation.phase
  const text = textOf(input)
  if (!phase || !PHASE_RULES[phase]) return 'not-candidate-review'

  const missing = validation.missingFields
  const hasConfirmationCue = matchAny(text, CONFIRMATION_PATTERNS)
  if (matchAny(text, STALE_PATTERNS)) return 'stale'
  if ((missing.length || validation.issues.length) && hasConfirmationCue) return 'confirm-blocked'
  if (missing.length || validation.issues.length) return 'review-incomplete'
  if (Number.isFinite(validation.metadata.openBlockers) && validation.metadata.openBlockers > 0) return 'blocked'
  if (matchAny(text, OPEN_BLOCKER_PATTERNS)) return 'blocked'
  return 'review-ready'
}

function buildCandidateReviewBundleReceipt(input, options = {}) {
  const validation = validateCandidateReviewBundle(input, options)
  const phase = validation.phase
  const text = textOf(input)
  const missing = validation.missingFields.map(field => ({
    field,
    skipReason: hasFieldSkipReason(text, field)
  }))
  const classification = classifyCandidateReviewBundle(input, options)

  return {
    schemaVersion: 'CandidateReviewBundleReceiptV1',
    gate: 'RequiredCandidateEvidenceGate',
    phase,
    phaseSources: validation.phaseInfo.sources,
    phaseConflicts: validation.phaseInfo.conflicts,
    classification,
    presentFields: validation.presentFields,
    missingFields: missing.map(item => item.field),
    missingWithoutSkipReason: missing.filter(item => !item.skipReason).map(item => item.field),
    validationIssues: validation.issues,
    openBlockers: validation.metadata.openBlockers,
    stale: classification === 'stale',
    confirmationBlocked: classification === 'confirm-blocked',
    passed: classification === 'review-ready'
  }
}

module.exports = {
  FIELD_PATTERNS,
  PHASE_RULES,
  buildCandidateReviewBundleReceipt,
  classifyCandidateReviewBundle,
  missingCandidateReviewFields,
  normalizePhase,
  validateCandidateReviewBundle
}
