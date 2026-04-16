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
- 状态：已登记（2026-04-14 修复：12-audit Group B 移除 D22 / audit-dimensions 新增 Group H / §核心约束更新；矛盾②于 v1.5.2 修复：§核心约束和§审查元循环统一为"DevCodex plugin 文件路径"判断边界）

## Gap #GAP-003
- 发现日期：2026-04-13
- 审查目标：`skills/audit-execution-guide/SKILL.md` §事件驱动定向审查
- 盲区描述：自我审视触发（R2+ 发现新问题）是明确执行事件，事件驱动表中缺少对应行；audit-execution-guide 不在 CRS 初始 `自我审视` 关键词命中文件中
- 盲点类型：M1 范围盲点 · M2 缺席盲点
- 建议维度：N/A
- 状态：已登记（2026-04-13 修复）

## Gap #GAP-015
- 发现日期：2026-04-14
- 审查目标：`README.md` L45/L46/L150
- 盲区描述：今日修复 F-02（Instructions 计数 11→12）和 F-06（Skills 计数 32→33）时，只更新了 `copilot-instructions.md` 和 `plugin.json`，未同步 `README.md`（三处）和 `website/docs/index.md`（一处）。根因：README.md 属于根目录文档，CRS 扫描关键词"11 个 Instructions"/"32 个 Skills"时，搜索路径局限于 instructions/skills/prompts/data，未覆盖 README.md；website/docs 更在扫描范围之外。
- 盲点类型：M2 缺席盲点（数字类引用散落在文档层，非 grep 能自动覆盖的规范路径）
- 建议维度：N/A — 建议在数字类引用更新时，专门扩展 CRS 扫描至 README.md + website/docs/*.md
- 状态：已登记（2026-04-14 修复：README.md 3处 + website/docs/index.md 1处同步更新）

## Gap #GAP-010
- 发现日期：2026-04-14
- 审查目标：`data/gap-registry.md` 格式
- 盲区描述：R3~R12 每轮审查聚焦 `instructions/` 和 `skills/` 层，`data/gap-registry.md` 属于数据文件未纳入正式审查范围；三条记录（GAP-003/GAP-007/GAP-008）在追加时遗漏了 `## Gap #GAP-NNN` 标头，违反 §格式规范 要求。
- 盲点类型：M2 缺席盲点（数据文件未纳入 CRS 关键词扫描范围）
- 建议维度：N/A — 建议 CRS 关键词扫描范围扩展至 `data/` 目录的格式性文件
- 状态：已登记（2026-04-14 修复：补全三条缺失标头）

## Gap #GAP-011
- 发现日期：2026-04-13
- 审查目标：`RULES.md` 路由说明表 / `skills/routing/SKILL.md` / `skills/intent/SKILL.md`
- 盲区描述：历次审查聚焦 instructions/skills 层，未覆盖根目录文档（RULES.md），导致 RULES.md 长期未纳入 G3 跨文件一致性检查。同时本轮审查暴露 M3 层次盲点：修复前未读取磁盘上 13-analyze.instructions.md 实际内容，错误信任了会话注入上下文中的旧版描述（单轮），差点将正确的"多轮分析"描述错改为"单次分析"，随即自我纠错恢复。
- 盲点类型：M4 分离盲点（根目录文档在 CRS 扫描范围之外）· M3 层次盲点（修复前未实证读取磁盘文件）
- 建议维度：N/A — 建议 CRS 扫描范围扩展至根目录 *.md 文件（RULES.md / README.md / CHANGELOG.md）；修复前必须实证读取磁盘文件，不得依赖会话上下文记忆
- 状态：已登记（2026-04-13：CRS 扫描范围已扩展至根目录 + prompts + data）

## Gap #GAP-012
- 发现日期：2026-04-14
- 审查目标：`instructions/17-compliance.instructions.md` / `skills/audit-common/SKILL.md` / `skills/compliance/SKILL.md` §FC5 产物路径格式
- 盲区描述：三个模板文件的 FC5 产物路径格式（`📁 … • [link]`）与权威来源 `02-output-paths.instructions.md` §产物路径输出格式（`📂 … - [link]\n  \`纯文本路径\``）不一致：缺少第二行纯文本路径、图标错误（📁→📂）、列表符错误（•→-）。根因：M2 来源依赖盲点——对比三个副本间的一致性时，未追溯 `02-output-paths.instructions.md` 作为权威基准验证。
- 盲点类型：M2 来源依赖盲点（忽略权威来源文件作为验证基准）
- 建议维度：N/A
- 状态：已登记（2026-04-14 修复：三处模板同步为双行格式 Markdown链接+纯文本路径）

## Gap #GAP-014
- 发现日期：2026-04-13
- 审查目标：`prompts/` 报告模板 + `instructions/02-output-paths.instructions.md` §报告路径
- 盲区描述：① `dev.optimization` 有 `reports/optimizations/` 报告子目录（L71），但 `prompts/` 缺少对应 `report-optimization.prompt.md` 模板（D5 L3 联动缺失）。② `dev.scenario-test` 有 `scenario-tests/` 产物目录（L46），但 `02-output-paths` L71 报告子目录列表未包含 `scenario-tests/`。根因：M4 分离盲点——报告模板文件夹、报告路径定义（L71列表）、产物目录（L46树）三处独立维护，新增子类型时只更新了产物目录，未联动更新报告路径列表和报告模板。
- 盲点类型：M4 分离盲点
- 建议维度：N/A
- 状态：已登记（2026-04-13 修复：创建 report-optimization.prompt.md；L71 补充 scenario-tests/ 子目录）

## Gap #GAP-013
- 发现日期：2026-04-13
- 审查目标：`skills/audit-dimensions/SKILL.md` §维度总览表 vs §详细章节
- 盲区描述：①维度总览表 L15 写"D3 流程图语法"，但详细章节 L64 标题是"D3 路由语法正确性"——同文件内部命名自相矛盾。②D1 检查项 L52 写 `mode/description/applyTo`，但 v1.3.x 已将所有 prompts 从 `mode: agent` 改为 `agent: agent`，D1 检查准则未随实现同步，导致 AI 会错误判断所有 prompt 文件 D1 不通过。根因：M3 层次盲点——历次 D5 跨文件一致性检查聚焦跨文件对比，未对单文件内"总览表行"vs"详细章节标题"进行一致性校验；M4 分离盲点——frontmatter 字段名的实现变更未触发 D1 检查准则的同步更新。
- 盲点类型：M3 层次盲点（同文件内部命名未交叉校验）· M4 分离盲点（实现变更未联动规范）
- 建议维度：N/A
- 状态：已登记（2026-04-13 修复：L15 "流程图语法"→"路由语法正确性"；L52 `mode`→`agent`）
## Gap #GAP-016
- 发现日期：2026-04-14
- 审查目标：`skills/dev-init/SKILL.md` L33 .gitignore 路径
- 盲区描述：dev-init SKILL 在 v1.0.0 Stage 7 创建时使用旧 `data/` 路径，后续 `.devcodex/` 体系迁移（v1.0.0→v1.1.0）未触发 dev-init SKILL 同步更新。10-dev.instructions.md 和 02-output-paths.instructions.md 均已迁移至 `.devcodex/.memory/`，但 SKILL 层遗漏。
- 盲点类型：M4 分离盲点
- 建议维度：N/A
- 状态：已登记（2026-04-14 修复：L33 `data/` → `.devcodex/.memory/`）

## Gap #GAP-017
- 发现日期：2026-04-14
- 审查目标：`copilot-instructions.md` / `README.md` / `02-架构约束.md` Prompt 数量
- 盲区描述：v1.3.5 新建 report-optimization.prompt.md 和 report-scenario-test.prompt.md（20→22）时，仅更新了 report/SKILL.md 模板引用表和 02-output-paths 子目录列表，未触发数值引用联动（copilot-instructions.md / README.md / 02-架构约束.md 仍写"20 个"）。与 GAP-015 同类：数值引用散落在文档层，非结构化 grep 能自动覆盖。
- 盲点类型：M2 缺席盲点
- 建议维度：N/A
- 状态：已登记（2026-04-14 修复：4 处 "20 个" → "22 个"）
