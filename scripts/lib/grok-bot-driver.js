'use strict'

// DevCodex grok-bot driver.
// Grok Bot (desktop assistant) has no native lifecycle hook events. This driver
// synthesizes SessionStart/UserPromptSubmit and bracketing Pre/PostToolUse
// events through hooks/_runtime/lifecycle-host-adapters.cjs with the
// `grok-bot` driver host. Every event is recorded as driver-synthesized; the
// driver never claims native host provenance and cannot enforce PreToolUse.

const { spawn, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..')
const ADAPTER = path.join(PACKAGE_ROOT, 'hooks', '_runtime', 'lifecycle-host-adapters.cjs')
const DRIVER_HOST = 'grok-bot'
const DEFAULT_SESSION_ID = 'grok-bot-session'
const SERVER_PREFIX = { profile: 'devcodex-profile', memory: 'devcodex-memory' }

function driverError (code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function driverEnv (env = process.env) {
  return {
    ...env,
    DEVCODEX_HOST_SESSION_ID: env.DEVCODEX_HOST_SESSION_ID || DEFAULT_SESSION_ID,
    DEVCODEX_HOST_PLATFORM: env.DEVCODEX_HOST_PLATFORM || 'grok',
    DEVCODEX_AGENT: env.DEVCODEX_AGENT || 'grok-bot'
  }
}

function runHookEvent (projectDir, event, extra = {}, options = {}) {
  const env = driverEnv(options.env)
  const payload = {
    hook_event_name: event,
    session_id: env.DEVCODEX_HOST_SESSION_ID,
    cwd: projectDir,
    ...extra
  }
  const result = spawnSync(process.execPath, [ADAPTER, DRIVER_HOST], {
    cwd: projectDir,
    env,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeoutMs || 120000
  })
  if (result.status !== 0) {
    throw driverError('GROK_BOT_HOOK_FAILED', `${event} exited ${result.status}: ${String(result.stderr || '').trim().slice(0, 2000)}`)
  }
  try {
    return JSON.parse(result.stdout || '{}')
  } catch {
    throw driverError('GROK_BOT_HOOK_OUTPUT_INVALID', `${event} produced non-JSON output`)
  }
}

function extractBlocks (output) {
  const text = typeof output === 'string'
    ? output
    : [output?.systemMessage, output?.hookSpecificOutput?.additionalContext, output?.additionalContext]
      .filter(value => typeof value === 'string').join('\n')
  const blocks = {}
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      const value = JSON.parse(trimmed)
      if (value && typeof value.schemaVersion === 'string') blocks[value.schemaVersion] = value
    } catch { }
  }
  const epoch = /contextEpoch=(ctx-[A-Za-z0-9-]+)/.exec(text || '')
  if (epoch) blocks.contextEpoch = epoch[1]
  return blocks
}

function ingressRefFrom (ingress) {
  if (!ingress) return null
  if (ingress.admissionRef) return ingress.admissionRef
  if (!ingress.envelopeId || !ingress.envelopeDigest || !ingress.decisionDigest || !ingress.routeRevision) return null
  return {
    schemaVersion: 'WorkflowIngressProjectionRefV1',
    envelopeId: ingress.envelopeId,
    envelopeDigest: ingress.envelopeDigest,
    decisionDigest: ingress.decisionDigest,
    routeRevision: ingress.routeRevision
  }
}

function summarizeIngress (output) {
  const blocks = extractBlocks(output)
  const ingress = blocks.WorkflowIngressProjectionV1 || null
  const bootstrap = blocks.SkillRouteBootstrapV1 || null
  return {
    contextEpoch: blocks.contextEpoch || bootstrap?.contextEpoch || null,
    turnBinding: bootstrap?.turnBinding || null,
    envelopeId: ingress?.envelopeId || null,
    envelopeDigest: ingress?.envelopeDigest || null,
    routeStatus: ingress?.routeStatus || null,
    decisionDigest: ingress?.decisionDigest || null,
    routeRevision: ingress?.routeRevision || null,
    ingressRef: ingressRefFrom(ingress),
    ingress,
    skillRouteBootstrap: bootstrap
  }
}

