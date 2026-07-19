'use strict'

const { readManifest, verifyManifest } = require('./deployment-manifest-utils')
const { createSkillDeployFileFilter } = require('./skill-deploy-filter')

function shouldCheckBaseDeploymentSource(relativePath) {
  return !String(relativePath).replace(/\\/g, '/').startsWith('instructions/tenants/')
}

function isExactWorkspaceBridge(root, fsImpl, pathImpl) {
  const source = pathImpl.join(root, 'host-projections', 'AGENTS.workspace-bridge.md')
  const target = pathImpl.join(root, 'AGENTS.md')
  if (!fsImpl.existsSync(source) || !fsImpl.existsSync(target)) return false
  try {
    return fsImpl.readFileSync(source).equals(fsImpl.readFileSync(target))
  } catch {
    return false
  }
}

function findSourceRootHostDeployments(root, fsImpl, pathImpl, walkFn) {
  const candidates = [
    { label: 'source-root CLAUDE.md', target: pathImpl.join(root, 'CLAUDE.md') },
    { label: 'source-root AGENTS.md', target: pathImpl.join(root, 'AGENTS.md') },
    { label: 'source-root .claude/', target: pathImpl.join(root, '.claude') },
    { label: 'source-root .agents/', target: pathImpl.join(root, '.agents') },
    { label: 'source-root .codex/', target: pathImpl.join(root, '.codex') }
  ]
  const exactWorkspaceBridge = isExactWorkspaceBridge(root, fsImpl, pathImpl)
  const deployments = candidates.filter(entry => {
    if (!fsImpl.existsSync(entry.target)) return false
    return !(entry.label === 'source-root AGENTS.md' && exactWorkspaceBridge)
  })
  const githubRoot = pathImpl.join(root, '.github')
  if (fsImpl.existsSync(githubRoot)) {
    const nonWorkflowFiles = walkFn(githubRoot).filter(file => {
      const relative = pathImpl.relative(githubRoot, file).replace(/\\/g, '/')
      return !relative.startsWith('workflows/')
    })
    if (nonWorkflowFiles.length) deployments.push({ label: 'source-root .github/ host deployment', target: githubRoot })
  }
  return deployments
}

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
    console,
    ACTIVE_DEVCODEX_ROOT,
    TARGET_DEPLOYMENT_RUNTIME_ROOT
  } = ctx
  const skillDeployFileFilter = createSkillDeployFileFilter(ROOT)

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
      // package.json "files" globs (e.g. skills/*/**) expand at pack time; do not require them as literal paths
      const packageFiles = new Set((pkg.files || []).filter(item => !item.endsWith('/') && !String(item).includes('*')))
      const pluginFiles = new Set((plugin.skills || []).map(item => item.file).filter(Boolean))
      function resolveLocalDependency(fromFile, request) {
        const resolved = path.normalize(path.join(path.dirname(fromFile), request)).replace(/\\/g, '/')
        if (path.extname(resolved)) return resolved
        if (fs.existsSync(path.join(ROOT, `${resolved}.js`))) return `${resolved}.js`
        if (fs.existsSync(path.join(ROOT, resolved, 'index.js'))) return `${resolved}/index.js`
        return `${resolved}.js`
      }
      function collectRuntimeDependencies(file, seen = new Set()) {
        if (seen.has(file)) return []
        seen.add(file)
        const fullPath = path.join(ROOT, file)
        if (!fs.existsSync(fullPath)) return [file]
        const content = read(fullPath)
        const deps = []
        for (const match of content.matchAll(/require\(['"](\.{1,2}\/[^'"]+)['"]\)/g)) {
          deps.push(resolveLocalDependency(file, match[1]))
        }
        for (const match of content.matchAll(/path\.join\(\s*ROOT\s*,\s*((?:['"][^'"]+['"]\s*,?\s*)+)\)/g)) {
          const parts = Array.from(match[1].matchAll(/['"]([^'"]+)['"]/g)).map(item => item[1])
          if (parts[0] === 'scripts' && /\.js$/.test(parts[parts.length - 1] || '')) {
            deps.push(parts.join('/'))
          }
        }
        return Array.from(new Set(
          deps.flatMap(dep => [dep].concat(collectRuntimeDependencies(dep, seen)))
        ))
      }
      const packagedScripts = [...packageFiles].filter(file => file.startsWith('scripts/') && file.endsWith('.js'))
      const packagedScriptDeps = packagedScripts.flatMap(file => collectRuntimeDependencies(file))
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
        .concat([...packageFiles], [...pluginFiles], promptFiles, dataTemplateFiles, collectRuntimeDependencies('index.js'), packagedScriptDeps)
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

      const indexSrc = [
        'index.js',
        'scripts/lib/cli-install-commands.js',
        'scripts/lib/cli-maintenance-commands.js',
        'scripts/lib/cli-command-registry.js'
      ].map(file => read(path.join(ROOT, file))).join('\n')
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
      // Monorepo-safe parent-walk (parity with CLAUDE_HOOK_COMMAND); relative ./.codex/... alone fails in subdirs
      const invalidCodexCommands = codexHookCommands.filter(command => !(
        /process\.cwd\(\)/.test(command) &&
        /while\s*\(/.test(command) &&
        /\.codex/.test(command) &&
        /lifecycle\.cjs/.test(command)
      ))
      if (!codexHookCommands.length || invalidCodexCommands.length) {
        err(`[V6] Codex hook commands must use upward-walk monorepo-safe path: ${invalidCodexCommands.join(', ') || '(none found)'}`)
      }
      {
        const codexHookMatch = indexSrc.match(/CODEX_HOOK_COMMAND\s*=\s*`([^`]+)`/)
        if (!codexHookMatch || !/process\.cwd\(\)/.test(codexHookMatch[1]) || !/while\s*\(/.test(codexHookMatch[1])) {
          err('[V6] CODEX_HOOK_COMMAND must use upward-walk pattern (cwd→parent→...→root) to survive subdir invocation')
        }
      }
      const codexPreCompactEntries = codexHookConfig.hooks?.PreCompact || []
      if (!Array.isArray(codexPreCompactEntries) || !codexPreCompactEntries.length) {
        err('[V6] Codex hooks.json missing PreCompact event for compaction guardrail')
      } else if (!JSON.stringify(codexPreCompactEntries).includes('manual|auto')) {
        err('[V6] Codex PreCompact hook must match manual|auto compaction triggers')
      }
      for (const probe of ['CODEX_SOURCES', 'CODEX_HOOK_COMMAND', 'cmdInitCodex', '--codex']) {
        if (!indexSrc.includes(probe)) {
          err(`[V6] Codex adapter missing CLI composition probe: ${probe}`)
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
    if (process.env.DEVCODEX_VALIDATION_SCOPE === 'source') {
      console.log('[V8] source validation scope — workspace deployment parity deferred to profile-deploy route')
      return
    }
    const parentRoot = path.dirname(ROOT)
    const claudeDir = path.join(parentRoot, '.claude')
    const githubDir = path.join(parentRoot, '.github')
    const agentsDir = path.join(parentRoot, '.agents')
    const codexDir = path.join(parentRoot, '.codex')
    const claudeExists = fs.existsSync(claudeDir)
    const githubExists = fs.existsSync(githubDir)
    const codexExists = fs.existsSync(path.join(parentRoot, 'AGENTS.md')) || fs.existsSync(agentsDir) || fs.existsSync(codexDir)
    const sourceRootDeployments = findSourceRootHostDeployments(ROOT, fs, path, walk)

    if (sourceRootDeployments.length) {
      err(
        `[V8] source-root deployment must not exist: ${sourceRootDeployments.map(entry => entry.label).join(', ')}; ` +
        'single active deployment target is the parent/target workspace root. Run update from the target workspace root, not from the source repo.'
      )
    }

    if (!claudeExists && !githubExists && !codexExists) {
      console.log('[V8] no parent deployment (.claude/ / .github/ / Codex adapter) detected — skip')
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
      { src: 'host-projections/CLAUDE.md', claude: '../CLAUDE.md', github: null }
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
        if (!shouldCheckBaseDeploymentSource(rel)) continue
        if (rel.startsWith('skills/') && !skillDeployFileFilter(rel.slice('skills/'.length))) continue
        addPair(rel)
      }
    }
    for (const file of walk(path.join(ROOT, 'data', 'templates')).filter(file => file.endsWith('.md'))) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/')
      addPair(rel, rel.replace(/^data\/templates\//, 'data/'), rel.replace(/^data\/templates\//, 'data/'))
    }
    for (const file of walk(path.join(ROOT, 'hooks', '_runtime'))) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/')
      addPair(rel)
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
        'host-projections/copilot-instructions.md',
        path.join(githubDir, 'copilot-instructions.md'),
        '.github/copilot-instructions.md',
        'npx devcodex update'
      )
    }

    if (codexExists) {
      compareDeployment('host-projections/AGENTS.md', path.join(parentRoot, 'AGENTS.md'), 'AGENTS.md', 'npx devcodex update --codex')
      compareDeployment('codex/hooks.json', path.join(codexDir, 'hooks.json'), '.codex/hooks.json', 'npx devcodex update --codex')

      for (const file of walk(path.join(ROOT, 'skills'))) {
        const rel = path.relative(path.join(ROOT, 'skills'), file)
        if (!skillDeployFileFilter(rel)) continue
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

    const manifestFile = path.join(TARGET_DEPLOYMENT_RUNTIME_ROOT || ACTIVE_DEVCODEX_ROOT, 'managed', 'deployment-manifest.json')
    if (fs.existsSync(manifestFile)) {
      try {
        const manifest = readManifest(manifestFile)
        if (path.resolve(manifest.targetRoot) !== path.resolve(parentRoot)) {
          err(`[V8] managed manifest targetRoot mismatch: ${manifest.targetRoot} != ${parentRoot}`)
          stale++
        }
        const result = verifyManifest({ packageRoot: ROOT, targetRoot: parentRoot, manifest })
        for (const destination of result.missing) {
          err(`[V8] managed manifest missing source/destination: ${destination}`)
          stale++
        }
        for (const destination of result.mismatched) {
          err(`[V8] managed manifest hash mismatch: ${destination}`)
          stale++
        }
        for (const destination of result.staleExisting) {
          err(`[V8] stale managed entry still exists (preview only; do not auto-delete): ${destination}`)
          stale++
        }
      } catch (error) {
        err(`[V8] managed manifest invalid: ${String(error.message || error)}`)
        stale++
      }
    } else {
      warn(`[V8] managed manifest missing at active-root: ${manifestFile} (run update from target workspace root)`)
      stale++
    }

    if (stale === 0) {
      console.log('[V8] parent deployment (.claude/ / .github/ / Codex adapter) in sync with source repo')
    } else {
      console.log(`[V8] parent deployment has ${stale} stale/missing file(s) — see warnings`)
    }
  }

  return {
    checkV6,
    checkV8
  }
}

module.exports = {
  buildGovernancePackageDeploymentChecks,
  findSourceRootHostDeployments,
  isExactWorkspaceBridge,
  shouldCheckBaseDeploymentSource
}
