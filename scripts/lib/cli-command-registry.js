'use strict'

const { HOST_ALIASES, HOST_IDS } = require('./host-surface-descriptors')

function createCliCommandRegistry(commands) {
  const required = [
    'cmdInitWorkspaceRuntime', 'cmdInitHost', 'cmdUninstallHost', 'cmdGrok', 'cmdStatus',
    'cmdProfileInit', 'cmdDoctor', 'cmdProbe', 'cmdTrace', 'cmdSkill', 'cmdTask',
    'cmdGlobalAdapters', 'cmdRuntime', 'cmdTemp', 'cmdHelp'
  ]
  for (const name of required) {
    if (typeof commands[name] !== 'function') throw new TypeError(`missing CLI command handler: ${name}`)
  }
  return Object.freeze({ ...commands })
}

function parseHostSelection(argv = []) {
  const selections = []
  const cleanedArgv = []
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (Object.prototype.hasOwnProperty.call(HOST_ALIASES, arg)) {
      selections.push({ host: HOST_ALIASES[arg], flag: arg })
      continue
    }
    if (arg === '--host') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        return { ok: false, code: 'CLI_HOST_UNSUPPORTED', message: '--host requires a supported value.', cleanedArgv }
      }
      selections.push({ host: String(value).trim().toLowerCase(), flag: `--host ${value}` })
      index++
      continue
    }
    if (arg.startsWith('--host=')) {
      selections.push({ host: arg.slice('--host='.length).trim().toLowerCase(), flag: arg })
      continue
    }
    cleanedArgv.push(arg)
  }
  if (selections.length > 1) {
    return {
      ok: false,
      code: 'CLI_HOST_SELECTION_CONFLICT',
      message: `Host selectors are mutually exclusive and non-repeatable: ${selections.map(item => item.flag).join(', ')}`,
      cleanedArgv
    }
  }
  const host = selections[0]?.host || null
  if (host && host !== 'all' && !HOST_IDS.includes(host)) {
    return {
      ok: false,
      code: 'CLI_HOST_UNSUPPORTED',
      message: `Unsupported host "${host}". Use ${[...HOST_IDS, 'all'].join('|')}.`,
      cleanedArgv
    }
  }
  return { ok: true, host, cleanedArgv }
}

function isHelpCommand(cmd) {
  return !cmd || cmd === 'help' || cmd === '--help' || cmd === '-h'
}

function isVersionCommand(cmd) {
  return cmd === 'version' || cmd === '--version' || cmd === '-v'
}

function isHelpFlag(value) {
  return value === '--help' || value === '-h'
}

function runCliCommand({ cmd, argv, registry, runMigrateLayout, process, c, console, packageVersion = null }) {
  if (isHelpCommand(cmd)) {
    registry.cmdHelp(cmd === 'help' && argv.length ? argv : undefined)
    return 'help'
  }
  if (isVersionCommand(cmd)) {
    console.log(packageVersion || 'unknown')
    return 'version'
  }

  if (argv.some(isHelpFlag)) {
    registry.cmdHelp([cmd, ...argv.filter(item => !isHelpFlag(item))])
    return 'help'
  }

  const selection = parseHostSelection(argv)
  if (!selection.ok) {
    console.log(c.red(`  ${selection.code}: ${selection.message}`))
    process.exitCode = 2
    return selection.code
  }

  if (cmd === 'init') {
    if (selection.host) {
      registry.cmdInitHost(selection.host, ['--operation=init', ...selection.cleanedArgv])
      return 'CLI_HOST_CONFIG_GLOBAL_ONLY'
    } else {
      registry.cmdInitWorkspaceRuntime(selection.cleanedArgv, { refresh: false })
    }
    return 'init'
  }
  if (cmd === 'update') {
    if (selection.host) {
      registry.cmdInitHost(selection.host, ['--operation=update', ...selection.cleanedArgv])
      return 'CLI_HOST_CONFIG_GLOBAL_ONLY'
    } else {
      registry.cmdInitWorkspaceRuntime(selection.cleanedArgv, { refresh: true })
    }
    return 'update'
  }
  if (cmd === 'uninstall') {
    registry.cmdUninstallHost(selection.host || 'all', selection.cleanedArgv)
    return 'CLI_HOST_CONFIG_GLOBAL_ONLY'
  }
  if (cmd === 'profile') {
    if (argv[0] === 'init') {
      registry.cmdProfileInit(argv.slice(1))
      return 'profile-init'
    }
    if (argv[0] === 'plan') {
      registry.cmdProfileInit([...argv.slice(1).filter(item => item !== '--dry-run'), '--dry-run'])
      return 'profile-plan'
    }
    console.log(c.red(`  Unknown profile subcommand: ${argv[0] || '(none)'}`))
    console.log(c.dim('  Available: devcodex profile plan|init [--dry-run] [--force] [--prod] [--tier <profile-lite|profile-standard|profile-closed-loop>] [--allow-downgrade]'))
    process.exitCode = 1
    return 'invalid-profile-subcommand'
  }
  if (cmd === 'migrate-layout') {
    runMigrateLayout(argv)
    return 'migrate-layout'
  }
  if (cmd === 'runtime') { registry.cmdRuntime(argv); return 'runtime' }
  if (cmd === 'tmp') { registry.cmdTemp(argv); return 'tmp' }
  if (cmd === 'grok') { registry.cmdGrok(argv); return 'grok' }
  if (cmd === 'global-adapters') {
    registry.cmdGlobalAdapters(argv)
    return 'global-adapters'
  }
  if (cmd === 'status') { registry.cmdStatus(argv); return 'status' }
  if (cmd === 'doctor') { registry.cmdDoctor(argv); return 'doctor' }
  if (cmd === 'probe') { registry.cmdProbe(argv); return 'probe' }
  if (cmd === 'trace') { registry.cmdTrace(argv); return 'trace' }
  if (cmd === 'skill') { registry.cmdSkill(argv); return 'skill' }
  if (cmd === 'task') { registry.cmdTask(argv); return 'task' }
  console.log(c.red(`  CLI_COMMAND_UNKNOWN: Unknown command "${cmd}".`))
  console.log(c.dim('  Run devcodex help to see available commands.'))
  registry.cmdHelp()
  process.exitCode = 2
  return 'CLI_COMMAND_UNKNOWN'
}

module.exports = { createCliCommandRegistry, parseHostSelection, runCliCommand }
