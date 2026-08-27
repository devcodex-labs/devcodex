'use strict'
const PACKAGE_JSON = require('../../package.json')
const { createCliFailure, createCliSuccess, parseJsonArgs, printCliJson } = require('./cli-json-contract.js')
const { inspectExecutionOptimization } = require('./execution-optimization.js')
const { buildGovernanceStatusSummary } = require('./governance-status-summary.js')
const { evaluateGrokHostParity } = require('./host-parity-scorecard.js')
const { readCompletionForCli } = require('./cli-execution-commands.js')
const { inspectGlobalHostConfig } = require('./global-host-config.js')
const cliWorktrees = require('./cli-worktree-diagnostics.js')
const { createReadinessCollector } = require('./devcodex-readiness.js')
const { buildGlobalHostComparison, buildScopedHostParity, isSourceCandidateMismatch } = require('./cli-host-diagnostic-scope.js')
const {
  formatGlobalHostRuntimeState,
  formatNodeRuntimeReadiness
} = require('./cli-runtime-diagnostics.js')

function buildCliMaintenanceCommands(ctx) {
  const {
    fs, os, path, process, console, c, SOURCES, CODEX_HOOK_COMMAND,
    walkDir, isSourceRepo, findLayoutInfo, resolveActiveRuntimeRoot, resolveProfileDir, getLegacyCounts,
    getCodexConfigState, inspectProfileState,
    detectProfileTier, inspectProfileContract, normalizeProfileTier,
    filesForProfileTier, readJsonSafe, safeFirstLine, detectArch, listTopDirs,
    detectStyle, genProfileReadme, genProjectInfo, genArchitecture, genStyle,
    genTestSpec, genReleaseSpec, genFeatureInventory, genUserContractSpec,
    genConfigJson, detectAgent, detectHostPlatform, detectInstalledHostAssets, inspectHostInstructionSurfaces,
    recommendProfileTier, compareProfileTiers, updateProfileTierDeclaration
  } = ctx

  const cliMetadata = { packageName: PACKAGE_JSON.name, packageVersion: PACKAGE_JSON.version }
  const workspaceCleanMode = 'GlobalOnlyWorkspaceCleanModeV1'
  const {
    describeGlobalAdapterRefresh,
    describeGlobalAdapterRefreshForPackageRoot
  } = require('./global-adapter-refresh-guidance.js')
  const PKG_ROOT = path.join(__dirname, '..', '..')
  function refreshGuidanceForCwd(cwd) {
    const source = typeof isSourceRepo === 'function' ? isSourceRepo(cwd) : false
    if (source) {
      return describeGlobalAdapterRefresh({
        sourceCheckout: true,
        packageVersion: PACKAGE_JSON.version
      })
    }
    return describeGlobalAdapterRefreshForPackageRoot(PKG_ROOT, {
      packageVersion: PACKAGE_JSON.version
    })
  }
  const defaultGuidance = describeGlobalAdapterRefreshForPackageRoot(PKG_ROOT, {
    packageVersion: PACKAGE_JSON.version
  })
  const hostConfigPolicy = Object.freeze({
    mode: 'GlobalOnlyHostConfigModeV1',
    workspaceCleanMode,
    workspaceHostConfigWritesAllowed: false,
    legacyWorkspaceArtifacts: 'diagnostic-read-only',
    workspaceManagedArtifactsAllowed: ['.devcodex/**'],
    installCommand: defaultGuidance.installCommand,
    updateCommand: defaultGuidance.updateCommand
  })
  const collectSharedReadiness = createReadinessCollector({
    packageVersion: PACKAGE_JSON.version,
    env: process.env,
    fs,
    adapterRefreshCommandForCwd: cwd => refreshGuidanceForCwd(cwd).primary
  })
  const globalOnlyLegacyProjectionIssues = new Set([
    'HOST_WRAPPER_POINTER_MISSING',
    'HOST_SHARED_KERNEL_MISSING',
    'HOST_KERNEL_SOURCE_DRIFT',
    'HOST_FULL_FALLBACK_MISSING',
    'HOST_FULL_FALLBACK_DRIFT',
    'HOST_KERNEL_DUPLICATE_CONTENT'
  ])

  function demoteLegacyWorkspaceProjectionIssues(instructionProjection, globalHostConfig) {
    if (!globalHostConfig?.configured || !instructionProjection) return
    const issues = Array.isArray(instructionProjection.issues) ? instructionProjection.issues : []
    const demoted = issues.filter(issue => globalOnlyLegacyProjectionIssues.has(issue.code))
    if (!demoted.length) return
    instructionProjection.issues = issues.filter(issue => !globalOnlyLegacyProjectionIssues.has(issue.code))
    instructionProjection.warnings = [
      ...(Array.isArray(instructionProjection.warnings) ? instructionProjection.warnings : []),
      ...demoted.map(issue => ({
        ...issue,
        legacyWorkspaceResidual: true,
        workspaceCleanMode
      }))
    ]
    if (!instructionProjection.issues.length) {
      instructionProjection.status = instructionProjection.entries?.some(item => item.installed)
        ? 'ready'
        : 'not-installed'
    }
  }

  function applyGlobalOnlyInstructionProjectionPolicy(instructionProjection, globalHostConfig) {
    demoteLegacyWorkspaceProjectionIssues(instructionProjection, globalHostConfig)
    const globalAdapterReady = host => globalHostConfig?.hosts?.some(item =>
      item.host === host && (item.adapterReady === true || item.ready === true)
    )
    if (instructionProjection?.grokPlugin?.sourcePresent === false) {
      instructionProjection.grokPlugin.globalAdapterReady = Boolean(globalAdapterReady('grok'))
      instructionProjection.grokPlugin.workspaceSourceRequired = false
      instructionProjection.issues = (instructionProjection.issues || [])
        .filter(item => item.code !== 'HOST_GROK_WORKSPACE_PLUGIN_MISSING')
      if (!instructionProjection.issues.length) {
        instructionProjection.status = instructionProjection.entries?.some(item => item.installed)
          ? 'ready'
          : 'not-installed'
      }
    }
  }

  function parseDiagnosticCommandArgs(command, argv) {
    const values = Array.isArray(argv) ? argv : []
    const options = { json: false, completion: false, task: '', project: '', errors: [] }
    for (let index = 0; index < values.length; index += 1) {
      const arg = String(values[index])
      if (arg === '--json') options.json = true
      else if (arg === '--completion') options.completion = true
      else if (arg === '--task' || arg === '--project') {
        const field = arg === '--task' ? 'task' : 'project'
        const value = values[index + 1]
        if (!value || String(value).startsWith('--')) options.errors.push(`${arg} requires a value`)
        else if (options[field]) options.errors.push(`${arg} is non-repeatable`)
        else { options[field] = String(value); index += 1 }
      } else options.errors.push(`unsupported option: ${arg}`)
    }
    if (!options.completion && (options.task || options.project)) options.errors.push('--task/--project require --completion')
    if (!options.errors.length) return options
    const usage = `Use: devcodex ${command} [--json] [--completion] [--task <task>] [--project <name>]`
    if (options.json) {
      printCliJson(console, createCliFailure(
        command,
        'CLI_INVALID_OPTION',
        options.errors.join('; '),
        usage,
        cliMetadata,
        { options: (argv || []).filter(item => item !== '--json') }
      ))
    } else {
      console.log(c.red(`  ${options.errors.join('; ')}`))
      console.log(c.dim(`  ${usage}`))
    }
    process.exitCode = 2
    return null
  }

  function loadCompletionDiagnostic(command, options) {
    if (!options.completion) return { ok: true, value: null }
    let value
    try {
      value = readCompletionForCli({ cwd: process.cwd(), task: options.task, project: options.project })
    } catch (error) {
      const code = error.code || 'WORKFLOW_COMPLETION_READ_FAILED'
      if (options.json) printCliJson(console, createCliFailure(command, code, error.message, 'Correct the task selector or completion evidence and retry.', cliMetadata))
      else console.log(c.red(`  [${code}] ${error.message}`))
      process.exitCode = 2
      return { ok: false, value: null }
    }
    if (value.taskResolution?.status !== 'resolved-active') {
      const code = value.taskResolution?.errorCode || 'TASK_RESOLUTION_FAILED'
      const message = value.taskResolution?.message || 'Task resolution failed.'
      const nextStep = value.taskResolution?.nextStep || 'Specify an exact active task.'
      if (options.json) printCliJson(console, createCliFailure(command, code, message, nextStep, cliMetadata, value.taskResolution))
      else {
        console.log(c.red(`  [${code}] ${message}`))
        console.log(c.dim(`  ${nextStep}`))
      }
      process.exitCode = 2
      return { ok: false, value }
    }
    return { ok: true, value }
  }

  function collectStatusFacts() {
    const cwd = process.cwd()
    const instructionProjection = inspectHostInstructionSurfaces(cwd)
    const hostRoot = path.resolve(instructionProjection.inspectionRoot || cwd)
    const ghDir = path.join(hostRoot, '.github')
    const sourceRepository = isSourceRepo(cwd)
    const platformEvidence = detectHostPlatform(process.env, cwd)
    const installSurfaces = SOURCES.map(({ to }) => {
      const fileCount = walkDir(path.join(ghDir, to)).length
      return { id: to, fileCount, installed: fileCount > 0 }
    })
    let trackedEntryFiles = installSurfaces.reduce((total, item) => total + item.fileCount, 0)

    const rulesInstalled = fs.existsSync(path.join(ghDir, 'RULES.md'))
    const copilotInstructionsInstalled = fs.existsSync(path.join(ghDir, 'copilot-instructions.md'))
    const claudeMdInstalled = fs.existsSync(path.join(hostRoot, 'CLAUDE.md'))
    const claudeHookFiles = walkDir(path.join(hostRoot, '.claude', 'hooks', '_runtime')).length
    const claudeSkills = walkDir(path.join(hostRoot, '.claude', 'skills')).length
    const agentsMdInstalled = fs.existsSync(path.join(hostRoot, 'AGENTS.md'))
    const codexHookJsonInstalled = fs.existsSync(path.join(hostRoot, '.codex', 'hooks.json'))
    const codexHookFiles = walkDir(path.join(hostRoot, '.codex', 'hooks', '_runtime')).length
    const codexHookDiagnostics = readCodexHookCommands(hostRoot)
    const agentsSkills = walkDir(path.join(hostRoot, '.agents', 'skills')).length
    const geminiMdInstalled = fs.existsSync(path.join(hostRoot, 'GEMINI.md'))
    const geminiSettingsInstalled = fs.existsSync(path.join(hostRoot, '.gemini', 'settings.json'))
    const geminiHookFiles = walkDir(path.join(hostRoot, '.gemini', 'hooks', '_runtime')).length
    const grokWorkspacePluginInstalled = Boolean(instructionProjection.grokPlugin?.installed)
    const grokPluginRegistrationCurrent = Boolean(instructionProjection.grokPlugin?.registrationCurrent)
    const grokHookConfigInstalled = grokWorkspacePluginInstalled || fs.existsSync(path.join(hostRoot, '.grok', 'hooks', 'devcodex.json'))
    const grokHookFiles = grokWorkspacePluginInstalled
      ? walkDir(path.join(instructionProjection.grokPlugin.root, 'hooks')).length
      : walkDir(path.join(hostRoot, '.grok', 'hooks', '_runtime')).length
    trackedEntryFiles += [
      rulesInstalled,
      copilotInstructionsInstalled,
      claudeMdInstalled,
      agentsMdInstalled,
      codexHookJsonInstalled,
      geminiMdInstalled,
      geminiSettingsInstalled,
      grokHookConfigInstalled
    ].filter(Boolean).length

    const profileDir = resolveProfileDir(cwd)
    const profileState = inspectProfileState(profileDir)
    const legacy = getLegacyCounts(ghDir)
    const activeRoot = resolveActiveRuntimeRoot(cwd)
    const layoutInfo = typeof findLayoutInfo === 'function'
      ? findLayoutInfo(cwd)
      : { enabled: false, workspaceRoot: cwd }
    const workspaceLayoutReady = Boolean(
      layoutInfo?.enabled &&
      layoutInfo.workspaceRoot &&
      fs.existsSync(path.join(layoutInfo.workspaceRoot, '.devcodex', 'layout.json')) &&
      fs.existsSync(path.join(layoutInfo.workspaceRoot, '.devcodex', 'workspace'))
    )
    const workspaceRuntimeReady = fs.existsSync(activeRoot) || workspaceLayoutReady
    const executionOptimization = inspectExecutionOptimization(cwd)
    const globalHostConfig = inspectGlobalHostConfig({ env: process.env, cwd })
    const globalHostComparison = buildGlobalHostComparison(sourceRepository, globalHostConfig)
    applyGlobalOnlyInstructionProjectionPolicy(instructionProjection, globalHostConfig)
    const hostParity = buildScopedHostParity(
      evaluateGrokHostParity({
        cwd,
        hostRoot,
        env: process.env,
        globalHostConfig
      }),
      globalHostComparison
    )
    const governanceSummary = buildGovernanceStatusSummary({
      cwd,
      activeRoot,
      sourceRepository,
      executionOptimization,
      hostParity
    })
    const readiness = collectSharedReadiness({
      cwd,
      sourceRepository,
      activeRoot,
      workspaceLayoutReady,
      workspaceRuntimeReady,
      profile: { directory: profileDir, ...profileState },
      globalHostConfig,
      hostParity,
      governanceSummary,
      platform: platformEvidence.platform
    })
    return {
      schemaVersion: 'StatusDiagnosticV1',
      cwd,
      hostRoot,
      activeRoot,
      workspaceLayoutReady,
      workspaceRuntimeReady,
      sourceRepository,
      platformEvidence,
      trackedEntryFiles,
      installSurfaces,
      hostParity,
      globalHostComparison,
      entryFiles: {
        rulesInstalled,
        copilotInstructionsInstalled,
        claudeMdInstalled,
        claudeHookFiles,
        claudeSkills,
        agentsMdInstalled,
        agentsSkills,
        codexHookJsonInstalled,
        codexHookFiles,
        codexHookDiagnostics,
        geminiMdInstalled,
        geminiSettingsInstalled,
        geminiHookFiles,
        grokHookConfigInstalled,
        grokHookFiles,
        grokWorkspacePluginInstalled,
        grokPluginRegistrationCurrent,
        instructionProjection
      },
      profile: {
        directory: profileDir,
        tier: profileState.tier,
        complete: profileState.complete,
        error: profileState.error,
        present: profileState.present,
        total: profileState.total,
        required: profileState.required,
        semantic: profileState.semantic,
        configExists: profileState.configExists,
        featureInventory: profileState.featureInventory || null
      },
      executionOptimization,
      worktrees: cliWorktrees.inspect(cwd),
      governanceSummary,
      readiness,
      hostConfigPolicy,
      globalHostConfig,
      globalHostRuntime: globalHostConfig,
      legacy
    }
  }

  function cmdStatus(argv = []) {
    const options = parseDiagnosticCommandArgs('status', argv)
    if (!options) return
    const completionDiagnostic = loadCompletionDiagnostic('status', options)
    if (!completionDiagnostic.ok) return completionDiagnostic.value
    const facts = { ...collectStatusFacts(), completion: completionDiagnostic.value }
    if (options.json) {
      printCliJson(console, createCliSuccess('status', facts, cliMetadata))
      return facts
    }

    const {
      cwd, hostRoot, sourceRepository: isSrc, trackedEntryFiles: total, installSurfaces,
      entryFiles, profile, executionOptimization, governanceSummary, globalHostConfig,
      globalHostComparison, legacy, hostParity, readiness, worktrees
    } = facts
    console.log()
    console.log(c.bold('  DevCodex status') + c.dim(` in ${cwd}`))
    if (path.resolve(hostRoot) !== path.resolve(cwd)) console.log(c.dim(`  Host owner: ${hostRoot}`))
    if (isSrc) {
      console.log(c.yellow('  ⚠️  Source repository detected — comparing this candidate checkout with installed receipts; this is not an installed-package health claim'))
    }
    console.log(c.dim('  ──────────────────────────────────────'))
    console.log()
    console.log(`  readiness         ${readiness.status}${readiness.ready ? ' (ready)' : ' (not ready)'}`)
    if (readiness.nextAction) {
      console.log(`  next action       ${readiness.nextAction.command || readiness.nextAction.instruction}`)
    }
    console.log()

    console.log(c.bold(`  User-global host adapters${isSrc ? ' (source candidate comparison)' : ''}:`))
    for (const host of globalHostConfig.hosts) {
      const state = globalHostComparison.candidateMismatchHosts.includes(host.host)
        ? c.yellow('candidate differs from installed receipt; installed health unverified')
        : formatGlobalHostRuntimeState(host, c)
      console.log(`  ${c.cyan(host.host.padEnd(14))} ${state}`)
    }
    console.log(`  ${c.cyan('node runtime'.padEnd(14))} ${formatNodeRuntimeReadiness(globalHostConfig.nodeRuntime, c)}`)
    console.log()
    console.log()
    console.log(c.bold('  Workspace state:'))
    console.log(`  ${c.cyan('.devcodex'.padEnd(14))} ${facts.workspaceRuntimeReady ? c.green('present') : c.dim('not initialized')}`)
    console.log(`  ${c.cyan('host dirs'.padEnd(14))} ${total
      ? c.yellow(`${total} legacy artifact(s); not required`)
      : c.green('none; expected')}`)
    const projectionWarnings = entryFiles.instructionProjection.warnings || []
    console.log(`  ${c.cyan('host kernel'.padEnd(14))} ${entryFiles.instructionProjection.status === 'ready'
      ? (projectionWarnings.length ? c.yellow(`ready; ${projectionWarnings.length} warning(s)`) : c.green('ready'))
      : (entryFiles.instructionProjection.status === 'not-installed'
          ? c.dim('not installed')
          : c.yellow(`${entryFiles.instructionProjection.issues.length} issue(s)`))}`)
    if (hostParity) {
      const parityLabel = isSrc
        ? c.yellow('source-candidate only — installed health unverified')
        : (hostParity.hardReady
            ? c.green(`${hostParity.tier} — use: devcodex grok`)
            : c.yellow(`${hostParity.tier} — see doctor --json hostParity.checks`))
      console.log(`  ${c.cyan('Grok parity'.padEnd(14))} ${parityLabel}`)
    }

    let profileLabel
    const profileDetails = profile.required
      ? `files ${profile.required.present}/${profile.required.total}; semantic ${profile.semantic.present}/${profile.semantic.total}; config ${profile.configExists ? 'present' : 'missing'}`
      : `${profile.present}/${profile.total} checks`
    if (profile.error) profileLabel = c.red(`invalid   (${profile.error})`)
    else if (profile.complete) profileLabel = c.green(`complete  (${profile.tier}; ${profileDetails})`)
    else if (profile.present > 0) profileLabel = c.yellow(`partial   (${profile.tier}; ${profileDetails})`)
    else profileLabel = c.red(`missing   (${profileDetails} — run: devcodex init)`)
    console.log(`  ${c.cyan('profile'.padEnd(14))} ${profileLabel}`)
    console.log(`  ${c.cyan('optimization'.padEnd(14))} ${executionOptimization.config.effective} (${executionOptimization.stateStatus}; ${executionOptimization.features.filter(item => item.decision.optimizationAllowed).length}/${executionOptimization.features.length} accelerated)`)
    console.log(`  ${c.cyan('governance'.padEnd(14))} ${formatGovernanceSummary(governanceSummary)}`)
    cliWorktrees.renderStatus({ console, c, worktrees })
    if (facts.completion) {
      const projection = facts.completion.completion?.projection
      console.log(`  ${c.cyan('completion'.padEnd(14))} ${projection ? `${projection.workflowEvidenceState}/${projection.completionPhase}` : 'UNVERIFIED/unavailable'}`)
      console.log(`  ${c.cyan('projection'.padEnd(14))} ${projection?.projectionDigest || '(not committed)'}`)
    }

    for (const item of legacy) {
      const label = item.count > 0 ? c.yellow(`${item.count} files (legacy)`) : c.dim('not installed')
      console.log(`  ${c.cyan(item.label.padEnd(14))} ${label}`)
    }

    console.log()
    if (total === 0) {
      if (isSrc || facts.workspaceRuntimeReady) {
        console.log(`  ${c.dim('No workspace host artifacts.')} ${c.dim(`This is expected in ${workspaceCleanMode}.`)}`)
      } else {
        console.log(`  ${c.yellow('Workspace runtime not initialized.')} Run ${c.bold('devcodex init')}; host adapters require ${c.bold('npm install -g devcodex')}.`)
      }
    } else {
      console.log(`  ${c.yellow(`${total} legacy workspace host entry files`)} detected; global receipts above are the installation authority`)
      if (isSrc) {
        console.log(c.dim('  (Source repo: these are development copies, not a target project installation)'))
      }
    }
    const legacyPresent = legacy.some(item => item.count > 0)
    if (legacyPresent) {
      console.log(c.yellow('  ⚠️  Legacy custom agent files detected. They are no longer part of the default installation set.'))
    }
    console.log()
    return facts
  }

  function parseProfileInitArgs(argv) {
    const result = { force: false, prod: false, dryRun: false, allowDowngrade: false, requestedTier: null, tierExplicit: false, errors: [] }
    for (let index = 0; index < argv.length; index++) {
      const arg = argv[index]
      if (arg === '--force' || arg === '-f') result.force = true
      else if (arg === '--prod') result.prod = true
      else if (arg === '--dry-run') result.dryRun = true
      else if (arg === '--allow-downgrade') result.allowDowngrade = true
      else if (arg === '--tier') {
        const value = argv[index + 1]
        if (!value || value.startsWith('-')) result.errors.push('missing value for --tier')
        else {
          result.requestedTier = value
          result.tierExplicit = true
          index++
        }
      } else if (arg.startsWith('--tier=')) {
        result.requestedTier = arg.slice('--tier='.length)
        result.tierExplicit = true
        if (!result.requestedTier) result.errors.push('missing value for --tier')
      } else result.errors.push(`unknown profile init option: ${arg}`)
    }
    if (result.requestedTier) {
      try { result.requestedTier = normalizeProfileTier(result.requestedTier, '') } catch {
        result.errors.push(`invalid --tier value: ${result.requestedTier}`)
      }
    }
    return result
  }

  function readDetectedTier(dir) {
    if (!fs.existsSync(dir)) return null
    const markdown = []
    try {
      for (const file of fs.readdirSync(dir).filter(file => file.endsWith('.md'))) {
        try { markdown.push(fs.readFileSync(path.join(dir, file), 'utf8')) } catch { }
      }
    } catch { }
    if (!markdown.length) return null
    try {
      return detectProfileTier(markdown.join('\n'), '')
    } catch (error) {
      if (/^invalid profile tier:\s*(?:undefined)?$/.test(String(error?.message || ''))) return null
      throw error
    }
  }

  function buildProfileContext(cwd) {
    const pkg = readJsonSafe(path.join(cwd, 'package.json'))
    let branch = '(unknown)'
    try {
      const headFile = path.join(cwd, '.git', 'HEAD')
      if (fs.existsSync(headFile)) {
        const head = fs.readFileSync(headFile, 'utf-8').trim()
        branch = head.startsWith('ref:') ? head.replace('ref: refs/heads/', '') : head.slice(0, 7)
      }
    } catch { }
    const changelogTop = safeFirstLine(path.join(cwd, 'CHANGELOG.md'), '## ')
    const arch = detectArch(cwd)
    const tree = listTopDirs(cwd, 2)
    const style = detectStyle(cwd)
    const hasServices = fs.existsSync(path.join(cwd, 'services'))
    return { cwd, pkg, branch, changelogTop, arch, tree, style, hasServices }
  }

  function printProfileArgErrors(errors) {
    for (const error of errors) console.log(c.red(`  ${error}`))
    console.log(c.dim('  Usage: devcodex profile init [--dry-run] [--force] [--prod] [--tier <profile-lite|profile-standard|profile-closed-loop>] [--allow-downgrade]'))
    process.exitCode = 1
  }

  function cmdProfileInit(argv, runtimeOptions = {}) {
    const log = runtimeOptions.silent ? () => {} : (...args) => console.log(...args)
    const options = parseProfileInitArgs(argv)
    if (options.errors.length) {
      printProfileArgErrors(options.errors)
      return { ok: false, reason: 'invalid-arguments' }
    }
    const cwd = runtimeOptions.cwdOverride ? path.resolve(runtimeOptions.cwdOverride) : process.cwd()
    const dir = runtimeOptions.profileDirOverride
      ? path.resolve(runtimeOptions.profileDirOverride)
      : path.join(resolveActiveRuntimeRoot(cwd), 'profile')
    const ctx = buildProfileContext(cwd)
    let detectedTier
    try {
      detectedTier = readDetectedTier(dir)
    } catch (error) {
      printProfileArgErrors([`invalid existing Profile tier: ${error.message}`])
      return { ok: false, reason: 'invalid-existing-tier' }
    }
    const recommendation = recommendProfileTier(ctx)
    const tier = options.requestedTier || detectedTier || (runtimeOptions.useRecommendedTier ? recommendation.tier : 'profile-lite')
    if (detectedTier && compareProfileTiers(tier, detectedTier) < 0 && !options.allowDowngrade) {
      printProfileArgErrors([`refusing profile downgrade: ${detectedTier} → ${tier}; add --allow-downgrade to confirm`])
      return { ok: false, reason: 'downgrade-not-authorized' }
    }
    const mode = options.prod ? 'prod' : 'dev'
    log()
    log(c.bold(`  DevCodex profile ${options.dryRun ? 'plan' : 'init'}`) + c.dim(` (${tier}) in ${cwd}`))
    log(c.dim('  ──────────────────────────────────────'))
    const agent = detectAgent(cwd)
    log(`  target root:      ${dir}`)
    log(`  detected tier:    ${detectedTier || '(none)'}`)
    log(`  requested tier:   ${options.tierExplicit ? tier : '(not explicit)'}`)
    log(`  recommended tier: ${recommendation.tier}`)
    for (const reason of recommendation.reasons) log(c.dim(`    - ${reason}`))
    log(`  target tier:      ${tier}`)
    log(`  mode:             ${mode}`)
    if (options.dryRun) log(c.yellow('  dry-run:          no directories, files or backups will be written'))
    log()

    const generators = {
      'README.md': () => genProfileReadme(tier),
      '01-项目信息.md': () => genProjectInfo(ctx),
      '02-架构约束.md': () => genArchitecture(ctx),
      '03-代码风格.md': () => genStyle(ctx),
      '04-测试规范.md': () => genTestSpec(ctx),
      '05-发布规范.md': () => genReleaseSpec(ctx),
      '06-功能清单.md': () => genFeatureInventory(ctx),
      '07-用户文档与契约规范.md': () => genUserContractSpec(ctx),
      'config.json': () => genConfigJson(agent, mode)
    }

    let generated = 0, skipped = 0, backedUp = 0
    const actions = []
    for (const file of filesForProfileTier(tier)) {
      const dest = path.join(dir, file)
      const exists = fs.existsSync(dest)
      const shouldUpdateTier = file === 'README.md' && exists && detectedTier && tier !== detectedTier && !options.force
      if (shouldUpdateTier) {
        actions.push({ file, action: 'update-tier', dest })
        log(`  ${c.cyan('[tier]')} ${file} ${c.dim(`(${detectedTier} → ${tier}; preserve body)`)}`)
        continue
      }
      if (exists && !options.force) {
        actions.push({ file, action: 'skip', dest })
        log(`  ${c.dim('[skip]')}  ${file} ${c.dim('(existing)')}`)
        skipped++
        continue
      }
      actions.push({ file, action: exists ? 'backup-and-generate' : 'generate', dest })
      log(`  ${exists ? c.yellow('[force]') : c.green('[gen]')} ${file}${exists ? c.dim(' (backup first)') : ''}`)
      generated++
    }

    if (!options.dryRun) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const backupId = new Date().toISOString().replace(/[-:TZ.]/g, '')
      for (const item of actions) {
        if (item.action === 'skip') continue
        if (item.action === 'update-tier') {
          const current = fs.readFileSync(item.dest, 'utf8')
          fs.writeFileSync(item.dest, updateProfileTierDeclaration(current, tier), 'utf8')
          continue
        }
        if (item.action === 'backup-and-generate') {
          const bak = `${item.dest}.bak.${backupId}`
          fs.copyFileSync(item.dest, bak)
          backedUp++
        }
        fs.writeFileSync(item.dest, generators[item.file](), 'utf-8')
      }
    }

    log()
    const plannedTierUpdates = actions.filter(item => item.action === 'update-tier').length
    log(`  ${options.dryRun ? 'Planned generate' : 'Generated'}: ${generated}  Skipped: ${skipped}  Tier updates: ${plannedTierUpdates}  Backed up: ${backedUp}`)
    if (generated > 0 || plannedTierUpdates > 0) log(c.yellow('  ⚠️  Generated content is an evidence-backed draft; review every unverified field before relying on it.'))
    if (!options.tierExplicit && recommendation.tier !== tier) {
      log(c.yellow(`  Recommendation: run \`devcodex profile plan --tier ${recommendation.tier}\` before upgrading.`))
    }
    log()
    return { ok: true, dryRun: options.dryRun, detectedTier, recommendedTier: recommendation.tier, targetTier: tier, actions }
  }

  function collectDoctorFacts() {
    const cwd = process.cwd()
    const env = process.env
    const instructionProjection = inspectHostInstructionSurfaces(cwd)
    const hostRoot = path.resolve(instructionProjection.inspectionRoot || cwd)
    const platformEvidence = detectHostPlatform(env, cwd)
    const platform = platformEvidence.platform
    const agent = detectAgent(cwd)
    const installedHosts = detectInstalledHostAssets(hostRoot)

    const hasGithubHooks = fs.existsSync(path.join(hostRoot, '.github', 'hooks', '_runtime', 'lifecycle.cjs'))
    const hasClaudeHooks = fs.existsSync(path.join(hostRoot, '.claude', 'hooks', '_runtime', 'lifecycle.cjs'))
    const hasCodexHooksJson = fs.existsSync(path.join(hostRoot, '.codex', 'hooks.json'))
    const hasCodexHooks = hasCodexHooksJson && fs.existsSync(path.join(hostRoot, '.codex', 'hooks', '_runtime', 'lifecycle.cjs'))
    const codexHookDiagnostics = readCodexHookCommands(hostRoot)
    const codexConfigState = getCodexConfigState(hostRoot)
    const hasCopilotMd = fs.existsSync(path.join(hostRoot, '.github', 'copilot-instructions.md'))
    const hasClaudeMd = fs.existsSync(path.join(hostRoot, 'CLAUDE.md'))
    const hasAgentsMd = fs.existsSync(path.join(hostRoot, 'AGENTS.md'))
    const hasAgentsSkills = fs.existsSync(path.join(hostRoot, '.agents', 'skills'))
    const hasInstructions = fs.existsSync(path.join(hostRoot, '.github', 'instructions'))
    const hasGeminiMd = fs.existsSync(path.join(hostRoot, 'GEMINI.md'))
    const hasGeminiSettings = fs.existsSync(path.join(hostRoot, '.gemini', 'settings.json'))
    const hasGeminiHooks = hasGeminiSettings && fs.existsSync(path.join(hostRoot, '.gemini', 'hooks', '_runtime', 'lifecycle-host-adapters.cjs'))
    const hasGrokWorkspacePlugin = Boolean(instructionProjection.grokPlugin?.installed)
    const hasGrokPluginRegistration = Boolean(instructionProjection.grokPlugin?.registrationCurrent)
    const hasGrokHookConfig = hasGrokWorkspacePlugin || fs.existsSync(path.join(hostRoot, '.grok', 'hooks', 'devcodex.json'))
    const hasGrokHooks = hasGrokWorkspacePlugin || (hasGrokHookConfig && fs.existsSync(path.join(hostRoot, '.grok', 'hooks', '_runtime', 'lifecycle-host-adapters.cjs')))
    const profileDir = resolveProfileDir(cwd)
    const profileState = inspectProfileState(profileDir)
    const hasProfile = profileState.complete
    const activeRoot = resolveActiveRuntimeRoot(cwd)
    const layoutInfo = typeof findLayoutInfo === 'function'
      ? findLayoutInfo(cwd)
      : { enabled: false, workspaceRoot: cwd }
    const workspaceLayoutReady = Boolean(
      layoutInfo?.enabled &&
      layoutInfo.workspaceRoot &&
      fs.existsSync(path.join(layoutInfo.workspaceRoot, '.devcodex', 'layout.json')) &&
      fs.existsSync(path.join(layoutInfo.workspaceRoot, '.devcodex', 'workspace'))
    )
    const workspaceRuntimeReady = fs.existsSync(activeRoot) || workspaceLayoutReady
    const executionOptimization = inspectExecutionOptimization(cwd)
    const sourceRepository = isSourceRepo(cwd)
    const globalHostConfig = inspectGlobalHostConfig({ env, cwd, depth: 'deep' })
    const globalHostComparison = buildGlobalHostComparison(sourceRepository, globalHostConfig)
    applyGlobalOnlyInstructionProjectionPolicy(instructionProjection, globalHostConfig)
    const globalReady = host => globalHostConfig.hosts.some(item => item.host === host && item.ready)
    const globalAdapterReady = host => globalHostConfig.hosts.some(item => item.host === host && item.adapterReady)

    let mode = 'instruction-fallback'
    if (sourceRepository && globalHostComparison.candidateMismatchHosts.includes(platform)) {
      mode = `source candidate differs from installed ${platform} receipt (installed health unverified)`
    }
    else if (platform === 'copilot' && globalReady('copilot')) mode = 'user-global hook + MCP adapter (Copilot CLI)'
    else if (platform === 'claude' && globalReady('claude')) mode = 'user-global hook adapter (Claude Code)'
    else if (platform === 'codex' && globalReady('codex')) mode = 'user-global hook adapter (Codex; event-dependent)'
    else if (platform === 'gemini' && globalReady('gemini')) mode = 'user-global hook adapter (Gemini; fixture-backed)'
    else if (platform === 'grok' && globalReady('grok')) mode = 'user-global plugin adapter (Grok)'
    else if (platform === 'cursor' && globalAdapterReady('cursor')) mode = 'user-global Cursor Beta Hook + Plugin adapter (native variant unverified)'
    else if (['copilot', 'claude', 'codex', 'gemini', 'grok', 'cursor'].includes(platform) && globalAdapterReady(platform)) {
      mode = `user-global ${platform} adapter installed (native CLI unavailable or unverified)`
    }
    else if (platform === 'vscode-copilot' && hasGithubHooks) mode = 'workspace-hooks detected (VS Code Copilot preview; verify target IDE)'
    else if (platform === 'jetbrains-copilot') mode = 'instruction-fallback (JetBrains — Hooks unsupported)'
    else if (platform === 'unknown' && installedHosts.length > 1) mode = 'mixed install (host unresolved; multiple adapters present)'

    const hostParity = buildScopedHostParity(
      evaluateGrokHostParity({
        cwd,
        hostRoot,
        env,
        globalHostConfig,
        platform
      }),
      globalHostComparison
    )
    const governanceSummary = buildGovernanceStatusSummary({
      cwd,
      activeRoot,
      sourceRepository,
      executionOptimization,
      hostParity
    })
    const readiness = collectSharedReadiness({
      cwd,
      sourceRepository,
      activeRoot,
      workspaceLayoutReady,
      workspaceRuntimeReady,
      profile: { directory: profileDir, ...profileState },
      globalHostConfig,
      hostParity,
      governanceSummary,
      platform
    })
    // Workspace skill inventory (W layer) from the unified runtime identity index.
    let workspaceSkills = {
      enabled: true,
      root: null,
      count: 0,
      ids: [],
      routeModule: false
    }
    try {
      const skillRes = require('../../hooks/_runtime/skill-resolution.cjs')
      const { buildRuntimeSkillIdentityIndex } = require('../../hooks/_runtime/runtime-skill-identity-index.cjs')
      workspaceSkills.routeModule = true
      workspaceSkills.enabled = skillRes.isWorkspaceSkillsEnabled(env)
      workspaceSkills.root = skillRes.resolveWorkspaceSkillsRoot(cwd, { cwd, env })
      if (workspaceSkills.root) {
        const index = buildRuntimeSkillIdentityIndex({ cwd, activeRoot, env })
        const list = index.entries.filter(item => item.effectiveLayer === 'workspace')
        workspaceSkills.count = list.length
        workspaceSkills.ids = list.map(item => item.skillId).slice(0, 24)
      }
    } catch {
      workspaceSkills.routeModule = false
    }
    return {
      schemaVersion: 'DoctorDiagnosticV1',
      cwd,
      hostRoot,
      activeRoot,
      workspaceLayoutReady,
      workspaceRuntimeReady,
      sourceRepository,
      globalHostComparison,
      platform,
      platformSource: platformEvidence.source,
      platformEvidence,
      agent,
      installedHosts,
      mode,
      hostParity,
      hostConfigPolicy,
      globalHostConfig,
      globalHostRuntime: globalHostConfig,
      workspaceSkills,
      enforcement: 'safety-only by default; strict blocks only host-supported events',
      installArtifacts: {
        hasGithubHooks,
        hasClaudeHooks,
        hasCodexHooksJson,
        hasCodexHooks,
        hasCopilotMd,
        hasClaudeMd,
        hasAgentsMd,
        hasAgentsSkills,
        hasInstructions,
        hasGeminiMd,
        hasGeminiSettings,
        hasGeminiHooks,
        hasGrokHookConfig,
        hasGrokHooks,
        hasGrokWorkspacePlugin,
        hasGrokPluginRegistration,
        instructionProjection
      },
      codexHookDiagnostics,
      codexConfigState: {
        hasUserConfig: codexConfigState.hasUserConfig,
        hasWorkspaceConfig: codexConfigState.hasWorkspaceConfig,
        mcp: codexConfigState.mcp || null
      },
      profile: {
        directory: profileDir,
        ...profileState,
        featureInventory: profileState.featureInventory || null
      },
      executionOptimization,
      worktrees: cliWorktrees.inspect(cwd),
      governanceSummary,
      readiness,
      capabilityBoundary: {
        localOnly: true,
        hookEvidence: 'event-dependent',
        instructionFallback: true,
        serverUrl: false,
        auth: false,
        tenant: false,
        telemetry: false
      }
    }
  }

  function cmdDoctor(argv = []) {
    // v1.9.7+ P-001/P-004: runtime diagnostic for host detection & JetBrains verification
    const options = parseDiagnosticCommandArgs('doctor', argv)
    if (!options) return
    const completionDiagnostic = loadCompletionDiagnostic('doctor', options)
    if (!completionDiagnostic.ok) return completionDiagnostic.value
    const facts = { ...collectDoctorFacts(), completion: completionDiagnostic.value }
    if (options.json) {
      printCliJson(console, createCliSuccess('doctor', facts, cliMetadata))
      return facts
    }
    const {
      cwd, hostRoot, platformEvidence, platform, agent, installedHosts, mode,
      installArtifacts, codexHookDiagnostics, codexConfigState,
      profile: profileState,
      executionOptimization,
      governanceSummary,
      hostParity, globalHostConfig, globalHostComparison, sourceRepository, completion, workspaceSkills, worktrees,
      readiness
    } = facts
    const {
      hasGithubHooks, hasClaudeHooks, hasCodexHooksJson, hasCodexHooks,
      hasCopilotMd, hasClaudeMd, hasAgentsMd, hasAgentsSkills, hasInstructions,
      hasGeminiMd, hasGeminiSettings, hasGeminiHooks, hasGrokHookConfig, hasGrokHooks,
      hasGrokWorkspacePlugin, hasGrokPluginRegistration,
      instructionProjection
    } = installArtifacts
    const profileDir = profileState.directory
    const hasProfile = profileState.complete
    const globalReady = host => globalHostConfig.hosts.some(item => item.host === host && item.ready)
    const globalAdapterReady = host => globalHostConfig.hosts.some(item => item.host === host && item.adapterReady)
    const adapterReadyHosts = globalHostConfig.hosts.filter(host => host.adapterReady)
    const sourceCandidateMismatchSet = new Set(globalHostComparison.candidateMismatchHosts)
    console.log()
    console.log(`  readiness:       ${readiness.status}${readiness.ready ? ' (ready)' : ' (not ready)'}`)
    if (readiness.nextAction) {
      console.log(`  next action:     ${readiness.nextAction.command || readiness.nextAction.instruction}`)
    }
    const unverifiedAdapters = globalHostConfig.hosts
      .filter(host => host.inspectionStatus === 'UNVERIFIED')
    const missingAdapters = globalHostConfig.hosts
      .filter(host => !host.adapterReady &&
        host.inspectionStatus !== 'UNVERIFIED' &&
        !sourceCandidateMismatchSet.has(host.host))
    const nativeNotReady = globalHostConfig.hosts.filter(host => host.adapterReady && !host.ready)

    console.log()
    console.log(c.bold('  DevCodex Doctor') + c.dim(` v1.9.7+ — runtime diagnostics`))
    console.log(c.dim('  ──────────────────────────────────────'))
    console.log(`  cwd:             ${cwd}`)
    console.log(`  host owner:      ${hostRoot}`)
    if (sourceRepository) {
      console.log(c.yellow('  diagnostic scope: source candidate vs installed receipts; installed package health is not asserted'))
    }
    console.log(`  platform:        ${c.cyan(platform)}  ${c.dim(`(${platformEvidence.source})`)}`)
    console.log(`  agent:           ${c.cyan(agent)}`)
    console.log(`  workspace hosts: ${installedHosts.length ? c.yellow(`${installedHosts.join(', ')} (legacy)`) : c.dim('none; expected')}`)
    console.log(`  global adapters: ${sourceRepository
      ? `${globalHostConfig.hosts.length - sourceCandidateMismatchSet.size}/${globalHostConfig.hosts.length} match source candidate`
      : `${adapterReadyHosts.length}/${globalHostConfig.hosts.length} ready`}`)
    console.log(`  native hosts:    ${globalHostConfig.hosts.filter(host => host.nativeStatus === 'passed').length}/${globalHostConfig.hosts.length} ready`)
    console.log(`  node runtime:    ${formatNodeRuntimeReadiness(globalHostConfig.nodeRuntime, c)}`)
    console.log(`  mode:            ${c.bold(mode)}`)
    console.log(`  optimization:    ${c.bold(executionOptimization.config.effective)} ${c.dim(`(${executionOptimization.config.status}; state=${executionOptimization.stateStatus})`)}`)
    console.log(`  governance:      ${formatGovernanceSummary(governanceSummary)}`)
    cliWorktrees.renderDoctor({ console, c, worktrees })
    if (completion) {
      const projection = completion.completion?.projection
      console.log(`  completion:      ${projection ? `${projection.workflowEvidenceState}/${projection.completionPhase}` : 'UNVERIFIED/unavailable'}`)
      console.log(`  first blocker:   ${projection?.diagnostics?.firstBlocker?.requirementId || '(none)'}`)
      console.log(`  next actions:    ${(projection?.diagnostics?.recommendedActions || []).join(', ') || '(none)'}`)
    }
    console.log(c.dim('  enforcement:     default safety-only warns/continues for bootstrap/CP/auto; strict blocks only host-supported events.'))
    if (hostParity && !sourceRepository) {
      const tierColor = hostParity.hardReady ? c.green : c.yellow
      console.log(`  Grok HostParity: ${tierColor(hostParity.tier)} ${c.dim(`(ref Codex; ${hostParity.hardReady ? 'hard path ready' : 'partial'})`)}`)
      console.log(c.dim(`  ${hostParity.userVisibleSummary}`))
      console.log(c.dim(`  Full session entry: ${hostParity.recommendedEntry}`))
    } else if (hostParity && sourceRepository) {
      console.log(c.dim('  Grok HostParity: source-candidate comparison only; installed HostParity health is not asserted here.'))
    }
    if (workspaceSkills) {
      const ids = (workspaceSkills.ids || []).join(', ') || '(none)'
      const mod = workspaceSkills.routeModule ? 'Unified route module OK' : 'Unified route module missing'
      console.log(`  workspace skills: ${c.cyan(String(workspaceSkills.count || 0))}  ${c.dim(`enabled=${workspaceSkills.enabled !== false}; ${mod}`)}`)
      console.log(c.dim(`  W root: ${workspaceSkills.root || '(none)'} · ids: ${ids}`))
      console.log(c.dim('  diagnose: devcodex skill resolve <id> · npm run test:skill-route'))
    }
    console.log()
    console.log(c.bold('  User-global host adapters:'))
    for (const host of globalHostConfig.hosts) {
      const state = sourceCandidateMismatchSet.has(host.host)
        ? c.yellow('⚠️ candidate differs from installed receipt; installed health unverified')
        : formatGlobalHostRuntimeState(host, c, { icon: true })
      console.log(`    ${host.host.padEnd(10)} ${state}`)
    }
    if (missingAdapters.length) {
      console.log(c.yellow(`    Missing adapters: ${missingAdapters.map(host => host.host).join(', ')}. Repair with \`npm install -g devcodex\`.`))
    } else if (unverifiedAdapters.length) {
      console.log(c.yellow(
        `    Adapter health is unverified for: ${unverifiedAdapters.map(host => host.host).join(', ')}. ` +
        'No installation failure is proven; grant the requested read access and rerun the diagnostic.'
      ))
    } else {
      console.log(c.green(sourceRepository
        ? '    No independently missing adapter was found by the source-candidate comparison.'
        : '    All user-global adapters are installed and their contracts pass.'))
    }
    if (globalHostComparison.candidateMismatchHosts.length) {
      console.log(c.yellow(
        `    Source candidate differs from installed receipts for: ${globalHostComparison.candidateMismatchHosts.join(', ')}. ` +
        'This does not prove the installed adapters are broken.'
      ))
    }
    for (const host of unverifiedAdapters) {
      const nextStep = host.issues?.find(issue => issue.code === 'GLOBAL_HOST_TARGET_UNVERIFIED')?.nextStep
      if (nextStep) console.log(c.dim(`    ${host.host}: ${nextStep}`))
    }
    if (nativeNotReady.length) {
      console.log(c.dim(`    Native host CLIs not operationally ready: ${nativeNotReady.map(host => host.host).join(', ')}. Install or repair those CLIs, then rerun \`devcodex doctor\`.`))
    }
    if (globalHostConfig.nodeRuntime?.status !== 'PASS' && globalHostConfig.nodeRuntime?.nextStep) {
      console.log(c.yellow(`    Node startup recovery: ${globalHostConfig.nodeRuntime.nextStep}`))
    }
    const guidance = refreshGuidanceForCwd(cwd)
    console.log(c.dim(sourceRepository
      ? `    ${guidance.doctorHint}`
      : `    ${guidance.doctorHint}`))
    console.log(c.bold('  Workspace state:'))
    console.log(`    .devcodex                             ${fs.existsSync(path.join(hostRoot, '.devcodex')) ? c.green('✅') : c.dim('— initialize with `devcodex init`')}`)
    console.log(`    legacy host artifacts                 ${installedHosts.length ? c.yellow(installedHosts.join(', ')) : c.green('none; expected')}`)
    const profileDiagnostic = profileState.error
      ? c.red(`❌ invalid — ${profileState.error}`)
      : (hasProfile
          ? c.green(`✅ ${profileState.tier}`)
          : c.yellow(`⚠️  incomplete ${profileState.tier} — run \`devcodex init\``))
    console.log(`    profile (${path.relative(cwd, profileDir) || '.devcodex/profile'}) ${profileDiagnostic}`)
    console.log()

    if (agent !== 'unknown-agent' && profileDir) {
      const profileConfig = readJsonSafe(path.join(profileDir, 'config.json'))
      if (profileConfig?.agent && profileConfig.agent !== agent) {
        console.log(c.yellow(`  ⚠️  profile agent is ${profileConfig.agent}, current host evidence resolves to ${agent}. Use host evidence for this session.`))
        console.log()
      }
    }

    if (platform === 'jetbrains-copilot' || mode.startsWith('instruction-fallback')) {
      console.log(c.bold('  Copilot support ceiling:'))
      console.log(sourceCandidateMismatchSet.has('copilot')
        ? '    The source candidate differs from the installed Copilot receipt; installed Copilot adapter health is not asserted.'
        : globalAdapterReady('copilot')
        ? '    Copilot CLI user-global instructions, Hooks, MCP, and Skills are installed by the global adapter.'
        : '    Copilot CLI user-global instructions, Hooks, MCP, and Skills require `npm install -g devcodex`.')
      console.log('    Operational readiness still requires a successful native `copilot --version` deep probe.')
      console.log(`    IDE workspace hooks and per-repository instruction files are not installed in ${workspaceCleanMode}.`)
      console.log()
    }

    if (platform === 'vscode-copilot' && hasGithubHooks) {
      console.log(c.yellow('  ⚠️  VS Code Copilot hooks detected, but DevCodex treats this as preview/target-version dependent; verify actual IDE hook support before claiming hard enforcement.'))
      console.log()
    }

    if (platform === 'copilot' && !globalReady('copilot') && !sourceCandidateMismatchSet.has('copilot')) {
      console.log(c.yellow(globalAdapterReady('copilot')
        ? '  ⚠️  Copilot user-global adapter is ready, but the native `copilot --version` probe did not pass — install or repair Copilot CLI, then rerun `devcodex doctor`.'
        : '  ⚠️  Copilot CLI detected without a ready user-global adapter — run `npm install -g devcodex`.'))
      console.log()
    }
    if (platform === 'claude' && !globalReady('claude') && !sourceCandidateMismatchSet.has('claude')) {
      console.log(c.yellow(globalAdapterReady('claude')
        ? '  ⚠️  Claude user-global adapter is ready, but the native `claude --version` probe did not pass — install or repair Claude Code, then rerun `devcodex doctor`.'
        : '  ⚠️  Claude Code detected without a ready user-global adapter — run `npm install -g devcodex`.'))
      console.log()
    }
    if (platform === 'codex' && !globalReady('codex') && !sourceCandidateMismatchSet.has('codex')) {
      console.log(c.yellow(globalAdapterReady('codex')
        ? '  ⚠️  Codex user-global adapter is ready, but the native `codex --version` probe did not pass — install or repair Codex, then rerun `devcodex doctor`.'
        : '  ⚠️  Codex detected without a ready user-global adapter — run `npm install -g devcodex`.'))
      if (!globalAdapterReady('codex')) console.log(c.dim(`      Expected hook command: ${CODEX_HOOK_COMMAND}`))
      console.log()
    }
    if (platform === 'gemini' && !globalReady('gemini') && !sourceCandidateMismatchSet.has('gemini')) {
      console.log(c.yellow(globalAdapterReady('gemini')
        ? '  ⚠️  Gemini user-global adapter is ready, but the native `gemini --version` probe did not pass — install or repair Gemini CLI, then rerun `devcodex doctor`.'
        : '  ⚠️  Gemini CLI detected without a ready user-global adapter — run `npm install -g devcodex`.'))
      console.log()
    }
    if (platform === 'grok' && !globalReady('grok') && !sourceCandidateMismatchSet.has('grok')) {
      console.log(c.yellow(globalAdapterReady('grok')
        ? '  ⚠️  Grok user-global adapter is ready, but the native `grok version` probe did not pass — install or repair Grok, then rerun `devcodex doctor`.'
        : '  ⚠️  Grok detected without a ready user-global adapter — run `npm install -g devcodex`.'))
      console.log()
    }
    if (platform === 'cursor' && !globalReady('cursor') && !sourceCandidateMismatchSet.has('cursor')) {
      console.log(c.yellow(globalAdapterReady('cursor') ? '  ⚠️  Cursor Beta user-global adapter is ready; native Cursor IDE/CLI execution remains UNVERIFIED. Run agent --version and devcodex doctor on the target machine.' : '  ⚠️  Cursor detected without a ready user-global adapter — run npm install -g devcodex.'))
      console.log(`${c.dim('      Cursor Cloud Agent does not load user-level hooks; Cloud support remains partial and UNVERIFIED.')}\n`)
    }
    if (hostParity && !hostParity.hardReady && sourceRepository) {
      console.log(c.dim('  Grok HostParity details are withheld in source-candidate scope; install the packed candidate before evaluating installed repair steps.'))
      console.log()
    } else if (hostParity && !hostParity.hardReady) {
      console.log(c.bold('  Grok HostParity checks:'))
      for (const [key, ok] of Object.entries(hostParity.checks || {})) {
        console.log(`    ${key.padEnd(28)} ${ok ? c.green('✅') : c.red('❌')}`)
      }
      console.log(c.bold('  Repair steps (executable · PF-165):'))
      const steps = Array.isArray(hostParity.repairSteps) ? hostParity.repairSteps : []
      if (!steps.length) {
        console.log(c.dim('    (none listed — re-run doctor --json and inspect hostParity.checks)'))
      }
      for (const step of steps) {
        const mark = step.status === 'recommended' ? c.cyan('→') : c.yellow('!')
        console.log(`    ${mark} ${c.bold(step.command)}`)
        console.log(c.dim(`      [${step.check}] ${step.detail}`))
      }
      console.log(c.dim('  Re-verify: devcodex doctor --json  →  payload.hostParity.repairSteps / failedChecks'))
      console.log(c.dim('  Cannot claim: ' + (hostParity.cannotClaim || []).slice(0, 2).join('; ')))
      console.log(c.dim('  GrokTurnChecklist: PC0~PC7 → Skill bundle → work → report+memory (see host-parity-grok.md)'))
      console.log()
    } else if (hostParity && hostParity.hardReady) {
      console.log(c.dim('  Grok HostParity: host-owned PreTool operations + path-observable ready. Still cannot claim UserPromptSubmit inject or Stop hard-block.'))
      console.log(c.dim('  Prefer `devcodex grok` in child Git projects for Full kernel evidence.'))
      console.log(c.dim('  GrokTurnChecklist + Intent→Skill bundle still required (passive host has no inject).'))
      console.log()
    }
    if (instructionProjection.issues.length) {
      for (const issue of instructionProjection.issues) console.log(c.yellow(`  ⚠️  ${issue.code}`))
      console.log(c.dim(sourceRepository
        ? '      Source-candidate scope does not establish installed adapter failure; validate the packed candidate first.'
        : '      These are legacy workspace artifacts. Repair the user-global adapter with `npm install -g devcodex`.'))
      console.log()
    }
    if ((instructionProjection.warnings || []).length) {
      for (const warning of instructionProjection.warnings) console.log(c.yellow(`  ⚠️  ${warning.code}`))
      console.log(c.dim('      Warning only: source/installed digest drift does not make the Grok adapter unavailable.'))
      console.log()
    }
    if (hasCodexHooksJson) {
      console.log(c.yellow(`  ⚠️  Legacy workspace Codex configuration detected; ${workspaceCleanMode} does not require it.`))
      if (codexHookDiagnostics.error) {
        console.log(c.yellow(`  ⚠️  Codex hooks.json could not be parsed: ${codexHookDiagnostics.error}`))
        console.log()
      } else if (codexHookDiagnostics.invalidCommands.length || !codexHookDiagnostics.commands.length) {
        console.log(c.yellow(`  ⚠️  Codex hook command mismatch — expected: ${CODEX_HOOK_COMMAND}`))
        if (codexHookDiagnostics.commands.length) {
          console.log(c.dim(`      Actual: ${codexHookDiagnostics.commands.join(', ')}`))
        }
        console.log()
      }
      console.log(c.dim('  Codex trust/config: hook changes may require trusting the workspace in Codex and opening a new conversation.'))
      console.log(c.dim('  Codex hook guardrail: blocking behavior is event-dependent (decision / continue:false / permissionDecision).'))
      console.log(c.dim('  The user-global Codex MCP block and runtime are owned by npm global install/update.'))
      console.log()
    }
  }
  function cmdHelp(topicInput) {
    const topicParts = Array.isArray(topicInput)
      ? topicInput.map(item => String(item || '').trim()).filter(Boolean)
      : (topicInput ? [String(topicInput).trim()] : [])
    const topic = topicParts[0] || null
    const detail = {
      init: ['devcodex init [--profile <project>] [--dry-run]', 'Initialize the current workspace and Profile baseline. --profile selects an existing physical project by unique name or workspace-relative namespace; --dry-run writes nothing.'],
      update: ['devcodex update [--dry-run]', 'Refresh only the current workspace .devcodex runtime state.'],
      status: ['devcodex status [--completion] [--json]', 'Show workspace and user-global adapter readiness.'],
      doctor: ['devcodex doctor [--completion] [--json]', 'Diagnose adapter, native host and workflow readiness.'],
      profile: ['devcodex profile plan|init [--tier <tier>] [--dry-run] [--force] [--prod]', 'Preview or create an advanced project Profile. Ordinary workspaces only need `devcodex init`.'],
      runtime: ['devcodex runtime status|doctor|maintenance [--dry-run] [--generation-budget <1..128>] [--resume-cursor <opaque>] [--json] | maintenance --apply [--generation-plan <sha256>]', 'Inspect TaskRecovery V5/legacy usage or run a bounded, resumable runtime-generation preview; dry-run deletes nothing and legacy remains read-only.'],
      tmp: ['devcodex tmp status|maintain [--apply --project=<id> --partition=<name>] [--json]', 'Inspect scoped workspace temp inventory or build a bounded maintenance plan; prune remains a compatibility alias.'],
      uninstall: ['devcodex uninstall [--dry-run|--apply] [--json] [--home <dir>]', 'Preview or explicitly remove receipt-owned user-global host artifacts. After --apply succeeds, run `npm uninstall -g devcodex`.'],
      'global-adapters': ['devcodex global-adapters apply [--dry-run] [--json] | devcodex global-adapters remove [--dry-run|--apply] [--json]', 'Advanced: refresh or safely remove user-global host adapters from the current package root.'],
      grok: ['devcodex grok [Grok CLI options]', 'Launch Grok with the user-global DevCodex kernel.'],
      'migrate-layout': ['devcodex migrate-layout plan|apply|rollback', 'Advanced: manage centralized workspace layout migration.'],
      probe: ['devcodex probe <id> [--json]', 'Advanced: run bounded local-only diagnostics.'],
      trace: ['devcodex trace show|replay [options]', 'Advanced: inspect or replay LocalTaskTrace evidence.'],
      skill: ['devcodex skill plan|resolve [options]', 'Advanced: inspect Skill resolution; ordinary users do not configure built-in Skills.'],
      task: ['devcodex task resolve|verify|risk [options]', 'Advanced: inspect task identity, reconciliation or explicit risk decisions.']
    }[topic]
    if (topic && detail) {
      console.log(`
    ${c.bold(`DevCodex ${topic} help`)}

    ${c.bold('Usage:')}
      ${detail[0]}

    ${detail[1]}

    Run ${c.cyan('devcodex help')} for the command overview.
    User guide: https://devcodex-labs.github.io/devcodex/
  `)
      return
    }
    console.log(`
    ${c.bold('DevCodex')} — cross-host AI coding engineering harness for Codex, Claude Code, GitHub Copilot, Gemini CLI, Grok & Cursor

    ${c.bold('Usage:')}
      devcodex <command> [options]
      npx devcodex <command> [options]   ${c.dim('(without npm link)')}

    ${c.bold('Everyday commands:')}
      ${c.cyan('init')}              Initialize workspace-owned .devcodex runtime state only
      ${c.cyan('update')}            Refresh workspace-owned .devcodex runtime state only
      ${c.cyan('status')}            Check workspace and host adapter readiness
      ${c.cyan('doctor')}            Diagnose installation or workflow problems
      ${c.cyan('runtime status')}    Inspect runtime-state plus TaskRecovery V5/legacy disk usage
      ${c.cyan('runtime doctor')}    Diagnose TaskRecovery slots, reserve, capacity and legacy-writer activity
      ${c.cyan('runtime maintenance')} Preview bounded V5/runtime-generation batches; resume by cursor, apply by manifest digest; legacy stays read-only
      ${c.cyan('runtime prune')}     Preview safe stale-temp cleanup; add --apply to remove
      ${c.cyan('tmp status')}        Inspect project/partition temp inventory, completeness and pagination
      ${c.cyan('tmp maintain')}      Build a quota-bound plan; apply requires one explicit complete scope
      ${c.cyan('uninstall')}         Preview managed six-host cleanup; add --apply before npm uninstall
      ${c.cyan('profile init|plan')} Generate tiered Profile drafts or preview actions without writing
      ${c.cyan('help <command>')}    Show read-only help for one command

    ${c.bold('Advanced commands:')}
      ${c.cyan('global-adapters')}   Apply or safely remove user-level host adapters
      ${c.cyan('grok')}              Launch Grok with the user-global DevCodex kernel
      ${c.cyan('migrate-layout')}    Plan/apply/rollback centralized .devcodex workspace layout
      ${c.cyan('probe')}             Run bounded local-only diagnostics; accepts IDs and --json
      ${c.cyan('trace show|replay')} Read LocalTaskTrace; trace show --completion reads receipt identities
      ${c.cyan('skill plan')}        Plan a dependency-closed whole-SKILL bundle; add --json for BundleDecisionV2
      ${c.cyan('skill resolve')}     Resolve skill ids W>G (workspace skills vs global); --json
      ${c.cyan('task resolve')}      Resolve an active task by exact name, alias, project, or stable taskId
      ${c.cyan('task verify')}       Reconcile one task; exact --task or unique-active fallback
      ${c.cyan('task risk')}         Accept/revoke explicit, candidate-bound waivable risk

    ${c.bold('Options:')}
      ${c.dim('--force,  -f')}       Overwrite existing files
      ${c.dim('--dry-run')}          Preview what would be installed without writing files
      ${c.dim('--prod')}             (profile init only) Set mode=prod instead of dev
      ${c.dim('--tier <tier>')}      (profile init only) profile-lite | profile-standard | profile-closed-loop
      ${c.dim('--allow-downgrade')}  (profile init only) Explicitly allow a lower tier; files are retained
      ${c.dim('--json')}             Emit one DevCodexCliEnvelopeV1 document for supported commands

    ${c.bold('First use:')}
      npm install -g devcodex
      cd <your-project-or-workspace>
      devcodex init
      devcodex status

    ${c.bold('Update / uninstall:')}
      npm update -g devcodex
      devcodex uninstall --dry-run  →  --apply  →  npm uninstall -g devcodex

    Every command supports ${c.cyan('<command> --help')} and ${c.cyan('help <command>')} without writing files.
    User guide: https://devcodex-labs.github.io/devcodex/
  `)
  }

  function collectHookCommands(config) {
    const commands = []
    function visit(value) {
      if (Array.isArray(value)) {
        for (const item of value) visit(item)
        return
      }
      if (!value || typeof value !== 'object') return
      if (typeof value.command === 'string') commands.push(value.command)
      for (const [key, child] of Object.entries(value)) {
        if (key !== 'command') visit(child)
      }
    }
    visit(config?.hooks || config)
    return commands
  }

  function readCodexHookCommands(cwd) {
    const file = path.join(cwd, '.codex', 'hooks.json')
    const result = {
      file,
      exists: fs.existsSync(file),
      commands: [],
      invalidCommands: [],
      error: null,
    }
    if (!result.exists) return result

    try {
      const config = JSON.parse(fs.readFileSync(file, 'utf8'))
      result.commands = collectHookCommands(config)
      result.invalidCommands = result.commands.filter(command => command !== CODEX_HOOK_COMMAND)
    } catch (err) {
      result.error = String(err && err.message ? err.message : err)
    }
    return result
  }

  function formatGovernanceSummary(summary) {
    if (!summary || summary.schemaVersion !== 'GovernanceStatusSummaryV1') return c.dim('unavailable')
    const status = summary.status === 'pass' ? c.green('pass') : c.yellow(summary.status || 'warn')
    const runtime = summary.runtimeState || {}
    const skills = summary.skills || {}
    const gates = summary.gateLifecycle || {}
    const alwaysOn = summary.alwaysOn || {}
    const dirty = summary.dirtyBoundary || {}
    return `${status} ` +
      c.dim(`runtime ${runtime.recordCount || 0} records/${runtime.alertCount || 0} alerts; `) +
      c.dim(`skills ${skills.skillCount || 0} (${skills.activeSkillCount || 0} active/${skills.graySkillCount || 0} gray); `) +
      c.dim(`always-on ${alwaysOn.shadow?.sampleCount || 0}/${alwaysOn.shadow?.p0MissedCount || 0} shadow; `) +
      c.dim(`gates ${gates.groupCount || 0}; fast-path ${summary.fastPathPolicy?.visibleMode || 'full'}; git ${dirty.status || 'unknown'}`)
  }

  return { cmdStatus, cmdProfileInit, cmdDoctor, cmdHelp }
}

module.exports = {
  buildCliMaintenanceCommands,
  buildGlobalHostComparison,
  buildScopedHostParity,
  isSourceCandidateMismatch
}
