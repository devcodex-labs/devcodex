'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const RECEIPT_SCHEMA = 'GlobalHostConfigReceiptV1'

function portable (filePath) {
  return path.resolve(filePath).replace(/\\/g, '/')
}

function samePath (left, right) {
  const a = path.resolve(left || '')
  const b = path.resolve(right || '')
  return process.platform === 'win32'
    ? a.toLowerCase() === b.toLowerCase()
    : a === b
}

function readJson (file, fsImpl = fs) {
  try {
    return JSON.parse(fsImpl.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function hasPortfolio (root, fsImpl = fs) {
  if (!root) return false
  try {
    return fsImpl.statSync(path.join(root, 'portfolio.json')).isFile()
  } catch {
    return false
  }
}

function sourceSkillsRoot (packageRoot, fsImpl = fs) {
  const packageJson = readJson(path.join(packageRoot, 'package.json'), fsImpl)
  const contentRoot = path.join(packageRoot, 'content', 'skills')
  if (
    packageJson?.name !== 'devcodex' ||
    !hasPortfolio(contentRoot, fsImpl)
  ) return null
  return {
    root: contentRoot,
    portfolioPath: path.join(contentRoot, 'portfolio.json')
  }
}

function inferredManagedRoot (options = {}) {
  const env = options.env || process.env
  const home = path.resolve(
    options.home ||
    env.DEVCODEX_TEST_HOME ||
    env.USERPROFILE ||
    env.HOME ||
    os.homedir()
  )
  if (env.DEVCODEX_GLOBAL_SKILLS_ROOT) return path.resolve(env.DEVCODEX_GLOBAL_SKILLS_ROOT)
  if (env.DEVCODEX_GLOBAL_SKILLS_RUNTIME) return path.resolve(env.DEVCODEX_GLOBAL_SKILLS_RUNTIME)
  const sharedRoot = env.DEVCODEX_GLOBAL_SHARED_ROOT
    ? path.resolve(env.DEVCODEX_GLOBAL_SHARED_ROOT)
    : path.join(home, '.agents')
  return path.join(sharedRoot, 'devcodex', 'skills')
}

function validateReceipt (receipt, receiptPath, runtimeRoot, fsImpl = fs) {
  if (!receipt || receipt.schemaVersion !== RECEIPT_SCHEMA) {
    return { ok: false, reasonCode: 'receipt-invalid' }
  }
  if (receipt.result !== 'committed') {
    return { ok: false, reasonCode: 'receipt-not-committed' }
  }
  if (receipt.packageName !== 'devcodex') {
    return { ok: false, reasonCode: 'receipt-package-mismatch' }
  }
  if (!receipt.runtimeRoot || !samePath(receipt.runtimeRoot, runtimeRoot)) {
    return { ok: false, reasonCode: 'receipt-runtime-mismatch' }
  }
  if (!receipt.skillsRuntimeRoot) {
    return { ok: false, reasonCode: 'receipt-skills-root-missing' }
  }
  const root = path.resolve(receipt.skillsRuntimeRoot)
  if (!hasPortfolio(root, fsImpl)) {
    return { ok: false, reasonCode: 'receipt-portfolio-missing', root }
  }
  return {
    ok: true,
    root,
    receiptPath,
    sourceDigest: receipt.sourceDigest || null,
    packageVersion: receipt.packageVersion || null
  }
}

function resolveGlobalSkillRuntimeRoot (options = {}) {
  const fsImpl = options.fs || fs
  const env = options.env || process.env
  const runtimeRoot = path.resolve(
    options.runtimeRoot ||
    options.packageRoot ||
    path.join(__dirname, '..', '..')
  )
  const packageRoot = path.resolve(options.packageRoot || runtimeRoot)
  const attempts = []

  const explicitRoot = options.globalSkillsRoot ||
    env.DEVCODEX_GLOBAL_SKILLS_ROOT ||
    env.DEVCODEX_GLOBAL_SKILLS_RUNTIME
  if (explicitRoot) {
    const root = path.resolve(explicitRoot)
    if (hasPortfolio(root, fsImpl)) {
      return {
        schemaVersion: 'GlobalSkillRuntimeRootV1',
        status: 'resolved',
        source: 'explicit',
        root: portable(root),
        portfolioPath: portable(path.join(root, 'portfolio.json')),
        receiptPath: null,
        sourceDigest: null,
        attempts
      }
    }
    attempts.push({ source: 'explicit', root: portable(root), reasonCode: 'portfolio-missing' })
  }

  const sourceRoot = sourceSkillsRoot(packageRoot, fsImpl)
  if (sourceRoot) {
    return {
      schemaVersion: 'GlobalSkillRuntimeRootV1',
      status: 'resolved',
      source: 'source-package',
      root: portable(sourceRoot.root),
      portfolioPath: portable(sourceRoot.portfolioPath),
      companionRoot: portable(sourceRoot.root),
      receiptPath: null,
      sourceDigest: null,
      attempts
    }
  }
  attempts.push({
    source: 'source-package',
    root: portable(path.join(packageRoot, 'content', 'skills')),
    reasonCode: 'source-package-unbound'
  })

  const receiptPath = path.resolve(
    options.receiptPath ||
    path.join(runtimeRoot, '..', 'global-host-receipt.json')
  )
  const receipt = readJson(receiptPath, fsImpl)
  const receiptResult = validateReceipt(receipt, receiptPath, runtimeRoot, fsImpl)
  if (receiptResult.ok) {
    return {
      schemaVersion: 'GlobalSkillRuntimeRootV1',
      status: 'resolved',
      source: 'committed-receipt',
      root: portable(receiptResult.root),
      portfolioPath: portable(path.join(receiptResult.root, 'portfolio.json')),
      companionRoot: portable(receiptResult.root),
      receiptPath: portable(receiptPath),
      sourceDigest: receiptResult.sourceDigest,
      packageVersion: receiptResult.packageVersion,
      attempts
    }
  }
  attempts.push({
    source: 'committed-receipt',
    root: receiptResult.root ? portable(receiptResult.root) : null,
    receiptPath: portable(receiptPath),
    reasonCode: receiptResult.reasonCode
  })

  const inferred = inferredManagedRoot({ ...options, env })
  if (hasPortfolio(inferred, fsImpl)) {
    return {
      schemaVersion: 'GlobalSkillRuntimeRootV1',
      status: 'resolved',
      source: 'managed-root-recovery',
      root: portable(inferred),
      portfolioPath: portable(path.join(inferred, 'portfolio.json')),
      companionRoot: portable(inferred),
      receiptPath: fsImpl.existsSync(receiptPath) ? portable(receiptPath) : null,
      sourceDigest: null,
      attempts
    }
  }
  attempts.push({
    source: 'managed-root-recovery',
    root: portable(inferred),
    reasonCode: 'portfolio-missing'
  })

  return {
    schemaVersion: 'GlobalSkillRuntimeRootV1',
    status: 'blocked',
    errorCode: 'GLOBAL_SKILL_RUNTIME_ROOT_UNRESOLVED',
    root: null,
    portfolioPath: null,
    receiptPath: fsImpl.existsSync(receiptPath) ? portable(receiptPath) : null,
    sourceDigest: null,
    attempts
  }
}

module.exports = {
  RECEIPT_SCHEMA,
  resolveGlobalSkillRuntimeRoot,
  validateReceipt,
  inferredManagedRoot,
  hasPortfolio,
  samePath
}
