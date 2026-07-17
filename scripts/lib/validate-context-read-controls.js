'use strict'

const fs = require('fs')
const path = require('path')
const { CONTEXT_READ_CONTRACT } = require('../../hooks/_runtime/context-read-contract.cjs')

const EXPECTED_SCHEMAS = Object.freeze({
  intentSeed: 'IntentSeedV1',
  plan: 'ContextReadPlanV1',
  receipt: 'ContextReadReceiptV1',
  error: 'ContextReadErrorV1',
  state: 'ContextReadStateV1'
})
const REQUIRED_PROFILE_TOOLS = Object.freeze(['profile_context_plan', 'profile_load'])
const REQUIRED_MEMORY_QUERY_TOOLS = Object.freeze(['memory_status', 'memory_session_query', 'memory_summary_query'])
const REQUIRED_MEMORY_LEGACY_TOOLS = Object.freeze([
  'memory_session_read',
  'memory_session_write',
  'memory_cp_confirm',
  'memory_summary_read',
  'memory_summary_append'
])
const CONSUMER_ACTIVATION_ANCHORS = Object.freeze(['ContextAcquisitionGate', 'profile_context_plan', 'V99'])

const CURRENT_CONSUMER_REQUIREMENTS = Object.freeze([
  ['instructions.md', ['ContextAcquisitionGate', 'IntentSeedV1', 'ContextReadPlanV1', 'ContextReadReceiptV1']],
  ['instructions/01-common.instructions.md', ['ContextAcquisitionGate', 'ContextReadPlanV1']],
  ['instructions/01a-profile-loading.instructions.md', ['ProfileReadChainGate', 'profile_context_plan', 'ProfilePlanNoHiddenFullReadProbe']],
  ['instructions/15-memory.instructions.md', ['MemoryContextQueryGate', 'memory_status', 'memory_session_query', 'memory_summary_query']],
  ['skills/ai-agent-system-architecture/SKILL.md', ['ContextAcquisitionGate', 'IntentSeedV1', 'ContextReadReceiptV1']],
  ['skills/load-profile/SKILL.md', ['ProfileReadChainGate', 'profile_context_plan', 'ProfilePlanNoHiddenFullReadProbe']],
  ['skills/memory/SKILL.md', ['MemoryContextQueryGate', 'memory_status', 'memory_session_query', 'memory_summary_query']],
  ['skills/host-contract-verification/SKILL.md', ['ContextReadReceiptV1', 'ContextAcquisitionToolAllowlistProbe', 'PostToolUse']],
  ['skills/test-router/SKILL.md', ['context-acquisition', 'V99']],
  ['skills/report/report-schema.json', ['ContextAcquisition']],
  ['prompts/technical-design.prompt.md', ['context-acquisition', 'ContextReadPlanV1', 'V99']],
  ['prompts/implementation-plan.prompt.md', ['context-acquisition', 'ProfilePlanNoHiddenFullReadProbe', 'V99']],
  ['prompts/report-dev.prompt.md', ['ContextAcquisition', 'ContextReadReceiptV1', 'V99']],
  ['README.md', ['profile_context_plan', 'memory_status', 'ContextReadReceiptV1']],
  ['website/docs/guide/development.md', ['profile_context_plan', 'memory_status', 'ContextReadReceiptV1']],
  ['changelogs/unreleased.md', CONSUMER_ACTIVATION_ANCHORS]
])

