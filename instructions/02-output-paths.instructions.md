---
applyTo: "**"
description: 产物输出路径与命名规范，定义 active-root 下的 requirements、bugs、reports 与记忆落点
priority: P5
version: 1.11.11
---
# 产物输出路径规范

> 🔴 所有路径以当前 **`<active-root>`** 为根，与源码目录天然隔离。
> 🔴 `<active-root>` 取值：
> - 旧布局：`<项目根>/.devcodex/`
> - 集中布局单项目：`<工作区根>/.devcodex/<project>/`
> - 集中布局全工作区：`<工作区根>/.devcodex/workspace/`
> 🔴 当 `<工作区根>/.devcodex/layout.json` 启用 `workspace-namespace` 时，进入集中布局；不存在时保持旧布局兼容。
> 🔴 禁止在当前 active namespace 根下创建规范路径之外的一级目录。
> ⚠️ `init` 命令自动将 `.devcodex/.memory/` 加入 `.gitignore`；`requirements/`、`bugs/`、`reports/` 等产物目录按需提交。

## 语言规则

> 目录名（`<描述>`）和产物文件名以**用户输入的主要语言**为准。下方示例使用中文；英文用户应使用对应英文命名（如 `requirements/add-login-feature/` → `01-requirements.md`）。语言检测规则见 [`00-safety.instructions.md`](./00-safety.instructions.md) §输出语言规则。

## 路径映射说明（v4 ↔ v1）

| 项目 | v4（历史 `ai-dev-guidelines/version/v4/specs/output-paths.md` 规范）| v1（本文件）|
|------|------------|---------|
| 产物根 | `projects/<project>/` | `<active-root>/` |
| 记忆根 | `projects/<project>/.ai-memory/` | `<active-root>/.memory/` |
| 需求级记忆 | `<需求>/.ai-memory/sessions.md` | `<需求>/.memory/sessions.md` |
| Agent SUMMARY | `.ai-memory/clients/<agent>/SUMMARY.md` | `.memory/clients/<agent>/SUMMARY.md` |

> 两者**内部结构完全一致**（`clients/<agent>/tasks/YYYYMMDD.md`），差别仅在根路径。v1 采用 `.devcodex/` 统一伞下路径，v4 使用独立 `.ai-memory/` 根。

## 目录结构

```text
<active-root>/
├── requirements/<中文描述>/          # 需求产物（dev 默认）
│   ├── 01-需求概述.md               # 🔴 强制
│   ├── 02-技术方案.md               # ⚠️ 条件（有架构/接口/设计决策时）
│   ├── 实施方案/                    # ⚠️ 条件（多子模块/多阶段实施时，CP2 确认后创建）
│   │   └── *.md                     #   各子模块/阶段实施细节，不含时间线
│   ├── services/                    # ⚠️ 条件（跨服务需求，涉及 ≥2 个服务时，CP2 后创建）
│   │   ├── <入口服务>/              #   入口服务自身的实施细节
│   │   │   └── 实施方案.md          #   📎 头部须含反向引用：> 上级需求: [需求名](../../01-需求概述.md)
│   │   └── <关联服务>/             #   每个关联服务独立子目录
│   │       └── 实施方案.md
│   ├── 04-实施计划.md               # 🔴 强制（轻计划摘要 / 完整实施计划两档）
│   ├── 05-实施进度.md               # ⚠️ 条件/强触发（跨轮次、多批次、≥10 文件、阻塞、用户要求跟踪时）
│   ├── scripts/                     # ⚠️ 条件（有辅助脚本时，可提交）
│   │   └── <用途>.js / <用途>.sh    #   数据迁移/数据填充等共享辅助脚本；默认禁止放业务逻辑或网络请求
│   ├── *-接口验证.http              # 🔴 强制（有接口变更时）
│   ├── *-接口验证.cjs               # 🔴 强制（有接口变更时）
│   ├── .memory/sessions.md       # 🔴 强制（需求级记忆）
│   ├── .tmp/                        # 临时文件（.gitignore 排除，可放仅本地执行的一次性脚本/配置）
│   └── reports/<agent>/YYYYMMDD/    # 🔴 强制（需求级报告）
├── bugs/<中文描述>/                  # Bug 修复产物（fix）
├── optimizations/<中文描述>/         # 优化产物（dev > 性能优化）
├── migrations/                        # 数据库迁移脚本
├── scenario-tests/<中文描述>/        # 场景测试产物
├── reports/<子目录>/<agent>/YYYYMMDD/ # 全局报告（NN--<简述>.md）
├── .memory/clients/<agent>/tasks/YYYYMMDD.md  # 记忆（.gitignore 排除）
├── profile/README.md                  # 项目规范（可提交）
├── TASK-INDEX.md                      # 任务索引
└── README.md
```

## 目录规则

