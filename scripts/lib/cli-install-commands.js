'use strict'

const { DEFAULT_HOSTS, HOST_IDS, hostEntryPairs } = require('./host-surface-descriptors')
const PACKAGE_JSON = require('../../package.json')
const {
  createCliFailure,
  printCliJson
} = require('./cli-json-contract.js')
const {
  describeGlobalAdapterRefreshForPackageRoot
} = require('./global-adapter-refresh-guidance.js')
const { operationFromArgs } = require('./cli-workspace-init-args.js')
const { buildWorkspaceInitCommand } = require('./cli-workspace-init-command.js')
const { validateWorkspaceProvisioningReceipt } = require('./workspace-provisioning.js')

function buildCliInstallCommands(ctx) {
  const {
    fs, path, process, console, c, PKG_ROOT, SOURCES, CLAUDE_SOURCES,
    CLAUDE_MCP_RUNTIME_SCRIPT_DEPS = [],
    CODEX_SOURCES, CLAUDE_SETTINGS_HOOKS, CLAUDE_SETTINGS_PERMISSIONS,
    CLAUDE_MCP_JSON, CODEX_HOOK_COMMAND, isSourceRepo, beginManagedDeployment,
    finishManagedDeployment, walkDir, resolveActiveRuntimeRoot, resolveGitignoreRoot,
    prepareWorkspaceTempBackupRoot, withWorkspaceTempBackup, resolveWorkspaceTempBackupRoot,
    copyManagedTextFile, readJsonFileWithStatus,
    writeManagedJsonFile, normalizeStringArray, mergeUniqueStringArrays,
    mergeClaudeHooks, mergeClaudeMcpConfig, mergeCodexConfigToml,
    CODEX_MCP_MANAGED_BEGIN,
    ensureWorkspaceNamespaceLayout, ensureRuntimeDirs, ensureDevCodexGitignore, getLegacyCounts, isPlainObject,
    resolveHostAdapterScope, writeGrokPluginRegistration, syncGrokPluginInstallation,
    syncGrokWorkspacePluginInstallation,
    uninstallGrokPluginInstallation, retireWorkspaceProjectHostManifest,
    resolveTenantSelection, shouldIncludeInstructionFile,
    findLayoutInfo, resolveWorkspaceProjectTarget, initializeProfile
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

  const cliMetadata = { packageName: PACKAGE_JSON.name, packageVersion: PACKAGE_JSON.version }

  function consumeWorkspaceProvisioningReceipt(receipt) {
    const validation = validateWorkspaceProvisioningReceipt(receipt)
    if (receipt?.schemaVersion !== 'WorkspaceProvisioningReceiptV1' ||
      !['fresh', 'existing', 'planned'].includes(receipt.status) || !validation.valid) {
      const error = new Error('workspace provisioning did not return a usable receipt')
      error.code = 'WORKSPACE_PROVISIONING_RECEIPT_INVALID'
      error.receipt = receipt || null
      error.validationErrors = validation.errors
      throw error
    }
    return receipt
  }

  function initArgumentFailure(operation, json, errorCode, message, details = {}) {
    const envelope = createCliFailure(
      operation,
      errorCode,
      message,
      'Run `devcodex init --profile <project>` from the workspace root, using an existing unique project name or namespace.',
      cliMetadata,
      details
    )
    if (json) printCliJson(console, envelope)
    else {
      console.log(c.red(`  ${envelope.errorCode}: ${envelope.message}`))
      console.log(c.dim(`  ${envelope.nextStep}`))
    }
    process.exitCode = 2
    return envelope
  }

  const globalRefreshGuidance = () => describeGlobalAdapterRefreshForPackageRoot(PKG_ROOT, { fs, path, packageVersion: PACKAGE_JSON.version })

  function globalOnlyHostFailure(host, argv = []) {
    const operation = operationFromArgs(argv)
    const json = argv.includes('--json')
    const guidance = globalRefreshGuidance()
    const nextStep = operation === 'update'
      ? `Use \`${guidance.primary}\` to refresh user-level host adapters${guidance.secondary ? ` (or ${guidance.secondary})` : ''}.`
      : (operation === 'uninstall'
          ? 'Use `devcodex uninstall --dry-run`, then `devcodex uninstall --apply`; managed removal is atomic across all hosts.'
          : `Use \`${guidance.installCommand}\` to install user-level host adapters${guidance.secondary ? ` (or ${guidance.secondary})` : ''}.`)
    const envelope = createCliFailure(
      operation,
      'CLI_HOST_CONFIG_GLOBAL_ONLY',
      `Host configuration is user-global only; workspace host selection "${host}" is disabled.`,
      nextStep,
      cliMetadata,
      {
        host: String(host || ''),
        mode: 'GlobalOnlyHostConfigModeV1',
        workspaceCleanMode: 'GlobalOnlyWorkspaceCleanModeV1',
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

  function copyRuntimeScriptDeps({ targetRoot, shownRoot, force, dryRun, log, inlineLog = log }) {
    const counts = { added: 0, updated: 0, skipped: 0 }
    for (const relRaw of CLAUDE_MCP_RUNTIME_SCRIPT_DEPS) {
      const rel = String(relRaw || '').replace(/\\/g, '/')
      if (!rel) continue
      const srcFile = path.join(PKG_ROOT, ...rel.split('/'))
      if (!fs.existsSync(srcFile)) {
        inlineLog(c.yellow(`  ⚠ missing project runtime dep source: ${rel}`))
        continue
      }
      const destFile = path.join(targetRoot, ...rel.split('/'))
      const existed = fs.existsSync(destFile)
      const shown = `${shownRoot}/${rel}`
      if (existed && filesContentEqual(srcFile, destFile)) {
        counts.skipped++
        log(c.dim(`  ~ ${shown}`))
        continue
      }
      if (existed && !force) {
        counts.skipped++
        log(c.dim(`  ~ ${shown} (outdated; use --force)`))
        continue
      }
      if (!dryRun) {
        fs.mkdirSync(path.dirname(destFile), { recursive: true })
        fs.copyFileSync(srcFile, destFile)
      }
      if (existed) { counts.updated++; log(c.yellow(`  ↺ ${shown}`)) }
      else { counts.added++; log(c.green(`  ✓ ${shown}`)) }
    }
    return counts
  }

  const cmdInitWorkspaceRuntime = buildWorkspaceInitCommand({
    process, console, c, path, cliMetadata, initArgumentFailure, readTenantSelection,
    findLayoutInfo, resolveWorkspaceProjectTarget, ensureWorkspaceNamespaceLayout,
    ensureRuntimeDirs, initializeProfile, globalRefreshGuidance
  })

  const {
    createSkillDeployFileFilter,
    isSkillsSource
  } = require('./skill-deploy-filter')
  const {
    listControlDeliveryEntries,
    listControlSourceEntries,
    sourceEntryContentEqual,
    writeSourceEntry,
    readControlInstructionRoot
  } = require('./control-content-delivery')
  const skillDeployFilter = createSkillDeployFileFilter(PKG_ROOT)

  function sourceFiles(srcDir, from, tenantId) {
    return listControlSourceEntries(PKG_ROOT, srcDir, from, {
      includeInstructionFile: relative => shouldIncludeInstructionFile(relative, tenantId),
      includeSkillFile: relative => !isSkillsSource(from) || skillDeployFilter(relative)
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

  function copyProjectedFile({ cwd, source, destination, force, dryRun, backupDir, log, inlineLog, label, content = null }) {
    const srcFile = path.join(PKG_ROOT, source)
    const destFile = path.join(cwd, destination)
    const counts = { added: 0, updated: 0, skipped: 0 }
    const projectedContent = content == null && source === 'instructions.md'
      ? readControlInstructionRoot(PKG_ROOT)
      : content
    if (projectedContent == null && !fs.existsSync(srcFile)) return counts
    const existed = fs.existsSync(destFile)
    const entry = { srcFile, content: projectedContent }
    if (existed && sourceEntryContentEqual(entry, destFile)) {
      counts.skipped++
      log(c.dim(`  ~ ${label}`))
      return counts
    }
    if (existed && !force) {
      counts.skipped++
      log(c.dim(`  ~ ${label} (outdated; use --force)`))
      return counts
    }
    let result
    if (projectedContent == null) {
      result = copyManagedTextFile(srcFile, destFile, { dryRun, backup: true, backupDir })
    } else {
      result = copyManagedTextFile(null, destFile, {
        dryRun,
        backup: true,
        backupDir,
        desiredContent: projectedContent
      })
    }
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
    const entries = sourceFiles(srcDir, source, tenantId)
    if (!entries.length) return counts
    for (const entry of entries) {
      const rel = entry.relative
      addCounts(counts, copyProjectedFile({
        cwd,
        source: entry.source,
        destination: path.join(destination, rel),
        force,
        dryRun,
        backupDir,
        log,
        inlineLog,
        label: path.join(destination, rel).replace(/\\/g, '/'),
        content: entry.content
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
      label: 'legacy workspace .agents/devcodex/instructions.full.md'
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
    const explicitPortable = host === 'grok' && argv.includes('--project-portable')
    const scope = resolveHostAdapterScope(cwd, host === 'grok' ? 'grok' : 'codex', {
      requestedScope: explicitPortable ? 'project-portable' : null,
      explicitPortable
    })
    const grokScope = ['grok', 'all'].includes(host) ? resolveHostAdapterScope(cwd, 'grok') : null
    const targetRoot = scope.ownerRoot
    const grokWorkspaceScope = grokScope?.scope === 'user-registered-workspace'
    for (const pair of hostEntryPairs(host, { grokWorkspaceScope })) {
      // Thin host wrappers may contain user instructions. `init` preserves them while
      // `update` reaches this path with --force and refreshes the managed wrapper.
      if (pair.role === 'wrapper') continue
      const source = path.join(PKG_ROOT, pair.source)
      const destination = path.join(targetRoot, pair.destination)
      if (!fs.existsSync(source) || !fs.existsSync(destination) || filesContentEqual(source, destination)) continue
      return { host, destination: pair.destination, expectedSource: pair.source, role: pair.role }
    }
    return null
  }

  function runFromHostOwner(host, operation, options = {}) {
    const invocationCwd = process.cwd()
    const hostScope = resolveHostAdapterScope(invocationCwd, host)
    const ownerRoot = path.resolve(hostScope.ownerRoot)
    const sameOwner = process.platform === 'win32'
      ? ownerRoot.toLowerCase() === path.resolve(invocationCwd).toLowerCase()
      : ownerRoot === path.resolve(invocationCwd)
    if (sameOwner) return operation({ hostScope, invocationCwd })
    process.chdir(ownerRoot)
    try {
      const result = operation({ hostScope, invocationCwd })
      if (!process.exitCode || process.exitCode === 0) {
        // Host assets belong to the workspace owner, but task/runtime state remains
        // project-scoped so intent, Profile, memory and reports never collapse into
        // the shared workspace namespace.
        consumeWorkspaceProvisioningReceipt(ensureRuntimeDirs(invocationCwd, options.dryRun === true))
      }
      const grokScope = resolveHostAdapterScope(invocationCwd, 'grok')
      retireWorkspaceProjectHostManifest(grokScope, { dryRun: options.dryRun === true })
      return result
    } finally {
      process.chdir(invocationCwd)
    }
  }

  function cmdInit(argv, { copilotOnly = false, includeExtended = false, ownerResolved = false } = {}) {
    if (!ownerResolved) {
      return runFromHostOwner(
        'codex',
        () => cmdInit(argv, { copilotOnly, includeExtended, ownerResolved: true }),
        { dryRun: argv.includes('--dry-run') }
      )
    }
    const force = argv.includes('--force') || argv.includes('-f')
    const dryRun = argv.includes('--dry-run')
    const tenantId = readTenantSelection(argv)
    if (tenantId === undefined) return
    const cwd = process.cwd()
    const ghDir = path.join(cwd, '.github')
    const managedHosts = includeExtended ? HOST_IDS : (copilotOnly ? ['copilot'] : DEFAULT_HOSTS)
    const grokWorkspaceScope = includeExtended && resolveHostAdapterScope(cwd, 'grok').scope === 'user-registered-workspace'
    const managedSession = beginManagedDeployment(cwd, managedHosts, { tenantId, grokWorkspaceScope })

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
    const anySrcExists = SOURCES.some(({ from }) =>
      fs.existsSync(path.join(PKG_ROOT, from)) ||
      Boolean(listControlDeliveryEntries(PKG_ROOT, from))
    )

    let added = 0, updated = 0, skipped = 0

    for (const { from, to } of SOURCES) {
      const srcDir = path.join(PKG_ROOT, from)
      const destDir = path.join(ghDir, to)

      const entries = sourceFiles(srcDir, from, tenantId)
      if (!entries.length) continue

      for (const entry of entries) {
        const rel = entry.relative
        const destFile = path.join(destDir, rel)
        const existed = fs.existsSync(destFile)
        const shown = `.github/${to}/${rel.replace(/\\/g, '/')}`

        if (existed && sourceEntryContentEqual(entry, destFile)) {
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
          writeSourceEntry(entry, destFile)
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

    const backupDir = dryRun ? resolveWorkspaceTempBackupRoot(cwd) : prepareWorkspaceTempBackupRoot(cwd)
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
    consumeWorkspaceProvisioningReceipt(ensureRuntimeDirs(cwd, dryRun))
    if (!dryRun) {
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
      console.log(c.dim('    Run  devcodex global-adapters apply  (or npm install -g .) after content files are added.'))
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
    const backupDir = dryRun ? resolveWorkspaceTempBackupRoot(cwd) : prepareWorkspaceTempBackupRoot(cwd)

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
      const entries = sourceFiles(srcDir, from, tenantId)
      if (!entries.length) continue

      for (const entry of entries) {
        const rel = entry.relative
        const destFile = path.join(destDir, rel)
        const existed = fs.existsSync(destFile)
        const shown = `.claude/${to}/${rel.replace(/\\/g, '/')}`

        if (existed && sourceEntryContentEqual(entry, destFile)) {
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
          writeSourceEntry(entry, destFile)
        }
        if (existed) { updated++; log(c.yellow(`  ↺ ${shown}`)) }
        else { added++; log(c.green(`  ✓ ${shown}`)) }
      }
    }

    // 2b. Project runtime script deps for Claude hooks and shared MCP.
    {
      const counts = copyRuntimeScriptDeps({ targetRoot: clDir, shownRoot: '.claude', force, dryRun, log, inlineLog })
      added += counts.added; updated += counts.updated; skipped += counts.skipped
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
    consumeWorkspaceProvisioningReceipt(ensureRuntimeDirs(cwd, dryRun))
    if (!dryRun) {
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
    const backupDir = dryRun ? resolveWorkspaceTempBackupRoot(cwd) : prepareWorkspaceTempBackupRoot(cwd)

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

    {
      const counts = copyRuntimeScriptDeps({ targetRoot: path.join(cwd, '.codex'), shownRoot: '.codex', force, dryRun, log, inlineLog })
      added += counts.added; updated += counts.updated; skipped += counts.skipped
    }

    // Deploy shared MCP runtime under .claude/mcp (reused by Claude + Codex)
    {
      const mcpSrc = path.join(PKG_ROOT, 'mcp')
      const mcpDest = path.join(cwd, '.claude', 'mcp')
      if (fs.existsSync(mcpSrc)) {
        for (const srcFile of walkDir(mcpSrc)) {
          const rel = path.relative(mcpSrc, srcFile)
          const destFile = path.join(mcpDest, rel)
          const existed = fs.existsSync(destFile)
          const shown = `.claude/mcp/${rel.replace(/\\/g, '/')}`
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
      const counts = copyRuntimeScriptDeps({ targetRoot: path.join(cwd, '.claude'), shownRoot: '.claude', force, dryRun, log, inlineLog })
      added += counts.added; updated += counts.updated; skipped += counts.skipped
    }

    // Merge Codex config.toml MCP servers (managed block; fail-closed; does not wipe user keys)
    {
      const codexConfigPath = path.join(cwd, '.codex', 'config.toml')
      const existed = fs.existsSync(codexConfigPath)
      let existing = ''
      if (existed) {
        try {
          existing = fs.readFileSync(codexConfigPath, 'utf8')
        } catch (readErr) {
          // F-001: never treat read failure as empty config and overwrite user file
          const msg = `CODEX_CONFIG_READ_FAILED: cannot read ${codexConfigPath}: ${readErr && readErr.message ? readErr.message : readErr}`
          if (!internal) console.log(c.red(`  ${msg}`))
          process.exitCode = 1
          throw new Error(msg)
        }
      }
      const mergeResult = mergeCodexConfigToml(existing, cwd)
      if (!mergeResult.ok) {
        const msg = `${mergeResult.code || 'CODEX_MCP_MERGE_FAILED'}: ${mergeResult.error || 'merge failed'}`
        if (!internal) console.log(c.red(`  ${msg}`))
        process.exitCode = 1
        throw new Error(msg)
      }
      const { content, changed } = mergeResult
      if (changed) {
        if (!dryRun) {
          if (existed) {
            fs.mkdirSync(backupDir, { recursive: true })
            let backupPath = path.join(backupDir, `config.toml.bak.${Date.now()}`)
            try {
              const artifact = withWorkspaceTempBackup(backupDir, {
                owner: 'devcodex-cli', producer: 'codex-config-toml', targetName: path.basename(backupPath)
              }, ({ targetPath }) => fs.copyFileSync(codexConfigPath, targetPath))
              backupPath = artifact.targetPath
              inlineLog(c.yellow(`  ⚠ backed up existing .codex/config.toml to ${path.relative(cwd, backupPath)}`))
            } catch (backupErr) {
              const msg = `CODEX_CONFIG_BACKUP_FAILED: cannot backup ${codexConfigPath}: ${backupErr && backupErr.message ? backupErr.message : backupErr}`
              if (!internal) console.log(c.red(`  ${msg}`))
              process.exitCode = 1
              throw new Error(msg)
            }
          }
          fs.mkdirSync(path.dirname(codexConfigPath), { recursive: true })
          // Atomic replace: write temp in same dir then rename (preserves original on failure)
          const tmpPath = path.join(
            path.dirname(codexConfigPath),
            `.config.toml.devcodex-tmp.${process.pid}.${Date.now()}`
          )
          try {
            fs.writeFileSync(tmpPath, content, 'utf8')
            fs.renameSync(tmpPath, codexConfigPath)
          } catch (writeErr) {
            try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath) } catch { /* ignore cleanup */ }
            const msg = `CODEX_CONFIG_WRITE_FAILED: cannot write ${codexConfigPath}: ${writeErr && writeErr.message ? writeErr.message : writeErr}`
            if (!internal) console.log(c.red(`  ${msg}`))
            process.exitCode = 1
            throw new Error(msg)
          }
        }
        if (existed) { updated++; log(c.yellow('  ↺ .codex/config.toml  (DevCodex MCP managed block)')) }
        else { added++; log(c.green('  ✓ .codex/config.toml  (DevCodex MCP managed block)')) }
      } else {
        skipped++
        log(c.dim('  ~ .codex/config.toml  (DevCodex MCP managed block)'))
      }
    }

    consumeWorkspaceProvisioningReceipt(ensureRuntimeDirs(cwd, dryRun))
    if (!dryRun) {
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
        if (added + updated > 0) {
          console.log(`  ${c.cyan('→')} Restart Codex or open a new conversation to load AGENTS.md, hooks, and DevCodex MCP.`)
          console.log(`  ${c.cyan('→')} MCP: devcodex-memory + devcodex-profile via .codex/config.toml (managed block).`)
        }
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
    const backupDir = dryRun ? resolveWorkspaceTempBackupRoot(cwd) : prepareWorkspaceTempBackupRoot(cwd)

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

    consumeWorkspaceProvisioningReceipt(ensureRuntimeDirs(cwd, dryRun))
    if (!dryRun) {
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
    const requestedScope = argv.includes('--project-portable') ? 'project-portable' : null
    const hostScope = resolveHostAdapterScope(cwd, 'grok', {
      requestedScope,
      explicitPortable: requestedScope === 'project-portable'
    })
    const grokWorkspaceScope = hostScope.scope === 'user-registered-workspace'
    const targetRoot = hostScope.ownerRoot
    const managedSession = internal ? null : beginManagedDeployment(targetRoot, ['grok'], { tenantId, grokWorkspaceScope })
    const counts = { added: 0, updated: 0, skipped: 0 }
    const log = internal ? () => {} : (...args) => console.log(...args)
    const inlineLog = (...args) => console.log(...args)
    const activeRoot = resolveActiveRuntimeRoot(targetRoot)
    const backupDir = dryRun ? resolveWorkspaceTempBackupRoot(activeRoot) : prepareWorkspaceTempBackupRoot(activeRoot)

    if (grokWorkspaceScope) {
      writeGrokPluginRegistration({
        pluginPath: hostScope.pluginRoot,
        legacyPluginPaths: hostScope.legacyPluginRoots,
        activeRoot,
        dryRun: true,
        env: process.env
      })
    }

    if (!internal) {
      console.log()
      console.log(c.bold('  DevCodex') + c.dim(' — Grok Build Adapter'))
      console.log(c.dim('  ──────────────────────────────────────'))
      console.log(`  ${c.cyan('Source:')} ${c.dim(PKG_ROOT)}`)
      console.log(`  ${c.cyan('Target:')} ${c.dim(targetRoot)}`)
      console.log(`  ${c.cyan('Scope:')} ${c.dim(hostScope.scope)}`)
      if (dryRun) console.log(c.yellow('  [DRY RUN] No files will be written.\n'))
    }

    if (grokWorkspaceScope) {
      addCounts(counts, copySharedProjectionAssets({
        cwd: targetRoot, force, dryRun, backupDir, log, inlineLog, tenantId,
        includeKernel: true, includeSkills: true
      }))
      addCounts(counts, copyProjectedTree({
        cwd: targetRoot,
        source: 'grok/plugins/devcodex-workspace',
        destination: path.join('.grok', 'devcodex', 'plugins', 'devcodex-workspace'),
        force, dryRun, backupDir, log, inlineLog, tenantId
      }))
      const installation = syncGrokWorkspacePluginInstallation({
        pluginPath: hostScope.pluginRoot,
        legacyPluginPaths: hostScope.legacyPluginRoots,
        activeRoot,
        backupDir,
        dryRun,
        env: process.env
      })
      if (installation.status === 'migrated') {
        counts.updated++
        log(c.green('  ✓ Grok workspace plugin migrated to the canonical source'))
      } else {
        counts.skipped++
        log(c.dim(`  ~ Grok workspace plugin source (${installation.status})`))
      }
      if (installation.status === 'unavailable') {
        inlineLog(c.yellow('  ⚠ Grok CLI not found; legacy source was retained and canonical activation remains unverified'))
      } else if (['verified', 'migrated'].includes(installation.status)) {
        log(c.green('  ✓ Grok user plugin installation synchronized'))
      } else {
        log(c.dim(`  ~ Grok user plugin installation (${installation.status})`))
      }
    } else {
      addCounts(counts, copySharedProjectionAssets({
        cwd: targetRoot, force, dryRun, backupDir, log, inlineLog, tenantId,
        includeKernel: true, includeSkills: true
      }))
      addCounts(counts, copyProjectedFile({
        cwd: targetRoot, source: 'grok/hooks/devcodex.json', destination: path.join('.grok', 'hooks', 'devcodex.json'),
        force, dryRun, backupDir, log, inlineLog, label: '.grok/hooks/devcodex.json'
      }))
      addCounts(counts, copyProjectedTree({
        cwd: targetRoot, source: 'hooks/_runtime', destination: path.join('.grok', 'hooks', '_runtime'),
        force, dryRun, backupDir, log, inlineLog, tenantId
      }))
    }
    consumeWorkspaceProvisioningReceipt(ensureRuntimeDirs(targetRoot, dryRun))
    if (!dryRun) {
      counts.added += ensureDevCodexGitignore(resolveGitignoreRoot(targetRoot), dryRun, log)
    }
    const nextStep = grokWorkspaceScope
      ? 'Restart Grok, then verify the registered workspace plugin from both workspace and project cwd with `grok inspect --json`.'
      : 'Restart Grok, run `/hooks-trust`, then verify with `grok inspect --json`.'
    printAdapterSummary('Grok adapter', counts, dryRun, internal, nextStep)
    if (managedSession) finishManagedDeployment(managedSession, dryRun)
    if (grokWorkspaceScope) retireWorkspaceProjectHostManifest(hostScope, { dryRun })
    return counts
  }

  function cmdInitHost(host, argv = []) {
    const normalized = String(host || '').trim().toLowerCase()
    return globalOnlyHostFailure(normalized || host, argv)
  }

  function cmdUninstallHost(host, argv = []) {
    const normalized = String(host || '').trim().toLowerCase()
    return globalOnlyHostFailure(normalized, ['--operation=uninstall', ...argv])
  }

  return {
    cmdInitWorkspaceRuntime,
    cmdInitHost,
    cmdUninstallHost
  }
}

module.exports = { buildCliInstallCommands }
