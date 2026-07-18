# 需求：项目侧执行链性能、任务名续接与增量分析

> **状态**：🟠 CP1/CP2/CP3 已确认；B0、B1 accepted，B2 实施中
> **优先级**：P0 正确性与性能基础 + P1 主要收益
> **确认日期**：2026-07-18
> **适用范围**：DevCodex v1 未发布增量

## 目录导航

- [背景与问题](#背景与问题)
- [目标与成功口径](#目标与成功口径)
- [用户可见续接契约](#用户可见续接契约)
- [P0 必做范围](#p0-必做范围)
- [P1 必做范围](#p1-必做范围)
- [实施批次](#实施批次)
- [验证生命周期](#验证生命周期)
- [质量与稳定边界](#质量与稳定边界)
- [条件路线图与非目标](#条件路线图与非目标)
- [当前阶段](#当前阶段)

## 背景与问题

DevCodex 已建立意图驱动的 Profile / memory 按需读取，但项目侧执行链仍有五类可验证缺口：

1. 新会话续接仍依赖较长的人工交接文本，任务改名、同名、索引陈旧和 CP digest 漂移缺少稳定处理。
2. validation 脚本图存在重复叶子，尚无 owner/dependency DAG、changed-scope、证据复用和高风险 full fallback 的统一执行器。
3. `ContextReadPlan` 的调用身份与内容身份没有完全分离，跨进程等价计划无法形成可信复用；request、response 与实际选中正文的成本口径也未分开。
4. Profile 仍以文件为最小正文读取单位，Skill bundle 尚未进入生产消费路径；大项目逐文件分析也缺少可执行的持久知识快照与选择性失效运行时。
5. 长流程已有墙钟/WIP 与 turn-liveness 约束，但 qualification、重复正式尝试、无进展停止和取消终态仍有残余缺口。

本需求把这些问题作为同一个“正确恢复 → 可信身份 → 选择性执行 → 稳定演进”闭环处理，避免只修某个当前样例。

## 目标与成功口径

完成后必须同时满足：

- 用户在新会话默认只发送 `继续<任务名>任务`，系统自行定位任务并从文件真相源恢复。
- 重复验证只执行 changed / affected / invariant closure；高风险、发布、RC、低置信和图不完整场景自动执行 full。
- Profile 读取可精确到所需章节；Skill 先做依赖闭包再选择，已选 `SKILL.md` 仍完整读取。
- 首次大项目分析保存结构化知识快照；后续只处理 changed、affected 和 lens-gap，并在失效时回退全量。
- 所有索引、缓存、快照和执行证据都可重建、可失效、可回滚，且不能覆盖需求、sessions、源码或验证真相。
- 在相同候选、硬件、入口、冷暖条件和质量门槛下，P0+P1 的项目侧综合改善目标为 25%～45%。该数值须由 CP2 冻结的可比较绿色基准证明，不是预先承诺。

## 用户可见续接契约

推荐输入：

```text
继续P0项目侧执行链性能优化任务
```

`继续 P0项目侧执行链性能优化` 也应等价。任务名只是定位信息，恢复后的状态仍以任务目录、`.memory/sessions.md`、当前 CP/计划/报告/checkpoint 和对应 digest 为准。

| 场景 | 必须行为 |
|------|----------|
| 唯一 active 名称命中 | 自动恢复并继续，不要求用户复制路径和长交接卡 |
| 跨项目同名 | 只询问一次最小消歧 |
| 任务改名 | 旧名称 alias 仍指向同一稳定任务身份 |
| 无命中 | 返回少量近似候选，不做无界全文扫描或模糊自动选择 |
| completed / rejected | 明确当前状态，不静默重开 |
| 派生索引缺失或陈旧 | 从任务身份、sessions 与 canonical artifact 有界重建 |
| CP / artifact digest stale | fail-closed，不带旧确认态进入 mutation |

`NewSessionContinuationCard` 继续作为系统内部与降级证据；面向用户的 `copyReadyPrompt` 收敛为上述短命令。

## P0 必做范围

### P0-S：续接正确性

- 稳定 taskId、displayName、aliases 与可重建派生索引。
- `UserGoalEnvelope + ExecutionSliceCard + SemanticContinuationDiff`，确保技术切片不覆盖用户原始目标、结果和收益。
- 同会话、compact/summary、resume 与新会话四类入口都按文件真相重建。
- 同一任务只有一个当前 CP/session 投影；旧版本明确 superseded。
- phase-aware 上下文读取：当前 CP1/CP2 不因未来实现或发布风险机械全读。

### P0-P：可信性能基础

- 先修复 portfolio freshness、动态派生易变 Skill 数量，并建立可比较绿色基准。
- 去除 validation DAG 的重复节点，但不减少任何唯一验证能力。
- 分离 `planContentId` 与单次 invocation / contextEpoch；旧契约保留兼容。
- 实现可证明的 hit / miss / bypass / error 与共享 invalidator；错误复用必须为 0。
- 分开记录 request、response、selected body、stage timing 与宿主可观察注入量；tokens 仅在宿主真实提供时记录。

### P0-L：长流程无进展残余

- formal run 前先 qualification。
- 记录 FirstPassYield、重复 formal attempt 与外部等待占比。
- 连续无有效进展时停止新 mutation 并写 StopSnapshot。
- 中断/取消形成 aborted/cancelled terminal，并清理仅由 AI 启动的进程。
- 复用既有 ExecutionBudget / turn-liveness 能力，不新增同职责平行 Gate。

## P1 必做范围

| ID | 能力 | 主要收益 | 保守回退 |
|----|------|----------|----------|
| P1-01 | validation owner/dependency DAG、changed/affected closure、evidence cache、checked execution | 减少非必要验证 | high-risk、release/RC、安全、低置信、图不完整时 full |
| P1-02 | Profile heading/section selector 与 mandatory fallback | 减少无关 Profile 正文 | mandatory 缺失、选择不完整或置信不足时补读/full |
| P1-03 | Skill dependency closure、bundle decision 与 references 渐进披露 | 减少无关 Skill 正文 | mandatory Owner/依赖不得因预算截断；已选 `SKILL.md` 完整读取 |
| P1-04 | `ProjectKnowledgeSnapshot`、content digest、ImpactGraph 与 lens-gap | 重复分析只重算必要范围 | 快照/图/coverage 失效或高风险审计时 full-required |
| P1-05 | 智能分批、accepted checkpoint、snapshot delta 与全局高/中/低唯一清单 | 避免长时间无反馈并可恢复 | fail/inconclusive 批次不污染 accepted 状态，不输出 final |

P1-04/P1-05 继续由 `incremental-project-analysis` 承接；性能、验证和长任务能力分别进入已有 Owner，不创建重复的“大而全性能 Skill”。

## 实施批次

| 批次 | 范围 | exit gate |
|------|------|-----------|
| B0 | portfolio、动态计数、Profile/current source identity、绿色/红色 baseline | baseline receipt 可比较 |
| B1 | 任务名续接、稳定身份/alias、派生索引、语义等强与 single-current | continuation 正负向矩阵全绿 |
| B2 | 内容身份、真实 bytes/timing、freshness reuse 与 invalidator | 跨进程和 stale mutation 全绿 |
| B3 | validation DAG、changed-scope、evidence cache、checked execution、full fallback | 唯一验证能力不减 |
| B4 | Profile section selector、Skill dependency/bundle runtime | mandatory miss=0，低置信可补读 |
| B5 | snapshot store、ImpactGraph、lens-gap、智能分批与全局优先级 | delta/oracle/恢复场景全绿 |
| B6 | prospective evolution、overhead/误报、rollback/sunset、消费者/部署/ECR | full validation + omission-only + ECR |

默认顺序为 `B0 → B1 → B2 → B3 → B4 → B5 → B6`。每批必须执行：冻结 scope → 实施 → focused validation → accepted/rollback → checkpoint；未 accepted 不进入依赖它的下一批。

## 验证生命周期

```text
V0 基线 → 每批 focused validation → 批次 accepted/rollback → 跨批集成
→ 性能对比 → 稳定演进试验 → 全局验证 → ECR
```

| 阶段 | 核心场景 | 通过条件 |
|------|----------|----------|
| V0 | source identity、portfolio、script DAG、bytes、cold/warm、当前续接 | 红基线不冒充性能通过；绿色基准可比较 |
| V1 | unique/ambiguous/missing/renamed/completed/stale/index rebuild；四类入口 | wrong task/root/CP=0；semantic diff miss=0 |
| V2 | 两独立进程、hit/miss/bypass/error 与 invalidator mutation | 错误复用=0；索引/cache 可重建 |
| V3 | DAG 去重、changed/affected/invariant、fail-fast/full fallback | 唯一能力不减；高风险仍 full |
| V4 | Profile/Skill mandatory、snapshot changed/affected/lens-gap、rename/delete/tombstone、批次恢复 | mandatory miss=0；required finding miss=0 |
| V5 | schema migration、旧 alias、prospective trial、误报/开销、rollback/sunset | 有害候选不晋级；旧契约兼容 |
| V6 | npm full、coverage、website/package/Profile/部署、负向 mutation、需求反向追踪 | falseComplete=0；所有必做项有真实证据 |

任何阶段 fail / inconclusive 时，对应批次不得 accepted，性能结论保持 provisional。

## 质量与稳定边界

- 保留 S01～S07、CP1→CP2→CP3、确认后全面复审、ECR 与 single-writer。
- `mandatoryMiss=0`、`requiredFindingMiss=0`、`falseComplete=0`、wrong-task/root/epoch/invocation/CP=0。
- release/RC、安全、破坏性、高风险、低置信、未分类、影响图或证据失效时执行 full。
- always-on 规范不通过主动删减规则来提速。
- 缓存命中只证明机器侧结果可复用；若当前会话无法证明模型已观察同一正文，仍须重新交付必要正文。
- 自然语言摘要不能充当代码内容身份、依赖图或验证证据。
- 所有易变数量从 registry/manifest 派生；后续演进须版本化、prospective trial、可观测、可回滚和可 sunset。

## 条件路线图与非目标

只有 P0/P1 绿色证据证明收益大于维护成本后，才另行确认原子 `context_bundle`、原子 `workflow_finalize`、隔离验证并行或持久 worker；这些不计入当前完成。

当前明确不做：

- 模型选择、模型路由或模型 TTFT 优化。
- SSE 实施或把 SSE 并入本任务。
- always-on 主动瘦身。
- 第三方依赖升级。
- push、tag、publish 或 release；本轮只授权 ECR 与工作区同步通过后的本地 commit。

## 当前阶段

- CP1 v0.4、CP2 v1.0、CP3 v1.0 均已按确认前全文 SHA-256 绑定。
- CP2 确认后全面复审 30/30、CP3 确认后全面复审 32/32，均为 zero blocker。
- B0 已修复 portfolio/Profile/current docs freshness 并冻结 comparable-green；B1 已交付稳定 taskId/alias、bounded index/resolver 与 CLI/MCP/Hook 四入口，V1 wrong task/root/CP 为 0。
- 当前严格进入 B2：分离 Context invocation/content identity、computation reuse 与正文交付复用；尚未宣称 validation DAG、Profile/Skill 渐进加载或增量知识已完成。
- 工作区同步与最终本地 commit 已授权；push、tag、publish、release 未授权。性能目标仍须 B6 真实基准与质量门禁证明。
