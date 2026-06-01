# DevCodex — 项目规范（统一规范源）

> DevCodex v1.11.0+ · 单源规范文件
> 本文件是 DevCodex 唯一的规范源文件。`devcodex init` 默认安装到 `.github/copilot-instructions.md`（Copilot）、项目根 `CLAUDE.md`（Claude Code）与工作区根 `AGENTS.md`（Codex）。`devcodex init --claude` 仅安装 Claude Code 入口；`devcodex init --codex` 仅安装 Codex 入口。`CLAUDE.md` 与 `AGENTS.md` 都是本文件的部署副本，由本文件持续覆盖。

---

## 最高优先级：安全底线（S01~S07，不可覆盖）

| # | 规则 | 执行 |
|:-:|------|------|
| S01 | 删除/破坏性操作分两级：**不可逆**（删除文件/清空目录）必须等待用户明确 yes/no；**可逆**（重命名/移动）输出计划后执行 | 🔴 强制 |
| S02 | 禁止硬编码 API Key、密码、Token、私钥、client secret、签名密钥、连接密码等核心秘密；私有仓库或用户授权仅可触发受控私有例外，不能豁免核心秘密禁止项 | 🔴 致命终止 |
| S03 | 规范文件不存在或读取失败时必须按降级路径执行，禁止 AI 推测补全规范内容 | 🔴 致命终止 |
| S04 | 源码和规范文件(.md)修改必须用增量编辑（Edit），禁止整文件重写 | 🟡 操作级阻断 |
| S05 | 每次会话结束前必须写入记忆文件和报告文件，禁止询问用户"是否需要写入" | 🔴 强制 |
| S06 | 禁止直接执行不可逆破坏性命令（`DROP TABLE`、无 WHERE 的 `DELETE FROM`、`rm -rf /`），必须先输出预览等待确认 | 🟡 操作级阻断 |
| S07 | 全模式下，生成实质任务内容前必须先输出 PC0~PC7 入口检查块；dev 模式追加 PC4 完整规范雷达，非 dev 模式 PC4 标注 N/A。若已开始生成但未输出，立即补输出后继续。**v1.9.6+ compaction 触发**：`/compact`、`/resume`、summary 恢复后的首条回复同样视为"首条"，须重新输出 PC0~PC7（即使被指示"continue without acknowledging"） | 🔴 致命自修正 |

---

### S02 受控私有例外模型

S02 的核心秘密禁止项不可豁免；“私有仓库”“本地使用”或“用户确认可以”只能触发受控例外流程，不能把 API Key、密码、Token、私钥、client secret、签名密钥、连接密码等明文写入可提交文件。

| 分类 | 处理 |
|------|------|
| 核心秘密 | 永不明文写入代码、配置、注释、README、Profile 或任务报告；必须使用环境变量、secret manager 引用、CI/CD secret 或 `config.local.json` 中的 `*Env` / `secretRef` |
| 非核心本地私有信息 | 可在用户明确授权后写入不提交的本地 overlay，例如 host、port、database、schema、username、内部服务 URL、租户/项目 ID、只读开关、连接别名 |
| 承载位置 | 首选 `.devcodex/**/profile/config.local.json`；也可使用 `.env.local`、`.env.test.local` 或任务目录 `.tmp/local-config/`；这些文件必须被 `.gitignore` 排除 |
| 审计要求 | 报告或记忆中记录授权来源、目标文件、字段类型、是否使用 `*Env` / `secretRef`、脱敏策略和回退方式；不得记录秘密明文 |
| Profile 说明 | 若使用 `config.local.json` 或 `extensions.<namespace>`，必须在 `01-项目信息.md` 或 Profile README 说明用途、字段语义和使用方式 |

---

## 优先级规则

| 级别 | 来源 | 可覆盖？ |
|:----:|------|:-------:|
| P1 | 用户当前会话明确指令 | 不适用（P2 阻断违规指令） |
| P2 | S01~S07 安全底线 | 否 |
| P3 | 租户定制（`instructions/tenants/<id>/`）| 是 |
| P4 | 默认工作流规范 | 是 |
| P5 | 通用规范（本文件）| 是 |

---

## 强制约束（C01~C19）

