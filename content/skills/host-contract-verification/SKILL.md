---
name: host-contract-verification
description: 宿主契约验证规范 — 为 Hook / CLI / bootstrap / visible envelope / workspace guard / LinkCapabilityDecision / MCP fallback 定义 direct replay、fixture replay、部署同步与证据路线
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
| `DevCodexVisibleEnvelopeV2` / V1 只读兼容 / `PostCompletionActionSetV1` / `UserFacingArtifactSetV1` / `LinkCapabilityDecisionV1` 变更 | 🔴 必须 |
| Copilot / Codex MCP bridge 报错、`profile_load` fallback、`invoke undefined` 恢复链变更 | 🔴 必须 |
| `ContextReadPlanV2` / `ContextReadReceiptV2`（含 V1 兼容）、Pre/Post 相关性、内容身份/复用、上下文读取 allowlist 或 fallback 语义变更 | 🔴 必须 |
| 公开本地 probe、checkpoint 证据语义或 trace show/replay 变更 | 🔴 必须 |
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
| `artifactLinkMatrix` | 条件 | 当前 surface 的 capability evidence、clickable/portable/plain/failed、fallbackReason 与 renderer parity；不得按宿主名推测 |
| `mcpFallback` | 条件 | MCP bridge 失败时是否降级到同计划有界文件读取 / instruction-fallback；记录错误文本、fallback 路线和是否停止重试 |
| `contextAcquisition` | 条件 | plan/epoch/target/source 相关性、Pre attempted、Post success receipt、fallback 与完成状态 |
| `turnLiveness` | 条件 | 长任务/无续接场景的 host-native、Hook-event、sidecar 能力边界，以及 lease、ACK、terminal、checkpoint 证据 |
| `localProbe` | 条件 | `LocalProbeDescriptorV1/ResultV1` 的 ID、依赖、local-only、同步只读和 zero-write 证据 |
| `checkpointValidation` | 条件 | response-time / post-execution 的 evidence、deadline、status 与 incomplete/timeout 处理 |
| `localTaskTrace` | 条件 | `LocalTaskTraceV1` 的 sequence、duplicate、terminal、restart 与只读 replay 边界 |
| `commands` | ✅ | 本轮实际执行命令或 targeted tests |

## 最小验证矩阵

| 变更类型 | 最小验证 |
|----------|----------|
| Hook 输出契约 | targeted test + direct replay |
| 可见回复三态 | fixture replay 或 direct replay，报告中写明 `visibleReplyEvidence` |
| sticky project / workspace guard | multi-project fixture + follow-up replay |
| bootstrap / 部署副本 | `node scripts/validate.js` + 部署同步后的落点复核 |
| managed deployment manifest | legacy 多 owner + workspace-namespace fixture、规范化 destination 单一 current owner、project current host=0、workspace missing/mismatch/stale/duplicate=0、V8 direct replay |
| workspace 宿主作用域 | `HostAdapterScopeV1` owner/activation 一致 + 子项目五类 generated host artifact=0 + Grok workspace plugin/用户登记正向 + uninstall/repeat/reinstall 配置保真 + status/doctor 同 owner + root native kernel + child plain partial + `devcodex grok --rules` full 路线 + `--cwd`/nested workspace/Windows path identity + outside-workspace no-op 负向 |
| visible set / 产物点击 | manifest/projection property test + 三 renderer fixture；若声称当前 surface 可点，需 direct replay 或用户实测证据 |
| MCP bridge fallback | MCP server no-args direct replay + 非 Full 宿主 fallback 文案探针；若错误来自宿主桥接层，只能声明 fallback 已覆盖，不能声明宿主 bug 已修复 |
| 意图驱动上下文获取 | `ContextAcquisitionToolAllowlistProbe` + plan/receipt direct replay + Pre/Post fixture + hidden-full-read 负例 + fallback no-deadlock |
| Turn Liveness / orphaned turn | state-machine fault matrix + Hook direct replay + restart rehydrate；事件停止后的 proactive 检测只能由 host-native watchdog 或 gray read-only sidecar 证明 |
| 本地 probe | descriptor/dependency/error fixture + CLI JSON/human replay + state hash zero-write；不得联网、启动 watcher 或写 telemetry |
| checkpoint / local trace | fixed-clock 双阶段 fixture + Hook terminal replay + sequence/duplicate/restart/terminal 负例；trace replay 必须证明 payload 不执行且源 state hash 不变 |
| 仅文档声明变更 | `source-consumer-sync` + validate probe；若声称宿主行为改变则不得只改文档 |

## 证据要求

### VisibleOutputHostEvidenceGate

Stop/PreCompact 对最终回复证据必须使用 `verified-present / verified-missing / unverified`：只有观察到可解析 assistant 内容和 `DevCodexVisibleEnvelopeV2` marker、合法动作标题、语义 item 才能判定 present/missing；一个兼容窗口内可识别 V1 marker，但须记录 `legacy-v1-read-only`，不得把它当作新写入证据。未观察到只能 unverified。记录 `evidenceSource / missingItems / semanticDigest`，不得保存不必要的完整回复正文。

legacy “主要产物 + 绝对路径”最多为 `unverified-legacy`。能力未 direct 验证时保持 portable/plain；Rich clickable 只显示单个语义链接。session、daily、SUMMARY、task/checkpoint 和 raw ledger 默认 internal-only，但宿主验证仍要核对它们已进入 internal manifest 和 ECR。

### ContextAcquisitionHostEvidenceGate

