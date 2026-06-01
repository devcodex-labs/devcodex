'use strict'

function buildLifecycleDangerousCommandUtils({
  path,
  crypto,
  CONTEXT_ROOT,
  APPROVAL_TTL_MS,
  DANGEROUS_PATTERNS,
  getToolName,
  getCommandText,
  INTERCEPTION_ACTION,
  recordInterception
}) {
  function isCommandTool(payload, platform) {
    const tn = getToolName(payload).toLowerCase()
    if (platform === 'claude') return tn === 'bash'
    return /terminal|shell|powershell|bash|^run[_-]?in[_-]?terminal$|^runcommand$|^command$/.test(tn)
  }

  function stripApprovalMarker(command) {
    return String(command || '')
      .replace(/(?:#\s*)?\bdevcodex-approve:([a-f0-9]{12})\b/ig, '')
      .replace(/\s+#\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function checkDangerousCommand(payload, platform) {
    if (!isCommandTool(payload, platform)) return null
    const cmd = getCommandText(payload)
    const readOnlySearch = /^\s*(?:rg|grep|Select-String)\b/i.test(cmd)
    if (readOnlySearch && !/[;&|`$()]/.test(cmd.replace(/["'][^"']*["']/g, ''))) return null
    const danger = DANGEROUS_PATTERNS.find(p => p.re.test(stripApprovalMarker(cmd)))
    if (!danger) return null
    return { ...danger, command: cmd }
  }

  function extractApprovalId(command) {
    const m = String(command || '').match(/\bdevcodex-approve:([a-f0-9]{12})\b/i)
    return m ? m[1].toLowerCase() : ''
  }

  function hashDangerousCommand(command, cwd) {
    const canonical = `${path.resolve(cwd || CONTEXT_ROOT)}\n${stripApprovalMarker(command)}`
    return crypto.createHash('sha256').update(canonical).digest('hex')
  }

  function pruneDangerousApprovals(state) {
    const approvals = state.dangerousApprovals || {}
    const now = Date.now()
    for (const [id, approval] of Object.entries(approvals)) {
      if (!approval || approval.used || now - Number(approval.createdAtMs || 0) > APPROVAL_TTL_MS) {
        delete approvals[id]
      }
    }
    state.dangerousApprovals = approvals
  }

  function createDangerousApproval(state, danger) {
    pruneDangerousApprovals(state)
    const commandHash = hashDangerousCommand(danger.command, CONTEXT_ROOT)
    const approvalId = commandHash.slice(0, 12)
    const existing = state.dangerousApprovals?.[approvalId]
    if (existing && !existing.used && existing.commandHash === commandHash && existing.cwd === path.resolve(CONTEXT_ROOT)) {
      return approvalId
    }
    state.dangerousApprovals[approvalId] = {
      commandHash,
      cwd: path.resolve(CONTEXT_ROOT),
      reason: danger.reason,
      status: 'pending',
      createdAt: new Date().toISOString(),
      createdAtMs: Date.now(),
      used: false
    }
    return approvalId
  }

  function extractApprovalIds(text) {
    return [...String(text || '').matchAll(/\bdevcodex-approve:([a-f0-9]{12})\b/ig)].map(match => match[1].toLowerCase())
  }

  function promptConfirmsDangerousApproval(prompt) {
    const text = String(prompt || '')
    if (/(?:不(?:确认|同意|批准|允许|执行)|不要|拒绝|deny|do\s+not|don't|not\s+approve)/i.test(text)) return false
    return /(?:确认|同意|批准|允许|执行|继续|重试|approve|approved|confirm|confirmed|yes|ok|okay|proceed|continue)/i.test(text)
  }

  function confirmDangerousApprovalsFromPrompt(state, prompt, eventName, platform) {
    pruneDangerousApprovals(state)
    const ids = extractApprovalIds(prompt)
    if (!ids.length || !promptConfirmsDangerousApproval(prompt)) return []
    const confirmed = []
    for (const approvalId of ids) {
      const approval = state.dangerousApprovals?.[approvalId]
      if (!approval || approval.used || approval.status === 'confirmed') continue
      approval.status = 'confirmed'
      approval.confirmedAt = new Date().toISOString()
      approval.confirmedBy = 'UserPromptSubmit'
      confirmed.push(approvalId)
      recordInterception(
        state, eventName, platform, INTERCEPTION_ACTION.LOG_ONLY, 'dangerous-command-confirmed',
        approval.reason || 'dangerous command approval confirmed',
        `Dangerous command approval ${approvalId} confirmed by user prompt.`, true
      )
    }
    return confirmed
  }

  function consumeDangerousApproval(state, danger) {
    pruneDangerousApprovals(state)
    const approvalId = extractApprovalId(danger.command)
    if (!approvalId) return { approved: false }
    const approval = state.dangerousApprovals?.[approvalId]
    const commandHash = hashDangerousCommand(danger.command, CONTEXT_ROOT)
    if (!approval || approval.used || approval.status !== 'confirmed' || approval.commandHash !== commandHash || approval.cwd !== path.resolve(CONTEXT_ROOT)) {
      return { approved: false, approvalId }
    }
    approval.used = true
    approval.status = 'used'
    approval.usedAt = new Date().toISOString()
    return { approved: true, approvalId }
  }

  return {
    isCommandTool,
    checkDangerousCommand,
    stripApprovalMarker,
    extractApprovalId,
    hashDangerousCommand,
    pruneDangerousApprovals,
    createDangerousApproval,
    extractApprovalIds,
    promptConfirmsDangerousApproval,
    confirmDangerousApprovalsFromPrompt,
    consumeDangerousApproval
  }
}

module.exports = { buildLifecycleDangerousCommandUtils }
