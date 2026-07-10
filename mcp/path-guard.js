'use strict'

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

module.exports = { assertSingleSegment, resolveInside }
