'use strict'

const fs = require('fs')
const path = require('path')

const { sha256, stableStringify } = require('./content-identity.cjs')

const BINDING_SCHEMA = 'ArtifactTemplateBindingV1'
const BINDING_PROJECTION_SCHEMA = 'ArtifactTemplateBindingProjectionV1'
const CONTRACT_SCHEMA = 'ArtifactTemplateSemanticContractV1'
const QUALIFICATION_SCHEMA = 'ArtifactTemplateQualificationV1'
const DIGEST_RE = /^[a-f0-9]{64}$/
const MAX_TEMPLATE_BYTES = 2 * 1024 * 1024
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024
const MAX_SEMANTICS = 64
const SAFE_TEMPLATE_REF_RE = /^(?:content\/)?prompts\/[A-Za-z0-9._{}-]+\.prompt\.md$/
const OPTIONAL_HEADING_RE = /(?:条件|按需|触发时|命中时|有内容时|完整实施计划重点|incident\s*类型)/i
const REPORT_TEMPLATE_BY_INTENT = Object.freeze({
  analyze: 'report-analysis',
  analysis: 'report-analysis',
  audit: 'report-audit',
  dev: 'report-dev',
  fix: 'report-fix',
  'self-fix': 'report-fix',
  optimization: 'report-optimization',
  optimize: 'report-optimization',
  'scenario-test': 'report-scenario-test',
  'scenario-tests': 'report-scenario-test',
  chat: 'report-analysis',
  resume: 'report-analysis',
  other: 'report-analysis'
})

class ArtifactTemplateContractError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'ArtifactTemplateContractError'
    this.code = code
    this.details = details
  }
}

function digest(value) {
  return sha256(Buffer.from(stableStringify(value), 'utf8'))
}

function slash(value) {
  return String(value || '').replace(/\\/g, '/')
}

function normalizeTarget(value) {
  const text = String(value || '')
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[a-z]:[\\/]/i.test(text)) return text
  const normalized = path.normalize(path.resolve(text))
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function comparableStatValue(value) {
  return typeof value === 'bigint' || (typeof value === 'number' && Number.isFinite(value))
}

function sameFileIdentity(left, right) {
  return ['dev', 'ino'].every(field =>
    !comparableStatValue(left?.[field]) || !comparableStatValue(right?.[field]) || left[field] === right[field]
  )
}

function sameStableFileSnapshot(left, right) {
  if (!left?.isFile?.() || !right?.isFile?.() || left?.isSymbolicLink?.() || right?.isSymbolicLink?.()) return false
  return sameFileIdentity(left, right) &&
    ['size', 'mtimeMs', 'ctimeMs'].every(field =>
      !comparableStatValue(left?.[field]) || !comparableStatValue(right?.[field]) || left[field] === right[field]
    )
}

function safeTemplateRef(value) {
  const ref = slash(value).replace(/^\.\//, '')
  return SAFE_TEMPLATE_REF_RE.test(ref) && !ref.includes('..')
}

function parseFrontmatter(content) {
  const text = String(content || '')
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return {}
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const end = lines.indexOf('---', 1)
  if (end < 0) return {}
  const result = {}
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$/)
    if (match) result[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  return result
}

function splitMetadataList(value) {
  return String(value || '')
    .split(/\s*[|,]\s*/)
    .map(item => item.trim())
    .filter(Boolean)
}

function stripOptionalSuffix(value) {
  return String(value || '')
    .replace(/[（(][^）)]*(?:条件|按需|触发时|命中时|重点|incident)[^）)]*[）)]/gi, '')
    .trim()
}

