# CLI 命令参考

本页按当前公开版本的实际 `devcodex help` 与逐命令帮助整理。先运行 `devcodex --version` 和 `devcodex help <command>` 获取当前安装版本的权威参数；未知命令返回非零退出码和 `CLI_COMMAND_UNKNOWN`。

## 日常命令

| 命令 | 默认性质 | 写入位置或影响 | 成功信号 |
|---|---|---|---|
| `devcodex init [--profile <project>] [--dry-run]` | 写入；dry-run 只读 | 当前 workspace 的 `.devcodex/` | workspace 可被 `status` 解析 |
| `devcodex update [--dry-run]` | 写入；dry-run 只读 | 只刷新当前 workspace runtime | status 不再报告 workspace stale |
| `devcodex status [--completion] [--json]` | 只读 | 无 | envelope `ok=true`；各层状态诚实显示 |
| `devcodex doctor [--completion] [--json]` | 只读诊断 | 无 | 给出 typed issue 和精确 next step |
| `devcodex profile plan\|init [...]` | plan 只读；init 写入 | 项目 Profile | 必需文件完整且校验通过 |
| `devcodex runtime status\|prune [...]` | status 只读；prune 默认预览 | DevCodex runtime-owned 临时对象 | scope 与候选清单完整 |
| `devcodex tmp status\|maintain [...]` | status 只读；maintain 默认计划 | `<workspace>/.tmp/devcodex/` | inventory 完整；apply 有 owner/scope 证据 |
| `devcodex uninstall [--dry-run\|--apply] [--json] [--home <dir>]` | 默认预览；apply 清理 | receipt-owned 用户级 adapter | 受管资产移除，用户资产保留 |

### `init` 与 `update`

```bash
devcodex init [--profile <project>] [--dry-run]
devcodex update [--dry-run]
```

两者只拥有 workspace `.devcodex`。旧的 `--host` 或宿主 alias 不会把 adapter 写回项目，而会失败关闭为 `CLI_HOST_CONFIG_GLOBAL_ONLY`。用户级 adapter 使用 `global-adapters apply`。

### `profile plan|init`

```bash
devcodex profile plan|init [--tier <tier>] [--dry-run] [--force] [--prod]
```

普通 workspace 先用 `devcodex init`。高级 Profile 支持 `profile-lite`、`profile-standard`、`profile-closed-loop`；`plan` 强制 dry-run。`--force` 可能覆盖 DevCodex 管理的目标文件，执行前先看计划和 git diff。

### `status` 与 `doctor`

```bash
devcodex status [--completion] [--json]
devcodex doctor [--completion] [--json]
```

两者不修复文件。status 给摘要，doctor 展开 adapter、native host 和 workflow readiness；`--json` 输出一个 `DevCodexCliEnvelopeV1` 文档。

## 高级命令

| 命令 | 默认性质 | 说明 |
|---|---|---|
| `global-adapters apply [--dry-run] [--json]` | 写入；支持预览 | 从当前包刷新用户级六宿主 adapter |
| `global-adapters remove [--dry-run\|--apply] [--json]` | 默认预览 | 安全移除 receipt-owned adapter |
| `grok [Grok CLI options]` | 启动进程 | 用用户级 DevCodex kernel 启动 Grok Full 入口 |
| `migrate-layout plan\|apply\|rollback` | plan 只读；其余写入 | 管理集中式 workspace layout 迁移 |
| `probe <id> [--json]` | 有界只读诊断 | 运行已登记的本地 probe |
| `trace show\|replay [options]` | show 只读；replay 受合同约束 | 检查或回放 `LocalTaskTrace` 证据 |
| `skill plan\|resolve [options]` | 只读规划 | 检查 Skill bundle 或 W>G 解析 |
| `task resolve\|verify\|risk [options]` | 依子命令 | 解析任务、对账状态或管理显式风险决定 |

`migrate-layout apply/rollback`、trace replay 和 task risk 会改变状态，执行前使用子命令帮助确认精确 scope。不要把高级命令当作首次安装步骤。

## 通用选项

- `--dry-run`：在支持的命令上预览，不写文件。
- `--json`：在支持的命令上输出机器可读 envelope。
- `--force`, `-f`：仅特定写入命令支持；可能覆盖受管文件。
- `--tier <tier>`、`--prod`、`--allow-downgrade`：只用于 Profile 初始化。

完整的运行态清理流程见[运行态维护](/reference/runtime-operations)，状态与错误解释见[状态与错误码](/reference/diagnostics)。
