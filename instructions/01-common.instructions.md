---
applyTo: "**"
---
# 通用规范

> 以下约束在所有工作流、所有节点中全程有效，优先级 P5。  
> 标注 🔒 的条目同时是安全底线（P2），不可被 P1 覆盖。

## 调用路径无关性

> ⚠️ **本文件及所有 Instructions 通过 `applyTo: "**"` 全局注入**，无论 AI 通过 `@devcodex` Agent 调用还是通过 Copilot Chat 直接对话，所有规则均完整适用，不区分调用路径。
>
> 具体执行内容（入口检查如何输出、合规检查执行哪些层）由 **ENV_MODE 行为总表** 决定，不因调用方式不同而改变。

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
| C03 | 禁止硬编码敏感信息 | 同 S02，完整规则见 [`00-safety.instructions.md`](./00-safety.instructions.md) | 🔒 S02 |
| C04 | 禁止编造规范内容 | 同 S03，完整规则见 [`00-safety.instructions.md`](./00-safety.instructions.md) | 🔒 S03 |
| C05 | 记忆+报告自动写入 | 同 S05，完整规则见 [`00-safety.instructions.md`](./00-safety.instructions.md) | 🔒 S05 |
| C06 | 禁止 overwrite 源码/规范文件 | 同 S04，完整规则见 [`00-safety.instructions.md`](./00-safety.instructions.md) | 🔒 S04 |
| C07 | 禁止并行调用子 Agent | 同一回复中只能串行启动 Agent，禁止并发 | — |
| C08 | Token 耗尽防护 | 超 10 轮进入关注区；超 13 轮预警（写编码检查点到记忆）；超 15 轮防护（立即写完整记忆 + 建议开新会话）；≥15 轮+≥5 文件→硬性暂停（立即停止当前工具调用序列，输出 `⛔ PAUSE` 说明原因，写入记忆，等待用户明确继续指令，不再执行新的文件变更） | — |
| C09 | 文件编码安全 | 禁止终端命令批量修改中文 .md 文件（`Set-Content`/`sed -i` 会破坏 UTF-8 编码），必须使用编辑器工具逐文件修改 | — |
| C10 | 禁止执行危险命令 | 同 S06，完整规则见 [`00-safety.instructions.md`](./00-safety.instructions.md) | 🔒 S06 |
| C11 | 关联文件同步 | 修改/新建/重命名文件后检查所有引用处并同步（SC4 🔴 阻塞性检查） | — |
| C12 | 合理性评估 | **意图识别后、CP1 前**必须评估请求合理性：有更好建议先提出并等待确认再执行。**扩展覆盖**：用户给出判断、目录结构或引用已有设计时，AI 须独立验证其合理性，不得直接顺从论证；若经核验用户方案已是当前最优，可明确说明依据后直接采纳，禁止为了表现“独立”而机械唱反调 | — |
| C18 | 全模式入口检查不可跳过 | 同 S07，完整规则见 [`00-safety.instructions.md`](./00-safety.instructions.md) | 🔒 S07 |

## 🟡 执行约束（必须执行）

| # | 约束 | 规则 |
|:-:|------|------|
| C13 | 文件过大必须拆分 | AI 新建 .md 超 500 行必须拆分为多个文件（已有文件豁免） |
| C14 | 多任务进度检查点 | 会话包含 ≥2 个独立任务时，每完成一个子任务必须：① 在记忆文件追加该任务进度状态 ② 在对话中输出进度快照（格式严格遵循 `prompts/reply-summary.prompt.md` §6） |
| C15 | 架构质量视角 | dev/fix 任务中涉及代码设计或架构决策的输出须以**架构师与平台工程师**双重视角评估三维质量：① 可扩展性 ② 可维护性 ③ 易上手性。任意维度未达标须说明原因并记录改善方向 |
| C16 | 批量操作分批 | 执行涉及 ≥10 个文件的批量操作（如测试迁移、批量重命名、批量改写）时，必须主动提出分批方案，推荐每批 10 个，并输出分批计划后等待用户确认再开始执行 |
| C17 | 过程改进记录 | 用户建议的执行策略经 AI 确认更优时，必须立即追加一条 PI 条目到 `data/process-improvements.md`（不得询问是否记录），并标注是否已纳入规范 |
| C19 | 确认后前置复审 | 每次用户明确确认后、进入下一阶段前，必须先对当前已确认产物做 1 轮轻量前置复审，并显式输出结果；控制面 / 多文件联动 / 真相源同步 / 模板-示例-校验链场景必须追加交叉验证；若发现阻断性问题，先修正并告知用户，再重新确认；无阻断问题方可推进 |

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
| 接口契约 / 验证产物变更 | 技术方案、目标接口文档、`.http`、`.cjs`、调用方说明 | L2 | 对外契约 + 多端联调 → L3 |
| 执行契约 / 测试路由 / 发布验证 / 宿主契约 / 消费链同步变更 | `skills/execution-contract`、`skills/test-router`、`skills/release-verification`、`skills/host-contract-verification`、`skills/source-consumer-sync`、dev/fix instructions、报告模板、validate | L3 | 默认即强联查 |
| 实施进度跟踪规则变更 | `instructions/02-output-paths`、`instructions/10-dev`、`skills/cp-gate`、`prompts/implementation-progress`、`scripts/validate.js` | L3 | 默认即强联查 |
| 工作区真相源 / 部署副本 / 分发链变更 | `index.js`、`mcp/`、`hooks/_runtime/`、`README.md`、Profile、`.github/`、`.claude/` | L3 | 默认即强联查 |
| 发布 / 版本 / changelog / profile 口径变更 | `package.json`、`plugin.json`、`CHANGELOG.md`、`changelogs/`、`README.md`、Profile、必要公告文档 | L2 | 多真相源口径同步 → L3 |

