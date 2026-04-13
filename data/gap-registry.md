# 维度盲区登记表

> **文件路径**: `data/gap-registry.md`  
> **写入时机**: [`12-audit.instructions.md`](../instructions/12-audit.instructions.md) audit 审查中遇到无对应维度的问题时标注 `[维度盲区]` 并追加  
> **关联 Skill**: [`audit-common`](../skills/audit-common/SKILL.md) · [`audit-dimensions`](../skills/audit-dimensions/SKILL.md)  
> **无盲区时**: 跳过，不创建空文件

## 格式规范

每条盲区使用以下格式追加：

```markdown
## Gap #GAP-NNN
- 发现日期：YYYY-MM-DD
- 审查目标：<文件/模块名>
- 盲区描述：<描述>
- 盲点类型：M1 范围盲点 / M2 缺席盲点 / M3 层次盲点 / M4 分离盲点（可多选）
- 建议维度：<建议新增的维度名>（维度盲区时填写；自我审视盲点填"N/A"）
- 状态：已登记 / 已纳入维度
```

---

## 盲区记录

<!-- 以下由 audit 工作流自动追加 -->

## Gap #GAP-001
- 发现日期：2026-04-10
- 审查目标：`instructions/01-common.instructions.md` §ENV_MODE 行为总表
- 盲区描述：ENV_MODE dev/prod 行为分配搞反（prod 全量合规 / dev 轻量），11+ 文件忠实复制错误定义，审查维度中缺少"模式名称的行为分配是否符合常规产品含义"检查
- 盲点类型：N/A（维度盲区，非自我审视触发）
- 建议维度：D22 产品语义正确性（模式/角色/开关的行为分配 vs 名称语义）
- 状态：已纳入维度

## Gap #GAP-002
- 发现日期：2026-04-13
- 审查目标：`instructions/12-audit.instructions.md` §多轮收敛规则 R2~Rn 行
- 盲区描述：自我审视机制写入 `audit-common` 后，`12-audit`（Instruction 层）R2 行未同步触发条件，导致 AI 读 Instruction 层时无法感知自我审视要求
- 盲点类型：M3 层次盲点
- 建议维度：N/A
- 状态：已登记（2026-04-13 修复）

## Gap #GAP-003
- 发现日期：2026-04-13
- 审查目标：`skills/audit-execution-guide/SKILL.md` §事件驱动定向审查
- 盲区描述：自我审视触发（R2+ 发现新问题）是明确执行事件，事件驱动表中缺少对应行；audit-execution-guide 不在 CRS 初始 `自我审视` 关键词命中文件中
- 盲点类型：M1 范围盲点 · M2 缺席盲点
- 建议维度：N/A
- 状态：已登记（2026-04-13 修复）
