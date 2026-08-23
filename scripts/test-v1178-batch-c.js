'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
  LEGACY_MANIFEST_SCHEMA,
  MANIFEST_SCHEMA,
  registerWorkspaceTempArtifactAtRoot,
  validateV2ManifestIdentity,
  v2ManifestPath,
  workspaceTempLeaseTokenMatches
} = require('./lib/workspace-temp.js')
const {
  decodeCursor,
  encodeCursor,
  markCrossScopeOwnershipOverlaps,
  scopeIdentity
} = require('./lib/workspace-temp-governance.js')
const {
  gitignorePatternCovers
} = require('./lib/cli-runtime-utils.js')
const {
  SESSION_OBSERVATION_SLOT_COUNT,
  buildGrokSessionObservation,
  buildGrokSessionPrivateOwner,
  classifyGrokSessionPrivateRecovery,
  validateGrokSessionObservation,
  validateGrokSessionPrivateOwner
} = require('../grok/plugins/devcodex-workspace/lib/private-temp-contract.cjs')
const { sessionPermissionReceipt } = require('../grok/plugins/devcodex-workspace/hooks/session-start.cjs')

const ROOT = path.resolve(__dirname, '..')
const source = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const digest = value => crypto.createHash('sha256').update(value).digest('hex')

let passed = 0
function probe(name, run) {
  run()
  passed++
  process.stdout.write(`PASS ${name}\n`)
}

function manifestFixture(root, overrides = {}) {
  const base = {
    schemaVersion: MANIFEST_SCHEMA,
    artifactId: 'backup-0123456789abcdef',
    type: 'backup',
    owner: 'devcodex-test',
    project: 'alpha/beta',
    producer: 'fixture-producer',
    targetName: 'fixture.txt',
    targetRelativePath: 'backups/alpha/beta/fixture-producer/backup-0123456789abcdef/fixture.txt',
    ownerTokenDigest: digest('owner-token'),
    lifecycleState: 'finalized'
  }
  const manifest = { ...base, ...overrides }
  return {
    manifest,
    manifestPath: v2ManifestPath(root, manifest.project, 'backups', manifest.artifactId)
  }
}

probe('TMP-001 lifecycle constructor surface', () => {
  const workspaceTemp = require('./lib/workspace-temp.js')
  assert.strictEqual(MANIFEST_SCHEMA, 'WorkspaceTempManifestV2')
  assert.strictEqual(typeof workspaceTemp.createWorkspaceTempArtifactAtRoot, 'function')
  assert.strictEqual(typeof workspaceTemp.withWorkspaceTempArtifactAtRoot, 'function')
})

probe('TMP-002 manifest-first source order', () => {
  const text = source('scripts/lib/workspace-temp.js')
  const createStart = text.indexOf('function createWorkspaceTempArtifactAtRoot')
  const manifestWrite = text.indexOf('atomicWriteJson(manifestPath, manifest)', createStart)
  const wrapperStart = text.indexOf('function withWorkspaceTempArtifactAtRoot')
  const targetParentCreate = text.indexOf('fs.mkdirSync(path.dirname(artifact.targetPath)', wrapperStart)
  assert.ok(createStart >= 0 && manifestWrite > createStart)
  assert.ok(targetParentCreate > manifestWrite)
})

