# 运行态维护

本页面向需要检查磁盘占用、临时对象或卸载残留的用户。所有清理先预览；不要手动删除未知锁、lease 或 `.devcodex` 子目录。

## 查看 runtime state

```bash
devcodex runtime status
devcodex runtime status --json
```

该命令只读，展示 owner、大小和最近使用时间。

## 预览 runtime prune

```bash
devcodex runtime prune --dry-run
```

只有 DevCodex 可证明拥有、已过期且没有活动 lease 的 stale temp 才能成为候选。查看计划后，按当前命令帮助确认是否支持和需要 `--apply`。

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
