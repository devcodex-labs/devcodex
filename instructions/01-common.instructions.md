---
applyTo: "**"
description: 通用规范总则，覆盖优先级、意图路由、Profile/active-root、宿主适配与治理总线
priority: P5
version: 1.11.33
---
# 通用规范

> 以下约束在所有工作流、所有节点中全程有效，优先级 P5。  
> 标注 🔒 的条目同时是安全底线（P2），不可被 P1 覆盖。

## 调用路径无关性

> ⚠️ **本文件及所有 Instructions 通过 `applyTo: "**"` 全局注入**，无论 AI 通过 `@devcodex` Agent 调用还是通过 Copilot Chat 直接对话，所有规则均完整适用，不区分调用路径。
>
> 具体执行内容（入口检查如何输出、合规检查执行哪些层）由 **ENV_MODE 行为总表** 决定，不因调用方式不同而改变。
>
> ℹ️ `instructions.md` 是单源聚合文件；`instructions/` 目录是按主题拆分视图。关键概念必须在当前拆分文件中可追溯，并通过 `validate` 探针与 `instructions.md` 保持同步。

> ⚠️ **用户面输出约束**：面向用户时禁止直接输出内部实现语义：
> - 内部工作流 ID（如 `dev.docs` / `fix.default` / `self-fix`）→ 应使用自然语言（如"文档规范调整""常规修复""规范自修复"）
> - 原始工具参数（如 `{"filePath":"..."}` / `<function_calls>` XML）
> - 内部路由标签、调试 JSON、内部 filePath
>
> 仅当用户**明确追问**内部分类或执行机制时，才可展开内部术语。
> 若用户明确在问"规则从哪里来""为什么这样设计""这个规范怎么提升"等**规范说明 / 规范改进**问题，应先按问题本身做正常解释或改进讨论，不得默认拒绝、转移话题或直接贴出全部规则原文。
>
> 即使在明确追问场景下，默认用户输出也不应直接罗列完整规则原文、完整内部路径清单或编号清单；仅在当前回答确有必要时，才做最小化展开。
>
> 上述"最小化展开"主要约束**面向用户的默认输出场景**；项目内 `dev` 模式下的规范优化、规则提升与实现讨论不受此条新增限制。
>
> ⚠️ **产物链接兼容**：涉及文件产物时，回复末尾必须按 `02-output-paths.instructions.md` 输出 `ArtifactLinkSet`（主 Markdown 链接 + 必要 `绝对路径：` copy fallback）。Copilot / Codex / 未知宿主或用户反馈无法点击时，不得只输出相对链接或裸文件名。
>
> ⚠️ **MCP fallback**：Copilot / Codex 等非 Claude Code 宿主调用 DevCodex MCP 出现 `invoke` undefined、工具桥接不可用或 server 未连接时，视为宿主 MCP bridge 失败；停止重试同一 MCP，降级读取 Profile / SUMMARY / tasks 文件，并在报告或记忆中记录 `mcpFallback=used`。

## 优先级规则 P1~P5

| 级别 | 来源 | 可被覆盖？ |
|:----:|------|:--------:|
| P1 | 用户当前会话的明确指令（本会话有效） | 不适用（P2 可阻断违规指令） |
| P2 | `00-safety.instructions.md`（S01~S07） | 否 |
| P2.5 | 项目 profile（`.devcodex/profile/`） | 是（可被 P1 覆盖；不可覆盖 P2 安全底线）|
| P3 | 租户定制 Instructions（`instructions/tenants/<id>/`） | 是（可被 P1/profile 覆盖）|
| P4 | 默认工作流规范（`10-dev.instructions.md` 等） | 是（可被 P1/profile/P3 覆盖）|
| P5 | 本文件（01-common.instructions.md）通用规范 | 是（可被以上全部覆盖）|

## 🔴 强制约束（违反即视为事故）

