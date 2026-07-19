#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { buildJsonContentIdentity } = require('../hooks/_runtime/content-identity.cjs')
const {
  ProjectKnowledgeError,
  acceptKnowledgeBatch,
  bootstrapProjectKnowledge,
  buildImpactGraphFromInventory,
  buildIncrementalAnalysisPlan,
  buildInventoryFromFiles,
  buildRepoIdentity,
  knowledgeSnapshotRelativePath,
  observeProjectKnowledge,
  persistAcceptedKnowledge,
  readKnowledgeSnapshot,
  validateSemanticClaim
} = require('./lib/project-knowledge-store')

const ROOT = path.resolve(__dirname, '..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-project-knowledge-v2-'))
const repoRoot = path.join(tempRoot, 'repo')
const activeRoot = path.join(tempRoot, 'active')
const taskRoot = path.join(tempRoot, 'task')
fs.mkdirSync(repoRoot, { recursive: true })

const files = {
  'README.md': '# Product\n\n## Usage\n',
  'config/app.json': '{"mode":"prod","port":3000}\n',
  'src/a.js': "const b = req" + "uire('./b')\nmodule.exports = function a () { return b }\n",
  'src/b.js': 'module.exports = 2\n',
  'tests/a.test.js': "test('a', () => {})\n",
  'website/guide.md': '# Guide\n'
}
for (const [relativePath, content] of Object.entries(files)) {
  const absolute = path.join(repoRoot, relativePath)
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  fs.writeFileSync(absolute, content)
}

const inventory = buildInventoryFromFiles(files)
const sameInventory = buildInventoryFromFiles(Object.fromEntries(Object.entries(files).reverse()))
assert.strictEqual(inventory.schemaVersion, 'ProjectInventoryV2')
assert.strictEqual(inventory.merkleRoot.digest, sameInventory.merkleRoot.digest, 'Merkle root must be ordering-independent')
assert.strictEqual(inventory.inventoryIdentity.digest, sameInventory.inventoryIdentity.digest)

const repoIdentity = buildRepoIdentity(repoRoot, inventory, { baseIdentity: 'base-v2' })
const lens = { lensId: 'architecture', version: '2', questionFingerprint: 'project-v2', policyVersion: '2' }
const graph = {
  coverage: 1,
  edges: [{ from: 'src/b.js', to: 'src/a.js', type: 'consumer', evidenceStrength: 'content-structured', source: 'fixture' }]
}
const productionGraph = buildImpactGraphFromInventory(inventory)
assert.strictEqual(productionGraph.schemaVersion, 'ImpactGraphV1')
assert.strictEqual(productionGraph.builderVersion, 'static-relative-v1')
assert(
  productionGraph.edges.some(edge =>
    edge.from === 'src/b.js' &&
    edge.to === 'src/a.js' &&
    edge.type === 'consumer' &&
    edge.source === 'static-relative-import'
  ),
  'production inventory graph must resolve relative require dependency to its consumer'
)
assert.strictEqual(productionGraph.coverage, 1)
assert.strictEqual(productionGraph.dynamicDependencyUnknown, false)
assert.strictEqual(
  buildImpactGraphFromInventory(sameInventory).graphIdentity.digest,
  productionGraph.graphIdentity.digest,
  'production graph identity must be ordering-independent'
)
const dynamicGraph = buildImpactGraphFromInventory(buildInventoryFromFiles({
  'src/dynamic.js': 'module.exports = require(runtimeName)\n'
}))
assert.strictEqual(dynamicGraph.dynamicDependencyUnknown, true)
assert.deepStrictEqual(dynamicGraph.stats.unknownConsumerPaths, ['src/dynamic.js'])
const plan = buildIncrementalAnalysisPlan({ snapshot: null, inventory, repoIdentity, graph, lens, options: { maxBatchFiles: 2 } })
assert.strictEqual(plan.schemaVersion, 'IncrementalAnalysisPlanV2')
assert.strictEqual(plan.knowledgeBinding.schemaVersion, 'ProjectKnowledgeBindingV1')
assert.strictEqual(plan.knowledgeBinding.inventoryMerkleRoot.digest, inventory.merkleRoot.digest)

