#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { hasValidCanonicalContract } = require('./lib/canonical-consumer-contracts')
const { createLinkCapabilityDecision } = require('../hooks/_runtime/visible-output-contract.cjs')

const ROOT = path.resolve(__dirname, '..')
const failures = []

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8')
}

function mustInclude(file, needle) {
  const content = read(file)
  if (!content.includes(needle) && !hasValidCanonicalContract(ROOT, file, content, needle)) failures.push(`${file} missing "${needle}"`)
}

function mustMatch(file, pattern, label) {
  if (!pattern.test(read(file))) failures.push(`${file} missing pattern ${label || pattern}`)
}

const clientContractProbes = [
  ['instructions.md', 'ArtifactDeliveryManifestV1'],
  ['instructions.md', 'LinkCapabilityDecisionV1'],
  ['instructions.md', 'mcpFallback=used'],
  ['instructions/01-common.instructions.md', 'UserFacingArtifactSetV1'],
  ['instructions/01-common.instructions.md', 'mcpFallback=used'],
  ['instructions/02-output-paths.instructions.md', 'LinkCapabilityDecision 客户端兼容矩阵'],
  ['instructions/02-output-paths.instructions.md', 'capability mode'],
  ['instructions/02-output-paths.instructions.md', '`clickable`'],
  ['instructions/02-output-paths.instructions.md', '`portable`'],
  ['instructions/02-output-paths.instructions.md', '`failed`'],
  ['instructions/02-output-paths.instructions.md', 'MCP profile fallback'],
  ['instructions/02-output-paths.instructions.md', 'invoke'],
  ['instructions/16-report.instructions.md', 'ArtifactDeliveryManifestV1'],
  ['instructions/17-compliance.instructions.md', 'UserFacingArtifactSetV1'],
  ['skills/host-contract-verification/SKILL.md', 'artifactLinkMatrix'],
  ['skills/host-contract-verification/SKILL.md', 'VisibleOutputHostEvidenceGate'],
  ['skills/host-contract-verification/SKILL.md', 'mcpFallback'],
  ['skills/test-router/SKILL.md', 'visibleOutputContract'],
  ['skills/execution-contract/SKILL.md', 'MCP fallback'],
  ['skills/report/SKILL.md', 'ArtifactDeliveryManifestV1'],
  ['skills/compliance/SKILL.md', 'LinkCapabilityDecisionV1'],
  ['skills/audit-common/SKILL.md', 'UserFacingArtifactSetV1'],
  ['prompts/implementation-plan.prompt.md', 'VisibleOutputContract'],
  ['prompts/implementation-progress.prompt.md', 'mcpFallback'],
  ['prompts/report-dev.prompt.md', 'DevCodexVisibleEnvelopeV1.semanticDigest'],
  ['prompts/report-fix.prompt.md', 'mcpFallback'],
  ['README.md', '用户可见交付与链接兼容'],
  ['README.md', 'profile_load'],
  ['README.md', 'invoke'],
  ['website/docs/guide/development.md', 'DevCodexVisibleEnvelopeV1'],
  ['website/docs/guide/development.md', 'mcpFallback=used'],
  ['scripts/test-mcp-servers.js', 'testProfileLoadWithoutArguments']
]

for (const [file, needle] of clientContractProbes) mustInclude(file, needle)

mustMatch(
  'instructions/02-output-paths.instructions.md',
  /-\s*\[[^\]]+\]\(\.devcodex\/[^\)]+\.md\)/,
  'Artifact markdown link example'
)
mustInclude('instructions/02-output-paths.instructions.md', '绝对路径：')
mustInclude('instructions/02-output-paths.instructions.md', '禁止只输出裸文件名')
mustInclude('skills/host-contract-verification/SKILL.md', 'Cannot read properties of undefined')

for (const surface of ['copilot', 'claude-code', 'codex-app', 'grok', 'gemini', 'unknown']) {
  const decision = createLinkCapabilityDecision({
    surface,
    evidenceState: 'unverified',
    supportsClickable: true,
    supportsMarkdown: true,
    targetRelation: 'workspace'
  })
  if (!decision.validation.valid || decision.mode !== 'portable' || decision.absolutePathFallback) {
    failures.push(`${surface} inferred capability without evidence: ${JSON.stringify(decision)}`)
  }
}

const clickable = createLinkCapabilityDecision({
  surface: 'verified-surface', evidenceState: 'verified', supportsClickable: true,
  supportsMarkdown: true, targetRelation: 'workspace', evidenceRefs: ['verified-click-probe']
})
if (clickable.mode !== 'clickable' || clickable.absolutePathFallback) failures.push('verified clickable surface duplicated absolute fallback')

const failedLink = createLinkCapabilityDecision({
  surface: 'failed-surface', evidenceState: 'verified', supportsClickable: true,
  supportsMarkdown: true, targetRelation: 'workspace', linkFailed: true, evidenceRefs: ['failed-link-probe']
})
if (failedLink.mode !== 'failed' || !failedLink.absolutePathFallback || failedLink.fallbackReason !== 'link-failed') {
  failures.push('failed link did not produce reason-bound absolute fallback')
}

if (failures.length) {
  console.error('Client contract checks failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Client contract checks passed: evidence-driven visible output + bounded MCP fallback')
