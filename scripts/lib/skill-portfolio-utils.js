'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const LEGAL_STATES = new Set(['draft', 'gray', 'active', 'deprecated', 'retired', 'blocked'])
const TEXT_EXTENSIONS = new Set(['.md', '.js', '.cjs', '.json', '.ts', '.yml', '.yaml'])

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function canonicalizeTextForDigest(value) {
  return String(value).replace(/\r\n?/g, '\n')
}

function walk(root) {
  if (!fs.existsSync(root)) return []
  const out = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

function normalizePath(root, file) {
  return path.relative(root, file).replace(/\\/g, '/')
}

function parseFrontmatter(content, fallbackName) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const values = {}
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const separator = line.indexOf(':')
      if (separator < 0) continue
      values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
    }
  }
  return {
    name: values.name || fallbackName,
    description: values.description || ''
  }
}

function collectReferences(content, knownNames) {
  const refs = new Set()
  const patterns = [
    /(?:skills\/|\.\.\/)([a-z0-9-]+)\/SKILL\.md/g,
    /`([a-z0-9-]+)`\s+(?:Skill|skill)/g
  ]
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (knownNames.has(match[1])) refs.add(match[1])
    }
  }
  return Array.from(refs).sort()
}

function collectDependencies(content, knownNames) {
  const dependencies = new Set()
  for (const line of content.split(/\r?\n/)) {
    if (!/(?:必须(?:继续|先)?读取|must\s+(?:first\s+)?read)/i.test(line)) continue
    for (const match of line.matchAll(/`([a-z0-9-]+)`|(?:skills\/|\.\.\/)([a-z0-9-]+)\/SKILL\.md/g)) {
      const name = match[1] || match[2]
      if (knownNames.has(name)) dependencies.add(name)
    }
  }
  return Array.from(dependencies).sort()
}

function buildTriggerContract(id, description) {
  const terms = new Set([id])
  for (const match of description.matchAll(/`([A-Za-z0-9-]+)`|\b([A-Za-z][A-Za-z0-9-]{2,})\b/g)) {
    terms.add(match[1] || match[2])
  }
  return {
    terms: Array.from(terms).sort(),
    positive: [{ fixture: 'frontmatter-description-resolves', input: description }],
    negative: [{ fixture: 'empty-or-unregistered-trigger-rejected', input: '' }],
    ambiguous: []
  }
}

function classifyConsumer(relativePath) {
  if (/^(?:changelogs\/releases\/|website\/docs\/versions\/v1\/1\.0\.0\/)/.test(relativePath)) {
    return 'historical'
  }
  return 'current'
}

function listConsumerDocuments(root) {
  const excludedTop = new Set(['.git', '.devcodex', 'coverage', 'dist', 'node_modules', 'skills'])
  const files = []
  function visit(dir, depth = 0) {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && ((depth === 0 && excludedTop.has(entry.name)) || entry.name === 'node_modules' || entry.name === 'dist')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(full, depth + 1)
      else if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(full)
    }
  }
  visit(root)
  return files.sort().map(file => ({
    path: normalizePath(root, file),
    content: fs.readFileSync(file, 'utf8')
  }))
}

function percentile(values, ratio) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]
}

function detectCycles(nodes, edges) {
  const adjacency = new Map(nodes.map(node => [node, []]))
  for (const edge of edges) {
    if (adjacency.has(edge.from)) adjacency.get(edge.from).push(edge.to)
  }
  const visiting = new Set()
  const visited = new Set()
  const cycles = []

  function visit(node, stack) {
    if (visiting.has(node)) {
      const start = stack.indexOf(node)
      cycles.push(stack.slice(start).concat(node))
      return
    }
    if (visited.has(node)) return
    visiting.add(node)
    for (const next of adjacency.get(node) || []) visit(next, stack.concat(node))
    visiting.delete(node)
    visited.add(node)
  }
  for (const node of nodes) visit(node, [])
  return cycles
}

