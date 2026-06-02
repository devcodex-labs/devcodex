# 开发规范

> AI 在执行 dev/fix 工作流时，除遵守 instructions 约束外，还须遵守本页项目级规范。

---

## 各组件使用规范

> 遇到新任务时，先判断用哪个组件，再动手创建文件。

| 场景 | 用哪个组件 | 理由 |
|------|-----------|------|
| 需要始终约束 AI 的规则 | Instructions | 每次会话自动注入，不需要手动触发 |
| 按需触发的工作流 | Skills（SKILL.md 完整内容）| AI 按需读取，包含完整工作流检查标准与执行步骤 |
| CP 节点的结构化输出 | Prompts | 有参数、有格式的单次任务 |
| 会话开始/结束的自动动作 | Hooks | 确定性执行，AI 无法跳过 |
| 定义 AI 的工具权限和运行模式 | Agents | 只有两个（确认模式/全自动模式）|

> ℹ️ **当前实现**：SKILL.md 包含完整的工作流内容（触发条件 + 检查标准 + 执行步骤）。v2.0.0 规划中可能演进为 Skills（薄壳路由）+ MCP 工作流分离架构。

---



| 文件 | 何时填写 | 填写内容 |
|------|---------|---------|
| `design.md` | CP2 方案确认后 | 技术方案、文件变更清单、风险与约束 |
| `plan.md` | CP3 实施计划确认后 | Phase 分阶段步骤表（步骤/文件/说明/状态）|
| `progress.md` | 每次会话后更新 | 各步骤状态更新 + 会话记录追加 |
| `decisions.md` | 有重大决策时 | D-NNN 格式，记录背景/决策/原因/影响 |

> ⛔ `design.md` 和 `plan.md` 在对应 CP 通过前**不填写实质内容**，只保留"待撰写/待制定"占位。

---

## 组件使用规范

> 核心原则：**用对组件**——不要把工作流内容放进 Instructions，也不要把全局约束放进 Skills。

| 场景 | 用哪个 | 禁止误用 |
|------|-------|---------|
| 定义 AI 身份和工具权限 | **Agents** | ❌ 不要写进 Instructions |
| 按需触发的工作流技能 | **Skills** | ❌ SKILL.md 包含完整内容（触发条件 + 执行步骤） |
| 始终有效的规范约束 | **Instructions** | ❌ 不要写进 SKILL.md |
| CP 节点结构化输出 | **Prompts** | ❌ 不要在 SKILL.md 内联模板 |
| 生命周期事件强制执行 | **Hooks** | ❌ 不要用 Instructions 模拟 Hooks |

### Skills 编写规范

```markdown
---
name: dev-default              # 必须与文件夹名完全一致
description: "Use when: ..."   # 必填，AI 靠这个发现 Skill
---

# dev-default Skill

## 触发条件
...

## 执行步骤
...

## 检查标准
...
```

