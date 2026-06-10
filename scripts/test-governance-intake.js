#!/usr/bin/env node
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const RUNTIME = path.join(ROOT, 'hooks', '_runtime', 'lifecycle.cjs')
const failures = []
const tempRoots = []

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8')
}

function mustInclude(file, needle, label = needle) {
  if (!read(file).includes(needle)) {
    failures.push(`${file} missing "${label}"`)
  }
}

function mustNotInclude(file, needle, reason) {
  if (read(file).includes(needle)) {
    failures.push(`${file} must not include "${needle}" (${reason})`)
  }
}

function runRuntime(payload, cwd, env = {}) {
  const result = spawnSync(process.execPath, [RUNTIME], {
    cwd,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...env }
  })
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'runtime exited with failure').trim())
  }
  return JSON.parse(result.stdout || '{}')
}

function setupRuntimeTempRoot() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-governance-intake-'))
  tempRoots.push(tempRoot)
  fs.mkdirSync(path.join(tempRoot, '.devcodex', 'profile'), { recursive: true })
  fs.writeFileSync(
    path.join(tempRoot, '.devcodex', 'profile', 'config.json'),
    JSON.stringify({ mode: 'dev', agent: 'claude-code' })
  )
  return tempRoot
}

function cleanupRuntimeTempRoots() {
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

function runGovernanceIntakeBehaviorReplay() {
  const precheckedReply = [
    '🔍 入口检查（DEV 模式）',
    '- PC0 上下文：fixture',
    '- PC1 意图：fixture'
  ].join('\n')

  const unresolvedRoot = setupRuntimeTempRoot()
  runRuntime({
    hookEventName: 'UserPromptSubmit',
    prompt: '你刚才漏了主动记录用户纠正的错误，这个以后应该进入治理台账'
  }, unresolvedRoot)
  const unresolvedStop = runRuntime({
    hookEventName: 'Stop',
    assistantMessage: `${precheckedReply}\n我知道了，后续注意。`
  }, unresolvedRoot)
  if (!/治理 intake 候选尚未分流/.test(unresolvedStop.systemMessage || '')) {
    failures.push('governance intake replay should remind when user correction is not routed')
  }

  const resolvedRoot = setupRuntimeTempRoot()
  runRuntime({
    hookEventName: 'UserPromptSubmit',
    prompt: '用户建议：以后合理建议要主动记录'
  }, resolvedRoot)
  const resolvedStop = runRuntime({
    hookEventName: 'Stop',
    assistantMessage: [
      precheckedReply,
      '规范化意图：record.process-improvement',
      '置信度：高',
      '依据：用户建议可泛化且命中 Improvement Intake',
      '目标台账：data/process-improvements.md',
      '已记录 PI-999'
    ].join('\n')
  }, resolvedRoot)
  if (/治理 intake 候选尚未分流/.test(resolvedStop.systemMessage || '')) {
    failures.push('governance intake replay should not remind after PI/PF/VL routing evidence')
  }

  const incompleteEvidenceRoot = setupRuntimeTempRoot()
  runRuntime({
    hookEventName: 'UserPromptSubmit',
    prompt: '用户建议：以后合理建议要主动记录'
  }, incompleteEvidenceRoot)
  const incompleteEvidenceStop = runRuntime({
    hookEventName: 'Stop',
    assistantMessage: [
      precheckedReply,
      '规范化意图：record.process-improvement',
      '已记录 PI-999'
    ].join('\n')
  }, incompleteEvidenceRoot)
  if (!/治理 intake 候选尚未分流/.test(incompleteEvidenceStop.systemMessage || '')) {
    failures.push('governance intake replay should require confidence and basis for non-none RecordRouter evidence')
  }

  const oldIdOnlyRoot = setupRuntimeTempRoot()
  runRuntime({
    hookEventName: 'UserPromptSubmit',
    prompt: '你刚才漏了记录这个纠错，不能只引用旧台账编号'
  }, oldIdOnlyRoot)
  const oldIdOnlyStop = runRuntime({
    hookEventName: 'Stop',
    assistantMessage: [
      precheckedReply,
      '上一轮相关问题已记录 PI-039。'
    ].join('\n')
  }, oldIdOnlyRoot)
  if (!/治理 intake 候选尚未分流/.test(oldIdOnlyStop.systemMessage || '')) {
    failures.push('governance intake replay should not accept a historical ledger id without current RecordRouter evidence')
  }

  const noneRoot = setupRuntimeTempRoot()
  runRuntime({
    hookEventName: 'UserPromptSubmit',
    prompt: '以后这个一次性偏好只在当前项目生效，不需要沉淀成通用规范'
  }, noneRoot)
  const noneStop = runRuntime({
    hookEventName: 'Stop',
    assistantMessage: [
      precheckedReply,
      '规范化意图：record.none',
      'skipReason：一次性业务偏好，不写台账。'
    ].join('\n')
  }, noneRoot)
  if (/治理 intake 候选尚未分流/.test(noneStop.systemMessage || '')) {
    failures.push('governance intake replay should accept record.none + skipReason')
  }

  const ordinaryRoot = setupRuntimeTempRoot()
  runRuntime({
    hookEventName: 'UserPromptSubmit',
    prompt: '解释一下 README 的安装步骤'
  }, ordinaryRoot)
  const ordinaryStop = runRuntime({
    hookEventName: 'Stop',
    assistantMessage: `${precheckedReply}\n这是普通解释。`
  }, ordinaryRoot)
  if (/治理 intake 候选尚未分流/.test(ordinaryStop.systemMessage || '')) {
    failures.push('ordinary chat prompt should not create governance intake candidate')
  }

  const ordinaryFutureQuestionRoot = setupRuntimeTempRoot()
  runRuntime({
    hookEventName: 'UserPromptSubmit',
    prompt: '以后要怎么配置 README？'
  }, ordinaryFutureQuestionRoot)
  const ordinaryFutureQuestionStop = runRuntime({
    hookEventName: 'Stop',
    assistantMessage: `${precheckedReply}\n这是普通用法问答。`
  }, ordinaryFutureQuestionRoot)
  if (/治理 intake 候选尚未分流/.test(ordinaryFutureQuestionStop.systemMessage || '')) {
    failures.push('ordinary future-question prompt should not create governance intake candidate')
  }
}

const probes = [
  ['instructions.md', 'Improvement Intake（优化清单）'],
  ['instructions.md', '所有模式命中后都必须显式回执'],
  ['instructions/01-common.instructions.md', 'Improvement Intake（优化清单）'],
  ['instructions/01-common.instructions.md', '所有模式下，每条用户消息完成合理性评估后'],
  ['instructions/01-common.instructions.md', '业务局部诉求'],
  ['skills/spec-governance/SKILL.md', 'Improvement Intake（优化清单）'],
  ['skills/spec-governance/SKILL.md', '在所有模式下'],
  ['skills/spec-governance/SKILL.md', 'PI + PF'],
  ['skills/spec-governance/SKILL.md', '所有模式下，主动 Intake 完成后必须显式回执'],
  ['instructions/18-spec-radar.instructions.md', 'RecordRouter / Improvement Intake'],
  ['instructions/18-spec-radar.instructions.md', '全模式规则执行'],
  ['data/templates/process-improvements.md', '优化清单'],
  ['data/templates/process-improvements.md', '触发来源'],
  ['data/templates/process-improvements.md', '关联缺口'],
  ['data/README.md', '优化清单（PI）'],
  ['data/README.md', '承载 DevCodex 规范资产的 active-root'],
  ['README.md', '规范治理 Intake'],
  ['hooks/_runtime/lifecycle-governance-intake.cjs', 'governanceIntakeCandidate'],
  ['hooks/_runtime/lifecycle-governance-intake.cjs', 'record.none'],
  ['hooks/_runtime/lifecycle-governance-intake.cjs', 'requiresCoupledRecordRouterEvidence'],
  ['hooks/_runtime/lifecycle-governance-intake.cjs', 'CONFIDENCE_RE'],
  ['hooks/_runtime/lifecycle-governance-intake.cjs', 'BASIS_RE'],
  ['hooks/_runtime/lifecycle-governance-intake.cjs', '治理 intake 候选尚未分流'],
  ['hooks/_runtime/lifecycle-visible-reply.cjs', 'buildGovernanceIntakeReminderItem'],
  ['scripts/test-governance-intake.js', 'runGovernanceIntakeBehaviorReplay'],
  ['scripts/test-governance-intake.js', '用户纠正'],
  ['scripts/test-governance-intake.js', 'historical ledger id'],
  ['scripts/test-governance-intake.js', 'ordinary future-question prompt'],
  ['skills/load-profile/SKILL.md', 'config.local.json'],
  ['skills/load-profile/SKILL.md', 'extensions.<namespace>'],
  ['skills/load-profile/SKILL.md', '不得覆盖 `mode` / `agent` / `pluginVersion`'],
  ['prompts/project-profile.prompt.md', 'config.local.json'],
  ['prompts/project-profile.prompt.md', 'extensions.<namespace>']
]

for (const [file, needle] of probes) {
  mustInclude(file, needle)
}

const forbidden = [
  ['instructions.md', 'dev 模式需显式回执已记录的 `PI-xxx / PF-xxx`', 'Improvement Intake 回执已改为全模式'],
  ['instructions.md', '在 `dev` 模式下，每条用户消息在完成合理性评估后', 'Improvement Intake 不再区分 dev/prod'],
  ['instructions/01-common.instructions.md', 'dev 模式必须回执 `已记录 PI-xxx / PF-xxx`', 'Improvement Intake 回执已改为全模式'],
  ['instructions/01-common.instructions.md', 'dev 模式必须显式回执', 'Improvement Intake 回执已改为全模式'],
  ['skills/spec-governance/SKILL.md', '在 `dev` 模式下，除了处理“记录一下”这类显式记录请求', '主动 Intake 已改为全模式'],
  ['skills/spec-governance/SKILL.md', 'dev 模式下，主动 Intake 完成后必须显式回执', '主动 Intake 回执已改为全模式'],
  ['skills/intent/SKILL.md', 'dev 模式下还要执行主动 Improvement Intake', '主动 Intake 已改为全模式'],
  ['instructions/18-spec-radar.instructions.md', '当前 dev 模式消息经合理性评估后命中', '前置判断不再绑定 dev 消息'],
  ['data/templates/process-improvements.md', 'dev 模式需回执', '模板说明已改为全模式'],
  ['README.md', 'dev 模式下每条用户消息在合理性评估后都会额外检查', 'README 说明已改为全模式'],
  ['README.md', 'dev 模式下每条用户消息还会执行主动 Improvement Intake', 'README 说明已改为全模式'],
  ['website/docs/guide/development.md', 'dev 模式下若用户建议经验证更优且可泛化', '用户文档说明已改为全模式'],
  ['changelogs/unreleased.md', 'dev 模式下对可泛化更优策略或规范缺口执行主动记录', '变更记录已改为全模式']
]

for (const [file, needle, reason] of forbidden) {
  mustNotInclude(file, needle, reason)
}

try {
  runGovernanceIntakeBehaviorReplay()
} catch (e) {
  failures.push(`governance intake behavior replay failed: ${e.message}`)
} finally {
  cleanupRuntimeTempRoots()
}

if (failures.length) {
  console.error('Governance intake checks failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Governance intake checks passed')
