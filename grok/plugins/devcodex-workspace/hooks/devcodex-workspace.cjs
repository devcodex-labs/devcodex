#!/usr/bin/env node
'use strict'

/**
 * DevCodex Grok workspace bridge.
 * Must emit Grok-native { decision: "deny"|"allow", reason? } for PreToolUse.
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawnSync } = require('child_process')

function samePath(left, right) {
  const a = path.resolve(left)
  const b = path.resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function isUnder(root, target) {
  if (!root || !target) return false
  const r = path.resolve(root)
  const t = path.resolve(target)
  const rel = path.relative(r, t)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function noop() {
  return { decision: 'allow' }
}

function deny(reason) {
  return { decision: 'deny', reason: String(reason || 'DevCodex denied this tool call.') }
}

function findWorkspaceRoot(start) {
  if (!start) return null
  let current = path.resolve(start)
  while (true) {
    const marker = path.join(current, '.devcodex', 'layout.json')
    try {
      const layout = JSON.parse(fs.readFileSync(marker, 'utf8'))
      if (String(layout.mode || '').trim() === 'workspace-namespace') return current
    } catch { /* keep walking */ }
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function workspaceFromPluginRoot(pluginRoot) {
  const absolute = path.resolve(pluginRoot)
  const sourceWorkspace = findWorkspaceRoot(absolute)
  if (sourceWorkspace) {
    const allowedSources = [
      path.join(sourceWorkspace, '.grok', 'devcodex', 'plugins', 'devcodex-workspace'),
      path.join(sourceWorkspace, '.grok', 'plugins', 'devcodex-workspace')
    ]
    if (allowedSources.some((candidate) => samePath(candidate, absolute))) return sourceWorkspace
  }
  const installedRoot = path.dirname(absolute)
  if (path.basename(installedRoot).toLowerCase() !== 'installed-plugins') return null
  try {
    const registry = JSON.parse(fs.readFileSync(path.join(installedRoot, 'registry.json'), 'utf8'))
    const entry = Object.values(registry.repos || {}).find((candidate) =>
      candidate?.kind?.type === 'Local'
      && samePath(candidate.path || '', absolute)
      && candidate.kind.source_path
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
    process.stdin.on('data', (chunk) => { input += chunk })
    process.stdin.on('end', () => {
      try { resolve(input.trim() ? JSON.parse(input) : {}) } catch (error) { reject(error) }
    })
  })
}

function eventName(payload) {
  return String(
    payload?.hookEventName || payload?.hook_event_name || payload?.eventName || payload?.event || ''
  ).trim()
}

function isPreTool(payload) {
  const token = eventName(payload).toLowerCase().replace(/[^a-z]/g, '')
  return token === 'pretooluse' || token === 'beforetool'
}

function extractCommand(payload) {
  const input = payload?.toolInput || payload?.tool_input || {}
  if (typeof input.command === 'string') return input.command
  if (typeof input.commandLine === 'string') return input.commandLine
  if (typeof input.script === 'string') return input.script
  if (typeof payload?.command === 'string') return payload.command
  return ''
}

/** Belt-and-suspenders: deny known dangerous shells even if lifecycle path fails. */
function localDangerDeny(payload) {
  if (!isPreTool(payload)) return null
  const cmd = extractCommand(payload)
  if (!cmd) return null
  const patterns = [
    { re: /\brm\s+-rf\s+(?:\/|[A-Za-z]:\\?)(?:\s|$)/i, reason: 'Blocked: rm -rf root' },
    { re: /\brm\s+-rf\b/i, reason: 'Blocked: rm -rf' },
    { re: /\bgit\s+reset\s+--hard\b/i, reason: 'Blocked: git reset --hard' },
    { re: /\bdrop\s+table\b/i, reason: 'Blocked: DROP TABLE' },
    { re: /\btruncate\b/i, reason: 'Blocked: TRUNCATE' },
    { re: /\bdel\s+\/f\s+\/q\b/i, reason: 'Blocked: del /f /q' },
    { re: /Remove-Item[\s\S]*-Recurse[\s\S]*-Force|Remove-Item[\s\S]*-Force[\s\S]*-Recurse/i, reason: 'Blocked: Remove-Item -Recurse -Force' }
  ]
  for (const entry of patterns) {
    if (entry.re.test(cmd)) return deny(entry.reason)
  }
  return null
}

