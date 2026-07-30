'use strict'

const fs = require('fs')
const path = require('path')
const { buildBundle } = require('./control-content-source')

function portable (value) {
  return String(value || '').replace(/\\/g, '/')
}

function walkFiles (root, fsImpl = fs) {
  if (!fsImpl.existsSync(root)) return []
  const files = []
  for (const entry of fsImpl.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(full, fsImpl))
    else if (entry.isFile()) files.push(full)
  }
  return files.sort()
}

function hasControlContentSource (packageRoot, fsImpl = fs) {
  return fsImpl.existsSync(path.join(packageRoot, 'content', 'manifest.json'))
}

function resolveControlAsset (packageRoot, relative, fsImpl = fs) {
  const portableRelative = portable(relative)
  const canonical = path.join(packageRoot, 'content', portableRelative)
  if (hasControlContentSource(packageRoot, fsImpl) && fsImpl.existsSync(canonical)) {
    return canonical
  }
  return path.join(packageRoot, portableRelative)
}

function listControlDeliveryEntries (packageRoot, surface, fsImpl = fs) {
  if (!hasControlContentSource(packageRoot, fsImpl)) return null
  const bundle = buildBundle(packageRoot)
  if (surface === 'instructions' || surface === 'prompts') {
    const prefix = `${surface}/`
    const entries = new Map(bundle.files
      .filter(file => file.relative.startsWith(prefix))
      .map(file => ({
        source: `content/${file.relative}`,
        relative: file.relative.slice(prefix.length),
        content: file.content
      }))
      .map(entry => [entry.relative, entry]))
    const contentSurfaceRoot = path.join(packageRoot, 'content', surface)
    for (const file of walkFiles(contentSurfaceRoot, fsImpl)) {
      const relative = portable(path.relative(contentSurfaceRoot, file))
      if (entries.has(relative)) continue
      entries.set(relative, {
        source: `content/${surface}/${relative}`,
        relative,
        content: fsImpl.readFileSync(file)
      })
    }
    return [...entries.values()].sort((left, right) => left.relative.localeCompare(right.relative))
  }
  if (surface !== 'skills') return null

  const entries = new Map()
  const renderedSkills = new Map(
    bundle.files
      .filter(file => file.kind === 'skill')
      .map(file => [file.relative.slice('skills/'.length), file.content])
  )
  const contentSkillsRoot = path.join(packageRoot, 'content', 'skills')
  for (const file of walkFiles(contentSkillsRoot, fsImpl)) {
    const relative = portable(path.relative(contentSkillsRoot, file))
    if (relative.endsWith('/devcodex.skill.json')) continue
    if (entries.has(relative)) throw new Error(`duplicate Skill delivery asset: ${relative}`)
    entries.set(relative, {
      source: `content/skills/${relative}`,
      relative,
      content: renderedSkills.get(relative) ?? fsImpl.readFileSync(file)
    })
  }
  return [...entries.values()].sort((left, right) => left.relative.localeCompare(right.relative))
}

function listControlSourceEntries (packageRoot, srcDir, surface, options = {}) {
  const fsImpl = options.fsImpl || fs
  const virtual = listControlDeliveryEntries(packageRoot, surface, fsImpl)
  if (virtual) {
    return virtual
      .filter(entry => {
        if (surface === 'instructions' && options.includeInstructionFile &&
            !options.includeInstructionFile(entry.relative)) return false
        if (surface === 'skills' && options.includeSkillFile &&
            !options.includeSkillFile(entry.relative)) return false
        return true
      })
      .map(entry => ({ ...entry, srcFile: null }))
  }
  return walkFiles(srcDir, fsImpl)
    .filter(srcFile => {
      const relative = portable(path.relative(srcDir, srcFile))
      if (surface === 'instructions' && options.includeInstructionFile &&
          !options.includeInstructionFile(relative)) return false
      if (surface === 'skills' && options.includeSkillFile &&
          !options.includeSkillFile(relative)) return false
      return true
    })
    .map(srcFile => ({
      source: portable(path.relative(packageRoot, srcFile)),
      relative: portable(path.relative(srcDir, srcFile)),
      content: null,
      srcFile
    }))
}

function sourceEntryContentEqual (entry, destination, fsImpl = fs) {
  if (!fsImpl.existsSync(destination)) return false
  const desired = entry.content == null
    ? fsImpl.readFileSync(entry.srcFile)
    : (Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(String(entry.content)))
  return fsImpl.readFileSync(destination).equals(desired)
}

function writeSourceEntry (entry, destination, fsImpl = fs) {
  fsImpl.mkdirSync(path.dirname(destination), { recursive: true })
  if (entry.content == null) fsImpl.copyFileSync(entry.srcFile, destination)
  else fsImpl.writeFileSync(destination, entry.content)
}

function readControlInstructionRoot (packageRoot, fsImpl = fs) {
  if (!hasControlContentSource(packageRoot, fsImpl)) {
    const source = path.join(packageRoot, 'instructions.md')
    return fsImpl.existsSync(source) ? fsImpl.readFileSync(source, 'utf8') : null
  }
  const entry = buildBundle(packageRoot).files.find(file => file.relative === 'instructions.md')
  return entry ? entry.content : null
}

module.exports = {
  hasControlContentSource,
  listControlDeliveryEntries,
  listControlSourceEntries,
  resolveControlAsset,
  sourceEntryContentEqual,
  writeSourceEntry,
  readControlInstructionRoot
}
