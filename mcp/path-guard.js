'use strict'

const fs = require('fs')
const path = require('path')

function assertSingleSegment(value, label) {
  if (typeof value !== 'string') throw new Error(`invalid ${label}`)
  const text = value
  if (!text || text !== text.trim() || text === '.' || text === '..' || path.isAbsolute(text) || /[:\\/\0\r\n]/.test(text)) {
    throw new Error(`invalid ${label}`)
  }
  return text
}

function resolveInside(root, ...segments) {
  const fsImpl = fs
  const rootPath = path.resolve(root)
  const target = path.resolve(rootPath, ...segments)
  const relative = path.relative(rootPath, target)
  if (relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) return target
  if (!relative) return target
  throw new Error('path escapes allowed root')
}

function realpath(fsImpl, candidate) {
  return fsImpl.realpathSync.native
    ? fsImpl.realpathSync.native(candidate)
    : fsImpl.realpathSync(candidate)
}

function assertNoExistingSymlinkTraversal(root, target, options = {}) {
  const fsImpl = options.fs || fs
  const label = options.label || 'path'
  const rootPath = path.resolve(root)
  if (!fsImpl.existsSync(rootPath)) return
  const canonicalRoot = realpath(fsImpl, rootPath)
  const relative = path.relative(rootPath, path.resolve(target))
  if (!relative) return
  let cursor = rootPath
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment)
    if (!fsImpl.existsSync(cursor)) break
    const stat = fsImpl.lstatSync(cursor)
    if (stat.isSymbolicLink()) {
      throw new Error(`invalid ${label}: symbolic links and reparse-point traversals are not allowed`)
    }
    const canonicalCursor = realpath(fsImpl, cursor)
    const canonicalRelative = path.relative(canonicalRoot, canonicalCursor)
    if (canonicalRelative === '..' || canonicalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(canonicalRelative)) {
      throw new Error(`invalid ${label}: canonical path escapes allowed root`)
    }
  }
}

function resolveExistingRegularFileInside(root, value, options = {}) {
  const fsImpl = options.fs || fs
  const label = options.label || 'path'
  if (typeof value !== 'string') throw new Error(`invalid ${label}: expected a relative file path`)
  const portable = value.replace(/\\/g, '/')
  const segments = portable.split('/')
  if (!portable || portable !== portable.trim() || path.isAbsolute(value) || path.posix.isAbsolute(portable) ||
      /^[A-Za-z]:/.test(portable) || /[:\0\r\n]/.test(portable) ||
      segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error(`invalid ${label}: expected a normalized task-relative file path`)
  }

  const rootPath = path.resolve(root)
  const target = resolveInside(rootPath, ...segments)
  if (!fsImpl.existsSync(rootPath) || !fsImpl.existsSync(target)) {
    throw new Error(`invalid ${label}: file does not exist inside allowed root`)
  }
  assertNoExistingSymlinkTraversal(rootPath, target, { fs: fsImpl, label })

  let cursor = rootPath
  for (const segment of segments) {
    cursor = path.join(cursor, segment)
    const stat = fsImpl.lstatSync(cursor)
    if (stat.isSymbolicLink()) {
      throw new Error(`invalid ${label}: symbolic links and reparse-point traversals are not allowed`)
    }
  }

  const canonicalRoot = realpath(fsImpl, rootPath)
  const canonicalTarget = realpath(fsImpl, target)
  const canonicalRelative = path.relative(canonicalRoot, canonicalTarget)
  if (!canonicalRelative || canonicalRelative === '..' || canonicalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(canonicalRelative)) {
    throw new Error(`invalid ${label}: canonical path escapes allowed root`)
  }
  if (!fsImpl.statSync(canonicalTarget).isFile()) {
    throw new Error(`invalid ${label}: expected a regular file`)
  }
  return canonicalTarget
}

function resolveWritePathInside(root, ...segments) {
  const target = resolveInside(root, ...segments)
  assertNoExistingSymlinkTraversal(root, target)
  return target
}

module.exports = { assertSingleSegment, resolveInside, resolveExistingRegularFileInside, resolveWritePathInside }
