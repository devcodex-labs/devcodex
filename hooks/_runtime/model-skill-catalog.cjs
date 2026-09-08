'use strict'

const {
  byteLength,
  sha256,
  stableStringify
} = require('./progressive-skill-route-contract.cjs')

const CATALOG_POLICY_VERSION = 'UnifiedSkillCatalogV1.3'
const PAGE_LIMIT_BYTES = 8 * 1024
// Kept as a compatibility/telemetry threshold; it is no longer a task deny.
const CATALOG_LIMIT_BYTES = 64 * 1024
const PAGE_PAYLOAD_TARGET = 7424
const MAX_CARDS_PER_PAGE = 100
const DEFAULT_SHORTLIST_LIMIT = 8

function encodeCursor (payload) {
  const body = Buffer.from(stableStringify(payload), 'utf8').toString('base64url')
  return `${body}.${sha256(payload).slice(0, 24)}`
}

function decodeCursor (cursor) {
  if (!cursor) return null
  const [body, signature, ...rest] = String(cursor).split('.')
  if (!body || !signature || rest.length) return null
  try {
    const value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (sha256(value).slice(0, 24) !== signature) return null
    return value
  } catch {
    return null
  }
}

function buildPageReceipt (catalog, pageIndex, cards, turnIdentity) {
  const pageCount = catalog.pageCards.length
  const nextCursor = pageIndex + 1 < pageCount
    ? encodeCursor({
      schemaVersion: 'SkillCatalogCursorV1',
      project: turnIdentity.project,
      turnBinding: turnIdentity.turnBinding,
      contextEpoch: turnIdentity.contextEpoch,
      catalogDigest: catalog.catalogDigest,
      pageIndex: pageIndex + 1
    })
    : null
  const pageDigest = sha256({
    catalogDigest: catalog.catalogDigest,
    pageIndex,
    pageCount,
    cards
  })
  const receipt = {
    schemaVersion: 'SkillCatalogPageV1',
    project: turnIdentity.project,
    turnBinding: turnIdentity.turnBinding,
    contextEpoch: turnIdentity.contextEpoch,
    catalogDigest: catalog.catalogDigest,
    pageIndex,
    pageCount,
    pageDigest,
    nextCursor,
    serializedBytes: 0,
    cards,
    served: true
  }
  receipt.serializedBytes = byteLength(receipt)
  return receipt
}

function measureWrappedPage (receipt) {
  return byteLength({
    schemaVersion: 'SkillRouteToolResultV1',
    ok: true,
    op: 'catalog',
    idempotencyKey: 'f'.repeat(64),
    receipt,
    bodyChunks: [],
    delivery: {
      channel: 'mcp-tool-result',
      serializedBytes: 8192,
      limitBytes: PAGE_LIMIT_BYTES,
      runtimeServed: true,
      modelObserved: 'unverified'
    }
  })
}

function partitionCards (cards, catalogIdentity, turnIdentity) {
  const pages = []
  let current = []
  for (const card of cards) {
    const candidate = [...current, card]
    const draftCatalog = { ...catalogIdentity, pageCards: [...pages, candidate] }
    const draftReceipt = buildPageReceipt(
      draftCatalog,
      pages.length,
      candidate,
      turnIdentity
    )
    if (current.length && (
      current.length >= MAX_CARDS_PER_PAGE ||
      measureWrappedPage(draftReceipt) > PAGE_PAYLOAD_TARGET
    )) {
      pages.push(current)
      current = [card]
    } else {
      current = candidate
    }
  }
  if (current.length || !pages.length) pages.push(current)
  return pages
}

