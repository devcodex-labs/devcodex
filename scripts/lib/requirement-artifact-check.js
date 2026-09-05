'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
  enumerateTaskArtifacts,
  readLayeredArtifactSlotRegistry
} = require('../../hooks/_runtime/artifact-slot-decision.cjs')
const {
  createArtifactTemplateBinding,
  qualifyArtifactFile,
  validateArtifactTemplateQualification
} = require('../../hooks/_runtime/artifact-template-contract.cjs')
const { verifyActualCandidateEvidenceReceipt } = require('./actual-candidate-evidence')

const RECENT_REQUIREMENT_ARTIFACT_DAYS = 2
const REQUIREMENT_FILES = [
  '00-需求概况.md',
  '00-需求变更概况.md',
  '01-需求确认.md',
  '01-产品需求.md',
  '01-需求变更确认.md',
  '01-需求概述.md',
  '02-技术方案.md',
  '04-实施计划.md',
  '05-实施进度.md'
]
const BUG_FILES = ['00-问题概况.md', '01-问题确认.md', '02-修复方案.md', '04-实施计划.md', '05-实施进度.md']
const SIMPLE_TASK_FAST_PATH_MARKERS = ['SimpleTaskFastPath', '简单任务轻路径', 'N/A + skipReason']
const HISTORICAL_TEMPLATE_DISPOSITION_SCHEMA = 'HistoricalArtifactTemplateDispositionV1'
const HISTORICAL_TEMPLATE_DISPOSITION_PATH = '.memory/artifact-template-dispositions.json'
const HISTORICAL_TEMPLATE_DISPOSITIONS = new Set(['superseded-confirmed', 'abandoned-unconfirmed'])
const SHA256_RE = /^[a-f0-9]{64}$/i
const MAX_HISTORICAL_TEMPLATE_DISPOSITION_BYTES = 256 * 1024

function resolveConsumerArtifactRegistry(activeRoot, project, registry = null) {
  const resolvedRoot = path.resolve(activeRoot)
  const resolvedProject = String(project || path.basename(resolvedRoot)).trim()
  return {
    project: resolvedProject,
    registry: registry || readLayeredArtifactSlotRegistry({
      activeRoot: resolvedRoot,
      project: resolvedProject,
      fs
    })
  }
}

function artifactRegistryFailure(error) {
  return {
    checkedDirs: [],
    issues: [`artifact registry ${error?.code || 'ARTIFACT_SLOT_REGISTRY_INVALID'}`],
    registryErrorCode: error?.code || 'ARTIFACT_SLOT_REGISTRY_INVALID',
    mergedRegistryDigest: null,
    registrySlotCount: 0
  }
}

function hasText(filePath, needle) {
  return fs.readFileSync(filePath, 'utf8').includes(needle)
}

function hasAnyText(filePath, needles) {
  const text = fs.readFileSync(filePath, 'utf8')
  return needles.some(needle => text.includes(needle))
}

function hasRecentArtifact(dirPath, nowMs, recentDays, files) {
  const cutoff = nowMs - recentDays * 24 * 60 * 60 * 1000
  return files
    .map(name => path.join(dirPath, name))
    .filter(filePath => fs.existsSync(filePath))
    .some(filePath => fs.statSync(filePath).mtimeMs >= cutoff)
}

function inventoryFiles(inventory) {
  return [...new Set([
    ...inventory.artifacts.map(item => item.relativePath),
    ...inventory.unknownFormal
  ])]
}

function hasRecentInventoryArtifact(dirPath, inventory, nowMs, recentDays) {
  return hasRecentArtifact(dirPath, nowMs, recentDays, inventoryFiles(inventory))
}

function collectInventoryIssues(inventory, relDir) {
  const issues = []
  for (const relative of inventory.unknownFormal) issues.push(`${relDir}/${relative} unknown formal artifact slot`)
  for (const conflict of inventory.conflicts) {
    issues.push(`${relDir} conflicting truth sources for ${conflict.alternativeGroup}: ${conflict.paths.join(', ')}`)
  }
  if (inventory.overflow) issues.push(`${relDir} artifact inventory exceeded bounded scan; split or reduce derived artifacts`)
  const classes = new Set(inventory.artifacts.map(item => item.slot.artifactClass))
  if ((classes.has('cp2') || classes.has('cp3-plan') || classes.has('progress')) && !classes.has('overview') && !classes.has('cp1')) {
    issues.push(`${relDir} missing intake truth before CP2/CP3 artifacts`)
  }
  return issues
}

