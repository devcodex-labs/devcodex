#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  FINALIZE_CONFIRMATION,
  buildDeletePreview,
  finalizeDeleteTransaction,
  rollbackDeleteTransaction,
  stageDeleteTransaction,
  verifyDeletePreview,
  writeJsonAtomic
} = require('./lib/content-root-delete-transaction')

function write (root, relative, content) {
  const target = path.join(root, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

function git (root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

function fixture () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-content-delete-'))
  git(root, ['init', '--quiet'])
  write(root, 'content/manifest.json', `${JSON.stringify({
    schemaVersion: 'ControlContentManifestV1',
    sourceRoot: 'content',
    sharedRoot: 'shared',
    expectedMarkdownEntries: 4,
    selectors: [
      { source: 'instructions.md', target: 'instructions.md', kind: 'instruction-root' },
      { source: 'instructions/**/*.md', target: 'instructions/**/*.md', kind: 'instruction' },
      { source: 'prompts/**/*.md', target: 'prompts/**/*.md', kind: 'prompt' },
      { source: 'skills/*/SKILL.md', target: 'skills/*/SKILL.md', kind: 'skill' }
    ],
    excludedMarkdown: [],
    companionPolicy: {
      location: 'content-skill-package',
      ownership: 'bound-by-skill-id',
      copiedIntoSourceRoot: true,
      routeIntent: 'skills/<skill-id>/intent.json',
      codeCompanions: 'delivery-tree'
    },
    mirrors: [],
    includeDirective: {
      syntax: '<!-- devcodex:include shared/<portable-path>.md -->',
      maxDepth: 1,
      allowSymlinks: false
    }
  }, null, 2)}\n`)
  write(root, 'content/instructions.md', '# canonical\n')
  write(root, 'content/instructions/demo.md', '# instruction\n')
  write(root, 'content/prompts/demo.md', '# prompt\n')
  write(root, 'content/skills/demo/SKILL.md', '---\nname: demo\ndescription: demo\n---\n# demo\n')
  write(root, 'content/skills/demo/devcodex.skill.json', JSON.stringify({
    schemaVersion: 'DevCodexSkillContractV1',
    id: 'demo',
    name: 'demo',
    description: 'demo',
    sharedIncludes: []
  }))
  write(root, 'content/skills/demo/intent.json', '{"skillId":"demo"}\n')
  write(root, 'content-source/manifest.json', '{"schemaVersion":"ControlContentManifestV1"}\n')
  write(root, 'content-source/instructions.md', '# old canonical\n')
  write(root, 'instructions.md', '# canonical\n')
  write(root, 'instructions/demo.md', '# instruction\n')
  write(root, 'prompts/demo.md', '# prompt\n')
  write(root, 'skills/demo/SKILL.md', '---\nname: demo\ndescription: demo\n---\n# demo\n')
  write(root, 'skills/demo/intent.json', '{"skillId":"demo"}\n')
  git(root, ['add', '.'])
  return root
}

function expectFailure (fn, pattern) {
  assert.throws(fn, pattern)
}

function run () {
  const root = fixture()
  const previewPath = path.join(root, '.tmp', 'preview.json')
  const receiptPath = path.join(root, '.tmp', 'receipt.json')
  const preview = buildDeletePreview(root, {
    project: 'fixture',
    generatedAt: '2026-07-30T00:00:00.000Z'
  })
  assert.deepStrictEqual(preview.groups, {
    'content-source': 2,
    'legacy-markdown': 4,
    'legacy-intent': 1
  })
  assert.strictEqual(verifyDeletePreview(root, preview).fileCount, 7)
  writeJsonAtomic(previewPath, preview)

  const duplicate = JSON.parse(JSON.stringify(preview))
  duplicate.records.push(duplicate.records[0])
  duplicate.fileCount += 1
  duplicate.previewDigest = require('./lib/content-root-delete-transaction').previewDigest(duplicate)
  expectFailure(() => verifyDeletePreview(root, duplicate), /INVENTORY_DRIFT/)

  const unsafe = JSON.parse(JSON.stringify(preview))
  unsafe.records[0].path = '../outside'
  unsafe.previewDigest = require('./lib/content-root-delete-transaction').previewDigest(unsafe)
  expectFailure(() => verifyDeletePreview(root, unsafe), /INVENTORY_DRIFT|PATH_UNSAFE/)

  write(root, 'content/instructions.md', '# drift\n')
  expectFailure(() => verifyDeletePreview(root, preview), /REPLACEMENT_DRIFT/)
  write(root, 'content/instructions.md', '# canonical\n')

  expectFailure(
    () => stageDeleteTransaction(root, previewPath, receiptPath, 'wrong'),
    /EXPECTED_DIGEST_MISMATCH/
  )
  const staged = stageDeleteTransaction(
    root,
    previewPath,
    receiptPath,
    preview.previewDigest
  )
  assert.strictEqual(staged.state, 'staged')
  assert.strictEqual(fs.existsSync(path.join(root, 'instructions.md')), false)
  assert.strictEqual(fs.existsSync(path.join(root, 'content/instructions.md')), true)
  expectFailure(
    () => finalizeDeleteTransaction(root, receiptPath, preview.previewDigest, 'wrong'),
    /CONFIRMATION_REQUIRED/
  )
  assert.strictEqual(rollbackDeleteTransaction(root, receiptPath).state, 'rolled-back')
  assert.strictEqual(fs.readFileSync(path.join(root, 'instructions.md'), 'utf8'), '# canonical\n')

  const preview2 = buildDeletePreview(root, {
    project: 'fixture',
    generatedAt: '2026-07-30T00:00:01.000Z'
  })
  const previewPath2 = path.join(root, '.tmp', 'preview-2.json')
  const receiptPath2 = path.join(root, '.tmp', 'receipt-2.json')
  writeJsonAtomic(previewPath2, preview2)
  stageDeleteTransaction(root, previewPath2, receiptPath2, preview2.previewDigest)
  assert.strictEqual(
    finalizeDeleteTransaction(
      root,
      receiptPath2,
      preview2.previewDigest,
      FINALIZE_CONFIRMATION
    ).state,
    'finalized'
  )
  assert.strictEqual(fs.existsSync(path.join(root, 'instructions.md')), false)
  assert.strictEqual(fs.existsSync(path.join(root, 'content/instructions.md')), true)

  fs.rmSync(root, { recursive: true, force: true })
  process.stdout.write('content root delete transaction tests: PASS\n')
}

run()
