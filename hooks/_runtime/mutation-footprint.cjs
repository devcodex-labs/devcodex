'use strict'

const fs = require('fs')
const path = require('path')
const { sha256, stableStringify } = require('./content-identity.cjs')
const {
  classifyHostToolMutation,
  validateHostToolMutationAdapterDecision
} = require('./host-tool-mutation-adapters.cjs')

const SCHEMA_VERSION = 'MutationFootprintV2'
const LEGACY_SCHEMA_VERSION = 'MutationFootprintV1'
const MAX_TARGETS = 256
const MAX_EVIDENCE = 128
const MAX_SCAN_BYTES = 512 * 1024
const PATH_FIELD_RE = /^(?:file|files|file_path|file_paths|filepath|filepaths|path|paths|target|targets|target_path|target_paths|targetpath|targetpaths|target_roots|targetroots|document_path|documentpath|artifact_path|artifactpath|destination|dest|destination_path|source|source_path|output|outputs|output_path|output_paths|outputpath|outputpaths|output_roots|outputroots|uri|uris)$/i
const COMMAND_FIELD_RE = /^(?:command|cmd|script|shell_command|shellcommand)$/i
const DIGEST_RE = /^[a-f0-9]{64}$/

function digest(value) {
  return sha256(Buffer.from(stableStringify(value), 'utf8'))
}

function toolInput(payload) {
  return payload?.tool_input || payload?.toolInput || payload?.arguments || payload?.args || {}
}

function toolName(payload) {
  return String(
    payload?.tool_name || payload?.toolName || payload?.name || payload?.tool?.name || ''
  ).trim()
}

function cleanToken(value) {
  return String(value || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/[),;]+$/g, '')
}

function looksLikePath(value) {
  const text = cleanToken(value)
  if (!text || text.length > 4096 || /^data:/i.test(text)) return false
  if (/^(?:https?|artifact|memory|profile|skill):/i.test(text)) return true
  if (/^file:/i.test(text) || /^\\\\/.test(text) || /^[a-z]:[\\/]/i.test(text) || /^\//.test(text)) return true
  if (/^\.{0,2}[\\/]/.test(text) || /[\\/]/.test(text)) return true
  return /(?:^|[^.])\.[a-z0-9][a-z0-9._-]{0,15}$/i.test(text)
}

function normalizeTarget(value, cwd) {
  const text = cleanToken(value)
  if (!text) return ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[a-z]:[\\/]/i.test(text)) {
    if (/^file:/i.test(text)) {
      try {
        const parsed = new URL(text)
        return path.normalize(decodeURIComponent(parsed.pathname.replace(/^\/(?:([a-z]):)/i, '$1')))
      } catch {
        return text
      }
    }
    return text
  }
  try {
    return path.normalize(path.isAbsolute(text) ? text : path.resolve(cwd, text))
  } catch {
    return text
  }
}

function inferOperation(name, input) {
  const raw = String(name || '').toLowerCase()
  const explicit = String(input?.operation || input?.op || '').toLowerCase()
  const command = String(input?.command || input?.cmd || input?.script || input?.shell_command || '').toLowerCase()
  const patch = String(input?.input || input?.patch || input?.diff || '')
  if (/^\*\*\*\s+Move\s+File:/m.test(patch)) return 'move'
  if (/^\*\*\*\s+Delete\s+File:/m.test(patch) && !/^\*\*\*\s+(?:Add|Update)\s+File:/m.test(patch)) return 'delete'
  const value = explicit || `${raw} ${command}`
  if (/move|rename/.test(value)) return 'move'
  if (/copy|\bcp\b/.test(value)) return 'copy'
  if (/delete|remove|unlink|\brm\b/.test(value)) return 'delete'
  if (/create|add|new[_-]?item|write|set-content|out-file|writefile|createwritestream|\s>{1,2}\s/.test(value)) return 'create-or-update'
  if (/edit|replace|patch|append/.test(value)) return 'update'
  return 'unknown'
}

function classifyFieldRole(keyPath, operation) {
  const leaf = keyPath.split('.').pop().replace(/\[\d+\]/g, '').toLowerCase()
  if (/^(?:source|source_path|from)$/.test(leaf)) return 'source'
  if (/^(?:destination|dest|destination_path|target|target_path|targetpath|to)$/.test(leaf)) return 'target'
  if (operation === 'delete') return 'source'
  return 'target'
}

