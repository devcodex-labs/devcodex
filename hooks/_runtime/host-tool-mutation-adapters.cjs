'use strict'

const { sha256, stableStringify } = require('./content-identity.cjs')

const ADAPTER_SCHEMA = 'HostToolMutationAdapterDecisionV1'
const REGISTRY_SCHEMA = 'HostToolMutationAdapterRegistryV1'
const DIGEST_RE = /^[a-f0-9]{64}$/
const MAX_CLASSIFICATION_BYTES = 512 * 1024

const DIRECT_WRITE_TOOLS = new Set([
  'write', 'edit', 'create_file', 'create-file', 'write_file', 'write-file',
  'replace', 'replace_file_content', 'replace-file-content', 'str_replace',
  'str-replace', 'str_replace_based_edit_tool', 'search_replace', 'search-replace',
  'multi_edit', 'multi-edit', 'insert_code_at_line', 'insert-code-at-line',
  'rewrite_file', 'rewrite-file', 'edit_notebook_file', 'edit-notebook-file'
])
const PATCH_TOOLS = new Set(['apply_patch', 'apply-patch', 'patch'])
const SHELL_TOOLS = new Set([
  'bash', 'shell', 'shell_command', 'shell-command', 'exec_command', 'exec-command',
  'run_in_terminal', 'run-in-terminal', 'run_terminal_command', 'run-terminal-command',
  'send_to_terminal', 'send-to-terminal', 'powershell', 'terminal'
])
const MOVE_TOOLS = new Set(['move_file', 'move-file', 'rename_file', 'rename-file', 'move', 'rename'])
const DELETE_TOOLS = new Set(['delete_file', 'delete-file', 'remove_file', 'remove-file', 'unlink'])
const SERVICE_TOOLS = new Set([
  'kill_terminal', 'kill-terminal', 'start_process', 'start-process',
  'stop_process', 'stop-process', 'restart_service', 'restart-service'
])
const READ_TOOL_RE = /^(?:read|read_file|view|view_file|open|search|grep|rg|find|glob|list|ls|stat|inspect|query|fetch|get|check|validate|diagnose|screenshot)(?:[_-].*)?$/i
const WRITE_NAME_HINT_RE = /(?:write|edit|patch|create|delete|remove|move|rename|replace|append|insert|format|generate|codegen|scaffold|install|update|migrate|mutat)/i
const CONTROLLED_LOGICAL_WRITE_RE = /^(?:memory_(?:session_allocate|session_write|summary_append|cp_confirm)|memory-(?:session-allocate|session-write|summary-append|cp-confirm))$/i
const DEVCODEX_READ_ONLY_MCP_TOOLS = new Set([
  'profile_context_plan',
  'profile_load',
  'profile_skill_plan',
  'profile_get_mode',
  'profile_compose_entry_check',
  'memory_task_resolve',
  'memory_status',
  'memory_session_query',
  'memory_summary_query',
  'memory_session_read',
  'memory_summary_read'
])

function devCodexToolIdentity(name) {
  const value = String(name || '').trim().toLowerCase()
  if (!value) return null
  if (DEVCODEX_READ_ONLY_MCP_TOOLS.has(value) || CONTROLLED_LOGICAL_WRITE_RE.test(value)) {
    return { server: 'direct', leaf: value }
  }
  for (const pattern of [
    /^mcp__devcodex_(profile|memory)__(.+)$/,
    /^devcodex[-_](profile|memory)\/(.+)$/,
    /^devcodex[-_](profile|memory)__(.+)$/
  ]) {
    const match = value.match(pattern)
    if (match) return { server: `devcodex-${match[1]}`, leaf: match[2] }
  }
  return null
}

function digest(value) {
  return sha256(Buffer.from(stableStringify(value), 'utf8'))
}

function toolName(payload) {
  return String(payload?.tool_name || payload?.toolName || payload?.name || payload?.tool?.name || '').trim()
}

function toolInput(payload) {
  const input = payload?.tool_input || payload?.toolInput || payload?.arguments || payload?.args || {}
  return input && typeof input === 'object' && !Array.isArray(input) ? input : {}
}

function commandText(input) {
  return String(input?.command || input?.cmd || input?.script || input?.shell_command || input?.shellCommand || '')
}

