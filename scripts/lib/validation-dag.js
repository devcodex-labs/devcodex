'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')
const { runChecked, CheckedCommandError } = require('./checked-command')
const {
  buildContentIdentity,
  buildJsonContentIdentity,
  matchesContentIdentity,
  sha256,
  stableStringify
} = require('../../hooks/_runtime/content-identity.cjs')
const { createDerivedStateStore } = require('../../hooks/_runtime/derived-state-store.cjs')
const { createRuntimeStateStore } = require('../../hooks/_runtime/runtime-state-store.cjs')
const { resolveRuntimeStateRoot } = require('../../hooks/_runtime/workspace-layout.cjs')

const VALIDATION_MANIFEST_SCHEMA = 'ValidationManifestV1'
const VALIDATION_NODE_SCHEMA = 'ValidationNodeV1'
const VALIDATION_RECEIPT_SCHEMA = 'ValidationExecutionReceiptV2'
const VALIDATION_CACHE_SCHEMA = 'ValidationEvidenceV1'
const VALIDATION_CONTRACT_VERSION = '1'
const VALIDATION_CACHE_MAX_BYTES = 256 * 1024 * 1024
const VALIDATION_CACHE_MAX_ENTRIES = 8192
const REQUIRED_ROUTES = ['fast', 'full', 'changed', 'profile-deploy', 'package-release']
const RISK_CLASSES = new Set(['normal', 'high', 'release', 'security', 'destructive'])
const CACHE_POLICIES = new Set(['never', 'candidate-bound'])
const PACKAGE_CONTROL_FIELDS = new Set([
  'version', 'engines', 'scripts', 'files', 'bin', 'exports', 'main', 'type',
  'dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'packageManager'
])
const PACKAGE_PUBLIC_METADATA_FIELDS = new Set([
  'description', 'keywords', 'homepage', 'repository', 'bugs', 'author', 'license', 'funding'
])

class ValidationDagError extends Error {
  constructor(code, message, details = null) {
    super(message)
    this.name = 'ValidationDagError'
    this.code = code
    this.details = details
  }
}

function normalizeRelativePath(value) {
  const normalized = String(value || '').normalize('NFKC').replace(/\\/g, '/').replace(/^\.\//, '')
  if (!normalized || normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
    throw new ValidationDagError('VALIDATION_PATH_INVALID', 'changed paths must stay relative to the repository root')
  }
  return normalized
}

function commandSignature(node) {
  return stableStringify([node.command, node.args, node.environment || {}])
}

/**
 * PF-148 slice-2: nested delegatedClosure graph (parent → leaf nodeIds + command lines).
 * @param {object} manifest
 * @returns {{ edges: object[], nodeIds: string[], digest: string }}
 */
function buildNestedCommandGraph(manifest) {
  const edges = []
  const nodeIds = new Set()
  for (const node of manifest.nodes || []) {
    for (const entry of node.delegatedClosure || []) {
      if (!entry || !entry.nodeId) continue
      nodeIds.add(node.id)
      nodeIds.add(entry.nodeId)
      edges.push({
        parentId: node.id,
        childId: entry.nodeId,
        probe: entry.probe || null,
        command: normalizeCommandLine(entry.command)
      })
    }
  }
  edges.sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)))
  const core = {
    schemaVersion: 'NestedCommandGraphV1',
    edgeCount: edges.length,
    nodeIds: [...nodeIds].sort(),
    edges
  }
  return {
    ...core,
    digest: sha256(Buffer.from(stableStringify(core), 'utf8'))
  }
}

function writeScopesConflict(left = [], right = []) {
  if (!Array.isArray(left) || !Array.isArray(right) || !left.length || !right.length) return false
  const rightSet = new Set(right)
  return left.some(scope => rightSet.has(scope))
}

/**
 * PF-148 slice-2: lock-aware wave schedule (writeScopes conflict ⇒ different waves).
 * Still executed serially by flattening waves; receipt records parallel eligibility evidence.
 * @param {object[]} selectedNodes topological subset
 * @returns {{ schemaVersion: string, mode: string, waves: string[][], parallelEligibleCount: number, serialForcedCount: number, scheduleDigest: string }}
 */
function planLockAwareSchedule(selectedNodes = []) {
  const waves = []
  const waveScopes = []
  const nodeWave = new Map()
  for (const node of selectedNodes) {
    const scopes = Array.isArray(node.writeScopes) ? node.writeScopes : []
    let waveIndex = -1
    for (let index = 0; index < waves.length; index += 1) {
      // dependencies must finish in an earlier wave
      const depBlocks = (node.dependencies || []).some(depId => {
        if (!nodeWave.has(depId)) return false
        return nodeWave.get(depId) >= index
      })
      if (depBlocks) continue
      if (writeScopesConflict(scopes, waveScopes[index])) continue
      waveIndex = index
      break
    }
    if (waveIndex < 0) {
      waveIndex = waves.length
      waves.push([])
      waveScopes.push([])
    }
    waves[waveIndex].push(node.id)
    waveScopes[waveIndex].push(...scopes)
    nodeWave.set(node.id, waveIndex)
  }
  const parallelEligibleCount = waves.reduce((sum, wave) => sum + (wave.length > 1 ? wave.length : 0), 0)
  const serialForcedCount = selectedNodes.filter(node => Array.isArray(node.writeScopes) && node.writeScopes.length > 0).length
  const core = {
    schemaVersion: 'ValidationExecutionScheduleV1',
    mode: 'serial-lock-aware',
    waveCount: waves.length,
    waves,
    parallelEligibleCount,
    serialForcedCount
  }
  return {
    ...core,
    scheduleDigest: sha256(Buffer.from(stableStringify(core), 'utf8'))
  }
}

/**
 * Expand selected set with delegatedClosure leaf nodeIds that exist in the manifest.
 * Ensures nested work is explicit in the plan graph (PF-148 slice-2).
 */
function expandSelectedWithNestedLeaves(selected, byId) {
  const expanded = new Set(selected)
  let grew = true
  while (grew) {
    grew = false
    for (const id of [...expanded]) {
      const node = byId.get(id)
      if (!node) continue
      for (const entry of node.delegatedClosure || []) {
        if (entry && entry.nodeId && byId.has(entry.nodeId) && !expanded.has(entry.nodeId)) {
          expanded.add(entry.nodeId)
          grew = true
        }
      }
    }
  }
  return expanded
}

function environmentPreserves(covering = {}, covered = {}) {
  return Object.entries(covered || {}).every(([key, value]) => covering && covering[key] === value)
}

function arrayIncludesAll(covering = [], covered = []) {
  if (!Array.isArray(covering) || !Array.isArray(covered)) return false
  if (covering.length === 0) return true
  const coveringSet = new Set(covering)
  return covered.every(item => coveringSet.has(item))
}

function globToRegExp(glob) {
  const source = normalizeRelativePath(glob)
  let out = '^'
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]
    if (char === '*' && next === '*') {
      if (source[index + 2] === '/') {
        out += '(?:.*/)?'
        index += 2
      } else {
        out += '.*'
        index += 1
      }
    } else if (char === '*') {
      out += '[^/]*'
    } else if (char === '?') {
      out += '[^/]'
    } else {
      out += /[\\^$+?.()|{}[\]]/.test(char) ? '\\' + char : char
    }
  }
  return new RegExp(out + '$')
}

