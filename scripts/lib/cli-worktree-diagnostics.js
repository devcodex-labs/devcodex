'use strict'

const { inspectWorktreeLifecycle } = require('./worktree-lifecycle.js')

function inspect(cwd) {
  return inspectWorktreeLifecycle(cwd)
}

function renderStatus({ console, c, worktrees }) {
  if (worktrees.status === 'PASS' || worktrees.status === 'WARN') {
    const external = worktrees.worktrees.filter(item => item.receipt.owner === 'external-unowned').length
    const prunable = worktrees.worktrees.filter(item => item.prunable).length
    console.log(`  ${c.cyan('worktrees'.padEnd(14))} ${worktrees.status}; ${worktrees.boundedInventory.discovered} detected; ${external} external-unowned; ${prunable} prunable metadata; read-only`)
    return
  }
  console.log(`  ${c.cyan('worktrees'.padEnd(14))} ${c.dim('UNVERIFIED; no Git or filesystem mutation attempted')}`)
}

function renderDoctor({ console, c, worktrees }) {
  if (worktrees.status !== 'PASS' && worktrees.status !== 'WARN') {
    console.log('  worktrees:       UNVERIFIED; no Git or filesystem mutation attempted')
    return
  }
  console.log(`  worktrees:       ${worktrees.status}; ${worktrees.boundedInventory.discovered} detected; read-only inventory; no prune/remove/unlock/safe.directory mutation`)
  for (const item of worktrees.worktrees.slice(0, 8)) {
    const receipt = item.receipt
    console.log(c.dim(`    ${receipt.worktreePath} · ${receipt.owner} · dirty=${receipt.dirtyState} · lock=${receipt.lockState}${item.prunable ? ' · prunable-metadata' : ''}`))
  }
  if (worktrees.worktrees.length > 8) console.log(c.dim(`    … ${worktrees.worktrees.length - 8} more; use doctor --json`))
}

module.exports = { inspect, renderStatus, renderDoctor }
