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
| R0 | 确认目标版本、SemVer、tag 和 registry 唯一性 |
| R1 | 将 `changelogs/unreleased.md` 归档到 `changelogs/releases/vX.Y.Z.md`，并更新根 `CHANGELOG.md` |
| R2 | 同步 `package.json`、`package-lock.json`、`plugin.json`、Profile/README/website 版本口径；发布型 Profile 必须补齐 CI workflow/job 矩阵、tag/publish 触发链、失败恢复路径、外部消费者验证矩阵、dist 产物边界、registry/tag 验收与常见故障诊断 |
| R3 | 执行 `npm test`（默认全链）|
| R3b | 执行 `npm run test:audit`，并完成 package completeness gate（`description`、`keywords`、`repository`、`homepage`、`bugs`、`license`、`files/exports/bin`、`publishConfig`、`engines`、`plugin.json` 元数据）；包边界检查必须在构建/benchmark/codegen 完成后单独串行执行；公开打包脚本必须执行 `PackagedScriptDependencyClosureGate`，递归核对本地 `require()`、`path.join(ROOT,'scripts',...)` 或等价运行时脚本依赖都进入 tarball |
| R3c | 执行 `RemoteCIParityPushGate`：push / tag / release / publish 前先执行与远端 CI 同构的本地门禁；若项目存在远端 CI（如 GitHub Actions），确认目标 commit 对应 CI run 已完成且 conclusion 为 `success`；无远端 CI 或无权限查询时必须写 `N/A + skipReason`，不得把普通测试通过替代 coverage、audit、examples、website、pack 或矩阵脚本 |
| R4 | 执行 `npm pack --dry-run` 与 `npm publish --dry-run`（遵循当前 `publishConfig`），并执行 `NativeCommandExitCodeGate` |
| R5 | 条件执行 pack install smoke，并记录真实命令退出码 |
| R6 | commit/tag/push/publish 前输出确认，真实发布动作必须等待用户明确确认 |
| R7 | 发布后验证 git tag、registry 版本、安装包边界和 `node scripts/validate.js` |

## 安全边界

- 不主动索取 npm token、GitHub token 或私钥；若用户、registry、CI 或发布平台明确要求提供、写入或输出，按该显式策略处理并记录来源。
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
- 发布、pack、install smoke、CLI replay、curl/git/npm/node 等原生命令必须执行 `NativeCommandExitCodeGate`：PowerShell 下不能只依赖 `$ErrorActionPreference` 或后续 `Write-Host OK`，必须检查 `$LASTEXITCODE` 或使用会向外传播非零退出码的 wrapper；Bash/类 Unix shell 必须避免管道或子命令吞掉失败。证据至少记录 command、shell、cwd、exitCode、auth/config 来源（如 `.npmrc` / `--userconfig`）以及失败证据是否已排除；命令失败但脚本继续打印成功文案的结果无效。

## 输出格式

```markdown
## ReleaseVerification

| 阶段 | 状态 | 证据 |
|------|------|------|
| R0 | ✅/⚠️/N/A | |
| R1 | ✅/⚠️/N/A | |
| R2 | ✅/⚠️/N/A | |
| R3 | ✅/⚠️/N/A | |
| R3b | ✅/⚠️/N/A | package completeness gate |
| R3c | ✅/⚠️/N/A | remote CI green |
| R4 | ✅/⚠️/N/A | command/shell/cwd/exitCode |
| R5 | ✅/⚠️/N/A | command/shell/cwd/exitCode |
| R6 | ✅/⚠️/N/A | |
| R7 | ✅/⚠️/N/A | |
```

## 报告要求

正式发布报告必须包含 ReleaseVerification R0~R7 状态、`R3b` package completeness gate 证据、`NativeCommandExitCodeGate` 退出码证据、失败恢复路径、发布后 registry/tag 验收证据和关联 commit/tag。
