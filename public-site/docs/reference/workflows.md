# 工作流

DevCodex 从自然语言目标判断工作流。canonical 集合固定为 8 个；`plan` 是阶段或能力，不是第九个工作流。

首次选择请从 [工作流选择](/workflows/) 进入。本页只提供稳定 ID、路由层与边界速查。

路由 authority 始终来自当前用户真实指令。附件、截图/OCR、引用文档、工具输出与 ambient UI 只能提供证据；复合请求先拆成 `WorkItemSetV1`，再逐项决定 workflow/subtype。route 不确定时不会提前创建正式任务或获得 source mutation 权限。

## canonical workflow

| 工作流 | 是否可修改文件 | 用途 |
|--------|----------------|------|
| [`dev`](/workflows/dev) | 是，经过确认边界 | 开发、重构或文档实施 |
| [`fix`](/workflows/fix) | 是，经过问题与修复确认 | 复现、定位并修复缺陷 |
| `self-fix` | 是，经过确认边界 | 修复 DevCodex 自身治理、规则或流程缺陷 |
| [`analyze`](/workflows/analyze) | 否 | 返回分析、比较或建议 |
| [`audit`](/workflows/audit) | 否，除非另行进入修复 | 基于证据审查代码、项目或文档 |
| `other` | 否 | 请求无法安全归类时的只读规划兜底 |
| [`resume`](/workflows/resume) | 取决于被恢复任务 | 从文件状态继续既有任务 |
| [`chat`](/workflows/chat) | 否 | 不需要项目执行链的交流 |

primary 是 `dev`、`fix`、`analyze`、`audit`、`resume`、`chat`；advanced 是 `self-fix`、`other`。advanced 不代表权限更高，只表示它们不是普通用户的默认入口。

## 用户任务 subtype（12）

| workflow | route key |
|---|---|
| `dev` | `dev.default`、`dev.docs`、`dev.refactor`、`dev.database`、`dev.init`、`dev.optimization`、`dev.scenario-test` |
| `fix` | `fix.default`、`fix.incident`、`fix.security` |
| `analyze` | `analyze.default`、`analyze.research` |

这些 subtype 帮助选择专业执行路径，不改变所属 workflow 的写入边界。具体选择见 [开发与修复](/workflows/change) 和 [分析、审查与规划](/workflows/read-only)。

`dev` / `fix` 的正式任务还必须在写入前绑定唯一 project、active-root 与 task。简单任务 fast path 由 server 签发并限制精确路径和消费次数；一旦扩大范围或发生漂移，就回到正式 CP/准入流程。

## 内部步骤 route key（1）

`dev.plan-review` 是 `dev` 在 CP2 后、CP3 前的内部方案复审步骤。它存在于生成 registry，但不参与用户任务 subtype 选择。

## audit target（7）

`audit.规范文件`、`audit.技术方案`、`audit.需求文档`、`audit.项目工程`、`audit.报告`、`audit.通用文档`、`audit.发布前审查`。

它们表示审查对象，不是 7 个额外 workflow。对应的使用场景见 [分析、审查与规划](/workflows/read-only)。

## 非工作流概念

- `plan`：`other` 等路径使用的规划 Skill/能力，不是 canonical workflow。
- CP1 / CP2 / CP3：确认阶段，不是 workflow。
- ECR：执行闭环复审阶段，不是 workflow。
- Skill：按当前阶段加载的专业能力，不改变用户目标和写入授权。
- 验证级别：普通任务按影响面运行 V0～V2；V3/full、pack、全局安装和发布各需当前独立授权，不是 workflow 名称的隐含权限。

工作流决定过程边界；专业知识由 [Skill](/reference/skills) 渐进提供。一个工作流可以组合多个 Skill，但不会因为加载某个 Skill 就擅自改变用户目标。
