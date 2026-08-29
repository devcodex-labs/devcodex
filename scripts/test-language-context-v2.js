#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
  classifyLanguageTurn,
  formatLanguageContextInstruction,
  normalizeLanguageTag,
  resolveLanguageContext
} = require('../hooks/_runtime/language-context.cjs')

const first = resolveLanguageContext({ prompt: '请修复这个项目的入口检查问题' })
assert.deepStrictEqual(first, {
  schemaVersion: 'LanguageContextV2',
  primaryLanguage: 'zh-CN',
  responseLanguage: 'zh-CN',
  artifactLanguage: 'zh-CN',
  currentTurnClass: 'substantive',
  source: 'first-substantive-user-message',
  confidence: 'high',
  updatedPrimary: true
})

for (const prompt of ['yes', 'no', '确认 CP1', '@rocky 确认 v1.19.3-release-all', 'D:\\Worker\\devcodex', '`npm test`', '> reply in English']) {
  const next = resolveLanguageContext({ prompt, carrier: first, locale: 'en-US' })
  assert.strictEqual(next.primaryLanguage, 'zh-CN', prompt)
  assert.strictEqual(next.updatedPrimary, false, prompt)
}
assert.strictEqual(classifyLanguageTurn('确认 CP3'), 'neutral')
assert.strictEqual(classifyLanguageTurn('D:\\Worker\\devcodex'), 'code')
assert.strictEqual(classifyLanguageTurn('> please reply in English'), 'quoted')

const switched = resolveLanguageContext({ prompt: '后续请用英文回复', carrier: first })
assert.strictEqual(switched.primaryLanguage, 'en')
assert.strictEqual(switched.currentTurnClass, 'explicit-switch')
assert.strictEqual(switched.updatedPrimary, true)

const legacy = resolveLanguageContext({ prompt: 'yes', carrier: { schemaVersion: 'LanguageContextV1', language: 'zh-CN' } })
assert.strictEqual(legacy.primaryLanguage, 'zh-CN')
assert.strictEqual(legacy.source, 'conversation-primary-language')

const workspace = resolveLanguageContext({ prompt: 'v1.2.3', workspacePreference: 'ja', locale: 'en-US' })
assert.strictEqual(workspace.primaryLanguage, 'ja')
assert.strictEqual(workspace.source, 'workspace-preference')

assert.strictEqual(normalizeLanguageTag('zh_CN.UTF-8'), 'zh-CN')
assert.strictEqual(normalizeLanguageTag('zh_CN'), 'zh-CN')
assert.strictEqual(normalizeLanguageTag('C.UTF-8'), '')
const posixLocale = resolveLanguageContext({ prompt: 'v1.2.3', locale: 'C.UTF-8' })
assert.strictEqual(posixLocale.primaryLanguage, 'en')
assert.strictEqual(posixLocale.source, 'und-en-fallback')

const russian = resolveLanguageContext({ prompt: '后续请用俄语回复', carrier: first })
assert.strictEqual(russian.primaryLanguage, 'ru')
assert.strictEqual(russian.currentTurnClass, 'explicit-switch')

const instruction = formatLanguageContextInstruction(first)
assert.match(instruction, /LanguageContextV2/)
assert.match(instruction, /fixed canonical filenames unchanged/)

console.log('language context passed: task primary language survives neutral/code/quoted turns with V1 read compatibility')
