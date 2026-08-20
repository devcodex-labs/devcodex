'use strict'

const PUBLIC_SKILL_CATEGORY_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'workflow-routing', label: 'Workflow & Routing' }),
  Object.freeze({ id: 'domain-architecture', label: 'Domain & Architecture' }),
  Object.freeze({ id: 'quality-delivery', label: 'Quality & Delivery' }),
  Object.freeze({ id: 'runtime-governance', label: 'Runtime & Governance' })
])

function registryRows (registeredSkills) {
  return Array.isArray(registeredSkills)
    ? registeredSkills.map(item => typeof item === 'string'
        ? { id: item, lifecycleState: 'active' }
        : { id: item?.id, lifecycleState: item?.lifecycleState || 'active' })
    : []
}

function validatePublicSkillTaxonomy (taxonomy, registeredSkills) {
  const errors = []
  const rows = registryRows(registeredSkills)
  const registryIds = rows.map(item => item.id)
  const registrySet = new Set()
  for (const id of registryIds) {
    if (typeof id !== 'string' || !id.trim()) {
      errors.push('taxonomy-registry-id-invalid')
      continue
    }
    if (registrySet.has(id)) errors.push(`taxonomy-registry-id-duplicate:${id}`)
    registrySet.add(id)
  }

  if (taxonomy?.schemaVersion !== 'PublicSkillTaxonomyV1') {
    errors.push('taxonomy-schema-version')
  }
  if (taxonomy?.registrySource !== 'plugin.json#skills') {
    errors.push('taxonomy-registry-source')
  }
  if (taxonomy?.assignmentKey !== 'publicCategory') {
    errors.push('taxonomy-assignment-key')
  }

  const extension = taxonomy?.extensionPolicy || {}
  if (extension.extensionSource !== 'workspace') errors.push('taxonomy-workspace-extension-source')
  if (extension.assignmentScope !== 'bundled-registered-only') errors.push('taxonomy-assignment-scope')
  if (extension.includedInAssignments !== false) errors.push('taxonomy-workspace-assignment-exclusion')
  if (extension.includedInBundledCounts !== false) errors.push('taxonomy-workspace-count-exclusion')
  if (typeof extension.description !== 'string' || !extension.description.trim()) {
    errors.push('taxonomy-workspace-description')
  }

  const categories = Array.isArray(taxonomy?.categories) ? taxonomy.categories : []
  const expectedIds = PUBLIC_SKILL_CATEGORY_DEFINITIONS.map(item => item.id)
  const actualIds = categories.map(item => item?.id)
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    errors.push('taxonomy-category-order-or-coverage')
  }
  const categoryById = new Map()
  for (const category of categories) {
    const id = category?.id
    if (categoryById.has(id)) errors.push(`taxonomy-category-duplicate:${id}`)
    categoryById.set(id, category)
    const expected = PUBLIC_SKILL_CATEGORY_DEFINITIONS.find(item => item.id === id)
    if (!expected) {
      errors.push(`taxonomy-category-unknown:${id}`)
      continue
    }
    if (category.label !== expected.label) errors.push(`taxonomy-category-label:${id}`)
    if (typeof category.description !== 'string' || !category.description.trim()) {
      errors.push(`taxonomy-category-description:${id}`)
    }
    if (!Array.isArray(category.representativeSkillIds)) {
      errors.push(`taxonomy-category-representatives:${id}`)
    } else if (new Set(category.representativeSkillIds).size !== category.representativeSkillIds.length) {
      errors.push(`taxonomy-category-representative-duplicate:${id}`)
    }
  }

  const assignments = Array.isArray(taxonomy?.assignments) ? taxonomy.assignments : []
  const assignmentBySkillId = new Map()
  const assignmentIds = []
  const categoryCounts = Object.fromEntries(expectedIds.map(id => [id, 0]))
  for (const assignment of assignments) {
    const skillId = assignment?.skillId
    const publicCategory = assignment?.publicCategory
    assignmentIds.push(skillId)
    if (typeof skillId !== 'string' || !skillId.trim()) {
      errors.push('taxonomy-assignment-skill-id-invalid')
      continue
    }
    if (assignmentBySkillId.has(skillId)) {
      errors.push(`taxonomy-assignment-duplicate:${skillId}`)
      continue
    }
    assignmentBySkillId.set(skillId, publicCategory)
    if (!registrySet.has(skillId)) errors.push(`taxonomy-assignment-unknown:${skillId}`)
    if (!expectedIds.includes(publicCategory)) {
      errors.push(`taxonomy-assignment-category-unknown:${skillId}:${publicCategory}`)
    } else {
      categoryCounts[publicCategory] += 1
    }
  }
  const sortedAssignmentIds = [...assignmentIds].sort((left, right) => String(left).localeCompare(String(right)))
  if (JSON.stringify(assignmentIds) !== JSON.stringify(sortedAssignmentIds)) {
    errors.push('taxonomy-assignment-order')
  }
  for (const id of [...registrySet].sort()) {
    if (!assignmentBySkillId.has(id)) errors.push(`taxonomy-assignment-missing:${id}`)
  }
  if (assignments.length !== registrySet.size) {
    errors.push(`taxonomy-assignment-count:${assignments.length}:${registrySet.size}`)
  }

  const lifecycleById = new Map(rows.map(item => [item.id, item.lifecycleState]))
  for (const categoryId of expectedIds) {
    const category = categoryById.get(categoryId)
    const representatives = Array.isArray(category?.representativeSkillIds)
      ? category.representativeSkillIds
      : []
    if (categoryCounts[categoryId] > 0 && representatives.length === 0) {
      errors.push(`taxonomy-category-representative-missing:${categoryId}`)
    }
    for (const skillId of representatives) {
      if (!registrySet.has(skillId)) {
        errors.push(`taxonomy-representative-unknown:${categoryId}:${skillId}`)
      } else if (assignmentBySkillId.get(skillId) !== categoryId) {
        errors.push(`taxonomy-representative-category-mismatch:${categoryId}:${skillId}`)
      }
      if (lifecycleById.get(skillId) !== 'active') {
        errors.push(`taxonomy-representative-not-active:${categoryId}:${skillId}`)
      }
    }
  }

  return errors
}