function createCollector(cwd, operation) {
  const sourceTargets = []
  const targetTargets = []
  const parseEvidence = []
  const ambiguityCodes = new Set()
  let scannedBytes = 0
  let overflow = false

  function evidence(item) {
    if (parseEvidence.length < MAX_EVIDENCE) parseEvidence.push(item)
    else {
      overflow = true
      ambiguityCodes.add('parse-evidence-limit-exceeded')
    }
  }

  function add(raw, role, source, keyPath = '') {
    const values = Array.isArray(raw) ? raw : [raw]
    for (const value of values) {
      if (typeof value !== 'string') continue
      scannedBytes += Buffer.byteLength(value, 'utf8')
      if (scannedBytes > MAX_SCAN_BYTES) {
        overflow = true
        ambiguityCodes.add('payload-scan-limit-exceeded')
        continue
      }
      if (!looksLikePath(value)) continue
      const normalized = normalizeTarget(value, cwd)
      if (!normalized) continue
      const target = role === 'source' ? sourceTargets : targetTargets
      if (!target.includes(normalized)) target.push(normalized)
      evidence({ source, keyPath, role, raw: cleanToken(value), normalized })
      if (sourceTargets.length + targetTargets.length > MAX_TARGETS) {
        overflow = true
        ambiguityCodes.add('target-count-limit-exceeded')
      }
    }
  }

  return {
    add,
    evidence,
    ambiguityCodes,
    result() {
      const trim = values => values.slice(0, MAX_TARGETS)
      return {
        sourceTargets: trim(sourceTargets),
        targetTargets: trim(targetTargets),
        parseEvidence,
        ambiguityCodes,
        overflow,
        scannedBytes
      }
    },
    operation
  }
}

function collectPathFields(value, collector, keyPath = '', seen = new Set()) {
  if (value === null || value === undefined) return
  if (typeof value === 'string') {
    const leaf = keyPath.split('.').pop().replace(/\[\d+\]/g, '')
    if (PATH_FIELD_RE.test(leaf)) collector.add(value, classifyFieldRole(keyPath, collector.operation), 'field', keyPath)
    return
  }
  if (typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectPathFields(item, collector, `${keyPath}[${index}]`, seen))
    return
  }
  for (const [key, item] of Object.entries(value)) {
    const next = keyPath ? `${keyPath}.${key}` : key
    if (PATH_FIELD_RE.test(key)) {
      if (Array.isArray(item)) item.forEach((entry, index) => collector.add(entry, classifyFieldRole(next, collector.operation), 'field', `${next}[${index}]`))
      else collector.add(item, classifyFieldRole(next, collector.operation), 'field', next)
    }
    collectPathFields(item, collector, next, seen)
  }
}

function collectPatchPaths(input, collector) {
  const candidates = [input?.input, input?.patch, input?.diff, input?.content]
  const patchRe = /^\*\*\*\s+(Update|Add|Delete|Move)\s+File:\s+(.+)$/gm
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.includes('***')) continue
    let match
    while ((match = patchRe.exec(candidate)) !== null) {
      const verb = match[1].toLowerCase()
      collector.add(match[2], verb === 'delete' || verb === 'move' ? 'source' : 'target', 'patch', verb)
    }
    const moveToRe = /^\*\*\*\s+Move to:\s+(.+)$/gm
    while ((match = moveToRe.exec(candidate)) !== null) collector.add(match[1], 'target', 'patch', 'move-to')
  }
}

function quotedOrTokenPattern(prefix) {
  return new RegExp(prefix + String.raw`\s*(?:["']([^"']+)["']|([^\s;|&]+))`, 'gi')
}

