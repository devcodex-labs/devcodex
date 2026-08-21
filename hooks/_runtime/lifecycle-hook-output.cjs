'use strict'

function formatProgressiveSkillRouteRecoveryCard(coordination) {
  if (coordination.noticeSuppressed) {
    return 'Progressive Skill route remains blocked with no state change; continue with the previously emitted structured next action.'
  }
  const envelope = coordination.envelope || {}
  const lines = [coordination.message || 'Progressive Skill route reconciliation is required.']
  if (envelope.nextCall && typeof envelope.nextCall === 'object') {
    lines.push(`Next call (exact): ${JSON.stringify(envelope.nextCall)}`)
    if (envelope.nextOp === 'load_stage') {
      lines.push(
        'Allowed proactive alternative before this load_stage: call profile_context_plan once with the same project/contextEpoch; if selected, complete refreshed ContextRead and skill_route rebind before any load_stage.'
      )
    }
  } else {
    lines.push(
      `Route status: ${envelope.status || 'blocked'}; ` +
      `nextOp: ${envelope.nextOp || 'none'}; ` +
      `errorCode: ${envelope.errorCode || 'none'}.`
    )
    if (envelope.mustReplyCore) lines.push(`Required reply: ${envelope.mustReplyCore}`)
    if (envelope.recovery?.action) lines.push(`Recovery: ${envelope.recovery.action}`)
  }
  return lines.join('\n')
}

