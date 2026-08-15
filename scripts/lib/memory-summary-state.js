'use strict'

function summarySessionKey(row) {
  if (!row || !row.day || !row.sessionId || row.sessionIdCanonical !== true) return null
  return `${row.day}#${row.sessionId}`
}

function foldSummaryRows(rows = []) {
  const current = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = summarySessionKey(row) || `noncanonical-row:${row?.rowNumber ?? current.size}`
    // SUMMARY is an append-only event log. The last event for a canonical
    // day/session identity is the current projection; prior rows remain audit history.
    current.set(key, row)
  }
  return [...current.values()].sort((left, right) => Number(left?.rowNumber || 0) - Number(right?.rowNumber || 0))
}

function rowsByCurrentState(rows = [], state = 'all') {
  if (state === 'all') return Array.isArray(rows) ? rows : []
  const current = foldSummaryRows(rows)
  if (state === 'unresolved') return current.filter(row => row.state === 'active' || row.state === 'blocked')
  return current.filter(row => row.state === state)
}

function summaryStateConflicts(rows = []) {
  const bySession = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = summarySessionKey(row)
    if (!key) continue
    if (!bySession.has(key)) bySession.set(key, [])
    bySession.get(key).push(row)
  }
  const conflicts = []
  for (const [sessionKey, sessionRows] of bySession.entries()) {
    let completed = false
    let terminalRegression = false
    const states = new Set()
    for (const row of sessionRows.slice().sort((left, right) => Number(left?.rowNumber || 0) - Number(right?.rowNumber || 0))) {
      if (row.state === 'unknown') continue
      states.add(row.state)
      if (completed && row.state !== 'completed') terminalRegression = true
      if (row.state === 'completed') completed = true
    }
    if (terminalRegression) conflicts.push({ sessionKey, states: [...states].sort() })
  }
  return conflicts
}

function currentActiveSessionIds(rows = []) {
  return foldSummaryRows(rows)
    .slice()
    .reverse()
    .filter(row => row.state === 'active' && row.sessionIdCanonical === true)
    .map(row => summarySessionKey(row))
}

module.exports = {
  currentActiveSessionIds,
  foldSummaryRows,
  rowsByCurrentState,
  summarySessionKey,
  summaryStateConflicts
}
