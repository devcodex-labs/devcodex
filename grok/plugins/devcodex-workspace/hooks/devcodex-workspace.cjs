#!/usr/bin/env node
'use strict'

/**
 * DevCodex Grok workspace bridge.
 * Must emit Grok-native { decision: "deny"|"allow", reason? } for PreToolUse.
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const {
  resolveGrokHome,
  resolveGrokRuntimeRoot
} = require('../lib/runtime-root.cjs')

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

function noop(payload) {
  return isPreTool(payload) ? { decision: 'allow' } : { continue: true }
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

/** Classify operation risk for diagnostics without taking permission from Grok. */
function localRiskAdvisory(payload) {
  if (!isPreTool(payload)) return null
  const cmd = extractCommand(payload)
  if (!cmd) return null
  const patterns = [
    { re: /\brm\s+-rf\s+(?:\/|[A-Za-z]:\\?)(?:\s|$)/i, reason: 'Advisory: rm -rf root' },
    { re: /\brm\s+-rf\b/i, reason: 'Advisory: rm -rf' },
    { re: /\bgit\s+reset\s+--hard\b/i, reason: 'Advisory: git reset --hard' },
    { re: /\bdrop\s+table\b/i, reason: 'Advisory: DROP TABLE' },
    { re: /\btruncate\b/i, reason: 'Advisory: TRUNCATE' },
    { re: /\bdel\s+\/f\s+\/q\b/i, reason: 'Advisory: del /f /q' },
    { re: /Remove-Item[\s\S]*-Recurse[\s\S]*-Force|Remove-Item[\s\S]*-Force[\s\S]*-Recurse/i, reason: 'Advisory: Remove-Item -Recurse -Force' }
  ]
  for (const entry of patterns) {
    if (entry.re.test(cmd)) {
      return { code: 'operation-risk-advisory', reason: entry.reason }
    }
  }
  return null
}

function globalAdapterPath(env = process.env, options = {}) {
  return path.join(
    resolveGrokRuntimeRoot(env, options),
    'hooks',
    '_runtime',
    'lifecycle-host-adapters.cjs'
  )
}

function probeWorkspaceBridgeContract(options = {}) {
  const env = options.env || process.env
  const cwd = path.resolve(options.cwd || process.cwd())
  const workspaceRoot = findWorkspaceRoot(cwd)
  const adapter = path.resolve(options.adapterPath || globalAdapterPath(env, options))
  const issues = []
  let adapterProbe = null

  if (!workspaceRoot) issues.push('workspace-owner-missing')
  if (!fs.existsSync(adapter)) {
    issues.push('global-adapter-missing')
  } else {
    try {
      const runtime = require(adapter)
      adapterProbe = runtime.probeHostAdapterContract?.('grok') || null
      if (adapterProbe?.status !== 'passed') issues.push('global-adapter-contract-failed')
    } catch (error) {
      issues.push(`global-adapter-load-failed:${error.code || error.message}`)
    }
  }

  return {
    schemaVersion: 'GrokWorkspaceHookContractProbeV1',
    status: issues.length ? 'failed' : 'passed',
    workspaceRoot,
    adapter,
    adapterProbe,
    issues
  }
}

function diagnosticPath(pluginRoot, env = process.env, options = {}) {
  const base = env.GROK_PLUGIN_DATA
    || path.join(resolveGrokHome(env, options), 'devcodex', 'diagnostics', 'grok')
    || path.join(os.tmpdir(), 'devcodex-grok-hook-diagnostics')
  return path.join(base, 'pretool-last.json')
}

function writeDiagnostic(pluginRoot, record, env = process.env, options = {}) {
  try {
    const file = diagnosticPath(pluginRoot, env, options)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `${JSON.stringify({ ...record, at: new Date().toISOString() }, null, 2)}\n`, 'utf8')
  } catch {
    // ignore
  }
}

function resolveCwdCandidates(payload, options = {}) {
  const candidates = [
    options.cwd,
    payload?.cwd,
    payload?.workspaceRoot,
    payload?.workspace_root,
    (options.env || process.env).GROK_WORKSPACE_ROOT,
    (options.env || process.env).CLAUDE_PROJECT_DIR,
    (options.env || process.env).DEVCODEX_WORKSPACE_ROOT
  ].filter(Boolean)
  return (candidates.length ? candidates : [process.cwd()])
    .map((value) => path.resolve(String(value)))
}

function resolveWorkspace(payload, options = {}) {
  const candidates = resolveCwdCandidates(payload, options)
  const discovered = candidates.map((start) => ({ start, found: findWorkspaceRoot(start) }))
  const firstFound = discovered.find(item => item.found) || null
  return {
    discoveredWorkspace: firstFound?.found || null,
    cwd: firstFound?.start || candidates[0] || process.cwd(),
    via: firstFound ? 'nearest-workspace-layout' : 'outside-workspace'
  }
}

