# 未发布变更（Unreleased）

> **用途**: 记录尚未正式发版的实现级变更、修复、规范调整。
> **写入规则**: 用户未明确要求 `tag` / `release` / `publish` 时，默认写入本文件；正式发版时再归档到 `changelogs/vX.Y.Z.md`。
> **维护方式**: 保持倒序，按日期分组；归档完成后移除已发布条目或重置为空模板。

---

## 2026-05-26

- 澄清 init/update 同步语义：默认 `init/update` 会同步 Copilot `.github/` 并链式部署 Claude Code adapter，`--claude` 为 Claude-only 路径；同步更新 README、CLI help 与项目 Profile。
- 修复本轮全面审查问题清单：补齐 validate V2/V3/V6/V8/V19 覆盖，新增 `scripts/check-syntax.js`，并将 `test:all` 扩展为发布前全量验证链路（validate、Hook/MCP/fallback/migrate、pack、website build、root/website audit、语法检查）。
- 修复 Hook/MCP/fallback 运行时边界：支持 `optimizations`、`scenario-tests` 任务根，避免只读搜索危险命令字样被误拦，补充无 `WHERE` 的 `DELETE FROM` 阻断与回归测试。
- 修复 CLI 与分发一致性：`init`/`init --claude` 自动创建 `.devcodex/.audit-state/` 并写入 `.gitignore`，`status`/`doctor` 支持 workspace-namespace profile，`detectAgent` 优先宿主环境变量。
- 同步规范、模板与文档站：统一 active-root/workspace-namespace、报告产物 Markdown 链接、G1~G11、data runtime/template 语义与 analyze 子类型口径。
- 清理维护态记录分发边界：将源仓真实治理台账迁入 `.devcodex/.maintainer-state/` 本地维护态，npm 包仅保留空模板与示例说明。
- 修复 Stop hook 可见回复读取根因：Copilot Stop payload 只提供 `transcript_path` 时，Hook 会从 JSONL transcript 解析最新 assistant 正文，再执行入口检查、合规块与产物路径检测，避免把“未读取 transcript”误报为用户未输出产物。
- 明确 devcodex-v1 本地开发同步边界：修改分发源后必须在工作区根同步 `.github/.claude`，不再把源码仓根 `.github/.claude` 作为部署副本目标。
- 修复复审遗留问题：MCP `.mcp.json` smoke test 改为在临时目标项目中验证 `.claude/mcp` 部署产物，避免依赖源码仓未跟踪副本假绿。
- 修复产物路径单行链接边界：Hook 现在能识别位于回复末尾的产物区 Markdown 链接，并补充 Stop reminder 回归测试。
- 修复 V8 部署同步误报：父级 `.github/.claude` 同步检查改为内容哈希优先，避免内容一致但 mtime 较旧时继续产生 stale warning。
- 同步 audit-state finding 状态枚举：规范与校验统一支持 `pending`、`in-progress`、`transferred`、`superseded` 等状态，并阻断终态未解决 findings。
- 修复 hook 关闭阶段与 bootstrap 阶段重复提醒：同一轮相同缺失项只提示一次，并同步当前工作区 `.github/.claude` 部署副本。
- 修复产物路径检测兼容性：支持反引号包裹的 Windows 绝对路径，并允许产物区单行 Markdown 链接被识别为已输出产物。
- 修复 Claude Code MCP 启动契约：`.mcp.json` 改为跨平台相对路径参数，新增按真实 `.mcp.json` 启动服务器的 smoke test。
- 修复 `devcodex status` 在 workspace namespace 项目目录下误判 profile 缺失的问题，并收紧 audit-state 终态 open findings 校验。
- 调整 lifecycle hook 默认执行策略为 `safety-only`：bootstrap、CP gate、Auto 白名单等流程问题改为提醒放行，仅危险命令继续硬拦，避免多项目/附件场景下读取与澄清工具被自锁。
- 增强多项目目标识别：支持从提示词裸项目名和附件路径推断目标项目，并补充 hook runtime 回归测试。
