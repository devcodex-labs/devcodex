---
name: host-instruction-projection
description: 宿主指令投影 Owner — 从统一 instructions 真相源确定性生成精简 Host Kernel、薄包装、覆盖回执与完整回退
---
# Host Instruction Projection Skill

## 职责

当任务涉及 always-on instructions 体积、Copilot/Codex/Claude/Gemini/Grok 规则加载、宿主入口文件、生成式规则投影、重复指令碰撞或完整规范回退时，本 Skill 是唯一 Owner。

本 Skill 只负责 `instructions.md → projection config → generated host projections → coverage receipt → deployment descriptors`。它不替代 `intent`、`cp-gate`、`load-profile`、`spec-governance` 或 `host-contract-verification` 的执行正文，也不把派生文件升级成第二规范真相源。

确定性实现位于 `scripts/lib/host-instruction-projection.js`，生成配置位于 `scripts/host-instruction-projection.json`，派生产物位于 `host-projections/`。

## 触发条件

| 场景 | 是否触发 |
|---|:---:|
| 修改 `instructions.md` 中 S/C、路由、CP、Context、治理或闭环语义 | 必须 |
| 修改宿主入口文件、安装路径或 deployment descriptor | 必须 |
| 新增/调整 Copilot、Claude、Codex、Gemini、Grok surface | 必须 |
| 调整 always-on 指令预算或 full fallback | 必须 |
| 仅修改按需 Skill 正文且不触达投影锚点 | N/A + skipReason |

## HostInstructionProjectionGate

投影链固定为：

`instructions.md → mandatory rule parser → semantic replay groups → HostKernelV1 → thin wrappers → HostInstructionCoverageReceiptV1`。

- `instructions.md` 是唯一规范真相源；配置只声明抽取规则、语义锚点、宿主包装与预算。
- S01~S07、C01~C22 必须逐 ID 解析并进入 kernel；缺号、重复号、源锚点缺失或投影锚点缺失均 fail closed。
- 语义组至少覆盖 routing、CP、Context、governance、closure；用户可见输出与 auto 边界作为横切组进入同一回放。
- coverage 必须为 100%；生成器、`--check`、负向 mutation 和 staged/post-commit freshness 缺一不可。
- 禁止手工编辑 `host-projections/*`；发现漂移时重新生成，不能在派生文件上补规则。

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
| Copilot | `.github/copilot-instructions.md`（Copilot projection） | `.github/skills` + `.agents/devcodex/instructions.full.md` |
| Codex | `AGENTS.md`（shared kernel） | `.agents/skills` + `.agents/devcodex/instructions.full.md` |
| Claude | `CLAUDE.md`（仅导入 `@AGENTS.md` 的薄包装） | `.claude/skills` + full fallback |
| Gemini | `GEMINI.md`（导入 `@AGENTS.md` 的薄包装） | `.agents/skills` + full fallback |
| Grok | 原生 `AGENTS.md` | `.agents/skills` + full fallback |

wrapper 只允许宿主能力提示和 shared kernel 指针；不得复制完整规则。Grok 不创建 `.grok/rules` 规范副本。

## FullFallbackGate

完整源固定部署到 `.agents/devcodex/instructions.full.md`，且不位于任一宿主自动规则目录。以下任一情况必须使用或建议读取 full fallback：

- coverage、source/config digest 或生成新鲜度失败；
- 当前任务属于 audit/migration，或低置信无法安全裁剪；
- kernel 中的 Owner 索引要求读取按需 Skill，但 Skill 缺失/不可读；
- 宿主报告 0 instruction、root 截断、冲突版本或未知 import 语义。

full fallback 是兼容/故障路径，不得与 kernel 同时作为两个 always-on 完整副本加载。

## HostInstructionCollisionGate

碰撞检查至少记录：`path / surface / role / digest / bytes / lines / sourceDigest / cwd / projectRoot`。

- 同一路径多 writer、相同完整内容多入口、不同 sourceDigest kernel、wrapper 未指向 shared kernel、入口为 0 字节或超预算均为 blocker。
- import-only wrapper 计入实际 bytes，但不按第二份完整 kernel 计数。
- `init --host` 遇到未授权的现有冲突入口时返回 `HOST_INSTRUCTION_COLLISION`；`update --host` 通过显式 force 路线更新。
- direct host inspect 不可用时最高为 `instruction-backed/unverified`，不得凭 fixture 升级 enforced。

## CLI 与部署消费者

- 公共选择器：`--host <copilot|claude|codex|gemini|grok|all>`。
- 旧 `--claude`、`--codex` 保留；`--gemini`、`--grok` 为等价 alias。
- 无 selector 的 init/update 继续部署 Copilot+Claude+Codex；只有 `--host all` 部署五宿主。
- 重复或冲突 selector 使用 `CLI_HOST_SELECTION_CONFLICT`；未知 host 使用 `CLI_HOST_UNSUPPORTED`。
- managed manifest 必须记录 projection source/content digest；dry-run 零写入；从 source cwd 与目标项目 cwd 分别验证边界。

## 验证路线

1. `node scripts/generate-host-instruction-projections.js --check`。
2. `node scripts/test-host-instruction-projection.js`：规则缺失、锚点 mutation、预算回退、重复内容碰撞、派生新鲜度。
3. `node scripts/test-host-adapters.js`：Gemini/Grok event 与输出映射。
4. `node scripts/test-cli-command-registry.js` 与 host install fixture：默认兼容、五 host、aliases、unknown/conflict、dry-run、collision、two-cwd。
5. `node scripts/run-validation.js --route full --no-cache`、package/Profile/deploy、staged freshness 与 post-commit clean replay。

## 回滚

任一 correctness、coverage、碰撞或 direct evidence 失败：

1. 将投影状态降为 `full-fallback`；
2. 保留旧 CLI aliases 与完整 `instructions.md` reader；
3. 按 surface 回滚 adapter，不删除其他宿主已通过的派生物；
4. 记录 source/config digest、失败探针和恢复条件，修复后重新生成并完整回放。

## 禁止事项

- 手工维护五份完整规范。
- 用关键词计数代替 S/C ID 与语义锚点回放。
- 为压缩体积删除安全、CP、Context、治理、恢复或 ECR 不变量。
- 在缺少 direct evidence 时宣称宿主已实际加载、执行或强制。
- 把 coverage receipt 或生成 header 当成规范真相源。
