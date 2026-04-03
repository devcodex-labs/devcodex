# DevCodex v5 — 使用入口

> GitHub Copilot Agent Plugin · publisher: Rocky · version: 1.0.0

## 安装

在 VS Code Copilot Chat 的 Plugins 页面搜索 **DevCodex** 并安装，或通过命令面板：
```
GitHub Copilot: Install Plugin → DevCodex
```

## 工作流 Agents（Pro 层）

| 触发方式 | Agent | 用途 |
|---------|-------|------|
| `@dev` | dev.agent | 开发（新功能/重构/数据库/初始化/优化/测试/文档/方案评审）|
| `@fix` | fix.agent | 修复（常规Bug/线上事故/安全漏洞）|
| `@audit` | audit.agent | 审计（规范文件/技术方案/需求文档/项目工程/报告/文档）|
| `@self-fix` | self-fix.agent | 规范自修复（自动检测并修正 AI 行为偏差）|
| `@resume` | resume.agent | 恢复（断点续接中断任务，还原上下文）|
| `@plan` | plan.agent | 规划（制定执行计划，含 CP 确认关卡）|

## 免费 Agents（Free 层）

| 触发方式 | Agent | 用途 |
|---------|-------|------|
| `@analyze` | analyze.agent | 分析（单轮代码/需求/架构研究）|
| `@chat` | chat.agent | 问答（轻量对话，无工作流开销）|

## 安全底线

`00-safety.instructions.md` 全局自动注入，包含 S01~S06 六条不可覆盖的安全规则：
- **S01** 破坏性操作需确认 · **S02** 禁止硬编码凭据 · **S03** 禁止编造规范
- **S04** 禁止整文件覆写 · **S05** 记忆+报告自动写入 · **S06** 禁止危险命令

## 授权

- **Free**：`@analyze` + `@chat`，20次/天
- **Pro**：全部 8 Agents + 34 Skills，无次数限制
- **Enterprise**：Pro + 多租户 Instructions 定制

设置 Token：`DEVCODEX_TOKEN=<your-token>` 或运行 `/token-setup`

## 相关文档

- [迁移指南 v4→v5](MIGRATION.md) · [定价](commercial/PRICING.md)
- [GitHub 仓库](https://github.com/vextjs/devcodex) · [授权服务](https://auth.devcodex.dev)
