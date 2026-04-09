# v1.0.0 实施总览 — 按主流程节点顺序

> **状态**：📝 待确认  
> **原则**：按主流程图 ①~⑫ 节点顺序依次实施，每个 Stage 完成后该阶段可独立工作。  
> **文件规范**：英文编写，本文件为中文对照草案。

---

## Stage 总览

| Stage | 主流程节点 | 待产出文件数 | 状态 |
|:-----:|-----------|:----------:|:----:|
| 0 | 冻结 P0 | 1 修改 | ✅ |
| 1 | ① 预检查 | 5 新建 + 2 Agent | ✅ |
| 2 | ② 安全检查 | 内联 + 2 data 模板 | ✅ |
| 3 | ③ 写入摘要 + ④ 检索记忆 | 2 Skill + 1 Instruction | ✅ |
| 4 | ⑤ 前置状态汇总 + ⑥ 开发合规 + ⑦ 路由 | 内联 + 1 Skill | ✅ |
| 5 | ⑧ 工作流执行 | 5 Instructions + 4 Skills | ✅ |
| 6 | ⑨⑩⑪⑫ 合规 + 报告 + 收尾 | 2 Skills + 2 Instructions | ✅ |
| 7 | 子类型 Skills + Prompts | 23 Skills + 20 Prompts | ✅ |

---

## 各 Stage 中文规范详见

| Stage | 中文规范文件 |
|:-----:|------------|
| 0 | [Stage 0 — 冻结 P0](./stages/stage-0) |
| 1 | [Stage 1 — ① 预检查](./stages/stage-1) |
| 2 | [Stage 2 — ② 安全检查](./stages/stage-2) |
| 3 | [Stage 3 — ③④ 摘要与记忆](./stages/stage-3) |
| 4 | [Stage 4 — ⑤⑥⑦ 汇总、合规与路由](./stages/stage-4) |
| 5 | [Stage 5 — ⑧ 工作流执行](./stages/stage-5) |
| 6 | [Stage 6 — ⑨⑩⑪⑫ 收尾](./stages/stage-6) |
| 7 | [Stage 7 — 子类型 Skills + Prompts](./stages/stage-7) |

---

## 关联文档

| 文档 | 路径 |
|------|------|
| 主流程图（永久规范）| `/specs/flowcharts` |
| 预检查流程图 | `/specs/precheck-flow` |
| 安全检查流程图 | `/specs/safety-check-flow` |
| 写入摘要流程图 | `/specs/summary-flow` |
| 检索记忆流程图 | `/specs/memory-retrieval-flow` |
| 前置状态汇总流程图 | `/specs/pre-state-summary-flow` |
| 开发阶段合规检查流程图 | `/specs/dev-compliance-flow` |
| 合规检查框架 | `/specs/compliance-framework` |
| 需求总览 | `/versions/v1/1.0.0/requirements/` |
| 发布前检查清单 | `/versions/v1/1.0.0/release/checklist` |