| # | 约束 | 规则 | P2 |
|:-:|------|------|:--:|
| C01 | 删除/破坏性操作需确认 | 同 S01，完整规则见 [`00-safety.instructions.md`](./00-safety.instructions.md) | 🔒 S01 |
| C02 | CP 不可跳过合并 | dev/fix 工作流的 CP1→CP2 必须严格按序，禁止合并或跳跃；CP3 触发条件由各工作流规范定义 | — |
| C03 | 敏感信息与硬编码策略 | 同 S02，完整规则见 [`00-safety.instructions.md`](./00-safety.instructions.md)；默认允许敏感信息、明文连接信息和硬编码；仅用户 / 项目明确禁止时才限制；未指定 env、`secretRef` 或 `config.local.json` 时不得主动引入 | 🔒 S02 |
| C04 | 禁止编造规范内容 | 同 S03，完整规则见 [`00-safety.instructions.md`](./00-safety.instructions.md) | 🔒 S03 |
| C05 | 记忆+报告自动写入 | 同 S05，完整规则见 [`00-safety.instructions.md`](./00-safety.instructions.md) | 🔒 S05 |
| C06 | 禁止 overwrite 源码/规范文件 | 同 S04，完整规则见 [`00-safety.instructions.md`](./00-safety.instructions.md) | 🔒 S04 |
| C07 | 并发执行策略 | 默认按 `ConcurrencyPolicy` 执行：只读准备和隔离验证可按配置并行；同一 active-root、CP 状态、记忆、报告、台账、audit session、source mutation、package boundary 和危险操作必须串行或单写者。禁止并行启动会写共享状态的子 Agent | — |
| C08 | Token 耗尽防护 | 超 10 轮进入关注区；超 13 轮预警（写编码检查点到记忆）；超 15 轮防护（立即写完整记忆 + 建议开新会话）；≥15 轮+≥5 文件→硬性暂停（立即停止当前工具调用序列，输出 `⛔ PAUSE` 说明原因，写入记忆，等待用户明确继续指令，不再执行新的文件变更） | — |
| C09 | 文件编码安全 | 禁止终端命令批量修改中文 .md 文件（`Set-Content`/`sed -i` 会破坏 UTF-8 编码），必须使用编辑器工具逐文件修改 | — |
| C10 | 禁止执行危险命令 | 同 S06，完整规则见 [`00-safety.instructions.md`](./00-safety.instructions.md) | 🔒 S06 |
| C11 | 关联文件同步 | 修改/新建/重命名文件后检查所有引用处并同步（SC4 🔴 阻塞性检查） | — |
| C12 | 合理性评估 | **意图识别后、CP1 前**必须评估请求合理性：有更好建议先提出并等待确认再执行。**扩展覆盖**：用户给出判断、目录结构或引用已有设计时，AI 须独立验证其合理性，不得直接顺从论证；若经核验用户方案已是当前最优，可明确说明依据后直接采纳，禁止为了表现“独立”而机械唱反调 | — |
| C18 | 全模式入口检查不可跳过 | 同 S07，完整规则见 [`00-safety.instructions.md`](./00-safety.instructions.md) | 🔒 S07 |

## 🟡 执行约束（必须执行）

