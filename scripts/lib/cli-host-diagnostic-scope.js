'use strict'

const SOURCE_CANDIDATE_COMPARISON_ISSUES = new Set([
  'GLOBAL_HOST_RECEIPT_STALE',
  'GLOBAL_HOST_MANAGED_CONFIG_DRIFT'
])

function isSourceCandidateMismatch(host, sourceRepository) {
  const issues = Array.isArray(host?.configurationIssues) ? host.configurationIssues : []
  return sourceRepository === true &&
    host?.configured === true &&
    issues.length > 0 &&
    issues.every(issue => SOURCE_CANDIDATE_COMPARISON_ISSUES.has(issue.code))
}

function buildGlobalHostComparison(sourceRepository, globalHostConfig) {
  const hosts = Array.isArray(globalHostConfig?.hosts) ? globalHostConfig.hosts : []
  const candidateMismatchHosts = hosts
    .filter(host => isSourceCandidateMismatch(host, sourceRepository))
    .map(host => host.host)
  const mismatchSet = new Set(candidateMismatchHosts)
  return {
    schemaVersion: 'GlobalHostDiagnosticScopeV1',
    scope: sourceRepository
      ? 'source-candidate-vs-installed-receipts'
      : 'installed-package-vs-user-global-receipts',
    installedHealthClaim: sourceRepository !== true,
    candidateMismatchHosts,
    adapterIssueHosts: hosts
      .filter(host => host.adapterReady !== true && !mismatchSet.has(host.host))
      .map(host => host.host)
  }
}

function buildScopedHostParity(hostParity, globalHostComparison) {
  const scoped = {
    ...hostParity,
    diagnosticScope: globalHostComparison.scope,
    installedHealthClaim: globalHostComparison.installedHealthClaim
  }
  if (globalHostComparison.installedHealthClaim !== false) return scoped

  return {
    ...scoped,
    sourceCandidateOnly: true,
    hardReady: false,
    tier: 'source-candidate-comparison',
    checks: {},
    failedChecks: [],
    repairSteps: [],
    withheldChecks: hostParity?.checks || {},
    withheldFailedChecks: Array.isArray(hostParity?.failedChecks) ? hostParity.failedChecks : [],
    withheldRepairSteps: Array.isArray(hostParity?.repairSteps) ? hostParity.repairSteps : [],
    userVisibleSummary: 'Source candidate comparison only; installed Grok HostParity health is unverified.',
    recommendedEntry: 'devcodex global-adapters apply --dry-run && devcodex global-adapters apply',
    cannotClaim: [
      'Installed Grok HostParity health is unverified in source-candidate scope.',
      ...(Array.isArray(hostParity?.cannotClaim) ? hostParity.cannotClaim : [])
    ]
  }
}

module.exports = {
  buildGlobalHostComparison,
  buildScopedHostParity,
  isSourceCandidateMismatch
}
