'use strict'

/**
 * Layered skill resolution Owner (S2).
 * Single algorithm for P/W/G path selection; consumers must honor content/digest binding.
 */

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { resolveGlobalSkillRuntimeRoot } = require('./global-skill-runtime-root.cjs')

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
const MAX_LAYERED_SKILL_BYTES = 8 * 1024 * 1024
const SKILL_METADATA_PREFIX_BYTES = 64 * 1024


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
  const fsImpl = options.fs || fs
  const loadedRoot = path.resolve(__dirname, '..', '..')
  const generationRoot = [loadedRoot, options.runtimeRoot, options.packageRoot].filter(Boolean)
    .map(root => path.resolve(root))
    .find(root => fsImpl.existsSync(path.join(root, 'runtime-generation.json')))
  if (generationRoot || options.globalRuntime?.source === 'runtime-generation') {
    const resolved = generationRoot
      ? resolveGlobalSkillRuntimeRoot({ ...options, runtimeRoot: generationRoot })
      : options.globalRuntime
    if (resolved.status === 'resolved') return path.resolve(resolved.root)
    const error = new Error('GLOBAL_SKILL_RUNTIME_GENERATION_UNBOUND')
    error.code = 'GLOBAL_SKILL_RUNTIME_GENERATION_UNBOUND'
    error.runtime = resolved
    throw error
  }
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
  if (options.workspaceSkillsRoot) return path.resolve(options.workspaceSkillsRoot)
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

/**
 * Resolve the project-local Skill root from an already bound project identity.
 * `activeRoot` is authoritative because workspace namespace mode deliberately
 * separates the source checkout from `.devcodex/<project>` artifacts.
 */
