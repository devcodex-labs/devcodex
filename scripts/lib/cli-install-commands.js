'use strict'

const { DEFAULT_HOSTS, HOST_IDS, hostEntryPairs } = require('./host-surface-descriptors')

function buildCliInstallCommands(ctx) {
  const {
    fs, path, process, console, c, PKG_ROOT, SOURCES, CLAUDE_SOURCES,
    CODEX_SOURCES, CLAUDE_SETTINGS_HOOKS, CLAUDE_SETTINGS_PERMISSIONS,
    CLAUDE_MCP_JSON, CODEX_HOOK_COMMAND, isSourceRepo, beginManagedDeployment,
    finishManagedDeployment, walkDir, resolveActiveRuntimeRoot, resolveGrokWorkspaceBridge, resolveGitignoreRoot,
    copyManagedTextFile, readJsonFileWithStatus,
    writeManagedJsonFile, normalizeStringArray, mergeUniqueStringArrays,
    mergeClaudeHooks, mergeClaudeMcpConfig,
    ensureRuntimeDirs, ensureDevCodexGitignore, getLegacyCounts, isPlainObject,
    resolveTenantSelection, shouldIncludeInstructionFile
  } = ctx

  function readTenantSelection(argv) {
    try {
      return resolveTenantSelection(argv, PKG_ROOT).tenantId
    } catch (error) {
      console.log(c.red(`  ${error.message}`))
      process.exitCode = 1
      return undefined
    }
  }

  const {
    createSkillDeployFileFilter,
    isSkillsSource
  } = require('./skill-deploy-filter')
  const skillDeployFilter = createSkillDeployFileFilter(PKG_ROOT)

  function sourceFiles(srcDir, from, tenantId) {
    return walkDir(srcDir).filter(srcFile => {
      const rel = path.relative(srcDir, srcFile).replace(/\\/g, '/')
      if (from === 'instructions' && !shouldIncludeInstructionFile(rel, tenantId)) return false
      if (isSkillsSource(from) && !skillDeployFilter(rel)) return false
      return true
    })
  }

  /** Content-equal skip: avoid rewrite when bytes already match (init and --force update). */
  function filesContentEqual(srcFile, destFile) {
    try {
      if (!fs.existsSync(destFile)) return false
      const srcStat = fs.statSync(srcFile)
      const destStat = fs.statSync(destFile)
      if (!srcStat.isFile() || !destStat.isFile()) return false
      if (srcStat.size !== destStat.size) return false
      return fs.readFileSync(srcFile).equals(fs.readFileSync(destFile))
    } catch {
      return false
    }
  }

  function addCounts(target, delta) {
    target.added += delta.added || 0
    target.updated += delta.updated || 0
    target.skipped += delta.skipped || 0
    return target
  }

  function parseManagedTomlBlocks(template) {
    const blocks = []
    const matcher = /^# >>> devcodex-managed:([a-z0-9-]+)\r?\n([\s\S]*?)^# <<< devcodex-managed:\1\s*$/gm
    for (const match of template.matchAll(matcher)) {
      const section = match[2].match(/^\s*\[([^\]]+)\]\s*$/m)?.[1]
      if (!section) throw new Error(`GROK_MCP_TEMPLATE_INVALID: managed block ${match[1]} has no TOML section`)
      blocks.push({ id: match[1], section, text: match[0].trim() })
    }
    if (!blocks.length) throw new Error('GROK_MCP_TEMPLATE_INVALID: no managed TOML blocks found')
    return blocks
  }

  function withoutManagedTomlBlock(content, id) {
    const begin = `# >>> devcodex-managed:${id}`
    const end = `# <<< devcodex-managed:${id}`
    const start = content.indexOf(begin)
    if (start < 0) return content
    const finish = content.indexOf(end, start)
    if (finish < 0) throw new Error(`GROK_MCP_CONFIG_INVALID: unterminated managed block ${id}`)
    return content.slice(0, start) + content.slice(finish + end.length)
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function mergeGrokWorkspaceConfig({ cwd, dryRun, backupDir, log, inlineLog }) {
    const templatePath = path.join(PKG_ROOT, 'grok', 'workspace-config.toml')
    const destination = path.join(cwd, '.grok', 'config.toml')
    const blocks = parseManagedTomlBlocks(fs.readFileSync(templatePath, 'utf8'))
    const existed = fs.existsSync(destination)
    const current = existed ? fs.readFileSync(destination, 'utf8') : ''
    let base = current
    for (const block of blocks) base = withoutManagedTomlBlock(base, block.id)
    base = base.trimEnd()
    const included = []
    const userOwned = []
    for (const block of blocks) {
      const sectionPattern = new RegExp(`^\\s*\\[${escapeRegExp(block.section)}\\]\\s*(?:#.*)?$`, 'm')
      if (sectionPattern.test(base)) userOwned.push(block.section)
      else included.push(block.text)
    }
    const desired = [base, ...included].filter(Boolean).join('\n\n') + '\n'
    if (userOwned.length) {
      inlineLog(c.yellow(`  ⚠ preserved user-owned Grok MCP section(s): ${userOwned.join(', ')}`))
    }
    if (current === desired) {
      log(c.dim('  ~ .grok/config.toml (managed MCP blocks)'))
      return { added: 0, updated: 0, skipped: 1 }
    }
    let backupPath = null
    if (existed && current.trim()) {
      const suffix = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
      backupPath = path.join(backupDir, `config.toml.bak.${suffix}`)
      if (!dryRun) {
        fs.mkdirSync(path.dirname(backupPath), { recursive: true })
        fs.copyFileSync(destination, backupPath)
      }
    }
    if (!dryRun) {
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.writeFileSync(destination, desired, 'utf8')
    }
    if (backupPath) inlineLog(c.yellow(`  ⚠ backed up existing .grok/config.toml to ${path.relative(cwd, backupPath)}`))
    log(existed ? c.yellow('  ↺ .grok/config.toml (managed MCP blocks)') : c.green('  ✓ .grok/config.toml (managed MCP blocks)'))
    return { added: existed ? 0 : 1, updated: existed ? 1 : 0, skipped: 0 }
  }

  function copyProjectedFile({ cwd, source, destination, force, dryRun, backupDir, log, inlineLog, label }) {
    const srcFile = path.join(PKG_ROOT, source)
    const destFile = path.join(cwd, destination)
    const counts = { added: 0, updated: 0, skipped: 0 }
    if (!fs.existsSync(srcFile)) return counts
    const existed = fs.existsSync(destFile)
    if (existed && filesContentEqual(srcFile, destFile)) {
      counts.skipped++
      log(c.dim(`  ~ ${label}`))
      return counts
    }
    if (existed && !force) {
      counts.skipped++
      log(c.dim(`  ~ ${label} (outdated; use --force)`))
      return counts
    }
    const result = copyManagedTextFile(srcFile, destFile, { dryRun, backup: true, backupDir })
    if (result.backupPath) inlineLog(c.yellow(`  ⚠ backed up existing ${label} to ${path.relative(cwd, result.backupPath)}`))
    if (existed) {
      counts.updated++
      log(c.yellow(`  ↺ ${label}  (from ${source})`))
    } else {
      counts.added++
      log(c.green(`  ✓ ${label}  (from ${source})`))
    }
    return counts
  }

  function copyProjectedTree({ cwd, source, destination, force, dryRun, backupDir, log, inlineLog, tenantId = null }) {
    const counts = { added: 0, updated: 0, skipped: 0 }
    const srcDir = path.join(PKG_ROOT, source)
    if (!fs.existsSync(srcDir)) return counts
    for (const srcFile of sourceFiles(srcDir, source, tenantId)) {
      const rel = path.relative(srcDir, srcFile)
      addCounts(counts, copyProjectedFile({
        cwd,
        source: path.join(source, rel),
        destination: path.join(destination, rel),
        force,
        dryRun,
        backupDir,
        log,
        inlineLog,
        label: path.join(destination, rel).replace(/\\/g, '/')
      }))
    }
    return counts
  }

  function copySharedProjectionAssets({ cwd, force, dryRun, backupDir, log, inlineLog, tenantId, includeKernel, includeSkills }) {
    const counts = { added: 0, updated: 0, skipped: 0 }
    if (includeKernel) {
      addCounts(counts, copyProjectedFile({
        cwd,
        source: 'host-projections/AGENTS.md',
        destination: 'AGENTS.md',
        force,
        dryRun,
        backupDir,
        log,
        inlineLog,
        label: 'AGENTS.md'
      }))
    }
    addCounts(counts, copyProjectedFile({
      cwd,
      source: 'instructions.md',
      destination: path.join('.agents', 'devcodex', 'instructions.full.md'),
      force,
      dryRun,
      backupDir,
      log,
      inlineLog,
      label: '.agents/devcodex/instructions.full.md'
    }))
    if (includeSkills) {
      addCounts(counts, copyProjectedTree({
        cwd,
        source: 'skills',
        destination: path.join('.agents', 'skills'),
        force,
        dryRun,
        backupDir,
        log,
        inlineLog,
        tenantId
      }))
    }
    return counts
  }

  function hostEntryCollision(host, argv) {
    if (argv.includes('--force') || argv.includes('-f')) return null
    const cwd = process.cwd()
    const grokWorkspaceBridge = host === 'grok' && resolveGrokWorkspaceBridge(cwd)
    for (const pair of hostEntryPairs(host, { grokWorkspaceBridge })) {
      const source = path.join(PKG_ROOT, pair.source)
      const destination = path.join(cwd, pair.destination)
      if (!fs.existsSync(source) || !fs.existsSync(destination) || filesContentEqual(source, destination)) continue
      return { host, destination: pair.destination, expectedSource: pair.source, role: pair.role }
    }
    return null
  }

  function cmdInit(argv, { copilotOnly = false, includeExtended = false } = {}) {
    const force = argv.includes('--force') || argv.includes('-f')
    const dryRun = argv.includes('--dry-run')
    const tenantId = readTenantSelection(argv)
    if (tenantId === undefined) return
    const cwd = process.cwd()
    const ghDir = path.join(cwd, '.github')
    const managedHosts = includeExtended ? HOST_IDS : (copilotOnly ? ['copilot'] : DEFAULT_HOSTS)
    const managedSession = beginManagedDeployment(cwd, managedHosts, { tenantId })

    // Warn if running inside the DevCodex source repo
    if (isSourceRepo(cwd)) {
      console.log()
      console.log(c.yellow('  ⚠️  You are running DevCodex inside its own source repository.'))
      console.log(c.yellow('     Files will be written to: ') + c.bold(ghDir))
      console.log(c.dim('     If you intended to install into a target project, run from the project root:'))
      console.log(c.dim('       cd /path/to/your-project && devcodex ' + (force ? 'update' : 'init')))
      console.log()
    }

    console.log()
    console.log(c.bold('  DevCodex') + c.dim(' — AI workflow injector for Copilot / Claude Code / Codex'))
    console.log(c.dim('  ──────────────────────────────────────'))
    console.log(`  ${c.cyan('Source:')} ${c.dim(PKG_ROOT)}`)
    console.log(`  ${c.cyan('Target:')} ${c.dim(ghDir)}`)
    if (tenantId) console.log(`  ${c.cyan('Tenant:')} ${c.dim(tenantId)} (explicit selection)`)
    console.log()

    if (dryRun) console.log(c.yellow('  [DRY RUN] No files will be written.\n'))

    // Guard: detect missing content dirs before copying
    const anySrcExists = SOURCES.some(({ from }) => fs.existsSync(path.join(PKG_ROOT, from)))

    let added = 0, updated = 0, skipped = 0

    for (const { from, to } of SOURCES) {
      const srcDir = path.join(PKG_ROOT, from)
      const destDir = path.join(ghDir, to)

      if (!fs.existsSync(srcDir)) continue

      for (const srcFile of sourceFiles(srcDir, from, tenantId)) {
        const rel = path.relative(srcDir, srcFile)
        const destFile = path.join(destDir, rel)
        const existed = fs.existsSync(destFile)
        const shown = `.github/${to}/${rel.replace(/\\/g, '/')}`

        if (existed && filesContentEqual(srcFile, destFile)) {
          skipped++
          console.log(c.dim(`  ~ ${shown}`))
          continue
        }
        if (existed && !force) {
          skipped++
          console.log(c.dim(`  ~ ${shown} (outdated; use --force)`))
          continue
        }

        if (!dryRun) {
          fs.mkdirSync(path.dirname(destFile), { recursive: true })
          fs.copyFileSync(srcFile, destFile)
        }

        if (existed) { updated++; console.log(c.yellow(`  ↺ ${shown}`)) }
        else { added++; console.log(c.green(`  ✓ ${shown}`)) }
      }
    }

    // Copy RULES.md to .github/
    const rulesSrc = path.join(PKG_ROOT, 'RULES.md')
    const rulesDest = path.join(ghDir, 'RULES.md')
    if (fs.existsSync(rulesSrc)) {
      const existed = fs.existsSync(rulesDest)
      if (existed && filesContentEqual(rulesSrc, rulesDest)) {
        skipped++
        console.log(c.dim('  ~ .github/RULES.md'))
      } else if (existed && !force) {
        skipped++
        console.log(c.dim('  ~ .github/RULES.md (outdated; use --force)'))
      } else if (!existed || force) {
        if (!dryRun) { fs.mkdirSync(ghDir, { recursive: true }); fs.copyFileSync(rulesSrc, rulesDest) }
        if (existed) { updated++; console.log(c.yellow('  ↺ .github/RULES.md')) }
        else { added++; console.log(c.green('  ✓ .github/RULES.md')) }
      }
    }

    // Generated Copilot kernel; the complete source is installed outside auto-load directories.
    const ciSrc = path.join(PKG_ROOT, 'host-projections', 'copilot-instructions.md')
    const ciDest = path.join(ghDir, 'copilot-instructions.md')
    if (fs.existsSync(ciSrc)) {
      const existed = fs.existsSync(ciDest)
      if (existed && filesContentEqual(ciSrc, ciDest)) {
        skipped++
        console.log(c.dim('  ~ .github/copilot-instructions.md'))
      } else if (existed && !force) {
        skipped++
        console.log(c.dim('  ~ .github/copilot-instructions.md (outdated; use --force)'))
      } else if (!existed || force) {
        if (!dryRun) { fs.mkdirSync(ghDir, { recursive: true }); fs.copyFileSync(ciSrc, ciDest) }
        if (existed) { updated++; console.log(c.yellow('  ↺ .github/copilot-instructions.md  (from generated projection)')) }
        else { added++; console.log(c.green('  ✓ .github/copilot-instructions.md  (from generated projection)')) }
      }
    }

    const backupDir = path.join(resolveActiveRuntimeRoot(cwd), '.tmp', 'backups')
    const fallbackCounts = copySharedProjectionAssets({
      cwd,
      force,
      dryRun,
      backupDir,
      log: (...args) => console.log(...args),
      inlineLog: (...args) => console.log(...args),
      tenantId,
      includeKernel: false,
      includeSkills: false
    })
    added += fallbackCounts.added
    updated += fallbackCounts.updated
    skipped += fallbackCounts.skipped

    // Create active .devcodex namespace runtime dirs and update the owning .gitignore
    if (!dryRun) {
      ensureRuntimeDirs(cwd, dryRun)
      added += ensureDevCodexGitignore(resolveGitignoreRoot(cwd), dryRun)
    }

    console.log()
    console.log(c.dim('  ──────────────────────────────────────'))
    if (dryRun) {
      console.log(`  ${c.bold('Dry run complete.')} Would add ${c.green(added)} files.`)
    } else {
      const parts = []
      if (added) parts.push(c.green(`${added} added`))
      if (updated) parts.push(c.yellow(`${updated} updated`))
      if (skipped) parts.push(c.dim(`${skipped} skipped (use --force to overwrite)`))
      console.log(`  ${c.bold('Done!')} ${parts.join(', ')}`)
      if (added + updated > 0) {
        console.log()
        console.log(`  ${c.cyan('→')} Restart your IDE to activate DevCodex instructions and skills.`)
      }
    }

    const legacyCounts = getLegacyCounts(ghDir).filter(item => item.count > 0)
    if (legacyCounts.length > 0) {
      console.log()
      console.log(c.yellow('  ⚠️  Legacy custom agent files are still present in the target project.'))
      for (const item of legacyCounts) {
        console.log(c.yellow(`     - .github/${path.relative(ghDir, item.fullPath).replace(/\\/g, '/')} (${item.count} files)`))
      }
      console.log(c.dim('     These files are no longer distributed by devcodex init/update. Remove them manually if no longer needed.'))
    }

    // Warn when no content files were found (skeleton state)
    if (!dryRun && !anySrcExists) {
      console.log()
      console.log(c.yellow('  ⚠️  No content files installed.'))
      console.log(c.dim('    skills/ instructions/ prompts/ data/ not found in package root.'))
      console.log(c.dim('    Run  devcodex update  after content files are added.'))
    }

    if (!copilotOnly) {
      console.log(c.dim('\n  ── Also deploying Claude Code adapter (.claude/) ──'))
      cmdInitClaude(argv, { internal: true })
      console.log(c.dim('  ── Also deploying Codex adapter (AGENTS.md + .agents/ + .codex/) ──'))
      cmdInitCodex(argv, { internal: true })
    }
    if (includeExtended) {
      console.log(c.dim('  ── Also deploying Gemini CLI adapter ──'))
      cmdInitGemini(argv, { internal: true })
      console.log(c.dim('  ── Also deploying Grok Build adapter ──'))
      cmdInitGrok(argv, { internal: true })
    }
    finishManagedDeployment(managedSession, dryRun)
  }

  function cmdInitClaude(argv, { internal = false } = {}) {
    const force = argv.includes('--force') || argv.includes('-f')
    const dryRun = argv.includes('--dry-run')
    const tenantId = readTenantSelection(argv)
    if (tenantId === undefined) return
    const cwd = process.cwd()
    const clDir = path.join(cwd, '.claude')
    const managedSession = internal ? null : beginManagedDeployment(cwd, ['claude'], { tenantId })

    if (!internal && isSourceRepo(cwd)) {
      console.log()
      console.log(c.yellow('  ⚠️  You are running DevCodex inside its own source repository.'))
      console.log(c.yellow('     Files will be written to: ') + c.bold(clDir))
      console.log()
    }

    if (!internal) {
      console.log()
      console.log(c.bold('  DevCodex') + c.dim(' — Claude Code Adapter'))
      console.log(c.dim('  ──────────────────────────────────────'))
      console.log(`  ${c.cyan('Source:')} ${c.dim(PKG_ROOT)}`)
      console.log(`  ${c.cyan('Target:')} ${c.dim(clDir)}`)
      if (tenantId) console.log(`  ${c.cyan('Tenant:')} ${c.dim(tenantId)} (explicit selection)`)
      console.log()
      if (dryRun) console.log(c.yellow('  [DRY RUN] No files will be written.\n'))
    }

    let added = 0, updated = 0, skipped = 0
    const log = internal ? () => { } : (...args) => console.log(...args)
    const inlineLog = (...args) => console.log(...args)
    const backupDir = path.join(resolveActiveRuntimeRoot(cwd), '.tmp', 'backups')

    // 1. Install a thin Claude wrapper plus the shared kernel/full fallback.
    const claudeMdSrc = path.join(PKG_ROOT, 'host-projections', 'CLAUDE.md')
    const claudeMdDest = path.join(cwd, 'CLAUDE.md')
    if (fs.existsSync(claudeMdSrc)) {
      const existed = fs.existsSync(claudeMdDest)
      if (!existed || force) {
        const result = copyManagedTextFile(claudeMdSrc, claudeMdDest, { dryRun, backup: true, backupDir })
        if (result.backupPath) inlineLog(c.yellow(`  ⚠ backed up existing CLAUDE.md to ${path.relative(cwd, result.backupPath)}`))
        if (result.copied) {
          if (existed) { updated++; log(c.yellow('  ↺ CLAUDE.md  (from generated wrapper)')) }
          else { added++; log(c.green('  ✓ CLAUDE.md  (from generated wrapper)')) }
        } else {
          skipped++; log(c.dim('  ~ CLAUDE.md'))
        }
      } else {
        skipped++; log(c.dim('  ~ CLAUDE.md'))
      }
    }

    const sharedCounts = copySharedProjectionAssets({
      cwd,
      force,
      dryRun,
      backupDir,
      log,
      inlineLog,
      tenantId,
      includeKernel: true,
      includeSkills: false
    })
    added += sharedCounts.added
    updated += sharedCounts.updated
    skipped += sharedCounts.skipped

    // 2. Copy claude-hooks/ and mcp/ into .claude/
    for (const { from, to } of CLAUDE_SOURCES) {
      const srcDir = path.join(PKG_ROOT, from)
      const destDir = path.join(clDir, to)
      if (!fs.existsSync(srcDir)) continue

      for (const srcFile of sourceFiles(srcDir, from, tenantId)) {
        const rel = path.relative(srcDir, srcFile)
        const destFile = path.join(destDir, rel)
        const existed = fs.existsSync(destFile)
        const shown = `.claude/${to}/${rel.replace(/\\/g, '/')}`

        if (existed && filesContentEqual(srcFile, destFile)) {
          skipped++
          log(c.dim(`  ~ ${shown}`))
          continue
        }
        if (existed && !force) {
          skipped++
          log(c.dim(`  ~ ${shown} (outdated; use --force)`))
          continue
        }
        if (!dryRun) {
          fs.mkdirSync(path.dirname(destFile), { recursive: true })
          fs.copyFileSync(srcFile, destFile)
        }
        if (existed) { updated++; log(c.yellow(`  ↺ ${shown}`)) }
        else { added++; log(c.green(`  ✓ ${shown}`)) }
      }
    }

    // 3. Write / merge .claude/settings.json
    const settingsPath = path.join(clDir, 'settings.json')
    {
      const settingsState = readJsonFileWithStatus(settingsPath)
      const settings = isPlainObject(settingsState.value) ? { ...settingsState.value } : {}
      settings.$schema = settings.$schema || CLAUDE_SETTINGS_PERMISSIONS.$schema
      settings.permissions = isPlainObject(settings.permissions) ? { ...settings.permissions } : {}
      settings.permissions.allow = mergeUniqueStringArrays(
        settings.permissions.allow,
        CLAUDE_SETTINGS_PERMISSIONS.permissions.allow
      )
      settings.permissions.ask = mergeUniqueStringArrays(
        settings.permissions.ask,
        CLAUDE_SETTINGS_PERMISSIONS.permissions.ask
      )
      settings.permissions.deny = normalizeStringArray(settings.permissions.deny)
      settings.enableAllProjectMcpServers = CLAUDE_SETTINGS_PERMISSIONS.enableAllProjectMcpServers === true
      settings.hooks = mergeClaudeHooks(settings.hooks, CLAUDE_SETTINGS_HOOKS.hooks)

      const result = writeManagedJsonFile(settingsPath, settings, { dryRun, backup: true, backupDir })
      if (settingsState.parseError) {
        inlineLog(c.yellow(`  ⚠ existing .claude/settings.json was invalid JSON and has been replaced after backup`))
      }
      if (result.backupPath) {
        inlineLog(c.yellow(`  ⚠ backed up existing .claude/settings.json to ${path.relative(cwd, result.backupPath)}`))
      }
      if (result.written) {
        if (result.existed) { updated++; log(c.yellow('  ↺ .claude/settings.json')) }
        else { added++; log(c.green('  ✓ .claude/settings.json')) }
      } else {
        skipped++; log(c.dim('  ~ .claude/settings.json'))
      }
    }

    // 4. Write / merge .mcp.json to project root (MCP server configuration with explicit workspace arg)
    const mcpJsonPath = path.join(cwd, '.mcp.json')
    {
      const mcpState = readJsonFileWithStatus(mcpJsonPath)
      const merged = mergeClaudeMcpConfig(mcpState.value)
      const result = writeManagedJsonFile(mcpJsonPath, merged, { dryRun, backup: true, backupDir })
      if (mcpState.parseError) {
        inlineLog(c.yellow('  ⚠ existing .mcp.json was invalid JSON and has been replaced after backup'))
      }
      if (result.backupPath) {
        inlineLog(c.yellow(`  ⚠ backed up existing .mcp.json to ${path.relative(cwd, result.backupPath)}`))
      }
      if (result.written) {
        if (result.existed) { updated++; log(c.yellow('  ↺ .mcp.json')) }
        else { added++; log(c.green('  ✓ .mcp.json')) }
      } else {
        skipped++
        log(c.dim('  ~ .mcp.json'))
      }
    }

    // 5. Create active .devcodex namespace runtime dirs and update the owning .gitignore (same as copilot init)
    if (!dryRun) {
      ensureRuntimeDirs(cwd, dryRun)

      // F-002: warn about legacy .claude/agents/ (Claude Code uses skills/ via Skill tool, not agents/)
      if (!internal) {
        const claudeAgentsDir = path.join(clDir, 'agents')
        if (fs.existsSync(claudeAgentsDir)) {
          const agentFiles = walkDir(claudeAgentsDir)
          if (agentFiles.length > 0) {
            console.log()
            console.log(c.yellow(`  ⚠️  Legacy .claude/agents/ detected (${agentFiles.length} files).`))
            console.log(c.dim('     Claude Code uses skills/ via the Skill tool; agents/ is no longer distributed.'))
            console.log(c.dim('     Remove manually if no longer needed.'))
          }
        }
      }

      added += ensureDevCodexGitignore(resolveGitignoreRoot(cwd), dryRun, log)
    }

    if (!internal) {
      console.log()
      console.log(c.dim('  ──────────────────────────────────────'))
      if (dryRun) {
        console.log(`  ${c.bold('Dry run complete.')} Would add ${c.green(added)} files.`)
      } else {
        const parts = []
        if (added) parts.push(c.green(`${added} added`))
        if (updated) parts.push(c.yellow(`${updated} updated`))
        if (skipped) parts.push(c.dim(`${skipped} skipped (use --force to overwrite)`))
        console.log(`  ${c.bold('Done!')} ${parts.join(', ')}`)
        if (added + updated > 0) {
          console.log()
          console.log(`  ${c.cyan('→')} Restart Claude Code to activate hooks and MCP servers.`)
          console.log(`  ${c.cyan('→')} Verify MCP: run ${c.bold('claude mcp list')} in your project.`)
        }
      }
      console.log()
    } else {
      const parts = []
      if (added) parts.push(c.green(`${added} added`))
      if (updated) parts.push(c.yellow(`${updated} updated`))
      if (skipped) parts.push(c.dim(`${skipped} skipped`))
      if (parts.length) {
        console.log(`  ${c.dim('.claude/')} ${parts.join(', ')}`)
        if (added + updated > 0) {
          console.log(`  ${c.cyan('→')} Restart Claude Code to activate hooks and MCP servers.`)
          console.log(`  ${c.cyan('→')} Verify MCP: run ${c.bold('claude mcp list')} in your project.`)
        }
      }
      console.log()
    }
    if (managedSession) finishManagedDeployment(managedSession, dryRun)
  }

  function cmdInitCodex(argv, { internal = false } = {}) {
    const force = argv.includes('--force') || argv.includes('-f')
    const dryRun = argv.includes('--dry-run')
    const tenantId = readTenantSelection(argv)
    if (tenantId === undefined) return
    const cwd = process.cwd()
    const managedSession = internal ? null : beginManagedDeployment(cwd, ['codex'], { tenantId })

    if (!internal && isSourceRepo(cwd)) {
      console.log()
      console.log(c.yellow('  ⚠️  You are running DevCodex inside its own source repository.'))
      console.log(c.yellow('     Files will be written to: ') + c.bold(path.join(cwd, '.codex')))
      console.log()
    }

    if (!internal) {
      console.log()
      console.log(c.bold('  DevCodex') + c.dim(' — Codex Adapter'))
      console.log(c.dim('  ──────────────────────────────────────'))
      console.log(`  ${c.cyan('Source:')} ${c.dim(PKG_ROOT)}`)
      console.log(`  ${c.cyan('Target:')} ${c.dim(cwd)}`)
      console.log()
      if (dryRun) console.log(c.yellow('  [DRY RUN] No files will be written.\n'))
    }

    let added = 0, updated = 0, skipped = 0
    const log = internal ? () => { } : (...args) => console.log(...args)
    const inlineLog = (...args) => console.log(...args)
    const backupDir = path.join(resolveActiveRuntimeRoot(cwd), '.tmp', 'backups')

    const sharedCounts = copySharedProjectionAssets({
      cwd,
      force,
      dryRun,
      backupDir,
      log,
      inlineLog,
      tenantId,
      includeKernel: true,
      includeSkills: true
    })
    added += sharedCounts.added
    updated += sharedCounts.updated
    skipped += sharedCounts.skipped

    for (const { from, to } of CODEX_SOURCES) {
      const srcDir = path.join(PKG_ROOT, from)
      const destDir = path.join(cwd, to)
      if (!fs.existsSync(srcDir)) continue

      for (const srcFile of walkDir(srcDir)) {
        const rel = path.relative(srcDir, srcFile)
        const destFile = path.join(destDir, rel)
        const existed = fs.existsSync(destFile)
        const backup = from === 'codex' && rel.replace(/\\/g, '/') === 'hooks.json'
        const result = copyManagedTextFile(srcFile, destFile, { dryRun, backup, backupDir })
        const shownTo = path.join(to, rel).replace(/\\/g, '/')
        const shownFrom = path.join(from, rel).replace(/\\/g, '/')

        if (result.backupPath) inlineLog(c.yellow(`  ⚠ backed up existing ${shownTo} to ${path.relative(cwd, result.backupPath)}`))
        if (result.copied) {
          existed ? updated++ : added++
          inlineLog(existed ? c.yellow(`  ↺ ${shownTo}  (from ${shownFrom})`) : c.green(`  ✓ ${shownTo}  (from ${shownFrom})`))
        } else {
          skipped++
          log(c.dim(`  ~ ${shownTo}`))
        }
      }
    }

    if (!dryRun) {
      ensureRuntimeDirs(cwd, dryRun)
      added += ensureDevCodexGitignore(resolveGitignoreRoot(cwd), dryRun, log)
    }

    if (!internal) {
      console.log()
      console.log(c.dim('  ──────────────────────────────────────'))
      if (dryRun) {
        console.log(`  ${c.bold('Dry run complete.')} Would add or update Codex adapter files.`)
      } else {
        const parts = []
        if (added) parts.push(c.green(`${added} added`))
        if (updated) parts.push(c.yellow(`${updated} updated`))
        if (skipped) parts.push(c.dim(`${skipped} unchanged`))
        console.log(`  ${c.bold('Done!')} ${parts.join(', ')}`)
        if (added + updated > 0) console.log(`  ${c.cyan('→')} Restart Codex or open a new Codex conversation to load AGENTS.md and hooks.`)
      }
      console.log()
    } else {
      const parts = []
      if (added) parts.push(c.green(`${added} added`))
      if (updated) parts.push(c.yellow(`${updated} updated`))
      if (skipped) parts.push(c.dim(`${skipped} unchanged`))
      if (parts.length) console.log(`  ${c.dim('Codex adapter')} ${parts.join(', ')}`)
      console.log()
    }
    if (managedSession) finishManagedDeployment(managedSession, dryRun)
  }

  function printAdapterSummary(name, counts, dryRun, internal, restartHint) {
    const parts = []
    if (counts.added) parts.push(c.green(`${counts.added} added`))
    if (counts.updated) parts.push(c.yellow(`${counts.updated} updated`))
    if (counts.skipped) parts.push(c.dim(`${counts.skipped} unchanged`))
    if (internal) {
      if (parts.length) console.log(`  ${c.dim(name)} ${parts.join(', ')}`)
      return
    }
    console.log()
    console.log(c.dim('  ──────────────────────────────────────'))
    if (dryRun) console.log(`  ${c.bold('Dry run complete.')} No files were written.`)
    else {
      console.log(`  ${c.bold('Done!')} ${parts.join(', ')}`)
      if (counts.added + counts.updated > 0) console.log(`  ${c.cyan('→')} ${restartHint}`)
    }
    console.log()
  }

  function cmdInitGemini(argv, { internal = false } = {}) {
    const force = argv.includes('--force') || argv.includes('-f')
    const dryRun = argv.includes('--dry-run')
    const tenantId = readTenantSelection(argv)
    if (tenantId === undefined) return
    const cwd = process.cwd()
    const managedSession = internal ? null : beginManagedDeployment(cwd, ['gemini'], { tenantId })
    const counts = { added: 0, updated: 0, skipped: 0 }
    const log = internal ? () => {} : (...args) => console.log(...args)
    const inlineLog = (...args) => console.log(...args)
    const backupDir = path.join(resolveActiveRuntimeRoot(cwd), '.tmp', 'backups')

    if (!internal) {
      console.log()
      console.log(c.bold('  DevCodex') + c.dim(' — Gemini CLI Adapter'))
      console.log(c.dim('  ──────────────────────────────────────'))
      console.log(`  ${c.cyan('Source:')} ${c.dim(PKG_ROOT)}`)
      console.log(`  ${c.cyan('Target:')} ${c.dim(cwd)}`)
      if (dryRun) console.log(c.yellow('  [DRY RUN] No files will be written.\n'))
    }

    addCounts(counts, copySharedProjectionAssets({
      cwd, force, dryRun, backupDir, log, inlineLog, tenantId,
      includeKernel: true, includeSkills: true
    }))
    addCounts(counts, copyProjectedFile({
      cwd, source: 'host-projections/GEMINI.md', destination: 'GEMINI.md',
      force, dryRun, backupDir, log, inlineLog, label: 'GEMINI.md'
    }))
    addCounts(counts, copyProjectedTree({
      cwd, source: 'hooks/_runtime', destination: path.join('.gemini', 'hooks', '_runtime'),
      force, dryRun, backupDir, log, inlineLog, tenantId
    }))

    const settingsPath = path.join(cwd, '.gemini', 'settings.json')
    const managedSettings = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'gemini', 'settings.json'), 'utf8'))
    const settingsState = readJsonFileWithStatus(settingsPath)
    const settings = isPlainObject(settingsState.value) ? { ...settingsState.value } : {}
    settings.hooks = mergeClaudeHooks(settings.hooks, managedSettings.hooks)
    const settingsResult = writeManagedJsonFile(settingsPath, settings, { dryRun, backup: true, backupDir })
    if (settingsState.parseError) inlineLog(c.yellow('  ⚠ existing .gemini/settings.json was invalid JSON and has been replaced after backup'))
    if (settingsResult.backupPath) inlineLog(c.yellow(`  ⚠ backed up existing .gemini/settings.json to ${path.relative(cwd, settingsResult.backupPath)}`))
    if (settingsResult.written) {
      settingsResult.existed ? counts.updated++ : counts.added++
      log(settingsResult.existed ? c.yellow('  ↺ .gemini/settings.json') : c.green('  ✓ .gemini/settings.json'))
    } else {
      counts.skipped++
      log(c.dim('  ~ .gemini/settings.json'))
    }

    if (!dryRun) {
      ensureRuntimeDirs(cwd, dryRun)
      counts.added += ensureDevCodexGitignore(resolveGitignoreRoot(cwd), dryRun, log)
    }
    printAdapterSummary('Gemini adapter', counts, dryRun, internal, 'Restart Gemini CLI, trust project hooks, then verify with `/hooks panel`.')
    if (managedSession) finishManagedDeployment(managedSession, dryRun)
    return counts
  }

  function cmdInitGrok(argv, { internal = false } = {}) {
    const force = argv.includes('--force') || argv.includes('-f')
    const dryRun = argv.includes('--dry-run')
    const tenantId = readTenantSelection(argv)
    if (tenantId === undefined) return
    const cwd = process.cwd()
    const grokWorkspaceBridge = resolveGrokWorkspaceBridge(cwd)
    const managedSession = internal ? null : beginManagedDeployment(cwd, ['grok'], { tenantId, grokWorkspaceBridge })
    const counts = { added: 0, updated: 0, skipped: 0 }
    const log = internal ? () => {} : (...args) => console.log(...args)
    const inlineLog = (...args) => console.log(...args)
    const backupDir = path.join(resolveActiveRuntimeRoot(cwd), '.tmp', 'backups')

    if (!internal) {
      console.log()
      console.log(c.bold('  DevCodex') + c.dim(' — Grok Build Adapter'))
      console.log(c.dim('  ──────────────────────────────────────'))
      console.log(`  ${c.cyan('Source:')} ${c.dim(PKG_ROOT)}`)
      console.log(`  ${c.cyan('Target:')} ${c.dim(cwd)}`)
      if (grokWorkspaceBridge) console.log(`  ${c.cyan('Mode:')} ${c.dim('workspace bridge (shared parent kernel + intent-selected Skills)')}`)
      if (dryRun) console.log(c.yellow('  [DRY RUN] No files will be written.\n'))
    }

    if (grokWorkspaceBridge) {
      addCounts(counts, copyProjectedFile({
        cwd, source: 'host-projections/AGENTS.workspace-bridge.md', destination: 'AGENTS.md',
        force, dryRun, backupDir, log, inlineLog, label: 'AGENTS.md (workspace bridge)'
      }))
      addCounts(counts, copyProjectedTree({
        cwd, source: 'grok/skills/devcodex-workspace', destination: path.join('.grok', 'skills', 'devcodex-workspace'),
        force, dryRun, backupDir, log, inlineLog, tenantId
      }))
      addCounts(counts, copyProjectedTree({
        cwd, source: 'grok/mcp', destination: path.join('.grok', 'mcp'),
        force, dryRun, backupDir, log, inlineLog, tenantId
      }))
      addCounts(counts, mergeGrokWorkspaceConfig({ cwd, dryRun, backupDir, log, inlineLog }))
    } else {
      addCounts(counts, copySharedProjectionAssets({
        cwd, force, dryRun, backupDir, log, inlineLog, tenantId,
        includeKernel: true, includeSkills: true
      }))
    }
    addCounts(counts, copyProjectedFile({
      cwd, source: 'grok/hooks/devcodex.json', destination: path.join('.grok', 'hooks', 'devcodex.json'),
      force, dryRun, backupDir, log, inlineLog, label: '.grok/hooks/devcodex.json'
    }))
    addCounts(counts, copyProjectedTree({
      cwd, source: 'hooks/_runtime', destination: path.join('.grok', 'hooks', '_runtime'),
      force, dryRun, backupDir, log, inlineLog, tenantId
    }))
    if (!dryRun) {
      ensureRuntimeDirs(cwd, dryRun)
      counts.added += ensureDevCodexGitignore(resolveGitignoreRoot(cwd), dryRun, log)
    }
    printAdapterSummary('Grok adapter', counts, dryRun, internal, 'Restart Grok, run `/hooks-trust`, then verify with `grok inspect --json`.')
    if (managedSession) finishManagedDeployment(managedSession, dryRun)
    return counts
  }

  function cmdInitHost(host, argv = []) {
    const normalized = String(host || '').trim().toLowerCase()
    if (normalized !== 'all' && !HOST_IDS.includes(normalized)) {
      console.log(c.red(`  CLI_HOST_UNSUPPORTED: Unsupported host "${normalized || '(missing)'}".`))
      process.exitCode = 2
      return { ok: false, code: 'CLI_HOST_UNSUPPORTED' }
    }
    const collision = hostEntryCollision(normalized, argv)
    if (collision) {
      console.log(c.red(
        `  HOST_INSTRUCTION_COLLISION: ${collision.destination} differs from ${collision.expectedSource}; ` +
        'use devcodex update --host <host> to replace the managed entry.'
      ))
      process.exitCode = 2
      return { ok: false, code: 'HOST_INSTRUCTION_COLLISION', collision }
    }
    if (normalized === 'all') return cmdInit(argv, { includeExtended: true })
    if (normalized === 'copilot') return cmdInit(argv, { copilotOnly: true })
    if (normalized === 'claude') return cmdInitClaude(argv)
    if (normalized === 'codex') return cmdInitCodex(argv)
    if (normalized === 'gemini') return cmdInitGemini(argv)
    return cmdInitGrok(argv)
  }

  return { cmdInit, cmdInitHost, cmdInitClaude, cmdInitCodex, cmdInitGemini, cmdInitGrok }
}

module.exports = { buildCliInstallCommands }
