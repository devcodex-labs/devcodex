#!/usr/bin/env node
'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const { stableStringify } = require('../hooks/_runtime/content-identity.cjs')
const { runChecked } = require('./lib/checked-command')
const { buildCandidateIdentity } = require('./lib/validation-dag')
const { verifyReleaseValidationReceipt } = require('./verify-release-validation-receipt')

const ROOT = path.resolve(__dirname, '..')
const RECEIPT_SCHEMA = 'ExactReleaseArtifactReceiptV1'
const RECEIPT_FILE = 'exact-release-artifact.receipt.json'
const PUBLISHED_RECEIPT_SCHEMA = 'PublishedArtifactReceiptV1'
const PUBLISHED_RECEIPT_FILE = 'published-artifact.receipt.json'
const DEFAULT_REGISTRY = 'https://registry.npmjs.org/'

function digestBuffer(algorithm, value, encoding = 'hex') {
  return crypto.createHash(algorithm).update(value).digest(encoding)
}

function digestCore(value) {
  return digestBuffer('sha256', Buffer.from(stableStringify(value), 'utf8'))
}

function parsePackJson(stdout) {
  const text = String(stdout || '').trim()
  const match = text.match(/(\[\s*\{[\s\S]*\}\s*\])\s*$/)
  if (!match) throw Object.assign(new Error('npm pack did not return one JSON artifact'), { code: 'RELEASE_PACK_JSON_INVALID' })
  const value = JSON.parse(match[1])
  if (!Array.isArray(value) || value.length !== 1 || typeof value[0]?.filename !== 'string') {
    throw Object.assign(new Error('npm pack must return exactly one filename'), { code: 'RELEASE_PACK_CARDINALITY_INVALID' })
  }
  return value[0]
}

function resolveArtifactPath(outputDir, filename) {
  const root = path.resolve(outputDir)
  const artifactPath = path.resolve(root, filename)
  const relative = path.relative(root, artifactPath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.extname(artifactPath) !== '.tgz') {
    throw Object.assign(new Error('packed artifact is outside the declared release directory'), { code: 'RELEASE_ARTIFACT_BOUNDARY_INVALID' })
  }
  return artifactPath
}

function writeAtomicJson(target, value) {
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
  try {
    fs.renameSync(temporary, target)
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}

function assertReleaseQualification(options = {}) {
  const qualification = verifyReleaseValidationReceipt(options)
  if (!qualification.valid) {
    const error = new Error(`release qualification is not current: ${qualification.errors.join(', ')}`)
    error.code = 'RELEASE_QUALIFICATION_INVALID'
    error.qualification = qualification
    throw error
  }
  return qualification
}

function artifactEvidence(artifactPath) {
  const bytes = fs.readFileSync(artifactPath)
  return {
    bytes: bytes.length,
    sha256: digestBuffer('sha256', bytes),
    sha512: digestBuffer('sha512', bytes),
    integrity: `sha512-${digestBuffer('sha512', bytes, 'base64')}`
  }
}

function createExactReleaseArtifact(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || ROOT)
  const outputDir = path.resolve(options.outputDir || path.join(repoRoot, '.release-artifacts'))
  fs.mkdirSync(outputDir, { recursive: true })
  const existing = fs.readdirSync(outputDir).filter(name => name.endsWith('.tgz') || name === RECEIPT_FILE)
  if (existing.length) {
    throw Object.assign(new Error(`release directory must start empty: ${existing.join(', ')}`), {
      code: 'RELEASE_ARTIFACT_DIRECTORY_NOT_EMPTY'
    })
  }
  const before = assertReleaseQualification({ ...options, repoRoot })
  const pack = runChecked('npm', ['pack', '--json', '--pack-destination', outputDir], {
    cwd: repoRoot,
    timeoutMs: Number(options.timeoutMs || 180000),
    maxBuffer: 16 * 1024 * 1024,
    summaryLimit: 2 * 1024 * 1024
  })
  const npmMetadata = parsePackJson(pack.stdout)
  const artifactPath = resolveArtifactPath(outputDir, npmMetadata.filename)
  if (!fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile()) {
    throw Object.assign(new Error('npm pack did not create the declared tarball'), { code: 'RELEASE_ARTIFACT_MISSING' })
  }
  const after = assertReleaseQualification({ ...options, repoRoot })
  if (before.candidate.candidateId !== after.candidate.candidateId ||
      before.receipt.terminalDigest !== after.receipt.terminalDigest) {
    throw Object.assign(new Error('source candidate or release qualification changed while packing'), {
      code: 'RELEASE_ARTIFACT_SOURCE_DRIFT'
    })
  }
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  const evidence = artifactEvidence(artifactPath)
  if ((npmMetadata.integrity && npmMetadata.integrity !== evidence.integrity) ||
      (npmMetadata.shasum && npmMetadata.shasum !== digestBuffer('sha1', fs.readFileSync(artifactPath)))) {
    throw Object.assign(new Error('npm pack metadata does not match the exact tarball bytes'), {
      code: 'RELEASE_ARTIFACT_NPM_METADATA_MISMATCH'
    })
  }
  const core = {
    schemaVersion: RECEIPT_SCHEMA,
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    artifactFile: path.basename(artifactPath),
    ...evidence,
    entryCount: Number(npmMetadata.entryCount ?? npmMetadata.files?.length ?? 0),
    npmPack: {
      id: npmMetadata.id || null,
      name: npmMetadata.name || packageJson.name,
      version: npmMetadata.version || packageJson.version,
      filename: npmMetadata.filename,
      size: Number(npmMetadata.size || evidence.bytes),
      unpackedSize: Number(npmMetadata.unpackedSize || 0),
      shasum: npmMetadata.shasum || null,
      integrity: npmMetadata.integrity || null
    },
    candidateId: after.candidate.candidateId,
    candidateHead: after.candidate.head || null,
    releaseTerminalDigest: after.receipt.terminalDigest,
    releaseReceiptId: after.receipt.receiptId || null,
    createdAt: new Date().toISOString()
  }
  const receipt = Object.freeze({ ...core, receiptDigest: digestCore(core) })
  const receiptPath = path.join(outputDir, RECEIPT_FILE)
  writeAtomicJson(receiptPath, receipt)
  return { receipt, receiptPath, artifactPath, pack }
}

