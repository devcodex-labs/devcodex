# 工作流总览

DevCodex 用工作流划定过程边界：会不会改文件、要不要确认、怎样算完成。项目实际有 **8 个 canonical workflow**；侧栏的四个入口按用户任务分组，不代表只有四个工作流。

## 先按任务选择

<ol className="devcodex-process-flow devcodex-process-flow--four" aria-label="选择 DevCodex 工作流的四个判断步骤">
  <li>
    <strong>看最终结果</strong>
    <span>不要只按请求里的单个关键词判断。</span>
  </li>
  <li>
    <strong>需要改文件</strong>
    <span>进入 dev、fix，或受限的 self-fix。</span>
  </li>
  <li>
    <strong>只要结论</strong>
    <span>进入 analyze、audit，或规划兜底 other。</span>
  </li>
  <li>
    <strong>处理会话</strong>
    <span>直接问答用 chat；继续原任务用 resume。</span>
  </li>
</ol>

| 你的任务 | 进入 | 包含的 workflow |
|---|---|---|
| 实现需求、修复缺陷，或修复 DevCodex 自身治理 | [开发与修复](/workflows/change) | `dev`、`fix`、高级 `self-fix` |
| 只要结论、证据审查或只读规划 | [分析、审查与规划](/workflows/read-only) | `analyze`、`audit`、高级 `other` |
| 快速问答，或继续一个已存在的任务 | [对话与任务续接](/workflows/session) | `chat`、`resume` |

只要最终目标包含改文件，就不能留在 `analyze`、`audit` 或 `other`；DevCodex 会要求重路由到 `dev`、`fix` 或 `self-fix`。

## 完整的 8 个工作流

| 工作流 | 默认写文件 | 关键确认 | 完成证据 |
|---|---:|---|---|
| `dev` | 是 | CP1 → CP2 → 条件 CP3 | 验收对照、测试、diff、报告 |
| `fix` | 是 | 问题定义 → 修复方案 → 条件计划 | 失败复现、根因、修复后回归 |
| `self-fix` | 是 | 问题确认 → 技术方案 → 条件计划 | 治理缺陷证据、修复、控制面回归 |
| `analyze` | 否 | 无写入确认 | 来源、结论、推断与未读范围 |
| `audit` | 否 | 默认只读 | 覆盖声明、发现项、证据等级 |
| `other` | 否 | 无写入确认 | 可执行计划、边界和重路由条件 |
| `resume` | 继承原任务 | 不重置原边界 | 任务身份、文件新鲜度、续接点 |
| `chat` | 否 | 不进入项目执行链 | 直接回答 |

primary workflow 共 6 个：`dev`、`fix`、`analyze`、`audit`、`resume`、`chat`。advanced workflow 共 2 个：`self-fix`、`other`。

## 工作流下面还有什么

- **用户任务 subtype**：当前共 12 个，帮助 `dev`、`fix`、`analyze` 选择专业路径。
- **内部步骤 route key**：`dev.plan-review` 是 CP2 后的内部方案复审，不是用户要选择的第 13 个 subtype。
- **audit target**：当前有 7 类审查对象，用于选择审查证据和检查维度。
- **Skill**：提供具体专业能力，可以和工作流组合，但不会变成新的 workflow。
- **阶段**：CP1、CP2、CP3、ECR 是确认或完成阶段；`plan` 是规划能力，不是第九个 workflow。

需要完整 ID 表时看 [工作流索引](/reference/workflows)；需要知道实际怎么做时进入对应分组页或任务教程。

## 兼容入口

旧的工作流地址继续可用：

- [`dev`](/workflows/dev) — 开发、重构或文档实施，改文件前要确认
- [`fix`](/workflows/fix) — 复现、定位并修复，改文件前要确认
- [`analyze`](/workflows/analyze) — 只读分析
- [`audit`](/workflows/audit) — 基于证据审查，默认不改文件
- [`resume`](/workflows/resume) — 从文件状态续接，权限继承原任务
- [`chat`](/workflows/chat) — 不走项目执行链的交流

## 高级边界

`self-fix` 只用于修复 DevCodex 自身治理、规则或流程，不是业务项目的默认入口。  
`other` 是无法安全归类时的规划兜底，不会因此获得改文件权限。

`self-fix` 只在问题属于 DevCodex 自身规则、Skill、Hook 或治理资产时使用；普通业务项目缺陷仍走 `fix`。`other` 只输出计划，若用户随后要求落地修改，必须重新识别为变更工作流。

[参考：工作流](/reference/workflows) 只承担稳定速查，不重复维护本页的选择说明。
