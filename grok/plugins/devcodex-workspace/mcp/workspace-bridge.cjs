#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const {
  resolveGrokHome,
  resolveGrokRuntimeRoot
} = require('../lib/runtime-root.cjs')

const kind = String(process.argv[2] || '').trim().toLowerCase()
const cwd = path.resolve(process.argv[3] || process.cwd())
if (!['memory', 'profile'].includes(kind)) {
  process.stderr.write(`DevCodex Grok MCP bridge: unsupported server kind "${kind || '(missing)'}".\n`)
  process.exit(2)
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

const workspaceRoot = findWorkspaceRoot(cwd)
if (!workspaceRoot) {
  process.stderr.write('DevCodex Grok MCP bridge: current directory has no workspace-namespace .devcodex owner.\n')
  process.exit(2)
}

const grokHome = resolveGrokHome(process.env)
const serverPath = path.join(resolveGrokRuntimeRoot(process.env), 'mcp', `${kind}-server.js`)
if (!fs.existsSync(serverPath)) {
  process.stderr.write(`DevCodex Grok MCP bridge: user-global ${kind} server is missing from ${grokHome}.\n`)
  process.exit(2)
}

process.env.DEVCODEX_WORKSPACE_ROOT = workspaceRoot
const child = spawn(process.execPath, [serverPath, cwd], {
  cwd,
  env: process.env,
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe']
})
process.stdin.pipe(child.stdin)
child.stdout.pipe(process.stdout)
child.stderr.pipe(process.stderr)
child.on('error', error => {
  process.stderr.write(`DevCodex Grok MCP bridge: failed to start ${kind} server: ${error.message}\n`)
  process.exitCode = 2
})
child.on('exit', (code, signal) => {
  if (signal) {
    process.stderr.write(`DevCodex Grok MCP bridge: ${kind} server ended by ${signal}.\n`)
    process.exitCode = 1
    return
  }
  process.exitCode = Number.isInteger(code) ? code : 1
})
