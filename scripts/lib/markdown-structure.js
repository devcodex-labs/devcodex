'use strict'

function splitTableRow(line) {
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells = []
  let current = ''
  let escaped = false
  let inCode = false
  for (const char of body) {
    if (escaped) {
      current += char
      escaped = false
    } else if (char === '\\') {
      current += char
      escaped = true
    } else if (char === '`') {
      current += char
      inCode = !inCode
    } else if (char === '|' && !inCode) {
      cells.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current.trim())
  return cells
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every(cell => /^:?-+:?$/.test(cell))
}

function validateMarkdownStructure(content, label = '<markdown>') {
  const errors = []
  const lines = String(content).split(/\r?\n/)
  let fence = null
  let table = []

  function flushTable() {
    if (table.length === 0) return
    const rows = table.map(item => ({ ...item, cells: splitTableRow(item.text) }))
    if (rows.length < 2 || !isSeparatorRow(rows[1].cells)) {
      errors.push(`${label}:${rows[0].line} table block missing header separator`)
    } else {
      const width = rows[0].cells.length
      for (const row of rows) {
        if (row.cells.length !== width) {
          errors.push(`${label}:${row.line} table column count ${row.cells.length} differs from header ${width}`)
        }
      }
    }
    table = []
  }

  lines.forEach((line, index) => {
    const marker = line.match(/^\s*([`~]{3,})(.*)$/)
    if (marker) {
      flushTable()
      if (!fence) {
        const info = marker[2].trim()
        if (!info) errors.push(`${label}:${index + 1} opening code fence missing language tag`)
        fence = { char: marker[1][0], length: marker[1].length, line: index + 1 }
      } else if (marker[1][0] === fence.char && marker[1].length >= fence.length && marker[2].trim() === '') {
        fence = null
      }
      return
    }
    if (fence) return
    if (/^\s*\|.*\|\s*$/.test(line)) {
      table.push({ line: index + 1, text: line })
    } else {
      flushTable()
    }
  })
  flushTable()
  if (fence) errors.push(`${label}:${fence.line} unclosed code fence`)
  return errors
}

module.exports = { splitTableRow, validateMarkdownStructure }