- `ContextAcquisitionToolAllowlistProbe` 只允许已注册的只读 Profile / memory 查询工具推进 source state；普通文件搜索、写工具、legacy no-args 全文读取或未知工具不得伪造完成。
- `PreToolUse` 只记录 correlated attempted；只有 `PostToolUse` 中可解析的成功结果，且 invocation planId、planContentId、contextEpoch、activeRoot、tool/source/query 全部匹配时，才生成或推进 `ContextReadReceiptV2`（V1 兼容）。
- `ContextDeliveryReuseHostProbe` 必须分别证明 computation reuse 与 delivery reuse：跨进程只允许复用内容身份绑定的计算元数据；正文省略还必须同 host session、同 epoch、同 source identity 且当前模型已有成功 body observation。宿主无法提供稳定 session 或 Post body 证据时 delivery reuse 必须降级为 false。
- 需覆盖结构化 MCP、path-observable 与 instruction-only 三种宿主能力；后两者缺少可验证结果时必须保持 `unverified`，不能由提示文案升级为 `relevant-complete/completed`。
- MCP bridge 失败只允许一次同计划 bounded fallback 并停止重试；fallback 失败或证据不可观察时输出 warnings / missing sources，但不得形成死循环或跳过后续安全与 CP 门禁。
- Progressive SkillRoute enforcement policy 缺失、损坏或字段非法时必须使用受控 fail-safe：Codex 的 `PreToolUse/Stop` 继续 advisory-only，其他宿主/事件恢复 hard default；bootstrap 与 observe 均保持，禁止因读取异常静默解除其他宿主强制。
- direct/fixture replay 至少覆盖 success、tool error、mismatched epoch/target/source、duplicate/stale Post、legacy projection 和 hidden full-read mutation；报告区分 server direct success 与 host bridge verified。

1. 报告必须说明证据来自 direct replay、fixture replay、现有 targeted test，还是 validate probe 推断。
2. 无法直接读取最终 assistant 内容时，只能落为 `unverified`，不能伪造 `verified-present`。
3. workspace guard 场景必须写清“唯一项目继续沿用”“真实歧义重新提示”“workspace profile 路径”三类边界是否覆盖。
4. 若宿主不支持某类硬拦，只能记录为能力差异或 fallback，不得把缺失能力写成已验证通过。
5. 产物链接必须区分“Markdown 主链接已生成”“当前宿主可点击已实测”“绝对路径 copy fallback 已提供”三种证据；不得把第一项等同于后两项。
6. `profile_load` / MCP 工具出现 `Cannot read properties of undefined (reading 'invoke')` 时，若 DevCodex MCP server direct replay 通过，应记录为宿主 MCP bridge 失败并启用 `mcpFallback=used`，禁止反复重试同一 MCP 调用。
7. Turn Liveness 声明必须分别标注 `host-native-verified / hook-event-verified / sidecar-observed / unsupported / unverified`；PostToolUse 落盘只能证明工具结果已观察，不能证明模型续接或 turn 已终态。
8. `CheckpointValidationResultV1` 缺失 post-execution evidence 时只能是 `unverified` 或 `incomplete-timeout`；只有实际 Hook terminal evidence 才能通过，禁止把等待或 PreCompact 当完成。
9. `LocalTaskTraceV1` 只保留当前 turn 的 typed data projection；`replay` 不得 dispatch payload、重放 mutation、改 lifecycle state、唤醒宿主或控制进程。
10. workspace-namespace 下项目根存在 generated `.grok/AGENTS.md` 是作用域异常而不是部署成功证据；只有 workspace plugin、用户注册、两 cwd 同 identity 与工作区外 no-op 同时通过，才能升级 Grok workspace 结论。
11. plain host 与显式 launcher fallback 必须分别记录 `commands/evidenceMode/evidenceCeiling`；任何一方通过都不能替另一方升级结论。
12. **Grok HostParity partial 闭环（PF-165）**：`doctor`/`status` 的 `hostParity` 必须能给出 `failedChecks` + 可执行 `repairSteps`（command + detail）；宣称已修复 registration/plugin 缺口时，证据须含再次 `doctor --json` 的 checks 回读，不得只写「建议 update」。
13. **GrokTurnChecklist**：声称「Grok 完整工作流已执行」时，报告/回执须覆盖 entry-pc0-pc7、skill-bundle、report-memory 与 honest-ceiling；负向探针见 `classifyGrokTurnOmissionSample`（`scripts/lib/host-parity-scorecard.js`）。

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
| contextAcquisition | plan/epoch/target/source、allowlist、Pre/Post、receipt、fallback 与完成状态 |
| turnLiveness | capability layer、lease/ACK/terminal/checkpoint、fault matrix 与证据状态 |
| localProbe | descriptor/dependency/local-only/zero-write 与 CLI 证据 |
| checkpointValidation | response-time/post-execution 结果、deadline 与证据状态 |
| localTaskTrace | ordered events、terminal、restart、read-only replay 与 source hash |
| commands | |
```

## 禁止

- 禁止仅凭 README / prompt 文案就断言宿主契约已验证。
- 禁止把 `npm test` 通过等价为 direct replay 已覆盖。
- 禁止在需要 direct replay 的场景下只保留人工口头判断。
- 禁止把 Hook 下一事件到达时的 stale 检测写成无事件时可自唤醒；禁止用 sidecar 观察授权自动进程或宿主状态 mutation。
- 禁止把 trace replay 写成 operation replay，或执行 payload 中的命令、文件动作和工具调用。
