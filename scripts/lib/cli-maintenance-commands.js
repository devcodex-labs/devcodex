'use strict'

const PACKAGE_JSON = require('../../package.json')
const { createCliFailure, createCliSuccess, parseJsonArgs, printCliJson } = require('./cli-json-contract.js')
const { inspectExecutionOptimization } = require('./execution-optimization.js')
const { buildGovernanceStatusSummary } = require('./governance-status-summary.js')
const { evaluateGrokHostParity } = require('./host-parity-scorecard.js')
const { readCompletionForCli } = require('./cli-execution-commands.js')
const { inspectGlobalHostConfig } = require('./global-host-config.js')

const SOURCE_CANDIDATE_COMPARISON_ISSUES = new Set([
  'GLOBAL_HOST_RECEIPT_STALE',
  'GLOBAL_HOST_MANAGED_CONFIG_DRIFT'
])

function isSourceCandidateMismatch(host, sourceRepository) {
  const issues = Array.isArray(host?.configurationIssues) ? host.configurationIssues : []
  return sourceRepository === true &&
    host?.configured === true &&
    issues.length > 0 &&
    issues.every(issue => SOURCE_CANDIDATE_COMPARISON_ISSUES.has(issue.code))
}

function buildGlobalHostComparison(sourceRepository, globalHostConfig) {
  const hosts = Array.isArray(globalHostConfig?.hosts) ? globalHostConfig.hosts : []
  const candidateMismatchHosts = hosts
    .filter(host => isSourceCandidateMismatch(host, sourceRepository))
    .map(host => host.host)
  const mismatchSet = new Set(candidateMismatchHosts)
  return {
    schemaVersion: 'GlobalHostDiagnosticScopeV1',
    scope: sourceRepository
      ? 'source-candidate-vs-installed-receipts'
      : 'installed-package-vs-user-global-receipts',
    installedHealthClaim: sourceRepository !== true,
    candidateMismatchHosts,
    adapterIssueHosts: hosts
      .filter(host => host.adapterReady !== true && !mismatchSet.has(host.host))
      .map(host => host.host)
  }
}

function buildScopedHostParity(hostParity, globalHostComparison) {
  const scoped = {
    ...hostParity,
    diagnosticScope: globalHostComparison.scope,
    installedHealthClaim: globalHostComparison.installedHealthClaim
  }
  if (globalHostComparison.installedHealthClaim !== false) return scoped

  return {
    ...scoped,
    sourceCandidateOnly: true,
    hardReady: false,
    tier: 'source-candidate-comparison',
    checks: {},
    failedChecks: [],
    repairSteps: [],
    withheldChecks: hostParity?.checks || {},
    withheldFailedChecks: Array.isArray(hostParity?.failedChecks) ? hostParity.failedChecks : [],
    withheldRepairSteps: Array.isArray(hostParity?.repairSteps) ? hostParity.repairSteps : [],
    userVisibleSummary: 'Source candidate comparison only; installed Grok HostParity health is unverified.',
    recommendedEntry: 'devcodex global-adapters apply --dry-run && devcodex global-adapters apply',
    cannotClaim: [
      'Installed Grok HostParity health is unverified in source-candidate scope.',
      ...(Array.isArray(hostParity?.cannotClaim) ? hostParity.cannotClaim : [])
    ]
  }
}

