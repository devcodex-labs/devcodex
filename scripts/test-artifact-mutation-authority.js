'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  classifyHostToolMutation,
  validateHostToolMutationAdapterDecision
} = require('../hooks/_runtime/host-tool-mutation-adapters.cjs')
const {
  extractMutationFootprint,
  validateMutationFootprint
} = require('../hooks/_runtime/mutation-footprint.cjs')
const {
  decideArtifactMutation,
  createArtifactRootIdentity,
  enumerateTaskArtifacts,
  hasTaskArtifact,
  isAuthoritativeTaskArtifact,
  readLayeredArtifactSlotRegistry,
  reconcileArtifactSlotDecision,
  validateArtifactSlotDecision
} = require('../hooks/_runtime/artifact-slot-decision.cjs')
const {
  createMutationPreObservation,
  createTaskOwnedMutationLease,
  observeMutationEffects,
  validateMutationObservationReceipt,
  validateTaskOwnedMutationLease
} = require('../hooks/_runtime/mutation-observation.cjs')
const { compactLifecycleStateV5 } = require('../hooks/_runtime/lifecycle-state-projection-v5.cjs')

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-artifact-authority-'))
const activeRoot = path.join(tempRoot, '.devcodex', 'devcodex')
const taskName = 'artifact-authority-fixture'
const taskRoot = path.join(activeRoot, 'bugs', taskName)

function write(relative, text = '# fixture\n') {
  const target = path.join(taskRoot, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, text, 'utf8')
  return target
}

function decisionFor(payload, overrides = {}) {
  const footprint = extractMutationFootprint(payload, { cwd: tempRoot })
  return {
    footprint,
    decision: decideArtifactMutation({
      footprint,
      activeRoot,
      projectRoot: tempRoot,
      cwd: tempRoot,
      project: 'devcodex',
      taskRecoveryKey: 'artifact-authority-task',
      contextEpoch: 'artifact-authority-context',
      intent: 'fix',
      taskKind: 'bugs',
      taskName,
      authoritySourceRef: 'fixture:confirmed-task',
      ...overrides
    })
  }
}

