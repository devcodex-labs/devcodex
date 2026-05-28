---
name: host-contract-verification
description: 宿主契约验证规范 — 为 Hook / CLI / bootstrap / visible reply / workspace guard 相关任务定义 direct replay、fixture replay、部署同步与证据输出路线
---
# Host Contract Verification Skill

## 职责

当任务涉及宿主事件契约、Hook 可见回复、workspace 项目识别、bootstrap 护栏或部署副本同步时，本 Skill 负责把“怎么证明宿主行为真的成立”收口为可复审的验证路线。

它不替代 `test-router`、`report` 或 runtime tests，而是为这些产物提供统一的宿主证据模型。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| Hook runtime / 宿主适配 / Hook 输出契约变更 | 🔴 必须 |
| Stop / PreCompact 可见回复验证语义变更 | 🔴 必须 |
| sticky `activeProject` / `mode` / workspace guard 变更 | 🔴 必须 |
| Bootstrap、部署副本、父链同步口径变更 | 🔴 必须 |
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
| `commands` | ✅ | 本轮实际执行命令或 targeted tests |

## 最小验证矩阵

| 变更类型 | 最小验证 |
|----------|----------|
| Hook 输出契约 | targeted test + direct replay |
| 可见回复三态 | fixture replay 或 direct replay，报告中写明 `visibleReplyEvidence` |
| sticky project / workspace guard | multi-project fixture + follow-up replay |
| bootstrap / 部署副本 | `node scripts/validate.js` + 部署同步后的落点复核 |
| 仅文档声明变更 | `source-consumer-sync` + validate probe；若声称宿主行为改变则不得只改文档 |

## 证据要求

1. 报告必须说明证据来自 direct replay、fixture replay、现有 targeted test，还是 validate probe 推断。
2. 无法直接读取最终 assistant 内容时，只能落为 `unverified`，不能伪造 `verified-present`。
3. workspace guard 场景必须写清“唯一项目继续沿用”“真实歧义重新提示”“workspace profile 路径”三类边界是否覆盖。
4. 若宿主不支持某类硬拦，只能记录为能力差异或 fallback，不得把缺失能力写成已验证通过。

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
| commands | |
```

## 禁止

- 禁止仅凭 README / prompt 文案就断言宿主契约已验证。
- 禁止把 `npm test` 通过等价为 direct replay 已覆盖。
- 禁止在需要 direct replay 的场景下只保留人工口头判断。
