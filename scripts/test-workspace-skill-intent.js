'use strict'

/**
 * Unit tests: DEVCODEX.md entry + catalog + intent route (P0-1 Batch 1).
 */

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  resolveDevcodexMdPath,
  readDevcodexMdEntry,
  ensureDevcodexMdTemplate,
  parseAlwaysOn
} = require('../hooks/_runtime/devcodex-md-entry.cjs')

const {
  buildWorkspaceSkillCatalog
} = require('../hooks/_runtime/workspace-skill-catalog.cjs')

const {
  selectSkillByIntent,
  routeWorkspaceSkillIntent,
  getSkillMatchMode,
  AUTHOR_SKILL_ID
} = require('../hooks/_runtime/workspace-skill-intent.cjs')

function writeSkill(root, id, body) {
  const dir = path.join(root, id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), body, 'utf8')
}

function withFixture(run) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-intent-'))
  try {
    const workspaceRoot = path.join(base, 'ws')
    const home = path.join(base, 'home')
    const gRoot = path.join(home, '.agents', 'skills')
    const wRoot = path.join(workspaceRoot, '.devcodex', 'workspace', 'skills')
    fs.mkdirSync(path.join(workspaceRoot, '.devcodex'), { recursive: true })
    fs.writeFileSync(
      path.join(workspaceRoot, '.devcodex', 'layout.json'),
      JSON.stringify({ version: 1, mode: 'workspace-namespace', workspaceDir: 'workspace' })
    )
    fs.mkdirSync(wRoot, { recursive: true })
    fs.mkdirSync(gRoot, { recursive: true })

    writeSkill(wRoot, 'team-release', [
      '---',
      'name: team-release',
      'description: |',
      '  当用户要发版、准备 release、changelog、tag 前检查时使用。',
      '  触发语：「准备发版」「release checklist」',
      '---',
      '# team-release',
      '',
      '## 必须回复',
      '- RELEASE-OK-MARKER',
      ''
    ].join('\n'))

    writeSkill(wRoot, 'api-style', [
      '---',
      'name: api-style',
      'description: REST 错误码与分页约定；用户改接口契约时使用',
      '---',
      '# api-style',
      'follow api style',
      ''
    ].join('\n'))

    const entryPath = path.join(workspaceRoot, '.devcodex', 'workspace', 'DEVCODEX.md')
    fs.writeFileSync(entryPath, [
      '# DevCodex entry',
      '',
      '## Skills',
      '- always-on: (none)',
      '',
      'ENTRY-MARKER-UNIQUE',
      ''
    ].join('\n'), 'utf8')

    // global author skill
    writeSkill(gRoot, 'workspace-skill-author', [
      '---',
      'name: workspace-skill-author',
      'description: 编写或修改 workspace skill 与 DEVCODEX.md',
      '---',
      '# author',
      'write skills here',
      ''
    ].join('\n'))

    const env = {
      USERPROFILE: home,
      HOME: home,
      DEVCODEX_GLOBAL_SKILLS_ROOT: gRoot,
      DEVCODEX_SKILL_MATCH_MODE: 'intent'
    }
    const opts = { cwd: workspaceRoot, workspaceRoot, env, home }
    return run({ base, workspaceRoot, wRoot, entryPath, opts, env })
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
}

function testEntryPathAndRead() {
  withFixture(({ workspaceRoot, entryPath, opts }) => {
    const p = resolveDevcodexMdPath(workspaceRoot, opts)
    assert.strictEqual(p, entryPath)
    assert.ok(p.replace(/\\/g, '/').includes('.devcodex/workspace/DEVCODEX.md'))

    const entry = readDevcodexMdEntry(workspaceRoot, opts)
    assert.strictEqual(entry.exists, true)
    assert.ok(entry.content.includes('ENTRY-MARKER-UNIQUE'))
    assert.ok(entry.digest)

    const noLayout = readDevcodexMdEntry(path.join(workspaceRoot, '..'), { cwd: path.join(workspaceRoot, '..') })
    assert.ok(noLayout.reason === 'no-workspace-namespace' || !noLayout.exists)
  })
  console.log('  ✓ entry path + read')
}

