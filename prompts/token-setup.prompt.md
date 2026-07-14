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
- 凭据处理继承用户当前指令、项目 Profile/README/仓库策略与指定发布流程。未明确限制时不得自行脱敏、占位或改成 env；若明确禁止回显/明文，再按该策略执行。

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
| 凭据策略 | 遵循 S02：默认按用户/项目要求处理；仅显式限制时禁止明文、回显或要求脱敏 |