function indexPublicSkillTaxonomy (taxonomy, registeredSkills) {
  const errors = validatePublicSkillTaxonomy(taxonomy, registeredSkills)
  if (errors.length) {
    const error = new Error(`Invalid PublicSkillTaxonomyV1: ${errors.join(', ')}`)
    error.code = 'PUBLIC_SKILL_TAXONOMY_INVALID'
    error.issues = errors
    throw error
  }
  return {
    assignmentBySkillId: new Map(taxonomy.assignments.map(item => [item.skillId, item.publicCategory])),
    projection: {
      schemaVersion: taxonomy.schemaVersion,
      registrySource: taxonomy.registrySource,
      assignmentKey: taxonomy.assignmentKey,
      extensionPolicy: { ...taxonomy.extensionPolicy },
      categories: taxonomy.categories.map(category => ({
        id: category.id,
        label: category.label,
        description: category.description,
        representativeSkillIds: [...category.representativeSkillIds]
      }))
    }
  }
}

function publicCategoryCounts (skills, categories = PUBLIC_SKILL_CATEGORY_DEFINITIONS) {
  const counts = Object.fromEntries(categories.map(category => [category.id, 0]))
  for (const skill of skills || []) {
    if (Object.prototype.hasOwnProperty.call(counts, skill.publicCategory)) {
      counts[skill.publicCategory] += 1
    }
  }
  return counts
}

module.exports = {
  PUBLIC_SKILL_CATEGORY_DEFINITIONS,
  indexPublicSkillTaxonomy,
  publicCategoryCounts,
  validatePublicSkillTaxonomy
}