function readAndVerifyExactReleaseArtifact(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || ROOT)
  const outputDir = path.resolve(options.outputDir || path.join(repoRoot, '.release-artifacts'))
  const receiptPath = path.resolve(options.receiptPath || path.join(outputDir, RECEIPT_FILE))
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'))
  const { receiptDigest, ...core } = receipt
  const errors = []
  if (receipt.schemaVersion !== RECEIPT_SCHEMA) errors.push('release-artifact-schema-invalid')
  if (digestCore(core) !== receiptDigest) errors.push('release-artifact-receipt-digest-invalid')
  let artifactPath = null
  try { artifactPath = resolveArtifactPath(path.dirname(receiptPath), receipt.artifactFile) } catch { errors.push('release-artifact-boundary-invalid') }
  if (!artifactPath || !fs.existsSync(artifactPath)) errors.push('release-artifact-missing')
  if (artifactPath && fs.existsSync(artifactPath)) {
    const evidence = artifactEvidence(artifactPath)
    for (const field of ['bytes', 'sha256', 'sha512', 'integrity']) {
      if (evidence[field] !== receipt[field]) errors.push(`release-artifact-${field}-mismatch`)
    }
  }
  let qualification = null
  if (options.embeddedQualification === true) {
    const candidate = buildCandidateIdentity({ repoRoot })
    qualification = { mode: 'embedded-cross-job', candidate, releaseTerminalDigest: receipt.releaseTerminalDigest }
    if (candidate.candidateId !== receipt.candidateId) errors.push('release-artifact-candidate-mismatch')
    if ((candidate.head || null) !== receipt.candidateHead) errors.push('release-artifact-head-mismatch')
    if (!/^[a-f0-9]{64}$/.test(String(receipt.releaseTerminalDigest || ''))) errors.push('release-artifact-terminal-invalid')
  } else {
    try {
      qualification = assertReleaseQualification({ ...options, repoRoot })
      if (qualification.candidate.candidateId !== receipt.candidateId) errors.push('release-artifact-candidate-mismatch')
      if ((qualification.candidate.head || null) !== receipt.candidateHead) errors.push('release-artifact-head-mismatch')
      if (qualification.receipt.terminalDigest !== receipt.releaseTerminalDigest) errors.push('release-artifact-terminal-mismatch')
    } catch (error) {
      errors.push(error.code || 'release-artifact-qualification-invalid')
    }
  }
  return { valid: errors.length === 0, errors, receipt, receiptPath, artifactPath, qualification }
}

