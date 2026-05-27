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

const fs = require('fs')
const os = require('os')
const path = require('path')
const { runCli: runMigrateLayout } = require('./scripts/migrate-layout.js')

// ─── Tiny ANSI helpers ────────────────────────────────────────────────────────
const c = {
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
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
  { from: 'skills', to: 'skills' },
  { from: 'instructions', to: 'instructions' },
  { from: 'prompts', to: 'prompts' },
  { from: 'hooks', to: 'hooks' },
  { from: 'agents', to: 'agents' },
  { from: 'data/templates', to: 'data' },
]

/**
 * Files copied by devcodex init --claude into .claude/
 * hooks/_runtime is shared with Copilot (same unified lifecycle.cjs).
 * devcodex.lifecycle.json is Copilot-only and not needed in .claude/.
 */
const CLAUDE_SOURCES = [
  { from: 'hooks/_runtime', to: 'hooks/_runtime' },
  { from: 'mcp', to: 'mcp' },
  { from: 'skills', to: 'skills' },
  { from: 'instructions', to: 'instructions' },
  { from: 'prompts', to: 'prompts' },
  { from: 'data/templates', to: 'data' },
]

const CODEX_SOURCES = [
  { from: 'skills', to: path.join('.agents', 'skills') },
  { from: 'hooks/_runtime', to: path.join('.codex', 'hooks', '_runtime') },
  { from: 'codex', to: '.codex' },
]

// v1.9.8+: agents/ 已恢复 Copilot 端默认分发（Q1），不再视为遗留物。
// 保留此数组结构以便后续可重新引入其他遗留迁移项。
const LEGACY_TARGETS = []

// ─── Source repo self-detection ───────────────────────────────────────────────

/** Check if cwd is the DevCodex source repo itself */
function isSourceRepo(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    return pkg.name === '@vextjs/devcodex'
  } catch { return false }
}

function readJsonFile(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch { return null }
}

