---
name: release-verification
description: 发布验证规范 — 覆盖版本、changelog、测试、pack、install smoke、commit/tag/push/publish 前确认与发布后 registry/tag 验收
---
# Release Verification Skill

## 职责

当用户明确要求 release / tag / publish / 版本发布时，执行发布前后验证链。它只做验证和确认边界，不自动执行真实发布动作。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| 用户明确要求 `release` / `publish` / `tag` | 🔴 必须 |
| 修改 package/plugin/version/changelog 口径 | 🟡 条件 |
| 普通未发布实现批次 | N/A，默认写 `changelogs/unreleased.md` |

## R0~R7 验证链

| 阶段 | 检查 |
|------|------|
| R0 | 确认目标版本、SemVer、tag 和 registry 唯一性；执行 `ReleaseAuthorityBeforeCompatibilityGate`，冻结 publishedState、consumerEvidence、authoritySources 与兼容决策 |
| R1 | 将 `changelogs/unreleased.md` 归档到 `changelogs/releases/vX.Y.Z.md`，并更新根 `CHANGELOG.md` |
| R2 | 同步 `package.json`、`package-lock.json`、`plugin.json`、Profile/README/website 版本口径；发布型 Profile 必须补齐 CI workflow/job 矩阵、tag/publish 触发链、失败恢复路径、外部消费者验证矩阵、dist 产物边界、registry/tag 验收与常见故障诊断；用户可交互发布面追加 `InteractiveSemanticProbe` |
| R3 | 执行 `npm test`（默认全链）|
| R3a | 执行 `CandidateDiffCompletenessGate`：先清点 tracked/untracked/ignored 边界，再把本次授权范围物化为 staged candidate snapshot；对 staged snapshot 执行 `git diff --cached --check`、`git diff --cached --name-status` 人工/规则复核、按项目策略执行 secret-shape scan，并核对 staged set 与 intended scope。普通 `git diff --check` 不能替代本门禁，因为它不覆盖未跟踪文件 |
| R3b | 执行 `npm run test:audit`，并完成 package completeness gate（`description`、`keywords`、`repository`、`homepage`、`bugs`、`license`、`files/exports/bin`、`publishConfig`、`engines`、`plugin.json` 元数据）；包边界检查必须在构建/benchmark/codegen 完成后单独串行执行；公开打包脚本必须执行 `PackagedScriptDependencyClosureGate`，递归核对本地 `require()`、`path.join(ROOT,'scripts',...)` 或等价运行时脚本依赖都进入 tarball |
| R3c | 执行 `RemoteCIParityPushGate`：push / tag / release / publish 前先执行与远端 CI 同构的本地门禁；若项目存在远端 CI（如 GitHub Actions），确认目标 commit 对应 CI run 已完成且 conclusion 为 `success`；若存在独立消费者仓，再执行 `ConsumerValidationEngineeringGate`，证明 source event→consumer run、目标 SHA、身份新鲜度和全部适用分母 accepted；无远端 CI/消费者或无权限查询时必须写 `N/A + skipReason`，不得把普通测试通过替代 coverage、audit、examples、website、pack 或矩阵脚本 |
| R4 | 执行 `npm pack --dry-run` 与 `npm publish --dry-run`（遵循当前 `publishConfig`），并执行 `NativeCommandExitCodeGate` |
| R5 | 条件执行 pack install smoke，并记录真实命令退出码 |
| R6 | commit/tag/push/publish 前输出确认，真实发布动作必须等待用户明确确认 |
| R7 | 发布后验证 git tag、registry 版本、安装包边界和 `node scripts/validate.js` |

## PublisherCredentialTopologyGate

首次 publish、repository/owner/package name/registry/publisher/auth mode 变化、迁移发布 workflow，或用户要求“参考成功项目发布”时，必须在 R0~R3c 之间冻结发布凭据拓扑；普通 patch 且拓扑明确未变时可记录 `unchanged + evidence`，不得静默跳过。

