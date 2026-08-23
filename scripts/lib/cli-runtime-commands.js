'use strict'

const fs = require('fs')
const path = require('path')
const { createCliFailure, createCliSuccess, printCliJson } = require('./cli-json-contract.js')
const {
  findLayoutInfo,
  inferProjectFromCwd,
  resolveActiveRuntimeRoot,
  resolveRuntimeStateRoots
} = require('../../hooks/_runtime/workspace-layout.cjs')
const { resolveTaskRecoveryConfigForCwd } = require('../../hooks/_runtime/task-recovery-config-v1.cjs')
const {
  diagnoseTaskRecoveryStore,
  inspectTaskRecoveryStore,
  maintainTaskRecoveryStore
} = require('../../hooks/_runtime/task-recovery-store-v5.cjs')
const {
  applyRuntimeGenerationGcPlan,
  buildRuntimeGenerationGcPlan,
  inspectRuntimeGenerationRetention
} = require('./runtime-generation-retention.js')
const {
  MAX_VISIBLE_COLLECTION_ITEMS,
  boundedCollection,
  projectLegacyInventory,
  projectRuntimeGeneration,
  projectRuntimeGenerationRetentionStatus,
  projectRuntimeStateStatus,
  projectTaskRecoveryDoctor,
  projectTaskRecoveryMaintenance
} = require('./cli-runtime-projection.js')

const STATUS_SCHEMA = 'RuntimeStateStatusV1'
const PRUNE_SCHEMA = 'RuntimeStatePruneV1'
const DOCTOR_SCHEMA = 'RuntimeStateDoctorV1'
const MAINTENANCE_SCHEMA = 'RuntimeStateMaintenanceV1'
const MAX_ENTRIES = 10000
const TEMP_TTL_MS = 24 * 60 * 60 * 1000
const LEGACY_ACTIVITY_WINDOW_MS = 10 * 60 * 1000
const DIGEST_RE = /^[a-f0-9]{64}$/
const MAX_VISIBLE_GENERATIONS_PER_ROOT = 24

const OWNER_BY_CATEGORY = Object.freeze({
  'context-plan-cache': 'profile-context-plan',
  'context-plan-observations': 'context-read',
  'derived-indexes': 'derived-index-store',
  'execution-optimization': 'execution-optimization',
  'memory-locks': 'memory-server',
  'project-knowledge': 'project-knowledge',
  'skill-route': 'skill-route',
  'validation-evidence': 'validation-dag',
  'workflow-completion': 'workflow-completion'
})

function walkBounded(root, { excludedTopLevel = [] } = {}) {
  if (!fs.existsSync(root)) return { entries: [], truncated: false }
  const excluded = new Set(excludedTopLevel)
  const pending = [{ dir: root, depth: 0 }]
  const entries = []
  while (pending.length && entries.length < MAX_ENTRIES) {
    const { dir: current, depth } = pending.pop()
    let children
    try { children = fs.readdirSync(current, { withFileTypes: true }) } catch { continue }
    for (const child of children) {
      const absolute = path.join(current, child.name)
      if (child.isDirectory() && !(depth === 0 && excluded.has(child.name))) pending.push({ dir: absolute, depth: depth + 1 })
      else if (child.isFile()) {
        let stats
        try { stats = fs.statSync(absolute) } catch { continue }
        entries.push({ path: absolute, bytes: stats.size, modifiedMs: stats.mtimeMs })
        if (entries.length >= MAX_ENTRIES) break
      }
    }
  }
  return { entries, truncated: pending.length > 0 }
}

function runtimeCategory (root, file) {
  const relative = path.relative(root, file)
  return relative.includes(path.sep) ? relative.split(path.sep)[0] : '(root)'
}

