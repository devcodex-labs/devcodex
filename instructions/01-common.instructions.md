---
applyTo: "**"
---
# 通用规范

> 以下约束在所有工作流、所有节点中全程有效，优先级 P5。  
> 标注 🔒 的条目同时是安全底线（P2），不可被 P1 覆盖。

## 调用路径无关性

> ⚠️ **本文件及所有 Instructions 通过 `applyTo: "**"` 全局注入**，无论 AI 通过 `@devcodex` Agent 调用还是通过 Copilot Chat 直接对话，所有规则均完整适用，不区分调用路径。
>
> 具体执行内容（预检查是否输出、合规检查执行哪些层）由 **ENV_MODE 行为总表** 决定，不因调用方式不同而改变。

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

## 优先级规则 P1~P5

| 级别 | 来源 | 可被覆盖？ |
|:----:|------|:--------:|
| P1 | 用户当前会话的明确指令（本会话有效） | 不适用（P2 可阻断违规指令） |
| P2 | `00-safety.instructions.md`（S01~S06） | 否 |
| — | 项目 profile（`.devcodex/profile/`） | 是（可被 P1 覆盖）|
| P3 | 租户定制 Instructions（`instructions/tenants/<id>/`） | 是（可被 P1/profile 覆盖）|
| P4 | 默认工作流规范（`10-dev.instructions.md` 等） | 是（可被 P1/profile/P3 覆盖）|
| P5 | 本文件（01-common.instructions.md）通用规范 | 是（可被以上全部覆盖）|

## 🔴 强制约束（违反即视为事故）

| # | 约束 | 规则 | P2 |
|:-:|------|------|:--:|
| C01 | 删除/破坏性操作需确认 | 同 S01，完整规则见 [`00-safety.instructions.md`](./00-safety.instructions.md) | 🔒 S01 |
| C02 | CP 不可跳过合并 | dev/fix 工作流的 CP1→CP2 必须严格按序，禁止合并或跳跃；CP3 触发条件由各工作流规范定义 | — |
| C03 | 禁止硬编码敏感信息 | 同 S02，完整规则见 [`00-safety.instructions.md`](./00-safety.instructions.md) | 🔒 S02 |
| C04 | 禁止编造规范内容 | 同 S03，完整规则见 [`00-safety.instructions.md`](./00-safety.instructions.md) | 🔒 S03 |
| C05 | 记忆+报告自动写入 | 同 S05，完整规则见 [`00-safety.instructions.md`](./00-safety.instructions.md) | 🔒 S05 |
| C06 | 禁止 overwrite 源码/规范文件 | 同 S04，完整规则见 [`00-safety.instructions.md`](./00-safety.instructions.md) | 🔒 S04 |
| C07 | 禁止并行调用子 Agent | 同一回复中只能串行启动 Agent，禁止并发 | — |
| C08 | Token 耗尽防护 | 超 10 轮进入关注区；超 13 轮预警（写编码检查点到记忆）；超 15 轮防护（立即写完整记忆 + 建议开新会话）；≥15 轮+≥5 文件→硬性暂停 | — |
| C09 | 文件编码安全 | 禁止终端命令批量修改中文 .md 文件（`Set-Content`/`sed -i` 会破坏 UTF-8 编码），必须使用编辑器工具逐文件修改 | — |
| C10 | 禁止执行危险命令 | 同 S06，完整规则见 [`00-safety.instructions.md`](./00-safety.instructions.md) | 🔒 S06 |
| C11 | 关联文件同步 | 修改/新建/重命名文件后检查所有引用处并同步（SC4 🔴 阻塞性检查） | — |
| C12 | 合理性评估 | **意图识别后、CP1 前**必须评估请求合理性：有更好建议先提出并等待确认再执行。**扩展覆盖**：用户给出判断或引用已有设计时，AI 须独立验证其合理性，不得直接顺从论证 | — |

## 🟡 执行约束（必须执行）

| # | 约束 | 规则 |
|:-:|------|------|
| C13 | 文件过大必须拆分 | AI 新建 .md 超 500 行必须拆分为多个文件（已有文件豁免） |
| C14 | 多任务进度检查点 | 会话包含 ≥2 个独立任务时，每完成一个子任务必须：① 在记忆文件追加该任务进度状态 ② 在对话中输出进度快照（格式严格遵循 `prompts/reply-summary.prompt.md` §6） |
| C15 | 架构质量视角 | dev/fix 任务中涉及代码设计或架构决策的输出须以**架构师与平台工程师**双重视角评估三维质量：① 可扩展性 ② 可维护性 ③ 易上手性。任意维度未达标须说明原因并记录改善方向 |
| C16 | 批量操作分批 | 执行涉及 ≥10 个文件的批量操作（如测试迁移、批量重命名、批量改写）时，必须主动提出分批方案，推荐每批 10 个，并输出分批计划后等待用户确认再开始执行 |
| C17 | 过程改进记录 | 用户建议的执行策略经 AI 确认更优时，必须立即追加一条 PI 条目到 `data/process-improvements.md`（不得询问是否记录），并标注是否已纳入规范 |

