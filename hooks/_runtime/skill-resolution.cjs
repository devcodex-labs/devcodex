'use strict'

/**
 * Workspace skill resolution Owner (S2).
 * Single algorithm for W/G path selection; consumers must honor content/digest binding.
 */

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  findLayoutInfo
} = require('./workspace-layout.cjs')

const RESERVED_SKILL_IDS = Object.freeze(new Set([
  'compliance',
  'cp-gate',
  'intent',
  'token-check',
  'user-visible-output-contract',
  'host-capability-routing',
  'execution-contract',
  'repair-prevention-assessment'
]))

const MAX_SKILL_BYTES = 256 * 1024

const WEAKEN_PATTERNS = Object.freeze([
  /跳过\s*S0[1-7]/i,
  /disable\s*S0[1-7]/i,
  /skip\s*S0[1-7]/i,
  /S0[1-7]\s*not\s*required/i,
  /override\s*S0[1-7]/i,
  /跳过\s*PC0/i,
  /不用入口检查/,
  /跳过\s*CP\s*[123]/i,
  /skip\s*cp[- ]?gate/i,
  /merge\s*CP\s*1\s*CP\s*2/i,
  /允许\s*rm\s*-rf/i,
  /无需确认删除/,
  /无需预览\s*DROP/i,
  /skip\s*destructive\s*confirm/i
])

function nowIso(clock) {
  if (typeof clock === 'function') return clock()
  return new Date().toISOString()
}

function portable(filePath) {
  return path.resolve(filePath).replace(/\\/g, '/')
}

function isWorkspaceSkillsEnabled(env = process.env) {
  const raw = String(env.DEVCODEX_WORKSPACE_SKILLS ?? '1').trim().toLowerCase()
  return !(raw === '0' || raw === 'false' || raw === 'off' || raw === 'no')
}

function isReservedSkillId(skillId) {
  return RESERVED_SKILL_IDS.has(String(skillId || '').trim())
}

function isValidSkillId(skillId) {
  const id = String(skillId || '').trim()
  if (!id) return false
  if (id.includes('..') || id.includes('/') || id.includes('\\')) return false
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) return false
  return true
}

function resolveHome(options = {}) {
  const env = options.env || process.env
  return path.resolve(options.home || env.DEVCODEX_TEST_HOME || env.USERPROFILE || env.HOME || os.homedir())
}

function resolveSkillsDeployModeLocal (env = process.env, options = {}) {
  const raw = String(options.skillsDeployMode || env.DEVCODEX_SKILLS_DEPLOY_MODE || '').trim().toLowerCase()
  if (raw === 'legacy' || raw === 'legacy-full-tree' || raw === 'visible') return 'legacy'
  if (raw === 'hidden' || raw === 'hook-only-hidden') return 'hidden'
  // default hidden (SkillsDeployModeV1)
  if (!raw) return 'hidden'
  return 'hidden'
}

function resolveGlobalSkillsRoot(options = {}) {
  const env = options.env || process.env
  // Explicit override always wins (tests / advanced users); doctor warns if mode=hidden but this points at scan root.
  if (env.DEVCODEX_GLOBAL_SKILLS_ROOT) {
    return path.resolve(env.DEVCODEX_GLOBAL_SKILLS_ROOT)
  }
  if (options.globalSkillsRoot) {
    return path.resolve(options.globalSkillsRoot)
  }
  const home = resolveHome(options)
  const shared = env.DEVCODEX_GLOBAL_SHARED_ROOT
    ? path.resolve(env.DEVCODEX_GLOBAL_SHARED_ROOT)
    : path.join(home, '.agents')
  const mode = resolveSkillsDeployModeLocal(env, options)
  if (mode === 'legacy') {
    return path.join(shared, 'skills')
  }
  // hidden → G_RUNTIME
  if (env.DEVCODEX_GLOBAL_SKILLS_RUNTIME) {
    return path.resolve(env.DEVCODEX_GLOBAL_SKILLS_RUNTIME)
  }
  return path.join(shared, 'devcodex', 'skills')
}

function resolveWorkspaceSkillsRoot(cwdOrRoot, options = {}) {
  const fsImpl = options.fs || fs
  if (options.workspaceRoot) {
    return path.join(path.resolve(options.workspaceRoot), '.devcodex', 'workspace', 'skills')
  }
  const cwd = path.resolve(cwdOrRoot || options.cwd || process.cwd())
  const layout = typeof options.findLayoutInfo === 'function'
    ? options.findLayoutInfo(cwd)
    : findLayoutInfo(cwd)
  if (!layout || layout.enabled !== true || String(layout.mode || '') !== 'workspace-namespace') {
    return null
  }
  const root = path.join(layout.workspaceRoot, '.devcodex', 'workspace', 'skills')
  return root
}