- SKILL.md 包含完整的工作流内容：**触发条件** + **执行步骤** + **检查标准**
- 每个 Skill 目录只有一个 `SKILL.md`，扁平一级目录
- 支撑型 Skill（如 `execution-contract` / `test-router` / `release-verification` / `host-contract-verification` / `source-consumer-sync`）不能新增工作流分支；必须被 instructions、模板、报告、validate 与用户文档同时消费
- 发布前审查使用 `audit-release` 专项维度，负责 release readiness 风险审查；它与 `release-verification` 的 R0~R7 执行验证链必须保持边界清晰
- README / 用户使用文档默认通过 `readme-authoring` 收口用户 / 使用者优先写作，完成后再用 `audit-readme` 做专项 review
- audit 会先执行 `Profile Freshness Check`，反向核对 Profile 是否仍匹配当前包版本、目录资产、脚本、发布状态、宿主能力和任务现实；不得基于过期 Profile 宣告收敛
- 所有模式下若用户建议经验证更优且可泛化，或暴露规范未定义/不完整，应主动触发 Improvement Intake：写入 `data/process-improvements.md`（优化清单，PI），必要时联动 `data/pending-fixes.md`，并显式回执 `PI/PF`
- 若新的需求、bug 或批次直接来源于 `data/*.md` 的 open/partial 项，进入 CP1 / 问题确认前必须先做 Backlog Intake 真相复核：把候选项分成 `pure-open / residual-tail / already-fixed / misclassified`，避免把“已修但未回写”的条目继续按纯 open 统计
- 当实施或复审改变了 VL / PF / PI / ISSUE / GAP 的真实状态时，必须执行台账状态回写闭环：回写状态、验证证据、验证时间和关闭/部分完成说明，并复核 open 计数是否与进度、报告、SUMMARY 一致
- 新增/升级依赖、框架、SDK、平台 API 或外部模块时，CP2 必须包含 `OfficialDocsEvidence`：官方文档来源、版本/日期、关键用法、限制、兼容性和降级来源；不能只验证“包能安装”
- dev/fix 改动项目技术栈、目录边界、脚本、测试/发布路线、分发面、配置项、长期连接或本地 overlay schema 时，必须执行 `ProfileImpactCheck`，同步 Profile 或在报告中写明 `skipReason`
- 通用工程守门：Node.js 项目默认 `engines.node` / CI / Profile / README 不低于 `>=18`；JS/Node 必要注释使用标准 JSDoc；依赖升级或兼容修复必须拆分 `业务源码平滑性` 与 `依赖层落地条件`；包/库/adapter/CLI 同时检查代码实现层和包工程层；简单 service 不重复 route/model/schema 已承担的校验、归一化和配置兜底
- v2.0.0 规划：MCP `devcodex_getWorkflow()` 替代文件读取



| 文件 | 何时填写 | 填写内容 |

1. **更新步骤状态**：在 `progress.md` 对应步骤行，将 `⬜` 改为 `🔄`（进行中）或 `✅`（完成）
2. **追加会话记录**：在 `progress.md` 会话记录表追加一行

   ```markdown
   | 2026-04-04 | 简述本次做了什么 | 完成了哪些步骤 |
   ```

3. **需求完成时额外执行**：
   - 更新 `index.md` 页眉状态为 `✅ 已完成`
   - 更新 `requirements/index.md` 总览表状态列
   - 在 `CHANGELOG.md` 追加完成记录

---

## 关键决策记录格式（decisions.md）

```markdown
## D-NNN：<决策标题>

**日期**：YYYY-MM-DD
**背景**：[为什么需要做这个决策]
**决策**：[决定了什么]
**原因**：[为什么这样决定]
**影响**：[对哪些文件/模块有影响]
```

- `NNN` 从 `001` 起递增
- 只追加，不修改已有记录
- 最新决策在最下方

---

## 执行上下文（当前规则）

`.devcodex/profile/config.json` 中的 `mode` 字段当前已经参与正式的 `ENV_MODE` 行为分叉，不再是 Draft 或预留能力。

当前规则：

- **`mode: "dev"`**：进入实质任务前输出 PC0~PC7 入口检查，PC4 执行完整规范雷达，并在收尾执行 FC / SC / RC / T 合规检查
- **`mode: "prod"`**：进入实质任务前仍输出 PC0~PC7 基础入口检查，PC4 标注 N/A；不执行后置合规检查，但 CP1 / CP2 / CP3 仍然强制
- **执行模式与 `ENV_MODE` 分离**：确认模式 / 全自动模式属于 Agent 入口语义；当前全自动正式入口包括显式 `@devcodex-auto` 与明确自然语言 auto 授权，且只有在 hook-enforced 宿主 + 白名单路径上形成 runtime 级自动推进；模糊提及、询问 auto 规则或普通“继续”不算授权

> 当前正式规则源以 `instructions/01-common.instructions.md`、`instructions/17-compliance.instructions.md` 和 `skills/cp-gate/SKILL.md` 为准；本页负责解释这些规则如何落到日常开发流程中。

### 项目现实扩展

日常开发中，DevCodex 不应只按用户字面关键词决定工作流。当前正式流程为：

```text
语义意图初判 → 目标项目/Profile 加载 → 项目现实扩展 → 最终工作流/子类型
```

