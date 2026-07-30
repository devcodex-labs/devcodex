#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const {
  atomicWrite,
  buildBundle,
  sha256
} = require('./lib/control-content-source')
const {
  analyzeDuplication,
  normalizeBlock,
  validateDispositions
} = require('./lib/control-content-duplication')

const ROOT = path.resolve(__dirname, '..')
const flags = new Set(process.argv.slice(2))
const known = new Set(['--check', '--write', '--json'])
for (const flag of flags) {
  if (!known.has(flag)) {
    console.error(`[control-content-extract] unknown option: ${flag}`)
    process.exit(2)
  }
}
if (flags.has('--check') === flags.has('--write')) {
  console.error('[control-content-extract] select exactly one of --check or --write')
  process.exit(2)
}

function directive (fragment) {
  return `<!-- devcodex:include ${fragment} -->`
}

try {
  const before = buildBundle(ROOT, { mode: 'extract-plan', compareDelivery: false })
  const inventory = analyzeDuplication(ROOT)
  const dispositionDocument = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'content', 'duplication-dispositions.json'), 'utf8')
  )
  const validated = validateDispositions(ROOT, inventory)
  if (!validated.ok) throw new Error(validated.errors.join(' | '))
  const candidateById = new Map(inventory.candidates.map(candidate => [candidate.id, candidate]))
  const extractRules = dispositionDocument.rules.filter(rule => rule.decision === 'extract')
  const plans = new Map()
  const fragments = new Map()
  const pending = []

  for (const rule of extractRules) {
    if (!rule.fragment || !rule.fragment.startsWith('shared/') || rule.fragment.includes('..')) {
      throw new Error(`invalid extraction fragment for ${rule.id}`)
    }
    const candidate = candidateById.get(rule.candidateIds[0])
    if (!candidate || candidate.kind !== 'exact-paragraph') {
      throw new Error(`extract rule requires one exact paragraph candidate: ${rule.id}`)
    }
    const expectedDirective = directive(rule.fragment)
    let fragmentContent = null
    const fragmentPath = path.join(ROOT, 'content', rule.fragment)
    if (fs.existsSync(fragmentPath)) fragmentContent = fs.readFileSync(fragmentPath, 'utf8')
    let consumerCount = 0

    for (const relative of candidate.files) {
      const sourcePath = path.join(ROOT, 'content', relative)
      const original = plans.has(sourcePath)
        ? plans.get(sourcePath)
        : fs.readFileSync(sourcePath, 'utf8')
      if (original.includes(expectedDirective)) {
        consumerCount += 1
        continue
      }
      const parts = original.split(/((?:\r?\n)[ \t]*(?:\r?\n)+)/)
      let matched = 0
      for (let index = 0; index < parts.length; index += 2) {
        const normalized = normalizeBlock(parts[index])
        if (!normalized || sha256(normalized) !== candidate.digest) continue
        if (fragmentContent == null) fragmentContent = parts[index].replace(/\r\n?/g, '\n')
        if (parts[index].replace(/\r\n?/g, '\n') !== fragmentContent) {
          throw new Error(`raw paragraph differs across consumers for ${candidate.id}`)
        }
        parts[index] = expectedDirective
        matched += 1
      }
      if (matched !== 1) {
        throw new Error(`${candidate.id} expected one paragraph in ${relative}, found ${matched}`)
      }
      plans.set(sourcePath, parts.join(''))
      consumerCount += 1
    }
    if (consumerCount < 2 || fragmentContent == null) {
      throw new Error(`${candidate.id} has insufficient extractable consumers`)
    }
    if (fs.existsSync(fragmentPath) &&
        fs.readFileSync(fragmentPath, 'utf8').replace(/\r\n?/g, '\n') !== fragmentContent) {
      throw new Error(`fragment drift: ${rule.fragment}`)
    }
    fragments.set(fragmentPath, fragmentContent)
    if (!fs.existsSync(fragmentPath) || candidate.files.some(relative => {
      const sourcePath = path.join(ROOT, 'content', relative)
      const content = plans.get(sourcePath) || fs.readFileSync(sourcePath, 'utf8')
      return !content.includes(expectedDirective)
    })) {
      pending.push(rule.id)
    }
  }

  if (flags.has('--write')) {
    for (const [fragmentPath, content] of fragments) atomicWrite(fragmentPath, content)
    for (const [sourcePath, content] of plans) atomicWrite(sourcePath, content)
  }

  const after = flags.has('--write')
    ? buildBundle(ROOT, { mode: 'extract-write', compareDelivery: false })
    : before
  const receipt = {
    schemaVersion: 'ControlContentExtractionReceiptV1',
    mode: flags.has('--write') ? 'write' : 'check',
    extractRules: extractRules.length,
    fragmentCount: fragments.size,
    sourceFilesChanged: plans.size,
    pending: flags.has('--write') ? [] : pending,
    outputFresh: after.receipt.bundleDigest === before.receipt.bundleDigest,
    outputBundleDigest: after.receipt.bundleDigest
  }
  if (!receipt.outputFresh) {
    throw new Error('extraction changed rendered bundle output')
  }
  if (flags.has('--check') && pending.length) {
    if (flags.has('--json')) process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
    throw new Error(`pending extractions: ${pending.join(', ')}`)
  }
  if (flags.has('--json')) process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
  else console.log(
    `[control-content-extract] fresh fragments=${receipt.fragmentCount} ` +
    `sources=${receipt.sourceFilesChanged}`
  )
} catch (error) {
  console.error(`[control-content-extract] BLOCK ${error.message}`)
  process.exit(1)
}