function summarizeRoot(root, role, nowMs) {
  const observed = walkBounded(root, { excludedTopLevel: role === 'legacy-read-only' ? ['workspace', 'projects'] : [] })
  const categories = new Map()
  const candidates = []
  const blocked = []
  for (const entry of observed.entries) {
    const category = runtimeCategory(root, entry.path)
    const current = categories.get(category) || {
      category,
      owner: OWNER_BY_CATEGORY[category] || 'runtime-kernel',
      files: 0,
      bytes: 0,
      lastUsedAt: null
    }
    current.files += 1
    current.bytes += entry.bytes
    if (!current.lastUsedAt || entry.modifiedMs > Date.parse(current.lastUsedAt)) {
      current.lastUsedAt = new Date(entry.modifiedMs).toISOString()
    }
    categories.set(category, current)

    const name = path.basename(entry.path)
    const ageMs = Math.max(0, nowMs - entry.modifiedMs)
    if (category === 'memory-locks' && name === 'owner.json') {
      let owner = null
      if (entry.bytes <= 64 * 1024) {
        try {
          const rawOwner = JSON.parse(fs.readFileSync(entry.path, 'utf8'))
          if (rawOwner && typeof rawOwner === 'object' && !Array.isArray(rawOwner)) {
            owner = {
              schemaVersion: rawOwner.schemaVersion || null,
              pid: Number.isInteger(rawOwner.pid) ? rawOwner.pid : null,
              host: typeof rawOwner.host === 'string' ? rawOwner.host : null,
              file: typeof rawOwner.file === 'string' ? rawOwner.file : null,
              acquiredAt: typeof rawOwner.acquiredAt === 'string' ? rawOwner.acquiredAt : null
            }
          }
        } catch {
          owner = null
        }
      }
      blocked.push({
        path: path.dirname(entry.path),
        ownerFile: entry.path,
        reason: 'memory-writer-lock-never-auto-pruned',
        ageMs,
        owner
      })
    } else if (name.endsWith('.lock')) {
      blocked.push({ path: entry.path, reason: 'lock-file-never-auto-pruned', ageMs })
    } else if (/\.tmp-[A-Za-z0-9._-]+$/.test(name) && ageMs >= TEMP_TTL_MS) {
      candidates.push({ path: entry.path, reason: 'expired-atomic-write-temp', ageMs, bytes: entry.bytes })
    }
  }
  return {
    root,
    role,
    exists: fs.existsSync(root),
    files: observed.entries.length,
    bytes: observed.entries.reduce((total, entry) => total + entry.bytes, 0),
    truncated: observed.truncated,
    categories: [...categories.values()].sort((a, b) => a.category.localeCompare(b.category)),
    candidates,
    blocked
  }
}

function resolveTaskRecoveryContext(cwd, activeRoot) {
  const layout = findLayoutInfo(cwd)
  const project = layout.enabled ? inferProjectFromCwd(cwd, layout) : null
  const partition = layout.enabled ? (project || 'workspace') : 'legacy'
  const config = resolveTaskRecoveryConfigForCwd(cwd, project || (layout.enabled ? 'workspace' : ''))
  return {
    activeRoot,
    project: project || (layout.enabled ? null : path.basename(path.resolve(cwd))),
    partition,
    config,
    metaDir: path.join(activeRoot, '.memory', 'hooks', ...partition.split(/[\\/]+/).filter(Boolean))
  }
}

