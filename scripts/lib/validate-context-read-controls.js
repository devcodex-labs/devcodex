'use strict'

const fs = require('fs')
const path = require('path')
const { CONTEXT_READ_CONTRACT } = require('../../hooks/_runtime/context-read-contract.cjs')
const { createCanonicalAwareReader } = require('./canonical-consumer-contracts')

const EXPECTED_SCHEMAS = Object.freeze({
  intentSeed: 'IntentSeedV1',
  plan: 'ContextReadPlanV2',
  planV1: 'ContextReadPlanV1',
  receipt: 'ContextReadReceiptV2',
  receiptV1: 'ContextReadReceiptV1',
  error: 'ContextReadErrorV1',
  state: 'ContextReadStateV2',
  stateV1: 'ContextReadStateV1',
  identityInputs: 'ContextPlanIdentityInputsV1',
  reuseDecision: 'ContextReuseDecisionV1',
  stageTiming: 'StageTimingV1'
})
const REQUIRED_PROFILE_TOOLS = Object.freeze(['profile_context_plan', 'profile_load', 'profile_skill_plan'])
const REQUIRED_MEMORY_QUERY_TOOLS = Object.freeze(['memory_status', 'memory_session_query', 'memory_summary_query'])
const REQUIRED_MEMORY_LEGACY_TOOLS = Object.freeze([
  'memory_session_read',
  'memory_session_write',
  'memory_cp_confirm',
  'memory_summary_read',
  'memory_summary_append'
])
const CANONICAL_V2_CONSUMER_REQUIREMENTS = Object.freeze([
  ['instructions.md', ['ContextAcquisitionGate', 'IntentSeedV1', 'ContextReadPlanV2', 'ContextReadReceiptV2']],
  ['instructions/01-common.instructions.md', ['ContextAcquisitionGate', 'ContextReadPlanV2']],
  ['instructions/01a-profile-loading.instructions.md', ['ProfileReadChainGate', 'profile_context_plan', 'ProfilePlanNoHiddenFullReadProbe']],
  ['instructions/15-memory.instructions.md', ['MemoryContextQueryGate', 'memory_status', 'memory_session_query', 'memory_summary_query']],
  ['skills/ai-agent-system-architecture/SKILL.md', ['ContextAcquisitionGate', 'IntentSeedV1', 'ContextReadPlanV2', 'ContextReadReceiptV2']],
  ['skills/load-profile/SKILL.md', ['ProfileReadChainGate', 'profile_context_plan', 'ProfilePlanNoHiddenFullReadProbe', 'ProfileSectionSelectionGate', 'ProfileSectionLoadReceiptV1', 'ContextReadBindingGate', 'ContextReadBindingV1']],
  ['skills/skill-lifecycle-governance/SKILL.md', ['BundleDecisionV2', 'sourceBytes', 'full-skill-read']],
  ['skills/memory/SKILL.md', ['MemoryContextQueryGate', 'memory_status', 'memory_session_query', 'memory_summary_query']],
  ['skills/host-contract-verification/SKILL.md', ['ContextReadReceiptV2', 'ContextAcquisitionToolAllowlistProbe', 'PostToolUse']],
  ['skills/test-router/SKILL.md', ['context-acquisition', 'V99', 'ContextReadBindingV1', 'testRouteDigest']],
  ['skills/report/report-schema.json', ['ContextAcquisition']],
  ['prompts/technical-design.prompt.md', ['context-acquisition', 'ContextReadPlanV2', 'ContextReadReceiptV2', 'V99']],
  ['prompts/implementation-plan.prompt.md', ['context-acquisition', 'ProfilePlanNoHiddenFullReadProbe', 'V99']],
  ['prompts/report-dev.prompt.md', ['ContextAcquisition', 'ContextReadReceiptV2', 'ContextReadBindingV1', 'V99']],
  ['README.md', ['profile_context_plan', 'memory_status', 'ContextReadReceiptV2']],
  ['website/docs/guide/development.md', ['profile_context_plan', 'memory_status', 'ContextReadPlanV2', 'ContextReadReceiptV2']],
  ['instructions/01-common.instructions.md', ['ContextReadBindingV1']],
  ['scripts/lib/validation-dag.js', ['testRouteDigest', 'intentExpansionDigest']]
])

