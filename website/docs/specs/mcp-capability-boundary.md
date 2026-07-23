# MCP 能力边界与载体决策

本页回答两个问题：DevCodex 当前有哪些能力可以明确列为 MCP，以及新增能力时应写规则 / Skill，还是设计成 MCP。

## 当前已实现的 MCP

DevCodex 当前只有两个本地 stdio MCP server。源码握手协议为 `2024-11-05`；当前实现没有 MCP Resource、Resource Template 或 Tasks。

| server | 已实现 primitive | 当前入口 |
|---|---|---|
| `devcodex-memory` | 10 Tools | `memory_task_resolve`、`memory_status`、`memory_session_query`、`memory_summary_query`、`memory_session_allocate`、`memory_session_read`、`memory_session_write`、`memory_cp_confirm`、`memory_summary_read`、`memory_summary_append` |
| `devcodex-profile` | 5 Tools + 1 Prompt | Tools：`profile_context_plan`、`profile_load`、`profile_skill_plan`、`profile_get_mode`、`profile_compose_entry_check`；Prompt：`devcodex-init` |

“源码中有 Skill、Prompt 文件或 CLI 命令”不等于它已经是 MCP。只有 server 实际在 `tools/list`、`prompts/list` 或相应协议 primitive 中暴露，并通过握手和调用验证，才能标为已实现。

## 新增能力先做什么

新增或改变能力入口时，先由 `spec-governance` 生成中央 `CapabilitySurfaceDecisionV1`。领域 Skill 负责提供业务/架构证据，并只保存 `decisionRef` 等本地元数据；不得自行复制中央选择字段或直接决定“新建 Skill/MCP”。

最小顺序：

1. 描述能力目标、真实消费者、输入输出和失败语义。
2. 判断它主要是语义判断、内容交付、确定性操作、长任务、低频运维还是宿主事件。
3. 冻结控制方、read/write/execute、权限、状态 owner、事务边界和 fallback。
4. 核对目标宿主与 MCP 协议的直接证据。
5. 由中央 decision 选择载体，再由对应 Owner 实施和验证。

decision 缺失，或 `identity` 因 schema、source、evidence、host、protocol、consumer、runtime owner 变化而失效时，状态必须进入 `stale/blocked`，不能继续创建或激活能力资产。

## 载体选择

| 能力本质 | 默认载体 | 何时考虑 MCP |
|---|---|---|
| 开放式语义判断、审查、路由、治理规则 | Rule / Skill | 不把模型判断伪装成确定性 Tool |
| 可复用的用户发起模板 | 本地 Prompt 或 Rule / Skill | 只有宿主协商 MCP Prompt、用户可发现且输入边界稳定时，中央 decision 才选择 MCP Prompt |
| 有界、可寻址、主要用于读取的内容 | 现有文件/Skill 读取链 | server 拥有内容、URI/freshness/payload bound 明确时，可选择 Resource / Resource Template |
| 参数明确、结果确定、需要应用主动调用的操作 | Tool | 需要宿主协商、权限与调用回执；write/execute 必须有 authority |
| 长时间运行、可取消/轮询的操作 | 有界 Tool 或 CLI | 只有 Tasks 能力已协商，且 cancellation/TTL/polling/fallback 均冻结时，才选择 Task 增强 Tool |
| 安装、升级、诊断、批量维护等低频 operator 操作 | CLI | 不因“能包装成 Tool”就迁入 MCP |
| UserPromptSubmit、PreToolUse、Stop、PreCompact 等宿主生命周期事件 | Hook | MCP 不替代宿主事件与硬拦能力 |

## Rule / Skill 与 MCP 的职责边界

- Rule / Skill 表达“如何判断、何时触发、需要哪些证据、何时阻断”。
- MCP primitive 表达“宿主可发现并调用什么确定能力或内容”。
- MCP server 负责协议、权限、状态、事务、取消、幂等、回执和审计边界。
- CLI 负责低频、显式、operator-controlled 的安装维护行为。
- Hook 负责宿主事件时序；没有宿主直接证据时不得声称可以硬拦或自唤醒。

一个能力可以由 Skill 负责语义编排，再调用既有 MCP Tool；这不意味着要为该 Skill 新建 server 或新增 Tool。新增 server 应以独立 runtime owner、事务/权限边界、部署和版本生命周期为依据，不能按功能名称或 Tool 数量拆分。

## MCP 版本与兼容口径

能力决策同时记录三个基线：

| 基线 | 用途 |
|---|---|
| implemented protocol | 当前源码真实握手版本；本项目目前为 `2024-11-05` |
| reference protocol | 当前官方稳定规范，用于识别已存在但尚未实现的能力 |
| migration candidate | 已锁定但尚未采用的候选/后续规范，只用于迁移分析，不得写成当前能力 |

官方版本策略见 [MCP Versioning](https://modelcontextprotocol.io/docs/learn/versioning)。未来协议、stateless 变更或 Tasks extension 必须在实际升级、协商和 direct replay 前保持 `UNVERIFIED`；预发布说明可作为迁移证据，不能替代实现证据。

## 验证要求

能力面变化至少执行：

```bash
npm run test:capability-surface-decision
npm run test:control-plane-contracts
npm run test:spec-governance
```

触达 MCP runtime 时追加 `node scripts/test-mcp-servers.js`；触达宿主、Profile、包或部署副本时，再按 `CapabilitySurfaceDecisionV1.validationRoute` 追加 host、profile-deploy、package 和 workspace deployed-copy 验证。

完成结论必须同时给出中央 `decisionRef`、identity、新鲜度、消费者同步和直接运行证据。文档存在、fixture 自洽或宿主名称均不能单独证明 MCP 已实现。
