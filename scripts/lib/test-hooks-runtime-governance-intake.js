'use strict'

function runHooksRuntimeGovernanceIntakeScenarios(context) {
  const {
    assert,
    fs,
    path,
    TEMP_ROOT,
    STATE_FILE,
    cleanState,
    run
  } = context

  function readState() {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  }

  function writeDecision(candidateId, intents, ledgers, ids, writeRequirement = 'required') {
    return [
      `候选锚点：${candidateId}`,
      '评估结论：accepted',
      '泛化范围：devcodex-control-plane',
      '现有规范状态：partial',
      `规范化意图：${intents}`,
      '置信度：高',
      '依据：当前上下文与落盘代码事实共同证明需要记录治理结果',
      `目标台账：${ledgers}`,
      `写入要求：${writeRequirement}`,
      `写入证据：${ids}`,
      'skipEvidence：N/A；存在实质治理记录'
    ].join('\n')
  }

  function noneDecision(candidateId) {
    return [
      `候选锚点：${candidateId}`,
      '评估结论：no-governance-impact',
      '泛化范围：none',
      '现有规范状态：not-applicable',
      '规范化意图：record.none',
      '置信度：高',
      '依据：当前消息只要求读取稳定项目事实，没有提出流程或规范判断',
      '目标台账：N/A',
      '写入要求：none',
      '写入证据：N/A',
      'skipEvidence：没有形成可泛化策略、规范缺口、违规、待办或审计盲区'
    ].join('\n')
  }

  function runPostToolLedger(file, id, response) {
    const payload = {
      hookEventName: 'PostToolUse',
      tool_name: 'apply_patch',
      tool_input: {
        input: `*** Begin Patch\n*** Update File: .devcodex/data/${file}\n+${id}\n*** End Patch`
      }
    }
    if (response !== undefined) payload.tool_response = response
    return run(payload)
  }

  cleanState()
  const firstPrompt = run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Compare two local implementations without using governance words.'
  })
  assert.match(JSON.stringify(firstPrompt), /Neutral candidate anchors/)
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Compare two local implementations without using governance words.'
  })
  let state = readState()
  assert.strictEqual(state.governanceIntake.candidates.length, 1)
  assert.strictEqual(state.governanceIntake.candidates[0].seenCount, 2)
  run({ hookEventName: 'UserPromptSubmit', prompt: 'A second ordinary message needs its own assessment.' })
  state = readState()
  assert.strictEqual(state.governanceIntake.candidates.length, 2)
  const missingAnchorStop = run({
    hookEventName: 'Stop',
    assistantMessage: `PC0 上下文：fixture\n${noneDecision('current-user-message').replace('候选锚点：current-user-message\n', '')}`
  })
  assert.match(missingAnchorStop.systemMessage || '', /multiple unresolved candidates require an exact candidate anchor/)

  cleanState()
  run({ hookEventName: 'UserPromptSubmit', prompt: 'Read one stable local fact.' })
  let candidateId = readState().governanceIntake.candidates[0].id
  const noneStop = run({
    hookEventName: 'Stop',
    assistantMessage: `PC0 上下文：fixture\n${noneDecision(candidateId)}`
  })
  assert.doesNotMatch(noneStop.systemMessage || '', /治理 intake 候选/)
  state = readState()
  assert.strictEqual(state.governanceIntake.candidates[0].verificationState, 'verified-none')
  assert.strictEqual(state.governanceIntake.candidates[0].terminal, true)

  cleanState()
  run({ hookEventName: 'UserPromptSubmit', prompt: 'A compound semantic finding needs three independent records.' })
  candidateId = readState().governanceIntake.candidates[0].id
  const dataRoot = path.join(TEMP_ROOT, '.devcodex', 'data')
  fs.mkdirSync(dataRoot, { recursive: true })
  const compoundLedgers = [
    ['process-improvements.md', 'PI-301'],
    ['pending-fixes.md', 'PF-302'],
    ['gap-registry.md', 'GR-303']
  ]
  for (const [file, id] of compoundLedgers) {
    fs.writeFileSync(path.join(dataRoot, file), `## ${id}\nverified\n`)
    runPostToolLedger(file, id, { success: true })
  }
  const compoundStop = run({
    hookEventName: 'Stop',
    assistantMessage: [
      'PC0 上下文：fixture',
      writeDecision(
        candidateId,
        'record.process-improvement + record.spec-defect + record.audit-gap',
        'data/process-improvements.md + data/pending-fixes.md + data/gap-registry.md',
        'PI-301 + PF-302 + GR-303'
      )
    ].join('\n')
  })
  assert.doesNotMatch(compoundStop.systemMessage || '', /治理 intake 候选/)
  state = readState()
  assert.strictEqual(state.governanceIntake.candidates[0].terminal, true)
  assert.ok(state.governanceIntake.candidates[0].intentStates.every(item => item.verificationState === 'verified'))
  assert.deepStrictEqual(
    state.governanceIntake.candidates[0].phaseHistory.map(entry => entry.phase),
    ['detected', 'assessed', 'generalized', 'routed', 'write-observed', 'acknowledged']
  )
  assert.ok(state.governanceIntake.candidates[0].intentStates.every(item => item.status === 'verified' && item.observationIds.length === 1))

  cleanState()
  run({ hookEventName: 'UserPromptSubmit', prompt: 'Wrong-root evidence must remain unresolved.' })
  candidateId = readState().governanceIntake.candidates[0].id
  const wrongRootLedger = path.join(TEMP_ROOT, 'other', 'data', 'pending-fixes.md')
  fs.mkdirSync(path.dirname(wrongRootLedger), { recursive: true })
  fs.writeFileSync(wrongRootLedger, '## PF-304\nwrong root\n')
  run({
    hookEventName: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: other/data/pending-fixes.md\n+PF-304\n*** End Patch' },
    tool_response: { success: true }
  })
  const wrongRootStop = run({
    hookEventName: 'Stop',
    assistantMessage: `PC0 上下文：fixture\n${writeDecision(candidateId, 'record.spec-defect', 'data/pending-fixes.md', 'PF-304')}`
  })
  assert.match(wrongRootStop.systemMessage || '', /no successful exact active-root PostToolUse observation/)
  assert.strictEqual(readState().governanceIntake.candidates[0].terminal, false)

  cleanState()
  run({ hookEventName: 'UserPromptSubmit', prompt: 'Unobservable evidence must remain unresolved.' })
  candidateId = readState().governanceIntake.candidates[0].id
  fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'data'), { recursive: true })
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'data', 'process-improvements.md'), '## PI-305\nunobservable\n')
  runPostToolLedger('process-improvements.md', 'PI-305', undefined)
  const unobservableStop = run({
    hookEventName: 'Stop',
    assistantMessage: `PC0 上下文：fixture\n${writeDecision(candidateId, 'record.process-improvement', 'data/process-improvements.md', 'PI-305')}`
  })
  assert.match(unobservableStop.systemMessage || '', /no successful exact active-root PostToolUse observation/)
  assert.strictEqual(readState().governanceIntake.candidates[0].verificationState, 'unverified')

  cleanState()
}

module.exports = {
  runHooksRuntimeGovernanceIntakeScenarios
}
