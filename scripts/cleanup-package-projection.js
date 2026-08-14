#!/usr/bin/env node
'use strict'

const path = require('path')
const { cleanupPackageProjection } = require('./lib/package-compatibility-projection')
const { restorePublishedPackageManifest } = require('./lib/published-package-manifest-projection')

const ROOT = path.resolve(__dirname, '..')
const failures = []
let manifest = null
let content = null
try {
  manifest = restorePublishedPackageManifest(ROOT)
} catch (error) {
  failures.push(error)
}
try {
  content = cleanupPackageProjection(ROOT)
} catch (error) {
  failures.push(error)
}
if (failures.length) {
  const error = new Error('PACKAGE_PROJECTION_CLEANUP_FAILED')
  error.code = 'PACKAGE_PROJECTION_CLEANUP_FAILED'
  error.causes = failures
  throw error
}
process.stdout.write(`${JSON.stringify({
  schemaVersion: 'PackageProjectionCleanupReceiptV1',
  status: 'PASS',
  manifest,
  content
})}\n`)