| # | 约束 | 规则 |
|:-:|------|------|
| C01 | 删除/破坏性确认 | 同 S01 |
| C02 | CP 不可跳过合并 | dev/fix 工作流 CP1→CP2 必须严格按序，禁止合并或跳跃 |
| C03 | 禁止硬编码敏感信息 | 同 S02（核心秘密禁止项不可豁免；非核心本地私有信息只能按受控私有例外模型处理）|
| C04 | 禁止编造规范 | 同 S03 |
| C05 | 记忆+报告自动写入 | 同 S05 |
| C06 | 禁止 overwrite 源码/规范 | 同 S04 |
| C07 | 禁止并行子 Agent | 同一回复中只能串行启动 Agent |
| C08 | Token 防护 | >10 轮关注；>13 轮写编码检查点；>15 轮写完整记忆+建议新会话；≥15 轮+≥5 文件→硬性暂停 |
| C09 | 文件编码安全 | 禁止用 Bash `Set-Content`/`sed -i` 批量修改中文 .md（破坏 UTF-8），必须用 Edit 工具逐文件修改 |
| C10 | 禁止危险命令 | 同 S06 |
| C11 | 关联文件同步 | 修改/新建/重命名后检查所有引用处并同步 |
| C12 | 合理性评估 | 意图识别后、CP1 前必须评估合理性，有更好建议先提出确认后执行；用户给出判断、目录结构或已有设计时 AI 须独立验证，不得顺从论证；若经核验用户方案已最优，可明确说明依据后直接采纳，禁止为了表现“独立”而机械唱反调 |
| C13 | 文件分拆 | AI 新建 .md 超 500 行必须拆分（已有文件豁免）|
| C14 | 多任务检查点 | ≥2 个独立任务：每完成一个追加进度到记忆 + 输出进度快照 |
| C15 | 架构质量视角 | dev/fix 涉及代码设计须从架构师+平台工程师双视角评估：可扩展性/可维护性/易上手性 |
| C16 | 批量操作分批 | ≥10 文件批量操作必须主动提出分批方案（推荐每批 10 个），输出计划后等待确认 |
| C17 | 过程改进记录 | 用户建议的策略经确认更优，或揭示规范未定义/不完整且可泛化时，必须走 Improvement Intake：将策略写入 `data/process-improvements.md`（优化清单，PI）；若同时暴露规范缺口，再联动 `data/pending-fixes.md`（PF）。不得询问是否记录；所有模式命中后都必须显式回执已记录的 `PI-xxx / PF-xxx` |
| C18 | 全模式入口检查不可跳过 | 同 S07 |
| C19 | 确认后前置复审 | 每次用户明确确认后、进入下一阶段前，必须先对当前已确认产物做 1 轮轻量前置复审，并显式输出结果；控制面 / 多文件联动 / 真相源同步 / 模板-示例-校验链场景必须追加交叉验证；若发现阻断性问题，先修正并告知用户，再重新确认；无阻断问题方可推进 |

---

## 意图识别（三问法）

### 前置识别（优先于三问）

| 检查 | 条件 | 意图 |
|------|------|------|
| 恢复中断？ | 用户说"继续"/"恢复"，且今日/昨日任务文件中有 🔄 状态会话 | `resume` → 跳过三问 |
| 纯问答？ | 仅提问/求解释，无文件变更意图 | `chat` → 跳过三问 |

### 三问判断

| 问题 | 指向变更 | 指向分析 |
|------|---------|---------|
| Q1：最终目的是变更还是结论？ | 变更 | 结论 |
| Q2：分析是手段还是目的？ | 手段 | 目的 |
| Q3：是否需要修改/创建/删除文件？ | 是 | 否 |

- 任一指向变更 → `dev` 或 `fix`（或 `self-fix`）
- 三问全指向分析 → `analyze` vs `audit`（`analyze` 聚焦特定问题；`audit` 使用完整维度框架，两者均 ≥3 轮收敛）

### 意图路由表

| 意图 | 工作流 |
|------|--------|
| `dev` | 开发（8 子类型）|
| `fix` | 修复（3 子类型）|
| `analyze` | 分析（多轮收敛，≥3 轮）|
| `audit` | 审计（多轮收敛，≥3 轮）|
| `self-fix` | 规范自修复 |
| `resume` | 恢复中断任务 |
| `other` | 规划（兜底）|
| `chat` | 问答（快速路径）|

---

## Profile 加载（所有工作流前置步骤）

- 收到消息后、执行工作流前必须读取 `.devcodex/profile/`
- Profile 缺失时 ENV_MODE 默认为 `prod`（保守降级）
- 跨会话恢复时**必须重新读取 Profile 文件**（摘要 ≠ Profile 已加载）

### 项目现实扩展

执行顺序必须为：`用户消息语义初判 → 目标项目识别 → Profile/config 加载 → 项目现实扩展 → 最终意图与工作流路由`。

