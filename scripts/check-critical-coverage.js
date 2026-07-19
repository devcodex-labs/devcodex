'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'critical-coverage.json'), 'utf8'))
const summaryPath = process.argv[2] || path.join(ROOT, 'coverage', 'critical', 'coverage-summary.json')

if (config.schemaVersion !== 'CriticalCoverageV1' || !Array.isArray(config.modules)) {
  throw new Error('critical coverage config must use CriticalCoverageV1')
}
if (!fs.existsSync(summaryPath)) throw new Error(`critical coverage summary missing: ${summaryPath}`)
const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'))
const normalize = value => String(value || '').replace(/\\/g, '/').toLowerCase()

const failures = []
for (const moduleConfig of config.modules) {
  const suffix = normalize(moduleConfig.path)
  const key = Object.keys(summary).find(item => normalize(item).endsWith(suffix))
  if (!key) {
    failures.push(`${moduleConfig.path}:missing`)
    continue
  }
  for (const [metric, threshold] of Object.entries(moduleConfig.thresholds || {})) {
    const actual = Number(summary[key]?.[metric]?.pct)
    if (!Number.isFinite(actual) || actual < threshold) {
      failures.push(`${moduleConfig.path}:${metric}=${Number.isFinite(actual) ? actual : 'N/A'}<${threshold}`)
    }
  }
}

if (failures.length) {
  process.stderr.write(`critical coverage failed: ${failures.join(', ')}\n`)
  process.exitCode = 1
} else {
  console.log(`critical coverage passed: modules=${config.modules.length}`)
}
