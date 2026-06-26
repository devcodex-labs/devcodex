---
applyTo: "**"
description: Profile 加载、active-root 路径、目标项目识别与项目现实扩展的通用规范
priority: P5
version: 1.11.24
---
# Profile 加载与项目现实扩展

> 本文件是 `01-common` 的分拆视图，承载 Profile / active-root / 项目识别 / 项目现实扩展细节。

## 适用范围

- 适用于所有工作流（含 analyze / audit / chat）。
- 无论工作流子类型是否有对应 Skill，均须在收到消息后、执行工作流前完成 Profile 加载。
- Profile 缺失时 ENV_MODE 默认为 `prod`（保守降级）。
- chat 不豁免 Profile 加载和入口检查；它只豁免合规检查层（FC/SC/RC/T）和报告。
- 跨会话恢复时必须重新读取 Profile 文件；摘要 ≠ Profile 已加载。

## `.devcodex` 读取与写入模型

> `layout.json` 是集中存储开关：当 `<工作区根>/.devcodex/layout.json` 存在且声明 `workspace-namespace` 模式时，进入工作区集中存储模型；不存在时，保持旧的 `<项目根>/.devcodex/` 兼容路径。

### Profile / config 读取

- `config.json` 采用 `workspace base + project overlay`；Auto 精确别名全局默认 `@rocky`，可用 `extensions.devcodex.autoAliases` 替换全局默认别名（省略表示沿用默认，空数组表示关闭默认别名），也可在 `extensions.devcodex.concurrency` 配置 `ConcurrencyPolicy`
- `extensions.devcodex.concurrency` 缺省为 `mode=auto`：只读准备与隔离验证可按通道上限并行；`mode=serial` 表示全串行；项目只能追加 `locks.additionalSingleWriterScopes`，不得删除核心单写者域或开启并行 mutation
- `config.local.json` 与 `config.json` 同路径模型，可作为用户 / 项目指定的本地 overlay（长期连接、本地明文连接信息、env / secretRef 引用、`extensions.<namespace>`），不得覆盖 `mode` / `agent` / `pluginVersion`
- 连接配置来源遵循 S02：默认可直写或沿用项目既有模式；只有用户或项目明确指定 `config.local.json` 时，脚本、测试、数据库 / SSH / MongoDB / 数据操作才从当前 Profile 路径模型下的 `config.local.json` 读取，缺失文件或字段时提醒补齐
- `config.local.json` 可保存 host、port、database、schema、username、内部 URL、连接别名、password、token、apiKey、privateKey、clientSecret、signingKey、connectionPassword、connectionString 等本地字段；`*Env` / `secretRef` 只有在用户指定、项目既有配置或用户指定的发布流程明确要求时才使用
- `README.md`、`01-项目信息.md`、`02-架构约束.md`、`03-代码风格.md` 采用 `project file first + workspace fallback`
- Profile 缺失时仍按 `prod` 保守降级；若用户要求补建 Profile、恢复 dev 模式、初始化 `.devcodex/profile/` 或修复 Profile 缺失，应读取 `profile-bootstrap` 并优先建议/执行 `devcodex profile init`，不得用 AI 推测内容静默替代 Profile 文件真相源。

### 运行态目录写入

- 单项目任务：写入 `<工作区根>/.devcodex/<project>/...`
- 全工作区任务：写入 `<工作区根>/.devcodex/workspace/...`
- 记忆与报告中的 `<agent>` 目录按当前实际宿主确定；`profile/config.json` 的 `agent` 仅作为无法识别宿主时的兜底提示，不能覆盖当前会话事实
- 未启用 `layout.json` 时，继续使用 `<项目根>/.devcodex/...`
- 同一轮执行只能存在一个活动写入域；不得同时向项目旧路径与工作区新命名空间双写
- 涉及 `.devcodex` 读取或写入时，必须能明确说明当前使用的是 `workspace` 还是 `<project>` 命名空间

## 确定目标项目

| 优先级 | 条件 | 结果 |
|:------:|------|------|
| 1 | 用户明确指定项目名称 | 直接使用 |
| 2 | 消息涉及工作区目录 | 映射到项目名 |
| 3 | 🔴 无法确定 | 必须先询问用户；在用户明确回复前，禁止发起任何超出当前文件范围的工作区扫描 |

### 多项目工作区扫描禁令

- 当 cwd 是 monorepo 根目录（包含 ≥ 2 个含 `package.json` 或 `.devcodex/profile/` 的子项目）且未明确 `<project>` 时，AI 必须先询问用户。
- 豁免词：用户消息含 `workspace` / `monorepo` / `全工作区` / `all projects` / `所有项目` 则允许全工作区扫描。
- `lifecycle.cjs` 默认 `safety-only` 下只输出提醒并放行工具，`strict` 模式下才执行 runtime 硬拦截；本条仍是 AI 侧必须遵守的流程约束。
- 当启用 `workspace-namespace` 且缺少 workspace profile 时，运行时提示必须指向真实路径 `.devcodex/workspace/profile/`。
- 若同一宿主会话已识别唯一目标项目，后续“继续 / 确认”等消息可在短 TTL 内沿用 sticky `activeProject` 与项目 `mode`；新会话、TTL 过期、命中多个项目或用户显式选择 workspace 时必须重新判断。

## 项目现实扩展（Project Reality Expansion）

执行顺序必须为：

```text
用户消息语义初判 → 目标项目识别 → Profile / config 加载 → 项目现实扩展 → 最终意图与工作流路由
```

- 项目现实扩展只能使用已确定项目的 Profile、明确提及文件、当前需求产物和必要只读元信息；不得绕过“项目未识别先询问”的扫描禁令。
- 扩展内容必须至少判断：真实项目范围、可能受影响文件族、适用工作流/子类型是否需要修正、产物落点、验证方式、是否存在多项目/跨服务边界。
- 若扩展后发现初判意图不准确，应在 PC1 中表达为“语义初判 → 项目现实修正后的最终路由”，再进入对应工作流。
- 若扩展不足以稳定判断，不得猜测；应在入口检查处提出最小澄清问题。

## Profile 标准文件

| 文件 | 说明 | 必须 |
|------|------|:----:|
| `README.md` | profile 索引 | 是 |
| `01-项目信息.md` | 技术栈/仓库地址 | 是 |
| `02-架构约束.md` | 目录结构/模块边界 | 是 |
| `03-代码风格.md` | 编码规范 | 是 |
| `04-测试规范.md` | 测试框架/覆盖率 | 按需 |
| `05-发布规范.md` | 版本号/发布流程 | 按需 |
| `config.json` | 运行模式配置（ENV_MODE）+ agent 兜底标识；Auto 别名全局默认 `@rocky`，可配置 `extensions.devcodex.autoAliases` 替换默认别名；也可配置 `extensions.devcodex.concurrency` 并发策略 | 按需 |
| `config.local.json` | 用户 / 项目指定时使用的本地 overlay：长期连接、本地明文连接信息、env / secretRef 引用、`extensions.<namespace>` 扩展位 | 可选 |

## ENV_MODE 注入

| 情况 | ENV_MODE |
|------|---------|
| `config.json` 存在且 `mode: "dev"` | `dev` |
| `config.json` 不存在 / mode 缺失 | `prod`（保守默认）|
