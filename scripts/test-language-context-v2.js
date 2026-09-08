#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
  classifyLanguageTurn,
  formatLanguageContextInstruction,
  languageContextIntegrityErrors,
  normalizeLanguageTag,
  resolveLanguagePreference,
  resolveLanguageContext
} = require('../hooks/_runtime/language-context.cjs')
const { validateIntentSemanticDecision } = require('../hooks/_runtime/intent-semantic-decision.cjs')

for (const [locale, expected] of [['en', 'en-US'], ['zh', 'zh-CN'], ['en-US', 'en-US'], ['zh-CN', 'zh-CN']]) {
  const input = { schemaVersion: 'IntentSemanticDecisionV1',
    sourceRef: { envelopeId: 'fixture', envelopeDigest: 'a'.repeat(64), contextEpoch: 'fixture-epoch' },
    languageDecision: { replyLocale: locale, scope: 'task', kind: 'explicit' } }
  const accepted = validateIntentSemanticDecision(input)
  assert.strictEqual(accepted.valid, true, JSON.stringify(accepted.errors))
  assert.strictEqual(accepted.value.languageDecision.replyLocale, locale, 'retain exact semantic input for its source binding')
  assert.strictEqual(resolveLanguageContext({ languageDecision: accepted.value.languageDecision }).responseLanguage, expected)
  for (const invalid of ['en/../../', 'en-', 'en US', 'en_US']) {
    assert.strictEqual(validateIntentSemanticDecision({ ...input, languageDecision: { ...input.languageDecision, replyLocale: invalid } }).valid, false)
  }
}

// Projection tests consume model decisions; CLI scenarios evaluate natural-language intent.
const decision = (replyLocale, scope = 'task', kind = 'explicit') => ({ replyLocale, scope, kind })
const first = resolveLanguageContext({ languageDecision: decision('zh-CN', 'task', 'infer'), prompt: '请修复这个项目的入口检查问题' })
assert.strictEqual(first.schemaVersion, 'LanguageContextV3')
assert.strictEqual(first.primaryLanguage, 'zh-CN')
assert.strictEqual(first.durablePrimaryLocale, 'zh-CN')
assert.strictEqual(first.responseLanguage, 'zh-CN')
assert.strictEqual(first.artifactLanguage, 'zh-CN')
assert.strictEqual(first.currentTurnClass, 'substantive')
assert.strictEqual(first.source, 'model-language-task-infer')
assert.strictEqual(first.localeCapability, 'full')
assert.deepStrictEqual(languageContextIntegrityErrors(first), [])

for (const prompt of ['yes', 'no', '确认 CP1', '@rocky 确认 v1.19.3-release-all', 'D:\\Worker\\devcodex', '`npm test`', '> reply in English']) {
  const next = resolveLanguageContext({ prompt, carrier: first, locale: 'en-US' })
  assert.strictEqual(next.primaryLanguage, 'zh-CN', prompt)
  assert.strictEqual(next.updatedPrimary, false, prompt)
}
assert.strictEqual(classifyLanguageTurn('确认 CP3'), 'neutral')
assert.strictEqual(classifyLanguageTurn('D:\\Worker\\devcodex'), 'neutral')
assert.strictEqual(classifyLanguageTurn('> please reply in English'), 'neutral')

const switched = resolveLanguageContext({ languageDecision: decision('en-US', 'task', 'explicit'), prompt: '后续请用英文回复', carrier: first })
assert.strictEqual(switched.primaryLanguage, 'en-US')
assert.strictEqual(switched.durablePrimaryLocale, 'en-US')
assert.strictEqual(switched.currentTurnClass, 'explicit-switch')
assert.strictEqual(switched.updatedPrimary, true)

for (const prompt of [
  '不要用英文回复',
  '为什么用英文回复？',
  '请检查是否使用英文回复',
  '系统显示“请用英文回复”，分析原因',
  '不是让你用英文回复'
]) {
  const guarded = resolveLanguageContext({ prompt, carrier: first })
  assert.strictEqual(guarded.responseLanguage, 'zh-CN', prompt)
  assert.notStrictEqual(guarded.currentTurnClass, 'explicit-switch', prompt)
}
const compoundSwitch = resolveLanguageContext({ languageDecision: decision('zh-CN', 'task', 'explicit'), prompt: '不要再用英文，后续改用中文回复', carrier: switched })
assert.strictEqual(compoundSwitch.responseLanguage, 'zh-CN')
assert.strictEqual(compoundSwitch.durablePrimaryLocale, 'zh-CN')

