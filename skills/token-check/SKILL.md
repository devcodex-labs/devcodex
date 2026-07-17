---
name: token-check
description: 授权占位规范 — 当前所有功能全量开放，无 tier 限制。Tier 门控为预留功能。
---
# Token Check Skill

> ℹ️ **当前状态**：授权门控尚未启用（**占位 Skill / FIX-22 可选不部署**）。所有工作流及子类型对所有用户全量开放，无需 Token。
>
> 未来版本将通过 `plugin.json.authentication` + `DEVCODEX_TOKEN` 环境变量实现服务端 tier 校验，届时本文件将扩展为完整的门控规范。三宿主 init **可不部署**本 Skill，直至 tier 门控启用。

## 当前行为

- 无 Token 检查
- 所有工作流子类型（dev-database / fix-security / audit-project / self-fix / resume 等）均可直接使用
- `DEVCODEX_TOKEN` 环境变量当前无效（保留供未来接入）
