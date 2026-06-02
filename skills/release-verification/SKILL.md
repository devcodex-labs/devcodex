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
| R2 | 同步 `package.json`、`package-lock.json`、`plugin.json`、Profile/README/website 版本口径 |
| R3 | 执行 `npm test`（默认全链）|
| R3b | 执行 `npm run test:audit`，并完成 package completeness gate（`description`、`keywords`、`repository`、`homepage`、`bugs`、`license`、`files/exports/bin`、`publishConfig`、`engines`、`plugin.json` 元数据） |
| R3c | 若项目存在远端 CI（如 GitHub Actions），确认目标 commit 对应 CI run 已完成且 conclusion 为 `success`；无远端 CI 或无权限查询时必须写 `N/A + skipReason`，不得把本地测试冒充远端 CI |
| R4 | 执行 `npm pack --dry-run` 与 `npm publish --dry-run`（遵循当前 `publishConfig`） |
| R5 | 条件执行 pack install smoke |
| R6 | commit/tag/push/publish 前输出确认，真实发布动作必须等待用户明确确认 |
| R7 | 发布后验证 git tag、registry 版本、安装包边界和 `node scripts/validate.js` |

## 安全边界

- 不读取、不写入、不输出 npm token、GitHub token 或私钥。
- 不把 `publish`、`push`、`tag` 设计为无确认自动动作。
- tag 或 registry 已存在时必须阻断发布动作。
- 有远端 CI 的项目，tag / release / publish 前必须确认目标 commit 远端 CI 绿色；若无法查询，应阻断正式发布或由用户基于风险另行确认，报告中不得标为 ✅。
- 发布失败时写报告和恢复路径，不静默重试凭据相关动作。
- 若 `publishConfig` 指向 GitHub Packages / restricted access，README 与安装文档必须显式保留认证步骤，禁止再宣称“匿名直接安装”。
- `prepublishOnly` 必须强制跑完整 release gate（至少 `npm run test:all:with-audit`）。

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
| R4 | ✅/⚠️/N/A | |
| R5 | ✅/⚠️/N/A | |
| R6 | ✅/⚠️/N/A | |
| R7 | ✅/⚠️/N/A | |
```

## 报告要求

正式发布报告必须包含 ReleaseVerification R0~R7 状态、`R3b` package completeness gate 证据、失败恢复路径、发布后 registry/tag 验收证据和关联 commit/tag。