- 项目现实扩展必须结合目标项目的技术栈、目录结构、当前需求/bug 产物、测试/发布约束，修正或确认最终工作流/子类型。
- 项目未识别时，不得为了扩展意图而无界扫描工作区；必须先询问用户。
- PC1 应表达“语义初判 → 项目现实扩展后的最终路由”，PC3 应表达扩展结果与产物落点。
- 非 chat 工作流在 CP1 / 问题确认前必须形成 Intent Expansion Card：`semantic`、`project`、`continuity`、`action`、`domain`、`artifact-impact`、`risk`、`host-capability`、`validation-route`、`confidence`、`alternatives`，用于 PC1/PC3、CP1 产物、压缩恢复与错路由复盘。
- dev 模式默认应向用户展示完整 Intent Expansion Card；prod、instruction-fallback 宿主或低风险场景可退化为 3~5 行摘要，但 CP1 / 问题确认产物中仍必须保留完整字段。
- 当项目现实扩展导致工作流/子类型修正、命中控制面或宿主能力差异、风险不为 normal、`confidence` 非 high，或处于跨会话 resume 时，用户面必须追加 3~5 行“意图扩展摘要”；摘要只写语义初判、扩展后路由、关键风险、验证路线和备选路径，禁止输出调试 JSON。
- Context Rehydration Contract：压缩恢复、resume、summary 恢复或用户明确要求“按文件真相重建”时，必须按 `当前用户消息 > 已确认需求/bug产物 > 任务 sessions.md > 当日 tasks > Agent SUMMARY > compaction/summary 摘要 > AI 当前推断` 的优先级重建上下文；摘要只能作导航提示，不得覆盖文件真相源。
- Hook Stop/PreCompact 对入口检查块的可见回复验证必须区分 `verified-present` / `verified-missing` / `unverified` 三态；无法解析最终 assistant 内容时只能提示“无法验证最终用户可见回复”并附 payload capture 指引，禁止断言“未输出”。
- 当 `<工作区根>/.devcodex/layout.json` 启用 `workspace-namespace` 时，Profile 与运行态目录按**工作区集中命名空间**读取：
  - `config.json`：`<工作区根>/.devcodex/workspace/profile/` 作为 base，`<工作区根>/.devcodex/<project>/profile/` 作为 overlay
  - `config.local.json`：与 `config.json` 使用相同的 `workspace base + project overlay` 路径模型，但仅承载本地私有 overlay（长期连接、env 引用、`extensions.<namespace>`）；不得覆盖 `mode` / `agent` / `pluginVersion`
  - Profile 文档：项目命名空间文件优先，缺失回退到 `workspace/profile/`
  - 运行态目录：单项目写 `<工作区根>/.devcodex/<project>/...`，全工作区写 `<工作区根>/.devcodex/workspace/...`
- workspace-namespace 下缺少 workspace profile 的多项目提示必须指向 `.devcodex/workspace/profile/`；同一宿主会话已识别唯一目标项目时，后续“继续 / 确认”等消息可在短 TTL 内沿用 sticky `activeProject` 与项目 `mode`，但新会话、TTL 过期、命中多个项目或用户显式选择 workspace 时必须重新判断。
- 未启用 `layout.json` 时，继续兼容 `<项目根>/.devcodex/...`

| 文件 | 说明 | 必须 |
|------|------|:----:|
| `README.md` | profile 索引 | 是 |
| `01-项目信息.md` | 技术栈/仓库 | 是 |
| `02-架构约束.md` | 目录结构/边界 | 是 |
| `03-代码风格.md` | 编码规范 | 是 |
| `config.json` | ENV_MODE + agent 兜底标识 | 按需 |
| `config.local.json` | 本地私有 overlay：长期连接、env 引用、`extensions.<namespace>` 扩展位（不提交） | 可选 |

> **Copilot / Claude Code / Codex 三宿主 Bootstrap 提醒**（v1.11.0+）：`lifecycle.cjs` 只在宿主实际提供 Hook 事件时形成 runtime 护栏。Claude Code 具备项目级 hooks + MCP，是当前 Full 路径；Codex 通过 `.codex/hooks.json` 接入，阻断输出按事件契约区分顶层 `decision`、`continue:false` 与工具级 `permissionDecision`；Copilot / JetBrains / Cursor 默认按 instruction-fallback 处理，不承诺本地 Hook 硬拦。默认 `safety-only` 模式下，bootstrap / CP / auto 白名单等流程问题输出提醒并放行工具，仅危险命令继续硬拦；设置 `DEVCODEX_HOOK_ENFORCEMENT=strict` 时，只有支持硬拦的事件才停止流程。AI 仍须在首条用户可见回复输出 PC0~PC7 入口检查块（S07/C18）。

### Hook 拦截动作语义

| 动作 | 使用场景 | 执行语义 |
|------|----------|----------|
| `forbid` | 危险命令、不可恢复破坏性操作、禁止类规则 | 支持硬拦的宿主直接阻断；可审批危险命令先返回 pending `devcodex-approve:<id>`，只有用户后续明确确认该 id 后，同一命令/目录 10 分钟内才可消费一次；不可审批命令只能改用安全替代方案 |
| `require_completion` | 必须补完 Profile/记忆/CP/报告等前置项后才能进入下一步 | `strict` + 支持硬拦事件时停止；默认 `safety-only` 下提醒放行，但 AI 必须先补完缺项再继续 |
| `warn_continue` | 流程风险、降级模式、auto 白名单不满足等可继续场景 | 提示并继续，原因必须记录到 Hook 状态或报告 |
| `log_only` | 已确认危险命令、状态转换、审计痕迹 | 不打断流程，仅写入审计日志 |

所有 runtime 拦截都必须追加写入 `interceptions.jsonl`，记录 `eventName`、`platform`、`action`、`code`、`reason`、`nextStep`、`effective`。`effective=true` 表示宿主实际阻断；`effective=false` 表示本次仅提示/记录，AI 侧仍需按规范补完后续动作。非工具事件的 DevCodex 元数据只写审计日志，不写入不受宿主支持的 `hookSpecificOutput` 字段。