function inspectLegacyHookState(metaDir, nowMs = Date.now()) {
  const observed = walkBounded(metaDir, { excludedTopLevel: ['v5'] })
  const categories = new Map()
  let latestModifiedMs = 0
  let latestLegacyWriterModifiedMs = 0
  let generationFiles = 0
  let generationBytes = 0
  let tempFiles = 0
  let tempBytes = 0
  for (const entry of observed.entries) {
    const relative = path.relative(metaDir, entry.path)
    const category = runtimeCategory(metaDir, entry.path)
    const current = categories.get(category) || { category, files: 0, bytes: 0 }
    current.files += 1
    current.bytes += entry.bytes
    categories.set(category, current)
    latestModifiedMs = Math.max(latestModifiedMs, entry.modifiedMs)
    if (category === 'generations') {
      generationFiles += 1
      generationBytes += entry.bytes
      latestLegacyWriterModifiedMs = Math.max(latestLegacyWriterModifiedMs, entry.modifiedMs)
    }
    if (relative === 'current.json') latestLegacyWriterModifiedMs = Math.max(latestLegacyWriterModifiedMs, entry.modifiedMs)
    if (/\.tmp(?:-|\.|$)/i.test(path.basename(entry.path))) {
      tempFiles += 1
      tempBytes += entry.bytes
    }
  }
  const latestModifiedAt = latestModifiedMs ? new Date(latestModifiedMs).toISOString() : null
  const observedRecentWrite = latestLegacyWriterModifiedMs > 0 &&
    nowMs - latestLegacyWriterModifiedMs <= LEGACY_ACTIVITY_WINDOW_MS
  return {
    schemaVersion: 'LegacyLifecycleStateInventoryV1',
    root: metaDir,
    exists: fs.existsSync(metaDir),
    policy: 'read-only-report',
    deletionSupported: false,
    files: observed.entries.length,
    bytes: observed.entries.reduce((sum, entry) => sum + entry.bytes, 0),
    truncated: observed.truncated,
    categories: [...categories.values()].sort((left, right) => left.category.localeCompare(right.category)),
    generations: { files: generationFiles, bytes: generationBytes },
    temporaryArtifacts: { files: tempFiles, bytes: tempBytes },
    latestModifiedAt,
    latestLegacyWriterModifiedAt: latestLegacyWriterModifiedMs
      ? new Date(latestLegacyWriterModifiedMs).toISOString()
      : null,
    writerActivity: {
      status: observedRecentWrite ? 'WARN' : 'UNVERIFIED',
      observedRecentWrite,
      observationWindowMs: LEGACY_ACTIVITY_WINDOW_MS,
      reasonCode: observedRecentWrite
        ? 'LEGACY_WRITER_RECENT_ACTIVITY_OBSERVED'
        : 'LEGACY_WRITER_NOT_OBSERVED_RECENTLY'
    },
    nextStep: observedRecentWrite
      ? {
          code: 'LEGACY_WRITER_RESTART_REQUIRED',
          action: 'restart-active-hosts',
          command: 'devcodex runtime doctor --json',
          message: 'Restart every active AI Coding host after installing this version, then rerun doctor.'
        }
      : {
          code: 'LEGACY_FILES_RETAINED',
          action: 'none',
          command: null,
          message: 'Legacy files remain untouched; deletion requires a separate manifest and explicit confirmation.'
        }
  }
}

function inspectTaskRecoveryRuntime(cwd, activeRoot, nowMs = Date.now()) {
  const target = resolveTaskRecoveryContext(cwd, activeRoot)
  const recoveryOptions = {
    nowMs,
    softBytes: target.config.softBytes,
    hardBytes: target.config.hardBytes
  }
  const v5 = inspectTaskRecoveryStore(target.metaDir, recoveryOptions)
  const legacy = inspectLegacyHookState(target.metaDir, nowMs)
  return {
    schemaVersion: 'TaskRecoveryRuntimeStatusV1',
    ...target,
    v5,
    legacy,
    disk: {
      v5ManagedBytes: v5.managedBytes,
      closeoutReserveBytes: v5.reserveBytes,
      legacyBytes: legacy.bytes,
      observedBytes: v5.diskBytes + legacy.bytes,
      legacyTotalsAreLowerBound: legacy.truncated,
      physicalStatus: v5.disk.status,
      availableBytes: v5.disk.availableBytes,
      requiredFreeBytes: v5.disk.requiredFreeBytes,
      safetyHeadroomBytes: v5.disk.headroomBytes,
      missingReserveBytes: v5.disk.missingReserveBytes
    },
    nextSteps: [
      v5.nextStep,
      ...(v5.disk.status === 'PASS'
        ? []
        : [{
            code: v5.disk.status === 'BLOCK'
              ? 'TASK_RECOVERY_DISK_HEADROOM_REQUIRED'
              : 'TASK_RECOVERY_DISK_CAPACITY_UNVERIFIED',
            action: v5.disk.status === 'BLOCK' ? 'free-disk-space' : 'verify-filesystem-capacity',
            command: 'devcodex runtime doctor --json'
          }]),
      legacy.nextStep,
      ...(target.config.status === 'fail-closed'
        ? [{
            code: target.config.errorCode,
            action: 'repair-profile-config',
            command: 'devcodex profile validate',
            message: target.config.details
          }]
        : [])
    ].filter(item => item?.action !== 'none')
  }
}

