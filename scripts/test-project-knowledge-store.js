#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const {
  ProjectKnowledgeError,
  acceptKnowledgeBatch,
  buildIncrementalAnalysisPlan,
  buildInventoryFromFiles,
  buildRepoIdentity,
  persistAcceptedKnowledge,
  readKnowledgeSnapshot,
  scanProjectInventory,
  selectDeterministicReuseSample,
  synthesizeGlobalBacklog,
  validatePlanIdentity,
  validateSnapshotIdentity,
  verifyReuseSample
} = require('./lib/project-knowledge-store')

const ROOT = path.resolve(__dirname, '..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-project-knowledge-'))
const repoRoot = path.join(tempRoot, 'repo')
const activeRoot = path.join(tempRoot, 'active')
const taskRoot = path.join(tempRoot, 'task')
fs.mkdirSync(repoRoot, { recursive: true })

function inventory(files) {
  return buildInventoryFromFiles(files)
}

function semanticRecord(record, anchor = record.path) {
  return {
    ...record,
    coverageLevel: 'deep',
    evidenceStrength: 'agent-semantic',
    symbols: [`symbol:${anchor}`],
    imports: [],
    configAnchors: record.kind === 'config' ? [`config:${anchor}`] : [],
    contractAnchors: [`contract:${anchor}`],
    facts: [{ anchor, statement: `fact:${anchor}` }]
  }
}

// Keep embedded fixture source distinct from this packaged test's real CommonJS dependencies.
const REQUIRE_A_FIXTURE = "module.exports = req" + "uire('./a')\n"

const initialInventory = inventory({
  'src/a.js': "module.exports = 'a'\n",
  'src/b.js': REQUIRE_A_FIXTURE,
  'config/app.json': '{"mode":"prod"}\n',
  'docs/readme.md': '# Readme\n'
})
const repoIdentity = buildRepoIdentity(repoRoot, initialInventory, { baseIdentity: 'base-1' })
const graph = {
  coverage: 1,
  edges: [
    { from: 'src/a.js', to: 'src/b.js', type: 'consumer', evidenceStrength: 'content-structured', source: 'fixture-import' },
    { from: 'config/app.json', to: 'src/a.js', type: 'config', evidenceStrength: 'content-structured', source: 'fixture-config' }
  ]
}
const lens = { lensId: 'architecture', version: '1', questionFingerprint: 'q-1', policyVersion: '1' }
const firstPlan = buildIncrementalAnalysisPlan({
  snapshot: null,
  inventory: initialInventory,
  repoIdentity,
  graph,
  lens,
  options: { maxBatchFiles: 10 }
})
assert.strictEqual(firstPlan.schemaVersion, 'IncrementalAnalysisPlanV1')
assert.strictEqual(firstPlan.fullRequired, true)
assert(firstPlan.fullReasons.includes('snapshot-missing'))
assert.deepStrictEqual(firstPlan.readPaths, initialInventory.records.map(record => record.path))
assert.strictEqual(firstPlan.batches.length, 3, 'namespace batches must remain explicit')

let snapshot = null
const receipts = []
for (const batch of firstPlan.batches) {
  const accepted = acceptKnowledgeBatch({
    snapshot,
    inventory: initialInventory,
    repoIdentity,
    plan: firstPlan,
    batchId: batch.batchId,
    candidateRecords: batch.paths.map(relativePath => semanticRecord(initialInventory.records.find(record => record.path === relativePath))),
    validationResult: { schemaVersion: 'BatchValidationResultV1', status: 'pass' },
    sampleOracle: verifyReuseSample({ samplePaths: [] }),
    graph,
    findings: [{ findingId: `F-${batch.batchId}`, priority: 'medium' }]
  })
  snapshot = accepted.snapshot
  receipts.push(accepted.receipt)
  assert.strictEqual(accepted.receipt.status, 'accepted')
}
assert.strictEqual(snapshot.status, 'accepted')
assert.strictEqual(snapshot.records.length, 4)
assert.strictEqual(snapshot.pendingPlan, null)
assert.strictEqual(snapshot.lenses[0].status, 'accepted')

