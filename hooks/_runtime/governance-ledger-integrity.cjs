'use strict'

const crypto = require('crypto')
const fs = require('fs')
const { TextDecoder } = require('util')

const LEDGER_PREFIXES = Object.freeze(['PI-', 'PF-', 'VL-', 'GR-', 'ISSUE-'])

function escapeRegExp (value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function inspectGovernanceLedgerBuffer (buffer, options = {}) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '')
  const expectedPrefix = String(options.expectedPrefix || '').toUpperCase()
  const issues = []
  let text = ''
  let utf8Valid = true
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    utf8Valid = false
    issues.push('invalid-utf8')
  }

  const nulCount = bytes.reduce((count, byte) => count + (byte === 0 ? 1 : 0), 0)
  if (nulCount > 0) issues.push('nul-byte')
  if (expectedPrefix && !LEDGER_PREFIXES.includes(expectedPrefix)) issues.push('unsupported-prefix')

  const prefixPattern = expectedPrefix
    ? escapeRegExp(expectedPrefix.slice(0, -1))
    : '(?:PI|PF|VL|GR|ISSUE)'
  const tablePattern = new RegExp(`^\\|\\s*(${prefixPattern}-\\d{3,})\\s*\\|\\s*\\d{4}-\\d{2}-\\d{2}(?:\\s+\\d{2}:\\d{2})?\\s*\\|`, 'i')
  const tableCandidatePattern = new RegExp(`^\\|\\s*(${prefixPattern}-\\d{3,})\\s*\\|`, 'i')
  const exactHeadingLevel = Number.isInteger(options.exactHeadingLevel) && options.exactHeadingLevel >= 1 && options.exactHeadingLevel <= 6
    ? options.exactHeadingLevel
    : null
  const headingMarker = exactHeadingLevel ? `#{${exactHeadingLevel}}` : '#{2,}'
  const headingPattern = new RegExp(`^${headingMarker}\\s+(${prefixPattern}-\\d{3,})(?:\\s|$)`, 'i')
  const tableIds = []
  const headingIds = []
  const lines = text.split(/\r?\n/)
  const cells = line => String(line).trim().replace(/^\||\|$/g, '').replace(/\\\|/g, '\u0000')
    .split('|').map(value => value.replace(/\u0000/g, '|').trim())
  const dateLabels = new Set(['日期', '登记时间', '发现时间', 'date', 'recordedAt', 'createdAt'])
  let dateColumn = 1
  const registrationHeading = lines.findIndex(line => /^##\s+登记表\s*$/.test(line.trim()))
  let registrationEnd = lines.length
  if (registrationHeading >= 0) {
    const relativeEnd = lines.slice(registrationHeading + 1).findIndex(line => /^##\s+/.test(line.trim()))
    if (relativeEnd >= 0) registrationEnd = registrationHeading + 1 + relativeEnd
  }
  for (const [index, line] of lines.entries()) {
    const tableMatch = line.match(tablePattern)
    if (line.trim().startsWith('|') && cells(line).every(value => /^:?-{3,}:?$/.test(value))) {
      const declaredDateColumn = cells(lines[index - 1] || '').findIndex(value => dateLabels.has(value))
      dateColumn = declaredDateColumn >= 0 ? declaredDateColumn : 1
    }
    const headingMatch = line.match(headingPattern)
    const inRegistrationTable = registrationHeading < 0 || (index > registrationHeading && index < registrationEnd)
    const tableCandidate = line.match(tableCandidatePattern)
    const datedRow = tableCandidate && /^\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?$/.test(cells(line)[dateColumn] || '')
    if (inRegistrationTable && tableCandidate && !tableMatch && !datedRow) issues.push('primary-table-row-invalid')
    if ((tableMatch || datedRow) && inRegistrationTable) tableIds.push((tableMatch || tableCandidate)[1].toUpperCase())
    if (headingMatch) headingIds.push(headingMatch[1].toUpperCase())
  }
  const primaryIds = [...new Set([...tableIds, ...headingIds])]
  const duplicateIds = [...new Set([
    ...tableIds.filter((id, index) => tableIds.indexOf(id) !== index)
  ])]
  if (!primaryIds.length) issues.push('primary-records-missing')
  if (duplicateIds.length) issues.push('duplicate-primary-id')

  const sequences = primaryIds
    .filter(id => /-\d{3,}$/.test(id))
    .map(id => Number(id.match(/\d+$/)[0]))
  if (sequences.some(value => !Number.isSafeInteger(value) || value >= Number.MAX_SAFE_INTEGER)) issues.push('primary-sequence-out-of-range')
  const maxSequence = sequences.length ? Math.max(...sequences) : 0
  const actualPrefix = expectedPrefix || (primaryIds[0]?.match(/^[A-Z]+-/)?.[0] || '')
  const lastNonEmptyLine = text.split(/\r?\n/).filter(line => line.trim()).at(-1) || ''
  const tailBytes = bytes.subarray(Math.max(0, bytes.length - 256))

  return {
    schemaVersion: 'GovernanceLedgerIntegrityV1',
    valid: issues.length === 0,
    issues,
    bytes: bytes.length,
    contentDigest: crypto.createHash('sha256').update(bytes).digest('hex'),
    utf8Valid,
    nulCount,
    primaryRecordCount: primaryIds.length,
    primaryIds,
    duplicateIds,
    // Legacy headings also carry supplements and cross-references. Expose the
    // ambiguity for review; do not rename historical records from prose alone.
    duplicateHeadingIds: [...new Set(headingIds.filter((id, index) => headingIds.indexOf(id) !== index))],
    maxSequence,
    nextId: actualPrefix ? `${actualPrefix}${String(maxSequence + 1).padStart(3, '0')}` : null,
    headSentinel: primaryIds[0] || null,
    tailSentinel: {
      primaryId: primaryIds.at(-1) || null,
      lineDigest: crypto.createHash('sha256').update(lastNonEmptyLine).digest('hex'),
      observedBytes: tailBytes.length,
      digest: crypto.createHash('sha256').update(tailBytes).digest('hex')
    }
  }
}

function inspectGovernanceLedgerFile (file, options = {}) {
  try {
    if (!fs.statSync(file).isFile()) throw new Error('not-file')
    return { ...inspectGovernanceLedgerBuffer(fs.readFileSync(file), options), file }
  } catch (error) {
    return {
      schemaVersion: 'GovernanceLedgerIntegrityV1',
      valid: false,
      issues: ['read-failed'],
      file,
      error: error.code || error.message
    }
  }
}

module.exports = {
  LEDGER_PREFIXES,
  inspectGovernanceLedgerBuffer,
  inspectGovernanceLedgerFile
}
