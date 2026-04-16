# 变更日志 (CHANGELOG)

> **说明**: 版本概览摘要，当前维护中的详细变更见 [`changelogs/v1.5.0.md`](./changelogs/v1.5.0.md)，历史版本见对应详细变更文件  
> **最后更新**: 2026-04-17

---

## 版本概览

| 版本 | 日期 | 变更摘要 | 详细 |
|------|------|---------|------|
| [v1.5.2](./changelogs/v1.5.0.md) | 2026-04-17 | 🔧 **规范自进化修复边界重构**："记录在使用，修复在维护"原则；audit 元循环触发条件改为 DevCodex plugin 文件路径判断（不再以"规范文件类型"为依据）；PC4 明确仅记录不修复；PF-009 关闭 | — |
| [v1.5.0](./changelogs/v1.5.0.md) | 2026-04-15 | 🎉 **跨服务需求规范 + 业务流程模板**：需求模板新增 §3 业务流程（Mermaid 流程图 + 节点详解）；入口服务驱动模式（services/ 子目录）；10-dev 跨服务 CP1 规则；load-profile 多服务加载策略；audit-requirements RQ-1 业务流程条件检查 | [查看](./changelogs/v1.5.0.md) |
| [v1.4.0](./changelogs/v1.4.0.md) | 2026-04-14 | 🎉 **技术方案流程重构**：plan-review 两阶段（PR-1 CP2前自检）、新增 PR-7 测试策略、dev-default 六阶段（+N6方案一致性）、技术方案模板增§0现状分析+编写指南、§8→实施约束、备选强制；记忆改进 M-01~M-06；CLI 版本显示；规范一致性批量修复 | [查看](./changelogs/v1.4.0.md) |
| [v1.3.5](./changelogs/v1.3.5.md) | 2026-04-14 | 🔧 **规范深度审查修复**：Prompt frontmatter 统一（mode→agent）、D5三元组补全（optimization/scenario-test报告模板）、D21代码块语言标记、D13/D14扩展点/租户文档、SC3措辞修正、PF-004/005用户决策关闭 | [查看](./changelogs/v1.3.5.md) |
| [v1.3.4](./changelogs/v1.3.4.md) | 2026-04-14 | 🎉 **即发即修元循环**：审查发现问题→立即自我审视→self-fix修复→重启新轮，收敛统一为连续3轮零发现（去掉定向/全面差异）| [查看](./changelogs/v1.3.4.md) |
| [v1.3.3](./changelogs/v1.3.3.md) | 2026-04-13 | 🎉 **自我审视机制（Meta-Audit）**：R2+发现新问题时触发四轴盲点分析（M1范围/M2缺席/M3层次/M4分离），结果写 gap-registry，下轮定向补查；三层同步（audit-common+12-audit+audit-execution-guide）| [查看](./changelogs/v1.3.3.md) |
| [v1.3.2](./changelogs/v1.3.2.md) | 2026-04-13 | 🔧 **V4 缺席检查 + audit 补全**：self-fix V4 新增反向三层覆盖检查；self-fix 报告模板 applyTo 补全；删除 skills/report 多余源码选项；audit-common R1 行补充 CRS 时序 | [查看](./changelogs/v1.3.2.md) |
| [v1.3.1](./changelogs/v1.3.1.md) | 2026-04-13 | 🔧 **规范一致性修复**：PCV状态字段/self-fix报告路径/CRS时序/术语统一 — 7项跨文件一致性缺口修复 | [查看](./changelogs/v1.3.1.md) |
| [v1.3.0](./changelogs/v1.3.0.md) | 2026-04-13 | 🎉 **PCV 收敛后汇总验证**：audit/analyze 新增强制 PCV 五步（实证核查+三列验证+分级标注），三列验证时机由每轮分散改为 PCV-3 统一完成 | [查看](./changelogs/v1.3.0.md) |
| [v1.2.0](./changelogs/v1.2.0.md) | 2026-04-13 | 🎉 **PC4 规范雷达 + 全工作流多轮收敛**：新增 `18-spec-radar.instructions.md`（三轴诊断 G1~G9），analyze 改为多轮收敛（≥3轮），audit 定向审查最少轮次 2→3 | [查看](./changelogs/v1.2.0.md) |
| [v1.1.0](./changelogs/v1.1.0.md) | 2026-04-10 | 🎉 **Instructions-First 架构迁移**：新增 `copilot-instructions.md` always-on 入口，Agent 精简，CLI 分发更新，并停止向目标项目默认分发 `.github/agents/` | [查看](./changelogs/v1.1.0.md) |
| [v1.0.0](./changelogs/v1.0.0.md) | 2026-04-04 | 🎉 **v1.0.0 重构**：全新项目结构，规范文件统一中文，需求管理迁移至 website/docs/versions/v1/1.0.0/requirements/ | [查看](./changelogs/v1.0.0.md) |
| v0.0.3 | 2026-04-04 | 🔧 dev/prod 模式、合规体系重构、记忆四列格式、项目 profile 体系 | — |
| v0.0.2 | 2026-04-04 | 🎉 初始结构：8 种工作流、核心 Skills、11 个 Instructions | — |

---

## 维护说明

### 添加新版本的步骤

1. **创建详细变更文档**
   ```bash
   cp changelogs/TEMPLATE.md changelogs/vX.Y.Z.md
   # 填充详细变更信息
   ```

2. **更新 CHANGELOG.md**（本文件）
   - 在"版本概览"表格最上方添加新行
   - 格式：`| [vX.Y.Z](./changelogs/vX.Y.Z.md) | 日期 | 摘要 | [查看](./changelogs/vX.Y.Z.md) |`

3. **同步版本号到所有文件**
   - `plugin.json` → version 字段
   - `RULES.md` → 标题行和 frontmatter 版本号

4. **重建 lockfile**
   ```bash
   rm package-lock.json && npm install
   ```

5. **提交变更**
   ```bash
   git add CHANGELOG.md changelogs/vX.Y.Z.md plugin.json package.json RULES.md package-lock.json
   git commit -m "release: vX.Y.Z — 摘要"
   ```

### 版本号规则

- **MAJOR** (x.0.0) — 工作流或架构破坏性变更
- **MINOR** (1.x.0) — 新增工作流、新增 Skill、新增指令集
- **PATCH** (1.0.x) — Bug 修复、文字修正、工具改进

---

## 相关文档

- [`changelogs/v1.4.0.md`](./changelogs/v1.4.0.md) — 最新版本详细变更文档
- [`changelogs/v1.1.0.md`](./changelogs/v1.1.0.md) — 历史版本详细变更文档
- [README.md](./README.md) — 项目说明
- [requirements/index.md](./website/docs/versions/v1/1.0.0/requirements/index.md) — 需求文档总览