const observation = observeProjectKnowledge({ inventory, plan })
assert.strictEqual(observation.schemaVersion, 'ProjectKnowledgeObservationV1')
assert.strictEqual(observation.candidateRecords.length, inventory.fileCount)
assert.strictEqual(fs.existsSync(activeRoot), false, 'observe must be read-only')
for (const record of observation.candidateRecords) {
  assert.strictEqual(record.schemaVersion, 'FileKnowledgeRecordV2')
  assert(record.semanticClaims.length > 0)
  const source = inventory.records.find(item => item.path === record.path)
  assert(record.semanticClaims.every(claim => claim.schemaVersion === 'SemanticClaimV1' && validateSemanticClaim(claim, source)))
  assert.strictEqual(record.claimBoundary.manualDeepReadClaimAllowed, false)
  assert.strictEqual(record.claimBoundary.completeIssueCountClaimAllowed, false)
}

const firstBatch = plan.batches[0]
const candidateByPath = new Map(observation.candidateRecords.map(record => [record.path, record]))
const wrongContent = JSON.parse(JSON.stringify(candidateByPath.get(firstBatch.paths[0])))
wrongContent.contentIdentity.digest = '0'.repeat(64)
assert.throws(() => acceptKnowledgeBatch({
  snapshot: null,
  inventory,
  repoIdentity,
  plan,
  batchId: firstBatch.batchId,
  candidateRecords: firstBatch.paths.map(relativePath => relativePath === wrongContent.path ? wrongContent : candidateByPath.get(relativePath)),
  validationResult: { status: 'pass' },
  sampleOracle: { status: 'pass', samplePaths: [], checked: 0, mismatches: [] },
  graph
}), error => error instanceof ProjectKnowledgeError && error.code === 'KNOWLEDGE_CANDIDATE_IDENTITY_MISMATCH')

const wrongRange = JSON.parse(JSON.stringify(candidateByPath.get(firstBatch.paths[0])))
wrongRange.semanticClaims[0].rangeIdentity.digest = '0'.repeat(64)
assert.throws(() => acceptKnowledgeBatch({
  snapshot: null,
  inventory,
  repoIdentity,
  plan,
  batchId: firstBatch.batchId,
  candidateRecords: firstBatch.paths.map(relativePath => relativePath === wrongRange.path ? wrongRange : candidateByPath.get(relativePath)),
  validationResult: { status: 'pass' },
  sampleOracle: { status: 'pass', samplePaths: [], checked: 0, mismatches: [] },
  graph
}), error => error instanceof ProjectKnowledgeError && error.code === 'KNOWLEDGE_CLAIM_IDENTITY_INVALID')

const bootstrap = bootstrapProjectKnowledge({ snapshot: null, inventory, repoIdentity, plan, graph })
assert.strictEqual(bootstrap.status, 'accepted')
assert.strictEqual(bootstrap.receipts.length, plan.batches.length)
assert.strictEqual(bootstrap.globalValidation.status, 'pass')
assert.strictEqual(bootstrap.snapshot.status, 'accepted')
assert(bootstrap.snapshot.records.every(record => record.semanticClaims.every(claim => claim.status === 'accepted')))
assert.strictEqual(bootstrap.snapshot.knowledgeBinding.bindingIdentity.digest, plan.knowledgeBinding.bindingIdentity.digest)

const persisted = persistAcceptedKnowledge({
  activeRoot,
  taskRoot,
  runId: 'v2-fixture',
  plan,
  snapshot: bootstrap.snapshot,
  receipt: bootstrap.receipts.at(-1)
})
assert.strictEqual(persisted.schemaVersion, 'ProjectKnowledgePersistReceiptV2')
assert.strictEqual(persisted.acceptedPointerAdvanced, true)
assert(persisted.runtimeWrite.filePath.includes(`${path.sep}v2${path.sep}`))
assert.strictEqual(readKnowledgeSnapshot(activeRoot, repoIdentity.repoId).status, 'fresh')

