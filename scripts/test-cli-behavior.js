#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const CLI = path.join(ROOT, 'index.js')
const HOST_ENV_SCRUB = {
  CLAUDE_CODE_VERSION: '',
  CLAUDE_HOOK_COMMAND: '',
  CODEX_HOME: '',
  CODEX_ENV_PWD: '',
  OPENAI_CODEX: '',
  IDEA_INITIAL_DIRECTORY: '',
  JETBRAINS_IDE: '',
  TERM_PROGRAM: '',
  VSCODE_PID: '',
  CURSOR_TRACE_ID: '',
  CURSOR_USER_ID: ''
}

function stripAnsi(text) {
  return String(text || '').replace(/\x1b\[[0-9;]*m/g, '')
}

function runCli(args, cwd, envOverrides = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...HOST_ENV_SCRUB, ...envOverrides }
  })
  if (result.status !== 0) {
    throw new Error(stripAnsi((result.stderr || result.stdout || 'CLI exited with failure').trim()))
  }
  return stripAnsi(`${result.stdout || ''}${result.stderr || ''}`)
}

function writeFile(root, relativePath, content) {
  const fullPath = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath, content, 'utf8')
}

function writeJson(root, relativePath, value) {
  writeFile(root, relativePath, JSON.stringify(value, null, 2) + '\n')
}

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'))
}

function walk(root) {
  if (!fs.existsSync(root)) return []
  const stat = fs.statSync(root)
  if (!stat.isDirectory()) return [root]
  const results = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    results.push(...walk(path.join(root, entry.name)))
  }
  return results
}

function findBackups(root, baseName) {
  return walk(root).filter(file => path.basename(file).startsWith(`${baseName}.bak.`))
}

function createTempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function buildClaudeProject(root) {
  writeFile(root, 'package.json', '{ "name": "tmp-cli-project" }\n')
  writeFile(root, 'CLAUDE.md', '# custom claude instructions\n')
  writeJson(root, '.claude/settings.json', {
    permissions: {
      allow: ['Read'],
      ask: ['Bash'],
      deny: ['DeleteTool']
    },
    hooks: {
      PreToolUse: [{ matcher: 'custom-pre', hooks: [{ type: 'command', command: 'echo custom-pre' }] }],
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo custom-prompt' }] }]
    },
    enableAllProjectMcpServers: false
  })
  writeJson(root, '.mcp.json', {
    servers: {
      'legacy-custom': {
        type: 'stdio',
        command: 'node',
        args: ['legacy.js']
      }
    },
    mcpServers: {
      'custom-server': {
        type: 'stdio',
        command: 'node',
        args: ['custom.js']
      }
    }
  })
}

function assertClaudeMergeState(root, { claudeMdManaged }) {
  const settings = readJson(root, '.claude/settings.json')
  const mcp = readJson(root, '.mcp.json')
  const claudeMd = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8')

  if (claudeMdManaged) {
    const sourceInstructions = fs.readFileSync(path.join(ROOT, 'instructions.md'), 'utf8')
    assert.strictEqual(claudeMd, sourceInstructions)
  } else {
    assert.strictEqual(claudeMd, '# custom claude instructions\n')
  }

  assert.deepStrictEqual(settings.permissions.ask, ['Bash'])
  assert.deepStrictEqual(settings.permissions.deny, ['DeleteTool'])
  assert.ok(settings.permissions.allow.includes('Read'))
  assert.ok(settings.permissions.allow.includes('mcp__devcodex-memory'))
  assert.strictEqual(settings.enableAllProjectMcpServers, true)

  const preToolUseHooks = settings.hooks?.PreToolUse || []
  const promptHooks = settings.hooks?.UserPromptSubmit || []
  assert.ok(preToolUseHooks.some(entry => JSON.stringify(entry).includes('echo custom-pre')))
  assert.ok(promptHooks.some(entry => JSON.stringify(entry).includes('echo custom-prompt')))
  assert.ok(preToolUseHooks.some(entry => JSON.stringify(entry).includes('lifecycle.cjs')))
  assert.ok(promptHooks.some(entry => JSON.stringify(entry).includes('lifecycle.cjs')))

  assert.ok(!Object.prototype.hasOwnProperty.call(mcp, 'servers'))
  assert.ok(mcp.mcpServers['legacy-custom'])
  assert.ok(mcp.mcpServers['custom-server'])
  assert.ok(mcp.mcpServers['devcodex-memory'])
  assert.ok(mcp.mcpServers['devcodex-profile'])
}