function buildLifecycleHookOutput({ env, enforcementMode }) {
  function detectPlatform(payload) {
    const explicitHost = String(env.DEVCODEX_HOST_PLATFORM || '').trim().toLowerCase()
    if (['copilot', 'claude', 'codex', 'gemini', 'grok', 'cursor'].includes(explicitHost)) return explicitHost
    if (env.GEMINI_CLI || env.GEMINI_SESSION_ID) return 'gemini'
    if (env.CLAUDE_CODE_VERSION || env.CLAUDE_HOOK_COMMAND) return 'claude'
    if (env.CODEX_SANDBOX || env.CODEX_HOME || env.OPENAI_CODEX) return 'codex'
    if (
      env.GROK_AGENT ||
      env.GROK_HOME ||
      env.GROK_SESSION ||
      env.GROK_SESSION_ID ||
      env.GROK_BUILD ||
      env.XAI_GROK ||
      env.XAI_AGENT ||
      /grok/i.test(String(env.TERM_PROGRAM || ''))
    ) {
      return 'grok'
    }
    if (env.CURSOR_TRACE_ID || env.CURSOR_USER_ID || env.CURSOR_PROJECT_DIR || env.CURSOR_VERSION) return 'cursor'
    if (env.IDEA_INITIAL_DIRECTORY || env.JETBRAINS_IDE) return 'jetbrains-copilot'
    const toolName = String(payload.tool_name || payload.toolName || '').trim()
    if (toolName && /^[A-Z]/.test(toolName)) return 'claude'
    if (env.TERM_PROGRAM === 'vscode') return 'vscode-copilot'
    return 'copilot'
  }

  function noopOutput() {
    return { continue: true }
  }

  function isStrictEnforcement() {
    return enforcementMode === 'strict'
  }

  function decorateHookOutput(output, meta = {}) {
    if (!meta || !Object.keys(meta).length) return output
    const next = { ...output }
    const hasPermissionCarrier = next?.hookSpecificOutput &&
      Object.prototype.hasOwnProperty.call(next.hookSpecificOutput, 'permissionDecision')
    const target = hasPermissionCarrier
      ? { ...next.hookSpecificOutput }
      : next
    for (const [key, value] of Object.entries(meta)) {
      if (value !== undefined && value !== null && value !== '') target[key] = value
    }
    if (hasPermissionCarrier) next.hookSpecificOutput = target
    return next
  }

  function normalizeHookEvent(eventName) {
    return String(eventName || '').trim().toLowerCase().replace(/[^a-z]/g, '')
  }

  function toolBlockOutput(eventName, reason, detail) {
    return {
      continue: true,
      systemMessage: `DevCodex hook: ${reason}`,
      hookSpecificOutput: {
        hookEventName: eventName || 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
        additionalContext: detail || reason
      }
    }
  }

  function blockOutput(platform, eventName, reason, detail) {
    const event = normalizeHookEvent(eventName)
    const message = detail || reason
    if (platform === 'codex') {
      if (['pretooluse', 'permissionrequest'].includes(event)) {
        return toolBlockOutput(eventName, reason, detail)
      }
      if (['precompact', 'postcompact'].includes(event)) {
        return { continue: false, suppressOutput: false, stopReason: message }
      }
      if (['userpromptsubmit', 'stop', 'subagentstop', 'agentstop'].includes(event)) {
        return { decision: 'block', reason: message }
      }
      return toolBlockOutput(eventName, reason, detail)
    }
    if (platform === 'claude') {
      if (event === 'pretooluse') return toolBlockOutput(eventName, reason, detail)
      return { decision: 'block', reason: message }
    }
    if (platform === 'gemini') {
      if (event === 'precompact') return { continue: true, systemMessage: message }
      return { decision: 'deny', reason: message }
    }
    if (platform === 'copilot') {
      if (event === 'pretooluse') return toolBlockOutput(eventName, reason, detail)
      if (['stop', 'agentstop', 'subagentstop'].includes(event)) return { decision: 'block', reason: message }
      return { continue: true, systemMessage: message }
    }
    if (platform === 'grok') {
      if (event === 'pretooluse' || event === 'permissionrequest') {
        return { decision: 'deny', reason: message }
      }
      // Official Grok Stop Decision Control: decision:block + reason fed back to the model.
      if (['stop', 'subagentstop', 'agentstop'].includes(event)) {
        return { decision: 'block', reason: message }
      }
      return { continue: true, systemMessage: message }
    }
    if (platform === 'cursor') {
      if (event === 'pretooluse' || event === 'permissionrequest') {
        return toolBlockOutput(eventName, reason, detail)
      }
      if (event === 'userpromptsubmit') {
        return { decision: 'block', reason: message }
      }
      if (['stop', 'subagentstop', 'agentstop'].includes(event)) {
        return { decision: 'block', reason: message }
      }
      return { continue: true, systemMessage: message }
    }
    return toolBlockOutput(eventName, reason, detail)
  }

  function systemMessageOutput(message) {
    return { continue: true, systemMessage: message }
  }

  function contextMessageOutput(eventName, message, meta = {}) {
    const hookSpecificOutput = {
      hookEventName: eventName,
      additionalContext: message
    }
    for (const [key, value] of Object.entries(meta || {})) {
      if (value !== undefined && value !== null && value !== '') hookSpecificOutput[key] = value
    }
    return {
      continue: true,
      systemMessage: message,
      hookSpecificOutput
    }
  }

  function warningOutput(reason, detail, eventName) {
    const message = `DevCodex hook warning: ${reason}${detail ? ` — ${detail}` : ''}`
    if (eventName === 'UserPromptSubmit') return contextMessageOutput(eventName, message)
    return systemMessageOutput(message)
  }

  function eventSupportsHardBlock(platform, eventName) {
    const event = normalizeHookEvent(eventName)
    if (platform === 'jetbrains-copilot' || platform === 'vscode-copilot') return false
    if (platform === 'claude') {
      return ['pretooluse', 'userpromptsubmit', 'posttooluse', 'stop', 'subagentstop', 'agentstop', 'precompact', 'configchange'].includes(event)
    }
    if (platform === 'codex') {
      return ['pretooluse', 'permissionrequest', 'userpromptsubmit', 'stop', 'subagentstop', 'agentstop', 'precompact', 'postcompact'].includes(event)
    }
    if (platform === 'gemini') return ['pretooluse', 'userpromptsubmit', 'stop'].includes(event)
    if (platform === 'copilot') {
      return ['pretooluse', 'stop', 'agentstop', 'subagentstop'].includes(event)
    }
    // Grok Build: PreToolUse deny + Stop/SubagentStop block (official Stop Decision Control).
    // UserPromptSubmit remains non-hard for inject; UPS inject still not claimed.
    if (platform === 'grok') {
      return ['pretooluse', 'permissionrequest', 'stop', 'subagentstop', 'agentstop'].includes(event)
    }
    if (platform === 'cursor') {
      return ['pretooluse', 'permissionrequest', 'userpromptsubmit', 'stop', 'subagentstop', 'agentstop'].includes(event)
    }
    return ['pretooluse', 'permissionrequest'].includes(event)
  }

  return {
    detectPlatform,
    noopOutput,
    isStrictEnforcement,
    decorateHookOutput,
    blockOutput,
    systemMessageOutput,
    contextMessageOutput,
    formatProgressiveSkillRouteRecoveryCard,
    warningOutput,
    eventSupportsHardBlock,
    normalizeHookEvent
  }
}

module.exports = {
  buildLifecycleHookOutput,
  formatProgressiveSkillRouteRecoveryCard
}