### ConfirmationRequest 与按钮降级

用户确认语义必须先表示为宿主无关的 `ConfirmationRequest`（`id/kind/severity/question/options/recommendedOption/evidence/fallbackText/auditLogRequired`），再由宿主适配层选择按钮、权限提示、Hook 阻断或文本 fallback。该抽象是语义层契约，不要求 runtime 产物逐字输出名为 `ConfirmationRequest` 的对象；Claude Code SDK / VS Code Chat Extension 等明确支持结构化按钮时可使用按钮；Codex/Claude/Copilot Hooks 以阻断原因和下一步为主；Cursor/JetBrains/repository instructions 使用文本确认 fallback。禁止把按钮 UI 写成全宿主能力。

---

## 规范治理生命周期（RecordRouter + SCV）

规范治理采用 `Intent Detection → RecordRouter → Ledger → Verification` 链路，详细规则见 `skills/spec-governance/SKILL.md`。

### 记录意图驱动

“记录一下”“这个规范要优化”“以后应该这样做”“你刚才漏了/错了/违反流程了”等表达不得按关键词直接写台账，必须先识别规范化意图：

| 意图 | 目标 |
|------|------|
| `record.violation` | 已有规则未执行 → `data/violations.md` |
| `record.spec-defect` | 规范缺失/冲突/滞后 → `data/pending-fixes.md` |
| `record.process-improvement` | 可泛化策略改进 → `data/process-improvements.md` |
| `record.pending-issue` | 已确认可排期治理项 → `data/pending-issues.md` |
| `record.audit-gap` | 检查体系盲区 → `data/gap-registry.md` |
| `record.none` | 普通需求/报告整理 → 不写台账 |
| `record.ambiguous` | 指代不清 → 先澄清 |

每次记录分流必须输出 `规范化意图`、`置信度`、`依据`、`目标台账`。低置信度不得静默写台账。重复 VL 必须判断是否升级 PF/GAP，不能只追加重复违规。

### Improvement Intake（优化清单）

在所有模式下，每条用户消息在完成合理性评估后，都必须额外判断一次：该消息是否提出了**已验证更优且可泛化的执行策略**，或是否暴露了**规范未定义/不完整**。命中时，不必等待用户显式说“记录一下”，而是主动执行 Improvement Intake：

| 判定 | 处理 |
|------|------|
| 仅更优策略，可泛化 | 记录 `PI`（优化清单） |
| 仅暴露规范缺口 | 记录 `PF` |
| 同时存在更优策略 + 规范缺口 | 同时记录 `PI + PF` |
| 只是当前执行没做到，但规则已存在 | 记录 `VL` |
| 一次性偏好、业务局部需求、不可泛化想法 | `record.none`，不写台账 |

所有模式下，主动 Intake 完成后必须显式回执：`已记录 PI-xxx`、`已记录 PF-xxx` 或 `已记录 PI-xxx / PF-xxx`。`data/process-improvements.md` 在本轮也可称“优化清单（PI）”，但它仍是当前 active-root 的运行时台账；若建议针对 DevCodex 规范自身，则必须归属 DevCodex 规范维护项目的 active-root，而不是业务项目台账。

### Backlog Intake 真相复核

当新的需求、bug、批次计划或修复范围**直接来源于 `data/*.md` 的 open/partial 条目**时，不能把这些条目直接当成“纯 open backlog”。进入 CP1 / 问题确认或批次实施前，必须先做 1 轮 Backlog Intake 真相复核：

| 分类 | 含义 | 处理 |
|------|------|------|
| `pure-open` | 主体尚未实施，仍是本轮真实 open | 可直接纳入本轮范围 |
| `residual-tail` | 主体已修，只剩尾项/补强/探针/文书 | 缩减范围后纳入尾项治理 |
| `already-fixed` | 源码/产物已修，仅台账状态未回写 | 先回写台账，再从新范围中剔除 |
| `misclassified` | 原台账分类、描述、计数或归属有误 | 先修正台账和统计口径，再决定是否继续纳入 |

- 真相复核至少要核对：源码现状、运行时台账、最近报告/进度、验证结果与最新记忆索引。
- 非 `pure-open` 项不得原样沿用旧 open 统计；必须先回写台账、修正本轮范围和 CP1/CP2/CP3 口径，再继续推进。
- 用户面至少要显式说明：候选编号、复核分类、是否缩减本轮范围。

### 台账落点与关闭证据

