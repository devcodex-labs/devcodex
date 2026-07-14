'use strict'

function probeNumber(id) {
  const match = /^V([1-9]\d*)$/.exec(id)
  return match ? Number(match[1]) : null
}

function compareProbes(left, right) {
  return probeNumber(left.id) - probeNumber(right.id)
}

/**
 * Build a deterministic registry from explicitly declared probe groups.
 * Dependencies describe real probe prerequisites; numeric order remains the stable tie-break.
 */
function createProbeRegistry(groups, { expectedIds = null } = {}) {
  if (!Array.isArray(groups)) throw new TypeError('probe groups must be an array')

  const descriptors = []
  const byId = new Map()

  for (const group of groups) {
    if (!group || typeof group !== 'object') throw new TypeError('probe group must be an object')
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(group.owner || '')) {
      throw new Error(`invalid probe owner: ${group.owner || '(missing)'}`)
    }
    if (!Array.isArray(group.checks)) throw new TypeError(`probe group ${group.owner} checks must be an array`)

    const dependencyMap = group.dependencies || {}
    for (const run of group.checks) {
      if (typeof run !== 'function') throw new TypeError(`probe group ${group.owner} contains a non-function check`)
      const nameMatch = /^check(V[1-9]\d*)$/.exec(run.name)
      if (!nameMatch) throw new Error(`invalid probe function name: ${run.name || '(anonymous)'}`)

      const id = nameMatch[1]
      if (byId.has(id)) throw new Error(`duplicate probe id: ${id}`)
      const dependencies = dependencyMap[id] || []
      if (!Array.isArray(dependencies) || dependencies.some(item => probeNumber(item) === null)) {
        throw new Error(`invalid dependencies for ${id}`)
      }
      if (dependencies.includes(id)) throw new Error(`probe ${id} cannot depend on itself`)

      const descriptor = Object.freeze({ id, owner: group.owner, dependencies: [...dependencies], run })
      descriptors.push(descriptor)
      byId.set(id, descriptor)
    }
  }

  for (const descriptor of descriptors) {
    for (const dependency of descriptor.dependencies) {
      if (!byId.has(dependency)) throw new Error(`probe ${descriptor.id} has missing dependency ${dependency}`)
    }
  }

  if (expectedIds) {
    const actual = [...byId.keys()].sort((a, b) => probeNumber(a) - probeNumber(b))
    if (actual.length !== expectedIds.length || actual.some((id, index) => id !== expectedIds[index])) {
      throw new Error(`probe registry ids do not match expected sequence: ${actual.join(', ')}`)
    }
  }

  const indegree = new Map(descriptors.map(item => [item.id, 0]))
  const dependants = new Map(descriptors.map(item => [item.id, []]))
  for (const descriptor of descriptors) {
    for (const dependency of descriptor.dependencies) {
      indegree.set(descriptor.id, indegree.get(descriptor.id) + 1)
      dependants.get(dependency).push(descriptor.id)
    }
  }

  const ready = descriptors.filter(item => indegree.get(item.id) === 0).sort(compareProbes)
  const ordered = []
  while (ready.length) {
    const current = ready.shift()
    ordered.push(current)
    for (const dependantId of dependants.get(current.id)) {
      indegree.set(dependantId, indegree.get(dependantId) - 1)
      if (indegree.get(dependantId) === 0) {
        ready.push(byId.get(dependantId))
        ready.sort(compareProbes)
      }
    }
  }

  if (ordered.length !== descriptors.length) throw new Error('probe dependency cycle detected')
  return Object.freeze(ordered)
}

function runProbeRegistry(registry, { afterRun = null } = {}) {
  if (afterRun !== null && typeof afterRun !== 'function') {
    throw new TypeError('afterRun must be a function')
  }
  for (const descriptor of registry) {
    descriptor.run()
    if (afterRun) afterRun(descriptor)
  }
}

module.exports = { createProbeRegistry, runProbeRegistry }
