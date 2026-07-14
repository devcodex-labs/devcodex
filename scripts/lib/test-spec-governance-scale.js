'use strict'

function runSpecGovernanceScaleSuite(ctx) {
  const {
    ROOT, fs, path, failures, SOURCE_PROJECT_NAME, read, mustInclude,
    mustNotInclude, collectChangelogContents, mustIncludeInChangelogs
  } = ctx

  const genericDistributedFiles = [
    'instructions.md',
    'instructions/00-safety.instructions.md',
    'instructions/12-audit.instructions.md',
    'skills/spec-governance/SKILL.md',
    'data/README.md',
    'data/templates/violations.md',
    'data/templates/pending-fixes.md',
    'data/templates/process-improvements.md',
    'data/templates/pending-issues.md',
    'data/templates/gap-registry.md'
  ]

  for (const file of genericDistributedFiles) {
    mustNotInclude(file, SOURCE_PROJECT_NAME, 'generic distributed governance assets must not hard-code the source project name')
  }

  mustNotInclude(
    'prompts/product-requirement.prompt.md',
    '## §10 AI / 研发缺口检查',
    'product requirement template must remain product-only'
  )

  const checkV91 = 'ProjectArtifactScaleRoutingGate'
  for (const [file, needle] of [
    ['scripts/lib/validate-governance-expert.js', 'checkV91'],
    ['scripts/lib/validate-governance-expert.js', 'classifyArtifactScaleSample'],
    ['scripts/validate.js', 'runProbeRegistry'],
    ['skills/skill-gap-analysis/SKILL.md', checkV91],
    ['skills/skill-lifecycle-governance/SKILL.md', 'SkillPortfolioLifecycleGate'],
    ['skills/distributed-systems-architecture/SKILL.md', 'DistributedSystemsArchitectureGate'],
    ['skills/performance-engineering/SKILL.md', 'PerformanceEngineeringGate'],
    ['skills/privacy-compliance-architecture/SKILL.md', 'PrivacyComplianceArchitectureGate'],
    ['skills/ai-evaluation-engineering/SKILL.md', 'AiEvaluationEngineeringGate']
  ]) mustInclude(file, needle)

  const plugin = JSON.parse(read('plugin.json'))
  for (const [id, file] of [
    ['spec-absorption', 'skills/spec-absorption/SKILL.md'],
    ['spec-governance', 'skills/spec-governance/SKILL.md'],
    ['source-consumer-sync', 'skills/source-consumer-sync/SKILL.md'],
    ['host-contract-verification', 'skills/host-contract-verification/SKILL.md'],
    ['audit-release', 'skills/audit-release/SKILL.md'],
    ['analyze-default', 'skills/analyze-default/SKILL.md']
  ]) {
    if (!plugin.skills.some(skill => skill.id === id && skill.file === file)) {
      failures.push(`plugin.json missing ${id} skill entry`)
    }
  }

  for (const [id, file] of [
    ['common-profile-loading', 'instructions/01a-profile-loading.instructions.md'],
    ['common-record-router', 'instructions/01b-record-router.instructions.md'],
    ['common-intent-expansion', 'instructions/01c-intent-expansion.instructions.md']
  ]) {
    if (!plugin.instructions.some(instruction => instruction.id === id && instruction.file === file)) {
      failures.push(`plugin.json missing ${id} instruction entry`)
    }
  }
}

module.exports = { runSpecGovernanceScaleSuite }
