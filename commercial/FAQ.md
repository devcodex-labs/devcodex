# DevCodex 常见问题

> **版本**: v5.0.0

## 安装与配置

**Q: 如何安装 DevCodex？**  
A: 通过 VS Code 扩展市场搜索 "DevCodex" 安装，或在 GitHub Copilot Chat 中通过 `@devcodex` 调用。

**Q: 如何设置 Pro Token？**  
A: 参见 `prompts/token-setup.prompt.md` 的向导，或运行 `/token-setup`。

**Q: 是否需要 GitHub Copilot 订阅？**  
A: 是，DevCodex 是 GitHub Copilot Agent Plugin，需要有效的 Copilot 订阅。

## 功能使用

**Q: Free 版能做什么？**  
A: 技术调研（analyze）和问答（chat）两个工作流。Free 层不需要 Token，开箱即用。

**Q: Pro 版新增了什么？**  
A: 数据库开发、性能优化、场景测试、事故响应、安全修复、API验证、影响评估、项目工程深度审查。

**Q: 如何使用多租户功能？**  
A: Enterprise 专属功能，在 `instructions/tenants/<tenant-id>/` 下创建自定义 Instructions 覆盖默认规范。

## 工作流

**Q: CP 确认可以跳过吗？**  
A: 不可以，CP1/CP2/CP3 是保证工作质量的关键关卡，跳过会触发 S05 安全底线违规。

**Q: 记忆文件存在哪里？**  
A: `projects/<project>/.ai-memory/clients/<agent>/`，仅在本地，不上传。

**Q: 如何从中断的任务恢复？**  
A: 使用 `@devcodex /resume` 或告诉 DevCodex "继续上次的任务"，`resume.agent.md` 会自动读取记忆文件恢复状态。

## 问题排查

**Q: Token 验证失败怎么办？**  
A: 确认环境变量正确设置，Token 未过期。访问 devcodex.dev/account 检查 Token 状态。

**Q: 报告文件生成失败？**  
A: 确认 `projects/<project>/reports/` 目录有写入权限。报告会降级为对话内输出。