function buildCliMaintenanceCommands(ctx) {
  const {
    fs, os, path, process, console, c, SOURCES, CODEX_HOOK_COMMAND,
    walkDir, isSourceRepo, resolveActiveRuntimeRoot, resolveProfileDir, getLegacyCounts,
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

  function formatGlobalHostRuntimeState(host, options = {}) {
    const state = host.operationalState || (host.ready ? 'ready' : 'unavailable')
    const details = [
      `configured=${host.configured === true ? 'yes' : 'no'}`,
      `adapter=${host.adapterReady === true ? 'ready' : 'not-ready'}`,
      `contract=${host.contractStatus || 'unverified'}`,
      `native=${host.nativeStatus || 'unverified'}`
    ].join('; ')
    const prefix = options.icon ? `${state === 'ready' ? '✅' : '⚠️'} ` : ''
    const label = `${prefix}${state} (${details})`
    if (state === 'ready') return c.green(label)
    if (state === 'failed') return c.red(label)
    return c.yellow(label)
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
    return {
      schemaVersion: 'StatusDiagnosticV1',
      cwd,
      hostRoot,
      sourceRepository,
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
      governanceSummary,
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
      globalHostComparison, legacy, hostParity
    } = facts
    console.log()
    console.log(c.bold('  DevCodex status') + c.dim(` in ${cwd}`))
    if (path.resolve(hostRoot) !== path.resolve(cwd)) console.log(c.dim(`  Host owner: ${hostRoot}`))
    if (isSrc) {
      console.log(c.yellow('  ⚠️  Source repository detected — comparing this candidate checkout with installed receipts; this is not an installed-package health claim'))
    }
    console.log(c.dim('  ──────────────────────────────────────'))
    console.log()

    console.log(c.bold(`  User-global host adapters${isSrc ? ' (source candidate comparison)' : ''}:`))
    for (const host of globalHostConfig.hosts) {
      const state = globalHostComparison.candidateMismatchHosts.includes(host.host)
        ? c.yellow('candidate differs from installed receipt; installed health unverified')
        : formatGlobalHostRuntimeState(host)
      console.log(`  ${c.cyan(host.host.padEnd(14))} ${state}`)
    }
    console.log()
    console.log()
    console.log(c.bold('  Workspace state:'))
    console.log(`  ${c.cyan('.devcodex'.padEnd(14))} ${fs.existsSync(path.join(hostRoot, '.devcodex')) ? c.green('present') : c.dim('not initialized')}`)
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
    else profileLabel = c.red(`missing   (${profileDetails} — run: devcodex profile plan)`)
    console.log(`  ${c.cyan('profile'.padEnd(14))} ${profileLabel}`)
    console.log(`  ${c.cyan('optimization'.padEnd(14))} ${executionOptimization.config.effective} (${executionOptimization.stateStatus}; ${executionOptimization.features.filter(item => item.decision.optimizationAllowed).length}/${executionOptimization.features.length} accelerated)`)
    console.log(`  ${c.cyan('governance'.padEnd(14))} ${formatGovernanceSummary(governanceSummary)}`)
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
      if (isSrc) {
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

  function cmdProfileInit(argv) {
    const options = parseProfileInitArgs(argv)
    if (options.errors.length) {
      printProfileArgErrors(options.errors)
      return { ok: false, reason: 'invalid-arguments' }
    }
    const cwd = process.cwd()
    const dir = path.join(resolveActiveRuntimeRoot(cwd), 'profile')
    const ctx = buildProfileContext(cwd)
    let detectedTier
    try {
      detectedTier = readDetectedTier(dir)
    } catch (error) {
      printProfileArgErrors([`invalid existing Profile tier: ${error.message}`])
      return { ok: false, reason: 'invalid-existing-tier' }
    }
    const recommendation = recommendProfileTier(ctx)
    const tier = options.requestedTier || detectedTier || 'profile-lite'
    if (detectedTier && compareProfileTiers(tier, detectedTier) < 0 && !options.allowDowngrade) {
      printProfileArgErrors([`refusing profile downgrade: ${detectedTier} → ${tier}; add --allow-downgrade to confirm`])
      return { ok: false, reason: 'downgrade-not-authorized' }
    }
    const mode = options.prod ? 'prod' : 'dev'
    console.log()
    console.log(c.bold(`  DevCodex profile ${options.dryRun ? 'plan' : 'init'}`) + c.dim(` (${tier}) in ${cwd}`))
    console.log(c.dim('  ──────────────────────────────────────'))
    const agent = detectAgent(cwd)
    console.log(`  target root:      ${dir}`)
    console.log(`  detected tier:    ${detectedTier || '(none)'}`)
    console.log(`  requested tier:   ${options.tierExplicit ? tier : '(not explicit)'}`)
    console.log(`  recommended tier: ${recommendation.tier}`)
    for (const reason of recommendation.reasons) console.log(c.dim(`    - ${reason}`))
    console.log(`  target tier:      ${tier}`)
    console.log(`  mode:             ${mode}`)
    if (options.dryRun) console.log(c.yellow('  dry-run:          no directories, files or backups will be written'))
    console.log()

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
        console.log(`  ${c.cyan('[tier]')} ${file} ${c.dim(`(${detectedTier} → ${tier}; preserve body)`)}`)
        continue
      }
      if (exists && !options.force) {
        actions.push({ file, action: 'skip', dest })
        console.log(`  ${c.dim('[skip]')}  ${file} ${c.dim('(existing)')}`)
        skipped++
        continue
      }
      actions.push({ file, action: exists ? 'backup-and-generate' : 'generate', dest })
      console.log(`  ${exists ? c.yellow('[force]') : c.green('[gen]')} ${file}${exists ? c.dim(' (backup first)') : ''}`)
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

    console.log()
    const plannedTierUpdates = actions.filter(item => item.action === 'update-tier').length
    console.log(`  ${options.dryRun ? 'Planned generate' : 'Generated'}: ${generated}  Skipped: ${skipped}  Tier updates: ${plannedTierUpdates}  Backed up: ${backedUp}`)
    if (generated > 0 || plannedTierUpdates > 0) console.log(c.yellow('  ⚠️  Generated content is an evidence-backed draft; review every unverified field before relying on it.'))
    if (!options.tierExplicit && recommendation.tier !== tier) {
      console.log(c.yellow(`  Recommendation: run \`devcodex profile plan --tier ${recommendation.tier}\` before upgrading.`))
    }
    console.log()
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
    else if (['copilot', 'claude', 'codex', 'gemini', 'grok'].includes(platform) && globalAdapterReady(platform)) {
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
    return {
      schemaVersion: 'DoctorDiagnosticV1',
      cwd,
      hostRoot,
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
      governanceSummary,
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
      hostParity, globalHostConfig, globalHostComparison, sourceRepository, completion
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
    const missingAdapters = globalHostConfig.hosts
      .filter(host => !host.adapterReady && !sourceCandidateMismatchSet.has(host.host))
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
    console.log(`  mode:            ${c.bold(mode)}`)
    console.log(`  optimization:    ${c.bold(executionOptimization.config.effective)} ${c.dim(`(${executionOptimization.config.status}; state=${executionOptimization.stateStatus})`)}`)
    console.log(`  governance:      ${formatGovernanceSummary(governanceSummary)}`)
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
    console.log()
    console.log(c.bold('  User-global host adapters:'))
    for (const host of globalHostConfig.hosts) {
      const state = sourceCandidateMismatchSet.has(host.host)
        ? c.yellow('⚠️ candidate differs from installed receipt; installed health unverified')
        : formatGlobalHostRuntimeState(host, { icon: true })
      console.log(`    ${host.host.padEnd(10)} ${state}`)
    }
    if (missingAdapters.length) {
      console.log(c.yellow(`    Missing adapters: ${missingAdapters.map(host => host.host).join(', ')}. Repair with \`npm install -g devcodex\`.`))
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
    if (nativeNotReady.length) {
      console.log(c.dim(`    Native host CLIs not operationally ready: ${nativeNotReady.map(host => host.host).join(', ')}. Install or repair those CLIs, then rerun \`devcodex doctor\`.`))
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
          : c.yellow(`⚠️  incomplete ${profileState.tier} — run \`devcodex profile init --tier ${profileState.tier}\``))
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
      console.log(c.dim('  Grok HostParity: PreTool deny + path-observable ready. Still cannot claim UserPromptSubmit inject or Stop hard-block.'))
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

  function cmdHelp() {
    console.log(`
    ${c.bold('DevCodex')} — AI-powered development workflow rules for Copilot, Claude, Codex, Gemini & Grok

    ${c.bold('Usage:')}
      devcodex <command> [options]
      npx @vextjs/devcodex <command> [options]   ${c.dim('(without npm link)')}

    ${c.bold('Commands:')}
      ${c.cyan('init')}              Initialize workspace-owned .devcodex runtime state only
      ${c.cyan('update')}            Refresh workspace-owned .devcodex runtime state only
      ${c.cyan('global-adapters')}   Apply user-level host adapters from package root (source-friendly)
      ${c.cyan('grok')}              Launch Grok with the user-global DevCodex kernel
      ${c.cyan('migrate-layout')}    Plan/apply/rollback centralized .devcodex workspace layout
      ${c.cyan('profile init')}      Auto-generate tiered .devcodex/profile/ drafts
      ${c.cyan('profile plan')}      Preview Profile root/tier/file actions without writing
      ${c.cyan('status')}            Show installed files; add --completion for workflow state
      ${c.cyan('doctor')}            Diagnose host/agent/mode; add --completion for blockers/actions
      ${c.cyan('probe')}             Run bounded local-only diagnostics; accepts IDs and --json
      ${c.cyan('trace show|replay')} Read LocalTaskTrace; trace show --completion reads receipt identities
      ${c.cyan('skill plan')}        Plan a dependency-closed whole-SKILL bundle; add --json for BundleDecisionV2
      ${c.cyan('skill resolve')}     Resolve skill ids W>G (workspace skills vs global); --json
      ${c.cyan('skill match')}       Auto-match user prompt to workspace skill (P0.5 closed loop); --json
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

    ${c.bold('Examples:')}
      devcodex global-adapters apply --dry-run  # R1a: plan user-global adapters from source tree
      devcodex global-adapters apply            # R1a: refresh user-global adapters without pack/publish
      npm install -g .                          # R1b: local global install postinstall refresh
      npm pack && npm install -g ./vextjs-devcodex-*.tgz  # R2: pre-release tarball
      npm install -g devcodex                   # R3: published install + postinstall adapters
      npm update -g devcodex                    # R3: published upgrade + postinstall refresh
      npm install devcodex                      # Dependency only; prints the required -g guidance
      devcodex init                             # R4: initialize only this workspace .devcodex
      devcodex update                           # R4: refresh only this workspace .devcodex
      devcodex grok                             # Full-evidence Grok launcher using the global kernel
      devcodex grok -p "Review this diff" --output-format json
      devcodex migrate-layout plan              # Generate centralized layout migration manifest
      devcodex profile init --tier profile-standard  # Generate tiered Profile drafts
      devcodex profile plan --tier profile-closed-loop # Preview a safe upgrade
      devcodex status                           # Check installation
      devcodex skill plan intent load-profile --max-bytes 32768 --json
      devcodex skill resolve my-ws-skill --json
      devcodex task resolve "my task" --json    # Resolve without loading unrelated task bodies
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

  function formatCodexHookCommandStatus(diagnostics) {
    if (!diagnostics.exists) return c.red('not installed')
    if (diagnostics.error) return c.red('invalid JSON')
    if (!diagnostics.commands.length) return c.red('missing command')
    if (diagnostics.invalidCommands.length) return c.yellow(`invalid (${diagnostics.invalidCommands.length}/${diagnostics.commands.length})`)
    return c.green('expected')
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