function normalizedHostVariant(value) {
  const text = String(value || 'unknown').trim().toLowerCase()
  if (/codex/.test(text)) return /desktop/.test(text) ? 'codex-desktop' : 'codex-cli'
  if (/claude/.test(text)) return 'claude-code'
  if (/copilot/.test(text)) return 'github-copilot'
  if (/gemini/.test(text)) return 'gemini-cli'
  if (/grok/.test(text)) return 'grok'
  if (/cursor/.test(text)) return /cloud/.test(text) ? 'cursor-cloud' : 'cursor-local'
  return text || 'unknown'
}

function boundedObjectSearch(value, predicate, state = { seen: new Set(), bytes: 0 }) {
  if (value === null || value === undefined || state.bytes > MAX_CLASSIFICATION_BYTES) return false
  if (typeof value === 'string') {
    state.bytes += Buffer.byteLength(value, 'utf8')
    return predicate('', value)
  }
  if (typeof value !== 'object' || state.seen.has(value)) return false
  state.seen.add(value)
  for (const [key, item] of Object.entries(value)) {
    state.bytes += Buffer.byteLength(key, 'utf8')
    if (predicate(key, item)) return true
    if (item && typeof item === 'object' && boundedObjectSearch(item, predicate, state)) return true
  }
  return false
}

function hasPathEvidence(input) {
  return boundedObjectSearch(input, (key, value) =>
    /(?:^|_)(?:file|path|target|source|destination|dest|output|root)s?$/i.test(key) &&
    (typeof value === 'string' || Array.isArray(value)))
}

function hasManagedManifest(input) {
  return boundedObjectSearch(input, (key, value) =>
    /^(?:mutation|effect|dry_run|dryrun|output)[_-]?(?:manifest|plan)$/i.test(key) &&
    value && typeof value === 'object')
}

function hasControlledRoots(input) {
  return boundedObjectSearch(input, (key, value) =>
    /^(?:target|output|controlled)[_-]?roots?$/i.test(key) &&
    (typeof value === 'string' || Array.isArray(value)))
}

function stripQuotedLiterals(value) {
  const text = String(value || '')
  let quote = ''
  let escaped = false
  let output = ''
  for (const character of text) {
    if (escaped) {
      output += quote ? ' ' : character
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      output += quote ? ' ' : character
      continue
    }
    if (quote) {
      if (character === quote) quote = ''
      output += ' '
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      output += ' '
      continue
    }
    output += character
  }
  return output
}