### 升级规则

- 命中多文件联动 / 多真相源同步 / 模板-示例-校验链 / 部署副本场景时，不得停留在 L1
- 命中 C19 的交叉验证条件时，至少按 L3 处理
- `document-sync`、`impact-review`、`api-verification` 继续作为联查子动作使用，不重写为平行机制

## 全自动模式 C02 豁免

当用户选择 `@devcodex-auto`（全自动模式）时：

- Auto v1.1 **唯一正式入口**为显式 `@devcodex-auto`；`auto:` / `/auto` / profile `executionMode` 延后到后续版本
- 仅在 `hook-enforced` 宿主中，对治理文件 / `.devcodex/` 产物 / README / auto 专属回归脚本等**白名单路径**启用自动推进
- 非白名单路径默认切回确认模式，不承诺“所有源码任务自动执行”
- `instruction-fallback` 宿主（如 JetBrains / Cursor）只保留 auto 规则语义，不承诺 runtime 级行为；支持 Hook 的宿主默认采用 `safety-only`：白名单边界输出提醒，`strict` 模式下才形成 runtime 硬拦截
- CP1 / CP2 / CP3 确认**自动通过**（不等待用户确认），但该自动通过只对白名单路径形成无提醒通过；非白名单路径在默认 `safety-only` 下提醒放行，在 `strict` 模式下拦截
- 以下约束**不可豁免**：S01（不可逆确认）/ S02~S07 / C01 / C10 / C18
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
| dev.plan-review | （Instruction 已完整，无需额外 Skill）|
| fix.default | `fix-default` · `cp-gate` |
| fix.security | `fix-security` · `cp-gate` |
| fix.incident | （Instruction 已完整，无需额外 Skill）|
| audit.规范文件 | `audit-common` · `audit-dimensions` · `audit-execution-guide` · `audit-session` |
| audit.技术方案 | `audit-common` · `audit-tech-design` · `audit-session` |
| audit.需求文档 | `audit-common` · `audit-requirements` · `audit-session` |
| audit.项目工程 | `audit-common` · `audit-project` · `audit-session` |
| audit.报告 | `audit-common` · `audit-report` · `audit-session` |
| audit.通用文档 | `audit-common` · `audit-document` · `audit-session` |
| analyze.default | （Instruction 已完整，无需额外 Skill）|
| analyze.research | `analyze-research` |
| self-fix | （Instruction 已完整，无需额外 Skill）|
| other | `plan` |
| chat | （无需 Skill）|
| resume | `memory` |

**按需触发 Skills**（不预读，仅在执行中满足条件时读取）：
- `execution-contract`：Auto、控制面、预计 ≥10 文件、多批次、发布或需要强边界任务触发
- `test-router`：dev/fix 执行前选择验证路线时触发
- `release-verification`：用户明确要求 release / tag / publish 或版本发布验证时触发
- `host-contract-verification`：宿主事件契约、visible reply、sticky project、workspace guard、bootstrap 证据任务触发
- `source-consumer-sync`：规范源、README/website/Profile/validate/部署副本联动时触发
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
| **约束** | C01~C19 编号的强制/执行规则 |
| **规则** | 更宽泛的执行规定（含约束、建议、说明等）|

## 意图识别（三问法）

### 前置识别（优先于三问）

