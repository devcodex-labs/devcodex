'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const DEFAULT_MAX_BUFFER = 4 * 1024 * 1024
const DEFAULT_SUMMARY_LIMIT = 4000
const GLOB_VALUE_FLAGS = new Set(['-g', '--glob', '--include', '--exclude'])

class CheckedCommandError extends Error {
  constructor(message, evidence) {
    super(message)
    this.name = 'CheckedCommandError'
    this.code = evidence.code || 'ECOMMAND'
    this.evidence = evidence
  }
}

function summarize(value, limit = DEFAULT_SUMMARY_LIMIT) {
  const text = String(value || '')
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n…[truncated ${text.length - limit} chars]`
}

function isJsonArrayLiteral(value) {
  const text = String(value || '').trim()
  if (!text.startsWith('[') || !text.endsWith(']')) return false
  try {
    return Array.isArray(JSON.parse(text))
  } catch {
    return false
  }
}

function hasBracketPathGlob(value) {
  const text = String(value || '')
  if (isJsonArrayLiteral(text)) return false
  const hasCharacterClass = /\[(?:[!^])?[^\]\r\n]+\]/.test(text)
  const hasPathSemantics = /[\\/]/.test(text) || /\.[A-Za-z0-9_-]{1,16}(?:$|[?#])/.test(text)
  return hasCharacterClass && hasPathSemantics
}

function assertNoLiteralPathGlob(args) {
  let expectGlobValue = false
  for (const raw of args) {
    const arg = String(raw)
    if (expectGlobValue) {
      expectGlobValue = false
      continue
    }
    if (GLOB_VALUE_FLAGS.has(arg)) {
      expectGlobValue = true
      continue
    }
    if (Array.from(GLOB_VALUE_FLAGS).some(flag => arg.startsWith(`${flag}=`))) continue
    if (arg.startsWith('-')) continue
    if (/[*?]/.test(arg) || hasBracketPathGlob(arg)) {
      throw new CheckedCommandError(`Literal glob is not allowed as a positional path: ${arg}`, {
        code: 'ELITERALGLOB',
        command: null,
        args,
        cwd: null,
        exitCode: null,
        signal: null,
        durationMs: 0,
        stdout: '',
        stderr: ''
      })
    }
  }
}

function resolveExecutableOnPath (fileName, env = process.env) {
  const pathValue = String(env.PATH || env.Path || '')
  for (const rawDirectory of pathValue.split(path.delimiter)) {
    const directory = rawDirectory.trim().replace(/^"|"$/g, '')
    if (!directory) continue
    const candidate = path.join(directory, fileName)
    try {
      if (fs.statSync(candidate).isFile()) return candidate
    } catch {}
  }
  return null
}

function quoteWindowsBatchArgument (value) {
  const text = String(value)
  if (!text) return '""'
  if (!/[\s"&|<>^()%!]/.test(text)) return text
  const escaped = text
    .replace(/\^/g, '^^')
    .replace(/%/g, '^%')
    .replace(/(["&|<>])/g, '^$1')
  return `"${escaped}"`
}

function resolveWindowsBatchInvocation (command, args, env) {
  const unsafe = [command, ...args].find(value => /[\0\r\n"&|<>^()%!]/.test(String(value)))
  if (unsafe != null) {
    throw new CheckedCommandError('Windows batch fallback rejected shell-interpretable argv', {
      code: 'EWINDOWSBATCHARGV',
      command,
      args: args.map(String),
      cwd: null,
      exitCode: null,
      signal: null,
      durationMs: 0,
      stdout: '',
      stderr: `Unsafe batch argv token: ${String(unsafe)}`
    })
  }
  const comSpec = env.ComSpec || env.COMSPEC || path.join(
    env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows',
    'System32',
    'cmd.exe'
  )
  const commandLine = [command, ...args]
    .map(quoteWindowsBatchArgument)
    .join(' ')
  return {
    command: comSpec,
    args: ['/d', '/v:off', '/s', '/c', commandLine],
    batchCommand: command
  }
}

function resolveNpmInvocation(command, args, env) {
  if (process.platform !== 'win32' || !['npm', 'npx'].includes(command)) {
    return { command, args }
  }

  const cliName = command === 'npm' ? 'npm-cli.js' : 'npx-cli.js'
  const candidates = [
    command === 'npm' ? env.npm_execpath : null,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', cliName)
  ].filter(Boolean)
  const cliPath = candidates.find(candidate => fs.existsSync(candidate))
  if (cliPath) return { command: process.execPath, args: [cliPath, ...args] }

  const nativeExecutable = resolveExecutableOnPath(`${command}.exe`, env)
  if (nativeExecutable) return { command: nativeExecutable, args }

  const batchCommand = resolveExecutableOnPath(`${command}.cmd`, env) || `${command}.cmd`
  const siblingExecutable = batchCommand.toLowerCase().endsWith('.cmd')
    ? `${batchCommand.slice(0, -4)}.exe`
    : null
  if (siblingExecutable && fs.existsSync(siblingExecutable)) {
    return { command: siblingExecutable, args }
  }
  const installedCli = batchCommand.toLowerCase().endsWith('.cmd')
    ? path.join(path.dirname(batchCommand), 'node_modules', 'npm', 'bin', cliName)
    : null
  if (installedCli && fs.existsSync(installedCli)) {
    return { command: process.execPath, args: [installedCli, ...args] }
  }
  return resolveWindowsBatchInvocation(batchCommand, args, env)
}

/** Run a command and throw with structured evidence on any non-zero outcome. */
function runChecked(command, args = [], options = {}) {
  if (!command || typeof command !== 'string') throw new TypeError('command must be a non-empty string')
  if (!Array.isArray(args)) throw new TypeError('args must be an array')
  if (!options.cwd || typeof options.cwd !== 'string') throw new TypeError('options.cwd is required')
  if (options.shell === true && !String(options.allowShellReason || '').trim()) {
    throw new TypeError('shell=true requires allowShellReason')
  }

  assertNoLiteralPathGlob(args)
  const env = { ...process.env, ...(options.env || {}) }
  const invocation = resolveNpmInvocation(command, args.map(String), env)
  const startedAt = Date.now()
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: options.cwd,
    env,
    encoding: 'utf8',
    shell: options.shell === true,
    input: options.input,
    timeout: options.timeoutMs,
    maxBuffer: options.maxBuffer || DEFAULT_MAX_BUFFER,
    windowsHide: true
  })
  const evidence = {
    code: result.error && result.error.code ? result.error.code : (result.status === 0 ? 'OK' : 'ECOMMAND'),
    command,
    resolvedCommand: invocation.command,
    args: args.map(String),
    cwd: path.resolve(options.cwd),
    exitCode: typeof result.status === 'number' ? result.status : null,
    signal: result.signal || null,
    durationMs: Date.now() - startedAt,
    stdout: summarize(result.stdout, options.summaryLimit),
    stderr: summarize(result.stderr, options.summaryLimit)
  }

  if (result.error || result.status !== 0 || result.signal) {
    const reason = result.error
      ? result.error.message
      : `exitCode=${evidence.exitCode}${evidence.signal ? ` signal=${evidence.signal}` : ''}`
    throw new CheckedCommandError(`Command failed: ${command} (${reason})`, evidence)
  }
  return evidence
}

/** Run steps serially and stop immediately after the first failure. */
function runSequenceChecked(steps, options = {}) {
  if (!Array.isArray(steps)) throw new TypeError('steps must be an array')
  const results = []
  for (const step of steps) {
    const evidence = runChecked(step.command, step.args || [], {
      ...options,
      ...(step.options || {}),
      cwd: (step.options && step.options.cwd) || options.cwd
    })
    results.push({ label: step.label || step.command, ...evidence })
  }
  return results
}

module.exports = {
  CheckedCommandError,
  assertNoLiteralPathGlob,
  hasBracketPathGlob,
  resolveExecutableOnPath,
  resolveNpmInvocation,
  resolveWindowsBatchInvocation,
  runChecked,
  runSequenceChecked
}
