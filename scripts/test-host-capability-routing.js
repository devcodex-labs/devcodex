#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { buildHostAdapterCompatibilityMatrix } = require('./lib/always-on-governance')
const { buildBundle } = require('./lib/control-content-source')
const { resolveControlAsset } = require('./lib/control-content-delivery')
const {
  REQUIRED_SECURITY_INVARIANTS,
  SCHEMAS,
  buildHostLeverCatalogReceipt,
  catalogEntryKey,
  computeCapabilityDecisionId,
  computeProjectionDigest,
  evaluateNativeEligibility,
  resolveHostCapabilityLever,
  stableStringify,
  sha256,
  validateCapabilityIntentDecision,
  validateHostLeverCatalog,
  validateOriginalInstructionRef
} = require('./lib/host-capability-routing')

const ROOT = path.resolve(__dirname, '..')
const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'host-capability-routing')
const NOW = '2026-07-24T01:00:00Z'

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(resolveControlAsset(ROOT, relativePath), 'utf8'))
}

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, name), 'utf8'))
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function codes(issues) {
  return issues.map(item => item.code)
}

function makeDirectEvidenceCatalog(baseCatalog, variant = 'copilot-vscode') {
  const candidate = clone(baseCatalog)
  const entry = candidate.entries.find(item => item.hostSurfaceOrVariant === variant)
  assert(entry, `missing catalog entry for ${variant}`)
  entry.evidence.evidenceStatus = 'PASS'
  entry.evidence.evidenceCheckedAt = NOW
  entry.evidence.evidenceLease = {
    kind: 'direct-host-replay',
    duration: 'P14D',
    sourceHead: null
  }
  for (const step of Object.values(entry.lifecycle)) step.observable = true
  entry.permission.permissionDelta = 'bounded'
  return candidate
}

const catalog = readJson('skills/host-capability-routing/host-lever-catalog.v1.json')
const matrix = buildHostAdapterCompatibilityMatrix()
const validDecision = fixture('valid-decision.json')
const validInstructionRef = fixture('valid-instruction-ref.json')
const mcpAbsent = fixture('mcp-absent.json')
const invalidCases = fixture('invalid-cases.json')

assert.strictEqual(SCHEMAS.capabilityIntentDecision.title, 'CapabilityIntentDecisionV1')
assert.strictEqual(SCHEMAS.hostLeverCatalog.title, 'HostLeverCatalogV1')
assert.strictEqual(SCHEMAS.originalInstructionRef.title, 'OriginalInstructionRefV1')
for (const schema of Object.values(SCHEMAS)) {
  assert.strictEqual(schema.additionalProperties, false, `${schema.title} must reject unknown root fields`)
}

const catalogReceipt = buildHostLeverCatalogReceipt(catalog, {
  matrix,
  sourceHead: catalog.sourceMatrixRef.sourceHead
})
assert.strictEqual(catalogReceipt.passed, true, JSON.stringify(catalogReceipt.issues))
assert.strictEqual(catalogReceipt.openBlockers, 0)
assert.deepStrictEqual(catalogReceipt.coverage, {
  inScopeVariantCount: 9,
  uniqueVariantCount: 9,
  logicalHostCount: 6,
  unsupportedCount: 1
})
assert.strictEqual(catalog.sourceMatrixRef.matrixId, matrix.matrixId)
assert.strictEqual(catalog.writer, 'host-capability-routing/catalog-maintainer')
assert.strictEqual(
  validDecision.receipt.catalogFileDigest,
  `sha256:${sha256(stableStringify(catalog))}`,
  'decision fixture must bind the canonical catalog'
)

const matrixInScope = matrix.hosts.filter(host => host.scope !== 'unsupported').map(host => host.hostId).sort()
const catalogInScope = catalog.entries.map(entry => entry.hostSurfaceOrVariant).sort()
assert.deepStrictEqual(catalogInScope, matrixInScope)
const matrixUnsupported = matrix.hosts.filter(host => host.scope === 'unsupported').map(host => host.hostId).sort()
const catalogUnsupported = catalog.unsupportedSurfaces.map(entry => entry.hostSurfaceOrVariant).sort()
assert.deepStrictEqual(catalogUnsupported, matrixUnsupported)
assert.strictEqual(new Set(catalog.entries.map(catalogEntryKey)).size, 9)