const V1_READER_COMPATIBILITY_REQUIREMENTS = Object.freeze([
  ['instructions.md', ['兼容读取 V1']],
  ['instructions/01-common.instructions.md', ['V1 只保留 reader compatibility']],
  ['skills/ai-agent-system-architecture/SKILL.md', ['V1 兼容']],
  ['skills/host-contract-verification/SKILL.md', ['V1 兼容']],
  ['prompts/technical-design.prompt.md', ['ContextReadPlanV1']],
  ['prompts/report-dev.prompt.md', ['ContextReadReceiptV1']],
  ['README.md', ['V1 receipt 只作兼容读取']],
  ['website/docs/guide/development.md', ['V1 只保留 reader compatibility']]
])

const PROFILE_CANONICAL_V2_REQUIREMENTS = Object.freeze([
  ['01-项目信息.md', ['V99', 'test:context-read-controls']],
  ['02-架构约束.md', ['context-read-contract.cjs', 'validate-context-read-controls.js']],
  ['04-测试规范.md', ['V99', 'test:context-read', 'test:context-read-controls']],
  ['06-功能清单.md', ['profile_context_plan', 'memory_status']],
  ['07-用户文档与契约规范.md', ['ContextAcquisitionGate', 'targeted']]
])

const PROFILE_V1_READER_COMPATIBILITY_REQUIREMENTS = Object.freeze([
  ['06-功能清单.md', ['ContextReadReceiptV1']],
  ['07-用户文档与契约规范.md', ['legacy']]
])

const FORBIDDEN_LEGACY_PRIMARY = Object.freeze([
  ['instructions.md', ['收到消息后、执行工作流前必须读取 `.devcodex/profile/`']],
  ['instructions/01-common.instructions.md', ['Profile 加载（读取 `.devcodex/profile/`）是所有工作流的前置步骤，不受本表约束，必须在执行任何工作流前完成。']],
  ['instructions/01a-profile-loading.instructions.md', ['跨会话恢复时必须重新读取 Profile 文件']],
  ['skills/memory/SKILL.md', ['正常会话：SUMMARY 优先 → 再读今日/昨日任务文件（索引驱动）']]
])

function classifyContractSchemaSnapshot(schemas) {
  if (!schemas || typeof schemas !== 'object' || Array.isArray(schemas)) return 'invalid-schema-snapshot'
  return Object.entries(EXPECTED_SCHEMAS).every(([key, value]) => schemas[key] === value)
    ? 'schema-ready'
    : 'schema-drift'
}

function classifyProfilePlanReadTrace(readFiles) {
  if (!Array.isArray(readFiles) || readFiles.some(file => typeof file !== 'string')) return 'invalid-read-trace'
  if (readFiles.includes('config.local.json')) return 'hidden-local-read'
  if (readFiles.some(file => /^\d{2}-.+\.md$/i.test(file))) return 'hidden-profile-body-read'
  return readFiles.every(file => ['README.md', 'config.json'].includes(file))
    ? 'baseline-only'
    : 'unexpected-profile-read'
}

function classifyRuntimeToolSurface(surface) {
  if (!surface || typeof surface !== 'object') return 'invalid-runtime-surface'
  const profileTools = new Set(surface.profileTools || [])
  const memoryTools = new Set(surface.memoryTools || [])
  if (!REQUIRED_PROFILE_TOOLS.every(tool => profileTools.has(tool))) return 'profile-surface-incomplete'
  if (!REQUIRED_MEMORY_QUERY_TOOLS.every(tool => memoryTools.has(tool))) return 'memory-query-surface-incomplete'
  if (!REQUIRED_MEMORY_LEGACY_TOOLS.every(tool => memoryTools.has(tool)) || surface.legacyProjection !== true) {
    return 'legacy-compatibility-drift'
  }
  return 'runtime-ready'
}

function classifyConsumerClosure(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return 'invalid-consumer-snapshot'
  if (![snapshot.canonicalMissing, snapshot.compatibilityMissing, snapshot.forbiddenLegacy]
    .every(value => value === undefined || Array.isArray(value))) return 'invalid-consumer-snapshot'
  if ((snapshot.canonicalMissing || []).length) return 'consumer-incomplete'
  if ((snapshot.forbiddenLegacy || []).length) return 'legacy-primary-drift'
  if ((snapshot.compatibilityMissing || []).length) return 'reader-compatibility-incomplete'
  return 'consumer-ready'
}

