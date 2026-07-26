'use strict'

function buildVisibleOutputControlChecks(ctx) {
  const { ROOT, fs, path, read, err, console } = ctx

  function requireFile(relative) {
    if (!fs.existsSync(path.join(ROOT, relative))) err(`[V102] missing visible/review artifact: ${relative}`)
  }

  function requireAnchors(relative, anchors) {
    requireFile(relative)
    if (!fs.existsSync(path.join(ROOT, relative))) return
    const content = read(path.join(ROOT, relative))
    for (const anchor of anchors) {
      if (!content.includes(anchor)) err(`[V102] ${relative} missing anchor: ${anchor}`)
    }
  }

  function checkV102() {
    const required = [
      'skills/user-visible-output-contract/SKILL.md',
      'skills/user-visible-output-contract/visible-output-contract.schema.json',
      'hooks/_runtime/visible-output-contract.cjs',
      'hooks/_runtime/review-execution-contract.cjs',
      'scripts/test-visible-output-contract.js',
      'scripts/test-review-execution-contract.js'
    ]
    required.forEach(requireFile)
    requireAnchors('instructions.md', ['user-visible-output-contract', 'ArtifactDeliveryManifestV1', 'ReviewExecutionPlanV1'])
    requireAnchors('skills/review-checklist/SKILL.md', ['ReviewExecutionPlanV1', 'ReviewEvidenceReceiptV1', 'ReviewStateSnapshotV1'])
    requireAnchors('skills/report/SKILL.md', ['ArtifactDeliveryManifestV1', 'UserFacingArtifactSetV1', 'FinalValidationSummaryV1'])
    requireAnchors('skills/compliance/SKILL.md', ['FinalValidationSummaryV1', 'DevModeCompletionCheckDetailGate'])
    requireAnchors('skills/user-visible-output-contract/SKILL.md', ['ArtifactAnchorProjectionV1', 'ArtifactAnchorProjectionGate', 'FinalValidationSummaryGate', 'classifyFinalValidationSummarySample', 'classifyDialogueNarrativeSample', 'Dialogue-Primary'])
    requireAnchors('prompts/precheck-status.prompt.md', ['DevCodexVisibleEnvelopeV1', 'PC0~PC7'])
    requireAnchors('hooks/_runtime/visible-output-contract.cjs', ['ArtifactAnchorV1', 'projectArtifactAnchorsFromManifest', 'analyzeFinalValidationSummarySample', 'classifyFinalValidationSummarySample', 'classifyDialogueNarrativeSample', 'hasReadableNarrativeSnippet'])
    requireAnchors('hooks/_runtime/lifecycle-visible-reply.cjs', [
      'finalValidationSummaryStatus',
      'DevModeCompletionCheckDetailGate',
      'dialogueNarrativeStatus',
      'analysisDeliveryStatus',
      'analysis-link-only-thin',
      'Dialogue-Primary'
    ])

    try {
      JSON.parse(read(path.join(ROOT, 'skills/user-visible-output-contract/visible-output-contract.schema.json')))
    } catch (error) {
      err(`[V102] visible output schema invalid: ${error.message}`)
    }

    const pkg = JSON.parse(read(path.join(ROOT, 'package.json')))
    for (const script of ['test:visible-output', 'test:review-execution']) {
      if (!pkg.scripts?.[script]) err(`[V102] package script missing: ${script}`)
    }
    const plugin = JSON.parse(read(path.join(ROOT, 'plugin.json')))
    if (!plugin.skills?.some(skill => skill.id === 'user-visible-output-contract')) {
      err('[V102] plugin registry missing user-visible-output-contract')
    }
    const portfolio = JSON.parse(read(path.join(ROOT, 'skills/portfolio.json')))
    if (!portfolio.skills?.some(skill => skill.id === 'user-visible-output-contract')) {
      err('[V102] Skill portfolio missing user-visible-output-contract')
    }

    const manifest = JSON.parse(read(path.join(ROOT, 'scripts/validation-manifest.json')))
    for (const nodeId of ['visible-output-contract', 'review-execution-contract']) {
      if (!manifest.nodes?.some(node => node.id === nodeId)) err(`[V102] validation node missing: ${nodeId}`)
      for (const route of ['fast', 'full', 'profile-deploy', 'package-release']) {
        if (!manifest.routes?.[route]?.nodes?.includes(nodeId)) err(`[V102] ${route} route omits ${nodeId}`)
      }
    }
    console.log('[V102] visible output / review execution contract and consumer closure checked')
  }

  return { checkV102 }
}

module.exports = { buildVisibleOutputControlChecks }
