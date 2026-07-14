#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')
const {
  buildPortfolio,
  detectCycles,
  serializePortfolio,
  validatePortfolio
} = require('./lib/skill-portfolio-utils')

const ROOT = path.resolve(__dirname, '..')
const first = buildPortfolio(ROOT)
const second = buildPortfolio(ROOT)

assert.strictEqual(serializePortfolio(first), serializePortfolio(second), 'portfolio generation must be byte-identical')
assert.strictEqual(first.summary.skillCount, 76)
assert.strictEqual(first.summary.registeredSkillCount, 76)
assert.strictEqual(first.summary.activeSkillCount, 74)
assert.strictEqual(first.summary.graySkillCount, 2)
assert.strictEqual(first.skills.find(skill => skill.id === 'rework-prevention-engineering').lifecycleState, 'gray')
assert.strictEqual(first.skills.find(skill => skill.id === 'consumer-validation-engineering').lifecycleState, 'gray')
assert.strictEqual(first.summary.orphanActiveCount, 0)
assert.strictEqual(first.summary.dependencyCycleCount, 0)
assert.strictEqual(first.summary.triggerQuality, 'insufficient-evidence')
assert.deepStrictEqual(validatePortfolio(first), [])
assert.deepStrictEqual(detectCycles(['a', 'b'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]), [['a', 'b', 'a']])

const invalid = JSON.parse(JSON.stringify(first))
invalid.skills[0].lifecycleState = 'auto-promoted'
assert.ok(validatePortfolio(invalid).some(error => error.includes('illegal lifecycle state')))

console.log('✓ Skill portfolio determinism, coverage and negative fixtures passed')
