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
    return path.join(TEMP_ROOT, '.devcodex', project, '.memory', 'hooks', project, 'captured-final-payloads.ndjson')
  }

  function getWorkspaceLayoutStateFile() {
    return path.join(TEMP_ROOT, '.devcodex', 'workspace', '.memory', 'hooks', 'workspace', 'lifecycle-state.json')
  }

  function run(payload, cwd = TEMP_ROOT, env = {}) {
    const result = spawnSync(process.execPath, [RUNTIME], {
      cwd,
      input: JSON.stringify(payload),
      encoding: 'utf8',
      env: { ...process.env, ...env }
    })

    if (result.status !== 0) {
      throw new Error((result.stderr || result.stdout || 'runtime exited with failure').trim())
    }

    return JSON.parse(result.stdout || '{}')
  }

  function callProfileTool(cwd, name, args) {
    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args }
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
        telemetry: { bytes: 0, chars: 0, latencyMs: 0, tokens: null }
      }
    }, cwd)
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
    fs.mkdirSync(path.join(TEMP_ROOT, 'devcodex-v1'), { recursive: true })
    fs.mkdirSync(path.join(TEMP_ROOT, 'payment'), { recursive: true })
    fs.writeFileSync(path.join(TEMP_ROOT, 'devcodex-v1', 'package.json'), '{}')
    fs.writeFileSync(path.join(TEMP_ROOT, 'payment', 'package.json'), '{}')
  }

  function cleanLayoutMultiProjectState({ workspaceProfile = false } = {}) {
    if (fs.existsSync(TEMP_ROOT)) {
      fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
    }
    fs.mkdirSync(path.join(TEMP_ROOT, 'devcodex-v1'), { recursive: true })
    fs.mkdirSync(path.join(TEMP_ROOT, 'payment'), { recursive: true })
    fs.mkdirSync(path.join(TEMP_ROOT, 'user'), { recursive: true })
    fs.mkdirSync(path.join(TEMP_ROOT, 'vext'), { recursive: true })
    fs.mkdirSync(path.join(TEMP_ROOT, 'vext-test'), { recursive: true })
    fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'devcodex-v1', 'profile'), { recursive: true })
    fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'payment', 'profile'), { recursive: true })
    fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'user', 'profile'), { recursive: true })
    fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'vext', 'profile'), { recursive: true })
    fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'vext-test', 'profile'), { recursive: true })
    fs.writeFileSync(path.join(TEMP_ROOT, 'devcodex-v1', 'package.json'), '{}')
    fs.writeFileSync(path.join(TEMP_ROOT, 'payment', 'package.json'), '{}')
    fs.writeFileSync(path.join(TEMP_ROOT, 'user', 'package.json'), '{}')
    fs.writeFileSync(path.join(TEMP_ROOT, 'vext', 'package.json'), '{}')
    fs.writeFileSync(path.join(TEMP_ROOT, 'vext-test', 'package.json'), '{}')
    fs.writeFileSync(
      path.join(TEMP_ROOT, '.devcodex', 'layout.json'),
      JSON.stringify({ version: 1, mode: 'workspace-namespace' })
    )
    fs.writeFileSync(
      path.join(TEMP_ROOT, '.devcodex', 'devcodex-v1', 'profile', 'config.json'),
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
    if (!fs.existsSync(path.join(TEMP_ROOT, '.devcodex', '.memory', 'hooks', 'legacy', 'interceptions.jsonl'))) return []
    return fs.readFileSync(path.join(TEMP_ROOT, '.devcodex', '.memory', 'hooks', 'legacy', 'interceptions.jsonl'), 'utf8')
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line))
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
