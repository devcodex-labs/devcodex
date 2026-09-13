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
const currentOnly = args.includes('--current-only')
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

const results = targets.map(runTarget)
const sourceNamespace = path.basename(ROOT)

function resultKind(result) {
  if (result.status === 1) return 'error'
  if (result.status === 2) return 'warning'
  return 'ok'
}

function countKinds(items) {
  return items.reduce((acc, result) => {
    acc[resultKind(result)] += 1
    return acc
  }, { ok: 0, warning: 0, error: 0 })
}

function printResult(result, prefix = '[profile-all]') {
  if (result.status === 1) {
    console.log(`${prefix} ${result.namespace}: error`)
    const detail = indent(result.output)
    if (detail) console.log(detail)
  } else if (result.status === 2) {
    console.log(`${prefix} ${result.namespace}: warning`)
    const detail = indent(result.output)
    if (detail) console.log(detail)
  } else {
    console.log(`${prefix} ${result.namespace}: ok`)
  }
}

const currentProject = results.filter(result => result.namespace === sourceNamespace)
const workspaceDebt = results.filter(result => result.namespace !== sourceNamespace)
const currentCounts = countKinds(currentProject)
const workspaceCounts = countKinds(workspaceDebt)
const allCounts = countKinds(results)

if (currentOnly) {
  console.log(`[profile-current] current-project=${sourceNamespace} checked=${currentProject.length} errors=${currentCounts.error} warnings=${currentCounts.warning} strictWarnings=${strictWarnings}`)
  for (const result of currentProject) printResult(result, '[profile-current]')
  if (!currentProject.length) {
    console.error(`[profile-current] missing current project profile namespace: ${sourceNamespace}`)
    process.exit(1)
  }
  if (currentCounts.error || (strictWarnings && currentCounts.warning)) process.exit(1)
  process.exit(0)
}

console.log(`[profile-all] current-project=${sourceNamespace} checked=${currentProject.length} errors=${currentCounts.error} warnings=${currentCounts.warning}`)
for (const result of currentProject) printResult(result, '[profile-all][current-project]')

console.log(`[profile-all] workspace-debt checked=${workspaceDebt.length} errors=${workspaceCounts.error} warnings=${workspaceCounts.warning}`)
for (const result of workspaceDebt) printResult(result, '[profile-all][workspace-debt]')

console.log(`[profile-all] checked=${results.length} errors=${allCounts.error} warnings=${allCounts.warning} strictWarnings=${strictWarnings}`)
if (allCounts.error || (strictWarnings && allCounts.warning)) process.exit(1)
process.exit(0)
