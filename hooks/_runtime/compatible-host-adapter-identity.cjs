'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const identity = require('./host-adapter-identity.cjs')
const baseHostAdapterDigest = identity.getLifecycleHostAdapterDigest

const COMPATIBLE_VARIANTS = new Set([
  identity.HOST_VARIANTS.claude,
  identity.HOST_VARIANTS.cursor
])
const COMPATIBLE_ENTRY_FILES = Object.freeze([
  'compatible-host-adapter-identity.cjs',
  'lifecycle-cursor-compatible-preload.cjs',
  'lifecycle-cursor-compatible.cjs'
])

function sha256 (value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function getCompatibleLifecycleHostAdapterDigest (host, options = {}) {
  const hostVariant = identity.normalizeHostVariant(host)
  const baseDigest = baseHostAdapterDigest(host, options)
  if (!COMPATIBLE_VARIANTS.has(hostVariant)) return baseDigest

  const fsImpl = options.fs || fs
  const runtimeRoot = path.resolve(options.runtimeRoot || __dirname)
  const files = COMPATIBLE_ENTRY_FILES.map(name => ({
    name,
    digest: sha256(fsImpl.readFileSync(path.join(runtimeRoot, name)))
  }))
  return sha256(JSON.stringify({
    schemaVersion: 'CompatibleHostAdapterIdentityV1',
    hostVariant,
    baseDigest,
    files
  }))
}

module.exports = {
  COMPATIBLE_ENTRY_FILES,
  getCompatibleLifecycleHostAdapterDigest
}
