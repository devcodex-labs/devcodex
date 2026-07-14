#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { runSpecGovernanceBaseSuite } = require('./lib/test-spec-governance-base')
const { runSpecGovernanceReviewSuite } = require('./lib/test-spec-governance-review')
const { runSpecGovernanceExpertSuite } = require('./lib/test-spec-governance-expert')
const { runSpecGovernanceScaleSuite } = require('./lib/test-spec-governance-scale')
const { runReworkTrustControlSuite } = require('./lib/test-rework-trust-controls')

const ROOT = path.resolve(__dirname, '..')
const failures = []
const SOURCE_PROJECT_NAME = ['devcodex', 'v1'].join('-')

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8')
}

function mustInclude(file, needle) {
  if (!read(file).includes(needle)) failures.push(`${file} missing "${needle}"`)
}

function mustNotInclude(file, needle, reason) {
  if (read(file).includes(needle)) failures.push(`${file} must not include "${needle}" (${reason})`)
}

function collectChangelogContents() {
  const contents = [read('changelogs/unreleased.md')]
  const releasesDir = path.join(ROOT, 'changelogs', 'releases')
  if (fs.existsSync(releasesDir)) {
    for (const name of fs.readdirSync(releasesDir).filter(item => item.endsWith('.md'))) {
      contents.push(read(`changelogs/releases/${name}`))
    }
  }
  return contents
}

function mustIncludeInChangelogs(needle) {
  if (!collectChangelogContents().some(content => content.includes(needle))) {
    failures.push(`changelogs/unreleased.md or changelogs/releases/*.md missing "${needle}"`)
  }
}

const suiteContext = {
  ROOT,
  fs,
  path,
  failures,
  SOURCE_PROJECT_NAME,
  read,
  mustInclude,
  mustNotInclude,
  collectChangelogContents,
  mustIncludeInChangelogs
}

runSpecGovernanceBaseSuite(suiteContext)
runSpecGovernanceReviewSuite(suiteContext)
runSpecGovernanceExpertSuite(suiteContext)
runSpecGovernanceScaleSuite(suiteContext)
runReworkTrustControlSuite(suiteContext)

if (failures.length) {
  console.error('Spec governance checks failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Spec governance checks passed')