function collectCommandPaths(command, collector) {
  if (typeof command !== 'string' || !command.trim()) return
  if (Buffer.byteLength(command, 'utf8') > MAX_SCAN_BYTES) {
    collector.ambiguityCodes.add('command-scan-limit-exceeded')
    return
  }
  const specs = [
    { re: />{1,2}\s*(?:["']([^"']+)["']|([^\s;|&]+))/g, role: 'target', source: 'redirect' },
    { re: quotedOrTokenPattern(String.raw`\btee\s+(?:-a\s+)?`), role: 'target', source: 'tee' },
    { re: quotedOrTokenPattern(String.raw`\b(?:Set-Content|Add-Content|Clear-Content|sc(?!\.exe\b)|ac|clc)\b\s+(?:(?:-LiteralPath|-Path)\s+)?`), role: 'target', source: 'powershell-content-write' },
    { re: quotedOrTokenPattern(String.raw`\bOut-File\b\s+(?:(?:-LiteralPath|-FilePath)\s+)?`), role: 'target', source: 'powershell-out-file' },
    { re: quotedOrTokenPattern(String.raw`\b(?:New-Item|ni|mkdir|touch)\b\s+(?:(?:-ItemType\s+\w+|-[A-Za-z]+)\s+)*(?:(?:-LiteralPath|-Path)\s+)?`), role: 'target', source: 'create-command' },
    { re: quotedOrTokenPattern(String.raw`\b(?:Set-Item|Set-ItemProperty|New-ItemProperty|si|sp|np)\b\s+(?:(?:-LiteralPath|-Path)\s+)?`), role: 'target', source: 'powershell-item-write' },
    { re: quotedOrTokenPattern(String.raw`\b(?:Export-Csv|Export-Clixml)\b\s+(?:(?:-LiteralPath|-Path)\s+)?`), role: 'target', source: 'powershell-export' },
    { re: quotedOrTokenPattern(String.raw`\b(?:Remove-Item|rm|ri|del|erase|rd|rmdir|unlink)\b\s+(?:(?:-[A-Za-z]+)\s+)*(?:(?:-LiteralPath|-Path)\s+)?`), role: 'source', source: 'delete-command' },
    { re: quotedOrTokenPattern(String.raw`\b(?:fs\.)?(?:writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream)\s*\(`), role: 'target', source: 'node-file-api' },
    { re: quotedOrTokenPattern(String.raw`\b(?:Path\s*\(|open\s*\()`), role: 'target', source: 'python-file-api' }
  ]
  for (const spec of specs) {
    let match
    while ((match = spec.re.exec(command)) !== null) collector.add(match[1] || match[2], spec.role, spec.source)
  }

  const pairSpecs = [
    { re: /\b(?:Move-Item|Rename-Item|mi|rni|ren)\b\s+(?:-[A-Za-z]+\s+)*(?:-LiteralPath\s+|-Path\s+)?(?:["']([^"']+)["']|([^\s;|&]+))\s+(?:(?:-Destination|-NewName)\s+)?(?:["']([^"']+)["']|([^\s;|&]+))/gi, source: 'powershell-move' },
    { re: /\b(?:mv|move)\b\s+(?:-[A-Za-z]+\s+)*(?:["']([^"']+)["']|([^\s;|&]+))\s+(?:["']([^"']+)["']|([^\s;|&]+))/gi, source: 'move-command' },
    { re: /\b(?:Copy-Item|cpi|cp|copy)\b\s+(?:-[A-Za-z]+\s+)*(?:["']([^"']+)["']|([^\s;|&]+))\s+(?:(?:-Destination)\s+)?(?:["']([^"']+)["']|([^\s;|&]+))/gi, source: 'copy-command' }
  ]
  for (const spec of pairSpecs) {
    let match
    while ((match = spec.re.exec(command)) !== null) {
      collector.add(match[1] || match[2], 'source', spec.source)
      collector.add(match[3] || match[4], 'target', spec.source)
    }
  }

  if (/\$\(|`[^`]+`|\$\{[^}]+\}|%[^%]+%|\$[A-Za-z_][A-Za-z0-9_]*/.test(command)) {
    collector.ambiguityCodes.add('dynamic-command-target')
  }
}

function collectCommands(value, collector, keyPath = '', seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  for (const [key, item] of Object.entries(value)) {
    const next = keyPath ? `${keyPath}.${key}` : key
    if (typeof item === 'string' && COMMAND_FIELD_RE.test(key)) collectCommandPaths(item, collector)
    else if (item && typeof item === 'object') collectCommands(item, collector, next, seen)
  }
}

function collectLogicalMemoryTarget(name, input, collector) {
  const normalizedName = String(name || '').toLowerCase()
  const project = String(input?.project || 'current')
  const agent = String(input?.agent || 'current')
  if (/memory_(?:session_write|session_allocate)|memory-(?:session-write|session-allocate)/.test(normalizedName)) {
    collector.add(`devcodex-memory://session/${encodeURIComponent(project)}/${encodeURIComponent(agent)}/${encodeURIComponent(String(input?.date || 'current'))}`, 'target', 'controlled-memory-tool')
  } else if (/memory_(?:summary_append)|memory-(?:summary-append)/.test(normalizedName)) {
    collector.add(`devcodex-memory://summary/${encodeURIComponent(project)}/${encodeURIComponent(agent)}`, 'target', 'controlled-memory-tool')
  } else if (/memory_(?:cp_confirm)|memory-(?:cp-confirm)/.test(normalizedName)) {
    collector.add(`devcodex-memory://task/${encodeURIComponent(project)}/${encodeURIComponent(String(input?.kind || 'requirements'))}/${encodeURIComponent(String(input?.requirement || 'unknown'))}/sessions`, 'target', 'controlled-memory-tool')
  }
}

