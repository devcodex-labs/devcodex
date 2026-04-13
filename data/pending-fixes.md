# Pending Fixes

> **文件路径**: `data/pending-fixes.md`  
> **写入时机**: [`14-self-fix.instructions.md`](../instructions/14-self-fix.instructions.md) 中 Pending 级（超出 A1~A5 白名单范围）问题写入  
> **处理时机**: 由用户选择时机，通过 self-fix 工作流批量处理  
> **关联规范**: [`14-self-fix.instructions.md`](../instructions/14-self-fix.instructions.md)

## 格式规范

每条修复项使用以下格式追加（禁止修改已有未关闭条目）：

```markdown
## Pending Fix #PF-NNN
- 文件：<路径>
- 问题：<描述>
- 建议修复：<方案>
- 发现时间：YYYY-MM-DD
- 状态：待处理 / 处理中 / 已关闭
```

### 状态流转

`待处理` → `处理中` → `已关闭`

关闭三条件（全部满足才可标 `已关闭`）：
1. 问题处置完成
2. 防复发措施写入对应规范
3. 后续流程验证生效（或用户明确确认）

---

## 待处理项

<!-- 以下由 self-fix 工作流自动追加，禁止手动修改未关闭条目 -->

## Pending Fix #PF-001
- 文件：`instructions/10-dev.instructions.md` §C12 合理性评估
- 问题：C12 当前只覆盖两种触发场景（"有更好方案"和"用户引用已有设计"），缺少第三种场景：**需求项所依赖的上层能力在项目中尚未实现**。实际案例：dev 工作流 CP1 阶段将"为 devOverlay 增加 skipPaths"列入需求（R5），但 vext 当前是纯 API 框架、无前端渲染能力，overlay 的扩展前提根本不存在。AI 未能在 CP1 前主动识别并标记，需用户提示后才修正。
- 建议修复：在 C12 条目中补充第三条检查——"架构边界检查：逐项确认每条需求是否依赖项目当前已实现的能力；若某项需求的前提能力（上游功能/平台特性）尚未存在，须在 CP1 前主动标注为'预留候选'并建议移出本期范围，等待用户确认后再决定取舍"
- 发现时间：2026-04-12
- 状态：已关闭（2026-04-13，已补写至 `10-dev.instructions.md` §C12）

## Pending Fix #PF-002
- 文件：`instructions/10-dev.instructions.md` §plan-review PR-2 技术可行性
- 问题：PR-2 只检查"无模糊待定步骤"，缺少对已有代码改动的执行路径追踪要求。实际案例：技术方案将日志逻辑设计在 devOverlay 判断之后，但 devOverlay 块有提前 return（error-handler.ts:107），导致设计的日志在 browser 访问场景下永远不被执行。该问题在 plan-review 阶段应被 PR-2 拦截，但因规则表述不足而漏过，直到 audit 才发现。
- 建议修复：在 PR-2 检查项中补充——"对已有代码的改动方案，必须逐行追踪新代码在原始执行路径中的实际插入位置，验证新逻辑不会被已有的提前 return/throw/break 跳过"
- 发现时间：2026-04-13
- 状态：已关闭（2026-04-13，已补写至 `10-dev.instructions.md` §PR-2 + `skills/dev-plan-review/SKILL.md` §PR-2）


## Pending Fix #PF-003
- 文件：instructions/17-compliance.instructions.md §预检查 + instructions/01-common.instructions.md §Profile加载
- 问题：规范定义了"收到消息后立即执行预检查"，但未明确禁止"以 context 摘要代替 Profile 加载和预检查"。跨会话恢复时，AI 从摘要中获取项目信息，产生"Profile 已加载"的错误推断，系统性跳过预检查块和 devcodex update 等强制步骤。
- 建议修复：明确补充跨会话硬约束：摘要≠Profile已加载，第一个tool call必须是Profile读取。
- 发现时间：2026-04-13
- 状态：已关闭（2026-04-13，已补写至 17-compliance §预检查、01-common §Profile加载、18-spec-radar G3 触发场景）

