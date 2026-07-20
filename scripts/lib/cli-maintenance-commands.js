'use strict'

const PACKAGE_JSON = require('../../package.json')
const { createCliFailure, createCliSuccess, parseJsonArgs, printCliJson } = require('./cli-json-contract.js')
const { inspectExecutionOptimization } = require('./execution-optimization.js')
const { evaluateGrokHostParity } = require('./host-parity-scorecard.js')

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

  function parseDiagnosticCommandArgs(command, argv) {
    const options = parseJsonArgs(argv)
    if (!options.errors.length) return options
    const usage = `Use: devcodex ${command} [--json]`
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
    const executionOptimization = inspectExecutionOptimization(cwd)
    const hostParity = evaluateGrokHostParity({
      cwd,
      hostRoot,
      instructionProjection,
      hasAgentsMd: agentsMdInstalled,
      hasCodexLifecycle: codexHookFiles > 0 && codexHookJsonInstalled,
      hasGrokWorkspacePlugin: grokWorkspacePluginInstalled,
      hasGrokPluginRegistration: grokPluginRegistrationCurrent
    })
    return {
      schemaVersion: 'StatusDiagnosticV1',
      cwd,
      hostRoot,
      sourceRepository,
      trackedEntryFiles,
      installSurfaces,
      hostParity,
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
      legacy
    }
  }

  function cmdStatus(argv = []) {
    const options = parseDiagnosticCommandArgs('status', argv)
    if (!options) return
    const facts = collectStatusFacts()
    if (options.json) {
      printCliJson(console, createCliSuccess('status', facts, cliMetadata))
      return facts
    }

    const {
      cwd, hostRoot, sourceRepository: isSrc, trackedEntryFiles: total, installSurfaces,
      entryFiles, profile, executionOptimization, legacy, hostParity
    } = facts
    console.log()
    console.log(c.bold('  DevCodex status') + c.dim(` in ${cwd}`))
    if (path.resolve(hostRoot) !== path.resolve(cwd)) console.log(c.dim(`  Host owner: ${hostRoot}`))
    if (isSrc) console.log(c.yellow('  ⚠️  Source repository detected — showing source repo status'))
    console.log(c.dim('  ──────────────────────────────────────'))
    console.log()

    for (const surface of installSurfaces) {
      const label = surface.installed ? c.green(`${surface.fileCount} files`) : c.red('not installed')
      console.log(`  ${c.cyan(surface.id.padEnd(14))} ${label}`)
    }

    console.log(`  ${c.cyan('RULES.md'.padEnd(14))} ${entryFiles.rulesInstalled ? c.green('installed') : c.red('not installed')}`)
    console.log(`  ${c.cyan('copilot-instr'.padEnd(14))} ${entryFiles.copilotInstructionsInstalled ? c.green('installed') : c.red('not installed')}`)
    console.log(`  ${c.cyan('CLAUDE.md'.padEnd(14))} ${entryFiles.claudeMdInstalled ? c.green('installed') : c.red('not installed')}`)
    console.log(`  ${c.cyan('.claude/hooks'.padEnd(14))} ${entryFiles.claudeHookFiles ? c.green(`${entryFiles.claudeHookFiles} files`) : c.red('not installed')}`)
    console.log(`  ${c.cyan('.claude/skills'.padEnd(14))} ${entryFiles.claudeSkills ? c.green(`${entryFiles.claudeSkills} files`) : c.red('not installed')}`)
    console.log(`  ${c.cyan('AGENTS.md'.padEnd(14))} ${entryFiles.agentsMdInstalled ? c.green('installed') : c.red('not installed')}`)
    console.log(`  ${c.cyan('.agents/skills'.padEnd(14))} ${entryFiles.agentsSkills ? c.green(`${entryFiles.agentsSkills} files`) : c.red('not installed')}`)
    console.log(`  ${c.cyan('.codex/hooks'.padEnd(14))} ${entryFiles.codexHookJsonInstalled && entryFiles.codexHookFiles ? c.green(`${entryFiles.codexHookFiles + 1} files`) : c.red('not installed')}`)
    console.log(`  ${c.cyan('.codex command'.padEnd(14))} ${formatCodexHookCommandStatus(entryFiles.codexHookDiagnostics)}`)
    console.log(`  ${c.cyan('GEMINI.md'.padEnd(14))} ${entryFiles.geminiMdInstalled ? c.green('installed') : c.dim('not installed')}`)
    console.log(`  ${c.cyan('.gemini/hooks'.padEnd(14))} ${entryFiles.geminiSettingsInstalled && entryFiles.geminiHookFiles ? c.green(`${entryFiles.geminiHookFiles + 1} files`) : c.dim('not installed')}`)
    console.log(`  ${c.cyan('Grok adapter'.padEnd(14))} ${entryFiles.grokWorkspacePluginInstalled
      ? (entryFiles.grokPluginRegistrationCurrent ? c.green('workspace plugin registered') : c.yellow('plugin present; registration stale'))
      : (entryFiles.grokHookConfigInstalled && entryFiles.grokHookFiles ? c.green(`${entryFiles.grokHookFiles + 1} project files`) : c.dim('not installed'))}`)
    console.log(`  ${c.cyan('host kernel'.padEnd(14))} ${entryFiles.instructionProjection.status === 'ready'
      ? c.green('ready')
      : (entryFiles.instructionProjection.status === 'not-installed'
          ? c.dim('not installed')
          : c.yellow(`${entryFiles.instructionProjection.issues.length} issue(s)`))}`)
    if (hostParity) {
      console.log(`  ${c.cyan('Grok parity'.padEnd(14))} ${hostParity.hardReady
        ? c.green(`${hostParity.tier} — use: devcodex grok`)
        : c.yellow(`${hostParity.tier} — see doctor --json hostParity.checks`)}`)
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

    for (const item of legacy) {
      const label = item.count > 0 ? c.yellow(`${item.count} files (legacy)`) : c.dim('not installed')
      console.log(`  ${c.cyan(item.label.padEnd(14))} ${label}`)
    }

    console.log()
    if (total === 0) {
      if (isSrc) {
        console.log(`  ${c.dim('No .github/ directory.')} ${c.dim('This is the source repo — use')} ${c.bold('devcodex update')} ${c.dim('from a target project.')}`)
      } else {
        console.log(`  ${c.yellow('Not initialized.')} Run ${c.bold('devcodex init')} to install.`)
      }
    } else {
      console.log(`  ${c.green(`${total} tracked entry files`)} installed across configured Copilot/Claude/Codex/Gemini/Grok surfaces`)
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
    const executionOptimization = inspectExecutionOptimization(cwd)

    let mode = 'instruction-fallback'
    if (platform === 'claude' && hasClaudeHooks) mode = 'hook-enforced (Claude Code)'
    else if (platform === 'codex' && hasCodexHooks) mode = 'hook guardrail (Codex; event-dependent)'
    else if (platform === 'gemini' && hasGeminiHooks) mode = 'hook guardrail (Gemini; PreCompress advisory)'
    else if (platform === 'grok' && hasGrokHooks) mode = 'hook partial (Grok; only PreToolUse blocking)'
    else if (platform === 'vscode-copilot' && hasGithubHooks) mode = 'workspace-hooks detected (VS Code Copilot preview; verify target IDE)'
    else if (platform === 'jetbrains-copilot') mode = 'instruction-fallback (JetBrains — Hooks unsupported)'
    else if (platform === 'unknown' && installedHosts.length > 1) mode = 'mixed install (host unresolved; multiple adapters present)'

    const hostParity = evaluateGrokHostParity({
      cwd,
      hostRoot,
      instructionProjection,
      hasAgentsMd,
      hasCodexLifecycle: hasCodexHooks,
      hasGrokWorkspacePlugin,
      hasGrokPluginRegistration,
      platform
    })

    return {
      schemaVersion: 'DoctorDiagnosticV1',
      cwd,
      hostRoot,
      platform,
      platformSource: platformEvidence.source,
      platformEvidence,
      agent,
      installedHosts,
      mode,
      hostParity,
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
        hasWorkspaceConfig: codexConfigState.hasWorkspaceConfig
      },
      profile: {
        directory: profileDir,
        ...profileState,
        featureInventory: profileState.featureInventory || null
      },
      executionOptimization,
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
    const facts = collectDoctorFacts()
    if (options.json) {
      printCliJson(console, createCliSuccess('doctor', facts, cliMetadata))
      return facts
    }
    const {
      cwd, hostRoot, platformEvidence, platform, agent, installedHosts, mode,
      installArtifacts, codexHookDiagnostics, codexConfigState,
      profile: profileState,
      executionOptimization,
      hostParity
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

    console.log()
    console.log(c.bold('  DevCodex Doctor') + c.dim(` v1.9.7+ — runtime diagnostics`))
    console.log(c.dim('  ──────────────────────────────────────'))
    console.log(`  cwd:             ${cwd}`)
    console.log(`  host owner:      ${hostRoot}`)
    console.log(`  platform:        ${c.cyan(platform)}  ${c.dim(`(${platformEvidence.source})`)}`)
    console.log(`  agent:           ${c.cyan(agent)}`)
    console.log(`  installed hosts: ${installedHosts.length ? c.cyan(installedHosts.join(', ')) : c.dim('none detected')}`)
    console.log(`  mode:            ${c.bold(mode)}`)
    console.log(`  optimization:    ${c.bold(executionOptimization.config.effective)} ${c.dim(`(${executionOptimization.config.status}; state=${executionOptimization.stateStatus})`)}`)
    console.log(c.dim('  enforcement:     default safety-only warns/continues for bootstrap/CP/auto; strict blocks only host-supported events.'))
    if (hostParity) {
      const tierColor = hostParity.hardReady ? c.green : c.yellow
      console.log(`  Grok HostParity: ${tierColor(hostParity.tier)} ${c.dim(`(ref Codex; ${hostParity.hardReady ? 'hard path ready' : 'partial'})`)}`)
      console.log(c.dim(`  ${hostParity.userVisibleSummary}`))
      console.log(c.dim(`  Full session entry: ${hostParity.recommendedEntry}`))
    }
    console.log()
    console.log(c.bold('  Install artifacts:'))
    console.log(`    CLAUDE.md                            ${hasClaudeMd ? c.green('✅') : c.dim('—')}`)
    console.log(`    .claude/hooks/_runtime/lifecycle.cjs ${hasClaudeHooks ? c.green('✅') : c.dim('—')}`)
    console.log(`    AGENTS.md                            ${hasAgentsMd ? c.green('✅') : c.dim('—')}`)
    console.log(`    .agents/skills/                      ${hasAgentsSkills ? c.green('✅') : c.dim('—')}`)
    console.log(`    .codex/hooks.json                    ${hasCodexHooksJson ? c.green('✅') : c.dim('—')}`)
    console.log(`    .codex/hooks/_runtime/lifecycle.cjs  ${hasCodexHooks ? c.green('✅') : c.dim('—')}`)
    console.log(`    .codex hook command                  ${formatCodexHookCommandStatus(codexHookDiagnostics)}`)
    console.log(`    Codex config (user/workspace)        ${codexConfigState.hasUserConfig ? c.green('user') : c.dim('user —')} / ${codexConfigState.hasWorkspaceConfig ? c.green('workspace') : c.dim('workspace —')}`)
    console.log(`    .github/copilot-instructions.md      ${hasCopilotMd ? c.green('✅') : c.dim('—')}`)
    console.log(`    .github/instructions/                ${hasInstructions ? c.green('✅') : c.dim('—')}`)
    console.log(`    .github/hooks/_runtime/lifecycle.cjs ${hasGithubHooks ? c.green('✅') : c.dim('—')}`)
    console.log(`    GEMINI.md                            ${hasGeminiMd ? c.green('✅') : c.dim('—')}`)
    console.log(`    .gemini/settings + hook adapter      ${hasGeminiSettings && hasGeminiHooks ? c.green('✅') : c.dim('—')}`)
    console.log(`    Grok workspace plugin + registration ${hasGrokWorkspacePlugin && hasGrokPluginRegistration
      ? c.green('✅')
      : (hasGrokWorkspacePlugin ? c.yellow('⚠️ plugin present; registration stale') : c.dim('—'))}`)
    console.log(`    host instruction projection          ${instructionProjection.status === 'ready'
      ? c.green('✅ ready')
      : (instructionProjection.status === 'not-installed'
          ? c.dim('not installed')
          : c.yellow(`⚠️ ${instructionProjection.issues.length} issue(s)`))}`)
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
      console.log(c.bold('  JetBrains / instruction-fallback verification checklist (P-004):'))
      console.log('    1. Settings → GitHub Copilot → Custom Instructions → Use Instruction Files: ON')
      console.log('    2. Open `.github/copilot-instructions.md` — confirm Copilot Chat references "DevCodex"')
      console.log('    3. Open any `.github/instructions/*.instructions.md` — verify `applyTo:` glob semantics:')
      console.log('       • Edit a matching file (e.g. `**/*.ts`) → ask Copilot a related question → expect rule cited')
      console.log('       • JetBrains support for `applyTo` is BETA — fallback is always-on injection')
      console.log('    4. CP gate (no Hooks): AI must append `⏸ 等待用户确认（CPN）` to every CP output')
      console.log('    5. Optional: enable `scripts/instruction-fallback-check.js` as git pre-commit hook (CP3 soft-gate)')
      console.log()
    }

    if (platform === 'vscode-copilot' && hasGithubHooks) {
      console.log(c.yellow('  ⚠️  VS Code Copilot hooks detected, but DevCodex treats this as preview/target-version dependent; verify actual IDE hook support before claiming hard enforcement.'))
      console.log()
    }

    if (platform === 'claude' && !hasClaudeHooks) {
      console.log(c.yellow('  ⚠️  Claude Code detected but .claude/hooks/ missing — run `devcodex init --claude`'))
      console.log()
    }
    if (platform === 'codex' && !hasCodexHooks) {
      console.log(c.yellow(`  ⚠️  Codex detected but .codex hooks are missing — run \`devcodex init --codex\``))
      console.log(c.dim(`      Expected hook command: ${CODEX_HOOK_COMMAND}`))
      console.log()
    }
    if (platform === 'gemini' && !hasGeminiHooks) {
      console.log(c.yellow('  ⚠️  Gemini CLI detected but project adapter is missing — run `devcodex init --host gemini`'))
      console.log()
    }
    if (platform === 'grok' && !hasGrokHooks) {
      console.log(c.yellow('  ⚠️  Grok detected but its resolved adapter is missing — run `devcodex init --host grok` from the current scope'))
      console.log()
    }
    if (hostParity && !hostParity.hardReady) {
      console.log(c.bold('  Grok HostParity checks:'))
      for (const [key, ok] of Object.entries(hostParity.checks || {})) {
        console.log(`    ${key.padEnd(28)} ${ok ? c.green('✅') : c.red('❌')}`)
      }
      console.log(c.dim('  Cannot claim: ' + (hostParity.cannotClaim || []).slice(0, 2).join('; ')))
      console.log()
    } else if (hostParity && hostParity.hardReady) {
      console.log(c.dim('  Grok HostParity: PreTool deny + path-observable ready. Still cannot claim UserPromptSubmit inject or Stop hard-block.'))
      console.log(c.dim('  Prefer `devcodex grok` in child Git projects for Full kernel evidence.'))
      console.log()
    }
    if (instructionProjection.issues.length) {
      for (const issue of instructionProjection.issues) console.log(c.yellow(`  ⚠️  ${issue.code}`))
      console.log(c.dim('      Run `devcodex update --host <host>` and use the full fallback until projection is ready.'))
      console.log()
    }
    if (hasCodexHooksJson) {
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
      console.log(c.dim('  Codex hook guardrail: blocking behavior is event-dependent; MCP is supported by Codex but DevCodex does not auto-write Codex MCP config.'))
      console.log(c.dim('  Config presence only is shown above; DevCodex does not read or write Codex config values.'))
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
      ${c.cyan('init')}              Install Copilot files, then deploy Claude Code and Codex adapters
      ${c.cyan('init --claude')}     Install Claude Code adapter only
      ${c.cyan('init --codex')}      Install Codex adapter only
      ${c.cyan('init --host <id>')}  Install copilot|claude|codex|gemini|grok|all
      ${c.cyan('update')}            Overwrite Copilot files, then deploy Claude Code and Codex adapters
      ${c.cyan('update --claude')}   Overwrite Claude Code adapter only
      ${c.cyan('update --codex')}    Overwrite Codex adapter only
      ${c.cyan('update --host <id>')} Refresh one host or all five hosts
      ${c.cyan('uninstall --host grok')} Remove the Grok user registration; retain workspace source
      ${c.cyan('grok')}              Launch Grok with workspace kernel binding when cwd is a child Git project
      ${c.cyan('migrate-layout')}    Plan/apply/rollback centralized .devcodex workspace layout
      ${c.cyan('profile init')}      Auto-generate tiered .devcodex/profile/ drafts
      ${c.cyan('profile plan')}      Preview Profile root/tier/file actions without writing
      ${c.cyan('status')}            Show installed files; add --json for StatusDiagnosticV1
      ${c.cyan('doctor')}            Diagnose host/agent/mode; add --json for DoctorDiagnosticV1
      ${c.cyan('probe')}             Run bounded local-only diagnostics; accepts IDs and --json
      ${c.cyan('trace show|replay')} Read/validate the current LocalTaskTrace; never executes payloads
      ${c.cyan('skill plan')}        Plan a dependency-closed whole-SKILL bundle; add --json for BundleDecisionV2
      ${c.cyan('task resolve')}      Resolve an active task by exact name, alias, project, or stable taskId

    ${c.bold('Options:')}
      ${c.dim('--force,  -f')}       Overwrite existing files
      ${c.dim('--dry-run')}          Preview what would be installed without writing files
      ${c.dim('--claude')}           Only target Claude Code adapter (skip Copilot .github/)
      ${c.dim('--codex')}            Only target Codex adapter (skip Copilot .github/ and Claude Code)
      ${c.dim('--gemini')}           Alias for --host gemini
      ${c.dim('--grok')}             Alias for --host grok
      ${c.dim('--host <id>')}        copilot | claude | codex | gemini | grok | all
      ${c.dim('--prod')}             (profile init only) Set mode=prod instead of dev
      ${c.dim('--tier <tier>')}      (profile init only) profile-lite | profile-standard | profile-closed-loop
      ${c.dim('--allow-downgrade')}  (profile init only) Explicitly allow a lower tier; files are retained
      ${c.dim('--json')}             Emit one DevCodexCliEnvelopeV1 document for supported commands

    ${c.bold('Examples:')}
      devcodex init                 # First-time three-host install
      devcodex init --claude        # Claude Code adapter only
      devcodex init --codex         # Codex adapter only
      devcodex init --host gemini   # Gemini CLI adapter only
      devcodex init --host grok     # Grok Build adapter only
      devcodex update --host all    # Refresh all five host adapters
      devcodex uninstall --host grok --dry-run # Preview safe Grok deregistration
      devcodex grok                 # Full-evidence Grok launcher for workspace child projects
      devcodex grok -p "Review this diff" --output-format json
      devcodex migrate-layout plan  # Generate centralized layout migration manifest
      devcodex profile init --tier profile-standard  # Generate tiered Profile drafts
      devcodex profile plan --tier profile-closed-loop # Preview a safe upgrade
      devcodex update               # Refresh Copilot + Claude Code + Codex adapters
      devcodex update --claude      # Refresh Claude Code adapter only
      devcodex update --codex       # Refresh Codex adapter only
      devcodex status               # Check installation
      devcodex skill plan intent load-profile --max-bytes 32768 --json
      devcodex task resolve "my task" --json # Resolve without loading unrelated task bodies
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

  return { cmdStatus, cmdProfileInit, cmdDoctor, cmdHelp }
}

module.exports = { buildCliMaintenanceCommands }
