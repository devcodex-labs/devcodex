'use strict'

function buildCliInstallCommands(ctx) {
  const {
    fs, path, process, console, c, PKG_ROOT, SOURCES, CLAUDE_SOURCES,
    CODEX_SOURCES, CLAUDE_SETTINGS_HOOKS, CLAUDE_SETTINGS_PERMISSIONS,
    CLAUDE_MCP_JSON, CODEX_HOOK_COMMAND, isSourceRepo, beginManagedDeployment,
    finishManagedDeployment, walkDir, resolveActiveRuntimeRoot, resolveGitignoreRoot,
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

  function sourceFiles(srcDir, from, tenantId) {
    return walkDir(srcDir).filter(srcFile => (
      from !== 'instructions' || shouldIncludeInstructionFile(path.relative(srcDir, srcFile), tenantId)
    ))
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

  function cmdInit(argv) {
    const force = argv.includes('--force') || argv.includes('-f')
    const dryRun = argv.includes('--dry-run')
    const tenantId = readTenantSelection(argv)
    if (tenantId === undefined) return
    const cwd = process.cwd()
    const ghDir = path.join(cwd, '.github')
    const managedSession = beginManagedDeployment(cwd, ['copilot', 'claude', 'codex'], { tenantId })

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

    // Copy instructions.md → .github/copilot-instructions.md (v1.9.8+ single-source rename)
    const ciSrc = path.join(PKG_ROOT, 'instructions.md')
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
        if (existed) { updated++; console.log(c.yellow('  ↺ .github/copilot-instructions.md  (from instructions.md)')) }
        else { added++; console.log(c.green('  ✓ .github/copilot-instructions.md  (from instructions.md)')) }
      }
    }

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

    console.log(c.dim('\n  ── Also deploying Claude Code adapter (.claude/) ──'))
    cmdInitClaude(argv, { internal: true })
    console.log(c.dim('  ── Also deploying Codex adapter (AGENTS.md + .agents/ + .codex/) ──'))
    cmdInitCodex(argv, { internal: true })
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

    // 1. Copy instructions.md → <cwd>/CLAUDE.md (v1.9.8+ single-source rename)
    //    Source file is the unified instructions.md; target file name is fixed by Claude Code platform.
    const claudeMdSrc = path.join(PKG_ROOT, 'instructions.md')
    const claudeMdDest = path.join(cwd, 'CLAUDE.md')
    if (fs.existsSync(claudeMdSrc)) {
      const existed = fs.existsSync(claudeMdDest)
      if (!existed || force) {
        const result = copyManagedTextFile(claudeMdSrc, claudeMdDest, { dryRun, backup: true, backupDir })
        if (result.backupPath) inlineLog(c.yellow(`  ⚠ backed up existing CLAUDE.md to ${path.relative(cwd, result.backupPath)}`))
        if (result.copied) {
          if (existed) { updated++; log(c.yellow('  ↺ CLAUDE.md  (from instructions.md)')) }
          else { added++; log(c.green('  ✓ CLAUDE.md  (from instructions.md)')) }
        } else {
          skipped++; log(c.dim('  ~ CLAUDE.md'))
        }
      } else {
        skipped++; log(c.dim('  ~ CLAUDE.md'))
      }
    }

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

    const agentsSrc = path.join(PKG_ROOT, 'instructions.md')
    const agentsDest = path.join(cwd, 'AGENTS.md')
    if (fs.existsSync(agentsSrc)) {
      const existed = fs.existsSync(agentsDest)
      const result = copyManagedTextFile(agentsSrc, agentsDest, { dryRun, backup: true, backupDir })
      if (result.backupPath) inlineLog(c.yellow(`  ⚠ backed up existing AGENTS.md to ${path.relative(cwd, result.backupPath)}`))
      if (result.copied) {
        existed ? updated++ : added++
        inlineLog(existed ? c.yellow('  ↺ AGENTS.md  (from instructions.md)') : c.green('  ✓ AGENTS.md  (from instructions.md)'))
      } else {
        skipped++
        log(c.dim('  ~ AGENTS.md'))
      }
    }

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

  return { cmdInit, cmdInitClaude, cmdInitCodex }
}

module.exports = { buildCliInstallCommands }
