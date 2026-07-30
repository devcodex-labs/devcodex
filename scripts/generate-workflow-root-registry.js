#!/usr/bin/env node
'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { buildBundle } = require('./lib/control-content-source')

const ROOT = path.resolve(__dirname, '..')
const OUTPUT = path.join(ROOT, 'hooks', '_runtime', 'workflow-root-registry.v1.json')
const CONTENT_SOURCES = [
  'instructions/01-common.instructions.md',
  'skills/routing/SKILL.md'
]
const CODE_SOURCES = ['scripts/lib/host-parity-scorecard.js']

function sha256 (value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex')
}

function stableStringify (value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${stableStringify(value[key])}`
  ).join(',')}}`
}

function root (skillId, loadStage = 'entry', budgetClass = 'hard') {
  return { skillId, budgetClass, loadStage }
}

function parseInstructionRoutes (text) {
  const routes = []
  let inTable = false
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('| 工作流.子类型 |')) {
      inTable = true
      continue
    }
    if (!inTable) continue
    if (!line.startsWith('|')) break
    if (/^\|[-\s|]+$/.test(line)) continue
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim())
    if (cells.length < 2 || !cells[0]) continue
    const skillIds = [...cells[1].matchAll(/`([A-Za-z0-9][A-Za-z0-9._-]*)`/g)]
      .map(match => match[1])
    routes.push({
      routeKey: cells[0],
      roots: skillIds.map(skillId => root(skillId))
    })
  }
  return routes
}

function commonBase (includeCloseout = true) {
  const roots = [
    root('intent'),
    root('compliance'),
    root('user-visible-output-contract')
  ]
  if (includeCloseout) {
    roots.push(root('report', 'closeout'))
    roots.push(root('memory', 'closeout'))
  }
  return roots
}

function buildRegistry () {
  const contentBundle = buildBundle(ROOT)
  const contentByRelative = new Map(contentBundle.files.map(file => [file.relative, file]))
  const sourceEvidence = CONTENT_SOURCES.map(relative => {
    const entry = contentByRelative.get(relative)
    if (!entry) throw new Error(`missing content asset: ${relative}`)
    return { ref: `content:${relative}`, digest: entry.outputDigest }
  }).concat(CODE_SOURCES.map(relative => {
    const content = fs.readFileSync(path.join(ROOT, relative), 'utf8')
    return { ref: relative, digest: sha256(content) }
  }))
  const instructionText = contentByRelative.get('instructions/01-common.instructions.md').content
  const routes = parseInstructionRoutes(instructionText)
  assert(routes.length >= 20, `expected workflow table coverage, got ${routes.length}`)
  assert.strictEqual(
    new Set(routes.map(route => route.routeKey)).size,
    routes.length,
    'workflow route keys must be unique'
  )

  const baseBundles = {
    chat: [],
    resume: [
      root('intent'),
      root('compliance'),
      root('user-visible-output-contract'),
      root('memory', 'closeout')
    ],
    analyze: commonBase(),
    audit: commonBase(),
    dev: commonBase(),
    fix: commonBase(),
    'self-fix': commonBase(),
    other: commonBase()
  }
  const conditionals = [
    {
      conditionId: 'control-plane',
      intents: ['dev', 'fix', 'self-fix'],
      roots: [root('spec-governance', 'execution:control-plane')],
      activationAuthority: 'model',
      mutualExclusionGroup: null,
      sourceRef: 'content:skills/routing/SKILL.md#按需触发-Skills'
    },
    {
      conditionId: 'test-validation',
      intents: ['dev', 'fix', 'self-fix'],
      roots: [root('test-router', 'execution:test-validation')],
      activationAuthority: 'model',
      mutualExclusionGroup: null,
      sourceRef: 'content:skills/routing/SKILL.md#按需触发-Skills'
    },
    {
      conditionId: 'host-contract',
      intents: ['dev', 'fix', 'audit', 'analyze'],
      roots: [root('host-contract-verification', 'execution:host-contract')],
      activationAuthority: 'model',
      mutualExclusionGroup: null,
      sourceRef: 'content:skills/routing/SKILL.md#按需触发-Skills'
    },
    {
      conditionId: 'release',
      intents: ['dev', 'fix', 'audit'],
      roots: [
        root('audit-release', 'execution:release'),
        root('release-verification', 'execution:release')
      ],
      activationAuthority: 'model',
      mutualExclusionGroup: null,
      sourceRef: 'content:skills/routing/SKILL.md#按需触发-Skills'
    }
  ]

  const registry = {
    schemaVersion: 'WorkflowRootRegistryV1',
    sourceEvidence,
    sourceDigest: sha256(stableStringify(sourceEvidence)),
    baseBundles,
    routes,
    conditionals,
    registryDigest: ''
  }
  registry.registryDigest = sha256(stableStringify({
    schemaVersion: registry.schemaVersion,
    baseBundles,
    routes,
    conditionals
  }))
  return registry
}

function main () {
  const expected = `${JSON.stringify(buildRegistry(), null, 2)}\n`
  if (process.argv.includes('--check')) {
    const actual = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : ''
    if (actual !== expected) {
      console.error('workflow root registry is stale; run node scripts/generate-workflow-root-registry.js')
      process.exitCode = 1
      return
    }
    console.log('workflow root registry is deterministic and current')
    return
  }
  fs.writeFileSync(OUTPUT, expected, 'utf8')
  console.log(`wrote ${path.relative(ROOT, OUTPUT).replace(/\\/g, '/')}`)
}

if (require.main === module) main()

module.exports = {
  buildRegistry,
  parseInstructionRoutes,
  stableStringify
}
