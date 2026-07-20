#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const kind = String(process.argv[2] || '').trim().toLowerCase()
const cwd = path.resolve(process.argv[3] || process.cwd())
if (!['memory', 'profile'].includes(kind)) {
  process.stderr.write(`DevCodex Grok MCP bridge: unsupported server kind "${kind || '(missing)'}".\n`)
  process.exit(2)
}

const pluginRoot = path.resolve(process.env.GROK_PLUGIN_ROOT || path.join(__dirname, '..'))
function samePath(left, right) {
  const a = path.resolve(left)
  const b = path.resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
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
function workspaceFromPluginRoot(root) {
  const absolute = path.resolve(root)
  const sourceWorkspace = findWorkspaceRoot(absolute)
  if (sourceWorkspace) {
    const allowedSources = [
      path.join(sourceWorkspace, '.grok', 'devcodex', 'plugins', 'devcodex-workspace'),
      path.join(sourceWorkspace, '.grok', 'plugins', 'devcodex-workspace')
    ]
    if (allowedSources.some(candidate => samePath(candidate, absolute))) return sourceWorkspace
  }
  const installedRoot = path.dirname(absolute)
  if (path.basename(installedRoot).toLowerCase() !== 'installed-plugins') return null
  try {
    const registry = JSON.parse(fs.readFileSync(path.join(installedRoot, 'registry.json'), 'utf8'))
    const entry = Object.values(registry.repos || {}).find(candidate =>
      candidate?.kind?.type === 'Local' && samePath(candidate.path || '', absolute)
    )
    return entry?.kind?.source_path ? workspaceFromPluginRoot(entry.kind.source_path) : null
  } catch { return null }
}
const expectedWorkspace = workspaceFromPluginRoot(pluginRoot)
let current = cwd
let workspaceRoot = null
while (true) {
  const marker = path.join(current, '.devcodex', 'layout.json')
  try {
    const layout = JSON.parse(fs.readFileSync(marker, 'utf8'))
    if (String(layout.mode || '').trim() === 'workspace-namespace') {
      workspaceRoot = current
      break
    }
  } catch { }
  const parent = path.dirname(current)
  if (parent === current) break
  current = parent
}

if (!expectedWorkspace || !workspaceRoot || !samePath(workspaceRoot, expectedWorkspace)) {
  process.stderr.write('DevCodex Grok MCP bridge: current directory is outside the plugin owning workspace.\n')
  process.exit(2)
}

const serverCandidates = [
  path.join(workspaceRoot, '.claude', 'mcp', `${kind}-server.js`),
  path.join(workspaceRoot, '.github', 'mcp', `${kind}-server.js`)
]
const serverPath = serverCandidates.find(file => fs.existsSync(file))
if (!serverPath) {
  process.stderr.write(`DevCodex Grok MCP bridge: shared ${kind} server is missing from ${workspaceRoot}.\n`)
  process.exit(2)
}

process.argv = [process.execPath, serverPath, cwd]
require(serverPath)