const failedArtifactRoot = path.join(tempRoot, 'task-root-is-a-file')
const failedPointerRoot = path.join(tempRoot, 'failed-pointer-active')
fs.writeFileSync(failedArtifactRoot, 'not-a-directory\n')
assert.throws(() => persistAcceptedKnowledge({
  activeRoot: failedPointerRoot,
  taskRoot: failedArtifactRoot,
  runId: 'must-not-advance',
  plan,
  snapshot: bootstrap.snapshot,
  receipt: bootstrap.receipts.at(-1)
}), error => error instanceof ProjectKnowledgeError && error.code === 'KNOWLEDGE_ARTIFACT_WRITE_FAILED')
assert.strictEqual(readKnowledgeSnapshot(failedPointerRoot, repoIdentity.repoId).status, 'missing', 'artifact failure must not advance runtime pointer')

const unchangedPlan = buildIncrementalAnalysisPlan({ snapshot: bootstrap.snapshot, inventory, repoIdentity, graph, lens })
assert.strictEqual(unchangedPlan.fullRequired, false)
assert.deepStrictEqual(unchangedPlan.readPaths, [])
assert.strictEqual(unchangedPlan.samplePaths.length, 3)
const unchangedBootstrap = bootstrapProjectKnowledge({ snapshot: bootstrap.snapshot, inventory, repoIdentity, plan: unchangedPlan, graph })
assert.strictEqual(unchangedBootstrap.status, 'unchanged')
assert.strictEqual(unchangedBootstrap.sampleOracle.status, 'pass')

const changedInventory = buildInventoryFromFiles({ ...files, 'src/b.js': 'module.exports = 3\n' })
const changedPlan = buildIncrementalAnalysisPlan({ snapshot: bootstrap.snapshot, inventory: changedInventory, repoIdentity, graph, lens, options: { maxAffectedRatio: 1 } })
assert.deepStrictEqual(changedPlan.readPaths.filter(item => item.startsWith('src/')), ['src/a.js', 'src/b.js'])
assert(changedPlan.reusedPaths.includes('README.md'))

const dynamicFiles = {
  'src/a.js': "module.exports = req" + "uire('./b')\n",
  'src/b.js': 'module.exports = 1\n',
  'src/dynamic.js': 'module.exports = require(runtimeName)\n'
}
const dynamicInventory = buildInventoryFromFiles(dynamicFiles)
const dynamicRepo = buildRepoIdentity(repoRoot, dynamicInventory, { baseIdentity: 'dynamic-base' })
const dynamicDerivedGraph = buildImpactGraphFromInventory(dynamicInventory)
const dynamicInitialPlan = buildIncrementalAnalysisPlan({
  snapshot: null,
  inventory: dynamicInventory,
  repoIdentity: dynamicRepo,
  graph: dynamicDerivedGraph,
  lens,
  options: { maxAffectedRatio: 1 }
})
const dynamicBootstrap = bootstrapProjectKnowledge({
  snapshot: null,
  inventory: dynamicInventory,
  repoIdentity: dynamicRepo,
  plan: dynamicInitialPlan,
  graph: dynamicDerivedGraph
})
const dynamicDependencyChanged = buildInventoryFromFiles({ ...dynamicFiles, 'src/b.js': 'module.exports = 2\n' })
const dynamicDependencyPlan = buildIncrementalAnalysisPlan({
  snapshot: dynamicBootstrap.snapshot,
  inventory: dynamicDependencyChanged,
  repoIdentity: dynamicRepo,
  graph: buildImpactGraphFromInventory(dynamicDependencyChanged),
  lens,
  options: { maxAffectedRatio: 1 }
})
assert.strictEqual(dynamicDependencyPlan.fullRequired, false)
assert.deepStrictEqual(
  dynamicDependencyPlan.readPaths,
  ['src/a.js', 'src/b.js', 'src/dynamic.js'],
  'unknown consumers must be conservatively reread for other dependency changes'
)
const dynamicConsumerChanged = buildInventoryFromFiles({ ...dynamicFiles, 'src/dynamic.js': 'module.exports = require(otherRuntimeName)\n' })
const dynamicConsumerPlan = buildIncrementalAnalysisPlan({
  snapshot: dynamicBootstrap.snapshot,
  inventory: dynamicConsumerChanged,
  repoIdentity: dynamicRepo,
  graph: buildImpactGraphFromInventory(dynamicConsumerChanged),
  lens,
  options: { maxAffectedRatio: 1 }
})
assert.strictEqual(dynamicConsumerPlan.fullRequired, true)
assert(dynamicConsumerPlan.fullReasons.includes('dynamic-dependency-consumer-changed'))

