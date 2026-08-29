#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  allocateGovernanceRecordId,
  buildGovernanceLedgerIndex,
  initializeGovernanceLedgerManifest,
  inspectGovernanceLedgerManifest,
  loadGovernanceLedgerManifest,
  rebuildGovernanceLedgerIndex,
  resolveAllGovernanceLedgerFamilies,
  sha256
} = require('./lib/governance-ledger-resolver.js')
const {
  applyGapRegistryMigration,
  buildGapRegistryMigrationPlan,
  rollbackGapRegistryMigration
} = require('./lib/governance-ledger-migration.js')
const { buildRuntimeStateIndex } = require('./lib/runtime-state-index.js')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-ledger-resolver-'))

function write (relative, content) {
  const file = path.join(root, ...relative.split('/'))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content, 'utf8')
  return file
}

function clone (value) {
  return JSON.parse(JSON.stringify(value))
}

function expectCode (fn, code) {
  assert.throws(fn, error => error?.code === code, code)
}

try {
  write('data/process-improvements.md', '| PI-001 | 2026-08-01 | open |\n')
  write('data/pending-fixes.md', '| PF-001 | 2026-08-01 | open |\n')
  write('data/violations.md', '| VL-001 | 2026-08-01 | closed |\n')
  write('data/pending-issues.md', '| ISSUE-001 | 2026-08-01 | open |\n')
  const gapSource = [
    '# Gap registry',
    '',
    '## 登记表',
    '',
    '| 编号 | 日期 | 状态 |',
    '|---|---|---|',
    '| GR-001 | 2026-08-01 | open |',
    '',
    '## GR-002 已完成记录',
    '',
    '- 日期：2026-08-02',
    '- 状态：✅ closed',
    '',
    '## GR-003 部分完成记录',
    '',
    '- 日期：2026-08-03',
    '- 状态：partial-closed / residual-tail',
    '',
    '## GR-004 已发布记录',
    '',
    '- 日期：2026-08-04',
    '- 状态：released',
    '',
    '## GR-005 活动记录',
    '',
    '- 日期：2026-08-05',
    '- 状态：open',
    '',
    '## GR-006 混合格式终态记录',
    '',
    '- 日期：2026-08-06',
    '- 状态：closed',
    '| GR-099 | 2026-08-06 | embedded open record |',
    ''
  ].join('\n')
  const gapFile = write('data/gap-registry.md', gapSource)

  const ledgerDigestsBefore = Object.fromEntries(resolveAllGovernanceLedgerFamilies(root)
    .flatMap(resolution => resolution.documents)
    .map(document => [document.relativePath, sha256(fs.readFileSync(document.file))]))
  const zeroMoveIndexBefore = buildGovernanceLedgerIndex(root)
  const runtimeIndexBefore = buildRuntimeStateIndex(root)
  const initialized = initializeGovernanceLedgerManifest(root)
  assert.strictEqual(initialized.status, 'initialized')
  assert.strictEqual(loadGovernanceLedgerManifest(root).origin, 'manifest')
  assert.deepStrictEqual(buildGovernanceLedgerIndex(root), zeroMoveIndexBefore, 'manifest init must preserve zero-move resolver semantics')
  assert.deepStrictEqual(buildRuntimeStateIndex(root), runtimeIndexBefore, 'runtime-state consumer must preserve zero-move semantics')
  const ledgerDigestsAfter = Object.fromEntries(resolveAllGovernanceLedgerFamilies(root)
    .flatMap(resolution => resolution.documents)
    .map(document => [document.relativePath, sha256(fs.readFileSync(document.file))]))
  assert.deepStrictEqual(ledgerDigestsAfter, ledgerDigestsBefore, 'manifest init must not rewrite ledgers')

  const firstAllocation = allocateGovernanceRecordId(root, 'GR')
  const secondAllocation = allocateGovernanceRecordId(root, 'gap-registry')
  assert.strictEqual(firstAllocation.id, 'GR-007')
  assert.strictEqual(secondAllocation.id, 'GR-008')
  expectCode(
    () => allocateGovernanceRecordId(root, 'GR', { expectedManifestDigest: firstAllocation.manifestDigest }),
    'GOVERNANCE_LEDGER_MANIFEST_STALE'
  )

  const loaded = loadGovernanceLedgerManifest(root)
  const missingShard = clone(loaded.manifest)
  missingShard.ledgerFamilies.GR.shards.push({
    path: 'data/archive/gap-registry/2026/GR-001--001.md',
    year: 2026,
    firstId: 'GR-001',
    lastId: 'GR-001',
    ids: ['GR-001'],
    digest: '0'.repeat(64),
    immutable: true
  })
  assert(inspectGovernanceLedgerManifest(root, missingShard, { requireAll: true }).issues.some(issue => issue.includes('ledger-document-missing')))

  const duplicateContent = '# Archive\n\n## GR-001 historical\n\n- 日期：2026-08-01\n- 状态：closed\n'
  const duplicatePath = 'data/archive/gap-registry/2026/GR-001--001.md'
  write(duplicatePath, duplicateContent)
  const duplicateManifest = clone(loaded.manifest)
  duplicateManifest.ledgerFamilies.GR.shards.push({
    path: duplicatePath,
    year: 2026,
    firstId: 'GR-001',
    lastId: 'GR-001',
    ids: ['GR-001'],
    digest: sha256(Buffer.from(duplicateContent)),
    immutable: true
  })
  const duplicateInspection = inspectGovernanceLedgerManifest(root, duplicateManifest, { requireAll: true })
  assert(duplicateInspection.issues.includes('ledger-primary-id-duplicate:GR-001'))
  duplicateManifest.ledgerFamilies.GR.reopenedOverlays.push({ id: 'GR-001', historicalShard: duplicatePath })
  assert.strictEqual(inspectGovernanceLedgerManifest(root, duplicateManifest, { requireAll: true }).valid, true, 'explicit active reopen overlay may reference one immutable historical record')
  fs.unlinkSync(path.join(root, ...duplicatePath.split('/')))

  const plan = buildGapRegistryMigrationPlan(root)
  assert.deepStrictEqual(plan.candidateIds, ['GR-002', 'GR-004'])
  assert.strictEqual(plan.candidateCount, 2)
  assert.deepStrictEqual(plan.excludedNonSelfContained, [{ id: 'GR-006', foreignPrimaryIds: ['GR-099'] }])
  assert.strictEqual(plan.shards[0].path, 'data/archive/gap-registry/2026/GR-002--004.md')
  const applied = applyGapRegistryMigration(root, plan.planDigest)
  assert.strictEqual(applied.status, 'applied')
  assert.deepStrictEqual(applied.candidateIds, plan.candidateIds)
  const activeAfter = fs.readFileSync(gapFile, 'utf8')
  assert(!activeAfter.includes('## GR-002'))
  assert(!activeAfter.includes('## GR-004'))
  assert(activeAfter.includes('## GR-003'))
  assert(activeAfter.includes('## GR-005'))
  assert(activeAfter.includes('## GR-006'))
  assert(activeAfter.includes('GR-099'))
  const afterManifest = loadGovernanceLedgerManifest(root)
  assert.strictEqual(afterManifest.manifest.ledgerFamilies.GR.shards.length, 1)
  const derived = rebuildGovernanceLedgerIndex(root)
  assert.deepStrictEqual(derived.index.records.filter(record => record.kind === 'GR').map(record => record.id), [
    'GR-001', 'GR-002', 'GR-003', 'GR-004', 'GR-005', 'GR-006'
  ])
  assert.deepStrictEqual(buildGovernanceLedgerIndex(root), derived.index, 'derived index must rebuild exactly from manifest + active + shards')
  expectCode(() => applyGapRegistryMigration(root, plan.planDigest), 'GOVERNANCE_LEDGER_MIGRATION_PLAN_STALE')

  let failManifestCommit = true
  const faultFs = new Proxy(fs, {
    get (target, property) {
      if (property === 'renameSync') {
        return (source, destination) => {
          if (failManifestCommit && path.basename(destination) === 'governance-ledger-manifest.json') {
            failManifestCommit = false
            const error = new Error('TEST_MANIFEST_COMMIT_FAILED')
            error.code = 'TEST_MANIFEST_COMMIT_FAILED'
            throw error
          }
          return fs.renameSync(source, destination)
        }
      }
      const value = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
  expectCode(() => rollbackGapRegistryMigration(root, plan.planDigest, { fs: faultFs }), 'TEST_MANIFEST_COMMIT_FAILED')
  assert.strictEqual(fs.readFileSync(gapFile, 'utf8'), activeAfter, 'failed rollback must restore the manifest-consistent active ledger')
  assert.strictEqual(loadGovernanceLedgerManifest(root).manifest.ledgerFamilies.GR.shards.length, 1)
  assert(!fs.existsSync(path.join(root, 'data/governance-ledger-migration.transaction.json')), 'recovered rollback removes its transaction marker')

  const rolledBack = rollbackGapRegistryMigration(root, plan.planDigest)
  assert.strictEqual(rolledBack.status, 'rolled-back')
  assert.strictEqual(fs.readFileSync(gapFile, 'utf8'), gapSource)
  assert.strictEqual(loadGovernanceLedgerManifest(root).manifest.ledgerFamilies.GR.shards.length, 0)
  assert(fs.existsSync(path.join(root, 'data/archive/gap-registry/2026/GR-002--004.md')), 'rollback keeps immutable unreferenced shard')

  console.log('governance ledger resolver, manifest, allocation, migration, index and rollback tests passed')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
