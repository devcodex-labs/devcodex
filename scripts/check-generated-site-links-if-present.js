#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { scanGeneratedSite } = require('./check-generated-site-links')

const ROOT = path.resolve(__dirname, '..')

function main(options = {}) {
  const root = options.root ? path.resolve(options.root) : ROOT
  const websitePackage = path.join(root, 'website', 'package.json')
  if (!fs.existsSync(websitePackage)) {
    console.log('Generated site link check skipped: website/package.json not present')
    return 0
  }

  try {
    const result = scanGeneratedSite({ rootDir: path.join(root, 'website', 'dist') })
    console.log(`Generated site links: html=${result.htmlCount} missing=${result.missing.length} uniqueTargets=${result.uniqueTargets.length}`)
    for (const item of result.missing) {
      console.error(`MISSING ${item.source} -> ${item.href} (${item.target})`)
    }
    return result.missing.length > 0 ? 2 : 0
  } catch (error) {
    console.error(error.message)
    return 1
  }
}

if (require.main === module) process.exitCode = main()

module.exports = { main }