function realpathExistingPrefix(targetPath, fsImpl = fs) {
  const resolved = path.resolve(targetPath)
  const missing = []
  let cursor = resolved
  while (!fsImpl.existsSync(cursor)) {
    const parent = path.dirname(cursor)
    if (parent === cursor) return resolved
    missing.unshift(path.basename(cursor))
    cursor = parent
  }
  let realRoot
  try {
    realRoot = fsImpl.realpathSync(cursor)
  } catch {
    realRoot = cursor
  }
  return path.resolve(realRoot, ...missing)
}

function isUnderPhysical(root, target, fsImpl = fs) {
  const rootReal = realpathExistingPrefix(root, fsImpl)
  const targetReal = realpathExistingPrefix(target, fsImpl)
  const rel = path.relative(rootReal, targetReal)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex')
}

function renderSourceSkillContent(filePath, rawContent, fsImpl = fs) {
  const skillRoot = path.dirname(path.dirname(filePath))
  const contentRoot = path.dirname(skillRoot)
  if (path.basename(skillRoot) !== 'skills' || path.basename(contentRoot) !== 'content') {
    return rawContent
  }
  const includeRe = /^<!-- devcodex:include (shared\/[A-Za-z0-9._/-]+\.md) -->[ \t]*(\r?\n|$)/gm
  const rendered = String(rawContent).replace(includeRe, (directive, fragmentRelative, lineEnding) => {
    if (fragmentRelative.includes('..') || path.isAbsolute(fragmentRelative)) {
      throw new Error(`unsafe source Skill include: ${fragmentRelative}`)
    }
    const fragmentPath = path.resolve(contentRoot, fragmentRelative)
    const sharedRoot = path.resolve(contentRoot, 'shared')
    if (!isUnderPhysical(sharedRoot, fragmentPath, fsImpl) || !fileExists(fragmentPath, fsImpl)) {
      throw new Error(`missing or unsafe source Skill include: ${fragmentRelative}`)
    }
    const body = fsImpl.readFileSync(fragmentPath, 'utf8')
    includeRe.lastIndex = 0
    if (/<!--\s*devcodex:include\b/.test(body)) {
      throw new Error(`nested source Skill include forbidden: ${fragmentRelative}`)
    }
    const outputEol = lineEnding || '\n'
    const adapted = body.replace(/\r\n?/g, '\n').replace(/\n/g, outputEol)
    if (!lineEnding || /(?:\r?\n)$/.test(adapted)) return adapted
    return `${adapted}${lineEnding}`
  })
  includeRe.lastIndex = 0
  if (/<!--\s*devcodex:include\b/.test(rendered)) {
    throw new Error('invalid source Skill include directive')
  }
  return rendered
}

function detectWeaken(content) {
  const text = String(content || '')
  for (const pattern of WEAKEN_PATTERNS) {
    if (pattern.test(text)) return pattern.toString()
  }
  return null
}

function readDistribution(skillDir, fsImpl = fs) {
  const metaPath = path.join(skillDir, 'meta.json')
  if (fsImpl.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fsImpl.readFileSync(metaPath, 'utf8'))
      const value = String(meta.distribution || meta.workspaceSkillDistribution || '').trim()
      if (['repo-shared', 'local-only', 'fixture-only'].includes(value)) return value
    } catch {
      /* ignore */
    }
  }
  const marker = path.join(path.dirname(skillDir), '.distribution')
  if (fsImpl.existsSync(marker)) {
    try {
      const value = String(fsImpl.readFileSync(marker, 'utf8')).trim()
      if (['repo-shared', 'local-only', 'fixture-only'].includes(value)) return value
    } catch {
      /* ignore */
    }
  }
  return 'UNVERIFIED'
}

