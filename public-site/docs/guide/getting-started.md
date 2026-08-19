# 5 分钟开始

本页只完成一件事：在一个真实项目里发起只读分析，并用可观察结果确认 DevCodex 已经进入工作。全程不需要 auto、提交或发布权限。

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

进入真实项目根目录：

```bash
cd <你的项目或 workspace 根目录>
devcodex init
devcodex status
```

`devcodex init` 创建或刷新 `.devcodex/` 工作区状态，不修改业务源码。第一次成功先使用单项目路径；多项目 workspace 放到[宿主与工作区设置](/guide/hosts)再处理。

### 这一步成功后应看到什么

- `devcodex --version` 能返回已安装版本；
- 项目根出现 `.devcodex/`，`devcodex status` 能识别当前 workspace 或项目；
- 状态把 configured、adapter contract、native probe 与最终 readiness 分开显示，未验证项不会伪装成 ready；
- 如果出现 `Profile README.md is missing`、adapter 未就绪或契约失败，先执行 `devcodex doctor`，再按[故障排查](/guide/troubleshooting)恢复。

## 4. 新建宿主会话

完全退出旧会话，再从同一项目目录打开你实际使用的宿主。已经打开的会话不会在中途自动换用新版本。各宿主入口不同；Grok、Cursor Cloud 和 IDE/CLI 差异见[宿主与工作区设置](/guide/hosts)。

## 5. 发起第一个任务

```text
分析当前项目，告诉我最应该先改进的三个问题。请先说明读取范围和证据，只分析，不修改文件。
```

### 这次任务的可见成功信号

1. 回复开头显示入口检查，意图或最终路由为 `analyze`。
2. 它说明项目边界、读取了哪些资料，以及哪些范围没有读取。
3. 三个问题都能指向文件、配置或命令输出；推断会明确标注。
4. 没有修改业务文件，也没有把建议描述成已完成的修复。

用 `git status --short` 或宿主的变更面板复核：除了你原有的改动，不应出现本次分析产生的业务源码修改。如果入口没有出现、路由不是 `analyze`，或 Profile 无法加载，停止任务并进入[故障排查](/guide/troubleshooting)。

## 6. 第一次任务之后

这一步通过后，你已经证明了“项目识别 → 意图路由 → 有界读取 → 证据结论”的最短路径。下一步选择：

- 把模糊请求整理成需求：[完整教程](/tutorials/ambiguous-request)
- 修改代码或文档：[`dev` 工作流](/workflows/dev)
- 修复现有问题：[修复并控制回归](/tutorials/fix-regression)
- 配置 auto、多项目或特殊宿主：[宿主与工作区设置](/guide/hosts)
