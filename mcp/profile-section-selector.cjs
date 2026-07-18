'use strict'

const crypto = require('crypto')

const PROFILE_SECTION_SELECTOR_SCHEMA = 'ProfileSectionSelectorV1'
const PROFILE_SECTION_RECEIPT_SCHEMA = 'ProfileSectionLoadReceiptV1'
const PROFILE_SECTION_PARSER = 'atx-v1'
const DEFAULT_SECTION_MAX_BYTES = 32 * 1024
const MIN_SECTION_CONFIDENCE = 0.8

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function normalizeHeading(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[`*_~\[\](){}<>《》“”‘’'"：:，,。.!！?？/\\|·•—–-]/g, '')
    .replace(/\s+/g, '')
    .trim()
}

function splitLinesWithOffsets(content) {
  const text = String(content || '')
  const lines = []
  let start = 0
  while (start < text.length) {
    const newline = text.indexOf('\n', start)
    const end = newline === -1 ? text.length : newline + 1
    lines.push({
      start,
      end,
      text: text.slice(start, end).replace(/\r?\n$/, '')
    })
    start = end
  }
  if (!lines.length && text.length === 0) return []
  return lines
}

function parseAtxHeadings(content, parser = PROFILE_SECTION_PARSER) {
  if (parser !== PROFILE_SECTION_PARSER) {
    return { supported: false, parser, headings: [], reason: 'unsupported-parser' }
  }
  const headings = []
  const lines = splitLinesWithOffsets(content)
  let fence = null
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const fenceMatch = line.text.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (!fence) fence = { char: marker[0], length: marker.length }
      else if (marker[0] === fence.char && marker.length >= fence.length) fence = null
      continue
    }
    if (fence) continue
    const match = line.text.match(/^\s{0,3}(#{1,6})[\t ]+(.+?)[\t ]*#*[\t ]*$/)
    if (!match) continue
    const title = match[2].trim()
    const normalized = normalizeHeading(title)
    if (!normalized) continue
    headings.push({
      level: match[1].length,
      title,
      normalized,
      line: index + 1,
      start: line.start,
      contentStart: line.end
    })
  }
  return { supported: true, parser, headings, reason: null }
}

function sectionEnd(headings, index, contentLength, includeDescendants) {
  const current = headings[index]
  for (let cursor = index + 1; cursor < headings.length; cursor += 1) {
    if (!includeDescendants || headings[cursor].level <= current.level) return headings[cursor].start
  }
  return contentLength
}

function matchHeading(headings, query) {
  const normalized = normalizeHeading(query)
  if (!normalized) return { query, normalized, matchType: null, candidates: [] }
  const exact = headings.filter(heading => heading.normalized === normalized)
  if (exact.length) return { query, normalized, matchType: 'exact', candidates: exact }
  const contains = headings.filter(heading => heading.normalized.includes(normalized))
  return { query, normalized, matchType: contains.length ? 'normalized-contains' : null, candidates: contains }
}

function fallbackFull(file, content, selector, details) {
  const body = String(content || '')
  return {
    body,
    receipt: {
      schemaVersion: PROFILE_SECTION_RECEIPT_SCHEMA,
      selectorSchemaVersion: PROFILE_SECTION_SELECTOR_SCHEMA,
      file,
      parser: selector.parser || PROFILE_SECTION_PARSER,
      sourceDigest: sha256(Buffer.from(body, 'utf8')),
      fullBytes: Buffer.byteLength(body, 'utf8'),
      selectedBytes: Buffer.byteLength(body, 'utf8'),
      matchedHeadings: details.matchedHeadings || [],
      missing: details.missing || [],
      ambiguous: details.ambiguous || [],
      deferredSections: [],
      requiredQueries: selector.requiredQueries || [],
      completion: 'fallback-full',
      fallbackReason: details.fallbackReason,
      requiredSatisfied: true,
      budgetExceeded: Buffer.byteLength(body, 'utf8') > selector.maxBytes,
      includePreamble: selector.includePreamble === true,
      includeDescendants: selector.includeDescendants === true
    }
  }
}

function selectProfileSections({ file, content, selector = {} }) {
  const body = String(content || '')
  const headingQueries = Array.isArray(selector.headingQueries)
    ? selector.headingQueries.map(value => String(value || '').trim()).filter(Boolean)
    : []
  const requiredQueries = Array.isArray(selector.requiredQueries)
    ? selector.requiredQueries.map(value => String(value || '').trim()).filter(Boolean)
    : []
  const maxBytes = Number.isInteger(selector.maxBytes) && selector.maxBytes >= 1
    ? selector.maxBytes
    : DEFAULT_SECTION_MAX_BYTES
  const normalizedSelector = {
    ...selector,
    headingQueries,
    requiredQueries,
    maxBytes,
    parser: selector.parser || PROFILE_SECTION_PARSER
  }
  const confidence = typeof selector.confidence === 'number' ? selector.confidence : 1
  if (confidence < MIN_SECTION_CONFIDENCE) {
    return fallbackFull(file, body, normalizedSelector, { fallbackReason: 'low-confidence' })
  }
  if (!headingQueries.length) {
    return fallbackFull(file, body, normalizedSelector, { fallbackReason: 'no-heading-query' })
  }
  const querySet = new Set(headingQueries.map(normalizeHeading))
  if (requiredQueries.some(query => !querySet.has(normalizeHeading(query)))) {
    return fallbackFull(file, body, normalizedSelector, { fallbackReason: 'required-query-not-requested' })
  }

  const parsed = parseAtxHeadings(body, normalizedSelector.parser)
  if (!parsed.supported || !parsed.headings.length) {
    return fallbackFull(file, body, normalizedSelector, {
      fallbackReason: parsed.supported ? 'no-supported-heading' : parsed.reason
    })
  }

  const matchedHeadings = []
  const missing = []
  const ambiguous = []
  const resolved = []
  for (const query of headingQueries) {
    const match = matchHeading(parsed.headings, query)
    if (!match.candidates.length) {
      missing.push(query)
      continue
    }
    if (match.candidates.length > 1) {
      ambiguous.push({ query, headings: match.candidates.map(candidate => candidate.title) })
      continue
    }
    const heading = match.candidates[0]
    matchedHeadings.push({ query, title: heading.title, level: heading.level, line: heading.line, matchType: match.matchType })
    resolved.push({ query, heading, index: parsed.headings.indexOf(heading) })
  }

  const requiredSet = new Set(requiredQueries.map(normalizeHeading))
  const requiredProblem = missing.some(query => requiredSet.has(normalizeHeading(query))) ||
    ambiguous.some(item => requiredSet.has(normalizeHeading(item.query)))
  if (requiredProblem) {
    return fallbackFull(file, body, normalizedSelector, {
      matchedHeadings,
      missing,
      ambiguous,
      fallbackReason: 'required-query-missing-or-ambiguous'
    })
  }

  const resolvedRanges = resolved.map(item => ({
    start: item.heading.start,
    end: sectionEnd(parsed.headings, item.index, body.length, normalizedSelector.includeDescendants === true)
  }))
  for (let leftIndex = 0; leftIndex < resolvedRanges.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < resolvedRanges.length; rightIndex += 1) {
      const left = resolvedRanges[leftIndex]
      const right = resolvedRanges[rightIndex]
      const same = left.start === right.start && left.end === right.end
      if (!same && left.start < right.end && right.start < left.end) {
        return fallbackFull(file, body, normalizedSelector, {
          matchedHeadings,
          missing,
          ambiguous,
          fallbackReason: 'overlapping-section-ranges'
        })
      }
    }
  }

  const pieces = []
  const deferredSections = []
  const selectedRanges = new Set()
  let selectedBytes = 0
  const addPiece = (key, label, text, required) => {
    if (selectedRanges.has(key)) return true
    const separator = pieces.length ? '\n\n' : ''
    const pieceBytes = Buffer.byteLength(separator + text, 'utf8')
    if (selectedBytes + pieceBytes > maxBytes) {
      deferredSections.push({ query: label, bytes: Buffer.byteLength(text, 'utf8'), required })
      return false
    }
    pieces.push(text)
    selectedRanges.add(key)
    selectedBytes += pieceBytes
    return true
  }

  if (normalizedSelector.includePreamble === true && parsed.headings[0].start > 0) {
    addPiece('$preamble', '$preamble', body.slice(0, parsed.headings[0].start), false)
  }
  for (let resolvedIndex = 0; resolvedIndex < resolved.length; resolvedIndex += 1) {
    const item = resolved[resolvedIndex]
    const end = resolvedRanges[resolvedIndex].end
    const key = `${item.heading.start}:${end}`
    addPiece(key, item.query, body.slice(item.heading.start, end).replace(/\s+$/, ''), requiredSet.has(normalizeHeading(item.query)))
  }

  if (deferredSections.some(item => item.required)) {
    return fallbackFull(file, body, normalizedSelector, {
      matchedHeadings,
      missing,
      ambiguous,
      fallbackReason: 'required-section-over-budget'
    })
  }

  const selectedBody = pieces.join('\n\n')
  const completion = missing.length || ambiguous.length || deferredSections.length ? 'partial' : 'complete'
  return {
    body: selectedBody,
    receipt: {
      schemaVersion: PROFILE_SECTION_RECEIPT_SCHEMA,
      selectorSchemaVersion: PROFILE_SECTION_SELECTOR_SCHEMA,
      file,
      parser: normalizedSelector.parser,
      sourceDigest: sha256(Buffer.from(body, 'utf8')),
      fullBytes: Buffer.byteLength(body, 'utf8'),
      selectedBytes: Buffer.byteLength(selectedBody, 'utf8'),
      matchedHeadings,
      missing,
      ambiguous,
      deferredSections,
      requiredQueries,
      completion,
      fallbackReason: null,
      requiredSatisfied: true,
      budgetExceeded: deferredSections.length > 0,
      includePreamble: normalizedSelector.includePreamble === true,
      includeDescendants: normalizedSelector.includeDescendants === true
    }
  }
}

module.exports = {
  DEFAULT_SECTION_MAX_BYTES,
  MIN_SECTION_CONFIDENCE,
  PROFILE_SECTION_PARSER,
  PROFILE_SECTION_RECEIPT_SCHEMA,
  PROFILE_SECTION_SELECTOR_SCHEMA,
  matchHeading,
  normalizeHeading,
  parseAtxHeadings,
  selectProfileSections
}
