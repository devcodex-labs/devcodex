# 介绍

DevCodex 是一个 **GitHub Copilot Agent Plugin**，将 [ai-dev-guidelines v4](https://github.com/vextjs/ai-dev-guidelines) 的完整规范体系打包为标准插件，在 VS Code 中安装即用。

## 核心组成

| 组件 | 数量 | 说明 |
|------|------|------|
| **Agent** | 1 | 统一入口 `devcodex.agent.md`，自动路由 |
| **Skills** | 34 | 核心技能 + 工作流子类型 + 跨工作流公共技能 |
| **Instructions** | 11 | 全局安全底线 + 通用约束 + 工作流规则 |
| **Prompt 模板** | 20 | 需求/技术方案/实施计划/报告等 |
| **Hooks** | 2 | pre-message（请求前）+ post-session（会话后）|

## 设计理念

### 单入口，自动路由
不同于 v4 需要用户手动选择 `@dev` / `@fix` / `@audit`，v5 只有一个入口 `@DevCodex`。通过 `intent` Skill 语义识别用户意图，自动路由到对应工作流。

### Plugin-first，本地离线
v5.0 完全以文件系统为基础，无需外部服务。`npx @vextjs/devcodex init` 将所有规范文件复制到项目的 `.github/` 目录，**重启 VS Code 即可使用**，Free 层永久离线可用。

### P2 安全底线不可覆盖
内置 S01~S06 六条安全规则，优先级高于用户指令（P1）。无论用户指令如何，安全底线始终生效。

## 工作流一览

> 🚧 **内测阶段**：注册后自动激活 **7 天试用期**（Trial），期间享有 Pro 全部工作流权限，到期自动降级为 Free 层。

| 工作流 | 触发意图 | 层级要求 |
|--------|---------|----------|
| dev | 新功能开发、重构、数据库变更 | **Free**（database/optimization/scenario-test 需 Pro/Trial）|
| fix | Bug 修复、线上事故、安全漏洞 | **Free**（incident/security 需 Pro/Trial）|
| audit | 代码/方案/文档深度审查 | **Free**（audit-project 需 Pro/Trial）|
| analyze | 单轮代码分析、技术调研 | **Free** |
| chat | 纯问答、技术咨询 | **Free** |
| resume | 恢复上次中断的任务 | Pro / Trial |
| plan | 复杂多步骤规划 | Pro / Trial |
| self-fix | 修复 DevCodex 规范文件本身 | Pro / Trial |

## 与 v4 的关系

DevCodex v5 是 [ai-dev-guidelines v4](https://github.com/vextjs/ai-dev-guidelines) 的**插件化封装**：

- v4 是规范文件集（`RULES.md` + `specs/`），需要手动引入项目
- v5 将 v4 的核心规范转化为标准 GitHub Copilot Agent Plugin，一行命令安装即用
- v5 将 v4 的 8 个独立 Agent 合并为 1 个统一 Agent，体验更流畅