## 全自动模式 C02 豁免

当用户选择 `@devcodex-auto`（全自动模式）时：

- CP1 / CP2 / CP3 确认**自动通过**（不等待用户确认）
- 以下约束**不可豁免**：S01（不可逆确认）/ S02~S06 / C01 / C10
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
> ℹ️ `18-spec-radar.instructions.md`（PC4 规范雷达）是 Instruction（不是 Skill），通过 `applyTo:"**"` 全局注入，无需在本表中加载，dev 模式预检查时自动可用。

> ⚠️ **扩展点**：新增工作流子类型时，须同时更新以下5处（D5 L1~L3 联动）：
> 1. 本表（§Skill按需读取表）
> 2. 对应 Instruction 文件的子类型路由表
> 3. `skills/routing/SKILL.md` 路由表
> 4. `skills/report/SKILL.md` 模板引用表
> 5. `instructions/02-output-paths.instructions.md` §报告子目录列表

| 工作流.子类型 | 必读 Skills |
|-------------|------------|
| dev.default | `dev-default` · `cp-gate` · `dev-plan-review` |
| dev.refactor | `dev-refactor` · `cp-gate` · `dev-plan-review` |
| dev.database | `dev-database` · `cp-gate` · `dev-plan-review` |
| dev.init | `dev-init` |
| dev.optimization | `dev-optimization` · `cp-gate` · `dev-plan-review` |
| dev.scenario-test | `dev-scenario-test` · `cp-gate` |
| dev.docs | `dev-docs` |
| dev.plan-review | （Instruction 已完整，无需额外 Skill）|
| fix.default | `fix-default` · `cp-gate` |
| fix.security | `fix-security` · `cp-gate` |
| fix.incident | （Instruction 已完整，无需额外 Skill）|
| audit.规范文件 | `audit-common` · `audit-dimensions` · `audit-execution-guide` |
| audit.技术方案 | `audit-common` · `audit-tech-design` |
| audit.需求文档 | `audit-common` · `audit-requirements` |
| audit.项目工程 | `audit-common` · `audit-project` |
| audit.报告 | `audit-common` · `audit-report` |
| audit.通用文档 | `audit-common` · `audit-document` |
| analyze.default | （Instruction 已完整，无需额外 Skill）|
| analyze.research | `analyze-research` |
| self-fix | （Instruction 已完整，无需额外 Skill）|
| chat | （无需 Skill）|
| resume | `memory` |

**按需触发 Skills**（不预读，仅在执行中满足条件时读取）：
- `api-verification`：PR-5① 标记触发
- `impact-review`：PR-5② 标记触发
- `document-sync`：dev/fix 执行完成后触发
- `dev-testing`：新增公开模块/修复 Bug 后/重构前置检查时触发

## ENV_MODE 行为总表

> 此表为各 Skill 中 ENV_MODE 差异描述的**唯一信源**，各 Skill 文件应引用本表。

| 影响点 | `prod`（默认）| `dev` |
|--------|:------------:|:-----:|
| CP 门控 | 🔴 强制等待用户确认 | 🔴 强制等待用户确认 |
| 合规检查 | 不执行（规范已验证） | 全量 FC1~FC6 + SC1~SC13 + RC1~RC4 + T1~T9 |
| 预检查输出 | 不输出 | 输出 PC0~PC4（PC4 执行完整三轴诊断：Axis A 认知锚点 / Axis B 对话轨迹 / Axis C 用户满足度；规范见 `18-spec-radar.instructions.md`）|
| 合规状态块 | 不输出 | 输出全量状态块（chat 豁免此块；但 chat 在 dev 模式仍须输出预检查块）|
| 安全底线 S01~S06 | 🔴 强制（不受 ENV_MODE 影响）| 🔴 强制（不受 ENV_MODE 影响）|

> **CP 跳过的唯一路径**：`@devcodex-auto`（全自动模式），这是 Agent 级行为，与 ENV_MODE 无关。

## NODE_META 读取规则

当 Agent 进入特定工作流子类型时，按 §Skill 按需读取表 确定需要读取的 Skill 文件，然后按优先级读取：

1. `instructions/tenants/<tenant-id>/` — 租户定制（若有）
2. §Skill 按需读取表 中对应的 Skill 文件 — 详细检查标准
3. 本文件（`01-common.instructions.md`） — 兜底

## 术语约定

| 术语 | 含义 |
|------|------|
| **工作流** | 路由级完整执行路径（dev/fix/analyze/audit/self-fix/resume/plan/chat）|
| **流程** | 步骤级执行序列（某个功能的具体操作步骤）|
| **约束** | C01~C15 编号的强制/执行规则 |
| **规则** | 更宽泛的执行规定（含约束、建议、说明等）|

## 意图识别（三问法）

### 前置识别（优先于三问）

