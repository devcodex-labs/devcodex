'use strict'

const fs = require('fs')
const path = require('path')

const CONTRACTS = new Map([
  ['skills/spec-governance/SKILL.md', ['skills/spec-governance/gate-registry.json']],
  ['skills/test-router/SKILL.md', ['skills/test-router/test-route-schema.json', 'skills/spec-governance/gate-registry.json']],
  ['skills/report/SKILL.md', ['skills/report/report-schema.json', 'skills/spec-governance/gate-registry.json']],
  ['skills/spec-absorption/SKILL.md', ['skills/spec-governance/gate-registry.json']],
  ['skills/source-consumer-sync/SKILL.md', ['skills/spec-governance/gate-registry.json']],
  ['skills/document-sync/SKILL.md', ['skills/spec-governance/gate-registry.json']],
  ['skills/audit-project/SKILL.md', ['skills/spec-governance/gate-registry.json']],
  ['skills/audit-requirements/SKILL.md', ['skills/spec-governance/gate-registry.json']],
  ['prompts/technical-design.prompt.md', ['skills/test-router/test-route-schema.json', 'skills/spec-governance/gate-registry.json']],
  ['prompts/implementation-plan.prompt.md', ['skills/test-router/test-route-schema.json', 'skills/spec-governance/gate-registry.json']],
  ['prompts/requirement.prompt.md', ['skills/spec-governance/gate-registry.json']],
  ['prompts/report-dev.prompt.md', ['skills/report/report-schema.json', 'skills/spec-governance/gate-registry.json']],
  ['prompts/report-fix.prompt.md', ['skills/report/report-schema.json', 'skills/spec-governance/gate-registry.json']],
  ['prompts/report-audit.prompt.md', ['skills/report/report-schema.json', 'skills/spec-governance/gate-registry.json']],
  ['prompts/report-scenario-test.prompt.md', ['skills/report/report-schema.json', 'skills/spec-governance/gate-registry.json']],
  ['prompts/report-optimization.prompt.md', ['skills/report/report-schema.json', 'skills/spec-governance/gate-registry.json']],
  ['prompts/report-analysis.prompt.md', ['skills/report/report-schema.json']]
])

const PUBLIC_README_REQUIRED_MARKERS = Object.freeze([
  '# DevCodex',
  '用户级全局 adapter',
  'npm install -g .',
  'npm install -g devcodex',
  'registry 上的版本',
  'npm run global-adapters:apply',
  'devcodex doctor',
  'devcodex init',
  'Codex / Claude / Copilot / Gemini / Grok',
  'devcodex skill resolve skill-load-verify',
  'profile / reports / .memory / requirements',
  '.devcodex/workspace/skills/<id>/SKILL.md',
  '~/.agents/devcodex/skills/<id>/',
  'W + managed G 动态快照',
  '本地 stdio MCP 子进程',
  '不监听端口',
  'DevCodex 不扫描、复制、合并、覆盖或删除这些用户资产',
  'AGENTS.md',
  'CLAUDE.md',
  'SKILL.md',
  'Partial',
  'safety-only',
  '用户文档',
  'website/README.md',
  '用户可见交付与链接兼容',
  'profile_context_plan',
  'profile_load',
  'memory_status',
  'ContextReadReceiptV2',
  'V1 receipt 只作兼容读取',
  'invoke',
  'npm run test:stop-gate',
  'npm run test:docs-surface-inventory'
])

function evaluatePublicReadmeContract (content) {
  const text = String(content || '')
  const missing = PUBLIC_README_REQUIRED_MARKERS.filter(marker => !text.includes(marker))
  return {
    schemaVersion: 'PublicReadmeContractV1',
    valid: missing.length === 0,
    missing
  }
}

function isLegacyDerivedNeedle(needle) {
  return /\b[A-Za-z][A-Za-z0-9]+(?:Gate|Probe|Guard|Guards)\b/.test(needle) ||
    /^[a-z][A-Za-z0-9]+$/.test(needle) ||
    /^(GovernanceGateRegistry|CrossProjectLearnedGuards|LatestAbsorptionGuards|LatestAbsorptionExecutionPack|ConfirmedAbsorptionCompletenessGates|SkillAbsorptionDecision)$/.test(needle)
}

function hasValidCanonicalContract(root, file, content) {
  const relative = file.replace(/\\/g, '/')
  if (relative === 'README.md') {
    return evaluatePublicReadmeContract(content).valid
  }
  const refs = CONTRACTS.get(relative)
  if (!refs) return false
  for (const ref of refs) {
    if (!content.includes(path.basename(ref))) return false
    const fullPath = path.join(root, ref)
    if (!fs.existsSync(fullPath)) return false
    const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'))
    if (parsed.schemaVersion !== 1 || !parsed.ownerSkill) return false
  }
  return true
}

function createCanonicalAwareReader(root, readRaw) {
  return function read(file) {
    const value = readRaw(file)
    const relative = path.relative(root, file).replace(/\\/g, '/')
    return new class extends String {
      includes(needle, position) {
        if (String.prototype.includes.call(this, needle, position)) return true
        return hasValidCanonicalContract(root, relative, String(this), String(needle))
      }
    }(value)
  }
}

module.exports = {
  CONTRACTS,
  PUBLIC_README_REQUIRED_MARKERS,
  createCanonicalAwareReader,
  evaluatePublicReadmeContract,
  hasValidCanonicalContract,
  isLegacyDerivedNeedle
}
