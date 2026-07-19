'use strict'

const { execSync } = require('child_process')

function createValidationOrchestration({
  root,
  reportError,
  env = process.env,
  runCommand = execSync,
  logger = console
}) {
  if (!root || typeof reportError !== 'function') {
    throw new TypeError('validation orchestration requires root and reportError')
  }
  const orchestrated = env.DEVCODEX_VALIDATION_ORCHESTRATED === '1'
  const delegatedNodes = new Set(String(env.DEVCODEX_VALIDATION_DELEGATED_NODES || '')
    .split(',').map(value => value.trim()).filter(Boolean))
  const isDelegated = nodeId => orchestrated && delegatedNodes.has(nodeId)

  function runInstructionFallbackProbe() {
    if (isDelegated('instruction-fallback')) {
      logger.log('[V7b] orchestrated validation — delegated to manifest node instruction-fallback')
      return
    }
    try {
      runCommand('node scripts/test-instruction-fallback-check.js', {
        cwd: root,
        stdio: 'pipe',
        encoding: 'utf8'
      })
      logger.log('[V7b] instruction-fallback smoke test passed')
    } catch (error) {
      const detail = String((error.stderr || error.stdout || error.message || ''))
        .trim().split('\n').slice(0, 8).join(' | ')
      reportError(`[V7b] instruction-fallback smoke test failed${detail ? `: ${detail}` : ''}`)
    }
  }

  return Object.freeze({ isDelegated, runInstructionFallbackProbe })
}

module.exports = { createValidationOrchestration }
