'use strict'

const MANAGED_ID = 'devcodex-global-host'

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stableKey(value) {
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableKey(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function mergeArrays(existing, managed) {
  const result = Array.isArray(existing) ? existing.slice() : []
  const seen = new Set(result.map(stableKey))
  for (const item of Array.isArray(managed) ? managed : []) {
    const key = stableKey(item)
    if (!seen.has(key)) {
      result.push(item)
      seen.add(key)
    }
  }
  return result
}

function deepMerge(existing, managed) {
  if (Array.isArray(managed)) return mergeArrays(existing, managed)
  if (!isPlainObject(managed)) return managed
  const result = isPlainObject(existing) ? { ...existing } : {}
  for (const [key, value] of Object.entries(managed)) {
    result[key] = isPlainObject(value)
      ? deepMerge(result[key], value)
      : (Array.isArray(value) ? mergeArrays(result[key], value) : value)
  }
  return result
}

function parseJsonObject(content, label = 'JSON config') {
  const text = String(content || '').trim()
  if (!text) return {}
  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    const wrapped = new Error(`GLOBAL_HOST_JSON_INVALID: ${label}: ${error.message}`)
    wrapped.code = 'GLOBAL_HOST_JSON_INVALID'
    throw wrapped
  }
  if (!isPlainObject(value)) {
    const error = new Error(`GLOBAL_HOST_JSON_NOT_OBJECT: ${label}`)
    error.code = 'GLOBAL_HOST_JSON_NOT_OBJECT'
    throw error
  }
  return value
}

function mergeJsonContent(content, managed, label) {
  return `${JSON.stringify(deepMerge(parseJsonObject(content, label), managed), null, 2)}\n`
}

function isDevCodexManagedHookEntry(value) {
  if (typeof value === 'string') {
    return /lifecycle-host-adapters\.cjs|(?:^|[\s"'\\/])(?:\.claude|\.codex|\.gemini|\.grok|\.github|devcodex)[\\/]+(?:hooks[\\/]_runtime[\\/]+)?lifecycle(?:-[\w-]+)?\.cjs/i.test(value)
  }
  if (Array.isArray(value)) return value.some(isDevCodexManagedHookEntry)
  if (isPlainObject(value)) return Object.values(value).some(isDevCodexManagedHookEntry)
  return false
}

function mergeManagedHookMap(existing, managed) {
  const result = isPlainObject(existing) ? { ...existing } : {}

  for (const [event, entries] of Object.entries(result)) {
    if (!Array.isArray(entries)) continue
    const preserved = entries.filter(entry => !isDevCodexManagedHookEntry(entry))
    if (preserved.length) result[event] = preserved
    else delete result[event]
  }

  for (const [event, entries] of Object.entries(isPlainObject(managed) ? managed : {})) {
    result[event] = mergeArrays(result[event], entries)
  }
  return result
}

function mergeHostJsonContent(content, managed, label) {
  const existing = parseJsonObject(content, label)
  const ordinaryManaged = Object.fromEntries(
    Object.entries(managed || {}).filter(([key]) => key !== 'hooks' && key !== 'mcpServers')
  )
  const result = deepMerge(existing, ordinaryManaged)

  if (isPlainObject(managed?.hooks)) {
    result.hooks = mergeManagedHookMap(existing.hooks, managed.hooks)
  }
  if (isPlainObject(managed?.mcpServers)) {
    result.mcpServers = {
      ...(isPlainObject(existing.mcpServers) ? existing.mcpServers : {}),
      ...managed.mcpServers
    }
  }
  return `${JSON.stringify(result, null, 2)}\n`
}

function markerTokens(kind, id = MANAGED_ID) {
  if (kind === 'markdown') {
    return {
      begin: `<!-- BEGIN DEVCODEX MANAGED: ${id} -->`,
      end: `<!-- END DEVCODEX MANAGED: ${id} -->`
    }
  }
  return {
    begin: `# BEGIN DEVCODEX MANAGED: ${id}`,
    end: `# END DEVCODEX MANAGED: ${id}`
  }
}

function markerCount(text, marker) {
  let count = 0
  let offset = 0
  while ((offset = text.indexOf(marker, offset)) !== -1) {
    count += 1
    offset += marker.length
  }
  return count
}

function mergeManagedBlock(content, body, options = {}) {
  const kind = options.kind || 'toml'
  const id = options.id || MANAGED_ID
  const text = String(content || '')
  const markers = markerTokens(kind, id)
  const beginCount = markerCount(text, markers.begin)
  const endCount = markerCount(text, markers.end)
  if (beginCount !== endCount || beginCount > 1) {
    const error = new Error(`GLOBAL_HOST_MARKER_CONFLICT: ${id} begin=${beginCount} end=${endCount}`)
    error.code = 'GLOBAL_HOST_MARKER_CONFLICT'
    throw error
  }

  const block = `${markers.begin}\n${String(body || '').trim()}\n${markers.end}`
  if (beginCount === 0) {
    const prefix = text.trimEnd()
    return `${prefix}${prefix ? '\n\n' : ''}${block}\n`
  }

  const begin = text.indexOf(markers.begin)
  const end = text.indexOf(markers.end, begin) + markers.end.length
  return `${text.slice(0, begin)}${block}${text.slice(end)}`.replace(/\s*$/, '\n')
}

function assertManagedTomlTableIdentity(content, tableNames) {
  const text = String(content || '')
  const expected = new Set(tableNames || [])
  for (const match of text.matchAll(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/gm)) {
    const raw = match[1].trim()
    const normalized = raw.replace(/[\s"']/g, '')
    if (expected.has(normalized) && raw !== normalized) {
      const error = new Error(`GLOBAL_HOST_TOML_IDENTITY_CONFLICT: ${raw}`)
      error.code = 'GLOBAL_HOST_TOML_IDENTITY_CONFLICT'
      throw error
    }
  }
  for (const tableName of expected) {
    const escaped = tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`^\\s*${escaped}(?:\\.|\\s*=)`, 'm').test(text)) {
      const error = new Error(`GLOBAL_HOST_TOML_IDENTITY_CONFLICT: ${tableName}`)
      error.code = 'GLOBAL_HOST_TOML_IDENTITY_CONFLICT'
      throw error
    }
  }
}

function stripBareTomlTables(content, tableNames) {
  const expected = new Set(tableNames || [])
  const lines = String(content || '').split(/\r?\n/)
  const result = []
  let skipping = false
  for (const line of lines) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/)
    if (header) {
      const normalized = header[1].trim()
      if (expected.has(normalized)) {
        skipping = true
        continue
      }
      skipping = false
    }
    if (!skipping) result.push(line)
  }
  return result.join('\n')
}

function removeLegacyManagedBlock(content, markers) {
  const text = String(content || '')
  const beginCount = markerCount(text, markers.begin)
  const endCount = markerCount(text, markers.end)
  if (beginCount === 0 && endCount === 0) return text
  const begin = text.indexOf(markers.begin)
  const end = text.indexOf(markers.end, begin)
  if (beginCount !== 1 || endCount !== 1 || begin < 0 || end < begin) {
    const error = new Error(
      `GLOBAL_HOST_MARKER_CONFLICT: legacy begin=${beginCount} end=${endCount}`
    )
    error.code = 'GLOBAL_HOST_MARKER_CONFLICT'
    throw error
  }
  return `${text.slice(0, begin)}${text.slice(end + markers.end.length)}`.replace(/\n{3,}/g, '\n\n')
}

/**
 * Codex may write tool-policy subtables under DevCodex MCP servers inside the
 * managed block (for example approval_mode). Those tables are host-owned and must
 * survive re-merge / not trip GLOBAL_HOST_MANAGED_CONFIG_DRIFT.
 */
const CODEX_MCP_AUTHORITY_TABLES = Object.freeze([
  'mcp_servers.devcodex-memory',
  'mcp_servers.devcodex-profile'
])

function normalizeTomlTableName(name) {
  return String(name || '').trim().replace(/[\s"']/g, '')
}

function isCodexAuthorityMcpTable(name) {
  return CODEX_MCP_AUTHORITY_TABLES.includes(normalizeTomlTableName(name))
}

function isCodexHostOwnedMcpTable(name) {
  const normalized = normalizeTomlTableName(name)
  return CODEX_MCP_AUTHORITY_TABLES.some(table => normalized.startsWith(`${table}.tools.`))
}

function parseTomlSections(text) {
  const lines = String(text || '').split(/\r?\n/)
  const sections = []
  let current = { name: null, header: null, lines: [] }
  for (const line of lines) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/)
    if (header) {
      sections.push(current)
      current = {
        name: normalizeTomlTableName(header[1]),
        header: line,
        lines: []
      }
      continue
    }
    current.lines.push(line)
  }
  sections.push(current)
  return sections
}

function serializeTomlSections(sections) {
  const chunks = []
  for (const section of sections) {
    if (section.header == null) {
      const preamble = section.lines.join('\n').replace(/\s+$/, '')
      if (preamble) chunks.push(preamble)
      continue
    }
    const body = section.lines.join('\n').replace(/\s+$/, '')
    chunks.push(body ? `${section.header}\n${body}` : section.header)
  }
  return chunks.join('\n\n').replace(/\s+$/, '')
}

function extractManagedTomlBody(content, id = MANAGED_ID) {
  const text = String(content || '')
  const markers = markerTokens('toml', id)
  const begin = text.indexOf(markers.begin)
  const end = text.indexOf(markers.end, begin)
  if (begin < 0 || end < begin) return null
  return text.slice(begin + markers.begin.length, end).replace(/^\r?\n/, '').replace(/\s+$/, '')
}

function extractCodexHostOwnedMcpTables(body) {
  const owned = parseTomlSections(body).filter(section =>
    section.name && isCodexHostOwnedMcpTable(section.name)
  )
  return serializeTomlSections(owned)
}

function codexManagedAuthorityBody(body) {
  const sections = parseTomlSections(body)
  const preamble = sections.find(section => section.header == null)
  const authority = []
  if (preamble) authority.push(preamble)
  for (const tableName of CODEX_MCP_AUTHORITY_TABLES) {
    const section = sections.find(item => item.name === tableName)
    if (section) authority.push(section)
  }
  return serializeTomlSections(authority)
}

function composeCodexManagedBody(authorityBody, existingManagedBody) {
  const authority = String(authorityBody || '').trim()
  const owned = extractCodexHostOwnedMcpTables(existingManagedBody || '')
  if (!owned) return authority
  return `${authority}\n\n${owned}`
}

function unexpectedManagedTomlTables(body) {
  return parseTomlSections(body)
    .filter(section => section.name)
    .filter(section => !isCodexAuthorityMcpTable(section.name) && !isCodexHostOwnedMcpTable(section.name))
    .map(section => section.name)
}

function tomlManagedFileMatches(current, expectedFull, authorityBody, options = {}) {
  const id = options.id || MANAGED_ID
  const currentBody = extractManagedTomlBody(current, id)
  const expectedBody = extractManagedTomlBody(expectedFull, id)
  if (currentBody == null || expectedBody == null) {
    return String(current) === String(expectedFull)
  }
  if (unexpectedManagedTomlTables(currentBody).length) return false
  if (codexManagedAuthorityBody(currentBody) !== codexManagedAuthorityBody(authorityBody || expectedBody)) {
    return false
  }
  const markers = markerTokens('toml', id)
  const stripManaged = text => {
    const begin = text.indexOf(markers.begin)
    const end = text.indexOf(markers.end, begin)
    if (begin < 0 || end < begin) return text
    return `${text.slice(0, begin)}${text.slice(end + markers.end.length)}`
  }
  return stripManaged(String(current)).replace(/\s+/g, '\n').trim() ===
    stripManaged(String(expectedFull)).replace(/\s+/g, '\n').trim()
}

function mergeManagedTomlTables(content, body, options = {}) {
  const id = options.id || MANAGED_ID
  const tableNames = options.tableNames || []
  const source = (options.legacyMarkers || []).reduce(
    (text, markers) => removeLegacyManagedBlock(text, markers),
    String(content || '')
  )
  assertManagedTomlTableIdentity(source, tableNames)
  const markers = markerTokens('toml', id)
  const existingBody = extractManagedTomlBody(source, id)
  const nextBody = options.preserveHostOwnedMcpTools === false
    ? String(body || '').trim()
    : composeCodexManagedBody(body, existingBody)
  const merged = mergeManagedBlock(source, nextBody, { kind: 'toml', id })
  const begin = merged.indexOf(markers.begin)
  const end = merged.indexOf(markers.end, begin) + markers.end.length
  const before = stripBareTomlTables(merged.slice(0, begin), tableNames).trimEnd()
  const block = merged.slice(begin, end)
  const after = stripBareTomlTables(merged.slice(end), tableNames).trim()
  return `${before}${before ? '\n\n' : ''}${block}${after ? `\n${after}` : ''}\n`
}

function quoteToml(value) {
  return JSON.stringify(String(value || '').replace(/\\/g, '/'))
}

module.exports = {
  MANAGED_ID,
  CODEX_MCP_AUTHORITY_TABLES,
  codexManagedAuthorityBody,
  composeCodexManagedBody,
  deepMerge,
  extractCodexHostOwnedMcpTables,
  extractManagedTomlBody,
  isCodexAuthorityMcpTable,
  isCodexHostOwnedMcpTable,
  isPlainObject,
  isDevCodexManagedHookEntry,
  mergeArrays,
  mergeHostJsonContent,
  mergeJsonContent,
  mergeManagedHookMap,
  mergeManagedBlock,
  mergeManagedTomlTables,
  removeLegacyManagedBlock,
  parseJsonObject,
  parseTomlSections,
  quoteToml,
  stableKey,
  tomlManagedFileMatches,
  unexpectedManagedTomlTables
}
