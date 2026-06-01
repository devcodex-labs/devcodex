#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const failures = []

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8')
}

function mustInclude(file, needle) {
  if (!read(file).includes(needle)) failures.push(`${file} missing "${needle}"`)
}

function mustMatch(file, pattern, label) {
  if (!pattern.test(read(file))) failures.push(`${file} missing pattern ${label || pattern}`)
}

const clientContractProbes = [
  ['instructions.md', 'ArtifactLinkSet'],
  ['instructions.md', 'mcpFallback=used'],
  ['instructions/01-common.instructions.md', 'ArtifactLinkSet'],
  ['instructions/01-common.instructions.md', 'mcpFallback=used'],
  ['instructions/02-output-paths.instructions.md', 'ArtifactLinkSet 客户端兼容矩阵'],
  ['instructions/02-output-paths.instructions.md', 'Copy fallback'],
  ['instructions/02-output-paths.instructions.md', 'GitHub Copilot'],
  ['instructions/02-output-paths.instructions.md', 'Codex Desktop/App'],
  ['instructions/02-output-paths.instructions.md', 'MCP profile fallback'],
  ['instructions/02-output-paths.instructions.md', 'invoke'],
  ['instructions/16-report.instructions.md', 'ArtifactLinkSet'],
  ['instructions/17-compliance.instructions.md', 'ArtifactLinkSet'],
  ['skills/host-contract-verification/SKILL.md', 'artifactLinkMatrix'],
  ['skills/host-contract-verification/SKILL.md', 'mcpFallback'],
  ['skills/test-router/SKILL.md', 'ArtifactLinkSet'],
  ['skills/execution-contract/SKILL.md', 'MCP fallback'],
  ['skills/report/SKILL.md', 'ArtifactLinkSet'],
  ['skills/compliance/SKILL.md', 'ArtifactLinkSet'],
  ['skills/audit-common/SKILL.md', 'ArtifactLinkSet'],
  ['prompts/implementation-plan.prompt.md', 'artifactLinkMatrix'],
  ['prompts/implementation-progress.prompt.md', 'mcpFallback'],
  ['prompts/report-dev.prompt.md', 'artifactLinkMatrix'],
  ['prompts/report-fix.prompt.md', 'mcpFallback'],
  ['README.md', '产物文件链接兼容'],
  ['README.md', 'profile_load'],
  ['README.md', 'invoke'],
  ['website/docs/guide/development.md', 'ArtifactLinkSet'],
  ['website/docs/guide/development.md', 'mcpFallback=used'],
  ['scripts/test-mcp-servers.js', 'testProfileLoadWithoutArguments']
]

for (const [file, needle] of clientContractProbes) mustInclude(file, needle)

mustMatch(
  'instructions/02-output-paths.instructions.md',
  /-\s*\[[^\]]+\]\(workspace相对路径\/file\.md\)/,
  'Artifact markdown link example'
)
mustInclude('instructions/02-output-paths.instructions.md', '绝对路径：')
mustInclude('instructions/02-output-paths.instructions.md', '禁止只输出裸文件名')
mustInclude('skills/host-contract-verification/SKILL.md', 'Cannot read properties of undefined')
mustMatch(
  'instructions/02-output-paths.instructions.md',
  /GitHub Copilot[^\n]*\|[^\n]*强制追加[^\n]*\|/,
  'Copilot artifact fallback is mandatory'
)
mustMatch(
  'README.md',
  /Copilot \/ JetBrains \/ Visual Studio[^\n]*强制同时给 `绝对路径：\.\.\.`/,
  'README Copilot fallback is mandatory'
)
mustInclude('website/docs/guide/development.md', '强制追加绝对路径 fallback')

if (failures.length) {
  console.error('Client contract checks failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Client contract checks passed')