function runWorkspaceBridge(payload, options = {}) {
  const env = options.env || process.env
  const spawn = options.spawnSync || spawnSync
  const pluginRoot = path.resolve(options.pluginRoot || env.GROK_PLUGIN_ROOT || path.join(__dirname, '..'))
  const resolved = resolveWorkspace(payload || {}, { ...options, env })
  const { discoveredWorkspace, cwd, via } = resolved

  if (!discoveredWorkspace) {
    const riskAdvisory = localRiskAdvisory(payload)
    writeDiagnostic(pluginRoot, {
      phase: 'outside-workspace',
      via,
      discoveredWorkspace,
      cwd,
      command: extractCommand(payload),
      event: eventName(payload),
      riskAdvisory
    }, env, options)
    return { status: 0, workspaceRoot: null, output: noop(payload), reason: 'outside-workspace' }
  }

  const adapter = path.resolve(options.adapterPath || globalAdapterPath(env, options))
  let output = noop(payload)
  let adapterNote = 'global-adapter-missing'

  if (fs.existsSync(adapter)) {
    const child = spawn(process.execPath, [adapter, 'grok'], {
      cwd,
      input: JSON.stringify(payload || {}),
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      env: {
        ...env,
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
      output = parsed.decision ? parsed : (parsed.continue === false ? deny(parsed.reason || 'blocked') : noop(payload))
      adapterNote = 'adapter-ok'
    } else if (child.status !== 0) {
      const riskAdvisory = localRiskAdvisory(payload)
      writeDiagnostic(pluginRoot, {
        phase: 'global-adapter-failed',
        status: child.status,
        stderr: String(child.stderr || '').slice(0, 2000),
        stdout: stdout.slice(0, 2000),
        riskAdvisory
      }, env, options)
      return {
        status: 0,
        workspaceRoot: discoveredWorkspace,
        output: noop(payload),
        reason: 'global-adapter-failed-degraded',
        diagnostic: String(child.stderr || child.stdout || 'global lifecycle adapter failed').trim()
      }
    } else {
      const riskAdvisory = localRiskAdvisory(payload)
      writeDiagnostic(pluginRoot, {
        phase: 'global-adapter-invalid-output',
        adapter,
        discoveredWorkspace,
        cwd,
        event: eventName(payload),
        stdout: stdout.slice(0, 2000),
        riskAdvisory
      }, env, options)
      return {
        status: 0,
        workspaceRoot: discoveredWorkspace,
        output: noop(payload),
        reason: 'global-adapter-invalid-output-degraded'
      }
    }
  } else {
    const riskAdvisory = localRiskAdvisory(payload)
    writeDiagnostic(pluginRoot, {
      phase: 'global-adapter-missing',
      adapter,
      discoveredWorkspace,
      cwd,
      event: eventName(payload),
      command: extractCommand(payload),
      riskAdvisory
    }, env, options)
    return {
      status: 0,
      workspaceRoot: discoveredWorkspace,
      output: noop(payload),
      reason: 'global-adapter-missing-degraded'
    }
  }

  const riskAdvisory = localRiskAdvisory(payload)

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
    riskAdvisory,
    output
  }, env, options)

  return {
    status: 0,
    workspaceRoot: discoveredWorkspace,
    output,
    kernelInjected: false,
    evidenceMode: isPreTool(payload) ? 'blocking-tool-hook' : 'passive-hook-no-context-injection',
    reason: 'global-adapter-active'
  }
}

if (require.main === module) {
  if (process.argv[2] === '--contract-probe') {
    const probe = probeWorkspaceBridgeContract()
    process.stdout.write(JSON.stringify(probe))
    process.exit(probe.status === 'passed' ? 0 : 1)
  } else readInput().then((payload) => {
    const pluginRoot = path.resolve(process.env.GROK_PLUGIN_ROOT || path.join(__dirname, '..'))
    const result = runWorkspaceBridge(payload)
    if (result.status !== 0) {
      process.stderr.write(`DevCodex Grok workspace bridge: ${result.reason}\n`)
      process.stdout.write(JSON.stringify(noop(payload)))
      process.exit(0)
      return
    }
    const output = result.output || noop(payload)
    process.stdout.write(JSON.stringify(output))
    if (output.decision === 'deny') process.exit(2)
    process.exit(0)
  }).catch((error) => {
    process.stderr.write(`DevCodex Grok workspace bridge: invalid hook payload: ${error.message}\n`)
    process.stdout.write(JSON.stringify({ decision: 'allow' }))
    process.exit(0)
  })
}

module.exports = {
  findWorkspaceRoot,
  runWorkspaceBridge,
  samePath,
  globalAdapterPath,
  probeWorkspaceBridgeContract,
  localRiskAdvisory,
  isUnder
}
