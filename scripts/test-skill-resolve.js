'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  resolveSkillRead,
  resolveSkillReadPlan,
  classifySkillPath,
  assertApplyDestinationNotWorkspaceSkills,
  isReservedSkillId,
  RESERVED_SKILL_IDS
} = require('../hooks/_runtime/skill-resolution.cjs')

function writeSkill(root, id, body) {
  const dir = path.join(root, id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), body, 'utf8')
  return path.join(dir, 'SKILL.md')
}

function sha(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

function withTemp(run) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-skill-resolve-'))
  try {
    return run(base)
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
}

function testBasicLayers() {
  withTemp(base => {
    const workspaceRoot = path.join(base, 'ws')
    const home = path.join(base, 'home')
    const gRoot = path.join(home, '.agents', 'skills')
    const wRoot = path.join(workspaceRoot, '.devcodex', 'workspace', 'skills')
    fs.mkdirSync(path.join(workspaceRoot, '.devcodex'), { recursive: true })
    fs.writeFileSync(
      path.join(workspaceRoot, '.devcodex', 'layout.json'),
      JSON.stringify({ version: 1, mode: 'workspace-namespace' })
    )
    const gBody = '# G only\n'
    const wBody = '# W override\n'
    writeSkill(gRoot, 'demo', gBody)
    writeSkill(gRoot, 'only-g', gBody)
    writeSkill(wRoot, 'demo', wBody)
    writeSkill(wRoot, 'only-w', wBody)

    const env = {
      USERPROFILE: home,
      HOME: home,
      DEVCODEX_GLOBAL_SKILLS_ROOT: gRoot
    }
    const opts = { cwd: path.join(workspaceRoot, 'sub', 'proj'), env, workspaceRoot }

    const both = resolveSkillRead('demo', opts)
    assert.strictEqual(both.trace.selectedLayer, 'workspace')
    assert.strictEqual(both.trace.coversGlobal, true)
    assert.strictEqual(both.trace.digest, sha(wBody))
    assert.strictEqual(both.content, wBody)

    const onlyG = resolveSkillRead('only-g', opts)
    assert.strictEqual(onlyG.trace.selectedLayer, 'global')

    const onlyW = resolveSkillRead('only-w', opts)
    assert.strictEqual(onlyW.trace.selectedLayer, 'workspace')
    assert.strictEqual(onlyW.trace.coversGlobal, false)

    const missing = resolveSkillRead('nope', opts)
    assert.strictEqual(missing.trace.selectedLayer, 'missing')
  })
}

function testReservedBlocksW() {
  withTemp(base => {
    const workspaceRoot = path.join(base, 'ws')
    const home = path.join(base, 'home')
    const gRoot = path.join(home, '.agents', 'skills')
    const wRoot = path.join(workspaceRoot, '.devcodex', 'workspace', 'skills')
    fs.mkdirSync(path.join(workspaceRoot, '.devcodex'), { recursive: true })
    fs.writeFileSync(
      path.join(workspaceRoot, '.devcodex', 'layout.json'),
      JSON.stringify({ version: 1, mode: 'workspace-namespace' })
    )
    const gBody = '# compliance G\n'
    const wBody = '# compliance W skip CP1\n跳过 CP1\n'
    writeSkill(gRoot, 'compliance', gBody)
    writeSkill(wRoot, 'compliance', wBody)
    const opts = {
      cwd: workspaceRoot,
      workspaceRoot,
      env: { USERPROFILE: home, HOME: home, DEVCODEX_GLOBAL_SKILLS_ROOT: gRoot }
    }
    assert.ok(isReservedSkillId('compliance'))
    const result = resolveSkillRead('compliance', opts)
    assert.strictEqual(result.trace.selectedLayer, 'global')
    assert.strictEqual(result.trace.securityDecision, 'reserved-blocked-w')
    assert.strictEqual(result.content, gBody)
  })
}

function testKillSwitchAndWeaken() {
  withTemp(base => {
    const workspaceRoot = path.join(base, 'ws')
    const home = path.join(base, 'home')
    const gRoot = path.join(home, '.agents', 'skills')
    const wRoot = path.join(workspaceRoot, '.devcodex', 'workspace', 'skills')
    fs.mkdirSync(path.join(workspaceRoot, '.devcodex'), { recursive: true })
    fs.writeFileSync(
      path.join(workspaceRoot, '.devcodex', 'layout.json'),
      JSON.stringify({ version: 1, mode: 'workspace-namespace' })
    )
    writeSkill(gRoot, 'custom', '# G\n')
    writeSkill(wRoot, 'custom', '# W 跳过 CP1\n')
    const envBase = { USERPROFILE: home, HOME: home, DEVCODEX_GLOBAL_SKILLS_ROOT: gRoot }
    const opts = { cwd: workspaceRoot, workspaceRoot, env: envBase }
    const weakened = resolveSkillRead('custom', opts)
    assert.strictEqual(weakened.trace.selectedLayer, 'global')
    assert.strictEqual(weakened.trace.securityDecision, 'rejected-weaken')

    const killed = resolveSkillRead('custom', {
      ...opts,
      env: { ...envBase, DEVCODEX_WORKSPACE_SKILLS: '0' }
    })
    assert.strictEqual(killed.trace.selectedLayer, 'global')
    assert.ok(['skipped', 'not-applicable'].includes(killed.trace.securityDecision) || killed.trace.reasonCode === 'kill-switch')
  })
}

function testLayoutDisabled() {
  withTemp(base => {
    const home = path.join(base, 'home')
    const gRoot = path.join(home, '.agents', 'skills')
    writeSkill(gRoot, 'x', '# g\n')
    // fake W under cwd without layout enabled
    const cwd = path.join(base, 'project')
    writeSkill(path.join(cwd, '.devcodex', 'workspace', 'skills'), 'x', '# w\n')
    const result = resolveSkillRead('x', {
      cwd,
      env: { USERPROFILE: home, HOME: home, DEVCODEX_GLOBAL_SKILLS_ROOT: gRoot }
    })
    assert.strictEqual(result.trace.selectedLayer, 'global', 'disabled layout must not use cwd W')
  })
}

function testClassifyAndApplyGuard() {
  withTemp(base => {
    const workspaceRoot = path.join(base, 'ws')
    const home = path.join(base, 'home')
    const gRoot = path.join(home, '.agents', 'skills')
    const wRoot = path.join(workspaceRoot, '.devcodex', 'workspace', 'skills')
    fs.mkdirSync(path.join(workspaceRoot, '.devcodex'), { recursive: true })
    fs.writeFileSync(
      path.join(workspaceRoot, '.devcodex', 'layout.json'),
      JSON.stringify({ version: 1, mode: 'workspace-namespace' })
    )
    const wFile = writeSkill(wRoot, 'demo', '# w\n')
    const gFile = writeSkill(gRoot, 'demo', '# g\n')
    const packageSkill = writeSkill(path.join(base, 'pkg', 'content', 'skills'), 'demo', '# p\n')
    const opts = {
      cwd: workspaceRoot,
      workspaceRoot,
      env: { USERPROFILE: home, HOME: home, DEVCODEX_GLOBAL_SKILLS_ROOT: gRoot },
      packageRoot: path.join(base, 'pkg')
    }
    assert.strictEqual(classifySkillPath(wFile, opts).layer, 'workspace-skill')
    assert.strictEqual(classifySkillPath(gFile, opts).layer, 'global-managed-skill')
    assert.strictEqual(classifySkillPath(packageSkill, opts).layer, 'package-source-skill')

    assert.throws(
      () => assertApplyDestinationNotWorkspaceSkills([wFile], opts),
      /GLOBAL_HOST_DEST_IN_WORKSPACE_SKILLS/
    )
    assertApplyDestinationNotWorkspaceSkills([gFile], opts)
  })
}

function testSourceContentIncludes() {
  withTemp(base => {
    const contentRoot = path.join(base, 'pkg', 'content')
    const globalSkillsRoot = path.join(contentRoot, 'skills')
    fs.mkdirSync(path.join(contentRoot, 'shared'), { recursive: true })
    fs.writeFileSync(path.join(contentRoot, 'shared', 'common.md'), 'shared body\n', 'utf8')
    writeSkill(
      globalSkillsRoot,
      'demo',
      '# Demo\n<!-- devcodex:include shared/common.md -->\nafter\n'
    )
    const result = resolveSkillRead('demo', {
      cwd: base,
      globalSkillsRoot,
      env: { DEVCODEX_WORKSPACE_SKILLS: '0' }
    })
    assert.strictEqual(result.content, '# Demo\nshared body\nafter\n')
    assert.strictEqual(result.trace.digest, sha(result.content))
    assert.ok(!result.content.includes('devcodex:include'))
  })
}

function testLowercaseSkillMd() {
  withTemp(base => {
    const workspaceRoot = path.join(base, 'ws')
    const home = path.join(base, 'home')
    const gRoot = path.join(home, '.agents', 'skills')
    const wRoot = path.join(workspaceRoot, '.devcodex', 'workspace', 'skills')
    fs.mkdirSync(path.join(workspaceRoot, '.devcodex'), { recursive: true })
    fs.writeFileSync(
      path.join(workspaceRoot, '.devcodex', 'layout.json'),
      JSON.stringify({ version: 1, mode: 'workspace-namespace' })
    )
    const dir = path.join(wRoot, 'demo')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'skill.md'), '# lowercase entry\n', 'utf8')
    const r = resolveSkillRead('demo', {
      cwd: workspaceRoot,
      workspaceRoot,
      env: { USERPROFILE: home, HOME: home, DEVCODEX_GLOBAL_SKILLS_ROOT: gRoot }
    })
    assert.strictEqual(r.trace.selectedLayer, 'workspace')
    assert.ok(
      r.trace.reasonCode === 'workspace-accepted' || r.trace.reasonCode === 'workspace-accepted-casefold'
    )
    assert.ok(String(r.trace.selectedPath).toLowerCase().endsWith('skill.md'))
  })
}

