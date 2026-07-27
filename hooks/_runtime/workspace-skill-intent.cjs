'use strict'

/**
 * Workspace skill intent route (P0-1):
 * catalog + deterministic intent selection + resolve + inject.
 * Mode: intent (default) | legacy-token (word AutoMatch).
 */

const {
  buildWorkspaceSkillCatalog,
  formatCatalogForInject
} = require('./workspace-skill-catalog.cjs')
const {
  readDevcodexMdEntry,
  buildEntryInjection
} = require('./devcodex-md-entry.cjs')
const {
  resolveSkillRead,
  isReservedSkillId
} = require('./skill-resolution.cjs')
const {
  matchWorkspaceSkills,
  hasExplicitSkillInvoke,
  extractMustReply,
  parseFrontmatter,
  isSkillReplySatisfied,
  buildStopForceReason,
  toStateRecord: toAutoMatchState,
  normalizePrompt,
  extractLastAssistantMessage,
  looksLikeConnectivityPing
} = require('./workspace-skill-auto-match.cjs')

const MIN_INTENT_SCORE = 12
const MAX_INJECT_BYTES = 48 * 1024
const AUTHOR_SKILL_ID = 'workspace-skill-author'

function getSkillMatchMode(env = process.env) {
  const raw = String(env.DEVCODEX_SKILL_MATCH_MODE || 'intent').trim().toLowerCase()
  if (raw === 'legacy' || raw === 'legacy-token' || raw === 'token') return 'legacy-token'
  return 'intent'
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[，。！？、,.!?;:：；「」『』"'`]/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2)
}

function scoreIntentAgainstSkill(prompt, skill) {
  const cleaned = normalizePrompt(prompt)
  const tokens = tokenize(cleaned)
  if (!tokens.length) return { score: 0, reasons: ['empty-tokens'] }
  const hay = `${skill.skillId} ${skill.name} ${skill.summary} ${(skill.triggers || []).join(' ')}`.toLowerCase()
  let score = 0
  const reasons = []
  // exact id/name alone
  if (cleaned.toLowerCase() === skill.skillId.toLowerCase() || cleaned === skill.name) {
    return { score: 100, reasons: ['exact-id-or-name'] }
  }
  if (hasExplicitSkillInvoke(prompt, skill.skillId, skill.name)) {
    return { score: 100, reasons: ['explicit-invoke'] }
  }
  for (const t of skill.triggers || []) {
    if (cleaned === t || cleaned.toLowerCase() === String(t).toLowerCase()) {
      return { score: 95, reasons: [`trigger-exact:${t}`] }
    }
    if (cleaned.includes(t) && String(t).length >= 2) {
      score = Math.max(score, 70)
      reasons.push(`trigger-sub:${t}`)
    }
  }
  let hits = 0
  for (const t of tokens) {
    if (hay.includes(t)) {
      hits += 1
      // longer tokens weigh more
      score += Math.min(24, 4 + t.length)
    }
  }
  if (hits) reasons.push(`token-hits:${hits}`)
  // description soft: whole cleaned short phrase in summary
  if (cleaned.length >= 4 && cleaned.length <= 48 && hay.includes(cleaned.toLowerCase())) {
    score = Math.max(score, 55)
    reasons.push('summary-contains-prompt')
  }
  return { score, reasons }
}

/**
 * Deterministic intent selection (description/token overlap).
 * Used for CLI + UPS suggestedDecision + E2E without LLM.
 */
function selectSkillByIntent(prompt, catalog, options = {}) {
  const skills = (catalog && catalog.skills) || []
  const forceId = options.forceSkillId
  if (forceId) {
    const hit = skills.find(s => s.skillId === forceId)
    if (hit && !isReservedSkillId(forceId)) {
      return {
        schemaVersion: 'WorkspaceSkillIntentDecisionV1',
        skillId: forceId,
        confidence: 1,
        reasons: ['forced'],
        source: 'forced',
        catalogDigest: catalog.digest || null,
        score: 100
      }
    }
  }

  // explicit invoke scan
  for (const s of skills) {
    if (hasExplicitSkillInvoke(prompt, s.skillId, s.name)) {
      return {
        schemaVersion: 'WorkspaceSkillIntentDecisionV1',
        skillId: s.skillId,
        confidence: 1,
        reasons: ['explicit-invoke'],
        source: 'explicit-invoke',
        catalogDigest: catalog.digest || null,
        score: 100
      }
    }
  }

  let best = null
  let bestScore = 0
  let bestReasons = []
  for (const s of skills) {
    if (isReservedSkillId(s.skillId)) continue
    const { score, reasons } = scoreIntentAgainstSkill(prompt, s)
    if (score > bestScore) {
      bestScore = score
      best = s
      bestReasons = reasons
    }
  }

  const threshold = options.minScore != null ? options.minScore : MIN_INTENT_SCORE
  if (!best || bestScore < threshold) {
    return {
      schemaVersion: 'WorkspaceSkillIntentDecisionV1',
      skillId: null,
      confidence: 0,
      reasons: bestReasons.length ? bestReasons : ['below-threshold'],
      source: 'none',
      catalogDigest: catalog.digest || null,
      score: bestScore
    }
  }

  const confidence = Math.min(1, bestScore / 100)
  return {
    schemaVersion: 'WorkspaceSkillIntentDecisionV1',
    skillId: best.skillId,
    confidence,
    reasons: bestReasons,
    source: 'heuristic-intent',
    catalogDigest: catalog.digest || null,
    score: bestScore
  }
}

function validateIntentDecision(decision, catalog) {
  if (!decision || decision.schemaVersion !== 'WorkspaceSkillIntentDecisionV1') {
    return { ok: false, reason: 'invalid-schema' }
  }
  if (decision.skillId == null || decision.skillId === '') {
    return { ok: true, decision: { ...decision, skillId: null } }
  }
  if (isReservedSkillId(decision.skillId)) {
    return { ok: false, reason: 'reserved' }
  }
  const ids = new Set((catalog.skills || []).map(s => s.skillId))
  if (!ids.has(decision.skillId) && decision.source !== 'forced') {
    // allow author global id not in W catalog
    if (decision.skillId === AUTHOR_SKILL_ID) return { ok: true, decision }
    return { ok: false, reason: 'not-in-catalog' }
  }
  return { ok: true, decision }
}

function loadSkillBody(skillId, options = {}) {
  const { trace, content } = resolveSkillRead(skillId, {
    ...options,
    includeContent: true
  })
  if (!content || (trace.selectedLayer !== 'workspace' && trace.selectedLayer !== 'global')) {
    return { ok: false, trace, content: null }
  }
  // W skills for business; author may be global
  if (skillId !== AUTHOR_SKILL_ID && trace.selectedLayer !== 'workspace' && options.requireWorkspace) {
    return { ok: false, trace, content: null }
  }
  const parsed = parseFrontmatter(content)
  const mustReply = extractMustReply(parsed.body)
  return { ok: true, trace, content, mustReply, parsed }
}

function buildSkillBodyInjection(skillId, content, meta = {}) {
  let injectBody = content
  if (Buffer.byteLength(injectBody, 'utf8') > MAX_INJECT_BYTES) {
    injectBody = `${injectBody.slice(0, MAX_INJECT_BYTES)}\n\n…[truncated for inject budget]\n`
  }
  const must = meta.mustReply ? `【必须回复核心】${meta.mustReply}` : ''
  return [
    '### DevCodex · WorkspaceSkillIntent',
    `matchedSkillId: ${skillId}`,
    `source: ${meta.source || 'intent'}`,
    `score: ${meta.score != null ? meta.score : ''}`,
    `reasons: ${(meta.reasons || []).join(', ')}`,
    '',
    '【强制】本轮已按工作区 skill 意图路由选中下列规程。必须严格按 SKILL 正文执行；',
    '禁止当成连通性测试或通用 Ready 回复。',
    must,
    '',
    '----- BEGIN WORKSPACE SKILL -----',
    injectBody,
    '----- END WORKSPACE SKILL -----'
  ].filter(Boolean).join('\n')
}

function buildCatalogOnlyInjection(catalog, entry, decision) {
  return [
    buildEntryInjection(entry),
    formatCatalogForInject(catalog),
    '### DevCodex · Intent selection instructions',
    '1. Read DEVCODEX.md hard constraints and always-on notes.',
    '2. From the catalog only, pick 0 or 1 skill whose summary matches the user task intent.',
    '3. If you pick a skill, you MUST follow its full body once loaded (below if auto-selected).',
    '4. Do not invent skill ids outside the catalog.',
    decision && decision.skillId
      ? `5. SuggestedDecision: skillId=${decision.skillId} source=${decision.source} score=${decision.score}`
      : '5. SuggestedDecision: none (no high-confidence match); proceed without a workspace skill unless user explicit-invokes.',
    decision && decision.skillId
      ? ''
      : '6. If the user asks to create/edit a workspace skill or DEVCODEX.md, load global skill `workspace-skill-author` via resolve.'
  ].filter(Boolean).join('\n\n')
}

/**
 * Full intent route for one user prompt.
 * @returns {object} WorkspaceSkillIntentRouteResultV1
 */
function routeWorkspaceSkillIntent(prompt, options = {}) {
  const env = options.env || process.env
  const mode = getSkillMatchMode(env)

  if (mode === 'legacy-token') {
    const legacy = matchWorkspaceSkills(prompt, options)
    return {
      schemaVersion: 'WorkspaceSkillIntentRouteResultV1',
      mode: 'legacy-token',
      matched: legacy.matched,
      skillId: legacy.skillId,
      decision: {
        schemaVersion: 'WorkspaceSkillIntentDecisionV1',
        skillId: legacy.skillId,
        confidence: legacy.matched ? Math.min(1, (legacy.score || 0) / 100) : 0,
        reasons: legacy.reasons || [],
        source: legacy.matched ? 'legacy-token' : 'none',
        catalogDigest: null,
        score: legacy.score || 0
      },
      catalog: null,
      entry: null,
      injectionText: legacy.injectionText || '',
      mustReply: legacy.mustReply || '',
      content: legacy.content || null,
      selectedLayer: legacy.selectedLayer,
      selectedPath: legacy.selectedPath,
      digest: legacy.digest,
      legacy
    }
  }

  const entry = readDevcodexMdEntry(options.cwd, options)
  const catalog = buildWorkspaceSkillCatalog(options)
  let decision = options.oracleDecision
    ? options.oracleDecision
    : selectSkillByIntent(prompt, catalog, options)

  // author skill: if prompt asks to write skills and no W match, point to global author
  if (!decision.skillId && /写\s*(一个)?\s*(workspace\s*)?skill|编写\s*skill|DEVCODEX\.md|创建\s*skill|skill\s*author|优化\s*description/i.test(String(prompt || ''))) {
    decision = {
      schemaVersion: 'WorkspaceSkillIntentDecisionV1',
      skillId: AUTHOR_SKILL_ID,
      confidence: 0.85,
      reasons: ['author-intent-heuristic'],
      source: 'author-heuristic',
      catalogDigest: catalog.digest,
      score: 85
    }
  }

  const validated = validateIntentDecision(decision, catalog)
  if (!validated.ok && decision.skillId !== AUTHOR_SKILL_ID) {
    decision = {
      ...decision,
      skillId: null,
      source: 'none',
      reasons: [...(decision.reasons || []), `invalid:${validated.reason}`]
    }
  }

  const alwaysOnIds = entry.alwaysOn || []
  let bodyInjection = ''
  let content = null
  let mustReply = ''
  let selectedLayer = null
  let selectedPath = null
  let digest = null
  let matched = false

  if (decision.skillId) {
    const loaded = loadSkillBody(decision.skillId, {
      ...options,
      requireWorkspace: decision.skillId !== AUTHOR_SKILL_ID
    })
    if (loaded.ok) {
      matched = true
      content = loaded.content
      mustReply = loaded.mustReply || ''
      selectedLayer = loaded.trace.selectedLayer
      selectedPath = loaded.trace.selectedPath
      digest = loaded.trace.digest
      bodyInjection = buildSkillBodyInjection(decision.skillId, loaded.content, {
        source: decision.source,
        score: decision.score,
        reasons: decision.reasons,
        mustReply
      })
    } else {
      decision = {
        ...decision,
        skillId: null,
        source: 'none',
        reasons: [...(decision.reasons || []), 'resolve-failed']
      }
    }
  }

  // always-on: append short note (not full bodies unless small)
  let alwaysOnNote = ''
  if (alwaysOnIds.length) {
    alwaysOnNote = [
      '### DevCodex · always-on skills (from DEVCODEX.md)',
      alwaysOnIds.map(id => `- ${id}`).join('\n'),
      'If listed and present under workspace/skills, honor their constraints this turn.'
    ].join('\n')
  }

  const catalogBlock = buildCatalogOnlyInjection(catalog, entry, decision)
  const injectionText = [catalogBlock, alwaysOnNote, bodyInjection].filter(Boolean).join('\n\n')

  return {
    schemaVersion: 'WorkspaceSkillIntentRouteResultV1',
    mode: 'intent',
    matched,
    skillId: decision.skillId,
    decision,
    catalog,
    entry,
    injectionText,
    mustReply,
    content,
    selectedLayer,
    selectedPath,
    digest,
    alwaysOn: alwaysOnIds
  }
}

function toIntentStateRecord(routeResult, extra = {}) {
  if (!routeResult) return null
  return {
    schemaVersion: 'WorkspaceSkillIntentStateV1',
    mode: routeResult.mode,
    skillId: routeResult.skillId || null,
    matched: Boolean(routeResult.matched),
    mustReply: routeResult.mustReply || '',
    injectionText: routeResult.injectionText || '',
    decision: routeResult.decision || null,
    digest: routeResult.digest || null,
    selectedPath: routeResult.selectedPath || null,
    enforceCount: 0,
    satisfied: false,
    matchedAt: new Date().toISOString(),
    ...extra
  }
}

function isIntentReplySatisfied(assistantText, stateOrRoute) {
  const skillId = stateOrRoute.skillId
  const mustReply = stateOrRoute.mustReply
  const content = stateOrRoute.content || stateOrRoute.injectionText
  if (!skillId) return true
  return isSkillReplySatisfied(assistantText, {
    matched: true,
    skillId,
    mustReply,
    content
  })
}

function buildIntentStopForceReason(stateOrRoute) {
  const matchLike = {
    matched: true,
    skillId: stateOrRoute.skillId,
    mustReply: stateOrRoute.mustReply,
    injectionText: stateOrRoute.injectionText,
    content: stateOrRoute.content || stateOrRoute.injectionText
  }
  return buildStopForceReason(matchLike).replace(
    /WorkspaceSkillAutoMatch/g,
    'WorkspaceSkillIntent'
  )
}

module.exports = {
  MIN_INTENT_SCORE,
  MAX_INJECT_BYTES,
  AUTHOR_SKILL_ID,
  getSkillMatchMode,
  selectSkillByIntent,
  validateIntentDecision,
  routeWorkspaceSkillIntent,
  loadSkillBody,
  buildSkillBodyInjection,
  buildCatalogOnlyInjection,
  toIntentStateRecord,
  isIntentReplySatisfied,
  buildIntentStopForceReason,
  tokenize,
  scoreIntentAgainstSkill,
  // re-export helpers used by lifecycle/cli
  extractLastAssistantMessage,
  looksLikeConnectivityPing,
  toAutoMatchState
}
