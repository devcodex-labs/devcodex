#!/usr/bin/env node
'use strict'

const path = require('path')
const { cleanupPackageProjection } = require('./lib/package-compatibility-projection')
const { restorePublishedPackageManifest } = require('./lib/published-package-manifest-projection')
const {
  isSourcePackageRoot,
  validatePublishedPackageRoot
} = require('./lib/published-package-scripts-contract')

const ROOT = path.resolve(__dirname, '..')
if (!isSourcePackageRoot(ROOT)) {
  const validation = validatePublishedPackageRoot(ROOT)
  process.stderr.write(
    `[published-package] postpack validated scripts=${validation.scriptCount} closure=${validation.closureFileCount}\n`
  )
} else {
  const failures = []
  let manifest = null
  let projection = null
  try {
    manifest = restorePublishedPackageManifest(ROOT)
  } catch (error) {
    failures.push(error)
  }
  try {
    projection = cleanupPackageProjection(ROOT)
  } catch (error) {
    failures.push(error)
  }
  if (failures.length) {
    const error = new Error('PACKAGE_PROJECTION_POSTPACK_CLEANUP_FAILED')
    error.code = 'PACKAGE_PROJECTION_POSTPACK_CLEANUP_FAILED'
    error.causes = failures
    throw error
  }
  process.stderr.write(
    `[package-projection] postpack manifest=${manifest.status} content=${projection.status} removed=${projection.removed.length}\n`
  )
}
