# Profile、上下文与记忆

## 你在问什么

新会话为什么还知道项目规范？它读的是项目里的 Profile、必要源码和上次留下的文件记忆，不是把整个仓库塞进模型。

## 心智模型

- **Profile**：这个项目怎么构建、测试、发布，以及目录和安全边界；多项目 workspace 使用 workspace base + 当前 project overlay。
- **上下文**：当前任务真正用到的文件和说明，按需加载。
- **记忆**：按 session → project → task 绑定的进度、确认状态与验证证据，写在项目 `.devcodex` 下，供下一轮读取。

三者都是本地文件。换一台机器或新开会话，只要还在同一项目目录，就能按文件恢复。

会话索引只帮助找到可能的 project，不能授予写入。恢复时必须重新核对 active-root、context、route 和精确 task；不会按“最近未完成目录”、mtime 或 workspace 最后写入状态猜任务。正式任务使用稳定 hot A/B，安全 checkpoint 后可退成 cold resume stub，terminal 后立即退出 active cache；普通 Hook/工具事件不会各建一个 UUID 全量状态文件。

## 示例

你在项目根执行 `devcodex init` 后，规范、报告和记忆都落在 `.devcodex/`。下次说「继续上次修复」，它先解析当前 project 和精确 task，再读取该任务的有界状态，而不是让你重新解释背景或误接另一个项目。

## 边界

- 没初始化的目录没有项目记忆。
- 记忆不能替代你再确认一次危险操作。
- 另一个 session/project/task 的 CP、产物、验证或发布授权不能从记忆继承。
- 工作区私有路径和真实业务数据不要写进公开文档或案例。

## 相关页

[任务续接](/concepts/task-resume) · [跨会话续接案例](/examples/resume) · [配置](/reference/configuration)