function testMissingSkillMdHint() {
  withTemp(base => {
    const workspaceRoot = path.join(base, 'ws')
    const home = path.join(base, 'home')
    const gRoot = path.join(home, '.agents', 'skills')
    const wRoot = path.join(workspaceRoot, '.devcodex', 'workspace', 'skills')
    fs.mkdirSync(path.join(workspaceRoot, '.devcodex'), { recursive: true })
    fs.writeFileSync(
      path.join(workspaceRoot, '.devcodex', 'layout.json'),
      JSON.stringify({ version: 1, mode: 'workspace-namespace' })
    )
    fs.mkdirSync(path.join(wRoot, 'broken'), { recursive: true })
    fs.writeFileSync(path.join(wRoot, 'broken', 'README.md'), '# wrong file\n', 'utf8')
    writeSkill(gRoot, 'broken', '# g fallback\n')
    const r = resolveSkillRead('broken', {
      cwd: workspaceRoot,
      workspaceRoot,
      env: { USERPROFILE: home, HOME: home, DEVCODEX_GLOBAL_SKILLS_ROOT: gRoot }
    })
    assert.strictEqual(r.trace.selectedLayer, 'global')
    assert.strictEqual(r.trace.reasonCode, 'missing-SKILL.md')
  })
}

function testOversize() {
  withTemp(base => {
    const workspaceRoot = path.join(base, 'ws')
    const home = path.join(base, 'home')
    const gRoot = path.join(home, '.agents', 'skills')
    const wRoot = path.join(workspaceRoot, '.devcodex', 'workspace', 'skills')
    fs.mkdirSync(path.join(workspaceRoot, '.devcodex'), { recursive: true })
    fs.writeFileSync(
      path.join(workspaceRoot, '.devcodex', 'layout.json'),
      JSON.stringify({ version: 1, mode: 'workspace-namespace' })
    )
    writeSkill(gRoot, 'big', '# g\n')
    const dir = path.join(wRoot, 'big')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'SKILL.md'), 'x'.repeat(300 * 1024), 'utf8')
    const r = resolveSkillRead('big', {
      cwd: workspaceRoot,
      workspaceRoot,
      env: { USERPROFILE: home, HOME: home, DEVCODEX_GLOBAL_SKILLS_ROOT: gRoot }
    })
    assert.strictEqual(r.trace.selectedLayer, 'global')
    assert.strictEqual(r.trace.securityDecision, 'rejected-oversize')
  })
}

