'use strict'

/**
 * WorkspaceSkillAutoMatch (PF-213 / P0.5 user-visible closed loop).
 * Message → match W skill name/description/id → resolve body → inject / Stop force.
 * Does not scan global skills for auto-trigger (W only). Reserved ids never match.
 */

const fs = require('fs')
const path = require('path')

const {
  isReservedSkillId,
  isValidSkillId,
  isWorkspaceSkillsEnabled,
  resolveSkillRead,
  resolveWorkspaceSkillsRoot,
  findSkillMarkdown
} = require('./skill-resolution.cjs')

const MAX_LIST = 64
const MAX_INJECT_BYTES = 48 * 1024
const MIN_MATCH_SCORE = 40

function parseFrontmatter(raw) {
  const text = String(raw || '')
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { frontmatter: {}, body: text, raw: text }
  const fm = {}
  let key = null
  let buf = []
  const flush = () => {
    if (!key) return
    const value = buf.join('\n').replace(/^\s+/, '').trim()
    fm[key] = value
    key = null
    buf = []
  }
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
    if (kv) {
      flush()
      key = kv[1]
      const rest = kv[2]
      if (rest === '' || rest === '|' || rest === '>') {
        buf = []
      } else {
        fm[key] = rest.replace(/^['"]|['"]$/g, '').trim()
        key = null
        buf = []
      }
      continue
    }
    if (key && (/^\s+/.test(line) || line.trim() === '')) {
      buf.push(line.replace(/^\s{2}/, ''))
      continue
    }
    if (key) flush()
  }
  flush()
  return { frontmatter: fm, body: m[2] || '', raw: text }
}

function extractQuotedTriggers(description) {
  const text = String(description || '')
  const out = []
  const patterns = [
    /「([^」]{1,40})」/g,
    /『([^』]{1,40})』/g,
    /"([^"]{1,40})"/g,
    /'([^']{1,40})'/g,
    /“([^”]{1,40})”/g,
    /‘([^’]{1,40})’/g
  ]
  for (const re of patterns) {
    let m
    while ((m = re.exec(text)) !== null) {
      const t = String(m[1] || '').trim()
      if (t && !out.includes(t)) out.push(t)
    }
  }
  return out
}