const persisted = persistAcceptedKnowledge({
  activeRoot,
  taskRoot,
  runId: 'fixture-run',
  plan: firstPlan,
  snapshot,
  receipt: receipts.at(-1)
})
assert.strictEqual(persisted.runtimeWrite.status, 'persisted')
assert.strictEqual(persisted.artifactWrites.length, 3)
const readBack = readKnowledgeSnapshot(activeRoot, repoIdentity.repoId)
assert.strictEqual(readBack.status, 'fresh')
assert.strictEqual(readBack.value.snapshotIdentity.digest, snapshot.snapshotIdentity.digest)
assert.strictEqual(validateSnapshotIdentity(readBack.value), true)
const runtimePath = persisted.runtimeWrite.filePath
const runtimeText = fs.readFileSync(runtimePath, 'utf8')
const tamperedRuntime = JSON.parse(runtimeText)
tamperedRuntime.status = 'tampered'
fs.writeFileSync(runtimePath, JSON.stringify(tamperedRuntime, null, 2) + '\n')
assert.strictEqual(readKnowledgeSnapshot(activeRoot, repoIdentity.repoId).status, 'invalid', 'tampered snapshot must not be reused')
fs.writeFileSync(runtimePath, runtimeText)

const unchangedPlan = buildIncrementalAnalysisPlan({ snapshot, inventory: initialInventory, repoIdentity, graph, lens })
assert.strictEqual(unchangedPlan.fullRequired, false)
assert.deepStrictEqual(unchangedPlan.readPaths, [])
assert.strictEqual(unchangedPlan.reusedPaths.length, 4)
assert.strictEqual(unchangedPlan.samplePaths.length, 3, '5% oracle must use minimum 3 when corpus permits')
const validSample = verifyReuseSample({
  samplePaths: unchangedPlan.samplePaths,
  snapshotRecords: snapshot.records,
  observedRecords: snapshot.records.filter(record => unchangedPlan.samplePaths.includes(record.path))
})
assert.strictEqual(validSample.status, 'pass')
const badObserved = JSON.parse(JSON.stringify(snapshot.records.filter(record => unchangedPlan.samplePaths.includes(record.path))))
badObserved[0].factDigest = '0'.repeat(64)
assert.strictEqual(verifyReuseSample({ samplePaths: unchangedPlan.samplePaths, snapshotRecords: snapshot.records, observedRecords: badObserved }).status, 'fail')

const changedInventory = inventory({
  'src/a.js': "module.exports = 'a2'\n",
  'src/b.js': REQUIRE_A_FIXTURE,
  'config/app.json': '{"mode":"prod"}\n',
  'docs/readme.md': '# Readme\n'
})
const changedPlan = buildIncrementalAnalysisPlan({ snapshot, inventory: changedInventory, repoIdentity, graph, lens, options: { maxAffectedRatio: 1 } })
assert(changedPlan.readPaths.includes('src/a.js'))
assert(changedPlan.readPaths.includes('src/b.js'), 'consumer impact must expand from the changed file')
assert(!changedPlan.readPaths.includes('docs/readme.md'))

const configInventory = inventory({
  'src/a.js': "module.exports = 'a'\n",
  'src/b.js': REQUIRE_A_FIXTURE,
  'config/app.json': '{"mode":"dev"}\n',
  'docs/readme.md': '# Readme\n'
})
const configPlan = buildIncrementalAnalysisPlan({ snapshot, inventory: configInventory, repoIdentity, graph, lens, options: { maxAffectedRatio: 1 } })
assert.deepStrictEqual(configPlan.readPaths, configInventory.records.map(record => record.path), 'config changes must invalidate all project records conservatively')