function projectRuntimeGenerationGcPlan (plan) {
  if (plan.schemaVersion === 'RuntimeGenerationGcApplyReceiptV1') {
    const removed = Array.isArray(plan.removed) ? plan.removed : []
    const failed = Array.isArray(plan.failed) ? plan.failed : []
    return {
      schemaVersion: plan.schemaVersion,
      status: plan.status,
      errorCode: plan.errorCode || null,
      planDigest: plan.planDigest || null,
      expectedPlanDigest: plan.expectedPlanDigest || null,
      actualPlanDigest: plan.actualPlanDigest || null,
      removedCount: removed.length,
      removed: removed.slice(0, MAX_VISIBLE_GENERATIONS_PER_ROOT),
      removedTruncated: removed.length > MAX_VISIBLE_GENERATIONS_PER_ROOT,
      failedCount: failed.length,
      failed: failed.slice(0, MAX_VISIBLE_GENERATIONS_PER_ROOT),
      failedTruncated: failed.length > MAX_VISIBLE_GENERATIONS_PER_ROOT,
      reclaimedBytes: Number(plan.reclaimedBytes || 0),
      remainingPreview: plan.remainingPreview || null,
      visibleGenerationLimit: MAX_VISIBLE_GENERATIONS_PER_ROOT
    }
  }
  if (plan.schemaVersion !== 'RuntimeGenerationGcPlanV1') return plan
  const candidates = Array.isArray(plan.candidates) ? plan.candidates : []
  return {
    schemaVersion: plan.schemaVersion,
    mode: plan.mode,
    generatedAt: plan.generatedAt,
    planDigest: plan.planDigest,
    applyReady: plan.applyReady,
    candidateCount: candidates.length,
    candidates: candidates.slice(0, MAX_VISIBLE_GENERATIONS_PER_ROOT),
    candidatesTruncated: candidates.length > MAX_VISIBLE_GENERATIONS_PER_ROOT,
    retainedCount: plan.retained.length,
    retained: plan.retained.slice(0, MAX_VISIBLE_GENERATIONS_PER_ROOT)
      .map(generation => projectRuntimeGeneration(generation, { includeDigests: true })),
    retainedTruncated: plan.retained.length > MAX_VISIBLE_GENERATIONS_PER_ROOT,
    totals: plan.totals,
    status: projectRuntimeGenerationRetentionStatus(plan.status),
    visibleGenerationLimit: MAX_VISIBLE_GENERATIONS_PER_ROOT
  }
}

function inspectRuntimeState(cwd, nowMs = Date.now(), options = {}) {
  const activeRoot = resolveActiveRuntimeRoot(cwd)
  const roots = resolveRuntimeStateRoots(activeRoot)
  const partitions = [
    summarizeRoot(roots.primaryRoot, 'canonical-write', nowMs),
    ...roots.legacyReadRoots.map(root => summarizeRoot(root, 'legacy-read-only', nowMs))
  ]
  const taskRecovery = inspectTaskRecoveryRuntime(cwd, activeRoot, nowMs)
  const runtimeGenerationInventory = inspectRuntimeGenerationRetention({
    packageRoot: options.packageRoot || path.resolve(__dirname, '..', '..'),
    home: options.home,
    env: options.env || process.env,
    fs: options.fs || fs,
    nowMs,
    targets: options.targets,
    pidProbe: options.pidProbe
  })
  return {
    schemaVersion: STATUS_SCHEMA,
    cwd: path.resolve(cwd),
    activeRoot,
    canonicalRoot: roots.primaryRoot,
    project: roots.project,
    partitions,
    taskRecovery,
    runtimeGenerations: runtimeGenerationInventory,
    totals: {
      files: partitions.reduce((total, item) => total + item.files, 0),
      bytes: partitions.reduce((total, item) => total + item.bytes, 0),
      taskRecoveryObservedBytes: taskRecovery.disk.observedBytes,
      runtimeGenerationBytes: runtimeGenerationInventory.totals.bytes,
      runtimeGenerationGcCandidateBytes: runtimeGenerationInventory.totals.candidateBytes,
      pruneCandidates: partitions.filter(item => item.role === 'canonical-write').reduce((total, item) => total + item.candidates.length, 0),
      blockedLocks: partitions.reduce((total, item) => total + item.blocked.length, 0)
    }
  }
}

