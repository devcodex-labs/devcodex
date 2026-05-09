# 宿主生命周期硬门禁（Hooks 优先）— 关键决策

> **关联需求**：[宿主生命周期硬门禁（Hooks 优先）— 需求概况](./index)
> **状态**：✅ 已收敛

---

| 编号 | 决策 | 结论 | 状态 |
|------|------|------|------|
| D1 | 生命周期硬门禁由哪一层承载 | 由 Hooks 承载；Instructions 保留语义与 fallback，不再模拟硬门禁 | 已确认 |
| D2 | 不支持 Hooks 的宿主如何处理 | 明确降级到 `instruction-fallback`，继续可用但不宣称硬保证 | 已确认 |
| D3 | 预检查是否继续要求“回复第一行输出” | 否；改为“实质任务前的首个结构化状态块” | 已确认 |
| D4 | 首阶段是否依赖 MCP | 否；MCP 作为增强层，不阻塞 Hooks 首阶段落地 | 已确认 |
| D5 | 是否需要把 README / RULES / requirements 一起改写 | 是；兼容性承诺必须与实现面同批同步 | 已确认 |
| D6 | 首阶段 Hooks 采用哪种运行时形态 | 优先采用由 CLI 分发到目标项目 `.github/hooks/*.json` 的 Workspace Hooks MVP；plugin-native hooks 后置评估 | 已确认 |
| D7 | `Stop` Hook 在首阶段承担什么角色 | 仅作为最终兜底，不承担主持久化；高频状态应前移到 `PostToolUse` / `PreCompact` | 已确认 |
| D8 | 首阶段是否需要服务器部署 | 否；首阶段必须支持纯本地闭环，远程服务属于后续增强 | 已确认 |
| D9 | Hook 执行逻辑默认放在哪 | 由 CLI 分发到 `.github/hooks/_runtime/` 的受版本管理运行时脚本；避免依赖目标项目 `node_modules`，也不使用用户手写临时脚本作为默认入口 | 已确认 |
