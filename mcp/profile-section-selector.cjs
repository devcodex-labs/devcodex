'use strict'

const crypto = require('crypto')
const {
  readBoundedTextFileSync,
  readBoundedTextRangeSync,
  scanBoundedTextLinesSync
} = require('./bounded-text-reader.cjs')

const PROFILE_SECTION_SELECTOR_SCHEMA = 'ProfileSectionSelectorV1'
const PROFILE_SECTION_RECEIPT_SCHEMA = 'ProfileSectionLoadReceiptV1'
const PROFILE_SECTION_PARSER = 'atx-v1'
const DEFAULT_SECTION_MAX_BYTES = 32 * 1024
const DEFAULT_SECTION_SOURCE_SCAN_BYTES = 2 * 1024 * 1024
const DEFAULT_SECTION_TOTAL_SOURCE_BYTES = 4 * 1024 * 1024
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

function normalizeSelectorInput(selector = {}) {
  const headingQueries = Array.isArray(selector.headingQueries)
    ? selector.headingQueries.map(value => String(value || '').trim()).filter(Boolean)
    : []
  const requiredQueries = Array.isArray(selector.requiredQueries)
    ? selector.requiredQueries.map(value => String(value || '').trim()).filter(Boolean)
    : []
  return {
    ...selector,
    headingQueries,
    requiredQueries,
    maxBytes: Number.isInteger(selector.maxBytes) && selector.maxBytes >= 1
      ? selector.maxBytes
      : DEFAULT_SECTION_MAX_BYTES,
    parser: selector.parser || PROFILE_SECTION_PARSER
  }
}

function decorateFileReceipt(receipt, scan, sourceBytesRead) {
  return {
    ...receipt,
    sourceDigest: scan.sourceDigest,
    sourcePrefixDigest: scan.sourcePrefixDigest,
    fullBytes: scan.logicalBytes,
    sourceScanComplete: scan.scanComplete,
    sourceScanBytes: scan.sourceBytesRead,
    sourceBytesRead,
    continuation: scan.continuation,
    oversizedLines: scan.oversizedLines
  }
}

function sectionEndByte(headings, index, logicalBytes, includeDescendants, scanComplete) {
  const current = headings[index]
  for (let cursor = index + 1; cursor < headings.length; cursor += 1) {
    if (!includeDescendants || headings[cursor].level <= current.level) {
      return { end: headings[cursor].start, complete: true }
    }
  }
  return scanComplete
    ? { end: logicalBytes, complete: true }
    : { end: null, complete: false }
}