function declaredEffectManifest(input) {
  const candidates = [
    input?.mutationManifest,
    input?.mutation_manifest,
    input?.effectManifest,
    input?.effect_manifest,
    input?.dryRunManifest,
    input?.dry_run_manifest,
    input?.outputManifest,
    input?.output_manifest
  ]
  return candidates.find(item => item && typeof item === 'object' && !Array.isArray(item)) || null
}

function stringList(value, cwd) {
  const values = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : [])
  return [...new Set(values
    .filter(item => typeof item === 'string' && looksLikePath(item))
    .map(item => normalizeTarget(item, cwd))
    .filter(Boolean))].slice(0, MAX_TARGETS).sort()
}

function declaredEffects(input, cwd) {
  const manifest = declaredEffectManifest(input) || {}
  const creates = stringList(manifest.creates || manifest.plannedCreates || manifest.planned_creates, cwd)
  const modifies = stringList(manifest.modifies || manifest.plannedModifies || manifest.planned_modifies, cwd)
  const deletes = stringList(manifest.deletes || manifest.plannedDeletes || manifest.planned_deletes, cwd)
  const rawMoves = manifest.moves || manifest.plannedMoves || manifest.planned_moves || []
  const moves = (Array.isArray(rawMoves) ? rawMoves : [])
    .flatMap(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return []
      const source = normalizeTarget(item.source || item.from, cwd)
      const target = normalizeTarget(item.target || item.destination || item.to, cwd)
      return source && target ? [{ source, target }] : []
    })
    .slice(0, MAX_TARGETS)
    .sort((left, right) => `${left.source}\0${left.target}`.localeCompare(`${right.source}\0${right.target}`))
  return { creates, modifies, deletes, moves }
}

function fileExists(target, fsImpl = fs) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)) return false
  try { return fsImpl.existsSync(target) } catch { return false }
}

function pairMoves(sourceTargets, targetTargets, ambiguityCodes) {
  if (sourceTargets.length !== targetTargets.length) ambiguityCodes.add('move-source-target-cardinality-mismatch')
  const count = Math.min(sourceTargets.length, targetTargets.length, MAX_TARGETS)
  return Array.from({ length: count }, (_, index) => ({
    source: sourceTargets[index],
    target: targetTargets[index]
  }))
}

function boundedEffect(effectClass, input) {
  const command = String(input?.command || input?.cmd || input?.script || input?.shell_command || '')
  return Object.freeze({
    effectClass,
    commandDigest: command ? digest(command.slice(0, MAX_SCAN_BYTES)) : null
  })
}

