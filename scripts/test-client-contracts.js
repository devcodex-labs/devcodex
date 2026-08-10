#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const {
  createCanonicalAwareReader,
  evaluatePublicReadmeContract,
  hasValidCanonicalContract
} = require('./lib/canonical-consumer-contracts')
const { createLinkCapabilityDecision } = require('../hooks/_runtime/visible-output-contract.cjs')

const ROOT = path.resolve(__dirname, '..')
const failures = []
const publicReadme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')
const publicReadmeContract = evaluatePublicReadmeContract(publicReadme)
if (!publicReadmeContract.valid) {
  failures.push(`public README contract missing: ${publicReadmeContract.missing.join(', ')}`)
}
if (!hasValidCanonicalContract(
  ROOT,
  'README.md',
  publicReadme,
  'HistoricalCommonNormLayeringGate'
)) {
  failures.push('valid public README must retire legacy internal-anchor projection')
}
const damagedPublicReadme = publicReadme.replaceAll('npm install -g devcodex', '')
if (evaluatePublicReadmeContract(damagedPublicReadme).valid ||
    hasValidCanonicalContract(
      ROOT,
      'README.md',
      damagedPublicReadme,
      'HistoricalCommonNormLayeringGate'
    )) {
  failures.push('incomplete public README must not bypass legacy consumer checks')
}
const missingTaskTutorial = publicReadme.replace('## 常见任务怎么说', '## 任务示例')
if (evaluatePublicReadmeContract(missingTaskTutorial).valid) {
  failures.push('public README without the common-task tutorial must fail its contract')
}
const missingTroubleshooting = publicReadme.replace('## 常见问题与排错', '## 排错')
if (evaluatePublicReadmeContract(missingTroubleshooting).valid) {
  failures.push('public README without the troubleshooting entry must fail its contract')
}
const missingAdapterRepair = publicReadme.replaceAll('devcodex global-adapters apply', '')
if (evaluatePublicReadmeContract(missingAdapterRepair).valid) {
  failures.push('public README without the global adapter repair command must fail its contract')
}
const missingSandboxRecovery = publicReadme
  .replaceAll('sandbox-exec-denied', '')
  .replaceAll('GLOBAL_HOST_TARGET_UNVERIFIED', '')
if (evaluatePublicReadmeContract(missingSandboxRecovery).valid) {
  failures.push('public README without Windows sandbox/runtime recovery diagnostics must fail its contract')
}

const readAbsolute = createCanonicalAwareReader(ROOT, file => fs.readFileSync(file, 'utf8'))
const read = file => readAbsolute(path.join(ROOT, file))

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
  ['scripts/test-mcp-servers.js', 'testProfileLoadWithoutArguments']
]

for (const [file, needle] of clientContractProbes) mustInclude(file, needle)

const forcedCanonicalFallback = createCanonicalAwareReader(ROOT, file => {
  const error = new Error(`synthetic missing legacy delivery: ${file}`)
  error.code = 'ENOENT'
  throw error
})
if (!forcedCanonicalFallback(path.join(ROOT, 'prompts', 'report-dev.prompt.md')).includes('DevCodexVisibleEnvelopeV1')) {
  failures.push('canonical-aware reader did not resolve rendered content delivery')
}

// website/ is optional on public clones (maintainer-only docs site).
if (fs.existsSync(path.join(ROOT, 'website', 'docs', 'guide', 'development.md'))) {
  mustInclude('website/docs/guide/development.md', 'DevCodexVisibleEnvelopeV1')
  mustInclude('website/docs/guide/development.md', 'mcpFallback=used')
}

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
