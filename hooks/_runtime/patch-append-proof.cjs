'use strict'

function splitUpdatePatches(patch) {
  if (typeof patch !== 'string' || patch.length > 8 * 1024 * 1024) return []
  const lines = patch.replace(/\r\n/g, '\n').split('\n')
  const end = lines.indexOf('*** End Patch')
  if (lines[0] !== '*** Begin Patch' || end < 0 || lines.slice(end + 1).some(line => line.trim()) ||
      lines.some(line => /^\*\*\* (?:Add|Delete|Move)/.test(line))) return []
  const starts = lines.slice(0, end).flatMap((line, index) => line.startsWith('*** Update File: ') ? [index] : [])
  if (starts[0] !== 1 || starts.length > 4) return []
  return starts.map((start, index) => ({
    target: lines[start].slice('*** Update File: '.length),
    patch: ['*** Begin Patch', ...lines.slice(start, starts[index + 1] || end), '*** End Patch'].join('\n')
  }))
}

// Bounded dry-run of an exact Codex update patch. This is evidence of its effect,
// not a classification of the user's wording or a host permission decision.
function patchProvesAppend(patch, existing) {
  if (typeof patch !== 'string' || patch.length > 8 * 1024 * 1024) return false
  const lines = patch.replace(/\r\n/g, '\n').split('\n')
  if (lines[0] !== '*** Begin Patch' || lines.filter(line => /^\*\*\* Update File: /.test(line)).length !== 1 ||
      lines.some(line => /^\*\*\* (?:Add|Delete|Move)/.test(line))) return false
  const end = lines.indexOf('*** End Patch')
  if (end < 0 || lines.slice(end + 1).some(line => line.trim())) return false
  const start = lines.findIndex(line => /^\*\*\* Update File: /.test(line))
  if (start !== 1) return false
  const newline = existing.includes('\r\n') ? '\r\n' : '\n'
  const rows = existing.replace(/\r\n/g, '\n').split('\n')
  if (rows.at(-1) === '') rows.pop()
  let oldRows = [], newRows = [], cursor = 0, eof = false, changed = false
  const apply = () => {
    if (!oldRows.length && !newRows.length) return true
    const matches = []
    for (let at = cursor; at <= rows.length - oldRows.length; at += 1) {
      if (eof && at + oldRows.length !== rows.length) continue
      if (!oldRows.length && !eof) return false
      if (oldRows.every((row, index) => rows[at + index] === row)) matches.push(at)
    }
    if (matches.length !== 1) return false
    const at = matches[0]
    rows.splice(at, oldRows.length, ...newRows)
    cursor = at + newRows.length
    changed = true
    oldRows = []; newRows = []; eof = false
    return true
  }
  for (const line of lines.slice(start + 1, end)) {
    if (line === '@@' || line.startsWith('@@ ')) {
      if (!apply()) return false
      if (line.startsWith('@@ ')) {
        const hint = line.slice(3)
        const at = rows.findIndex((row, index) => index >= cursor && row === hint)
        if (at < 0) return false
        cursor = at + 1
      }
      continue
    }
    if (line === '*** End of File') { eof = true; continue }
    if (line.startsWith(' ')) { oldRows.push(line.slice(1)); newRows.push(line.slice(1)) }
    else if (line.startsWith('-')) oldRows.push(line.slice(1))
    else if (line.startsWith('+')) newRows.push(line.slice(1))
    else return false
  }
  if (!apply() || !changed) return false
  const result = rows.join(newline) + newline
  return result.length > existing.length && result.startsWith(existing)
}

module.exports = { patchProvesAppend, splitUpdatePatches }
