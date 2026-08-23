#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { buildTestHooksRuntimeFixtures } = require('./lib/test-hooks-runtime-fixtures')
const { runHooksRuntimeBootstrapLayoutScenarios } = require('./lib/test-hooks-runtime-bootstrap-layout')
const { runHooksRuntimeVisibilityScenarios } = require('./lib/test-hooks-runtime-visibility')
const { runHooksRuntimeGovernanceIntakeScenarios } = require('./lib/test-hooks-runtime-governance-intake')
const { DEFAULT_THRESHOLDS } = require('../hooks/_runtime/lifecycle-turn-liveness.cjs')
const { stableDigest } = require('../hooks/_runtime/context-read-contract.cjs')
const { resolveLanguageContext } = require('../hooks/_runtime/language-context.cjs')
const { createRuntimeStateStore } = require('../hooks/_runtime/runtime-state-store.cjs')
const { resolveRuntimeStateRoots } = require('../hooks/_runtime/workspace-layout.cjs')
const { buildLifecycleNamespaceStateUtils } = require('../hooks/_runtime/lifecycle-namespace-state.cjs')
const {
  commitTaskRecoveryState,
  readTaskRecoveryState,
  storePaths
} = require('../hooks/_runtime/task-recovery-store-v5.cjs')

const ROOT = path.resolve(__dirname, '..')
const RUNTIME = path.join(ROOT, 'hooks', '_runtime', 'lifecycle.cjs')
const PROFILE_SERVER = path.join(ROOT, 'mcp', 'profile-server.js')

// Use a temp directory as the workspace root to isolate from real requirements
const TEMP_ROOT = path.join(os.tmpdir(), `devcodex-hooks-test-${process.pid}`)
const STATE_DIR = path.join(TEMP_ROOT, '.devcodex', '.memory', 'hooks', 'legacy')
const STATE_FILE = path.join(STATE_DIR, 'lifecycle-state.json')
const CAPTURE_FLAG = path.join(STATE_DIR, 'capture-final-payload.flag')
const CAPTURE_LOG = path.join(STATE_DIR, 'v5', 'telemetry-0.ndjson')
const INTERCEPTION_LOG = path.join(STATE_DIR, 'interceptions.jsonl')
const TEST_AGENT = 'claude-code'
const FALLBACK_BOOTSTRAP_AGENT = (() => {
  if (process.env.CLAUDE_CODE_VERSION || process.env.CLAUDE_HOOK_COMMAND) return 'claude-code'
  if (
    process.env.GROK_AGENT ||
    process.env.GROK_HOME ||
    process.env.GROK_SESSION ||
    process.env.GROK_BUILD
  ) return 'grok'
  if (process.env.IDEA_INITIAL_DIRECTORY || process.env.JETBRAINS_IDE) return 'jetbrains-copilot'
  if (process.env.TERM_PROGRAM === 'vscode' || process.env.VSCODE_PID) return 'vscode-copilot'
  return 'copilot'
})()
const WRONG_FALLBACK_AGENT = FALLBACK_BOOTSTRAP_AGENT === 'claude-code' ? 'copilot' : 'claude-code'
const {
  getTaskStamp,
  getMemoryFilePath,
  getLayoutStateFile,
  getLayoutCaptureLog,
  getWorkspaceLayoutStateFile,
  callProfileTool,
  runBootstrapReads: runBootstrapReadsRaw,
  runLayoutBootstrapReads,
  cleanState,
  cleanLayoutState,
  cleanMultiProjectState,
  cleanLayoutMultiProjectState,
  cleanNestedLayoutMultiProjectState,
  cleanToolingSiblingState,
  run: runRaw,
  readInterceptionEntries,
  writeTranscript,
  writeTranscriptEntries
} = buildTestHooksRuntimeFixtures({
  fs,
  path,
  process,
  spawnSync,
  RUNTIME,
  PROFILE_SERVER,
  TEMP_ROOT,
  STATE_FILE,
  TEST_AGENT
})

const completedLegacySkillRoutes = new Set()

function currentLegacySkillRouteKey() {
  try {
    if (!fs.existsSync(STATE_FILE)) return null
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    const bootstrap = state.progressiveSkillRoute?.bootstrap
    if (!bootstrap?.contextEpoch || !bootstrap?.turnBinding) return null
    return `${bootstrap.contextEpoch}:${bootstrap.turnBinding}`
  } catch {
    return null
  }
}

function runBootstrapReads(...args) {
  const result = runBootstrapReadsRaw(...args)
  const key = currentLegacySkillRouteKey()
  if (key) completedLegacySkillRoutes.add(key)
  return result
}

function run(payload, cwd = TEMP_ROOT, env = {}) {
  const eventName = String(payload?.hookEventName || payload?.hook_event_name || '').toLowerCase()
  if (eventName === 'stop' && path.resolve(cwd) === path.resolve(TEMP_ROOT)) {
    const key = currentLegacySkillRouteKey()
    if (key && !completedLegacySkillRoutes.has(key)) {
      runBootstrapReads(TEST_AGENT)
    }
  }
  return runRaw(payload, cwd, env)
}

