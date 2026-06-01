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

  function ensureRuntimeDirs(cwd, dryRun) {
    if (dryRun) return resolveActiveRuntimeRoot(cwd)
    const runtimeRoot = resolveActiveRuntimeRoot(cwd)
    fs.mkdirSync(path.join(runtimeRoot, '.memory'), { recursive: true })
    fs.mkdirSync(path.join(runtimeRoot, '.audit-state'), { recursive: true })
    ensureRuntimeDataTemplates(runtimeRoot, dryRun)
    return runtimeRoot
  }

  function resolveProfileDir(cwd) {
    return resolveProfileDirImpl(cwd)
  }

  function ensureDevCodexGitignore(cwd, dryRun, log = console.log) {
    if (dryRun) return 0
    const gitignorePath = path.join(cwd, '.gitignore')
    const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : ''
    const missing = devcodexGitignoreEntries.filter(entry => !existing.includes(entry))
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
    return new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
  }

  function copyManagedTextFile(src, dest, { dryRun = false, backup = false, backupDir = null } = {}) {
    const desired = fs.readFileSync(src, 'utf8')
    const exists = fs.existsSync(dest)
    const current = exists ? fs.readFileSync(dest, 'utf8') : ''
    if (exists && current === desired) return { copied: false, backupPath: null, unchanged: true }

    let backupPath = null
    if (backup && exists && current.trim().length > 0) {
      backupPath = path.join(backupDir || path.dirname(dest), `${path.basename(dest)}.bak.${backupSuffix()}`)
      if (!dryRun) {
        fs.mkdirSync(path.dirname(backupPath), { recursive: true })
        fs.copyFileSync(dest, backupPath)
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
      backupPath = path.join(backupDir || path.dirname(dest), `${path.basename(dest)}.bak.${backupSuffix()}`)
      if (!dryRun) {
        fs.mkdirSync(path.dirname(backupPath), { recursive: true })
        fs.copyFileSync(dest, backupPath)
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
    ensureRuntimeDirs,
    resolveProfileDir,
    ensureDevCodexGitignore,
    getLegacyCounts,
    copyManagedTextFile,
    readJsonFileWithStatus,
    writeManagedJsonFile
  }
}

module.exports = {
  buildCliRuntimeUtils
}
