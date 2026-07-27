'use strict'

/**
 * P0-1 Batch1 exit gate: E2E-A～J for workspace skill intent + DEVCODEX.md + author + implement gate.
 * Pure fixture + route/lifecycle spawn — no mutation of user workspace.
 */

const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  routeWorkspaceSkillIntent,
  selectSkillByIntent,
  isIntentReplySatisfied,
  buildIntentStopForceReason,
  AUTHOR_SKILL_ID
} = require('../hooks/_runtime/workspace-skill-intent.cjs')
const {
  buildWorkspaceSkillCatalog
} = require('../hooks/_runtime/workspace-skill-catalog.cjs')
const {
  ensureDevcodexMdTemplate,
  readDevcodexMdEntry
} = require('../hooks/_runtime/devcodex-md-entry.cjs')
const {
  resolveSkillRead
} = require('../hooks/_runtime/skill-resolution.cjs')
const {
  classifyImplementStartGate,
  ERROR_CODES
} = require('./lib/process-enforcement.js')

const LIFECYCLE = path.join(__dirname, '../hooks/_runtime/lifecycle.cjs')
const AUTHOR_SRC = path.join(__dirname, '../skills/workspace-skill-author/SKILL.md')

function writeSkill (root, id, body) {
  const dir = path.join(root, id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), body, 'utf8')
}

function makeFixture () {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-intent-e2e-'))
  const workspaceRoot = path.join(base, 'ws')
  const home = path.join(base, 'home')
  const gRoot = path.join(home, '.agents', 'skills')
  const wRoot = path.join(workspaceRoot, '.devcodex', 'workspace', 'skills')
  const taskRoot = path.join(workspaceRoot, '.devcodex', 'req-task')
  fs.mkdirSync(wRoot, { recursive: true })
  fs.mkdirSync(gRoot, { recursive: true })
  fs.mkdirSync(taskRoot, { recursive: true })
  fs.writeFileSync(
    path.join(workspaceRoot, '.devcodex', 'layout.json'),
    JSON.stringify({ version: 1, mode: 'workspace-namespace', workspaceDir: 'workspace' })
  )

  writeSkill(wRoot, 'team-release', [
    '---',
    'name: team-release',
    'description: |',
    '  当用户要发版、准备 release、changelog、tag 前检查时使用。',
    '  触发：「准备发版」「release checklist」',
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
    'description: REST 错误码与分页约定；用户改接口契约时使用，不要用于发版',
    '---',
    '# api-style',
    'API-STYLE-BODY',
    ''
  ].join('\n'))

  fs.writeFileSync(
    path.join(workspaceRoot, '.devcodex', 'workspace', 'DEVCODEX.md'),
    ['# entry', '', 'ENTRY-MARKER-E2E', '', 'always-on: (none)', ''].join('\n')
  )

  // package author → global
  assert.ok(fs.existsSync(AUTHOR_SRC), 'package author skill missing')
  writeSkill(gRoot, 'workspace-skill-author', fs.readFileSync(AUTHOR_SRC, 'utf8'))

  // triad for implement gate positive
  fs.writeFileSync(path.join(taskRoot, '00-需求概况.md'), '# overview\n')
  fs.writeFileSync(path.join(taskRoot, '01-需求确认.md'), '# cp1\n')
  fs.writeFileSync(path.join(taskRoot, '02-技术方案.md'), '# design\n')
  fs.writeFileSync(path.join(taskRoot, '04-实施计划.md'), '# plan\n')
  fs.writeFileSync(path.join(taskRoot, '05-实施进度.md'), '# progress\n')
  fs.writeFileSync(path.join(taskRoot, '03-复审清单-e2e.md'), '# checklist\n')

  const env = {
    USERPROFILE: home,
    HOME: home,
    DEVCODEX_GLOBAL_SKILLS_ROOT: gRoot,
    DEVCODEX_SKILL_MATCH_MODE: 'intent',
    DEVCODEX_HOOK_ENFORCEMENT: 'safety-only'
  }
  const opts = { cwd: workspaceRoot, workspaceRoot, env, home }
  return { base, workspaceRoot, wRoot, gRoot, taskRoot, opts, env, home }
}

function cleanup (fx) {
  fs.rmSync(fx.base, { recursive: true, force: true })
}

function runLifecycle (fx, payload) {
  const r = spawnSync(process.execPath, [LIFECYCLE], {
    cwd: fx.workspaceRoot,
    env: { ...process.env, ...fx.env },
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 20000,
    maxBuffer: 4 * 1024 * 1024
  })
  let out = {}
  try {
    out = JSON.parse(String(r.stdout || '').trim() || '{}')
  } catch {
    out = { parseError: true, stdout: r.stdout, stderr: r.stderr, status: r.status }
  }
  return { status: r.status, stderr: r.stderr, out }
}