| # | 约束 | 规则 |
|:-:|------|------|
| C13 | 规范资产文件过大必须拆分 | AI 新建 DevCodex 规范资产 `.md`（instructions / skills / prompts / templates / 规范源等）超 500 行必须拆分为多个文件（已有文件豁免）；业务项目需求、技术方案、报告和正式项目文档不因 C13 强制拆分，按项目自身规范、可读性和用户要求判断 |
| C14 | 多任务进度检查点 | 会话包含 ≥2 个独立任务时，每完成一个子任务必须：① 在记忆文件追加该任务进度状态 ② 在对话中输出进度快照（格式严格遵循 `prompts/reply-summary.prompt.md` §6） |
| C15 | 架构质量视角 | dev/fix 的需求/问题定义、代码设计或架构决策须以**架构师与平台工程师**双重视角评估：消费者范围、共享契约边界、模块职责、可扩展性、可维护性、易上手性。模块化只在真实复用者、演进边界或跨模块共享契约存在时成立；任意维度未达标须说明原因并记录改善方向 |
| C16 | 批量操作分批 | 执行涉及 ≥10 个文件的批量操作（如测试迁移、批量重命名、批量改写）时，必须主动提出分批方案，推荐每批 10 个，并输出分批计划后等待用户确认再开始执行 |
| C17 | 过程改进记录 | 用户建议的执行策略经 AI 确认更优，或揭示规范未定义/不完整且可泛化时，必须立即走 Improvement Intake：写入 `data/process-improvements.md`（优化清单，PI）；若同时暴露规范缺口，再联动 `data/pending-fixes.md`（PF）。不得询问是否记录；所有模式命中后都必须回执 `已记录 PI-xxx / PF-xxx` |
| C19 | 确认后前置复审 | 每次用户明确确认后、进入下一阶段前，必须执行 `PostConfirmationReviewScopeGate`：低风险单文件或纯文案可做轻量复审；高风险、多模块、公共 API/配置、安全能力、package/adapter、文档消费者、控制面或多真相源同步任务必须升级为冻结清单驱动的全面复审，命中控制面 / 多文件联动 / 真相源同步 / 模板-示例-校验链场景必须追加交叉验证，并显式输出结果；若发现阻断性问题，先修正并告知用户，再重新确认；无阻断问题方可推进 |
| C20 | 官方文档证据前置 | 新增/升级依赖、框架、SDK、平台 API 或外部模块前必须形成 `OfficialDocsEvidence`；缺失证据不得进入编码 |
| C21 | Profile 联动判定 | dev/fix 项目事实变化后必须执行 `ProfileImpactCheck`：更新 Profile 或写明跳过理由 |
| C22 | AI 自启动服务清理（ServiceLifecycleCleanup） | AI 为验证启动 dev server、文档站、本地 API/mock、数据库代理、SSH 隧道、Playwright/Cypress server、压测 target 等长运行进程时，必须记录启动命令、cwd、PID/job、端口/URL；验证完成、失败或中断收尾前主动停止仅由 AI 启动的服务并核验端口释放；不得杀用户既有进程；用户明确要求保留时记录保留原因、PID/端口和关闭方式 |

### ConcurrencyPolicy（C07）

`config.json` 可通过 `extensions.devcodex.concurrency` 配置并发策略。缺省为 `mode=auto`：只读上下文收集、只读子 Agent 分析和互不写同一输出的隔离验证可按通道上限并行；`mode=serial` 表示全部通道按串行执行。项目只能追加更保守的 `locks.additionalSingleWriterScopes`，不得删除或覆盖核心单写者域。

核心单写者域固定为：`active-root`、`memory`、`report`、`ledger`、`audit-session`、`cp-state`、`source-mutation`、`package-boundary`、`dangerous-operation`。首期不支持 `parallel` 模式、`allowParallelMutations` 或任何并行 mutation 配置。

### QuestionEvidenceGate（问答证据深度与对比调研门禁）

- 当用户询问“是否应该”“哪个更好”“有没有更好建议”“推荐方案/工具/产品/架构/技术选型”，或 AI 的回答会影响用户投入明显时间、金钱、迁移成本、公共契约、长期维护成本时，必须先执行 `QuestionEvidenceGate`，选择合适证据深度后再给推荐。
- `ComparativeResearchGate` 只在推荐、选型、产品/项目路线、架构/技术方案、外部平台能力、同类产品或同类项目判断中触发：先比较同类产品 / 项目 / 本仓库相似模块 / 已有设计，再输出推荐结论；若信息可能近期变化，按外部资料时效规则检索当前资料。
- 纯定义解释、语法说明、低风险本地事实核验、用户明确要求快速答复且不涉及高影响决策，或仓库事实已足以闭环的问题，可写 `ComparativeResearchGate: N/A + skipReason`，不得把普通问答默认升级成重调研。
- 输出推荐时必须说明证据范围：`repo-local`（同仓库相似实现）、`same-type-project`（同类项目/产品对比）、`official/current-docs`（官方或当前资料）、或 `N/A + skipReason`。证据不足时只能给条件结论，不得伪装成已充分调研。

## 统一联查矩阵（C11 扩展）

> 目的：把“相关文件一起检查”从分散规则收口成统一入口。C11 仍是总约束；本节定义“默认联查什么、何时升级强度”。

### 联查级别

| 级别 | 含义 | 最低动作 |
|:----:|------|---------|
| L1 最小联查 | 当前文件 + 直接引用/直接真相源 | 检查直接调用、直接引用路径、当前用户面说明 |
| L2 标准联查 | 同层联动文件 + 上下游说明文件 | 追加同层规则/模板/文档/验证脚本联查 |
| L3 强联查 | 交叉验证 / CRS / 多真相源 / 部署副本 | 追加交叉验证、CRS、部署副本、校验链或定向 audit |