function buildPortfolio(root) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const pluginPath = path.join(root, 'plugin.json')
  const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf8'))
  const portfolioEvidencePath = path.join(root, 'skills', 'portfolio-evidence.json')
  const portfolioEvidence = JSON.parse(fs.readFileSync(portfolioEvidencePath, 'utf8'))
  if (portfolioEvidence.schemaVersion !== 1 || portfolioEvidence.ownerSkill !== 'skill-lifecycle-governance') {
    throw new Error('invalid skills/portfolio-evidence.json header')
  }
  const registered = new Map((plugin.skills || []).map(item => [item.id, item]))
  const skillFiles = walk(path.join(root, 'skills'))
    .filter(file => path.basename(file) === 'SKILL.md')
    .sort()
  const knownNames = new Set(skillFiles.map(file => path.basename(path.dirname(file))))
  const consumers = listConsumerDocuments(root)
  const sourceRows = []

  const skills = skillFiles.map(file => {
    const id = path.basename(path.dirname(file))
    const source = normalizePath(root, file)
    const content = fs.readFileSync(file, 'utf8')
    const canonicalContent = canonicalizeTextForDigest(content)
    const frontmatter = parseFrontmatter(content, id)
    const consumerRows = consumers
      .filter(item => item.content.includes(id))
      .map(item => ({ path: item.path, role: classifyConsumer(item.path) }))
    const registration = registered.get(id)
    const isRegistered = registration?.file === source
    const lifecycleState = isRegistered ? (registration.lifecycleState || 'active') : 'draft'
    if (isRegistered && !consumerRows.some(item => item.path === 'plugin.json')) {
      consumerRows.push({ path: 'plugin.json', role: 'current' })
    }
    consumerRows.sort((a, b) => a.path.localeCompare(b.path) || a.role.localeCompare(b.role))
    const references = collectReferences(content, knownNames).filter(name => name !== id)
    const dependencies = collectDependencies(content, knownNames).filter(name => name !== id)
    const validationProfile = consumerRows
      .filter(item => item.role === 'current' && /^scripts\/(?:test-|validate)/.test(item.path))
      .map(item => item.path)
    for (const fixture of portfolioEvidence.defaults.validationProfile) {
      if (!validationProfile.includes(fixture)) validationProfile.push(fixture)
    }
    validationProfile.sort()
    const override = portfolioEvidence.skills[id] || {}
    const currentConsumer = consumerRows.find(item => item.role === 'current')
    const operationalReadiness = {
      state: currentConsumer && isRegistered ? 'complete' : 'incomplete',
      currentConsumer: currentConsumer ? currentConsumer.path : null,
      positiveFixture: override.positiveFixture || portfolioEvidence.defaults.positiveFixture,
      negativeFixture: override.negativeFixture || portfolioEvidence.defaults.negativeFixture,
      rollbackToGray: override.rollbackToGray || portfolioEvidence.defaults.rollbackToGray,
      lastEvidenceAt: override.lastEvidenceAt || portfolioEvidence.evidenceDate
    }
    const conflicts = Array.isArray(override.conflicts) ? [...override.conflicts].sort() : []
    const hash = sha256(canonicalContent)
    sourceRows.push(`${source}:${hash}`)
    return {
      id,
      name: frontmatter.name,
      description: frontmatter.description,
      owner: id,
      triggers: buildTriggerContract(id, frontmatter.description),
      ownedArtifacts: [source],
      source,
      hash,
      version: packageJson.version,
      lifecycleState,
      dependencies,
      references,
      conflicts,
      conflictReview: {
        status: conflicts.length ? 'declared' : 'reviewed-none',
        evidence: override.conflictReviewEvidence || portfolioEvidence.defaults.conflictReviewEvidence
      },
      consumers: consumerRows,
      validationProfile,
      lastEvidenceAt: operationalReadiness.lastEvidenceAt,
      evidence: {
        registration: isRegistered ? 'plugin.json' : null,
        operationalReadiness,
        triggerPrecision: {
          state: 'structural-only',
          sampleCount: 0,
          precision: null,
          falsePositiveRate: null,
          falseNegativeRate: null,
          manualCorrectionRate: null,
          lastMeasuredAt: null
        },
        lifecycleAuthorization: 'plugin.json#skills[].lifecycleState',
        stateRationale: override.stateRationale || portfolioEvidence.defaults.stateRationale,
        promotionCriteria: override.promotionCriteria || portfolioEvidence.defaults.promotionCriteria
      }
    }
  }).sort((a, b) => a.id.localeCompare(b.id))

  const nodes = skills.map(skill => skill.id)
  const edges = skills.flatMap(skill => skill.dependencies.map(to => ({ from: skill.id, to })))
  const referenceEdges = skills.flatMap(skill => skill.references.map(to => ({ from: skill.id, to })))
  const cycles = detectCycles(nodes, edges)
  const orphanActive = skills
    .filter(skill => skill.lifecycleState === 'active' && !skill.consumers.some(item => item.role === 'current'))
    .map(skill => skill.id)

  return {
    schemaVersion: 1,
    package: packageJson.name,
    packageVersion: packageJson.version,
    generatedFrom: {
      skillsPattern: 'skills/*/SKILL.md',
      registry: 'plugin.json',
      sourceDigest: sha256(sourceRows.sort().join('\n')),
      pluginDigest: sha256(canonicalizeTextForDigest(fs.readFileSync(pluginPath, 'utf8'))),
      portfolioEvidence: 'skills/portfolio-evidence.json',
      portfolioEvidenceDigest: sha256(canonicalizeTextForDigest(fs.readFileSync(portfolioEvidencePath, 'utf8')))
    },
    ordering: 'skills.id asc; graph edges from/to asc',
    summary: {
      skillCount: skills.length,
      registeredSkillCount: registered.size,
      activeSkillCount: skills.filter(skill => skill.lifecycleState === 'active').length,
      graySkillCount: skills.filter(skill => skill.lifecycleState === 'gray').length,
      orphanActiveCount: orphanActive.length,
      dependencyCycleCount: cycles.length,
      dependencyEdgeCount: edges.length,
      conflictReviewedCount: skills.filter(skill => skill.conflictReview.status === 'reviewed-none' || skill.conflictReview.status === 'declared').length,
      operationalEvidenceCompleteCount: skills.filter(skill => skill.evidence.operationalReadiness.state === 'complete').length,
      triggerPrecisionMeasuredCount: skills.filter(skill => skill.evidence.triggerPrecision.state === 'measured').length,
      instructionBudgetP95Bytes: percentile(skillFiles.map(file => Buffer.byteLength(canonicalizeTextForDigest(fs.readFileSync(file, 'utf8')), 'utf8')), 0.95),
      triggerQuality: 'structural-only'
    },
    dependencyGraph: { nodes, edges, cycles },
    referenceGraph: { edges: referenceEdges.sort((a, b) => `${a.from}:${a.to}`.localeCompare(`${b.from}:${b.to}`)) },
    health: {
      orphanActive,
      lifecycleMutationAllowed: false,
      evidenceNote: 'Operational lifecycle evidence is complete for registered current consumers; trigger precision remains structural-only until real samples exist.'
    },
    skills
  }
}

