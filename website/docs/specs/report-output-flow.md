# ⑩ 输出报告流程图

> 本页聚焦主流程中的 `⑩ 输出报告` 阶段。  
> 该阶段在执行阶段合规检查通过后执行，负责生成并写入工作流执行报告。

---

## 报告输出主链

```mermaid
flowchart TD
    IN["接收合规检查结果"]
    CHAT{"工作流类型\n= chat?"}
    SKIP["豁免报告\n直接进入 ⑪"]
    TYPE["确定报告类型\n（dev/fix/audit/analyze/self-fix）"]
    TPL["选择报告模板"]
    PATH["确定报告路径"]
    PATH_LEVEL{"任务关联到\n需求/Bug/优化目录?"}
    REQ_PATH["需求级路径\n<任务目录>/reports/<agent>/YYYYMMDD/"]
    PROJ_PATH["项目级路径（兜底）\nreports/<子目录>/<agent>/YYYYMMDD/"]
    SCAN["扫描同目录取 max NN +1"]
    WRITE["写入报告文件\nNN--<简述>.md"]
    HEADER["填写头部必填项\n（项目/类型/子类型/日期/Agent/状态）"]
    BODY["填写报告正文\n每条附五项验证\n多路径含推荐结论"]
    V_CHECK["报告二次验证\nV1~V6"]
    V_OK{"二次验证通过?"}
    V_FIX["修正不通过项"]
    OUTPUT["回复末尾输出产物路径\n（相对路径 Markdown 链接）"]
    OUT["进入 ⑪ 更新记忆"]

    IN --> CHAT
    CHAT -->|"是"| SKIP --> OUT
    CHAT -->|"否"| TYPE --> TPL --> PATH --> PATH_LEVEL
    PATH_LEVEL -->|"是"| REQ_PATH --> SCAN
    PATH_LEVEL -->|"否"| PROJ_PATH --> SCAN
    SCAN --> WRITE --> HEADER --> BODY --> V_CHECK --> V_OK
    V_OK -->|"否"| V_FIX --> V_CHECK
    V_OK -->|"是"| OUTPUT --> OUT
```

---

## 报告路径映射

| 工作流 | 项目级子目录 |
|--------|:-----------:|
| dev | `requirements/` |
| dev (optimization) | `optimizations/` |
| dev (scenario-test) | `scenario-tests/` |
| fix | `bugs/` |
| analyze | `analysis/` |
| audit | `audit/` |
| self-fix | `self-fix/` |

## 报告二次验证（V1~V6）

| # | 检查项 |
|:-:|--------|
| V1 | 每条问题有文件来源 |
| V2 | 验证列+标注完整 |
| V3 | ✅已验证 的问题确实读取了对应文件 |
| V4 | 纯推测性问题已标注 ⚠️待验证 |
| V5 | 每条 🔴 级问题通过反向质疑三问 |
| V6 | 🔴 级占比超 1/3 时触发分级自检 |

---

## 阶段输出要求

1. 报告必须写入文件（禁止仅在对话中输出）
2. 每条建议/问题必须附五项验证（合理性+可实施性+收益+验证状态+影响范围）
3. 多建议、多路径或方案对比时必须有推荐结论 / 推荐方案与推荐理由；无后续动作时写“推荐：无后续动作”
4. 文件名使用 `NN--` 双横杠格式
5. dev/fix 报告必须包含 ECR 执行闭环复审结果
6. 报告内部登记关联记忆的 canonical identity；session、daily、SUMMARY 与 raw ledger 默认 internal-only，不要求在用户回复列出
7. 回复由 `DevCodexVisibleEnvelopeV1` 输出“需要你确认的文件 / 本批交付文件 / 完成交付文件 / 阻断证据”之一；每项使用语义名称、用途、**路径**（默认工作区相对 portable，见 ArtifactPathColumnGate / PF-175）与用户动作；自由文本表默认列=语义名称|用途|路径|操作；链接形式由当前 surface 的 capability evidence 决定；Rich 语义链接可与路径列并存，无 fallback 时不在路径列外重复 `绝对路径：` 行
8. 命中增量项目分析时，报告追加 ProjectKnowledge V2 的 binding/Merkle、changed/affected/lens-gap/reused、5% oracle、SemanticClaim authority+range、V1 只读迁移与 accepted-only pointer 证据；结构化 bootstrap 不得写成“人工逐文件深读完成”

---

## 与主流程关系

- 主流程入口见：[主流程图](/specs/flowcharts)
- 上游阶段见：[⑨ 执行阶段合规检查流程图](/specs/exec-compliance-flow)
- 下游阶段见：[⑪ 更新记忆流程图](/specs/memory-update-flow)
- 报告规范见：`skills/report/SKILL.md`

> 约束：报告输出为主链必经阶段（chat 豁免），不可跳过。
