'use strict'

/**
 * SkillsDeployModeV1: hidden G_RUNTIME + prune scan roots + resolve mode.
 */

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  applyGlobalHostConfig,
  buildGlobalHostConfigPlan
} = require('./lib/global-host-config.js')
const { resolveSkillsDeployMode } = require('./lib/skills-deploy-mode.js')
const { resolveGlobalSkillsRoot } = require('../hooks/_runtime/skill-resolution.cjs')
const { listManagedSkillIds, pruneManagedSkillDirs } = require('./lib/skill-deploy-filter.js')

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
  // Seed scan roots with a managed skill id so prune can be observed
  const managed = listManagedSkillIds(packageRoot)
  assert.ok(managed.includes('routing'), 'fixture package should manage routing skill')
  for (const scan of [
    path.join(home, '.agents', 'skills', 'routing'),
    path.join(home, '.claude', 'skills', 'routing'),
    // gray residue must also be pruned in hidden mode
    path.join(home, '.agents', 'skills', 'consumer-validation-engineering'),
    path.join(home, '.claude', 'skills', 'consumer-validation-engineering')
  ]) {
    fs.mkdirSync(scan, { recursive: true })
    fs.writeFileSync(path.join(scan, 'SKILL.md'), '---\nname: stub\n---\nlegacy\n', 'utf8')
  }

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
  assert.strictEqual(fs.existsSync(path.join(home, '.agents', 'skills', 'routing')), false)
  assert.strictEqual(fs.existsSync(path.join(home, '.claude', 'skills', 'routing')), false)
  assert.strictEqual(
    fs.existsSync(path.join(home, '.agents', 'skills', 'consumer-validation-engineering')),
    false,
    'gray package skill must be pruned from agents scan root'
  )
  assert.strictEqual(
    fs.existsSync(path.join(home, '.claude', 'skills', 'consumer-validation-engineering')),
    false,
    'gray package skill must be pruned from claude scan root'
  )

  // legacy re-fills scan roots
  const legacy = applyGlobalHostConfig({
    packageRoot,
    env,
    home,
    skillsDeployMode: 'legacy'
  })
  assert.strictEqual(legacy.transaction.status, 'committed')
  assert.strictEqual(
    fs.existsSync(path.join(home, '.agents', 'skills', 'routing', 'SKILL.md')),
    true
  )

  // prune helper unit: dry-run lists without delete
  const scan = path.join(home, '.agents', 'skills')
  const dry = pruneManagedSkillDirs(scan, ['routing'], fs, { dryRun: true })
  assert.ok(dry.removed.some(p => /routing$/.test(p.replace(/\\/g, '/'))))
  assert.strictEqual(fs.existsSync(path.join(scan, 'routing')), true)

  fs.rmSync(home, { recursive: true, force: true })
}

console.log('test-skills-deploy-mode: ok')
