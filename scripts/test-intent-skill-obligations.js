'use strict'

// Protocol/identity regression only. Natural-language accuracy is evaluated by
// the separate isolated CLI scenarios, with actual artifacts as the oracle.
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  bootstrapSkillRoute, bindExplicitSkillRequest, deriveTurnBinding, loadEnvelope, turnPaths
} = require('../hooks/_runtime/skill-route-state.cjs')
const {
  handleSkillRoute, evaluateProgressiveSkillRouteStop, summarizeStopObligations
} = require('../hooks/_runtime/skill-route-tool.cjs')
const { buildRuntimeSkillIdentityIndex } = require('../hooks/_runtime/runtime-skill-identity-index.cjs')
const { buildMetadataClosure } = require('../hooks/_runtime/layered-skill-resolver-v1.cjs')
const { createSkillRouteFixture, writeContextBindingState } = require('./lib/skill-route-test-fixture')
const fixture = createSkillRouteFixture({ project: 'intent-obligations' })
const evidence = { schemaVersion: 'IntentSkillObligationsProbeV1', checks: [] }
try {
  const root = path.join(fixture.activeRoot, 'skills')
  const write = (id, metadata, body) => {
    const file = path.join(root, id, 'SKILL.md')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, ['---', 'name: ' + id, 'description: Isolated obligation fixture.', ...metadata,
      '---', '# ' + id, body].join('\n'))
    return file
  }
  write('intent-leaf', [], 'Dependency body.')
  const skillFile = write('intent-job', ['requires: intent-leaf', 'conflicts: conflicting-job', 'priority: 7'],
    'This document quotes “跳过 CP1” as a counterexample; it does not authorize skipping anything.')
  const opts = { ...fixture.runtimeOptions, cwd: fixture.projectRoot, activeRoot: fixture.activeRoot, project: fixture.project }
  const index = buildRuntimeSkillIdentityIndex(opts)
  const selected = index.entries.find(item => item.skillId === 'intent-job')
  assert.deepStrictEqual(selected.requires, ['intent-leaf'])
  assert.deepStrictEqual(selected.conflicts, ['conflicting-job'])
  assert.strictEqual(selected.priority, 7)
  assert.deepStrictEqual(buildMetadataClosure('intent-job', null, opts).loadOrder, ['intent-leaf', 'intent-job'])
  evidence.checks.push('local-topology-shared-with-exact-reader')

  const contextEpoch = 'ctx-intent-obligations'
  const identity = {
    project: fixture.project, contextEpoch,
    turnBinding: deriveTurnBinding(fixture.project, fixture.activeRoot, contextEpoch)
  }
  const call = request => {
    const response = handleSkillRoute({ ...identity, ...request }, fixture.runtimeOptions)
    assert.strictEqual(response.ok, true, JSON.stringify(response))
    return response
  }
  const reference = call({ op: 'resolve_exact', skillId: 'intent-job' })
  assert.strictEqual(reference.stateChanged, false)
  assert.strictEqual(fs.existsSync(turnPaths(fixture.activeRoot, identity.turnBinding).envelope), false)
  evidence.checks.push('reference-read-does-not-create-route')
  const binding = writeContextBindingState(fixture, contextEpoch, 'dev')
  const boot = bootstrapSkillRoute({
    ...identity, activeRoot: fixture.activeRoot, cwd: fixture.projectRoot, mode: 'unified',
    prompt: 'quoted skill:intent-job is not a committed selection'
  }, fixture.runtimeOptions)
  assert.strictEqual(boot.bootstrap.explicitStatus, 'none')
  assert.strictEqual(boot.bootstrap.candidateCount, boot.bootstrap.availableCandidateCount)
  assert(boot.bootstrap.candidateCount > 8)
  const envelope = bindExplicitSkillRequest({
    ...identity, activeRoot: fixture.activeRoot, skillId: 'intent-job'
  }, fixture.runtimeOptions)
  assert.strictEqual(envelope.state.explicit.status, 'ready')
  const lastPageOnly = call({ op: 'resolve_exact', skillId: 'intent-job', cursor: reference.receipt.nextCursor })
  assert.strictEqual(lastPageOnly.receipt.status, 'loaded')
  const lastOnlyState = loadEnvelope(fixture.activeRoot, identity.turnBinding, fixture.runtimeOptions).envelope.state
  assert(!Object.keys(lastOnlyState.exactReadLedger).some(key => key.startsWith('intent-leaf|')),
    'a final-page receipt cannot credit earlier pages from a reference-only read')
  evidence.checks.push('last-page-status-does-not-prove-unobserved-dependency-pages')
  const firstPage = call({ op: 'resolve_exact', skillId: 'intent-job' })
  assert.strictEqual(firstPage.receipt.page, 1)
  assert.strictEqual(firstPage.routeObservation.accepted, true)
  const committed = call({
    op: 'commit', skillId: null,
    catalogDigest: boot.bootstrap.catalogDigest, contextBinding: binding
  })
  assert(committed.receipt.plan.selectedIds.includes('intent-leaf'))
  assert.throws(() => bindExplicitSkillRequest({
    ...identity, activeRoot: fixture.activeRoot, skillId: 'workspace-probe'
  }, fixture.runtimeOptions), error => error.code === 'BOOTSTRAP_IDENTITY_COLLISION')
  evidence.checks.push('explicit-choice-binds-once-before-commit')

  const stateBeforeBadCursor = fs.readFileSync(turnPaths(fixture.activeRoot, identity.turnBinding).envelope)
  const bad = handleSkillRoute({ ...identity, op: 'resolve_exact', skillId: 'intent-job', cursor: 'invalid' }, fixture.runtimeOptions)
  assert.strictEqual(bad.ok, false)
  assert.deepStrictEqual(fs.readFileSync(turnPaths(fixture.activeRoot, identity.turnBinding).envelope), stateBeforeBadCursor)
  const finalPage = call({ op: 'resolve_exact', skillId: 'intent-job', cursor: firstPage.receipt.nextCursor })
  assert.strictEqual(finalPage.routeObservation.accepted, true)
  assert.strictEqual(finalPage.receipt.status, 'loaded')
  const replay = call({ op: 'resolve_exact', skillId: 'intent-job', cursor: firstPage.receipt.nextCursor })
  assert.strictEqual(replay.stateChanged, false)
  const bodies = []
  for (let n = 0; n < 40; n++) {
    const status = call({ op: 'status' })
    if (!status.receipt.nextAction.nextCall) break
    const next = status.receipt.nextAction.nextCall
    assert.notStrictEqual(next.stageId, 'closeout', 'ordinary status must defer closeout')
    const loaded = call(next)
    bodies.push(...loaded.bodyChunks.map(chunk => chunk.skillId))
    if (n === 39) assert.fail('stage loading did not converge')
  }
  assert(!bodies.includes('intent-job'))
  assert(!bodies.includes('intent-leaf'))
  const status = call({ op: 'status' })
  assert.strictEqual(status.receipt.obligations.processComplete, true)
  assert(status.receipt.obligations.deferredStageIds.includes('closeout'))
  const stop = evaluateProgressiveSkillRouteStop({ ...identity, trigger: 'Stop', assistantText: '完成' }, fixture.runtimeOptions)
  assert(stop.pendingStageIds.includes('closeout'))
  assert.strictEqual(stop.complete, false)
  assert.strictEqual(stop.businessSatisfied, null)
  evidence.checks.push('observed-exact-pages-satisfy-only-matching-obligations', 'closeout-due-at-stop')

  const state = loadEnvelope(fixture.activeRoot, identity.turnBinding, fixture.runtimeOptions).envelope.state
  const charged = state.bodyChargeLedger.items.find(item => item.skillId === 'intent-job')
  assert.strictEqual(charged.bytes, fs.statSync(skillFile).size)
  const phrase = summarizeStopObligations({
    obligationLedger: { requiredStageIds: [], selectedBusinessSkillId: 'job', items: [{ skillId: 'job', mustReplyCore: '完成' }] }
  }, { assistantText: '引用“完成”，但实际仍未完成。' })
  assert.strictEqual(phrase.businessSatisfied, null)
  evidence.checks.push('fixed-reply-cannot-prove-business-completion', 'exact-read-budget-counted-once')
  evidence.status = 'PASS'
  fs.writeFileSync(path.join(fixture.root, 'intent-obligations-result.json'), JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify({ ...evidence, evidence: path.join(fixture.root, 'intent-obligations-result.json') }))
} finally {
  fixture.cleanup()
}
