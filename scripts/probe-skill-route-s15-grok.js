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
  loadEnvelope,
  recordSkillRouteProbeObservation
} = require('../hooks/_runtime/skill-route-state.cjs')
const {
  sha256
} = require('../hooks/_runtime/progressive-skill-route-contract.cjs')
const {
  launchGrok
} = require('./lib/grok-workspace-launcher')
const {
  resolveGlobalHostTarget
} = require('./lib/global-host-target')
const {
  createSkillRouteFixture,
  writeJson
} = require('./lib/skill-route-test-fixture')

function optionValue (name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}

function hasOption (name) {
  return process.argv.includes(name)
}

function run (command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    timeout: options.timeout || 120000,
    maxBuffer: 16 * 1024 * 1024
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const error = new Error(
      `${command} ${args.slice(0, 4).join(' ')} failed: ${result.stderr || result.stdout}`
    )
    error.code = 'S15_PROCESS_FAILED'
    error.result = result
    throw error
  }
  return result
}

function parseModelResult (stdout) {
  const outer = JSON.parse(String(stdout || '').trim())
  if (outer.is_error === true) {
    const error = new Error(`S15_MODEL_ERROR: ${outer.result || 'unknown'}`)
    error.code = 'S15_MODEL_ERROR'
    throw error
  }
  if (outer.structured_output && typeof outer.structured_output === 'object') {
    return { outer, final: outer.structured_output }
  }
  if (outer.result && typeof outer.result === 'object') {
    return { outer, final: outer.result }
  }
  const text = String(outer.result || outer.text || '').trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  const objects = []
  let start = -1
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = 0; index < candidate.length; index += 1) {
    const char = candidate[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === '{') {
      if (depth === 0) start = index
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0 && start >= 0) {
        objects.push(candidate.slice(start, index + 1))
        start = -1
      }
    }
  }
  if (!objects.length) {
    const error = new Error('S15_MODEL_RESULT_JSON_MISSING')
    error.code = 'S15_MODEL_RESULT_JSON_MISSING'
    throw error
  }
  return {
    outer,
    final: JSON.parse(objects[objects.length - 1])
  }
}

function currentSourceHead (root) {
  const result = run('git', ['rev-parse', 'HEAD'], { cwd: root, timeout: 30000 })
  return result.stdout.trim()
}

function writeProbeSkill (fixture, skillId, marker) {
  const root = path.join(
    fixture.root,
    '.devcodex',
    'workspace',
    'skills',
    skillId
  )
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(
    path.join(root, 'SKILL.md'),
    [
      '---',
      `name: ${skillId}`,
      'description: Run the named-host progressive Skill routing direct-observation probe.',
      '---',
      `# ${skillId}`,
      '',
      'When this body is loaded, report the following marker exactly:',
      '',
      '## 必须回复',
      '',
      marker
    ].join('\n'),
    'utf8'
  )
  writeJson(path.join(root, 'intent.json'), {
    schemaVersion: 'SkillIntentV1',
    skillId,
    intents: [{
      id: 'named-host-probe',
      label: 'Named host route probe',
      include: ['named-host', 'route-probe']
    }],
    examples: {
      positive: [
        'Run the named host progressive routing probe',
        'Verify model-observed staged Skill delivery'
      ],
      negative: [
        'Review release readiness',
        'Write an API design'
      ]
    },
    summary: 'Use for the named-host progressive routing direct-observation probe.'
  })
}