| 检查 | 条件 | 意图 |
|------|------|------|
| 恢复中断？ | 用户说"继续"/"恢复"，**且**今日/昨日任务文件（daily file）中存在状态为 🔄 的会话（见 `15-memory` §新会话 🔄 检测；SUMMARY 索引表的状态列不作为判断依据）| `resume` → 跳过三问 |
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

### 未发布变更与提交边界

- 当本次开发/修复形成一个**已验证的语义变更批次**，且用户**未明确要求** `tag` / `release` / `publish` 时，默认更新 `changelogs/unreleased.md`，不默认进入正式发版流程。
- `commit` 默认**不自动执行**；在满足上述条件后，默认**建议执行本地 `commit`** 作为回滚锚点，但不默认 `push`。
- `commit` 不按“问题个数”切分；应按**语义批次**提交。
- 以下场景适合执行 `commit`：
  - 用户明确要求提交当前变更
  - 需要独立回滚点
  - 当前语义批次边界清晰且已验证闭环
- `push` / `tag` / `publish` 仍须用户明确确认；本地 `commit` 不是正式发版动作。
- `commit` 时仍适用“Commit Subject 简洁化”规则。

### 自我进化与问题池

- 当执行中发现**阻断当前任务**的规范/流程问题时，可直接进入修复或规范调整流程。
- 当发现的问题**不阻断当前任务**，且本质属于流程优化、规则补强、模板体验或治理改进时，默认先进入问题池，避免在当前主任务中途穿插修复。
- 问题池条目应满足：
  - 有明确问题描述
  - 有影响范围或适用范围
  - 能在后续按批次进入需求/bug 修复流程
- `data/process-improvements.md` 只记录“已确认更优的执行策略”，不替代问题池本身。

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

> 🔴 **chat 不豁免 Profile 加载和入口检查**：chat 的豁免范围仅限于合规检查层（FC/SC/RC/T）和报告；入口检查（PC0~PC7）与 Profile 加载在所有模式、所有工作流均强制。

> 🔴 **跨会话重新加载约束**：当上下文来自会话摘要时，**必须重新读取 Profile 文件**（不得以摘要内容代替）。摘要 ≠ Profile 已加载。

### `.devcodex` 读取与写入模型

> ⚠️ **layout.json 是集中存储开关**：当 `<工作区根>/.devcodex/layout.json` 存在且声明 `workspace-namespace` 模式时，进入工作区集中存储模型；不存在时，保持旧的 `<项目根>/.devcodex/` 兼容路径。

- **Profile / config 读取**：
  - `config.json` 采用 `workspace base + project overlay`
  - `README.md`、`01-项目信息.md`、`02-架构约束.md`、`03-代码风格.md` 采用 `project file first + workspace fallback`
- **运行态目录写入**：采用 `single active scope write`
  - 单项目任务：写入 `<工作区根>/.devcodex/<project>/...`
  - 全工作区任务：写入 `<工作区根>/.devcodex/workspace/...`
  - 记忆与报告中的 `<agent>` 目录按当前实际宿主确定；`profile/config.json` 的 `agent` 仅作为无法识别宿主时的兜底提示，不能覆盖当前会话事实。
- **旧布局兼容**：未启用 `layout.json` 时，继续使用 `<项目根>/.devcodex/...`
- **禁止双真相源**：同一轮执行只能存在一个活动写入域；不得同时向项目旧路径与工作区新命名空间双写。
- **必须说明命中域**：涉及 `.devcodex` 读取或写入时，必须能明确说明当前使用的是 `workspace` 还是 `<project>` 命名空间。

### 确定目标项目

| 优先级 | 条件 | 结果 |
|:------:|------|------|
| 1 | 用户明确指定项目名称 | 直接使用 |
| 2 | 消息涉及工作区目录 | 映射到项目名 |
| 3 | 🔴 无法确定 | **必须先询问用户**："当前请求关联哪个项目？" — 在用户明确回复前，**禁止发起任何超出当前文件范围的工作区扫描**（`file_search` / `semantic_search` / `grep_search` / `list_dir` 与当前任务无关的调用、以及项目以外的 `read_file`）。仅允许读取用户本轮消息明确提及的文件以便询问。`<project> = null` **不再是合法默认状态** |

