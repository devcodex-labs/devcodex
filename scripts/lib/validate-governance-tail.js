'use strict'

function buildGovernanceTailChecks(ctx) {
  const {
    ROOT,
    ACTIVE_DEVCODEX_ROOT,
    RECENT_REQUIREMENT_ARTIFACT_DAYS,
    collectRecentBugArtifactIssues,
    collectRecentRequirementArtifactIssues,
    fs,
    path,
    execSync,
    read,
    err,
    mustInclude
  } = ctx

  function collectChangelogSources() {
    const sources = [
      { file: 'changelogs/unreleased.md', content: read(path.join(ROOT, 'changelogs/unreleased.md')) }
    ]
    const releasesDir = path.join(ROOT, 'changelogs', 'releases')
    if (fs.existsSync(releasesDir)) {
      for (const name of fs.readdirSync(releasesDir).filter(item => item.endsWith('.md')).sort()) {
        const file = `changelogs/releases/${name}`
        sources.push({ file, content: read(path.join(ROOT, file)) })
      }
    }
    return sources
  }

  function hasChangelogEvidence(needle) {
    return collectChangelogSources().some(source => source.content.includes(needle))
  }

  function checkV39() {
    const probes = [
      {
        file: 'instructions.md',
        needles: ['Improvement Intake（优化清单）', '所有模式命中后都必须显式回执']
      },
      {
        file: 'instructions/01-common.instructions.md',
        needles: ['Improvement Intake（优化清单）', '所有模式下，每条用户消息完成合理性评估后', '业务局部诉求']
      },
      {
        file: 'skills/spec-governance/SKILL.md',
        needles: ['Improvement Intake（优化清单）', '在所有模式下', 'PI + PF', '所有模式下，主动 Intake 完成后必须显式回执']
      },
      {
        file: 'instructions/18-spec-radar.instructions.md',
        needles: ['RecordRouter / Improvement Intake', '优化清单（PI）', '全模式规则执行']
      },
      {
        file: 'data/templates/process-improvements.md',
        needles: ['优化清单', '触发来源', '关联缺口']
      },
      {
        file: 'data/README.md',
        needles: ['优化清单（PI）', '承载 DevCodex 规范资产的 active-root']
      },
      {
        file: 'README.md',
        needles: ['规范治理 Intake', 'data/process-improvements.md', '所有模式下每条用户消息']
      },
      {
        file: 'hooks/_runtime/lifecycle-governance-intake.cjs',
        needles: ['governanceIntakeCandidate', 'record.none', 'requiresCoupledRecordRouterEvidence', 'CONFIDENCE_RE', 'BASIS_RE', 'buildGovernanceIntakeReminderItem']
      },
      {
        file: 'hooks/_runtime/lifecycle-visible-reply.cjs',
        needles: ['buildGovernanceIntakeReminderItem']
      },
      {
        file: 'scripts/test-governance-intake.js',
        needles: ['runGovernanceIntakeBehaviorReplay', '用户纠正', 'record.none', 'historical ledger id', 'ordinary future-question prompt', 'cleanupRuntimeTempRoots']
      },
      {
        file: 'package.json',
        needles: ['test:governance-intake', 'node scripts/test-governance-intake.js']
      }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V39] governance intake drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    const forbidden = [
      ['instructions.md', 'dev 模式需显式回执已记录的 `PI-xxx / PF-xxx`'],
      ['instructions.md', '在 `dev` 模式下，每条用户消息在完成合理性评估后'],
      ['instructions/01-common.instructions.md', 'dev 模式必须回执 `已记录 PI-xxx / PF-xxx`'],
      ['instructions/01-common.instructions.md', 'dev 模式必须显式回执'],
      ['skills/spec-governance/SKILL.md', '在 `dev` 模式下，除了处理“记录一下”这类显式记录请求'],
      ['skills/spec-governance/SKILL.md', 'dev 模式下，主动 Intake 完成后必须显式回执'],
      ['skills/intent/SKILL.md', 'dev 模式下还要执行主动 Improvement Intake'],
      ['instructions/18-spec-radar.instructions.md', '当前 dev 模式消息经合理性评估后命中'],
      ['data/templates/process-improvements.md', 'dev 模式需回执'],
      ['README.md', 'dev 模式下每条用户消息在合理性评估后都会额外检查'],
      ['README.md', 'dev 模式下每条用户消息还会执行主动 Improvement Intake'],
      ['website/docs/guide/development.md', 'dev 模式下若用户建议经验证更优且可泛化'],
      ['changelogs/unreleased.md', 'dev 模式下对可泛化更优策略或规范缺口执行主动记录']
    ]

    for (const [file, needle] of forbidden) {
      const content = read(path.join(ROOT, file))
      if (content.includes(needle)) {
        err(`[V39] governance intake drift in ${file}: legacy mode split remains "${needle}"`)
      }
    }

    try {
      execSync('node scripts/test-governance-intake.js', { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    } catch (e) {
      const detail = String((e.stderr || e.stdout || e.message || '')).trim().split('\n').slice(0, 8).join(' | ')
      err(`[V39] test-governance-intake failed${detail ? `: ${detail}` : ''}`)
    }

    console.log('[V39] governance improvement intake sync checked')
  }

  function checkV40() {
    const probes = [
      {
        file: 'skills/load-profile/SKILL.md',
        needles: ['config.local.json', 'extensions.<namespace>', '不得覆盖 `mode` / `agent` / `pluginVersion`']
      },
      {
        file: 'prompts/project-profile.prompt.md',
        needles: ['config.local.json', 'extensions.<namespace>']
      },
      {
        file: 'scripts/validate-profile.js',
        needles: ['config.local.json', 'connectionPassword', 'must not override "${reserved}"', 'extensions']
      },
      {
        file: 'scripts/test-validate-profile.js',
        needles: ['validLocalConfig', 'validRawSecretLocalConfig', 'invalidLocalConfig', 'config.local.json']
      },
      {
        file: 'scripts/test-mcp-servers.js',
        needles: ['config.local.json', 'connectionString']
      },
      {
        file: 'index.js',
        needles: ['config.local.json', '.devcodex/*/profile/config.local.json']
      },
      {
        file: 'mcp/profile-server.js',
        needles: ['config.local.json']
      },
      {
        file: 'README.md',
        needles: ['config.local.json', 'extensions.<namespace>']
      },
      {
        file: 'website/docs/guide/development.md',
        needles: ['config.local.json', 'extensions.<namespace>']
      },
      {
        file: 'package.json',
        needles: ['test:profile-governance', 'node scripts/test-validate-profile.js']
      }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V40] profile local config drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    try {
      execSync('node scripts/test-validate-profile.js', { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    } catch (e) {
      const detail = String((e.stderr || e.stdout || e.message || '')).trim().split('\n').slice(0, 8).join(' | ')
      err(`[V40] test-validate-profile failed${detail ? `: ${detail}` : ''}`)
    }

    console.log('[V40] profile local config sync checked')
  }

  function checkV41() {
    const probes = [
      { file: 'instructions.md', needles: ['SimpleTaskFastPath', '00-需求变更概况.md', '00-问题概况.md', 'ExistingRequirementArtifactOverride', 'ArtifactDecisionMatrix'] },
      { file: 'instructions/02-output-paths.instructions.md', needles: ['SimpleTaskFastPath', '目标明确、预计 ≤2 个源码/文档文件', '00-需求变更概况.md', '00-问题概况.md', 'ExistingRequirementArtifactOverride', 'ArtifactDecisionMatrix'] },
      { file: 'instructions/10-dev.instructions.md', needles: ['SimpleTaskFastPath（简单任务轻路径）', '立即升级回完整 CP/产物链', '00-需求变更概况.md', 'ExistingRequirementArtifactOverride', 'ArtifactLifecycleState'] },
      { file: 'instructions/11-fix.instructions.md', needles: ['SimpleTaskFastPath', '00-问题概况.md: N/A + skipReason', 'ExistingRequirementArtifactOverride', 'ArtifactDecisionMatrix'] },
      { file: 'skills/cp-gate/SKILL.md', needles: ['SimpleTaskFastPath', '00-需求变更概况.md', '00-问题概况.md', 'ExistingRequirementArtifactOverride', 'ArtifactDecisionMatrix'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['SimpleTaskFastPath', 'upgradeTrigger', 'ExistingRequirementArtifactOverride', 'ArtifactDecisionMatrix'] },
      { file: 'README.md', needles: ['SimpleTaskFastPath', '00-需求概况.md', '00-需求变更概况.md', '00-问题概况.md', 'ExistingRequirementArtifactOverride', 'ArtifactDecisionMatrix'] },
      { file: 'website/docs/guide/development.md', needles: ['SimpleTaskFastPath', '免建需求/bug 目录', '00-需求概况.md', '00-需求变更概况.md', '00-问题概况.md', 'ExistingRequirementArtifactOverride', 'ArtifactDecisionMatrix'] },
      { file: 'scripts/lib/requirement-artifact-check.js', needles: ['SIMPLE_TASK_FAST_PATH_MARKERS', 'collectRecentBugArtifactIssues', '00-需求变更概况.md', '00-问题概况.md'] },
      { file: 'scripts/test-requirement-artifacts.js', needles: ['simple-fast-path', 'simple-fast-path-bug', '00-需求变更概况.md', '00-问题概况.md'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) err(`[V41] SimpleTaskFastPath drift in ${probe.file}: missing "${needle}"`)
      }
    }

    const forbiddenPromptPhrases = [
      { file: 'prompts/implementation-plan.prompt.md', phrase: '`04-实施计划.md` 始终要创建' },
      { file: 'prompts/technical-design.prompt.md', phrase: '禁止跳过必选章节。' }
    ]
    for (const item of forbiddenPromptPhrases) {
      const content = read(path.join(ROOT, item.file))
      if (content.includes(item.phrase)) {
        err(`[V41] ArtifactDecisionMatrix drift in ${item.file}: forbidden phrase "${item.phrase}"`)
      }
    }

    const { checkedDirs, issues } = collectRecentRequirementArtifactIssues({
      activeRoot: ACTIVE_DEVCODEX_ROOT,
      recentDays: RECENT_REQUIREMENT_ARTIFACT_DAYS
    })
    const bugResult = collectRecentBugArtifactIssues({
      activeRoot: ACTIVE_DEVCODEX_ROOT,
      recentDays: RECENT_REQUIREMENT_ARTIFACT_DAYS
    })

    for (const issue of issues) err(`[V41] ${issue}`)
    for (const issue of bugResult.issues) err(`[V41] ${issue}`)
    console.log(`[V41] requirement runtime artifact structure checked: ${checkedDirs.length} requirement dirs, ${bugResult.checkedDirs.length} bug dirs`)
  }

  function checkV42() {
    const pkg = JSON.parse(read(path.join(ROOT, 'package.json')))
    const scripts = pkg.scripts || {}
    const releaseSkill = read(path.join(ROOT, 'skills', 'release-verification', 'SKILL.md'))
    const releaseGuide = read(path.join(ROOT, 'website', 'docs', 'guide', 'release.md'))
    const readme = read(path.join(ROOT, 'README.md'))
    const testRouter = read(path.join(ROOT, 'skills', 'test-router', 'SKILL.md'))

    const scriptExpectations = [
      ['test', 'npm run test:core'],
      ['test', 'node scripts/test-release-metadata.js'],
      ['test:all', 'npm test'],
      ['test:all:with-audit', 'npm run test:audit'],
      ['test:release-metadata', 'node scripts/test-release-metadata.js'],
      ['prepublishOnly', 'npm run test:all:with-audit']
    ]
    for (const [scriptName, needle] of scriptExpectations) {
      const value = scripts[scriptName] || ''
      if (!value.includes(needle)) err(`[V42] package.json script ${scriptName} missing "${needle}"`)
    }
    if (!(scripts['test:audit'] || '').includes('registry=https://registry.npmjs.org')) {
      err('[V42] package.json test:audit must pin npm audit to registry.npmjs.org so GitHub Packages publishConfig does not break publish dry-run/prepublishOnly')
    }

    for (const needle of ['R3b', 'R3c', 'npm run test:audit', 'package completeness gate', '远端 CI', 'keywords', 'publishConfig', 'prepublishOnly']) {
      if (!releaseSkill.includes(needle)) err(`[V42] release-verification skill missing "${needle}"`)
    }
    for (const needle of ['R3b', 'R3c', 'npm run test:audit', 'package completeness gate', '远端 CI', 'keywords', 'publishConfig', 'GitHub Packages']) {
      if (!releaseGuide.includes(needle)) err(`[V42] website release guide missing "${needle}"`)
    }
    for (const needle of ['release-verification', 'npm run test:audit', 'package completeness gate', '远端 CI', 'publish dry-run']) {
      if (!testRouter.includes(needle)) err(`[V42] test-router missing "${needle}"`)
    }

    if ((pkg.publishConfig?.registry || '').includes('npm.pkg.github.com') || pkg.publishConfig?.access === 'restricted') {
      for (const needle of ['GitHub Packages', 'npm.pkg.github.com', 'NODE_AUTH_TOKEN']) {
        if (!readme.includes(needle)) err(`[V42] README missing GitHub Packages install boundary "${needle}"`)
      }
    }

    console.log('[V42] release gate / package completeness sync checked')
  }

  function checkV43() {
    const probes = [
      { file: 'README.md', needles: ['devcodex doctor', 'devcodex help', '## 常见问题与排错', 'DEVCODEX_HOOK_ENFORCEMENT', 'MCP 边界'] },
      { file: 'agents/README.md', needles: ['plugin.json', 'DevCodex 内部注册表', '.agent.md'] },
      { file: 'instructions/01-common.instructions.md', needles: ['audit-readme', 'audit-user-manual', '项目文档 review'] },
      { file: 'instructions/12-audit.instructions.md', needles: ['audit-readme', 'audit-user-manual', 'README / 用户使用文档不单独开新的审查目标'] },
      { file: 'skills/routing/SKILL.md', needles: ['audit-readme', 'audit-user-manual', '项目文档 review'] },
      { file: 'website/docs/guide/development.md', needles: ['devcodex doctor', 'DEVCODEX_HOOK_ENFORCEMENT', '.mcp.json'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) err(`[V43] host docs / README audit route drift in ${probe.file}: missing "${needle}"`)
      }
    }

    console.log('[V43] host docs / README audit route sync checked')
  }

  function checkV44() {
    const probes = [
      { file: 'instructions.md', needles: ['dev 模式默认应向用户展示完整 Intent Expansion Card', 'Context Rehydration Contract', 'ContextHandoffCard', '必须暂停执行，回补或重开 CP3'] },
      { file: 'instructions/01-common.instructions.md', needles: ['dev 模式默认', 'Context Rehydration Contract', 'ContextHandoffCard', '回到对应 CP3'] },
      { file: 'instructions/01c-intent-expansion.instructions.md', needles: ['ContextHandoffCard（上下文传递/交接）', 'handoff 产出，rehydration 消费'] },
      { file: 'instructions/10-dev.instructions.md', needles: ['Intent Expansion 可见性', '执行期 CP3 回退', '回退到 `N4`'] },
      { file: 'instructions/11-fix.instructions.md', needles: ['Intent Expansion 可见性', '执行期 CP3 回退', '不替代 CP3'] },
      { file: 'instructions/15-memory.instructions.md', needles: ['Context Rehydration Contract（记忆侧）', 'ContextHandoffCard（记忆侧）', 'SUMMARY.md` 是索引，不是事实源'] },
      { file: 'instructions/16-report.instructions.md', needles: ['ContextHandoffCard', 'N/A + skipReason'] },
      { file: 'instructions/17-compliance.instructions.md', needles: ['ContextHandoffCard', 'summary/compact/handoff'] },
      { file: 'skills/intent/SKILL.md', needles: ['dev 模式默认向用户展示完整 Card', '先按文件真相源重建 Card'] },
      { file: 'skills/cp-gate/SKILL.md', needles: ['执行期 CP3 回退', '不要求 runtime 逐字输出一个同名对象'] },
      { file: 'skills/memory/SKILL.md', needles: ['ContextHandoffCard', '交接卡'] },
      { file: 'skills/report/SKILL.md', needles: ['ContextHandoffCard', 'N/A + skipReason'] },
      { file: 'skills/compliance/SKILL.md', needles: ['ContextHandoffCard', 'summary/compact/handoff'] },
      { file: 'skills/dev-default/SKILL.md', needles: ['执行期 CP3 回退（F-26）', '历史能力回归矩阵'] },
      { file: 'skills/fix-default/SKILL.md', needles: ['执行期 CP3 回退', '历史能力回归矩阵'] },
      { file: 'skills/execution-contract/SKILL.md', needles: ['regressionMatrix', '历史能力 → 受影响批次 → 必跑验证 → 失败回滚点'] },
      { file: 'skills/test-router/SKILL.md', needles: ['regressionChecks', '历史能力、必跑验证、对应批次和失败回滚点'] },
      { file: 'hooks/_runtime/lifecycle.cjs', needles: ['CP3_RUNTIME_FILE_THRESHOLD', 'cp-gate-CP3-runtime-threshold', '执行中已触达'] },
      { file: 'scripts/test-hooks-runtime.js', needles: ['bug-5.js', 'cp-gate-CP3-runtime-threshold', 'runtime threshold should not warn before the 5th unique source file'] },
      { file: 'prompts/precheck-status.prompt.md', needles: ['dev 模式默认向用户展示完整 Card', 'Context Rehydration Contract', 'ContextHandoffCard'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['ContextHandoffCard', 'source-of-truth'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['ContextHandoffCard', 'source-of-truth'] },
      { file: 'README.md', needles: ['Context Rehydration Contract', 'ContextHandoffCard', 'dev 模式默认会直接展示完整 Card', '执行期 CP3 回退'] },
      { file: 'website/docs/guide/development.md', needles: ['Context Rehydration Contract', 'ContextHandoffCard', 'dev 模式默认向用户展示完整 Intent Expansion Card', '执行期 CP3 回退'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) err(`[V44] context rehydration / CP3 rollback drift in ${probe.file}: missing "${needle}"`)
      }
    }

    console.log('[V44] context rehydration / CP3 rollback sync checked')
  }

  function checkV45() {
    const mappings = [
      { sourceFile: 'instructions.md', sourceNeedle: '唯一的规范源文件', targetFile: 'instructions/01-common.instructions.md', targetNeedle: '单源聚合文件' },
      { sourceFile: 'instructions.md', sourceNeedle: 'Context Rehydration Contract', targetFile: 'instructions/01-common.instructions.md', targetNeedle: 'Context Rehydration Contract' },
      { sourceFile: 'instructions.md', sourceNeedle: 'Context Rehydration Contract', targetFile: 'instructions/15-memory.instructions.md', targetNeedle: 'Context Rehydration Contract（记忆侧）' },
      { sourceFile: 'instructions.md', sourceNeedle: 'ContextHandoffCard', targetFile: 'instructions/01c-intent-expansion.instructions.md', targetNeedle: 'ContextHandoffCard（上下文传递/交接）' },
      { sourceFile: 'instructions.md', sourceNeedle: 'ContextHandoffCard', targetFile: 'instructions/15-memory.instructions.md', targetNeedle: 'ContextHandoffCard（记忆侧）' },
      { sourceFile: 'instructions.md', sourceNeedle: '执行过程中新增范围触发 CP3 条件', targetFile: 'instructions/10-dev.instructions.md', targetNeedle: '执行期 CP3 回退' },
      { sourceFile: 'instructions.md', sourceNeedle: '执行过程中新增范围触发 CP3 条件', targetFile: 'instructions/11-fix.instructions.md', targetNeedle: '执行期 CP3 回退' }
    ]

    for (const mapping of mappings) {
      const source = read(path.join(ROOT, mapping.sourceFile))
      const target = read(path.join(ROOT, mapping.targetFile))
      if (!source.includes(mapping.sourceNeedle)) err(`[V45] source aggregate missing "${mapping.sourceNeedle}" in ${mapping.sourceFile}`)
      if (!target.includes(mapping.targetNeedle)) err(`[V45] split instruction missing "${mapping.targetNeedle}" in ${mapping.targetFile}`)
    }

    console.log('[V45] single-source aggregate vs split instructions sync checked')
  }

  function checkV46() {
    const requiredFiles = [
      'instructions/tenants/example-tenant/README.md',
      'instructions/tenants/example-tenant/10-dev.instructions.md'
    ]

    for (const file of requiredFiles) {
      if (!fs.existsSync(path.join(ROOT, file))) err(`[V46] missing tenant example file: ${file}`)
    }

    mustInclude('instructions/tenants/README.md', 'example-tenant', 'tenant README example directory')
    mustInclude('instructions/tenants/README.md', '10-dev.instructions.md', 'tenant README example file')
    mustInclude('instructions/tenants/example-tenant/README.md', '示例租户', 'tenant example README')
    mustInclude('instructions/tenants/example-tenant/10-dev.instructions.md', '局部覆盖示例', 'tenant example override')
    console.log('[V46] tenant example coverage checked')
  }

  function checkV47() {
    const npmignore = read(path.join(ROOT, '.npmignore'))
    if (npmignore.includes('tests/')) err('[V47] .npmignore still contains stale "tests/" exclusion; tests now live under scripts/test-*.js')

    const assetsHooksReadme = path.join(ROOT, 'assets', 'hooks', 'README.md')
    if (!fs.existsSync(assetsHooksReadme)) {
      err('[V47] missing assets/hooks/README.md for source-template boundary explanation')
    } else {
      const content = read(assetsHooksReadme)
      for (const needle of ['Hooks 运行时相关的源码/模板占位目录', '源仓维护说明', '默认不会打包发布']) {
        if (!content.includes(needle)) err(`[V47] assets/hooks/README.md missing "${needle}"`)
      }
    }

    const codexReadme = path.join(ROOT, 'codex', 'README.md')
    if (!fs.existsSync(codexReadme)) {
      err('[V47] missing codex/README.md for source-template boundary explanation')
    } else {
      const content = read(codexReadme)
      for (const needle of ['源模板目录', '`.codex/hooks.json`', '不是工作区部署副本']) {
        if (!content.includes(needle)) err(`[V47] codex/README.md missing "${needle}"`)
      }
    }

    mustInclude('README.md', '不是工作区部署副本 `.codex/`', 'README codex source-template boundary')
    console.log('[V47] source template hygiene checked')
  }

  function checkV48() {
    const requiredFiles = [
      'instructions/01a-profile-loading.instructions.md',
      'instructions/01b-record-router.instructions.md',
      'instructions/01c-intent-expansion.instructions.md'
    ]

    for (const file of requiredFiles) {
      if (!fs.existsSync(path.join(ROOT, file))) err(`[V48] missing split common instruction file: ${file}`)
    }

    const probes = [
      { file: 'instructions/01-common.instructions.md', needles: ['common-base / 锚点文件', '01a-profile-loading.instructions.md', '01b-record-router.instructions.md', '01c-intent-expansion.instructions.md'] },
      { file: 'instructions/01a-profile-loading.instructions.md', needles: ['项目现实扩展（Project Reality Expansion）', '.devcodex/workspace/profile/', 'sticky `activeProject`', 'workspace base + project overlay', 'config.local.json'] },
      { file: 'instructions/01b-record-router.instructions.md', needles: ['Improvement Intake（优化清单）', '已记录 PI-xxx', 'Commit Subject 简洁化', '未发布变更与提交边界', '官方文档优先级'] },
      { file: 'instructions/01c-intent-expansion.instructions.md', needles: ['Intent Expansion Card', '用户可见意图扩展摘要', 'Context Rehydration Contract', 'Stop 可见回复证据三态', '回到对应 CP3'] },
      { file: 'website/docs/specs/directory-structure.md', needles: ['01a-profile-loading.instructions.md', '01b-record-router.instructions.md', '01c-intent-expansion.instructions.md'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) err(`[V48] split common instruction drift in ${probe.file}: missing "${needle}"`)
      }
    }

    const plugin = JSON.parse(read(path.join(ROOT, 'plugin.json')))
    for (const [id, file] of [
      ['common-profile-loading', 'instructions/01a-profile-loading.instructions.md'],
      ['common-record-router', 'instructions/01b-record-router.instructions.md'],
      ['common-intent-expansion', 'instructions/01c-intent-expansion.instructions.md']
    ]) {
      if (!plugin.instructions.some(instruction => instruction.id === id && instruction.file === file)) {
        err(`[V48] plugin.json missing split instruction entry ${id}`)
      }
    }

    console.log('[V48] split common instruction structure checked')
  }

  function checkV49() {
    const probes = [
      { file: 'instructions.md', needles: ['Backlog Intake 真相复核', 'pure-open', 'already-fixed', '台账状态回写闭环', '登记时间 ≤ 修复时间 ≤ 验证时间/关闭时间'] },
      { file: 'instructions/01b-record-router.instructions.md', needles: ['Backlog Intake 真相复核', 'misclassified', '台账状态回写闭环', '登记时间 ≤ 修复时间 ≤ 验证时间/关闭时间'] },
      { file: 'instructions/10-dev.instructions.md', needles: ['backlog 来源前置真相复核'] },
      { file: 'instructions/11-fix.instructions.md', needles: ['backlog 来源前置真相复核', '台账状态回写闭环'] },
      { file: 'skills/cp-gate/SKILL.md', needles: ['backlog 来源前置真相复核', 'pure-open'] },
      { file: 'skills/spec-governance/SKILL.md', needles: ['Backlog Intake 真相复核', 'residual-tail', '台账状态回写闭环', '登记时间 ≤ 修复时间 ≤ 验证时间/关闭时间'] },
      { file: 'skills/execution-contract/SKILL.md', needles: ['backlogTruthReview', 'ledgerWriteback', 'scopeDelta', 'writebackEvidence'] },
      { file: 'skills/report/SKILL.md', needles: ['Backlog Intake 真相复核', '台账状态回写闭环'] },
      { file: 'data/templates/violations.md', needles: ['登记时间 ≤ 修复时间 ≤ 验证时间/关闭时间', '不得早于登记时间或修复时间'] },
      { file: 'data/templates/pending-fixes.md', needles: ['登记时间 ≤ 修复时间 ≤ 验证时间/关闭时间', '不得早于登记时间或修复时间'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['Backlog Intake 真相复核', '台账状态回写闭环', 'scopeDelta', 'rescanResult'] },
      { file: 'prompts/implementation-progress.prompt.md', needles: ['Backlog Intake 真相复核', '台账状态回写闭环', 'open/partial'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['Backlog Intake 真相复核', '台账状态回写闭环'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['Backlog Intake 真相复核', '台账状态回写闭环'] },
      { file: 'README.md', needles: ['Backlog 真相复核与状态回写', 'pure-open / residual-tail / already-fixed / misclassified'] },
      { file: 'website/docs/guide/development.md', needles: ['Backlog Intake 真相复核', '台账状态回写闭环'] },
      { file: 'scripts/test-spec-governance.js', needles: ['Backlog Intake 真相复核', '台账状态回写闭环', 'backlogTruthReview'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V49] backlog truth review / ledger writeback drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    const activeLedgerDir = path.join(ACTIVE_DEVCODEX_ROOT, 'data')
    const ledgerFiles = [
      path.join(activeLedgerDir, 'violations.md'),
      path.join(activeLedgerDir, 'pending-fixes.md')
    ]
    for (const ledgerFile of ledgerFiles) {
      if (!fs.existsSync(ledgerFile)) continue
      checkLedgerChronology(ledgerFile)
    }

    console.log('[V49] backlog truth review / ledger writeback sync checked')
  }

  function parseLedgerTimestamp(value) {
    if (!value || value === '—') return null
    const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?$/)
    if (!match) return null
    return Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4] || 0),
      Number(match[5] || 0)
    )
  }

  function checkLedgerChronology(ledgerFile) {
    const lines = read(ledgerFile).split(/\r?\n/)
    let headers = null
    for (const [idx, line] of lines.entries()) {
      if (!line.startsWith('|')) continue
      const cells = line.split('|').slice(1, -1).map(cell => cell.trim())
      if (cells[0] === '编号' && cells.includes('登记时间')) {
        headers = cells
        continue
      }
      if (!headers || !/^([A-Z]+-|GAP-)/.test(cells[0] || '')) continue

      const row = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] || '']))
      const id = row['编号'] || cells[0]
      const reg = parseLedgerTimestamp(row['登记时间'])
      const fix = parseLedgerTimestamp(row['修复时间'])
      const verified = parseLedgerTimestamp(row['验证时间'])
      const closed = parseLedgerTimestamp(row['关闭时间'])
      const location = path.relative(ROOT, ledgerFile).replace(/\\/g, '/')

      if (reg && fix && fix < reg) err(`[V49] ledger chronology drift in ${location}:${idx + 1} ${id}: 修复时间早于登记时间`)
      if (reg && verified && verified < reg) err(`[V49] ledger chronology drift in ${location}:${idx + 1} ${id}: 验证时间早于登记时间`)
      if (reg && closed && closed < reg) err(`[V49] ledger chronology drift in ${location}:${idx + 1} ${id}: 关闭时间早于登记时间`)
      if (fix && verified && verified < fix) err(`[V49] ledger chronology drift in ${location}:${idx + 1} ${id}: 验证时间早于修复时间`)
      if (fix && closed && closed < fix) err(`[V49] ledger chronology drift in ${location}:${idx + 1} ${id}: 关闭时间早于修复时间`)
    }
  }

  function checkV50() {
    const probes = [
      { file: 'skills/audit-release/SKILL.md', needles: ['RL-1 版本身份', 'RL-4 元数据完整性', '远端 CI 绿色', 'RL-10 发布后验收', '不同于 release-verification'] },
      { file: 'instructions.md', needles: ['发布前审查', 'RL-1~RL-10', 'audit-release', 'release-verification'] },
      { file: 'instructions/01-common.instructions.md', needles: ['audit.发布前审查', 'audit-release', 'ReleaseAudit', '发布审查 / 发布验证'] },
      { file: 'instructions/12-audit.instructions.md', needles: ['含 7 个审查目标类型', '发布前审查（RL-1~RL-10）', '不得用 `npm test`、pack 或 publish dry-run 通过来替代 RL 维度审查'] },
      { file: 'skills/routing/SKILL.md', needles: ['audit | 发布前审查', 'skills/audit-release/SKILL.md'] },
      { file: 'skills/audit-execution-guide/SKILL.md', needles: ['release pre-review', 'audit-release', 'RL-1~RL-10'] },
      { file: 'skills/report/SKILL.md', needles: ['ReleaseAudit', 'RL-1~RL-10', 'ReleaseAudit / ReleaseVerification'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['发布前审查(RL-1~RL-10)', '发布前审查'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['ReleaseAudit', 'RL-1~RL-10'] },
      { file: 'prompts/implementation-progress.prompt.md', needles: ['ReleaseAudit', 'RL-1~RL-10 / risks / recommendation'] },
      { file: 'README.md', needles: ['audit-release', 'release readiness', '不替代 `release-verification`'] },
      { file: 'website/docs/guide/release.md', needles: ['audit-release', 'RL-1~RL-10', 'ReleaseVerification R0~R7', '远端 CI'] },
      { file: 'website/docs/specs/directory-structure.md', needles: ['audit-release', '发布前审查', 'release-verification` 继续负责 R0~R7'] },
      { file: 'scripts/test-spec-governance.js', needles: ['audit-release', 'RL-1~RL-10', 'ReleaseAudit'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V50] release audit governance drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    const plugin = JSON.parse(read(path.join(ROOT, 'plugin.json')))
    if (!plugin.skills.some(skill => skill.id === 'audit-release' && skill.file === 'skills/audit-release/SKILL.md')) {
      err('[V50] plugin.json missing audit-release skill entry')
    }

    console.log('[V50] release audit governance sync checked')
  }

  function checkV51() {
    const probes = [
      { file: 'instructions.md', needles: ['ArtifactLinkSet', 'mcpFallback=used', 'invoke'] },
      { file: 'instructions/01-common.instructions.md', needles: ['ArtifactLinkSet', 'mcpFallback=used', 'MCP bridge'] },
      { file: 'instructions/02-output-paths.instructions.md', needles: ['ArtifactLinkSet 客户端兼容矩阵', 'Copy fallback', 'GitHub Copilot', '强制追加', 'Codex Desktop/App', 'MCP profile fallback', '禁止只输出裸文件名'] },
      { file: 'instructions/16-report.instructions.md', needles: ['ArtifactLinkSet', '绝对路径：', '禁止只输出裸文件名'] },
      { file: 'instructions/17-compliance.instructions.md', needles: ['ArtifactLinkSet', 'copy fallback'] },
      { file: 'skills/host-contract-verification/SKILL.md', needles: ['artifactLinkMatrix', 'mcpFallback', 'Cannot read properties of undefined'] },
      { file: 'skills/test-router/SKILL.md', needles: ['ArtifactLinkSet', 'mcpFallback'] },
      { file: 'skills/execution-contract/SKILL.md', needles: ['ArtifactLinkSet', 'MCP fallback'] },
      { file: 'skills/report/SKILL.md', needles: ['ArtifactLinkSet', 'copy fallback'] },
      { file: 'skills/compliance/SKILL.md', needles: ['ArtifactLinkSet', 'copy fallback'] },
      { file: 'skills/audit-common/SKILL.md', needles: ['ArtifactLinkSet', 'copy fallback'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['artifactLinkMatrix', 'mcpFallback'] },
      { file: 'prompts/implementation-progress.prompt.md', needles: ['artifactLinkMatrix', 'mcpFallback'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['artifactLinkMatrix', 'mcpFallback'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['artifactLinkMatrix', 'mcpFallback'] },
      { file: 'README.md', needles: ['产物文件链接兼容', 'profile_load', 'invoke'] },
      { file: 'website/docs/guide/development.md', needles: ['ArtifactLinkSet', 'mcpFallback=used'] },
      { file: 'scripts/test-mcp-servers.js', needles: ['testProfileLoadWithoutArguments', 'assert.doesNotMatch(text, /invoke|TypeError/i)'] },
      { file: 'scripts/test-client-contracts.js', needles: ['Client contract checks passed', 'ArtifactLinkSet', 'testProfileLoadWithoutArguments'] },
      { file: 'package.json', needles: ['test:client-contracts', 'node scripts/test-client-contracts.js'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V51] client artifact / MCP fallback drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    try {
      execSync('node scripts/test-client-contracts.js', { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    } catch (e) {
      const detail = String((e.stderr || e.stdout || e.message || '')).trim().split('\n').slice(0, 8).join(' | ')
      err(`[V51] test-client-contracts failed${detail ? `: ${detail}` : ''}`)
    }

    console.log('[V51] client artifact / MCP fallback sync checked')
  }

  function checkV52() {
    const codexHooks = JSON.parse(read(path.join(ROOT, 'codex/hooks.json')))
    const preCompactEntries = codexHooks.hooks?.PreCompact || []
    if (!Array.isArray(preCompactEntries) || !preCompactEntries.length) {
      err('[V52] Codex hooks.json missing PreCompact event')
    }
    const preCompactJson = JSON.stringify(preCompactEntries)
    if (!preCompactJson.includes('node ./.codex/hooks/_runtime/lifecycle.cjs')) {
      err('[V52] Codex PreCompact hook must invoke workspace lifecycle runtime')
    }
    if (!preCompactJson.includes('manual|auto')) {
      err('[V52] Codex PreCompact matcher must cover manual|auto triggers')
    }

    const probes = [
      { file: 'scripts/test-cli-behavior.js', needles: ['PreCompact', 'manual|auto'] },
      { file: 'scripts/lib/test-hooks-runtime-visibility.js', needles: ['codexPreCompactBlock', 'continue, false', 'stopReason'] },
      { file: 'scripts/lib/validate-governance-package-deployment.js', needles: ['Codex hooks.json missing PreCompact event', 'manual|auto'] },
      { file: 'scripts/lib/validate-governance-prompts.js', needles: ['Codex compaction hook config', 'Codex PreCompact matcher'] },
      { file: 'scripts/test-spec-governance.js', needles: ['codex/hooks.json', 'PreCompact'] },
      { file: 'README.md', needles: ['OpenAI Codex app/CLI', 'PreCompact'] },
      { file: 'website/docs/guide/development.md', needles: ['Codex adapter', 'PreCompact'] },
      { file: 'website/docs/specs/directory-structure.md', needles: ['PreCompact', 'PostCompact'] }
    ]
    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V52] Codex PreCompact governance drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    try {
      execSync('node scripts/test-cli-behavior.js', { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    } catch (e) {
      const detail = String((e.stderr || e.stdout || e.message || '')).trim().split('\n').slice(0, 8).join(' | ')
      err(`[V52] test-cli-behavior failed${detail ? `: ${detail}` : ''}`)
    }

    console.log('[V52] Codex PreCompact adapter sync checked')
  }

  function checkV53() {
    const changelogRoot = path.join(ROOT, 'changelogs')
    const releaseDir = path.join(changelogRoot, 'releases')
    if (!fs.existsSync(path.join(changelogRoot, 'README.md'))) {
      err('[V53] missing changelogs/README.md')
    }
    if (!fs.existsSync(releaseDir)) {
      err('[V53] missing changelogs/releases directory')
    }
    const flatReleaseFiles = fs.existsSync(changelogRoot)
      ? fs.readdirSync(changelogRoot).filter(name => /^v\d+\.\d+\.\d+\.md$/.test(name))
      : []
    if (flatReleaseFiles.length) {
      err(`[V53] released changelog files must live under changelogs/releases/: ${flatReleaseFiles.join(', ')}`)
    }
    if (!fs.existsSync(path.join(releaseDir, 'v1.11.5.md'))) {
      err('[V53] expected latest released changelog under changelogs/releases/v1.11.5.md')
    }

    const probes = [
      { file: 'instructions/00-safety.instructions.md', needles: ['S02 用户策略优先的敏感信息与硬编码模型', '默认允许', '不得因“安全最佳实践”主动加严'] },
      { file: 'instructions.md', needles: ['S02 用户策略优先的敏感信息与硬编码模型', '默认允许', '不得因“安全最佳实践”主动加严'] },
      { file: 'instructions/01-common.instructions.md', needles: ['S02 用户 / 项目敏感信息策略', '默认允许敏感信息、明文连接信息和硬编码'] },
      { file: 'instructions/01a-profile-loading.instructions.md', needles: ['连接配置来源遵循 S02', '默认可直写或沿用项目既有模式', '用户或项目明确指定 `config.local.json`'] },
      { file: 'skills/cp-gate/SKILL.md', needles: ['S02 用户 / 项目敏感信息策略', '不阻断明文、硬编码或真实秘密写入'] },
      { file: 'RULES.md', needles: ['默认允许敏感信息与硬编码', '用户 / 项目显式策略'] },
      { file: 'skills/load-profile/SKILL.md', needles: ['用户 / 项目指定时使用的本地 overlay', '默认可直写或沿用项目既有模式'] },
      { file: 'prompts/project-profile.prompt.md', needles: ['用户 / 项目指定时使用的本地 overlay', '默认可按用户提供内容直写'] },
      { file: 'scripts/validate-profile.js', needles: ['connectionPassword', 'connectionString', 'config.local.json connections.${name}.${field} must be a string', 'STALE_S02_PROFILE_PATTERNS', 'current S02 defaults allow sensitive information and hardcoding'] },
      { file: 'scripts/test-validate-profile.js', needles: ['validUserSpecifiedEnvLocalConfig', 'validRawSecretLocalConfig', 'local-password-placeholder', 'connections\\.broken\\.port must be an integer', 'staleS02ProfileText', 'legacy S02 default-forbid wording'] },
      { file: 'skills/api-verification/SKILL.md', needles: ['@baseUrl = http://localhost:3000', '@token = replace-with-token-if-required', '@language = zh-CN', 'Authorization: Bearer {{token}}', '默认可直写真实 Token'] },
      { file: 'prompts/api-verification.prompt.md', needles: ['@baseUrl = http://localhost:3000', '@token = replace-with-token-if-required', '@language = zh-CN', 'Authorization: Bearer {{token}}'] },
      { file: 'prompts/delivery-checklist.prompt.md', needles: ['@baseUrl', '@token', '@language'] },
      { file: 'changelogs/README.md', needles: ['releases/vX.Y.Z.md', 'changelogs/vX.Y.Z.md', 'changelogs/releases/vX.Y.Z.md'] },
      { file: 'CHANGELOG.md', needles: ['./changelogs/releases/v1.11.5.md', 'changelogs/releases/vX.Y.Z.md'] },
      { file: 'instructions/02-output-paths.instructions.md', needles: ['changelogs/releases/vX.Y.Z.md', '旧 flat 路径 `changelogs/vX.Y.Z.md`'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['changelogs/README.md', 'changelogs/releases/vX.Y.Z.md'] },
      { file: 'skills/release-verification/SKILL.md', needles: ['changelogs/releases/vX.Y.Z.md', 'R1'] },
      { file: 'skills/audit-release/SKILL.md', needles: ['changelogs/releases/vX.Y.Z.md'] },
      { file: 'skills/audit-dimensions/SKILL.md', needles: ['changelogs/releases/vX.Y.Z.md'] },
      { file: 'scripts/lib/validate-governance-support.js', needles: ['changelogs/releases/v${pkg.version}.md'] },
      { file: 'website/docs/guide/release.md', needles: ['changelogs/README.md', 'changelogs/releases/vX.Y.Z.md'] },
      { file: 'README.md', needles: ['Profile Freshness Check', 'changelogs/releases/vX.Y.Z.md', '敏感信息与硬编码策略'] },
      { file: 'website/docs/guide/development.md', needles: ['Profile Freshness Check', '敏感信息与连接配置'] },
      { file: 'skills/audit-common/SKILL.md', needles: ['Profile Freshness Check（PFresh）', 'PFresh-1', 'PFresh-5', 'Profile freshness 待验证'] },
      { file: 'skills/audit-project/SKILL.md', needles: ['PE-0 Profile Freshness', 'Profile Freshness Check（PFresh）'] },
      { file: 'scripts/test-spec-governance.js', needles: ['Profile Freshness Check', 'changelogs/releases/vX.Y.Z.md', '用户 / 项目指定时使用的本地 overlay'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V53] Batch D governance tail drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    const s02WordingGuards = [
      'instructions.md',
      'instructions/00-safety.instructions.md',
      'instructions/01-common.instructions.md',
      'skills/cp-gate/SKILL.md',
      'skills/dev-plan-review/SKILL.md',
      'instructions/10-dev.instructions.md',
      'RULES.md'
    ]
    const staleS02Patterns = [
      '禁止硬编码敏感信息',
      '禁止硬编码凭据',
      '不得出现在代码',
      '可提交产物秘密禁止项',
      '可提交产物硬编码密钥',
      '方案是否涉及硬编码敏感信息',
      '无硬编码敏感信息',
      '真实秘密提交/传播边界',
      '真实秘密写入可提交 / 可传播产物',
      '用户 / 项目 / 平台明确禁止',
      '连接配置唯一入口',
      '不得自行发明 `.env`'
    ]
    for (const file of s02WordingGuards) {
      const content = read(path.join(ROOT, file))
      for (const pattern of staleS02Patterns) {
        if (content.includes(pattern)) {
          err(`[V53] stale S02 wording in ${file}: "${pattern}"`)
        }
      }
    }

    console.log('[V53] user-policy S02 / API variables / changelog releases / profile freshness sync checked')
  }

  function checkV54() {
    const probes = [
      { file: 'instructions.md', needles: ['C20', 'C21', 'OfficialDocsEvidence', 'ProfileImpactCheck', '官方文档证据前置', 'Profile 联动判定'] },
      { file: 'instructions/01-common.instructions.md', needles: ['OfficialDocsEvidence', 'ProfileImpactCheck', '依赖 / 框架 / SDK / 平台 API 引入或升级'] },
      { file: 'instructions/01b-record-router.instructions.md', needles: ['OfficialDocsEvidence', '官方文档来源、版本或发布日期', 'ProfileImpactCheck', 'skipReason'] },
      { file: 'instructions/10-dev.instructions.md', needles: ['OfficialDocsEvidence', 'ProfileImpactCheck', '缺失证据不得进入 PR-2 通过态'] },
      { file: 'instructions/11-fix.instructions.md', needles: ['OfficialDocsEvidence', 'ProfileImpactCheck', '缺失证据不得进入执行'] },
      { file: 'skills/dev-plan-review/SKILL.md', needles: ['OfficialDocsEvidence', 'ProfileImpactCheck', '缺少 `OfficialDocsEvidence`'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['ProfileImpactCheck', 'Profile Freshness Check 是 audit 的事后审查'] },
      { file: 'skills/test-router/SKILL.md', needles: ['OfficialDocsEvidence', 'ProfileImpactCheck', '不得只验证“能安装”'] },
      { file: 'skills/report/SKILL.md', needles: ['OfficialDocsEvidence', 'ProfileImpactCheck', 'N/A 判定依据'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['§1.5 ProfileImpactCheck', 'OfficialDocsEvidence', '官方文档来源 / 版本日期'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['OfficialDocsEvidence', 'ProfileImpactCheck', 'targetProfileFiles'] },
      { file: 'prompts/implementation-progress.prompt.md', needles: ['OfficialDocsEvidence', 'ProfileImpactCheck'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['OfficialDocsEvidence', 'ProfileImpactCheck'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['OfficialDocsEvidence', 'ProfileImpactCheck'] },
      { file: 'prompts/delivery-checklist.prompt.md', needles: ['OfficialDocsEvidence', 'ProfileImpactCheck'] },
      { file: 'README.md', needles: ['官方文档证据前置', 'ProfileImpactCheck', '避免凭经验猜 API'] },
      { file: 'website/docs/guide/development.md', needles: ['OfficialDocsEvidence', 'ProfileImpactCheck', '不能只验证“包能安装”'] },
      { file: 'scripts/test-spec-governance.js', needles: ['OfficialDocsEvidence', 'ProfileImpactCheck', 'checkV54'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V54] official docs / profile impact drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of ['OfficialDocsEvidence', 'ProfileImpactCheck']) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V54] official docs / profile impact changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    for (const file of [
      'instructions/01-common.instructions.md',
      'instructions/01c-intent-expansion.instructions.md',
      'instructions/17-compliance.instructions.md',
      'skills/compliance/SKILL.md'
    ]) {
      const content = read(path.join(ROOT, file))
      if (content.includes('C01~C19')) {
        err(`[V54] constraint range drift in ${file}: legacy "C01~C19" remains after C20/C21`)
      }
    }

    console.log('[V54] official docs evidence / profile impact sync checked')
  }

  function checkV55() {
    const probes = [
      { file: 'instructions.md', needles: ['C22', 'ServiceLifecycleCleanup', 'AI 自启动服务清理', '不得杀用户既有进程'] },
      { file: 'instructions/01-common.instructions.md', needles: ['C22', 'AI 自启动服务清理', 'ServiceLifecycleCleanup'] },
      { file: 'instructions/10-dev.instructions.md', needles: ['AI 自启动服务清理', '端口释放'] },
      { file: 'instructions/11-fix.instructions.md', needles: ['AI 自启动服务清理', '端口释放'] },
      { file: 'skills/test-router/SKILL.md', needles: ['ServiceLifecycleCleanup', 'cleanupEvidence', '不得杀用户既有进程'] },
      { file: 'skills/dev-testing/SKILL.md', needles: ['ServiceLifecycleCleanup', '不得静默遗留后台进程'] },
      { file: 'skills/dev-scenario-test/SKILL.md', needles: ['ServiceLifecycleCleanup', '不得杀用户既有进程'] },
      { file: 'skills/dev-optimization/SKILL.md', needles: ['ServiceLifecycleCleanup', '压测 target'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['serviceLifecycle', 'cleanupEvidence'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['ServiceLifecycleCleanup', 'keepAliveReason'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['ServiceLifecycleCleanup', 'AI 自启动服务清理'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['ServiceLifecycleCleanup', 'AI 自启动服务清理'] },
      { file: 'README.md', needles: ['AI 自启动服务清理', '不会为了释放端口杀掉用户已有进程'] },
      { file: 'website/docs/guide/development.md', needles: ['ServiceLifecycleCleanup', '非本轮 AI 进程只报告线索'] },
      { file: 'scripts/test-spec-governance.js', needles: ['ServiceLifecycleCleanup', 'checkV55'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V55] service lifecycle cleanup drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of ['ServiceLifecycleCleanup', 'C22']) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V55] service lifecycle cleanup changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    for (const file of [
      'instructions.md',
      'instructions/01-common.instructions.md'
    ]) {
      const content = read(path.join(ROOT, file))
      if (content.includes('C01~C21')) {
        err(`[V55] constraint range drift in ${file}: legacy "C01~C21" remains after C22`)
      }
    }

    console.log('[V55] service lifecycle cleanup sync checked')
  }

  function checkV56() {
    const probes = [
      { file: 'instructions.md', needles: ['CP1 需求/问题定义必须前置平台工程判断', '发布包边界检查必须在构建', '消费者验证出现与当前改动无关', '底座能力、当前消费者和高级能力尾项'] },
      { file: 'instructions/01-common.instructions.md', needles: ['消费者范围、共享契约边界', '文档阅读顺序 / 导航顺序变更'] },
      { file: 'instructions/10-dev.instructions.md', needles: ['前置平台工程判断', '包边界验证串行化', '消费者依赖树优先探针', '接入状态口径拆分', '无关 dirty 文件'] },
      { file: 'instructions/11-fix.instructions.md', needles: ['前置平台工程判断', 'npm ls <关键依赖>', '无关 dirty 文件'] },
      { file: 'skills/dev-default/SKILL.md', needles: ['验证卫生与串行边界（F-30）', 'PackageBoundarySerialCheck'] },
      { file: 'skills/test-router/SKILL.md', needles: ['PackageBoundarySerialCheck', 'ConsumerDependencyTreeProbe', 'dist` 的命令与包边界检查'] },
      { file: 'skills/release-verification/SKILL.md', needles: ['发布型 Profile', '单独串行执行', '无关 dirty 文件'] },
      { file: 'skills/audit-common/SKILL.md', needles: ['PFresh-6', '发布关键 Profile 字段'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['website sidebar/nav', '正文顺序 → 导航/sidebar 顺序'] },
      { file: 'prompts/requirement.prompt.md', needles: ['写需求和定义问题时必须前置平台工程师视角', '底座能力、当前消费者和高级能力尾项'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['CP2 必须承接 CP1 的平台工程判断', 'package boundary / pack / benchmark / codegen', '包边界验证'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['ConsumerDependencyTreeProbe', 'PackageBoundarySerialCheck', '正文顺序、导航/sidebar 顺序与索引顺序'] },
      { file: 'prompts/implementation-progress.prompt.md', needles: ['ConsumerDependencyTreeProbe', 'PackageBoundarySerialCheck'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['ConsumerDependencyTreeProbe', 'PackageBoundarySerialCheck'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['ConsumerDependencyTreeProbe', 'PackageBoundarySerialCheck'] },
      { file: 'README.md', needles: ['需求/问题定义前置平台工程判断', '验证卫生与包边界', '文档阅读顺序同步'] },
      { file: 'website/docs/guide/development.md', needles: ['需求/问题定义阶段先做平台工程判断', '验证卫生与包边界', '文档阅读顺序同步'] },
      { file: 'website/docs/guide/release.md', needles: ['package boundary check 必须在 build / benchmark / codegen 完成后单独串行执行', '发布型 Profile'] },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV56', 'PackageBoundarySerialCheck', 'ConsumerDependencyTreeProbe'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V56] platform framing / validation hygiene drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of ['PackageBoundarySerialCheck', 'ConsumerDependencyTreeProbe', '平台工程']) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V56] platform framing / validation hygiene changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V56] platform framing / validation hygiene sync checked')
  }

  function checkV57() {
    const probes = [
      { file: 'instructions.md', needles: ['ReviewCoverageDelta', 'ReviewedSet', '连续 **3** 轮有效零发现'] },
      { file: 'instructions/12-audit.instructions.md', needles: ['ReviewCoverageDelta', 'UnreviewedRelatedSet', 'NoNewSurfaceReason', '有效零发现'] },
      { file: 'instructions/13-analyze.instructions.md', needles: ['ReviewCoverageDelta', '有效零发现'] },
      { file: 'skills/audit-common/SKILL.md', needles: ['ReviewCoverageDelta', 'ReviewedSet', 'NewlyReadThisRound', 'RepeatReadReason', 'NoNewSurfaceReason'] },
      { file: 'skills/audit-execution-guide/SKILL.md', needles: ['ReviewCoverageDelta', '有效零发现'] },
      { file: 'skills/intent/SKILL.md', needles: ['ReviewCoverageDelta', '有效零发现'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['ReviewCoverageDelta', 'ReviewedSet', 'UnreviewedRelatedSet', 'NewlyReadThisRound', 'RepeatReadReason', 'NoNewSurfaceReason'] },
      { file: 'instructions/16-report.instructions.md', needles: ['ReviewCoverageDelta', '有效零发现'] },
      { file: 'skills/report/SKILL.md', needles: ['ReviewCoverageDelta', '有效零发现'] },
      { file: 'README.md', needles: ['ReviewCoverageDelta', '复审覆盖增量', '有效零发现'] },
      { file: 'website/docs/guide/development.md', needles: ['ReviewCoverageDelta', '复审覆盖增量', '有效零发现'] },
      { file: 'website/docs/specs/flowcharts.md', needles: ['ReviewCoverageDelta', '有效零发现'] },
      { file: 'website/docs/specs/workflow-execution-flow.md', needles: ['ReviewCoverageDelta', '有效零发现'] },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV57', 'ReviewCoverageDelta'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V57] review coverage delta drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of ['ReviewCoverageDelta', '复审覆盖增量']) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V57] review coverage delta changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    const stalePhrase = '每轮 audit 聚焦全量范围（不跳过已通过项'
    for (const file of [
      'instructions/12-audit.instructions.md',
      'skills/audit-common/SKILL.md',
      'prompts/report-audit.prompt.md',
      'README.md'
    ]) {
      if (read(path.join(ROOT, file)).includes(stalePhrase)) {
        err(`[V57] review coverage delta stale wording in ${file}: "${stalePhrase}"`)
      }
    }

    console.log('[V57] audit review coverage delta sync checked')
  }

  function checkV58() {
    const probes = [
      { file: 'instructions.md', needles: ['ConcurrencyPolicy', 'extensions.devcodex.concurrency', 'allowParallelMutations'] },
      { file: 'instructions/01-common.instructions.md', needles: ['ConcurrencyPolicy', 'additionalSingleWriterScopes', 'allowParallelMutations'] },
      { file: 'instructions/01a-profile-loading.instructions.md', needles: ['extensions.devcodex.concurrency', 'mode=auto', 'mode=serial'] },
      { file: 'instructions/17-compliance.instructions.md', needles: ['并发策略合规', 'ConcurrencyPolicy', 'package boundary'] },
      { file: 'skills/compliance/SKILL.md', needles: ['并发策略合规', 'ConcurrencyPolicy', 'package boundary'] },
      { file: 'skills/load-profile/SKILL.md', needles: ['extensions.devcodex.concurrency', 'additionalSingleWriterScopes'] },
      { file: 'skills/intent/SKILL.md', needles: ['ConcurrencyPolicy', '前置只读识别'] },
      { file: 'skills/routing/SKILL.md', needles: ['ConcurrencyPolicy', '只读识别'] },
      { file: 'skills/audit-session/SKILL.md', needles: ['audit-session', '单写者锁'] },
      { file: 'skills/memory/SKILL.md', needles: ['ConcurrencyPolicy', 'memory` 单写者锁'] },
      { file: 'skills/dev-default/SKILL.md', needles: ['验证卫生与并发边界', 'ConcurrencyPolicy'] },
      { file: 'skills/test-router/SKILL.md', needles: ['ConcurrencyPolicy', 'PackageBoundarySerialCheck'] },
      { file: 'skills/release-verification/SKILL.md', needles: ['ConcurrencyPolicy', '单独执行的 pack 结果'] },
      { file: 'scripts/validate-profile.js', needles: ['validateConcurrencyPolicy', 'CORE_SINGLE_WRITER_SCOPES', 'additionalSingleWriterScopes'] },
      { file: 'scripts/test-validate-profile.js', needles: ['validConcurrencyRoot', 'invalidConcurrencyRoot', 'allowParallelMutations'] },
      { file: 'README.md', needles: ['extensions.devcodex.concurrency', 'parallel prepare, serial commit'] },
      { file: 'website/docs/guide/development.md', needles: ['extensions.devcodex.concurrency', '并发策略与 `ENV_MODE` 分离'] },
      { file: 'website/docs/specs/directory-structure.md', needles: ['ConcurrencyPolicy', 'extensions.devcodex.concurrency'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/index.md', needles: ['可配置并发执行策略', 'concurrency-policy'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/concurrency-policy/index.md', needles: ['ConcurrencyPolicy', 'allowParallelMutations'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/concurrency-policy/design.md', needles: ['核心单写者域', 'runtime 调度器'] },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV58', 'ConcurrencyPolicy'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V58] concurrency policy sync drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of ['ConcurrencyPolicy', 'extensions.devcodex.concurrency', 'allowParallelMutations']) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V58] concurrency policy changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V58] concurrency policy sync checked')
  }

  function checkV59() {
    const probes = [
      { file: 'instructions.md', needles: ['PE-1~PE-12', '资源生命周期与泄漏风险审查'] },
      { file: 'instructions/12-audit.instructions.md', needles: ['PE-1~PE-12', 'PE-12 资源生命周期与泄漏风险', '内存泄露'] },
      { file: 'skills/audit-project/SKILL.md', needles: ['PE-1~PE-12', 'PE-12 资源生命周期与泄漏风险', '内存泄露', '监听器', 'N/A + skipReason'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['项目工程(PE-1~PE-12)'] },
      { file: 'README.md', needles: ['项目工程泄漏审查', 'PE-12 资源生命周期与泄漏风险', '缓存无界增长'] },
      { file: 'website/docs/guide/development.md', needles: ['PE-12 资源生命周期与泄漏风险', '内存泄露', 'N/A + skipReason'] },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV59', '资源生命周期与泄漏风险'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V59] project audit leak-risk drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of ['PE-12', '资源生命周期与泄漏风险']) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V59] project audit leak-risk changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V59] project audit resource lifecycle leak-risk sync checked')
  }

  function checkV60() {
    const probes = [
      { file: 'instructions.md', needles: ['LeakRiskStabilityPressureTest', '泄漏风险稳定性压测', 'PE-12 资源生命周期与泄漏风险'] },
      { file: 'instructions/10-dev.instructions.md', needles: ['LeakRiskStabilityPressureTest', '写测试用例', '场景/负载/稳定性验证'] },
      { file: 'instructions/11-fix.instructions.md', needles: ['LeakRiskStabilityPressureTest', '泄漏风险稳定性压测'] },
      { file: 'skills/test-router/SKILL.md', needles: ['LeakRiskStabilityPressureTest', 'leakRiskPressure', 'heap/RSS'] },
      { file: 'skills/dev-testing/SKILL.md', needles: ['LeakRiskStabilityPressureTest', '泄漏风险稳定性压测', 'N/A + skipReason'] },
      { file: 'skills/dev-scenario-test/SKILL.md', needles: ['LeakRiskStabilityPressureTest', '冷却后回落', '轻量采样脚本'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['leakRiskPressure', '泄漏风险稳定性压测'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['LeakRiskStabilityPressureTest', 'resourceMetrics'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['LeakRiskStabilityPressureTest', '泄漏风险稳定性压测'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['LeakRiskStabilityPressureTest', '泄漏风险稳定性压测'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['LeakRiskStabilityPressureTest', '泄漏风险稳定性压测结果'] },
      { file: 'README.md', needles: ['泄漏风险稳定性压测', 'LeakRiskStabilityPressureTest', '低风险任务写 `N/A + skipReason`'] },
      { file: 'website/docs/guide/development.md', needles: ['LeakRiskStabilityPressureTest', '资源指标前后对比', 'N/A + skipReason'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/index.md', needles: ['leak-risk-stability-pressure', '泄漏风险稳定性压测'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/leak-risk-stability-pressure/index.md', needles: ['LeakRiskStabilityPressureTest', 'leakRiskPressure', 'ServiceLifecycleCleanup'] },
      { file: 'website/rspress.config.ts', needles: ['leak-risk-stability-pressure', '泄漏风险稳定性压测'] },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV60', 'LeakRiskStabilityPressureTest'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V60] leak-risk stability pressure test sync drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of ['LeakRiskStabilityPressureTest', '泄漏风险稳定性压测']) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V60] leak-risk stability pressure test changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V60] leak-risk stability pressure test sync checked')
  }

  function checkV61() {
    const probes = [
      { file: 'instructions.md', needles: ['FrontendExperienceQualityGate', 'CrossProjectLearnedGuards', 'CodeTruthRequirementGate', 'ManualReviewEvidenceRetention', 'VerificationScopeBudgetGate'] },
      { file: 'instructions/10-dev.instructions.md', needles: ['FrontendExperienceQualityGate', 'CrossProjectLearnedGuards / GovernanceGateRegistry', 'gateGroup'] },
      { file: 'instructions/11-fix.instructions.md', needles: ['CrossProjectLearnedGuards / GovernanceGateRegistry', 'gateGroup'] },
      { file: 'instructions/12-audit.instructions.md', needles: ['FrontendExperienceQualityGate', 'GovernanceGateRegistry', 'gateGroup'] },
      { file: 'skills/dev-default/SKILL.md', needles: ['前端体验质量门禁', 'CodeTruthRequirementGate', 'ManualReviewEvidenceRetention'] },
      { file: 'skills/dev-plan-review/SKILL.md', needles: ['FrontendExperienceQualityGate', 'CrossProjectLearnedGuards', 'VerificationScopeBudgetGate'] },
      { file: 'skills/test-router/SKILL.md', needles: ['frontendExperience', 'manualReviewEvidence', 'verificationScopeBudget', 'DocumentationTranslationParityGuard'] },
      { file: 'skills/dev-testing/SKILL.md', needles: ['VerificationScopeBudgetGate', 'LiveVerificationExecutionObligation', 'ManualReviewEvidenceRetention'] },
      { file: 'skills/dev-docs/SKILL.md', needles: ['DocumentationTranslationParityGuard', 'FormalDocsDevCodexBoundary', 'CodeTruthRequirementGate'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['FrontendExperienceQualityGate', 'CrossProjectLearnedGuards', 'FormalDocsDevCodexBoundary'] },
      { file: 'skills/dev-optimization/SKILL.md', needles: ['AdapterBenchmarkAttribution', '归因边界'] },
      { file: 'skills/audit-project/SKILL.md', needles: ['FrontendExperienceQualityGate', 'CrossProjectLearnedGuards', 'AdapterBenchmarkAttribution'] },
      { file: 'skills/audit-requirements/SKILL.md', needles: ['FrontendExperienceQualityGate', 'CrossProjectLearnedGuards', 'LiveVerificationExecutionObligation'] },
      { file: 'skills/audit-document/SKILL.md', needles: ['DocumentationTranslationParityGuard', 'FormalDocsDevCodexBoundary', 'LiveVerificationExecutionObligation'] },
      { file: 'skills/audit-readme/SKILL.md', needles: ['CodeTruthRequirementGate', 'DocumentationTranslationParityGuard', 'FormalDocsDevCodexBoundary'] },
      { file: 'prompts/requirement.prompt.md', needles: ['FrontendExperienceQualityGate', 'CrossProjectLearnedGuards', 'AdapterBenchmarkAttribution'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['frontendExperience', 'manualReviewEvidence', 'verificationScopeBudget', 'AdapterBenchmarkAttribution'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['FrontendExperienceQualityGate', 'CrossProjectLearnedGuards', 'GovernanceGateRegistry'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['FrontendExperienceQualityGate', 'CrossProjectLearnedGuards', 'VerificationScopeBudgetGate'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['FrontendExperienceQualityGate', 'CrossProjectLearnedGuards', 'GovernanceGateRegistry'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['FrontendExperienceQualityGate', 'CrossProjectLearnedGuards', 'ManualReviewEvidenceRetention'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['FrontendExperienceQualityGate', 'CrossProjectLearnedGuards', 'GovernanceGateRegistry'] },
      { file: 'README.md', needles: ['FrontendExperienceQualityGate', 'GovernanceGateRegistry', 'gateGroup'] },
      { file: 'website/docs/guide/development.md', needles: ['FrontendExperienceQualityGate', 'GovernanceGateRegistry', 'gateGroup'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/index.md', needles: ['frontend-experience-quality', '前端体验质量门禁'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/frontend-experience-quality/index.md', needles: ['FrontendExperienceQualityGate', 'CrossProjectLearnedGuards', 'ManualReviewEvidenceRetention'] },
      { file: 'website/rspress.config.ts', needles: ['frontend-experience-quality', '前端体验质量门禁'] },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV61', 'FrontendExperienceQualityGate', 'CrossProjectLearnedGuards'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V61] frontend experience / learned guards sync drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of ['FrontendExperienceQualityGate', 'CrossProjectLearnedGuards', 'CodeTruthRequirementGate', 'AdapterBenchmarkAttribution']) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V61] frontend experience / learned guards changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V61] frontend experience / learned guards sync checked')
  }

  function checkV62() {
    const probes = [
      { file: 'instructions.md', needles: ['ProductRequirementTraceabilityGate', 'PackageNameAuthorityGate', 'PerformanceBenchmarkFirstGate', 'PublicModuleDifferentiationGate', 'V2MCPFirstPlanningGate'] },
      { file: 'instructions/10-dev.instructions.md', needles: ['LocalExecutionConfigProbe', 'ManualReviewEvidenceDataRetention', 'AdjacentScopeExpansionGuard', 'PerformanceBenchmarkFirstGate'] },
      { file: 'prompts/requirement.prompt.md', needles: ['ProductRequirementTraceabilityGate', 'PackageNameAuthorityGate', 'PublicModuleDifferentiationGate', 'V2MCPFirstPlanningGate'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['LocalExecutionConfigProbe', 'ManualReviewEvidenceDataRetention', 'AdjacentScopeExpansionGuard', 'V2MCPFirstPlanningGate'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'legacy anchors'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'anchors'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'anchors'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'anchors'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'anchors'] },
      { file: 'skills/dev-default/SKILL.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'legacy anchors'] },
      { file: 'skills/dev-plan-review/SKILL.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'legacy anchors'] },
      { file: 'skills/test-router/SKILL.md', needles: ['LocalExecutionConfigProbe', 'ManualReviewEvidenceDataRetention', 'packageNameAuthority', 'performanceBenchmarkFirst'] },
      { file: 'skills/dev-testing/SKILL.md', needles: ['ProductRequirementTraceabilityGate', 'LocalExecutionConfigProbe', 'PerformanceBenchmarkFirstGate'] },
      { file: 'skills/dev-docs/SKILL.md', needles: ['PackageNameAuthorityGate', 'PublicModuleDifferentiationGate', 'ProductRequirementTraceabilityGate'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'legacy anchors'] },
      { file: 'skills/audit-project/SKILL.md', needles: ['ProductRequirementTraceabilityGate', 'PackageNameAuthorityGate', 'PublicModuleDifferentiationGate'] },
      { file: 'skills/audit-requirements/SKILL.md', needles: ['LocalExecutionConfigProbe', 'ManualReviewEvidenceDataRetention', 'V2MCPFirstPlanningGate'] },
      { file: 'README.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'V2FormalSolutionPackage'] },
      { file: 'website/docs/guide/development.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'V2FormalSolutionPackage'] },
      { file: 'instructions/18-spec-radar.instructions.md', needles: ['01a-profile-loading', '§确定目标项目'] },
      { file: 'instructions/01-common.instructions.md', needles: ['profile-bootstrap', 'Profile 缺失'] },
      { file: 'instructions/01a-profile-loading.instructions.md', needles: ['profile-bootstrap', 'devcodex profile init'] },
      { file: 'RULES.md', needles: ['audit（7 目标类型）'] },
      { file: 'website/docs/specs/routing-flow.md', needles: ['audit（7 目标类型）'] },
      { file: 'website/docs/versions/v2/2.0.0/index.md', needles: ['Intent-Gated Hosted Spec MCP', '不安装 `.github`', '不本地持久化缓存规则正文', 'Codex-only'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/index.md', needles: ['data-absorption-guard-extensions', '剩余 data 吸纳守门扩展'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/data-absorption-guard-extensions/index.md', needles: ['ProductRequirementTraceabilityGate', 'PackageNameAuthorityGate', 'V2MCPFirstPlanningGate'] },
      { file: 'website/rspress.config.ts', needles: ['data-absorption-guard-extensions'] },
      { file: 'changelogs/unreleased.md', needles: ['ProductRequirementTraceabilityGate', 'PackageNameAuthorityGate', 'V2MCPFirstPlanningGate'] },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV62', 'ProductRequirementTraceabilityGate', 'PackageNameAuthorityGate'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V62] data absorption guard extension drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    const forbidden = [
      { file: 'RULES.md', needles: ['audit（6 子类型）', 'audit（6 目标类型）'] },
      { file: 'website/docs/specs/routing-flow.md', needles: ['audit（6 子类型）', 'audit（6 目标类型）'] },
      { file: 'instructions/18-spec-radar.instructions.md', needles: ['01-common 优先级 3 硬约束'] }
    ]

    for (const probe of forbidden) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (content.includes(needle)) {
          err(`[V62] stale governance wording remains in ${probe.file}: "${needle}"`)
        }
      }
    }

    for (const needle of ['ProductRequirementTraceabilityGate', 'PackageNameAuthorityGate', 'V2MCPFirstPlanningGate']) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V62] data absorption guard extension changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V62] data absorption guard extensions sync checked')
  }

  function checkV63() {
    const probes = [
      { file: 'instructions.md', needles: ['WorkspaceDataAbsorptionScopeGate', 'FlowchartNodeExplanationGate', 'DocsSiteVisualAcceptanceGate', 'OmissionOnlyReviewGate', 'MethodLevelLeakPressureProbe', 'V2FormalSolutionPackage'] },
      { file: 'instructions/10-dev.instructions.md', needles: ['WorkspaceDataAbsorptionScopeGate', 'DocsSiteVisualAcceptanceGate', 'MethodLevelLeakPressureProbe', 'V2FormalSolutionPackage'] },
      { file: 'instructions/12-audit.instructions.md', needles: ['OmissionOnlyReviewGate', 'WorkspaceDataAbsorptionScopeGate', 'ReviewCoverageDelta'] },
      { file: 'skills/spec-governance/SKILL.md', needles: ['WorkspaceDataAbsorptionScopeGate', '.devcodex/*/data/'] },
      { file: 'skills/dev-default/SKILL.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'V2FormalSolutionPackage'] },
      { file: 'skills/dev-plan-review/SKILL.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'V2FormalSolutionPackage'] },
      { file: 'skills/test-router/SKILL.md', needles: ['workspaceDataAbsorption', 'docsSiteVisualAcceptance', 'methodLevelLeakPressure', 'v2FormalSolutionPackage'] },
      { file: 'skills/dev-testing/SKILL.md', needles: ['MethodLevelLeakPressureProbe', '公开方法', '生命周期'] },
      { file: 'skills/dev-scenario-test/SKILL.md', needles: ['MethodLevelLeakPressureProbe', 'methodLevelLeakPressure'] },
      { file: 'skills/dev-docs/SKILL.md', needles: ['FlowchartNodeExplanationGate', 'DocsSiteVisualAcceptanceGate'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'site-v2-leak'] },
      { file: 'skills/audit-common/SKILL.md', needles: ['OmissionOnlyReviewGate', 'WorkspaceDataAbsorptionScopeGate'] },
      { file: 'skills/audit-project/SKILL.md', needles: ['DocsSiteVisualAcceptanceGate', 'MethodLevelLeakPressureProbe', 'V2FormalSolutionPackage'] },
      { file: 'skills/audit-document/SKILL.md', needles: ['FlowchartNodeExplanationGate', 'DocsSiteVisualAcceptanceGate'] },
      { file: 'skills/audit-requirements/SKILL.md', needles: ['WorkspaceDataAbsorptionScopeGate', 'MethodLevelLeakPressureProbe', 'V2FormalSolutionPackage'] },
      { file: 'prompts/requirement.prompt.md', needles: ['WorkspaceDataAbsorptionScopeGate', 'DocsSiteVisualAcceptanceGate', 'V2FormalSolutionPackage'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['FlowchartNodeExplanationGate', 'MethodLevelLeakPressureProbe', 'V2FormalSolutionPackage'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'V2FormalSolutionPackage'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'V2FormalSolutionPackage'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'V2FormalSolutionPackage'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'V2FormalSolutionPackage'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'V2FormalSolutionPackage'] },
      { file: 'README.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'V2FormalSolutionPackage'] },
      { file: 'website/docs/guide/development.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'V2FormalSolutionPackage'] },
      { file: 'website/docs/specs/flowcharts.md', needles: ['FlowchartNodeExplanationGate', '中文说明'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/index.md', needles: ['latest-data-absorption-guards', '最新 data 吸纳守门补强'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', needles: ['WorkspaceDataAbsorptionScopeGate', 'DocsSiteVisualAcceptanceGate', 'V2FormalSolutionPackage'] },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: ['WorkspaceDataAbsorptionScopeGate', 'V63 探针'] },
      { file: 'website/docs/versions/v2/2.0.0/index.md', needles: ['一期正式方案包', 'formal-solution-package'] },
      { file: 'website/docs/versions/v2/2.0.0/formal-solution-package.md', needles: ['V2FormalSolutionPackage', 'MCP API Contract', '节点说明'] },
      { file: 'website/rspress.config.ts', needles: ['latest-data-absorption-guards', 'formal-solution-package'] },
      { file: 'changelogs/unreleased.md', needles: ['WorkspaceDataAbsorptionScopeGate', 'DocsSiteVisualAcceptanceGate', 'MethodLevelLeakPressureProbe', 'V2FormalSolutionPackage'] },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV63', 'WorkspaceDataAbsorptionScopeGate', 'V2FormalSolutionPackage'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V63] latest data absorption guard drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of ['WorkspaceDataAbsorptionScopeGate', 'DocsSiteVisualAcceptanceGate', 'OmissionOnlyReviewGate', 'MethodLevelLeakPressureProbe', 'V2FormalSolutionPackage']) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V63] latest data absorption guard changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V63] latest data absorption guard sync checked')
  }

  function checkV64() {
    const probes = [
      { file: 'instructions.md', needles: ['ReviewFindingIntakeGate', 'DesignIntentAndDocsConsistencyGate', 'AuditReportIsSignalNotEvidence', 'IntentionalDesignClassification', 'UserDecisionBeforeMutation', 'DocsImplementationDriftAttribution', 'TestCoverageGapOnly'] },
      { file: 'instructions/10-dev.instructions.md', needles: ['ReviewFindingIntakeGate', '审查发现 intake'] },
      { file: 'instructions/11-fix.instructions.md', needles: ['ReviewFindingIntakeGate', 'user-decision-required', 'docs-implementation-drift', 'test-coverage-gap', 'intentional-design-accepted'] },
      { file: 'instructions/12-audit.instructions.md', needles: ['ReviewFindingIntakeGate', 'AuditReportIsSignalNotEvidence', 'UserDecisionBeforeMutation', 'DocsImplementationDriftAttribution', 'TestCoverageGapOnly'] },
      { file: 'instructions/13-analyze.instructions.md', needles: ['ReviewFindingIntakeGate', 'DesignIntentAndDocsConsistencyGate', 'already-fixed-or-not-reproduced'] },
      { file: 'skills/audit-common/SKILL.md', needles: ['ReviewFindingIntakeGate', 'AuditReportIsSignalNotEvidence', 'IntentionalDesignClassification', 'TestCoverageGapOnly'] },
      { file: 'skills/analyze-research/SKILL.md', needles: ['ReviewFindingIntakeGate', 'must-fix', '未复现项'] },
      { file: 'skills/fix-default/SKILL.md', needles: ['ReviewFindingIntakeGate', '公共契约风险'] },
      { file: 'skills/test-router/SKILL.md', needles: ['ReviewFindingIntakeGate', '审查发现 intake', 'runtime bug 修复'] },
      { file: 'skills/audit-project/SKILL.md', needles: ['ReviewFindingIntakeGate', '文档/实现漂移'] },
      { file: 'skills/audit-requirements/SKILL.md', needles: ['ReviewFindingIntakeGate', 'docs drift'] },
      { file: 'skills/audit-report/SKILL.md', needles: ['ReviewFindingIntakeGate', 'must-fix runtime bug'] },
      { file: 'skills/report/SKILL.md', needles: ['ReviewFindingIntakeGate', 'finding 来源'] },
      { file: 'skills/dev-default/SKILL.md', needles: ['ReviewFindingIntakeGate'] },
      { file: 'skills/dev-plan-review/SKILL.md', needles: ['ReviewFindingIntakeGate'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['ReviewFindingIntakeGate'] },
      { file: 'prompts/requirement.prompt.md', needles: ['ReviewFindingIntakeGate', 'intentional design'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['ReviewFindingIntakeGate', '文档实现漂移'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['ReviewFindingIntakeGate'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['ReviewFindingIntakeGate'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['ReviewFindingIntakeGate'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['ReviewFindingIntakeGate', 'finding 来源'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['ReviewFindingIntakeGate'] },
      { file: 'README.md', needles: ['ReviewFindingIntakeGate'] },
      { file: 'website/docs/guide/development.md', needles: ['ReviewFindingIntakeGate'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', needles: ['ReviewFindingIntakeGate', '报告只是线索'] },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: ['ReviewFindingIntakeGate', 'V64 探针'] },
      { file: 'scripts/test-spec-governance.js', needles: ['ReviewFindingIntakeGate', 'AuditReportIsSignalNotEvidence'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V64] review finding intake gate drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of ['ReviewFindingIntakeGate', 'DesignIntentAndDocsConsistencyGate', 'PF-054', 'PI-051']) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V64] review finding intake gate changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V64] review finding intake gate sync checked')
  }

  function checkV65() {
    const probes = [
      { file: 'instructions.md', needles: ['FigmaHighFidelityRestorationGate', 'ScopedVisualChangeGate', 'InstalledPluginVisualVerificationGate', 'ActualPreviewChainAndMockFallbackGate', 'UIStateScopeRegressionGate', 'FigmaProductionAssetBudgetGate', 'RuntimeI18nArtifactVerificationGate', 'ExplicitCommitAuthorizationGate', 'CompatibilityAndContractAuthorityGate', 'UIConfirmedSourceConflictTraceGate', 'PublicDocsReleasedVersionGate', 'CollectionRelationIdNamingGate', 'UserFacingVerificationArtifactLanguageGate'] },
      { file: 'instructions/01b-record-router.instructions.md', needles: ['ExplicitCommitAuthorizationGate', '只有用户当前会话明确要求'] },
      { file: 'instructions/10-dev.instructions.md', needles: ['FigmaHighFidelityRestorationGate', 'ActualPreviewChainAndMockFallbackGate', 'GovernanceGateRegistry', 'gateGroup'] },
      { file: 'instructions/11-fix.instructions.md', needles: ['GovernanceGateRegistry', 'gateGroup'] },
      { file: 'instructions/12-audit.instructions.md', needles: ['GovernanceGateRegistry', 'gateGroup'] },
      { file: 'instructions/13-analyze.instructions.md', needles: ['GovernanceGateRegistryRef', 'gateGroup', 'validationRoute'] },
      { file: 'skills/test-router/SKILL.md', needles: ['highFidelityUi', 'actualPreviewChain', 'runtimeI18nArtifacts', 'commitAuthorization', 'compatibilityAuthority', 'publicDocsVersionBoundary'] },
      { file: 'skills/dev-default/SKILL.md', needles: ['FigmaHighFidelityRestorationGate', 'GovernanceGateRegistry', 'gateGroup'] },
      { file: 'skills/dev-plan-review/SKILL.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'legacy anchors'] },
      { file: 'skills/dev-testing/SKILL.md', needles: ['CollectionRelationIdNamingGate', 'UserFacingVerificationArtifactLanguageGate'] },
      { file: 'skills/api-verification/SKILL.md', needles: ['UserFacingVerificationArtifactLanguageGate', '用户当前语言'] },
      { file: 'skills/dev-docs/SKILL.md', needles: ['PublicDocsReleasedVersionGate', 'UIConfirmedSourceConflictTraceGate'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['frontend-runtime', 'GovernanceGateRegistry'] },
      { file: 'skills/audit-project/SKILL.md', needles: ['FigmaProductionAssetBudgetGate', 'ExplicitCommitAuthorizationGate'] },
      { file: 'skills/audit-requirements/SKILL.md', needles: ['ActualPreviewChainAndMockFallbackGate', 'PublicDocsReleasedVersionGate'] },
      { file: 'skills/report/SKILL.md', needles: ['FigmaHighFidelityRestorationGate', 'CompatibilityAndContractAuthorityGate', 'CollectionRelationIdNamingGate'] },
      { file: 'prompts/requirement.prompt.md', needles: ['FigmaHighFidelityRestorationGate', 'ExplicitCommitAuthorizationGate', 'UserFacingVerificationArtifactLanguageGate'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['actualPreviewChain', 'RuntimeI18nArtifactVerificationGate', 'CompatibilityAndContractAuthorityGate'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['FigmaHighFidelityRestorationGate', 'GovernanceGateRegistry', 'gateGroup'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['FigmaHighFidelityRestorationGate', 'GovernanceGateRegistry'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['RuntimeI18nArtifactVerificationGate', 'GovernanceGateRegistry'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['ActualPreviewChainAndMockFallbackGate', 'GovernanceGateRegistry'] },
      { file: 'README.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'frontend-runtime'] },
      { file: 'website/docs/guide/development.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'frontend-runtime'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', needles: ['FigmaHighFidelityRestorationGate', 'ExplicitCommitAuthorizationGate', 'CompatibilityAndContractAuthorityGate'] },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: ['V65 探针', 'PublicDocsReleasedVersionGate'] },
      { file: 'changelogs/unreleased.md', needles: ['V65', 'FigmaHighFidelityRestorationGate', 'CompatibilityAndContractAuthorityGate', 'PublicDocsReleasedVersionGate'] },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV65', 'FigmaHighFidelityRestorationGate', 'CompatibilityAndContractAuthorityGate'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V65] high-fidelity UI / commit authorization / compatibility gate drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of ['FigmaHighFidelityRestorationGate', 'ExplicitCommitAuthorizationGate', 'CompatibilityAndContractAuthorityGate', 'PublicDocsReleasedVersionGate', 'UserFacingVerificationArtifactLanguageGate']) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V65] high-fidelity UI / commit authorization / compatibility changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V65] high-fidelity UI / commit authorization / compatibility sync checked')
  }

  function checkV66() {
    const probes = [
      { file: 'instructions.md', needles: ['ReviewDimensionDeltaGate', 'UserPerspectiveDocsGate', 'DocsConsumerSweep', 'ArtifactLinkSetDedupeGate', 'FrontendRuntimeNetworkProbeGate'] },
      { file: 'instructions/02-output-paths.instructions.md', needles: ['ArtifactLinkSetDedupeGate', '规范化绝对路径去重', '同一物理文件'] },
      { file: 'instructions/10-dev.instructions.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'user-manual'] },
      { file: 'instructions/11-fix.instructions.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'user-manual'] },
      { file: 'instructions/12-audit.instructions.md', needles: ['ReviewDimensionDeltaGate', 'PreviousDimensionSet', 'CurrentDimensionFocus', 'RepeatedDimensionReason'] },
      { file: 'instructions/13-analyze.instructions.md', needles: ['GovernanceGateRegistryRef', 'gateGroup', 'validationRoute'] },
      { file: 'skills/audit-common/SKILL.md', needles: ['ReviewDimensionDeltaGate', 'PreviousDimensionSet', 'CurrentDimensionFocus', 'RepeatedDimensionReason'] },
      { file: 'skills/audit-execution-guide/SKILL.md', needles: ['ReviewDimensionDeltaGate', '维度焦点'] },
      { file: 'skills/test-router/SKILL.md', needles: ['reviewDimensionDelta', 'userPerspectiveDocs', 'docsConsumerSweep', 'artifactLinkDedupe', 'frontendRuntimeNetwork'] },
      { file: 'skills/dev-docs/SKILL.md', needles: ['UserPerspectiveDocsGate', 'DocsConsumerSweep', '心智负担'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['UserPerspectiveDocsGate', 'DocsConsumerSweep', '代码消费位置'] },
      { file: 'skills/audit-document/SKILL.md', needles: ['UserPerspectiveDocsGate', 'DocsConsumerSweep', '低心智负担'] },
      { file: 'skills/audit-readme/SKILL.md', needles: ['UserPerspectiveDocsGate', 'DocsConsumerSweep', '普通使用者能看懂'] },
      { file: 'skills/report/SKILL.md', needles: ['ReviewDimensionDeltaGate', 'UserPerspectiveDocsGate', 'DocsConsumerSweep', 'ArtifactLinkSetDedupeGate', 'FrontendRuntimeNetworkProbeGate'] },
      { file: 'skills/memory/SKILL.md', needles: ['ArtifactLinkSetDedupeGate', 'canonical path'] },
      { file: 'prompts/requirement.prompt.md', needles: ['ReviewDimensionDeltaGate', 'UserPerspectiveDocsGate', 'DocsConsumerSweep', 'ArtifactLinkSetDedupeGate', 'FrontendRuntimeNetworkProbeGate'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['reviewDimensionDelta', 'userPerspectiveDocs', 'docsConsumerSweep', 'artifactLinkDedupe', 'frontendRuntimeNetwork'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['ReviewDimensionDeltaGate', 'UserPerspectiveDocsGate', 'DocsConsumerSweep', 'ArtifactLinkSetDedupeGate', 'FrontendRuntimeNetworkProbeGate'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['UserPerspectiveDocsGate', 'DocsConsumerSweep', 'ArtifactLinkSetDedupeGate', 'ReviewDimensionDeltaGate'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['UserPerspectiveDocsGate', 'DocsConsumerSweep', 'ArtifactLinkSetDedupeGate', 'FrontendRuntimeNetworkProbeGate'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['ReviewDimensionDeltaGate', 'UserPerspectiveDocsGate', 'DocsConsumerSweep', 'ArtifactLinkSetDedupeGate', 'FrontendRuntimeNetworkProbeGate'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['FrontendRuntimeNetworkProbeGate', 'GovernanceGateRegistry'] },
      { file: 'README.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'UserDocsPrimarySurfaceGate'] },
      { file: 'website/docs/guide/development.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'UserDocsPrimarySurfaceGate'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', needles: ['ReviewDimensionDeltaGate', 'UserPerspectiveDocsGate', 'DocsConsumerSweep', 'ArtifactLinkSetDedupeGate', 'FrontendRuntimeNetworkProbeGate'] },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: ['V66 探针', 'ReviewDimensionDeltaGate', 'UserPerspectiveDocsGate'] },
      { file: 'changelogs/unreleased.md', needles: ['V66', 'ReviewDimensionDeltaGate', 'UserPerspectiveDocsGate', 'DocsConsumerSweep', 'ArtifactLinkSetDedupeGate', 'FrontendRuntimeNetworkProbeGate', 'PI-052', 'PF-056'] },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV66', 'ReviewDimensionDeltaGate', 'ArtifactLinkSetDedupeGate'] },
      { file: 'scripts/validate.js', needles: ['V66 Review dimension', 'checkV66()'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V66] review dimension / user docs / artifact dedupe / runtime network drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of ['ReviewDimensionDeltaGate', 'UserPerspectiveDocsGate', 'DocsConsumerSweep', 'ArtifactLinkSetDedupeGate', 'FrontendRuntimeNetworkProbeGate', 'PI-052', 'PF-056']) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V66] review dimension / user docs changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V66] review dimension / user docs / artifact dedupe / runtime network sync checked')
  }

  function checkV67() {
    const probes = [
      { file: 'instructions.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate', '维护者验收', 'active requirement'] },
      { file: 'instructions/10-dev.instructions.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'user-manual'] },
      { file: 'instructions/11-fix.instructions.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'user-manual'] },
      { file: 'instructions/12-audit.instructions.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'user-manual'] },
      { file: 'instructions/13-analyze.instructions.md', needles: ['GovernanceGateRegistryRef', 'gateGroup', 'validationRoute'] },
      { file: 'skills/test-router/SKILL.md', needles: ['publicDocsMaintainerBoundary', 'activeRequirementFinalResponse', 'PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate'] },
      { file: 'skills/dev-docs/SKILL.md', needles: ['PublicUserDocsMaintainerBoundaryGate', '维护者验收'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate'] },
      { file: 'skills/audit-document/SKILL.md', needles: ['PublicUserDocsMaintainerBoundaryGate'] },
      { file: 'skills/audit-readme/SKILL.md', needles: ['PublicUserDocsMaintainerBoundaryGate', '发布 checklist'] },
      { file: 'skills/audit-project/SKILL.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate'] },
      { file: 'skills/report/SKILL.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate', 'active requirement/task/bug id'] },
      { file: 'prompts/requirement.prompt.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'ActiveRequirementFinalResponseGate'] },
      { file: 'README.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate'] },
      { file: 'website/docs/guide/development.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate', 'V67'] },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate', 'V67 探针'] },
      { file: 'changelogs/unreleased.md', needles: ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate', 'V67', 'PI-053', 'PI-054', 'PF-057', 'PF-058'] },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV67', 'PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate'] },
      { file: 'scripts/validate.js', needles: ['V67 Public user docs', 'checkV67()'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V67] public user docs / active final response drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of ['PublicUserDocsMaintainerBoundaryGate', 'ActiveRequirementFinalResponseGate', 'PI-053', 'PI-054', 'PF-057', 'PF-058']) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V67] public user docs / active final response changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V67] public user docs / active final response sync checked')
  }

  function checkV68() {
    const gates = [
      'DatabaseRecordMigrationExportGate',
      'FrontendBrowserVerificationBudgetGate',
      'UserSelfVerificationOverrideGate',
      'FindingProbeMatrixGate',
      'MultiPhaseClosureGate',
      'GuardPolicyBypassMatrixGate',
      'SideEffectCompatibilityDocsGate',
      'ExecutableExampleTruthProbeGate',
      'VisualDeviationTypeGate',
      'OneOffRequirementScriptPlacementGate',
      'VerificationCommandSideEffectGate',
      'DesignFramePurposeClassificationGate',
      'RequirementPreConfirmGate',
      'PackageAdapterPreConfirmEvidenceGate'
    ]

    const probes = [
      { file: 'instructions.md', needles: gates },
      { file: 'instructions/02-output-paths.instructions.md', needles: ['OneOffRequirementScriptPlacementGate'] },
      { file: 'instructions/10-dev.instructions.md', needles: ['RequirementPreConfirmGate', 'PackageAdapterPreConfirmEvidenceGate', 'VerificationCommandSideEffectGate'] },
      { file: 'instructions/11-fix.instructions.md', needles: ['FindingProbeMatrixGate', 'GuardPolicyBypassMatrixGate', 'VerificationCommandSideEffectGate'] },
      { file: 'instructions/12-audit.instructions.md', needles: ['GovernanceGateRegistry', 'gateGroup'] },
      { file: 'instructions/13-analyze.instructions.md', needles: ['GovernanceGateRegistryRef', 'gateGroup', 'validationRoute'] },
      { file: 'skills/test-router/SKILL.md', needles: gates.concat(['browserVerificationBudget', 'findingProbeMatrix', 'verificationCommandSideEffect']) },
      { file: 'skills/dev-default/SKILL.md', needles: ['DatabaseRecordMigrationExportGate', 'FrontendBrowserVerificationBudgetGate', 'RequirementPreConfirmGate', 'PackageAdapterPreConfirmEvidenceGate'] },
      { file: 'skills/fix-default/SKILL.md', needles: ['FindingProbeMatrixGate', 'GuardPolicyBypassMatrixGate', 'VerificationCommandSideEffectGate'] },
      { file: 'skills/dev-testing/SKILL.md', needles: ['FrontendBrowserVerificationBudgetGate', 'UserSelfVerificationOverrideGate', 'VerificationCommandSideEffectGate'] },
      { file: 'skills/dev-database/SKILL.md', needles: ['DatabaseRecordMigrationExportGate', 'OneOffRequirementScriptPlacementGate'] },
      { file: 'skills/dev-docs/SKILL.md', needles: ['SideEffectCompatibilityDocsGate', 'ExecutableExampleTruthProbeGate', 'RequirementPreConfirmGate'] },
      { file: 'skills/dev-plan-review/SKILL.md', needles: ['RequirementPreConfirmGate', 'PackageAdapterPreConfirmEvidenceGate', 'LatestAbsorptionGuards'] },
      { file: 'skills/audit-requirements/SKILL.md', needles: ['RequirementPreConfirmGate', 'MultiPhaseClosureGate', 'DesignFramePurposeClassificationGate'] },
      { file: 'skills/audit-project/SKILL.md', needles: ['FindingProbeMatrixGate', 'GuardPolicyBypassMatrixGate', 'VerificationCommandSideEffectGate', 'PackageAdapterPreConfirmEvidenceGate'] },
      { file: 'skills/audit-document/SKILL.md', needles: ['SideEffectCompatibilityDocsGate', 'ExecutableExampleTruthProbeGate'] },
      { file: 'skills/audit-readme/SKILL.md', needles: ['SideEffectCompatibilityDocsGate', 'ExecutableExampleTruthProbeGate'] },
      { file: 'skills/audit-tech-design/SKILL.md', needles: ['PackageAdapterPreConfirmEvidenceGate'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['DatabaseRecordMigrationExportGate', 'data-security-automation', 'release-package-contract'] },
      { file: 'skills/report/SKILL.md', needles: ['LatestAbsorptionGuards', 'DatabaseRecordMigrationExportGate', 'PackageAdapterPreConfirmEvidenceGate'] },
      { file: 'prompts/requirement.prompt.md', needles: ['RequirementPreConfirmGate', 'MultiPhaseClosureGate', 'PackageAdapterPreConfirmEvidenceGate'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['LatestAbsorptionGuards', 'VisualDeviationTypeGate', 'PackageAdapterPreConfirmEvidenceGate'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['LatestAbsorptionGuards', 'VerificationCommandSideEffectGate', 'PackageAdapterPreConfirmEvidenceGate'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['LatestAbsorptionGuards', 'DatabaseRecordMigrationExportGate'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['LatestAbsorptionGuards', 'GovernanceGateRegistry'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['LatestAbsorptionGuards', 'RequirementPreConfirmGate'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['LatestAbsorptionGuards', 'FrontendBrowserVerificationBudgetGate'] },
      { file: 'README.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'V2FormalSolutionPackage'] },
      { file: 'website/docs/guide/development.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'V2FormalSolutionPackage'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', needles: ['V68', 'DatabaseRecordMigrationExportGate', 'RequirementPreConfirmGate'] },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: ['V68 探针', 'DatabaseRecordMigrationExportGate', 'PackageAdapterPreConfirmEvidenceGate'] },
      { file: 'changelogs/releases/v1.11.25.md', needles: ['V68', 'PI-071', 'PF-076', 'DatabaseRecordMigrationExportGate', 'PackageAdapterPreConfirmEvidenceGate'] },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV68', 'DatabaseRecordMigrationExportGate', 'PackageAdapterPreConfirmEvidenceGate'] },
      { file: 'scripts/validate.js', needles: ['V68 Latest data absorption', 'checkV68()'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V68] latest data absorption guards drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of gates.concat(['V68', 'PI-071', 'PF-076'])) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V68] latest data absorption changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V68] latest data absorption guards sync checked')
  }

  function checkV69() {
    const gates = [
      'RequirementVerdictStateSyncGate',
      'UserDocsImmediateComprehensionGate',
      'UserDocsPrimarySurfaceGate'
    ]

    const probes = [
      { file: 'instructions.md', needles: gates.concat(['targetSurface', 'documentLocation', 'primaryAudience=用户/使用者']) },
      { file: 'instructions/10-dev.instructions.md', needles: gates.concat(['首页首屏', '修复清单', 'SUMMARY']) },
      { file: 'instructions/11-fix.instructions.md', needles: gates.concat(['站点文档/README/接入手册不得把开发契约当用户主路径']) },
      { file: 'instructions/12-audit.instructions.md', needles: ['UserDocsImmediateComprehensionGate', 'UserDocsPrimarySurfaceGate', '首页首屏'] },
      { file: 'instructions/13-analyze.instructions.md', needles: ['GovernanceGateRegistryRef', 'gateGroup', 'validationRoute'] },
      { file: 'skills/dev-docs/SKILL.md', needles: gates.concat(['public docs site', 'requirement deliverable']) },
      { file: 'skills/readme-authoring/SKILL.md', needles: ['UserDocsPrimarySurfaceGate', 'UserDocsImmediateComprehensionGate', 'targetSurface'] },
      { file: 'skills/audit-document/SKILL.md', needles: ['UserDocsImmediateComprehensionGate', 'UserDocsPrimarySurfaceGate', '未发布 runtime'] },
      { file: 'skills/audit-readme/SKILL.md', needles: ['UserDocsPrimarySurfaceGate', 'UserDocsImmediateComprehensionGate', '开发契约'] },
      { file: 'skills/audit-requirements/SKILL.md', needles: ['RequirementVerdictStateSyncGate', 'UserDocsImmediateComprehensionGate', 'UserDocsPrimarySurfaceGate'] },
      { file: 'skills/document-sync/SKILL.md', needles: gates.concat(['sessions / SUMMARY']) },
      { file: 'skills/test-router/SKILL.md', needles: gates.concat(['用户文档主面', '需求复审状态同步']) },
      { file: 'skills/report/SKILL.md', needles: gates.concat(['LatestAbsorptionGuards']) },
      { file: 'skills/memory/SKILL.md', needles: ['RequirementVerdictStateSyncGate', 'sessions', 'SUMMARY'] },
      { file: 'prompts/requirement.prompt.md', needles: gates },
      { file: 'prompts/technical-design.prompt.md', needles: gates.concat(['首页首屏']) },
      { file: 'prompts/implementation-plan.prompt.md', needles: gates.concat(['targetSurface']) },
      { file: 'prompts/report-dev.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'UserDocsPrimarySurfaceGate'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'UserDocsPrimarySurfaceGate'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'UserDocsPrimarySurfaceGate'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'UserDocsPrimarySurfaceGate'] },
      { file: 'README.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'UserDocsPrimarySurfaceGate', '站点文档 / README / quick start'] },
      { file: 'website/docs/guide/development.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'UserDocsPrimarySurfaceGate', '首页首屏'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', needles: gates.concat(['V69']) },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: gates.concat(['V69 探针']) },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV69', 'UserDocsPrimarySurfaceGate', 'RequirementVerdictStateSyncGate'] },
      { file: 'scripts/validate.js', needles: ['V69 User docs primary surface', 'checkV69()'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V69] user docs primary surface / verdict-state sync drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of gates.concat(['V69', 'PI-072', 'PI-073', 'PI-074', 'PF-077', 'PF-078', 'PF-079', 'GR-015', 'GR-016'])) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V69] user docs primary surface changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V69] user docs primary surface / verdict-state sync checked')
  }

  function checkV70() {
    const gates = [
      'UserFacingDeliveryChainGate',
      'FinalUserManualFirstGate',
      'DocsSiteInformationArchitectureGate',
      'UserManualFlowAndFailureGate',
      'QueueDocsRealWorkflowGate',
      'ReviewChecklistCompletenessGate',
      'EvidenceExecutionGate',
      'BuiltArtifactFeatureSmokeGate',
      'TscOutputImportProbe',
      'GeneratedSiteGate',
      'ManualTocDuplicationGate',
      'UserPathContractSweep',
      'BenchmarkRegressionGuard'
    ]

    const probes = [
      { file: 'instructions.md', needles: gates.concat(['用户最终使用文档', 'TypeScript', 'benchmark regression']) },
      { file: 'instructions/10-dev.instructions.md', needles: ['UserFacingDeliveryChainGate', 'BuiltArtifactFeatureSmokeGate', 'BenchmarkRegressionGuard'] },
      { file: 'instructions/11-fix.instructions.md', needles: ['ReviewChecklistCompletenessGate', 'EvidenceExecutionGate', 'BuiltArtifactFeatureSmokeGate', 'TscOutputImportProbe', 'BenchmarkRegressionGuard'] },
      { file: 'instructions/12-audit.instructions.md', needles: ['ReviewChecklistCompletenessGate', 'EvidenceExecutionGate', 'GeneratedSiteGate', 'ManualTocDuplicationGate', 'UserPathContractSweep'] },
      { file: 'instructions/13-analyze.instructions.md', needles: ['GovernanceGateRegistryRef', 'gateGroup', 'validationRoute'] },
      { file: 'skills/test-router/SKILL.md', needles: gates.concat(['userFacingDeliveryChain', 'reviewChecklistEvidence', 'builtArtifactFeatureSmoke', 'generatedSiteVerification', 'userPathContractSweep', 'benchmarkRegression']) },
      { file: 'skills/dev-docs/SKILL.md', needles: ['UserFacingDeliveryChainGate', 'FinalUserManualFirstGate', 'GeneratedSiteGate', 'ManualTocDuplicationGate', 'UserPathContractSweep'] },
      { file: 'skills/readme-authoring/SKILL.md', needles: ['UserFacingDeliveryChainGate', 'FinalUserManualFirstGate', 'UserPathContractSweep', 'QueueDocsRealWorkflowGate'] },
      { file: 'skills/audit-document/SKILL.md', needles: ['FinalUserManualFirstGate', 'DocsSiteInformationArchitectureGate', 'UserManualFlowAndFailureGate', 'GeneratedSiteGate', 'ManualTocDuplicationGate', 'UserPathContractSweep'] },
      { file: 'skills/audit-readme/SKILL.md', needles: ['FinalUserManualFirstGate', 'DocsSiteInformationArchitectureGate', 'UserManualFlowAndFailureGate', 'QueueDocsRealWorkflowGate', 'UserPathContractSweep'] },
      { file: 'skills/document-sync/SKILL.md', needles: gates.concat(['不能只按审查报告文本验收']) },
      { file: 'skills/report/SKILL.md', needles: gates.concat(['LatestAbsorptionGuards']) },
      { file: 'prompts/technical-design.prompt.md', needles: ['userFacingDeliveryChain', 'reviewChecklistEvidence', 'builtArtifactFeatureSmoke', 'generatedSiteVerification', 'userPathContractSweep', 'benchmarkRegression'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'GeneratedSiteGate', 'BenchmarkRegressionGuard'] },
      { file: 'prompts/requirement.prompt.md', needles: ['UserFacingDeliveryChainGate', 'ReviewChecklistCompletenessGate', 'GeneratedSiteGate', 'BenchmarkRegressionGuard'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['UserFacingDeliveryChainGate', 'BuiltArtifactFeatureSmokeGate', 'BenchmarkRegressionGuard'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'BenchmarkRegressionGuard'] },
      { file: 'prompts/report-audit.prompt.md', needles: gates },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'BenchmarkRegressionGuard'] },
      { file: 'README.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'BenchmarkRegressionGuard', '部署副本'] },
      { file: 'website/docs/guide/development.md', needles: ['GovernanceGateRegistry', 'gateGroup', 'BenchmarkRegressionGuard', '部署副本'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', needles: gates.concat(['V70']) },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: gates.concat(['V70 探针']) },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV70', 'UserFacingDeliveryChainGate', 'BenchmarkRegressionGuard'] },
      { file: 'scripts/validate.js', needles: ['V70 User-facing delivery chain', 'checkV70()'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V70] user-facing delivery / evidence execution drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    const ids = [
      'V70',
      'PI-075',
      'PI-076',
      'PI-077',
      'PI-078',
      'PF-080',
      'PF-081',
      'PF-082',
      'PF-083',
      'GR-017',
      'GR-018',
      'GAP-030',
      'GAP-031',
      'GAP-032',
      'GAP-033',
      'GAP-034',
      'GAP-035',
      'GAP-036',
      'PI-019',
      'PF-002'
    ]
    for (const needle of gates.concat(ids)) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V70] latest data absorption changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V70] user-facing delivery / evidence execution guards sync checked')
  }

  function checkV71() {
    const gates = [
      'SkillFirstAbsorptionGate',
      'CapabilityToSkillPromotionGate',
      'SkillAbsorptionDecision'
    ]

    const probes = [
      { file: 'instructions.md', needles: gates.concat(['new-skill-required', 'existing-skill-subgate', 'global-invariant']) },
      { file: 'instructions/10-dev.instructions.md', needles: gates.concat(['new-skill-required']) },
      { file: 'skills/spec-governance/SKILL.md', needles: gates.concat(['global-invariant', 'existing-skill-subgate', 'new-skill-required', 'docs-only']) },
      { file: 'skills/user-manual-authoring/SKILL.md', needles: ['name: user-manual-authoring', 'UserFacingDeliveryChainGate', 'FinalUserManualFirstGate', 'UserPathContractSweep'] },
      { file: 'skills/review-checklist/SKILL.md', needles: ['name: review-checklist', 'ReviewChecklistPrecreationGate', 'EvidenceExecutionGate', 'ChecklistStateFreshnessGate'] },
      { file: 'plugin.json', needles: ['user-manual-authoring', 'skills/user-manual-authoring/SKILL.md', 'review-checklist', 'skills/review-checklist/SKILL.md'] },
      { file: 'skills/dev-default/SKILL.md', needles: gates.concat(['AbsorptionDecision']) },
      { file: 'skills/dev-docs/SKILL.md', needles: ['user-manual-authoring', '最终用户使用文档'] },
      { file: 'skills/readme-authoring/SKILL.md', needles: ['user-manual-authoring', 'README 专项分支'] },
      { file: 'skills/audit-readme/SKILL.md', needles: ['user-manual-authoring', '最终用户使用文档'] },
      { file: 'skills/routing/SKILL.md', needles: ['user-manual-authoring', 'review-checklist'] },
      { file: 'skills/test-router/SKILL.md', needles: ['SkillFirstAbsorptionGate', 'SkillAbsorptionDecision', 'user-manual-authoring', 'review-checklist'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['SkillFirstAbsorptionGate', 'user-manual-authoring', 'review-checklist'] },
      { file: 'skills/report/SKILL.md', needles: gates },
      { file: 'skills/audit-common/SKILL.md', needles: ['review-checklist', 'ChecklistStateFreshnessGate'] },
      { file: 'skills/audit-execution-guide/SKILL.md', needles: ['review-checklist', 'ReviewChecklistPrecreationGate'] },
      { file: 'skills/audit-release/SKILL.md', needles: ['review-checklist', 'RL-1~RL-10'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['SkillAbsorptionDecision', 'user-manual-authoring', 'review-checklist'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: gates.concat(['user-manual-authoring', 'review-checklist']) },
      { file: 'prompts/report-dev.prompt.md', needles: ['SkillFirstAbsorptionGate'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['SkillFirstAbsorptionGate'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['SkillFirstAbsorptionGate'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['SkillFirstAbsorptionGate'] },
      { file: 'README.md', needles: ['Skill-first 吸纳架构', 'user-manual-authoring', 'review-checklist'] },
      { file: 'website/docs/guide/development.md', needles: ['Skill-first 吸纳架构', 'user-manual-authoring', 'review-checklist'] },
      { file: 'website/docs/index.md', needles: ['68 个 Skills'] },
      { file: 'website/docs/intro/index.md', needles: ['68 个按需触发的工作流技能', 'user-manual-authoring', 'review-checklist'] },
      { file: 'website/docs/specs/directory-structure.md', needles: ['扁平一级 Skill（68 个）', 'user-manual-authoring', 'review-checklist'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', needles: gates.concat(['V71', 'user-manual-authoring', 'review-checklist']) },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: ['V71 探针', 'SkillFirstAbsorptionGate', 'user-manual-authoring', 'review-checklist'] },
      { file: 'changelogs/releases/v1.11.27.md', needles: gates.concat(['V71', 'PI-079', 'PI-080', 'PI-081', 'PF-084', 'PF-085', 'PF-086', 'user-manual-authoring', 'review-checklist']) },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV71', 'SkillFirstAbsorptionGate', 'user-manual-authoring', 'review-checklist'] },
      { file: 'scripts/validate.js', needles: ['V71 Skill-first absorption', 'checkV71()'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V71] skill-first absorption architecture drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of gates.concat(['V71', 'PI-079', 'PI-080', 'PI-081', 'PF-084', 'PF-085', 'PF-086', 'user-manual-authoring', 'review-checklist'])) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V71] skill-first absorption changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V71] skill-first absorption architecture sync checked')
  }

  function checkV72() {
    const gates = [
      'LayeredAbsorptionGate',
      'LayeredAbsorptionDecision',
      'ProactiveBetterAlternativeGate'
    ]
    const layerTerms = [
      'commonInstruction',
      'skill',
      'promptTemplate',
      'executionConsumer',
      'validationProbe',
      'publicDocs',
      'deployCopy'
    ]

    const probes = [
      { file: 'instructions.md', needles: gates.concat(layerTerms).concat(['SkillAbsorptionDecision']) },
      { file: 'instructions/10-dev.instructions.md', needles: gates.concat(layerTerms).concat(['SkillFirstAbsorptionGate']) },
      { file: 'skills/spec-governance/SKILL.md', needles: gates.concat(layerTerms).concat(['skipReason']) },
      { file: 'skills/dev-default/SKILL.md', needles: gates.concat(layerTerms).concat(['SkillAbsorptionDecision']) },
      { file: 'skills/test-router/SKILL.md', needles: gates.concat(['layeredAbsorption', 'proactiveBetterAlternative', 'publicDocs', 'deployCopy']) },
      { file: 'skills/report/SKILL.md', needles: gates.concat(layerTerms).concat(['SkillAbsorptionDecision']) },
      { file: 'skills/document-sync/SKILL.md', needles: gates.concat(['prompts/templates', 'targeted tests', '部署副本']) },
      { file: 'prompts/technical-design.prompt.md', needles: gates.concat(layerTerms).concat(['SkillAbsorptionDecision']) },
      { file: 'prompts/implementation-plan.prompt.md', needles: gates.concat(layerTerms) },
      { file: 'prompts/report-dev.prompt.md', needles: gates.concat(['LayeredAbsorptionDecision']) },
      { file: 'prompts/report-fix.prompt.md', needles: gates.concat(['LayeredAbsorptionDecision']) },
      { file: 'prompts/report-audit.prompt.md', needles: gates.concat(['LayeredAbsorptionDecision']) },
      { file: 'prompts/report-scenario-test.prompt.md', needles: gates.concat(['LayeredAbsorptionDecision']) },
      { file: 'README.md', needles: gates.concat(['分层吸纳架构']) },
      { file: 'website/docs/guide/development.md', needles: gates.concat(['分层吸纳架构', 'prompts/templates']) },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', needles: gates.concat(['V72', 'layerChecks']) },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: gates.concat(['V72 探针']) },
      { file: 'changelogs/releases/v1.11.27.md', needles: gates.concat(['V72', 'PI-082', 'PI-083', 'PF-087', 'PF-088']) },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV72', 'LayeredAbsorptionGate', 'ProactiveBetterAlternativeGate'] },
      { file: 'scripts/validate.js', needles: ['V72 Layered absorption', 'checkV72()'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V72] layered absorption architecture drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of gates.concat(['V72', 'PI-082', 'PI-083', 'PF-087', 'PF-088'])) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V72] layered absorption changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V72] layered absorption and proactive alternative sync checked')
  }

  function checkV73() {
    const gates = [
      'ConfirmedAbsorptionCompletenessGates',
      'PublicSurfaceClosureGate',
      'UserManualProductizationGate',
      'UserManualRenderedFlowAndRealWorkflowProbe',
      'SampleIssueExpansionGate',
      'RequirementDimensionBindingGate',
      'RequirementPriorityAndPhaseGate',
      'ReviewAnchorMaterializationGate',
      'SemanticLegacyRouteExposureGate',
      'ReferenceCodeTruthSamplingGate',
      'FrontendAsyncCacheRenderGate',
      'StaleWhileRevalidateGate',
      'PortableExternalArtifactGate',
      'StrongestProfileSourceGate',
      'ServiceSpecificResidueSweep',
      'ProfileReadChainGate',
      'ServiceNormCoverageGate',
      'RouteNamespaceResponsibilityGate',
      'RemoteCIParityPushGate',
      'OfficialApiEvidenceGate',
      'AsyncDbTruthSourceVerificationGate',
      'DocsPageRoleMatrixGate',
      'CompleteUserManualSiteMatrixGate',
      'EvolutionCapabilityControlPlaneGate',
      'FrameworkCapabilityAutoFirstGate',
      'DocsThemeRuntimeVisualProbeGate'
    ]

    const probes = [
      { file: 'instructions.md', needles: gates.concat(['evolution-governance']) },
      { file: 'skills/spec-governance/SKILL.md', needles: gates.concat(['evolution-governance']) },
      { file: 'skills/evolution-governance/SKILL.md', needles: ['name: evolution-governance', 'EvolutionCapabilityControlPlaneGate', 'candidate-only', 'modelProviderConfig', 'releaseApproval'] },
      { file: 'plugin.json', needles: ['evolution-governance', 'skills/evolution-governance/SKILL.md'] },
      { file: 'skills/routing/SKILL.md', needles: ['evolution-governance', 'EvolutionCapabilityControlPlaneGate'] },
      { file: 'skills/dev-default/SKILL.md', needles: ['ConfirmedAbsorptionCompletenessGates', 'EvolutionCapabilityControlPlaneGate', 'FrontendAsyncCacheRenderGate', 'RemoteCIParityPushGate'] },
      { file: 'skills/user-manual-authoring/SKILL.md', needles: ['UserManualProductizationGate', 'UserManualRenderedFlowAndRealWorkflowProbe', 'DocsPageRoleMatrixGate', 'DocsThemeRuntimeVisualProbeGate'] },
      { file: 'skills/review-checklist/SKILL.md', needles: ['SampleIssueExpansionGate', 'ReviewAnchorMaterializationGate', 'RequirementDimensionBindingGate'] },
      { file: 'skills/audit-requirements/SKILL.md', needles: ['SampleIssueExpansionGate', 'RequirementDimensionBindingGate', 'RequirementPriorityAndPhaseGate'] },
      { file: 'skills/audit-tech-design/SKILL.md', needles: ['ReviewAnchorMaterializationGate', 'OfficialApiEvidenceGate', 'FrameworkCapabilityAutoFirstGate'] },
      { file: 'skills/audit-project/SKILL.md', needles: ['SemanticLegacyRouteExposureGate', 'ReferenceCodeTruthSamplingGate', 'FrontendAsyncCacheRenderGate', 'PortableExternalArtifactGate'] },
      { file: 'skills/audit-release/SKILL.md', needles: ['PublicSurfaceClosureGate', 'RemoteCIParityPushGate'] },
      { file: 'skills/release-verification/SKILL.md', needles: ['PublicSurfaceClosureGate', 'RemoteCIParityPushGate'] },
      { file: 'skills/load-profile/SKILL.md', needles: ['ProfileReadChainGate', 'ServiceNormCoverageGate', 'StrongestProfileSourceGate'] },
      { file: 'skills/profile-bootstrap/SKILL.md', needles: ['ProfileReadChainGate', 'ServiceNormCoverageGate', 'ServiceSpecificResidueSweep'] },
      { file: 'skills/api-verification/SKILL.md', needles: ['OfficialApiEvidenceGate', 'AsyncDbTruthSourceVerificationGate', 'StaleWhileRevalidateGate'] },
      { file: 'skills/dev-docs/SKILL.md', needles: ['UserManualProductizationGate', 'UserManualRenderedFlowAndRealWorkflowProbe', 'CompleteUserManualSiteMatrixGate', 'DocsThemeRuntimeVisualProbeGate'] },
      { file: 'skills/audit-document/SKILL.md', needles: ['UserManualProductizationGate', 'UserManualRenderedFlowAndRealWorkflowProbe', 'DocsThemeRuntimeVisualProbeGate'] },
      { file: 'skills/audit-readme/SKILL.md', needles: ['UserManualProductizationGate', 'DocsPageRoleMatrixGate', 'DocsThemeRuntimeVisualProbeGate'] },
      { file: 'skills/dev-plan-review/SKILL.md', needles: ['RequirementDimensionBindingGate', 'OfficialApiEvidenceGate', 'EvolutionCapabilityControlPlaneGate'] },
      { file: 'skills/test-router/SKILL.md', needles: ['ConfirmedAbsorptionCompletenessGates', 'FrontendAsyncCacheRenderGate', 'RemoteCIParityPushGate', 'EvolutionCapabilityControlPlaneGate'] },
      { file: 'skills/report/SKILL.md', needles: ['ConfirmedAbsorptionCompletenessGates', 'public-surface', 'user-manual', 'review-checklist', 'frontend-runtime', 'profile-service', 'evolution-control-plane', 'PublicSurfaceClosureGate', 'DocsThemeRuntimeVisualProbeGate'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['ConfirmedAbsorptionCompletenessGates', 'public-surface', 'user-manual', 'review-checklist', 'frontend-runtime', 'profile-service', 'evolution-control-plane', 'PublicSurfaceClosureGate', 'DocsThemeRuntimeVisualProbeGate'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['ConfirmedAbsorptionCompletenessGates', 'public-surface', 'user-manual', 'review-checklist', 'frontend-runtime', 'profile-service', 'evolution-control-plane', 'PublicSurfaceClosureGate', 'DocsThemeRuntimeVisualProbeGate'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['ConfirmedAbsorptionCompletenessGates', 'public-surface', 'user-manual', 'review-checklist', 'frontend-runtime', 'profile-service', 'evolution-control-plane', 'PublicSurfaceClosureGate', 'DocsThemeRuntimeVisualProbeGate'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['ConfirmedAbsorptionCompletenessGates', 'PublicSurfaceClosureGate', 'DocsThemeRuntimeVisualProbeGate'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['ConfirmedAbsorptionCompletenessGates', 'FrontendAsyncCacheRenderGate', 'RemoteCIParityPushGate'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['ConfirmedAbsorptionCompletenessGates', 'GovernanceGateRegistry', 'evolution-control-plane'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['ConfirmedAbsorptionCompletenessGates', 'GovernanceGateRegistry', 'frontend-runtime'] },
      { file: 'README.md', needles: ['ConfirmedAbsorptionCompletenessGates', 'evolution-governance', '68 个'] },
      { file: 'website/docs/index.md', needles: ['68 个 Skills'] },
      { file: 'website/docs/intro/index.md', needles: ['68 个按需触发的工作流技能', 'evolution-governance'] },
      { file: 'website/docs/specs/directory-structure.md', needles: ['扁平一级 Skill（68 个）', 'evolution-governance'] },
      { file: 'website/docs/guide/development.md', needles: ['ConfirmedAbsorptionCompletenessGates', 'evolution-governance'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', needles: gates.concat(['V73', 'evolution-governance']) },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: ['V73 探针', 'ConfirmedAbsorptionCompletenessGates', 'evolution-governance'] },
      { file: 'changelogs/releases/v1.11.27.md', needles: gates.concat(['V73', 'evolution-governance']) },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV73', 'ConfirmedAbsorptionCompletenessGates', 'evolution-governance'] },
      { file: 'scripts/validate.js', needles: ['V73 confirmed absorption completeness', 'checkV73()'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V73] confirmed absorption completeness drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of gates.concat(['V73', 'evolution-governance'])) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V73] confirmed absorption changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V73] confirmed absorption completeness and evolution governance sync checked')
  }

  function checkV74() {
    const gate = 'HistoricalCommonNormLayeringGate'
    const coreTerms = [gate, '逐文件审查矩阵', 'legacy-index-retained']

    const probes = [
      { file: 'instructions.md', needles: coreTerms.concat(['targetLayer']) },
      { file: 'instructions/10-dev.instructions.md', needles: [gate, 'LayeredAbsorptionDecision', '逐文件审查矩阵'] },
      { file: 'skills/spec-governance/SKILL.md', needles: coreTerms.concat(['currentRole', 'matchedRules', 'targetOwner', 'semanticStrength']) },
      { file: 'skills/test-router/SKILL.md', needles: [gate, 'historicalCommonNormLayering', 'V74', 'ProfileImpactCheck'] },
      { file: 'skills/report/SKILL.md', needles: coreTerms.concat(['V74', 'deploy copy']) },
      { file: 'skills/document-sync/SKILL.md', needles: coreTerms.concat(['active version requirements']) },
      { file: 'skills/source-consumer-sync/SKILL.md', needles: [gate, 'V74 历史通用规范分层同步面', 'historicalMirrors', 'checkV74'] },
      { file: 'prompts/technical-design.prompt.md', needles: [gate, '逐文件审查矩阵', 'Prompt 只写字段和引用'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: [gate, '逐文件审查矩阵', 'Prompt/Report 只保留字段'] },
      { file: 'prompts/report-dev.prompt.md', needles: [gate, 'legacy-index-retained', 'V74'] },
      { file: 'prompts/report-fix.prompt.md', needles: [gate, 'legacy-index-retained', 'V74'] },
      { file: 'prompts/report-audit.prompt.md', needles: [gate, 'legacy-index-retained', 'V74'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: [gate, 'legacy-index-retained', 'V74'] },
      { file: 'README.md', needles: [gate, '历史通用规范分层迁移', 'V74'] },
      { file: 'website/docs/guide/development.md', needles: [gate, '历史通用规范分层迁移', 'V74'] },
      { file: 'website/docs/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/index.md', needles: [gate, 'V74', '逐文件审查矩阵'] },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: ['V74 探针', gate] },
      { file: 'changelogs/releases/v1.11.27.md', needles: [gate, 'V74', '历史通用规范分层迁移'] },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV74', gate] },
      { file: 'scripts/validate.js', needles: ['V74 historical common norm layering', 'checkV74()'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V74] historical common norm layering drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    for (const needle of [gate, 'V74', '历史通用规范分层迁移']) {
      if (!hasChangelogEvidence(needle)) {
        err(`[V74] historical common norm layering changelog drift: missing "${needle}" in changelogs/unreleased.md or changelogs/releases/*.md`)
      }
    }

    console.log('[V74] historical common norm layering sync checked')
  }

  function checkV75() {
    const probeName = 'PromptLongGateListDriftProbe'
    const consumerFiles = [
      'README.md',
      'website/docs/guide/development.md',
      'instructions/10-dev.instructions.md',
      'instructions/11-fix.instructions.md',
      'instructions/12-audit.instructions.md',
      'instructions/13-analyze.instructions.md',
      'prompts/technical-design.prompt.md',
      'prompts/implementation-plan.prompt.md',
      'prompts/report-dev.prompt.md',
      'prompts/report-fix.prompt.md',
      'prompts/report-audit.prompt.md',
      'prompts/report-scenario-test.prompt.md'
    ]

    const driftClusters = [
      {
        label: 'cross-project learned guards long list',
        minHits: 8,
        needles: [
          'CodeTruthRequirementGate',
          'AdapterBenchmarkAttribution',
          'ProductRequirementTraceabilityGate',
          'WorkspaceDataAbsorptionScopeGate',
          'DatabaseRecordMigrationExportGate',
          'GeneratedSiteGate',
          'ArtifactLinkSetDedupeGate',
          'BenchmarkRegressionGuard',
          'V2FormalSolutionPackage'
        ]
      },
      {
        label: 'confirmed absorption full gate list',
        minHits: 8,
        needles: [
          'PublicSurfaceClosureGate',
          'UserManualRenderedFlowAndRealWorkflowProbe',
          'SampleIssueExpansionGate',
          'RequirementDimensionBindingGate',
          'SemanticLegacyRouteExposureGate',
          'ReferenceCodeTruthSamplingGate',
          'FrontendAsyncCacheRenderGate',
          'StrongestProfileSourceGate',
          'RouteNamespaceResponsibilityGate',
          'DocsThemeRuntimeVisualProbeGate'
        ]
      },
      {
        label: 'latest absorption full gate list',
        minHits: 10,
        needles: [
          'DatabaseRecordMigrationExportGate',
          'FrontendBrowserVerificationBudgetGate',
          'UserSelfVerificationOverrideGate',
          'FindingProbeMatrixGate',
          'MultiPhaseClosureGate',
          'GuardPolicyBypassMatrixGate',
          'SideEffectCompatibilityDocsGate',
          'ExecutableExampleTruthProbeGate',
          'VisualDeviationTypeGate',
          'OneOffRequirementScriptPlacementGate',
          'VerificationCommandSideEffectGate',
          'DesignFramePurposeClassificationGate',
          'RequirementPreConfirmGate',
          'PackageAdapterPreConfirmEvidenceGate'
        ]
      }
    ]

    function findDrift(line) {
      for (const cluster of driftClusters) {
        const hits = cluster.needles.filter(needle => line.includes(needle))
        if (hits.length >= cluster.minHits) return { cluster, hits }
      }
      return null
    }

    const negativeSamples = [
      driftClusters[0].needles.join('、'),
      driftClusters[1].needles.join('、'),
      driftClusters[2].needles.join('、')
    ]
    for (const sample of negativeSamples) {
      if (!findDrift(sample)) {
        err(`[V75] ${probeName} negative sample did not trigger drift detection`)
      }
    }
    const groupedSample = '按 GovernanceGateRegistry 分组记录 gateGroup / ownerSkill / validationRoute / skipReason，代表锚点包括 PublicSurfaceClosureGate、UserManualProductizationGate、ReviewAnchorMaterializationGate、FrontendAsyncCacheRenderGate、RemoteCIParityPushGate 与 DocsThemeRuntimeVisualProbeGate'
    if (findDrift(groupedSample)) {
      err(`[V75] ${probeName} incorrectly rejects grouped registry summary`)
    }

    for (const file of consumerFiles) {
      const lines = read(path.join(ROOT, file)).split(/\r?\n/)
      lines.forEach((line, index) => {
        const drift = findDrift(line)
        if (drift) {
          err(`[V75] ${probeName} detected ${drift.cluster.label} drift in ${file}:${index + 1} (${drift.hits.length} hits); use GovernanceGateRegistry/gateGroup instead`)
        }
      })
    }

    const probes = [
      { file: 'skills/spec-governance/SKILL.md', needles: [probeName, 'SCV 负向样例', 'GovernanceGateRegistry'] },
      { file: 'skills/source-consumer-sync/SKILL.md', needles: [probeName, 'V75', 'currentConsumers'] },
      { file: 'README.md', needles: [probeName, 'GovernanceGateRegistry'] },
      { file: 'website/docs/guide/development.md', needles: [probeName, 'GovernanceGateRegistry'] },
      { file: 'changelogs/releases/v1.11.28.md', needles: ['V75', probeName] },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV75', probeName] },
      { file: 'scripts/validate.js', needles: ['V75 prompt long gate list drift', 'checkV75()'] }
    ]
    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V75] ${probeName} sync drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    console.log('[V75] prompt long gate list drift probe checked')
  }

  function checkV76() {
    const gate = 'ReviewEscapeRecordGate'
    const recordFields = [
      'escapedItem',
      'whyMissed',
      'missingDimensionOrProbe',
      'prevention',
      'checklistPatch',
      'rerunEvidence'
    ]
    const probes = [
      { file: 'skills/review-checklist/SKILL.md', needles: [gate, 'escapeRecords'].concat(recordFields).concat(['ledgerRoute']) },
      { file: 'skills/spec-governance/SKILL.md', needles: [gate, 'review-escape'].concat(recordFields) },
      { file: 'skills/test-router/SKILL.md', needles: [gate, 'whyMissed', 'prevention', 'rerunEvidence'] },
      { file: 'skills/report/SKILL.md', needles: [gate, 'whyMissed', 'prevention', 'checklistPatch', 'rerunEvidence'] },
      { file: 'prompts/technical-design.prompt.md', needles: [gate, 'whyMissed', 'rerunEvidence'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: [gate, 'whyMissed', 'rerunEvidence'] },
      { file: 'prompts/report-dev.prompt.md', needles: [gate, 'whyMissed', 'rerunEvidence'] },
      { file: 'prompts/report-fix.prompt.md', needles: [gate, 'whyMissed', 'rerunEvidence'] },
      { file: 'prompts/report-audit.prompt.md', needles: [gate, 'whyMissed', 'rerunEvidence'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: [gate, 'escapedItem', 'rerunEvidence'] },
      { file: 'README.md', needles: [gate, 'whyMissed', 'rerunEvidence'] },
      { file: 'website/docs/guide/development.md', needles: [gate, 'whyMissed', 'rerunEvidence'] },
      { file: 'changelogs/releases/v1.11.28.md', needles: ['V76', gate, 'whyMissed'] },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV76', gate] },
      { file: 'scripts/validate.js', needles: ['V76 review escape record', 'checkV76()'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V76] review escape record drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    console.log('[V76] review escape record gate sync checked')
  }

  function checkV77() {
    const gate = 'NativeCommandExitCodeGate'

    function hasExitCodePropagation(script) {
      return [
        /\$LASTEXITCODE\b/,
        /\bprocess\.exit\s*\(/,
        /\bprocess\.exitCode\b/,
        /\bset\s+-e\b/,
        /\bpipefail\b/,
        /\|\|\s*exit\b/,
        /\bif\s*\[\s*\$[?]\s*-ne\s*0\s*\]/,
        /\bif\s*\(\s*\$LASTEXITCODE\s+-ne\s+0\s*\)/
      ].some(pattern => pattern.test(script))
    }

    function isFalseGreenNativeCommand(script) {
      return /\b(npm|git|node|curl)\b/.test(script) &&
        /\b(OK|success|passed)\b/i.test(script) &&
        !hasExitCodePropagation(script)
    }

    const negativeSamples = [
      'npm install ../pkg.tgz; Write-Host "OK"',
      'git push origin main; echo success'
    ]
    for (const sample of negativeSamples) {
      if (!isFalseGreenNativeCommand(sample)) {
        err(`[V77] ${gate} negative sample did not detect false-green native command: ${sample}`)
      }
    }

    const positiveSamples = [
      'npm install ../pkg.tgz; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; Write-Host "OK"',
      'set -euo pipefail; git push origin main; echo success'
    ]
    for (const sample of positiveSamples) {
      if (isFalseGreenNativeCommand(sample)) {
        err(`[V77] ${gate} incorrectly rejected exit-code guarded command: ${sample}`)
      }
    }

    const probes = [
      { file: 'skills/release-verification/SKILL.md', needles: [gate, 'command、shell、cwd、exitCode', '$LASTEXITCODE', 'auth/config 来源'] },
      { file: 'skills/audit-release/SKILL.md', needles: [gate, 'command/shell/cwd/exitCode'] },
      { file: 'skills/test-router/SKILL.md', needles: [gate, 'nativeCommandExitCode', 'command、shell、cwd、exitCode'] },
      { file: 'skills/report/SKILL.md', needles: [gate, 'command、shell、cwd、exitCode'] },
      { file: 'skills/spec-governance/SKILL.md', needles: [gate, '原生命令真实 exitCode'] },
      { file: 'skills/document-sync/SKILL.md', needles: [gate] },
      { file: 'prompts/technical-design.prompt.md', needles: [gate, '退出码证据设计'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: [gate, '真实 exitCode'] },
      { file: 'prompts/report-dev.prompt.md', needles: [gate, 'command/shell/cwd/exitCode'] },
      { file: 'prompts/report-fix.prompt.md', needles: [gate, 'command/shell/cwd/exitCode'] },
      { file: 'prompts/report-audit.prompt.md', needles: [gate, 'failed evidence exclusion'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: [gate] },
      { file: 'README.md', needles: [gate, '真实 command/shell/cwd/exitCode'] },
      { file: 'website/docs/guide/development.md', needles: [gate, '真实 command/shell/cwd/exitCode'] },
      { file: 'changelogs/releases/v1.11.28.md', needles: ['V77', gate, 'exitCode'] },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV77', gate] },
      { file: 'scripts/validate.js', needles: ['V77 native command exit code', 'checkV77()'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V77] native command exit-code drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    console.log('[V77] native command exit-code gate sync checked')
  }

  function checkV78() {
    const gates = [
      'PostConfirmationReviewScopeGate',
      'DevelopmentDriftGate',
      'VerificationPlanMaterializationProbe',
      'AcceptedSuggestionRootCauseGate',
      'ChinesePrimaryExpressionGate',
      'SidebarPageRoleMaterializationProbe',
      'SidebarGroupSemanticModelProbe'
    ]

    const probes = [
      { file: 'instructions/01-common.instructions.md', needles: ['PostConfirmationReviewScopeGate', '轻量', '全面复审'] },
      { file: 'skills/cp-gate/SKILL.md', needles: ['PostConfirmationReviewScopeGate', 'PR-2~PR-7', 'review-checklist'] },
      { file: 'skills/review-checklist/SKILL.md', needles: ['PostConfirmationReviewScopeGate', '高风险', 'skipReason'] },
      { file: 'skills/dev-default/SKILL.md', needles: ['DevelopmentDriftGate', 'allowedFirstBatch', 'blockedScope', 'driftTriggers'] },
      { file: 'skills/execution-contract/SKILL.md', needles: ['DevelopmentDriftGate', 'allowedFirstBatch', 'blockedScope', 'driftTriggers'] },
      { file: 'skills/dev-plan-review/SKILL.md', needles: ['VerificationPlanMaterializationProbe', 'SidebarPageRoleMaterializationProbe', 'SidebarGroupSemanticModelProbe'] },
      { file: 'skills/dev-docs/SKILL.md', needles: ['ChinesePrimaryExpressionGate', 'SidebarPageRoleMaterializationProbe', 'SidebarGroupSemanticModelProbe'] },
      { file: 'skills/user-manual-authoring/SKILL.md', needles: ['ChinesePrimaryExpressionGate', 'SidebarPageRoleMaterializationProbe', 'SidebarGroupSemanticModelProbe', 'sidebarSemanticModel'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['ChinesePrimaryExpressionGate', 'SidebarPageRoleMaterializationProbe', 'SidebarGroupSemanticModelProbe'] },
      { file: 'skills/spec-governance/SKILL.md', needles: ['post-confirmation-review', 'development-drift', 'docs-ia-readability', 'AcceptedSuggestionRootCauseGate'] },
      { file: 'skills/test-router/SKILL.md', needles: ['postConfirmationReviewScope', 'developmentDrift', 'verificationPlanMaterialization', 'docsIaReadability'] },
      { file: 'skills/report/SKILL.md', needles: ['AcceptedSuggestionRootCauseGate', 'PostConfirmationReviewScopeGate', 'DevelopmentDriftGate', 'VerificationPlanMaterializationProbe'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['DevelopmentDriftGate', 'VerificationPlanMaterializationProbe', 'SidebarPageRoleMaterializationProbe'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['PostConfirmationReviewScopeGate', 'DevelopmentDriftGate', 'ChinesePrimaryExpressionGate'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['AcceptedSuggestionRootCauseGate', 'PostConfirmationReviewScopeGate', 'VerificationPlanMaterializationProbe'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['AcceptedSuggestionRootCauseGate', 'PostConfirmationReviewScopeGate', 'VerificationPlanMaterializationProbe'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['AcceptedSuggestionRootCauseGate', 'DevelopmentDriftGate', 'SidebarGroupSemanticModelProbe'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['AcceptedSuggestionRootCauseGate', 'DevelopmentDriftGate', 'SidebarGroupSemanticModelProbe'] },
      { file: 'README.md', needles: ['AcceptedSuggestionRootCauseGate', 'PostConfirmationReviewScopeGate', 'DevelopmentDriftGate', 'ChinesePrimaryExpressionGate'] },
      { file: 'website/docs/guide/development.md', needles: ['AcceptedSuggestionRootCauseGate', 'PostConfirmationReviewScopeGate', 'DevelopmentDriftGate', 'ChinesePrimaryExpressionGate'] },
      { file: 'changelogs/releases/v1.11.28.md', needles: ['V78'].concat(gates) },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV78'].concat(gates) },
      { file: 'scripts/validate.js', needles: ['V78 review scope drift docs IA', 'checkV78()'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V78] review scope / drift / docs IA sync in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    console.log('[V78] review scope, development drift and docs IA gates checked')
  }

  function checkV79() {
    const gates = [
      'CoverageGateDecision',
      'ExternalRuntimePluginLifecycleGate',
      'ExternalRegistryLifecycleMatrixGate',
      'FunctionSourceFingerprintMatrixGate',
      'ClusterEscalationGate',
      'RiskBasedValidationLadder'
    ]

    const changelogFiles = ['changelogs/unreleased.md']
    const releasesDir = path.join(ROOT, 'changelogs', 'releases')
    if (fs.existsSync(releasesDir)) {
      for (const name of fs.readdirSync(releasesDir)) {
        if (/^v\d+\.\d+\.\d+\.md$/.test(name)) changelogFiles.push(`changelogs/releases/${name}`)
      }
    }
    const changelogCorpus = changelogFiles
      .map(file => read(path.join(ROOT, file)))
      .join('\n')

    const probes = [
      { file: 'skills/test-router/SKILL.md', needles: ['coverageGateDecision', 'externalRuntimePluginLifecycle', 'functionSourceFingerprint', 'riskBasedValidationLadder'].concat(gates) },
      { file: 'skills/dev-testing/SKILL.md', needles: ['覆盖率门禁与风险分层验证', '外部 runtime / plugin / registry 注入验证矩阵'].concat(gates) },
      { file: 'skills/audit-project/SKILL.md', needles: ['PE-6 测试覆盖与验证门禁'].concat(gates) },
      { file: 'skills/dev-plan-review/SKILL.md', needles: ['PR-2 项目存在 coverage', '函数源码 fingerprint 风险是否覆盖'].concat(gates) },
      { file: 'skills/report/SKILL.md', needles: ['CoverageGateDecision / ExternalRuntimePluginLifecycleGate', 'targeted/related/full gate'].concat(gates) },
      { file: 'instructions/10-dev.instructions.md', needles: ['CoverageGateDecision / ExternalRuntimePluginLifecycleGate', 'FunctionSourceFingerprintMatrixGate'] },
      { file: 'instructions/11-fix.instructions.md', needles: ['CoverageGateDecision / ClusterEscalationGate', 'ExternalRuntimePluginLifecycleGate / FunctionSourceFingerprintMatrixGate'] },
      { file: 'instructions/12-audit.instructions.md', needles: ['CoverageGateDecision', 'FunctionSourceFingerprintMatrixGate'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['CoverageGateDecision / RiskBasedValidationLadder', 'ExternalRuntimePluginLifecycleGate / ExternalRegistryLifecycleMatrixGate'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['CoverageGateDecision / RiskBasedValidationLadder', 'FunctionSourceFingerprintMatrixGate / ClusterEscalationGate'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['CoverageGateDecision / RiskBasedValidationLadder', 'ExternalRuntimePluginLifecycleGate / ExternalRegistryLifecycleMatrixGate'] },
      { file: 'README.md', needles: ['coverage 与外部 runtime 生命周期验证'].concat(gates) },
      { file: 'website/docs/guide/development.md', needles: ['存在 coverage 阈值'].concat(gates) },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV79'].concat(gates) },
      { file: 'scripts/validate.js', needles: ['V79 coverage gate and external runtime lifecycle matrix sync', 'checkV79()'] },
      { file: 'changelog corpus', content: changelogCorpus, needles: ['V79'].concat(gates) }
    ]

    for (const probe of probes) {
      const content = probe.content || read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V79] coverage gate / external runtime lifecycle sync in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    console.log('[V79] coverage gate and external runtime lifecycle matrix checked')
  }

  function checkV80() {
    const gates = [
      'audit-user-manual',
      'UserManualReviewScope',
      'DocsNavigationReviewMatrix'
    ]
    const changelogCorpus = collectChangelogSources()
      .map(source => source.content)
      .join('\n')

    const profileCorpus = [
      read(path.join(ACTIVE_DEVCODEX_ROOT, 'profile', '01-项目信息.md')),
      read(path.join(ACTIVE_DEVCODEX_ROOT, 'profile', '02-架构约束.md'))
    ].join('\n')

    const probes = [
      {
        file: 'skills/audit-user-manual/SKILL.md',
        needles: [
          'name: audit-user-manual',
          '项目文档',
          '菜单导航',
          'SidebarPageRoleMaterializationProbe',
          'DocsThemeRuntimeVisualProbeGate',
          'GeneratedSiteGate'
        ].concat(gates)
      },
      { file: 'plugin.json', needles: ['audit-user-manual', 'skills/audit-user-manual/SKILL.md'] },
      { file: 'skills/routing/SKILL.md', needles: ['audit-user-manual', '项目文档审查', '菜单导航'] },
      { file: 'skills/dev-docs/SKILL.md', needles: ['audit-user-manual', '项目文档', '菜单导航'] },
      { file: 'skills/audit-document/SKILL.md', needles: ['audit-user-manual', '项目文档', '菜单导航'] },
      { file: 'skills/audit-readme/SKILL.md', needles: ['audit-user-manual', '项目文档设计', '菜单导航'] },
      { file: 'skills/user-manual-authoring/SKILL.md', needles: ['audit-user-manual', '聚合审查'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['audit-user-manual', 'Profile', 'plugin.json', 'validate'] },
      { file: 'skills/test-router/SKILL.md', needles: ['userManualReview', 'audit-user-manual', '项目文档审查'] },
      { file: 'skills/report/SKILL.md', needles: gates.concat(['pageRole/sidebar group', '生成站点或运行态验证证据']) },
      { file: 'instructions.md', needles: ['audit-user-manual', '项目文档 review'] },
      { file: 'instructions/01-common.instructions.md', needles: ['audit-user-manual', '项目文档 review'] },
      { file: 'instructions/12-audit.instructions.md', needles: ['audit-user-manual', '项目文档 review', '菜单导航'] },
      { file: 'prompts/report-dev.prompt.md', needles: gates },
      { file: 'prompts/report-fix.prompt.md', needles: gates },
      { file: 'prompts/report-audit.prompt.md', needles: gates.concat(['文档设计', '菜单导航']) },
      { file: 'README.md', needles: ['68 个', 'audit-user-manual', '用户侧文档 review 聚合'] },
      { file: 'website/docs/index.md', needles: ['68 个 Skills', '用户侧文档 review 聚合'] },
      { file: 'website/docs/intro/index.md', needles: ['68 个按需触发', 'audit-user-manual'] },
      { file: 'website/docs/guide/development.md', needles: ['audit-user-manual', '菜单导航', 'sidebar'] },
      { file: 'website/docs/specs/directory-structure.md', needles: ['68 个', 'audit-user-manual', '用户侧文档 review'] },
      { file: 'active profile corpus', content: profileCorpus, needles: ['68', 'audit-user-manual'] },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV80'].concat(gates) },
      { file: 'scripts/validate.js', needles: ['V80 audit-user-manual aggregation skill sync', 'checkV80()'] },
      { file: 'changelog corpus', content: changelogCorpus, needles: ['V80'].concat(gates) }
    ]

    for (const probe of probes) {
      const content = probe.content || read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V80] audit-user-manual aggregation sync in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    console.log('[V80] audit-user-manual aggregation skill sync checked')
  }

  function checkV81() {
    const skill = 'spec-absorption'
    const gates = [
      'CommonNormGeneralizationGate',
      'AbsorptionCandidateConsumerProofGate'
    ]

    function classifyAbsorptionSample(sample) {
      const projectSpecific = /ServiceSpecReadGate|docs\/services\/<name>|单个业务项目|项目私有/.test(sample)
      const consumerProof = /DevCodex 当前消费者|targetOwner|跨工作流复用|宿主无关/.test(sample)
      if (projectSpecific && !consumerProof) return 'project-local'
      if (consumerProof) return 'absorb'
      return 'case-evidence-only'
    }

    const negativeSamples = [
      'ServiceSpecReadGate：服务开发进入编码前必须读取 docs/services/<name>/',
      '单个业务项目的 route/model/schema 命名规范'
    ]
    for (const sample of negativeSamples) {
      if (classifyAbsorptionSample(sample) === 'absorb') {
        err(`[V81] ${skill} negative sample was incorrectly classified as absorb: ${sample}`)
      }
    }
    const positiveSample = '跨工作流复用且已有 DevCodex 当前消费者和 targetOwner 的吸纳候选'
    if (classifyAbsorptionSample(positiveSample) !== 'absorb') {
      err(`[V81] ${skill} positive sample did not classify as absorb`)
    }

    const profileCorpus = [
      read(path.join(ACTIVE_DEVCODEX_ROOT, 'profile', '01-项目信息.md')),
      read(path.join(ACTIVE_DEVCODEX_ROOT, 'profile', '02-架构约束.md'))
    ].join('\n')
    const changelogCorpus = collectChangelogSources()
      .map(source => source.content)
      .join('\n')

    const probes = [
      { file: 'skills/spec-absorption/SKILL.md', needles: ['name: spec-absorption', '.devcodex/*/data', 'ServiceSpecReadGate', 'project-local', 'case-evidence-only', 'targetOwner'].concat(gates) },
      { file: 'plugin.json', needles: ['spec-absorption', 'skills/spec-absorption/SKILL.md'] },
      { file: 'skills/routing/SKILL.md', needles: ['spec-absorption', '最新可吸纳', '仍需吸纳'] },
      { file: 'skills/spec-governance/SKILL.md', needles: ['spec-absorption', 'project-local', 'AbsorptionCandidateConsumerProofGate'] },
      { file: 'skills/test-router/SKILL.md', needles: ['specAbsorption', 'CommonNormGeneralizationGate', 'AbsorptionCandidateConsumerProofGate'] },
      { file: 'skills/report/SKILL.md', needles: ['spec-absorption', 'CommonNormGeneralizationGate', 'targetOwner'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['spec-absorption', 'CommonNormGeneralizationGate', 'Concept Sync Map'] },
      { file: 'skills/source-consumer-sync/SKILL.md', needles: ['V81 规范吸纳执行同步面', 'spec-absorption', 'negativeSamples'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['spec-absorption', 'CommonNormGeneralizationGate', 'projectSpecificResidue'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['spec-absorption', 'CommonNormGeneralizationGate', 'DevCodex 当前消费者'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['spec-absorption', 'CommonNormGeneralizationGate', 'targetOwner'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['spec-absorption', 'AbsorptionCandidateConsumerProofGate', 'targetOwner'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['spec-absorption', 'projectSpecificResidue', 'devcodexConsumerEvidence'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['spec-absorption', 'negativeExamples', 'validationRoute'] },
      { file: 'README.md', needles: ['spec-absorption', 'CommonNormGeneralizationGate', 'ServiceSpecReadGate', '68 个'] },
      { file: 'website/docs/index.md', needles: ['68 个 Skills', '规范吸纳执行'] },
      { file: 'website/docs/intro/index.md', needles: ['68 个按需触发的工作流技能', 'spec-absorption'] },
      { file: 'website/docs/specs/directory-structure.md', needles: ['扁平一级 Skill（68 个）', 'spec-absorption'] },
      { file: 'website/docs/guide/development.md', needles: ['spec-absorption', 'CommonNormGeneralizationGate', 'ServiceSpecReadGate'] },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: ['spec-absorption', 'V81'] },
      { file: 'active profile corpus', content: profileCorpus, needles: ['68', 'spec-absorption'] },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV81', 'spec-absorption', 'CommonNormGeneralizationGate'] },
      { file: 'scripts/validate.js', needles: ['V81 spec absorption execution skill sync', 'checkV81()'] },
      { file: 'changelog corpus', content: changelogCorpus, needles: ['spec-absorption', 'CommonNormGeneralizationGate', 'V81'] }
    ]

    for (const probe of probes) {
      const content = probe.content || read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V81] spec absorption execution sync in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    console.log('[V81] spec-absorption execution skill sync checked')
  }

  function checkV82() {
    const gates = [
      'ConfigCanonicalNamespaceGate',
      'ProfileRuntimeContractSyncGate',
      'BehaviorSemanticDocsParityGate',
      'NegativeTranslationParityProbe',
      'DocsExampleTruthSurfaceGate',
      'CallbackExampleScopeProbe',
      'DerivedMetricConsumerProbe',
      'DerivedConsumerFailureInjectionProbe',
      'FeatureInventoryProfileGate',
      'FeatureChecklistEvidenceMatrixGate',
      'BatchEvidenceLedgerStateGate',
      'BatchProgressCardGate'
    ]

    function classifyConfigNamespaceSample(sample) {
      const canonical = /canonical namespace|既有 namespace|extensions\.[a-z0-9_-]+|历史契约/.test(sample)
      const legacyRationale = /legacy alias|兼容窗口|迁移理由|例外理由/.test(sample)
      const topLevel = /top-level|顶层配置|顶层 config/.test(sample)
      if (topLevel && !legacyRationale) return 'missing-rationale'
      if (canonical || legacyRationale) return 'acceptable'
      return 'needs-review'
    }

    if (classifyConfigNamespaceSample('新增顶层 config.cache，未说明 namespace 或迁移依据') !== 'missing-rationale') {
      err('[V82] ConfigCanonicalNamespaceGate negative sample was not rejected')
    }
    if (classifyConfigNamespaceSample('extensions.runtime.cache 使用 canonical namespace，并记录 legacy alias 兼容窗口') !== 'acceptable') {
      err('[V82] ConfigCanonicalNamespaceGate positive sample was not accepted')
    }

    const profileCorpus = [
      read(path.join(ACTIVE_DEVCODEX_ROOT, 'profile', '01-项目信息.md')),
      read(path.join(ACTIVE_DEVCODEX_ROOT, 'profile', '02-架构约束.md'))
    ].join('\n')
    const changelogCorpus = collectChangelogSources()
      .map(source => source.content)
      .join('\n')

    const probes = [
      { file: 'skills/spec-absorption/SKILL.md', needles: ['A1~A10 最新吸纳执行包', 'LatestAbsorptionExecutionPack'].concat(gates) },
      { file: 'skills/spec-governance/SKILL.md', needles: ['docs-semantics-examples', 'derived-consumer-runtime', 'feature-inventory-batch-evidence', 'A1~A10 最新吸纳执行包'] },
      { file: 'skills/dev-plan-review/SKILL.md', needles: ['ConfigCanonicalNamespaceGate', 'ProfileRuntimeContractSyncGate', 'LatestAbsorptionExecutionPack'] },
      { file: 'skills/test-router/SKILL.md', needles: ['latestAbsorptionExecutionPack'].concat(gates) },
      { file: 'skills/dev-docs/SKILL.md', needles: ['BehaviorSemanticDocsParityGate', 'NegativeTranslationParityProbe', 'DocsExampleTruthSurfaceGate', 'CallbackExampleScopeProbe'] },
      { file: 'skills/audit-document/SKILL.md', needles: ['BehaviorSemanticDocsParityGate', 'NegativeTranslationParityProbe', 'DocsExampleTruthSurfaceGate', 'CallbackExampleScopeProbe'] },
      { file: 'skills/audit-readme/SKILL.md', needles: ['BehaviorSemanticDocsParityGate', 'NegativeTranslationParityProbe', 'DocsExampleTruthSurfaceGate', 'CallbackExampleScopeProbe'] },
      { file: 'skills/user-manual-authoring/SKILL.md', needles: ['BehaviorSemanticDocsParityGate', 'NegativeTranslationParityProbe', 'DocsExampleTruthSurfaceGate', 'CallbackExampleScopeProbe'] },
      { file: 'skills/audit-project/SKILL.md', needles: ['DerivedMetricConsumerProbe', 'DerivedConsumerFailureInjectionProbe'] },
      { file: 'skills/dev-testing/SKILL.md', needles: ['DerivedMetricConsumerProbe', 'DerivedConsumerFailureInjectionProbe'] },
      { file: 'skills/load-profile/SKILL.md', needles: ['FeatureInventoryProfileGate', 'ProfileRuntimeContractSyncGate'] },
      { file: 'skills/profile-bootstrap/SKILL.md', needles: ['FeatureInventoryProfileGate'] },
      { file: 'skills/review-checklist/SKILL.md', needles: ['FeatureChecklistEvidenceMatrixGate', 'BatchEvidenceLedgerStateGate', 'BatchProgressCardGate', 'EvidenceLedger', 'Progress Card'] },
      { file: 'skills/audit-requirements/SKILL.md', needles: ['FeatureChecklistEvidenceMatrixGate', 'BatchEvidenceLedgerStateGate', 'BatchProgressCardGate'] },
      { file: 'skills/document-sync/SKILL.md', needles: ['A1~A10 最新吸纳执行包'].concat(gates) },
      { file: 'skills/report/SKILL.md', needles: ['LatestAbsorptionExecutionPack', 'DerivedMetricConsumerProbe', 'FeatureInventoryProfileGate', 'BatchEvidenceLedgerStateGate'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['LatestAbsorptionExecutionPack A1~A10', 'ConfigCanonicalNamespaceGate', 'BatchProgressCardGate'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['LatestAbsorptionExecutionPack A1~A10', 'V82', 'BatchEvidenceLedgerStateGate'] },
      { file: 'prompts/implementation-progress.prompt.md', needles: ['LatestAbsorptionExecutionPack A1~A10', 'EvidenceLedger', 'Progress Card'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['LatestAbsorptionExecutionPack A1~A10', 'V82', 'DerivedMetricConsumerProbe'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['LatestAbsorptionExecutionPack A1~A10', 'V82', 'FeatureInventoryProfileGate'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['LatestAbsorptionExecutionPack A1~A10', 'V82', 'BatchEvidenceLedgerStateGate'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['LatestAbsorptionExecutionPack A1~A10', 'DerivedConsumerFailureInjectionProbe', 'BatchProgressCardGate'] },
      { file: 'README.md', needles: ['LatestAbsorptionExecutionPack', 'A1~A10', 'V82'] },
      { file: 'website/docs/guide/development.md', needles: ['LatestAbsorptionExecutionPack', 'A1~A10', 'V82'] },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: ['A1~A10', 'LatestAbsorptionExecutionPack', 'V82'] },
      { file: 'active profile corpus', content: profileCorpus, needles: ['LatestAbsorptionExecutionPack', 'A1~A10', 'V82'] },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV82', 'LatestAbsorptionExecutionPack', 'ConfigCanonicalNamespaceGate'] },
      { file: 'scripts/validate.js', needles: ['V82 latest absorption execution pack sync', 'checkV82()'] },
      { file: 'changelog corpus', content: changelogCorpus, needles: ['LatestAbsorptionExecutionPack', 'ConfigCanonicalNamespaceGate', 'V82'] }
    ]

    for (const probe of probes) {
      const content = probe.content || read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V82] latest absorption execution pack sync in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    console.log('[V82] latest absorption execution pack sync checked')
  }

  function checkV83() {
    const gates = [
      'ProfileTierStandardGate',
      'ProfileLifecycleClassificationGate',
      'AllDevCodexProfileValidationGate'
    ]

    const profileCorpus = [
      'README.md',
      '01-项目信息.md',
      '06-功能清单.md',
      '07-用户文档与契约规范.md'
    ]
      .map(name => {
        const file = path.join(ACTIVE_DEVCODEX_ROOT, 'profile', name)
        return fs.existsSync(file) ? read(file) : ''
      })
      .join('\n')
    const changelogCorpus = collectChangelogSources()
      .map(source => source.content)
      .join('\n')

    const probes = [
      { file: 'scripts/validate-profile.js', needles: ['--profile-dir', '--workspace-profile', 'profile-lite', 'profile-standard', 'profile-closed-loop', 'profile tier missing', 'workspace fallback', 'conditional-required'].concat(gates) },
      { file: 'scripts/validate-all-profiles.js', needles: ['--workspace', '.devcodex', '--profile-dir', '--strict-warnings', 'checked=', 'warnings='] },
      { file: 'scripts/test-validate-profile.js', needles: ['profile-standard', 'profile-closed-loop', 'runValidateAll', 'checked=2'] },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV83'].concat(gates) },
      { file: 'scripts/validate.js', needles: ['V83 profile tier and workspace validation sync', 'checkV83()'] },
      { file: 'package.json', needles: ['test:profile-all', 'node scripts/validate-all-profiles.js', 'scripts/validate-all-profiles.js'] },
      { file: 'skills/load-profile/SKILL.md', needles: ['profile-lite', 'profile-standard', 'profile-closed-loop', 'conditional-required'].concat(gates) },
      { file: 'skills/profile-bootstrap/SKILL.md', needles: ['profile-lite', 'profile-standard', 'profile-closed-loop', 'FeatureInventoryProfileGate'].concat(gates) },
      { file: 'skills/test-router/SKILL.md', needles: ['profileTierValidation', 'allDevCodexProfileValidation'].concat(gates) },
      { file: 'skills/report/SKILL.md', needles: ['ProfileTierValidation', 'AllDevCodexProfileValidation'].concat(gates) },
      { file: 'README.md', needles: ['profile-lite', 'profile-standard', 'profile-closed-loop', 'AllDevCodexProfileValidationGate'].concat(gates) },
      { file: 'website/docs/guide/development.md', needles: ['profile-lite', 'profile-standard', 'profile-closed-loop', 'AllDevCodexProfileValidationGate'].concat(gates) },
      { file: 'active profile corpus', content: profileCorpus, needles: ['profile-closed-loop', '06-功能清单', '07-用户文档与契约规范', '稳定基线', '活文档'].concat(gates) },
      { file: 'changelog corpus', content: changelogCorpus, needles: ['V83'].concat(gates) }
    ]

    for (const probe of probes) {
      const content = probe.content || read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V83] profile tier / all workspace profile validation sync in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    try {
      execSync('node scripts/test-validate-profile.js', { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    } catch (e) {
      const detail = String((e.stderr || e.stdout || e.message || '')).trim().split('\n').slice(0, 8).join(' | ')
      err(`[V83] test-validate-profile failed${detail ? `: ${detail}` : ''}`)
    }

    console.log('[V83] profile tier and workspace validation sync checked')
  }

  function classifyExpertOutputSample(sample) {
    const fixtureOnly = /fixture|mock|demo|硬编码单例|每个 route 都重复|重复声明/.test(sample)
    const production = /生产推荐路径|框架原生能力|项目既有能力|推荐写法|public API|official docs/.test(sample)
    const boundary = /fixtureBoundary|mock.*边界|demo.*边界|反模式|evidenceMatrix|AntiPattern/.test(sample)
    if (fixtureOnly && !production && !boundary) return 'misleading-fixture'
    if (production && boundary) return 'expert-quality'
    return 'needs-review'
  }

  function checkV84() {
    const gates = [
      'ExpertOutputQualityGate',
      'ProductionRecommendedPathGate',
      'FrameworkNativeCapabilityFirstGate',
      'FixtureBoundaryDisclosureGate',
      'AntiPatternContrastGate',
      'ExpertEvidenceMatrixGate'
    ]

    const profileCorpus = [
      '01-项目信息.md',
      '02-架构约束.md',
      '06-功能清单.md'
    ]
      .map(name => {
        const file = path.join(ACTIVE_DEVCODEX_ROOT, 'profile', name)
        return fs.existsSync(file) ? read(file) : ''
      })
      .join('\n')
    const changelogCorpus = collectChangelogSources()
      .map(source => source.content)
      .join('\n')

    const negative = 'permission-core-auth fixture 通过在每个 route 都重复 middlewares 和 auth 资源配置证明底层能力可用。'
    const positive = '生产推荐路径应优先使用框架原生能力和项目既有 helper；fixtureBoundary 只说明 mock/demo 验证边界，antiPattern/evidenceMatrix 标出每个 route 重复声明不是推荐写法。'
    if (classifyExpertOutputSample(negative) !== 'misleading-fixture') {
      err('[V84] negative fixture sample must be classified as misleading-fixture')
    }
    if (classifyExpertOutputSample(positive) !== 'expert-quality') {
      err('[V84] positive expert sample must be classified as expert-quality')
    }

    const probes = [
      { file: 'skills/expert-output-quality/SKILL.md', needles: ['name: expert-output-quality', 'description:', 'roleBaseline', 'productionRecommendedPath', 'frameworkNativeCapability', 'fixtureBoundary', 'antiPatternContrast', 'evidenceMatrix'].concat(gates) },
      { file: 'plugin.json', needles: ['expert-output-quality', 'skills/expert-output-quality/SKILL.md'] },
      { file: 'skills/routing/SKILL.md', needles: ['expert-output-quality', '不专业', '像初级', '示例误导'] },
      { file: 'skills/spec-governance/SKILL.md', needles: ['expert-output-quality'].concat(gates) },
      { file: 'skills/spec-absorption/SKILL.md', needles: ['ExpertOutputQualityGate', 'ProductionRecommendedPathGate', 'FrameworkNativeCapabilityFirstGate'] },
      { file: 'skills/dev-plan-review/SKILL.md', needles: ['ExpertOutputQualityGate', 'fixture/mock/demo', 'evidenceMatrix'] },
      { file: 'skills/dev-docs/SKILL.md', needles: ['ExpertOutputQualityGate', 'ProductionRecommendedPathGate', 'fixture/mock/demo/legacy'] },
      { file: 'skills/user-manual-authoring/SKILL.md', needles: ['expertOutputQualityEvidence', 'expert-output-quality', 'FixtureBoundaryDisclosureGate'] },
      { file: 'skills/audit-document/SKILL.md', needles: ['ExpertOutputQualityGate', 'fixture/mock/demo'] },
      { file: 'skills/audit-readme/SKILL.md', needles: ['ExpertOutputQualityGate', '生产推荐路径'] },
      { file: 'skills/audit-user-manual/SKILL.md', needles: ['expert-output-quality', '专家型产物质量'] },
      { file: 'skills/audit-project/SKILL.md', needles: ['ExpertOutputQualityGate', '不专业', '像初级'] },
      { file: 'skills/audit-tech-design/SKILL.md', needles: ['ExpertOutputQualityGate', '生产推荐路径'] },
      { file: 'skills/test-router/SKILL.md', needles: ['expertOutputQuality', 'V84'].concat(gates) },
      { file: 'skills/report/SKILL.md', needles: ['ExpertOutputQualityGate', 'V84', '不得只写“已优化表述”'] },
      { file: 'prompts/technical-design.prompt.md', needles: ['ExpertOutputQualityGate', 'fixture/mock/demo 边界'] },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['ExpertOutputQualityGate', 'V84/targeted probe'] },
      { file: 'prompts/report-dev.prompt.md', needles: ['ExpertOutputQualityGate', 'V84'] },
      { file: 'prompts/report-fix.prompt.md', needles: ['ExpertOutputQualityGate', 'V84'] },
      { file: 'prompts/report-audit.prompt.md', needles: ['ExpertOutputQualityGate', 'V84'] },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['ExpertOutputQualityGate', 'V84'] },
      { file: 'README.md', needles: ['68 个', 'expert-output-quality', 'V84', 'ExpertOutputQualityGate'] },
      { file: 'website/docs/index.md', needles: ['68 个 Skills', 'expert-output-quality'] },
      { file: 'website/docs/intro/index.md', needles: ['68 个按需触发', 'expert-output-quality'] },
      { file: 'website/docs/specs/directory-structure.md', needles: ['扁平一级 Skill（68 个）', 'expert-output-quality'] },
      { file: 'website/docs/guide/development.md', needles: ['expert-output-quality', 'ExpertOutputQualityGate', 'V84'] },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: ['V84', 'expert-output-quality', 'ExpertOutputQualityGate'] },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV84', 'classifyExpertOutputSample', 'ExpertOutputQualityGate'] },
      { file: 'scripts/validate.js', needles: ['V84 expert output quality skill sync', 'checkV84()'] },
      { file: 'active profile corpus', content: profileCorpus, needles: ['68', 'expert-output-quality', 'ExpertOutputQualityGate'] },
      { file: 'changelog corpus', content: changelogCorpus, needles: ['V84', 'expert-output-quality', 'ExpertOutputQualityGate'] }
    ]

    for (const probe of probes) {
      const content = probe.content || read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V84] expert output quality skill sync in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    console.log('[V84] expert output quality skill sync checked')
  }

  function classifyExpertOwnerSample(sample) {
    if (/目标用户|用户价值|优先级|成功指标|scopeBoundary/.test(sample)) return 'product-strategy'
    if (/第一次成功|quick start|接入体验|错误信息|迁移路径|developerPersona/.test(sample)) return 'developer-experience-architecture'
    if (/任务流|信息架构|状态反馈|空态|错误恢复|interactionCost/.test(sample)) return 'ux-interaction-architecture'
    if (/异步缓存|旧数据|stale-while-revalidate|SSR|runtime config|空白页/.test(sample)) return 'frontend-architecture'
    if (/领域语言|边界上下文|权限模型|事务|一致性|幂等/.test(sample)) return 'backend-domain-architecture'
    if (/可观测性|容量|泄漏风险|回滚|运行手册|SRE/.test(sample)) return 'production-readiness-sre'
    if (/API 契约|public API|错误模型|分页|SDK|consumerSurface/.test(sample)) return 'api-contract-architecture'
    if (/Webhook|OAuth|第三方|配额|重试|供应商锁定|providerBoundary/.test(sample)) return 'external-integration-architecture'
    if (/CLI|Hook|多宿主|插件|扩展点|兼容矩阵|hostSurfaceMatrix/.test(sample)) return 'platform-ecosystem-architecture'
    if (/Agent 路由|工具调用|上下文|记忆|人机协作|toolPermissionBoundary|observabilityReplay/.test(sample)) return 'ai-agent-system-architecture'
    if (/数据模型|迁移|索引|生命周期|数据质量|analyticsConsumer/.test(sample)) return 'data-architecture'
    if (/威胁建模|信任边界|越权|密钥策略|审计|trustBoundary/.test(sample)) return 'security-threat-modeling'
    if (/测试金字塔|验收矩阵|覆盖率|回归范围|发布信心|riskModel/.test(sample)) return 'quality-strategy'
    if (/设计系统|Token|组件变体|主题|Figma|designTokens|componentVariantModel/.test(sample)) return 'design-system-architecture'
    if (/无障碍|键盘|焦点|屏幕阅读器|ARIA|国际化|本地化|RTL|locale|userNeedsMatrix|runtimeVerification/.test(sample)) return 'accessibility-i18n'
    if (/增长|埋点|漏斗|留存|实验|转化|growthQuestion|metricTaxonomy|eventInstrumentation/.test(sample)) return 'growth-analytics'
    if (/商业模式|定价|套餐|付费|成本收益|收入模型|运营风险|valueExchange|pricingPackaging|sustainabilityTco/.test(sample)) return 'business-model-review'
    return 'needs-review'
  }

  function checkV85() {
    const skillMap = [
      ['product-strategy', 'ProductStrategyOwnerGate', ['targetUser', 'problemValue', 'priorityTradeoff', 'scopeBoundary', 'successSignals', 'riskDecision', 'evidenceMatrix']],
      ['developer-experience-architecture', 'DeveloperExperienceArchitectureGate', ['developerPersona', 'firstSuccessPath', 'integrationSteps', 'exampleTruth', 'errorExperience', 'migrationPath', 'docsEntryPoints']],
      ['ux-interaction-architecture', 'UxInteractionArchitectureGate', ['taskFlow', 'informationArchitecture', 'stateFeedback', 'emptyErrorRecovery', 'interactionCost', 'accessibilityTouchpoints']],
      ['frontend-architecture', 'FrontendArchitectureOwnerGate', ['renderingStrategy', 'stateModel', 'asyncCachePolicy', 'runtimeConfig', 'i18nSseHandling', 'blankPagePrevention', 'verificationRoute']],
      ['backend-domain-architecture', 'BackendDomainArchitectureGate', ['domainLanguage', 'boundedContext', 'workflowInvariants', 'permissionModel', 'transactionConsistency', 'idempotencyCompatibility']],
      ['production-readiness-sre', 'ProductionReadinessSreGate', ['observabilityPlan', 'capacityAssumption', 'failureModes', 'rollbackPlan', 'runbookEntry', 'releaseRisk', 'operationalEvidence']],
      ['api-contract-architecture', 'ApiContractArchitectureGate', ['consumerSurface', 'contractInventory', 'versionCompatibility', 'errorModel', 'idempotencyPagination', 'sdkDocsImpact', 'evidenceMatrix']],
      ['external-integration-architecture', 'ExternalIntegrationArchitectureGate', ['providerBoundary', 'authCallbackModel', 'quotaRetryPolicy', 'webhookIdempotency', 'failureDegradation', 'lockInExitPlan', 'evidenceMatrix']],
      ['platform-ecosystem-architecture', 'PlatformEcosystemArchitectureGate', ['hostSurfaceMatrix', 'extensionPointContract', 'capabilityDiscovery', 'compatibilityMatrix', 'migrationPath', 'releaseDistributionImpact', 'evidenceMatrix']],
      ['ai-agent-system-architecture', 'AiAgentSystemArchitectureGate', ['intentRouting', 'toolPermissionBoundary', 'contextMemoryModel', 'stateMachineHandoff', 'observabilityReplay', 'humanInLoopBoundary', 'evidenceMatrix']],
      ['data-architecture', 'DataArchitectureGate', ['dataModel', 'schemaMigration', 'queryIndexPlan', 'lifecycleRetention', 'dataQuality', 'analyticsConsumer', 'evidenceMatrix']],
      ['security-threat-modeling', 'SecurityThreatModelingGate', ['trustBoundary', 'threatScenario', 'permissionAbuseCase', 'secretPolicy', 'auditLogging', 'mitigationVerification', 'evidenceMatrix']],
      ['quality-strategy', 'QualityStrategyGate', ['riskModel', 'testPyramid', 'acceptanceMatrix', 'regressionScope', 'coverageGate', 'releaseConfidence', 'evidenceMatrix']],
      ['design-system-architecture', 'DesignSystemArchitectureGate', ['designTokens', 'componentVariantModel', 'themeConsistency', 'accessibilityI18nBoundary', 'figmaCodeSync', 'adoptionGovernance', 'evidenceMatrix']],
      ['accessibility-i18n', 'AccessibilityI18nGate', ['userNeedsMatrix', 'keyboardFocusModel', 'screenReaderSemantics', 'localeContentModel', 'rtlFormatting', 'runtimeVerification', 'fallbackRecovery', 'evidenceMatrix']],
      ['growth-analytics', 'GrowthAnalyticsGate', ['growthQuestion', 'metricTaxonomy', 'eventInstrumentation', 'funnelRetentionModel', 'experimentDesign', 'privacyConsentBoundary', 'decisionLoop', 'evidenceMatrix']],
      ['business-model-review', 'BusinessModelReviewGate', ['valueExchange', 'revenueCostModel', 'pricingPackaging', 'marketSegmentChannel', 'operationalRisk', 'sustainabilityTco', 'decisionBoundary', 'evidenceMatrix']]
    ]
    const skillNames = skillMap.map(([name]) => name)
    const gates = skillMap.map(([, gate]) => gate)

    const sampleExpectations = [
      ['需要定义目标用户、用户价值、优先级取舍和成功指标', 'product-strategy'],
      ['CLI quick start 应覆盖第一次成功、错误信息和迁移路径', 'developer-experience-architecture'],
      ['详情返回后要保留任务流、状态反馈、空态和错误恢复', 'ux-interaction-architecture'],
      ['首页和详情必须旧数据先显示、异步缓存刷新和 stale-while-revalidate', 'frontend-architecture'],
      ['权限模型、领域语言、事务一致性和幂等兼容需要后端领域架构', 'backend-domain-architecture'],
      ['发布前需要可观测性、容量假设、泄漏风险、回滚和运行手册', 'production-readiness-sre'],
      ['public API 契约要冻结错误模型、分页过滤、SDK 文档和 consumerSurface', 'api-contract-architecture'],
      ['第三方 OAuth Webhook 接入要定义配额、重试、供应商锁定和 providerBoundary', 'external-integration-architecture'],
      ['CLI Hook 多宿主插件扩展点要维护兼容矩阵和 hostSurfaceMatrix', 'platform-ecosystem-architecture'],
      ['Agent 路由、工具调用权限、上下文记忆和人机协作边界需要专门建模', 'ai-agent-system-architecture'],
      ['数据模型、迁移、索引、生命周期、数据质量和 analyticsConsumer 需要数据架构', 'data-architecture'],
      ['威胁建模要覆盖信任边界、越权、密钥策略、审计和 mitigation 验证', 'security-threat-modeling'],
      ['质量策略要绑定测试金字塔、验收矩阵、覆盖率、回归范围和发布信心', 'quality-strategy'],
      ['设计系统要定义 Token、组件变体、主题、Figma 同步和设计治理', 'design-system-architecture'],
      ['文档站和表单要覆盖无障碍、键盘焦点、屏幕阅读器、国际化和 RTL 验证', 'accessibility-i18n'],
      ['增长漏斗需要定义埋点、留存、实验、转化指标和 metricTaxonomy', 'growth-analytics'],
      ['商业模式审查要覆盖定价、套餐、付费路径、成本收益和 sustainabilityTco', 'business-model-review']
    ]
    for (const [sample, expected] of sampleExpectations) {
      const actual = classifyExpertOwnerSample(sample)
      if (actual !== expected) {
        err(`[V85] expert owner classifier expected ${expected} but got ${actual}: ${sample}`)
      }
    }

    const profileCorpus = [
      '01-项目信息.md',
      '02-架构约束.md',
      '06-功能清单.md'
    ]
      .map(name => {
        const file = path.join(ACTIVE_DEVCODEX_ROOT, 'profile', name)
        return fs.existsSync(file) ? read(file) : ''
      })
      .join('\n')
    const changelogCorpus = collectChangelogSources()
      .map(source => source.content)
      .join('\n')

    const probes = [
      { file: 'plugin.json', needles: skillNames.map(name => `skills/${name}/SKILL.md`) },
      { file: 'skills/routing/SKILL.md', needles: skillNames.concat(['ExpertOwnerSkillGate', '产品策略', '开发者体验', 'UX 交互', '前端架构', '后端领域架构', '生产可用性']) },
      { file: 'skills/spec-governance/SKILL.md', needles: ['expert-owner-skills', 'ExpertOwnerSkillGate'].concat(skillNames).concat(gates) },
      { file: 'skills/spec-absorption/SKILL.md', needles: ['ExpertOwnerSkillGate'].concat(skillNames) },
      { file: 'skills/dev-plan-review/SKILL.md', needles: ['ExpertOwnerSkillGate', 'ownerSkill', 'triggerReason', 'requiredFields', 'V85'] },
      { file: 'skills/test-router/SKILL.md', needles: ['expertOwnerSkills', 'ExpertOwnerSkillGate', 'V85'].concat(gates) },
      { file: 'skills/report/SKILL.md', needles: ['ExpertOwnerSkillGate', '17 个专家 Owner Skill', 'V85'].concat(gates) },
      { file: 'prompts/technical-design.prompt.md', needles: ['ExpertOwnerSkillGate', 'V85/targeted probe'].concat(skillNames) },
      { file: 'prompts/implementation-plan.prompt.md', needles: ['ExpertOwnerSkillGate', 'V85-targeted probe'].concat(skillNames) },
      { file: 'prompts/report-dev.prompt.md', needles: ['ExpertOwnerSkillGate', 'V85'].concat(skillNames) },
      { file: 'prompts/report-fix.prompt.md', needles: ['ExpertOwnerSkillGate', 'V85'].concat(skillNames) },
      { file: 'prompts/report-audit.prompt.md', needles: ['ExpertOwnerSkillGate', 'V85'].concat(skillNames) },
      { file: 'prompts/report-scenario-test.prompt.md', needles: ['ExpertOwnerSkillGate', 'V85'].concat(gates) },
      { file: 'README.md', needles: ['68 个', '专家 Owner Skill', 'ExpertOwnerSkillGate', 'V85'].concat(skillNames) },
      { file: 'website/docs/index.md', needles: ['68 个 Skills', '专家 Owner Skill'] },
      { file: 'website/docs/intro/index.md', needles: ['68 个按需触发', '专家 Owner Skill'] },
      { file: 'website/docs/specs/directory-structure.md', needles: ['扁平一级 Skill（68 个）', 'ExpertOwnerSkillGate'].concat(skillNames) },
      { file: 'website/docs/guide/development.md', needles: ['ExpertOwnerSkillGate', 'V85'].concat(skillNames) },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: ['V85', 'ExpertOwnerSkillGate'].concat(skillNames) },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV85', 'classifyExpertOwnerSample', 'ExpertOwnerSkillGate'] },
      { file: 'scripts/validate.js', needles: ['V85 expert owner skill sync', 'checkV85()'] },
      { file: 'active profile corpus', content: profileCorpus, needles: ['68', '专家 Owner Skill', 'ExpertOwnerSkillGate', 'V85'].concat(skillNames) },
      { file: 'changelog corpus', content: changelogCorpus, needles: ['V85', 'ExpertOwnerSkillGate'].concat(skillNames) }
    ]

    for (const [name, gate, fields] of skillMap) {
      probes.push({
        file: `skills/${name}/SKILL.md`,
        needles: [`name: ${name}`, 'description:', gate, '输出字段', '反模式'].concat(fields)
      })
    }

    for (const probe of probes) {
      const content = probe.content || read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V85] expert owner skill sync in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    console.log('[V85] expert owner skill sync checked')
  }

  function classifyMemoryBootstrapSample(sample) {
    const memoryHint = /Memories|use_memories|内置记忆|宿主记忆|模型记忆|长期偏好/.test(sample)
    const replacesTruth = /跳过|替代|无需读取|不用读取|满足 bootstrap|作为验证证据|已通过证据/.test(sample)
    const fileTruth = /Profile|SUMMARY|tasks|reports|review checklist|源码|文档真相源|文件真相源/.test(sample)
    const navigationOnly = /navigation-hint|导航提示|只作为/.test(sample)
    if (memoryHint && replacesTruth) return 'invalid-memory-substitute'
    if (memoryHint && navigationOnly && fileTruth) return 'file-truth-required'
    return 'needs-review'
  }

  function checkV86() {
    const gate = 'MemoryCannotSatisfyBootstrapGate'
    const negative = '开启 Codex Memories 后可跳过 Profile、tasks、reports 读取，并把模型记忆作为验证证据。'
    const positive = 'Codex Memories 只作为 navigation-hint，仍读取 Profile、SUMMARY、today tasks、reports、review checklist 和源码 / 文档真相源。'
    if (classifyMemoryBootstrapSample(negative) !== 'invalid-memory-substitute') {
      err('[V86] negative memory bootstrap sample must be invalid-memory-substitute')
    }
    if (classifyMemoryBootstrapSample(positive) !== 'file-truth-required') {
      err('[V86] positive memory bootstrap sample must be file-truth-required')
    }

    const profileCorpus = [
      '01-项目信息.md',
      '06-功能清单.md',
      '07-用户文档与契约规范.md'
    ]
      .map(name => {
        const file = path.join(ACTIVE_DEVCODEX_ROOT, 'profile', name)
        return fs.existsSync(file) ? read(file) : ''
      })
      .join('\n')
    const changelogCorpus = collectChangelogSources()
      .map(source => source.content)
      .join('\n')

    const probes = [
      { file: 'skills/load-profile/SKILL.md', needles: [gate, 'Memories', 'Profile', 'Agent SUMMARY', 'report / review checklist', '不能把 Memories'] },
      { file: 'skills/memory/SKILL.md', needles: [gate, 'navigation-hint', 'Profile', 'daily tasks', 'review checklist'] },
      { file: 'skills/test-router/SKILL.md', needles: ['memoryCannotSatisfyBootstrap', gate, 'V86/targeted probe'] },
      { file: 'skills/report/SKILL.md', needles: [gate, 'navigation-hint', 'V86/targeted probe'] },
      { file: 'skills/spec-governance/SKILL.md', needles: ['memory-bootstrap', gate, 'navigation-hint'] },
      { file: 'skills/spec-absorption/SKILL.md', needles: [gate, 'validate V86'] },
      { file: 'README.md', needles: [gate, 'V86', 'navigation-hint'] },
      { file: 'website/docs/index.md', needles: [gate, 'navigation-hint'] },
      { file: 'website/docs/intro/index.md', needles: [gate, 'navigation-hint'] },
      { file: 'website/docs/guide/development.md', needles: [gate, 'V86'] },
      { file: 'website/docs/versions/v1/1.0.1/CHANGELOG.md', needles: [gate, 'V86'] },
      { file: 'scripts/test-spec-governance.js', needles: ['checkV86', 'classifyMemoryBootstrapSample', gate] },
      { file: 'scripts/validate.js', needles: ['V86 memory bootstrap truth source sync', 'checkV86()'] },
      { file: 'active profile corpus', content: profileCorpus, needles: [gate, 'V86'] },
      { file: 'changelog corpus', content: changelogCorpus, needles: [gate, 'V86'] }
    ]

    for (const probe of probes) {
      const content = probe.content || read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V86] memory bootstrap truth source sync in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    console.log('[V86] memory bootstrap truth source sync checked')
  }

  return {
    checkV39,
    checkV40,
    checkV41,
    checkV42,
    checkV43,
    checkV44,
    checkV45,
    checkV46,
    checkV47,
    checkV48,
    checkV49,
    checkV50,
    checkV51,
    checkV52,
    checkV53,
    checkV54,
    checkV55,
    checkV56,
    checkV57,
    checkV58,
    checkV59,
    checkV60,
    checkV61,
    checkV62,
    checkV63,
    checkV64,
    checkV65,
    checkV66,
    checkV67,
    checkV68,
    checkV69,
    checkV70,
    checkV71,
    checkV72,
    checkV73,
    checkV74,
    checkV75,
    checkV76,
    checkV77,
    checkV78,
    checkV79,
    checkV80,
    checkV81,
    checkV82,
    checkV83,
    checkV84,
    checkV85,
    checkV86
  }
}

module.exports = { buildGovernanceTailChecks }
