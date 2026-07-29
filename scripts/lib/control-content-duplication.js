'use strict'

const fs = require('fs')
const path = require('path')
const { buildBundle, portable, sha256 } = require('./control-content-source')

function normalizeBlock (value) {
  return String(value)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function paragraphCandidates (files, options = {}) {
  const minChars = options.minParagraphChars || 100
  const groups = new Map()
  for (const file of files) {
    const body = file.content.replace(/^---\n[\s\S]*?\n---\n?/, '')
    for (const paragraph of body.split(/\n\s*\n/)) {
      const normalized = normalizeBlock(paragraph)
      if (normalized.length < minChars) continue
      const digest = sha256(normalized)
      if (!groups.has(digest)) groups.set(digest, { normalized, files: new Set() })
      groups.get(digest).files.add(file.relative)
    }
  }
  return Array.from(groups.entries())
    .filter(([, group]) => group.files.size >= 2)
    .map(([digest, group]) => ({
      id: `exact-${digest.slice(0, 12)}`,
      kind: 'exact-paragraph',
      digest,
      similarity: 1,
      files: Array.from(group.files).sort(),
      excerpt: group.normalized.slice(0, 180)
    }))
}

function sectionBlocks (content) {
  const lines = String(content).replace(/\r\n?/g, '\n').split('\n')
  const sections = []
  let current = null
  for (const line of lines) {
    const heading = line.match(/^(#{2,4})\s+(.+)$/)
    if (heading) {
      if (current) sections.push(current)
      current = { heading: heading[2].trim(), lines: [] }
    } else if (current) {
      current.lines.push(line)
    }
  }
  if (current) sections.push(current)
  return sections
    .map(section => ({
      heading: section.heading,
      body: normalizeBlock(section.lines.join('\n'))
    }))
    .filter(section => section.body.length >= 180)
}

function tokens (value) {
  return new Set(
    String(value).toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || []
  )
}

function jaccard (left, right) {
  const a = tokens(left)
  const b = tokens(right)
  if (!a.size || !b.size) return 0
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection += 1
  return intersection / (a.size + b.size - intersection)
}

function nearSectionCandidates (files, options = {}) {
  const threshold = options.sectionThreshold || 0.94
  const sections = []
  for (const file of files) {
    for (const section of sectionBlocks(file.content)) {
      sections.push({ ...section, file: file.relative })
    }
  }
  const candidates = []
  for (let leftIndex = 0; leftIndex < sections.length; leftIndex += 1) {
    const left = sections[leftIndex]
    for (let rightIndex = leftIndex + 1; rightIndex < sections.length; rightIndex += 1) {
      const right = sections[rightIndex]
      if (left.file === right.file) continue
      const lengthRatio = Math.min(left.body.length, right.body.length) / Math.max(left.body.length, right.body.length)
      if (lengthRatio < 0.85) continue
      const similarity = jaccard(left.body, right.body)
      if (similarity < threshold || left.body === right.body) continue
      const identity = [left.file, left.heading, right.file, right.heading].sort().join('|')
      candidates.push({
        id: `near-${sha256(identity).slice(0, 12)}`,
        kind: 'near-section',
        similarity: Number(similarity.toFixed(4)),
        files: [left.file, right.file].sort(),
        headings: [left.heading, right.heading],
        excerpt: `${left.heading} <> ${right.heading}`.slice(0, 180)
      })
    }
  }
  return candidates
}

function analyzeDuplication (root, options = {}) {
  const bundle = buildBundle(root, { mode: 'analyze' })
  const candidates = [
    ...paragraphCandidates(bundle.files, options),
    ...nearSectionCandidates(bundle.files, options)
  ].sort((left, right) => left.id.localeCompare(right.id))
  return {
    schemaVersion: 'ControlContentDuplicationInventoryV1',
    sourceBundleDigest: bundle.receipt.bundleDigest,
    thresholds: {
      minParagraphChars: options.minParagraphChars || 100,
      sectionThreshold: options.sectionThreshold || 0.94,
      minSectionChars: 180,
      minSectionLengthRatio: 0.85
    },
    counts: {
      exactParagraph: candidates.filter(item => item.kind === 'exact-paragraph').length,
      nearSection: candidates.filter(item => item.kind === 'near-section').length,
      total: candidates.length
    },
    candidates
  }
}

function ruleMatches (rule, candidate) {
  if (rule.kind && rule.kind !== candidate.kind) return false
  if (rule.candidateIds && !rule.candidateIds.includes(candidate.id)) return false
  if (rule.allFilesUnder && !candidate.files.every(file => file.startsWith(rule.allFilesUnder))) return false
  if (rule.anyFilePrefix && !candidate.files.some(file => file.startsWith(rule.anyFilePrefix))) return false
  if (rule.allFilePattern) {
    const pattern = new RegExp(rule.allFilePattern)
    if (!candidate.files.every(file => pattern.test(file))) return false
  }
  if (rule.excerptPattern && !(new RegExp(rule.excerptPattern, 'u')).test(candidate.excerpt)) return false
  return true
}

function validateDispositions (root, inventory) {
  const file = path.join(root, 'content-source', 'duplication-dispositions.json')
  if (!fs.existsSync(file)) {
    return { ok: false, errors: ['missing duplication-dispositions.json'], assignments: [] }
  }
  const document = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (document.schemaVersion !== 'ControlContentDuplicationDispositionV1') {
    return { ok: false, errors: ['unsupported disposition schema'], assignments: [] }
  }
  const errors = []
  const assignments = []
  const allowed = new Set(['extract', 'must-retain', 'structural-only'])
  for (const candidate of inventory.candidates) {
    const matches = (document.rules || []).filter(rule => ruleMatches(rule, candidate))
    if (matches.length !== 1) {
      errors.push(`${candidate.id} matched ${matches.length} disposition rules`)
      continue
    }
    const rule = matches[0]
    if (!allowed.has(rule.decision) || !String(rule.reason || '').trim()) {
      errors.push(`${rule.id || candidate.id} has invalid decision/reason`)
      continue
    }
    assignments.push({
      candidateId: candidate.id,
      ruleId: rule.id,
      decision: rule.decision,
      reason: rule.reason
    })
  }
  const used = new Set(assignments.map(item => item.ruleId))
  for (const rule of document.rules || []) {
    if (!used.has(rule.id)) errors.push(`stale disposition rule: ${rule.id}`)
  }
  return { ok: errors.length === 0, errors, assignments }
}

function inventoryPath (root) {
  return path.join(root, 'content-source', 'duplication-inventory.json')
}

function serializeInventory (inventory) {
  return `${JSON.stringify(inventory, null, 2)}\n`
}

module.exports = {
  analyzeDuplication,
  inventoryPath,
  normalizeBlock,
  paragraphCandidates,
  nearSectionCandidates,
  portable,
  serializeInventory,
  validateDispositions
}
