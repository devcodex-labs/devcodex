'use strict'

function formatGlobalHostRuntimeState(host, c, options = {}) {
  const state = host.operationalState || (host.ready ? 'ready' : 'unavailable')
  const details = [
    `configured=${host.configured === true ? 'yes' : 'no'}`,
    `adapter=${host.adapterReady === true ? 'ready' : 'not-ready'}`,
    `contract=${host.contractStatus || 'unverified'}`,
    `native=${host.nativeStatus || 'unverified'}`
  ].join('; ')
  const prefix = options.icon ? `${state === 'ready' ? '✅' : '⚠️'} ` : ''
  const label = `${prefix}${state} (${details})`
  if (state === 'ready') return c.green(label)
  if (state === 'failed') return c.red(label)
  return c.yellow(label)
}

function formatNodeRuntimeReadiness(runtime, c) {
  if (!runtime || runtime.schemaVersion !== 'NodeRuntimeReadinessV1') {
    return c.yellow('UNVERIFIED (diagnostic unavailable)')
  }
  const status = runtime.status || 'UNVERIFIED'
  const details = [
    runtime.smoke?.version || runtime.processVersion || 'version unknown',
    `provider=${runtime.provider || 'unknown'}`,
    `launcher=${runtime.launcherKind || 'unknown'}`
  ]
  if (runtime.reasonCode) details.push(`reason=${runtime.reasonCode}`)
  const label = `${status} (${details.join('; ')})`
  if (status === 'PASS') return c.green(label)
  if (status === 'BLOCK') return c.red(label)
  return c.yellow(label)
}

module.exports = {
  formatGlobalHostRuntimeState,
  formatNodeRuntimeReadiness
}
