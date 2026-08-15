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
  const target = path.resolve(root, ...segments)
  const relative = path.relative(root, target)
  if (relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) return target
  throw new Error('path escapes allowed root')
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

  let cursor = rootPath
  for (const segment of segments) {
    cursor = path.join(cursor, segment)
    const stat = fsImpl.lstatSync(cursor)
    if (stat.isSymbolicLink()) {
      throw new Error(`invalid ${label}: symbolic links and reparse-point traversals are not allowed`)
    }
  }

  const realpath = fsImpl.realpathSync.native
    ? candidate => fsImpl.realpathSync.native(candidate)
    : candidate => fsImpl.realpathSync(candidate)
  const canonicalRoot = realpath(rootPath)
  const canonicalTarget = realpath(target)
  const canonicalRelative = path.relative(canonicalRoot, canonicalTarget)
  if (!canonicalRelative || canonicalRelative === '..' || canonicalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(canonicalRelative)) {
    throw new Error(`invalid ${label}: canonical path escapes allowed root`)
  }
  if (!fsImpl.statSync(canonicalTarget).isFile()) {
    throw new Error(`invalid ${label}: expected a regular file`)
  }
  return canonicalTarget
}

module.exports = { assertSingleSegment, resolveInside, resolveExistingRegularFileInside }
