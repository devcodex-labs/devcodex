#!/usr/bin/env node
/**
 * DevCodex CLI – npx devcodex <command>
 *
 * Commands:
 *   init    Copy all DevCodex files into your project's .github/ directory
 *   update  Overwrite installed files with the latest version from the package
 *   status  Show what DevCodex files are installed in the current project
 */

'use strict'

const fs   = require('fs')
const path = require('path')

// ─── Tiny ANSI helpers ────────────────────────────────────────────────────────
const c = {
  green:  s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Walk a directory recursively, return all file paths */
function walkDir(dir) {
  if (!fs.existsSync(dir)) return []
  const results = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) results.push(...walkDir(full))
    else results.push(full)
  }
  return results
}

// ─── Source directories (inside the npm package) ─────────────────────────────
const PKG_ROOT = __dirname
const SOURCES = [
  { from: 'skills',       to: 'skills'       },
  { from: 'instructions', to: 'instructions' },
  { from: 'prompts',      to: 'prompts'      },
  { from: 'data',         to: 'data'         },
]

const LEGACY_TARGETS = [
  { label: 'legacy-agents', pathParts: ['agents'] },
]

// ─── Source repo self-detection ───────────────────────────────────────────────

/** Check if cwd is the DevCodex source repo itself */
function isSourceRepo(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    return pkg.name === '@vextjs/devcodex'
  } catch { return false }
}

function getLegacyCounts(ghDir) {
  return LEGACY_TARGETS.map(({ label, pathParts }) => {
    const fullPath = path.join(ghDir, ...pathParts)
    const count = walkDir(fullPath).length
    return { label, count, fullPath }
  })
}

// ─── Commands ─────────────────────────────────────────────────────────────────

