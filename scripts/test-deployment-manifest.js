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
    packageName: 'devcodex',
    packageVersion: '1.12.0'
  })
  assert.strictEqual(session.preview.add.length, 2)
  for (const entry of session.manifest.entries) {
    write(path.join(targetRoot, entry.destination), fs.readFileSync(path.join(packageRoot, entry.source), 'utf8'))
  }
  writeManifestAtomic(session)
  assert.deepStrictEqual(verifyManifest({ packageRoot, targetRoot, manifest: readManifest(manifestFile) }), {
    missing: [], mismatched: [], staleExisting: [], ownershipConflicts: []
  })

  fs.rmSync(path.join(packageRoot, 'skills', 'two.md'))
  session = createDeploymentSession({
    packageRoot,
    targetRoot,
    manifestFile,
    descriptors,
    packageName: 'devcodex',
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
    packageName: 'devcodex',
    packageVersion: '1.12.0'
  })
  assert.ok(session.preview.unowned.includes('.github/skills/custom.md'))

  const legacyTarget = path.join(root, 'legacy-target')
  const legacyManifestFile = path.join(root, 'legacy-runtime', 'deployment-manifest.json')
  write(path.join(packageRoot, 'host-projections', 'AGENTS.workspace-bridge.md'), '# bridge owner\n')
  write(path.join(legacyTarget, 'AGENTS.md'), '# bridge owner\n')
  write(legacyManifestFile, JSON.stringify({
    schemaVersion: 1,
    package: 'devcodex',
    packageVersion: '1.15.1',
    targetRoot: legacyTarget,
    generatedAt: '2026-07-19T00:00:00.000Z',
    entries: [
      { source: 'instructions.md', destination: 'AGENTS.md', surface: 'codex', hash: 'legacy-a' },
      { source: 'host-projections/AGENTS.workspace-bridge.md', destination: 'AGENTS.md', surface: 'grok-workspace-bridge', hash: 'legacy-b' },
      { source: 'host-projections/AGENTS.md', destination: 'AGENTS.md', surface: 'shared-kernel', hash: 'legacy-c' }
    ],
    staleEntries: []
  }, null, 2) + '\n')
  const legacyBefore = readManifest(legacyManifestFile)
  assert.strictEqual(
    verifyManifest({ packageRoot, targetRoot: legacyTarget, manifest: legacyBefore }).ownershipConflicts.length,
    1,
    'legacy manifest must expose duplicate physical owners'
  )
  const legacySession = createDeploymentSession({
    packageRoot,
    targetRoot: legacyTarget,
    manifestFile: legacyManifestFile,
    descriptors: [{
      surface: 'grok-workspace-bridge',
      source: 'host-projections/AGENTS.workspace-bridge.md',
      destination: 'AGENTS.md'
    }],
    packageName: 'devcodex',
    packageVersion: '1.15.1'
  })
  assert.deepStrictEqual(
    legacySession.manifest.entries.filter(entry => entry.destination === 'AGENTS.md').map(entry => entry.surface),
    ['grok-workspace-bridge'],
    'selected physical owner must replace every legacy surface owner for the same destination'
  )
  assert.deepStrictEqual(
    verifyManifest({ packageRoot, targetRoot: legacyTarget, manifest: legacySession.manifest }).ownershipConflicts,
    []
  )
  write(path.join(packageRoot, 'host-projections', 'AGENTS.alternate.md'), '# alternate owner\n')
  assert.throws(() => createDeploymentSession({
    packageRoot,
    targetRoot: legacyTarget,
    manifestFile: legacyManifestFile,
    descriptors: [
      { surface: 'bridge-a', source: 'host-projections/AGENTS.workspace-bridge.md', destination: 'AGENTS.md' },
      { surface: 'bridge-b', source: 'host-projections/AGENTS.alternate.md', destination: './AGENTS.md' }
    ],
    packageName: 'devcodex',
    packageVersion: '1.15.1'
  }), /Deployment descriptor ownership conflict/)

  const sourceCheck = path.join(root, 'source-check')
  write(path.join(sourceCheck, '.github/workflows/ci.yml'), 'name: CI\n')
  assert.deepStrictEqual(findSourceRootHostDeployments(sourceCheck, fs, path, directory => {
    const visit = current => fs.readdirSync(current, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(current, entry.name)
      return entry.isDirectory() ? visit(full) : [full]
    })
    return visit(directory)
  }), [], 'source-root CI workflow must not be treated as a host deployment')
  const exactBridge = [
    '# exact bridge',
    '',
    '> projectionRole: workspace-bridge',
    '> projectionScope: host-neutral',
    '',
    'Host-specific adapter rule: only when the current host identifies itself as Grok, open `.grok/skills/devcodex-workspace/SKILL.md`.',
    'Other hosts must not treat `.grok` as a shared instruction source.',
    ''
  ].join('\n')
  write(path.join(sourceCheck, 'host-projections/AGENTS.workspace-bridge.md'), exactBridge)
  write(path.join(sourceCheck, 'AGENTS.md'), exactBridge)
  assert.strictEqual(isExactWorkspaceBridge(sourceCheck, fs, path), false)
  assert.ok(findSourceRootHostDeployments(sourceCheck, fs, path, directory => {
    const visit = current => fs.readdirSync(current, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(current, entry.name)
      return entry.isDirectory() ? visit(full) : [full]
    })
    return visit(directory)
  }).some(item => item.label === 'source-root AGENTS.md'), 'workspace project/source root bridge must be rejected')
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
