#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { scanGeneratedSite } = require('./check-generated-site-links')

const ROOT = path.resolve(__dirname, '..')

function main(options = {}) {
  const root = options.root ? path.resolve(options.root) : ROOT
  const sites = [
    { id: 'public-site', output: 'doc_build' },
    { id: 'website', output: 'dist' }
  ].filter(site => fs.existsSync(path.join(root, site.id, 'package.json')))
  if (!sites.length) {
    console.log('Generated site link check skipped: no built site package present')
    return 0
  }

  try {
    let missing = 0
    for (const site of sites) {
      const result = scanGeneratedSite({ rootDir: path.join(root, site.id, site.output), base: '/devcodex/' })
      console.log(`Generated site links (${site.id}): html=${result.htmlCount} missing=${result.missing.length} uniqueTargets=${result.uniqueTargets.length}`)
      for (const item of result.missing) {
        console.error(`MISSING ${site.id}/${item.source} -> ${item.href} (${item.target})`)
      }
      missing += result.missing.length
    }
    return missing > 0 ? 2 : 0
  } catch (error) {
    console.error(error.message)
    return 1
  }
}

if (require.main === module) process.exitCode = main()

module.exports = { main }
