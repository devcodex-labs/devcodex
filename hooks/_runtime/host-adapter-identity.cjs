'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const HOST_VARIANTS = Object.freeze({
  claude: 'claude-code/print-user-global-local-stdio',
  codex: 'codex-cli/exec-user-global-local-stdio',
  codexdesktop: 'codex-desktop/app-user-global-local-stdio',
  copilot: 'copilot-cli/print-user-global-local-stdio',
  copilotide: 'github-copilot-ide/local-hook-surface',
  gemini: 'gemini-cli/headless-user-global-local-stdio',
  grok: 'grok-cli-single/global-launcher-local-stdio',
  grokpassive: 'grok/passive-plain-instruction-only',
  cursor: 'cursor/local-ide-cli-headless-user-global-stdio-beta',
  cursorcloud: 'cursor/cloud-agent-instruction-only'
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

const HOST_IDENTITY_SCHEMA = 'HostIdentityV2'
const DIRECT_EVENT_NAMES = new Set([
  'userpromptsubmit', 'pretooluse', 'posttooluse', 'posttoolusefailure',
  'precompact', 'stop', 'sessionstart', 'sessionend', 'beforeagent', 'afteragent'
])

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

function eventNameFrom (options = {}) {
  return String(
    options.eventName || options.event || options.payload?.hookEventName ||
    options.payload?.hook_event_name || options.payload?.eventName || options.payload?.event || ''
  ).trim()
}

function normalizedEventName (options = {}) {
  return eventNameFrom(options).toLowerCase().replace(/[^a-z]/g, '')
}

function directExecutionSurface (hostId, options = {}) {
  const env = options.env || process.env
  const payload = options.payload || {}
  const handshake = options.directHandshake && typeof options.directHandshake === 'object'
    ? options.directHandshake
    : {}
  const explicitSurface = String(
    handshake.executionSurface || options.officialExecutionSurface ||
    payload.devcodexExecutionSurface || payload.devcodex_execution_surface || ''
  ).trim().toLowerCase()
  if (hostId === 'codex') {
    return isCodexDesktopEnvironment(env, options) ? 'desktop-app' : 'cli'
  }
  if (hostId === 'copilot') {
    return ['ide', 'copilot-ide', 'github-copilot-ide'].includes(explicitSurface) ? 'ide' : 'cli'
  }
  if (hostId === 'cursor') {
    const cloudMarker = explicitSurface === 'cursor-cloud-agent' || explicitSurface === 'cloud-agent' ||
      String(env.CURSOR_CLOUD_AGENT || '').trim() === '1'
    return cloudMarker ? 'cloud-agent' : 'local'
  }
  if (hostId === 'grok') {
    const trustedHook = options.trustedHostEvent === true || handshake.trustedHook === true ||
      payload.devcodexTrustedHook === true
    return trustedHook ? 'trusted-hook-or-plugin' : 'passive-plain'
  }
  if (hostId === 'claude') return 'cli'
  if (hostId === 'gemini') return 'cli'
  return explicitSurface || 'portable-plain'
}

function variantForIdentity (hostId, surface, options = {}) {
  if (hostId === 'codex') return surface === 'desktop-app' ? HOST_VARIANTS.codexdesktop : HOST_VARIANTS.codex
  if (hostId === 'copilot') return surface === 'ide' ? HOST_VARIANTS.copilotide : HOST_VARIANTS.copilot
  if (hostId === 'cursor') return surface === 'cloud-agent' ? HOST_VARIANTS.cursorcloud : HOST_VARIANTS.cursor
  if (hostId === 'grok') return surface === 'passive-plain' ? HOST_VARIANTS.grokpassive : HOST_VARIANTS.grok
  return HOST_VARIANTS[hostId] || `${hostId || 'unknown'}/unsupported`
}

function booleanPolicyEnabled (options = {}) {
  if (typeof options.policyEnabled === 'boolean') return options.policyEnabled
  const env = options.env || process.env
  const value = String(env.DEVCODEX_HOOK_ENFORCEMENT || '').trim().toLowerCase()
  return value === 'strict' || value === 'enabled' || value === '1' || value === 'true'
}

function buildHostIdentityV2 (host, options = {}) {
  const hostId = normalizeHostId(host)
  const eventName = normalizedEventName(options)
  const directEvent = options.trustedHostEvent === true && DIRECT_EVENT_NAMES.has(eventName)
  const handshake = options.directHandshake && typeof options.directHandshake === 'object'
    ? options.directHandshake
    : null
  const directHandshake = handshake?.verified === true
  const executionSurface = directExecutionSurface(hostId, options)
  const hostVariant = variantForIdentity(hostId, executionSurface, options)
  const installed = options.installed === true || options.installationEvidence?.installed === true
  const policyEnabled = booleanPolicyEnabled(options)
  const directReplay = options.directReplay === true && (directEvent || directHandshake)
  const instructionOnly = executionSurface === 'cloud-agent' || executionSurface === 'passive-plain'
  const evidenceRefs = []
  if (directEvent) evidenceRefs.push(`current-event:${eventName}`)
  if (directHandshake) evidenceRefs.push(`direct-handshake:${String(handshake.handshakeId || 'verified').slice(0, 128)}`)
  if (hostId === 'codex' && executionSurface === 'desktop-app') evidenceRefs.push('official-env:CODEX_THREAD_ID')
  if (hostId === 'cursor' && executionSurface === 'cloud-agent') evidenceRefs.push('official-env-or-handshake:cursor-cloud-agent')
  if (installed) evidenceRefs.push('installation-evidence:availability-only')
  let capability = 'unverified'
  let claimCeiling = 'unverified'
  let confidence = 'unverified'
  if (instructionOnly) {
    capability = 'instruction-only'
    claimCeiling = 'instruction-only'
    confidence = directEvent || directHandshake ? 'medium' : 'low'
  } else if (directReplay && policyEnabled) {
    capability = 'direct-replay-enforcement'
    claimCeiling = 'hard-enforcement'
    confidence = 'high'
  } else if (directEvent || directHandshake) {
    capability = 'host-event-observed'
    claimCeiling = 'event-observed'
    confidence = directHandshake ? 'high' : 'medium'
  } else if (hostId) {
    capability = 'portable-observation'
    claimCeiling = 'plan-only'
    confidence = 'low'
  }
  const core = {
    schemaVersion: HOST_IDENTITY_SCHEMA,
    hostFamily: hostId || 'unknown',
    hostVariant,
    executionSurface,
    capability,
    installed,
    policyEnabled,
    directReplay,
    evidenceRefs: [...new Set(evidenceRefs)].sort(),
    confidence,
    claimCeiling
  }
  return Object.freeze({ ...core, identityDigest: sha256(JSON.stringify(core)) })
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
    schemaVersion: HOST_IDENTITY_SCHEMA,
    hostVariant,
    files
  }))
}

module.exports = {
  ENTRY_SURFACE_VARIANTS,
  HOST_ENTRY_SURFACES,
  HOST_IDENTITY_SCHEMA,
  HOST_VARIANTS,
  buildHostIdentityV2,
  getLifecycleHostAdapterDigest,
  isCodexDesktopEnvironment,
  normalizeHostId,
  normalizeHostVariant
}