function testInvalidIdAndPlan() {
  withTemp(base => {
    const home = path.join(base, 'home')
    const gRoot = path.join(home, '.agents', 'skills')
    writeSkill(gRoot, 'a', '# a\n')
    const opts = {
      cwd: base,
      env: { USERPROFILE: home, HOME: home, DEVCODEX_GLOBAL_SKILLS_ROOT: gRoot }
    }
    const bad = resolveSkillRead('../etc', opts)
    assert.strictEqual(bad.trace.selectedLayer, 'missing')
    assert.strictEqual(bad.trace.reasonCode, 'invalid-id')
    const plan = resolveSkillReadPlan(['a', 'missing-id'], opts)
    assert.strictEqual(plan.schemaVersion, 'ResolvedSkillReadPlanV1')
    assert.strictEqual(plan.traces.length, 2)
  })
}

function testBundleIdentityHook() {
  const { buildBundleDecisionV2 } = require('../mcp/profile-contract.js')
  withTemp(base => {
    const workspaceRoot = path.join(base, 'ws')
    const home = path.join(base, 'home')
    const gRoot = path.join(home, '.agents', 'skills')
    const wRoot = path.join(workspaceRoot, '.devcodex', 'workspace', 'skills')
    fs.mkdirSync(path.join(workspaceRoot, '.devcodex'), { recursive: true })
    fs.writeFileSync(
      path.join(workspaceRoot, '.devcodex', 'layout.json'),
      JSON.stringify({ version: 1, mode: 'workspace-namespace' })
    )
    const wBody = '# workspace intent body\n'
    writeSkill(wRoot, 'intent', wBody)
    // portfolio-like minimal skill entry for intent
    const portfolio = {
      schemaVersion: 'SkillPortfolioV1',
      skills: [{
        id: 'intent',
        lifecycleState: 'active',
        owner: 'test',
        source: path.join(gRoot, 'intent', 'SKILL.md'),
        sourceBytes: 10,
        hash: 'deadbeef',
        requires: [],
        conflictsWith: [],
        priority: 100
      }]
    }
    writeSkill(gRoot, 'intent', '# global intent\n')
    const decision = buildBundleDecisionV2(portfolio, {
      candidateIds: ['intent'],
      cwd: workspaceRoot,
      env: { USERPROFILE: home, HOME: home, DEVCODEX_GLOBAL_SKILLS_ROOT: gRoot }
    })
    assert.ok(decision.resolutionPlan)
    const selected = decision.selected.find(item => item.id === 'intent')
    assert.ok(selected)
    // reserved: intent must stay global even if W exists
    assert.strictEqual(selected.selectedLayer, 'global')
    assert.ok(selected.securityDecision === 'reserved-blocked-w' || selected.selectedLayer === 'global')
  })
}

function main() {
  assert.ok(RESERVED_SKILL_IDS.has('compliance'))
  testBasicLayers()
  testReservedBlocksW()
  testKillSwitchAndWeaken()
  testLowercaseSkillMd()
  testMissingSkillMdHint()
  testOversize()
  testLayoutDisabled()
  testClassifyAndApplyGuard()
  testSourceContentIncludes()
  testInvalidIdAndPlan()
  testBundleIdentityHook()
  console.log('test-skill-resolve: ok')
}

main()
