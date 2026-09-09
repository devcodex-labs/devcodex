'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const {
  resolveGlobalSkillRuntimeRoot
} = require('../hooks/_runtime/global-skill-runtime-root.cjs')
const { resolveGlobalSkillsRoot } = require('../hooks/_runtime/skill-resolution.cjs')
const { buildRuntimeSkillIdentityIndex } = require('../hooks/_runtime/runtime-skill-identity-index.cjs')
const { resolveControlAsset } = require('./lib/control-content-delivery')
const { getRuntimeContractDigest } = require('../hooks/_runtime/skill-route-mode.cjs')

const packageRoot = path.resolve(__dirname, '..')

{
  const result = resolveGlobalSkillRuntimeRoot({
    packageRoot,
    runtimeRoot: packageRoot,
    env: {}
  })
  assert.strictEqual(result.status, 'resolved')
  assert.strictEqual(result.source, 'source-package')
  const expectedSkills = resolveControlAsset(packageRoot, 'skills')
  assert.strictEqual(path.resolve(result.root), path.resolve(expectedSkills))
  assert.strictEqual(path.resolve(result.portfolioPath), path.join(expectedSkills, 'portfolio.json'))
  assert.strictEqual(path.resolve(result.companionRoot), path.resolve(expectedSkills))
}

