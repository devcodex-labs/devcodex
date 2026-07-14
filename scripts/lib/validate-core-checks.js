'use strict'

function buildValidateCoreChecks(ctx) {
  const {
    ROOT,
    ACTIVE_DEVCODEX_ROOT,
    TARGET_DEPLOYMENT_RUNTIME_ROOT,
    RECENT_REQUIREMENT_ARTIFACT_DAYS,
    collectRecentBugArtifactIssues,
    collectRecentRequirementArtifactIssues,
    fs,
    os,
    path,
    crypto,
    execSync,
    execFileSync,
    read,
    err,
    warn,
    walk,
    fileHash,
    activePath,
    resolveActiveDevcodexRoot,
    readJsonIfExists,
    mustInclude,
    mustNotInclude
  } = ctx

  function checkV1() {
    const instructionFiles = walk(path.join(ROOT, 'instructions'))
      .filter(f => f.endsWith('.instructions.md'))
    for (const f of instructionFiles) {
      const content = read(f)
      const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
      if (!fm) {
        err(`[V1] Missing frontmatter: ${path.relative(ROOT, f)}`)
        continue
      }
      if (!/^applyTo:\s*["'].+["']/m.test(fm[1])) {
        err(`[V1] Missing applyTo in: ${path.relative(ROOT, f)}`)
      }
      if (!/^description:\s*.+/m.test(fm[1])) {
        err(`[V1] Missing description in: ${path.relative(ROOT, f)}`)
      }
      if (!/^priority:\s*P[1-5](?:\.[0-9]+)?/m.test(fm[1])) {
        err(`[V1] Missing or invalid priority in: ${path.relative(ROOT, f)}`)
      }
      if (!/^version:\s*\d+\.\d+\.\d+/m.test(fm[1])) {
        err(`[V1] Missing or invalid version in: ${path.relative(ROOT, f)}`)
      }
    }
    const skillFiles = walk(path.join(ROOT, 'skills'))
      .filter(f => path.basename(f) === 'SKILL.md')
    for (const f of skillFiles) {
      const content = read(f)
      const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
      if (!fm) {
        err(`[V1] Missing frontmatter: ${path.relative(ROOT, f)}`)
        continue
      }
      if (!/^name:\s*\S+/m.test(fm[1])) {
        err(`[V1] Missing name in: ${path.relative(ROOT, f)}`)
      }
      if (!/^description:/m.test(fm[1])) {
        err(`[V1] Missing description in: ${path.relative(ROOT, f)}`)
      }
    }
    console.log(`[V1] frontmatter checked: ${instructionFiles.length} instructions + ${skillFiles.length} skills`)
  }

  function checkV2() {
    const roots = ['instructions', 'skills', 'prompts', 'website/docs', 'changelogs']
    const topFiles = ['README.md', 'CHANGELOG.md', 'RULES.md']
    const files = roots.flatMap(r => walk(path.join(ROOT, r))).filter(f => f.endsWith('.md'))
      .concat(topFiles.map(f => path.join(ROOT, f)).filter(f => fs.existsSync(f)))
    let checked = 0
    let historicalRuntimeEvidenceSkipped = 0
    for (const f of files) {
      let content = read(f)
      // strip fenced code blocks and inline code to avoid matching links in examples/templates
      content = content.replace(/```[\s\S]*?```/g, '')
      content = content.replace(/`[^`\n]+`/g, '')
      const linkRe = /\]\(([^)]+)\)/g
      let m
      while ((m = linkRe.exec(content))) {
        const target = m[1].split('#')[0].trim()
        if (!target || /^https?:|^mailto:|^file:/.test(target)) continue
        const base = path.dirname(f)
        const abs = path.resolve(base, target)
        const normalizedTarget = target.replace(/\\/g, '/')
        const relativeSource = path.relative(ROOT, f).replace(/\\/g, '/')
        const isHistoricalRuntimeEvidence = relativeSource.startsWith('changelogs/releases/') &&
          normalizedTarget.split('/').includes('.devcodex')
        if (target.endsWith('.md') && !fs.existsSync(abs) && isHistoricalRuntimeEvidence) {
          historicalRuntimeEvidenceSkipped++
        } else if (target.endsWith('.md') && !fs.existsSync(abs)) {
          warn(`[V2] Broken link in ${path.relative(ROOT, f)}: ${target}`)
        }
        checked++
      }
    }
    console.log(`[V2] links scanned: ${checked}; historical runtime evidence unavailable: ${historicalRuntimeEvidenceSkipped}`)
  }

  function checkV3() {
    const commonContent = read(path.join(ROOT, 'instructions/01-common.instructions.md'))
    const routingContent = read(path.join(ROOT, 'skills/routing/SKILL.md'))
    const probes = [
      { token: 'dev.default', files: ['instructions/01-common.instructions.md', 'skills/routing/SKILL.md', 'instructions/10-dev.instructions.md'] },
      { token: 'dev.docs', files: ['instructions/01-common.instructions.md', 'skills/routing/SKILL.md', 'instructions/10-dev.instructions.md'] },
      { token: 'dev.refactor', files: ['instructions/01-common.instructions.md', 'skills/routing/SKILL.md'] },
      { token: 'dev.database', files: ['instructions/01-common.instructions.md', 'skills/routing/SKILL.md'] },
      { token: 'dev.optimization', files: ['instructions/01-common.instructions.md', 'skills/routing/SKILL.md'] },
      { token: 'dev.scenario-test', files: ['instructions/01-common.instructions.md', 'skills/routing/SKILL.md'] },
      { token: 'dev.plan-review', files: ['instructions/01-common.instructions.md', 'skills/routing/SKILL.md'] },
      { token: 'fix.default', files: ['instructions/01-common.instructions.md', 'skills/routing/SKILL.md', 'instructions/11-fix.instructions.md'] },
      { token: 'fix.security', files: ['instructions/01-common.instructions.md', 'skills/routing/SKILL.md'] },
      { token: 'analyze.default', files: ['instructions/01-common.instructions.md', 'skills/routing/SKILL.md', 'instructions/13-analyze.instructions.md', 'skills/analyze-default/SKILL.md', 'prompts/report-analysis.prompt.md'] },
      { token: 'analyze.research', files: ['skills/routing/SKILL.md', 'skills/analyze-research/SKILL.md', 'prompts/report-analysis.prompt.md'] }
    ]
    for (const probe of probes) {
      for (const file of probe.files) {
        const content = file === 'instructions/01-common.instructions.md'
          ? commonContent
          : file === 'skills/routing/SKILL.md'
            ? routingContent
            : read(path.join(ROOT, file))
        if (!content.includes(probe.token)) warn(`[V3] ${file} missing subtype token: ${probe.token}`)
      }
    }
    console.log('[V3] subtype sync checked (dev/fix/audit/analyze)')
  }

  function checkV4() {
    const pkg = JSON.parse(read(path.join(ROOT, 'package.json')))
    const plugin = JSON.parse(read(path.join(ROOT, 'plugin.json')))
    if (pkg.version !== plugin.version) {
      err(`[V4] package.json (${pkg.version}) ≠ plugin.json (${plugin.version})`)
    }
    const rulesContent = read(path.join(ROOT, 'RULES.md'))
    const rulesMatch = rulesContent.match(/版本[：: ]*v?(\d+\.\d+\.\d+)/)
    if (rulesMatch && rulesMatch[1] !== pkg.version) {
      warn(`[V4] RULES.md version (${rulesMatch[1]}) ≠ package.json (${pkg.version})`)
    }
    const secContent = read(path.join(ROOT, 'SECURITY.md'))
    const secMatch = secContent.match(/(\d+)\.(\d+)\.x/)
    if (secMatch) {
      const [major, minor] = pkg.version.split('.')
      if (secMatch[1] !== major || secMatch[2] !== minor) {
        warn(`[V4] SECURITY.md references ${secMatch[0]} but current is ${major}.${minor}.x`)
      }
    }
    console.log(`[V4] versions aligned at ${pkg.version}`)
  }

  function checkV5() {
    const files = walk(path.join(ROOT, 'instructions')).filter(f => f.endsWith('.md'))
    let defCount = 0
    const hits = []
    for (const f of files) {
      const content = read(f)
      const matches = content.match(/PC4 规范雷达：\[Axis A/g)
      if (matches) {
        defCount += matches.length
        hits.push(`${path.relative(ROOT, f)}×${matches.length}`)
      }
    }
    if (defCount > 1) {
      warn(`[V5] PC4 format defined ${defCount} times (expected 1): ${hits.join('; ')}`)
    }
    console.log(`[V5] PC4 format occurrences: ${defCount} (${hits.join('; ') || 'none'})`)
  }

  function checkV7() {
    try {
      execSync('node scripts/test-hooks-runtime.js', { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-v7-hooks-'))
      try {
        fs.mkdirSync(path.join(tmp, '.devcodex', 'profile'), { recursive: true })
        fs.writeFileSync(path.join(tmp, '.devcodex', 'profile', 'config.json'), JSON.stringify({ mode: 'dev', agent: 'codex' }))
        const runHook = (payload, env = {}) => JSON.parse(execFileSync(
          process.execPath,
          [path.join(ROOT, 'hooks', '_runtime', 'lifecycle.cjs')],
          { cwd: tmp, input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, ...env } }
        ) || '{}')
        runHook({ hookEventName: 'UserPromptSubmit', prompt: 'validate codex hook contract' }, { CODEX_HOME: '1' })
        runHook({
          hookEventName: 'PostToolUse',
          tool_name: 'apply_patch',
          tool_input: { input: '*** Begin Patch\n*** Add File: src/contract.js\n+contract\n*** End Patch' }
        }, { CODEX_HOME: '1' })
        const precompact = runHook(
          { hookEventName: 'PreCompact', assistantMessage: 'progress' },
          { CODEX_HOME: '1', DEVCODEX_HOOK_ENFORCEMENT: 'strict' }
        )
        if (precompact.continue !== false || precompact.hookSpecificOutput?.decision) {
          err('[V7] Codex PreCompact contract probe failed: expected continue:false without nested hookSpecificOutput.decision')
        }
        const stop = runHook(
          { hookEventName: 'Stop', assistantMessage: 'done' },
          { CODEX_HOME: '1', DEVCODEX_HOOK_ENFORCEMENT: 'strict' }
        )
        if (stop.decision !== 'block' || stop.hookSpecificOutput?.decision) {
          err('[V7] Codex Stop contract probe failed: expected top-level decision:block without nested hookSpecificOutput.decision')
        }
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true })
      }
      console.log('[V7] hooks runtime smoke test passed')
    } catch (e) {
      // F-013: 保留 stderr 前 8 行
      const detail = String((e.stderr || e.stdout || e.message || '')).trim().split('\n').slice(0, 8).join(' | ')
      err(`[V7] hooks runtime smoke test failed${detail ? `: ${detail}` : ''}`)
    }
  }

  function checkV9() {
    const roots = ['instructions', 'skills', 'prompts']
    const files = roots.flatMap(r => walk(path.join(ROOT, r))).filter(f => f.endsWith('.md'))
    let bad = 0
    const badRe = /\b(YYYY\/MM\/DD|MM-DD-YYYY|DD-MM-YYYY|YYYY\.MM\.DD)\b/g
    for (const f of files) {
      const content = read(f)
      const matches = content.match(badRe)
      if (matches) {
        warn(`[V9] non-standard date placeholder in ${path.relative(ROOT, f)}: ${[...new Set(matches)].join(', ')}`)
        bad += matches.length
      }
    }
    console.log(`[V9] date format scanned: ${files.length} files, ${bad} non-standard placeholder(s)`)
  }

  function checkV10() {
    const stateDir = activePath('.audit-state')
    if (!fs.existsSync(stateDir)) {
      console.log('[V10] no audit-state directory — skip')
      return
    }
    const stateFiles = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'))
    if (!stateFiles.length) {
      console.log('[V10] no audit-state files — skip')
      return
    }
    let totalProbes = 0
    let regressions = 0
    for (const sf of stateFiles) {
      let state
      try { state = JSON.parse(read(path.join(stateDir, sf))) } catch { continue }
      const probes = state.regressionProbes || []
      for (const probe of probes) {
        totalProbes++
        const normalized = normalizeRegressionProbe(probe)
        if (normalized.kind === 'skip') continue
        if (normalized.kind === 'invalid') {
          warn(`[V10] invalid probe on ${probe.findingId || 'unknown'}: ${normalized.reason}`)
          regressions++
          continue
        }
        const actual = countProbeMatches(normalized.pattern, normalized.files)
        if (actual !== normalized.expectedMatches) {
          warn(
            `[V10] regression on ${normalized.findingId}: expected ${normalized.expectedMatches}, ` +
            `got ${actual} (pattern: ${normalized.pattern}; files: ${normalized.files.join(', ')})`
          )
          regressions++
        }
      }
    }
    console.log(`[V10] regression probes: ${totalProbes} evaluated, ${regressions} regression(s)`)
  }

  function checkV11() {
    const roots = ['instructions', 'skills', 'prompts']
    const files = roots.flatMap(r => walk(path.join(ROOT, r))).filter(f => f.endsWith('.md'))
    let blocks = 0
    let violations = 0
    for (const f of files) {
      let content = read(f)
      content = content.replace(/```[\s\S]*?```/g, '')
      const optionBlocks = content.match(/(?:## 选项|\*\*选项\*\*)[\s\S]{0,800}/g) || []
      for (const blk of optionBlocks) {
        blocks++
        const recommended = (blk.match(/\(推荐\)|🟢/g) || []).length
        const reason = /推荐理由[:：]/.test(blk)
        if (recommended === 0) {
          warn(`[V11] decision block in ${path.relative(ROOT, f)} missing (推荐) marker (FC7)`)
          violations++
        } else if (!reason) {
          warn(`[V11] decision block in ${path.relative(ROOT, f)} missing "推荐理由：" prefix (FC7)`)
          violations++
        }
      }
    }
    console.log(`[V11] decision blocks scanned: ${blocks}, ${violations} FC7 violation(s)`)
  }

  function checkV12() {
    const legacy = path.join(ROOT, 'copilot-instructions.md')
    if (fs.existsSync(legacy)) {
      err(`[V12] legacy file 'copilot-instructions.md' must be removed (v1.9.8 single-source: use 'instructions.md')`)
    } else {
      console.log(`[V12] single-source check passed (no copilot-instructions.md in repo root)`)
    }
  }

  function checkV15() {
    const stateDir = activePath('.audit-state')
    if (!fs.existsSync(stateDir)) {
      console.log('[V15] no audit-state directory — skip')
      return
    }
    const stateFiles = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'))
    if (!stateFiles.length) {
      console.log('[V15] no audit-state files — skip')
      return
    }

    const allowedStates = new Set(['active', 'paused', 'resumed', 'converged', 'closed'])
    const allowedFindingStates = new Set(['open', 'pending', 'in-progress', 'fixed', 'wontfix', 'accepted', 'recorded', 'transferred', 'superseded'])
    const unresolvedFindingStates = new Set(['open', 'pending', 'in-progress'])
    let violations = 0

    for (const sf of stateFiles) {
      let state
      try { state = JSON.parse(read(path.join(stateDir, sf))) } catch {
        warn(`[V15] invalid JSON: .devcodex/.audit-state/${sf}`)
        violations++
        continue
      }

      if (!allowedStates.has(state.state)) {
        warn(`[V15] invalid state in .devcodex/.audit-state/${sf}: ${state.state || 'missing'}`)
        violations++
      }

      if (state.state === 'converged') {
        const convergedOk = state.zeroFindingStreak >= 3 && state.crsPassed === true && state.pcvPassed === true
        if (!convergedOk) {
          warn(
            `[V15] invalid converged gate in .devcodex/.audit-state/${sf}: ` +
            `zeroFindingStreak=${state.zeroFindingStreak}, crsPassed=${state.crsPassed}, pcvPassed=${state.pcvPassed}`
          )
          violations++
        }
      }

      if (Array.isArray(state.findings)) {
        for (const finding of state.findings) {
          const status = String(finding.status || '').toLowerCase()
          if (!allowedFindingStates.has(status)) {
            warn(`[V15] invalid finding status in .devcodex/.audit-state/${sf}: ${finding.id || 'unknown'}=${finding.status || 'missing'}`)
            violations++
          }
        }
      }

      if (state.state === 'converged' || state.state === 'closed') {
        const unresolved = Array.isArray(state.findings)
          ? state.findings.filter(finding => unresolvedFindingStates.has(String(finding.status || '').toLowerCase()))
          : []
        if (unresolved.length) {
          warn(`[V15] terminal audit-state has unresolved findings: .devcodex/.audit-state/${sf} (${unresolved.length})`)
          violations++
        }
      }

      if (state.state === 'paused') {
        const unresolved = Array.isArray(state.findings)
          ? state.findings.filter(finding => unresolvedFindingStates.has(String(finding.status || '').toLowerCase()))
          : []
        if (unresolved.length && (!state.linkedReport || !state.lastCheckpoint || !state.lastCheckpoint.reason)) {
          warn(`[V15] paused audit-state with unresolved findings must include linkedReport and lastCheckpoint.reason: .devcodex/.audit-state/${sf}`)
          violations++
        }
      }
    }

    console.log(`[V15] audit-state consistency checked: ${stateFiles.length} files, ${violations} violation(s)`)
  }

  function checkV16() {
    try {
      execSync('node scripts/test-mcp-servers.js', { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
      console.log('[V16] MCP servers smoke test passed')
    } catch (e) {
      const detail = String((e.stderr || e.stdout || e.message || '')).trim().split('\n').slice(0, 8).join(' | ')
      err(`[V16] MCP servers smoke test failed${detail ? `: ${detail}` : ''}`)
    }
  }

  function checkV17() {
    try {
      execSync('node scripts/validate-profile.js', { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
      console.log('[V17] profile drift check passed')
    } catch (e) {
      const detail = String((e.stderr || e.stdout || e.message || '')).trim().split('\n').slice(0, 8).join(' | ')
      err(`[V17] profile drift check failed${detail ? `: ${detail}` : ''}`)
    }
  }

  function checkV18() {
    let mcp
    try {
      mcp = JSON.parse(read(path.join(ROOT, '.mcp.json')))
    } catch (e) {
      err(`[V18] .mcp.json invalid JSON: ${e.message}`)
      return
    }

    if (!mcp.mcpServers || typeof mcp.mcpServers !== 'object') {
      err('[V18] .mcp.json must use Claude Code project schema root "mcpServers"')
    }
    if (Object.prototype.hasOwnProperty.call(mcp, 'servers')) {
      err('[V18] .mcp.json must not use VS Code-style root "servers" for Claude Code')
    }
    for (const name of ['devcodex-memory', 'devcodex-profile']) {
      const server = mcp.mcpServers && mcp.mcpServers[name]
      if (!server) {
        err(`[V18] .mcp.json missing MCP server: ${name}`)
        continue
      }
      const expectedScript = name === 'devcodex-memory'
        ? '.claude/mcp/memory-server.js'
        : '.claude/mcp/profile-server.js'
      if (server.command !== 'node') {
        err(`[V18] ${name} command must be node`)
      }
      if (!Array.isArray(server.args) || server.args.length !== 2) {
        err(`[V18] ${name} args must be ["${expectedScript}", "."]`)
        continue
      }
      if (server.args[0] !== expectedScript || server.args[1] !== '.') {
        err(`[V18] ${name} args must be ["${expectedScript}", "."]`)
      }
      if (server.args.some(arg => /\$\{/.test(String(arg)))) {
        err(`[V18] ${name} args must not require shell parameter expansion`)
      }
    }

    const indexSrc = [
      read(path.join(ROOT, 'index.js')),
      read(path.join(ROOT, 'scripts/lib/cli-install-commands.js'))
    ].join('\n')
    if (!indexSrc.includes('mcpServers:')) {
      err('[V18] index.js CLAUDE_MCP_JSON must generate "mcpServers"')
    }
    if (/\n\s+servers:\s*\{/.test(indexSrc)) {
      err('[V18] index.js still contains VS Code-style "servers" root in generated MCP config')
    }
    if (indexSrc.includes('${CLAUDE_PROJECT_DIR:-.}')) {
      err('[V18] index.js must not generate shell-only MCP args with ${CLAUDE_PROJECT_DIR:-.}')
    }
    for (const required of [
      'CLAUDE_SETTINGS_PERMISSIONS',
      'enableAllProjectMcpServers',
      'permissions.allow',
      'mcp__devcodex-memory__*',
      'mcp__devcodex-profile__*'
    ]) {
      if (!indexSrc.includes(required)) {
        err(`[V18] index.js missing Claude Code settings permission probe text: ${required}`)
      }
    }
    console.log('[V18] Claude Code MCP/settings schema checked')
  }

  function checkV19() {
    const promptCount = walk(path.join(ROOT, 'prompts')).filter(f => f.endsWith('.prompt.md')).length
    const dataTemplateCount = walk(path.join(ROOT, 'data', 'templates')).filter(f => f.endsWith('.md')).length
    const scriptCount = walk(path.join(ROOT, 'scripts')).filter(f => f.endsWith('.js')).length
    const skillCount = walk(path.join(ROOT, 'skills')).filter(f => path.basename(f) === 'SKILL.md').length
    const instructionCount = fs.readdirSync(path.join(ROOT, 'instructions')).filter(f => f.endsWith('.instructions.md')).length
    const hookRuntimeFiles = walk(path.join(ROOT, 'hooks', '_runtime')).filter(f => f.endsWith('.cjs'))
    const hookRuntimeCount = hookRuntimeFiles.length
    const checks = [
      { file: 'README.md', needle: `Instructions 约束（${instructionCount} 个，含全部工作流规则）` },
      { file: 'README.md', needle: `全局 Instructions（${instructionCount} 个，含工作流规则摘要，自动注入）` },
      { file: 'README.md', needle: `Skill 详细检查标准（${skillCount} 个，按需读取，含默认分析、用户文档、用户侧文档 review 聚合、专家型产物质量、21 个专家 Owner Skill、复审清单、自我进化治理、README 专项能力、spec-governance、spec-absorption 与 5 个支撑型 Skill）` },
      { file: 'README.md', needle: `Skill 详细检查标准（${skillCount} 个，按 01-common §按需读取表 路由读取）` },
      { file: 'README.md', needle: `Prompt 模板（${promptCount} 个）` },
      { file: activePath('profile', '01-项目信息.md'), needle: `| **Skill** | ${skillCount} |`, rawPath: false },
      { file: activePath('profile', '01-项目信息.md'), needle: `| **Instruction** | ${instructionCount} |`, rawPath: false },
      { file: activePath('profile', '01-项目信息.md'), needle: `| **Prompt** | ${promptCount} |`, rawPath: false },
      { file: activePath('profile', '01-项目信息.md'), needle: `| **Hooks runtime** | ${hookRuntimeCount} |`, rawPath: false },
      { file: activePath('profile', '01-项目信息.md'), needle: `prompts ${promptCount}`, rawPath: false },
      { file: activePath('profile', '01-项目信息.md'), needle: `skills ${skillCount}`, rawPath: false },
      { file: activePath('profile', '02-架构约束.md'), needle: `Skill 文件 ${skillCount} 个`, rawPath: false },
      { file: activePath('profile', '02-架构约束.md'), needle: `Prompt 模板文件（.prompt.md，中文）${promptCount} 个`, rawPath: false },
      { file: activePath('profile', '02-架构约束.md'), needle: 'lifecycle-governance-intake.cjs', rawPath: false },
      { file: activePath('profile', '02-架构约束.md'), needle: 'workspace-layout.cjs', rawPath: false },
      { file: activePath('profile', '01-项目信息.md'), needle: `| **data 模板** | ${dataTemplateCount} |`, rawPath: false },
      { file: activePath('profile', '01-项目信息.md'), needle: `| **CLI 工程脚本** | ${scriptCount} |`, rawPath: false },
      { file: activePath('profile', '01-项目信息.md'), needle: 'scripts/check-syntax.js', rawPath: false },
      { file: 'website/docs/index.md', needle: `🛠️ ${skillCount} 个 Skills` },
      { file: 'website/docs/intro/index.md', needle: `${skillCount} 个按需触发的工作流技能` },
      { file: 'website/docs/specs/directory-structure.md', needle: `扁平一级 Skill（${skillCount} 个）` }
    ]
    const activeProfileDirAvailable = fs.existsSync(activePath('profile'))
    let optionalActiveProfileChecksSkipped = 0
    for (const check of checks) {
      const filePath = check.rawPath === false ? check.file : path.join(ROOT, check.file)
      if (!fs.existsSync(filePath)) {
        if (check.rawPath === false && !activeProfileDirAvailable) {
          optionalActiveProfileChecksSkipped++
          continue
        }
        warn(`[V19] asset count source missing, skip: ${path.relative(ROOT, filePath)}`)
        continue
      }
      const content = read(filePath)
      if (!content.includes(check.needle)) {
        err(`[V19] asset count drift in ${check.rawPath === false ? path.relative(ROOT, check.file) : check.file}: expected text "${check.needle}"`)
      }
    }

    if (activeProfileDirAvailable) {
      const featureInventoryPath = activePath('profile', '06-功能清单.md')
      if (fs.existsSync(featureInventoryPath)) {
        const featureInventory = read(featureInventoryPath)
        const sourcePathPattern = /`((?:(?:scripts|skills|instructions|prompts|hooks|mcp|website)\/[^`*<>]+\.(?:js|cjs|md|json|ts))|(?:(?:README|package|plugin|index)\.(?:md|json|js)))`/g
        for (const match of featureInventory.matchAll(sourcePathPattern)) {
          if (!fs.existsSync(path.join(ROOT, match[1]))) {
            err(`[V19] Profile feature inventory references missing source fact: ${match[1]}`)
          }
        }
      }
    }

    const activeRequirementsIndex = read(path.join(ROOT, 'website/docs/versions/v1/1.0.1/requirements/index.md'))
    const activeRequirementsChangelog = read(path.join(ROOT, 'website/docs/versions/v1/1.0.1/CHANGELOG.md'))
    for (const stale of ['light-api', 'frontend-api', 'Claude MCP/合规漂移修复']) {
      if (activeRequirementsIndex.includes(stale)) {
        err(`[V19] active requirements index contains stale unbacked summary text: ${stale}`)
      }
    }
    if (!activeRequirementsIndex.includes('template-flow-alignment')) {
      err('[V19] active requirements index must link the existing template-flow-alignment requirement detail')
    }
    if (!activeRequirementsChangelog.includes('模板边界与开发流程收口')) {
      err('[V19] active version CHANGELOG must record the existing template-flow-alignment requirement detail')
    }

    console.log(`[V19] asset counts checked: instructions=${instructionCount}, skills=${skillCount}, prompts=${promptCount}, hook-runtime=${hookRuntimeCount}, data-templates=${dataTemplateCount}, scripts=${scriptCount}; optional active-profile checks skipped=${optionalActiveProfileChecksSkipped}`)
  }

  function extractSubtypes(content, workflow) {
    const re = new RegExp(`${workflow}\\.([\\u4e00-\\u9fa5][\\u4e00-\\u9fa5\\w-]*|[a-z][a-z0-9-]*)`, 'g')
    const set = new Set()
    let m
    const skip = new Set(['instructions', 'instruction', 'md'])
    while ((m = re.exec(content))) {
      if (!skip.has(m[1])) set.add(m[1])
    }
    return set
  }

  function stripOuterQuotes(text) {
    const value = String(text || '').trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1)
    }
    return value
  }

  function resolveProbeFiles(probe) {
    if (typeof probe.file === 'string') return [stripOuterQuotes(probe.file)].filter(Boolean)
    if (typeof probe.include === 'string') return [stripOuterQuotes(probe.include)].filter(Boolean)
    if (Array.isArray(probe.include)) {
      return probe.include
        .filter(entry => typeof entry === 'string')
        .map(stripOuterQuotes)
        .filter(Boolean)
    }
    return []
  }

  function normalizeRegressionProbe(probe) {
    if (!probe || typeof probe.expectedMatches !== 'number') return { kind: 'skip' }

    if (probe.type === 'grepCount') {
      const files = resolveProbeFiles(probe)
      if (typeof probe.pattern !== 'string' || !files.length) {
        return { kind: 'invalid', reason: 'missing pattern/include' }
      }
      return {
        kind: 'grepCount',
        findingId: probe.findingId || 'unknown',
        expectedMatches: probe.expectedMatches,
        pattern: probe.pattern,
        files
      }
    }

    if (typeof probe.scanCmd === 'string') {
      const match = probe.scanCmd.trim().match(/^grep\s+-c\s+(['"])(.*?)\1\s+(.+)$/)
      if (!match) {
        return { kind: 'invalid', reason: `unsupported legacy scanCmd: ${probe.scanCmd}` }
      }
      return {
        kind: 'grepCount',
        findingId: probe.findingId || 'unknown',
        expectedMatches: probe.expectedMatches,
        pattern: match[2],
        files: [stripOuterQuotes(match[3])]
      }
    }

    return { kind: 'skip' }
  }

  function countProbeMatches(pattern, files) {
    let total = 0
    for (const file of files) {
      const abs = path.join(ROOT, file)
      if (!fs.existsSync(abs)) continue
      const lines = read(abs).split(/\r?\n/)
      total += lines.filter(line => line.includes(pattern)).length
    }
    return total
  }

  // __FUNCTIONS__

  return {
    checkV1, checkV2, checkV3, checkV4, checkV5, checkV7, checkV9, checkV10,
    checkV11, checkV12, checkV15, checkV16, checkV17, checkV18, checkV19
  }
}

module.exports = { buildValidateCoreChecks }
