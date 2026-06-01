'use strict'

function runHooksRuntimeBootstrapLayoutScenarios(context) {
  const {
    assert,
    fs,
    path,
    TEMP_ROOT,
    STATE_FILE,
    TEST_AGENT,
    FALLBACK_BOOTSTRAP_AGENT,
    WRONG_FALLBACK_AGENT,
    getTaskStamp,
    getMemoryFilePath,
    getLayoutStateFile,
    getWorkspaceLayoutStateFile,
    runBootstrapReads,
    runLayoutBootstrapReads,
    cleanState,
    cleanLayoutState,
    cleanMultiProjectState,
    cleanLayoutMultiProjectState,
    cleanNestedLayoutMultiProjectState,
    cleanToolingSiblingState,
    run
  } = context

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
  assert.ok(fs.existsSync(getLayoutStateFile('vext-test')))

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
  assert.ok(fs.existsSync(getLayoutStateFile('devcodex-v1')))

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
  const noSessionFollowup = run({
    hookEventName: 'UserPromptSubmit',
    prompt: '继续'
  })
  assert.match(noSessionFollowup.systemMessage || '', /multi-project-workspace/)

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

  cleanNestedLayoutMultiProjectState()
  const nestedWorkspaceAmbiguity = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'nested-layout-session',
    prompt: '继续'
  })
  assert.match(nestedWorkspaceAmbiguity.systemMessage || '', /multi-project-workspace/)

  const nestedPayloadProject = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'nested-payload-session',
    prompt: '继续',
    currentFile: path.join(TEMP_ROOT, 'packages', 'app-a', 'README.md')
  })
  assert.strictEqual(nestedPayloadProject.continue, true)
  assert.ok(!/multi-project-workspace/.test(nestedPayloadProject.systemMessage || ''))
  const nestedLayoutState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(nestedLayoutState.activeProject, 'packages/app-a')
  assert.strictEqual(nestedLayoutState.activeProjectSource, 'payload')
  assert.ok(fs.existsSync(getLayoutStateFile(path.join('packages', 'app-a'))))

  cleanToolingSiblingState()
  const toolingSiblingPrompt = run({
    hookEventName: 'UserPromptSubmit',
    session_id: 'tooling-sibling-session',
    prompt: '继续 app 的修复'
  })
  assert.strictEqual(toolingSiblingPrompt.continue, true)
  assert.ok(!/multi-project-workspace/.test(toolingSiblingPrompt.systemMessage || ''))
  const toolingSiblingState = JSON.parse(fs.readFileSync(getWorkspaceLayoutStateFile(), 'utf8'))
  assert.strictEqual(toolingSiblingState.activeProject, 'app')
  assert.strictEqual(toolingSiblingState.activeProjectSource, 'prompt')
}

module.exports = {
  runHooksRuntimeBootstrapLayoutScenarios
}