try {
  const canonicalIdentityRoot = path.join(tempRoot, 'canonical-root-identity')
  const aliasIdentityRoot = path.join(tempRoot, 'alias-root-identity')
  fs.mkdirSync(canonicalIdentityRoot, { recursive: true })
  const comparablePath = value => process.platform === 'win32'
    ? path.resolve(value).toLowerCase()
    : path.resolve(value)
  const aliasFs = {
    realpathSync(value) {
      return comparablePath(value) === comparablePath(aliasIdentityRoot)
        ? canonicalIdentityRoot
        : fs.realpathSync(value)
    }
  }
  assert.deepStrictEqual(
    createArtifactRootIdentity(aliasIdentityRoot, { fs: aliasFs }),
    createArtifactRootIdentity(canonicalIdentityRoot),
    'artifact root identity must bind the canonical filesystem root rather than an alias spelling'
  )
  const distinctIdentityRoot = path.join(tempRoot, 'distinct-root-identity')
  fs.mkdirSync(distinctIdentityRoot, { recursive: true })
  assert.notStrictEqual(
    createArtifactRootIdentity(distinctIdentityRoot).digest,
    createArtifactRootIdentity(canonicalIdentityRoot).digest,
    'different canonical filesystem roots must retain different identities'
  )

  const overview = write('00-问题概况.md')
  const cp1 = write('01-问题确认.md')
  const cp2 = write('02-修复方案.md')
  write('04-实施计划.md')
  write('05-实施进度.md')
  const overlayPath = path.join(activeRoot, 'profile', 'artifact-slot-registry.overlay.v2.json')
  fs.mkdirSync(path.dirname(overlayPath), { recursive: true })
  const safeOverlay = {
    schemaVersion: 'ArtifactSlotRegistryOverlayV2',
    contractVersion: '2',
    project: 'devcodex',
    baseRegistryId: 'devcodex-shipped-base-v2',
    constraints: { mayWidenProtected: false, allowedRootClasses: ['active-root', 'project-root', 'logical'] },
    slotExtensions: [],
    slots: [{
      slotId: 'fixture-task-http-verification',
      rootClass: 'active-root',
      scope: 'task',
      taskKinds: ['requirements', 'bugs', 'optimizations', 'scenario-tests'],
      artifactClass: 'http-verification',
      stage: 'verification',
      relativePatterns: ['^(?:[^/]+\\.http|http/[^/]+(?:/[^/]+)*\\.http)$'],
      alternativeGroup: null,
      writePolicy: 'bounded-path',
      owner: 'task-owner',
      mutability: 'mutable',
      protected: false,
      destructivePolicy: 'forbid'
    }]
  }
  fs.writeFileSync(overlayPath, JSON.stringify(safeOverlay, null, 2))
  const layered = readLayeredArtifactSlotRegistry({ activeRoot, project: 'devcodex' })
  assert.strictEqual(layered.schemaVersion, 'LayeredArtifactSlotRegistryV2')
  assert.strictEqual(layered.slots.some(slot => slot.slotId === 'fixture-task-http-verification'), true)
  assert.match(layered.mergedRegistryDigest, /^[a-f0-9]{64}$/)
  const baseRegistry = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'hooks', '_runtime', 'artifact-slot-registry.v2.json'),
    'utf8'
  ))
  assert.strictEqual(baseRegistry.projectMutationCoverageContract, 'tracked-product-surfaces-v1')
  assert(baseRegistry.slots.find(slot => slot.slotId === 'bug-cp2')?.canonicalNames.includes('02-技术方案.md'))
  fs.writeFileSync(overlayPath, JSON.stringify({
    ...safeOverlay,
    slots: [{ ...safeOverlay.slots[0], slotId: 'implementation-plan' }]
  }, null, 2))
  assert.throws(
    () => readLayeredArtifactSlotRegistry({ activeRoot, project: 'devcodex' }),
    error => error?.code === 'ARTIFACT_SLOT_REGISTRY_OVERLAY_INVALID' && error.details.some(item => item.includes('overlay-slot-conflict'))
  )
  fs.writeFileSync(overlayPath, JSON.stringify({
    ...safeOverlay,
    slotExtensions: [{ slotId: 'implementation-plan', consumers: ['fixture'], owner: 'workflow-owner' }]
  }, null, 2))
  assert.throws(
    () => readLayeredArtifactSlotRegistry({ activeRoot, project: 'devcodex' }),
    error => error?.code === 'ARTIFACT_SLOT_REGISTRY_OVERLAY_INVALID' && error.details.some(item => item.includes('overlay-extension-widening'))
  )
  fs.writeFileSync(overlayPath, JSON.stringify(safeOverlay, null, 2))

  const hostMatrix = [
    {
      hostVariant: 'codex-desktop',
      payload: { tool_name: 'exec_command', tool_input: { command: `Set-Content -LiteralPath "${cp2}" -Value test` } },
      operationClass: 'shell',
      commandClass: 'direct-write',
      coverage: 'complete'
    },
    {
      hostVariant: 'claude-code',
      payload: { tool_name: 'Write', tool_input: { file_path: cp2, content: 'test' } },
      operationClass: 'direct-write',
      commandClass: null,
      coverage: 'complete'
    },
    {
      hostVariant: 'github-copilot',
      payload: { tool_name: 'apply_patch', tool_input: { input: `*** Begin Patch\n*** Update File: ${cp2}\n*** End Patch` } },
      operationClass: 'direct-write',
      commandClass: null,
      coverage: 'complete'
    },
    {
      hostVariant: 'gemini-cli',
      payload: { tool_name: 'write_file', tool_input: { path: cp2, content: 'test' } },
      operationClass: 'direct-write',
      commandClass: null,
      coverage: 'complete'
    },
    {
      hostVariant: 'cursor-local',
      payload: { tool_name: 'run_in_terminal', tool_input: { command: 'prettier --write src', target_roots: [taskRoot] } },
      operationClass: 'indirect-writer',
      commandClass: 'formatter',
      coverage: 'complete'
    },
    {
      hostVariant: 'grok',
      payload: { tool_name: 'grok_generate_file', tool_input: { artifact_path: cp2 } },
      operationClass: 'unknown',
      commandClass: null,
      coverage: 'unavailable'
    }
  ]
  for (const fixture of hostMatrix) {
    const adapter = classifyHostToolMutation(fixture.payload, { hostVariant: fixture.hostVariant })
    assert.strictEqual(validateHostToolMutationAdapterDecision(adapter).valid, true, JSON.stringify(adapter))
    assert.strictEqual(adapter.hostVariant, fixture.hostVariant)
    assert.strictEqual(adapter.operationClass, fixture.operationClass)
    assert.strictEqual(adapter.commandClass, fixture.commandClass)
    assert.strictEqual(adapter.coverage, fixture.coverage)
  }

  const readOnlyExec = classifyHostToolMutation({
    tool_name: 'exec_command',
    tool_input: { command: 'rg -n MutationFootprint hooks' }
  }, { hostVariant: 'codex-desktop' })
  assert.strictEqual(readOnlyExec.mutationCandidate, false)
  assert.strictEqual(readOnlyExec.operationClass, 'read')
  for (const payload of [
    {
      tool_name: 'mcp__devcodex_profile__profile_load',
      tool_input: { files: ['01-项目信息.md'], contextBinding: { activeRoot } }
    },
    {
      tool_name: 'devcodex-profile/profile_load',
      tool_input: { files: ['02-架构约束.md'], contextBinding: { activeRoot } }
    },
    {
      tool_name: 'mcp__devcodex_memory__memory_session_read',
      tool_input: { path: path.join(activeRoot, '.memory', 'clients', 'codex', 'SUMMARY.md') }
    }
  ]) {
    const adapter = classifyHostToolMutation(payload, { hostVariant: 'codex-cli' })
    assert.strictEqual(adapter.adapterId, 'host-devcodex-read-v1')
    assert.strictEqual(adapter.operationClass, 'read')
    assert.strictEqual(adapter.mutationCandidate, false)
    assert.strictEqual(adapter.coverage, 'not-applicable')
  }
  const unknownPathMcp = classifyHostToolMutation({
    tool_name: 'mcp__third_party__profile_load',
    tool_input: { files: ['target.md'] }
  }, { hostVariant: 'codex-cli' })
  assert.strictEqual(unknownPathMcp.operationClass, 'unknown')
  assert.strictEqual(unknownPathMcp.mutationCandidate, true)
  assert.strictEqual(unknownPathMcp.coverage, 'unavailable')
  const qualifiedMemoryWrite = classifyHostToolMutation({
    tool_name: 'mcp__devcodex_memory__memory_session_write',
    tool_input: { sessionId: '01', content: 'fixture' }
  }, { hostVariant: 'codex-cli' })
  assert.strictEqual(qualifiedMemoryWrite.adapterId, 'host-controlled-logical-write-v1')
  assert.strictEqual(qualifiedMemoryWrite.mutationCandidate, true)
  assert.strictEqual(qualifiedMemoryWrite.coverage, 'complete')
  for (const safeSearch of [
    'rg -n "rm -rf|Set-Content|Remove-Item" docs',
    'Get-Content README.md | Select-String "rm -rf|Set-Content"',
    'Get-Alias sc',
    'sc.exe query',
    'node --check hooks/_runtime/lifecycle.cjs',
    'git status --short'
  ]) {
    const safeAdapter = classifyHostToolMutation({ tool_name: 'exec_command', tool_input: { command: safeSearch } })
    assert.strictEqual(safeAdapter.mutationCandidate, false, safeSearch)
    assert.strictEqual(safeAdapter.operationClass, 'read', safeSearch)
  }
  const powershellAliasCommand = 'Get-Content README.md; sc evidence/alias-write.md "fixture"'
  const powershellAliasAdapter = classifyHostToolMutation({
    tool_name: 'shell_command',
    tool_input: { command: powershellAliasCommand }
  }, { hostVariant: 'codex-desktop' })
  assert.strictEqual(powershellAliasAdapter.mutationCandidate, true)
  assert.strictEqual(powershellAliasAdapter.operationClass, 'shell')
  assert.strictEqual(powershellAliasAdapter.commandClass, 'direct-write')
  const powershellAliasFootprint = extractMutationFootprint({
    tool_name: 'shell_command',
    tool_input: { command: powershellAliasCommand }
  }, { cwd: tempRoot, hostVariant: 'codex-desktop', adapterDecision: powershellAliasAdapter })
  assert.deepStrictEqual(powershellAliasFootprint.normalizedTargets, [
    path.join(tempRoot, 'evidence', 'alias-write.md')
  ])
  assert.strictEqual(powershellAliasFootprint.coverage, 'complete')
  const readOnlyFootprint = extractMutationFootprint({
    tool_name: 'exec_command',
    tool_input: { command: 'rg -n MutationFootprint hooks' }
  }, { cwd: tempRoot, hostVariant: 'codex-desktop', adapterDecision: readOnlyExec })
  assert.strictEqual(readOnlyFootprint.schemaVersion, 'MutationFootprintV2')
  assert.strictEqual(readOnlyFootprint.coverage, 'not-applicable')
  assert.deepStrictEqual(readOnlyFootprint.normalizedTargets, [])

  for (const fixture of [
    { command: 'npm install', commandClass: 'package-manager' },
    { command: 'openapi-generator generate', commandClass: 'codegen' },
    { command: 'prettier --write src', commandClass: 'formatter' },
    { command: 'vitest -u', commandClass: 'test-generator' },
    { command: 'node scripts/custom-task.js', commandClass: 'script-writer' },
    { command: 'git add hooks/runtime.cjs', commandClass: 'git-writer' }
  ]) {
    const adapter = classifyHostToolMutation({ tool_name: 'exec_command', tool_input: { command: fixture.command } })
    assert.strictEqual(adapter.operationClass, 'indirect-writer')
    assert.strictEqual(adapter.commandClass, fixture.commandClass)
    assert.strictEqual(adapter.coverage, 'partial')
    assert.strictEqual(adapter.executableAuthority, false)
    const footprint = extractMutationFootprint({ tool_name: 'exec_command', tool_input: { command: fixture.command } }, { cwd: tempRoot, adapterDecision: adapter })
    assert.strictEqual(footprint.coverage, 'unavailable')
    const denied = decideArtifactMutation({
      footprint,
      activeRoot,
      cwd: tempRoot,
      project: 'devcodex',
      formalIntent: true,
      authoritySourceRef: 'fixture:zero-target-indirect'
    })
    assert.strictEqual(denied.decisionStatus, 'forbid')
    assert(denied.errorCodes.includes('artifact-footprint-not-complete'))
    assert(denied.errorCodes.includes('artifact-target-set-empty'))
  }

  const patchFootprint = extractMutationFootprint({
    tool_name: 'apply_patch',
    tool_input: { input: `*** Begin Patch\n*** Update File: ${cp2}\n*** End Patch` }
  }, { cwd: tempRoot })
  assert.strictEqual(validateMutationFootprint(patchFootprint).valid, true)
  assert.strictEqual(patchFootprint.observability, 'complete')
  assert.deepStrictEqual(patchFootprint.targetTargets, [cp2])

  const shellFootprint = extractMutationFootprint({
    tool_name: 'powershell',
    tool_input: { command: `Set-Content -LiteralPath "${cp2}" -Value test` }
  }, { cwd: tempRoot })
  assert.strictEqual(shellFootprint.operation, 'create-or-update')
  assert.deepStrictEqual(shellFootprint.targetTargets, [cp2])
  assert.deepStrictEqual(shellFootprint.plannedModifies, [cp2])
  assert.strictEqual(shellFootprint.operationClass, 'shell')
  assert.strictEqual(shellFootprint.coverage, 'complete')

  const nodeFootprint = extractMutationFootprint({
    tool_name: 'shell_command',
    tool_input: { command: `fs.writeFileSync("${cp2}", value)` }
  }, { cwd: tempRoot })
  assert.deepStrictEqual(nodeFootprint.targetTargets, [cp2])

  const allowed = decisionFor({ tool_name: 'Edit', tool_input: { file_path: cp2 } })
  assert.strictEqual(allowed.decision.decisionStatus, 'allow', JSON.stringify(allowed.decision.errorCodes))
  assert.strictEqual(allowed.decision.schemaVersion, 'ArtifactSlotDecisionV2')
  assert.strictEqual(allowed.decision.slotId, 'bug-cp2')
  assert.strictEqual(allowed.decision.slotIds.includes('bug-cp2'), true)
  assert.strictEqual(allowed.decision.mergedRegistryDigest, layered.mergedRegistryDigest)
  assert.strictEqual(validateArtifactSlotDecision(allowed.decision).valid, true)
  const httpTarget = path.join(taskRoot, 'verify.http')
  const overlayDecision = decisionFor({ tool_name: 'Write', tool_input: { file_path: httpTarget } })
  assert.strictEqual(overlayDecision.decision.decisionStatus, 'allow', JSON.stringify(overlayDecision.decision.errorCodes))
  assert.strictEqual(overlayDecision.decision.slotId, 'fixture-task-http-verification')
  const closeout = reconcileArtifactSlotDecision(allowed.decision, {
    footprint: allowed.footprint,
    activeRoot,
    cwd: tempRoot,
    success: true
  })
  assert.strictEqual(closeout.decisionStatus, 'consumed', JSON.stringify(closeout.errorCodes))

  const reportTarget = path.join(taskRoot, 'reports', 'codex', '20260825', '07--mutation-observation.md')
  const reportAuthorization = decisionFor({ tool_name: 'Write', tool_input: { file_path: reportTarget } })
  assert.strictEqual(reportAuthorization.decision.decisionStatus, 'allow', JSON.stringify(reportAuthorization.decision.errorCodes))
  const operationId = 'fixture-observed-create'
  const reportPre = createMutationPreObservation({ operationId, footprint: reportAuthorization.footprint })
  assert.strictEqual(reportPre.observationCoverage, 'complete', JSON.stringify(reportPre.errorCodes))
  const reportLease = createTaskOwnedMutationLease({
    operationId,
    project: 'devcodex',
    taskId: 'artifact-authority-task',
    contextEpoch: 'artifact-authority-context',
    routeRevision: 'fixture-route-v1',
    owner: { ownerGeneration: 1, leaseDigest: 'a'.repeat(64) },
    decision: reportAuthorization.decision
  })
  assert.strictEqual(validateTaskOwnedMutationLease(reportLease).valid, true)
  fs.mkdirSync(path.dirname(reportTarget), { recursive: true })
  fs.writeFileSync(reportTarget, '# observed report\n')
  const reportObservation = observeMutationEffects({
    operationId,
    decision: reportAuthorization.decision,
    lease: reportLease,
    footprint: reportAuthorization.footprint,
    preObservation: reportPre,
    payload: { exitCode: 0 },
    success: true
  })
  assert.strictEqual(reportObservation.status, 'consumed', JSON.stringify(reportObservation.drift))
  assert.strictEqual(reportObservation.observedEffects.created.includes(reportTarget), true)
  assert.strictEqual(validateMutationObservationReceipt(reportObservation).valid, true)

  const noOpAuthorization = decisionFor({ tool_name: 'Edit', tool_input: { file_path: cp2 } })
  const noOpPre = createMutationPreObservation({ operationId: 'fixture-no-op', footprint: noOpAuthorization.footprint })
  const noOpLease = createTaskOwnedMutationLease({
    operationId: 'fixture-no-op',
    project: 'devcodex',
    taskId: 'artifact-authority-task',
    contextEpoch: 'artifact-authority-context',
    routeRevision: 'fixture-route-v1',
    owner: { ownerGeneration: 1, leaseDigest: 'a'.repeat(64) },
    decision: noOpAuthorization.decision
  })
  const noOpObservation = observeMutationEffects({
    operationId: 'fixture-no-op',
    decision: noOpAuthorization.decision,
    lease: noOpLease,
    footprint: noOpAuthorization.footprint,
    preObservation: noOpPre,
    payload: { exitCode: 0 },
    success: true
  })
  assert.strictEqual(noOpObservation.status, 'needs-reconcile')
  assert(noOpObservation.drift.some(item => item.startsWith('planned-modify-missing:')))

  const modifyAuthorization = decisionFor({ tool_name: 'Edit', tool_input: { file_path: cp2 } })
  const modifyPre = createMutationPreObservation({ operationId: 'fixture-modify', footprint: modifyAuthorization.footprint })
  const modifyLease = createTaskOwnedMutationLease({
    operationId: 'fixture-modify',
    project: 'devcodex',
    taskId: 'artifact-authority-task',
    contextEpoch: 'artifact-authority-context',
    routeRevision: 'fixture-route-v1',
    owner: { ownerGeneration: 1, leaseDigest: 'a'.repeat(64) },
    decision: modifyAuthorization.decision
  })
  fs.writeFileSync(cp2, '# modified fixture\n')
  const modifyObservation = observeMutationEffects({
    operationId: 'fixture-modify',
    decision: modifyAuthorization.decision,
    lease: modifyLease,
    footprint: modifyAuthorization.footprint,
    preObservation: modifyPre,
    payload: { exitCode: 0 },
    success: true
  })
  assert.strictEqual(modifyObservation.status, 'consumed', JSON.stringify(modifyObservation.drift))
  assert.strictEqual(modifyObservation.observedEffects.modified.includes(cp2), true)

  const deleteTarget = write('evidence/delete-fixture.json', '{}\n')
  const deleteAuthorization = decisionFor(
    { tool_name: 'delete_file', tool_input: { file_path: deleteTarget } }
  )
  assert.strictEqual(deleteAuthorization.decision.decisionStatus, 'allow', JSON.stringify(deleteAuthorization.decision.errorCodes))
  assert.strictEqual(deleteAuthorization.decision.errorCodes.includes('artifact-destructive-confirmation-required'), false,
    'artifact routing validates task scope; the host owns delete permission')
  const deletePre = createMutationPreObservation({ operationId: 'fixture-delete', footprint: deleteAuthorization.footprint })
  const deleteLease = createTaskOwnedMutationLease({
    operationId: 'fixture-delete',
    project: 'devcodex',
    taskId: 'artifact-authority-task',
    contextEpoch: 'artifact-authority-context',
    routeRevision: 'fixture-route-v1',
    owner: { ownerGeneration: 1, leaseDigest: 'a'.repeat(64) },
    decision: deleteAuthorization.decision
  })
  fs.unlinkSync(deleteTarget)
  const deleteObservation = observeMutationEffects({
    operationId: 'fixture-delete',
    decision: deleteAuthorization.decision,
    lease: deleteLease,
    footprint: deleteAuthorization.footprint,
    preObservation: deletePre,
    payload: { exitCode: 0 },
    success: true
  })
  assert.strictEqual(deleteObservation.status, 'consumed', JSON.stringify(deleteObservation.drift))
  assert.strictEqual(deleteObservation.observedEffects.deleted.includes(deleteTarget), true)

  const unknownSlot = path.join(taskRoot, '02-功能清单.md')
  const deniedUnknown = decisionFor({ tool_name: 'Write', tool_input: { file_path: unknownSlot } })
  assert.strictEqual(deniedUnknown.decision.decisionStatus, 'forbid')
  assert(deniedUnknown.decision.errorCodes.includes('artifact-slot-unknown'))

  const projectSource = path.join(tempRoot, 'hooks', '_runtime', 'fixture.cjs')
  const projectPackage = path.join(tempRoot, 'package.json')
  const projectDecision = decisionFor({
    tool_name: 'Write',
    tool_input: { files: [projectSource, projectPackage] }
  })
  assert.strictEqual(projectDecision.decision.decisionStatus, 'allow', JSON.stringify(projectDecision.decision.errorCodes))
  assert.deepStrictEqual(projectDecision.decision.slotIds.sort(), ['project-package-config', 'project-source'])

  const projectMutationSurfaceTargets = [
    'content/instructions.md',
    'content/skills/portfolio.json',
    'codex/README.md',
    'cursor/plugins/devcodex-workspace/.cursor-plugin/plugin.json',
    'gemini/settings.json',
    'grok/plugins/devcodex-workspace/skills/devcodex-workspace/SKILL.md',
    'host-projections/AGENTS.md',
    'public-site/components/SkillCatalog.tsx',
    'public-site/theme/index.css',
    'public-site/rspress.config.ts',
    'scripts/fixtures/contract.md',
    'index.js',
    '.gitattributes',
    '.gitignore',
    '.npmignore',
    '.npmrc',
    'plugin.json',
    'public-product-expression.json',
    'public-site/package.json',
    'RULES.md',
    'LICENSE',
    'changelogs/releases/v1.19.1.md',
    'data/templates/pending-fixes.md',
    'assets/hooks/README.md',
    'public-site/docs/reference/skills.mdx',
    'assets/icon-512.png',
    'public-site/docs/public/favicon.png',
    '.audit-state/source-candidate.json'
  ].map(relative => path.join(tempRoot, ...relative.split('/')))
  const projectMutationSurfaceDecision = decisionFor({
    tool_name: 'Write',
    tool_input: { files: projectMutationSurfaceTargets }
  })
  assert.strictEqual(
    projectMutationSurfaceDecision.decision.decisionStatus,
    'allow',
    JSON.stringify(projectMutationSurfaceDecision.decision.errorCodes)
  )
  assert.deepStrictEqual(projectMutationSurfaceDecision.decision.slotIds.sort(), [
    'project-assets',
    'project-audit-evidence',
    'project-package-config',
    'project-public-docs',
    'project-source'
  ])
  const deniedUnregisteredProjectSurface = decisionFor({
    tool_name: 'Write',
    tool_input: { files: [projectSource, path.join(tempRoot, 'vendor', 'opaque.bin')] }
  })
  assert.strictEqual(deniedUnregisteredProjectSurface.decision.decisionStatus, 'forbid')
  assert(deniedUnregisteredProjectSurface.decision.errorCodes.includes('artifact-target-mixed-scope'))

  const hostGovernanceTargets = [
    'AGENTS.md',
    'CLAUDE.md',
    'GEMINI.md',
    '.agents/devcodex/instructions.full.md',
    '.agents/skills/example/SKILL.md',
    '.github/copilot-instructions.md',
    '.claude/instructions/devcodex.md',
    '.claude/settings.json',
    '.codex/hooks.json',
    '.codex/config.toml',
    '.gemini/settings.json',
    '.gemini/hooks/_runtime/lifecycle.cjs',
    '.grok/hooks/devcodex.json',
    '.grok/devcodex/plugins/devcodex-workspace/.claude-plugin/plugin.json',
    '.cursor/hooks.json',
    '.cursor/plugins/devcodex-workspace/.cursor-plugin/plugin.json',
    '.mcp.json'
  ].map(relative => path.join(tempRoot, ...relative.split('/')))
  const hostGovernanceDecision = decisionFor({
    tool_name: 'Write',
    tool_input: { files: hostGovernanceTargets }
  })
  assert.strictEqual(
    hostGovernanceDecision.decision.decisionStatus,
    'allow',
    JSON.stringify(hostGovernanceDecision.decision.errorCodes)
  )
  assert.deepStrictEqual(hostGovernanceDecision.decision.slotIds, ['project-host-governance'])
  const deniedHostGovernanceRole = decisionFor(
    { tool_name: 'Write', tool_input: { file_path: hostGovernanceTargets[6] } },
    { authorityRole: 'workflow-owner' }
  )
  assert.strictEqual(deniedHostGovernanceRole.decision.decisionStatus, 'forbid')
  assert(deniedHostGovernanceRole.decision.errorCodes.includes('artifact-owner-required:task-owner'))

  const taskIdentity = path.join(taskRoot, '.memory', 'task.json')
  const deniedTaskIdentity = decisionFor({ tool_name: 'Write', tool_input: { file_path: taskIdentity } })
  assert.strictEqual(deniedTaskIdentity.decision.decisionStatus, 'forbid')
  assert(deniedTaskIdentity.decision.errorCodes.includes('artifact-owner-required:task-admission'))
  const admittedTaskIdentity = decisionFor(
    { tool_name: 'Write', tool_input: { file_path: taskIdentity } },
    { authorityRole: 'task-admission' }
  )
  assert.strictEqual(admittedTaskIdentity.decision.decisionStatus, 'allow', JSON.stringify(admittedTaskIdentity.decision.errorCodes))

  const legacyCp1 = write('01-问题确认-v0.1.0.md')
  const deniedLegacy = decisionFor({ tool_name: 'Edit', tool_input: { file_path: legacyCp1 } })
  assert.strictEqual(deniedLegacy.decision.decisionStatus, 'forbid')
  assert(deniedLegacy.decision.errorCodes.includes('artifact-versioned-candidate-immutable'))
  const newCp1Candidate = path.join(taskRoot, '01-问题确认-v0.2.0.md')
  const allowedCandidate = decisionFor({ tool_name: 'Write', tool_input: { file_path: newCp1Candidate } })
  assert.strictEqual(allowedCandidate.decision.decisionStatus, 'allow', JSON.stringify(allowedCandidate.decision.errorCodes))
  assert.strictEqual(allowedCandidate.decision.slotId, 'bug-cp1')

  const outside = path.join(path.dirname(tempRoot), `outside-${process.pid}.md`)
  const deniedMixed = decisionFor({
    tool_name: 'Write',
    tool_input: { files: [cp2, outside] }
  })
  assert.strictEqual(deniedMixed.decision.decisionStatus, 'forbid')
  assert(deniedMixed.decision.errorCodes.includes('ARTIFACT_TARGET_OUTSIDE_ALLOWED_ROOTS'))

  const dynamic = extractMutationFootprint({
    tool_name: 'powershell',
    tool_input: { command: 'Set-Content -Path $target -Value value' }
  }, { cwd: tempRoot })
  assert.strictEqual(dynamic.observability, 'unknown')
  assert(dynamic.ambiguityCodes.includes('dynamic-command-target'))
  const deniedDynamic = decideArtifactMutation({
    footprint: dynamic,
    activeRoot,
    cwd: tempRoot,
    project: 'devcodex',
    formalIntent: true,
    authoritySourceRef: 'fixture:formal-intent'
  })
  assert.strictEqual(deniedDynamic.decisionStatus, 'forbid')
  assert(deniedDynamic.errorCodes.includes('artifact-footprint-not-complete'))

  const moveTask = path.join(activeRoot, 'bugs', 'artifact-move-fixture')
  fs.mkdirSync(moveTask, { recursive: true })
  const legacyMoveSource = path.join(moveTask, '00-问题概述.md')
  const canonicalMoveTarget = path.join(moveTask, '00-问题概况.md')
  fs.writeFileSync(legacyMoveSource, '# legacy\n')
  const moveFootprint = extractMutationFootprint({
    tool_name: 'move_file',
    tool_input: { source_path: legacyMoveSource, target_path: canonicalMoveTarget }
  }, { cwd: tempRoot })
  const moveDecision = decideArtifactMutation({
    footprint: moveFootprint,
    activeRoot,
    cwd: tempRoot,
    project: 'devcodex',
    taskKind: 'bugs',
    taskName: 'artifact-move-fixture',
    authoritySourceRef: 'fixture:canonicalize-legacy'
  })
  assert.strictEqual(moveDecision.decisionStatus, 'allow', JSON.stringify(moveDecision.errorCodes))
  assert.strictEqual(moveDecision.operation, 'move')
  const movePre = createMutationPreObservation({ operationId: 'fixture-move', footprint: moveFootprint })
  const moveLease = createTaskOwnedMutationLease({
    operationId: 'fixture-move',
    project: 'devcodex',
    taskId: 'artifact-move-task',
    contextEpoch: 'artifact-authority-context',
    routeRevision: 'fixture-route-v1',
    owner: { ownerGeneration: 1, leaseDigest: 'b'.repeat(64) },
    decision: moveDecision
  })
  fs.renameSync(legacyMoveSource, canonicalMoveTarget)
  const moveObservation = observeMutationEffects({
    operationId: 'fixture-move',
    decision: moveDecision,
    lease: moveLease,
    footprint: moveFootprint,
    preObservation: movePre,
    payload: { exitCode: 0 },
    success: true
  })
  assert.strictEqual(moveObservation.status, 'consumed', JSON.stringify(moveObservation.drift))
  assert.deepStrictEqual(moveObservation.observedEffects.moved, [{ source: legacyMoveSource, target: canonicalMoveTarget }])

  const inventory = enumerateTaskArtifacts({ taskRoot, taskKind: 'bugs' })
  assert.strictEqual(hasTaskArtifact({ fullPath: taskRoot, kind: 'bugs' }, 'CP1'), true)
  assert.strictEqual(hasTaskArtifact({ fullPath: taskRoot, kind: 'bugs' }, 'CP2'), true)
  assert(inventory.artifacts.some(item => item.slot.slotId === 'bug-cp2' && item.relativePath === '02-修复方案.md'))
  const versionedCandidateArtifact = inventory.artifacts.find(item => item.relativePath === '01-问题确认-v0.1.0.md')
  assert.strictEqual(versionedCandidateArtifact?.matchType, 'versioned-candidate')
  assert.strictEqual(isAuthoritativeTaskArtifact(versionedCandidateArtifact), false)
  assert.strictEqual(isAuthoritativeTaskArtifact(versionedCandidateArtifact, { actualCandidateQualified: true }), true)
  assert(!inventory.conflicts.some(item => item.paths.includes('01-问题确认-v0.1.0.md')), 'legacy read aliases must not become a second active truth')

  const unknownOnly = path.join(activeRoot, 'bugs', 'unknown-only-fixture')
  fs.mkdirSync(unknownOnly, { recursive: true })
  fs.writeFileSync(path.join(unknownOnly, '02-功能清单.md'), '# unknown\n')
  const unknownInventory = enumerateTaskArtifacts({ taskRoot: unknownOnly, taskKind: 'bugs' })
  assert.deepStrictEqual(unknownInventory.unknownFormal, ['02-功能清单.md'])

  const reportOnlyTask = path.join(activeRoot, 'bugs', 'report-only-fixture')
  const reportCp1 = path.join(reportOnlyTask, 'reports', 'codex', '20260824', '01--问题确认与CP1.md')
  fs.mkdirSync(path.dirname(reportCp1), { recursive: true })
  fs.writeFileSync(reportCp1, '# report cp1\n')
  assert.strictEqual(isAuthoritativeTaskArtifact({ slot: { slotId: 'bug-cp1' }, matchType: 'report-alternative' }), false)
  assert.strictEqual(hasTaskArtifact({ fullPath: reportOnlyTask, kind: 'bugs' }, 'CP1'), false)

  const manyReports = Array.from({ length: 40 }, (_, index) => path.join(
    activeRoot,
    'reports',
    'fix',
    'codex',
    '20260824',
    `${String(index + 1).padStart(2, '0')}--fixture-${index + 1}.md`
  ))
  const manyFootprint = extractMutationFootprint({
    tool_name: 'Write',
    tool_input: { files: manyReports }
  }, { cwd: tempRoot })
  const manyDecision = decideArtifactMutation({
    footprint: manyFootprint,
    activeRoot,
    cwd: tempRoot,
    project: 'devcodex',
    authorityRole: 'workflow-owner',
    authoritySourceRef: 'fixture:many-targets'
  })
  assert.strictEqual(manyDecision.decisionStatus, 'allow', JSON.stringify(manyDecision.errorCodes))
  for (const report of manyReports) {
    fs.mkdirSync(path.dirname(report), { recursive: true })
    fs.writeFileSync(report, '# report\n')
  }
  const compact = compactLifecycleStateV5({
    turnLiveness: {
      state: 'running',
      turnKey: 'fixture-turn',
      inFlightOperation: {
        operationId: 'fixture-many-targets',
        toolName: 'Write',
        startedAt: new Date().toISOString(),
        mutating: true,
        targetPaths: manyReports,
        artifactDecision: manyDecision
      },
      checkpoint: { phase: 'tool:Write', artifactPaths: manyReports },
      checkpointValidation: null,
      lastMutationCloseout: null
    }
  }).state
  assert.strictEqual(compact.turnLiveness.inFlightOperation.artifactDecision.projectionKind, 'digest-only')
  const compactCloseout = reconcileArtifactSlotDecision(
    compact.turnLiveness.inFlightOperation.artifactDecision,
    { footprint: manyFootprint, activeRoot, cwd: tempRoot, success: true }
  )
  assert.strictEqual(compactCloseout.decisionStatus, 'consumed', JSON.stringify(compactCloseout.errorCodes))

  assert(fs.existsSync(overview) && fs.existsSync(cp1))
  process.stdout.write('test-artifact-mutation-authority: ok\n')
} finally {
  if (process.env.DEVCODEX_KEEP_TEST_ARTIFACTS === '1') {
    process.stdout.write(`[test-artifact-mutation-authority] retained ${tempRoot}\n`)
  } else {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}
