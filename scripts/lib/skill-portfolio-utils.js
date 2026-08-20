'use strict'

const crypto = require('crypto')
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { buildBundleDecisionV2 } = require('../../mcp/profile-contract')
const {
  parseFrontmatter: parseRuntimeFrontmatter
} = require('../../hooks/_runtime/progressive-skill-route-contract.cjs')
const {
  loadSkillSidecarWithReader,
  sidecarRelativePath
} = require('./skill-sidecar-contract')
const { renderContent } = require('./control-content-source')
const {
  indexPublicSkillTaxonomy,
  publicCategoryCounts,
  validatePublicSkillTaxonomy
} = require('./public-skill-taxonomy')

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
  const values = parseRuntimeFrontmatter(content).frontmatter
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

/**
 * Collect hard dependency skill ids from SKILL.md body.
 * Only mandatory language counts — plain "引用 `memory` Skill" does not.
 * CR-01 / AUD-038: expand beyond "必须读取" so kernel chains are visible in the graph.
 */
function collectDependencies(content, knownNames) {
  const dependencies = new Set()
  const mandatoryLine =
    /(?:必须(?:继续|先)?(?:读取|调用|加载|执行)|应当(?:先)?(?:读取|调用|加载)|需要先(?:读取|调用)|先(?:读取|调用)|再(?:读取|调用)|depends?\s+on|must\s+(?:first\s+)?(?:read|load|call|invoke)|required\s+(?:to\s+)?(?:read|load)|依赖)/i
  const negativeLine = /(?:不得|禁止|不要|不是|无需|不必|not\s+required|do\s+not)/i
  for (const line of content.split(/\r?\n/)) {
    if (!mandatoryLine.test(line)) continue
    if (negativeLine.test(line)) continue
    for (const match of line.matchAll(/`([a-z0-9-]+)`|(?:skills\/|\.\.\/)([a-z0-9-]+)\/SKILL\.md/g)) {
      const name = match[1] || match[2]
      if (knownNames.has(name)) dependencies.add(name)
    }
  }
  return Array.from(dependencies).sort()
}

/**
 * Merge body-derived deps with optional portfolio-evidence.json overrides (explicit requires).
 */
function mergeDependencies(bodyDeps, overrideDeps, knownNames, selfId) {
  const out = new Set(bodyDeps)
  for (const name of Array.isArray(overrideDeps) ? overrideDeps : []) {
    if (typeof name === 'string' && knownNames.has(name) && name !== selfId) out.add(name)
  }
  return Array.from(out).sort()
}

function buildTriggerContract(id, description, override = {}) {
  const terms = new Set([id])
  for (const match of description.matchAll(/`([A-Za-z0-9-]+)`|\b([A-Za-z][A-Za-z0-9-]{2,})\b/g)) {
    terms.add(match[1] || match[2])
  }
  // Optional evidence terms (do not invent semantics beyond provided strings)
  for (const term of Array.isArray(override.triggerTerms) ? override.triggerTerms : []) {
    if (typeof term === 'string' && term.trim()) terms.add(term.trim())
  }
  const positive = Array.isArray(override.triggerPositive) && override.triggerPositive.length
    ? override.triggerPositive.map((item, index) => ({
        fixture: item.fixture || `evidence-positive-${index + 1}`,
        input: item.input != null ? String(item.input) : description
      }))
    : [{ fixture: 'frontmatter-description-resolves', input: description }]
  const negative = Array.isArray(override.triggerNegative) && override.triggerNegative.length
    ? override.triggerNegative.map((item, index) => ({
        fixture: item.fixture || `evidence-negative-${index + 1}`,
        input: item.input != null ? String(item.input) : ''
      }))
    : [{ fixture: 'empty-or-unregistered-trigger-rejected', input: '' }]
  const ambiguous = Array.isArray(override.triggerAmbiguous)
    ? override.triggerAmbiguous.map((item, index) => ({
        fixture: item.fixture || `evidence-ambiguous-${index + 1}`,
        input: item.input != null ? String(item.input) : ''
      }))
    : []
  return {
    terms: Array.from(terms).sort(),
    positive,
    negative,
    ambiguous
  }
}

/**
 * Resolve trigger precision from portfolio-evidence override.
 * Measured requires sampleCount > 0 and numeric precision in [0, 1].
 * CR-01 / AUD-039: stop hardcoding structural-only when real evidence is supplied.
 */
