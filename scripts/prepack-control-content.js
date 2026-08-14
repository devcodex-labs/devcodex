#!/usr/bin/env node
'use strict'

const { execFileSync } = require('child_process')
const path = require('path')
const {
  cleanupPackageProjection,
  preparePackageProjection
} = require('./lib/package-compatibility-projection')
const {
  projectPublishedPackageManifest,
  restorePublishedPackageManifest
} = require('./lib/published-package-manifest-projection')
const {
  isSourcePackageRoot,
  validatePublishedPackageRoot
} = require('./lib/published-package-scripts-contract')

const ROOT = path.resolve(__dirname, '..')
const checks = [
  ['generate-control-content.js', '--check'],
  ['extract-control-content-fragments.js', '--check'],
  ['analyze-control-content-duplication.js', '--check']
]

function runSourceChecks () {
  for (const [script, flag] of checks) {
    const output = execFileSync(process.execPath, [path.join(__dirname, script), flag], {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true
    })
    if (output.trim()) process.stderr.write(`${output.trim()}\n`)
  }
}

if (!isSourcePackageRoot(ROOT)) {
  const validation = validatePublishedPackageRoot(ROOT)
  process.stderr.write(
    `[published-package] prepack validated scripts=${validation.scriptCount} closure=${validation.closureFileCount}\n`
  )
} else {
  try {
    const recovery = restorePublishedPackageManifest(ROOT)
    runSourceChecks()
    const projection = preparePackageProjection(ROOT)
    const manifest = projectPublishedPackageManifest(ROOT)
    process.stderr.write(
      `[package-projection] ${projection.mode} entries=${projection.entryCount} plan=${projection.planDigest.slice(0, 12)} manifest=${manifest.status} recovery=${recovery.status}\n`
    )
  } catch (error) {
    if (error.stdout) process.stderr.write(String(error.stdout))
    if (error.stderr) process.stderr.write(String(error.stderr))
    try { restorePublishedPackageManifest(ROOT) } catch (restoreError) { error.manifestRestoreError = restoreError }
    try { cleanupPackageProjection(ROOT) } catch (cleanupError) { error.packageProjectionCleanupError = cleanupError }
    throw error
  }
}