const oneTurn = resolveLanguageContext({ languageDecision: decision('en-US', 'turn', 'explicit'), prompt: '这一条请用英文回答', carrier: first })
assert.strictEqual(oneTurn.responseLanguage, 'en-US')
assert.strictEqual(oneTurn.durablePrimaryLocale, 'zh-CN')
assert.strictEqual(oneTurn.persistentOverride, false)
const afterOneTurn = resolveLanguageContext({ prompt: '确认', carrier: oneTurn, locale: 'en-US' })
assert.strictEqual(afterOneTurn.responseLanguage, 'zh-CN', 'one-turn override must not replace durable task Chinese')

const firstTurnOverride = resolveLanguageContext({ languageDecision: decision('en-US', 'turn', 'explicit'), prompt: '这一条请用英文回答' })
assert.strictEqual(firstTurnOverride.responseLanguage, 'en-US')
assert.strictEqual(firstTurnOverride.durableProvisional, true)
const afterFirstTurnOverride = resolveLanguageContext({ languageDecision: decision('zh-CN', 'task', 'infer'), prompt: '请继续处理这个中文项目', carrier: firstTurnOverride })
assert.strictEqual(afterFirstTurnOverride.responseLanguage, 'zh-CN',
  'a first-turn one-shot override must not lock the durable task language')
assert.strictEqual(afterFirstTurnOverride.durableProvisional, false)

const hostOnly = resolveLanguageContext({ prompt: '确认', locale: 'en-US' })
assert.strictEqual(hostOnly.durableProvisional, true)
const afterHostOnly = resolveLanguageContext({ languageDecision: decision('zh-CN', 'task', 'infer'), prompt: '请分析项目恢复逻辑', carrier: hostOnly, locale: 'en-US' })
assert.strictEqual(afterHostOnly.responseLanguage, 'zh-CN',
  'a provisional host locale must yield to the first substantive task language')
assert.strictEqual(afterHostOnly.durableProvisional, false)

const legacy = resolveLanguageContext({ prompt: 'yes', carrier: { schemaVersion: 'LanguageContextV1', language: 'zh-CN' } })
assert.strictEqual(legacy.primaryLanguage, 'zh-CN')
assert.strictEqual(legacy.source, 'model-language-decision-pending')

const workspace = resolveLanguageContext({ prompt: 'v1.2.3', workspacePreference: 'ja', locale: 'en-US' })
assert.strictEqual(workspace.primaryLanguage, 'ja')
assert.strictEqual(workspace.source, 'workspace-fixed')
assert.strictEqual(workspace.localeCapability, 'partial')

assert.strictEqual(normalizeLanguageTag('zh_CN.UTF-8'), 'zh-CN')
assert.strictEqual(normalizeLanguageTag('zh_CN'), 'zh-CN')
assert.strictEqual(normalizeLanguageTag('C.UTF-8'), '')
const posixLocale = resolveLanguageContext({ prompt: 'v1.2.3', locale: 'C.UTF-8' })
assert.strictEqual(posixLocale.primaryLanguage, 'en-US')
assert.strictEqual(posixLocale.source, 'model-language-decision-pending')

const russian = resolveLanguageContext({ languageDecision: decision('ru', 'task', 'explicit'), prompt: '后续请用俄语回复', carrier: first })
assert.strictEqual(russian.primaryLanguage, 'ru')
assert.strictEqual(russian.durablePrimaryLocale, 'ru')
assert.strictEqual(russian.currentTurnClass, 'explicit-switch')

