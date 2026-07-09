#!/usr/bin/env node
/**
 * DevCodex — validate every profile namespace under a .devcodex workspace.
 *
 * Exit: 0=all required checks pass, 1=any profile has errors.
 * Warnings are summarized and fail only with --strict-warnings.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SCRIPT = path.join(ROOT, 'scripts', 'validate-profile.js')
const args = process.argv.slice(2)

function argValue(name) {
  const index = args.indexOf(name)
  if (index === -1 || index + 1 >= args.length) return ''
  return args[index + 1]
}

function samePath(a, b) {
  if (!a || !b) return false
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
}

const workspaceRoot = path.resolve(argValue('--workspace') || path.dirname(ROOT))
const strictWarnings = args.includes('--strict-warnings')
const devcodexRoot = path.join(workspaceRoot, '.devcodex')
const workspaceProfile = path.join(devcodexRoot, 'workspace', 'profile')
const sourceProjectRoot = path.join(workspaceRoot, path.basename(ROOT))

function collectProfileTargets() {
  if (!fs.existsSync(devcodexRoot)) {
    console.error(`[profile-all] missing .devcodex directory: ${devcodexRoot}`)
    process.exit(1)
  }

  const targets = []
  if (fs.existsSync(workspaceProfile)) {
    targets.push({ namespace: 'workspace', profileDir: workspaceProfile, projectRoot: workspaceRoot })
  }

  for (const entry of fs.readdirSync(devcodexRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name === 'workspace') continue
    const profileDir = path.join(devcodexRoot, entry.name, 'profile')
    if (!fs.existsSync(profileDir)) continue
    const projectRoot = path.join(workspaceRoot, entry.name)
    targets.push({
      namespace: entry.name,
      profileDir,
      projectRoot: fs.existsSync(projectRoot) ? projectRoot : workspaceRoot
    })
  }

  return targets.sort((a, b) => a.namespace.localeCompare(b.namespace))
}

function indent(text) {
  return String(text || '')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => `    ${line}`)
    .join('\n')
}

function runTarget(target) {
  const commandArgs = [
    SCRIPT,
    '--profile-dir',
    target.profileDir,
    '--workspace-profile',
    workspaceProfile
  ]

  if (target.namespace === path.basename(ROOT) && fs.existsSync(path.join(sourceProjectRoot, 'package.json'))) {
    commandArgs.push('--project-root', sourceProjectRoot, '--source-repo-profile')
  } else if (!samePath(target.projectRoot, workspaceRoot)) {
    commandArgs.push('--project-root', target.projectRoot)
  }

  const result = spawnSync(process.execPath, commandArgs, {
    cwd: target.projectRoot,
    encoding: 'utf8'
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`
  return {
    namespace: target.namespace,
    status: result.status || 0,
    output
  }
}

const targets = collectProfileTargets()
if (!targets.length) {
  console.warn(`[profile-all] no profiles found under ${devcodexRoot}`)
  process.exit(0)
}

let errorCount = 0
let warningCount = 0
const results = targets.map(runTarget)

for (const result of results) {
  if (result.status === 1) {
    errorCount += 1
    console.error(`[profile-all] ${result.namespace}: error`)
    const detail = indent(result.output)
    if (detail) console.error(detail)
  } else if (result.status === 2) {
    warningCount += 1
    console.warn(`[profile-all] ${result.namespace}: warning`)
    const detail = indent(result.output)
    if (detail) console.warn(detail)
  } else {
    console.log(`[profile-all] ${result.namespace}: ok`)
  }
}

console.log(`[profile-all] checked=${results.length} errors=${errorCount} warnings=${warningCount} strictWarnings=${strictWarnings}`)
if (errorCount || (strictWarnings && warningCount)) process.exit(1)
process.exit(0)