> 🔴 **多项目工作区扫描禁令**（v1.9.8+）：当 cwd 是 monorepo 根目录（包含 ≥ 2 个含 `package.json` 或 `.devcodex/profile/` 的子项目）且未明确 `<project>` 时，AI 必须先询问用户。豁免词：用户消息含 `workspace` / `monorepo` / `全工作区` / `all projects` / `所有项目` 则允许全工作区扫描。`lifecycle.cjs` 默认 `safety-only` 下只输出提醒并放行工具，`strict` 模式下才执行 runtime 硬拦截；本条仍是 AI 侧必须遵守的流程约束。
> 当启用 `workspace-namespace` 且缺少 workspace profile 时，运行时提示必须指向真实路径 `.devcodex/workspace/profile/`；若同一宿主会话已识别唯一目标项目，后续“继续 / 确认”等消息可在短 TTL 内沿用 sticky `activeProject` 与项目 `mode`，但新会话、TTL 过期、命中多个项目或用户显式选择 workspace 时必须重新判断。

### 项目现实扩展（Project Reality Expansion）

> 目的：避免只按用户字面意图路由，忽略目标项目实际技术栈、运行方式、文档真相源、测试/发布边界，导致后续方案和实施偏移。

执行顺序必须为：

```text
用户消息语义初判 → 目标项目识别 → Profile / config 加载 → 项目现实扩展 → 最终意图与工作流路由
```

- 项目现实扩展只能使用已确定项目的 Profile、明确提及文件、当前需求产物和必要只读元信息；不得绕过“项目未识别先询问”的扫描禁令。
- 扩展内容必须至少判断：真实项目范围、可能受影响文件族、适用工作流/子类型是否需要修正、产物落点、验证方式、是否存在多项目/跨服务边界。
- 若扩展后发现初判意图不准确，应在 PC1 中表达为“语义初判 → 项目现实修正后的最终路由”，再进入对应工作流。
- 若扩展不足以稳定判断，不得猜测；应在入口检查处提出最小澄清问题。

### Intent Expansion Card

非 chat 工作流在 CP1 / 问题确认前必须形成可审查的 Intent Expansion Card，作为 PC1/PC3、CP1 产物、压缩恢复与错路由复盘的共同锚点。

| 字段 | 说明 |
|------|------|
| `semantic` | 用户字面语义初判 |
| `project` | 目标项目与 active-root |
| `continuity` | 是否延续现有 requirement/bug/session |
| `action` | 最终工作流与子类型 |
| `domain` | 受影响模块/领域（如 hooks、memory、docs、mcp、runtime）|
| `artifact-impact` | 影响源码、配置、规范、报告、记忆、部署体等哪类产物 |
| `risk` | destructive / security / high-risk / normal |
| `host-capability` | 是否涉及宿主能力差异及降级边界 |
| `validation-route` | lint/test/typecheck/validate/direct replay/官方文档等验证路线 |
| `confidence` | high / medium / low，并说明不确定点 |
| `alternatives` | 被排除路线及原因 |

### 用户可见意图扩展摘要

在 dev/fix 等非 chat 工作流中，若项目现实扩展导致工作流/子类型修正、命中控制面或宿主能力差异、风险不为 normal、`confidence` 非 high，或用户正在跨会话 resume，用户面必须追加 3~5 行“意图扩展摘要”。摘要只写：语义初判、项目现实扩展后路由、关键风险、验证路线、备选路径；禁止输出调试 JSON 或完整内部状态。

### Stop 可见回复证据三态

Hook closure 对入口检查块的判断必须区分三态：

| 状态 | 含义 | 行为 |
|------|------|------|
| `verified-present` | 已解析最终 assistant 可见回复，且包含 PC0~PC7 | 不提醒入口块 |
| `verified-missing` | 已解析最终 assistant 可见回复，但缺 PC0~PC7 | 提醒或 strict 阻断 `entry check block 未输出` |
| `unverified` | Stop/PreCompact 未提供可解析 assistant 内容 | 提醒“无法验证最终用户可见回复”，附 payload capture 指引；不得断言“未输出” |

### Profile 标准文件

| 文件 | 说明 | 必须 |
|------|------|:----:|
| `README.md` | profile 索引 | 是 |
| `01-项目信息.md` | 技术栈/仓库地址 | 是 |
| `02-架构约束.md` | 目录结构/模块边界 | 是 |
| `03-代码风格.md` | 编码规范 | 是 |
| `04-测试规范.md` | 测试框架/覆盖率 | 按需 |
| `05-发布规范.md` | 版本号/发布流程 | 按需 |
| `config.json` | 运行模式配置（ENV_MODE）+ agent 兜底标识 | 按需 |

### ENV_MODE 注入

| 情况 | ENV_MODE |
|------|---------|
| `config.json` 存在且 `mode: "dev"` | `dev` |
| `config.json` 不存在 / mode 缺失 | `prod`（保守默认）|