const newLensPlan = buildIncrementalAnalysisPlan({
  snapshot,
  inventory: initialInventory,
  repoIdentity,
  graph,
  lens: { lensId: 'security', version: '1', questionFingerprint: 'security-q' }
})
assert.deepStrictEqual(newLensPlan.lensGap, initialInventory.records.map(record => record.path))
assert.deepStrictEqual(newLensPlan.readPaths, initialInventory.records.map(record => record.path))

const renamedInventory = inventory({
  'src/a-renamed.js': "module.exports = 'a'\n",
  'src/b.js': REQUIRE_A_FIXTURE,
  'config/app.json': '{"mode":"prod"}\n'
})
const renamePlan = buildIncrementalAnalysisPlan({ snapshot, inventory: renamedInventory, repoIdentity, graph: { coverage: 1, edges: [] }, lens, options: { maxAffectedRatio: 1 } })
assert.strictEqual(validatePlanIdentity(renamePlan), true)
assert.deepStrictEqual(renamePlan.delta.renames.map(item => [item.from, item.to]), [['src/a.js', 'src/a-renamed.js']])
assert(renamePlan.delta.deleted.includes('docs/readme.md'))
const fakeOracleAccept = acceptKnowledgeBatch({
  snapshot,
  inventory: renamedInventory,
  repoIdentity,
  plan: renamePlan,
  batchId: renamePlan.batches[0].batchId,
  candidateRecords: renamePlan.batches[0].paths.map(relativePath => semanticRecord(renamedInventory.records.find(record => record.path === relativePath))),
  validationResult: { status: 'pass' },
  sampleOracle: { status: 'pass', samplePaths: [], checked: 0, mismatches: [] },
  graph: { coverage: 1, edges: [] }
})
assert.strictEqual(fakeOracleAccept.receipt.status, 'invalid', 'self-reported incomplete sample pass must not advance the pointer')
let renameSnapshot = snapshot
for (const batch of renamePlan.batches) {
  const accepted = acceptKnowledgeBatch({
    snapshot: renameSnapshot,
    inventory: renamedInventory,
    repoIdentity,
    plan: renamePlan,
    batchId: batch.batchId,
    candidateRecords: batch.paths.map(relativePath => semanticRecord(renamedInventory.records.find(record => record.path === relativePath))),
    validationResult: { status: 'pass' },
    sampleOracle: verifyReuseSample({
      samplePaths: renamePlan.samplePaths,
      snapshotRecords: snapshot.records,
      observedRecords: snapshot.records.filter(record => renamePlan.samplePaths.includes(record.path))
    }),
    graph: { coverage: 1, edges: [] }
  })
  renameSnapshot = accepted.snapshot
}
assert(renameSnapshot.tombstones.some(item => item.path === 'src/a.js' && item.renamedTo === 'src/a-renamed.js'))
assert(renameSnapshot.tombstones.some(item => item.path === 'docs/readme.md' && item.reason === 'deleted'))
assert(!renameSnapshot.records.some(item => item.path === 'src/a.js'))