function extractMutationFootprint(payload = {}, options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd())
  const input = toolInput(payload)
  const name = toolName(payload)
  const adapterDecision = options.adapterDecision || classifyHostToolMutation(payload, {
    hostVariant: options.hostVariant,
    platform: options.platform
  })
  const adapterValidation = validateHostToolMutationAdapterDecision(adapterDecision)
  let operation = inferOperation(name, input)
  if (adapterDecision.operationClass === 'destructive' && operation === 'unknown') operation = 'delete'
  if (adapterDecision.commandClass === 'move-or-copy' && operation === 'unknown') operation = 'move'
  if (adapterDecision.mutationCandidate === true && operation === 'unknown' &&
      ['direct-write', 'indirect-writer', 'shell'].includes(adapterDecision.operationClass)) {
    operation = 'create-or-update'
  }
  const collector = createCollector(cwd, operation)
  collectPathFields(input, collector)
  collectPatchPaths(input, collector)
  collectCommands(input, collector)
  collectLogicalMemoryTarget(name, input, collector)
  const collected = collector.result()
  const declared = declaredEffects(input, cwd)
  const sourceTargets = [...new Set([
    ...collected.sourceTargets,
    ...declared.deletes,
    ...declared.moves.map(item => item.source)
  ])].slice(0, MAX_TARGETS).sort()
  const targetTargets = [...new Set([
    ...collected.targetTargets,
    ...declared.creates,
    ...declared.modifies,
    ...declared.moves.map(item => item.target)
  ])].slice(0, MAX_TARGETS).sort()
  const normalizedTargets = [...new Set([...sourceTargets, ...targetTargets])].slice(0, MAX_TARGETS).sort()
  if (!adapterValidation.valid) collector.ambiguityCodes.add('host-tool-adapter-invalid')
  if (adapterDecision.mutationCandidate === true && normalizedTargets.length === 0 &&
      adapterDecision.operationClass !== 'service-lifecycle') {
    collector.ambiguityCodes.add('mutation-target-unobserved')
  }
  if (adapterDecision.operationClass === 'unknown' && adapterDecision.mutationCandidate === true) {
    collector.ambiguityCodes.add('unknown-writer-not-authorizable')
  }
  let ambiguityCodes = [...collector.ambiguityCodes].sort()
  let coverage = adapterDecision.coverage
  if (adapterDecision.mutationCandidate !== true) coverage = 'not-applicable'
  else if (adapterDecision.operationClass !== 'service-lifecycle' && normalizedTargets.length === 0) coverage = 'unavailable'
  else if (collected.overflow || ambiguityCodes.length) coverage = normalizedTargets.length ? 'partial' : 'unavailable'
  if (adapterDecision.operationClass === 'unknown') coverage = 'unavailable'
  let observability = coverage === 'complete'
    ? 'complete'
    : (coverage === 'partial' ? 'partial' : (coverage === 'not-applicable' ? 'not-applicable' : 'unknown'))
  const fsImpl = options.fs || fs
  const moves = operation === 'move'
    ? [...declared.moves, ...pairMoves(sourceTargets, targetTargets, collector.ambiguityCodes)]
      .filter((item, index, all) => all.findIndex(other => other.source === item.source && other.target === item.target) === index)
      .slice(0, MAX_TARGETS)
    : declared.moves
  ambiguityCodes = [...collector.ambiguityCodes].sort()
  if (ambiguityCodes.length && coverage === 'complete') coverage = normalizedTargets.length ? 'partial' : 'unavailable'
  observability = coverage === 'complete'
    ? 'complete'
    : (coverage === 'partial' ? 'partial' : (coverage === 'not-applicable' ? 'not-applicable' : 'unknown'))
  const moveSources = new Set(moves.map(item => item.source))
  const moveTargets = new Set(moves.map(item => item.target))
  const plannedDeletes = [...new Set([
    ...declared.deletes,
    ...(operation === 'delete' ? sourceTargets : [])
  ])].slice(0, MAX_TARGETS).sort()
  const declaredCreates = new Set(declared.creates)
  const declaredModifies = new Set(declared.modifies)
  const writeTargets = targetTargets.filter(target => !moveTargets.has(target))
  const plannedCreates = [...new Set(writeTargets.filter(target =>
    declaredCreates.has(target) || operation === 'copy' || !fileExists(target, fsImpl)
  ))].slice(0, MAX_TARGETS).sort()
  const plannedModifies = [...new Set(writeTargets.filter(target =>
    declaredModifies.has(target) || (!declaredCreates.has(target) && operation !== 'copy' && fileExists(target, fsImpl))
  ))].slice(0, MAX_TARGETS).sort()
  const plannedMoves = moves.map(item => ({ source: item.source, target: item.target }))
  const serviceEffects = adapterDecision.operationClass === 'service-lifecycle'
    ? [boundedEffect('service-lifecycle', input)]
    : []
  const environmentEffects = adapterDecision.operationClass === 'indirect-writer'
    ? [boundedEffect(adapterDecision.commandClass || 'indirect-writer', input)]
    : []
  const cwdCanonical = (() => {
    try { return fsImpl.realpathSync?.native ? fsImpl.realpathSync.native(cwd) : fsImpl.realpathSync(cwd) } catch { return cwd }
  })()
  const plannedSet = {
    creates: plannedCreates,
    modifies: plannedModifies,
    deletes: plannedDeletes,
    moves: plannedMoves
  }
  const semantic = {
    schemaVersion: SCHEMA_VERSION,
    adapterId: adapterDecision.adapterId,
    adapterDigest: adapterDecision.adapterDigest,
    toolName: name,
    hostVariant: adapterDecision.hostVariant,
    operationClass: adapterDecision.operationClass,
    operation,
    cwdIdentity: {
      canonicalPath: cwdCanonical,
      digest: digest(process.platform === 'win32' ? cwdCanonical.toLowerCase() : cwdCanonical)
    },
    plannedCreates,
    plannedModifies,
    plannedDeletes,
    plannedMoves,
    serviceEffects,
    environmentEffects,
    observationPlan: {
      ...adapterDecision.observationPlan,
      targetGranularity: adapterDecision.controlledTargets ? 'controlled-root' : 'exact-target',
      plannedSetDigest: digest(plannedSet)
    },
    coverage,
    ambiguity: coverage === 'complete' || coverage === 'not-applicable'
      ? 'none'
      : (coverage === 'partial' ? 'bounded' : 'unavailable'),
    sourceTargets,
    targetTargets,
    normalizedTargets,
    parseEvidence: collected.parseEvidence,
    observability,
    ambiguityCodes,
    targetCount: normalizedTargets.length,
    completeTargetSet: coverage === 'complete',
    plannedSetDigest: digest(plannedSet)
  }
  return Object.freeze({ ...semantic, footprintDigest: digest(semantic) })
}

