#!/usr/bin/env node
'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  classifyReportPath,
  hydrateReportEntry,
  hydrateReportEntries,
  queryReportIndex,
  rebuildReportIndex,
  scanReportCatalog
} = require('./lib/report-index.js')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-report-index-'))

function write(relativePath, content) {
  const filePath = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
  return filePath
}

function snapshot(rootPath) {
  if (!fs.existsSync(rootPath)) return []
  const result = []
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) visit(full)
      else {
        result.push({
          path: path.relative(rootPath, full).replace(/\\/g, '/'),
          digest: crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')
        })
      }
    }
  }
  visit(rootPath)
  return result.sort((left, right) => left.path.localeCompare(right.path))
}

function findFile(rootPath, name) {
  if (!fs.existsSync(rootPath)) return null
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    const full = path.join(rootPath, entry.name)
    if (entry.isDirectory()) {
      const found = findFile(full, name)
      if (found) return found
    } else if (entry.name === name) {
      return full
    }
  }
  return null
}

try {
  write('reports/dev/codex/20260723/01--primary.md', '# Primary Report\n\nbody\n')
  write('reports/dev/codex/20260723/evidence/input.md', '# Evidence\n')
  write('reports/dev/codex/20260723/artifacts/output.log', 'raw output\n')
  write('reports/dev/codex/20260723/generated/copy.md', '# Generated Copy\n')
  write('reports/dev/codex/20260723/odd.bin', 'unknown\n')
  write('requirements/task-a/reports/codex/20260722/01--task-report.md', '# Task Report\n')
  write('notes/not-allowlisted.md', '# Must Not Be Discovered\n')

  const outside = write('outside.md', '# Outside\n')
  const linkPath = path.join(root, 'reports', 'dev', 'codex', '20260723', 'linked.md')
  let symlinkSupported = true
  try {
    fs.symlinkSync(outside, linkPath, 'file')
  } catch {
    symlinkSupported = false
  }

  assert.strictEqual(classifyReportPath('reports/x/evidence/a.md'), 'evidence')
  assert.strictEqual(classifyReportPath('reports/x/artifacts/a.json'), 'artifact')
  assert.strictEqual(classifyReportPath('reports/x/generated/a.md'), 'generated-copy')
  assert.strictEqual(classifyReportPath('reports/release/smoke/v1/node_modules/a.md'), 'generated-copy')
  assert.strictEqual(classifyReportPath('reports/x/a.md'), 'primary-report')
  assert.strictEqual(classifyReportPath('reports/x/a.bin'), 'unknown')

  const scan = scanReportCatalog(root)
  assert.strictEqual(scan.entries.filter(entry => entry.classification === 'primary-report').length, 2)
  assert.ok(!scan.entries.some(entry => entry.path.includes('not-allowlisted')))
  assert.ok(scan.entries.some(entry => entry.classification === 'evidence'))
  assert.ok(scan.entries.some(entry => entry.classification === 'artifact'))
  assert.ok(scan.entries.some(entry => entry.classification === 'generated-copy'))
  assert.ok(scan.entries.some(entry => entry.classification === 'unknown'))
  if (symlinkSupported) assert.ok(scan.warnings.some(warning => warning.code === 'REPORT_SYMLINK_SKIPPED'))

  const firstBuild = rebuildReportIndex(root)
  assert.strictEqual(firstBuild.status, 'persisted')
  assert.strictEqual(firstBuild.generation, 1)
  assert.strictEqual(firstBuild.classCounts['primary-report'], 2)

  const runtimeRoot = path.join(root, '.runtime-state')
  const beforeQueries = snapshot(runtimeRoot)
  const firstPage = queryReportIndex(root, { limit: 1 })
  assert.strictEqual(firstPage.status, 'fresh')
  assert.strictEqual(firstPage.coverage.route, 'ordered-snapshot')
  assert.strictEqual(firstPage.receipt.freshnessTier, 'metadata-reconciled')
  assert.strictEqual(firstPage.items.length, 1)
  assert.strictEqual(firstPage.totalMatched, 2)
  assert.deepStrictEqual(firstPage.nextPointer, { offset: 1 })
  assert.ok(firstPage.snapshotCursor)
  assert.ok(firstPage.snapshotCursorEncoded)
  assert.ok(firstPage.items.every(entry => entry.classification === 'primary-report'))

  const secondPage = queryReportIndex(root, {
    limit: 1,
    offset: firstPage.nextPointer.offset,
    snapshotCursor: firstPage.snapshotCursor
  })
  assert.strictEqual(secondPage.items.length, 1)
  assert.strictEqual(secondPage.coverage.route, 'snapshot-cursor')
  assert.strictEqual(secondPage.telemetry.metadataEntriesStat, 0)
  assert.strictEqual(secondPage.nextPointer, null)
  assert.notStrictEqual(firstPage.items[0].id, secondPage.items[0].id)

  const encodedSecondPage = queryReportIndex(root, {
    limit: 1,
    offset: firstPage.nextPointer.offset,
    snapshotCursor: firstPage.snapshotCursorEncoded
  })
  assert.strictEqual(encodedSecondPage.coverage.route, 'snapshot-cursor')
  assert.strictEqual(encodedSecondPage.items[0].id, secondPage.items[0].id)

  const legacyOffsetPage = queryReportIndex(root, { limit: 1, offset: 1 })
  assert.strictEqual(legacyOffsetPage.status, 'fresh')
  assert.strictEqual(legacyOffsetPage.items[0].id, secondPage.items[0].id)

  const tamperedCursor = {
    ...firstPage.snapshotCursor,
    pageSize: 2
  }
  assert.throws(
    () => queryReportIndex(root, { limit: 1, offset: 1, snapshotCursor: tamperedCursor }),
    /snapshotCursor digest mismatch/
  )
  assert.throws(
    () => queryReportIndex(root, { limit: 1, offset: 1, task: 'task-a', snapshotCursor: firstPage.snapshotCursor }),
    /snapshotCursor query mismatch/
  )

  const compact = queryReportIndex(root, { limit: 2, projection: 'compact' })
  const fullProjection = queryReportIndex(root, { limit: 2 })
  assert.ok(compact.telemetry.deliveredBytes < fullProjection.telemetry.deliveredBytes)
  assert.ok(!Object.prototype.hasOwnProperty.call(compact.items[0], 'modifiedAt'))
  assert.ok(!Object.prototype.hasOwnProperty.call(compact.items[0], 'pointer'))
  assert.strictEqual(compact.items[0].classification, 'primary-report')

  const hydrated = queryReportIndex(root, { text: 'primary', hydrate: true, maxHydrateBytes: 10 })
  assert.strictEqual(hydrated.status, 'fresh')
  assert.strictEqual(hydrated.hydrated, true)
  assert.strictEqual(hydrated.items[0].hydration.truncated, true)
  assert.ok(hydrated.items[0].hydration.content.length > 0)
  const batchHydrated = hydrateReportEntries(root, hydrated.items, { maxBytes: 10 })
  assert.strictEqual(batchHydrated.entries.length, hydrated.items.length)
  assert.ok(batchHydrated.bytesRead > 0)
  assert.throws(
    () => hydrateReportEntry(root, { pointer: { path: '../outside.md' } }),
    /escapes activeRoot|outside allowlisted/
  )
  if (symlinkSupported) {
    assert.throws(
      () => hydrateReportEntry(root, { pointer: { path: 'reports/dev/codex/20260723/linked.md' } }),
      /non-symlink/
    )
  }
  assert.deepStrictEqual(snapshot(runtimeRoot), beforeQueries, 'report query and hydration must remain zero-write')

  write('requirements/task-a/reports/codex/20260723/02--manual.md', '# Manual Report\n')
  const reconciled = queryReportIndex(root, { task: 'task-a', text: 'manual' })
  assert.strictEqual(reconciled.status, 'fallback')
  assert.strictEqual(reconciled.coverage.route, 'path-stat-reconcile')
  assert.strictEqual(reconciled.items.length, 1)
  assert.strictEqual(reconciled.items[0].title, 'manual')
  assert.deepStrictEqual(snapshot(runtimeRoot), beforeQueries, 'manual reconciliation must remain in-memory')

  const secondBuild = rebuildReportIndex(root)
  assert.strictEqual(secondBuild.status, 'persisted')
  assert.strictEqual(secondBuild.generation, 2)
  assert.strictEqual(queryReportIndex(root, { task: 'task-a', text: 'manual' }).status, 'fresh')

  const currentPointer = findFile(path.join(runtimeRoot, 'derived-indexes', 'v1', 'report'), 'current.json')
  assert.ok(currentPointer)
  fs.writeFileSync(currentPointer, '{"corrupt":true}\n', 'utf8')
  const corruptFallback = queryReportIndex(root, { text: 'primary' })
  assert.strictEqual(corruptFallback.status, 'fallback')
  assert.strictEqual(corruptFallback.coverage.route, 'path-stat-reconcile')
  assert.strictEqual(corruptFallback.receipt.status, 'invalid')

  console.log('✓ report allowlist, classification, reconcile, pagination, hydration, corrupt fallback and zero-write fixtures passed')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