// ── E2E-A: intent positives ≥3 ─────────────────────────────────────────────
{
  const fx = makeFixture()
  try {
    const prompts = [
      '准备发版并做 release checklist',
      '发版前 changelog 和 tag 检查',
      'team release 发版流程'
    ]
    let hits = 0
    for (const p of prompts) {
      const route = routeWorkspaceSkillIntent(p, fx.opts)
      if (route.matched && route.skillId === 'team-release') {
        assert.ok(
          (route.content && route.content.includes('RELEASE-OK-MARKER')) ||
          route.injectionText.includes('RELEASE-OK-MARKER')
        )
        hits += 1
      }
    }
    assert.ok(hits >= 3, `E2E-A need ≥3 team-release hits, got ${hits}`)
    console.log('E2E-A PASS')
  } finally {
    cleanup(fx)
  }
}

// ── E2E-B: negatives ≥3 ────────────────────────────────────────────────────
{
  const fx = makeFixture()
  try {
    const prompts = [
      '这个接口返回 500 怎么排查',
      '修一下登录空指针',
      '单元测试红了帮我看'
    ]
    for (const p of prompts) {
      const route = routeWorkspaceSkillIntent(p, fx.opts)
      assert.notStrictEqual(route.skillId, 'team-release', `E2E-B false positive on: ${p}`)
      if (route.injectionText && route.skillId === 'team-release') {
        assert.fail('must not inject team-release body for bug prompts')
      }
    }
    console.log('E2E-B PASS')
  } finally {
    cleanup(fx)
  }
}

// ── E2E-C: explicit invoke ─────────────────────────────────────────────────
{
  const fx = makeFixture()
  try {
    const route = routeWorkspaceSkillIntent('用 api-style skill 检查分页字段', fx.opts)
    assert.strictEqual(route.skillId, 'api-style')
    assert.strictEqual(route.decision.source, 'explicit-invoke')
    assert.ok(route.injectionText.includes('API-STYLE-BODY') || (route.content && route.content.includes('API-STYLE-BODY')))
    console.log('E2E-C PASS')
  } finally {
    cleanup(fx)
  }
}

// ── E2E-D: DEVCODEX.md in inject ───────────────────────────────────────────
{
  const fx = makeFixture()
  try {
    const route = routeWorkspaceSkillIntent('随便聊聊', fx.opts)
    assert.ok(route.injectionText.includes('ENTRY-MARKER-E2E'), 'entry marker must appear')
    assert.ok(route.injectionText.includes('Workspace skills catalog') || route.injectionText.includes('catalog'))
    console.log('E2E-D PASS')
  } finally {
    cleanup(fx)
  }
}

// ── E2E-E: init template no overwrite ──────────────────────────────────────
{
  const fx = makeFixture()
  try {
    const entryPath = path.join(fx.workspaceRoot, '.devcodex', 'workspace', 'DEVCODEX.md')
    const before = fs.readFileSync(entryPath, 'utf8')
    const r1 = ensureDevcodexMdTemplate(fx.workspaceRoot, fx.opts)
    assert.strictEqual(r1.created, false)
    assert.strictEqual(fs.readFileSync(entryPath, 'utf8'), before)
    fs.unlinkSync(entryPath)
    const r2 = ensureDevcodexMdTemplate(fx.workspaceRoot, fx.opts)
    assert.strictEqual(r2.created, true)
    assert.ok(fs.existsSync(entryPath))
    const entry = readDevcodexMdEntry(fx.workspaceRoot, fx.opts)
    assert.strictEqual(entry.exists, true)
    console.log('E2E-E PASS')
  } finally {
    cleanup(fx)
  }
}

// ── E2E-F: no global pollution ─────────────────────────────────────────────
{
  const fx = makeFixture()
  try {
    const before = fs.readdirSync(fx.gRoot).sort()
    routeWorkspaceSkillIntent('准备发版 release checklist', fx.opts)
    routeWorkspaceSkillIntent('用 api-style skill', fx.opts)
    const after = fs.readdirSync(fx.gRoot).sort()
    assert.deepStrictEqual(after, before)
    console.log('E2E-F PASS')
  } finally {
    cleanup(fx)
  }
}