function baseTrace(skillId, options, extra = {}) {
  return {
    schemaVersion: 'SkillResolutionTraceV1',
    skillId: String(skillId || ''),
    selectedLayer: 'missing',
    selectedPath: null,
    digest: null,
    contentBytes: null,
    coversGlobal: false,
    securityDecision: 'not-applicable',
    reasonCode: '',
    skippedByUser: false,
    fallbackReason: '',
    distribution: 'UNVERIFIED',
    workspaceRoot: options._workspaceRoot || null,
    globalSkillsRoot: options._globalSkillsRoot || null,
    wPath: null,
    gPath: null,
    reserved: isReservedSkillId(skillId),
    resolvedAt: nowIso(options.clock),
    ...extra
  }
}

function fileExists(filePath, fsImpl) {
  try {
    return fsImpl.existsSync(filePath) && fsImpl.statSync(filePath).isFile()
  } catch {
    return false
  }
}

/**
 * Canonical skill entry is <skillDir>/SKILL.md (Agent Skills / Claude shape).
 * On case-insensitive FS, accept skill.md and return the actual path found.
 * @returns {{ path: string|null, caseFolded: boolean, dirExists: boolean, hint: string }}
 */
function findSkillMarkdown(skillDir, fsImpl = fs) {
  const preferred = path.join(skillDir, 'SKILL.md')
  if (!fsImpl.existsSync(skillDir)) {
    return { path: null, caseFolded: false, dirExists: false, hint: 'skill-dir-missing' }
  }
  let isDir = false
  try {
    isDir = fsImpl.statSync(skillDir).isDirectory()
  } catch {
    return { path: null, caseFolded: false, dirExists: false, hint: 'skill-dir-missing' }
  }
  if (!isDir) {
    return { path: null, caseFolded: false, dirExists: false, hint: 'skill-dir-not-directory' }
  }
  // Prefer exact SKILL.md when readdir reports it (case-sensitive correctness)
  let names = []
  try {
    names = fsImpl.readdirSync(skillDir)
  } catch {
    return { path: null, caseFolded: false, dirExists: true, hint: 'skill-dir-unreadable' }
  }
  if (names.includes('SKILL.md')) {
    const p = path.join(skillDir, 'SKILL.md')
    if (fileExists(p, fsImpl)) return { path: p, caseFolded: false, dirExists: true, hint: '' }
  }
  const folded = names.find(name => String(name).toLowerCase() === 'skill.md')
  if (folded) {
    const p = path.join(skillDir, folded)
    if (fileExists(p, fsImpl)) {
      return {
        path: p,
        caseFolded: folded !== 'SKILL.md',
        dirExists: true,
        hint: folded !== 'SKILL.md' ? `rename-${folded}-to-SKILL.md` : ''
      }
    }
  }
  // last resort: existsSync(SKILL.md) on case-insensitive FS
  if (fileExists(preferred, fsImpl)) {
    return { path: preferred, caseFolded: true, dirExists: true, hint: 'prefer-exact-SKILL.md' }
  }
  return {
    path: null,
    caseFolded: false,
    dirExists: true,
    hint: names.length
      ? `missing-SKILL.md-found:${names.join(',')}`
      : 'missing-SKILL.md-empty-dir'
  }
}

/**
 * @returns {{ trace: object, content: string|null }}
 */
