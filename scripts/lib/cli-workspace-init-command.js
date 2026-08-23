'use strict'

const { createCliFailure, createCliSuccess, printCliJson } = require('./cli-json-contract.js')
const { parseWorkspaceInitArgs } = require('./cli-workspace-init-args.js')

function buildWorkspaceInitCommand(ctx) {
  const {
    process, console, c, path, cliMetadata, initArgumentFailure, readTenantSelection,
    findLayoutInfo, resolveWorkspaceProjectTarget, ensureWorkspaceNamespaceLayout,
    ensureRuntimeDirs, initializeProfile, globalRefreshGuidance
  } = ctx

  return function cmdInitWorkspaceRuntime(argv = [], { refresh = false } = {}) {
    const values = Array.isArray(argv) ? argv : []
    const json = values.includes('--json')
    const dryRun = values.includes('--dry-run')
    const parsed = parseWorkspaceInitArgs(values)
    if (parsed.errors.length) {
      return initArgumentFailure(refresh ? 'update' : 'init', json, 'CLI_INVALID_OPTION', parsed.errors.join('; '), { cwd: process.cwd() })
    }
    if (refresh && parsed.profileTarget) {
      return initArgumentFailure(
        'update',
        json,
        'CLI_INVALID_OPTION',
        '`--profile` is supported by `devcodex init` only; update never creates or upgrades Profile files.',
        { cwd: process.cwd(), profileTarget: parsed.profileTarget }
      )
    }
    const tenantArgs = parsed.tenantArgs.filter(arg =>
      arg !== '--json' && arg !== '--dry-run' && arg !== '--force' && arg !== '-f'
    )
    const tenantId = readTenantSelection(tenantArgs)
    if (tenantId === undefined) return null
    const cwd = process.cwd()
    let profileTarget = null
    if (parsed.profileTarget) {
      try {
        const existingLayout = typeof findLayoutInfo === 'function' ? findLayoutInfo(cwd) : null
        const workspaceRoot = existingLayout?.enabled ? existingLayout.workspaceRoot : cwd
        profileTarget = resolveWorkspaceProjectTarget(workspaceRoot, parsed.profileTarget)
      } catch (error) {
        return initArgumentFailure(
          refresh ? 'update' : 'init',
          json,
          error.code || 'PROFILE_TARGET_INVALID',
          error.message,
          { cwd, profileTarget: parsed.profileTarget, candidates: error.candidates || [] }
        )
      }
    }
    let layout
    try {
      layout = ensureWorkspaceNamespaceLayout(cwd, dryRun)
    } catch (error) {
      const migrationRequired = error.code === 'WORKSPACE_LAYOUT_MIGRATION_REQUIRED'
      const envelope = createCliFailure(
        refresh ? 'update' : 'init',
        error.code || 'WORKSPACE_LAYOUT_INITIALIZATION_FAILED',
        error.message,
        migrationRequired
          ? 'Run `devcodex migrate-layout plan`, review the manifest, then apply the explicit migration before retrying.'
          : 'Repair or remove the invalid .devcodex/layout.json marker, then retry.',
        cliMetadata,
        { cwd, mode: 'workspace-namespace', legacyRuntimeEntries: error.legacyRuntimeEntries || [], workspaceHostDirectoriesWritten: false }
      )
      if (json) printCliJson(console, envelope)
      else {
        console.log(c.red(`  ${envelope.errorCode}: ${envelope.message}`))
        console.log(c.dim(`  ${envelope.nextStep}`))
      }
      process.exitCode = 2
      return envelope
    }
    const runtimeRoot = layout.runtimeRoot
    const workspaceRuntimeRoot = path.join(layout.workspaceRoot, '.devcodex', 'workspace')
    let workspaceProvisioning
    try {
      workspaceProvisioning = ensureRuntimeDirs(cwd, dryRun, { workspaceRuntimeRoot })
    } catch (error) {
      const envelope = createCliFailure(
        refresh ? 'update' : 'init',
        error.code || 'WORKSPACE_RUNTIME_PROVISIONING_FAILED',
        error.message,
        'Repair the reported workspace path or decision contract, then retry the same command.',
        cliMetadata,
        {
          cwd,
          runtimeRoot,
          workspaceProvisioning: error.receipt || null,
          runtimeFailure: error.runtimeFailure || null,
          workspaceHostDirectoriesWritten: false
        }
      )
      if (json) printCliJson(console, envelope)
      else {
        console.log(c.red(`  ${envelope.errorCode}: ${envelope.message}`))
        console.log(c.dim(`  ${envelope.nextStep}`))
      }
      process.exitCode = 2
      return envelope
    }
    const profileArgv = dryRun ? ['--dry-run'] : []
    const workspaceProfile = !refresh && typeof initializeProfile === 'function'
      ? initializeProfile(profileArgv, { cwdOverride: layout.workspaceRoot, source: 'workspace-init', silent: json })
      : { ok: true, targetTier: null, actions: [], status: 'unchanged-by-update' }
    if (!workspaceProfile.ok) {
      return initArgumentFailure(
        refresh ? 'update' : 'init', json, 'WORKSPACE_PROFILE_INITIALIZATION_FAILED',
        'The workspace Profile baseline could not be initialized.', { cwd, runtimeRoot }
      )
    }
    let projectProfile = null
    if (profileTarget) {
      projectProfile = initializeProfile(profileArgv, {
        cwdOverride: profileTarget.projectRoot,
        profileDirOverride: `${profileTarget.runtimeRoot}/profile`,
        source: 'workspace-init-profile-target',
        silent: json,
        useRecommendedTier: true
      })
      if (!projectProfile?.ok) {
        return initArgumentFailure(
          refresh ? 'update' : 'init', json, 'PROJECT_PROFILE_INITIALIZATION_FAILED',
          `The Profile for ${profileTarget.namespace} could not be initialized.`,
          { cwd, runtimeRoot, profileTarget: profileTarget.namespace }
        )
      }
    }
    const guidance = globalRefreshGuidance()
    const payload = {
      schemaVersion: 'WorkspaceRuntimeRefreshV1',
      operation: refresh ? 'update' : 'init',
      mode: 'GlobalOnlyHostConfigModeV1',
      workspaceCleanMode: 'GlobalOnlyWorkspaceCleanModeV1',
      cwd,
      runtimeRoot,
      workspaceRoot: layout.workspaceRoot,
      layoutMarker: layout.markerPath,
      layoutCreated: layout.created,
      layoutPlanned: layout.planned,
      workspaceProvisioning,
      workspaceProfile: {
        status: workspaceProfile.status || (refresh ? 'unchanged-by-update' : 'initialized'),
        tier: workspaceProfile.targetTier,
        actions: workspaceProfile.actions || []
      },
      projectProfile: projectProfile
        ? {
            namespace: profileTarget.namespace,
            tier: projectProfile.targetTier,
            recommendedTier: projectProfile.recommendedTier,
            actions: projectProfile.actions || []
          }
        : null,
      tenantId: tenantId || null,
      dryRun,
      gitignoreEntriesAdded: 0,
      gitignoreModified: false,
      workspaceHostDirectoriesWritten: false,
      hostConfigNextStep: refresh ? guidance.updateCommand : guidance.installCommand
    }
    if (json) printCliJson(console, createCliSuccess(payload.operation, payload, cliMetadata))
    else {
      console.log()
      console.log(c.bold('  DevCodex') + c.dim(` — workspace ${refresh ? 'refresh' : 'initialization'}`))
      console.log(c.dim('  ──────────────────────────────────────'))
      console.log(`  ${c.cyan('Runtime:')} ${c.dim(runtimeRoot)}`)
      console.log(`  ${c.cyan('Evolution:')} ${c.dim(workspaceProvisioning.status)}`)
      console.log(`  ${c.cyan('Host config:')} ${c.dim('user-global only')}`)
      if (dryRun) console.log(c.yellow('  [DRY RUN] No files were written.'))
      else console.log(c.green('  ✓ Workspace .devcodex runtime is ready.'))
      console.log(c.dim(`  Host adapters: ${payload.hostConfigNextStep}`))
      console.log()
    }
    return payload
  }
}

module.exports = { buildWorkspaceInitCommand }
