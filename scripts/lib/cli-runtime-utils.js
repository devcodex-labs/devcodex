const { withWorkspaceTempBackup } = require('./workspace-temp.js')
const {
  createDefaultProvisioningDecision,
  provisionWorkspaceEvolutionLayout
} = require('./workspace-provisioning.js')

function normalizeGitignorePattern(value) {
  let pattern = String(value || '').trim().replace(/\\/g, '/')
  if (!pattern || pattern.startsWith('#') || pattern.startsWith('!')) return ''
  pattern = pattern.replace(/^\.\//, '').replace(/^\//, '').replace(/\/{2,}/g, '/')
  pattern = pattern.replace(/\/\*\*\/?$/, '/').replace(/\/+$/, '/')
  return pattern
}

function gitignorePatternRegex(value) {
  const pattern = normalizeGitignorePattern(value)
  if (!pattern) return null
  const directoryPattern = pattern.endsWith('/')
  const segments = pattern.replace(/\/$/, '').split('/')
  let source = '^'
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    if (segment === '**') {
      source += index === 0 ? '(?:[^/]+/)*' : '/(?:[^/]+/)*'
      continue
    }
    if (index > 0 && segments[index - 1] !== '**') source += '/'
    source += segment
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
  }
  source += directoryPattern ? '(?:/.*)?$' : '$'
  return new RegExp(source)
}

function gitignoreRequiredWitnesses(value) {
  const pattern = normalizeGitignorePattern(value)
  if (!pattern) return []
  const directoryPattern = pattern.endsWith('/')
  const segments = pattern.replace(/\/$/, '').split('/')
  let variants = [[]]
  for (const segment of segments) {
    if (segment === '**') {
      variants = variants.flatMap(parts => [
        parts,
        [...parts, 'level-a'],
        [...parts, 'level-a', 'level-b', 'level-c']
      ])
      continue
    }
    const concrete = segment.replace(/\*/g, 'wildcard').replace(/\?/g, 'q')
    variants = variants.map(parts => [...parts, concrete])
  }
  const paths = variants.map(parts => parts.join('/'))
  if (directoryPattern) paths.push(...variants.map(parts => [...parts, 'probe.txt'].join('/')))
  return [...new Set(paths)]
}

function gitignorePatternCovers(existingPattern, requiredPattern) {
  const existing = normalizeGitignorePattern(existingPattern)
  const required = normalizeGitignorePattern(requiredPattern)
  if (!existing || !required) return false
  if (existing === required) return true
  const matcher = gitignorePatternRegex(existing)
  const witnesses = gitignoreRequiredWitnesses(required)
  return Boolean(matcher && witnesses.length && witnesses.every(candidate => matcher.test(candidate)))
}

