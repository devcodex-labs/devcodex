# 未发布变更（Unreleased）

> **用途**: 记录尚未正式发版的实现级变更、修复、规范调整。
> **写入规则**: 用户未明确要求 `tag` / `release` / `publish` 时，默认写入本文件；正式发版时再归档到 `changelogs/vX.Y.Z.md`。
> **维护方式**: 保持倒序，按日期分组；归档完成后移除已发布条目或重置为空模板。

---

## 2026-05-25

- **Claude MCP / 宿主适配收口**：修复 Claude Code 项目级 MCP 配置与 `.claude/settings` 权限放开逻辑，补齐 `mcpServers`、permissions allowlist、部署同步与对应校验探针，降低 Claude 宿主下的假绿与反复授权问题。
- **TypeScript 无产物类型校验补强**：为 dev/fix 主链补入 TS 项目执行后类型校验要求，优先项目既有 `typecheck`，否则执行 `tsc --noEmit`，并明确禁止通过临时 `tsconfig` 或参数文件污染仓库来“过校验”。
- **发布与 CHANGELOG 双阶段收口**：建立“未明确发版默认写 `unreleased`、明确发版后再归档正式版本”的统一规则，新增三层日志模型说明并同步到规范、文档同步、发布指南和报告模板。
- **控制面规则与 API 验证模板收口**：统一前置复审显式输出、控制面交叉验证、语义批次 `unreleased/commit` 边界和 `fix.default` 路径锚点；同时把 `api-verification` 的 `.http/.cjs` 模板、Skill 示例和 `validate.js` 探针修到一致，并同步工作区 `AGENTS.md`、`.github`、`.claude` 部署副本。
- **工作区优先配置与 profile 读取链升级**：新增工作区级 VS Code 启动配置（`chat/payment/user/search/resource/push`），并把 runtime 与 MCP profile 读取升级为“项目根优先、工作区兜底、不隐式合并”，同时补齐需求级实施报告、会话产物与记忆索引，便于按语义批次追踪与本地回滚。