function matchesAnyGlob(relativePath, globs) {
  return globs.some(glob => globToRegExp(glob).test(relativePath))
}

function normalizeCommandLine(command, args = []) {
  const parts = Array.isArray(args) && args.length
    ? [command, ...args]
    : String(command || '').trim().split(/\s+/).filter(Boolean)
  return parts.join(' ').replace(/\\/g, '/')
}

function extractScriptPathFromCommandLine(commandLine) {
  const parts = String(commandLine || '').trim().split(/\s+/).filter(Boolean)
  const script = parts.find(part => /(^|\/)scripts\/.+\.(js|cjs|mjs)$/.test(part.replace(/\\/g, '/')))
  return script ? script.replace(/\\/g, '/') : null
}

function readValidationManifest(manifestPath, options = {}) {
  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new ValidationDagError('VALIDATION_MANIFEST_READ_FAILED', error.message)
  }
  const repoRoot = options.repoRoot
    ? path.resolve(options.repoRoot)
    : path.dirname(path.resolve(manifestPath, '..'))
  validateValidationManifest(manifest, { repoRoot })
  return manifest
}

function validateValidationManifest(manifest, options = {}) {
  const repoRoot = options.repoRoot ? path.resolve(options.repoRoot) : null
  const errors = []
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new ValidationDagError('VALIDATION_MANIFEST_INVALID', 'manifest must be an object')
  }
  if (manifest.schemaVersion !== VALIDATION_MANIFEST_SCHEMA) {
    errors.push('schemaVersion must be ' + VALIDATION_MANIFEST_SCHEMA)
  }
  if (manifest.contractVersion !== VALIDATION_CONTRACT_VERSION) {
    errors.push('contractVersion must be ' + VALIDATION_CONTRACT_VERSION)
  }
  if (!Array.isArray(manifest.nodes) || manifest.nodes.length === 0) errors.push('nodes must be a non-empty array')
  if (!manifest.routes || typeof manifest.routes !== 'object' || Array.isArray(manifest.routes)) {
    errors.push('routes must be an object')
  }
  if (!Array.isArray(manifest.invariantNodes) || manifest.invariantNodes.length === 0) {
    errors.push('invariantNodes must be a non-empty array')
  }
  if (!Array.isArray(manifest.iterativeInvariantNodes) || manifest.iterativeInvariantNodes.length === 0) {
    errors.push('iterativeInvariantNodes must be a non-empty array')
  }
  if (!Array.isArray(manifest.criticalInputs) || manifest.criticalInputs.length === 0) {
    errors.push('criticalInputs must be a non-empty array')
  }
  if (!Array.isArray(manifest.iterativeEscalationInputs) || manifest.iterativeEscalationInputs.length === 0) {
    errors.push('iterativeEscalationInputs must be a non-empty array')
  }
  if (typeof manifest.consumerGraphComplete !== 'boolean') {
    errors.push('consumerGraphComplete must be a boolean')
  }
  if (errors.length) throw new ValidationDagError('VALIDATION_MANIFEST_INVALID', errors.join('; '), errors)

  const byId = new Map()
  const signatures = new Map()
  const nodeOrder = new Map()
  const requiredArrayFields = ['args', 'dependencies', 'inputs', 'consumers', 'invariants', 'writeScopes', 'evidenceArtifacts']
  manifest.nodes.forEach((node, index) => {
    const nodeErrors = []
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      errors.push('node at index ' + index + ' must be an object')
      return
    }
    if (node.schemaVersion !== VALIDATION_NODE_SCHEMA) nodeErrors.push('schemaVersion')
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(node.id || '')) nodeErrors.push('id')
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(node.owner || '')) nodeErrors.push('owner')
    if (!String(node.command || '').trim()) nodeErrors.push('command')
    if (node.environment !== undefined &&
        (!node.environment || typeof node.environment !== 'object' || Array.isArray(node.environment) ||
         Object.values(node.environment).some(value => typeof value !== 'string'))) {
      nodeErrors.push('environment')
    }
    for (const field of requiredArrayFields) {
      if (!Array.isArray(node[field])) nodeErrors.push(field)
    }
    if (node.delegatedClosure !== undefined) {
      if (!Array.isArray(node.delegatedClosure)) {
        nodeErrors.push('delegatedClosure')
      } else {
        for (const entry of node.delegatedClosure) {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
              !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.nodeId || '') ||
              !String(entry.probe || '').trim() || !String(entry.command || '').trim()) {
            nodeErrors.push('delegatedClosure.entry')
            break
          }
        }
      }
    }
    if (node.coversNodes !== undefined && (
      !Array.isArray(node.coversNodes) ||
      new Set(node.coversNodes).size !== node.coversNodes.length ||
      node.coversNodes.some(id => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id || ''))
    )) {
      nodeErrors.push('coversNodes')
    }
    if (!RISK_CLASSES.has(node.riskClass)) nodeErrors.push('riskClass')
    if (!CACHE_POLICIES.has(node.cachePolicy)) nodeErrors.push('cachePolicy')
    if (!Number.isInteger(node.timeoutMs) || node.timeoutMs < 1) nodeErrors.push('timeoutMs')
    if (!node.exitMap || stableStringify(node.exitMap.success || []) !== '[0]') nodeErrors.push('exitMap.success')
    if (node.cachePolicy === 'candidate-bound' && (node.riskClass !== 'normal' || node.writeScopes.length !== 0)) {
      nodeErrors.push('candidate-bound requires normal risk and empty writeScopes')
    }
    if (nodeErrors.length) errors.push('node ' + (node.id || index) + ' invalid fields: ' + nodeErrors.join(', '))
    if (byId.has(node.id)) errors.push('duplicate node id: ' + node.id)
    else {
      byId.set(node.id, node)
      nodeOrder.set(node.id, index)
    }
    const signature = commandSignature(node)
    if (signatures.has(signature)) {
      errors.push('duplicate leaf command: ' + node.id + ' and ' + signatures.get(signature))
    } else {
      signatures.set(signature, node.id)
    }
  })

  for (const node of manifest.nodes) {
    if (!node || !node.id) continue
    for (const dependency of node.dependencies || []) {
      if (!byId.has(dependency)) errors.push('node ' + node.id + ' has unknown dependency ' + dependency)
      if (dependency === node.id) errors.push('node ' + node.id + ' depends on itself')
    }
    for (const consumer of node.consumers || []) {
      if (!byId.has(consumer)) errors.push('node ' + node.id + ' has unknown consumer ' + consumer)
      if (consumer === node.id) errors.push('node ' + node.id + ' consumes itself')
    }
    for (const coveredId of node.coversNodes || []) {
      const covered = byId.get(coveredId)
      if (!covered) errors.push('node ' + node.id + ' covers unknown node ' + coveredId)
      else {
        if (coveredId === node.id) errors.push('node ' + node.id + ' covers itself')
        if (node.command !== covered.command || stableStringify(node.args) !== stableStringify(covered.args)) {
          errors.push('node ' + node.id + ' covers node with a different command: ' + coveredId)
        }
        if (!environmentPreserves(node.environment || {}, covered.environment || {})) {
          errors.push('node ' + node.id + ' does not preserve covered environment from ' + coveredId)
        }
        if (stableStringify(node.exitMap || {}) !== stableStringify(covered.exitMap || {})) {
          errors.push('node ' + node.id + ' does not preserve covered exit map from ' + coveredId)
        }
        if (node.cachePolicy !== covered.cachePolicy) {
          errors.push('node ' + node.id + ' does not preserve covered cache policy from ' + coveredId)
        }
        if ((node.timeoutMs || 0) < (covered.timeoutMs || 0)) {
          errors.push('node ' + node.id + ' has a shorter timeout than covered node ' + coveredId)
        }
        if (!arrayIncludesAll(node.inputs || [], covered.inputs || [])) {
          errors.push('node ' + node.id + ' does not cover input scope from ' + coveredId)
        }
        if (!arrayIncludesAll(node.writeScopes || [], covered.writeScopes || [])) {
          errors.push('node ' + node.id + ' does not cover write scopes from ' + coveredId)
        }
        for (const delegatedEntry of covered.delegatedClosure || []) {
          if (!(node.delegatedClosure || []).some(entry => stableStringify(entry) === stableStringify(delegatedEntry))) {
            errors.push('node ' + node.id + ' does not preserve delegated closure from ' + coveredId)
          }
        }
        for (const invariant of covered.invariants || []) {
          if (!(node.invariants || []).includes(invariant)) {
            errors.push('node ' + node.id + ' does not preserve covered invariant ' + invariant + ' from ' + coveredId)
          }
        }
      }
    }
    for (const glob of node.inputs || []) {
      try { globToRegExp(glob) } catch (error) { errors.push('node ' + node.id + ' invalid input glob: ' + error.message) }
    }
    // Nested command closure integrity (PF-148): delegated leaves must be real and consistent
    for (const entry of node.delegatedClosure || []) {
      if (!entry || typeof entry !== 'object') continue
      if (entry.nodeId && !byId.has(entry.nodeId)) {
        errors.push('node ' + node.id + ' delegatedClosure nodeId missing from manifest: ' + entry.nodeId)
      }
      const commandLine = normalizeCommandLine(entry.command)
      const scriptPath = extractScriptPathFromCommandLine(commandLine)
      if (repoRoot && scriptPath) {
        const absoluteScript = path.resolve(repoRoot, scriptPath)
        const relativeCheck = path.relative(repoRoot, absoluteScript)
        if (relativeCheck.startsWith('..') || path.isAbsolute(relativeCheck) || !fs.existsSync(absoluteScript)) {
          errors.push('node ' + node.id + ' delegatedClosure command missing or outside repo: ' + scriptPath)
        }
      }
      const peer = byId.get(entry.nodeId)
      if (peer) {
        const peerLine = normalizeCommandLine(peer.command, peer.args || [])
        // Only enforce parity for real script leaves (fixtures may use process.execPath stubs)
        if (extractScriptPathFromCommandLine(peerLine) && peerLine !== commandLine) {
          errors.push('node ' + node.id + ' delegatedClosure ' + entry.nodeId + ' command mismatches top-level leaf')
        }
      }
    }
  }

  for (const route of REQUIRED_ROUTES) {
    const descriptor = manifest.routes[route]
    if (!descriptor || typeof descriptor !== 'object') {
      errors.push('missing route: ' + route)
      continue
    }
    if (route === 'changed') {
      if (descriptor.dynamic !== true) errors.push('changed route must be dynamic')
      continue
    }
    if (!Array.isArray(descriptor.nodes) || descriptor.nodes.length === 0) {
      errors.push('route ' + route + ' must declare nodes')
      continue
    }
    const seen = new Set()
    for (const id of descriptor.nodes) {
      if (!byId.has(id)) errors.push('route ' + route + ' has unknown node ' + id)
      if (seen.has(id)) errors.push('route ' + route + ' has duplicate node ' + id)
      seen.add(id)
    }
  }
  for (const id of manifest.invariantNodes) {
    if (!byId.has(id)) errors.push('unknown invariant node: ' + id)
  }
  for (const id of manifest.iterativeInvariantNodes) {
    if (!byId.has(id)) errors.push('unknown iterative invariant node: ' + id)
  }
  for (const glob of manifest.criticalInputs) {
    try { globToRegExp(glob) } catch (error) { errors.push('invalid critical input glob: ' + error.message) }
  }
  for (const glob of manifest.iterativeEscalationInputs) {
    try { globToRegExp(glob) } catch (error) { errors.push('invalid iterative escalation input glob: ' + error.message) }
  }
  const packageSemantic = manifest.semanticInputs?.packageJson
  if (packageSemantic !== undefined) {
    for (const field of ['controlFields', 'publicMetadataFields', 'publicMetadataNodes']) {
      if (!Array.isArray(packageSemantic[field]) || packageSemantic[field].length === 0) {
        errors.push(`semanticInputs.packageJson.${field} must be a non-empty array`)
      }
    }
    for (const id of packageSemantic.publicMetadataNodes || []) {
      if (!byId.has(id)) errors.push('semanticInputs.packageJson has unknown public metadata node: ' + id)
    }
  }

  if (!errors.length) {
    try { topologicalNodeOrder(manifest) } catch (error) { errors.push(error.message) }
  }
  if (errors.length) throw new ValidationDagError('VALIDATION_MANIFEST_INVALID', errors.join('; '), errors)
  return { valid: true, nodeCount: manifest.nodes.length }
}