function buildUnifiedSkillCatalog (index, turnIdentity, options = {}) {
  const selectedCards = Array.isArray(options.cards) ? options.cards : index.cards
  const inlineRejections = index.rejections.slice(0, 64)
  const overflow = index.rejections.slice(64)
  const identity = {
    indexDigest: index.indexDigest,
    cardsDigest: sha256(selectedCards),
    rejectionsDigest: sha256({
      inline: inlineRejections,
      overflowCount: overflow.length,
      overflowDigest: sha256(overflow)
    }),
    coverage: index.coverage,
    catalogPolicyVersion: CATALOG_POLICY_VERSION
  }
  const catalogDigest = sha256(identity)
  const catalog = {
    schemaVersion: 'UnifiedSkillCatalogV1',
    project: turnIdentity.project,
    contextEpoch: turnIdentity.contextEpoch,
    indexDigest: index.indexDigest,
    catalogDigest,
    candidateCount: selectedCards.length,
    availableCandidateCount: index.cards.length,
    coverage: index.coverage,
    rejections: inlineRejections,
    rejectionOverflowCount: overflow.length,
    rejectionOverflowDigest: sha256(overflow),
    cards: selectedCards,
    pageCards: []
  }
  catalog.pageCards = partitionCards(
    selectedCards,
    { ...catalog, pageCards: [] },
    turnIdentity
  )
  catalog.pages = catalog.pageCards.map((cards, pageIndex) =>
    buildPageReceipt(catalog, pageIndex, cards, turnIdentity)
  )
  const totalBytes = catalog.pages.reduce((sum, page) => sum + measureWrappedPage(page), 0)
  if (catalog.pages.some(page => measureWrappedPage(page) > PAGE_LIMIT_BYTES)) {
    const error = new Error('CATALOG_PAGE_BUDGET_BLOCKED')
    error.code = 'CATALOG_PAGE_BUDGET_BLOCKED'
    throw error
  }
  catalog.totalSerializedBytes = totalBytes
  catalog.totalBudgetExceeded = totalBytes > CATALOG_LIMIT_BYTES
  catalog.deliveryMode = options.cards ? 'metadata-shortlist' : 'paged-metadata'
  return catalog
}

function searchTokens (value) {
  const text = String(value || '').normalize('NFKC').toLowerCase()
  const tokens = new Set(text.match(/[a-z0-9][a-z0-9._-]{1,63}/g) || [])
  const chars = [...text].filter(char => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char))
  for (let index = 0; index < chars.length; index += 1) {
    tokens.add(chars[index])
    if (index + 1 < chars.length) tokens.add(`${chars[index]}${chars[index + 1]}`)
  }
  return [...tokens]
}

/**
 * Produce a bounded high-recall metadata shortlist without reading Skill bodies.
 */
function shortlistSkillCards (cards, prompt, entries = [], limit = DEFAULT_SHORTLIST_LIMIT) {
  const boundedLimit = Math.max(0, Math.min(100, Number(limit) || DEFAULT_SHORTLIST_LIMIT))
  const promptText = String(prompt || '').normalize('NFKC').toLowerCase()
  const promptTokens = searchTokens(promptText)
  const byId = new Map(entries.map(entry => [entry.skillId, entry]))
  return [...(cards || [])]
    .map(card => {
      const searchable = [
        card.skillId,
        card.name,
        card.whenToUse,
        ...(card.domains || [])
      ].join(' ').normalize('NFKC').toLowerCase()
      let score = 0
      if (promptText.includes(String(card.skillId || '').toLowerCase())) score += 1000
      for (const token of promptTokens) {
        if (token.length > 1 && searchable.includes(token)) score += token.length >= 4 ? 8 : 3
      }
      const entry = byId.get(card.skillId)
      score += Math.max(0, 100 - Number(entry?.priority || 100)) / 100
      return { card, score }
    })
    .sort((left, right) =>
      right.score - left.score || left.card.skillId.localeCompare(right.card.skillId)
    )
    .slice(0, boundedLimit)
    .map(item => item.card)
}

function resolveCatalogPageIndex (catalog, turnIdentity, cursor) {
  if (!cursor) return 0
  const parsed = decodeCursor(cursor)
  if (!parsed ||
      parsed.schemaVersion !== 'SkillCatalogCursorV1' ||
      parsed.project !== turnIdentity.project ||
      parsed.turnBinding !== turnIdentity.turnBinding ||
      parsed.contextEpoch !== turnIdentity.contextEpoch ||
      parsed.catalogDigest !== catalog.catalogDigest ||
      !Number.isInteger(parsed.pageIndex) ||
      parsed.pageIndex < 0 ||
      parsed.pageIndex >= catalog.pages.length) {
    return -1
  }
  return parsed.pageIndex
}

module.exports = {
  CATALOG_POLICY_VERSION,
  PAGE_LIMIT_BYTES,
  CATALOG_LIMIT_BYTES,
  MAX_CARDS_PER_PAGE,
  DEFAULT_SHORTLIST_LIMIT,
  buildUnifiedSkillCatalog,
  shortlistSkillCards,
  resolveCatalogPageIndex,
  encodeCursor,
  decodeCursor,
  measureWrappedPage
}