### 工作流最小动作

| 工作流 | 默认级别 | 最小动作 |
|--------|:--------:|---------|
| `dev` | L1 | 当前文件 + 直接引用/真相源；命中高联动场景默认升为 L2 |
| `fix` | L2 | 保持“三步扫描”，并在高联动场景按 L3 处理 |
| `analyze` | L1→L2 | 先提取关键词、建立关联文件集合；收敛前必须补一次 CRS |
| `audit` | L3 | 继续使用 CRS / G3 / PCV，视为强联查路径 |

### 高联动场景默认联查清单

| 场景 | 默认联查文件族 | 默认级别 | 升级条件 |
|------|---------------|:--------:|---------|
| 控制面规则变更 | `instructions/`、`skills/`、`prompts/`、`hooks/`、`scripts/validate.js` | L2 | 涉及多真相源或部署副本 → L3 |
| 模板变更 | `prompts/`、对应 `skills/`、对应 `instructions/`、`scripts/validate.js`、样本/示例文档 | L2 | 命中模板-示例-校验链 → L3 |
| 文档阅读顺序 / 导航顺序变更 | 正文顺序、README/索引页、website sidebar/nav、目录页、`scripts/validate.js` 探针 | L3 | 正文定义“先看/先做/审查顺序”时，导航和索引必须作为当前消费者同批校验 |
| 接口契约 / 验证产物变更 | 技术方案、目标接口文档、`.http`、`.cjs`、调用方说明 | L2 | 对外契约 + 多端联调 → L3 |
| 依赖 / 框架 / SDK / 平台 API 引入或升级 | 官方文档、技术方案 `OfficialDocsEvidence`、`dev-plan-review`、报告模板、README/website | L2 | 控制面或多端兼容 → L3 |
| 执行契约 / 测试路由 / 服务生命周期 / 发布审查 / 发布验证 / 宿主契约 / 消费链同步变更 | `skills/execution-contract`、`skills/test-router`、`skills/dev-testing`、`skills/dev-scenario-test`、`skills/audit-release`、`skills/release-verification`、`skills/host-contract-verification`、`skills/source-consumer-sync`、dev/fix/audit instructions、报告模板、validate | L3 | 默认即强联查 |
| 实施进度跟踪规则变更 | `instructions/02-output-paths`、`instructions/10-dev`、`skills/cp-gate`、`prompts/implementation-progress`、`scripts/validate.js` | L3 | 默认即强联查 |
| 工作区真相源 / 部署副本 / 分发链变更 | `index.js`、`mcp/`、`hooks/_runtime/`、`README.md`、Profile、`.github/`、`.claude/` | L3 | 默认即强联查 |
| 发布 / 版本 / changelog / profile 口径变更 | `package.json`、`plugin.json`、`CHANGELOG.md`、`changelogs/`、`README.md`、Profile、必要公告文档、`skills/audit-release` | L2 | 多真相源口径同步 → L3 |

### 升级规则

- 命中多文件联动 / 多真相源同步 / 模板-示例-校验链 / 部署副本场景时，不得停留在 L1
- 命中 C19 的交叉验证条件时，至少按 L3 处理
- `document-sync`、`impact-review`、`api-verification` 继续作为联查子动作使用，不重写为平行机制

## 全自动模式 C02 豁免

当用户选择 `@devcodex-auto`、全局默认 `@rocky`、Profile `config.json` 的 `extensions.devcodex.autoAliases` 替换别名，或在文本宿主中明确自然语言授权 auto（如“进入 auto 模式执行”“全自动继续”“run in auto mode”）时：

