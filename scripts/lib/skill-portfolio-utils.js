'use strict'

const crypto = require('crypto')
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { buildBundleDecisionV2 } = require('../../mcp/profile-contract')

const LEGAL_STATES = new Set(['draft', 'gray', 'active', 'deprecated', 'retired', 'blocked'])
const SKILL_INDEX_EVIDENCE_STATES = new Set(['unverified', 'source-backed', 'validated'])
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

function gitLsFiles(root, pathspecs = []) {
  try {
    const args = ['-C', root, 'ls-files', '-z', '--']
    if (pathspecs.length) args.push(...pathspecs)
    else args.push('.')
    const out = execFileSync('git', args, {
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    return out.toString('utf8').split('\0').filter(Boolean).map(rel => rel.replace(/\\/g, '/'))
  } catch {
    return null
  }
}

function readGitIndexRows(root) {
  return execFileSync('git', ['-C', root, 'ls-files', '--stage', '-z'], {
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })
}

function parseGitIndexEntries(indexRows) {
  return indexRows.toString('utf8').split('\0').filter(Boolean).map(row => {
    const match = row.match(/^(\d+) ([a-f0-9]+) (\d+)\t([\s\S]+)$/)
    if (!match) throw new Error(`unable to parse Git index row: ${row.slice(0, 120)}`)
    return {
      mode: match[1],
      objectId: match[2],
      stage: Number(match[3]),
      path: match[4].replace(/\\/g, '/')
    }
  })
}

function readGitObjectBatch(root, objectIds) {
  const uniqueIds = Array.from(new Set(objectIds))
  if (!uniqueIds.length) return new Map()
  const output = execFileSync('git', ['-C', root, 'cat-file', '--batch'], {
    encoding: 'buffer',
    input: Buffer.from(`${uniqueIds.join('\n')}\n`, 'utf8'),
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  const objects = new Map()
  let offset = 0
  for (const requestedId of uniqueIds) {
    const headerEnd = output.indexOf(0x0a, offset)
    if (headerEnd < 0) throw new Error(`missing Git object header for ${requestedId}`)
    const header = output.subarray(offset, headerEnd).toString('utf8')
    const match = header.match(/^([a-f0-9]+) (\S+) (\d+)$/)
    if (!match || match[2] !== 'blob') throw new Error(`invalid Git object response for ${requestedId}: ${header}`)
    const size = Number(match[3])
    const contentStart = headerEnd + 1
    const contentEnd = contentStart + size
    if (contentEnd >= output.length || output[contentEnd] !== 0x0a) {
      throw new Error(`truncated Git object response for ${requestedId}`)
    }
    objects.set(requestedId, output.subarray(contentStart, contentEnd))
    offset = contentEnd + 1
  }
  if (offset !== output.length) throw new Error('unexpected trailing bytes in Git object batch response')
  return objects
}

function loadGitIndexRepositorySnapshot(root) {
  const indexRows = readGitIndexRows(root)
  const entries = parseGitIndexEntries(indexRows)
  const unmergedPaths = entries.filter(entry => entry.stage !== 0).map(entry => entry.path)
  if (unmergedPaths.length) {
    throw new Error(`Git index contains unmerged entries: ${Array.from(new Set(unmergedPaths)).join(', ')}`)
  }
  const objects = readGitObjectBatch(root, entries.map(entry => entry.objectId))
  const files = new Map(entries.map(entry => {
    const content = objects.get(entry.objectId)
    if (!content) throw new Error(`Git index blob is unavailable: ${entry.path}`)
    return [entry.path, content]
  }))
  return {
    repositoryView: 'index',
    indexRows,
    indexFileCount: entries.length,
    indexTreeIdentity: sha256(indexRows),
    paths: entries.map(entry => entry.path).sort((a, b) => a.localeCompare(b)),
    readText(relativePath) {
      const rel = String(relativePath || '').replace(/\\/g, '/')
      const content = files.get(rel)
      if (!content) throw new Error(`unable to read staged portfolio input from Git index: ${rel}`)
      return content.toString('utf8')
    }
  }
}

function readRepositoryText(root, relativePath, repositoryView = 'worktree') {
  const rel = String(relativePath || '').replace(/\\/g, '/')
  if (repositoryView === 'worktree') {
    return fs.readFileSync(path.join(root, rel), 'utf8')
  }
  if (repositoryView !== 'index') {
    throw new Error(`unsupported portfolio repository view: ${repositoryView}`)
  }
  try {
    return execFileSync('git', ['-C', root, 'show', `:${rel}`], {
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    }).toString('utf8')
  } catch (error) {
    throw new Error(`unable to read staged portfolio input from Git index: ${rel} (${error.message})`)
  }
}

function gitIndexSnapshot(root, repositorySnapshot = null) {
  try {
    const indexRows = repositorySnapshot?.indexRows || readGitIndexRows(root)
    const entries = parseGitIndexEntries(indexRows)
    const unmergedPathCount = new Set(entries.filter(entry => entry.stage !== 0).map(entry => entry.path)).size
    const stagedRows = execFileSync('git', ['-C', root, 'diff', '--cached', '--name-only', '-z', '--'], {
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    const stagedPaths = stagedRows.toString('utf8').split('\0').filter(Boolean)
    const verifiedIndexRows = readGitIndexRows(root)
    if (sha256(verifiedIndexRows) !== sha256(indexRows)) {
      throw new Error('Git index changed while the staged candidate snapshot was being captured')
    }
    return {
      available: true,
      repositoryView: 'index',
      indexFileCount: entries.filter(entry => entry.stage === 0).length,
      unmergedPathCount,
      stagedPathCount: stagedPaths.length,
      stagedPaths: stagedPaths.map(rel => rel.replace(/\\/g, '/')).sort(),
      indexTreeIdentity: sha256(indexRows)
    }
  } catch (error) {
    return {
      available: false,
      repositoryView: 'index',
      error: error.message
    }
  }
}

function validateStagedCandidateSnapshot(snapshot) {
  const errors = []
  if (!snapshot || snapshot.available !== true) errors.push('Git index is unavailable')
  if (Number(snapshot?.unmergedPathCount || 0) > 0) errors.push('Git index contains unmerged entries')
  if (!Number.isInteger(snapshot?.stagedPathCount) || snapshot.stagedPathCount < 1) {
    errors.push('no staged candidate paths; stage the intended change set before checking derived artifacts')
  }
  if (!/^[a-f0-9]{64}$/.test(String(snapshot?.indexTreeIdentity || ''))) errors.push('invalid Git index identity')
  return errors
}

function isPortfolioConsumerExcluded(relativePath) {
  const rel = relativePath.replace(/\\/g, '/')
  const excludedPrefixes = [
    'skills/',
    'node_modules/',
    'coverage/',
    'dist/',
    '.git/',
    '.devcodex/',
    'website/doc_build/',
    'website/dist/'
  ]
  if (excludedPrefixes.some(prefix => rel === prefix.slice(0, -1) || rel.startsWith(prefix))) return true
  const base = path.posix.basename(rel)
  if (base === 'portfolio.json' || base === 'portfolio-evidence.json') return true
  return !TEXT_EXTENSIONS.has(path.extname(rel).toLowerCase())
}

/**
 * Consumer scan for Skill portfolio.
 * MUST use git-tracked paths only when git is available so dirty/untracked worktrees
 * match CI clean checkouts (V92). Untracked reports/tmp/backup files must never change consumers.
 */
function listConsumerDocuments(root, options = {}) {
  const repositoryView = options.repositoryView || 'worktree'
  const repositorySnapshot = options.repositorySnapshot || null
  const tracked = repositorySnapshot?.paths || gitLsFiles(root)
  const files = []

  if (tracked && tracked.length) {
    for (const rel of tracked) {
      if (isPortfolioConsumerExcluded(rel)) continue
      if (repositoryView === 'worktree') {
        const full = path.join(root, rel)
        if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue
      }
      files.push(rel)
    }
  } else {
    if (repositoryView === 'index') {
      throw new Error('Git index is unavailable; staged Skill portfolio freshness cannot be verified')
    }
    // Fallback for non-git unpack / pack install smoke: filesystem walk with same exclusions.
    const excludedTop = new Set(['.git', '.devcodex', 'coverage', 'dist', 'node_modules', 'skills', 'doc_build'])
    function visit(dir, depth = 0) {
      if (!fs.existsSync(dir)) return
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && ((depth === 0 && excludedTop.has(entry.name)) || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'doc_build')) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) visit(full, depth + 1)
        else if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(normalizePath(root, full))
      }
    }
    visit(root)
  }

  return files.sort((a, b) => a.localeCompare(b)).map(relative => ({
    path: relative.replace(/\\/g, '/'),
    content: repositorySnapshot
      ? repositorySnapshot.readText(relative)
      : readRepositoryText(root, relative, repositoryView)
  }))
}

/** List SKILL.md repository paths: git-tracked only when available (ignore untracked skill drafts). */
function listSkillMarkdownPaths(root, options = {}) {
  const repositoryView = options.repositoryView || 'worktree'
  const repositorySnapshot = options.repositorySnapshot || null
  const tracked = repositorySnapshot?.paths.filter(rel => rel.startsWith('skills/')) || gitLsFiles(root, ['skills'])
  if (tracked && tracked.length) {
    return tracked
      .filter(rel => rel.replace(/\\/g, '/').endsWith('/SKILL.md') || /^skills\/[^/]+\/SKILL\.md$/.test(rel.replace(/\\/g, '/')))
      .filter(rel => repositoryView === 'index' || (fs.existsSync(path.join(root, rel)) && fs.statSync(path.join(root, rel)).isFile()))
      .map(rel => rel.replace(/\\/g, '/'))
      .sort((a, b) => a.localeCompare(b))
  }
  if (repositoryView === 'index') {
    throw new Error('Git index is unavailable; staged Skill sources cannot be verified')
  }
  return walk(path.join(root, 'skills'))
    .filter(file => path.basename(file) === 'SKILL.md')
    .map(file => normalizePath(root, file))
    .sort((a, b) => a.localeCompare(b))
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

function normalizeStringArray(value, fallback = []) {
  if (!Array.isArray(value)) return [...fallback]
  return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))].sort()
}

function buildSkillIndex({ id, triggers, dependencies, conflicts, validationProfile, operationalReadiness, defaults, override }) {
  const declared = { ...(defaults.skillIndex || {}), ...(override.skillIndex || {}) }
  const maxTokens = Number.isInteger(declared.maxTokens) && declared.maxTokens > 0 ? declared.maxTokens : null
  return {
    id,
    type: String(declared.type || 'skill'),
    workflow: normalizeStringArray(declared.workflow),
    phase: normalizeStringArray(declared.phase),
    domains: normalizeStringArray(declared.domains),
    triggers,
    requires: [...dependencies],
    conflictsWith: [...conflicts],
    priority: Number.isInteger(declared.priority) ? declared.priority : 100,
    visibility: String(declared.visibility || 'agent'),
    maxTokens,
    fixtures: [
      { kind: 'positive', ref: operationalReadiness.positiveFixture },
      { kind: 'negative', ref: operationalReadiness.negativeFixture }
    ],
    evolvableUnitRef: String(declared.evolvableUnitRef || `skill:${id}`),
    probeSuiteRefs: normalizeStringArray(declared.probeSuiteRefs, validationProfile),
    exitCondition: String(declared.exitCondition || 'work-unit-complete-or-workflow-transition'),
    evidenceState: String(declared.evidenceState || 'source-backed')
  }
}

/** Select a deterministic, read-only Skill bundle without changing portfolio lifecycle state. */
function buildBundleDecision(portfolio, input = {}) {
  const byId = new Map((portfolio.skills || []).map(skill => [skill.id, skill]))
  const candidateIds = normalizeStringArray(input.candidateIds)
  const includeGray = input.includeGray === true
  const maxSkills = Number.isInteger(input.maxSkills) && input.maxSkills >= 0 ? input.maxSkills : null
  const selected = []
  const ignored = []
  const conflicts = []

  for (const id of candidateIds) {
    const skill = byId.get(id)
    if (!skill) {
      ignored.push({ id, reason: 'unknown' })
      continue
    }
    if (skill.lifecycleState !== 'active' && !(includeGray && skill.lifecycleState === 'gray')) {
      ignored.push({ id, reason: 'inactive', lifecycleState: skill.lifecycleState })
      continue
    }
    const conflicting = selected.find(item => {
      const selectedSkill = byId.get(item.id)
      return skill.skillIndex.conflictsWith.includes(item.id) || selectedSkill.skillIndex.conflictsWith.includes(id)
    })
    if (conflicting) {
      ignored.push({ id, reason: 'conflict', conflictWith: conflicting.id })
      conflicts.push({ left: conflicting.id, right: id })
      continue
    }
    if (maxSkills !== null && selected.length >= maxSkills) {
      ignored.push({ id, reason: 'budget' })
      continue
    }
    selected.push({ id, reason: 'eligible', priority: skill.skillIndex.priority })
  }

  const budgetStatus = maxSkills === null
    ? 'not-enforced'
    : (selected.length >= maxSkills && ignored.some(item => item.reason === 'budget') ? 'exhausted' : 'within-limit')
  return {
    schemaVersion: 'BundleDecisionV1',
    candidates: candidateIds,
    selected,
    ignored,
    conflicts,
    budget: { type: 'maxSkills', limit: maxSkills, used: selected.length, status: budgetStatus },
    exitCondition: selected.length ? 'bundle-ready' : 'no-skill-selected'
  }
}

function buildPortfolio(root, options = {}) {
  const repositoryView = options.repositoryView || 'worktree'
  const repositorySnapshot = repositoryView === 'index'
    ? (options.repositorySnapshot || loadGitIndexRepositorySnapshot(root))
    : null
  const readText = relative => repositorySnapshot
    ? repositorySnapshot.readText(relative)
    : readRepositoryText(root, relative, repositoryView)
  const packageJson = JSON.parse(readText('package.json'))
  const pluginPath = 'plugin.json'
  const plugin = JSON.parse(readText(pluginPath))
  const portfolioEvidencePath = 'skills/portfolio-evidence.json'
  const portfolioEvidence = JSON.parse(readText(portfolioEvidencePath))
  if (portfolioEvidence.schemaVersion !== 2 || portfolioEvidence.ownerSkill !== 'skill-lifecycle-governance') {
    throw new Error('invalid skills/portfolio-evidence.json header')
  }
  const registered = new Map((plugin.skills || []).map(item => [item.id, item]))
  const skillPaths = listSkillMarkdownPaths(root, { repositoryView, repositorySnapshot })
  const knownNames = new Set(skillPaths.map(relative => path.posix.basename(path.posix.dirname(relative))))
  const consumers = listConsumerDocuments(root, { repositoryView, repositorySnapshot })
  const sourceRows = []
  const consumerProjectionRows = []

  const skills = skillPaths.map(source => {
    const id = path.posix.basename(path.posix.dirname(source))
    const content = readText(source)
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
    for (const consumer of consumerRows) {
      consumerProjectionRows.push(`${id}:${consumer.path}:${consumer.role}`)
    }
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
    const sourceBytes = Buffer.byteLength(canonicalContent, 'utf8')
    sourceRows.push(`${source}:${hash}`)
    const skillIndex = buildSkillIndex({
      id,
      triggers: buildTriggerContract(id, frontmatter.description),
      dependencies,
      conflicts,
      validationProfile,
      operationalReadiness,
      defaults: portfolioEvidence.defaults,
      override
    })
    return {
      id,
      name: frontmatter.name,
      description: frontmatter.description,
      owner: id,
      triggers: skillIndex.triggers,
      ownedArtifacts: [source],
      source,
      hash,
      sourceBytes,
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
      skillIndex,
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
  const sourceDigest = sha256(sourceRows.sort().join('\n'))
  const pluginDigest = sha256(canonicalizeTextForDigest(readText(pluginPath)))
  const portfolioEvidenceDigest = sha256(canonicalizeTextForDigest(readText(portfolioEvidencePath)))
  const consumerInventoryDigest = sha256(consumers.map(item => item.path).sort().join('\n'))
  const consumerProjectionDigest = sha256(consumerProjectionRows.sort().join('\n'))
  const portfolioInputDigest = sha256([
    `skills:${sourceDigest}`,
    `plugin:${pluginDigest}`,
    `evidence:${portfolioEvidenceDigest}`,
    `consumer-inventory:${consumerInventoryDigest}`,
    `consumer-projection:${consumerProjectionDigest}`
  ].join('\n'))

  return {
    schemaVersion: 2,
    package: packageJson.name,
    packageVersion: packageJson.version,
    generatedFrom: {
      skillsPattern: 'skills/*/SKILL.md',
      registry: 'plugin.json',
      sourceDigest,
      pluginDigest,
      portfolioEvidence: 'skills/portfolio-evidence.json',
      portfolioEvidenceDigest,
      consumerInventoryFileCount: consumers.length,
      consumerInventoryDigest,
      consumerProjectionDigest,
      portfolioInputDigest
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
      instructionBudgetP95Bytes: percentile(skillPaths.map(relative => Buffer.byteLength(canonicalizeTextForDigest(readText(relative)), 'utf8')), 0.95),
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
  if (portfolio.schemaVersion !== 2) errors.push(`unsupported portfolio schema version: ${portfolio.schemaVersion}`)
  const generatedFrom = portfolio.generatedFrom || {}
  if (!Number.isInteger(generatedFrom.consumerInventoryFileCount) || generatedFrom.consumerInventoryFileCount < 1) {
    errors.push('invalid consumerInventoryFileCount')
  }
  for (const field of ['consumerInventoryDigest', 'consumerProjectionDigest', 'portfolioInputDigest']) {
    if (!/^[a-f0-9]{64}$/.test(String(generatedFrom[field] || ''))) errors.push(`invalid ${field}`)
  }
  for (const skill of portfolio.skills || []) {
    if (ids.has(skill.id)) errors.push(`duplicate skill id: ${skill.id}`)
    ids.add(skill.id)
    if (!LEGAL_STATES.has(skill.lifecycleState)) errors.push(`illegal lifecycle state: ${skill.id}=${skill.lifecycleState}`)
    if (!skill.source || !skill.hash || !skill.version) errors.push(`missing source/hash/version: ${skill.id}`)
    if (!Number.isInteger(skill.sourceBytes) || skill.sourceBytes < 1) errors.push(`missing sourceBytes: ${skill.id}`)
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
    const index = skill.skillIndex
    if (!index || index.id !== skill.id || index.type !== 'skill') errors.push(`invalid SkillIndexV2 identity: ${skill.id}`)
    for (const field of ['workflow', 'phase', 'domains', 'requires', 'conflictsWith', 'fixtures', 'probeSuiteRefs']) {
      if (!index || !Array.isArray(index[field])) errors.push(`invalid SkillIndexV2 ${field}: ${skill.id}`)
    }
    if (!index || !Number.isInteger(index.priority)) errors.push(`invalid SkillIndexV2 priority: ${skill.id}`)
    if (index && index.maxTokens !== null && (!Number.isInteger(index.maxTokens) || index.maxTokens <= 0)) errors.push(`invalid SkillIndexV2 maxTokens: ${skill.id}`)
    if (!index || !SKILL_INDEX_EVIDENCE_STATES.has(index.evidenceState)) errors.push(`invalid SkillIndexV2 evidenceState: ${skill.id}`)
    if (!index || !index.evolvableUnitRef || !index.exitCondition || !index.visibility) errors.push(`incomplete SkillIndexV2 contract: ${skill.id}`)
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
  buildBundleDecision,
  buildBundleDecisionV2,
  buildPortfolio,
  buildSkillIndex,
  buildTriggerContract,
  canonicalizeTextForDigest,
  collectDependencies,
  detectCycles,
  gitIndexSnapshot,
  gitLsFiles,
  isPortfolioConsumerExcluded,
  listConsumerDocuments,
  listSkillMarkdownPaths,
  loadGitIndexRepositorySnapshot,
  parseFrontmatter,
  readRepositoryText,
  serializePortfolio,
  validateStagedCandidateSnapshot,
  validatePortfolio
}
