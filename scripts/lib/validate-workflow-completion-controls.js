'use strict'

const fs = require('fs')
const path = require('path')
const {
  createCanonicalAwareReader,
  evaluatePublicReadmeContract
} = require('./canonical-consumer-contracts')

const REQUIRED_DEFINITIONS = [
  'WorkflowCompletionCandidateV1',
  'WorkflowCompletionPlanV1',
  'WorkflowEvidenceReceiptV1',
  'WorkflowCompletionSnapshotV1',
  'PhaseTerminalStateV1',
  'WorkflowCompletionReportRefV1',
  'WorkflowCompletionMemoryRefV1',
  'WorkflowCompletionCommitV1',
  'CommitValidationResultV1',
  'WorkflowCompletionProjectionV1',
  'RiskAcceptanceReceiptV1',
  'RolloutStateV1',
  'ShadowEvidenceWindowV1'
]

const ALIASES = [
  ['T1', 'requirements.coverage'],
  ['T2', 'delivery.report'],
  ['T3', 'delivery.memory'],
  ['T4', 'confirmation.cp'],
  ['T5', 'governance.compliance'],
  ['T6', 'constraints.and-sync'],
  ['T7', 'workflow.verification'],
  ['T8', 'continuity.summary'],
  ['T9', 'delivery.manifest'],
  ['T10', 'long-task.timing-and-coverage'],
  ['T11', 'long-task.budget-and-authorization'],
  ['T12', 'deployment.and-completion-evidence'],
  ['T13', 'post-delivery.self-check']
]