function findLayoutInfo(startDir) {
  let current = path.resolve(startDir)
  while (true) {
    const markerPath = path.join(current, '.devcodex', 'layout.json')
    const marker = readJsonFile(markerPath)
    if (marker && marker.mode === 'workspace-namespace') {
      return { enabled: true, workspaceRoot: current }
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return { enabled: false, workspaceRoot: path.resolve(startDir) }
}

function inferProjectFromCwd(cwd, layout) {
  if (!layout.enabled) return ''
  const relative = path.relative(layout.workspaceRoot, cwd)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return ''
  const first = relative.split(path.sep).filter(Boolean)[0] || ''
  return first && first !== '.devcodex' ? first : ''
}

function resolveActiveRuntimeRoot(cwd) {
  const layout = findLayoutInfo(cwd)
  if (!layout.enabled) return path.join(cwd, '.devcodex')
  const project = inferProjectFromCwd(cwd, layout)
  return path.join(layout.workspaceRoot, '.devcodex', project || 'workspace')
}

function resolveGitignoreRoot(cwd) {
  const layout = findLayoutInfo(cwd)
  return layout.enabled ? layout.workspaceRoot : cwd
}

function ensureRuntimeDirs(cwd, dryRun) {
  if (dryRun) return resolveActiveRuntimeRoot(cwd)
  const runtimeRoot = resolveActiveRuntimeRoot(cwd)
  fs.mkdirSync(path.join(runtimeRoot, '.memory'), { recursive: true })
  fs.mkdirSync(path.join(runtimeRoot, '.audit-state'), { recursive: true })
  return runtimeRoot
}

function resolveProfileDir(cwd) {
  const layout = findLayoutInfo(cwd)
  const candidates = []
  if (layout.enabled) {
    const project = inferProjectFromCwd(cwd, layout)
    if (project) candidates.push(path.join(layout.workspaceRoot, '.devcodex', project, 'profile'))
    candidates.push(path.join(layout.workspaceRoot, '.devcodex', 'workspace', 'profile'))
  }
  candidates.push(path.join(cwd, '.devcodex', 'profile'))
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0]
}

const DEVCODEX_GITIGNORE_ENTRIES = [
  '.devcodex/.memory/',
  '.devcodex/.audit-state/',
  '.devcodex/.tmp/',
  '.devcodex/*/.memory/',
  '.devcodex/*/.audit-state/',
  '.devcodex/*/.tmp/'
]

function ensureDevCodexGitignore(cwd, dryRun, log = console.log) {
  if (dryRun) return 0
  const gitignorePath = path.join(cwd, '.gitignore')
  const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : ''
  const missing = DEVCODEX_GITIGNORE_ENTRIES.filter(entry => !existing.includes(entry))
  if (!missing.length) return 0
  const header = '# DevCodex runtime state (auto-generated, do not commit)'
  const prefix = existing.trimEnd() ? '\n\n' : ''
  const block = `${prefix}${header}\n${missing.join('\n')}\n`
  if (fs.existsSync(gitignorePath)) fs.appendFileSync(gitignorePath, block)
  else fs.writeFileSync(gitignorePath, `${header}\n${missing.join('\n')}\n`)
  log(c.green(`  ✓ .gitignore  (${missing.length} DevCodex runtime entr${missing.length === 1 ? 'y' : 'ies'} added)`))
  return missing.length
}

function getLegacyCounts(ghDir) {
  return LEGACY_TARGETS.map(({ label, pathParts }) => {
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

// ─── Commands ─────────────────────────────────────────────────────────────────

function cmdInit(argv) {
  const force = argv.includes('--force') || argv.includes('-f')
  const dryRun = argv.includes('--dry-run')
  const cwd = process.cwd()
  const ghDir = path.join(cwd, '.github')

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
  console.log()

  if (dryRun) console.log(c.yellow('  [DRY RUN] No files will be written.\n'))

  // Guard: detect missing content dirs before copying
  const anySrcExists = SOURCES.some(({ from }) => fs.existsSync(path.join(PKG_ROOT, from)))

  let added = 0, updated = 0, skipped = 0

  for (const { from, to } of SOURCES) {
    const srcDir = path.join(PKG_ROOT, from)
    const destDir = path.join(ghDir, to)

    if (!fs.existsSync(srcDir)) continue

    for (const srcFile of walkDir(srcDir)) {
      const rel = path.relative(srcDir, srcFile)
      const destFile = path.join(destDir, rel)
      const existed = fs.existsSync(destFile)

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
      else { added++; console.log(c.green(`  ✓ .github/${to}/${rel.replace(/\\/g, '/')}`)) }
    }
  }

  // Copy RULES.md to .github/
  const rulesSrc = path.join(PKG_ROOT, 'RULES.md')
  const rulesDest = path.join(ghDir, 'RULES.md')
  if (fs.existsSync(rulesSrc)) {
    const existed = fs.existsSync(rulesDest)
    if (!existed || force) {
      if (!dryRun) { fs.mkdirSync(ghDir, { recursive: true }); fs.copyFileSync(rulesSrc, rulesDest) }
      if (existed) { updated++; console.log(c.yellow('  ↺ .github/RULES.md')) }
      else { added++; console.log(c.green('  ✓ .github/RULES.md')) }
    } else {
      skipped++
      console.log(c.dim('  ~ .github/RULES.md'))
    }
  }

  // Copy instructions.md → .github/copilot-instructions.md (v1.9.8+ single-source rename)
  const ciSrc = path.join(PKG_ROOT, 'instructions.md')
  const ciDest = path.join(ghDir, 'copilot-instructions.md')
  if (fs.existsSync(ciSrc)) {
    const existed = fs.existsSync(ciDest)
    if (!existed || force) {
      if (!dryRun) { fs.mkdirSync(ghDir, { recursive: true }); fs.copyFileSync(ciSrc, ciDest) }
      if (existed) { updated++; console.log(c.yellow('  ↺ .github/copilot-instructions.md  (from instructions.md)')) }
      else { added++; console.log(c.green('  ✓ .github/copilot-instructions.md  (from instructions.md)')) }
    } else {
      skipped++
      console.log(c.dim('  ~ .github/copilot-instructions.md'))
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
}

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
  const profilePresent = PROFILE_FILES.filter(f => fs.existsSync(path.join(profileDir, f))).length
  let profileLabel
  if (profilePresent === PROFILE_FILES.length) profileLabel = c.green(`complete  (${profilePresent}/${PROFILE_FILES.length} files)`)
  else if (profilePresent > 0) profileLabel = c.yellow(`partial   (${profilePresent}/${PROFILE_FILES.length} files)`)
  else profileLabel = c.red(`missing   (0/${PROFILE_FILES.length} files — run: devcodex profile init)`)
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

// ─── Claude Code init ─────────────────────────────────────────────────────────

/**
 * Hook command: locate .claude/hooks/_runtime/lifecycle.cjs by walking up from cwd.
 * Why: settings.json may live at workspace root while Claude Code runs in a project subdir.
 * v1.9.7+ monorepo-safe: requires lifecycle.cjs AND a project-root marker (.devcodex/ or
 * package.json) to coexist at the same level, otherwise keeps walking. Prevents false hits
 * on ancestor .claude/ directories that belong to a different (outer) workspace.
 * Silently exits if no DevCodex install is found.
 */
const CLAUDE_HOOK_COMMAND = `node -e "let d=process.cwd(),fs=require('fs'),p=require('path');while(true){const f=p.join(d,'.claude','hooks','_runtime','lifecycle.cjs');if(fs.existsSync(f)&&(fs.existsSync(p.join(d,'.devcodex'))||fs.existsSync(p.join(d,'package.json')))){require(f);break}const n=p.dirname(d);if(n===d){process.exit(0)}d=n}"`

const CODEX_HOOK_COMMAND = 'node ./.codex/hooks/_runtime/lifecycle.cjs'

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

function getCodexConfigState(cwd) {
  const userConfig = path.join(os.homedir(), '.codex', 'config.toml')
  const workspaceConfig = path.join(cwd, '.codex', 'config.toml')
  return {
    userConfig,
    workspaceConfig,
    hasUserConfig: fs.existsSync(userConfig),
    hasWorkspaceConfig: fs.existsSync(workspaceConfig),
  }
}

/** Claude Code settings.json hook configuration */
const CLAUDE_SETTINGS_HOOKS = {
  hooks: {
    PreToolUse: [{
      matcher: '',
      hooks: [{ type: 'command', command: CLAUDE_HOOK_COMMAND }]
    }],
    UserPromptSubmit: [{
      hooks: [{ type: 'command', command: CLAUDE_HOOK_COMMAND }]
    }],
    PostToolUse: [{
      matcher: '',
      hooks: [{ type: 'command', command: CLAUDE_HOOK_COMMAND }]
    }],
    Stop: [{
      hooks: [{ type: 'command', command: CLAUDE_HOOK_COMMAND }]
    }]
  }
}

/** Claude Code project settings permissions: pre-approve DevCodex's normal tool surface */
const CLAUDE_SETTINGS_PERMISSIONS = {
  $schema: 'https://json.schemastore.org/claude-code-settings.json',
  permissions: {
    allow: [
      'Bash',
      'BashOutput',
      'Edit',
      'Glob',
      'Grep',
      'KillBash',
      'LS',
      'MultiEdit',
      'NotebookEdit',
      'NotebookRead',
      'Read',
      'Task',
      'TodoWrite',
      'WebFetch',
      'WebSearch',
      'Write',
      'mcp__devcodex-memory',
      'mcp__devcodex-memory__*',
      'mcp__devcodex-profile',
      'mcp__devcodex-profile__*'
    ],
    ask: [],
    deny: []
  },
  enableAllProjectMcpServers: true
}

/** Claude Code .mcp.json content written to target project root */
const CLAUDE_MCP_JSON = {
  mcpServers: {
    'devcodex-memory': {
      type: 'stdio',
      command: 'node',
      args: ['.claude/mcp/memory-server.js', '.'],
      _note: 'Reads/writes .devcodex/.memory/ session files and records CP confirmations.'
    },
    'devcodex-profile': {
      type: 'stdio',
      command: 'node',
      args: ['.claude/mcp/profile-server.js', '.'],
      _note: 'Loads .devcodex/profile/ files and returns ENV_MODE / agent config.'
    }
  }
}

function cmdInitClaude(argv, { internal = false } = {}) {
  const force = argv.includes('--force') || argv.includes('-f')
  const dryRun = argv.includes('--dry-run')
  const cwd = process.cwd()
  const clDir = path.join(cwd, '.claude')

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
    console.log()
    if (dryRun) console.log(c.yellow('  [DRY RUN] No files will be written.\n'))
  }

  let added = 0, updated = 0, skipped = 0
  const log = internal ? () => { } : (...args) => console.log(...args)

  // 1. Copy instructions.md → <cwd>/CLAUDE.md (v1.9.8+ single-source rename)
  //    Source file is the unified instructions.md; target file name is fixed by Claude Code platform.
  const claudeMdSrc = path.join(PKG_ROOT, 'instructions.md')
  const claudeMdDest = path.join(cwd, 'CLAUDE.md')
  if (fs.existsSync(claudeMdSrc)) {
    const existed = fs.existsSync(claudeMdDest)
    if (!existed || force) {
      if (!dryRun) fs.copyFileSync(claudeMdSrc, claudeMdDest)
      if (existed) { updated++; log(c.yellow('  ↺ CLAUDE.md  (from instructions.md)')) }
      else { added++; log(c.green('  ✓ CLAUDE.md  (from instructions.md)')) }
    } else {
      skipped++; log(c.dim('  ~ CLAUDE.md'))
    }
  }

  // 2. Copy claude-hooks/ and mcp/ into .claude/
  for (const { from, to } of CLAUDE_SOURCES) {
    const srcDir = path.join(PKG_ROOT, from)
    const destDir = path.join(clDir, to)
    if (!fs.existsSync(srcDir)) continue

    for (const srcFile of walkDir(srcDir)) {
      const rel = path.relative(srcDir, srcFile)
      const destFile = path.join(destDir, rel)
      const existed = fs.existsSync(destFile)

      if (existed && !force) {
        skipped++
        log(c.dim(`  ~ .claude/${to}/${rel.replace(/\\/g, '/')}`))
        continue
      }
      if (!dryRun) {
        fs.mkdirSync(path.dirname(destFile), { recursive: true })
        fs.copyFileSync(srcFile, destFile)
      }
      if (existed) { updated++; log(c.yellow(`  ↺ .claude/${to}/${rel.replace(/\\/g, '/')}`)) }
      else { added++; log(c.green(`  ✓ .claude/${to}/${rel.replace(/\\/g, '/')}`)) }
    }
  }

  // 3. Write / merge .claude/settings.json
  const settingsPath = path.join(clDir, 'settings.json')
  if (!dryRun) {
    fs.mkdirSync(clDir, { recursive: true })
    let settings = {}
    if (fs.existsSync(settingsPath)) {
      try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) } catch { /* keep empty */ }
    }
    settings.$schema = settings.$schema || CLAUDE_SETTINGS_PERMISSIONS.$schema
    settings.permissions = Object.assign({}, settings.permissions || {}, CLAUDE_SETTINGS_PERMISSIONS.permissions)
    settings.permissions.allow = Array.from(new Set([
      ...(Array.isArray(settings.permissions.allow) ? settings.permissions.allow : []),
      ...CLAUDE_SETTINGS_PERMISSIONS.permissions.allow
    ])).sort()
    settings.permissions.ask = []
    settings.permissions.deny = []
    settings.enableAllProjectMcpServers = true
    // Merge hooks (overwrite devcodex keys, preserve others)
    settings.hooks = Object.assign({}, settings.hooks || {}, CLAUDE_SETTINGS_HOOKS.hooks)
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
    const existed = added + updated === 0 && fs.existsSync(settingsPath)
    if (existed) { updated++; log(c.yellow('  ↺ .claude/settings.json')) }
    else { added++; log(c.green('  ✓ .claude/settings.json')) }
  }

  // 4. Write .mcp.json to project root (MCP server configuration with explicit workspace arg)
  const mcpJsonPath = path.join(cwd, '.mcp.json')
  if (!dryRun) {
    const mcpExisted = fs.existsSync(mcpJsonPath)
    if (!mcpExisted || force) {
      fs.writeFileSync(mcpJsonPath, JSON.stringify(CLAUDE_MCP_JSON, null, 2) + '\n')
      if (mcpExisted) { updated++; log(c.yellow('  ↺ .mcp.json')) }
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
}

// ─── Codex init ───────────────────────────────────────────────────────────────

function cmdInitCodex(argv, { internal = false } = {}) {
  const dryRun = argv.includes('--dry-run')
  const cwd = process.cwd()

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
}

// ─── Profile bootstrap (v1.9.2+) ──────────────────────────────────────────────

const PROFILE_FILES = ['README.md', '01-项目信息.md', '02-架构约束.md', '03-代码风格.md', 'config.json']

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) } catch { return null }
}

function safeFirstLine(file, prefix) {
  if (!fs.existsSync(file)) return null
  const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/)
  return lines.find(l => l.startsWith(prefix)) || null
}

function detectArch(cwd) {
  const pkg = readJsonSafe(path.join(cwd, 'package.json'))
  if (pkg && pkg.workspaces) return 'monorepo:npm'
  if (fs.existsSync(path.join(cwd, 'pnpm-workspace.yaml'))) return 'monorepo:pnpm'
  if (fs.existsSync(path.join(cwd, 'lerna.json'))) return 'monorepo:lerna'
  return 'single'
}

function listTopDirs(cwd, depth = 2) {
  const skip = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage'])
  const lines = []
  function walk(dir, prefix, currentDepth) {
    if (currentDepth > depth) return
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (skip.has(e.name) || e.name.startsWith('.')) continue
      if (e.isDirectory()) {
        lines.push(`${prefix}${e.name}/`)
        walk(path.join(dir, e.name), prefix + '  ', currentDepth + 1)
      }
    }
  }
  walk(cwd, '', 1)
  return lines.join('\n')
}

