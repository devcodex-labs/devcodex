#!/usr/bin/env node
'use strict'

const path = require('path')

const { buildCandidateIdentity } = require('./lib/validation-dag')
const { createValidationEvidenceStore } = require('./lib/validation-evidence-store')
const { resolveActiveRuntimeRoot } = require('../hooks/_runtime/workspace-layout.cjs')

const ROOT = path.resolve(__dirname, '..')

function verifyReleaseValidationReceipt(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || ROOT)
  const activeRoot = options.activeRoot || resolveActiveRuntimeRoot(repoRoot)
  const candidate = options.candidate || buildCandidateIdentity({ repoRoot })
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  const observed = createValidationEvidenceStore({
    activeRoot,
    project: options.project || 'devcodex',
    actorType: 'release-pipeline'
  }).readTerminal()
  const receipt = observed.receipt
  const errors = []
  if (observed.status !== 'fresh' || !receipt) errors.push('release-terminal-receipt-missing')
  if (receipt?.terminalStatus !== 'completed' || receipt?.nativeExitCode !== 0) errors.push('release-terminal-not-completed')
  if (receipt?.candidateId !== candidate.candidateId || receipt?.candidateHead !== (candidate.head || null)) errors.push('release-candidate-mismatch')
  if (receipt?.actorType !== 'release-pipeline' || receipt?.authorityClass !== 'release') errors.push('release-authority-mismatch')
  if (receipt?.verificationLevel !== 'V3' || receipt?.verificationPurpose !== 'release' || receipt?.routeResolved !== 'full') {
    errors.push('release-qualification-scope-mismatch')
  }
  if (candidate.stable !== true) errors.push('release-candidate-not-stable')
  const completedAtMs = Date.parse(String(receipt?.completedAt || ''))
  if (!Number.isFinite(completedAtMs) || completedAtMs > nowMs || nowMs - completedAtMs > 2 * 60 * 60 * 1000) {
    errors.push('release-terminal-receipt-stale')
  }
  return { valid: errors.length === 0, errors, observed, candidate, receipt }
}

if (require.main === module) {
  const result = verifyReleaseValidationReceipt()
  if (!result.valid) {
    process.stderr.write('Release validation receipt is not current: ' + result.errors.join(', ') + '\n')
    process.exitCode = 1
  } else {
    process.stdout.write('Release validation receipt verified for ' + result.candidate.candidateId + '\n')
  }
}

module.exports = { verifyReleaseValidationReceipt }