function validatePortfolio(portfolio) {
  const errors = []
  const ids = new Set()
  for (const skill of portfolio.skills || []) {
    if (ids.has(skill.id)) errors.push(`duplicate skill id: ${skill.id}`)
    ids.add(skill.id)
    if (!LEGAL_STATES.has(skill.lifecycleState)) errors.push(`illegal lifecycle state: ${skill.id}=${skill.lifecycleState}`)
    if (!skill.source || !skill.hash || !skill.version) errors.push(`missing source/hash/version: ${skill.id}`)
    if (!skill.triggers || !Array.isArray(skill.triggers.terms) || !skill.triggers.terms.length) errors.push(`missing structured triggers: ${skill.id}`)
    if (!skill.conflictReview || !['reviewed-none', 'declared'].includes(skill.conflictReview.status)) errors.push(`missing conflict review: ${skill.id}`)
    if (skill.lifecycleState === 'active' && !skill.consumers.some(item => item.role === 'current')) {
      errors.push(`orphan active skill: ${skill.id}`)
    }
    if (skill.lifecycleState === 'active') {
      const operational = skill.evidence && skill.evidence.operationalReadiness
      for (const field of ['currentConsumer', 'positiveFixture', 'negativeFixture', 'rollbackToGray', 'lastEvidenceAt']) {
        if (!operational || !operational[field]) errors.push(`active skill missing ${field}: ${skill.id}`)
      }
      if (!skill.validationProfile || !skill.validationProfile.length) errors.push(`active skill missing validation profile: ${skill.id}`)
    }
    const triggerPrecision = skill.evidence && skill.evidence.triggerPrecision
    if (!triggerPrecision || !['structural-only', 'measured'].includes(triggerPrecision.state)) errors.push(`invalid trigger precision state: ${skill.id}`)
    if (triggerPrecision && triggerPrecision.state === 'measured' && triggerPrecision.sampleCount <= 0) errors.push(`measured trigger precision lacks samples: ${skill.id}`)
  }
  if ((portfolio.dependencyGraph && portfolio.dependencyGraph.cycles || []).length) {
    errors.push('dependency graph contains cycles')
  }
  if (portfolio.summary && portfolio.summary.skillCount !== ids.size) errors.push('summary skillCount mismatch')
  return errors
}

function serializePortfolio(portfolio) {
  return JSON.stringify(portfolio, null, 2) + '\n'
}

module.exports = {
  buildPortfolio,
  buildTriggerContract,
  canonicalizeTextForDigest,
  collectDependencies,
  detectCycles,
  parseFrontmatter,
  serializePortfolio,
  validatePortfolio
}
