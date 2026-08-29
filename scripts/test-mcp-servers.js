#!/usr/bin/env node
'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { listControlDeliveryEntries } = require('./lib/control-content-delivery')
const {
  buildExtendedCpTable,
  parseCpSessions
} = require('./lib/cp-digest')
const {
  CONTEXT_READ_CONTRACT,
  validateContextReadPlan
} = require('../hooks/_runtime/context-read-contract.cjs')
const {
  buildJsonContentIdentity,
  validateContentIdentity
} = require('../hooks/_runtime/content-identity.cjs')
const {
  authorizeContextRead,
  recordMcpContextSourceObservations
} = require('../hooks/_runtime/context-source-observation.cjs')
const {
  deriveTurnBinding,
  loadEnvelope
} = require('../hooks/_runtime/skill-route-state.cjs')
const {
  buildActualInstructionEnvelope,
  buildWorkItemSet
} = require('../hooks/_runtime/actual-instruction-envelope.cjs')
const { buildWorkflowRouteDecision } = require('../hooks/_runtime/workflow-route-decision-v2.cjs')
const { createWorkspaceSessionRouteIndex } = require('../hooks/_runtime/workspace-session-route-index-v1.cjs')
const { extractMutationFootprint } = require('../hooks/_runtime/mutation-footprint.cjs')
const { decideArtifactMutation } = require('../hooks/_runtime/artifact-slot-decision.cjs')
const {
  createMutationPreObservation,
  createTaskOwnedMutationLease,
  observeMutationEffects,
  projectMutationFootprintForRecovery
} = require('../hooks/_runtime/mutation-observation.cjs')
const {
  computeProjectTargetLeaseDigest,
  createTaskIdentityV2,
  executeTaskAdmission,
  executeTaskWriteOwner,
  executeWorkflowTaskTerminal
} = require('../mcp/task-admission-authority.cjs')
const {
  readFencedTaskWriteOwner,
  resolveTaskRecoveryMetaDir,
  storePaths,
  updateTaskRecoveryState,
  writeEmergencyCloseout
} = require('../hooks/_runtime/task-recovery-store-v5.cjs')
const { readBoundedTextFileSync } = require('../mcp/bounded-text-reader.cjs')
const { selectProfileSectionsFromFileSync } = require('../mcp/profile-section-selector.cjs')
const { createLinkCapabilityDecision } = require('../hooks/_runtime/visible-output-contract.cjs')
const workflowRouteRegistryV2 = require('../hooks/_runtime/workflow-root-registry.v2.json')
const {
  createOptimizationState,
  persistOptimizationState
} = require('./lib/execution-optimization')
const { CLAUDE_MCP_JSON } = require('../index.js')

const ROOT = path.resolve(__dirname, '..')
const TEMP_ROOT = path.join(os.tmpdir(), `devcodex-mcp-test-${process.pid}`)
const PROFILE_TRACE_TIMEOUT_MS = 30_000
const PROFILE_TRACE_MAX_BYTES = 1024 * 1024

function rpcRequest(id, method, params = {}) {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params })
}

function assertMemoryProjectionIdentity(value, toolName) {
  assert.strictEqual(validateContentIdentity(value.contentIdentity).valid, true)
  const projection = Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['contentIdentity', 'telemetry', 'contextObservation'].includes(key)))
  const expected = buildJsonContentIdentity({
    sourceKey: `memory://${value.project || value.source?.project}/${toolName}#delivered`,
    value: projection,
    contractVersion: value.schemaVersion
  }).identity
  assert.deepStrictEqual(value.contentIdentity, expected)
  assert.strictEqual(value.contextObservation.schemaVersion, 'ContextSourceObservationWriteReceiptV1')
  assert(['persisted', 'degraded', 'skipped'].includes(value.contextObservation.status))
}

function runServer(script, requests, cwd = ROOT, env = {}) {
  const input = requests.concat('').join('\n')
  // Neutralize ambient host signals (e.g. developer GROK_AGENT) so identity is test-controlled.
  // Default pin DEVCODEX_AGENT=claude-code for suite stability; callers may override or clear.
  const mergedEnv = {
    ...process.env,
    GROK_AGENT: '',
    GROK_HOME: '',
    GROK_SESSION: '',
    GROK_SESSION_ID: '',
    GROK_BUILD: '',
    XAI_GROK: '',
    XAI_AGENT: '',
    DEVCODEX_AGENT: 'claude-code',
    ...env
  }
  if (Object.prototype.hasOwnProperty.call(env, 'DEVCODEX_AGENT')) {
    mergedEnv.DEVCODEX_AGENT = env.DEVCODEX_AGENT
  }
  const result = spawnSync(process.execPath, [path.join(ROOT, script), cwd], {
    cwd: ROOT,
    input,
    encoding: 'utf8',
    env: mergedEnv
  })

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${script} exited with failure`).trim())
  }

  return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
}

const GOVERNED_CONTEXT_READ_TOOLS = new Set([
  'profile_load',
  'profile_skill_plan',
  'memory_status',
  'memory_session_query',
  'memory_summary_query',
  'memory_session_read',
  'memory_summary_read'
])

function createTestContextBinding(cwd = ROOT, options = {}) {
  const contextEpoch = options.contextEpoch || `test-context-${crypto.randomUUID()}`
  const intent = options.intent || 'resume'
  const planArgs = {
    intent,
    contextEpoch,
    ...(options.project ? { project: options.project } : {}),
    ...(options.scope ? { scope: options.scope } : {}),
    ...(options.explicitFull
      ? {
          explicitFull: true,
          fullReadReason: options.fullReadReason || 'MCP test requires an explicitly authorized Profile corpus.',
          configLocalRequested: true
        }
      : {}),
    ...(Array.isArray(options.profileSelectors) ? { profileSelectors: options.profileSelectors } : {})
  }
  const responses = runServer('mcp/profile-server.js', [
    rpcRequest(991, 'tools/call', {
      name: 'profile_context_plan',
      arguments: planArgs
    })
  ], cwd, options.env || {})
  const result = resultById(responses, 991)
  if (result.isError) {
    throw new Error(`test ContextReadPlan creation failed: ${result.content?.[0]?.text || 'unknown error'}`)
  }
  return toolJson(result).contextBinding
}

function bindGovernedContextReads(requests, contextBinding) {
  return requests.map(line => {
    const request = JSON.parse(line)
    const toolName = request.params?.name
    if (request.method !== 'tools/call' || !GOVERNED_CONTEXT_READ_TOOLS.has(toolName)) return line
    if (!request.params.arguments || typeof request.params.arguments !== 'object' ||
        Array.isArray(request.params.arguments)) return line
    const args = request.params.arguments
    if (!Object.prototype.hasOwnProperty.call(args, 'contextBinding')) {
      request.params.arguments = { ...args, contextBinding }
    }
    return JSON.stringify(request)
  })
}

function findToolSchema(listed, name) {
  const tool = listed.find(item => item.name === name)
  assert.ok(tool, `${name} tool must be listed`)
  return tool.inputSchema
}

function findSkillRouteOpSchema(schema, op) {
  const variant = (schema.oneOf || []).find(item => item.properties?.op?.const === op)
  assert.ok(variant, `skill_route schema must include ${op} operation`)
  return variant
}

function compactDateInTimeZone(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}${values.month}${values.day}`
}

function runConfiguredServer(server, requests, cwd = ROOT) {
  const command = server.command === 'node' ? process.execPath : server.command
  const input = requests.concat('').join('\n')
  const result = spawnSync(command, server.args || [], {
    cwd,
    input,
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, ...(server.env || {}) }
  })

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${server.command} exited with failure`).trim())
  }

  return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
}

function runProfileServerWithReadTrace(requests, cwd) {
  const wrapperPath = path.join(TEMP_ROOT, 'profile-read-trace-hook.cjs')
  const tracePath = path.join(TEMP_ROOT, `profile-read-trace-${Date.now()}-${Math.random().toString(16).slice(2)}.jsonl`)
  fs.writeFileSync(wrapperPath, [
    "'use strict'",
    "const fs = require('fs')",
    "const originalReadFileSync = fs.readFileSync.bind(fs)",
    "const originalOpenSync = fs.openSync.bind(fs)",
    "const originalAppendFileSync = fs.appendFileSync.bind(fs)",
    "let tracing = false",
    "function trace(file) {",
    "  if (tracing || String(file) === process.env.DEVCODEX_READ_TRACE) return",
    "  tracing = true",
    "  try { originalAppendFileSync(process.env.DEVCODEX_READ_TRACE, JSON.stringify(String(file)) + '\\n') } catch {} finally { tracing = false }",
    "}",
    "fs.readFileSync = function tracedReadFileSync(file, ...args) {",
    "  trace(file)",
    "  return originalReadFileSync(file, ...args)",
    "}",
    "fs.openSync = function tracedOpenSync(file, ...args) {",
    "  trace(file)",
    "  return originalOpenSync(file, ...args)",
    "}"
  ].join('\n'))
  const input = requests.concat('').join('\n')
  const result = spawnSync(process.execPath, ['--require', wrapperPath, path.join(ROOT, 'mcp', 'profile-server.js'), cwd], {
    cwd: ROOT,
    input,
    encoding: 'utf8',
    env: { ...process.env, DEVCODEX_READ_TRACE: tracePath },
    timeout: PROFILE_TRACE_TIMEOUT_MS
  })
  if (result.error?.code === 'ETIMEDOUT') {
    throw new Error(`profile trace server exceeded ${PROFILE_TRACE_TIMEOUT_MS}ms`)
  }
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || result.error?.message || 'profile trace server failed').trim())
  const traceBytes = fs.existsSync(tracePath) ? fs.statSync(tracePath).size : 0
  assert.ok(
    traceBytes <= PROFILE_TRACE_MAX_BYTES,
    `profile read trace exceeded ${PROFILE_TRACE_MAX_BYTES} bytes: ${traceBytes}`
  )
  const responses = result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
  const reads = fs.existsSync(tracePath)
    ? fs.readFileSync(tracePath, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
    : []
  return { responses, reads }
}

function setupConfiguredMcpTarget() {
  const targetRoot = path.join(TEMP_ROOT, 'configured-target')
  fs.mkdirSync(path.join(targetRoot, '.claude', 'mcp'), { recursive: true })
  fs.mkdirSync(path.join(targetRoot, '.claude', 'hooks', '_runtime'), { recursive: true })
  fs.mkdirSync(path.join(targetRoot, '.claude', 'skills'), { recursive: true })
  const profileRoot = path.join(targetRoot, '.devcodex', 'profile')
  fs.mkdirSync(profileRoot, { recursive: true })
  fs.writeFileSync(path.join(profileRoot, 'README.md'), [
    '# Configured target Profile',
    '',
    '> Profile 档位：`profile-lite`。',
    '',
    '| 文件 | 说明 | 必须 |',
    '|------|------|:----:|',
    '| `01-项目信息.md` | project | ✅ |',
    '| `02-架构约束.md` | architecture | ✅ |',
    '| `03-代码风格.md` | style | ✅ |'
  ].join('\n'))
  for (const file of ['01-项目信息.md', '02-架构约束.md', '03-代码风格.md']) {
    fs.writeFileSync(path.join(profileRoot, file), `# ${file}\n`)
  }
  const configuredMcp = JSON.parse(JSON.stringify(CLAUDE_MCP_JSON))
  configuredMcp.mcpServers['devcodex-profile'].env = {
    DEVCODEX_GLOBAL_SKILLS_RUNTIME: path.join(targetRoot, '.claude', 'skills')
  }
  fs.writeFileSync(
    path.join(targetRoot, '.mcp.json'),
    `${JSON.stringify(configuredMcp, null, 2)}\n`
  )
  fs.cpSync(
    path.join(ROOT, 'mcp'),
    path.join(targetRoot, '.claude', 'mcp'),
    { recursive: true }
  )
  fs.cpSync(
    path.join(ROOT, 'hooks', '_runtime'),
    path.join(targetRoot, '.claude', 'hooks', '_runtime'),
    { recursive: true }
  )
  // Deploy MCP runtime script deps under .claude/scripts/lib
  for (const rel of [
    'scripts/lib/cp-digest.js',
    'scripts/lib/host-parity-scorecard.js',
    'scripts/lib/global-adapter-refresh-guidance.js',
    'scripts/lib/global-host-target.js',
    'scripts/lib/derived-index-contract.js',
    'scripts/lib/memory-index.js',
    'scripts/lib/memory-summary-state.js',
    'scripts/lib/summary-type-canon.js'
  ]) {
    const dest = path.join(targetRoot, '.claude', ...rel.split('/'))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(path.join(ROOT, ...rel.split('/')), dest)
  }
  for (const entry of listControlDeliveryEntries(ROOT, 'skills')) {
    const destination = path.join(targetRoot, '.claude', 'skills', ...entry.relative.split('/'))
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, entry.content, 'utf8')
  }
  fs.copyFileSync(
    path.join(ROOT, 'hooks', '_runtime', 'workspace-layout.cjs'),
    path.join(targetRoot, '.claude', 'hooks', '_runtime', 'workspace-layout.cjs')
  )
  fs.copyFileSync(
    path.join(ROOT, 'hooks', '_runtime', 'context-read-contract.cjs'),
    path.join(targetRoot, '.claude', 'hooks', '_runtime', 'context-read-contract.cjs')
  )
  for (const file of ['content-identity.cjs', 'derived-state-store.cjs', 'execution-optimization-routing.cjs', 'task-continuation-contract.cjs']) {
    fs.copyFileSync(
      path.join(ROOT, 'hooks', '_runtime', file),
      path.join(targetRoot, '.claude', 'hooks', '_runtime', file)
    )
  }
  fs.copyFileSync(
    path.join(ROOT, 'hooks', '_runtime', 'global-skill-runtime-root.cjs'),
    path.join(targetRoot, '.claude', 'hooks', '_runtime', 'global-skill-runtime-root.cjs')
  )
  return targetRoot
}

function resultById(responses, id) {
  const response = responses.find(item => item.id === id)
  assert.ok(response, `missing JSON-RPC response id=${id}`)
  assert.ifError(response.error)
  return response.result
}

function toolJson(result) {
  const text = result.content?.[0]?.text || ''
  assert(text, 'expected a JSON MCP text result')
  return JSON.parse(text)
}

function memoryTransactionJson(result) {
  const text = result.content?.[0]?.text || ''
  const jsonLine = text.split(/\r?\n/).filter(Boolean).at(-1)
  assert(jsonLine, 'expected a memory transaction JSON receipt')
  return JSON.parse(jsonLine)
}

function allocateMemorySession(cwd, argumentsValue, env = {}) {
  const responses = runServer('mcp/memory-server.js', [
    rpcRequest(9000, 'tools/call', {
      name: 'memory_session_allocate',
      arguments: argumentsValue
    })
  ], cwd, env)
  const result = resultById(responses, 9000)
  assert.notStrictEqual(result.isError, true, result.content?.[0]?.text || 'allocation failed')
  const allocation = toolJson(result)
  assert.deepStrictEqual(result.structuredContent, allocation)
  return allocation
}

function profileReadBasenames(reads) {
  const profileSegment = `${path.sep}profile${path.sep}`.toLowerCase()
  return reads
    .map(item => path.resolve(item))
    .filter(item => item.toLowerCase().startsWith(path.resolve(TEMP_ROOT).toLowerCase()))
    .filter(item => item.toLowerCase().includes(profileSegment))
    .map(item => path.basename(item))
}

function setupLegacyWorkspace() {
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
  fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'profile'), { recursive: true })
  fs.writeFileSync(path.join(TEMP_ROOT, 'CLAUDE.md'), '# CLAUDE.md\n\nDevCodex rules\n')
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'profile', 'README.md'), '# Profile\n\n> Profile 档位：`profile-closed-loop`。\n')
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'profile', '01-项目信息.md'), '# 01-项目信息\n')
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'profile', '02-架构约束.md'), '# 02-架构约束\n')
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'profile', '03-代码风格.md'), '# 03-代码风格\n')
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'profile', '04-测试规范.md'), '# 04-测试规范\n')
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'profile', '05-发布规范.md'), '# 05-发布规范\n')
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'profile', '06-功能清单.md'), '# 06-功能清单\n')
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'profile', '07-用户文档与契约规范.md'), '# 07-用户文档与契约规范\n')
  fs.writeFileSync(
    path.join(TEMP_ROOT, '.devcodex', 'profile', 'config.json'),
    JSON.stringify({ mode: 'dev', agent: 'claude-code' })
  )
  fs.writeFileSync(
    path.join(TEMP_ROOT, '.devcodex', 'profile', 'config.local.json'),
    JSON.stringify({ connections: { local: { connectionString: 'postgres://local-user:local-password@127.0.0.1:5432/local' } } }, null, 2)
  )
}

function writeSparseFile(filePath, size, prefix = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const descriptor = fs.openSync(filePath, 'w')
  try {
    if (prefix) fs.writeSync(descriptor, Buffer.from(prefix, 'utf8'))
    fs.ftruncateSync(descriptor, size)
  } finally {
    fs.closeSync(descriptor)
  }
}

function snapshotFiles(paths) {
  return paths.map(filePath => {
    const stat = fs.statSync(filePath)
    return {
      path: path.relative(TEMP_ROOT, filePath),
      content: fs.readFileSync(filePath, 'utf8'),
      size: stat.size,
      mtimeMs: stat.mtimeMs
    }
  })
}

function snapshotTree(root) {
  const files = []
  function visit(directory) {
    if (!fs.existsSync(directory)) return
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) files.push(absolute)
    }
  }
  visit(root)
  return snapshotFiles(files.sort())
}

function setupMemoryProjectionFixture() {
  setupLegacyWorkspace()
  const clientRoot = path.join(TEMP_ROOT, '.devcodex', '.memory', 'clients', 'claude-code')
  const tasksRoot = path.join(clientRoot, 'tasks')
  fs.mkdirSync(tasksRoot, { recursive: true })
  const todayPath = path.join(tasksRoot, '20260717.md')
  const yesterdayPath = path.join(tasksRoot, '20260716.md')
  const summaryPath = path.join(clientRoot, 'SUMMARY.md')
  const todayContent = [
    '# 2026-07-17 任务记录',
    '',
    '## 会话 02 - 已完成任务',
    '',
    '状态：✅ 已完成',
    '',
    'COMPLETED-BODY-SENTINEL',
    '',
    '### ContextHandoffCard',
    '',
    '- next-action：none',
    '',
    '## 会话 03 - 当前任务',
    '',
    '状态：🔄 进行中',
    '',
    '### ContextHandoffCard',
    '',
    '- next-action：STALE-NEXT-ACTION-MUST-NOT-LEAK',
    '',
    '### 工作正文',
    '',
    'ACTIVE-BODY-SENTINEL ' + 'x'.repeat(180),
    '',
    '### ContextHandoffCard',
    '',
    '- source-of-truth：CURRENT-SOURCE',
    '- next-action：NEXT-ACTION-SENTINEL',
    '- blocked-reason：none',
    '',
    '### 其他',
    '',
    'HANDOFF-TAIL-MUST-NOT-LEAK',
    ''
  ].join('\n')
  const yesterdayContent = [
    '# 2026-07-16 任务记录',
    '',
    '## 会话 04 - 阻塞任务',
    '',
    '状态：⛔ 阻塞',
    '',
    'BLOCKED-BODY-SENTINEL',
    ''
  ].join('\n')
  const summaryContent = [
    '# Agent SUMMARY — claude-code',
    '',
    '> 项目：fixture',
    '',
    '| 日期 | 会话 | 类型 | 摘要 | 关联报告 | 关联记忆 | 状态 |',
    '|------|:----:|------|------|---------|---------|:----:|',
    '| 2026-07-14 09:00 | 01 | dev | completed fixture | — | — | ✅ |',
    '| 2026-07-16 10:00 | 04 | resume | blocked fixture | — | — | ⛔ |',
    '| 2026-07-17 10:00 | 03 | dev | active fixture with `manual|auto` mode | report-a | memory-a | 🔄 |',
    '| 2026-07-17 10:05 | 03 | dev | completion event fixture | report-b | memory-b | ✅ |',
    '| 2026-07-17 10:06 | legacy descriptive session | analyze | historical label fixture | report-c | memory-c | ✅ |',
    ''
  ].join('\n')
  fs.writeFileSync(todayPath, todayContent)
  fs.writeFileSync(yesterdayPath, yesterdayContent)
  fs.writeFileSync(summaryPath, summaryContent)
  return {
    paths: [todayPath, yesterdayPath, summaryPath],
    todayPath,
    yesterdayPath,
    summaryPath,
    todayContent,
    yesterdayContent,
    summaryContent
  }
}

function fullDailyActiveSessionOracle(content) {
  return String(content).split(/(?=^##\s+会话\s+)/m)
    .filter(section => /^##\s+会话\s+/m.test(section) && /^状态[：:].*🔄/m.test(section))
    .map(section => {
      const match = /^##\s+会话\s+([^\s—-]+)/m.exec(section)
      return match ? match[1].padStart(2, '0') : ''
    })
    .filter(Boolean)
}

function fullSummaryUnresolvedOracle(content, since) {
  const current = new Map()
  String(content).split(/\r?\n/)
    .filter(line => /^\|\s*\d{4}-\d{2}-\d{2}/.test(line))
    .forEach((line, index) => {
      const cells = line.split('|').slice(1, -1).map(cell => cell.trim())
      const key = `${cells[0].slice(0, 10)}#${cells[1].padStart(2, '0')}`
      current.set(key, { key, day: cells[0].slice(0, 10), unresolved: /(?:🔄|⛔)\s*\|\s*$/.test(line), index })
    })
  return [...current.values()]
    .filter(item => item.unresolved && (!since || item.day >= since))
    .sort((left, right) => right.index - left.index)
    .map(item => item.key)
}

function setupLayoutWorkspace() {
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
  fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'workspace', 'profile'), { recursive: true })
  fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'chat', 'profile'), { recursive: true })
  fs.mkdirSync(path.join(TEMP_ROOT, 'chat'), { recursive: true })
  fs.writeFileSync(path.join(TEMP_ROOT, 'chat', 'package.json'), '{}')
  fs.writeFileSync(path.join(TEMP_ROOT, 'CLAUDE.md'), '# CLAUDE.md\n\nWorkspace rules\n')
  fs.writeFileSync(
    path.join(TEMP_ROOT, '.devcodex', 'layout.json'),
    JSON.stringify({ version: 1, mode: 'workspace-namespace' }, null, 2)
  )
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'workspace', 'profile', 'README.md'), '# workspace README\n')
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'workspace', 'profile', '01-项目信息.md'), '# workspace 01\n')
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'workspace', 'profile', '02-架构约束.md'), '# workspace 02\n')
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'workspace', 'profile', '03-代码风格.md'), '# workspace 03\n')
  fs.writeFileSync(
    path.join(TEMP_ROOT, '.devcodex', 'workspace', 'profile', 'config.json'),
    JSON.stringify({
      mode: 'prod',
      agent: 'claude-code',
      flags: { read: true, write: false },
      tags: ['workspace'],
      extensions: {
        devcodex: {
          workflowCompletion: { mode: 'shadow' },
          git: {
            collaborationMode: 'unverified',
            branchPolicy: 'no-auto-branch',
            worktreePolicy: 'explicit-only',
            crossBranchIntegration: 'unverified',
            sharedActionsRequireExplicitAuthorization: true
          }
        }
      }
    }, null, 2)
  )
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'chat', 'profile', '03-代码风格.md'), '# chat 03\n')
  fs.writeFileSync(
    path.join(TEMP_ROOT, '.devcodex', 'chat', 'profile', 'config.json'),
    JSON.stringify({
      mode: 'dev',
      flags: { write: true },
      tags: ['project'],
      extensions: { devcodex: { git: { collaborationMode: 'solo', branchPolicy: 'keep-current' } } }
    }, null, 2)
  )
  fs.writeFileSync(
    path.join(TEMP_ROOT, '.devcodex', 'chat', 'profile', 'config.local.json'),
    JSON.stringify({ connections: { reporting: { connectionString: 'postgres://reporting:local-password@127.0.0.1:5432/reporting' } } }, null, 2)
  )
}

function setupNestedLayoutWorkspace() {
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
  fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'workspace', 'profile'), { recursive: true })
  fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'packages', 'app-a', 'profile'), { recursive: true })
  fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'packages', 'app-b', 'profile'), { recursive: true })
  fs.mkdirSync(path.join(TEMP_ROOT, 'packages', 'app-a'), { recursive: true })
  fs.mkdirSync(path.join(TEMP_ROOT, 'packages', 'app-b'), { recursive: true })
  fs.writeFileSync(path.join(TEMP_ROOT, 'packages', 'app-a', 'package.json'), '{}')
  fs.writeFileSync(path.join(TEMP_ROOT, 'packages', 'app-b', 'package.json'), '{}')
  fs.writeFileSync(
    path.join(TEMP_ROOT, '.devcodex', 'layout.json'),
    JSON.stringify({ version: 1, mode: 'workspace-namespace' }, null, 2)
  )
  fs.writeFileSync(
    path.join(TEMP_ROOT, '.devcodex', 'workspace', 'profile', 'config.json'),
    JSON.stringify({ mode: 'prod', agent: 'claude-code' }, null, 2)
  )
  fs.writeFileSync(
    path.join(TEMP_ROOT, '.devcodex', 'packages', 'app-a', 'profile', 'config.json'),
    JSON.stringify({ mode: 'dev', agent: 'claude-code', app: 'a' }, null, 2)
  )
  fs.writeFileSync(
    path.join(TEMP_ROOT, '.devcodex', 'packages', 'app-b', 'profile', 'config.json'),
    JSON.stringify({ mode: 'prod', agent: 'claude-code', app: 'b' }, null, 2)
  )
}

function setupContextPlanWorkspace({ uncatalogued = false } = {}) {
  setupLayoutWorkspace()
  const workspaceProfile = path.join(TEMP_ROOT, '.devcodex', 'workspace', 'profile')
  const projectProfile = path.join(TEMP_ROOT, '.devcodex', 'chat', 'profile')
  const workspaceRows = [
    ['01-项目信息.md', 'project facts', '✅'],
    ['02-架构约束.md', 'architecture', '✅'],
    ['03-代码风格.md', 'style', '✅'],
    ['04-测试规范.md', 'tests', '✅'],
    ['05-发布规范.md', 'release', '✅'],
    ['06-功能清单.md', 'features', '✅'],
    ['07-用户文档与契约规范.md', 'docs', '✅'],
    ['08-服务约束.md', 'conditional service', '条件'],
    ['config.json', 'runtime mode', '按需']
  ]
  const table = rows => [
    '| 文件 | 说明 | 必须 |',
    '|------|------|:----:|',
    ...rows.map(([file, description, required]) => `| [\`${file}\`](${file}) | ${description} | ${required} |`)
  ].join('\n')
  fs.writeFileSync(path.join(workspaceProfile, 'README.md'), [
    '# workspace Profile',
    '',
    '> Profile 档位：`profile-closed-loop`。',
    '',
    'WORKSPACE-README-CATALOG-SENTINEL',
    '',
    '## 文件索引',
    '',
    table(workspaceRows)
  ].join('\n'))
  fs.writeFileSync(path.join(projectProfile, 'README.md'), [
    '# chat Profile',
    '',
    '> Profile 档位：`profile-closed-loop`。',
    '',
    'PROJECT-README-LOSSLESS-SENTINEL',
    '',
    '## 文件索引',
    '',
    table([['09-项目扩展.md', 'conditional project extension', '条件']])
  ].join('\n'))
  for (const file of ['01-项目信息.md', '02-架构约束.md', '03-代码风格.md', '04-测试规范.md', '05-发布规范.md', '06-功能清单.md', '07-用户文档与契约规范.md', '08-服务约束.md']) {
    fs.writeFileSync(path.join(workspaceProfile, file), `# ${file}\n\nHIDDEN-BODY-${file}\n`)
  }
  fs.writeFileSync(path.join(projectProfile, '03-代码风格.md'), '# project style\n\nHIDDEN-PROJECT-03\n')
  fs.writeFileSync(path.join(projectProfile, '09-项目扩展.md'), '# project extension\n\nHIDDEN-PROJECT-09\n')
  fs.writeFileSync(path.join(projectProfile, 'config.local.json'), JSON.stringify({ sentinel: 'LOCAL-BODY-SENTINEL' }, null, 2))
  if (uncatalogued) fs.writeFileSync(path.join(projectProfile, '10-custom.md'), '# custom\n\nUNCATALOGUED-BODY-SENTINEL\n')
}

function setupDevCodexRouteRecipeWorkspace() {
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
  const workspaceProfile = path.join(TEMP_ROOT, '.devcodex', 'workspace', 'profile')
  const projectProfile = path.join(TEMP_ROOT, '.devcodex', 'devcodex', 'profile')
  const projectRoot = path.join(TEMP_ROOT, 'devcodex')
  fs.mkdirSync(workspaceProfile, { recursive: true })
  fs.mkdirSync(projectProfile, { recursive: true })
  fs.mkdirSync(projectRoot, { recursive: true })
  fs.writeFileSync(path.join(projectRoot, 'package.json'), '{}')
  fs.writeFileSync(
    path.join(TEMP_ROOT, '.devcodex', 'layout.json'),
    JSON.stringify({ version: 1, mode: 'workspace-namespace' }, null, 2)
  )
  fs.writeFileSync(path.join(workspaceProfile, 'README.md'), '# workspace Profile\n')
  fs.writeFileSync(
    path.join(workspaceProfile, 'config.json'),
    JSON.stringify({ mode: 'dev', agent: 'codex' }, null, 2)
  )
  const routeSections = {
    '01-项目信息.md': ['完整开发需求验证链速查', '当前开发重点'],
    '02-架构约束.md': ['执行链派生状态与回滚边界', '控制面内容物化边界'],
    '03-代码风格.md': ['JavaScript', 'Markdown规范文件', '禁止事项'],
    '04-测试规范.md': ['基本原则', '控制面内容验证', 'Profile专项'],
    '05-发布规范.md': ['发布流程'],
    '06-功能清单.md': ['近期发布增量', '公开面维护规则', '全项目Profile校验'],
    '07-用户文档与契约规范.md': ['用户文档主面', '写作与审查原则', '控制面内容契约']
  }
  const catalogRows = Object.keys(routeSections).map(file => `| [\`${file}\`](${file}) | fixture | ✅ |`)
  fs.writeFileSync(path.join(projectProfile, 'README.md'), [
    '# devcodex Profile',
    '',
    '> Profile 档位：`profile-closed-loop`。',
    '',
    '## 文件索引',
    '',
    '| 文件 | 说明 | 必须 |',
    '|------|------|:----:|',
    ...catalogRows
  ].join('\n'))
  fs.writeFileSync(
    path.join(projectProfile, 'config.json'),
    JSON.stringify({ mode: 'dev', agent: 'codex' }, null, 2)
  )
  for (const [file, sections] of Object.entries(routeSections)) {
    fs.writeFileSync(
      path.join(projectProfile, file),
      sections.map(section => `## ${section}\n\nROUTE-RECIPE-${file}-${section}\n`).join('\n')
    )
  }
  return { projectRoot, projectProfile }
}

function testProfilePrompts() {
  setupLegacyWorkspace()
  const responses = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'prompts/list'),
    rpcRequest(3, 'prompts/get', { name: 'devcodex-init' })
  ], TEMP_ROOT)

  const init = resultById(responses, 1)
  assert.ok(init.capabilities.tools)
  assert.ok(init.capabilities.prompts)

  const list = resultById(responses, 2)
  const initPrompt = list.prompts.find(prompt => prompt.name === 'devcodex-init')
  assert.ok(initPrompt)
  assert.ok(initPrompt.arguments.some(argument => argument.name === 'project'))

  const prompt = resultById(responses, 3)
  const text = prompt.messages?.[0]?.content?.text || ''
  assert.match(text, /user-global runtime kernel/)
  assert.doesNotMatch(text, /工作区根目录未找到 CLAUDE\.md/)
  assert.match(text, /01-项目信息/)
  assert.match(text, /config\.local\.json/)
  assert.match(text, /PC0~PC10/)
}

function testProfilePromptRequiresProjectAtWorkspaceRoot() {
  setupLayoutWorkspace()
  const responses = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'prompts/get', { name: 'devcodex-init' }),
    rpcRequest(2, 'prompts/get', { name: 'devcodex-init', arguments: { project: 'chat' } }),
    rpcRequest(3, 'tools/call', { name: 'profile_context_plan', arguments: { intent: 'chat' } }),
    rpcRequest(4, 'tools/call', { name: 'profile_context_plan', arguments: { intent: 'chat', project: '../escape' } })
  ], TEMP_ROOT)

  const ambiguous = resultById(responses, 1)
  assert.strictEqual(ambiguous.isError, true)
  assert.match(ambiguous.content?.[0]?.text || '', /project is required|workspace root/i)

  const explicit = resultById(responses, 2)
  assert.notStrictEqual(explicit.isError, true)
  assert.match(explicit.messages?.[0]?.content?.text || '', /项目命名空间（chat）/)
  const missingPlanTarget = resultById(responses, 3)
  assert.strictEqual(missingPlanTarget.isError, true)
  assert.strictEqual(toolJson(missingPlanTarget).errorCode, 'CONTEXT_ACTIVE_TARGET_MISMATCH')
  const traversalPlanTarget = resultById(responses, 4)
  assert.strictEqual(traversalPlanTarget.isError, true)
  assert.strictEqual(toolJson(traversalPlanTarget).errorCode, 'PROJECT_NAMESPACE_INVALID')
}