function resolveSkillRead(skillId, options = {}) {
  const fsImpl = options.fs || fs
  const env = options.env || process.env
  const globalSkillsRoot = resolveGlobalSkillsRoot(options)
  const workspaceSkillsRoot = resolveWorkspaceSkillsRoot(options.cwd, options)
  const workspaceRoot = workspaceSkillsRoot
    ? path.resolve(workspaceSkillsRoot, '..', '..', '..')
    : null

  const localOpts = {
    ...options,
    _workspaceRoot: workspaceRoot,
    _globalSkillsRoot: globalSkillsRoot
  }

  if (!isValidSkillId(skillId)) {
    return {
      content: null,
      trace: baseTrace(skillId, localOpts, {
        reasonCode: 'invalid-id',
        fallbackReason: 'invalid-id',
        securityDecision: 'not-applicable'
      })
    }
  }

  const id = String(skillId).trim()
  const gHit = findSkillMarkdown(path.join(globalSkillsRoot, id), fsImpl)
  const wDir = workspaceSkillsRoot ? path.join(workspaceSkillsRoot, id) : null
  const wHit = wDir ? findSkillMarkdown(wDir, fsImpl) : { path: null, caseFolded: false, dirExists: false, hint: 'no-workspace-root' }
  const gPath = gHit.path || path.join(globalSkillsRoot, id, 'SKILL.md')
  const wPath = wHit.path || (wDir ? path.join(wDir, 'SKILL.md') : null)
  const gExists = Boolean(gHit.path) && isUnderPhysical(globalSkillsRoot, gPath, fsImpl)
  const reserved = isReservedSkillId(id)

  const finishG = (securityDecision, reasonCode, fallbackReason, skippedByUser = false) => {
    if (!gExists) {
      return {
        content: null,
        trace: baseTrace(id, localOpts, {
          selectedLayer: 'missing',
          wPath,
          gPath: gExists ? portable(gPath) : portable(gPath),
          securityDecision,
          reasonCode,
          fallbackReason,
          skippedByUser,
          reserved
        })
      }
    }
    // Always read for digest identity; omit body only when includeContent===false
    const fileText = renderSourceSkillContent(gPath, fsImpl.readFileSync(gPath, 'utf8'), fsImpl)
    const digest = sha256Text(fileText)
    const contentBytes = Buffer.byteLength(fileText, 'utf8')
    const content = options.includeContent === false ? null : fileText
    return {
      content,
      trace: baseTrace(id, localOpts, {
        selectedLayer: 'global',
        selectedPath: portable(gPath),
        digest,
        contentBytes,
        coversGlobal: false,
        securityDecision,
        reasonCode,
        fallbackReason,
        skippedByUser,
        wPath: wPath ? portable(wPath) : null,
        gPath: portable(gPath),
        reserved,
        distribution: 'UNVERIFIED'
      })
    }
  }

  if (!isWorkspaceSkillsEnabled(env)) {
    return finishG('skipped', 'kill-switch', 'kill-switch')
  }

  if (options.skippedByUser === true || options.forceGlobal === true) {
    return finishG('skipped', 'user-skip', 'user-skip', true)
  }

  if (reserved) {
    // S2: reserved never uses W body as override
    return finishG(
      wPath && fileExists(wPath, fsImpl) ? 'reserved-blocked-w' : 'not-applicable',
      'reserved',
      wPath && fileExists(wPath, fsImpl) ? 'reserved-blocked-w' : ''
    )
  }

  if (wHit.path && fileExists(wHit.path, fsImpl)) {
    if (!isUnderPhysical(workspaceSkillsRoot, wHit.path, fsImpl)) {
      return finishG('rejected-path', 'symlink-escape', 'symlink-escape')
    }
    let stat
    try {
      stat = fsImpl.statSync(wHit.path)
    } catch {
      return finishG('rejected-path', 'stat-failed', 'stat-failed')
    }
    if (stat.size > (options.maxBytes || MAX_SKILL_BYTES)) {
      return finishG('rejected-oversize', 'oversize', 'oversize')
    }
    const fileText = fsImpl.readFileSync(wHit.path, 'utf8')
    const weaken = detectWeaken(fileText)
    if (weaken) {
      return finishG('rejected-weaken', 'weaken-pattern', `weaken:${weaken}`)
    }
    // relative reference guard: optional listed files under skill dir only
    const skillDir = path.dirname(wHit.path)
    const refHits = fileText.match(/(?:scripts|references)\/[A-Za-z0-9._/-]+/g) || []
    for (const rel of refHits) {
      const target = path.resolve(skillDir, rel)
      if (!isUnderPhysical(skillDir, target, fsImpl)) {
        return finishG('rejected-path', 'ref-escape', `ref-escape:${rel}`)
      }
    }
    const digest = sha256Text(fileText)
    const contentBytes = Buffer.byteLength(fileText, 'utf8')
    return {
      content: options.includeContent === false ? null : fileText,
      trace: baseTrace(id, localOpts, {
        selectedLayer: 'workspace',
        selectedPath: portable(wHit.path),
        digest,
        contentBytes,
        coversGlobal: gExists,
        securityDecision: 'accepted',
        reasonCode: wHit.caseFolded ? 'workspace-accepted-casefold' : 'workspace-accepted',
        fallbackReason: wHit.hint || '',
        distribution: readDistribution(skillDir, fsImpl),
        wPath: portable(wHit.path),
        gPath: portable(gPath),
        reserved: false,
        skillFileName: path.basename(wHit.path)
      })
    }
  }

  // Directory exists but SKILL.md missing/wrong name — clearer diagnostics
  if (wHit.dirExists && !wHit.path) {
    return finishG(
      'not-applicable',
      'missing-SKILL.md',
      wHit.hint || 'missing-SKILL.md',
      false
    )
  }

  return finishG('not-applicable', gExists ? 'w-absent' : 'missing', gExists ? 'w-absent' : 'missing')
}

