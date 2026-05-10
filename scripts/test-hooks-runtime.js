#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const RUNTIME = path.join(ROOT, 'hooks', '_runtime', 'lifecycle.cjs')
const STATE_DIR = path.join(ROOT, '.devcodex', '.memory', 'hooks')
const STATE_FILE = path.join(STATE_DIR, 'lifecycle-state.json')
const CAPTURE_FLAG = path.join(STATE_DIR, 'capture-final-payload.flag')
const CAPTURE_LOG = path.join(STATE_DIR, 'captured-final-payloads.ndjson')

function cleanState() {
  if (fs.existsSync(STATE_DIR)) {
    fs.rmSync(STATE_DIR, { recursive: true, force: true })
  }
}

function run(payload) {
  const result = spawnSync(process.execPath, [RUNTIME], {
    cwd: ROOT,
    input: JSON.stringify(payload),
    encoding: 'utf8'
  })

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'runtime exited with failure').trim())
  }

  return JSON.parse(result.stdout || '{}')
}

function main() {
  cleanState()

  const promptOutput = run({
    hookEventName: 'UserPromptSubmit',
    prompt: 'Need a root cure for dev mode drift.'
  })
  assert.strictEqual(promptOutput.continue, true)
  assert.match(promptOutput.systemMessage || '', /PC0-PC4/)

  const blockedBeforeBootstrap = run({
    hookEventName: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      input: '*** Begin Patch\n*** Update File: README.md\n*** End Patch'
    }
  })
  assert.strictEqual(blockedBeforeBootstrap.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(blockedBeforeBootstrap.hookSpecificOutput.permissionDecisionReason || '', /bootstrap/i)

  run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: {
      filePath: '.devcodex/profile/config.json'
    }
  })

  run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: {
      filePath: '.devcodex/.memory/clients/copilot/SUMMARY.md'
    }
  })

  run({
    hookEventName: 'PreToolUse',
    tool_name: 'read_file',
    tool_input: {
      filePath: '.devcodex/.memory/clients/copilot/tasks/20260510.md'
    }
  })

  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  assert.strictEqual(state.bootstrapComplete, true)

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

  const missingPrecheckReminder = run({
    hookEventName: 'Stop',
    assistantMessage: 'All work is complete.'
  })
  assert.match(missingPrecheckReminder.systemMessage || '', /precheck block/i)
  captureEntries = fs.readFileSync(CAPTURE_LOG, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line))
  assert.strictEqual(captureEntries.length, 2)
  assert.strictEqual(captureEntries[1].eventName, 'Stop')
  assert.strictEqual(fs.existsSync(CAPTURE_FLAG), false)

  cleanState()
  process.stdout.write('hooks runtime smoke test passed\n')
}

main()