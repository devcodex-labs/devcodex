---
name: host-instruction-projection
description: 宿主指令投影 Owner — 从统一 instructions 真相源确定性生成精简 Host Kernel、薄包装、覆盖回执与完整回退
---
# Host Instruction Projection Skill

## 职责

当任务涉及 always-on instructions 体积、Copilot/Codex/Claude/Gemini/Grok 规则加载、宿主入口文件、生成式规则投影、重复指令碰撞或完整规范回退时，本 Skill 是唯一 Owner。

本 Skill 只负责 `content/instructions.md → projection config → generated host projections → coverage receipt → user-global host targets`。分拆规则与 shared 片段由 control-content 编译器解析；发布包的 `instructions.md` 是编译交付路径。它不替代 `intent`、`cp-gate`、`load-profile`、`spec-governance` 或 `host-contract-verification` 的执行正文，也不把派生文件升级成第二规范真相源。

确定性实现位于 `scripts/lib/host-instruction-projection.js`，生成配置位于 `scripts/host-instruction-projection.json`，派生产物位于 `host-projections/`。

## 触发条件

| 场景 | 是否触发 |
|---|:---:|
| 修改 `instructions.md` 中 S/C、路由、CP、Context、治理或闭环语义 | 必须 |
| 修改宿主入口文件、安装路径或 deployment descriptor | 必须 |
| 新增/调整 Copilot、Claude、Codex、Gemini、Grok、Cursor surface | 必须 |
| 调整 always-on 指令预算或 full fallback | 必须 |
| 仅修改按需 Skill 正文且不触达投影锚点 | N/A + skipReason |

## HostInstructionProjectionGate

投影链固定为：

`instructions.md → mandatory rule parser → semantic replay groups → HostKernelV1 → thin wrappers → HostInstructionCoverageReceiptV1`。

- `instructions.md` 是唯一规范真相源；配置只声明抽取规则、语义锚点、宿主包装与预算。
- S01~S07、C01~C22 必须逐 ID 解析并进入 kernel；缺号、重复号、源锚点缺失或投影锚点缺失均 fail closed。
- 语义组至少覆盖 routing、CP、Context、governance、closure；用户可见输出与 auto 边界作为横切组进入同一回放。
- coverage 必须为 100%；生成器、`--check`、负向 mutation 和 staged/post-commit freshness 缺一不可。
- 禁止手工编辑 projection config 的 `outputs` 指定的 `host-projections/*` 派生产物；发现漂移时重新生成，不能在派生文件上补规则。明确标为 retired 的兼容 fixture 不属于当前部署输出，其历史语义单独保留。

## KernelBudgetGate

| 产物 | 预算 |
|---|---:|
| shared/Copilot kernel | ≤ 16 KiB 且 ≤ 200 行 |
| Claude/Gemini wrapper | ≤ 2 KiB |
| 相同完整 kernel 重复入口 | 0 |

预算超限、覆盖不完整或碰撞时，投影状态必须为 `full-fallback`，不得把部分 kernel 标成可用。性能优化不能降低安全、CP、恢复、治理或 ECR 语义。

## HostSurfaceProjectionGate

| Surface | always-on | 按需/回退 |
|---|---|---|
| Copilot | 用户级 `GlobalHostTargetV1.files.instructions`（Copilot projection） | 当前 receipt 的 G_RUNTIME、MCP/Hook 路径与 full fallback |
| Codex | 用户级 `files.instructions` 的 `AGENTS.md`（shared kernel） | 当前 receipt 的 G_RUNTIME、`files.config` / `files.hooks` 与 full fallback |
| Claude | 用户级 `files.instructions` 的 `CLAUDE.md` 薄包装，指向同代 runtime kernel | 当前 receipt 的 G_RUNTIME、用户原生 Skill 发现、settings/MCP 与 full fallback |
| Gemini | 用户级 `files.instructions` 的 `GEMINI.md` 薄包装，指向同代 runtime kernel | 当前 receipt 的 G_RUNTIME、用户原生 Skill 发现、settings 与 full fallback |
| Grok | 用户级 `files.plugin` / config / hooks；Full 入口使用 `devcodex grok` | 官方用户登记的 canonical plugin identity、同代 runtime 与 `--rules`；plain/full 能力分别以 direct evidence 声明 |
| Cursor | 用户级 `files.plugin` / `files.hooks` | 按当前 target 的 support/evidenceCeiling 验证；Cloud 不从本地结果升级 |

上述路径由 `global-host-target.js`、`global-host-config.js` 和实际 `GlobalHostConfigReceiptV1` 共同确定，不能从 repo cwd 推断。hidden 模式使用 receipt 的 `skillsRuntimeRoot`（G_RUNTIME）；可选 legacy discovery 也仍是用户级部署。wrapper 只允许宿主能力提示和 shared kernel 指针；不得复制完整规则。生成的包装是位置无关模板，安装器必须把 kernel import 绑定到当前 `target.runtimeRoot/AGENTS.md`；验收须解析实际 import、证明文件存在且属于 receipt 当前代际，旧固定路径存在也不能算通过。

