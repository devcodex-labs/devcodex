# 架构怎么跑

## 你在问什么

一条请求进去之后，DevCodex 先判断你要做什么，再决定读哪些项目资料、加载哪些 Skill、会不会改文件。它是跨宿主 AI Coding 工程 Harness，不代替模型思考，也不托管模型。

## 心智模型

把 DevCodex 看成本地的工程 Harness：技术上是 intent-driven、local-first、file-backed 的工作流运行时与宿主适配层。

1. 识别意图和项目边界。
2. 按需读取 Profile、记忆和相关源码。
3. 只加载当前阶段需要的 Skill。
4. 在确认边界内执行，用验证和报告结束，必要时跨会话续接。

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

状态、报告和记忆写在项目本地文件里。模型调用仍走你选的宿主。

## 任务恢复状态

任务恢复按正式需求/任务保存，不按 Hook 事件保存。恢复身份同时绑定 active-root、project 与 task ID；每个正式任务只有稳定的 hot A/B 状态，具备安全 checkpoint 后可降为小型 cold resume stub，terminal 状态会退出 hot cache。普通只读 Hook 不写完整状态。

正式任务数量没有硬上限，但磁盘预算有：默认 soft/hard 为 256/512 MiB，另有 8 MiB closeout reserve。soft pressure 只冷化可恢复状态、回收过期 terminal/ephemeral 与 writer-owned temp；hard pressure 阻止新的普通 mutation，仍允许最小 closeout。系统不会为了满足数量限制静默淘汰正式任务。

旧 `.devcodex/**/.memory/hooks` lifecycle generation/temp 只读保留，不由新维护命令删除。辅助证据也使用固定槽或固定 ring，例如 context source observations 最多 128 个 V4 槽，避免主状态收敛后从支撑目录重新形成事件级文件链。

用户 HOME 下各宿主的不可变安装 `runtime-*` 是独立层：长驻 Profile/Memory MCP 与 global-host activation 维护稳定 lease；固定 adoption state 记录本机首次采用时间。维护命令只把非 current、无 live lease、已过本机 24 小时宽限且 ownership/path/manifest/tree 全部可证的目录列为 orphan candidate。删除需要精确计划摘要，GC claim 与激活 lease 双向互斥；崩溃遗留 claim 仅在超龄且 PID 明确死亡后通过固定恢复槽接管，未知证据永远优先保留。内部证据绑定完整集合，用户 JSON 只显示有界样本，避免诊断本身扩大上下文。

正文送达去重是另一层合同：只有 formal task、conversation、context epoch、project/root、source digest、body digest 与 bytes 全相等，且正文已经被观察送达时才返回小型复用描述；任一不一致都返回全文。它能减少重复上下文，不等于删除磁盘文件。

## DevCodex 与宿主各自负责什么

| DevCodex owns | Host owns |
|---|---|
| 意图与项目路由、Profile / context / memory、渐进 Skill | 模型推理与原生 agent loop |
| 确认与授权边界、验证、报告、证据与续接 | 主要工具执行、会话传输与生命周期 |
| 六宿主适配与共享工程契约 | 认证、sandbox 与运行环境 |

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
