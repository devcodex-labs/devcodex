# ⑨ 执行阶段合规检查流程图

> 本页聚焦主流程中的 `⑨ 执行阶段合规检查` 阶段。  
> 该阶段检查工作流执行过程本身是否合规，位于工作流执行之后、输出报告之前。

---

## 执行阶段合规检查主链

```mermaid
flowchart TD
    IN["接收工作流执行结果"]
    FC["FC 形式合规检查\nFC1~FC7"]
    FC_OK{"FC 全通过?"}
    FC_FIX["立即修正不通过项"]
    SC["SC 实质合规检查\nSC1~SC16"]
    SC_OK{"SC 全通过?"}
    SC_FIX["立即修正不通过项"]
    RETRY{"累计修正 ≥5 次?"}
    STOP["⚠️ 停止循环\n输出失败项摘要"]
    AUDIT{"执行中是否发现\nS02/S03 违规?"}
    AUDIT_LOG["AUDIT_LOG 双写\n（记忆 + violations.md）"]
    OUT["进入 ⑩ 输出报告"]

    IN --> FC --> FC_OK
    FC_OK -->|"否"| FC_FIX --> FC
    FC_OK -->|"是"| SC --> SC_OK
    SC_OK -->|"否"| SC_FIX --> RETRY
    RETRY -->|"否"| SC
    RETRY -->|"是"| STOP
    SC_OK -->|"是"| AUDIT
    AUDIT -->|"发现违规"| AUDIT_LOG --> OUT
    AUDIT -->|"无违规"| OUT
```

---

## FC 形式合规检查项

| # | 检查项 | 说明 |
|:-:|--------|------|
| FC1 | 记忆文件完整 | 必填字段齐全，📨 四列表格格式 |
| FC2 | 报告文件已写入 | chat 豁免 |
| FC3 | CP 按序执行 | dev/fix 强制 |
| FC4 | 文件名/路径合规 | `NN--` 双横杠 |
| FC5 | 内部交付、上下文锚点与用户可见输出完整 | `ArtifactDeliveryManifestV1` 完整对账；如生成 `ArtifactAnchorProjectionV1`，每个 anchor 必须有 `contentDigest / projectionDigest / truthSourceKind / evidenceRefs` 且不替代 canonical；`UserFacingArtifactSetV1` required hidden=0 且计数守恒；可见项有语义名称、用途、动作和能力证据 |
| FC6 | 新增 DevCodex 规范资产 `.md` 行数 | instructions / skills / prompts / templates / 规范源等 ≤ 500 行；业务项目需求、技术方案、报告和正式项目文档不因 C13 强制拆分 |
| FC7 | 决策推荐项 | 用户决策节点和报告决策点必须有推荐项和推荐理由；无后续动作时写“推荐：无后续动作” |

dev / fix / self-fix 的完成态还要通过 `DevModeCompletionCheckDetailGate`：最终回复必须含 `FinalValidationSummaryV1` 或等价短矩阵，覆盖权威命令/exitCode、runId 或关键计数、WorkspaceSyncStatus、dirty boundary、release action boundary；声明 commit 时追加 post-commit replay。

## SC 实质合规检查项（关键）

| # | 检查项 | 适用范围 |
|:-:|--------|---------|
| SC2 | 代码已诊断 | dev/fix 🔴 |
| SC3 | 修复已全局扫描（三步） | fix 🔴 |
| SC4 | 关联文件已同步 | dev/fix/self-fix 🔴 |
| SC6 | Agent SUMMARY 已更新 | 全工作流 🔴 |
| SC5 | 后续建议与推荐结论 | 多建议/多路径报告必须有推荐结论 |
| SC14a | 强主张证据新鲜度 | 报告/分析/审查/推荐/CP/完成态强声明须有 `StaleEvidenceLintDecisionV1`；summary-only 不得单独支撑强结论 |
| SC15 | ECR 执行闭环复审 | dev/fix 🔴，覆盖 CP、报告、记忆、SUMMARY、diff/commit、测试/探针与 dirty 边界 |

---

## 阶段输出要求

1. FC 不通过 → 立即修正后重检
2. SC 🔴 阻塞性项不通过 → 修正后重检
3. 累计修正 ≥5 次仍未全通过 → 停止循环，输出摘要标 ⚠️，写入记忆后交由用户决策
4. 发现 S02/S03 违规 → AUDIT_LOG 双写（被动触发位置）

---

## 与主流程关系

- 主流程入口见：[主流程图](/specs/flowcharts)
- 合规框架入口见：[合规检查框架](/specs/compliance-framework)
- 上游阶段见：[⑧ 工作流执行流程图](/specs/workflow-execution-flow)
- 下游阶段见：[⑩ 输出报告流程图](/specs/report-output-flow)

> 约束：执行阶段合规检查为主链必经阶段（chat 豁免），不可跳过。
