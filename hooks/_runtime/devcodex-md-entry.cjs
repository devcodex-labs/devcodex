'use strict'

/**
 * DEVCODEX.md workspace entry — path locked under .devcodex/workspace/
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const {
  findLayoutInfo
} = require('./workspace-layout.cjs')

const MAX_ENTRY_BYTES = 24 * 1024
const ENTRY_FILE = 'DEVCODEX.md'

const DEFAULT_TEMPLATE = `# DevCodex — 工作区入口

> 本文件给 AI/宿主阅读。人类安装说明见仓库 README.md。
> 路径：\`.devcodex/workspace/DEVCODEX.md\`（与 \`skills/\` 并列）。

## 本仓约定

- （在此写短约束；勿粘贴完整全局内核）

## Skills

- 目录：\`./skills/<id>/SKILL.md\`
- always-on:（可选，逗号分隔 skill id）

## 硬约束

- （短）
`

function resolveWorkspaceRoot(cwdOrRoot, options = {}) {
  if (options.workspaceRoot) return path.resolve(options.workspaceRoot)
  const cwd = path.resolve(cwdOrRoot || options.cwd || process.cwd())
  const layout = typeof options.findLayoutInfo === 'function'
    ? options.findLayoutInfo(cwd)
    : findLayoutInfo(cwd)
  if (layout && layout.enabled === true && String(layout.mode || '') === 'workspace-namespace') {
    return path.resolve(layout.workspaceRoot)
  }
  return null
}

function resolveDevcodexMdPath(cwdOrRoot, options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(cwdOrRoot, options)
  if (!workspaceRoot) return null
  return path.join(workspaceRoot, '.devcodex', 'workspace', ENTRY_FILE)
}

function resolveWorkspaceSkillsDir(cwdOrRoot, options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(cwdOrRoot, options)
  if (!workspaceRoot) return null
  return path.join(workspaceRoot, '.devcodex', 'workspace', 'skills')
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex')
}

function parseAlwaysOn(text) {
  const raw = String(text || '')
  const ids = []
  // always-on: a, b  or always-on: a
  const lineRe = /always-on\s*:\s*([^\n\r]+)/gi
  let m
  while ((m = lineRe.exec(raw)) !== null) {
    const part = String(m[1] || '').trim()
    if (!part || part.startsWith('（') || part.startsWith('(')) continue
    for (const token of part.split(/[,，\s]+/)) {
      const id = token.trim().replace(/[`*]/g, '')
      if (id && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) && !ids.includes(id)) ids.push(id)
    }
  }
  return ids
}

/**
 * @returns {object} DevcodexMdEntryV1
 */
function readDevcodexMdEntry(cwdOrRoot, options = {}) {
  const fsImpl = options.fs || fs
  const maxBytes = options.maxBytes || MAX_ENTRY_BYTES
  const entryPath = resolveDevcodexMdPath(cwdOrRoot, options)
  const base = {
    schemaVersion: 'DevcodexMdEntryV1',
    path: entryPath,
    exists: false,
    truncated: false,
    content: '',
    digest: null,
    alwaysOn: [],
    markerPreview: '',
    bytes: 0
  }
  if (!entryPath) {
    return { ...base, path: null, reason: 'no-workspace-namespace' }
  }
  if (!fsImpl.existsSync(entryPath)) {
    return { ...base, reason: 'missing' }
  }
  let text = ''
  try {
    text = fsImpl.readFileSync(entryPath, 'utf8')
  } catch {
    return { ...base, reason: 'unreadable' }
  }
  const bytes = Buffer.byteLength(text, 'utf8')
  let truncated = false
  if (bytes > maxBytes) {
    // keep head only
    let cut = text
    while (Buffer.byteLength(cut, 'utf8') > maxBytes && cut.length > 0) {
      cut = cut.slice(0, Math.floor(cut.length * 0.9))
    }
    text = `${cut}\n\n…[truncated for DEVCODEX.md budget]\n`
    truncated = true
  }
  const alwaysOn = parseAlwaysOn(text)
  const firstLine = text.split(/\r?\n/).map(l => l.trim()).find(l => l && !l.startsWith('#')) || ''
  return {
    ...base,
    exists: true,
    truncated,
    content: text,
    digest: sha256Text(text),
    alwaysOn,
    markerPreview: firstLine.slice(0, 120),
    bytes: Buffer.byteLength(text, 'utf8'),
    reason: truncated ? 'truncated' : 'ok'
  }
}

function ensureDevcodexMdTemplate(cwdOrRoot, options = {}) {
  const fsImpl = options.fs || fs
  const entryPath = resolveDevcodexMdPath(cwdOrRoot, options)
  const skillsDir = resolveWorkspaceSkillsDir(cwdOrRoot, options)
  if (!entryPath || !skillsDir) {
    return { ok: false, created: false, path: entryPath, reason: 'no-workspace-namespace' }
  }
  if (options.dryRun) {
    return {
      ok: true,
      created: !fsImpl.existsSync(entryPath),
      planned: true,
      path: entryPath,
      skillsDir
    }
  }
  fsImpl.mkdirSync(skillsDir, { recursive: true })
  if (fsImpl.existsSync(entryPath)) {
    return { ok: true, created: false, path: entryPath, skillsDir, reason: 'exists' }
  }
  fsImpl.writeFileSync(entryPath, DEFAULT_TEMPLATE, 'utf8')
  return { ok: true, created: true, path: entryPath, skillsDir }
}

function buildEntryInjection(entry) {
  if (!entry || !entry.exists || !entry.content) return ''
  return [
    '### DevCodex · Workspace entry (DEVCODEX.md)',
    `path: ${entry.path}`,
    entry.alwaysOn.length ? `alwaysOn: ${entry.alwaysOn.join(', ')}` : 'alwaysOn: (none)',
    '',
    '----- BEGIN DEVCODEX.md -----',
    entry.content.trim(),
    '----- END DEVCODEX.md -----'
  ].join('\n')
}

module.exports = {
  MAX_ENTRY_BYTES,
  ENTRY_FILE,
  DEFAULT_TEMPLATE,
  resolveWorkspaceRoot,
  resolveDevcodexMdPath,
  resolveWorkspaceSkillsDir,
  readDevcodexMdEntry,
  ensureDevcodexMdTemplate,
  parseAlwaysOn,
  buildEntryInjection,
  sha256Text
}
