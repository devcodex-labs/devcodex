# DevCodex 常见问题

> **版本**: v0.0.1

## 安装与配置

**Q: 如何安装 DevCodex？**  
A: DevCodex 是 GitHub Copilot Agent Plugin，通过 Copilot Chat 的 Plugins 页面搜索安装，或运行 `npm install @vextjs/devcodex`。

**Q: 如何设置 Pro Token？**  
A: 参见 `prompts/token-setup.prompt.md` 的向导，或运行 `/token-setup`。

**Q: 是否需要 GitHub Copilot 订阅？**  
A: 是，DevCodex 是 GitHub Copilot Agent Plugin，需要有效的 Copilot 订阅。

## 功能使用

**Q: Free 版能做什么？**  
A: 基础开发（dev-default/refactor/init/docs/plan-review）、基础修复（fix-default）、基础审查（除项目工程外的所有审查类型）、技术调研（analyze）和问答（chat）。Free 层不需要 Token，开箱即用。

**Q: Pro 版新增了什么？**  
A: 数据库开发（dev-database）、性能优化（dev-optimization）、场景测试（dev-scenario-test）、事故响应（fix-incident）、安全修复（fix-security）、项目工程深度审查（audit-project）、规范自修复（self-fix）、断点续接（resume）、执行规划（plan）、API 验证、影响评估。

**Q: 如何使用多租户功能？**  
A: Enterprise 专属功能，在 `instructions/tenants/<tenant-id>/` 下创建自定义 Instructions 覆盖默认规范。

## 工作流

**Q: CP 确认可以跳过吗？**  
A: 不可以，CP1/CP2/CP3 是保证工作质量的关键关卡，跳过违反 C02 约束（CP 不可跳过合并）。

**Q: 记忆文件存在哪里？**  
A: `<项目根>/.devcodex/.memory/clients/<agent>/`，仅在本地，不上传。

**Q: 如何从中断的任务恢复？**  
A: 使用 `@devcodex /resume` 或告诉 DevCodex "继续上次的任务"，DevCodex 会自动读取记忆文件恢复上下文。

## 问题排查

**Q: Token 验证失败怎么办？**  
A: 确认环境变量正确设置，Token 未过期。访问 devcodex.dev/account 检查 Token 状态。

**Q: 报告文件生成失败？**  
A: 确认 `.devcodex/reports/` 目录有写入权限。报告会降级为对话内输出。