function diagnosticPath(pluginRoot) {
  const base = process.env.GROK_PLUGIN_DATA
    || path.join(pluginRoot, '.devcodex-hook-diagnostics')
    || path.join(os.tmpdir(), 'devcodex-grok-hook-diagnostics')
  return path.join(base, 'pretool-last.json')
}

function writeDiagnostic(pluginRoot, record) {
  try {
    const file = diagnosticPath(pluginRoot)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `${JSON.stringify({ ...record, at: new Date().toISOString() }, null, 2)}\n`, 'utf8')
  } catch {
    // ignore
  }
}

function resolveCwdCandidates(payload, options = {}) {
  return [
    options.cwd,
    payload?.cwd,
    payload?.workspaceRoot,
    payload?.workspace_root,
    process.env.GROK_WORKSPACE_ROOT,
    process.env.CLAUDE_PROJECT_DIR,
    process.env.DEVCODEX_WORKSPACE_ROOT,
    process.cwd()
  ].filter(Boolean).map((value) => path.resolve(String(value)))
}

function resolveWorkspace(pluginRoot, payload, options = {}) {
  const expectedWorkspace = workspaceFromPluginRoot(pluginRoot)
  const candidates = resolveCwdCandidates(payload, options)

  for (const start of candidates) {
    const found = findWorkspaceRoot(start)
    if (found && expectedWorkspace && samePath(found, expectedWorkspace)) {
      return { expectedWorkspace, discoveredWorkspace: found, cwd: start, via: 'walk-match' }
    }
  }

  // Plugin is bound to a workspace: if any candidate is under it, use the bound workspace.
  if (expectedWorkspace) {
    const under = candidates.find((start) => isUnder(expectedWorkspace, start))
    if (under) {
      return {
        expectedWorkspace,
        discoveredWorkspace: expectedWorkspace,
        cwd: under,
        via: 'under-expected'
      }
    }
    // Last resort: session still on this plugin → trust bound workspace for PreTool safety.
    if (isPreTool(payload)) {
      return {
        expectedWorkspace,
        discoveredWorkspace: expectedWorkspace,
        cwd: candidates[0] || expectedWorkspace,
        via: 'plugin-bound-fallback'
      }
    }
  }

  const firstFound = candidates.map(findWorkspaceRoot).find(Boolean) || null
  return {
    expectedWorkspace,
    discoveredWorkspace: firstFound,
    cwd: candidates[0] || process.cwd(),
    via: firstFound ? 'walk-other' : 'none'
  }
}