function turnBegin (projectDir, prompt, options = {}) {
  const root = path.resolve(projectDir)
  if (!fs.existsSync(root)) throw driverError('GROK_BOT_PROJECT_MISSING', `project directory not found: ${root}`)
  if (!String(prompt || '').trim()) throw driverError('GROK_BOT_PROMPT_REQUIRED', 'prompt is required')
  runHookEvent(root, 'SessionStart', {}, options)
  const output = runHookEvent(root, 'UserPromptSubmit', { prompt }, options)
  const summary = summarizeIngress(output)
  return {
    schemaVersion: 'GrokBotTurnBeginV1',
    provenance: 'driver-synthesized',
    project: options.project || path.basename(root),
    projectDir: root,
    sessionId: driverEnv(options.env).DEVCODEX_HOST_SESSION_ID,
    ...summary,
    semanticDecisionSourceRef: summary.envelopeId
      ? { envelopeId: summary.envelopeId, envelopeDigest: summary.envelopeDigest, contextEpoch: summary.contextEpoch }
      : null,
    systemMessage: options.includeSystemMessage ? output.systemMessage || '' : undefined,
    nextSteps: [
      'Bracket every devcodex MCP call with observe-tool --phase pre / --phase post (same --tool-use-id and --input).',
      'profile_context_plan {project,intent,changeTypes,contextEpoch,confidence,semanticDecision{sourceRef=semanticDecisionSourceRef}}',
      'Take ingressRef from the post observe-tool output of profile_context_plan (routeStatus=selected).',
      'profile_load {project,contextBinding,files=plan.profile.selectedFiles}; memory_status {project,contextBinding}',
      'skill_route catalog (paginate until target card seen) -> commit {catalogDigest,skillId,contextBinding}',
      'memory_task_admit_v2 {operation:"admit",project,ingressRef,task{taskKind,entryVariant,displayName},overview{content}}'
    ]
  }
}

function qualifiedToolName (tool) {
  const value = String(tool || '').trim()
  if (!value) throw driverError('GROK_BOT_TOOL_REQUIRED', '--tool is required')
  if (value.includes('__')) return value
  const memory = /^memory_/.test(value)
  return `${memory ? SERVER_PREFIX.memory : SERVER_PREFIX.profile}__${value}`
}

function observeTool (projectDir, { phase, tool, input, response, toolUseId } = {}, options = {}) {
  const root = path.resolve(projectDir)
  if (!['pre', 'post'].includes(phase)) throw driverError('GROK_BOT_PHASE_INVALID', '--phase must be pre or post')
  if (!toolUseId) throw driverError('GROK_BOT_TOOL_USE_ID_REQUIRED', '--tool-use-id is required')
  const event = phase === 'pre' ? 'PreToolUse' : 'PostToolUse'
  const extra = { tool_name: qualifiedToolName(tool), tool_input: input || {}, tool_use_id: toolUseId }
  if (phase === 'post') extra.tool_response = response === undefined ? null : response
  const output = runHookEvent(root, event, extra, options)
  const summary = summarizeIngress(output)
  return {
    schemaVersion: 'GrokBotObserveToolV1',
    provenance: 'driver-synthesized',
    phase,
    tool: extra.tool_name,
    toolUseId,
    enforced: false,
    hostDecision: output?.hookSpecificOutput?.permissionDecision || output?.decision || null,
    continue: output?.continue !== false,
    routeStatus: summary.routeStatus,
    decisionDigest: summary.decisionDigest,
    routeRevision: summary.routeRevision,
    ingressRef: summary.ingressRef,
    systemMessage: typeof output?.systemMessage === 'string' ? output.systemMessage : ''
  }
}

function startMcpServer (kind, projectDir, options = {}) {
  const child = spawn(process.execPath, [path.join(PACKAGE_ROOT, 'mcp', `${kind}-server.js`), projectDir], {
    cwd: projectDir, env: driverEnv(options.env), stdio: ['pipe', 'pipe', 'ignore']
  })
  let buffer = ''
  let nextId = 0
  const pending = new Map()
  child.stdout.on('data', chunk => {
    buffer += chunk
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      let message
      try { message = JSON.parse(line) } catch { continue }
      const resolve = pending.get(message.id)
      if (resolve) { pending.delete(message.id); resolve(message) }
    }
  })
  const request = (method, params) => new Promise(resolve => {
    const id = ++nextId
    pending.set(id, resolve)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  return {
    kind,
    async init () {
      await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'devcodex-grok-bot-driver', version: '1' } })
      child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
    },
    async call (name, args) {
      const message = await request('tools/call', { name, arguments: args })
      const result = message.result || {}
      let body = result.structuredContent
      if (!body) {
        try { body = JSON.parse(result.content?.[0]?.text) } catch { body = { text: result.content?.[0]?.text } }
      }
      return { isError: Boolean(result.isError || message.error), body: body || message.error, raw: result }
    },
    close () { child.kill() }
  }
}

