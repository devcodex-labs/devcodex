'use strict'

const fs = require('fs')
const path = require('path')
const { buildBundle } = require('./control-content-source')
const { resolveControlAsset } = require('./control-content-delivery')

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
    const fullPath = resolveControlAsset(root, ref)
    if (!fs.existsSync(fullPath)) return false
    const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'))
    if (parsed.schemaVersion !== 1 || !parsed.ownerSkill) return false
  }
  return true
}

function hasMaintainerWebsiteIgnorePolicy(root) {
  try {
    const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8')
    return ignore.includes('website/*') && ignore.includes('!website/README.md')
  } catch {
    return false
  }
}

function isOptionalMaintainerWebsiteAsset(root, relative) {
  const normalized = String(relative || '').replace(/\\/g, '/')
  return normalized.startsWith('website/') &&
    normalized !== 'website/README.md' &&
    hasMaintainerWebsiteIgnorePolicy(root)
}

function isOptionalMaintainerWebsiteNegativeNeedle(needle) {
  const text = String(needle || '')
  return [
    'light-api',
    'frontend-api',
    'Claude MCP/合规漂移修复',
    '.claude/.github/',
    '父链 `.claude/.github/`',
    '无父链 .claude/.github/',
    'parent/source-root deployment',
    'audit（6 子类型）',
    'audit（6 目标类型）'
  ].includes(text)
}

function createCanonicalAwareReader(root, readRaw, existsRaw = file => fs.existsSync(file)) {
  let deliveryFiles = null
  let maintainerWebsiteIgnorePolicy
  function hasMaintainerWebsiteIgnorePolicyForReader() {
    if (maintainerWebsiteIgnorePolicy != null) return maintainerWebsiteIgnorePolicy
    try {
      const ignore = readRaw(path.join(root, '.gitignore'))
      maintainerWebsiteIgnorePolicy = String(ignore).includes('website/*') && String(ignore).includes('!website/README.md')
    } catch {
      maintainerWebsiteIgnorePolicy = false
    }
    return maintainerWebsiteIgnorePolicy
  }
  function isOptionalMaintainerWebsiteAssetForReader(relative) {
    const normalized = String(relative || '').replace(/\\/g, '/')
    return normalized.startsWith('website/') &&
      normalized !== 'website/README.md' &&
      hasMaintainerWebsiteIgnorePolicyForReader()
  }
  function readCanonicalDelivery(relative) {
    if (!/^(?:instructions\.md|(?:instructions|prompts)\/.+|skills\/.+)$/.test(relative)) {
      return null
    }
    if (!existsRaw(path.join(root, 'content', 'manifest.json'))) return null
    const canonicalAsset = resolveControlAsset(root, relative)
    if (canonicalAsset !== path.join(root, relative) && existsRaw(canonicalAsset) &&
        !/^(?:instructions\.md|(?:instructions|prompts)\/.+\.md|skills\/[^/]+\/SKILL\.md)$/.test(relative)) {
      return readRaw(canonicalAsset)
    }
    if (!deliveryFiles) {
      deliveryFiles = new Map(
        buildBundle(root).files.map(file => [file.relative.replace(/\\/g, '/'), file.content])
      )
    }
    return deliveryFiles.has(relative) ? deliveryFiles.get(relative) : null
  }

  function read(file) {
    const relative = path.relative(root, file).replace(/\\/g, '/')
    let value
    let optionalMaintainerWebsite = false
    try {
      value = readRaw(file)
    } catch (error) {
      const canonical = error?.code === 'ENOENT' ? readCanonicalDelivery(relative) : null
      if (canonical == null) {
        if (!isOptionalMaintainerWebsiteAssetForReader(relative)) throw error
        optionalMaintainerWebsite = true
        value = ''
      } else {
        value = canonical
      }
    }
    return new class extends String {
      includes(needle, position) {
        if (optionalMaintainerWebsite) {
          return !isOptionalMaintainerWebsiteNegativeNeedle(needle)
        }
        if (String.prototype.includes.call(this, needle, position)) return true
        return hasValidCanonicalContract(root, relative, String(this), String(needle))
      }
    }(value)
  }

  read.exists = function exists(file) {
    if (existsRaw(file)) return true
    const relative = path.relative(root, file).replace(/\\/g, '/')
    if (isOptionalMaintainerWebsiteAssetForReader(relative)) return true
    return readCanonicalDelivery(relative) != null
  }

  return read
}

module.exports = {
  CONTRACTS,
  PUBLIC_README_REQUIRED_MARKERS,
  createCanonicalAwareReader,
  evaluatePublicReadmeContract,
  hasValidCanonicalContract,
  isOptionalMaintainerWebsiteAsset,
  isLegacyDerivedNeedle
}
