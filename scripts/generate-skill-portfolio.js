#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const {
  buildPortfolio,
  serializePortfolio,
  validatePortfolio
} = require('./lib/skill-portfolio-utils')

const ROOT = path.resolve(__dirname, '..')
const OUTPUT = path.join(ROOT, 'skills', 'portfolio.json')
const check = process.argv.includes('--check')
const portfolio = buildPortfolio(ROOT)
const errors = validatePortfolio(portfolio)
if (errors.length) {
  console.error(errors.map(error => `- ${error}`).join('\n'))
  process.exit(1)
}
const desired = serializePortfolio(portfolio)

if (check) {
  const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : ''
  if (current !== desired) {
    console.error('Skill portfolio is stale. Run: node scripts/generate-skill-portfolio.js')
    process.exit(1)
  }
  console.log(`✓ Skill portfolio is deterministic and current (${portfolio.summary.skillCount} skills)`)
} else {
  fs.writeFileSync(OUTPUT, desired)
  console.log(`✓ Wrote ${path.relative(ROOT, OUTPUT)} (${portfolio.summary.skillCount} skills)`)
}
