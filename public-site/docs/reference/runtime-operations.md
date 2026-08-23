# 运行态维护

本页面向需要检查磁盘占用、临时对象或卸载残留的用户。所有清理先预览；不要手动删除未知锁、lease 或 `.devcodex` 子目录。

## 查看 runtime state

```bash
devcodex runtime status
devcodex runtime status --json
```

该命令只读，展示 owner、大小和最近使用时间，并把 TaskRecovery V5、项目内 legacy lifecycle JSON 和用户级安装 runtime generation 分栏。V5 还显示物理磁盘、reserve、hot/cold/terminal/ephemeral、top task 与 256/512 MiB 默认 soft/hard 配置。JSON 输出只投影有界 generation 摘要，不回显整份六宿主安装回执。

## 诊断 TaskRecovery

```bash
devcodex runtime doctor
devcodex runtime doctor --json
```

doctor 检查稳定 A/B、8 MiB closeout reserve 的大小与物理尾标、容量和磁盘 headroom、配置错误、旧 writer 最近活动及 typed next step。正式任务数量没有硬上限；hard limit 是总字节保护，不是 owner 数量限制。

## 预览与应用 V5 maintenance

```bash
devcodex runtime maintenance --dry-run --json
devcodex runtime maintenance --apply --json
```

默认只预览。普通 apply 只允许安全冷化具备 checkpoint 的 hot task、退出过期 terminal/ephemeral，并清理 writer-owned 固定 temp；达到 hard 时普通 mutation 会失败关闭，最小 closeout 仍使用预留空间。项目内 legacy lifecycle generation/temp/log 始终只读报告，`deletedFiles` 必须保持 0。`runtime prune` 仅是兼容别名。

## 收敛用户级安装 runtime generation

各宿主用户目录中的 `devcodex/runtime-*` 是不可变安装代次，不是 `.devcodex/.memory/hooks` 的任务恢复 JSON。新版本对 Profile/Memory 长驻 MCP 和 global-host activation 使用每进程/角色一个稳定 lease，默认 30 秒心跳、120 秒 TTL；当前 generation、活动 lease、本机首次采用后的 24 小时宽限、PID 身份不明、权限错误、reparse point、清单不完整或并发 claim 都会失败关闭。宽限来自固定 `generationAdoptions`，不会因安装旧 release 而沿用早已过去的发布日期。

```bash
# 第一步只读，取得候选清单与 planDigest
devcodex runtime maintenance --dry-run --json

# 第二步只应用完全相同的计划；任何状态变化都会零删除并要求重新预览
devcodex runtime maintenance --apply --generation-plan <planDigest> --json

# 删除成功后刷新 retained-runtime 回执，再复查
devcodex global-adapters apply --json
devcodex runtime doctor --json
```

普通 `runtime maintenance --apply` 不会隐式删除安装 generation。GC 在删除前建立独占 claim，并重查宿主回执、完整 generation inventory、manifest、候选内容树、lease 与路径边界；安装激活与 claim 双向互斥。崩溃遗留 claim 只有在至少超龄且 PID 明确死亡时才通过固定 stale 槽原子恢复；PID 存活、不可见、内容损坏或恢复读回不一致时继续阻断。全部候选预检通过前零删除，删除阶段 I/O 失败则返回真实 partial。`status/doctor` 在六宿主合计最多显示 12 条 generation 样本、每个 inventory 最多 12 类摘要、TaskRecovery task 最多 8 条；maintenance 的 task before/after 各最多 8 条，actions/failures 与 generation candidates/retained/removed/failed 各最多 24 条。每个 runtime root 的 current refs 最多显示 12 条，每个 receipt 只返回 ref 总数。所有投影同时保留真实总数、字节、truncated 和完整 planDigest；没有固定保留数量，也不运行后台 daemon。

## 检查 workspace 临时对象

canonical root 是 `<workspace>/.tmp/devcodex/`：

```bash
devcodex tmp status --json
devcodex tmp status --project=<project> --partition=runs
devcodex tmp maintain --project=<project> --partition=runs
```

`tmp maintain` 默认只生成 quota-bound 计划。实际 apply 必须同时提供唯一 project、一个完整 partition 和 `--apply`；分页未完成、owner 未知、共享 lease、reparse point 或路径逃逸都会阻断。

## 安全卸载

```bash
devcodex uninstall --dry-run
devcodex uninstall --apply
npm uninstall -g devcodex
```

顺序不能反：先卸载 npm 包会让安全清理命令消失。清理只针对 receipt-owned 资产；用户自己的配置、指令、Hook 与原生 Skill 保留。所有权或内容漂移无法验证时会失败关闭。

## 何时停止

- 计划包含 workspace 根、用户 HOME 根或不认识的目录；
- 目标没有 owner、TTL、scope 或 lease 证据；
- 需要绕过 reparse point、路径边界或权限检查；
- 你无法区分 DevCodex 受管资产和用户资产。

停止后保存 `status --json` 与计划输出，按[故障排查](/guide/troubleshooting)处理，不要用递归删除代替恢复。