function classifyShell(command, input) {
  const text = String(command || '').trim()
  const syntax = stripQuotedLiterals(text)
  if (!text) {
    return {
      commandClass: 'empty', operationClass: 'unknown', mutationCandidate: false,
      adapterId: 'shell-empty-v1', coverage: 'not-applicable', ambiguityCodes: ['shell-command-empty']
    }
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_CLASSIFICATION_BYTES) {
    return {
      commandClass: 'oversize', operationClass: 'unknown', mutationCandidate: true,
      adapterId: 'shell-oversize-v1', coverage: 'unavailable', ambiguityCodes: ['shell-command-scan-limit-exceeded']
    }
  }

  const dynamicTarget = /(?:>{1,2}|\b(?:-Path|-LiteralPath|-FilePath|-Destination|-NewName)\b)\s*(?:\$\(|`|\$\{|%[^%]+%|\$[A-Za-z_])|\b(?:mv|move|cp|copy|rm|del)\b[^\r\n;&|]*(?:\$\(|`|\$\{|%[^%]+%|\$[A-Za-z_])/i.test(text)
  const interpreterWriter = /^(?:node|python|python3|py|powershell|pwsh)\b/i.test(syntax) &&
    /\b(?:(?:fs\.)?(?:writeFile|appendFile|createWriteStream)|Set-Content|Out-File|Add-Content|Remove-Item|Move-Item|open\s*\([^)]*,\s*['"][wax+])/i.test(text)
  const powershellWriteAlias = /(?:^|[;&|]\s*)(?:sc(?!\.exe\b)|ac|clc|ni|si|sp|np)\b/i.test(syntax)
  const exactWriteSyntax = /(?:>{1,2}\s*[^&|]|\btee\b|\bSet-Content\b|\bOut-File\b|\bAdd-Content\b|\bClear-Content\b|\bNew-Item\b|\bSet-Item\b|\bSet-ItemProperty\b|\bNew-ItemProperty\b|\bExport-Csv\b|\bExport-Clixml\b|(?:^|[;&|]\s*)(?:touch|mkdir)\b)/i.test(syntax) ||
    powershellWriteAlias || interpreterWriter
  const moveSyntax = /\b(?:Move-Item|Rename-Item|Copy-Item|mv|move|rename|cp|copy)\b/i.test(syntax) ||
    /(?:^|[;&|]\s*)(?:mi|rni|ren|cpi)\b/i.test(syntax)
  const deleteSyntax = /\b(?:Remove-Item|rm|del|unlink|rmdir)\b/i.test(syntax) ||
    /(?:^|[;&|]\s*)(?:ri|erase|rd)\b/i.test(syntax)
  const gitDestructive = /(?:^|[;&|]\s*)git\s+(?:clean|reset|checkout\s+--|restore\b)/i.test(syntax)
  const gitMutation = /(?:^|[;&|]\s*)git\s+(?:add|commit|merge|rebase|cherry-pick|switch|checkout|tag|stash|apply|am|mv|rm)\b/i.test(syntax)
  const patchSyntax = /(?:^|[;&|]\s*)(?:git\s+apply|patch\s+-p\d+)/i.test(syntax)
  const packageManager = /(?:^|[;&|]\s*)(?:npm|pnpm|yarn|bun)\s+(?:install|i|add|remove|uninstall|update|upgrade|ci)\b|(?:^|[;&|]\s*)(?:pip|pip3|poetry|uv)\s+(?:install|uninstall|add|remove|sync)\b|(?:^|[;&|]\s*)(?:dotnet\s+add\s+\S+\s+package|composer\s+(?:install|update|require|remove))\b/i.test(syntax)
  const formatter = /(?:^|[;&|]\s*)(?:prettier\b[^\r\n;&|]*\s--write\b|eslint\b[^\r\n;&|]*\s--fix\b|biome\b[^\r\n;&|]*\s(?:format|check)\b[^\r\n;&|]*\s--write\b|black\b|ruff\s+format\b|gofmt\b[^\r\n;&|]*\s-w\b|clang-format\b[^\r\n;&|]*\s-i\b|dotnet\s+format\b)/i.test(syntax)
  const testGenerator = /(?:--update-snapshots\b|(?:jest|vitest)\b[^\r\n;&|]*(?:\s-u\b|--updateSnapshot\b)|pytest\b[^\r\n;&|]*--snapshot-update\b|playwright\b[^\r\n;&|]*--update-snapshots\b)/i.test(syntax)
  const codegen = /(?:^|[;&|]\s*)(?:(?:node|python|python3|py|npm\s+run|pnpm\s+run|yarn\s+run|bun\s+run)\s+[^\r\n;&|]*(?:codegen|generate|generator|scaffold)|[^\s;&|]*(?:codegen|generate|generator|scaffold)[^\s;&|]*|prisma\s+(?:generate|migrate)|openapi-generator|protoc\b|sqlc\s+generate\b)/i.test(syntax)
  const serviceLifecycle = /(?:^|[;&|]\s*)(?:npm|pnpm|yarn|bun)\s+run\s+(?:dev|serve|start)\b|\b(?:Start-Process|Stop-Process|taskkill|kill)\b/i.test(syntax)
  const genericScript = /(?:^|[;&|]\s*)(?:(?:node|python|python3|py|ruby|perl|php|pwsh|powershell)\s+(?!--check\b|--version\b|-v\b)[^;&|]+|(?:npm|pnpm|yarn|bun)\s+(?:run|test|exec)\b|(?:bash|sh)\s+[^;&|]+\.(?:sh|bash)\b)/i.test(syntax)

  let commandClass = 'read'
  let operationClass = 'read'
  let mutationCandidate = false
  let adapterId = 'shell-read-v1'
  let coverage = 'not-applicable'
  const ambiguityCodes = []

  if (deleteSyntax || gitDestructive) {
    commandClass = 'destructive'
    operationClass = 'destructive'
    mutationCandidate = true
    adapterId = 'shell-destructive-v1'
    coverage = hasPathEvidence(input) || !dynamicTarget ? 'complete' : 'unavailable'
  } else if (moveSyntax || exactWriteSyntax) {
    commandClass = moveSyntax ? 'move-or-copy' : 'direct-write'
    operationClass = 'shell'
    mutationCandidate = true
    adapterId = moveSyntax ? 'shell-move-copy-v1' : 'shell-direct-write-v1'
    coverage = dynamicTarget ? 'partial' : 'complete'
  } else if (patchSyntax) {
    commandClass = 'patch'
    operationClass = 'indirect-writer'
    mutationCandidate = true
    adapterId = 'shell-patch-v1'
    coverage = hasManagedManifest(input) || hasControlledRoots(input) ? 'complete' : 'partial'
  } else if (packageManager || formatter || testGenerator || codegen) {
    commandClass = packageManager ? 'package-manager' : (formatter ? 'formatter' : (testGenerator ? 'test-generator' : 'codegen'))
    operationClass = 'indirect-writer'
    mutationCandidate = true
    adapterId = `shell-${commandClass}-v1`
    coverage = hasManagedManifest(input) || hasControlledRoots(input) ? 'complete' : 'partial'
  } else if (serviceLifecycle) {
    commandClass = 'service-lifecycle'
    operationClass = 'service-lifecycle'
    mutationCandidate = true
    adapterId = 'shell-service-lifecycle-v1'
    coverage = 'partial'
  } else if (genericScript || gitMutation) {
    commandClass = gitMutation ? 'git-writer' : 'script-writer'
    operationClass = 'indirect-writer'
    mutationCandidate = true
    adapterId = `shell-${commandClass}-v1`
    coverage = hasManagedManifest(input) || hasControlledRoots(input) ? 'complete' : 'partial'
  }

  if (dynamicTarget && mutationCandidate) ambiguityCodes.push('dynamic-command-target')
  if (mutationCandidate && coverage === 'partial' && ['indirect-writer', 'service-lifecycle'].includes(operationClass)) {
    ambiguityCodes.push('managed-observation-plan-required')
  }
  return { commandClass, operationClass, mutationCandidate, adapterId, coverage, ambiguityCodes }
}

function classifyHostToolMutation(payload = {}, options = {}) {
  const name = toolName(payload)
  const normalizedName = name.toLowerCase()
  const devCodexTool = devCodexToolIdentity(normalizedName)
  const classificationName = devCodexTool?.leaf || normalizedName
  const input = toolInput(payload)
  const hostVariant = normalizedHostVariant(options.hostVariant || options.platform)
  let adapterId = 'host-read-v1'
  let operationClass = 'read'
  let commandClass = null
  let mutationCandidate = false
  let coverage = 'not-applicable'
  let ambiguityCodes = []

  if (CONTROLLED_LOGICAL_WRITE_RE.test(classificationName)) {
    adapterId = 'host-controlled-logical-write-v1'
    operationClass = 'direct-write'
    mutationCandidate = true
    coverage = 'complete'
  } else if (devCodexTool && DEVCODEX_READ_ONLY_MCP_TOOLS.has(classificationName)) {
    adapterId = 'host-devcodex-read-v1'
    operationClass = 'read'
    mutationCandidate = false
    coverage = 'not-applicable'
  } else if (PATCH_TOOLS.has(normalizedName)) {
    adapterId = 'host-apply-patch-v1'
    operationClass = 'direct-write'
    mutationCandidate = true
    coverage = typeof (input.input || input.patch || input.diff) === 'string' ? 'complete' : 'unavailable'
    if (coverage !== 'complete') ambiguityCodes.push('patch-payload-missing')
  } else if (MOVE_TOOLS.has(normalizedName)) {
    adapterId = 'host-move-rename-v1'
    operationClass = 'direct-write'
    mutationCandidate = true
    coverage = hasPathEvidence(input) ? 'complete' : 'unavailable'
    if (coverage !== 'complete') ambiguityCodes.push('move-source-destination-missing')
  } else if (DELETE_TOOLS.has(normalizedName)) {
    adapterId = 'host-delete-v1'
    operationClass = 'destructive'
    mutationCandidate = true
    coverage = hasPathEvidence(input) ? 'complete' : 'unavailable'
    if (coverage !== 'complete') ambiguityCodes.push('delete-target-missing')
  } else if (DIRECT_WRITE_TOOLS.has(normalizedName)) {
    adapterId = 'host-direct-write-v1'
    operationClass = 'direct-write'
    mutationCandidate = true
    coverage = hasPathEvidence(input) ? 'complete' : 'unavailable'
    if (coverage !== 'complete') ambiguityCodes.push('direct-write-target-missing')
  } else if (SHELL_TOOLS.has(normalizedName)) {
    const shell = classifyShell(commandText(input), input)
    ;({ adapterId, operationClass, commandClass, mutationCandidate, coverage, ambiguityCodes } = shell)
  } else if (SERVICE_TOOLS.has(normalizedName)) {
    adapterId = 'host-service-lifecycle-v1'
    operationClass = 'service-lifecycle'
    mutationCandidate = true
    coverage = 'partial'
    ambiguityCodes = ['service-effect-observation-required']
  } else if (READ_TOOL_RE.test(normalizedName)) {
    adapterId = 'host-read-v1'
  } else if (WRITE_NAME_HINT_RE.test(normalizedName) || hasPathEvidence(input)) {
    adapterId = 'host-unknown-write-capability-v1'
    operationClass = 'unknown'
    mutationCandidate = true
    coverage = 'unavailable'
    ambiguityCodes = ['host-tool-adapter-unknown']
  } else {
    adapterId = 'host-unknown-read-v1'
    operationClass = 'unknown'
    ambiguityCodes = ['host-tool-adapter-unknown-read-only']
  }

  const controlledTargets = hasManagedManifest(input) || hasControlledRoots(input)
  const semantic = {
    schemaVersion: ADAPTER_SCHEMA,
    registrySchemaVersion: REGISTRY_SCHEMA,
    adapterId,
    toolName: name,
    hostVariant,
    operationClass,
    commandClass,
    mutationCandidate,
    readOnly: mutationCandidate !== true,
    executableAuthority: mutationCandidate === true && operationClass !== 'unknown' && coverage === 'complete',
    targetStrategy: operationClass === 'direct-write' || operationClass === 'destructive'
      ? (CONTROLLED_LOGICAL_WRITE_RE.test(normalizedName) ? 'controlled-logical-target' : (PATCH_TOOLS.has(normalizedName) ? 'patch' : 'exact-fields'))
      : (operationClass === 'shell' ? 'shell-syntax' : (operationClass === 'indirect-writer' ? 'managed-manifest-or-root' : 'none')),
    controlledTargets,
    coverage,
    ambiguityCodes: [...new Set(ambiguityCodes)].sort(),
    observationPlan: {
      mode: operationClass === 'read' || mutationCandidate !== true
        ? 'none'
        : (operationClass === 'direct-write' || operationClass === 'destructive' || operationClass === 'shell'
            ? 'exact-target-readback'
            : (operationClass === 'indirect-writer' ? 'managed-effect-manifest' : 'host-effect-receipt')),
      nativeExitCodeRequired: ['shell', 'indirect-writer', 'destructive', 'service-lifecycle'].includes(operationClass),
      beforeAfterDigestRequired: ['direct-write', 'shell', 'indirect-writer', 'destructive'].includes(operationClass),
      completeCoverageRequired: mutationCandidate === true
    }
  }
  return Object.freeze({ ...semantic, adapterDigest: digest(semantic) })
}

function validateHostToolMutationAdapterDecision(value) {
  const errors = []
  if (value?.schemaVersion !== ADAPTER_SCHEMA) errors.push('host-tool-adapter-schema-invalid')
  if (value?.registrySchemaVersion !== REGISTRY_SCHEMA) errors.push('host-tool-adapter-registry-invalid')
  if (!['read', 'direct-write', 'shell', 'indirect-writer', 'destructive', 'service-lifecycle', 'unknown'].includes(value?.operationClass)) {
    errors.push('host-tool-adapter-operation-class-invalid')
  }
  if (!['complete', 'partial', 'unavailable', 'not-applicable'].includes(value?.coverage)) errors.push('host-tool-adapter-coverage-invalid')
  if (!Array.isArray(value?.ambiguityCodes) || !value?.observationPlan || typeof value.observationPlan !== 'object') {
    errors.push('host-tool-adapter-evidence-invalid')
  }
  const { adapterDigest, ...semantic } = value || {}
  if (!DIGEST_RE.test(String(adapterDigest || '')) || digest(semantic) !== adapterDigest) errors.push('host-tool-adapter-digest-invalid')
  return { valid: errors.length === 0, errors }
}

module.exports = {
  HOST_TOOL_MUTATION_ADAPTER_REGISTRY_SCHEMA: REGISTRY_SCHEMA,
  HOST_TOOL_MUTATION_ADAPTER_SCHEMA: ADAPTER_SCHEMA,
  MAX_CLASSIFICATION_BYTES,
  classifyHostToolMutation,
  classifyShell,
  commandText,
  toolInput,
  toolName,
  validateHostToolMutationAdapterDecision
}