项目现实扩展至少要检查目标项目、真实影响范围、关联文件族、产物落点和验证方式；若项目未明确，必须先澄清，不能为了扩展意图而无界扫描工作区。

### Intent Expansion Card

非 chat 工作流在 CP1 / 问题确认前需要形成 Intent Expansion Card，记录 `semantic`、`project`、`continuity`、`action`、`domain`、`artifact-impact`、`risk`、`host-capability`、`validation-route`、`confidence`、`alternatives`。这张卡用于把入口判断、CP 产物和压缩恢复后的复核锚在同一组事实上。

dev 模式默认向用户展示完整 Intent Expansion Card；prod、instruction-fallback 宿主或低风险轻任务才退化为 3~5 行摘要。

当项目现实扩展导致路由变化、命中控制面或宿主能力差异、风险不为 normal、`confidence` 非 high，或跨会话 resume 时，用户面还应输出 3~5 行意图扩展摘要。摘要只保留语义初判、扩展后路由、关键风险、验证路线和备选路径。

### Context Rehydration Contract

压缩恢复、resume、summary 恢复，或用户明确要求“按文件真相重建”时，必须按以下优先级重建上下文：

1. 当前用户消息
2. 已确认需求/bug 产物
3. 当前任务 `sessions.md`
4. 当日 `tasks/YYYYMMDD.md`
5. Agent `SUMMARY.md`
6. compaction / summary 摘要
7. AI 当前推断

摘要只能作导航提示，不能覆盖文件真相源；若文件态和当前推断冲突，必须重建 Intent Expansion Card。

### Hook closure 三态

Hook Stop / PreCompact 的可见回复验证区分 `verified-present`、`verified-missing`、`unverified`。无法解析最终 assistant 内容时，提示“无法验证最终用户可见回复”并给出 payload capture 指引；只有已解析且确实缺入口检查时，才提示 `entry check block 未输出`。Codex adapter 默认注册 `PreCompact`，并用 `manual|auto` matcher 覆盖手动与自动压缩触发。

### ECR 执行闭环复审

dev/fix 完成前必须执行 ECR 执行闭环复审。ECR 会交叉验证 CP1/CP2/CP3、报告、daily tasks、SUMMARY、diff/commit、测试/探针和 git dirty 边界，确认没有“报告已完成但证据不足”或“SUMMARY 已完成但 daily 仍未闭环”的状态错配。

当任务触发 ExecutionContract、TestRoute、ReleaseAudit、ReleaseVerification、ConceptSyncMap、HostContractVerification 或 `05-实施进度.md` 时，ECR 必须把这些产物纳入关键证据；未触发时报告中写明 N/A 依据。

控制面或模板-示例-校验链任务要先建立 Concept Sync Map：至少写清 `sourceOfTruth`、`currentConsumers`、`historicalMirrors`、`validateProbes`、`deployCopies`、`yellowDeviationBoundary`。其中当前消费者必须同批同步，历史镜像只有在明确标注历史性质时才允许保留旧口径。

`OfficialDocsEvidence` 与 `ProfileImpactCheck` 属于 dev/fix 的前置和收尾证据：前者防止依赖、框架、SDK 或平台 API 用法靠猜；后者防止项目事实已经变化但 Profile 仍停留在旧技术栈、旧目录或旧验证路线。

Hook / CLI / visible reply / sticky project / workspace guard 相关任务还要补 HostContractVerification 证据：至少说明 `hostSurface`、`eventScope`、`evidenceMode`、`visibleReplyEvidence`、`workspaceGuard` 与 `bootstrapScope`，避免把“文档已经写了”误当成宿主行为已验证。

### Profile 本地私有配置

`.devcodex/**/profile/config.local.json` 用于本地私有 overlay 与连接配置唯一入口：长期连接、env 引用、已授权本地明文秘密、受控扩展位 `extensions.<namespace>`。它不替代 `config.json`，也不能覆盖 `mode` / `agent` / `pluginVersion`。脚本、测试、数据库 / SSH / MongoDB / 数据操作连接信息必须先从这里取得；缺失文件或字段时提醒用户补齐，不得自行发明 `.env` 文件、环境变量名或并行配置格式。若项目使用了本地连接别名或扩展位，需在 `01-项目信息.md` 或 Profile README 说明用途、字段语义和使用方式；报告、记忆和日志不得回显秘密明文。

