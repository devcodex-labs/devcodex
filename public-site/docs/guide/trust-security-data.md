# 信任、安全与数据

DevCodex 是跨宿主 AI Coding 工程 Harness，技术上是本地优先、文件支撑的工作流控制层与宿主适配层，不是模型网关。它把项目规则、任务状态和宿主适配器放在可检查的文件中；真正的模型推理、原生 agent loop、联网、认证、sandbox 和数据处理仍由你选择的 AI Coding 宿主负责。

## 数据放在哪里

| 数据 | 默认位置 | 用途 |
|---|---|---|
| 项目 Profile、报告、记忆、任务状态 | workspace 的 `.devcodex/` | 让任务有项目边界、可验证并可续接 |
| TaskRecovery V5 | 项目 `.devcodex` 下当前 project 的 Hook meta 分区 | 每个正式任务稳定 hot A/B、cold resume 与 terminal cache；按字节有界 |
| Legacy Hook generation/temp/log | 原 `.devcodex/**/.memory/hooks` 兼容分区 | 只读诊断；升级不自动迁移、覆盖或删除 |
| 受管宿主 adapter 与稳定 runtime | 用户 HOME 下各宿主的 DevCodex 受管目录 | 把同一工作流合同带入六个宿主 |
| Runtime generation lease/retention state | 各宿主 `devcodex/.runtime-generation-*` | 证明长驻 MCP 正在使用哪一代；支持显式摘要绑定的旧安装代次回收 |
| 临时对象 | `<workspace>/.tmp/devcodex/` | 有 owner、scope、TTL 与 lease 的运行时临时数据 |
| 业务源码 | 原项目目录 | DevCodex 只在已授权工作流中读取或修改 |

普通使用不需要 DevCodex 自己的常驻网络服务。源码包没有生产依赖；CLI 不代理模型请求，也不会把“本地优先”表述成“代码永不离开本机”。宿主是否上传上下文、保存聊天或使用联网工具，以该宿主、账号和组织策略为准。

TaskRecoveryStoreV5 不按每次 Hook/工具状态变化创建 UUID 全快照。正式任务数量没有硬上限，但默认总量 soft/hard 为 256/512 MiB，并保留 8 MiB closeout reserve；达到 hard 时普通 mutation 被阻止，不会静默删除活跃任务。现有 legacy 文件仍可能占用较大磁盘，本版本只停止新 writer 继续制造，等待用户未来明确授权后再处理历史清理。

正式任务身份不以盘符作为永久 identity。`TaskIdentityV2` 中的 root digest 仅保留首次准入 provenance；工作区复制或迁移后，完整 identity schema/core/digest 必须先通过验证，再以稳定 `taskId`、项目名和 active-root 相对任务路径复用同一正式任务，并由新位置的 `ProjectTargetLeaseV2`、admission 与 fenced owner 重新授予实时 authority。旧位置的 TaskRecovery 热态、BudgetCard 和 mutation lease 不会被继承，也不会在未确认时自动删除；历史报告中的旧绝对路径可作为当时运行 provenance 保留。

安装 runtime generation 不采用“只留 N 个”的淘汰策略。当前、活动 process/activation lease、本机 adoption 后 24 小时宽限或任何 unknown 证据都保留；只有 DevCodex-owned immutable orphan 会进入只读计划，且必须用该计划的完整 SHA-256 显式应用。GC claim 与安装激活互斥，全部候选预检通过前零删除。普通 maintenance apply、安装或状态查询都不会隐式执行 generation GC，JSON 只投影有界样本而不把完整回执送入模型上下文。

DevCodex 不改变模型参数、权重、上下文窗口或基础推理上限。所谓工程能力提升，来自上下文、Skill、工作流、工具、记忆、验证与证据链的组合，而不是对底层模型做训练或参数修改。

## 一次任务的数据路径

```text
你的请求
  → 当前宿主
  → DevCodex 识别项目、意图与所需本地上下文
  → 宿主把其允许的上下文交给模型
  → 结果、验证和续接状态按工作流写回本地项目
```

DevCodex 的 Hook、MCP 和 Skill 负责选择与约束，不会替你改变宿主的隐私设置。处理敏感仓库前，应先确认宿主的数据保留、训练、地域和组织控制。

## 写入与权限边界

- `analyze` 和默认 `audit` 只读；`dev` 与 `fix` 在确认后写入。
- auto 只自动通过适用 CP，不会扩大项目、删除、发布或危险操作权限。
- `runtime prune`、`tmp maintain`、adapter remove 与 uninstall 默认预览；实际清理需要显式 apply 和可证明的所有权。
- configured、contract、native probe 和端到端 readiness 分层取证；文件存在不能冒充执行能力。
- DevCodex 不扫描、合并、覆盖或删除用户自己的宿主指令、原生 Skill 和个人配置。

## 你可以检查什么

```bash
devcodex status --json
devcodex doctor --json
devcodex runtime status --json
devcodex tmp status --json
```

JSON 输出使用稳定 envelope，适合保存最小诊断证据。分享输出前仍应检查路径、项目名和业务数据；不要公开 token、私有代码或无关配置全文。

## 源码、发布包与线上文档

源码 checkout、npm 发布包、GitHub Release 和线上文档是不同证据面。源码里的未发布能力不能写成 registry 用户已经获得；HTTP 200 也不能证明页面内容正确。站点首页显示当前 package 版本和事实投影生成日期，发布状态仍以 registry、tag 和发布验收为准。

## 报告安全问题

安全漏洞不要先开公开 Issue。请按仓库 [Security Policy](https://github.com/devcodex-labs/devcodex/blob/main/SECURITY.md) 发送邮件，包含受影响版本、复现步骤和影响；普通文档问题可以使用 GitHub Issues。

更多边界见[限制与边界](/reference/limits)，宿主差异见[六宿主能力边界](/reference/hosts)。