function testMissingProfileRecoveryUsesCanonicalInitCommand() {
  setupContextPlanWorkspace()
  fs.rmSync(path.join(TEMP_ROOT, '.devcodex', 'workspace', 'profile', 'README.md'))
  fs.rmSync(path.join(TEMP_ROOT, '.devcodex', 'chat', 'profile', 'README.md'))
  const responses = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'tools/call', {
      name: 'profile_context_plan',
      arguments: {
        intent: 'chat',
        project: 'chat',
        contextEpoch: 'epoch-missing-profile-recovery'
      }
    })
  ], path.join(TEMP_ROOT, 'chat'))
  const result = resultById(responses, 1)
  const error = toolJson(result)
  assert.strictEqual(result.isError, true)
  assert.strictEqual(error.errorCode, 'CONTEXT_PLAN_INVALID')
  assert.match(error.nextStep, /Run devcodex init in the workspace root/)
  assert.doesNotMatch(error.nextStep, /profile plan|profile init/)
}

function testProfileTierConflictRejected() {
  setupLegacyWorkspace()
  fs.appendFileSync(path.join(TEMP_ROOT, '.devcodex', 'profile', 'README.md'), '\nProfile 档位：profile-lite。\n', 'utf8')
  const responses = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'chat', contextEpoch: 'profile-tier-conflict' }
    })
  ], TEMP_ROOT)
  const conflict = resultById(responses, 1)
  assert.strictEqual(conflict.isError, true)
  assert.match(conflict.content?.[0]?.text || '', /multiple profile tiers declared/i)
}

function testProfileModeFallbackAgent() {
  setupLegacyWorkspace()
  fs.rmSync(path.join(TEMP_ROOT, '.devcodex', 'profile', 'config.json'), { force: true })
  const responses = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'tools/call', { name: 'profile_get_mode', arguments: {} })
  ], TEMP_ROOT)

  assert.ok(resultById(responses, 1).capabilities.tools)
  const content = resultById(responses, 2).content?.[0]?.text || ''
  const payload = JSON.parse(content)
  assert.strictEqual(payload.mode, 'prod')
  assert.strictEqual(payload.agent, 'claude-code')
  assert.strictEqual(payload.configExists, false)
}

function testProfileAgentUsesRuntimeBeforeProfileFallback() {
  setupLegacyWorkspace()
  fs.writeFileSync(
    path.join(TEMP_ROOT, '.devcodex', 'profile', 'config.json'),
    JSON.stringify({ mode: 'dev', agent: 'codex' })
  )
  const responses = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'tools/call', { name: 'profile_get_mode', arguments: {} })
  ], TEMP_ROOT)

  const content = resultById(responses, 2).content?.[0]?.text || ''
  const payload = JSON.parse(content)
  assert.strictEqual(payload.mode, 'dev')
  assert.strictEqual(payload.agent, 'claude-code')
  assert.strictEqual(payload.agentSource, 'runtime')
  assert.strictEqual(payload.profileAgent, 'codex')
}

function testMemoryDefaultAgent() {
  setupLegacyWorkspace()
  const allocation = allocateMemorySession(TEMP_ROOT, {
    date: '20260524', title: 'default-agent', intent: 'analyze'
  })
  const responses = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'tools/call', {
      name: 'memory_session_write',
      arguments: {
        date: '20260524',
        sessionId: allocation.sessionId,
        sessionBinding: allocation.sessionBinding,
        content: '# session\n'
      }
    }),
    rpcRequest(3, 'tools/call', {
      name: 'memory_summary_append',
      arguments: { row: '| 2026-05-24 | #1 | analyze | mcp | — | — | ✅ |' }
    })
  ], TEMP_ROOT)

  assert.ok(resultById(responses, 1).capabilities.tools)
  assert.ok(resultById(responses, 2).content[0].text.includes('claude-code'))
  assert.ok(resultById(responses, 3).content[0].text.includes('SUMMARY.md'))
  assert.ok(fs.existsSync(path.join(
    TEMP_ROOT, '.devcodex', '.memory', 'clients', 'claude-code', 'tasks', '20260524.md'
  )))
  assert.ok(fs.existsSync(path.join(
    TEMP_ROOT, '.devcodex', '.memory', 'clients', 'claude-code', 'SUMMARY.md'
  )))
  const summaryPath = path.join(TEMP_ROOT, '.devcodex', '.memory', 'clients', 'claude-code', 'SUMMARY.md')
  const summary = fs.readFileSync(summaryPath, 'utf8')
  assert.ok(summary.includes('# Agent SUMMARY — claude-code'))
  assert.ok(summary.includes('> 项目：'))
  assert.ok(summary.includes('|------|:----:|------|------|---------|---------|:----:|'))
  assert.ok(!fs.existsSync(path.join(TEMP_ROOT, '.devcodex', '.memory', 'clients', 'claude')))
}

function testMemoryTaskResolveContract() {
  setupLegacyWorkspace()
  const taskRoot = path.join(TEMP_ROOT, '.devcodex', 'optimizations', 'MCP续接任务')
  fs.mkdirSync(path.join(taskRoot, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(taskRoot, '.memory', 'task.json'), JSON.stringify({
    schemaVersion: 'TaskIdentityV1',
    taskId: '6f5faaf1-9a0c-4b12-99c3-4386e415a305',
    displayName: 'MCP续接任务',
    aliases: ['MCP旧任务名'],
    createdAt: '2026-07-18T00:00:00.000Z',
    identityRevision: 1
  }, null, 2) + '\n')
  fs.writeFileSync(path.join(taskRoot, '.memory', 'sessions.md'), '# session\n\n> **当前状态**: 🔄 active\n')

  const responses = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'tools/list'),
    rpcRequest(2, 'tools/call', { name: 'memory_task_resolve', arguments: { name: 'MCP旧任务名' } }),
    rpcRequest(3, 'tools/call', { name: 'memory_task_resolve', arguments: { name: '不存在任务', persistIndex: false } })
  ], TEMP_ROOT)
  assert(resultById(responses, 1).tools.some(tool => tool.name === 'memory_task_resolve'))
  const resolved = resultById(responses, 2)
  assert.strictEqual(resolved.isError, false)
  assert.strictEqual(resolved.structuredContent.status, 'resolved-active')
  assert.strictEqual(toolJson(resolved).candidate.taskId, '6f5faaf1-9a0c-4b12-99c3-4386e415a305')
  const missing = resultById(responses, 3)
  assert.strictEqual(missing.isError, true)
  assert.strictEqual(missing.structuredContent.status, 'not-found')
}

function buildTaskAuthorityIngress({
  activeRoot,
  project,
  suffix,
  nowMs = Date.now(),
  physicalRoot = TEMP_ROOT,
  routeKey = 'fix.default'
}) {
  const envelope = buildActualInstructionEnvelope({
    prompt: `修复 MCP task authority ${suffix}`,
    session_id: `mcp-task-authority-${suffix}`,
    event_id: `mcp-task-authority-event-${suffix}`,
    timestamp: new Date(nowMs).toISOString()
  }, {
    hostVariant: 'codex-cli',
    contextEpoch: `ctx-mcp-task-authority-${suffix}`,
    trustedHostEvent: true,
    nowMs
  })
  const workItemSet = buildWorkItemSet(envelope, {
    workItems: [{ taskKind: routeKey.split('.')[0], routeCandidate: routeKey }]
  })
  const route = buildWorkflowRouteDecision({
    actualInstructionEnvelope: envelope,
    workItemSet,
    workItemId: workItemSet.items[0].workItemId,
    environmentMode: 'dev',
    routeKey
  })
  const leaseCore = {
    schemaVersion: 'ProjectTargetLeaseV2',
    project,
    targetDigest: '1'.repeat(64),
    rootIdentityDigest: '2'.repeat(64),
    layoutIdentity: '3'.repeat(64),
    physicalRoot,
    activeRoot,
    authorityKind: 'session',
    authorityDigest: envelope.hostSessionDigest,
    contextEpoch: envelope.contextEpoch,
    contextBindingDigest: '5'.repeat(64),
    routeRevision: route.routeRevision,
    revocationEpoch: 1,
    issuedAtMs: nowMs - 1000,
    expiresAtMs: nowMs + 24 * 60 * 60 * 1000
  }
  const projectTargetLease = { ...leaseCore, leaseDigest: computeProjectTargetLeaseDigest(leaseCore) }
  return {
    actualInstructionEnvelope: envelope,
    workItemSet,
    workflowRouteDecision: route,
    projectTargetLease,
    ingressRef: {
      schemaVersion: 'WorkflowIngressProjectionRefV1',
      envelopeId: envelope.envelopeId,
      envelopeDigest: envelope.envelopeDigest,
      decisionDigest: route.decisionDigest,
      routeRevision: route.routeRevision
    }
  }
}

function writeTaskAuthorityLifecycleState(activeRoot, project, ingress, extra = {}) {
  const lifecycleStatePath = path.join(activeRoot, '.memory', 'hooks', 'legacy', 'lifecycle-state.json')
  fs.mkdirSync(path.dirname(lifecycleStatePath), { recursive: true })
  fs.writeFileSync(lifecycleStatePath, JSON.stringify({
    version: 2,
    activeProject: project,
    activeScope: 'project',
    actualInstructionEnvelope: ingress.actualInstructionEnvelope,
    workItemSet: ingress.workItemSet,
    workflowRouteDecision: ingress.workflowRouteDecision,
    stickyProject: ingress.projectTargetLease,
    ...extra
  }, null, 2) + '\n')
  return lifecycleStatePath
}

function confirmTaskAuthorityCp1(taskRoot) {
  const content = '# 问题确认\n\nMCP authority confirmed.\n'
  const artifact = '01-问题确认.md'
  fs.writeFileSync(path.join(taskRoot, artifact), content)
  const artifactDigest = crypto.createHash('sha256').update(content).digest('hex')
  const sessionsPath = path.join(taskRoot, '.memory', 'sessions.md')
  const sessions = fs.readFileSync(sessionsPath, 'utf8')
  fs.writeFileSync(sessionsPath, sessions.replace(
    /^\|\s*CP1\s*\|.*$/mu,
    `| CP1 | ✅ | ${artifact} | v1 | ${artifactDigest} | mcp-test | ${new Date().toISOString()} |`
  ))
}

function writeTaskTerminalEvidence(activeRoot, taskRootRelative, suffix = 'mcp') {
  const definitions = [
    ['ecr', `${taskRootRelative}/07-ECR-${suffix}.md`, `# ECR ${suffix}\n`],
    ['report', `${taskRootRelative}/reports/codex/${suffix}.md`, `# Report ${suffix}\n`],
    ['memory', `${taskRootRelative}/.memory/${suffix}.md`, `# Memory ${suffix}\n`],
    ['completion', `${taskRootRelative}/06-完成清单-${suffix}.md`, `# Completion ${suffix}\n`]
  ]
  return definitions.map(([role, relative, content]) => {
    const filePath = path.join(activeRoot, ...relative.split('/'))
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content)
    return {
      role,
      path: relative,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
      bytes: Buffer.byteLength(content)
    }
  })
}

function testMemoryTaskAdmissionV2Contract() {
  setupLegacyWorkspace()
  const nowMs = Date.now()
  const project = path.basename(TEMP_ROOT)
  const activeRoot = path.join(TEMP_ROOT, '.devcodex')
  const envelope = buildActualInstructionEnvelope({
    prompt: '修复 MCP task admission',
    session_id: 'mcp-admission-session',
    event_id: 'mcp-admission-event',
    timestamp: new Date(nowMs).toISOString()
  }, {
    hostVariant: 'codex-cli',
    contextEpoch: 'ctx-mcp-admission',
    trustedHostEvent: true,
    nowMs
  })
  const workItemSet = buildWorkItemSet(envelope, {
    workItems: [{ taskKind: 'fix', routeCandidate: 'fix.default' }]
  })
  const route = buildWorkflowRouteDecision({
    actualInstructionEnvelope: envelope,
    workItemSet,
    workItemId: workItemSet.items[0].workItemId,
    environmentMode: 'dev',
    routeKey: 'fix.default'
  })
  const leaseCore = {
    schemaVersion: 'ProjectTargetLeaseV2',
    project,
    targetDigest: '1'.repeat(64),
    rootIdentityDigest: '2'.repeat(64),
    layoutIdentity: '3'.repeat(64),
    physicalRoot: TEMP_ROOT,
    activeRoot,
    authorityKind: 'session',
    authorityDigest: '4'.repeat(64),
    contextEpoch: envelope.contextEpoch,
    contextBindingDigest: '5'.repeat(64),
    routeRevision: route.routeRevision,
    revocationEpoch: 1,
    issuedAtMs: nowMs - 1000,
    expiresAtMs: nowMs + 60 * 60 * 1000
  }
  const projectTargetLease = { ...leaseCore, leaseDigest: computeProjectTargetLeaseDigest(leaseCore) }
  const lifecycleStatePath = path.join(activeRoot, '.memory', 'hooks', 'legacy', 'lifecycle-state.json')
  fs.mkdirSync(path.dirname(lifecycleStatePath), { recursive: true })
  const lifecycleState = {
    version: 2,
    activeProject: project,
    activeScope: 'project',
    actualInstructionEnvelope: envelope,
    workItemSet,
    workflowRouteDecision: route,
    stickyProject: projectTargetLease
  }
  fs.writeFileSync(lifecycleStatePath, JSON.stringify(lifecycleState, null, 2) + '\n')
  const args = {
    operation: 'admit',
    ingressRef: {
      schemaVersion: 'WorkflowIngressProjectionRefV1',
      envelopeId: envelope.envelopeId,
      envelopeDigest: envelope.envelopeDigest,
      decisionDigest: route.decisionDigest,
      routeRevision: route.routeRevision
    },
    task: {
      taskKind: 'bugs',
      entryVariant: 'fix',
      displayName: 'MCP准入任务',
      aliases: ['MCP准入别名']
    },
    overview: { content: '# 问题概况\n\nMCP task admission\n' }
  }
  const rejectedIngress = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'tools/call', {
      name: 'memory_task_admit_v2',
      arguments: { ...args, ingressRef: { ...args.ingressRef, decisionDigest: 'f'.repeat(64) } }
    })
  ], TEMP_ROOT)
  assert.strictEqual(resultById(rejectedIngress, 1).isError, true)
  assert.match(resultById(rejectedIngress, 1).content[0].text, /TASK_ADMISSION_INGRESS_STATE_MISMATCH/)
  assert.strictEqual(fs.existsSync(path.join(activeRoot, 'bugs')), false)
  const rejectTamperedProjectLease = (stickyProject, label) => {
    fs.writeFileSync(lifecycleStatePath, JSON.stringify({ ...lifecycleState, stickyProject }, null, 2) + '\n')
    const response = runServer('mcp/memory-server.js', [
      rpcRequest(1, 'tools/call', { name: 'memory_task_admit_v2', arguments: args })
    ], TEMP_ROOT)
    assert.strictEqual(resultById(response, 1).isError, true, label)
    assert.match(resultById(response, 1).content[0].text, /TASK_ADMISSION_PROJECT_LEASE_INVALID/, label)
    assert.strictEqual(fs.existsSync(path.join(activeRoot, 'bugs')), false, `${label} must be zero-side-effect`)
  }
  const wrongPhysicalRootCore = {
    ...leaseCore,
    physicalRoot: path.join(TEMP_ROOT, 'wrong-project-root')
  }
  rejectTamperedProjectLease({
    ...wrongPhysicalRootCore,
    leaseDigest: computeProjectTargetLeaseDigest(wrongPhysicalRootCore)
  }, 'recomputed lease digest must not authorize a different physical root')
  const expiredLeaseCore = {
    ...leaseCore,
    issuedAtMs: nowMs - 2000,
    expiresAtMs: nowMs - 1000
  }
  rejectTamperedProjectLease({
    ...expiredLeaseCore,
    leaseDigest: computeProjectTargetLeaseDigest(expiredLeaseCore)
  }, 'expired ProjectTargetLeaseV2 must fail closed')
  const wrongContextLeaseCore = {
    ...leaseCore,
    contextEpoch: 'ctx-mcp-admission-tampered'
  }
  rejectTamperedProjectLease({
    ...wrongContextLeaseCore,
    leaseDigest: computeProjectTargetLeaseDigest(wrongContextLeaseCore)
  }, 'context-mismatched ProjectTargetLeaseV2 must fail closed')
  rejectTamperedProjectLease({ ...projectTargetLease, leaseDigest: 'f'.repeat(64) },
    'digest-mismatched ProjectTargetLeaseV2 must fail closed')
  fs.writeFileSync(lifecycleStatePath, JSON.stringify(lifecycleState, null, 2) + '\n')
  const responses = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'tools/list'),
    rpcRequest(2, 'tools/call', { name: 'memory_task_admit_v2', arguments: args }),
    rpcRequest(3, 'tools/call', { name: 'memory_task_admit_v2', arguments: args }),
    rpcRequest(4, 'tools/call', {
      name: 'memory_task_admit_v2',
      arguments: { ...args, overview: { content: '# 不同内容\n' } }
    }),
    rpcRequest(5, 'tools/call', {
      name: 'memory_task_admit_v2',
      arguments: { ...args, ingressRef: { ...args.ingressRef, decisionDigest: 'f'.repeat(64) } }
    }),
    rpcRequest(6, 'tools/call', { name: 'memory_task_resolve', arguments: { name: 'MCP准入别名' } }),
    rpcRequest(7, 'tools/call', {
      name: 'memory_task_admit_v2',
      arguments: { operation: args.operation, task: args.task, overview: args.overview }
    }),
    rpcRequest(8, 'tools/call', {
      name: 'memory_task_admit_v2',
      arguments: {
        ...args,
        resumeContextBinding: {
          schemaVersion: 'ContextReadBindingV1',
          contextEpoch: 'ctx-ambiguous',
          planId: 'plan-ambiguous',
          planContentId: 'plan-content-ambiguous',
          activeRoot,
          project
        }
      }
    })
  ], TEMP_ROOT)
  const toolSchema = findToolSchema(resultById(responses, 1).tools, 'memory_task_admit_v2')
  assert.deepStrictEqual(toolSchema.required, ['operation', 'task', 'overview'])
  assert.deepStrictEqual(toolSchema.oneOf, [
    { required: ['ingressRef'], not: { required: ['resumeContextBinding'] } },
    { required: ['resumeContextBinding'], not: { required: ['ingressRef'] } }
  ])
  assert.deepStrictEqual(
    toolSchema.properties.ingressRef.required,
    ['schemaVersion', 'envelopeId', 'envelopeDigest', 'decisionDigest', 'routeRevision']
  )
  const admitted = resultById(responses, 2)
  assert.strictEqual(admitted.isError, false)
  assert.strictEqual(admitted.structuredContent.phase, 'finalized')
  assert.strictEqual(admitted.structuredContent.finalized, true)
  assert.strictEqual(admitted.structuredContent.mutationAuthority, false)
  assert.strictEqual(admitted.structuredContent.ownerAcquisition.status, 'active')
  assert.strictEqual(admitted.structuredContent.ownerAcquisition.cp1Confirmed, false)
  assert.strictEqual(admitted.structuredContent.continuationLease.status, 'consumed')
  assert.strictEqual(admitted.structuredContent.ownerAcquisition.finalized, true)
  const replay = resultById(responses, 3)
  assert.strictEqual(replay.isError, false)
  assert.strictEqual(replay.structuredContent.admissionId, admitted.structuredContent.admissionId)
  assert.strictEqual(replay.structuredContent.replayed, true)
  assert.strictEqual(replay.structuredContent.ownerAcquisition.replayed, true)
  assert.strictEqual(resultById(responses, 4).isError, true)
  assert.match(resultById(responses, 4).content[0].text, /TASK_ADMISSION_IDEMPOTENCY_CONFLICT/)
  assert.strictEqual(resultById(responses, 5).isError, true)
  assert.match(resultById(responses, 5).content[0].text, /TASK_ADMISSION_INGRESS_STATE_MISMATCH/)
  const resolved = resultById(responses, 6)
  assert.strictEqual(resolved.isError, false)
  assert.strictEqual(resolved.structuredContent.candidate.taskId, admitted.structuredContent.taskId)
  assert.strictEqual(resultById(responses, 7).isError, true)
  assert.match(resultById(responses, 7).content[0].text, /TASK_ADMISSION_INGRESS_REQUIRED|Invalid tool arguments/)
  assert.strictEqual(resultById(responses, 8).isError, true)
  assert.match(resultById(responses, 8).content[0].text, /TASK_ADMISSION_INGRESS_INPUT_AMBIGUOUS|Invalid tool arguments/)
  assert.strictEqual(admitted.structuredContent.ingressSource, 'host-hook')
  assert.strictEqual(admitted.structuredContent.activeVersion, require('../package.json').version)
  assert.match(admitted.structuredContent.runtimeGeneration, /.+/)
  const taskRoot = path.join(activeRoot, ...admitted.structuredContent.taskRootRelative.split('/'))
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(taskRoot, '.memory', 'task.json'), 'utf8')).schemaVersion, 'TaskIdentityV2')
  assert.match(fs.readFileSync(path.join(taskRoot, '.memory', 'sessions.md'), 'utf8'), /\| CP1 \| ⏳ \|/u)
}

function testMemoryFinalizedFreshResumeV3Contract() {
  setupLegacyWorkspace()
  const activeRoot = path.join(TEMP_ROOT, '.devcodex')
  const project = path.basename(TEMP_ROOT)
  const nowMs = Date.now()
  const ownerIssuedAt = nowMs - 6 * 60 * 1000
  const priorIngress = buildTaskAuthorityIngress({
    activeRoot,
    project,
    suffix: 'fresh-resume-prior',
    nowMs: ownerIssuedAt
  })
  const overviewContent = '# 问题概况\n\nMCP finalized fresh resume V3.\n'
  const priorAdmission = executeTaskAdmission({
    operation: 'admit',
    activeRoot,
    project,
    actualInstructionEnvelope: priorIngress.actualInstructionEnvelope,
    workItemSet: priorIngress.workItemSet,
    workflowRouteDecision: priorIngress.workflowRouteDecision,
    projectTargetLease: priorIngress.projectTargetLease,
    task: {
      taskKind: 'bugs',
      entryVariant: 'fix',
      displayName: 'MCP finalized fresh resume V3'
    },
    overview: { content: overviewContent }
  }, { nowMs: ownerIssuedAt })
  const taskRoot = path.join(activeRoot, ...priorAdmission.taskRootRelative.split('/'))
  confirmTaskAuthorityCp1(taskRoot)
  const priorOwner = executeTaskWriteOwner({
    operation: 'acquire',
    activeRoot,
    project,
    actualInstructionEnvelope: priorIngress.actualInstructionEnvelope,
    workItemSet: priorIngress.workItemSet,
    workflowRouteDecision: priorIngress.workflowRouteDecision,
    projectTargetLease: priorIngress.projectTargetLease,
    taskId: priorAdmission.taskId,
    admissionId: priorAdmission.admissionId
  }, {
    nowMs: ownerIssuedAt,
    nonceFactory: () => `owner-${'1'.repeat(40)}`
  })
  assert(Date.parse(priorOwner.owner.expiresAt) <= nowMs, 'fixture owner must be expired')
  const metaDir = resolveTaskRecoveryMetaDir({ activeRoot, project })
  const recoveryIdentity = { activeRoot, project, taskId: priorAdmission.taskId, taskStatus: 'active' }
  const terminalTurnWrite = updateTaskRecoveryState({ metaDir, identity: recoveryIdentity }, state => ({
    ...state,
    turnLiveness: {
      schemaVersion: 'TurnLivenessStateV1',
      state: 'completed',
      turnKey: 'fresh-resume-prior-turn',
      lastEventAt: new Date(nowMs - 1000).toISOString(),
      inFlightOperation: null,
      previousTurn: { terminalState: 'completed' }
    }
  }), { nowMs, force: true, reason: 'mcp-fresh-resume-terminal-turn' })
  assert(['committed', 'semantic-noop'].includes(terminalTurnWrite.status), JSON.stringify(terminalTurnWrite))

  const resumeIngress = buildTaskAuthorityIngress({
    activeRoot,
    project,
    suffix: 'fresh-resume-current',
    nowMs,
    routeKey: 'resume'
  })
  writeTaskAuthorityLifecycleState(activeRoot, project, resumeIngress, {
    taskRecoveryBinding: {
      taskId: priorAdmission.taskId,
      displayName: 'MCP finalized fresh resume V3',
      project,
      kind: 'bugs',
      taskRoot,
      status: 'active'
    }
  })
  const resumeArgs = {
    operation: 'bind',
    ingressRef: resumeIngress.ingressRef,
    task: {
      taskId: priorAdmission.taskId,
      taskKind: 'bugs',
      entryVariant: 'continue',
      taskRootRelative: priorAdmission.taskRootRelative
    },
    overview: { content: overviewContent }
  }
  const resumeResponses = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'tools/call', { name: 'memory_task_admit_v2', arguments: resumeArgs }),
    rpcRequest(2, 'tools/call', { name: 'memory_task_admit_v2', arguments: resumeArgs })
  ], TEMP_ROOT)
  const resumed = resultById(resumeResponses, 1)
  assert.strictEqual(resumed.isError, false, resumed.content?.[0]?.text || '')
  assert.strictEqual(resumed.structuredContent.recovery.schemaVersion, 'FinalizedTaskResumeRecoveryReceiptV3')
  assert.strictEqual(resumed.structuredContent.recoveryStage, 'readback-complete')
  assert.strictEqual(resumed.structuredContent.ingressSource, 'host-hook')
  assert.strictEqual(resumed.structuredContent.mutationAuthority, true)
  assert.strictEqual(resumed.structuredContent.admissionGeneration, priorAdmission.admissionGeneration + 1)
  assert.strictEqual(resumed.structuredContent.ownerGeneration, priorOwner.owner.ownerGeneration + 1)
  assert.deepStrictEqual(resumed.structuredContent.ingressRef, resumeIngress.ingressRef)
  const resumedReplay = resultById(resumeResponses, 2)
  assert.strictEqual(resumedReplay.isError, false, resumedReplay.content?.[0]?.text || '')
  assert.strictEqual(resumedReplay.structuredContent.replayed, true)
  assert.strictEqual(resumedReplay.structuredContent.admissionId, resumed.structuredContent.admissionId)
  assert.strictEqual(
    resumedReplay.structuredContent.ownerAcquisition.owner.leaseDigest,
    resumed.structuredContent.ownerAcquisition.owner.leaseDigest
  )

  const renew = resultById(runServer('mcp/memory-server.js', [
    rpcRequest(3, 'tools/call', {
      name: 'memory_task_write_owner',
      arguments: {
        operation: 'renew',
        ingressRef: resumed.structuredContent.ingressRef,
        taskId: priorAdmission.taskId,
        admissionId: resumed.structuredContent.admissionId,
        expectedOwner: resumed.structuredContent.ownerAcquisition.ownerRef
      }
    })
  ], TEMP_ROOT), 3)
  assert.strictEqual(renew.isError, false, renew.content?.[0]?.text || '')
  assert.strictEqual(renew.structuredContent.mutationAuthority, true)
  assert(renew.structuredContent.owner.leaseRevision > resumed.structuredContent.leaseRevision)
  const release = resultById(runServer('mcp/memory-server.js', [
    rpcRequest(4, 'tools/call', {
      name: 'memory_task_write_owner',
      arguments: {
        operation: 'release',
        ingressRef: resumed.structuredContent.ingressRef,
        taskId: priorAdmission.taskId,
        admissionId: resumed.structuredContent.admissionId,
        expectedOwner: renew.structuredContent.ownerRef
      }
    })
  ], TEMP_ROOT), 4)
  assert.strictEqual(release.isError, false, release.content?.[0]?.text || '')
  assert.strictEqual(release.structuredContent.status, 'released')

  const resumeContextBinding = createTestContextBinding(TEMP_ROOT, { intent: 'resume' })
  const contextAuthorization = authorizeContextRead({
    activeRoot,
    project,
    contextBinding: resumeContextBinding,
    requestedSources: []
  })
  assert.strictEqual(contextAuthorization.status, 'authorized')
  assert.strictEqual(contextAuthorization.plan.workflowRoute.routeKey, 'resume')
  const contextObservation = recordMcpContextSourceObservations({
    activeRoot,
    project,
    contextBinding: resumeContextBinding,
    hostSessionId: 'mcp-fresh-resume-fallback-session',
    sourceResults: contextAuthorization.plan.selectedSources.map(source => ({
      sourceId: source.sourceId,
      bodyObserved: true,
      successful: true,
      observable: true,
      transportSuccess: true,
      sourceRefsMatch: true,
      schemaMatch: true,
      targetMatch: true,
      contentIdentity: buildJsonContentIdentity({
        sourceKey: `test://${source.sourceId}`,
        value: { sourceId: source.sourceId, observed: true },
        contractVersion: 'McpFreshResumeContextSourceV1'
      }).identity,
      bytes: 1,
      chars: 1
    }))
  })
  assert.strictEqual(contextObservation.status, 'persisted', JSON.stringify(contextObservation))
  assert.deepStrictEqual(contextObservation.missingSourceIds, [])
  const fallbackArgs = {
    operation: 'bind',
    resumeContextBinding,
    task: resumeArgs.task,
    overview: resumeArgs.overview
  }
  const fallbackResponses = runServer('mcp/memory-server.js', [
    rpcRequest(5, 'tools/call', { name: 'memory_task_admit_v2', arguments: fallbackArgs }),
    rpcRequest(6, 'tools/call', { name: 'memory_task_admit_v2', arguments: fallbackArgs })
  ], TEMP_ROOT, { DEVCODEX_HOST_SESSION_ID: 'mcp-fresh-resume-fallback-session' })
  const fallback = resultById(fallbackResponses, 5)
  assert.strictEqual(fallback.isError, false, fallback.content?.[0]?.text || '')
  assert.strictEqual(fallback.structuredContent.ingressSource, 'bounded-resume-fallback')
  assert.strictEqual(fallback.structuredContent.mutationAuthority, true)
  assert.strictEqual(fallback.structuredContent.admissionGeneration, resumed.structuredContent.admissionGeneration + 1)
  assert.strictEqual(fallback.structuredContent.recoveryStage, 'readback-complete')
  assert.strictEqual(resultById(fallbackResponses, 6).structuredContent.replayed, true)
}

function testMemoryWorkflowOperationalWriteLeaseContract() {
  setupLegacyWorkspace()
  const activeRoot = path.join(TEMP_ROOT, '.devcodex')
  const project = path.basename(TEMP_ROOT)
  const ingress = buildTaskAuthorityIngress({ activeRoot, project, suffix: 'operational-lease' })
  writeTaskAuthorityLifecycleState(activeRoot, project, ingress, {
    contextAcquisition: {
      contextEpoch: ingress.actualInstructionEnvelope.contextEpoch,
      activeRoot,
      project,
      targetResolved: true,
      hostSessionId: 'mcp-task-authority-operational-lease'
    },
    turnLiveness: {
      state: 'active-turn',
      turnKey: 'mcp-operational-turn'
    }
  })
  const reportTarget = 'reports/analysis/codex/20260825/01--operational-lease.md'
  const args = {
    ingressRef: ingress.ingressRef,
    operation: 'create',
    targets: [reportTarget]
  }
  const responses = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'tools/list'),
    rpcRequest(2, 'tools/call', {
      name: 'memory_workflow_operational_write_lease',
      arguments: args
    }),
    rpcRequest(3, 'tools/call', {
      name: 'memory_workflow_operational_write_lease',
      arguments: { ...args, targets: ['profile/01-项目信息.md'] }
    }),
    rpcRequest(4, 'tools/call', {
      name: 'memory_workflow_operational_write_lease',
      arguments: { ...args, targets: ['bugs/unbound/01-问题确认.md'] }
    }),
    rpcRequest(5, 'tools/call', {
      name: 'memory_workflow_operational_write_lease',
      arguments: { ...args, targets: ['../outside.md'] }
    }),
    rpcRequest(6, 'tools/call', {
      name: 'memory_workflow_operational_write_lease',
      arguments: { ...args, ingressRef: { ...args.ingressRef, routeRevision: 'f'.repeat(64) } }
    })
  ], TEMP_ROOT)
  const listed = resultById(responses, 1)
  const schema = findToolSchema(listed.tools, 'memory_workflow_operational_write_lease')
  assert(schema, 'memory_workflow_operational_write_lease must be publicly reachable')
  assert.deepStrictEqual(schema.required, ['ingressRef', 'operation', 'targets'])
  assert.strictEqual(schema.additionalProperties, false)
  assert.strictEqual(schema.properties.targets.maxItems, 4)
  const issued = resultById(responses, 2)
  assert.strictEqual(issued.isError, false)
  const lease = issued.structuredContent.lease
  assert.strictEqual(lease.schemaVersion, 'WorkflowOperationalWriteLeaseV1')
  assert.strictEqual(lease.slotId, 'project-report')
  assert.strictEqual(lease.authorityRole, 'workflow-owner')
  assert.deepStrictEqual(lease.relativeTargets, [reportTarget])
  assert.strictEqual(lease.productMutationAuthority, false)
  assert.strictEqual(lease.formalArtifactAuthority, false)
  assert.strictEqual(lease.releaseAuthority, false)
  assert.match(lease.leaseDigest, /^[a-f0-9]{64}$/)
  for (const id of [3, 4, 5, 6]) assert.strictEqual(resultById(responses, id).isError, true)
  assert.match(resultById(responses, 3).content[0].text, /WORKFLOW_OPERATIONAL_SLOT_FORBIDDEN/)
  assert.match(resultById(responses, 4).content[0].text, /WORKFLOW_OPERATIONAL_SLOT_FORBIDDEN/)
  assert.match(resultById(responses, 5).content[0].text, /WORKFLOW_OPERATIONAL_TARGET_INVALID/)
  assert.match(resultById(responses, 6).content[0].text, /TASK_ADMISSION_INGRESS_STATE_MISMATCH/)
}

