'use strict'

/**
 * Docs × public-surface inventory scanner (live disk truth).
 * Used by test-docs-surface-inventory and site-consistency gates.
 */

const fs = require('fs')
const path = require('path')
const { resolveControlAsset } = require('./control-content-delivery')

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

const REQUIRED_MCP_TOOLS = Object.freeze([
  'memory_artifact_link_project',
  'memory_cp_confirm',
  'memory_session_allocate',
  'memory_session_query',
  'memory_session_read',
  'memory_session_write',
  'memory_status',
  'memory_summary_append',
  'memory_summary_query',
  'memory_summary_read',
  'memory_task_admit_v2',
  'memory_task_closeout_reconcile_v1',
  'memory_task_fast_path_lease',
  'memory_task_resolve',
  'memory_task_terminal_v1',
  'memory_task_write_owner',
  'memory_workflow_operational_write_lease',
  'profile_compose_entry_check',
  'profile_context_plan',
  'profile_get_mode',
  'profile_load',
  'profile_skill_plan',
  'skill_route'
])

const REQUIRED_PROCESS_FILES = Object.freeze([
  'scripts/lib/process-enforcement.js',
  'scripts/lib/host-enforcement-matrix.js',
  'scripts/test-process-enforcement-e2e.js'
])

const PUBLIC_SITE_REQUIRED_MDX = Object.freeze([
  'public-site/docs/reference/skills.mdx'
])

const PUBLIC_SITE_MDX_FLOOR = PUBLIC_SITE_REQUIRED_MDX.length

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

function walkMdx (root, relDir, acc = []) {
  const full = path.join(root, relDir)
  if (!fs.existsSync(full)) return acc
  for (const e of fs.readdirSync(full, { withFileTypes: true })) {
    const r = path.join(relDir, e.name).replace(/\\/g, '/')
    const p = path.join(full, e.name)
    if (e.isDirectory()) walkMdx(root, r, acc)
    else if (/\.mdx$/i.test(e.name)) acc.push(r)
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
    if (
      m[1].startsWith('memory_') ||
      m[1].startsWith('profile_') ||
      m[1] === 'skill_route'
    ) names.add(m[1])
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
  const skillDirs = listDirs(root, 'content/skills')
  const skillWithMd = skillDirs.filter((d) =>
    fs.existsSync(path.join(root, 'content', 'skills', d, 'SKILL.md'))
  )

  const wf = JSON.parse(
    fs.readFileSync(resolveControlAsset(root, 'skills/routing/workflow-capabilities.json'), 'utf8')
  )
  const workflowIds = (Array.isArray(wf.workflows) ? wf.workflows : [])
    .map((w) => w.id)
    .filter(Boolean)
    .sort()

  const life = JSON.parse(fs.readFileSync(path.join(root, 'hooks/devcodex.lifecycle.json'), 'utf8'))
  const hookEvents = Object.keys(life.hooks || {}).sort()

  const hookRuntime = listFiles(root, 'hooks/_runtime', /\.cjs$/i)
  const prompts = listFiles(root, 'content/prompts', /\.prompt\.md$/i)
  const instructionsMain = listFiles(root, 'content/instructions', /\.instructions\.md$/i)
  const scriptsLib = listFiles(root, 'scripts/lib', /\.js$/i)
  const scriptsTop = listFiles(root, 'scripts', /\.(js|cjs|mjs)$/i)
  const npmScripts = Object.keys(pkg.scripts || {}).sort()
  const sourceCheckoutMode = fs.existsSync(path.join(root, '.git'))
  const publicSiteDocsRoot = path.join(root, 'public-site', 'docs')
  const publicSitePresent = fs.existsSync(publicSiteDocsRoot)
  const publicSiteMdx = publicSitePresent ? walkMdx(root, 'public-site/docs').sort() : []
  // website/ is maintainer-only and may be absent from public clones (not shipped in npm / public git).
  const websiteDocsRoot = path.join(root, 'website', 'docs')
  const websitePresent = fs.existsSync(websiteDocsRoot)
  const websiteMdx = websitePresent ? walkMdx(root, 'website/docs').sort() : []

  const gates = JSON.parse(
    fs.readFileSync(resolveControlAsset(root, 'skills/spec-governance/gate-registry.json'), 'utf8')
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
    sourceCheckoutMode,
    publicSitePresent,
    publicSiteMdx: publicSiteMdx.length,
    publicSiteMdxPaths: publicSiteMdx,
    websitePresent,
    websiteMdx: websiteMdx.length,
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

  const actualMcpTools = [...inv.mcpTools].sort()
  const requiredMcpTools = [...REQUIRED_MCP_TOOLS].sort()
  if (JSON.stringify(actualMcpTools) !== JSON.stringify(requiredMcpTools)) {
    const actual = new Set(actualMcpTools)
    const required = new Set(requiredMcpTools)
    const missing = requiredMcpTools.filter((name) => !actual.has(name))
    const unexpected = actualMcpTools.filter((name) => !required.has(name))
    failures.push(
      `mcp tools mismatch expected ${requiredMcpTools.length} got ${actualMcpTools.length}` +
      `${missing.length ? `; missing [${missing.join(',')}]` : ''}` +
      `${unexpected.length ? `; unexpected [${unexpected.join(',')}]` : ''}`
    )
  }

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
  if (inv.sourceCheckoutMode && !inv.publicSitePresent) {
    failures.push('public-site docs missing from source checkout')
  }
  if (inv.publicSitePresent && inv.publicSiteMdx < PUBLIC_SITE_MDX_FLOOR) {
    failures.push(`public-site mdx expected >=${PUBLIC_SITE_MDX_FLOOR} got ${inv.publicSiteMdx}`)
  }
  if (inv.publicSitePresent) {
    const present = new Set(inv.publicSiteMdxPaths || [])
    for (const required of PUBLIC_SITE_REQUIRED_MDX) {
      if (!present.has(required)) failures.push(`public-site missing ${required}`)
    }
  }
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
  REQUIRED_MCP_TOOLS,
  REQUIRED_PROCESS_FILES,
  PUBLIC_SITE_REQUIRED_MDX,
  PUBLIC_SITE_MDX_FLOOR,
  scanDocsSurfaceInventory,
  assertDocsSurfaceInventory
}