function defaultSemanticDecision (sourceRef, overrides = {}) {
  return {
    schemaVersion: 'IntentSemanticDecisionV1',
    sourceRef,
    workflowPreference: { ceremonyTier: 'simple', designDepth: 'minimal', assuranceLevel: 'targeted' },
    workflowFacts: { targetKnown: true },
    executionDecision: 'confirm',
    ...overrides
  }
}

// Full-turn mode: turn-begin, then own MCP servers bracketed by observe-tool.
async function runTurn (projectDir, prompt, options = {}) {
  const root = path.resolve(projectDir)
  const project = options.project || path.basename(root)
  const intent = options.intent || 'dev'
  const changeTypes = options.changeTypes || ['source-code']
  const steps = []
  const step = (name, value) => { steps.push({ step: name, ...value }); if (options.onStep) options.onStep(name, value) }
  const begin = turnBegin(root, prompt, { ...options, project })
  step('turn-begin', { routeStatus: begin.routeStatus, contextEpoch: begin.contextEpoch, turnBinding: begin.turnBinding })
  const servers = { profile: startMcpServer('profile', root, options), memory: startMcpServer('memory', root, options) }
  let counter = 0
  let lastPost = null
  const tracked = async (kind, tool, args) => {
    const toolUseId = `grok-bot-${process.pid}-${Date.now()}-${++counter}`
    const name = `${SERVER_PREFIX[kind]}__${tool}`
    observeTool(root, { phase: 'pre', tool: name, input: args, toolUseId }, options)
    const result = await servers[kind].call(tool, args)
    lastPost = observeTool(root, { phase: 'post', tool: name, input: args, response: result.raw, toolUseId }, options)
    return result
  }
  const out = { schemaVersion: 'GrokBotRunV1', provenance: 'driver-synthesized', project, begin, steps }
  try {
    await servers.profile.init()
    await servers.memory.init()
    const semanticDecision = defaultSemanticDecision(begin.semanticDecisionSourceRef, options.semanticDecision)
    const plan = await tracked('profile', 'profile_context_plan', {
      project, intent, changeTypes, contextEpoch: begin.contextEpoch, confidence: options.confidence ?? 0.9, semanticDecision
    })
    step('profile_context_plan', { ok: !plan.isError, errorCode: plan.body?.errorCode || null })
    if (plan.isError) throw driverError('GROK_BOT_CONTEXT_PLAN_FAILED', JSON.stringify(plan.body).slice(0, 1000))
    const contextBinding = plan.body.contextBinding
    out.contextBinding = contextBinding
    out.ingressRef = lastPost.ingressRef
    step('ingress-routed', { routeStatus: lastPost.routeStatus, decisionDigest: lastPost.decisionDigest })
    const load = await tracked('profile', 'profile_load', { project, contextBinding, files: plan.body.profile?.selectedFiles || [] })
    step('profile_load', { ok: !load.isError, errorCode: load.body?.errorCode || null })
    for (const query of plan.body.memory?.requiredQueries || []) {
      const res = await tracked('memory', query, { project, contextBinding })
      step(query, { ok: !res.isError, errorCode: res.body?.errorCode || null })
    }
    const boot = begin.skillRouteBootstrap
    if (boot && options.skill) {
      let cursor
      let page
      const seen = []
      do {
        page = await tracked('profile', 'skill_route', { op: 'catalog', project, turnBinding: boot.turnBinding, contextEpoch: boot.contextEpoch, ...(cursor ? { cursor } : {}) })
        seen.push(...(page.body?.receipt?.cards || []).map(card => card.skillId))
        cursor = page.body?.receipt?.nextCursor
      } while (cursor && page.body?.ok && !seen.includes(options.skill))
      step('skill_route.catalog', { ok: page.body?.ok === true, seen: seen.length })
      const commit = await tracked('profile', 'skill_route', {
        op: 'commit', project, turnBinding: boot.turnBinding, contextEpoch: boot.contextEpoch,
        catalogDigest: page.body?.receipt?.catalogDigest, skillId: options.skill, contextBinding
      })
      step('skill_route.commit', { ok: commit.body?.ok === true, errorCode: commit.body?.errorCode || null })
      out.skillCommit = commit.body
    }
    if (options.admit) {
      const admission = await tracked('memory', 'memory_task_admit_v2', {
        operation: 'admit', project, ingressRef: out.ingressRef,
        task: {
          taskKind: options.taskKind || (intent === 'fix' ? 'bugs' : 'requirements'),
          entryVariant: options.entryVariant || (intent === 'fix' ? 'fix' : 'new'),
          displayName: String(options.displayName || prompt).slice(0, 80)
        },
        overview: { content: prompt }
      })
      step('memory_task_admit_v2', { ok: !admission.isError, errorCode: admission.body?.errorCode || null, taskId: admission.body?.taskId || null })
      out.admission = admission.body
    }
  } finally {
    servers.profile.close()
    servers.memory.close()
  }
  out.ok = steps.every(item => item.ok !== false)
  return out
}