/**
 * PF-149: classify ContextReadBindingV1 sample / claim.
 * @returns {'request-bound'|'legacy-unbound'|'invalid'|'not-context-binding'}
 */
function classifyContextReadBindingSample(sample) {
  const text = String(sample || '')
  if (!/ContextReadBindingV1|contextBinding|bindingStatus/i.test(text)) {
    return 'not-context-binding'
  }
  if (/CONTEXT_BINDING_INVALID|CONTEXT_BINDING_MISMATCH|schemaVersion\s*[!=]/i.test(text) &&
      !/ContextReadBindingV1/.test(text)) {
    return 'invalid'
  }
  if (/schemaVersion['":\s]+ContextReadBindingV1/i.test(text) ||
      /"schemaVersion"\s*:\s*"ContextReadBindingV1"/.test(text)) {
    const hasFields = /contextEpoch/i.test(text) && /planId/i.test(text) &&
      /planContentId/i.test(text) && /activeRoot/i.test(text)
    if (!hasFields) return 'invalid'
    if (/legacy-unbound|bindingStatus['":\s]+legacy-unbound/i.test(text)) return 'legacy-unbound'
    return 'request-bound'
  }
  if (/legacy-unbound|bindingStatus['":\s]+legacy-unbound/i.test(text)) return 'legacy-unbound'
  if (/CONTEXT_BINDING_INVALID|CONTEXT_BINDING_MISMATCH/i.test(text)) return 'invalid'
  return 'invalid'
}

/**
 * Unbound or invalid binding cannot claim context acquisition complete (PF-149).
 * @returns {'ok'|'false-complete-unbound'|'false-complete-invalid'|'n/a'}
 */
function classifyBindingCompletenessClaim(sample) {
  const text = String(sample || '')
  const claimsComplete = /relevant-complete|context acquisition complete|上下文已齐|ContextAcquisition.*complete|bindingStatus['":\s]+request-bound.*complete/i.test(text) ||
    (/complete|已完成|verified-present/i.test(text) && /Context Acquisition|上下文获取|ContextReadReceipt/i.test(text))
  if (!claimsComplete && !/ContextReadBinding|legacy-unbound|request-bound/i.test(text)) return 'n/a'
  const binding = classifyContextReadBindingSample(text)
  if (binding === 'request-bound' && claimsComplete) return 'ok'
  if (binding === 'legacy-unbound' && claimsComplete) return 'false-complete-unbound'
  if (binding === 'invalid' && claimsComplete) return 'false-complete-invalid'
  if (binding === 'legacy-unbound' || binding === 'invalid') return 'n/a'
  if (claimsComplete && binding === 'not-context-binding') return 'false-complete-unbound'
  return 'ok'
}

function extractTopLevelFunctionSource(source, name) {
  const marker = `function ${name}(`
  const start = source.indexOf(marker)
  if (start < 0) return ''
  const next = source.indexOf('\nfunction ', start + marker.length)
  return source.slice(start, next < 0 ? source.length : next)
}

function buildContextReadControlChecks(ctx) {
  const { ROOT, ACTIVE_DEVCODEX_ROOT, fs: fileSystem, path: pathApi, err, console } = ctx
  const readFile = ctx.read || (file => fileSystem.readFileSync(file, 'utf8'))
  const exists = file => typeof readFile.exists === 'function'
    ? readFile.exists(file)
    : fileSystem.existsSync(file)

  function readRelative(relative) {
    const file = pathApi.join(ROOT, relative)
    return exists(file) ? readFile(file) : null
  }

  function checkFile(relative, needles) {
    const content = readRelative(relative)
    if (content === null) {
      err(`[V99] missing required artifact: ${relative}`)
      return ''
    }
    for (const needle of needles) {
      if (!content.includes(needle)) err(`[V99] ${relative} missing: ${needle}`)
    }
    return content
  }

  function expect(actual, expected, label) {
    if (actual !== expected) err(`[V99] ${label}: expected ${expected}, got ${actual}`)
  }

  function parseJsonArtifact(relative, needles) {
    const content = checkFile(relative, needles)
    if (!content) return null
    try {
      return JSON.parse(content)
    } catch (error) {
      err(`[V99] ${relative} invalid JSON: ${error.message}`)
      return null
    }
  }

  function checkDeterministicFixtures() {
    expect(classifyContractSchemaSnapshot(EXPECTED_SCHEMAS), 'schema-ready', 'schema positive')
    expect(
      classifyContractSchemaSnapshot({ ...EXPECTED_SCHEMAS, plan: 'ContextReadReceiptV1' }),
      'schema-drift',
      'schema sibling mutation'
    )
    expect(classifyContractSchemaSnapshot(null), 'invalid-schema-snapshot', 'schema invalid negative')
    expect(classifyProfilePlanReadTrace(['README.md', 'config.json']), 'baseline-only', 'hidden-read positive')
    expect(classifyProfilePlanReadTrace(['README.md', '01-项目信息.md']), 'hidden-profile-body-read', 'hidden-read negative')
    expect(classifyProfilePlanReadTrace(['config.local.json']), 'hidden-local-read', 'local overlay negative')
    expect(classifyProfilePlanReadTrace(['README.md', 'random.txt']), 'unexpected-profile-read', 'unexpected read negative')

    const readySurface = {
      profileTools: REQUIRED_PROFILE_TOOLS,
      memoryTools: [...REQUIRED_MEMORY_QUERY_TOOLS, ...REQUIRED_MEMORY_LEGACY_TOOLS],
      legacyProjection: true
    }
    expect(classifyRuntimeToolSurface(readySurface), 'runtime-ready', 'runtime positive')
    expect(
      classifyRuntimeToolSurface({ ...readySurface, memoryTools: REQUIRED_MEMORY_QUERY_TOOLS }),
      'legacy-compatibility-drift',
      'legacy removal mutation'
    )
    expect(classifyRuntimeToolSurface({ ...readySurface, profileTools: ['profile_load'] }), 'profile-surface-incomplete', 'plan removal negative')
    expect(classifyConsumerClosure({ canonicalMissing: ['README'] }), 'consumer-incomplete', 'canonical consumer missing must fail unconditionally')
    expect(classifyConsumerClosure({ forbiddenLegacy: ['full-read-first'] }), 'legacy-primary-drift', 'legacy primary negative')
    expect(classifyConsumerClosure({ compatibilityMissing: ['ContextReadReceiptV1'] }), 'reader-compatibility-incomplete', 'V1 reader compatibility negative')
    expect(classifyConsumerClosure({ canonicalMissing: [], compatibilityMissing: [], forbiddenLegacy: [] }), 'consumer-ready', 'consumer positive')

    // PF-149 binding classifiers
    expect(
      classifyContextReadBindingSample('{"schemaVersion":"ContextReadBindingV1","contextEpoch":"e1","planId":"p1","planContentId":"c1","activeRoot":"/r","project":"demo"}'),
      'request-bound',
      'binding request-bound positive'
    )
    expect(
      classifyContextReadBindingSample('ContextReadBindingV1 bindingStatus: legacy-unbound'),
      'legacy-unbound',
      'binding legacy-unbound negative class'
    )
    expect(
      classifyBindingCompletenessClaim('legacy-unbound Context Acquisition complete relevant-complete'),
      'false-complete-unbound',
      'unbound must not claim complete'
    )
    expect(
      classifyBindingCompletenessClaim('{"schemaVersion":"ContextReadBindingV1","contextEpoch":"e","planId":"p","planContentId":"c","activeRoot":"/x","project":"d"} relevant-complete'),
      'ok',
      'bound complete ok'
    )
  }

  function checkRuntimeSources() {
    const contractSource = checkFile('hooks/_runtime/context-read-contract.cjs', [
      'IntentSeedV1', 'ContextReadPlanV2', 'ContextReadPlanV1', 'ContextReadReceiptV2', 'ContextReadReceiptV1',
      'ContextPlanIdentityInputsV1', 'ContextReuseDecisionV1', 'StageTimingV1', 'ContextReadErrorV1',
      'normalizeIntentSeed', 'buildContextReadPlan', 'createContextReadReceipt', 'evaluateContextReuse',
      'deriveLegacyBootstrapProjection', 'bodyDeliverySkipped'
    ])
    const profileSource = checkFile('mcp/profile-server.js', [
      "name: 'profile_context_plan'", "name: 'profile_load'", "name: 'profile_skill_plan'", 'collectProfilePlanInputs',
      "case 'profile_context_plan'", "case 'profile_load'", 'bounded-top-level-profile-inventory',
      'CONTEXT_READ_CONTRACT', 'handleProfileContextPlan', 'ContextPlanComputationCacheV1',
      'CONTEXT_CACHE_MAX_BYTES', 'applyContextPlanComputationCache', 'sectionSelectors',
      'ProfileLoadReceiptV2', 'BundleDecisionV2', 'ContextReadBindingV1', 'CONTEXT_BINDING_INVALID',
      'CONTEXT_BINDING_MISMATCH'
    ])
    checkFile('mcp/profile-section-selector.cjs', [
      'ProfileSectionSelectorV1', 'ProfileSectionLoadReceiptV1', 'fallback-full',
      'required-query-missing-or-ambiguous', 'selectProfileSectionsFromFileSync',
      'sourceScanComplete', 'continuation'
    ])
    checkFile('mcp/bounded-text-reader.cjs', [
      'readBoundedTextFileSync', 'readBoundedTextRangeSync', 'scanBoundedTextLinesSync',
      'SOURCE_CHANGED_DURING_READ', 'sourcePrefixDigest'
    ])
    const memorySource = checkFile('mcp/memory-server.js', [
      "name: 'memory_status'", "name: 'memory_session_query'", "name: 'memory_summary_query'",
      "case 'memory_status'", "case 'memory_session_query'", "case 'memory_summary_query'",
      'MemoryStatusV1', 'MemorySessionQueryV1', 'MemorySummaryQueryV1', 'CONTEXT_READ_CONTRACT',
      'ContextReadBindingV1', 'CONTEXT_BINDING_REQUIRED', "bindingStatus: 'verified'",
      'scanSummaryDocument', 'scanDailyQueryDocument', 'sourceScanComplete'
    ])
    const bootstrapSource = checkFile('hooks/_runtime/lifecycle-bootstrap-state.cjs', [
      'classifyContextAcquisitionTool', 'recordContextPreToolUse', 'recordContextPostToolUse',
      'structured-plan', 'path-observable', 'instruction-only', 'syncContextProjection',
      'evaluateContextReuse', 'contentIdentity', 'bodyObserved', 'hostSessionId',
      'ContextReadBindingV1', 'CONTEXT_BINDING_MISMATCH'
    ])
    checkFile('hooks/_runtime/lifecycle.cjs', [
      'beginContextAcquisition', 'recordContextPreToolUse', 'recordContextPostToolUse',
      'getContextAcquisitionDecision', 'markContextAcquisitionStale'
    ])
    checkFile('scripts/test-context-read-contract.js', [
      'mandatoryMisses', 'falseComplete=0', 'siblingPlan.observations = []',
      'equivalent plan content must be stable across independent processes', 'context-epoch-mismatch',
      'source-identity-mismatch'
    ])
    checkFile('scripts/test-mcp-servers.js', [
      'testProfileContextPlanReadTrace', 'plan hidden-read detected', 'testContextReadBindingContract',
      'CONTEXT_BINDING_REQUIRED', 'index-backed MCP query must be zero-write',
      'canonical fallback and repair diagnostics must remain zero-write', 'profile_skill_plan',
      'ProfileSectionLoadReceiptV1', 'sourceScanComplete', 'BundleDecisionV2'
    ])
    checkFile('scripts/test-profile-section-selector.js', ['fallback-full', 'partial', 'mandatoryMiss=0'])
    checkFile('scripts/test-hooks-runtime.js', ['buildTestHooksRuntimeFixtures', 'runBootstrapReads'])
    checkFile('scripts/lib/test-hooks-runtime-bootstrap-layout.js', [
      'mcp__devcodex-profile__profile_context_plan', 'mcp__devcodex-memory__memory_summary_append',
      'mcp__evil__profile_context_plan', 'fallbackAttempts'
    ])

    expect(classifyContractSchemaSnapshot(CONTEXT_READ_CONTRACT.schemas), 'schema-ready', 'runtime contract schemas')
    if (CONTEXT_READ_CONTRACT.intents.length !== 8 ||
        !['CONTEXT_BINDING_INVALID', 'CONTEXT_BINDING_MISMATCH', 'MEMORY_SCOPE_AMBIGUOUS']
          .every(code => CONTEXT_READ_CONTRACT.errors.includes(code))) {
      err('[V99] shared contract intent/error registry drift')
    }

    const runtimeSurface = {
      profileTools: REQUIRED_PROFILE_TOOLS.filter(tool => profileSource.includes(`name: '${tool}'`)),
      memoryTools: [...REQUIRED_MEMORY_QUERY_TOOLS, ...REQUIRED_MEMORY_LEGACY_TOOLS]
        .filter(tool => memorySource.includes(`name: '${tool}'`)),
      legacyProjection: contractSource.includes('deriveLegacyBootstrapProjection') && bootstrapSource.includes('syncContextProjection')
    }
    expect(classifyRuntimeToolSurface(runtimeSurface), 'runtime-ready', 'actual runtime surface')

    const collector = extractTopLevelFunctionSource(profileSource, 'collectProfilePlanInputs')
    const handler = extractTopLevelFunctionSource(profileSource, 'handleProfileContextPlan')
    if (!collector || !handler) err('[V99] Profile plan function boundary is not observable')
    // note: probe count floor is maintained in validate.js expectedProbeIds (V1..Vn)
    for (const forbidden of ['resolveDefaultProfileFiles(', 'handleProfileLoad(', 'resolveProfileFile(']) {
      if (collector.includes(forbidden) || handler.includes(forbidden)) {
        err(`[V99] Profile plan hidden full-read guard detected: ${forbidden}`)
      }
    }
    if (!collector.includes('readFileText(readmePath)') || !collector.includes('statProfileRef(') || !collector.includes('resolveConfigFile(')) {
      err('[V99] Profile plan must keep lossless README/config baseline and metadata-only candidate inventory')
    }
  }

  function checkRegistration() {
    const packageJson = parseJsonArtifact('package.json', ['test:context-read-controls'])
    if (packageJson) {
      for (const field of ['test:control-plane', 'test:coverage']) {
        if (!packageJson.scripts?.[field]?.includes('context-read-controls')) err(`[V99] package ${field} route missing context-read-controls`)
      }
      if (!packageJson.files?.includes('scripts/lib/validate-context-read-controls.js')) {
        err('[V99] package files missing validate-context-read-controls.js')
      }
    }

    checkFile('scripts/validate.js', ['buildContextReadControlChecks', 'length: 104', "owner: 'context-read-controls'"])
    const ownerSource = checkFile('scripts/lib/validate-context-read-controls.js', [
      'buildContextReadControlChecks', 'classifyContractSchemaSnapshot', 'classifyProfilePlanReadTrace',
      'classifyRuntimeToolSurface', 'classifyConsumerClosure'
    ])
    if (ownerSource.split(/\r?\n/).length > 600) err('[V99] context-read validator Owner exceeds 600-line ceiling')
    const registry = parseJsonArtifact('skills/spec-governance/gate-registry.json', ['context-acquisition'])
    if (!registry) return
    const groups = registry.groups.filter(group => group.id === 'context-acquisition')
    if (groups.length !== 1) {
      err(`[V99] context-acquisition gate group count must be 1, got ${groups.length}`)
      return
    }
    const group = groups[0]
    for (const owner of ['ai-agent-system-architecture', 'load-profile', 'memory', 'host-contract-verification']) {
      if (!group.ownerSkills.includes(owner)) err(`[V99] context-acquisition owner missing: ${owner}`)
    }
    for (const evidence of [
      'IntentSeedV1', 'ContextReadPlanV2', 'ContextReadReceiptV2', 'ContextReadPlanV1', 'ContextReadReceiptV1',
      'ContextReadBindingV1', 'testRouteDigest', 'intentExpansionDigest',
      'ContentIdentityV1', 'ContextReuseDecisionV1', 'StageTimingV1', 'ProfilePlanNoHiddenFullReadProbe'
    ]) {
      if (!group.requiredEvidence.includes(evidence)) err(`[V99] context-acquisition evidence missing: ${evidence}`)
    }
    if (!group.ownerSkills.includes('test-router')) {
      err('[V99] context-acquisition owner missing: test-router')
    }
    for (const route of ['V99', 'test-context-read', 'test-mcp-servers', 'test-hooks-runtime', 'V8', 'V92']) {
      if (!group.validationRoute.includes(route)) err(`[V99] context-acquisition validation route missing: ${route}`)
    }
    for (const anchor of ['ContextAcquisitionGate', 'ProfileReadChainGate', 'ContextAcquisitionToolAllowlistProbe']) {
      if (!group.legacyAnchors.includes(anchor)) err(`[V99] context-acquisition legacy anchor missing: ${anchor}`)
    }
  }

  function collectConsumerState() {
    const canonicalMissing = []
    const compatibilityMissing = []
    const forbiddenLegacy = []
    const collectMissing = (requirements, output) => {
      for (const [relative, needles] of requirements) {
        const content = readRelative(relative)
        if (content === null) {
          output.push(`${relative}:missing-file`)
          continue
        }
        for (const needle of needles) if (!content.includes(needle)) output.push(`${relative}:${needle}`)
      }
    }
    collectMissing(CANONICAL_V2_CONSUMER_REQUIREMENTS, canonicalMissing)
    collectMissing(V1_READER_COMPATIBILITY_REQUIREMENTS, compatibilityMissing)
    for (const [relative, needles] of FORBIDDEN_LEGACY_PRIMARY) {
      const content = readRelative(relative)
      for (const needle of needles) if ((content || '').includes(needle)) forbiddenLegacy.push(`${relative}:${needle}`)
    }

    const profileRoot = ACTIVE_DEVCODEX_ROOT ? pathApi.join(ACTIVE_DEVCODEX_ROOT, 'profile') : null
    if (profileRoot && fileSystem.existsSync(profileRoot)) {
      const collectProfileMissing = (requirements, output) => {
        for (const [relative, needles] of requirements) {
          const file = pathApi.join(profileRoot, relative)
          const content = fileSystem.existsSync(file) ? fileSystem.readFileSync(file, 'utf8') : ''
          if (!content) output.push(`profile/${relative}:missing-file`)
          else for (const needle of needles) if (!content.includes(needle)) output.push(`profile/${relative}:${needle}`)
        }
      }
      collectProfileMissing(PROFILE_CANONICAL_V2_REQUIREMENTS, canonicalMissing)
      collectProfileMissing(PROFILE_V1_READER_COMPATIBILITY_REQUIREMENTS, compatibilityMissing)
    }
    return { canonicalMissing, compatibilityMissing, forbiddenLegacy }
  }

  function checkV99() {
    checkDeterministicFixtures()
    checkRuntimeSources()
    checkRegistration()
    const consumerState = collectConsumerState()
    const closure = classifyConsumerClosure(consumerState)
    for (const missing of consumerState.canonicalMissing) err(`[V99] canonical V2 consumer parity missing: ${missing}`)
    for (const missing of consumerState.compatibilityMissing) err(`[V99] V1 reader compatibility missing: ${missing}`)
    for (const stale of consumerState.forbiddenLegacy) err(`[V99] legacy full-read primary residue: ${stale}`)
    console.log(`[V99] context acquisition controls checked: consumer=${closure} canonicalMissing=${consumerState.canonicalMissing.length} compatibilityMissing=${consumerState.compatibilityMissing.length}`)
  }

  return { checkV99 }
}

function runStandalone() {
  const ROOT = path.resolve(__dirname, '../..')
  const { resolveActiveRuntimeRoot } = require('../../hooks/_runtime/workspace-layout.cjs')
  const errors = []
  const read = createCanonicalAwareReader(ROOT, file => fs.readFileSync(file, 'utf8'))
  const checks = buildContextReadControlChecks({
    ROOT,
    ACTIVE_DEVCODEX_ROOT: resolveActiveRuntimeRoot(ROOT),
    fs,
    path,
    read,
    err: message => errors.push(message),
    console
  })
  checks.checkV99()
  if (errors.length) {
    errors.forEach(message => console.error(message))
    process.exitCode = 1
    return
  }
  console.log('✓ V99 context acquisition validator fixtures passed')
}

if (require.main === module) runStandalone()

module.exports = {
  buildContextReadControlChecks,
  classifyBindingCompletenessClaim,
  classifyConsumerClosure,
  classifyContextReadBindingSample,
  classifyContractSchemaSnapshot,
  classifyProfilePlanReadTrace,
  classifyRuntimeToolSurface
}
