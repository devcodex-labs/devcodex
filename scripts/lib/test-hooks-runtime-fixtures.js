'use strict'

function buildTestHooksRuntimeFixtures({
  fs,
  path,
  process,
  spawnSync,
  RUNTIME,
  TEMP_ROOT,
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

  function runBootstrapReads(agent = TEST_AGENT) {
    run({
      hookEventName: 'PreToolUse',
      tool_name: 'read_file',
      tool_input: { filePath: '.devcodex/profile/config.json' }
    })
    run({
      hookEventName: 'PreToolUse',
      tool_name: 'read_file',
      tool_input: { filePath: getMemoryFilePath(agent, 'SUMMARY.md') }
    })
    run({
      hookEventName: 'PreToolUse',
      tool_name: 'read_file',
      tool_input: { filePath: getMemoryFilePath(agent, 'tasks', `${getTaskStamp(0)}.md`) }
    })
  }

  function runLayoutBootstrapReads(agent = TEST_AGENT, cwd = path.join(TEMP_ROOT, 'chat')) {
    run({
      hookEventName: 'PreToolUse',
      tool_name: 'read_file',
      tool_input: { filePath: '../.devcodex/workspace/profile/config.json' }
    }, cwd)
    run({
      hookEventName: 'PreToolUse',
      tool_name: 'read_file',
      tool_input: { filePath: path.posix.join('..', '.devcodex', 'chat', '.memory', 'clients', agent, 'SUMMARY.md') }
    }, cwd)
    run({
      hookEventName: 'PreToolUse',
      tool_name: 'read_file',
      tool_input: { filePath: path.posix.join('..', '.devcodex', 'chat', '.memory', 'clients', agent, 'tasks', `${getTaskStamp(0)}.md`) }
    }, cwd)
  }

  function cleanState(profileConfig = { mode: 'dev', agent: TEST_AGENT }) {
    if (fs.existsSync(TEMP_ROOT)) {
      fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
    }
    fs.mkdirSync(path.join(TEMP_ROOT, '.devcodex', 'profile'), { recursive: true })
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
