#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const {
  evaluateSkillRouteRetirement
} = require('../hooks/_runtime/skill-route-retirement-gate.cjs')
const {
  HOST_VARIANTS,
  getLifecycleHostAdapterDigest
} = require('../hooks/_runtime/host-adapter-identity.cjs')
const {
  getRuntimeContractDigest
} = require('../hooks/_runtime/skill-route-mode.cjs')
const {
  getGrokLauncherAdapterDigest
} = require('./lib/grok-workspace-launcher.js')
const {
  resolveDefaultActiveRoot
} = require('./lib/runtime-state-index.js')

const SOURCE_ROOT = path.resolve(__dirname, '..')
const argv = process.argv.slice(2)

function argument (name, fallback = null) {
  const index = argv.indexOf(name)
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback
}

function collectEvidenceFiles (evidenceDir) {
  if (!fs.existsSync(evidenceDir)) return []
  return fs.readdirSync(evidenceDir, { withFileTypes: true })
    .filter(entry =>
      entry.isFile() &&
      /^skill-route-s15-.*\.json$/i.test(entry.name) &&
      !entry.name.endsWith('.failure.json')
    )
    .map(entry => path.join(evidenceDir, entry.name))
    .sort((left, right) => left.localeCompare(right))
}

const activeRoot = path.resolve(
  argument('--root', process.env.DEVCODEX_ACTIVE_ROOT || resolveDefaultActiveRoot(SOURCE_ROOT))
)
const evidenceDir = path.resolve(argument('--evidence-dir', path.join(activeRoot, '.audit-state')))
const files = collectEvidenceFiles(evidenceDir)
const evidence = []
const unreadable = []

for (const file of files) {
  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (record.schemaVersion === 'SkillRouteS15EvidenceV1') evidence.push(record)
  } catch (error) {
    unreadable.push({
      file,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

const currentRuntimeDigest = getRuntimeContractDigest()
const currentHostAdapterDigests = Object.fromEntries(
  Object.entries(HOST_VARIANTS).map(([host, hostVariant]) => [
    hostVariant,
    host === 'grok'
      ? getGrokLauncherAdapterDigest()
      : getLifecycleHostAdapterDigest(host)
  ])
)
const result = evaluateSkillRouteRetirement({
  evidence,
  currentRuntimeDigest,
  currentHostAdapterDigests
})
const receipt = {
  schemaVersion: 'SkillRouteRetirementCheckReceiptV1',
  checkedAt: new Date().toISOString(),
  activeRoot,
  evidenceDir,
  evidenceFilesScanned: files.length,
  evidenceRecordsLoaded: evidence.length,
  unreadable,
  currentRuntimeDigest,
  currentHostAdapterDigests,
  gate: result
}

process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
if (argv.includes('--strict') && result.status !== 'PASS') process.exitCode = 1
