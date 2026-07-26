'use strict'

/**
 * WorkspaceSkillAutoMatch probes (PF-213 / P0.5 closed loop).
 */

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  matchWorkspaceSkills,
  isSkillReplySatisfied,
  buildStopForceReason,
  listWorkspaceSkillCandidates,
  scoreCandidate,
  toStateRecord,
  extractMustReply
} = require('../hooks/_runtime/workspace-skill-auto-match.cjs')

const {
  adaptHostOutput
} = require('../hooks/_runtime/lifecycle-host-adapters.cjs')

function writeSkill(root, id, body) {
  const dir = path.join(root, id)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'SKILL.md')
  fs.writeFileSync(file, body, 'utf8')
  return file
}

function withFixture(run) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-auto-match-'))
  try {
    const workspaceRoot = path.join(base, 'ws')
    const home = path.join(base, 'home')
    const gRoot = path.join(home, '.agents', 'skills')
    const wRoot = path.join(workspaceRoot, '.devcodex', 'workspace', 'skills')
    fs.mkdirSync(path.join(workspaceRoot, '.devcodex'), { recursive: true })
    fs.writeFileSync(
      path.join(workspaceRoot, '.devcodex', 'layout.json'),
      JSON.stringify({ version: 1, mode: 'workspace-namespace' })
    )
    const testBody = [
      '---',
      'name: test',
      'description: |',
      '  当用户发送「test」「测试」或明确要求用 workspace skill test 时使用。',
      '  不要当成连通性测试或 @rocky 闲聊；必须按本 skill 固定话术回复。',
      '---',
      '',
      '# test skill',
      '',
      '## 必须回复（仅此，不要发挥）',
      '小朋友真可爱',
      ''
    ].join('\n')
    writeSkill(wRoot, 'test', testBody)
    writeSkill(wRoot, 'other-demo', [
      '---',
      'name: other-demo',
      'description: "when user says exact-other-phrase"',
      '---',
      '# other',
      'do something else',
      ''
    ].join('\n'))
    // reserved should never auto-match even if present in W
    writeSkill(wRoot, 'compliance', '---\nname: compliance\ndescription: "compliance override"\n---\n# bad\n')

    const env = {
      USERPROFILE: home,
      HOME: home,
      DEVCODEX_GLOBAL_SKILLS_ROOT: gRoot
    }
    const opts = { cwd: workspaceRoot, workspaceRoot, env }
    return run({ base, workspaceRoot, wRoot, opts, testBody })
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
}

function testMatchTriggers() {
  withFixture(({ opts }) => {
    const hit = matchWorkspaceSkills('test', opts)
    assert.strictEqual(hit.matched, true, 'exact test must match')
    assert.strictEqual(hit.skillId, 'test')
    assert.strictEqual(hit.selectedLayer, 'workspace')
    assert.ok(hit.score >= 90)
    assert.ok(hit.injectionText.includes('小朋友真可爱'))
    assert.ok(hit.injectionText.includes('WorkspaceSkillAutoMatch'))
    assert.strictEqual(hit.mustReply, '小朋友真可爱')

    const hitZh = matchWorkspaceSkills('测试', opts)
    assert.strictEqual(hitZh.matched, true, 'quoted 测试 trigger')
    assert.strictEqual(hitZh.skillId, 'test')

    const hitRocky = matchWorkspaceSkills('@rocky test', opts)
    assert.strictEqual(hitRocky.matched, true)

    const miss = matchWorkspaceSkills('帮我审查 monSQLize 的缓存策略', opts)
    assert.strictEqual(miss.matched, false)

    const compliance = matchWorkspaceSkills('compliance', opts)
    assert.strictEqual(compliance.matched, false, 'reserved never auto-matches from W list')

    const alone = matchWorkspaceSkills('exact-other-phrase', opts)
    assert.strictEqual(alone.matched, true)
    assert.strictEqual(alone.skillId, 'other-demo')
  })
}

function testSatisfactionAndStopReason() {
  withFixture(({ opts }) => {
    const hit = matchWorkspaceSkills('test', opts)
    assert.strictEqual(isSkillReplySatisfied('小朋友真可爱', hit), true)
    assert.strictEqual(isSkillReplySatisfied('Ready - systems are up', hit), false)
    assert.strictEqual(isSkillReplySatisfied('在的', hit), false)
    const reason = buildStopForceReason(hit)
    assert.ok(reason.includes('WorkspaceSkillAutoMatch'))
    assert.ok(reason.includes('小朋友真可爱'))
    const state = toStateRecord(hit)
    assert.strictEqual(state.skillId, 'test')
    assert.ok(state.injectionText.length > 20)
  })
}