function testMemorySimpleTaskFastPathLeaseContract() {
  setupLegacyWorkspace()
  const activeRoot = path.join(TEMP_ROOT, '.devcodex')
  const project = path.basename(TEMP_ROOT)
  const ingress = buildTaskAuthorityIngress({
    activeRoot,
    project,
    suffix: 'simple-fast-path',
    routeKey: 'dev.docs'
  })
  writeTaskAuthorityLifecycleState(activeRoot, project, ingress, {
    contextAcquisition: {
      contextEpoch: ingress.actualInstructionEnvelope.contextEpoch,
      activeRoot,
      project,
      targetResolved: true,
      hostSessionId: 'mcp-task-authority-simple-fast-path'
    },
    turnLiveness: {
      state: 'active-turn',
      turnKey: 'mcp-simple-fast-path-turn'
    }
  })
  const riskAssessment = {
    changeClass: 'narrative-markdown',
    crossModule: false,
    sharedContract: false,
    publicApiOrSchema: false,
    securitySensitive: false,
    dependencyChange: false,
    releaseImpact: false
  }
  const args = {
    ingressRef: ingress.ingressRef,
    operation: 'create-or-update',
    targets: ['docs/quick-start.md', 'docs/troubleshooting.md'],
    riskAssessment
  }
  const responses = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'tools/list'),
    rpcRequest(2, 'tools/call', { name: 'memory_task_fast_path_lease', arguments: args }),
    rpcRequest(3, 'tools/call', {
      name: 'memory_task_fast_path_lease',
      arguments: { ...args, targets: [...args.targets, 'docs/third.md'] }
    }),
    rpcRequest(4, 'tools/call', {
      name: 'memory_task_fast_path_lease',
      arguments: { ...args, riskAssessment: { ...riskAssessment, sharedContract: true } }
    }),
    rpcRequest(5, 'tools/call', {
      name: 'memory_task_fast_path_lease',
      arguments: { ...args, targets: ['README.md', 'docs/quick-start.md'] }
    }),
    rpcRequest(6, 'tools/call', {
      name: 'memory_task_fast_path_lease',
      arguments: { ...args, targets: ['CHANGELOG.md'] }
    }),
    rpcRequest(7, 'tools/call', {
      name: 'memory_task_fast_path_lease',
      arguments: {
        ...args,
        targets: ['hooks/runtime.js'],
        riskAssessment: { ...riskAssessment, changeClass: 'local-implementation' }
      }
    }),
    rpcRequest(8, 'tools/call', {
      name: 'memory_task_fast_path_lease',
      arguments: { ...args, ingressRef: { ...args.ingressRef, routeRevision: 'f'.repeat(64) } }
    })
  ], TEMP_ROOT)
  const listed = resultById(responses, 1)
  const schema = findToolSchema(listed.tools, 'memory_task_fast_path_lease')
  assert(schema, 'memory_task_fast_path_lease must be publicly reachable')
  assert.strictEqual(schema.additionalProperties, false)
  assert.strictEqual(schema.properties.targets.maxItems, 2)
  assert.deepStrictEqual(schema.properties.riskAssessment.required, [
    'changeClass',
    'crossModule',
    'sharedContract',
    'publicApiOrSchema',
    'securitySensitive',
    'dependencyChange',
    'releaseImpact'
  ])
  const issued = resultById(responses, 2)
  assert.strictEqual(issued.isError, false)
  const receipt = issued.structuredContent
  assert.strictEqual(receipt.schemaVersion, 'SimpleTaskFastPathLeaseReceiptV1')
  assert.strictEqual(receipt.lease.schemaVersion, 'SimpleTaskFastPathLeaseV1')
  assert.deepStrictEqual(receipt.lease.relativeTargets, args.targets)
  assert.strictEqual(receipt.lease.maxTargets, 2)
  assert.strictEqual(receipt.lease.maxUses, 2)
  assert.strictEqual(receipt.usage.useCount, 0)
  assert.strictEqual(receipt.mutationAuthority, true)
  assert.strictEqual(receipt.productMutationAuthority, true)
  assert.strictEqual(receipt.formalArtifactAuthority, false)
  assert.strictEqual(receipt.controlPlaneAuthority, false)
  assert.strictEqual(receipt.releaseAuthority, false)
  assert.match(receipt.lease.leaseDigest, /^[a-f0-9]{64}$/)
  for (const id of [3, 4, 5, 6, 7, 8]) assert.strictEqual(resultById(responses, id).isError, true)
  assert.match(resultById(responses, 3).content[0].text, /SIMPLE_TASK_TARGET_COUNT_INVALID|Invalid tool arguments/)
  assert.match(resultById(responses, 4).content[0].text, /SIMPLE_TASK_RISK_UPGRADE_REQUIRED/)
  assert.match(resultById(responses, 5).content[0].text, /SIMPLE_TASK_CROSS_MODULE_FORBIDDEN/)
  assert.match(resultById(responses, 6).content[0].text, /SIMPLE_TASK_PUBLIC_CONTRACT_FORBIDDEN/)
  assert.match(resultById(responses, 7).content[0].text, /SIMPLE_TASK_CONTROL_OR_SHARED_CONTRACT_FORBIDDEN/)
  assert.match(resultById(responses, 8).content[0].text, /TASK_ADMISSION_INGRESS_STATE_MISMATCH/)
}

function testMemoryTaskOwnerAndTerminalV1Contract() {
  setupLegacyWorkspace()
  const activeRoot = path.join(TEMP_ROOT, '.devcodex')
  const project = path.basename(TEMP_ROOT)
  const ingress = buildTaskAuthorityIngress({ activeRoot, project, suffix: 'terminal' })
  writeTaskAuthorityLifecycleState(activeRoot, project, ingress)
  const admissionArgs = {
    operation: 'admit',
    ingressRef: ingress.ingressRef,
    task: {
      taskKind: 'bugs',
      entryVariant: 'fix',
      displayName: 'MCP owner terminal task'
    },
    overview: { content: '# 问题概况\n\nMCP owner terminal test.\n' }
  }
  const admittedResponses = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'tools/list'),
    rpcRequest(2, 'tools/call', { name: 'memory_task_admit_v2', arguments: admissionArgs })
  ], TEMP_ROOT)
  const listedResult = resultById(admittedResponses, 1)
  const toolsListBytes = Buffer.byteLength(JSON.stringify({ jsonrpc: '2.0', id: 1, result: listedResult }))
  assert(toolsListBytes <= 24 * 1024, `memory tools/list exceeds 24 KiB budget: ${toolsListBytes} bytes`)
  for (const toolName of [
    'memory_task_write_owner',
    'memory_task_terminal_v1',
    'memory_task_closeout_reconcile_v1',
    'memory_artifact_mutation_reconcile_v1'
  ]) {
    assert(listedResult.tools.some(tool => tool.name === toolName), `${toolName} must be publicly reachable`)
  }
  const ownerSchema = findToolSchema(listedResult.tools, 'memory_task_write_owner')
  const terminalSchema = findToolSchema(listedResult.tools, 'memory_task_terminal_v1')
  assert.strictEqual(ownerSchema.additionalProperties, false)
  assert.strictEqual(ownerSchema.properties.serverObservation, undefined, 'takeover evidence must remain server-owned')
  assert.strictEqual(terminalSchema.additionalProperties, false)
  assert.deepStrictEqual(terminalSchema.properties.evidence.minItems, 4)
  assert.deepStrictEqual(terminalSchema.properties.evidence.maxItems, 4)

  const admitted = resultById(admittedResponses, 2).structuredContent
  assert.strictEqual(admitted.routeBindingRequired, false)
  assert.ok(['persisted', 'semantic-noop'].includes(admitted.routeBinding.status))
  const metaDir = resolveTaskRecoveryMetaDir({ activeRoot, project })
  const recoveryIdentity = { activeRoot, project, taskId: admitted.taskId, taskStatus: 'active' }
  const rejectedResponses = runServer('mcp/memory-server.js', [
    rpcRequest(3, 'tools/call', {
      name: 'memory_task_write_owner',
      arguments: {
        operation: 'acquire',
        ingressRef: { ...ingress.ingressRef, decisionDigest: 'f'.repeat(64) },
        taskId: admitted.taskId,
        admissionId: admitted.admissionId
      }
    }),
    rpcRequest(4, 'tools/call', {
      name: 'memory_task_write_owner',
      arguments: {
        operation: 'takeover-prepare',
        ingressRef: ingress.ingressRef,
        taskId: admitted.taskId,
        admissionId: admitted.admissionId,
        serverObservation: {
          canonicalTaskReadback: true,
          noLiveTurn: true,
          reconcileReceiptDigest: '6'.repeat(64)
        }
      }
    }),
    rpcRequest(5, 'tools/call', {
      name: 'memory_task_closeout_reconcile_v1',
      arguments: { ingressRef: ingress.ingressRef, taskId: admitted.taskId }
    })
  ], TEMP_ROOT)
  assert.strictEqual(resultById(rejectedResponses, 3).isError, true)
  assert.match(resultById(rejectedResponses, 3).content[0].text, /TASK_ADMISSION_INGRESS_STATE_MISMATCH/)
  assert.strictEqual(resultById(rejectedResponses, 4).isError, true)
  assert.match(resultById(rejectedResponses, 4).content[0].text, /TASK_WRITE_OWNER_CAS_MISMATCH/)
  assert.strictEqual(resultById(rejectedResponses, 5).isError, true)
  const beforeOwner = readFencedTaskWriteOwner({ metaDir, identity: recoveryIdentity })
  assert.strictEqual(beforeOwner.status, 'fresh', 'atomic admission must leave one durable owner')
  assert.strictEqual(beforeOwner.owner.leaseDigest, admitted.ownerAcquisition.ownerRef.leaseDigest)
  assert.strictEqual(beforeOwner.transaction.phase, 'finalized')

  const taskRoot = path.join(activeRoot, ...admitted.taskRootRelative.split('/'))
  confirmTaskAuthorityCp1(taskRoot)
  const clearedLifecycleState = {
    ...JSON.parse(fs.readFileSync(path.join(activeRoot, '.memory', 'hooks', 'legacy', 'lifecycle-state.json'), 'utf8')),
    actualInstructionEnvelope: null,
    workItemSet: null,
    workflowRouteDecision: null,
    stickyProject: {}
  }
  fs.writeFileSync(
    path.join(activeRoot, '.memory', 'hooks', 'legacy', 'lifecycle-state.json'),
    JSON.stringify(clearedLifecycleState, null, 2) + '\n'
  )
  const ownerResponses = runServer('mcp/memory-server.js', [
    rpcRequest(6, 'tools/call', {
      name: 'memory_task_write_owner',
      arguments: {
        operation: 'renew',
        ingressRef: ingress.ingressRef,
        taskId: admitted.taskId,
        admissionId: admitted.admissionId,
        expectedOwner: admitted.ownerAcquisition.ownerRef
      }
    })
  ], TEMP_ROOT)
  const acquired = resultById(ownerResponses, 6)
  assert.strictEqual(acquired.isError, false)
  assert.strictEqual(acquired.structuredContent.status, 'active')
  assert.strictEqual(acquired.structuredContent.finalized, true)
  assert.strictEqual(acquired.structuredContent.cp1Confirmed, true)
  assert.strictEqual(acquired.structuredContent.mutationAuthority, true)
  assert.strictEqual(acquired.structuredContent.ingressAuthority.source, 'immutable-snapshot')
  assert.strictEqual(acquired.structuredContent.continuationLease.status, 'consumed')

  const routeIndex = createWorkspaceSessionRouteIndex({
    metaDir: path.join(activeRoot, '.memory', 'hooks', 'legacy'),
    fs,
    path
  })
  const routeBound = routeIndex.read({ sessionDigest: ingress.projectTargetLease.authorityDigest })
  assert.strictEqual(routeBound.status, 'fresh')
  assert.strictEqual(routeBound.entry.taskId, admitted.taskId)
  const evidence = writeTaskTerminalEvidence(activeRoot, admitted.taskRootRelative)
  const terminalArgs = {
    ingressRef: ingress.ingressRef,
    taskId: admitted.taskId,
    admissionId: admitted.admissionId,
    terminalStatus: 'completed',
    expectedOwner: acquired.structuredContent.ownerRef,
    evidence
  }
  const terminalResponses = runServer('mcp/memory-server.js', [
    rpcRequest(7, 'tools/call', { name: 'memory_task_terminal_v1', arguments: terminalArgs }),
    rpcRequest(8, 'tools/call', { name: 'memory_task_terminal_v1', arguments: terminalArgs }),
    rpcRequest(9, 'tools/call', {
      name: 'memory_task_terminal_v1',
      arguments: { ...terminalArgs, terminalStatus: 'failed' }
    })
  ], TEMP_ROOT)
  const terminal = resultById(terminalResponses, 7)
  assert.strictEqual(terminal.isError, false)
  assert.strictEqual(terminal.structuredContent.status, 'terminal')
  assert.strictEqual(terminal.structuredContent.receipt.evidence.length, 4)
  assert.strictEqual(terminal.structuredContent.mutationAuthority, false)
  assert.strictEqual(terminal.structuredContent.routeReconciliationRequired, false)
  assert.strictEqual(resultById(terminalResponses, 8).structuredContent.replayed, true)
  assert.strictEqual(resultById(terminalResponses, 9).isError, true)
  assert.match(resultById(terminalResponses, 9).content[0].text, /TASK_TERMINAL_REPLAY_MISMATCH/)
  const routeAfterTerminal = routeIndex.read({ sessionDigest: ingress.projectTargetLease.authorityDigest })
  assert.strictEqual(routeAfterTerminal.status, 'unbound')
  assert.strictEqual(routeAfterTerminal.entry.lastTerminalReceiptDigest, terminal.structuredContent.receipt.receiptDigest)
  const terminalOwnerRead = readFencedTaskWriteOwner({
    metaDir,
    identity: { ...recoveryIdentity, taskStatus: 'completed' }
  })
  assert.strictEqual(terminalOwnerRead.owner.status, 'terminal')
}

function testMemoryArtifactMutationReconciliationContract() {
  setupLegacyWorkspace()
  const activeRoot = path.join(TEMP_ROOT, '.devcodex')
  const project = path.basename(TEMP_ROOT)
  const ingress = buildTaskAuthorityIngress({ activeRoot, project, suffix: 'artifact-reconciliation' })
  writeTaskAuthorityLifecycleState(activeRoot, project, ingress)
  const admissionArgs = {
    operation: 'admit',
    ingressRef: ingress.ingressRef,
    task: {
      taskKind: 'bugs',
      entryVariant: 'fix',
      displayName: 'MCP artifact reconciliation task'
    },
    overview: { content: '# 问题概况\n\nMCP artifact reconciliation test.\n' }
  }
  const admitted = resultById(runServer('mcp/memory-server.js', [
    rpcRequest(1, 'tools/call', { name: 'memory_task_admit_v2', arguments: admissionArgs })
  ], TEMP_ROOT), 1).structuredContent
  const taskRoot = path.join(activeRoot, ...admitted.taskRootRelative.split('/'))
  const metaDir = resolveTaskRecoveryMetaDir({ activeRoot, project })
  const recoveryIdentity = { activeRoot, project, taskId: admitted.taskId, taskStatus: 'active' }

  function needsReconcileCloseout(operationId, fileName, afterContent) {
    const target = path.join(taskRoot, 'reports', 'codex', '20260827', fileName)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    assert.strictEqual(fs.existsSync(target), false)
    const footprint = extractMutationFootprint({
      tool_name: 'Write',
      tool_input: { file_path: target, content: afterContent }
    }, { cwd: TEMP_ROOT })
    assert(footprint.plannedCreates.includes(target))
    assert.deepStrictEqual(footprint.plannedModifies, [])
    const decision = decideArtifactMutation({
      footprint,
      activeRoot,
      projectRoot: TEMP_ROOT,
      cwd: TEMP_ROOT,
      project,
      taskRecoveryKey: admitted.taskId,
      contextEpoch: ingress.actualInstructionEnvelope.contextEpoch,
      intent: 'fix',
      taskKind: 'bugs',
      taskName: path.basename(taskRoot),
      authoritySourceRef: `fixture:${operationId}`
    })
    assert.strictEqual(decision.decisionStatus, 'allow', JSON.stringify(decision.errorCodes))
    assert.strictEqual(decision.operation, 'create-or-update')
    const preObservation = createMutationPreObservation({ operationId, footprint })
    const recoveryFootprint = projectMutationFootprintForRecovery(footprint)
    assert.strictEqual(recoveryFootprint.schemaVersion, 'MutationFootprintRecoveryProjectionV2')
    assert.strictEqual(recoveryFootprint.sourceSchemaVersion, footprint.schemaVersion)
    assert.strictEqual(recoveryFootprint.footprintDigest, footprint.footprintDigest)
    assert.deepStrictEqual(recoveryFootprint.normalizedTargets, footprint.normalizedTargets)
    const lease = createTaskOwnedMutationLease({
      operationId,
      project,
      taskId: admitted.taskId,
      contextEpoch: ingress.actualInstructionEnvelope.contextEpoch,
      routeRevision: ingress.workflowRouteDecision.routeRevision,
      owner: { ownerGeneration: 1, leaseDigest: 'a'.repeat(64) },
      decision
    })
    fs.writeFileSync(target, afterContent)
    const observation = observeMutationEffects({
      operationId,
      decision,
      lease,
      footprint,
      preObservation,
      payload: { isError: true },
      success: false
    })
    assert.strictEqual(observation.status, 'needs-reconcile')
    const lifecycleCloseout = {
      schemaVersion: 'LifecycleMutationCloseoutV2',
      operationId,
      toolName: 'Write',
      completedAt: observation.completedAt,
      result: 'needs-reconcile',
      authorizationErrors: ['mutation-tool-reported-failure'],
      observation,
      artifactCloseout: observation.closeout
    }
    const inFlightOperation = {
      operationId,
      toolName: 'Write',
      startedAt: new Date().toISOString(),
      mutating: true,
      targetPaths: [target],
      artifactDecision: decision,
      mutationFootprint: recoveryFootprint,
      mutationLease: lease,
      mutationPreObservation: preObservation
    }
    return { lifecycleCloseout, inFlightOperation, target }
  }

  const primary = needsReconcileCloseout(
    'mcp-primary-artifact-reconciliation',
    '01--primary.md',
    '# primary after\n'
  )
  const primaryCommit = updateTaskRecoveryState({ metaDir, identity: recoveryIdentity }, state => ({
    ...state,
    turnLiveness: {
      ...(state.turnLiveness || {}),
      inFlightOperation: primary.inFlightOperation,
      lastMutationCloseout: primary.lifecycleCloseout
    }
  }), { force: true, reason: 'mutation-closeout' })
  assert(['committed', 'semantic-noop'].includes(primaryCommit.status), JSON.stringify(primaryCommit))

  const omittedFormalTaskResult = resultById(runServer('mcp/memory-server.js', [
    rpcRequest(2, 'tools/call', {
      name: 'memory_artifact_mutation_reconcile_v1',
      arguments: {
        ingressRef: ingress.ingressRef,
        operationId: primary.lifecycleCloseout.operationId,
        expectedCloseoutDigest: primary.lifecycleCloseout.artifactCloseout.closeoutDigest,
        resolution: 'accept-observed-effects'
      }
    })
  ], TEMP_ROOT), 2)
  assert.strictEqual(omittedFormalTaskResult.isError, true)
  assert.match(JSON.stringify(omittedFormalTaskResult), /ARTIFACT_RECONCILIATION_TASK_REQUIRED/)

  const primaryResponses = runServer('mcp/memory-server.js', [
    rpcRequest(2, 'tools/list'),
    rpcRequest(3, 'tools/call', {
      name: 'memory_artifact_mutation_reconcile_v1',
      arguments: {
        ingressRef: ingress.ingressRef,
        taskId: admitted.taskId,
        operationId: primary.lifecycleCloseout.operationId,
        expectedCloseoutDigest: primary.lifecycleCloseout.artifactCloseout.closeoutDigest,
        resolution: 'accept-observed-effects'
      }
    }),
    rpcRequest(4, 'tools/call', {
      name: 'memory_artifact_mutation_reconcile_v1',
      arguments: {
        ingressRef: ingress.ingressRef,
        taskId: admitted.taskId,
        operationId: primary.lifecycleCloseout.operationId,
        expectedCloseoutDigest: primary.lifecycleCloseout.artifactCloseout.closeoutDigest,
        resolution: 'accept-observed-effects'
      }
    })
  ], TEMP_ROOT)
  const reconciliationSchema = findToolSchema(resultById(primaryResponses, 2).tools, 'memory_artifact_mutation_reconcile_v1')
  assert.deepStrictEqual(reconciliationSchema.required, ['ingressRef', 'operationId', 'expectedCloseoutDigest', 'resolution'])
  assert.strictEqual(reconciliationSchema.additionalProperties, false)
  assert.strictEqual(reconciliationSchema.properties.taskId === undefined, false)
  const primaryResult = resultById(primaryResponses, 3)
  assert.strictEqual(primaryResult.isError, false)
  assert.strictEqual(primaryResult.structuredContent.sourceKind, 'primary')
  assert.strictEqual(primaryResult.structuredContent.mutationAuthority, false)
  assert.strictEqual(primaryResult.structuredContent.receipt.schemaVersion, 'ArtifactMutationReconciliationReceiptV1')
  assert.strictEqual(resultById(primaryResponses, 4).structuredContent.replayed, true)

  const reserve = needsReconcileCloseout(
    'mcp-reserve-artifact-reconciliation',
    '02--reserve.md',
    '# reserve after\n'
  )
  const reservePrewrite = updateTaskRecoveryState({ metaDir, identity: recoveryIdentity }, state => ({
    ...state,
    turnLiveness: {
      ...(state.turnLiveness || {}),
      inFlightOperation: reserve.inFlightOperation
    }
  }), { force: true, reason: 'mutation-preflight' })
  assert(['committed', 'semantic-noop'].includes(reservePrewrite.status), JSON.stringify(reservePrewrite))
  const reserveWrite = writeEmergencyCloseout(storePaths(metaDir), {
    observedAt: new Date().toISOString(),
    status: 'needs-reconcile',
    reason: 'mutation-closeout',
    identity: recoveryIdentity,
    admissionTransaction: null,
    fencedWriteOwner: null,
    workflowTaskTerminalReceipt: null,
    inFlightOperation: reserve.inFlightOperation,
    lastMutationCloseout: reserve.lifecycleCloseout,
    stateDigest: 'b'.repeat(64)
  })
  assert.strictEqual(reserveWrite.status, 'closeout-reserved')
  const reserveDriftCommit = updateTaskRecoveryState({ metaDir, identity: recoveryIdentity }, state => ({
    ...state,
    turnLiveness: {
      ...(state.turnLiveness || {}),
      inFlightOperation: {
        ...reserve.inFlightOperation,
        mutationLease: {
          ...reserve.inFlightOperation.mutationLease,
          leaseDigest: 'c'.repeat(64)
        }
      }
    }
  }), { force: true, reason: 'mutation-preflight-drift-probe' })
  assert(['committed', 'semantic-noop'].includes(reserveDriftCommit.status), JSON.stringify(reserveDriftCommit))
  const reserveDriftResult = resultById(runServer('mcp/memory-server.js', [
    rpcRequest(5, 'tools/call', {
      name: 'memory_artifact_mutation_reconcile_v1',
      arguments: {
        ingressRef: ingress.ingressRef,
        taskId: admitted.taskId,
        operationId: reserve.lifecycleCloseout.operationId,
        expectedCloseoutDigest: reserve.lifecycleCloseout.artifactCloseout.closeoutDigest,
        resolution: 'accept-observed-effects'
      }
    })
  ], TEMP_ROOT), 5)
  assert.strictEqual(reserveDriftResult.isError, true)
  assert.match(JSON.stringify(reserveDriftResult), /ARTIFACT_RECONCILIATION_PRIMARY_DRIFT/)
  const reserveRestore = updateTaskRecoveryState({ metaDir, identity: recoveryIdentity }, state => ({
    ...state,
    turnLiveness: {
      ...(state.turnLiveness || {}),
      inFlightOperation: reserve.inFlightOperation
    }
  }), { force: true, reason: 'mutation-preflight-restore' })
  assert(['committed', 'semantic-noop'].includes(reserveRestore.status), JSON.stringify(reserveRestore))
  const reserveResult = resultById(runServer('mcp/memory-server.js', [
    rpcRequest(6, 'tools/call', {
      name: 'memory_artifact_mutation_reconcile_v1',
      arguments: {
        ingressRef: ingress.ingressRef,
        taskId: admitted.taskId,
        operationId: reserve.lifecycleCloseout.operationId,
        expectedCloseoutDigest: reserve.lifecycleCloseout.artifactCloseout.closeoutDigest,
        resolution: 'accept-observed-effects'
      }
    })
  ], TEMP_ROOT), 6)
  assert.strictEqual(reserveResult.isError, false)
  assert.strictEqual(reserveResult.structuredContent.sourceKind, 'emergency-reserve')
  assert.strictEqual(reserveResult.structuredContent.receipt.reserveSequence, reserveWrite.sequence)
  assert.strictEqual(reserveResult.structuredContent.mutationAuthority, false)
}

function testMemoryServerOwnedTakeoverObservation() {
  setupLegacyWorkspace()
  const activeRoot = path.join(TEMP_ROOT, '.devcodex')
  const project = path.basename(TEMP_ROOT)
  const nowMs = Date.now()
  const priorIngress = buildTaskAuthorityIngress({
    activeRoot,
    project,
    suffix: 'takeover-prior',
    nowMs: nowMs - 2 * 60 * 60 * 1000
  })
  const taskId = '0da6244f-b4eb-4a6a-83ec-e9e31dc28937'
  const taskRootRelative = 'bugs/MCP-native-takeover-task'
  const taskRoot = path.join(activeRoot, ...taskRootRelative.split('/'))
  fs.mkdirSync(path.join(taskRoot, '.memory'), { recursive: true })
  const taskIdentity = createTaskIdentityV2({
    taskId,
    displayName: 'MCP native takeover task',
    aliases: [],
    project,
    projectRootIdentityDigest: '9'.repeat(64),
    taskKind: 'bugs',
    entryVariant: 'continue',
    taskRootRelative,
    createdAt: new Date(nowMs - 24 * 60 * 60 * 1000).toISOString()
  })
  fs.writeFileSync(path.join(taskRoot, '.memory', 'task.json'), `${JSON.stringify(taskIdentity, null, 2)}\n`)
  const confirmedArtifact = '01-问题确认.md'
  const confirmedContent = '# 问题确认\n\nMCP portable takeover confirmed.\n'
  fs.writeFileSync(path.join(taskRoot, confirmedArtifact), confirmedContent)
  const confirmedDigest = crypto.createHash('sha256').update(confirmedContent).digest('hex')
  fs.writeFileSync(path.join(taskRoot, '.memory', 'sessions.md'), [
    '# MCP native takeover task — 工作流状态',
    '',
    '### CP 确认记录',
    '',
    '| CP | 状态 | artifactPath | version | sha256 | sourceMessage | confirmedAt |',
    '|:--:|:----:|--------------|---------|--------|---------------|-------------|',
    `| CP1 | ✅ | ${confirmedArtifact} | v1 | ${confirmedDigest} | mcp-test | ${new Date(nowMs - 60 * 60 * 1000).toISOString()} |`,
    '| CP2 | ⏹️ | — | — | — | — | — |',
    '| CP3 | ⏹️ | — | — | — | — | — |',
    ''
  ].join('\n'))
  const admissionInput = {
    operation: 'bind',
    activeRoot,
    project,
    actualInstructionEnvelope: priorIngress.actualInstructionEnvelope,
    workItemSet: priorIngress.workItemSet,
    workflowRouteDecision: priorIngress.workflowRouteDecision,
    projectTargetLease: priorIngress.projectTargetLease,
    task: { taskId, taskKind: 'bugs', entryVariant: 'continue', taskRootRelative },
    overview: { content: '# 问题概况\n\nNative TaskIdentityV2 takeover.\n' }
  }
  const ownerIssuedAt = nowMs - 31 * 60 * 1000
  const admitted = executeTaskAdmission(admissionInput, { nowMs: ownerIssuedAt })
  const acquired = executeTaskWriteOwner({
    operation: 'acquire',
    activeRoot,
    project,
    actualInstructionEnvelope: priorIngress.actualInstructionEnvelope,
    workItemSet: priorIngress.workItemSet,
    workflowRouteDecision: priorIngress.workflowRouteDecision,
    projectTargetLease: priorIngress.projectTargetLease,
    taskId: admitted.taskId,
    admissionId: admitted.admissionId
  }, {
    nowMs: ownerIssuedAt,
    nonceFactory: () => `owner-${'a'.repeat(40)}`
  })
  assert.strictEqual(fs.existsSync(path.join(taskRoot, '.memory', 'task.json')), true)
  assert.strictEqual(fs.existsSync(path.join(taskRoot, '.memory', 'task-identity-v2.json')), false)
  assert.strictEqual(
    JSON.parse(fs.readFileSync(path.join(taskRoot, '.memory', 'task.json'), 'utf8')).projectRootIdentityDigest,
    '9'.repeat(64),
    'MCP takeover must preserve the original physical-root provenance after relocation'
  )

  const routeIndex = createWorkspaceSessionRouteIndex({
    metaDir: path.join(activeRoot, '.memory', 'hooks', 'legacy'),
    fs,
    path
  })
  routeIndex.update({
    sessionDigest: priorIngress.projectTargetLease.authorityDigest,
    projectRootIdentityDigest: priorIngress.projectTargetLease.rootIdentityDigest,
    taskId: admitted.taskId,
    routeRevision: priorIngress.workflowRouteDecision.routeRevision,
    trigger: 'task-bind'
  })
  routeIndex.update({
    sessionDigest: priorIngress.projectTargetLease.authorityDigest,
    projectRootIdentityDigest: priorIngress.projectTargetLease.rootIdentityDigest,
    taskId: '',
    routeRevision: priorIngress.workflowRouteDecision.routeRevision,
    trigger: 'terminal-unbind',
    lastTerminalReceiptDigest: 'b'.repeat(64)
  })

  const takeoverIngress = buildTaskAuthorityIngress({ activeRoot, project, suffix: 'takeover-current', nowMs })
  writeTaskAuthorityLifecycleState(activeRoot, project, takeoverIngress, {
    turnLiveness: {
      state: 'running',
      inFlightOperation: {
        ownedByAgent: true,
        leaseExpiresAt: new Date(nowMs + 60 * 1000).toISOString()
      }
    }
  })
  const takeoverArgs = {
    operation: 'takeover-prepare',
    ingressRef: takeoverIngress.ingressRef,
    taskId: admitted.taskId,
    admissionId: admitted.admissionId,
    expectedOwner: acquired.ownerRef,
    serverObservation: {
      canonicalTaskReadback: false,
      noLiveTurn: false,
      reconcileReceiptDigest: 'f'.repeat(64)
    }
  }
  const responses = runServer('mcp/memory-server.js', [
    rpcRequest(10, 'tools/call', { name: 'memory_task_write_owner', arguments: takeoverArgs })
  ], TEMP_ROOT)
  const prepared = resultById(responses, 10)
  assert.strictEqual(prepared.isError, false)
  assert.strictEqual(prepared.structuredContent.status, 'takeover-pending')
  assert.strictEqual(prepared.structuredContent.takeoverObservation.canonicalTaskReadback, true)
  assert.strictEqual(prepared.structuredContent.takeoverObservation.noLiveTurn, true)
  assert.strictEqual(prepared.structuredContent.takeoverObservation.activeOperationLease, true)
  assert.strictEqual(prepared.structuredContent.takeoverObservation.activeOperationLeaseForPriorOwner, false)
  assert.match(prepared.structuredContent.takeoverObservation.canonicalTaskSourceDigest, /^[a-f0-9]{64}$/)

  const acceptedResponses = runServer('mcp/memory-server.js', [
    rpcRequest(11, 'tools/call', {
      name: 'memory_task_write_owner',
      arguments: {
        operation: 'takeover-accept',
        ingressRef: takeoverIngress.ingressRef,
        taskId: admitted.taskId,
        admissionId: admitted.admissionId,
        expectedOwner: prepared.structuredContent.ownerRef,
        takeoverRefDigest: prepared.structuredContent.owner.takeoverRef.refDigest
      }
    })
  ], TEMP_ROOT)
  const accepted = resultById(acceptedResponses, 11)
  assert.strictEqual(accepted.isError, false)
  assert.strictEqual(accepted.structuredContent.status, 'active')
  assert.strictEqual(accepted.structuredContent.owner.sessionDigest, takeoverIngress.projectTargetLease.authorityDigest)
}

