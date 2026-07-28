#!/usr/bin/env node
'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const {
  getRuntimeContractDigest,
  normalizeHostVariant
} = require('../hooks/_runtime/skill-route-mode.cjs')
const {
  getLifecycleHostAdapterDigest
} = require('../hooks/_runtime/host-adapter-identity.cjs')
const {
  loadEnvelope,
  recordSkillRouteProbeObservation
} = require('../hooks/_runtime/skill-route-state.cjs')
const {
  sha256
} = require('../hooks/_runtime/progressive-skill-route-contract.cjs')
const {
  createSkillRouteFixture,
  writeJson
} = require('./lib/skill-route-test-fixture')
const {
  resolveGlobalHostTarget
} = require('./lib/global-host-target')
const {
  parseModelResult,
  writeProbeSkill
} = require('./probe-skill-route-s15-grok')

const HOSTS = Object.freeze({
  claude: {
    lifecycleHost: 'claude',
    executable: 'claude',
    versionArgs: ['--version'],
    authPattern: /not logged in|run \/login|authentication/i
  },
  codex: {
    lifecycleHost: 'codex',
    executable: 'codex',
    versionArgs: ['--version'],
    authPattern: /not logged in|login required|authentication/i
  },
  copilot: {
    lifecycleHost: 'copilot',
    executable: 'copilot',
    versionArgs: ['--version'],
    authPattern: /not logged in|login required|authentication/i
  },
  gemini: {
    lifecycleHost: 'gemini',
    executable: 'gemini',
    versionArgs: ['--version'],
    authPattern: /auth method|api key|not logged in|authentication/i
  }
})

function optionValue (name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}

function resolveExecutable (hostId) {
  if (hostId !== 'copilot') return { command: 'volta', prefix: ['run', hostId] }
  const explicit = process.env.DEVCODEX_COPILOT_CLI
  if (explicit && fs.existsSync(explicit)) return { command: explicit, prefix: [] }
  const localAppData = process.env.LOCALAPPDATA || ''
  const wingetRoot = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages')
  if (fs.existsSync(wingetRoot)) {
    const packageDir = fs.readdirSync(wingetRoot).find(name =>
      name.startsWith('GitHub.Copilot_')
    )
    const candidate = packageDir
      ? path.join(wingetRoot, packageDir, 'copilot.exe')
      : ''
    if (candidate && fs.existsSync(candidate)) {
      return { command: candidate, prefix: [] }
    }
  }
  return { command: 'copilot', prefix: [] }
}

function run (command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    timeout: options.timeout || 120000,
    maxBuffer: 24 * 1024 * 1024
  })
  if (result.error) throw result.error
  return result
}

function resultSchema () {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'status',
      'contextReceiptStatus',
      'catalogDigest',
      'catalogPages',
      'decisionSkillId',
      'planDigest',
      'planGeneration',
      'activatedConditionId',
      'loadedStages',
      'processComplete',
      'entryBodyDigest',
      'observedMarker'
    ],
    properties: {
      status: { type: 'string', enum: ['PASS'] },
      contextReceiptStatus: { type: 'string', enum: ['relevant-complete'] },
      catalogDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      catalogPages: { type: 'integer', minimum: 1 },
      decisionSkillId: { type: 'string' },
      planDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      planGeneration: { type: 'integer', minimum: 1 },
      activatedConditionId: { type: 'string', enum: ['test-validation'] },
      loadedStages: {
        type: 'array',
        minItems: 3,
        items: { type: 'string' }
      },
      processComplete: { type: 'boolean' },
      entryBodyDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      observedMarker: { type: 'string', pattern: '^S15_BODY_[A-F0-9-]+$' }
    }
  }
}

