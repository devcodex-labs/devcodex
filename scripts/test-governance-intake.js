#!/usr/bin/env node
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { buildLifecycleGovernanceIntakeUtils } = require('../hooks/_runtime/lifecycle-governance-intake.cjs')
const { createCanonicalAwareReader } = require('./lib/canonical-consumer-contracts')

const ROOT = path.resolve(__dirname, '..')
const RUNTIME = path.join(ROOT, 'hooks', '_runtime', 'lifecycle.cjs')
const failures = []
const tempRoots = []

const readAbsolute = createCanonicalAwareReader(ROOT, file => fs.readFileSync(file, 'utf8'))
const read = file => readAbsolute(path.join(ROOT, file))

function mustInclude(file, needle, label = needle) {
  const content = read(file)
  if (!content.includes(needle)) {
    failures.push(`${file} missing "${label}"`)
  }
}

function mustNotInclude(file, needle, reason) {
  if (String(read(file)).includes(needle)) {
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

function readRuntimeState(root) {
  return JSON.parse(fs.readFileSync(
    path.join(root, '.devcodex', '.memory', 'hooks', 'legacy', 'lifecycle-state.json'),
    'utf8'
  ))
}

function runGovernanceIntakeBehaviorReplay() {
  const utils = buildLifecycleGovernanceIntakeUtils()
  const keywordlessPrompt = '请比较两个本地实现并告诉我哪一个更稳妥'
  let state = utils.registerGovernanceIntakeCandidate(utils.emptyGovernanceIntakeState(), keywordlessPrompt, {
    createdAt: '2026-07-13T06:40:00.000Z'
  })
  if (state.candidates.length !== 1 || !state.pending) {
    failures.push('every non-empty prompt should register a neutral post-assessment candidate without keyword matching')
  }

  state = utils.registerGovernanceIntakeCandidate(state, keywordlessPrompt, {
    createdAt: '2026-07-13T06:40:01.000Z'
  })
  if (state.candidates.length !== 1 || state.candidates[0].seenCount !== 2) {
    failures.push('an unresolved prompt digest should dedupe and increment seenCount')
  }

  state = utils.registerGovernanceIntakeCandidate(state, '第二条消息也没有治理关键词', {
    createdAt: '2026-07-13T06:40:02.000Z'
  })
  const promptLeakContext = utils.buildGovernanceIntakeContextMessage(state)
  if (state.candidates.length !== 1 || state.compactedUnresolved.count !== 1 ||
      promptLeakContext.includes(keywordlessPrompt) || promptLeakContext.length > 1024) {
    failures.push('ContextualCandidateSet should retain only the current candidate and a bounded compacted summary')
  }

  const compound = utils.parseGovernanceIntakeDecision([
    `候选锚点：${state.activeCandidateId}`,
    '评估结论：accepted',
    '泛化范围：devcodex-control-plane',
    '现有规范状态：partial',
    '规范化意图：record.process-improvement + record.spec-defect + record.audit-gap',
    '置信度：高',
    '依据：上下文和代码事实共同证明三个治理结果',
    '目标台账：data/process-improvements.md + data/pending-fixes.md + data/gap-registry.md',
    '写入要求：required',
    '写入证据：PI-101 + PF-102 + GR-103',
    'skipEvidence：N/A；存在实质治理记录'
  ].join('\n'))
  if (compound.recordIntents.length !== 3 || compound.targetLedgers.length !== 3 || compound.writeEvidence.length !== 3) {
    failures.push('CompoundRecordRouterGate should preserve every intent, ledger and evidence ID')
  }
  const compoundState = { governanceIntake: state }
  utils.updateGovernanceIntakeResolutionState(compoundState, compound.raw, 'instruction-fallback')
  const routedCandidate = compoundState.governanceIntake.candidates.find(candidate => candidate.id === state.activeCandidateId)
  if (routedCandidate?.phase !== 'routed' || compoundState.governanceIntake.candidates.length !== 1) {
    failures.push('an exact candidate anchor should route only the current unresolved candidate')
  }
  const compoundEvidenceOmitted = compound.raw.replace('写入证据：PI-101 + PF-102 + GR-103', '写入证据：PI-101 + PF-102')
  if (utils.requiresCoupledRecordRouterEvidence(compoundEvidenceOmitted)) {
    failures.push('compound routing should reject an omitted evidence item')
  }

  const migrated = utils.normalizeGovernanceIntakeState({
    governanceIntakeCandidate: true,
    pending: true,
    handled: false,
    promptPreview: 'legacy pending candidate',
    createdAt: '2026-07-12T00:00:00.000Z'
  })
  if (migrated.version !== 3 || migrated.candidates.length !== 1 || migrated.candidates[0].terminal) {
    failures.push('governance intake v1 pending state should migrate to a non-terminal v3 candidate')
  }

  const crossTurnRoot = setupRuntimeTempRoot()
  const firstOutput = runRuntime({ hookEventName: 'UserPromptSubmit', prompt: keywordlessPrompt }, crossTurnRoot)
  if (!/Neutral candidate anchors/.test(JSON.stringify(firstOutput))) {
    failures.push('UserPromptSubmit should expose neutral candidate anchors to the AI context')
  }
  runRuntime({ hookEventName: 'UserPromptSubmit', prompt: '这是一条普通的后续问题' }, crossTurnRoot)
  runRuntime({ hookEventName: 'UserPromptSubmit', prompt: '这是一条普通的后续问题' }, crossTurnRoot)
  const runtimeState = readRuntimeState(crossTurnRoot).governanceIntake
  if (runtimeState.candidates.length !== 1 || runtimeState.candidates[0].seenCount !== 2 ||
      runtimeState.compactedUnresolved.count !== 1) {
    failures.push('resetState should retain only the current candidate, compact prior turns and dedupe repeat delivery')
  }

  const sessionIsolationRoot = setupRuntimeTempRoot()
  const priorSessionIds = []
  for (let index = 0; index < 20; index += 1) {
    const output = runRuntime({
      hookEventName: 'UserPromptSubmit',
      session_id: `governance-isolation-${index}`,
      prompt: `isolated session ${index}`
    }, sessionIsolationRoot)
    const text = JSON.stringify(output)
    const ids = text.match(/GI-[A-F0-9]+-[0-9]+-[0-9]+/g) || []
    if (new Set(ids).size !== 1 || priorSessionIds.some(id => text.includes(id))) {
      failures.push(`session ${index} should expose only its own governance candidate`)
      break
    }
    priorSessionIds.push(ids[0])
  }
  const isolatedState = readRuntimeState(sessionIsolationRoot).governanceIntake
  if (isolatedState.candidates.length !== 1 || isolatedState.compactedUnresolved.count !== 0) {
    failures.push('20 new sessions should not inherit or compact candidates from prior sessions')
  }

  const unresolvedReminder = utils.buildGovernanceIntakeReminderItem(
    readRuntimeState(crossTurnRoot)
  )
  if (!/治理 intake 候选尚未完成语义评估/.test(unresolvedReminder || '')) {
    failures.push('governance reminder builder should retain unresolved neutral candidates')
  }

  const unresolvedStop = runRuntime({
    hookEventName: 'Stop',
    assistantMessage: 'PC0 PC1 PC2 PC3 PC4 PC5 PC6 PC7\n仅回答问题，没有治理决策。'
  }, crossTurnRoot)
  if (unresolvedStop.devcodexCode !== 'progressive-skill-route' ||
      unresolvedStop.devcodexNextAction?.errorCode !== 'PLAN_NOT_COMMITTED' ||
      unresolvedStop.devcodexNextAction?.nextCall?.op !== 'catalog') {
    failures.push('Stop should resolve the earlier SkillRoute gate before the governance reminder')
  }

  const multiPendingDecision = [
    '评估结论：no-governance-impact',
    '泛化范围：none',
    '现有规范状态：not-applicable',
    '规范化意图：record.none',
    '置信度：高',
    '依据：这是当前消息的一次普通事实问答',
    '目标台账：N/A',
    '写入要求：none',
    '写入证据：N/A',
    'skipEvidence：没有可泛化策略、规范缺口、违规或审计盲区'
  ].join('\n')
  const fallbackState = { governanceIntake: state }
  utils.updateGovernanceIntakeResolutionState(fallbackState, multiPendingDecision, 'instruction-fallback')
  if (!fallbackState.governanceIntake.candidates[0].terminal ||
      fallbackState.governanceIntake.candidates[0].verificationState !== 'verified-none') {
    failures.push('a decision without an anchor should resolve the sole current candidate')
  }

  let stressState = utils.emptyGovernanceIntakeState()
  for (let index = 0; index < 300; index += 1) {
    stressState = utils.registerGovernanceIntakeCandidate(stressState, `stress prompt ${index}`, {
      createdAt: new Date(Date.UTC(2026, 7, 3, 7, 0, index)).toISOString()
    })
  }
  const stressContext = utils.buildGovernanceIntakeContextMessage(stressState)
  if (stressState.candidates.length !== 1 || stressState.compactedUnresolved.count !== 299 ||
      (stressContext.match(/GI-[A-F0-9-]+/g) || []).length !== 1 || stressContext.length > 1024 ||
      JSON.stringify(stressState).length > 16 * 1024) {
    failures.push('300-turn governance state and prompt projection must remain bounded')
  }

  const legacyMany = utils.normalizeGovernanceIntakeState({
    version: 2,
    candidates: Array.from({ length: 250 }, (_, index) => ({
      id: `GI-LEGACY-${String(index + 1).padStart(3, '0')}`,
      sourceDigest: `legacy-${index + 1}`,
      promptPreview: `legacy prompt ${index + 1}`,
      createdAt: new Date(Date.UTC(2026, 6, 26, 0, index)).toISOString(),
      updatedAt: new Date(Date.UTC(2026, 6, 26, 0, index)).toISOString(),
      phase: 'detected',
      terminal: false
    }))
  })
  if (legacyMany.version !== 3 || legacyMany.candidates.length !== 1 ||
      legacyMany.compactedUnresolved.count !== 249 || !legacyMany.compactedUnresolved.digest) {
    failures.push('legacy 250-candidate state should migrate to one active candidate plus a deterministic summary')
  }

  const evidenceRoot = setupRuntimeTempRoot()
  const activeRoot = path.join(evidenceRoot, '.devcodex')
  const dataRoot = path.join(activeRoot, 'data')
  fs.mkdirSync(dataRoot, { recursive: true })

  function writeDecision(candidateId, intent, ledger, evidenceId, writeRequirement = 'required') {
    return [
      `候选锚点：${candidateId}`,
      '评估结论：accepted',
      '泛化范围：devcodex-control-plane',
      '现有规范状态：partial',
      `规范化意图：${intent}`,
      '置信度：高',
      '依据：代码事实与当前上下文证明需要形成治理记录',
      `目标台账：${ledger}`,
      `写入要求：${writeRequirement}`,
      `写入证据：${evidenceId}`,
      'skipEvidence：N/A；存在实质治理记录'
    ].join('\n')
  }

  function evaluateObservedWrite({ id, targetPath, fileContent, outcome, includeIdInPatch = true, contextOnly = false, eventName = 'PostToolUse' }) {
    fs.writeFileSync(path.join(dataRoot, 'process-improvements.md'), fileContent)
    let candidateState = utils.registerGovernanceIntakeCandidate(utils.emptyGovernanceIntakeState(), `candidate ${id}`, {
      createdAt: '2026-07-13T06:50:00.000Z'
    })
    const candidateId = candidateState.candidates[0].id
    const payload = {
      hookEventName: eventName,
      tool_name: 'apply_patch',
      tool_input: {
        input: `*** Begin Patch\n*** Update File: ${targetPath}\n${includeIdInPatch ? `+${id}` : (contextOnly ? ` ${id}\n+unrelated change` : '+no ledger id')}\n*** End Patch`
      }
    }
    if (outcome !== undefined) payload.tool_response = outcome
    const wrapper = { governanceIntake: candidateState }
    utils.observeGovernanceLedgerWrite(wrapper, payload, {
      activeRoot,
      contextRoot: evidenceRoot,
      eventName,
      observedAt: '2026-07-13T06:51:00.000Z'
    })
    utils.updateGovernanceIntakeResolutionState(
      wrapper,
      writeDecision(candidateId, 'record.process-improvement', 'data/process-improvements.md', id),
      'Stop',
      { activeRoot, contextRoot: evidenceRoot }
    )
    return wrapper.governanceIntake.candidates[0]
  }

  const verifiedWrite = evaluateObservedWrite({
    id: 'PI-201',
    targetPath: '.devcodex/data/process-improvements.md',
    fileContent: '## PI-201\nverified\n',
    outcome: { success: true }
  })
  if (!verifiedWrite.terminal || verifiedWrite.verificationState !== 'verified') {
    failures.push('successful exact active-root PostToolUse plus landed ID should verify required ledger evidence')
  }
  const verifiedPhases = verifiedWrite.phaseHistory.map(entry => entry.phase)
  if (verifiedPhases.join('>') !== 'detected>assessed>generalized>routed>write-observed>acknowledged') {
    failures.push(`verified writes must preserve the full phase sequence, got ${verifiedPhases.join('>')}`)
  }
  if (verifiedWrite.intentStates[0]?.targetLedger !== 'data/process-improvements.md' ||
      !verifiedWrite.intentStates[0]?.claimedIds.includes('PI-201') ||
      !verifiedWrite.intentStates[0]?.observationIds.length ||
      verifiedWrite.intentStates[0]?.status !== 'verified') {
    failures.push('per-intent state must retain target, claimed ID, observation ID and verified status')
  }

  const fakeWrite = evaluateObservedWrite({
    id: 'PI-202',
    targetPath: '.devcodex/data/process-improvements.md',
    fileContent: '## PI-OLD\nno claimed id\n',
    outcome: { success: true }
  })
  if (fakeWrite.terminal) failures.push('target-only or fake ledger ID must remain unverified')

  const targetOnlyWrite = evaluateObservedWrite({
    id: 'PI-203',
    targetPath: '.devcodex/data/process-improvements.md',
    fileContent: '## PI-203\nfile already contains id\n',
    outcome: { success: true },
    includeIdInPatch: false
  })
  if (targetOnlyWrite.terminal) failures.push('target path without the claimed ID in tool input must remain unverified')

  const contextOnlyWrite = evaluateObservedWrite({
    id: 'PI-209',
    targetPath: '.devcodex/data/process-improvements.md',
    fileContent: '## PI-209\npre-existing context id\n',
    outcome: { success: true },
    includeIdInPatch: false,
    contextOnly: true
  })
  if (contextOnlyWrite.terminal) failures.push('an ID present only in apply_patch context must not count as current write evidence')

  fs.writeFileSync(path.join(dataRoot, 'process-improvements.md'), '## PI-214\nonly one claimed ID exists\n')
  const multiClaimState = utils.registerGovernanceIntakeCandidate(utils.emptyGovernanceIntakeState(), 'multiple claimed IDs require all-of', {
    createdAt: '2026-07-13T06:50:30.000Z'
  })
  const multiClaimWrapper = { governanceIntake: multiClaimState }
  utils.observeGovernanceLedgerWrite(multiClaimWrapper, {
    hookEventName: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: .devcodex/data/process-improvements.md\n+PI-214\n*** End Patch' },
    tool_response: { success: true }
  }, {
    activeRoot,
    contextRoot: evidenceRoot,
    eventName: 'PostToolUse',
    observedAt: '2026-07-13T06:51:00.000Z'
  })
  utils.updateGovernanceIntakeResolutionState(
    multiClaimWrapper,
    writeDecision(multiClaimState.candidates[0].id, 'record.process-improvement', 'data/process-improvements.md', 'PI-214 + PI-999'),
    'Stop',
    { activeRoot }
  )
  if (multiClaimWrapper.governanceIntake.candidates[0].terminal) {
    failures.push('every claimed ID for one intent must have matching active-root write evidence')
  }

  const preToolOnlyWrite = evaluateObservedWrite({
    id: 'PI-210',
    targetPath: '.devcodex/data/process-improvements.md',
    fileContent: '## PI-210\npre-tool fixture\n',
    outcome: { success: true },
    eventName: 'PreToolUse'
  })
  if (preToolOnlyWrite.terminal) failures.push('PreToolUse must never count as ledger write evidence')

  const wrongRootPath = path.join(evidenceRoot, 'other', 'data', 'process-improvements.md')
  fs.mkdirSync(path.dirname(wrongRootPath), { recursive: true })
  fs.writeFileSync(wrongRootPath, '## PI-204\nwrong root\n')
  const wrongRootWrite = evaluateObservedWrite({
    id: 'PI-204',
    targetPath: 'other/data/process-improvements.md',
    fileContent: '## PI-OLD\nactive root unchanged\n',
    outcome: { success: true }
  })
  if (wrongRootWrite.terminal) failures.push('wrong-root ledger write must remain unverified')

  const failedWrite = evaluateObservedWrite({
    id: 'PI-205',
    targetPath: '.devcodex/data/process-improvements.md',
    fileContent: '## PI-205\nlanded fixture but tool failed\n',
    outcome: { success: false, error: 'fixture failure' }
  })
  if (failedWrite.terminal) failures.push('failed PostToolUse result must remain unverified')

  const unobservableWrite = evaluateObservedWrite({
    id: 'PI-206',
    targetPath: '.devcodex/data/process-improvements.md',
    fileContent: '## PI-206\nunobservable fixture\n',
    outcome: undefined
  })
  if (unobservableWrite.terminal) failures.push('unobservable tool outcome must remain unverified')

  fs.writeFileSync(path.join(dataRoot, 'process-improvements.md'), '## PI-208\nunobservable attempted write\n')
  let attemptedExistingState = utils.registerGovernanceIntakeCandidate(utils.emptyGovernanceIntakeState(), 'unobservable then already-recorded bypass', {
    createdAt: '2026-07-13T06:51:30.000Z'
  })
  const attemptedExistingWrapper = { governanceIntake: attemptedExistingState }
  utils.observeGovernanceLedgerWrite(attemptedExistingWrapper, {
    hookEventName: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: .devcodex/data/process-improvements.md\n+PI-208\n*** End Patch' }
  }, {
    activeRoot,
    contextRoot: evidenceRoot,
    eventName: 'PostToolUse',
    observedAt: '2026-07-13T06:52:00.000Z'
  })
  utils.updateGovernanceIntakeResolutionState(
    attemptedExistingWrapper,
    writeDecision(attemptedExistingState.candidates[0].id, 'record.process-improvement', 'data/process-improvements.md', 'PI-208', 'already-recorded'),
    'Stop',
    { activeRoot }
  )
  if (attemptedExistingWrapper.governanceIntake.candidates[0].terminal) {
    failures.push('an unverified current-candidate write attempt must not be relabeled already-recorded')
  }

  fs.writeFileSync(path.join(dataRoot, 'process-improvements.md'), '## PI-207\nalready recorded\n')
  let existingState = utils.registerGovernanceIntakeCandidate(utils.emptyGovernanceIntakeState(), 'reuse the exact existing record', {
    createdAt: '2026-07-13T06:52:00.000Z'
  })
  const existingWrapper = { governanceIntake: existingState }
  utils.updateGovernanceIntakeResolutionState(
    existingWrapper,
    writeDecision(existingState.candidates[0].id, 'record.process-improvement', 'data/process-improvements.md', 'PI-207', 'already-recorded'),
    'Stop',
    { activeRoot, contextRoot: evidenceRoot }
  )
  if (!existingWrapper.governanceIntake.candidates[0].terminal) {
    failures.push('already-recorded should verify only when the exact ID exists in the active-root ledger')
  }

  let noneState = utils.registerGovernanceIntakeCandidate(utils.emptyGovernanceIntakeState(), 'ordinary local fact question', {
    createdAt: '2026-07-13T06:53:00.000Z'
  })
  const noneDecision = [
    `候选锚点：${noneState.candidates[0].id}`,
    '评估结论：no-governance-impact',
    '泛化范围：none',
    '现有规范状态：not-applicable',
    '规范化意图：record.none',
    '置信度：高',
    '依据：当前消息只请求读取稳定的项目内事实，不包含流程判断',
    '目标台账：N/A',
    '写入要求：none',
    '写入证据：N/A',
    'skipEvidence：未形成可泛化策略、规范缺口、违规、待办或审计盲区'
  ].join('\n')
  const noneWrapper = { governanceIntake: noneState }
  utils.updateGovernanceIntakeResolutionState(noneWrapper, noneDecision, 'instruction-fallback', { activeRoot })
  if (!noneWrapper.governanceIntake.candidates[0].terminal || noneWrapper.governanceIntake.candidates[0].verificationState !== 'verified-none') {
    failures.push('record.none should terminate only after the full none challenge passes')
  }
  noneState = utils.registerGovernanceIntakeCandidate(utils.emptyGovernanceIntakeState(), 'another ordinary question')
  const weakNoneWrapper = { governanceIntake: noneState }
  utils.updateGovernanceIntakeResolutionState(
    weakNoneWrapper,
    noneDecision.replace(noneWrapper.governanceIntake.candidates[0].id, noneState.candidates[0].id)
      .replace('skipEvidence：未形成可泛化策略、规范缺口、违规、待办或审计盲区', 'skipEvidence：普通问答'),
    'Stop',
    { activeRoot }
  )
  if (weakNoneWrapper.governanceIntake.candidates[0].terminal) failures.push('generic record.none skipEvidence must not terminate a candidate')

  const localNoneState = utils.registerGovernanceIntakeCandidate(utils.emptyGovernanceIntakeState(), 'one project-local preference')
  const localNoneWrapper = { governanceIntake: localNoneState }
  utils.updateGovernanceIntakeResolutionState(
    localNoneWrapper,
    noneDecision.replace(noneWrapper.governanceIntake.candidates[0].id, localNoneState.candidates[0].id)
      .replace('泛化范围：none', '泛化范围：project-local')
      .replace('当前消息只请求读取稳定的项目内事实，不包含流程判断', '当前消息只表达该项目的一次性业务偏好，不改变通用执行规范')
      .replace('未形成可泛化策略、规范缺口、违规、待办或审计盲区', '证据限定于单一业务项目且没有跨项目消费者或通用治理影响'),
    'Stop',
    { activeRoot }
  )
  if (!localNoneWrapper.governanceIntake.candidates[0].terminal) {
    failures.push('evidence-backed project-local record.none should pass the challenge')
  }

  const uncertainState = utils.registerGovernanceIntakeCandidate(utils.emptyGovernanceIntakeState(), 'uncertain governance assessment')
  const uncertainWrapper = { governanceIntake: uncertainState }
  utils.updateGovernanceIntakeResolutionState(
    uncertainWrapper,
    writeDecision(uncertainState.candidates[0].id, 'record.process-improvement', 'data/process-improvements.md', 'PI-207', 'already-recorded')
      .replace('评估结论：accepted', '评估结论：uncertain'),
    'Stop',
    { activeRoot }
  )
  if (uncertainWrapper.governanceIntake.candidates[0].terminal || uncertainWrapper.governanceIntake.candidates[0].phase !== 'assessed') {
    failures.push('uncertain assessment must remain assessed and pending even when an ID exists')
  }

  let compoundWriteState = utils.registerGovernanceIntakeCandidate(utils.emptyGovernanceIntakeState(), 'compound governance result', {
    createdAt: '2026-07-13T06:54:00.000Z'
  })
  const compoundWrapper = { governanceIntake: compoundWriteState }
  const compoundLedgers = [
    ['process-improvements.md', 'PI-211'],
    ['pending-fixes.md', 'PF-212'],
    ['gap-registry.md', 'GR-213']
  ]
  for (const [file, id] of compoundLedgers) {
    fs.writeFileSync(path.join(dataRoot, file), `## ${id}\nverified\n`)
    utils.observeGovernanceLedgerWrite(compoundWrapper, {
      hookEventName: 'PostToolUse',
      tool_name: 'apply_patch',
      tool_input: { input: `*** Begin Patch\n*** Update File: .devcodex/data/${file}\n+${id}\n*** End Patch` },
      tool_response: { success: true }
    }, {
      activeRoot,
      contextRoot: evidenceRoot,
      eventName: 'PostToolUse',
      observedAt: '2026-07-13T06:55:00.000Z'
    })
  }
  const compoundWriteDecision = compound.raw.replace(state.candidates[0].id, compoundWriteState.candidates[0].id)
    .replace('PI-101 + PF-102 + GR-103', 'PI-211 + PF-212 + GR-213')
  utils.updateGovernanceIntakeResolutionState(compoundWrapper, compoundWriteDecision, 'Stop', { activeRoot })
  if (!compoundWrapper.governanceIntake.candidates[0].terminal ||
      compoundWrapper.governanceIntake.candidates[0].intentStates.some(intent => intent.verificationState !== 'verified')) {
    failures.push('compound candidate should terminate only after every ledger intent has verified evidence')
  }
  if (compoundWrapper.governanceIntake.candidates[0].intentStates.some(intent => !intent.observationIds.length || intent.status !== 'verified')) {
    failures.push('compound per-intent states must retain independent observation evidence and status')
  }

  const lifecycleRoot = setupRuntimeTempRoot()
  runRuntime({ hookEventName: 'UserPromptSubmit', prompt: 'keywordless lifecycle evidence fixture' }, lifecycleRoot)
  const lifecycleCandidateId = readRuntimeState(lifecycleRoot).governanceIntake.candidates[0].id
  const lifecycleLedger = path.join(lifecycleRoot, '.devcodex', 'data', 'process-improvements.md')
  fs.mkdirSync(path.dirname(lifecycleLedger), { recursive: true })
  fs.writeFileSync(lifecycleLedger, '## PI-220\nlifecycle verified\n')
  runRuntime({
    hookEventName: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: .devcodex/data/process-improvements.md\n+PI-220\n*** End Patch' },
    tool_response: { success: true }
  }, lifecycleRoot)
  const lifecycleStop = runRuntime({
    hookEventName: 'Stop',
    assistantMessage: `PC0 PC1 PC2 PC3 PC4 PC5 PC6 PC7\n${writeDecision(lifecycleCandidateId, 'record.process-improvement', 'data/process-improvements.md', 'PI-220')}`
  }, lifecycleRoot)
  if (/治理 intake 候选尚未完成语义评估/.test(lifecycleStop.systemMessage || '')) {
    failures.push('lifecycle PostToolUse observation should close a correctly evidenced candidate')
  }
}

const probes = [
  ['instructions.md', 'Improvement Intake（优化清单）'],
  ['instructions.md', '所有模式命中后都必须显式回执'],
  ['instructions/01-common.instructions.md', 'Improvement Intake（优化清单）'],
  ['instructions/01-common.instructions.md', '每条非空用户消息都先登记中性'],
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
  ['hooks/_runtime/lifecycle-governance-intake.cjs', 'GOVERNANCE_INTAKE_STATE_VERSION'],
  ['hooks/_runtime/lifecycle-governance-intake.cjs', 'registerGovernanceIntakeCandidate'],
  ['hooks/_runtime/lifecycle-governance-intake.cjs', 'buildGovernanceIntakeContextMessage'],
  ['hooks/_runtime/lifecycle-governance-intake.cjs', 'parseGovernanceIntakeDecision'],
  ['hooks/_runtime/lifecycle-governance-intake.cjs', 'requiresCoupledRecordRouterEvidence'],
  ['hooks/_runtime/lifecycle-governance-intake.cjs', 'keywords are non-authoritative'],
  ['hooks/_runtime/lifecycle-governance-intake.cjs', '治理 intake 候选尚未完成语义评估'],
  ['hooks/_runtime/lifecycle-visible-reply.cjs', 'buildGovernanceIntakeReminderItem'],
  ['scripts/test-governance-intake.js', 'runGovernanceIntakeBehaviorReplay'],
  ['scripts/test-governance-intake.js', 'every non-empty prompt'],
  ['scripts/test-governance-intake.js', 'CompoundRecordRouterGate'],
  ['scripts/test-governance-intake.js', 'exact candidate anchor'],
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
