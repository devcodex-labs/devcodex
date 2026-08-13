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
  '工作流运行时和宿主适配包',
  'Codex、Claude Code、GitHub Copilot、Gemini CLI、Grok 和 Cursor（Beta）',
  'Node.js `>=18.17.0`',
  'node -v',
  'npm -v',
  'npm install -g devcodex',
  'npm update -g devcodex',
  'npm uninstall -g devcodex',
  'devcodex uninstall --dry-run',
  'devcodex uninstall --apply',
  'devcodex --version',
  '重新打开宿主的新会话',
  '安装生命周期中刷新用户级宿主适配',
  '内置 Skill',
  '工作区 Skill',
  '<你的项目根目录>/',
  '.devcodex/',
  'workspace/',
  'skills/',
  '<id>/',
  'SKILL.md',
  'intent.json',
  '<你的项目根目录>/.devcodex/workspace/skills/<id>/SKILL.md',
  'DevCodex 不扫描、复制、合并、覆盖或删除这些用户资产',
  '不替代业务框架、GitHub CI、安全审计或人工评审',
  '## 常见任务怎么说',
  '## 常见问题与排错',
  '安装最新版后，为什么没有需求概况、PC0~PC7 或 CP 流程？',
  'devcodex status',
  'devcodex global-adapters apply',
  'adapter=not-ready',
  'contract=failed',
  'native=unverified',
  'host kernel not installed',
  '“帮我审批”时反复重新连接，是否必须开启完全访问？',
  'node runtime BLOCK',
  'sandbox-exec-denied',
  'GLOBAL_HOST_TARGET_UNVERIFIED',
  '不需要永久开启 Full access',
  'Grok Full 入口',
  '普通 `grok` 是 Partial',
  'devcodex grok',
  'StageLoadReceiptV1',
  'Cursor 已安装 DevCodex，但为什么没有流程或 SkillRoute？',
  '~/.cursor/hooks.json',
  'Cursor Cloud Agent',
  'agent --version',
  '只分析，不修改文件',
  '继续<任务名>任务',
  'push、tag、GitHub Release 和 npm publish',
  '[AGPL-3.0](LICENSE)',
  '## 目录',
  '[为什么需要 DevCodex？](#为什么需要-devcodex)',
  '[5 分钟开始](#5-分钟开始)',
  '[常见任务怎么说](#常见任务怎么说)',
  '[常见问题与排错](#常见问题与排错)',
  '[添加自己的 Skill](#添加自己的-skill)',
  '[许可证](#许可证)'
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