## HostAdapterScopeGate

当前安装、更新、状态检查、诊断或卸载采用 `GlobalOnlyHostConfigModeV1`：先解析 `GlobalHostTargetV1` 的用户级 root、shared root、runtime generation、config 与 receipt。host config owner 属于用户级目标；workspace-namespace 只决定项目 active-root 和运行态，不能决定宿主配置落点。

- `global-adapters apply --dry-run --json` 提供只读计划；apply 通过六宿主事务更新受管内容，未知配置、原生 Skill 碰撞和其他插件按当前 merge/ownership 契约保留。
- `status` / `doctor` 与 apply/remove 必须核对同一当前 target、generation 和 receipt。配置路径存在或安装成功，不等于旧 CLI/MCP 已加载；需要新进程与实际执行路径/内容摘要。
- Grok canonical source 使用当前用户级 target 的 `files.plugin`，官方插件登记与该 source identity 对账；旧 workspace/plugin 路径只作明确迁移输入，不作为当前安装 owner。
- 当前 workspace 默认宿主产物为 0；不得通过禁用的 `init/update --host` 或 alias 生成 project-portable adapter。
- 移除使用 `uninstall --dry-run` 后显式 `uninstall --apply`（或公开 global-adapters remove 等价入口），按 receipt-owned 内容执行原子六宿主清理；不得用单 host 参数或目录猜测扩大删除范围。

以下 `HostAdapterScopeV1` 是保留的 legacy helper / 历史迁移分类，不能作为当前公开安装入口：

| scope | owner / activation | 子项目默认产物 |
|---|---|---:|
| `workspace-native` | workspace root / ancestor 或宿主原生工作区发现 | 0 |
| `user-registered-workspace` | workspace root / 官方用户级本地插件登记 + 配置 enabled 状态 | 0 |
| `project-portable` | 显式 project root / repo-shared project discovery | 按显式选择生成 |

历史 fixture 中的 workspace-native、user-registered-workspace、project-portable、root native kernel 与 child plain partial 仅证明当时范围。迁移须核旧 manifest/identity、当前 canonical source 与可逆备份，不能把当前用户级 receipt 改写成旧 workspace owner，也不能按 retired fixture 启用旧 adapter。

## GrokWorkspacePluginGate

1. 官方能力证据必须覆盖 plugin install/update/uninstall、`[plugins].enabled`、plugin hooks 的 `GROK_PLUGIN_ROOT`、passive Hook stdout ignored、官方 `--rules` 与 `grok inspect --json`；变更前重新核验时效性。
2. `UserPromptSubmit` / `Stop` / `PreCompact` 的 passive stdout 不能作为 kernel injection evidence；所有事件保持 S01 的宿主权限边界，风险标签不能产生 shadow permission allow/deny。typed workflow-invalid 与宿主真实权限决定分别留证。
3. plain `grok` 从实际支持的 cwd direct 验证当前用户级 plugin identity、有效项目/active-root 与能力上限；项目歧义或无有效绑定时不得注入另一个项目状态。历史 root/child fixture 不证明当前原生能力。
4. `devcodex grok` launcher 按官方 `--cwd` 解析最终项目并绑定当前用户级 runtime/kernel，合并允许的用户 `--rules`，拒绝 system prompt override 与重复 cwd 冲突；以 headless direct replay 证明 `launcher-rules`。不得把 launcher 结果升级成 plain 模式已验证，缺失当前 kernel 时不得借用历史 workspace 副本。

## FullFallbackGate

完整源部署到用户级 shared target 的 full fallback（逻辑路径 `user://agents/devcodex/instructions.full.md`，通常为 `~/.agents/devcodex/instructions.full.md`）；以当前 target/receipt 和代际为准，不从工作区相对路径寻找。它不位于任一宿主自动规则目录。以下任一情况必须使用或建议读取 full fallback：

- coverage、source/config digest 或生成新鲜度失败；
- 当前任务属于 audit/migration，或低置信无法安全裁剪；
- kernel 中的 Owner 索引要求读取按需 Skill，但 Skill 缺失/不可读；
- 宿主报告 0 instruction、root 截断、冲突版本或未知 import 语义。

full fallback 是兼容/故障路径，不得与 kernel 同时作为两个 always-on 完整副本加载。

## GrokFullLaunchAndPrivateTempGate

