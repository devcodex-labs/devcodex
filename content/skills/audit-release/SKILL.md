---
name: audit-release
description: 发布前审查维度 — 审查 release readiness、发布说明质量、兼容性/迁移风险、package/plugin 元数据、文档/Profile/website 同步、回滚策略、registry/tag 风险和发布后验收；用于用户要求发版前 review、release pre-review、publish/tag 前风险审查或 audit 工作流识别为发布准备审查时。不同于 release-verification，本 Skill 负责审查判断，不执行真实发布动作。
---
# Release Audit Skill

## 职责边界

`audit-release` 回答“当前变更是否适合进入正式发布，以及风险是否被充分披露”。`release-verification` 回答“版本、测试、pack、publish dry-run、tag 和发布后验收链是否执行通过”。

- 审查型：发现风险、缺口、遗漏与建议，默认只读。
- 不执行真实 `tag` / `push` / `publish`。
- 可引用 `release-verification` 的 R0~R7 结果作为证据，但不能用执行通过替代审查结论。
- package completeness gate 是 RL-4 的输入之一，不等于完整发布前审查。
- 发布前复审、tag/publish 前风险清单或多轮 release readiness 收敛必须触发 `review-checklist`，冻结 RL-1~RL-10 及关联发布风险项，并逐项绑定证据。

## 输入范围

优先读取当前发布相关真相源：

- `package.json`、`package-lock.json`、`plugin.json`
- `changelogs/unreleased.md`、根 `CHANGELOG.md`、`changelogs/releases/vX.Y.Z.md`
- README、安装说明、release guide、website 当前文档、Profile
- 当前 git diff/status、已确认需求/bug 产物、发布报告或 ReleaseVerification 证据

## RL-1~RL-10 发布审查维度

| 维度 | 检查内容 | 优先级 |
|------|----------|:------:|
| RL-1 版本身份 | 目标版本、SemVer、tag、registry、发布范围是否唯一且一致 | 🔴 |
| RL-2 发布说明质量 | changelog/release notes 是否覆盖用户可见变化、修复、迁移提示与已知限制 | 🔴 |
| RL-3 兼容与迁移风险 | 先执行 `ReleaseAuthorityBeforeCompatibilityGate` 核对 publishedState、consumerEvidence 和 authoritySources；已发布再审 breaking/迁移，未发布无稳定消费者默认直接收敛 | 🔴 |
| RL-4 元数据完整性 | `description`、`keywords`、`repository`、`homepage`、`bugs`、`license`、`files/exports/bin`、`publishConfig`、`engines`、`plugin.json` 是否完整准确 | 🔴 |
| RL-5 包边界与安装面 | pack 内容、安装路径、认证前提、二进制入口、禁发文件与部署副本边界是否清楚；是否执行 `PublicSurfaceClosureGate`，分类历史 pack 公开内容、README 隐藏链接、public types 兼容 API、examples/sidebar/nav 和搜索索引源文档；公开打包脚本是否执行 `PackagedScriptDependencyClosureGate`，递归核对本地 helper、spawn 目标脚本和运行时依赖进入 tarball | 🔴 |
| RL-6 消费链同步 | README、website、Profile、release guide、模板、validate 与部署副本是否同步；用户可交互发布面命中时执行 `InteractiveSemanticProbe` | 🔴 |
| RL-7 验证准备度 | `npm test`、`test:audit`、远端 CI 绿色、pack/publish dry-run、install smoke、ReleaseVerification R0~R7 的触发与证据是否充分；是否执行 `CandidateDiffCompletenessGate`、`CandidateFreezeGate`、`ReleaseCriticalPathBudgetGate`、`ValidationEvidenceReuseGate`、`RemoteCIParityPushGate` 与 `NativeCommandExitCodeGate`，不得用普通 working diff、未冻结候选、无基线预算或测试通过替代 staged candidate、coverage、audit、examples、website、pack、矩阵脚本或真实退出码 | 🟡 |
| RL-8 回滚与恢复 | 失败恢复、版本回退、tag/registry 冲突、半发布状态处理是否可执行 | 🟡 |
| RL-9 凭据与 registry 安全 | token 不落盘、不输出；GitHub Packages / npm registry / access 策略与文档一致；首次发布或 publisher/repository/package/registry/auth topology 变化时执行 `PublisherCredentialTopologyGate`；scoped package / 双 registry 追加 `ScopedRegistryResolutionGate`，核对 `.npmrc` scope 路由、命令级 override、发布身份、secret scope/access/inheritance、workflow permission、package ownership 与最近成功 run，不读取 secret value | 🔴 |
| RL-10 发布后验收 | registry/tag 验收、安装包边界复核、逃逸复盘与后续台账回写是否定义 | 🟡 |

## 执行步骤

1. 先执行 `audit-common` 的 G0~G5，确认审查范围、文件完整性、一致性与链接基础质量。
2. 冻结发布审查范围：目标版本、发布包、registry、关联 changelog、关联需求/bug，并用 tag/registry/release note/public docs/实际消费者建立发布权威证据。
3. 逐项执行 RL-1~RL-10；缺证据时标为 `⚠️待验证`，不得写成通过。
4. 对照 `release-verification`：执行链缺失写 RL-7；审查风险缺失写 RL-1~RL-6/RL-8~RL-10；RL-9 触发 `PublisherCredentialTopologyGate` 时，复制 workflow 或普通 dry-run 不能替代 topology evidence；双 registry scoped package 若未显式复核 scope registry precedence，不得把两次 dry-run 计作独立通道证据。
5. 输出 findings-first 报告；无问题时仍列出通过证据和残余风险。

## 输出要求

```markdown
## Release Audit

| 维度 | 状态 | 证据 | 结论/动作 |
|------|------|------|-----------|
| RL-1 | ✅/⚠️/❌/N/A | | |
| RL-2 | ✅/⚠️/❌/N/A | | |
| RL-3 | ✅/⚠️/❌/N/A | ReleaseAuthorityBeforeCompatibilityGate | |
| RL-4 | ✅/⚠️/❌/N/A | package completeness gate | |
| RL-5 | ✅/⚠️/❌/N/A | pack/install evidence | |
| RL-6 | ✅/⚠️/❌/N/A | README/website/Profile；InteractiveSemanticProbe 或 N/A | |
| RL-7 | ✅/⚠️/❌/N/A | R0~R7 + candidate freeze/generation + budget/reuse decision + staged candidate + command/shell/cwd/exitCode | |
| RL-8 | ✅/⚠️/❌/N/A | rollback plan | |
| RL-9 | ✅/⚠️/❌/N/A | registry/token boundary + PublisherCredentialTopologyGate（无 secret value） | |
| RL-10 | ✅/⚠️/❌/N/A | post-release acceptance | |
```

报告中的问题清单必须继续附合理性、可实施性、收益、验证状态和影响范围。涉及正式发版动作时，真实 `tag` / `push` / `publish` 仍必须等待用户明确确认。