function testEnsureTemplateNoOverwrite() {
  withFixture(({ workspaceRoot, entryPath, opts }) => {
    const before = fs.readFileSync(entryPath, 'utf8')
    const r1 = ensureDevcodexMdTemplate(workspaceRoot, opts)
    assert.strictEqual(r1.created, false)
    assert.strictEqual(fs.readFileSync(entryPath, 'utf8'), before)

    fs.unlinkSync(entryPath)
    const r2 = ensureDevcodexMdTemplate(workspaceRoot, opts)
    assert.strictEqual(r2.created, true)
    assert.ok(fs.existsSync(entryPath))
    assert.ok(fs.readFileSync(entryPath, 'utf8').includes('工作区入口'))
  })
  console.log('  ✓ ensure template no overwrite')
}

function testParseAlwaysOn() {
  assert.deepStrictEqual(parseAlwaysOn('always-on: foo, bar'), ['foo', 'bar'])
  assert.deepStrictEqual(parseAlwaysOn('always-on:（可选）'), [])
  console.log('  ✓ parseAlwaysOn')
}

function testCatalog() {
  withFixture(({ opts }) => {
    const cat = buildWorkspaceSkillCatalog(opts)
    assert.strictEqual(cat.schemaVersion, 'WorkspaceSkillCatalogV1')
    assert.ok(cat.skills.length >= 2)
    assert.ok(cat.digest)
    const ids = cat.skills.map(s => s.skillId)
    assert.ok(ids.includes('team-release'))
    assert.ok(ids.includes('api-style'))
    assert.ok(!ids.includes('workspace-skill-author'), 'author is global not W catalog')
  })
  console.log('  ✓ catalog')
}

function testIntentSelectPositiveNegative() {
  withFixture(({ opts }) => {
    const cat = buildWorkspaceSkillCatalog(opts)

    const pos = selectSkillByIntent('准备发版并检查 release checklist', cat, opts)
    assert.strictEqual(pos.skillId, 'team-release', `expected team-release got ${pos.skillId} score=${pos.score}`)
    assert.ok(pos.score >= 12)

    const neg = selectSkillByIntent('这个接口返回 500 怎么排查', cat, opts)
    assert.ok(
      neg.skillId !== 'team-release',
      `should not pick team-release for bug prompt, got ${neg.skillId}`
    )

    const explicit = selectSkillByIntent('用 api-style skill 检查分页', cat, opts)
    assert.strictEqual(explicit.skillId, 'api-style')
    assert.strictEqual(explicit.source, 'explicit-invoke')
  })
  console.log('  ✓ intent select +/– / explicit')
}

function testRouteInjection() {
  withFixture(({ opts }) => {
    const route = routeWorkspaceSkillIntent('准备发版 release checklist', opts)
    assert.strictEqual(route.mode, 'intent')
    assert.strictEqual(route.matched, true)
    assert.strictEqual(route.skillId, 'team-release')
    assert.ok(route.injectionText.includes('Workspace skills catalog'))
    assert.ok(route.injectionText.includes('ENTRY-MARKER-UNIQUE'))
    assert.ok(route.injectionText.includes('RELEASE-OK-MARKER') || route.injectionText.includes('team-release'))
    assert.ok(route.injectionText.includes('BEGIN WORKSPACE SKILL') || route.content)

    const authorRoute = routeWorkspaceSkillIntent('帮我写一个 workspace skill', opts)
    assert.strictEqual(authorRoute.skillId, AUTHOR_SKILL_ID)
    assert.ok(authorRoute.matched)
  })
  console.log('  ✓ route injection + author heuristic')
}

function testLegacyMode() {
  withFixture(({ opts, env }) => {
    const legacyEnv = { ...env, DEVCODEX_SKILL_MATCH_MODE: 'legacy-token' }
    assert.strictEqual(getSkillMatchMode(legacyEnv), 'legacy-token')
    const route = routeWorkspaceSkillIntent('test', {
      ...opts,
      env: legacyEnv
    })
    // may or may not match without test skill; mode must be legacy
    assert.strictEqual(route.mode, 'legacy-token')
  })
  console.log('  ✓ legacy mode flag')
}