function validateMutationFootprint(value) {
  const errors = []
  if (![SCHEMA_VERSION, LEGACY_SCHEMA_VERSION].includes(value?.schemaVersion)) errors.push('footprint-schema-invalid')
  if (!['create-or-update', 'update', 'delete', 'move', 'copy', 'unknown'].includes(value?.operation)) errors.push('footprint-operation-invalid')
  if (!['complete', 'partial', 'unknown', 'not-applicable'].includes(value?.observability)) errors.push('footprint-observability-invalid')
  if (!Array.isArray(value?.sourceTargets) || !Array.isArray(value?.targetTargets) || !Array.isArray(value?.normalizedTargets)) errors.push('footprint-targets-invalid')
  if (!Array.isArray(value?.ambiguityCodes) || !Array.isArray(value?.parseEvidence)) errors.push('footprint-evidence-invalid')
  if (value?.schemaVersion === SCHEMA_VERSION) {
    if (!['read', 'direct-write', 'shell', 'indirect-writer', 'destructive', 'service-lifecycle', 'unknown'].includes(value?.operationClass)) errors.push('footprint-operation-class-invalid')
    if (!['complete', 'partial', 'unavailable', 'not-applicable'].includes(value?.coverage)) errors.push('footprint-coverage-invalid')
    if (!['none', 'bounded', 'unavailable'].includes(value?.ambiguity)) errors.push('footprint-ambiguity-invalid')
    if (![value.plannedCreates, value.plannedModifies, value.plannedDeletes, value.plannedMoves, value.serviceEffects, value.environmentEffects].every(Array.isArray)) {
      errors.push('footprint-planned-effects-invalid')
    }
    if (!value?.cwdIdentity || !DIGEST_RE.test(String(value.cwdIdentity.digest || ''))) errors.push('footprint-cwd-identity-invalid')
    if (!DIGEST_RE.test(String(value?.adapterDigest || '')) || !DIGEST_RE.test(String(value?.plannedSetDigest || ''))) errors.push('footprint-v2-binding-invalid')
    const expectedPlannedSetDigest = digest({
      creates: value.plannedCreates,
      modifies: value.plannedModifies,
      deletes: value.plannedDeletes,
      moves: value.plannedMoves
    })
    if (value?.plannedSetDigest !== expectedPlannedSetDigest || value?.observationPlan?.plannedSetDigest !== expectedPlannedSetDigest) {
      errors.push('footprint-planned-set-digest-mismatch')
    }
    if (value?.completeTargetSet !== (value?.coverage === 'complete')) errors.push('footprint-complete-target-set-invalid')
  }
  const { footprintDigest, ...semantic } = value || {}
  if (!DIGEST_RE.test(String(footprintDigest || '')) || digest(semantic) !== footprintDigest) errors.push('footprint-digest-invalid')
  return { valid: errors.length === 0, errors }
}

module.exports = {
  MAX_EVIDENCE,
  MAX_SCAN_BYTES,
  MAX_TARGETS,
  MUTATION_FOOTPRINT_SCHEMA: SCHEMA_VERSION,
  MUTATION_FOOTPRINT_LEGACY_SCHEMA: LEGACY_SCHEMA_VERSION,
  extractMutationFootprint,
  inferOperation,
  normalizeTarget,
  validateMutationFootprint
}