function detectStyle(cwd) {
  const eslint = ['.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', 'eslint.config.js', 'eslint.config.mjs']
    .some(f => fs.existsSync(path.join(cwd, f)))
  const prettier = ['.prettierrc', '.prettierrc.json', '.prettierrc.js', 'prettier.config.js']
    .some(f => fs.existsSync(path.join(cwd, f)))
  const tsconfig = readJsonSafe(path.join(cwd, 'tsconfig.json'))
  const editorconfig = fs.existsSync(path.join(cwd, '.editorconfig'))
  return { eslint, prettier, tsconfig, editorconfig }
}

function genProfileReadme(_ctx) {
  return `# Profile Index

> 项目规范文件目录。由 \`devcodex profile init\` 于 ${new Date().toISOString().slice(0, 10)} 自动生成。

| 文件 | 说明 |
|------|------|
| 01-项目信息.md | 技术栈 / 仓库 / 版本 |
| 02-架构约束.md | 目录结构 / 模块边界 |
| 03-代码风格.md | 编码规范 / lint / 格式化 |
| config.json | ENV_MODE + agent 兜底标识 |
`
}

function genProjectInfo(ctx) {
  const { pkg, branch, changelogTop } = ctx
  const name = pkg?.name || '(unknown)'
  const ver = pkg?.version || '0.0.0'
  const desc = pkg?.description || '(no description)'
  const node = pkg?.engines?.node || '(unspecified)'
  const repo = (typeof pkg?.repository === 'string' ? pkg.repository : pkg?.repository?.url) || '(unspecified)'
  return `# 01 — 项目信息

> 由 \`devcodex profile init\` 于 ${new Date().toISOString().slice(0, 10)} 自动生成，需人工复核后定稿。

## 基础信息

| 字段 | 内容 |
|------|------|
| **项目名** | ${name} |
| **当前版本** | ${ver} |
| **描述** | ${desc} |
| **Node 版本** | ${node} |
| **仓库** | ${repo} |

## 当前阶段

| 字段 | 内容 |
|------|------|
| **当前阶段** | v${ver} 初始草稿 |
| **主版本分支** | ${branch} |
| **阶段摘要** | ${changelogTop || '(未在 CHANGELOG.md 中识别)'} |
`
}