function resolveSkillReadPlan(skillIds, options = {}) {
  const ids = Array.isArray(skillIds) ? skillIds.map(String) : []
  const traces = []
  const selected = []
  let workspaceCoverCount = 0
  let reservedBlockedCount = 0
  for (const id of ids) {
    const { trace, content } = resolveSkillRead(id, { ...options, includeContent: options.includeContent !== false })
    traces.push(trace)
    if (trace.securityDecision === 'reserved-blocked-w') reservedBlockedCount += 1
    if (trace.selectedLayer === 'workspace') workspaceCoverCount += 1
    if (trace.selectedLayer === 'workspace' || trace.selectedLayer === 'global') {
      selected.push({
        id: trace.skillId,
        layer: trace.selectedLayer,
        path: trace.selectedPath,
        digest: trace.digest,
        contentBytes: trace.contentBytes,
        securityDecision: trace.securityDecision,
        content: options.attachContent ? content : undefined
      })
    }
  }
  const env = options.env || process.env
  return {
    schemaVersion: 'ResolvedSkillReadPlanV1',
    skillIds: ids,
    traces,
    selected,
    workspaceCoverCount,
    reservedBlockedCount,
    enabled: isWorkspaceSkillsEnabled(env),
    consumerAuthority: options.consumerAuthority || 'test',
    workspaceRoot: traces[0]?.workspaceRoot || null,
    globalSkillsRoot: resolveGlobalSkillsRoot(options)
  }
}

function classifySkillPath(absPath, options = {}) {
  const fsImpl = options.fs || fs
  const target = path.resolve(absPath || '')
  if (!target) return { layer: 'other', path: target }

  const packageRoot = options.packageRoot
    ? path.resolve(options.packageRoot)
    : path.resolve(__dirname, '..', '..')
  const packageSkills = path.join(packageRoot, 'content', 'skills')
  const globalSkillsRoot = resolveGlobalSkillsRoot(options)
  const workspaceSkillsRoot = resolveWorkspaceSkillsRoot(options.cwd, options)

  if (isUnderPhysical(packageSkills, target, fsImpl)) {
    return { layer: 'package-source-skill', path: portable(target), root: portable(packageSkills) }
  }
  if (isUnderPhysical(globalSkillsRoot, target, fsImpl)) {
    return { layer: 'global-managed-skill', path: portable(target), root: portable(globalSkillsRoot) }
  }
  if (workspaceSkillsRoot && isUnderPhysical(workspaceSkillsRoot, target, fsImpl)) {
    return { layer: 'workspace-skill', path: portable(target), root: portable(workspaceSkillsRoot) }
  }
  return { layer: 'other', path: portable(target) }
}

function assertApplyDestinationNotWorkspaceSkills(destinations, options = {}) {
  const list = Array.isArray(destinations) ? destinations : []
  const workspaceSkillsRoot = resolveWorkspaceSkillsRoot(options.cwd, options)
  if (!workspaceSkillsRoot) return { ok: true, violations: [] }
  const fsImpl = options.fs || fs
  const violations = []
  for (const dest of list) {
    if (!dest) continue
    const resolved = path.resolve(dest)
    if (isUnderPhysical(workspaceSkillsRoot, resolved, fsImpl)) {
      violations.push(portable(resolved))
    }
  }
  if (violations.length) {
    const error = new Error(`GLOBAL_HOST_DEST_IN_WORKSPACE_SKILLS: ${violations.join(', ')}`)
    error.code = 'GLOBAL_HOST_DEST_IN_WORKSPACE_SKILLS'
    error.violations = violations
    throw error
  }
  return { ok: true, violations: [] }
}

function isWorkspaceSkillPath(absPath, options = {}) {
  return classifySkillPath(absPath, options).layer === 'workspace-skill'
}

module.exports = {
  RESERVED_SKILL_IDS,
  MAX_SKILL_BYTES,
  isWorkspaceSkillsEnabled,
  isReservedSkillId,
  isValidSkillId,
  resolveGlobalSkillsRoot,
  resolveWorkspaceSkillsRoot,
  resolveSkillRead,
  resolveSkillReadPlan,
  classifySkillPath,
  assertApplyDestinationNotWorkspaceSkills,
  isWorkspaceSkillPath,
  isUnderPhysical,
  findSkillMarkdown,
  renderSourceSkillContent,
  sha256Text
}