- `devcodex grok` 的 SkillRoute bootstrap 必须明确 active，才允许物化 `GrokPrivateTempOwnerV1` prompt snapshot 并 spawn child；bootstrap error/inactive 分别返回 `GROK_FULL_BOOTSTRAP_ERROR` / `GROK_FULL_BOOTSTRAP_INACTIVE`，且 `promptMaterialized=0`、`spawnCount=0`。plain Grok 继续保持 Partial，不能用 SessionStart fallback 冒充 Full bootstrap。
- launcher 的 prompt snapshot 与 plugin SessionStart 分属两个 writer，只共享 `grok/plugins/devcodex-workspace/lib/private-temp-contract.cjs` 的 schema/identity/path guard；installed plugin 不得反向 require source-only 文件，诊断 owner record 不保存 prompt body。
- SessionStart 每次创建 `GrokSessionPrivateOwnerV1` nonce owner root；sessionId 缺失也必须保持唯一。owner token、host/PID、path containment、TTL 与 state 任一不可验证都 fail closed；仅 `expired + dead owner` 可进入恢复，live/unknown owner 不得抢占或清理。

## HostInstructionCollisionGate

碰撞检查至少记录：`path / surface / role / digest / bytes / lines / sourceDigest / cwd / projectRoot`。

- 同一路径多 writer、相同完整内容多入口、不同 sourceDigest kernel、wrapper 未指向 shared kernel、入口为 0 字节或超预算均为 blocker。
- import-only wrapper 计入实际 bytes，但不按第二份完整 kernel 计数。
- 当前 global-adapters transaction、managed block 与 receipt ownership 决定冲突处理；计划、实际写入及回读都要核对，不能用禁用的 `init/update --host` 绕过。
- direct host inspect 不可用时最高为 `instruction-backed/unverified`，不得凭 fixture 升级 enforced。

## CLI 与部署消费者

- `init/update --host <copilot|claude|codex|gemini|grok|cursor|all>` 及单宿主旧 alias 不再是当前部署入口，已知 workspace host selector 返回 `CLI_HOST_CONFIG_GLOBAL_ONLY`。uninstall 的单宿主选择同样禁用；兼容的 `uninstall --host all` 仍进入六宿主 global remove，并保持 dry-run/显式 `--apply` 边界，不是单宿主卸载。
- `GlobalOnlyWorkspaceCleanModeV1` 下，bare `init/update` 只维护 `.devcodex`，不部署任何 workspace 宿主 adapter；用户级 `global-adapters apply` 默认部署六宿主。legacy project projection 仍只有 copilot+claude+codex+gemini+grok 五类工作区 surface，Cursor 必须保持零业务 workspace `.cursor` 产物。
- 重复或冲突 selector 使用 `CLI_HOST_SELECTION_CONFLICT`；未知 host 使用 `CLI_HOST_UNSUPPORTED`。
- managed manifest 必须记录 projection source/content digest，并保证规范化物理 destination 单一 current owner；dry-run 零写入；从 source cwd 与目标项目 cwd 分别验证边界。
- 从 source cwd、workspace root 或 child project 调用，当前 host config target 都按用户级 home/显式路径解析，不切换为 workspace owner；项目 profile/data/memory 仍按独立 active-root 绑定。dry-run 与失败 selector 必须证明零写入。

## 验证路线

1. `node scripts/generate-host-instruction-projections.js --check`。
2. `node scripts/test-host-instruction-projection.js`：规则缺失、锚点 mutation、预算回退、重复内容碰撞、派生新鲜度。
3. `node scripts/test-host-adapters.js`：Gemini/Grok/Cursor event 与输出映射。
4. `node scripts/test-cli-command-registry.js` 与 host install fixture：六宿主用户级目标、旧 selector 拒收、unknown/conflict、dry-run、collision、two-cwd、workspace 零宿主产物、六宿主原子 remove/reinstall 及配置保真；legacy helper fixture 单列。
5. Grok 官方 plugin validate/inspect 对当前用户级 canonical source 与多 cwd 的 direct replay；Source 中 `grok/plugins/devcodex-workspace` 是分发源目录，不是 workspace owner。无 direct 的宿主保持 `UNVERIFIED`。
6. 按授权的 plan/lease 执行适用的 source、package/Profile/deploy 或 full 验证，记录 scoped/managed V3/发布资格边界；staged freshness 与 post-commit clean replay 必须分别留证，不能以裸 runner 命令或组件绿冒充 release-pipeline。

## 回滚

任一 correctness、coverage、碰撞或 direct evidence 失败：

1. 将投影状态降为 `full-fallback`；
2. 保留完整 reader 与已验证的旧代际证据，不重新启用禁用的 CLI aliases；
3. 沿公开事务/保留代际恢复受管配置；保持六宿主原子性、用户未知内容与原生 Skill，不手改 receipt 或 owner；
4. 记录 source/config digest、失败探针和恢复条件，修复后重新生成并完整回放。

## 禁止事项

- 手工维护六份完整规范。
- 用关键词计数代替 S/C ID 与语义锚点回放。
- 为压缩体积删除安全、CP、Context、治理、恢复或 ECR 不变量。
- 在缺少 direct evidence 时宣称宿主已实际加载、执行或强制。
- 把 coverage receipt 或生成 header 当成规范真相源。
- 在 workspace 默认模式向子项目生成 `AGENTS.md/.grok/.codex/.claude/.gemini`，或让读写/诊断使用不同作用域解析器。
