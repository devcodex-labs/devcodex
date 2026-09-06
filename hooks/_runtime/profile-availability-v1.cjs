'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const RECEIPT_FILE = '.devcodex-profile-receipt.json'

function stableDigest(value) {
  const normalize = input => {
    if (Array.isArray(input)) return input.map(normalize)
    if (!input || typeof input !== 'object') return input
    return Object.fromEntries(Object.keys(input).sort().map(key => [key, normalize(input[key])]))
  }
  return crypto.createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex')
}

function readReceipt(profileRoot) {
  const file = path.join(profileRoot, RECEIPT_FILE)
  if (!fs.existsSync(file)) return { file, status: 'absent', value: null }
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (value?.schemaVersion !== 'ProfileMaterializationReceiptV1') {
      return { file, status: 'invalid', value: null }
    }
    const expectedDigest = stableDigest({ ...value, receiptDigest: undefined })
    if (value.receiptDigest !== expectedDigest) {
      return { file, status: 'invalid', value: null }
    }
    if (!value.manifest || !Array.isArray(value.manifest.files)) {
      return { file, status: 'invalid', value: null }
    }
    const contentMatches = value.manifest.files.every(expected => {
      try {
        const content = fs.readFileSync(path.join(profileRoot, expected.file))
        const observedDigest = crypto.createHash('sha256').update(content).digest('hex')
        return content.length === expected.bytes && observedDigest === expected.sha256
      } catch {
        return false
      }
    })
    if (!contentMatches) return { file, status: 'stale', value }
    return { file, status: 'loaded', value }
  } catch {
    return { file, status: 'invalid', value: null }
  }
}

function isExplicitProfileRequest(prompt) {
  const text = String(prompt || '')
  return /(?:生成|创建|初始化|补建|修复|查看|检查).{0,24}(?:项目\s*)?Profile(?![A-Za-z0-9_-])|(?:generate|create|initialize|bootstrap|repair|inspect).{0,24}(?:project\s+)?profile\b/i.test(text)
}

function lifecycleForProfile(profileRoot) {
  const exists = fs.existsSync(profileRoot)
  if (!exists) return { status: 'missing', receipt: readReceipt(profileRoot) }
  const readme = fs.existsSync(path.join(profileRoot, 'README.md'))
  const config = fs.existsSync(path.join(profileRoot, 'config.json'))
  const receipt = readReceipt(profileRoot)
  if (!readme || !config || ['invalid', 'stale'].includes(receipt.status)) {
    return { status: 'partial-invalid', receipt, readme, config }
  }
  const recorded = String(receipt.value?.lifecycleState || '')
  return {
    status: recorded === 'reviewed' ? 'reviewed' : 'generated-draft',
    receipt,
    readme,
    config,
    legacyUnclassified: receipt.status === 'absent'
  }
}

function renderNotice(view, languageContext) {
  const language = String(languageContext?.responseLanguage || languageContext?.primaryLanguage || 'en')
  const zh = language.toLowerCase().startsWith('zh')
  if (view.lifecycleState === 'missing') {
    return zh
      ? `项目已绑定为 ${view.projectIdentity}，但项目 Profile 尚未生成；当前继续使用 workspace 基线，项目专属事实保持未验证，任务不会因此中断。你可以直接说“为当前项目生成 Profile”，系统会先预览再创建草稿：${view.profileRoot}`
      : `Project ${view.projectIdentity} is bound, but its Profile is missing. The workspace baseline remains available, project-specific facts stay unverified, and the task continues. Say “generate the Profile for this project” to preview and create a draft at ${view.profileRoot}.`
  }
  if (view.lifecycleState === 'partial-invalid') {
    return zh
      ? `项目 ${view.projectIdentity} 的 Profile 不完整或 receipt 无效；任务继续使用 workspace 基线，项目事实保持未验证。请先检查或修复：${view.profileRoot}`
      : `Project ${view.projectIdentity} has an incomplete or invalid Profile. The task continues on the workspace baseline while project facts remain unverified. Inspect or repair ${view.profileRoot}.`
  }
  return ''
}

function inspectProfileAvailability(input = {}) {
  const binding = input.binding || {}
  const projectIdentity = String(binding.projectNamespace || '').trim()
  const activeRoot = String(binding.activeRoot || '').trim()
  if (!projectIdentity || !activeRoot || projectIdentity === 'workspace') {
    return {
      schemaVersion: 'ProfileAvailabilityV1',
      bindingState: 'workspace-bound',
      lifecycleState: 'not-applicable',
      shouldDisplay: false,
      notice: ''
    }
  }

  const profileRoot = path.join(activeRoot, 'profile')
  const lifecycle = lifecycleForProfile(profileRoot)
  const languageDigest = stableDigest({
    primaryLanguage: input.languageContext?.primaryLanguage || '',
    responseLanguage: input.languageContext?.responseLanguage || ''
  })
  const profileStateDigest = stableDigest({
    lifecycleState: lifecycle.status,
    receiptDigest: lifecycle.receipt?.value?.receiptDigest || null,
    receiptStatus: lifecycle.receipt?.status || 'absent'
  })
  const dedupeKey = stableDigest({
    taskId: String(input.taskId || ''),
    projectIdentity,
    profileStateDigest,
    languageContextDigest: languageDigest
  })
  const explicitRequest = isExplicitProfileRequest(input.prompt)
  const displayable = lifecycle.status === 'missing' || lifecycle.status === 'partial-invalid'
  const shouldDisplay = displayable && (explicitRequest || input.priorDedupeKey !== dedupeKey)
  const view = {
    schemaVersion: 'ProfileAvailabilityV1',
    bindingState: 'project-bound',
    projectIdentity,
    physicalRoot: binding.physicalRoot || null,
    activeRoot,
    profileRoot,
    lifecycleState: lifecycle.status,
    fallback: lifecycle.status === 'missing' || lifecycle.status === 'partial-invalid'
      ? 'workspace-base/project-facts-unverified'
      : 'workspace-base+project-overlay',
    profileStateDigest,
    languageContextDigest: languageDigest,
    dedupeKey,
    shouldDisplay,
    explicitRequest,
    legacyUnclassified: lifecycle.legacyUnclassified === true,
    receiptFile: lifecycle.receipt?.file || path.join(profileRoot, RECEIPT_FILE)
  }
  return { ...view, notice: shouldDisplay ? renderNotice(view, input.languageContext) : '' }
}

module.exports = {
  PROFILE_MATERIALIZATION_RECEIPT_FILE: RECEIPT_FILE,
  inspectProfileAvailability,
  isExplicitProfileRequest,
  lifecycleForProfile,
  readProfileMaterializationReceipt: readReceipt,
  stableProfileAvailabilityDigest: stableDigest
}
