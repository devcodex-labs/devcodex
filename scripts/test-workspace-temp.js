#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  resolveWorkspaceTempBackupRoot,
  resolveWorkspaceTempProject,
  resolveWorkspaceTempRoot
} = require('./lib/workspace-temp-layout.js')
const {
  ensureWorkspaceTempPartitions,
  findWorkspaceTempRootForPath,
  inspectWorkspaceTemp,
  prepareWorkspaceTempBackupRoot,
  pruneWorkspaceTemp,
  registerWorkspaceTempArtifactAtRoot,
  registerWorkspaceTempBackup
} = require('./lib/workspace-temp.js')
const { findWorkspaceNamespaceTempLeaks } = require('./lib/validate-governance-support.js')

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-workspace-temp-'))

function write(file, content = 'fixture\n') {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content, 'utf8')
}

try {
  const unmarkedFixtureRoot = path.join(fixtureRoot, 'unmarked-active-root')
  assert.strictEqual(
    resolveWorkspaceTempRoot(unmarkedFixtureRoot),
    path.join(unmarkedFixtureRoot, '.tmp', 'devcodex')
  )

  const legacyProject = path.join(fixtureRoot, 'legacy-app')
  write(path.join(legacyProject, 'package.json'), '{"name":"legacy-app"}\n')
  const legacyRoot = path.join(legacyProject, '.tmp', 'devcodex')
  assert.strictEqual(resolveWorkspaceTempRoot(legacyProject), legacyRoot)
  assert.strictEqual(resolveWorkspaceTempRoot(path.join(legacyProject, 'src', 'nested')), legacyRoot)
  assert.strictEqual(resolveWorkspaceTempRoot(path.join(legacyProject, '.devcodex')), legacyRoot)
  assert.strictEqual(resolveWorkspaceTempRoot(path.join(legacyProject, '.devcodex', 'requirements', 'demo')), legacyRoot)
  assert.strictEqual(resolveWorkspaceTempProject(legacyProject), 'legacy-app')
  assert.strictEqual(
    resolveWorkspaceTempBackupRoot(legacyProject),
    path.join(legacyRoot, 'backups', 'legacy-app')
  )
  const legacyOldRoot = path.join(legacyProject, '.devcodex', '.tmp')
  write(path.join(legacyOldRoot, 'legacy.txt'))
  assert.deepStrictEqual(findWorkspaceNamespaceTempLeaks(legacyProject).leaks, [legacyOldRoot])
  fs.rmSync(legacyOldRoot, { recursive: true, force: true })

  const workspace = path.join(fixtureRoot, 'workspace')
  const project = path.join(workspace, 'apps', 'api')
  write(path.join(workspace, '.devcodex', 'layout.json'), JSON.stringify({ mode: 'workspace-namespace' }) + '\n')
  write(path.join(project, 'package.json'), '{"name":"api"}\n')
  const centralRoot = path.join(workspace, '.tmp', 'devcodex')
  assert.strictEqual(resolveWorkspaceTempRoot(project), centralRoot)
  assert.strictEqual(resolveWorkspaceTempRoot(workspace), centralRoot)
  assert.strictEqual(resolveWorkspaceTempRoot(path.join(workspace, '.devcodex', 'apps', 'api')), centralRoot)
  assert.strictEqual(resolveWorkspaceTempProject(project), 'apps/api')
  assert.strictEqual(
    resolveWorkspaceTempProject(path.join(workspace, '.devcodex', 'apps', 'api', 'requirements', 'demo')),
    'apps/api'
  )
  assert.strictEqual(resolveWorkspaceTempBackupRoot(project), path.join(centralRoot, 'backups', 'apps', 'api'))
  assert.strictEqual(
    resolveWorkspaceTempBackupRoot(path.join(workspace, '.devcodex', 'apps', 'api', 'requirements', 'demo')),
    path.join(centralRoot, 'backups', 'apps', 'api')
  )
  assert.strictEqual(prepareWorkspaceTempBackupRoot(project), path.join(centralRoot, 'backups', 'apps', 'api'))
  assert.strictEqual(findWorkspaceTempRootForPath(path.join(centralRoot, 'backups', 'apps', 'api', 'snapshot')), centralRoot)
  const nestedCanonicalBackup = path.join(
    centralRoot,
    'backups',
    '.tmp',
    'devcodex',
    'release-candidate',
    'workspace',
    'grok-user-config.toml.bak'
  )
  write(nestedCanonicalBackup, '[plugins]\n')
  assert.strictEqual(findWorkspaceTempRootForPath(nestedCanonicalBackup), centralRoot)
  const nestedBackupRegistration = registerWorkspaceTempBackup(nestedCanonicalBackup, {
    owner: 'devcodex-grok-adapter',
    producer: 'grok-plugin-uninstall'
  })
  assert.ok(nestedBackupRegistration)
  assert.strictEqual(path.dirname(nestedBackupRegistration.manifestPath), path.join(centralRoot, 'manifests'))
  assert.strictEqual(findWorkspaceTempRootForPath(path.join(workspace, '.devcodex', 'workspace', '.tmp', 'backups', 'snapshot')), null)
  assert.throws(
    () => registerWorkspaceTempArtifactAtRoot(centralRoot, {
      artifactId: 'partition-root',
      type: 'run',
      owner: 'workspace-temp-test',
      project: 'apps/api',
      producer: 'test-runner',
      targetPath: path.join(centralRoot, 'runs')
    }),
    /WORKSPACE_TEMP_PARTITION_ROOT_RESERVED/
  )

  const externalSpool = path.join(workspace, '.devcodex', '.tmp.drivedownload', 'snapshot')
  const externalWorkspaceRoot = path.join(workspace, '.tmp-external')
  const siblingProducer = path.join(workspace, '.tmp', 'other-producer', 'cache')
  fs.mkdirSync(path.join(externalSpool, 'profile'), { recursive: true })
  fs.mkdirSync(path.join(externalSpool, '.tmp'), { recursive: true })
  fs.mkdirSync(externalWorkspaceRoot, { recursive: true })
  fs.mkdirSync(siblingProducer, { recursive: true })
  const initialLeakInspection = findWorkspaceNamespaceTempLeaks(workspace, { fs, path })
  assert.deepStrictEqual(initialLeakInspection.leaks, [])
  assert.deepStrictEqual(initialLeakInspection.externalRoots, [])
  assert.strictEqual(initialLeakInspection.truncated, false)
  const centralLegacyLeak = path.join(workspace, '.devcodex', 'workspace', 'audit-tmp')
  const oldCentralRoot = path.join(workspace, '.devcodex', 'workspace', '.tmp')
  const runtimeRootLegacyLeak = path.join(workspace, '.devcodex', '.tmp')
  const orphanNamespaceLegacyLeak = path.join(workspace, '.devcodex', 'orphan', '.tmp')
  const namespaceLegacyRoot = path.join(workspace, '.devcodex', 'apps', 'api')
  const namespaceLegacyLeak = path.join(namespaceLegacyRoot, '.tmp-run')
  const taskLegacyLeak = path.join(namespaceLegacyRoot, 'requirements', 'demo', '.tmp')
  const physicalLegacyRoot = path.join(workspace, 'physical-app')
  const physicalLegacyLeak = path.join(physicalLegacyRoot, '.devcodex', 'temp')
  fs.mkdirSync(centralLegacyLeak, { recursive: true })
  fs.mkdirSync(oldCentralRoot, { recursive: true })
  fs.mkdirSync(runtimeRootLegacyLeak, { recursive: true })
  fs.mkdirSync(orphanNamespaceLegacyLeak, { recursive: true })
  fs.mkdirSync(path.join(namespaceLegacyRoot, 'profile'), { recursive: true })
  fs.mkdirSync(namespaceLegacyLeak, { recursive: true })
  fs.mkdirSync(taskLegacyLeak, { recursive: true })
  fs.mkdirSync(physicalLegacyLeak, { recursive: true })
  const leakInspection = findWorkspaceNamespaceTempLeaks(workspace, { fs, path })
  assert.deepStrictEqual(
    leakInspection.leaks.map(item => path.relative(workspace, item).replace(/\\/g, '/')).sort(),
    [
      '.devcodex/.tmp',
      '.devcodex/apps/api/.tmp-run',
      '.devcodex/apps/api/requirements/demo/.tmp',
      '.devcodex/orphan/.tmp',
      '.devcodex/workspace/.tmp',
      '.devcodex/workspace/audit-tmp',
      'physical-app/.devcodex/temp'
    ]
  )
  assert.deepStrictEqual(leakInspection.errors, [])
  fs.rmSync(centralLegacyLeak, { recursive: true, force: true })
  fs.rmSync(oldCentralRoot, { recursive: true, force: true })
  fs.rmSync(runtimeRootLegacyLeak, { recursive: true, force: true })
  fs.rmSync(path.join(workspace, '.devcodex', 'orphan'), { recursive: true, force: true })
  fs.rmSync(path.join(workspace, '.devcodex', 'apps'), { recursive: true, force: true })
  fs.rmSync(physicalLegacyRoot, { recursive: true, force: true })

  const expiredTarget = path.join(centralRoot, 'runs', 'apps', 'api', 'test-runner', 'expired-run')
  write(path.join(expiredTarget, 'result.txt'))
  const expiredRegistration = registerWorkspaceTempArtifactAtRoot(centralRoot, {
    artifactId: 'expired-run',
    type: 'run',
    owner: 'workspace-temp-test',
    project: 'apps/api',
    producer: 'test-runner',
    targetPath: expiredTarget,
    createdAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-08-02T00:00:00.000Z'
  })
  const expiredManifest = JSON.parse(fs.readFileSync(expiredRegistration.manifestPath, 'utf8'))
  assert.strictEqual(expiredManifest.targetIdentity?.schemaVersion, 'WorkspaceTempTargetIdentityV1')
  assert.ok(expiredManifest.targetIdentity?.device)
  assert.ok(expiredManifest.targetIdentity?.inode)

  const replacedTarget = path.join(centralRoot, 'runs', 'apps', 'api', 'test-runner', 'replaced-run')
  write(path.join(replacedTarget, 'registered.txt'), 'registered object\n')
  const replacedRegistration = registerWorkspaceTempArtifactAtRoot(centralRoot, {
    artifactId: 'replaced-run',
    type: 'run',
    owner: 'workspace-temp-test',
    project: 'apps/api',
    producer: 'test-runner',
    targetPath: replacedTarget,
    createdAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-08-02T00:00:00.000Z'
  })
  fs.rmSync(replacedTarget, { recursive: true, force: true })
  write(path.join(replacedTarget, 'replacement.txt'), 'replacement object must survive\n')
  assert.throws(
    () => registerWorkspaceTempArtifactAtRoot(centralRoot, {
      artifactId: 'expired-run',
      type: 'run',
      owner: 'conflicting-owner',
      project: 'apps/api',
      producer: 'test-runner',
      targetPath: expiredTarget
    }),
    /WORKSPACE_TEMP_ARTIFACT_ID_CONFLICT/
  )
  assert.throws(
    () => registerWorkspaceTempArtifactAtRoot(centralRoot, {
      artifactId: 'escape-attempt',
      type: 'run',
      owner: 'workspace-temp-test',
      project: 'apps/api',
      producer: 'test-runner',
      targetPath: path.join(fixtureRoot, 'outside.txt')
    }),
    /WORKSPACE_TEMP_PATH_ESCAPE/
  )
  const externalReparseTarget = path.join(fixtureRoot, 'external-reparse-target')
  write(path.join(externalReparseTarget, 'outside.txt'), 'outside\n')
  const reparseParent = path.join(centralRoot, 'runs', 'reparse-parent')
  fs.mkdirSync(path.dirname(reparseParent), { recursive: true })
  fs.symlinkSync(externalReparseTarget, reparseParent, process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(
    () => registerWorkspaceTempArtifactAtRoot(centralRoot, {
      artifactId: 'reparse-escape',
      type: 'run',
      owner: 'workspace-temp-test',
      project: 'apps/api',
      producer: 'test-runner',
      targetPath: path.join(reparseParent, 'outside.txt')
    }),
    /WORKSPACE_TEMP_PATH_UNSAFE: reparse-ancestor/
  )
  const unsafeTempRoot = path.join(fixtureRoot, 'unsafe-temp-root')
  fs.symlinkSync(externalReparseTarget, unsafeTempRoot, process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => ensureWorkspaceTempPartitions(unsafeTempRoot), /WORKSPACE_TEMP_ROOT_REPARSE/)
  const unsafePartitionRoot = path.join(fixtureRoot, 'unsafe-partition-root')
  fs.mkdirSync(unsafePartitionRoot, { recursive: true })
  fs.symlinkSync(externalReparseTarget, path.join(unsafePartitionRoot, 'backups'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => ensureWorkspaceTempPartitions(unsafePartitionRoot), /WORKSPACE_TEMP_PARTITION_REPARSE/)
  assert.throws(
    () => registerWorkspaceTempArtifactAtRoot(centralRoot, {
      artifactId: 'invalid artifact id',
      type: 'run',
      owner: 'workspace-temp-test',
      project: 'apps/api',
      producer: 'test-runner',
      targetPath: expiredTarget
    }),
    /WORKSPACE_TEMP_ARTIFACT_ID_INVALID/
  )

  const leasedTarget = path.join(centralRoot, 'cache', 'test-runner', 'active-cache')
  write(path.join(leasedTarget, 'cache.bin'))
  registerWorkspaceTempArtifactAtRoot(centralRoot, {
    artifactId: 'active-cache',
    type: 'cache',
    owner: 'workspace-temp-test',
    project: 'apps/api',
    producer: 'test-runner',
    targetPath: leasedTarget,
    createdAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-08-02T00:00:00.000Z',
    leaseId: 'active-cache-lease'
  })
  write(path.join(centralRoot, 'leases', 'active-cache-lease.json'), JSON.stringify({
    schemaVersion: 'WorkspaceTempLeaseV1',
    expiresAt: '2026-09-01T00:00:00.000Z'
  }) + '\n')

  const expiredLeaseTarget = path.join(centralRoot, 'runs', 'apps', 'api', 'test-runner', 'expired-lease-run')
  const expiredLeasePath = path.join(centralRoot, 'leases', 'expired-run-lease.json')
  write(path.join(expiredLeaseTarget, 'result.txt'))
  registerWorkspaceTempArtifactAtRoot(centralRoot, {
    artifactId: 'expired-lease-run',
    type: 'run',
    owner: 'workspace-temp-test',
    project: 'apps/api',
    producer: 'test-runner',
    targetPath: expiredLeaseTarget,
    createdAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-08-02T00:00:00.000Z',
    leaseId: 'expired-run-lease'
  })
  write(expiredLeasePath, JSON.stringify({
    schemaVersion: 'WorkspaceTempLeaseV1',
    expiresAt: '2026-08-02T00:00:00.000Z'
  }) + '\n')

  const sharedLeasePath = path.join(centralRoot, 'leases', 'shared-expired-lease.json')
  write(sharedLeasePath, JSON.stringify({
    schemaVersion: 'WorkspaceTempLeaseV1',
    expiresAt: '2026-08-02T00:00:00.000Z'
  }) + '\n')
  for (const artifactId of ['shared-lease-a', 'shared-lease-b']) {
    const targetPath = path.join(centralRoot, 'cache', 'test-runner', artifactId)
    write(path.join(targetPath, 'cache.bin'))
    registerWorkspaceTempArtifactAtRoot(centralRoot, {
      artifactId,
      type: 'cache',
      owner: 'workspace-temp-test',
      project: 'apps/api',
      producer: 'test-runner',
      targetPath,
      createdAt: '2026-08-01T00:00:00.000Z',
      expiresAt: '2026-08-02T00:00:00.000Z',
      leaseId: 'shared-expired-lease'
    })
  }

  const invalidLeaseTarget = path.join(centralRoot, 'cache', 'test-runner', 'invalid-lease')
  write(path.join(invalidLeaseTarget, 'cache.bin'))
  registerWorkspaceTempArtifactAtRoot(centralRoot, {
    artifactId: 'invalid-lease',
    type: 'cache',
    owner: 'workspace-temp-test',
    project: 'apps/api',
    producer: 'test-runner',
    targetPath: invalidLeaseTarget,
    createdAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-08-02T00:00:00.000Z',
    leaseId: 'invalid-lease-schema'
  })
  write(path.join(centralRoot, 'leases', 'invalid-lease-schema.json'), JSON.stringify({
    expiresAt: '2026-09-01T00:00:00.000Z'
  }) + '\n')

  const incompleteBackup = path.join(centralRoot, 'backups', 'apps', 'api', 'tx-incomplete', 'config.bak')
  write(incompleteBackup)
  registerWorkspaceTempArtifactAtRoot(centralRoot, {
    artifactId: 'incomplete-backup',
    type: 'backup',
    owner: 'workspace-temp-test',
    project: 'apps/api',
    producer: 'test-runner',
    targetPath: incompleteBackup,
    createdAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-08-02T00:00:00.000Z',
    transactionStatus: 'in-progress'
  })

  const lockedTarget = path.join(centralRoot, 'quarantine', 'locked-artifact')
  fs.mkdirSync(path.join(lockedTarget, 'directory.lock'), { recursive: true })
  registerWorkspaceTempArtifactAtRoot(centralRoot, {
    artifactId: 'locked-artifact',
    type: 'quarantine',
    owner: 'workspace-temp-test',
    project: 'apps/api',
    producer: 'test-runner',
    targetPath: lockedTarget,
    createdAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-08-02T00:00:00.000Z'
  })
  const orphan = path.join(centralRoot, 'runs', 'orphan.txt')
  write(orphan)
  const overlapRoot = path.join(centralRoot, 'runs', 'apps', 'api', 'overlap')
  const overlapChild = path.join(overlapRoot, 'child.txt')
  write(overlapChild)
  for (const input of [
    { artifactId: 'overlap-parent', targetPath: overlapRoot },
    { artifactId: 'overlap-child', targetPath: overlapChild }
  ]) {
    registerWorkspaceTempArtifactAtRoot(centralRoot, {
      ...input,
      type: 'run',
      owner: 'workspace-temp-test',
      project: 'apps/api',
      producer: 'test-runner',
      createdAt: '2026-08-01T00:00:00.000Z',
      expiresAt: '2026-08-02T00:00:00.000Z'
    })
  }
  const unknownPartition = path.join(centralRoot, 'local-scripts', 'manual.ps1')
  write(unknownPartition)
  const reportedLegacyRoot = path.join(workspace, '.devcodex', 'apps', 'api', 'release-tmp')
  const reportedTaskLegacyRoot = path.join(workspace, '.devcodex', 'apps', 'api', 'requirements', 'demo', '.tmp')
  const reportedOldCanonicalRoot = path.join(workspace, '.devcodex', 'workspace', '.tmp')
  fs.mkdirSync(path.join(workspace, '.devcodex', 'apps', 'api', 'profile'), { recursive: true })
  write(path.join(reportedLegacyRoot, 'legacy.txt'))
  write(path.join(reportedTaskLegacyRoot, 'legacy.txt'))
  write(path.join(reportedOldCanonicalRoot, 'legacy.txt'))
  write(path.join(centralRoot, 'leases', 'orphan-lease.json'), JSON.stringify({ expiresAt: '2026-09-01T00:00:00.000Z' }) + '\n')
  write(path.join(centralRoot, 'manifests', 'README.txt'), 'invalid manifest entry\n')
  write(path.join(centralRoot, 'manifests', 'oversized.json'), ' '.repeat(65 * 1024))
  const outsideSentinel = path.join(fixtureRoot, 'outside-sentinel.txt')
  write(outsideSentinel, 'must survive\n')
  write(path.join(centralRoot, 'manifests', 'escape-manifest.json'), JSON.stringify({
    schemaVersion: 'WorkspaceTempManifestV1',
    artifactId: 'escape-manifest',
    type: 'run',
    owner: 'workspace-temp-test',
    project: 'apps/api',
    producer: 'test-runner',
    targetPath: outsideSentinel,
    createdAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-08-02T00:00:00.000Z',
    cleanupPolicy: 'delete',
    transactionStatus: 'not-applicable',
    leaseId: null
  }) + '\n')
  write(path.join(centralRoot, 'manifests', 'forged-partition-root.json'), JSON.stringify({
    schemaVersion: 'WorkspaceTempManifestV1',
    artifactId: 'forged-partition-root',
    type: 'run',
    owner: 'workspace-temp-test',
    project: 'apps/api',
    producer: 'test-runner',
    targetPath: path.join(centralRoot, 'runs'),
    createdAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-08-02T00:00:00.000Z',
    cleanupPolicy: 'delete',
    transactionStatus: 'not-applicable',
    leaseId: null
  }) + '\n')

  const nowMs = Date.parse('2026-08-13T00:00:00.000Z')
  const bounded = inspectWorkspaceTemp(project, nowMs, { maxEntries: 8 })
  assert.strictEqual(bounded.totals.truncated, true)
  assert.ok(bounded.totals.observedEntries <= bounded.totals.maxEntries)
  const boundedApply = pruneWorkspaceTemp(project, { apply: true, nowMs, maxEntries: 8 })
  assert.strictEqual(boundedApply.removed.length, 0)
  assert.ok(boundedApply.failed.some(item => item.errorCode === 'WORKSPACE_TEMP_INSPECTION_TRUNCATED'))
  assert.ok(fs.existsSync(expiredTarget), 'truncated apply must fail closed before deleting candidates')

  const status = inspectWorkspaceTemp(project, nowMs)
  assert.strictEqual(status.schemaVersion, 'WorkspaceTempStatusV1')
  assert.deepStrictEqual(status.candidates.map(item => item.artifactId).sort(), ['expired-lease-run', 'expired-run'])
  assert.ok(status.blocked.some(item => item.artifactId === 'active-cache' && item.reasons.includes('active-lease')))
  assert.ok(status.blocked.some(item => item.artifactId === 'shared-lease-a' && item.reasons.includes('lease-overlap')))
  assert.ok(status.blocked.some(item => item.artifactId === 'shared-lease-b' && item.reasons.includes('lease-overlap')))
  assert.ok(status.blocked.some(item => item.artifactId === 'invalid-lease' && item.reasons.includes('invalid-lease')))
  assert.ok(status.blocked.some(item => item.artifactId === 'replaced-run' && item.reasons.includes('target-instance-changed')))
  assert.ok(status.blocked.some(item => item.artifactId === 'incomplete-backup' && item.reasons.includes('backup-transaction-incomplete')))
  assert.ok(status.blocked.some(item => item.artifactId === 'locked-artifact' && item.reasons.includes('lock-present')))
  assert.ok(status.blocked.some(item => item.targetPath === orphan && item.reasons.includes('unknown-owner')))
  assert.ok(status.blocked.some(item => item.targetPath === path.join(centralRoot, 'local-scripts') && item.reasons.includes('unknown-partition')))
  assert.ok(status.legacyRoots.some(item => item.root === reportedLegacyRoot))
  assert.ok(status.legacyRoots.some(item => item.root === reportedTaskLegacyRoot))
  assert.ok(status.legacyRoots.some(item => item.root === reportedOldCanonicalRoot))
  assert.deepStrictEqual(status.externalRoots, [])
  assert.ok(!status.blocked.some(item => item.targetPath === externalWorkspaceRoot))
  assert.ok(!status.blocked.some(item => item.targetPath === siblingProducer))
  assert.ok(status.blocked.some(item => item.targetPath === reportedLegacyRoot && item.reasons.includes('legacy-project-temp-root')))
  assert.ok(status.blocked.some(item => item.targetPath === reportedTaskLegacyRoot && item.reasons.includes('legacy-project-temp-root')))
  assert.ok(status.blocked.some(item => item.artifactId === 'escape-manifest' && item.reasons.includes('path-escape')))
  assert.ok(status.blocked.some(item => item.artifactId === 'forged-partition-root' && item.reasons.includes('partition-root-reserved')))
  assert.ok(status.blocked.some(item => item.artifactId === 'overlap-parent' && item.reasons.includes('ownership-overlap')))
  assert.ok(status.blocked.some(item => item.artifactId === 'overlap-child' && item.reasons.includes('ownership-overlap')))
  assert.ok(status.blocked.some(item => item.targetPath === path.join(centralRoot, 'leases', 'orphan-lease.json') && item.reasons.includes('unknown-lease-owner')))
  assert.ok(status.blocked.some(item => item.targetPath === path.join(centralRoot, 'manifests', 'README.txt') && item.reasons.includes('invalid-manifest-entry')))
  assert.ok(status.blocked.some(item => item.manifestPath === path.join(centralRoot, 'manifests', 'oversized.json') && item.reasons.includes('manifest-too-large')))

  const preview = pruneWorkspaceTemp(project, { nowMs })
  assert.strictEqual(preview.mode, 'dry-run')
  assert.ok(fs.existsSync(expiredTarget), 'dry-run must not delete eligible artifacts')
  const applied = pruneWorkspaceTemp(project, { apply: true, nowMs })
  assert.strictEqual(applied.failed.length, 0)
  assert.deepStrictEqual(applied.removed.map(item => item.artifactId).sort(), ['expired-lease-run', 'expired-run'])
  assert.ok(!fs.existsSync(expiredTarget), 'apply must delete the inspected manifest-owned expired target')
  assert.ok(!fs.existsSync(expiredLeaseTarget), 'apply must delete an expired artifact with an explicitly expired lease')
  assert.ok(!fs.existsSync(expiredLeasePath), 'apply must remove the consumed expired lease instead of leaving an orphan')
  assert.ok(fs.existsSync(sharedLeasePath), 'shared leases must remain blocked')
  assert.ok(fs.existsSync(leasedTarget), 'active lease must block deletion')
  assert.ok(fs.existsSync(incompleteBackup), 'incomplete backup must block deletion')
  assert.ok(fs.existsSync(replacedTarget), 'a replacement object at a registered path must never be deleted')
  assert.ok(fs.existsSync(replacedRegistration.manifestPath), 'replacement-object ownership manifest must remain blocked')
  assert.ok(fs.existsSync(lockedTarget), 'lock marker must block deletion')
  assert.ok(fs.existsSync(orphan), 'unknown owner must block deletion')
  assert.ok(fs.existsSync(reportedLegacyRoot), 'legacy project temp roots are report-only and must never be auto-deleted')
  assert.ok(fs.existsSync(reportedTaskLegacyRoot), 'legacy task temp roots are report-only and must never be auto-deleted')
  assert.ok(fs.existsSync(overlapRoot), 'overlapping ownership must block deletion')
  assert.ok(fs.existsSync(outsideSentinel), 'path escape manifest must never delete outside the canonical temp root')

  process.stdout.write('workspace temp lifecycle test passed\n')
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
}