function selectProfileSectionsFromFileSync({
  file,
  filePath,
  selector = {},
  maxScanBytes = DEFAULT_SECTION_SOURCE_SCAN_BYTES,
  maxTotalSourceBytes = DEFAULT_SECTION_TOTAL_SOURCE_BYTES,
  fs
}) {
  const normalizedSelector = normalizeSelectorInput(selector)
  const scanBudget = Math.min(
    Number.isInteger(maxScanBytes) && maxScanBytes > 0 ? maxScanBytes : DEFAULT_SECTION_SOURCE_SCAN_BYTES,
    Number.isInteger(maxTotalSourceBytes) && maxTotalSourceBytes > 0
      ? maxTotalSourceBytes
      : DEFAULT_SECTION_SOURCE_SCAN_BYTES
  )
  const headings = []
  let fence = null
  const scan = scanBoundedTextLinesSync(filePath, {
    maxBytes: Math.max(1, scanBudget),
    allowMissing: true,
    fs,
    onLine(line) {
      if (line.oversized || line.text === null) return
      const fenceMatch = line.text.match(/^\s{0,3}(`{3,}|~{3,})/)
      if (fenceMatch) {
        const marker = fenceMatch[1]
        if (!fence) fence = { char: marker[0], length: marker.length }
        else if (marker[0] === fence.char && marker.length >= fence.length) fence = null
        return
      }
      if (fence || normalizedSelector.parser !== PROFILE_SECTION_PARSER) return
      const match = line.text.match(/^\s{0,3}(#{1,6})[\t ]+(.+?)[\t ]*#*[\t ]*$/)
      if (!match) return
      const title = match[2].trim()
      const normalized = normalizeHeading(title)
      if (!normalized) return
      headings.push({
        level: match[1].length,
        title,
        normalized,
        line: line.line,
        start: line.startByte,
        contentStart: line.endByte
      })
    }
  })
  if (!scan.exists) {
    return { exists: false, body: '', receipt: null, sourceBytesRead: 0, scan }
  }

  let sourceBytesRead = scan.sourceBytesRead
  const headingQueries = normalizedSelector.headingQueries
  const requiredQueries = normalizedSelector.requiredQueries
  const requiredSet = new Set(requiredQueries.map(normalizeHeading))
  const querySet = new Set(headingQueries.map(normalizeHeading))

  const partialReceipt = (details = {}) => {
    const selectedBody = details.body || ''
    const deferredSections = details.deferredSections || []
    return {
      exists: true,
      body: selectedBody,
      sourceBytesRead,
      scan,
      receipt: decorateFileReceipt({
        schemaVersion: PROFILE_SECTION_RECEIPT_SCHEMA,
        selectorSchemaVersion: PROFILE_SECTION_SELECTOR_SCHEMA,
        file,
        parser: normalizedSelector.parser,
        sourceDigest: null,
        fullBytes: scan.logicalBytes,
        selectedBytes: Buffer.byteLength(selectedBody, 'utf8'),
        matchedHeadings: details.matchedHeadings || [],
        missing: details.missing || [],
        ambiguous: details.ambiguous || [],
        deferredSections,
        requiredQueries,
        completion: 'partial',
        fallbackReason: details.fallbackReason || null,
        requiredSatisfied: false,
        budgetExceeded: true,
        includePreamble: normalizedSelector.includePreamble === true,
        includeDescendants: normalizedSelector.includeDescendants === true
      }, scan, sourceBytesRead)
    }
  }

  const fallbackFromFile = (fallbackReason, details = {}) => {
    const remainingSourceBytes = Math.max(0, maxTotalSourceBytes - sourceBytesRead)
    if (!scan.scanComplete || scan.logicalBytes > remainingSourceBytes) {
      return partialReceipt({
        ...details,
        fallbackReason: 'full-fallback-source-budget-exhausted',
        deferredSections: [
          ...(details.deferredSections || []),
          {
            query: '$full',
            bytes: scan.logicalBytes,
            required: true,
            reason: fallbackReason,
            continuation: scan.continuation
          }
        ]
      })
    }
    const document = readBoundedTextFileSync(filePath, {
      maxBytes: Math.max(1, remainingSourceBytes),
      fs
    })
    sourceBytesRead += document.sourceBytesRead
    const fallback = fallbackFull(file, document.content, normalizedSelector, {
      matchedHeadings: details.matchedHeadings || [],
      missing: details.missing || [],
      ambiguous: details.ambiguous || [],
      fallbackReason
    })
    return {
      exists: true,
      body: fallback.body,
      sourceBytesRead,
      scan,
      receipt: decorateFileReceipt(fallback.receipt, scan, sourceBytesRead)
    }
  }

  const confidence = typeof normalizedSelector.confidence === 'number' ? normalizedSelector.confidence : 1
  if (confidence < MIN_SECTION_CONFIDENCE) {
    return fallbackFromFile('low-confidence')
  }
  if (!headingQueries.length) {
    return fallbackFromFile('no-heading-query')
  }
  if (requiredQueries.some(query => !querySet.has(normalizeHeading(query)))) {
    return fallbackFromFile('required-query-not-requested')
  }
  if (normalizedSelector.parser !== PROFILE_SECTION_PARSER) {
    return fallbackFromFile('unsupported-parser')
  }
  if (!headings.length) {
    return scan.scanComplete
      ? fallbackFromFile('no-supported-heading')
      : partialReceipt({
          deferredSections: headingQueries.map(query => ({
            query,
            bytes: null,
            required: requiredSet.has(normalizeHeading(query)),
            reason: 'source-scan-incomplete'
          }))
        })
  }

  const matchedHeadings = []
  const missing = []
  const ambiguous = []
  const deferredSections = []
  const resolved = []
  for (const query of headingQueries) {
    const match = matchHeading(headings, query)
    if (!match.candidates.length) {
      if (scan.scanComplete) missing.push(query)
      else {
        deferredSections.push({
          query,
          bytes: null,
          required: requiredSet.has(normalizeHeading(query)),
          reason: 'source-scan-incomplete'
        })
      }
      continue
    }
    if (match.candidates.length > 1) {
      ambiguous.push({ query, headings: match.candidates.map(candidate => candidate.title) })
      continue
    }
    const heading = match.candidates[0]
    matchedHeadings.push({
      query,
      title: heading.title,
      level: heading.level,
      line: heading.line,
      matchType: match.matchType,
      provisional: !scan.scanComplete
    })
    resolved.push({ query, heading, index: headings.indexOf(heading) })
  }

  const requiredProblem = missing.some(query => requiredSet.has(normalizeHeading(query))) ||
    ambiguous.some(item => requiredSet.has(normalizeHeading(item.query)))
  if (scan.scanComplete && requiredProblem) {
    return fallbackFromFile('required-query-missing-or-ambiguous', {
      matchedHeadings,
      missing,
      ambiguous
    })
  }

  const resolvedRanges = resolved.map(item => {
    const end = sectionEndByte(
      headings,
      item.index,
      scan.logicalBytes,
      normalizedSelector.includeDescendants === true,
      scan.scanComplete
    )
    return { ...end, start: item.heading.start }
  })
  for (let leftIndex = 0; leftIndex < resolvedRanges.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < resolvedRanges.length; rightIndex += 1) {
      const left = resolvedRanges[leftIndex]
      const right = resolvedRanges[rightIndex]
      if (!left.complete || !right.complete) continue
      const same = left.start === right.start && left.end === right.end
      if (!same && left.start < right.end && right.start < left.end) {
        return scan.scanComplete
          ? fallbackFromFile('overlapping-section-ranges', { matchedHeadings, missing, ambiguous })
          : partialReceipt({
              matchedHeadings,
              missing,
              ambiguous,
              deferredSections: resolved.map(item => ({
                query: item.query,
                bytes: null,
                required: requiredSet.has(normalizeHeading(item.query)),
                reason: 'overlapping-section-ranges'
              }))
            })
      }
    }
  }

  const pieces = []
  const selectedRanges = new Set()
  let selectedBytes = 0
  const addRange = (key, label, start, end, required) => {
    if (selectedRanges.has(key)) return true
    if (!Number.isInteger(end)) {
      deferredSections.push({ query: label, bytes: null, required, reason: 'source-scan-incomplete' })
      return false
    }
    const separator = pieces.length ? '\n\n' : ''
    const rangeBytes = Math.max(0, end - start)
    if (selectedBytes + Buffer.byteLength(separator, 'utf8') + rangeBytes > normalizedSelector.maxBytes) {
      deferredSections.push({ query: label, bytes: rangeBytes, required, reason: 'section-output-budget' })
      return false
    }
    const remainingSourceBytes = Math.max(0, maxTotalSourceBytes - sourceBytesRead)
    if (rangeBytes > remainingSourceBytes) {
      deferredSections.push({ query: label, bytes: rangeBytes, required, reason: 'source-read-budget' })
      return false
    }
    const range = readBoundedTextRangeSync(filePath, {
      startByte: start,
      endByte: end,
      maxBytes: Math.max(1, remainingSourceBytes),
      expectedIdentity: scan.identity,
      fs
    })
    sourceBytesRead += range.sourceBytesRead
    const body = range.content.replace(/\s+$/, '')
    const pieceBytes = Buffer.byteLength(separator + body, 'utf8')
    if (selectedBytes + pieceBytes > normalizedSelector.maxBytes) {
      deferredSections.push({ query: label, bytes: Buffer.byteLength(body, 'utf8'), required, reason: 'section-output-budget' })
      return false
    }
    pieces.push(body)
    selectedRanges.add(key)
    selectedBytes += pieceBytes
    return true
  }

  if (normalizedSelector.includePreamble === true && headings[0].start > 0) {
    addRange('$preamble', '$preamble', 0, headings[0].start, false)
  }
  for (let resolvedIndex = 0; resolvedIndex < resolved.length; resolvedIndex += 1) {
    const item = resolved[resolvedIndex]
    const range = resolvedRanges[resolvedIndex]
    const key = `${range.start}:${range.end}`
    addRange(
      key,
      item.query,
      range.start,
      range.end,
      requiredSet.has(normalizeHeading(item.query))
    )
  }

  if (scan.scanComplete && deferredSections.some(item => item.required)) {
    return fallbackFromFile('required-section-over-budget', {
      matchedHeadings,
      missing,
      ambiguous,
      deferredSections
    })
  }

  const selectedBody = pieces.join('\n\n')
  const completion = scan.scanComplete && !missing.length && !ambiguous.length && !deferredSections.length
    ? 'complete'
    : 'partial'
  const requiredSatisfied = scan.scanComplete && !requiredProblem &&
    !deferredSections.some(item => item.required)
  return {
    exists: true,
    body: selectedBody,
    sourceBytesRead,
    scan,
    receipt: decorateFileReceipt({
      schemaVersion: PROFILE_SECTION_RECEIPT_SCHEMA,
      selectorSchemaVersion: PROFILE_SECTION_SELECTOR_SCHEMA,
      file,
      parser: normalizedSelector.parser,
      sourceDigest: scan.sourceDigest,
      fullBytes: scan.logicalBytes,
      selectedBytes: Buffer.byteLength(selectedBody, 'utf8'),
      matchedHeadings,
      missing,
      ambiguous,
      deferredSections,
      requiredQueries,
      completion,
      fallbackReason: null,
      requiredSatisfied,
      budgetExceeded: !scan.scanComplete || deferredSections.length > 0,
      includePreamble: normalizedSelector.includePreamble === true,
      includeDescendants: normalizedSelector.includeDescendants === true
    }, scan, sourceBytesRead)
  }
}

module.exports = {
  DEFAULT_SECTION_MAX_BYTES,
  DEFAULT_SECTION_SOURCE_SCAN_BYTES,
  DEFAULT_SECTION_TOTAL_SOURCE_BYTES,
  MIN_SECTION_CONFIDENCE,
  PROFILE_SECTION_PARSER,
  PROFILE_SECTION_RECEIPT_SCHEMA,
  PROFILE_SECTION_SELECTOR_SCHEMA,
  matchHeading,
  normalizeHeading,
  parseAtxHeadings,
  selectProfileSections,
  selectProfileSectionsFromFileSync
}
