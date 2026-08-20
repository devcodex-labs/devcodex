#!/usr/bin/env node
'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { createLinkCapabilityDecision } = require('../hooks/_runtime/visible-output-contract.cjs')

const ROOT = path.resolve(__dirname, '..')
const FIXTURE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-artifact-links-'))
const PROJECT_ROOT = path.join(FIXTURE_ROOT, 'link-test')
const ACTIVE_ROOT = path.join(FIXTURE_ROOT, '.devcodex', 'link-test')

function request(id, name, argumentsValue = {}) {
  return JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: argumentsValue } })
}

function run(requests) {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'mcp', 'memory-server.js'), PROJECT_ROOT], {
    cwd: ROOT,
    encoding: 'utf8',
    input: `${requests.join('\n')}\n`,
    env: { ...process.env, DEVCODEX_AGENT: 'codex' }
  })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'memory server failed')
  return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
}

function resultById(responses, id) {
  const envelope = responses.find(item => item.id === id)
  assert(envelope?.result, `missing JSON-RPC result ${id}`)
  return envelope.result
}

function toolJson(result) {
  return result.structuredContent || JSON.parse(result.content[0].text.split(/\r?\n/).filter(Boolean).at(-1))
}

function setupFixture() {
  fs.mkdirSync(PROJECT_ROOT, { recursive: true })
  fs.mkdirSync(path.join(FIXTURE_ROOT, '.devcodex', 'workspace', 'profile'), { recursive: true })
  fs.mkdirSync(path.join(ACTIVE_ROOT, 'profile'), { recursive: true })
  fs.writeFileSync(path.join(PROJECT_ROOT, 'package.json'), '{}\n', 'utf8')
  fs.writeFileSync(
    path.join(FIXTURE_ROOT, '.devcodex', 'layout.json'),
    `${JSON.stringify({ version: 1, mode: 'workspace-namespace' }, null, 2)}\n`,
    'utf8'
  )
  fs.writeFileSync(path.join(FIXTURE_ROOT, '.devcodex', 'workspace', 'profile', 'README.md'), '# workspace\n', 'utf8')
  fs.writeFileSync(path.join(ACTIVE_ROOT, 'profile', 'README.md'), '# link-test\n', 'utf8')
  fs.writeFileSync(path.join(ACTIVE_ROOT, 'profile', '01-项目信息.md'), '# link-test\n', 'utf8')
  fs.writeFileSync(path.join(ACTIVE_ROOT, 'profile', 'config.json'), '{"mode":"dev","agent":"codex"}\n', 'utf8')
  fs.mkdirSync(path.join(ACTIVE_ROOT, 'reports'), { recursive: true })
  fs.writeFileSync(path.join(ACTIVE_ROOT, 'reports', 'Report One.md'), '# Report One\n', 'utf8')
}

setupFixture()

const allocationResult = resultById(run([
  request(1, 'memory_session_allocate', {
    date: '20260820', title: 'artifact link projection', intent: 'fix'
  })
]), 1)
assert.notStrictEqual(allocationResult.isError, true)
const allocation = toolJson(allocationResult)
const documentPath = '.memory/clients/codex/tasks/20260820.md'
const capability = createLinkCapabilityDecision({
  surface: 'artifact-link-targeted-test',
  evidenceState: 'verified',
  supportsMarkdown: true,
  supportsClickable: false,
  workspaceRoot: ACTIVE_ROOT,
  targetRelation: 'workspace',
  evidenceRefs: ['targeted-test:canonical-containment']
})
const artifact = {
  id: 'report',
  label: 'Report One',
  targetPath: 'reports/Report One.md',
  purpose: 'targeted integration report'
}

const projectionResult = resultById(run([
  request(2, 'memory_artifact_link_project', {
    operation: 'project',
    documentPath,
    artifacts: [artifact, { ...artifact, id: 'duplicate', label: 'Duplicate' }],
    linkCapability: capability
  })
]), 2)
assert.notStrictEqual(projectionResult.isError, true)
const projection = toolJson(projectionResult)
assert.strictEqual(projection.schemaVersion, 'ArtifactLinkProjectionSetV1')
assert.strictEqual(projection.dedupe.inputCount, 2)
assert.strictEqual(projection.dedupe.projectedCount, 1)
assert.strictEqual(projection.dedupe.suppressedCount, 1)
assert.strictEqual(projection.links[0].markdown, '[Report One](<../../../../reports/Report One.md>)')

const writeResult = resultById(run([
  request(3, 'memory_session_write', {
    date: '20260820',
    sessionId: allocation.sessionId,
    sessionBinding: allocation.sessionBinding,
    content: 'C1 targeted writer replay\n',
    artifacts: [artifact]
  })
]), 3)
assert.notStrictEqual(writeResult.isError, true)
const writeReceipt = toolJson(writeResult)
assert.strictEqual(writeReceipt.artifactLinks.validation.valid, true)
assert.strictEqual(writeReceipt.artifactLinkReadback.existingValidation.status, 'verified')
assert.strictEqual(writeReceipt.localLinkValidation.validation.valid, true)

const dailyPath = path.join(ACTIVE_ROOT, ...documentPath.split('/'))
assert.match(fs.readFileSync(dailyPath, 'utf8'), /\[Report One\]\(<\.\.\/\.\.\/\.\.\/\.\.\/reports\/Report One\.md>\)/)