- Auto v1.1 正式入口包括显式 `@devcodex-auto`、全局默认 `@rocky`、项目 Profile 配置的 `extensions.devcodex.autoAliases` 替换别名与明确自然语言 auto 授权；配置了 `autoAliases` 时该列表替换全局默认别名，空数组表示关闭默认别名；模糊提及、追问 auto 规则、普通“继续”或未生效昵称不等价于 auto 授权
- 仅在 `hook-enforced` 宿主中，对治理文件 / `.devcodex/` 产物 / README / auto 专属回归脚本等**白名单路径**启用自动推进
- 非白名单路径默认切回确认模式，不承诺“所有源码任务自动执行”
- `instruction-fallback` 宿主（如 JetBrains / Cursor）只保留 auto 规则语义，不承诺 runtime 级行为；支持 Hook 的宿主默认采用 `safety-only`：白名单边界输出提醒，`strict` 模式下才形成 runtime 硬拦截
- CP1 / CP2 / CP3 确认**自动通过**（不等待用户确认），但该自动通过只对白名单路径形成无提醒通过；非白名单路径在默认 `safety-only` 下提醒放行，在 `strict` 模式下拦截
- 以下约束**不可豁免**：S01（不可逆确认）/ S02 用户 / 项目敏感信息策略 / S03~S07 / C01 / C10 / C18。S02 不阻断明文、硬编码或真实秘密写入；它只禁止 AI 未经用户 / 项目要求自行加严、改成 env、`secretRef`、secret manager、`config.local.json` 或占位符。
- 可恢复失败：重试 ≤ 2 次；不可恢复失败：切换回确认模式并通知用户 ⚠️

## 设计原则

> 📖 **参考内容，非执行规则** — 阐述规范体系的设计理念，供理解背景用。

**核心理念：质量第一，效率第二**

| 机制 | 本质 | 错误理解 |
|------|------|---------|
| 预检查（获取时间/读文件/加载规范）| 入口门禁，防止上下文丢失 | 不是"开销" |
| CP 确认点 | 防止方向偏差后大量返工 | 不是"打断" |
| 合规检查 | 防止遗漏导致下次会话补救 | 不是"繁琐" |
| 多轮审查 | 防止首轮盲区导致问题遗漏 | 不是"重复" |

**强制执行原则**：
1. 仅读取**当前工作流子类型直接对应**的 Skill 文件（见下方 §Skill 按需读取表），禁止一次性读取全部 Skills
2. 读取到的规范内容必须逐条完整执行，不得选择性忽略
3. 即使 AI 认为某条"不适用当前场景"也必须执行 — 裁剪决策只属于用户（P1）
4. spec 文件不存在时必须走降级路径，绝不允许直接跳过节点

## Skill 按需读取表

> ⚠️ 仅读取当前工作流子类型对应的 Skills，禁止全量读取。
> ⚠️ **Profile 加载（读取 `.devcodex/profile/`）是所有工作流的前置步骤，不受本表约束，必须在执行任何工作流前完成。**
> ℹ️ `18-spec-radar.instructions.md`（PC4 规范雷达）是 Instruction（不是 Skill），通过 `applyTo:"**"` 全局注入，无需在本表中加载；仅 dev 模式在入口检查中执行完整三轴诊断。

> ⚠️ **扩展点**：新增工作流子类型时，须同时更新以下5处（D5 L1~L3 联动）：
> 1. 本表（§Skill按需读取表）
> 2. 对应 Instruction 文件的子类型路由表
> 3. `skills/routing/SKILL.md` 路由表
> 4. `skills/report/SKILL.md` 模板引用表
> 5. `instructions/02-output-paths.instructions.md` §报告子目录列表
>
> ⚠️ **支撑型 Skill**（如 `execution-contract` / `test-router` / `release-verification` / `host-contract-verification` / `source-consumer-sync`）不是工作流子类型，不强制写入子类型路由表；但必须同步 `plugin.json` 注册、触发说明、报告/模板消费点、文档说明与 validate 探针。