const inherited = resolveLanguagePreference({
  projectBound: true,
  workspacePreference: { schemaVersion: 'LanguagePreferenceV1', mode: 'fixed', locale: 'en' },
  projectPreference: { schemaVersion: 'LanguagePreferenceV1', mode: 'inherit', locale: null }
})
assert.strictEqual(inherited.fixedLocale, 'en-US')
assert.strictEqual(inherited.source, 'workspace-fixed-inherited')
const projectAuto = resolveLanguageContext({
  prompt: '确认',
  carrier: first,
  projectBound: true,
  workspacePreference: { schemaVersion: 'LanguagePreferenceV1', mode: 'fixed', locale: 'en-US' },
  projectPreference: { schemaVersion: 'LanguagePreferenceV1', mode: 'auto', locale: null }
})
assert.strictEqual(projectAuto.responseLanguage, 'zh-CN', 'project auto must suppress workspace fixed and keep durable task language')
const projectFixed = resolveLanguageContext({
  prompt: '确认',
  carrier: first,
  projectBound: true,
  workspacePreference: { schemaVersion: 'LanguagePreferenceV1', mode: 'fixed', locale: 'en-US' },
  projectPreference: { schemaVersion: 'LanguagePreferenceV1', mode: 'fixed', locale: 'zh-CN' }
})
assert.strictEqual(projectFixed.responseLanguage, 'zh-CN')
assert.strictEqual(projectFixed.preferenceSource, 'project-fixed')
const invalid = resolveLanguageContext({
  prompt: '确认',
  carrier: first,
  projectBound: true,
  projectPreference: { schemaVersion: 'LanguagePreferenceV1', mode: 'fixed', locale: null }
})
assert.strictEqual(invalid.responseLanguage, 'zh-CN')
assert.ok(invalid.diagnostics.includes('project-language-preference-fixed-locale-required'))

const instruction = formatLanguageContextInstruction(first)
const staleEnglish = { schemaVersion: 'LanguageContextV2', primaryLanguage: 'en-US', confidence: 'low' }
const corrected = resolveLanguageContext({ languageDecision: decision('zh-CN', 'task', 'infer'), prompt: '请继续修复当前中文任务', taskContext: staleEnglish })
assert.strictEqual(corrected.responseLanguage, 'zh-CN')
assert.strictEqual(resolveLanguageContext({ prompt: '确认', carrier: corrected }).responseLanguage, 'zh-CN')
assert.strictEqual(resolveLanguageContext({ prompt: '> reply in English\n请继续检查中文任务', carrier: first }).responseLanguage, 'zh-CN')
assert.strictEqual(resolveLanguageContext({ languageDecision: decision('zh-CN'), prompt: '中文回答', carrier: staleEnglish }).responseLanguage, 'zh-CN')
assert.strictEqual(resolveLanguageContext({ prompt: '请继续检查代码', carrier: switched }).responseLanguage, 'en-US',
  'explicit persistent language remains effective over inferred current language')
assert.match(instruction, /LanguageContextV3/)
assert.match(instruction, /LanguageContextV2 readers/)
assert.match(instruction, /fixed canonical filenames unchanged/)

for (const prompt of ['中文回答', 'English only', '后续日语', '<answer>yes</answer>']) {
  const pending = resolveLanguageContext({ prompt, locale: 'en-US' })
  assert.strictEqual(pending.source, 'model-language-decision-pending')
  assert.strictEqual(pending.durableProvisional, true)
  assert.doesNotMatch(formatLanguageContextInstruction(pending), /Retained task reply language:/)
}
const retainedInstruction = formatLanguageContextInstruction(resolveLanguageContext({ carrier: corrected }))
assert.match(retainedInstruction, /Retained task reply language: zh-CN/)
assert.match(retainedInstruction, /unless the current user intent changes it/)
assert.throws(() => resolveLanguageContext({ languageDecision: decision('invalid_locale_??') }), error => error.code === 'LANGUAGE_DECISION_INVALID')
const splitLocale = resolveLanguageContext({ carrier: first,
  languageDecision: { ...decision('zh-CN', 'turn'), artifactLocale: 'ja' }
})
assert.strictEqual(splitLocale.responseLanguage, 'zh-CN')
assert.strictEqual(splitLocale.artifactLanguage, 'ja')

console.log('language context V3 passed: config precedence, durable neutral/resume, overrides, capabilities, and V1/V2 read compatibility')
