#!/usr/bin/env node
'use strict'

/**
 * SessionStart for Grok workspace plugin (W4).
 * PassivePassive: stdout is ignored for model context. We only stamp local session evidence
 * so doctor/debug can see DevCodex was active in this Grok session.
 */
const fs = require('fs')
const path = require('path')
const os = require('os')

function main() {
  const pluginData = process.env.GROK_PLUGIN_DATA
    || path.join(os.tmpdir(), 'devcodex-grok-plugin-data')
  const sessionId = process.env.GROK_SESSION_ID || 'unknown-session'
  const stampDir = path.join(pluginData, 'session-stamps')
  try {
    fs.mkdirSync(stampDir, { recursive: true })
    const stamp = {
      schemaVersion: 'GrokSessionStartStampV1',
      sessionId,
      stampedAt: new Date().toISOString(),
      cwd: process.cwd(),
      workspaceRoot: process.env.GROK_WORKSPACE_ROOT || process.env.CLAUDE_PROJECT_DIR || null,
      note: 'SessionStart cannot inject PC0; models must still emit entry-check. Prefer devcodex grok for Full kernel.'
    }
    fs.writeFileSync(
      path.join(stampDir, `${sessionId.replace(/[^\w.-]+/g, '_')}.json`),
      `${JSON.stringify(stamp, null, 2)}\n`,
      'utf8'
    )
  } catch {
    // fail-open
  }
  // PassivePassive event: exit 0; no model injection.
  process.exit(0)
}

main()
