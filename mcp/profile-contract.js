'use strict'

const PROFILE_TIERS = new Set(['profile-lite', 'profile-standard', 'profile-closed-loop'])
const PROFILE_BASE_FILES = ['README.md', '01-项目信息.md', '02-架构约束.md', '03-代码风格.md']
const PROFILE_STANDARD_FILES = [...PROFILE_BASE_FILES, '04-测试规范.md', '05-发布规范.md', '06-功能清单.md']
const PROFILE_CLOSED_LOOP_FILES = [...PROFILE_STANDARD_FILES, '07-用户文档与契约规范.md']
const PROFILE_DEFAULT_FILES = [...PROFILE_CLOSED_LOOP_FILES, 'config.json', 'config.local.json']
const PROFILE_RELEASE_FILES = ['05-发布规范.md', '05-交付发布规范.md']

function normalizeProfileTier(value, fallback = 'profile-lite') {
  const tier = String(value || '').trim().toLowerCase()
  if (PROFILE_TIERS.has(tier)) return tier
  if (fallback && PROFILE_TIERS.has(fallback)) return fallback
  throw new Error(`invalid profile tier: ${value}`)
}

function extractProfileTierDeclarations(contents) {
  const text = String(contents || '')
  return [...text.matchAll(/Profile\s*(?:档位|tier)[^\r\n]*?\b(profile-(?:lite|standard|closed-loop))\b/gi)]
    .map(match => match[1].toLowerCase())
}

function detectProfileTier(contents, fallback = 'profile-lite') {
  const text = String(contents || '')
  const declarations = extractProfileTierDeclarations(text)
  const declared = [...new Set(declarations)]
  if (declared.length > 1) throw new Error(`multiple profile tiers declared: ${declared.join(', ')}`)
  if (declared.length === 1) return normalizeProfileTier(declared[0], fallback)

  const matches = [...text.matchAll(/\bprofile-(?:lite|standard|closed-loop)\b/g)].map(match => match[0])
  const unique = [...new Set(matches)]
  if (unique.length > 1) throw new Error(`multiple profile tiers declared: ${unique.join(', ')}`)
  return normalizeProfileTier(unique[0], fallback)
}

function filesForProfileTier(tier, { includeConfig = true } = {}) {
  const normalized = normalizeProfileTier(tier)
  const files = normalized === 'profile-closed-loop'
    ? PROFILE_CLOSED_LOOP_FILES
    : normalized === 'profile-standard' ? PROFILE_STANDARD_FILES : PROFILE_BASE_FILES
  return includeConfig ? [...files, 'config.json'] : [...files]
}

function hasFeatureInventorySource(files, corpus) {
  return files.has('06-功能清单.md') ||
    /FeatureInventoryProfileGate|Feature Inventory|feature inventory|功能清单|能力清单/i.test(String(corpus || ''))
}

function hasProfileLifecycle(corpus) {
  const text = String(corpus || '')
  return /stable baseline|稳定基线/i.test(text) &&
    /living document|活文档/i.test(text) &&
    /conditional|required|conditional-required|条件必需|条件\s*[\/]\s*本地|本地/i.test(text)
}

function inspectProfileContract(tier, availableFiles, corpus = '') {
  const normalized = normalizeProfileTier(tier)
  const files = availableFiles instanceof Set ? availableFiles : new Set(availableFiles || [])
  const checks = PROFILE_BASE_FILES.map(file => ({ key: file, pass: files.has(file) }))

  if (normalized !== 'profile-lite') {
    checks.push({ key: '04-测试规范.md', pass: files.has('04-测试规范.md') })
    checks.push({ key: '05-release', pass: PROFILE_RELEASE_FILES.some(file => files.has(file)) })
    checks.push({ key: 'feature-inventory', pass: hasFeatureInventorySource(files, corpus) })
  }
  if (normalized === 'profile-closed-loop') {
    checks.push({ key: '07-用户文档与契约规范.md', pass: files.has('07-用户文档与契约规范.md') })
    checks.push({ key: 'profile-lifecycle', pass: hasProfileLifecycle(corpus) })
  }

  return {
    tier: normalized,
    present: checks.filter(check => check.pass).length,
    total: checks.length,
    complete: checks.every(check => check.pass),
    missing: checks.filter(check => !check.pass).map(check => check.key)
  }
}

module.exports = {
  PROFILE_TIERS,
  PROFILE_BASE_FILES,
  PROFILE_STANDARD_FILES,
  PROFILE_CLOSED_LOOP_FILES,
  PROFILE_DEFAULT_FILES,
  PROFILE_RELEASE_FILES,
  normalizeProfileTier,
  extractProfileTierDeclarations,
  detectProfileTier,
  filesForProfileTier,
  hasFeatureInventorySource,
  hasProfileLifecycle,
  inspectProfileContract
}
