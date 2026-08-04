#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  inspectGovernanceLedgerBuffer,
  inspectGovernanceLedgerFile
} = require('../hooks/_runtime/governance-ledger-integrity.cjs')
const { validateGovernanceLedgers } = require('./validate-governance-ledgers.js')

const valid = Buffer.from([
  '# 优化清单',
  '',
  '| 编号 | 状态 |',
  '|---|---|',
  '| PI-003 | 2026-08-04 | open |',
  '| PI-001 | 2026-08-03 | closed |'
].join('\n'))
const receipt = inspectGovernanceLedgerBuffer(valid, { expectedPrefix: 'PI-' })
assert.strictEqual(receipt.valid, true)
assert.deepStrictEqual(receipt.primaryIds, ['PI-003', 'PI-001'])
assert.strictEqual(receipt.nextId, 'PI-004')
assert(receipt.tailSentinel.digest)

const withNul = Buffer.concat([valid, Buffer.from('\n| PI-004 | 2026-08-04 | bad '), Buffer.from([0]), Buffer.from(' row |\n')])
assert.deepStrictEqual(inspectGovernanceLedgerBuffer(withNul, { expectedPrefix: 'PI-' }).issues, ['nul-byte'])

const duplicate = Buffer.from('| PF-001 | 2026-08-03 | open |\n| PF-001 | 2026-08-04 | closed |\n')
assert(inspectGovernanceLedgerBuffer(duplicate, { expectedPrefix: 'PF-' }).issues.includes('duplicate-primary-id'))

const invalidUtf8 = Buffer.from([0xc3, 0x28])
assert(inspectGovernanceLedgerBuffer(invalidUtf8, { expectedPrefix: 'PI-' }).issues.includes('invalid-utf8'))

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-ledger-integrity-'))
try {
  const dataRoot = path.join(tempRoot, 'data')
  fs.mkdirSync(dataRoot, { recursive: true })
  fs.writeFileSync(path.join(dataRoot, 'process-improvements.md'), valid)
  fs.writeFileSync(path.join(dataRoot, 'pending-fixes.md'), '| PF-002 | 2026-08-04 | open |\n| PF-001 | 2026-08-03 | closed |\n')
  assert.strictEqual(inspectGovernanceLedgerFile(path.join(dataRoot, 'process-improvements.md'), { expectedPrefix: 'PI-' }).valid, true)
  assert.strictEqual(validateGovernanceLedgers(tempRoot).result, 'PASS')
  fs.appendFileSync(path.join(dataRoot, 'pending-fixes.md'), Buffer.from([0]))
  assert.strictEqual(validateGovernanceLedgers(tempRoot).result, 'FAIL')
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}

console.log('governance ledger integrity tests passed')
