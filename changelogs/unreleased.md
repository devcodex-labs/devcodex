# 未发布变更（Unreleased）

> **用途**: 记录尚未正式发版的实现级变更、修复、规范调整。
> **写入规则**: 用户未明确要求 `tag` / `release` / `publish` 时，默认写入本文件；正式发版时再归档到 `changelogs/vX.Y.Z.md`。
> **维护方式**: 保持倒序，按日期分组；归档完成后移除已发布条目或重置为空模板。

---

## 2026-05-28

- 修复规范治理台账闭环：统一 `violations` / `pending-fixes` 字段模型，新增修复方案、修复时间、验证状态、验证证据与关闭时间，明确 DevCodex 规范自身问题按 active-root 写入 `.devcodex/devcodex-v1/data/`，并补强 RecordRouter 对用户纠偏、误关闭、误落点和复审逃逸问题的分流规则与 validate 探针。
- 修复 Hook Stop/PreCompact 可见回复验证：支持 content parts、messages、choices 与 transcript variants，并将 closure 判断升级为 `verified-present` / `verified-missing` / `unverified` 三态。
- 修复 Copilot 多项目 workspace 根每轮 warning：已识别唯一项目后短 TTL 内沿用 sticky `activeProject` 与项目 `mode`，workspace-namespace 提示改为真实 `.devcodex/workspace/profile/` 路径，并避免把 payload `role: "user"`、prompt `user-visible`、URL 片段或前缀项目路径等通用/相邻词误判为同名项目。
- 补充 dev/fix 用户可见意图扩展摘要规则，在控制面、宿主差异、路由修正、风险升高或跨会话 resume 时输出 3~5 行摘要。
- 新增 `execution-contract`、`test-router`、`release-verification` 三个支撑型 Skill，并同步注册到 `plugin.json`。
- 补强 dev/fix、报告模板、实施计划、实施进度与交付清单对执行契约、测试路由、发布验证和多批次进度的强制消费。
- 更新 README、website 与 Agent 文档，将 Skill 数量同步为 39，并说明 Auto/控制面/多批次/发布任务的闭环约束。
