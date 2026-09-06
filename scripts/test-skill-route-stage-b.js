#!/usr/bin/env node
'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const {
  MAX_LAYERED_SKILL_BYTES,
  resolveProjectSkillsRoot,
  resolveSkillRead
} = require('../hooks/_runtime/skill-resolution.cjs')
const {
  buildRuntimeSkillIdentityIndex,
  hydrateRuntimeSkillIdentityIndex
} = require('../hooks/_runtime/runtime-skill-identity-index.cjs')
const {
  MAX_CARDS_PER_PAGE,
  buildUnifiedSkillCatalog,
  shortlistSkillCards
} = require('../hooks/_runtime/model-skill-catalog.cjs')
const {
  buildMetadataClosure,
  hydrateExactSkill
} = require('../hooks/_runtime/layered-skill-resolver-v1.cjs')
const {
  deriveTurnBinding
} = require('../hooks/_runtime/skill-route-state.cjs')
const {
  handleSkillRoute
} = require('../hooks/_runtime/skill-route-tool.cjs')
const {
  createSkillRouteFixture,
  writeWorkspaceSkill
} = require('./lib/skill-route-test-fixture')

function sha256File (file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function writeSkill (skillsRoot, skillId, options = {}) {
  const root = path.join(skillsRoot, skillId)
  fs.mkdirSync(root, { recursive: true })
  const requires = Array.isArray(options.requires) && options.requires.length
    ? `requires: ${options.requires.join(',')}`
    : ''
  const body = options.body == null
    ? `STAGE_B_SKILL_BODY_${skillId}`
    : String(options.body)
  fs.writeFileSync(path.join(root, 'SKILL.md'), [
    '---',
    `name: ${skillId}`,
    `description: Route the Stage B ${skillId} fixture.`,
    requires,
    '---',
    `# ${skillId}`,
    '',
    body
  ].filter(Boolean).join('\n'), 'utf8')
  if (options.intent === true) {
    fs.writeFileSync(path.join(root, 'intent.json'), `${JSON.stringify({
      schemaVersion: 'SkillIntentV1',
      skillId,
      intents: [{ id: 'stage-b', label: 'Stage B routing', include: ['stage', 'route'] }],
      examples: {
        positive: [`Use ${skillId}`, `Route ${skillId}`],
        negative: ['Write release notes', 'Inspect an unrelated file']
      },
      summary: `Use the exact ${skillId} Stage B fixture.`
    }, null, 2)}\n`, 'utf8')
  }
  return root
}

function exactRequest (fixture, skillId, extra = {}) {
  const contextEpoch = extra.contextEpoch || `ctx-exact-${skillId}`
  return {
    op: 'resolve_exact',
    project: fixture.project,
    turnBinding: deriveTurnBinding(fixture.project, fixture.activeRoot, contextEpoch),
    contextEpoch,
    skillId,
    ...extra
  }
}

function readAllExactPages (fixture, initial) {
  const responses = []
  let request = { ...initial }
  do {
    const response = handleSkillRoute(request, fixture.runtimeOptions)
    assert.strictEqual(response.ok, true, JSON.stringify(response))
    assert(response.delivery.serializedBytes <= response.delivery.limitBytes)
    responses.push(response)
    request = response.receipt.nextCursor
      ? { ...initial, cursor: response.receipt.nextCursor }
      : null
  } while (request)
  return responses
}

const fixture = createSkillRouteFixture()
const fixtureRoot = fixture.root

try {
  const projectSkillsRoot = path.join(fixture.activeRoot, 'skills')
  const workspaceSkillsRoot = path.join(fixture.root, '.devcodex', 'workspace', 'skills')
  const portfolioPath = fixture.globalRuntime.portfolioPath
  const portfolioBefore = sha256File(portfolioPath)

  const nestedActiveRoot = path.join(fixture.root, '.devcodex', 'apps', 'api')
  const nestedProjectSkillsRoot = path.join(nestedActiveRoot, 'skills')
  writeSkill(nestedProjectSkillsRoot, 'nested-project-skill', { body: 'NESTED_PROJECT_LAYER' })
  assert.strictEqual(resolveProjectSkillsRoot(fixture.projectRoot, {
    ...fixture.runtimeOptions,
    project: 'apps/api',
    activeRoot: nestedActiveRoot
  }), nestedProjectSkillsRoot)
  const nestedProjectResolved = resolveSkillRead('nested-project-skill', {
    ...fixture.runtimeOptions,
    cwd: fixture.projectRoot,
    project: 'apps/api',
    activeRoot: nestedActiveRoot
  })
  assert.strictEqual(nestedProjectResolved.trace.selectedLayer, 'project')
  assert.match(nestedProjectResolved.content, /NESTED_PROJECT_LAYER/)

  // P > W > G and preferred-layer selection use one canonical resolver.
  writeWorkspaceSkill(fixture.root, 'analyze-default', '-workspace')
  writeSkill(projectSkillsRoot, 'analyze-default', { body: 'PROJECT_LAYER_WINS' })
  let resolved = resolveSkillRead('analyze-default', {
    ...fixture.runtimeOptions,
    cwd: fixture.projectRoot,
    project: fixture.project,
    activeRoot: fixture.activeRoot
  })
  assert.strictEqual(resolved.trace.selectedLayer, 'project')
  assert.match(resolved.content, /PROJECT_LAYER_WINS/)
  fs.rmSync(path.join(projectSkillsRoot, 'analyze-default'), { recursive: true, force: true })
  resolved = resolveSkillRead('analyze-default', {
    ...fixture.runtimeOptions,
    cwd: fixture.projectRoot,
    project: fixture.project,
    activeRoot: fixture.activeRoot
  })
  assert.strictEqual(resolved.trace.selectedLayer, 'workspace')
  fs.rmSync(path.join(workspaceSkillsRoot, 'analyze-default'), { recursive: true, force: true })
  resolved = resolveSkillRead('analyze-default', {
    ...fixture.runtimeOptions,
    cwd: fixture.projectRoot,
    project: fixture.project,
    activeRoot: fixture.activeRoot
  })
  assert.strictEqual(resolved.trace.selectedLayer, 'global')

  writeSkill(projectSkillsRoot, 'intent', { body: 'MUST_NOT_OVERRIDE_RESERVED' })
  const reserved = resolveSkillRead('intent', {
    ...fixture.runtimeOptions,
    cwd: fixture.projectRoot,
    project: fixture.project,
    activeRoot: fixture.activeRoot
  })
  assert.strictEqual(reserved.trace.selectedLayer, 'global')
  assert.strictEqual(reserved.trace.securityDecision, 'reserved-blocked-p')

  // Exact resolution bypasses catalog and pages the root plus explicit deps.
  writeSkill(workspaceSkillsRoot, 'exact-dep', { body: 'EXACT_DEPENDENCY_BODY' })
  writeSkill(workspaceSkillsRoot, 'exact-root', { body: 'WORKSPACE_EXACT_BODY' })
  writeSkill(projectSkillsRoot, 'exact-root', {
    requires: ['exact-dep'],
    body: 'PROJECT_EXACT_BODY'
  })
  const exact = exactRequest(fixture, 'exact-root')
  const exactPages = readAllExactPages(fixture, exact)
  assert.strictEqual(exactPages.at(-1).receipt.status, 'loaded')
  assert.strictEqual(exactPages[0].receipt.selected.layer, 'project')
  assert.deepStrictEqual(exactPages[0].receipt.loadOrder, ['exact-dep', 'exact-root'])
  assert(exactPages[0].receipt.warnings.some(item => item.code === 'SKILL_INTENT_ABSENT'))
  const reconstructed = exactPages.map(page => page.bodyChunks[0].content).join('\n')
  assert.match(reconstructed, /EXACT_DEPENDENCY_BODY/)
  assert.match(reconstructed, /PROJECT_EXACT_BODY/)

  const workspaceExact = readAllExactPages(fixture, {
    ...exactRequest(fixture, 'exact-root', { preferredLayer: 'workspace' })
  })
  assert.strictEqual(workspaceExact[0].receipt.selected.layer, 'workspace')
  assert.match(workspaceExact.map(page => page.bodyChunks[0].content).join(''), /WORKSPACE_EXACT_BODY/)

  const wrongDigest = handleSkillRoute({
    ...exact,
    expectedContentDigest: '0'.repeat(64)
  }, fixture.runtimeOptions)
  assert.strictEqual(wrongDigest.ok, false)
  assert.strictEqual(wrongDigest.errorCode, 'SKILL_CONTENT_DIGEST_MISMATCH')
  assert.strictEqual(wrongDigest.details.baselineTaskMayContinue, true)

  const forgedCursor = handleSkillRoute({ ...exact, cursor: 'forged.cursor' }, fixture.runtimeOptions)
  assert.strictEqual(forgedCursor.ok, false)
  assert.strictEqual(forgedCursor.errorCode, 'SKILL_EXACT_CURSOR_INVALID')

  // UTF-8-safe multi-page reconstruction stays below the public response cap.
  const largeBody = '中abc'.repeat(28 * 1024)
  writeSkill(projectSkillsRoot, 'large-exact', { body: largeBody })
  const largePages = readAllExactPages(fixture, exactRequest(fixture, 'large-exact'))
  assert(largePages.length >= 3)
  assert.strictEqual(
    largePages.map(page => page.bodyChunks[0].content).join('').includes(largeBody),
    true
  )

  const oversizeRoot = writeSkill(projectSkillsRoot, 'oversize-exact', { body: 'x' })
  const oversizeFile = path.join(oversizeRoot, 'SKILL.md')
  fs.truncateSync(oversizeFile, MAX_LAYERED_SKILL_BYTES + 1)
  const oversize = handleSkillRoute(exactRequest(fixture, 'oversize-exact'), fixture.runtimeOptions)
  assert.strictEqual(oversize.ok, false)
  assert.strictEqual(oversize.errorCode, 'SKILL_BODY_TOO_LARGE')
  assert.strictEqual(oversize.details.baselineTaskMayContinue, true)

  writeSkill(projectSkillsRoot, 'cycle-a', { requires: ['cycle-b'] })
  writeSkill(projectSkillsRoot, 'cycle-b', { requires: ['cycle-a'] })
  const cycle = handleSkillRoute(exactRequest(fixture, 'cycle-a'), fixture.runtimeOptions)
  assert.strictEqual(cycle.ok, false)
  assert.strictEqual(cycle.errorCode, 'SKILL_DEPENDENCY_CYCLE')

  writeSkill(projectSkillsRoot, 'toctou', { body: 'BEFORE' })
  const toctouClosure = buildMetadataClosure('toctou', null, {
    ...fixture.runtimeOptions,
    cwd: fixture.projectRoot,
    project: fixture.project,
    activeRoot: fixture.activeRoot
  })
  const toctouMetadata = toctouClosure.byId.get('toctou')
  fs.appendFileSync(toctouMetadata.selectedPath, '\nAFTER', 'utf8')
  assert.throws(() => hydrateExactSkill(toctouMetadata, {
    ...fixture.runtimeOptions,
    cwd: fixture.projectRoot,
    project: fixture.project,
    activeRoot: fixture.activeRoot
  }), error => error.code === 'SKILL_METADATA_BODY_DRIFT')

  // 1000 project Skills exercise metadata-only inventory and non-blocking catalog paging.
  const scaleCount = 1000
  for (let index = 0; index < scaleCount; index += 1) {
    writeSkill(projectSkillsRoot, `scale-${String(index).padStart(4, '0')}`)
  }
  const hostNative = path.join(fixture.root, '.codex', 'skills', 'host-only')
  writeSkill(path.dirname(hostNative), path.basename(hostNative), { body: 'HOST_OWNS_THIS' })
  let fullSkillBodyReads = 0
  const countingFs = Object.create(fs)
  countingFs.readFileSync = (file, ...args) => {
    if (path.basename(String(file)).toLowerCase() === 'skill.md' && args[0] === 'utf8') {
      fullSkillBodyReads += 1
    }
    return fs.readFileSync(file, ...args)
  }
  const index = buildRuntimeSkillIdentityIndex({
    ...fixture.runtimeOptions,
    cwd: fixture.projectRoot,
    project: fixture.project,
    activeRoot: fixture.activeRoot,
    fs: countingFs,
    indexTimeSliceMs: 60000
  })
  assert(index.coverage.scannedP >= scaleCount)
  assert.strictEqual(index.coverage.scanTimedOut, false)
  assert.strictEqual(fullSkillBodyReads, 0, 'metadata index must not read full unselected Skill bodies')
  assert.strictEqual(index.entries.some(entry => entry.skillId === 'host-only'), false)
  assert(index.entries.every(entry => entry.bodyDigestKind === 'metadata'))

  const hydratedIndex = hydrateRuntimeSkillIdentityIndex(index, ['scale-0999'], {
    ...fixture.runtimeOptions,
    cwd: fixture.projectRoot,
    project: fixture.project,
    activeRoot: fixture.activeRoot,
    fs: countingFs
  })
  assert.strictEqual(fullSkillBodyReads, 1)
  assert.strictEqual(
    hydratedIndex.entries.find(entry => entry.skillId === 'scale-0999').bodyDigestKind,
    'full'
  )
  assert.strictEqual(hydratedIndex.hydration.unselectedBodyReads, 0)

  const driftedScaleFile = path.join(projectSkillsRoot, 'scale-0998', 'SKILL.md')
  fs.appendFileSync(driftedScaleFile, '\nCHANGED_AFTER_METADATA_INDEX\n', 'utf8')
  assert.throws(() => hydrateRuntimeSkillIdentityIndex(index, ['scale-0998'], {
    ...fixture.runtimeOptions,
    cwd: fixture.projectRoot,
    project: fixture.project,
    activeRoot: fixture.activeRoot,
    fs: countingFs
  }), error => error.code === 'SKILL_METADATA_BODY_DRIFT')

  const identity = {
    project: fixture.project,
    turnBinding: 'turn-stage-b-scale',
    contextEpoch: 'ctx-stage-b-scale'
  }
  const fullCatalog = buildUnifiedSkillCatalog(index, identity)
  assert(fullCatalog.pages.length > 5)
  assert.strictEqual(fullCatalog.totalBudgetExceeded, true)
  assert(fullCatalog.pages.every(page => page.cards.length <= MAX_CARDS_PER_PAGE))
  const shortlist = shortlistSkillCards(index.cards, 'please use scale-0999', index.entries)
  assert.strictEqual(shortlist.length, 8)
  assert.strictEqual(shortlist[0].skillId, 'scale-0999')
  const shortlistCatalog = buildUnifiedSkillCatalog(index, identity, { cards: shortlist })
  assert.strictEqual(shortlistCatalog.candidateCount, 8)
  assert.strictEqual(shortlistCatalog.deliveryMode, 'metadata-shortlist')

  // Custom layers are discovered dynamically and never mutate product portfolio truth.
  assert.strictEqual(sha256File(portfolioPath), portfolioBefore)

  process.stdout.write(`${JSON.stringify({
    status: 'PASS',
    schemaVersion: 'StageBSkillRouteAcceptanceV1',
    scaleCount,
    effectiveSkills: index.coverage.effective,
    catalogPages: fullCatalog.pages.length,
    shortlistCount: shortlistCatalog.candidateCount,
    exactPages: exactPages.length,
    largeExactPages: largePages.length,
    fullUnselectedBodyReads: hydratedIndex.hydration.unselectedBodyReads,
    hostNativeOwnership: index.roots.hostNativePersonal
  })}\n`)
} finally {
  fixture.cleanup()
}

assert.strictEqual(fs.existsSync(fixtureRoot), false, 'Stage B SkillRoute fixture must be cleaned exactly')