function testMemoryCloseoutReconcileUsesTerminalOwnerRoute() {
  setupLegacyWorkspace()
  const activeRoot = path.join(TEMP_ROOT, '.devcodex')
  const project = path.basename(TEMP_ROOT)
  const priorIngress = buildTaskAuthorityIngress({ activeRoot, project, suffix: 'reserve-owner' })
  const admissionInput = {
    operation: 'admit',
    activeRoot,
    project,
    actualInstructionEnvelope: priorIngress.actualInstructionEnvelope,
    workItemSet: priorIngress.workItemSet,
    workflowRouteDecision: priorIngress.workflowRouteDecision,
    projectTargetLease: priorIngress.projectTargetLease,
    task: { taskKind: 'bugs', entryVariant: 'fix', displayName: 'MCP reserve reconcile task' },
    overview: { content: '# 问题概况\n\nReserve route reconcile.\n' }
  }
  const admitted = executeTaskAdmission(admissionInput)
  const taskRoot = path.join(activeRoot, ...admitted.taskRootRelative.split('/'))
  confirmTaskAuthorityCp1(taskRoot)
  const acquired = executeTaskWriteOwner({
    operation: 'acquire',
    activeRoot,
    project,
    actualInstructionEnvelope: priorIngress.actualInstructionEnvelope,
    workItemSet: priorIngress.workItemSet,
    workflowRouteDecision: priorIngress.workflowRouteDecision,
    projectTargetLease: priorIngress.projectTargetLease,
    taskId: admitted.taskId,
    admissionId: admitted.admissionId
  }, { nonceFactory: () => `owner-${'d'.repeat(40)}` })
  const evidence = writeTaskTerminalEvidence(activeRoot, admitted.taskRootRelative, 'reserve-reconcile')
  const terminal = executeWorkflowTaskTerminal({
    activeRoot,
    project,
    actualInstructionEnvelope: priorIngress.actualInstructionEnvelope,
    workItemSet: priorIngress.workItemSet,
    workflowRouteDecision: priorIngress.workflowRouteDecision,
    projectTargetLease: priorIngress.projectTargetLease,
    taskId: admitted.taskId,
    admissionId: admitted.admissionId,
    terminalStatus: 'completed',
    expectedOwner: acquired.ownerRef,
    evidence
  }, {
    storeOptions: {
      reserveBytes: 8 * 1024 * 1024,
      softBytes: 1,
      hardBytes: 1,
      diskHeadroomBytes: 0,
      availableDiskBytes: 1024 * 1024 * 1024
    },
    nonceFactory: () => `owner-${'e'.repeat(40)}`
  })
  assert.strictEqual(terminal.status, 'terminal-closeout-reserved')

  const routeIndex = createWorkspaceSessionRouteIndex({
    metaDir: path.join(activeRoot, '.memory', 'hooks', 'legacy'),
    fs,
    path
  })
  routeIndex.update({
    sessionDigest: priorIngress.projectTargetLease.authorityDigest,
    projectRootIdentityDigest: priorIngress.projectTargetLease.rootIdentityDigest,
    taskId: admitted.taskId,
    routeRevision: priorIngress.workflowRouteDecision.routeRevision,
    trigger: 'task-bind'
  })
  const reconcileIngress = buildTaskAuthorityIngress({ activeRoot, project, suffix: 'reserve-reconciler' })
  routeIndex.update({
    sessionDigest: reconcileIngress.projectTargetLease.authorityDigest,
    projectRootIdentityDigest: reconcileIngress.projectTargetLease.rootIdentityDigest,
    taskId: 'reconcile-caller-task',
    routeRevision: reconcileIngress.workflowRouteDecision.routeRevision,
    trigger: 'task-bind'
  })
  writeTaskAuthorityLifecycleState(activeRoot, project, reconcileIngress)
  const responses = runServer('mcp/memory-server.js', [
    rpcRequest(12, 'tools/call', {
      name: 'memory_task_closeout_reconcile_v1',
      arguments: { ingressRef: reconcileIngress.ingressRef, taskId: admitted.taskId }
    })
  ], TEMP_ROOT)
  const reconciled = resultById(responses, 12)
  assert.strictEqual(reconciled.isError, false)
  assert.strictEqual(reconciled.structuredContent.status, 'reconciled')
  assert.strictEqual(
    routeIndex.read({ sessionDigest: priorIngress.projectTargetLease.authorityDigest }).status,
    'unbound'
  )
  const callerRoute = routeIndex.read({ sessionDigest: reconcileIngress.projectTargetLease.authorityDigest })
  assert.strictEqual(callerRoute.status, 'fresh')
  assert.strictEqual(callerRoute.entry.state, 'live', 'reserve reconciliation must not unbind the caller session')
}

function testMemoryActualHostEnvAgent() {
  setupLegacyWorkspace()
  const env = { DEVCODEX_AGENT: 'codex' }
  const allocation = allocateMemorySession(TEMP_ROOT, {
    date: '20260524', title: 'actual-host', intent: 'analyze'
  }, env)
  const responses = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'tools/call', {
      name: 'memory_session_write',
      arguments: {
        date: '20260524',
        sessionId: allocation.sessionId,
        sessionBinding: allocation.sessionBinding,
        content: '# session\n'
      }
    })
  ], TEMP_ROOT, env)

  assert.ok(resultById(responses, 1).capabilities.tools)
  assert.ok(resultById(responses, 2).content[0].text.includes('codex'))
  assert.ok(fs.existsSync(path.join(
    TEMP_ROOT, '.devcodex', '.memory', 'clients', 'codex', 'tasks', '20260524.md'
  )))
  assert.ok(!fs.existsSync(path.join(
    TEMP_ROOT, '.devcodex', '.memory', 'clients', 'claude-code', 'tasks', '20260524.md'
  )))
}

function testMemoryCpConfirmForBugs() {
  setupLegacyWorkspace()
  const responses = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'tools/call', {
      name: 'memory_cp_confirm',
      arguments: { requirement: 'Bug任务', kind: 'bugs', phase: 'CP2', time: '10:30' }
    })
  ], TEMP_ROOT)

  assert.ok(resultById(responses, 1).capabilities.tools)
  const text = resultById(responses, 2).content?.[0]?.text || ''
  assert.strictEqual(resultById(responses, 2).isError, true)
  assert.match(text, /MEMORY_CP_CONFIRMATION_UNBOUND/)
  const sessionsPath = path.join(TEMP_ROOT, '.devcodex', 'bugs', 'Bug任务', '.memory', 'sessions.md')
  assert.ok(!fs.existsSync(sessionsPath), 'unbound CP must have zero write effect')
}

function testMemoryCpConfirmForExtendedTaskKinds() {
  setupLegacyWorkspace()
  const responses = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'tools/call', {
      name: 'memory_cp_confirm',
      arguments: { requirement: '性能任务', kind: 'optimizations', phase: 'CP3', time: '11:00' }
    }),
    rpcRequest(3, 'tools/call', {
      name: 'memory_cp_confirm',
      arguments: { requirement: '场景测试任务', kind: 'scenario-tests', phase: 'CP3', time: '11:05' }
    })
  ], TEMP_ROOT)

  assert.ok(resultById(responses, 1).capabilities.tools)
  assert.strictEqual(resultById(responses, 2).isError, true)
  assert.strictEqual(resultById(responses, 3).isError, true)
  assert.match(resultById(responses, 2).content?.[0]?.text || '', /MEMORY_CP_CONFIRMATION_UNBOUND/)
  assert.match(resultById(responses, 3).content?.[0]?.text || '', /MEMORY_CP_CONFIRMATION_UNBOUND/)
  assert.ok(!fs.existsSync(path.join(TEMP_ROOT, '.devcodex', 'optimizations', '性能任务', '.memory', 'sessions.md')))
  assert.ok(!fs.existsSync(path.join(TEMP_ROOT, '.devcodex', 'scenario-tests', '场景测试任务', '.memory', 'sessions.md')))
}

function testMemoryCpConfirmRejectsArtifactPathEscape() {
  setupLegacyWorkspace()
  const taskRoot = path.join(TEMP_ROOT, '.devcodex', 'requirements', '路径边界任务')
  const outsideRoot = path.join(TEMP_ROOT, 'outside-cp-artifacts')
  const outsideArtifact = path.join(outsideRoot, 'outside.md')
  fs.mkdirSync(taskRoot, { recursive: true })
  fs.mkdirSync(outsideRoot, { recursive: true })
  fs.writeFileSync(outsideArtifact, '# must not be digest-bound from outside the task\n', 'utf8')
  const digest = crypto.createHash('sha256').update(fs.readFileSync(outsideArtifact)).digest('hex')

  const relativeEscape = path.relative(taskRoot, outsideArtifact).replace(/\\/g, '/')
  const responses = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'tools/call', {
      name: 'memory_cp_confirm',
      arguments: {
        requirement: '路径边界任务',
        phase: 'CP1',
        artifactPath: relativeEscape,
        artifactSha256: digest
      }
    }),
    rpcRequest(2, 'tools/call', {
      name: 'memory_cp_confirm',
      arguments: {
        requirement: '路径边界任务',
        phase: 'CP1',
        artifactPath: outsideArtifact,
        artifactSha256: digest
      }
    })
  ], TEMP_ROOT)

  assert.strictEqual(resultById(responses, 1).isError, true)
  assert.match(resultById(responses, 1).content?.[0]?.text || '', /ConfirmBindingGate.*artifactPath/i)
  assert.strictEqual(resultById(responses, 2).isError, true)
  assert.match(resultById(responses, 2).content?.[0]?.text || '', /ConfirmBindingGate.*artifactPath/i)
  assert.ok(!fs.existsSync(path.join(taskRoot, '.memory', 'sessions.md')))

  const linkPath = path.join(taskRoot, 'linked-outside')
  let linkCreated = false
  try {
    fs.symlinkSync(outsideRoot, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
    linkCreated = true
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error
  }
  if (linkCreated) {
    const linked = runServer('mcp/memory-server.js', [
      rpcRequest(3, 'tools/call', {
        name: 'memory_cp_confirm',
        arguments: {
          requirement: '路径边界任务',
          phase: 'CP1',
          artifactPath: 'linked-outside/outside.md',
          artifactSha256: digest
        }
      })
    ], TEMP_ROOT)
    assert.strictEqual(resultById(linked, 3).isError, true)
    assert.match(resultById(linked, 3).content?.[0]?.text || '', /ConfirmBindingGate.*artifactPath/i)
    assert.ok(!fs.existsSync(path.join(taskRoot, '.memory', 'sessions.md')))
  }
}

function testMemoryCpConfirmPreservesOrdinaryTables() {
  setupLegacyWorkspace()
  const taskRoot = path.join(TEMP_ROOT, '.devcodex', 'requirements', '表格任务')
  const sessionsPath = path.join(taskRoot, '.memory', 'sessions.md')
  const artifactPath = path.join(taskRoot, '02-技术方案.md')
  fs.mkdirSync(path.dirname(sessionsPath), { recursive: true })
  fs.writeFileSync(artifactPath, '# 技术方案\n', 'utf8')
  const ordinaryTable = [
    '# Requirement Sessions — 表格任务',
    '',
    '| 日期 | 会话 | 变更 | 产物 | 状态 |',
    '|---|---|---|---|---|',
    '| 2026-07-20 | codex-01 | 需求确认 | `01.md` | ✅ |',
    ''
  ].join('\n')
  fs.writeFileSync(sessionsPath, ordinaryTable, 'utf8')
  const digest = crypto.createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex')

  const first = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'tools/call', {
      name: 'memory_cp_confirm',
      arguments: {
        requirement: '表格任务',
        phase: 'CP2',
        time: '12:00',
        artifactPath: '02-技术方案.md',
        artifactVersion: 'v1.0',
        artifactSha256: digest,
        sourceMessage: '批准|确认\n继续'
      }
    })
  ], TEMP_ROOT)
  const confirmation = resultById(first, 1)
  assert.notStrictEqual(
    confirmation.isError,
    true,
    confirmation.content?.[0]?.text || 'memory_cp_confirm unexpectedly failed'
  )
  assert.strictEqual(confirmation.structuredContent.readbackVerified, true)
  assert.strictEqual(confirmation.structuredContent.cpRowCount, 3)
  assert.strictEqual(confirmation.structuredContent.artifactAuthority.schemaVersion, 'MemoryCpArtifactAuthorityV1')
  assert.strictEqual(confirmation.structuredContent.artifactAuthority.rootKind, 'task')
  assert.strictEqual(confirmation.structuredContent.artifactAuthority.canonicalRelativePath, '02-技术方案.md')
  assert.match(confirmation.structuredContent.artifactAuthority.rootIdentity, /^[a-f0-9]{64}$/)
  assert.strictEqual(
    confirmation.structuredContent.artifactLinks.links[0].targetPath,
    'requirements/表格任务/02-技术方案.md'
  )
  let sessions = fs.readFileSync(sessionsPath, 'utf8')
  assert.ok(sessions.startsWith(ordinaryTable.trimEnd()), 'ordinary session table must remain unchanged')
  assert.strictEqual((sessions.match(/^### CP 确认记录$/gm) || []).length, 1)
  assert.strictEqual((sessions.match(/^\|\s*CP[123]\s*\|/gm) || []).length, 3)
  assert.ok(sessions.includes(buildExtendedCpTable({
    phases: {
      CP1: { status: '⏳', artifactPath: '—', artifactVersion: '—', artifactSha256: '—', sourceMessage: '—', confirmedAt: '—' },
      CP2: { status: '✅', artifactPath: '[02-技术方案.md](../02-技术方案.md)', artifactVersion: 'v1.0', artifactSha256: `\`${digest.toUpperCase()}\``, sourceMessage: '批准 确认 继续', confirmedAt: '12:00' },
      CP3: { status: '⏹️', artifactPath: '—', artifactVersion: '—', artifactSha256: '—', sourceMessage: '—', confirmedAt: '—' }
    }
  })), 'memory MCP CP writer must match scripts/lib/cp-digest.js renderer')
  const parsedByOwner = parseCpSessions(sessions)
  assert.strictEqual(parsedByOwner.CP2.artifactSha256, digest.toUpperCase())
  assert.strictEqual(parsedByOwner.CP2.sourceMessage, '批准 确认 继续')
  assert.match(sessions, /\| CP2 \| ✅ \| \[02-技术方案\.md\]\(\.\.\/02-技术方案\.md\) \| v1\.0 \| `[A-F0-9]{64}` \| 批准 确认 继续 \| 12:00 \|/)

  const second = runServer('mcp/memory-server.js', [
    rpcRequest(2, 'tools/call', {
      name: 'memory_cp_confirm',
      arguments: {
        requirement: '表格任务',
        phase: 'CP3',
        time: '12:05',
        artifactPath: '02-技术方案.md',
        artifactVersion: 'v1.0',
        artifactSha256: digest,
        sourceMessage: '自动确认'
      }
    })
  ], TEMP_ROOT)
  assert.strictEqual(resultById(second, 2).structuredContent.readbackVerified, true)
  sessions = fs.readFileSync(sessionsPath, 'utf8')
  assert.strictEqual((sessions.match(/^### CP 确认记录$/gm) || []).length, 1)
  assert.strictEqual((sessions.match(/^\|\s*CP[123]\s*\|/gm) || []).length, 3)
  assert.match(sessions, /\| CP2 \| ✅ \|/)
  assert.match(sessions, /\| CP3 \| ✅ \|/)

  const legacyTaskRoot = path.join(TEMP_ROOT, '.devcodex', 'requirements', '旧表任务')
  const legacySessions = path.join(legacyTaskRoot, '.memory', 'sessions.md')
  fs.mkdirSync(path.dirname(legacySessions), { recursive: true })
  fs.writeFileSync(legacySessions, [
    '# 旧表任务', '', '### CP 确认记录', '',
    '| CP | 状态 | 时间 |', '|---|---|---|',
    '| CP1 | ✅ | 09:00 |', '| CP2 | ⏹️ | — |', '| CP3 | ⏹️ | — |', ''
  ].join('\n'), 'utf8')
  const legacyBefore = fs.readFileSync(legacySessions, 'utf8')
  const legacy = runServer('mcp/memory-server.js', [
    rpcRequest(3, 'tools/call', {
      name: 'memory_cp_confirm',
      arguments: { requirement: '旧表任务', phase: 'CP2', time: '12:10' }
    })
  ], TEMP_ROOT)
  assert.strictEqual(resultById(legacy, 3).isError, true)
  assert.match(resultById(legacy, 3).content?.[0]?.text || '', /MEMORY_CP_CONFIRMATION_UNBOUND/)
  const upgraded = fs.readFileSync(legacySessions, 'utf8')
  assert.strictEqual(upgraded, legacyBefore, 'unbound legacy CP rejection must not rewrite the existing table')
}

/**
 * PF-162 / GR-068: sessions.md already has a 5-col session index table and no CP section.
 * Writer must append a dedicated CP block (heading + 7-col header + CP1~CP3), never a bare CP row under the index table.
 * Also repairs orphan CP rows previously leaked under the ordinary table.
 */
function testMemoryCpConfirmGenericSessionIndexWithoutCpSection() {
  setupLegacyWorkspace()
  const taskRoot = path.join(TEMP_ROOT, '.devcodex', 'requirements', '会话索引无CP表')
  const sessionsPath = path.join(taskRoot, '.memory', 'sessions.md')
  const artifactPath = path.join(taskRoot, '01-需求确认.md')
  fs.mkdirSync(path.dirname(sessionsPath), { recursive: true })
  fs.writeFileSync(artifactPath, '# 需求确认\nv0.1\n', 'utf8')
  const sessionIndex = [
    '# Requirement Sessions — 会话索引无CP表',
    '',
    '| 日期 | 会话 | 变更 | 产物 | 状态 |',
    '|------|------|------|------|------|',
    '| 2026-07-20 | 01 | 需求整理 | `00-需求概况.md` | 🔄 |',
    '| 2026-07-20 | 02 | CP1 草稿 | `01-需求确认.md` | 🔄 |',
    ''
  ].join('\n')
  fs.writeFileSync(sessionsPath, sessionIndex, 'utf8')
  const digest = crypto.createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex')

  const first = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'tools/call', {
      name: 'memory_cp_confirm',
      arguments: {
        requirement: '会话索引无CP表',
        phase: 'CP1',
        time: '18:32',
        artifactPath: '01-需求确认.md',
        artifactVersion: 'v0.1',
        artifactSha256: digest,
        sourceMessage: '确认需求'
      }
    })
  ], TEMP_ROOT)
  const confirmation = resultById(first, 1)
  assert.strictEqual(confirmation.isError, undefined, 'confirm must succeed')
  assert.strictEqual(confirmation.structuredContent.readbackVerified, true)
  assert.strictEqual(confirmation.structuredContent.cpRowCount, 3)

  let sessions = fs.readFileSync(sessionsPath, 'utf8')
  const beforeCp = sessions.split(/^### CP 确认记录$/m)[0]
  assert.ok(beforeCp.includes('| 日期 | 会话 | 变更 | 产物 | 状态 |'), 'session index header must remain')
  assert.ok(beforeCp.includes('| 2026-07-20 | 01 |'), 'session index rows must remain')
  assert.strictEqual((beforeCp.match(/^\|\s*CP[123]\s*\|/gm) || []).length, 0, 'no CP data rows under session index')
  assert.strictEqual((sessions.match(/^### CP 确认记录$/gm) || []).length, 1)
  assert.match(sessions, /\| CP \| 状态 \| artifactPath \| version \| sha256 \| sourceMessage \| confirmedAt \|/)
  assert.strictEqual((sessions.match(/^\|\s*CP[123]\s*\|/gm) || []).length, 3)
  assert.match(sessions, /\| CP1 \| ✅ \|/)
  const parsed = parseCpSessions(sessions)
  assert.strictEqual(parsed.CP1.confirmed, true)
  assert.strictEqual(parsed.CP1.artifactSha256, digest.toUpperCase())

  // Malformed mixed table: orphan 7-col CP row under 5-col index without CP heading (historical false-success shape)
  const polluted = [
    sessionIndex.trimEnd(),
    '',
    `| CP1 | ✅ | \`01-需求确认.md\` | v0.1 | \`${digest.toUpperCase()}\` | 旧泄漏行 | 17:00 |`,
    ''
  ].join('\n')
  fs.writeFileSync(sessionsPath, polluted, 'utf8')
  const repair = runServer('mcp/memory-server.js', [
    rpcRequest(2, 'tools/call', {
      name: 'memory_cp_confirm',
      arguments: {
        requirement: '会话索引无CP表',
        phase: 'CP1',
        time: '18:40',
        artifactPath: '01-需求确认.md',
        artifactVersion: 'v0.1',
        artifactSha256: digest,
        sourceMessage: '修复后重确认'
      }
    })
  ], TEMP_ROOT)
  assert.strictEqual(resultById(repair, 2).structuredContent.readbackVerified, true)
  sessions = fs.readFileSync(sessionsPath, 'utf8')
  const beforeAfterRepair = sessions.split(/^### CP 确认记录$/m)[0]
  assert.strictEqual((beforeAfterRepair.match(/^\|\s*CP[123]\s*\|/gm) || []).length, 0, 'orphan CP row under index must be stripped')
  assert.strictEqual((sessions.match(/^### CP 确认记录$/gm) || []).length, 1)
  assert.strictEqual((sessions.match(/^\|\s*CP[123]\s*\|/gm) || []).length, 3)
  assert.match(sessions, /修复后重确认/)
}

function testMemoryProjectionQueriesAndZeroWrite() {
  const fixture = setupMemoryProjectionFixture()
  const contextBinding = createTestContextBinding(TEMP_ROOT, { intent: 'resume' })
  const memoryRoot = path.join(TEMP_ROOT, '.devcodex', '.memory', 'clients')
  const before = snapshotTree(memoryRoot)
  const responses = runServer('mcp/memory-server.js', bindGovernedContextReads([
    rpcRequest(1, 'tools/list'),
    rpcRequest(2, 'tools/call', { name: 'memory_status', arguments: { limit: 2 } }),
    rpcRequest(3, 'tools/call', {
      name: 'memory_session_query',
      arguments: { date: '20260717', sessionId: '03', limit: 1, maxChars: 12000 }
    }),
    rpcRequest(4, 'tools/call', {
      name: 'memory_session_query',
      arguments: { date: '20260717', sessionId: '03', handoffOnly: true }
    }),
    rpcRequest(5, 'tools/call', {
      name: 'memory_session_query',
      arguments: { date: '20260717', status: 'active', limit: 20, maxChars: 50000 }
    }),
    rpcRequest(6, 'tools/call', {
      name: 'memory_session_query',
      arguments: { date: '20260717', sessionId: '03', maxChars: 40 }
    }),
    rpcRequest(7, 'tools/call', {
      name: 'memory_session_query',
      arguments: { date: '20260715', sessionId: '99' }
    }),
    rpcRequest(8, 'tools/call', { name: 'memory_summary_query', arguments: {} }),
    rpcRequest(9, 'tools/call', {
      name: 'memory_summary_query',
      arguments: { status: 'unresolved', since: '2026-07-16', limit: 50 }
    }),
    rpcRequest(10, 'tools/call', {
      name: 'memory_summary_query',
      arguments: { status: 'all', limit: 2 }
    }),
    rpcRequest(11, 'tools/call', {
      name: 'memory_session_read',
      arguments: { date: '20260717' }
    }),
    rpcRequest(12, 'tools/call', { name: 'memory_summary_read', arguments: {} })
  ], contextBinding), TEMP_ROOT)

  const tools = resultById(responses, 1).tools
  const toolNames = tools.map(tool => tool.name)
  for (const name of ['memory_status', 'memory_session_query', 'memory_summary_query']) {
    assert(toolNames.includes(name), `missing additive memory tool: ${name}`)
  }
  assert(toolNames.includes('memory_session_read'))
  assert(toolNames.includes('memory_session_write'))
  assert.strictEqual(
    tools.find(tool => tool.name === 'memory_status').inputSchema.properties.limit.maximum,
    20
  )
  assert.strictEqual(
    tools.find(tool => tool.name === 'memory_session_query').inputSchema.properties.maxChars.maximum,
    50000
  )
  assert.strictEqual(
    tools.find(tool => tool.name === 'memory_session_query').inputSchema.properties.cursor.maxLength,
    8192
  )
  assert.strictEqual(
    tools.find(tool => tool.name === 'memory_summary_query').inputSchema.properties.limit.maximum,
    50
  )
  assert.strictEqual(
    tools.find(tool => tool.name === 'memory_summary_query').inputSchema.properties.cursor.maxLength,
    8192
  )

  const status = toolJson(resultById(responses, 2))
  assert.strictEqual(status.schemaVersion, 'MemoryStatusV1')
  assert.strictEqual(status.activeRoot, path.join(TEMP_ROOT, '.devcodex'))
  assert.strictEqual(status.project, path.basename(TEMP_ROOT))
  assert.strictEqual(status.agent, 'claude-code')
  assert.match(status.today.date, /^\d{8}$/)
  assert.strictEqual(status.summary.exists, true)
  assert.strictEqual(status.latestRows.length, 2)
  assert.strictEqual(status.latestRows[0].summary, 'historical label fixture')
  assert(!status.activeSessionIds.includes('2026-07-17#03'))
  assert.deepStrictEqual(status.conflicts, [])
  assert.strictEqual(status.telemetry.filesRead, 1)
  assert.strictEqual(status.telemetry.tokens, null)
  assert.strictEqual(status.derivedIndexFreshness.status, 'stale')
  assert.strictEqual(status.canonicalSourceTrust.status, 'trusted')
  assert.strictEqual(status.canonicalSourceTrust.basis, 'bounded-source-scan-complete')
  assert.strictEqual(status.fallbackCoverage.status, 'complete')
  assert.strictEqual(status.repairState.status, 'repair-needed')
  assert.match(status.repairState.dedupeKey, /^memory-index-repair:[a-f0-9]{64}$/)
  assertMemoryProjectionIdentity(status, 'memory_status')

  const exact = toolJson(resultById(responses, 3))
  assert.strictEqual(exact.schemaVersion, 'MemorySessionQueryV1')
  assert.strictEqual(exact.query.sessionId, '03')
  assert.strictEqual(exact.source.activeRoot, path.join(TEMP_ROOT, '.devcodex'))
  assert.strictEqual(exact.matches.length, 1)
  assert.strictEqual(exact.matches[0].sessionId, '03')
  assert.match(exact.matches[0].content, /ACTIVE-BODY-SENTINEL/)
  assert.doesNotMatch(exact.matches[0].content, /COMPLETED-BODY-SENTINEL/)
  assert.strictEqual(exact.truncated, false)
  assertMemoryProjectionIdentity(exact, 'memory_session_query')

  const handoff = toolJson(resultById(responses, 4))
  assert.strictEqual(handoff.query.handoffOnly, true)
  assert.strictEqual(handoff.matches.length, 1)
  assert.match(handoff.matches[0].content, /ContextHandoffCard/)
  assert.match(handoff.matches[0].content, /NEXT-ACTION-SENTINEL/)
  assert.doesNotMatch(handoff.matches[0].content, /STALE-NEXT-ACTION|ACTIVE-BODY-SENTINEL|HANDOFF-TAIL-MUST-NOT-LEAK/)
  assert(handoff.matches[0].content.length < fixture.todayContent.length)

  const active = toolJson(resultById(responses, 5))
  assert.deepStrictEqual(
    active.matches.map(item => item.sessionId),
    fullDailyActiveSessionOracle(fixture.todayContent),
    'bounded active-session result must match the independent full-file oracle'
  )

  const truncated = toolJson(resultById(responses, 6))
  assert.strictEqual(truncated.matches[0].content.length, 40)
  assert.strictEqual(truncated.matches[0].truncated, true)
  assert.strictEqual(truncated.truncated, true)

  const empty = toolJson(resultById(responses, 7))
  assert.deepStrictEqual(empty.matches, [])
  assert.strictEqual(empty.source.exists, false)
  assert.strictEqual(empty.truncated, false)

  const defaultSummary = toolJson(resultById(responses, 8))
  assert.strictEqual(defaultSummary.schemaVersion, 'MemorySummaryQueryV1')
  assert.strictEqual(defaultSummary.query.status, 'active')
  assert.strictEqual(defaultSummary.totalMatched, 0)
  assert.deepStrictEqual(defaultSummary.rows, [])
  assert.strictEqual(
    defaultSummary.repairState.diagnosticFingerprint,
    status.repairState.diagnosticFingerprint,
    'the same stale summary state must expose one stable dedupe fingerprint'
  )
  assertMemoryProjectionIdentity(defaultSummary, 'memory_summary_query')

  const unresolved = toolJson(resultById(responses, 9))
  assert.deepStrictEqual(
    unresolved.rows.map(row => `${row.day}#${row.sessionId}`),
    fullSummaryUnresolvedOracle(fixture.summaryContent, '2026-07-16'),
    'bounded unresolved SUMMARY result must match the independent full-file oracle'
  )
  const lastTwo = toolJson(resultById(responses, 10))
  assert.strictEqual(lastTwo.rows.length, 2)
  assert.deepStrictEqual(lastTwo.rows.map(row => row.summary), [
    'historical label fixture',
    'completion event fixture',
  ])
  assert.strictEqual(lastTwo.truncated, true)

  assert.strictEqual(resultById(responses, 11).content[0].text, fixture.todayContent)
  assert.strictEqual(resultById(responses, 12).content[0].text, fixture.summaryContent)
  assert.deepStrictEqual(snapshotTree(memoryRoot), before, 'memory projections must not mutate canonical client memory sources')
}

function testMemoryProjectionErrorsAndMalformedSources() {
  const fixture = setupMemoryProjectionFixture()
  const contextBinding = createTestContextBinding(TEMP_ROOT, { intent: 'resume' })
  fs.appendFileSync(fixture.summaryPath, '| malformed |\n')
  const malformedDaily = path.join(path.dirname(fixture.todayPath), '20260718.md')
  fs.writeFileSync(malformedDaily, '# malformed daily\n\n状态：🔄 进行中\n')
  const responses = runServer('mcp/memory-server.js', bindGovernedContextReads([
    rpcRequest(1, 'tools/call', { name: 'memory_status', arguments: { limit: 21 } }),
    rpcRequest(2, 'tools/call', {
      name: 'memory_session_query',
      arguments: { date: '20260230' }
    }),
    rpcRequest(3, 'tools/call', {
      name: 'memory_session_query',
      arguments: { date: '20260717', maxChars: 50001 }
    }),
    rpcRequest(4, 'tools/call', {
      name: 'memory_summary_query',
      arguments: { since: '2026-02-30' }
    }),
    rpcRequest(5, 'tools/call', {
      name: 'memory_summary_query',
      arguments: { unknown: true }
    }),
    rpcRequest(6, 'tools/call', {
      name: 'memory_status',
      arguments: { agent: 'codex ' }
    }),
    rpcRequest(7, 'tools/call', {
      name: 'memory_summary_query',
      arguments: { status: 'pending-ish' }
    }),
    rpcRequest(8, 'tools/call', { name: 'memory_status', arguments: [] }),
    rpcRequest(9, 'tools/call', { name: 'memory_summary_query', arguments: { status: 'all' } }),
    rpcRequest(10, 'tools/call', {
      name: 'memory_session_query',
      arguments: { date: '20260718', status: 'active' }
    })
  ], contextBinding), TEMP_ROOT)

  for (let id = 1; id <= 8; id += 1) {
    const result = resultById(responses, id)
    assert.strictEqual(result.isError, true)
    const error = toolJson(result)
    assert.strictEqual(error.schemaVersion, 'ContextReadErrorV1')
    assert.strictEqual(error.errorCode, 'MEMORY_QUERY_INVALID')
    assert(error.message)
    assert(error.nextStep)
  }
  const malformed = toolJson(resultById(responses, 9))
  assert.strictEqual(malformed.schemaVersion, 'MemorySummaryQueryV1')
  assert(malformed.warnings.some(item => /malformed SUMMARY row/.test(item)))
  const malformedSession = toolJson(resultById(responses, 10))
  assert.deepStrictEqual(malformedSession.matches, [])
  assert(malformedSession.warnings.some(item => /No canonical session headings/.test(item)))

  const invalidLegacyDate = '20260231'
  const invalidLegacyPath = path.join(
    TEMP_ROOT,
    '.devcodex',
    '.memory',
    'clients',
    'claude-code',
    'tasks',
    `${invalidLegacyDate}.md`
  )
  const invalidLegacyResponses = runServer('mcp/memory-server.js', [
    rpcRequest(20, 'tools/call', {
      name: 'memory_session_read',
      arguments: { date: invalidLegacyDate }
    }),
    rpcRequest(21, 'tools/call', {
      name: 'memory_session_write',
      arguments: {
        date: invalidLegacyDate,
        content: '# must not be written\n',
        sessionId: '001',
        sessionBinding: 'a'.repeat(64)
      }
    }),
    rpcRequest(22, 'tools/call', {
      name: 'memory_session_allocate',
      arguments: { date: invalidLegacyDate, title: 'must-not-allocate', intent: 'fix' }
    })
  ], TEMP_ROOT)
  for (const id of [20, 21, 22]) {
    const result = resultById(invalidLegacyResponses, id)
    assert.strictEqual(result.isError, true)
    assert.match(result.content[0].text, /not a real calendar date/)
  }
  assert.strictEqual(fs.existsSync(invalidLegacyPath), false, 'invalid dates must remain zero-write')
}

function testMemoryProjectionLayoutTargets() {
  setupLayoutWorkspace()
  const projectBinding = createTestContextBinding(TEMP_ROOT, { intent: 'resume', project: 'chat' })
  const workspaceBinding = createTestContextBinding(TEMP_ROOT, { intent: 'resume', scope: 'workspace' })
  const responses = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'tools/call', { name: 'memory_status', arguments: {} }),
    rpcRequest(2, 'tools/call', { name: 'memory_status', arguments: { project: 'chat', contextBinding: projectBinding } }),
    rpcRequest(3, 'tools/call', { name: 'memory_summary_query', arguments: { scope: 'workspace', contextBinding: workspaceBinding } }),
    rpcRequest(4, 'tools/call', { name: 'memory_status', arguments: { project: '..\\escape' } })
  ], TEMP_ROOT)

  const ambiguous = resultById(responses, 1)
  assert.strictEqual(ambiguous.isError, true)
  assert.strictEqual(toolJson(ambiguous).errorCode, 'MEMORY_SCOPE_AMBIGUOUS')

  const project = toolJson(resultById(responses, 2))
  assert.strictEqual(project.activeRoot, path.join(TEMP_ROOT, '.devcodex', 'chat'))
  assert.strictEqual(project.project, 'chat')
  assert.strictEqual(project.summary.exists, false)

  const workspace = toolJson(resultById(responses, 3))
  assert.strictEqual(workspace.source.activeRoot, path.join(TEMP_ROOT, '.devcodex', 'workspace'))
  assert.strictEqual(workspace.source.project, '__workspace__')

  const traversal = resultById(responses, 4)
  assert.strictEqual(traversal.isError, true)
  assert.strictEqual(toolJson(traversal).errorCode, 'PROJECT_NAMESPACE_INVALID')
  assert.ok(!fs.existsSync(path.join(TEMP_ROOT, '.devcodex', 'escape')))
}

function testWorkspaceProfileContextReads() {
  setupContextPlanWorkspace()
  const planned = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'tools/call', {
      name: 'profile_context_plan',
      arguments: {
        intent: 'resume',
        scope: 'workspace',
        contextEpoch: 'workspace-profile-context-epoch',
        explicitFull: true,
        fullReadReason: 'workspace Profile authorization fixture'
      }
    })
  ], TEMP_ROOT)
  const plan = toolJson(resultById(planned, 1))
  assert.strictEqual(plan.identity.project, '__workspace__')
  assert.strictEqual(
    path.resolve(plan.identity.activeRoot),
    path.resolve(TEMP_ROOT, '.devcodex', 'workspace')
  )
  const responses = runServer('mcp/profile-server.js', [
    rpcRequest(2, 'tools/call', {
      name: 'profile_load',
      arguments: {
        scope: 'workspace',
        files: ['01-项目信息.md'],
        contextBinding: plan.contextBinding
      }
    }),
    rpcRequest(3, 'tools/call', {
      name: 'profile_skill_plan',
      arguments: {
        scope: 'workspace',
        candidateIds: ['intent'],
        executionOptimization: plan.executionOptimization,
        contextBinding: plan.contextBinding
      }
    }),
    rpcRequest(4, 'tools/call', {
      name: 'profile_load',
      arguments: {
        scope: 'workspace',
        project: 'chat',
        files: ['01-项目信息.md'],
        contextBinding: plan.contextBinding
      }
    })
  ], TEMP_ROOT)
  const loadText = resultById(responses, 2).content?.[0]?.text || ''
  assert.match(loadText, /HIDDEN-BODY-01-项目信息\.md/)
  const loadMeta = JSON.parse(/<!-- profile_load_budget (\{[^\n]+\}) -->/.exec(loadText)[1])
  assert.strictEqual(loadMeta.contextBinding.project, '__workspace__')
  const skillPlan = toolJson(resultById(responses, 3))
  assert.strictEqual(skillPlan.contextBinding.project, '__workspace__')
  assert.strictEqual(resultById(responses, 4).isError, true)
  assert.strictEqual(toolJson(resultById(responses, 4)).errorCode, 'CONTEXT_BINDING_INVALID')
}

function testAgentIdentitySharedModule() {
  const {
    VALID_AGENTS,
    normalizeAgent,
    detectRuntimeAgent
  } = require(path.join(ROOT, 'mcp', 'agent-identity.cjs'))

  assert.strictEqual(VALID_AGENTS.has('grok'), true)
  assert.strictEqual(normalizeAgent('grok'), 'grok')
  assert.strictEqual(normalizeAgent('claude'), '')
  assert.strictEqual(detectRuntimeAgent({ DEVCODEX_AGENT: 'grok' }), 'grok')
  assert.strictEqual(detectRuntimeAgent({ DEVCODEX_AGENT: 'codex', GROK_AGENT: '1' }), 'codex')
  assert.strictEqual(detectRuntimeAgent({ GROK_AGENT: '1' }), 'grok')
  assert.strictEqual(detectRuntimeAgent({ CLAUDE_CODE_VERSION: '1.0.0' }), 'claude-code')
  assert.strictEqual(detectRuntimeAgent({ CODEX_HOME: 'C:\\x' }), 'codex')
  // Unrecognized host must not impersonate Claude Code
  assert.strictEqual(detectRuntimeAgent({}), 'unknown-agent')
  assert.strictEqual(detectRuntimeAgent({ DEVCODEX_AGENT: '' }), 'unknown-agent')
}

function testMemoryProjectionAgentAmbiguity() {
  setupMemoryProjectionFixture()
  fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', '.memory', 'clients', 'codex'), { recursive: true })
  fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', '.memory', 'clients', 'copilot'), { recursive: true })
  const contextBinding = createTestContextBinding(TEMP_ROOT, {
    intent: 'resume',
    env: { DEVCODEX_AGENT: 'codex' }
  })
  const responses = runServer('mcp/memory-server.js', bindGovernedContextReads([
    rpcRequest(1, 'tools/call', { name: 'memory_status', arguments: {} }),
    rpcRequest(2, 'tools/call', { name: 'memory_status', arguments: { agent: 'codex' } }),
    rpcRequest(3, 'tools/call', { name: 'memory_status', arguments: {} })
  ], contextBinding), TEMP_ROOT, { DEVCODEX_AGENT: 'codex' })

  const explicitMissing = toolJson(resultById(responses, 2))
  assert.strictEqual(explicitMissing.agent, 'codex')
  assert.strictEqual(explicitMissing.summary.exists, false)
  const runtimePinned = toolJson(resultById(responses, 3))
  assert.strictEqual(runtimePinned.agent, 'codex')

  const unpinned = runServer('mcp/memory-server.js', [
    rpcRequest(4, 'tools/call', { name: 'memory_status', arguments: {} })
  ], TEMP_ROOT, { DEVCODEX_AGENT: '' })
  const ambiguous = resultById(unpinned, 4)
  assert.strictEqual(ambiguous.isError, true)
  const error = toolJson(ambiguous)
  assert.strictEqual(error.schemaVersion, 'ContextReadErrorV1')
  assert.strictEqual(error.errorCode, 'MEMORY_SCOPE_AMBIGUOUS')
  assert.match(error.message, /claude-code, codex, copilot/)
}

function testGrokAgentMemoryWrite() {
  setupMemoryProjectionFixture()
  const day = compactDateInTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const env = { DEVCODEX_AGENT: 'grok' }
  const contextBinding = createTestContextBinding(TEMP_ROOT, { intent: 'resume', env })
  const allocation = allocateMemorySession(TEMP_ROOT, {
    date: day, title: 'grok-agent', intent: 'analyze', agent: 'grok'
  }, env)
  const responses = runServer('mcp/memory-server.js', bindGovernedContextReads([
    rpcRequest(1, 'tools/call', {
      name: 'memory_session_write',
      arguments: {
        date: day,
        sessionId: allocation.sessionId,
        sessionBinding: allocation.sessionBinding,
        content: '# grok session\n',
        agent: 'grok'
      }
    }),
    rpcRequest(2, 'tools/call', {
      name: 'memory_status',
      arguments: { agent: 'grok' }
    })
  ], contextBinding), TEMP_ROOT, env)

  const writeResult = resultById(responses, 1)
  assert.notStrictEqual(writeResult.isError, true, writeResult.content?.[0]?.text || 'write failed')
  const statusResult = resultById(responses, 2)
  assert.notStrictEqual(statusResult.isError, true, statusResult.content?.[0]?.text || 'status failed')
  const status = toolJson(statusResult)
  assert.strictEqual(status.agent, 'grok')
  assert.strictEqual(status.today.exists, true)
  assert.ok(fs.existsSync(path.join(TEMP_ROOT, '.devcodex', '.memory', 'clients', 'grok', 'tasks', `${day}.md`)))
}

function testWorkspaceNamespaceProfileMerge() {
  setupLayoutWorkspace()
  const projectRoot = path.join(TEMP_ROOT, 'chat')
  const contextBinding = createTestContextBinding(projectRoot, {
    intent: 'resume',
    explicitFull: true,
    env: { DEVCODEX_AGENT: 'claude-code' }
  })
  const responses = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'tools/call', { name: 'profile_get_mode', arguments: {} }),
    rpcRequest(3, 'tools/call', {
      name: 'profile_load',
      arguments: {
        files: ['01-项目信息.md', '03-代码风格.md', 'config.json', 'config.local.json'],
        contextBinding
      }
    })
  ], projectRoot, { DEVCODEX_AGENT: 'claude-code' })

  const payload = JSON.parse(resultById(responses, 2).content?.[0]?.text || '{}')
  assert.strictEqual(payload.layoutMode, 'workspace-namespace')
  assert.strictEqual(payload.project, 'chat')
  assert.strictEqual(payload.mode, 'dev')
  assert.strictEqual(payload.agent, 'claude-code')
  assert.deepStrictEqual(payload.sourceRoots.map(item => path.basename(path.dirname(item))), ['profile', 'profile'])

  const profileText = resultById(responses, 3).content?.[0]?.text || ''
  assert.match(profileText, /工作区基座（workspace）/)
  assert.match(profileText, /项目命名空间（chat）/)
  assert.match(profileText, /"tags": \[/)
  assert.match(profileText, /connectionString/)
}

function testWorkspaceNamespaceInvalidProfileFailsClosed() {
  setupLayoutWorkspace()
  const projectRoot = path.join(TEMP_ROOT, 'chat')
  const projectConfig = path.join(TEMP_ROOT, '.devcodex', 'chat', 'profile', 'config.json')
  fs.writeFileSync(projectConfig, '{"mode":"dev", broken}\n', 'utf8')
  const responses = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'tools/call', { name: 'profile_get_mode', arguments: {} })
  ], projectRoot, { DEVCODEX_AGENT: 'claude-code' })
  const result = resultById(responses, 1)
  assert.strictEqual(result.isError, true)
  assert.match(result.content?.[0]?.text || '', /PROFILE_CONFIG_INVALID/)
  assert.match(result.content?.[0]?.text || '', /config\.json/)
  assert.doesNotMatch(result.content?.[0]?.text || '', /"mode"\s*:\s*"prod"/)
}