function buildCliRuntimeUtils({
  fs,
  path,
  walkDir,
  pkgRoot,
  findLayoutInfo,
  resolveActiveRuntimeRoot,
  resolveProfileDirImpl,
  legacyTargets,
  devcodexGitignoreEntries
}) {
  let backupSequence = 0
  function resolveGitignoreRoot(cwd) {
    const layout = findLayoutInfo(cwd)
    return layout.enabled ? layout.workspaceRoot : cwd
  }

  function ensureRuntimeDataTemplates(runtimeRoot, dryRun) {
    const templatesDir = path.join(pkgRoot, 'data', 'templates')
    if (!fs.existsSync(templatesDir)) return 0

    const dataDir = path.join(runtimeRoot, 'data')
    const templateFiles = walkDir(templatesDir).filter(file => path.extname(file).toLowerCase() === '.md')
    let created = 0

    if (!dryRun) fs.mkdirSync(dataDir, { recursive: true })
    for (const templateFile of templateFiles) {
      const relative = path.relative(templatesDir, templateFile)
      const destFile = path.join(dataDir, relative)
      if (fs.existsSync(destFile)) continue
      if (!dryRun) {
        fs.mkdirSync(path.dirname(destFile), { recursive: true })
        fs.copyFileSync(templateFile, destFile)
      }
      created++
    }

    return created
  }

  function ensureWorkspaceNamespaceLayout(cwd, dryRun) {
    const absoluteCwd = path.resolve(cwd)
    const existingLayout = findLayoutInfo(absoluteCwd)
    if (existingLayout.enabled) {
      return {
        created: false,
        planned: false,
        markerPath: existingLayout.markerPath,
        workspaceRoot: existingLayout.workspaceRoot,
        runtimeRoot: resolveActiveRuntimeRoot(absoluteCwd)
      }
    }

    const markerPath = path.join(absoluteCwd, '.devcodex', 'layout.json')
    const runtimeRoot = path.join(absoluteCwd, '.devcodex', 'workspace')
    if (fs.existsSync(markerPath)) {
      const error = new Error(`workspace layout marker is invalid: ${markerPath}`)
      error.code = 'WORKSPACE_LAYOUT_INVALID'
      throw error
    }
    const legacyRuntimeRoot = path.join(absoluteCwd, '.devcodex')
    const legacyRuntimeEntries = [
      'profile',
      '.memory',
      '.audit-state',
      'requirements',
      'bugs',
      'optimizations',
      'scenario-tests',
      'reports',
      'data'
    ].filter(name => fs.existsSync(path.join(legacyRuntimeRoot, name)))
    if (legacyRuntimeEntries.length) {
      const error = new Error(
        `legacy project runtime requires an explicit workspace layout migration: ${legacyRuntimeEntries.join(', ')}`
      )
      error.code = 'WORKSPACE_LAYOUT_MIGRATION_REQUIRED'
      error.legacyRuntimeEntries = legacyRuntimeEntries
      throw error
    }
    if (dryRun) {
      return {
        created: false,
        planned: true,
        markerPath,
        workspaceRoot: absoluteCwd,
        runtimeRoot
      }
    }

    fs.mkdirSync(path.dirname(markerPath), { recursive: true })
    fs.writeFileSync(markerPath, `${JSON.stringify({
      version: 1,
      mode: 'workspace-namespace',
      workspaceDir: 'workspace'
    }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })

    const createdLayout = findLayoutInfo(absoluteCwd)
    if (!createdLayout.enabled || path.resolve(createdLayout.workspaceRoot) !== absoluteCwd) {
      const error = new Error(`workspace layout marker could not be activated: ${markerPath}`)
      error.code = 'WORKSPACE_LAYOUT_ACTIVATION_FAILED'
      throw error
    }
    return {
      created: true,
      planned: false,
      markerPath,
      workspaceRoot: createdLayout.workspaceRoot,
      runtimeRoot: resolveActiveRuntimeRoot(absoluteCwd)
    }
  }

  function ensureRuntimeDirs(cwd, dryRun, options = {}) {
    const runtimeRoot = resolveActiveRuntimeRoot(cwd)
    const layout = findLayoutInfo(cwd)
    const workspaceRuntimeRoot = path.resolve(options.workspaceRuntimeRoot || (
      layout.enabled
        ? path.join(layout.workspaceRoot, '.devcodex', 'workspace')
        : path.join(path.resolve(cwd), '.devcodex', 'workspace')
    ))
    if (!dryRun && !layout.enabled && !options.workspaceRuntimeRoot) {
      const error = new Error('workspace namespace layout must be active before runtime provisioning')
      error.code = 'WORKSPACE_PROVISIONING_LAYOUT_REQUIRED'
      throw error
    }
    const targetDecision = options.targetDecision || createDefaultProvisioningDecision(workspaceRuntimeRoot, path)
    const receipt = provisionWorkspaceEvolutionLayout({
      fsImpl: fs,
      pathImpl: path,
      workspaceRuntimeRoot,
      dryRun,
      targetDecision
    })
    try {
      if (!dryRun) {
        fs.mkdirSync(path.join(runtimeRoot, '.memory'), { recursive: true })
        fs.mkdirSync(path.join(runtimeRoot, '.audit-state'), { recursive: true })
      }
      ensureRuntimeDataTemplates(runtimeRoot, dryRun)
      const { ensureDevcodexMdTemplate } = require('../../hooks/_runtime/devcodex-md-entry.cjs')
      const workspaceEntry = ensureDevcodexMdTemplate(cwd, { dryRun, fs })
      if (!workspaceEntry.ok && !dryRun) {
        const error = new Error(`workspace entry provisioning failed: ${workspaceEntry.reason || 'unknown'}`)
        error.code = 'WORKSPACE_ENTRY_PROVISIONING_FAILED'
        throw error
      }
    } catch (cause) {
      const code = cause.code || 'WORKSPACE_RUNTIME_PROVISIONING_FAILED'
      const error = new Error(`${code}: ${cause.message}`)
      error.code = code
      error.causeCode = cause.code || null
      error.receipt = receipt
      error.runtimeFailure = { code, message: cause.message, partialWritesPreserved: true }
      throw error
    }
    return receipt
  }

  function resolveProfileDir(cwd) {
    return resolveProfileDirImpl(cwd)
  }

  function ensureDevCodexGitignore(cwd, dryRun, log = console.log) {
    if (dryRun) return 0
    const gitignorePath = path.join(cwd, '.gitignore')
    const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : ''
    const existingPatterns = existing.split(/\r?\n/).map(normalizeGitignorePattern).filter(Boolean)
    const missing = devcodexGitignoreEntries.filter(entry =>
      !existingPatterns.some(pattern => gitignorePatternCovers(pattern, entry))
    )
    if (!missing.length) return 0
    const header = '# DevCodex runtime state (auto-generated, do not commit)'
    const prefix = existing.trimEnd() ? '\n\n' : ''
    const block = `${prefix}${header}\n${missing.join('\n')}\n`
    if (fs.existsSync(gitignorePath)) fs.appendFileSync(gitignorePath, block)
    else fs.writeFileSync(gitignorePath, `${header}\n${missing.join('\n')}\n`)
    log(`\x1b[32m  ✓ .gitignore  (${missing.length} DevCodex runtime entr${missing.length === 1 ? 'y' : 'ies'} added)\x1b[0m`)
    return missing.length
  }

  function getLegacyCounts(ghDir) {
    return legacyTargets.map(({ label, pathParts }) => {
      const fullPath = path.join(ghDir, ...pathParts)
      const count = walkDir(fullPath).length
      return { label, count, fullPath }
    })
  }

  function backupSuffix() {
    backupSequence++
    const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 17)
    return `${timestamp}-${process.pid}-${backupSequence}`
  }

  function copyManagedTextFile(src, dest, {
    dryRun = false,
    backup = false,
    backupDir = null,
    desiredContent = null
  } = {}) {
    const binary = Buffer.isBuffer(desiredContent)
    const desired = desiredContent == null
      ? fs.readFileSync(src, 'utf8')
      : (binary ? desiredContent : String(desiredContent))
    const exists = fs.existsSync(dest)
    const current = exists ? fs.readFileSync(dest, binary ? null : 'utf8') : (binary ? Buffer.alloc(0) : '')
    const unchanged = exists && (binary ? current.equals(desired) : current === desired)
    if (unchanged) return { copied: false, backupPath: null, unchanged: true }

    let backupPath = null
    if (backup && exists && (binary ? current.length > 0 : current.trim().length > 0)) {
      const targetName = `${path.basename(dest)}.bak.${backupSuffix()}`
      backupPath = path.join(backupDir || path.dirname(dest), targetName)
      if (!dryRun) {
        const artifact = withWorkspaceTempBackup(backupDir || path.dirname(dest), {
          owner: 'devcodex-cli', producer: 'copy-managed-text-file', targetName
        }, ({ targetPath }) => fs.copyFileSync(dest, targetPath))
        backupPath = artifact.targetPath
      }
    }

    if (!dryRun) {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, desired)
    }
    return { copied: true, backupPath, unchanged: false }
  }

  function readJsonFileWithStatus(filePath) {
    if (!fs.existsSync(filePath)) {
      return { exists: false, value: null, parseError: null }
    }
    try {
      return {
        exists: true,
        value: JSON.parse(fs.readFileSync(filePath, 'utf8')),
        parseError: null
      }
    } catch (error) {
      return { exists: true, value: null, parseError: error }
    }
  }

  function writeManagedJsonFile(dest, value, { dryRun = false, backup = false, backupDir = null } = {}) {
    const desired = JSON.stringify(value, null, 2) + '\n'
    const exists = fs.existsSync(dest)
    const current = exists ? fs.readFileSync(dest, 'utf8') : ''
    if (exists && current === desired) {
      return { written: false, existed: true, unchanged: true, backupPath: null }
    }

    let backupPath = null
    if (backup && exists && current.trim().length > 0) {
      const targetName = `${path.basename(dest)}.bak.${backupSuffix()}`
      backupPath = path.join(backupDir || path.dirname(dest), targetName)
      if (!dryRun) {
        const artifact = withWorkspaceTempBackup(backupDir || path.dirname(dest), {
          owner: 'devcodex-cli', producer: 'write-managed-json-file', targetName
        }, ({ targetPath }) => fs.copyFileSync(dest, targetPath))
        backupPath = artifact.targetPath
      }
    }

    if (!dryRun) {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, desired)
    }
    return { written: true, existed: exists, unchanged: false, backupPath }
  }

  return {
    resolveGitignoreRoot,
    ensureWorkspaceNamespaceLayout,
    ensureRuntimeDirs,
    resolveProfileDir,
    ensureDevCodexGitignore,
    gitignorePatternCovers,
    getLegacyCounts,
    copyManagedTextFile,
    readJsonFileWithStatus,
    writeManagedJsonFile
  }
}

module.exports = {
  buildCliRuntimeUtils,
  gitignorePatternCovers,
  gitignorePatternRegex,
  gitignoreRequiredWitnesses,
  normalizeGitignorePattern
}