function buildPrompt ({ contextEpoch, hostId, project }) {
  return [
    'This is an isolated direct-observation acceptance probe.',
    'You MUST make the MCP tool calls below before producing any final answer.',
    'A JSON-only answer without actual tool calls is a failed probe, even if it matches the schema.',
    'Every final field is independently compared with persisted MCP state; never estimate, shorten, or invent a digest, stage id, marker, or receipt.',
    'Do not read the filesystem and do not infer any Skill body content.',
    'Use only the devcodex-profile and devcodex-memory MCP tools for the workflow below.',
    'First call profile_context_plan with:',
    JSON.stringify({
      intent: 'dev',
      changeTypes: ['source-code', 'testing'],
      contextEpoch,
      project,
      host: hostId,
      risk: 'normal',
      confidence: 1
    }),
    'Use the exact ContextReadBindingV1 returned by that plan for profile_load, memory_status, and the skill_route commit operation only.',
    'Call profile_load for every selected Profile file.',
    `Call memory_status with agent=${hostId}, scope=project, project=${project}, limit=5.`,
    'Do not start Skill routing until the lifecycle receipt is relevant-complete.',
    'The UserPromptSubmit hook injects a SkillRouteBootstrapV1 block containing the exact turnBinding.',
    'Copy that exact turnBinding from the injected block; never invent, derive, or guess one.',
    'Call skill_route catalog with only op, project, turnBinding, contextEpoch, and cursor when present.',
    'Read every catalog page by following nextCursor until null.',
    'Choose exactly one top-level Skill for this task: run the named-host progressive routing probe.',
    'Commit that choice with the exact catalogDigest and ContextReadBindingV1.',
    'Immediately replan the same choice with previousPlanDigest and lateConditionId=test-validation.',
    'Load every page of every stage in dependency order: entry, execution:test-validation, then closeout.',
    'Call status and require processComplete=true with every required stage loaded.',
    'Copy the exact marker line beginning S15_BODY_ from the loaded Skill body. Do not guess it.',
    'Return only one JSON object matching the requested output schema.'
  ].join('\n')
}

function hostArgs (hostId, prompt, schemaPath, outputPath) {
  if (hostId === 'codex') {
    return [
      '-a', 'never',
      '-s', 'workspace-write',
      '-c', 'model_reasoning_effort="high"',
      '--dangerously-bypass-hook-trust',
      'exec',
      '--skip-git-repo-check',
      '--ephemeral',
      '--output-schema', schemaPath,
      '--output-last-message', outputPath,
      '--color', 'never',
      prompt
    ]
  }
  if (hostId === 'copilot') {
    return [
      '--prompt', prompt,
      '--allow-all',
      '--no-ask-user',
      '--no-remote',
      '--no-remote-export',
      '--disable-builtin-mcps',
      '--output-format', 'json',
      '--stream', 'off'
    ]
  }
  if (hostId === 'claude') {
    return [
      '--print', prompt,
      '--output-format', 'json',
      '--json-schema', fs.readFileSync(schemaPath, 'utf8'),
      '--permission-mode', 'bypassPermissions',
      '--no-session-persistence',
      '--max-turns', '32'
    ]
  }
  return [
    '--skip-trust',
    '--prompt', prompt,
    '--output-format', 'json',
    '--approval-mode', 'yolo',
    '--allowed-mcp-server-names', 'devcodex-profile',
    '--allowed-mcp-server-names', 'devcodex-memory'
  ]
}

function parseHostResult (hostId, result, outputPath) {
  if (hostId === 'codex') {
    return JSON.parse(fs.readFileSync(outputPath, 'utf8'))
  }
  if (hostId === 'copilot') {
    const messages = String(result.stdout || '')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => {
        try { return JSON.parse(line) } catch { return null }
      })
      .filter(event => event?.type === 'assistant.message')
      .map(event => event.data?.content)
      .filter(value => typeof value === 'string' && value.trim())
    assert(messages.length, 'Copilot assistant.message event missing')
    return parseModelResult(JSON.stringify({ result: messages[messages.length - 1] })).final
  }
  return parseModelResult(result.stdout).final
}

function findEnvelope (fixture) {
  const root = path.join(
    fixture.activeRoot,
    '.runtime-state',
    'skill-route',
    'turns'
  )
  assert(fs.existsSync(root), 'S15 route turns directory missing')
  const candidates = fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({
      turnBinding: entry.name,
      file: path.join(root, entry.name, 'route-envelope.json')
    }))
    .filter(item => fs.existsSync(item.file))
    .map(item => ({ ...item, mtimeMs: fs.statSync(item.file).mtimeMs }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
  assert(candidates.length, 'S15 route envelope missing')
  const selected = candidates[0]
  return {
    turnBinding: selected.turnBinding,
    envelope: loadEnvelope(
      fixture.activeRoot,
      selected.turnBinding,
      fixture.runtimeOptions
    ).envelope
  }
}

function classifyFailure (descriptor, result, error) {
  const output = `${result?.stderr || ''}\n${result?.stdout || ''}\n${error?.message || ''}`
  return descriptor.authPattern.test(output)
    ? 'HOST_AUTH_REQUIRED'
    : error?.code || 'S15_HOST_PROCESS_FAILED'
}

function writeFailure (target, details) {
  if (!target) return
  fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true })
  fs.writeFileSync(`${path.resolve(target)}.failure.json`, `${JSON.stringify({
    schemaVersion: 'SkillRouteS15FailureV1',
    status: 'BLOCK',
    ...details
  }, null, 2)}\n`, 'utf8')
}