### 诊断与排错入口

- `devcodex doctor`：查看当前宿主、Hook、Profile、记忆与 adapter 状态，适合先判断“规则到底有没有加载”
- `devcodex help`：查看 CLI 子命令与参数，尤其是 `profile init`、`migrate-layout`、`init/update --claude/--codex`
- `DEVCODEX_HOOK_ENFORCEMENT`：默认 `safety-only`，仅危险命令硬拦；切到 `strict` 前应先确认宿主确实支持对应 Hook 事件；当前 Codex adapter 已内置 `PreCompact` compaction runtime 兜底
- `.mcp.json` 目前只由 Claude Code adapter 自动写入；Codex / Copilot 若宿主支持 MCP，需要手工配置，不能把 Claude 的 `.mcp.json` 当成三宿主通用入口

### 产物链接与 MCP fallback

用户面产物路径必须按 `ArtifactLinkSet` 输出：主 Markdown 链接 + 必要 `绝对路径：` copy fallback。Copilot / JetBrains / Visual Studio 默认使用工作区相对 Markdown 链接，并强制追加绝对路径 fallback；Codex Desktop/App 可使用绝对路径 Markdown target；未知宿主或用户已反馈“无法点击”时同样必须追加绝对路径。

若 Copilot / Codex 等非 Claude Code 宿主在 `profile_load`、`profile_get_mode` 等 MCP 工具上出现 `Cannot read properties of undefined (reading 'invoke')`，按宿主 MCP bridge 失败处理：不要反复重试同一 MCP 调用，立即降级读取 `.devcodex/**/profile/`、`SUMMARY.md` 与当日任务记忆，并在 HostContractRoute 中记录 `mcpFallback=used`。

### 推荐结论与确认交互

分析、审计或执行报告存在多个建议/路径时，必须给出推荐结论与推荐理由；没有后续动作时写明“推荐：无后续动作”。用户确认先抽象为 ConfirmationRequest，再按宿主能力使用按钮、权限提示、Hook 阻断或文本确认 fallback。

ConfirmationRequest 是语义层抽象，不要求 runtime 逐字输出同名对象；不同宿主只需输出与各自契约匹配的按钮、阻断或文本确认结果。

### 执行期 CP3 回退

若 dev/fix 任务在执行过程中实际变更范围扩展到 CP3 门槛（≥5 文件、高风险、控制面联动），必须暂停执行、回补 CP3，并把新增验证与回滚路线写入实施计划后再继续。

### 相关文件联查

当前正式规则要求：当任务涉及控制面规则、模板、接口契约/验证产物、工作区真相源/部署副本或发布口径变更时，AI 不能只看单文件结果，必须联查相关文件；若同时命中多真相源同步或模板-示例-校验链，需进一步升级为交叉验证或 `CRS`。

进度产物不是小任务默认文书；但跨多轮/多阶段、阻塞、用户要求持续跟踪、多批次、预计修改 ≥10 文件、控制面任务、模板-示例-校验链或部署同步联动时，必须在执行前初始化 `05-实施进度.md` 并随批次更新。

---

## 架构约束动态更新说明

> ⚠️ **v1.0.0 仍在开发中**，`02-架构约束.md` 是动态演进的，不代表最终态。

- AI 读取时以**文件当前内容**为准，不推断或补全未写入的约束
- 发现新的约束边界 → 立即追加到 `02-架构约束.md`
- 约束废弃时 → 注明"已废弃：原因"，不直接删除（保留变更历史）

---

## 规范文件编写规则

| 规则 | 说明 |
|------|------|
| 语言 | agents/skills/instructions/prompts 统一用**中文**编写 |
| Skill 目录 | 必须是扁平一级目录，`name` 字段与文件夹名完全一致（小写+连字符）|
| Instructions | `applyTo: "**"` 全局注入，单文件 ≤ 500 行 |
| 文件名 | Instructions: `NN-<kebab>.instructions.md`；报告: `NN--<简述>.md`（双横杠）|