function extractMustReply(body) {
  const text = String(body || '')
  const section = text.match(/##\s*必须回复[^\n]*\r?\n([\s\S]*?)(?=\r?\n##\s|\s*$)/i)
  if (section) {
    const lines = section[1]
      .split(/\r?\n/)
      .map(l => l.replace(/^[-*]\s*/, '').trim())
      .filter(l => l && !l.startsWith('#') && !/^不要|^仅此/.test(l))
    if (lines.length) return lines[0]
  }
  const fixed = text.match(/(?:固定话术|必须回复|仅此)[：:]\s*([^\r\n]+)/i)
  if (fixed) return fixed[1].trim()
  return ''
}

function normalizePrompt(prompt) {
  return String(prompt || '')
    .replace(/@rocky\b/gi, ' ')
    .replace(/[，。！？、,.!?;:：；]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function wordBoundaryHit(haystack, needle) {
  const h = String(haystack || '')
  const n = String(needle || '').trim()
  if (!n) return false
  // CJK / short tokens: substring with non-alnum boundaries
  if (/[\u4e00-\u9fff]/.test(n) || n.length <= 3) {
    const re = new RegExp(`(?:^|[^A-Za-z0-9_])${escapeRe(n)}(?:$|[^A-Za-z0-9_])`, 'i')
    return re.test(h)
  }
  const re = new RegExp(`(?:^|[^A-Za-z0-9_.-])${escapeRe(n)}(?:$|[^A-Za-z0-9_.-])`, 'i')
  return re.test(h)
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function looksLikeConnectivityPing(text) {
  return /^(ready|pong|ok|在的?|收到|hello|hi)\b|systems?\s+are\s+up|连通|链路正常|ping\s*ok/i.test(
    String(text || '').trim()
  )
}

function extractLastAssistantMessage(payload) {
  if (!payload || typeof payload !== 'object') return ''
  const direct = payload.lastAssistantMessage || payload.last_assistant_message || payload.assistantMessage
  if (typeof direct === 'string' && direct.trim()) return direct
  if (payload.message && typeof payload.message.content === 'string') return payload.message.content
  if (Array.isArray(payload.message?.content)) {
    return payload.message.content.map(p => (typeof p === 'string' ? p : p?.text || '')).join('\n')
  }
  if (typeof payload.response === 'string') return payload.response
  return ''
}

/**
 * List workspace skill candidates (frontmatter only when possible).
 */
function listWorkspaceSkillCandidates(options = {}) {
  const fsImpl = options.fs || fs
  const env = options.env || process.env
  if (!isWorkspaceSkillsEnabled(env)) return []
  const root = resolveWorkspaceSkillsRoot(options.cwd, options)
  if (!root || !fsImpl.existsSync(root)) return []
  let names = []
  try {
    names = fsImpl.readdirSync(root)
  } catch {
    return []
  }
  const out = []
  for (const name of names) {
    if (out.length >= MAX_LIST) break
    if (!isValidSkillId(name) || isReservedSkillId(name)) continue
    const dir = path.join(root, name)
    let isDir = false
    try {
      isDir = fsImpl.statSync(dir).isDirectory()
    } catch {
      continue
    }
    if (!isDir) continue
    const hit = findSkillMarkdown(dir, fsImpl)
    if (!hit.path) continue
    let raw = ''
    try {
      raw = fsImpl.readFileSync(hit.path, 'utf8')
    } catch {
      continue
    }
    // Only read full body later via resolve; parse frontmatter now
    const head = raw.slice(0, 8 * 1024)
    const parsed = parseFrontmatter(head.includes('---') ? head : raw)
    const skillName = String(parsed.frontmatter.name || name).trim()
    const description = String(parsed.frontmatter.description || '').trim()
    out.push({
      skillId: name,
      name: skillName,
      description,
      triggers: extractQuotedTriggers(description),
      path: hit.path
    })
  }
  return out
}

/**
 * Short / ambiguous skill ids (e.g. test) must not fire from long task sentences (C1.1).
 * Allow: exact, short alone prompt, quoted trigger alone, or explicit "use skill X".
 */
function isAmbiguousShortToken(token) {
  const t = String(token || '').trim()
  if (!t) return false
  if (t.length <= 4) return true
  return /^(tests?|demo|tmp|temp|ok|hi|ping|foo|bar|baz|sample)$/i.test(t)
}

function isShortAlonePrompt(cleaned, id, name) {
  const text = String(cleaned || '').trim()
  if (!text) return false
  const tokens = text.split(/\s+/).filter(Boolean)
  const maxLen = Math.max(String(name || '').length, String(id || '').length, 4)
  // 1–2 tokens and not a long sentence; e.g. "test", "测试", "@rocky test" → after normalize "test"
  if (tokens.length <= 2 && text.length <= maxLen + 16) return true
  // single CJK trigger phrase
  if (tokens.length === 1 && /[\u4e00-\u9fff]/.test(text) && text.length <= 8) return true
  return false
}

function hasExplicitSkillInvoke(raw, id, name) {
  const text = String(raw || '')
  // "用 test skill" / "用 skill test" / "workspace skill test" / "加载 skill X"
  const invokeShape = /(?:用|加载|执行)\s+(?:workspace\s+)?skill\b|(?:用|加载|执行)\s+\S+\s+skill\b|workspace\s*skill|skill\s*[:=]/i.test(text)
  if (!invokeShape) return false
  const cleaned = normalizePrompt(text)
  return wordBoundaryHit(cleaned, id) || wordBoundaryHit(cleaned, name)
}

/**
 * Score a single candidate against user prompt.
 * @returns {{ score: number, reasons: string[] }}
 */
function scoreCandidate(prompt, candidate) {
  const raw = String(prompt || '')
  const cleaned = normalizePrompt(raw)
  const reasons = []
  let score = 0
  if (!cleaned) return { score: 0, reasons: ['empty-prompt'] }

  const id = candidate.skillId
  const name = candidate.name || id
  const alone = isShortAlonePrompt(cleaned, id, name)
  const idAmbiguous = isAmbiguousShortToken(id)
  const nameAmbiguous = isAmbiguousShortToken(name)

  if (cleaned.toLowerCase() === id.toLowerCase() || cleaned === name) {
    score = Math.max(score, 100)
    reasons.push('exact-id-or-name')
  } else if (wordBoundaryHit(cleaned, id)) {
    // C1.1: short id in long sentences does not auto-match
    if (alone || !idAmbiguous) {
      score = Math.max(score, alone ? 90 : (idAmbiguous ? 0 : 55))
      if (score >= MIN_MATCH_SCORE) reasons.push(alone ? 'id-token-alone' : 'id-token')
      else if (idAmbiguous && !alone) reasons.push('id-token-suppressed-long-prompt')
    } else {
      reasons.push('id-token-suppressed-long-prompt')
    }
  } else if (wordBoundaryHit(cleaned, name) && name.toLowerCase() !== id.toLowerCase()) {
    if (alone || !nameAmbiguous) {
      score = Math.max(score, alone ? 85 : (nameAmbiguous ? 0 : 50))
      if (score >= MIN_MATCH_SCORE) reasons.push(alone ? 'name-token-alone' : 'name-token')
      else if (nameAmbiguous && !alone) reasons.push('name-token-suppressed-long-prompt')
    } else {
      reasons.push('name-token-suppressed-long-prompt')
    }
  }

  for (const t of candidate.triggers || []) {
    const tAmbiguous = isAmbiguousShortToken(t) || t.length <= 4
    if (cleaned === t || cleaned.toLowerCase() === t.toLowerCase()) {
      score = Math.max(score, 95)
      reasons.push(`trigger-exact:${t}`)
    } else if (wordBoundaryHit(cleaned, t)) {
      if (alone || !tAmbiguous) {
        const next = alone ? 88 : (tAmbiguous ? 0 : 50)
        if (next >= MIN_MATCH_SCORE) {
          score = Math.max(score, next)
          reasons.push(alone ? `trigger-alone:${t}` : `trigger-token:${t}`)
        } else if (tAmbiguous && !alone) {
          reasons.push(`trigger-suppressed-long-prompt:${t}`)
        }
      } else {
        reasons.push(`trigger-suppressed-long-prompt:${t}`)
      }
    }
  }

  // Explicit invoke always allowed when skill id/name present
  if (hasExplicitSkillInvoke(raw, id, name)) {
    score = Math.max(score, 92)
    reasons.push('explicit-invoke')
  }

  // Description keyword soft match only when prompt is short alone (avoid false positives)
  if (score < MIN_MATCH_SCORE && alone && cleaned.length >= 2 && cleaned.length <= 24) {
    const desc = String(candidate.description || '').toLowerCase()
    if (desc && desc.includes(cleaned.toLowerCase()) && cleaned.length >= 2) {
      score = Math.max(score, 45)
      reasons.push('description-contains-prompt')
    }
  }

  return { score, reasons }
}

/**
 * Match prompt → best workspace skill + resolved content.
 * @returns {object} WorkspaceSkillAutoMatchResultV1
 */
function matchWorkspaceSkills(prompt, options = {}) {
  const env = options.env || process.env
  const base = {
    schemaVersion: 'WorkspaceSkillAutoMatchResultV1',
    matched: false,
    skillId: null,
    score: 0,
    reasons: [],
    selectedLayer: null,
    selectedPath: null,
    digest: null,
    content: null,
    mustReply: '',
    injectionText: '',
    candidatesScanned: 0,
    enabled: isWorkspaceSkillsEnabled(env)
  }

  if (!base.enabled) {
    base.reasons = ['kill-switch']
    return base
  }

  const cleaned = normalizePrompt(prompt)
  if (!cleaned) {
    base.reasons = ['empty-prompt']
    return base
  }

  const candidates = listWorkspaceSkillCandidates(options)
  base.candidatesScanned = candidates.length
  if (!candidates.length) {
    base.reasons = ['no-workspace-skills']
    return base
  }

  let best = null
  let bestScore = 0
  let bestReasons = []
  for (const c of candidates) {
    const { score, reasons } = scoreCandidate(prompt, c)
    if (score > bestScore) {
      bestScore = score
      best = c
      bestReasons = reasons
    }
  }

  if (!best || bestScore < MIN_MATCH_SCORE) {
    base.score = bestScore
    base.reasons = bestReasons.length ? bestReasons : ['below-threshold']
    return base
  }

  const { trace, content } = resolveSkillRead(best.skillId, {
    ...options,
    includeContent: true
  })

  if (trace.selectedLayer !== 'workspace' || !content) {
    return {
      ...base,
      skillId: best.skillId,
      score: bestScore,
      reasons: [...bestReasons, `resolve-${trace.selectedLayer || 'missing'}`, trace.reasonCode || ''],
      selectedLayer: trace.selectedLayer,
      selectedPath: trace.selectedPath
    }
  }

  const parsed = parseFrontmatter(content)
  const mustReply = extractMustReply(parsed.body)
  let injectBody = content
  if (Buffer.byteLength(injectBody, 'utf8') > MAX_INJECT_BYTES) {
    injectBody = injectBody.slice(0, MAX_INJECT_BYTES) + '\n\n…[truncated for inject budget]\n'
  }

  const injectionText = [
    '### DevCodex · WorkspaceSkillAutoMatch',
    `matchedSkillId: ${best.skillId}`,
    `selectedLayer: workspace`,
    `score: ${bestScore}`,
    `reasons: ${bestReasons.join(', ')}`,
    '',
    '【强制】本轮用户消息已匹配工作区自定义 Skill。你必须严格按下列 SKILL 正文执行；',
    '禁止当成连通性测试、@rocky 闲聊或通用 Ready 回复。',
    mustReply ? `【必须回复核心】${mustReply}` : '',
    '',
    '----- BEGIN WORKSPACE SKILL -----',
    injectBody,
    '----- END WORKSPACE SKILL -----'
  ].filter(Boolean).join('\n')

  return {
    ...base,
    matched: true,
    skillId: best.skillId,
    score: bestScore,
    reasons: bestReasons,
    selectedLayer: 'workspace',
    selectedPath: trace.selectedPath,
    digest: trace.digest,
    content,
    mustReply,
    injectionText
  }
}

/**
 * Whether assistant already satisfied the matched skill.
 */
function isSkillReplySatisfied(assistantText, matchResult) {
  const text = String(assistantText || '').trim()
  if (!text || !matchResult?.matched) return false
  if (matchResult.mustReply) {
    return text.includes(matchResult.mustReply)
  }
  // No fixed phrase: reject obvious connectivity pings on short pure triggers
  if (looksLikeConnectivityPing(text)) return false
  // Accept if assistant quoted skill path or skill id with non-trivial length
  if (matchResult.skillId && text.includes(matchResult.skillId) && text.length > 40) return true
  // Accept non-ping replies longer than a greeting for short triggers
  if (text.length >= 8 && !looksLikeConnectivityPing(text)) {
    // Prefer body fingerprint: first non-heading content line from skill
    const body = String(matchResult.content || '')
    const parsed = parseFrontmatter(body)
    const fingerprint = parsed.body
      .split(/\r?\n/)
      .map(l => l.trim())
      .find(l => l && !l.startsWith('#') && !l.startsWith('---') && l.length >= 4)
    if (fingerprint && text.includes(fingerprint.slice(0, Math.min(24, fingerprint.length)))) {
      return true
    }
  }
  return false
}

/**
 * Build Stop force reason (fed back to model as continuation).
 */
function buildStopForceReason(matchResult) {
  if (!matchResult?.matched) return ''
  const core = matchResult.mustReply
    ? `必须只回复：${matchResult.mustReply}`
    : '必须严格按 skill 正文执行，不得 Ready/连通闲聊。'
  return [
    `DevCodex WorkspaceSkillAutoMatch: 你的上一轮回复未遵守已匹配的工作区 skill「${matchResult.skillId}」。`,
    core,
    '请重新回复；忽略连通性/闲聊默认话术。',
    '',
    matchResult.injectionText || ''
  ].join('\n')
}

function toStateRecord(matchResult, extra = {}) {
  if (!matchResult?.matched) return null
  return {
    schemaVersion: 'WorkspaceSkillAutoMatchStateV1',
    skillId: matchResult.skillId,
    score: matchResult.score,
    reasons: matchResult.reasons,
    selectedPath: matchResult.selectedPath,
    digest: matchResult.digest,
    mustReply: matchResult.mustReply || '',
    injectionText: matchResult.injectionText || '',
    enforceCount: 0,
    satisfied: false,
    matchedAt: new Date().toISOString(),
    ...extra
  }
}

module.exports = {
  MIN_MATCH_SCORE,
  MAX_INJECT_BYTES,
  parseFrontmatter,
  extractQuotedTriggers,
  extractMustReply,
  listWorkspaceSkillCandidates,
  scoreCandidate,
  matchWorkspaceSkills,
  isSkillReplySatisfied,
  buildStopForceReason,
  toStateRecord,
  looksLikeConnectivityPing,
  normalizePrompt,
  extractLastAssistantMessage,
  isAmbiguousShortToken,
  isShortAlonePrompt,
  hasExplicitSkillInvoke
}
