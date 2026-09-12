#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

function usage() {
  return [
    'Usage: node scripts/refresh-task-delivery-manifest.js --task-root <dir> [--check] [--json]',
    'Refreshes or verifies delivery-manifest.json for one task directory.'
  ].join('\n')
}

function parseArgs(argv) {
  const args = { check: false, json: false, taskRoot: null }
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--check') args.check = true
    else if (item === '--json') args.json = true
    else if (item === '--task-root') {
      index += 1
      args.taskRoot = argv[index]
    } else if (item === '--help' || item === '-h') {
      args.help = true
    } else {
      throw new Error(`Unsupported argument: ${item}`)
    }
  }
  return args
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.isFile()) out.push(full)
  }
  return out
}

function buildManifest(taskRoot) {
  const manifestPath = path.join(taskRoot, 'delivery-manifest.json')
  const files = walk(taskRoot)
    .filter(file => path.resolve(file) !== path.resolve(manifestPath))
    .sort((left, right) => left.localeCompare(right))
  const entries = files.map(file => {
    const bytes = fs.readFileSync(file)
    const stat = fs.statSync(file)
    return {
      path: path.relative(taskRoot, file).replace(/\\/g, '/'),
      bytes: bytes.length,
      mtimeUtc: stat.mtime.toISOString(),
      sha256: sha256(bytes)
    }
  })
  return {
    schemaVersion: 'TaskArtifactDeliveryManifestV2',
    generatedAt: new Date().toISOString(),
    taskRoot: taskRoot.replace(/\\/g, '/'),
    self: { path: 'delivery-manifest.json', indexed: false, reason: 'avoid self-referential hash drift' },
    counts: { files: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0) },
    entries
  }
}

function stableComparable(manifest) {
  return {
    schemaVersion: manifest.schemaVersion,
    taskRoot: manifest.taskRoot,
    self: manifest.self,
    counts: manifest.counts,
    entries: manifest.entries
  }
}

function verifyManifest(taskRoot, manifest) {
  const errors = []
  if (manifest.schemaVersion !== 'TaskArtifactDeliveryManifestV2') errors.push('schemaVersion-invalid')
  if (!manifest.self || manifest.self.indexed !== false) errors.push('self-index-policy-invalid')
  if (!Array.isArray(manifest.entries)) errors.push('entries-invalid')
  const seen = new Set()
  let bytesTotal = 0
  for (const entry of manifest.entries || []) {
    if (!entry.path || path.isAbsolute(entry.path) || entry.path.split('/').includes('..')) errors.push(`entry-path-invalid:${entry.path}`)
    if (seen.has(entry.path)) errors.push(`entry-duplicate:${entry.path}`)
    seen.add(entry.path)
    const file = path.join(taskRoot, ...String(entry.path || '').split('/'))
    if (!fs.existsSync(file)) {
      errors.push(`entry-missing:${entry.path}`)
      continue
    }
    const actual = fs.readFileSync(file)
    bytesTotal += actual.length
    if (entry.bytes !== actual.length) errors.push(`entry-bytes:${entry.path}`)
    if (entry.sha256 !== sha256(actual)) errors.push(`entry-sha256:${entry.path}`)
  }
  if (manifest.counts?.files !== (manifest.entries || []).length) errors.push('counts.files-invalid')
  if (manifest.counts?.bytes !== bytesTotal) errors.push('counts.bytes-invalid')
  return errors
}

function main() {
  let args
  try { args = parseArgs(process.argv) } catch (error) {
    console.error(error.message)
    console.error(usage())
    process.exit(2)
  }
  if (args.help) {
    console.log(usage())
    return
  }
  if (!args.taskRoot) {
    console.error('Missing --task-root')
    console.error(usage())
    process.exit(2)
  }
  const taskRoot = path.resolve(args.taskRoot)
  const manifestPath = path.join(taskRoot, 'delivery-manifest.json')
  if (!fs.existsSync(taskRoot) || !fs.statSync(taskRoot).isDirectory()) throw new Error(`Task root not found: ${taskRoot}`)
  const next = buildManifest(taskRoot)
  const current = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null
  const stale = !current || JSON.stringify(stableComparable(current)) !== JSON.stringify(stableComparable(next))
  const errors = current ? verifyManifest(taskRoot, current) : ['manifest-missing']
  if (!args.check && (stale || errors.length)) fs.writeFileSync(manifestPath, JSON.stringify(next, null, 2) + '\n')
  const finalManifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null
  const finalErrors = finalManifest ? verifyManifest(taskRoot, finalManifest) : ['manifest-missing']
  const result = {
    schemaVersion: 'TaskDeliveryManifestRefreshResultV1',
    taskRoot: taskRoot.replace(/\\/g, '/'),
    manifestPath: manifestPath.replace(/\\/g, '/'),
    mode: args.check ? 'check' : 'write',
    stale,
    refreshed: !args.check && (stale || errors.length > 0),
    files: finalManifest?.counts?.files || 0,
    bytes: finalManifest?.counts?.bytes || 0,
    errors: args.check ? (stale ? ['manifest-stale', ...finalErrors] : finalErrors) : finalErrors,
    ok: args.check ? !stale && finalErrors.length === 0 : finalErrors.length === 0
  }
  if (args.json) console.log(JSON.stringify(result, null, 2))
  else if (result.ok) console.log(`delivery-manifest ${result.mode} PASS (${result.files} files)`)
  else console.error(JSON.stringify(result, null, 2))
  process.exit(result.ok ? 0 : 1)
}

main()