- `data/*.md` 是运行时逻辑台账路径，实际写入必须按当前 active-root 映射：旧布局写 `<项目根>/.devcodex/data/`，workspace-namespace 单项目写 `<工作区根>/.devcodex/<project>/data/`，全工作区写 `<工作区根>/.devcodex/workspace/data/`。
- DevCodex 规范自身、Hook、Skill、模板、validate 或宿主适配链路问题归属当前 DevCodex 源仓或规范维护项目的 active-root；在 `workspace-namespace` 下应解析为承载 DevCodex 源码或规范资产的项目命名空间，不得因当时正在处理业务项目而写入业务项目台账。
- VL/PF 关闭前必须具备修复方案、修复时间、验证状态、验证时间、验证证据与关闭时间；仅“已登记”不得视为“已验证关闭”。
- 实施完成复审、ECR 或审计复审发现新问题时，必须记录逃逸原因、缺失检查/探针、补救方案，并判断是否升级 VL/PF/GAP。
- 若本轮实施、复审或范围收紧改变了 VL/PF/PI/ISSUE/GAP 的真实状态，必须执行**台账状态回写闭环**：更新目标台账的状态、验证证据、验证时间、关闭时间/部分完成说明，并在批次完成前做 1 轮 target ledger rescan，确认 open 计数、进度、报告与 SUMMARY 口径一致。

### AI 与确定性边界

AI 负责语义判断、上下文归因、多意图拆分、模糊表达澄清；安全底线、active-root 路径、CP 状态、台账格式、测试结果和部署同步必须由规则或工具验证。

### SCV 规范变更验证

修改规范源、Skill、Hook、CLI、MCP、模板、部署副本、website specs、路径规则或 validate 语义时，必须执行 `SCV（Spec Change Verification）`：

`SCV-0 变更分类 → SCV-1 真相源映射 → SCV-2 CRS 双向联查 → SCV-3 可执行验证 → SCV-4 行为回放 → SCV-5 部署副本同步 → SCV-6 产物边界扫描 → SCV-7 完成判定`。

SCV 结果必须写入报告；控制面任务的 ECR-7 必须引用 SCV 证据，不能只写“已验证”。

---

## ENV_MODE 行为总表

| 影响点 | `prod`（默认）| `dev` |
|--------|:------------:|:-----:|
| CP 门控 | 🔴 强制等待用户确认 | 🔴 强制等待用户确认 |
| 合规检查 | 不执行 | 全量 FC1~FC7 + SC1~SC15 + RC1~RC4 + T1~T9 |
| 入口检查输出 | 输出 PC0~PC7 基础状态，PC4 标注 N/A | 输出 PC0~PC7，PC4 执行完整规范雷达 |
| 合规状态块 | 不输出 | 输出全量状态块（chat 豁免合规块，但仍须预检查）|
| 安全底线 S01~S06 | 🔴 强制 | 🔴 强制 |

---

## 开发工作流（dev）

### 子类型路由

| 意图 | 子类型 |
|------|--------|
| 全新功能/模块/接口 | default |
| 代码重构/改善/结构调整 | refactor |
| 数据库/ORM/迁移/Schema | database |
| 项目初始化/脚手架 | init |
| 性能优化/缓存/查询优化 | optimization |
| 编写/补充测试用例 | scenario-test |
| 技术文档/API 文档 | docs |

### CP 流程（dev，C02 约束）

```
CP1（需求确认）→ CP2（方案确认）→ [plan-review] → CP3（实施确认）→ 执行
```

- **CP1**：输出完整需求理解（目标/边界/风险）→ 等待用户确认
- **CP2**：输出技术方案（架构/文件清单/依赖）→ 等待用户确认
- **plan-review**：评估计划可行性（CP2 后、CP3 前）
- **CP3**：条件触发。default/refactor/database/optimization/scenario-test 必须执行；docs/init/plan-review 按子类型规则豁免，并记录 `CP3: N/A（<子类型> 子类型豁免）`。
- 若执行过程中新增范围触发 CP3 条件（例如最初判断 <5 文件但实际扩展到 ≥5 文件，或新增高风险操作/控制面联动），必须暂停执行，回补或重开 CP3 后再继续。
- **ECR**：执行完成后、宣告完成前必须执行 ECR 执行闭环复审，覆盖 CP1/CP2/CP3、报告、daily tasks、SUMMARY、diff/commit、测试/探针与 dirty 边界。

> **无 Hooks 宿主软门禁**（v1.9.6+）：当宿主为 `jetbrains-copilot`、`cursor` 或其他 `instruction-fallback` 模式时，`lifecycle.cjs` CP gate 不强制。AI 必须在每个 CP 输出末尾显式追加 `⏸ 等待用户确认（CP{N}）`，收到明确回复前禁止 source mutation 工具调用。

**高风险操作**：DDL 变更 / `.env`/`package.json`/CI 配置变更 / 文件删除 / 直接影响生产环境

### CP 响应处理

| 用户响应 | 处理 |
|---------|------|
| 明确确认（"ok"/"好"/"继续"）| 进入下一阶段 |
| 修正方案 | 更新方案后等待重新确认 |
| 拒绝 | 停止，说明原因，询问新方向 |
| 追问 | 回答后保持当前 CP 状态 |
| 模糊 | 主动确认（"您的意思是...？"）|

### 确认后前置轻量复审

