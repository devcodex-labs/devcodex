'use strict'

const fs = require('fs')
const path = require('path')

function portable(value) {
  return String(value || '').replace(/\\/g, '/')
}

function lineForOffset(text, offset) {
  return String(text).slice(0, Math.max(0, offset)).split('\n').length
}

function isAllowed(config, relativePath, ruleId, line) {
  return (config.allowlist || []).some(item => (
    portable(item.path) === portable(relativePath) &&
    item.ruleId === ruleId &&
    (item.line === '*' || Number(item.line) === Number(line))
  ))
}

function compilePatterns(entries, kind) {
  return (entries || []).map((entry, index) => {
    try {
      return { id: entry.id || `${kind}-${index + 1}`, regex: new RegExp(entry.pattern, entry.flags || 'u') }
    } catch (error) {
      throw new Error(`invalid ${kind} pattern ${entry.id || index + 1}: ${error.message}`)
    }
  })
}

function addMatches(target, text, relativePath, ruleId, regex, config, severity) {
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`
  const matcher = new RegExp(regex.source, flags)
  for (const match of text.matchAll(matcher)) {
    const line = lineForOffset(text, match.index || 0)
    if (isAllowed(config, relativePath, ruleId, line)) continue
    target.push({
      ruleId,
      severity,
      path: portable(relativePath),
      line,
      excerpt: String(match[0] || '').slice(0, 160)
    })
  }
}

function analyzePublicTextBuffer(relativePath, buffer, config) {
  const blockers = []
  const warnings = []
  let text = ''
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch (error) {
    blockers.push({
      ruleId: 'utf8-fatal',
      severity: 'blocker',
      path: portable(relativePath),
      line: null,
      excerpt: error.message
    })
    return { path: portable(relativePath), status: 'blocked', blockers, warnings }
  }

  addMatches(blockers, text, relativePath, 'replacement-character', /\uFFFD/u, config, 'blocker')
  for (const item of compilePatterns(config.contaminationPatterns, 'contamination')) {
    addMatches(blockers, text, relativePath, item.id, item.regex, config, 'blocker')
  }
  for (const item of compilePatterns(config.highConfidenceMojibakePatterns, 'high-confidence-mojibake')) {
    addMatches(blockers, text, relativePath, item.id, item.regex, config, 'blocker')
  }
  for (const item of compilePatterns(config.lowConfidenceMojibakePatterns, 'low-confidence-mojibake')) {
    addMatches(warnings, text, relativePath, item.id, item.regex, config, 'warning')
  }

  return {
    path: portable(relativePath),
    status: blockers.length ? 'blocked' : (warnings.length ? 'warning' : 'passed'),
    blockers,
    warnings
  }
}

function validateConfig(config) {
  if (!config || config.schemaVersion !== 'PublicTextSurfacesV1') {
    throw new Error('public text config must use PublicTextSurfacesV1')
  }
  if (!Array.isArray(config.surfaces) || !config.surfaces.length) {
    throw new Error('public text config requires at least one surface')
  }
  const paths = config.surfaces.map(item => portable(item.path))
  if (paths.some(item => !item) || new Set(paths).size !== paths.length) {
    throw new Error('public text surfaces must use unique non-empty paths')
  }
  compilePatterns(config.contaminationPatterns, 'contamination')
  compilePatterns(config.highConfidenceMojibakePatterns, 'high-confidence-mojibake')
  compilePatterns(config.lowConfidenceMojibakePatterns, 'low-confidence-mojibake')
  return config
}

function checkPublicTextSurfaces(root, config) {
  validateConfig(config)
  const results = []
  for (const surface of config.surfaces) {
    const relativePath = portable(surface.path)
    const full = path.join(root, relativePath)
    if (!fs.existsSync(full)) {
      results.push({
        path: relativePath,
        status: 'blocked',
        blockers: [{ ruleId: 'surface-missing', severity: 'blocker', path: relativePath, line: null, excerpt: '' }],
        warnings: []
      })
      continue
    }
    results.push(analyzePublicTextBuffer(relativePath, fs.readFileSync(full), config))
  }
  const blockers = results.flatMap(item => item.blockers)
  const warnings = results.flatMap(item => item.warnings)
  return {
    schemaVersion: 'PublicTextIntegrityResultV1',
    status: blockers.length ? 'blocked' : (warnings.length ? 'warning' : 'passed'),
    surfaceCount: results.length,
    blockers,
    warnings,
    results
  }
}

module.exports = {
  analyzePublicTextBuffer,
  checkPublicTextSurfaces,
  validateConfig
}
