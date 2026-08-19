# 状态与错误码

先运行 `devcodex status` 看摘要，再用 `devcodex doctor --json` 获取 typed issue、证据和下一步。诊断应从真实项目或 workspace 根执行。

## readiness 决策树

```text
workspace 能否解析？
├─ 否 → 回到真实根目录，检查 .devcodex 与 Profile
└─ 是 → adapter configured？
   ├─ 否 → global-adapters apply，然后重开宿主
   └─ 是 → contract passed？
      ├─ 否 → 按首个 typed issue 修复并重新 apply
      └─ 是 → native/direct evidence 是否需要且存在？
         ├─ 否 → 保持 UNVERIFIED，不冒充 ready
         └─ 是 → 用全新会话验证用户路径
```

## 状态词

| 状态 | 含义 | 不能推出什么 |
|---|---|---|
| `PASS` | 当前检查与证据通过 | 不自动覆盖其他宿主、版本或发布面 |
| `WARN` | 可以继续，但有明确风险或缺口 | 不等于完成 |
| `BLOCK` | 当前动作必须停止并恢复 | 不等于整个安装不可用 |
| `UNVERIFIED` | 缺少足够的新鲜直接证据 | 既不是 PASS，也不是失败 |
| `N/A` | 对当前目标不适用 | 不能计入通过分母 |

## 常见错误码

| 错误码或诊断 | 含义 | 最短恢复 |
|---|---|---|
| `CONTEXT_PLAN_INVALID` + Profile README 缺失 | active target 没有可用 Profile | 确认项目绑定；用 `devcodex profile plan` 预览，再初始化 Profile |
| `CLI_COMMAND_UNKNOWN` | 命令不在当前 registry | `devcodex help`，检查版本与拼写 |
| `CLI_HOST_CONFIG_GLOBAL_ONLY` | 尝试从 workspace 命令写宿主 adapter | 使用 `devcodex global-adapters apply` |
| `GLOBAL_HOST_RECEIPT_STALE` | 已安装 receipt 与当前包不一致 | 从预期包根重新 apply，重开宿主 |
| `GLOBAL_HOST_ENTRYPOINT_MISSING` | 稳定 runtime 的入口文件缺失 | 重新全局安装或 apply |
| `GLOBAL_HOST_MANAGED_CONFIG_DRIFT` | 受管配置与 receipt 不一致 | 保存 doctor 证据并重新 apply |
| `HOST_ADAPTER_ENTRY_MISSING` | adapter contract 找不到 runtime 入口 | 恢复用户级 runtime，再跑 doctor |
| `*_MCP_CONTRACT_FAILED` | 某宿主的 memory/profile MCP 指向错误或缺失 | 刷新该宿主 plugin 与稳定 runtime |
| `GLOBAL_HOST_TARGET_UNVERIFIED` / `sandbox-read-denied` | 当前沙箱不能读取精确用户目录 | 只批准必要目录后重试；兄弟宿主独立判断 |
| `node runtime BLOCK` / `sandbox-exec-denied` | Node launcher 在启动前被宿主拒绝 | 核对 Node provider 与精确 launcher 权限 |

## 证据层不要混用

- 配置文件存在只证明 `configured`。
- adapter contract 通过证明受管入口可解析。
- 原生 CLI probe 证明该命令身份与基本可达。
- 真实模型回放才证明对应用户路径。
- 一个宿主或 variant 的 PASS 不覆盖另一个。

如果 typed issue 不在本页，保存错误码、`nextStep`、版本、宿主和最小复现；不要先手动删除 `.devcodex` 或用户级宿主目录。
