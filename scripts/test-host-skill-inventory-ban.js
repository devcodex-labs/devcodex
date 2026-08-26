'use strict'

/**
 * Host skill inventory ban — process UI must not list user-profile skill roots.
 */

const assert = require('assert')
const path = require('path')
const { buildLifecycleDangerousCommandUtils } = require('../hooks/_runtime/lifecycle-dangerous-command.cjs')

const utils = buildLifecycleDangerousCommandUtils({
  path,
  crypto: require('crypto'),
  CONTEXT_ROOT: 'E:\\Worker',
  WORKSPACE_ROOT: 'E:\\Worker',
  APPROVAL_TTL_MS: 600000,
  DANGEROUS_PATTERNS: [],
  getToolName: (p) => String(p.tool_name || p.toolName || ''),
  getCommandText: (p) => String((p.tool_input || p.toolInput || {}).command || ''),
  INTERCEPTION_ACTION: { FORBID: 'forbid', LOG_ONLY: 'log' },
  recordInterception: () => {}
})

const { checkHostSkillInventoryListing, isHostSkillInventoryTarget, checkDangerousCommand } = utils

assert.strictEqual(isHostSkillInventoryTarget('C:\\Users\\shihu\\.grok\\skills'), true)
assert.strictEqual(isHostSkillInventoryTarget('C:\\Users\\shihu\\.grok\\bundled\\skills'), true)
assert.strictEqual(isHostSkillInventoryTarget('C:\\Users\\shihu\\.agents\\skills'), true)
assert.strictEqual(isHostSkillInventoryTarget('C:\\Users\\shihu\\.codex\\skills'), true)
assert.strictEqual(
  isHostSkillInventoryTarget('C:\\Users\\shihu\\.agents\\devcodex\\skills\\skill-load-verify\\SKILL.md'),
  false
)
assert.strictEqual(
  isHostSkillInventoryTarget('C:\\Users\\shihu\\.codex\\skills\\.system\\openai-docs\\SKILL.md'),
  false
)

const listGrok = checkHostSkillInventoryListing({
  tool_name: 'list_dir',
  tool_input: { path: 'C:\\Users\\shihu\\.grok\\skills' }
}, 'grok')
assert.ok(listGrok && listGrok.code === 'host-skill-inventory-advisory' && listGrok.permissionOwner === 'host', 'list_dir grok skills advisory')

const listBundled = checkDangerousCommand({
  tool_name: 'List',
  tool_input: { target_directory: 'C:\\Users\\shihu\\.grok\\bundled\\skills' }
}, 'grok')
assert.ok(listBundled && listBundled.code === 'host-skill-inventory-advisory' && listBundled.advisory === true, 'List bundled advisory')

const shellList = checkDangerousCommand({
  tool_name: 'run_terminal_command',
  tool_input: { command: 'Get-ChildItem C:\\Users\\shihu\\.grok\\skills' }
}, 'grok')
assert.ok(shellList && shellList.code === 'host-skill-inventory-advisory' && shellList.permissionOwner === 'host', 'shell list advisory')

const allowWorkspaceSkill = checkHostSkillInventoryListing({
  tool_name: 'read_file',
  tool_input: { path: 'E:\\Worker\\.devcodex\\workspace\\skills\\test\\SKILL.md' }
}, 'grok')
assert.strictEqual(allowWorkspaceSkill, null, 'workspace skill read allowed')

const allowGRuntime = checkHostSkillInventoryListing({
  tool_name: 'read_file',
  tool_input: { path: 'C:\\Users\\shihu\\.agents\\devcodex\\skills\\skill-load-verify\\SKILL.md' }
}, 'grok')
assert.strictEqual(allowGRuntime, null, 'G_RUNTIME single skill read allowed')

const allowCodexSystemSkill = checkHostSkillInventoryListing({
  tool_name: 'read_file',
  tool_input: { path: 'C:\\Users\\shihu\\.codex\\skills\\.system\\openai-docs\\SKILL.md' }
}, 'codex')
assert.strictEqual(allowCodexSystemSkill, null, 'exact Codex system SKILL.md read allowed')

const blockCodexSkillRoot = checkHostSkillInventoryListing({
  tool_name: 'list_dir',
  tool_input: { path: 'C:\\Users\\shihu\\.codex\\skills' }
}, 'codex')
assert.ok(blockCodexSkillRoot && blockCodexSkillRoot.code === 'host-skill-inventory-advisory' && blockCodexSkillRoot.advisory === true, 'Codex skill root inventory remains advisory')

console.log('test-host-skill-inventory advisory: ok')
