# 架构怎么跑

## 你在问什么

一条请求进去之后，DevCodex 先判断你要做什么，再决定读哪些项目资料、加载哪些 Skill、会不会改文件。它是跨宿主 AI Coding 工程 Harness，不代替模型思考，也不托管模型。

## 心智模型

把 DevCodex 看成本地的工程 Harness：技术上是 intent-driven、local-first、file-backed 的工作流运行时与宿主适配层。

1. 从当前用户真实指令形成工作项和 workflow，不让附件或工具输出改写目标。
2. 绑定唯一 project、active-root 和正式 task，再按需读取 Profile、记忆和相关源码。
3. 只加载当前阶段需要的 Skill。
4. 在任务与产物授权边界内执行，用范围匹配的验证和报告结束，必要时跨会话续接。

<ol className="devcodex-process-flow devcodex-process-flow--five" aria-label="DevCodex 从请求到交付的五个阶段">
  <li>
    <strong>用户请求</strong>
    <span>先理解最终要结论还是变更。</span>
  </li>
  <li>
    <strong>意图与项目</strong>
    <span>识别 workflow，并绑定唯一 active-root。</span>
  </li>
  <li>
    <strong>有界上下文</strong>
    <span>按需读取 Profile、记忆和相关源码。</span>
  </li>
  <li>
    <strong>专业执行</strong>
    <span>加载当前 Skill，保持只读或在确认后写入。</span>
  </li>
  <li>
    <strong>证据闭环</strong>
    <span>验证、报告，并留下可续接锚点。</span>
  </li>
</ol>

工作流决定“能不能写、何时确认、怎样算完成”；Skill 负责某个专业问题；Hook 与 MCP 只是宿主可用时的执行手段，不能反过来改变用户目标。

控制层会先构造 `ActualInstructionEnvelopeV1`：用户当前请求是 authority，附件、截图/OCR、引用文档、工具输出和 ambient UI 只作为 evidence。复合请求先形成 `WorkItemSetV1`，每个工作项通过 `WorkflowRouteDecisionV2` 确定 workflow/subtype；route 未确定前不能准入正式任务或开始写入。

状态、报告和记忆写在项目本地文件里。模型调用仍走你选的宿主。

## 任务恢复状态

任务恢复按正式需求/任务保存，不按 Hook 事件保存。会话索引只保存固定 A/B 的最小 project hint；恢复必须再通过 `ProjectTargetLeaseV2` 同时核对 session、project、active-root、context、route 与 task。每个正式任务只有稳定的 hot A/B 状态，具备安全 checkpoint 后可降为小型 cold resume stub，terminal 状态会退出 hot cache 并解绑旧 owner。普通只读 Hook 不写完整状态。hot 槽使用紧凑 JSON，容量检查、usage ledger 预充和实际写盘按完全相同的序列化字节计量，缩进空白不会消耗任务状态上限。

正式任务数量没有硬上限，但磁盘预算有：默认 soft/hard 为 256/512 MiB，另有 8 MiB closeout reserve。soft pressure 只冷化可恢复状态、回收过期 terminal/ephemeral 与 writer-owned temp；hard pressure 阻止新的普通 mutation，仍允许最小 closeout。系统不会为了满足数量限制静默淘汰正式任务。

旧 `.devcodex/**/.memory/hooks` lifecycle generation/temp 只读保留，不由新维护命令删除。辅助证据也使用固定槽或固定 ring，例如 context source observations 最多 128 个 V4 槽，避免主状态收敛后从支撑目录重新形成事件级文件链。

用户 HOME 下各宿主的不可变安装 `runtime-*` 是独立层：长驻 Profile/Memory MCP 与 global-host activation 维护稳定 lease；固定 adoption state 记录本机首次采用时间。维护命令只把非 current、无 live lease、已过本机 24 小时宽限且 ownership/path/manifest/tree 全部可证的目录列为 orphan candidate。删除需要精确计划摘要，GC claim 与激活 lease 双向互斥；崩溃遗留 claim 仅在超龄且 PID 明确死亡后通过固定恢复槽接管，未知证据永远优先保留。内部证据绑定完整集合，用户 JSON 只显示有界样本，避免诊断本身扩大上下文。

正文送达去重是另一层合同：只有 formal task、conversation、context epoch、project/root、source digest、body digest 与 bytes 全相等，且正文已经被观察送达时才返回小型复用描述；任一不一致都返回全文。它能减少重复上下文，不等于删除磁盘文件。

## 正式任务与写入授权

正式 `dev` / `fix` 在 source mutation 前由 server-owned admission 一次性建立 task identity、需求概况和 fenced write owner。用户直接提供产品需求时，`00-需求概况.md` 保存来源/范围/映射，`01-产品需求.md` 保存用户原文且 AI 不得改写。重复 ingress 复用同一准入，内容冲突或 readback 篡改失败关闭；简单任务只能使用限定两条精确路径、两次消费的 server-issued lease，任何扩大都会升级正式任务。

每次正式写入按 `MutationFootprintV2 → ArtifactSlotDecisionV2 → TaskOwnedMutationLeaseV2 → V5 prewrite → MutationObservationReceiptV1` 闭环。也就是说，系统先知道哪个工具可能改哪些路径、这些路径属于哪个正式槽位，再签发一次性写授权；工具结束后还要观察 create/modify/delete/move/no-op 的真实效果。unknown writer、越过 active-root、错误 task/slot、重复消费或无法观察结果都会停止，而不是靠工具名称猜测。