const batchInventory = inventory(Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`module-${index}/file.js`, `module.exports=${index}\n`])))
const batchRepo = buildRepoIdentity(repoRoot, batchInventory, { baseIdentity: 'base-batch' })
const batchPlan = buildIncrementalAnalysisPlan({
  snapshot: null,
  inventory: batchInventory,
  repoIdentity: batchRepo,
  graph: { coverage: 1, edges: [] },
  lens: { lensId: 'batch', questionFingerprint: 'batch-q' },
  options: { maxBatchFiles: 1 }
})
const batchOne = batchPlan.batches[0]
const firstBatchAccepted = acceptKnowledgeBatch({
  snapshot: null,
  inventory: batchInventory,
  repoIdentity: batchRepo,
  plan: batchPlan,
  batchId: batchOne.batchId,
  candidateRecords: batchOne.paths.map(relativePath => semanticRecord(batchInventory.records.find(record => record.path === relativePath))),
  validationResult: { status: 'pass' },
  sampleOracle: verifyReuseSample({ samplePaths: [] }),
  graph: { coverage: 1, edges: [] }
})
const resumedPlan = buildIncrementalAnalysisPlan({
  snapshot: firstBatchAccepted.snapshot,
  inventory: batchInventory,
  repoIdentity: batchRepo,
  graph: { coverage: 1, edges: [] },
  lens: { lensId: 'batch', questionFingerprint: 'batch-q' },
  options: { maxBatchFiles: 1 }
})
assert.strictEqual(resumedPlan.resumed, true)
assert.strictEqual(resumedPlan.batches[0].status, 'accepted')
assert.strictEqual(resumedPlan.batches[1].status, 'pending')
const tamperedPending = JSON.parse(JSON.stringify(firstBatchAccepted.snapshot))
tamperedPending.pendingPlan.readPaths = []
const invalidPendingPlan = buildIncrementalAnalysisPlan({
  snapshot: tamperedPending,
  inventory: batchInventory,
  repoIdentity: batchRepo,
  graph: { coverage: 1, edges: [] },
  lens: { lensId: 'batch', questionFingerprint: 'batch-q' },
  options: { maxBatchFiles: 1 }
})
assert.strictEqual(invalidPendingPlan.resumed, false)
assert(invalidPendingPlan.fullReasons.includes('pending-plan-identity-invalid'))
const stalePlan = JSON.parse(JSON.stringify(batchPlan))
stalePlan.readPaths = []
assert.throws(
  () => acceptKnowledgeBatch({
    snapshot: firstBatchAccepted.snapshot,
    inventory: batchInventory,
    repoIdentity: batchRepo,
    plan: stalePlan,
    batchId: stalePlan.batches[1].batchId,
    validationResult: { status: 'pass' },
    sampleOracle: verifyReuseSample({ samplePaths: [] })
  }),
  error => error instanceof ProjectKnowledgeError && error.code === 'KNOWLEDGE_ACCEPT_PLAN_STALE'
)
const failedBatch = acceptKnowledgeBatch({
  snapshot: firstBatchAccepted.snapshot,
  inventory: batchInventory,
  repoIdentity: batchRepo,
  plan: batchPlan,
  batchId: batchPlan.batches[1].batchId,
  candidateRecords: [],
  validationResult: { status: 'fail' },
  sampleOracle: { status: 'pass', mismatches: [] },
  graph: { coverage: 1, edges: [] }
})
assert.strictEqual(failedBatch.receipt.status, 'provisional')
assert.strictEqual(failedBatch.receipt.acceptedPointerAdvanced, false)

const invalidOracle = acceptKnowledgeBatch({
  snapshot: firstBatchAccepted.snapshot,
  inventory: batchInventory,
  repoIdentity: batchRepo,
  plan: batchPlan,
  batchId: batchPlan.batches[1].batchId,
  candidateRecords: [],
  validationResult: { status: 'pass' },
  sampleOracle: { status: 'fail', mismatches: ['module-0/file.js'] },
  graph: { coverage: 1, edges: [] }
})
assert.strictEqual(invalidOracle.receipt.status, 'invalid')
assert.strictEqual(invalidOracle.receipt.fullRequired, true)

const sample100 = Array.from({ length: 100 }, (_, index) => initialInventory.records[0] && ({
  path: `f-${index}`,
  contentIdentity: { ...initialInventory.records[0].contentIdentity, digest: index.toString(16).padStart(64, '0') }
}))
assert.strictEqual(selectDeterministicReuseSample(sample100).length, 5)
assert.strictEqual(selectDeterministicReuseSample(sample100.slice(0, 2)).length, 2)
assert.strictEqual(selectDeterministicReuseSample(Array.from({ length: 1000 }, (_, index) => ({
  path: `f-${index}`,
  contentIdentity: { ...initialInventory.records[0].contentIdentity, digest: index.toString(16).padStart(64, '0') }
}))).length, 20)