function testProfileLoadWithoutArguments() {
  setupLegacyWorkspace()
  // Governed reads reject missing authorization before any Profile body access.
  const blocked = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'tools/call', { name: 'profile_load' }),
    rpcRequest(3, 'tools/call', { name: 'profile_load', arguments: null }),
    rpcRequest(4, 'tools/call', { name: 'profile_load', arguments: {} })
  ], TEMP_ROOT)
  for (const id of [2, 3, 4]) {
    const result = resultById(blocked, id)
    assert.strictEqual(result.isError, true)
    const text = result.content?.[0]?.text || ''
    assert.match(text, /CONTEXT_BINDING_REQUIRED/)
  }

  const contextBinding = createTestContextBinding(TEMP_ROOT, {
    intent: 'resume',
    explicitFull: true
  })
  const fullArgs = {
    explicitFull: true,
    fullReadReason: 'legacy compatibility fixture requires tier full read',
    maxBytes: 500000,
    contextBinding
  }
  const responses = runServer('mcp/profile-server.js', [
    rpcRequest(5, 'tools/call', { name: 'profile_load', arguments: fullArgs }),
    rpcRequest(6, 'tools/call', { name: 'profile_load', arguments: { ...fullArgs } })
  ], TEMP_ROOT)

  for (const id of [5, 6]) {
    const result = resultById(responses, id)
    assert.notStrictEqual(result.isError, true)
    const text = result.content?.[0]?.text || ''
    assert.match(text, /01-项目信息/)
    assert.match(text, /06-功能清单/)
    assert.match(text, /07-用户文档与契约规范/)
    assert.match(text, /config\.local\.json/)
    assert.doesNotMatch(text, /invoke|TypeError/i)
  }
  assert.deepStrictEqual(
    resultById(responses, 6).content,
    resultById(responses, 5).content,
    'explicitFull profile_load must be stable across identical calls'
  )

  const targeted = runServer('mcp/profile-server.js', [
    rpcRequest(7, 'tools/call', {
      name: 'profile_load',
      arguments: { files: ['01-项目信息.md', '03-代码风格.md'], contextBinding }
    })
  ], TEMP_ROOT)
  const targetedText = resultById(targeted, 7).content?.[0]?.text || ''
  assert.notStrictEqual(resultById(targeted, 7).isError, true)
  assert.match(targetedText, /01-项目信息/)
  assert.match(targetedText, /03-代码风格/)

  fs.rmSync(path.join(TEMP_ROOT, '.devcodex', 'profile', 'config.json'), { force: true })
  const missingConfig = runServer('mcp/profile-server.js', [
    rpcRequest(8, 'tools/call', {
      name: 'profile_load',
      arguments: { files: ['config.json'], contextBinding }
    })
  ], TEMP_ROOT)
  const missingConfigText = resultById(missingConfig, 8).content?.[0]?.text || ''
  assert.notStrictEqual(resultById(missingConfig, 8).isError, true)
  assert.match(missingConfigText, /（文件不存在，跳过）/)
  assert.doesNotMatch(missingConfigText, /### config\.json[\s\S]*?\nnull(?:\n|$)/)
}

function testContextReadBindingContract() {
  setupLegacyWorkspace()
  const planResponses = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'tools/call', {
      name: 'profile_context_plan',
      arguments: {
        intent: 'resume',
        contextEpoch: 'binding-contract-epoch',
        explicitFull: true,
        fullReadReason: 'authorization contract fixture requires the full governed source set.',
        configLocalRequested: true
      }
    })
  ], TEMP_ROOT)
  const plan = toolJson(resultById(planResponses, 1))
  const binding = {
    schemaVersion: 'ContextReadBindingV1',
    contextEpoch: plan.identity.contextEpoch,
    planId: plan.planId,
    planContentId: plan.planContentId,
    activeRoot: plan.identity.activeRoot,
    project: plan.identity.project
  }

  const profileResponses = runServer('mcp/profile-server.js', [
    rpcRequest(2, 'tools/list'),
    rpcRequest(3, 'tools/call', {
      name: 'profile_load',
      arguments: { files: ['01-项目信息.md'], contextBinding: binding }
    }),
    rpcRequest(4, 'tools/call', {
      name: 'profile_load',
      arguments: { files: ['01-项目信息.md'], contextBinding: { ...binding, activeRoot: path.join(TEMP_ROOT, 'other') } }
    }),
    rpcRequest(5, 'tools/call', {
      name: 'profile_skill_plan',
      arguments: { candidateIds: ['intent'], contextBinding: binding }
    }),
    rpcRequest(6, 'tools/call', {
      name: 'profile_load',
      arguments: { files: ['01-项目信息.md'] }
    }),
    rpcRequest(7, 'tools/call', {
      name: 'skill_route',
      arguments: { op: 'catalog' }
    })
  ], TEMP_ROOT)
  const listedResult = resultById(profileResponses, 2)
  const listed = listedResult.tools
  const toolsListBytes = Buffer.byteLength(JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    result: listedResult
  }))
  assert(
    toolsListBytes <= 7680,
    `profile tools/list exceeds Grok local-stdio safety budget: ${toolsListBytes} bytes`
  )
  const skillRouteSchema = findToolSchema(listed, 'skill_route')
  assert.ok(Array.isArray(skillRouteSchema.oneOf), 'skill_route inputSchema must be per-op oneOf')
  assert.strictEqual(
    skillRouteSchema.properties?.contextBinding,
    undefined,
    'skill_route must not expose a top-level contextBinding property'
  )
  for (const op of ['catalog', 'commit', 'rebind', 'load_stage', 'status']) {
    findSkillRouteOpSchema(skillRouteSchema, op)
  }
  assert.strictEqual(
    findSkillRouteOpSchema(skillRouteSchema, 'catalog').properties.contextBinding,
    undefined,
    'catalog must not accept contextBinding'
  )
  assert.strictEqual(
    findSkillRouteOpSchema(skillRouteSchema, 'load_stage').properties.contextBinding,
    undefined,
    'load_stage must not accept contextBinding'
  )
  assert.strictEqual(
    findSkillRouteOpSchema(skillRouteSchema, 'status').properties.contextBinding,
    undefined,
    'status must not accept contextBinding'
  )
  assert.ok(
    findSkillRouteOpSchema(skillRouteSchema, 'commit').required.includes('contextBinding'),
    'commit must require contextBinding'
  )
  assert.ok(
    findSkillRouteOpSchema(skillRouteSchema, 'rebind').required.includes('contextBinding'),
    'rebind must require contextBinding'
  )
  assert.ok(listed.find(tool => tool.name === 'profile_load').inputSchema.properties.contextBinding)
  assert.ok(listed.find(tool => tool.name === 'profile_skill_plan').inputSchema.properties.contextBinding)
  assert(listed.find(tool => tool.name === 'profile_load').inputSchema.required.includes('contextBinding'))
  assert(listed.find(tool => tool.name === 'profile_skill_plan').inputSchema.required.includes('contextBinding'))
  const profileText = resultById(profileResponses, 3).content[0].text
  const profileMeta = JSON.parse(/<!-- profile_load_budget (\{[^\n]+\}) -->/.exec(profileText)[1])
  assert.deepStrictEqual(profileMeta.contextBinding, {
    ...binding,
    activeRoot: plan.identity.activeRoot,
    bindingStatus: 'verified',
    verificationMode: 'request-bound'
  })
  const mismatch = toolJson(resultById(profileResponses, 4))
  assert.strictEqual(resultById(profileResponses, 4).isError, true)
  assert.strictEqual(mismatch.errorCode, 'CONTEXT_BINDING_MISMATCH')
  const skillPlan = toolJson(resultById(profileResponses, 5))
  assert.strictEqual(skillPlan.contextBinding.bindingStatus, 'verified')
  const unboundProfile = toolJson(resultById(profileResponses, 6))
  const routeErrorResult = resultById(profileResponses, 7)
  assert.strictEqual(routeErrorResult.isError, true)
  assert.strictEqual(toolJson(routeErrorResult).ok, false)
  assert.strictEqual(
    routeErrorResult._meta?.devcodexRuntimeProcessIdentity?.schemaVersion,
    'RuntimeProcessIdentityV2'
  )
  assert.strictEqual(
    routeErrorResult._meta.devcodexRuntimeProcessIdentity.role,
    'profile-mcp',
    'skill_route errors must carry the same producer generation handshake as successes'
  )
  assert.strictEqual(resultById(profileResponses, 6).isError, true)
  assert.strictEqual(unboundProfile.errorCode, 'CONTEXT_BINDING_REQUIRED')

  const skillRouteTracePath = path.join(TEMP_ROOT, 'skill-route-call-trace.ndjson')
  runServer('mcp/profile-server.js', [
    rpcRequest(701, 'tools/call', {
      name: 'skill_route',
      arguments: {
        op: 'status',
        diagnosticBody: 'x'.repeat(300 * 1024)
      }
    })
  ], TEMP_ROOT, { DEVCODEX_SKILL_ROUTE_TRACE: skillRouteTracePath })
  const compactedSkillRouteTrace = JSON.parse(fs.readFileSync(skillRouteTracePath, 'utf8').trim())
  assert.strictEqual(compactedSkillRouteTrace.compacted, true)
  assert.strictEqual(typeof compactedSkillRouteTrace.requestDigest, 'string')
  assert.strictEqual(Object.prototype.hasOwnProperty.call(compactedSkillRouteTrace, 'request'), false)
  assert(fs.statSync(skillRouteTracePath).size <= 16 * 1024)
  fs.writeFileSync(skillRouteTracePath, 'x'.repeat((256 * 1024) - 32), 'utf8')
  const traceBytesBeforeCapProbe = fs.statSync(skillRouteTracePath).size
  runServer('mcp/profile-server.js', [
    rpcRequest(702, 'tools/call', {
      name: 'skill_route',
      arguments: { op: 'status' }
    })
  ], TEMP_ROOT, { DEVCODEX_SKILL_ROUTE_TRACE: skillRouteTracePath })
  assert.strictEqual(fs.statSync(skillRouteTracePath).size, traceBytesBeforeCapProbe)
  assert.strictEqual(fs.existsSync(`${skillRouteTracePath}.lock`), false)

  const memoryResponses = runServer('mcp/memory-server.js', [
    rpcRequest(7, 'tools/list'),
    rpcRequest(8, 'tools/call', { name: 'memory_status', arguments: { contextBinding: binding } }),
    rpcRequest(9, 'tools/call', {
      name: 'memory_status',
      arguments: { contextBinding: { ...binding, project: 'wrong-project' } }
    }),
    rpcRequest(10, 'tools/call', { name: 'memory_status', arguments: {} }),
    rpcRequest(11, 'tools/call', {
      name: 'memory_status',
      arguments: { contextBinding: { ...binding, unsupported: true } }
    })
  ], TEMP_ROOT)
  assert.ok(resultById(memoryResponses, 7).tools
    .find(tool => tool.name === 'memory_status').inputSchema.properties.contextBinding)
  assert(resultById(memoryResponses, 7).tools
    .find(tool => tool.name === 'memory_status').inputSchema.required.includes('contextBinding'))
  const boundMemory = toolJson(resultById(memoryResponses, 8))
  assert.strictEqual(boundMemory.contextBinding.bindingStatus, 'verified')
  assert.strictEqual(boundMemory.contextBinding.verificationMode, 'request-bound')
  assertMemoryProjectionIdentity(boundMemory, 'memory_status')
  const memoryMismatch = toolJson(resultById(memoryResponses, 9))
  assert.strictEqual(resultById(memoryResponses, 9).isError, true)
  assert.strictEqual(memoryMismatch.errorCode, 'CONTEXT_BINDING_MISMATCH')
  const unboundMemory = toolJson(resultById(memoryResponses, 10))
  assert.strictEqual(resultById(memoryResponses, 10).isError, true)
  assert.strictEqual(unboundMemory.errorCode, 'CONTEXT_BINDING_REQUIRED')
  const invalidMemory = toolJson(resultById(memoryResponses, 11))
  assert.strictEqual(resultById(memoryResponses, 11).isError, true)
  assert.strictEqual(invalidMemory.errorCode, 'CONTEXT_BINDING_INVALID')
}

function testContextReadAuthorizationNegativePaths() {
  setupLegacyWorkspace()
  const planResponses = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'chat', contextEpoch: 'authorization-negative-epoch' }
    })
  ], TEMP_ROOT)
  const plan = toolJson(resultById(planResponses, 1))
  const binding = plan.contextBinding
  const unselectedSourceId = plan.catalogCoverage.excludedIds.find(sourceId =>
    sourceId.startsWith('profile:') && sourceId.endsWith('.md')
  )
  assert(unselectedSourceId, 'chat plan must leave at least one Profile body unselected')
  const unselectedFile = unselectedSourceId.slice('profile:'.length)
  const forgedBinding = {
    ...binding,
    contextEpoch: 'forged-authorization-epoch',
    planId: `plan-${'1'.repeat(64)}`,
    planContentId: `plan-content-${'2'.repeat(64)}`
  }
  const mismatchedBinding = {
    ...binding,
    planContentId: `plan-content-${'3'.repeat(64)}`
  }
  const traced = runProfileServerWithReadTrace([
    rpcRequest(2, 'tools/call', {
      name: 'profile_load',
      arguments: { files: [unselectedFile] }
    }),
    rpcRequest(3, 'tools/call', {
      name: 'profile_load',
      arguments: { files: [unselectedFile], contextBinding: forgedBinding }
    }),
    rpcRequest(4, 'tools/call', {
      name: 'profile_load',
      arguments: { files: [unselectedFile], contextBinding: mismatchedBinding }
    }),
    rpcRequest(5, 'tools/call', {
      name: 'profile_load',
      arguments: { files: [unselectedFile], contextBinding: binding }
    })
  ], TEMP_ROOT)
  assert.strictEqual(toolJson(resultById(traced.responses, 2)).errorCode, 'CONTEXT_BINDING_REQUIRED')
  assert.strictEqual(toolJson(resultById(traced.responses, 3)).errorCode, 'CONTEXT_BINDING_PLAN_NOT_FOUND')
  assert.strictEqual(toolJson(resultById(traced.responses, 4)).errorCode, 'CONTEXT_BINDING_PLAN_MISMATCH')
  assert.strictEqual(toolJson(resultById(traced.responses, 5)).errorCode, 'CONTEXT_SOURCE_NOT_AUTHORIZED')
  assert.deepStrictEqual(
    profileReadBasenames(traced.reads),
    [],
    'authorization failures must happen before any Profile body is opened'
  )

  const validAuthorization = authorizeContextRead({
    activeRoot: plan.identity.activeRoot,
    project: plan.identity.project,
    contextBinding: binding,
    requestedSources: ['memory:memory_status']
  })
  assert.strictEqual(validAuthorization.status, 'authorized')
  assert.strictEqual(validAuthorization.binding.bindingStatus, 'verified')
  assert.strictEqual(validAuthorization.binding.verificationMode, 'request-bound')
  const expiredAuthorization = authorizeContextRead({
    activeRoot: plan.identity.activeRoot,
    project: plan.identity.project,
    contextBinding: binding,
    requestedSources: ['memory:memory_status']
  }, { nowMs: Date.now() + (25 * 60 * 60 * 1000) })
  assert.strictEqual(expiredAuthorization.status, 'blocked')
  assert.strictEqual(expiredAuthorization.errorCode, 'CONTEXT_BINDING_PLAN_EXPIRED')

  const blockedDailyPath = path.join(
    TEMP_ROOT,
    '.devcodex',
    '.memory',
    'clients',
    'claude-code',
    'tasks',
    '20990101.md'
  )
  writeSparseFile(blockedDailyPath, 9 * 1024 * 1024, 'PLAN-UNSELECTED-MEMORY-BODY-MUST-NOT-BE-READ')
  const memoryResponses = runServer('mcp/memory-server.js', [
    rpcRequest(6, 'tools/call', {
      name: 'memory_session_query',
      arguments: { date: '20990101', contextBinding: binding }
    })
  ], TEMP_ROOT)
  const blockedMemory = toolJson(resultById(memoryResponses, 6))
  assert.strictEqual(resultById(memoryResponses, 6).isError, true)
  assert.strictEqual(blockedMemory.errorCode, 'CONTEXT_SOURCE_NOT_AUTHORIZED')
  assert.doesNotMatch(JSON.stringify(blockedMemory), /PLAN-UNSELECTED-MEMORY-BODY-MUST-NOT-BE-READ/)
}

function testBoundedGovernedSourceReads() {
  setupLegacyWorkspace()
  const directSparse = path.join(TEMP_ROOT, 'direct-sparse-profile.md')
  writeSparseFile(directSparse, 3 * 1024 * 1024, 'DIRECT-SPARSE-SENTINEL')
  let readCalls = 0
  let sourceBytesRead = 0
  const countingFs = Object.create(fs)
  countingFs.readSync = (...args) => {
    readCalls += 1
    const bytesRead = fs.readSync(...args)
    sourceBytesRead += bytesRead
    return bytesRead
  }
  assert.throws(
    () => readBoundedTextFileSync(directSparse, { maxBytes: 2 * 1024 * 1024, fs: countingFs }),
    error => error.code === 'SOURCE_TOO_LARGE' && error.sourceBytesRead === 0
  )
  assert.strictEqual(readCalls, 0, 'oversized sparse source must be rejected from metadata before readSync')
  assert.strictEqual(sourceBytesRead, 0)

  const profilePath = path.join(TEMP_ROOT, '.devcodex', 'profile', '01-项目信息.md')
  writeSparseFile(profilePath, 3 * 1024 * 1024, 'PROFILE-LIMIT-SENTINEL-MUST-NOT-LEAK')
  const profilePlan = toolJson(resultById(runServer('mcp/profile-server.js', [
    rpcRequest(10, 'tools/call', {
      name: 'profile_context_plan',
      arguments: {
        intent: 'resume',
        contextEpoch: 'profile-source-limit-epoch',
        explicitFull: true,
        fullReadReason: 'bounded Profile source fixture'
      }
    })
  ], TEMP_ROOT), 10))
  const profileLoad = resultById(runServer('mcp/profile-server.js', [
    rpcRequest(11, 'tools/call', {
      name: 'profile_load',
      arguments: {
        files: ['01-项目信息.md'],
        maxBytes: 4 * 1024 * 1024,
        contextBinding: profilePlan.contextBinding
      }
    })
  ], TEMP_ROOT), 11)
  const profileError = toolJson(profileLoad)
  assert.strictEqual(profileLoad.isError, true)
  assert.strictEqual(profileError.errorCode, 'SOURCE_TOO_LARGE')
  assert.strictEqual(profileError.sourceBytesRead, 0)
  assert.doesNotMatch(JSON.stringify(profileError), /PROFILE-LIMIT-SENTINEL-MUST-NOT-LEAK/)

  writeSparseFile(
    profilePath,
    3 * 1024 * 1024,
    '# Project\n\n## Runtime\n\nSTREAMED-RUNTIME-SECTION\n\n## Security\n\n'
  )
  const sectionLoad = resultById(runServer('mcp/profile-server.js', [
    rpcRequest(111, 'tools/call', {
      name: 'profile_load',
      arguments: {
        files: ['01-项目信息.md'],
        maxBytes: 64 * 1024,
        executionOptimization: profilePlan.executionOptimization,
        sectionSelectors: [{
          file: '01-项目信息.md',
          headingQueries: ['Runtime'],
          requiredQueries: ['Runtime'],
          maxBytes: 16 * 1024
        }],
        contextBinding: profilePlan.contextBinding
      }
    })
  ], TEMP_ROOT), 111)
  assert.notStrictEqual(sectionLoad.isError, true, sectionLoad.content?.[0]?.text || '')
  const sectionText = sectionLoad.content?.[0]?.text || ''
  assert.match(sectionText, /STREAMED-RUNTIME-SECTION/)
  const sectionBudgetMatch = sectionText.match(/<!-- profile_load_budget (\{[^\n]+\}) -->/)
  assert(sectionBudgetMatch, 'streamed section load must emit a Profile load receipt')
  const sectionBudget = JSON.parse(sectionBudgetMatch[1])
  assert.strictEqual(sectionBudget.completion, 'partial')
  assert(sectionBudget.sourceBytesRead <= (2 * 1024 * 1024) + (16 * 1024))
  assert.strictEqual(sectionBudget.sectionReceipts[0].sourceScanComplete, false)
  assert(sectionBudget.sectionReceipts[0].continuation.byteOffset > 0)
  assert.strictEqual(sectionBudget.sectionReceipts[0].requiredSatisfied, false)

  setupLegacyWorkspace()
  const summaryPath = path.join(TEMP_ROOT, '.devcodex', '.memory', 'clients', 'claude-code', 'SUMMARY.md')
  writeSparseFile(summaryPath, 9 * 1024 * 1024, 'MEMORY-LIMIT-SENTINEL-MUST-NOT-LEAK')
  const memoryPlan = toolJson(resultById(runServer('mcp/profile-server.js', [
    rpcRequest(12, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'chat', contextEpoch: 'memory-source-limit-epoch' }
    })
  ], TEMP_ROOT), 12))
  const memoryStatus = resultById(runServer('mcp/memory-server.js', [
    rpcRequest(13, 'tools/call', {
      name: 'memory_status',
      arguments: { contextBinding: memoryPlan.contextBinding }
    })
  ], TEMP_ROOT), 13)
  const boundedMemory = toolJson(memoryStatus)
  assert.notStrictEqual(memoryStatus.isError, true, memoryStatus.content?.[0]?.text || '')
  assert.strictEqual(boundedMemory.fallbackCoverage.status, 'partial')
  assert.strictEqual(boundedMemory.summary.sourceScanComplete, false)
  assert(boundedMemory.summary.continuation.byteOffset >= 0)
  assert(boundedMemory.telemetry.sourceBytesRead <= 8 * 1024 * 1024)
  assert.doesNotMatch(JSON.stringify(boundedMemory), /MEMORY-LIMIT-SENTINEL-MUST-NOT-LEAK/)
}

