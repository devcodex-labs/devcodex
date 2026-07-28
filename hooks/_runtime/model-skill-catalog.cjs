'use strict'

const {
  byteLength,
  sha256,
  stableStringify
} = require('./progressive-skill-route-contract.cjs')

const CATALOG_POLICY_VERSION = 'UnifiedSkillCatalogV1.1'
const PAGE_LIMIT_BYTES = 8 * 1024
const CATALOG_LIMIT_BYTES = 64 * 1024
const PAGE_PAYLOAD_TARGET = 6 * 1024

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
    if (current.length && measureWrappedPage(draftReceipt) > PAGE_PAYLOAD_TARGET) {
      pages.push(current)
      current = [card]
    } else {
      current = candidate
    }
  }
  if (current.length || !pages.length) pages.push(current)
  return pages
}

function buildUnifiedSkillCatalog (index, turnIdentity) {
  const inlineRejections = index.rejections.slice(0, 64)
  const overflow = index.rejections.slice(64)
  const identity = {
    indexDigest: index.indexDigest,
    cardsDigest: sha256(index.cards),
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
    candidateCount: index.cards.length,
    coverage: index.coverage,
    rejections: inlineRejections,
    rejectionOverflowCount: overflow.length,
    rejectionOverflowDigest: sha256(overflow),
    cards: index.cards,
    pageCards: []
  }
  catalog.pageCards = partitionCards(
    index.cards,
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
  if (totalBytes > CATALOG_LIMIT_BYTES) {
    const error = new Error('CATALOG_TOTAL_BUDGET_BLOCKED')
    error.code = 'CATALOG_TOTAL_BUDGET_BLOCKED'
    throw error
  }
  catalog.totalSerializedBytes = totalBytes
  return catalog
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
  buildUnifiedSkillCatalog,
  resolveCatalogPageIndex,
  encodeCursor,
  decodeCursor,
  measureWrappedPage
}
