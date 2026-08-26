'use strict'

function buildLifecycleDangerousCommandUtils({
  path,
  crypto,
  CONTEXT_ROOT,
  WORKSPACE_ROOT,
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
      .replace(/[ \t]+#[ \t]*(?=\r?$)/gm, '')
      .replace(/[ \t]+/g, ' ')
      .trim()
  }

  const SAFE_TEXT_OPERATIONS = new Set([
    'echo', 'findstr', 'grep', 'out-file', 'printf', 'rg', 'select-string',
    'set-content', 'add-content', 'write-host', 'write-output'
  ])
  const DIRECT_DANGEROUS_OPERATIONS = new Set([
    'del', 'delete', 'drop', 'remove-item', 'rm', 'truncate'
  ])

  function maskHereDocumentBodies(command) {
    const raw = String(command || '')
    const chars = [...raw]
    const opener = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_-]*)\1[^\r\n]*(?:\r?\n|$)/g
    let match
    while ((match = opener.exec(raw)) !== null) {
      if (!match[0].endsWith('\n')) continue
      const marker = match[2]
      const bodyStart = match.index + match[0].length
      const terminator = new RegExp(`^\\s*${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm')
      const tail = raw.slice(bodyStart)
      const end = terminator.exec(tail)
      if (!end) continue
      const bodyEnd = bodyStart + end.index
      for (let index = bodyStart; index < bodyEnd; index++) chars[index] = ' '
      opener.lastIndex = bodyEnd
    }
    return chars.join('')
  }

  /**
   * Produce a same-length shell surface with data literals/comments removed.
   * Command verbs, switches and separators remain visible for operation-level
   * classification; quoted documentation/search text cannot masquerade as an
   * executed destructive operation.
   */
  function maskShellDataLiterals(command) {
    const raw = maskHereDocumentBodies(command)
    const chars = [...raw]
    let quote = ''
    let maskQuotedBody = true
    for (let index = 0; index < chars.length; index++) {
      const ch = chars[index]
      if (quote) {
        if ((ch === '\\' || ch === '`') && quote === '"' && index + 1 < chars.length) {
          if (maskQuotedBody) {
            chars[index] = ' '
            chars[index + 1] = ' '
          }
          index += 1
          continue
        }
        if (ch === quote) {
          if (quote === '\'' && chars[index + 1] === '\'') {
            chars[index] = ' '
            chars[index + 1] = ' '
            index += 1
            continue
          }
          quote = ''
          maskQuotedBody = true
          continue
        }
        if (maskQuotedBody) chars[index] = ' '
        continue
      }
      if (ch === '\'' || ch === '"') {
        quote = ch
        if (ch === '"') {
          let closing = index + 1
          while (closing < raw.length) {
            if ((raw[closing] === '\\' || raw[closing] === '`') && closing + 1 < raw.length) {
              closing += 2
              continue
            }
            if (raw[closing] === '"') break
            closing += 1
          }
          const body = raw.slice(index + 1, closing)
          maskQuotedBody = !/\$\(|`/.test(body)
        }
        continue
      }
      if (ch === '#' && (index === 0 || /\s/.test(chars[index - 1]))) {
        while (index < chars.length && chars[index] !== '\r' && chars[index] !== '\n') {
          chars[index] = ' '
          index += 1
        }
        index -= 1
      }
    }
    return chars.join('')
  }

  function splitCommandSyntax(command, separators, inheritedSurface = null) {
    const raw = String(command || '')
    const surface = inheritedSurface === null
      ? maskShellDataLiterals(raw)
      : String(inheritedSurface)
    const parts = []
    let start = 0
    for (let index = 0; index < surface.length; index++) {
      const ch = surface[index]
      const pair = surface.slice(index, index + 2)
      const splitPair = separators.has(pair)
      const splitSingle = separators.has(ch)
      if (!splitPair && !splitSingle) continue
      const end = index
      const rawPart = raw.slice(start, end).trim()
      const surfacePart = surface.slice(start, end).trim()
      if (rawPart || surfacePart) parts.push({ raw: rawPart, surface: surfacePart })
      index += splitPair ? 1 : 0
      start = index + 1
    }
    const rawPart = raw.slice(start).trim()
    const surfacePart = surface.slice(start).trim()
    if (rawPart || surfacePart) parts.push({ raw: rawPart, surface: surfacePart })
    return parts
  }

  function firstOperation(surface) {
    let value = String(surface || '').trim()
    value = value.replace(/^(?:&\s*)?(?:sudo\s+|env\s+)*/i, '')
    const match = value.match(/^([A-Za-z][A-Za-z0-9_.-]*)\b/)
    return match ? match[1].toLowerCase() : ''
  }

  function hasLiteralExecutionSink(surface) {
    const value = String(surface || '')
    return /\$\(|`[^`\r\n]+`/.test(value) ||
      /\b(?:bash|dash|ksh|sh|zsh)\b\s+(?:-[A-Za-z]*c\b|--command\b)/i.test(value) ||
      /\b(?:powershell|pwsh)(?:\.exe)?\b[\s\S]*?(?:-command|-c)\b/i.test(value) ||
      /\bcmd(?:\.exe)?\b\s*\/[ck]\b/i.test(value) ||
      /\b(?:iex|invoke-expression|eval)\b/i.test(value) ||
      /\|\s*(?:bash|dash|ksh|sh|zsh|iex|invoke-expression)\b/i.test(value) ||
      /\b(?:mysql|psql)\b[\s\S]*?\s-(?:e|c)\b/i.test(value) ||
      /\bsqlcmd\b[\s\S]*?\s-Q\b/i.test(value) ||
      /\bsqlite3\b[\s\S]*?\s+["']/i.test(value)
  }

  function classifyCommandSyntax(command) {
    const groups = splitCommandSyntax(command, new Set([';', '\r', '\n', '&&', '||']))
    return groups.map(group => ({
      ...group,
      literalExecutionSink: hasLiteralExecutionSink(group.surface),
      stages: splitCommandSyntax(group.raw, new Set(['|']), group.surface).map(stage => {
        const operation = firstOperation(stage.surface)
        return {
          ...stage,
          operation,
          safeTextCarrier: SAFE_TEXT_OPERATIONS.has(operation),
          directDangerousOperation: DIRECT_DANGEROUS_OPERATIONS.has(operation) ||
            (operation === 'git' && /\bgit\s+reset\b/i.test(stage.surface))
        }
      })
    }))
  }

  function findExecutedDanger(command) {
    for (const group of classifyCommandSyntax(command)) {
      if (group.literalExecutionSink) {
        const danger = DANGEROUS_PATTERNS.find(pattern => pattern.re.test(group.raw))
        if (danger) return danger
      }
      for (const stage of group.stages) {
        const candidate = stage.directDangerousOperation ? stage.raw : stage.surface
        if (stage.safeTextCarrier && !stage.directDangerousOperation) continue
        const danger = DANGEROUS_PATTERNS.find(pattern => pattern.re.test(candidate))
        if (danger) return danger
      }
    }
    return null
  }

  /** Recursive inventory markers (R-02: dir /s must match; avoid \\b before /). */
  function commandHasRecursiveInventory(cmd) {
    if (/-Recurse/i.test(cmd)) return true
    if (/\bdir\s+\/s\b/i.test(cmd)) return true
    if (/\b(?:Get-ChildItem|gci)\b/i.test(cmd) && /-\s*Depth\s*[1-9]/i.test(cmd)) return true
    // find inventory (not findstr); C16 bans unbounded find at workspace root
    if (/\bfind\s+/i.test(cmd) && !/\bfindstr\b/i.test(cmd)) return true
    return false
  }

  function resolveToolCwd(payload) {
    const input = (payload && (payload.tool_input || payload.toolInput)) || {}
    const raw = input.cwd || input.working_directory || input.workingDirectory || input.workingDir
    if (raw && String(raw).trim()) {
      try { return path.resolve(String(raw).trim()) } catch { /* fall through */ }
    }
    try { return path.resolve(CONTEXT_ROOT || '.') } catch { return '' }
  }

  /**
   * True when command names an explicit path segment under workspace root
   * e.g. E:\Worker\queuebit or E:\Worker\queuebit\docs (R-04: no trailing slash required).
   */
  function commandTargetsWorkspaceChild(cmdLower, rootLower) {
    const rootInCommand = rootLower.replace(/\//g, '\\')
    const escaped = rootInCommand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(escaped + '[\\\\/][a-z0-9._-]+', 'i').test(cmdLower)
  }

  function isPathSwitchToken(tok) {
    const t = String(tok || '').replace(/^["']|["']$/g, '')
    if (!t) return true
    // PowerShell / cmd switches are not project paths (R-02: /s must not count as child)
    if (/^-\w/.test(t) || /^\/[a-z0-9?]+$/i.test(t)) return true
    if (t === '.' || t === '.\\' || t === './' || t === '..') return true
    // bare integers are switch values (e.g. -Depth 3), not paths
    if (/^\d+$/.test(t)) return true
    return false
  }

  /** Switches that consume the following token as a value, not a path. */
  const VALUE_TAKING_SWITCHES = new Set([
    '-depth', '-filter', '-include', '-exclude', '-name', '-literalpath',
    '-path', '-file', '-attributes', '-newerthan', '-olderthan'
  ])

  /**
   * Relative/project child path token (e.g. queuebit, .\docs, -Path queuebit) — not bare "." / switches.
   */
  function commandHasRelativeChildPath(cmd) {
    const s = String(cmd || '')
    const pathFlag = s.match(/-Path\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i)
    if (pathFlag) {
      const tok = String(pathFlag[1] || pathFlag[2] || pathFlag[3] || '').replace(/^["']|["']$/g, '')
      if (tok && !isPathSwitchToken(tok) && !/^[A-Za-z]:[\\/]*$/.test(tok)) {
        return true
      }
    }
    // positional path: Get-ChildItem queuebit -Recurse (skip switches and their values)
    const after = s.match(/\b(?:Get-ChildItem|gci|dir)\b([\s\S]*)$/i)
    if (!after) return false
    const tokens = String(after[1] || '').match(/(?:"[^"]+"|'[^']+'|[^\s]+)/g) || []
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i].replace(/^["']|["']$/g, '')
      if (isPathSwitchToken(tok)) {
        if (VALUE_TAKING_SWITCHES.has(tok.toLowerCase()) && i + 1 < tokens.length) {
          i += 1 // skip switch value
        }
        continue
      }
      // first non-switch token is a path candidate
      return /[a-z0-9._-]/i.test(tok)
    }
    return false
  }

  /**
   * C16 / PI-20260724-01: ban recursive inventory rooted at monorepo/workspace root.
   * Allows project-scoped recurse when path contains <workspaceRoot>/<child>...
   * R-03: also ban relative recurse when cwd === workspace root and no child path token.
   * @param {string} command
   * @param {string} workspaceRoot
   * @param {{ cwd?: string }} [options]
   */
  function isWorkspaceRootRecursiveInventory(command, workspaceRoot, options = {}) {
    const cmd = stripApprovalMarker(command)
    if (!cmd || !commandHasRecursiveInventory(cmd)) return false
    const rootFs = path.resolve(String(workspaceRoot || CONTEXT_ROOT || '').trim() || '.')
    if (!rootFs || rootFs.length < 2) return false
    const rootLower = rootFs.replace(/[\\/]+$/, '').toLowerCase()
    const cmdLower = cmd.replace(/\//g, '\\').toLowerCase()
    const rootAlt = rootLower.replace(/\\/g, '/')
    const mentionsRoot =
      cmdLower.includes(rootLower) ||
      cmd.replace(/\\/g, '/').toLowerCase().includes(rootAlt)

    if (mentionsRoot) {
      if (commandTargetsWorkspaceChild(cmdLower, rootLower)) return false
      return true
    }

    // R-03: cwd is workspace root + recursive inventory without absolute root literal
    let cwdResolved = ''
    try {
      cwdResolved = path.resolve(String(options.cwd || CONTEXT_ROOT || '').trim() || '.').replace(/[\\/]+$/, '')
    } catch {
      cwdResolved = ''
    }
    const cwdIsRoot = cwdResolved && cwdResolved.toLowerCase() === rootLower
    if (!cwdIsRoot) return false
    if (commandHasRelativeChildPath(cmd)) return false
    return true
  }

  /**
   * Host skill inventory roots under the user profile (privacy + UX).
   * Listing these surfaces absolute home paths (e.g. C:\\Users\\…\\.grok\\skills) in the process UI.
   * Allow reading a single known SKILL.md under G_RUNTIME; ban directory inventory of host skill trees.
   */
  function normalizePathSlash (p) {
    return String(p || '').replace(/\\/g, '/').toLowerCase()
  }

  function isHostSkillInventoryTarget (targetPath) {
    const n = normalizePathSlash(targetPath)
    if (!n) return false
    // A caller that already knows the exact skill body is reading one file,
    // not enumerating a host catalog. This includes Codex system/plugin skills
    // as well as the DevCodex G_RUNTIME projection. Directory roots remain
    // blocked below.
    if (/\/(?:\.grok\/(?:bundled\/)?skills|\.claude\/skills|\.codex\/skills|\.gemini\/skills|\.copilot\/skills|\.agents\/(?:devcodex\/)?skills)\/.+\/skill\.md$/i.test(n)) return false
    if (/\/\.agents\/devcodex\/skills\/[^/]+$/i.test(n)) return false
    const bans = [
      /\/\.grok\/skills(?:\/|$)/,
      /\/\.grok\/bundled\/skills(?:\/|$)/,
      /\/\.claude\/skills(?:\/|$)/,
      /\/\.codex\/skills(?:\/|$)/,
      /\/\.gemini\/skills(?:\/|$)/,
      /\/\.copilot\/skills(?:\/|$)/,
      /\/\.agents\/skills(?:\/|$)/,
      /\/\.agents\/devcodex\/skills\/?$/
    ]
    return bans.some(re => re.test(n))
  }

  function extractListingTargets (payload) {
    const input = (payload && (payload.tool_input || payload.toolInput)) || {}
    const out = []
    for (const key of ['path', 'target_directory', 'targetDirectory', 'directory', 'dir', 'root', 'cwd']) {
      if (typeof input[key] === 'string' && input[key].trim()) out.push(input[key].trim())
    }
    if (Array.isArray(input.paths)) {
      for (const p of input.paths) if (typeof p === 'string' && p.trim()) out.push(p.trim())
    }
    const cmd = typeof input.command === 'string' ? input.command : getCommandText(payload)
    if (cmd) {
      const m = String(cmd).match(
        /(?:Get-ChildItem|gci|dir|ls|list_dir|find)\b[\s\S]{0,200}?([A-Za-z]:\\[^\s"'|]+|~\/[^\s"'|]+|\/(?:Users|home)\/[^\s"'|]+)/i
      )
      if (m && m[1]) out.push(m[1])
      // also catch quoted paths
      const q = String(cmd).match(/["']([A-Za-z]:\\[^"']+\.?(?:grok|claude|agents|codex)[^"']*)["']/i)
      if (q && q[1]) out.push(q[1])
    }
    return out
  }

  function isListingStyleTool (payload, platform) {
    const tn = getToolName(payload).toLowerCase()
    if (/list|ls|glob|dir|find|scandir|listdir|skill/.test(tn)) return true
    if (isCommandTool(payload, platform)) {
      const cmd = getCommandText(payload)
      return classifyCommandSyntax(cmd).some(group => group.stages.some(stage =>
        !stage.safeTextCarrier && /\b(?:Get-ChildItem|gci|dir|ls|find)\b/i.test(stage.surface)
      ))
    }
    return false
  }

  /**
   * Block host skill directory inventory so process UI does not leak user-home skill paths.
   * @returns {null|{reason:string,neverApprove:boolean,code:string,command?:string}}
   */
  function checkHostSkillInventoryListing (payload, platform) {
    if (!payload) return null
    const tn = getToolName(payload).toLowerCase()
    // Native Skill tool browsing host catalogs
    if (/\bskill\b/.test(tn) && !/skill\.md|read/i.test(tn)) {
      const targets = extractListingTargets(payload)
      const hay = JSON.stringify(payload.tool_input || payload.toolInput || {}).toLowerCase()
      if (/[\\/]\.grok[\\/](bundled[\\/])?skills|[\\/]\.agents[\\/]skills|[\\/]\.claude[\\/]skills/.test(hay) ||
          targets.some(isHostSkillInventoryTarget)) {
        return {
          reason: 'Blocked: host skill inventory under user profile (privacy); do not list ~/.grok/skills or bundled skills. Read a single known SKILL.md under .devcodex/workspace/skills/<id> or ~/.agents/devcodex/skills/<id> only.',
          neverApprove: true,
          code: 'host-skill-inventory-ban'
        }
      }
    }
    // Path text alone is not an inventory operation. This early return is also
    // what keeps source searches for host-path examples from becoming a ban.
    if (!isListingStyleTool(payload, platform)) return null
    const targets = extractListingTargets(payload)
    for (const t of targets) {
      if (isHostSkillInventoryTarget(t)) {
        return {
          reason: 'Blocked: host skill inventory under user profile (privacy); process UI must not list C:\\Users\\… skill roots. Use exact path to one SKILL.md (workspace or ~/.agents/devcodex/skills/<id>/SKILL.md).',
          neverApprove: true,
          code: 'host-skill-inventory-ban',
          command: getCommandText(payload) || t
        }
      }
    }
    // Shell inventory without extracted path but mentioning host skill roots
    if (isCommandTool(payload, platform)) {
      const cmd = String(getCommandText(payload) || '')
      if (/[\\/]\.grok[\\/](?:bundled[\\/])?skills|[\\/]\.agents[\\/]skills(?![\\/]devcodex)|[\\/]\.claude[\\/]skills/i.test(cmd) &&
          isListingStyleTool(payload, platform)) {
        return {
          reason: 'Blocked: host skill inventory under user profile (privacy); do not list ~/.grok/skills or similar host skill trees.',
          neverApprove: true,
          code: 'host-skill-inventory-ban',
          command: cmd
        }
      }
    }
    return null
  }

  function checkDangerousCommand(payload, platform) {
    const hostSkillBan = checkHostSkillInventoryListing(payload, platform)
    if (hostSkillBan) return hostSkillBan
    if (!isCommandTool(payload, platform)) return null
    const cmd = getCommandText(payload)
    const stripped = stripApprovalMarker(cmd)
    const workspaceRoot = WORKSPACE_ROOT || CONTEXT_ROOT
    const cwd = resolveToolCwd(payload)
    for (const group of classifyCommandSyntax(stripped)) {
      for (const stage of group.stages) {
        if (stage.safeTextCarrier || !commandHasRecursiveInventory(stage.surface)) continue
        if (isWorkspaceRootRecursiveInventory(stage.raw, workspaceRoot, { cwd })) {
          return {
            re: null,
            reason: 'Blocked: workspace-root recursive inventory (C16/TTFV/PI-20260724-01); bind project path (Test-Path / list_dir one level)',
            neverApprove: true,
            command: cmd,
            code: 'workspace-root-scan-ban'
          }
        }
      }
    }
    const danger = findExecutedDanger(stripped)
    if (!danger) return null
    return { ...danger, command: cmd, cwd }
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
    const resolvedCwd = path.resolve(String(danger.cwd || CONTEXT_ROOT))
    const commandHash = hashDangerousCommand(danger.command, resolvedCwd)
    const approvalId = commandHash.slice(0, 12)
    const existing = state.dangerousApprovals?.[approvalId]
    if (existing && !existing.used && existing.commandHash === commandHash && existing.cwd === resolvedCwd) {
      return approvalId
    }
    state.dangerousApprovals[approvalId] = {
      commandHash,
      cwd: resolvedCwd,
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
    const resolvedCwd = path.resolve(String(danger.cwd || CONTEXT_ROOT))
    const commandHash = hashDangerousCommand(danger.command, resolvedCwd)
    if (!approval || approval.used || approval.status !== 'confirmed' || approval.commandHash !== commandHash || approval.cwd !== resolvedCwd) {
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
    checkHostSkillInventoryListing,
    isHostSkillInventoryTarget,
    classifyCommandSyntax,
    findExecutedDanger,
    stripApprovalMarker,
    isWorkspaceRootRecursiveInventory,
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
