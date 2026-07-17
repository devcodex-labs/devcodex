'use strict'

/**
 * Shared host agent identity for MCP memory/profile servers.
 * Keep VALID_AGENTS, normalizeAgent, and detectRuntimeAgent in one place.
 */

const VALID_AGENTS = new Set([
  'copilot',
  'vscode-copilot',
  'jetbrains-copilot',
  'claude-code',
  'codex',
  'cursor',
  'grok',
  'unknown-agent'
])

function normalizeAgent(value) {
  const agent = String(value || '').trim().toLowerCase()
  return VALID_AGENTS.has(agent) ? agent : ''
}

/**
 * Resolve the actual host agent for runtime writes.
 * Priority: explicit DEVCODEX_AGENT → host env signals → unknown-agent.
 * Never default to claude-code when the host is unrecognized (HOST-02 / R-26).
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function detectRuntimeAgent(env = process.env) {
  const explicit = normalizeAgent(env.DEVCODEX_AGENT)
  if (explicit) return explicit

  if (env.CLAUDE_CODE_VERSION || env.CLAUDE_HOOK_COMMAND) return 'claude-code'
  if (
    env.CODEX_HOME ||
    env.CODEX_SANDBOX ||
    env.OPENAI_CODEX ||
    env.CODEX_ENV_PWD
  ) {
    return 'codex'
  }
  if (isGrokHostEnv(env)) return 'grok'
  if (env.CURSOR_TRACE_ID || env.CURSOR_USER_ID) return 'cursor'
  if (env.IDEA_INITIAL_DIRECTORY || env.JETBRAINS_IDE) return 'jetbrains-copilot'
  if (env.TERM_PROGRAM === 'vscode' || env.VSCODE_PID) return 'vscode-copilot'

  return 'unknown-agent'
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {boolean}
 */
function isGrokHostEnv(env) {
  if (
    env.GROK_AGENT ||
    env.GROK_HOME ||
    env.GROK_SESSION ||
    env.GROK_SESSION_ID ||
    env.GROK_BUILD ||
    env.XAI_GROK ||
    env.XAI_AGENT
  ) {
    return true
  }
  const term = String(env.TERM_PROGRAM || '')
  if (/grok/i.test(term)) return true
  const app = String(env.TERM_PROGRAM_VERSION || env.VSCODE_GIT_ASKPASS_NODE || '')
  if (/grok/i.test(app)) return true
  // Session / config roots used by Grok Build TUI
  const homeHints = [env.GROK_CONFIG_DIR, env.USERPROFILE, env.HOME]
    .filter(Boolean)
    .map(String)
  for (const root of homeHints) {
    if (/[\\/]\.grok([\\/]|$)/i.test(root)) return true
  }
  return false
}

module.exports = {
  VALID_AGENTS,
  normalizeAgent,
  detectRuntimeAgent,
  isGrokHostEnv
}
