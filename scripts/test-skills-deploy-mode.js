'use strict'

/**
 * SkillsDeployModeV1: hidden G_RUNTIME + ownership-safe native roots + resolve mode.
 */

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  applyGlobalHostConfig,
  buildGlobalHostConfigPlan
} = require('./lib/global-host-config.js')
const { resolveSkillsDeployMode } = require('./lib/skills-deploy-mode.js')
const { resolveGlobalSkillsRoot } = require('../hooks/_runtime/skill-resolution.cjs')
const {
  MANAGED_SKILL_MARKER,
  listManagedSkillIds,
  pruneManagedSkillDirs,
  verifyManagedSkillDirOwnership
} = require('./lib/skill-deploy-filter.js')

const packageRoot = path.resolve(__dirname, '..')

assert.strictEqual(resolveSkillsDeployMode({}, {}), 'hidden')
assert.strictEqual(resolveSkillsDeployMode({ DEVCODEX_SKILLS_DEPLOY_MODE: 'legacy' }, {}), 'legacy')
assert.strictEqual(resolveSkillsDeployMode({}, { skillsDeployMode: 'legacy' }), 'legacy')

{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sdm-resolve-'))
  const env = { USERPROFILE: home, HOME: home }
  assert.ok(
    resolveGlobalSkillsRoot({ env, home }).replace(/\\/g, '/').endsWith('/.agents/devcodex/skills')
  )
  assert.ok(
    resolveGlobalSkillsRoot({ env: { ...env, DEVCODEX_SKILLS_DEPLOY_MODE: 'legacy' }, home })
      .replace(/\\/g, '/')
      .endsWith('/.agents/skills')
  )
  const override = path.join(home, 'custom-skills')
  assert.strictEqual(
    resolveGlobalSkillsRoot({ env: { ...env, DEVCODEX_GLOBAL_SKILLS_ROOT: override }, home }),
    path.resolve(override)
  )
  fs.rmSync(home, { recursive: true, force: true })
}

