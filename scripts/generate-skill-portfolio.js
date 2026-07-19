#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const {
  buildPortfolio,
  gitIndexSnapshot,
  loadGitIndexRepositorySnapshot,
  serializePortfolio,
  validateStagedCandidateSnapshot,
  validatePortfolio
} = require('./lib/skill-portfolio-utils')

const ROOT = path.resolve(__dirname, '..')
const OUTPUT = path.join(ROOT, 'skills', 'portfolio.json')
const stagedCheck = process.argv.includes('--check-staged')
const check = process.argv.includes('--check') || stagedCheck
const repositoryView = stagedCheck ? 'index' : 'worktree'
let repositorySnapshot = null
try {
  repositorySnapshot = stagedCheck ? loadGitIndexRepositorySnapshot(ROOT) : null
} catch (error) {
  console.error(`Staged Skill portfolio check cannot start: ${error.message}`)
  process.exit(1)
}
const candidate = stagedCheck ? gitIndexSnapshot(ROOT, repositorySnapshot) : null
const candidateErrors = stagedCheck ? validateStagedCandidateSnapshot(candidate) : []
if (candidateErrors.length) {
  console.error(`Staged Skill portfolio check cannot start: ${candidateErrors.join('; ')}`)
  process.exit(1)
}
const portfolio = buildPortfolio(ROOT, { repositoryView, repositorySnapshot })
const errors = validatePortfolio(portfolio)
if (errors.length) {
  console.error(errors.map(error => `- ${error}`).join('\n'))
  process.exit(1)
}
const desired = serializePortfolio(portfolio)

if (check) {
  let current = ''
  try {
    current = stagedCheck
      ? repositorySnapshot.readText('skills/portfolio.json')
      : (fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : '')
  } catch {}
  if (current !== desired) {
    if (stagedCheck) {
      console.error('Staged Skill portfolio is stale for the current Git index candidate.')
      console.error('Recovery: stage intended inputs, regenerate, stage skills/portfolio.json, then rerun --check-staged.')
    } else {
      console.error('Skill portfolio is stale. Run: node scripts/generate-skill-portfolio.js')
      console.error('V92 parity: consumers/skills are git-tracked only (untracked files ignored).')
    }
    process.exit(1)
  }
  if (stagedCheck) {
    console.log(`✓ Staged Skill portfolio is current (${portfolio.summary.skillCount} skills; stagedPaths=${candidate.stagedPathCount}; index=${candidate.indexTreeIdentity.slice(0, 12)}; consumers=${portfolio.generatedFrom.consumerInventoryFileCount})`)
  } else {
    console.log(`✓ Skill portfolio is deterministic and current (${portfolio.summary.skillCount} skills)`)
  }
} else {
  fs.writeFileSync(OUTPUT, desired)
  console.log(`✓ Wrote ${path.relative(ROOT, OUTPUT)} (${portfolio.summary.skillCount} skills)`)
  console.log('  source=git-tracked-files-only (CI clean-checkout parity)')
}