function resolveTriggerPrecision(override = {}, evidenceDate = null) {
  const raw = override.triggerPrecision
  if (raw && raw.state === 'measured') {
    const sampleCount = Number(raw.sampleCount)
    const precision = Number(raw.precision)
    if (Number.isInteger(sampleCount) && sampleCount > 0 && Number.isFinite(precision) && precision >= 0 && precision <= 1) {
      return {
        state: 'measured',
        sampleCount,
        precision,
        falsePositiveRate: raw.falsePositiveRate == null ? null : Number(raw.falsePositiveRate),
        falseNegativeRate: raw.falseNegativeRate == null ? null : Number(raw.falseNegativeRate),
        manualCorrectionRate: raw.manualCorrectionRate == null ? null : Number(raw.manualCorrectionRate),
        lastMeasuredAt: raw.lastMeasuredAt || evidenceDate || null
      }
    }
  }
  const fixtureSampleCount =
    (Array.isArray(override.triggerPositive) ? override.triggerPositive.length : 0) +
    (Array.isArray(override.triggerNegative) ? override.triggerNegative.length : 0)
  return {
    state: 'structural-only',
    sampleCount: fixtureSampleCount > 0 ? fixtureSampleCount : 0,
    precision: null,
    falsePositiveRate: null,
    falseNegativeRate: null,
    manualCorrectionRate: null,
    lastMeasuredAt: fixtureSampleCount > 0 ? (override.triggerPrecision && override.triggerPrecision.lastMeasuredAt) || evidenceDate || null : null
  }
}

