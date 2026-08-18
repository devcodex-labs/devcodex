#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { buildPublicProductProjection } = require('./lib/public-product-expression')

const ROOT = path.resolve(__dirname, '..')
const DATA_DIR = path.join(ROOT, 'public-site', 'data')
const DATA_FILE = path.join(DATA_DIR, 'public-product-projection.json')
const README_FILE = path.join(ROOT, 'README.md')
const HOME_FILE = path.join(ROOT, 'public-site', 'docs', 'index.md')
const MARKER_TYPES = ['workflows', 'skills', 'hosts', 'auto']
const README_SKILL_RE = /当前机器事实为 \*\*\d+ 个 Skill（\d+ active \+ \d+ gray）\*\*/

function replaceMarkers (text, markers, label) {
  let out = text
  for (const type of MARKER_TYPES) {
    const next = markers[type]
    if (!next) throw new Error(`missing projection marker: ${type}`)
    const re = new RegExp(`<!-- devcodex-public:${type}\\b[\\s\\S]*?-->`)
    if (!re.test(out)) throw new Error(`${label} missing <!-- devcodex-public:${type} -->`)
    out = out.replace(re, next)
  }
  return out
}

function replaceReadmeSkillSentence (text, skills) {
  const next = `当前机器事实为 **${skills.total} 个 Skill（${skills.active} active + ${skills.gray} gray）**`
  if (!README_SKILL_RE.test(text)) {
    throw new Error('README missing V2 skill-count sentence')
  }
  return text.replace(README_SKILL_RE, next)
}

function writeProjection (projection) {
  const payload = {
    schemaVersion: projection.schemaVersion,
    generatedAt: new Date().toISOString(),
    workflows: projection.workflows,
    skills: projection.skills,
    hosts: projection.hosts.map((host) => ({
      hostId: host.hostId,
      label: host.label,
      recommendedEntry: host.recommendedEntry,
      publicStatus: host.publicStatus,
      variantCount: host.variants.length
    })),
    markers: projection.markers,
    sourceIdentities: projection.sourceIdentities
  }
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(DATA_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return payload
}

function main () {
  const projection = buildPublicProductProjection({ root: ROOT })
  writeProjection(projection)

  const readme = replaceReadmeSkillSentence(
    replaceMarkers(fs.readFileSync(README_FILE, 'utf8'), projection.markers, 'README.md'),
    projection.skills
  )
  fs.writeFileSync(README_FILE, readme, 'utf8')

  const home = replaceMarkers(
    fs.readFileSync(HOME_FILE, 'utf8'),
    projection.markers,
    'public-site/docs/index.md'
  )
  fs.writeFileSync(HOME_FILE, home, 'utf8')

  console.log(
    `public-site data written: skills=${projection.skills.total}/${projection.skills.active}/${projection.skills.gray}`
  )
}

if (require.main === module) main()

module.exports = { replaceMarkers, replaceReadmeSkillSentence, writeProjection }