function topologicalNodeOrder(manifest) {
  const byId = new Map(manifest.nodes.map(node => [node.id, node]))
  const order = new Map(manifest.nodes.map((node, index) => [node.id, index]))
  const outgoing = new Map(manifest.nodes.map(node => [node.id, new Set()]))
  const indegree = new Map(manifest.nodes.map(node => [node.id, 0]))
  const addEdge = (from, to) => {
    if (!outgoing.get(from).has(to)) {
      outgoing.get(from).add(to)
      indegree.set(to, indegree.get(to) + 1)
    }
  }
  for (const node of manifest.nodes) {
    for (const dependency of node.dependencies) addEdge(dependency, node.id)
    for (const consumer of node.consumers) addEdge(node.id, consumer)
  }
  const ready = manifest.nodes.filter(node => indegree.get(node.id) === 0)
    .sort((left, right) => order.get(left.id) - order.get(right.id))
  const result = []
  while (ready.length) {
    const current = ready.shift()
    result.push(current)
    for (const next of outgoing.get(current.id)) {
      indegree.set(next, indegree.get(next) - 1)
      if (indegree.get(next) === 0) {
        ready.push(byId.get(next))
        ready.sort((left, right) => order.get(left.id) - order.get(right.id))
      }
    }
  }
  if (result.length !== manifest.nodes.length) {
    throw new ValidationDagError('VALIDATION_MANIFEST_CYCLE', 'validation dependency/consumer cycle detected')
  }
  return result
}

function addDependencies(ids, byId) {
  const selected = new Set(ids)
  const queue = [...selected]
  while (queue.length) {
    const id = queue.shift()
    for (const dependency of byId.get(id).dependencies) {
      if (!selected.has(dependency)) {
        selected.add(dependency)
        queue.push(dependency)
      }
    }
  }
  return selected
}

