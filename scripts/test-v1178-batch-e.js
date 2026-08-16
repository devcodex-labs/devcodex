#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  PROFILE_CURRENT_TRUTH_REF,
  extractWorkflowCurrentTruth,
  parseProfileCurrentTruth,
  validateDevCodexCurrentTruth
} = require('./lib/profile-current-truth')
const {
  verifyProfileSourceSnapshots
} = require('../mcp/profile-server')

const ROOT = path.resolve(__dirname, '..')
const PROFILE_ROOT = path.resolve(ROOT, '..', '.devcodex', 'devcodex', 'profile')
const ACTIVE_PROFILE_AVAILABLE = fs.existsSync(path.join(PROFILE_ROOT, '05-发布规范.md'))
let passed = 0

function probe(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

function profile(fileName) {
  return fs.readFileSync(path.join(PROFILE_ROOT, fileName), 'utf8')
}

function currentRecord(overrides = {}) {
  return {
    schemaVersion: 'ProfileCurrentTruthV1',
    sourceVersion: '1.17.8',
    releaseState: 'released',
    npmLatest: '1.17.8',
    gitHead: '85f3a8eadf61b0614f88d6817d255f255de968c2',
    ciRun: { id: '31910021943', status: 'PASS', observedAt: '2026-08-16T13:47:39Z', completedAt: '2026-08-15T21:49:27Z' },
    publishRun: { id: '31910507513', status: 'PASS', observedAt: '2026-08-16T13:47:39Z', completedAt: '2026-08-15T21:59:55Z' },
    githubRelease: { tag: 'v1.17.8', status: 'PASS', observedAt: '2026-08-16T13:47:39Z', publishedAt: '2026-08-15T22:00:24Z' },
    asOf: '2026-08-16T13:47:39Z',
    ciMatrix: extractWorkflowCurrentTruth(read('.github/workflows/ci.yml')),
    ...overrides
  }
}

function candidateRecord(overrides = {}) {
  return currentRecord({
    sourceVersion: '1.17.9',
    releaseState: 'candidate / local-qualification / external-pending',
    candidate: {
      targetVersion: '1.17.9',
      targetTag: 'v1.17.9',
      status: 'LOCAL_QUALIFICATION',
      releaseAuthorized: true,
      externalState: 'pending'
    },
    ...overrides
  })
}

function recordMarkdown(record = currentRecord()) {
  return `# Release\n\n## ProfileCurrentTruthV1\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\`\n`
}

probe('ProfileCurrentTruthV1 strict generic schema', () => {
  assert.strictEqual(parseProfileCurrentTruth('# Generic profile\n').valid, true)
  assert.strictEqual(parseProfileCurrentTruth(recordMarkdown()).valid, true)
  assert.strictEqual(parseProfileCurrentTruth(recordMarkdown().replace(
    '## ProfileCurrentTruthV1\n',
    '## ProfileCurrentTruthV1\n\n'
  )).valid, false)
  assert.strictEqual(parseProfileCurrentTruth(`${recordMarkdown()}\n${recordMarkdown()}`).valid, false)
  const missing = currentRecord()
  delete missing.publishRun
  assert(parseProfileCurrentTruth(recordMarkdown(missing)).errors.some(item => item.includes('publishRun')))
})

probe('Profile current truth matches package, workflow, release, and refs', () => {
  const releaseProfileText = ACTIVE_PROFILE_AVAILABLE ? profile('05-发布规范.md') : recordMarkdown()
  const overviewProfileText = ACTIVE_PROFILE_AVAILABLE ? profile('01-项目信息.md') : `# Overview\n\n${PROFILE_CURRENT_TRUTH_REF}\n`
  const testProfileText = ACTIVE_PROFILE_AVAILABLE ? profile('04-测试规范.md') : `# Test\n\n${PROFILE_CURRENT_TRUTH_REF}\n`
  const docsProfileText = ACTIVE_PROFILE_AVAILABLE ? profile('07-用户文档与契约规范.md') : `# Docs\n\n${PROFILE_CURRENT_TRUTH_REF}\n`
  const result = validateDevCodexCurrentTruth({
    releaseProfileText,
    overviewProfileText,
    testProfileText,
    docsProfileText,
    packageVersion: JSON.parse(read('package.json')).version,
    gitHead: '85f3a8eadf61b0614f88d6817d255f255de968c2',
    workflowText: read('.github/workflows/ci.yml')
  })
  assert.deepStrictEqual(result.errors, [])
  assert.strictEqual(result.record.ciRun.id, '31910021943')
  assert.strictEqual(result.record.publishRun.id, '31910507513')
  assert.strictEqual(result.record.githubRelease.tag, 'v1.17.8')

  const missingOverviewRef = validateDevCodexCurrentTruth({
    releaseProfileText,
    overviewProfileText: '# Overview without current truth ref\n',
    testProfileText,
    docsProfileText,
    packageVersion: '1.17.8',
    gitHead: '85f3a8eadf61b0614f88d6817d255f255de968c2',
    workflowText: read('.github/workflows/ci.yml')
  })
  assert(missingOverviewRef.errors.some(item => item.includes('01-项目信息.md')))

  const changedWorkflow = read('.github/workflows/ci.yml').replace('node: 26.x', 'node: 28.x')
  const stale = validateDevCodexCurrentTruth({
    releaseProfileText,
    overviewProfileText,
    testProfileText,
    docsProfileText,
    packageVersion: '1.17.8',
    gitHead: '85f3a8eadf61b0614f88d6817d255f255de968c2',
    workflowText: changedWorkflow
  })
  assert(stale.errors.some(item => item.includes('ciMatrix drift')))
})

probe('Profile current truth distinguishes source candidate from released distribution', () => {
  const common = {
    overviewProfileText: `# Overview\n\n${PROFILE_CURRENT_TRUTH_REF}\n`,
    testProfileText: `# Test\n\n${PROFILE_CURRENT_TRUTH_REF}\n`,
    docsProfileText: `# Docs\n\n${PROFILE_CURRENT_TRUTH_REF}\n`,
    packageVersion: '1.17.9',
    gitHead: '85f3a8eadf61b0614f88d6817d255f255de968c2',
    workflowText: read('.github/workflows/ci.yml')
  }
  const valid = validateDevCodexCurrentTruth({
    ...common,
    releaseProfileText: recordMarkdown(candidateRecord())
  })
  assert.deepStrictEqual(valid.errors, [])

  for (const [label, record] of [
    ['target version', candidateRecord({ candidate: { ...candidateRecord().candidate, targetVersion: '1.17.10' } })],
    ['target tag', candidateRecord({ candidate: { ...candidateRecord().candidate, targetTag: 'v1.17.8' } })],
    ['authorization', candidateRecord({ candidate: { ...candidateRecord().candidate, releaseAuthorized: false } })],
    ['external state', candidateRecord({ candidate: { ...candidateRecord().candidate, externalState: 'published' } })],
    ['previous release', candidateRecord({ npmLatest: '1.17.9', githubRelease: { ...currentRecord().githubRelease, tag: 'v1.17.9' } })]
  ]) {
    const result = validateDevCodexCurrentTruth({
      ...common,
      releaseProfileText: recordMarkdown(record)
    })
    assert(result.errors.length > 0, `${label} drift must fail closed`)
  }

  const releasedWithCandidate = validateDevCodexCurrentTruth({
    ...common,
    packageVersion: '1.17.8',
    releaseProfileText: recordMarkdown(currentRecord({ candidate: candidateRecord().candidate }))
  })
  assert(releasedWithCandidate.errors.some(item => item.includes('must not retain candidate state')))
})

probe('Profile final source identity rejects mutation and precedence changes', () => {
  const snapshot = {
    schemaVersion: 'ProfileSourceSnapshotV1',
    path: path.join(ROOT, 'virtual-profile.md'),
    exists: true,
    logicalBytes: 4,
    sourceBytesRead: 4,
    sourceDigest: 'a'.repeat(64),
    sourcePrefixDigest: 'a'.repeat(64),
    identity: { dev: '1', ino: '2', size: 4, mtimeMs: 10 }
  }
  const stable = verifyProfileSourceSnapshots([snapshot], { observe: expected => ({ ...expected }) })
  assert.strictEqual(stable.status, 'verified')
  assert.strictEqual(stable.retryPolicy.maxRetries, 1)

  assert.throws(
    () => verifyProfileSourceSnapshots([snapshot], {
      observe: expected => ({ ...expected, sourceDigest: 'b'.repeat(64) })
    }),
    error => error.code === 'PROFILE_SOURCE_CHANGED' && error.details.bodyDelivered === false
  )
  const missing = { ...snapshot, exists: false, logicalBytes: 0, sourceBytesRead: 0, sourceDigest: null, sourcePrefixDigest: null, identity: null }
  assert.throws(
    () => verifyProfileSourceSnapshots([missing], { observe: () => ({ ...snapshot }) }),
    error => error.details.reason === 'existence-changed'
  )
})

probe('Profile load verifies sources before observation or body delivery', () => {
  const source = read('mcp/profile-server.js')
  const start = source.indexOf('function handleProfileLoad(')
  const end = source.indexOf('\nfunction handleProfileGetMode(', start)
  const handler = source.slice(start, end === -1 ? source.length : end)
  const finalVerify = handler.indexOf('sourceFinalIdentity = verifyProfileSourceSnapshots(')
  const observation = handler.indexOf('recordMcpContextSourceObservations({')
  assert(finalVerify >= 0 && observation > finalVerify)
  assert.match(handler, /PROFILE_SOURCE_CHANGED[\s\S]*bodyDelivered:\s*false/)
  assert.match(handler, /meta\.bodyDelivered\s*=\s*true[\s\S]*recordMcpContextSourceObservations/)
  assert.match(source, /captureMissingSnapshots:\s*true/)
})

probe('public consumers use the repaired contracts', () => {
  const readme = read('README.md')
  const outputPaths = read('content/instructions/02-output-paths.instructions.md')
  const memoryInstructions = read('content/instructions/15-memory.instructions.md')
  const memorySkill = read('content/skills/memory/SKILL.md')
  const hostProjection = read('content/skills/host-instruction-projection/SKILL.md')
  const unreleased = read('changelogs/unreleased.md')
  const fixture = read('scripts/fixtures/capability-surface-decision/valid-controlled-tool.json')
  for (const text of [readme, outputPaths]) assert.match(text, /WorkspaceTempManifestV2/)
  assert.match(readme, /devcodex tmp maintain/)
  for (const text of [readme, memoryInstructions, memorySkill]) {
    assert.match(text, /MemoryCursorV1/)
    assert.match(text, /MemoryFileTransactionReceiptV1/)
  }
  assert.match(hostProjection, /GROK_FULL_BOOTSTRAP_(?:INACTIVE|ERROR)/)
  assert.match(hostProjection, /GrokSessionPrivateOwnerV1/)
  assert.match(unreleased, /ProfileCurrentTruthV1/)
  assert.match(fixture, /MemoryFileTransactionReceiptV1/)
  if (ACTIVE_PROFILE_AVAILABLE) {
    assert.strictEqual(profile('01-项目信息.md').split(PROFILE_CURRENT_TRUTH_REF).length - 1, 1)
    assert.strictEqual(profile('04-测试规范.md').split(PROFILE_CURRENT_TRUTH_REF).length - 1, 1)
    assert.strictEqual(profile('07-用户文档与契约规范.md').split(PROFILE_CURRENT_TRUTH_REF).length - 1, 1)
  }
  assert.doesNotMatch(read('scripts/lib/validate-context-read-controls.js'), /ProfileLoadReceiptV2/)
  assert.doesNotMatch(read('scripts/lib/validate-optimization-controls.js'), /ProfileLoadReceiptV2/)
})

assert.strictEqual(passed, 6)
console.log('v1.17.8+ Batch E tests passed: 6/6 (Profile CAS/current truth candidate/released/consumers)')
