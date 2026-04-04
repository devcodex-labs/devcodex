# DevCodex 定价与套餐

> **版本**: v0.0.1
> **更新日期**: 2026-04-04
> **开发状态**: 🚧 内测阶段 — 当前版本为早期预览，功能持续迭代中

## ⚠️ 开发阶段说明

DevCodex v0.0.1 目前处于**早期内测阶段**：

- 所有注册用户享有 **7 天全功能免费试用**（Pro 层所有功能）
- 7 天试用期结束后，自动降级为 Free 层（基础 dev/fix/audit/analyze + chat 保持免费）
- **付费通道尚未开放**，试用期结束后如需继续使用 Pro 功能，请联系 support@devcodex.dev 申请延长内测资格
- 内测期间 Bug 和功能反馈将直接影响产品路线图，欢迎通过 Issues 反馈

## 套餐概览

| 套餐 | 月付 | 年付 | 说明 |
|------|:----:|:----:|------|
| **试用期**（注册后7天）| — | — | 全功能免费体验，注册即激活 |
| **Free** | ¥0 | ¥0 | 试用期结束后保留基础功能（基础 dev/fix/audit + analyze + chat），20次/天 |
| **Pro** | ¥49 | ¥39/月 | 试用期结束后升级，解锁全部工作流 |
| **Enterprise** | 联系我们 | 联系我们 | 团队/企业，含多租户定制与 SLA |

## 功能对比

| 功能 | Free | 试用期/Pro | Enterprise |
|------|:----:|:----------:|:----------:|
| **基础工作流（永久免费）** | | | |
| analyze（技术调研/研究）| ✅ | ✅ | ✅ |
| chat（问答）| ✅ | ✅ | ✅ |
| dev 基础（default/refactor/init/docs/plan-review）| ✅ | ✅ | ✅ |
| fix 基础（default）| ✅ | ✅ | ✅ |
| audit 基础（规范文件/技术方案/需求文档/报告/文档）| ✅ | ✅ | ✅ |
| **Pro 工作流** | | | |
| dev 高级（database/optimization/scenario-test）| ❌ | ✅ | ✅ |
| fix 高级（incident/security）| ❌ | ✅ | ✅ |
| audit 高级（项目工程深度审查）| ❌ | ✅ | ✅ |
| self-fix（规范自修复）| ❌ | ✅ | ✅ |
| resume（断点续接）| ❌ | ✅ | ✅ |
| plan（执行规划）| ❌ | ✅ | ✅ |
| **Pro 特性** | | | |
| API 验证（双产物 .http + .cjs）| ❌ | ✅ | ✅ |
| 影响评估（六维框架）| ❌ | ✅ | ✅ |
| **Enterprise 专属** | | | |
| 多租户自定义 Instructions | ❌ | ❌ | ✅ |
| 团队共享 Profile 模板 | ❌ | ❌ | ✅ |
| 自定义合规规则 | ❌ | ❌ | ✅ |
| 优先技术支持 | ❌ | ❌ | ✅ |
| SLA 保障 | ❌ | ❌ | ✅ |

## 注册与试用

1. 访问 [https://devcodex.dev](https://devcodex.dev)，使用 GitHub 账号一键登录
2. 登录后自动激活 7 天 Pro 试用期，无需信用卡
3. 复制 DevCodex Token，在 VS Code 中运行：
   ```
   DEVCODEX_TOKEN=<your-token> npx @vextjs/devcodex init
   ```
4. 试用期结束后，Free 功能（基础 dev/fix/audit/analyze + chat）永久保留

> **当前内测阶段**：付费升级通道尚未开放，试用期结束可邮件联系延长内测资格。

## 联系我们

- 邮件：support@devcodex.dev
- GitHub Issues：https://github.com/vextjs/devcodex/issues
- 内测反馈优先处理