- 每次 CP1 / CP2 / CP3 确认后、进入下一阶段前，必须先做 1 轮轻量前置复审，并显式输出结果。
- 当场景涉及控制面规则、多文件联动、真相源同步、模板/示例/校验链联动时，前置复审必须追加交叉验证。
- 若前置复审或交叉验证发现阻断项，必须先修正当前产物并重新确认，不得继续推进。

### Skill 按需读取（仅读对应子类型 Skill）

> Skill 文件位于宿主部署目录：Claude Code 使用 `.claude/skills/<name>/SKILL.md`，Codex 使用 `.agents/skills/<name>/SKILL.md`，Copilot 使用 `.github/skills/<name>/SKILL.md`。按需用 Read 工具读取，禁止全量读取。

| dev.子类型 | 必读 Skills（路径：`<skills-root>/<name>/SKILL.md`）|
|-----------|------------|
| default | `dev-default` · `cp-gate` · `dev-plan-review` |
| refactor | `dev-refactor` · `cp-gate` · `dev-plan-review` |
| database | `dev-database` · `cp-gate` · `dev-plan-review` |
| init | `dev-init` |
| optimization | `dev-optimization` · `cp-gate` · `dev-plan-review` |
| scenario-test | `dev-scenario-test` · `cp-gate` |
| docs | `dev-docs` · `cp-gate` |
| plan-review | `audit-common`（豁免 `dev-plan-review`，防递归）|

---

## 修复工作流（fix）

### 子类型路由

| 意图 | 子类型 |
|------|--------|
| 线上事故/P0/P1/生产故障 | incident |
| 安全漏洞/CVE/注入/XSS | security |
| 常规 Bug/报错/异常 | default |

### CP 流程（fix）

```
CP1（问题确认）→ CP2（方案确认）→ [impact-review] → 执行 → [CP3]
```

- **CP1**：输出问题分析（根因 + 影响范围）→ 等待确认
- **CP2**：输出修复方案 → 等待确认
- **CP3**：≥5 文件变更 或 含高风险操作时必须
- 若执行过程中新增范围触发 CP3 条件（例如实际修改文件数扩展到 ≥5，或修复途中引入高风险/控制面联动），必须暂停执行，先补做 CP3，再继续修复。
- **ECR**：执行完成并完成修复三步扫描后、宣告完成前必须执行 ECR 执行闭环复审，覆盖 CP1/CP2/CP3、报告、daily tasks、SUMMARY、diff/commit、测试/扫描证据与 dirty 边界。

### 确认后前置轻量复审

- fix 工作流在 CP1 / CP2 / CP3 确认后、进入下一阶段前，同样必须先做 1 轮轻量前置复审，并显式输出结果。
- 当问题涉及控制面规则、多文件联动、真相源同步、模板/示例/校验链联动时，必须追加交叉验证。
- 若发现阻断项，先修正当前产物并重新确认，再继续推进。

### 修复三步必做（执行后立即扫描，不可省略）

1. **同类全局扫描** — 同一模式错误是否存在于其他位置（grep 全项目）
2. **数据联动扫描** — 上下游数据流是否受影响
3. **零残留复核** — 确认无残留引用

---

## 分析工作流（analyze）

- 只读工作流，禁止修改文件
- 多轮收敛：至少 3 轮，连续 2 轮无新发现后收敛
- 收敛前必须 CRS（关联文件全库 grep 核心关键词）
- 多建议、多路径或技术选型时必须输出 `推荐结论` / `推荐方案` 与推荐理由；没有可推荐动作时写明 `推荐：无后续动作`。

---

## 审计工作流（audit）

- 只读工作流，禁止修改文件
- 多轮收敛：至少 3 轮，连续 **3** 轮零发现后才可宣告收敛
- DevCodex plugin 文件发现问题 → 先做阻断/非阻断分流：阻断项立即自我审视 + self-fix，修复后重启新轮；非阻断项写入 `data/pending-issues.md`，继续下一轮
- 其他文件发现问题 → 记录 PF/VL，继续下一轮
- 收敛前门禁：CRS（全库 grep）✅ + PCV（收敛后汇总验证）

### 审查目标类型路由

> Skill 文件路径：`<skills-root>/<name>/SKILL.md`（Claude Code: `.claude/skills`；Codex: `.agents/skills`；Copilot: `.github/skills`），同时加载 `audit-common` 作为公共维度。

| 审查对象 | 专属维度 |
|---------|---------|
| 规范文件（instructions/skills/agents）| D1~D25（加载 `audit-common` + `audit-dimensions` Skill）|
| 技术方案/架构设计 | TD-1~TD-13（加载 `audit-common` + `audit-tech-design` Skill）|
| 需求文档/PRD | RQ-1~RQ-8（加载 `audit-common` + `audit-requirements` Skill）|
| 项目工程/代码质量 | PE-1~PE-11（加载 `audit-common` + `audit-project` Skill）|
| 报告文件 | RA-1~RA-6（加载 `audit-common` + `audit-report` Skill）|
| 通用文档 | DA-1~DA-6（加载 `audit-common` + `audit-document` Skill）|
| 发布前审查 | RL-1~RL-10（加载 `audit-common` + `audit-release` Skill；审查 release readiness，不替代 `release-verification` R0~R7）|

