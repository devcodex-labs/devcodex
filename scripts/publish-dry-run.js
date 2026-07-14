#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { runSequenceChecked } = require('./lib/checked-command')

const ROOT = path.resolve(__dirname, '..')
const PACKAGE_NAME = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).name
const targets = {
  npmjs: { registry: 'https://registry.npmjs.org/', access: 'public' },
  github: { registry: 'https://npm.pkg.github.com/', access: 'restricted' }
}

function readTarget(argv) {
  const index = argv.indexOf('--registry')
  return index >= 0 ? argv[index + 1] : 'all'
}

function packageScope(packageName) {
  if (typeof packageName !== 'string' || !packageName.startsWith('@')) return null
  const slash = packageName.indexOf('/')
  return slash > 1 ? packageName.slice(0, slash) : null
}

function buildPublishArgs(name, packageName = PACKAGE_NAME) {
  const target = targets[name]
  if (!target) throw new Error(`Unknown registry target: ${name || '(missing)'}`)
  const args = [
    'publish',
    '--dry-run',
    '--json',
    '--ignore-scripts',
    `--registry=${target.registry}`,
    `--access=${target.access}`
  ]
  const scope = packageScope(packageName)
  if (scope) args.push(`--${scope}:registry=${target.registry}`)
  return args
}

function main(argv = process.argv.slice(2)) {
  const selected = readTarget(argv)
  if (!['npmjs', 'github', 'all'].includes(selected)) {
    console.error(`Unknown registry target: ${selected || '(missing)'}`)
    return 2
  }

  const names = selected === 'all' ? ['npmjs', 'github'] : [selected]
  const steps = [
    {
      label: 'package-boundary',
      command: 'npm',
      args: ['pack', '--dry-run', '--json', '--ignore-scripts']
    },
    ...names.map(name => ({
      label: `publish-dry-run:${name}`,
      command: 'npm',
      args: buildPublishArgs(name)
    }))
  ]

  try {
    const evidence = runSequenceChecked(steps, { cwd: ROOT, timeoutMs: 120000 })
    for (const item of evidence) {
      console.log(`✓ ${item.label}: exitCode=${item.exitCode} durationMs=${item.durationMs}`)
    }
    return 0
  } catch (error) {
    const evidence = error && error.evidence ? error.evidence : {}
    console.error(`✗ registry dry-run failed: command=${evidence.command || 'unknown'} exitCode=${evidence.exitCode}`)
    if (evidence.stderr) console.error(evidence.stderr)
    return 1
  }
}

if (require.main === module) process.exitCode = main()

module.exports = { buildPublishArgs, main, packageScope, readTarget, targets }
