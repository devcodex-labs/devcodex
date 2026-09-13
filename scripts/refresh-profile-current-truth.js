#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { resolveProfileDir } = require('../hooks/_runtime/workspace-layout.cjs')
const {
  extractWorkflowCurrentTruth,
  parseProfileCurrentTruth,
  validateDevCodexCurrentTruth
} = require('./lib/profile-current-truth')
const { buildCandidateIdentity } = require('./lib/validation-dag')

const ROOT = path.resolve(__dirname, '..')
const TRUTH_HEADING_RE = /^## ProfileCurrentTruthV1[ \t]*\n```json\n[\s\S]*?\n```(?:\n|$)/m

function argValue(args, name) {
  const index = args.indexOf(name)
  if (index === -1 || index + 1 >= args.length) return ''
  return args[index + 1]
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function currentGitHead(repoRoot) {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

function isoNoMillis(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function buildRefreshedCurrentTruthRecord(record, input) {
  const packageVersion = input.packageVersion || record.sourceVersion
  const npmLatest = record.npmLatest || packageVersion
  const gitHead = input.gitHead || record.gitHead
  const candidateId = input.candidateId || record.sourceCandidate?.candidateId || ''
  const ciMatrix = input.ciMatrix || record.ciMatrix
  const identityMatches = record.sourceVersion === packageVersion &&
    record.npmLatest === npmLatest &&
    record.gitHead === gitHead &&
    record.sourceCandidate?.candidateId === candidateId &&
    JSON.stringify(record.ciMatrix || null) === JSON.stringify(ciMatrix || null)
  const now = input.now || (identityMatches && record.asOf ? record.asOf : isoNoMillis())
  const releaseCommit = record.releaseCommit || record.gitHead
  const exactReleasedHead = gitHead === releaseCommit && packageVersion === npmLatest

  const next = {
    ...record,
    sourceVersion: packageVersion,
    npmLatest,
    gitHead,
    releaseCommit,
    ciMatrix,
    asOf: now
  }

  if (exactReleasedHead && record.sourceCandidate?.status === 'RELEASED') {
    next.releaseState = record.releaseState || `${packageVersion} released`
    next.sourceCandidate = {
      ...record.sourceCandidate,
      candidateId,
      remoteCi: {
        ...record.sourceCandidate.remoteCi,
        head: gitHead
      }
    }
    return next
  }

  delete next.candidate
  next.releaseState = `${npmLatest}发行事实保持有效；当前HEAD及工作区为尚未选定下一版本的本地工作态，资格与远端CI待验证`
  next.sourceCandidate = {
    schemaVersion: 'SourceCandidateTruthV1',
    ...(record.sourceCandidate || {}),
    candidateId,
    status: 'LOCAL_PENDING',
    localQualification: {
      status: 'UNVERIFIED',
      runId: 'not-qualified-working-source',
      observedAt: identityMatches
        ? (record.sourceCandidate?.localQualification?.observedAt || now)
        : now
    },
    remoteCi: {
      status: 'UNVERIFIED',
      runId: 'not-pushed',
      head: gitHead,
      observedAt: identityMatches
        ? (record.sourceCandidate?.remoteCi?.observedAt || now)
        : now
    },
    releaseAuthorized: false
  }
  return next
}

function replaceCurrentTruthBlock(markdown, record) {
  const nextBlock = `## ProfileCurrentTruthV1\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\`\n`
  if (!TRUTH_HEADING_RE.test(markdown)) {
    throw new Error('ProfileCurrentTruthV1 block not found or not a strict json fence')
  }
  return markdown.replace(TRUTH_HEADING_RE, nextBlock)
}

function refreshProfileCurrentTruth(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || ROOT)
  const profileDir = path.resolve(options.profileDir || resolveProfileDir(repoRoot))
  const releaseProfilePath = path.join(profileDir, '05-发布规范.md')
  const releaseProfileText = fs.readFileSync(releaseProfilePath, 'utf8')
  const parsed = parseProfileCurrentTruth(releaseProfileText, { required: true })
  if (!parsed.valid || !parsed.record) {
    const error = new Error(`current Profile truth is invalid: ${parsed.errors.join('; ')}`)
    error.errors = parsed.errors
    throw error
  }

  const packageVersion = readJson(path.join(repoRoot, 'package.json')).version
  const gitHead = currentGitHead(repoRoot)
  const candidateId = buildCandidateIdentity({ repoRoot }).candidateId
  const workflowText = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8')
  const validationManifest = readJson(path.join(repoRoot, 'scripts', 'validation-manifest.json'))
  const nextRecord = buildRefreshedCurrentTruthRecord(parsed.record, {
    packageVersion,
    gitHead,
    candidateId,
    ciMatrix: extractWorkflowCurrentTruth(workflowText, validationManifest),
    now: options.now
  })
  const nextText = replaceCurrentTruthBlock(releaseProfileText, nextRecord)
  const changed = nextText !== releaseProfileText

  const validation = validateDevCodexCurrentTruth({
    releaseProfileText: nextText,
    overviewProfileText: fs.readFileSync(path.join(profileDir, '01-项目信息.md'), 'utf8'),
    testProfileText: fs.readFileSync(path.join(profileDir, '04-测试规范.md'), 'utf8'),
    docsProfileText: fs.readFileSync(path.join(profileDir, '07-用户文档与契约规范.md'), 'utf8'),
    packageVersion,
    gitHead,
    candidateId,
    requireSourceCandidate: true,
    workflowText,
    validationManifest
  })
  if (!validation.valid) {
    const error = new Error(`refreshed ProfileCurrentTruthV1 is invalid: ${validation.errors.join('; ')}`)
    error.errors = validation.errors
    throw error
  }

  if (!options.check && changed) fs.writeFileSync(releaseProfilePath, nextText, 'utf8')
  return { releaseProfilePath, changed, record: nextRecord }
}

function main() {
  const args = process.argv.slice(2)
  const result = refreshProfileCurrentTruth({
    repoRoot: argValue(args, '--project-root') || ROOT,
    profileDir: argValue(args, '--profile-dir') || '',
    check: args.includes('--check')
  })
  const action = result.changed ? (args.includes('--check') ? 'needs-refresh' : 'refreshed') : 'already-current'
  console.log(`[profile-current:refresh] ${action}: ${result.releaseProfilePath}`)
  if (args.includes('--check') && result.changed) process.exitCode = 1
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(`[profile-current:refresh] ${error.message}`)
    process.exitCode = 1
  }
}

module.exports = {
  buildRefreshedCurrentTruthRecord,
  refreshProfileCurrentTruth,
  replaceCurrentTruthBlock
}