function addConsumers(ids, byId) {
  const selected = new Set(ids)
  const queue = [...selected]
  while (queue.length) {
    const id = queue.shift()
    for (const consumer of byId.get(id).consumers) {
      if (!selected.has(consumer)) {
        selected.add(consumer)
        queue.push(consumer)
      }
    }
  }
  return selected
}

function buildChangeDescriptors(changedFiles, descriptors = []) {
  const provided = new Map()
  for (const descriptor of descriptors || []) {
    const descriptorPath = normalizeRelativePath(descriptor?.path || descriptor?.file || '')
    if (provided.has(descriptorPath)) {
      throw new ValidationDagError('VALIDATION_CHANGE_DESCRIPTOR_INVALID', 'duplicate change descriptor: ' + descriptorPath)
    }
    provided.set(descriptorPath, descriptor)
  }
  for (const descriptorPath of provided.keys()) {
    if (!changedFiles.includes(descriptorPath)) {
      throw new ValidationDagError('VALIDATION_CHANGE_DESCRIPTOR_INVALID', 'descriptor path is not in changedFiles: ' + descriptorPath)
    }
  }
  return changedFiles.map(file => {
    const explicit = provided.get(file) || {}
    const fields = [...new Set((explicit.fields || []).map(String))].sort()
    let kind = String(explicit.kind || '')
    let semanticClass = String(explicit.semanticClass || '')
    if (file === 'package.json') {
      kind = kind || 'package-manifest'
      if (!fields.length) semanticClass = semanticClass || 'package-fields-unknown'
      else if (fields.every(field => PACKAGE_PUBLIC_METADATA_FIELDS.has(field))) semanticClass = 'package-public-metadata'
      else if (fields.some(field => PACKAGE_CONTROL_FIELDS.has(field))) semanticClass = 'package-control'
      else semanticClass = 'package-fields-unknown'
    } else {
      if (!kind) {
        if (/^(README\.md|public-site\/|website\/)/.test(file)) kind = 'public-documentation'
        else if (/^content\/skills\//.test(file)) kind = 'skill-catalog'
        else if (/^(scripts\/validation-manifest\.json|scripts\/run-validation\.js|scripts\/lib\/validation-)/.test(file)) kind = 'validation-control-plane'
        else if (/^scripts\/test-/.test(file)) kind = 'test'
        else if (/\.mdx?$/.test(file)) kind = 'documentation'
        else kind = 'source'
      }
      semanticClass = semanticClass || kind
    }
    return {
      schemaVersion: 'ValidationChangeDescriptorV1',
      path: file,
      kind,
      fields,
      semanticClass
    }
  })
}

function buildValidationImpactGraph({ manifest, changedFiles = [], changeDescriptors = [], invariantNodeIds = null }) {
  const normalizedChanged = [...new Set(changedFiles.map(normalizeRelativePath))].sort()
  const descriptors = buildChangeDescriptors(normalizedChanged, changeDescriptors)
  const descriptorByPath = new Map(descriptors.map(descriptor => [descriptor.path, descriptor]))
  const byId = new Map(manifest.nodes.map(node => [node.id, node]))
  const semanticPackageNodes = new Set(manifest.semanticInputs?.packageJson?.publicMetadataNodes || [])
  const matchedNodeIds = manifest.nodes.filter(node => normalizedChanged.some(file => {
    const descriptor = descriptorByPath.get(file)
    if (file === 'package.json' && descriptor?.semanticClass === 'package-public-metadata') {
      return semanticPackageNodes.has(node.id)
    }
    return matchesAnyGlob(file, node.inputs)
  })).map(node => node.id)
  const matchedSet = new Set(matchedNodeIds)
  const unknownInputs = normalizedChanged.filter(file => {
    const descriptor = descriptorByPath.get(file)
    if (file === 'package.json' && descriptor?.semanticClass === 'package-public-metadata') {
      return ![...semanticPackageNodes].some(id => matchedSet.has(id))
    }
    return !manifest.nodes.some(node => matchesAnyGlob(file, node.inputs))
  })
  let affected = addConsumers(new Set(matchedNodeIds), byId)
  const invariantIds = invariantNodeIds || manifest.iterativeInvariantNodes || manifest.invariantNodes
  for (const invariant of invariantIds) affected.add(invariant)
  affected = addDependencies(affected, byId)
  const affectedNodeIds = topologicalNodeOrder(manifest).filter(node => affected.has(node.id)).map(node => node.id)
  const edges = []
  for (const node of manifest.nodes) {
    for (const dependency of node.dependencies) if (affected.has(node.id) || affected.has(dependency)) edges.push([dependency, node.id, 'dependency'])
    for (const consumer of node.consumers) if (affected.has(node.id) || affected.has(consumer)) edges.push([node.id, consumer, 'consumer'])
  }
  const core = {
    schemaVersion: 'ValidationImpactGraphV1',
    changedFiles: normalizedChanged,
    changeDescriptors: descriptors,
    matchedNodeIds,
    affectedNodeIds,
    invariantNodeIds: invariantIds.filter(id => affected.has(id)),
    unknownInputs,
    consumerGraphComplete: manifest.consumerGraphComplete === true,
    edges: edges.sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)))
  }
  return {
    ...core,
    complete: core.consumerGraphComplete && unknownInputs.length === 0,
    impactGraphDigest: sha256(Buffer.from(stableStringify(core), 'utf8'))
  }
}