| 工作流.子类型 | 必读 Skills |
|-------------|------------|
| dev.default | `dev-default` · `cp-gate` · `dev-plan-review` |
| dev.refactor | `dev-refactor` · `cp-gate` · `dev-plan-review` |
| dev.database | `dev-database` · `cp-gate` · `dev-plan-review` |
| dev.init | `dev-init` |
| dev.optimization | `dev-optimization` · `cp-gate` · `dev-plan-review` |
| dev.scenario-test | `dev-scenario-test` · `cp-gate` |
| dev.docs | `dev-docs` · `cp-gate` |
| dev.plan-review | `audit-common`（豁免 `dev-plan-review`，防递归）|
| fix.default | `fix-default` · `cp-gate` |
| fix.security | `fix-security` · `cp-gate` |
| fix.incident | （Instruction 已完整，无需额外 Skill）|
| audit.规范文件 | `audit-common` · `audit-dimensions` · `audit-execution-guide` · `audit-session` |
| audit.技术方案 | `audit-common` · `audit-tech-design` · `audit-session` |
| audit.需求文档 | `audit-common` · `audit-requirements` · `audit-session` |
| audit.项目工程 | `audit-common` · `audit-project` · `audit-session` |
| audit.报告 | `audit-common` · `audit-report` · `audit-session` |
| audit.通用文档 | `audit-common` · `audit-document` · `audit-session`（用户侧文档 / 文档站 / 项目文档 review 额外叠加 `audit-user-manual`；README / 主入口文档再叠加 `audit-readme`） |
| audit.发布前审查 | `audit-common` · `audit-release` · `audit-session` |
| analyze.default | （Instruction 已完整，无需额外 Skill）|
| analyze.research | `analyze-research` |
| self-fix | （Instruction 已完整，无需额外 Skill）|
| other | `plan` |
| chat | （无需 Skill）|
| resume | `memory` |

**按需触发 Skills**（不预读，仅在执行中满足条件时读取）：
- `execution-contract`：Auto、控制面、预计 ≥10 文件、多批次、发布或需要强边界任务触发
- `repair-collaboration`：AI 判断任务目标是修复 Bug、缺陷、回归、安全问题、规范缺口或已确认 finding 时，至少形成轻量双层修复协作契约；高风险场景由 `execution-contract` 升级完整契约与独立复证。模型名称、宿主或是否切换 Agent 不是触发条件
- `test-router`：dev/fix 执行前选择验证路线时触发
- `audit-release` / `ReleaseAudit`：发版前 review、release pre-review、publish/tag 前风险审查或 audit 识别为发布准备审查时触发
- `release-verification`：用户明确要求 release / tag / publish 或版本发布验证时触发
- `host-contract-verification`：宿主事件契约、visible reply、sticky project、workspace guard、bootstrap 证据任务触发
- `source-consumer-sync`：规范源、README/website/Profile/validate/部署副本联动时触发
- `profile-bootstrap`：Profile 缺失、用户要求补建 Profile、需要从 prod 降级恢复到 dev 模式，或需要生成 `.devcodex/profile/` 初稿时触发；优先建议/执行 `devcodex profile init`，不得用 AI 推测内容替代文件真相源
- `api-verification`：PR-5① 标记触发
- `impact-review`：PR-5② 标记触发
- `document-sync`：dev/fix 执行完成后触发
- `dev-testing`：新增公开模块/修复 Bug 后/重构前置检查时触发

## ENV_MODE 行为总表

> 此表为各 Skill 中 ENV_MODE 差异描述的**唯一信源**，各 Skill 文件应引用本表。

| 影响点 | `prod`（默认）| `dev` |
|--------|:------------:|:-----:|
| CP 门控 | 🔴 强制等待用户确认 | 🔴 强制等待用户确认 |
| 合规检查 | 不执行（规范已验证） | 全量 FC1~FC7 + SC1~SC15 + RC1~RC4 + T1~T9 |
| 入口检查输出 | 输出 PC0~PC7 基础状态；PC4 标注 N/A（dev 扩展诊断未启用）| 输出 PC0~PC7；PC4 执行完整三轴诊断：Axis A 认知锚点 / Axis B 对话轨迹 / Axis C 用户满足度；PC5~PC7 见 `17-compliance.instructions.md` |
| 合规状态块 | 不输出 | 输出全量状态块（chat 豁免此块；但 chat 仍须输出入口检查块）|
| 安全底线 S01~S06 | 🔴 强制（不受 ENV_MODE 影响）| 🔴 强制（不受 ENV_MODE 影响）|
| S07（入口检查强制）| 🔴 致命自修正（`instruction-fallback` 模式自检触发，自动补输出 PC0~PC7 基础状态）| 🔴 致命自修正（`instruction-fallback` 模式自检触发，自动补输出 PC0~PC7 + dev 扩展诊断）|

