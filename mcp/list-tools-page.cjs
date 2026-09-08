'use strict'

const crypto = require('crypto')

// Callers select a budget from the bound host's transport contract. Keep the
// full catalog in one page for Codex discovery; constrained hosts retain room
// for transport/runtime identity within their 8 KiB message boundary.
function createToolsPager(tools, limitBytes = 6 * 1024) {
  const catalogDigest = crypto.createHash('sha256').update(JSON.stringify(tools)).digest('hex')
  const token = index => Buffer.from(JSON.stringify([catalogDigest, index])).toString('base64url')
  const pages = []
  let start = 0
  while (start < tools.length) {
    let end = start
    let page
    while (end < tools.length) {
      const candidate = { tools: tools.slice(start, end + 1), ...(end + 1 < tools.length ? { nextCursor: token(end + 1) } : {}) }
      if (Buffer.byteLength(JSON.stringify(candidate)) > limitBytes) break
      page = candidate
      end += 1
    }
    if (!page) throw new Error('A tool schema exceeds the supported tools/list page budget')
    pages.push({ start, page })
    start = end
  }
  return function listTools(params = {}) {
    if (params && typeof params === 'object' && !Array.isArray(params) &&
        Object.keys(params).every(key => key === 'cursor' || key === '_meta') &&
        (params._meta === undefined || (params._meta && typeof params._meta === 'object' && !Array.isArray(params._meta)))) {
      if (params.cursor === undefined) return pages[0]?.page || { tools: [] }
      if (typeof params.cursor === 'string' && params.cursor.length <= 256) {
        const found = pages.find(page => page.start > 0 && token(page.start) === params.cursor)
        if (found) return found.page
      }
    }
    throw Object.assign(new Error('Invalid or stale tools/list cursor'), { code: -32602 })
  }
}

module.exports = { createToolsPager }
