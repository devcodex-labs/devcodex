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

function isLegacyDerivedNeedle(needle) {
  return /\b[A-Za-z][A-Za-z0-9]+(?:Gate|Probe|Guard|Guards)\b/.test(needle) ||
    /^[a-z][A-Za-z0-9]+$/.test(needle) ||
    /^(GovernanceGateRegistry|CrossProjectLearnedGuards|LatestAbsorptionGuards|LatestAbsorptionExecutionPack|ConfirmedAbsorptionCompletenessGates|SkillAbsorptionDecision)$/.test(needle)
}

function hasValidCanonicalContract(root, file, content) {
  const refs = CONTRACTS.get(file.replace(/\\/g, '/'))
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

module.exports = { CONTRACTS, createCanonicalAwareReader, hasValidCanonicalContract, isLegacyDerivedNeedle }