| 规则 | 说明 |
|------|------|
| **目录命名** | `<中文描述>` 必须描述本任务的目标，禁止复用其他任务的目录 |
| **任务隔离** | 每个 `<中文描述>/` 目录只服务一个明确任务 |
| **禁止非规范路径** | 当前 active namespace 根下只允许上述目录树中的一级目录 |
| **scripts/ 触发条件** | 任务目录（requirements/<任务>/ 或 bugs/<任务>/）下有共享辅助脚本（数据迁移/数据填充/自动化验证等）时创建对应 `scripts/` 子目录；默认禁止放入业务逻辑或网络请求。`*-接口验证.cjs` 属规范强制产物，存放任务根目录（非 scripts/）|
| **本地临时脚本豁免** | 仅本地执行、不会提交发布链路的临时脚本/配置可放入任务目录 `.tmp/local-scripts/` 或保持未提交；允许直接使用局部常量、敏感信息和网络请求，但不得伪装成共享正式产物 |
| **services/ 触发条件（跨服务）** | 需求涉及 ≥2 个服务时在 CP2 后创建；每个 `实施方案.md` 头部**必须**包含反向引用 `> 📎 上级需求：[需求名](../../01-需求概述.md)（入口服务：<服务名>）`；**禁止**各服务各自单独建 `requirements/<需求名>/` 目录（碎片化） |
| **04-实施计划 计划层级** | 默认创建 `04-实施计划.md`；小到中型任务可使用“轻计划摘要”，高风险 / 多模块 / 接口或 Schema 变更 / 跨轮次任务使用“完整实施计划” |
| **05-实施进度 触发条件** | 小任务不默认创建；当任务跨 2 轮以上会话、存在明确阻塞、用户要求持续跟踪、CP3 计划拆成多批次、预计修改 ≥10 文件，或命中控制面/模板/validate/部署副本联动时必须创建并持续更新，且前提是已存在 `04-实施计划.md` |
| **禁止写入源码目录** | 脚本/测试/辅助文件严禁放入项目源码目录 |
| **强制产物首轮完成** | 01/04 在首轮会话结束前必须创建；其中 `04-实施计划.md` 可按轻计划摘要 / 完整实施计划两档落地；02-技术方案.md 和 实施方案/ 按条件触发；services/ 在 CP2 后按需创建；强触发条件命中时 `05-实施进度.md` 必须在执行前初始化 |
| **需求归档（v1.9.3+）** | 已完成且不再活跃的需求目录下创建空文件 `.archived`；CP gate 扫描跳过含此标记的需求，避免历史需求全局阻断 dev 工作流 |

## 报告路径

```text
reports/<子目录>/<agent>/YYYYMMDD/NN--<简述>.md
```

- 子目录：`analysis/` · `audit/` · `self-fix/` · `bugs/` · `requirements/` · `optimizations/` · `scenario-tests/`
- `NN`：当日序号，从 `01` 起递增
- `--`：双横杠分隔序号与简述

> ℹ️ **路径目录 `YYYYMMDD` 保持天级**（避免同天多报告产生过多子目录）；**报告头部"创建日期"使用分钟级 `YYYY-MM-DD HH:MM`**（便于跨会话定位）；`fix.incident` 子类型的报告须含 `事件时间: YYYY-MM-DD HH:MM:SS` 字段（响应时效审计，参见 `prompts/report-fix.prompt.md`）。

## 记忆路径

```text
<active-root>/.memory/clients/<agent>/tasks/YYYYMMDD.md
```

每天一个文件，文件内以 `## 会话 NN` 分段。

## 产物路径输出格式

每轮回复中涉及文件新建或修改时，在回复末尾输出：

```
📂 本次会话产物：
- [文件名（类型）](workspace相对路径/file.md)
```

> 🔴 **格式说明**：
> - **必需行**：输出 `ArtifactLinkSet` 的主链接，必须是 Markdown 链接，禁止只输出裸文件名。默认使用**工作区根的相对路径**（不以 `/` 开头、不带 `file://` 协议），链接路径统一用正斜杠。
> - **Copy fallback**：当当前宿主为 Codex Desktop/App、Copilot、未知宿主，或用户已反馈“无法点击”时，主链接下一行必须追加 `绝对路径：` 纯文本行，供复制打开。Windows 绝对路径统一写成 `E:\...` 或 `E:/...`，POSIX 用 `/...`。
> - **Codex Desktop/App 特例**：当前宿主可验证为 Codex Desktop/App 时，主链接可以使用绝对文件系统路径作为 Markdown target；若路径包含空格，用尖括号包裹 target。
> - 禁止询问"是否需要打开"；禁止省略产物路径输出。
> - 禁止使用 `file://` 协议作为默认链接；它在部分 IDE webview / Chat 面板中会被 CSP 或宿主策略阻止。
> - ⚠️ **历史版本兼容**：v1.9.3 及之前使用 `[name](file:///E:/...)` 格式，存量报告无需回填，但新增报告须按本格式生成。

