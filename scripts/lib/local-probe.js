'use strict'

const LOCAL_PROBE_DESCRIPTOR_SCHEMA_VERSION = 'LocalProbeDescriptorV1'
const LOCAL_PROBE_RESULT_SCHEMA_VERSION = 'LocalProbeResultV1'
const LOCAL_PROBE_RUN_SCHEMA_VERSION = 'LocalProbeRunV1'
const PROBE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

class LocalProbeContractError extends Error {
  constructor(code, message, nextStep) {
    super(message)
    this.name = 'LocalProbeContractError'
    this.code = code
    this.nextStep = nextStep
  }
}

function normalizeIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim())
    .filter(Boolean))].sort()
}

function toIso(clock) {
  const value = typeof clock === 'function' ? clock() : Date.now()
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new TypeError('probe clock must return a valid date or epoch')
  return date.toISOString()
}

/** Build the bounded local-only registry used by the public diagnostic command. */
function createLocalProbeRegistry(descriptors) {
  if (!Array.isArray(descriptors)) throw new TypeError('local probe descriptors must be an array')
  const byId = new Map()
  for (const candidate of descriptors) {
    if (!candidate || typeof candidate !== 'object') throw new TypeError('local probe descriptor must be an object')
    const id = String(candidate.id || '')
    const owner = String(candidate.owner || '')
    const description = String(candidate.description || '').trim()
    const dependencies = normalizeIds(candidate.dependencies)
    if (!PROBE_ID_PATTERN.test(id)) throw new Error(`invalid local probe id: ${id || '(missing)'}`)
    if (!PROBE_ID_PATTERN.test(owner)) throw new Error(`invalid local probe owner: ${owner || '(missing)'}`)
    if (!description) throw new Error(`local probe ${id} is missing description`)
    if (typeof candidate.run !== 'function') throw new TypeError(`local probe ${id} run must be a function`)
    if (dependencies.includes(id)) throw new Error(`local probe ${id} cannot depend on itself`)
    if (byId.has(id)) throw new Error(`duplicate local probe id: ${id}`)
    byId.set(id, Object.freeze({
      schemaVersion: LOCAL_PROBE_DESCRIPTOR_SCHEMA_VERSION,
      id,
      owner,
      description,
      dependencies: Object.freeze(dependencies),
      run: candidate.run
    }))
  }

  for (const descriptor of byId.values()) {
    for (const dependency of descriptor.dependencies) {
      if (!byId.has(dependency)) throw new Error(`local probe ${descriptor.id} has missing dependency ${dependency}`)
    }
  }

  const indegree = new Map([...byId.keys()].map(id => [id, 0]))
  const dependants = new Map([...byId.keys()].map(id => [id, []]))
  for (const descriptor of byId.values()) {
    for (const dependency of descriptor.dependencies) {
      indegree.set(descriptor.id, indegree.get(descriptor.id) + 1)
      dependants.get(dependency).push(descriptor.id)
    }
  }
  const ready = [...byId.keys()].filter(id => indegree.get(id) === 0).sort()
  const ordered = []
  while (ready.length) {
    const id = ready.shift()
    ordered.push(byId.get(id))
    for (const dependant of dependants.get(id).sort()) {
      indegree.set(dependant, indegree.get(dependant) - 1)
      if (indegree.get(dependant) === 0) {
        ready.push(dependant)
        ready.sort()
      }
    }
  }
  if (ordered.length !== byId.size) throw new Error('local probe dependency cycle detected')
  return Object.freeze(ordered)
}

function resultRow(id, status, startedAt, completedAt, evidence, errorCode, nextStep) {
  return {
    schemaVersion: LOCAL_PROBE_RESULT_SCHEMA_VERSION,
    id,
    status,
    startedAt,
    completedAt,
    evidence: evidence && typeof evidence === 'object' ? evidence : {},
    errorCode: errorCode || null,
    nextStep: nextStep || null
  }
}

/** Execute only registered synchronous read-only probes in deterministic dependency order. */
function runLocalProbes(registry, options = {}) {
  const ordered = Array.isArray(registry) ? registry : []
  const byId = new Map(ordered.map(descriptor => [descriptor.id, descriptor]))
  const requested = normalizeIds(options.ids)
  const selected = requested.length ? requested : ordered.map(descriptor => descriptor.id)
  const unknown = selected.filter(id => !byId.has(id))
  if (unknown.length) {
    throw new LocalProbeContractError(
      'PROBE_UNKNOWN',
      `Unknown local probe: ${unknown.join(', ')}`,
      `Choose one of: ${[...byId.keys()].sort().join(', ') || '(none)'}`
    )
  }

  const required = new Set()
  function include(id) {
    if (required.has(id)) return
    required.add(id)
    for (const dependency of byId.get(id).dependencies) include(dependency)
  }
  selected.forEach(include)

  const results = []
  const byResult = new Map()
  const clock = typeof options.clock === 'function' ? options.clock : Date.now
  for (const descriptor of ordered.filter(item => required.has(item.id))) {
    const startedAt = toIso(clock)
    const failedDependencies = descriptor.dependencies.filter(id => byResult.get(id)?.status !== 'pass')
    if (failedDependencies.length) {
      const skipped = resultRow(
        descriptor.id,
        'skipped',
        startedAt,
        toIso(clock),
        { failedDependencies },
        'PROBE_DEPENDENCY_FAILED',
        'Resolve the failed dependencies, then rerun this probe.'
      )
      results.push(skipped)
      byResult.set(descriptor.id, skipped)
      continue
    }

    let result
    try {
      const outcome = descriptor.run(Object.freeze({ ...(options.context || {}) }))
      const normalized = outcome && typeof outcome === 'object' ? outcome : { evidence: outcome }
      if (normalized.status && !['pass', 'fail'].includes(normalized.status)) {
        throw new Error(`unsupported probe status: ${normalized.status}`)
      }
      const status = normalized.status || 'pass'
      result = resultRow(
        descriptor.id,
        status,
        startedAt,
        toIso(clock),
        normalized.evidence,
        status === 'fail' ? 'PROBE_EXECUTION_FAILED' : null,
        status === 'fail' ? (normalized.nextStep || 'Inspect the probe evidence and correct the local state.') : null
      )
    } catch (error) {
      result = resultRow(
        descriptor.id,
        'fail',
        startedAt,
        toIso(clock),
        { message: String(error && error.message ? error.message : error) },
        'PROBE_EXECUTION_FAILED',
        'Inspect the local probe implementation or its required local files, then retry.'
      )
    }
    results.push(result)
    byResult.set(descriptor.id, result)
  }

  return {
    schemaVersion: LOCAL_PROBE_RUN_SCHEMA_VERSION,
    localOnly: true,
    requested: selected,
    executed: results.map(result => result.id),
    results
  }
}

module.exports = {
  LOCAL_PROBE_DESCRIPTOR_SCHEMA_VERSION,
  LOCAL_PROBE_RESULT_SCHEMA_VERSION,
  LOCAL_PROBE_RUN_SCHEMA_VERSION,
  LocalProbeContractError,
  createLocalProbeRegistry,
  runLocalProbes
}