function genArchitecture(ctx) {
  const { arch, tree } = ctx
  return `# 02 — 架构约束

> 由 \`devcodex profile init\` 于 ${new Date().toISOString().slice(0, 10)} 自动生成，需人工复核后定稿。

## 项目结构（自动扫描，深度 2）

\`\`\`
${tree || '(empty)'}
\`\`\`

## 架构特征
- 组织模式：${arch}
- 服务拆分：${ctx.hasServices ? '是（services/ 目录存在）' : '否'}
`
}

function genStyle(ctx) {
  const { style, pkg } = ctx
  const scripts = pkg?.scripts || {}
  return `# 03 — 代码风格

> 由 \`devcodex profile init\` 于 ${new Date().toISOString().slice(0, 10)} 自动生成，需人工复核后定稿。

## 静态检查
- ESLint：${style.eslint ? '✅ 启用' : '❌ 未启用'}
- Prettier：${style.prettier ? '✅ 启用' : '❌ 未启用'}
- TypeScript：${style.tsconfig ? `✅ 启用（target=${style.tsconfig.compilerOptions?.target || '?'}, strict=${!!style.tsconfig.compilerOptions?.strict}）` : '❌ 未启用'}
- EditorConfig：${style.editorconfig ? '✅ 存在' : '❌ 无'}

## 工程命令
- lint: \`${scripts.lint || '未定义'}\`
- format: \`${scripts.format || '未定义'}\`
- test: \`${scripts.test || '未定义'}\`
`
}