function parseFlags (argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      if (eq > 0) { flags[arg.slice(2, eq)] = arg.slice(eq + 1); continue }
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) flags[arg.slice(2)] = true
      else { flags[arg.slice(2)] = next; i++ }
    } else positional.push(arg)
  }
  return { positional, flags }
}

function parseJsonFlag (value, name) {
  if (value === undefined || value === true) return undefined
  const text = String(value).startsWith('@') ? fs.readFileSync(String(value).slice(1), 'utf8') : String(value)
  try { return JSON.parse(text) } catch (error) { throw driverError('GROK_BOT_JSON_INVALID', `--${name}: ${error.message}`) }
}

const USAGE = [
  'devcodex grok-bot turn-begin <projectDir> <prompt> [--project <name>] [--system-message]',
  'devcodex grok-bot observe-tool --phase pre|post --tool <name> --input <json|@file> [--response <json|@file>] --tool-use-id <id> [--project-dir <dir>]',
  'devcodex grok-bot run <projectDir> <prompt> [--intent dev|fix|...] [--change source-code,...] [--skill <id>] [--admit] [--task-kind <k>] [--entry <v>]'
].join('\n')

async function runGrokBotCli (argv = [], io = {}) {
  const stdout = io.stdout || process.stdout
  const [sub, ...rest] = argv
  const { positional, flags } = parseFlags(rest)
  let result
  if (sub === 'turn-begin') {
    result = turnBegin(positional[0] || process.cwd(), positional.slice(1).join(' '), {
      project: flags.project, includeSystemMessage: flags['system-message'] === true
    })
  } else if (sub === 'observe-tool') {
    result = observeTool(flags['project-dir'] || process.cwd(), {
      phase: flags.phase,
      tool: flags.tool,
      input: parseJsonFlag(flags.input, 'input') || {},
      response: parseJsonFlag(flags.response, 'response'),
      toolUseId: flags['tool-use-id']
    })
  } else if (sub === 'run') {
    result = await runTurn(positional[0] || process.cwd(), positional.slice(1).join(' '), {
      project: flags.project,
      intent: flags.intent,
      changeTypes: typeof flags.change === 'string' ? flags.change.split(',') : undefined,
      skill: typeof flags.skill === 'string' ? flags.skill : undefined,
      admit: flags.admit === true,
      taskKind: flags['task-kind'],
      entryVariant: flags.entry
    })
  } else {
    throw driverError('GROK_BOT_SUBCOMMAND_INVALID', `Unknown grok-bot subcommand: ${sub || '(none)'}\n${USAGE}`)
  }
  stdout.write(JSON.stringify(result, null, 2) + '\n')
  return result
}

function cmdGrokBot (argv, { console: out = console, c = { red: s => s }, process: proc = process } = {}) {
  return runGrokBotCli(argv).catch(error => {
    out.error(c.red(`  ${error.code || 'GROK_BOT_DRIVER_FAILED'}: ${error.message}`))
    proc.exitCode = 2
    return null
  })
}

module.exports = {
  cmdGrokBot,
  DRIVER_HOST,
  USAGE,
  extractBlocks,
  ingressRefFrom,
  observeTool,
  qualifiedToolName,
  runGrokBotCli,
  runHookEvent,
  runTurn,
  summarizeIngress,
  turnBegin
}