function semanticSlug(value) {
  const dynamicNormalized = stripOptionalSuffix(value)
    .replace(/^会话\s+(?:#?\d+|NN)\b.*$/i, '会话')
    .replace(/^confirmedAt$/i, '时间')
  return dynamicNormalized
    .normalize('NFKC')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/^\s*§?\s*\d+(?:\.\d+)*(?:\s*[-—:：.]\s*|\s+)/, '')
    .replace(/\b(?:NN|XX|N|X)\b/gi, ' ')
    .replace(/\d+/g, ' ')
    .replace(/[`*_~]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

function headingSemantic(value) {
  const slug = semanticSlug(value)
  return slug ? `heading:${slug}` : null
}

function columnSemantic(value) {
  const slug = semanticSlug(value)
  return slug ? `table-column:${slug}` : null
}

function parseMarkdownStructure(content, options = {}) {
  const lines = String(content || '').replace(/\r\n?/g, '\n').split('\n')
  const headings = []
  const tables = []
  let fenceId = 0
  let activeFence = null
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const fence = line.match(/^\s*(```+|~~~+)\s*([^\s]*)/)
    if (fence) {
      if (activeFence && activeFence.marker[0] === fence[1][0]) activeFence = null
      else if (!activeFence) activeFence = { id: ++fenceId, marker: fence[1], language: fence[2] || '' }
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (heading && (options.artifact !== true || !activeFence)) {
      headings.push({
        level: heading[1].length,
        text: heading[2].trim(),
        line: index,
        fenceId: activeFence?.id || null
      })
    }
    if ((options.artifact !== true || !activeFence) && /^\s*\|.*\|\s*$/.test(line) && index + 1 < lines.length &&
        /^\s*\|?(?:\s*:?-{2,}:?\s*\|)+\s*$/.test(lines[index + 1])) {
      const columns = line.trim().replace(/^\||\|$/g, '').split('|').map(item => item.trim()).filter(Boolean)
      if (columns.length) tables.push({ columns, line: index, fenceId: activeFence?.id || null })
    }
  }
  return { headings, tables, lineCount: lines.length }
}

function uniqueSemantics(values) {
  const result = []
  for (const value of values.filter(Boolean)) {
    if (!result.includes(value)) result.push(value)
  }
  return result.slice(0, MAX_SEMANTICS)
}

/**
 * Derive the formal artifact contract from the real Prompt bytes. Existing
 * templates own semantics through their output headings/table headers; an
 * optional frontmatter declaration can narrow that contract without creating
 * a second registry truth source.
 */
function deriveArtifactTemplateContract(content, input = {}) {
  const metadata = parseFrontmatter(content)
  const structure = parseMarkdownStructure(content)
  const templateHeading = structure.headings.find(item => item.level === 1)
  const outputHeading = structure.headings.find(item =>
    item.level === 1 && item.line > (templateHeading?.line ?? -1) && !/模板\s*$/i.test(item.text)
  )
  const explicitRequired = splitMetadataList(metadata.artifactRequiredHeadings)
  const explicitExtensions = splitMetadataList(metadata.artifactExtensionHeadings)
  let requiredSemanticIds = []
  let extensionPoints = []

  if (explicitRequired.length) {
    requiredSemanticIds = uniqueSemantics([
      metadata.artifactRequireTitle === 'false' ? null : 'document-title',
      ...explicitRequired.map(headingSemantic)
    ])
    extensionPoints = uniqueSemantics(explicitExtensions.map(headingSemantic))
  } else if (outputHeading) {
    const sameFenceHeadings = outputHeading.fenceId
      ? structure.headings.filter(item => item.fenceId === outputHeading.fenceId && item.line > outputHeading.line)
      : []
    const sameFenceTables = outputHeading.fenceId
      ? structure.tables.filter(item => item.fenceId === outputHeading.fenceId && item.line > outputHeading.line)
      : []
    const selfContainedFence = sameFenceHeadings.length > 0 || sameFenceTables.length > 0
    const candidates = selfContainedFence
      ? sameFenceHeadings.filter(item => item.level >= 2 && item.level <= 3)
      : structure.headings.filter(item => item.line > outputHeading.line && item.level === 2)
    const requiredEvents = [
      ...candidates.filter(item => !OPTIONAL_HEADING_RE.test(item.text)).map(item => ({ semanticId: headingSemantic(item.text), position: item.line })),
      ...sameFenceTables.flatMap(table => table.columns.map((column, index) => ({ semanticId: columnSemantic(column), position: table.line + index / 100 })))
    ].sort((left, right) => left.position - right.position)
    requiredSemanticIds = uniqueSemantics([
      'document-title',
      ...requiredEvents.map(item => item.semanticId)
    ])
    extensionPoints = uniqueSemantics(candidates.filter(item => OPTIONAL_HEADING_RE.test(item.text)).map(item => headingSemantic(item.text)))
  } else {
    const firstOutputFenceId = structure.headings.find(item => item.fenceId)?.fenceId || structure.tables.find(item => item.fenceId)?.fenceId
    const candidates = structure.headings.filter(item => item.fenceId === firstOutputFenceId && item.level >= 1 && item.level <= 3)
    const tables = structure.tables.filter(item => item.fenceId === firstOutputFenceId)
    const requiredEvents = [
      ...candidates.filter(item => item.level >= 2 && !OPTIONAL_HEADING_RE.test(item.text)).map(item => ({ semanticId: headingSemantic(item.text), position: item.line })),
      ...tables.flatMap(table => table.columns.map((column, index) => ({ semanticId: columnSemantic(column), position: table.line + index / 100 })))
    ].sort((left, right) => left.position - right.position)
    requiredSemanticIds = uniqueSemantics([
      candidates.some(item => item.level === 1) ? 'document-title' : null,
      ...requiredEvents.map(item => item.semanticId)
    ])
    extensionPoints = uniqueSemantics(candidates.filter(item => item.level >= 2 && OPTIONAL_HEADING_RE.test(item.text)).map(item => headingSemantic(item.text)))
  }

  if (requiredSemanticIds.length < 2) {
    throw new ArtifactTemplateContractError(
      'ARTIFACT_TEMPLATE_SEMANTICS_MISSING',
      'The template does not expose enough output semantics to qualify a formal artifact.',
      { templateRef: input.templateRef || null, requiredSemanticIds }
    )
  }
  const semantic = {
    schemaVersion: CONTRACT_SCHEMA,
    contractVersion: String(metadata.artifactTemplateContractVersion || '1'),
    templateId: String(metadata.artifactTemplateId || path.basename(String(input.templateRef || ''), '.prompt.md') || 'unknown-template'),
    templateRef: String(input.templateRef || ''),
    requiredSemanticIds,
    extensionPoints,
    extensionPolicy: metadata.artifactExtensionPolicy === 'closed' ? 'closed' : 'additive',
    requiredSemanticDigest: digest(requiredSemanticIds),
    extensionPointDigest: digest(extensionPoints)
  }
  return Object.freeze({ ...semantic, contractDigest: digest(semantic) })
}

function inferReportTemplate(target, intent) {
  const value = slash(target).toLowerCase()
  const explicit = Object.entries(REPORT_TEMPLATE_BY_INTENT).find(([key]) =>
    new RegExp(`/(?:${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})/`, 'i').test(value)
  )?.[1]
  if (explicit) return explicit
  const name = path.posix.basename(value)
  if (/(?:审查|复核|review|audit)/i.test(name)) return 'report-audit'
  if (/(?:分析|analysis)/i.test(name)) return 'report-analysis'
  if (/(?:修复|fix)/i.test(name)) return 'report-fix'
  if (/(?:优化|optimization)/i.test(name)) return 'report-optimization'
  if (/(?:场景|scenario|测试报告)/i.test(name)) return 'report-scenario-test'
  return REPORT_TEMPLATE_BY_INTENT[String(intent || '').toLowerCase()] || 'report-dev'
}

function inferMemoryTemplate(target) {
  const value = slash(target).toLowerCase()
  if (/\/summary(?:\.md)?(?:$|[/?#])/.test(value)) return 'agent-summary'
  if (/\/session(?:\/|$)|\/tasks\/\d{8}\.md$/.test(value)) return 'memory-session'
  if (/\/task(?:\/|$)|\/sessions(?:\.md)?$/.test(value)) return 'requirement-session'
  return null
}

function resolveArtifactTemplateRef(slot, input = {}) {
  if (!slot?.templateRef) return null
  let name = null
  if (slot.templateResolver === 'report-workflow') name = inferReportTemplate(input.target, input.intent)
  else if (slot.templateResolver === 'memory-kind') name = inferMemoryTemplate(input.target)
  else if (slot.templateResolver === 'cp1-artifact') {
    name = /01-产品需求(?:-v[^/]+)?\.md$/i.test(slash(input.target)) ? 'product-requirement' : 'requirement'
  } else if (slot.templateResolver === 'overview-artifact') {
    name = /00-需求变更概况\.md$/i.test(slash(input.target)) ? 'requirement-change-overview' : 'requirement-overview'
  }
  const resolved = name ? slot.templateRef.replace(/\{(?:workflow|memory-kind|cp1-kind)\}/g, name) : slot.templateRef
  if (!safeTemplateRef(resolved)) {
    throw new ArtifactTemplateContractError('ARTIFACT_TEMPLATE_REF_INVALID', 'The slot resolved an unsafe or invalid templateRef.', {
      slotId: slot.slotId,
      templateRef: resolved
    })
  }
  return resolved
}

function runtimeRoot(options = {}) {
  return path.resolve(options.runtimeRoot || path.join(__dirname, '..', '..'))
}

function readStableTemplate(refs, options = {}) {
  const fsImpl = options.fs || fs
  const root = runtimeRoot(options)
  const candidates = []
  for (const ref of refs.filter(Boolean)) {
    const normalized = slash(ref).replace(/^\.\//, '')
    if (!safeTemplateRef(normalized)) continue
    candidates.push(normalized)
    if (normalized.startsWith('content/')) candidates.push(normalized.slice('content/'.length))
  }
  for (const ref of [...new Set(candidates)]) {
    const target = path.resolve(root, ...ref.split('/'))
    if (target !== root && !target.startsWith(root + path.sep)) continue
    let stat
    try { stat = fsImpl.lstatSync(target) } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_TEMPLATE_BYTES) {
      throw new ArtifactTemplateContractError('ARTIFACT_TEMPLATE_SOURCE_INVALID', 'Template source must be one bounded ordinary file.', { ref, bytes: stat.size })
    }
    const descriptor = fsImpl.openSync(target, 'r')
    try {
      const before = fsImpl.fstatSync(descriptor)
      const content = fsImpl.readFileSync(descriptor, 'utf8')
      const after = fsImpl.fstatSync(descriptor)
      let finalStat = null
      try { finalStat = fsImpl.lstatSync(target) } catch (error) {}
      if (!finalStat || before.size > MAX_TEMPLATE_BYTES || finalStat.size > MAX_TEMPLATE_BYTES ||
          !sameStableFileSnapshot(stat, before) || !sameStableFileSnapshot(before, after) ||
          !sameStableFileSnapshot(after, finalStat) || Buffer.byteLength(content, 'utf8') !== after.size) {
        throw new ArtifactTemplateContractError('ARTIFACT_TEMPLATE_SOURCE_DRIFT', 'Template source changed during binding.', { ref })
      }
      return { content, templateDigest: sha256(Buffer.from(content, 'utf8')), resolvedTemplateRef: ref }
    } finally {
      fsImpl.closeSync(descriptor)
    }
  }
  throw new ArtifactTemplateContractError('ARTIFACT_TEMPLATE_SOURCE_MISSING', 'No current authoring or delivered template source could be read.', { refs })
}

function createArtifactTemplateBinding(input = {}, options = {}) {
  const slot = input.slot || {}
  const templateRef = resolveArtifactTemplateRef(slot, input)
  if (!templateRef) return null
  const source = readStableTemplate([templateRef, ...(slot.templateAliases || [])], options)
  const contract = deriveArtifactTemplateContract(source.content, { templateRef })
  const semantic = {
    schemaVersion: BINDING_SCHEMA,
    slotId: String(slot.slotId || ''),
    targetRef: String(input.target || ''),
    targetDigest: digest(normalizeTarget(input.target)),
    templateRef,
    resolvedTemplateRef: source.resolvedTemplateRef,
    templateDigest: source.templateDigest,
    templateId: contract.templateId,
    contractVersion: contract.contractVersion,
    contractDigest: contract.contractDigest,
    requiredSemanticIds: contract.requiredSemanticIds,
    extensionPoints: contract.extensionPoints,
    requiredSemanticDigest: contract.requiredSemanticDigest,
    extensionPointDigest: contract.extensionPointDigest,
    extensionPolicy: contract.extensionPolicy,
    producer: String(slot.templateProducer || slot.owner || ''),
    validator: String(slot.templateValidator || ''),
    bindingMode: input.bindingMode === 'producer-supplied' ? 'producer-supplied' : 'runtime-prewrite',
    boundAt: new Date(Number.isFinite(options.nowMs) ? options.nowMs : Date.now()).toISOString()
  }
  const binding = Object.freeze({ ...semantic, bindingDigest: digest(semantic) })
  const validation = validateArtifactTemplateBinding(binding)
  if (!validation.valid) {
    throw new ArtifactTemplateContractError('ARTIFACT_TEMPLATE_BINDING_INVALID', 'Generated template binding is invalid.', { errors: validation.errors })
  }
  return binding
}

function validateArtifactTemplateBinding(value) {
  const errors = []
  if (value?.schemaVersion !== BINDING_SCHEMA) errors.push('artifact-template-binding-schema-invalid')
  if (!String(value?.slotId || '').trim() || !String(value?.targetRef || '').trim() || !safeTemplateRef(value?.templateRef) || !safeTemplateRef(value?.resolvedTemplateRef)) {
    errors.push('artifact-template-binding-identity-invalid')
  }
  for (const field of ['targetDigest', 'templateDigest', 'contractDigest', 'requiredSemanticDigest', 'extensionPointDigest']) {
    if (!DIGEST_RE.test(String(value?.[field] || ''))) errors.push(`artifact-template-binding-${field}-invalid`)
  }
  for (const field of ['requiredSemanticIds', 'extensionPoints']) {
    if (!Array.isArray(value?.[field]) || value[field].length > MAX_SEMANTICS || new Set(value[field]).size !== value[field].length ||
        value[field].some(item => !/^(?:document-title|(?:heading|table-column):[\p{L}a-z0-9-]+)$/u.test(String(item)))) {
      errors.push(`artifact-template-binding-${field}-invalid`)
    }
  }
  if ((value?.requiredSemanticIds || []).length < 2 || digest(value?.requiredSemanticIds || []) !== value?.requiredSemanticDigest ||
      digest(value?.extensionPoints || []) !== value?.extensionPointDigest) errors.push('artifact-template-binding-semantics-invalid')
  if (!['additive', 'closed'].includes(value?.extensionPolicy) || !['producer-supplied', 'runtime-prewrite'].includes(value?.bindingMode) ||
      !String(value?.producer || '').trim() || value?.validator !== 'artifact-template-contract' || !Number.isFinite(Date.parse(String(value?.boundAt || '')))) {
    errors.push('artifact-template-binding-policy-invalid')
  }
  const { bindingDigest, ...semantic } = value || {}
  if (!DIGEST_RE.test(String(bindingDigest || '')) || digest(semantic) !== bindingDigest) errors.push('artifact-template-binding-digest-invalid')
  return { valid: errors.length === 0, errors: [...new Set(errors)] }
}

function projectArtifactTemplateBinding(value) {
  const validation = validateArtifactTemplateBinding(value)
  if (!validation.valid) throw new ArtifactTemplateContractError('ARTIFACT_TEMPLATE_BINDING_INVALID', 'Only a valid binding can be compacted.', { errors: validation.errors })
  const semantic = {
    schemaVersion: BINDING_PROJECTION_SCHEMA,
    slotId: value.slotId,
    targetRef: value.targetRef,
    targetDigest: value.targetDigest,
    templateRef: value.templateRef,
    resolvedTemplateRef: value.resolvedTemplateRef,
    templateDigest: value.templateDigest,
    templateId: value.templateId,
    contractVersion: value.contractVersion,
    contractDigest: value.contractDigest,
    requiredSemanticDigest: value.requiredSemanticDigest,
    extensionPointDigest: value.extensionPointDigest,
    extensionPolicy: value.extensionPolicy,
    producer: value.producer,
    validator: value.validator,
    bindingMode: value.bindingMode,
    boundAt: value.boundAt,
    bindingDigest: value.bindingDigest
  }
  return Object.freeze({ ...semantic, projectionDigest: digest(semantic) })
}

function validateArtifactTemplateBindingProjection(value) {
  const errors = []
  if (value?.schemaVersion !== BINDING_PROJECTION_SCHEMA) errors.push('artifact-template-projection-schema-invalid')
  if (!String(value?.slotId || '').trim() || !String(value?.targetRef || '').trim() || !safeTemplateRef(value?.templateRef) || !safeTemplateRef(value?.resolvedTemplateRef)) {
    errors.push('artifact-template-projection-identity-invalid')
  }
  for (const field of ['targetDigest', 'templateDigest', 'contractDigest', 'requiredSemanticDigest', 'extensionPointDigest', 'bindingDigest']) {
    if (!DIGEST_RE.test(String(value?.[field] || ''))) errors.push(`artifact-template-projection-${field}-invalid`)
  }
  if (!['additive', 'closed'].includes(value?.extensionPolicy) || !['producer-supplied', 'runtime-prewrite'].includes(value?.bindingMode) ||
      !String(value?.producer || '').trim() || value?.validator !== 'artifact-template-contract' || !Number.isFinite(Date.parse(String(value?.boundAt || '')))) {
    errors.push('artifact-template-projection-policy-invalid')
  }
  const { projectionDigest, ...semantic } = value || {}
  if (!DIGEST_RE.test(String(projectionDigest || '')) || digest(semantic) !== projectionDigest) errors.push('artifact-template-projection-digest-invalid')
  return { valid: errors.length === 0, errors: [...new Set(errors)] }
}

function rehydrateContract(binding, options = {}) {
  const projection = binding?.schemaVersion === BINDING_PROJECTION_SCHEMA
  const validation = projection
    ? validateArtifactTemplateBindingProjection(binding)
    : validateArtifactTemplateBinding(binding)
  if (!validation.valid) {
    throw new ArtifactTemplateContractError('ARTIFACT_TEMPLATE_BINDING_INVALID', 'Template qualification requires a valid binding.', { errors: validation.errors })
  }
  const source = readStableTemplate([binding.templateRef, binding.resolvedTemplateRef], options)
  const contract = deriveArtifactTemplateContract(source.content, { templateRef: binding.templateRef })
  const errors = []
  if (source.templateDigest !== binding.templateDigest) errors.push('artifact-template-stale-digest')
  if (contract.contractDigest !== binding.contractDigest || contract.requiredSemanticDigest !== binding.requiredSemanticDigest ||
      contract.extensionPointDigest !== binding.extensionPointDigest) errors.push('artifact-template-contract-drift')
  if (errors.length) {
    throw new ArtifactTemplateContractError('ARTIFACT_TEMPLATE_DRIFT', 'Template bytes or semantics changed after binding.', { errors })
  }
  return { source, contract }
}

function artifactSemanticPositions(content) {
  const structure = parseMarkdownStructure(content, { artifact: true })
  const positions = new Map()
  const add = (semanticId, position) => {
    if (!semanticId) return
    const list = positions.get(semanticId) || []
    list.push(position)
    positions.set(semanticId, list)
  }
  const title = structure.headings.find(item => item.level === 1)
  if (title) add('document-title', title.line)
  for (const heading of structure.headings.filter(item => item.level >= 2)) add(headingSemantic(heading.text), heading.line)
  for (const table of structure.tables) table.columns.forEach((column, index) => add(columnSemantic(column), table.line + index / 100))
  return { structure, positions }
}

function qualifyArtifactContent(binding, content, input = {}, options = {}) {
  const bytes = Buffer.byteLength(String(content || ''), 'utf8')
  const errorCodes = input.readbackErrorCode ? [String(input.readbackErrorCode)] : []
  let contract = null
  try {
    contract = rehydrateContract(binding, options).contract
  } catch (error) {
    errorCodes.push(...(error?.details?.errors || [error?.code || 'artifact-template-read-failed']))
  }
  if (bytes < 1 || bytes > MAX_ARTIFACT_BYTES) errorCodes.push('artifact-template-artifact-size-invalid')
  if (input.slotId && input.slotId !== binding?.slotId) errorCodes.push('artifact-template-wrong-slot')
  if (input.target && digest(normalizeTarget(input.target)) !== binding?.targetDigest) errorCodes.push('artifact-template-wrong-target')
  const semantics = artifactSemanticPositions(content)
  const required = contract?.requiredSemanticIds || []
  const missingSemanticIds = required.filter(item => !(semantics.positions.get(item) || []).length)
  for (const item of missingSemanticIds) errorCodes.push(`artifact-template-required-semantic-missing:${item}`)
  let cursor = -Infinity
  let orderValid = missingSemanticIds.length === 0
  for (const item of required) {
    const next = (semantics.positions.get(item) || []).find(position => position > cursor)
    if (next === undefined) {
      orderValid = false
      break
    }
    cursor = next
  }
  if (!orderValid && !missingSemanticIds.length) errorCodes.push('artifact-template-required-order-invalid')
  if (input.requireReadback === true && input.readbackVerified !== true) errorCodes.push('artifact-template-readback-required')
  const requiredSet = new Set(required)
  const observedExtensions = uniqueSemantics([...semantics.positions.keys()].filter(item => !requiredSet.has(item) && item !== 'document-title'))
  if (contract?.extensionPolicy === 'closed') {
    const allowed = new Set(contract.extensionPoints)
    if (observedExtensions.some(item => !allowed.has(item))) errorCodes.push('artifact-template-extension-not-allowed')
  }
  const semantic = {
    schemaVersion: QUALIFICATION_SCHEMA,
    slotId: String(binding?.slotId || ''),
    targetRef: String(input.target || binding?.targetRef || ''),
    bindingDigest: String(binding?.bindingDigest || ''),
    templateRef: String(binding?.templateRef || ''),
    templateDigest: String(binding?.templateDigest || ''),
    contractDigest: String(binding?.contractDigest || ''),
    artifactDigest: sha256(Buffer.from(String(content || ''), 'utf8')),
    artifactBytes: bytes,
    requiredSemanticDigest: String(binding?.requiredSemanticDigest || ''),
    missingSemanticIds,
    observedExtensions,
    orderValid,
    readbackVerified: input.readbackVerified === true,
    status: errorCodes.length ? 'rejected' : 'qualified',
    errorCodes: [...new Set(errorCodes)].sort(),
    qualifiedAt: new Date(Number.isFinite(options.nowMs) ? options.nowMs : Date.now()).toISOString()
  }
  return Object.freeze({ ...semantic, qualificationDigest: digest(semantic) })
}

function qualifyArtifactFile(binding, target, input = {}, options = {}) {
  const fsImpl = options.fs || fs
  let stat
  try { stat = fsImpl.lstatSync(target) } catch (error) {
    return qualifyArtifactContent(binding, '', { ...input, target, readbackVerified: false, requireReadback: true }, options)
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ARTIFACT_BYTES) {
    return qualifyArtifactContent(binding, '', { ...input, target, readbackVerified: false, requireReadback: true }, options)
  }
  let descriptor
  try {
    descriptor = fsImpl.openSync(target, 'r')
    const before = fsImpl.fstatSync(descriptor)
    const content = fsImpl.readFileSync(descriptor, 'utf8')
    const after = fsImpl.fstatSync(descriptor)
    let finalStat = null
    try { finalStat = fsImpl.lstatSync(target) } catch (error) {}
    const stableRead = finalStat && before.size <= MAX_ARTIFACT_BYTES && finalStat.size <= MAX_ARTIFACT_BYTES &&
      sameStableFileSnapshot(stat, before) && sameStableFileSnapshot(before, after) &&
      sameStableFileSnapshot(after, finalStat) &&
      Buffer.byteLength(content, 'utf8') === after.size
    if (!stableRead) {
      return qualifyArtifactContent(binding, content, {
        ...input,
        target,
        readbackVerified: false,
        requireReadback: true,
        readbackErrorCode: 'artifact-template-readback-drift'
      }, options)
    }
    return qualifyArtifactContent(binding, content, { ...input, target, readbackVerified: true, requireReadback: true }, options)
  } catch (error) {
    return qualifyArtifactContent(binding, '', {
      ...input,
      target,
      readbackVerified: false,
      requireReadback: true,
      readbackErrorCode: 'artifact-template-readback-failed'
    }, options)
  } finally {
    if (descriptor !== undefined) fsImpl.closeSync(descriptor)
  }
}

function validateArtifactTemplateQualification(value, binding = null) {
  const errors = []
  if (value?.schemaVersion !== QUALIFICATION_SCHEMA || !['qualified', 'rejected'].includes(value?.status)) errors.push('artifact-template-qualification-schema-invalid')
  if (!String(value?.slotId || '').trim() || !String(value?.targetRef || '').trim() || !safeTemplateRef(value?.templateRef)) errors.push('artifact-template-qualification-identity-invalid')
  for (const field of ['bindingDigest', 'templateDigest', 'contractDigest', 'artifactDigest', 'requiredSemanticDigest']) {
    if (!DIGEST_RE.test(String(value?.[field] || ''))) errors.push(`artifact-template-qualification-${field}-invalid`)
  }
  if (!Number.isInteger(value?.artifactBytes) || value.artifactBytes < 0 || typeof value?.orderValid !== 'boolean' || typeof value?.readbackVerified !== 'boolean' ||
      !Array.isArray(value?.missingSemanticIds) || !Array.isArray(value?.observedExtensions) || !Array.isArray(value?.errorCodes) ||
      !Number.isFinite(Date.parse(String(value?.qualifiedAt || '')))) errors.push('artifact-template-qualification-fields-invalid')
  if ((value?.status === 'qualified') !== ((value?.errorCodes || []).length === 0) ||
      (value?.status === 'qualified' && ((value?.missingSemanticIds || []).length || value?.orderValid !== true))) errors.push('artifact-template-qualification-status-invalid')
  const { qualificationDigest, ...semantic } = value || {}
  if (!DIGEST_RE.test(String(qualificationDigest || '')) || digest(semantic) !== qualificationDigest) errors.push('artifact-template-qualification-digest-invalid')
  if (binding) {
    for (const field of ['slotId', 'bindingDigest', 'templateRef', 'templateDigest', 'contractDigest', 'requiredSemanticDigest']) {
      if (String(value?.[field] || '') !== String(binding?.[field] || '')) errors.push(`artifact-template-qualification-binding-${field}`)
    }
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] }
}

function findArtifactTemplateQualification(value, bindingDigest = null, state = { seen: new Set(), count: 0 }) {
  if (!value || typeof value !== 'object' || state.seen.has(value) || state.count >= 256) return null
  state.seen.add(value)
  state.count += 1
  if (value.schemaVersion === QUALIFICATION_SCHEMA && (!bindingDigest || value.bindingDigest === bindingDigest)) return value
  for (const child of Object.values(value)) {
    const found = findArtifactTemplateQualification(child, bindingDigest, state)
    if (found) return found
  }
  return null
}

function renderArtifactTemplateQualification(value, locale = 'zh-CN') {
  const passed = value?.status === 'qualified' && validateArtifactTemplateQualification(value).valid
  if (String(locale).toLowerCase().startsWith('zh')) return passed ? '模板资格：通过（已读回）' : '模板资格：阻断（需修正后重试）'
  return passed ? 'Template qualification: passed (read back).' : 'Template qualification: blocked (revise and retry).'
}

module.exports = {
  ARTIFACT_TEMPLATE_BINDING_PROJECTION_SCHEMA: BINDING_PROJECTION_SCHEMA,
  ARTIFACT_TEMPLATE_BINDING_SCHEMA: BINDING_SCHEMA,
  ARTIFACT_TEMPLATE_CONTRACT_SCHEMA: CONTRACT_SCHEMA,
  ARTIFACT_TEMPLATE_QUALIFICATION_SCHEMA: QUALIFICATION_SCHEMA,
  ArtifactTemplateContractError,
  createArtifactTemplateBinding,
  deriveArtifactTemplateContract,
  findArtifactTemplateQualification,
  projectArtifactTemplateBinding,
  qualifyArtifactContent,
  qualifyArtifactFile,
  renderArtifactTemplateQualification,
  resolveArtifactTemplateRef,
  validateArtifactTemplateBinding,
  validateArtifactTemplateBindingProjection,
  validateArtifactTemplateQualification
}
