#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { CheckedCommandError } = require('./lib/checked-command')
const { buildContentIdentity, sha256, stableStringify } = require('../hooks/_runtime/content-identity.cjs')
const {
  ValidationDagError,
  NARRATIVE_MARKDOWN_EXCLUSIONS,
  buildCandidateIdentity,
  buildChangeDescriptors,
  buildValidationImpactGraph,
  cacheDescriptor,
  cacheRelativePath,
  commandSignature,
  buildNestedCommandGraph,
  planLockAwareSchedule,
  expandSelectedWithNestedLeaves,
  executeValidationPlan: executeValidationPlanUnbound,
  manifestIdentity,
  planValidation,
  readValidationManifest,
  toValidationPlanV1,
  validateValidationManifest
} = require('./lib/validation-dag')
const {
  ValidationAuthorityError,
  createVerificationExecutionLease
} = require('./lib/validation-execution-authority')
const { createValidationOrchestration } = require('./lib/validation-orchestration')
const { isNarrativeMarkdownPath, normalizeNarrativePath } = require('./lib/narrative-markdown-policy')
const {
  detectedActorType,
  expectedCiPolicyDigest,
  parseArgs,
  resolveValidationAuthorityContext,
  resolveActorType,
  validationExecutionError
} = require('./run-validation')

const ROOT = path.resolve(__dirname, '..')
const MANIFEST_PATH = path.join(__dirname, 'validation-manifest.json')
const clone = value => JSON.parse(JSON.stringify(value))

function fixtureNode(id, options = {}) {
  return {
    schemaVersion: 'ValidationNodeV1',
    id,
    owner: 'fixture-owner',
    command: options.command || process.execPath,
    args: options.args || ['-e', 'process.exit(0)', '--', id],
    dependencies: options.dependencies || [],
    inputs: options.inputs || ['fixture/**'],
    consumers: options.consumers || [],
    invariants: options.invariants || ['fixture-contract'],
    riskClass: options.riskClass || 'normal',
    cachePolicy: options.cachePolicy || 'never',
    writeScopes: options.writeScopes === undefined ? ['isolated-temp'] : options.writeScopes,
    timeoutMs: options.timeoutMs || 5000,
    exitMap: { success: [0], failure: 'nonzero-or-signal', timeout: 'ETIMEDOUT' },
    evidenceArtifacts: ['ValidationExecutionReceiptV1'],
    ...(options.estimatedDurationMs === undefined ? {} : { estimatedDurationMs: options.estimatedDurationMs }),
    ...(options.delegatedClosure === undefined ? {} : { delegatedClosure: options.delegatedClosure })
  }
}

function fixtureManifest(nodes) {
  const ids = nodes.map(node => node.id)
  return {
    schemaVersion: 'ValidationManifestV1',
    contractVersion: '3',
    description: 'fixture',
    consumerGraphComplete: true,
    narrativeMarkdownExclusions: [...NARRATIVE_MARKDOWN_EXCLUSIONS],
    verificationBoundaries: {
      fixture: {
        inputs: ['fixture/**'],
        nodes: ids,
        enforceForMatchingInputs: false
      }
    },
    nodeVerificationPolicies: {
      defaultConsumerEdgeType: 'runtimeConsumer',
      overrides: {}
    },
    criticalInputs: ['scripts/validation-manifest.json'],
    iterativeEscalationInputs: ['scripts/validation-manifest.json'],
    invariantNodes: [ids[0]],
    iterativeInvariantNodes: [ids[0]],
    routes: {
      fast: { dynamic: true },
      full: { nodes: ids },
      changed: { dynamic: true },
      delivery: { dynamic: true },
      boundary: { dynamic: true },
      'profile-deploy': { nodes: ids },
      'package-release': { nodes: ids }
    },
    nodes
  }
}

function successEvidence(node) {
  return {
    code: 'OK',
    command: node.command,
    args: node.args,
    cwd: ROOT,
    exitCode: 0,
    signal: null,
    durationMs: 1,
    stdout: 'ok',
    stderr: ''
  }
}

function fixtureExecutionLease(plan, candidate) {
  const actorType = plan.verificationPurpose === 'release' ? 'release-pipeline' : 'human-cli'
  return createVerificationExecutionLease({
    actorType,
    authorityClass: plan.verificationPurpose === 'release'
      ? 'release'
      : (plan.verificationLevel === 'V3' ? 'full-audit' : 'scoped'),
    actorIdentityEvidence: { fixtureActor: actorType },
    repoRoot: ROOT,
    plan,
    candidate,
    project: plan.verificationIntent.project,
    taskRecoveryKey: plan.verificationIntent.taskRecoveryKey,
    contextEpoch: plan.verificationIntent.contextEpoch,
    authoritySourceRef: `fixture:${actorType}-attestation`,
    policyDigest: actorType === 'release-pipeline' ? sha256('fixture-release-policy') : null
  })
}

function executeValidationPlan(input) {
  const lease = input.lease || (
    ['blocked', 'awaiting-budget'].includes(input.plan.executionState)
      ? null
      : fixtureExecutionLease(input.plan, input.candidate)
  )
  return executeValidationPlanUnbound({
    ...input,
    lease,
    actorType: lease?.actorType || null
  })
}

function approvedPlan(input) {
  const provisional = planValidation(input)
  return provisional.budgetCard.confirmationRequired
    ? planValidation({ ...input, approvePlanDigest: provisional.budgetCard.digest })
    : provisional
}