function testDevCodexBoundedRouteRecipe() {
  const { projectRoot, projectProfile } = setupDevCodexRouteRecipeWorkspace()
  const planned = runProfileServerWithReadTrace([
    rpcRequest(80, 'tools/call', {
      name: 'profile_context_plan',
      arguments: {
        intent: 'dev',
        changeTypes: ['source-code', 'testing', 'docs'],
        project: 'devcodex',
        contextEpoch: 'devcodex-bounded-route-recipe'
      }
    })
  ], projectRoot)
  const plan = toolJson(resultById(planned.responses, 80))
  const recipe = plan.profile.routeLoadRecipe
  assert(recipe, 'devcodex source-code plan must provide a bounded route recipe')
  assert.strictEqual(recipe.schemaVersion, 'ProfileRouteLoadRecipeV2')
  assert.strictEqual(recipe.strategy, 'bounded-section-selectors')
  assert(recipe.maxBytes >= 40 * 1024)
  assert(recipe.entries.every(entry => entry.boundedOnly === true))
  assert(recipe.minimumHeadroomBytes >= 1024)
  assert(recipe.minimumHeadroomBytes < recipe.maxBytes)
  assert.strictEqual(Object.prototype.hasOwnProperty.call(recipe, 'totalSelectedBytes'), false)
  assert(recipe.entries.every(entry =>
    Object.prototype.hasOwnProperty.call(entry, 'selectedBytes') === false
  ))
  assert.deepStrictEqual(
    recipe.entries.map(entry => entry.file).sort(),
    plan.profile.selectedFiles.slice().sort()
  )
  assert.deepStrictEqual(
    [...new Set(profileReadBasenames(planned.reads))].sort(),
    ['README.md', 'config.json'],
    'the plan-owned recipe must be derived without reading Profile bodies'
  )
  const binding = {
    schemaVersion: 'ContextReadBindingV1',
    contextEpoch: plan.identity.contextEpoch,
    planId: plan.planId,
    planContentId: plan.planContentId,
    activeRoot: plan.identity.activeRoot,
    project: plan.identity.project
  }
  const routeEntry = recipe.entries[0]
  const unauthorizedSection = authorizeContextRead({
    activeRoot: plan.identity.activeRoot,
    project: plan.identity.project,
    contextBinding: binding,
    requestedSources: [`profile:${routeEntry.file}`],
    requestedSections: [{
      sourceId: `profile:${routeEntry.file}`,
      headingQueries: ['__SECTION_OUTSIDE_PLAN_RECIPE__'],
      requireRouteRecipe: true
    }]
  })
  assert.strictEqual(unauthorizedSection.status, 'blocked')
  assert.strictEqual(unauthorizedSection.errorCode, 'CONTEXT_SECTION_NOT_AUTHORIZED')
  const loaded = runServer('mcp/profile-server.js', [
    rpcRequest(81, 'tools/call', {
      name: 'profile_load',
      arguments: {
        project: 'devcodex',
        contextBinding: binding,
        executionOptimization: plan.executionOptimization
      }
    })
  ], projectRoot, { DEVCODEX_AGENT: 'codex' })
  const loadedResult = resultById(loaded, 81)
  assert.notStrictEqual(loadedResult.isError, true, loadedResult.content?.[0]?.text || '')
  const loadedText = loadedResult.content?.[0]?.text || ''
  assert.match(loadedText, /完整开发需求验证链速查/)
  assert.match(loadedText, /控制面内容契约/)
  const receipt = JSON.parse(/<!-- profile_load_budget (\{[^\n]+\}) -->/.exec(loadedText)[1])
  assert.strictEqual(receipt.completion, 'complete')
  assert.strictEqual(receipt.routeLoadRecipe.applied, true)
  assert.strictEqual(receipt.routeLoadRecipe.recipeDigest, recipe.recipeDigest)
  assert.deepStrictEqual(receipt.loadedFiles.slice().sort(), plan.profile.selectedFiles.slice().sort())

  const oversizedFile = recipe.entries[0]
  fs.appendFileSync(
    path.join(projectProfile, oversizedFile.file),
    `\n${'x'.repeat(256)}\n`,
    'utf8'
  )
  const grown = runServer('mcp/profile-server.js', [
    rpcRequest(82, 'tools/call', {
      name: 'profile_load',
      arguments: {
        project: 'devcodex',
        contextBinding: binding,
        executionOptimization: plan.executionOptimization
      }
    })
  ], projectRoot, { DEVCODEX_AGENT: 'codex' })
  assert.notStrictEqual(
    resultById(grown, 82).isError,
    true,
    'small Profile growth must consume recipe headroom without requiring an identical replan'
  )

  fs.appendFileSync(
    path.join(projectProfile, oversizedFile.file),
    `\n${'x'.repeat(oversizedFile.maxBytes + 1024)}\n`,
    'utf8'
  )
  const exceeded = runServer('mcp/profile-server.js', [
    rpcRequest(83, 'tools/call', {
      name: 'profile_load',
      arguments: {
        project: 'devcodex',
        contextBinding: binding,
        executionOptimization: plan.executionOptimization
      }
    })
  ], projectRoot, { DEVCODEX_AGENT: 'codex' })
  assert.strictEqual(resultById(exceeded, 83).isError, true)
  const exceededError = toolJson(resultById(exceeded, 83))
  assert.strictEqual(exceededError.errorCode, 'PROFILE_ROUTE_RECIPE_BUDGET_EXCEEDED')
  assert.doesNotMatch(exceededError.nextStep, /Regenerate profile_context_plan/i)
  assert.strictEqual(exceededError.sectionReceipt.completion, 'partial')
  assert.notStrictEqual(exceededError.sectionReceipt.completion, 'fallback-full')
  assert.strictEqual(exceededError.recoveryRecipe.schemaVersion, 'ProfileSectionRecoveryRecipeV1')
  assert(exceededError.recoveryRecipe.calls.length >= 2)
  assert(exceededError.recoveryRecipe.calls.every(call => call.arguments.files.length === 1 &&
    call.arguments.sectionSelectors[0].headingQueries.length === 1 &&
    call.arguments.sectionSelectors[0].boundedOnly === true))
  assert.deepStrictEqual(
    exceededError.recoveryRecipe.calls.map(call => call.sourceOrder),
    exceededError.recoveryRecipe.calls.map((_, index) => index),
    'bounded recovery calls must expose a deterministic source-document order'
  )
}

function testProfileMultiHeadingBoundedSelection() {
  const file = 'multi-heading.md'
  const filePath = path.join(TEMP_ROOT, file)
  fs.writeFileSync(filePath, [
    '# Profile',
    '',
    'UNRELATED-PREAMBLE',
    '',
    '## Alpha',
    '',
    'ALPHA-BODY',
    '',
    '### Alpha Child',
    '',
    'ALPHA-CHILD-BODY',
    '',
    '## Middle',
    '',
    'MIDDLE-BODY',
    '',
    '## Unrelated',
    '',
    'UNRELATED-BODY-' + 'x'.repeat(60 * 1024),
    '',
    '## Omega',
    '',
    'OMEGA-BODY',
    ''
  ].join('\n'))
  const selector = {
    headingQueries: ['Omega', 'Alpha Child', 'Alpha', 'Middle', 'Alpha'],
    requiredQueries: ['Alpha', 'Middle', 'Omega'],
    includePreamble: false,
    includeDescendants: true,
    maxBytes: 4096,
    boundedOnly: true
  }
  const selected = selectProfileSectionsFromFileSync({
    file,
    filePath,
    selector,
    maxScanBytes: 128 * 1024,
    maxTotalSourceBytes: 256 * 1024
  })
  assert.strictEqual(selected.receipt.completion, 'complete')
  assert(selected.body.indexOf('ALPHA-BODY') < selected.body.indexOf('MIDDLE-BODY'))
  assert(selected.body.indexOf('MIDDLE-BODY') < selected.body.indexOf('OMEGA-BODY'))
  assert.strictEqual((selected.body.match(/ALPHA-CHILD-BODY/g) || []).length, 1,
    'parent/descendant and repeated queries must be de-duplicated')
  assert.doesNotMatch(selected.body, /UNRELATED-BODY/)
  const segmented = ['Alpha', 'Middle', 'Omega'].map(query => selectProfileSectionsFromFileSync({
    file,
    filePath,
    selector: {
      headingQueries: [query],
      requiredQueries: [query],
      includePreamble: false,
      includeDescendants: true,
      maxBytes: 4096,
      boundedOnly: true
    },
    maxScanBytes: 128 * 1024,
    maxTotalSourceBytes: 256 * 1024
  }).body).join('\n\n')
  assert.strictEqual(segmented, selected.body,
    'automatic multi-heading selection must be identity-equivalent to source-ordered segmented reads')

  const bounded = selectProfileSectionsFromFileSync({
    file,
    filePath,
    selector: { ...selector, maxBytes: 32 },
    maxScanBytes: 128 * 1024,
    maxTotalSourceBytes: 256 * 1024
  })
  assert.strictEqual(bounded.receipt.completion, 'partial')
  assert.strictEqual(bounded.receipt.boundedOnly, true)
  assert.notStrictEqual(bounded.receipt.completion, 'fallback-full')
  assert(bounded.receipt.selectedBytes <= 32)
  assert.doesNotMatch(bounded.body, /UNRELATED-BODY/)
  assert(bounded.receipt.deferredSections.some(item => item.required))
}

function testProfileSectionSelectorsAndSkillPlan() {
  setupLegacyWorkspace()
  const safePlanResponses = runServer('mcp/profile-server.js', [
    rpcRequest(70, 'tools/call', {
      name: 'profile_context_plan',
      arguments: {
        intent: 'resume',
        contextEpoch: 'safe-optimization-binding',
        explicitFull: true,
        fullReadReason: 'section selector authorization fixture',
        configLocalRequested: true
      }
    })
  ], TEMP_ROOT)
  const safePlan = toolJson(resultById(safePlanResponses, 70))
  const safeOptimization = safePlan.executionOptimization
  const contextBinding = safePlan.contextBinding
  assert.strictEqual(safeOptimization.mode, 'safe-auto')
  fs.writeFileSync(path.join(TEMP_ROOT, '.devcodex', 'profile', '01-项目信息.md'), [
    'Profile preamble.',
    '',
    '# Project',
    '',
    'Project facts.',
    '',
    '## Runtime',
    '',
    'Runtime facts.',
    '',
    '## Security',
    '',
    'Security facts.',
    '',
    '## Large Appendix',
    '',
    'x'.repeat(5000),
    ''
  ].join('\n'))
  const requests = [
    rpcRequest(1, 'tools/call', {
      name: 'profile_load',
      arguments: {
        files: ['01-项目信息.md'],
        maxBytes: 20000,
        executionOptimization: safeOptimization,
        sectionSelectors: [{
          file: '01-项目信息.md',
          headingQueries: ['Runtime'],
          requiredQueries: ['Runtime'],
          maxBytes: 4096
        }]
      }
    }),
    rpcRequest(2, 'tools/call', {
      name: 'profile_load',
      arguments: {
        files: ['01-项目信息.md'],
        maxBytes: 20000,
        executionOptimization: safeOptimization,
        sectionSelectors: [{
          file: '01-项目信息.md',
          headingQueries: ['Missing'],
          requiredQueries: ['Missing'],
          maxBytes: 4096
        }]
      }
    }),
    rpcRequest(3, 'tools/call', {
      name: 'profile_load',
      arguments: {
        files: ['01-项目信息.md'],
        maxBytes: 4096,
        executionOptimization: safeOptimization,
        sectionSelectors: [{
          file: '01-项目信息.md',
          headingQueries: ['Runtime', 'Large Appendix'],
          requiredQueries: ['Runtime'],
          maxBytes: 1024
        }]
      }
    }),
    rpcRequest(4, 'tools/call', {
      name: 'profile_load',
      arguments: {
        files: ['02-架构约束.md'],
        executionOptimization: safeOptimization,
        sectionSelectors: [{ file: '01-项目信息.md', headingQueries: ['Runtime'] }]
      }
    }),
    rpcRequest(5, 'tools/call', {
      name: 'profile_skill_plan',
      arguments: { candidateIds: ['dev-testing'], maxBytes: 1000000, executionOptimization: safeOptimization }
    }),
    rpcRequest(6, 'tools/call', {
      name: 'profile_skill_plan',
      arguments: { candidateIds: ['brand-visual-quality'], executionOptimization: safeOptimization }
    }),
    rpcRequest(7, 'tools/call', {
      name: 'profile_skill_plan',
      arguments: { candidateIds: ['intent'], hostCapability: 'unsupported', executionOptimization: safeOptimization }
    })
  ]
  const responses = runServer(
    'mcp/profile-server.js',
    bindGovernedContextReads(requests, contextBinding),
    TEMP_ROOT
  )
  const loadMeta = result => {
    const text = result.content?.[0]?.text || ''
    const match = text.match(/<!-- profile_load_budget (\{[^\n]+\}) -->/)
    assert(match, 'missing profile_load_budget receipt')
    return { text, meta: JSON.parse(match[1]) }
  }

  const exact = loadMeta(resultById(responses, 1))
  assert.match(exact.text, /Runtime facts/)
  assert.doesNotMatch(exact.text, /Security facts/)
  assert.strictEqual(exact.meta.schemaVersion, 'ProfileLoadReceiptV3')
  assert.strictEqual(exact.meta.sectionReceipts[0].schemaVersion, 'ProfileSectionLoadReceiptV1')
  assert.strictEqual(exact.meta.sectionReceipts[0].completion, 'complete')
  assert.strictEqual(exact.meta.sectionReceipts[0].requiredSatisfied, true)

  const fallback = loadMeta(resultById(responses, 2))
  assert.match(fallback.text, /Project facts/)
  assert.match(fallback.text, /Security facts/)
  assert.strictEqual(fallback.meta.sectionReceipts[0].completion, 'fallback-full')
  assert.strictEqual(fallback.meta.sectionReceipts[0].fallbackReason, 'required-query-missing-or-ambiguous')

  const partial = loadMeta(resultById(responses, 3))
  assert.match(partial.text, /Runtime facts/)
  assert.doesNotMatch(partial.text, /x{128}/)
  assert.doesNotMatch(partial.text, /truncated by maxBytes/)
  assert.strictEqual(partial.meta.completion, 'partial')
  assert(partial.meta.sectionReceipts[0].deferredSections.some(item => item.query === 'Large Appendix'))

  const invalid = resultById(responses, 4)
  assert.strictEqual(invalid.isError, true)

  const configPath = path.join(TEMP_ROOT, '.devcodex', 'profile', 'config.json')
  const fullOnlyConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  fullOnlyConfig.extensions = { devcodex: { executionOptimization: { mode: 'full-only' } } }
  fs.writeFileSync(configPath, JSON.stringify(fullOnlyConfig, null, 2) + '\n')
  const fullOnlyPlanResponses = runServer('mcp/profile-server.js', [
    rpcRequest(80, 'tools/call', {
      name: 'profile_context_plan',
      arguments: {
        intent: 'resume',
        contextEpoch: 'full-only-binding',
        explicitFull: true,
        fullReadReason: 'full-only optimization authorization fixture',
        configLocalRequested: true
      }
    })
  ], TEMP_ROOT)
  const fullOnlyPlan = toolJson(resultById(fullOnlyPlanResponses, 80))
  const fullOnlyOptimization = fullOnlyPlan.executionOptimization
  assert.strictEqual(fullOnlyOptimization.mode, 'full-only')
  const fullOnlyResponses = runServer('mcp/profile-server.js', bindGovernedContextReads([
    rpcRequest(8, 'tools/call', {
      name: 'profile_load',
      arguments: {
        files: ['01-项目信息.md'],
        maxBytes: 20000,
        executionOptimization: fullOnlyOptimization,
        sectionSelectors: [{ file: '01-项目信息.md', headingQueries: ['Runtime'], requiredQueries: ['Runtime'] }]
      }
    }),
    rpcRequest(9, 'tools/call', {
      name: 'profile_skill_plan',
      arguments: { candidateIds: ['intent'], executionOptimization: fullOnlyOptimization }
    })
  ], fullOnlyPlan.contextBinding), TEMP_ROOT)
  const fullOnlyLoad = loadMeta(resultById(fullOnlyResponses, 8))
  assert.strictEqual(fullOnlyLoad.meta.executionOptimizationMode, 'full-only')
  assert.strictEqual(fullOnlyLoad.meta.optimizationFallback, 'full-profile-file')
  assert.strictEqual(fullOnlyLoad.meta.sectionReceipts.length, 0)
  assert.match(fullOnlyLoad.text, /Security facts/)
  const fullOnlySkill = JSON.parse(resultById(fullOnlyResponses, 9).content[0].text)
  assert.strictEqual(fullOnlySkill.completion, 'fallback-full')
  assert.strictEqual(fullOnlySkill.fallback.route, 'full-skill-read')
  assert.strictEqual(fullOnlySkill.budgetDecision.schemaVersion, 'BudgetDecisionV1')
  assert.strictEqual(fullOnlySkill.budgetDecision.enforcementStatus, 'fallback-full')
  assert.strictEqual(fullOnlySkill.budgetDecision.optimizedHit, false)
  assert.match(invalid.content[0].text, /PROFILE_SECTION_FILE_NOT_SELECTED/)

  const bundle = toolJson(resultById(responses, 5))
  assert.strictEqual(bundle.schemaVersion, 'BundleDecisionV2')
  assert.strictEqual(bundle.completion, 'complete')
  assert.strictEqual(bundle.budgetDecision.schemaVersion, 'BudgetDecisionV1')
  assert.strictEqual(bundle.budgetDecision.enforcementStatus, 'enforced')
  assert.strictEqual(bundle.budgetDecision.optimizedHit, true)
  assert.deepStrictEqual(new Set(bundle.selected.map(item => item.id)),
    new Set(['api-verification', 'dev-scenario-test', 'dev-testing']))
  const inactive = toolJson(resultById(responses, 6))
  assert.strictEqual(inactive.completion, 'blocked')
  assert(inactive.blockers.some(item => item.code === 'inactive'))
  const hostFallback = toolJson(resultById(responses, 7))
  assert.strictEqual(hostFallback.completion, 'fallback-full')
  assert.strictEqual(hostFallback.fallback.route, 'full-skill-read')
  assert.strictEqual(hostFallback.budgetDecision.enforcementStatus, 'fallback-full')
  assert.strictEqual(hostFallback.budgetDecision.optimizedHit, false)

  delete fullOnlyConfig.extensions
  fs.writeFileSync(configPath, JSON.stringify(fullOnlyConfig, null, 2) + '\n')
  const lifecycleState = createOptimizationState({
    featureStates: {
      'context-computation-reuse': 'rolled-back',
      'profile-section-load': 'rolled-back',
      'skill-bundle': 'rolled-back'
    }
  })
  assert.strictEqual(persistOptimizationState(path.join(TEMP_ROOT, '.devcodex'), lifecycleState).status, 'persisted')
  const lifecycleResponses = runServer('mcp/profile-server.js', [
    rpcRequest(90, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'chat', contextEpoch: 'feature-lifecycle-rollback' }
    }),
    rpcRequest(91, 'tools/call', {
      name: 'profile_load',
      arguments: {
        files: ['01-项目信息.md'],
        maxBytes: 20000,
        executionOptimization: safeOptimization,
        contextBinding,
        sectionSelectors: [{ file: '01-项目信息.md', headingQueries: ['Runtime'], requiredQueries: ['Runtime'] }]
      }
    }),
    rpcRequest(92, 'tools/call', {
      name: 'profile_skill_plan',
      arguments: { candidateIds: ['intent'], executionOptimization: safeOptimization, contextBinding }
    })
  ], TEMP_ROOT)
  const lifecyclePlan = toolJson(resultById(lifecycleResponses, 90))
  assert.strictEqual(lifecyclePlan.cacheDecision.status, 'bypassed')
  assert.strictEqual(lifecyclePlan.cacheDecision.reasonCode, 'feature-rolled-back')
  const lifecycleLoad = loadMeta(resultById(lifecycleResponses, 91))
  assert.strictEqual(lifecycleLoad.meta.executionOptimizationFeature.lifecycleState, 'rolled-back')
  assert.strictEqual(lifecycleLoad.meta.optimizationFallback, 'full-profile-file')
  assert.strictEqual(lifecycleLoad.meta.sectionReceipts.length, 0)
  const lifecycleSkill = toolJson(resultById(lifecycleResponses, 92))
  assert.strictEqual(lifecycleSkill.completion, 'fallback-full')
  assert.strictEqual(lifecycleSkill.executionOptimization.lifecycleState, 'rolled-back')
  assert.strictEqual(lifecycleSkill.executionOptimization.reasonCode, 'feature-rolled-back')
}

function testProfileContextPlanContract() {
  setupContextPlanWorkspace()
  const projectRoot = path.join(TEMP_ROOT, 'chat')
  const responses = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'tools/list'),
    rpcRequest(2, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'chat' }
    }),
    rpcRequest(3, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'dev', project: 'chat', contextEpoch: 'epoch-missing-change-types' }
    }),
    rpcRequest(4, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'dev', changeTypes: ['source-code'], project: 'chat', contextEpoch: 'epoch-dev-plan' }
    }),
    rpcRequest(5, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'dev', changeTypes: ['source-code'], project: 'chat', contextEpoch: 'epoch-dev-plan' }
    }),
    rpcRequest(6, 'tools/call', {
      name: 'profile_context_plan',
      arguments: {
        intent: 'audit',
        changeTypes: ['testing'],
        project: 'chat',
        contextEpoch: 'epoch-explicit-plan',
        explicitSkillId: 'audit-project'
      }
    })
  ], projectRoot)

  const tools = resultById(responses, 1).tools
  const planTool = tools.find(tool => tool.name === 'profile_context_plan')
  assert(planTool)
  assert.deepStrictEqual(planTool.inputSchema.required, ['intent'])
  assert.deepStrictEqual(planTool.inputSchema.properties.intent.enum, CONTEXT_READ_CONTRACT.intents)
  assert.deepStrictEqual(planTool.inputSchema.properties.explicitSkillId, { type: 'string', minLength: 1 })
  assert.deepStrictEqual(planTool.inputSchema.properties.routeKey, { type: 'string', minLength: 1, maxLength: 128 })
  assert.deepStrictEqual(planTool.inputSchema.properties.subtype, { type: 'string', minLength: 1, maxLength: 128 })
  assert.deepStrictEqual(planTool.inputSchema.properties.stage, { type: 'string', minLength: 1, maxLength: 64 })
  assert(tools.some(tool => tool.name === 'profile_load'))
  assert(tools.some(tool => tool.name === 'profile_skill_plan'))
  assert(tools.some(tool => tool.name === 'profile_get_mode'))

  const chatResult = resultById(responses, 2)
  assert.notStrictEqual(chatResult.isError, true)
  assert.strictEqual(
    chatResult._meta?.devcodexRuntimeProcessIdentity?.schemaVersion,
    'RuntimeProcessIdentityV2'
  )
  assert.strictEqual(
    chatResult._meta.devcodexRuntimeProcessIdentity.role,
    'profile-mcp'
  )
  assert.match(
    chatResult._meta.devcodexRuntimeProcessIdentity.bootRuntimeContractDigest,
    /^[a-f0-9]{64}$/
  )
  const chatPlan = toolJson(chatResult)
  const chatValidation = validateContextReadPlan(chatPlan)
  assert.strictEqual(chatValidation.valid, true,
    `${chatValidation.errors.join(' | ')} cache=${JSON.stringify(chatPlan.cacheDecision)}`)
  assert.match(chatPlan.identity.contextEpoch, /^ctx-/)
  assert.strictEqual(chatPlan.identity.project, 'chat')
  assert.strictEqual(chatPlan.baselineContext.readme.content.includes('PROJECT-README-LOSSLESS-SENTINEL'), true)
  assert.strictEqual(chatPlan.baselineContext.readme.content.includes('WORKSPACE-README-CATALOG-SENTINEL'), false)
  assert.deepStrictEqual(
    chatPlan.baselineContext.readme.sourceRefs.map(ref => ref.layer).sort(),
    ['project:chat', 'workspace'],
    'lossless effective README content must retain every catalog-contributing source reference'
  )
  assert.strictEqual(chatPlan.baselineContext.effectiveConfig.flags.read, true)
  assert.strictEqual(chatPlan.baselineContext.effectiveConfig.flags.write, true)
  assert.deepStrictEqual(chatPlan.baselineContext.effectiveConfig.tags, ['project'])
  assert.strictEqual(chatPlan.baselineContext.effectiveConfig.extensions.devcodex.workflowCompletion.mode, 'shadow')
  assert.strictEqual(chatPlan.baselineContext.effectiveConfig.extensions.devcodex.git.collaborationMode, 'solo')
  assert.strictEqual(chatPlan.baselineContext.effectiveConfig.extensions.devcodex.git.branchPolicy, 'keep-current')
  assert.strictEqual(chatPlan.baselineContext.effectiveConfig.extensions.devcodex.git.worktreePolicy, 'explicit-only')
  assert.strictEqual(chatPlan.baselineContext.effectiveConfig.extensions.devcodex.git.crossBranchIntegration, 'unverified')
  assert.strictEqual(chatPlan.baselineContext.effectiveConfig.extensions.devcodex.git.sharedActionsRequireExplicitAuthorization, true)
  assert(chatPlan.baselineContext.catalog.some(item => item.file === '08-服务约束.md'))
  assert(chatPlan.baselineContext.catalog.some(item => item.file === '09-项目扩展.md'))
  assert.strictEqual(chatPlan.catalogCoverage.unclassifiedIds.length, 0)
  const candidateIds = new Set(chatPlan.baselineContext.inventory.map(item => `profile:${item.file}`))
  const coverageIds = new Set([
    ...chatPlan.catalogCoverage.selectedIds,
    ...chatPlan.catalogCoverage.excludedIds,
    ...chatPlan.catalogCoverage.unclassifiedIds
  ])
  assert.deepStrictEqual([...coverageIds].sort(), [...candidateIds].sort(), 'every bounded Profile candidate needs one coverage class')

  const missingChangeResult = resultById(responses, 3)
  assert.strictEqual(missingChangeResult.isError, true)
  assert.strictEqual(toolJson(missingChangeResult).errorCode, 'CONTEXT_CHANGE_TYPES_REQUIRED')

  const devPlan = toolJson(resultById(responses, 4))
  const repeatedDevPlan = toolJson(resultById(responses, 5))
  const devBootstrapResult = resultById(responses, 4)
  const repeatedBootstrapResult = resultById(responses, 5)
  const devBootstrapText = devBootstrapResult.content?.[1]?.text || ''
  assert.match(devBootstrapText, /^### DevCodex · SkillRouteBootstrapV1/m)
  const devBootstrap = JSON.parse(devBootstrapText.split(/\r?\n/)[1])
  const routeSuccessResponses = runServer('mcp/profile-server.js', [
    rpcRequest(20, 'tools/call', {
      name: 'skill_route',
      arguments: {
        op: 'catalog',
        project: 'chat',
        turnBinding: devBootstrap.turnBinding,
        contextEpoch: devBootstrap.contextEpoch
      }
    })
  ], projectRoot)
  const routeSuccess = resultById(routeSuccessResponses, 20)
  assert.notStrictEqual(routeSuccess.isError, true)
  assert.strictEqual(toolJson(routeSuccess).ok, true)
  assert.strictEqual(
    routeSuccess._meta?.devcodexRuntimeProcessIdentity?.schemaVersion,
    'RuntimeProcessIdentityV2'
  )
  assert.strictEqual(
    routeSuccess._meta.devcodexRuntimeProcessIdentity.role,
    'profile-mcp',
    'skill_route successes must carry the producer generation handshake'
  )
  const expectedTurnBinding = deriveTurnBinding(
    'chat',
    path.join(TEMP_ROOT, '.devcodex', 'chat'),
    'epoch-dev-plan'
  )
  assert.strictEqual(devBootstrap.turnBinding, expectedTurnBinding)
  assert.strictEqual(
    devBootstrapResult._meta?.devcodexSkillRouteBootstrap?.source,
    'profile-context-plan-fallback'
  )
  assert.strictEqual(devBootstrapResult._meta.devcodexSkillRouteBootstrap.status, 'ready')
  assert.strictEqual(
    repeatedBootstrapResult._meta?.devcodexSkillRouteBootstrap?.source,
    'existing-route-envelope'
  )
  assert.strictEqual(
    repeatedBootstrapResult._meta.devcodexSkillRouteBootstrap.turnBinding,
    expectedTurnBinding
  )
  assert.strictEqual(
    repeatedBootstrapResult._meta.devcodexSkillRouteBootstrap.bootstrapDigest,
    devBootstrap.bootstrapDigest
  )
  assert.strictEqual(
    loadEnvelope(path.join(TEMP_ROOT, '.devcodex', 'chat'), expectedTurnBinding).envelope.state.bootstrap.turnBinding,
    expectedTurnBinding
  )
  assert.strictEqual(validateContextReadPlan(devPlan).valid, true)
  assert.strictEqual(devPlan.workflowRoute.routeKey, 'dev.default')
  assert.strictEqual(devPlan.workflowRoute.topIntent, 'dev')
  assert.strictEqual(devPlan.workflowRoute.routeRevision, workflowRouteRegistryV2.routeRevision)
  assert.strictEqual(devPlan.workflowRoute.routeRegistryDigest, workflowRouteRegistryV2.registryDigest)
  assert.deepStrictEqual(devPlan.profile.selectedFiles, ['01-项目信息.md', '02-架构约束.md', '03-代码风格.md'])
  assert.strictEqual(devPlan.planContentId, repeatedDevPlan.planContentId,
    'same content must keep a stable planContentId')
  assert.notStrictEqual(devPlan.planId, repeatedDevPlan.planId,
    'same epoch still requires an invocation-isolated planId')
  assert.strictEqual(devPlan.cacheDecision.status, 'miss')
  assert.strictEqual(repeatedDevPlan.cacheDecision.status, 'hit')
  assert.strictEqual(repeatedDevPlan.cacheDecision.bodyDeliverySkipped, false)

  const changeTypesForRoute = route => {
    if (['chat', 'resume'].includes(route.topIntent)) return []
    if (['audit', 'analyze', 'other'].includes(route.topIntent)) return ['project-info']
    return ['source-code']
  }
  const routeBaseId = 1000
  const routeResponses = runServer('mcp/profile-server.js', [
    ...workflowRouteRegistryV2.routes.map((route, index) => rpcRequest(routeBaseId + index, 'tools/call', {
      name: 'profile_context_plan',
      arguments: {
        intent: route.topIntent,
        changeTypes: changeTypesForRoute(route),
        project: 'chat',
        contextEpoch: `epoch-public-route-${index}`,
        routeKey: route.routeKey,
        subtype: route.subtype,
        stage: route.stage
      }
    })),
    rpcRequest(1100, 'tools/call', {
      name: 'profile_context_plan',
      arguments: {
        intent: 'dev', changeTypes: ['source-code'], project: 'chat', contextEpoch: 'epoch-partial-route',
        routeKey: 'dev.default'
      }
    }),
    rpcRequest(1101, 'tools/call', {
      name: 'profile_context_plan',
      arguments: {
        intent: 'audit', changeTypes: ['project-info'], project: 'chat', contextEpoch: 'epoch-route-intent-mismatch',
        routeKey: 'dev.default', subtype: 'default', stage: 'entry'
      }
    }),
    rpcRequest(1102, 'tools/call', {
      name: 'profile_context_plan',
      arguments: {
        intent: 'dev', changeTypes: ['source-code'], project: 'chat', contextEpoch: 'epoch-route-subtype-mismatch',
        routeKey: 'dev.default', subtype: 'docs', stage: 'entry'
      }
    }),
    rpcRequest(1103, 'tools/call', {
      name: 'profile_context_plan',
      arguments: {
        intent: 'dev', changeTypes: ['source-code'], project: 'chat', contextEpoch: 'epoch-route-stage-mismatch',
        routeKey: 'dev.default', subtype: 'default', stage: 'internal-step'
      }
    })
  ], projectRoot)
  const publicRoutePlans = new Map()
  for (const [index, route] of workflowRouteRegistryV2.routes.entries()) {
    const result = resultById(routeResponses, routeBaseId + index)
    assert.notStrictEqual(result.isError, true, `${route.routeKey} must be reachable through profile_context_plan JSON-RPC`)
    const plan = toolJson(result)
    const validation = validateContextReadPlan(plan)
    assert.strictEqual(validation.valid, true, `${route.routeKey}: ${validation.errors.join(' | ')}`)
    assert.strictEqual(plan.workflowRoute.routeKey, route.routeKey)
    assert.strictEqual(plan.workflowRoute.topIntent, route.topIntent)
    assert.strictEqual(plan.workflowRoute.subtype, route.subtype)
    assert.strictEqual(plan.workflowRoute.stage, route.stage)
    assert.strictEqual(plan.workflowRoute.routeRevision, workflowRouteRegistryV2.routeRevision)
    assert.strictEqual(plan.workflowRoute.routeRegistryDigest, workflowRouteRegistryV2.registryDigest)
    publicRoutePlans.set(route.routeKey, plan)
  }
  assert.strictEqual(publicRoutePlans.size, 24)
  assert.notStrictEqual(
    publicRoutePlans.get('dev.default').planContentId,
    publicRoutePlans.get('dev.refactor').planContentId,
    'route identity must partition profile_context_plan computation identity'
  )
  for (const id of [1100, 1101, 1102, 1103]) {
    const result = resultById(routeResponses, id)
    assert.strictEqual(result.isError, true)
    assert.strictEqual(toolJson(result).errorCode, 'WORKFLOW_ROUTE_UNRESOLVED')
  }
  const explicitBootstrapResult = resultById(responses, 6)
  const explicitBootstrapText = explicitBootstrapResult.content?.[1]?.text || ''
  assert.match(explicitBootstrapText, /^### DevCodex · SkillRouteBootstrapV1/m)
  const explicitBootstrap = JSON.parse(explicitBootstrapText.split(/\r?\n/)[1])
  assert.strictEqual(explicitBootstrap.explicitStatus, 'ready')
  assert.strictEqual(explicitBootstrap.explicitSkillId, 'audit-project')
  assert.strictEqual(
    explicitBootstrapResult._meta?.devcodexSkillRouteBootstrap?.turnBinding,
    explicitBootstrap.turnBinding
  )
  const crossProcessResponse = runServer('mcp/profile-server.js', [
    rpcRequest(7, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'dev', changeTypes: ['source-code'], project: 'chat', contextEpoch: 'epoch-dev-plan' }
    })
  ], projectRoot)
  const crossProcessPlan = toolJson(resultById(crossProcessResponse, 7))
  assert.strictEqual(crossProcessPlan.planContentId, devPlan.planContentId)
  assert.notStrictEqual(crossProcessPlan.planId, devPlan.planId)
  assert.strictEqual(crossProcessPlan.cacheDecision.status, 'hit',
    'equivalent content must reuse computation metadata across server processes')

  const cacheDir = path.join(TEMP_ROOT, '.devcodex', 'workspace', '.runtime-state', 'projects', 'chat', 'context-plan-cache')
  const cacheFile = path.join(cacheDir, `${devPlan.planContentId}.json`)
  fs.writeFileSync(cacheFile, '{invalid-json', 'utf8')
  const corruptResponse = runServer('mcp/profile-server.js', [
    rpcRequest(7, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'dev', changeTypes: ['source-code'], project: 'chat', contextEpoch: 'epoch-dev-plan' }
    })
  ], projectRoot)
  const corruptPlan = toolJson(resultById(corruptResponse, 7))
  assert.strictEqual(corruptPlan.cacheDecision.status, 'error')
  assert.strictEqual(validateContextReadPlan(corruptPlan).valid, true,
    'a corrupt derived cache must preserve the correct full-compute result')

  const capacityFile = path.join(cacheDir, 'capacity-probe.json')
  fs.writeFileSync(capacityFile, Buffer.alloc(32 * 1024 * 1024 + 1))
  const bypassResponse = runServer('mcp/profile-server.js', [
    rpcRequest(8, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'chat', project: 'chat', contextEpoch: 'epoch-capacity-bypass' }
    })
  ], projectRoot)
  const bypassPlan = toolJson(resultById(bypassResponse, 8))
  assert.strictEqual(bypassPlan.cacheDecision.status, 'bypassed')
  assert.strictEqual(bypassPlan.cacheDecision.reasonCode, 'metadata-budget-exceeded')
  assert.strictEqual(validateContextReadPlan(bypassPlan).valid, true,
    'capacity bypass must continue the correct non-cache read path')
  fs.unlinkSync(capacityFile)
  assert(Number.isFinite(devPlan.planningTelemetry.latencyMs))
  const serialized = JSON.stringify(devPlan)
  assert.doesNotMatch(serialized, /HIDDEN-BODY-|HIDDEN-PROJECT-03|LOCAL-BODY-SENTINEL/)
  const styleSource = devPlan.selectedSources.find(source => source.selector === '03-代码风格.md')
  assert(styleSource.sourceRefs.every(ref => ref.layer === 'project:chat'))
}

