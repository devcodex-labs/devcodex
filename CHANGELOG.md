# 变更日志 (CHANGELOG)

> **说明**: 版本概览摘要。最新版本的详细变更见下方表格首行的 `changelogs/releases/vX.Y.Z.md` 链接；历史版本见对应详细变更文件
> **最后更新**: 2026-06-09

---

## 版本概览

| 版本 | 日期 | 变更摘要 | 详细 |
|------|------|---------|------|
| [v1.11.15](./changelogs/releases/v1.11.15.md) | 2026-06-09 | 🔧 **问答证据门禁、复杂度用户面与产物生命周期收口**：新增 `QuestionEvidenceGate / ComparativeResearchGate`，将 CP1 复杂度主口径升级为 `ImplementationComplexityLevel` 三档，并补齐 `ArtifactDecisionMatrix / ArtifactLifecycleState`、模板漂移探针与 V8 source-root 部署副本检查 | [查看](./changelogs/releases/v1.11.15.md) |
| [v1.11.14](./changelogs/releases/v1.11.14.md) | 2026-06-05 | 🔧 **ExistingRequirementArtifactOverride 与需求回写收口**：修复 `SimpleTaskFastPath` 对既有需求/bug 真相源的过宽豁免，明确调整需求必须先回写已有文件，回复只做摘要；`v1.11.14` 替代未 registry 发布的 `v1.11.13` | [查看](./changelogs/releases/v1.11.14.md) |
| [v1.11.13](./changelogs/releases/v1.11.13.md) | 2026-06-04 | 🔧 **默认简单实现档位与 Profile Auto 别名**：CP1 新增 `ImplementationComplexityPreference` 且默认 `simple`，Auto v1.1 支持 Profile `extensions.devcodex.autoAliases`（本项目 `@rocky`），并补齐 runtime / profile schema / V13-V14 探针 | [查看](./changelogs/releases/v1.11.13.md) |
| [v1.11.12](./changelogs/releases/v1.11.12.md) | 2026-06-04 | 🔧 **平台工程守门、轻路径与复审覆盖收口**：新增平台工程前置、SimpleTaskFastPath、ContextHandoffCard、ReviewCoverageDelta、发布包边界串行与消费者依赖树优先探针，并补强发布型 Profile 与 V56/V57 校验 | [查看](./changelogs/releases/v1.11.12.md) |
| [v1.11.11](./changelogs/releases/v1.11.11.md) | 2026-06-03 | 🔧 **S02 用户策略优先与服务清理收口**：反转 S02 为默认允许敏感信息、明文连接信息与硬编码；仅用户 / 项目明确禁止时才脱敏、占位或改用 env、`secretRef`、secret manager、`config.local.json`，并新增 AI 自启动服务清理闭环 | [查看](./changelogs/releases/v1.11.11.md) |
| [v1.11.10](./changelogs/releases/v1.11.10.md) | 2026-06-02 | 🔧 **config.local 连接配置唯一入口收口**：收窄 S02 为可提交产物秘密禁止，允许用户授权的本地明文秘密写入已忽略的 `profile/config.local.json`，并强制脚本、测试、数据库 / SSH / MongoDB / 数据操作连接信息只能从 `config.local.json` 取得 | [查看](./changelogs/releases/v1.11.10.md) |
| [v1.11.9](./changelogs/releases/v1.11.9.md) | 2026-06-02 | 🔧 **通用规范吸纳与提示词激励收口**：吸纳自然语言 Auto、Node.js >=18、远端 CI、依赖/兼容拆层、内部共享库评估、包工程层、TS 契约迁移、provider/connector 字段合同、service 防过度防御、README 能力矩阵与 JS/Node 标准 JSDoc，并补齐最小实现/复杂度预算守门 | [查看](./changelogs/releases/v1.11.9.md) |
| [v1.11.8](./changelogs/releases/v1.11.8.md) | 2026-06-02 | 🔧 **technical-design 技术方案模板字段补强**：补齐目标架构、模块边界、接口契约矩阵、数据/状态模型、执行流程锚点与需求验收映射，并同步 `dev-plan-review` 与 `V13` 探针，避免 CP2 技术方案退化为文件清单或散落测试备注 | [查看](./changelogs/releases/v1.11.8.md) |
| [v1.11.7](./changelogs/releases/v1.11.7.md) | 2026-06-01 | 🔧 **官方文档证据前置 + Profile 联动判定补强**：新增 `C20/C21`、`OfficialDocsEvidence` 与 `ProfileImpactCheck` 执行链，同步 dev/fix、plan-review、document-sync、Prompt、README/website 与 `V54` 探针，并补齐 CLI runtime helper 包边界 | [查看](./changelogs/releases/v1.11.7.md) |
| [v1.11.6](./changelogs/releases/v1.11.6.md) | 2026-06-01 | 🔧 **治理台账长尾收口 + 发布/宿主/时间线守门补强**：收口 backlog governance、audit-release、ArtifactLinkSet、Codex PreCompact、S02 受控例外、changelog releases 与 Profile Freshness，并补齐 `V49` active-root 台账关闭时间线探针 | [查看](./changelogs/releases/v1.11.6.md) |
| [v1.11.5](./changelogs/releases/v1.11.5.md) | 2026-05-29 | 🔧 **requirement 运行时产物结构探针 + 最近样本收口**：新增 `V41` 与 `test-requirement-artifacts`，把 `01/04/05` 的运行时最低结构纳入自动校验，并回补近期 requirement 样本的计划/进度漂移 | [查看](./changelogs/releases/v1.11.5.md) |
| [v1.11.4](./changelogs/releases/v1.11.4.md) | 2026-05-29 | 🎯 **治理 Intake 全模式收口 + 本地 Profile overlay + README 专项治理**：将 Improvement Intake / 分流矩阵统一到所有模式，新增 `config.local.json` 受控 overlay、`V39/V40` 与 targeted tests，并补 `readme-authoring` / `audit-readme` / README 专项 review | [查看](./changelogs/releases/v1.11.4.md) |
| [v1.11.3](./changelogs/releases/v1.11.3.md) | 2026-05-29 | 🛡️ **命名空间安全边界与宿主配置保护收口**：统一 `workspace-layout` 真相源，阻断 MCP `project` 路径穿越、修复 nested monorepo 命名空间碰撞与无会话 sticky 误继承；Claude adapter 改为备份+保守合并，`doctor` 去除 Codex 偏置，并将 `test:audit` 从确定性主链拆分 | [查看](./changelogs/releases/v1.11.3.md) |
| [v1.11.2](./changelogs/releases/v1.11.2.md) | 2026-05-28 | 🔧 **治理生命周期与运行态落点收口**：新增 `spec-governance` / RecordRouter / SCV 验证链，修复 workspace-namespace 运行态落点、临时/备份产物漂移、MCP SUMMARY 模板与 release/profile/audit-state 防漂移校验，并同步 Profile 全模式 PC0~PC7 与历史归档页口径 | [查看](./changelogs/releases/v1.11.2.md) |
| [v1.11.1](./changelogs/releases/v1.11.1.md) | 2026-05-27 | 🔧 **Codex 宿主闭环 + Hook 契约与执行复审增强**：补齐 Codex adapter 分发、宿主实际落点、Hook 拦截状态机、危险命令确认、MCP memory scope、宿主输出契约 direct replay，并新增 ECR、Intent Expansion Card、ConfirmationRequest 与报告推荐结论校验 | [查看](./changelogs/releases/v1.11.1.md) |
| [v1.11.0](./changelogs/releases/v1.11.0.md) | 2026-05-26 | 🎯 **全模式入口检查 + 项目现实扩展**：PC0~PC7 从 dev-only 提升为所有模式基础入口状态，dev 模式保留 PC4 完整规范雷达与 FC/SC/RC/T；新增“语义初判 → Profile → 项目现实扩展 → 最终路由”链路，并同步 runtime bootstrap/Stop 提醒、模板、Skills、validate 探针、README 与网站文档 | [查看](./changelogs/releases/v1.11.0.md) |
| [v1.10.0](./changelogs/releases/v1.10.0.md) | 2026-05-26 | 🎯 **工作区集中存储 + 真实迁移闭环**：新增 `migrate-layout` CLI 与迁移 smoke test，落地 `.devcodex` `workspace-namespace` 存储模型并完成真实 `E:\Worker` 工作区迁移；统一 MCP/Hook/validate/profile 对新布局的解析，收口 `pending-issues` 模板链、多客户端真相源、agent 枚举与治理探针，并同步 `.github/.claude` 部署副本 | [查看](./changelogs/releases/v1.10.0.md) |
| [v1.9.13](./changelogs/releases/v1.9.13.md) | 2026-05-25 | 🔧 **目标文档前置 + 最终回复闭环提醒补强**：为 `dev` / `docs` 主链补入契约驱动型“目标文档前置”与执行后“轻量复审收敛”正式阶段表达，澄清 `dev-docs` 与 `api-verification` 的轻量文档 / 归档验证边界；同时在 `hooks/_runtime/lifecycle.cjs` 为 dev 模式最终回复补入合规状态块与 FC5 产物路径的 `Stop` 兜底提醒，并通过 `test-hooks-runtime.js` 覆盖 artifact section 边界误判样本 | [查看](./changelogs/releases/v1.9.13.md) |
| [v1.9.12](./changelogs/releases/v1.9.12.md) | 2026-05-25 | 🔧 **MCP 发布链补强 + 控制面一致性闭环**：补齐 `mcp/` 发布资产与 MCP smoke test，统一 `bugs/` / `requirements/` 任务链口径，收紧跨任务 CP gate 边界，新增确认后前置轻量复审（C19），统一 `data/*` 运行时台账语义、`sessions.md` 模板和任务级报告优先路径；`instruction-fallback-check.js` 对齐 `.archived` 跳过与排序策略，并新增 `V7b` fallback smoke test | [查看](./changelogs/releases/v1.9.12.md) |
| [v1.9.11](./changelogs/releases/v1.9.11.md) | 2026-05-22 | 🔧 **Auto v1.1 runtime 收口 + 控制面校验补强**：在 auto 白名单门禁落地后，继续收紧 bootstrap 到当前 agent + 今日/昨日 tasks，补齐缺少 `agent` 的 fallback 推断与回归测试；对齐 `profile init` 与 `validate-profile.js` 模板/真相源校验；`validate.js` V10 改为结构化探针并新增 V15 audit-state 状态机校验，同时同步父级 `.github/.claude` runtime 副本 | [查看](./changelogs/releases/v1.9.11.md) |
| [v1.9.10](./changelogs/releases/v1.9.10.md) | 2026-05-21 | 🔧 **模板/工作流漂移修复 + V13 语义门禁**：修复 precheck 模板 PC0~PC7 与 chat 预检查口径、Token 当前全开放说明、报告模板强制头部和 fix 专属章节、chat daily memory、CP3 `N/A` 豁免运行时识别、API/场景测试归档路径；`validate.js` 扩展 V8 prompts 覆盖并新增 V13 模板语义探针；同步仓内与父级 `.github/.claude` 部署体 | [查看](./changelogs/releases/v1.9.10.md) |
| [v1.9.9](./changelogs/releases/v1.9.9.md) | 2026-05-21 | 🔧 **单源分发回归修复 + 发布门禁补强**：修复 v1.9.8 `instructions.md` 未进入 npm tarball 导致 `init/update` 主链缺失的问题；V6 与 `test-pack-clean` 新增 required package assets 正向断言；同步 README/RULES/profile 的 agents 分发语义和单源路径；单源正文改为平台中性索引说明；更新 audit-common V8 职责描述，避免 8 文件/33% 旧口径误导审查 | [查看](./changelogs/releases/v1.9.9.md) |
| [v1.9.8](./changelogs/releases/v1.9.8.md) | 2026-05-21 | 🎯 **单源规范 + agents 恢复 + 多项目工作区阻断**（含 PATCH Breaking Change，由用户 D1 决策接受 Semver 违规）：① Q1 `agents/` 恢复 Copilot 默认分发（`index.js` SOURCES 重新包含 `agents`，Claude Code 端保持 Skill 路由）；② Q2 单源规范——删除 `copilot-instructions.md`，新增 `instructions.md` 作为唯一规范源；`cmdInit`/`cmdInitClaude` 均以 `instructions.md` 为源、按平台 rename 到 `.github/copilot-instructions.md` 或 `CLAUDE.md`（**Breaking**：删除文件 + 双平台单源）；③ Q3 项目未识别硬阻断——`01-common` + `load-profile` + `17-compliance` PC0 + `18-spec-radar` Axis A/G11 同步「必须先询问用户、禁止猜测、禁止超范围扫描」；`lifecycle.cjs` UserPromptSubmit 新增多项目工作区检测（≥2 含 `package.json`/`.devcodex/profile` 的同级子目录 + 无 workspace 根 profile → 阻断），豁免词 `workspace/monorepo/全工作区/all projects/所有项目`；④ `scripts/validate.js` 新增 V12（源仓库不得含 `copilot-instructions.md`） | [查看](./changelogs/releases/v1.9.8.md) |
| [v1.9.7](./changelogs/releases/v1.9.7.md) | 2026-05-21 | 🎯 **JetBrains 等价兼容 + monorepo 父链强化**：闭环 v1.9.6 延后项 P-001/P-004/P-008；`index.js` 新增 `devcodex doctor` CLI（env 推断 platform/agent，输出 install artifacts + hook-enforced vs instruction-fallback 推荐 mode + JetBrains 5 步验证清单）；`CLAUDE_HOOK_COMMAND` 父链查找新增项目根标记同层共存要求（`.devcodex/` ‖ `package.json`）防止 monorepo 跨层误命中外层 DevCodex Hook | [查看](./changelogs/releases/v1.9.7.md) |
| [v1.9.6](./changelogs/releases/v1.9.6.md) | 2026-05-21 | 🎯 **跨客户端兼容性闭环（批次 A 7 项 + P-009 即发即修）**：S07 扩展 compaction 触发（/compact、/resume、summary 恢复后须重输 PC0~PC4）；CLAUDE.md + instructions/00-safety + 10-dev 同步 + 新增"无 Hooks 宿主软门禁"条款；`lifecycle.cjs` detectPlatform env 优先（CLAUDE_CODE_VERSION/IDEA_*/TERM_PROGRAM）+ buildBootstrapMessage 加强；`index.js` detectAgent 输出枚举扩展 vscode-copilot/jetbrains-copilot；README 客户端矩阵 + IDE 兼容性表对齐（JetBrains 降级 ⚠️ 实测中）；新增 `scripts/instruction-fallback-check.js` git pre-commit 软门禁；P-004/P-008 延后 v1.9.7 实测后处理 | [查看](./changelogs/releases/v1.9.6.md) |
| [v1.9.5](./changelogs/releases/v1.9.5.md) | 2026-05-21 | 🎯 **规范层 + 工程层闭环**：FC7 用户决策必带推荐+理由（PI-005 规范化）；audit-session schema 扩展 `regressionProbes/r{N}Probes/remoteReleased/category/fixPlan/fixCommit/linkedRelease`；audit-common 新增 PCV-6 回归复扫 + PCV-7 收敛门禁 + PI-006 (V8 ≠ CRS) 提示；`validate.js` 扩展 V8 checkPairs 至 21 文件（覆盖 33% → 95%）+ 新增 V9 日期格式 / V10 回归探针 / V11 FC7 决策格式校验 + V6/V7 stderr 保留 N 行；F-012 dedupe npm pack；新增 `scripts/validate-profile.js`；`lifecycle.cjs` F-001 收紧 `DEVCODEX_PATH_RE` + F-006 Bash 命令路径提取；`index.js` F-002 .claude/agents/ legacy 警告；F-003 `gap-registry.md` 补 `## Gap #GAP-017` 标头；F-008 hooks 运行时测试新增 path-aware 边缘场景 | [查看](./changelogs/releases/v1.9.5.md) |
| [v1.9.4](./changelogs/releases/v1.9.4.md) | 2026-05-21 | 🎉 **防漂移机制 + CP gate 跨需求旁路 + V8 部署同步 + Profile 同步**：新增 PC5/PC6/PC7 三项预检查 + G10 limit 截断恢复检测；`15-memory` 新会话首步强制 + SUMMARY 状态延迟 + 任务清单字段；`lifecycle.cjs` CP gate 路径感知 + `findIncompleteRequirement` 跨需求旁路（`hasAnyCp3Done`）；`validate.js` V6 Claude 分支 + 新增 V8 部署同步检查；6 prompts/report-* 模板补五项验证；02-output-paths 链接格式分钟级；Profile 01/02 同步 v1.9.4 候选 + Skill 35；audit-common §CRS 父链部署体扫描（GAP-019）；F-007 CLAUDE.md PC5-7 即发即修；R3 修 F-009（plugin.json `_note_skills`）+ F-011（CHANGELOG L3 通用化）| [查看](./changelogs/releases/v1.9.4.md) |
| [v1.9.3](./changelogs/releases/v1.9.3.md) | 2026-05-20 | 🔧 **CP gate archive 旁路 + 报告头部回填**：`lifecycle.cjs` 支持 `.archived` 跳过历史需求，消除全局阻断风险；报告 03 头部补齐强制字段；L 级建议补三列验证；v1.9.2 git tag 补打；hooks runtime 测试新增 archive 用例 | [查看](./changelogs/releases/v1.9.3.md) |
| [v1.9.2](./changelogs/releases/v1.9.2.md) | 2026-05-20 | 🔧 **跨客户端审计闭环 + 双平台 Bootstrap 硬门禁**：`lifecycle.cjs` 对 Copilot/Claude Code 双平台同启 Bootstrap 拦截；agent 字段枚举固定化（禁裸 `claude`，强制 `claude-code`）；audit 维度扩展 D23~D25（Claude 适配/客户端矩阵/agent 字段）；README 新增 Client Support Matrix；新增 `skills/audit-session`（跨会话审计状态机）+ `skills/profile-bootstrap`（Profile 自动生成）+ `devcodex profile init` CLI；CLAUDE.md SC/RC/T 完整索引；devcodex-v2 标记 LEGACY | [查看](./changelogs/releases/v1.9.2.md) |
| [v1.9.1](./changelogs/releases/v1.9.1.md) | 2026-05-10 | 🔧 **模板链收口 + Dev 模式硬门禁加固**：收口默认 requirement/design/plan/progress 模板边界、同步 CP3/进度规则到 Instructions 与 Skills，强化 Hooks 运行时 bootstrap/closure 行为并补齐回归校验，同时移除仓库内明文 GitHub Packages token | [查看](./changelogs/releases/v1.9.1.md) |
| [v1.9.0](./changelogs/releases/v1.9.0.md) | 2026-05-09 | 🎉 **Workspace Hooks MVP + VS Code 实机验证闭环**：新增 `hooks/` 正式分发面、补齐 Hook-First / Instruction-Fallback 文档语义、修复 `hook_event_name` 兼容与命令误拦截，并完成包校验、站点同步和真实 VS Code Hook 触发验证 | [查看](./changelogs/releases/v1.9.0.md) |
| [v1.7.0](./changelogs/releases/v1.7.0.md) | 2026-04-17 | 🎉 **规范增强 F-01~F-26**：需求验收标准五列+负向场景强制（F-01/F-02）、时序图触发规则（F-03）、N6偏离分级（F-04）、实施计划关联需求列+验收清单扩展（F-05/F-06/F-15）、变更管理章节（F-07/F-08/F-10/F-11）、Migration执行后验证（F-13）、接口流程串联验证（F-14）、delivery/behavior-checklist新Prompt（F-12/F-16/F-17）、读取前置/回归扫描/错误处理/调试清理/长会话重锚定（F-18~F-21/F-24）、.env.example同步（F-22）、PR-2扩展三行（F-23/F-25/F-26）、RQ-3负向覆盖（F-01 audit层）| [查看](./changelogs/releases/v1.7.0.md) |
| [v1.6.0](./changelogs/releases/v1.6.0.md) | 2026-04-17 | 🎉 **v1.6.0 全维度优化**：npm 分发清洁化（维护者状态文件不再分发，data/templates/ 骨架）、index.js 可测试化（require.main guard + module.exports）、PC4 输出格式单一来源（17 仅引用）、自动化校验脚本（validate.js V1-V6 + test-pack-clean + validate-versions）、CI 工作流、边界声明/Tier 声明/双入口说明补全 | [查看](./changelogs/releases/v1.6.0.md) |
| v1.5.4 | 2026-04-16 | 🔧 **data/ 格式检查 + changelog 补全**：changelogs/releases/v1.5.0.md 补 v1.5.2 + v1.5.3 Patch 节；process-improvements.md 修复重复 PI-002（重编号为 PI-004）；violations.md 归档策略改为手动可选；audit-common/SKILL.md 新增 DF 轻量检查（DF-1 编号唯一/DF-2 状态字段/DF-3 路径引用）| — |
| v1.5.3 | 2026-04-17 | 🔧 **深度审查修复**：RULES.md 版本号修正（v1.5.0→v1.5.2）；compliance/SKILL.md 补 SC14；DevCodex plugin scope 五处统一（新增 `agents/`）；CHANGELOG v1.5.1 补条目/v1.5.2 链接修正；routing/SKILL.md 描述修正；README.md + website/docs 数字更新（12 Instructions/33 Skills/22 Prompts） | — |
| v1.5.2 | 2026-04-17 | 🔧 **规范自进化修复边界重构**："记录在使用，修复在维护"原则；audit 元循环触发条件改为 DevCodex plugin 文件路径判断（不再以"规范文件类型"为依据）；PC4 明确仅记录不修复；PF-009 关闭 | — |
| v1.5.1 | 2026-04-16 | 🔧 **代码优先探索原则**：新增"实现情况分析"规范（必须实际读取代码，禁止用计划路径推断）；跨服务需求产物存储规范明确（入口服务 .devcodex/）；广交会需求文档迁移 | — |
| [v1.5.0](./changelogs/releases/v1.5.0.md) | 2026-04-15 | 🎉 **跨服务需求规范 + 业务流程模板**：需求模板新增 §3 业务流程（Mermaid 流程图 + 节点详解）；入口服务驱动模式（services/ 子目录）；10-dev 跨服务 CP1 规则；load-profile 多服务加载策略；audit-requirements RQ-1 业务流程条件检查 | [查看](./changelogs/releases/v1.5.0.md) |
| [v1.4.0](./changelogs/releases/v1.4.0.md) | 2026-04-14 | 🎉 **技术方案流程重构**：plan-review 两阶段（PR-1 CP2前自检）、新增 PR-7 测试策略、dev-default 六阶段（+N6方案一致性）、技术方案模板增§0现状分析+编写指南、§8→实施约束、备选强制；记忆改进 M-01~M-06；CLI 版本显示；规范一致性批量修复 | [查看](./changelogs/releases/v1.4.0.md) |
| [v1.3.5](./changelogs/releases/v1.3.5.md) | 2026-04-14 | 🔧 **规范深度审查修复**：Prompt frontmatter 统一（mode→agent）、D5三元组补全（optimization/scenario-test报告模板）、D21代码块语言标记、D13/D14扩展点/租户文档、SC3措辞修正、PF-004/005用户决策关闭 | [查看](./changelogs/releases/v1.3.5.md) |
| [v1.3.4](./changelogs/releases/v1.3.4.md) | 2026-04-14 | 🎉 **即发即修元循环**：审查发现问题→立即自我审视→self-fix修复→重启新轮，收敛统一为连续3轮零发现（去掉定向/全面差异）| [查看](./changelogs/releases/v1.3.4.md) |
| [v1.3.3](./changelogs/releases/v1.3.3.md) | 2026-04-13 | 🎉 **自我审视机制（Meta-Audit）**：R2+发现新问题时触发四轴盲点分析（M1范围/M2缺席/M3层次/M4分离），结果写 gap-registry，下轮定向补查；三层同步（audit-common+12-audit+audit-execution-guide）| [查看](./changelogs/releases/v1.3.3.md) |
| [v1.3.2](./changelogs/releases/v1.3.2.md) | 2026-04-13 | 🔧 **V4 缺席检查 + audit 补全**：self-fix V4 新增反向三层覆盖检查；self-fix 报告模板 applyTo 补全；删除 skills/report 多余源码选项；audit-common R1 行补充 CRS 时序 | [查看](./changelogs/releases/v1.3.2.md) |
| [v1.3.1](./changelogs/releases/v1.3.1.md) | 2026-04-13 | 🔧 **规范一致性修复**：PCV状态字段/self-fix报告路径/CRS时序/术语统一 — 7项跨文件一致性缺口修复 | [查看](./changelogs/releases/v1.3.1.md) |
| [v1.3.0](./changelogs/releases/v1.3.0.md) | 2026-04-13 | 🎉 **PCV 收敛后汇总验证**：audit/analyze 新增强制 PCV 五步（实证核查+三列验证+分级标注），三列验证时机由每轮分散改为 PCV-3 统一完成 | [查看](./changelogs/releases/v1.3.0.md) |
| [v1.2.0](./changelogs/releases/v1.2.0.md) | 2026-04-13 | 🎉 **PC4 规范雷达 + 全工作流多轮收敛**：新增 `18-spec-radar.instructions.md`（三轴诊断 G1~G9），analyze 改为多轮收敛（≥3轮），audit 定向审查最少轮次 2→3 | [查看](./changelogs/releases/v1.2.0.md) |
| [v1.1.0](./changelogs/releases/v1.1.0.md) | 2026-04-10 | 🎉 **Instructions-First 架构迁移**：新增 `copilot-instructions.md` always-on 入口，Agent 精简，CLI 分发更新，并停止向目标项目默认分发 `.github/agents/` | [查看](./changelogs/releases/v1.1.0.md) |
| [v1.0.0](./changelogs/releases/v1.0.0.md) | 2026-04-04 | 🎉 **v1.0.0 重构**：全新项目结构，规范文件统一中文，需求管理迁移至 website/docs/versions/v1/1.0.0/requirements/ | [查看](./changelogs/releases/v1.0.0.md) |
| v0.0.3 | 2026-04-04 | 🔧 dev/prod 模式、合规体系重构、记忆四列格式、项目 profile 体系 | — |
| v0.0.2 | 2026-04-04 | 🎉 初始结构：8 种工作流、核心 Skills、11 个 Instructions | — |