{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sdm-apply-'))
  const env = { USERPROFILE: home, HOME: home }
  // Same-id host-native user skills are not DevCodex-owned.
  const managed = listManagedSkillIds(packageRoot)
  assert.ok(managed.includes('routing'), 'fixture package should manage routing skill')
  const userContent = '---\nname: user-owned\n---\nkeep-me\n'
  for (const scan of [
    path.join(home, '.agents', 'skills', 'routing'),
    path.join(home, '.claude', 'skills', 'routing'),
    // Same-id gray user content is also outside DevCodex ownership.
    path.join(home, '.agents', 'skills', 'consumer-validation-engineering'),
    path.join(home, '.claude', 'skills', 'consumer-validation-engineering')
  ]) {
    fs.mkdirSync(scan, { recursive: true })
    fs.writeFileSync(path.join(scan, 'SKILL.md'), userContent, 'utf8')
  }

  const forgedRoutingDir = path.join(home, '.agents', 'skills', 'routing')
  const forgedRoutingFile = path.join(forgedRoutingDir, 'SKILL.md')
  const forgedRoutingDigest = crypto
    .createHash('sha256')
    .update(fs.readFileSync(forgedRoutingFile))
    .digest('hex')
  const forgedReceiptOnly = verifyManagedSkillDirOwnership(forgedRoutingDir, fs, {
    ownershipPaths: [forgedRoutingFile],
    ownershipDigests: { [forgedRoutingFile]: forgedRoutingDigest }
  })
  assert.strictEqual(forgedReceiptOnly.owned, false)
  assert.strictEqual(forgedReceiptOnly.reasonCode, 'ownership-marker-missing')
  const forgedMarkerFile = path.join(forgedRoutingDir, MANAGED_SKILL_MARKER)
  fs.writeFileSync(forgedMarkerFile, `${JSON.stringify({
    schemaVersion: 'DevCodexManagedSkillOwnershipV1',
    owner: 'devcodex',
    skillId: 'routing',
    files: [{ path: 'SKILL.md', digest: forgedRoutingDigest }]
  }, null, 2)}\n`, 'utf8')
  const forgedMarkerOnly = verifyManagedSkillDirOwnership(forgedRoutingDir, fs, {
    ownershipPaths: [forgedRoutingFile],
    ownershipDigests: { [forgedRoutingFile]: forgedRoutingDigest }
  })
  assert.strictEqual(forgedMarkerOnly.owned, false)
  assert.strictEqual(
    forgedMarkerOnly.reasonCode,
    'ownership-marker-not-receipt-owned'
  )
  fs.unlinkSync(forgedMarkerFile)

  const plan = buildGlobalHostConfigPlan({ packageRoot, env, home })
  assert.strictEqual(plan.skillsDeployMode, 'hidden')
  assert.ok(plan.operations.some(op =>
    String(op.path).includes(path.join('.agents', 'devcodex', 'skills', 'routing'))
  ))

  const applied = applyGlobalHostConfig({ packageRoot, env, home })
  assert.strictEqual(applied.transaction.status, 'committed')
  assert.strictEqual(
    fs.existsSync(path.join(home, '.agents', 'devcodex', 'skills', 'routing', 'SKILL.md')),
    true
  )
  assert.strictEqual(fs.readFileSync(path.join(home, '.agents', 'skills', 'routing', 'SKILL.md'), 'utf8'), userContent)
  assert.strictEqual(fs.readFileSync(path.join(home, '.claude', 'skills', 'routing', 'SKILL.md'), 'utf8'), userContent)
  assert.strictEqual(
    fs.existsSync(path.join(home, '.agents', 'skills', 'consumer-validation-engineering')),
    true,
    'unknown gray same-id user skill must be preserved in agents scan root'
  )
  assert.strictEqual(
    fs.existsSync(path.join(home, '.claude', 'skills', 'consumer-validation-engineering')),
    true,
    'unknown gray same-id user skill must be preserved in claude scan root'
  )
  assert.ok(
    applied.transaction.hosts.some(host =>
      (host.preservedNativeSkillCollisions || []).some(item => item.skillId === 'routing')
    ),
    'hidden apply must report preserved native collisions'
  )

  // Legacy mode may fill empty ids, but it cannot overwrite unknown same-id roots.
  const legacy = applyGlobalHostConfig({
    packageRoot,
    env,
    home,
    skillsDeployMode: 'legacy'
  })
  assert.strictEqual(legacy.transaction.status, 'committed')
  assert.strictEqual(
    fs.readFileSync(path.join(home, '.agents', 'skills', 'routing', 'SKILL.md'), 'utf8'),
    userContent
  )
  assert.strictEqual(
    fs.existsSync(path.join(home, '.agents', 'skills', 'compliance', 'SKILL.md')),
    true,
    'legacy mode should still deploy an unoccupied managed skill id'
  )
  assert.strictEqual(
    fs.existsSync(path.join(
      home,
      '.agents',
      'skills',
      'compliance',
      MANAGED_SKILL_MARKER
    )),
    true,
    'legacy managed skill must carry ownership marker'
  )
  const editedSummaryFile = path.join(home, '.agents', 'skills', 'summary', 'SKILL.md')
  const editedSummaryContent = '# User-edited summary skill\n'
  fs.writeFileSync(editedSummaryFile, editedSummaryContent, 'utf8')
  const legacyAgain = applyGlobalHostConfig({
    packageRoot,
    env,
    home,
    skillsDeployMode: 'legacy'
  })
  assert.strictEqual(legacyAgain.transaction.status, 'committed')
  assert.strictEqual(
    fs.readFileSync(editedSummaryFile, 'utf8'),
    editedSummaryContent,
    'legacy refresh must not overwrite a receipt-owned file modified by the user'
  )
  assert.ok(legacyAgain.transaction.hosts.some(host =>
    (host.preservedNativeSkillCollisions || []).some(item =>
      item.skillId === 'summary' && item.reasonCode === 'managed-content-modified'
    )
  ))
  const editedMemoryFile = path.join(home, '.agents', 'skills', 'memory', 'SKILL.md')
  const editedMemoryContent = '# User-edited memory skill\n'
  fs.writeFileSync(editedMemoryFile, editedMemoryContent, 'utf8')
  const mixedReportDir = path.join(home, '.agents', 'skills', 'report')
  fs.writeFileSync(
    path.join(mixedReportDir, 'user-note.md'),
    'user-owned extension\n',
    'utf8'
  )

  // Returning to hidden removes only receipt-owned legacy directories.
  const hiddenAgain = applyGlobalHostConfig({ packageRoot, env, home })
  assert.strictEqual(hiddenAgain.transaction.status, 'committed')
  assert.strictEqual(
    fs.existsSync(path.join(home, '.agents', 'skills', 'compliance')),
    false,
    'receipt-owned pure managed directory should be pruned'
  )
  assert.strictEqual(
    fs.existsSync(path.join(mixedReportDir, 'SKILL.md')),
    true,
    'mixed native directory must retain the formerly managed Skill body'
  )
  assert.strictEqual(
    fs.readFileSync(path.join(mixedReportDir, 'user-note.md'), 'utf8'),
    'user-owned extension\n'
  )
  assert.strictEqual(
    fs.readFileSync(editedMemoryFile, 'utf8'),
    editedMemoryContent,
    'hidden migration must retain a receipt-owned file modified by the user'
  )
  assert.ok(hiddenAgain.transaction.hosts.some(host =>
    (host.preservedNativeSkillCollisions || []).some(item =>
      item.skillId === 'report' && item.reasonCode === 'mixed-user-content'
    )
  ))
  assert.ok(hiddenAgain.transaction.hosts.some(host =>
    (host.preservedNativeSkillCollisions || []).some(item =>
      item.skillId === 'memory' && item.reasonCode === 'managed-content-modified'
    )
  ))
  const hiddenReceipt = JSON.parse(fs.readFileSync(
    path.join(home, '.codex', 'devcodex', 'global-host-receipt.json'),
    'utf8'
  ))
  assert.ok((hiddenReceipt.preservedNativeSkillCollisions || []).some(item =>
    item.skillId === 'report' && item.reasonCode === 'mixed-user-content'
  ))
  assert.strictEqual(
    fs.readFileSync(path.join(home, '.agents', 'skills', 'routing', 'SKILL.md'), 'utf8'),
    userContent,
    'same-id user skill must survive legacy to hidden migration'
  )

  // Prune helper requires ownership proof; unknown content becomes a collision.
  const scan = path.join(home, '.agents', 'skills')
  const dry = pruneManagedSkillDirs(scan, ['routing'], fs, { dryRun: true })
  assert.strictEqual(dry.removed.length, 0)
  assert.ok(dry.preservedCollisions.some(item => item.skillId === 'routing'))
  assert.strictEqual(fs.existsSync(path.join(scan, 'routing')), true)

  fs.rmSync(home, { recursive: true, force: true })
}

console.log('test-skills-deploy-mode: ok')