function hasFormalTemplateQualificationClaim(filePath) {
  const head = fs.readFileSync(filePath, 'utf8').slice(0, 8192)
  return /(?:templateBindingStatus:\s*qualified-v1|ArtifactTemplateBindingV1)/i.test(head)
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function slash(value) {
  return String(value || '').replace(/\\/g, '/')
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return !relative.startsWith('..') && !path.isAbsolute(relative)
}

function candidateVersionFromPath(relativePath) {
  const match = path.posix.basename(slash(relativePath)).match(/-v(\d+(?:\.\d+)*)\.md$/i)
  return match ? `v${match[1]}-candidate` : null
}

function compareCandidateVersions(left, right) {
  const parse = value => {
    const match = String(value || '').match(/^v(\d+(?:\.\d+)*)-candidate$/i)
    return match ? match[1].split('.').map(Number) : null
  }
  const a = parse(left)
  const b = parse(right)
  if (!a || !b) return null
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0)
    if (difference) return difference
  }
  return 0
}

function normalizedTaskRelativePath(taskRoot, value) {
  const raw = String(value || '')
  if (!raw || raw !== slash(raw) || path.isAbsolute(raw) || raw.startsWith('/') || raw.split('/').some(part => !part || part === '.' || part === '..')) {
    return null
  }
  const absolute = path.resolve(taskRoot, ...raw.split('/'))
  if (!isInside(taskRoot, absolute)) return null
  const relative = slash(path.relative(taskRoot, absolute))
  return relative === raw ? relative : null
}

function currentConfirmedCp3Head(dirPath) {
  const sessionsPath = path.join(dirPath, '.memory', 'sessions.md')
  let text
  try {
    const stats = fs.statSync(sessionsPath)
    if (!stats.isFile() || stats.size > 8 * 1024 * 1024) return null
    text = fs.readFileSync(sessionsPath, 'utf8')
  } catch {
    return null
  }
  let current = null
  for (const line of text.split(/\r?\n/u)) {
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim())
    if (cells[0] !== 'CP3' || !String(cells[1] || '').includes('✅') || /stale/i.test(String(cells[1] || ''))) continue
    const artifactCell = String(cells[2] || '')
    const projected = /^\[(.*)\]\((?:<([^>]+)>|([^)]+))\)$/u.exec(artifactCell)
    const declared = projected ? (projected[2] || projected[3] || projected[1]) : artifactCell.replace(/^`|`$/gu, '')
    if (!declared || path.isAbsolute(declared)) continue
    for (const base of [path.dirname(sessionsPath), dirPath]) {
      const absolute = path.resolve(base, declared)
      if (!isInside(dirPath, absolute) || !fs.existsSync(absolute)) continue
      current = slash(path.relative(dirPath, absolute))
      break
    }
  }
  return current
}