function planValidation({ manifest, route = 'changed', changedFiles = [], changeDescriptors = [], changedSource = 'explicit',
  riskClass = 'normal', candidateStable = true, candidateId = null }) {
  validateValidationManifest(manifest)
  if (!REQUIRED_ROUTES.includes(route)) {
    throw new ValidationDagError('VALIDATION_ROUTE_UNKNOWN', 'unknown route: ' + route)
  }
  if (!RISK_CLASSES.has(riskClass)) {
    throw new ValidationDagError('VALIDATION_RISK_UNKNOWN', 'unknown risk class: ' + riskClass)
  }
  const normalizedChanged = [...new Set(changedFiles.map(normalizeRelativePath))].sort()
  const normalizedDescriptors = buildChangeDescriptors(normalizedChanged, changeDescriptors)
  const descriptorByPath = new Map(normalizedDescriptors.map(descriptor => [descriptor.path, descriptor]))
  const byId = new Map(manifest.nodes.map(node => [node.id, node]))
  const ordered = topologicalNodeOrder(manifest)
  const fullIds = new Set(manifest.routes.full.nodes)
  const iterativeInvariantIds = manifest.iterativeInvariantNodes || manifest.invariantNodes
  let impactGraph = buildValidationImpactGraph({
    manifest,
    changedFiles: normalizedChanged,
    changeDescriptors: normalizedDescriptors,
    invariantNodeIds: route === 'changed' ? iterativeInvariantIds : manifest.invariantNodes
  })
  let selected = new Set()
  let routeResolved = route
  let fullFallback = null

  if (route !== 'changed') {
    selected = new Set(manifest.routes[route].nodes)
  } else if (!candidateStable || changedSource === 'unknown') {
    routeResolved = 'full'
    fullFallback = 'candidate-identity-unstable'
    selected = new Set(fullIds)
  } else if (riskClass !== 'normal') {
    routeResolved = 'full'
    fullFallback = 'risk-' + riskClass
    selected = new Set(fullIds)
  } else if (!manifest.consumerGraphComplete) {
    routeResolved = 'full'
    fullFallback = 'consumer-graph-incomplete'
    selected = new Set(fullIds)
  } else if (normalizedChanged.some(file => {
    const descriptor = descriptorByPath.get(file)
    if (file === 'package.json' && descriptor?.semanticClass === 'package-public-metadata') return false
    return matchesAnyGlob(file, manifest.iterativeEscalationInputs || manifest.criticalInputs)
  })) {
    routeResolved = 'full'
    fullFallback = 'validation-control-plane-changed'
    selected = new Set(fullIds)
  } else {
    const unknown = impactGraph.unknownInputs
    if (unknown.length) {
      routeResolved = 'full'
      fullFallback = 'unknown-input:' + unknown.join(',')
      selected = new Set(fullIds)
    } else {
      selected = new Set(impactGraph.affectedNodeIds)
      if (selected.size / fullIds.size > 0.8) {
        routeResolved = 'full'
        fullFallback = 'closure-over-80-percent'
        selected = new Set(fullIds)
      }
    }
  }

  const validationLayer = route === 'changed' && routeResolved === 'changed' ? 'iterative' : 'qualification'
  const invariantIds = validationLayer === 'iterative' ? iterativeInvariantIds : manifest.invariantNodes
  if (validationLayer === 'qualification' && route === 'changed') {
    impactGraph = buildValidationImpactGraph({
      manifest,
      changedFiles: normalizedChanged,
      changeDescriptors: normalizedDescriptors,
      invariantNodeIds: invariantIds
    })
  }
  const coveredNodeIds = new Set([...selected].flatMap(id => byId.get(id)?.coversNodes || []))
  const coveredInvariantNodes = invariantIds.filter(id => coveredNodeIds.has(id))
  for (const invariant of invariantIds) {
    if (!coveredNodeIds.has(invariant)) selected.add(invariant)
  }
  selected = addDependencies(selected, byId)
  // PF-148 slice-2: make nested delegated leaves explicit in the selected plan graph
  selected = expandSelectedWithNestedLeaves(selected, byId)
  selected = addDependencies(selected, byId)
  const selectedNodes = ordered.filter(node => selected.has(node.id))
  const nestedCommandGraph = buildNestedCommandGraph({ nodes: selectedNodes })
  const executionSchedule = planLockAwareSchedule(selectedNodes)
  const skipped = ordered.filter(node => !selected.has(node.id)).map(node => ({
    nodeId: node.id,
    authority: routeResolved === 'full' ? 'full-route-manifest' : 'changed-closure',
    reason: 'not selected by ' + routeResolved + ' route',
    residualRisk: 'covered by invariant roots and full-fallback rules',
    upgradeCondition: 'input, consumer, risk, manifest, or candidate identity changes'
  }))
  const signatures = new Set(selectedNodes.map(commandSignature))
  const nestedParentIds = {}
  for (const edge of nestedCommandGraph.edges) {
    if (!selected.has(edge.childId) || !selected.has(edge.parentId)) continue
    if (!nestedParentIds[edge.childId]) nestedParentIds[edge.childId] = []
    if (!nestedParentIds[edge.childId].includes(edge.parentId)) {
      nestedParentIds[edge.childId].push(edge.parentId)
    }
  }
  const matchedIds = new Set(impactGraph.matchedNodeIds)
  const affectedIds = new Set(impactGraph.affectedNodeIds)
  const invariantSet = new Set(invariantIds)
  const selectionReasons = {}
  for (const node of selectedNodes) {
    const reasons = []
    if (routeResolved === 'full') reasons.push(fullFallback ? `fallback:${fullFallback}` : 'route:full')
    else if (route !== 'changed') reasons.push(`route:${routeResolved}`)
    if (matchedIds.has(node.id)) reasons.push('input-match')
    else if (affectedIds.has(node.id)) reasons.push('impact-closure')
    if (invariantSet.has(node.id)) reasons.push(`${validationLayer}-invariant`)
    if (nestedParentIds[node.id]?.length) reasons.push('delegated-leaf')
    if (!reasons.length) reasons.push('dependency-closure')
    selectionReasons[node.id] = [...new Set(reasons)].sort()
  }
  const budget = {
    selectedNodeCount: selectedNodes.length,
    fullNodeCount: fullIds.size,
    savedNodeCount: Math.max(0, fullIds.size - selectedNodes.length),
    selectionRatio: fullIds.size === 0 ? 1 : Number((selectedNodes.length / fullIds.size).toFixed(4))
  }
  const planCore = {
    schemaVersion: 'ValidationPlanV1',
    routeRequested: route,
    routeResolved,
    riskClass,
    candidateId,
    candidateStable,
    changedSource,
    changedFiles: normalizedChanged,
    validationLayer,
    changeDescriptors: normalizedDescriptors,
    impactGraph,
    impactGraphDigest: impactGraph.impactGraphDigest,
    nestedCommandGraphDigest: nestedCommandGraph.digest,
    nestedEdgeCount: nestedCommandGraph.edgeCount,
    nestedParentIds,
    delegatedParentIds: nestedParentIds,
    executionSchedule,
    fullFallback,
    selectedNodes,
    selectionReasons,
    budget,
    skipped,
    selectedNodeCount: selectedNodes.length,
    fullNodeCount: fullIds.size,
    coveredInvariantNodes,
    duplicateLeafCount: selectedNodes.length - signatures.size,
    requiredNodeMisses: 0
  }
  return { ...planCore, planDigest: sha256(Buffer.from(stableStringify(planCore), 'utf8')) }
}

function gitOutput(repoRoot, args, encoding = 'utf8') {
  return execFileSync('git', args, { cwd: repoRoot, encoding, windowsHide: true })
}

function nullSeparated(value) {
  return String(value || '').split('\0').filter(Boolean)
}

function buildCandidateIdentity({ repoRoot, explicitChangedFiles = null }) {
  const absoluteRoot = path.resolve(repoRoot)
  let head = null
  let statusBuffer = ''
  let stable = true
  let changedSource = explicitChangedFiles ? 'explicit' : 'git-clean'
  const gitChanged = new Set()
  try {
    head = String(gitOutput(absoluteRoot, ['rev-parse', 'HEAD'])).trim()
    statusBuffer = String(gitOutput(absoluteRoot, ['status', '--porcelain=v1', '-z']))
    for (const args of [
      ['diff', '--name-only', '-z'],
      ['diff', '--cached', '--name-only', '-z'],
      ['ls-files', '--others', '--exclude-standard', '-z']
    ]) {
      for (const file of nullSeparated(gitOutput(absoluteRoot, args))) gitChanged.add(normalizeRelativePath(file))
    }
    if (!explicitChangedFiles && gitChanged.size) changedSource = 'git-dirty'
  } catch {
    stable = false
    changedSource = explicitChangedFiles ? 'explicit-unstable' : 'unknown'
  }

  const changedFiles = explicitChangedFiles
    ? [...new Set(explicitChangedFiles.map(normalizeRelativePath))].sort()
    : [...gitChanged].sort()
  const dirtyIdentities = []
  if (stable) {
    for (const relativePath of [...gitChanged].sort()) {
      const absolutePath = path.resolve(absoluteRoot, relativePath)
      const relativeCheck = path.relative(absoluteRoot, absolutePath)
      if (relativeCheck.startsWith('..') || path.isAbsolute(relativeCheck)) {
        stable = false
        break
      }
      if (!fs.existsSync(absolutePath)) {
        dirtyIdentities.push({ path: relativePath, deleted: true })
      } else {
        const content = fs.readFileSync(absolutePath)
        dirtyIdentities.push({ path: relativePath, deleted: false, digest: sha256(content), bytes: content.length })
      }
    }
  }
  const identityInputs = {
    schemaVersion: 'ValidationCandidateIdentityV1',
    repoKey: path.basename(absoluteRoot),
    head,
    statusDigest: sha256(Buffer.from(statusBuffer, 'utf8')),
    dirtyIdentities,
    contractVersion: VALIDATION_CONTRACT_VERSION
  }
  const candidateId = 'validation-candidate-' + buildJsonContentIdentity({
    sourceKey: 'validation-candidate',
    value: identityInputs,
    contractVersion: VALIDATION_CONTRACT_VERSION
  }).identity.digest
  return { candidateId, stable, head, changedFiles, changedSource, dirtyIdentities, identityInputs }
}

