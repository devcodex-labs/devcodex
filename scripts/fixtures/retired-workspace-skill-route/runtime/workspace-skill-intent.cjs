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
/** Global probe skill: verify G load + one-line receipt (not reserved). */
const VERIFY_SKILL_ID = 'skill-load-verify'

function isGlobalInjectableSkillId (skillId) {
  return skillId === AUTHOR_SKILL_ID || skillId === VERIFY_SKILL_ID
}

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
    // allow known global injectables not in W catalog
    if (isGlobalInjectableSkillId(decision.skillId)) return { ok: true, decision }
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
  // W skills for business; author / skill-load-verify may be global
  if (!isGlobalInjectableSkillId(skillId) && trace.selectedLayer !== 'workspace' && options.requireWorkspace) {
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
    `loadingSkillId: ${skillId}`,
    `source: ${meta.source || 'intent'}`,
    `score: ${meta.score != null ? meta.score : ''}`,
    `reasons: ${(meta.reasons || []).join(', ')}`,
    '',
    `【过程文案】若宿主显示步骤/思考过程，写「正在加载 ${skillId} 技能」；不要写「命中 … 正在读取并按该技能执行」。`,
    '【隐私】禁止 List/扫描用户主目录下的 .grok/skills、.grok/bundled/skills、.claude/skills、.agents/skills 等宿主 skill 树（会暴露 C:\\Users\\… 路径）。只读已给出的单文件 SKILL 正文。',
    '【强制】本轮已加载下列 skill 规程，必须严格按 SKILL 正文执行；',
    '禁止当成连通性测试或通用 Ready 回复。',
    '最终用户可见正文不要加 DevCodex 技能元信息行。',
    must,
    '',
    '----- BEGIN SKILL -----',
    injectBody,
    '----- END SKILL -----'
  ].filter(Boolean).join('\n')
}

/**
 * SkillLoadReceipt user-visible lines are retired.
 * Visibility: host process timeline (Skill/tool events) + probe skill `skill-load-verify`
 * (must-reply SKILL-LOAD-VERIFY-OK). Do not force 【DevCodex 技能】 into final replies.
 */
function formatSkillLoadLine (_options = {}) {
  return null
}

function hasLoadedSkillsForReceipt (_options = {}) {
  return false
}

function buildSkillLoadReceipt (_options = {}) {
  return ''
}

function hasSkillLoadReceiptInReply (_assistantText) {
  return false
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
      : '6. If the user asks to create/edit a workspace skill or DEVCODEX.md, load global skill `workspace-skill-author` via resolve.',
    '7. Do not print a user-visible DevCodex skill meta receipt line in the final reply. In process/thinking steps prefer wording like「正在加载 <id> 技能」(not「命中…正在读取并按该技能执行」). Probe with global skill `skill-load-verify` (must-reply SKILL-LOAD-VERIFY-OK only).'
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
      skillLoadReceiptRequired: false,
      skillLoadReceipt: '',
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

  // global verify skill: dedicated probe for load + one-line receipt
  if (!decision.skillId && /验证\s*(一下)?\s*(技能|skill)|技能\s*加载\s*验证|skill[-\s]?load[-\s]?verify|用\s+skill-load-verify|ping\s+skill-load-verify|验证技能加载/i.test(String(prompt || ''))) {
    decision = {
      schemaVersion: 'WorkspaceSkillIntentDecisionV1',
      skillId: VERIFY_SKILL_ID,
      confidence: 0.95,
      reasons: ['verify-intent-heuristic'],
      source: 'verify-heuristic',
      catalogDigest: catalog.digest,
      score: 95
    }
  }

  const validated = validateIntentDecision(decision, catalog)
  if (!validated.ok && !isGlobalInjectableSkillId(decision.skillId)) {
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
      requireWorkspace: !isGlobalInjectableSkillId(decision.skillId)
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
  const injectionText = [catalogBlock, alwaysOnNote, bodyInjection]
    .filter(Boolean)
    .join('\n\n')

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
    alwaysOn: alwaysOnIds,
    skillLoadReceiptRequired: false,
    skillLoadReceipt: ''
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
    skillLoadReceiptRequired: Boolean(routeResult.skillLoadReceiptRequired),
    skillLoadReceipt: routeResult.skillLoadReceipt || '',
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
  // No user-visible skill meta line. Only skill body / mustReply when a skill matched.
  if (!skillId) return true
  return isSkillReplySatisfied(assistantText, {
    matched: true,
    skillId,
    mustReply,
    content
  })
}

function buildIntentStopForceReason(stateOrRoute) {
  if (!stateOrRoute.skillId) {
    return 'DevCodex WorkspaceSkillIntent: no matched skill to re-enforce.'
  }
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
  VERIFY_SKILL_ID,
  isGlobalInjectableSkillId,
  getSkillMatchMode,
  selectSkillByIntent,
  validateIntentDecision,
  routeWorkspaceSkillIntent,
  loadSkillBody,
  buildSkillBodyInjection,
  buildCatalogOnlyInjection,
  buildSkillLoadReceipt,
  formatSkillLoadLine,
  hasLoadedSkillsForReceipt,
  hasSkillLoadReceiptInReply,
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
