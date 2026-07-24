'use strict'

/**
 * UnalignedLedgerV1 — machine residual ledger for Grok vs Codex HostParity (E1/E8).
 * Authority: scripts/fixtures/host-parity/unaligned-ledger.v1.json
 */

const fs = require('fs')
const path = require('path')

const SCHEMA_VERSION = 'UnalignedLedgerV1'
const REQUIRED_IDS = Object.freeze([
  'U-A1', 'U-A2', 'U-A3', 'U-A4',
  'U-B1', 'U-B2', 'U-B3', 'U-B4',
  'U-C1', 'U-C2', 'U-C3'
])

const DEFAULT_LEDGER_PATH = path.join(__dirname, '../fixtures/host-parity/unaligned-ledger.v1.json')
const DEFAULT_SCHEMA_PATH = path.join(__dirname, '../fixtures/host-parity/unaligned-ledger.schema.json')

/**
 * @param {string} [ledgerPath]
 * @returns {object}
 */
function loadUnalignedLedger(ledgerPath = DEFAULT_LEDGER_PATH) {
  const raw = fs.readFileSync(ledgerPath, 'utf8')
  const ledger = JSON.parse(raw)
  return validateUnalignedLedger(ledger)
}

/**
 * Lightweight structural validation (no ajv dependency).
 * @param {object} ledger
 * @returns {object} same ledger if valid
 */
function validateUnalignedLedger(ledger) {
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) {
    throw new Error('UNALIGNED_LEDGER_INVALID: root must be object')
  }
  if (ledger.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`UNALIGNED_LEDGER_INVALID: schemaVersion must be ${SCHEMA_VERSION}`)
  }
  if (typeof ledger.updatedAt !== 'string' || !ledger.updatedAt) {
    throw new Error('UNALIGNED_LEDGER_INVALID: updatedAt required')
  }
  if (!Array.isArray(ledger.items) || ledger.items.length !== REQUIRED_IDS.length) {
    throw new Error(`UNALIGNED_LEDGER_INVALID: items must have exactly ${REQUIRED_IDS.length} entries`)
  }
  const seen = new Set()
  for (const item of ledger.items) {
    if (!item || typeof item !== 'object') {
      throw new Error('UNALIGNED_LEDGER_INVALID: item must be object')
    }
    if (!REQUIRED_IDS.includes(item.id)) {
      throw new Error(`UNALIGNED_LEDGER_INVALID: unknown id ${item.id}`)
    }
    if (seen.has(item.id)) {
      throw new Error(`UNALIGNED_LEDGER_INVALID: duplicate id ${item.id}`)
    }
    seen.add(item.id)
    if (!item.title || typeof item.title !== 'string') {
      throw new Error(`UNALIGNED_LEDGER_INVALID: ${item.id} title required`)
    }
    if (!['open', 'closed', 'wont-fix'].includes(item.status)) {
      throw new Error(`UNALIGNED_LEDGER_INVALID: ${item.id} bad status`)
    }
    if (!item.closePath || !item.owner) {
      throw new Error(`UNALIGNED_LEDGER_INVALID: ${item.id} closePath/owner required`)
    }
    if (!Array.isArray(item.evidenceRefs)) {
      throw new Error(`UNALIGNED_LEDGER_INVALID: ${item.id} evidenceRefs must be array`)
    }
    if (item.status === 'closed' && item.evidenceRefs.length < 1) {
      throw new Error(`UNALIGNED_LEDGER_CLOSE_WITHOUT_EVIDENCE: ${item.id}`)
    }
    for (const ref of item.evidenceRefs) {
      if (!ref || typeof ref.kind !== 'string' || typeof ref.ref !== 'string') {
        throw new Error(`UNALIGNED_LEDGER_INVALID: ${item.id} evidenceRefs entries need kind+ref`)
      }
    }
  }
  for (const id of REQUIRED_IDS) {
    if (!seen.has(id)) {
      throw new Error(`UNALIGNED_LEDGER_INVALID: missing id ${id}`)
    }
  }
  return ledger
}

/**
 * Attempt to mark an item closed; fails without evidence.
 * @param {object} ledger
 * @param {string} id
 * @param {{ kind: string, ref: string, note?: string }[]} evidenceRefs
 * @param {string} [closedAt]
 * @returns {object} new ledger (does not write disk)
 */
function closeUnalignedItem(ledger, id, evidenceRefs, closedAt = new Date().toISOString()) {
  const next = JSON.parse(JSON.stringify(ledger))
  const item = next.items.find((x) => x.id === id)
  if (!item) throw new Error(`UNALIGNED_LEDGER_UNKNOWN_ID: ${id}`)
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length < 1) {
    throw new Error(`UNALIGNED_LEDGER_CLOSE_WITHOUT_EVIDENCE: ${id}`)
  }
  item.status = 'closed'
  item.evidenceRefs = evidenceRefs
  item.closedAt = closedAt
  next.updatedAt = closedAt
  return validateUnalignedLedger(next)
}

/**
 * Markdown projection for humans (requirement-side copy).
 * @param {object} ledger
 * @returns {string}
 */
function formatUnalignedLedgerMarkdown(ledger) {
  validateUnalignedLedger(ledger)
  const lines = [
    '# UnalignedLedgerV1 (projection)',
    '',
    `> schemaVersion: ${ledger.schemaVersion} · updatedAt: ${ledger.updatedAt}`,
    '> **Authority**: `scripts/fixtures/host-parity/unaligned-ledger.v1.json`',
    '',
    '| ID | Title | Status | Close path | Owner |',
    '|----|-------|:------:|------------|-------|'
  ]
  for (const item of ledger.items) {
    lines.push(`| ${item.id} | ${item.title} | ${item.status} | ${item.closePath} | ${item.owner} |`)
  }
  lines.push('')
  return lines.join('\n')
}

module.exports = {
  SCHEMA_VERSION,
  REQUIRED_IDS,
  DEFAULT_LEDGER_PATH,
  DEFAULT_SCHEMA_PATH,
  loadUnalignedLedger,
  validateUnalignedLedger,
  closeUnalignedItem,
  formatUnalignedLedgerMarkdown
}
