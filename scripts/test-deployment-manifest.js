#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  createDeploymentSession,
  readManifest,
  verifyManifest,
  writeManifestAtomic
} = require('./lib/deployment-manifest-utils')
const {
  findSourceRootHostDeployments,
  isExactWorkspaceBridge
} = require('./lib/validate-governance-package-deployment')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-manifest-'))
const packageRoot = path.join(root, 'package')
const targetRoot = path.join(root, 'target')
const manifestFile = path.join(root, 'runtime', 'managed', 'deployment-manifest.json')
const descriptors = [{ surface: 'copilot', source: 'skills', destination: '.github/skills' }]

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content, 'utf8')
}

try {
  write(path.join(packageRoot, 'skills', 'one.md'), 'one\n')
  write(path.join(packageRoot, 'skills', 'two.md'), 'two\n')
  let session = createDeploymentSession({
    packageRoot,
    targetRoot,
    manifestFile,
    descriptors,
    packageName: '@vextjs/devcodex',
    packageVersion: '1.12.0'
  })
  assert.strictEqual(session.preview.add.length, 2)
  for (const entry of session.manifest.entries) {
    write(path.join(targetRoot, entry.destination), fs.readFileSync(path.join(packageRoot, entry.source), 'utf8'))
  }
  writeManifestAtomic(session)
  assert.deepStrictEqual(verifyManifest({ packageRoot, targetRoot, manifest: readManifest(manifestFile) }), {
    missing: [], mismatched: [], staleExisting: []
  })

  fs.rmSync(path.join(packageRoot, 'skills', 'two.md'))
  session = createDeploymentSession({
    packageRoot,
    targetRoot,
    manifestFile,
    descriptors,
    packageName: '@vextjs/devcodex',
    packageVersion: '1.12.0'
  })
  assert.deepStrictEqual(session.preview.stale.map(entry => entry.destination), ['.github/skills/two.md'])
  writeManifestAtomic(session)
  assert.ok(fs.existsSync(path.join(targetRoot, '.github/skills/two.md')), 'stale managed file must never be auto-deleted')
  assert.deepStrictEqual(verifyManifest({ packageRoot, targetRoot, manifest: readManifest(manifestFile) }).staleExisting, ['.github/skills/two.md'])

  write(path.join(targetRoot, '.github/skills/custom.md'), 'custom\n')
  session = createDeploymentSession({
    packageRoot,
    targetRoot,
    manifestFile,
    descriptors,
    packageName: '@vextjs/devcodex',
    packageVersion: '1.12.0'
  })
  assert.ok(session.preview.unowned.includes('.github/skills/custom.md'))

  const sourceCheck = path.join(root, 'source-check')
  write(path.join(sourceCheck, '.github/workflows/ci.yml'), 'name: CI\n')
  assert.deepStrictEqual(findSourceRootHostDeployments(sourceCheck, fs, path, directory => {
    const visit = current => fs.readdirSync(current, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(current, entry.name)
      return entry.isDirectory() ? visit(full) : [full]
    })
    return visit(directory)
  }), [], 'source-root CI workflow must not be treated as a host deployment')
  write(path.join(sourceCheck, 'host-projections/AGENTS.workspace-bridge.md'), '# exact bridge\n')
  write(path.join(sourceCheck, 'AGENTS.md'), '# exact bridge\n')
  assert.strictEqual(isExactWorkspaceBridge(sourceCheck, fs, path), true)
  assert.deepStrictEqual(findSourceRootHostDeployments(sourceCheck, fs, path, directory => {
    const visit = current => fs.readdirSync(current, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(current, entry.name)
      return entry.isDirectory() ? visit(full) : [full]
    })
    return visit(directory)
  }), [], 'exact source-root workspace bridge must be allowed')
  write(path.join(sourceCheck, 'AGENTS.md'), '# drifted or full deployment\n')
  assert.strictEqual(isExactWorkspaceBridge(sourceCheck, fs, path), false)
  assert.ok(findSourceRootHostDeployments(sourceCheck, fs, path, directory => {
    const visit = current => fs.readdirSync(current, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(current, entry.name)
      return entry.isDirectory() ? visit(full) : [full]
    })
    return visit(directory)
  }).some(item => item.label === 'source-root AGENTS.md'))
  write(path.join(sourceCheck, '.github/skills/example/SKILL.md'), '# deployed copy\n')
  assert.ok(findSourceRootHostDeployments(sourceCheck, fs, path, directory => {
    const visit = current => fs.readdirSync(current, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(current, entry.name)
      return entry.isDirectory() ? visit(full) : [full]
    })
    return visit(directory)
  }).some(item => item.label.includes('.github/ host deployment')))

  console.log('✓ deployment manifest add/update/stale/unowned and no-delete fixtures passed')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
