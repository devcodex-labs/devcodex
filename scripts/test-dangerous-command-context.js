'use strict'

const assert = require('assert')
const crypto = require('crypto')
const path = require('path')
const { buildLifecycleDangerousCommandUtils } = require('../hooks/_runtime/lifecycle-dangerous-command.cjs')

const ROOT = process.platform === 'win32' ? 'E:\\Worker' : '/home/runner/work'
const DANGEROUS_PATTERNS = [
  { re: /\brm\s+-rf\s+(?:\/|[A-Za-z]:\\?)(?:\s|$)/i, reason: 'root', neverApprove: true },
  { re: /\brm\s+-rf\b/i, reason: 'recursive remove' },
  { re: /\bgit\s+reset\s+--hard\b/i, reason: 'hard reset' },
  { re: /\bdrop\s+table\b/i, reason: 'drop table', neverApprove: true },
  { re: /\bdelete\s+from\b(?:(?!\bwhere\b|;)[\s\S])*(?:;|$)/i, reason: 'delete without where', neverApprove: true },
  { re: /\btruncate\b/i, reason: 'truncate', neverApprove: true },
  { re: /\bdel\s+\/f\s+\/q\b/i, reason: 'forced delete' },
  { re: /Remove-Item[\s\S]*-Recurse[\s\S]*-Force|Remove-Item[\s\S]*-Force[\s\S]*-Recurse/i, reason: 'recursive remove item' }
]

const utils = buildLifecycleDangerousCommandUtils({
  path,
  crypto,
  CONTEXT_ROOT: ROOT,
  WORKSPACE_ROOT: ROOT,
  APPROVAL_TTL_MS: 600000,
  DANGEROUS_PATTERNS,
  getToolName: payload => String(payload.tool_name || ''),
  getCommandText: payload => String(payload.tool_input?.command || ''),
  INTERCEPTION_ACTION: { FORBID: 'forbid', LOG_ONLY: 'log' },
  recordInterception: () => {}
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

function expectBlocked(command, label, code = null) {
  const result = classify(command)
  assert.ok(result, label)
  if (code) assert.strictEqual(result.code, code, label)
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

expectBlocked('rm -rf build', 'direct recursive removal remains blocked')
expectBlocked('Remove-Item "build" -Recurse -Force', 'direct PowerShell recursive removal remains blocked')
expectBlocked('git reset --hard', 'direct hard reset remains blocked')
expectBlocked("bash -c 'rm -rf build'", 'shell command-string execution remains blocked')
expectBlocked("Write-Output 'Remove-Item target -Recurse -Force' | Invoke-Expression", 'PowerShell expression execution remains blocked')
expectBlocked('mysql -e "DROP TABLE users;"', 'database command-string execution remains blocked')
expectBlocked('echo "$(rm -rf build)"', 'command substitution inside output text remains executable')
expectBlocked("rg -n 'rm -rf' hooks; Remove-Item build -Recurse -Force", 'a later destructive command in a compound line remains blocked')
expectBlocked('Get-ChildItem -Path "E:\\Worker" -Recurse', 'actual workspace-root inventory remains blocked', 'workspace-root-scan-ban')
expectBlocked('Get-ChildItem "C:\\Users\\example\\.grok\\skills"', 'actual host-skill inventory remains blocked', 'host-skill-inventory-ban')

console.log('dangerous command context classification tests passed')