for (const entry of catalog.entries) {
  const receipt = resolveHostCapabilityLever({
    catalog,
    matrix,
    hostId: entry.hostId,
    hostSurfaceOrVariant: entry.hostSurfaceOrVariant,
    capabilityFamilyId: entry.capabilityFamilyId,
    sourceHead: catalog.sourceMatrixRef.sourceHead,
    now: NOW,
    explicitUserAuthority: true,
    allowNativeInvocation: false
  })
  assert.strictEqual(receipt.classification, 'portable', `${entry.hostSurfaceOrVariant} must remain portable`)
  assert.strictEqual(receipt.nativeEligibility.eligible, false)
  assert.strictEqual(receipt.fallback.applied, true)
  assert.strictEqual(receipt.fallback.retryable, false)
  assert.strictEqual(receipt.mcpRequired, false)
  assert.strictEqual(receipt.safe, true)
}

for (const unsupported of catalog.unsupportedSurfaces) {
  const receipt = resolveHostCapabilityLever({
    catalog,
    matrix,
    hostId: unsupported.hostId,
    hostSurfaceOrVariant: unsupported.hostSurfaceOrVariant,
    sourceHead: catalog.sourceMatrixRef.sourceHead,
    now: NOW
  })
  assert.strictEqual(receipt.classification, 'unsupported')
  assert.strictEqual(receipt.fallback.reasonCode, 'HOST_UNSUPPORTED')
  assert.strictEqual(receipt.safe, true)
}

const cursorPortable = resolveHostCapabilityLever({
  catalog,
  matrix,
  hostId: 'cursor',
  hostSurfaceOrVariant: 'cursor',
  capabilityFamilyId: 'planning',
  sourceHead: catalog.sourceMatrixRef.sourceHead,
  now: NOW,
  explicitUserAuthority: true,
  allowNativeInvocation: true
})
assert.strictEqual(cursorPortable.classification, 'portable')
assert.strictEqual(cursorPortable.nativeEligibility.eligible, false)
assert.strictEqual(cursorPortable.fallback.applied, true)
assert.strictEqual(cursorPortable.safe, true)

const unknownVariant = resolveHostCapabilityLever({
  catalog,
  matrix,
  hostId: 'codex',
  hostSurfaceOrVariant: 'codex-unknown',
  sourceHead: catalog.sourceMatrixRef.sourceHead,
  now: NOW
})
assert.strictEqual(unknownVariant.classification, 'portable')
assert.strictEqual(unknownVariant.fallback.reasonCode, 'HOST_VARIANT_UNKNOWN')

const missingCatalog = resolveHostCapabilityLever({
  matrix,
  hostId: 'codex',
  hostSurfaceOrVariant: 'codex',
  now: NOW
})
assert.strictEqual(missingCatalog.fallback.reasonCode, 'CATALOG_UNAVAILABLE')
assert.strictEqual(missingCatalog.safe, true)

const directEvidenceCatalog = makeDirectEvidenceCatalog(catalog)
const nativeEligible = resolveHostCapabilityLever({
  catalog: directEvidenceCatalog,
  matrix,
  hostId: 'copilot',
  hostSurfaceOrVariant: 'copilot-vscode',
  sourceHead: catalog.sourceMatrixRef.sourceHead,
  now: NOW,
  explicitUserAuthority: true,
  allowNativeInvocation: true
})
assert.strictEqual(nativeEligible.classification, 'native-eligible')
assert.strictEqual(nativeEligible.nativeEligibility.eligible, true)
assert.strictEqual(nativeEligible.nativeEligibility.evidenceState, 'fresh')
assert.strictEqual(nativeEligible.nativeEligibility.permissionState, 'safe')
assert.strictEqual(nativeEligible.nativeEligibility.lifecycleState, 'complete')
assert.strictEqual(nativeEligible.fallback.applied, false)

const incompleteLifecycleCatalog = clone(directEvidenceCatalog)
incompleteLifecycleCatalog.entries
  .find(entry => entry.hostSurfaceOrVariant === 'copilot-vscode')
  .lifecycle.cancel.observable = false
const lifecycleResult = resolveHostCapabilityLever({
  catalog: incompleteLifecycleCatalog,
  matrix,
  hostId: 'copilot',
  hostSurfaceOrVariant: 'copilot-vscode',
  sourceHead: catalog.sourceMatrixRef.sourceHead,
  now: NOW,
  explicitUserAuthority: true,
  allowNativeInvocation: true
})
assert.strictEqual(lifecycleResult.nativeEligibility.reasonCode, 'NATIVE_LIFECYCLE_INCOMPLETE')