function testClaudeInitPreservesCustomConfig() {
  const root = createTempRoot('devcodex-cli-init-')
  buildClaudeProject(root)

  runCli(['init', '--claude'], root)
  assertClaudeMergeState(root, { claudeMdManaged: false })

  const backupRoot = path.join(root, '.devcodex', '.tmp', 'backups')
  assert.strictEqual(findBackups(backupRoot, 'CLAUDE.md').length, 0)
  assert.ok(findBackups(backupRoot, 'settings.json').length >= 1)
  assert.ok(findBackups(backupRoot, '.mcp.json').length >= 1)

  fs.rmSync(root, { recursive: true, force: true })
}

function testClaudeUpdateBacksUpAndPreservesCustomConfig() {
  const root = createTempRoot('devcodex-cli-update-')
  buildClaudeProject(root)

  runCli(['update', '--claude'], root)
  assertClaudeMergeState(root, { claudeMdManaged: true })

  const backupRoot = path.join(root, '.devcodex', '.tmp', 'backups')
  assert.ok(findBackups(backupRoot, 'CLAUDE.md').length >= 1)
  assert.ok(findBackups(backupRoot, 'settings.json').length >= 1)
  assert.ok(findBackups(backupRoot, '.mcp.json').length >= 1)

  fs.rmSync(root, { recursive: true, force: true })
}

function testDoctorAvoidsCodexBiasInMixedHostRepo() {
  const root = createTempRoot('devcodex-cli-doctor-')
  writeFile(root, 'AGENTS.md', '# AGENTS\n')
  writeFile(root, 'CLAUDE.md', '# CLAUDE\n')
  writeFile(root, '.github/copilot-instructions.md', '# Copilot\n')
  writeFile(root, '.github/hooks/_runtime/lifecycle.cjs', 'module.exports = {}\n')
  writeFile(root, '.claude/hooks/_runtime/lifecycle.cjs', 'module.exports = {}\n')
  writeFile(root, '.agents/skills/example.txt', 'placeholder\n')
  writeFile(root, '.codex/hooks/_runtime/lifecycle.cjs', 'module.exports = {}\n')
  writeJson(root, '.codex/hooks.json', {
    hooks: {
      UserPromptSubmit: [{ command: 'node ./.codex/hooks/_runtime/lifecycle.cjs' }]
    }
  })

  const output = runCli(['doctor'], root)
  assert.match(output, /platform:\s+unknown\s+\(unknown\)/)
  assert.match(output, /agent:\s+unknown-agent/)
  assert.match(output, /installed hosts:\s+codex, claude-code, copilot/)

  fs.rmSync(root, { recursive: true, force: true })
}

function testProfileInitUsesNestedNamespaceRoot() {
  const root = createTempRoot('devcodex-cli-profile-')
  writeJson(root, '.devcodex/layout.json', { version: 1, mode: 'workspace-namespace' })
  writeFile(root, 'packages/app-a/package.json', '{}\n')
  writeFile(root, 'packages/app-b/package.json', '{}\n')

  runCli(['profile', 'init', '--force'], path.join(root, 'packages', 'app-a'))
  runCli(['profile', 'init', '--force'], path.join(root, 'packages', 'app-b'))

  assert.ok(fs.existsSync(path.join(root, '.devcodex', 'packages', 'app-a', 'profile', 'config.json')))
  assert.ok(fs.existsSync(path.join(root, '.devcodex', 'packages', 'app-b', 'profile', 'config.json')))
  assert.ok(!fs.existsSync(path.join(root, '.devcodex', 'packages', 'profile', 'config.json')))

  fs.rmSync(root, { recursive: true, force: true })
}

function main() {
  testClaudeInitPreservesCustomConfig()
  testClaudeUpdateBacksUpAndPreservesCustomConfig()
  testDoctorAvoidsCodexBiasInMixedHostRepo()
  testProfileInitUsesNestedNamespaceRoot()
  process.stdout.write('cli behavior test passed\n')
}

main()