function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-validation-dag-'))
  try {
    const manifest = readValidationManifest(MANIFEST_PATH)
    const nodeFailure = validationExecutionError({ failedNode: 'fixture-node', terminalStatus: 'failed' })
    assert.strictEqual(nodeFailure.code, 'VALIDATION_NODE_FAILED')
    const candidateDrift = validationExecutionError({
      failedNode: null,
      terminalStatus: 'blocked',
      terminalReason: { code: 'VALIDATION_CANDIDATE_DRIFT_DURING_EXECUTION' }
    })
    assert.strictEqual(candidateDrift.code, 'VALIDATION_CANDIDATE_DRIFT_DURING_EXECUTION')
    assert.match(candidateDrift.details.nextStep, /fresh exact-candidate plan/)
    assert.ok(manifest.nodes.length >= 56, 'canonical manifest unexpectedly lost validation nodes')
    assert.ok(manifest.criticalInputs.includes('content/**'))
    assert.ok(manifest.criticalInputs.includes('hooks/_runtime/evidence/*.json'))
    assert.ok(!manifest.criticalInputs.includes('content-source/**'))
    assert.deepStrictEqual(manifest.iterativeInvariantNodes, ['validation-dag'])
    assert.ok(manifest.iterativeEscalationInputs.includes('scripts/lib/validation-dag.js'))
    assert.ok(!manifest.iterativeEscalationInputs.includes('content/**'))
    assert.deepStrictEqual(Object.keys(manifest.verificationBoundaries).sort(),
      ['artifact-mutation-control-plane', 'hook-runtime', 'mcp-runtime', 'package', 'profile', 'validation-control-plane', 'workflow-task-authority'])
    const validationAuthorityNode = manifest.nodes.find(node => node.id === 'validation-authority')
    const validationDagNode = manifest.nodes.find(node => node.id === 'validation-dag')
    assert(Number.isInteger(validationAuthorityNode.estimatedDurationMs) && validationAuthorityNode.estimatedDurationMs >= 120000,
      'validation-authority must publish a realistic estimate for BudgetCard cost transparency')
    assert(validationAuthorityNode.timeoutMs >= Math.ceil(validationAuthorityNode.estimatedDurationMs * 1.5),
      'validation-authority timeout must preserve CI variance headroom above its estimate')
    assert.deepStrictEqual(validationDagNode.dependencies, ['checked-command'],
      'clean iterative validation-dag must not unconditionally execute the heavy validation-authority suite')
    assert(validationAuthorityNode.consumers.includes('validation-dag'),
      'validation-authority changes must still propagate to the validation-dag consumer')
    for (const requiredNode of [
      'actual-candidate-evidence',
      'artifact-mutation-authority',
      'dangerous-command-context',
      'session-route-consumers',
      'task-admission-authority'
    ]) {
      assert(manifest.routes.full.nodes.includes(requiredNode), `V3 full route missing current control-plane node: ${requiredNode}`)
    }
    const artifactMutationAuthority = manifest.nodes.find(node => node.id === 'artifact-mutation-authority')
    for (const requiredInput of [
      'hooks/_runtime/artifact-slot-registry.v2.json',
      'hooks/_runtime/host-tool-mutation-adapters.cjs',
      'hooks/_runtime/mutation-observation.cjs',
      'mcp/task-admission-authority.cjs'
    ]) {
      assert(artifactMutationAuthority.inputs.includes(requiredInput), `artifact mutation authority missing V2 input: ${requiredInput}`)
    }
    assert.deepStrictEqual(artifactMutationAuthority.evidenceArtifacts, [
      'ArtifactSlotDecisionV2',
      'TaskOwnedMutationLeaseV2',
      'MutationObservationReceiptV1',
      'ArtifactMutationCloseoutReceiptV2'
    ])
    for (const requiredNode of [
      'workflow-capabilities',
      'session-route-consumers',
      'task-admission-authority',
      'task-recovery',
      'mcp-servers',
      'hooks-runtime'
    ]) {
      assert(
        manifest.verificationBoundaries['workflow-task-authority'].nodes.includes(requiredNode),
        `workflow task authority boundary missing node: ${requiredNode}`
      )
    }
    const mcpRuntimeClosure = manifest.nodes.find(node => node.id === 'mcp-runtime-closure')
    const mcpRuntimePacklist = manifest.nodes.find(node => node.id === 'mcp-runtime-packlist')
    assert.deepStrictEqual(mcpRuntimeClosure.args, ['run', 'test:mcp-runtime-closure'])
    assert.strictEqual(manifest.nodeVerificationPolicies.overrides['mcp-runtime-closure'].minimumLevel, 'V2')
    assert.strictEqual(manifest.nodeVerificationPolicies.overrides['mcp-runtime-closure'].consumerEdgeType, 'qualificationConsumer')
    assert(!mcpRuntimeClosure.consumers.includes('pack-clean'), 'runtime-only closure must not implicitly enter package lifecycle')
    assert(!mcpRuntimeClosure.invariants.includes('package-runtime-closure'))
    assert.deepStrictEqual(mcpRuntimePacklist.args, ['run', 'test:mcp-runtime-closure:package'])
    assert.deepStrictEqual(mcpRuntimePacklist.dependencies, ['mcp-runtime-closure'])
    assert(mcpRuntimePacklist.invariants.includes('explicit-package-qualification-only'))
    assert.strictEqual(manifest.nodeVerificationPolicies.overrides['mcp-runtime-packlist'].consumerEdgeType, 'releaseConsumer')
    assert.strictEqual(manifest.nodeVerificationPolicies.overrides['pack-clean'].consumerEdgeType, 'releaseConsumer')
    assert(!manifest.invariantNodes.includes('pack-clean'), 'real npm pack/install must not be a global changed-route invariant')
    assert(!manifest.verificationBoundaries.package.nodes.includes('pack-clean'), 'automatic package V2 boundary must not run real npm pack/install')
    assert(manifest.routes.full.nodes.includes('mcp-runtime-packlist'))
    assert(!manifest.routes['profile-deploy'].nodes.includes('mcp-runtime-packlist'))
    assert(!manifest.routes['package-release'].nodes.includes('mcp-runtime-packlist'))
    assert.strictEqual(manifest.nodeVerificationPolicies.defaultConsumerEdgeType, 'runtimeConsumer')
    assert.deepStrictEqual(manifest.narrativeMarkdownExclusions, [
      'README.md',
      'public-site/**/*.md',
      'website/**/*.md'
    ])
    assert.strictEqual(normalizeNarrativePath('././README.md'), 'README.md')
    assert.strictEqual(isNarrativeMarkdownPath('public-site/docs/guide.md'), true)
    assert.strictEqual(isNarrativeMarkdownPath('public-site/docs/guide.mdx'), false)
    for (const invalid of ['public-site/../escape.md', 'website//escape.md', 'C:\\repo\\README.md']) {
      assert.throws(() => normalizeNarrativePath(invalid), error => error.code === 'NARRATIVE_MARKDOWN_PATH_INVALID')
      assert.throws(() => buildChangeDescriptors([invalid]), error => error.code === 'VALIDATION_PATH_INVALID')
    }
    assert.deepStrictEqual(manifest.semanticInputs.packageJson.publicMetadataNodes, [
      'public-product-expression',
      'release-metadata'
    ])
    const expectedPortfolioConsumerInputs = ['**/*.md', '**/*.js', '**/*.cjs', '**/*.json', '**/*.ts', '**/*.yml', '**/*.yaml']
    for (const portfolioNodeId of ['skill-portfolio', 'skill-portfolio-current']) {
      const skillPortfolioInputs = manifest.nodes.find(node => node.id === portfolioNodeId).inputs
      assert.ok(skillPortfolioInputs.includes('content/skills/**'))
      assert.ok(skillPortfolioInputs.includes('plugin.json'))
      for (const input of expectedPortfolioConsumerInputs) {
        assert.ok(skillPortfolioInputs.includes(input), `${portfolioNodeId} must track ${input}`)
      }
    }
    const canonicalControlInputs = {
      'git-execution-context': [
        'content/skills/execution-contract/SKILL.md',
        'content/skills/execution-contract/git-execution-context.v1.schema.json',
        'content/instructions/01-common.instructions.md'
      ],
      'evolution-target-decision': [
        'content/skills/evolution-governance/SKILL.md',
        'content/skills/evolution-governance/evolution-target-decision.v1.schema.json'
      ],
      'workspace-provisioning': [
        'content/skills/evolution-governance/SKILL.md',
        'content/skills/evolution-governance/workspace-provisioning-receipt.v1.schema.json'
      ],
      'worktree-lifecycle': [
        'scripts/lib/cli-worktree-diagnostics.js',
        'content/skills/execution-contract/SKILL.md',
        'content/skills/execution-contract/worktree-lifecycle-receipt.v1.schema.json',
        'content/skills/execution-contract/worktree-diagnostics.v1.schema.json'
      ]
    }
    for (const [nodeId, requiredInputs] of Object.entries(canonicalControlInputs)) {
      const nodeInputs = manifest.nodes.find(node => node.id === nodeId).inputs
      for (const input of requiredInputs) {
        assert.ok(nodeInputs.includes(input), `${nodeId} must track canonical source ${input}`)
        const changedPlan = planValidation({
          manifest,
          route: 'changed',
          changedFiles: [input],
          changedSource: 'explicit',
          candidateStable: true,
          candidateId: `fixture-canonical-${nodeId}`
        })
        assert.ok(
          changedPlan.selectedNodes.some(node => node.id === nodeId),
          `${nodeId} must be selected when canonical input ${input} changes`
        )
      }
    }
    assert.deepStrictEqual(
      [...manifest.routes['profile-deploy'].nodes].sort(),
      [...manifest.verificationBoundaries.profile.nodes].sort(),
      'profile-deploy must stay scoped to the profile V2 boundary'
    )
    assert.deepStrictEqual(
      [...manifest.routes['package-release'].nodes].sort(),
      [...manifest.verificationBoundaries.package.nodes, 'pack-clean'].sort(),
      'explicit package-release must add real pack/install to the automatic package contract boundary'
    )
    const fullRouteNodes = new Set(manifest.routes.full.nodes)
    for (const required of [
      'cli-behavior',
      'task-continuation',
      'context-read',
      'context-binding',
      'context-read-controls',
      'hooks-runtime',
      'mcp-servers',
      'memory-index',
      'report-index',
      'profile-governance',
      'skill-route-contracts',
      'skill-route-state',
      'skill-route-lifecycle',
      'skill-route-closure'
    ]) {
      assert(fullRouteNodes.has(required), `V3 full route missing F1-F14 gate: ${required}`)
    }
    const reportIndexNode = manifest.nodes.find(node => node.id === 'report-index')
    assert.strictEqual(reportIndexNode.owner, 'report-maintenance-preview')
    assert.deepStrictEqual(reportIndexNode.consumers, [])
    assert(reportIndexNode.invariants.includes('maintenance-preview-only'))
    const controlContentNode = manifest.nodes.find(node => node.id === 'control-content-source')
    assert.ok(controlContentNode, 'control-content-source node missing')
    assert.ok(controlContentNode.inputs.includes('content/**'))
    assert.ok(!controlContentNode.inputs.includes('content-source/**'))
    let fallbackInvocations = 0
    const fallbackErrors = []
    const standaloneOrchestration = createValidationOrchestration({
      root: ROOT,
      reportError: message => fallbackErrors.push(message),
      env: {},
      runCommand: () => { fallbackInvocations += 1 },
      logger: { log: () => {} }
    })
    standaloneOrchestration.runInstructionFallbackProbe()
    assert.strictEqual(fallbackInvocations, 1)
    assert.strictEqual(fallbackErrors.length, 0)
    const delegatedOrchestration = createValidationOrchestration({
      root: ROOT,
      reportError: message => fallbackErrors.push(message),
      env: {
        DEVCODEX_VALIDATION_ORCHESTRATED: '1',
        DEVCODEX_VALIDATION_DELEGATED_NODES: 'hooks-runtime,instruction-fallback'
      },
      runCommand: () => { fallbackInvocations += 1 },
      logger: { log: () => {} }
    })
    delegatedOrchestration.runInstructionFallbackProbe()
    assert.strictEqual(fallbackInvocations, 1)
    assert.strictEqual(delegatedOrchestration.isDelegated('hooks-runtime'), true)
    assert.deepStrictEqual(Object.keys(manifest.routes).sort(),
      ['boundary', 'changed', 'delivery', 'fast', 'full', 'package-release', 'profile-deploy'])
    assert.strictEqual(parseArgs(['--intent', 'boundary']).purpose, 'boundary')
    assert.strictEqual(parseArgs(['--intent=release']).purpose, 'release')
    assert.strictEqual(parseArgs(['--purpose', 'delivery']).purpose, 'delivery')
    const aiEnv = {
      CODEX_THREAD_ID: 'fixture-thread',
      GITHUB_ACTIONS: 'true',
      GITHUB_REF_TYPE: 'tag',
      DEVCODEX_VALIDATION_ACTOR: 'human-cli'
    }
    assert.strictEqual(detectedActorType(aiEnv), 'ai-hook', 'AI host identity must outrank caller-controlled actor hints')
    assert.strictEqual(resolveActorType(null, aiEnv), 'ai-hook')
    assert.throws(
      () => resolveActorType('release-pipeline', aiEnv),
      error => error instanceof ValidationDagError && error.code === 'VALIDATION_ACTOR_SPOOF_REJECTED'
    )
    const aiAuthority = resolveValidationAuthorityContext({
      actorType: 'ai-hook',
      options: { contextEpoch: 'ctx-fixture-current' },
      activeRoot: tempRoot,
      env: { CODEX_THREAD_ID: 'fixture-thread' },
      readTaskState: () => ({
        status: 'fresh',
        identity: {
          activeRoot: tempRoot,
          project: 'devcodex',
          taskId: '00000000-0000-4000-8000-000000000344',
          taskStatus: 'active'
        }
      })
    })
    assert.strictEqual(aiAuthority.taskRecoveryKey, '00000000-0000-4000-8000-000000000344')
    assert.strictEqual(aiAuthority.sessionKey, 'fixture-thread')
    assert.strictEqual(aiAuthority.contextEpoch, 'ctx-fixture-current')
    assert.match(aiAuthority.authoritySourceRef, /^ai-hook:codex:fixture-thread:task:/)
    assert.throws(() => resolveValidationAuthorityContext({
      actorType: 'ai-hook',
      options: {},
      activeRoot: tempRoot,
      env: { CODEX_THREAD_ID: 'fixture-thread' },
      readTaskState: () => ({ status: 'fresh', identity: { taskId: aiAuthority.taskRecoveryKey } })
    }), error => error instanceof ValidationDagError && error.code === 'VALIDATION_AI_CONTEXT_EPOCH_REQUIRED')
    assert.throws(() => resolveValidationAuthorityContext({
      actorType: 'ai-hook',
      options: { contextEpoch: 'ctx-fixture-current', taskRecoveryKey: 'different-task' },
      activeRoot: tempRoot,
      env: { CODEX_THREAD_ID: 'fixture-thread' },
      readTaskState: () => ({ status: 'fresh', identity: { taskId: aiAuthority.taskRecoveryKey } })
    }), error => error instanceof ValidationDagError && error.code === 'VALIDATION_AI_TASK_BINDING_MISMATCH')
    const ciEnv = {
      GITHUB_ACTIONS: 'true',
      GITHUB_REF_TYPE: 'branch',
      GITHUB_WORKFLOW: 'CI',
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REPOSITORY: 'devcodex-labs/devcodex',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: 'a'.repeat(40)
    }
    assert.strictEqual(detectedActorType(ciEnv), 'trusted-ci')
    assert.match(expectedCiPolicyDigest('trusted-ci', { verificationLevel: 'V3' }, ciEnv), /^[a-f0-9]{64}$/)
    assert.ok(cacheRelativePath('fixture').includes(path.join('validation-evidence', 'v2')))
    const fullPlan = planValidation({
      manifest,
      route: 'full',
      changedFiles: [],
      changedSource: 'git-clean',
      riskClass: 'normal',
      candidateStable: true,
      candidateId: 'fixture-full'
    })
    assert.strictEqual(fullPlan.selectedNodeCount, manifest.routes.full.nodes.length)
    assert.strictEqual(fullPlan.schemaVersion, 'ValidationPlanV3')
    assert.strictEqual(fullPlan.verificationLevel, 'V3')
    assert.strictEqual(fullPlan.verificationPurpose, 'full-audit')
    assert.strictEqual(fullPlan.executionState, 'awaiting-budget')
    assert.strictEqual(fullPlan.budgetCard.confirmationRequired, true)
    assert.strictEqual(fullPlan.fullFallback, null)
    assert.strictEqual(toValidationPlanV1(fullPlan).schemaVersion, 'ValidationPlanV1')
    assert.strictEqual(toValidationPlanV1(fullPlan).impactGraph.schemaVersion, 'ValidationImpactGraphV1')
    assert.strictEqual(fullPlan.validationLayer, 'qualification')
    assert.strictEqual(fullPlan.budget.selectionRatio, 1)
    assert.strictEqual(fullPlan.duplicateLeafCount, 0)
    assert.strictEqual(fullPlan.requiredNodeMisses, 0)
    assert.match(fullPlan.manifestIdentity.digest, /^[a-f0-9]{64}$/)
    assert.match(fullPlan.impactGraphDigest, /^[a-f0-9]{64}$/)
    assert.match(fullPlan.planDigest, /^[a-f0-9]{64}$/)
    assert.strictEqual(new Set(manifest.nodes.map(commandSignature)).size, manifest.nodes.length)
    const profileDeployPlan = planValidation({
      manifest,
      route: 'profile-deploy',
      changedFiles: [],
      changedSource: 'explicit',
      riskClass: 'high',
      candidateStable: true,
      candidateId: 'fixture-profile-deploy'
    })
    const profileDeployIds = profileDeployPlan.selectedNodes.map(node => node.id)
    assert.ok(!profileDeployIds.includes('validate-core'), 'profile-deploy must not execute the source/full validator twice')
    assert.ok(!profileDeployIds.includes('validate-workspace'), 'profile V2 must not reuse the full workspace validator')
    assert.ok(profileDeployIds.includes('profile-governance'))
    assert.ok(profileDeployIds.includes('validation-dag'))
    assert.strictEqual(profileDeployPlan.verificationLevel, 'V2')
    assert.ok(profileDeployPlan.selectedNodeCount < fullPlan.selectedNodeCount)
    assert.strictEqual(
      profileDeployPlan.selectedNodes.filter(node => node.command === 'node' && node.args.join(' ') === 'scripts/validate.js').length,
      0,
      'profile V2 must not contain the V3 workspace validation command'
    )
    const packageBoundaryPlan = planValidation({
      manifest,
      route: 'package-release',
      changedFiles: [],
      changedSource: 'explicit',
      riskClass: 'normal',
      candidateStable: true,
      candidateId: 'fixture-package-boundary'
    })
    const packageBoundaryIds = packageBoundaryPlan.selectedNodes.map(node => node.id)
    assert.strictEqual(packageBoundaryPlan.verificationLevel, 'V2')
    assert.ok(packageBoundaryIds.includes('pack-clean'))
    assert.ok(packageBoundaryIds.includes('published-package-scripts-contract'))
    assert.ok(!packageBoundaryIds.includes('global-install-smoke'))
    assert.ok(!packageBoundaryIds.includes('critical-coverage'))
    assert.ok(packageBoundaryPlan.selectedNodeCount < fullPlan.selectedNodeCount)
    const changedManifestV2Plan = planValidation({
      manifest,
      route: 'changed',
      changedFiles: ['scripts/validation-manifest.json'],
      changedSource: 'explicit',
      level: 'V2',
      candidateStable: true,
      candidateId: 'fixture-changed-manifest-v2'
    })
    const changedManifestV2Ids = changedManifestV2Plan.selectedNodes.map(node => node.id)
    assert.ok(!changedManifestV2Ids.includes('pack-clean'), 'changed V2 must not enter npm pack/install qualification')
    assert.ok(!changedManifestV2Ids.includes('mcp-runtime-packlist'), 'changed V2 must not enter npm packlist qualification')
    assert.ok(!changedManifestV2Ids.includes('global-install-smoke'), 'changed V2 must not enter global installation')
    assert.ok(!changedManifestV2Ids.includes('host-installation'), 'changed V2 must not enter host installation')
    assert.throws(() => planValidation({
      manifest,
      route: 'profile-deploy',
      affectedBoundaries: ['hook-runtime'],
      changedFiles: [],
      changedSource: 'explicit',
      candidateStable: true,
      candidateId: 'fixture-profile-boundary-conflict'
    }), error => error instanceof ValidationDagError && error.code === 'VALIDATION_BOUNDARY_ROUTE_CONFLICT')

    const impactFixture = fixtureManifest([
      fixtureNode('impact-source', { inputs: ['src/**'], consumers: ['impact-consumer'] }),
      fixtureNode('impact-consumer', { inputs: ['consumer/**'], dependencies: ['impact-source'] })
    ])
    const impactGraph = buildValidationImpactGraph({ manifest: impactFixture, changedFiles: ['src/a.js'] })
    assert.deepStrictEqual(impactGraph.matchedNodeIds, ['impact-source'])
    assert.deepStrictEqual(impactGraph.affectedNodeIds, ['impact-source', 'impact-consumer'])
    assert.strictEqual(impactGraph.complete, true)
    assert.strictEqual(impactGraph.schemaVersion, 'ValidationImpactGraphV2')
    assert.deepStrictEqual(impactGraph.typedConsumerEdges,
      [{ source: 'impact-source', target: 'impact-consumer', type: 'runtimeConsumer' }])
    assert.strictEqual(buildValidationImpactGraph({ manifest: impactFixture, changedFiles: ['unknown/a.js'] }).complete, false)

    const typedImpactFixture = fixtureManifest([
      fixtureNode('typed-source', { inputs: ['typed/**'], consumers: ['typed-qualification'] }),
      fixtureNode('typed-qualification', { inputs: ['qualification/**'], consumers: ['typed-release'] }),
      fixtureNode('typed-release', { inputs: ['release/**'] })
    ])
    typedImpactFixture.nodeVerificationPolicies.overrides = {
      'typed-qualification': { consumerEdgeType: 'qualificationConsumer' },
      'typed-release': { consumerEdgeType: 'releaseConsumer' }
    }
    const typedV1 = buildValidationImpactGraph({
      manifest: typedImpactFixture,
      changedFiles: ['typed/a.js'],
      verificationLevel: 'V1'
    })
    assert.deepStrictEqual(typedV1.affectedNodeIds, ['typed-source'])
    const typedV2 = buildValidationImpactGraph({
      manifest: typedImpactFixture,
      changedFiles: ['typed/a.js'],
      verificationLevel: 'V2'
    })
    assert.deepStrictEqual(typedV2.affectedNodeIds, ['typed-source', 'typed-qualification'])
    assert(typedV2.typedConsumerEdges.some(edge => edge.type === 'qualificationConsumer'))
    assert(!typedV2.affectedNodeIds.includes('typed-release'))

    const duplicateId = clone(manifest)
    duplicateId.nodes.push(clone(duplicateId.nodes[0]))
    assert.throws(() => validateValidationManifest(duplicateId),
      error => error instanceof ValidationDagError && /duplicate node id/.test(error.message))

    const duplicateCommand = clone(manifest)
    const copied = clone(duplicateCommand.nodes[0])
    copied.id = 'duplicate-command-fixture'
    duplicateCommand.nodes.push(copied)
    assert.throws(() => validateValidationManifest(duplicateCommand),
      error => error instanceof ValidationDagError && /duplicate leaf command/.test(error.message))

    const unknownConsumer = clone(manifest)
    unknownConsumer.nodes[0].consumers.push('missing-consumer')
    assert.throws(() => validateValidationManifest(unknownConsumer),
      error => error instanceof ValidationDagError && /unknown consumer/.test(error.message))

    const v3NodeInBoundary = clone(manifest)
    v3NodeInBoundary.verificationBoundaries.profile.nodes.push('global-install-smoke')
    assert.throws(() => validateValidationManifest(v3NodeInBoundary),
      error => error instanceof ValidationDagError && /contains V3-only node/.test(error.message))

    const v3NodeInScopedRoute = clone(manifest)
    v3NodeInScopedRoute.routes['profile-deploy'].nodes.push('global-install-smoke')
    assert.throws(() => validateValidationManifest(v3NodeInScopedRoute),
      error => error instanceof ValidationDagError && /contains V3-only node/.test(error.message))

    const missingGraphStatus = clone(manifest)
    delete missingGraphStatus.consumerGraphComplete
    assert.throws(() => validateValidationManifest(missingGraphStatus),
      error => error instanceof ValidationDagError && /consumerGraphComplete/.test(error.message))

    const invalidNarrativePolicy = clone(manifest)
    invalidNarrativePolicy.narrativeMarkdownExclusions.push('docs/**/*.md')
    assert.throws(() => validateValidationManifest(invalidNarrativePolicy),
      error => error instanceof ValidationDagError && /NarrativeMarkdownPolicyV1/.test(error.message))

    const invalidDelegatedClosure = clone(manifest)
    invalidDelegatedClosure.nodes.find(node => node.id === 'validate-core').delegatedClosure[0].nodeId = 'Missing_Node'
    assert.throws(() => validateValidationManifest(invalidDelegatedClosure),
      error => error instanceof ValidationDagError && /delegatedClosure.entry/.test(error.message))

    const invalidDurationEstimate = fixtureManifest([
      fixtureNode('invalid-duration-estimate', { timeoutMs: 5000, estimatedDurationMs: 6000 })
    ])
    assert.throws(() => validateValidationManifest(invalidDurationEstimate),
      error => error instanceof ValidationDagError && /estimatedDurationMs/.test(error.message))

    const invalidCoveredNode = clone(manifest)
    invalidCoveredNode.nodes.find(node => node.id === 'validate-workspace').coversNodes = ['missing-node']
    assert.throws(() => validateValidationManifest(invalidCoveredNode),
      error => error instanceof ValidationDagError && /covers unknown node/.test(error.message))

    const mismatchedCoveredNode = clone(manifest)
    mismatchedCoveredNode.nodes.find(node => node.id === 'validate-workspace').args = ['scripts/other-validator.js']
    assert.throws(() => validateValidationManifest(mismatchedCoveredNode),
      error => error instanceof ValidationDagError && /covers node with a different command/.test(error.message))

    const missingCoveredEnvironment = clone(manifest)
    delete missingCoveredEnvironment.nodes.find(node => node.id === 'validate-workspace').environment.DEVCODEX_VALIDATION_SCOPE
    assert.throws(() => validateValidationManifest(missingCoveredEnvironment),
      error => error instanceof ValidationDagError && /preserve covered environment/.test(error.message))

    const missingCoveredDelegation = clone(manifest)
    missingCoveredDelegation.nodes.find(node => node.id === 'validate-workspace').delegatedClosure.pop()
    assert.throws(() => validateValidationManifest(missingCoveredDelegation),
      error => error instanceof ValidationDagError && /preserve delegated closure/.test(error.message))

    // PF-148 nested closure integrity: missing script path and mismatched top-level leaf command
    const missingDelegatedScript = clone(manifest)
    missingDelegatedScript.nodes.find(node => node.id === 'validate-core').delegatedClosure[0].command =
      'node scripts/__missing_nested_probe_for_pf148__.js'
    assert.throws(
      () => validateValidationManifest(missingDelegatedScript, { repoRoot: ROOT }),
      error => error instanceof ValidationDagError && /delegatedClosure command missing/.test(error.message)
    )
    const mismatchedDelegatedLeaf = clone(manifest)
    mismatchedDelegatedLeaf.nodes.find(node => node.id === 'validate-core').delegatedClosure[0].command =
      'node scripts/test-mcp-servers.js'
    assert.throws(
      () => validateValidationManifest(mismatchedDelegatedLeaf, { repoRoot: ROOT }),
      error => error instanceof ValidationDagError && /command mismatches top-level leaf/.test(error.message)
    )
    // positive: real manifest still validates with repoRoot
    assert.doesNotThrow(() => validateValidationManifest(manifest, { repoRoot: ROOT }))

    // PF-148 slice-2: delegated nodeId must exist as top-level node
    const missingDelegatedNodeId = clone(manifest)
    missingDelegatedNodeId.nodes.find(node => node.id === 'validate-core').delegatedClosure[0].nodeId =
      'missing-nested-leaf-node'
    assert.throws(
      () => validateValidationManifest(missingDelegatedNodeId, { repoRoot: ROOT }),
      error => error instanceof ValidationDagError && /delegatedClosure nodeId missing/.test(error.message)
    )

    // Nested graph + lock-aware schedule pure helpers
    const nestedGraph = buildNestedCommandGraph(manifest)
    assert.ok(nestedGraph.edgeCount >= 2)
    assert.match(nestedGraph.digest, /^[a-f0-9]{64}$/)
    const schedule = planLockAwareSchedule([
      { id: 'a', dependencies: [], writeScopes: ['scope-x'] },
      { id: 'b', dependencies: [], writeScopes: ['scope-x'] },
      { id: 'c', dependencies: [], writeScopes: [] }
    ])
    assert.ok(schedule.waveCount >= 2)
    assert.ok(schedule.waves.some(wave => wave.includes('a')))
    assert.ok(schedule.waves.some(wave => wave.includes('b')))
    // conflicting scopes must not share a wave
    for (const wave of schedule.waves) {
      assert.ok(!(wave.includes('a') && wave.includes('b')))
    }
    const byId = new Map(manifest.nodes.map(node => [node.id, node]))
    const expanded = expandSelectedWithNestedLeaves(new Set(['validate-core']), byId)
    assert.ok(expanded.has('hooks-runtime'))
    assert.ok(expanded.has('mcp-servers'))

    const cycle = clone(manifest)
    cycle.nodes.find(node => node.id === 'validate-core').consumers.push('validate-versions')
    assert.throws(() => validateValidationManifest(cycle),
      error => error instanceof ValidationDagError && /cycle/.test(error.message))

    const contextChanged = planValidation({
      manifest,
      route: 'changed',
      changedFiles: ['hooks/_runtime/content-identity.cjs'],
      changedSource: 'explicit',
      riskClass: 'normal',
      candidateStable: true,
      candidateId: 'fixture-context'
    })
    assert.strictEqual(contextChanged.routeResolved, 'boundary')
    assert.strictEqual(contextChanged.verificationLevel, 'V2')
    assert.strictEqual(contextChanged.validationLayer, 'boundary')
    assert.strictEqual(contextChanged.fullFallback, null)
    assert(contextChanged.affectedBoundaries.includes('hook-runtime'))
    assert.notStrictEqual(contextChanged.selectedNodeCount, contextChanged.fullNodeCount)

    const profileSelectorChanged = planValidation({
      manifest,
      route: 'changed',
      changedFiles: ['mcp/profile-section-selector.cjs'],
      changedSource: 'explicit',
      riskClass: 'normal',
      candidateStable: true,
      candidateId: 'fixture-profile-selector'
    })
    for (const required of ['profile-section-selector', 'context-read-controls', 'mcp-servers']) {
      assert(profileSelectorChanged.selectedNodes.some(node => node.id === required), 'Profile selector closure missing ' + required)
    }

    const capabilityEvidenceChanged = planValidation({
      manifest,
      route: 'changed',
      changedFiles: ['hooks/_runtime/evidence/codex-skill-route-pass.v1.json'],
      changedSource: 'explicit',
      riskClass: 'high',
      candidateStable: true,
      candidateId: 'fixture-capability-evidence'
    })
    for (const required of ['skill-route-contracts', 'skill-route-lifecycle', 'skill-route-closure']) {
      assert(
        capabilityEvidenceChanged.selectedNodes.some(node => node.id === required),
        `portable capability evidence closure missing ${required}`
      )
    }

    const memoryServerChanged = planValidation({
      manifest,
      route: 'changed',
      changedFiles: ['mcp/memory-server.js'],
      changedSource: 'explicit',
      riskClass: 'high',
      candidateStable: true,
      candidateId: 'fixture-memory-trust-state'
    })
    for (const required of ['memory-index', 'mcp-servers', 'context-read']) {
      assert(
        memoryServerChanged.selectedNodes.some(node => node.id === required),
        `memory trust/coverage closure missing ${required}`
      )
    }

    const attemptChanged = planValidation({
      manifest,
      route: 'changed',
      changedFiles: ['scripts/test-execution-attempt-ledger.js'],
      changedSource: 'explicit',
      riskClass: 'normal',
      candidateStable: true,
      candidateId: 'fixture-attempt-ledger'
    })
    for (const required of ['turn-liveness', 'execution-attempt-ledger', 'turn-liveness-controls']) {
      assert(attemptChanged.selectedNodes.some(node => node.id === required), 'Attempt ledger closure missing ' + required)
    }

    const unknown = planValidation({
      manifest,
      route: 'changed',
      changedFiles: ['unknown/location.fixture'],
      changedSource: 'explicit',
      riskClass: 'normal',
      candidateStable: true,
      candidateId: 'fixture-unknown'
    })
    assert.strictEqual(unknown.routeResolved, 'changed')
    assert.strictEqual(unknown.executionState, 'blocked')
    assert(unknown.executionBlockers.some(item => item.code === 'VALIDATION_UNKNOWN_INPUT'))
    assert.strictEqual(unknown.fullFallback, null)

    const releaseOnlyManifest = fixtureManifest([
      fixtureNode('fixture-invariant', { inputs: ['base/**'] }),
      fixtureNode('release-only', { inputs: ['release-only/**'] })
    ])
    releaseOnlyManifest.nodeVerificationPolicies.overrides['release-only'] = {
      consumerEdgeType: 'releaseConsumer'
    }
    releaseOnlyManifest.verificationBoundaries.fixture.nodes = ['fixture-invariant']
    releaseOnlyManifest.routes['profile-deploy'].nodes = ['fixture-invariant']
    releaseOnlyManifest.routes['package-release'].nodes = ['fixture-invariant']
    const releaseOnlyInput = planValidation({
      manifest: releaseOnlyManifest,
      route: 'changed',
      changedFiles: ['release-only/candidate.json'],
      changedSource: 'explicit',
      riskClass: 'normal',
      candidateStable: true,
      candidateId: 'fixture-release-only-input'
    })
    assert.strictEqual(releaseOnlyInput.verificationLevel, 'V1')
    assert.strictEqual(releaseOnlyInput.executionState, 'blocked')
    assert(releaseOnlyInput.executionBlockers.some(item => item.code === 'VALIDATION_UNKNOWN_INPUT'))
    assert.deepStrictEqual(releaseOnlyInput.impactGraph.unknownInputs, ['release-only/candidate.json'])

    const unresolvedBoundaryManifest = fixtureManifest([
      fixtureNode('unresolved-boundary-owner', { inputs: ['outside-boundary/**'] })
    ])
    const unresolvedBoundary = planValidation({
      manifest: unresolvedBoundaryManifest,
      route: 'boundary',
      changedFiles: ['outside-boundary/input.js'],
      changedSource: 'explicit',
      candidateStable: true,
      candidateId: 'fixture-unresolved-boundary'
    })
    assert.strictEqual(unresolvedBoundary.executionState, 'blocked')
    assert(unresolvedBoundary.executionBlockers.some(item => item.code === 'VALIDATION_BOUNDARY_REQUIRED'))

    const critical = planValidation({
      manifest,
      route: 'changed',
      changedFiles: ['package.json'],
      changedSource: 'explicit',
      riskClass: 'normal',
      candidateStable: true,
      candidateId: 'fixture-critical'
    })
    assert.strictEqual(critical.routeResolved, 'boundary')
    assert.strictEqual(critical.verificationLevel, 'V2')
    assert(critical.affectedBoundaries.includes('package'))
    assert.strictEqual(critical.fullFallback, null)

    const publicMetadata = planValidation({
      manifest,
      route: 'changed',
      changedFiles: ['package.json'],
      changeDescriptors: [{ path: 'package.json', fields: ['description', 'keywords'] }],
      changedSource: 'explicit',
      riskClass: 'normal',
      candidateStable: true,
      candidateId: 'fixture-public-metadata'
    })
    assert.strictEqual(publicMetadata.routeResolved, 'changed')
    assert.strictEqual(publicMetadata.validationLayer, 'iterative')
    assert.deepStrictEqual(publicMetadata.changeDescriptors[0].fields, ['description', 'keywords'])
    for (const required of ['public-product-expression', 'release-metadata', 'validation-dag']) {
      assert(publicMetadata.selectedNodes.some(node => node.id === required), `public metadata closure missing ${required}`)
    }
    assert.ok(publicMetadata.budget.selectionRatio < 0.8)
    assert.ok(Object.values(publicMetadata.selectionReasons).every(reasons => reasons.length > 0))

    const packageControl = planValidation({
      manifest,
      route: 'changed',
      changedFiles: ['package.json'],
      changeDescriptors: [{ path: 'package.json', fields: ['version'] }],
      changedSource: 'explicit',
      riskClass: 'normal',
      candidateStable: true,
      candidateId: 'fixture-package-control'
    })
    assert.strictEqual(packageControl.routeResolved, 'boundary')
    assert.strictEqual(packageControl.verificationLevel, 'V2')
    assert(packageControl.affectedBoundaries.includes('package'))
    assert.strictEqual(packageControl.changeDescriptors[0].semanticClass, 'package-control')

    const highRisk = planValidation({
      manifest,
      route: 'changed',
      changedFiles: ['README.md'],
      changedSource: 'explicit',
      riskClass: 'high',
      candidateStable: true,
      candidateId: 'fixture-high'
    })
    assert.strictEqual(highRisk.routeResolved, 'changed')
    assert.strictEqual(highRisk.verificationLevel, 'V1')
    assert.strictEqual(highRisk.executionState, 'ready')
    assert.strictEqual(highRisk.selectedNodeCount, 0)
    assert.strictEqual(highRisk.javascriptCommandCount, 0)
    assert.strictEqual(highRisk.validationDisposition, 'recognized-no-javascript-inputs')
    assert.deepStrictEqual(highRisk.recognizedNoJsInputs, ['README.md'])
    assert.deepStrictEqual(highRisk.executableChangedFiles, [])
    assert.deepStrictEqual(highRisk.executionBlockers, [])
    assert.strictEqual(highRisk.fullFallback, null)

    const unstable = planValidation({
      manifest,
      route: 'changed',
      changedFiles: [],
      changedSource: 'unknown',
      riskClass: 'normal',
      candidateStable: false,
      candidateId: 'fixture-unstable'
    })
    assert.strictEqual(unstable.routeResolved, 'changed')
    assert.strictEqual(unstable.executionState, 'blocked')
    assert(unstable.executionBlockers.some(item => item.code === 'VALIDATION_CANDIDATE_IDENTITY_UNSTABLE'))
    assert.strictEqual(unstable.fullFallback, null)

    const incompleteGraphManifest = clone(manifest)
    incompleteGraphManifest.consumerGraphComplete = false
    const incompleteGraph = planValidation({
      manifest: incompleteGraphManifest,
      route: 'changed',
      changedFiles: ['README.md'],
      changedSource: 'explicit',
      riskClass: 'normal',
      candidateStable: true,
      candidateId: 'fixture-incomplete-graph'
    })
    assert.strictEqual(incompleteGraph.routeResolved, 'changed')
    assert.strictEqual(incompleteGraph.executionState, 'ready')
    assert.strictEqual(incompleteGraph.selectedNodeCount, 0)
    assert.strictEqual(incompleteGraph.javascriptCommandCount, 0)
    assert.deepStrictEqual(incompleteGraph.executionBlockers, [])
    assert.strictEqual(incompleteGraph.fullFallback, null)

    const incompleteExecutableGraph = planValidation({
      manifest: incompleteGraphManifest,
      route: 'changed',
      changedFiles: ['scripts/test-client-contracts.js'],
      changedSource: 'explicit',
      riskClass: 'normal',
      candidateStable: true,
      candidateId: 'fixture-incomplete-executable-graph'
    })
    assert.strictEqual(incompleteExecutableGraph.executionState, 'blocked')
    assert(incompleteExecutableGraph.executionBlockers.some(item => item.code === 'VALIDATION_CONSUMER_GRAPH_INCOMPLETE'))

    const docsOnlyPaths = ['README.md', 'public-site/docs/guide.md', 'website/docs/guide.md']
    const docsOnly = planValidation({
      manifest,
      route: 'delivery',
      changedFiles: docsOnlyPaths,
      changedSource: 'explicit',
      riskClass: 'normal',
      candidateStable: true,
      candidateId: 'fixture-docs-only'
    })
    assert.strictEqual(docsOnly.executionState, 'ready')
    assert.strictEqual(docsOnly.routeResolved, 'delivery')
    assert.strictEqual(docsOnly.selectedNodeCount, 0)
    assert.strictEqual(docsOnly.javascriptCommandCount, 0)
    assert.deepStrictEqual(docsOnly.recognizedNoJsInputs, [...docsOnlyPaths].sort())
    assert.deepStrictEqual(docsOnly.impactGraph.unknownInputs, [])
    assert.deepStrictEqual(docsOnly.impactGraph.invariantNodeIds, [])

    const mixedNarrativeAndSource = planValidation({
      manifest,
      route: 'changed',
      changedFiles: ['README.md', 'scripts/test-client-contracts.js'],
      changedSource: 'explicit',
      riskClass: 'normal',
      candidateStable: true,
      candidateId: 'fixture-mixed-narrative-source'
    })
    assert.strictEqual(mixedNarrativeAndSource.validationDisposition, 'mixed-inputs')
    assert.deepStrictEqual(mixedNarrativeAndSource.recognizedNoJsInputs, ['README.md'])
    assert.deepStrictEqual(mixedNarrativeAndSource.executableChangedFiles, ['scripts/test-client-contracts.js'])
    assert(mixedNarrativeAndSource.selectedNodeCount > 0)

    const executableMarkdownDescriptors = buildChangeDescriptors([
      'public-site/docs/skills.mdx',
      'content/skills/test-router/SKILL.md',
      '.devcodex/Profile/04-测试规范.md'
    ])
    assert(executableMarkdownDescriptors.every(item => item.kind !== 'narrative-markdown-no-js'))

    const wideNodes = Array.from({ length: 5 }, (_, index) => fixtureNode('wide-' + index, {
      inputs: index === 0 ? ['src/**'] : ['other-' + index + '/**'],
      consumers: index === 0 ? ['wide-1', 'wide-2', 'wide-3', 'wide-4'] : []
    }))
    const wideManifest = fixtureManifest(wideNodes)
    const wide = planValidation({
      manifest: wideManifest,
      route: 'changed',
      changedFiles: ['src/index.js'],
      changedSource: 'explicit',
      riskClass: 'normal',
      candidateStable: true,
      candidateId: 'fixture-wide'
    })
    assert.strictEqual(wide.routeResolved, 'changed')
    assert.strictEqual(wide.verificationLevel, 'V1')
    assert.strictEqual(wide.fullFallback, null)
    assert.strictEqual(wide.selectedNodeCount, wide.fullNodeCount)

    const clean = planValidation({
      manifest,
      route: 'changed',
      changedFiles: [],
      changedSource: 'git-clean',
      riskClass: 'normal',
      candidateStable: true,
      candidateId: 'fixture-clean'
    })
    assert.strictEqual(clean.routeResolved, 'changed')
    assert.strictEqual(clean.validationLayer, 'iterative')
    for (const invariant of manifest.iterativeInvariantNodes) {
      assert(clean.selectedNodes.some(node => node.id === invariant))
    }
    for (const invariant of manifest.invariantNodes.filter(id => !manifest.iterativeInvariantNodes.includes(id))) {
      assert(!clean.selectedNodes.some(node => node.id === invariant), `qualification invariant leaked into clean changed plan: ${invariant}`)
    }
    assert.deepStrictEqual(clean.delegatedParentIds, clean.nestedParentIds)
    assert.ok(clean.budget.estimatedDurationMs < clean.budget.hardTimeoutUpperBoundMs)
    assert.strictEqual(clean.budget.estimateConfidence, 'low')
    assert.strictEqual(clean.budget.logBudgetBytes, clean.selectedNodeCount * 8000)

    const heavyManifest = fixtureManifest([
      fixtureNode('heavy-boundary', { timeoutMs: 700000, estimatedDurationMs: 120000, inputs: ['heavy/**'] })
    ])
    const awaitingBudget = planValidation({
      manifest: heavyManifest,
      route: 'boundary',
      affectedBoundaries: ['fixture'],
      changedFiles: ['heavy/a.js'],
      changedSource: 'explicit',
      riskClass: 'high',
      candidateStable: true,
      candidateId: 'fixture-heavy'
    })
    assert.strictEqual(awaitingBudget.verificationLevel, 'V2')
    assert.strictEqual(awaitingBudget.executionState, 'awaiting-budget')
    assert.strictEqual(awaitingBudget.budgetCard.schemaVersion, 'BudgetCardV1')
    assert.strictEqual(awaitingBudget.budgetCard.confirmationRequired, true)
    assert.strictEqual(awaitingBudget.budgetCard.estimatedDurationMs, 120000)
    assert.strictEqual(awaitingBudget.budgetCard.hardTimeoutUpperBoundMs, 700000)
    assert.strictEqual(awaitingBudget.budgetCard.estimateConfidence, 'high')
    assert.deepStrictEqual(awaitingBudget.budgetCard.waitReasons, ['heavy-node-selected'])
    assert.match(awaitingBudget.budgetCard.digest, /^[a-f0-9]{64}$/)
    assert.throws(() => executeValidationPlan({
      manifest: heavyManifest,
      plan: awaitingBudget,
      candidate: { candidateId: 'fixture-heavy', stable: true, changedFiles: ['heavy/a.js'], changedSource: 'explicit' },
      repoRoot: ROOT,
      activeRoot: tempRoot,
      useCache: false,
      runCommand: successEvidence
    }), error => error instanceof ValidationDagError && error.code === 'VALIDATION_BUDGET_APPROVAL_REQUIRED')
    const approvedBudget = planValidation({
      manifest: heavyManifest,
      route: 'boundary',
      affectedBoundaries: ['fixture'],
      changedFiles: ['heavy/a.js'],
      changedSource: 'explicit',
      riskClass: 'high',
      candidateStable: true,
      candidateId: 'fixture-heavy',
      approvePlanDigest: awaitingBudget.budgetCard.digest
    })
    assert.strictEqual(approvedBudget.executionState, 'awaiting-authority')
    assert.strictEqual(approvedBudget.planDigest, awaitingBudget.planDigest,
      'budget approval must not change the semantic plan digest')
    assert.strictEqual(approvedBudget.budgetCard.status, 'approved')
    assert.throws(() => executeValidationPlanUnbound({
      manifest: heavyManifest,
      plan: approvedBudget,
      candidate: { candidateId: 'fixture-heavy', stable: true, changedFiles: ['heavy/a.js'], changedSource: 'explicit' },
      repoRoot: ROOT,
      activeRoot: tempRoot,
      useCache: false,
      runCommand: successEvidence
    }), error => error instanceof ValidationAuthorityError && error.code === 'VALIDATION_AUTHORITY_REQUIRED')

    const unownedV3Request = planValidation({
      manifest,
      route: 'full',
      level: 'V3',
      changedFiles: ['README.md'],
      changedSource: 'explicit',
      candidateStable: true,
      candidateId: 'fixture-unowned-v3'
    })
    assert.strictEqual(unownedV3Request.executionState, 'awaiting-budget')
    assert.strictEqual(Object.hasOwn(unownedV3Request.verificationIntent, 'explicitFullAudit'), false)
    const releaseRequest = planValidation({
      manifest,
      route: 'full',
      purpose: 'release',
      changedFiles: [],
      changedSource: 'git-clean',
      candidateStable: true,
      candidateId: 'fixture-release-no-authority'
    })
    assert.strictEqual(releaseRequest.executionState, 'awaiting-budget')
    const releasePlan = planValidation({
      manifest,
      route: 'full',
      purpose: 'release',
      changedFiles: [],
      changedSource: 'git-clean',
      candidateStable: true,
      candidateId: 'fixture-release-authorized',
      authoritySource: 'fixture-user-confirmation'
    })
    assert.strictEqual(releasePlan.verificationLevel, 'V3')
    assert.strictEqual(releasePlan.verificationPurpose, 'release')
    assert.strictEqual(releasePlan.claimCeiling, 'release-candidate')
    assert.strictEqual(Object.hasOwn(releasePlan.verificationIntent, 'releaseAuthorized'), false)
    assert.strictEqual(releasePlan.selectedNodeCount, fullPlan.selectedNodeCount)

    const firstCandidate = buildCandidateIdentity({ repoRoot: ROOT })
    const secondCandidate = buildCandidateIdentity({ repoRoot: ROOT })
    assert.strictEqual(firstCandidate.candidateId, secondCandidate.candidateId)
    assert.strictEqual(firstCandidate.stable, true)
    const narrativeCandidate = buildCandidateIdentity({
      repoRoot: ROOT,
      explicitChangedFiles: ['README.md', 'public-site/docs/index.md', 'website/docs/index.md']
    })
    assert(narrativeCandidate.scopeIdentities.every(item => item.narrativeMarkdown === true))
    assert(narrativeCandidate.scopeIdentities.every(item => item.deleted === true || item.contentOmitted === true))
    assert(narrativeCandidate.scopeIdentities.every(item => item.digest === undefined && item.bytes === undefined))

    const cachedNode = fixtureNode('fixture-cache', {
      cachePolicy: 'candidate-bound',
      writeScopes: []
    })
    const cachedManifest = fixtureManifest([cachedNode])
    const candidate = {
      candidateId: 'candidate-one',
      stable: true,
      head: 'fixture-head',
      dirtyIdentities: [{ path: 'fixture/a.js', deleted: false, digest: 'fixture-a', bytes: 1 }],
      scopeIdentities: [{ path: 'fixture/a.js', deleted: false, digest: 'fixture-a', bytes: 1 }],
      changedFiles: ['fixture/a.js'],
      changedSource: 'explicit'
    }
    const cachedPlan = planValidation({
      manifest: cachedManifest,
      route: 'changed',
      changedFiles: candidate.changedFiles,
      changedSource: candidate.changedSource,
      riskClass: 'normal',
      candidateStable: true,
      candidateId: candidate.candidateId
    })
    let runCount = 0
    const runCommand = node => {
      runCount += 1
      return successEvidence(node)
    }
    const firstRun = executeValidationPlan({
      manifest: cachedManifest,
      plan: cachedPlan,
      candidate,
      repoRoot: ROOT,
      activeRoot: tempRoot,
      runCommand
    })
    assert.strictEqual(firstRun.receipt.nativeExitCode, 0)
    assert.strictEqual(firstRun.receipt.schemaVersion, 'ValidationExecutionReceiptV3')
    assert.match(firstRun.receipt.nodeContractDigest, /^[a-f0-9]{64}$/)
    assert.match(firstRun.receipt.delegatedClosureDigest, /^[a-f0-9]{64}$/)
    assert.match(firstRun.receipt.testRouteDigest, /^[a-f0-9]{64}$/)
    assert.strictEqual(firstRun.receipt.executionMode, 'orchestrated-serial-lock-aware')
    assert.strictEqual(firstRun.receipt.validationLayer, 'iterative')
    assert.deepStrictEqual(firstRun.receipt.budget, cachedPlan.budget)
    assert.deepStrictEqual(firstRun.receipt.delegatedParentIds, cachedPlan.delegatedParentIds)
    assert.ok(firstRun.receipt.stdoutBytes >= 2)
    assert.strictEqual(firstRun.receipt.stderrBytes, 0)
    assert.match(firstRun.receipt.executionSchedule.scheduleDigest, /^[a-f0-9]{64}$/)
    assert.match(firstRun.receipt.nestedCommandGraphDigest || '', /^[a-f0-9]{64}$|^$/)
    assert.strictEqual(firstRun.receipt.contextBindingTrace.status, 'unverified')
    assert.strictEqual(runCount, 1)

    const resumedNodeStarts = []
    const resumedRun = executeValidationPlan({
      manifest: cachedManifest,
      plan: cachedPlan,
      candidate,
      repoRoot: ROOT,
      activeRoot: tempRoot,
      useCache: false,
      resumeResults: firstRun.receipt.results,
      onNodeStart: node => resumedNodeStarts.push(node),
      runCommand
    })
    assert.strictEqual(resumedRun.receipt.nativeExitCode, 0)
    assert.strictEqual(resumedRun.receipt.resumedNodeCount, 1)
    assert.deepStrictEqual(resumedRun.receipt.resumedNodeIds, [cachedNode.id])
    assert.strictEqual(resumedRun.receipt.results[0].cacheStatus, 'hit-run-checkpoint')
    assert.deepStrictEqual(resumedNodeStarts.map(node => node.nodeId), [cachedNode.id])
    assert.strictEqual(runCount, 1, 'an exact same-run checkpoint must not execute a completed node again')
    assert.throws(() => executeValidationPlan({
      manifest: cachedManifest,
      plan: cachedPlan,
      candidate,
      repoRoot: ROOT,
      activeRoot: tempRoot,
      useCache: false,
      resumeResults: [{ ...firstRun.receipt.results[0], inputBindingDigest: '0'.repeat(64) }],
      runCommand
    }), error => error instanceof ValidationDagError && error.code === 'VALIDATION_RUN_CHECKPOINT_INVALID')

    const tamperedExecutablePlan = clone(cachedPlan)
    tamperedExecutablePlan.selectedNodes[0].timeoutMs += 1
    assert.throws(() => executeValidationPlan({
      manifest: cachedManifest,
      plan: tamperedExecutablePlan,
      candidate,
      repoRoot: ROOT,
      activeRoot: tempRoot,
      runCommand
    }), error => error instanceof ValidationDagError && error.code === 'VALIDATION_PLAN_DIGEST_MISMATCH')
    assert.throws(() => executeValidationPlan({
      manifest: cachedManifest,
      plan: cachedPlan,
      candidate: { ...candidate, candidateId: 'candidate-drift' },
      repoRoot: ROOT,
      activeRoot: tempRoot,
      runCommand
    }), error => error instanceof ValidationDagError && error.code === 'VALIDATION_PLAN_CANDIDATE_MISMATCH')
    const changedManifestAfterPlan = clone(cachedManifest)
    changedManifestAfterPlan.nodes[0].timeoutMs += 1
    assert.throws(() => executeValidationPlan({
      manifest: changedManifestAfterPlan,
      plan: cachedPlan,
      candidate,
      repoRoot: ROOT,
      activeRoot: tempRoot,
      runCommand
    }), error => error instanceof ValidationDagError && error.code === 'VALIDATION_PLAN_MANIFEST_MISMATCH')

    const delegatedCore = fixtureNode('generic-validation-owner', {
      dependencies: [],
      delegatedClosure: [{ probe: 'V7', nodeId: 'hooks-runtime', command: 'node scripts/test-hooks-runtime.js' }]
    })
    const delegatedHooks = fixtureNode('hooks-runtime', { dependencies: ['generic-validation-owner'] })
    const delegatedManifest = fixtureManifest([delegatedCore, delegatedHooks])
    const delegatedPlan = approvedPlan({
      manifest: delegatedManifest,
      route: 'full',
      changedFiles: [],
      changedSource: 'explicit',
      riskClass: 'normal',
      candidateStable: true,
      candidateId: 'fixture-delegated'
    })
    const observedNodes = []
    const delegatedRun = executeValidationPlan({
      manifest: delegatedManifest,
      plan: delegatedPlan,
      candidate: { ...candidate, candidateId: 'fixture-delegated' },
      repoRoot: ROOT,
      activeRoot: tempRoot,
      useCache: false,
      runCommand: node => {
        observedNodes.push(node)
        return successEvidence(node)
      }
    })
    assert.strictEqual(delegatedRun.receipt.nativeExitCode, 0)
    assert.strictEqual(observedNodes[0].environment.DEVCODEX_VALIDATION_ACTIVE_ROOT, path.resolve(tempRoot))
    assert.strictEqual(observedNodes[0].environment.DEVCODEX_VALIDATION_ORCHESTRATED, '1')
    assert.strictEqual(observedNodes[0].environment.DEVCODEX_VALIDATION_DELEGATED_NODES, 'hooks-runtime')
    assert.strictEqual(observedNodes[1].environment?.DEVCODEX_VALIDATION_ORCHESTRATED, undefined)
    assert.strictEqual(observedNodes[1].environment.DEVCODEX_VALIDATION_ACTIVE_ROOT, path.resolve(tempRoot))
    const secondRun = executeValidationPlan({
      manifest: cachedManifest,
      plan: cachedPlan,
      candidate,
      repoRoot: ROOT,
      activeRoot: tempRoot,
      runCommand
    })
    assert.strictEqual(secondRun.receipt.cacheHitCount, 1)
    assert.strictEqual(runCount, 1)

    const descriptor = cacheDescriptor({
      manifest: cachedManifest,
      candidate,
      node: cachedNode,
      executionNode: {
        ...cachedNode,
        environment: {
          ...(cachedNode.environment || {}),
          DEVCODEX_VALIDATION_ACTIVE_ROOT: path.resolve(tempRoot)
        }
      }
    })
    const cacheFile = path.join(tempRoot, cacheRelativePath(descriptor.cacheKey))
    const tampered = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
    tampered.nodeEvidence.stdout = 'tampered'
    fs.writeFileSync(cacheFile, JSON.stringify(tampered, null, 2) + '\n')
    const tamperRun = executeValidationPlan({
      manifest: cachedManifest,
      plan: cachedPlan,
      candidate,
      repoRoot: ROOT,
      activeRoot: tempRoot,
      runCommand
    })
    assert.strictEqual(tamperRun.receipt.cacheHitCount, 0)
    assert.strictEqual(runCount, 2)

    const coverageTampered = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
    coverageTampered.nodeEvidence.invariantCoverage = ['wrong-invariant']
    coverageTampered.invariantCoverage = ['wrong-invariant']
    coverageTampered.evidenceIdentity = buildContentIdentity({
      sourceKey: 'validation-evidence/' + cachedNode.id,
      content: stableStringify(coverageTampered.nodeEvidence),
      contractVersion: '1'
    })
    fs.writeFileSync(cacheFile, JSON.stringify(coverageTampered, null, 2) + '\n')
    const coverageRun = executeValidationPlan({
      manifest: cachedManifest,
      plan: cachedPlan,
      candidate,
      repoRoot: ROOT,
      activeRoot: tempRoot,
      runCommand
    })
    assert.strictEqual(coverageRun.receipt.cacheHitCount, 0)
    assert.strictEqual(runCount, 3)

    const candidateTwo = { ...candidate, candidateId: 'candidate-two' }
    const planTwo = planValidation({
      manifest: cachedManifest,
      route: 'changed',
      changedFiles: candidateTwo.changedFiles,
      changedSource: candidateTwo.changedSource,
      riskClass: 'normal',
      candidateStable: true,
      candidateId: candidateTwo.candidateId
    })
    const candidateTwoRun = executeValidationPlan({
      manifest: cachedManifest,
      plan: planTwo,
      candidate: candidateTwo,
      repoRoot: ROOT,
      activeRoot: tempRoot,
      runCommand
    })
    assert.strictEqual(candidateTwoRun.receipt.cacheHitCount, 1)
    assert.strictEqual(runCount, 3, 'candidate id drift alone must not invalidate an unchanged node scope')

    const v3Plan = approvedPlan({
      manifest: cachedManifest,
      route: 'full',
      changedFiles: candidateTwo.changedFiles,
      changedSource: candidateTwo.changedSource,
      riskClass: 'normal',
      candidateStable: true,
      candidateId: candidateTwo.candidateId
    })
    const v3Run = executeValidationPlan({
      manifest: cachedManifest,
      plan: v3Plan,
      candidate: candidateTwo,
      repoRoot: ROOT,
      activeRoot: tempRoot,
      runCommand
    })
    assert.strictEqual(v3Run.receipt.cacheHitCount, 0)
    assert.strictEqual(v3Run.receipt.results[0].cacheStatus, 'disabled-v3')
    assert.strictEqual(runCount, 4, 'V3 must execute even when a V1 cache entry is fresh')

    const candidateThree = {
      ...candidate,
      candidateId: 'candidate-three',
      dirtyIdentities: [{ path: 'fixture/a.js', deleted: false, digest: 'fixture-b', bytes: 1 }],
      scopeIdentities: []
    }
    const planThree = planValidation({
      manifest: cachedManifest,
      route: 'changed',
      changedFiles: candidateThree.changedFiles,
      changedSource: candidateThree.changedSource,
      riskClass: 'normal',
      candidateStable: true,
      candidateId: candidateThree.candidateId
    })
    const capacityRun = executeValidationPlan({
      manifest: cachedManifest,
      plan: planThree,
      candidate: candidateThree,
      repoRoot: ROOT,
      activeRoot: tempRoot,
      runCommand,
      maxCacheBytes: 1
    })
    assert.strictEqual(capacityRun.receipt.nativeExitCode, 0)
    assert.strictEqual(capacityRun.receipt.results[0].cacheWrite, 'bypassed')
    assert.strictEqual(capacityRun.persistence.status, 'deferred')
    assert.strictEqual(capacityRun.persistence.reasonCode, 'managed-runner-terminal-owner')
    assert.deepStrictEqual(capacityRun.receipt.invalidationFrontier, ['fixture-cache'])
    assert.strictEqual(runCount, 5)

    const unstableCacheCandidate = { ...candidate, candidateId: 'candidate-unstable-cache', stable: false }
    const unstableCachePlan = approvedPlan({
      manifest: cachedManifest,
      route: 'full',
      changedFiles: unstableCacheCandidate.changedFiles,
      changedSource: 'unknown',
      riskClass: 'normal',
      candidateStable: false,
      candidateId: unstableCacheCandidate.candidateId
    })
    let unstableRunCount = 0
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const unstableCacheRun = executeValidationPlan({
        manifest: cachedManifest,
        plan: unstableCachePlan,
        candidate: unstableCacheCandidate,
        repoRoot: ROOT,
        activeRoot: tempRoot,
        runCommand: node => {
          unstableRunCount += 1
          return successEvidence(node)
        }
      })
      assert.strictEqual(unstableCacheRun.receipt.cacheHitCount, 0)
      assert.strictEqual(unstableCacheRun.receipt.results[0].cacheStatus, 'disabled-v3')
    }
    assert.strictEqual(unstableRunCount, 2)

    const focusCacheNode = fixtureNode('focus-cache', {
      inputs: ['focus/**'],
      cachePolicy: 'candidate-bound',
      writeScopes: []
    })
    const unrelatedNode = fixtureNode('unrelated-node', { inputs: ['unrelated/**'] })
    const focusedManifest = fixtureManifest([focusCacheNode, unrelatedNode])
    const focusedCandidate = {
      ...candidate,
      candidateId: 'candidate-focused-cache',
      dirtyIdentities: [{ path: 'focus/a.js', deleted: false, digest: 'focus-a', bytes: 1 }],
      scopeIdentities: [{ path: 'focus/a.js', deleted: false, digest: 'focus-a', bytes: 1 }],
      changedFiles: ['focus/a.js']
    }
    const focusedFullPlan = planValidation({
      manifest: focusedManifest,
      route: 'changed',
      changedFiles: focusedCandidate.changedFiles,
      changedSource: 'explicit',
      riskClass: 'normal',
      candidateStable: true,
      candidateId: focusedCandidate.candidateId
    })
    let focusedRunCount = 0
    const focusedCommand = node => {
      focusedRunCount += 1
      return successEvidence(node)
    }
    executeValidationPlan({
      manifest: focusedManifest,
      plan: focusedFullPlan,
      candidate: focusedCandidate,
      repoRoot: ROOT,
      activeRoot: tempRoot,
      runCommand: focusedCommand
    })
    assert.strictEqual(focusedRunCount, 1)
    const focusedDescriptor = cacheDescriptor({
      manifest: focusedManifest,
      candidate: focusedCandidate,
      node: focusCacheNode,
      executionNode: {
        ...focusCacheNode,
        environment: {
          ...(focusCacheNode.environment || {}),
          DEVCODEX_VALIDATION_ACTIVE_ROOT: path.resolve(tempRoot)
        }
      }
    })
    const focusedCacheFile = path.join(tempRoot, cacheRelativePath(focusedDescriptor.cacheKey))
    const invalidFocusedCache = JSON.parse(fs.readFileSync(focusedCacheFile, 'utf8'))
    invalidFocusedCache.nodeEvidence.invariantCoverage = ['wrong-invariant']
    invalidFocusedCache.invariantCoverage = ['wrong-invariant']
    invalidFocusedCache.evidenceIdentity = buildContentIdentity({
      sourceKey: 'validation-evidence/' + focusCacheNode.id,
      content: stableStringify(invalidFocusedCache.nodeEvidence),
      contractVersion: '1'
    })
    fs.writeFileSync(focusedCacheFile, JSON.stringify(invalidFocusedCache, null, 2) + '\n')
    const focusedChangedPlan = planValidation({
      manifest: focusedManifest,
      route: 'changed',
      changedFiles: focusedCandidate.changedFiles,
      changedSource: 'explicit',
      riskClass: 'normal',
      candidateStable: true,
      candidateId: focusedCandidate.candidateId
    })
    assert.strictEqual(focusedChangedPlan.selectedNodeCount, 1)
    const focusedFallbackRun = executeValidationPlan({
      manifest: focusedManifest,
      plan: focusedChangedPlan,
      candidate: focusedCandidate,
      repoRoot: ROOT,
      activeRoot: tempRoot,
      runCommand: focusedCommand
    })
    assert.strictEqual(focusedFallbackRun.receipt.routeResolved, 'changed')
    assert.strictEqual(focusedFallbackRun.receipt.selectedNodeCount, 1)
    assert.strictEqual(focusedFallbackRun.receipt.fullFallback, null)
    assert.deepStrictEqual(focusedFallbackRun.receipt.invalidationFrontier, ['focus-cache'])
    assert.deepStrictEqual(focusedFallbackRun.receipt.cacheInvalidations,
      [{ nodeId: 'focus-cache', status: 'invalid', action: 'rerun-precise-node' }])
    assert.strictEqual(focusedRunCount, 2)

    const cascadeManifest = fixtureManifest([
      fixtureNode('cache-upstream', {
        inputs: ['cascade/**'],
        consumers: ['cache-downstream'],
        cachePolicy: 'candidate-bound',
        writeScopes: []
      }),
      fixtureNode('cache-downstream', {
        inputs: ['downstream/**'],
        dependencies: ['cache-upstream'],
        cachePolicy: 'candidate-bound',
        writeScopes: []
      })
    ])
    const cascadeCandidateA = {
      ...candidate,
      candidateId: 'candidate-cascade-a',
      dirtyIdentities: [{ path: 'cascade/input.js', deleted: false, digest: 'cascade-a', bytes: 1 }],
      scopeIdentities: [{ path: 'cascade/input.js', deleted: false, digest: 'cascade-a', bytes: 1 }],
      changedFiles: ['cascade/input.js']
    }
    const cascadePlanA = planValidation({
      manifest: cascadeManifest,
      route: 'changed',
      changedFiles: cascadeCandidateA.changedFiles,
      changedSource: 'explicit',
      candidateStable: true,
      candidateId: cascadeCandidateA.candidateId
    })
    let cascadeRunCount = 0
    const cascadeCommand = node => {
      cascadeRunCount += 1
      return successEvidence(node)
    }
    const cascadeRunA = executeValidationPlan({
      manifest: cascadeManifest,
      plan: cascadePlanA,
      candidate: cascadeCandidateA,
      repoRoot: ROOT,
      activeRoot: tempRoot,
      runCommand: cascadeCommand
    })
    assert.strictEqual(cascadeRunCount, 2)
    const cascadeCandidateB = {
      ...cascadeCandidateA,
      candidateId: 'candidate-cascade-b',
      dirtyIdentities: [{ path: 'cascade/input.js', deleted: false, digest: 'cascade-b', bytes: 1 }],
      scopeIdentities: [{ path: 'cascade/input.js', deleted: false, digest: 'cascade-b', bytes: 1 }]
    }
    const cascadePlanB = planValidation({
      manifest: cascadeManifest,
      route: 'changed',
      changedFiles: cascadeCandidateB.changedFiles,
      changedSource: 'explicit',
      candidateStable: true,
      candidateId: cascadeCandidateB.candidateId
    })
    const cascadeRunB = executeValidationPlan({
      manifest: cascadeManifest,
      plan: cascadePlanB,
      candidate: cascadeCandidateB,
      repoRoot: ROOT,
      activeRoot: tempRoot,
      runCommand: cascadeCommand
    })
    assert.strictEqual(cascadeRunCount, 4, 'changed upstream input must invalidate its dependent even when stdout is unchanged')
    assert.deepStrictEqual(cascadeRunB.receipt.invalidationFrontier, ['cache-downstream', 'cache-upstream'])
    assert.notStrictEqual(
      cascadeRunA.receipt.nodeReceiptDigests['cache-upstream'],
      cascadeRunB.receipt.nodeReceiptDigests['cache-upstream']
    )
    assert.strictEqual(
      cascadeRunB.receipt.dependencyReceiptDigests['cache-downstream'][0],
      cascadeRunB.receipt.nodeReceiptDigests['cache-upstream']
    )

    const serialManifest = fixtureManifest([
      fixtureNode('serial-a'),
      fixtureNode('serial-b', { dependencies: ['serial-a'] }),
      fixtureNode('serial-c', { dependencies: ['serial-b'] })
    ])
    const serialCandidate = { ...candidate, candidateId: 'candidate-serial' }
    const serialPlan = approvedPlan({
      manifest: serialManifest,
      route: 'full',
      changedFiles: [],
      changedSource: 'git-clean',
      riskClass: 'normal',
      candidateStable: true,
      candidateId: serialCandidate.candidateId
    })
    const observedOrder = []
    const serialRun = executeValidationPlan({
      manifest: serialManifest,
      plan: serialPlan,
      candidate: serialCandidate,
      repoRoot: ROOT,
      activeRoot: tempRoot,
      useCache: false,
      runCommand: node => {
        observedOrder.push(node.id)
        return successEvidence(node)
      }
    })
    assert.deepStrictEqual(observedOrder, ['serial-a', 'serial-b', 'serial-c'])
    assert.strictEqual(serialRun.receipt.duplicateLeafCount, 0)

    const failingManifest = fixtureManifest([
      fixtureNode('fixture-failure', { cachePolicy: 'never' })
    ])
    const failingPlan = approvedPlan({
      manifest: failingManifest,
      route: 'full',
      changedFiles: [],
      changedSource: 'git-clean',
      riskClass: 'normal',
      candidateStable: true,
      candidateId: 'candidate-failure'
    })
    const failingRun = executeValidationPlan({
      manifest: failingManifest,
      plan: failingPlan,
      candidate: { ...candidate, candidateId: 'candidate-failure' },
      repoRoot: ROOT,
      activeRoot: tempRoot,
      useCache: false,
      runCommand: node => {
        throw new CheckedCommandError('fixture failed', {
          code: 'ECOMMAND',
          command: node.command,
          args: node.args,
          cwd: ROOT,
          exitCode: 7,
          signal: null,
          durationMs: 1,
          stdout: '',
          stderr: 'fixture failed'
        })
      }
    })
    assert.strictEqual(failingRun.receipt.nativeExitCode, 1)
    assert.strictEqual(failingRun.receipt.failedNode, 'fixture-failure')
    assert.strictEqual(failingRun.receipt.results[0].exitCode, 7)

    const aggregateManifest = fixtureManifest([
      fixtureNode('aggregate-failure-a', { cachePolicy: 'never' }),
      fixtureNode('aggregate-dependent', { dependencies: ['aggregate-failure-a'], cachePolicy: 'never' }),
      fixtureNode('aggregate-failure-b', { cachePolicy: 'never' }),
      fixtureNode('aggregate-independent-pass', { cachePolicy: 'never' })
    ])
    const aggregateCandidate = { ...candidate, candidateId: 'candidate-failure-aggregation' }
    const aggregatePlan = approvedPlan({
      manifest: aggregateManifest,
      route: 'full',
      changedFiles: [],
      changedSource: 'git-clean',
      riskClass: 'normal',
      candidateStable: true,
      candidateId: aggregateCandidate.candidateId
    })
    const aggregateInvocations = []
    const aggregateRun = executeValidationPlan({
      manifest: aggregateManifest,
      plan: aggregatePlan,
      candidate: aggregateCandidate,
      repoRoot: ROOT,
      activeRoot: tempRoot,
      useCache: false,
      runCommand: node => {
        aggregateInvocations.push(node.id)
        if (node.id.startsWith('aggregate-failure-')) {
          throw new CheckedCommandError(`${node.id} failed`, {
            code: 'ECOMMAND', command: node.command, args: node.args, cwd: ROOT,
            exitCode: 9, signal: null, durationMs: 1, stdout: '', stderr: `${node.id} failed`
          })
        }
        return successEvidence(node)
      }
    })
    assert.deepStrictEqual(aggregateRun.receipt.failedNodes, ['aggregate-failure-a', 'aggregate-failure-b'])
    assert.strictEqual(aggregateRun.receipt.failedNode, 'aggregate-failure-a')
    assert.deepStrictEqual(aggregateRun.receipt.abortedNodes, ['aggregate-dependent'])
    assert.strictEqual(
      aggregateRun.receipt.abortedNodeReasons['aggregate-dependent'].code,
      'VALIDATION_DEPENDENCY_FAILED'
    )
    assert(aggregateInvocations.includes('aggregate-independent-pass'))
    assert(!aggregateInvocations.includes('aggregate-dependent'))

    const packageJson = require('../package.json')
    assert.strictEqual(packageJson.scripts.test, 'node scripts/run-validation.js --route changed')
    assert.strictEqual(packageJson.scripts['test:fast'], 'node scripts/run-validation.js --route fast')
    assert.strictEqual(packageJson.scripts['test:full'], 'node scripts/run-validation.js --route full')
    assert.strictEqual(packageJson.scripts['test:delivery'], 'node scripts/run-validation.js --route delivery')
    assert.strictEqual(packageJson.scripts['test:boundary'], 'node scripts/run-validation.js --route boundary')
    assert.strictEqual(packageJson.scripts['test:actual-candidate-evidence'], 'node scripts/test-actual-candidate-evidence.js')
    assert.strictEqual(packageJson.scripts['test:dangerous-command-context'], 'node scripts/test-dangerous-command-context.js')
    assert.strictEqual(packageJson.scripts['test:session-route-consumers'], 'node scripts/test-session-route-consumers.js')
    assert.strictEqual(packageJson.scripts['test:task-admission-authority'], 'node scripts/test-task-admission-authority.js')
    assert.strictEqual(packageJson.scripts['test:validation-authority'], 'node scripts/test-validation-execution-authority.js && node scripts/test-validation-budget-control.js')
    assert.strictEqual(packageJson.scripts['test:mcp-runtime-closure:package'], 'node scripts/test-mcp-runtime-closure.js --packlist-only')
    for (const file of [
      'scripts/validation-manifest.json',
      'scripts/run-validation.js',
      'scripts/test-validation-dag.js',
      'scripts/test-profile-section-selector.js',
      'scripts/project-analysis-state.js',
      'scripts/test-project-knowledge-store.js',
      'scripts/test-execution-attempt-ledger.js',
      'scripts/test-validation-execution-authority.js',
      'scripts/test-validation-budget-control.js',
      'scripts/fixtures/managed-validation-worker-fixture.js',
      'scripts/lib/project-knowledge-store.js',
      'scripts/lib/managed-validation-runner.js',
      'scripts/lib/actual-candidate-evidence.js',
      'scripts/lib/validation-dag.js',
      'scripts/lib/validation-evidence-store.js',
      'scripts/lib/validation-execution-authority.js',
      'scripts/lib/validation-worker.js',
      'scripts/test-actual-candidate-evidence.js',
      'scripts/test-dangerous-command-context.js',
      'scripts/test-session-route-consumers.js',
      'scripts/test-task-admission-authority.js'
    ]) assert(packageJson.files.includes(file), 'package files missing ' + file)

    const cliHumanEnv = { ...process.env }
    delete cliHumanEnv.CODEX_THREAD_ID
    delete cliHumanEnv.CODEX_INTERNAL_ORIGINATOR_OVERRIDE
    delete cliHumanEnv.DEVCODEX_VALIDATION_ACTOR
    delete cliHumanEnv.GITHUB_ACTIONS
    delete cliHumanEnv.GITHUB_REF_TYPE
    const planJson = spawnSync(process.execPath, [
      'scripts/run-validation.js',
      '--route', 'changed',
      '--changed', 'README.md',
      '--plan',
      '--json'
    ], { cwd: ROOT, encoding: 'utf8', windowsHide: true, env: cliHumanEnv })
    assert.strictEqual(planJson.status, 0, planJson.stderr)
    const planEnvelope = JSON.parse(planJson.stdout)
    assert.strictEqual(planEnvelope.schemaVersion, 'ValidationCliEnvelopeV1')
    assert.strictEqual(planEnvelope.ok, true)
    assert.strictEqual(planEnvelope.error, null)
    assert.strictEqual(planEnvelope.data.plan.routeResolved, 'changed')
    assert.strictEqual(planEnvelope.data.plan.executionState, 'ready')
    assert.strictEqual(planEnvelope.data.plan.validationDisposition, 'recognized-no-javascript-inputs')
    assert.deepStrictEqual(planEnvelope.data.plan.recognizedNoJsInputs, ['README.md'])
    assert.deepStrictEqual(planEnvelope.data.plan.executableChangedFiles, [])
    assert.strictEqual(planEnvelope.data.plan.selectedNodeCount, 0)
    assert.strictEqual(planEnvelope.data.plan.javascriptCommandCount, 0)
    assert.strictEqual(planEnvelope.data.plan.fullFallback, null)

    const highHookPlan = spawnSync(process.execPath, [
      'scripts/run-validation.js',
      '--route', 'changed',
      '--risk', 'high',
      '--changed', 'hooks/_runtime/lifecycle-host-adapters.cjs',
      '--plan',
      '--json'
    ], { cwd: ROOT, encoding: 'utf8', windowsHide: true, env: cliHumanEnv })
    assert.strictEqual(highHookPlan.status, 0, highHookPlan.stderr)
    const highHookEnvelope = JSON.parse(highHookPlan.stdout)
    assert.strictEqual(highHookEnvelope.data.plan.routeResolved, 'boundary')
    assert.strictEqual(highHookEnvelope.data.plan.verificationLevel, 'V2')
    assert.strictEqual(highHookEnvelope.data.plan.fullFallback, null)
    assert(highHookEnvelope.data.plan.affectedBoundaries.includes('hook-runtime'))

    const unauthorizedRelease = spawnSync(process.execPath, [
      'scripts/run-validation.js',
      '--route', 'full',
      '--purpose', 'release',
      '--plan',
      '--json'
    ], { cwd: ROOT, encoding: 'utf8', windowsHide: true, env: cliHumanEnv })
    assert.strictEqual(unauthorizedRelease.status, 0)
    const releaseEnvelope = JSON.parse(unauthorizedRelease.stdout)
    assert.strictEqual(releaseEnvelope.data.plan.executionState, 'awaiting-budget')
    assert.strictEqual(Object.hasOwn(releaseEnvelope.data.plan.verificationIntent, 'releaseAuthorized'), false)

    const invalidRoute = spawnSync(process.execPath, [
      'scripts/run-validation.js',
      '--route', 'not-a-route',
      '--json'
    ], { cwd: ROOT, encoding: 'utf8', windowsHide: true, env: cliHumanEnv })
    assert.strictEqual(invalidRoute.status, 2)
    const invalidEnvelope = JSON.parse(invalidRoute.stdout)
    assert.strictEqual(invalidEnvelope.ok, false)
    assert.strictEqual(invalidEnvelope.error.code, 'VALIDATION_ROUTE_UNKNOWN')
    assert(invalidEnvelope.error.nextStep)

    const failingManifestPath = path.join(tempRoot, 'failing-manifest.json')
    const cliFailManifest = fixtureManifest([
      fixtureNode('cli-failure', {
        command: process.execPath,
        args: ['-e', 'process.exit(7)'],
        cachePolicy: 'never'
      })
    ])
    fs.writeFileSync(failingManifestPath, JSON.stringify(cliFailManifest, null, 2) + '\n')
    const cliCiEnv = {
      ...process.env,
      DEVCODEX_VALIDATION_ACTIVE_ROOT: tempRoot,
      GITHUB_ACTIONS: 'true',
      GITHUB_REF_TYPE: 'branch',
      GITHUB_WORKFLOW: 'Validation Fixture',
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REPOSITORY: 'devcodex-labs/devcodex',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: 'c'.repeat(40)
    }
    delete cliCiEnv.CODEX_THREAD_ID
    delete cliCiEnv.CODEX_INTERNAL_ORIGINATOR_OVERRIDE
    delete cliCiEnv.DEVCODEX_VALIDATION_ACTOR
    const cliAuthoritySource = [
      'github-actions', cliCiEnv.GITHUB_WORKFLOW, cliCiEnv.GITHUB_EVENT_NAME,
      cliCiEnv.GITHUB_REPOSITORY, cliCiEnv.GITHUB_REF, cliCiEnv.GITHUB_SHA
    ].join(':')
    const cliPolicyDigest = expectedCiPolicyDigest('trusted-ci', { verificationLevel: 'V3' }, cliCiEnv)
    const cliFailurePlan = spawnSync(process.execPath, [
      'scripts/run-validation.js',
      '--manifest', failingManifestPath,
      '--route', 'full',
      '--actor', 'trusted-ci',
      '--authority-source', cliAuthoritySource,
      '--policy-digest', cliPolicyDigest,
      '--plan',
      '--json',
      '--no-cache'
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
      env: cliCiEnv
    })
    assert.strictEqual(cliFailurePlan.status, 0, cliFailurePlan.stderr)
    const cliFailureBudgetDigest = JSON.parse(cliFailurePlan.stdout).data.plan.budgetCard.digest
    const cliFailure = spawnSync(process.execPath, [
      'scripts/run-validation.js',
      '--manifest', failingManifestPath,
      '--route', 'full',
      '--approve-plan', cliFailureBudgetDigest,
      '--actor', 'trusted-ci',
      '--authority-source', cliAuthoritySource,
      '--policy-digest', cliPolicyDigest,
      '--json',
      '--no-cache'
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
      env: cliCiEnv
    })
    assert.strictEqual(cliFailure.status, 1, cliFailure.stderr)
    const failureEnvelope = JSON.parse(cliFailure.stdout)
    assert.strictEqual(failureEnvelope.ok, false)
    assert.strictEqual(failureEnvelope.error.code, 'VALIDATION_NODE_FAILED')
    assert.strictEqual(failureEnvelope.data.receipt.results[0].exitCode, 7)

    console.log(`validation DAG tests passed: manifestNodes=${manifest.nodes.length} fullNodes=${fullPlan.selectedNodeCount} duplicateLeaf=0 requiredMiss=0 graphFallback=closed cacheTamper/invariant/unstable=closed nativeExit=0/1/2`)
  } finally {
    if (process.env.DEVCODEX_KEEP_TEST_ARTIFACTS === '1') {
      console.log(`kept validation DAG fixture: ${tempRoot}`)
    } else {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  }
}

run()