function manifestIdentity(manifest) {
  return buildJsonContentIdentity({
    sourceKey: 'scripts/validation-manifest.json',
    value: manifest,
    contractVersion: VALIDATION_CONTRACT_VERSION
  }).identity
}

function cacheDescriptor({ manifestIdentityValue, candidate, node }) {
  const selectedInputs = candidate.dirtyIdentities.filter(item => matchesAnyGlob(item.path, node.inputs))
  const value = {
    schemaVersion: VALIDATION_CACHE_SCHEMA,
    candidateId: candidate.candidateId,
    manifestIdentity: manifestIdentityValue,
    nodeId: node.id,
    command: node.command,
    args: node.args,
    environment: node.environment || {},
    selectedInputs,
    nodeVersion: node.schemaVersion,
    contractVersion: VALIDATION_CONTRACT_VERSION,
    nodeRuntime: process.version,
    platform: process.platform + '-' + process.arch
  }
  const identity = buildJsonContentIdentity({
    sourceKey: 'validation-cache/' + node.id,
    value,
    contractVersion: VALIDATION_CONTRACT_VERSION
  }).identity
  return {
    cacheKey: identity.digest,
    cacheIdentity: identity,
    selectedInputs,
    expectedEvidence: {
      nodeId: node.id,
      command: node.command,
      args: node.args,
      environment: node.environment || {},
      invariantCoverage: node.invariants
    }
  }
}

function directoryUsage(root, maxEntries = VALIDATION_CACHE_MAX_ENTRIES) {
  if (!fs.existsSync(root)) return { bytes: 0, entries: 0, bounded: true }
  let bytes = 0
  let entries = 0
  const pending = [root]
  while (pending.length) {
    const current = pending.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) pending.push(absolute)
      else {
        entries += 1
        if (entries > maxEntries) return { bytes, entries, bounded: false }
        bytes += fs.statSync(absolute).size
      }
    }
  }
  return { bytes, entries, bounded: true }
}

function cacheRelativePath(cacheKey) {
  return path.join('.runtime-state', 'validation-evidence', 'v1', 'cache', cacheKey + '.json')
}

function cacheStoreRelativePath(cacheKey) {
  return cacheRelativePath(cacheKey).replace(/^\.runtime-state[\\/]/, '')
}

function readNodeCache({ activeRoot, descriptor }) {
  const store = createRuntimeStateStore({
    activeRoot,
    relativePath: cacheStoreRelativePath(descriptor.cacheKey),
    maxBytes: 1024 * 1024,
    maxWrites: 0,
    identityField: 'cacheIdentity'
  })
  const observed = store.read({ expectedIdentity: descriptor.cacheIdentity })
  if (observed.status !== 'fresh') return { status: observed.status, evidence: null, filePath: store.filePath }
  const value = observed.value
  if (value.schemaVersion !== VALIDATION_CACHE_SCHEMA || value.cacheKey !== descriptor.cacheKey) {
    return { status: 'invalid', evidence: null, filePath: store.filePath }
  }
  if (!value.nodeEvidence || typeof value.nodeEvidence !== 'object' || Array.isArray(value.nodeEvidence)) {
    return { status: 'invalid', evidence: null, filePath: store.filePath }
  }
  const evidenceText = stableStringify(value.nodeEvidence)
  if (!matchesContentIdentity(value.evidenceIdentity, evidenceText)) {
    return { status: 'invalid', evidence: null, filePath: store.filePath }
  }
  const expected = descriptor.expectedEvidence
  const evidenceValid = value.nodeEvidence.status === 'passed' &&
    value.nodeEvidence.exitCode === 0 &&
    value.nodeEvidence.nodeId === expected.nodeId &&
    value.nodeEvidence.command === expected.command &&
    stableStringify(value.nodeEvidence.args) === stableStringify(expected.args) &&
    stableStringify(value.nodeEvidence.environment || {}) === stableStringify(expected.environment) &&
    stableStringify(value.nodeEvidence.invariantCoverage) === stableStringify(expected.invariantCoverage) &&
    stableStringify(value.invariantCoverage) === stableStringify(expected.invariantCoverage)
  if (!evidenceValid) {
    return { status: 'invalid', evidence: null, filePath: store.filePath }
  }
  return { status: 'hit', evidence: value.nodeEvidence, filePath: store.filePath }
}

function writeNodeCache({ activeRoot, descriptor, nodeEvidence, maxCacheBytes = VALIDATION_CACHE_MAX_BYTES }) {
  const evidenceText = stableStringify(nodeEvidence)
  const value = {
    schemaVersion: VALIDATION_CACHE_SCHEMA,
    cacheKey: descriptor.cacheKey,
    cacheIdentity: descriptor.cacheIdentity,
    evidenceIdentity: buildContentIdentity({
      sourceKey: 'validation-evidence/' + nodeEvidence.nodeId,
      content: evidenceText,
      contractVersion: VALIDATION_CONTRACT_VERSION
    }),
    invariantCoverage: nodeEvidence.invariantCoverage,
    nodeEvidence
  }
  const evidenceRoot = path.join(resolveRuntimeStateRoot(activeRoot).root, 'validation-evidence', 'v1')
  const usage = directoryUsage(evidenceRoot)
  const pendingBytes = Buffer.byteLength(JSON.stringify(value, null, 2) + '\n')
  if (!usage.bounded || usage.bytes + pendingBytes > maxCacheBytes) {
    return { status: 'bypassed', errorCode: 'VALIDATION_CACHE_CAPACITY_REACHED', usage, pendingBytes }
  }
  const store = createRuntimeStateStore({
    activeRoot,
    relativePath: cacheStoreRelativePath(descriptor.cacheKey),
    maxBytes: 1024 * 1024,
    maxWrites: 1,
    identityField: 'cacheIdentity'
  })
  return store.write(value)
}

