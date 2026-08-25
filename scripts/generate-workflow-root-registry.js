#!/usr/bin/env node
'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { buildBundle } = require('./lib/control-content-source')

const ROOT = path.resolve(__dirname, '..')
const OUTPUT_V1 = path.join(ROOT, 'hooks', '_runtime', 'workflow-root-registry.v1.json')
const OUTPUT_V2 = path.join(ROOT, 'hooks', '_runtime', 'workflow-root-registry.v2.json')
const V1_CONTENT_SOURCES = [
  'instructions/01-common.instructions.md',
  'skills/routing/SKILL.md'
]
const V2_CONTENT_SOURCES = [
  ...V1_CONTENT_SOURCES,
  'skills/routing/workflow-capabilities.json'
]
const CONTENT_SOURCES = [...new Set(V2_CONTENT_SOURCES)]
const CODE_SOURCES = ['scripts/lib/host-parity-scorecard.js']

const ROUTE_OWNER_OVERRIDES = Object.freeze({
  'dev.plan-review': 'dev-plan-review',
  'audit.规范文件': 'audit-dimensions',
  'audit.技术方案': 'audit-tech-design',
  'audit.需求文档': 'audit-requirements',
  'audit.项目工程': 'audit-project',
  'audit.报告': 'audit-report',
  'audit.通用文档': 'audit-document',
  'audit.发布前审查': 'audit-release'
})

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

function loadContentByRelative (rootDir = ROOT, requestedSources = CONTENT_SOURCES) {
  const manifestPath = path.join(rootDir, 'content', 'manifest.json')
  if (fs.existsSync(manifestPath)) {
    const contentBundle = buildBundle(rootDir)
    const files = new Map(contentBundle.files.map(file => [file.relative, file]))
    for (const relative of requestedSources) {
      if (files.has(relative)) continue
      const explicitFile = path.join(rootDir, 'content', relative)
      if (!fs.existsSync(explicitFile)) continue
      const content = fs.readFileSync(explicitFile, 'utf8')
      files.set(relative, {
        relative,
        content,
        outputDigest: sha256(content)
      })
    }
    return files
  }

  // npm packages contain the rendered control-content projection, not its source manifest.
  return new Map(requestedSources.map(relative => {
    const file = path.join(rootDir, relative)
    if (!fs.existsSync(file)) throw new Error(`missing packaged content asset: ${relative}`)
    const content = fs.readFileSync(file, 'utf8')
    return [relative, {
      relative,
      content,
      outputDigest: sha256(content)
    }]
  }))
}