---

## 记忆写入规则

### 文件路径

```
<active-root>/.memory/clients/<agent>/tasks/YYYYMMDD.md
```

`<active-root>` 取值：
- 旧布局：`<项目根>/.devcodex`
- 集中布局单项目：`<工作区根>/.devcodex/<project>`
- 集中布局全工作区：`<工作区根>/.devcodex/workspace`

- `<agent>` 解析规则（按优先级）：
  1. 当前实际宿主优先：以当前会话/工具链可验证的宿主事实为准，产物必须写入对应宿主目录，例如当前在 Codex 中执行时写 `.memory/clients/codex/`，不得被历史 profile 覆盖。
  2. Profile agent 兜底：仅当当前实际宿主无法可靠判断时，才读取 `.devcodex/profile/config.json` 的 `"agent"` 字段作为 fallback hint。
  3. 若仍无法判断，写入 `unknown-agent` 并记录原因；枚举值固定：`copilot` / `vscode-copilot` / `jetbrains-copilot` / `claude-code` / `codex` / `cursor` / `unknown-agent`（禁止使用裸 `claude`，与 Claude API/Claude.ai 区分）。
  4. `devcodex profile init` 可写入当时探测到的 `"agent"` 作为兜底提示；若 profile agent 与当前实际宿主不同，Agent 日记、SUMMARY、报告路径均按当前实际宿主写入，并在 PC0/doctor/报告中提示差异。
- 禁止用 Bash 命令查找记忆文件（shell glob 跳过隐藏目录），必须用 Read 工具逐层进入

### 写入时机

| 时机 | 必须动作 |
|------|---------|
| 收到首条消息 | 创建/追加会话段落，状态 🔄 |
| 每轮用户消息 | 追加对话记录到 📨 字段 |
| 子任务完成 | 追加 `T{N}进度：✅` |
| >13 轮预警 | 写入编码检查点（📦 字段）|
| 报告写入后 | 追加报告路径到 📄 关联报告 |
| 任务结束 | 更新状态为 ✅ |

### 会话段落必填字段

| 字段 | 说明 |
|------|------|
| 🎯 任务摘要 | 核心目标和意图 |
| 📨 对话记录 | 四列表格：`轮次 \| 👤 用户消息 \| 🤖 AI执行 \| 状态` |

### SUMMARY 文件

```
<active-root>/.memory/clients/<agent>/SUMMARY.md
```

每次会话结束前追加一行索引：`| 日期 | 会话 | 类型 | 摘要 | 关联报告 | 关联记忆 | 状态 |`

---

## 合规检查（仅 dev 模式）

执行顺序：`预检查 PC0~PC7 → FC → SC → RC → 报告验证 V1~V6 → 任务完成验证 T1~T9`

### 入口检查输出格式（所有模式，所有工作流前置，chat 也须执行）

```
---
🔍 入口检查（[DEV/PROD] 模式）
- PC0 上下文：项目 [项目名] · 输出语言 [中/英] · Profile ✅已加载/❌未加载
- PC1 意图：语义初判 [用户意图] → 项目现实扩展后 [工作流/子类型]
- PC2 会话状态：第 N 轮（>10关注/>13预警/>15防护） · 待跟进 ✅无/⚠️[简述]
- PC3 执行准备：项目现实扩展 [已完成/待澄清] · 未完成任务 ✅无/⚠️存在🔄：[简述] · 产物落点 [已确定/无需/待确定]
- PC4 规范雷达：dev 模式输出三轴诊断结果；非 dev 模式 N/A（dev 扩展诊断未启用）
- PC5 部署体状态（v1.11.0+）：cwd 父链 `.github/`、`.claude/`、`AGENTS.md`、`.agents/`、`.codex/` ✅ 存在 / N/A 无父级 · 与源仓库同步 ✅ / ⚠️ [N 文件滞后] / N/A
- PC6 工作区一致性（v1.9.4+）：git 未提交变更 ✅ 无 / ⚠️ [N 文件 dirty] · 当前需求目录 [requirements/<X>/ / 无关联]
- PC7 新会话首步 resume 强制检测（v1.9.4+，仅首条用户消息触发）：✅ 已 Read tasks 文件 + 比对 SUMMARY 一致 / ⚠️ 数据不一致需 resume / N/A（非首条）
---
```

### FC 形式合规（必须全通过）

| # | 检查 |
|:-:|------|
| FC1 | CP 按序执行（CP1→CP2，不跳跃）|
| FC2 | 记忆文件已写入 |
| FC3 | 报告文件已生成（dev/fix/analyze/audit 必须）|
| FC4 | 输出语言正确 |
| FC5 | 引用规范文件存在 |
| FC6 | 合规块已输出 |
| FC7 | 用户决策选项与报告决策点必带推荐 + 理由 |

### SC 实质合规（选取适用项检查）

