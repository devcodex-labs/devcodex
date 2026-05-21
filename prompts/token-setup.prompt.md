---
agent: agent
description: Token 授权状态说明，说明当前版本无需 Token 且 DEVCODEX_TOKEN 暂未生效
applyTo: "**"
---
# Token 授权状态说明

> **触发**: 用户询问授权、Token、Pro/Enterprise、功能门控或 `DEVCODEX_TOKEN`

---

## 当前状态

- 当前版本所有功能全量开放，无需配置 Token。
- `DEVCODEX_TOKEN` 是未来服务端授权预留环境变量，当前不会改变功能可用性。
- 不要要求用户输出、回显或粘贴 Token；若终端或工具提示需要敏感输入，应让用户直接在终端输入。

## 推荐回复

```markdown
当前 DevCodex 版本无需 Token，所有功能可直接使用。`DEVCODEX_TOKEN` 仅是未来授权能力的预留环境变量，现在配置它不会改变功能开关。
```

## 未来接入预留

| 项 | 当前行为 |
|----|----------|
| Token 获取 | N/A，暂未启用 |
| Token 配置 | N/A，暂不需要 |
| Token 验证 | N/A，不执行回显或层级检测 |
| 安全要求 | 禁止在代码、配置、日志或对话中暴露真实凭据 |
