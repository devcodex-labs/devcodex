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

## Gap #GAP-006
- 发现日期：2026-04-14
- 审查目标：`prompts/precheck-status.prompt.md` PC4 规范雷达模板
- 盲区描述：修复"PC4完全缺失"时，只验证了PC4"存在"，未验证其内容与 17-compliance 完整一致；VL标记和疑似PF两个变体被漏写，属于"存在但不完整"的缺席形式
- 盲点类型：M2 缺席盲点
- 建议维度：N/A
- 状态：已登记（2026-04-14 修复：PC4 模板补全 VL标记和疑似PF变体）

## Gap #GAP-004
- 发现日期：2026-04-14
- 审查目标：`skills/audit-common/SKILL.md` §审查元循环
- 盲区描述：同一文件内流程图注释（"收敛计数不重置，继续累加"）与关键规则表（"修复后归零"）语义相反，但两段文字在 grep 层面各自"存在"，无法通过关键词扫描发现矛盾；需要逐词交叉比对才能发现
- 盲点类型：M2 缺席盲点（矛盾本身不可被 grep 检测）
- 建议维度：N/A
- 状态：已登记（2026-04-14 修复：流程图注释改为"收敛计数归零"）

## Gap #GAP-005
- 发现日期：2026-04-14
- 审查目标：`skills/audit-execution-guide/SKILL.md` §分批执行模板
- 盲区描述：§分批执行模板 与 §维度优先级分批 在同一文件中分离存在，历史审查未交叉比对两节内容；D22 在模板中完全缺失（M2），D16/D17/D21 优先级错置（M4，从🔴降为🟡/💡）
- 盲点类型：M2 缺席盲点 · M4 分离盲点
- 建议维度：N/A
- 状态：已登记（2026-04-14 修复：分批模板新增批次3专集D16/D17/D21/D22）

## Gap #GAP-009
- 发现日期：2026-04-14
- 审查目标：`prompts/report-audit.prompt.md` §5 收敛声明 · `instructions/13-analyze.instructions.md` §比较说明
- 盲区描述：v1.3.4 将 audit 收敛规则统一为"连续3轮（不区分定向/全面）"，但 report-audit §5 和 13-analyze §analyze vs audit 比较表仍使用旧规则"定向2轮/全面3轮"。根因：M4 分离盲点——规则变更集中在12-audit+audit-common，未扫描 report 模板和 analyze compare 表。
- 盲点类型：M4 分离盲点
- 建议维度：N/A
- 状态：已登记（2026-04-14 修复：两文件同步为统一3轮规则）

## Gap #GAP-008
- 发现日期：2026-04-14
- 审查目标：`instructions/17-compliance.instructions.md` §预检查（PC4 格式，两处）
- 盲区描述：R5 修复 precheck-status.prompt.md 中的 PC4 G4/G7 行时，未执行全库 grep 确认同类格式零残留；17-compliance 中存在同一格式的两个副本（lines 37, 54），均未同步修复。根因：违反 fix 三步必做的"grep 零残留复核"原则（即使在 audit/self-fix 场景下仍应执行跨文件一致性扫描）。
- 盲点类型：M2 缺席盲点（GAP-006 同类型第三次出现）
- 建议维度：N/A
- 状态：已登记（2026-04-14 修复：17-compliance 两处 PC4 格式补全 · 延迟追加）

## Gap #GAP-007
- 发现日期：2026-04-14
- 审查目标：`instructions/12-audit.instructions.md` §专属维度规则 §核心约束
- 盲区描述：①D22 同时出现在 Group B（内容质量）和 Group H（语义正确性），违反 D16 唯一性；`audit-dimensions` 无 Group H，造成 G3 跨文件不一致。②§核心约束"由用户启动 self-fix"与 §审查元循环 元循环自动触发语义矛盾（G2）。根因：M3 层次盲点——R1~R5 对 Skill 层检查细致，Instruction 层 §专属维度规则 未做逐行分组重复校验。
- 盲点类型：M3 层次盲点
- 建议维度：N/A
- 状态：已登记（2026-04-14 修复：12-audit Group B 移除 D22 / audit-dimensions 新增 Group H / §核心约束更新）

## Gap #GAP-003
- 发现日期：2026-04-13
- 审查目标：`skills/audit-execution-guide/SKILL.md` §事件驱动定向审查
- 盲区描述：自我审视触发（R2+ 发现新问题）是明确执行事件，事件驱动表中缺少对应行；audit-execution-guide 不在 CRS 初始 `自我审视` 关键词命中文件中
- 盲点类型：M1 范围盲点 · M2 缺席盲点
- 建议维度：N/A
- 状态：已登记（2026-04-13 修复）

## Gap #GAP-010
- 发现日期：2026-04-14
- 审查目标：`data/gap-registry.md` 格式
- 盲区描述：R3~R12 每轮审查聚焦 `instructions/` 和 `skills/` 层，`data/gap-registry.md` 属于数据文件未纳入正式审查范围；三条记录（GAP-003/GAP-007/GAP-008）在追加时遗漏了 `## Gap #GAP-NNN` 标头，违反 §格式规范 要求。
- 盲点类型：M2 缺席盲点（数据文件未纳入 CRS 关键词扫描范围）
- 建议维度：N/A — 建议 CRS 关键词扫描范围扩展至 `data/` 目录的格式性文件
- 状态：已登记（2026-04-14 修复：补全三条缺失标头）
