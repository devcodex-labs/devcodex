---
name: host-contract-verification
description: 宿主契约验证规范 — 为 Hook / CLI / bootstrap / visible reply / workspace guard / ArtifactLinkSet / MCP fallback 相关任务定义 direct replay、fixture replay、部署同步与证据输出路线
---
# Host Contract Verification Skill

## 职责

当任务涉及宿主事件契约、Hook 可见回复、workspace 项目识别、bootstrap 护栏、产物链接可点击性、MCP bridge fallback 或部署副本同步时，本 Skill 负责把“怎么证明宿主行为真的成立”收口为可复审的验证路线。

它不替代 `test-router`、`report` 或 runtime tests，而是为这些产物提供统一的宿主证据模型。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| Hook runtime / 宿主适配 / Hook 输出契约变更 | 🔴 必须 |
| Stop / PreCompact 可见回复验证语义变更 | 🔴 必须 |
| sticky `activeProject` / `mode` / workspace guard 变更 | 🔴 必须 |
| Bootstrap、部署副本、父链同步口径变更 | 🔴 必须 |
| `ArtifactLinkSet` / 产物文件点击兼容矩阵变更 | 🔴 必须 |
| Copilot / Codex MCP bridge 报错、`profile_load` fallback、`invoke undefined` 恢复链变更 | 🔴 必须 |
| 仅普通业务代码改动 | N/A |

## HostContractRoute

| 字段 | 必填 | 说明 |
|------|:----:|------|
| `hostSurface` | ✅ | Copilot / Claude Code / Codex / instruction-fallback 中本轮实际验证的宿主面 |
| `eventScope` | ✅ | `UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `PreCompact` / `Stop` / bootstrap / deploy-sync |
| `evidenceMode` | ✅ | direct replay / fixture replay / targeted test / validate probe / manual trace |
| `fixtureSource` | 条件 | 使用 fixture replay 时记录脚本、payload 或样例来源 |
| `visibleReplyEvidence` | 条件 | `verified-present` / `verified-missing` / `unverified`，以及证据来源 |
| `workspaceGuard` | 条件 | 多项目 workspace、sticky project、workspace profile 提示等边界验证 |
| `bootstrapScope` | 条件 | 父链部署体、入口检查块、adapter 初始化或 update 部署验证 |
| `artifactLinkMatrix` | 条件 | `ArtifactLinkSet` 对 Copilot / Claude Code / Codex / instruction-fallback 的主链接与 copy fallback 覆盖情况 |
| `mcpFallback` | 条件 | MCP bridge 失败时是否降级到文件读取 / instruction-fallback；记录错误文本、fallback 路线和是否停止重试 |
| `commands` | ✅ | 本轮实际执行命令或 targeted tests |

## 最小验证矩阵

| 变更类型 | 最小验证 |
|----------|----------|
| Hook 输出契约 | targeted test + direct replay |
| 可见回复三态 | fixture replay 或 direct replay，报告中写明 `visibleReplyEvidence` |
| sticky project / workspace guard | multi-project fixture + follow-up replay |
| bootstrap / 部署副本 | `node scripts/validate.js` + 部署同步后的落点复核 |
| managed deployment manifest | legacy + workspace-namespace fixture、update preview、manifest schema/hash、stale 保留、V8 direct replay |
| ArtifactLinkSet / 产物点击 | static matrix probe + visible reply fixture；若声称某客户端可点，需 direct replay 或用户实测证据 |
| MCP bridge fallback | MCP server no-args direct replay + 非 Full 宿主 fallback 文案探针；若错误来自宿主桥接层，只能声明 fallback 已覆盖，不能声明宿主 bug 已修复 |
| 仅文档声明变更 | `source-consumer-sync` + validate probe；若声称宿主行为改变则不得只改文档 |

## 证据要求

### ArtifactDeliveryCompletenessGate

Stop/PreCompact 对最终回复产物证据必须使用 `verified-present / verified-missing / unverified`：只有观察到可解析 assistant 内容才能判定 present/missing；未观察到只能 unverified。记录 `evidenceSource / missingItems`，不得用任意一个链接替代 active task 的 primary artifacts，也不得保存不必要的完整回复正文。

最终回复在单一 surface 内列出“主要产物”；小集合全列，大集合列 primary + 完整 manifest 入口 + supporting/runtime/excluded-generated 计数。报告、记忆或 SUMMARY 已有链接不能成为最终回复省略 primary artifacts 的理由。

1. 报告必须说明证据来自 direct replay、fixture replay、现有 targeted test，还是 validate probe 推断。
2. 无法直接读取最终 assistant 内容时，只能落为 `unverified`，不能伪造 `verified-present`。
3. workspace guard 场景必须写清“唯一项目继续沿用”“真实歧义重新提示”“workspace profile 路径”三类边界是否覆盖。
4. 若宿主不支持某类硬拦，只能记录为能力差异或 fallback，不得把缺失能力写成已验证通过。
5. 产物链接必须区分“Markdown 主链接已生成”“当前宿主可点击已实测”“绝对路径 copy fallback 已提供”三种证据；不得把第一项等同于后两项。
6. `profile_load` / MCP 工具出现 `Cannot read properties of undefined (reading 'invoke')` 时，若 DevCodex MCP server direct replay 通过，应记录为宿主 MCP bridge 失败并启用 `mcpFallback=used`，禁止反复重试同一 MCP 调用。

### NativeCommandExitCodeGate 可执行适配

- 仓库内需要串行执行原生命令并保留证据的维护脚本优先复用 `scripts/lib/checked-command.js` 的 `runChecked` / `runSequenceChecked`，统一记录 command、cwd、exitCode、signal、duration 与 stdout/stderr 摘要。
- 默认 `shell:false`；只有调用方记录 `allowShellReason` 时才允许 shell。positional path 中的字面 glob 必须在 spawn 前拒绝，显式 `--glob/-g` 等 option value 除外。
- 适配器只是实现路径，不替代 direct replay / fixture replay；必须用 nonzero、ENOENT、失败短路和 literal-glob 负向 fixture 证明不会假绿。

## 与其他 Skill 的关系

- `test-router`：决定宿主验证是否进入 direct replay / fixture replay / targeted test。
- `execution-contract`：记录 `verificationEvidence`，说明本轮要收集哪些宿主证据。
- `source-consumer-sync`：当宿主契约变化会影响 README / website / Profile / 部署副本时，负责同步消费链。
- `report`：把 HostContractRoute 的结果写入实施报告或审查报告。

## 输出格式

```markdown
## HostContractRoute

| 字段 | 内容 |
|------|------|
| hostSurface | |
| eventScope | |
| evidenceMode | |
| fixtureSource | |
| visibleReplyEvidence | |
| workspaceGuard | |
| bootstrapScope | |
| artifactLinkMatrix | |
| mcpFallback | |
| commands | |
```

## 禁止

- 禁止仅凭 README / prompt 文案就断言宿主契约已验证。
- 禁止把 `npm test` 通过等价为 direct replay 已覆盖。
- 禁止在需要 direct replay 的场景下只保留人工口头判断。
