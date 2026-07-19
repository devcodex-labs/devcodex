#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

function samePath(left, right) {
  const a = path.resolve(left)
  const b = path.resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function noop() {
  return { continue: true }
}

function findWorkspaceRoot(start) {
  let current = path.resolve(start)
  while (true) {
    const marker = path.join(current, '.devcodex', 'layout.json')
    try {
      const layout = JSON.parse(fs.readFileSync(marker, 'utf8'))
      if (String(layout.mode || '').trim() === 'workspace-namespace') return current
    } catch { }
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function workspaceFromPluginRoot(pluginRoot) {
  const absolute = path.resolve(pluginRoot)
  if (
    path.basename(path.dirname(absolute)).toLowerCase() === 'plugins' &&
    path.basename(path.dirname(path.dirname(absolute))).toLowerCase() === '.grok'
  ) {
    return path.dirname(path.dirname(path.dirname(absolute)))
  }
  const installedRoot = path.dirname(absolute)
  if (path.basename(installedRoot).toLowerCase() !== 'installed-plugins') return null
  try {
    const registry = JSON.parse(fs.readFileSync(path.join(installedRoot, 'registry.json'), 'utf8'))
    const entry = Object.values(registry.repos || {}).find(candidate =>
      candidate?.kind?.type === 'Local' &&
      samePath(candidate.path || '', absolute) &&
      candidate.kind.source_path
    )
    if (!entry) return null
    return workspaceFromPluginRoot(path.resolve(entry.kind.source_path))
  } catch {
    return null
  }
}

function readInput() {
  return new Promise((resolve, reject) => {
    let input = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => { input += chunk })
    process.stdin.on('end', () => {
      try { resolve(input.trim() ? JSON.parse(input) : {}) } catch (error) { reject(error) }
    })
  })
}

function eventName(payload) {
  return String(payload?.hookEventName || payload?.hook_event_name || payload?.eventName || payload?.event || '').trim()
}

function runWorkspaceBridge(payload, options = {}) {
  const cwd = path.resolve(options.cwd || payload?.cwd || process.cwd())
  const pluginRoot = path.resolve(options.pluginRoot || process.env.GROK_PLUGIN_ROOT || path.join(__dirname, '..'))
  const expectedWorkspace = workspaceFromPluginRoot(pluginRoot)
  const discoveredWorkspace = findWorkspaceRoot(cwd)
  if (!expectedWorkspace || !discoveredWorkspace || !samePath(expectedWorkspace, discoveredWorkspace)) {
    return { status: 0, workspaceRoot: null, output: noop(), reason: 'outside-managed-workspace' }
  }

  const kernelPath = path.join(discoveredWorkspace, 'AGENTS.md')
  if (!fs.existsSync(kernelPath)) {
    return { status: 2, workspaceRoot: discoveredWorkspace, output: null, reason: 'workspace-kernel-missing' }
  }

  const adapterCandidates = [
    path.join(discoveredWorkspace, '.codex', 'hooks', '_runtime', 'lifecycle-host-adapters.cjs'),
    path.join(discoveredWorkspace, '.claude', 'hooks', '_runtime', 'lifecycle-host-adapters.cjs')
  ]
  const adapter = adapterCandidates.find(file => fs.existsSync(file))
  let output = noop()
  if (adapter) {
    const child = spawnSync(process.execPath, [adapter, 'grok'], {
      cwd,
      input: JSON.stringify(payload || {}),
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, DEVCODEX_WORKSPACE_ROOT: discoveredWorkspace }
    })
    if (child.status !== 0) {
      return {
        status: child.status || 1,
        workspaceRoot: discoveredWorkspace,
        output: null,
        reason: String(child.stderr || child.stdout || 'workspace lifecycle failed').trim()
      }
    }
    try { output = child.stdout.trim() ? JSON.parse(child.stdout) : noop() } catch (error) {
      return { status: 1, workspaceRoot: discoveredWorkspace, output: null, reason: `invalid lifecycle output: ${error.message}` }
    }
  }

  return {
    status: 0,
    workspaceRoot: discoveredWorkspace,
    output,
    kernelInjected: false,
    evidenceMode: eventName(payload) === 'PreToolUse' ? 'blocking-tool-hook' : 'passive-hook-no-context-injection',
    reason: adapter ? 'workspace-active' : 'workspace-kernel-present'
  }
}

if (require.main === module) {
  readInput().then(payload => {
    const result = runWorkspaceBridge(payload)
    if (result.status !== 0) {
      process.stderr.write(`DevCodex Grok workspace bridge: ${result.reason}\n`)
      process.exit(result.status)
      return
    }
    process.stdout.write(JSON.stringify(result.output))
  }).catch(error => {
    process.stderr.write(`DevCodex Grok workspace bridge: invalid hook payload: ${error.message}\n`)
    process.exit(2)
  })
}

module.exports = {
  findWorkspaceRoot,
  runWorkspaceBridge,
  samePath,
  workspaceFromPluginRoot
}