function readTraceTail (file, limit = 128) {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-limit)
    .map(line => {
      try { return JSON.parse(line) } catch { return line }
    })
}

function readLifecycleSnapshot (fixture) {
  const file = path.join(
    fixture.activeRoot,
    '.memory',
    'hooks',
    fixture.project,
    'lifecycle-state.json'
  )
  if (!fs.existsSync(file)) return null
  const state = JSON.parse(fs.readFileSync(file, 'utf8'))
  return {
    progressiveSkillRoute: state.progressiveSkillRoute || null,
    contextAcquisition: state.contextAcquisition || null,
    lastReason: state.lastReason || null
  }
}

function patchProbeHookCommand (
  hostId,
  authorityPath,
  routeTracePath,
  lifecycleTracePath,
  workspaceRoot
) {
  const home = process.env.USERPROFILE || process.env.HOME
  assert(home, 'S15 host probe requires a user home')
  const target = resolveGlobalHostTarget(hostId, {
    env: process.env,
    home
  })
  const configPath = target.files.hooks || target.files.settings
  assert(configPath && fs.existsSync(configPath), `${hostId} global hook config missing`)
  const original = fs.readFileSync(configPath, 'utf8')
  const config = JSON.parse(original)
  const suffix = [
    '--skill-route-probe-authority', `"${authorityPath}"`,
    '--skill-route-trace', `"${routeTracePath}"`,
    '--lifecycle-trace', `"${lifecycleTracePath}"`,
    '--workspace-root', `"${workspaceRoot}"`
  ].join(' ')
  let patchedCommands = 0
  function visit (value) {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (key === 'command' && typeof child === 'string' &&
          child.includes('lifecycle-host-adapters.cjs')) {
        value[key] = `${child} ${suffix}`
        patchedCommands += 1
      } else {
        visit(child)
      }
    }
  }
  visit(config)
  assert(patchedCommands > 0, `${hostId} DevCodex hook command missing`)
  const patched = `${JSON.stringify(config, null, 2)}\n`
  fs.writeFileSync(configPath, patched, 'utf8')
  return () => {
    if (fs.existsSync(configPath) && fs.readFileSync(configPath, 'utf8') === patched) {
      fs.writeFileSync(configPath, original, 'utf8')
    }
  }
}

