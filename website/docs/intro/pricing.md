# 商业化模式

> DevCodex 采用 **Freemium + 订阅制** 商业模式，核心开发工作流永久免费，高级工作流和企业功能按层收费。

---

## 套餐概览

| 套餐 | 月付 | 年付 | 说明 |
|------|:----:|:----:|------|
| **试用期**（注册后一个月）| — | — | 全功能免费体验，注册即激活，无需信用卡 |
| **Free** | ¥0 | ¥0 | 试用期结束后保留基础功能，永久免费 |
| **Pro** | ¥49/月 | ¥39/月 | 解锁全部工作流和高级特性 |
| **Enterprise** | 联系我们 | 联系我们 | 团队/企业，多租户定制 + SLA |

---

## 功能分层

| 功能 | Free | Pro | Enterprise |
|------|:----:|:---:|:----------:|
| **永久免费工作流** | | | |
| chat（问答）| ✅ | ✅ | ✅ |
| analyze（分析/技术调研）| ✅ | ✅ | ✅ |
| dev 基础（default/refactor/init/docs/plan-review）| ✅ | ✅ | ✅ |
| fix 基础（default）| ✅ | ✅ | ✅ |
| audit 基础（规范/技术方案/需求/报告/文档）| ✅ | ✅ | ✅ |
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
| `@devcodex-auto` 全自动模式 | ❌ | ✅ | ✅ |
| **Enterprise 专属** | | | |
| 多租户自定义 Instructions | ❌ | ❌ | ✅ |
| 团队共享 Profile 模板 | ❌ | ❌ | ✅ |
| 自定义合规规则 | ❌ | ❌ | ✅ |
| 优先技术支持 + SLA | ❌ | ❌ | ✅ |

---

## 当前阶段

> ⚠️ **v1.0.0 内测阶段**：付费通道尚未开放。

- 所有注册用户享有 **一个月全功能免费试用**（Pro 层所有功能）
- 试用期结束后自动降级为 Free 层，基础工作流永久保留
- 内测期间如需继续使用 Pro 功能，请联系 [support@devcodex.dev](mailto:support@devcodex.dev) 申请延长内测资格
- 内测期间 Bug 和功能反馈将直接影响产品路线图

---

## 注册与开始使用

1. 访问 [https://devcodex.dev](https://devcodex.dev)，使用 GitHub 账号一键登录
2. 登录后自动激活 7 天 Pro 试用期
3. 复制 DevCodex Token，在项目目录运行：
   ```bash
   DEVCODEX_TOKEN=<your-token> npx @vextjs/devcodex init
   ```
4. 在 VS Code 中使用 `@devcodex` 开始工作

---

## 联系我们

- 邮件：[support@devcodex.dev](mailto:support@devcodex.dev)
- GitHub Issues：[github.com/vextjs/devcodex/issues](https://github.com/vextjs/devcodex/issues)