function evaluatePublishedMetadata(exactReceipt, published = {}, options = {}) {
  const errors = []
  const warnings = []
  if (published.version && published.version !== exactReceipt.packageVersion) errors.push('published-version-mismatch')
  if (published['dist.integrity'] !== exactReceipt.integrity) errors.push('published-integrity-mismatch')
  if (published['dist.shasum'] !== exactReceipt.npmPack.shasum) errors.push('published-shasum-mismatch')
  if (published.gitHead === undefined || published.gitHead === null || published.gitHead === '') {
    warnings.push('published-git-head-missing')
  } else if (published.gitHead !== exactReceipt.candidateHead) {
    errors.push('published-git-head-mismatch')
  }
  if (published['dist.attestations']?.provenance?.predicateType !== 'https://slsa.dev/provenance/v1') {
    if (options.requireProvenance === false) warnings.push('published-provenance-pending')
    else errors.push('published-provenance-missing')
  }
  return { valid: errors.length === 0, errors, warnings }
}

function createPublishedArtifactReceiptFromExact(exactReceipt, options = {}) {
  const publicationStatus = String(options.publicationStatus || 'published')
  if (!['published', 'already-published'].includes(publicationStatus)) {
    throw Object.assign(new Error(`unknown publication status: ${publicationStatus}`), {
      code: 'PUBLISHED_ARTIFACT_STATUS_INVALID'
    })
  }
  const core = {
    schemaVersion: PUBLISHED_RECEIPT_SCHEMA,
    exactReleaseReceiptDigest: exactReceipt.receiptDigest,
    packageName: exactReceipt.packageName,
    packageVersion: exactReceipt.packageVersion,
    artifactFile: exactReceipt.artifactFile,
    bytes: exactReceipt.bytes,
    sha256: exactReceipt.sha256,
    integrity: exactReceipt.integrity,
    shasum: exactReceipt.npmPack.shasum,
    candidateHead: exactReceipt.candidateHead,
    registry: String(options.registry || DEFAULT_REGISTRY),
    publicationStatus,
    workflowRunId: options.workflowRunId ? String(options.workflowRunId) : null,
    workflowRunAttempt: options.workflowRunAttempt ? String(options.workflowRunAttempt) : null,
    publishedAt: String(options.publishedAt || new Date().toISOString())
  }
  return Object.freeze({ ...core, receiptDigest: digestCore(core) })
}

function verifyPublishedArtifactReceipt(receipt, exactReceipt) {
  const errors = []
  if (receipt?.schemaVersion !== PUBLISHED_RECEIPT_SCHEMA) errors.push('published-receipt-schema-invalid')
  if (!receipt || typeof receipt !== 'object') return { valid: false, errors: ['published-receipt-invalid'] }
  const { receiptDigest, ...core } = receipt
  if (digestCore(core) !== receiptDigest) errors.push('published-receipt-digest-invalid')
  for (const [field, expected] of Object.entries({
    exactReleaseReceiptDigest: exactReceipt.receiptDigest,
    packageName: exactReceipt.packageName,
    packageVersion: exactReceipt.packageVersion,
    artifactFile: exactReceipt.artifactFile,
    bytes: exactReceipt.bytes,
    sha256: exactReceipt.sha256,
    integrity: exactReceipt.integrity,
    shasum: exactReceipt.npmPack.shasum,
    candidateHead: exactReceipt.candidateHead
  })) {
    if (receipt[field] !== expected) errors.push(`published-receipt-${field}-mismatch`)
  }
  if (!['published', 'already-published'].includes(receipt.publicationStatus)) {
    errors.push('published-receipt-status-invalid')
  }
  return { valid: errors.length === 0, errors }
}

