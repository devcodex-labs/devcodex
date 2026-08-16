'use strict'

const fs = require('fs')
const path = require('path')

const HOST_HOOK_COMMAND_MARKER = 'devcodex-host-hook-v1'
const HOST_HOOK_RUNNER_SOURCE = "const a=JSON.parse(Buffer.from(process.argv[1],'base64url'));process.argv=[process.execPath,...a];require('module').runMain()"

function commandError(code, message) {
  const error = new Error(`${code}: ${message}`)
  error.code = code
  return error
}

function canonicalNodeExecutable(options = {}) {
  const fsImpl = options.fs || fs
  const candidate = path.resolve(options.executable || process.execPath)
  let executable
  try {
    executable = fsImpl.realpathSync.native
      ? fsImpl.realpathSync.native(candidate)
      : fsImpl.realpathSync(candidate)
  } catch (error) {
    throw commandError('GLOBAL_HOST_NODE_EXECUTABLE_UNRESOLVED', `${candidate}: ${error.message}`)
  }
  let stat
  try {
    stat = fsImpl.statSync(executable)
  } catch (error) {
    throw commandError('GLOBAL_HOST_NODE_EXECUTABLE_UNRESOLVED', `${executable}: ${error.message}`)
  }
  if (!stat.isFile()) {
    throw commandError('GLOBAL_HOST_NODE_EXECUTABLE_INVALID', executable)
  }
  if (/\0|\r|\n/.test(executable) || (process.platform === 'win32' && /[%!"]/.test(executable))) {
    throw commandError('GLOBAL_HOST_NODE_EXECUTABLE_SHELL_UNSAFE', executable)
  }
  return path.resolve(executable)
}

function quotePosixArgument(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`
}

function quoteWindowsArgument(value) {
  const text = String(value)
  if (/[\0\r\n%!]/.test(text)) {
    throw commandError('GLOBAL_HOST_COMMAND_TOKEN_SHELL_UNSAFE', 'Windows command token contains expansion syntax')
  }
  return `"${text
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\+)$/g, '$1$1')}"`
}

function quoteShellArgument(value, platform = process.platform) {
  return platform === 'win32' ? quoteWindowsArgument(value) : quotePosixArgument(value)
}

function buildHostHookCommand(runtimeFile, argv = [], options = {}) {
  const executable = canonicalNodeExecutable(options)
  const canonicalArgv = [path.resolve(runtimeFile), ...argv.map(value => String(value))]
  const payload = Buffer.from(JSON.stringify(canonicalArgv), 'utf8').toString('base64url')
  const platform = options.platform || process.platform
  const invocation = [
    quoteShellArgument(executable, platform),
    '-e',
    quoteShellArgument(HOST_HOOK_RUNNER_SOURCE, platform),
    '--',
    payload,
    HOST_HOOK_COMMAND_MARKER
  ]
  if (platform === 'win32') {
    // Grok Build executes command hooks through PowerShell on Windows, while
    // other supported hosts may use cmd.exe. A quoted executable as the first
    // PowerShell token is only a string expression, so its following `-e`
    // fails before Node can read the hook JSON. Starting with cmd.exe and using
    // CALL keeps the same canonical argv executable in both shells.
    return ['cmd.exe', '/d', '/s', '/c', 'call', ...invocation].join(' ')
  }
  return invocation.join(' ')
}

function decodeHostHookCommand(command) {
  const match = String(command || '').trim().match(
    /\s([A-Za-z0-9_-]+)\s+devcodex-host-hook-v1$/
  )
  if (!match) return null
  try {
    const argv = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'))
    if (!Array.isArray(argv) || !argv.length || argv.some(value => typeof value !== 'string')) return null
    return {
      schemaVersion: 'CanonicalHostHookCommandV1',
      executableMarker: HOST_HOOK_COMMAND_MARKER,
      argv
    }
  } catch {
    return null
  }
}

function rewriteHostHookCommandArgv(command, argv) {
  const value = String(command || '').trim()
  const decoded = decodeHostHookCommand(value)
  if (!decoded) {
    throw commandError('GLOBAL_HOST_COMMAND_NOT_CANONICAL', 'expected CanonicalHostHookCommandV1')
  }
  if (!Array.isArray(argv) || !argv.length || argv.some(item => typeof item !== 'string')) {
    throw commandError('GLOBAL_HOST_COMMAND_ARGV_INVALID', 'argv must be a non-empty string array')
  }
  const match = value.match(/\s([A-Za-z0-9_-]+)(\s+devcodex-host-hook-v1)$/)
  const payload = Buffer.from(JSON.stringify(argv), 'utf8').toString('base64url')
  return `${value.slice(0, match.index)} ${payload}${match[2]}`
}

module.exports = {
  HOST_HOOK_COMMAND_MARKER,
  HOST_HOOK_RUNNER_SOURCE,
  buildHostHookCommand,
  canonicalNodeExecutable,
  decodeHostHookCommand,
  quoteShellArgument,
  rewriteHostHookCommandArgv
}