probe('TMP-003 path and metadata identity binding', () => {
  const root = path.resolve('C:/fixture-a/.tmp/devcodex')
  const fixture = manifestFixture(root)
  assert.deepStrictEqual(validateV2ManifestIdentity(fixture.manifest, root, fixture.manifestPath).errors, [])
  const forged = { ...fixture.manifest, project: 'alpha/gamma' }
  assert.ok(validateV2ManifestIdentity(forged, root, fixture.manifestPath).errors.length > 0)
  const parent = {
    ...scopeIdentity('alpha', 'backups'),
    records: [], allRecords: [], totals: { eligible: 1, blocked: 0 }
  }
  const child = {
    ...scopeIdentity('alpha/beta', 'backups'),
    records: [], allRecords: [], totals: { eligible: 1, blocked: 0 }
  }
  parent.records = parent.allRecords = [{
    category: 'registered', targetPath: path.join(root, 'backups', 'alpha', 'producer', 'artifact'),
    eligible: true, reasons: []
  }]
  child.records = child.allRecords = [{
    category: 'registered', targetPath: path.join(root, 'backups', 'alpha', 'producer', 'artifact', 'nested'),
    eligible: true, reasons: []
  }]
  markCrossScopeOwnershipOverlaps([parent, child])
  assert.strictEqual(parent.allRecords[0].eligible, false)
  assert.strictEqual(child.allRecords[0].eligible, false)
})

probe('TMP-004 scope-bound pagination cursor', () => {
  const scope = scopeIdentity('alpha/beta', 'backups')
  const cursor = encodeCursor({
    schemaVersion: 'WorkspaceTempCursorV1',
    scopeDigest: scope.scopeDigest,
    inventoryDigest: digest('inventory'),
    after: 'artifact-a.json'
  })
  assert.strictEqual(decodeCursor(cursor, scope).after, 'artifact-a.json')
  assert.throws(() => decodeCursor(cursor, scopeIdentity('alpha/beta', 'runs')), /WORKSPACE_TEMP_CURSOR_INVALID/)
})

probe('TMP-005 scheduler remains plan-only and quota-bound', () => {
  const text = source('scripts/lib/workspace-temp-governance.js')
  assert.match(text, /runWorkspaceTempMaintenanceScheduler[\s\S]*apply:\s*false/)
  assert.match(text, /maxDeletes/)
  assert.match(text, /maxDeleteBytes/)
  assert.match(text, /watermark/)
})

probe('TMP-006 permission truth is platform-specific', () => {
  const fake = { statSync: () => ({ mode: 0o100700 }) }
  assert.strictEqual(sessionPermissionReceipt('/private', 'directory', fake, 'linux').status, 'PASS')
  assert.strictEqual(sessionPermissionReceipt('/private', 'directory', fake, 'win32').status, 'UNVERIFIED')
  assert.match(source('scripts/lib/workspace-temp.js'), /0o700/)
  assert.match(source('scripts/lib/workspace-temp.js'), /0o600/)
})

probe('TMP-007 ordinary lock files have no canonical authority', () => {
  const text = source('scripts/lib/workspace-temp.js')
  assert.match(text, /ordinaryLocks/)
  assert.match(text, /lock:\s*false/)
  assert.doesNotMatch(text, /endsWith\('\.lock'\)[^\n]*lock\s*=\s*true/)
})

probe('TMP-008 V2 relocates and V1 registration is read-only', () => {
  const rootA = path.resolve('C:/fixture-a/.tmp/devcodex')
  const rootB = path.resolve('D:/fixture-b/.tmp/devcodex')
  const fixture = manifestFixture(rootA)
  const relocatedManifestPath = v2ManifestPath(rootB, fixture.manifest.project, 'backups', fixture.manifest.artifactId)
  assert.strictEqual(validateV2ManifestIdentity(fixture.manifest, rootB, relocatedManifestPath).valid, true)
  assert.strictEqual(LEGACY_MANIFEST_SCHEMA, 'WorkspaceTempManifestV1')
  assert.throws(() => registerWorkspaceTempArtifactAtRoot('unused', {}), error =>
    error.code === 'WORKSPACE_TEMP_V1_REGISTRATION_READ_ONLY')
})

probe('TMP-009 inventory categories and completeness are explicit', () => {
  const text = source('scripts/lib/workspace-temp-governance.js')
  for (const field of ['registered', 'orphan', 'legacy', 'completeness', 'categories']) {
    assert.ok(text.includes(field), `missing ${field}`)
  }
  assert.match(text, /inspectScopeOrphans/)
})

