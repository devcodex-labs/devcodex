# 术语表

| 术语 | 白话解释 |
|---|---|
| active-root | 当前任务唯一绑定的 DevCodex 项目状态根，不一定等于源码目录 |
| adapter | 把共享工作流接入某个宿主的受管入口 |
| configured | 受管配置存在且可读取；不等于 contract 或 native ready |
| contract | adapter、MCP、Hook 或文件结构必须满足的可验证约定 |
| CP | Confirmation Point；写入前确认需求、方案或高风险计划的边界 |
| ECR | Execution Closure Review；完成前对照需求、diff、测试和报告的复审 |
| evidence | 支持结论的文件、命令输出、退出码、回执或真实用户路径 |
| Full / Beta / Partial | 某个精确宿主 variant 的公开能力等级，不能跨宿主继承 |
| engineering harness | 围绕模型和宿主组织项目上下文、专业流程、工具、授权、验证、证据与续接的工程控制层；不等于模型或原生 agent loop |
| effective engineering intelligence | 模型在真实项目约束下完成工程任务的有效表现；可由上下文和流程提升，但不代表模型参数、权重或基础推理上限改变 |
| Hook | 宿主在会话或工具生命周期触发的入口；不同宿主事件不同 |
| MCP | 为宿主提供 Profile、记忆等结构化工具的本地 stdio 接口 |
| Profile | 项目的技术栈、架构、风格、测试、发布和功能清单 |
| projection | 从权威源生成给 README、站点或宿主使用的派生事实 |
| readiness | workspace、配置、contract、native 和用户路径证据的综合结果 |
| Skill | 按任务和阶段加载的专业流程；catalog 中存在不等于正文已加载 |
| task memory | 绑定项目和任务的本地续接状态，不是无限聊天记录 |
| `UNVERIFIED` | 当前没有足够直接证据；既不能说通过，也不能武断说失败 |
| workspace-namespace | workspace base + project overlay 的多项目状态布局 |

协议级名称如 `StageLoadReceiptV1`、`MemoryCursorV1` 和 `WorkspaceTempManifestV2` 主要用于诊断；普通用户不需要手工构造。见[限制与边界](/reference/limits)。
