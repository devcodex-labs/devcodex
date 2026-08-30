'use strict'

/**
 * Runtime dependency closure + allowlist-only layout smoke.
 * Package lifecycle coverage is an explicit, separate mode.
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const TEMP_FIXTURES = []
const FLAGS = new Set(process.argv.slice(2))
for (const flag of FLAGS) {
  if (flag !== '--packlist-only') {
    console.error(`test-mcp-runtime-closure: unknown option ${flag}`)
    process.exit(2)
  }
}
const PACKLIST_ONLY = FLAGS.has('--packlist-only')

function tempFixture(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `devcodex-${prefix}`))
  TEMP_FIXTURES.push(root)
  return root
}
const {
  PROJECT_RUNTIME_SCRIPT_DEPS,
  CLAUDE_MCP_RUNTIME_SCRIPT_DEPS
} = require('../index.js')
const {
  MCP_RUNTIME_DEPS
} = require('./lib/global-host-config.js')
const {
  collectRuntimeScriptDeps,
  assertRuntimeClosureCovered
} = require('./lib/runtime-dependency-closure.js')
const {
  mcpToolCallProbe,
  mcpInitializeProbe
} = require('./lib/global-host-runtime-verifier.js')

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcFile = path.join(src, entry.name)
    const destFile = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDir(srcFile, destFile)
    else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(destFile), { recursive: true })
      fs.copyFileSync(srcFile, destFile)
    }
  }
}

function copyRuntimeDeps(destRoot, deps) {
  for (const rel of deps) {
    const src = path.join(ROOT, ...rel.split('/'))
    assert.ok(fs.existsSync(src), `source missing: ${rel}`)
    const dest = path.join(destRoot, ...rel.split('/'))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
  }
}

function makeWorkspace(tmp) {
  const workspace = path.join(tmp, 'workspace')
  fs.mkdirSync(path.join(workspace, '.devcodex', 'workspace', 'skills', 'test'), { recursive: true })
  fs.writeFileSync(path.join(workspace, 'package.json'), '{"name":"runtime-closure-fixture"}\n')
  fs.writeFileSync(path.join(workspace, '.devcodex', 'layout.json'), `${JSON.stringify({
    version: 1,
    mode: 'workspace-namespace'
  }, null, 2)}\n`)
  fs.writeFileSync(path.join(workspace, '.devcodex', 'workspace', 'skills', 'test', 'SKILL.md'), [
    '---',
    'name: test',
    'description: 当用户发送「test」时使用。',
    '---',
    '# test',
    '',
    '## 必须回复',
    '- 小朋友真可爱',
    ''
  ].join('\n'))
  return workspace
}

function replayHostAdapter(adapter, host, workspace) {
  return spawnSync(process.execPath, [adapter, host], {
    cwd: workspace,
    encoding: 'utf8',
    input: JSON.stringify({
      hookEventName: 'UserPromptSubmit',
      prompt: 'test',
      session_id: `runtime-closure-${host}`
    })
  })
}

function layoutReplaySmoke() {
  const tmp = tempFixture('runtime-closure-layout-')
  const workspace = makeWorkspace(tmp)

  copyDir(path.join(ROOT, 'hooks', '_runtime'), path.join(workspace, '.claude', 'hooks', '_runtime'))
  copyDir(path.join(ROOT, 'hooks', '_runtime'), path.join(workspace, '.codex', 'hooks', '_runtime'))
  copyRuntimeDeps(path.join(workspace, '.claude'), CLAUDE_MCP_RUNTIME_SCRIPT_DEPS)
  copyRuntimeDeps(path.join(workspace, '.codex'), CLAUDE_MCP_RUNTIME_SCRIPT_DEPS)

  const claude = replayHostAdapter(path.join(workspace, '.claude', 'hooks', '_runtime', 'lifecycle-host-adapters.cjs'), 'claude', workspace)
  assert.strictEqual(claude.status, 0, `allowlist-only claude hook replay failed: ${claude.stderr || claude.stdout}`)
  assert.match(`${claude.stdout}`, /SkillRouteBootstrapV1/)
  assert.doesNotMatch(`${claude.stdout}`, /小朋友真可爱/)

  const codex = replayHostAdapter(path.join(workspace, '.codex', 'hooks', '_runtime', 'lifecycle-host-adapters.cjs'), 'codex', workspace)
  assert.strictEqual(codex.status, 0, `allowlist-only codex hook replay failed: ${codex.stderr || codex.stdout}`)
  assert.match(`${codex.stdout}`, /SkillRouteBootstrapV1/)
  assert.match(`${codex.stdout}`, /deferred tool discovery\/search/)
  assert.match(`${codex.stdout}`, /profile_load, memory_status, or SkillRoute/)
  assert.doesNotMatch(`${codex.stdout}`, /小朋友真可爱/)
}

function closureCoverage() {
  const expected = collectRuntimeScriptDeps(ROOT)
  assert.deepStrictEqual(PROJECT_RUNTIME_SCRIPT_DEPS, expected, 'project runtime deps must be derived from runtime closure')
  assert.deepStrictEqual(CLAUDE_MCP_RUNTIME_SCRIPT_DEPS, expected, 'legacy export must match project runtime deps')
  assert.deepStrictEqual(MCP_RUNTIME_DEPS, expected, 'global runtime deps must be derived from runtime closure')
  assertRuntimeClosureCovered(ROOT, PROJECT_RUNTIME_SCRIPT_DEPS, { label: 'project runtime deps' })
  assertRuntimeClosureCovered(ROOT, MCP_RUNTIME_DEPS, { label: 'global runtime deps' })

  const missingOne = expected.filter(dep => dep !== expected[0])
  assert.throws(
    () => assertRuntimeClosureCovered(ROOT, missingOne, { label: 'negative runtime deps' }),
    error => error && error.code === 'RUNTIME_CLOSURE_ALLOWLIST_MISSING' && String(error.message).includes(expected[0])
  )
}

function fakeRuntimeSeed() {
  const tmp = tempFixture('runtime-closure-fake-')
  fs.mkdirSync(path.join(tmp, 'hooks', '_runtime'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'scripts', 'lib'), { recursive: true })
  fs.writeFileSync(
    path.join(tmp, 'hooks', '_runtime', 'fixture.cjs'),
    `require(${'\'../../scripts/lib/fake-runtime-only.js\''})\n`
  )
  fs.writeFileSync(path.join(tmp, 'scripts', 'lib', 'fake-runtime-only.js'), "'use strict'\nmodule.exports = {}\n")
  assert.deepStrictEqual(
    collectRuntimeScriptDeps(tmp, { roots: ['hooks/_runtime'] }),
    ['scripts/lib/fake-runtime-only.js'],
    'new runtime-only require must enter closure'
  )

  // Dynamic path.join(__dirname, '..', '..', 'scripts', 'lib', ...) must also enter closure.
  const tmpJoin = tempFixture('runtime-closure-join-')
  fs.mkdirSync(path.join(tmpJoin, 'hooks', '_runtime'), { recursive: true })
  fs.mkdirSync(path.join(tmpJoin, 'scripts', 'lib'), { recursive: true })
  fs.writeFileSync(
    path.join(tmpJoin, 'hooks', '_runtime', 'join-fixture.cjs'),
    "const p = path.join(__dirname, '..', '..', 'scripts', 'lib', 'join-only-dep.js')\nrequire(p)\n"
  )
  fs.writeFileSync(path.join(tmpJoin, 'scripts', 'lib', 'join-only-dep.js'), "'use strict'\nmodule.exports = {}\n")
  assert.deepStrictEqual(
    collectRuntimeScriptDeps(tmpJoin, { roots: ['hooks/_runtime'] }),
    ['scripts/lib/join-only-dep.js'],
    'path.join scripts/lib dep must enter closure'
  )
}

function allowlistOnlyMcpSmoke() {
  const tmp = tempFixture('runtime-closure-mcp-')
  // MCP servers resolve ../hooks/_runtime and ../scripts/lib from package-shaped layout.
  copyDir(path.join(ROOT, 'mcp'), path.join(tmp, 'mcp'))
  copyDir(path.join(ROOT, 'hooks', '_runtime'), path.join(tmp, 'hooks', '_runtime'))
  copyRuntimeDeps(tmp, CLAUDE_MCP_RUNTIME_SCRIPT_DEPS)

  const mem = path.join(tmp, 'mcp', 'memory-server.js')
  const prof = path.join(tmp, 'mcp', 'profile-server.js')
  const initR = mcpInitializeProbe(mem, tmp, { timeoutMs: 5000 })
  assert.strictEqual(initR.passed, true, `allowlist-only initialize failed: ${initR.error}`)
  const memR = mcpToolCallProbe(mem, tmp, 'memory_status', { agent: 'grok', project: 'devcodex', limit: 2 }, {
    timeoutMs: 8000
  })
  assert.strictEqual(memR.passed, true, `allowlist-only memory smoke failed: ${memR.error} ${memR.textHead}`)
  const profR = mcpToolCallProbe(prof, tmp, 'profile_compose_entry_check', {
    project: path.basename(tmp),
    status: 'PASS',
    nextStep: 'test',
    entry: {
      prompt: '确认',
      languageContext: {
        schemaVersion: 'LanguageContextV2', primaryLanguage: 'zh-CN', responseLanguage: 'zh-CN',
        artifactLanguage: 'zh-CN', currentTurnClass: 'neutral', source: 'task-primary-language',
        confidence: 'high', updatedPrimary: false
      }
    }
  }, { timeoutMs: 8000 })
  assert.strictEqual(profR.passed, true, `allowlist-only profile smoke failed: ${profR.error} ${profR.textHead}`)
  assert.match(profR.textHead, /DevCodex · 入口检查/)
  assert.doesNotMatch(profR.textHead, /DevCodexVisibleEnvelopeV3/)
}

function packlistContainsRuntimeClosure() {
  const packed = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  })
  assert.strictEqual(packed.status, 0, `npm pack dry-run failed: ${packed.stderr || packed.stdout}`)
  const parsed = JSON.parse(packed.stdout)
  const files = new Set((parsed[0]?.files || []).map(item => String(item.path || '').replace(/\\/g, '/')))
  for (const rel of collectRuntimeScriptDeps(ROOT)) {
    assert.ok(files.has(rel), `npm package must include runtime closure file: ${rel}`)
  }
  assert.ok(files.has('scripts/lib/runtime-dependency-closure.js'), 'npm package must include runtime closure owner')
}

try {
  if (PACKLIST_ONLY) {
    packlistContainsRuntimeClosure()
  } else {
    closureCoverage()
    fakeRuntimeSeed()
    layoutReplaySmoke()
    allowlistOnlyMcpSmoke()
  }
  console.log(`test-mcp-runtime-closure: PASS mode=${PACKLIST_ONLY ? 'packlist-only' : 'runtime-only'}`)
} finally {
  for (const root of TEMP_FIXTURES.reverse()) fs.rmSync(root, { recursive: true, force: true })
}
