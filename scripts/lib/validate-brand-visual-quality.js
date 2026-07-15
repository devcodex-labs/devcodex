'use strict'

const REQUIRED_ACCEPTANCE_FIELDS = [
  'masterLineage',
  'themeGeometryParity',
  'microOpticalVariant',
  'monoMaster',
  'visualEvidencePack',
  'humanVisualConclusion'
]

function classifyBrandVisualEvidence(sample) {
  const value = sample || {}
  if (value.blockerDetected && !value.blockerResetComplete) return 'blocked'
  if (!REQUIRED_ACCEPTANCE_FIELDS.every(field => value[field] === true)) return 'verification-pending'
  if (value.reviewerVerdict === 'rejected') return 'rejected'
  return value.reviewerVerdict === 'accepted' ? 'accepted' : 'verification-pending'
}

function buildBrandVisualQualityChecks(ctx) {
  const { ROOT, ACTIVE_DEVCODEX_ROOT, fs, path, read, err, console } = ctx

  function checkFile(relative, needles) {
    const file = path.join(ROOT, relative)
    if (!fs.existsSync(file)) {
      err(`[V97] missing required artifact: ${relative}`)
      return
    }
    const content = read(file)
    for (const needle of needles) {
      if (!content.includes(needle)) err(`[V97] ${relative} missing: ${needle}`)
    }
  }

  function expect(sample, expected, label) {
    const actual = classifyBrandVisualEvidence(sample)
    if (actual !== expected) err(`[V97] ${label}: expected ${expected}, got ${actual}`)
  }

  function checkV97() {
    const complete = Object.fromEntries(REQUIRED_ACCEPTANCE_FIELDS.map(field => [field, true]))
    expect({ ...complete, reviewerVerdict: 'accepted' }, 'accepted', 'complete positive evidence')
    expect({ ...complete, monoMaster: false, reviewerVerdict: 'accepted' }, 'verification-pending', 'missing mono evidence')
    expect({ ...complete, blockerDetected: true, blockerResetComplete: false, reviewerVerdict: 'accepted' }, 'blocked', 'unreset blocker')
    expect({ ...complete, reviewerVerdict: 'rejected' }, 'rejected', 'human rejection')

    const required = [
      ['skills/brand-visual-quality/SKILL.md', ['BrandVisualQualityGate', 'MasterLineageGate', 'ThemeGeometryParityGate', 'MicroOpticalVariantGate', 'MonoMasterGate', 'VisualEvidencePackGate', 'VisualBlockerResetGate', 'gray']],
      ['skills/brand-visual-quality/agents/openai.yaml', ['$brand-visual-quality', 'Brand Visual Quality']],
      ['skills/design-system-architecture/SKILL.md', ['brand-visual-quality', 'ThemeGeometryParityGate']],
      ['skills/rework-prevention-engineering/SKILL.md', ['brand-visual-quality', 'VisualBlockerResetRecord']],
      ['skills/load-profile/SKILL.md', ['ProfileReleaseTruthAuthorityMatrixGate']],
      ['skills/profile-bootstrap/SKILL.md', ['ProfileReleaseTruthAuthorityMatrixGate']],
      ['skills/spec-governance/SKILL.md', ['RuntimeStateTransitionProjectionGate', 'CONFLICTING_CURRENT_STATE']],
      ['skills/dev-plan-review/SKILL.md', ['BrandVisualQualityGate']],
      ['skills/review-checklist/SKILL.md', ['VisualEvidencePack']],
      ['skills/test-router/SKILL.md', ['brandVisualQuality']],
      ['skills/report/report-schema.json', ['BrandVisualQuality']],
      ['prompts/technical-design.prompt.md', ['brand-visual-quality']],
      ['prompts/implementation-plan.prompt.md', ['brand-visual-quality']],
      ['prompts/report-dev.prompt.md', ['BrandVisualQuality']],
      ['README.md', ['77 个', 'brand-visual-quality']],
      ['website/docs/index.md', ['77 个 Skills', 'brand-visual-quality']],
      ['website/docs/intro/index.md', ['77 个按需触发', 'brand-visual-quality']],
      ['changelogs/unreleased.md', ['BrandVisualQualityGate', 'ProfileReleaseTruthAuthorityMatrixGate', 'RuntimeStateTransitionProjectionGate']]
    ]
    for (const [file, needles] of required) checkFile(file, needles)

    const plugin = JSON.parse(read(path.join(ROOT, 'plugin.json')))
    const registration = plugin.skills.find(item => item.id === 'brand-visual-quality')
    if (!registration || registration.lifecycleState !== 'gray') err('[V97] brand visual Skill must be registered as gray')

    const portfolio = JSON.parse(read(path.join(ROOT, 'skills/portfolio.json')))
    const portfolioSkill = portfolio.skills.find(item => item.id === 'brand-visual-quality')
    if (portfolio.summary.skillCount !== 77 || portfolio.summary.activeSkillCount !== 74 || portfolio.summary.graySkillCount !== 3) {
      err('[V97] portfolio must be 77 skills = 74 active + 3 gray')
    }
    if (!portfolioSkill || portfolioSkill.lifecycleState !== 'gray' || !portfolioSkill.conflicts.includes('design-system-architecture')) {
      err('[V97] brand visual gray lifecycle or design-system conflict declaration missing')
    }

    const profileRoot = path.join(ACTIVE_DEVCODEX_ROOT, 'profile')
    for (const [file, needle] of [
      ['01-项目信息.md', '77-Skill'],
      ['04-测试规范.md', 'V97'],
      ['06-功能清单.md', 'brand-visual-quality'],
      ['07-用户文档与契约规范.md', '品牌视觉质量契约']
    ]) {
      const target = path.join(profileRoot, file)
      if (!fs.existsSync(target) || !fs.readFileSync(target, 'utf8').includes(needle)) {
        err(`[V97] active Profile missing ${needle}: ${file}`)
      }
    }
    console.log('[V97] brand visual quality, runtime transition and Profile release authority controls checked')
  }

  return { checkV97 }
}

module.exports = {
  buildBrandVisualQualityChecks,
  classifyBrandVisualEvidence
}