{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-global-skill-root-'))
  const packedRoot = path.join(home, 'published-package')
  const packedSkills = path.join(packedRoot, 'skills')
  fs.mkdirSync(path.join(packedSkills, '_schemas'), { recursive: true })
  fs.writeFileSync(path.join(packedRoot, 'package.json'), JSON.stringify({ name: 'devcodex' }))
  fs.writeFileSync(path.join(packedSkills, 'portfolio.json'), '{"schemaVersion":"fixture"}\n')
  const schema = 'skill-intent.v1.schema.json'
  fs.writeFileSync(path.join(packedSkills, '_schemas', schema), '{"title":"published"}\n')
  const packedOptions = { packageRoot: packedRoot, env: { HOME: home, USERPROFILE: home } }
  const packed = resolveGlobalSkillRuntimeRoot(packedOptions)
  assert.strictEqual(packed.status, 'resolved', 'published packages must resolve their own skills/ assets')
  assert.strictEqual(path.resolve(packed.root), packedSkills)
  const packedDigest = getRuntimeContractDigest(packedOptions)
  assert.strictEqual(packedDigest, getRuntimeContractDigest({
    ...packedOptions, globalRuntime: { status: 'resolved', root: packedSkills, companionRoot: packedSkills }
  }), 'package digest must include the same Schema bytes as the generation producer')
  fs.writeFileSync(path.join(packedSkills, '_schemas', schema), '{"title":"changed"}\n')
  assert.notStrictEqual(getRuntimeContractDigest(packedOptions), packedDigest)
  fs.mkdirSync(path.join(packedRoot, 'content', 'skills'), { recursive: true })
  assert.strictEqual(resolveGlobalSkillRuntimeRoot(packedOptions).status, 'blocked',
    'an incomplete source tree must not silently consume a stale published projection')
  fs.writeFileSync(path.join(packedRoot, 'package.json'), '{"name":"another-package"}\n')
  assert.strictEqual(resolveGlobalSkillRuntimeRoot(packedOptions).status, 'blocked')

  const hostRoot = path.join(home, '.claude')
  const runtimeRoot = path.join(hostRoot, 'devcodex', 'runtime')
  const skillsRoot = path.join(home, '.agents', 'devcodex', 'skills')
  fs.mkdirSync(path.join(runtimeRoot, 'mcp'), { recursive: true })
  fs.mkdirSync(skillsRoot, { recursive: true })
  fs.writeFileSync(path.join(skillsRoot, 'portfolio.json'), '{"schemaVersion":"fixture"}\n')
  fs.writeFileSync(
    path.join(hostRoot, 'devcodex', 'global-host-receipt.json'),
    `${JSON.stringify({
      schemaVersion: 'GlobalHostConfigReceiptV1',
      result: 'committed',
      packageName: 'devcodex',
      packageVersion: '1.0.0',
      runtimeRoot,
      skillsRuntimeRoot: skillsRoot,
      sourceDigest: 'fixture'
    }, null, 2)}\n`
  )

  const installed = resolveGlobalSkillRuntimeRoot({
    runtimeRoot,
    packageRoot: runtimeRoot,
    home,
    env: { HOME: home, USERPROFILE: home }
  })
  assert.strictEqual(installed.status, 'resolved')
  assert.strictEqual(installed.source, 'committed-receipt')
  assert.strictEqual(path.resolve(installed.root), path.resolve(skillsRoot))

  const recovery = resolveGlobalSkillRuntimeRoot({
    runtimeRoot: path.join(hostRoot, 'other-runtime'),
    packageRoot: path.join(hostRoot, 'other-runtime'),
    home,
    env: {
      HOME: home,
      USERPROFILE: home,
      DEVCODEX_GLOBAL_SKILLS_RUNTIME: skillsRoot
    }
  })
  assert.strictEqual(recovery.status, 'resolved')
  assert.strictEqual(recovery.source, 'explicit')

  const blocked = resolveGlobalSkillRuntimeRoot({
    runtimeRoot: path.join(hostRoot, 'missing-runtime'),
    packageRoot: path.join(hostRoot, 'missing-runtime'),
    home: path.join(home, 'empty-home'),
    env: {
      HOME: path.join(home, 'empty-home'),
      USERPROFILE: path.join(home, 'empty-home')
    }
  })
  assert.strictEqual(blocked.status, 'blocked')
  assert.strictEqual(blocked.errorCode, 'GLOBAL_SKILL_RUNTIME_ROOT_UNRESOLVED')

  // Two installed generations keep independent Skill bytes after a receipt
  // switch; even an explicit shared-root environment cannot mix their sources.
  const makeGeneration = (generationId, text) => {
    const root = path.join(hostRoot, 'devcodex', `runtime-${generationId}`)
    const skills = path.join(root, 'skills')
    fs.mkdirSync(skills, { recursive: true })
    fs.writeFileSync(path.join(skills, 'portfolio.json'), text)
    const digest = crypto.createHash('sha256').update(text).digest('hex')
    fs.writeFileSync(path.join(root, 'runtime-generation.json'), JSON.stringify({
      schemaVersion: 'RuntimeGenerationManifestV1', generationId,
      sourceDigest: digest, immutable: true, runtimeRoot: '.',
      skillsRuntimeRoot: 'skills', skillsPortfolioDigest: digest
    }))
    return root
  }
  const oldRoot = makeGeneration('fixture-old', '{"generation":"old"}')
  const newRoot = makeGeneration('fixture-new', '{"generation":"new"}')
  fs.writeFileSync(path.join(hostRoot, 'devcodex', 'global-host-receipt.json'), JSON.stringify({
    schemaVersion: 'GlobalHostConfigReceiptV1', result: 'committed', packageName: 'devcodex',
    runtimeRoot: newRoot, skillsRuntimeRoot: path.join(newRoot, 'skills')
  }))
  for (const [root, expected] of [[oldRoot, 'old'], [newRoot, 'new']]) {
    const result = resolveGlobalSkillRuntimeRoot({
      runtimeRoot: root, home, env: { DEVCODEX_GLOBAL_SKILLS_RUNTIME: skillsRoot }
    })
    assert.strictEqual(result.source, 'runtime-generation')
    assert.strictEqual(result.identityStatus, 'PASS')
    assert.strictEqual(JSON.parse(fs.readFileSync(result.portfolioPath)).generation, expected)
    assert.strictEqual(resolveGlobalSkillsRoot({ runtimeRoot: root, env: {} }), path.join(root, 'skills'))
  }
  fs.writeFileSync(path.join(oldRoot, 'skills', 'portfolio.json'), '{"generation":"wrong"}')
  assert.strictEqual(resolveGlobalSkillRuntimeRoot({ runtimeRoot: oldRoot, home, env: {} }).status, 'blocked')
  assert.throws(() => resolveGlobalSkillsRoot({ runtimeRoot: oldRoot, home, env: {} }),
    error => error.code === 'GLOBAL_SKILL_RUNTIME_GENERATION_UNBOUND')
  assert.throws(() => buildRuntimeSkillIdentityIndex({ runtimeRoot: oldRoot, home, env: {}, cwd: home }),
    error => error.code === 'GLOBAL_SKILL_RUNTIME_GENERATION_UNBOUND')
  fs.unlinkSync(path.join(newRoot, 'skills', 'portfolio.json'))
  assert.strictEqual(resolveGlobalSkillRuntimeRoot({ runtimeRoot: newRoot, home, env: {} }).status, 'blocked')

  if (process.env.DEVCODEX_TEST_KEEP_TEMP !== '1') fs.rmSync(home, { recursive: true, force: true })
  else console.log('Retained generation identity fixture:', home)
}

console.log('test-global-skill-runtime-root: ok')
