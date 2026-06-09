'use strict'

function buildGovernancePackageDeploymentChecks(ctx) {
  const {
    ROOT,
    fs,
    path,
    execSync,
    read,
    walk,
    fileHash,
    err,
    warn,
    console
  } = ctx

  function checkV6() {
    try {
      const out = execSync('npm pack --dry-run --json', {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      })
      const arr = JSON.parse(out)
      const files = arr[0]?.files?.map(file => file.path) || []
      const packName = arr[0]?.name || ''
      const packFilename = arr[0]?.filename || ''
      const pkg = JSON.parse(read(path.join(ROOT, 'package.json')))
      const plugin = JSON.parse(read(path.join(ROOT, 'plugin.json')))
      const packageFiles = new Set((pkg.files || []).filter(item => !item.endsWith('/')))
      const pluginFiles = new Set((plugin.skills || []).map(item => item.file).filter(Boolean))
      const promptFiles = walk(path.join(ROOT, 'prompts'))
        .filter(file => file.endsWith('.prompt.md'))
        .map(file => path.relative(ROOT, file).replace(/\\/g, '/'))
      const dataTemplateFiles = walk(path.join(ROOT, 'data', 'templates'))
        .filter(file => file.endsWith('.md'))
        .map(file => path.relative(ROOT, file).replace(/\\/g, '/'))
      const required = [
        'instructions.md',
        'plugin.json',
        '.mcp.json',
        'codex/hooks.json',
        'hooks/devcodex.lifecycle.json',
        'hooks/_runtime/lifecycle.cjs',
        'mcp/memory-server.js',
        'mcp/profile-server.js',
        'scripts/instruction-fallback-check.js',
        'scripts/migrate-layout.js',
        'assets/icon-512.png'
      ]
        .concat([...packageFiles], [...pluginFiles], promptFiles, dataTemplateFiles)
        .filter(file => file && !file.endsWith('/'))
      const forbidden = files.filter(file =>
        ((/^assets\/hooks\//i.test(file) && file !== 'assets/hooks/README.md') ||
          /violations\.md$/i.test(file) ||
          /pending-fixes\.md$/i.test(file) ||
          /process-improvements\.md$/i.test(file) ||
          /pending-issues\.md$/i.test(file) ||
          /gap-registry\.md$/i.test(file)) &&
        !file.startsWith('data/templates/')
      )
      const missingRequired = required.filter(file => !files.includes(file))
      if (forbidden.length) {
        err(`[V6] Forbidden files in pack: ${forbidden.join(', ')}`)
      }
      if (missingRequired.length) {
        err(`[V6] Missing required package assets in pack: ${missingRequired.join(', ')}`)
      }

      const hookConfig = JSON.parse(read(path.join(ROOT, 'hooks/devcodex.lifecycle.json')))
      const hookCommands = Object.values(hookConfig.hooks).flat().map(entry => entry.command)
      const expectedCommand = 'node ./.github/hooks/_runtime/lifecycle.cjs'
      const invalidCommands = hookCommands.filter(command => command !== expectedCommand)
      if (invalidCommands.length) {
        err(`[V6] Copilot hook commands must use workspace runtime path: ${invalidCommands.join(', ')}`)
      }

      const indexSrc = read(path.join(ROOT, 'index.js'))
      if (!/const\s+CLAUDE_HOOK_COMMAND\s*=/.test(indexSrc)) {
        err('[V6] Claude Code adapter missing CLAUDE_HOOK_COMMAND constant in index.js (required for hooks settings.json injection)')
      } else {
        const claudeHookMatch = indexSrc.match(/CLAUDE_HOOK_COMMAND\s*=\s*`([^`]+)`/)
        if (claudeHookMatch && !/process\.cwd\(\)|while\s*\(/.test(claudeHookMatch[1])) {
          err('[V6] CLAUDE_HOOK_COMMAND must use upward-walk pattern (cwd→parent→...→root) to survive subdir invocation; relative `.claude/hooks/_runtime/lifecycle.cjs` alone fails')
        }
      }
      if (!/CLAUDE_SETTINGS_HOOKS/.test(indexSrc)) {
        err('[V6] Claude Code adapter missing CLAUDE_SETTINGS_HOOKS constant in index.js (required to write .claude/settings.json)')
      }

      const codexHookConfig = JSON.parse(read(path.join(ROOT, 'codex/hooks.json')))
      const codexHookCommands = Object.values(codexHookConfig.hooks || {})
        .flat()
        .flatMap(entry => entry.command ? [entry.command] : (entry.hooks || []).map(hook => hook.command).filter(Boolean))
      const expectedCodexCommand = 'node ./.codex/hooks/_runtime/lifecycle.cjs'
      const invalidCodexCommands = codexHookCommands.filter(command => command !== expectedCodexCommand)
      if (!codexHookCommands.length || invalidCodexCommands.length) {
        err(`[V6] Codex hook commands must use workspace runtime path: ${invalidCodexCommands.join(', ') || '(none found)'}`)
      }
      const codexPreCompactEntries = codexHookConfig.hooks?.PreCompact || []
      if (!Array.isArray(codexPreCompactEntries) || !codexPreCompactEntries.length) {
        err('[V6] Codex hooks.json missing PreCompact event for compaction guardrail')
      } else if (!JSON.stringify(codexPreCompactEntries).includes('manual|auto')) {
        err('[V6] Codex PreCompact hook must match manual|auto compaction triggers')
      }
      for (const probe of ['CODEX_SOURCES', 'CODEX_HOOK_COMMAND', 'cmdInitCodex', '--codex']) {
        if (!indexSrc.includes(probe)) {
          err(`[V6] Codex adapter missing index.js probe: ${probe}`)
        }
      }

      const combined = files.join('\n') + '\n' + packName + '\n' + packFilename
      if (/schema-dsl|vext-test/.test(combined)) {
        err('[V6] Pack contains real project names (schema-dsl/vext-test)')
      }
      console.log(`[V6] pack contains ${files.length} files, no forbidden content`)
    } catch (error) {
      const detail = String((error.stderr || error.stdout || error.message || ''))
        .trim()
        .split('\n')
        .slice(0, 8)
        .join(' | ')
      warn(`[V6] npm pack failed: ${detail}`)
    }
  }

  function checkV8() {
    const parentRoot = path.dirname(ROOT)
    const claudeDir = path.join(parentRoot, '.claude')
    const githubDir = path.join(parentRoot, '.github')
    const agentsDir = path.join(parentRoot, '.agents')
    const codexDir = path.join(parentRoot, '.codex')
    const claudeExists = fs.existsSync(claudeDir)
    const githubExists = fs.existsSync(githubDir)
    const codexExists = fs.existsSync(path.join(parentRoot, 'AGENTS.md')) || fs.existsSync(agentsDir) || fs.existsSync(codexDir)
    const sourceClaudeDir = path.join(ROOT, '.claude')
    const sourceGithubDir = path.join(ROOT, '.github')
    const sourceAgentsDir = path.join(ROOT, '.agents')
    const sourceCodexDir = path.join(ROOT, '.codex')
    const sourceClaudeExists = fs.existsSync(path.join(ROOT, 'CLAUDE.md')) || fs.existsSync(sourceClaudeDir)
    const sourceGithubExists = fs.existsSync(sourceGithubDir)
    const sourceCodexExists = fs.existsSync(path.join(ROOT, 'AGENTS.md')) || fs.existsSync(sourceAgentsDir) || fs.existsSync(sourceCodexDir)

    if (!claudeExists && !githubExists && !codexExists && !sourceClaudeExists && !sourceGithubExists && !sourceCodexExists) {
      console.log('[V8] no parent/source-root deployment (.claude/ / .github/ / Codex adapter) detected — skip')
      return
    }

    const checkPairs = [
      { src: 'instructions/00-safety.instructions.md', claude: 'instructions/00-safety.instructions.md', github: 'instructions/00-safety.instructions.md' },
      { src: 'instructions/01-common.instructions.md', claude: 'instructions/01-common.instructions.md', github: 'instructions/01-common.instructions.md' },
      { src: 'instructions/02-output-paths.instructions.md', claude: 'instructions/02-output-paths.instructions.md', github: 'instructions/02-output-paths.instructions.md' },
      { src: 'instructions/10-dev.instructions.md', claude: 'instructions/10-dev.instructions.md', github: 'instructions/10-dev.instructions.md' },
      { src: 'instructions/11-fix.instructions.md', claude: 'instructions/11-fix.instructions.md', github: 'instructions/11-fix.instructions.md' },
      { src: 'instructions/12-audit.instructions.md', claude: 'instructions/12-audit.instructions.md', github: 'instructions/12-audit.instructions.md' },
      { src: 'instructions/13-analyze.instructions.md', claude: 'instructions/13-analyze.instructions.md', github: 'instructions/13-analyze.instructions.md' },
      { src: 'instructions/14-self-fix.instructions.md', claude: 'instructions/14-self-fix.instructions.md', github: 'instructions/14-self-fix.instructions.md' },
      { src: 'instructions/15-memory.instructions.md', claude: 'instructions/15-memory.instructions.md', github: 'instructions/15-memory.instructions.md' },
      { src: 'instructions/16-report.instructions.md', claude: 'instructions/16-report.instructions.md', github: 'instructions/16-report.instructions.md' },
      { src: 'instructions/17-compliance.instructions.md', claude: 'instructions/17-compliance.instructions.md', github: 'instructions/17-compliance.instructions.md' },
      { src: 'instructions/18-spec-radar.instructions.md', claude: 'instructions/18-spec-radar.instructions.md', github: 'instructions/18-spec-radar.instructions.md' },
      { src: 'skills/cp-gate/SKILL.md', claude: 'skills/cp-gate/SKILL.md', github: 'skills/cp-gate/SKILL.md' },
      { src: 'skills/report/SKILL.md', claude: 'skills/report/SKILL.md', github: 'skills/report/SKILL.md' },
      { src: 'skills/compliance/SKILL.md', claude: 'skills/compliance/SKILL.md', github: 'skills/compliance/SKILL.md' },
      { src: 'skills/memory/SKILL.md', claude: 'skills/memory/SKILL.md', github: 'skills/memory/SKILL.md' },
      { src: 'skills/audit-common/SKILL.md', claude: 'skills/audit-common/SKILL.md', github: 'skills/audit-common/SKILL.md' },
      { src: 'skills/audit-session/SKILL.md', claude: 'skills/audit-session/SKILL.md', github: 'skills/audit-session/SKILL.md' },
      { src: 'skills/intent/SKILL.md', claude: 'skills/intent/SKILL.md', github: 'skills/intent/SKILL.md' },
      { src: 'skills/routing/SKILL.md', claude: 'skills/routing/SKILL.md', github: 'skills/routing/SKILL.md' },
      { src: 'prompts/precheck-status.prompt.md', claude: 'prompts/precheck-status.prompt.md', github: 'prompts/precheck-status.prompt.md' },
      { src: 'prompts/token-setup.prompt.md', claude: 'prompts/token-setup.prompt.md', github: 'prompts/token-setup.prompt.md' },
      { src: 'prompts/reply-summary.prompt.md', claude: 'prompts/reply-summary.prompt.md', github: 'prompts/reply-summary.prompt.md' },
      { src: 'prompts/memory-session.prompt.md', claude: 'prompts/memory-session.prompt.md', github: 'prompts/memory-session.prompt.md' },
      { src: 'prompts/api-verification.prompt.md', claude: 'prompts/api-verification.prompt.md', github: 'prompts/api-verification.prompt.md' },
      { src: 'prompts/report-analysis.prompt.md', claude: 'prompts/report-analysis.prompt.md', github: 'prompts/report-analysis.prompt.md' },
      { src: 'prompts/report-dev.prompt.md', claude: 'prompts/report-dev.prompt.md', github: 'prompts/report-dev.prompt.md' },
      { src: 'prompts/report-fix.prompt.md', claude: 'prompts/report-fix.prompt.md', github: 'prompts/report-fix.prompt.md' },
      { src: 'prompts/report-optimization.prompt.md', claude: 'prompts/report-optimization.prompt.md', github: 'prompts/report-optimization.prompt.md' },
      { src: 'prompts/report-scenario-test.prompt.md', claude: 'prompts/report-scenario-test.prompt.md', github: 'prompts/report-scenario-test.prompt.md' },
      { src: 'hooks/_runtime/lifecycle.cjs', claude: 'hooks/_runtime/lifecycle.cjs', github: 'hooks/_runtime/lifecycle.cjs' },
      { src: 'mcp/memory-server.js', claude: 'mcp/memory-server.js', github: null },
      { src: 'mcp/profile-server.js', claude: 'mcp/profile-server.js', github: null },
      { src: 'instructions.md', claude: '../CLAUDE.md', github: null }
    ]
    const seenPairs = new Set(checkPairs.map(pair => pair.src))

    function addPair(src, claude = src, github = src) {
      if (seenPairs.has(src)) return
      seenPairs.add(src)
      checkPairs.push({ src, claude, github })
    }

    for (const dir of ['instructions', 'skills', 'prompts']) {
      for (const file of walk(path.join(ROOT, dir)).filter(file => file.endsWith('.md'))) {
        const rel = path.relative(ROOT, file).replace(/\\/g, '/')
        addPair(rel)
      }
    }
    for (const file of walk(path.join(ROOT, 'data', 'templates')).filter(file => file.endsWith('.md'))) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/')
      addPair(rel, rel.replace(/^data\/templates\//, 'data/'), rel.replace(/^data\/templates\//, 'data/'))
    }
    for (const file of walk(path.join(ROOT, 'agents')).filter(file => file.endsWith('.md'))) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/')
      addPair(rel, null, rel)
    }
    addPair('RULES.md', null, 'RULES.md')
    addPair('hooks/devcodex.lifecycle.json', null, 'hooks/devcodex.lifecycle.json')

    let stale = 0
    function compareDeployment(srcRel, destPath, label, fixHint) {
      const srcPath = path.join(ROOT, srcRel)
      if (!fs.existsSync(srcPath)) return
      if (!fs.existsSync(destPath)) {
        warn(`[V8] ${label} missing (run: ${fixHint})`)
        stale++
        return
      }
      if (fileHash(destPath) !== fileHash(srcPath)) {
        warn(`[V8] ${label} stale (run: ${fixHint})`)
        stale++
      }
    }

    for (const pair of checkPairs) {
      const srcPath = path.join(ROOT, pair.src)
      if (!fs.existsSync(srcPath)) continue

      if (claudeExists && pair.claude) {
        const dest = path.join(claudeDir, pair.claude)
        if (fs.existsSync(dest)) {
          if (fileHash(dest) !== fileHash(srcPath)) {
            warn(`[V8] .claude/ stale: ${pair.claude} (run: npx devcodex update --claude)`)
            stale++
          }
        } else {
          warn(`[V8] .claude/ missing: ${pair.claude} (source repo has v1.9.2+ addition)`)
          stale++
        }
      }

      if (githubExists && pair.github) {
        const dest = path.join(githubDir, pair.github)
        if (fs.existsSync(dest)) {
          if (fileHash(dest) !== fileHash(srcPath)) {
            warn(`[V8] .github/ stale: ${pair.github} (run: npx devcodex update)`)
            stale++
          }
        } else {
          warn(`[V8] .github/ missing: ${pair.github}`)
          stale++
        }
      }
    }

    if (githubExists) {
      compareDeployment(
        'instructions.md',
        path.join(githubDir, 'copilot-instructions.md'),
        '.github/copilot-instructions.md',
        'npx devcodex update'
      )
    }

    if (codexExists) {
      compareDeployment('instructions.md', path.join(parentRoot, 'AGENTS.md'), 'AGENTS.md', 'npx devcodex update --codex')
      compareDeployment('codex/hooks.json', path.join(codexDir, 'hooks.json'), '.codex/hooks.json', 'npx devcodex update --codex')

      for (const file of walk(path.join(ROOT, 'skills'))) {
        const rel = path.relative(path.join(ROOT, 'skills'), file)
        compareDeployment(
          path.join('skills', rel).replace(/\\/g, '/'),
          path.join(agentsDir, 'skills', rel),
          `.agents/skills/${rel.replace(/\\/g, '/')}`,
          'npx devcodex update --codex'
        )
      }
      for (const file of walk(path.join(ROOT, 'hooks', '_runtime'))) {
        const rel = path.relative(path.join(ROOT, 'hooks', '_runtime'), file)
        compareDeployment(
          path.join('hooks/_runtime', rel).replace(/\\/g, '/'),
          path.join(codexDir, 'hooks', '_runtime', rel),
          `.codex/hooks/_runtime/${rel.replace(/\\/g, '/')}`,
          'npx devcodex update --codex'
        )
      }

      const codexRuntime = path.join(codexDir, 'hooks', '_runtime', 'lifecycle.cjs')
      if (fs.existsSync(codexRuntime)) {
        try {
          const probePrompt = `in ${path.basename(ROOT)}/ validate DevCodex Codex bootstrap`
          const out = execSync('node ./.codex/hooks/_runtime/lifecycle.cjs', {
            cwd: parentRoot,
            input: JSON.stringify({ hookEventName: 'UserPromptSubmit', prompt: probePrompt }),
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
          })
          const payload = JSON.parse(out || '{}')
          const context = payload.hookSpecificOutput?.additionalContext || ''
          if (!payload.systemMessage || !/PC0-PC7/.test(context) || payload.hookSpecificOutput?.hookEventName !== 'UserPromptSubmit') {
            warn('[V8] Codex UserPromptSubmit output missing systemMessage/additionalContext PC0-PC7 bootstrap context')
            stale++
          }
        } catch (error) {
          warn(`[V8] Codex hook semantic probe failed: ${String(error.message || error).split('\n')[0]}`)
          stale++
        }
      }
    }

    if (sourceClaudeExists || sourceGithubExists || sourceCodexExists) {
      for (const pair of checkPairs) {
        const srcPath = path.join(ROOT, pair.src)
        if (!fs.existsSync(srcPath)) continue

        if (sourceClaudeExists && pair.claude) {
          const dest = path.join(sourceClaudeDir, pair.claude)
          if (fs.existsSync(dest)) {
            if (fileHash(dest) !== fileHash(srcPath)) {
              warn(`[V8] source-root .claude/ stale: ${pair.claude} (run from source repo: node ./index.js update --claude)`)
              stale++
            }
          } else {
            warn(`[V8] source-root .claude/ missing: ${pair.claude} (run from source repo: node ./index.js update --claude)`)
            stale++
          }
        }

        if (sourceGithubExists && pair.github) {
          const dest = path.join(sourceGithubDir, pair.github)
          if (fs.existsSync(dest)) {
            if (fileHash(dest) !== fileHash(srcPath)) {
              warn(`[V8] source-root .github/ stale: ${pair.github} (run from source repo: node ./index.js update)`)
              stale++
            }
          } else {
            warn(`[V8] source-root .github/ missing: ${pair.github}`)
            stale++
          }
        }
      }

      if (sourceGithubExists) {
        compareDeployment(
          'instructions.md',
          path.join(sourceGithubDir, 'copilot-instructions.md'),
          'source-root .github/copilot-instructions.md',
          'node ./index.js update'
        )
      }

      if (sourceCodexExists) {
        compareDeployment('instructions.md', path.join(ROOT, 'AGENTS.md'), 'source-root AGENTS.md', 'node ./index.js update --codex')
        compareDeployment('codex/hooks.json', path.join(sourceCodexDir, 'hooks.json'), 'source-root .codex/hooks.json', 'node ./index.js update --codex')

        for (const file of walk(path.join(ROOT, 'skills'))) {
          const rel = path.relative(path.join(ROOT, 'skills'), file)
          compareDeployment(
            path.join('skills', rel).replace(/\\/g, '/'),
            path.join(sourceAgentsDir, 'skills', rel),
            `source-root .agents/skills/${rel.replace(/\\/g, '/')}`,
            'node ./index.js update --codex'
          )
        }
        for (const file of walk(path.join(ROOT, 'hooks', '_runtime'))) {
          const rel = path.relative(path.join(ROOT, 'hooks', '_runtime'), file)
          compareDeployment(
            path.join('hooks/_runtime', rel).replace(/\\/g, '/'),
            path.join(sourceCodexDir, 'hooks', '_runtime', rel),
            `source-root .codex/hooks/_runtime/${rel.replace(/\\/g, '/')}`,
            'node ./index.js update --codex'
          )
        }
      }
    }

    if (stale === 0) {
      console.log('[V8] parent/source-root deployment (.claude/ / .github/ / Codex adapter) in sync with source repo')
    } else {
      console.log(`[V8] parent/source-root deployment has ${stale} stale/missing file(s) — see warnings`)
    }
  }

  return {
    checkV6,
    checkV8
  }
}

module.exports = { buildGovernancePackageDeploymentChecks }
