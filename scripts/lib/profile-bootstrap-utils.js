'use strict'

function buildProfileBootstrapUtils(context) {
  const {
    fs, path, detectHostPlatform, detectInstalledHostAssets, processEnv,
    featureInventorySchemaVersion = 'FeatureInventorySchemaV2',
    featureInventoryColumnLabels = {}
  } = context

  function readJsonSafe(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf-8')) } catch { return null }
  }

  function safeFirstLine(file, prefix) {
    if (!fs.existsSync(file)) return null
    const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/)
    return lines.find(line => line.startsWith(prefix)) || null
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
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (skip.has(entry.name) || entry.name.startsWith('.')) continue
        if (entry.isDirectory()) {
          lines.push(`${prefix}${entry.name}/`)
          walk(path.join(dir, entry.name), prefix + '  ', currentDepth + 1)
        }
      }
    }

    walk(cwd, '', 1)
    return lines.join('\n')
  }

  function detectStyle(cwd) {
    const eslint = ['.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', 'eslint.config.js', 'eslint.config.mjs']
      .some(file => fs.existsSync(path.join(cwd, file)))
    const prettier = ['.prettierrc', '.prettierrc.json', '.prettierrc.js', 'prettier.config.js']
      .some(file => fs.existsSync(path.join(cwd, file)))
    const tsconfig = readJsonSafe(path.join(cwd, 'tsconfig.json'))
    const editorconfig = fs.existsSync(path.join(cwd, '.editorconfig'))
    return { eslint, prettier, tsconfig, editorconfig }
  }

  function genProfileReadme(tier = 'profile-lite') {
    return `# Profile Index

> 项目规范文件目录。由 \`devcodex profile init\` 于 ${new Date().toISOString().slice(0, 10)} 自动生成。
> Profile 档位：\`${tier}\`。
> Profile 路径契约：\`portable-v1\`。项目内路径使用 \`<workspace-root>\`、\`<project-root>\` 或 \`<active-root>\`；真实本机外部路径须在同一行标注 \`<!-- devcodex:path-scope=machine-local -->\`。
> 生命周期：01~03 为稳定基线；04~07 为活文档；\`config.local.json\` 与 08+ 为条件 / 本地文档。

| 文件 | 说明 |
|------|------|
| 01-项目信息.md | 技术栈 / 仓库 / 版本 |
| 02-架构约束.md | 目录结构 / 模块边界 |
| 03-代码风格.md | 编码规范 / lint / 格式化 |
${tier !== 'profile-lite' ? '| 04-测试规范.md | 测试与验证路线 |\n| 05-发布规范.md | 交付与发布边界 |\n| 06-功能清单.md | 公开能力与消费者 |\n' : ''}${tier === 'profile-closed-loop' ? '| 07-用户文档与契约规范.md | 用户文档与公开契约 |\n' : ''}| config.json | ENV_MODE + agent 兜底标识 + \`extensions.devcodex.git\` 安全默认值 |
| config.local.json | 可选，用户 / 项目指定时使用的本地 overlay：长期连接、本地明文连接信息、env / secretRef 引用、\`extensions.<namespace>\` |
`
  }

  function genTestSpec(ctx) {
    return `# 04 — 测试规范

> 由 \`devcodex profile init\` 自动生成，生命周期：活文档。

## 项目命令

- test: \`${ctx.pkg?.scripts?.test || '未定义'}\`
- lint: \`${ctx.pkg?.scripts?.lint || '未定义'}\`
- build: \`${ctx.pkg?.scripts?.build || '未定义'}\`
`
  }

  function genReleaseSpec(ctx) {
    return `# 05 — 发布规范

> 由 \`devcodex profile init\` 自动生成，生命周期：活文档。

- 当前版本：${ctx.pkg?.version || '0.0.0'}
- 发布动作必须由用户明确确认，并在发布前执行项目测试、打包和回滚检查。
`
  }

  function genFeatureInventory(ctx) {
    const labels = {
      featureId: '能力 ID', capabilityGroup: '能力组', publicSurface: '公开面',
      configEntrypoint: '配置入口', primaryConsumers: '主要消费者', docsEntrypoint: '文档入口',
      validationRoute: '验证路线', sourceEvidence: '事实来源', maintenanceOwner: '维护责任',
      releaseState: '发布状态', lifecycleState: '生命周期状态', evidenceState: '证据状态',
      asOf: '证据日期', evidenceRefs: '证据引用', ...featureInventoryColumnLabels
    }
    const pkg = ctx.pkg || {}
    const candidates = []
    const testRoute = pkg.scripts?.test ? `\`${pkg.scripts.test}\`` : 'unverified: package.json#scripts.test 缺失'
    const docs = fs.existsSync(path.join(ctx.cwd, 'README.md')) ? '`README.md`' : 'unverified: README.md 不存在'
    const owner = fs.existsSync(path.join(ctx.cwd, 'CODEOWNERS')) || fs.existsSync(path.join(ctx.cwd, '.github', 'CODEOWNERS'))
      ? 'CODEOWNERS'
      : 'unverified: 项目维护者'
    const releaseState = pkg.version ? `unverified: package.json#version=${pkg.version}` : 'unverified: package.json#version 缺失'
    const asOf = new Date().toISOString().slice(0, 10)
    const exportsEvidence = pkg.exports ? 'package.json#exports' : (pkg.main ? 'package.json#main' : 'package.json#name')
    candidates.push({
      featureId: 'package-root',
      capabilityGroup: pkg.name || '项目核心能力',
      publicSurface: pkg.exports ? '`package.json#exports`' : (pkg.main ? `\`${pkg.main}\`` : 'unverified: 公开入口待人工确认'),
      configEntrypoint: 'N/A：包根能力无独立配置证据',
      primaryConsumers: 'unverified: 包消费者待人工确认',
      docsEntrypoint: docs,
      validationRoute: testRoute,
      sourceEvidence: exportsEvidence,
      maintenanceOwner: owner,
      releaseState,
      lifecycleState: 'implemented',
      evidenceState: 'source-backed',
      asOf,
      evidenceRefs: exportsEvidence
    })
    for (const [name, target] of Object.entries(pkg.bin || {})) {
      candidates.push({
        featureId: `cli-${name}`,
        capabilityGroup: 'CLI',
        publicSurface: `\`${name}\` → \`${target}\``,
        configEntrypoint: '命令行参数；具体选项待人工确认',
        primaryConsumers: 'CLI 用户',
        docsEntrypoint: docs,
        validationRoute: testRoute,
        sourceEvidence: `package.json#bin.${name}`,
        maintenanceOwner: owner,
        releaseState,
        lifecycleState: 'implemented',
        evidenceState: 'source-backed',
        asOf,
        evidenceRefs: `package.json#bin.${name}`
      })
    }
    const escapeCell = value => String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
    const headers = Object.keys(labels)
    const header = `| ${headers.map(key => labels[key]).join(' | ')} |`
    const divider = `|${headers.map(() => '---').join('|')}|`
    const rows = candidates.map(candidate => `| ${headers.map(key => escapeCell(candidate[key])).join(' | ')} |`).join('\n')
    return `# 06 — 功能清单

> FeatureInventoryProfileGate；schema：\`${featureInventorySchemaVersion}\`；生命周期：活文档。
> 本文件是完整功能清单的 canonical source；自动生成内容均为证据候选，\`unverified\` 项必须人工确认。

${header}
${divider}
${rows}
`
  }

  function recommendProfileTier(ctx) {
    const reasons = []
    const pkg = ctx.pkg || {}
    if (pkg.bin && Object.keys(pkg.bin).length) reasons.push('package.json#bin 表明项目提供 CLI')
    if (pkg.exports) reasons.push('package.json#exports 表明项目提供公开包接口')
    if (pkg.workspaces || ctx.arch.startsWith('monorepo:')) reasons.push('workspace/monorepo 需要跨模块闭环')
    if (fs.existsSync(path.join(ctx.cwd, 'website'))) reasons.push('website/ 表明项目维护文档站')
    if (fs.existsSync(path.join(ctx.cwd, 'skills')) || fs.existsSync(path.join(ctx.cwd, 'instructions.md'))) reasons.push('项目维护规范/Skill 控制面')
    if (reasons.length) return { tier: 'profile-closed-loop', reasons }
    if (pkg.scripts?.test || pkg.scripts?.build || pkg.scripts?.release) {
      return { tier: 'profile-standard', reasons: ['package.json scripts 表明项目有稳定测试/构建/发布要求'] }
    }
    return { tier: 'profile-lite', reasons: ['未检测到公开包、CLI、多模块、文档站或稳定交付信号'] }
  }

  function genUserContractSpec() {
    return `# 07 — 用户文档与契约规范

> ProfileLifecycleClassificationGate；生命周期：活文档。

- README、用户指南、公开 API / CLI / 配置和示例必须与当前实现同步。
- 条件 / 本地文档仅在项目真实使用对应能力时维护，并说明用途与验证方式。
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

## 本地配置与扩展说明（可选）

- 若项目使用 \`config.local.json\` 保存长期连接别名、本机专属配置或本地明文连接信息，请在本文件说明用途与使用方式。
- 脚本、测试、数据库 / SSH / MongoDB / 数据操作连接信息默认可按用户提供内容直写或沿用项目既有模式；只有用户或项目明确指定 \`config.local.json\` 时，才从该文件取得，缺失时提醒用户补齐。
- 项目级扩展只能写在 \`extensions.<namespace>\` 下，并记录字段语义、取值来源和是否依赖 env / secretRef。
- Git 协作事实未核实时保持 \`extensions.devcodex.git.collaborationMode=unverified\`、\`branchPolicy=no-auto-branch\`；branch/worktree/commit/cherry-pick/push 均不因 Profile 存在而自动获得授权。
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
    return JSON.stringify({
      mode,
      agent,
      extensions: {
        devcodex: {
          git: {
            collaborationMode: 'unverified',
            branchPolicy: 'no-auto-branch',
            worktreePolicy: 'explicit-only',
            crossBranchIntegration: 'unverified',
            sharedActionsRequireExplicitAuthorization: true
          }
        }
      }
    }, null, 2) + '\n'
  }

  function detectAgent(cwd) {
    const platformEvidence = detectHostPlatform(processEnv, cwd)
    if (platformEvidence.platform === 'claude') return 'claude-code'
    if (platformEvidence.platform === 'codex') return 'codex'
    if (platformEvidence.platform === 'grok') return 'grok'
    if (platformEvidence.platform === 'jetbrains-copilot') return 'jetbrains-copilot'
    if (platformEvidence.platform === 'vscode-copilot') return 'vscode-copilot'
    if (platformEvidence.platform === 'cursor') return 'cursor'

    const installed = detectInstalledHostAssets(cwd)
    if (installed.length === 1) return installed[0]
    return 'unknown-agent'
  }

  return {
    readJsonSafe,
    safeFirstLine,
    detectArch,
    listTopDirs,
    detectStyle,
    genProfileReadme,
    genProjectInfo,
    genArchitecture,
    genStyle,
    genTestSpec,
    genReleaseSpec,
    genFeatureInventory,
    recommendProfileTier,
    genUserContractSpec,
    genConfigJson,
    detectAgent
  }
}

module.exports = {
  buildProfileBootstrapUtils
}
