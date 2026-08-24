#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { buildPublicProductProjection } = require('./lib/public-product-expression')

const ROOT = path.resolve(__dirname, '..')
const DATA_DIR = path.join(ROOT, 'public-site', 'data')
const DATA_FILE = path.join(DATA_DIR, 'public-product-projection.json')

function writeProjection (projection) {
  const payload = {
    schemaVersion: projection.schemaVersion,
    generatedAt: new Date().toISOString(),
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
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(DATA_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return payload
}

function main () {
  const projection = buildPublicProductProjection({ root: ROOT })
  writeProjection(projection)

  console.log(
    `public-site data written: skills=${projection.skills.total}/${projection.skills.active}/${projection.skills.gray}`
  )
}

if (require.main === module) main()

module.exports = {
  writeProjection
}
