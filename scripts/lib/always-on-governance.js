'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
  hasControlContentSource,
  resolveControlAsset
} = require('./control-content-delivery.js')

const SCHEMA = Object.freeze({
  surfaceMatrix: 'AlwaysOnSurfaceMatrixV1',
  hostMatrix: 'HostAdapterCompatibilityMatrixV1',
  layerMatrix: 'AlwaysOnLayerMatrixV1',
  upgradeTrigger: 'AlwaysOnUpgradeTriggerV1',
  loadReceipt: 'AlwaysOnLoadReceiptV1',
  shadowResult: 'AlwaysOnShadowResultV1',
  summary: 'AlwaysOnGovernanceSummaryV1'
})

const LAYER_RANK = Object.freeze({ L0: 0, L1: 1, L2: 2, L99: 3 })

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
  }
  return value
}

function digest(value) {
  const body = Buffer.isBuffer(value) || typeof value === 'string'
    ? value
    : JSON.stringify(stableValue(value))
  return crypto.createHash('sha256').update(body).digest('hex')
}

function portable(value) {
  return String(value || '').replace(/\\/g, '/')
}

function readJsonSafe(file) {
  try {
    if (!fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    return { __readError: String(error && error.message ? error.message : error) }
  }
}

function textMetrics(content) {
  const normalized = String(content || '')
  return {
    bytes: Buffer.byteLength(normalized, 'utf8'),
    lines: normalized ? normalized.split(/\r?\n/).length : 0,
    digest: digest(normalized)
  }
}

function countApplyToAll(content) {
  const matches = String(content || '').match(/applyTo\s*:\s*["']\*\*["']/g)
  return matches ? matches.length : 0
}

function readMarkdownFiles(root, options = {}) {
  if (!fs.existsSync(root)) return []
  const recursive = Boolean(options.recursive)
  const output = []
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (recursive) visit(full)
        continue
      }
      if (!entry.name.endsWith('.md') && !entry.name.endsWith('.instructions.md')) continue
      if (options.instructionsOnly && !entry.name.endsWith('.instructions.md')) continue
      const content = fs.readFileSync(full, 'utf8')
      output.push({
        path: full,
        relativePath: portable(path.relative(root, full)),
        ...textMetrics(content),
        applyToAllCount: countApplyToAll(content)
      })
    }
  }
  visit(root)
  return output.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

function summarizeFileSet(files) {
  const bytes = files.reduce((total, file) => total + file.bytes, 0)
  const lines = files.reduce((total, file) => total + file.lines, 0)
  const applyToAllCount = files.reduce((total, file) => total + file.applyToAllCount, 0)
  return { files: files.length, bytes, lines, applyToAllCount }
}

function instructionSurface({ id, host, root, owner, loadMode, required = false }) {
  const exists = fs.existsSync(root)
  const files = exists ? readMarkdownFiles(root, { instructionsOnly: true }) : []
  const summary = summarizeFileSet(files)
  return {
    id,
    host,
    path: root,
    relativePath: portable(root),
    exists,
    required,
    loadMode,
    owner,
    risk: summary.applyToAllCount ? 'high' : 'unknown',
    ...summary,
    fileDetails: files.map(file => ({
      path: file.relativePath,
      bytes: file.bytes,
      lines: file.lines,
      applyToAllCount: file.applyToAllCount,
      digest: file.digest
    })),
    status: exists ? 'present' : (required ? 'missing-required' : 'missing-optional'),
    evidence: exists
      ? [`files=${summary.files}`, `bytes=${summary.bytes}`, `applyToAll=${summary.applyToAllCount}`]
      : ['directory-missing']
  }
}

function singleFileSurface({ id, host, file, owner, loadMode, required = false, receipt = null }) {
  const exists = fs.existsSync(file)
  const content = exists ? fs.readFileSync(file, 'utf8') : ''
  const metrics = exists ? textMetrics(content) : { bytes: 0, lines: 0, digest: null }
  return {
    id,
    host,
    path: file,
    relativePath: portable(file),
    exists,
    required,
    loadMode,
    owner,
    risk: required ? 'medium' : 'low',
    files: exists ? 1 : 0,
    bytes: metrics.bytes,
    lines: metrics.lines,
    applyToAllCount: exists ? countApplyToAll(content) : 0,
    digest: metrics.digest,
    status: exists ? 'present' : (required ? 'missing-required' : 'missing-optional'),
    evidence: [
      exists ? `bytes=${metrics.bytes}` : 'file-missing',
      receipt?.sourceDigest ? `sourceDigest=${receipt.sourceDigest}` : null,
      receipt?.coverage ? `coverage=${receipt.coverage.percentage}` : null
    ].filter(Boolean)
  }
}

function buildAlwaysOnSurfaceMatrix(options = {}) {
  const packageRoot = path.resolve(options.packageRoot || path.resolve(__dirname, '../..'))
  const workspaceRoot = path.resolve(options.workspaceRoot || path.dirname(packageRoot))
  const controlContentLayout = hasControlContentSource(packageRoot) ? 'source' : 'delivery'
  const configPath = path.join(packageRoot, 'scripts', 'host-instruction-projection.json')
  const receiptPath = path.join(packageRoot, 'host-projections', 'coverage.json')
  const config = readJsonSafe(configPath)
  const receipt = readJsonSafe(receiptPath)
  const errors = []
  const warnings = []
  if (config?.__readError) errors.push(`projection-config-read-error:${config.__readError}`)
  if (receipt?.__readError) warnings.push(`projection-receipt-read-error:${receipt.__readError}`)
  if (receipt && receipt.validation && receipt.validation.valid !== true) {
    errors.push(`projection-receipt-invalid:${(receipt.validation.errors || []).join('|')}`)
  }
  const sourceInstructions = instructionSurface({
    id: 'source-instructions',
    host: 'shared-source',
    root: resolveControlAsset(packageRoot, 'instructions'),
    owner: 'instructions',
    loadMode: 'source-applyTo',
    required: true
  })
  const surfaces = [
    sourceInstructions,
    instructionSurface({
      id: 'workspace-github-instructions',
      host: 'copilot',
      root: path.join(workspaceRoot, '.github', 'instructions'),
      owner: 'workspace-deployment',
      loadMode: 'deployed-applyTo',
      required: false
    }),
    instructionSurface({
      id: 'workspace-claude-instructions',
      host: 'claude-code',
      root: path.join(workspaceRoot, '.claude', 'instructions'),
      owner: 'workspace-deployment',
      loadMode: 'deployed-applyTo',
      required: false
    }),
    instructionSurface({
      id: 'workspace-agents-instructions',
      host: 'codex-gemini-grok',
      root: path.join(workspaceRoot, '.agents', 'instructions'),
      owner: 'workspace-deployment',
      loadMode: 'optional-deployed-instructions',
      required: false
    }),
    singleFileSurface({
      id: 'shared-host-kernel',
      host: 'codex-claude-gemini-grok',
      file: path.join(packageRoot, 'host-projections', 'AGENTS.md'),
      owner: 'host-instruction-projection',
      loadMode: 'generated-kernel',
      required: true,
      receipt
    }),
    singleFileSurface({
      id: 'copilot-host-kernel',
      host: 'copilot',
      file: path.join(packageRoot, 'host-projections', 'copilot-instructions.md'),
      owner: 'host-instruction-projection',
      loadMode: 'generated-kernel',
      required: true,
      receipt
    }),
    singleFileSurface({
      id: 'full-fallback-source',
      host: 'shared',
      file: resolveControlAsset(packageRoot, 'instructions.md'),
      owner: 'instructions',
      loadMode: 'full-fallback-source',
      required: true,
      receipt
    })
  ]
  for (const surface of surfaces) {
    if (surface.required && !surface.exists) errors.push(`surface-missing:${surface.id}`)
  }
  if (sourceInstructions.files < 1) errors.push('source-instructions-empty')
  if (sourceInstructions.applyToAllCount < sourceInstructions.files) {
    warnings.push('source-applyTo-all-count-lower-than-file-count')
  }
  const matrixCore = {
    schemaVersion: SCHEMA.surfaceMatrix,
    readOnly: true,
    packageRoot,
    workspaceRoot,
    controlContentLayout,
    generatedAt: new Date().toISOString(),
    surfaces,
    totals: {
      surfaceCount: surfaces.length,
      presentCount: surfaces.filter(surface => surface.exists).length,
      requiredMissingCount: surfaces.filter(surface => surface.required && !surface.exists).length,
      applyToAllCount: surfaces.reduce((total, surface) => total + Number(surface.applyToAllCount || 0), 0)
    },
    budgets: {
      sourceApplyToFileBaseline: sourceInstructions.files,
      sourceApplyToBytesBaseline: sourceInstructions.bytes,
      sourceApplyToGrowthWarnRatio: 0.05,
      hostKernelCoverageRequired: 100
    },
    validation: { valid: errors.length === 0, errors, warnings }
  }
  const matrixIdentity = { ...matrixCore, generatedAt: null }
  return { ...matrixCore, matrixId: `always-on-surface-${digest(matrixIdentity)}` }
}

function buildHostAdapterCompatibilityMatrix() {
  const hosts = [
    {
      hostId: 'copilot-vscode',
      scope: 'workspace-native',
      alwaysOnSurface: ['.github/copilot-instructions.md', '.github/instructions/*.md'],
      onDemandSurface: ['text confirmation', 'manual full fallback', '.github/agents/'],
      hardBlockCapability: 'instruction-only',
      mcpCapability: 'none',
      rootChildBehavior: 'workspace instructions are visible where Copilot reads repository instructions',
      optimizationImpact: 'applyTo budget matters more than hook behavior',
      validationRoute: ['test-visible-output-contract', 'readme/client matrix'],
      fallback: 'text confirm + full instructions fallback',
      ao3ClaimLevel: 'instruction-backed-beta'
    },
    {
      hostId: 'copilot-jetbrains',
      scope: 'workspace-native',
      alwaysOnSurface: ['.github/copilot-instructions.md', '.github/instructions/*.md'],
      onDemandSurface: ['text fallback'],
      hardBlockCapability: 'instruction-only',
      mcpCapability: 'none',
      rootChildBehavior: 'JetBrains hook enforcement unsupported by current evidence',
      optimizationImpact: 'must keep instruction fallback readable',
      validationRoute: ['documentation evidence only'],
      fallback: 'manual full fallback',
      ao3ClaimLevel: 'instruction-backed-beta'
    },
    {
      hostId: 'claude-code',
      scope: 'workspace-native',
      alwaysOnSurface: ['CLAUDE.md', 'AGENTS.md shared kernel'],
      onDemandSurface: ['.claude/skills', '.claude/hooks', '.claude/mcp', 'full fallback'],
      hardBlockCapability: 'full',
      mcpCapability: 'auto',
      rootChildBehavior: 'workspace owner owns adapter assets under workspace-namespace',
      optimizationImpact: 'thin wrapper can stay small while hooks/MCP carry deep checks',
      validationRoute: ['test-host-installation', 'test-host-adapters', 'test-mcp-servers'],
      fallback: 'full fallback + hook strict where supported',
      ao3ClaimLevel: 'full-with-direct-evidence'
    },
    {
      hostId: 'codex',
      scope: 'workspace-native',
      alwaysOnSurface: ['AGENTS.md shared kernel', '.codex/hooks.json'],
      onDemandSurface: ['.agents/skills', 'Codex hooks', 'full fallback'],
      hardBlockCapability: 'partial',
      mcpCapability: 'manual',
      rootChildBehavior: 'Codex app/CLI uses AGENTS.md and hook guardrails when configured',
      optimizationImpact: 'kernel and visible output receipts must remain explicit',
      validationRoute: ['test-host-instruction-projection', 'test-visible-output-contract', 'current Codex session evidence'],
      fallback: 'full fallback + textual CP',
      ao3ClaimLevel: 'codex-surface-backed-beta'
    },
    {
      hostId: 'gemini-cli',
      scope: 'workspace-native',
      alwaysOnSurface: ['GEMINI.md wrapper', 'AGENTS.md shared kernel'],
      onDemandSurface: ['.gemini/settings.json', '.agents/skills', 'full fallback'],
      hardBlockCapability: 'unverified',
      mcpCapability: 'unverified',
      rootChildBehavior: 'wrapper exists; local direct CLI replay is not assumed',
      optimizationImpact: 'must not upgrade claims from generated wrapper alone',
      validationRoute: ['test-host-adapters fixture', 'direct replay required before full claim'],
      fallback: 'full fallback + unverified ceiling',
      ao3ClaimLevel: 'beta-unverified'
    },
    {
      hostId: 'grok-root-native',
      scope: 'user-registered-workspace',
      alwaysOnSurface: ['workspace AGENTS.md', 'single official user plugin identity'],
      onDemandSurface: ['workspace plugin bridge', 'MCP doctor', 'full fallback'],
      hardBlockCapability: 'partial-pretool-only',
      mcpCapability: 'auto-when-registered',
      rootChildBehavior: 'root native can see workspace kernel and plugin',
      optimizationImpact: 'passive stdout cannot prove context injection',
      validationRoute: ['test-host-adapters', 'test-host-installation', 'grok inspect when available'],
      fallback: 'devcodex grok launcher or full fallback',
      ao3ClaimLevel: 'root-native-with-direct-evidence'
    },
    {
      hostId: 'grok-plain-child',
      scope: 'user-registered-workspace',
      alwaysOnSurface: ['child project zero generated host artifacts', 'workspace plugin discovery'],
      onDemandSurface: ['best-effort resolver Skill', 'launcher recommended for full kernel'],
      hardBlockCapability: 'partial-pretool-only',
      mcpCapability: 'auto-when-registered',
      rootChildBehavior: 'plain child remains partial; no generated child AGENTS.md by default',
      optimizationImpact: 'cannot borrow root full claim',
      validationRoute: ['test-host-installation zeroProjectArtifacts', 'status/doctor owner parity'],
      fallback: 'devcodex grok launcher',
      ao3ClaimLevel: 'child-plain-partial'
    },
    {
      hostId: 'grok-launcher',
      scope: 'user-registered-workspace',
      alwaysOnSurface: ['devcodex grok --rules bound shared kernel'],
      onDemandSurface: ['merged user rules', 'workspace full fallback'],
      hardBlockCapability: 'partial-pretool-only',
      mcpCapability: 'auto-when-registered',
      rootChildBehavior: 'launcher evidence does not upgrade plain child',
      optimizationImpact: 'full kernel binding is explicit and observable',
      validationRoute: ['test-host-installation launcher rules fixtures'],
      fallback: 'reject override/cwd conflicts and use full fallback',
      ao3ClaimLevel: 'launcher-full'
    },
    {
      hostId: 'cursor',
      scope: 'user-global-beta',
      alwaysOnSurface: ['user ~/.cursor/hooks.json', 'workspaceOpen dynamic DevCodex Plugin', 'sessionStart kernel context'],
      onDemandSurface: ['Plugin resolver Skill', 'local stdio MCP', 'hidden staged SkillRoute'],
      hardBlockCapability: 'local-pretool-and-prompt',
      mcpCapability: 'auto-when-plugin-loaded',
      rootChildBehavior: 'local IDE/CLI/Headless share the user adapter without project host artifacts; Cloud does not load user hooks',
      optimizationImpact: 'local variants enter the beta denominator; Cloud remains separate and unverified',
      validationRoute: ['test-host-adapters', 'test-global-host-config', 'test-global-host-runtime-verifier', 'direct Cursor replay when available'],
      fallback: 'resolver rule-skill guidance with native status UNVERIFIED',
      ao3ClaimLevel: 'local-beta-cloud-unverified'
    },
    {
      hostId: 'chatgpt-plain',
      scope: 'unsupported',
      alwaysOnSurface: ['none'],
      onDemandSurface: ['manual paste'],
      hardBlockCapability: 'unsupported',
      mcpCapability: 'none',
      rootChildBehavior: 'does not read local workspace rules',
      optimizationImpact: 'excluded from AO-3 quality denominator',
      validationRoute: ['documentation only'],
      fallback: 'manual paste',
      ao3ClaimLevel: 'unsupported'
    }
  ]
  const invalidFullClaims = hosts
    .filter(host => /full/.test(host.ao3ClaimLevel) && ['instruction-only', 'unsupported', 'unverified'].includes(host.hardBlockCapability))
    .map(host => host.hostId)
  const grokModes = hosts.filter(host => host.hostId.startsWith('grok-')).map(host => host.hostId).sort()
  const errors = []
  if (invalidFullClaims.length) errors.push(`host-full-claim-without-capability:${invalidFullClaims.join(',')}`)
  for (const id of ['grok-launcher', 'grok-plain-child', 'grok-root-native']) {
    if (!grokModes.includes(id)) errors.push(`grok-mode-missing:${id}`)
  }
  const matrixCore = {
    schemaVersion: SCHEMA.hostMatrix,
    readOnly: true,
    hosts,
    coverage: {
      hostCount: hosts.length,
      grokModeCount: grokModes.length,
      unsupportedCount: hosts.filter(host => host.scope === 'unsupported').length,
      fullClaimCount: hosts.filter(host => /full/.test(host.ao3ClaimLevel)).length
    },
    validation: { valid: errors.length === 0, errors, warnings: [] }
  }
  return { ...matrixCore, matrixId: `always-on-host-${digest(matrixCore)}` }
}

function buildAlwaysOnLayerMatrix(options = {}) {
  const packageRoot = path.resolve(options.packageRoot || path.resolve(__dirname, '../..'))
  const config = readJsonSafe(path.join(packageRoot, 'scripts', 'host-instruction-projection.json')) || {}
  const mandatoryRuleIds = Array.isArray(config.mandatoryRuleIds) ? config.mandatoryRuleIds : []
  const entries = mandatoryRuleIds.map(ruleId => ({
    ruleId,
    layer: 'L0',
    ownerSkill: ruleId.startsWith('S') ? 'instructions/00-safety' : 'instructions/01-common',
    reason: 'mandatory invariant must remain visible before any optimization',
    trigger: 'every-turn',
    fallback: 'full-fallback-required-if-missing',
    probe: 'test-host-instruction-projection'
  }))
  entries.push(
    {
      ruleId: 'AlwaysOnUpgradeTriggerV1',
      layer: 'L1',
      ownerSkill: 'always-on-governance',
      reason: 'intent/risk decides whether deep rules are required',
      trigger: 'non-trivial task, source mutation, CP, control plane, review, release, governance intake, evidence uncertainty',
      fallback: 'L99 full-only',
      probe: 'test-always-on-governance'
    },
    {
      ruleId: 'AlwaysOnLoadReceiptV1',
      layer: 'L1',
      ownerSkill: 'always-on-governance',
      reason: 'records actual Context/Profile/Skill evidence for upgraded turns',
      trigger: 'classification layer greater than L0',
      fallback: 'fallback-full when receipt evidence is missing',
      probe: 'test-always-on-governance'
    },
    {
      ruleId: 'DomainDeepRules',
      layer: 'L2',
      ownerSkill: 'dev-default/fix-default/audit/report/memory/host-contract-verification/test-router',
      reason: 'workflow-specific rules are loaded only after intent/risk demands them',
      trigger: 'workflow, host, release, package, audit, source mutation or user challenge',
      fallback: 'full Skill/Profile read',
      probe: 'test-router targeted commands'
    },
    {
      ruleId: 'L99FullFallback',
      layer: 'L99',
      ownerSkill: 'host-instruction-projection',
      reason: 'state, schema, evidence or freshness uncertainty must restore full behavior',
      trigger: 'unknown schema, identity mismatch, stale projection, user challenge or full-only mode',
      fallback: 'read full fallback and full validation route',
      probe: 'test-host-instruction-projection'
    }
  )
  const l0Ids = new Set(entries.filter(entry => entry.layer === 'L0').map(entry => entry.ruleId))
  const missingL0 = mandatoryRuleIds.filter(id => !l0Ids.has(id))
  const errors = missingL0.map(id => `l0-mandatory-missing:${id}`)
  const matrixCore = {
    schemaVersion: SCHEMA.layerMatrix,
    readOnly: true,
    entries,
    coverage: {
      mandatoryRuleCount: mandatoryRuleIds.length,
      l0MandatoryCount: mandatoryRuleIds.filter(id => l0Ids.has(id)).length,
      layerCounts: Object.fromEntries(['L0', 'L1', 'L2', 'L99'].map(layer => [layer, entries.filter(entry => entry.layer === layer).length]))
    },
    validation: { valid: errors.length === 0, errors, warnings: [] }
  }
  return { ...matrixCore, matrixId: `always-on-layer-${digest(matrixCore)}` }
}

function classifyAlwaysOnUpgradeTriggers(input = {}) {
  const triggers = []
  const fallback = []
  const risk = String(input.riskClass || 'low')
  const taskKind = String(input.taskKind || 'chat')
  const messageKind = String(input.messageKind || 'ordinary')
  if (input.unknownSchema || input.stateStatus === 'invalid' || input.identityMismatch) fallback.push('state-or-schema-invalid')
  if (input.fullOnly) fallback.push('full-only')
  if (input.evidenceMissing) fallback.push('evidence-missing')
  if (['high', 'release', 'security', 'destructive'].includes(risk)) triggers.push('risk-not-low')
  if (['dev', 'fix'].includes(taskKind)) triggers.push('workflow-dev-fix')
  if (['audit', 'analyze'].includes(taskKind) || input.externalReview) triggers.push('analysis-or-review')
  if (input.documentOrRequirement || input.documentationOnly) triggers.push('document-or-requirement')
  if (input.sourceMutation) triggers.push('source-mutation')
  if (input.controlPlane) triggers.push('control-plane')
  if (input.hostRuntime) triggers.push('host-runtime')
  if (input.packageRelease) triggers.push('package-release')
  if (input.governanceIntake || input.ledgerWrite) triggers.push('governance-intake')
  if (input.artifactDelivery || messageKind === 'final-result') triggers.push('artifact-delivery')
  if (input.cpState && input.cpState !== 'not-applicable') triggers.push(input.cpState === 'confirmed' ? 'post-confirmation-review' : 'cp-gate')
  if (input.multiFile) triggers.push('multi-file')
  if (input.longTask) triggers.push('long-task')
  if (input.userQuestioningEvidence || input.userCorrection) triggers.push('user-challenge')

  const uniqueTriggers = Array.from(new Set(triggers)).sort()
  let layer = uniqueTriggers.length ? 'L1' : 'L0'
  const l2Triggers = new Set([
    'workflow-dev-fix',
    'analysis-or-review',
    'source-mutation',
    'control-plane',
    'host-runtime',
    'package-release',
    'governance-intake',
    'post-confirmation-review',
    'cp-gate',
    'multi-file',
    'long-task',
    'user-challenge'
  ])
  if (uniqueTriggers.some(trigger => l2Triggers.has(trigger))) layer = 'L2'
  if (fallback.length) layer = 'L99'
  return {
    schemaVersion: SCHEMA.upgradeTrigger,
    readOnly: true,
    taskKind,
    messageKind,
    riskClass: risk,
    layer,
    route: layer === 'L99' ? 'full-fallback' : (layer === 'L0' ? 'kernel-only' : 'load-required'),
    upgradeTriggers: uniqueTriggers,
    fallbackReason: fallback.length ? fallback.join(',') : null,
    validation: { valid: true, errors: [], warnings: [] }
  }
}

function buildAlwaysOnLoadReceipt(options = {}) {
  const intentSeed = options.intentSeed || {}
  const classification = options.classification || classifyAlwaysOnUpgradeTriggers(intentSeed)
  const skillsLoaded = Array.isArray(options.skillsLoaded) ? options.skillsLoaded : []
  const profileEvidence = Array.isArray(options.profileEvidence) ? options.profileEvidence : []
  const surfaceRefs = Array.isArray(options.surfaceRefs) ? options.surfaceRefs : []
  const errors = []
  if (!options.turnId) errors.push('turn-id-missing')
  if (classification.layer !== 'L0' && classification.layer !== 'L99') {
    if (!options.contextPlan) errors.push('context-plan-missing')
    if (!skillsLoaded.length) errors.push('skills-loaded-missing')
  }
  if (classification.layer === 'L99' && !classification.fallbackReason && !options.fallbackReason) {
    errors.push('fallback-reason-missing')
  }
  const receiptCore = {
    schemaVersion: SCHEMA.loadReceipt,
    readOnly: true,
    turnId: options.turnId || null,
    intentSeed,
    classification,
    contextPlan: options.contextPlan || null,
    skillsLoaded,
    profileEvidence,
    surfaceRefs,
    hostEvidence: options.hostEvidence || null,
    fallbackReason: options.fallbackReason || classification.fallbackReason || null,
    status: errors.length ? 'fallback-full' : 'pass',
    defaultBehaviorChanged: false,
    validation: { valid: errors.length === 0, errors, warnings: [] }
  }
  return { ...receiptCore, receiptId: `always-on-load-${digest(receiptCore)}` }
}

function shadowSample(id, scenario, input, expectedLayer, expectedTriggers, description) {
  return {
    id,
    scenario,
    description,
    input,
    expectedLayer,
    expectedTriggers,
    severity: 'P0'
  }
}

const DEFAULT_SHADOW_SAMPLES = Object.freeze([
  shadowSample('Q1-01', 'Q1', { taskKind: 'chat', riskClass: 'low' }, 'L0', [], 'simple chat stays kernel-only'),
  shadowSample('Q1-02', 'Q1', { taskKind: 'chat', riskClass: 'low', messageKind: 'progress' }, 'L0', [], 'progress ping remains compact'),
  shadowSample('Q1-03', 'Q1', { taskKind: 'chat', riskClass: 'low', documentOrRequirement: true }, 'L1', ['document-or-requirement'], 'light document question upgrades once'),
  shadowSample('Q1-04', 'Q1', { taskKind: 'chat', riskClass: 'low', evidenceMissing: true }, 'L99', [], 'missing evidence falls back'),
  shadowSample('Q1-05', 'Q1', { taskKind: 'chat', riskClass: 'low', userQuestioningEvidence: true }, 'L2', ['user-challenge'], 'user challenges evidence'),
  shadowSample('Q2-01', 'Q2', { taskKind: 'dev', documentationOnly: true, cpState: 'pending' }, 'L2', ['cp-gate', 'document-or-requirement', 'workflow-dev-fix'], 'docs requirement still needs CP'),
  shadowSample('Q2-02', 'Q2', { taskKind: 'dev', documentationOnly: true, cpState: 'confirmed' }, 'L2', ['document-or-requirement', 'post-confirmation-review', 'workflow-dev-fix'], 'confirmed docs need review'),
  shadowSample('Q2-03', 'Q2', { taskKind: 'dev', documentOrRequirement: true, artifactDelivery: true }, 'L2', ['artifact-delivery', 'document-or-requirement', 'workflow-dev-fix'], 'deliverable contract is visible'),
  shadowSample('Q2-04', 'Q2', { taskKind: 'dev', documentationOnly: true, multiFile: true }, 'L2', ['document-or-requirement', 'multi-file', 'workflow-dev-fix'], 'multi-file docs need deeper route'),
  shadowSample('Q2-05', 'Q2', { taskKind: 'dev', documentationOnly: true, userCorrection: true }, 'L2', ['document-or-requirement', 'user-challenge', 'workflow-dev-fix'], 'user correction triggers evidence review'),
  shadowSample('Q3-01', 'Q3', { taskKind: 'dev', sourceMutation: true }, 'L2', ['source-mutation', 'workflow-dev-fix'], 'source mutation requires dev workflow'),
  shadowSample('Q3-02', 'Q3', { taskKind: 'fix', sourceMutation: true }, 'L2', ['source-mutation', 'workflow-dev-fix'], 'fix mutation requires fix workflow'),
  shadowSample('Q3-03', 'Q3', { taskKind: 'dev', sourceMutation: true, multiFile: true }, 'L2', ['multi-file', 'source-mutation', 'workflow-dev-fix'], 'multi-file source mutation'),
  shadowSample('Q3-04', 'Q3', { taskKind: 'dev', sourceMutation: true, riskClass: 'high' }, 'L2', ['risk-not-low', 'source-mutation', 'workflow-dev-fix'], 'high-risk source mutation'),
  shadowSample('Q3-05', 'Q3', { taskKind: 'fix', sourceMutation: true, cpState: 'pending' }, 'L2', ['cp-gate', 'source-mutation', 'workflow-dev-fix'], 'fix CP cannot be skipped'),
  shadowSample('Q4-01', 'Q4', { taskKind: 'dev', controlPlane: true, hostRuntime: true, hostId: 'codex' }, 'L2', ['control-plane', 'host-runtime', 'workflow-dev-fix'], 'Codex host/runtime contract'),
  shadowSample('Q4-02', 'Q4', { taskKind: 'dev', hostRuntime: true, hostId: 'grok-plain-child' }, 'L2', ['host-runtime', 'workflow-dev-fix'], 'Grok plain child remains partial'),
  shadowSample('Q4-03', 'Q4', { taskKind: 'dev', hostRuntime: true, hostId: 'grok-launcher' }, 'L2', ['host-runtime', 'workflow-dev-fix'], 'Grok launcher evidence separated'),
  shadowSample('Q4-04', 'Q4', { taskKind: 'dev', hostRuntime: true, hostId: 'gemini-cli', evidenceMissing: true }, 'L99', ['host-runtime', 'workflow-dev-fix'], 'Gemini direct evidence missing'),
  shadowSample('Q4-05', 'Q4', { taskKind: 'dev', controlPlane: true, hostRuntime: true, riskClass: 'high' }, 'L2', ['control-plane', 'host-runtime', 'risk-not-low', 'workflow-dev-fix'], 'high-risk host control plane'),
  shadowSample('Q5-01', 'Q5', { taskKind: 'audit', externalReview: true }, 'L2', ['analysis-or-review'], 'external report review'),
  shadowSample('Q5-02', 'Q5', { taskKind: 'analyze', externalReview: true, userQuestioningEvidence: true }, 'L2', ['analysis-or-review', 'user-challenge'], 'review depth challenge'),
  shadowSample('Q5-03', 'Q5', { taskKind: 'audit', externalReview: true, multiFile: true }, 'L2', ['analysis-or-review', 'multi-file'], 'multi-file audit'),
  shadowSample('Q5-04', 'Q5', { taskKind: 'audit', externalReview: true, evidenceMissing: true }, 'L99', ['analysis-or-review'], 'external report evidence missing'),
  shadowSample('Q5-05', 'Q5', { taskKind: 'analyze', riskClass: 'high' }, 'L2', ['analysis-or-review', 'risk-not-low'], 'high-risk analysis'),
  shadowSample('Q6-01', 'Q6', { taskKind: 'dev', governanceIntake: true }, 'L2', ['governance-intake', 'workflow-dev-fix'], 'governance candidate required'),
  shadowSample('Q6-02', 'Q6', { taskKind: 'fix', governanceIntake: true, ledgerWrite: true }, 'L2', ['governance-intake', 'workflow-dev-fix'], 'ledger write evidence'),
  shadowSample('Q6-03', 'Q6', { taskKind: 'chat', governanceIntake: true }, 'L2', ['governance-intake'], 'user governance correction'),
  shadowSample('Q6-04', 'Q6', { taskKind: 'dev', governanceIntake: true, identityMismatch: true }, 'L99', ['governance-intake', 'workflow-dev-fix'], 'wrong active-root fallback'),
  shadowSample('Q6-05', 'Q6', { taskKind: 'audit', governanceIntake: true, externalReview: true }, 'L2', ['analysis-or-review', 'governance-intake'], 'external finding intake'),
  shadowSample('Q7-01', 'Q7', { taskKind: 'dev', packageRelease: true }, 'L2', ['package-release', 'workflow-dev-fix'], 'package release route'),
  shadowSample('Q7-02', 'Q7', { taskKind: 'dev', packageRelease: true, riskClass: 'release' }, 'L2', ['package-release', 'risk-not-low', 'workflow-dev-fix'], 'release risk'),
  shadowSample('Q7-03', 'Q7', { taskKind: 'dev', packageRelease: true, sourceMutation: true }, 'L2', ['package-release', 'source-mutation', 'workflow-dev-fix'], 'release with mutation'),
  shadowSample('Q7-04', 'Q7', { taskKind: 'dev', packageRelease: true, fullOnly: true }, 'L99', ['package-release', 'workflow-dev-fix'], 'full-only release fallback'),
  shadowSample('Q7-05', 'Q7', { taskKind: 'fix', packageRelease: true, cpState: 'pending' }, 'L2', ['cp-gate', 'package-release', 'workflow-dev-fix'], 'release fix cannot skip CP'),
  shadowSample('Q8-01', 'Q8', { taskKind: 'chat', messageKind: 'final-result', artifactDelivery: true }, 'L1', ['artifact-delivery'], 'final visible delivery'),
  shadowSample('Q8-02', 'Q8', { taskKind: 'dev', artifactDelivery: true, sourceMutation: true }, 'L2', ['artifact-delivery', 'source-mutation', 'workflow-dev-fix'], 'source delivery requires ECR'),
  shadowSample('Q8-03', 'Q8', { taskKind: 'audit', artifactDelivery: true, externalReview: true }, 'L2', ['analysis-or-review', 'artifact-delivery'], 'audit report delivery'),
  shadowSample('Q8-04', 'Q8', { taskKind: 'dev', artifactDelivery: true, evidenceMissing: true }, 'L99', ['artifact-delivery', 'workflow-dev-fix'], 'delivery missing evidence fallback'),
  shadowSample('Q8-05', 'Q8', { taskKind: 'dev', artifactDelivery: true, userQuestioningEvidence: true }, 'L2', ['artifact-delivery', 'user-challenge', 'workflow-dev-fix'], 'user asks why report is not detailed')
])

function evaluateAlwaysOnShadowSamples(samples = DEFAULT_SHADOW_SAMPLES) {
  const results = samples.map(sample => {
    const actual = classifyAlwaysOnUpgradeTriggers(sample.input)
    const expectedRank = LAYER_RANK[sample.expectedLayer]
    const actualRank = LAYER_RANK[actual.layer]
    const missingTriggers = (sample.expectedTriggers || []).filter(trigger => !actual.upgradeTriggers.includes(trigger))
    const missedRules = []
    if (actualRank < expectedRank) missedRules.push(`layer-underclassified:${actual.layer}<${sample.expectedLayer}`)
    for (const trigger of missingTriggers) missedRules.push(`trigger-missing:${trigger}`)
    const matched = missedRules.length === 0
    return {
      schemaVersion: SCHEMA.shadowResult,
      sampleId: sample.id,
      scenario: sample.scenario,
      description: sample.description,
      baselineRoute: sample.expectedLayer === 'L0' ? 'kernel-only' : (sample.expectedLayer === 'L99' ? 'full-fallback' : 'load-required'),
      optimizedRoute: actual.route,
      expectedLayer: sample.expectedLayer,
      actualLayer: actual.layer,
      expectedTriggers: sample.expectedTriggers,
      actualTriggers: actual.upgradeTriggers,
      matched,
      missedRules,
      severity: sample.severity || 'P0',
      decision: matched ? 'pass' : 'fail',
      fixRequired: !matched
    }
  })
  const failures = results.filter(result => !result.matched)
  const p0Misses = failures.filter(result => result.severity === 'P0')
  return {
    schemaVersion: 'AlwaysOnShadowEvaluationV1',
    readOnly: true,
    sampleSetId: `always-on-shadow-${digest(samples)}`,
    sampleCount: results.length,
    scenarioCounts: Object.fromEntries(['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8'].map(id => [
      id,
      results.filter(result => result.scenario === id).length
    ])),
    matchedCount: results.filter(result => result.matched).length,
    failedCount: failures.length,
    p0MissedCount: p0Misses.length,
    decision: p0Misses.length ? 'fail' : (failures.length ? 'warn' : 'pass'),
    results,
    validation: {
      valid: results.length >= 40 && p0Misses.length === 0,
      errors: [
        results.length < 40 ? `shadow-sample-count-too-low:${results.length}` : null,
        ...p0Misses.map(result => `p0-shadow-miss:${result.sampleId}:${result.missedRules.join(',')}`)
      ].filter(Boolean),
      warnings: failures.filter(result => result.severity !== 'P0').map(result => `shadow-warning:${result.sampleId}`)
    }
  }
}

function buildAlwaysOnGovernanceSummary(options = {}) {
  const packageRoot = path.resolve(options.packageRoot || path.resolve(__dirname, '../..'))
  const workspaceRoot = path.resolve(options.workspaceRoot || path.dirname(packageRoot))
  const surfaceMatrix = buildAlwaysOnSurfaceMatrix({ packageRoot, workspaceRoot })
  const hostMatrix = buildHostAdapterCompatibilityMatrix()
  const layerMatrix = buildAlwaysOnLayerMatrix({ packageRoot })
  const shadow = evaluateAlwaysOnShadowSamples(options.shadowSamples || DEFAULT_SHADOW_SAMPLES)
  const errors = [
    ...(surfaceMatrix.validation.errors || []),
    ...(hostMatrix.validation.errors || []),
    ...(layerMatrix.validation.errors || []),
    ...(shadow.validation.errors || [])
  ]
  const warnings = [
    ...(surfaceMatrix.validation.warnings || []),
    ...(hostMatrix.validation.warnings || []),
    ...(layerMatrix.validation.warnings || []),
    ...(shadow.validation.warnings || [])
  ]
  return {
    schemaVersion: SCHEMA.summary,
    status: errors.length ? 'warn' : (warnings.length ? 'warn' : 'pass'),
    readOnly: true,
    packageRoot,
    workspaceRoot,
    defaultBehaviorChanged: false,
    ao3Enabled: false,
    ao3Status: 'not-enabled-shadow-first',
    surfaceMatrix: {
      matrixId: surfaceMatrix.matrixId,
      controlContentLayout: surfaceMatrix.controlContentLayout,
      surfaceCount: surfaceMatrix.totals.surfaceCount,
      presentCount: surfaceMatrix.totals.presentCount,
      requiredMissingCount: surfaceMatrix.totals.requiredMissingCount,
      sourceApplyToFiles: surfaceMatrix.surfaces.find(surface => surface.id === 'source-instructions')?.files || 0,
      sourceApplyToBytes: surfaceMatrix.surfaces.find(surface => surface.id === 'source-instructions')?.bytes || 0,
      sourceApplyToAllCount: surfaceMatrix.surfaces.find(surface => surface.id === 'source-instructions')?.applyToAllCount || 0
    },
    hostMatrix: {
      matrixId: hostMatrix.matrixId,
      hostCount: hostMatrix.coverage.hostCount,
      grokModeCount: hostMatrix.coverage.grokModeCount,
      unsupportedCount: hostMatrix.coverage.unsupportedCount,
      fullClaimCount: hostMatrix.coverage.fullClaimCount
    },
    layerMatrix: {
      matrixId: layerMatrix.matrixId,
      mandatoryRuleCount: layerMatrix.coverage.mandatoryRuleCount,
      l0MandatoryCount: layerMatrix.coverage.l0MandatoryCount,
      layerCounts: layerMatrix.coverage.layerCounts
    },
    shadow: {
      sampleSetId: shadow.sampleSetId,
      sampleCount: shadow.sampleCount,
      scenarioCounts: shadow.scenarioCounts,
      matchedCount: shadow.matchedCount,
      p0MissedCount: shadow.p0MissedCount,
      decision: shadow.decision
    },
    matrices: options.includeMatrices ? { surfaceMatrix, hostMatrix, layerMatrix, shadow } : null,
    validation: { valid: errors.length === 0, errors, warnings }
  }
}

module.exports = {
  DEFAULT_SHADOW_SAMPLES,
  SCHEMA,
  buildAlwaysOnGovernanceSummary,
  buildAlwaysOnLayerMatrix,
  buildAlwaysOnLoadReceipt,
  buildAlwaysOnSurfaceMatrix,
  buildHostAdapterCompatibilityMatrix,
  classifyAlwaysOnUpgradeTriggers,
  countApplyToAll,
  digest,
  evaluateAlwaysOnShadowSamples,
  textMetrics
}
