# 信任、安全与数据

DevCodex 是本地工作流控制层，不是模型网关。它把项目规则、任务状态和宿主适配器放在可检查的文件中；真正的模型调用、联网和数据处理仍由你选择的 AI Coding 宿主负责。

## 数据放在哪里

| 数据 | 默认位置 | 用途 |
|---|---|---|
| 项目 Profile、报告、记忆、任务状态 | workspace 的 `.devcodex/` | 让任务有项目边界、可验证并可续接 |
| 受管宿主 adapter 与稳定 runtime | 用户 HOME 下各宿主的 DevCodex 受管目录 | 把同一工作流合同带入六个宿主 |
| 临时对象 | `<workspace>/.tmp/devcodex/` | 有 owner、scope、TTL 与 lease 的运行时临时数据 |
| 业务源码 | 原项目目录 | DevCodex 只在已授权工作流中读取或修改 |

普通使用不需要 DevCodex 自己的常驻网络服务。源码包没有生产依赖；CLI 不代理模型请求，也不会把“本地优先”表述成“代码永不离开本机”。宿主是否上传上下文、保存聊天或使用联网工具，以该宿主、账号和组织策略为准。

## 一次任务的数据路径

```text
你的请求
  → 当前宿主
  → DevCodex 识别项目、意图与所需本地上下文
  → 宿主把其允许的上下文交给模型
  → 结果、验证和续接状态按工作流写回本地项目
```

DevCodex 的 Hook、MCP 和 Skill 负责选择与约束，不会替你改变宿主的隐私设置。处理敏感仓库前，应先确认宿主的数据保留、训练、地域和组织控制。

## 写入与权限边界

- `analyze` 和默认 `audit` 只读；`dev` 与 `fix` 在确认后写入。
- auto 只自动通过适用 CP，不会扩大项目、删除、发布或危险操作权限。
- `runtime prune`、`tmp maintain`、adapter remove 与 uninstall 默认预览；实际清理需要显式 apply 和可证明的所有权。
- configured、contract、native probe 和端到端 readiness 分层取证；文件存在不能冒充执行能力。
- DevCodex 不扫描、合并、覆盖或删除用户自己的宿主指令、原生 Skill 和个人配置。

## 你可以检查什么

```bash
devcodex status --json
devcodex doctor --json
devcodex runtime status --json
devcodex tmp status --json
```

JSON 输出使用稳定 envelope，适合保存最小诊断证据。分享输出前仍应检查路径、项目名和业务数据；不要公开 token、私有代码或无关配置全文。

## 源码、发布包与线上文档

源码 checkout、npm 发布包、GitHub Release 和线上文档是不同证据面。源码里的未发布能力不能写成 registry 用户已经获得；HTTP 200 也不能证明页面内容正确。站点首页显示当前 package 版本和事实投影生成日期，发布状态仍以 registry、tag 和发布验收为准。

## 报告安全问题

安全漏洞不要先开公开 Issue。请按仓库 [Security Policy](https://github.com/devcodex-labs/devcodex/blob/main/SECURITY.md) 发送邮件，包含受影响版本、复现步骤和影响；普通文档问题可以使用 GitHub Issues。

更多边界见[限制与边界](/reference/limits)，宿主差异见[六宿主能力边界](/reference/hosts)。
