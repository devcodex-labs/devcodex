'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase()
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex').toUpperCase()
}

/**
 * Parse sessions.md CP rows. Supports legacy 3-col and digest-extended tables.
 * Extended: | CP | status | artifactPath | version | sha256 | sourceMessage | confirmedAt |
 */
function parseCpSessions(text) {
  const rows = {
    CP1: null,
    CP2: null,
    CP3: null,
    CP3Exempt: false
  }
  if (!text) return rows

  if (/(?:\|\s*CP3\s*\|\s*N\/A\b|CP3\s*[:：]\s*N\/A)/i.test(text)) {
    rows.CP3Exempt = true
  }

  // Match legacy `| CP1 | ✅ |`, `| CP1 | ✅ | time |`, and digest-extended rows.
  const lineRe = /^\|\s*(CP[123])\s*\|\s*([^|\n]+)\|(.*)$/gm
  let m
  while ((m = lineRe.exec(text)) !== null) {
    const phase = m[1]
    const statusCell = m[2].trim()
    const rest = (m[3] || '').trim()
    const confirmed = statusCell.includes('✅')
    const stale = /stale/i.test(statusCell)
    const cells = rest
      .split('|')
      .map(c => c.trim())
      .filter(c => c.length > 0)
    // legacy: time only (0–1 cells)
    // extended: path | version | sha256 | sourceMessage | confirmedAt
    let artifactPath = null
    let artifactVersion = null
    let artifactSha256 = null
    let sourceMessage = null
    let confirmedAt = null
    if (cells.length >= 5) {
      artifactPath = cells[0] || null
      artifactVersion = cells[1] || null
      artifactSha256 = (cells[2] || '').replace(/`/g, '').toUpperCase() || null
      sourceMessage = cells[3] || null
      confirmedAt = cells[4] || null
    } else if (cells.length === 1) {
      confirmedAt = cells[0]
    }
    rows[phase] = {
      confirmed: confirmed && !stale,
      stale,
      artifactPath,
      artifactVersion,
      artifactSha256,
      sourceMessage,
      confirmedAt
    }
  }
  if (rows.CP3Exempt) {
    rows.CP3 = rows.CP3 || { confirmed: true, stale: false, artifactPath: null, artifactVersion: null, artifactSha256: null, sourceMessage: null, confirmedAt: null }
    rows.CP3.confirmed = true
  }
  return rows
}

function verifyArtifactDigest(taskRoot, row) {
  if (!row || !row.confirmed) return { ok: true, reason: 'not-confirmed' }
  if (!row.artifactSha256) return { ok: true, reason: 'legacy-no-digest', legacy: true }
  if (!row.artifactPath) return { ok: false, reason: 'missing-artifact-path' }
  const cleaned = row.artifactPath.replace(/^`|`$/g, '').replace(/^\.\//, '')
  const candidates = [
    path.join(taskRoot, cleaned),
    path.join(taskRoot, path.basename(cleaned)),
    path.isAbsolute(cleaned) ? cleaned : null
  ].filter(Boolean)
  // Also resolve relative to parent of .memory (task root is already that)
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      const actual = sha256File(candidate)
      if (actual === row.artifactSha256) return { ok: true, reason: 'match', actual }
      return { ok: false, reason: 'digest-mismatch', actual, expected: row.artifactSha256, file: candidate }
    }
  }
  return { ok: false, reason: 'artifact-missing', expectedPath: cleaned }
}

function buildExtendedCpTable({ phases }) {
  const lines = [
    '### CP 确认记录',
    '',
    '| CP | 状态 | artifactPath | version | sha256 | sourceMessage | confirmedAt |',
    '|:--:|:----:|--------------|---------|--------|---------------|-------------|'
  ]
  for (const phase of ['CP1', 'CP2', 'CP3']) {
    const row = phases[phase] || { status: '⏹️' }
    lines.push(
      `| ${phase} | ${row.status || '⏹️'} | ${row.artifactPath || '—'} | ${row.artifactVersion || '—'} | ${row.artifactSha256 || '—'} | ${row.sourceMessage || '—'} | ${row.confirmedAt || '—'} |`
    )
  }
  lines.push('')
  return lines.join('\n')
}

module.exports = {
  sha256File,
  sha256Text,
  parseCpSessions,
  verifyArtifactDigest,
  buildExtendedCpTable
}