const provisionalBacklog = synthesizeGlobalBacklog({
  plan: batchPlan,
  receipts: [firstBatchAccepted.receipt],
  findings: [{ findingId: 'F-2', priority: 'low' }, { findingId: 'F-1', priority: 'high' }],
  globalValidation: { status: 'pass' }
})
assert.strictEqual(provisionalBacklog.status, 'provisional')
assert.strictEqual(provisionalBacklog.completionClaimAllowed, false)
const finalBacklog = synthesizeGlobalBacklog({
  plan: firstPlan,
  receipts,
  findings: [{ findingId: 'F-2', priority: 'low' }, { findingId: 'F-1', priority: 'high' }],
  globalValidation: { status: 'pass' }
})
assert.strictEqual(finalBacklog.status, 'final')
assert.deepStrictEqual(finalBacklog.items.map(item => item.findingId), ['F-1', 'F-2'])

assert.throws(
  () => persistAcceptedKnowledge({ activeRoot, taskRoot, runId: 'bad', plan: firstPlan, snapshot, receipt: { status: 'provisional' } }),
  error => error instanceof ProjectKnowledgeError && error.code === 'KNOWLEDGE_PERSIST_UNACCEPTED'
)

const cliRepo = path.join(tempRoot, 'cli-repo')
fs.mkdirSync(cliRepo, { recursive: true })
fs.writeFileSync(path.join(cliRepo, 'a.js'), 'module.exports=1\n')
fs.writeFileSync(path.join(cliRepo, 'b.js'), 'module.exports=2\n')
fs.writeFileSync(path.join(cliRepo, 'c.js'), 'module.exports=3\n')
const boundedScan = scanProjectInventory(cliRepo, { maxFiles: 2, maxBytes: 1024 })
assert.strictEqual(boundedScan.fileCount, 2)
assert.strictEqual(boundedScan.bounded, false)
assert.strictEqual(boundedScan.overflowReason, 'max-files-exceeded')
const boundedRepoIdentity = buildRepoIdentity(cliRepo, boundedScan, { baseIdentity: 'bounded-fixture' })
const blockedPlan = buildIncrementalAnalysisPlan({
  snapshot: null,
  inventory: boundedScan,
  repoIdentity: boundedRepoIdentity,
  graph: { coverage: 1, edges: [] },
  lens: { lensId: 'bounded', questionFingerprint: 'bounded-q' },
  options: { maxBatchFiles: 1 }
})
assert.strictEqual(blockedPlan.completion, 'blocked')
assert.strictEqual(blockedPlan.batches.length, 0)
assert.throws(
  () => acceptKnowledgeBatch({
    snapshot: null,
    inventory: boundedScan,
    repoIdentity: boundedRepoIdentity,
    plan: blockedPlan,
    batchId: 'must-not-exist',
    validationResult: { status: 'pass' },
    sampleOracle: verifyReuseSample({ samplePaths: [] })
  }),
  error => error instanceof ProjectKnowledgeError && error.code === 'KNOWLEDGE_ACCEPT_INVENTORY_INCOMPLETE'
)
const cliActive = path.join(tempRoot, 'cli-active')
const cli = spawnSync(process.execPath, [
  path.join(ROOT, 'scripts', 'project-analysis-state.js'), 'plan', '--repo', cliRepo, '--active-root', cliActive,
  '--lens', 'fixture', '--question', 'fixture-q', '--json'
], { cwd: ROOT, encoding: 'utf8', windowsHide: true })
assert.strictEqual(cli.status, 0, cli.stderr || cli.stdout)
const cliEnvelope = JSON.parse(cli.stdout)
assert.strictEqual(cliEnvelope.schemaVersion, 'ProjectAnalysisStateCliV1')
assert.strictEqual(cliEnvelope.data.fullRequired, true)
assert.strictEqual(fs.existsSync(cliActive), false, 'plan must not write accepted runtime state')

fs.rmSync(tempRoot, { recursive: true, force: true })
console.log('project knowledge tests passed: change/config/rename/delete/lens/oracle/batch-resume sample=5%-min3-max20 requiredFindingMiss=0')