const PROFILE_CONSUMER_REQUIREMENTS = Object.freeze([
  ['01-项目信息.md', ['V99', 'test:context-read-controls']],
  ['02-架构约束.md', ['context-read-contract.cjs', 'validate-context-read-controls.js']],
  ['04-测试规范.md', ['V99', 'test:context-read', 'test:context-read-controls']],
  ['06-功能清单.md', ['profile_context_plan', 'memory_status', 'ContextReadReceiptV1']],
  ['07-用户文档与契约规范.md', ['ContextAcquisitionGate', 'targeted', 'legacy']]
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
  if (!snapshot || !['none', 'partial', 'complete'].includes(snapshot.activationState)) {
    return 'invalid-consumer-snapshot'
  }
  if (snapshot.activationState === 'partial') return 'activation-incomplete'
  if (snapshot.activationState === 'none') return 'consumer-sync-staged'
  if ((snapshot.missing || []).length) return 'consumer-incomplete'
  if ((snapshot.forbiddenLegacy || []).length) return 'legacy-primary-drift'
  return 'consumer-ready'
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

  function readRelative(relative) {
    const file = pathApi.join(ROOT, relative)
    return fileSystem.existsSync(file) ? fileSystem.readFileSync(file, 'utf8') : null
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
    expect(classifyConsumerClosure({ activationState: 'none', missing: ['docs'] }), 'consumer-sync-staged', 'staged consumer positive')
    expect(classifyConsumerClosure({ activationState: 'partial' }), 'activation-incomplete', 'partial activation negative')
    expect(classifyConsumerClosure({ activationState: 'complete', missing: ['README'] }), 'consumer-incomplete', 'consumer missing negative')
    expect(classifyConsumerClosure({ activationState: 'complete', forbiddenLegacy: ['full-read-first'] }), 'legacy-primary-drift', 'legacy primary negative')
    expect(classifyConsumerClosure({ activationState: 'complete' }), 'consumer-ready', 'consumer positive')
  }

  function checkRuntimeSources() {
    const contractSource = checkFile('hooks/_runtime/context-read-contract.cjs', [
      'IntentSeedV1', 'ContextReadPlanV1', 'ContextReadReceiptV1', 'ContextReadErrorV1',
      'normalizeIntentSeed', 'buildContextReadPlan', 'createContextReadReceipt', 'deriveLegacyBootstrapProjection'
    ])
    const profileSource = checkFile('mcp/profile-server.js', [
      "name: 'profile_context_plan'", "name: 'profile_load'", 'collectProfilePlanInputs',
      "case 'profile_context_plan'", "case 'profile_load'", 'bounded-top-level-profile-inventory',
      'CONTEXT_READ_CONTRACT', 'handleProfileContextPlan'
    ])
    const memorySource = checkFile('mcp/memory-server.js', [
      "name: 'memory_status'", "name: 'memory_session_query'", "name: 'memory_summary_query'",
      "case 'memory_status'", "case 'memory_session_query'", "case 'memory_summary_query'",
      'MemoryStatusV1', 'MemorySessionQueryV1', 'MemorySummaryQueryV1', 'CONTEXT_READ_CONTRACT'
    ])
    const bootstrapSource = checkFile('hooks/_runtime/lifecycle-bootstrap-state.cjs', [
      'classifyContextAcquisitionTool', 'recordContextPreToolUse', 'recordContextPostToolUse',
      'structured-plan', 'path-observable', 'instruction-only', 'syncContextProjection'
    ])
    checkFile('hooks/_runtime/lifecycle.cjs', [
      'beginContextAcquisition', 'recordContextPreToolUse', 'recordContextPostToolUse',
      'getContextAcquisitionDecision', 'markContextAcquisitionStale'
    ])
    checkFile('scripts/test-context-read-contract.js', ['mandatoryMisses', 'falseComplete=0', 'siblingPlan.observations = []'])
    checkFile('scripts/test-mcp-servers.js', [
      'testProfileContextPlanReadTrace', 'plan hidden-read detected', 'legacy full-read compatibility trace lost',
      'all new memory projection tools must be zero-write'
    ])
    checkFile('scripts/test-hooks-runtime.js', ['buildTestHooksRuntimeFixtures', 'runBootstrapReads'])
    checkFile('scripts/lib/test-hooks-runtime-bootstrap-layout.js', [
      'mcp__devcodex-profile__profile_context_plan', 'mcp__devcodex-memory__memory_summary_append',
      'mcp__evil__profile_context_plan', 'fallbackAttempts'
    ])

    expect(classifyContractSchemaSnapshot(CONTEXT_READ_CONTRACT.schemas), 'schema-ready', 'runtime contract schemas')
    if (CONTEXT_READ_CONTRACT.intents.length !== 8 || !CONTEXT_READ_CONTRACT.errors.includes('MEMORY_SCOPE_AMBIGUOUS')) {
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

    checkFile('scripts/validate.js', ['buildContextReadControlChecks', 'length: 99', "owner: 'context-read-controls'"])
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
    for (const evidence of ['IntentSeedV1', 'ContextReadPlanV1', 'ContextReadReceiptV1', 'ProfilePlanNoHiddenFullReadProbe']) {
      if (!group.requiredEvidence.includes(evidence)) err(`[V99] context-acquisition evidence missing: ${evidence}`)
    }
    for (const route of ['V99', 'test-context-read', 'test-mcp-servers', 'test-hooks-runtime', 'V8', 'V92']) {
      if (!group.validationRoute.includes(route)) err(`[V99] context-acquisition validation route missing: ${route}`)
    }
    for (const anchor of ['ContextAcquisitionGate', 'ProfileReadChainGate', 'ContextAcquisitionToolAllowlistProbe']) {
      if (!group.legacyAnchors.includes(anchor)) err(`[V99] context-acquisition legacy anchor missing: ${anchor}`)
    }
  }

  function collectConsumerState() {
    const changelog = readRelative('changelogs/unreleased.md') || ''
    const activationCount = CONSUMER_ACTIVATION_ANCHORS.filter(anchor => changelog.includes(anchor)).length
    const activationState = activationCount === 0
      ? 'none'
      : (activationCount === CONSUMER_ACTIVATION_ANCHORS.length ? 'complete' : 'partial')
    const missing = []
    const forbiddenLegacy = []
    for (const [relative, needles] of CURRENT_CONSUMER_REQUIREMENTS) {
      const content = readRelative(relative)
      if (content === null) {
        missing.push(`${relative}:missing-file`)
        continue
      }
      for (const needle of needles) if (!content.includes(needle)) missing.push(`${relative}:${needle}`)
    }
    for (const [relative, needles] of FORBIDDEN_LEGACY_PRIMARY) {
      const content = readRelative(relative) || ''
      for (const needle of needles) if (content.includes(needle)) forbiddenLegacy.push(`${relative}:${needle}`)
    }

    const profileRoot = ACTIVE_DEVCODEX_ROOT ? pathApi.join(ACTIVE_DEVCODEX_ROOT, 'profile') : null
    if (profileRoot && fileSystem.existsSync(profileRoot)) {
      for (const [relative, needles] of PROFILE_CONSUMER_REQUIREMENTS) {
        const file = pathApi.join(profileRoot, relative)
        const content = fileSystem.existsSync(file) ? fileSystem.readFileSync(file, 'utf8') : ''
        if (!content) missing.push(`profile/${relative}:missing-file`)
        else for (const needle of needles) if (!content.includes(needle)) missing.push(`profile/${relative}:${needle}`)
      }
    }
    return { activationState, missing, forbiddenLegacy }
  }

  function checkV99() {
    checkDeterministicFixtures()
    checkRuntimeSources()
    checkRegistration()
    const consumerState = collectConsumerState()
    const closure = classifyConsumerClosure(consumerState)
    if (closure === 'activation-incomplete') {
      err('[V99] context acquisition public activation is partial; changelog claim must be all-of')
    } else if (consumerState.activationState === 'complete' && closure !== 'consumer-ready') {
      for (const missing of consumerState.missing) err(`[V99] consumer parity missing: ${missing}`)
      for (const stale of consumerState.forbiddenLegacy) err(`[V99] legacy full-read primary residue: ${stale}`)
    }
    console.log(`[V99] context acquisition controls checked: consumer=${closure} missing=${consumerState.missing.length}`)
  }

  return { checkV99 }
}

function runStandalone() {
  const ROOT = path.resolve(__dirname, '../..')
  const { resolveActiveRuntimeRoot } = require('../../hooks/_runtime/workspace-layout.cjs')
  const errors = []
  const checks = buildContextReadControlChecks({
    ROOT,
    ACTIVE_DEVCODEX_ROOT: resolveActiveRuntimeRoot(ROOT),
    fs,
    path,
    read: file => fs.readFileSync(file, 'utf8'),
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
  classifyConsumerClosure,
  classifyContractSchemaSnapshot,
  classifyProfilePlanReadTrace,
  classifyRuntimeToolSurface
}