> **CP 跳过路径**：显式 `@devcodex-auto`、全局默认 `@rocky`、Profile `extensions.devcodex.autoAliases` 替换别名或明确自然语言 auto 授权（如“进入 auto 模式执行”）；这是 Agent 级行为，与 ENV_MODE 无关。

## NODE_META 读取规则

当 Agent 进入特定工作流子类型时，按 §Skill 按需读取表 确定需要读取的 Skill 文件，然后按优先级读取：

1. `instructions/tenants/<tenant-id>/` — 租户定制（若有）
2. §Skill 按需读取表 中对应的 Skill 文件 — 详细检查标准
3. 本文件（`01-common.instructions.md`） — 兜底

## 分拆视图索引与锚点

> `instructions.md` 是唯一聚合源；`instructions/` 是按主题拆分视图。
> `01-common.instructions.md` 现在作为 **common-base / 锚点文件**，只保留跨消费者必须直达的总则；详细内容已拆到：
>
> - [`01a-profile-loading.instructions.md`](./01a-profile-loading.instructions.md)
> - [`01b-record-router.instructions.md`](./01b-record-router.instructions.md)
> - [`01c-intent-expansion.instructions.md`](./01c-intent-expansion.instructions.md)

### 术语约定

| 术语 | 含义 |
|------|------|
| **工作流** | 路由级完整执行路径（dev/fix/analyze/audit/self-fix/resume/plan/chat）|
| **流程** | 步骤级执行序列（某个功能的具体操作步骤）|
| **约束** | C01~C22 编号的强制/执行规则 |
| **规则** | 更宽泛的执行规定（含约束、建议、说明等）|

### 意图识别（三问法）

- 前置识别仍保持：存在 🔄 会话的“继续/恢复”走 `resume`；纯问答走 `chat`。
- 三问判断仍保持：任一指向变更 → `dev/fix/self-fix`；三问全指向分析 → `analyze/audit`。
- `Intent Expansion Card`、用户可见摘要与恢复契约的详细定义已移动到 [`01c-intent-expansion.instructions.md`](./01c-intent-expansion.instructions.md)。

### 任务切换与资料来源优先

- 新需求切换、Commit Subject 简洁化、未发布变更与提交边界、自我进化与问题池、官方文档优先级、`OfficialDocsEvidence` 与 `ProfileImpactCheck` 的完整规则已移动到 [`01b-record-router.instructions.md`](./01b-record-router.instructions.md)。
- 当本次开发/修复形成已验证批次且未明确要求 release / publish 时，默认更新 `changelogs/unreleased.md`。
- `commit` 默认**不自动执行**，但一旦执行必须按**语义批次**提交。
- 所有模式下，每条用户消息完成合理性评估后，都必须执行 `Improvement Intake（优化清单）` 判定。
- 仅业务局部诉求、一次性偏好或不可泛化想法，不写 PI/PF；命中后必须显式回执 `已记录 PI-xxx`、`已记录 PF-xxx` 或 `已记录 PI-xxx / PF-xxx`。

### Intent Expansion / Rehydration 锚点

- `01c-intent-expansion.instructions.md` 是 `Intent Expansion Card`、`用户可见意图扩展摘要`、`Context Rehydration Contract`、`ContextHandoffCard` 与 `Stop 可见回复证据三态` 的详细信源。
- dev 模式默认向用户展示完整 Card；prod、instruction-fallback 宿主或低风险轻任务可退化为 3~5 行摘要。
- 若执行中新增范围触达 CP3 条件（≥5 文件、高风险、控制面联动），必须暂停执行并回到对应 CP3。

### Profile 加载

- Profile 加载适用于所有工作流（含 analyze / audit / chat）；跨会话恢复时必须重新读取，摘要不能替代 Profile。
- `workspace-namespace` 命中时，Profile 与运行态目录采用集中路径模型；`.devcodex/workspace/profile/` 是 workspace base profile 的真实路径。
- 运行态写入必须遵循 `single active scope write`，不得双写旧路径与新命名空间。
- `config.local.json`、`workspace base + project overlay`、`sticky `activeProject`` 与 `项目现实扩展（Project Reality Expansion）` 的完整规则已移动到 [`01a-profile-loading.instructions.md`](./01a-profile-loading.instructions.md)。
