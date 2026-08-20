#!/usr/bin/env node
'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
  buildPortfolio,
  canonicalizeTextForDigest,
  validatePortfolio
} = require('./lib/skill-portfolio-utils')
const {
  PUBLIC_SKILL_CATEGORY_DEFINITIONS,
  indexPublicSkillTaxonomy,
  publicCategoryCounts,
  validatePublicSkillTaxonomy
} = require('./lib/public-skill-taxonomy')
const {
  buildPublicProductProjection,
  validatePublicSkillCatalog
} = require('./lib/public-product-expression')

const ROOT = path.resolve(__dirname, '..')
const taxonomyPath = path.join(ROOT, 'content', 'skills', 'public-taxonomy.json')
const taxonomyRaw = fs.readFileSync(taxonomyPath, 'utf8')
const taxonomy = JSON.parse(taxonomyRaw)
const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin.json'), 'utf8'))
const portfolio = buildPortfolio(ROOT)
const publicProjection = buildPublicProductProjection({ root: ROOT })

assert.deepStrictEqual(validatePublicSkillTaxonomy(taxonomy, plugin.skills), [])
assert.deepStrictEqual(validatePortfolio(portfolio), [])
assert.strictEqual(plugin.skills.length, 86)
assert.strictEqual(taxonomy.assignments.length, 86)
assert.strictEqual(new Set(taxonomy.assignments.map(item => item.skillId)).size, 86)
assert.deepStrictEqual(
  taxonomy.categories.map(category => ({ id: category.id, label: category.label })),
  PUBLIC_SKILL_CATEGORY_DEFINITIONS
)
assert.deepStrictEqual(publicCategoryCounts(portfolio.skills, taxonomy.categories), {
  'workflow-routing': 20,
  'domain-architecture': 21,
  'quality-delivery': 28,
  'runtime-governance': 17
})
assert.deepStrictEqual(portfolio.summary.publicCategoryCounts, {
  'workflow-routing': 20,
  'domain-architecture': 21,
  'quality-delivery': 28,
  'runtime-governance': 17
})
assert(portfolio.skills.every(skill => taxonomy.categories.some(category => category.id === skill.publicCategory)))
assert.strictEqual(portfolio.publicTaxonomy.extensionPolicy.extensionSource, 'workspace')
assert.strictEqual(portfolio.publicTaxonomy.extensionPolicy.includedInAssignments, false)
assert.strictEqual(portfolio.publicTaxonomy.extensionPolicy.includedInBundledCounts, false)
assert(!taxonomy.assignments.some(item => Object.hasOwn(item, 'extensionSource')))

const portfolioById = new Map(portfolio.skills.map(skill => [skill.id, skill]))
for (const category of taxonomy.categories) {
  assert(category.representativeSkillIds.length > 0, `${category.id} needs representative Skills`)
  for (const skillId of category.representativeSkillIds) {
    const skill = portfolioById.get(skillId)
    assert(skill, `missing representative ${skillId}`)
    assert.strictEqual(skill.publicCategory, category.id)
    assert.strictEqual(skill.lifecycleState, 'active')
  }
}

const expectedTaxonomyDigest = crypto
  .createHash('sha256')
  .update(canonicalizeTextForDigest(taxonomyRaw))
  .digest('hex')
assert.strictEqual(portfolio.generatedFrom.publicTaxonomyDigest, expectedTaxonomyDigest)
assert.match(portfolio.generatedFrom.portfolioInputDigest, /^[a-f0-9]{64}$/)
assert.doesNotThrow(() => indexPublicSkillTaxonomy(taxonomy, plugin.skills))
assert.deepStrictEqual(validatePublicSkillCatalog(portfolio, taxonomy, expectedTaxonomyDigest), [])
assert.strictEqual(publicProjection.skills.catalog.length, 86)
assert.deepStrictEqual(publicProjection.skills.categoryCounts, portfolio.summary.publicCategoryCounts)
assert.deepStrictEqual(publicProjection.skills.categories.map(category => category.count), [20, 21, 28, 17])
assert(publicProjection.skills.categories.every(category =>
  category.representativeSkills.length > 0 &&
  category.representativeSkills.every(skill => skill.lifecycleState === 'active')
))
assert.strictEqual(publicProjection.skills.extensionPolicy.extensionSource, 'workspace')
assert.strictEqual(publicProjection.skills.extensionPolicy.includedInBundledCounts, false)
assert.strictEqual(publicProjection.sourceIdentities.taxonomy, expectedTaxonomyDigest)
assert(publicProjection.markers.skills.includes('categories=workflow-routing:20,domain-architecture:21,quality-delivery:28,runtime-governance:17'))

function issuesFor (mutate) {
  const candidate = JSON.parse(JSON.stringify(taxonomy))
  mutate(candidate)
  return validatePublicSkillTaxonomy(candidate, plugin.skills)
}

assert(issuesFor(candidate => {
  candidate.assignments.push({ ...candidate.assignments[0] })
}).some(issue => issue.startsWith('taxonomy-assignment-duplicate:')))

assert(issuesFor(candidate => {
  candidate.assignments.shift()
}).some(issue => issue.startsWith('taxonomy-assignment-missing:')))

assert(issuesFor(candidate => {
  candidate.assignments.push({ skillId: 'workspace-only-demo', publicCategory: 'workflow-routing' })
}).includes('taxonomy-assignment-unknown:workspace-only-demo'))

assert(issuesFor(candidate => {
  candidate.assignments[0].publicCategory = 'workspace'
}).some(issue => issue.includes('taxonomy-assignment-category-unknown:')))

assert(issuesFor(candidate => {
  candidate.extensionPolicy.includedInBundledCounts = true
}).includes('taxonomy-workspace-count-exclusion'))

assert(issuesFor(candidate => {
  candidate.categories[0].representativeSkillIds = ['brand-visual-quality']
}).some(issue => issue.includes('taxonomy-representative-not-active:')))

assert(issuesFor(candidate => {
  candidate.assignments.reverse()
}).includes('taxonomy-assignment-order'))

console.log('✓ PublicSkillTaxonomyV1 exact coverage, projection, freshness and negative fixtures passed')
