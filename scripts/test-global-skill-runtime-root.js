'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  resolveGlobalSkillRuntimeRoot
} = require('../hooks/_runtime/global-skill-runtime-root.cjs')

const packageRoot = path.resolve(__dirname, '..')

{
  const result = resolveGlobalSkillRuntimeRoot({
    packageRoot,
    runtimeRoot: packageRoot,
    env: {}
  })
  assert.strictEqual(result.status, 'resolved')
  assert.strictEqual(result.source, 'source-package')
  assert.ok(result.portfolioPath.endsWith('/skills/portfolio.json'))
}

{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'global-skill-root-'))
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

  fs.rmSync(home, { recursive: true, force: true })
}

console.log('test-global-skill-runtime-root: ok')