function buildRegistry (rootDir = ROOT) {
  const contentByRelative = loadContentByRelative(rootDir, V1_CONTENT_SOURCES)
  const sourceEvidence = V1_CONTENT_SOURCES.map(relative => {
    const entry = contentByRelative.get(relative)
    if (!entry) throw new Error(`missing content asset: ${relative}`)
    return { ref: `content:${relative}`, digest: entry.outputDigest }
  }).concat(CODE_SOURCES.map(relative => {
    const content = fs.readFileSync(path.join(rootDir, relative), 'utf8')
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

function topIntentForRoute (routeKey) {
  if (routeKey === 'self-fix') return 'self-fix'
  if (['other', 'chat', 'resume'].includes(routeKey)) return routeKey
  return String(routeKey).split('.')[0]
}

function subtypeForRoute (routeKey) {
  const separator = String(routeKey).indexOf('.')
  return separator === -1 ? String(routeKey) : String(routeKey).slice(separator + 1)
}

function routeOwner (route) {
  const override = ROUTE_OWNER_OVERRIDES[route.routeKey]
  if (override) return { kind: 'skill', id: override }
  const supporting = new Set(['cp-gate', 'audit-common', 'audit-session'])
  const owner = route.roots.find(candidate => !supporting.has(candidate.skillId))
  return owner
    ? { kind: 'skill', id: owner.skillId }
    : { kind: 'instruction', id: `instruction:${route.routeKey}` }
}

function workflowPolicy (workflow) {
  const verificationMode = workflow.id === 'resume'
    ? 'inherited-after-rehydrate'
    : (workflow.mutation === 'allowed-after-confirmation' ? 'affected-v0-v2' : 'read-only')
  return {
    mutationPolicy: workflow.mutation,
    cpPolicy: {
      cp1: workflow.cp1,
      cp2: workflow.cp2,
      cp3: workflow.cp3,
      cp3Rule: workflow.cp3Rule
    },
    artifactPolicy: {
      primaryArtifacts: workflow.primaryArtifacts,
      writePolicy: workflow.mutation
    },
    verificationPolicy: {
      mode: verificationMode,
      executionAuthorityRequired: workflow.mutation !== 'forbidden'
    },
    resumePolicy: {
      mode: workflow.id === 'resume' ? 'rehydrate-return' : 'persist-round-trip',
      terminalAction: 'unbind'
    }
  }
}

function buildRegistryV2 (rootDir = ROOT) {
  const v1 = buildRegistry(rootDir)
  const contentByRelative = loadContentByRelative(rootDir, V2_CONTENT_SOURCES)
  const sourceEvidence = V2_CONTENT_SOURCES.map(relative => {
    const entry = contentByRelative.get(relative)
    if (!entry) throw new Error(`missing content asset: ${relative}`)
    return { ref: `content:${relative}`, digest: entry.outputDigest }
  }).concat(CODE_SOURCES.map(relative => {
    const content = fs.readFileSync(path.join(rootDir, relative), 'utf8')
    return { ref: relative, digest: sha256(content) }
  }))
  const capabilityEntry = contentByRelative.get('skills/routing/workflow-capabilities.json')
  const capabilityMatrix = JSON.parse(capabilityEntry.content)
  assert.strictEqual(capabilityMatrix.schemaVersion, 1, 'workflow capability schema must remain readable')
  const workflowPolicies = Object.fromEntries(
    [...capabilityMatrix.workflows]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(workflow => [workflow.id, workflowPolicy(workflow)])
  )
  const routes = v1.routes.map(route => ({
    routeKey: route.routeKey,
    topIntent: topIntentForRoute(route.routeKey),
    subtype: subtypeForRoute(route.routeKey),
    stage: route.routeKey === 'dev.plan-review'
      ? 'internal-step'
      : (route.routeKey === 'resume' ? 'rehydrate' : 'entry'),
    disposition: 'active',
    routeOwner: routeOwner(route),
    roots: route.roots,
    policyRef: topIntentForRoute(route.routeKey),
    migration: null
  }))
  assert.strictEqual(routes.length, 24, `expected 24 canonical routes, got ${routes.length}`)
  assert.strictEqual(new Set(routes.map(route => route.routeKey)).size, 24, 'V2 route keys must be exclusive')
  for (const route of routes) {
    assert(workflowPolicies[route.policyRef], `missing workflow policy for ${route.routeKey}`)
    if (route.routeOwner.kind === 'skill') {
      assert(route.roots.some(root => root.skillId === route.routeOwner.id), `route owner missing from roots: ${route.routeKey}`)
    }
  }
  const revisionCore = {
    schemaVersion: 'WorkflowRootRegistryV2',
    environmentModes: ['dev', 'prod'],
    workflowPolicies,
    baseBundles: v1.baseBundles,
    routes,
    conditionals: v1.conditionals
  }
  const sourceDigest = sha256(stableStringify(sourceEvidence))
  const routeRevision = sha256(stableStringify(revisionCore))
  return {
    ...revisionCore,
    sourceEvidence,
    sourceDigest,
    routeRevision,
    registryDigest: sha256(stableStringify({
      ...revisionCore,
      sourceDigest,
      routeRevision
    }))
  }
}

function main () {
  const outputs = [
    { file: OUTPUT_V1, expected: `${JSON.stringify(buildRegistry(), null, 2)}\n` },
    { file: OUTPUT_V2, expected: `${JSON.stringify(buildRegistryV2(), null, 2)}\n` }
  ]
  if (process.argv.includes('--check')) {
    const stale = []
    for (const output of outputs) {
      const actual = fs.existsSync(output.file) ? fs.readFileSync(output.file, 'utf8') : ''
      if (actual !== output.expected) stale.push(path.relative(ROOT, output.file).replace(/\\/g, '/'))
    }
    if (stale.length) {
      console.error(`workflow root registry is stale: ${stale.join(', ')}; run node scripts/generate-workflow-root-registry.js`)
      process.exitCode = 1
      return
    }
    console.log('workflow root registries V1/V2 are deterministic and current')
    return
  }
  for (const output of outputs) {
    fs.writeFileSync(output.file, output.expected, 'utf8')
    console.log(`wrote ${path.relative(ROOT, output.file).replace(/\\/g, '/')}`)
  }
}

if (require.main === module) main()

module.exports = {
  buildRegistry,
  buildRegistryV2,
  loadContentByRelative,
  parseInstructionRoutes,
  stableStringify
}
