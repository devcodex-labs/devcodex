#!/usr/bin/env node
'use strict'

/**
 * Live docs/public-surface inventory gate (Fix-0 / V-GAP-01/02).
 */

const path = require('path')
const {
  scanDocsSurfaceInventory,
  assertDocsSurfaceInventory
} = require('./lib/docs-surface-inventory.js')

const ROOT = path.resolve(__dirname, '..')
const inv = scanDocsSurfaceInventory(ROOT)
const result = assertDocsSurfaceInventory(inv)

if (!result.ok) {
  console.error('docs-surface-inventory FAILED:')
  for (const f of result.failures) console.error(' -', f)
  console.error(JSON.stringify({ skillDirs: inv.skillDirs, workflows: inv.workflowIds, mcp: inv.mcpToolCount }, null, 2))
  process.exit(1)
}

console.log('docs-surface-inventory PASS')
console.log(
  JSON.stringify(
    {
      skills: inv.skillDirs,
      workflows: inv.workflowCount,
      mcpTools: inv.mcpToolCount,
      hooks: inv.hookEvents.length,
      hookRuntime: inv.hookRuntimeCount,
      prompts: inv.prompts,
      instructions: inv.instructionsMain,
      publicSitePresent: inv.publicSitePresent,
      publicSiteMd: inv.publicSiteMd,
      websitePresent: inv.websitePresent,
      websiteMd: inv.websiteMd,
      npmScripts: inv.npmScripts,
      scriptsLib: inv.scriptsLib,
      validationNodes: inv.validationNodes,
      gateGroups: inv.gateGroups,
      processFiles: inv.processFiles
    },
    null,
    2
  )
)