const productionInitialPlan = buildIncrementalAnalysisPlan({
  snapshot: null,
  inventory,
  repoIdentity,
  graph: productionGraph,
  lens,
  options: { maxAffectedRatio: 1 }
})
const productionBootstrap = bootstrapProjectKnowledge({
  snapshot: null,
  inventory,
  repoIdentity,
  plan: productionInitialPlan,
  graph: productionGraph
})
const graphChangedInventory = buildInventoryFromFiles({
  ...files,
  'src/a.js': "module.exports = req" + "uire('./b')\nreq" + "uire('./new')\n",
  'src/new.js': 'module.exports = true\n'
})
const graphChangedPlan = buildIncrementalAnalysisPlan({
  snapshot: productionBootstrap.snapshot,
  inventory: graphChangedInventory,
  repoIdentity,
  graph: buildImpactGraphFromInventory(graphChangedInventory),
  lens,
  options: { maxAffectedRatio: 1 }
})
assert.strictEqual(graphChangedPlan.graphChanged, true)
assert.strictEqual(graphChangedPlan.fullRequired, false, 'a current graph topology change must use the new closure without forcing a full reread')
assert(graphChangedPlan.readPaths.includes('src/a.js'))
assert(graphChangedPlan.readPaths.includes('src/b.js'))
assert(graphChangedPlan.readPaths.includes('src/new.js'))
const legacyGraphMigrationPlan = buildIncrementalAnalysisPlan({
  snapshot: bootstrap.snapshot,
  inventory,
  repoIdentity,
  graph: productionGraph,
  lens,
  options: { maxAffectedRatio: 1 }
})
assert.strictEqual(legacyGraphMigrationPlan.fullRequired, true)
assert(legacyGraphMigrationPlan.fullReasons.includes('impact-graph-builder-migration'))

for (const [field, value] of [
  ['analysisConfigIdentity', 'config-v2'],
  ['parserIdentity', 'parser-v2'],
  ['testIdentity', 'test-route-v2'],
  ['profileIdentity', 'profile-v2']
]) {
  const mismatch = buildIncrementalAnalysisPlan({
    snapshot: bootstrap.snapshot,
    inventory,
    repoIdentity,
    graph,
    lens,
    options: { [field]: value }
  })
  assert.strictEqual(mismatch.fullRequired, true, `${field} mismatch must force full analysis`)
  assert(mismatch.fullReasons.includes('analysis-environment-binding-mismatch'))
}

const otherRepo = path.join(tempRoot, 'other-repo')
fs.mkdirSync(otherRepo, { recursive: true })
const otherIdentity = buildRepoIdentity(otherRepo, inventory, { baseIdentity: 'base-v2' })
const wrongTargetPlan = buildIncrementalAnalysisPlan({ snapshot: bootstrap.snapshot, inventory, repoIdentity: otherIdentity, graph, lens })
assert(wrongTargetPlan.fullReasons.includes('snapshot-target-binding-mismatch'))

