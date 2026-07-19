#!/usr/bin/env node
'use strict'

// lifecycleStatus: retired-compatibility-fixture
// Current workspace descriptors MUST NOT deploy this project-local MCP bridge.
// The supported implementation lives in grok/plugins/devcodex-workspace/mcp/.

const fs = require('fs')
const path = require('path')

const kind = String(process.argv[2] || '').trim().toLowerCase()
const projectRoot = path.resolve(process.argv[3] || process.cwd())
if (!['memory', 'profile'].includes(kind)) {
  process.stderr.write(`DevCodex Grok MCP bridge: unsupported server kind "${kind || '(missing)'}".\n`)
  process.exit(2)
}

let current = projectRoot
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

if (!workspaceRoot) {
  process.stderr.write(`DevCodex Grok MCP bridge: workspace-namespace marker not found from ${projectRoot}.\n`)
  process.exit(2)
}

const serverPath = path.join(workspaceRoot, '.claude', 'mcp', `${kind}-server.js`)
if (!fs.existsSync(serverPath)) {
  process.stderr.write(`DevCodex Grok MCP bridge: shared server missing at ${serverPath}. Run DevCodex update from the workspace root.\n`)
  process.exit(2)
}

process.argv = [process.execPath, serverPath, projectRoot]
require(serverPath)