function testNoGlobalWrite() {
  withFixture(({ opts, env }) => {
    const gBefore = fs.readdirSync(env.DEVCODEX_GLOBAL_SKILLS_ROOT)
    routeWorkspaceSkillIntent('准备发版 release checklist', opts)
    const gAfter = fs.readdirSync(env.DEVCODEX_GLOBAL_SKILLS_ROOT)
    assert.deepStrictEqual(gAfter.sort(), gBefore.sort())
  })
  console.log('  ✓ no global skills dir mutation')
}

function testReservedNotSelected() {
  withFixture(({ opts, wRoot }) => {
    writeSkill(wRoot, 'compliance', [
      '---',
      'name: compliance',
      'description: 发版 release checklist 强制 compliance',
      '---',
      '# bad',
      ''
    ].join('\n'))
    const cat = buildWorkspaceSkillCatalog(opts)
    const hasCompliance = cat.skills.some(s => s.skillId === 'compliance')
    // reserved dirs may be listed by readdir but select must skip reserved ids
    const decision = selectSkillByIntent('发版 release checklist 强制 compliance', cat, opts)
    assert.notStrictEqual(decision.skillId, 'compliance', 'reserved must not win intent')
    if (hasCompliance) {
      // still prefer non-reserved team-release when scores compete
      assert.ok(decision.skillId === 'team-release' || decision.skillId === null || decision.skillId === 'api-style')
    }
  })
  console.log('  ✓ reserved not selected')
}

function testImplementStartGate() {
  const {
    probeProcessTriad,
    classifyImplementStartGate,
    ERROR_CODES
  } = require('../scripts/lib/process-enforcement.js')
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-triad-'))
  try {
    const root = path.join(base, 'task')
    fs.mkdirSync(root)
    const empty = probeProcessTriad(root)
    assert.ok(empty.missing.includes('04-实施计划'))
    const blocked = classifyImplementStartGate({ controlPlaneMutation: true, taskRoot: root })
    assert.strictEqual(blocked.ok, false)
    assert.strictEqual(blocked.code, ERROR_CODES.IMPLEMENT_START_WITHOUT_PROCESS)
    fs.writeFileSync(path.join(root, '04-实施计划.md'), '#')
    fs.writeFileSync(path.join(root, '05-实施进度.md'), '#')
    fs.writeFileSync(path.join(root, '03-复审清单-t.md'), '#')
    // triad alone is not enough for control-plane: need 00/01 + 02 design artifacts
    const triadOnly = classifyImplementStartGate({ controlPlaneMutation: true, taskRoot: root })
    assert.strictEqual(triadOnly.ok, false)
    assert.strictEqual(triadOnly.code, ERROR_CODES.IMPLEMENT_START_WITHOUT_DESIGN)
    fs.writeFileSync(path.join(root, '00-需求概况.md'), '#')
    fs.writeFileSync(path.join(root, '01-需求确认.md'), '#')
    fs.writeFileSync(path.join(root, '02-技术方案.md'), '#')
    const ok = classifyImplementStartGate({ controlPlaneMutation: true, taskRoot: root })
    assert.strictEqual(ok.ok, true)
    const unbound = classifyImplementStartGate({ controlPlaneMutation: true, taskRoot: null })
    assert.strictEqual(unbound.ok, false)
    assert.strictEqual(unbound.code, ERROR_CODES.IMPLEMENT_START_WITHOUT_TASK_BINDING)
    const skip = classifyImplementStartGate({ controlPlaneMutation: false, taskRoot: root })
    assert.strictEqual(skip.ok, true)
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
  console.log('  ✓ implement-start gate')
}

function main() {
  console.log('test-workspace-skill-intent')
  testEntryPathAndRead()
  testEnsureTemplateNoOverwrite()
  testParseAlwaysOn()
  testCatalog()
  testIntentSelectPositiveNegative()
  testRouteInjection()
  testLegacyMode()
  testNoGlobalWrite()
  testReservedNotSelected()
  testImplementStartGate()
  console.log('all passed')
}

main()
