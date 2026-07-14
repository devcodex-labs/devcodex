'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const LEGAL_STATES = new Set(['draft', 'gray', 'active', 'deprecated', 'retired', 'blocked'])
const TEXT_EXTENSIONS = new Set(['.md', '.js', '.cjs', '.json', '.ts', '.yml', '.yaml'])

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
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
    const validationProfile = consumerRows
      .filter(item => item.role === 'current' && /^scripts\/(?:test-|validate)/.test(item.path))
      .map(item => item.path)
    const hash = sha256(content)
    sourceRows.push(`${source}:${hash}`)
    return {
      id,
      name: frontmatter.name,
      description: frontmatter.description,
      owner: id,
      triggers: frontmatter.description ? [frontmatter.description] : [],
      ownedArtifacts: [source],
      source,
      hash,
      version: packageJson.version,
      lifecycleState,
      dependencies: [],
      references,
      conflicts: [],
      consumers: consumerRows,
      validationProfile,
      evidence: {
        registration: isRegistered ? 'plugin.json' : null,
        triggerQuality: 'insufficient-evidence',
        lastEvidenceAt: null
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
      pluginDigest: sha256(fs.readFileSync(pluginPath))
    },
    ordering: 'skills.id asc; graph edges from/to asc',
    summary: {
      skillCount: skills.length,
      registeredSkillCount: registered.size,
      activeSkillCount: skills.filter(skill => skill.lifecycleState === 'active').length,
      graySkillCount: skills.filter(skill => skill.lifecycleState === 'gray').length,
      orphanActiveCount: orphanActive.length,
      dependencyCycleCount: cycles.length,
      instructionBudgetP95Bytes: percentile(skillFiles.map(file => fs.statSync(file).size), 0.95),
      triggerQuality: 'insufficient-evidence'
    },
    dependencyGraph: { nodes, edges, cycles },
    referenceGraph: { edges: referenceEdges.sort((a, b) => `${a.from}:${a.to}`.localeCompare(`${b.from}:${b.to}`)) },
    health: {
      orphanActive,
      lifecycleMutationAllowed: false,
      evidenceNote: 'Static repository evidence only; trigger precision and lifecycle changes require real samples.'
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
    if (skill.lifecycleState === 'active' && !skill.consumers.some(item => item.role === 'current')) {
      errors.push(`orphan active skill: ${skill.id}`)
    }
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
  detectCycles,
  parseFrontmatter,
  serializePortfolio,
  validatePortfolio
}