function genConfigJson(agent, mode) {
  return JSON.stringify({ mode, agent }, null, 2) + '\n'
}

function detectAgent(cwd) {
  // agent fallback hint enum aligned with instructions.md / 15-memory.
  if (process.env.CLAUDE_CODE_VERSION || process.env.CLAUDE_HOOK_COMMAND) return 'claude-code'
  if (process.env.CODEX_HOME || process.env.CODEX_ENV_PWD || process.env.OPENAI_CODEX) return 'codex'
  if (process.env.IDEA_INITIAL_DIRECTORY || process.env.JETBRAINS_IDE) return 'jetbrains-copilot'
  if (process.env.TERM_PROGRAM === 'vscode' || process.env.VSCODE_PID) return 'vscode-copilot'
  if (process.env.CURSOR_TRACE_ID || process.env.CURSOR_USER_ID) return 'cursor'
  if (
    fs.existsSync(path.join(cwd, 'AGENTS.md')) ||
    fs.existsSync(path.join(cwd, '.codex')) ||
    fs.existsSync(path.join(cwd, '.agents'))
  ) return 'codex'
  if (fs.existsSync(path.join(cwd, 'CLAUDE.md')) || fs.existsSync(path.join(cwd, '.claude'))) return 'claude-code'
  const hasCopilotMd = fs.existsSync(path.join(cwd, '.github', 'copilot-instructions.md'))
  if (hasCopilotMd) {
    return 'copilot'
  }
  return 'unknown-agent'
}

