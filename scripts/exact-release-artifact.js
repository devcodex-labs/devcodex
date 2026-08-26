#!/usr/bin/env node
'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const { stableStringify } = require('../hooks/_runtime/content-identity.cjs')
const { runChecked } = require('./lib/checked-command')
const { verifyReleaseValidationReceipt } = require('./verify-release-validation-receipt')

const ROOT = path.resolve(__dirname, '..')
const RECEIPT_SCHEMA = 'ExactReleaseArtifactReceiptV1'
const RECEIPT_FILE = 'exact-release-artifact.receipt.json'

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
  try {
    qualification = assertReleaseQualification({ ...options, repoRoot })
    if (qualification.candidate.candidateId !== receipt.candidateId) errors.push('release-artifact-candidate-mismatch')
    if ((qualification.candidate.head || null) !== receipt.candidateHead) errors.push('release-artifact-head-mismatch')
    if (qualification.receipt.terminalDigest !== receipt.releaseTerminalDigest) errors.push('release-artifact-terminal-mismatch')
  } catch (error) {
    errors.push(error.code || 'release-artifact-qualification-invalid')
  }
  return { valid: errors.length === 0, errors, receipt, receiptPath, artifactPath, qualification }
}

function postcheckPublishedArtifact(options = {}) {
  const verified = readAndVerifyExactReleaseArtifact(options)
  if (!verified.valid) return verified
  const spec = `${verified.receipt.packageName}@${verified.receipt.packageVersion}`
  const query = runChecked('npm', [
    'view', spec,
    'dist.integrity', 'dist.shasum', 'dist.attestations', 'gitHead',
    '--json', '--registry=https://registry.npmjs.org/'
  ], {
    cwd: path.resolve(options.repoRoot || ROOT),
    timeoutMs: Number(options.timeoutMs || 30000),
    maxBuffer: 1024 * 1024
  })
  const published = JSON.parse(String(query.stdout || '{}'))
  const errors = [...verified.errors]
  if (published['dist.integrity'] !== verified.receipt.integrity) errors.push('published-integrity-mismatch')
  if (published['dist.shasum'] !== verified.receipt.npmPack.shasum) errors.push('published-shasum-mismatch')
  if (published.gitHead !== verified.receipt.candidateHead) errors.push('published-git-head-mismatch')
  if (published['dist.attestations']?.provenance?.predicateType !== 'https://slsa.dev/provenance/v1') {
    errors.push('published-provenance-missing')
  }
  return { ...verified, valid: errors.length === 0, errors, published, query }
}

function parseArgs(argv) {
  const command = argv[0] || 'verify'
  const value = name => {
    const index = argv.indexOf(name)
    return index >= 0 ? argv[index + 1] : null
  }
  return { command, outputDir: value('--output-dir'), receiptPath: value('--receipt') }
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  try {
    const options = { outputDir: args.outputDir || undefined, receiptPath: args.receiptPath || undefined }
    const result = args.command === 'create'
      ? createExactReleaseArtifact(options)
      : (args.command === 'postcheck'
          ? postcheckPublishedArtifact(options)
          : readAndVerifyExactReleaseArtifact(options))
    if (args.command !== 'create' && !result.valid) {
      process.stderr.write(`Exact release artifact verification failed: ${result.errors.join(', ')}\n`)
      return 1
    }
    process.stdout.write(`${JSON.stringify({
      ok: true,
      receiptPath: result.receiptPath,
      artifactPath: result.artifactPath,
      receiptDigest: result.receipt.receiptDigest,
      integrity: result.receipt.integrity
    })}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`${error.code || 'EXACT_RELEASE_ARTIFACT_FAILED'}: ${error.message}\n`)
    return 1
  }
}

if (require.main === module) process.exitCode = main()

module.exports = {
  RECEIPT_FILE,
  RECEIPT_SCHEMA,
  artifactEvidence,
  createExactReleaseArtifact,
  postcheckPublishedArtifact,
  readAndVerifyExactReleaseArtifact,
  resolveArtifactPath
}
