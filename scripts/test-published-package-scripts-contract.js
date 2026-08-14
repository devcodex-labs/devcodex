#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  PUBLISHED_SCRIPTS,
  buildPublishedPackageManifest,
  validatePublishedPackageManifest,
  validateScriptGraph
} = require('./lib/published-package-scripts-contract')
const {
  projectPublishedPackageManifest,
  resolvePublishedManifestProjectionPaths,
  restorePublishedPackageManifest
} = require('./lib/published-package-manifest-projection')
const { resolveWorkspaceTempRoot } = require('./lib/workspace-temp-layout')

const ROOT = path.resolve(__dirname, '..')
const testRoot = path.join(
  resolveWorkspaceTempRoot(ROOT),
  'runs',
  'devcodex',
  `published-package-contract-${process.pid}-${Date.now()}`
)

function write (root, relative, content = "'use strict'\n") {
  const target = path.join(root, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

function sourceManifest () {
  return {
    name: 'published-package-contract-fixture',
    version: '0.0.0',
    scripts: {
      ...PUBLISHED_SCRIPTS,
      validate: 'node scripts/validate.js',
      'test:source-only': 'node scripts/source-only.js'
    }
  }
}

function createContractFixture (name) {
  const root = path.join(testRoot, name)
  fs.mkdirSync(root, { recursive: true })
  for (const command of Object.values(PUBLISHED_SCRIPTS)) {
    const match = command.match(/^node\s+([^\s]+)/)
    if (match) write(root, match[1])
  }
  return root
}

function expectCode (fn, code) {
  assert.throws(fn, error => error && error.code === code, code)
}

fs.mkdirSync(testRoot, { recursive: true })
try {
  {
    const root = createContractFixture('positive')
    const projected = buildPublishedPackageManifest(sourceManifest())
    assert.deepStrictEqual(projected.scripts, PUBLISHED_SCRIPTS)
    const receipt = validatePublishedPackageManifest(root, projected)
    assert.strictEqual(receipt.status, 'PASS')
    assert.strictEqual(receipt.scriptCount, Object.keys(PUBLISHED_SCRIPTS).length)
  }

  {
    const root = createContractFixture('unexpected-script')
    const projected = buildPublishedPackageManifest(sourceManifest())
    projected.scripts.test = 'node scripts/test.js'
    write(root, 'scripts/test.js')
    expectCode(
      () => validatePublishedPackageManifest(root, projected),
      'PUBLISHED_PACKAGE_SCRIPTS_UNEXPECTED'
    )
  }

  {
    const root = createContractFixture('missing-entry')
    expectCode(
      () => validateScriptGraph(root, { scripts: { probe: 'node scripts/missing.js' } }),
      'PUBLISHED_PACKAGE_SCRIPT_TARGET_MISSING'
    )
    expectCode(
      () => validateScriptGraph(root, { scripts: { probe: 'npm run absent' } }),
      'PUBLISHED_PACKAGE_NESTED_SCRIPT_MISSING'
    )
    expectCode(
      () => validateScriptGraph(root, { scripts: { prepack: 'node scripts/prepack-control-content.js' } }),
      'PUBLISHED_PACKAGE_LIFECYCLE_PAIR_INCOMPLETE'
    )
  }

  for (const [name, body] of [
    ['require-missing', "'use strict'\nrequire('./missing')\n"],
    ['import-missing', "'use strict'\nimport('./missing.js')\n"],
    ['path-join-root-missing', "'use strict'\nconst path = require('path')\nconst ROOT = path.resolve(__dirname, '..')\npath.join(ROOT, 'missing.js')\n"],
    ['path-join-dirname-missing', "'use strict'\nconst path = require('path')\npath.join(__dirname, 'missing.js')\n"],
    ['spawn-missing', "'use strict'\nconst { spawnSync } = require('child_process')\nspawnSync(process.execPath, ['scripts/missing.js'])\n"]
  ]) {
    const root = createContractFixture(name)
    write(root, 'scripts/entry.js', body)
    expectCode(
      () => validateScriptGraph(root, { scripts: { probe: 'node scripts/entry.js' } }),
      'PUBLISHED_PACKAGE_RUNTIME_DEPENDENCY_MISSING'
    )
  }

  {
    const root = createContractFixture('projection')
    write(root, 'scripts/validate.js')
    write(root, 'scripts/source-only.js')
    write(root, 'package.json', `${JSON.stringify(sourceManifest(), null, 2)}\n`)
    const original = fs.readFileSync(path.join(root, 'package.json'))
    const projected = projectPublishedPackageManifest(root)
    assert.strictEqual(projected.status, 'projected')
    assert.deepStrictEqual(
      JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts,
      PUBLISHED_SCRIPTS
    )
    const restored = restorePublishedPackageManifest(root)
    assert.strictEqual(restored.status, 'restored')
    assert.deepStrictEqual(fs.readFileSync(path.join(root, 'package.json')), original)
    assert.strictEqual(fs.existsSync(resolvePublishedManifestProjectionPaths(root).receiptPath), false)

    projectPublishedPackageManifest(root)
    projectPublishedPackageManifest(root)
    assert.strictEqual(restorePublishedPackageManifest(root).status, 'restored')
  }

  {
    const root = createContractFixture('restore-conflict')
    write(root, 'scripts/validate.js')
    write(root, 'scripts/source-only.js')
    write(root, 'package.json', `${JSON.stringify(sourceManifest(), null, 2)}\n`)
    const original = fs.readFileSync(path.join(root, 'package.json'))
    projectPublishedPackageManifest(root)
    fs.appendFileSync(path.join(root, 'package.json'), '\nforeign-change\n')
    expectCode(() => restorePublishedPackageManifest(root), 'PUBLISHED_PACKAGE_MANIFEST_RESTORE_CONFLICT')
    fs.writeFileSync(path.join(root, 'package.json'), original)
    assert.strictEqual(restorePublishedPackageManifest(root).status, 'already-restored')
  }
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true })
}

console.log('published package scripts contract tests passed')