function cmdProfileInit(argv) {
  const force = argv.includes('--force') || argv.includes('-f')
  const prod = argv.includes('--prod')
  const mode = prod ? 'prod' : 'dev'
  const cwd = process.cwd()
  const dir = path.join(resolveActiveRuntimeRoot(cwd), 'profile')
  console.log()
  console.log(c.bold('  DevCodex profile init') + c.dim(` in ${cwd}`))
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
    'README.md': () => genProfileReadme(ctx),
    '01-项目信息.md': () => genProjectInfo(ctx),
    '02-架构约束.md': () => genArchitecture(ctx),
    '03-代码风格.md': () => genStyle(ctx),
    'config.json': () => genConfigJson(agent, mode),
  }

  let generated = 0, skipped = 0, backedUp = 0
  for (const file of PROFILE_FILES) {
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
  let platform = 'copilot'
  if (env.CLAUDE_CODE_VERSION || env.CLAUDE_HOOK_COMMAND) platform = 'claude'
  else if (env.CODEX_HOME || env.CODEX_ENV_PWD || env.OPENAI_CODEX) platform = 'codex'
  else if (env.IDEA_INITIAL_DIRECTORY || env.JETBRAINS_IDE) platform = 'jetbrains-copilot'
  else if (env.TERM_PROGRAM === 'vscode' || env.VSCODE_PID) platform = 'vscode-copilot'
  const agent = detectAgent(cwd)
  if (platform === 'copilot' && agent === 'codex') platform = 'codex'

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
  const hasProfile = PROFILE_FILES.every(file => fs.existsSync(path.join(profileDir, file)))

  let mode = 'instruction-fallback'
  if (platform === 'claude' && hasClaudeHooks) mode = 'hook-enforced (Claude Code)'
  else if (platform === 'codex' && hasCodexHooks) mode = 'hook guardrail (Codex; event-dependent)'
  else if (platform === 'vscode-copilot' && hasGithubHooks) mode = 'workspace-hooks detected (VS Code Copilot preview; verify target IDE)'
  else if (platform === 'jetbrains-copilot') mode = 'instruction-fallback (JetBrains — Hooks unsupported)'

  console.log()
  console.log(c.bold('  DevCodex Doctor') + c.dim(` v1.9.7+ — runtime diagnostics`))
  console.log(c.dim('  ──────────────────────────────────────'))
  console.log(`  cwd:             ${cwd}`)
  console.log(`  platform:        ${c.cyan(platform)}  ${c.dim('(env-derived)')}`)
  console.log(`  agent:           ${c.cyan(agent)}`)
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
  console.log(`    profile (${path.relative(cwd, profileDir) || '.devcodex/profile'}) ${hasProfile ? c.green('✅') : c.yellow('⚠️  missing — run `devcodex profile init`')}`)
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
    ${c.cyan('profile init')}      Auto-generate .devcodex/profile/ drafts (v1.9.2+)
    ${c.cyan('status')}            Show what DevCodex files are installed
    ${c.cyan('doctor')}            Diagnose host platform / agent / mode (v1.9.7+)

  ${c.bold('Options:')}
    ${c.dim('--force,  -f')}       Overwrite existing files
    ${c.dim('--dry-run')}          Preview what would be installed without writing files
    ${c.dim('--claude')}           Only target Claude Code adapter (skip Copilot .github/)
    ${c.dim('--codex')}            Only target Codex adapter (skip Copilot .github/ and Claude Code)
    ${c.dim('--prod')}             (profile init only) Set mode=prod instead of dev

  ${c.bold('Examples:')}
    devcodex init                 # First-time three-host install
    devcodex init --claude        # Claude Code adapter only
    devcodex init --codex         # Codex adapter only
    devcodex migrate-layout plan  # Generate centralized layout migration manifest
    devcodex profile init         # Generate Profile drafts from package.json + scan
    devcodex update               # Refresh Copilot + Claude Code + Codex adapters
    devcodex update --claude      # Refresh Claude Code adapter only
    devcodex update --codex       # Refresh Codex adapter only
    devcodex status               # Check installation
`)
}

// ─── Entry point ─────────────────────────────────────────────────────────────

if (require.main === module) {
  const [, , cmd, ...argv] = process.argv
  const isClaude = argv.includes('--claude')
  const isCodex = argv.includes('--codex')

  if (isClaude && isCodex) {
    console.log(c.red('  --claude and --codex are mutually exclusive. Choose one adapter target.'))
    process.exit(1)
  }

  switch (cmd) {
    case 'init':
      if (isClaude) cmdInitClaude(argv.filter(a => a !== '--claude'))
      else if (isCodex) cmdInitCodex(argv.filter(a => a !== '--codex'))
      else cmdInit(argv)
      break
    case 'update':
      if (isClaude) cmdInitClaude(['--force', ...argv.filter(a => a !== '--claude')])
      else if (isCodex) cmdInitCodex(['--force', ...argv.filter(a => a !== '--codex')])
      else cmdInit(['--force', ...argv])
      break
    case 'profile':
      if (argv[0] === 'init') {
        cmdProfileInit(argv.slice(1))
      } else {
        console.log(c.red(`  Unknown profile subcommand: ${argv[0] || '(none)'}`))
        console.log(c.dim('  Available: devcodex profile init [--force] [--prod]'))
        process.exit(1)
      }
      break
    case 'migrate-layout':
      runMigrateLayout(argv)
      break
    case 'status': cmdStatus(); break
    case 'doctor': cmdDoctor(); break
    default: cmdHelp(); break
  }
}

module.exports = {
  walkDir,
  cmdInit,
  cmdInitClaude,
  cmdInitCodex,
  cmdStatus,
  cmdHelp,
  cmdProfileInit,
  cmdDoctor,
  isSourceRepo,
  findLayoutInfo,
  inferProjectFromCwd,
  resolveActiveRuntimeRoot,
  resolveGitignoreRoot,
  ensureRuntimeDirs,
  SOURCES,
  CLAUDE_SOURCES,
  CODEX_SOURCES,
  CLAUDE_HOOK_COMMAND,
  CODEX_HOOK_COMMAND,
  runMigrateLayout
}