function persistReceipt(activeRoot, receipt, maxCacheBytes = VALIDATION_CACHE_MAX_BYTES) {
  const evidenceRoot = path.join(resolveRuntimeStateRoot(activeRoot).root, 'validation-evidence', 'v1')
  const relativePath = path.join('validation-evidence', 'v1', 'receipts', receipt.runId + '.json')
  const receiptText = stableStringify(receipt)
  const receiptIdentity = buildContentIdentity({
    sourceKey: 'validation-receipt/' + receipt.runId,
    content: receiptText,
    contractVersion: VALIDATION_CONTRACT_VERSION
  })
  const persistedValue = { ...receipt, receiptIdentity }
  const usage = directoryUsage(evidenceRoot)
  const pendingBytes = Buffer.byteLength(JSON.stringify(persistedValue, null, 2) + '\n')
  if (!usage.bounded || usage.bytes + pendingBytes > maxCacheBytes) {
    return { status: 'bypassed', errorCode: 'VALIDATION_CACHE_CAPACITY_REACHED', usage, pendingBytes }
  }
  const store = createRuntimeStateStore({
    activeRoot,
    relativePath,
    maxBytes: 4 * 1024 * 1024,
    maxWrites: 1,
    identityField: 'receiptIdentity'
  })
  return store.write(persistedValue)
}

function resolveCacheEvidenceFallback({ manifest, plan, candidate, activeRoot, useCache, manifestIdentityValue }) {
  if (!useCache || !candidate.stable || plan.routeRequested !== 'changed' || plan.routeResolved !== 'changed') {
    return plan
  }
  for (const node of plan.selectedNodes) {
    if (node.cachePolicy !== 'candidate-bound') continue
    const descriptor = cacheDescriptor({ manifestIdentityValue, candidate, node })
    const cached = readNodeCache({ activeRoot, descriptor })
    if (cached.status !== 'stale' && cached.status !== 'invalid') continue
    const fullPlan = planValidation({
      manifest,
      route: 'full',
      changedFiles: plan.changedFiles,
      changedSource: plan.changedSource,
      riskClass: plan.riskClass,
      candidateStable: candidate.stable,
      candidateId: candidate.candidateId
    })
    return {
      ...fullPlan,
      routeRequested: plan.routeRequested,
      fullFallback: 'cache-evidence-' + cached.status + ':' + node.id
    }
  }
  return plan
}

