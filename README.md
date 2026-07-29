# DevCodex

> 把可执行的 AI 开发流程装进 Copilot / Claude Code / Codex / Gemini / **Grok**  
> **用户级全局 adapter** + 工作区 `.devcodex` 运行态 · Hook 优先 · Instruction 回退

[![License](https://img.shields.io/badge/license-AGPL--3.0-green)](LICENSE)

> **安装真相（请先读）**  
> - **当前主路径**：从源码根 `npm install -g .` + `npm run global-adapters:apply`（未发版或要最新时用这个）。  
> - **npm 公开包** `npm install -g devcodex`：仅当你确认 registry 上的版本与本文档/源码一致时再使用；**不要**假设 npm 上一定是本仓库最新提交。  
> - 历史包名 `@vextjs/devcodex` 请卸载，避免 PATH 指到旧 CLI。

---

## DevCodex 是什么？

DevCodex 把五宿主的配置、Hooks、Skills 与指令投影写到各 AI 宿主的**用户级目录**；业务仓库里主要保留工作区运行态 **`.devcodex/`**。

它帮助 AI：

- 按意图走 `dev` / `fix` / `analyze` / `audit` 等流程  
- 在支持 Hooks 的宿主上拦截危险命令、做收口检查  
- 把报告与会话记忆落到工作区，而不是只留在聊天窗口  

**不是**通用聊天机器人，也不是替代你的业务框架。

---

## 5 分钟开始

### 1. 环境

- **Node.js**：建议 `>=18`（维护者本地文档站另需 `^20.19 || >=22.12`，见下文）  
- 装完或刷新 adapter 后，请在宿主里 **新开一轮会话**

### 2. 安装（推荐：源码全局）

在 **本仓库源码根**（含 `package.json` / `skills/` 的目录）：

```bash
npm install -g .
npm run global-adapters:apply
devcodex --version
devcodex doctor
```

Windows + Volta 若仍指向旧包：

```bash
npm uninstall -g @vextjs/devcodex
npm install -g .
```

**仅当 npm 上版本可信时：**

```bash
npm install -g devcodex
```

### 3. 打开业务项目

```bash
cd <你的业务仓库根>
devcodex init    # 只初始化工作区 .devcodex，不写全局宿主
```

再在 Codex / Claude / Copilot / Gemini / Grok 中打开该目录对话。

### 4. 验证技能是否加载（可选）

对话发送：

```text
验证技能加载
```

期望用户可见固定句：

```text
SKILL-LOAD-VERIFY-OK
```

**不会**强制正文出现 `【DevCodex 技能】…` 元行；过程看宿主时间线即可。

CLI：

```bash
devcodex skill resolve skill-load-verify
npm run test:skill-route
```

---

## 安装与刷新（必读）

| 命令 | 作用 |
|------|------|
| `npm install -g .` | **源码全局安装**（未发版/最新主路径） |
| `npm run global-adapters:apply` | 用当前包根刷新**用户级五宿主**（改 hooks/MCP 后必跑） |
| `npm install -g devcodex` | 仅 registry 版本可信时使用 |
| `devcodex init` / `update` | **只**管当前工作区 `.devcodex`，**不**写全局宿主 |
| `devcodex status` / `doctor` | 诊断安装与宿主就绪 |

规则：**改宿主配置 → `global-adapters apply`；改业务工作区 → `init`/`update`。**  
`.devcodex` 始终在项目/工作区，不会装进 npm global prefix。

`apply` 时还可能合并写入 VS Code 用户级 `mcp.json`（memory/profile MCP，若路径存在）。

---

## 常用 CLI

```bash
devcodex doctor
devcodex status
devcodex global-adapters apply
devcodex skill plan <id...>
devcodex skill resolve <id...>
devcodex grok                 # Grok Full 入口（有边界）
devcodex profile plan|init
```

完整列表：`devcodex --help`。

---

## 工作区布局（简）

```text
<workspace>/
  .devcodex/
    layout.json              # workspace-namespace
    workspace/               # 工作区 skills、DEVCODEX.md
    <project>/               # profile / reports / .memory / requirements
```

| 类型 | 路径 |
|------|------|
| 工作区 skill（W 优先） | `.devcodex/workspace/skills/<id>/SKILL.md` |
| 全局 skill（hidden） | `~/.agents/devcodex/skills/<id>/`（菜单可能不显示，仍可加载） |

**未发布源码候选**：渐进式 Skill 路由是五宿主唯一默认路由。它会在每轮建立 W + managed G 动态快照，再按 catalog → commit → stage 分页加载正文；全程使用宿主按需启动的本地 stdio MCP 子进程，不监听端口，也不需要服务端。多项目工作区尚未解析出目标时先等待 Profile plan 绑定真实项目，不会把工作区目录名当成项目创建运行态。新增或修改 `.devcodex/workspace/skills/<id>/SKILL.md` 会让旧快照失效，并在下一轮重新发现。宿主生产证据继续作为发布后的可观测性材料，不再控制源码路由模式，也不阻塞功能完成。

Codex/Claude 等宿主自己的 `AGENTS.md`、`CLAUDE.md`、原生个人/项目 Skill 仍由宿主负责发现。DevCodex 不扫描、复制、合并、覆盖或删除这些用户资产；同名也不视为 DevCodex 所有权。Codex 项目指令使用 `AGENTS.md`（不是 `codex.md`），Claude 项目指令使用精确文件名 `CLAUDE.md`，Skill 入口使用精确文件名 `SKILL.md`。

---

## 宿主能力（诚实上限）

| 宿主 | 大致能力 |
|------|----------|
| Claude Code / Codex / Copilot CLI 等 | Hook 较完整时可硬拦危险命令、Stop 收口 |
| **Grok** | **Partial enforcement**：UserPromptSubmit 不能可靠注入完整入口块；`devcodex grok` 仍使用统一 local-stdio Skill 路由，但当前精确 variant direct evidence 为 UNVERIFIED，不据此声称与 Codex 的宿主观察能力等价 |
| 仅 Instruction 的 surface | 语义约束，不保证硬拦 |

「adapter 已安装」≠「五宿主能力完全一致」。

---

## 语言策略（约定，非绝对保证）

| 项 | 约定 |
|----|------|
| 对话回复 | **目标**跟随用户语言 |
| 工作区过程产物文件名 | 默认 **中文** 标准名（如 `00-需求概况.md`） |
| 完整多语言 i18n / 中英产物双文件名 | **本阶段未承诺** |

---

## 你能感知到的默认行为

- **确认优先**：大改动、发版、危险命令前应得到确认（Auto 另有白名单边界）  
- **危险命令**：可被 Hook 拦截  
- **入口检查**：实质任务前尽量有 PC0～PC7（视宿主能力）  
- **报告与记忆**：非闲聊任务写入工作区  

Gate/探针编号是维护者资产，日常使用不必背。

---

## 技能加载

1. 最终回复 **不强制** 技能元行  
2. 过程侧可用「正在加载 `<id>` 技能」  
3. **不要** List `~/.grok/skills` 等主目录 skill 树（会暴露本机路径）；只读单个已知 `SKILL.md`  
4. 验证：对话「验证技能加载」或上文 CLI  

---

## 架构一览

```text
npm 全局包 / 源码 install -g
  → 用户级：宿主 hooks / instructions / skills 投影 / VS Code mcp.json（apply）
  → 工作区：.devcodex（profile、reports、memory、requirements、workspace skills）
  → 运行时：hooks/_runtime/lifecycle.cjs + MCP memory/profile
```

---

## 边界

- 默认 **safety-only**：危险命令硬拦；流程项多为提醒，**strict** 才全面升级阻断  
- **不**替代业务 CI、安全审计与人工评审  
- Grok 等存在 **Partial** 上限  
- 敏感信息：以项目与你的要求为准；未禁止时不强制脱敏  

---

## 文档与仓库边界

| 内容 | 位置 |
|------|------|
| **用户文档** | 本 README（公开仓主入口） |
| **维护者文档站** `website/` | **默认不进公开 Git 跟踪**、**不进 npm**；本机可保留完整拷贝（见 `website/README.md`） |
| 未发布变更 | `changelogs/unreleased.md` |
| 已发布说明 | `changelogs/releases/` |

---

## 本地开发（贡献者）

```bash
cd <devcodex-source-root>
npm install
npm run test:stop-gate
npm run test:docs-surface-inventory
npm run test:skill-route
npm run global-adapters:apply
```

维护者文档站（需本机已有完整 `website/`）：

```bash
cd website && npm install && npm run dev
```

Node：`^20.19 || >=22.12`（仅文档站）。

---

## 许可证

[AGPL-3.0](LICENSE)

---

## 用户可见交付与链接兼容

用户可见交付物应带可定位路径（工作区相对路径优先）；宿主证据不足时用 portable 链接，不假装全宿主可点。  
MCP 侧先用 `profile_context_plan` 生成有界计划，再由 `profile_load` 完成选定正文；记忆侧先用 `memory_status` 定位，再按需查询。完成状态以绑定的 `ContextReadReceiptV2` 为准，V1 receipt 只作兼容读取。工作流技能按意图 **invoke**（按需读取，非整库预载）。
用户侧文档 review 聚合见 skill `audit-user-manual`。  
规范侧：`PromptLongGateListDriftProbe`（V75）。

## 维护者备注

- 公开仓：`website/*` 忽略，仅跟踪 `website/README.md` 指针。  
- 过程 ECR 等常在工作区 `.devcodex/`（运行态，默认不进本 npm 包）。  
