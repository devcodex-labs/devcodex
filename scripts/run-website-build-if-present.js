#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { CheckedCommandError, runChecked } = require('./lib/checked-command')

const ROOT = path.resolve(__dirname, '..')
const WEBSITE_COMMAND_TIMEOUT_MS = 600000
const LOCAL_DEPENDENCY_PROTOCOLS = ['file:', 'link:']

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function externalLocalDependency(siteRoot, name, spec) {
  const protocol = LOCAL_DEPENDENCY_PROTOCOLS.find(prefix => String(spec).startsWith(prefix))
  if (!protocol) return null
  const target = path.resolve(siteRoot, String(spec).slice(protocol.length))
  return isWithin(siteRoot, target) ? null : { name, spec, target }
}

function assertSiteInstallIsolation(root, site) {
  const siteRoot = path.resolve(root, site.id)
  const manifestPath = path.join(siteRoot, 'package.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, spec] of Object.entries(manifest[section] || {})) {
      const external = externalLocalDependency(siteRoot, name, spec)
      if (external) {
        const error = new Error(`WEBSITE_EXTERNAL_LOCAL_LINK_FORBIDDEN: ${site.id}:${section}:${name} -> ${external.target}`)
        error.code = 'WEBSITE_EXTERNAL_LOCAL_LINK_FORBIDDEN'
        throw error
      }
    }
  }

  const lockPath = path.join(siteRoot, 'package-lock.json')
  if (!fs.existsSync(lockPath)) return
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
  for (const [entry, metadata] of Object.entries(lock.packages || {})) {
    if (metadata?.link !== true || !metadata.resolved) continue
    const target = path.resolve(siteRoot, metadata.resolved)
    if (!isWithin(siteRoot, target)) {
      const error = new Error(`WEBSITE_EXTERNAL_LOCK_LINK_FORBIDDEN: ${site.id}:${entry} -> ${target}`)
      error.code = 'WEBSITE_EXTERNAL_LOCK_LINK_FORBIDDEN'
      throw error
    }
  }
}

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
        assertSiteInstallIsolation(root, site)
        const install = runChecked('npm', ['--prefix', site.id, 'ci', '--ignore-scripts'], {
          cwd: root,
          timeoutMs: WEBSITE_COMMAND_TIMEOUT_MS,
          summaryLimit: 12000
        })
        if (install.stdout) process.stdout.write(install.stdout)
        if (install.stderr) process.stderr.write(install.stderr)
      }
      const evidence = runChecked('npm', ['--prefix', site.id, 'run', 'build'], {
        cwd: root,
        timeoutMs: WEBSITE_COMMAND_TIMEOUT_MS,
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

module.exports = { WEBSITE_COMMAND_TIMEOUT_MS, assertSiteInstallIsolation, main }