function validateHistoricalTemplateDispositions(dirPath, inventory) {
  const sidecarPath = path.join(dirPath, HISTORICAL_TEMPLATE_DISPOSITION_PATH)
  if (!fs.existsSync(sidecarPath)) return { exists: false, valid: true, entries: new Map(), issues: [], currentHead: currentConfirmedCp3Head(dirPath) }
  const issues = []
  let value = null
  try {
    const stats = fs.statSync(sidecarPath)
    if (!stats.isFile()) issues.push('sidecar-not-file')
    else if (stats.size > MAX_HISTORICAL_TEMPLATE_DISPOSITION_BYTES) issues.push('sidecar-too-large')
    else value = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'))
  } catch (error) {
    issues.push(`sidecar-invalid-json:${error.message}`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) issues.push('sidecar-invalid-shape')
  else {
    if (value.schemaVersion !== HISTORICAL_TEMPLATE_DISPOSITION_SCHEMA) issues.push('sidecar-schema-invalid')
    if (!Array.isArray(value.entries)) issues.push('sidecar-entries-invalid')
    if (!Object.keys(value).every(field => ['schemaVersion', 'entries'].includes(field))) issues.push('sidecar-fields-invalid')
  }
  const currentHead = currentConfirmedCp3Head(dirPath)
  const artifacts = new Map(inventory.artifacts.map(artifact => [artifact.relativePath, artifact]))
  const entries = new Map()
  for (const [index, entry] of (Array.isArray(value?.entries) ? value.entries : []).entries()) {
    const prefix = `entry-${index + 1}`
    const fields = ['relativePath', 'artifactSha256', 'candidateVersion', 'disposition', 'replacementPath', 'replacementSha256', 'reasonCode']
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        !fields.every(field => Object.prototype.hasOwnProperty.call(entry, field)) ||
        !Object.keys(entry).every(field => fields.includes(field))) {
      issues.push(`${prefix}:fields-invalid`)
      continue
    }
    const relativePath = normalizedTaskRelativePath(dirPath, entry.relativePath)
    const replacementPath = normalizedTaskRelativePath(dirPath, entry.replacementPath)
    if (!relativePath) issues.push(`${prefix}:relative-path-invalid`)
    if (!replacementPath) issues.push(`${prefix}:replacement-path-invalid`)
    if (!SHA256_RE.test(String(entry.artifactSha256 || ''))) issues.push(`${prefix}:artifact-sha256-invalid`)
    if (!SHA256_RE.test(String(entry.replacementSha256 || ''))) issues.push(`${prefix}:replacement-sha256-invalid`)
    if (!HISTORICAL_TEMPLATE_DISPOSITIONS.has(entry.disposition)) issues.push(`${prefix}:disposition-invalid`)
    if (!/^[a-z0-9][a-z0-9-]{2,95}$/.test(String(entry.reasonCode || ''))) issues.push(`${prefix}:reason-code-invalid`)
    if (!relativePath || !replacementPath) continue
    if (entries.has(relativePath)) issues.push(`${prefix}:duplicate-relative-path`)
    if (relativePath === replacementPath) issues.push(`${prefix}:replacement-self-reference`)
    if (!currentHead) issues.push(`${prefix}:current-head-unavailable`)
    else if (relativePath === currentHead) issues.push(`${prefix}:current-head-cannot-be-disposed`)
    const original = artifacts.get(relativePath)
    const replacement = artifacts.get(replacementPath)
    if (!original || original.matchType !== 'versioned-candidate') issues.push(`${prefix}:original-artifact-invalid`)
    if (!replacement || replacement.matchType !== 'versioned-candidate') issues.push(`${prefix}:replacement-artifact-invalid`)
    if (original && replacement && original.slot?.slotId !== replacement.slot?.slotId) issues.push(`${prefix}:replacement-slot-mismatch`)
    const expectedVersion = candidateVersionFromPath(relativePath)
    const replacementVersion = candidateVersionFromPath(replacementPath)
    if (!expectedVersion || entry.candidateVersion !== expectedVersion) issues.push(`${prefix}:candidate-version-mismatch`)
    const versionOrder = compareCandidateVersions(replacementVersion, expectedVersion)
    if (!replacementVersion || versionOrder === null || versionOrder <= 0) issues.push(`${prefix}:replacement-not-strict-successor`)
    const originalPath = path.join(dirPath, relativePath)
    const replacementFile = path.join(dirPath, replacementPath)
    if (!fs.existsSync(originalPath) || sha256File(originalPath) !== String(entry.artifactSha256).toLowerCase()) issues.push(`${prefix}:artifact-digest-mismatch`)
    if (!fs.existsSync(replacementFile) || sha256File(replacementFile) !== String(entry.replacementSha256).toLowerCase()) issues.push(`${prefix}:replacement-digest-mismatch`)
    if (original && fs.existsSync(originalPath) && checkArtifactTemplateFile({ slot: original.slot, filePath: originalPath }).passed) {
      issues.push(`${prefix}:original-already-qualified`)
    }
    if (!replacement || !fs.existsSync(replacementFile)) {
      issues.push(`${prefix}:replacement-qualification-unavailable`)
    } else {
      const qualification = checkArtifactTemplateFile({ slot: replacement.slot, filePath: replacementFile })
      if (!qualification.passed) issues.push(`${prefix}:replacement-not-qualified`)
    }
    entries.set(relativePath, entry)
  }
  return { exists: true, valid: issues.length === 0, entries, issues: [...new Set(issues)], currentHead }
}

