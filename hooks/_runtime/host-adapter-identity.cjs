'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const HOST_VARIANTS = Object.freeze({
  claude: 'claude-code/print-user-global-local-stdio',
  codex: 'codex-cli/exec-user-global-local-stdio',
  copilot: 'copilot-cli/print-user-global-local-stdio',
  gemini: 'gemini-cli/headless-user-global-local-stdio',
  grok: 'grok-cli-single/global-launcher-local-stdio',
  cursor: 'cursor/local-ide-cli-headless-user-global-stdio-beta'
})

const HOST_ALIASES = Object.freeze({
  'claude-code': 'claude',
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

function normalizeHostVariant (host) {
  const value = String(host || '').trim().toLowerCase()
  if (Object.values(HOST_VARIANTS).includes(value)) return value
  const hostId = normalizeHostId(value)
  return HOST_VARIANTS[hostId] || `${value || 'unknown'}/unsupported`
}

function getLifecycleHostAdapterDigest (host, options = {}) {
  const fsImpl = options.fs || fs
  const hostVariant = normalizeHostVariant(host)
  const runtimeRoot = path.resolve(options.runtimeRoot || __dirname)
  const files = [
    'host-adapter-identity.cjs',
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
  HOST_VARIANTS,
  getLifecycleHostAdapterDigest,
  normalizeHostId,
  normalizeHostVariant
}
