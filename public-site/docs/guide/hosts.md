# 宿主与工作区设置

先完成[5 分钟开始](/guide/getting-started)，再处理宿主差异、auto 或多项目 workspace。本页只讲如何选择入口；能力结论以[宿主参考](/reference/hosts)的当前证据为准。

## 选择你的入口

| 宿主 | 推荐入口 | 使用前要知道 |
|---|---|---|
| GitHub Copilot | Copilot CLI | VS Code / JetBrains 主要使用 instruction fallback，不能继承 CLI 的 Hook 证据 |
| Claude Code | Claude Code | 完整程度以当前 adapter 和 direct evidence 为上限 |
| Codex | Codex App / CLI | Hook 与 MCP 是否生效取决于当前安装和宿主能力 |
| Gemini | Gemini CLI | 没有 direct replay 时保持 Beta / `UNVERIFIED` |
| Grok | `devcodex grok` | 普通 `grok` 是 Partial 兼容入口 |
| Cursor | 本地 IDE / CLI | 本地为 Beta；Cursor Cloud Agent 是 Partial / `UNVERIFIED` |

安装或更新 DevCodex 后要完全新开宿主会话。旧会话不会在中途切换 runtime generation。

## 多项目 workspace

在共同 workspace 根执行：

```bash
cd <workspace-root>
devcodex init
devcodex status
```

DevCodex 使用 workspace base + project overlay 保存项目 Profile、报告、记忆和任务状态。开始任务时应能解析出唯一项目；若多个候选同名或 active-root 不唯一，先明确项目名或进入对应项目目录，不要让模型猜。

## auto 入口

正式入口为 `@devcodex-auto`，默认快捷别名是 `@rocky`：

```text
@rocky 按已确认方案完成文档修改并运行相关验证，不要提交或发布。
```

auto 只自动通过适用 CP，不会扩大项目范围或发布授权；文件、删除与命令权限由宿主及其用户配置决定。`extensions.devcodex.autoAliases` 为非空数组时会替换默认别名；空数组会关闭默认别名。

## 验证宿主是否真的就绪

```bash
devcodex status
devcodex doctor
```

不要只看“配置文件存在”。依次确认 workspace 已解析、adapter configured、contract 通过，以及当前宿主要求的 native probe 是否有直接证据。没有证据就保留 `UNVERIFIED`。

## 常见恢复

- **更新后仍是旧行为**：完全退出并新开会话，再核对版本和 runtime generation。
- **Grok 没有完整流程**：确认从 `devcodex grok` 启动，而不是普通 `grok`。
- **Cursor Cloud 看起来比本地少**：这是已知能力边界，不能用本地 Beta 结果覆盖 Cloud。
- **项目识别错误**：回到真实项目或 workspace 根运行 status；检查 Profile 和 project overlay。

仍无法恢复时进入[故障排查](/guide/troubleshooting)。