| 字段 | 要求 |
|------|------|
| `publisherIdentity` | 实际发布主体/组织；不得包含 token 或 secret value |
| `repositoryIdentity` | owner/repository、workflow 所在仓库与可访问边界 |
| `packageIdentity` | package name、registry、package owner/access 与现存版本 |
| `authMode` | `trusted-publishing / workflow-secret / local-token / other` |
| `secretTopology` | 只记录 org/repo/environment/local scope、access policy 和传递/继承方式；禁止读取或复制 value |
| `workflowPermissions` | OIDC/trusted publishing 所需最小权限；无 workflow 时 `N/A + skipReason` |
| `referenceEvidence` | 参考成功仓库或最近成功 publish run 的身份、拓扑和结论；复制 YAML 不等于凭据等价 |
| `topologyParity` | `aligned / mismatch / unverifiable`、阻断原因与恢复动作 |

GitHub Actions secrets 的 org/repo/environment scope、access policy 与 precedence 必须作为拓扑事实；reusable workflow 的显式 secret 传递或 `secrets: inherit` 只在平台允许的边界内成立。npm registry 采用 trusted publishing 时，按官方条件验证 OIDC、runner、Node/npm 与 `id-token: write`；其他 registry 不得机械套用 npm trusted publisher 结论。

### ScopedRegistryResolutionGate

同一 scoped package 发布到多个 registry，或仓库/用户 `.npmrc` 已声明 `@scope:registry` 时，`--registry=<target>` 不能单独作为目标 registry 证据。每个 view/whoami/dry-run/publish/post-check 必须冻结 package scope、全局 registry、scope registry、userconfig 来源与命令级优先级，并以隔离 userconfig 或显式 `--@scope:registry=<target>` 绑定目标；双 registry 查询若返回完全相同版本集，先判定为可能被 scope 路由污染，禁止直接认定两个 registry 均已验证。

验证至少包含：默认配置下的污染复现、显式 scope override 后的目标 registry 结果、命令参数单测、真实退出码，以及不读取 token value 的 `whoami / package existence / ownership` 证据。npmjs primary 未通过身份与 scope 解析时，不得先发布 mirror 或创建 tag，避免半发布状态。

## ReleaseAuthorityBeforeCompatibilityGate

| 字段 | 要求 |
|------|------|
| `publishedState` | `released / unreleased / unknown`；用 tag、registry、release note、public docs 和目标 commit 交叉证明 |
| `consumerEvidence` | 稳定外部消费者、已公开示例/类型/配置、安装或升级路径；本地 fixture 不等于稳定消费者 |
| `authoritySources` | 每条发布或未发布结论的权威来源、时间/版本与冲突处理 |
| `decision` | released → 兼容/迁移评估；unreleased 且无稳定消费者 → 直接收敛 canonical contract；unreleased 但有产品取舍 → 用户决策；unknown → 阻断兼容结论 |

不得因为字段或行为曾在未发布分支、草稿文档、内部 fixture 或本地历史包中出现，就自动引入 alias、fallback 或迁移层。需要保留未发布兼容行为时，必须记录真实消费者证据或用户明确产品决策。

`mismatch` 或首次发布的 `unverifiable` 阻断 R6；不得通过读取 secret value 来证明等价。本地 token 路线只核对 auth/config 来源、发布身份与真实 dry-run/publish exitCode，不回显认证值。

## 安全边界

