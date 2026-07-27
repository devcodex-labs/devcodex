# DevCodex

> 把可执行的 AI 开发流程装进 Copilot / Claude Code / Codex / Gemini / **Grok**  
> **用户级全局 adapter** + 工作区 `.devcodex` 运行态 · Hook 优先 · Instruction 回退

[![npm](https://img.shields.io/npm/v/devcodex.svg)](https://www.npmjs.com/package/devcodex)
[![License](https://img.shields.io/badge/license-AGPL--3.0-green)](LICENSE)

---

## DevCodex 是什么？

DevCodex 通过 **npm 全局安装**（或源码 `npm install -g .`）把五宿主的配置、Hooks、Skills 与指令投影写到各 AI 宿主的**用户级目录**；你的业务仓库里只需要工作区运行态 **`.devcodex/`**。

它帮助 AI：

- 按意图走 `dev` / `fix` / `analyze` / `audit` 等流程  
- 在支持 Hooks 的宿主上拦截危险命令、补全收口检查  
- 把报告与会话记忆落到工作区，而不是只留在聊天窗口  

**不是**通用聊天机器人，也不是替代你的业务框架。

---

## 5 分钟开始

### 1. 安装

**已发布到 npm 时：**

```bash
npm install -g devcodex
```

**当前若以源码为准（未发版或需最新）：**

```bash
git clone <本仓库>
cd devcodex
npm install -g .
npm run global-adapters:apply
```

> Windows + Volta：若 PATH 上仍是旧包 `@vextjs/devcodex`，请先 `npm uninstall -g @vextjs/devcodex` 再装。

验证：

```bash
devcodex --version
devcodex doctor
```

### 2. 打开业务项目

在业务仓库根目录（或 monorepo 工作区根）：

```bash
devcodex init          # 仅初始化工作区 .devcodex（不写全局宿主）
```

然后在 **已配置好的宿主**（Codex / Claude / Copilot / Gemini / Grok）中打开该目录开始对话。

### 3. 验证技能是否加载（可选）

对话中发送：

```text
验证技能加载
```

期望回复中出现固定句：

```text
SKILL-LOAD-VERIFY-OK
```

说明全局验证 skill 可读。  
**不会**强制在正文显示 `【DevCodex 技能】…` 元信息行；加载过程看宿主时间线即可。

CLI 等价：

```bash
devcodex skill intent "验证技能加载" --json
devcodex skill resolve skill-load-verify
```

---

## 安装与刷新（重要）

| 命令 | 作用 |
|------|------|
| `npm install -g devcodex` | 全局安装；postinstall 可刷新用户级宿主 adapter |
| `npm install -g .` | 从**源码根**装全局（未发版时的主路径） |
| `npm run global-adapters:apply` | 用当前包根刷新五宿主用户级配置（不发版） |
| `devcodex init` / `devcodex update` | **只**管当前工作区 `.devcodex`，**不**写全局宿主 |
| `devcodex status` / `doctor` | 诊断安装与宿主就绪度 |

`.devcodex` **不会**装到 npm global prefix；始终在你的项目/工作区里。

---

## 常用 CLI

```bash
devcodex doctor
devcodex status
devcodex global-adapters apply
devcodex skill plan <id...>
devcodex skill resolve <id...>
devcodex skill match "<prompt>"
devcodex skill intent "<prompt>" [--json]
devcodex grok                    # Grok Full 入口（有边界）
devcodex profile plan|init
```

完整列表：`devcodex --help`。

---

## 工作区布局（简）

```text
<workspace>/
  .devcodex/
    layout.json                 # workspace-namespace
    workspace/                  # 工作区级入口、skills、DEVCODEX.md
    <project>/                  # 项目命名空间：profile / reports / .memory / requirements
```

- **工作区 skill**：`.devcodex/workspace/skills/<id>/SKILL.md`（W 优先）  
- **全局 skill（hidden）**：`~/.agents/devcodex/skills/<id>/`（UI 菜单可能不显示，仍可 resolve/加载）  

---

## 宿主能力（诚实上限）

| 宿主 | 大致能力 |
|------|----------|
| Claude Code / Codex / Copilot CLI 等 | Hook 较完整时可硬拦危险命令、Stop 收口 |
| **Grok** | **Partial**：UserPromptSubmit **不能**可靠注入上下文；依赖模型读 skill + 条件 Stop |
| 仅 Instruction 的 surface | 语义约束，不保证硬拦 |

不要把「adapter 已安装」理解成「五宿主能力完全一致」。

---

## 语言策略（诚实声明）

| 项 | 当前约定 |
|----|----------|
| **对话回复** | 跟随用户语言 |
| **工作区过程产物文件名** | 默认 **中文** 标准名（如 `00-需求概况.md`） |
| **完整多语言 i18n / 中英产物双文件名** | **未承诺**本阶段交付 |

---

## 默认执行原则（用户能感知的）

- **确认优先**：大改动、发版、危险命令前应得到你的确认（Auto 模式另有白名单边界）  
- **危险命令**：可被 Hook 拦截（如 `rm -rf` 根路径等）  
- **入口检查**：实质任务前可见 PC0～PC7 状态块（宿主能力允许时）  
- **报告与记忆**：非闲聊任务会写入工作区报告 / 会话记忆  

细节 Gate 名与探针编号是维护者资产；**日常使用不必背**。

---

## 技能加载说明

1. **最终回复**不强制技能元行。  
2. **过程时间线**可出现「正在加载 &lt;id&gt; 技能」。  
3. 不要 List `~/.grok/skills` 等用户主目录 skill 树（会暴露本机路径）；只读单个已知 `SKILL.md`。  
4. 验证：对话「验证技能加载」或见上文 CLI。

---

## 文档与仓库边界

| 内容 | 在哪里 |
|------|--------|
| **用户文档** | 本 **README**（公开仓主入口） |
| **维护者文档站** `website/` | **不进入公开 Git 默认跟踪**、**不进 npm 包**；本机可保留完整拷贝 |
| 变更未发布说明 | `changelogs/unreleased.md` |
| 已发布说明 | `changelogs/releases/` |

npm 包 `files` 字段**不包含** `website/`。

---

## 本地开发（贡献者）

```bash
git clone <repo>
cd devcodex
npm install
npm run test:stop-gate
npm run test:docs-surface-inventory
npm run global-adapters:apply   # 刷新本机五宿主
```

维护者若需文档站：在已有完整 `website/` 的本机目录执行 `cd website && npm install && npm run dev`（Rspress；Node `^20.19 || >=22.12`）。

---

## 架构一览

```text
npm 全局包 / 源码 install -g
  → 用户级：各宿主 hooks / instructions / skills 投影 / VS Code mcp.json（apply 时）
  → 工作区：.devcodex（profile、reports、memory、requirements、workspace skills）
  → 运行时：hooks/_runtime/lifecycle.cjs + MCP memory/profile
```

---

## 边界声明

- 默认 **safety-only**：危险命令硬拦；流程类多为提醒，**strict** 才全面升级阻断。  
- **不**替代业务项目的 CI、安全审计与人工评审。  
- Grok 等宿主存在 **Partial** 能力上限，见上文矩阵。  
- 敏感信息策略以项目与用户要求为准；未禁止时不强制脱敏。

---

## 许可证

[AGPL-3.0](LICENSE)

---

## 用户可见交付与链接兼容

用户可见交付物应带可定位路径（工作区相对路径优先）；宿主证据不足时用 portable 链接，不假装全宿主可点。  
MCP 侧常见入口含 `profile_load`；工作流技能按意图 **invoke**（按需读取，非整库预载）。

用户侧文档 review 聚合见 skill `audit-user-manual`（文档站/README/quick start 路径审查）。  
规范侧防 prompt 长 Gate 清单回流：`PromptLongGateListDriftProbe`（V75）。

## 维护者备注（非用户路径）

- 公开仓策略：**website 内容默认不跟踪**（仅 `website/README.md` 指针）。  
- 过程关账 ECR 示例：工作区 `.devcodex/devcodex/reports/requirements/…`（运行态，默认不进本包）。  
- 未发布变更见 `changelogs/unreleased.md`。