### ArtifactLinkSet 客户端兼容矩阵

| 宿主 | 主链接 | Copy fallback | 说明 |
|------|--------|---------------|------|
| GitHub Copilot（VS Code / JetBrains / Visual Studio）| `[文件名](.devcodex/.../file.md)` | 强制追加 | Copilot Chat 不保证所有 Markdown 文件链接在所有视图都可点；必须同时保留可复制绝对路径 |
| Claude Code | `[文件名](.devcodex/.../file.md)` | 可选；跨工具交付时追加 | Claude Code 项目级 `.mcp.json` 与文件上下文能力不等价于所有 Markdown 链接都可被其他宿主点击 |
| Codex Desktop/App | `[文件名](E:/Worker/.../file.md)` 或绝对路径 target | 强制追加 | Codex App 用户面更适合绝对本地路径；仍保留 copy fallback |
| Codex CLI | `[文件名](.devcodex/.../file.md)` | 强制追加 | 终端环境未必渲染可点击 Markdown，绝对路径是保底入口 |
| instruction-fallback / 未识别宿主 | `[文件名](.devcodex/.../file.md)` | 强制追加 | 未知宿主不得假设 Markdown 链接可点击 |

### MCP profile fallback

若 Copilot / Codex 等非 Claude Code 宿主调用 `profile_load`、`profile_get_mode` 或其他 DevCodex MCP 工具时出现 `TypeError: Cannot read properties of undefined (reading 'invoke')`、工具桥接不可用、MCP server 未连接等错误，视为**宿主 MCP bridge 失败**，不得反复重试同一 MCP 调用。AI 必须立即降级：

1. 优先通过可用文件读取能力读取 `.devcodex/**/profile/`、`SUMMARY.md` 与当日 `tasks/YYYYMMDD.md`；
2. 文件读取也不可用时，说明当前宿主只能 instruction-fallback，并请求用户提供必要上下文或运行 `devcodex doctor`；
3. 在报告或记忆中记录 `mcpFallback=used`、宿主、错误文本与最终恢复路径。

## CHANGELOG / Release 双阶段规范

### 日志分层

| 层级 | 文件 | 用途 | 默认写入时机 |
|------|------|------|-------------|
| 需求轨 | `website/docs/versions/v1/<active-version>/CHANGELOG.md` | 需求/规格变更记录 | 需求定义、需求完成、需求口径变更 |
| 未发布实现轨 | `changelogs/unreleased.md` | 尚未正式发版的实现/修复/规范变更 | 用户未明确要求 `tag` / `release` / `publish` 时 |
| 已发布轨 | 根 `CHANGELOG.md` + `changelogs/releases/vX.Y.Z.md` | 正式已发布版本索引与详细说明 | 用户明确确认 release 后 |

### 默认规则

1. 用户**未明确要求** `tag` / `release` / `publish` 时：
   - 默认只更新 `changelogs/unreleased.md`
   - 不默认 bump `package.json` / `plugin.json`
   - 不默认更新根 `CHANGELOG.md`
   - 不默认打 `git tag`
   - 不默认执行 `publish`
2. 用户**明确确认发版**时，才进入正式 release 流程。
   - 正式 release 前必须执行 `audit-release` RL-1~RL-10 与 `release-verification` R0~R7。
3. 已发布详情统一存放在 `changelogs/releases/`；旧 flat 路径 `changelogs/vX.Y.Z.md` 仅作为历史兼容说明，不再作为当前写入位置。

## Git Tag 发布规范

> 🔴 每次正式 release commit 后必须立即打 tag，禁止无 tag 的版本发布。

| 版本类型 | 是否打 Tag | Tag 格式 |
|---------|:--------:|---------|
| MAJOR | 🔴 必须 | `vX.0.0` |
| MINOR | 🔴 必须 | `vX.Y.0` |
| PATCH | 🔴 必须 | `vX.Y.Z` |

**正式发布步骤（仅在用户明确确认 release 后执行）**：

```bash
# 1. 确认最终版本号（MAJOR / MINOR / PATCH）
# 2. 将 changelogs/unreleased.md 中待发布条目归档到 changelogs/releases/vX.Y.Z.md
# 3. 更新根 CHANGELOG.md（仅正式发布时）
# 4. 更新 package.json / plugin.json 版本号
# 5. 提交变更
git commit -m "release: vX.Y.Z — <一句话摘要>"
# 6. 打 Tag（与版本号完全一致）
git tag vX.Y.Z
# 7. 推送（commit + tag 同步推送）
git push && git push origin vX.Y.Z
```

**版本号递增规则（Semver）**：
- `MAJOR`（x.0.0）— 工作流或架构破坏性变更（Breaking Change）
- `MINOR`（1.x.0）— 新增工作流、新增 Skill、新增 Instructions
- `PATCH`（1.0.x）— Bug 修复、文字修正、规范小幅改进
