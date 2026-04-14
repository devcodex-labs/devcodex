# DevCodex v1.4.0 — 使用入口

> GitHub Copilot Agent Plugin · publisher: Rocky · version: 1.4.0

## 默认 Copilot 支持

安装后 Copilot 自动加载 DevCodex 规则（通过 `copilot-instructions.md` + `instructions/`），无需选择 Agent。
`v1.1.0` 起，CLI 不再向目标项目默认分发 `.github/agents/`。如果项目中仍存在 `.github/agents/`，属于历史残留，需要手动清理。

## 意图路由

| 意图 | 路由工作流 | 授权 |
|------|-----------|------|
| 开发新功能 / 重构 / 优化 / 初始化 / 文档 | dev（8 子类型） | Free（部分子类型需 Pro）|
| Bug 修复 / 报错 / 线上事故 / 安全漏洞 | fix（3 子类型） | Free（incident/security 需 Pro）|
| 多轮分析（≥3轮）/ 技术调研 / 可行性评估 | analyze | Free |
| 深度审查 / 全面体检 / 逐项检查 | audit（6 子类型） | Free（项目工程需 Pro）|
| 规范文件自修复 | self-fix | Pro |
| 恢复/继续上次中断任务 | resume | Pro |
| 不匹配上述意图 | plan（兜底） | Pro |
| 纯问答 / 解释 | chat（快速路径） | Free |

## 安全底线

`00-safety.instructions.md` 全局自动注入，包含 S01~S06 六条不可覆盖的安全规则：
- **S01** 破坏性操作需确认 · **S02** 禁止硬编码凭据 · **S03** 禁止编造规范
- **S04** 禁止整文件覆写 · **S05** 记忆+报告自动写入 · **S06** 禁止危险命令


## 相关链接

- [GitHub 仓库](https://github.com/vextjs/devcodex)
- [变更日志](CHANGELOG.md)