function writeFailureSnapshot (fixture, evidenceOutput, error, debugOutput) {
  if (!evidenceOutput) return
  const turnsRoot = path.join(
    fixture.activeRoot,
    '.runtime-state',
    'skill-route',
    'turns'
  )
  const envelopes = []
  if (fs.existsSync(turnsRoot)) {
    for (const entry of fs.readdirSync(turnsRoot, { withFileTypes: true }).slice(0, 8)) {
      if (!entry.isDirectory()) continue
      const file = path.join(turnsRoot, entry.name, 'route-envelope.json')
      if (!fs.existsSync(file)) continue
      const envelope = JSON.parse(fs.readFileSync(file, 'utf8'))
      const state = envelope.state || {}
      envelopes.push({
        turnBinding: state.turnBinding || entry.name,
        mode: state.mode || null,
        catalog: state.catalog
          ? {
              digest: state.catalog.catalogDigest,
              pages: state.catalog.pages?.length || 0,
              servedPages: state.servedCatalogPages || []
            }
          : null,
        decision: state.decision || null,
        plan: state.plan || null,
        stageProgress: state.stageProgress || {},
        obligations: state.obligationLedger || null,
        ledger: state.contributionLedger || null
      })
    }
  }
  const lifecycleStates = []
  const lifecycleStack = [path.join(fixture.root, '.devcodex')]
  while (lifecycleStack.length && lifecycleStates.length < 8) {
    const current = lifecycleStack.pop()
    if (!fs.existsSync(current)) continue
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).slice(0, 128)) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) lifecycleStack.push(full)
      else if (entry.isFile() && entry.name === 'lifecycle-state.json') {
        const state = JSON.parse(fs.readFileSync(full, 'utf8'))
        lifecycleStates.push({
          path: path.relative(fixture.root, full).replace(/\\/g, '/'),
          activeProject: state.activeProject || null,
          activeScope: state.activeScope || null,
          contextAcquisition: state.contextAcquisition || null
        })
      }
    }
  }
  const routeTraceFile = path.join(
    fixture.activeRoot,
    '.audit-state',
    's15-skill-route-trace.jsonl'
  )
  const routeTrace = fs.existsSync(routeTraceFile)
    ? fs.readFileSync(routeTraceFile, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-64)
        .map(line => JSON.parse(line))
    : []
  const lifecycleTraceFile = path.join(
    fixture.activeRoot,
    '.audit-state',
    's15-lifecycle-trace.jsonl'
  )
  const lifecycleTrace = fs.existsSync(lifecycleTraceFile)
    ? fs.readFileSync(lifecycleTraceFile, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-128)
        .map(line => JSON.parse(line))
    : []
  const hookDiagnosticFile = path.join(
    fixture.activeRoot,
    '.audit-state',
    'grok-plugin-data',
    'pretool-last.json'
  )
  const hookDiagnostic = fs.existsSync(hookDiagnosticFile)
    ? JSON.parse(fs.readFileSync(hookDiagnosticFile, 'utf8'))
    : null
  const hookTrace = fs.existsSync(debugOutput)
    ? fs.readFileSync(debugOutput, 'utf8')
        .split(/\r?\n/)
        .filter(line => /xai_grok_hooks|hook discovery|hook (?:completed|allowed|blocked)/i.test(line))
        .slice(-128)
        .map(line => line.slice(0, 2000))
    : []
  const target = `${path.resolve(evidenceOutput)}.failure.json`
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, `${JSON.stringify({
    schemaVersion: 'SkillRouteS15FailureV1',
    errorCode: error.code || error.name || 'S15_FAILED',
    error: error.message,
    lifecycleStates,
    routeTrace,
    lifecycleTrace,
    hookDiagnostic,
    hookTrace,
    envelopes
  }, null, 2)}\n`, 'utf8')
}