function inferArtifactWorkflowIntent(filePath) {
  const head = fs.readFileSync(filePath, 'utf8').slice(0, 8192)
  const match = head.match(/(?:^|\n)(?:>\s*)?(?:\*\*)?(?:类型|type)(?:\*\*)?\s*[：:]\s*`?([a-z][a-z-]*)/i)
  const value = String(match?.[1] || '').trim().toLowerCase()
  return new Set([
    'analyze', 'analysis', 'audit', 'dev', 'fix', 'self-fix', 'optimization',
    'optimize', 'scenario-test', 'scenario-tests', 'chat', 'resume', 'other'
  ]).has(value) ? value : null
}

function checkArtifactTemplateFile({ slot, filePath, intent = null }) {
  try {
    const effectiveIntent = intent || inferArtifactWorkflowIntent(filePath) || 'dev'
    const binding = createArtifactTemplateBinding({
      slot,
      target: filePath,
      intent: effectiveIntent,
      bindingMode: 'runtime-prewrite'
    })
    if (!binding) return { passed: true, issues: [], qualification: null, binding: null }
    const qualification = qualifyArtifactFile(binding, filePath, { slotId: slot.slotId })
    const validation = validateArtifactTemplateQualification(qualification, binding)
    const issues = []
    if (!validation.valid) issues.push(...validation.errors)
    if (qualification.status !== 'qualified' || qualification.readbackVerified !== true) issues.push(...qualification.errorCodes)
    return { passed: issues.length === 0, issues: [...new Set(issues)], qualification, binding }
  } catch (error) {
    return {
      passed: false,
      issues: [...new Set([error?.code || 'ARTIFACT_TEMPLATE_VALIDATOR_UNAVAILABLE', ...(error?.details?.errors || [])])],
      qualification: null,
      binding: null
    }
  }
}

function collectBoundTemplateIssues(dirPath, inventory, relDir) {
  const issues = []
  const disposition = validateHistoricalTemplateDispositions(dirPath, inventory)
  for (const issue of disposition.issues) issues.push(`${relDir}/${HISTORICAL_TEMPLATE_DISPOSITION_PATH} ${issue}`)
  for (const artifact of inventory.artifacts) {
    if (!artifact.slot?.templateRef || !['canonical', 'versioned-candidate'].includes(artifact.matchType)) continue
    const filePath = path.join(dirPath, artifact.relativePath)
    if (!fs.existsSync(filePath)) continue
    const isCurrentHead = disposition.currentHead === artifact.relativePath
    const dispositionEntry = disposition.entries.get(artifact.relativePath)
    const mustValidate = artifact.slot.slotId === 'plan-review-pr1' || isCurrentHead ||
      Boolean(dispositionEntry) || hasFormalTemplateQualificationClaim(filePath)
    if (!mustValidate) continue // historical/unbound artifacts remain read-only; runtime receipts govern new writes
    const result = checkArtifactTemplateFile({ slot: artifact.slot, filePath })
    if (result.passed) continue
    if (artifact.matchType === 'versioned-candidate' && !isCurrentHead && disposition.valid && dispositionEntry) continue
    for (const issue of result.issues) issues.push(`${relDir}/${artifact.relativePath} template qualification ${issue}`)
  }
  return issues
}

function checkPlanAndProgressFiles(dirPath, relDir, issues) {
  const planFile = path.join(dirPath, '04-实施计划.md')
  const progressFile = path.join(dirPath, '05-实施进度.md')

  if (fs.existsSync(planFile)) {
    if (!hasText(planFile, '## 目录导航')) {
      issues.push(`${relDir}/04-实施计划.md missing "## 目录导航"`)
    }
    if (!hasText(planFile, '计划模式')) {
      issues.push(`${relDir}/04-实施计划.md missing plan mode`)
    }
    if (!hasAnyText(planFile, ['验证路线', '独立验证方式', '验证方式'])) {
      issues.push(`${relDir}/04-实施计划.md missing validation section`)
    }
    if (!hasAnyText(planFile, ['回滚摘要', '回滚触发', '回滚方案'])) {
      issues.push(`${relDir}/04-实施计划.md missing rollback section`)
    }
  }

  if (fs.existsSync(progressFile)) {
    const requiredNeedles = [
      '当前轮次',
      '当前 CP',
      '当前批次',
      '## 目录导航',
      '进度总览',
      '支撑产物状态',
      '本轮验证结果',
      '阻塞与恢复',
      '下一步',
      '变更记录'
    ]
    for (const needle of requiredNeedles) {
      if (!hasText(progressFile, needle)) {
        issues.push(`${relDir}/05-实施进度.md missing "${needle}"`)
      }
    }
  }
}

function checkRequirementDir(dirPath) {
  const issues = []
  const relDir = path.basename(dirPath)

  for (const fileName of ['00-需求概况.md', '00-需求变更概况.md']) {
    const filePath = path.join(dirPath, fileName)
    if (fs.existsSync(filePath) && !hasText(filePath, '## 目录导航')) {
      issues.push(`${relDir}/${fileName} missing "## 目录导航"`)
    }
  }

  for (const fileName of ['01-需求确认.md', '01-产品需求.md', '01-需求变更确认.md', '01-需求概述.md']) {
    const filePath = path.join(dirPath, fileName)
    if (fs.existsSync(filePath) && !hasText(filePath, '## 目录导航')) {
      issues.push(`${relDir}/${fileName} missing "## 目录导航"`)
    }
  }

  checkPlanAndProgressFiles(dirPath, relDir, issues)

  return issues
}

function checkBugDir(dirPath) {
  const issues = []
  const relDir = path.basename(dirPath)

  for (const fileName of ['00-问题概况.md', '01-问题确认.md']) {
    const filePath = path.join(dirPath, fileName)
    if (fs.existsSync(filePath) && !hasText(filePath, '## 目录导航')) {
      issues.push(`${relDir}/${fileName} missing "## 目录导航"`)
    }
  }

  checkPlanAndProgressFiles(dirPath, relDir, issues)

  return issues
}

function hasSimpleTaskFastPathMarker(dirPath) {
  const sessionsFile = path.join(dirPath, '.memory', 'sessions.md')
  if (!fs.existsSync(sessionsFile)) return false
  return hasAnyText(sessionsFile, SIMPLE_TASK_FAST_PATH_MARKERS)
}

function checkActualCandidateEvidence({
  candidatePath,
  requestedPhase,
  sourceHead,
  dirtyScopeDigest,
  receipt,
  expectedReceiptDigest
}) {
  const issues = []
  if (!receipt || typeof receipt !== 'object') {
    return {
      passed: false,
      issues: [`${candidatePath || 'candidate'} missing ActualCandidateEvidenceReceiptV1`],
      verification: null
    }
  }
  if (typeof candidatePath !== 'string' || !path.isAbsolute(candidatePath)) {
    issues.push('actual candidate path must be absolute')
  }
  if (!['CP1', 'CP2', 'CP3', 'ECR'].includes(String(requestedPhase || '').toUpperCase())) {
    issues.push(`${candidatePath || 'candidate'} actual candidate requested phase missing or invalid`)
  }
  if (!/^[a-f0-9]{64}$/i.test(String(expectedReceiptDigest || ''))) {
    issues.push(`${candidatePath || 'candidate'} exact actual candidate receipt digest required`)
  }
  if (candidatePath && path.resolve(receipt.candidatePath || '') !== path.resolve(candidatePath)) {
    issues.push(`${candidatePath} actual candidate receipt path mismatch`)
  }
  const verification = verifyActualCandidateEvidenceReceipt(receipt, {
    requestedPhase,
    sourceHead,
    dirtyScopeDigest,
    expectedReceiptDigest
  })
  for (const item of verification.issues) {
    issues.push(`${candidatePath || receipt.candidatePath || 'candidate'} actual candidate evidence ${item.code}`)
  }
  return { passed: issues.length === 0, issues, verification }
}

function collectRecentRequirementArtifactIssues({
  activeRoot,
  project,
  registry,
  recentDays = RECENT_REQUIREMENT_ARTIFACT_DAYS,
  nowMs = Date.now()
}) {
  const requirementsRoot = path.join(activeRoot, 'requirements')
  const checkedDirs = []
  const issues = []

  if (!fs.existsSync(requirementsRoot)) {
    return { checkedDirs, issues }
  }

  let registryContext
  try {
    registryContext = resolveConsumerArtifactRegistry(activeRoot, project, registry)
  } catch (error) {
    return artifactRegistryFailure(error)
  }

  for (const entry of fs.readdirSync(requirementsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dirPath = path.join(requirementsRoot, entry.name)
    if (hasSimpleTaskFastPathMarker(dirPath)) continue
    const inventory = enumerateTaskArtifacts({
      taskRoot: dirPath,
      taskKind: 'requirements',
      fs,
      activeRoot,
      project: registryContext.project,
      registry: registryContext.registry
    })
    if (!inventory.artifacts.length && !inventory.unknownFormal.length) continue
    if (!hasRecentInventoryArtifact(dirPath, inventory, nowMs, recentDays)) continue
    checkedDirs.push(entry.name)
    issues.push(...collectInventoryIssues(inventory, entry.name))
    issues.push(...checkRequirementDir(dirPath))
    issues.push(...collectBoundTemplateIssues(dirPath, inventory, entry.name))
  }

  return {
    checkedDirs,
    issues,
    registryErrorCode: null,
    mergedRegistryDigest: registryContext.registry.mergedRegistryDigest,
    registrySlotCount: registryContext.registry.slots.length
  }
}

function collectRecentBugArtifactIssues({
  activeRoot,
  project,
  registry,
  recentDays = RECENT_REQUIREMENT_ARTIFACT_DAYS,
  nowMs = Date.now()
}) {
  const bugsRoot = path.join(activeRoot, 'bugs')
  const checkedDirs = []
  const issues = []

  if (!fs.existsSync(bugsRoot)) {
    return { checkedDirs, issues }
  }

  let registryContext
  try {
    registryContext = resolveConsumerArtifactRegistry(activeRoot, project, registry)
  } catch (error) {
    return artifactRegistryFailure(error)
  }

  for (const entry of fs.readdirSync(bugsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dirPath = path.join(bugsRoot, entry.name)
    if (hasSimpleTaskFastPathMarker(dirPath)) continue
    const inventory = enumerateTaskArtifacts({
      taskRoot: dirPath,
      taskKind: 'bugs',
      fs,
      activeRoot,
      project: registryContext.project,
      registry: registryContext.registry
    })
    if (!inventory.artifacts.length && !inventory.unknownFormal.length) continue
    if (!hasRecentInventoryArtifact(dirPath, inventory, nowMs, recentDays)) continue
    checkedDirs.push(entry.name)
    issues.push(...collectInventoryIssues(inventory, entry.name))
    issues.push(...checkBugDir(dirPath))
    issues.push(...collectBoundTemplateIssues(dirPath, inventory, entry.name))
  }

  return {
    checkedDirs,
    issues,
    registryErrorCode: null,
    mergedRegistryDigest: registryContext.registry.mergedRegistryDigest,
    registrySlotCount: registryContext.registry.slots.length
  }
}

module.exports = {
  RECENT_REQUIREMENT_ARTIFACT_DAYS,
  BUG_FILES,
  REQUIREMENT_FILES,
  SIMPLE_TASK_FAST_PATH_MARKERS,
  inferArtifactWorkflowIntent,
  HISTORICAL_TEMPLATE_DISPOSITION_PATH,
  HISTORICAL_TEMPLATE_DISPOSITION_SCHEMA,
  checkArtifactTemplateFile,
  checkBugDir,
  checkRequirementDir,
  checkActualCandidateEvidence,
  collectInventoryIssues,
  validateHistoricalTemplateDispositions,
  hasSimpleTaskFastPathMarker,
  collectRecentBugArtifactIssues,
  collectRecentRequirementArtifactIssues
}
