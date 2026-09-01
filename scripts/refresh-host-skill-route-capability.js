#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const {
  HostSkillRouteCapabilityError,
  promoteCodexSkillRouteCapability
} = require('./lib/host-skill-route-capability')

function optionValue (name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}

function main () {
  const rawEvidencePath = optionValue('--raw-evidence')
  const packageRoot = path.resolve(optionValue('--package-root') || path.join(__dirname, '..'))
  if (!rawEvidencePath) {
    throw new HostSkillRouteCapabilityError(
      'HOST_SKILL_ROUTE_RAW_EVIDENCE_REQUIRED',
      '--raw-evidence must identify a completed S15 JSON artifact'
    )
  }
  const resolvedRaw = path.resolve(rawEvidencePath)
  const stat = fs.lstatSync(resolvedRaw)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new HostSkillRouteCapabilityError(
      'HOST_SKILL_ROUTE_RAW_EVIDENCE_UNSAFE',
      '--raw-evidence must be a regular non-symlink file'
    )
  }
  const raw = JSON.parse(fs.readFileSync(resolvedRaw, 'utf8'))
  const receipt = promoteCodexSkillRouteCapability(raw, { packageRoot })
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
}

try {
  main()
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: 'BLOCK',
    code: error.code || 'HOST_SKILL_ROUTE_REFRESH_FAILED',
    message: String(error.message || error),
    details: error.details || null
  })}\n`)
  process.exitCode = 1
}