| 检查 | 条件 | 意图 |
|------|------|------|
| 恢复中断？ | 用户说"继续"/"恢复"，**且**记忆中存在 🔄 | `resume` → 跳过三问 |
| 纯问答？ | 仅提问/求解释，无文件变更意图 | `chat` → 跳过三问 |

### 三问判断

| 问题 | 指向变更 | 指向分析 |
|------|---------|---------|
| Q1：最终目的是变更还是结论？ | 变更 | 结论 |
| Q2：分析是手段还是目的？ | 手段 | 目的 |
| Q3：是否需要修改/创建/删除文件？ | 是 | 否 |

- 任一指向变更 → `dev` 或 `fix`（或 `self-fix`）
- 三问全指向分析 → `analyze` vs `audit`（按覆盖范围区分：`analyze` 聚焦特定问题，`audit` 使用完整维度框架；两者均执行多轮收敛，至少 3 轮）

### 意图路由表

| 意图 | 工作流 | 授权 |
|------|--------|------|
| `dev` | 开发（8 子类型）| Free（部分需 Pro）|
| `fix` | 修复（3 子类型）| Free（部分需 Pro）|
| `analyze` | 分析（多轮收敛，≥3 轮）| Free |
| `audit` | 审计（多轮收敛，≥3 轮）| Free（项目工程需 Pro）|
| `self-fix` | 规范自修复 | Pro |
| `resume` | 恢复中断任务 | Pro |
| `other` | 规划（兜底）| Pro |
| `chat` | 问答（快速路径）| Free |

## 任务切换与资料来源优先

### 新需求切换判断顺序

- 当当前请求与本会话已执行内容明显不一致，或看起来可能进入新需求时，**必须优先基于上下文做意图判断**，不能先按关键词机械判定。
- 只有在上下文不足、意图无法稳定判断时，才允许使用关键词、措辞变化、主题漂移等弱信号作为降级辅助。
- 若判断结果为“新需求切换”，且当前工作区存在未提交变更，应先提醒用户确认边界：
	- 先提交当前变更后再切换；
	- 明确确认继续并行处理；
	- 明确说明本次仍属于同一需求的后续。
- 该提醒属于边界护栏，不是安全阻断，不得替代 S01 / C10 等强制确认规则。

### Commit Subject 简洁化

- 当用户明确要求 `git commit` 或“提交当前变更”时，生成的 commit subject 必须压缩为一句简洁描述。
- subject 只描述本次主变更，不得直接复用长段会话摘要，不得堆叠背景、验证步骤或风险说明。
- 若需要补充上下文，应放在回复正文、报告文件或 commit body 中；本规则默认**只约束 subject**。

### 官方文档优先级

- 当任务涉及外部事实判断时，应优先读取官方文档或官方参考资料，再继续分析或实施。
- 适用场景包括：
	- 平台 / 宿主能力判断
	- 框架 API / SDK 行为
	- 版本兼容性、弃用项、Breaking Change
	- 第三方工具参数、命令语义、限制条件
- 若官方文档不存在，再按顺序降级到官方源码 / 官方仓库说明、项目内已确认文档、社区资料。
- 本地纯实现问题、已在仓库内可闭环验证的问题，不应机械触发该规则。

## Profile 加载

> ⚠️ **适用范围：所有工作流（含 analyze / audit / chat）**。无论工作流子类型是否有对应 Skill，均须在收到消息后、执行工作流前完成 Profile 加载。Profile 缺失时 ENV_MODE 默认为 `prod`（保守降级）。

> 🔴 **dev 模式下 chat 不豁免 Profile 加载和预检查**：chat 的豁免范围仅限于合规检查层（FC/SC/RC/T），预检查（PC0~PC4）和 Profile 加载在 dev 模式下对所有工作流均强制。

> 🔴 **跨会话重新加载约束**：当上下文来自会话摘要时，**必须重新读取 Profile 文件**（不得以摘要内容代替）。摘要 ≠ Profile 已加载。

### 确定目标项目

| 优先级 | 条件 | 结果 |
|:------:|------|------|
| 1 | 用户明确指定项目名称 | 直接使用 |
| 2 | 消息涉及工作区目录 | 映射到项目名 |
| 3 | 无法确定 | `<project> = null`，跳过加载 |

### Profile 标准文件

| 文件 | 说明 | 必须 |
|------|------|:----:|
| `README.md` | profile 索引 | 是 |
| `01-项目信息.md` | 技术栈/仓库地址 | 是 |
| `02-架构约束.md` | 目录结构/模块边界 | 是 |
| `03-代码风格.md` | 编码规范 | 是 |
| `04-测试规范.md` | 测试框架/覆盖率 | 按需 |
| `05-发布规范.md` | 版本号/发布流程 | 按需 |
| `config.json` | 运行模式配置（ENV_MODE）+ agent 标识 | 按需 |

### ENV_MODE 注入

| 情况 | ENV_MODE |
|------|---------|
| `config.json` 存在且 `mode: "dev"` | `dev` |
| `config.json` 不存在 / mode 缺失 | `prod`（保守默认）|
