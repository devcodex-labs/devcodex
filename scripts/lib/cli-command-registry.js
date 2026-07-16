'use strict'

function createCliCommandRegistry(commands) {
  const required = ['cmdInit', 'cmdInitClaude', 'cmdInitCodex', 'cmdStatus', 'cmdProfileInit', 'cmdDoctor', 'cmdProbe', 'cmdTrace', 'cmdHelp']
  for (const name of required) {
    if (typeof commands[name] !== 'function') throw new TypeError(`missing CLI command handler: ${name}`)
  }
  return Object.freeze({ ...commands })
}

function runCliCommand({ cmd, argv, registry, runMigrateLayout, process, c, console }) {
  const isClaude = argv.includes('--claude')
  const isCodex = argv.includes('--codex')
  if (isClaude && isCodex) {
    console.log(c.red('  --claude and --codex are mutually exclusive. Choose one adapter target.'))
    process.exitCode = 1
    return 'invalid-adapter-target'
  }

  const withoutTarget = argv.filter(item => item !== '--claude' && item !== '--codex')
  if (cmd === 'init') {
    if (isClaude) registry.cmdInitClaude(withoutTarget)
    else if (isCodex) registry.cmdInitCodex(withoutTarget)
    else registry.cmdInit(argv)
    return 'init'
  }
  if (cmd === 'update') {
    if (isClaude) registry.cmdInitClaude(['--force', ...withoutTarget])
    else if (isCodex) registry.cmdInitCodex(['--force', ...withoutTarget])
    else registry.cmdInit(['--force', ...argv])
    return 'update'
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
  if (cmd === 'status') { registry.cmdStatus(argv); return 'status' }
  if (cmd === 'doctor') { registry.cmdDoctor(argv); return 'doctor' }
  if (cmd === 'probe') { registry.cmdProbe(argv); return 'probe' }
  if (cmd === 'trace') { registry.cmdTrace(argv); return 'trace' }
  registry.cmdHelp()
  return 'help'
}

module.exports = { createCliCommandRegistry, runCliCommand }
