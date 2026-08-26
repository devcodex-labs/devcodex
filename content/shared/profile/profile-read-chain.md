所有工作流的 Profile 获取都必须执行 `ProfileReadChainGate`；服务 / 框架规范复审、跨服务需求、workspace-namespace 或 Profile 同步任务还必须执行 `ServiceNormCoverageGate`：

- `ProfilePathPortabilityGate` 只对显式目标 Profile 生效：其直属 `README.md` 声明 `Profile 路径契约：portable-v1` 后，validator 仅检查该 Profile 顶层 Markdown，不得借此枚举或修改其他项目。
- 项目内稳定路径必须使用 `<workspace-root>`、`<project-root>`、`<active-root>` 或相对路径，禁止把当前盘符或用户名写成长期规范事实。
- 确属本机外部资源的路径可以保留，但必须在同一行标注 `<!-- devcodex:path-scope=machine-local -->`，使迁移复审能够区分配置事实与残留路径。
- 未声明 `portable-v1` 的既有 Profile 继续按 legacy 兼容读取；迁移必须由该项目自己的任务显式启用，禁止跨项目追扫。历史报告、receipt 与审计证据不因 Profile 迁移而改写。
