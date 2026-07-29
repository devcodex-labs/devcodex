#!/usr/bin/env node
'use strict'

const { execFileSync } = require('child_process')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const checks = [
  ['generate-control-content.js', '--check'],
  ['extract-control-content-fragments.js', '--check'],
  ['analyze-control-content-duplication.js', '--check']
]

for (const [script, flag] of checks) {
  try {
    const output = execFileSync(process.execPath, [path.join(__dirname, script), flag], {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true
    })
    if (output.trim()) process.stderr.write(`${output.trim()}\n`)
  } catch (error) {
    if (error.stdout) process.stderr.write(String(error.stdout))
    if (error.stderr) process.stderr.write(String(error.stderr))
    process.exit(error.status || 1)
  }
}