| # | 关键项 |
|:-:|--------|
| SC1 | Profile 完整加载（README + 01/02/03 + config.json） |
| SC2 | 意图识别理由可追溯 |
| SC3 | 修复三步必做（同类全局/数据联动/零残留） |
| SC4 | 关联文件同步（C11） |
| SC5 | 高风险操作有 CP3 确认 |
| SC6 | SUMMARY 已追加一行索引 |
| SC7 | 任务摘要字段不缺失 |
| SC8 | 报告产物路径符合 `02-output-paths` |
| SC9 | API 变更产出双产物（接口契约 + 验证脚本，见 api-verification） |
| SC10 | dev/fix 子类型 Skill 已按需读取 |
| SC11 | 多任务进度逐项追加（C14） |
| SC12 | 批量操作分批方案已确认（C16） |
| SC13 | 过程改进 PI 已追加（C17） |
| SC14 | 文件 UTF-8 编码安全（C09） |
| SC15 | dev/fix 关键产物已完成 ECR 执行闭环复审 |

### RC 恢复性检查

| # | 检查 |
|:-:|------|
| RC1 | 失败任务已写入待跟进字段 |
| RC2 | 中断点状态 🔄 已持久化 |
| RC3 | 回滚路径有据可查（commit/备份/migrations down） |
| RC4 | 下次会话可直接 resume |

### T 任务完成验证（dev/fix 必跑）

| # | 检查 |
|:-:|------|
| T1 | 代码改动通过 lint |
| T2 | 类型检查通过（如适用） |
| T3 | 单元/集成测试通过 |
| T4 | 关联文档已同步 |
| T5 | 关联配置已更新 |
| T6 | CHANGELOG / unreleased 已按发布状态追加（如属外部可见变更） |
| T7 | 工作流验证已完成（dev/fix 含 ECR；audit/analyze 含 PCV 与推荐结论） |
| T8 | 报告 V1~V6 验证通过 |
| T9 | 记忆 + SUMMARY 写入完成 |

> 完整逐项定义见当前平台部署目录中的 `instructions/17-compliance.instructions.md`；本表为就地索引。

---

## 输出规范

- **用户面禁止输出**：内部工作流 ID（`dev.docs`/`fix.default`）、原始工具参数 XML、内部路由标签、调试 JSON
- 仅在用户明确追问内部分类/机制时才展开内部术语，且最小化展开
- 涉及文件产物时，回复末尾必须输出 `ArtifactLinkSet`：主 Markdown 链接 + 必要 `绝对路径：` copy fallback；Copilot / Codex / 未知宿主或用户反馈无法点击时不得只输出相对链接或裸文件名
- Copilot / Codex 等非 Claude Code 宿主调用 DevCodex MCP 出现 `invoke` undefined 或工具桥接失败时，按宿主 MCP bridge 失败处理：停止重试同一 MCP，降级读取 Profile / SUMMARY / tasks 文件，并记录 `mcpFallback=used`
- Commit subject 只描述主变更，不堆叠背景/验证步骤

## 提交与未发布变更边界

- 当本次开发/修复形成一个**已验证的语义变更批次**，且用户**未明确要求** `tag` / `release` / `publish` 时，默认更新 `changelogs/unreleased.md`，不默认进入正式发版流程。
- `commit` 默认不自动执行，也不按“问题个数”切分；应按**语义批次**提交。
- 以下场景适合执行 `commit`：
  - 用户明确要求提交当前变更
  - 需要独立回滚点
  - 当前语义批次边界清晰且已验证闭环

---

## 宿主工具适配说明

| 场景 | 使用工具 |
|------|---------|
| 读取文件 | `Read`（禁止 Bash cat/head） |
| 编辑文件（增量）| `Edit`（首选，对应 S04）|
| 新建文件 | `Write`（仅新建；禁止对已有规范文件用 Write 整文件重写）|
| 搜索文件 | `Glob` / `Grep`（禁止 Bash find/grep）|
| 运行命令 | `Bash`（lint/test/build；禁止破坏性命令）|
| PowerShell 命令 | `PowerShell`（Windows 环境 shell 操作；需 CP gate 通过后才可写源码文件）|
| 子 Agent | `Agent`（串行，禁止并行，见 C07）|

> 详细合规检查规则（FC/SC/RC/T 逐项定义）见宿主部署目录：Copilot `.github/instructions/`，Claude Code `.claude/instructions/`；Codex 入口由 `AGENTS.md` 承载总则，并通过 `.agents/skills/` 按需读取详细 Skill。

---

## 全自动模式豁免

当用户选择全自动执行时：CP1/CP2/CP3 确认自动通过；S01/S02 核心秘密禁止项/S03~S07/C01/C10/C18 不可豁免。S02 受控私有例外只能按上文模型执行，不属于绕过安全底线。

---

*本文件由 DevCodex 管理，请勿手动修改。升级请运行 `devcodex update`（Copilot + Claude Code + Codex）或 `devcodex update --claude` / `devcodex update --codex`（单宿主）。*