function cmdInit(argv) {
  const force  = argv.includes('--force') || argv.includes('-f')
  const dryRun = argv.includes('--dry-run')
  const cwd    = process.cwd()
  const ghDir  = path.join(cwd, '.github')

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
  console.log(c.bold('  DevCodex') + c.dim(' — GitHub Copilot Agent Plugin'))
  console.log(c.dim('  ──────────────────────────────────────'))
  console.log(`  ${c.cyan('Source:')} ${c.dim(PKG_ROOT)}`)
  console.log(`  ${c.cyan('Target:')} ${c.dim(ghDir)}`)
  console.log()

  if (dryRun) console.log(c.yellow('  [DRY RUN] No files will be written.\n'))

  // Guard: detect missing content dirs before copying
  const anySrcExists = SOURCES.some(({ from }) => fs.existsSync(path.join(PKG_ROOT, from)))

  let added = 0, updated = 0, skipped = 0

  for (const { from, to } of SOURCES) {
    const srcDir  = path.join(PKG_ROOT, from)
    const destDir = path.join(ghDir, to)

    if (!fs.existsSync(srcDir)) continue

    for (const srcFile of walkDir(srcDir)) {
      const rel      = path.relative(srcDir, srcFile)
      const destFile = path.join(destDir, rel)
      const existed  = fs.existsSync(destFile)

      if (existed && !force) {
        skipped++
        console.log(c.dim(`  ~ .github/${to}/${rel.replace(/\\/g, '/')}`))
        continue
      }

      if (!dryRun) {
        fs.mkdirSync(path.dirname(destFile), { recursive: true })
        fs.copyFileSync(srcFile, destFile)
      }

      if (existed) { updated++; console.log(c.yellow(`  ↺ .github/${to}/${rel.replace(/\\/g, '/')}`)) }
      else          { added++;   console.log(c.green (`  ✓ .github/${to}/${rel.replace(/\\/g, '/')}`)) }
    }
  }

  // Copy RULES.md to .github/
  const rulesSrc  = path.join(PKG_ROOT, 'RULES.md')
  const rulesDest = path.join(ghDir, 'RULES.md')
  if (fs.existsSync(rulesSrc)) {
    const existed = fs.existsSync(rulesDest)
    if (!existed || force) {
      if (!dryRun) { fs.mkdirSync(ghDir, { recursive: true }); fs.copyFileSync(rulesSrc, rulesDest) }
      if (existed) { updated++; console.log(c.yellow('  ↺ .github/RULES.md')) }
      else          { added++;   console.log(c.green ('  ✓ .github/RULES.md')) }
    } else {
      skipped++
      console.log(c.dim('  ~ .github/RULES.md'))
    }
  }

  // Copy copilot-instructions.md to .github/
  const ciSrc  = path.join(PKG_ROOT, 'copilot-instructions.md')
  const ciDest = path.join(ghDir, 'copilot-instructions.md')
  if (fs.existsSync(ciSrc)) {
    const existed = fs.existsSync(ciDest)
    if (!existed || force) {
      if (!dryRun) { fs.mkdirSync(ghDir, { recursive: true }); fs.copyFileSync(ciSrc, ciDest) }
      if (existed) { updated++; console.log(c.yellow('  ↺ .github/copilot-instructions.md')) }
      else          { added++;   console.log(c.green ('  ✓ .github/copilot-instructions.md')) }
    } else {
      skipped++
      console.log(c.dim('  ~ .github/copilot-instructions.md'))
    }
  }

  // Create .devcodex/.memory/ and update .gitignore
  if (!dryRun) {
    fs.mkdirSync(path.join(cwd, '.devcodex', '.memory'), { recursive: true })

    const gitignorePath  = path.join(cwd, '.gitignore')
    const gitignoreEntry = '\n# DevCodex AI session memory (auto-generated, do not commit)\n.devcodex/.memory/\n'
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf8')
      // Skip if .devcodex/ (whole dir) or .devcodex/.memory/ is already excluded
      if (!content.includes('.devcodex/') && !content.includes('.devcodex/.memory/')) {
        fs.appendFileSync(gitignorePath, gitignoreEntry)
        added++
        console.log(c.green('  ✓ .gitignore  (.devcodex/.memory/ added)'))
      }
    } else {
      fs.writeFileSync(gitignorePath, gitignoreEntry.trimStart())
      added++
      console.log(c.green('  ✓ .gitignore  (created)'))
    }
  }

  console.log()
  console.log(c.dim('  ──────────────────────────────────────'))
  if (dryRun) {
    console.log(`  ${c.bold('Dry run complete.')} Would add ${c.green(added)} files.`)
  } else {
    const parts = []
    if (added)   parts.push(c.green(`${added} added`))
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

  console.log()
}

function cmdStatus() {
  const cwd   = process.cwd()
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
    console.log(`  ${c.green(`${total} total files`)} installed under .github/`)
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

function cmdHelp() {
  console.log(`
  ${c.bold('DevCodex')} — AI-powered development workflow rules for GitHub Copilot

  ${c.bold('Usage:')}
    devcodex <command> [options]
    npx @vextjs/devcodex <command> [options]   ${c.dim('(without npm link)')}

  ${c.bold('Commands:')}
    ${c.cyan('init')}      Install DevCodex into .github/ (safe by default, skips existing)
    ${c.cyan('update')}    Re-install and overwrite all files (same as init --force)
    ${c.cyan('status')}    Show what DevCodex files are installed in this project

  ${c.bold('Options:')}
    ${c.dim('--force,  -f')}   Overwrite existing files
    ${c.dim('--dry-run')}      Preview what would be installed without writing files

  ${c.bold('Examples:')}
    devcodex init                 # First-time install
    devcodex init --force         # Overwrite with latest version
    devcodex update               # Same as init --force
    devcodex status               # Check installation
`)
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const [,, cmd, ...argv] = process.argv

switch (cmd) {
  case 'init':   cmdInit(argv);  break
  case 'update': cmdInit(['--force', ...argv]); break
  case 'status': cmdStatus(); break
  default:       cmdHelp(); break
}
