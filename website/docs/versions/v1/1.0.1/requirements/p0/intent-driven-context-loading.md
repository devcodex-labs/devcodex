# 需求：意图驱动的上下文按需加载

> **状态**：🟢 源码、当前消费者、Profile、三宿主部署、最终资格验证与 main 推送复证均已完成；随 v1.15.2 发布
> **优先级**：P0
> **确认日期**：2026-07-17
> **适用范围**：DevCodex v1.15.2 发布增量

## 目录导航

- [背景与问题](#背景与问题)
- [目标与成功信号](#目标与成功信号)
- [核心定义](#核心定义)
- [功能需求](#功能需求)
- [兼容与质量边界](#兼容与质量边界)
- [非目标](#非目标)
- [验收口径](#验收口径)
- [当前阶段](#当前阶段)

## 背景与问题

DevCodex 的规范意图是先识别用户意图，再按任务需要加载项目 Profile 与记忆；当前执行消费者却存在三类相反行为：

- 无参 `profile_load` 默认返回当前 Profile 档位的全部标准文件。
- memory MCP 只提供完整日记和完整 `SUMMARY.md` 读取，长期项目中的“索引”已成为高载荷文件。
- Hook bootstrap 在 `PreToolUse` 阶段根据路径触碰推进状态，不能证明读取真正成功、来源正确或覆盖了当前意图所需内容。

当前样本中，完整 effective Profile bootstrap 为 84,105 bytes，最小项目/模式/索引基线为 4,422 bytes；分析前默认 memory bundle 为 180,080 bytes。这些数字只用于当前项目的设计基线，不作为跨项目硬阈值，也不冒充模型 token。

## 目标与成功信号

本需求把上下文加载改为可解释、可验证的渐进披露链：

```text
IntentSeedV1 → ContextReadPlanV1 → targeted load → ContextReadReceiptV1
```

成功后应满足：

1. 常规任务不再默认把完整 Profile、完整 `SUMMARY.md` 与整日 tasks 注入上下文。
2. 每次读取都能说明为什么选择、实际读取了什么、哪些未读、是否成功及何时升级。
3. full-read oracle 与按需计划差分时，mandatory rule miss 为 0。
4. `PreToolUse`、失败结果、错误 active root 或不可观察结果均不能形成完成证据。
5. 显式 full/audit 与现有无参外部消费者在兼容窗口内继续工作。

## 核心定义

| 概念 | 需求口径 |
|------|----------|
| `IntentSeedV1` | 每条用户消息开始时形成一次轻量意图种子；普通工具动作复用，不机械重复识别 |
| `contextEpoch` | 当前用户消息的上下文计划生命周期；compact、项目切换或关键 drift 会使相关证据失效 |
| `ContextReadPlanV1` | 记录目标项目、必需来源、排除来源、理由、freshness、advisory budget、升级条件和退出条件 |
| `ContextReadReceiptV1` | 记录实际来源、读取结果、source layer、摘要/digest、载荷、复用情况和最终状态 |
| `baseline-complete` | 只证明项目、模式与索引识别完成，不代表任务相关规则已加载 |
| `relevant-complete` | 当前意图要求的必需来源均有成功且新鲜的读取证据 |
| `required-to-exist` | Profile 档位完整性要求，只验证存在性或 schema，不自动读取正文 |
| `explicit-full-read` | audit、迁移、用户明确要求或升级条件命中时允许全读，并记录原因 |

## 功能需求

| ID | 需求 | 优先级 |
|----|------|:------:|
| F-01 | 每条用户消息建立一次 `IntentSeedV1/contextEpoch`；只有项目、范围、风险、连续性或证据 drift 才重算 | P0 |
| F-02 | 读取计划记录 selected/excluded、独立理由、authority、freshness、advisory budget、升级与退出条件 | P0 |
| F-03 | Profile 先加载 layout、effective config 与 README/index baseline，再按意图选择 01~09 及未分类候选；存在性与正文读取分离 | P0 |
| F-04 | bootstrap 的 `PreToolUse` 只能记录 attempted；成功、来源匹配且结果可观察的 `PostToolUse` 才能形成 observed-success | P0 |
| F-05 | memory 增加紧凑 status、精确 session/ContextHandoffCard 与 last-N/unresolved SUMMARY 投影；旧工具保留 | P0 |
| F-06 | 分离 baseline/relevant/full/stale/blocked；config-only、failed、wrong-root、unobservable 不得进入 relevant-complete | P0 |
| F-07 | 低置信、跨服务、公共契约、发布、安全/破坏性、引用缺失、Profile/scope drift 与显式 audit 自动升级 | P0 |
| F-08 | 记录 bytes/chars/latency/cache/escalation/full-read；tokens 只在宿主真实提供时记录 | P1 |
| F-09 | 在测试进程内用 full-read oracle 差分 mandatory sources；oracle 全文不得继续注入正式模型上下文 | P0 |
| F-10 | 同步规范 Owner、执行消费者、探针、公开文档、Profile 与部署副本；历史版本保持历史语义 | P0 |

## 兼容与质量边界

- `profile_load(files=[...])` 保持现有语义并作为内部推荐入口。
- 无参 `profile_load` 第一阶段继续返回 full 兼容结果；不得直接使既有调用失败。
- `memory_session_read` 与 `memory_summary_read` 保留；新增查询工具不得改写旧工具返回。
- instruction-fallback 宿主不能观察结果时保持 `unverified`，不得虚构 runtime 硬拦能力。
- `config.local.json` 只有用户或项目明确指定时才读取正文；Profile 完整性校验仍可检查其 schema。
- 安全底线、CP、用户/项目策略和必需证据优先于任何 token 或 byte budget。
- 已选中的 Skill 仍须完整读取；优化的是候选选择，不是截断 Skill 内容。

## 非目标

- 不在每个工具动作前重新执行完整意图识别。
- 第一阶段不新增 Profile H2/章节 manifest 或生成器。
- 第一阶段不拆分 always-on 单源规范体。
- 不直接删除无参 `profile_load` 或现有 memory 读工具。
- 不在本需求内执行 release、tag、publish 或未经单独授权的 push。

## 验收口径

| 范围 | 最小证据 |
|------|----------|
| Profile | chat/dev/docs/release/audit 选择矩阵、baseline/relevant 分离、无参兼容与显式 full |
| memory | status/session/summary 有限投影与全文 oracle 路由结论一致 |
| Hook | `PreToolUse` attempted、成功/失败/不可观察/wrong-root `PostToolUse` direct replay |
| 漂移 | project/scope/risk/evidence/compact 使旧 receipt stale，并只重载当前计划所需来源 |
| 质量 | mandatory rule miss=0；错误路径与失败结果不能假绿 |
| 性能 | bytes/chars/latency 使用真实测量；token 不可观察时明确 `N/A` 或 `inconclusive` |
| 消费者 | MCP、Hook、Skills/instructions、tests/validate、README/website/Profile 与部署副本完成当前语义联查 |

## 当前阶段

- CP1/CP2/CP3 均已确认；A0 共享契约、A1 Profile plan、A2 Hook receipt、A3 bounded memory、V99、规范 Owner、TestRoute/report/prompts 与 README/development guide 已完成分批实现和复审。
- 当前源码主链为 `IntentSeedV1 → unique project/activeRoot → ContextReadPlanV1 → targeted Profile/memory query → PostToolUse success → ContextReadReceiptV1`；同一 contextEpoch 普通动作复用计划，只有目标、scope/action/risk、digest 或 compact/resume 漂移才重算。
- fresh evidence 已证明 `mandatoryMisses=0`、`falseComplete=0`；`profile_context_plan` 规划阶段对 `01~09-*` 与 `config.local.json` 正文 hidden read=0，旧无参 Profile/memory 工具保持兼容但不再是推荐默认路径。
- 本能力是 v1.15.2 发布增量；active Profile、website build、生成链接、三宿主部署副本、portfolio 与 V1~V99 已 fresh 验证，最终发布状态以 registry/tag/R7 验收为准。
