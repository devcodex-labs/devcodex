#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { CheckedCommandError, runChecked } = require('./lib/checked-command')

const ROOT = path.resolve(__dirname, '..')

function main(options = {}) {
  const root = options.root ? path.resolve(options.root) : ROOT
  const websitePackage = path.join(root, 'website', 'package.json')
  if (!fs.existsSync(websitePackage)) {
    console.log('Website build skipped: website/package.json not present')
    return 0
  }

  try {
    const evidence = runChecked('npm', ['--prefix', 'website', 'run', 'build'], {
      cwd: root,
      timeoutMs: 240000,
      summaryLimit: 12000
    })
    if (evidence.stdout) process.stdout.write(evidence.stdout)
    if (evidence.stderr) process.stderr.write(evidence.stderr)
    return 0
  } catch (error) {
    if (error instanceof CheckedCommandError) {
      if (error.evidence.stdout) process.stdout.write(error.evidence.stdout)
      if (error.evidence.stderr) process.stderr.write(error.evidence.stderr)
      console.error(error.message)
      return error.evidence.exitCode || 1
    }
    console.error(error.message)
    return 1
  }
}

if (require.main === module) process.exitCode = main()

module.exports = { main }