function testProfileContextPlanConditionalSelectors() {
  setupContextPlanWorkspace({ uncatalogued: true })
  const projectRoot = path.join(TEMP_ROOT, 'chat')
  const initial = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'chat', project: 'chat', contextEpoch: 'epoch-conditional-plan' }
    })
  ], projectRoot)
  const initialPlan = toolJson(resultById(initial, 1))
  assert.strictEqual(initialPlan.exitCondition, 'blocked')
  assert.deepStrictEqual(initialPlan.catalogCoverage.unclassifiedIds, ['profile:10-custom.md'])
  const baselineDigest = initialPlan.baselineContext.baselineDigest
  const selector = {
    file: '10-custom.md',
    reason: 'The current task explicitly targets this custom Profile document.',
    authority: 'user-confirmed-task-scope'
  }
  const responses = runServer('mcp/profile-server.js', [
    rpcRequest(2, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'chat', project: 'chat', contextEpoch: 'epoch-conditional-plan', baselineDigest, profileSelectors: [selector] }
    }),
    rpcRequest(3, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'chat', project: 'chat', contextEpoch: 'epoch-conditional-plan', baselineDigest, profileSelectors: [selector] }
    }),
    rpcRequest(4, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'chat', project: 'chat', contextEpoch: 'epoch-conditional-plan', baselineDigest: 'stale', profileSelectors: [selector] }
    }),
    rpcRequest(5, 'tools/call', {
      name: 'profile_context_plan',
      arguments: {
        intent: 'chat', project: 'chat', contextEpoch: 'epoch-conditional-plan', baselineDigest,
        profileSelectors: [{ file: '../10-custom.md', reason: 'bad', authority: 'user' }]
      }
    }),
    rpcRequest(6, 'tools/call', {
      name: 'profile_context_plan',
      arguments: {
        intent: 'chat', project: 'chat', contextEpoch: 'epoch-conditional-plan', baselineDigest,
        profileSelectors: [{ file: '08-服务约束.md', reason: 'Service work is in scope.', authority: 'project-profile' }]
      }
    })
  ], projectRoot)
  const selected = toolJson(resultById(responses, 2))
  const repeated = toolJson(resultById(responses, 3))
  assert.strictEqual(validateContextReadPlan(selected).valid, true)
  assert.deepStrictEqual(selected.profile.selectedFiles, ['10-custom.md'])
  assert.strictEqual(selected.catalogCoverage.unclassifiedIds.length, 0)
  assert.strictEqual(selected.planContentId, repeated.planContentId,
    'identical conditional replan content must be stable')
  assert.notStrictEqual(selected.planId, repeated.planId,
    'conditional invocations must remain isolated')
  assert.strictEqual(repeated.cacheDecision.status, 'hit')
  assert.strictEqual(resultById(responses, 4).isError, true)
  assert.strictEqual(toolJson(resultById(responses, 4)).errorCode, 'CONTEXT_BASELINE_STALE')
  assert.strictEqual(resultById(responses, 5).isError, true)
  assert.strictEqual(toolJson(resultById(responses, 5)).errorCode, 'CONTEXT_PLAN_INVALID')
  const servicePlan = toolJson(resultById(responses, 6))
  assert(servicePlan.profile.selectedFiles.includes('08-服务约束.md'))
  assert(servicePlan.catalogCoverage.unclassifiedIds.includes('profile:10-custom.md'), 'an unrelated uncatalogued file must not be silently excluded')
}

function testProfileContextPlanLocalPolicyAndFullEscalation() {
  setupContextPlanWorkspace()
  const projectRoot = path.join(TEMP_ROOT, 'chat')
  const responses = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'tools/call', {
      name: 'profile_context_plan',
      arguments: {
        intent: 'dev', changeTypes: ['config'], project: 'chat', contextEpoch: 'epoch-local-policy', configLocalRequested: true
      }
    }),
    rpcRequest(2, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'dev', project: 'chat', contextEpoch: 'epoch-low-confidence', confidence: 0.4 }
    })
  ], projectRoot)
  const localPlan = toolJson(resultById(responses, 1))
  assert(localPlan.profile.selectedFiles.includes('config.local.json'))
  assert.doesNotMatch(JSON.stringify(localPlan), /LOCAL-BODY-SENTINEL/)
  const load = runServer('mcp/profile-server.js', [
    rpcRequest(3, 'tools/call', {
      name: 'profile_load',
      arguments: {
        project: 'chat',
        files: localPlan.profile.selectedFiles,
        executionOptimization: localPlan.executionOptimization,
        contextBinding: localPlan.contextBinding
      }
    })
  ], projectRoot)
  assert.match(resultById(load, 3).content?.[0]?.text || '', /LOCAL-BODY-SENTINEL/)
  const fullPlan = toolJson(resultById(responses, 2))
  assert.strictEqual(fullPlan.fullRead, true)
  assert.strictEqual(fullPlan.fullReadReason, 'low-confidence')
  assert(!fullPlan.profile.selectedFiles.includes('config.local.json'), 'full escalation must not bypass local policy')
}

function testProfileContextPlanReadTrace() {
  setupContextPlanWorkspace()
  const projectRoot = path.join(TEMP_ROOT, 'chat')
  const planned = runProfileServerWithReadTrace([
    rpcRequest(1, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'dev', changeTypes: ['source-code'], project: 'chat', contextEpoch: 'epoch-read-trace' }
    })
  ], projectRoot)
  const plan = toolJson(resultById(planned.responses, 1))
  const planReadNames = profileReadBasenames(planned.reads)
  assert(planReadNames.length > 0)
  for (const file of planReadNames) {
    assert(['README.md', 'config.json'].includes(file), `plan hidden-read detected: ${file}`)
  }

  const invalid = runProfileServerWithReadTrace([
    rpcRequest(2, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'docs', project: 'chat' }
    })
  ], projectRoot)
  assert.strictEqual(resultById(invalid.responses, 2).isError, true)
  assert.deepStrictEqual(profileReadBasenames(invalid.reads), [], 'invalid intent must fail before Profile body acquisition')

  const invalidSelector = runProfileServerWithReadTrace([
    rpcRequest(21, 'tools/call', {
      name: 'profile_context_plan',
      arguments: {
        intent: 'chat', project: 'chat', baselineDigest: 'not-reached',
        profileSelectors: [{ file: '08-服务约束.md', authority: 'project-profile' }]
      }
    })
  ], projectRoot)
  assert.strictEqual(resultById(invalidSelector.responses, 21).isError, true)
  assert.strictEqual(toolJson(resultById(invalidSelector.responses, 21)).errorCode, 'CONTEXT_PLAN_INVALID')
  assert.deepStrictEqual(
    profileReadBasenames(invalidSelector.reads),
    [],
    'invalid selector evidence must fail before Profile body acquisition'
  )

  const targeted = runProfileServerWithReadTrace([
    rpcRequest(3, 'tools/call', {
      name: 'profile_load',
      arguments: {
        project: 'chat',
        files: plan.profile.selectedFiles,
        executionOptimization: plan.executionOptimization,
        contextBinding: plan.contextBinding
      }
    })
  ], projectRoot)
  const targetedNames = [...new Set(profileReadBasenames(targeted.reads))].sort()
  assert.deepStrictEqual(targetedNames, [...plan.profile.selectedFiles].sort(), 'targeted loader trace must equal plan.selectedFiles')

  const localPlanTrace = runProfileServerWithReadTrace([
    rpcRequest(4, 'tools/call', {
      name: 'profile_context_plan',
      arguments: {
        intent: 'dev', changeTypes: ['config'], project: 'chat', contextEpoch: 'epoch-local-trace', configLocalRequested: true
      }
    })
  ], projectRoot)
  assert(!profileReadBasenames(localPlanTrace.reads).includes('config.local.json'), 'plan may select local metadata but must not read local content')

  const fullContextBinding = createTestContextBinding(projectRoot, {
    intent: 'resume',
    explicitFull: true
  })
  const authorizedFull = runProfileServerWithReadTrace([
    rpcRequest(5, 'tools/call', {
      name: 'profile_load',
      arguments: {
        project: 'chat',
        explicitFull: true,
        fullReadReason: 'context-read trace fixture full tier',
        maxBytes: 500000,
        contextBinding: fullContextBinding
      }
    })
  ], projectRoot)
  const legacyNames = new Set(profileReadBasenames(authorizedFull.reads))
  for (const file of ['README.md', '01-项目信息.md', '06-功能清单.md', '07-用户文档与契约规范.md', 'config.local.json']) {
    assert(legacyNames.has(file), `authorized full-read trace lost ${file}`)
  }
}

function testWorkspaceNamespaceMemoryScope() {
  setupLayoutWorkspace()
  const projectRoot = path.join(TEMP_ROOT, 'chat')
  const allocation = allocateMemorySession(projectRoot, {
    date: '20260524', title: 'workspace-scope', intent: 'analyze'
  })
  const responses = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'tools/call', {
      name: 'memory_session_write',
      arguments: {
        date: '20260524',
        sessionId: allocation.sessionId,
        sessionBinding: allocation.sessionBinding,
        content: '# session\n'
      }
    }),
    rpcRequest(3, 'tools/call', {
      name: 'memory_summary_append',
      arguments: { scope: 'workspace', row: '| 2026-05-24 | #1 | analyze | workspace | — | — | ✅ |' }
    })
  ], projectRoot)

  assert.ok(resultById(responses, 2).content[0].text.includes('chat'))
  assert.ok(resultById(responses, 3).content[0].text.includes('SUMMARY.md'))
  assert.ok(fs.existsSync(path.join(
    TEMP_ROOT, '.devcodex', 'chat', '.memory', 'clients', 'claude-code', 'tasks', '20260524.md'
  )))
  assert.ok(fs.existsSync(path.join(
    TEMP_ROOT, '.devcodex', 'workspace', '.memory', 'clients', 'claude-code', 'SUMMARY.md'
  )))
  const workspaceSummary = fs.readFileSync(path.join(
    TEMP_ROOT, '.devcodex', 'workspace', '.memory', 'clients', 'claude-code', 'SUMMARY.md'
  ), 'utf8')
  assert.ok(workspaceSummary.includes('# Agent SUMMARY — claude-code'))
  assert.ok(workspaceSummary.includes('> 项目：workspace'))
  assert.ok(workspaceSummary.includes('|------|:----:|------|------|---------|---------|:----:|'))
}

function testWorkspaceRootMemoryScopeRequiresExplicitTarget() {
  setupLayoutWorkspace()
  const ambiguous = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'tools/call', {
      name: 'memory_session_write',
      arguments: {
        date: '20260524',
        content: '# ambiguous\n',
        sessionId: '01',
        sessionBinding: 'a'.repeat(64)
      }
    })
  ], TEMP_ROOT)

  const ambiguousResult = resultById(ambiguous, 2)
  assert.strictEqual(ambiguousResult.isError, true)
  assert.match(ambiguousResult.content?.[0]?.text || '', /ambiguous|project|workspace/i)
  assert.ok(!fs.existsSync(path.join(
    TEMP_ROOT, '.devcodex', 'workspace', '.memory', 'clients', 'claude-code', 'tasks', '20260524.md'
  )))

  const explicitWorkspace = runServer('mcp/memory-server.js', [
    rpcRequest(3, 'tools/call', {
      name: 'memory_summary_append',
      arguments: { scope: 'workspace', row: '| 2026-05-24 | #2 | analyze | explicit workspace | — | — | ✅ |' }
    })
  ], TEMP_ROOT)
  assert.ok(resultById(explicitWorkspace, 3).content[0].text.includes('SUMMARY.md'))
  assert.ok(fs.existsSync(path.join(
    TEMP_ROOT, '.devcodex', 'workspace', '.memory', 'clients', 'claude-code', 'SUMMARY.md'
  )))

  const projectAllocation = allocateMemorySession(TEMP_ROOT, {
    project: 'chat', date: '20260524', title: 'explicit-project', intent: 'analyze'
  })
  const explicitProject = runServer('mcp/memory-server.js', [
    rpcRequest(4, 'tools/call', {
      name: 'memory_session_write',
      arguments: {
        project: 'chat',
        date: '20260524',
        sessionId: projectAllocation.sessionId,
        sessionBinding: projectAllocation.sessionBinding,
        content: '# project\n'
      }
    })
  ], TEMP_ROOT)
  assert.ok(resultById(explicitProject, 4).content[0].text.includes('chat'))
  assert.ok(fs.existsSync(path.join(
    TEMP_ROOT, '.devcodex', 'chat', '.memory', 'clients', 'claude-code', 'tasks', '20260524.md'
  )))
}

function testWorkspaceNamespaceNestedProjectInference() {
  setupNestedLayoutWorkspace()
  const projectRoot = path.join(TEMP_ROOT, 'packages', 'app-a')
  const profileResponses = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'tools/call', { name: 'profile_get_mode', arguments: {} }),
    rpcRequest(3, 'tools/list')
  ], projectRoot)
  const profilePayload = JSON.parse(resultById(profileResponses, 2).content?.[0]?.text || '{}')
  assert.strictEqual(profilePayload.project, 'packages/app-a')
  assert.strictEqual(profilePayload.mode, 'dev')
  const profileLoadTool = resultById(profileResponses, 3).tools.find(tool => tool.name === 'profile_load')
  const bindingPattern = profileLoadTool.inputSchema.properties.contextBinding.properties.project.pattern
  assert.strictEqual(new RegExp(bindingPattern).test('packages/app-a'), true)

  const allocation = allocateMemorySession(projectRoot, {
    date: '20260524', title: 'nested-project', intent: 'analyze'
  })
  const memoryResponses = runServer('mcp/memory-server.js', [
    rpcRequest(3, 'tools/call', {
      name: 'memory_session_write',
      arguments: {
        date: '20260524',
        sessionId: allocation.sessionId,
        sessionBinding: allocation.sessionBinding,
        content: '# nested\n'
      }
    })
  ], projectRoot)
  assert.ok(fs.existsSync(path.join(
    TEMP_ROOT, '.devcodex', 'packages', 'app-a', '.memory', 'clients', 'claude-code', 'tasks', '20260524.md'
  )))
  assert.ok(!fs.existsSync(path.join(
    TEMP_ROOT, '.devcodex', 'packages', '.memory', 'clients', 'claude-code', 'tasks', '20260524.md'
  )))
  assert.match(resultById(memoryResponses, 3).content?.[0]?.text || '', /packages[\\/]+app-a|packages\/app-a/)
}

function testWorkspaceNamespaceTraversalRejected() {
  setupLayoutWorkspace()
  const profileResponses = runServer('mcp/profile-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'tools/call', {
      name: 'profile_load',
      arguments: { project: '..\\..\\leak2', files: ['01-项目信息.md'] }
    })
  ], TEMP_ROOT)
  assert.strictEqual(resultById(profileResponses, 2).isError, true)
  assert.match(resultById(profileResponses, 2).content?.[0]?.text || '', /traversal|workspace-relative|reserved|namespace/i)

  const memoryResponses = runServer('mcp/memory-server.js', [
    rpcRequest(3, 'tools/call', {
      name: 'memory_session_write',
      arguments: {
        project: '..\\..\\escape-probe',
        date: '20260524',
        content: '# blocked\n',
        sessionId: '01',
        sessionBinding: 'a'.repeat(64)
      }
    })
  ], TEMP_ROOT)
  assert.strictEqual(resultById(memoryResponses, 3).isError, true)
  assert.match(resultById(memoryResponses, 3).content?.[0]?.text || '', /traversal|workspace-relative|reserved|namespace/i)
}

function testAdjacentMcpPathArgumentsRejected() {
  setupLegacyWorkspace()
  const memoryCases = [
    { name: 'memory_session_write', arguments: { agent: '../escape', date: '20260524', content: '# blocked\n', sessionId: '01', sessionBinding: 'a'.repeat(64) } },
    { name: 'memory_session_write', arguments: { agent: '..\\escape', date: '20260524', content: '# blocked\n', sessionId: '01', sessionBinding: 'a'.repeat(64) } },
    { name: 'memory_session_write', arguments: { agent: 'C:\\escape', date: '20260524', content: '# blocked\n', sessionId: '01', sessionBinding: 'a'.repeat(64) } },
    { name: 'memory_session_write', arguments: { agent: 'codex ', date: '20260524', content: '# blocked\n', sessionId: '01', sessionBinding: 'a'.repeat(64) } },
    { name: 'memory_session_write', arguments: { agent: 'codex\nother', date: '20260524', content: '# blocked\n', sessionId: '01', sessionBinding: 'a'.repeat(64) } },
    { name: 'memory_session_write', arguments: { agent: 'codex', date: '../escape', content: '# blocked\n', sessionId: '01', sessionBinding: 'a'.repeat(64) } },
    { name: 'memory_cp_confirm', arguments: { requirement: '../escape', kind: 'bugs', phase: 'CP1' } },
    { name: 'memory_cp_confirm', arguments: { requirement: '..\\escape', kind: 'bugs', phase: 'CP1' } },
    { name: 'memory_cp_confirm', arguments: { requirement: 'C:\\escape', kind: 'bugs', phase: 'CP1' } },
    { name: 'memory_cp_confirm', arguments: { requirement: 'escape/nested', kind: 'bugs', phase: 'CP1' } },
    { name: 'memory_cp_confirm', arguments: { requirement: 'escape ', kind: 'bugs', phase: 'CP1' } },
    { name: 'memory_cp_confirm', arguments: { requirement: 'escape\nother', kind: 'bugs', phase: 'CP1' } },
    { name: 'memory_summary_append', arguments: { agent: 'codex\\other', row: '| blocked |' } }
  ]
  const memoryResponses = runServer('mcp/memory-server.js', memoryCases.map((item, index) =>
    rpcRequest(index + 1, 'tools/call', item)
  ), TEMP_ROOT)
  for (let id = 1; id <= memoryCases.length; id += 1) {
    const result = resultById(memoryResponses, id)
    assert.strictEqual(result.isError, true)
    assert.match(result.content?.[0]?.text || '', /invalid|allowed root|YYYYMMDD/i)
  }
  assert.ok(!fs.existsSync(path.join(TEMP_ROOT, '.devcodex', 'escape')))

  const profileCases = [
    '../outside.md',
    '..\\outside.md',
    'C:\\outside.md',
    'nested/outside.md',
    'outside.md ',
    'outside\nother.md'
  ]
  const profileResponses = runServer('mcp/profile-server.js', profileCases.map((file, index) =>
    rpcRequest(100 + index, 'tools/call', {
      name: 'profile_load',
      arguments: { files: [file] }
    })
  ), TEMP_ROOT)
  for (let index = 0; index < profileCases.length; index += 1) {
    const result = resultById(profileResponses, 100 + index)
    assert.strictEqual(result.isError, true)
    assert.match(result.content?.[0]?.text || '', /invalid|allowed root/i)
  }
}

