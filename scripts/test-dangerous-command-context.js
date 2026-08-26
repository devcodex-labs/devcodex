'use strict'

const assert = require('assert')
const path = require('path')
const { buildLifecycleDangerousCommandUtils } = require('../hooks/_runtime/lifecycle-dangerous-command.cjs')

const ROOT = process.platform === 'win32' ? 'E:\\Worker' : '/home/runner/work'
const DANGEROUS_PATTERNS = [
  { re: /\brm\s+-rf\s+(?:\/|[A-Za-z]:\\?)(?:\s|$)/i, reason: 'root' },
  { re: /\brm\s+-rf\b/i, reason: 'recursive remove' },
  { re: /\bgit\s+reset\s+--hard\b/i, reason: 'hard reset' },
  { re: /\bdrop\s+table\b/i, reason: 'drop table' },
  { re: /\bdelete\s+from\b(?:(?!\bwhere\b|;)[\s\S])*(?:;|$)/i, reason: 'delete without where' },
  { re: /\btruncate\b/i, reason: 'truncate' },
  { re: /\bdel\s+\/f\s+\/q\b/i, reason: 'forced delete' },
  { re: /Remove-Item[\s\S]*-Recurse[\s\S]*-Force|Remove-Item[\s\S]*-Force[\s\S]*-Recurse/i, reason: 'recursive remove item' }
]

const utils = buildLifecycleDangerousCommandUtils({
  path,
  CONTEXT_ROOT: ROOT,
  WORKSPACE_ROOT: ROOT,
  DANGEROUS_PATTERNS,
  getToolName: payload => String(payload.tool_name || ''),
  getCommandText: payload => String(payload.tool_input?.command || ''),
})

function classify(command) {
  return utils.checkDangerousCommand({
    tool_name: 'shell_command',
    tool_input: { command, cwd: ROOT }
  }, 'codex')
}

function expectSafe(command, label) {
  assert.strictEqual(classify(command), null, label)
}

function expectAdvisory(command, label, code = null) {
  const result = classify(command)
  assert.ok(result, label)
  if (code) assert.strictEqual(result.code, code, label)
  assert.strictEqual(result.advisory, true, label)
  assert.strictEqual(result.permissionOwner, 'host', label)
}

expectSafe(
  "rg -n --no-heading 'DANGEROUS_PATTERNS|rm -rf|Remove-Item.*-Recurse.*-Force' hooks scripts",
  'quoted source-search patterns are data, not execution'
)
expectSafe(
  "$ErrorActionPreference='Stop'; rg -n 'rm -rf|DROP TABLE|DELETE FROM' hooks scripts",
  'a read-only search remains safe inside a compound command'
)
expectSafe('echo rm -rf /', 'an unquoted echo payload is still text')
expectSafe('Write-Output "Remove-Item target -Recurse -Force" | Set-Content safety.md', 'document output is not execution')
expectSafe("printf 'DROP TABLE users;' > migration-notes.md", 'quoted printf payload is not SQL execution')
expectSafe("Select-String -Pattern 'DELETE FROM users;' README.md", 'search pattern is not SQL execution')
expectSafe('git commit -m "document git reset --hard behavior"', 'commit message text is not a hard reset')
expectSafe(
  "apply_patch <<'PATCH'\n+example: rm -rf /\n+example: DROP TABLE users;\nPATCH",
  'heredoc patch content is not shell execution'
)
expectSafe(
  "rg -n 'Get-ChildItem -Recurse E:\\Worker' hooks",
  'workspace-recursion text inside a search pattern is not an inventory operation'
)
expectSafe(
  "rg -n 'Get-ChildItem C:\\Users\\example\\.grok\\skills' hooks",
  'host-skill path text inside a search pattern is not an inventory operation'
)

expectAdvisory('rm -rf build', 'direct recursive removal is classified without taking host permission')
expectAdvisory('Remove-Item "build" -Recurse -Force', 'direct PowerShell recursive removal is advisory')
expectAdvisory('git reset --hard', 'direct hard reset is advisory')
expectAdvisory("bash -c 'rm -rf build'", 'shell command-string execution is advisory')
expectAdvisory("Write-Output 'Remove-Item target -Recurse -Force' | Invoke-Expression", 'PowerShell expression execution is advisory')
expectAdvisory('mysql -e "DROP TABLE users;"', 'database command-string execution is advisory')
expectAdvisory('echo "$(rm -rf build)"', 'command substitution remains classifiable as executable')
expectAdvisory("rg -n 'rm -rf' hooks; Remove-Item build -Recurse -Force", 'a later destructive command is advisory')
expectAdvisory(`Get-ChildItem -Path "${ROOT}" -Recurse`, 'workspace-root inventory is advisory', 'workspace-root-scan-advisory')
expectAdvisory('Get-ChildItem "C:\\Users\\example\\.grok\\skills"', 'host-skill inventory is advisory', 'host-skill-inventory-advisory')

console.log('dangerous command context classification tests passed')
