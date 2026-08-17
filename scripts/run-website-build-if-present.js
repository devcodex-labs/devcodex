#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { CheckedCommandError, runChecked } = require('./lib/checked-command')

const ROOT = path.resolve(__dirname, '..')

function main(options = {}) {
  const root = options.root ? path.resolve(options.root) : ROOT
  const sites = [
    { id: 'public-site', install: true },
    { id: 'website', install: false }
  ].filter(site => fs.existsSync(path.join(root, site.id, 'package.json')))
  if (!sites.length) {
    console.log('Website build skipped: no public-site or maintainer website package present')
    return 0
  }

  try {
    for (const site of sites) {
      if (site.install) {
        const install = runChecked('npm', ['--prefix', site.id, 'ci', '--ignore-scripts'], {
          cwd: root,
          timeoutMs: 240000,
          summaryLimit: 12000
        })
        if (install.stdout) process.stdout.write(install.stdout)
        if (install.stderr) process.stderr.write(install.stderr)
      }
      const evidence = runChecked('npm', ['--prefix', site.id, 'run', 'build'], {
        cwd: root,
        timeoutMs: 240000,
        summaryLimit: 12000
      })
      if (evidence.stdout) process.stdout.write(evidence.stdout)
      if (evidence.stderr) process.stderr.write(evidence.stderr)
      console.log(`Website build passed: ${site.id}`)
    }
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
