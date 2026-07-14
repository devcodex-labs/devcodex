'use strict'

const fs = require('fs')
const path = require('path')

function buildLifecycleGovernanceIntakeUtils() {
  const GOVERNANCE_INTAKE_STATE_VERSION = 2
  const MAX_TERMINAL_CANDIDATES = 20
  const RECORD_INTENT_RE = /record\.(?:violation|spec-defect|process-improvement|pending-issue|audit-gap|none|ambiguous)/gi
  const LEDGER_PATH_RE = /data\/(?:violations|pending-fixes|process-improvements|pending-issues|gap-registry)\.md/gi
  const LEDGER_ID_RE = /\b(?:PI|PF|VL|GR|ISSUE)-\d{3,}\b/gi
  const INTENT_CONTRACT = {
    'record.violation': { ledger: 'data/violations.md', file: 'violations.md', prefix: 'VL-' },
    'record.spec-defect': { ledger: 'data/pending-fixes.md', file: 'pending-fixes.md', prefix: 'PF-' },
    'record.process-improvement': { ledger: 'data/process-improvements.md', file: 'process-improvements.md', prefix: 'PI-' },
    'record.pending-issue': { ledger: 'data/pending-issues.md', file: 'pending-issues.md', prefix: 'ISSUE-' },
    'record.audit-gap': { ledger: 'data/gap-registry.md', file: 'gap-registry.md', prefix: 'GR-' }
  }
  const ASSESSMENT_VERDICTS = new Set(['accepted', 'rejected', 'uncertain', 'no-governance-impact'])
  const GENERALIZATION_SCOPES = new Set(['project-local', 'cross-project', 'devcodex-control-plane', 'none'])
  const EXISTING_RULE_STATES = new Set(['exists-complete', 'exists-violated', 'missing', 'partial', 'conflicting', 'not-applicable'])
  const LEDGER_CONTRACTS = [...new Map(Object.values(INTENT_CONTRACT).map(contract => [contract.ledger, contract])).values()]

  function compactText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  function stableDigest(value) {
    const text = String(value || '')
    let hash = 2166136261
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(16).padStart(8, '0')
  }

  function unique(values) {
    return [...new Set((values || []).filter(Boolean))]
  }

  function labelValue(text, labelPattern) {
    const match = String(text || '').match(new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?(?:${labelPattern})\\s*[:：]\\s*([^\\n]+)`, 'i'))
    return match ? compactText(match[1]) : ''
  }

  function createCandidateDefaults() {
    return {
      id: '',
      sourceMessageAnchor: '',
      sourceDigest: '',
      promptPreview: '',
      createdAt: '',
      updatedAt: '',
      seenCount: 1,
      phase: 'detected',
      phaseHistory: [],
      terminal: false,
      assessmentVerdict: '',
      generalizationScope: '',
      existingRuleState: '',
      recordIntents: [],
      intentStates: [],
      targetLedgers: [],
      writeRequirement: '',
      writeEvidence: [],
      skipEvidence: '',
      verificationState: 'unverified',
      decisionEvidence: '',
      writeObservedAt: '',
      handledAt: '',
      handledBy: ''
    }
  }

  function emptyGovernanceIntakeState() {
    return {
      version: GOVERNANCE_INTAKE_STATE_VERSION,
      candidates: [],
      activeCandidateId: '',
      ledgerObservations: [],
      governanceIntakeCandidate: false,
      pending: false,
      handled: false,
      candidateType: 'post-assessment-required',
      reason: 'semantic post-assessment required',
      promptPreview: '',
      createdAt: '',
      handledAt: '',
      handledBy: '',
      lastDecisionError: ''
    }
  }

  function normalizeCandidate(candidate, index) {
    const defaults = createCandidateDefaults()
    const normalized = { ...defaults, ...(candidate || {}) }
    normalized.id = compactText(normalized.id) || `GI-MIGRATED-${String(index + 1).padStart(3, '0')}`
    normalized.sourceDigest = compactText(normalized.sourceDigest) || stableDigest(normalized.promptPreview || normalized.sourceMessageAnchor || normalized.id)
    normalized.sourceMessageAnchor = compactText(normalized.sourceMessageAnchor) || `user-message:${normalized.sourceDigest}`
    normalized.promptPreview = compactText(normalized.promptPreview).slice(0, 160)
    normalized.createdAt = normalized.createdAt || new Date().toISOString()
    normalized.updatedAt = normalized.updatedAt || normalized.createdAt
    normalized.seenCount = Number.isFinite(Number(normalized.seenCount)) ? Math.max(1, Number(normalized.seenCount)) : 1
    normalized.recordIntents = unique(normalized.recordIntents)
    normalized.intentStates = Array.isArray(normalized.intentStates) ? normalized.intentStates : []
    normalized.targetLedgers = unique(normalized.targetLedgers)
    normalized.writeEvidence = unique(normalized.writeEvidence)
    normalized.terminal = normalized.terminal === true || normalized.phase === 'acknowledged'
    if (normalized.terminal) normalized.phase = 'acknowledged'
    normalized.phaseHistory = Array.isArray(normalized.phaseHistory)
      ? normalized.phaseHistory.filter(entry => entry && typeof entry === 'object' && compactText(entry.phase))
      : []
    if (!normalized.phaseHistory.length) {
      normalized.phaseHistory.push({ phase: normalized.phase, at: normalized.updatedAt || normalized.createdAt })
    } else if (normalized.phaseHistory[normalized.phaseHistory.length - 1].phase !== normalized.phase) {
      normalized.phaseHistory.push({ phase: normalized.phase, at: normalized.updatedAt || normalized.createdAt })
    }
    return normalized
  }

  function transitionCandidatePhase(candidate, phase, at = new Date().toISOString()) {
    if (!candidate || !phase) return
    candidate.phaseHistory = Array.isArray(candidate.phaseHistory) ? candidate.phaseHistory : []
    if (candidate.phase !== phase) {
      candidate.phase = phase
      candidate.phaseHistory.push({ phase, at })
    }
    candidate.updatedAt = at
  }

  function syncCompatibilityMirrors(state) {
    const unresolved = state.candidates.filter(candidate => !candidate.terminal)
    const active = unresolved.find(candidate => candidate.id === state.activeCandidateId) || unresolved[unresolved.length - 1]
    state.activeCandidateId = active?.id || ''
    state.governanceIntakeCandidate = unresolved.length > 0
    state.pending = unresolved.length > 0
    state.handled = state.candidates.length > 0 && unresolved.length === 0
    state.promptPreview = active?.promptPreview || ''
    state.createdAt = active?.createdAt || ''
    state.handledAt = state.handled ? (state.candidates[state.candidates.length - 1]?.handledAt || '') : ''
    state.handledBy = state.handled ? (state.candidates[state.candidates.length - 1]?.handledBy || '') : ''
    return state
  }

  function normalizeGovernanceIntakeState(input) {
    const state = emptyGovernanceIntakeState()
    if (!input || typeof input !== 'object') return state

    if (Number(input.version) === GOVERNANCE_INTAKE_STATE_VERSION && Array.isArray(input.candidates)) {
      state.candidates = input.candidates.map(normalizeCandidate)
      state.activeCandidateId = compactText(input.activeCandidateId)
      state.ledgerObservations = Array.isArray(input.ledgerObservations) ? input.ledgerObservations : []
      state.lastDecisionError = compactText(input.lastDecisionError)
      return syncCompatibilityMirrors(state)
    }

    if (input.governanceIntakeCandidate || input.pending || input.handled) {
      const createdAt = input.createdAt || new Date().toISOString()
      const digest = stableDigest(input.promptPreview || input.reason || createdAt)
      state.candidates.push(normalizeCandidate({
        id: `GI-V1-${digest.toUpperCase()}`,
        sourceMessageAnchor: `legacy-state:${digest}`,
        sourceDigest: digest,
        promptPreview: input.promptPreview || '',
        createdAt,
        updatedAt: input.handledAt || createdAt,
        phase: input.handled ? 'acknowledged' : 'detected',
        terminal: !!input.handled,
        verificationState: input.handled ? 'legacy-acknowledged' : 'unverified',
        decisionEvidence: input.reason || 'migrated from governance intake v1',
        handledAt: input.handledAt || '',
        handledBy: input.handledBy || ''
      }, 0))
      state.activeCandidateId = input.handled ? '' : state.candidates[0].id
    }
    return syncCompatibilityMirrors(state)
  }

  function buildGovernanceIntakeCandidate(prompt, metadata = {}) {
    const text = String(prompt || '').trim()
    if (!text) return null
    const createdAt = metadata.createdAt || new Date().toISOString()
    const digest = stableDigest(text)
    const ordinal = Number(metadata.ordinal || 1)
    return normalizeCandidate({
      id: metadata.id || `GI-${digest.toUpperCase()}-${createdAt.replace(/\D/g, '').slice(-8)}-${String(ordinal).padStart(2, '0')}`,
      sourceMessageAnchor: metadata.sourceMessageAnchor || `user-message:${digest}`,
      sourceDigest: digest,
      promptPreview: compactText(text).slice(0, 160),
      createdAt,
      updatedAt: createdAt,
      decisionEvidence: 'neutral post-assessment candidate; no keyword classification applied'
    }, ordinal - 1)
  }

  function registerGovernanceIntakeCandidate(input, prompt, metadata = {}) {
    const state = normalizeGovernanceIntakeState(input)
    const text = String(prompt || '').trim()
    if (!text) return state
    const digest = stableDigest(text)
    const existing = state.candidates.find(candidate => !candidate.terminal && candidate.sourceDigest === digest)
    if (existing) {
      existing.seenCount += 1
      existing.updatedAt = metadata.createdAt || new Date().toISOString()
      state.activeCandidateId = existing.id
      state.lastDecisionError = ''
      return syncCompatibilityMirrors(state)
    }

    const candidate = buildGovernanceIntakeCandidate(text, {
      ...metadata,
      ordinal: state.candidates.length + 1
    })
    if (candidate) {
      state.candidates.push(candidate)
      state.activeCandidateId = candidate.id
    }
    const unresolved = state.candidates.filter(item => !item.terminal)
    const terminal = state.candidates.filter(item => item.terminal).slice(-MAX_TERMINAL_CANDIDATES)
    state.candidates = [...terminal, ...unresolved]
    state.lastDecisionError = ''
    return syncCompatibilityMirrors(state)
  }

  function buildGovernanceIntakeContextMessage(input) {
    const state = normalizeGovernanceIntakeState(input)
    const unresolved = state.candidates.filter(candidate => !candidate.terminal)
    if (!unresolved.length) return ''
    const anchors = unresolved.map(candidate => (
      `${candidate.id}[phase=${candidate.phase};seen=${candidate.seenCount};source=${candidate.sourceMessageAnchor}]`
    ))
    return [
      'Governance Intake post-assessment is required for every non-empty user message.',
      `Neutral candidate anchors: ${anchors.join(', ')}.`,
      'Classify only after semantic/context/evidence assessment; keywords are non-authoritative.',
      'When multiple candidates remain, the structured decision must cite the exact candidate ID.'
    ].join(' ')
  }

  function parseGovernanceIntakeDecision(content) {
    const text = String(content || '')
    const intentText = labelValue(text, '规范化意图|normalizedIntent')
    const targetText = labelValue(text, '目标台账|targetLedgers?')
    const evidenceText = labelValue(text, '写入证据|writeEvidence')
    const candidateAnchor = labelValue(text, '候选锚点|candidateAnchor')
    const recordIntents = unique((intentText.match(RECORD_INTENT_RE) || []).map(value => value.toLowerCase()))
    return {
      candidateAnchor,
      assessmentVerdict: labelValue(text, '评估结论|assessmentVerdict').toLowerCase(),
      generalizationScope: labelValue(text, '泛化范围|generalizationScope').toLowerCase(),
      existingRuleState: labelValue(text, '现有规范状态|existingRuleState').toLowerCase(),
      recordIntents,
      confidence: labelValue(text, '置信度|confidence'),
      basis: labelValue(text, '依据|basis'),
      targetLedgers: unique((targetText.match(LEDGER_PATH_RE) || []).map(value => value.toLowerCase())),
      writeRequirement: labelValue(text, '写入要求|writeRequirement').toLowerCase(),
      writeEvidence: unique((evidenceText.match(LEDGER_ID_RE) || []).map(value => value.toUpperCase())),
      skipEvidence: labelValue(text, 'skipEvidence|skipReason|跳过理由'),
      raw: text
    }
  }

  function collectStrings(value, out = []) {
    if (typeof value === 'string') out.push(value)
    if (Array.isArray(value)) value.forEach(item => collectStrings(item, out))
    if (value && typeof value === 'object') Object.values(value).forEach(item => collectStrings(item, out))
    return out
  }

  function collectExplicitMutationPaths(value, out = []) {
    if (!value || typeof value !== 'object') return out
    if (Array.isArray(value)) {
      value.forEach(item => collectExplicitMutationPaths(item, out))
      return out
    }
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === 'string' && /^(?:path|file|filePath|file_path|filename|targetPath|target_path)$/i.test(key)) {
        out.push(child)
      }
      if (typeof child === 'string') {
        const matches = child.matchAll(/^\*\*\*\s+(?:Update|Add)\s+File:\s*(.+?)\s*$/gmi)
        for (const match of matches) out.push(match[1])
      } else {
        collectExplicitMutationPaths(child, out)
      }
    }
    return unique(out.map(value => String(value || '').trim().replace(/^["']|["']$/g, '')))
  }

  function collectToolEvidenceIds(toolInput, toolName) {
    const strings = collectStrings(toolInput)
    const evidenceText = /apply[_-]?patch/i.test(toolName)
      ? strings.flatMap(value => String(value).split(/\r?\n/))
        .filter(line => /^\+(?!\+\+)/.test(line))
        .join('\n')
      : strings.join('\n')
    return unique((evidenceText.match(LEDGER_ID_RE) || []).map(value => value.toUpperCase()))
  }

  function resolveMutationPath(value, contextRoot) {
    const raw = String(value || '').trim()
    if (!raw || !contextRoot) return ''
    try {
      return path.normalize(path.isAbsolute(raw) ? raw : path.resolve(contextRoot, raw)).toLowerCase()
    } catch {
      return ''
    }
  }

  function inspectToolOutcome(payload) {
    const outcome = payload?.tool_response ?? payload?.toolResponse ?? payload?.tool_result ??
      payload?.toolResult ?? payload?.result
    if (outcome === undefined || outcome === null) return { observable: false, successful: false }
    if (outcome && typeof outcome === 'object') {
      const status = compactText(outcome.status || outcome.state).toLowerCase()
      const exitCode = outcome.exit_code ?? outcome.exitCode ?? outcome.code
      const failed = outcome.success === false || outcome.ok === false || outcome.is_error === true ||
        outcome.isError === true || !!outcome.error || status === 'error' || status === 'failed' ||
        (exitCode !== undefined && Number(exitCode) !== 0)
      return { observable: true, successful: !failed }
    }
    const text = compactText(outcome)
    const failed = /^(?:error|failed)\b/i.test(text) || /\bexit code\s*[:=]\s*[1-9]\d*\b/i.test(text)
    return { observable: true, successful: !failed }
  }

  function readLedgerIds(file) {
    try {
      if (!fs.statSync(file).isFile()) return []
      return unique((fs.readFileSync(file, 'utf8').match(LEDGER_ID_RE) || []).map(value => value.toUpperCase()))
    } catch {
      return []
    }
  }

  function observeGovernanceLedgerWrite(state, payload, options = {}) {
    if (!state || typeof state !== 'object') return []
    const governanceIntake = normalizeGovernanceIntakeState(state.governanceIntake)
    state.governanceIntake = governanceIntake
    const activeRoot = compactText(options.activeRoot)
    const contextRoot = compactText(options.contextRoot)
    const toolName = compactText(options.toolName || payload?.tool_name || payload?.toolName).toLowerCase()
    const eventName = compactText(options.eventName || payload?.hookEventName || payload?.hook_event_name)
    const outcome = inspectToolOutcome(payload)
    if (eventName.toLowerCase() !== 'posttooluse' || !activeRoot || !contextRoot ||
        !/(?:apply[_-]?patch|edit|write|create|update)/i.test(toolName)) return []

    const explicitPaths = collectExplicitMutationPaths(payload?.tool_input || payload?.toolInput || {})
    if (!explicitPaths.length) return []
    const resolvedPaths = explicitPaths.map(value => ({ raw: value, resolved: resolveMutationPath(value, contextRoot) }))
    const inputIds = collectToolEvidenceIds(payload?.tool_input || payload?.toolInput || {}, toolName)
    const observedAt = options.observedAt || new Date().toISOString()
    const observations = []

    for (const contract of LEDGER_CONTRACTS) {
      const expectedPath = path.normalize(path.join(activeRoot, 'data', contract.file)).toLowerCase()
      const target = resolvedPaths.find(item => item.resolved === expectedPath) ||
        resolvedPaths.find(item => item.resolved.endsWith(path.normalize(path.join('data', contract.file)).toLowerCase()))
      if (!target) continue
      const activeRootMatch = target.resolved === expectedPath
      const fileIds = activeRootMatch ? readLedgerIds(path.join(activeRoot, 'data', contract.file)) : []
      const evidenceIds = activeRootMatch && outcome.observable && outcome.successful
        ? inputIds.filter(id => fileIds.includes(id))
        : []
      observations.push({
        id: `GIO-${stableDigest(`${observedAt}|${target.resolved}|${inputIds.join(',')}`).toUpperCase()}`,
        observedAt,
        eventName,
        toolName,
        ledger: contract.ledger,
        ledgerPath: target.resolved,
        activeRootMatch,
        outcomeObservable: outcome.observable,
        successful: outcome.observable && outcome.successful,
        inputIds,
        fileIds,
        evidenceIds
      })
    }

    if (observations.length) {
      governanceIntake.ledgerObservations = [...governanceIntake.ledgerObservations, ...observations].slice(-100)
    }
    return observations
  }

  function validateNoneChallenge(decision) {
    const issues = []
    if (decision.recordIntents.length !== 1 || decision.recordIntents[0] !== 'record.none') issues.push('record.none must be exclusive')
    if (decision.assessmentVerdict !== 'no-governance-impact') issues.push('record.none requires no-governance-impact verdict')
    if (!GENERALIZATION_SCOPES.has(decision.generalizationScope)) issues.push('record.none generalization scope is invalid')
    if (!['project-local', 'none'].includes(decision.generalizationScope) && decision.existingRuleState !== 'exists-complete') {
      issues.push('record.none requires project-local/none scope or complete existing coverage')
    }
    if (!['exists-complete', 'not-applicable'].includes(decision.existingRuleState)) issues.push('record.none requires exists-complete or not-applicable rule state')
    if (!decision.confidence || compactText(decision.basis).length < 12) issues.push('record.none requires confidence and concrete basis')
    if (decision.targetLedgers.length || decision.writeEvidence.length || decision.writeRequirement !== 'none') issues.push('record.none cannot claim ledger write evidence')
    const skipEvidence = compactText(decision.skipEvidence)
    if (skipEvidence.length < 16 || /^(?:n\/?a|none|无|无需|普通问答)[。.!！]?$/i.test(skipEvidence)) issues.push('record.none requires concrete skipEvidence')
    if (skipEvidence === compactText(decision.basis)) issues.push('record.none basis and skipEvidence must be independently stated')
    return { valid: issues.length === 0, issues }
  }

  function validateWriteDecisionShape(decision) {
    const issues = []
    if (!ASSESSMENT_VERDICTS.has(decision.assessmentVerdict) || !GENERALIZATION_SCOPES.has(decision.generalizationScope) ||
        !EXISTING_RULE_STATES.has(decision.existingRuleState)) issues.push('assessment fields incomplete or invalid')
    if (decision.assessmentVerdict !== 'accepted') issues.push('write intents require assessmentVerdict=accepted')
    if (!decision.confidence || compactText(decision.basis).length < 8) issues.push('confidence or basis incomplete')
    if (!['required', 'already-recorded'].includes(decision.writeRequirement)) issues.push('writeRequirement must be required or already-recorded')
    if (!decision.recordIntents.length) issues.push('record intents missing')
    if (decision.recordIntents.some(intent => ['record.none', 'record.ambiguous'].includes(intent))) issues.push('none/ambiguous cannot mix with write intents')
    const contracts = decision.recordIntents.map(intent => INTENT_CONTRACT[intent]).filter(Boolean)
    if (contracts.length !== decision.recordIntents.length) issues.push('unknown record intent')
    const expectedLedgers = unique(contracts.map(contract => contract.ledger))
    if (decision.targetLedgers.length !== expectedLedgers.length || expectedLedgers.some(ledger => !decision.targetLedgers.includes(ledger))) {
      issues.push('target ledgers do not exactly match compound intents')
    }
    for (const contract of contracts) {
      if (!decision.writeEvidence.some(id => id.startsWith(contract.prefix))) issues.push(`${contract.prefix} evidence missing`)
    }
    if (decision.writeEvidence.some(id => !contracts.some(contract => id.startsWith(contract.prefix)))) issues.push('write evidence contains undeclared ledger prefix')
    return { valid: issues.length === 0, issues, contracts }
  }

  function observationAfterCandidate(observation, candidate) {
    const observedAt = Date.parse(observation.observedAt || '')
    const createdAt = Date.parse(candidate.createdAt || '')
    return !Number.isFinite(observedAt) || !Number.isFinite(createdAt) || observedAt >= createdAt
  }

  function verifyIntentEvidence(governanceIntake, candidate, decision, contract, activeRoot) {
    const ids = decision.writeEvidence.filter(id => id.startsWith(contract.prefix))
    if (!ids.length || !activeRoot) return { verified: false, ids: [], observationIds: [], reason: 'missing evidence IDs or active root' }
    if (decision.writeRequirement === 'already-recorded') {
      const fileIds = readLedgerIds(path.join(activeRoot, 'data', contract.file))
      const attemptedIds = new Set(governanceIntake.ledgerObservations
        .filter(observation => observation.ledger === contract.ledger && observationAfterCandidate(observation, candidate))
        .flatMap(observation => observation.inputIds || []))
      const verifiedIds = ids.filter(id => fileIds.includes(id) && !attemptedIds.has(id))
      const verified = verifiedIds.length === ids.length
      return { verified, ids: verifiedIds, observationIds: [], reason: verified ? '' : 'not every existing ID was found in the active-root ledger' }
    }
    const currentFileIds = readLedgerIds(path.join(activeRoot, 'data', contract.file))
    const matchingObservations = governanceIntake.ledgerObservations.filter(observation => (
      observation.ledger === contract.ledger &&
      observation.activeRootMatch === true &&
      observation.outcomeObservable === true &&
      observation.successful === true &&
      observationAfterCandidate(observation, candidate)
    ))
    const verifiedIds = ids.filter(id => currentFileIds.includes(id) && matchingObservations.some(observation => observation.evidenceIds.includes(id)))
    const observationIds = matchingObservations
      .filter(observation => verifiedIds.some(id => observation.evidenceIds.includes(id)))
      .map(observation => observation.id)
    const verified = verifiedIds.length === ids.length
    return {
      verified,
      ids: verifiedIds,
      observationIds,
      reason: verified ? '' : 'no successful exact active-root PostToolUse observation for every claimed ID'
    }
  }

  function visibleReplyResolvesGovernanceIntake(text, options = {}) {
    return requiresCoupledRecordRouterEvidence(text, options)
  }

  function requiresCoupledRecordRouterEvidence(content, options = {}) {
    const decision = parseGovernanceIntakeDecision(content)
    if (decision.recordIntents.includes('record.none')) {
      return validateNoneChallenge(decision).valid
    }
    if (decision.recordIntents.includes('record.ambiguous')) return false
    const shape = validateWriteDecisionShape(decision)
    if (!shape.valid || !options.governanceIntake || !options.candidate || !options.activeRoot) return false
    return shape.contracts.every(contract => verifyIntentEvidence(
      options.governanceIntake,
      options.candidate,
      decision,
      contract,
      options.activeRoot
    ).verified)
  }

  function resolveDecisionCandidate(governanceIntake, decision) {
    const unresolved = governanceIntake.candidates.filter(candidate => !candidate.terminal)
    if (!unresolved.length) return null
    const explicitId = compactText(decision.candidateAnchor).match(/\bGI-[A-Z0-9-]+\b/i)?.[0]
    if (explicitId) return unresolved.find(candidate => candidate.id.toLowerCase() === explicitId.toLowerCase()) || null
    if (unresolved.length === 1) return unresolved[0]
    return null
  }

  function updateGovernanceIntakeResolutionState(state, text, eventName, options = {}) {
    if (!state || typeof state !== 'object') return
    const governanceIntake = normalizeGovernanceIntakeState(state.governanceIntake)
    state.governanceIntake = governanceIntake
    if (!governanceIntake.pending) return
    const decision = parseGovernanceIntakeDecision(text)
    if (!decision.recordIntents.length && !decision.assessmentVerdict) return
    const candidate = resolveDecisionCandidate(governanceIntake, decision)
    if (!candidate) {
      governanceIntake.lastDecisionError = governanceIntake.candidates.filter(item => !item.terminal).length > 1
        ? 'multiple unresolved candidates require an exact candidate anchor'
        : 'candidate anchor does not match an unresolved candidate'
      return
    }

    candidate.assessmentVerdict = decision.assessmentVerdict
    candidate.generalizationScope = decision.generalizationScope
    candidate.existingRuleState = decision.existingRuleState
    candidate.recordIntents = decision.recordIntents
    candidate.intentStates = decision.recordIntents.map(intent => {
      const contract = INTENT_CONTRACT[intent]
      return {
        intent,
        targetLedger: contract?.ledger || '',
        claimedIds: contract ? decision.writeEvidence.filter(id => id.startsWith(contract.prefix)) : [],
        observationIds: [],
        status: 'pending',
        verificationState: 'unverified',
        evidenceIds: []
      }
    })
    candidate.targetLedgers = decision.targetLedgers
    candidate.writeRequirement = decision.writeRequirement
    candidate.writeEvidence = decision.writeEvidence
    candidate.skipEvidence = decision.skipEvidence
    candidate.decisionEvidence = decision.basis
    candidate.handledBy = eventName || 'visible-reply'
    transitionCandidatePhase(candidate, 'assessed')
    candidate.terminal = false
    candidate.handledAt = ''

    if (decision.recordIntents.includes('record.ambiguous') || decision.assessmentVerdict === 'uncertain') {
      candidate.verificationState = 'ambiguous'
      governanceIntake.lastDecisionError = 'ambiguous or uncertain assessment requires clarification and remains unresolved'
      syncCompatibilityMirrors(governanceIntake)
      return
    }

    if (GENERALIZATION_SCOPES.has(decision.generalizationScope) && EXISTING_RULE_STATES.has(decision.existingRuleState)) {
      transitionCandidatePhase(candidate, 'generalized')
    }

    if (decision.recordIntents.includes('record.none')) {
      transitionCandidatePhase(candidate, 'routed')
      const challenge = validateNoneChallenge(decision)
      if (challenge.valid) {
        transitionCandidatePhase(candidate, 'acknowledged')
        candidate.terminal = true
        candidate.verificationState = 'verified-none'
        candidate.intentStates = [{
          intent: 'record.none',
          targetLedger: '',
          claimedIds: [],
          observationIds: [],
          status: 'verified',
          verificationState: 'verified',
          evidenceIds: []
        }]
        candidate.handledAt = new Date().toISOString()
        governanceIntake.lastDecisionError = ''
      } else {
        candidate.verificationState = 'pending-none-challenge'
        governanceIntake.lastDecisionError = challenge.issues.join('; ')
      }
      syncCompatibilityMirrors(governanceIntake)
      return
    }

    const shape = validateWriteDecisionShape(decision)
    if (!shape.valid) {
      candidate.verificationState = 'unverified'
      governanceIntake.lastDecisionError = shape.issues.join('; ')
      syncCompatibilityMirrors(governanceIntake)
      return
    }
    transitionCandidatePhase(candidate, 'routed')

    const evidenceResults = shape.contracts.map((contract, index) => {
      const result = verifyIntentEvidence(governanceIntake, candidate, decision, contract, options.activeRoot)
      candidate.intentStates[index] = {
        intent: decision.recordIntents[index],
        targetLedger: contract.ledger,
        claimedIds: decision.writeEvidence.filter(id => id.startsWith(contract.prefix)),
        observationIds: result.observationIds,
        status: result.verified ? 'verified' : 'unverified',
        verificationState: result.verified ? 'verified' : 'unverified',
        evidenceIds: result.ids,
        reason: result.reason
      }
      return result
    })
    if (evidenceResults.every(result => result.verified)) {
      transitionCandidatePhase(candidate, 'write-observed')
      candidate.writeObservedAt = candidate.updatedAt
      transitionCandidatePhase(candidate, 'acknowledged')
      candidate.terminal = true
      candidate.verificationState = 'verified'
      candidate.handledAt = new Date().toISOString()
      governanceIntake.lastDecisionError = ''
    } else {
      candidate.verificationState = 'unverified'
      governanceIntake.lastDecisionError = evidenceResults.filter(result => !result.verified).map(result => result.reason).join('; ')
    }
    syncCompatibilityMirrors(governanceIntake)
  }

  function hasUnresolvedGovernanceIntakeCandidate(state) {
    return normalizeGovernanceIntakeState(state?.governanceIntake).pending
  }

  function buildGovernanceIntakeReminderItem(state) {
    const governanceIntake = normalizeGovernanceIntakeState(state?.governanceIntake)
    const unresolved = governanceIntake.candidates.filter(candidate => !candidate.terminal)
    if (!unresolved.length) return ''
    const anchors = unresolved.slice(-5).map(candidate => `${candidate.id}:${candidate.phase}/${candidate.verificationState}`)
    const decisionError = governanceIntake.lastDecisionError ? `；${governanceIntake.lastDecisionError}` : ''
    return `治理 intake 候选尚未完成语义评估、分流或落账验证（${anchors.join(', ')}${decisionError}；关键词不得作为权威分类依据）`
  }

  return {
    emptyGovernanceIntakeState,
    normalizeGovernanceIntakeState,
    buildGovernanceIntakeCandidate,
    registerGovernanceIntakeCandidate,
    buildGovernanceIntakeContextMessage,
    parseGovernanceIntakeDecision,
    observeGovernanceLedgerWrite,
    validateNoneChallenge,
    validateWriteDecisionShape,
    requiresCoupledRecordRouterEvidence,
    visibleReplyResolvesGovernanceIntake,
    updateGovernanceIntakeResolutionState,
    hasUnresolvedGovernanceIntakeCandidate,
    buildGovernanceIntakeReminderItem
  }
}

module.exports = { buildLifecycleGovernanceIntakeUtils }