function writePublishedArtifactReceipt(options = {}) {
  const verified = readAndVerifyExactReleaseArtifact(options)
  if (!verified.valid) {
    throw Object.assign(new Error(`exact release artifact is invalid: ${verified.errors.join(', ')}`), {
      code: 'RELEASE_ARTIFACT_INVALID'
    })
  }
  const publishedReceiptPath = path.join(path.dirname(verified.receiptPath), PUBLISHED_RECEIPT_FILE)
  if (fs.existsSync(publishedReceiptPath)) {
    const existing = JSON.parse(fs.readFileSync(publishedReceiptPath, 'utf8'))
    const existingVerification = verifyPublishedArtifactReceipt(existing, verified.receipt)
    if (!existingVerification.valid) {
      throw Object.assign(new Error(`existing published receipt drifted: ${existingVerification.errors.join(', ')}`), {
        code: 'PUBLISHED_ARTIFACT_RECEIPT_DRIFT'
      })
    }
    return { ...verified, publishedReceipt: existing, publishedReceiptPath, idempotent: true }
  }
  const publishedReceipt = createPublishedArtifactReceiptFromExact(verified.receipt, options)
  writeAtomicJson(publishedReceiptPath, publishedReceipt)
  const readback = JSON.parse(fs.readFileSync(publishedReceiptPath, 'utf8'))
  const readbackVerification = verifyPublishedArtifactReceipt(readback, verified.receipt)
  if (!readbackVerification.valid) {
    throw Object.assign(new Error(`published receipt readback failed: ${readbackVerification.errors.join(', ')}`), {
      code: 'PUBLISHED_ARTIFACT_RECEIPT_READBACK_INVALID'
    })
  }
  return { ...verified, publishedReceipt: readback, publishedReceiptPath, idempotent: false }
}

function readPublishedArtifactReceipt(options = {}) {
  const verified = readAndVerifyExactReleaseArtifact(options)
  const publishedReceiptPath = path.resolve(options.publishedReceiptPath || path.join(
    path.dirname(verified.receiptPath),
    PUBLISHED_RECEIPT_FILE
  ))
  const errors = [...verified.errors]
  let publishedReceipt = null
  if (!fs.existsSync(publishedReceiptPath)) errors.push('published-receipt-missing')
  else {
    try {
      publishedReceipt = JSON.parse(fs.readFileSync(publishedReceiptPath, 'utf8'))
      errors.push(...verifyPublishedArtifactReceipt(publishedReceipt, verified.receipt).errors)
    } catch {
      errors.push('published-receipt-json-invalid')
    }
  }
  return { ...verified, valid: errors.length === 0, errors, publishedReceipt, publishedReceiptPath }
}

function queryPublishedMetadata(options, exactReceipt) {
  if (options.publishedMetadata) return { status: 'available', published: options.publishedMetadata, query: null }
  const spec = `${exactReceipt.packageName}@${exactReceipt.packageVersion}`
  try {
    const query = (options.runCommand || runChecked)('npm', [
      'view', spec,
      'version', 'dist.integrity', 'dist.shasum', 'dist.attestations', 'gitHead',
      '--json', `--registry=${options.registry || DEFAULT_REGISTRY}`
    ], {
      cwd: path.resolve(options.repoRoot || ROOT),
      timeoutMs: Number(options.timeoutMs || 30000),
      maxBuffer: 1024 * 1024
    })
    return { status: 'available', published: JSON.parse(String(query.stdout || '{}')), query }
  } catch (error) {
    const evidence = `${error.evidence?.stdout || ''}\n${error.evidence?.stderr || ''}`
    if (/E404|404 Not Found|is not in this registry/i.test(evidence)) {
      return { status: 'missing', published: null, query: error.evidence || null }
    }
    return { status: 'pending', published: null, query: error.evidence || null, error }
  }
}

function preparePublishedArtifact(options = {}) {
  const verified = readAndVerifyExactReleaseArtifact(options)
  if (!verified.valid) return { ...verified, action: 'block' }
  const registry = queryPublishedMetadata(options, verified.receipt)
  if (registry.status === 'missing') return { ...verified, action: 'publish-required', registry }
  if (registry.status !== 'available') {
    throw Object.assign(new Error('registry state is unavailable; refusing to guess whether publish is safe'), {
      code: 'PUBLISH_REGISTRY_PROBE_UNAVAILABLE'
    })
  }
  const evaluation = evaluatePublishedMetadata(verified.receipt, registry.published, { requireProvenance: false })
  if (!evaluation.valid) {
    throw Object.assign(new Error(`existing version does not match the qualified artifact: ${evaluation.errors.join(', ')}`), {
      code: 'PUBLISHED_ARTIFACT_IDENTITY_MISMATCH'
    })
  }
  const receipt = writePublishedArtifactReceipt({ ...options, publicationStatus: 'already-published' })
  return { ...receipt, action: 'skip-publish', registry, warnings: evaluation.warnings }
}

