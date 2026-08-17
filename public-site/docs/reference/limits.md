# 限制与边界

## DevCodex 不是什么

- 不是模型网关，不代理、托管或选择模型供应商；
- 不是通用 Agent 框架；
- 不是多 Agent 编排器；
- 不替代业务框架、GitHub CI、安全审计或人工评审；
- 不保证所有宿主的 Hook、MCP、插件与权限完全相同。

## 本地优先的准确含义

DevCodex 的工作流状态、Profile、报告、记忆和 Workspace Skill 以本地文件保存，普通使用不需要额外后台服务。模型执行、联网行为和数据处理仍遵循所选 AI Coding 宿主及其账号配置。

“本地优先”不表示所有代码永不离开本机，也不表示模型在本地运行。

## 安装边界

| 位置 | 行为 |
|------|------|
| 用户 HOME | 安装或刷新 DevCodex 受管宿主适配器 |
| 项目 / workspace | 用户执行 `devcodex init` 后创建 `.devcodex/` |
| 项目源码 | 安装本身不自动修改业务源码 |
| 后台服务 | 普通使用不启动常驻网络服务 |
| 原生 Skill / 配置 | 不接管用户已有资产 |

## 证据边界

HTTP 200 不足以证明某个产品页面正确；配置存在不足以证明宿主可执行；测试通过也不自动证明 npm、GitHub Release 或本机已更新。DevCodex 分别记录源码、构建、发布、线上回读和本机消费证据。

遇到不确定状态时查看 [故障排查](/guide/troubleshooting) 和 [宿主边界](/reference/hosts)。

## 运行态协议参考

以下名称用于诊断和证据回读，不要求普通用户手工构造：

| 协议 | 说明 |
|---|---|
| `StageLoadReceiptV1` | 证明 SkillRoute 某个阶段正文已经加载；catalog 或 commit 不能替代 |
| `NextActionEnvelopeV1` | 结构化记录当前唯一恢复动作；界面通常只显示压缩后的自然语言动作 |
| `MemoryCursorV1` | 绑定工具、项目、ContextRead、查询与来源身份的分页游标，下一页必须原样回传 |
| `MemoryFileTransactionReceiptV1` | 记录 memory 文件事务的提交前后摘要、CAS、flush/readback 与字节证据 |
| `WorkspaceTempManifestV2` | 临时对象的 owner、目标、生命周期、TTL 与 lease 权威；V1 只读兼容 |

这些协议都采用失败关闭：绑定、来源或 scope 变化时不会静默回到第一页、猜测另一项目或自动重放修改性动作。

## 清理边界

`runtime prune` 和 `tmp maintain` 默认只预览。实际清理必须显式 `--apply`，并且只能作用于 DevCodex 可证明拥有、已经过期且没有活动 lease 的对象。用户配置、宿主根目录、未知临时文件、共享对象和无法验证的遗留内容都不属于自动清理范围。
