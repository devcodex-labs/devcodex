'use strict'

/**
 * Docs × public-surface inventory scanner (live disk truth).
 * Used by test-docs-surface-inventory and site-consistency gates.
 */

const fs = require('fs')
const path = require('path')

const REQUIRED_WORKFLOWS = Object.freeze([
  'analyze',
  'audit',
  'chat',
  'dev',
  'fix',
  'other',
  'resume',
  'self-fix'
])

const REQUIRED_HOOK_EVENTS = Object.freeze([
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PreCompact',
  'Stop'
])

const REQUIRED_PROCESS_FILES = Object.freeze([
  'scripts/lib/process-enforcement.js',
  'scripts/lib/host-enforcement-matrix.js',
  'scripts/test-process-enforcement-e2e.js'
])

function listDirs (root, dir) {
  const full = path.join(root, dir)
  if (!fs.existsSync(full)) return []
  return fs
    .readdirSync(full, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort()
}

function listFiles (root, dir, re) {
  const full = path.join(root, dir)
  if (!fs.existsSync(full)) return []
  return fs
    .readdirSync(full)
    .filter((f) => re.test(f))
    .sort()
}

function walkMd (root, relDir, acc = []) {
  const full = path.join(root, relDir)
  if (!fs.existsSync(full)) return acc
  for (const e of fs.readdirSync(full, { withFileTypes: true })) {
    const r = path.join(relDir, e.name).replace(/\\/g, '/')
    const p = path.join(full, e.name)
    if (e.isDirectory()) walkMd(root, r, acc)
    else if (/\.mdx?$/i.test(e.name)) acc.push(r)
  }
  return acc
}

function extractMcpToolNames (root, file) {
  const p = path.join(root, file)
  if (!fs.existsSync(p)) return []
  const text = fs.readFileSync(p, 'utf8')
  const names = new Set()
  const re = /name:\s*'([a-z][a-z0-9_]*)'/g
  let m
  while ((m = re.exec(text))) {
    if (m[1].startsWith('memory_') || m[1].startsWith('profile_')) names.add(m[1])
  }
  return [...names].sort()
}

/**
 * @param {string} root package root
 * @returns {object} live surface inventory
 */
function scanDocsSurfaceInventory (root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const plugin = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'))
  const pluginSkillIds = (plugin.skills || [])
    .map((s) => (typeof s === 'string' ? s : s.id))
    .filter(Boolean)
    .sort()
  const skillDirs = listDirs(root, 'skills')
  const skillWithMd = skillDirs.filter((d) =>
    fs.existsSync(path.join(root, 'skills', d, 'SKILL.md'))
  )

  const wf = JSON.parse(
    fs.readFileSync(path.join(root, 'skills/routing/workflow-capabilities.json'), 'utf8')
  )
  const workflowIds = (Array.isArray(wf.workflows) ? wf.workflows : [])
    .map((w) => w.id)
    .filter(Boolean)
    .sort()

  const life = JSON.parse(fs.readFileSync(path.join(root, 'hooks/devcodex.lifecycle.json'), 'utf8'))
  const hookEvents = Object.keys(life.hooks || {}).sort()

  const hookRuntime = listFiles(root, 'hooks/_runtime', /\.cjs$/i)
  const prompts = listFiles(root, 'prompts', /\.prompt\.md$/i)
  const instructionsMain = listFiles(root, 'instructions', /\.instructions\.md$/i)
  const scriptsLib = listFiles(root, 'scripts/lib', /\.js$/i)
  const scriptsTop = listFiles(root, 'scripts', /\.(js|cjs|mjs)$/i)
  const npmScripts = Object.keys(pkg.scripts || {}).sort()
  const websiteMd = walkMd(root, 'website/docs').sort()

  const gates = JSON.parse(
    fs.readFileSync(path.join(root, 'skills/spec-governance/gate-registry.json'), 'utf8')
  )
  let gateGroups = 0
  if (Array.isArray(gates.groups)) gateGroups = gates.groups.length
  else if (gates.groups && typeof gates.groups === 'object') gateGroups = Object.keys(gates.groups).length
  else if (gates.gateGroups) gateGroups = Object.keys(gates.gateGroups).length

  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'scripts/validation-manifest.json'), 'utf8')
  )
  const validationNodes = (manifest.nodes || []).map((n) => n.id).filter(Boolean)

  const memoryTools = extractMcpToolNames(root, 'mcp/memory-server.js')
  const profileTools = extractMcpToolNames(root, 'mcp/profile-server.js')

  const processFiles = {}
  for (const f of REQUIRED_PROCESS_FILES) {
    processFiles[f] = fs.existsSync(path.join(root, f))
  }

  return {
    schemaVersion: 'DocsSurfaceInventoryV1',
    skillDirs: skillDirs.length,
    skillWithMd: skillWithMd.length,
    pluginSkillIds: pluginSkillIds.length,
    skillOnlyPlugin: pluginSkillIds.filter((id) => !skillDirs.includes(id)),
    skillOnlyDisk: skillDirs.filter((id) => !pluginSkillIds.includes(id)),
    workflowIds,
    workflowCount: workflowIds.length,
    mcpTools: [...memoryTools, ...profileTools],
    mcpToolCount: memoryTools.length + profileTools.length,
    hookEvents,
    hookRuntimeCount: hookRuntime.length,
    prompts: prompts.length,
    instructionsMain: instructionsMain.length,
    scriptsLib: scriptsLib.length,
    scriptsTop: scriptsTop.length,
    npmScripts: npmScripts.length,
    websiteMd: websiteMd.length,
    gateGroups,
    validationNodes: validationNodes.length,
    processFiles,
    hasProcessEnforcementScript: Boolean(pkg.scripts && pkg.scripts['test:process-enforcement-e2e'])
  }
}

