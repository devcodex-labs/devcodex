---
name: fix-default
description: 默认修复子类型规范 — Bug 修复三步扫描 + CP 流程
---
# Fix Default Skill

## 触发条件

用户报告 Bug、功能异常、报错，未匹配 incident/security 子类型时走默认路径。

## 问题诊断三步（CP1 前必做）

| 步骤 | 动作 |
|------|------|
| S0 问题概况 | 先确认这是 Bug / 异常 / 已承诺行为与实际不一致；报告方输入优先落 `bugs/<问题>/00-问题概况.md`，记录现象、重现步骤、期望行为、实际行为、环境版本、频率、影响范围和证据 |
| S1 重现 | 根据 `00-问题概况.md` 或等价报告确认问题可稳定重现，记录重现步骤 |
| S2 定位 | 代码层面定位根因（文件/函数/行号） |
| S3 影响评估 | 评估受影响范围（功能/接口/用户） |

## CP 流程

- **[CP1](../cp-gate/SKILL.md)**：确认问题定性 + `01-问题确认.md` / 等价 CP1 报告 + 根因分析 + 影响范围；不得把 Bug 当成产品新需求
- **[CP2](../cp-gate/SKILL.md)**：确认修复方案 + 回归测试策略
- **[CP3](../cp-gate/SKILL.md)**：≥5 文件变更或含高风险操作时**必须**；其他场景可选
- **执行期 CP3 回退**：若执行过程中实际修改范围扩展到 CP3 门槛（文件数从 <5 增至 ≥5、高风险操作新增、命中控制面/模板/validate/部署副本联动），必须暂停 source mutation，补做 CP3 后再继续。

## 执行阶段

实施前或实施中复现与当前问题/需求相关的新缺陷时，必须先执行 `spec-governance#InFlightIssueRequirementBindingGate`。PI/PF 不能替代当前问题真相源修订；阻断项先写回当前范围并提醒纳入决定，已有“一并处理/必须先处理”授权时直接同步方案、验收和回归路线后优先修复。

### ConvergenceFirstRepairBatchV1

当同一任务含多个 finding、控制面联动或版本发布收口时，执行顺序固定为：

1. 完成有界只读扫描并冻结 `IssueSetDigestV1 + RepairBatchPlanV1`，按共享根因/Owner 分批；发现一个就修一个再验证属于流程缺陷。
2. 所有 source writer 串行；实施期间只允许语法、schema、JSON parse、生成器 materialization 等编辑期检查，禁止逐项 targeted/affected/full。
3. 所有批次完成后一次生成统一 affected V2。Runner 必须完整收集失败集合；若失败，递增 repair generation、统一归因、批量修复后再重跑。
4. affected 与 ECR 收敛后冻结最终候选，再执行唯一发布级 V3/full。冻结后的任何 source/规范/生成消费者 mutation 都使该资格失效。

只有用户明确要求逐项隔离验证，或缺少某个编辑期探针会使后续 mutation 不安全时才能例外；例外必须记录 `skipBatchReason`，且不得形成候选资格声明。

1. 建立 `repair-collaboration` 双层契约：低风险使用 lightweight；P0/P1、安全、控制面、公共契约、≥5 文件、多批次、角色交接或发布风险使用 full，accepted 前必须有独立复证；模型/Agent 名称不参与触发
2. 执行 active `repair-prevention-assessment#RepairPreventionAssessmentGate`：所有 repair 在 accepted 前必须有有效 `RepairPreventionAssessmentV1`；当前修复重跑只关闭当前事件，不能冒充长期 prevention 有效
3. 实现修复（最小化变更范围）
4. 编写/更新回归测试
5. **修复三步必做**（[SC3](../compliance/SKILL.md) 强制，执行后立即扫描）：
   - 同类全局扫描 — 同一模式错误是否存在于其他位置
   - 数据联动扫描 — 上下游数据流是否受影响
   - grep 零残留复核 — 确认无残留引用
6. `api-verification`（若涉及接口）
7. `impact-review`（若 PR-5② 跨模块架构依赖变更）
8. `execution-contract` / `test-router`（full、≥5 文件、高风险、控制面或多批次修复时）
9. `document-sync`（若修复涉及文档说明）
10. **ECR 执行闭环复审** — 对照 CP1/CP2/CP3、实施进度（触发时）、报告、daily tasks、SUMMARY、diff/commit、测试/扫描证据和 dirty 边界，确认无假完成、无状态错配、无用户另案变更混入；输出 **ReviewGradeCard**（默认 reviewClass=R2/标准；控制面等高风险升 R3+清单；禁止无 skipReason 的「永远轻量」收口）；涉及规范源、Skill、Hook、CLI、MCP、模板、部署副本、路径规则或 validate 语义时必须执行 SCV（`spec-governance`）

