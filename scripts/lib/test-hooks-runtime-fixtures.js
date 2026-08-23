'use strict'

function buildTestHooksRuntimeFixtures({
  fs,
  path,
  process,
  spawnSync,
  RUNTIME,
  PROFILE_SERVER,
  TEMP_ROOT,
  STATE_FILE,
  TEST_AGENT
}) {
  function formatDateStamp(date) {
    const year = String(date.getFullYear())
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}${month}${day}`
  }

  function getTaskStamp(dayOffset) {
    const date = new Date()
    date.setDate(date.getDate() + dayOffset)
    return formatDateStamp(date)
  }

  function getMemoryFilePath(agent, ...segments) {
    return path.posix.join('.devcodex', '.memory', 'clients', agent, ...segments)
  }

  function getLayoutStateFile(project = 'chat') {
    return path.join(TEMP_ROOT, '.devcodex', project, '.memory', 'hooks', project, 'lifecycle-state.json')
  }

  function getLayoutCaptureLog(project = 'chat') {
    return path.join(TEMP_ROOT, '.devcodex', project, '.memory', 'hooks', project, 'v5', 'telemetry-0.ndjson')
  }

  function getWorkspaceLayoutStateFile() {
    return path.join(TEMP_ROOT, '.devcodex', 'workspace', '.memory', 'hooks', 'workspace', 'lifecycle-state.json')
  }

  function fixtureToolName(rawName) {
    const lower = String(rawName || '').toLowerCase()
    const claude = lower.match(/^mcp__[^_]+(?:-[^_]+)*__([a-z0-9_]+)$/)
    const pair = lower.match(/^[^/]+\/([a-z0-9_]+)$/)
    return claude?.[1] || pair?.[1] || lower
  }

  function plannedContextBinding(cwd) {
    try {
      const statePath = getRuntimeStatePath(cwd)
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      const plan = state?.contextAcquisition?.plan
      if (!plan) return null
      return {
        schemaVersion: 'ContextReadBindingV1',
        contextEpoch: plan.identity.contextEpoch,
        planId: plan.planId,
        planContentId: plan.planContentId,
        activeRoot: plan.identity.activeRoot,
        project: plan.identity.project
      }
    } catch {
      return null
    }
  }

  function bindFixtureArgs(name, args, cwd, mode) {
    const tool = fixtureToolName(name)
    const planBoundTools = new Set([
      'profile_load', 'profile_skill_plan', 'memory_status', 'memory_session_query', 'memory_summary_query'
    ])
    if (mode === 'omit' || !planBoundTools.has(tool) || args?.contextBinding !== undefined) return args
    const binding = plannedContextBinding(cwd)
    return binding ? { ...(args || {}), contextBinding: binding } : args
  }

  function bindFixtureResult(name, value, cwd, mode) {
    const tool = fixtureToolName(name)
    if (mode === 'omit' || !['memory_status', 'memory_session_query', 'memory_summary_query'].includes(tool) ||
        !value || typeof value !== 'object' || Array.isArray(value) || value.content || value.contextBinding !== undefined) return value
    const binding = plannedContextBinding(cwd)
    return binding
      ? { ...value, contextBinding: { ...binding, bindingStatus: 'verified', verificationMode: 'request-bound' } }
      : value
  }

  function prepareFixturePayload(payload, cwd) {
    const mode = payload?.fixtureContextBinding
    const prepared = { ...(payload || {}) }
    delete prepared.fixtureContextBinding
    const inputKey = ['tool_input', 'toolInput', 'input', 'arguments']
      .find(key => Object.prototype.hasOwnProperty.call(prepared, key))
    if (inputKey && prepared[inputKey] && typeof prepared[inputKey] === 'object' && !Array.isArray(prepared[inputKey])) {
      prepared[inputKey] = bindFixtureArgs(prepared.tool_name || prepared.toolName, prepared[inputKey], cwd, mode)
    }
    const resultKey = ['tool_result', 'tool_response', 'toolResult', 'toolResponse']
      .find(key => Object.prototype.hasOwnProperty.call(prepared, key))
    if (resultKey) {
      prepared[resultKey] = bindFixtureResult(
        prepared.tool_name || prepared.toolName,
        prepared[resultKey],
        cwd,
        mode
      )
    }
    return prepared
  }

  function run(payload, cwd = TEMP_ROOT, env = {}) {
    // Neutralize ambient host signals (e.g. developer GROK_AGENT) so bootstrap agent
    // matches fixture paths under clients/claude-code unless a test overrides env.
    const mergedEnv = {
      ...process.env,
      GROK_AGENT: '',
      GROK_HOME: '',
      GROK_SESSION: '',
      GROK_SESSION_ID: '',
      GROK_BUILD: '',
      XAI_GROK: '',
      XAI_AGENT: '',
      DEVCODEX_TASK_RECOVERY_TEST_MODE: '1',
      DEVCODEX_TASK_RECOVERY_TEST_RESERVE_BYTES: '8192',
      ...env
    }
    const preparedPayload = prepareFixturePayload(payload, cwd)
    const result = spawnSync(process.execPath, [RUNTIME], {
      cwd,
      input: JSON.stringify(preparedPayload),
      encoding: 'utf8',
      env: mergedEnv
    })

    if (result.status !== 0) {
      throw new Error((result.stderr || result.stdout || 'runtime exited with failure').trim())
    }

    return JSON.parse(result.stdout || '{}')
  }

  function callProfileTool(cwd, name, args) {
    const boundArgs = bindFixtureArgs(name, args, cwd)
    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: boundArgs }
    }
    const result = spawnSync(process.execPath, [PROFILE_SERVER, cwd], {
      cwd,
      input: `${JSON.stringify(request)}\n`,
      encoding: 'utf8',
      env: { ...process.env, DEVCODEX_AGENT: 'claude-code' }
    })
    if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'profile MCP failed').trim())
    const response = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))[0]
    if (!response?.result) throw new Error(`profile MCP returned no result: ${result.stdout}`)
    return response.result
  }

  function parseSkillRouteResult(result) {
    const text = result?.content?.find(item => item?.type === 'text')?.text
    if (!text) throw new Error('skill_route returned no text result')
    const parsed = JSON.parse(text)
    if (parsed.ok !== true) throw new Error(`skill_route failed: ${JSON.stringify(parsed)}`)
    return parsed
  }

  function getRuntimeStatePath(cwd) {
    const layoutPath = path.join(TEMP_ROOT, '.devcodex', 'layout.json')
    if (!fs.existsSync(layoutPath)) return STATE_FILE
    const project = path.relative(TEMP_ROOT, cwd).replace(/\\/g, '/') || 'chat'
    return getLayoutStateFile(project)
  }

  function runStructuredContext(agent, cwd) {
    const statePath = getRuntimeStatePath(cwd)
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    const planArgs = {
      intent: 'chat',
      contextEpoch: state.contextAcquisition.contextEpoch,
      ...(state.contextAcquisition.project ? { project: state.contextAcquisition.project } : {})
    }
    const planCallId = `plan-${state.contextAcquisition.contextEpoch}`
    run({
      hookEventName: 'PreToolUse',
      tool_use_id: planCallId,
      tool_name: 'devcodex-profile/profile_context_plan',
      tool_input: planArgs
    }, cwd)
    const planResult = callProfileTool(cwd, 'profile_context_plan', planArgs)
    run({
      hookEventName: 'PostToolUse',
      tool_use_id: planCallId,
      tool_name: 'devcodex-profile/profile_context_plan',
      tool_input: planArgs,
      tool_response: planResult
    }, cwd)

    const plannedState = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    const memoryArgs = {
      agent,
      ...(plannedState.contextAcquisition.project ? { project: plannedState.contextAcquisition.project } : {})
    }
    const memoryCallId = `memory-${plannedState.contextAcquisition.contextEpoch}`
    run({
      hookEventName: 'PreToolUse',
      tool_use_id: memoryCallId,
      tool_name: 'devcodex-memory/memory_status',
      tool_input: memoryArgs
    }, cwd)
    run({
      hookEventName: 'PostToolUse',
      tool_use_id: memoryCallId,
      tool_name: 'devcodex-memory/memory_status',
      tool_input: memoryArgs,
      tool_result: {
        schemaVersion: 'MemoryStatusV1',
        activeRoot: plannedState.contextAcquisition.activeRoot,
        project: plannedState.contextAcquisition.project,
        agent,
        today: getTaskStamp(0),
        yesterday: getTaskStamp(-1),
        summary: { exists: false },
        latestRows: [],
        activeSessionIds: [],
        conflicts: [],
        coverage: { status: 'complete' },
        telemetry: { bytes: 0, chars: 0, latencyMs: 0, tokens: null }
      }
    }, cwd)

    const readyState = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    const bootstrap = readyState.progressiveSkillRoute?.bootstrap
    if (!bootstrap) throw new Error('structured bootstrap did not emit SkillRouteBootstrapV1')
    const layoutEnabled = fs.existsSync(path.join(TEMP_ROOT, '.devcodex', 'layout.json'))
    const routeLifecycleStatePath = path.join(
      readyState.contextAcquisition.activeRoot,
      '.memory',
      'hooks',
      layoutEnabled ? readyState.contextAcquisition.project : '__workspace__',
      'lifecycle-state.json'
    )
    if (path.resolve(routeLifecycleStatePath) !== path.resolve(statePath)) {
      fs.mkdirSync(path.dirname(routeLifecycleStatePath), { recursive: true })
      fs.writeFileSync(routeLifecycleStatePath, `${JSON.stringify(readyState, null, 2)}\n`)
    }

    let catalogCursor = null
    do {
      const catalog = parseSkillRouteResult(callProfileTool(cwd, 'skill_route', {
        op: 'catalog',
        project: bootstrap.project,
        turnBinding: bootstrap.turnBinding,
        contextEpoch: bootstrap.contextEpoch,
        ...(catalogCursor ? { cursor: catalogCursor } : {})
      }))
      catalogCursor = catalog.receipt.nextCursor
    } while (catalogCursor)

    const commit = parseSkillRouteResult(callProfileTool(cwd, 'skill_route', {
      op: 'commit',
      project: bootstrap.project,
      turnBinding: bootstrap.turnBinding,
      contextEpoch: bootstrap.contextEpoch,
      catalogDigest: bootstrap.catalogDigest,
      skillId: null,
      contextBinding: plannedContextBinding(cwd)
    }))
    for (const stageId of commit.receipt.obligations.requiredStageIds) {
      let stageCursor = null
      do {
        const stage = parseSkillRouteResult(callProfileTool(cwd, 'skill_route', {
          op: 'load_stage',
          project: bootstrap.project,
          turnBinding: bootstrap.turnBinding,
          contextEpoch: bootstrap.contextEpoch,
          generation: commit.receipt.plan.generation,
          planDigest: commit.receipt.plan.planDigest,
          stageId,
          triggerRef: `hooks-runtime:${stageId}`,
          ...(stageCursor ? { cursor: stageCursor } : {})
        }))
        stageCursor = stage.receipt.nextCursor
      } while (stageCursor)
    }
  }

  function runBootstrapReads(agent = TEST_AGENT) {
    runStructuredContext(agent, TEMP_ROOT)
  }

  function runLayoutBootstrapReads(agent = TEST_AGENT, cwd = path.join(TEMP_ROOT, 'chat')) {
    runStructuredContext(agent, cwd)
  }

  function writeProfileFixture(profileDir) {
    fs.mkdirSync(profileDir, { recursive: true })
    fs.writeFileSync(path.join(profileDir, 'README.md'), [
      '# Test Profile',
      '',
      '> Profile 档位：`profile-lite`。',
      '',
      '| 文件 | 说明 | 必须 |',
      '|------|------|:----:|',
      '| `01-项目信息.md` | test project | 是 |',
      '| `02-架构约束.md` | test architecture | 是 |',
      '| `03-代码风格.md` | test style | 是 |',
      ''
    ].join('\n'))
    for (const file of ['01-项目信息.md', '02-架构约束.md', '03-代码风格.md']) {
      fs.writeFileSync(path.join(profileDir, file), `# ${file}\n\nTEST-PROFILE-BODY\n\n### Normal document subsection\n`)
    }
  }

  function cleanState(profileConfig = { mode: 'dev', agent: TEST_AGENT }) {
    if (fs.existsSync(TEMP_ROOT)) {
      fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
    }
    fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'profile'), { recursive: true })
    fs.writeFileSync(path.join(TEMP_ROOT, 'package.json'), '{}')
    writeProfileFixture(path.join(TEMP_ROOT, '.devcodex', 'profile'))
    fs.writeFileSync(
      path.join(TEMP_ROOT, '.devcodex', 'profile', 'config.json'),
      JSON.stringify(profileConfig)
    )
  }

  function cleanLayoutState(
    workspaceProfileConfig = { mode: 'prod', agent: TEST_AGENT },
    projectProfileConfig = { mode: 'dev' }
  ) {
    if (fs.existsSync(TEMP_ROOT)) {
      fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
    }
    fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'workspace', 'profile'), { recursive: true })
    fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'chat', 'profile'), { recursive: true })
    fs.mkdirSync(path.join(TEMP_ROOT, 'chat'), { recursive: true })
    fs.writeFileSync(path.join(TEMP_ROOT, 'chat', 'package.json'), '{}')
    writeProfileFixture(path.join(TEMP_ROOT, '.devcodex', 'workspace', 'profile'))
    fs.writeFileSync(
      path.join(TEMP_ROOT, '.devcodex', 'layout.json'),
      JSON.stringify({ version: 1, mode: 'workspace-namespace' })
    )
    fs.writeFileSync(
      path.join(TEMP_ROOT, '.devcodex', 'workspace', 'profile', 'config.json'),
      JSON.stringify(workspaceProfileConfig)
    )
    fs.writeFileSync(
      path.join(TEMP_ROOT, '.devcodex', 'chat', 'profile', 'config.json'),
      JSON.stringify(projectProfileConfig)
    )
  }

  function cleanMultiProjectState() {
    if (fs.existsSync(TEMP_ROOT)) {
      fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
    }
    fs.mkdirSync(path.join(TEMP_ROOT, 'devcodex'), { recursive: true })
    fs.mkdirSync(path.join(TEMP_ROOT, 'payment'), { recursive: true })
    fs.writeFileSync(path.join(TEMP_ROOT, 'devcodex', 'package.json'), '{}')
    fs.writeFileSync(path.join(TEMP_ROOT, 'payment', 'package.json'), '{}')
  }

  function cleanLayoutMultiProjectState({ workspaceProfile = false } = {}) {
    if (fs.existsSync(TEMP_ROOT)) {
      fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
    }
    fs.mkdirSync(path.join(TEMP_ROOT, 'devcodex'), { recursive: true })
    fs.mkdirSync(path.join(TEMP_ROOT, 'payment'), { recursive: true })
    fs.mkdirSync(path.join(TEMP_ROOT, 'user'), { recursive: true })
    fs.mkdirSync(path.join(TEMP_ROOT, 'vext'), { recursive: true })
    fs.mkdirSync(path.join(TEMP_ROOT, 'vext-test'), { recursive: true })
    fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'devcodex', 'profile'), { recursive: true })
    fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'payment', 'profile'), { recursive: true })
    fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'user', 'profile'), { recursive: true })
    fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'vext', 'profile'), { recursive: true })
    fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'vext-test', 'profile'), { recursive: true })
    fs.writeFileSync(path.join(TEMP_ROOT, 'devcodex', 'package.json'), '{}')
    fs.writeFileSync(path.join(TEMP_ROOT, 'payment', 'package.json'), '{}')
    fs.writeFileSync(path.join(TEMP_ROOT, 'user', 'package.json'), '{}')
    fs.writeFileSync(path.join(TEMP_ROOT, 'vext', 'package.json'), '{}')
    fs.writeFileSync(path.join(TEMP_ROOT, 'vext-test', 'package.json'), '{}')
    fs.writeFileSync(
      path.join(TEMP_ROOT, '.devcodex', 'layout.json'),
      JSON.stringify({ version: 1, mode: 'workspace-namespace' })
    )
    fs.writeFileSync(
      path.join(TEMP_ROOT, '.devcodex', 'devcodex', 'profile', 'config.json'),
      JSON.stringify({ mode: 'dev', agent: TEST_AGENT })
    )
    fs.writeFileSync(
      path.join(TEMP_ROOT, '.devcodex', 'payment', 'profile', 'config.json'),
      JSON.stringify({ mode: 'prod', agent: TEST_AGENT })
    )
    fs.writeFileSync(
      path.join(TEMP_ROOT, '.devcodex', 'user', 'profile', 'config.json'),
      JSON.stringify({ mode: 'prod', agent: TEST_AGENT })
    )
    fs.writeFileSync(
      path.join(TEMP_ROOT, '.devcodex', 'vext', 'profile', 'config.json'),
      JSON.stringify({ mode: 'prod', agent: TEST_AGENT })
    )
    fs.writeFileSync(
      path.join(TEMP_ROOT, '.devcodex', 'vext-test', 'profile', 'config.json'),
      JSON.stringify({ mode: 'dev', agent: TEST_AGENT })
    )
    if (workspaceProfile) {
      fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'workspace', 'profile'), { recursive: true })
      fs.writeFileSync(
        path.join(TEMP_ROOT, '.devcodex', 'workspace', 'profile', 'config.json'),
        JSON.stringify({ mode: 'prod', agent: TEST_AGENT })
      )
    }
  }

  function cleanNestedLayoutMultiProjectState({ workspaceProfile = false } = {}) {
    if (fs.existsSync(TEMP_ROOT)) {
      fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
    }
    fs.mkdirSync(path.join(TEMP_ROOT, 'packages', 'app-a'), { recursive: true })
    fs.mkdirSync(path.join(TEMP_ROOT, 'packages', 'app-b'), { recursive: true })
    fs.mkdirSync(path.join(TEMP_ROOT, 'tools'), { recursive: true })
    fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'packages', 'app-a', 'profile'), { recursive: true })
    fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'packages', 'app-b', 'profile'), { recursive: true })
    fs.writeFileSync(path.join(TEMP_ROOT, 'packages', 'package.json'), '{}')
    fs.writeFileSync(path.join(TEMP_ROOT, 'packages', 'app-a', 'package.json'), '{}')
    fs.writeFileSync(path.join(TEMP_ROOT, 'packages', 'app-b', 'package.json'), '{}')
    fs.writeFileSync(path.join(TEMP_ROOT, 'tools', 'package.json'), '{}')
    fs.writeFileSync(
      path.join(TEMP_ROOT, '.devcodex', 'layout.json'),
      JSON.stringify({ version: 1, mode: 'workspace-namespace' })
    )
    fs.writeFileSync(
      path.join(TEMP_ROOT, '.devcodex', 'packages', 'app-a', 'profile', 'config.json'),
      JSON.stringify({ mode: 'dev', agent: TEST_AGENT })
    )
    fs.writeFileSync(
      path.join(TEMP_ROOT, '.devcodex', 'packages', 'app-b', 'profile', 'config.json'),
      JSON.stringify({ mode: 'prod', agent: TEST_AGENT })
    )
    if (workspaceProfile) {
      fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'workspace', 'profile'), { recursive: true })
      fs.writeFileSync(
        path.join(TEMP_ROOT, '.devcodex', 'workspace', 'profile', 'config.json'),
        JSON.stringify({ mode: 'prod', agent: TEST_AGENT })
      )
    }
  }

  function cleanToolingSiblingState() {
    if (fs.existsSync(TEMP_ROOT)) {
      fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
    }
    fs.mkdirSync(path.join(TEMP_ROOT, 'app'), { recursive: true })
    fs.mkdirSync(path.join(TEMP_ROOT, 'tools'), { recursive: true })
    fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'app', 'profile'), { recursive: true })
    fs.writeFileSync(path.join(TEMP_ROOT, 'app', 'package.json'), '{}')
    fs.writeFileSync(path.join(TEMP_ROOT, 'tools', 'package.json'), '{}')
    fs.writeFileSync(
      path.join(TEMP_ROOT, '.devcodex', 'layout.json'),
      JSON.stringify({ version: 1, mode: 'workspace-namespace' })
    )
    fs.writeFileSync(
      path.join(TEMP_ROOT, '.devcodex', 'app', 'profile', 'config.json'),
      JSON.stringify({ mode: 'dev', agent: TEST_AGENT })
    )
  }

  function readInterceptionEntries() {
    const telemetryRoot = path.join(TEMP_ROOT, '.devcodex', '.memory', 'hooks', 'legacy', 'v5')
    return [0, 1, 2, 3]
      .map(index => path.join(telemetryRoot, `telemetry-${index}.ndjson`))
      .filter(file => fs.existsSync(file))
      .flatMap(file => fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)))
      .filter(entry => entry.recordType === 'interception')
  }

  function writeTranscript(fileName, assistantContent) {
    const transcriptPath = path.join(TEMP_ROOT, fileName)
    const entries = [
      { type: 'user.message', data: { content: 'trigger prompt' } },
      { type: 'assistant.message', data: { content: assistantContent } }
    ]
    fs.writeFileSync(transcriptPath, entries.map(entry => JSON.stringify(entry)).join('\n'))
    return transcriptPath
  }

  function writeTranscriptEntries(fileName, entries) {
    const transcriptPath = path.join(TEMP_ROOT, fileName)
    fs.writeFileSync(transcriptPath, entries.map(entry => JSON.stringify(entry)).join('\n'))
    return transcriptPath
  }

  return {
    getTaskStamp,
    getMemoryFilePath,
    getLayoutStateFile,
    getLayoutCaptureLog,
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
}

module.exports = { buildTestHooksRuntimeFixtures }
