'use strict'

/**
 * V100 — ClosureEvidence + ControlPlaneContract-First + HomologousDeployFilter anchors
 */
function buildClosureEvidenceControlChecks({ ROOT, fs, path, read, err, console }) {
  const requiredSkillAnchors = [
    ['skills/cp-gate/SKILL.md', [
      'ConfirmBindingGate',
      'ClosureEvidenceGate',
      'artifactSha256',
      'ReReviewRuntimeFirstGate'
    ]],
    ['skills/dev-plan-review/SKILL.md', [
      'ClosureEvidenceGate',
      'ControlPlaneContractFirstGate',
      'ContractMatrix',
      'runtimeOwners'
    ]],
    ['skills/audit-common/SKILL.md', [
      'ReReviewRuntimeFirstGate',
      'ClosureEvidenceGate'
    ]]
  ]

  const requiredIndexAnchors = [
    ['instructions.md', ['ClosureEvidenceGate', 'ControlPlaneContractFirstGate', 'ConfirmBindingGate']]
  ]

  const requiredRuntimeAnchors = [
    ['scripts/lib/skill-deploy-filter.js', ['graySkillIds', 'shouldDeploySkillRelative', 'createSkillDeployFileFilter']],
    ['scripts/lib/cp-digest.js', ['parseCpSessions', 'verifyArtifactDigest', 'sha256File']],
    ['mcp/memory-server.js', ['artifactSha256', 'artifactPath']],
    ['hooks/_runtime/lifecycle.cjs', ['verifyArtifactDigest', 'parseCpSessions']],
    ['index.js', ['buildDeploymentDescriptors', 'deployment-descriptors']],
    ['scripts/lib/deployment-descriptors.js', ['createSkillDeployFileFilter', 'isSkillsSource']],
    ['scripts/lib/cli-install-commands.js', ['createSkillDeployFileFilter', 'skillDeployFilter']]
  ]

  function assertAnchors(pairs, label) {
    for (const [relative, needles] of pairs) {
      const full = path.join(ROOT, relative)
      if (!fs.existsSync(full)) {
        err(`[V100] missing ${label}: ${relative}`)
        continue
      }
      const content = read(full)
      for (const needle of needles) {
        if (!content.includes(needle)) err(`[V100] ${relative} missing anchor: ${needle}`)
      }
    }
  }

  function checkHomologousFilterLogic() {
    const filter = require('./skill-deploy-filter')
    const gray = filter.graySkillIdSet(ROOT)
    if (gray.size < 1) {
      err('[V100] expected at least one gray skill in plugin.json for deploy filter coverage')
      return
    }
    for (const id of gray) {
      if (filter.shouldDeploySkillRelative(`${id}/SKILL.md`, gray)) {
        err(`[V100] gray skill must not deploy: ${id}`)
      }
      if (!filter.shouldDeploySkillRelative('cp-gate/SKILL.md', gray)) {
        err('[V100] active skill cp-gate must remain deployable')
      }
    }
  }

  function checkCpDigestLogic() {
    const digest = require('./cp-digest')
    const sample = [
      '| CP | 状态 | artifactPath | version | sha256 | sourceMessage | confirmedAt |',
      '| CP1 | ✅ | `01-需求确认.md` | v1 | `ABC` | ok | 10:00 |',
      '| CP2 | stale | `02.md` | v1 | `DEF` | — | — |'
    ].join('\n')
    const parsed = digest.parseCpSessions(sample)
    if (!parsed.CP1 || !parsed.CP1.confirmed) err('[V100] parseCpSessions must treat ✅ as confirmed')
    if (!parsed.CP2 || parsed.CP2.confirmed) err('[V100] parseCpSessions must treat stale as not confirmed')
  }

  function checkV100() {
    assertAnchors(requiredSkillAnchors, 'skill')
    assertAnchors(requiredIndexAnchors, 'index')
    assertAnchors(requiredRuntimeAnchors, 'runtime')
    checkHomologousFilterLogic()
    checkCpDigestLogic()
    console.log('[V100] closure evidence / contract-first / deploy filter controls checked')
  }

  return { checkV100 }
}

module.exports = {
  buildClosureEvidenceControlChecks
}
