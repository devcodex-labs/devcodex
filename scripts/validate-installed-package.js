#!/usr/bin/env node
'use strict'

const path = require('path')
const { validatePublishedPackageRoot } = require('./lib/published-package-scripts-contract')

const root = path.resolve(__dirname, '..')
try {
  const receipt = validatePublishedPackageRoot(root)
  process.stdout.write(`${JSON.stringify(receipt)}\n`)
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 'PublishedPackageScriptsValidationFailureV1',
    status: 'BLOCK',
    errorCode: error.code || 'PUBLISHED_PACKAGE_VALIDATION_FAILED',
    message: error.message
  })}\n`)
  process.exitCode = 1
}