function postcheckPublishedArtifact(options = {}) {
  const verified = readPublishedArtifactReceipt(options)
  if (!verified.valid) return { ...verified, pending: false, warnings: [] }
  const registry = queryPublishedMetadata(options, verified.receipt)
  if (registry.status !== 'available') {
    return {
      ...verified,
      valid: false,
      pending: true,
      errors: ['published-registry-not-ready'],
      warnings: [],
      registry
    }
  }
  const evaluation = evaluatePublishedMetadata(verified.receipt, registry.published)
  return {
    ...verified,
    valid: evaluation.valid,
    pending: false,
    errors: evaluation.errors,
    warnings: evaluation.warnings,
    published: registry.published,
    query: registry.query
  }
}

function parseArgs(argv) {
  const command = argv[0] || 'verify'
  const value = name => {
    const index = argv.indexOf(name)
    return index >= 0 ? argv[index + 1] : null
  }
  return {
    command,
    outputDir: value('--output-dir'),
    receiptPath: value('--receipt'),
    publishedReceiptPath: value('--published-receipt'),
    publicationStatus: value('--status'),
    workflowRunId: value('--run-id'),
    workflowRunAttempt: value('--run-attempt'),
    registry: value('--registry'),
    embeddedQualification: argv.includes('--embedded-qualification')
  }
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  try {
    const options = {
      outputDir: args.outputDir || undefined,
      receiptPath: args.receiptPath || undefined,
      publishedReceiptPath: args.publishedReceiptPath || undefined,
      publicationStatus: args.publicationStatus || undefined,
      workflowRunId: args.workflowRunId || undefined,
      workflowRunAttempt: args.workflowRunAttempt || undefined,
      registry: args.registry || undefined,
      embeddedQualification: args.embeddedQualification
    }
    let result
    if (args.command === 'create') result = createExactReleaseArtifact(options)
    else if (args.command === 'prepare-publish') result = preparePublishedArtifact(options)
    else if (args.command === 'mark-published') result = writePublishedArtifactReceipt(options)
    else if (['postcheck', 'finalize'].includes(args.command)) result = postcheckPublishedArtifact(options)
    else if (args.command === 'verify-published') result = readPublishedArtifactReceipt(options)
    else result = readAndVerifyExactReleaseArtifact(options)
    if (result.pending) {
      process.stderr.write(`Published artifact is not yet visible: ${result.errors.join(', ')}\n`)
      return 75
    }
    if (args.command !== 'create' && !result.valid) {
      process.stderr.write(`Exact release artifact verification failed: ${result.errors.join(', ')}\n`)
      return 1
    }
    process.stdout.write(`${JSON.stringify({
      ok: true,
      action: result.action || null,
      receiptPath: result.receiptPath,
      artifactPath: result.artifactPath,
      receiptDigest: result.receipt.receiptDigest,
      integrity: result.receipt.integrity,
      publishedReceiptPath: result.publishedReceiptPath || null,
      publishedReceiptDigest: result.publishedReceipt?.receiptDigest || null,
      publicationStatus: result.publishedReceipt?.publicationStatus || null,
      warnings: result.warnings || []
    })}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`${error.code || 'EXACT_RELEASE_ARTIFACT_FAILED'}: ${error.message}\n`)
    return 1
  }
}

if (require.main === module) process.exitCode = main()

module.exports = {
  DEFAULT_REGISTRY,
  PUBLISHED_RECEIPT_FILE,
  PUBLISHED_RECEIPT_SCHEMA,
  RECEIPT_FILE,
  RECEIPT_SCHEMA,
  artifactEvidence,
  createPublishedArtifactReceiptFromExact,
  createExactReleaseArtifact,
  evaluatePublishedMetadata,
  postcheckPublishedArtifact,
  preparePublishedArtifact,
  queryPublishedMetadata,
  readAndVerifyExactReleaseArtifact,
  readPublishedArtifactReceipt,
  resolveArtifactPath,
  verifyPublishedArtifactReceipt,
  writePublishedArtifactReceipt
}
