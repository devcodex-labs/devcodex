---
name: audit-report
description: 报告审查维度 RA-1~RA-6 — 分析报告/审查报告质量专属审查层
---
# Audit Report Skill

## 适用范围

审查目标为**报告文档**（分析报告、审查报告、开发报告、修复报告）时，叠加本 Skill（在 G1~G5 之后）。

## 维度总览（RA-1~RA-6）

| 分组 | 维度 | 优先级 |
|------|------|:------:|
| A — 内容质量 | RA-1 内容完整性 · RA-2 事实准确性 | 🔴 |
| B — 格式与追溯 | RA-3 格式规范性 · RA-4 结论可追溯 | 🟡/🔴 |
| C — 行动与关联 | RA-5 行动项可执行 · RA-6 关联一致性 | 🟡/🔴 |

## 核心检查维度

**RA-1 内容完整性 🔴**
- 报告头部必填字段完整（项目/日期/类型/状态）
- 正文必需章节齐全（参照对应模板）
- 无空白章节或仅含"TBD"/"待填写"
- audit 类报告包含审查轮次摘要（🔴 必填）
- 问题清单包含完整列（级别/维度/位置/描述/已验证/发现轮次/状态）
- 汇总型问题清单默认采用“两层结构”：先列根因级问题，再展开逐文件完整落点；边界/非缺陷结论单列，不混入缺陷编号

**RA-2 事实准确性 🔴**
- 结论有证据支撑（引用文件/终端输出/工具结果）
- 问题描述有具体位置（文件名+行号或章节标题）
- 无无法验证的断言
- 若报告把外部审查报告、AI review finding 或 audit issue 作为输入，需检查 `ReviewFindingIntakeGate`：报告是否仅作为线索、每条 finding 是否有本地证据和分类、是否误把设计/文档/测试缺口写成 must-fix runtime bug

**RA-4 结论可追溯 🔴**
- 每条结论可追溯到具体证据
- 问题状态准确（已修复的标注已验证轮次）
- 若存在“根因级归并”，必须能从根因项反查到逐文件落点，避免在汇总阶段吞掉文件级异常

## ExternalReviewClaimVerificationGate（PF-164 · 外部审阅复核）

当报告是对**外部审阅 / 他 Agent 审阅 / AI review finding 包**的复核或转写时（不仅是普通 audit），必须额外满足主张级颗粒度，禁止“总评正确但比输入更难定位”：

| 必填 | 说明 |
|------|------|
| `inputClaims` | 外部输入主张列表（可编号） |
| `ClaimVerificationMatrix` | 主张 → 项目证据 → verificationStatus → disposition（采纳/部分采纳/拒绝） |
| `projectEvidence` | repo path / 命令 / 运行结果，不得只复述外部原文 |
| `unverifiedBoundaries` | 未验证/UNVERIFIED 边界与推断边界 |
| `detailReportLink` | 用户可打开的详细报告链接（最终回复不得只有口头总评） |

- 机器分类：`scripts/lib/external-review-claim-verification.js`（`claim-ready` / `claim-thin` / `not-external-review`）
- 负向：只写总评/建议、无矩阵、无 UNVERIFIED、无详细报告链接 → `claim-thin`，审查不通过
- 非外部审阅场景：`N/A + skipReason=not-external-review-recap`

## N/A 规则

- 纯信息性报告无行动项：RA-5 标 N/A
- 无关联外部文件：RA-6 标 N/A
- 非外部审阅复核：`ExternalReviewClaimVerificationGate` 标 N/A