/**
 * @param {object} inv
 * @returns {{ ok: boolean, failures: string[] }}
 */
function assertDocsSurfaceInventory (inv) {
  const failures = []

  if (inv.skillDirs !== 86) failures.push(`skills dirs expected 86 got ${inv.skillDirs}`)
  if (inv.pluginSkillIds !== 86) failures.push(`plugin skills expected 86 got ${inv.pluginSkillIds}`)
  if (inv.skillWithMd !== inv.skillDirs) {
    failures.push(`SKILL.md missing for some skill dirs (${inv.skillWithMd}/${inv.skillDirs})`)
  }
  if (inv.skillOnlyPlugin.length) {
    failures.push(`plugin-only skills: ${inv.skillOnlyPlugin.join(',')}`)
  }
  if (inv.skillOnlyDisk.length) {
    failures.push(`disk-only skills: ${inv.skillOnlyDisk.join(',')}`)
  }

  const wfSorted = [...inv.workflowIds].sort()
  const reqSorted = [...REQUIRED_WORKFLOWS].sort()
  if (JSON.stringify(wfSorted) !== JSON.stringify(reqSorted)) {
    failures.push(`workflows mismatch got [${wfSorted.join(',')}]`)
  }
  if (inv.workflowIds.includes('plan')) {
    failures.push('workflow id "plan" must not exist (use other + plan Skill)')
  }

  if (inv.mcpToolCount !== 15) failures.push(`mcp tools expected 15 got ${inv.mcpToolCount}`)

  for (const ev of REQUIRED_HOOK_EVENTS) {
    if (!inv.hookEvents.includes(ev)) failures.push(`missing hook event ${ev}`)
  }
  if (inv.hookRuntimeCount < 26) {
    failures.push(`hook runtime cjs expected >=26 got ${inv.hookRuntimeCount}`)
  }

  if (inv.prompts !== 30) failures.push(`prompts expected 30 got ${inv.prompts}`)
  if (inv.instructionsMain !== 15) {
    failures.push(`instructions main expected 15 got ${inv.instructionsMain}`)
  }
  if (inv.websiteMd < 156) failures.push(`website md expected >=156 got ${inv.websiteMd}`)
  if (inv.gateGroups !== 51) failures.push(`gate groups expected 51 got ${inv.gateGroups}`)
  if (inv.validationNodes < 83) {
    failures.push(`validation nodes expected >=83 got ${inv.validationNodes}`)
  }
  // Floors frozen 2026-07-27 (maintainer-site-docs Fix-1): live after honesty/ecr/mcp deltas
  if (inv.npmScripts < 113) failures.push(`npm scripts expected >=113 got ${inv.npmScripts}`)
  if (inv.scriptsLib < 102) failures.push(`scripts/lib expected >=102 got ${inv.scriptsLib}`)

  for (const [f, ok] of Object.entries(inv.processFiles || {})) {
    if (!ok) failures.push(`missing required file ${f}`)
  }
  if (!inv.hasProcessEnforcementScript) {
    failures.push('package.json missing script test:process-enforcement-e2e')
  }

  return { ok: failures.length === 0, failures }
}

module.exports = {
  REQUIRED_WORKFLOWS,
  REQUIRED_HOOK_EVENTS,
  REQUIRED_PROCESS_FILES,
  scanDocsSurfaceInventory,
  assertDocsSurfaceInventory
}