function summarizeTriggerQuality(skills) {
  const measured = skills.filter(skill => skill.evidence && skill.evidence.triggerPrecision && skill.evidence.triggerPrecision.state === 'measured').length
  if (measured === 0) return 'structural-only'
  if (measured === skills.length) return 'measured'
  return 'mixed'
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
    'content/',
    'content-source/',
    'instructions/',
    'prompts/',
    'node_modules/',
    'coverage/',
    'dist/',
    '.git/',
    '.devcodex/',
    'scripts/fixtures/retired-workspace-skill-route/',
    'website/doc_build/',
    'website/dist/'
  ]
  if (excludedPrefixes.some(prefix => rel === prefix.slice(0, -1) || rel.startsWith(prefix))) return true
  if (rel === 'instructions.md') return true
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
  if (repositoryView === 'worktree') {
    return walk(path.join(root, 'content', 'skills'))
      .filter(file => path.basename(file) === 'SKILL.md')
      .map(file => normalizePath(root, file))
      .sort((a, b) => a.localeCompare(b))
  }
  const tracked = repositorySnapshot?.paths.filter(rel => rel.startsWith('content/skills/')) ||
    gitLsFiles(root, ['content/skills'])
  if (tracked && tracked.length) {
    return tracked
      .filter(rel => /^content\/skills\/[^/]+\/SKILL\.md$/.test(rel.replace(/\\/g, '/')))
      .filter(rel => repositoryView === 'index' || (fs.existsSync(path.join(root, rel)) && fs.statSync(path.join(root, rel)).isFile()))
      .map(rel => rel.replace(/\\/g, '/'))
      .sort((a, b) => a.localeCompare(b))
  }
  if (repositoryView === 'index') {
    throw new Error('Git index is unavailable; staged Skill sources cannot be verified')
  }
  return []
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
  const publicTaxonomyPath = 'content/skills/public-taxonomy.json'
  const publicTaxonomy = JSON.parse(readText(publicTaxonomyPath))
  const publicTaxonomyIndex = indexPublicSkillTaxonomy(publicTaxonomy, plugin.skills || [])
  const portfolioEvidencePath = 'content/skills/portfolio-evidence.json'
  const portfolioEvidence = JSON.parse(readText(portfolioEvidencePath))
  if (portfolioEvidence.schemaVersion !== 2 || portfolioEvidence.ownerSkill !== 'skill-lifecycle-governance') {
    throw new Error('invalid content/skills/portfolio-evidence.json header')
  }
  const registered = new Map((plugin.skills || []).map(item => [item.id, item]))
  const skillPaths = listSkillMarkdownPaths(root, { repositoryView, repositorySnapshot })
  const knownNames = new Set(skillPaths.map(relative => path.posix.basename(path.posix.dirname(relative))))
  const consumers = listConsumerDocuments(root, { repositoryView, repositorySnapshot })
  const sourceRows = []
  const sidecarRows = []
  const consumerProjectionRows = []

  const skills = skillPaths.map(source => {
    const id = path.posix.basename(path.posix.dirname(source))
    const rawContent = readText(source)
    const content = renderContent(rawContent, {
      sourceRoot: path.join(root, 'content'),
      readFragment: fragment => readText(`content/${fragment}`)
    }).content
    const canonicalContent = canonicalizeTextForDigest(content)
    const frontmatter = parseFrontmatter(content, id)
    let sidecarProjection = null
    try {
      const loaded = loadSkillSidecarWithReader(root, id, readText)
      if (loaded) {
        sidecarProjection = {
          path: loaded.path,
          digest: loaded.digest,
          state: loaded.state,
          resourceContracts: loaded.resourceContracts,
          manualScriptContracts: loaded.manualScriptContracts,
          triggerFixtures: loaded.triggerFixtures,
          fallbackPolicy: loaded.fallbackPolicy
        }
        sidecarRows.push(`${loaded.path}:${loaded.digest}`)
        for (const resource of loaded.resourceContracts) {
          sidecarRows.push(`${id}:resource:${resource.id}:${resource.contentDigest}`)
        }
        for (const script of loaded.manualScriptContracts) {
          sidecarRows.push(`${id}:script:${script.id}:${script.contentDigest}`)
        }
      }
    } catch (error) {
      const code = error && error.code ? `${error.code}: ` : ''
      throw new Error(`skill sidecar invalid for ${id} (${sidecarRelativePath(id)}): ${code}${error.message}`)
    }
    const consumerRows = consumers
      .filter(item => item.content.includes(id))
      .map(item => ({ path: item.path, role: classifyConsumer(item.path) }))
    const registration = registered.get(id)
    const publicSource = `skills/${id}/SKILL.md`
    const isRegistered = registration?.file === publicSource || registration?.file === source
    const lifecycleState = isRegistered ? (registration.lifecycleState || 'active') : 'draft'
    if (isRegistered && !consumerRows.some(item => item.path === 'plugin.json')) {
      consumerRows.push({ path: 'plugin.json', role: 'current' })
    }
    consumerRows.sort((a, b) => a.path.localeCompare(b.path) || a.role.localeCompare(b.role))
    for (const consumer of consumerRows) {
      consumerProjectionRows.push(`${id}:${consumer.path}:${consumer.role}`)
    }
    const references = collectReferences(content, knownNames).filter(name => name !== id)
    const override = portfolioEvidence.skills[id] || {}
    const bodyDependencies = collectDependencies(content, knownNames).filter(name => name !== id)
    const dependencies = mergeDependencies(bodyDependencies, override.dependencies, knownNames, id)
    const validationProfile = consumerRows
      .filter(item => item.role === 'current' && /^scripts\/(?:test-|validate)/.test(item.path))
      .map(item => item.path)
    for (const fixture of portfolioEvidence.defaults.validationProfile) {
      if (!validationProfile.includes(fixture)) validationProfile.push(fixture)
    }
    validationProfile.sort()
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
    const triggers = buildTriggerContract(id, frontmatter.description, override)
    const triggerPrecision = resolveTriggerPrecision(override, portfolioEvidence.evidenceDate)
    const skillIndex = buildSkillIndex({
      id,
      triggers,
      dependencies,
      conflicts,
      validationProfile,
      operationalReadiness,
      defaults: portfolioEvidence.defaults,
      override
    })
    const ownedArtifacts = [source]
    if (sidecarProjection) ownedArtifacts.push(sidecarProjection.path)
    return {
      id,
      name: frontmatter.name,
      description: frontmatter.description,
      owner: id,
      triggers: skillIndex.triggers,
      ownedArtifacts,
      source,
      hash,
      sourceBytes,
      version: packageJson.version,
      lifecycleState,
      publicCategory: publicTaxonomyIndex.assignmentBySkillId.get(id),
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
      sidecar: sidecarProjection,
      evidence: {
        registration: isRegistered ? 'plugin.json' : null,
        operationalReadiness,
        triggerPrecision,
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
  const sidecarDigest = sha256(sidecarRows.length ? sidecarRows.sort().join('\n') : 'sidecar-none')
  const pluginDigest = sha256(canonicalizeTextForDigest(readText(pluginPath)))
  const publicTaxonomyDigest = sha256(canonicalizeTextForDigest(readText(publicTaxonomyPath)))
  const portfolioEvidenceDigest = sha256(canonicalizeTextForDigest(readText(portfolioEvidencePath)))
  const consumerInventoryDigest = sha256(consumers.map(item => item.path).sort().join('\n'))
  const consumerProjectionDigest = sha256(consumerProjectionRows.sort().join('\n'))
  const portfolioInputDigest = sha256([
    `skills:${sourceDigest}`,
    `sidecar:${sidecarDigest}`,
    `plugin:${pluginDigest}`,
    `public-taxonomy:${publicTaxonomyDigest}`,
    `evidence:${portfolioEvidenceDigest}`,
    `consumer-inventory:${consumerInventoryDigest}`,
    `consumer-projection:${consumerProjectionDigest}`
  ].join('\n'))
  const triggerPrecisionMeasuredCount = skills.filter(skill => skill.evidence.triggerPrecision.state === 'measured').length
  const triggerQuality = summarizeTriggerQuality(skills)
  const evidenceNote = triggerQuality === 'structural-only'
    ? 'Operational lifecycle evidence is complete for registered current consumers; trigger precision remains structural-only until measured samples are supplied via portfolio-evidence.json.'
    : triggerQuality === 'mixed'
      ? `Operational evidence complete; trigger precision mixed (${triggerPrecisionMeasuredCount}/${skills.length} measured via portfolio-evidence.json).`
      : 'Operational evidence complete; all skills carry measured trigger precision samples.'

  return {
    schemaVersion: 2,
    package: packageJson.name,
    packageVersion: packageJson.version,
    generatedFrom: {
      skillsPattern: 'content/skills/*/SKILL.md',
      optionalSidecar: 'content/skills/*/devcodex.skill.json',
      registry: 'plugin.json',
      sourceDigest,
      sidecarDigest,
      pluginDigest,
      publicTaxonomy: publicTaxonomyPath,
      publicTaxonomyDigest,
      portfolioEvidence: portfolioEvidencePath,
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
      triggerPrecisionMeasuredCount,
      instructionBudgetP95Bytes: percentile(skillPaths.map(relative => Buffer.byteLength(canonicalizeTextForDigest(readText(relative)), 'utf8')), 0.95),
      triggerQuality,
      sidecarPresentCount: skills.filter(skill => skill.sidecar && skill.sidecar.state === 'valid').length,
      publicCategoryCounts: publicCategoryCounts(skills, publicTaxonomyIndex.projection.categories)
    },
    publicTaxonomy: publicTaxonomyIndex.projection,
    dependencyGraph: { nodes, edges, cycles },
    referenceGraph: { edges: referenceEdges.sort((a, b) => `${a.from}:${a.to}`.localeCompare(`${b.from}:${b.to}`)) },
    health: {
      orphanActive,
      lifecycleMutationAllowed: false,
      evidenceNote
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
  if (generatedFrom.publicTaxonomy !== 'content/skills/public-taxonomy.json') {
    errors.push('invalid publicTaxonomy source')
  }
  if (!/^[a-f0-9]{64}$/.test(String(generatedFrom.publicTaxonomyDigest || ''))) {
    errors.push('invalid publicTaxonomyDigest')
  }
  if (generatedFrom.sidecarDigest != null && !/^[a-f0-9]{64}$/.test(String(generatedFrom.sidecarDigest))) {
    errors.push('invalid sidecarDigest')
  }
  for (const skill of portfolio.skills || []) {
    if (ids.has(skill.id)) errors.push(`duplicate skill id: ${skill.id}`)
    ids.add(skill.id)
    if (!LEGAL_STATES.has(skill.lifecycleState)) errors.push(`illegal lifecycle state: ${skill.id}=${skill.lifecycleState}`)
    if (!skill.source || !skill.hash || !skill.version) errors.push(`missing source/hash/version: ${skill.id}`)
    if (!/[\p{L}\p{N}]/u.test(String(skill.description || ''))) {
      errors.push(`missing semantic description: ${skill.id}`)
    }
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
    if (triggerPrecision && triggerPrecision.state === 'measured' && (typeof triggerPrecision.precision !== 'number' || triggerPrecision.precision < 0 || triggerPrecision.precision > 1)) {
      errors.push(`measured trigger precision missing precision in [0,1]: ${skill.id}`)
    }
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
  const projectedTaxonomy = portfolio.publicTaxonomy || {}
  const taxonomyValidation = validatePublicSkillTaxonomy({
    ...projectedTaxonomy,
    assignments: (portfolio.skills || []).map(skill => ({
      skillId: skill.id,
      publicCategory: skill.publicCategory
    }))
  }, (portfolio.skills || []).map(skill => ({
    id: skill.id,
    lifecycleState: skill.lifecycleState
  })))
  errors.push(...taxonomyValidation.map(issue => `public taxonomy: ${issue}`))
  const expectedCategoryCounts = publicCategoryCounts(
    portfolio.skills || [],
    Array.isArray(projectedTaxonomy.categories) ? projectedTaxonomy.categories : []
  )
  if (JSON.stringify(portfolio.summary?.publicCategoryCounts || {}) !== JSON.stringify(expectedCategoryCounts)) {
    errors.push('summary publicCategoryCounts mismatch')
  }
  if (portfolio.summary && portfolio.summary.skillCount !== ids.size) errors.push('summary skillCount mismatch')
  if (portfolio.summary && !['structural-only', 'mixed', 'measured'].includes(portfolio.summary.triggerQuality)) {
    errors.push(`invalid summary triggerQuality: ${portfolio.summary.triggerQuality}`)
  }
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
  mergeDependencies,
  resolveTriggerPrecision,
  summarizeTriggerQuality,
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
