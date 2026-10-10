'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { inspectLegacyHookState } = require('./cli-runtime-commands')
const { findLayoutInfo } = require('../../hooks/_runtime/workspace-layout.cjs')
const { executeGlobalHostTransaction } = require('./global-host-config-transaction')
const { createSkillRouteFixture, writeContextBindingState } = require('./skill-route-test-fixture')
const { bootstrapSkillRoute, loadEnvelope, atomicWriteJson } = require('../../hooks/_runtime/skill-route-state.cjs')

/** Exercise physical boundaries through production owners in an isolated tree. */
function runAuditBugRegressionFixtures () {
  const fixture = createSkillRouteFixture({ workspaceSkill: false })
  const root = path.join(fixture.root, 'audit-bugs')
  fs.mkdirSync(root)
  const oldArg = process.argv[2]
  const oldGlobal = process.env.DEVCODEX_GLOBAL_SKILLS_ROOT
  try {
    const inventory = path.join(root, 'inventory')
    fs.mkdirSync(inventory)
    for (let i = 0; i < 10000; i++) fs.writeFileSync(path.join(inventory, `f${String(i).padStart(5, '0')}`), '')
    assert.strictEqual(inspectLegacyHookState(inventory).truncated, false)
    fs.writeFileSync(path.join(inventory, 'z-overflow'), '')
    assert.strictEqual(inspectLegacyHookState(inventory).truncated, true)
    fs.unlinkSync(path.join(inventory, 'z-overflow'))
    fs.mkdirSync(path.join(inventory, 'z-last-directory'))
    fs.writeFileSync(path.join(inventory, 'z-last-directory', 'overflow'), '')
    assert.strictEqual(inspectLegacyHookState(inventory).truncated, true)

    const workspace = path.join(root, 'workspace')
    const child = path.join(workspace, 'child')
    fs.mkdirSync(path.join(workspace, '.devcodex'), { recursive: true })
    fs.mkdirSync(path.join(child, '.devcodex'), { recursive: true })
    fs.writeFileSync(path.join(workspace, '.devcodex', 'layout.json'), '{"mode":"workspace-namespace"}')
    assert.strictEqual(findLayoutInfo(child).workspaceRoot, workspace)
    const marker = path.join(child, '.devcodex', 'layout.json')
    for (const invalid of ['{bad', 'null', '[]', '{"mode":"unknown"}']) {
      fs.writeFileSync(marker, invalid)
      assert.throws(() => findLayoutInfo(child), error => error.code === 'WORKSPACE_LAYOUT_INVALID')
    }
    fs.writeFileSync(marker, '{"mode":"workspace-namespace"}')
    assert.strictEqual(findLayoutInfo(child).workspaceRoot, child)
    assert.strictEqual(findLayoutInfo(path.join(root, 'no-marker')).workspaceRoot, fixture.root, 'absent marker inherits the valid fixture workspace')

    for (const kind of ['destination', 'staged', 'backup', 'journal', 'index']) {
      const owner = path.join(root, kind, 'owner')
      const moved = path.join(root, kind, 'outside-owner')
      const configDir = path.join(owner, 'config')
      const transactionRoot = path.join(owner, 'transactions')
      const config = path.join(configDir, 'config.json')
      fs.mkdirSync(configDir, { recursive: true })
      fs.writeFileSync(config, 'before')
      const options = { allowedRoots: [owner], transactionRoot, crashAfterPhase: 'backed-up:0' }
      assert.throws(() => executeGlobalHostTransaction([{ path: config, content: 'after' }], options), /SIMULATED_CRASH/)
      // The transaction's index basename is owned by the implementation.
      const actualIndex = fs.readdirSync(transactionRoot).find(name => name.endsWith('.json') && name !== 'owner.lock')
      const index = JSON.parse(fs.readFileSync(path.join(transactionRoot, actualIndex), 'utf8'))
      const journalFile = index.entries[0].journalFile
      const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'))
      let unsafe
      if (kind === 'destination') {
        fs.renameSync(configDir, moved)
        fs.symlinkSync(moved, configDir, process.platform === 'win32' ? 'junction' : 'dir')
        unsafe = configDir
      } else {
        let directory
        if (kind === 'journal') directory = path.dirname(journalFile)
        else if (kind === 'index') directory = transactionRoot
        else {
          directory = path.join(owner, kind)
          fs.mkdirSync(directory)
          const sidecar = path.join(directory, path.basename(journal.operations[0][kind]))
          if (fs.existsSync(journal.operations[0][kind])) fs.renameSync(journal.operations[0][kind], sidecar)
          journal.operations[0][kind] = sidecar
          fs.writeFileSync(journalFile, JSON.stringify(journal))
        }
        fs.renameSync(directory, moved)
        fs.symlinkSync(moved, directory, process.platform === 'win32' ? 'junction' : 'dir')
        unsafe = directory
      }
      assert.throws(() => executeGlobalHostTransaction([], { allowedRoots: [owner], transactionRoot }), /GLOBAL_HOST_(?:OPERATION_(?:REPARSE|SYMLINK|ROOT_UNSAFE)|TRANSACTION_ROOT_UNSAFE)/, kind)
      const preservedJournal = kind === 'index'
        ? path.join(moved, path.relative(transactionRoot, journalFile))
        : kind === 'journal' ? path.join(moved, path.basename(journalFile)) : journalFile
      assert(fs.existsSync(preservedJournal), `${kind}: rejection preserves journal evidence`)
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(preservedJournal, 'utf8')), journal,
        `${kind}: rejection cannot rewrite journal evidence`)
      if (kind === 'destination') assert.strictEqual(fs.existsSync(path.join(moved, 'config.json')), false)
      if (process.platform === 'win32') fs.rmdirSync(unsafe)
      else fs.unlinkSync(unsafe)
    }

    process.argv[2] = fixture.root
    process.env.DEVCODEX_GLOBAL_SKILLS_ROOT = fixture.globalRuntime.root
    const { contextPlanSkillRouteBootstrap } = require('../../mcp/profile-server.js')
    for (const consumed of [false, true]) {
      const epoch = `ctx-refresh-${consumed}-${process.pid}`
      const old = bootstrapSkillRoute({ project: fixture.project, activeRoot: fixture.activeRoot,
        contextEpoch: epoch, mode: 'unified', cwd: fixture.projectRoot,
        hostSessionId: process.env.DEVCODEX_HOST_SESSION_ID || '', runtimeContractDigest: 'a'.repeat(64)
      }, fixture.runtimeOptions)
      if (consumed) {
        const loaded = loadEnvelope(fixture.activeRoot, old.bootstrap.turnBinding)
        loaded.envelope.state.decision = { skillId: null }
        atomicWriteJson(loaded.paths.envelope, loaded.envelope)
      }
      const refreshed = contextPlanSkillRouteBootstrap({ schemaVersion: 'ContextReadPlanV2', contextBinding: { contextEpoch: epoch } },
        { project: fixture.project, activeRoot: fixture.activeRoot }, { host: 'codex' })
      if (consumed) {
        assert.strictEqual(refreshed.errorCode, 'BOOTSTRAP_IDENTITY_COLLISION')
        assert.strictEqual(loadEnvelope(fixture.activeRoot, old.bootstrap.turnBinding).envelope.state.runtimeContractDigest, 'a'.repeat(64))
      } else {
        assert.strictEqual(refreshed.status, 'ready', JSON.stringify(refreshed))
        assert.notStrictEqual(refreshed.bootstrap.runtimeContractDigest, 'a'.repeat(64))
        assert.strictEqual(refreshed.bootstrap.turnBinding, old.bootstrap.turnBinding)
      }
    }
    const explicitEpoch = `ctx-explicit-refresh-${process.pid}`
    const explicitOld = bootstrapSkillRoute({ project: fixture.project, activeRoot: fixture.activeRoot,
      contextEpoch: explicitEpoch, mode: 'unified', cwd: fixture.projectRoot, explicitSkillId: 'fix-default',
      hostSessionId: process.env.DEVCODEX_HOST_SESSION_ID || '', runtimeContractDigest: 'a'.repeat(64)
    }, fixture.runtimeOptions)
    const explicitPlan = { schemaVersion: 'ContextReadPlanV2', contextBinding: { contextEpoch: explicitEpoch } }
    const target = { project: fixture.project, activeRoot: fixture.activeRoot }
    const explicitFresh = contextPlanSkillRouteBootstrap(explicitPlan, target, { host: 'codex' })
    assert.strictEqual(explicitFresh.status, 'ready', JSON.stringify(explicitFresh))
    const explicitLoaded = loadEnvelope(fixture.activeRoot, explicitOld.bootstrap.turnBinding)
    assert.strictEqual(explicitLoaded.envelope.state.explicit.requestedSkillId, 'fix-default')
    explicitLoaded.envelope.state.decision = { skillId: 'fix-default' }
    atomicWriteJson(explicitLoaded.paths.envelope, explicitLoaded.envelope)
    assert.strictEqual(contextPlanSkillRouteBootstrap(explicitPlan, target, { host: 'codex' }).status, 'reused-active-route', 'omitted explicit Skill cannot clear an active choice')

    // Production MCP omits packageRoot/globalRuntime overrides. Rebuilding a
    // source catalog must keep content/skills bound to its owning package.
    const { bootstrapSkillRouteForTurn, handleSkillRoute } = require('../../hooks/_runtime/skill-route-tool.cjs')
    const sourceEpoch = `ctx-source-package-${process.pid}`
    const sourceOptions = { inputRoot: fixture.root, env: {} }
    const sourceBootstrap = bootstrapSkillRouteForTurn({ project: fixture.project,
      contextEpoch: sourceEpoch, host: 'codex', cwd: fixture.projectRoot }, sourceOptions)
    const sourceBinding = { project: fixture.project, contextEpoch: sourceEpoch,
      turnBinding: sourceBootstrap.bootstrap.turnBinding }
    const contextBinding = writeContextBindingState(fixture, sourceEpoch, 'fix')
    let page = handleSkillRoute({ op: 'catalog', ...sourceBinding }, sourceOptions)
    assert.strictEqual(page.ok, true, JSON.stringify(page))
    while (page.receipt.nextCursor) {
      page = handleSkillRoute({ op: 'catalog', ...sourceBinding, cursor: page.receipt.nextCursor }, sourceOptions)
      assert.strictEqual(page.ok, true, JSON.stringify(page))
    }
    const sourceCommit = handleSkillRoute({ op: 'commit', ...sourceBinding, skillId: null,
      catalogDigest: page.receipt.catalogDigest, contextBinding }, sourceOptions)
    assert.strictEqual(sourceCommit.ok, true, JSON.stringify(sourceCommit))
  } finally {
    if (oldArg === undefined) delete process.argv[2]
    else process.argv[2] = oldArg
    if (oldGlobal === undefined) delete process.env.DEVCODEX_GLOBAL_SKILLS_ROOT
    else process.env.DEVCODEX_GLOBAL_SKILLS_ROOT = oldGlobal
    fixture.cleanup()
  }
}

module.exports = { runAuditBugRegressionFixtures }