失败关闭也必须可恢复。任务准入在阶段文件已经精确落盘但返回失败时，会用同一请求确定最大完整阶段前缀，再幂等补齐阶段内缺失文件；artifact closeout 则由 server-owned `memory_artifact_mutation_reconcile_v1` 绑定当前 ingress、同会话正式任务、operation/CAS 与实际文件系统快照。完整效果直接复证，partial/零效果从 V5 预写的完整 pre-observation 对同一 footprint 重观察。它只关闭既有 pending 状态，不修改文件、不替代宿主权限；emergency reserve 也只能接管主状态中 operation、decision、lease 与 footprint 全部一致的未结束写入。

Memory 会话分配、会话写入、SUMMARY 与 CP 写入本身已经由 `MemoryFileTransactionV1` 持有 CAS、锁、持久化和读回，因此 Hook 只保留实际指令、项目/session route 与入口时序检查，不再把它们的逻辑 URI 二次包装成普通文件 mutation closeout。签发 task/operational lease 或执行 reconciliation 的控制 Tool 同样不会自消费它正在签发或恢复的权限。不同宿主暴露的下划线、连字符、slash、双下划线与 flat MCP 名称先归一到同一 canonical Tool；第三方同名 Tool 不会被信任。每次 server-owned authority 调用还会重新验证 ProjectTargetLease 的摘要、时效、context/route、active-root 与工作区当前物理项目根，不能用陈旧 projection 扩大文件根。

Artifact reconciliation 的恢复观察完全由原 mutation footprint 决定：exact target 不接受额外路径，controlled root 只接受声明根内的绝对后代。目录遍历会逐层验证逻辑/物理 containment 和对象身份，文件摘要在 descriptor 与当前路径的读前读后状态一致时才成立。正式任务恢复必须同时绑定 exact taskId；纯链接投影不会进入写入 closeout。

## 验证为何不会默认越跑越大

`VerificationIntentV2` 把当前任务、用户范围、candidate、HEAD、dirty scope、影响面和预算绑定成计划；执行前再由独立 lease 绑定 actor、plan digest、deadline 和撤销状态。普通 edit/fix 只运行受影响的 V0～V2，V3/full 只能由当前明确的发布前全面审查或 release policy 授权。运行态依赖检查与 npm packlist 也是两个入口，避免一个看似普通的专项测试暗中触发 pack、全局安装或宿主部署。

当 confirm 模式的非发布计划预计超过 600 秒或包含 heavy 节点时，系统保存唯一的当前预算卡并展示精确摘要；用户确认“当前验证卡”即可，不需要复制长 digest。有效 `@rocky` / Auto 可以直接授权当前正式任务的 V0～V2，但不能继承到 V3/full 或发布。验证失败后，系统可凭完整 mutation observation，或同一 HEAD 且没有新增 dirty 路径、节点和预算的稳定候选，最多自动续跑两次；范围、副作用、hard timeout 或日志预算扩大时必须重新授权，第三次失败会停止而不是暗换新根卡。plan-only 预览会执行与真实运行相同的续权资格检查，但不会写入或消耗续权。严格后继候选只有在 level、purpose、边界、节点、heavy、副作用和全部预算逐项完全相等时才能换根；当前 fresh server-owned Auto 可以在同 task/project/root/session/revocation 下重绑 context/AutoRef 并保留父 lineage，过期入口只可沿用原绑定。已提交修复必须显式绑定冻结 changed files，不能因工作树已 clean 而缩小验证范围。暂停、停止或缩小范围会立即撤销待执行卡、续权与运行 lease。

长验证由 managed runner 持有自己的进程和单一终态；取消、超时、崩溃或重启都必须留下可回读结果，并且只能清理由本 runner receipt 精确拥有的进程/临时产物。

## DevCodex 与宿主各自负责什么

| DevCodex owns | Host owns |
|---|---|
| 意图与项目路由、Profile / context / memory、渐进 Skill | 模型推理与原生 agent loop |
| CP、任务写权、验证/发布工作流授权、报告、证据与续接 | 主要工具执行、会话传输与生命周期 |
| 六宿主适配与共享工程契约 | 文件/命令操作权限、认证、sandbox 与运行环境 |

DevCodex 不改变模型参数、权重、上下文窗口或基础推理上限。它提升的是模型在明确上下文、专业流程、工具、记忆和验证证据支持下完成工程任务的有效表现。

## 示例

你说「分析当前架构风险，只分析不改文件」。控制层会把它判成只读的 `analyze`，不会进入改代码的确认。

你说「为这个 API 增加幂等，确认后实施」。它会走 `dev`，先整理需求再改文件。

## 边界

- 不是模型网关，不代理调用。
- 不是通用 Agent 框架，也不会因为加载某个 Skill 就改掉你的目标。
- 六个宿主流程一致，Hook、MCP、权限并不完全相同。见 [宿主边界](/reference/hosts)。
- configured 只表示配置存在，adapter contract、native probe 和最终 readiness 仍要分别取证。
- 报告和记忆是恢复依据，不是绕过当前文件事实与原确认边界的授权。
- 任务数量无硬上限不表示磁盘无限写入；字节 hard limit、磁盘 headroom 和 closeout reserve 仍会失败关闭。

## 相关页

[意图驱动](/concepts/intent-driven) · [Profile、上下文与记忆](/concepts/profile-context-memory) · [工作流总览](/workflows/) · [5 分钟开始](/guide/getting-started)