- 不主动索取 npm token、GitHub token 或私钥；若用户、registry、CI 或发布平台明确要求提供、写入或输出，按该显式策略处理并记录来源。
- `PublisherCredentialTopologyGate` 只检查身份、scope、access、inheritance、permission 与成功证据；禁止读取或复制 secret value，也禁止把“workflow 相同”当作凭据等价。
- 不把 `publish`、`push`、`tag` 设计为无确认自动动作。
- tag 或 registry 已存在时必须阻断发布动作。
- 有远端 CI 的项目，tag / release / publish 前必须确认目标 commit 远端 CI 绿色；若无法查询，应阻断正式发布或由用户基于风险另行确认，报告中不得标为 ✅。
- 发布失败时写报告和恢复路径，不静默重试凭据相关动作。
- 若 `publishConfig` 指向 GitHub Packages / restricted access，README 与安装文档必须显式保留认证步骤，禁止再宣称“匿名直接安装”。
- 若 `publishConfig` 指向 GitHub Packages，`test:audit` 必须显式使用 `https://registry.npmjs.org` 作为 audit registry，避免 publish dry-run / prepublishOnly 继承 GitHub Packages 的非审计端点；这不等于跳过审计。
- `prepublishOnly` 必须强制跑完整 release gate（至少 `npm run test:all:with-audit`）。
- 按 `ConcurrencyPolicy`，只读准备和隔离验证可并行；`npm pack --dry-run`、package boundary check、files/exports/bin 检查不得与任何会删除、重建或写入 `dist` 的命令并行；若曾出现并行读写竞争，报告必须以重新单独执行的 pack 结果为准，并记录旧结果作废。
- ReleaseVerification 完成前必须检查并清理无关 dirty 文件、旧验证残留和本轮生成但不属于交付范围的产物；不得把残留文件留给后续任务。
- 发布前必须执行 `PublicSurfaceClosureGate`：分类 npm pack 历史公开内容，反查 README 隐藏文档链接、public types 兼容 API 标注、examples/sidebar/nav、搜索索引源文档和 historical pack surface；不得只检查当前源码目录。
- 发布包若包含 `scripts/*.js`、CLI helper、profile validator、migration tool 或公开验证脚本，必须执行 `PackagedScriptDependencyClosureGate`：用 tarball / 临时安装后的真实路径验证公开脚本可执行，缺少本地 helper、spawn 目标脚本或运行时依赖时阻断发布；不得只因源码目录 `npm test` 通过就认定包消费者可用。
- 发布、pack、install smoke、CLI replay、curl/git/npm/node 等原生命令必须执行 `NativeCommandExitCodeGate`：PowerShell 下不能只依赖 `$ErrorActionPreference` 或后续 `Write-Host OK`，必须检查 `$LASTEXITCODE` 或使用会向外传播非零退出码的 wrapper；Bash/类 Unix shell 必须避免管道或子命令吞掉失败。证据至少记录 command、shell、cwd、exitCode、auth/config 来源（如 `.npmrc` / `--userconfig`）、`ScopedRegistryResolutionGate` 的 scope override（若适用）以及失败证据是否已排除；命令失败但脚本继续打印成功文案的结果无效。
- DevCodex 仓库维护脚本的默认实现适配器为 `scripts/lib/checked-command.js`；双 registry 候选验证由 `scripts/publish-dry-run.js` 复用该适配器。适配器通过不等于 registry 发布成功，真实 publish 仍须 PublisherCredentialTopologyGate、R6 授权与 R7 后验收。

## 输出格式

```markdown
## ReleaseVerification

| 阶段 | 状态 | 证据 |
|------|------|------|
| R0 | ✅/⚠️/N/A | |
| ReleaseAuthorityBeforeCompatibilityGate | ✅/⚠️/N/A | publishedState/consumerEvidence/authoritySources/decision |
| InteractiveSemanticProbe | ✅/⚠️/N/A | role/name/focusability/Enter-Space-Escape/focus recovery；截图不作为替代证据 |
| R1 | ✅/⚠️/N/A | |
| R2 | ✅/⚠️/N/A | |
| R3 | ✅/⚠️/N/A | |
| CandidateDiffCompletenessGate | ✅/⚠️/N/A | inventory、staged snapshot、cached diff check、name-status review、secret-shape scan、intended scope match |
| R3b | ✅/⚠️/N/A | package completeness gate |
| R3c | ✅/⚠️/N/A | remote CI green |
| PublisherCredentialTopologyGate | ✅/⚠️/N/A | publisher/repository/package/auth/secret scope/workflow permission/reference run；不含 secret value |
| ScopedRegistryResolutionGate | ✅/⚠️/N/A | packageScope/globalRegistry/scopeRegistry/userconfig/commandOverride/resolvedTarget/independentChannelEvidence |
| ConsumerValidationEngineeringGate | ✅/⚠️/N/A | repository binding / source-consumer identity / denominators / packed artifact / cross-repo CI / freshness；无独立仓写 skipReason |
| R4 | ✅/⚠️/N/A | command/shell/cwd/exitCode |
| R5 | ✅/⚠️/N/A | command/shell/cwd/exitCode |
| R6 | ✅/⚠️/N/A | |
| R7 | ✅/⚠️/N/A | |
```

## 报告要求

正式发布报告必须包含 ReleaseVerification R0~R7 状态、`CandidateDiffCompletenessGate` staged candidate 证据、`R3b` package completeness gate 证据、`NativeCommandExitCodeGate` 退出码证据、失败恢复路径、发布后 registry/tag 验收证据和关联 commit/tag。
