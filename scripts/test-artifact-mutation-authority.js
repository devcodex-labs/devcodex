'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  classifyHostToolMutation,
  isServerOwnedAuthorityControlToolName,
  isServerOwnedMemoryTransactionToolName,
  validateHostToolMutationAdapterDecision
} = require('../hooks/_runtime/host-tool-mutation-adapters.cjs')
const {
  extractMutationFootprint,
  validateMutationFootprint
} = require('../hooks/_runtime/mutation-footprint.cjs')
const {
  classifyRelativeTarget,
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
  snapshotMutationTargets,
  validateMutationObservationReceipt,
  validateTaskOwnedMutationLease
} = require('../hooks/_runtime/mutation-observation.cjs')
const {
  applyArtifactMutationReconciliation,
  createArtifactMutationReconciliationInput,
  createArtifactMutationReconciliationReceipt,
  projectArtifactMutationReconciliationReceipt,
  validateArtifactMutationReconciliationEvidence,
  validateArtifactMutationReconciliationInput,
  validateArtifactMutationReconciliationReceipt
} = require('../hooks/_runtime/artifact-mutation-reconciliation.cjs')
const { compactLifecycleStateV5 } = require('../hooks/_runtime/lifecycle-state-projection-v5.cjs')
const { sha256, stableStringify } = require('../hooks/_runtime/content-identity.cjs')
const {
  createArtifactTemplateBinding,
  projectArtifactTemplateBinding,
  qualifyArtifactContent,
  qualifyArtifactFile,
  validateArtifactTemplateBinding,
  validateArtifactTemplateBindingProjection,
  validateArtifactTemplateQualification
} = require('../hooks/_runtime/artifact-template-contract.cjs')

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

function digest(value) {
  return sha256(Buffer.from(stableStringify(value), 'utf8'))
}