const legacyActive = path.join(tempRoot, 'legacy-active')
const legacyCore = {
  schemaVersion: 'ProjectKnowledgeSnapshotV1',
  policyVersion: '1',
  repoIdentity,
  inventoryIdentity: inventory.inventoryIdentity,
  records: [],
  tombstones: [],
  impactGraph: { schemaVersion: 'ImpactGraphV1', edges: [], coverage: 0 },
  lenses: [],
  planProgress: {},
  pendingPlan: null,
  status: 'accepted',
  snapshotIdentity: null
}
legacyCore.snapshotIdentity = buildJsonContentIdentity({
  sourceKey: `project-knowledge/${repoIdentity.repoId}`,
  value: { ...legacyCore, snapshotIdentity: null },
  contractVersion: '1'
}).identity
const legacyPath = path.join(legacyActive, knowledgeSnapshotRelativePath(repoIdentity.repoId, 'v1'))
fs.mkdirSync(path.dirname(legacyPath), { recursive: true })
fs.writeFileSync(legacyPath, JSON.stringify(legacyCore, null, 2) + '\n')
const legacyRead = readKnowledgeSnapshot(legacyActive, repoIdentity.repoId)
assert.strictEqual(legacyRead.status, 'compatibility-v1')
assert.strictEqual(legacyRead.reuseAllowed, false)
assert.strictEqual(legacyRead.migrationRequired, true)

const cliActive = path.join(tempRoot, 'cli-active')
const cli = spawnSync(process.execPath, [
  path.join(ROOT, 'scripts', 'project-analysis-state.js'), 'observe', '--repo', repoRoot, '--active-root', cliActive,
  '--lens', 'fixture', '--question', 'fixture-v2', '--json'
], { cwd: ROOT, encoding: 'utf8', windowsHide: true })
assert.strictEqual(cli.status, 0, cli.stderr || cli.stdout)
const cliEnvelope = JSON.parse(cli.stdout)
assert.strictEqual(cliEnvelope.schemaVersion, 'ProjectAnalysisStateCliV2')
assert.strictEqual(cliEnvelope.data.writeCount, 0)
assert.strictEqual(fs.existsSync(cliActive), false, 'CLI observe must not create runtime state')

const cliTask = path.join(tempRoot, 'cli-task')
const cliBootstrap = spawnSync(process.execPath, [
  path.join(ROOT, 'scripts', 'project-analysis-state.js'), 'bootstrap', '--repo', repoRoot, '--active-root', cliActive,
  '--task-root', cliTask, '--run-id', 'production-graph-fixture',
  '--lens', 'fixture', '--question', 'fixture-v2', '--json'
], { cwd: ROOT, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
assert.strictEqual(cliBootstrap.status, 0, cliBootstrap.stderr || cliBootstrap.stdout)
const cliBootstrapEnvelope = JSON.parse(cliBootstrap.stdout)
assert.strictEqual(cliBootstrapEnvelope.data.bootstrap.snapshot.impactGraph.coverage, 1)
assert(
  cliBootstrapEnvelope.data.bootstrap.snapshot.impactGraph.edges.some(edge =>
    edge.from === 'src/b.js' && edge.to === 'src/a.js'
  ),
  'production CLI bootstrap must persist the derived dependency graph'
)
fs.writeFileSync(path.join(repoRoot, 'src', 'b.js'), 'module.exports = 3\n')
const cliChangedPlan = spawnSync(process.execPath, [
  path.join(ROOT, 'scripts', 'project-analysis-state.js'), 'plan', '--repo', repoRoot, '--active-root', cliActive,
  '--lens', 'fixture', '--question', 'fixture-v2', '--json'
], { cwd: ROOT, encoding: 'utf8', windowsHide: true })
assert.strictEqual(cliChangedPlan.status, 0, cliChangedPlan.stderr || cliChangedPlan.stdout)
const cliChangedEnvelope = JSON.parse(cliChangedPlan.stdout)
assert.strictEqual(cliChangedEnvelope.data.fullRequired, false)
assert.deepStrictEqual(
  cliChangedEnvelope.data.readPaths.filter(relativePath => relativePath.startsWith('src/')),
  ['src/a.js', 'src/b.js'],
  'production CLI plan must expand a changed dependency to its consumer'
)

fs.rmSync(tempRoot, { recursive: true, force: true })
console.log('project knowledge V2 tests passed: production graph/Merkle/binding/claims/range/bootstrap/V1-read-only/delta/oracle writes=accepted-only')
