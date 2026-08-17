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

`sandbox-exec-denied`、`sandbox-read-denied` 或 `GLOBAL_HOST_TARGET_UNVERIFIED` 表示当前精确命令或目录未被允许。只批准验证所需的最小 launcher 或目录后重试，不需要把永久完全访问作为默认修复。

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