function buildCliRuntimeCommands({ process, console, c, cliMetadata = {} }) {
  function fail(message, json) {
    const failure = createCliFailure(
      'runtime',
      'CLI_INVALID_OPTION',
      message,
      'Use `devcodex runtime status|doctor [--json]`, `devcodex runtime maintenance [--dry-run|--apply] [--generation-plan <sha256>] [--json]`, or the compatibility alias `runtime prune`.',
      cliMetadata
    )
    if (json) printCliJson(console, failure)
    else console.log(c.red(`  ${failure.errorCode}: ${failure.message}`))
    process.exitCode = 2
    return failure
  }

  function cmdRuntime(argv = []) {
    const operation = argv[0]
    const options = argv.slice(1)
    const json = options.includes('--json')
    let generationPlan = null
    const recognized = new Set(['--json', '--dry-run', '--apply'])
    for (let index = 0; index < options.length; index++) {
      if (options[index] !== '--generation-plan') continue
      generationPlan = options[index + 1] || null
      recognized.add('--generation-plan')
      if (generationPlan) recognized.add(generationPlan)
      index += 1
    }
    const unknown = options.filter(item => !recognized.has(item))
    if (!['status', 'doctor', 'maintenance', 'prune'].includes(operation) || unknown.length) {
      return fail(unknown.length ? `Unknown runtime option: ${unknown[0]}` : `Unknown runtime subcommand: ${operation || '(none)'}`, json)
    }
    if (['status', 'doctor'].includes(operation) && options.some(item => item === '--dry-run' || item === '--apply')) {
      return fail(`runtime ${operation} accepts --json only.`, json)
    }
    if (['maintenance', 'prune'].includes(operation) && options.includes('--dry-run') && options.includes('--apply')) {
      return fail('--dry-run and --apply are mutually exclusive.', json)
    }
    if (generationPlan && (operation !== 'maintenance' || !options.includes('--apply'))) {
      return fail('--generation-plan requires `runtime maintenance --apply`.', json)
    }
    if (options.includes('--generation-plan') && !generationPlan) {
      return fail('--generation-plan requires a digest.', json)
    }
    if (generationPlan && !DIGEST_RE.test(generationPlan)) {
      return fail('--generation-plan requires a lowercase sha256 digest.', json)
    }

    const observedStatus = inspectRuntimeState(process.cwd())
    const status = projectRuntimeStateStatus(observedStatus)
    if (operation === 'status') {
      if (json) printCliJson(console, createCliSuccess('runtime.status', status, cliMetadata))
      else {
        console.log(`\n  ${c.bold('DevCodex runtime state')} in ${status.cwd}`)
        for (const partition of status.partitions) {
          console.log(`  ${c.cyan(partition.role.padEnd(18))} ${partition.files} files, ${partition.bytes} bytes — ${partition.root}`)
          for (const category of partition.categories) {
            console.log(`    ${category.category}: owner=${category.owner}; files=${category.files}; bytes=${category.bytes}; last=${category.lastUsedAt}`)
          }
        }
        const recovery = status.taskRecovery
        console.log(`  ${c.cyan('task-recovery-v5'.padEnd(18))} ${recovery.v5.managedFiles} managed files, ${recovery.v5.managedBytes} bytes; pressure=${recovery.v5.pressure}`)
        console.log(`    hot=${recovery.v5.counts.hot}; cold=${recovery.v5.counts.cold}; terminal=${recovery.v5.counts.terminal}; ephemeral=${recovery.v5.counts.ephemeral}; reserve=${recovery.v5.reserveBytes}`)
        console.log(`    soft=${recovery.config.softLimitMiB} MiB; hard=${recovery.config.hardLimitMiB} MiB; config=${recovery.config.status}`)
        console.log(`    physical-disk=${recovery.disk.physicalStatus}; available=${recovery.disk.availableBytes}; required=${recovery.disk.requiredFreeBytes}; headroom=${recovery.disk.safetyHeadroomBytes}`)
        console.log(`  ${c.cyan('legacy-read-only'.padEnd(18))} ${recovery.legacy.files}${recovery.legacy.truncated ? '+' : ''} files, ${recovery.legacy.bytes}${recovery.legacy.truncated ? '+' : ''} bytes; deletion=disabled`)
        console.log(`  ${c.cyan('runtime-generations'.padEnd(18))} ${status.runtimeGenerations.totals.generations} generations, ${status.runtimeGenerations.totals.bytes} bytes; candidates=${status.runtimeGenerations.counts['orphan-gc-candidate']}`)
        for (const task of recovery.v5.topTasks.slice(0, 5)) {
          console.log(`    top task ${task.taskId}: ${task.bytes} bytes (${task.kind})`)
        }
        for (const next of recovery.nextSteps) {
          console.log(`  ${c.yellow(next.code)}: ${next.message || next.command || next.action}`)
        }
      }
      return status
    }

    if (operation === 'doctor') {
      const target = observedStatus.taskRecovery
      const recoveryOptions = {
        softBytes: target.config.softBytes,
        hardBytes: target.config.hardBytes
      }
      const observedV5 = diagnoseTaskRecoveryStore(target.metaDir, recoveryOptions)
      const legacy = inspectLegacyHookState(target.metaDir)
      const configurationCheck = {
        id: 'task-recovery-profile-config',
        status: target.config.status === 'fail-closed' ? 'BLOCK' : 'PASS',
        observed: target.config
      }
      const doctor = {
        schemaVersion: DOCTOR_SCHEMA,
        status: observedV5.status === 'BLOCK' || configurationCheck.status === 'BLOCK'
          ? 'BLOCK'
          : (observedV5.status === 'WARN' || legacy.writerActivity.status === 'WARN' ? 'WARN' : observedV5.status),
        activeRoot: status.activeRoot,
        project: target.project,
        partition: target.partition,
        configuration: target.config,
        v5: projectTaskRecoveryDoctor(observedV5),
        legacy: projectLegacyInventory(legacy),
        runtimeGenerations: {
          status: status.runtimeGenerations.roots.some(root =>
            root.stateStatus === 'invalid' || !root.inventoryComplete
          )
            ? 'BLOCK'
            : (status.runtimeGenerations.counts['blocked-unknown'] > 0 ||
                status.runtimeGenerations.counts['orphan-gc-candidate'] > 0 ||
                status.runtimeGenerations.roots.some(root => root.stateStatus === 'missing')
                ? 'WARN'
                : 'PASS'),
          observed: status.runtimeGenerations,
          nextStep: status.runtimeGenerations.roots.some(root => root.stateStatus === 'missing')
            ? {
                code: 'RUNTIME_GENERATION_RETENTION_NOT_INITIALIZED',
                action: 'refresh-global-adapters',
                command: 'devcodex global-adapters apply --json'
              }
            : (status.runtimeGenerations.counts['orphan-gc-candidate'] > 0
                ? {
                    code: 'RUNTIME_GENERATION_GC_PREVIEW_AVAILABLE',
                    action: 'preview-generation-gc',
                    command: 'devcodex runtime maintenance --json'
                  }
                : null)
        },
        nextSteps: [
          ...(configurationCheck.status === 'BLOCK'
            ? [{
                code: target.config.errorCode,
                action: 'repair-profile-config',
                command: 'devcodex profile validate',
                message: target.config.details
              }]
            : []),
          ...observedV5.nextSteps,
          ...(legacy.writerActivity.status === 'WARN' ? [legacy.nextStep] : []),
          ...(() => {
            const rootState = status.runtimeGenerations.roots.some(root =>
              root.stateStatus === 'invalid' || !root.inventoryComplete
            ) ? 'BLOCK' : null
            if (rootState) {
              return [{
                code: 'RUNTIME_GENERATION_RETENTION_EVIDENCE_INCOMPLETE',
                action: 'inspect-runtime-generation-evidence',
                command: 'devcodex runtime status --json'
              }]
            }
            if (status.runtimeGenerations.roots.some(root => root.stateStatus === 'missing')) {
              return [{
                code: 'RUNTIME_GENERATION_RETENTION_NOT_INITIALIZED',
                action: 'refresh-global-adapters',
                command: 'devcodex global-adapters apply --json'
              }]
            }
            if (status.runtimeGenerations.counts['orphan-gc-candidate'] > 0) {
              return [{
                code: 'RUNTIME_GENERATION_GC_PREVIEW_AVAILABLE',
                action: 'preview-generation-gc',
                command: 'devcodex runtime maintenance --json'
              }]
            }
            return []
          })()
        ]
      }
      if (doctor.runtimeGenerations.status === 'BLOCK') doctor.status = 'BLOCK'
      else if (doctor.runtimeGenerations.status === 'WARN' && doctor.status === 'PASS') doctor.status = 'WARN'
      if (json) printCliJson(console, createCliSuccess('runtime.doctor', doctor, cliMetadata))
      else {
        console.log(`\n  ${c.bold('DevCodex TaskRecovery doctor')} — ${doctor.status}`)
        for (const check of [configurationCheck, ...doctor.v5.checks]) {
          const paint = check.status === 'PASS' ? c.green : (check.status === 'BLOCK' ? c.red : c.yellow)
          console.log(`  ${paint(check.status.padEnd(5))} ${check.id}`)
        }
        console.log(`  legacy writer activity: ${legacy.writerActivity.status} (${legacy.writerActivity.reasonCode})`)
        console.log(`  runtime generation retention: ${doctor.runtimeGenerations.status}`)
        for (const next of doctor.nextSteps) console.log(`  ${c.yellow(next.code)}: ${next.message || next.command || next.action}`)
      }
      if (doctor.status === 'BLOCK') process.exitCode = 2
      return doctor
    }

    if (operation === 'maintenance') {
      const apply = options.includes('--apply')
      const recovery = maintainTaskRecoveryStore(observedStatus.taskRecovery.metaDir, {
        apply,
        softBytes: observedStatus.taskRecovery.config.softBytes,
        hardBytes: observedStatus.taskRecovery.config.hardBytes
      })
      const canonicalCandidates = observedStatus.partitions.find(item => item.role === 'canonical-write')?.candidates || []
      const removedRuntimeTemps = []
      const failedRuntimeTemps = []
      const generationGcPreview = buildRuntimeGenerationGcPlan({
        packageRoot: path.resolve(__dirname, '..', '..'),
        env: process.env,
        fs
      })
      const generationGc = apply && generationPlan
        ? applyRuntimeGenerationGcPlan({
            packageRoot: path.resolve(__dirname, '..', '..'),
            env: process.env,
            fs,
            planDigest: generationPlan
          })
        : generationGcPreview
      if (apply) {
        const canonical = path.resolve(observedStatus.canonicalRoot)
        for (const candidate of canonicalCandidates) {
          const target = path.resolve(candidate.path)
          const relative = path.relative(canonical, target)
          if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
            failedRuntimeTemps.push({ path: target, errorCode: 'RUNTIME_MAINTENANCE_PATH_ESCAPE' })
            continue
          }
          try { fs.unlinkSync(target); removedRuntimeTemps.push(target) } catch (error) {
            failedRuntimeTemps.push({ path: target, errorCode: error.code || 'RUNTIME_MAINTENANCE_FAILED', message: error.message })
          }
        }
      }
      const candidateProjection = boundedCollection(canonicalCandidates)
      const removedProjection = boundedCollection(removedRuntimeTemps)
      const failedProjection = boundedCollection(failedRuntimeTemps)
      const payload = {
        schemaVersion: MAINTENANCE_SCHEMA,
        mode: apply ? 'apply' : 'dry-run',
        v5: projectTaskRecoveryMaintenance(recovery),
        runtimeTemps: {
          candidateCount: candidateProjection.count,
          candidates: candidateProjection.items,
          candidatesTruncated: candidateProjection.truncated,
          removedCount: removedProjection.count,
          removed: removedProjection.items,
          removedTruncated: removedProjection.truncated,
          failedCount: failedProjection.count,
          failed: failedProjection.items,
          failedTruncated: failedProjection.truncated,
          visibleLimit: MAX_VISIBLE_COLLECTION_ITEMS
        },
        runtimeGenerations: projectRuntimeGenerationGcPlan(generationGc),
        legacy: {
          policy: 'read-only-report',
          deletionSupported: false,
          deletedFiles: 0,
          inventory: projectLegacyInventory(observedStatus.taskRecovery.legacy)
        },
        reclaimedBytes: Number(recovery.reclaimedBytes || 0) + Number(generationGc.reclaimedBytes || 0) + removedRuntimeTemps.reduce((sum, file) => {
          const candidate = canonicalCandidates.find(item => path.resolve(item.path) === path.resolve(file))
          return sum + Number(candidate?.bytes || 0)
        }, 0),
        nextStep: failedRuntimeTemps.length || !['complete'].includes(recovery.status) ||
          (apply && generationPlan && generationGc.status !== 'complete')
          ? {
              code: 'RUNTIME_MAINTENANCE_INCOMPLETE',
              action: 'inspect-failures',
              command: 'devcodex runtime doctor --json'
            }
          : (generationGcPreview.applyReady && !generationPlan
              ? {
                  code: 'RUNTIME_GENERATION_GC_PREVIEW_READY',
                  action: 'review-generation-plan-before-apply',
                  command: `devcodex runtime maintenance --apply --generation-plan ${generationGcPreview.planDigest} --json`
                }
              : {
                  code: apply ? 'RUNTIME_MAINTENANCE_APPLIED' : 'RUNTIME_MAINTENANCE_PREVIEW_READY',
                  action: apply
                    ? (generationPlan ? 'refresh-generation-receipts' : 'verify')
                    : 'review-before-apply',
                  command: apply
                    ? (generationPlan
                        ? 'devcodex global-adapters apply --json'
                        : 'devcodex runtime doctor --json')
                    : 'devcodex runtime maintenance --apply --json'
                })
      }
      if (json) printCliJson(console, createCliSuccess('runtime.maintenance', payload, cliMetadata))
      else {
        console.log(`\n  ${c.bold('DevCodex runtime maintenance')} (${payload.mode})`)
        console.log(`  V5 actions: ${recovery.actions?.length || 0}; runtime temp candidates: ${canonicalCandidates.length}; reclaimed: ${payload.reclaimedBytes} bytes`)
        console.log('  legacy lifecycle files: read-only report; deleted=0')
        console.log(`  immutable runtime generations: candidates=${generationGcPreview.totals.candidates}; bytes=${generationGcPreview.totals.candidateBytes}; applied=${apply && Boolean(generationPlan)}`)
        console.log(`  next: ${payload.nextStep.command}`)
      }
      if (failedRuntimeTemps.length || !['complete'].includes(recovery.status) ||
          (apply && generationPlan && generationGc.status !== 'complete')) process.exitCode = 2
      return payload
    }

    const apply = options.includes('--apply')
    const candidates = observedStatus.partitions.find(item => item.role === 'canonical-write')?.candidates || []
    const removed = []
    const failed = []
    if (apply) {
      const canonical = path.resolve(observedStatus.canonicalRoot)
      for (const candidate of candidates) {
        const target = path.resolve(candidate.path)
        const relative = path.relative(canonical, target)
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
          failed.push({ path: target, errorCode: 'RUNTIME_PRUNE_PATH_ESCAPE' })
          continue
        }
        try { fs.unlinkSync(target); removed.push(target) } catch (error) {
          failed.push({ path: target, errorCode: error.code || 'RUNTIME_PRUNE_FAILED', message: error.message })
        }
      }
    }
    const candidateProjection = boundedCollection(candidates)
    const removedProjection = boundedCollection(removed)
    const failedProjection = boundedCollection(failed)
    const blocked = observedStatus.partitions.flatMap(item => item.blocked)
    const blockedProjection = boundedCollection(blocked)
    const payload = {
      schemaVersion: PRUNE_SCHEMA,
      mode: apply ? 'apply' : 'dry-run',
      canonicalRoot: observedStatus.canonicalRoot,
      candidateCount: candidateProjection.count,
      candidates: candidateProjection.items,
      candidatesTruncated: candidateProjection.truncated,
      removedCount: removedProjection.count,
      removed: removedProjection.items,
      removedTruncated: removedProjection.truncated,
      failedCount: failedProjection.count,
      failed: failedProjection.items,
      failedTruncated: failedProjection.truncated,
      blockedCount: blockedProjection.count,
      blocked: blockedProjection.items,
      blockedTruncated: blockedProjection.truncated,
      visibleLimit: MAX_VISIBLE_COLLECTION_ITEMS
    }
    if (json) printCliJson(console, createCliSuccess('runtime.prune', payload, cliMetadata))
    else {
      console.log(`\n  ${c.bold('DevCodex runtime prune')} (${payload.mode})`)
      console.log(`  candidates: ${candidates.length}; removed: ${removed.length}; blocked locks: ${blocked.length}; failed: ${failed.length}`)
      for (const candidate of payload.candidates) console.log(`  ${apply ? c.green('removed') : c.yellow('would remove')} ${candidate.path}`)
      if (payload.candidatesTruncated) {
        console.log(`  ... ${payload.candidateCount - payload.candidates.length} more candidate(s) omitted; use --json for totals`)
      }
    }
    if (failed.length) process.exitCode = 2
    return payload
  }

  return { cmdRuntime }
}

module.exports = {
  LEGACY_ACTIVITY_WINDOW_MS,
  MAX_VISIBLE_GENERATIONS_PER_ROOT,
  TEMP_TTL_MS,
  buildCliRuntimeCommands,
  inspectLegacyHookState,
  inspectRuntimeState,
  inspectTaskRecoveryRuntime,
  projectRuntimeGenerationGcPlan,
  projectRuntimeGenerationRetentionStatus,
  resolveTaskRecoveryContext
}