function executeValidationPlan({ manifest, plan, candidate, repoRoot, activeRoot, useCache = true,
  runCommand = null, onNode = null, maxCacheBytes = VALIDATION_CACHE_MAX_BYTES }) {
  const startedAtMs = Date.now()
  const startedAt = new Date(startedAtMs).toISOString()
  const runId = 'validation-' + startedAt.replace(/[-:.TZ]/g, '') + '-' + crypto.randomBytes(4).toString('hex')
  const manifestIdentityValue = manifestIdentity(manifest)
  const effectivePlan = resolveCacheEvidenceFallback({
    manifest,
    plan,
    candidate,
    activeRoot,
    useCache,
    manifestIdentityValue
  })
  const results = []
  const abortedNodes = []
  let failedNode = null
  const invoke = runCommand || ((node) => runChecked(node.command, node.args, {
    cwd: repoRoot,
    env: node.environment || {},
    timeoutMs: node.timeoutMs
  }))

  // PF-148 slice-2: lock-aware wave order (serial flatten); keep receipt schedule evidence
  const executionSchedule = effectivePlan.executionSchedule || planLockAwareSchedule(effectivePlan.selectedNodes)
  const bySelectedId = new Map(effectivePlan.selectedNodes.map(node => [node.id, node]))
  const orderedForExecution = []
  for (const wave of executionSchedule.waves || []) {
    for (const nodeId of wave) {
      const node = bySelectedId.get(nodeId)
      if (node) orderedForExecution.push(node)
    }
  }
  // Fallback if schedule empty
  const executionNodes = orderedForExecution.length ? orderedForExecution : effectivePlan.selectedNodes
  const seenCommandSignatures = new Map()

  for (let index = 0; index < executionNodes.length; index += 1) {
    const node = executionNodes[index]
    const declaredDelegates = new Set((node.delegatedClosure || []).map(entry => entry.nodeId))
    const delegatedNodeIds = executionNodes
      .filter(item => item.id !== node.id && declaredDelegates.has(item.id))
      .map(item => item.id)
    const executionNode = Array.isArray(node.delegatedClosure) && node.delegatedClosure.length > 0
      ? {
          ...node,
          environment: {
            ...(node.environment || {}),
            DEVCODEX_VALIDATION_ORCHESTRATED: '1',
            DEVCODEX_VALIDATION_DELEGATED_NODES: delegatedNodeIds.join(',')
          }
        }
      : node
    const nodeContractDigest = sha256(Buffer.from(stableStringify(executionNode), 'utf8'))
    const dependencyReceiptDigests = node.dependencies.map(dependency => {
      const prior = results.find(result => result.nodeId === dependency)
      return prior ? prior.evidenceDigest || prior.cacheIdentity?.digest || null : null
    })
    const delegatedClosureDigest = sha256(Buffer.from(stableStringify({
      nodeId: node.id,
      dependencies: node.dependencies,
      consumers: node.consumers,
      delegatedClosure: node.delegatedClosure || [],
      delegatedNodeIds,
      executionMode: 'orchestrated'
    }), 'utf8'))
    const descriptor = cacheDescriptor({ manifestIdentityValue, candidate, node })
    const cacheEligible = useCache && candidate.stable && node.cachePolicy === 'candidate-bound'
    if (cacheEligible) {
      const cached = readNodeCache({ activeRoot, descriptor })
      if (cached.status === 'hit') {
        const result = { ...cached.evidence, status: 'cache-hit', cacheStatus: 'hit' }
        results.push(result)
        seenCommandSignatures.set(commandSignature(executionNode), node.id)
        if (onNode) onNode(result)
        continue
      }
    }

    // PF-148 slice-2: same leaf command signature already passed/cache-hit → reuse evidence (no double run)
    const signature = commandSignature(executionNode)
    const priorOwner = seenCommandSignatures.get(signature)
    if (priorOwner) {
      const prior = results.find(result => result.nodeId === priorOwner &&
        (result.status === 'passed' || result.status === 'cache-hit'))
      if (prior) {
        const reused = {
          ...prior,
          nodeId: node.id,
          nodeContractDigest,
          dependencyReceiptDigests,
          delegatedClosureDigest,
          status: 'cache-hit',
          cacheStatus: 'hit-duplicate-leaf',
          reuseOfNodeId: priorOwner,
          evidenceReuse: 'duplicate-leaf-command-signature'
        }
        results.push(reused)
        if (onNode) onNode(reused)
        continue
      }
    }

    try {
      const evidence = invoke(executionNode)
      const nodeEvidence = {
        nodeId: node.id,
        nodeContractDigest,
        dependencyReceiptDigests,
        delegatedClosureDigest,
        status: 'passed',
        cacheStatus: node.cachePolicy === 'candidate-bound'
          ? (candidate.stable ? 'miss' : 'bypassed-unstable')
          : 'disabled',
        command: executionNode.command,
        args: executionNode.args,
        environment: executionNode.environment || {},
        exitCode: evidence.exitCode,
        signal: evidence.signal || null,
        durationMs: evidence.durationMs,
        stdout: evidence.stdout || '',
        stderr: evidence.stderr || '',
        invariantCoverage: node.invariants,
        evidenceDigest: sha256(Buffer.from(stableStringify({
          nodeId: node.id,
          command: executionNode.command,
          args: executionNode.args,
          environment: executionNode.environment || {},
          exitCode: evidence.exitCode,
          signal: evidence.signal || null,
          stdout: evidence.stdout || '',
          stderr: evidence.stderr || ''
        }), 'utf8'))
      }
      if (cacheEligible) {
        nodeEvidence.cacheWrite = writeNodeCache({
          activeRoot,
          descriptor,
          nodeEvidence,
          maxCacheBytes
        }).status
      }
      results.push(nodeEvidence)
      seenCommandSignatures.set(signature, node.id)
      if (onNode) onNode(nodeEvidence)
    } catch (error) {
      const evidence = error instanceof CheckedCommandError ? error.evidence : (error.evidence || {})
      failedNode = node.id
      const result = {
        nodeId: node.id,
        nodeContractDigest,
        dependencyReceiptDigests,
        delegatedClosureDigest,
        status: 'failed',
        cacheStatus: 'disabled',
        command: executionNode.command,
        args: executionNode.args,
        environment: executionNode.environment || {},
        exitCode: typeof evidence.exitCode === 'number' ? evidence.exitCode : null,
        signal: evidence.signal || null,
        durationMs: Number(evidence.durationMs || 0),
        stdout: evidence.stdout || '',
        stderr: evidence.stderr || error.message,
        errorCode: error.code || evidence.code || 'VALIDATION_NODE_FAILED',
        invariantCoverage: node.invariants
      }
      results.push(result)
      if (onNode) onNode(result)
      for (const pending of executionNodes.slice(index + 1)) abortedNodes.push(pending.id)
      break
    }
  }

  const completedAtMs = Date.now()
  const stdoutBytes = results.reduce((sum, result) => sum + Buffer.byteLength(String(result.stdout || ''), 'utf8'), 0)
  const stderrBytes = results.reduce((sum, result) => sum + Buffer.byteLength(String(result.stderr || ''), 'utf8'), 0)
  const semanticReceipt = {
    schemaVersion: VALIDATION_RECEIPT_SCHEMA,
    contractVersion: VALIDATION_CONTRACT_VERSION,
    runId,
    candidateId: candidate.candidateId,
    candidateStable: candidate.stable,
    candidateIdentity: {
      candidateId: candidate.candidateId,
      stable: candidate.stable,
      head: candidate.head || null,
      changedSource: candidate.changedSource || 'unknown',
      changedFiles: candidate.changedFiles || [],
      dirtyIdentities: candidate.dirtyIdentities || []
    },
    manifestIdentity: manifestIdentityValue,
    routeRequested: effectivePlan.routeRequested,
    routeResolved: effectivePlan.routeResolved,
    riskClass: effectivePlan.riskClass,
    validationLayer: effectivePlan.validationLayer,
    changedSource: effectivePlan.changedSource,
    changedFiles: effectivePlan.changedFiles,
    changeDescriptors: effectivePlan.changeDescriptors || [],
    impactGraphDigest: effectivePlan.impactGraphDigest,
    nodeContractDigest: sha256(Buffer.from(stableStringify(results.map(result => [result.nodeId, result.nodeContractDigest])), 'utf8')),
    dependencyReceiptDigests: Object.fromEntries(results.map(result => [result.nodeId, result.dependencyReceiptDigests || []])),
    delegatedClosureDigest: sha256(Buffer.from(stableStringify(results.map(result => [result.nodeId, result.delegatedClosureDigest])), 'utf8')),
    testRouteDigest: effectivePlan.planDigest,
    intentExpansionDigest: process.env.DEVCODEX_INTENT_EXPANSION_DIGEST || null,
    contextBindingTrace: process.env.DEVCODEX_CONTEXT_BINDING_DIGEST
      ? { status: 'bound', bindingDigest: process.env.DEVCODEX_CONTEXT_BINDING_DIGEST }
      : { status: 'unverified', bindingDigest: null },
    executionMode: 'orchestrated-serial-lock-aware',
    nestedCommandGraphDigest: effectivePlan.nestedCommandGraphDigest || null,
    nestedEdgeCount: effectivePlan.nestedEdgeCount || 0,
    nestedParentIds: effectivePlan.nestedParentIds || {},
    delegatedParentIds: effectivePlan.delegatedParentIds || effectivePlan.nestedParentIds || {},
    executionSchedule,
    cacheDecision: {
      requested: useCache,
      eligibleRoute: effectivePlan.routeRequested === 'changed' && effectivePlan.routeResolved === 'changed',
      hitCount: results.filter(result => result.status === 'cache-hit').length,
      duplicateLeafReuseCount: results.filter(result => result.cacheStatus === 'hit-duplicate-leaf').length
    },
    fullFallback: effectivePlan.fullFallback,
    selectedNodes: effectivePlan.selectedNodes.map(node => node.id),
    selectionReasons: effectivePlan.selectionReasons || {},
    budget: effectivePlan.budget || null,
    executionOrder: executionNodes.map(node => node.id),
    skipped: effectivePlan.skipped,
    results,
    abortedNodes,
    failedNode,
    selectedNodeCount: effectivePlan.selectedNodeCount,
    executionCount: results.filter(result => result.status !== 'cache-hit').length,
    cacheHitCount: results.filter(result => result.status === 'cache-hit').length,
    duplicateLeafCount: effectivePlan.duplicateLeafCount,
    requiredNodeMisses: effectivePlan.requiredNodeMisses,
    startedAt,
    completedAt: new Date(completedAtMs).toISOString(),
    wallTimeMs: completedAtMs - startedAtMs,
    stdoutBytes,
    stderrBytes,
    nativeExitCode: failedNode ? 1 : 0
  }
  const receiptId = 'validation-receipt-' + sha256(Buffer.from(stableStringify(semanticReceipt), 'utf8'))
  const receipt = { ...semanticReceipt, receiptId }
  const persistence = persistReceipt(activeRoot, receipt, maxCacheBytes)
  return { receipt, persistence }
}

module.exports = {
  CACHE_POLICIES,
  REQUIRED_ROUTES,
  RISK_CLASSES,
  VALIDATION_CACHE_MAX_BYTES,
  VALIDATION_CACHE_SCHEMA,
  VALIDATION_CONTRACT_VERSION,
  VALIDATION_MANIFEST_SCHEMA,
  VALIDATION_NODE_SCHEMA,
  VALIDATION_RECEIPT_SCHEMA,
  ValidationDagError,
  buildCandidateIdentity,
  buildNestedCommandGraph,
  buildValidationImpactGraph,
  cacheDescriptor,
  cacheRelativePath,
  commandSignature,
  directoryUsage,
  executeValidationPlan,
  expandSelectedWithNestedLeaves,
  extractScriptPathFromCommandLine,
  globToRegExp,
  manifestIdentity,
  matchesAnyGlob,
  normalizeCommandLine,
  normalizeRelativePath,
  planLockAwareSchedule,
  planValidation,
  readNodeCache,
  readValidationManifest,
  topologicalNodeOrder,
  validateValidationManifest,
  writeNodeCache,
  writeScopesConflict
}
