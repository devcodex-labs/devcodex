#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const RUNTIME = path.join(ROOT, 'hooks', '_runtime', 'lifecycle.cjs')

// Use a temp directory as the workspace root to isolate from real requirements
const TEMP_ROOT = path.join(os.tmpdir(), `devcodex-hooks-test-${process.pid}`)
const STATE_DIR = path.join(TEMP_ROOT, '.devcodex', '.memory', 'hooks', 'legacy')
const STATE_FILE = path.join(STATE_DIR, 'lifecycle-state.json')
const CAPTURE_FLAG = path.join(STATE_DIR, 'capture-final-payload.flag')
const CAPTURE_LOG = path.join(STATE_DIR, 'captured-final-payloads.ndjson')
const INTERCEPTION_LOG = path.join(STATE_DIR, 'interceptions.jsonl')
const TEST_AGENT = 'claude-code'
const FALLBACK_BOOTSTRAP_AGENT = (() => {
  if (process.env.CLAUDE_CODE_VERSION || process.env.CLAUDE_HOOK_COMMAND) return 'claude-code'
  if (process.env.IDEA_INITIAL_DIRECTORY || process.env.JETBRAINS_IDE) return 'jetbrains-copilot'
  if (process.env.TERM_PROGRAM === 'vscode' || process.env.VSCODE_PID) return 'vscode-copilot'
  return 'copilot'
})()
const WRONG_FALLBACK_AGENT = FALLBACK_BOOTSTRAP_AGENT === 'claude-code' ? 'copilot' : 'claude-code'

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
  // Bootstrap the temp workspace with a dev-mode profile
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

