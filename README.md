# DevCodex

> AI 开发规范注入器 — Copilot / Claude Code 双主支持（Hook-First / Instruction-Fallback）

[![npm](https://img.shields.io/badge/npm-%40vextjs%2Fdevcodex-blue)](https://github.com/vextjs/devcodex)
[![License](https://img.shields.io/badge/license-AGPL--3.0-green)](LICENSE)

## DevCodex 是什么？

DevCodex 通过 `.github/`（Copilot）与 `CLAUDE.md + .claude/ + .mcp.json`（Claude Code）向受支持的 AI 编码客户端注入结构化的开发工作流规范。
在支持 Hooks 的宿主中，它优先用 `hooks/_runtime/lifecycle.cjs` 提供确定性的生命周期护栏；在不支持 Hooks 的宿主中，则回退到 instructions 语义层继续工作。

## 功能特性

- **8 种工作流**: `dev` / `fix` / `audit` / `analyze` / `self-fix` / `resume` / `plan` / `chat`
- **2 种模式**: 确认模式（@DevCodex）/ 全自动模式（@DevCodex Auto，Auto v1.1 仅对显式 `@devcodex-auto` + 白名单路径提供硬保证）
- **合规管线**: FC（形式合规）→ SC（实质合规）→ RC（恢复性检查）→ T（任务完成验证）
- **持久记忆**: 每 Agent、每日的会话记录，结构化字段
- **自动报告**: 每次会话自动写入报告，从不询问 — 直接执行
- **安全底线**: S01~S07 七条不可覆盖的安全规则
- **宿主硬门禁**: 在 VS Code Hooks 可用时，通过 `UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `PreCompact` / `Stop` 提供确定性护栏
- **全模式入口检查**: 所有模式在实质任务前显示 PC0~PC7；dev 模式额外执行 PC4 规范雷达与完整合规链
- **项目现实扩展**: 先做语义意图初判，再结合目标项目 Profile、目录与当前任务上下文修正最终路由、产物落点和验证方式
- **执行护栏**: 新需求切换时优先按意图判断边界；涉及外部平台/API/兼容性判断时优先看官方文档；提交时压缩 commit subject

## 安装

### 1. 配置 GitHub Packages 认证

```bash
# 创建 .npmrc（推荐使用环境变量注入 GitHub PAT，避免把 token 写入仓库或本地文件）
echo "@vextjs:registry=https://npm.pkg.github.com" >> .npmrc
echo "//npm.pkg.github.com/:_authToken=\${NODE_AUTH_TOKEN}" >> .npmrc
```

```bash
# 当前 shell 注入 PAT（需具备 read:packages；发布时还需 write:packages）
export NODE_AUTH_TOKEN=YOUR_GITHUB_PAT
```

这里的环境变量仅用于 GitHub Packages 认证密钥，不代表项目里的普通配置默认都应 env 化；非敏感、本地、测试或一次性脚本配置优先保持最简单、可直接读懂的写法。

### 2. 安装并初始化

```bash
npm install @vextjs/devcodex
npx devcodex init          # Copilot
npx devcodex init --claude # Claude Code
```

`init` 会将规范文件复制到项目的 `.github/` 目录：

```
.github/
├── copilot-instructions.md  ← 默认 Copilot always-on 总则（新增）
├── instructions/   ← Instructions 约束（12 个，含全部工作流规则）
├── agents/         ← Copilot 自定义 Agent（v1.9.8 起恢复默认分发）
├── skills/         ← Skill 详细检查标准（35 个，按需读取）
├── prompts/        ← Prompt 模板（26 个）
├── hooks/          ← 宿主生命周期 Hook 配置与运行时
│   ├── devcodex.lifecycle.json
│   └── _runtime/
├── data/           ← 运行时数据模板
└── RULES.md        ← 使用入口
```

`init --claude` 会写入 `CLAUDE.md`、`.claude/{instructions,skills,prompts,hooks/_runtime,mcp,data}` 与 `.mcp.json`，并同步开启项目级 hooks / MCP / permissions 配置。

> ⚠️ 请确保 IDE 的 "Use Instruction Files" 设置已开启（默认开启）。
>
> ℹ️ VS Code 中若启用 Hooks（Preview）且未被管理员禁用，DevCodex 会同时加载 `.github/hooks/*.json` 作为确定性生命周期护栏；不支持 Hooks 的宿主自动回退到 instruction-fallback。
>
> ℹ️ `v1.9.8` 起，`devcodex init/update` 已恢复 Copilot 端 `.github/agents/` 默认分发；Claude Code 端仍通过 Skills 路由，不分发 agents。

## 使用

标准安装后，Copilot 会通过 `copilot-instructions.md` + `.github/` 自动加载；Claude Code 会通过 `CLAUDE.md` + `.claude/` + `.mcp.json` 自动生效。两条正式主支持链都无需额外选择 Agent，直接对话即可：

```
帮我重构 user 模块的权限校验逻辑
→ 自动识别为 dev 工作流 → CP1 需求确认 → CP2 方案确认 → CP3 实施计划 → 执行 → 轻量复审收敛 → 完成

这个接口返回 500 了
→ 自动识别为 fix 工作流 → 根因分析 → 修复方案 → 执行 → 三步扫描 → 轻量复审收敛 → 完成

深度审查一下这个项目的代码质量
→ 自动识别为 audit 工作流 → 多轮收敛审查 → 输出报告
```

标准安装路径下，无需也不依赖 `@DevCodex`；`.github/agents/` 作为 Copilot 端可选显式入口随默认安装分发。`v1.9.0` 起，Hook 运行时也随 `init/update` / `init --claude` 分发到目标项目，不再要求从 `node_modules/@vextjs/devcodex/...` 读取 Hook 脚本。

## 正式需求与执行模板边界

当前仓库的正式需求信源是 `website/docs/versions/v1/<active-version>/requirements/`，版本内的 `index/design/plan/progress/decisions` 都以这里为准。

`prompts/*.prompt.md` 不是当前项目的正式需求入口，而是 CP1 / CP2 / CP3 的默认执行模板：它们负责约束 AI 如何生成需求概述、技术方案、实施计划与实施进度。若项目已经定义自定义 requirement 规范，则项目规范优先，prompt 只提供通用骨架。

默认职责边界如下：

- CP1：确认需求目标、用户交互、业务流程、验收结果与范围边界
- CP2：确认实现流程、节点职责、公共契约、兼容性策略、边界问题与测试策略
- CP3：确认实施顺序、里程碑、验证方式、风险与回滚
- 执行后正式阶段：轻量复审收敛（确认实现、关键产物与完成结论一致）

当需求属于契约驱动型场景（例如对外 API、前端联调接口、页面/组件契约）时，可在 CP2 前先冻结目标文档，再让技术方案与实施围绕该文档落地。

文档能力边界如下：

- 轻量 API 文档：给调用方看的阅读型接口说明
- 前端接口文档：给前端联调使用的接口说明，额外包含页面/模块/前置条件与字段映射
- `api-verification`：给开发与回归使用的归档级接口验证双产物（`.http + .cjs`）

## 默认执行原则

- **意图优先**：当用户看起来切到新需求时，先基于上下文判断意图；只有意图不清晰时才用关键词辅助，而不是反过来。
- **入口检查全模式显示**：无论 `prod` 还是 `dev`，都会先展示 PC0~PC7；`prod` 只显示基础状态，`dev` 追加规范雷达、合规检查和完成验证。
- **项目现实扩展再路由**：识别用户意图后，会先加载目标项目 Profile，并用项目技术栈、目录结构、当前需求上下文修正最终工作流，避免只按字面关键词执行。
- **边界先确认**：若已判断为新需求切换，且当前工作区还有未提交变更，会先提醒是否应先提交当前变更。
- **高联动默认联查**：当任务涉及控制面规则、模板、接口契约/验证产物、工作区真相源/部署副本或发布口径变更时，会默认联查相关文件；若同时命中多真相源同步或模板-示例-校验链，会升级为交叉验证或 `CRS`。
- **官方资料优先**：涉及平台能力、框架 API、版本兼容性或工具语义判断时，优先读取官方文档，再降级到其他资料。
- **提交标题收短**：用户要求提交时，DevCodex 会优先生成一句简洁的 commit subject，而不是把整段会话摘要塞进标题。


## CLI 命令

| 命令 | 说明 |
|------|------|
| `devcodex init` | 初始化：复制 Copilot 规范文件到 `.github/` |
| `devcodex init --claude` | 初始化：复制 Claude Code 规范文件到 `CLAUDE.md`、`.claude/` 与 `.mcp.json` |
| `devcodex update` | 更新：同步最新规范到 `.github/` |
| `devcodex migrate-layout plan` | 生成 `.devcodex` 工作区集中布局迁移清单 |
| `devcodex migrate-layout apply --manifest <path>` | 按 manifest 执行集中布局切换 |
| `devcodex migrate-layout rollback --manifest <path>` | 回滚集中布局迁移 |
| `devcodex status` | 状态：检查已安装的组件 |
| `devcodex init --dry-run` | 预览模式：仅显示将复制的文件 |

## `.devcodex` 工作区集中布局（v1.9.14+）

当工作区根存在 `<workspace>/.devcodex/layout.json` 且 `mode = workspace-namespace` 时，DevCodex 会从“项目根各自持有 `.devcodex`”切换到集中命名空间模型：

- 单项目任务：写入 `<workspace>/.devcodex/<project>/...`
- 全工作区任务：写入 `<workspace>/.devcodex/workspace/...`
- `config.json`：`workspace/profile` 作为 base，`<project>/profile` 作为 overlay
- Profile 文档：项目命名空间文件优先，缺失回退到 `workspace/profile`

配套 CLI：

```bash
devcodex migrate-layout plan
devcodex migrate-layout apply --manifest <manifest-path>
devcodex migrate-layout rollback --manifest <manifest-path>
```

> 真相源说明：只有在 `layout.json` 已创建后，runtime / MCP 才会按 `.devcodex/workspace` 和 `.devcodex/<project>` 解析；未启用时继续兼容旧的 `<project>/.devcodex/`。

## 本地开发

```bash
# 克隆仓库
git clone https://github.com/vextjs/devcodex.git
cd devcodex
```

### 在目标项目中测试 CLI

```bash
# 方式一：直接用 node 运行（推荐，无需 link）
cd /path/to/your-project
node /path/to/devcodex/index.js init --force

# 方式二：npm link
cd /path/to/devcodex
npm link
cd /path/to/your-project
devcodex init --force
```

### 验证安装

```bash
# 检查初始化后的文件结构
node /path/to/devcodex/index.js status

# 预期输出：
#   skills         X files
#   instructions   X files
#   prompts        X files
#   hooks          X files
#   data           X files
#   RULES.md       installed
#   copilot-instr  installed
#   legacy-agents  not installed   # 若有历史残留会显示 N files (legacy)
```

### 在 IDE 中验证规则自动生效

1. 在目标项目执行 `devcodex init`（将文件复制到 `.github/`）
2. 重启 IDE
3. Copilot：直接在 Copilot Chat 中输入普通需求，确认无需 `@DevCodex` 也会按规则工作
4. Claude Code：执行 `devcodex init --claude` 后，新开会话并确认 `CLAUDE.md`、`.claude/settings.json`、`.mcp.json` 已生效
5. 若在 VS Code 中启用了 Hooks，可在输出面板检查 `GitHub Copilot Chat Hooks`，确认 `.github/hooks/devcodex.lifecycle.json` 已被加载

### 文档站本地预览

```bash
cd website
npm install
npm run dev
# 浏览器打开 http://localhost:3000/devcodex/
```

## 架构概览

```
devcodex/
├── instructions.md # 单源规范文件；安装时按平台生成 copilot-instructions.md / CLAUDE.md
├── agents/        # Agent 源文件；Copilot 端默认分发，Claude Code 端不分发
├── instructions/  # 全局 Instructions（12 个，含工作流规则摘要，自动注入）
├── skills/        # Skill 详细检查标准（35 个，按 01-common §按需读取表 路由读取）
├── prompts/       # Prompt 模板（26 个）
├── hooks/         # Workspace Hooks 配置与分发到 `.github/hooks/_runtime/` 的运行时
├── data/          # 运行时数据模板（分发到目标项目的空骨架）
│   ├── README.md
│   └── templates/ # 空模板：violations / pending-fixes / pending-issues / process-improvements / gap-registry
├── index.js       # CLI 入口（零依赖）
└── plugin.json    # 插件元数据
```

&gt; ℹ️ 维护者状态文件（本仓库开发过程中累积的 violations/pending-fixes 记录）保存在 `.devcodex/.maintainer-state/`，**不分发**给用户。

## 客户端支持矩阵（Client Support Matrix）

| AI 客户端 | 注入路径 | Bootstrap 硬门禁 | CP 门控 | 记忆/MCP | 等级 |
|---|---|:---:|:---:|:---:|:---:|
| **GitHub Copilot (VS Code)** | `.github/instructions/*.md` + `copilot-instructions.md` + hooks | ✅ `lifecycle.cjs` PreToolUse | ✅ Hook | ✅ MCP | 🟢 Full |
| **GitHub Copilot (JetBrains)** | 同上但无 hooks（instruction-fallback） | ⚠️ 仅文本约束 | ⚠️ 仅文本 | ⚠️ 部分 | 🟡 Beta |
| **Claude Code (CLI/桌面端)** | `CLAUDE.md` + `.claude/{instructions,skills,prompts,hooks/_runtime,mcp}/` + `settings.json` hooks + `.mcp.json` | ✅ `lifecycle.cjs` v1.9.2+ | ✅ Hook | ✅ MCP | 🟢 Full |
| **Cursor IDE** | 通过 `.github/instructions/` 兼容读取（实测） | ❌ 不支持 hooks | ⚠️ 仅文本 | ❌ | 🟡 Best-effort |
| **ChatGPT / OpenAI Codex** | ❌ 无官方适配路径 | ❌ | ❌ | ❌ | 🔴 Unsupported |

> **安装命令**：Copilot → `npx devcodex init`；Claude Code → `npx devcodex init --claude`（v1.9.0+）；Codex → 暂无（如需要可手工复制 `prompts/` 模板使用，但无记忆/合规自动化）。
>
> **能力差异**：🟢 Full = 硬门禁 + MCP + 自动同步；🟡 Beta/Best-effort = 仅 instruction 注入，无运行时拦截；🔴 Unsupported = 不在当前发布范围。

## IDE 兼容性

> v1.9.6+ 与上方"客户端支持矩阵"语义对齐：✅=自动加载且经实测；⚠️=加载但能力降级或未实测；❌=不支持。Hooks 列与客户端矩阵的 "Bootstrap 硬门禁" 一致。

| 功能 | VS Code | JetBrains | Visual Studio | Xcode | Eclipse |
|------|:-------:|:---------:|:------------:|:-----:|:-------:|
| `copilot-instructions.md` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `instructions/*.instructions.md` | ✅ | ⚠️ 实测中 | ✅ | ❌ | ❌ |
| `hooks/*.json` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `agents/*.agent.md` | ✅ | ⚠️ legacy | ❌ | ❌ | ❌ |
| `skills/*/SKILL.md` | ✅ | ⚠️ 实测中 | ❌ | ❌ | ❌ |
| `prompts/*.prompt.md` | ✅ | ✅ | ✅ | ❌ | ❌ |

> JetBrains 的 path-specific instructions / agents / skills 已实测确认可用（WebStorm 2026）；Workspace Hooks 当前按 VS Code Hooks Preview 能力建模。


## 文档

完整文档: [devcodex.dev](https://devcodex.dev)

## 边界声明

**DevCodex 适合用于**：
- 团队/个人需要在多项目之间统一 AI 开发工作流
- 希望 Copilot 或 Claude Code 在 dev / fix / audit 场景下遵守一致的 CP 门控、合规检查与报告产出
- 需要持久化会话记忆、规范自修复机制（PC4）的协作流程

**DevCodex 不适合用于**：
- 单次、一次性、无需规范约束的快速原型场景
- 当前不在正式支持矩阵中的客户端/宿主（见 §客户端支持矩阵）
- 对 `.github/` / `.claude/` 目录有其他强约束、无法接受 DevCodex 写入的项目

**前置条件**：
- Node.js ≥ 18（CLI 零依赖，仅使用标准库）
- 已启用目标宿主的规则加载能力（Copilot `Use Instruction Files` / Claude Code 标准项目规则加载）
- Copilot 路径：已安装支持的 GitHub Copilot IDE（VS Code / JetBrains 全量支持；Visual Studio / Xcode / Eclipse 部分支持，详见 §IDE 兼容性）
- Claude Code 路径：允许项目级 hooks 与 MCP（`init --claude` 会写入默认配置）

## Tier 说明

DevCodex 的 `plugin.json` 声明 `tier: "free"`，所有 Skill 均标注 `tier: "free"`。这些 tier 字段是**面向未来的 prompt-level 声明**（供 `token-check` Skill 在 Agent 侧做软门控），**CLI 不做任何授权校验**：

- `npm install @vextjs/devcodex` 与 `devcodex init/update/status` 对所有用户完全开放
- 未来接入服务端 token 校验时，tier 字段才会生效
- 当前阶段 tier 仅作为规划信息，不影响功能使用

## Agent 入口

仓库内保留两个 Agent 文件（`agents/devcodex.agent.md`、`agents/devcodex-auto.agent.md`）供 IDE 直接调用；`v1.9.8` 起 Copilot 端默认安装会同步到 `.github/agents/`，Claude Code 端仍不分发 agents。标准使用路径是：

- **推荐**：通过 `copilot-instructions.md` + `instructions/` 自动注入，直接在 Copilot Chat 对话即可
- **可选**：通过 `.github/agents/` 使用 `@devcodex` / `@devcodex-auto` 自定义 Agent 入口

Auto v1.1 当前只在支持 Hook 的宿主里，对显式 `@devcodex-auto` 入口下的白名单路径提供 runtime 级硬保证；JetBrains 等 `instruction-fallback` 宿主仅同步规则语义，不承诺完全等价的自动放行。

## 许可证

AGPL-3.0-or-later © Rocky / [vextjs](https://github.com/vextjs)
