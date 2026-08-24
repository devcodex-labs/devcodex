#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { runSpecGovernanceBaseSuite } = require('./lib/test-spec-governance-base')
const { runSpecGovernanceReviewSuite } = require('./lib/test-spec-governance-review')
const { runSpecGovernanceExpertSuite } = require('./lib/test-spec-governance-expert')
const { runSpecGovernanceScaleSuite } = require('./lib/test-spec-governance-scale')
const { runReworkTrustControlSuite } = require('./lib/test-rework-trust-controls')
const {
  createCanonicalAwareReader,
  hasValidCanonicalContract
} = require('./lib/canonical-consumer-contracts')
const { isNarrativeMarkdownPath } = require('./lib/narrative-markdown-policy')

const ROOT = path.resolve(__dirname, '..')
const failures = []
const SOURCE_PROJECT_NAME = ['devcodex', 'v1'].join('-')

const readAbsolute = createCanonicalAwareReader(ROOT, file => fs.readFileSync(file, 'utf8'))
const read = file => isNarrativeMarkdownPath(file) ? '' : readAbsolute(path.join(ROOT, file))

const skillCount = JSON.parse(read('plugin.json')).skills.length

function mustInclude(file, needle) {
  if (isNarrativeMarkdownPath(file)) return
  const content = read(file)
  if (!content.includes(needle) && !hasValidCanonicalContract(ROOT, file, content, needle)) failures.push(`${file} missing "${needle}"`)
}

function mustNotInclude(file, needle, reason) {
  if (isNarrativeMarkdownPath(file)) return
  if (String(read(file)).includes(needle)) failures.push(`${file} must not include "${needle}" (${reason})`)
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
  skillCount,
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