function readInterceptionEntries() {
  if (!fs.existsSync(INTERCEPTION_LOG)) return []
  return fs.readFileSync(INTERCEPTION_LOG, 'utf8')
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

function main() {
  cleanMultiProjectState()
  const multiProjectPromptWarning = run({
    hookEventName: 'UserPromptSubmit',
    prompt: '这个项目继续'
  })
  assert.strictEqual(multiProjectPromptWarning.continue, true)
  assert.match(multiProjectPromptWarning.systemMessage || '', /multi-project-workspace/)
  assert.strictEqual(multiProjectPromptWarning.hookSpecificOutput?.hookEventName, 'UserPromptSubmit')
  assert.match(multiProjectPromptWarning.hookSpecificOutput?.additionalContext || '', /Multi-project workspace|多项目|目标项目/)

  cleanState()

  const promptOutput = run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Need a root cure for dev mode drift.'
  })
  assert.strictEqual(promptOutput.continue, true)
  assert.match(promptOutput.systemMessage || '', /PC0-PC7/)
  assert.match(promptOutput.systemMessage || '', /entry check/)
  assert.strictEqual(promptOutput.hookSpecificOutput?.hookEventName, 'UserPromptSubmit')
  assert.match(promptOutput.hookSpecificOutput?.additionalContext || '', /PC0-PC7/)
  assert.match(promptOutput.hookSpecificOutput?.additionalContext || '', /entry check/)

  const warningBeforeBootstrap = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: README.md\n*** End Patch'
    }
  })
  assert.strictEqual(warningBeforeBootstrap.continue, true)
  assert.match(warningBeforeBootstrap.systemMessage || '', /bootstrap/i)

  const duplicateWarningBeforeBootstrap = run({
    hookEventName: 'PreToolUse',
    tool_name: 'run_in_terminal',
    tool_input: { command: 'npm test' }
  })
  assert.strictEqual(duplicateWarningBeforeBootstrap.continue, true)
  assert.ok(!duplicateWarningBeforeBootstrap.systemMessage)

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'strict bootstrap gate test'
  }, TEMP_ROOT, { DEVCODEX_HOOK_ENFORCEMENT: 'strict' })
  const blockedBeforeBootstrap = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: README.md\n*** End Patch'
    }
  }, TEMP_ROOT, { DEVCODEX_HOOK_ENFORCEMENT: 'strict' })
  assert.strictEqual(blockedBeforeBootstrap.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(blockedBeforeBootstrap.hookSpecificOutput.permissionDecisionReason || '', /bootstrap/i)

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Need a root cure for dev mode drift.'
  })

  const sourceReadAllowedDuringBootstrap = run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: {
      filePath: 'package.json'
    }
  })
  assert.strictEqual(sourceReadAllowedDuringBootstrap.continue, true)

  const questionAllowedDuringBootstrap = run({
    hookEventName: 'PreToolUse',
    tool_name: 'vscode_askQuestions',
    tool_input: {
      questions: [{ header: '目标项目', question: '审查哪个项目？' }]
    }
  })
  assert.strictEqual(questionAllowedDuringBootstrap.continue, true)

  const shellReadAllowedDuringBootstrap = run({
    hookEventName: 'PreToolUse',
    tool_name: 'shell_command',
    tool_input: {
      command: 'Get-Content .devcodex/profile/config.json'
    }
  })
  assert.strictEqual(shellReadAllowedDuringBootstrap.continue, true)

  cleanState({ mode: 'prod', agent: TEST_AGENT })
  const prodPromptOutput = run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Explain current workflow.'
  })
  assert.strictEqual(prodPromptOutput.continue, true)
  assert.match(prodPromptOutput.systemMessage || '', /entry check PC0-PC7/)
  const prodWriteWarningBeforeBootstrap = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: README.md\n*** End Patch'
    }
  })
  assert.strictEqual(prodWriteWarningBeforeBootstrap.continue, true)
  assert.match(prodWriteWarningBeforeBootstrap.systemMessage || '', /bootstrap/i)

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Need a root cure for dev mode drift.'
  })

  const shellWriteWarningDuringBootstrap = run({
    hookEventName: 'PreToolUse',
    tool_name: 'shell_command',
    tool_input: {
      command: 'Set-Content .devcodex/profile/config.json "{}"'
    }
  })
  assert.strictEqual(shellWriteWarningDuringBootstrap.continue, true)
  assert.match(shellWriteWarningDuringBootstrap.systemMessage || '', /bootstrap/i)

  const shellAliasWriteWarningDuringBootstrap = run({
    hookEventName: 'PreToolUse',
    tool_name: 'shell_command',
    tool_input: {
      command: 'Get-Content .devcodex/profile/config.json; sc .devcodex/profile/config.json "{}"'
    }
  })
  assert.strictEqual(shellAliasWriteWarningDuringBootstrap.continue, true)
  assert.ok(!shellAliasWriteWarningDuringBootstrap.systemMessage)

  run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: {
      filePath: '.devcodex/profile/config.json'
    }
  })

  const wrongAgentSummary = run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: {
      filePath: getMemoryFilePath('copilot', 'SUMMARY.md')
    }
  })
  assert.strictEqual(wrongAgentSummary.continue, true)

  const staleTaskRead = run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: {
      filePath: getMemoryFilePath(TEST_AGENT, 'tasks', `${getTaskStamp(-7)}.md`)
    }
  })
  assert.strictEqual(staleTaskRead.continue, true)

  run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: {
      filePath: getMemoryFilePath(TEST_AGENT, 'SUMMARY.md')
    }
  })

  run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: {
      filePath: getMemoryFilePath(TEST_AGENT, 'tasks', `${getTaskStamp(0)}.md`)
    }
  })

  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(state.bootstrapComplete, true)

  cleanState({ mode: 'dev' })
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'bootstrap missing agent fallback'
  })
  run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: {
      filePath: '.devcodex/profile/config.json'
    }
  })
  const wrongFallbackSummary = run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: {
      filePath: getMemoryFilePath(WRONG_FALLBACK_AGENT, 'SUMMARY.md')
    }
  })
  assert.strictEqual(wrongFallbackSummary.continue, true)
  runBootstrapReads(FALLBACK_BOOTSTRAP_AGENT)
  const fallbackState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(fallbackState.bootstrapComplete, true)

  cleanMultiProjectState()
  const attachmentPrompt = run({
    hookEventName: 'UserPromptSubmit',
    prompt: '审查这个项目',
    attachments: [{ folderPath: path.join(TEMP_ROOT, 'devcodex-v1') }]
  })
  assert.strictEqual(attachmentPrompt.continue, true)
  let multiProjectState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(multiProjectState.activeProject, 'devcodex-v1')

  cleanMultiProjectState()
  const bareProjectPrompt = run({
    hookEventName: 'UserPromptSubmit',
    prompt: '审查 devcodex-v1 项目'
  })
  assert.strictEqual(bareProjectPrompt.continue, true)
  multiProjectState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(multiProjectState.activeProject, 'devcodex-v1')

  cleanLayoutMultiProjectState()
  const workspaceAmbiguity = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'layout-ambiguous-session',
    prompt: '继续'
  })
  assert.match(workspaceAmbiguity.systemMessage || '', /multi-project-workspace/)
  assert.match(workspaceAmbiguity.systemMessage || '', /\.devcodex\/workspace\/profile\//)
  assert.ok(!/未在工作区根配置 \.devcodex\/profile\//.test(workspaceAmbiguity.systemMessage || ''))

  const dedupedWorkspaceAmbiguity = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'layout-ambiguous-session',
    prompt: '继续'
  })
  assert.ok(!/multi-project-workspace/.test(dedupedWorkspaceAmbiguity.systemMessage || ''))
  assert.match(dedupedWorkspaceAmbiguity.systemMessage || '', /PC0-PC7/)

  cleanLayoutMultiProjectState()
  const prefixProjectPayload = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'prefix-project-session',
    prompt: '继续',
    currentFile: path.join(TEMP_ROOT, 'vext-test', 'README.md')
  })
  assert.strictEqual(prefixProjectPayload.continue, true)
  assert.ok(!/multi-project-workspace/.test(prefixProjectPayload.systemMessage || ''))
  const prefixProjectState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(prefixProjectState.activeProject, 'vext-test')
  assert.strictEqual(prefixProjectState.activeProjectSource, 'payload')

  cleanLayoutMultiProjectState()
  const roleUserPayloadAmbiguity = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'role-user-payload-session',
    prompt: '继续',
    messages: [{ role: 'user', content: '继续' }]
  })
  assert.match(roleUserPayloadAmbiguity.systemMessage || '', /multi-project-workspace/)
  const roleUserPayloadState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(roleUserPayloadState.activeProject, '')
  assert.notStrictEqual(roleUserPayloadState.activeProjectSource, 'payload')

  cleanLayoutMultiProjectState()
  const promptUserWordAmbiguity = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'prompt-user-word-session',
    prompt: 'for user-visible reply audit'
  })
  assert.match(promptUserWordAmbiguity.systemMessage || '', /multi-project-workspace/)
  const promptUserWordState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(promptUserWordState.activeProject, '')
  assert.notStrictEqual(promptUserWordState.activeProjectSource, 'prompt')

  cleanLayoutMultiProjectState()
  const layoutExplicitProject = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'sticky-session',
    prompt: '继续 devcodex-v1 的修复'
  })
  assert.strictEqual(layoutExplicitProject.continue, true)
  assert.ok(!/multi-project-workspace/.test(layoutExplicitProject.systemMessage || ''))
  let workspaceLayoutState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(workspaceLayoutState.activeProject, 'devcodex-v1')
  assert.strictEqual(workspaceLayoutState.activeScope, 'project')
  assert.strictEqual(workspaceLayoutState.mode, 'dev')
  assert.strictEqual(workspaceLayoutState.stickyProject.project, 'devcodex-v1')
  assert.strictEqual(workspaceLayoutState.activeProjectSource, 'prompt')

  const stickyFollowup = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'sticky-session',
    prompt: '继续'
  })
  assert.strictEqual(stickyFollowup.continue, true)
  assert.ok(!/multi-project-workspace/.test(stickyFollowup.systemMessage || ''))
  workspaceLayoutState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(workspaceLayoutState.activeProject, 'devcodex-v1')
  assert.strictEqual(workspaceLayoutState.activeProjectSource, 'sticky')
  assert.strictEqual(workspaceLayoutState.mode, 'dev')

  const stickyPromptUserWordFollowup = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'sticky-session',
    prompt: 'user-visible reply audit'
  })
  assert.strictEqual(stickyPromptUserWordFollowup.continue, true)
  assert.ok(!/multi-project-workspace/.test(stickyPromptUserWordFollowup.systemMessage || ''))
  workspaceLayoutState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(workspaceLayoutState.activeProject, 'devcodex-v1')
  assert.strictEqual(workspaceLayoutState.activeProjectSource, 'sticky')

  const stickyRoleUserPayloadFollowup = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'sticky-session',
    prompt: '继续',
    messages: [{ role: 'user', content: '继续' }]
  })
  assert.strictEqual(stickyRoleUserPayloadFollowup.continue, true)
  assert.ok(!/multi-project-workspace/.test(stickyRoleUserPayloadFollowup.systemMessage || ''))
  workspaceLayoutState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(workspaceLayoutState.activeProject, 'devcodex-v1')
  assert.strictEqual(workspaceLayoutState.activeProjectSource, 'sticky')

  const stickyFuzzyPayloadFollowup = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'sticky-session',
    prompt: '继续',
    metadata: {
      urls: [
        'https://example.test/user-visible-reply',
        'https://example.test/payment-plan'
      ]
    }
  })
  assert.strictEqual(stickyFuzzyPayloadFollowup.continue, true)
  assert.ok(!/multi-project-workspace/.test(stickyFuzzyPayloadFollowup.systemMessage || ''))
  workspaceLayoutState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(workspaceLayoutState.activeProject, 'devcodex-v1')
  assert.strictEqual(workspaceLayoutState.activeProjectSource, 'sticky')

  const workspaceExemption = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'sticky-session',
    prompt: '全工作区继续'
  })
  assert.strictEqual(workspaceExemption.continue, true)
  assert.ok(!/multi-project-workspace/.test(workspaceExemption.systemMessage || ''))
  workspaceLayoutState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(workspaceLayoutState.activeProject, '')
  assert.strictEqual(workspaceLayoutState.activeScope, 'workspace')
  assert.strictEqual(workspaceLayoutState.stickyProject.project, '')

  cleanLayoutMultiProjectState()
  run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'old-session',
    prompt: '修复 devcodex-v1 项目'
  })
  const newSessionFollowup = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'new-session',
    prompt: '继续'
  })
  assert.match(newSessionFollowup.systemMessage || '', /multi-project-workspace/)

  cleanLayoutMultiProjectState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: '修复 devcodex-v1 项目'
  })
  workspaceLayoutState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  workspaceLayoutState.stickyProject.updatedAtMs = 1
  fs.writeFileSync(getWorkspaceLayoutStateFile(), JSON.stringify(workspaceLayoutState, null, 2))
  const expiredStickyFollowup = run({
    hookEventName: 'UserPromptSubmit',
    prompt: '继续'
  })
  assert.match(expiredStickyFollowup.systemMessage || '', /multi-project-workspace/)

  cleanLayoutState()
  const layoutProjectRoot = path.join(TEMP_ROOT, 'chat')
  const layoutPromptOutput = run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'chat 项目进入布局复审'
  }, layoutProjectRoot)
  assert.strictEqual(layoutPromptOutput.continue, true)
  const layoutShellRead = run({
    hookEventName: 'PreToolUse',
    tool_name: 'shell_command',
    tool_input: {
      command: 'Get-Content ../.devcodex/workspace/profile/config.json'
    }
  }, layoutProjectRoot)
  assert.strictEqual(layoutShellRead.continue, true)
  runLayoutBootstrapReads(TEST_AGENT, layoutProjectRoot)
  const layoutState = JSON.parse(fs.readFileSync(getLayoutStateFile('chat'), 'utf8'))
  assert.strictEqual(layoutState.bootstrapComplete, true)
  assert.strictEqual(layoutState.activeScope, 'project')
  assert.strictEqual(layoutState.activeProject, 'chat')
  assert.ok(!fs.existsSync(path.join(TEMP_ROOT, '.devcodex', '.memory', 'hooks', 'chat', 'lifecycle-state.json')))

  layoutState.executionMode = 'auto'
  fs.writeFileSync(getLayoutStateFile('chat'), JSON.stringify(layoutState, null, 2))
  const misplacedTmpWrite = run({
    hookEventName: 'PreToolUse',
    tool_name: 'shell_command',
    tool_input: {
      command: 'Set-Content .devcodex/.tmp/leak.json "{}"'
    }
  }, layoutProjectRoot)
  assert.strictEqual(misplacedTmpWrite.continue, true)
  assert.match(misplacedTmpWrite.systemMessage || '', /Auto v1\.1/)

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'resume legacy validation chain'
  })
  runBootstrapReads(TEST_AGENT)

  const noVisiblePayloadReminder = run({
    hookEventName: 'PreCompact'
  })
  assert.strictEqual(noVisiblePayloadReminder.continue, true)
  assert.ok(!noVisiblePayloadReminder.systemMessage)
  assert.ok(!fs.existsSync(CAPTURE_LOG))

  fs.mkdirSync(STATE_DIR, { recursive: true })
  fs.writeFileSync(CAPTURE_FLAG, 'capture final payload once\n')

  run({
    hookEventName: 'PreCompact',
    assistantMessage: 'Visible reply sample before stop.'
  })

  assert.ok(fs.existsSync(CAPTURE_LOG))
  let captureEntries = fs.readFileSync(CAPTURE_LOG, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line))
  assert.strictEqual(captureEntries[0].eventName, 'PreCompact')
  assert.strictEqual(captureEntries[0].visiblePayloadDetected, true)
  assert.ok(captureEntries[0].interestingStrings.some(entry => entry.path === 'assistantMessage'))
  assert.strictEqual(fs.existsSync(CAPTURE_FLAG), true)

  const allowedAfterBootstrap = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: README.md\n*** End Patch'
    }
  })
  assert.strictEqual(allowedAfterBootstrap.continue, true)
  assert.ok(!allowedAfterBootstrap.hookSpecificOutput)

  const dangerousCommand = run({
    hookEventName: 'PreToolUse',
    tool_name: 'run_in_terminal',
    tool_input: {
      command: 'git reset --hard HEAD~1'
    }
  })
  assert.strictEqual(dangerousCommand.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(dangerousCommand.hookSpecificOutput.permissionDecisionReason || '', /git reset --hard/i)

  const searchDangerousText = run({
    hookEventName: 'PreToolUse',
    tool_name: 'run_in_terminal',
    tool_input: {
      command: 'rg -n "rm -rf|DROP TABLE|DELETE FROM" docs/example.md'
    }
  })
  assert.strictEqual(searchDangerousText.continue, true)
  assert.ok(!searchDangerousText.hookSpecificOutput)

  const deleteWithoutWhere = run({
    hookEventName: 'PreToolUse',
    tool_name: 'run_in_terminal',
    tool_input: {
      command: 'node -e "db.exec(`DELETE FROM users`)"'
    }
  })
  assert.strictEqual(deleteWithoutWhere.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(deleteWithoutWhere.hookSpecificOutput.permissionDecisionReason || '', /DELETE FROM/i)

  const deleteWithWhere = run({
    hookEventName: 'PreToolUse',
    tool_name: 'run_in_terminal',
    tool_input: {
      command: 'node -e "db.exec(`DELETE FROM users WHERE id=1`)"'
    }
  })
  assert.strictEqual(deleteWithWhere.continue, true)
  assert.ok(!deleteWithWhere.hookSpecificOutput)

  const dangerousApprovalId = String(
    dangerousCommand.hookSpecificOutput.additionalContext || ''
  ).match(/devcodex-approve:([a-f0-9]{12})/)?.[1]
  assert.ok(dangerousApprovalId, 'dangerous command should return one-time approval id')

  const unconfirmedDangerousCommand = run({
    hookEventName: 'PreToolUse',
    tool_name: 'run_in_terminal',
    tool_input: {
      command: `git reset --hard HEAD~1 # devcodex-approve:${dangerousApprovalId}`
    }
  })
  assert.strictEqual(unconfirmedDangerousCommand.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(unconfirmedDangerousCommand.hookSpecificOutput.permissionDecisionReason || '', /git reset --hard/i)

  run({
    hookEventName: 'UserPromptSubmit',
    prompt: `确认执行 devcodex-approve:${dangerousApprovalId}`
  })
  runBootstrapReads()
  const approvedDangerousCommand = run({
    hookEventName: 'PreToolUse',
    tool_name: 'run_in_terminal',
    tool_input: {
      command: `git reset --hard HEAD~1 # devcodex-approve:${dangerousApprovalId}`
    }
  })
  assert.strictEqual(approvedDangerousCommand.continue, true)
  assert.ok(!approvedDangerousCommand.hookSpecificOutput)
  const reusedDangerousCommand = run({
    hookEventName: 'PreToolUse',
    tool_name: 'run_in_terminal',
    tool_input: {
      command: `git reset --hard HEAD~1 # devcodex-approve:${dangerousApprovalId}`
    }
  })
  assert.strictEqual(reusedDangerousCommand.hookSpecificOutput.permissionDecision, 'deny')
  const interceptionEntries = readInterceptionEntries()
  assert.ok(interceptionEntries.some(entry => entry.code === 'dangerous-command' && entry.action === 'forbid' && entry.effective === true))
  assert.ok(interceptionEntries.some(entry => entry.code === 'dangerous-command-confirmed' && entry.action === 'log_only'))
  assert.ok(interceptionEntries.some(entry => entry.code === 'dangerous-command-approved' && entry.action === 'log_only'))

  const missingPrecheckReminder = run({
    hookEventName: 'Stop',
    assistantMessage: 'All work is complete.'
  })
  assert.match(missingPrecheckReminder.systemMessage || '', /entry check block/i)
  const duplicateMissingPrecheckReminder = run({
    hookEventName: 'Stop',
    assistantMessage: 'All work is complete.'
  })
  assert.ok(!duplicateMissingPrecheckReminder.systemMessage)
  captureEntries = fs.readFileSync(CAPTURE_LOG, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line))
  assert.strictEqual(captureEntries.length, 2)
  assert.strictEqual(captureEntries[1].eventName, 'Stop')
  assert.strictEqual(fs.existsSync(CAPTURE_FLAG), false)

  cleanState()
  run({ hookEventName: 'UserPromptSubmit', prompt: 'strict stop closure test' })
  const strictStopBlock = run({
    hookEventName: 'Stop',
    assistantMessage: 'All work is complete.'
  }, TEMP_ROOT, { DEVCODEX_HOOK_ENFORCEMENT: 'strict', CODEX_HOME: '1' })
  assert.strictEqual(strictStopBlock.decision, 'block')
  assert.match(strictStopBlock.reason || '', /entry check block/i)
  assert.ok(!strictStopBlock.hookSpecificOutput?.decision)
  assert.ok(readInterceptionEntries().some(entry => entry.eventName === 'Stop' && entry.code === 'closure-incomplete' && entry.effective === true))

  cleanState()
  run({ hookEventName: 'UserPromptSubmit', prompt: 'codex strict precompact contract test' }, TEMP_ROOT, { CODEX_HOME: '1' })
  run({
    hookEventName: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Add File: src/codex-contract.js\n+contract\n*** End Patch'
    }
  }, TEMP_ROOT, { CODEX_HOME: '1' })
  const codexPreCompactBlock = run({
    hookEventName: 'PreCompact',
    assistantMessage: 'Progress before compact.'
  }, TEMP_ROOT, { DEVCODEX_HOOK_ENFORCEMENT: 'strict', CODEX_HOME: '1' })
  assert.strictEqual(codexPreCompactBlock.continue, false)
  assert.match(codexPreCompactBlock.stopReason || '', /记忆文件尚未写入|memory/i)
  assert.ok(!codexPreCompactBlock.hookSpecificOutput?.decision)

  cleanState()
  run({ hookEventName: 'UserPromptSubmit', prompt: 'claude strict precompact contract test' }, TEMP_ROOT, { CLAUDE_HOOK_COMMAND: '1' })
  run({
    hookEventName: 'PostToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: 'src/claude-contract.js', old_string: 'a', new_string: 'b' }
  }, TEMP_ROOT, { CLAUDE_HOOK_COMMAND: '1' })
  const claudePreCompactBlock = run({
    hook_event_name: 'PreCompact',
    transcript_path: ''
  }, TEMP_ROOT, { DEVCODEX_HOOK_ENFORCEMENT: 'strict', CLAUDE_HOOK_COMMAND: '1' })
  assert.strictEqual(claudePreCompactBlock.decision, 'block')
  assert.match(claudePreCompactBlock.reason || '', /记忆文件尚未写入|memory/i)
  assert.ok(!claudePreCompactBlock.hookSpecificOutput?.decision)

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Need a root cure for dev mode drift.'
  })
  runBootstrapReads()
  run({
    hookEventName: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Add File: .devcodex/reports/analysis/claude-code/20260525/01--sample.md\n+# report\n*** End Patch'
    }
  })
  run({
    hookEventName: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: `*** Begin Patch\n*** Update File: ${getMemoryFilePath(TEST_AGENT, 'tasks', `${getTaskStamp(0)}.md`)}\n*** End Patch`
    }
  })
  run({
    hookEventName: 'PreCompact',
    assistantMessage: [
      '---',
      '🔍 入口检查（DEV 模式）',
      '- PC0 上下文：项目 devcodex-v1',
      '---'
    ].join('\n')
  })
  const missingComplianceAndPathsReminder = run({
    hookEventName: 'Stop',
    assistantMessage: 'Final answer without compliance block or artifact paths.'
  })
  assert.match(missingComplianceAndPathsReminder.systemMessage || '', /合规检查状态块未输出/)
  assert.match(missingComplianceAndPathsReminder.systemMessage || '', /产物路径未输出/)

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Need a root cure for dev mode drift.'
  })
  runBootstrapReads()
  run({
    hookEventName: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Add File: .devcodex/reports/analysis/claude-code/20260525/01--sample.md\n+# report\n*** End Patch'
    }
  })
  run({
    hookEventName: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: `*** Begin Patch\n*** Update File: ${getMemoryFilePath(TEST_AGENT, 'tasks', `${getTaskStamp(0)}.md`)}\n*** End Patch`
    }
  })
  run({
    hookEventName: 'PreCompact',
    assistantMessage: [
      '---',
      '🔍 入口检查（DEV 模式）',
      '- PC0 上下文：项目 devcodex-v1',
      '---',
      '---',
      '🛡️ DEV 模式 | 合规检查',
      'FC: FC1 [✅] FC2 [✅] FC3 [✅] FC4 [✅] FC5 [✅] FC6 [✅]',
      'SC: SC1 [✅]',
      '整体：✅ 全通过',
      '',
      '参考文件：',
      '- [01--sample.md](devcodex-v1/.devcodex/reports/analysis/claude-code/20260525/01--sample.md)',
      '  E:\\Worker\\devcodex-v1\\.devcodex\\reports\\analysis\\claude-code\\20260525\\01--sample.md'
    ].join('\n')
  })
  const artifactSectionRequiredReminder = run({
    hookEventName: 'Stop',
    assistantMessage: 'Final answer still missed the artifact section.'
  })
  assert.ok(!/合规检查状态块未输出/.test(artifactSectionRequiredReminder.systemMessage || ''))
  assert.match(artifactSectionRequiredReminder.systemMessage || '', /产物路径未输出/)

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Need a root cure for dev mode drift.'
  })
  runBootstrapReads()
  run({
    hookEventName: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Add File: .devcodex/reports/analysis/claude-code/20260525/01--sample.md\n+# report\n*** End Patch'
    }
  })
  run({
    hookEventName: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: `*** Begin Patch\n*** Update File: ${getMemoryFilePath(TEST_AGENT, 'tasks', `${getTaskStamp(0)}.md`)}\n*** End Patch`
    }
  })
  run({
    hookEventName: 'PreCompact',
    assistantMessage: [
      '---',
      '🔍 入口检查（DEV 模式）',
      '- PC0 上下文：项目 devcodex-v1',
      '---',
      '---',
      '🛡️ DEV 模式 | 合规检查',
      'FC: FC1 [✅] FC2 [✅] FC3 [✅] FC4 [✅] FC5 [✅] FC6 [✅]',
      'SC: SC1 [✅]',
      '整体：✅ 全通过',
      '',
      '📂 本次会话产物：',
      '- [01--sample.md](devcodex-v1/.devcodex/reports/analysis/claude-code/20260525/01--sample.md)',
      '  `E:\\Worker\\devcodex-v1\\.devcodex\\reports\\analysis\\claude-code\\20260525\\01--sample.md`'
    ].join('\n')
  })
  const completeClosureReply = run({
    hookEventName: 'Stop',
    assistantMessage: 'Completed with compliant final reply.'
  })
  assert.ok(!completeClosureReply.systemMessage)

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Need a root cure for duplicate artifact cards.'
  })
  runBootstrapReads()
  run({
    hookEventName: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Add File: .devcodex/reports/analysis/claude-code/20260525/01--sample.md\n+# report\n*** End Patch'
    }
  })
  run({
    hookEventName: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: `*** Begin Patch\n*** Update File: ${getMemoryFilePath(TEST_AGENT, 'tasks', `${getTaskStamp(0)}.md`)}\n*** End Patch`
    }
  })
  run({
    hookEventName: 'PreCompact',
    assistantMessage: [
      '---',
      '🔍 入口检查（DEV 模式）',
      '- PC0 上下文：项目 devcodex-v1',
      '---',
      '---',
      '🛡️ DEV 模式 | 合规检查',
      'FC: FC1 [✅] FC2 [✅] FC3 [✅] FC4 [✅] FC5 [✅] FC6 [✅]',
      'SC: SC1 [✅]',
      '整体：✅ 全通过',
      '',
      '📂 本次会话产物：',
      '- [01--sample.md](devcodex-v1/.devcodex/reports/analysis/claude-code/20260525/01--sample.md)'
    ].join('\n')
  })
  const singleLineArtifactClosureReply = run({
    hookEventName: 'Stop',
    assistantMessage: 'Completed with single-line artifact path.'
  })
  assert.ok(!singleLineArtifactClosureReply.systemMessage)

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Need a root cure for transcript-backed Stop payloads.'
  })
  runBootstrapReads()
  run({
    hookEventName: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Add File: .devcodex/reports/analysis/claude-code/20260525/01--sample.md\n+# report\n*** End Patch'
    }
  })
  run({
    hookEventName: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: `*** Begin Patch\n*** Update File: ${getMemoryFilePath(TEST_AGENT, 'tasks', `${getTaskStamp(0)}.md`)}\n*** End Patch`
    }
  })
  const transcriptPath = writeTranscript('copilot-stop-transcript.jsonl', [
    '---',
    '🔍 入口检查（DEV 模式）',
    '- PC0 上下文：项目 devcodex-v1',
    '---',
    '---',
    '🛡️ DEV 模式 | 合规检查',
    'FC: FC1 [✅] FC2 [✅] FC3 [✅] FC4 [✅] FC5 [✅] FC6 [✅]',
    'SC: SC1 [✅]',
    '整体：✅ 全通过',
    '',
    '📂 本次会话产物：',
    '- [01--sample.md](devcodex-v1/.devcodex/reports/analysis/claude-code/20260525/01--sample.md)'
  ].join('\n'))
  const transcriptBackedClosureReply = run({
    hook_event_name: 'Stop',
    session_id: 'copilot-transcript-stop',
    transcript_path: transcriptPath,
    cwd: TEMP_ROOT
  })
  assert.ok(!transcriptBackedClosureReply.systemMessage)
  const transcriptBackedState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(transcriptBackedState.visible.payloadObserved, true)
  assert.strictEqual(transcriptBackedState.visible.precheck, true)
  assert.strictEqual(transcriptBackedState.visible.compliance, true)
  assert.strictEqual(transcriptBackedState.visible.artifactPaths, true)

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Stop content parts should be visible.'
  })
  const contentPartsStop = run({
    hookEventName: 'Stop',
    assistantMessage: [
      { type: 'text', text: '---\n🔍 入口检查（DEV 模式）\n- PC0 上下文：项目 devcodex-v1\n---' }
    ]
  })
  assert.ok(!contentPartsStop.systemMessage)
  let visibleState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(visibleState.visible.precheckStatus, 'verified-present')

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Stop messages should use latest assistant message.'
  })
  const messagesStop = run({
    hookEventName: 'Stop',
    messages: [
      { role: 'user', content: 'PC0 上下文 should not count from a user message' },
      { role: 'assistant', content: [{ type: 'text', text: '---\n🔍 入口检查（DEV 模式）\n- PC0 上下文：项目 devcodex-v1\n---' }] }
    ]
  })
  assert.ok(!messagesStop.systemMessage)

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Stop choices should be parsed.'
  })
  const choicesStop = run({
    hookEventName: 'Stop',
    choices: [
      { message: { role: 'assistant', content: [{ text: '---\n🔍 入口检查（DEV 模式）\n- PC0 上下文：项目 devcodex-v1\n---' }] } }
    ]
  })
  assert.ok(!choicesStop.systemMessage)

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Transcript variants should be parsed.'
  })
  const variantTranscriptPath = writeTranscriptEntries('copilot-stop-transcript-variant.jsonl', [
    { role: 'user', content: 'trigger prompt' },
    { role: 'assistant', message: { content: [{ type: 'text', text: '---\n🔍 入口检查（DEV 模式）\n- PC0 上下文：项目 devcodex-v1\n---' }] } }
  ])
  const variantTranscriptStop = run({
    hookEventName: 'Stop',
    transcript_path: variantTranscriptPath
  })
  assert.ok(!variantTranscriptStop.systemMessage)

  cleanState()
  run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Unverified Stop payload should not assert missing entry block.'
  })
  const unverifiedStop = run({ hookEventName: 'Stop' })
  assert.match(unverifiedStop.systemMessage || '', /无法验证最终用户可见回复/)
  assert.ok(!/entry check block 未输出/.test(unverifiedStop.systemMessage || ''))
  visibleState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(visibleState.visible.replyEvidence, 'unverified')

  // Auto v1.1: explicit @devcodex-auto writes executionMode=auto; in safety-only mode,
  // non-whitelisted paths warn instead of hard-blocking.
  cleanState()
  const autoReq = path.join(TEMP_ROOT, '.devcodex', 'requirements', '自动模式需求')
  fs.mkdirSync(path.join(autoReq, '.memory'), { recursive: true })
  fs.writeFileSync(path.join(autoReq, '01-需求概述.md'), '# auto req\n')
  fs.writeFileSync(path.join(autoReq, '.memory', 'sessions.md'), '| CP1 | ✅ |\n')

  run({ hookEventName: 'UserPromptSubmit', prompt: '@devcodex-auto 修复 auto runtime 行为' })
  runBootstrapReads()
  const autoState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(autoState.executionMode, 'auto')

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

  // bug task support: unfinished bug task should warn on source mutation
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

  // bug task with CP2/CP3 complete should allow source mutation
  fs.writeFileSync(
    path.join(bugDir, 'reports', 'claude-code', getTaskStamp(0), '02--技术方案与CP2.md'),
    '# cp2\n'
  )
  fs.writeFileSync(path.join(bugDir, '04-实施计划.md'), '# cp3\n')
  fs.writeFileSync(
    path.join(bugDir, '.memory', 'sessions.md'),
    '| CP1 | ✅ |\n| CP2 | ✅ |\n| CP3 | ✅ |\n'
  )
  const allowedBugTask = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { input: '*** Begin Patch\n*** Update File: src/bug.js\n*** End Patch' }
  })
  assert.strictEqual(allowedBugTask.continue, true)

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
