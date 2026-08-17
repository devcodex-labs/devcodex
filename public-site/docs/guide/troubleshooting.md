# 故障排查

先从目标项目或 workspace 根目录运行：

```bash
devcodex status
devcodex doctor
```

## 安装后没有 PC、确认或 SkillRoute

依次确认：

1. `devcodex --version` 是否来自预期 npm 安装；
2. `devcodex status` 的 adapter 与 contract 是否通过；
3. 当前目录是否存在正确的 `.devcodex/`；
4. 是否完全退出旧会话并新建会话。

如果 adapter 未就绪，执行：

```bash
devcodex global-adapters apply
```

随后完全退出宿主并重新打开。不要在旧会话中判断更新是否生效。

## `native=unverified` 是什么

它只表示对应宿主的原生 CLI 或真实模型回放尚无当前 direct evidence，不等于已配置的 adapter 一定失败。判断时把配置合同、原生 CLI 和端到端回放分开。

## 状态字段怎么恢复

| 诊断 | 含义 | 最短恢复路径 |
|---|---|---|
| `adapter=not-ready` | 受管入口缺失或未刷新 | `devcodex global-adapters apply` 后重开宿主 |
| `contract=failed` | 已安装内容与当前合同不一致 | 保存 doctor 输出，重新 apply；仍失败则按首个 typed error 修复 |
| `host kernel not installed` | 当前宿主没有可读取的内核入口 | 在受支持版本执行 apply，并确认目标 HOME |
| `native=unverified` | 缺少原生 CLI / 模型回放证据 | 检查宿主命令身份；不要把它误报为 ready 或 failed |

`status` 展示摘要，`doctor --json` 展示逐宿主、逐合同和恢复动作。文件存在、命令同名或另一个宿主通过都不能替代当前宿主证据。

## Grok 没有完整上下文

优先在项目目录运行：

```bash
devcodex grok
```

这是 Full launcher。普通 `grok` 是 Partial 入口；即使 Hook 能执行，也不能据此宣称与启动注入完全等价。

如果出现 Hook `ParserError` 或重复来源，先升级 DevCodex、重新应用 adapter，并在全新会话验证。不要复制 Claude 或 Cursor 的 Hook 到 Grok 配置中。

## Cursor 本地与 Cloud 行为不同

本地 IDE、交互 CLI 和 Headless CLI 使用用户级 Hook、Plugin 与 MCP，当前为 Beta。Cursor Cloud Agent 不加载这些用户级 Hook，因此固定为 Partial / `UNVERIFIED`。

Windows 上若 `agent --version` 命中其他同名命令，优先检查 `cursor-agent --version` 和 PATH 顺序；“某个 agent 命令能运行”不是 Cursor native 已就绪的证据。

## 沙箱或权限错误

`node runtime BLOCK (... reason=sandbox-exec-denied)` 表示宿主在 DevCodex JavaScript 启动前拒绝执行 Node launcher。`GLOBAL_HOST_TARGET_UNVERIFIED` / `sandbox-read-denied` 表示对应用户级宿主目录当前不可读，其他宿主仍可继续检查。

先运行：

```powershell
Get-Command node
node --version
devcodex doctor --json
```

只对精确 launcher 或精确用户目录做最小范围批准，再重试。Volta、NVM、FNM 或 asdf 更新 shim 物理路径后可能需要重新批准；永久完全访问不是默认修复方案。

## 临时目录与运行态

工作区临时产物的 canonical root 是 `<workspace>/.tmp/devcodex/`。先按 project/partition 查看和生成维护计划：

```bash
devcodex tmp status --json
devcodex tmp status --project=<project> --partition=runs
devcodex tmp maintain --project=<project> --partition=runs
```

`tmp maintain` 默认 plan-only。只有 owner、target、TTL、lease 与备份事务都可验证，并且用户显式给出 `--apply` 和一个完整 scope 时，才允许处理候选；legacy、未知 owner、共享 lease、reparse point、路径逃逸或分页未完成都会保持 blocked。

查看普通运行态占用时使用：

```bash
devcodex runtime status
devcodex runtime prune --dry-run
```

不要手动把 `.devcodex/**/.tmp`、锁文件或未知临时目录当作可安全删除对象。

## 更新

```bash
npm update -g devcodex
devcodex global-adapters apply
devcodex status
```

完成后重新打开宿主的新会话。

## 卸载

先预览，再显式执行受管清理：

```bash
devcodex uninstall --dry-run
devcodex uninstall --apply
npm uninstall -g devcodex
```

如果仍无法恢复，请提交 `devcodex status`、`devcodex doctor`、宿主名称、版本和最小复现步骤；不要提交 token、私有代码或无关配置全文。

## 全局安装包缺少源码测试脚本

npm 安装包是用户运行时，不是维护者源码仓镜像。最终 tarball 只公开安装生命周期、`npm run validate` 与宿主适配的必要入口；测试、benchmark、生成器和发布编排留在源码仓。

如果已安装包中的 `npm run validate` 或 `npm pack` 报 `MODULE_NOT_FOUND`，这是包完整性故障，应升级并提交完整输出，不应通过完全访问绕过。开发或发布 DevCodex 时请使用源码 checkout。