---

## 维护说明

### 添加新版本的步骤

1. **创建详细变更文档**
   ```bash
   cp changelogs/TEMPLATE.md changelogs/releases/vX.Y.Z.md
   # 填充详细变更信息
   ```

2. **更新 CHANGELOG.md**（本文件）
   - 在"版本概览"表格最上方添加新行
   - 格式：`| [vX.Y.Z](./changelogs/releases/vX.Y.Z.md) | 日期 | 摘要 | [查看](./changelogs/releases/vX.Y.Z.md) |`

3. **同步版本号到所有文件**
   - `plugin.json` → version 字段
   - `RULES.md` → 标题行和 frontmatter 版本号

4. **重建 lockfile**
   ```bash
   rm package-lock.json && npm install
   ```

5. **提交变更**
   ```bash
   git add CHANGELOG.md changelogs/releases/vX.Y.Z.md plugin.json package.json RULES.md package-lock.json
   git commit -m "release: vX.Y.Z — 摘要"
   ```

### 版本号规则

- **MAJOR** (x.0.0) — 工作流或架构破坏性变更
- **MINOR** (1.x.0) — 新增工作流、新增 Skill、新增指令集
- **PATCH** (1.0.x) — Bug 修复、文字修正、工具改进

---

## 相关文档

- [`changelogs/releases/v1.11.15.md`](./changelogs/releases/v1.11.15.md) — 最新版本详细变更文档
- [`changelogs/releases/v1.11.14.md`](./changelogs/releases/v1.11.14.md) — 上一版本详细变更文档
- [`changelogs/releases/v1.11.13.md`](./changelogs/releases/v1.11.13.md) — 历史版本详细变更文档
- [`changelogs/releases/v1.11.12.md`](./changelogs/releases/v1.11.12.md) — 历史版本详细变更文档
- [`changelogs/releases/v1.11.11.md`](./changelogs/releases/v1.11.11.md) — 历史版本详细变更文档
- [`changelogs/releases/v1.11.10.md`](./changelogs/releases/v1.11.10.md) — 历史版本详细变更文档
- [`changelogs/releases/v1.11.9.md`](./changelogs/releases/v1.11.9.md) — 历史版本详细变更文档
- [`changelogs/releases/v1.11.8.md`](./changelogs/releases/v1.11.8.md) — 历史版本详细变更文档
- [`changelogs/releases/v1.11.6.md`](./changelogs/releases/v1.11.6.md) — 上一个版本详细变更文档
- [`changelogs/releases/v1.11.5.md`](./changelogs/releases/v1.11.5.md) — 历史版本详细变更文档
- [`changelogs/releases/v1.11.4.md`](./changelogs/releases/v1.11.4.md) — 历史版本详细变更文档
- [`changelogs/releases/v1.11.1.md`](./changelogs/releases/v1.11.1.md) — 上一个版本详细变更文档
- [`changelogs/releases/v1.11.0.md`](./changelogs/releases/v1.11.0.md) — 历史版本详细变更文档
- [`changelogs/releases/v1.10.0.md`](./changelogs/releases/v1.10.0.md) — 历史版本详细变更文档
- [`changelogs/releases/v1.9.11.md`](./changelogs/releases/v1.9.11.md) — 历史版本详细变更文档
- [`changelogs/releases/v1.9.10.md`](./changelogs/releases/v1.9.10.md) — 历史版本详细变更文档
- [`changelogs/releases/v1.9.9.md`](./changelogs/releases/v1.9.9.md) — 历史版本详细变更文档
- [`changelogs/releases/v1.9.8.md`](./changelogs/releases/v1.9.8.md) — 历史版本详细变更文档
- [`changelogs/releases/v1.1.0.md`](./changelogs/releases/v1.1.0.md) — 历史版本详细变更文档
- [README.md](./README.md) — 项目说明
- [requirements/index.md](./website/docs/versions/v1/1.0.0/requirements/index.md) — 需求文档总览