function resolveProjectSkillsRoot(cwdOrRoot, options = {}) {
  if (options.projectSkillsRoot) return path.resolve(options.projectSkillsRoot)
  const project = String(options.project || '').trim()
  if (!project || project === 'workspace') return null
  if (options.activeRoot) return path.join(path.resolve(options.activeRoot), 'skills')
  const cwd = path.resolve(cwdOrRoot || options.cwd || process.cwd())
  const layout = typeof options.findLayoutInfo === 'function'
    ? options.findLayoutInfo(cwd)
    : findLayoutInfo(cwd)
  if (layout?.enabled === true && String(layout.mode || '') === 'workspace-namespace') {
    const namespaceRoot = path.join(layout.workspaceRoot, '.devcodex')
    const candidate = path.resolve(namespaceRoot, project, 'skills')
    return isUnderPhysical(namespaceRoot, candidate, options.fs || fs) && candidate !== namespaceRoot
      ? candidate
      : null
  }
  return path.join(cwd, '.devcodex', 'skills')
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
    projectRoot: options._projectRoot || null,
    workspaceRoot: options._workspaceRoot || null,
    globalSkillsRoot: options._globalSkillsRoot || null,
    pPath: null,
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

function readPrefixUtf8(filePath, maxBytes, fsImpl = fs) {
  const stat = fsImpl.statSync(filePath)
  const length = Math.min(stat.size, maxBytes)
  if (length <= 0) return ''
  const buffer = Buffer.alloc(length)
  const fd = fsImpl.openSync(filePath, 'r')
  try {
    const bytesRead = fsImpl.readSync(fd, buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    fsImpl.closeSync(fd)
  }
}

/**
 * Metadata reads are deliberately prefix-only. Full content identity is
 * calculated later only for a selected Skill or an explicit exact resolve.
 */
function readSkillPayload(filePath, options = {}, fsImpl = fs) {
  let stat
  try {
    stat = fsImpl.statSync(filePath)
  } catch {
    return { ok: false, reasonCode: 'stat-failed' }
  }
  const maxBytes = options.metadataOnly === true
    ? (options.metadataMaxBytes || MAX_LAYERED_SKILL_BYTES)
    : (options.maxBytes || MAX_SKILL_BYTES)
  if (!stat.isFile() || stat.size > maxBytes) {
    return { ok: false, reasonCode: 'oversize', size: stat.size }
  }
  if (options.metadataOnly === true) {
    let prefix
    let realPath
    try {
      prefix = readPrefixUtf8(
        filePath,
        options.metadataPrefixBytes || SKILL_METADATA_PREFIX_BYTES,
        fsImpl
      )
      realPath = fsImpl.realpathSync(filePath)
    } catch {
      return { ok: false, reasonCode: 'read-failed', size: stat.size }
    }
    const fileIdentity = {
      realPath: portable(realPath),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      device: Number.isFinite(Number(stat.dev)) ? Number(stat.dev) : null,
      inode: Number.isFinite(Number(stat.ino)) ? Number(stat.ino) : null
    }
    const metadataDigest = sha256Text(JSON.stringify({
      ...fileIdentity,
      prefixDigest: sha256Text(prefix)
    }))
    return {
      ok: true,
      content: options.includeContent === false ? null : prefix,
      contentBytes: stat.size,
      prefixBytes: Buffer.byteLength(prefix, 'utf8'),
      digest: metadataDigest,
      metadataDigest,
      metadataOnly: true,
      fileIdentity
    }
  }
  try {
    const raw = fsImpl.readFileSync(filePath, 'utf8')
    const content = options.renderSource === true
      ? renderSourceSkillContent(filePath, raw, fsImpl)
      : raw
    return {
      ok: true,
      content: options.includeContent === false ? null : content,
      contentBytes: Buffer.byteLength(content, 'utf8'),
      prefixBytes: null,
      digest: sha256Text(content),
      metadataDigest: null,
      metadataOnly: false,
      fileIdentity: null
    }
  } catch {
    return { ok: false, reasonCode: 'read-failed', size: stat.size }
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
  const projectSkillsRoot = resolveProjectSkillsRoot(options.cwd, options)
  const preferredLayer = options.preferredLayer == null || options.preferredLayer === ''
    ? null
    : String(options.preferredLayer)
  const workspaceRoot = workspaceSkillsRoot
    ? path.resolve(workspaceSkillsRoot, '..', '..', '..')
    : null

  const localOpts = {
    ...options,
    _projectRoot: projectSkillsRoot,
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
  const pDir = projectSkillsRoot ? path.join(projectSkillsRoot, id) : null
  const wDir = workspaceSkillsRoot ? path.join(workspaceSkillsRoot, id) : null
  const pHit = pDir ? findSkillMarkdown(pDir, fsImpl) : { path: null, caseFolded: false, dirExists: false, hint: 'no-project-root' }
  const wHit = wDir ? findSkillMarkdown(wDir, fsImpl) : { path: null, caseFolded: false, dirExists: false, hint: 'no-workspace-root' }
  const gPath = gHit.path || path.join(globalSkillsRoot, id, 'SKILL.md')
  const pPath = pHit.path || (pDir ? path.join(pDir, 'SKILL.md') : null)
  const wPath = wHit.path || (wDir ? path.join(wDir, 'SKILL.md') : null)
  const gExists = Boolean(gHit.path) && isUnderPhysical(globalSkillsRoot, gPath, fsImpl)
  const reserved = isReservedSkillId(id)
  const lowerFallbacks = []

  const finishG = (securityDecision, reasonCode, fallbackReason, skippedByUser = false) => {
    if (!gExists) {
      return {
        content: null,
        trace: baseTrace(id, localOpts, {
          selectedLayer: 'missing',
          pPath: pPath ? portable(pPath) : null,
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
    const payload = readSkillPayload(gPath, {
      ...options,
      maxBytes: options.maxBytes || Number.MAX_SAFE_INTEGER,
      renderSource: options.metadataOnly !== true
    }, fsImpl)
    if (!payload.ok) {
      return {
        content: null,
        trace: baseTrace(id, localOpts, {
          selectedLayer: 'missing',
          pPath: pPath ? portable(pPath) : null,
          wPath: wPath ? portable(wPath) : null,
          gPath: portable(gPath),
          securityDecision: 'rejected-global',
          reasonCode: payload.reasonCode,
          fallbackReason: payload.reasonCode,
          skippedByUser,
          reserved
        })
      }
    }
    return {
      content: payload.content,
      trace: baseTrace(id, localOpts, {
        selectedLayer: 'global',
        selectedPath: portable(gPath),
        digest: payload.digest,
        metadataDigest: payload.metadataDigest,
        metadataOnly: payload.metadataOnly,
        contentBytes: payload.contentBytes,
        contentPrefixBytes: payload.prefixBytes,
        fileIdentity: payload.fileIdentity,
        coversGlobal: false,
        securityDecision,
        reasonCode,
        fallbackReason,
        skippedByUser,
        pPath: pPath ? portable(pPath) : null,
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
    // Reserved control Skills never use project/workspace bodies as overrides.
    const localReservedLayer = pPath && fileExists(pPath, fsImpl)
      ? 'p'
      : (wPath && fileExists(wPath, fsImpl) ? 'w' : '')
    return finishG(
      localReservedLayer ? `reserved-blocked-${localReservedLayer}` : 'not-applicable',
      'reserved',
      localReservedLayer ? `reserved-blocked-${localReservedLayer}` : ''
    )
  }

  const resolveLocal = (layer, root, hit, selectedPath) => {
    if (!hit.path || !fileExists(hit.path, fsImpl)) {
      if (hit.dirExists) {
        lowerFallbacks.push({
          layer,
          securityDecision: 'not-applicable',
          reasonCode: 'missing-SKILL.md',
          fallbackReason: hit.hint || 'missing-SKILL.md'
        })
      }
      return null
    }
    if (!isUnderPhysical(root, hit.path, fsImpl)) {
      lowerFallbacks.push({ layer, securityDecision: 'rejected-path', reasonCode: 'symlink-escape', fallbackReason: 'symlink-escape' })
      return null
    }
    const payload = readSkillPayload(hit.path, options, fsImpl)
    if (!payload.ok) {
      lowerFallbacks.push({
        layer,
        securityDecision: payload.reasonCode === 'oversize' ? 'rejected-oversize' : 'rejected-path',
        reasonCode: payload.reasonCode,
        fallbackReason: payload.reasonCode
      })
      return null
    }
    const inspectedContent = payload.content || ''
    const skillDir = path.dirname(hit.path)
    const refHits = inspectedContent.match(/(?:scripts|references)\/[A-Za-z0-9._/-]+/g) || []
    for (const rel of refHits) {
      const target = path.resolve(skillDir, rel)
      if (!isUnderPhysical(skillDir, target, fsImpl)) {
        lowerFallbacks.push({ layer, securityDecision: 'rejected-path', reasonCode: 'ref-escape', fallbackReason: `ref-escape:${rel}` })
        return null
      }
    }
    const prefix = layer === 'project' ? 'project' : 'workspace'
    return {
      content: payload.content,
      trace: baseTrace(id, localOpts, {
        selectedLayer: layer,
        selectedPath: portable(hit.path),
        digest: payload.digest,
        metadataDigest: payload.metadataDigest,
        metadataOnly: payload.metadataOnly,
        contentBytes: payload.contentBytes,
        contentPrefixBytes: payload.prefixBytes,
        fileIdentity: payload.fileIdentity,
        coversGlobal: gExists,
        securityDecision: 'accepted',
        reasonCode: hit.caseFolded ? `${prefix}-accepted-casefold` : `${prefix}-accepted`,
        fallbackReason: [
          ...lowerFallbacks.map(item => `${item.layer}:${item.fallbackReason}`),
          hit.hint || ''
        ].filter(Boolean).join(';'),
        distribution: readDistribution(skillDir, fsImpl),
        pPath: pPath ? portable(pPath) : null,
        wPath: wPath ? portable(wPath) : null,
        gPath: portable(gPath),
        reserved: false,
        skillFileName: path.basename(hit.path),
        coversLowerLayers: layer === 'project'
          ? [wHit.path ? 'workspace' : null, gExists ? 'global' : null].filter(Boolean)
          : (gExists ? ['global'] : []),
        selectedRoot: portable(root),
        selectedCandidatePath: portable(selectedPath)
      })
    }
  }

  if (preferredLayer) {
    if (!['project', 'workspace', 'global'].includes(preferredLayer)) {
      return {
        content: null,
        trace: baseTrace(id, localOpts, {
          selectedLayer: 'missing',
          reasonCode: 'preferred-layer-invalid',
          fallbackReason: preferredLayer,
          pPath: pPath ? portable(pPath) : null,
          wPath: wPath ? portable(wPath) : null,
          gPath: portable(gPath),
          reserved
        })
      }
    }
    if (preferredLayer === 'global') {
      return finishG('not-applicable', gExists ? 'preferred-global' : 'missing', gExists ? '' : 'preferred-global-missing')
    }
    const root = preferredLayer === 'project' ? projectSkillsRoot : workspaceSkillsRoot
    const hit = preferredLayer === 'project' ? pHit : wHit
    const selectedPath = preferredLayer === 'project' ? pPath : wPath
    const selected = root ? resolveLocal(preferredLayer, root, hit, selectedPath) : null
    if (selected) return selected
    return {
      content: null,
      trace: baseTrace(id, localOpts, {
        selectedLayer: 'missing',
        reasonCode: 'preferred-layer-unavailable',
        fallbackReason: lowerFallbacks.map(item => `${item.layer}:${item.fallbackReason}`).join(';') || `${preferredLayer}-missing`,
        pPath: pPath ? portable(pPath) : null,
        wPath: wPath ? portable(wPath) : null,
        gPath: portable(gPath),
        reserved
      })
    }
  }

  const projectResult = projectSkillsRoot
    ? resolveLocal('project', projectSkillsRoot, pHit, pPath)
    : null
  if (projectResult) return projectResult

  const workspaceResult = workspaceSkillsRoot
    ? resolveLocal('workspace', workspaceSkillsRoot, wHit, wPath)
    : null
  if (workspaceResult) return workspaceResult

  const fallback = lowerFallbacks[0]
  if (fallback) {
    return finishG(
      fallback.securityDecision,
      fallback.reasonCode,
      lowerFallbacks.map(item => `${item.layer}:${item.fallbackReason}`).join(';')
    )
  }

  return finishG('not-applicable', gExists ? 'w-absent' : 'missing', gExists ? 'w-absent' : 'missing')
}

function resolveSkillReadPlan(skillIds, options = {}) {
  const ids = Array.isArray(skillIds) ? skillIds.map(String) : []
  const traces = []
  const selected = []
  let projectCoverCount = 0
  let workspaceCoverCount = 0
  let reservedBlockedCount = 0
  for (const id of ids) {
    const { trace, content } = resolveSkillRead(id, { ...options, includeContent: options.includeContent !== false })
    traces.push(trace)
    if (String(trace.securityDecision || '').startsWith('reserved-blocked-')) reservedBlockedCount += 1
    if (trace.selectedLayer === 'project') projectCoverCount += 1
    if (trace.selectedLayer === 'workspace') workspaceCoverCount += 1
    if (['project', 'workspace', 'global'].includes(trace.selectedLayer)) {
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
    projectCoverCount,
    workspaceCoverCount,
    reservedBlockedCount,
    enabled: isWorkspaceSkillsEnabled(env),
    consumerAuthority: options.consumerAuthority || 'test',
    projectSkillsRoot: resolveProjectSkillsRoot(options.cwd, options),
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
  const projectSkillsRoot = resolveProjectSkillsRoot(options.cwd, options)
  const workspaceSkillsRoot = resolveWorkspaceSkillsRoot(options.cwd, options)

  if (isUnderPhysical(packageSkills, target, fsImpl)) {
    return { layer: 'package-source-skill', path: portable(target), root: portable(packageSkills) }
  }
  if (isUnderPhysical(globalSkillsRoot, target, fsImpl)) {
    return { layer: 'global-managed-skill', path: portable(target), root: portable(globalSkillsRoot) }
  }
  if (projectSkillsRoot && isUnderPhysical(projectSkillsRoot, target, fsImpl)) {
    return { layer: 'project-skill', path: portable(target), root: portable(projectSkillsRoot) }
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
  MAX_LAYERED_SKILL_BYTES,
  SKILL_METADATA_PREFIX_BYTES,
  isWorkspaceSkillsEnabled,
  isReservedSkillId,
  isValidSkillId,
  resolveGlobalSkillsRoot,
  resolveProjectSkillsRoot,
  resolveWorkspaceSkillsRoot,
  resolveSkillRead,
  resolveSkillReadPlan,
  classifySkillPath,
  assertApplyDestinationNotWorkspaceSkills,
  isWorkspaceSkillPath,
  isUnderPhysical,
  findSkillMarkdown,
  readPrefixUtf8,
  readSkillPayload,
  renderSourceSkillContent,
  sha256Text
}
