'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  inspectFeatureInventoryDocument, FEATURE_INVENTORY_COLUMNS, FEATURE_INVENTORY_COLUMN_LABELS
} = require('../mcp/profile-contract.js')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-feature-evidence-'))
fs.mkdirSync(path.join(root, 'src'), { recursive: true })
fs.writeFileSync(path.join(root, 'src', 'billing.js'), 'exports.total = items => items.reduce((sum, item) => sum + item.price, 0)\n')
fs.writeFileSync(path.join(root, 'package.json'), '{"bin":{"billing":"src/billing.js"}}\n')
function row(id, sourceEvidence, overrides = {}) {
  const values = {
    featureId: id, capabilityGroup: '账单', publicSurface: 'total', configEntrypoint: '默认',
    primaryConsumers: '账单用户', docsEntrypoint: 'README.md', validationRoute: '尚未运行',
    sourceEvidence, maintenanceOwner: '维护者', releaseState: 'unreleased', lifecycleState: 'implemented',
    evidenceState: 'validated', asOf: '2026-09-08', evidenceRefs: '声明尚未经运行取证', ...overrides
  }
  return '| ' + FEATURE_INVENTORY_COLUMNS.map(key => values[key]).join(' | ') + ' |'
}
function document(rows) {
  return [
    '# 功能清单', '> FeatureInventorySchemaV2',
    '| ' + FEATURE_INVENTORY_COLUMNS.map(key => FEATURE_INVENTORY_COLUMN_LABELS[key]).join(' | ') + ' |',
    '| ' + FEATURE_INVENTORY_COLUMNS.map(() => '---').join(' | ') + ' |', ...rows
  ].join('\n')
}
const options = { requireV2: true, projectRoot: root }
const legacy = inspectFeatureInventoryDocument([
  '| 能力 | 公开面 | 消费者 | 验证路线 |', '|---|---|---|---|',
  '| TODO | 待补充 | tbd | 业务含义须由审查判断 |', '| incomplete | row |'
].join('\n'))
assert.strictEqual(legacy.rows.length, 2)
assert.strictEqual(legacy.projection.featureCount, 2)
assert.strictEqual(legacy.projection.evidenceState, 'unverified')
assert.strictEqual(legacy.validRows.length, 1, 'prose tokens do not decide whether a row exists')
assert.strictEqual(legacy.valid, false, 'malformed rows must remain visible')
const real = inspectFeatureInventoryDocument(document([row('billing', '`src/billing.js#L1`')]), options)
assert.strictEqual(real.valid, true, JSON.stringify(real.errors))
assert.strictEqual(real.projection.evidenceState, 'source-backed')
assert.strictEqual(real.projection.intentSatisfaction, 'UNVERIFIED')
assert.strictEqual(real.rowDiagnostics[0].declaredEvidenceState, 'validated')
assert.strictEqual(real.rowDiagnostics[0].sourceObservation.references[0].status, 'observed')
const mixed = inspectFeatureInventoryDocument(document([
  row('billing', 'src/billing.js'), row('missing', 'scripts/nonexistent.js'),
  row('anchor-missing', 'package.json#bin.unknown'), '| malformed | row |'
]), options)
assert.strictEqual(mixed.valid, false)
assert.strictEqual(mixed.rows.length, 4)
assert.strictEqual(mixed.inputRowCount, mixed.outputRowCount)
assert.strictEqual(mixed.projection.featureCount, 4)
assert.strictEqual(mixed.projection.evidenceState, 'unverified')
assert.strictEqual(mixed.rowDiagnostics.filter(value => !value.valid).length, 3)
const unbound = inspectFeatureInventoryDocument(document([row('billing', 'src/billing.js')]))
assert.strictEqual(unbound.projection.evidenceState, 'unverified', 'declared validated text has no authority without observed sources')
assert.strictEqual(inspectFeatureInventoryDocument(document([row('json-anchor', 'package.json#bin.billing')]), options).valid, true)
assert.strictEqual(inspectFeatureInventoryDocument(document([row('escape', '../package.json')]), options).valid, false)
assert.strictEqual(inspectFeatureInventoryDocument(document([row('bad-date', 'src/billing.js', { asOf: '2026-02-30' })]), options).valid, false)
fs.renameSync(path.join(root, 'src', 'billing.js'), path.join(root, 'src', 'billing-moved.js'))
assert.strictEqual(inspectFeatureInventoryDocument(document([row('billing', 'src/billing.js')]), options).valid, false)
fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify({
  schemaVersion: 'FeatureInventoryEvidenceTestV1', passed: true, real, mixed, unbound
}, null, 2) + '\n')
console.log(`Feature inventory source, anchor, row conservation and declaration isolation passed: ${root}`)
