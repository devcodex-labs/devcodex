#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const {
  createCanonicalAwareReader,
  hasValidCanonicalContract
} = require('./lib/canonical-consumer-contracts')
const {
  createHostLinkCapabilityDecisionV2,
  createLinkCapabilityDecision,
  resolveArtifactDelivery
} = require('../hooks/_runtime/visible-output-contract.cjs')

const ROOT = path.resolve(__dirname, '..')
const failures = []

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
  ['instructions.md', 'HostLinkCapabilityDecisionV2'],
  ['instructions.md', 'mcpFallback=used'],
  ['instructions/01-common.instructions.md', 'UserFacingArtifactSetV1'],
  ['instructions/01-common.instructions.md', 'mcpFallback=used'],
  ['instructions/02-output-paths.instructions.md', 'LinkCapabilityDecision 客户端兼容矩阵'],
  ['instructions/02-output-paths.instructions.md', 'HostLinkCapabilityDecisionV2'],
  ['instructions/02-output-paths.instructions.md', 'ArtifactDeliveryAttemptV1'],
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
  ['skills/host-contract-verification/SKILL.md', 'presentationSurface'],
  ['skills/host-contract-verification/SKILL.md', 'readback'],
  ['skills/host-contract-verification/SKILL.md', 'mcpFallback'],
  ['skills/test-router/SKILL.md', 'visibleOutputContract'],
  ['skills/execution-contract/SKILL.md', 'MCP fallback'],
  ['skills/report/SKILL.md', 'ArtifactDeliveryManifestV1'],
  ['skills/compliance/SKILL.md', 'LinkCapabilityDecisionV1'],
  ['skills/compliance/SKILL.md', 'HostLinkCapabilityDecisionV2'],
  ['skills/audit-common/SKILL.md', 'UserFacingArtifactSetV1'],
  ['prompts/implementation-plan.prompt.md', 'VisibleOutputContract'],
  ['prompts/implementation-progress.prompt.md', 'mcpFallback'],
  ['prompts/report-dev.prompt.md', 'DevCodexVisibleEnvelopeV3.semanticDigest'],
  ['prompts/report-fix.prompt.md', 'mcpFallback'],
  ['scripts/test-mcp-servers.js', 'testProfileLoadWithoutArguments']
]

for (const [file, needle] of clientContractProbes) mustInclude(file, needle)

const forcedCanonicalFallback = createCanonicalAwareReader(ROOT, file => {
  const error = new Error(`synthetic missing legacy delivery: ${file}`)
  error.code = 'ENOENT'
  throw error
})
if (!forcedCanonicalFallback(path.join(ROOT, 'prompts', 'report-dev.prompt.md')).includes('DevCodexVisibleEnvelopeV3')) {
  failures.push('canonical-aware reader did not resolve rendered content delivery')
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

for (const [hostSurface, presentationSurface, rendererId, openMode] of [
  ['codex-desktop', 'codex-desktop-panel', 'codex-native-file-link', 'markdown-link'],
  ['vscode-codex', 'vscode-terminal', 'vscode-cli-goto', 'terminal-command'],
  ['zed', 'zed-terminal', 'zed-cli-open', 'terminal-command'],
  ['webstorm', 'jetbrains-terminal', 'webstorm-cli-open', 'terminal-command'],
  ['claude-code', 'claude-terminal', 'absolute-path-copy', 'absolute-copy'],
  ['codex-cli', 'terminal', 'absolute-path-copy', 'absolute-copy']
]) {
  const decision = createHostLinkCapabilityDecisionV2({
    hostSurface,
    presentationSurface,
    evidenceState: 'verified',
    targetRelation: 'workspace',
    evidenceRefs: [`host-contract:${hostSurface}`]
  })
  if (!decision.validation.valid || decision.rendererId !== rendererId || decision.openMode !== openMode) {
    failures.push(`${hostSurface}/${presentationSurface} renderer mismatch: ${JSON.stringify(decision)}`)
  }
}

const mismatchedPresentation = createHostLinkCapabilityDecisionV2({
  hostSurface: 'codex-desktop', presentationSurface: 'vscode-terminal', evidenceState: 'verified',
  targetRelation: 'workspace', evidenceRefs: ['host-presentation-mismatch']
})
if (mismatchedPresentation.openMode !== 'absolute-copy' || mismatchedPresentation.fallbackReason !== 'presentation-host-mismatch') {
  failures.push(`presentation surface did not own renderer selection: ${JSON.stringify(mismatchedPresentation)}`)
}

const rendererOnlyNative = createHostLinkCapabilityDecisionV2({
  hostSurface: 'codex-app', presentationSurface: 'codex-desktop-panel', evidenceState: 'verified',
  targetRelation: 'workspace', evidenceRefs: ['native-capability-only'],
  supportsNativeAction: true, nativeRendererId: 'codex-native-action-fixture'
})
const rendererOnlyResolution = resolveArtifactDelivery({
  linkCapability: rendererOnlyNative,
  artifactId: 'renderer-only-artifact',
  target: path.join(ROOT, 'README.md')
})
if (!rendererOnlyResolution.validation.valid || rendererOnlyResolution.attempt.status !== 'fallback' ||
    rendererOnlyResolution.attempt.fallbackReason !== 'native-action-not-attached') {
  failures.push(`renderer-only native action produced a false open claim: ${JSON.stringify(rendererOnlyResolution)}`)
}

const unknownHostLink = createHostLinkCapabilityDecisionV2({
  hostSurface: 'unknown', presentationSurface: 'unknown', evidenceState: 'unverified', targetRelation: 'workspace'
})
if (unknownHostLink.openMode !== 'absolute-copy' || !unknownHostLink.absolutePathFallback) {
  failures.push(`unknown host did not degrade to absolute copy: ${JSON.stringify(unknownHostLink)}`)
}

if (failures.length) {
  console.error('Client contract checks failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Client contract checks passed: evidence-driven visible output + bounded MCP fallback')
