function buildGovernanceControlChecks(ctx) {
  const { ROOT, fs, path, read, err, execSync, activePath } = ctx

  function checkV20() {
    const probes = [
      {
        file: 'instructions/02-output-paths.instructions.md',
        needles: [
          'changelogs/unreleased.md',
          '用户**未明确要求** `tag` / `release` / `publish` 时',
          '仅在用户明确确认 release 后执行'
        ]
      },
      {
        file: 'website/docs/guide/release.md',
        needles: [
          '三层日志',
          'changelogs/unreleased.md',
          '用户**未明确要求** `tag` / `release` / `publish` 时'
        ]
      },
      {
        file: 'skills/document-sync/SKILL.md',
        needles: [
          '`changelogs/unreleased.md`',
          '仅正式发版时更新已发布版本索引'
        ]
      },
      {
        file: 'prompts/report-dev.prompt.md',
        needles: [
          'Release 状态',
          '日志落点'
        ]
      },
      {
        file: 'prompts/report-fix.prompt.md',
        needles: [
          'Release 状态',
          'CHANGELOG / unreleased 已按发布状态更新'
        ]
      }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V20] release/changelog dual-track drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }
    const unreleased = read(path.join(ROOT, 'changelogs', 'unreleased.md'))
    if (unreleased.includes('暂无未发布变更')) {
      const dateHeadings = [...unreleased.matchAll(/^## \d{4}-\d{2}-\d{2}/gm)]
      const contentAfterEmptyMarker = unreleased.split('暂无未发布变更').slice(1).join('暂无未发布变更')
      if (dateHeadings.length > 1 || /^## \d{4}-\d{2}-\d{2}/m.test(contentAfterEmptyMarker)) {
        err('[V20] changelogs/unreleased.md mixes empty-template marker with archived date sections')
      }
    }
    console.log('[V20] release/changelog dual-track semantics checked')
  }

  function checkV21() {
    const probes = [
      {
        file: 'instructions/01-common.instructions.md',
        needles: [
          '默认更新 `changelogs/unreleased.md`',
          '`commit` 默认**不自动执行**',
          '按**语义批次**提交',
          '显式输出结果',
          '必须追加交叉验证'
        ]
      },
      {
        file: 'skills/cp-gate/SKILL.md',
        needles: [
          '显式输出结果',
          '必须追加交叉验证',
          '前置复审结果：✅ 无阻断，可进入下一阶段'
        ]
      },
      {
        file: 'instructions/10-dev.instructions.md',
        needles: [
          '已验证的语义变更批次',
          '必须追加交叉验证',
          '前置复审结果：✅ 无阻断，可进入下一阶段'
        ]
      },
      {
        file: 'instructions/11-fix.instructions.md',
        needles: [
          '已验证的语义修复批次',
          '必须追加交叉验证',
          '前置复审结果：✅ 无阻断，可进入下一阶段'
        ]
      },
      {
        file: 'instructions/01-common.instructions.md',
        needles: [
          '统一联查矩阵（C11 扩展）',
          'L1 最小联查',
          'L2 标准联查',
          'L3 强联查',
          '控制面规则变更'
        ]
      },
      {
        file: 'instructions/10-dev.instructions.md',
        needles: [
          '统一联查矩阵（dev 最小动作）',
          '高联动场景默认升为 L2 标准联查',
          'L3 强联查'
        ]
      },
      {
        file: 'instructions/11-fix.instructions.md',
        needles: [
          '统一联查矩阵映射（fix）',
          'fix 默认按 **L2 标准联查** 起步',
          '工作区真相源 / 部署副本 / 分发链修复'
        ]
      },
      {
        file: 'instructions/13-analyze.instructions.md',
        needles: [
          '相关文件联查（analyze-lite）',
          '建立关联文件集合',
          '收敛前必须再跑一次 `CRS`'
        ]
      },
      {
        file: 'skills/fix-default/SKILL.md',
        needles: [
          '模板/示例不可直接执行',
          '自动化校验假绿'
        ]
      },
      {
        file: 'skills/dev-default/SKILL.md',
        needles: [
          '统一联查矩阵（F-25）',
          '默认升为 L2 标准联查',
          '高联动场景不得只做单文件修改'
        ]
      },
      {
        file: 'skills/fix-default/SKILL.md',
        needles: [
          '统一联查矩阵视为 L2 起步',
          '必须升为 L3'
        ]
      },
      {
        file: 'skills/analyze-research/SKILL.md',
        needles: [
          '建立关联文件集合',
          '收敛前再跑一次 CRS',
          '统一联查矩阵（research 最小动作）'
        ]
      },
      {
        file: 'skills/audit-common/SKILL.md',
        needles: [
          '统一联查矩阵映射（audit = L3）',
          'L3 强联查',
          '不被其他轻量联查规则替代'
        ]
      }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V21] workflow control-plane drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    const workspaceAgents = path.resolve(ROOT, '..', 'AGENTS.md')
    if (fs.existsSync(workspaceAgents)) {
      const content = read(workspaceAgents)
      for (const needle of [
        '强制约束（C01~C22）',
        '全量 FC1~FC7 + SC1~SC15 + RC1~RC4 + T1~T9',
        'CHANGELOG / unreleased 已按发布状态追加'
      ]) {
        if (!content.includes(needle)) {
          err(`[V21] workspace AGENTS drift: missing "${needle}" in ../AGENTS.md`)
        }
      }
    }

    console.log('[V21] workflow control-plane semantics checked')
  }

  function checkV22() {
    try {
      execSync('node scripts/test-migrate-layout.js', { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
      console.log('[V22] migrate-layout smoke test passed')
    } catch (e) {
      const detail = String((e.stderr || e.stdout || e.message || '')).trim().split('\n').slice(0, 8).join(' | ')
      err(`[V22] migrate-layout smoke test failed${detail ? `: ${detail}` : ''}`)
    }

    const probes = [
      {
        file: 'instructions/01-common.instructions.md',
        needles: ['workspace-namespace', 'single active scope write', 'workspace base + project overlay']
      },
      {
        file: 'instructions/02-output-paths.instructions.md',
        needles: ['<active-root>', 'layout.json', '<工作区根>/.devcodex/workspace/']
      },
      {
        file: 'mcp/profile-server.js',
        needles: ['workspace-namespace', '.devcodex', 'mergeConfig']
      },
      {
        file: 'mcp/memory-server.js',
        needles: ['scope', 'workspace-namespace', 'getActiveRoot']
      },
      {
        file: 'hooks/_runtime/lifecycle-bootstrap-state.cjs',
        needles: ['activeScope', 'workspace-namespace', 'getActiveNamespaceRoot']
      },
      {
        file: 'README.md',
        needles: ['migrate-layout', 'layout.json', '.devcodex/workspace']
      }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V22] workspace namespace drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }
    console.log('[V22] workspace namespace semantics checked')
  }

  function checkV23() {
    const probes = [
      {
        file: 'instructions/01-common.instructions.md',
        needles: ['机械唱反调', '用户方案已是当前最优', '不得直接顺从论证']
      },
      {
        file: 'instructions/10-dev.instructions.md',
        needles: ['机械反对', '用户给出的目录结构、实施顺序或方案本身经验证已是当前最优']
      },
      {
        file: 'instructions/11-fix.instructions.md',
        needles: ['机械反对', '修复路径经验证已是当前最优']
      },
      {
        file: 'instructions/12-audit.instructions.md',
        needles: ['已验证成立', '不得为了显得客观而反向挑错']
      },
      {
        file: 'instructions/13-analyze.instructions.md',
        needles: ['独立取证', '机械反对']
      },
      {
        file: 'skills/audit-common/SKILL.md',
        needles: ['判断独立性', '机械唱反调']
      },
      {
        file: 'skills/report/SKILL.md',
        needles: ['经独立验证后采纳', '证据来源']
      },
      {
        file: 'skills/cp-gate/SKILL.md',
        needles: ['推荐项可以与用户原始方案相同', '客观依据']
      }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V23] independent-evaluation drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    const workspaceAgents = path.resolve(ROOT, '..', 'AGENTS.md')
    if (fs.existsSync(workspaceAgents)) {
      const content = read(workspaceAgents)
      for (const needle of ['workspace-namespace', '机械唱反调']) {
        if (!content.includes(needle)) {
          err(`[V23] workspace AGENTS drift: missing "${needle}" in ../AGENTS.md`)
        }
      }
    }

    console.log('[V23] independent evaluation semantics checked')
  }

  function checkV24() {
    const requiredFiles = [
      'data/templates/pending-issues.md',
      'data/README.md',
      'README.md',
      'RULES.md',
      activePath('profile', '01-项目信息.md'),
      activePath('profile', '02-架构约束.md'),
      'website/rspress.config.ts',
      'website/docs/index.md',
      'website/docs/intro/index.md',
      'skills/audit-report/SKILL.md',
      'skills/report/SKILL.md',
      'instructions.md',
      'instructions/12-audit.instructions.md',
      'instructions/15-memory.instructions.md',
      'skills/memory/SKILL.md',
      'scripts/validate-profile.js',
      'codex/hooks.json',
      'index.js',
      'package.json',
      'plugin.json'
    ]

    const missingFiles = requiredFiles.filter(file => !fs.existsSync(path.isAbsolute(file) ? file : path.join(ROOT, file)))
    if (missingFiles.length) {
      err(`[V24] missing governance/client/template files: ${missingFiles.map(file => path.isAbsolute(file) ? path.relative(ROOT, file) : file).join(', ')}`)
      return
    }

    const musts = [
      { file: 'instructions.md', needle: '阻断/非阻断分流' },
      { file: 'instructions.md', needle: 'data/pending-issues.md' },
      { file: 'instructions/12-audit.instructions.md', needle: '阻断/非阻断分流' },
      { file: 'instructions/12-audit.instructions.md', needle: 'data/pending-issues.md' },
      { file: 'data/README.md', needle: 'pending-issues.md' },
      { file: 'data/templates/pending-issues.md', needle: 'ISSUE-000' },
      { file: 'README.md', needle: 'Copilot / Claude Code 双主支持' },
      { file: 'README.md', needle: 'init --claude' },
      { file: 'README.md', needle: 'init --codex' },
      { file: 'README.md', needle: 'AGENTS.md' },
      { file: 'README.md', needle: 'OpenAI Codex app/CLI' },
      { file: 'README.md', needle: 'pending-issues / process-improvements' },
      { file: 'RULES.md', needle: 'Copilot / Claude Code' },
      { file: 'RULES.md', needle: 'init --claude' },
      { file: 'RULES.md', needle: 'init --codex' },
      { file: 'RULES.md', needle: 'AGENTS.md' },
      { file: activePath('profile', '01-项目信息.md'), needle: 'CLAUDE.md', rawPath: false },
      { file: activePath('profile', '01-项目信息.md'), needle: 'AGENTS.md', rawPath: false },
      { file: activePath('profile', '01-项目信息.md'), needle: 'pending-issues.md', rawPath: false },
      { file: activePath('profile', '01-项目信息.md'), needle: '当前阶段', rawPath: false },
      { file: activePath('profile', '02-架构约束.md'), needle: '.codex/hooks.json', rawPath: false },
      { file: activePath('profile', '02-架构约束.md'), needle: 'pending-issues', rawPath: false },
      { file: activePath('profile', '02-架构约束.md'), needle: 'process-improvements', rawPath: false },
      { file: 'website/rspress.config.ts', needle: 'Copilot / Claude Code' },
      { file: 'website/docs/index.md', needle: 'Copilot / Claude Code' },
      { file: 'website/docs/index.md', needle: 'Codex' },
      { file: 'website/docs/index.md', needle: 'Hook 能力按宿主/事件降级' },
      { file: 'website/docs/intro/index.md', needle: 'Copilot / Claude Code' },
      { file: 'website/docs/intro/index.md', needle: 'Codex' },
      { file: 'website/docs/intro/index.md', needle: 'Hook 能力按宿主/事件降级' },
      { file: 'package.json', needle: 'Claude Code' },
      { file: 'package.json', needle: 'Codex' },
      { file: 'plugin.json', needle: 'Claude Code' },
      { file: 'skills/audit-report/SKILL.md', needle: '两层结构' },
      { file: 'skills/report/SKILL.md', needle: '两层问题清单' },
      { file: 'instructions.md', needle: 'jetbrains-copilot' },
      { file: 'instructions/15-memory.instructions.md', needle: 'jetbrains-copilot' },
      { file: 'skills/memory/SKILL.md', needle: 'jetbrains-copilot' },
      { file: 'scripts/validate-profile.js', needle: 'jetbrains-copilot' },
      { file: 'index.js', needle: 'jetbrains-copilot' }
    ]

    for (const probe of musts) {
      const content = probe.rawPath === false ? read(probe.file) : read(path.join(ROOT, probe.file))
      if (!content.includes(probe.needle)) {
        err(`[V24] governance/client drift in ${probe.rawPath === false ? path.relative(ROOT, probe.file) : probe.file}: missing "${probe.needle}"`)
      }
    }

    const mustNots = [
      { file: 'README.md', needle: '不使用 GitHub Copilot 的 IDE/Agent' },
      { file: 'instructions/15-memory.instructions.md', needle: 'zed-copilot' },
      { file: 'skills/memory/SKILL.md', needle: 'zed-copilot' }
    ]

    for (const probe of mustNots) {
      const content = read(path.join(ROOT, probe.file))
      if (content.includes(probe.needle)) {
        err(`[V24] governance/client drift in ${probe.file}: contains legacy text "${probe.needle}"`)
      }
    }

    console.log('[V24] governance/template/client narrative semantics checked')
  }

  return {
    checkV20,
    checkV21,
    checkV22,
    checkV23,
    checkV24
  }
}

module.exports = { buildGovernanceControlChecks }