## 关键规则

- 修复三步扫描按统一联查矩阵视为 L2 起步；命中控制面、多真相源、模板-示例-校验链或部署副本时，必须升为 L3
- 多个修复项、并行修复、子 Agent、子会话或 worktree 进入执行前，必须先调用 `requirement-parallel-orchestration`；未得到 valid `ParallelLaunchCardV1` 时，修复源码写入保持串行。
- 所有 repair 的完成证据必须同时包含当前关闭结论和 `RepairPreventionAssessmentV1`；若判定 `no-new-control`，必须给标准 reason 与独立证据，禁止静默跳过
- 高风险控制面 / 多批次修复的 ExecutionContract 与 TestRoute 必须显式列出历史能力回归矩阵，至少写清“历史能力 → 受影响批次 → 必跑验证 → 失败回滚点”
- 修复必须附带回归测试，禁止无测试的 hotfix（emergency 除外）
- 修复范围不得超出问题边界（禁止顺手重构）
- 若修复来源是外部审查报告、AI review finding、audit issue 或代码评审发现，CP1 前必须执行 `ReviewFindingIntakeGate`：报告只是线索，先补本地证据并分流 must-fix、设计如此、用户决策、文档/实现漂移、测试覆盖缺口和未复现项；命中用户决策或公共契约风险时，源码修改前必须确认。
- 命中 must-fix 或发布阻断 finding 时，必须执行 `FindingProbeMatrixGate`，逐项列出入口/消费者、最小失败输入、修复前失败形态、修复后通过条件、测试/脚本和发布面证据；复审至少一轮反向运行矩阵。
- guard / policy / permission / consistency / 写路径限制类修复必须执行 `GuardPolicyBypassMatrixGate`，覆盖 raw/native/legacy/management/admin/client 等绕过面、规则特异性、动作策略和负向 parser/key 组合。
- 执行任何验证命令前必须执行 `VerificationCommandSideEffectGate`：读取 script 定义，分类 read-only / writes-artifacts / mutates-source；类型校验优先 noEmit，写产物命令执行后扫描/隔离/清理生成物。
- 前端修复遵循 `FrontendBrowserVerificationBudgetGate` 与 `UserSelfVerificationOverrideGate`；用户明确自验或禁止浏览器/截图时不得主动启动 Browser/CDP/Playwright/截图，只记录代码级替代验证。
- 最小实现守门：CP1 问题确认必须给出 `ImplementationComplexityLevel`（兼容旧字段 `ImplementationComplexityPreference`），默认 `简单够用`；修复只解决已确认根因和影响范围，禁止无计划新增抽象、通用配置、预留扩展点或未确认防御分支；确需超出范围或升级到 `中等` / `企业级` 时回 CP2/CP3 并等待确认
- 必要注释守门：非显然根因、兼容约束、安全边界、状态转换或反直觉修复取舍必须有短注释；JavaScript / Node.js 中命中必要注释的导出函数、核心业务函数、类、复杂对象契约、参数/返回/异常说明必须使用标准 JSDoc；禁止逐行解释、重复代码含义、临时 TODO 或调试注释
- 依赖升级、兼容修复或批量适配类问题先记录问题清单与归因，再统一确认修复范围；auto 执行仍须回写问题清单、证据和台账状态，并按 ConvergenceFirstRepairBatchV1 批量实施后统一验证
- 内部共享库、中间件、SDK 或 adapter 抽象层根因优先评估“修共享库 + 消费项目升级”；单项目补丁必须说明理由与风险
- 简单业务 service 修复只保留业务编排、外部能力调用和必要上游错误映射，不重复 route/model/schema 已承担的校验与归一化
- 若问题同时满足“模板/示例不可直接执行、规则与示例冲突、自动化校验假绿、且涉及多文件联动的控制面缺陷”，应直接按 `fix.default` 处理，不当作文案微调顺手跳过修复流程
- 修复报告若给出多个后续建议或处理路径，必须有 `推荐结论` / `推荐方案` 与推荐理由；无后续动作时写明 `推荐：无后续动作`
- 输出报告：`reports/bugs/` 目录，遵循 [`report`](../report/SKILL.md) Skill 命名规则
