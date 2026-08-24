'use strict'

const fs = require('fs')
const path = require('path')
const { buildBundle } = require('./control-content-source')
const { resolveControlAsset } = require('./control-content-delivery')
const { isNarrativeMarkdownPath } = require('./narrative-markdown-policy')

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

function hasValidCanonicalContract(root, file, content) {
  const relative = file.replace(/\\/g, '/')
  if (isRepositoryNarrativeMarkdownPath(relative)) return false
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

function isRepositoryNarrativeMarkdownPath(relative) {
  const normalized = String(relative || '').replace(/\\/g, '/')
  return Boolean(normalized) && normalized !== '..' && !normalized.startsWith('../') &&
    !path.isAbsolute(normalized) && isNarrativeMarkdownPath(normalized)
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
    if (isRepositoryNarrativeMarkdownPath(relative)) {
      const error = new Error(`JavaScript validation must not read narrative Markdown: ${relative}`)
      error.code = 'NARRATIVE_MARKDOWN_JS_READ_FORBIDDEN'
      throw error
    }
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
    const relative = path.relative(root, file).replace(/\\/g, '/')
    if (isRepositoryNarrativeMarkdownPath(relative)) {
      const error = new Error(`JavaScript validation must not inspect narrative Markdown: ${relative}`)
      error.code = 'NARRATIVE_MARKDOWN_JS_READ_FORBIDDEN'
      throw error
    }
    if (existsRaw(file)) return true
    if (isOptionalMaintainerWebsiteAssetForReader(relative)) return true
    return readCanonicalDelivery(relative) != null
  }

  return read
}

module.exports = {
  CONTRACTS,
  createCanonicalAwareReader,
  hasValidCanonicalContract,
  isOptionalMaintainerWebsiteAsset
}