const runtimeScenarioContext = {
  assert,
  fs,
  path,
  TEMP_ROOT,
  STATE_DIR,
  STATE_FILE,
  CAPTURE_FLAG,
  CAPTURE_LOG,
  TEST_AGENT,
  FALLBACK_BOOTSTRAP_AGENT,
  WRONG_FALLBACK_AGENT,
  stableDigest,
  getTaskStamp,
  getMemoryFilePath,
  getLayoutStateFile,
  getWorkspaceLayoutStateFile,
  callProfileTool,
  runBootstrapReads,
  runLayoutBootstrapReads,
  cleanState,
  cleanLayoutState,
  cleanMultiProjectState,
  cleanLayoutMultiProjectState,
  cleanNestedLayoutMultiProjectState,
  cleanToolingSiblingState,
  run,
  readInterceptionEntries,
  writeTranscript,
  writeTranscriptEntries
}

function main() {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-runtime-store-'))
  const projectA = path.join(stateRoot, '.devcodex', 'apps', 'api')
  const projectB = path.join(stateRoot, '.devcodex', 'apps', 'web')
  fs.mkdirSync(projectA, { recursive: true })
  fs.mkdirSync(projectB, { recursive: true })
  fs.writeFileSync(path.join(stateRoot, '.devcodex', 'layout.json'), JSON.stringify({ version: 1, mode: 'workspace-namespace' }))
  const rootsA = resolveRuntimeStateRoots(projectA, 'apps/api')
  const rootsB = resolveRuntimeStateRoots(projectB, 'apps/web')
  assert.notStrictEqual(rootsA.primaryRoot, rootsB.primaryRoot, 'projects must receive isolated runtime partitions')
  assert.ok(!fs.existsSync(rootsA.primaryRoot), 'runtime resolution must remain read-only')

  const invalidProfileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-lifecycle-invalid-profile-'))
  const invalidProjectRoot = path.join(invalidProfileRoot, 'chat')
  fs.mkdirSync(path.join(invalidProfileRoot, '.devcodex', 'workspace', 'profile'), { recursive: true })
  fs.mkdirSync(path.join(invalidProfileRoot, '.devcodex', 'chat', 'profile'), { recursive: true })
  fs.mkdirSync(invalidProjectRoot, { recursive: true })
  fs.writeFileSync(
    path.join(invalidProfileRoot, '.devcodex', 'workspace', 'profile', 'config.json'),
    '{"mode":"prod"}\n'
  )
  fs.writeFileSync(
    path.join(invalidProfileRoot, '.devcodex', 'chat', 'profile', 'config.json'),
    '{"mode":"dev", broken}\n'
  )
  const invalidProfileUtils = buildLifecycleNamespaceStateUtils({
    fs,
    path,
    CONTEXT_ROOT: invalidProjectRoot,
    WORKSPACE_ROOT: invalidProfileRoot,
    LAYOUT: { enabled: true },
    CONTEXT_PROJECT: 'chat',
    DEFAULT_SCOPE: 'project',
    META_STATE_SCOPE_KEY: 'workspace',
    mergeConfig: (base, overlay) => ({ ...(base || {}), ...(overlay || {}) }),
    detectPlatform: () => 'codex'
  })
  assert.throws(
    () => invalidProfileUtils.readResolvedProfileConfig({ activeProject: 'chat' }),
    error => error?.code === 'PROFILE_CONFIG_INVALID' && error.filePath.endsWith(path.join('chat', 'profile', 'config.json')),
    'lifecycle must not downgrade a malformed project Profile to workspace config'
  )
  fs.rmSync(invalidProfileRoot, { recursive: true, force: true })

  const legacyFile = path.join(projectA, '.runtime-state', 'compat', 'state.json')
  fs.mkdirSync(path.dirname(legacyFile), { recursive: true })
  fs.writeFileSync(legacyFile, JSON.stringify({ schemaVersion: 'CompatibilityProbeV1', value: 'legacy' }))
  const stateStore = createRuntimeStateStore({
    activeRoot: projectA,
    project: 'apps/api',
    relativePath: path.join('compat', 'state.json'),
    maxWrites: 1
  })
  const compatibilityRead = stateStore.read()
  assert.strictEqual(compatibilityRead.status, 'fresh')
  assert.strictEqual(compatibilityRead.stateSource, 'legacy-read-only')
  assert.strictEqual(stateStore.write({ schemaVersion: 'CompatibilityProbeV1', value: 'canonical' }).status, 'persisted')
  assert.strictEqual(stateStore.read().value.value, 'canonical', 'canonical state must win after the first new write')
  assert.strictEqual(JSON.parse(fs.readFileSync(legacyFile, 'utf8')).value, 'legacy', 'new writes must never mutate the legacy compatibility entry')
  fs.rmSync(stateRoot, { recursive: true, force: true })

  assert.deepStrictEqual(
    resolveLanguageContext({ prompt: '请用中文分析这个项目' }),
    { schemaVersion: 'LanguageContextV1', language: 'zh-CN', source: 'explicit-current-turn', confidence: 'high' }
  )
  assert.deepStrictEqual(
    resolveLanguageContext({ prompt: 'Please inspect the project.' }),
    { schemaVersion: 'LanguageContextV1', language: 'en', source: 'current-user-message', confidence: 'high' }
  )
  assert.deepStrictEqual(
    resolveLanguageContext({ carrier: { language: 'ja' } }),
    { schemaVersion: 'LanguageContextV1', language: 'ja', source: 'turn-bound-carrier', confidence: 'medium' }
  )
  assert.deepStrictEqual(
    resolveLanguageContext({}),
    { schemaVersion: 'LanguageContextV1', language: 'en', source: 'und-en-fallback', confidence: 'low' }
  )

  runHooksRuntimeBootstrapLayoutScenarios(runtimeScenarioContext)
  runHooksRuntimeGovernanceIntakeScenarios(runtimeScenarioContext)
  runHooksRuntimeVisibilityScenarios(runtimeScenarioContext)

  // TaskResolutionV1: a canonical resume message resolves identity before
  // Context Acquisition, while Hook remains a no-payload/no-CP thin adapter.
  cleanState()
  const continuationTask = path.join(TEMP_ROOT, '.devcodex', 'optimizations', 'Hook续接任务')
  fs.mkdirSync(path.join(continuationTask, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(continuationTask, '.memory', 'task.json'), JSON.stringify({
    schemaVersion: 'TaskIdentityV1',
    taskId: '6b31500b-f2c4-4f50-9067-d59ad1f806f1',
    displayName: 'Hook续接任务',
    aliases: ['Hook旧任务名'],
    createdAt: '2026-07-18T00:00:00.000Z',
    identityRevision: 1
  }, null, 2) + '\n')
  const continuationSessions = '# Hook continuation\n\n> **当前状态**: 🔄 active\n'
  fs.writeFileSync(path.join(continuationTask, '.memory', 'sessions.md'), continuationSessions)
  const resolvedContinuation = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'task-continuation-unique',
    prompt: '继续 Hook续接任务'
  })
  const continuationContext = resolvedContinuation.hookSpecificOutput?.additionalContext || resolvedContinuation.systemMessage || ''
  assert.match(continuationContext, /TaskResolutionV1 resolved-active/)
  assert.match(continuationContext, /LanguageContextV1/)
  const continuationStore = storePaths(STATE_DIR)
  const taskSlotFiles = []
  const pendingTaskDirs = [continuationStore.tasks]
  while (pendingTaskDirs.length) {
    const current = pendingTaskDirs.pop()
    let entries
    try { entries = fs.readdirSync(current, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) pendingTaskDirs.push(fullPath)
      else if (/^state-[ab]\.json$/.test(entry.name)) taskSlotFiles.push(fullPath)
    }
  }
  assert(taskSlotFiles.length >= 1, 'resolved formal task must create a durable V5 task slot')
  const continuationEnvelope = taskSlotFiles
    .map(file => JSON.parse(fs.readFileSync(file, 'utf8')))
    .sort((left, right) => right.sequence - left.sequence)[0]
  const continuationRecovered = readTaskRecoveryState({
    metaDir: STATE_DIR,
    identity: continuationEnvelope.identity
  })
  assert.strictEqual(continuationRecovered.status, 'fresh')
  continuationRecovered.state.cp3Runtime = {
    ...(continuationRecovered.state.cp3Runtime || {}),
    recoverySentinel: 'formal-task-a-b-rehydrated'
  }
  assert.strictEqual(commitTaskRecoveryState({
    metaDir: STATE_DIR,
    identity: continuationEnvelope.identity,
    sessionKey: 'task-continuation-unique',
    state: continuationRecovered.state
  }, { force: true, reserveBytes: 8192 }).status, 'committed')
  for (const file of continuationStore.ephemeral) {
    try { fs.unlinkSync(file) } catch { }
  }
  try { fs.unlinkSync(STATE_FILE) } catch { }
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'task-continuation-new-session',
    prompt: '继续 Hook续接任务'
  })
  const crossSessionContinuationState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(
    crossSessionContinuationState.cp3Runtime?.recoverySentinel,
    'formal-task-a-b-rehydrated',
    'a unique formal task continuation must load task A/B before resetting the new turn'
  )
  assert.match(continuationContext, /language: zh-CN/)
  const continuationState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(continuationState.taskContinuation.status, 'resolved-active')
  assert.strictEqual(continuationState.taskContinuation.candidate.taskId, '6b31500b-f2c4-4f50-9067-d59ad1f806f1')
  assert.strictEqual(continuationState.taskContinuation.capabilityBoundary.payloadExecution, false)
  assert.strictEqual(fs.readFileSync(path.join(continuationTask, '.memory', 'sessions.md'), 'utf8'), continuationSessions)

  const ambiguousTask = path.join(TEMP_ROOT, '.devcodex', 'bugs', 'Hook同名副本')
  fs.mkdirSync(path.join(ambiguousTask, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(ambiguousTask, '.memory', 'task.json'), JSON.stringify({
    schemaVersion: 'TaskIdentityV1',
    taskId: 'be5737e8-905c-4211-9ebc-e38df6da505e',
    displayName: 'Hook续接任务',
    aliases: [],
    createdAt: '2026-07-18T00:00:00.000Z',
    identityRevision: 1
  }, null, 2) + '\n')
  fs.writeFileSync(path.join(ambiguousTask, '.memory', 'sessions.md'), '# duplicate\n\n> **当前状态**: 🔄 active\n')
  const ambiguousContinuation = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'task-continuation-ambiguous',
    prompt: '继续Hook续接任务任务'
  })
  assert.match(ambiguousContinuation.systemMessage || ambiguousContinuation.hookSpecificOutput?.additionalContext || '', /ambiguous|Candidates/i)
  fs.rmSync(continuationTask, { recursive: true, force: true })
  fs.rmSync(ambiguousTask, { recursive: true, force: true })
  cleanState()

  // ISSUE-043 P0: blocked tools never receive a lease; successful tool output
  // becomes awaiting-continuation and a later process invocation rehydrates a
  // stale turn into a single recovery card before starting the new turn.
  cleanState()
  run({ hookEventName: 'UserPromptSubmit', session_id: 'blocked-turn', prompt: 'liveness blocked tool test' })
  run({
    hookEventName: 'PreToolUse',
    tool_use_id: 'blocked-tool',
    tool_name: 'Bash',
    tool_input: { command: 'git reset --hard' }
  })
  let livenessState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(livenessState.turnLiveness.inFlightOperation, null)

  cleanState()
  run({ hookEventName: 'UserPromptSubmit', session_id: 'liveness-turn-1', prompt: 'liveness replay test' })
  runBootstrapReads()
  run({
    hookEventName: 'PreToolUse',
    tool_use_id: 'liveness-tool-1',
    tool_name: 'read_file',
    tool_input: { filePath: 'src/liveness.js' }
  })
  livenessState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(livenessState.turnLiveness.inFlightOperation.operationId, 'liveness-tool-1')
  assert.strictEqual(livenessState.turnLiveness.state, 'running')

  run({
    hookEventName: 'PostToolUse',
    tool_use_id: 'liveness-tool-1',
    tool_name: 'read_file',
    tool_input: { filePath: 'src/liveness.js' },
    success: true
  })
  livenessState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(livenessState.turnLiveness.state, 'awaiting-continuation')
  assert.strictEqual(livenessState.turnLiveness.inFlightOperation, null)
  const staleAt = new Date(Date.now() - DEFAULT_THRESHOLDS.stalledAfterMs - 1000).toISOString()
  livenessState.turnLiveness.lastToolOutputAt = staleAt
  livenessState.turnLiveness.lastEventAt = staleAt
  fs.writeFileSync(STATE_FILE, JSON.stringify(livenessState, null, 2))

  const recoveredTurn = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'liveness-turn-2',
    prompt: 'resume stalled liveness turn'
  })
  assert.match(JSON.stringify(recoveredTurn), /TurnRecoveryCard/)
  livenessState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(livenessState.turnLiveness.turnKey, 'liveness-turn-2')
  assert.strictEqual(livenessState.turnLiveness.previousTurn.terminalState, 'interrupted')
  assert.strictEqual(livenessState.turnLiveness.lastRecoveryCard.priorState, 'stalled-recoverable')
  const recoveredNoticeKey = livenessState.turnLiveness.lastRecoveryNoticeKey

  run({ hookEventName: 'PreCompact', session_id: 'liveness-turn-2' })
  livenessState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(livenessState.turnLiveness.lastRecoveryNoticeKey, recoveredNoticeKey)
  run({ hookEventName: 'Stop', session_id: 'liveness-turn-2', success: true })
  livenessState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(livenessState.turnLiveness.state, 'completed')
  assert.strictEqual(livenessState.turnLiveness.inFlightOperation, null)

  // Auto v1.1: explicit @devcodex-auto or explicit natural-language auto authorization
  // writes executionMode=auto; in safety-only mode, non-whitelisted paths warn instead
  // of hard-blocking.
  cleanState()
  const autoReq = path.join(TEMP_ROOT, '.devcodex', 'requirements', '自动模式需求')
  fs.mkdirSync(path.join(autoReq, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(autoReq, '01-需求概述.md'), '# auto req\n')
  fs.writeFileSync(path.join(autoReq, '.memory', 'sessions.md'), '| CP1 | ✅ |\n')

  run({ hookEventName: 'UserPromptSubmit', prompt: '@devcodex-auto 修复 auto runtime 行为' })
  runBootstrapReads()
  const autoState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(autoState.executionMode, 'auto')

  cleanState()
  run({ hookEventName: 'UserPromptSubmit', prompt: '进入 auto 模式执行规范吸纳' })
  runBootstrapReads()
  const naturalAutoState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(naturalAutoState.executionMode, 'auto')

  cleanState({ mode: 'dev', agent: TEST_AGENT })
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'default-alias-session',
    prompt: '@rocky should enter auto by global default alias'
  })
  runBootstrapReads()
  const defaultAliasState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(defaultAliasState.executionMode, 'auto')
  assert.strictEqual(defaultAliasState.stickyAuto?.active, true)
  assert.strictEqual(defaultAliasState.stickyAuto?.source, '@rocky')

  // Sticky Auto: next turn without @rocky stays auto (same session)
  cleanState({ mode: 'dev', agent: TEST_AGENT })
  const stickyAutoOut1 = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'sticky-auto-session',
    prompt: '@rocky 开始需求'
  })
  assert.ok(
    /ExecutionModeV1:\s*auto/i.test(String(stickyAutoOut1.systemMessage || '')),
    'UserPromptSubmit should inject ExecutionModeV1: auto'
  )
  let stickyAutoState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(stickyAutoState.executionMode, 'auto')
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'sticky-auto-session',
    prompt: '确认'
  })
  stickyAutoState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(stickyAutoState.executionMode, 'auto', 'sticky auto must survive follow-up without @rocky')
  assert.strictEqual(stickyAutoState.stickyAuto?.active, true)

  // Loose CJK adjacency: 请@rocky执行
  cleanState({ mode: 'dev', agent: TEST_AGENT })
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'cjk-auto-session',
    prompt: '请@rocky执行当前需求'
  })
  const cjkAutoState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(cjkAutoState.executionMode, 'auto', 'CJK-adjacent @rocky must enter auto')

  // Explicit exit auto clears sticky
  cleanState({ mode: 'dev', agent: TEST_AGENT })
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'exit-auto-session',
    prompt: '@rocky 进入任务'
  })
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'exit-auto-session',
    prompt: '退出 auto 模式'
  })
  const exitAutoState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(exitAutoState.executionMode, 'confirm')
  assert.strictEqual(exitAutoState.stickyAuto?.active, false)

  // Missing session identity cannot reuse sticky authority from an earlier turn.
  cleanState({ mode: 'dev', agent: TEST_AGENT })
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'omit-session-auto',
    prompt: '@rocky 启动'
  })
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: '继续推进'
  })
  const omitSessionSticky = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(omitSessionSticky.executionMode, 'confirm', 'missing session_id must not inherit sticky auto')

  // Negated aliases and natural-language tokens cannot authorize Auto.
  cleanState({ mode: 'dev', agent: TEST_AGENT })
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'negated-auto-session',
    prompt: '请不要 @rocky 执行，也不要进入 auto 模式'
  })
  const negatedAutoState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(negatedAutoState.executionMode, 'confirm')

  // Explicit different session_id drops sticky
  cleanState({ mode: 'dev', agent: TEST_AGENT })
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'session-a-auto',
    prompt: '@rocky 启动'
  })
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'session-b-auto',
    prompt: '继续推进'
  })
  const crossSessionSticky = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(crossSessionSticky.executionMode, 'confirm', 'different session_id must not inherit sticky auto')

  cleanState({
    mode: 'dev',
    agent: TEST_AGENT,
    extensions: {
      devcodex: {
        autoAliases: ['@maintainer']
      }
    }
  })
  run({ hookEventName: 'UserPromptSubmit', prompt: '@maintainer 修复 Profile auto alias' })
  runBootstrapReads()
  const profileAliasState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(profileAliasState.executionMode, 'auto')

  cleanState({
    mode: 'dev',
    agent: TEST_AGENT,
    extensions: {
      devcodex: {
        autoAliases: ['@maintainer']
      }
    }
  })
  run({ hookEventName: 'UserPromptSubmit', prompt: '@rocky should not enter auto when autoAliases replaces defaults' })
  runBootstrapReads()
  const replacedDefaultAliasState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(replacedDefaultAliasState.executionMode, 'confirm')

  cleanState({
    mode: 'dev',
    agent: TEST_AGENT,
    extensions: {
      devcodex: {
        autoAliases: []
      }
    }
  })
  run({ hookEventName: 'UserPromptSubmit', prompt: '@rocky should not enter auto when autoAliases is an empty replacement' })
  runBootstrapReads()
  const disabledDefaultAliasState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(disabledDefaultAliasState.executionMode, 'confirm')

  cleanState({
    mode: 'dev',
    agent: TEST_AGENT,
    extensions: {
      devcodex: {
        autoAliases: ['rocky', '@auto', '@devcodex', '@bad alias']
      }
    }
  })
  run({ hookEventName: 'UserPromptSubmit', prompt: '@rocky should not enter auto without a valid configured alias' })
  runBootstrapReads()
  const invalidAliasState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(invalidAliasState.executionMode, 'confirm')

  cleanLayoutState(
    { mode: 'prod', agent: TEST_AGENT },
    { mode: 'dev' }
  )
  const layoutChildDefaultAlias = path.join(TEMP_ROOT, 'chat')
  run({ hookEventName: 'UserPromptSubmit', prompt: '@rocky 继续修复 chat 项目' }, layoutChildDefaultAlias)
  runLayoutBootstrapReads(TEST_AGENT, layoutChildDefaultAlias)
  const layoutDefaultAliasState = JSON.parse(fs.readFileSync(getLayoutStateFile(), 'utf8'))
  assert.strictEqual(layoutDefaultAliasState.executionMode, 'auto')

  cleanLayoutState(
    { mode: 'prod', agent: TEST_AGENT },
    {
      mode: 'dev',
      extensions: {
        devcodex: {
          autoAliases: ['@chat-auto']
        }
      }
    }
  )
  const layoutChild = path.join(TEMP_ROOT, 'chat')
  run({ hookEventName: 'UserPromptSubmit', prompt: '@chat-auto 继续修复 chat 项目' }, layoutChild)
  runLayoutBootstrapReads(TEST_AGENT, layoutChild)
  const projectOverlayAliasState = JSON.parse(fs.readFileSync(getLayoutStateFile(), 'utf8'))
  assert.strictEqual(projectOverlayAliasState.executionMode, 'auto')

  cleanState({ mode: 'dev', agent: 'claude-code' })
  run({ hookEventName: 'UserPromptSubmit', prompt: 'Codex bootstrap should prefer current host over profile agent' }, TEMP_ROOT, { CODEX_HOME: '1' })
  run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: { filePath: '.devcodex/profile/config.json' }
  }, TEMP_ROOT, { CODEX_HOME: '1' })
  run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: { filePath: getMemoryFilePath('claude-code', 'SUMMARY.md') }
  }, TEMP_ROOT, { CODEX_HOME: '1' })
  const codexMismatchState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(codexMismatchState.bootstrap.profileRead, true)
  assert.strictEqual(codexMismatchState.bootstrap.summaryRead, false)
  run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: { filePath: getMemoryFilePath('codex', 'SUMMARY.md') }
  }, TEMP_ROOT, { CODEX_HOME: '1' })
  run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: { filePath: getMemoryFilePath('codex', 'tasks', `${getTaskStamp(0)}.md`) }
  }, TEMP_ROOT, { CODEX_HOME: '1' })
  const codexBootstrapState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(codexBootstrapState.bootstrapComplete, false)
  assert.deepStrictEqual(codexBootstrapState.contextAcquisition.legacyObserved, {
    profileRead: true,
    summaryRead: true,
    tasksRead: true,
    bootstrapComplete: false
  }, 'advisory-only raw-file observations must not bypass the structured route/context contract')

  cleanLayoutState(
    { mode: 'prod', agent: TEST_AGENT },
    {
      mode: 'dev',
      extensions: {
        devcodex: {
          autoAliases: ['@rocky']
        }
      }
    }
  )
  run({ hookEventName: 'UserPromptSubmit', prompt: '@rocky restore auto mode after codex bootstrap replay' }, layoutChild)
  runLayoutBootstrapReads(TEST_AGENT, layoutChild)

  const autoWhitelistAllowed = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: README.md\n*** End Patch'
    }
  })
  assert.strictEqual(autoWhitelistAllowed.continue, true)
  assert.ok(!autoWhitelistAllowed.hookSpecificOutput)

  const autoCodexEntryAllowed = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: AGENTS.md\n*** End Patch'
    }
  })
  assert.strictEqual(autoCodexEntryAllowed.continue, true)
  assert.ok(!autoCodexEntryAllowed.hookSpecificOutput)

  const autoCodexSkillAllowed = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: .agents/skills/compliance/SKILL.md\n*** End Patch'
    }
  })
  assert.strictEqual(autoCodexSkillAllowed.continue, true)
  assert.ok(!autoCodexSkillAllowed.hookSpecificOutput)

  const autoCodexHookAllowed = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: .codex/hooks.json\n*** End Patch'
    }
  })
  assert.strictEqual(autoCodexHookAllowed.continue, true)
  assert.ok(!autoCodexHookAllowed.hookSpecificOutput)

  const autoNonWhitelistWarning = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: src/foo.js\n*** End Patch'
    }
  })
  assert.strictEqual(autoNonWhitelistWarning.continue, true)
  assert.match(autoNonWhitelistWarning.systemMessage || '', /白名单|whitelist/i)

  const autoNonWhitelistBlockedStrict = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: src/foo.js\n*** End Patch'
    }
  }, TEMP_ROOT, { DEVCODEX_HOOK_ENFORCEMENT: 'strict' })
  assert.strictEqual(autoNonWhitelistBlockedStrict.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(autoNonWhitelistBlockedStrict.hookSpecificOutput.additionalContext || '', /白名单|whitelist/i)

  const autoDangerousCommand = run({
    hookEventName: 'PreToolUse',
    tool_name: 'run_in_terminal',
    tool_input: {
      command: 'git reset --hard HEAD~1'
    }
  })
  assert.strictEqual(autoDangerousCommand.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(autoDangerousCommand.hookSpecificOutput.permissionDecisionReason || '', /git reset --hard/i)

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Need a root cure for dev mode drift.'
  })
  runBootstrapReads()

  // Archive marker bypass test: in safety-only mode, unfinished requirements warn instead of blocking;
  // archived requirements should not even warn.
  const reqDir = path.join(TEMP_ROOT, '.devcodex', 'requirements', '历史归档需求')
  fs.mkdirSync(path.join(reqDir, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(reqDir, '01-需求概述.md'), '# req\n')
  fs.writeFileSync(path.join(reqDir, '.memory', 'sessions.md'), '| CP1 | ✅ |\n')
  const warningByOldReq = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/app.js\n*** End Patch' }
  })
  assert.strictEqual(warningByOldReq.continue, true)
  assert.match(warningByOldReq.systemMessage || '', /CP gate/i)
  const blockedByOldReqStrict = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/app.js\n*** End Patch' }
  }, TEMP_ROOT, { DEVCODEX_HOOK_ENFORCEMENT: 'strict' })
  assert.strictEqual(blockedByOldReqStrict.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(blockedByOldReqStrict.hookSpecificOutput.permissionDecisionReason || '', /CP gate/i)
  fs.writeFileSync(path.join(reqDir, '.archived'), '')
  const allowedAfterArchive = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/app.js\n*** End Patch' }
  })
  assert.strictEqual(allowedAfterArchive.continue, true)
  assert.ok(!allowedAfterArchive.hookSpecificOutput)

  // v1.9.4+ Cross-requirement bypass test:
  // An unfinished requirement should keep warning on global src/ mutations
  // even if another requirement has already entered implementation.
  cleanState()
  const reqIncomplete = path.join(TEMP_ROOT, '.devcodex', 'requirements', '陈旧未完成需求')
  fs.mkdirSync(path.join(reqIncomplete, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(reqIncomplete, '01-需求概述.md'), '# stale\n')
  fs.writeFileSync(path.join(reqIncomplete, '.memory', 'sessions.md'), '| CP1 | ✅ |\n')

  // Bootstrap first so we can test CP gate cleanly
  run({ hookEventName: 'UserPromptSubmit', prompt: 'cross-req test' })
  runBootstrapReads()

  // Without any CP3-done requirement: src/ mutation warns in safety-only mode.
  const warningNoCp3 = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/foo.js\n*** End Patch' }
  })
  assert.strictEqual(warningNoCp3.continue, true)
  assert.match(warningNoCp3.systemMessage || '', /CP gate/i)

  // Add a second requirement that has CP3 confirmed → stale unfinished task must still block
  const reqDone = path.join(TEMP_ROOT, '.devcodex', 'requirements', '当前实施需求')
  fs.mkdirSync(path.join(reqDone, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(reqDone, '01-需求概述.md'), '# done\n')
  fs.writeFileSync(path.join(reqDone, '02-技术方案.md'), '# plan\n')
  fs.writeFileSync(path.join(reqDone, '04-实施计划.md'), '# impl\n')
  fs.writeFileSync(
    path.join(reqDone, '.memory', 'sessions.md'),
    '| CP1 | ✅ |\n| CP2 | ✅ |\n| CP3 | ✅ |\n'
  )

  const warningCrossReq = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/foo.js\n*** End Patch' }
  })
  assert.strictEqual(warningCrossReq.continue, true,
    'global src/ mutation should warn while a newer unfinished task still lacks CP3')
  assert.match(warningCrossReq.systemMessage || '', /CP gate/i)

  // Path-aware test: writing inside reqIncomplete dir while reqDone has CP3
  // should remain allowed because task artifact writes are not source mutations.
  const allowedInReqDir = run({
    hookEventName: 'PreToolUse',
    tool_name: 'Write',  // Claude Code PascalCase tool
    tool_input: {
      file_path: path.join(reqIncomplete, '02-技术方案.md'),
      content: '# new plan\n'
    }
  })
  assert.strictEqual(allowedInReqDir.continue, true)

  // CP3 N/A exemptions for docs/init should not keep old requirements blocking later source work.
  cleanState()
  const reqDocsExempt = path.join(TEMP_ROOT, '.devcodex', 'requirements', '文档任务')
  fs.mkdirSync(path.join(reqDocsExempt, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(reqDocsExempt, '01-需求概述.md'), '# docs\n')
  fs.writeFileSync(path.join(reqDocsExempt, '02-技术方案.md'), '# outline\n')
  fs.writeFileSync(
    path.join(reqDocsExempt, '.memory', 'sessions.md'),
    '| CP1 | ✅ |\n| CP2 | ✅ |\nCP3: N/A（docs 子类型豁免）\n'
  )
  run({ hookEventName: 'UserPromptSubmit', prompt: 'cp3 exemption test' })
  runBootstrapReads()
  const allowedAfterCp3Exempt = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/exempt.js\n*** End Patch' }
  })
  assert.strictEqual(allowedAfterCp3Exempt.continue, true)

  // bug task support: unfinished bug task should warn on source mutation until CP2 is complete
  cleanState()
  const bugDir = path.join(TEMP_ROOT, '.devcodex', 'bugs', 'MCP全链路收口')
  fs.mkdirSync(path.join(bugDir, '.memory'), { recursive: true })
  fs.mkdirSync(path.join(bugDir, 'reports', 'claude-code', getTaskStamp(0)), { recursive: true })
  fs.writeFileSync(
    path.join(bugDir, 'reports', 'claude-code', getTaskStamp(0), '01--问题确认与CP1.md'),
    '# cp1\n'
  )
  fs.writeFileSync(path.join(bugDir, '.memory', 'sessions.md'), '| CP1 | ✅ |\n')
  run({ hookEventName: 'UserPromptSubmit', prompt: 'bug task gate test' })
  runBootstrapReads()
  const warningBugTask = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/bug.js\n*** End Patch' }
  })
  assert.strictEqual(warningBugTask.continue, true)
  assert.match(warningBugTask.systemMessage || '', /CP gate/i)

  // bug task with CP2 complete but no CP3 should allow source mutation until runtime threshold is hit
  fs.writeFileSync(
    path.join(bugDir, 'reports', 'claude-code', getTaskStamp(0), '02--技术方案与CP2.md'),
    '# cp2\n'
  )
  fs.writeFileSync(
    path.join(bugDir, '.memory', 'sessions.md'),
    '| CP1 | ✅ |\n| CP2 | ✅ |\n'
  )
  for (const fileName of ['bug-1.js', 'bug-2.js', 'bug-3.js', 'bug-4.js']) {
    const allowedBugTask = run({
      hookEventName: 'PreToolUse',
      tool_name: 'apply_patch',
      tool_input: { input: `*** Begin Patch\n*** Update File: src/${fileName}\n*** End Patch` }
    })
    assert.strictEqual(allowedBugTask.continue, true)
    assert.ok(!/CP gate/i.test(allowedBugTask.systemMessage || ''), 'runtime threshold should not warn before the 5th unique source file')
  }

  const bugRuntimeState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  const bugRuntimeRecord = Object.values(bugRuntimeState.cp3Runtime || {}).find(entry => entry && entry.name === 'MCP全链路收口')
  assert.ok(bugRuntimeRecord, 'runtime CP3 tracking record should exist for bug task')
  assert.strictEqual((bugRuntimeRecord.trackedFiles || []).length, 4)

  const warningBugThreshold = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/bug-5.js\n*** End Patch' }
  })
  assert.strictEqual(warningBugThreshold.continue, true)
  assert.match(warningBugThreshold.systemMessage || '', /执行中已触达 5 个源码\/配置文件/)

  const blockedBugThresholdStrict = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/bug-5.js\n*** End Patch' }
  }, TEMP_ROOT, { DEVCODEX_HOOK_ENFORCEMENT: 'strict' })
  assert.strictEqual(blockedBugThresholdStrict.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(blockedBugThresholdStrict.hookSpecificOutput.permissionDecisionReason || '', /CP gate/i)
  assert.ok(readInterceptionEntries().some(entry =>
    entry.code === 'cp-gate-CP3-runtime-threshold' &&
    entry.effective === true
  ))

  // bug task with CP3 complete should allow source mutation again
  fs.writeFileSync(path.join(bugDir, '04-实施计划.md'), '# cp3\n')
  fs.writeFileSync(
    path.join(bugDir, '.memory', 'sessions.md'),
    '| CP1 | ✅ |\n| CP2 | ✅ |\n| CP3 | ✅ |\n'
  )
  const allowedAfterBugCp3 = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/bug-after-cp3.js\n*** End Patch' }
  })
  assert.strictEqual(allowedAfterBugCp3.continue, true)

  // Dual-Track M1: orphan control-plane mutation when no CP1-bound task exists
  cleanState()
  // remove leftover tasks under temp .devcodex if any (cleanState may keep root)
  const tempDev = path.join(TEMP_ROOT, '.devcodex')
  for (const kind of ['requirements', 'bugs', 'optimizations', 'scenario-tests']) {
    const root = path.join(tempDev, kind)
    if (!fs.existsSync(root)) continue
    for (const name of fs.readdirSync(root)) {
      fs.rmSync(path.join(root, name), { recursive: true, force: true })
    }
  }
  run({ hookEventName: 'UserPromptSubmit', prompt: 'orphan control-plane gate test' })
  runBootstrapReads()
  const orphanWarn = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: scripts/lib/orphan-probe.js\n*** End Patch' }
  })
  assert.strictEqual(orphanWarn.continue, true)
  assert.match(orphanWarn.systemMessage || '', /orphan|控制面|no-bound-task|CP gate/i)

  // extended task roots: optimizations and scenario-tests must also participate in CP gate.
  cleanState()
  const optimizationDir = path.join(TEMP_ROOT, '.devcodex', 'optimizations', '性能优化任务')
  fs.mkdirSync(path.join(optimizationDir, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(optimizationDir, '01-需求概述.md'), '# optimization\n')
  fs.writeFileSync(path.join(optimizationDir, '.memory', 'sessions.md'), '| CP1 | ✅ |\n| CP2 | ✅ |\n')
  run({ hookEventName: 'UserPromptSubmit', prompt: 'optimization task gate test' })
  runBootstrapReads()
  const warningOptimizationTask = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/perf.js\n*** End Patch' }
  })
  assert.strictEqual(warningOptimizationTask.continue, true)
  assert.match(warningOptimizationTask.systemMessage || '', /CP gate/i)

  cleanState()
  const scenarioDir = path.join(TEMP_ROOT, '.devcodex', 'scenario-tests', '端到端任务')
  fs.mkdirSync(path.join(scenarioDir, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(scenarioDir, '01-需求概述.md'), '# scenario\n')
  fs.writeFileSync(path.join(scenarioDir, '.memory', 'sessions.md'), '| CP1 | ✅ |\n| CP2 | ✅ |\n')
  run({ hookEventName: 'UserPromptSubmit', prompt: 'scenario task gate test' })
  runBootstrapReads()
  const warningScenarioTask = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/e2e.js\n*** End Patch' }
  })
  assert.strictEqual(warningScenarioTask.continue, true)
  assert.match(warningScenarioTask.systemMessage || '', /CP gate/i)

  // F-008 (v1.9.5): DEVCODEX_PATH_RE 边缘场景测试
  // Bootstrap a fresh workspace
  cleanState()
  run({ hookEventName: 'UserPromptSubmit', prompt: 'F-008 path-regex tests' })
  runBootstrapReads()

  // F-001: bash 写 .claude/foo.js（非 governance 子路径）应被视为 source mutation → 触发 CP gate
  const bashWriteClaude = run({
    hookEventName: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'echo "console.log(1)" > .claude/foo.js' }
  })
  // 无 incomplete requirement → 应该允许（CP gate 不触发，但 isSourceCodeMutation 应返回 true，hooks 仍可放行；此处仅断言非崩溃）
  assert.ok(bashWriteClaude.continue === true || bashWriteClaude.hookSpecificOutput)

  // F-001: bash 写 .claude/instructions/foo.md（governance 子路径）应被放行
  const bashWriteGovernance = run({
    hookEventName: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'echo "# test" > .claude/instructions/foo.md' }
  })
  assert.strictEqual(bashWriteGovernance.continue, true)

  const bashWriteCodexGovernance = run({
    hookEventName: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'echo "# test" > AGENTS.md && echo "# test" > .agents/skills/foo/SKILL.md && echo "{}" > .codex/hooks.json && echo "{}" > codex/hooks.json' }
  })
  assert.strictEqual(bashWriteCodexGovernance.continue, true)

  // F-006: bash cp src.js dest.js 命令路径提取
  const bashCp = run({
    hookEventName: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'cp src/a.js src/b.js' }
  })
  assert.ok(bashCp.continue === true || bashCp.hookSpecificOutput)

  cleanState()
  process.stdout.write('hooks runtime smoke test passed\n')
}

main()