## Pending Fix #PF-004
- 文件：`instructions/` 全部 11 个文件 + `skills/` 全部 32 个 SKILL.md（共 43 个文件）
- 问题：D8 检查项要求规范文件标注引入版本（如 `> 引入于 v1.x`），但当前所有 43 个规范文件均无版本标注，无法追踪具体规范节点的引入时间点。
- 建议修复：在每个文件的 frontmatter 或首段补充版本标注；优先级较高的新增节点（如 12-audit §审查元循环 引入于 v1.2.x、D22 引入于 v1.3.x）优先补充，其余按版本迭代逐步追加。
- 发现时间：2026-04-13
- 状态：已关闭（2026-04-13，D8实际只检查3个项目级文件版本一致性：plugin.json/CHANGELOG.md/RULES.md，并非每文件标注；PF-004基于对D8的误解，无需修复43个文件；用户决策：per-file版本标注增加维护负担，不引入）

## Pending Fix #PF-005
- 文件：`changelogs/v1.0.0.md` §重构内容
- 问题：D19 检查项 1 要求 CHANGELOG 记录已删除的 8 个独立 agent 文件，但 v1.0.0.md 仅说"旧根目录所有源文件（已归档到 v0.03/）"，未枚举具体被废弃的 agent 文件名（如原 v0.x 的 @dev/@fix/@analyze 等）。
- 建议修复：在 changelogs/v1.0.0.md 的 §Breaking Changes 或 §Deprecated 下补充被废弃的旧 agent 文件名列表及迁移路径说明（需从 v0.03/ 归档目录或 git 历史确认具体文件名）。
- 发现时间：2026-04-13
- 状态：已关闭（2026-04-13，用户决策：已发布历史版本 CHANGELOG 不追溯修正，git blame 提供完整变更历史）

## Pending Fix #PF-006
- 文件：`plugin.json` 第 70 行 `_note_skills` 字段；`instructions/01-common.instructions.md` §Skill按需读取表
- 问题：D13 扩展点标注缺失。`_note_skills` 只说明了"按需读取"机制，未说明"新增子类型 Skill 时需要同时更新的文件清单"；`01-common` Skill 按需读取表上方无"⚠️ 扩展点：新增子类型需同时更新"警告，但 L1~L3 联动检查已在 audit-execution-guide Skill 中有说明。
- 建议修复：在 `plugin.json` `_note_skills` 字段末尾补充"新增子类型需更新：01-common Skill按需读取表 + 对应 Instruction 子类型路由表 + routing/SKILL.md"；在 01-common Skill 按需读取表上方添加扩展点注释。属 dev 工作流（文档更新）。
- 发现时间：2026-04-13
- 状态：已关闭（2026-04-13，plugin.json _note_skills 补充5处扩展点清单；01-common Skill按需读取表上方新增 ⚠️ 扩展点警告块）

## Pending Fix #PF-007
- 文件：`instructions/tenants/`（目录不存在）
- 问题：D14 租户覆盖支持。`01-common` §NODE_META 读取规则 第1优先级引用 `instructions/tenants/<tenant-id>/`，但该目录不存在。租户定制是可选功能（"若有"），但 D14 检查项要求"目录存在且有 README 说明"。
- 建议修复：创建 `instructions/tenants/README.md`，说明租户覆盖规则（命名规范、frontmatter 格式、覆盖范围）并提供示例。属 dev 工作流（新增功能文档）。
- 发现时间：2026-04-13
- 状态：已关闭（2026-04-13，创建 instructions/tenants/README.md，含目录结构/命名规范/frontmatter格式/覆盖范围/优先级说明/示例）

## Pending Fix #PF-008
- 文件：`instructions/17-compliance.instructions.md` L103
- 问题：D10 指令明确性。SC3 检查项描述"同类全局"措辞模糊，AI 须查看 `11-fix.instructions.md` 的修复三步定义才能准确执行，可能导致遗漏。完整定义应为"同一错误模式全局扫描"。
- 建议修复：将 SC3 描述从 `修复已全局扫描（同类全局+数据联动+grep零残留）` 改为 `修复已全局扫描（同类错误模式全局+数据联动+grep零残留）`。
- 发现时间：2026-04-13
- 状态：已关闭（2026-04-13，SC3措辞修正为"同类错误模式全局"）
