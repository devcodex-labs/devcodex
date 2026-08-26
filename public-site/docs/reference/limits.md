# 限制与边界

## DevCodex 不是什么

- 不是模型网关，不代理、托管或选择模型供应商；
- 不是模型参数增强器，不改变参数、权重、上下文窗口或基础推理上限；
- 不是通用 Agent 框架；
- 不是多 Agent 编排器；
- 不替代宿主原生 agent loop、认证、sandbox 或主要工具执行；
- 不替代业务框架、GitHub CI、安全审计或人工评审；
- 不保证所有宿主的 Hook、MCP、插件与权限完全相同。

## 本地优先的准确含义

DevCodex 的工作流状态、Profile、报告、记忆和 Workspace Skill 以本地文件保存，普通使用不需要额外后台服务。模型执行、联网行为和数据处理仍遵循所选 AI Coding 宿主及其账号配置。

“本地优先”不表示所有代码永不离开本机，也不表示模型在本地运行。

“提升工程有效智能”也不表示底层模型变大或推理上限被改写。提升来自更准确的项目上下文、渐进专业 Skill、工作流与授权、工具和记忆协调，以及完成前验证与证据闭环。

数据位置、宿主数据处理和安全报告路径见[信任、安全与数据](/guide/trust-security-data)。

## 安装边界

| 位置 | 行为 |
|------|------|
| 用户 HOME | 安装或刷新 DevCodex 受管宿主适配器 |
| 项目 / workspace | 用户执行 `devcodex init` 后创建 `.devcodex/` |
| 项目源码 | 安装本身不自动修改业务源码 |
| 后台服务 | 普通使用不启动常驻网络服务 |
| 原生 Skill / 配置 | 不接管用户已有资产 |

## 证据边界

HTTP 200 不足以证明某个产品页面正确；配置存在不足以证明宿主可执行；测试通过也不自动证明 npm、GitHub Release 或本机已更新。DevCodex 分别记录源码、构建、发布、线上回读和本机消费证据。

遇到不确定状态时查看 [故障排查](/guide/troubleshooting) 和 [宿主边界](/reference/hosts)。

## 文档与版本边界

站点首页的版本来自 `package.json`，更新时间来自生成的 public projection。它们证明当前文档构建使用了哪组源码事实，不自动证明 npm registry、GitHub Release、用户本机或已打开会话已更新。

## 运行态协议参考

以下名称用于诊断和证据回读，不要求普通用户手工构造：

| 协议 | 说明 |
|---|---|
| `StageLoadReceiptV1` | 证明 SkillRoute 某个阶段正文已经加载；catalog 或 commit 不能替代 |
| `NextActionEnvelopeV1` | 结构化记录当前唯一恢复动作；界面通常只显示压缩后的自然语言动作 |
| `MemoryCursorV1` | 绑定工具、项目、ContextRead、查询与来源身份的分页游标，下一页必须原样回传 |
| `MemoryFileTransactionReceiptV1` | 记录 memory 文件事务的提交前后摘要、CAS、flush/readback 与字节证据 |
| `TaskAdmissionReconciliationReceiptV1` | 绑定同一准入请求的精确 readback 与幂等阶段恢复，不授予源码写权限 |
| `ArtifactMutationReconciliationInputV1` | V5 预写保存的有界 footprint + 完整 pre-observation；只用于 partial/零效果重观察 |
| `ArtifactMutationReconciliationReceiptV1` | 绑定 exact operation/closeout、primary/reserve 来源和实际效果快照；只关闭既有 pending 状态 |
| `ArtifactMutationReconciliationProjectionV1` | 压缩保留 receipt identity、recovery mode 与 recovered effect 集合，供 Hook/验证续跑复证 |
| `WorkspaceTempManifestV2` | 临时对象的 owner、目标、生命周期、TTL 与 lease 权威；V1 只读兼容 |

这些协议都采用失败关闭：绑定、来源或 scope 变化时不会静默回到第一页、猜测另一项目或自动重放修改性动作。

## 清理边界

`runtime prune` 和 `tmp maintain` 默认只预览。实际清理必须显式 `--apply`，并且只能作用于 DevCodex 可证明拥有、已经过期且没有活动 lease 的对象。用户级安装 runtime generation 还要求 `--generation-plan <完整 SHA-256>`；普通 apply 不会顺带删除。用户配置、宿主根目录、未知临时文件、共享对象和无法验证的遗留内容都不属于自动清理范围。

## 任务恢复容量边界

| 对象 | 默认边界 | 达到边界时 |
|---|---:|---|
| 正式任务数量 | 无硬上限 | 不按数量拒绝或淘汰；仍受总字节与磁盘 headroom 约束 |
| hot task slot | 256 KiB；A/B 合计 512 KiB | 拒绝超大 envelope；可重建内容不塞入恢复状态 |
| cold resume stub | 16 KiB | 只保留精确恢复主键和最小 checkpoint |
| ephemeral entry / 总量 | 8 KiB / 1 MiB | 使用有界降级；过期后退出，不提高上限容纳完整 plan |
| store soft / hard | 256 / 512 MiB | soft 安全冷化与退出缓存；hard 阻止普通 mutation |
| closeout reserve | 8 MiB A/B | 只用于 hard pressure 后的最小收口，不承担普通写入 |
| context source observations | 128 个固定槽 | 槽身份不匹配时全文 fail-safe，不新建无限文件 |
| SkillRoute turn cache | 56/48 个 high/low water；64 个语义活跃 hard；256 个原始目录 hard；28/24 MiB high/low；32 MiB hard | 空 orphan 经 grace 安全退出；压力下只回收无业务义务终态或同会话已被后继 context 取代的未提交 route；锁、身份或会话不明时不删除并在 hard limit 失败关闭 |

可通过 Profile 把 `hardLimitMiB` 提高到不小于 512 的 safe integer；soft limit 与对象级上限不会随之放大。现有项目内 legacy lifecycle generation/temp/log 只读报告，`runtime maintenance --apply` 也不会删除。

SkillRoute 的 turn cache 与正式任务数是两套边界：前者保存单轮渐进路由执行证据并允许安全终态退出；后者按 taskId 使用 V5 A/B/cold stub，正式任务数量没有硬上限。空目录不再占用 turn 名额，unknown 非空目录仍计入 hard capacity，防止损坏状态被静默忽略。

用户 HOME 下的不可变 `devcodex/runtime-*` 使用另一套租约回收合同：正式数量没有固定上限；当前、live、24 小时宽限与 unknown 证据均保留。只有完整预览计划中的 orphan candidate 可由匹配摘要显式应用。单 generation 超过 20,000 个条目、单文件 32 MiB 或整棵树 512 MiB 时停止深扫并标记 unknown，避免诊断自身造成无界内存或 I/O。

## Token 边界

停止生成磁盘快照或将其删除，不等于减少模型上下文，通常只能带来约 0～<1% 的间接 Token 变化。可量化的节省来自精确正文送达去重：实际形状基准中，每个重复响应避免 402,848 body bytes，约 80,570～134,283 token-equivalent；serialized bytes 减少 99.543%。这是按 3～5 UTF-8 bytes/token 的估算，不是宿主账单或真实 tokenizer 计数；宿主未暴露 actual tokens 时状态保持 `UNVERIFIED`。