function testGrokStopAdapterHonorsBlock() {
  const blocked = adaptHostOutput('grok', 'stop', {
    decision: 'block',
    reason: 'DevCodex WorkspaceSkillAutoMatch: follow skill test'
  })
  assert.strictEqual(blocked.decision, 'block')
  assert.ok(String(blocked.reason).includes('WorkspaceSkillAutoMatch'))
  assert.strictEqual(blocked.devcodexGrokEvidenceMode, 'stop-decision-block')

  const passiveUps = adaptHostOutput('grok', 'UserPromptSubmit', {
    decision: 'block',
    reason: 'should-not-block',
    hookSpecificOutput: { additionalContext: 'inject-attempt' }
  })
  assert.strictEqual(passiveUps.continue, true)
  assert.strictEqual(Object.prototype.hasOwnProperty.call(passiveUps, 'decision'), false)
  assert.strictEqual(passiveUps.devcodexGrokEvidenceMode, 'passive-hook-no-context-injection')
}

function testExtractMustReply() {
  const body = '## 必须回复（仅此）\n小朋友真可爱\n\n## 其他\nx\n'
  assert.strictEqual(extractMustReply(body), '小朋友真可爱')
}

function testListCandidates() {
  withFixture(({ opts }) => {
    const list = listWorkspaceSkillCandidates(opts)
    const ids = list.map(c => c.skillId).sort()
    assert.deepStrictEqual(ids, ['other-demo', 'test'])
    const scored = scoreCandidate('test', list.find(c => c.skillId === 'test'))
    assert.ok(scored.score >= 90)
  })
}

function testLiveWorkspaceIfPresent() {
  const root = path.resolve(__dirname, '..', '..')
  // When running from package root E:\Worker\devcodex-v1, workspace is E:\Worker
  const workspaceRoot = path.resolve(__dirname, '..', '..')
  const skillPath = path.join(workspaceRoot, '.devcodex', 'workspace', 'skills', 'test')
  if (!fs.existsSync(skillPath)) {
    console.log('  skip live workspace skill (no .devcodex/workspace/skills/test)')
    return
  }
  const hit = matchWorkspaceSkills('test', { cwd: workspaceRoot, workspaceRoot })
  if (!hit.matched) {
    // layout may not be workspace-namespace from this path — try E:\Worker explicitly
    const alt = path.resolve('E:/Worker')
    if (fs.existsSync(path.join(alt, '.devcodex', 'layout.json'))) {
      const hit2 = matchWorkspaceSkills('test', { cwd: alt, workspaceRoot: alt })
      assert.strictEqual(hit2.matched, true, 'live workspace test skill must match')
      assert.ok(hit2.mustReply.includes('小朋友') || hit2.content.includes('小朋友真可爱'))
      return
    }
  }
  if (hit.matched) {
    assert.ok(hit.content.includes('小朋友真可爱') || hit.mustReply.includes('小朋友'))
  }
}

/**
 * C1.1: short/ambiguous skill ids must not fire from long task sentences.
 */
function testC11MisTriggerClosed() {
  withFixture(({ opts }) => {
    const longEn = matchWorkspaceSkills('please test the api', opts)
    assert.strictEqual(longEn.matched, false, 'long EN sentence with test token must not match')
    const longZh = matchWorkspaceSkills('单元测试 test 覆盖', opts)
    assert.strictEqual(longZh.matched, false, 'long CN sentence with test token must not match')
    const safeLong = matchWorkspaceSkills('帮我审查 monSQLize 的缓存策略', opts)
    assert.strictEqual(safeLong.matched, false, 'unrelated long task must not match')

    // Positive short triggers still work
    assert.strictEqual(matchWorkspaceSkills('test', opts).matched, true)
    assert.strictEqual(matchWorkspaceSkills('测试', opts).matched, true)
    assert.strictEqual(matchWorkspaceSkills('@rocky test', opts).matched, true)
    assert.strictEqual(matchWorkspaceSkills('用 test skill', opts).matched, true)
  })
}

function main() {
  testMatchTriggers()
  testSatisfactionAndStopReason()
  testGrokStopAdapterHonorsBlock()
  testExtractMustReply()
  testListCandidates()
  testLiveWorkspaceIfPresent()
  testC11MisTriggerClosed()
  console.log('test-workspace-skill-auto-match: ok')
}

main()
