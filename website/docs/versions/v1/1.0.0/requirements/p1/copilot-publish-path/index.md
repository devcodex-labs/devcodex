# GitHub Copilot 发布路径评估（Marketplace / MCP）— 需求概况

> **优先级**：P1 · **状态**：🔄 CP2 待确认

---

## 需求背景

当前需求目标是分析 DevCodex 项目如何发布到 GitHub Copilot 相关市场渠道，并基于官方文档形成可执行发布方案。

但官方现状已经发生变化：

1. GitHub 官方 `GitHub Copilot Extension Developer Policy` 已明确写明：GitHub Copilot Extensions 已于 `2025-11-10` 起弃用，后续方向转向 MCP。
2. GitHub Marketplace 仍然保留了 GitHub App 的上架文档，包括 `Requirements for listing an app`、`Drafting a listing for your app`、`Submitting your listing for publication` 等页面。
3. 因此，“发布到 GitHub Copilot 插件市场”不能再被直接理解为沿用旧 Copilot Extensions 流程上线，而应先区分：
   - 这是在确认历史 Copilot Extensions 的遗留发布方式；
   - 还是在为当前项目寻找 2026 仍可行的官方发布路径；
   - 以及当前项目是否适合转向 MCP、GitHub App Marketplace 或其他分发方式。

基于上述事实，本需求更合理的定义不是“直接执行旧市场发布”，而是“澄清当前官方发布路径，并为 DevCodex 形成后续实施方案”。

---

## 需求定义

### NR-1：明确 GitHub 官方可行发布路径

- 基于官方文档确认 GitHub Copilot Extensions / 插件市场的当前状态。
- 明确区分以下三类路径：
  - 已弃用的历史 Copilot Extensions 路径；
  - GitHub Marketplace 面向 GitHub App 的上架路径；
  - GitHub 官方当前推荐的 MCP 方向。
- 输出结论时必须标清哪些是“历史路径”，哪些是“当前推荐路径”。

### NR-2：评估当前项目与候选发布路径的匹配度

- 结合当前仓库结构，评估 DevCodex 作为 CLI / 规则分发项目是否天然适合：
  - GitHub Marketplace 应用上架；
  - MCP 服务器 / MCP 工具生态接入；
  - 仓库分发、npm 分发、VS Code 扩展等替代发布渠道。
- 不允许脱离当前项目形态，空泛讨论理论流程。

### NR-3：产出后续实施所需的发布方案草案

- 输出一个可供后续 CP2 细化的技术方案方向，至少包含：
  - 推荐发布路径；
  - 不推荐路径及原因；
  - 若坚持走历史 Marketplace 路径，需要满足的前置条件与风险；
  - 若未来转向 MCP / 其他现代路径，需要补齐的工程能力与演进方向。

### NR-4：明确 MCP 仅作为后续演进方向

- 当前需求阶段不把 MCP 模式定义为本轮实施目标。
- 需求文档中仍需明确记录 MCP 为什么是后续可演进方向，以及未来若启动该路线需要补哪些能力。
- 禁止把“提到 MCP”误写成“当前立即进入 MCP 改造”。

---

## 约束条件

- 必须优先使用官方文档作为事实来源，社区资料只能作为补充。
- 需求阶段先做路径澄清与方案定义，不直接进入代码改造或发布执行。
- 必须基于当前 DevCodex 项目形态判断，不把“任何 GitHub App 都能上架”直接等同于“当前项目即可上架”。
- 必须区分“GitHub Marketplace”与“GitHub Copilot Extensions / 插件市场”这两个概念，避免混写。

---

## 非需求（明确排除）

| 排除项 | 理由 |
|------|------|
| 本轮直接实现发布脚本或提交上架材料 | 当前阶段先确认路径是否成立 |
| 把历史 Copilot Extensions 发布流程当作默认推荐方案 | 官方已弃用，默认推荐会误导后续实现 |
| 只给通用 GitHub Marketplace 教程，不评估当前项目是否适配 | 无法指导 DevCodex 后续实施 |
| 在本轮直接启动 MCP 模式改造 | 用户已明确当前暂不做 MCP 模式 |

---

## 验收标准

| # | 标准 | 验证方式 |
|---|------|---------|
| AC-1 | 需求文档明确写出官方对 Copilot Extensions 的弃用事实 | 官方文档核对 |
| AC-2 | 需求文档区分历史路径、当前可行路径与推荐路径 | 人工审查 |
| AC-3 | 需求文档要求结合当前项目形态做路径匹配判断 | 人工审查 |
| AC-4 | 需求文档没有把旧 Marketplace 流程误写成默认当前方案 | 人工审查 |
| AC-5 | 需求文档明确写出“当前不做 MCP，只保留后续演进方向” | 人工审查 |

---

## 影响范围

### 预期产物

| 产物 | 用途 |
|------|------|
| `website/docs/versions/v1/1.0.0/requirements/p1/copilot-publish-path/` | 需求、方案、进度对外规范页 |
| `.devcodex/requirements/GitHub Copilot发布路径评估/` | 本轮需求开发产物 |
| 官方文档调研结论 | 作为 CP2 技术方案输入 |

### 潜在影响点

- 可能改变用户原先对“GitHub Copilot 插件市场”的目标定义。
- 可能将后续远期演进方向指向 MCP 或其他现代分发方式，但不在本轮直接启动该改造。

---

## 待确认问题

1. 本需求是否接受先以“发布路径评估与推荐”作为正式目标，而不是默认承诺实现旧 Copilot Extensions 市场发布？
2. 若官方推荐方向与用户原始预期不一致，后续 CP2 是否以“当前仍可行的官方路径”为主，而把历史路径只作为备选说明？
3. 本需求后续是否需要同时给出“最小改造方案”，说明 DevCodex 若要转向 Marketplace 还缺什么，并单独记录未来 MCP 演进方向？

---

## 官方事实依据（CP1 输入）

- `GitHub Copilot Extension Developer Policy`：页面明确标注 GitHub Copilot Extensions 自 `2025-11-10` 起弃用，转向 MCP。
- GitHub Docs 搜索结果仍可定位到 GitHub Marketplace 上架文档：
  - `Requirements for listing an app`
  - `Drafting a listing for your app`
  - `Submitting your listing for publication`

这意味着本需求必须把“Copilot Extensions 弃用”与“GitHub Marketplace App 上架流程仍存在”同时纳入判断。

---

## 开发文档

| 文档 | 状态 |
|------|------|
| 技术方案（`design.md`） | ✅ 已创建，待 CP2 确认 |
| 实施进度（`progress.md`） | ⏳ 待 CP1 确认后创建 |

---

## 版本变更记录

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| v1.0.0 | 2026-04-10 | 初始需求定义，等待 CP1 确认 |
| v1.0.1 | 2026-04-10 | CP1 已确认，进入 CP2 技术方案确认 |
| v1.0.2 | 2026-04-10 | 按用户要求补充：当前暂不做 MCP 模式，但需在需求中保留后续演进方向 |