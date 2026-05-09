# v1.0.0 需求变更日志

> 记录需求定义文档的变更。代码/规范文件的变更记录见根目录 `CHANGELOG.md`。

---

| 日期 | 变更内容 | 影响需求 | 原因 |
|------|---------|---------|------|
| 2026-04-04 | 新建 v1.0.0 完整需求体系 | 全部 | 基于 v0.03 全面重构，官方标准对齐 |
| 2026-04-04 | 横切需求提升为 P1 基础规范 | agent-modes / storage-spec / memory-resume | 明确 P1 基础规范必须优先于 P2 功能需求 |
| 2026-04-04 | Agent 双模式从 `auto:` 指令改为双 Agent 入口 | agent-modes | 会话级模式选择比消息级前缀更自然 |
| 2026-05-09 | 新增 P1 `host-lifecycle-gates` 需求，定义宿主生命周期硬门禁、Hook-First / Fallback 双模式与兼容性文档改写范围 | host-lifecycle-gates | 解决 VS Code 等宿主中预检查/合规检查依赖 instructions 软约束导致的不确定执行 |
| 2026-05-09 | 收敛 `host-lifecycle-gates` 首阶段实现路线：优先 Workspace Hooks MVP，本地优先且无需服务器部署，`Stop` 降级为最终兜底 | host-lifecycle-gates | 避免把首阶段落点误放到 plugin-native hooks 或远程服务，降低实现偏差与闭环风险 |
| 2026-04-04 | 试用期从 7 天延长为一个月 | — | 开发工具评估周期需要更长时间 |
