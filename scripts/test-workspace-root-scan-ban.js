#!/usr/bin/env node
'use strict'

const path = require('path')
const crypto = require('crypto')
const assert = require('assert')
const {
  classifyWorkspaceRootScanSample
} = require('./lib/host-parity-scorecard.js')
const { buildLifecycleDangerousCommandUtils } = require('../hooks/_runtime/lifecycle-dangerous-command.cjs')

const ROOT = 'E:\\Worker'

function makeUtils(contextRoot = ROOT) {
  return buildLifecycleDangerousCommandUtils({
    path,
    crypto,
    CONTEXT_ROOT: contextRoot,
    WORKSPACE_ROOT: ROOT,
    APPROVAL_TTL_MS: 600000,
    DANGEROUS_PATTERNS: [],
    getToolName: () => 'run_terminal_command',
    getCommandText: (p) => p.tool_input.command,
    INTERCEPTION_ACTION: { FORBID: 'forbid' },
    recordInterception: () => {}
  })
}

const utils = makeUtils(ROOT)

function expectBan(cmd, label, payloadExtra = {}) {
  const d = utils.checkDangerousCommand({
    tool_input: { command: cmd, ...payloadExtra }
  }, 'grok')
  assert.ok(d, `expected ban: ${label}`)
  assert.strictEqual(d.code, 'workspace-root-scan-ban', label)
}

function expectAllow(cmd, label, payloadExtra = {}) {
  const d = utils.checkDangerousCommand({
    tool_input: { command: cmd, ...payloadExtra }
  }, 'grok')
  assert.strictEqual(d, null, `expected allow: ${label} got ${d && d.reason}`)
}

// R-01 sample / original relapse
expectBan(
  'Get-ChildItem -Path "E:\\Worker" -Directory -Filter "*queuebit*" -Recurse -Depth 3',
  'absolute root recurse depth'
)
// project scoped allow
expectAllow(
  'Get-ChildItem -Path "E:\\Worker\\queuebit\\docs" -Recurse -Filter *.md',
  'project docs recurse'
)
// R-04: first-level child without trailing slash
expectAllow(
  'Get-ChildItem -Path "E:\\Worker\\queuebit" -Recurse',
  'first-level project path'
)
// R-02: dir /s
expectBan('dir /s E:\\Worker', 'dir /s workspace root')
expectBan('dir /s', 'dir /s relative at workspace cwd')
// find at workspace root (C16)
expectBan('find E:\\Worker -type f', 'find workspace root')
// R-03: relative recurse at workspace cwd
expectBan('Get-ChildItem -Recurse -Depth 3', 'relative recurse at workspace cwd')
expectBan('Get-ChildItem -Recurse', 'relative recurse bare')
// relative child at workspace cwd
expectAllow('Get-ChildItem queuebit -Recurse', 'relative child name')
expectAllow('Get-ChildItem -Path queuebit -Recurse', 'relative -Path child')
// project cwd relative recurse allowed (CONTEXT_ROOT = project)
const projectUtils = makeUtils('E:\\Worker\\queuebit')
assert.strictEqual(
  projectUtils.checkDangerousCommand({
    tool_input: { command: 'Get-ChildItem -Recurse', cwd: 'E:\\Worker\\queuebit' }
  }, 'grok'),
  null,
  'relative recurse inside project cwd'
)

// Probe parity with Hook (R-04)
assert.strictEqual(
  classifyWorkspaceRootScanSample(
    'Get-ChildItem -Path "E:\\Worker\\queuebit" -Recurse',
    { workspaceRoot: ROOT }
  ),
  'project-scoped-ok'
)
assert.strictEqual(
  classifyWorkspaceRootScanSample(
    'Get-ChildItem -Path "E:\\Worker" -Recurse -Depth 3',
    { workspaceRoot: ROOT }
  ),
  'workspace-root-recurse'
)
assert.strictEqual(
  classifyWorkspaceRootScanSample('dir /s E:\\Worker', { workspaceRoot: ROOT }),
  'workspace-root-recurse'
)
assert.strictEqual(
  classifyWorkspaceRootScanSample('Get-ChildItem -Recurse -Depth 3', {
    workspaceRoot: ROOT,
    cwd: ROOT
  }),
  'workspace-root-recurse'
)
assert.strictEqual(
  classifyWorkspaceRootScanSample('Get-ChildItem queuebit -Recurse', {
    workspaceRoot: ROOT,
    cwd: ROOT
  }),
  'project-scoped-ok'
)

// direct inventory helpers
assert.strictEqual(utils.isWorkspaceRootRecursiveInventory(
  'Get-ChildItem -Path "E:\\Worker" -Recurse', ROOT, { cwd: ROOT }
), true)
assert.strictEqual(utils.isWorkspaceRootRecursiveInventory(
  'Get-ChildItem -Path "E:\\Worker\\queuebit" -Recurse', ROOT, { cwd: ROOT }
), false)

console.log('workspace-root-scan-ban unit OK (R-01..R-04 matrix)')
