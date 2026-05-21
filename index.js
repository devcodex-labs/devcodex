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
const path = require('path')

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

  // Copy copilot-instructions.md to .github/
  const ciSrc = path.join(PKG_ROOT, 'copilot-instructions.md')
  const ciDest = path.join(ghDir, 'copilot-instructions.md')
  if (fs.existsSync(ciSrc)) {
    const existed = fs.existsSync(ciDest)
    if (!existed || force) {
      if (!dryRun) { fs.mkdirSync(ghDir, { recursive: true }); fs.copyFileSync(ciSrc, ciDest) }
      if (existed) { updated++; console.log(c.yellow('  ↺ .github/copilot-instructions.md')) }
      else { added++; console.log(c.green('  ✓ .github/copilot-instructions.md')) }
    } else {
      skipped++
      console.log(c.dim('  ~ .github/copilot-instructions.md'))
    }
  }

  // Create .devcodex/.memory/ and update .gitignore
  if (!dryRun) {
    fs.mkdirSync(path.join(cwd, '.devcodex', '.memory'), { recursive: true })

    const gitignorePath = path.join(cwd, '.gitignore')
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

  console.log()
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

  // Check .devcodex/profile/ state (v1.9.2+)
  const profileDir = path.join(cwd, '.devcodex', 'profile')
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

// ─── Claude Code init ─────────────────────────────────────────────────────────

/**
 * Hook command: locate .claude/hooks/_runtime/lifecycle.cjs by walking up from cwd.
 * Why: settings.json may live at workspace root while Claude Code runs in a project subdir.
 * A plain `node .claude/hooks/_runtime/lifecycle.cjs` resolves against cwd and fails when
 * the file only exists in an ancestor directory. The inline node snippet searches upward
 * (cwd → parent → ... → root); silently exits if no DevCodex install is found.
 */
const CLAUDE_HOOK_COMMAND = `node -e "let d=process.cwd(),fs=require('fs'),p=require('path');while(true){const f=p.join(d,'.claude','hooks','_runtime','lifecycle.cjs');if(fs.existsSync(f)){require(f);break}const n=p.dirname(d);if(n===d){process.exit(0)}d=n}"`

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

/** Claude Code .mcp.json content written to target project root */
const CLAUDE_MCP_JSON = {
  $schema: 'https://json.schemastore.org/mcp-servers.json',
  servers: {
    'devcodex-memory': {
      type: 'stdio',
      command: 'node',
      args: ['${workspaceFolder}/.claude/mcp/memory-server.js', '${workspaceFolder}'],
      _note: 'Reads/writes .devcodex/.memory/ session files and records CP confirmations.'
    },
    'devcodex-profile': {
      type: 'stdio',
      command: 'node',
      args: ['${workspaceFolder}/.claude/mcp/profile-server.js', '${workspaceFolder}'],
      _note: 'Loads .devcodex/profile/ files and returns ENV_MODE / agent config.'
    }
  }
}

function cmdInitClaude(argv) {
  const force = argv.includes('--force') || argv.includes('-f')
  const dryRun = argv.includes('--dry-run')
  const cwd = process.cwd()
  const clDir = path.join(cwd, '.claude')

  if (isSourceRepo(cwd)) {
    console.log()
    console.log(c.yellow('  ⚠️  You are running DevCodex inside its own source repository.'))
    console.log(c.yellow('     Files will be written to: ') + c.bold(clDir))
    console.log()
  }

  console.log()
  console.log(c.bold('  DevCodex') + c.dim(' — Claude Code Adapter'))
  console.log(c.dim('  ──────────────────────────────────────'))
  console.log(`  ${c.cyan('Source:')} ${c.dim(PKG_ROOT)}`)
  console.log(`  ${c.cyan('Target:')} ${c.dim(clDir)}`)
  console.log()

  if (dryRun) console.log(c.yellow('  [DRY RUN] No files will be written.\n'))

  let added = 0, updated = 0, skipped = 0

  // 1. Copy CLAUDE.md to project root
  const claudeMdSrc = path.join(PKG_ROOT, 'CLAUDE.md')
  const claudeMdDest = path.join(cwd, 'CLAUDE.md')
  if (fs.existsSync(claudeMdSrc)) {
    const existed = fs.existsSync(claudeMdDest)
    if (!existed || force) {
      if (!dryRun) fs.copyFileSync(claudeMdSrc, claudeMdDest)
      if (existed) { updated++; console.log(c.yellow('  ↺ CLAUDE.md')) }
      else { added++; console.log(c.green('  ✓ CLAUDE.md')) }
    } else {
      skipped++; console.log(c.dim('  ~ CLAUDE.md'))
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
        console.log(c.dim(`  ~ .claude/${to}/${rel.replace(/\\/g, '/')}`))
        continue
      }
      if (!dryRun) {
        fs.mkdirSync(path.dirname(destFile), { recursive: true })
        fs.copyFileSync(srcFile, destFile)
      }
      if (existed) { updated++; console.log(c.yellow(`  ↺ .claude/${to}/${rel.replace(/\\/g, '/')}`)) }
      else { added++; console.log(c.green(`  ✓ .claude/${to}/${rel.replace(/\\/g, '/')}`)) }
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
    // Merge hooks (overwrite devcodex keys, preserve others)
    settings.hooks = Object.assign({}, settings.hooks || {}, CLAUDE_SETTINGS_HOOKS.hooks)
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
    const existed = added + updated === 0 && fs.existsSync(settingsPath)
    if (existed) { updated++; console.log(c.yellow('  ↺ .claude/settings.json')) }
    else { added++; console.log(c.green('  ✓ .claude/settings.json')) }
  }

  // 4. Write .mcp.json to project root (MCP server configuration with explicit workspace arg)
  const mcpJsonPath = path.join(cwd, '.mcp.json')
  if (!dryRun) {
    const mcpExisted = fs.existsSync(mcpJsonPath)
    if (!mcpExisted || force) {
      fs.writeFileSync(mcpJsonPath, JSON.stringify(CLAUDE_MCP_JSON, null, 2) + '\n')
      if (mcpExisted) { updated++; console.log(c.yellow('  ↺ .mcp.json')) }
      else { added++; console.log(c.green('  ✓ .mcp.json')) }
    } else {
      skipped++
      console.log(c.dim('  ~ .mcp.json'))
    }
  }

  // 5. Create .devcodex/.memory/ and update .gitignore (same as copilot init)
  if (!dryRun) {
    fs.mkdirSync(path.join(cwd, '.devcodex', '.memory'), { recursive: true })

    // F-002: warn about legacy .claude/agents/ (Claude Code uses skills/ via Skill tool, not agents/)
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

    const gitignorePath = path.join(cwd, '.gitignore')
    const gitignoreEntry = '\n# DevCodex AI session memory (auto-generated, do not commit)\n.devcodex/.memory/\n'
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf8')
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
| config.json | ENV_MODE + agent 标识 |
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
- 项目名：${name}
- 当前版本：${ver}
- 描述：${desc}
- Node 版本：${node}
- 仓库：${repo}

## 当前阶段
- 主版本分支：${branch}
- 阶段摘要：${changelogTop || '(未在 CHANGELOG.md 中识别)'}
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
  // v1.9.6+: agent enum aligned with CLAUDE.md/15-memory: copilot/vscode-copilot/jetbrains-copilot/claude-code/codex/cursor/unknown-agent
  if (fs.existsSync(path.join(cwd, 'CLAUDE.md')) || fs.existsSync(path.join(cwd, '.claude'))) return 'claude-code'
  const hasCopilotMd = fs.existsSync(path.join(cwd, '.github', 'copilot-instructions.md'))
  if (hasCopilotMd) {
    if (process.env.IDEA_INITIAL_DIRECTORY || process.env.JETBRAINS_IDE) return 'jetbrains-copilot'
    if (process.env.TERM_PROGRAM === 'vscode' || process.env.VSCODE_PID) return 'vscode-copilot'
    return 'copilot'
  }
  return 'unknown-agent'
}

function cmdProfileInit(argv) {
  const force = argv.includes('--force') || argv.includes('-f')
  const prod = argv.includes('--prod')
  const mode = prod ? 'prod' : 'dev'
  const cwd = process.cwd()
  const dir = path.join(cwd, '.devcodex', 'profile')
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

function cmdHelp() {
  console.log(`
  ${c.bold('DevCodex')} — AI-powered development workflow rules for GitHub Copilot & Claude Code

  ${c.bold('Usage:')}
    devcodex <command> [options]
    npx @vextjs/devcodex <command> [options]   ${c.dim('(without npm link)')}

  ${c.bold('Commands:')}
    ${c.cyan('init')}              Install DevCodex into .github/ for GitHub Copilot
    ${c.cyan('init --claude')}     Install DevCodex into .claude/ for Claude Code
    ${c.cyan('update')}            Re-install and overwrite Copilot files (init --force)
    ${c.cyan('update --claude')}   Re-install and overwrite Claude Code files
    ${c.cyan('profile init')}      Auto-generate .devcodex/profile/ drafts (v1.9.2+)
    ${c.cyan('status')}            Show what DevCodex files are installed

  ${c.bold('Options:')}
    ${c.dim('--force,  -f')}       Overwrite existing files
    ${c.dim('--dry-run')}          Preview what would be installed without writing files
    ${c.dim('--claude')}           Target Claude Code (.claude/) instead of Copilot (.github/)
    ${c.dim('--prod')}             (profile init only) Set mode=prod instead of dev

  ${c.bold('Examples:')}
    devcodex init                 # First-time Copilot install
    devcodex init --claude        # First-time Claude Code install
    devcodex profile init         # Generate Profile drafts from package.json + scan
    devcodex update               # Overwrite Copilot files
    devcodex status               # Check installation
`)
}

// ─── Entry point ─────────────────────────────────────────────────────────────

if (require.main === module) {
  const [, , cmd, ...argv] = process.argv
  const isClaude = argv.includes('--claude')

  switch (cmd) {
    case 'init':
      isClaude ? cmdInitClaude(argv.filter(a => a !== '--claude')) : cmdInit(argv)
      break
    case 'update':
      isClaude
        ? cmdInitClaude(['--force', ...argv.filter(a => a !== '--claude')])
        : cmdInit(['--force', ...argv])
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
    case 'status': cmdStatus(); break
    default: cmdHelp(); break
  }
}

module.exports = { walkDir, cmdInit, cmdInitClaude, cmdStatus, cmdHelp, cmdProfileInit, isSourceRepo, SOURCES, CLAUDE_SOURCES }
