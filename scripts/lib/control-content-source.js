'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const MANIFEST_FILE = 'content-source/manifest.json'
const INCLUDE_RE = /^<!-- devcodex:include (shared\/[A-Za-z0-9._/-]+\.md) -->[ \t]*(\r?\n|$)/gm

function portable (value) {
  return String(value || '').replace(/\\/g, '/')
}

function sha256 (value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function stableStringify (value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

function walkFiles (root) {
  if (!fs.existsSync(root)) return []
  const files = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(full))
    else if (entry.isFile()) files.push(full)
  }
  return files
}

function readJson (file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function loadManifest (root) {
  const manifestPath = path.join(root, MANIFEST_FILE)
  const manifest = readJson(manifestPath)
  if (manifest.schemaVersion !== 'ControlContentManifestV1') {
    throw new Error(`unsupported control content manifest: ${manifest.schemaVersion || 'missing'}`)
  }
  if (!Number.isInteger(manifest.expectedMarkdownEntries) || manifest.expectedMarkdownEntries < 1) {
    throw new Error('expectedMarkdownEntries must be a positive integer')
  }
  return { manifest, manifestPath }
}

function classifyEntry (relative) {
  if (relative === 'instructions.md') return 'instruction-root'
  if (relative.startsWith('instructions/')) return 'instruction'
  if (relative.startsWith('prompts/')) return 'prompt'
  if (/^skills\/[^/]+\/SKILL\.md$/.test(relative)) return 'skill'
  return null
}

function collectEntries (root, manifest) {
  const sourceRoot = path.join(root, manifest.sourceRoot)
  const candidates = [
    path.join(sourceRoot, 'instructions.md'),
    ...walkFiles(path.join(sourceRoot, 'instructions')),
    ...walkFiles(path.join(sourceRoot, 'prompts')),
    ...walkFiles(path.join(sourceRoot, 'skills'))
  ]
  const seen = new Set()
  const entries = []
  for (const file of candidates) {
    if (!fs.existsSync(file) || path.extname(file).toLowerCase() !== '.md') continue
    const relative = portable(path.relative(sourceRoot, file))
    const kind = classifyEntry(relative)
    if (!kind) continue
    if (seen.has(relative)) throw new Error(`duplicate source entry: ${relative}`)
    seen.add(relative)
    entries.push({ source: file, target: path.join(root, relative), relative, kind })
  }
  entries.sort((left, right) => left.relative.localeCompare(right.relative))
  if (entries.length !== manifest.expectedMarkdownEntries) {
    throw new Error(
      `control content inventory mismatch: expected=${manifest.expectedMarkdownEntries} actual=${entries.length}`
    )
  }
  return entries
}

function assertSafeFragment (sourceRoot, fragmentRelative) {
  const normalized = portable(fragmentRelative)
  if (!normalized.startsWith('shared/') || normalized.includes('..') || path.isAbsolute(fragmentRelative)) {
    throw new Error(`unsafe include path: ${fragmentRelative}`)
  }
  const fragment = path.resolve(sourceRoot, normalized)
  const shared = path.resolve(sourceRoot, 'shared')
  if (fragment !== shared && !fragment.startsWith(`${shared}${path.sep}`)) {
    throw new Error(`include escapes shared root: ${fragmentRelative}`)
  }
  if (!fs.existsSync(fragment)) throw new Error(`missing include fragment: ${fragmentRelative}`)
  if (fs.lstatSync(fragment).isSymbolicLink()) throw new Error(`symlink include forbidden: ${fragmentRelative}`)
  return fragment
}

function renderContent (content, options) {
  const sourceRoot = options.sourceRoot
  const fragments = []
  const rendered = String(content).replace(INCLUDE_RE, (directive, fragmentRelative, lineEnding) => {
    const fragment = assertSafeFragment(sourceRoot, fragmentRelative)
    const body = fs.readFileSync(fragment, 'utf8')
    if (INCLUDE_RE.test(body)) {
      INCLUDE_RE.lastIndex = 0
      throw new Error(`nested include forbidden: ${fragmentRelative}`)
    }
    INCLUDE_RE.lastIndex = 0
    fragments.push(portable(fragmentRelative))
    const outputEol = lineEnding || '\n'
    const adapted = body.replace(/\r\n?/g, '\n').replace(/\n/g, outputEol)
    if (!lineEnding || /(?:\r?\n)$/.test(adapted)) return adapted
    return `${adapted}${lineEnding}`
  })
  INCLUDE_RE.lastIndex = 0
  const suspicious = rendered.match(/<!--\s*devcodex:include\b[^>]*-->/)
  if (suspicious) throw new Error(`invalid include directive: ${suspicious[0]}`)
  return { content: rendered, fragments }
}

function buildBundle (root, options = {}) {
  const { manifest, manifestPath } = loadManifest(root)
  const sourceRoot = path.join(root, manifest.sourceRoot)
  const entries = collectEntries(root, manifest)
  const files = []
  const usedFragments = new Map()
  for (const entry of entries) {
    const raw = fs.readFileSync(entry.source, 'utf8')
    const rendered = renderContent(raw, { sourceRoot })
    for (const fragment of rendered.fragments) {
      usedFragments.set(fragment, (usedFragments.get(fragment) || 0) + 1)
    }
    const actual = fs.existsSync(entry.target) ? fs.readFileSync(entry.target, 'utf8') : null
    files.push({
      ...entry,
      content: rendered.content,
      sourceDigest: sha256(raw),
      outputDigest: sha256(rendered.content),
      fresh: actual === rendered.content,
      fragments: rendered.fragments
    })
  }
  for (const [fragment, consumers] of usedFragments) {
    if (consumers < 2) throw new Error(`shared fragment requires at least two consumers: ${fragment}`)
  }

  const mirrors = (manifest.mirrors || []).map(rule => {
    const source = path.join(root, rule.source)
    const target = path.join(root, rule.target)
    if (!fs.existsSync(source)) throw new Error(`missing mirror source: ${rule.source}`)
    const content = fs.readFileSync(source, 'utf8')
    const actual = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null
    return { ...rule, source, target, content, fresh: actual === content }
  })
  const stale = [
    ...files.filter(file => !file.fresh).map(file => file.relative),
    ...mirrors.filter(file => !file.fresh).map(file => portable(file.target))
  ]
  const kindCounts = files.reduce((counts, file) => {
    counts[file.kind] = (counts[file.kind] || 0) + 1
    return counts
  }, {})
  const receipt = {
    schemaVersion: 'ControlContentReceiptV1',
    mode: options.mode || 'check',
    sourceRoot: manifest.sourceRoot,
    manifestDigest: sha256(fs.readFileSync(manifestPath)),
    entryCount: files.length,
    kindCounts,
    fragmentCount: usedFragments.size,
    fragmentConsumers: Object.fromEntries(Array.from(usedFragments.entries()).sort()),
    mirrorCount: mirrors.length,
    stale,
    fresh: stale.length === 0,
    bundleDigest: sha256(stableStringify(files.map(file => ({
      path: file.relative,
      sourceDigest: file.sourceDigest,
      outputDigest: file.outputDigest
    }))))
  }
  return { manifest, files, mirrors, receipt }
}

function atomicWrite (target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const temporary = `${target}.devcodex-${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`
  fs.writeFileSync(temporary, content, 'utf8')
  try {
    fs.renameSync(temporary, target)
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}

function materialize (root) {
  const bundle = buildBundle(root, { mode: 'write' })
  for (const file of bundle.files) {
    if (!file.fresh) atomicWrite(file.target, file.content)
  }
  for (const mirror of bundle.mirrors) {
    if (!mirror.fresh) atomicWrite(mirror.target, mirror.content)
  }
  return buildBundle(root, { mode: 'write' }).receipt
}

function inventory (root) {
  const { manifest } = loadManifest(root)
  const entries = collectEntries(root, manifest)
  return {
    schemaVersion: 'ControlContentInventoryV1',
    sourceRoot: manifest.sourceRoot,
    expected: manifest.expectedMarkdownEntries,
    actual: entries.length,
    entries: entries.map(entry => ({ path: entry.relative, kind: entry.kind }))
  }
}

module.exports = {
  MANIFEST_FILE,
  atomicWrite,
  buildBundle,
  collectEntries,
  inventory,
  loadManifest,
  materialize,
  portable,
  renderContent,
  sha256
}
