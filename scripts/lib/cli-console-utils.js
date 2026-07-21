'use strict'

/** Shared ANSI helpers and recursive directory walk for CLI entry modules. */

function createAnsiHelpers () {
  return {
    green: s => `\x1b[32m${s}\x1b[0m`,
    yellow: s => `\x1b[33m${s}\x1b[0m`,
    cyan: s => `\x1b[36m${s}\x1b[0m`,
    red: s => `\x1b[31m${s}\x1b[0m`,
    bold: s => `\x1b[1m${s}\x1b[0m`,
    dim: s => `\x1b[2m${s}\x1b[0m`
  }
}

function walkDir (fs, dir) {
  if (!fs.existsSync(dir)) return []
  const results = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = require('path').join(dir, entry.name)
    if (entry.isDirectory()) results.push(...walkDir(fs, full))
    else results.push(full)
  }
  return results
}

module.exports = {
  createAnsiHelpers,
  walkDir
}