function inspectWorkflowCompletionControls(root, io = {}) {
  const fileSystem = io.fs || fs
  const pathApi = io.path || path
  const activeRoot = io.activeRoot || null
  const issues = []
  const readAbsolute = createCanonicalAwareReader(
    root,
    file => fileSystem.readFileSync(file, 'utf8'),
    file => fileSystem.existsSync(file)
  )
  const read = relative => readAbsolute(pathApi.join(root, relative))
  const exists = relative => readAbsolute.exists(pathApi.join(root, relative))
  const requiredFiles = [
    'hooks/_runtime/workflow-completion-contract.cjs',
    'hooks/_runtime/lifecycle-workflow-completion.cjs',
    'skills/compliance/workflow-completion.schema.json',
    'scripts/lib/validate-workflow-completion-controls.js',
    'scripts/test-workflow-completion-contract.js',
    'scripts/lib/completion-report-ecr-check.js',
    'scripts/test-completion-report-ecr-check.js',
    'scripts/lib/cli-execution-commands.js',
    'scripts/lib/cli-maintenance-commands.js',
    'scripts/lib/cli-observability-commands.js',
    'hooks/_runtime/lifecycle-visible-reply.cjs',
    'scripts/validation-manifest.json',
    'scripts/critical-coverage.json',
    'package.json',
    'scripts/test-host-adapters.js',
    'README.md',
    'changelogs/unreleased.md'
  ]
  const sourceOnlyConsumerFiles = [
    'website/docs/guide/development.md',
    'website/docs/specs/compliance-framework.md',
    'website/docs/specs/completion-compliance-flow.md'
  ]
  for (const relative of requiredFiles) if (!exists(relative)) issues.push(`missing-file:${relative}`)
  const sourceCheckoutMode = exists('.git') || sourceOnlyConsumerFiles.some(relative => exists(relative))
  if (sourceCheckoutMode) {
    for (const relative of sourceOnlyConsumerFiles) if (!exists(relative)) issues.push(`missing-source-consumer:${relative}`)
  }
  if (issues.some(issue => issue.startsWith('missing-file:'))) return issues
  if (issues.some(issue => issue.startsWith('missing-source-consumer:'))) return issues

  let schema
  try {
    schema = JSON.parse(read('skills/compliance/workflow-completion.schema.json'))
  } catch (error) {
    issues.push(`schema-json-invalid:${error.message}`)
  }
  if (schema) {
    if (schema.$id !== 'https://devcodex.dev/schemas/workflow-completion-v1.json') issues.push('schema-id-drift')
    for (const definition of REQUIRED_DEFINITIONS) {
      if (!schema.$defs?.[definition]) issues.push(`schema-definition-missing:${definition}`)
    }
  }

  const owner = read('hooks/_runtime/workflow-completion-contract.cjs')
  for (const anchor of [
    'createWorkflowCompletionCandidate',
    'createWorkflowCompletionPlan',
    'createWorkflowEvidenceReceipt',
    'evaluateReceiptFreshness',
    'evaluateWorkflowCompletion',
    'createRiskAcceptanceReceipt',
    'createWorkflowCompletionCommit',
    'validateWorkflowCompletionCommit',
    'projectWorkflowCompletion',
    'evaluateShadowEvidenceWindow'
  ]) {
    if (!owner.includes(anchor)) issues.push(`owner-export-missing:${anchor}`)
  }
  for (const forbidden of ["require('fs')", "require('child_process')", "require('http')", "require('https')", 'execSync(', 'spawnSync(']) {
    if (owner.includes(forbidden)) issues.push(`pure-owner-io-forbidden:${forbidden}`)
  }
  if ((owner.match(/function evaluateWorkflowCompletion\s*\(/g) || []).length !== 1) issues.push('aggregate-owner-not-unique')

  const adapter = read('hooks/_runtime/lifecycle-workflow-completion.cjs')
  for (const anchor of [
    'buildSourceRef',
    'adaptSourceRefs',
    'materializeWorkflowCompletionInput',
    'reconcileWorkflowCompletion',
    'readWorkflowCompletionState',
    'readWorkflowCompletionRollout',
    'recordShadowEvidenceSample',
    'readShadowEvidenceWindow',
    'observeWorkflowCompletionEvent',
    'createDerivedStateStore',
    'completionRouteForHost'
  ]) {
    if (!adapter.includes(anchor)) issues.push(`lifecycle-adapter-export-missing:${anchor}`)
  }
  if ((adapter.match(/evaluateWorkflowCompletion\s*\(/g) || []).length !== 1) issues.push('lifecycle-adapter-core-call-not-unique')
  if (/workflowComplete\s*=\s*true/.test(adapter)) issues.push('lifecycle-adapter-direct-completion-forbidden')

  const ecr = read('scripts/lib/completion-report-ecr-check.js')
  for (const anchor of ['WorkflowCompletionReportRefV1', 'resolveWorkflowCompletionReport', 'commitWorkflowCompletionDelivery', 'validateCommittedMemoryRefs', 'WORKFLOW_SIDECAR_PATH_UNSAFE', 'WORKFLOW_MEMORY_READBACK_INVALID']) {
    if (!ecr.includes(anchor)) issues.push(`structured-ecr-anchor-missing:${anchor}`)
  }
  const cliConsumers = [
    ['scripts/lib/cli-execution-commands.js', ['task.verify', 'task.risk.', 'resolveUniqueActiveTaskContinuation']],
    ['scripts/lib/cli-maintenance-commands.js', ['--completion', 'readCompletionForCli']],
    ['scripts/lib/cli-observability-commands.js', ['--completion', 'readCompletionForCli']],
    ['hooks/_runtime/lifecycle-visible-reply.cjs', ['projectWorkflowCompletionVisibleState', 'projectionDigest']]
  ]
  for (const [relative, anchors] of cliConsumers) {
    const content = read(relative)
    for (const anchor of anchors) if (!content.includes(anchor)) issues.push(`completion-consumer-anchor-missing:${relative}:${anchor}`)
  }

  const test = read('scripts/test-workflow-completion-contract.js')
  for (const anchor of ['negativeProbes.length >= 36', 'permutations=100', 'COMMIT_MANIFEST_CYCLE', 'fresh-reused', 'rolled-back-cannot-pass', 'task-isolation', 'lifecycle-stop-no-complete', 'shadow-ruleset-change-resets-current', 'shadow-outside-rolling-window-excluded']) {
    if (!test.includes(anchor)) issues.push(`main-test-anchor-missing:${anchor}`)
  }
  const hostTest = read('scripts/test-host-adapters.js')
  for (const anchor of ['HostCompletionRouteV1', 'hostCompletionFixtures', 'completion semantics must match the shared reducer']) {
    if (!adapter.includes(anchor) && !hostTest.includes(anchor)) issues.push(`host-completion-matrix-anchor-missing:${anchor}`)
  }
  const publicConsumers = [
    ['README.md', ['devcodex task verify', 'extensions.devcodex.workflowCompletion.mode', 'WorkflowCompletionCandidateV1']],
    ['changelogs/unreleased.md', ['Workflow completion Shadow', 'HostCompletionRouteV1', '20/dev5/fix5']]
  ]
  if (sourceCheckoutMode) {
    publicConsumers.push(['website/docs/guide/development.md', ['devcodex task verify', 'workflowCompletion.mode', 'waiting-external']])
  }
  for (const [relative, anchors] of publicConsumers) {
    const content = read(relative)
    if (relative === 'README.md') {
      const contract = evaluatePublicReadmeContract(content)
      if (!contract.valid) {
        issues.push(`completion-public-consumer-drift:README.md:PublicReadmeContractV1:${contract.missing.join('|')}`)
      }
      continue
    }
    for (const anchor of anchors) if (!content.includes(anchor)) issues.push(`completion-public-consumer-drift:${relative}:${anchor}`)
  }

  const packageJson = JSON.parse(read('package.json'))
  if (packageJson.scripts?.['test:workflow-completion'] !== 'node scripts/test-workflow-completion-contract.js && node scripts/test-completion-report-ecr-check.js') issues.push('package-script-workflow-completion-missing')
  if (!packageJson.scripts?.['test:control-plane']?.includes('test:workflow-completion')) issues.push('package-script-route-missing:test:control-plane')
  if (!packageJson.scripts?.['test:coverage-target']?.includes('test:control-plane')) issues.push('package-script-route-missing:test:coverage-target')
  if (!packageJson.scripts?.['test:critical-coverage-target']?.includes('test-workflow-completion-contract.js')) issues.push('critical-coverage-target-missing')
  for (const packaged of ['scripts/lib/validate-workflow-completion-controls.js', 'scripts/test-workflow-completion-contract.js', 'scripts/lib/completion-report-ecr-check.js', 'scripts/test-completion-report-ecr-check.js']) {
    if (!packageJson.files?.includes(packaged)) issues.push(`package-file-missing:${packaged}`)
  }

  const coverage = JSON.parse(read('scripts/critical-coverage.json'))
  for (const modulePath of ['hooks/_runtime/workflow-completion-contract.cjs', 'hooks/_runtime/lifecycle-workflow-completion.cjs', 'scripts/lib/validate-workflow-completion-controls.js']) {
    const moduleConfig = coverage.modules?.find(item => item.path === modulePath)
    if (!moduleConfig) issues.push(`critical-coverage-module-missing:${modulePath}`)
    else {
      const expected = { lines: 90, statements: 90, functions: 100, branches: 85 }
      for (const [metric, floor] of Object.entries(expected)) {
        if (Number(moduleConfig.thresholds?.[metric]) < floor) issues.push(`critical-coverage-threshold-low:${modulePath}:${metric}`)
      }
    }
  }

  const manifest = JSON.parse(read('scripts/validation-manifest.json'))
  const node = manifest.nodes?.find(item => item.id === 'workflow-completion-contract')
  if (!node) issues.push('validation-node-missing:workflow-completion-contract')
  else {
    for (const input of requiredFiles.slice(0, 12)) if (!node.inputs?.includes(input)) issues.push(`validation-node-input-missing:${input}`)
    for (const artifact of ['WorkflowCompletionCandidateV1', 'WorkflowCompletionSnapshotV1', 'WorkflowCompletionProjectionV1']) {
      if (!node.evidenceArtifacts?.includes(artifact)) issues.push(`validation-node-artifact-missing:${artifact}`)
    }
  }
  for (const route of ['fast', 'full', 'profile-deploy', 'package-release']) {
    if (!manifest.routes?.[route]?.nodes?.includes('workflow-completion-contract')) issues.push(`validation-route-missing:${route}`)
  }

  const activeProfileRoot = activeRoot ? pathApi.join(activeRoot, 'profile') : null
  if (activeProfileRoot && fileSystem.existsSync(activeProfileRoot)) {
    const configPath = pathApi.join(activeRoot, 'profile', 'config.json')
    if (!fileSystem.existsSync(configPath)) issues.push('profile-rollout-config-missing')
    else {
      try {
        const config = JSON.parse(fileSystem.readFileSync(configPath, 'utf8'))
        if (config?.extensions?.devcodex?.workflowCompletion?.mode !== 'shadow') issues.push('profile-rollout-mode-not-shadow')
      } catch (error) {
        issues.push(`profile-rollout-config-invalid:${error.message}`)
      }
    }
    for (const [file, anchors] of [
      ['01-项目信息.md', ['workflowCompletion.mode', 'B5a shadow readiness']],
      ['02-架构约束.md', ['workflow-completion-contract.cjs', 'lifecycle-workflow-completion.cjs']],
      ['04-测试规范.md', ['test:workflow-completion', 'Workflow completion / ECR']],
      ['06-功能清单.md', ['workflow-completion', 'unreleased-shadow-after-v1.15.3']],
      ['07-用户文档与契约规范.md', ['Workflow completion 契约', 'waiting-external']]
    ]) {
      const profilePath = pathApi.join(activeRoot, 'profile', file)
      if (!fileSystem.existsSync(profilePath)) issues.push(`profile-completion-consumer-missing:${file}`)
      else {
        const content = fileSystem.readFileSync(profilePath, 'utf8')
        for (const anchor of anchors) if (!content.includes(anchor)) issues.push(`profile-completion-consumer-drift:${file}:${anchor}`)
      }
    }
  }

  const aliasConsumers = [
    'instructions.md',
    'instructions/01-common.instructions.md',
    'instructions/17-compliance.instructions.md',
    'skills/compliance/SKILL.md',
    'scripts/host-instruction-projection.json'
  ]
  if (sourceCheckoutMode) {
    aliasConsumers.push('website/docs/specs/compliance-framework.md', 'website/docs/specs/completion-compliance-flow.md')
  }
  const legacyRange = ['T1', 'T9'].join('~')
  for (const relative of aliasConsumers) {
    if (String(read(relative)).includes(legacyRange)) issues.push(`legacy-completion-range:${relative}`)
  }
  for (const relative of ['instructions.md', 'instructions/17-compliance.instructions.md', 'skills/compliance/SKILL.md']) {
    const content = read(relative)
    for (const [alias, canonicalId] of ALIASES) {
      if (!content.includes(`| ${alias} | \`${canonicalId}\` |`)) issues.push(`completion-alias-drift:${relative}:${alias}`)
    }
  }

  return issues
}

function buildWorkflowCompletionControlChecks(ctx) {
  function checkV104() {
    const issues = inspectWorkflowCompletionControls(ctx.ROOT, { fs: ctx.fs, path: ctx.path, activeRoot: ctx.ACTIVE_DEVCODEX_ROOT })
    for (const issue of issues) ctx.err(`[V104] ${issue}`)
    if (!issues.length) ctx.console.log('[V104] workflow completion owner / schema / aliases / DAG / coverage / package closure checked')
  }
  return { checkV104 }
}

if (require.main === module) {
  const issues = inspectWorkflowCompletionControls(path.resolve(__dirname, '..', '..'))
  if (issues.length) {
    for (const issue of issues) process.stderr.write(`[V104] ${issue}\n`)
    process.exitCode = 1
  } else {
    console.log('[V104] workflow completion controls passed')
  }
}

module.exports = { ALIASES, REQUIRED_DEFINITIONS, buildWorkflowCompletionControlChecks, inspectWorkflowCompletionControls }
