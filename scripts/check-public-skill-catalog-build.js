#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const siteRoot = path.join(ROOT, 'public-site')
if (!fs.existsSync(path.join(siteRoot, 'package.json'))) {
  console.log('public Skill catalog build check skipped: public-site source not present')
  process.exit(0)
}

const candidates = [
  path.join(siteRoot, 'doc_build', 'reference', 'skills.html'),
  path.join(siteRoot, 'doc_build', 'reference', 'skills', 'index.html')
]
const htmlPath = candidates.find(file => fs.existsSync(file))
if (!htmlPath) {
  console.error('public Skill catalog build missing: run npm --prefix public-site run build')
  process.exit(1)
}

const projection = JSON.parse(fs.readFileSync(
  path.join(siteRoot, 'data', 'public-product-projection.json'),
  'utf8'
))
const html = fs.readFileSync(htmlPath, 'utf8')
const failures = []
const catalog = projection?.skills?.catalog || []
const categories = projection?.skills?.categories || []

if (catalog.length !== projection?.skills?.total) {
  failures.push(`projection catalog count ${catalog.length} != total ${projection?.skills?.total}`)
}
for (const skill of catalog) {
  if (!html.includes(`data-skill-id="${skill.id}"`)) failures.push(`SSR catalog missing ${skill.id}`)
}
for (const category of categories) {
  if (!html.includes(`?category=${category.id}`)) failures.push(`SSR category link missing ${category.id}`)
}
for (const needle of ['type="search"', 'aria-live="polite"', 'value="active"', 'value="gray"']) {
  if (!html.includes(needle)) failures.push(`SSR filter control missing ${needle}`)
}
if (!html.includes('Workspace Skill 不计入上述分母')) {
  failures.push('SSR Workspace Skill denominator boundary missing')
}

if (failures.length) {
  console.error(`public Skill catalog build check failed (${failures.length})`)
  failures.slice(0, 20).forEach(failure => console.error(`- ${failure}`))
  process.exit(1)
}

console.log(`public Skill catalog build check passed: catalog=${catalog.length} categories=${categories.length} noJsFallback=complete`)