const unsafePermissionCatalog = clone(directEvidenceCatalog)
unsafePermissionCatalog.entries
  .find(entry => entry.hostSurfaceOrVariant === 'copilot-vscode')
  .permission.permissionDelta = 'elevated'
const permissionResult = resolveHostCapabilityLever({
  catalog: unsafePermissionCatalog,
  matrix,
  hostId: 'copilot',
  hostSurfaceOrVariant: 'copilot-vscode',
  sourceHead: catalog.sourceMatrixRef.sourceHead,
  now: NOW,
  explicitUserAuthority: true,
  allowNativeInvocation: true
})
assert.strictEqual(permissionResult.nativeEligibility.reasonCode, 'NATIVE_PERMISSION_UNSAFE')

const missingAuthorityResult = resolveHostCapabilityLever({
  catalog: directEvidenceCatalog,
  matrix,
  hostId: 'copilot',
  hostSurfaceOrVariant: 'copilot-vscode',
  sourceHead: catalog.sourceMatrixRef.sourceHead,
  now: NOW,
  explicitUserAuthority: false,
  allowNativeInvocation: true
})
assert.strictEqual(missingAuthorityResult.nativeEligibility.reasonCode, 'NATIVE_AUTHORITY_MISSING')

const staleEvidenceCatalog = clone(directEvidenceCatalog)
staleEvidenceCatalog.entries
  .find(entry => entry.hostSurfaceOrVariant === 'copilot-vscode')
  .evidence.evidenceCheckedAt = '2026-06-01T00:00:00Z'
const staleResult = resolveHostCapabilityLever({
  catalog: staleEvidenceCatalog,
  matrix,
  hostId: 'copilot',
  hostSurfaceOrVariant: 'copilot-vscode',
  sourceHead: catalog.sourceMatrixRef.sourceHead,
  now: NOW,
  explicitUserAuthority: true,
  allowNativeInvocation: true
})
assert.strictEqual(staleResult.nativeEligibility.reasonCode, 'NATIVE_EVIDENCE_STALE')

const officialDocsOnly = evaluateNativeEligibility(
  catalog.entries.find(entry => entry.hostSurfaceOrVariant === 'copilot-vscode'),
  {
    sourceHead: catalog.sourceMatrixRef.sourceHead,
    now: NOW,
    explicitUserAuthority: true,
    allowNativeInvocation: true
  }
)
assert.strictEqual(officialDocsOnly.eligible, false)
assert.strictEqual(officialDocsOnly.reasonCode, 'NATIVE_EVIDENCE_UNVERIFIED')

const mcpAbsentReceipt = resolveHostCapabilityLever({
  catalog,
  matrix,
  hostId: mcpAbsent.hostId,
  hostSurfaceOrVariant: mcpAbsent.hostSurfaceOrVariant,
  capabilityFamilyId: mcpAbsent.capabilityFamilyId,
  sourceHead: catalog.sourceMatrixRef.sourceHead,
  now: NOW,
  runtimeCapabilities: mcpAbsent.runtimeCapabilities
})
assert.strictEqual(mcpAbsentReceipt.classification, mcpAbsent.expected.classification)
assert.strictEqual(mcpAbsentReceipt.fallback.reasonCode, mcpAbsent.expected.reasonCode)
assert.strictEqual(mcpAbsentReceipt.mcpRequired, mcpAbsent.expected.mcpRequired)
assert.strictEqual(mcpAbsentReceipt.safe, mcpAbsent.expected.safe)