probe('TMP-010 lease mutation is token-bound', () => {
  const leaseToken = 'lease-owner-token'
  const lease = { leaseTokenDigest: digest(leaseToken) }
  assert.strictEqual(workspaceTempLeaseTokenMatches(lease, leaseToken), true)
  assert.strictEqual(workspaceTempLeaseTokenMatches(lease, 'other-owner'), false)
})

probe('TMP-011 deep gitignore patterns use semantic coverage', () => {
  const required = '.devcodex/**/.tmp/'
  assert.strictEqual(gitignorePatternCovers('.devcodex/**/.tmp/', required), true)
  assert.strictEqual(gitignorePatternCovers('/.devcodex/', required), true)
  assert.strictEqual(gitignorePatternCovers('.devcodex/*/.tmp/', required), false)
  assert.strictEqual(gitignorePatternCovers('!.devcodex/**/.tmp/', required), false)
})

probe('TMP-012 private Grok session owners are isolated and TTL-safe', () => {
  const base = { pluginData: 'C:/grok-data', sessionId: 'same-session', ownerToken: 'token', nowMs: 1000, ttlMs: 1000 }
  const first = buildGrokSessionPrivateOwner({ ...base, nonce: 'nonce-a' })
  const second = buildGrokSessionPrivateOwner({ ...base, nonce: 'nonce-b' })
  const missingA = buildGrokSessionPrivateOwner({ ...base, sessionId: '', nonce: 'missing-a' })
  const missingB = buildGrokSessionPrivateOwner({ ...base, sessionId: '', nonce: 'missing-b' })
  assert.notStrictEqual(first.ownerRoot, second.ownerRoot)
  assert.notStrictEqual(missingA.ownerRoot, missingB.ownerRoot)
  assert.strictEqual(validateGrokSessionPrivateOwner(first, base.pluginData).valid, true)
  assert.strictEqual(classifyGrokSessionPrivateRecovery(first, {
    pluginData: base.pluginData, nowMs: 1500, kill: () => { throw Object.assign(new Error('dead'), { code: 'ESRCH' }) }
  }).recoverable, false)
  assert.strictEqual(classifyGrokSessionPrivateRecovery(first, {
    pluginData: base.pluginData, nowMs: 2500, kill: () => {}
  }).recoverable, false)
})

probe('TMP-017 Grok SessionStart diagnostics use a fixed observation ring', () => {
  const base = { pluginData: 'C:/grok-data', sessionId: 'same-session', ownerToken: 'token', nowMs: 1000 }
  const observations = Array.from({ length: 100 }, (_, index) => buildGrokSessionObservation({
    ...base,
    nonce: `bounded-observation-${index}`
  }))
  const paths = new Set(observations.map(item => item.observationPath))
  assert(paths.size > 1)
  assert(paths.size <= SESSION_OBSERVATION_SLOT_COUNT)
  for (const observation of observations) {
    assert.strictEqual(validateGrokSessionObservation(observation, base.pluginData).valid, true)
    assert.match(path.basename(observation.observationPath), /^slot-(?:0\d|1[0-5])\.json$/)
    assert.strictEqual(Object.prototype.hasOwnProperty.call(observation, 'ownerToken'), false)
  }
})

probe('TMP-016 product writers no longer late-register', () => {
  const productFiles = [
    'index.js',
    'scripts/lib/cli-install-commands.js',
    'scripts/lib/cli-runtime-utils.js',
    'scripts/lib/content-root-delete-transaction.js',
    'scripts/lib/host-adapter-scope.js'
  ]
  const text = productFiles.map(source).join('\n')
  assert.doesNotMatch(text, /registerWorkspaceTemp(?:Backup|ArtifactAtRoot)/)
  assert.match(text, /withWorkspaceTempBackup/)
  assert.match(text, /createWorkspaceTempArtifactAtRoot/)
})

assert.strictEqual(passed, 14)
process.stdout.write(`Batch C: ${passed}/14 issue probes passed\n`)