function runWorkspaceBridge(payload, options = {}) {
  const pluginRoot = path.resolve(options.pluginRoot || process.env.GROK_PLUGIN_ROOT || path.join(__dirname, '..'))
  const resolved = resolveWorkspace(pluginRoot, payload || {}, options)
  const { expectedWorkspace, discoveredWorkspace, cwd, via } = resolved

  if (!expectedWorkspace || !discoveredWorkspace || !samePath(expectedWorkspace, discoveredWorkspace)) {
    const local = localDangerDeny(payload)
    writeDiagnostic(pluginRoot, {
      phase: 'outside-managed-workspace',
      via,
      expectedWorkspace,
      discoveredWorkspace,
      cwd,
      command: extractCommand(payload),
      event: eventName(payload),
      localDeny: local
    })
    // Outside workspace: still deny known destructive shells (fail closed for safety).
    if (local) {
      return { status: 0, workspaceRoot: null, output: local, reason: 'outside-managed-local-danger-deny' }
    }
    return { status: 0, workspaceRoot: null, output: noop(), reason: 'outside-managed-workspace' }
  }

  const kernelPath = path.join(discoveredWorkspace, 'AGENTS.md')
  if (!fs.existsSync(kernelPath)) {
    writeDiagnostic(pluginRoot, { phase: 'kernel-missing', discoveredWorkspace })
    return { status: 2, workspaceRoot: discoveredWorkspace, output: null, reason: 'workspace-kernel-missing' }
  }

  const adapterCandidates = [
    path.join(discoveredWorkspace, '.codex', 'hooks', '_runtime', 'lifecycle-host-adapters.cjs'),
    path.join(discoveredWorkspace, '.claude', 'hooks', '_runtime', 'lifecycle-host-adapters.cjs')
  ]
  const adapter = adapterCandidates.find((file) => fs.existsSync(file))
  let output = noop()
  let adapterNote = 'no-adapter'

  if (adapter) {
    const child = spawnSync(process.execPath, [adapter, 'grok'], {
      cwd,
      input: JSON.stringify(payload || {}),
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      env: {
        ...process.env,
        DEVCODEX_WORKSPACE_ROOT: discoveredWorkspace,
        DEVCODEX_HOST_PLATFORM: 'grok'
      }
    })
    const stdout = String(child.stdout || '').trim()
    let parsed = null
    if (stdout) {
      try { parsed = JSON.parse(stdout) } catch { parsed = null }
    }
    // Prefer explicit deny from child even when exit code is non-zero.
    if (parsed && parsed.decision === 'deny') {
      output = deny(parsed.reason || 'DevCodex denied this tool call.')
      adapterNote = 'adapter-deny'
    } else if (child.status === 0 && parsed) {
      output = parsed.decision ? parsed : (parsed.continue === false ? deny(parsed.reason || 'blocked') : noop())
      adapterNote = 'adapter-ok'
    } else if (child.status !== 0) {
      const local = localDangerDeny(payload)
      writeDiagnostic(pluginRoot, {
        phase: 'adapter-failed',
        status: child.status,
        stderr: String(child.stderr || '').slice(0, 2000),
        stdout: stdout.slice(0, 2000),
        localDeny: local
      })
      if (local) {
        return {
          status: 0,
          workspaceRoot: discoveredWorkspace,
          output: local,
          reason: 'adapter-failed-local-danger-deny'
        }
      }
      return {
        status: child.status || 1,
        workspaceRoot: discoveredWorkspace,
        output: null,
        reason: String(child.stderr || child.stdout || 'workspace lifecycle failed').trim()
      }
    }
  }

  // Local danger check wins if adapter allowed a known-dangerous shell.
  const local = localDangerDeny(payload)
  if (local && (!output || output.decision !== 'deny')) {
    output = local
    adapterNote = `${adapterNote}+local-danger-override`
  }

  writeDiagnostic(pluginRoot, {
    phase: 'complete',
    via,
    cwd,
    workspaceRoot: discoveredWorkspace,
    adapter: adapter || null,
    adapterNote,
    event: eventName(payload),
    toolName: payload?.toolName || payload?.tool_name || '',
    command: extractCommand(payload),
    output
  })

  return {
    status: 0,
    workspaceRoot: discoveredWorkspace,
    output,
    kernelInjected: false,
    evidenceMode: isPreTool(payload) ? 'blocking-tool-hook' : 'passive-hook-no-context-injection',
    reason: adapter ? 'workspace-active' : 'workspace-kernel-present'
  }
}

if (require.main === module) {
  readInput().then((payload) => {
    const pluginRoot = path.resolve(process.env.GROK_PLUGIN_ROOT || path.join(__dirname, '..'))
    const result = runWorkspaceBridge(payload)
    if (result.status !== 0) {
      process.stderr.write(`DevCodex Grok workspace bridge: ${result.reason}\n`)
      // Still try local deny so we never fail-open on destructive shells.
      const local = localDangerDeny(payload)
      if (local) {
        process.stdout.write(JSON.stringify(local))
        process.exit(2)
      }
      process.exit(result.status)
      return
    }
    const output = result.output || noop()
    process.stdout.write(JSON.stringify(output))
    if (output.decision === 'deny') process.exit(2)
    process.exit(0)
  }).catch((error) => {
    process.stderr.write(`DevCodex Grok workspace bridge: invalid hook payload: ${error.message}\n`)
    process.exit(2)
  })
}

module.exports = {
  findWorkspaceRoot,
  runWorkspaceBridge,
  samePath,
  workspaceFromPluginRoot,
  localDangerDeny,
  isUnder
}
