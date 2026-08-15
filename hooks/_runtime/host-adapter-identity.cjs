'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const HOST_VARIANTS = Object.freeze({
  claude: 'claude-code/print-user-global-local-stdio',
  codex: 'codex-cli/exec-user-global-local-stdio',
  codexdesktop: 'codex-desktop/app-user-global-local-stdio',
  copilot: 'copilot-cli/print-user-global-local-stdio',
  gemini: 'gemini-cli/headless-user-global-local-stdio',
  grok: 'grok-cli-single/global-launcher-local-stdio',
  cursor: 'cursor/local-ide-cli-headless-user-global-stdio-beta'
})

const HOST_ENTRY_SURFACES = Object.freeze({
  claude: 'claude-cli-print',
  codex: 'codex-cli-exec',
  codexdesktop: 'codex-desktop-app',
  copilot: 'copilot-cli-print',
  gemini: 'gemini-cli-headless',
  grok: 'grok-cli-single',
  cursor: 'cursor-cli-headless'
})

const ENTRY_SURFACE_VARIANTS = Object.freeze(Object.fromEntries(
  Object.entries(HOST_ENTRY_SURFACES).map(([hostId, entrySurface]) => [
    entrySurface,
    HOST_VARIANTS[hostId]
  ])
))

const HOST_ALIASES = Object.freeze({
  'claude-code': 'claude',
  'codex-desktop': 'codexdesktop',
  'github-copilot': 'copilot',
  'gemini-cli': 'gemini',
  'grok-cli-single': 'grok',
  'grok-single': 'grok',
  'cursor-cli': 'cursor',
  'cursor-ide': 'cursor'
})

function sha256 (value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function normalizeHostId (host) {
  const value = String(host || '').trim().toLowerCase()
  if (Object.prototype.hasOwnProperty.call(HOST_VARIANTS, value)) return value
  return HOST_ALIASES[value] || ''
}

function isCodexDesktopEnvironment (env = {}, options = {}) {
  const originator = String(env?.CODEX_INTERNAL_ORIGINATOR_OVERRIDE || '').trim()
  const threadId = String(env?.CODEX_THREAD_ID || '').trim()
  if (!threadId) return false
  const sessionId = String(
    options.sessionId || options.session_id || options.payload?.session_id || options.payload?.sessionId || ''
  ).trim()
  if (sessionId) return sessionId === threadId
  return /^codex desktop$/i.test(originator)
}

function normalizeHostVariant (host, options = {}) {
  const value = String(host || '').trim().toLowerCase()
  if (Object.values(HOST_VARIANTS).includes(value)) return value
  const entrySurface = String(options.entrySurface || '').trim().toLowerCase()
  if (entrySurface) {
    return ENTRY_SURFACE_VARIANTS[entrySurface] || `${entrySurface}/unsupported`
  }
  const hostId = normalizeHostId(value)
  if (hostId === 'codex' && isCodexDesktopEnvironment(options.env || process.env, options)) {
    return HOST_VARIANTS.codexdesktop
  }
  return HOST_VARIANTS[hostId] || `${value || 'unknown'}/unsupported`
}

function getLifecycleHostAdapterDigest (host, options = {}) {
  const fsImpl = options.fs || fs
  const hostVariant = normalizeHostVariant(host, options)
  const runtimeRoot = path.resolve(options.runtimeRoot || __dirname)
  const files = [
    'host-adapter-identity.cjs',
    'host-hook-launcher.cjs',
    'lifecycle-host-adapters.cjs',
    'lifecycle.cjs'
  ].map(name => ({
    name,
    digest: sha256(fsImpl.readFileSync(path.join(runtimeRoot, name)))
  }))
  return sha256(JSON.stringify({
    schemaVersion: 'HostAdapterIdentityV1',
    hostVariant,
    files
  }))
}

module.exports = {
  ENTRY_SURFACE_VARIANTS,
  HOST_ENTRY_SURFACES,
  HOST_VARIANTS,
  getLifecycleHostAdapterDigest,
  isCodexDesktopEnvironment,
  normalizeHostId,
  normalizeHostVariant
}
