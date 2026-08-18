# 5 分钟开始

本页的目标是让一个新项目在最短路径内获得可验证的 DevCodex 会话。

## 1. 检查环境

DevCodex CLI 需要 Node.js `>=18.17.0` 和 npm。

```bash
node -v
npm -v
```

如果命令不存在或版本过低，请先安装当前 Node.js LTS，然后重新打开终端。

## 2. 安装 DevCodex

```bash
npm install -g devcodex
devcodex --version
```

安装会刷新用户 HOME 下由 DevCodex 管理的宿主适配器；不会自动修改业务源码，也不会启动常驻网络服务。

## 3. 初始化项目

进入真实项目或 workspace 根目录：

```bash
cd <你的项目或 workspace 根目录>
devcodex init
devcodex status
```

`devcodex init` 创建 `.devcodex/` 运行态。多项目 workspace 可以只在 workspace 根初始化；子项目会按稳定命名空间保存自己的报告、记忆和任务状态。

## 4. 新建宿主会话

完全退出旧会话，再在同一项目目录打开 Codex、Claude Code、GitHub Copilot、Gemini CLI、Grok 或 Cursor 的新会话。已经打开的会话不会在中途自动换用新版本。

Grok 的完整入口是：

```bash
devcodex grok
```

普通 `grok` 仅是 Partial 兼容入口。Cursor Cloud Agent 同样保持 Partial / `UNVERIFIED`，不能继承本地 IDE 或 CLI 的 Beta 结论。

## 5. 发起第一个任务

```text
分析当前项目，告诉我最应该先改进的三个问题。只分析，不修改文件。
```

需要自动推进时使用正式入口：

```text
@devcodex-auto 修复当前失败的 CI，运行相关测试，只在验证通过后告诉我完成。
```

默认快捷别名 `@rocky` 保持兼容。自动推进不会扩大删除、发布或越过项目范围的权限。

这次只读任务不改文件。如果模型开始改代码，停下来重说「只分析，不修改文件」。

## 6. 第一次任务之后

读 [架构怎么跑](/concepts/architecture) 和 [`analyze` 工作流](/workflows/analyze)，确认只读与改文件的差别。若要跨天继续，用 `继续<任务名>任务`，见 [任务续接](/concepts/task-resume)。

下一步可以查看 [常见任务](/guide/common-tasks)；遇到未出现流程或宿主未就绪时，前往 [故障排查](/guide/troubleshooting)。