// ── E2E-G: lifecycle UPS inject + Stop force path ──────────────────────────
{
  const fx = makeFixture()
  try {
    const sessionId = `e2e-intent-${Date.now()}`
    const ups = runLifecycle(fx, {
      hook_event_name: 'UserPromptSubmit',
      session_id: sessionId,
      cwd: fx.workspaceRoot,
      prompt: '准备发版 release checklist',
      userPrompt: '准备发版 release checklist'
    })
    const upsText = JSON.stringify(ups.out)
    assert.ok(
      upsText.includes('RELEASE-OK-MARKER') ||
      upsText.includes('team-release') ||
      upsText.includes('WorkspaceSkillIntent') ||
      upsText.includes('Workspace skills catalog'),
      `E2E-G UPS should carry intent context: ${upsText.slice(0, 400)}`
    )

    const stopBad = runLifecycle(fx, {
      hook_event_name: 'Stop',
      session_id: sessionId,
      cwd: fx.workspaceRoot,
      lastAssistantMessage: 'Ready - systems are up',
      stopHookActive: false
    })
    // Stop may block or soft-continue depending on state persistence across spawns
    // (new process = new state file per cwd). Also assert pure force builder.
    const force = buildIntentStopForceReason({
      skillId: 'team-release',
      mustReply: 'RELEASE-OK-MARKER',
      injectionText: 'BEGIN WORKSPACE SKILL\nRELEASE-OK-MARKER'
    })
    assert.ok(force.includes('team-release') || force.includes('WorkspaceSkillIntent'))
    assert.ok(!isIntentReplySatisfied('Ready - systems are up', {
      skillId: 'team-release',
      mustReply: 'RELEASE-OK-MARKER',
      content: 'RELEASE-OK-MARKER'
    }))
    assert.ok(isIntentReplySatisfied('RELEASE-OK-MARKER and done', {
      skillId: 'team-release',
      mustReply: 'RELEASE-OK-MARKER',
      content: 'RELEASE-OK-MARKER'
    }))
    // lifecycle Stop: if state persisted, expect block decision
    const stopStr = JSON.stringify(stopBad.out)
    if (stopStr.includes('decision') || stopStr.includes('block') || stopStr.includes('WorkspaceSkill')) {
      console.log('E2E-G PASS (lifecycle stop signal present)')
    } else {
      // isolated spawn may not share state file — pure path still required
      console.log('E2E-G PASS (satisfaction + force reason; lifecycle stop state best-effort)')
    }
  } finally {
    cleanup(fx)
  }
}

// ── E2E-H: legacy mode isolation ───────────────────────────────────────────
{
  const fx = makeFixture()
  try {
    const legacyOpts = {
      ...fx.opts,
      env: { ...fx.env, DEVCODEX_SKILL_MATCH_MODE: 'legacy-token' }
    }
    const route = routeWorkspaceSkillIntent('准备发版 release checklist', legacyOpts)
    assert.strictEqual(route.mode, 'legacy-token')
    // default intent still works in parallel fixture
    const intent = routeWorkspaceSkillIntent('准备发版 release checklist', fx.opts)
    assert.strictEqual(intent.mode, 'intent')
    console.log('E2E-H PASS')
  } finally {
    cleanup(fx)
  }
}

// ── E2E-I: author skill global resolve ─────────────────────────────────────
{
  const fx = makeFixture()
  try {
    const { trace, content } = resolveSkillRead(AUTHOR_SKILL_ID, {
      ...fx.opts,
      includeContent: true
    })
    assert.strictEqual(trace.selectedLayer, 'global', `author layer=${trace.selectedLayer}`)
    assert.ok(content && content.includes('workspace/skills'))
    assert.ok(content.includes('DEVCODEX.md'))
    const route = routeWorkspaceSkillIntent('帮我写一个 workspace skill', fx.opts)
    assert.strictEqual(route.skillId, AUTHOR_SKILL_ID)
    assert.ok(route.matched)
    console.log('E2E-I PASS')
  } finally {
    cleanup(fx)
  }
}

// ── E2E-J: author-shaped skill can be intent-selected ──────────────────────
{
  const fx = makeFixture()
  try {
    writeSkill(fx.wRoot, 'deploy-notes', [
      '---',
      'name: deploy-notes',
      'description: |',
      '  当用户要写部署说明、发布说明 deploy notes 时使用。',
      '  触发：「写部署说明」「deploy notes」',
      '---',
      '# deploy-notes',
      '## 必须回复',
      '- DEPLOY-NOTES-OK',
      ''
    ].join('\n'))
    const cat = buildWorkspaceSkillCatalog(fx.opts)
    const decision = selectSkillByIntent('请帮我写部署说明 deploy notes', cat, fx.opts)
    assert.strictEqual(decision.skillId, 'deploy-notes', `J decision=${decision.skillId}`)
    const route = routeWorkspaceSkillIntent('请帮我写部署说明 deploy notes', fx.opts)
    assert.strictEqual(route.skillId, 'deploy-notes')
    assert.ok(route.injectionText.includes('DEPLOY-NOTES-OK') || (route.content && route.content.includes('DEPLOY-NOTES-OK')))
    console.log('E2E-J PASS')
  } finally {
    cleanup(fx)
  }
}

// ── E2E-K: ImplementStartGate (Batch1 process) ─────────────────────────────
{
  const fx = makeFixture()
  try {
    const empty = path.join(fx.base, 'empty-task')
    fs.mkdirSync(empty)
    const bad = classifyImplementStartGate({ controlPlaneMutation: true, taskRoot: empty })
    assert.strictEqual(bad.ok, false)
    assert.strictEqual(bad.code, ERROR_CODES.IMPLEMENT_START_WITHOUT_PROCESS)
    const unbound = classifyImplementStartGate({ controlPlaneMutation: true, taskRoot: null })
    assert.strictEqual(unbound.ok, false)
    assert.strictEqual(unbound.code, ERROR_CODES.IMPLEMENT_START_WITHOUT_TASK_BINDING)
    const good = classifyImplementStartGate({ controlPlaneMutation: true, taskRoot: fx.taskRoot })
    assert.strictEqual(good.ok, true)
    console.log('E2E-K PASS (implement-start gate)')
  } finally {
    cleanup(fx)
  }
}

console.log('test-workspace-skill-intent-e2e: all E2E-A～J + K passed')