assert.deepStrictEqual(validateCapabilityIntentDecision(validDecision), [])
assert.strictEqual(validDecision.decisionId, computeCapabilityDecisionId(validDecision))
assert.deepStrictEqual(REQUIRED_SECURITY_INVARIANTS, ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07'])

const validDirectDecision = clone(validDecision)
validDirectDecision.selectedPortableDecision = 'direct'
validDirectDecision.reasonCode = 'SCOPE_BOUNDED_DIRECT'
validDirectDecision.reason = 'The bounded change can proceed directly while retaining every invariant and CP gate.'
validDirectDecision.decisionId = computeCapabilityDecisionId(validDirectDecision)
assert.deepStrictEqual(validateCapabilityIntentDecision(validDirectDecision), [])

const validAutoDecision = clone(validDecision)
validAutoDecision.selectedPortableDecision = 'auto_authorized'
validAutoDecision.reasonCode = 'AUTO_AUTHORITY_VALID'
validAutoDecision.reason = 'An existing, readable Auto authority applies without changing safety or CP semantics.'
validAutoDecision.autoAuthorityRef = 'auto-authority:@rocky'
validAutoDecision.decisionId = computeCapabilityDecisionId(validAutoDecision)
assert.deepStrictEqual(validateCapabilityIntentDecision(validAutoDecision), [])

const displayOnlyChange = clone(validDecision)
displayOnlyChange.reason = 'A different user-facing explanation with the same machine decision core.'
assert.strictEqual(computeCapabilityDecisionId(displayOnlyChange), validDecision.decisionId)

assert.deepStrictEqual(validateOriginalInstructionRef(validInstructionRef, {
  forCrossTurnMutation: true,
  expectedSourceDigest: validInstructionRef.sourceDigest.value
}), [])
assert.strictEqual(
  validInstructionRef.projectionDigest.value,
  computeProjectionDigest(validInstructionRef.controlledSummary)
)

function mutateCatalog(mutation) {
  const value = clone(catalog)
  switch (mutation) {
    case 'unknown-field':
      value.unexpected = true
      break
    case 'duplicate-key':
      value.entries.push(clone(value.entries[0]))
      break
    case 'stale-source':
      value.sourceMatrixRef.sourceHead = '1'.repeat(40)
      break
    case 'logical-host-mismatch':
      value.entries[0].hostId = 'codex'
      break
    default:
      throw new Error(`unknown catalog mutation: ${mutation}`)
  }
  return value
}

function mutateDecision(mutation) {
  const value = clone(validDecision)
  switch (mutation) {
    case 'unknown-field':
      value.nativeEligibility.unexpected = true
      break
    case 'low-confidence-direct':
      value.selectedPortableDecision = 'direct'
      value.confidence = 'medium'
      value.reasonCode = 'SCOPE_BOUNDED_DIRECT'
      break
    case 'auto-without-authority':
      value.selectedPortableDecision = 'auto_authorized'
      value.reasonCode = 'AUTO_AUTHORITY_VALID'
      value.autoAuthorityRef = null
      break
    case 'digest-mismatch':
      value.decisionId = `sha256:${'0'.repeat(64)}`
      break
    case 'mandatory-invariant-missing':
      value.appliedInvariantIds = value.appliedInvariantIds.filter(item => item !== 'S01')
      value.decisionId = computeCapabilityDecisionId(value)
      break
    case 'direct-cp-missing':
      value.selectedPortableDecision = 'direct'
      value.reasonCode = 'SCOPE_BOUNDED_DIRECT'
      value.reason = 'Invalid direct decision that attempts to omit CP1.'
      value.appliedInvariantIds = value.appliedInvariantIds.filter(item => item !== 'CP1')
      value.decisionId = computeCapabilityDecisionId(value)
      break
    default:
      throw new Error(`unknown decision mutation: ${mutation}`)
  }
  return value
}

function mutateInstruction(mutation) {
  const value = clone(validInstructionRef)
  switch (mutation) {
    case 'projection-mismatch':
      value.projectionDigest.value = '0'.repeat(64)
      return { value, options: {} }
    case 'compat-cross-turn':
      value.sourceDigest = {
        algorithm: 'fnv1a32-compat',
        value: '1234abcd',
        strength: 'compat'
      }
      value.authority = 'governance-intake-anchor'
      value.sourceRef = 'governance-intake:GI-example'
      value.freshness = {
        status: 'turn-bound',
        checkedAt: NOW,
        lease: 'turn-bound',
        readbackVerified: false
      }
      value.fallback = {
        stopMutation: true,
        requestRestatement: false,
        requireReconfirmation: true,
        reasonCode: 'INSTRUCTION_AUTHORITY_TOO_WEAK'
      }
      return { value, options: { forCrossTurnMutation: true } }
    case 'unavailable-without-stop':
      value.sourceDigest = {
        algorithm: 'unavailable',
        value: null,
        strength: 'none'
      }
      value.authority = 'unavailable'
      value.sourceRef = null
      value.freshness = {
        status: 'unverified',
        checkedAt: NOW,
        lease: 'P0D',
        readbackVerified: false
      }
      value.fallback.stopMutation = false
      value.fallback.requestRestatement = false
      value.fallback.requireReconfirmation = true
      value.fallback.reasonCode = 'INSTRUCTION_SOURCE_MISSING'
      return { value, options: {} }
    case 'source-digest-mismatch':
      return { value, options: { expectedSourceDigest: '0'.repeat(64) } }
    default:
      throw new Error(`unknown instruction mutation: ${mutation}`)
  }
}

for (const invalidCase of invalidCases) {
  let issues
  if (invalidCase.target === 'catalog') {
    issues = validateHostLeverCatalog(mutateCatalog(invalidCase.mutation), {
      matrix,
      sourceHead: catalog.sourceMatrixRef.sourceHead
    })
  } else if (invalidCase.target === 'decision') {
    issues = validateCapabilityIntentDecision(mutateDecision(invalidCase.mutation))
  } else {
    const mutated = mutateInstruction(invalidCase.mutation)
    issues = validateOriginalInstructionRef(mutated.value, mutated.options)
  }
  assert(
    codes(issues).includes(invalidCase.expectedCode),
    `${invalidCase.name} missing ${invalidCase.expectedCode}: ${JSON.stringify(issues)}`
  )
}

const duplicateCatalog = mutateCatalog('duplicate-key')
const duplicateResolver = resolveHostCapabilityLever({
  catalog: duplicateCatalog,
  matrix,
  hostId: 'copilot',
  hostSurfaceOrVariant: 'copilot-vscode',
  sourceHead: catalog.sourceMatrixRef.sourceHead,
  now: NOW
})
assert.strictEqual(duplicateResolver.fallback.reasonCode, 'CATALOG_DUPLICATE_KEY')
assert.strictEqual(duplicateResolver.safe, true)

const grokDirectEvidenceCatalog = makeDirectEvidenceCatalog(catalog, 'grok-root-native')
const grokRootEntry = grokDirectEvidenceCatalog.entries
  .find(entry => entry.hostSurfaceOrVariant === 'grok-root-native')
grokRootEntry.permission.permissionDelta = 'elevated'
assert.match(grokRootEntry.permission.writeBoundary, /bash|shell/i)
assert.match(grokRootEntry.permission.writeBoundary, /subagent/i)
const grokUnsafeResult = resolveHostCapabilityLever({
  catalog: grokDirectEvidenceCatalog,
  matrix,
  hostId: 'grok',
  hostSurfaceOrVariant: 'grok-root-native',
  sourceHead: catalog.sourceMatrixRef.sourceHead,
  now: NOW,
  explicitUserAuthority: true,
  allowNativeInvocation: true
})
assert.strictEqual(grokUnsafeResult.classification, 'portable')
assert.strictEqual(grokUnsafeResult.nativeEligibility.reasonCode, 'NATIVE_PERMISSION_UNSAFE')
assert.strictEqual(grokUnsafeResult.fallback.applied, true)

const helperSource = fs.readFileSync(path.join(__dirname, 'lib', 'host-capability-routing.js'), 'utf8')
const hostDescriptorRequest = './host-surface-descriptors'
assert(helperSource.includes(`require('${hostDescriptorRequest}')`), 'helper must reuse canonical HOST_IDS')
for (const forbidden of ['child_process', 'writeFile', 'appendFile', 'fetch(', 'http.request', 'https.request']) {
  assert(!helperSource.includes(forbidden), `pure helper must not contain ${forbidden}`)
}
const skillSource = fs.readFileSync(path.join(ROOT, 'content', 'skills', 'host-capability-routing', 'SKILL.md'), 'utf8')
for (const anchor of [
  'CSD-host-capability-routing',
  'CapabilityIntentDecisionV1',
  'HostLeverCatalogV1',
  'OriginalInstructionRefV1',
  'portable-first',
  'MCP_NOT_REQUIRED',
  'CP1→CP2→条件 CP3'
]) {
  assert(skillSource.includes(anchor), `host-capability-routing Skill missing ${anchor}`)
}
assert(skillSource.split(/\r?\n/).length <= 500, 'new normative Skill must remain at or below 500 lines')

const consumerAnchors = {
  'instructions.md': [
    'HostCapabilityRoutingGate',
    'OriginalInstructionRefV1',
    'fail closed 到 portable fallback',
    'CP/Auto/native-applied'
  ],
  'instructions/01-common.instructions.md': [
    'host-capability-routing',
    'OriginalInstructionRefV1',
    'portable fallback'
  ],
  'instructions/15-memory.instructions.md': [
    'HostCapabilityRoutingRef',
    'compat/none',
    'digest-bound CP/task artifact'
  ],
  'instructions/16-report.instructions.md': [
    'host-capability-routing',
    'selectedPortableDecision',
    'MCP_NOT_REQUIRED'
  ],
  'skills/intent/SKILL.md': [
    'HostCapabilityRoutingHandoff',
    '`intent` 始终拥有 `workflowIntent`',
    'autoAuthorityRef'
  ],
  'skills/routing/SKILL.md': [
    'skills/host-capability-routing/SKILL.md',
    '不改 workflow route、CP、Auto'
  ],
  'skills/cp-gate/SKILL.md': [
    'OriginalInstructionAuthorityGate',
    'CP1→CP2→条件 CP3',
    'MCP_NOT_REQUIRED'
  ],
  'skills/memory/SKILL.md': [
    'HostCapabilityRoutingRef',
    'Agent SUMMARY 仍保持纯索引'
  ],
  'skills/summary/SKILL.md': [
    'HostCapabilityRoutingRef',
    'Agent `SUMMARY.md` 仍是纯索引'
  ],
  'skills/report/SKILL.md': [
    'HostCapabilityRoutingRef',
    'portable `plan_first` 不得写成 native Plan 已进入'
  ],
  'skills/execution-contract/SKILL.md': [
    'InstructionAuthorityContract',
    'instructionAuthority',
    '不得新增 native/MCP/CLI/Hook recovery action'
  ],
  'prompts/memory-session.prompt.md': [
    'HostCapabilityRoutingRef',
    '禁止复制完整用户原文'
  ]
}
const renderedControlContent = new Map(
  buildBundle(ROOT).files.map(file => [file.relative, file.content.toString('utf8')])
)
for (const [relativePath, anchors] of Object.entries(consumerAnchors)) {
  const source = renderedControlContent.get(relativePath)
  assert(source, `${relativePath} missing from rendered control content`)
  for (const anchor of anchors) {
    assert(source.includes(anchor), `${relativePath} missing ${anchor}`)
  }
}
for (const reportPrompt of [
  'report-analysis.prompt.md',
  'report-audit.prompt.md',
  'report-dev.prompt.md',
  'report-fix.prompt.md',
  'report-optimization.prompt.md',
  'report-scenario-test.prompt.md'
]) {
  const source = renderedControlContent.get(`prompts/${reportPrompt}`)
  assert(source, `${reportPrompt} missing from rendered control content`)
  for (const anchor of ['host-capability-routing', 'instructionRefId', '禁止复制完整原文或 catalog row']) {
    assert(source.includes(anchor), `${reportPrompt} missing ${anchor}`)
  }
}
const cpGateSource = fs.readFileSync(path.join(ROOT, 'content', 'skills', 'cp-gate', 'SKILL.md'), 'utf8')
for (const invariant of [
  'CP1 → CP2 → CP3',
  'CP1 / CP2 / CP3 确认**自动通过**',
  'S01',
  'S03~S07',
  '"继续" ≠ CP3/写入授权'
]) {
  assert(cpGateSource.includes(invariant), `CP/Auto invariant regressed: ${invariant}`)
}

console.log(JSON.stringify({
  schemaVersion: 'HostCapabilityRoutingTestReceiptV1',
  catalog: {
    inScopeVariants: catalogReceipt.coverage.inScopeVariantCount,
    logicalHosts: catalogReceipt.coverage.logicalHostCount,
    unsupportedSurfaces: catalogReceipt.coverage.unsupportedCount,
    duplicateKeys: 0
  },
  contracts: {
    capabilityIntentDecision: 'passed',
    hostLeverCatalog: 'passed',
    originalInstructionRef: 'passed'
  },
  negativeCases: invalidCases.length,
  wiredConsumers: Object.keys(consumerAnchors).length + 6,
  canonicalNativeEligible: 0,
  mcpRequired: false,
  status: 'passed'
}, null, 2))