function artifactFromTemplateBinding(binding, suffix = '') {
  const lines = []
  const columns = []
  for (const semanticId of binding.requiredSemanticIds || []) {
    if (semanticId === 'document-title') lines.push('# Fixture artifact')
    else if (semanticId.startsWith('heading:')) lines.push(`## ${semanticId.slice('heading:'.length).replace(/-/g, ' ')}`)
    else if (semanticId.startsWith('table-column:')) columns.push(semanticId.slice('table-column:'.length).replace(/-/g, ' '))
  }
  if (columns.length) {
    lines.push(`| ${columns.join(' | ')} |`)
    lines.push(`| ${columns.map(() => '---').join(' | ')} |`)
    lines.push(`| ${columns.map(() => 'fixture').join(' | ')} |`)
  }
  if (suffix) lines.push('', suffix)
  return `${lines.join('\n')}\n`
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
      destructivePolicy: 'confirm'
    }]
  }
  fs.writeFileSync(overlayPath, JSON.stringify(safeOverlay, null, 2))
  const layered = readLayeredArtifactSlotRegistry({ activeRoot, project: 'devcodex' })
  assert.strictEqual(layered.schemaVersion, 'LayeredArtifactSlotRegistryV2')
  assert.strictEqual(layered.slots.some(slot => slot.slotId === 'fixture-task-http-verification'), true)
  assert.strictEqual(
    layered.slots.find(slot => slot.slotId === 'fixture-task-http-verification').destructivePolicy,
    'confirm',
    'unprotected overlay slots must delegate operation permission to the host'
  )
  assert.match(layered.mergedRegistryDigest, /^[a-f0-9]{64}$/)
  const cp1Report = classifyRelativeTarget(
    `bugs/${taskName}/reports/codex/20260827/01--CP1根因与推荐方案.md`,
    layered
  )
  assert.strictEqual(cp1Report.slot?.slotId, 'bug-cp1')
  assert.strictEqual(cp1Report.matchType, 'report-alternative')
  const legacyP0Requirement = classifyRelativeTarget(
    'requirements/fixture-requirement/01-P0任务连续性需求确认.md',
    layered
  )
  assert.strictEqual(legacyP0Requirement.slot?.slotId, 'requirement-cp1')
  assert.strictEqual(legacyP0Requirement.matchType, 'legacy-read')
  const baseRegistry = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'hooks', '_runtime', 'artifact-slot-registry.v2.json'),
    'utf8'
  ))
  assert.strictEqual(baseRegistry.projectMutationCoverageContract, 'tracked-product-surfaces-v1')
  assert.strictEqual(baseRegistry.protectedConstraints.operationPermissionOwner, 'host')
  assert(baseRegistry.slots.find(slot => slot.slotId === 'bug-cp2')?.canonicalNames.includes('02-技术方案.md'))
  assert(baseRegistry.slots.find(slot => slot.slotId === 'plan-review-pr1')?.canonicalNames.includes('03-方案复审-PR1.md'))
  assert(baseRegistry.slots.filter(slot => slot.templateRef).every(slot =>
    slot.templateValidator === 'artifact-template-contract' &&
    slot.requiredSemanticIds === undefined && slot.extensionPoints === undefined
  ), 'the registry may route templates but must not duplicate their semantic truth')
  const cp2TemplateSlot = baseRegistry.slots.find(slot => slot.slotId === 'bug-cp2')
  const producerBinding = createArtifactTemplateBinding({
    slot: cp2TemplateSlot,
    target: cp2,
    intent: 'fix',
    bindingMode: 'producer-supplied'
  })
  assert.strictEqual(validateArtifactTemplateBinding(producerBinding).valid, true)
  const producerProjection = projectArtifactTemplateBinding(producerBinding)
  assert.strictEqual(validateArtifactTemplateBindingProjection(producerProjection).valid, true)
  const validTemplateArtifact = artifactFromTemplateBinding(producerBinding, '## 受控扩展\n\n扩展不能替代模板必需语义。')
  const validTemplateQualification = qualifyArtifactContent(producerBinding, validTemplateArtifact, {
    slotId: 'bug-cp2', target: cp2, readbackVerified: true, requireReadback: true
  })
  assert.strictEqual(validTemplateQualification.status, 'qualified', JSON.stringify(validTemplateQualification.errorCodes))
  assert.strictEqual(validateArtifactTemplateQualification(validTemplateQualification, producerBinding).valid, true)
  assert(validTemplateQualification.observedExtensions.includes('heading:受控扩展'))
  const missingTemplateQualification = qualifyArtifactContent(producerBinding, '# Fixture artifact\n', {
    slotId: 'bug-cp2', target: cp2, readbackVerified: true, requireReadback: true
  })
  assert.strictEqual(missingTemplateQualification.status, 'rejected')
  assert(missingTemplateQualification.errorCodes.some(item => item.startsWith('artifact-template-required-semantic-missing:')))
  const requiredHeadings = producerBinding.requiredSemanticIds.filter(item => item.startsWith('heading:'))
  const reorderedTemplateArtifact = artifactFromTemplateBinding(producerBinding)
    .replace(`## ${requiredHeadings[0].slice(8)}`, '## __FIRST__')
    .replace(`## ${requiredHeadings[1].slice(8)}`, `## ${requiredHeadings[0].slice(8)}`)
    .replace('## __FIRST__', `## ${requiredHeadings[1].slice(8)}`)
  const reorderedQualification = qualifyArtifactContent(producerBinding, reorderedTemplateArtifact, {
    slotId: 'bug-cp2', target: cp2, readbackVerified: true, requireReadback: true
  })
  assert.strictEqual(reorderedQualification.status, 'rejected')
  assert(reorderedQualification.errorCodes.includes('artifact-template-required-order-invalid'))
  const wrongSlotQualification = qualifyArtifactContent(producerBinding, artifactFromTemplateBinding(producerBinding), {
    slotId: 'requirement-cp1', target: cp2, readbackVerified: true, requireReadback: true
  })
  assert(wrongSlotQualification.errorCodes.includes('artifact-template-wrong-slot'))
  const noReadbackQualification = qualifyArtifactContent(producerBinding, artifactFromTemplateBinding(producerBinding), {
    slotId: 'bug-cp2', target: cp2, readbackVerified: false, requireReadback: true
  })
  assert(noReadbackQualification.errorCodes.includes('artifact-template-readback-required'))
  const artifactPath = path.join(tempRoot, 'stable-template-artifact.md')
  fs.writeFileSync(artifactPath, artifactFromTemplateBinding(producerBinding), 'utf8')
  const fileBinding = createArtifactTemplateBinding({
    slot: cp2TemplateSlot,
    target: artifactPath,
    intent: 'fix'
  })
  let fstatCount = 0
  const templateDriftFs = Object.assign({}, fs, {
    fstatSync(descriptor) {
      const observed = fs.fstatSync(descriptor)
      fstatCount += 1
      return fstatCount === 2 ? { ...observed, mtimeMs: observed.mtimeMs + 1 } : observed
    }
  })
  const driftingReadback = qualifyArtifactFile(fileBinding, artifactPath, {
    slotId: 'bug-cp2', target: artifactPath
  }, { fs: templateDriftFs })
  assert.strictEqual(driftingReadback.status, 'rejected')
  assert.strictEqual(driftingReadback.readbackVerified, false)
  assert(driftingReadback.errorCodes.includes('artifact-template-readback-drift'))
  let artifactLstatCount = 0
  const replacedArtifactPathFs = Object.assign({}, fs, {
    lstatSync(target) {
      const observed = fs.lstatSync(target)
      artifactLstatCount += 1
      return artifactLstatCount === 2 ? { ...observed, ino: observed.ino + 1 } : observed
    }
  })
  const replacedPathReadback = qualifyArtifactFile(fileBinding, artifactPath, {
    slotId: 'bug-cp2', target: artifactPath
  }, { fs: replacedArtifactPathFs })
  assert.strictEqual(replacedPathReadback.status, 'rejected')
  assert.strictEqual(replacedPathReadback.readbackVerified, false)
  assert(replacedPathReadback.errorCodes.includes('artifact-template-readback-drift'))
  let templateLstatCount = 0
  const replacedTemplatePathFs = Object.assign({}, fs, {
    lstatSync(target) {
      const observed = fs.lstatSync(target)
      templateLstatCount += 1
      return templateLstatCount === 2 ? { ...observed, ino: observed.ino + 1 } : observed
    }
  })
  assert.throws(
    () => createArtifactTemplateBinding({
      slot: cp2TemplateSlot,
      target: artifactPath,
      intent: 'fix'
    }, { fs: replacedTemplatePathFs }),
    error => error?.code === 'ARTIFACT_TEMPLATE_SOURCE_DRIFT',
    'template binding must reject a source path replaced after the descriptor is opened'
  )
  const isolatedRuntime = path.join(tempRoot, 'isolated-template-runtime')
  const isolatedTemplate = path.join(isolatedRuntime, 'content', 'prompts', 'technical-design.prompt.md')
  fs.mkdirSync(path.dirname(isolatedTemplate), { recursive: true })
  fs.copyFileSync(path.join(__dirname, '..', 'content', 'prompts', 'technical-design.prompt.md'), isolatedTemplate)
  const staleBinding = createArtifactTemplateBinding({
    slot: cp2TemplateSlot,
    target: cp2,
    intent: 'fix'
  }, { runtimeRoot: isolatedRuntime })
  fs.appendFileSync(isolatedTemplate, '\n<!-- fixture drift -->\n')
  const staleQualification = qualifyArtifactContent(staleBinding, artifactFromTemplateBinding(staleBinding), {
    slotId: 'bug-cp2', target: cp2, readbackVerified: true, requireReadback: true
  }, { runtimeRoot: isolatedRuntime })
  assert.strictEqual(staleQualification.status, 'rejected')
  assert(staleQualification.errorCodes.includes('artifact-template-stale-digest'))
  assert.throws(
    () => createArtifactTemplateBinding({ slot: cp2TemplateSlot, target: cp2 }, { runtimeRoot: path.join(tempRoot, 'missing-template-runtime') }),
    error => error?.code === 'ARTIFACT_TEMPLATE_SOURCE_MISSING'
  )
  fs.writeFileSync(overlayPath, JSON.stringify({
    ...safeOverlay,
    slots: [{ ...safeOverlay.slots[0], destructivePolicy: 'forbid' }]
  }, null, 2))
  assert.throws(
    () => readLayeredArtifactSlotRegistry({ activeRoot, project: 'devcodex' }),
    error => error?.code === 'ARTIFACT_SLOT_REGISTRY_OVERLAY_INVALID' && error.details.some(item => item.includes('overlay-slot-policy'))
  )
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
      tool_name: 'mcp__devcodex-profile__profile_load',
      tool_input: { files: ['02-架构约束.md'], contextBinding: { activeRoot } }
    },
    {
      tool_name: 'devcodex-profile-profile_load',
      tool_input: { files: ['02-架构约束.md'], contextBinding: { activeRoot } }
    },
    {
      tool_name: 'mcp__devcodex_memory__memory_session_read',
      tool_input: { path: path.join(activeRoot, '.memory', 'clients', 'codex', 'SUMMARY.md') }
    },
    {
      tool_name: 'mcp__devcodex-memory__memory_artifact_link_project',
      tool_input: { documentPath: 'reports/analysis/fixture.md', artifacts: ['reports/analysis/evidence.json'] }
    },
    {
      tool_name: 'devcodex-memory-memory_artifact_link_project',
      tool_input: { documentPath: 'reports/analysis/fixture.md', artifacts: ['reports/analysis/evidence.json'] }
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
  const qualifiedNames = leaf => [
    leaf,
    `mcp__devcodex_memory__${leaf}`,
    `mcp__devcodex-memory__${leaf}`,
    `devcodex-memory/${leaf}`,
    `devcodex-memory__${leaf}`,
    `devcodex-memory-${leaf}`
  ]
  for (const leaf of ['memory_session_allocate', 'memory_session_write', 'memory_summary_append', 'memory_cp_confirm']) {
    for (const toolName of qualifiedNames(leaf)) {
      const qualifiedMemoryWrite = classifyHostToolMutation({
        tool_name: toolName,
        tool_input: { sessionId: '01', content: 'fixture' }
      }, { hostVariant: 'codex-cli' })
      assert.strictEqual(qualifiedMemoryWrite.adapterId, 'host-controlled-logical-write-v1', toolName)
      assert.strictEqual(qualifiedMemoryWrite.mutationCandidate, true, toolName)
      assert.strictEqual(qualifiedMemoryWrite.coverage, 'complete', toolName)
      assert.strictEqual(qualifiedMemoryWrite.targetStrategy, 'controlled-logical-target', toolName)
      assert.strictEqual(isServerOwnedMemoryTransactionToolName(toolName), true, toolName)
    }
  }
  for (const leaf of [
    'memory_task_admit_v2',
    'memory_task_write_owner',
    'memory_task_fast_path_lease',
    'memory_workflow_operational_write_lease',
    'memory_task_terminal_v1',
    'memory_task_closeout_reconcile_v1',
    'memory_artifact_mutation_reconcile_v1'
  ]) {
    for (const toolName of qualifiedNames(leaf)) {
      assert.strictEqual(isServerOwnedAuthorityControlToolName(toolName), true, toolName)
      assert.strictEqual(isServerOwnedMemoryTransactionToolName(toolName), false, toolName)
    }
  }
  assert.strictEqual(isServerOwnedAuthorityControlToolName('mcp__third_party__memory_task_admit_v2'), false)
  assert.strictEqual(isServerOwnedMemoryTransactionToolName('memory_artifact_link_project'), false)
  const thirdPartyLinkProjection = classifyHostToolMutation({
    tool_name: 'mcp__third_party__memory_artifact_link_project',
    tool_input: { documentPath: 'reports/analysis/fixture.md' }
  })
  assert.strictEqual(thirdPartyLinkProjection.mutationCandidate, true)
  assert.strictEqual(thirdPartyLinkProjection.coverage, 'unavailable')
  for (const reservedLeaf of ['memory_session_allocate', 'memory_task_admit_v2']) {
    const unverifiedReservedTool = classifyHostToolMutation({
      tool_name: `mcp__third_party__${reservedLeaf}`,
      tool_input: {}
    })
    assert.strictEqual(unverifiedReservedTool.operationClass, 'unknown', reservedLeaf)
    assert.strictEqual(unverifiedReservedTool.mutationCandidate, true, reservedLeaf)
    assert.strictEqual(unverifiedReservedTool.coverage, 'unavailable', reservedLeaf)
    assert(unverifiedReservedTool.ambiguityCodes.includes('devcodex-server-identity-unverified'), reservedLeaf)
  }
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
  const suppliedDecision = decisionFor(
    { tool_name: 'Edit', tool_input: { file_path: cp2 } },
    { templateBindings: [producerBinding] }
  )
  assert.strictEqual(suppliedDecision.decision.decisionStatus, 'allow', JSON.stringify(suppliedDecision.decision.errorCodes))
  assert.strictEqual(suppliedDecision.decision.templateBindings[0].bindingDigest, producerBinding.bindingDigest)
  assert.strictEqual(suppliedDecision.decision.templateBindings[0].bindingMode, 'producer-supplied')
  const httpTarget = path.join(taskRoot, 'verify.http')
  const overlayDecision = decisionFor({ tool_name: 'Write', tool_input: { file_path: httpTarget } })
  assert.strictEqual(overlayDecision.decision.decisionStatus, 'allow', JSON.stringify(overlayDecision.decision.errorCodes))
  assert.strictEqual(overlayDecision.decision.slotId, 'fixture-task-http-verification')
  fs.writeFileSync(cp2, artifactFromTemplateBinding(allowed.decision.templateBindings[0]), 'utf8')
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
  fs.writeFileSync(reportTarget, artifactFromTemplateBinding(reportAuthorization.decision.templateBindings[0]), 'utf8')
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
  fs.writeFileSync(cp2, artifactFromTemplateBinding(modifyAuthorization.decision.templateBindings[0], 'modified fixture'), 'utf8')
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

  const hostOwnedTaskDeleteCases = [
    ['task-source-material', write('03-问题原文-删除探针.md')],
    ['task-decision', write('decisions/delete-probe.json', '{}\n')]
  ]
  for (const [slotId, target] of hostOwnedTaskDeleteCases) {
    const deletion = decisionFor({
      tool_name: 'delete_file',
      tool_input: { file_path: target }
    })
    assert.strictEqual(deletion.decision.decisionStatus, 'allow',
      `${slotId}: ${JSON.stringify(deletion.decision.errorCodes)}`)
    assert.deepStrictEqual(deletion.decision.slotIds, [slotId])
    assert.strictEqual(deletion.decision.slotDecisions[0].destructivePolicy, 'confirm')
  }

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
  const hostOwnedProjectDeleteCases = [
    ['project-source', 'hooks/_runtime/delete-fixture.cjs', 'task-owner'],
    ['project-package-config', 'package.json', 'task-owner'],
    ['project-host-governance', 'AGENTS.md', 'task-owner'],
    ['project-public-docs', 'RULES.md', 'task-owner'],
    ['project-assets', 'assets/delete-fixture.png', 'task-owner'],
    ['project-audit-evidence', '.audit-state/delete-fixture.json', 'task-owner'],
    ['project-release-artifact', 'artifacts/delete-fixture.tgz', 'release-owner']
  ]
  for (const [slotId, relative, authorityRole] of hostOwnedProjectDeleteCases) {
    const deletion = decisionFor({
      tool_name: 'delete_file',
      tool_input: { file_path: path.join(tempRoot, ...relative.split('/')) }
    }, { authorityRole })
    assert.strictEqual(deletion.decision.decisionStatus, 'allow',
      `${slotId}: ${JSON.stringify(deletion.decision.errorCodes)}`)
    assert.deepStrictEqual(deletion.decision.slotIds, [slotId])
    assert.strictEqual(deletion.decision.slotDecisions[0].destructivePolicy, 'confirm')
  }
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
  fs.writeFileSync(legacyMoveSource, artifactFromTemplateBinding(moveDecision.templateBindings[0]), 'utf8')
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

  const manyReports = Array.from({ length: 12 }, (_, index) => path.join(
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
    const binding = manyDecision.templateBindings.find(item => path.resolve(item.targetRef) === path.resolve(report))
    fs.writeFileSync(report, artifactFromTemplateBinding(binding), 'utf8')
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

  const reconciliationTarget = cp2
  const reconciliationBeforeDecision = decisionFor({ tool_name: 'Edit', tool_input: { file_path: reconciliationTarget } })
  fs.writeFileSync(reconciliationTarget, artifactFromTemplateBinding(reconciliationBeforeDecision.decision.templateBindings[0], 'reconciliation before'), 'utf8')
  const reconciliationFootprint = extractMutationFootprint({
    tool_name: 'Write',
    tool_input: { file_path: reconciliationTarget, content: '# reconciliation after\n' }
  }, { cwd: tempRoot })
  const reconciliationDecision = decideArtifactMutation({
    footprint: reconciliationFootprint,
    activeRoot,
    projectRoot: tempRoot,
    cwd: tempRoot,
    project: 'devcodex',
    taskRecoveryKey: '11111111-1111-4111-8111-111111111111',
    contextEpoch: 'artifact-reconciliation-context',
    intent: 'fix',
    taskKind: 'bugs',
    taskName,
    authoritySourceRef: 'fixture:artifact-reconciliation'
  })
  const reconciliationPre = createMutationPreObservation({
    operationId: 'fixture-reconciliation',
    footprint: reconciliationFootprint
  })
  const reconciliationLease = createTaskOwnedMutationLease({
    operationId: 'fixture-reconciliation',
    project: 'devcodex',
    taskId: '11111111-1111-4111-8111-111111111111',
    contextEpoch: 'artifact-reconciliation-context',
    routeRevision: 'c'.repeat(64),
    owner: { ownerGeneration: 1, leaseDigest: 'd'.repeat(64) },
    decision: reconciliationDecision
  })
  fs.writeFileSync(reconciliationTarget, artifactFromTemplateBinding(reconciliationDecision.templateBindings[0], 'reconciliation after'), 'utf8')
  const failedObservation = observeMutationEffects({
    operationId: 'fixture-reconciliation',
    decision: reconciliationDecision,
    lease: reconciliationLease,
    footprint: reconciliationFootprint,
    preObservation: reconciliationPre,
    payload: { isError: true },
    success: false
  })
  assert.strictEqual(failedObservation.status, 'needs-reconcile')
  assert.strictEqual(failedObservation.observationCoverage, 'complete')
  const failedReconciliationInput = createArtifactMutationReconciliationInput({
    operationId: 'fixture-reconciliation',
    footprint: reconciliationFootprint,
    preObservation: reconciliationPre,
    templateBindings: reconciliationDecision.templateBindings
  })
  const failedLifecycleCloseout = {
    schemaVersion: 'LifecycleMutationCloseoutV2',
    operationId: 'fixture-reconciliation',
    toolName: 'Write',
    completedAt: failedObservation.completedAt,
    result: 'needs-reconcile',
    authorizationErrors: ['task-mutation-lease-expired'],
    observation: failedObservation,
    artifactCloseout: failedObservation.closeout,
    reconciliationInput: failedReconciliationInput
  }
  const reconciliationReceipt = createArtifactMutationReconciliationReceipt({
    lifecycleCloseout: failedLifecycleCloseout,
    operationId: 'fixture-reconciliation',
    expectedCloseoutDigest: failedObservation.closeout.closeoutDigest,
    resolution: 'accept-observed-effects',
    sourceKind: 'primary',
    activeRoot,
    projectRoot: tempRoot,
    project: 'devcodex',
    taskId: '11111111-1111-4111-8111-111111111111',
    ingress: {
      envelopeDigest: '1'.repeat(64),
      decisionDigest: '2'.repeat(64),
      routeRevision: '3'.repeat(64),
      projectTargetLeaseDigest: '4'.repeat(64),
      hostSessionDigest: '5'.repeat(64)
    }
  })
  assert.strictEqual(validateArtifactMutationReconciliationReceipt(reconciliationReceipt, {
    operationId: 'fixture-reconciliation',
    priorCloseoutDigest: failedObservation.closeout.closeoutDigest,
    priorObservationReceiptDigest: failedObservation.receiptDigest
  }).valid, true)
  const reconciledState = applyArtifactMutationReconciliation({
    turnLiveness: { inFlightOperation: { operationId: 'fixture-reconciliation', mutating: true } },
    simpleTaskFastPathLeaseCloseout: { operationId: 'fixture-reconciliation', status: 'needs-reconcile' },
    workflowOperationalWriteLeaseCloseout: { operationId: 'fixture-reconciliation', status: 'needs-reconcile' }
  }, failedLifecycleCloseout, reconciliationReceipt)
  assert.strictEqual(reconciledState.turnLiveness.lastMutationCloseout.result, 'reconciled')
  assert.strictEqual(reconciledState.turnLiveness.inFlightOperation, null)
  assert.strictEqual(reconciledState.simpleTaskFastPathLeaseCloseout.status, 'reconciled')
  assert.strictEqual(reconciledState.workflowOperationalWriteLeaseCloseout.status, 'reconciled')
  const unrelatedInFlightState = applyArtifactMutationReconciliation({
    turnLiveness: {
      inFlightOperation: { operationId: 'newer-unrelated-operation', mutating: true }
    }
  }, failedLifecycleCloseout, reconciliationReceipt)
  assert.strictEqual(
    unrelatedInFlightState.turnLiveness.inFlightOperation.operationId,
    'newer-unrelated-operation',
    'reconciling one closeout must never clear a different in-flight operation'
  )
  const compactReconciliation = projectArtifactMutationReconciliationReceipt(reconciliationReceipt)
  assert.strictEqual(validateArtifactMutationReconciliationEvidence(compactReconciliation, {
    operationId: 'fixture-reconciliation',
    priorCloseoutDigest: failedObservation.closeout.closeoutDigest,
    priorObservationReceiptDigest: failedObservation.receiptDigest
  }).valid, true)
  const duplicateReceipt = JSON.parse(JSON.stringify(reconciliationReceipt))
  duplicateReceipt.recoveredObservedEffects.modified = [reconciliationTarget, reconciliationTarget]
  duplicateReceipt.recoveredObservedEffectsDigest = digest(duplicateReceipt.recoveredObservedEffects)
  delete duplicateReceipt.receiptDigest
  duplicateReceipt.receiptDigest = digest(duplicateReceipt)
  assert.strictEqual(
    validateArtifactMutationReconciliationReceipt(duplicateReceipt).valid,
    false,
    'a digest-valid receipt must reject duplicate recovered scalar effects'
  )
  const oversizedProjection = JSON.parse(JSON.stringify(compactReconciliation))
  oversizedProjection.recoveredObservedEffects.modified = Array(25).fill(reconciliationTarget)
  oversizedProjection.recoveredObservedEffectsDigest = digest(oversizedProjection.recoveredObservedEffects)
  delete oversizedProjection.projectionDigest
  oversizedProjection.projectionDigest = digest(oversizedProjection)
  assert.strictEqual(
    validateArtifactMutationReconciliationEvidence(oversizedProjection).valid,
    false,
    'a digest-valid cold projection must reject raw recovered-effect arrays above the contract limit'
  )
  const reserveReconciliationReceipt = createArtifactMutationReconciliationReceipt({
    lifecycleCloseout: failedLifecycleCloseout,
    operationId: 'fixture-reconciliation',
    expectedCloseoutDigest: failedObservation.closeout.closeoutDigest,
    resolution: 'accept-observed-effects',
    sourceKind: 'emergency-reserve',
    reserveSequence: 7,
    reserveRecordDigest: '6'.repeat(64),
    activeRoot,
    projectRoot: tempRoot,
    project: 'devcodex',
    taskId: '11111111-1111-4111-8111-111111111111',
    ingress: {
      envelopeDigest: '1'.repeat(64),
      decisionDigest: '2'.repeat(64),
      routeRevision: '3'.repeat(64),
      projectTargetLeaseDigest: '4'.repeat(64),
      hostSessionDigest: '5'.repeat(64)
    }
  })
  assert.strictEqual(reserveReconciliationReceipt.sourceKind, 'emergency-reserve')
  assert.strictEqual(reserveReconciliationReceipt.reserveSequence, 7)
  assert.strictEqual(validateArtifactMutationReconciliationReceipt(reserveReconciliationReceipt).valid, true)

  const partialOperationId = 'fixture-partial-reobservation'
  const partialFootprint = extractMutationFootprint({
    tool_name: 'Write',
    tool_input: { file_path: reconciliationTarget, content: '# partial after\n' }
  }, { cwd: tempRoot })
  const partialDecision = decideArtifactMutation({
    footprint: partialFootprint,
    activeRoot,
    projectRoot: tempRoot,
    cwd: tempRoot,
    project: 'devcodex',
    taskRecoveryKey: '11111111-1111-4111-8111-111111111111',
    contextEpoch: 'artifact-reconciliation-context',
    intent: 'fix',
    taskKind: 'bugs',
    taskName,
    authoritySourceRef: 'fixture:partial-reobservation'
  })
  const partialPre = createMutationPreObservation({ operationId: partialOperationId, footprint: partialFootprint })
  const partialLease = createTaskOwnedMutationLease({
    operationId: partialOperationId,
    project: 'devcodex',
    taskId: '11111111-1111-4111-8111-111111111111',
    contextEpoch: 'artifact-reconciliation-context',
    routeRevision: '7'.repeat(64),
    owner: { ownerGeneration: 1, leaseDigest: '8'.repeat(64) },
    decision: partialDecision
  })
  const partialReconciliationInput = createArtifactMutationReconciliationInput({
    operationId: partialOperationId,
    footprint: partialFootprint,
    preObservation: partialPre,
    templateBindings: partialDecision.templateBindings
  })
  fs.writeFileSync(reconciliationTarget, artifactFromTemplateBinding(partialDecision.templateBindings[0], 'partial after'), 'utf8')
  const partialFs = new Proxy(fs, {
    get(target, property) {
      if (property === 'lstatSync') {
        return value => {
          if (path.resolve(String(value)) === path.resolve(reconciliationTarget)) {
            throw Object.assign(new Error('fixture transient observation failure'), { code: 'EACCES' })
          }
          return target.lstatSync(value)
        }
      }
      const value = target[property]
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
  const partialObservation = observeMutationEffects({
    operationId: partialOperationId,
    decision: partialDecision,
    lease: partialLease,
    footprint: partialFootprint,
    preObservation: partialPre,
    payload: { isError: true },
    success: false
  }, { fs: partialFs })
  assert.strictEqual(partialObservation.observationCoverage, 'partial')
  const partialLifecycleCloseout = {
    schemaVersion: 'LifecycleMutationCloseoutV2',
    operationId: partialOperationId,
    toolName: 'Write',
    completedAt: partialObservation.completedAt,
    result: 'needs-reconcile',
    authorizationErrors: ['mutation-tool-reported-failure'],
    observation: partialObservation,
    artifactCloseout: partialObservation.closeout,
    reconciliationInput: partialReconciliationInput
  }
  const partialReceipt = createArtifactMutationReconciliationReceipt({
    lifecycleCloseout: partialLifecycleCloseout,
    operationId: partialOperationId,
    expectedCloseoutDigest: partialObservation.closeout.closeoutDigest,
    resolution: 'accept-observed-effects',
    activeRoot,
    projectRoot: tempRoot,
    project: 'devcodex',
    taskId: '11111111-1111-4111-8111-111111111111',
    ingress: {
      envelopeDigest: '1'.repeat(64), decisionDigest: '2'.repeat(64), routeRevision: '3'.repeat(64),
      projectTargetLeaseDigest: '4'.repeat(64), hostSessionDigest: '5'.repeat(64)
    }
  })
  assert.strictEqual(partialReceipt.recoveryMode, 'reobserved-from-preflight')
  assert.deepStrictEqual(partialReceipt.recoveredObservedEffects.modified, [reconciliationTarget])
  assert.strictEqual(validateArtifactMutationReconciliationReceipt(partialReceipt).valid, true)
  const exactExtraInput = JSON.parse(JSON.stringify(partialReconciliationInput))
  exactExtraInput.preObservation.entries.push({
    path: path.join(tempRoot, 'unplanned-exact-target.md'),
    exists: false,
    kind: 'missing',
    digest: null,
    bytes: 0,
    complete: true
  })
  exactExtraInput.preObservation.snapshotDigest = digest({
    entries: exactExtraInput.preObservation.entries,
    coverage: 'complete',
    errorCodes: []
  })
  delete exactExtraInput.preObservation.receiptDigest
  exactExtraInput.preObservation.receiptDigest = digest(exactExtraInput.preObservation)
  delete exactExtraInput.inputDigest
  exactExtraInput.inputDigest = digest(exactExtraInput)
  const exactExtraValidation = validateArtifactMutationReconciliationInput(exactExtraInput)
  assert.strictEqual(exactExtraValidation.valid, false)
  assert(exactExtraValidation.errors.includes('artifact-reconciliation-input-preobservation-exact-target-set'))

  const controlledOutsideInput = JSON.parse(JSON.stringify(partialReconciliationInput))
  controlledOutsideInput.footprint.observationPlan.targetGranularity = 'controlled-root'
  delete controlledOutsideInput.footprint.projectionDigest
  controlledOutsideInput.footprint.projectionDigest = digest(controlledOutsideInput.footprint)
  controlledOutsideInput.preObservation.entries.push({
    path: path.join(path.dirname(tempRoot), 'controlled-root-outside.md'),
    exists: false,
    kind: 'missing',
    digest: null,
    bytes: 0,
    complete: true
  })
  controlledOutsideInput.preObservation.snapshotDigest = digest({
    entries: controlledOutsideInput.preObservation.entries,
    coverage: 'complete',
    errorCodes: []
  })
  delete controlledOutsideInput.preObservation.receiptDigest
  controlledOutsideInput.preObservation.receiptDigest = digest(controlledOutsideInput.preObservation)
  delete controlledOutsideInput.inputDigest
  controlledOutsideInput.inputDigest = digest(controlledOutsideInput)
  const controlledOutsideValidation = validateArtifactMutationReconciliationInput(controlledOutsideInput)
  assert.strictEqual(controlledOutsideValidation.valid, false)
  assert(controlledOutsideValidation.errors.includes('artifact-reconciliation-input-preobservation-controlled-root-scope'))

  const controlledRoot = path.join(tempRoot, 'controlled-observation-root')
  const nestedControlledFile = path.join(controlledRoot, 'nested', 'deep.txt')
  fs.mkdirSync(path.dirname(nestedControlledFile), { recursive: true })
  fs.writeFileSync(nestedControlledFile, 'nested-controlled-root\n')
  const controlledSnapshot = snapshotMutationTargets({
    plannedModifies: [controlledRoot],
    plannedCreates: [],
    plannedDeletes: [],
    plannedMoves: [],
    sourceTargets: [controlledRoot],
    targetTargets: [controlledRoot],
    observationPlan: { targetGranularity: 'controlled-root' }
  })
  assert.strictEqual(controlledSnapshot.coverage, 'complete', JSON.stringify(controlledSnapshot.errorCodes))
  assert(controlledSnapshot.entries.some(entry => path.resolve(entry.path) === path.resolve(nestedControlledFile)),
    'controlled-root recursion must observe real nested descendants')

  let fstatReads = 0
  const driftingFs = new Proxy(fs, {
    get(target, property) {
      if (property === 'fstatSync') {
        return descriptor => {
          const stat = target.fstatSync(descriptor)
          fstatReads += 1
          if (fstatReads === 2) {
            return new Proxy(stat, {
              get(value, key) {
                if (key === 'ctimeMs') return value.ctimeMs + 1
                const member = value[key]
                return typeof member === 'function' ? member.bind(value) : member
              }
            })
          }
          return stat
        }
      }
      const value = target[property]
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
  const driftingSnapshot = snapshotMutationTargets({
    plannedModifies: [nestedControlledFile],
    observationPlan: { targetGranularity: 'exact-target' }
  }, { fs: driftingFs })
  assert.strictEqual(driftingSnapshot.coverage, 'partial')
  assert(driftingSnapshot.errorCodes.includes('mutation-observation-file-drift'))
  const tamperedRecoveryInput = JSON.parse(JSON.stringify(partialReconciliationInput))
  tamperedRecoveryInput.footprint.plannedModifies = [path.join(tempRoot, 'tampered-target.md')]
  delete tamperedRecoveryInput.footprint.projectionDigest
  tamperedRecoveryInput.footprint.projectionDigest = digest(tamperedRecoveryInput.footprint)
  delete tamperedRecoveryInput.inputDigest
  tamperedRecoveryInput.inputDigest = digest(tamperedRecoveryInput)
  assert.strictEqual(
    validateArtifactMutationReconciliationInput(tamperedRecoveryInput).valid,
    false,
    'a recomputed projection digest cannot hide planned-set or pre-observation target drift'
  )
  const substitutedTarget = path.join(tempRoot, 'substituted-recovery-target.md')
  const substitutedFootprint = extractMutationFootprint({
    tool_name: 'Write',
    tool_input: { file_path: substitutedTarget, content: '# substituted\n' }
  }, { cwd: tempRoot })
  const substitutedPre = createMutationPreObservation({
    operationId: partialOperationId,
    footprint: substitutedFootprint
  })
  const substitutedCloseout = {
    ...partialLifecycleCloseout,
    reconciliationInput: createArtifactMutationReconciliationInput({
      operationId: partialOperationId,
      footprint: substitutedFootprint,
      preObservation: substitutedPre
    })
  }
  assert.throws(
    () => createArtifactMutationReconciliationReceipt({
      lifecycleCloseout: substitutedCloseout,
      operationId: partialOperationId,
      expectedCloseoutDigest: partialObservation.closeout.closeoutDigest,
      resolution: 'accept-observed-effects',
      activeRoot,
      projectRoot: tempRoot,
      project: 'devcodex',
      taskId: '11111111-1111-4111-8111-111111111111',
      ingress: {
        envelopeDigest: '1'.repeat(64), decisionDigest: '2'.repeat(64), routeRevision: '3'.repeat(64),
        projectTargetLeaseDigest: '4'.repeat(64), hostSessionDigest: '5'.repeat(64)
      }
    }),
    error => error.code === 'ARTIFACT_RECONCILIATION_INPUT_INVALID' &&
      error.details?.errors?.includes('artifact-reconciliation-input-planned-set-binding'),
    'partial recovery must bind its durable preflight target set to the pending observation'
  )
  const outsideTarget = path.join(path.dirname(tempRoot), `${path.basename(tempRoot)}-outside-recovery.md`)
  const outsideFootprint = extractMutationFootprint({
    tool_name: 'Write',
    tool_input: { file_path: outsideTarget, content: '# outside\n' }
  }, { cwd: tempRoot })
  const outsideInput = createArtifactMutationReconciliationInput({
    operationId: partialOperationId,
    footprint: outsideFootprint,
    preObservation: createMutationPreObservation({
      operationId: partialOperationId,
      footprint: outsideFootprint
    })
  })
  const outsideObservation = JSON.parse(JSON.stringify(partialObservation))
  outsideObservation.plannedSetDigest = outsideFootprint.plannedSetDigest
  delete outsideObservation.receiptDigest
  delete outsideObservation.decisionStatus
  delete outsideObservation.closeout
  outsideObservation.receiptDigest = digest(outsideObservation)
  outsideObservation.decisionStatus = outsideObservation.status
  const outsideCloseout = {
    ...partialObservation.closeout,
    observationReceiptDigest: outsideObservation.receiptDigest
  }
  delete outsideCloseout.closeoutDigest
  outsideCloseout.closeoutDigest = digest(outsideCloseout)
  outsideObservation.closeout = outsideCloseout
  assert.throws(
    () => createArtifactMutationReconciliationReceipt({
      lifecycleCloseout: {
        schemaVersion: 'LifecycleMutationCloseoutV2',
        operationId: partialOperationId,
        toolName: 'Write',
        completedAt: outsideObservation.completedAt,
        result: 'needs-reconcile',
        authorizationErrors: ['mutation-tool-reported-failure'],
        observation: outsideObservation,
        artifactCloseout: outsideCloseout,
        reconciliationInput: outsideInput
      },
      operationId: partialOperationId,
      expectedCloseoutDigest: outsideCloseout.closeoutDigest,
      resolution: 'accept-observed-effects',
      activeRoot,
      projectRoot: tempRoot,
      project: 'devcodex',
      taskId: '11111111-1111-4111-8111-111111111111',
      ingress: {
        envelopeDigest: '1'.repeat(64), decisionDigest: '2'.repeat(64), routeRevision: '3'.repeat(64),
        projectTargetLeaseDigest: '4'.repeat(64), hostSessionDigest: '5'.repeat(64)
      }
    }),
    error => error.code === 'ARTIFACT_RECONCILIATION_PATH_OUTSIDE_ROOT',
    'partial re-observation must reject every target outside the bound roots before filesystem readback'
  )

  const zeroOperationId = 'fixture-zero-effect-reobservation'
  const zeroFootprint = extractMutationFootprint({
    tool_name: 'Write',
    tool_input: { file_path: reconciliationTarget, content: '# never written\n' }
  }, { cwd: tempRoot })
  const zeroDecision = decideArtifactMutation({
    footprint: zeroFootprint,
    activeRoot,
    projectRoot: tempRoot,
    cwd: tempRoot,
    project: 'devcodex',
    taskRecoveryKey: '11111111-1111-4111-8111-111111111111',
    contextEpoch: 'artifact-reconciliation-context',
    intent: 'fix',
    taskKind: 'bugs',
    taskName,
    authoritySourceRef: 'fixture:zero-effect-reobservation'
  })
  const zeroPre = createMutationPreObservation({ operationId: zeroOperationId, footprint: zeroFootprint })
  const zeroLease = createTaskOwnedMutationLease({
    operationId: zeroOperationId,
    project: 'devcodex',
    taskId: '11111111-1111-4111-8111-111111111111',
    contextEpoch: 'artifact-reconciliation-context',
    routeRevision: '7'.repeat(64),
    owner: { ownerGeneration: 1, leaseDigest: '8'.repeat(64) },
    decision: zeroDecision
  })
  const zeroObservation = observeMutationEffects({
    operationId: zeroOperationId,
    decision: zeroDecision,
    lease: zeroLease,
    footprint: zeroFootprint,
    preObservation: zeroPre,
    payload: { isError: true },
    success: false
  })
  assert.strictEqual(zeroObservation.observationCoverage, 'complete')
  assert.deepStrictEqual(zeroObservation.observedEffects, { created: [], modified: [], deleted: [], moved: [] })
  const zeroReceipt = createArtifactMutationReconciliationReceipt({
    lifecycleCloseout: {
      schemaVersion: 'LifecycleMutationCloseoutV2',
      operationId: zeroOperationId,
      toolName: 'Write',
      completedAt: zeroObservation.completedAt,
      result: 'needs-reconcile',
      authorizationErrors: ['mutation-tool-reported-failure'],
      observation: zeroObservation,
      artifactCloseout: zeroObservation.closeout,
      reconciliationInput: createArtifactMutationReconciliationInput({
        operationId: zeroOperationId,
        footprint: zeroFootprint,
        preObservation: zeroPre
      })
    },
    operationId: zeroOperationId,
    expectedCloseoutDigest: zeroObservation.closeout.closeoutDigest,
    resolution: 'accept-observed-effects',
    activeRoot,
    projectRoot: tempRoot,
    project: 'devcodex',
    taskId: '11111111-1111-4111-8111-111111111111',
    ingress: {
      envelopeDigest: '1'.repeat(64), decisionDigest: '2'.repeat(64), routeRevision: '3'.repeat(64),
      projectTargetLeaseDigest: '4'.repeat(64), hostSessionDigest: '5'.repeat(64)
    }
  })
  assert.strictEqual(zeroReceipt.recoveryMode, 'reobserved-from-preflight')
  assert.deepStrictEqual(zeroReceipt.recoveredObservedEffects, { created: [], modified: [], deleted: [], moved: [] })
  assert.strictEqual(validateArtifactMutationReconciliationReceipt(zeroReceipt).valid, true)
  assert.throws(
    () => createArtifactMutationReconciliationReceipt({
      lifecycleCloseout: failedLifecycleCloseout,
      operationId: 'fixture-reconciliation',
      expectedCloseoutDigest: 'f'.repeat(64),
      resolution: 'accept-observed-effects',
      activeRoot,
      projectRoot: tempRoot,
      project: 'devcodex',
      taskId: '11111111-1111-4111-8111-111111111111',
      ingress: {
        envelopeDigest: '1'.repeat(64), decisionDigest: '2'.repeat(64), routeRevision: '3'.repeat(64),
        projectTargetLeaseDigest: '4'.repeat(64), hostSessionDigest: '5'.repeat(64)
      }
    }),
    error => error.code === 'ARTIFACT_RECONCILIATION_CAS_MISMATCH'
  )
  fs.unlinkSync(reconciliationTarget)
  assert.throws(
    () => createArtifactMutationReconciliationReceipt({
      lifecycleCloseout: failedLifecycleCloseout,
      operationId: 'fixture-reconciliation',
      expectedCloseoutDigest: failedObservation.closeout.closeoutDigest,
      resolution: 'accept-observed-effects',
      activeRoot,
      projectRoot: tempRoot,
      project: 'devcodex',
      taskId: '11111111-1111-4111-8111-111111111111',
      ingress: {
        envelopeDigest: '1'.repeat(64), decisionDigest: '2'.repeat(64), routeRevision: '3'.repeat(64),
        projectTargetLeaseDigest: '4'.repeat(64), hostSessionDigest: '5'.repeat(64)
      }
    }),
    error => error.code === 'ARTIFACT_RECONCILIATION_EFFECT_MISSING'
  )

  assert(fs.existsSync(overview) && fs.existsSync(cp1))
  process.stdout.write('test-artifact-mutation-authority: ok\n')
} finally {
  if (process.env.DEVCODEX_KEEP_TEST_ARTIFACTS === '1') {
    process.stdout.write(`[test-artifact-mutation-authority] retained ${tempRoot}\n`)
  } else {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}
