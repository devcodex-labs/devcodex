# 分析、审查与规划

这组工作流都默认 **不修改 source**。它们的价值不是少做一步，而是在授权写入前先把事实、风险、证据或计划收敛清楚。

## 先按你要的结果选择

| 你要的结果 | workflow | 输出重点 | 写入边界 |
|---|---|---|---|
| 解释、比较、诊断或建议 | `analyze` | 来源、推断、结论和不确定性 | 禁止 source mutation |
| 对照标准找问题 | `audit` | 覆盖范围、发现项、严重度与证据 | 默认只读；修复需独立授权 |
| 请求暂时无法安全分类，只需要可执行计划 | `other` | 计划、边界、依赖与重路由条件 | 禁止 source mutation |

## `analyze`：从事实得到结论

| route key | 适用任务 | 证据要求 |
|---|---|---|
| `analyze.default` | 架构分析、原因诊断、方案比较 | 区分已读事实、推断与未读范围 |
| `analyze.research` | 需要外部资料、官方文档或多来源研究 | 标明来源、时效、冲突和推断 |

当分析结论变成“请按建议修改”时，原 analyze 已完成；新请求必须转到 `dev` 或 `fix`，不能沿用只读上下文中的隐含授权。

## `audit`：按对象选择审查路径

audit 不是一种固定清单。当前有 7 类主 target：

| route key | 适合审查 | 主要证据 |
|---|---|---|
| `audit.规范文件` | 规则、Skill、Prompt、治理规范 | Owner、消费者、门禁和冲突 |
| `audit.技术方案` | CP2、设计说明、架构决策 | 需求覆盖、契约、风险和 TestRoute |
| `audit.需求文档` | PRD、需求确认、验收标准 | 用户价值、范围、歧义和可验收性 |
| `audit.项目工程` | 代码库、配置、测试、依赖 | 实际实现、影响面和回归证据 |
| `audit.报告` | 分析/测试/交付报告 | 结论与证据是否一致 |
| `audit.通用文档` | 用户手册、README、说明文档 | 受众、任务路径、事实与链接 |
| `audit.发布前审查` | tag、publish、部署候选 | 候选身份、变更范围、回滚和发布证据 |

README、用户手册或安全审查可能叠加专门 Skill，但它们仍属于 audit 的对象/能力组合，不会新增 canonical workflow。

## `other`：只读规划兜底

只有在请求无法安全归入 dev、fix、analyze、audit、chat 或 resume 时才使用 `other`。它可以给出计划，但 `plan` 只是能力，不是第九个 workflow。

一旦计划需要落地到文件，必须根据最终目标重路由：新增或演进走 `dev`，缺陷修复走 `fix`，DevCodex 自治理缺陷才走 `self-fix`。

## 怎样算完成

- `analyze`：问题得到回答，来源与推断可区分，未读范围不会被伪装成全量结论。
- `audit`：覆盖声明真实，finding 有定位和等级，未关闭项没有被隐藏。
- `other`：计划可执行，依赖、停止条件和需要重新授权的动作明确。

## 真实任务怎么选

“分析为什么构建越来越慢，只给结论”走 `analyze.default`；如果需要查 Node 或 Rspress 官方资料，走 `analyze.research`。

“审查整个用户站，列出问题但不要改”走 `audit.通用文档`，并叠加用户手册审查能力。之后若要求修复，开启新的 `dev.docs` 变更链。

“先给迁移计划，暂时不要改文件”在无法归类时可走 `other`；计划确认要实施后再路由到 `dev`。

## 下一步

- 理解只读与写入路由：[意图驱动](/concepts/intent-driven)
- 查看证据标准：[证据与完成](/concepts/evidence-and-completion)
- 稳定 ID：[工作流索引](/reference/workflows)
- 需要实施时：[开发与修复](/workflows/change)
