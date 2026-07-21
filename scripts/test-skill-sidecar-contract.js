#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  ERROR,
  parseAndValidateSidecar,
  loadSkillSidecarFromDisk,
  sidecarRelativePath
} = require('./lib/skill-sidecar-contract')
const { buildPortfolio, serializePortfolio, validatePortfolio } = require('./lib/skill-portfolio-utils')

const ROOT = path.resolve(__dirname, '..')

function withTempSkill (fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-sidecar-'))
  const skillId = 'fixture-skill'
  const skillRoot = path.join(dir, 'skills', skillId)
  fs.mkdirSync(path.join(skillRoot, 'references'), { recursive: true })
  fs.mkdirSync(path.join(skillRoot, 'scripts'), { recursive: true })
  fs.mkdirSync(path.join(skillRoot, 'assets'), { recursive: true })
  try {
    return fn({ dir, skillId, skillRoot })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function expectCode (fn, code) {
  let err
  try {
    fn()
  } catch (error) {
    err = error
  }
  assert.ok(err, `expected error ${code}`)
  assert.strictEqual(err.code, code, `expected ${code}, got ${err && err.code}: ${err && err.message}`)
}

// --- unit: absent sidecar ---
{
  const missing = loadSkillSidecarFromDisk(ROOT, 'report')
  assert.strictEqual(missing, null)
  console.log('✓ absent sidecar returns null')
}

// --- unit: valid minimal sidecar ---
withTempSkill(({ skillId, skillRoot }) => {
  fs.writeFileSync(path.join(skillRoot, 'references', 'a.md'), '# A\n')
  const raw = JSON.stringify({
    schemaVersion: 'DevCodexSkillContractV1',
    resources: [
      { id: 'a', type: 'reference', path: 'references/a.md', load: 'on-demand', required: false }
    ]
  }, null, 2)
  const result = parseAndValidateSidecar({ skillId, skillRootAbs: skillRoot, rawText: raw })
  assert.strictEqual(result.state, 'valid')
  assert.strictEqual(result.resourceContracts.length, 1)
  assert.ok(/^[a-f0-9]{64}$/.test(result.digest))
  assert.ok(/^[a-f0-9]{64}$/.test(result.resourceContracts[0].contentDigest))
  console.log('✓ valid minimal sidecar')
})

// --- negative: forbidden central fields ---
withTempSkill(({ skillId, skillRoot }) => {
  expectCode(() => parseAndValidateSidecar({
    skillId,
    skillRootAbs: skillRoot,
    rawText: JSON.stringify({ schemaVersion: 'DevCodexSkillContractV1', lifecycle: 'active' })
  }), ERROR.SIDECAR_FIELD_FORBIDDEN)
  expectCode(() => parseAndValidateSidecar({
    skillId,
    skillRootAbs: skillRoot,
    rawText: JSON.stringify({ schemaVersion: 'DevCodexSkillContractV1', hostCaps: {} })
  }), ERROR.SIDECAR_FIELD_FORBIDDEN)
  console.log('✓ forbidden fields rejected')
})

// --- negative: bad schema version ---
withTempSkill(({ skillId, skillRoot }) => {
  expectCode(() => parseAndValidateSidecar({
    skillId,
    skillRootAbs: skillRoot,
    rawText: JSON.stringify({ schemaVersion: 'v999' })
  }), ERROR.SIDECAR_SCHEMA_UNSUPPORTED)
  console.log('✓ unsupported schemaVersion rejected')
})

// --- negative: path escape ---
withTempSkill(({ skillId, skillRoot }) => {
  expectCode(() => parseAndValidateSidecar({
    skillId,
    skillRootAbs: skillRoot,
    rawText: JSON.stringify({
      schemaVersion: 'DevCodexSkillContractV1',
      resources: [{ id: 'x', type: 'reference', path: '../secrets.md', load: 'on-demand' }]
    })
  }), ERROR.PATH_INVALID)
  expectCode(() => parseAndValidateSidecar({
    skillId,
    skillRootAbs: skillRoot,
    rawText: JSON.stringify({
      schemaVersion: 'DevCodexSkillContractV1',
      resources: [{ id: 'x', type: 'reference', path: 'scripts/nope.js', load: 'on-demand' }]
    })
  }), ERROR.RESOURCE_PATH_ESCAPE)
  console.log('✓ path escape / wrong prefix rejected')
})

// --- negative: missing resource file ---
withTempSkill(({ skillId, skillRoot }) => {
  expectCode(() => parseAndValidateSidecar({
    skillId,
    skillRootAbs: skillRoot,
    rawText: JSON.stringify({
      schemaVersion: 'DevCodexSkillContractV1',
      resources: [{ id: 'x', type: 'reference', path: 'references/missing.md', load: 'on-demand' }]
    })
  }), ERROR.RESOURCE_NOT_FOUND)
  console.log('✓ missing resource rejected')
})

// --- negative: auto invocation ---
withTempSkill(({ skillId, skillRoot }) => {
  fs.writeFileSync(path.join(skillRoot, 'scripts', 'x.cjs'), 'module.exports = {}\n')
  expectCode(() => parseAndValidateSidecar({
    skillId,
    skillRootAbs: skillRoot,
    rawText: JSON.stringify({
      schemaVersion: 'DevCodexSkillContractV1',
      scripts: [{
        id: 'x',
        path: 'scripts/x.cjs',
        runtime: 'node',
        purpose: 'test',
        invocation: 'auto'
      }]
    })
  }), ERROR.SCRIPT_INVOCATION_FORBIDDEN)
  console.log('✓ auto invocation rejected')
})

// --- negative: invalid json ---
withTempSkill(({ skillId, skillRoot }) => {
  expectCode(() => parseAndValidateSidecar({
    skillId,
    skillRootAbs: skillRoot,
    rawText: '{ not json'
  }), ERROR.SIDECAR_JSON_INVALID)
  console.log('✓ invalid JSON rejected')
})

// --- portfolio without any sidecar still builds ---
{
  const portfolio = buildPortfolio(ROOT)
  const errors = validatePortfolio(portfolio)
  assert.deepStrictEqual(errors, [])
  assert.strictEqual(portfolio.summary.sidecarPresentCount, 0)
  assert.ok(portfolio.generatedFrom.sidecarDigest)
  assert.ok(portfolio.skills.every(skill => skill.sidecar == null))
  // serialize size smoke
  assert.ok(serializePortfolio(portfolio).length > 1000)
  console.log('✓ portfolio without sidecars builds (sidecarPresentCount=0)')
}

// --- invalid sidecar in real skill tree fails buildPortfolio ---
{
  const skillId = 'report'
  const sidecarPath = path.join(ROOT, sidecarRelativePath(skillId))
  const had = fs.existsSync(sidecarPath)
  const backup = had ? fs.readFileSync(sidecarPath) : null
  try {
    fs.writeFileSync(sidecarPath, JSON.stringify({
      schemaVersion: 'DevCodexSkillContractV1',
      lifecycle: 'active'
    }))
    let failed = false
    try {
      buildPortfolio(ROOT)
    } catch (error) {
      failed = true
      assert.match(error.message, /skill sidecar invalid for report/)
      assert.match(error.message, /SIDECAR_FIELD_FORBIDDEN|forbidden field/)
    }
    assert.ok(failed, 'expected buildPortfolio to fail on forbidden field')
    console.log('✓ invalid sidecar fails buildPortfolio')
  } finally {
    if (had) fs.writeFileSync(sidecarPath, backup)
    else if (fs.existsSync(sidecarPath)) fs.unlinkSync(sidecarPath)
  }
}

console.log('\x1b[32m✓ skill-sidecar-contract tests passed\x1b[0m')