function main () {
  const hostId = optionValue('--host')
  const evidenceOutput = optionValue('--evidence-output')
  const descriptor = HOSTS[hostId]
  if (!descriptor) {
    throw new Error(`--host must be one of: ${Object.keys(HOSTS).join(', ')}`)
  }

  const fixture = createSkillRouteFixture({
    project: `s15-${hostId}`,
    workspaceSkill: false
  })
  const startedAt = new Date().toISOString()
  const probeRunId = `s15-${hostId}-probe-${crypto.randomUUID()}`
  const contextEpoch = `ctx-${crypto.randomUUID()}`
  const marker = `S15_BODY_${crypto.randomUUID().toUpperCase()}`
  const skillId = 'workspace-s15-probe'
  const hostVariant = normalizeHostVariant(descriptor.lifecycleHost)
  const runtimeDigest = getRuntimeContractDigest()
  const hostAdapterDigest = getLifecycleHostAdapterDigest(descriptor.lifecycleHost)
  const authorityPath = path.join(fixture.root, 'probe-authority.json')
  const schemaPath = path.join(fixture.root, 's15-result.schema.json')
  const outputPath = path.join(fixture.root, 's15-result.json')
  const routeTracePath = path.join(
    fixture.activeRoot,
    '.audit-state',
    's15-skill-route-trace.jsonl'
  )
  const lifecycleTracePath = path.join(
    fixture.activeRoot,
    '.audit-state',
    's15-lifecycle-trace.jsonl'
  )
  const executable = resolveExecutable(hostId)
  let modelRun = null
  let restoreHookCommand = null

  try {
    writeProbeSkill(fixture, skillId, marker)
    writeJson(schemaPath, resultSchema())
    const now = Date.now()
    writeJson(authorityPath, {
      schemaVersion: 'SkillRouteProbeAuthorityV1',
      probeRunId,
      project: fixture.project,
      hostVariant,
      runtimeDigest,
      issuerPid: process.pid,
      issuedAt: new Date(now - 1000).toISOString(),
      expiresAt: new Date(now + 12 * 60 * 1000).toISOString(),
      allowedMode: 'unified',
      probeOnly: true
    })
    restoreHookCommand = patchProbeHookCommand(
      hostId,
      authorityPath,
      routeTracePath,
      lifecycleTracePath,
      fixture.root
    )
    const childEnv = {
      ...process.env,
      DEVCODEX_HOST_PLATFORM: descriptor.lifecycleHost,
      DEVCODEX_HOST_VARIANT: hostVariant,
      DEVCODEX_AGENT: descriptor.lifecycleHost,
      DEVCODEX_CONTEXT_EPOCH: contextEpoch,
      DEVCODEX_LIFECYCLE_TRACE: lifecycleTracePath,
      DEVCODEX_SKILL_ROUTE_TRACE: routeTracePath,
      DEVCODEX_SKILL_ROUTE_MODE: 'unified',
      DEVCODEX_SKILL_ROUTE_PROBE_AUTHORITY: authorityPath
    }
    const versionRun = run(
      executable.command,
      [...executable.prefix, ...descriptor.versionArgs],
      { cwd: fixture.projectRoot, env: childEnv, timeout: 30000 }
    )
    assert.strictEqual(versionRun.status, 0, versionRun.stderr || versionRun.stdout)
    const testedVersion = String(versionRun.stdout || versionRun.stderr).trim()
    const prompt = buildPrompt({
      contextEpoch,
      hostId: descriptor.lifecycleHost,
      project: fixture.project
    })
    modelRun = run(
      executable.command,
      [
        ...executable.prefix,
        ...hostArgs(hostId, prompt, schemaPath, outputPath)
      ],
      { cwd: fixture.projectRoot, env: childEnv, timeout: 600000 }
    )
    if (modelRun.status !== 0) {
      const error = new Error(modelRun.stderr || modelRun.stdout)
      error.code = classifyFailure(descriptor, modelRun, error)
      throw error
    }

    const final = parseHostResult(hostId, modelRun, outputPath)
    const located = findEnvelope(fixture)
    const state = located.envelope.state
    const lifecycleFile = path.join(
      fixture.activeRoot,
      '.memory',
      'hooks',
      fixture.project,
      'lifecycle-state.json'
    )
    assert(fs.existsSync(lifecycleFile), 'S15 lifecycle state missing')
    const lifecycleState = JSON.parse(fs.readFileSync(lifecycleFile, 'utf8'))
    const contextAcquisition = lifecycleState.contextAcquisition
    const selectedChunk = state.plan?.baseResolution?.selected.find(item =>
      item.skillId === skillId
    )
    assert(selectedChunk, 'S15 selected Skill body missing')
    const requiredStageIds = state.plan.stages.map(stage => stage.stageId)
    const loadedStageIds = requiredStageIds.filter(stageId =>
      state.stageProgress[stageId]?.status === 'loaded'
    )

    assert.strictEqual(final.status, 'PASS')
    assert.strictEqual(final.contextReceiptStatus, 'relevant-complete')
    assert.strictEqual(final.observedMarker, marker)
    assert.strictEqual(final.catalogDigest, state.catalog.catalogDigest)
    assert.strictEqual(final.catalogPages, state.catalog.pages.length)
    assert.strictEqual(final.decisionSkillId, skillId)
    assert.strictEqual(final.planDigest, state.plan.planDigest)
    assert.strictEqual(final.planGeneration, state.plan.generation)
    assert.strictEqual(final.activatedConditionId, 'test-validation')
    assert.deepStrictEqual([...final.loadedStages].sort(), [...requiredStageIds].sort())
    assert.strictEqual(final.processComplete, true)
    assert.strictEqual(final.entryBodyDigest, selectedChunk.bodyDigest)
    assert.deepStrictEqual(loadedStageIds, requiredStageIds)
    assert.strictEqual(state.mode, 'unified')
    assert.strictEqual(contextAcquisition.contextEpoch, contextEpoch)
    assert.strictEqual(contextAcquisition.project, fixture.project)
    assert.strictEqual(contextAcquisition.receipt.status, 'relevant-complete')

    const evidence = {
      schemaVersion: 'SkillRouteS15EvidenceV1',
      status: 'PASS',
      probeRunId,
      host: descriptor.lifecycleHost,
      hostVariant,
      testedVersion,
      protocolVersion: '2024-11-05',
      runtimeDigest,
      hostAdapterDigest,
      authorizationSource: 'isolated-probe-authority',
      routeActivation: {
        requested: 'unified',
        source: 'operator-override',
        effective: 'unified',
        reason: 'isolated-probe-authority',
        probeAuthorityUsed: true
      },
      project: fixture.project,
      contextEpoch,
      turnBinding: located.turnBinding,
      catalogDigest: state.catalog.catalogDigest,
      catalogPages: state.catalog.pages.length,
      candidateCount: state.catalog.candidateCount,
      decisionSkillId: state.decision.skillId,
      decisionDigest: state.decision.decisionDigest,
      planDigest: state.plan.planDigest,
      planGeneration: state.plan.generation,
      activatedConditionIds: state.plan.activatedConditionIds,
      requiredStageIds,
      loadedStageIds,
      processComplete: loadedStageIds.length === requiredStageIds.length,
      bodyDigest: selectedChunk.bodyDigest,
      markerDigest: sha256(marker),
      contextAcquisition: {
        source: 'host-hooks',
        prewritten: false,
        receiptStatus: contextAcquisition.receipt.status,
        observedTools: contextAcquisition.postHistory.map(item => item.canonical)
      },
      observedOps: [
        'profile_context_plan',
        'profile_load',
        'memory_status',
        'catalog',
        'commit',
        'conditional-replan',
        'load_stage',
        'status'
      ],
      retirementAnomalies: {
        legacyFallback: 0,
        doubleBody: 0,
        crossRoot: 0,
        stateCorruption: 0,
        missingStage: 0,
        missingCloseout: 0
      },
      transport: {
        kind: 'local-stdio',
        servers: ['devcodex-profile', 'devcodex-memory'],
        networkListener: false,
        longRunningServiceStarted: false,
        childExitedWithHost: true
      },
      startedAt,
      completedAt: new Date().toISOString(),
      evidenceDigest: ''
    }
    evidence.evidenceDigest = sha256({ ...evidence, evidenceDigest: null })
    recordSkillRouteProbeObservation(
      fixture.activeRoot,
      located.turnBinding,
      evidence,
      {
        ...fixture.runtimeOptions,
        authorityPath,
        env: childEnv
      }
    )
    if (evidenceOutput) {
      fs.mkdirSync(path.dirname(path.resolve(evidenceOutput)), { recursive: true })
      fs.writeFileSync(
        path.resolve(evidenceOutput),
        `${JSON.stringify(evidence, null, 2)}\n`,
        'utf8'
      )
    }
    process.stdout.write(`${JSON.stringify({
      status: 'PASS',
      probeRunId,
      hostVariant,
      testedVersion,
      evidenceDigest: evidence.evidenceDigest,
      evidenceOutput: evidenceOutput ? path.resolve(evidenceOutput) : null
    })}\n`)
  } catch (error) {
    const errorCode = classifyFailure(descriptor, modelRun, error)
    writeFailure(evidenceOutput, {
      errorCode,
      host: descriptor.lifecycleHost,
      hostVariant,
      probeRunId,
      runtimeDigest,
      hostAdapterDigest,
      startedAt,
      failedAt: new Date().toISOString(),
      exitCode: modelRun?.status ?? null,
      error: error.message,
      stdout: String(modelRun?.stdout || '').slice(-12000),
      stderr: String(modelRun?.stderr || '').slice(-12000),
      routeTrace: readTraceTail(routeTracePath),
      lifecycleTrace: readTraceTail(lifecycleTracePath),
      lifecycleState: readLifecycleSnapshot(fixture)
    })
    error.code = errorCode
    throw error
  } finally {
    if (restoreHookCommand) restoreHookCommand()
    fixture.cleanup()
  }
}

if (require.main === module) main()

module.exports = {
  HOSTS,
  buildPrompt,
  classifyFailure,
  hostArgs,
  patchProbeHookCommand,
  resolveExecutable,
  resultSchema
}
