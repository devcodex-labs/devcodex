#!/usr/bin/env node
'use strict'

const { runPostinstall } = require('./lib/npm-lifecycle-adapter')

try {
  const receipt = runPostinstall()
  if (receipt.status === 'executed') {
    console.log(`[devcodex] global postinstall refreshed user-level host adapters (${receipt.globalHostConfig?.hosts?.join(', ') || 'all'})`)
    if (receipt.globalHostConfig?.backupCleanupIncomplete) {
      console.warn(`[devcodex] adapter refresh committed, but ${receipt.globalHostConfig.backupCleanupFailureCount} temporary backup(s) could not be removed`)
    }
    if (receipt.globalHostConfig?.staleCleanupIncomplete) {
      console.warn(`[devcodex] adapter refresh committed, but ${receipt.globalHostConfig.staleCleanupFailureCount} stale managed path(s) remain pending; the next global install or update will retry`)
    }
    if (receipt.globalHostConfig?.receiptFinalizationIncomplete) {
      console.warn(`[devcodex] adapter refresh committed, but ${receipt.globalHostConfig.receiptFinalizationFailureCount} receipt finalization step(s) remain pending; the next global install or update will reconcile them`)
    }
  } else if (receipt.status === 'planned') {
    console.log('[devcodex] global postinstall dry-run planned user-level host adapter refresh')
  } else if (receipt.reason === 'workspace-install-global-required') {
    console.log(`[devcodex] workspace dependency installed; ${receipt.guidance}`)
  } else if (receipt.status === 'failed-soft') {
    const failedHosts = (receipt.globalHostConfig?.hostResults || [])
      .filter(item => item.status !== 'committed')
      .map(item => `${item.host}:${item.status}`)
      .join(', ')
    console.warn(
      `[devcodex] global postinstall incomplete (${failedHosts || receipt.errorCode || 'unknown'}); ` +
      'repair with `npm update -g devcodex`'
    )
  } else if (process.env.DEVCODEX_POSTINSTALL_VERBOSE === '1') {
    console.log(`[devcodex] postinstall skipped: ${receipt.reason}`)
  }
} catch (error) {
  if (process.env.DEVCODEX_POSTINSTALL_STRICT === '1') throw error
  console.warn(`[devcodex] postinstall skipped after adapter refresh error: ${error.message}`)
}
