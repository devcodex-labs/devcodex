#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { buildPublicProductProjection } = require('./lib/public-product-expression')

const ROOT = path.resolve(__dirname, '..')
const DATA_DIR = path.join(ROOT, 'public-site', 'data')
const DATA_FILE = path.join(DATA_DIR, 'public-product-projection.json')

function stableStringify (value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function readExistingProjection () {
  if (!fs.existsSync(DATA_FILE)) return null
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
}

function buildProjectionPayload (projection, options = {}) {
  return {
    schemaVersion: projection.schemaVersion,
    generatedAt: options.generatedAt || new Date().toISOString(),
    release: projection.release,
    expression: projection.expression,
    expressionCompatibility: projection.expressionCompatibility,
    workflows: projection.workflows,
    skills: projection.skills,
    capabilityScenarios: projection.capabilityScenarios,
    hosts: projection.hosts.map((host) => ({
      hostId: host.hostId,
      label: host.label,
      recommendedEntry: host.recommendedEntry,
      publicStatus: host.publicStatus,
      variantCount: host.variants.length
    })),
    sourceIdentities: projection.sourceIdentities
  }
}

function writeProjection (projection) {
  const payload = buildProjectionPayload(projection)
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(DATA_FILE, stableStringify(payload), 'utf8')
  return payload
}

function main () {
  const check = process.argv.includes('--check')
  const projection = buildPublicProductProjection({ root: ROOT })
  if (check) {
    const existing = readExistingProjection()
    if (!existing) {
      console.error(`public-site data missing: ${path.relative(ROOT, DATA_FILE).replace(/\\/g, '/')}`)
      process.exit(1)
    }
    const expected = buildProjectionPayload(projection, { generatedAt: existing.generatedAt })
    const currentText = stableStringify(existing)
    const expectedText = stableStringify(expected)
    if (currentText !== expectedText) {
      console.error('public-site data stale: run node scripts/generate-public-site-data.js')
      process.exit(1)
    }
    console.log(
      `public-site data fresh: skills=${projection.skills.total}/${projection.skills.active}/${projection.skills.gray}`
    )
    return
  }

  writeProjection(projection)

  console.log(
    `public-site data written: skills=${projection.skills.total}/${projection.skills.active}/${projection.skills.gray}`
  )
}

if (require.main === module) main()

module.exports = {
  buildProjectionPayload,
  writeProjection
}