const summaryResult = resultById(run([
  request(4, 'memory_summary_append', {
    row: '| 2026-08-20 | 01 | fix | targeted artifact projection | — | — | 🔄 |',
    reportArtifact: {
      label: 'Report One', targetPath: 'reports/Report One.md', purpose: 'targeted integration report'
    },
    memoryArtifact: {
      label: 'Daily Memory', targetPath: documentPath, purpose: 'targeted daily memory'
    }
  })
]), 4)
assert.notStrictEqual(summaryResult.isError, true)
const summaryReceipt = toolJson(summaryResult)
assert.strictEqual(summaryReceipt.artifactLinks.links.length, 2)
assert.strictEqual(summaryReceipt.artifactLinkReadback.existingValidation.status, 'verified')

const taskRoot = path.join(ACTIVE_ROOT, 'bugs', 'link-task')
const cpArtifact = path.join(taskRoot, '02-solution.md')
fs.mkdirSync(path.join(taskRoot, '.memory'), { recursive: true })
fs.writeFileSync(cpArtifact, '# solution\n', 'utf8')
const cpSha = crypto.createHash('sha256').update(fs.readFileSync(cpArtifact)).digest('hex')
const cpResult = resultById(run([
  request(5, 'memory_cp_confirm', {
    requirement: 'link-task',
    kind: 'bugs',
    phase: 'CP2',
    artifactPath: '02-solution.md',
    artifactVersion: 'v0.1.0',
    artifactSha256: cpSha,
    sourceMessage: 'targeted confirmation'
  })
]), 5)
assert.notStrictEqual(cpResult.isError, true)
assert.strictEqual(cpResult.structuredContent.artifactLinkReadback.existingValidation.status, 'verified')
assert.match(
  fs.readFileSync(path.join(taskRoot, '.memory', 'sessions.md'), 'utf8'),
  /\[02-solution\.md\]\(\.\.\/02-solution\.md\)/
)

const validateResult = resultById(run([
  request(6, 'memory_artifact_link_project', {
    operation: 'validate-existing', documentPath, artifacts: [artifact], linkCapability: capability
  })
]), 6)
assert.strictEqual(toolJson(validateResult).existingValidation.status, 'verified')

const dailyBeforeNegatives = fs.readFileSync(dailyPath, 'utf8')
const invalidCapability = { ...capability, decisionId: 'tampered' }
const unrelatedWorkspace = path.join(FIXTURE_ROOT, 'unrelated-workspace')
fs.mkdirSync(unrelatedWorkspace, { recursive: true })
const mismatchedCapability = createLinkCapabilityDecision({
  surface: 'artifact-link-mismatched-root',
  evidenceState: 'verified',
  supportsMarkdown: true,
  supportsClickable: false,
  workspaceRoot: unrelatedWorkspace,
  targetRelation: 'workspace',
  evidenceRefs: ['targeted-test:mismatched-root']
})
const negatives = run([
  request(10, 'memory_artifact_link_project', {
    documentPath, artifacts: [{ ...artifact, targetPath: 'reports/Missing.md' }], linkCapability: capability
  }),
  request(11, 'memory_artifact_link_project', {
    documentPath, artifacts: [artifact], linkCapability: invalidCapability
  }),
  request(12, 'memory_session_write', {
    date: '20260820', sessionId: allocation.sessionId, sessionBinding: allocation.sessionBinding,
    content: '[broken](../../../../reports/Missing.md)\n'
  }),
  request(13, 'memory_session_write', {
    date: '20260820', sessionId: allocation.sessionId, sessionBinding: allocation.sessionBinding,
    content: '[forbidden](file:///C:/outside.md)\n'
  }),
  request(14, 'memory_artifact_link_project', {
    documentPath, artifacts: [{ ...artifact, targetPath: '../outside.md' }], linkCapability: capability
  }),
  request(15, 'memory_artifact_link_project', {
    documentPath, artifacts: [artifact], linkCapability: mismatchedCapability
  }),
  request(16, 'memory_artifact_link_project', {
    operation: 'validate-existing',
    documentPath,
    artifacts: [{ ...artifact, label: 'Link not written' }],
    linkCapability: capability
  }),
  request(17, 'memory_session_write', {
    date: '20260820', sessionId: allocation.sessionId, sessionBinding: allocation.sessionBinding,
    content: '[spaces require angle](../../../../reports/Report One.md)\n'
  })
])
const expectedCodes = new Map([
  [10, 'ARTIFACT_LINK_TARGET_INVALID'],
  [11, 'ARTIFACT_LINK_CAPABILITY_INVALID'],
  [12, 'ARTIFACT_LINK_TARGET_MISSING'],
  [13, 'ARTIFACT_LINK_FILE_URI_REJECTED'],
  [14, 'ARTIFACT_LINK_PATH_INVALID'],
  [15, 'ARTIFACT_LINK_CAPABILITY_ROOT_MISMATCH'],
  [16, 'ARTIFACT_LINK_READBACK_MISSING'],
  [17, 'ARTIFACT_LINK_DESTINATION_INVALID']
])
for (const [id, code] of expectedCodes) {
  const result = resultById(negatives, id)
  assert.strictEqual(result.isError, true)
  assert.strictEqual(result.structuredContent.errorCode, code)
}
assert.strictEqual(fs.readFileSync(dailyPath, 'utf8'), dailyBeforeNegatives)

if (process.env.DEVCODEX_KEEP_TEST_ARTIFACTS === '1') {
  process.stdout.write(`${JSON.stringify({ status: 'PASS', retainedFixture: FIXTURE_ROOT })}\n`)
} else {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true })
  process.stdout.write(`${JSON.stringify({ status: 'PASS', retainedFixture: null })}\n`)
}
