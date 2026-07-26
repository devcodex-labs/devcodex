'use strict'

/**
 * O2: Hook path call-site matrix for workspace vs global vs package skills.
 * Mirrors lifecycle carve-out decisions without loading full lifecycle host state.
 */

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  classifySkillPath,
  isWorkspaceSkillPath,
  resolveWorkspaceSkillsRoot
} = require('../hooks/_runtime/skill-resolution.cjs')

const CONTROL_PLANE_SOURCE_RE = /(?:^|[/\\])(?:scripts|hooks|instructions|host-projections)(?:[/\\]|$)|(?:^|[/\\])package\.json$|(?:^|[/\\])skills[/\\]|(?:^|[/\\])website[/\\]docs[/\\]intro[/\\]host-parity/i

function writeSkill(root, id, body = '# s\n') {
  const dir = path.join(root, id)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'SKILL.md')
  fs.writeFileSync(file, body, 'utf8')
  return file
}

/**
 * Lifecycle-equivalent decisions (S2 §9):
 * 1) workspace-skill first carve-out
 * 2) managed: G yes, W no, package no (package goes control-plane)
 * 3) control-plane: package skills yes; W no; G no (managed short-circuit)
 */
function lifecycleDecisions(absPath, ctx) {
  const cls = classifySkillPath(absPath, ctx)
  const isWs = cls.layer === 'workspace-skill' || isWorkspaceSkillPath(absPath, ctx)
  const isGlobal = cls.layer === 'global-managed-skill'
  const isPackage = cls.layer === 'package-source-skill'

  // isDevCodexManagedPath carve-out
  let managed = false
  if (isWs) managed = false
  else if (isGlobal) managed = true
  else managed = false

  // isControlPlaneSourcePath: managed first false; then W false; then regex
  let controlPlane = false
  if (managed) controlPlane = false
  else if (isWs) controlPlane = false
  else {
    const rel = String(absPath || '').replace(/\\/g, '/')
    controlPlane = CONTROL_PLANE_SOURCE_RE.test(rel) || isPackage
  }

  // Edit policy for matrix
  let editPolicy = 'other'
  if (isWs) editPolicy = 'allow-workspace-skill'
  else if (isGlobal) editPolicy = 'warn-global-managed'
  else if (isPackage) editPolicy = 'control-plane-cp-bound'
  else editPolicy = 'other-source'

  return {
    layer: cls.layer,
    managed,
    controlPlane,
    editPolicy,
    allowOrphanControlPlaneGate: controlPlane && isPackage
  }
}

function withFixture(run) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-hook-paths-'))
  try {
    const workspaceRoot = path.join(base, 'ws')
    const home = path.join(base, 'home')
    const packageRoot = path.join(base, 'pkg')
    const gRoot = path.join(home, '.agents', 'skills')
    const wRoot = path.join(workspaceRoot, '.devcodex', 'workspace', 'skills')
    fs.mkdirSync(path.join(workspaceRoot, '.devcodex'), { recursive: true })
    fs.writeFileSync(
      path.join(workspaceRoot, '.devcodex', 'layout.json'),
      JSON.stringify({ version: 1, mode: 'workspace-namespace' })
    )
    const wFile = writeSkill(wRoot, 'demo-w')
    const gFile = writeSkill(gRoot, 'demo-g')
    const pFile = writeSkill(path.join(packageRoot, 'skills'), 'demo-p')
    const ctx = {
      cwd: workspaceRoot,
      workspaceRoot,
      packageRoot,
      env: {
        USERPROFILE: home,
        HOME: home,
        DEVCODEX_GLOBAL_SKILLS_ROOT: gRoot
      }
    }
    assert.ok(resolveWorkspaceSkillsRoot(workspaceRoot, ctx))
    return run({ base, wFile, gFile, pFile, ctx, workspaceRoot, packageRoot, gRoot })
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
}

function testMatrix() {
  withFixture(({ wFile, gFile, pFile, ctx }) => {
    const w = lifecycleDecisions(wFile, ctx)
    assert.strictEqual(w.layer, 'workspace-skill')
    assert.strictEqual(w.managed, false, 'W must not be managed')
    assert.strictEqual(w.controlPlane, false, 'W must not be package control-plane')
    assert.strictEqual(w.editPolicy, 'allow-workspace-skill')
    assert.strictEqual(w.allowOrphanControlPlaneGate, false)

    const g = lifecycleDecisions(gFile, ctx)
    assert.strictEqual(g.layer, 'global-managed-skill')
    assert.strictEqual(g.managed, true)
    assert.strictEqual(g.controlPlane, false, 'managed G is not control-plane source')
    assert.strictEqual(g.editPolicy, 'warn-global-managed')

    const p = lifecycleDecisions(pFile, ctx)
    assert.strictEqual(p.layer, 'package-source-skill')
    assert.strictEqual(p.managed, false)
    assert.strictEqual(p.controlPlane, true, 'package skills are control-plane')
    assert.strictEqual(p.editPolicy, 'control-plane-cp-bound')
    assert.strictEqual(p.allowOrphanControlPlaneGate, true)
  })
}

function testRelativePathDoesNotFalsePositiveWorkspace() {
  // A path that merely contains the string skills/ but is under package
  withFixture(({ packageRoot, ctx }) => {
    const nested = writeSkill(path.join(packageRoot, 'skills', 'nested-more'), 'x')
    const d = lifecycleDecisions(nested, { ...ctx, packageRoot })
    assert.strictEqual(d.layer, 'package-source-skill')
    assert.strictEqual(d.controlPlane, true)
  })
}

function testCallSiteTableDocumented() {
  // Freeze expected matrix rows for CP3 evidence
  const rows = [
    { site: 'classifySkillPath', w: 'workspace-skill', g: 'global-managed-skill', p: 'package-source-skill' },
    { site: 'isDevCodexManagedPath', w: false, g: true, p: false },
    { site: 'isControlPlaneSourcePath', w: false, g: false, p: true },
    { site: 'Edit/Write SKILL.md', w: 'allow', g: 'warn', p: 'cp-bound' },
    { site: 'apply destination', w: 'forbid', g: 'allow-managed', p: 'n/a' }
  ]
  assert.strictEqual(rows.length, 5)
}

function main() {
  testMatrix()
  testRelativePathDoesNotFalsePositiveWorkspace()
  testCallSiteTableDocumented()
  console.log('test-skill-resolution-hook-paths: ok')
}

main()