function main () {
  const evidenceOutput = optionValue('--evidence-output')
  const productionEligible = hasOption('--production-eligible')
  const maxTurns = optionValue('--max-turns') || '32'
  const fixture = createSkillRouteFixture({
    project: 's15-grok',
    workspaceSkill: false
  })
  const startedAt = new Date().toISOString()
  const probeRunId = `s15-grok-${productionEligible ? 'production' : 'probe'}-${crypto.randomUUID()}`
  const debugOutput = path.join(fixture.root, 'grok-debug.log')
  const contextEpoch = `ctx-${crypto.randomUUID()}`
  const skillId = 'workspace-s15-probe'
  const marker = `S15_BODY_${crypto.randomUUID().toUpperCase()}`
  const authorityPath = path.join(fixture.root, 'probe-authority.json')
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
  const userHome = process.env.USERPROFILE || process.env.HOME
  const host = 'grok-cli-single'
  const hostVariant = normalizeHostVariant(host)
  const runtimeDigest = getRuntimeContractDigest()
  let childEnv
  let globalTarget

  try {
    writeProbeSkill(fixture, skillId, marker)
    assert(userHome, 'S15 requires the current user home for the production Grok host')
    globalTarget = resolveGlobalHostTarget('grok', {
      env: process.env,
      home: userHome
    })
    childEnv = {
      ...process.env,
      DEVCODEX_HOST_PLATFORM: host,
      DEVCODEX_AGENT: host,
      DEVCODEX_CONTEXT_EPOCH: contextEpoch,
      GROK_FOLDER_TRUST: '0',
      GROK_PLUGIN_DATA: path.join(
        fixture.activeRoot,
        '.audit-state',
        'grok-plugin-data'
      ),
      DEVCODEX_LIFECYCLE_TRACE: lifecycleTracePath,
      DEVCODEX_GLOBAL_SKILLS_RUNTIME: globalTarget.shared.skillsRuntime,
      DEVCODEX_SKILL_ROUTE_MODE: 'unified'
    }
    if (!productionEligible) {
      childEnv.DEVCODEX_SKILL_ROUTE_PROBE_AUTHORITY = authorityPath
    }
    if (!productionEligible) {
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
    }

    const pluginList = run('grok', ['plugin', 'list'], {
      cwd: fixture.projectRoot,
      env: childEnv,
      timeout: 30000
    })
    assert.match(`${pluginList.stdout}\n${pluginList.stderr}`, /devcodex-workspace/i)
    const inspection = JSON.parse(run('grok', ['inspect', '--json'], {
      cwd: fixture.projectRoot,
      env: childEnv,
      timeout: 30000
    }).stdout)
    const pluginHook = inspection.hooks.find(hook =>
      hook.source?.type === 'plugin' &&
      hook.source?.plugin_name === 'devcodex-workspace' &&
      hook.hookType === 'file'
    )
    assert(pluginHook, 'Grok did not discover the DevCodex plugin Hook file')
    const globalHook = inspection.hooks.find(hook =>
      hook.source?.type === 'user' &&
      hook.hookType === 'command' &&
      String(hook.target || '').includes(path.join(
        globalTarget.runtimeRoot,
        'hooks',
        '_runtime',
        'lifecycle-host-adapters.cjs'
      )) &&
      /\bgrok\s*$/.test(String(hook.target || ''))
    )
    assert(globalHook, 'Grok did not discover the always-trusted DevCodex user Hook')
    const pluginHookConfig = JSON.parse(fs.readFileSync(pluginHook.target, 'utf8'))
    const pluginHookCommands = Object.values(pluginHookConfig.hooks || {})
      .flatMap(groups => groups)
      .flatMap(group => group.hooks || [])
      .map(hook => String(hook.command || ''))
    assert(pluginHookCommands.some(command =>
      command.includes(path.join(
        globalTarget.runtimeRoot,
        'hooks',
        '_runtime',
        'lifecycle-host-adapters.cjs'
      )) &&
      /\bgrok\s*$/.test(command)
    ), 'Grok plugin Hook is not bound to the installed DevCodex grok adapter')

    const grokVersion = run('grok', ['--version'], {
      cwd: fixture.projectRoot,
      env: childEnv,
      timeout: 30000
    }).stdout.trim()
    run('grok', [
      'mcp',
      'add',
      '--scope',
      'project',
      'devcodex-profile',
      '-e',
      `DEVCODEX_GLOBAL_SKILLS_RUNTIME=${globalTarget.shared.skillsRuntime}`,
      '-e',
      'DEVCODEX_AGENT=grok',
      '-e',
      `DEVCODEX_SKILL_ROUTE_TRACE=${routeTracePath}`,
      '--',
      process.execPath,
      path.join(globalTarget.runtimeRoot, 'mcp', 'profile-server.js'),
      fixture.root
    ], {
      cwd: fixture.projectRoot,
      env: childEnv,
      timeout: 30000
    })
    run('grok', [
      'mcp',
      'add',
      '--scope',
      'project',
      'devcodex-memory',
      '-e',
      'DEVCODEX_AGENT=grok',
      '--',
      process.execPath,
      path.join(globalTarget.runtimeRoot, 'mcp', 'memory-server.js'),
      fixture.root
    ], {
      cwd: fixture.projectRoot,
      env: childEnv,
      timeout: 30000
    })
    const doctor = run('grok', ['mcp', 'doctor'], {
      cwd: fixture.projectRoot,
      env: childEnv,
      timeout: 180000
    })
    assert.match(
      `${doctor.stdout}\n${doctor.stderr}`,
      /devcodex-profile/i
    )
    assert.match(
      `${doctor.stdout}\n${doctor.stderr}`,
      /devcodex-memory/i
    )

    const resultSchema = {
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
          uniqueItems: true,
          items: { type: 'string' }
        },
        processComplete: { type: 'boolean', const: true },
        entryBodyDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        observedMarker: { type: 'string', pattern: '^S15_BODY_[A-F0-9-]+$' }
      }
    }
    const prompt = [
      'This is an isolated direct-observation acceptance probe.',
      'Do not read the filesystem and do not infer any Skill body content.',
      'First call profile_context_plan on server devcodex-profile with:',
      JSON.stringify({
        intent: 'dev',
        changeTypes: ['source-code', 'testing'],
        contextEpoch,
        project: fixture.project,
        host,
        risk: 'normal',
        confidence: 1
      }),
      'Use the exact ContextReadBindingV1 returned by that plan for profile_load, memory_status, and skill_route commit only.',
      'For skill_route catalog send only op, project, turnBinding, contextEpoch, and cursor when present. Never send contextBinding to catalog, load_stage, or status.',
      'Call profile_load for every selected Profile file in the plan and call memory_status on server devcodex-memory with agent=grok, scope=project, project=s15-grok, limit=5.',
      'Do not start Skill routing until the lifecycle receipt is relevant-complete.',
      'Read every catalog page by following nextCursor until null.',
      'Choose exactly one top-level Skill from the catalog based on this task: run the named-host progressive routing probe.',
      'Commit that choice with the exact catalogDigest and ContextReadBindingV1.',
      'Immediately replan the same choice with previousPlanDigest and lateConditionId=test-validation.',
      'From the replanned result, load every page of every stage in dependency order: entry, execution:test-validation, then closeout.',
      'Call status and require processComplete=true with every required stage loaded.',
      'Your final JSON must copy the context receipt status, catalogDigest/pageCount, selected skill, replanned planDigest/generation, loaded stage ids, processComplete, and entry bodyDigest from Tool results.',
      'Copy the exact marker line beginning S15_BODY_ from the loaded Skill body. Do not guess it.'
    ].join('\n')
    let modelRun
    const launch = launchGrok([
      '--debug',
      '--debug-file',
      debugOutput,
      '--single',
      prompt,
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(resultSchema),
      '--permission-mode',
      'bypassPermissions',
      '--reasoning-effort',
      'low',
      '--no-memory',
      '--no-plan',
      '--no-subagents',
      '--disable-web-search',
      '--max-turns',
      maxTurns
    ], {
      cwd: fixture.projectRoot,
      env: childEnv,
      globalHostEnv: process.env,
      home: userHome,
      stdio: 'pipe',
      spawnSync: (command, args, options) => {
        modelRun = spawnSync(command, args, {
          ...options,
          encoding: 'utf8',
          timeout: 600000,
          maxBuffer: 16 * 1024 * 1024
        })
        return modelRun
      }
    })
    assert.strictEqual(launch.status, 0, modelRun?.stderr || modelRun?.stdout)
    assert.strictEqual(launch.plan.skillRoute.active, true)
    assert.strictEqual(
      launch.plan.skillRoute.modeReceipt.effective,
      'unified'
    )
    if (productionEligible) {
      assert.strictEqual(
        launch.plan.skillRoute.modeReceipt.hostEligibility,
        'PASS'
      )
      assert.strictEqual(
        launch.plan.skillRoute.modeReceipt.capabilityRuntimeCurrent,
        true
      )
      assert.strictEqual(
        launch.plan.skillRoute.modeReceipt.capabilityAdapterCurrent,
        true
      )
      assert.strictEqual(
        launch.plan.skillRoute.modeReceipt.probeAuthority,
        null
      )
      assert.strictEqual(
        Object.prototype.hasOwnProperty.call(
          childEnv,
          'DEVCODEX_SKILL_ROUTE_PROBE_AUTHORITY'
        ),
        false
      )
    }
    assert(launch.plan.skillRoute.injectionBytes <= 4 * 1024)
    const bootstrap = launch.plan.skillRoute.bootstrap
    const parsed = parseModelResult(modelRun.stdout)
    const final = parsed.final
    const persisted = loadEnvelope(
      fixture.activeRoot,
      bootstrap.turnBinding,
      fixture.runtimeOptions
    ).envelope
    const state = persisted.state
    const lifecycleState = JSON.parse(fs.readFileSync(path.join(
      fixture.activeRoot,
      '.memory',
      'hooks',
      fixture.project,
      'lifecycle-state.json'
    ), 'utf8'))
    const contextAcquisition = lifecycleState.contextAcquisition
    const selectedChunk = state.plan?.baseResolution?.selected.find(item =>
      item.skillId === skillId
    )
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
    assert.deepStrictEqual(
      [...final.loadedStages].sort(),
      [...requiredStageIds].sort()
    )
    assert.strictEqual(final.processComplete, true)
    assert.strictEqual(final.entryBodyDigest, selectedChunk.bodyDigest)
    assert.strictEqual(
      state.servedCatalogPages.length,
      state.catalog.pages.length
    )
    assert(state.plan.generation >= 1)
    assert(state.plan.activatedConditionIds.includes('test-validation'))
    assert.deepStrictEqual(loadedStageIds, requiredStageIds)
    assert.strictEqual(state.mode, 'unified')
    assert.strictEqual(contextAcquisition.contextEpoch, contextEpoch)
    assert.strictEqual(contextAcquisition.project, fixture.project)
    assert.strictEqual(contextAcquisition.receipt.status, 'relevant-complete')
    assert(contextAcquisition.postHistory.some(item =>
      item.canonical === 'devcodex-profile/profile_context_plan' && item.outcome === 'observed'
    ))
    assert(contextAcquisition.postHistory.some(item =>
      item.canonical === 'devcodex-profile/profile_load' && item.outcome === 'observed'
    ))
    assert(contextAcquisition.postHistory.some(item =>
      item.canonical === 'devcodex-memory/memory_status' && item.outcome === 'observed'
    ))
    assert(contextAcquisition.postHistory.some(item =>
      item.canonical === 'devcodex-profile/skill_route' && item.outcome === 'observed'
    ))

    const evidence = {
      schemaVersion: 'SkillRouteS15EvidenceV1',
      status: 'PASS',
      probeRunId,
      host,
      hostVariant,
      testedVersion: grokVersion,
      protocolVersion: '2024-11-05',
      sourceHead: currentSourceHead(fixture.packageRoot),
      runtimeDigest,
      hostAdapterDigest: launch.plan.skillRoute.hostAdapterDigest,
      authorizationSource: productionEligible
        ? 'capability-pass'
        : 'isolated-probe-authority',
      routeActivation: {
        requested: launch.plan.skillRoute.modeReceipt.requested,
        source: launch.plan.skillRoute.modeReceipt.source,
        effective: launch.plan.skillRoute.modeReceipt.effective,
        reason: launch.plan.skillRoute.modeReceipt.reason,
        hostEligibility: launch.plan.skillRoute.modeReceipt.hostEligibility,
        capabilityRuntimeCurrent:
          launch.plan.skillRoute.modeReceipt.capabilityRuntimeCurrent,
        capabilityAdapterCurrent:
          launch.plan.skillRoute.modeReceipt.capabilityAdapterCurrent,
        probeAuthorityUsed:
          launch.plan.skillRoute.modeReceipt.probeAuthority !== null
      },
      project: fixture.project,
      contextEpoch,
      turnBinding: bootstrap.turnBinding,
      bootstrapDigest: bootstrap.bootstrapDigest,
      bootstrapBytes: launch.plan.skillRoute.injectionBytes,
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
      marker,
      markerDigest: sha256(marker),
      contextAcquisition: {
        source: 'host-hooks',
        discoveredHookSources: ['user-global', 'plugin'],
        prewritten: false,
        planId: contextAcquisition.plan.planId,
        planContentId: contextAcquisition.plan.planContentId,
        receiptId: contextAcquisition.receipt.receiptId,
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
      modelResultDigest: sha256(parsed.outer),
      modelUsage: parsed.outer.usage || null,
      negativeProbeRefs: [
        'scripts/test-skill-route-contracts.js',
        'scripts/test-skill-route-state.js',
        'scripts/test-skill-route-lifecycle.js'
      ],
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
    evidence.evidenceDigest = sha256({
      ...evidence,
      evidenceDigest: null
    })
    if (!productionEligible) {
      recordSkillRouteProbeObservation(
        fixture.activeRoot,
        bootstrap.turnBinding,
        evidence,
        {
          ...fixture.runtimeOptions,
          authorityPath,
          env: childEnv
        }
      )
      const observed = loadEnvelope(
        fixture.activeRoot,
        bootstrap.turnBinding,
        fixture.runtimeOptions
      ).envelope.state
      assert.strictEqual(
        observed.probeObservation.evidenceDigest,
        evidence.evidenceDigest
      )
      assert(observed.contributionLedger.items.some(item =>
        item.op === 'load_stage' && item.modelObserved === 'direct-pass'
      ))
    }

    if (evidenceOutput) {
      const target = path.resolve(evidenceOutput)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
    }
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      probeRunId,
      hostVariant,
      testedVersion: grokVersion,
      evidenceDigest: evidence.evidenceDigest,
      evidenceOutput: evidenceOutput ? path.resolve(evidenceOutput) : null
    })}\n`)
  } catch (error) {
    writeFailureSnapshot(fixture, evidenceOutput, error, debugOutput)
    throw error
  } finally {
    fixture.cleanup()
  }
}

if (require.main === module) main()

module.exports = {
  parseModelResult,
  writeProbeSkill
}
