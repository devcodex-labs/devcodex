# DevCodex v5 — 使用入口

> GitHub Copilot Agent Plugin · publisher: Rocky · version: 0.0.1

## 安装

在 VS Code Copilot Chat 的 Plugins 页面搜索 **DevCodex** 并安装，或通过命令面板：
```
GitHub Copilot: Install Plugin → DevCodex
```

## 统一入口

只有一个 Agent：**DevCodex**，收到消息后自动识别意图并路由到对应工作流。

| 意图关键词示例 | 路由工作流 | 授权 |
|-------------|-----------|------|
| 开发新功能 / 重构 / 优化 / 初始化 / 文档 | dev | Free（部分子类型需 Pro）|
| Bug 修复 / 报错 / 线上事故 / 安全漏洞 | fix | Free（incident/security 需 Pro）|
| 单轮分析 / 技术调研 / 评估 | analyze | Free |
| 深度审查 / 全面体检 / 逐项检查 | audit | Free（项目工程需 Pro）|
| 规范文件自修复 | self-fix | Pro |
| 恢复/继续上次中断任务 | resume | Pro |
| 不匹配上述意图 | plan（兜底）| Pro |
| 纯问答 / 解释 | chat（快速路径）| Free |

## 安全底线

`00-safety.instructions.md` 全局自动注入，包含 S01~S06 六条不可覆盖的安全规则：
- **S01** 破坏性操作需确认 · **S02** 禁止硬编码凭据 · **S03** 禁止编造规范
- **S04** 禁止整文件覆写 · **S05** 记忆+报告自动写入 · **S06** 禁止危险命令

## 授权

> 🚧 **开发阶段**：当前为内测版本，注册后享 7 天全功能试用，付费通道尚未开放。

| 层级 | 激活条件 | 包含功能 |
|------|---------|---------|
| **Free** | 无需 Token | 基础工作流（dev 5子类型/fix-default/audit 5类审查/analyze/chat），20次/天 |
| **Trial（试用）** | GitHub 注册后自动激活，有效期 7 天 | Pro 全部功能，到期自动降级 Free |
| **Pro** | 订阅付费（内测期暂未开放）| 1 统一 Agent（DevCodex）+ 全部 34 Skills，无次数限制 |
| **Enterprise** | 联系 sales@devcodex.dev | Pro + 多租户 Instructions 定制 |

设置 Token：`DEVCODEX_TOKEN=<your-token>` 或运行 `/token-setup`

## 相关文档

- [迁移指南 v4→v5](MIGRATION.md) · [定价](commercial/PRICING.md)
- [GitHub 仓库](https://github.com/vextjs/devcodex) · [授权服务](https://auth.devcodex.dev)
