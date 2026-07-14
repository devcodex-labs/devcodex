'use strict'

function buildCliMaintenanceCommands(ctx) {
  const {
    fs, os, path, process, console, c, SOURCES, CODEX_HOOK_COMMAND,
    walkDir, isSourceRepo, resolveActiveRuntimeRoot, resolveProfileDir, getLegacyCounts,
    getCodexConfigState, inspectProfileState,
    detectProfileTier, inspectProfileContract, normalizeProfileTier,
    filesForProfileTier, readJsonSafe, safeFirstLine, detectArch, listTopDirs,
    detectStyle, genProfileReadme, genProjectInfo, genArchitecture, genStyle,
    genTestSpec, genReleaseSpec, genFeatureInventory, genUserContractSpec,
    genConfigJson, detectAgent, detectHostPlatform, detectInstalledHostAssets
  } = ctx

  function cmdStatus() {
    const cwd = process.cwd()
    const ghDir = path.join(cwd, '.github')
    const isSrc = isSourceRepo(cwd)
    console.log()
    console.log(c.bold('  DevCodex status') + c.dim(` in ${cwd}`))
    if (isSrc) console.log(c.yellow('  ⚠️  Source repository detected — showing source repo status'))
    console.log(c.dim('  ──────────────────────────────────────'))
    console.log()

    let total = 0
    for (const { to } of SOURCES) {
      const files = walkDir(path.join(ghDir, to))
      total += files.length
      const label = files.length > 0 ? c.green(`${files.length} files`) : c.red('not installed')
      console.log(`  ${c.cyan(to.padEnd(14))} ${label}`)
    }

    // Check RULES.md
    const rulesInstalled = fs.existsSync(path.join(ghDir, 'RULES.md'))
    if (rulesInstalled) total++
    console.log(`  ${c.cyan('RULES.md'.padEnd(14))} ${rulesInstalled ? c.green('installed') : c.red('not installed')}`)

    // Check copilot-instructions.md
    const ciInstalled = fs.existsSync(path.join(ghDir, 'copilot-instructions.md'))
    if (ciInstalled) total++
    console.log(`  ${c.cyan('copilot-instr'.padEnd(14))} ${ciInstalled ? c.green('installed') : c.red('not installed')}`)

    // Check Claude Code adapter
    const claudeMdInstalled = fs.existsSync(path.join(cwd, 'CLAUDE.md'))
    const claudeHookFiles = walkDir(path.join(cwd, '.claude', 'hooks', '_runtime')).length
    const claudeSkills = walkDir(path.join(cwd, '.claude', 'skills')).length
    if (claudeMdInstalled) total++
    console.log(`  ${c.cyan('CLAUDE.md'.padEnd(14))} ${claudeMdInstalled ? c.green('installed') : c.red('not installed')}`)
    console.log(`  ${c.cyan('.claude/hooks'.padEnd(14))} ${claudeHookFiles ? c.green(`${claudeHookFiles} files`) : c.red('not installed')}`)
    console.log(`  ${c.cyan('.claude/skills'.padEnd(14))} ${claudeSkills ? c.green(`${claudeSkills} files`) : c.red('not installed')}`)

    // Check Codex adapter
    const agentsMdInstalled = fs.existsSync(path.join(cwd, 'AGENTS.md'))
    const codexHookJsonInstalled = fs.existsSync(path.join(cwd, '.codex', 'hooks.json'))
    const codexHookFiles = walkDir(path.join(cwd, '.codex', 'hooks', '_runtime')).length
    const codexHookDiagnostics = readCodexHookCommands(cwd)
    const agentsSkills = walkDir(path.join(cwd, '.agents', 'skills')).length
    if (agentsMdInstalled) total++
    if (codexHookJsonInstalled) total++
    console.log(`  ${c.cyan('AGENTS.md'.padEnd(14))} ${agentsMdInstalled ? c.green('installed') : c.red('not installed')}`)
    console.log(`  ${c.cyan('.agents/skills'.padEnd(14))} ${agentsSkills ? c.green(`${agentsSkills} files`) : c.red('not installed')}`)
    console.log(`  ${c.cyan('.codex/hooks'.padEnd(14))} ${codexHookJsonInstalled && codexHookFiles ? c.green(`${codexHookFiles + 1} files`) : c.red('not installed')}`)
    console.log(`  ${c.cyan('.codex command'.padEnd(14))} ${formatCodexHookCommandStatus(codexHookDiagnostics)}`)

    // Check profile state (legacy project root or workspace-namespace active root)
    const profileDir = resolveProfileDir(cwd)
    const profileState = inspectProfileState(profileDir)
    let profileLabel
    if (profileState.error) profileLabel = c.red(`invalid   (${profileState.error})`)
    else if (profileState.complete) profileLabel = c.green(`complete  (${profileState.tier}; ${profileState.present}/${profileState.total} required files)`)
    else if (profileState.present > 0) profileLabel = c.yellow(`partial   (${profileState.tier}; ${profileState.present}/${profileState.total} required files)`)
    else profileLabel = c.red(`missing   (0/${profileState.total} required files — run: devcodex profile init)`)
    console.log(`  ${c.cyan('profile'.padEnd(14))} ${profileLabel}`)

    const legacyCounts = getLegacyCounts(ghDir)
    for (const item of legacyCounts) {
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
      console.log(`  ${c.green(`${total} tracked entry files`)} installed across .github/ / .claude/ / Codex adapter`)
      if (isSrc) {
        console.log(c.dim('  (Source repo: these are development copies, not a target project installation)'))
      }
    }
    const legacyPresent = legacyCounts.some(item => item.count > 0)
    if (legacyPresent) {
      console.log(c.yellow('  ⚠️  Legacy custom agent files detected. They are no longer part of the default installation set.'))
    }
    console.log()
  }

  function cmdProfileInit(argv) {
    const force = argv.includes('--force') || argv.includes('-f')
    const prod = argv.includes('--prod')
    const tierFlag = argv.find(arg => arg.startsWith('--tier='))
    const tierIndex = argv.indexOf('--tier')
    const tierValue = tierFlag ? tierFlag.slice('--tier='.length) : (tierIndex >= 0 ? argv[tierIndex + 1] : 'profile-lite')
    const tier = normalizeProfileTier(tierValue, '')
    const mode = prod ? 'prod' : 'dev'
    const cwd = process.cwd()
    const dir = path.join(resolveActiveRuntimeRoot(cwd), 'profile')
    console.log()
    console.log(c.bold('  DevCodex profile init') + c.dim(` (${tier}) in ${cwd}`))
    console.log(c.dim('  ──────────────────────────────────────'))

    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    // Build context once
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
    const agent = detectAgent(cwd)
    const ctx = { pkg, branch, changelogTop, arch, tree, style, hasServices }

    const generators = {
      'README.md': () => genProfileReadme(tier),
      '01-项目信息.md': () => genProjectInfo(ctx),
      '02-架构约束.md': () => genArchitecture(ctx),
      '03-代码风格.md': () => genStyle(ctx),
      '04-测试规范.md': () => genTestSpec(ctx),
      '05-发布规范.md': () => genReleaseSpec(ctx),
      '06-功能清单.md': () => genFeatureInventory(ctx),
      '07-用户文档与契约规范.md': () => genUserContractSpec(ctx),
      'config.json': () => genConfigJson(agent, mode),
    }

    let generated = 0, skipped = 0, backedUp = 0
    for (const file of filesForProfileTier(tier)) {
      const dest = path.join(dir, file)
      const exists = fs.existsSync(dest)
      if (exists && !force) {
        console.log(`  ${c.dim('[skip]')}  ${file} ${c.dim('(existing)')}`)
        skipped++
        continue
      }
      if (exists && force) {
        const ts = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)
        const bak = `${dest}.bak.${ts}`
        fs.copyFileSync(dest, bak)
        backedUp++
      }
      fs.writeFileSync(dest, generators[file](), 'utf-8')
      console.log(`  ${c.green('[gen]')}   ${file}`)
      generated++
    }

    console.log()
    console.log(`  ${c.green(`Generated: ${generated}`)}  ${c.dim(`Skipped: ${skipped}`)}  ${c.dim(`Backed up: ${backedUp}`)}`)
    if (generated > 0) console.log(c.yellow('  ⚠️  These are AUTO-GENERATED DRAFTS — review and refine before relying on them.'))
    console.log()
  }

  function cmdDoctor() {
    // v1.9.7+ P-001/P-004: runtime diagnostic for host detection & JetBrains verification
    const cwd = process.cwd()
    const env = process.env
    const platformEvidence = detectHostPlatform(env, cwd)
    const platform = platformEvidence.platform
    const agent = detectAgent(cwd)
    const installedHosts = detectInstalledHostAssets(cwd)

    const hasGithubHooks = fs.existsSync(path.join(cwd, '.github', 'hooks', '_runtime', 'lifecycle.cjs'))
    const hasClaudeHooks = fs.existsSync(path.join(cwd, '.claude', 'hooks', '_runtime', 'lifecycle.cjs'))
    const hasCodexHooksJson = fs.existsSync(path.join(cwd, '.codex', 'hooks.json'))
    const hasCodexHooks = hasCodexHooksJson && fs.existsSync(path.join(cwd, '.codex', 'hooks', '_runtime', 'lifecycle.cjs'))
    const codexHookDiagnostics = readCodexHookCommands(cwd)
    const codexConfigState = getCodexConfigState(cwd)
    const hasCopilotMd = fs.existsSync(path.join(cwd, '.github', 'copilot-instructions.md'))
    const hasClaudeMd = fs.existsSync(path.join(cwd, 'CLAUDE.md'))
    const hasAgentsMd = fs.existsSync(path.join(cwd, 'AGENTS.md'))
    const hasAgentsSkills = fs.existsSync(path.join(cwd, '.agents', 'skills'))
    const hasInstructions = fs.existsSync(path.join(cwd, '.github', 'instructions'))
    const profileDir = resolveProfileDir(cwd)
    const profileState = inspectProfileState(profileDir)
    const hasProfile = profileState.complete

    let mode = 'instruction-fallback'
    if (platform === 'claude' && hasClaudeHooks) mode = 'hook-enforced (Claude Code)'
    else if (platform === 'codex' && hasCodexHooks) mode = 'hook guardrail (Codex; event-dependent)'
    else if (platform === 'vscode-copilot' && hasGithubHooks) mode = 'workspace-hooks detected (VS Code Copilot preview; verify target IDE)'
    else if (platform === 'jetbrains-copilot') mode = 'instruction-fallback (JetBrains — Hooks unsupported)'
    else if (platform === 'unknown' && installedHosts.length > 1) mode = 'mixed install (host unresolved; multiple adapters present)'

    console.log()
    console.log(c.bold('  DevCodex Doctor') + c.dim(` v1.9.7+ — runtime diagnostics`))
    console.log(c.dim('  ──────────────────────────────────────'))
    console.log(`  cwd:             ${cwd}`)
    console.log(`  platform:        ${c.cyan(platform)}  ${c.dim(`(${platformEvidence.source})`)}`)
    console.log(`  agent:           ${c.cyan(agent)}`)
    console.log(`  installed hosts: ${installedHosts.length ? c.cyan(installedHosts.join(', ')) : c.dim('none detected')}`)
    console.log(`  mode:            ${c.bold(mode)}`)
    console.log(c.dim('  enforcement:     default safety-only warns/continues for bootstrap/CP/auto; strict blocks only host-supported events.'))
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
    ${c.bold('DevCodex')} — AI-powered development workflow rules for GitHub Copilot, Claude Code & Codex

    ${c.bold('Usage:')}
      devcodex <command> [options]
      npx @vextjs/devcodex <command> [options]   ${c.dim('(without npm link)')}

    ${c.bold('Commands:')}
      ${c.cyan('init')}              Install Copilot files, then deploy Claude Code and Codex adapters
      ${c.cyan('init --claude')}     Install Claude Code adapter only
      ${c.cyan('init --codex')}      Install Codex adapter only
      ${c.cyan('update')}            Overwrite Copilot files, then deploy Claude Code and Codex adapters
      ${c.cyan('update --claude')}   Overwrite Claude Code adapter only
      ${c.cyan('update --codex')}    Overwrite Codex adapter only
      ${c.cyan('migrate-layout')}    Plan/apply/rollback centralized .devcodex workspace layout
      ${c.cyan('profile init')}      Auto-generate tiered .devcodex/profile/ drafts
      ${c.cyan('status')}            Show what DevCodex files are installed
      ${c.cyan('doctor')}            Diagnose host platform / agent / mode (v1.9.7+)

    ${c.bold('Options:')}
      ${c.dim('--force,  -f')}       Overwrite existing files
      ${c.dim('--dry-run')}          Preview what would be installed without writing files
      ${c.dim('--claude')}           Only target Claude Code adapter (skip Copilot .github/)
      ${c.dim('--codex')}            Only target Codex adapter (skip Copilot .github/ and Claude Code)
      ${c.dim('--prod')}             (profile init only) Set mode=prod instead of dev
      ${c.dim('--tier <tier>')}      (profile init only) profile-lite | profile-standard | profile-closed-loop

    ${c.bold('Examples:')}
      devcodex init                 # First-time three-host install
      devcodex init --claude        # Claude Code adapter only
      devcodex init --codex         # Codex adapter only
      devcodex migrate-layout plan  # Generate centralized layout migration manifest
      devcodex profile init --tier profile-standard  # Generate tiered Profile drafts
      devcodex update               # Refresh Copilot + Claude Code + Codex adapters
      devcodex update --claude      # Refresh Claude Code adapter only
      devcodex update --codex       # Refresh Codex adapter only
      devcodex status               # Check installation
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
