# 状态与错误码

先运行 `devcodex status` 看摘要，再用 `devcodex doctor --json` 获取 typed issue、证据和下一步。诊断应从真实项目或 workspace 根执行。

若问题是 `.devcodex` 磁盘增长，使用专用运行态命令，不要先删除文件：

```bash
devcodex runtime status --json
devcodex runtime doctor --json
devcodex runtime maintenance --dry-run --json
```

`runtime status` 将 V5、项目内 legacy lifecycle 文件与用户级安装 runtime generation 分栏，并显示物理磁盘、reserve、hot/cold/terminal/ephemeral、top task 与配置来源。`runtime doctor` 检查 A/B、reserve 大小和尾标、容量/headroom、配置、legacy 最近写入及 generation retention 证据。`runtime maintenance` 默认 preview；即使显式普通 `--apply`，legacy 的 `deletedFiles` 仍必须为 0，安装 generation 也只有匹配 `--generation-plan` 才会处理。

`status` 与 `doctor` 的 `worktrees` 字段是只读 `WorktreeDiagnosticsV1`。`WARN` 通常表示当前工作树有改动、存在 prunable 元数据，或某个外部 worktree 的 owner/dirty 状态未核实；它不表示 DevCodex 已清理或可以清理。诊断受单命令和总时间预算约束，且绝不执行 prune、remove、unlock、branch 操作或 `safe.directory` 修改。

若“提交后怎么多了一个分支”，先区分事实与历史原因：过去发生过代理误用通用多人协作分支惯例、又未在创建前告知的情况；这不是 DevCodex 内置的自动建分支行为。先用 `git status --short --branch` 核实当前分支，再运行 `devcodex status` 和 `devcodex doctor --json` 检查 worktree 归属。不要仅因看到未知分支或 prunable 元数据就删除它；任何 branch create/switch/cleanup 都需要独立授权。

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
| `TASK_RECOVERY_CONFIG_INVALID` | `hardLimitMiB` 或 taskRecovery key 非法 | 修正为 safe integer `>=512`，再运行 `runtime doctor --json` |
| `TASK_RECOVERY_DISK_HEADROOM_REQUIRED` | atomic write、reserve 修复与 8 MiB safety headroom 不足 | 先释放项目所在卷空间；不要删除未知 Hook 文件 |
| `LIFECYCLE_EPHEMERAL_ENTRY_EXCEEDED` | 临时恢复状态无法压缩到 8 KiB | 保存 doctor 输出；完整 plan 应从固定 store 重建，不要提高上限 |
| `LEGACY_WRITER_RESTART_REQUIRED` | 安装新版本后仍观察到旧 generation writer 写入 | 完全退出相关 AI Coding 宿主并新建任务，再复查最近写入 |
| `RUNTIME_GENERATION_RETENTION_NOT_INITIALIZED` | 用户级安装 runtime 还没有 retention state | 从当前安装包执行 `devcodex global-adapters apply --json`，重开宿主 |
| `generation-adoption-evidence-missing` | generation 没有可验证的本机首次采用记录 | 保留该代次；运行当前包的 `global-adapters apply` 安装/修复 adoption state，再等待宽限期 |
| `RUNTIME_GENERATION_GC_PLAN_STALE` | generation、回执、manifest、树或 lease 在预览后变化 | 重新运行 dry-run；不要复用旧摘要 |
| `RUNTIME_GENERATION_GC_CLAIM_RECHECK_FAILED` | 建立独占 claim 后证据不再与预览一致 | 保留所有目标，检查活动 MCP/权限后重新预览 |
| `RUNTIME_GENERATION_ACTIVATION_LEASE_REQUIRED` | 安装/回滚目标正被 GC claim 占用，或 activation lease 无法建立 | 当前宿主事务在 mutation 前停止；等待 maintenance 结束后重新执行 apply |

## 证据层不要混用

- 配置文件存在只证明 `configured`。
- adapter contract 通过证明受管入口可解析。
- 原生 CLI probe 证明该命令身份与基本可达。
- 真实模型回放才证明对应用户路径。
- 一个宿主或 variant 的 PASS 不覆盖另一个。

如果 typed issue 不在本页，保存错误码、`nextStep`、版本、宿主和最小复现；不要先手动删除 `.devcodex` 或用户级宿主目录。
