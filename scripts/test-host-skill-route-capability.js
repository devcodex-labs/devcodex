#!/usr/bin/env node
'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { sha256 } = require('../hooks/_runtime/progressive-skill-route-contract.cjs')
const {
  CAPABILITY_REF,
  CODEX_VARIANT,
  EVIDENCE_REF,
  currentBindings,
  promoteCodexSkillRouteCapability,
  rawDigest
} = require('./lib/host-skill-route-capability')
const { validateCapabilityDocument } = require('../hooks/_runtime/skill-route-mode.cjs')
const {
  HOST_ENTRY_SURFACES,
  getLifecycleHostAdapterDigest
} = require('../hooks/_runtime/host-adapter-identity.cjs')

const ROOT = path.resolve(__dirname, '..')

function withDigest (value) {
  const next = JSON.parse(JSON.stringify(value))
  next.evidenceDigest = rawDigest(next)
  return next
}

function rawEvidence () {
  const bindings = currentBindings({ packageRoot: ROOT })
  assert.strictEqual(
    bindings.hostAdapterDigest,
    getLifecycleHostAdapterDigest('codex', {
      entrySurface: HOST_ENTRY_SURFACES.codex,
      env: {}
    })
  )
  const argv = ['exec', '--ephemeral', 'S15 fixture']
  const invocation = {
    schemaVersion: 'HostInvocationEvidenceV1',
    host: 'codex',
    hostVariant: CODEX_VARIANT,
    entrySurface: HOST_ENTRY_SURFACES.codex,
    executable: {
      command: 'codex',
      prefix: [],
      resolutionSource: 'fixture'
    },
    argvCount: argv.length,
    argvDigest: sha256(argv),
    boundedArguments: argv.map((value, index) => ({
      index,
      bytes: Buffer.byteLength(value, 'utf8'),
      value
    })),
    argumentsTruncated: false,
    ambientDesktopMarkersPresent: false,
    hostAdapterDigest: bindings.hostAdapterDigest
  }
  invocation.descriptorDigest = sha256(invocation)
  return withDigest({
    schemaVersion: 'SkillRouteS15EvidenceV1',
    status: 'PASS',
    probeRunId: `s15-codex-probe-${crypto.randomUUID()}`,
    host: 'codex',
    hostVariant: CODEX_VARIANT,
    testedVersion: 'codex-cli fixture / source candidate fixture',
    protocolVersion: '2024-11-05',
    runtimeDigest: bindings.runtimeContractDigest,
    hostAdapterDigest: bindings.hostAdapterDigest,
    hostInvocation: invocation,
    authorizationSource: 'isolated-probe-authority',
    runtimeBinding: {
      source: 'isolated-source-candidate',
      expectedDigest: bindings.runtimeContractDigest,
      generationDigest: bindings.runtimeContractDigest,
      modeReceiptDigest: bindings.runtimeContractDigest,
      routeEnvelopeDigest: bindings.runtimeContractDigest
    },
    routeActivation: {
      requested: 'unified',
      source: 'probe-authority',
      effective: 'unified',
      reason: 'fixture',
      hostEligibility: 'UNVERIFIED',
      capabilityRuntimeCurrent: false,
      capabilityAdapterCurrent: true,
      probeAuthorityUsed: true
    },
    project: 'host-skill-route-capability-fixture',
    contextEpoch: 'ctx-host-skill-route-capability-fixture',
    turnBinding: 'turn-host-skill-route-capability-fixture',
    catalogDigest: '1'.repeat(64),
    catalogPages: 1,
    candidateCount: 1,
    decisionSkillId: 'test-validation',
    decisionDigest: '2'.repeat(64),
    planDigest: '3'.repeat(64),
    planGeneration: 1,
    activatedConditionIds: [],
    requiredStageIds: ['entry', 'closeout'],
    loadedStageIds: ['entry', 'closeout'],
    processComplete: true,
    bodyDigest: '4'.repeat(64),
    marker: 'fixture-marker',
    markerDigest: sha256('fixture-marker'),
    contextAcquisition: {
      source: 'host-hooks',
      prewritten: false,
      receiptStatus: 'relevant-complete',
      observationMode: 'hook-post-history',
      observedTools: [
        'devcodex-profile/profile_load',
        'devcodex-memory/memory_status'
      ]
    },
    observedOps: [
      'profile_context_plan',
      'profile_load',
      'memory_status',
      'catalog',
      'commit',
      'context-refresh',
      'rebind',
      'load_stage',
      'status'
    ],
    contextRebind: {
      exercised: true,
      ledgerEntries: 1,
      finalGeneration: 1,
      order: {
        schemaVersion: 'SkillRouteS15RebindOrderV1',
        rebindGeneration: 1,
        rebindLedgerIndex: 1,
        preRebindStageLoads: 0,
        generationOneStageLoads: 2,
        generationOneStageIds: ['entry', 'closeout'],
        orderedRouteTrace: [
          { ledgerIndex: 0, op: 'commit', generation: 0, stageId: null },
          { ledgerIndex: 1, op: 'rebind', generation: 1, stageId: null },
          { ledgerIndex: 2, op: 'load_stage', generation: 1, stageId: 'entry' },
          { ledgerIndex: 3, op: 'load_stage', generation: 1, stageId: 'closeout' }
        ]
      }
    },
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
    startedAt: '2026-08-31T00:00:00.000Z',
    completedAt: '2026-08-31T00:00:01.000Z',
    evidenceDigest: ''
  })
}

