'use strict'

function buildGovernanceTailChecks(ctx) {
  const {
    ROOT,
    ACTIVE_DEVCODEX_ROOT,
    RECENT_REQUIREMENT_ARTIFACT_DAYS,
    collectRecentRequirementArtifactIssues,
    fs,
    path,
    execSync,
    read,
    err,
    mustInclude
  } = ctx

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
        needles: ['config.local.json', 'secretRef', 'must not override "${reserved}"', 'extensions']
      },
      {
        file: 'scripts/test-validate-profile.js',
        needles: ['validLocalConfig', 'invalidLocalConfig', 'config.local.json']
      },
      {
        file: 'scripts/test-mcp-servers.js',
        needles: ['config.local.json', 'REPORTING_DB_URL']
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
    const { checkedDirs, issues } = collectRecentRequirementArtifactIssues({
      activeRoot: ACTIVE_DEVCODEX_ROOT,
      recentDays: RECENT_REQUIREMENT_ARTIFACT_DAYS
    })

    for (const issue of issues) err(`[V41] ${issue}`)
    console.log(`[V41] requirement runtime artifact structure checked: ${checkedDirs.length} dirs`)
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

    for (const needle of ['R3b', 'npm run test:audit', 'package completeness gate', 'keywords', 'publishConfig', 'prepublishOnly']) {
      if (!releaseSkill.includes(needle)) err(`[V42] release-verification skill missing "${needle}"`)
    }
    for (const needle of ['R3b', 'npm run test:audit', 'package completeness gate', 'keywords', 'publishConfig', 'GitHub Packages']) {
      if (!releaseGuide.includes(needle)) err(`[V42] website release guide missing "${needle}"`)
    }
    for (const needle of ['release-verification', 'npm run test:audit', 'package completeness gate', 'publish dry-run']) {
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
      { file: 'instructions/01-common.instructions.md', needles: ['audit-readme', 'README / 用户使用文档额外叠加'] },
      { file: 'instructions/12-audit.instructions.md', needles: ['audit-readme', 'README / 用户使用文档不单独开新的审查目标'] },
      { file: 'skills/routing/SKILL.md', needles: ['audit-readme', 'README / 用户使用文档额外叠加'] },
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
      { file: 'instructions.md', needles: ['dev 模式默认应向用户展示完整 Intent Expansion Card', 'Context Rehydration Contract', '必须暂停执行，回补或重开 CP3'] },
      { file: 'instructions/01-common.instructions.md', needles: ['dev 模式默认', 'Context Rehydration Contract', '回到对应 CP3'] },
      { file: 'instructions/10-dev.instructions.md', needles: ['Intent Expansion 可见性', '执行期 CP3 回退', '回退到 `N4`'] },
      { file: 'instructions/11-fix.instructions.md', needles: ['Intent Expansion 可见性', '执行期 CP3 回退', '不替代 CP3'] },
      { file: 'instructions/15-memory.instructions.md', needles: ['Context Rehydration Contract（记忆侧）', 'SUMMARY.md` 是索引，不是事实源'] },
      { file: 'skills/intent/SKILL.md', needles: ['dev 模式默认向用户展示完整 Card', '先按文件真相源重建 Card'] },
      { file: 'skills/cp-gate/SKILL.md', needles: ['执行期 CP3 回退', '不要求 runtime 逐字输出一个同名对象'] },
      { file: 'skills/dev-default/SKILL.md', needles: ['执行期 CP3 回退（F-26）', '历史能力回归矩阵'] },
      { file: 'skills/fix-default/SKILL.md', needles: ['执行期 CP3 回退', '历史能力回归矩阵'] },
      { file: 'skills/execution-contract/SKILL.md', needles: ['regressionMatrix', '历史能力 → 受影响批次 → 必跑验证 → 失败回滚点'] },
      { file: 'skills/test-router/SKILL.md', needles: ['regressionChecks', '历史能力、必跑验证、对应批次和失败回滚点'] },
      { file: 'hooks/_runtime/lifecycle.cjs', needles: ['CP3_RUNTIME_FILE_THRESHOLD', 'cp-gate-CP3-runtime-threshold', '执行中已触达'] },
      { file: 'scripts/test-hooks-runtime.js', needles: ['bug-5.js', 'cp-gate-CP3-runtime-threshold', 'runtime threshold should not warn before the 5th unique source file'] },
      { file: 'prompts/precheck-status.prompt.md', needles: ['dev 模式默认向用户展示完整 Card', 'Context Rehydration Contract'] },
      { file: 'README.md', needles: ['Context Rehydration Contract', 'dev 模式默认会直接展示完整 Card', '执行期 CP3 回退'] },
      { file: 'website/docs/guide/development.md', needles: ['Context Rehydration Contract', 'dev 模式默认向用户展示完整 Intent Expansion Card', '执行期 CP3 回退'] }
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
      { file: 'skills/audit-release/SKILL.md', needles: ['RL-1 版本身份', 'RL-4 元数据完整性', 'RL-10 发布后验收', '不同于 release-verification'] },
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
      { file: 'website/docs/guide/release.md', needles: ['audit-release', 'RL-1~RL-10', 'ReleaseVerification R0~R7'] },
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
      { file: 'instructions/00-safety.instructions.md', needles: ['S02 受控私有例外模型', '核心秘密', 'secretRef', 'config.local.json'] },
      { file: 'instructions.md', needles: ['S02 受控私有例外模型', '核心秘密禁止项不可豁免', '受控私有例外'] },
      { file: 'instructions/01-common.instructions.md', needles: ['S02 核心秘密禁止项', '受控私有例外模型'] },
      { file: 'instructions/01a-profile-loading.instructions.md', needles: ['S02 受控私有例外模型', '核心秘密仍必须使用 `*Env` / `secretRef`'] },
      { file: 'skills/cp-gate/SKILL.md', needles: ['S02 核心秘密禁止项', '受控私有例外'] },
      { file: 'skills/load-profile/SKILL.md', needles: ['S02 受控私有例外模型', '核心秘密仍必须使用 `*Env` / `secretRef`'] },
      { file: 'prompts/project-profile.prompt.md', needles: ['受控私有例外', '核心秘密必须使用 `*Env` / `secretRef`'] },
      { file: 'scripts/validate-profile.js', needles: ['secretRef', 'must use *Env or secretRef instead of raw'] },
      { file: 'scripts/test-validate-profile.js', needles: ['passwordEnv', 'secretRef', 'must use \\*Env or secretRef instead of raw "password"'] },
      { file: 'skills/api-verification/SKILL.md', needles: ['@baseUrl = http://localhost:3000', '@token = replace-with-token-if-required', '@language = zh-CN', 'Authorization: Bearer {{token}}', 'Host 必须通过 `{{baseUrl}}`'] },
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
      { file: 'README.md', needles: ['Profile Freshness Check', 'changelogs/releases/vX.Y.Z.md', '核心秘密只允许 `*Env` / `secretRef`'] },
      { file: 'website/docs/guide/development.md', needles: ['Profile Freshness Check', '核心秘密必须使用 `*Env` / `secretRef`'] },
      { file: 'skills/audit-common/SKILL.md', needles: ['Profile Freshness Check（PFresh）', 'PFresh-1', 'PFresh-5', 'Profile freshness 待验证'] },
      { file: 'skills/audit-project/SKILL.md', needles: ['PE-0 Profile Freshness', 'Profile Freshness Check（PFresh）'] },
      { file: 'scripts/test-spec-governance.js', needles: ['Profile Freshness Check', 'changelogs/releases/vX.Y.Z.md', 'S02 受控私有例外模型'] }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V53] Batch D governance tail drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    console.log('[V53] security exception / API variables / changelog releases / profile freshness sync checked')
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
    checkV53
  }
}

module.exports = { buildGovernanceTailChecks }