function testMemorySessionAllocationAndTransactions() {
  setupLayoutWorkspace()
  const projectRoot = path.join(TEMP_ROOT, 'chat')
  const contextBinding = createTestContextBinding(projectRoot, { intent: 'resume' })
  const allocations = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'initialize'),
    rpcRequest(2, 'tools/list'),
    rpcRequest(3, 'tools/call', {
      name: 'memory_session_allocate',
      arguments: { date: '20260524', title: 'first', intent: 'analyze' }
    }),
    rpcRequest(4, 'tools/call', {
      name: 'memory_session_allocate',
      arguments: { date: '20260524', title: 'second', intent: 'dev' }
    })
  ], projectRoot)

  const listedTools = resultById(allocations, 2).tools
  assert(listedTools.some(tool => tool.name === 'memory_session_allocate'))
  const writeSchema = findToolSchema(listedTools, 'memory_session_write')
  assert.strictEqual(writeSchema.additionalProperties, false)
  assert.strictEqual(writeSchema.properties.content.maxLength, 262144)
  assert.strictEqual(writeSchema.properties.sessionId.maxLength, 64)
  assert.strictEqual(writeSchema.properties.sessionBinding.pattern, '^[a-f0-9]{64}$')
  assert.deepStrictEqual(writeSchema.required, ['content', 'sessionId', 'sessionBinding'])
  const first = JSON.parse(resultById(allocations, 3).content[0].text)
  const second = JSON.parse(resultById(allocations, 4).content[0].text)
  assert.deepStrictEqual(resultById(allocations, 3).structuredContent, first)
  assert.deepStrictEqual(resultById(allocations, 4).structuredContent, second)
  assert.strictEqual(first.schemaVersion, 'MemorySessionAllocationReceiptV1')
  assert.strictEqual(first.sessionId, '01')
  assert.strictEqual(second.sessionId, '02')
  assert.strictEqual(first.sessionBindingSchemaVersion, 'MemorySessionBindingV1')
  assert.match(first.sessionBinding, /^[a-f0-9]{64}$/)
  assert.match(second.sessionBinding, /^[a-f0-9]{64}$/)
  assert.notStrictEqual(first.sessionBinding, second.sessionBinding)
  assert.strictEqual(first.transaction.schemaVersion, 'MemoryFileTransactionReceiptV1')
  assert.strictEqual(first.transaction.indexReceipt.status, 'persisted')
  assert.strictEqual(second.transaction.indexReceipt.status, 'persisted')
  assert.strictEqual(second.transaction.indexReceipt.generation, 2)

  const dailyPath = path.join(TEMP_ROOT, '.devcodex', 'chat', '.memory', 'clients', 'claude-code', 'tasks', '20260524.md')
  const beforeRejectedWrites = fs.readFileSync(dailyPath, 'utf8')
  const rejected = runServer('mcp/memory-server.js', [
    rpcRequest(5, 'tools/call', {
      name: 'memory_session_write',
      arguments: { date: '20260524', content: 'unbound-must-not-land\n' }
    }),
    rpcRequest(6, 'tools/call', {
      name: 'memory_session_write',
      arguments: { date: '20260524', sessionId: first.sessionId, content: 'missing-binding-must-not-land\n' }
    }),
    rpcRequest(7, 'tools/call', {
      name: 'memory_session_write',
      arguments: {
        date: '20260524',
        sessionId: first.sessionId,
        sessionBinding: second.sessionBinding,
        content: 'cross-task-must-not-land\n'
      }
    }),
    rpcRequest(8, 'tools/call', {
      name: 'memory_session_write',
      arguments: { date: '20260524', sessionBinding: first.sessionBinding, content: 'binding-only-must-not-land\n' }
    }),
    rpcRequest(18, 'tools/call', {
      name: 'memory_session_write',
      arguments: {
        date: '20260524',
        sessionId: '99',
        sessionBinding: first.sessionBinding,
        content: 'missing-target-must-not-land\n'
      }
    }),
    rpcRequest(19, 'tools/call', {
      name: 'memory_session_write',
      arguments: {
        date: '20260524',
        sessionId: first.sessionId,
        sessionBinding: first.sessionBinding,
        content: '## 会话 77 — injected-must-not-land\n'
      }
    }),
    rpcRequest(20, 'tools/call', {
      name: 'memory_session_write',
      arguments: {
        date: '20260524',
        sessionId: first.sessionId,
        sessionBinding: first.sessionBinding,
        content: `<!-- devcodex:memory-session-binding v1 session=${first.sessionId} token=${first.sessionBinding} -->\nmarker-must-not-land\n`
      }
    }),
    rpcRequest(21, 'tools/call', {
      name: 'memory_session_write',
      arguments: {
        date: '20260524',
        sessionId: first.sessionId,
        sessionBinding: first.sessionBinding,
        content: 'unknown-field-must-not-land\n',
        legacyMode: true
      }
    }),
    rpcRequest(22, 'tools/call', {
      name: 'memory_session_write',
      arguments: {
        date: '20260524',
        sessionId: first.sessionId,
        sessionBinding: first.sessionBinding,
        content: { invalid: true }
      }
    }),
    rpcRequest(23, 'tools/call', {
      name: 'memory_session_write',
      arguments: {
        date: '20260524',
        sessionId: first.sessionId,
        sessionBinding: first.sessionBinding,
        content: 'x'.repeat(262145)
      }
    })
  ], projectRoot)
  assert.match(resultById(rejected, 5).content?.[0]?.text || '', /MEMORY_WRITER_ARGUMENT_REQUIRED/)
  assert.match(resultById(rejected, 6).content?.[0]?.text || '', /MEMORY_WRITER_ARGUMENT_REQUIRED/)
  assert.match(resultById(rejected, 7).content?.[0]?.text || '', /MEMORY_SESSION_BINDING_MISMATCH/)
  assert.match(resultById(rejected, 8).content?.[0]?.text || '', /MEMORY_WRITER_ARGUMENT_REQUIRED/)
  assert.match(resultById(rejected, 18).content?.[0]?.text || '', /MEMORY_SESSION_NOT_FOUND/)
  assert.match(resultById(rejected, 19).content?.[0]?.text || '', /MEMORY_SESSION_WRITE_VERIFICATION_FAILED/)
  assert.match(resultById(rejected, 20).content?.[0]?.text || '', /MEMORY_SESSION_LAYOUT_INVALID/)
  for (const id of [21, 22, 23]) {
    assert.match(resultById(rejected, id).content?.[0]?.text || '', /MEMORY_WRITER_ARGUMENT_INVALID/)
  }
  assert.strictEqual(resultById(rejected, 5).structuredContent.errorCode, 'MEMORY_WRITER_ARGUMENT_REQUIRED')
  assert.strictEqual(resultById(rejected, 7).structuredContent.errorCode, 'MEMORY_SESSION_BINDING_MISMATCH')
  for (const id of [5, 6, 7, 8, 18, 19, 20, 21, 22, 23]) {
    assert.strictEqual(resultById(rejected, id).isError, true)
  }
  assert.strictEqual(
    fs.readFileSync(dailyPath, 'utf8'),
    beforeRejectedWrites,
    'rejected or cross-task writes must be zero-mutation'
  )

  const invalidAllocationDate = '20260528'
  const invalidAllocationPath = path.join(path.dirname(dailyPath), `${invalidAllocationDate}.md`)
  const invalidAllocations = runServer('mcp/memory-server.js', [
    rpcRequest(24, 'tools/call', {
      name: 'memory_session_allocate',
      arguments: { date: invalidAllocationDate, title: 'bad\n## 会话 99 — injected', intent: 'analyze' }
    }),
    rpcRequest(25, 'tools/call', {
      name: 'memory_session_allocate',
      arguments: {
        date: invalidAllocationDate,
        title: 'reserved-marker',
        intent: 'analyze',
        sourceMessage: 'devcodex:memory-session-binding v1 session=99 token=forged'
      }
    }),
    rpcRequest(26, 'tools/call', {
      name: 'memory_session_allocate',
      arguments: { date: invalidAllocationDate, title: 'x'.repeat(161), intent: 'analyze' }
    }),
    rpcRequest(27, 'tools/call', {
      name: 'memory_session_allocate',
      arguments: { date: invalidAllocationDate, title: 'unknown-field', intent: 'analyze', legacyMode: true }
    })
  ], projectRoot)
  for (const id of [24, 25, 26, 27]) {
    assert.strictEqual(resultById(invalidAllocations, id).isError, true)
    assert.match(resultById(invalidAllocations, id).content?.[0]?.text || '', /MEMORY_WRITER_ARGUMENT_INVALID/)
  }
  assert.strictEqual(fs.existsSync(invalidAllocationPath), false, 'invalid allocations must be zero-mutation')

  const responses = runServer('mcp/memory-server.js', bindGovernedContextReads([
    rpcRequest(9, 'tools/call', {
      name: 'memory_session_write',
      arguments: {
        date: '20260524',
        sessionId: first.sessionId,
        sessionBinding: first.sessionBinding,
        content: 'first-session-only\n'
      }
    }),
    rpcRequest(10, 'tools/call', {
      name: 'memory_session_write',
      arguments: {
        date: '20260524',
        sessionId: second.sessionId,
        sessionBinding: second.sessionBinding,
        content: 'second-session-only\n'
      }
    }),
    rpcRequest(11, 'tools/call', {
      name: 'memory_summary_append',
      arguments: { row: '| 2026-05-24 | 01 | analyze | atomic summary | — | — | ✅ |' }
    }),
    rpcRequest(12, 'tools/call', {
      name: 'memory_session_query',
      arguments: { date: '20260524', status: 'all', limit: 10 }
    }),
    rpcRequest(13, 'tools/call', {
      name: 'memory_summary_query',
      arguments: { status: 'completed', limit: 10 }
    })
  ], contextBinding), projectRoot)

  for (const id of [9, 10, 11]) {
    assert.match(resultById(responses, id).content[0].text, /MemoryFileTransactionReceiptV1/)
    assert.match(resultById(responses, id).content[0].text, /MemoryIndexReceiptV1/)
  }
  for (const id of [9, 10]) {
    const receipt = memoryTransactionJson(resultById(responses, id))
    assert.deepStrictEqual(resultById(responses, id).structuredContent, receipt)
    assert.strictEqual(receipt.sessionWrite.schemaVersion, 'MemorySessionWriteReceiptV1')
    assert.strictEqual(receipt.sessionWrite.mode, 'bound-session')
    assert.strictEqual(receipt.sessionWrite.bindingStatus, 'verified')
    assert.strictEqual(receipt.sessionWrite.nonTargetStable, true)
    assert.strictEqual(receipt.sessionWrite.readbackVerified, true)
  }
  const indexedDaily = toolJson(resultById(responses, 12))
  const indexedSummary = toolJson(resultById(responses, 13))
  assert.strictEqual(indexedDaily.indexReceipt.status, 'fresh')
  assert.strictEqual(indexedDaily.coverage.status, 'complete')
  assert.strictEqual(indexedDaily.derivedIndexFreshness.status, 'fresh')
  assert.strictEqual(indexedDaily.canonicalSourceTrust.basis, 'writer-attested-metadata-reconciled')
  assert.strictEqual(indexedDaily.fallbackCoverage.status, 'not-used')
  assert.strictEqual(indexedDaily.repairState.status, 'not-needed')
  assert(indexedDaily.telemetry.indexBytesRead > 0)
  assert.strictEqual(indexedSummary.indexReceipt.status, 'fresh')
  assert.strictEqual(indexedSummary.coverage.status, 'complete')

  const daily = fs.readFileSync(dailyPath, 'utf8')
  assert.match(daily, /## 会话 01 — first/)
  assert.match(daily, /## 会话 02 — second/)
  const secondHeading = daily.indexOf('## 会话 02 — second')
  const firstBlock = daily.slice(0, secondHeading)
  const secondBlock = daily.slice(secondHeading)
  assert.match(firstBlock, /first-session-only/)
  assert.doesNotMatch(firstBlock, /second-session-only/)
  assert.match(secondBlock, /second-session-only/)
  assert.doesNotMatch(secondBlock, /first-session-only/)
  assert.doesNotMatch(daily, /must-not-land/)
  const summary = fs.readFileSync(path.join(TEMP_ROOT, '.devcodex', 'chat', '.memory', 'clients', 'claude-code', 'SUMMARY.md'), 'utf8')
  assert.match(summary, /atomic summary/)

  const legacyDate = '20260526'
  const legacyPath = path.join(path.dirname(dailyPath), `${legacyDate}.md`)
  fs.writeFileSync(legacyPath, [
    '## 会话 01 — legacy first',
    '',
    '- **状态**：🔄 active',
    '',
    '## 会话 02 — legacy second',
    '',
    '- **状态**：🔄 active',
    ''
  ].join('\n'), 'utf8')
  const legacyBefore = fs.readFileSync(legacyPath, 'utf8')
  const rejectedLegacyWrite = runServer('mcp/memory-server.js', [
    rpcRequest(14, 'tools/call', {
      name: 'memory_session_write',
      arguments: { date: legacyDate, content: 'legacy-unbound-must-not-land\n' }
    }),
    rpcRequest(15, 'tools/call', {
      name: 'memory_session_write',
      arguments: { date: legacyDate, sessionId: '01', content: 'legacy-explicit-must-not-land\n' }
    }),
    rpcRequest(16, 'tools/call', {
      name: 'memory_session_write',
      arguments: {
        date: legacyDate,
        sessionId: '01',
        sessionBinding: 'a'.repeat(64),
        content: 'legacy-forged-binding-must-not-land\n'
      }
    })
  ], projectRoot)
  assert.strictEqual(resultById(rejectedLegacyWrite, 14).isError, true)
  assert.strictEqual(resultById(rejectedLegacyWrite, 15).isError, true)
  assert.strictEqual(resultById(rejectedLegacyWrite, 16).isError, true)
  assert.match(resultById(rejectedLegacyWrite, 14).content?.[0]?.text || '', /MEMORY_WRITER_ARGUMENT_REQUIRED/)
  assert.match(resultById(rejectedLegacyWrite, 15).content?.[0]?.text || '', /MEMORY_WRITER_ARGUMENT_REQUIRED/)
  assert.match(resultById(rejectedLegacyWrite, 16).content?.[0]?.text || '', /MEMORY_SESSION_BINDING_UNAVAILABLE/)
  assert.strictEqual(fs.readFileSync(legacyPath, 'utf8'), legacyBefore, 'legacy write rejection must be zero-mutation')
  const legacyContinuation = allocateMemorySession(projectRoot, {
    date: legacyDate, title: 'legacy continuation', intent: 'resume'
  })
  assert.strictEqual(legacyContinuation.sessionId, '03')
  const legacyWrites = runServer('mcp/memory-server.js', [
    rpcRequest(17, 'tools/call', {
      name: 'memory_session_write',
      arguments: {
        date: legacyDate,
        sessionId: legacyContinuation.sessionId,
        sessionBinding: legacyContinuation.sessionBinding,
        content: 'legacy-continuation-bound\n'
      }
    })
  ], projectRoot)
  const legacyReceipt = memoryTransactionJson(resultById(legacyWrites, 17))
  assert.strictEqual(legacyReceipt.sessionWrite.mode, 'bound-session')
  const legacyAfter = fs.readFileSync(legacyPath, 'utf8')
  const legacyContinuationHeading = legacyAfter.indexOf('## 会话 03 — legacy continuation')
  assert.strictEqual(legacyAfter.slice(0, legacyContinuationHeading).trimEnd(), legacyBefore.trimEnd())
  assert.match(legacyAfter.slice(legacyContinuationHeading), /legacy-continuation-bound/)
  assert.doesNotMatch(legacyAfter, /must-not-land/)

  const rawLegacyDate = '20260527'
  const rawLegacyPath = path.join(path.dirname(dailyPath), `${rawLegacyDate}.md`)
  const rawLegacyBefore = '# legacy raw daily\n\nold content\n'
  fs.writeFileSync(rawLegacyPath, rawLegacyBefore, 'utf8')
  const rejectedRawLegacy = runServer('mcp/memory-server.js', [
    rpcRequest(18, 'tools/call', {
      name: 'memory_session_write',
      arguments: { date: rawLegacyDate, content: 'raw-unbound-must-not-land\n' }
    })
  ], projectRoot)
  assert.strictEqual(resultById(rejectedRawLegacy, 18).isError, true)
  assert.match(resultById(rejectedRawLegacy, 18).content?.[0]?.text || '', /MEMORY_WRITER_ARGUMENT_REQUIRED/)
  assert.strictEqual(fs.readFileSync(rawLegacyPath, 'utf8'), rawLegacyBefore)
  const rawContinuation = allocateMemorySession(projectRoot, {
    date: rawLegacyDate, title: 'raw legacy continuation', intent: 'resume'
  })
  const rawContinuationWrite = runServer('mcp/memory-server.js', [
    rpcRequest(19, 'tools/call', {
      name: 'memory_session_write',
      arguments: {
        date: rawLegacyDate,
        sessionId: rawContinuation.sessionId,
        sessionBinding: rawContinuation.sessionBinding,
        content: 'raw-legacy-continuation-bound\n'
      }
    })
  ], projectRoot)
  assert.notStrictEqual(resultById(rawContinuationWrite, 19).isError, true)
  const rawLegacyAfter = fs.readFileSync(rawLegacyPath, 'utf8')
  assert.ok(rawLegacyAfter.startsWith(rawLegacyBefore))
  assert.match(rawLegacyAfter, /raw-legacy-continuation-bound/)
  assert.doesNotMatch(rawLegacyAfter, /raw-unbound-must-not-land/)

  const derivedRoot = path.join(TEMP_ROOT, '.devcodex', 'chat', '.runtime-state', 'derived-indexes')
  const beforeQueryOnly = snapshotTree(derivedRoot)
  const queryOnly = runServer('mcp/memory-server.js', bindGovernedContextReads([
    rpcRequest(20, 'tools/call', {
      name: 'memory_session_query',
      arguments: { date: '20260524', status: 'all', limit: 10 }
    }),
    rpcRequest(21, 'tools/call', {
      name: 'memory_summary_query',
      arguments: { status: 'completed', limit: 10 }
    })
  ], contextBinding), projectRoot)
  assert.strictEqual(toolJson(resultById(queryOnly, 20)).indexReceipt.status, 'fresh')
  assert.strictEqual(toolJson(resultById(queryOnly, 21)).indexReceipt.status, 'fresh')
  assert.deepStrictEqual(snapshotTree(derivedRoot), beforeQueryOnly, 'index-backed MCP query must be zero-write')

  fs.appendFileSync(dailyPath, '\nnon-special writer edit\n', 'utf8')
  const beforeFallback = snapshotTree(derivedRoot)
  const fallbackQueries = runServer('mcp/memory-server.js', bindGovernedContextReads([
    rpcRequest(30, 'tools/call', {
      name: 'memory_session_query',
      arguments: { date: '20260524', status: 'all', limit: 10 }
    }),
    rpcRequest(31, 'tools/call', {
      name: 'memory_session_query',
      arguments: { date: '20260524', status: 'all', limit: 10 }
    })
  ], contextBinding), projectRoot)
  const firstFallback = toolJson(resultById(fallbackQueries, 30))
  const repeatedFallback = toolJson(resultById(fallbackQueries, 31))
  assert.strictEqual(firstFallback.indexReceipt.status, 'fallback')
  assert.strictEqual(firstFallback.indexReceipt.reason, 'source-metadata-drift')
  assert.strictEqual(firstFallback.derivedIndexFreshness.status, 'stale')
  assert.strictEqual(firstFallback.canonicalSourceTrust.status, 'trusted')
  assert.strictEqual(firstFallback.canonicalSourceTrust.basis, 'bounded-source-scan-complete')
  assert.strictEqual(firstFallback.fallbackCoverage.status, 'complete')
  assert.strictEqual(firstFallback.repairState.status, 'repair-needed')
  assert.strictEqual(
    repeatedFallback.repairState.diagnosticFingerprint,
    firstFallback.repairState.diagnosticFingerprint,
    'non-special writer fallback diagnostics must dedupe by stable state fingerprint'
  )
  assert.deepStrictEqual(
    snapshotTree(derivedRoot),
    beforeFallback,
    'canonical fallback and repair diagnostics must remain zero-write'
  )

  const lockedDate = '20260525'
  const activeRoot = path.join(TEMP_ROOT, '.devcodex', 'chat')
  const canonicalLockPath = file => {
    const resolved = path.resolve(file)
    let existing = resolved
    const suffix = []
    while (!fs.existsSync(existing)) {
      const parent = path.dirname(existing)
      if (parent === existing) break
      suffix.unshift(path.basename(existing))
      existing = parent
    }
    const realpath = fs.realpathSync.native || fs.realpathSync
    const value = path.resolve(realpath(existing), ...suffix).replace(/\\/g, '/')
    return process.platform === 'win32' ? value.toLowerCase() : value
  }
  const lockedFile = path.join(activeRoot, '.memory', 'clients', 'claude-code', 'tasks', `${lockedDate}.md`)
  const lockKey = crypto.createHash('sha256').update(`${canonicalLockPath(activeRoot)}\0${canonicalLockPath(lockedFile)}`).digest('hex')
  const lockDir = path.join(TEMP_ROOT, '.devcodex', 'workspace', '.runtime-state', 'projects', 'chat', 'memory-locks', lockKey)
  fs.mkdirSync(lockDir, { recursive: true })
  fs.writeFileSync(path.join(lockDir, 'owner.json'), `${JSON.stringify({
    schemaVersion: 'MemoryWriterLockV2',
    pid: 999999,
    host: os.hostname(),
    token: 'stale-owner-token',
    file: path.relative(activeRoot, lockedFile).replace(/\\/g, '/'),
    acquiredAt: '2000-01-01T00:00:00.000Z'
  })}\n`, 'utf8')

  const recovered = runServer('mcp/memory-server.js', [
    rpcRequest(7, 'tools/call', {
      name: 'memory_session_allocate',
      arguments: { date: lockedDate, title: 'stale-lock-recovered', intent: 'fix' }
    })
  ], projectRoot)
  assert.notStrictEqual(resultById(recovered, 7).isError, true)
  assert.strictEqual(toolJson(resultById(recovered, 7)).sessionId, '01')
  assert.strictEqual(fs.existsSync(lockedFile), true, 'same-host dead-pid lock must be recovered atomically')
  assert.strictEqual(fs.existsSync(lockDir), false, 'recovered writer lock must release after the transaction')

  const liveDate = '20260528'
  const liveFile = path.join(activeRoot, '.memory', 'clients', 'claude-code', 'tasks', `${liveDate}.md`)
  const liveKey = crypto.createHash('sha256').update(`${canonicalLockPath(activeRoot)}\0${canonicalLockPath(liveFile)}`).digest('hex')
  const liveLockDir = path.join(TEMP_ROOT, '.devcodex', 'workspace', '.runtime-state', 'projects', 'chat', 'memory-locks', liveKey)
  fs.mkdirSync(liveLockDir, { recursive: true })
  fs.writeFileSync(path.join(liveLockDir, 'owner.json'), `${JSON.stringify({
    schemaVersion: 'MemoryWriterLockV2',
    pid: process.pid,
    host: os.hostname(),
    token: 'live-owner-token',
    file: path.relative(activeRoot, liveFile).replace(/\\/g, '/'),
    acquiredAt: new Date().toISOString()
  })}\n`, 'utf8')
  const blocked = runServer('mcp/memory-server.js', [
    rpcRequest(8, 'tools/call', {
      name: 'memory_session_allocate',
      arguments: { date: liveDate, title: 'must-not-write', intent: 'fix' }
    })
  ], projectRoot)
  assert.strictEqual(resultById(blocked, 8).isError, true)
  assert.match(resultById(blocked, 8).content?.[0]?.text || '', /MEMORY_TRANSACTION_LOCKED/)
  assert.strictEqual(fs.existsSync(liveFile), false, 'live writer lock must remain fail-closed')
}

function testMemoryArtifactLinkProjectionAndWriterIntegration() {
  setupLayoutWorkspace()
  const projectRoot = path.join(TEMP_ROOT, 'chat')
  const activeRoot = path.join(TEMP_ROOT, '.devcodex', 'chat')
  const reportPath = path.join(activeRoot, 'reports', 'Report One.md')
  const memoryPath = path.join(activeRoot, 'reports', 'Memory Index.md')
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, '# Report One\n', 'utf8')
  fs.writeFileSync(memoryPath, '# Memory Index\n', 'utf8')
  const allocation = allocateMemorySession(projectRoot, {
    date: '20260820', title: 'artifact links', intent: 'fix'
  })
  const dailyDocument = '.memory/clients/claude-code/tasks/20260820.md'
  const capability = createLinkCapabilityDecision({
    surface: 'memory-mcp-test',
    evidenceState: 'verified',
    supportsMarkdown: true,
    supportsClickable: false,
    workspaceRoot: activeRoot,
    targetRelation: 'workspace',
    evidenceRefs: ['test:canonical-containment']
  })
  const reportArtifact = {
    id: 'report',
    label: 'Report One',
    targetPath: 'reports/Report One.md',
    purpose: 'primary report'
  }
  const duplicateArtifact = {
    id: 'report-duplicate',
    label: 'Duplicate report',
    targetPath: 'reports/Report One.md',
    purpose: 'dedupe probe'
  }
  const projected = runServer('mcp/memory-server.js', [
    rpcRequest(1, 'tools/list'),
    rpcRequest(2, 'tools/call', {
      name: 'memory_artifact_link_project',
      arguments: {
        operation: 'project',
        documentPath: dailyDocument,
        artifacts: [reportArtifact, duplicateArtifact],
        linkCapability: capability
      }
    })
  ], projectRoot)
  const listedTools = resultById(projected, 1).tools
  const projectionSchema = findToolSchema(listedTools, 'memory_artifact_link_project')
  assert.deepStrictEqual(projectionSchema.required, ['documentPath', 'artifacts', 'linkCapability'])
  assert.deepStrictEqual(projectionSchema.properties.operation.enum, ['project', 'validate-existing'])
  const projection = toolJson(resultById(projected, 2))
  assert.strictEqual(projection.schemaVersion, 'ArtifactLinkProjectionSetV1')
  assert.strictEqual(projection.dedupe.inputCount, 2)
  assert.strictEqual(projection.dedupe.projectedCount, 1)
  assert.strictEqual(projection.dedupe.suppressedCount, 1)
  assert.strictEqual(
    projection.links[0].markdown,
    '[Report One](<../../../../reports/Report One.md>)'
  )

  const writes = runServer('mcp/memory-server.js', [
    rpcRequest(3, 'tools/call', {
      name: 'memory_session_write',
      arguments: {
        date: '20260820',
        sessionId: allocation.sessionId,
        sessionBinding: allocation.sessionBinding,
        content: 'artifact-link-session-write\n',
        artifacts: [reportArtifact, duplicateArtifact]
      }
    }),
    rpcRequest(4, 'tools/call', {
      name: 'memory_summary_append',
      arguments: {
        row: '| 2026-08-20 | 01 | fix | artifact links | — | — | 🔄 |',
        reportArtifact: {
          label: 'Report One', targetPath: 'reports/Report One.md', purpose: 'primary report'
        },
        memoryArtifact: {
          label: 'Memory Index', targetPath: 'reports/Memory Index.md', purpose: 'memory index'
        }
      }
    })
  ], projectRoot)
  const sessionReceipt = memoryTransactionJson(resultById(writes, 3))
  assert.strictEqual(sessionReceipt.artifactLinks.dedupe.projectedCount, 1)
  assert.strictEqual(sessionReceipt.artifactLinkReadback.existingValidation.status, 'verified')
  assert.strictEqual(sessionReceipt.localLinkValidation.validation.valid, true)
  const summaryReceipt = memoryTransactionJson(resultById(writes, 4))
  assert.strictEqual(summaryReceipt.artifactLinks.links.length, 2)
  assert.strictEqual(summaryReceipt.artifactLinkReadback.existingValidation.status, 'verified')
  const dailyPath = path.join(activeRoot, dailyDocument)
  const summaryPath = path.join(activeRoot, '.memory', 'clients', 'claude-code', 'SUMMARY.md')
  assert.match(fs.readFileSync(dailyPath, 'utf8'), /\[Report One\]\(<\.\.\/\.\.\/\.\.\/\.\.\/reports\/Report One\.md>\)/)
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /\[Report One\]\(<\.\.\/\.\.\/\.\.\/reports\/Report One\.md>\)/)
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /\[Memory Index\]\(<\.\.\/\.\.\/\.\.\/reports\/Memory Index\.md>\)/)

  const taskRoot = path.join(activeRoot, 'bugs', '链接任务')
  const cpArtifactPath = path.join(taskRoot, '02-技术方案.md')
  fs.mkdirSync(path.join(taskRoot, '.memory'), { recursive: true })
  fs.writeFileSync(cpArtifactPath, '# CP2 artifact\n', 'utf8')
  const cpDigest = crypto.createHash('sha256').update(fs.readFileSync(cpArtifactPath)).digest('hex')
  const cpResult = runServer('mcp/memory-server.js', [
    rpcRequest(5, 'tools/call', {
      name: 'memory_cp_confirm',
      arguments: {
        requirement: '链接任务', kind: 'bugs', phase: 'CP2',
        artifactPath: '02-技术方案.md', artifactVersion: 'v0.1.0',
        artifactSha256: cpDigest, sourceMessage: 'confirm links'
      }
    })
  ], projectRoot)
  const confirmation = resultById(cpResult, 5).structuredContent
  assert.strictEqual(confirmation.artifactLinks.schemaVersion, 'ArtifactLinkProjectionSetV1')
  assert.strictEqual(confirmation.artifactLinkReadback.existingValidation.status, 'verified')
  const cpSessions = fs.readFileSync(path.join(taskRoot, '.memory', 'sessions.md'), 'utf8')
  assert.match(cpSessions, /\[02-技术方案\.md\]\(\.\.\/02-技术方案\.md\)/)
  assert.strictEqual(parseCpSessions(cpSessions).CP2.artifactPath, '02-技术方案.md')

  const validateExisting = runServer('mcp/memory-server.js', [
    rpcRequest(6, 'tools/call', {
      name: 'memory_artifact_link_project',
      arguments: {
        operation: 'validate-existing',
        documentPath: dailyDocument,
        artifacts: [reportArtifact],
        linkCapability: capability
      }
    })
  ], projectRoot)
  assert.strictEqual(toolJson(resultById(validateExisting, 6)).existingValidation.status, 'verified')

  const dailyBeforeRejected = fs.readFileSync(dailyPath, 'utf8')
  const summaryBeforeRejected = fs.readFileSync(summaryPath, 'utf8')
  const invalidCapability = { ...capability, mode: 'failed' }
  const rejected = runServer('mcp/memory-server.js', [
    rpcRequest(10, 'tools/call', {
      name: 'memory_artifact_link_project',
      arguments: {
        documentPath: dailyDocument,
        artifacts: [{ ...reportArtifact, targetPath: 'reports/Missing.md' }],
        linkCapability: capability
      }
    }),
    rpcRequest(11, 'tools/call', {
      name: 'memory_artifact_link_project',
      arguments: { documentPath: dailyDocument, artifacts: [reportArtifact], linkCapability: invalidCapability }
    }),
    rpcRequest(12, 'tools/call', {
      name: 'memory_session_write',
      arguments: {
        date: '20260820', sessionId: allocation.sessionId, sessionBinding: allocation.sessionBinding,
        content: '[broken](../../../../reports/Missing.md)\n'
      }
    }),
    rpcRequest(13, 'tools/call', {
      name: 'memory_summary_append',
      arguments: { row: '| 2026-08-20 | 02 | fix | broken | [missing](../../../reports/Missing.md) | — | 🔄 |' }
    }),
    rpcRequest(14, 'tools/call', {
      name: 'memory_session_write',
      arguments: {
        date: '20260820', sessionId: allocation.sessionId, sessionBinding: allocation.sessionBinding,
        content: '[forbidden](file:///C:/outside.md)\n'
      }
    })
  ], projectRoot)
  for (const id of [10, 11, 12, 13, 14]) assert.strictEqual(resultById(rejected, id).isError, true)
  assert.match(resultById(rejected, 10).content[0].text, /ARTIFACT_LINK_TARGET_INVALID/)
  assert.match(resultById(rejected, 11).content[0].text, /ARTIFACT_LINK_CAPABILITY_INVALID/)
  assert.match(resultById(rejected, 12).content[0].text, /ARTIFACT_LINK_TARGET_MISSING/)
  assert.match(resultById(rejected, 13).content[0].text, /ARTIFACT_LINK_TARGET_MISSING/)
  assert.match(resultById(rejected, 14).content[0].text, /ARTIFACT_LINK_FILE_URI_REJECTED/)
  assert.strictEqual(fs.readFileSync(dailyPath, 'utf8'), dailyBeforeRejected)
  assert.strictEqual(fs.readFileSync(summaryPath, 'utf8'), summaryBeforeRejected)
}

function testMemoryLocalCalendarAndWriterReaderContract() {
  for (const timeZone of ['Pacific/Kiritimati', 'Etc/GMT+12']) {
    setupLegacyWorkspace()
    const day = compactDateInTimeZone(timeZone)
    const allocationResponses = runServer('mcp/memory-server.js', [
      rpcRequest(1, 'tools/call', {
        name: 'memory_session_allocate',
        arguments: { title: `timezone-${timeZone}`, intent: 'other' }
      })
    ], TEMP_ROOT, { TZ: timeZone })
    const allocation = toolJson(resultById(allocationResponses, 1))
    assert.strictEqual(allocation.sessionId, '01')
    const contextBinding = createTestContextBinding(TEMP_ROOT, {
      intent: 'resume',
      env: { TZ: timeZone }
    })

    const responses = runServer('mcp/memory-server.js', bindGovernedContextReads([
      rpcRequest(2, 'tools/call', {
        name: 'memory_session_query',
        arguments: { date: day, status: 'all' }
      }),
      rpcRequest(3, 'tools/call', {
        name: 'memory_session_write',
        arguments: {
          date: day,
          sessionId: allocation.sessionId,
          sessionBinding: allocation.sessionBinding,
          content: '\n状态：✅ 已完成\n'
        }
      }),
      rpcRequest(4, 'tools/call', {
        name: 'memory_session_query',
        arguments: { date: day, status: 'completed' }
      })
    ], contextBinding), TEMP_ROOT, { TZ: timeZone })

    const active = toolJson(resultById(responses, 2))
    assert.strictEqual(active.matches.length, 1)
    assert.strictEqual(active.matches[0].state, 'active')
    assert.match(active.matches[0].content, new RegExp(`\\*\\*时间\\*\\*：${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)} \\d{2}:\\d{2} [+-]\\d{2}:\\d{2}`))
    const completed = toolJson(resultById(responses, 4))
    assert.strictEqual(completed.matches.length, 1)
    assert.strictEqual(completed.matches[0].state, 'completed')
    assert.ok(fs.existsSync(path.join(TEMP_ROOT, '.devcodex', '.memory', 'clients', 'claude-code', 'tasks', `${day}.md`)))
  }

  setupLegacyWorkspace()
  const summaryPath = path.join(TEMP_ROOT, '.devcodex', '.memory', 'clients', 'claude-code', 'SUMMARY.md')
  const validRow = '| 2026-07-22 16:30 | 01 | analyze | valid roundtrip | report.md | memory.md | ✅ |'
  const contextBinding = createTestContextBinding(TEMP_ROOT, { intent: 'resume' })
  const responses = runServer('mcp/memory-server.js', bindGovernedContextReads([
    rpcRequest(10, 'tools/call', { name: 'memory_summary_append', arguments: { row: validRow } }),
    rpcRequest(11, 'tools/call', { name: 'memory_summary_query', arguments: { status: 'completed', since: '2026-07-22' } }),
    rpcRequest(12, 'tools/call', { name: 'memory_summary_append', arguments: { row: '| 2026-07-22 | 02 | malformed |' } }),
    rpcRequest(13, 'tools/call', { name: 'memory_summary_append', arguments: { row: '| 2026-07-22 | 02 | analyze | unescaped | pipe | report | memory | ✅ |' } }),
    // SummaryTypeCanonGate negatives
    rpcRequest(14, 'tools/call', { name: 'memory_summary_append', arguments: { row: '| 2026-07-22 | 03 | ops | should reject | r.md | m.md | ✅ |' } }),
    rpcRequest(15, 'tools/call', { name: 'memory_summary_append', arguments: { row: '| 2026-07-22 | 04 | audit/ECR | should reject | r.md | m.md | ✅ |' } }),
    rpcRequest(16, 'tools/call', { name: 'memory_summary_append', arguments: { row: '| 2026-07-22 | 05 | fix/ledger | should reject | r.md | m.md | ✅ |' } }),
    rpcRequest(17, 'tools/call', { name: 'memory_summary_append', arguments: { row: '| 2026-07-22 | 06 | analyze+fix | compound ok | r.md | m.md | ✅ |' } })
  ], contextBinding), TEMP_ROOT)

  assert.notStrictEqual(resultById(responses, 10).isError, true)
  const summary = toolJson(resultById(responses, 11))
  assert.strictEqual(summary.rows.length, 1)
  assert.strictEqual(summary.rows[0].summary, 'valid roundtrip')
  assert.strictEqual(summary.rows[0].state, 'completed')
  assert.strictEqual(resultById(responses, 12).isError, true)
  assert.strictEqual(resultById(responses, 13).isError, true)
  assert.strictEqual(resultById(responses, 14).isError, true, 'ops must fail SummaryTypeCanon')
  assert.strictEqual(resultById(responses, 15).isError, true, 'slash type must fail')
  assert.strictEqual(resultById(responses, 16).isError, true, 'fix/ledger must fail')
  assert.notStrictEqual(resultById(responses, 17).isError, true, 'analyze+fix must pass')
  assert.strictEqual(fs.readFileSync(summaryPath, 'utf8').split(validRow).length - 1, 1)
  assert.doesNotMatch(fs.readFileSync(summaryPath, 'utf8'), /malformed|unescaped|\| ops \||audit\/ECR|fix\/ledger/)
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /analyze\+fix/)
}

function testMcpJsonLaunchContract() {
  const packageConfig = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8'))
  const packageServers = packageConfig.mcpServers || {}
  const packageExpected = {
    'devcodex-memory': 'mcp/memory-server.js',
    'devcodex-profile': 'mcp/profile-server.js'
  }
  for (const [name, scriptPath] of Object.entries(packageExpected)) {
    const server = packageServers[name]
    assert.ok(server, `package .mcp.json missing ${name}`)
    assert.deepStrictEqual(server.args, [scriptPath, '.'])
    assert.ok(fs.existsSync(path.join(ROOT, scriptPath)), `package MCP script missing: ${scriptPath}`)
    const responses = runConfiguredServer(server, [rpcRequest(88, 'initialize')], ROOT)
    assert.strictEqual(resultById(responses, 88).serverInfo.name, name)
  }

  const targetRoot = setupConfiguredMcpTarget()
  const targetConfig = JSON.parse(fs.readFileSync(path.join(targetRoot, '.mcp.json'), 'utf8'))
  const servers = targetConfig.mcpServers || {}
  const configuredPlanResponses = runConfiguredServer(servers['devcodex-profile'], [
    rpcRequest(89, 'tools/call', {
      name: 'profile_context_plan',
      arguments: { intent: 'chat', contextEpoch: 'configured-optimization-binding' }
    })
  ], targetRoot)
  const configuredAuthorizationPlan = toolJson(resultById(configuredPlanResponses, 89))
  const configuredOptimization = configuredAuthorizationPlan.executionOptimization
  const configuredBinding = configuredAuthorizationPlan.contextBinding
  const expected = {
    'devcodex-memory': '.claude/mcp/memory-server.js',
    'devcodex-profile': '.claude/mcp/profile-server.js'
  }

  for (const [name, scriptPath] of Object.entries(expected)) {
    const server = servers[name]
    assert.ok(server, `.mcp.json missing ${name}`)
    assert.strictEqual(server.command, 'node')
    assert.deepStrictEqual(server.args, [scriptPath, '.'])
    assert.ok(!server.args.some(arg => /\$\{/.test(arg)), `${name} args must not require shell expansion`)

    const requests = [rpcRequest(90, 'initialize')]
    if (name === 'devcodex-profile') {
      requests.push(
        rpcRequest(91, 'tools/list'),
        rpcRequest(92, 'tools/call', {
          name: 'profile_context_plan',
          arguments: { intent: 'chat', contextEpoch: 'configured-target-plan' }
        }),
        rpcRequest(93, 'tools/call', {
          name: 'profile_skill_plan',
          arguments: {
            candidateIds: ['intent'],
            maxBytes: 100000,
            executionOptimization: configuredOptimization,
            contextBinding: configuredBinding
          }
        })
      )
    } else {
      requests.push(
        rpcRequest(91, 'tools/list'),
        rpcRequest(92, 'tools/call', {
          name: 'memory_status',
          arguments: { contextBinding: configuredBinding }
        })
      )
    }
    const responses = runConfiguredServer(server, requests, targetRoot)
    assert.strictEqual(resultById(responses, 90).serverInfo.name, name)
    if (name === 'devcodex-profile') {
      assert(resultById(responses, 91).tools.some(tool => tool.name === 'profile_context_plan'))
      assert(resultById(responses, 91).tools.some(tool => tool.name === 'profile_skill_plan'))
      const configuredPlan = toolJson(resultById(responses, 92))
      assert.strictEqual(validateContextReadPlan(configuredPlan).valid, true)
      assert.strictEqual(configuredPlan.identity.project, 'configured-target')
      const configuredBundle = toolJson(resultById(responses, 93))
      assert.strictEqual(configuredBundle.schemaVersion, 'BundleDecisionV2')
      assert.strictEqual(configuredBundle.completion, 'complete')
    } else {
      assert(resultById(responses, 91).tools.some(tool => tool.name === 'memory_status'))
      assert(resultById(responses, 91).tools.some(tool => tool.name === 'memory_task_resolve'))
      const configuredStatus = toolJson(resultById(responses, 92))
      assert.strictEqual(configuredStatus.schemaVersion, 'MemoryStatusV1')
      assert.strictEqual(configuredStatus.project, 'configured-target')
      assert.strictEqual(configuredStatus.activeRoot, path.join(targetRoot, '.devcodex'))
    }
  }
}

testProfilePrompts()
testProfilePromptRequiresProjectAtWorkspaceRoot()
testMissingProfileRecoveryUsesCanonicalInitCommand()
testProfileTierConflictRejected()
testProfileModeFallbackAgent()
testProfileAgentUsesRuntimeBeforeProfileFallback()
testMemoryDefaultAgent()
testMemoryTaskResolveContract()
testMemoryTaskAdmissionV2Contract()
testMemoryFinalizedFreshResumeV3Contract()
testMemoryWorkflowOperationalWriteLeaseContract()
testMemorySimpleTaskFastPathLeaseContract()
testMemoryTaskOwnerAndTerminalV1Contract()
testMemoryArtifactMutationReconciliationContract()
testMemoryServerOwnedTakeoverObservation()
testMemoryCloseoutReconcileUsesTerminalOwnerRoute()
testMemoryActualHostEnvAgent()
testMemoryCpConfirmForBugs()
testMemoryCpConfirmForExtendedTaskKinds()
testMemoryCpConfirmRejectsArtifactPathEscape()
testMemoryCpConfirmPreservesOrdinaryTables()
testMemoryCpConfirmGenericSessionIndexWithoutCpSection()
testMemoryProjectionQueriesAndZeroWrite()
testMemoryProjectionErrorsAndMalformedSources()
testMemoryProjectionLayoutTargets()
testAgentIdentitySharedModule()
testMemoryProjectionAgentAmbiguity()
testGrokAgentMemoryWrite()
testWorkspaceNamespaceProfileMerge()
testWorkspaceNamespaceInvalidProfileFailsClosed()
testProfileLoadWithoutArguments()
testContextReadBindingContract()
testContextReadAuthorizationNegativePaths()
testBoundedGovernedSourceReads()
testProfileMultiHeadingBoundedSelection()
testDevCodexBoundedRouteRecipe()
testProfileSectionSelectorsAndSkillPlan()
testProfileContextPlanContract()
testProfileContextPlanConditionalSelectors()
testProfileContextPlanLocalPolicyAndFullEscalation()
testProfileContextPlanReadTrace()
testWorkspaceNamespaceMemoryScope()
testWorkspaceProfileContextReads()
testWorkspaceRootMemoryScopeRequiresExplicitTarget()
testWorkspaceNamespaceNestedProjectInference()
testWorkspaceNamespaceTraversalRejected()
testMemorySessionAllocationAndTransactions()
testMemoryArtifactLinkProjectionAndWriterIntegration()
testMemoryLocalCalendarAndWriterReaderContract()
testAdjacentMcpPathArgumentsRejected()
testMcpJsonLaunchContract()
require('./test-v1178-batch-d.js')
if (process.env.DEVCODEX_KEEP_TEST_ARTIFACTS === '1') {
  console.log(`MCP test artifacts retained: ${TEMP_ROOT}`)
} else {
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
}
process.stdout.write('mcp servers smoke test passed\n')
