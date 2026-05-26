# 未发布变更（Unreleased）

> **用途**: 记录尚未正式发版的实现级变更、修复、规范调整。
> **写入规则**: 用户未明确要求 `tag` / `release` / `publish` 时，默认写入本文件；正式发版时再归档到 `changelogs/vX.Y.Z.md`。
> **维护方式**: 保持倒序，按日期分组；归档完成后移除已发布条目或重置为空模板。

---

## 2026-05-26

- 模板链防偏移能力增强：
  - 强化 `requirement.prompt.md`：补入需求类型判定、核心定义、作用域与边界判定、风险与开放问题、当前阶段结论，并要求 Markdown 需求文档包含 `## 目录导航`
  - 强化 `technical-design.prompt.md`：补入“关联目标文档”显式锚点，以及“实施映射与范围边界 / 偏移触发器”
  - 强化 `implementation-plan.prompt.md` 与 `implementation-progress.prompt.md`：补入分批执行策略、关键实施约束、独立验证方式、阻塞恢复字段与回滚触发条件
- 文档模板链补强：
  - 新增 `prompts/general-doc.prompt.md` 通用文档模板
  - 收口 `project-readme.prompt.md` 的项目类型分流，避免默认偏开源 npm 库场景
  - 收口 `light-api-doc.prompt.md` 的联调可用性，补入 `curl` 请求示例、成功响应和错误响应示例
- 规则与校验链同步：
  - `skills/dev-docs`、`skills/dev-default`、`instructions/10-dev.instructions.md` 已统一要求 Markdown 阅读型文档具备目录导航，并要求 CP2 技术方案显式引用目标文档路径 / 模式 / 契约范围
  - `scripts/validate.js` 已补模板语义探针与资产计数联动校验
- 部署与验证：
  - 已同步工作区 `.github/` 与 `.claude/`
  - `node scripts/validate.js`、`node scripts/validate-profile.js`、`node scripts/test-hooks-runtime.js`、`node scripts/test-mcp-servers.js`、`npm test` 全部通过