function preparePackageRoot (tempRoot) {
  for (const relative of [CAPABILITY_REF, EVIDENCE_REF]) {
    const source = path.join(ROOT, ...relative.split('/'))
    const target = path.join(tempRoot, ...relative.split('/'))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(source, target)
  }
}

function expectCode (code, operation) {
  assert.throws(operation, error => error?.code === code)
}

function run () {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-host-capability-'))
  let checks = 0
  try {
    const positiveRoot = path.join(tempRoot, 'positive')
    preparePackageRoot(positiveRoot)
    const raw = rawEvidence()
    const receipt = promoteCodexSkillRouteCapability(raw, {
      packageRoot: positiveRoot,
      runtimePackageRoot: ROOT,
      completedAt: '2026-08-31T00:00:02.000Z',
      transactionId: 'fixture-positive'
    })
    assert.strictEqual(receipt.status, 'committed')
    const capability = JSON.parse(fs.readFileSync(path.join(positiveRoot, ...CAPABILITY_REF.split('/')), 'utf8'))
    assert.strictEqual(validateCapabilityDocument(capability, { packageRoot: positiveRoot }).valid, true)
    checks++

    const wrongHost = withDigest({ ...raw, host: 'grok' })
    expectCode('HOST_SKILL_ROUTE_RAW_IDENTITY_MISMATCH', () =>
      promoteCodexSkillRouteCapability(wrongHost, {
        packageRoot: positiveRoot,
        runtimePackageRoot: ROOT
      }))
    checks++

    const stale = JSON.parse(JSON.stringify(raw))
    stale.runtimeDigest = 'f'.repeat(64)
    for (const key of ['expectedDigest', 'generationDigest', 'modeReceiptDigest', 'routeEnvelopeDigest']) {
      stale.runtimeBinding[key] = stale.runtimeDigest
    }
    expectCode('HOST_SKILL_ROUTE_RUNTIME_DIGEST_MISMATCH', () =>
      promoteCodexSkillRouteCapability(withDigest(stale), {
        packageRoot: positiveRoot,
        runtimePackageRoot: ROOT
      }))
    checks++

    const missingRebind = JSON.parse(JSON.stringify(raw))
    missingRebind.observedOps = missingRebind.observedOps.filter(op => op !== 'rebind')
    expectCode('HOST_SKILL_ROUTE_PROBE_INCOMPLETE', () =>
      promoteCodexSkillRouteCapability(withDigest(missingRebind), {
        packageRoot: positiveRoot,
        runtimePackageRoot: ROOT
      }))
    checks++

    const anomaly = JSON.parse(JSON.stringify(raw))
    anomaly.retirementAnomalies.crossRoot = 1
    expectCode('HOST_SKILL_ROUTE_RETIREMENT_ANOMALY', () =>
      promoteCodexSkillRouteCapability(withDigest(anomaly), {
        packageRoot: positiveRoot,
        runtimePackageRoot: ROOT
      }))
    checks++

    const badDigest = JSON.parse(JSON.stringify(raw))
    badDigest.evidenceDigest = '0'.repeat(64)
    expectCode('HOST_SKILL_ROUTE_RAW_DIGEST_MISMATCH', () =>
      promoteCodexSkillRouteCapability(badDigest, {
        packageRoot: positiveRoot,
        runtimePackageRoot: ROOT
      }))
    checks++

    const rollbackRoot = path.join(tempRoot, 'rollback')
    preparePackageRoot(rollbackRoot)
    const capabilityPath = path.join(rollbackRoot, ...CAPABILITY_REF.split('/'))
    const evidencePath = path.join(rollbackRoot, ...EVIDENCE_REF.split('/'))
    const beforeCapability = fs.readFileSync(capabilityPath)
    const beforeEvidence = fs.readFileSync(evidencePath)
    let stageReplacements = 0
    const failingFs = new Proxy(fs, {
      get (target, property) {
        if (property === 'renameSync') {
          return (source, destination) => {
            if (String(source).includes('.devcodex-stage-') &&
                [capabilityPath, evidencePath].includes(path.resolve(destination))) {
              stageReplacements++
              if (stageReplacements === 2) throw new Error('injected second canonical write failure')
            }
            return target.renameSync(source, destination)
          }
        }
        const value = target[property]
        return typeof value === 'function' ? value.bind(target) : value
      }
    })
    expectCode('HOST_SKILL_ROUTE_PROMOTION_FAILED', () =>
      promoteCodexSkillRouteCapability(rawEvidence(), {
        packageRoot: rollbackRoot,
        runtimePackageRoot: ROOT,
        transactionId: 'fixture-rollback',
        fs: failingFs
      }))
    assert(fs.readFileSync(capabilityPath).equals(beforeCapability))
    assert(fs.readFileSync(evidencePath).equals(beforeEvidence))
    const residue = []
    for (const dir of [path.dirname(capabilityPath), path.dirname(evidencePath)]) {
      residue.push(...fs.readdirSync(dir).filter(name => name.includes('.devcodex-')))
    }
    assert.deepStrictEqual(residue, [])
    checks++

    process.stdout.write(`host skill-route capability tests passed (${checks} checks)\n`)
    return { checks }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

if (require.main === module) run()

module.exports = { rawEvidence, run }
