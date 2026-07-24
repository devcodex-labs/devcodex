# DevCodex 合规检查框架

> 本页定义主流程中的合规检查语义，与现行 `instructions.md` / `17-compliance` **对齐**。  
> 历史 v1.0.0 站点文稿曾把 SC/FC/RC 含义写反；**以本页与源码 instructions 为准**。

---

## 四层检查定义（现行）

| 层级 | 缩写 | 执行时机 | 目标 | 说明 |
|------|------|---------|------|------|
| 入口检查 | PC0~PC7 | 每条用户消息、实质内容前 | 上下文与意图是否就绪 | 全模式强制；PC0=`ContextReadPlan`+回执，**不是**「Profile 已加载」单字段 |
| 形式合规 | **FC** | 产物与记忆写入后 | 执行过程是否**形式**完整 | 记忆表格、报告、CP 顺序、`ArtifactDeliveryManifestV1`、`ArtifactAnchorProjectionV1` 与 `UserFacingArtifactSetV1` 等 |
| 实质合规 | **SC** | 形式通过后 | 执行过程是否**实质**达标 | 扫描、同步、SUMMARY、ECR 等；按工作流适用 |
| 恢复性检查 | **RC** | 收尾前 | 下一 Agent 能否恢复 | 记忆可恢复性、handoff、sessions |
| 任务完成 | **T** | 宣告完成前 | 需求与合规是否闭环 | T1~T13；机器语义使用 canonical ID |

> **安全底线 S01~S07** 独立于 FC/SC/RC，全模式强制，不因 prod 关闭合规块而放松。

---

## 与主流程节点映射

| 主流程语义 | 对应框架 |
|-----------|----------|
| 会话入口 / 预检查 | PC0~PC7 |
| 开发后形式核对 | FC1~FC7 |
| 开发后实质核对 | SC1~SC16（适用项） |
| 完成前恢复性 | RC1~RC4 |
| 任务完成验证 | T1~T13 |
| 规范/控制面变更 | **SCV**（Spec Change Verification，S0~S7） |

规范/控制面/路径/模板/部署/校验链发生语义变更时，必须追加 SCV：从变更分类、真相源、关联文件、部署副本、模板示例、验证脚本到残留漂移逐项确认。SCV 不替代 lint/test。

dev / fix / self-fix 在宣告完成时还必须输出 `FinalValidationSummaryV1` 或等价短矩阵：权威验证命令与 exitCode、runId 或关键计数、WorkspaceSyncStatus、dirty boundary、release action boundary；声明 commit 时追加 post-commit replay。报告承载长日志，最终回复不能只写“全绿 / 已通过 / 详见报告”。

当报告、分析、审查、推荐、CP 可确认或完成态声明含 strong claim 时，SC14a 还要求 `EvidenceFreshness`：`ClaimEvidenceIndexV1` 绑定主张，`EvidenceFreshnessReceiptV1` 绑定 source/context/dependsOn/lease，`StaleEvidenceLintDecisionV1` 决定 fresh / rerun / downgrade / unverifiable。SUMMARY、历史报告和外部审查原文只能导航，不能单独支撑“已验证 / 推荐 / 可确认”。

---

## 开发前闸门

「能否进入开发类工作流」由 **Profile / Intent / CP1** 与入口检查共同约束，**不是**旧文稿中的「SC=安全底线」混用。  
细图见：[开发阶段合规检查流程图](/specs/dev-compliance-flow)（若与本页冲突，以本页与源码 instructions 为准）。

---

## 判定口径（一句话版）

1. **PC**：上下文计划与回执是否就绪  
2. **FC**：这件事是否按流程做完整（形式）  
3. **SC**：这件事是否实质达标（诊断/扫描/同步/ECR）  
4. **SCV**：规范变更是否已完成一致性与漂移验证  
5. **RC / T**：是否可恢复、可宣告完成  

---

## ENV_MODE

| 模式 | 行为 |
|------|------|
| `prod`（默认） | 仍强制 PC0~PC7 与安全底线；**不**输出 FC/SC/RC/T 合规状态块 |
| `dev` | PC0~PC7 + 全量 FC/SC/RC/T 状态块（chat 豁免合规块，不豁免入口检查） |

---

## 版本说明

- 现行源码权威：`instructions.md`、`instructions/17-compliance.instructions.md`、`skills/compliance`  
- 本页已按 2026-07-17 Batch α 纠正历史 SC/FC 语义冲突  
