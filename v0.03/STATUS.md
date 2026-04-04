# DevCodex v0.0.1 — 任务状态清单

> **更新日期**: 2026-04-04  
> **版本**: 0.0.1（内测阶段）  
> **下一里程碑**: v0.1.0（公测/基础付费）

---

## 图例

| 符号 | 含义 |
|:----:|------|
| ✅ | 已完成并验证 |
| 🔴 | 阻塞发布的致命问题（必须修复） |
| 🟡 | 应修复的非致命问题（建议在下版本修复）|
| 📋 | 规划中，有明确时间表 |
| ❌ | 未完成 |

---

## 一、发布前阻塞项（v0.0.1）

| # | 类别 | 问题 | 状态 | 修复方式 |
|:-:|------|------|:----:|---------|
| P1 | 🔴 法律 | `LICENSE` 文件内容是 Apache 2.0，但 package.json/plugin.json/README 均声明 AGPL-3.0 | ✅ 已修复 | 已替换为 AGPL-3.0 全文 |
| P2 | 🔴 安全 | `tools/gen-assets.js` 中有旧 MIT 字样和旧包名 `@devcodex/plugin` | ✅ 已记录，dev-only 文件，不影响发布 | 文件在 `.npmignore` 中，不会打包发布 |

---

## 二、审计修复追踪（audit A/B/C 系列）

### A 系列 — 安全问题

| # | 问题 | 状态 | 说明 |
|:-:|------|:----:|------|
| A1 | auth.js 无 `alg` header 验证（JWT 算法混淆攻击）| ✅ 已修复 | `validate.js` `verifyDevcodexToken` 新增 header 解析，`alg !== 'HS256'` 则拒绝 |
| A2 | stateStore 用内存 Map（多实例不安全）| 📋 v5.1 规划 | 已有 TODO 注释；v0.0.1 单实例部署可接受，v5.1 迁移 Redis |
| A3 | `.copilot/token-cache.json` 未在 .gitignore | ✅ 已修复 | `.gitignore` 已含该路径 |
| A4 | bin 字段无命名空间前缀 | ✅ 非问题 | CLI bin 名 `devcodex` 无作用域前缀是正确做法 |
| A5 | `JWT_SECRET` 使用 `'dev-secret'` 弱密钥兜底 | ✅ 已修复 | `auth.js` + `validate.js` 新增启动检查：`NODE_ENV=production` 时启动失败 |

### B 系列 — 文档/配置问题

| # | 问题 | 状态 | 说明 |
|:-:|------|:----:|------|
| B1 | sidebar 死链 `publish.md`/`local-dev.md` | ✅ 已修复 | 已从 sidebar config 移除 |
| B2 | Skills 数量描述轻微不一致 | 📋 接受 | 内测阶段正常波动，v0.1.0 前对齐 |
| B3 | PRICING.md 日期 `2026-01-01` | ✅ 已修复 | 更新为 `2026-04-04` |
| B4 | `.mcp.json` devcodex-auth URL 无对应端点 | ✅ 已修复 | 新增 `_comment` 说明 `/mcp` 为 v5.1 规划路径 |
| B5 | website favicon.svg 缺失 | ✅ 已修复 | `website/docs/public/favicon.svg` 已创建 |

### C 系列 — 长期规划

| # | 问题 | 状态 | 目标版本 |
|:-:|------|:----:|---------|
| C1 | GitHub Marketplace 集成 | 📋 规划中 | v1.0.0 |
| C2 | Pro Token 购买 UI | 📋 规划中 | v0.2.0（内测结束后）|
| C3 | auth server Redis（替换内存 stateStore）| 📋 规划中 | v5.1 / v0.1.0 |
| C4 | 监控 `/metrics` 端点 | 📋 规划中 | v0.2.0 |

---

## 三、本次发布前审计发现（2026-04-04 全面体检）

### 🔴 致命（发布阻塞）

| # | 文件 | 问题 | 状态 |
|:-:|------|------|:----:|
| R1 | `LICENSE` | 文件内容是 Apache 2.0，所有其他文件声明 AGPL-3.0 | ✅ 已修复 |

### 🟡 版本号不一致（已修复）

| # | 文件 | 问题 | 状态 |
|:-:|------|------|:----:|
| V1 | `README.md` | 标题/示例 tag 仍写 v1.0 / v1.0.2 | ✅ 已修复 → v0.0.1 |
| V2 | `SECURITY.md` | Supported Versions 表格写 v1.x | ✅ 已修复 → v0.0.1 |
| V3 | `commercial/TERMS.md` | 版本 v1.0，日期 2025-01-01 | ✅ 已修复 → v0.0.1, 2026-04-04 |
| V4 | `commercial/PRIVACY.md` | 版本 v1.0，日期 2025-01-01 | ✅ 已修复 → v0.0.1, 2026-04-04 |
| V5 | `website/docs/deployment/github-packages.md` | 示例 tag v1.0.2 | ✅ 已修复 → v0.0.1 |
| V6 | `auth/src/routes/validate.js` JSDoc | tier 枚举缺 `'trial'` | ✅ 已修复 |
| V7 | `tools/gen-assets.js` | 旧包名 `@devcodex/plugin`，版本 v1.0.0 | 🟡 dev-only，在 `.npmignore` 中，不影响发布 |
| V8 | `prompts/**.prompt.md` | 模板文件头部写 v1.0 | 🟡 低优，模板文件内部版本，v0.1.0 批量对齐 |

### 🟡 规范改进（来自 20 维度审计 D8/D13/D18）

| # | 来源 | 问题 | 状态 |
|:-:|------|------|:----:|
| D8 | `skills/core/report/SKILL.md` | 缺少"禁止询问用户是否需要写报告"的显式语句 | 📋 v0.1.0 改进 |
| D13 | `instructions/01-common.instructions.md` | C01~C15 约束无代码示例（C08/C12 最易误解）| 📋 v0.1.0 改进 |
| D18 | `instructions/10-dev.instructions.md` | "明显不合理"缺量化条件 | 📋 v0.1.0 改进 |

---

## 四、商业模式与试用期（本次新增）

| # | 变更 | 状态 |
|:-:|------|:----:|
| M1 | 新注册用户 → 7 天 Trial（全 Pro 功能） | ✅ auth.js 已实现 |
| M2 | 试用期过期 → 自动降级 free | ✅ validate.js 已实现 |
| M3 | validate.js 补充 trial_expires 字段在响应中 | ✅ 已实现 |
| M4 | `commercial/PRICING.md` 重写（含开发阶段说明）| ✅ 已完成 |
| M5 | `RULES.md` 授权章节新增 Trial 层 | ✅ 已完成 |
| M6 | website docs 同步（introduction + quick-start）| ✅ 已完成 |
| M7 | 付费通道（Pro 升级 UI）| 📋 C2 — 内测结束后 |

---

## 五、v0.0.1 发布前 Checklist

发布前请手动确认以下项目：

- [x] **P1** LICENSE 文件已替换为 AGPL-3.0 全文 ✅
- [ ] 确认 `auth.devcodex.dev` 服务器已配置 `JWT_SECRET` 环境变量
- [ ] 确认 GitHub OAuth App 的 callback URL 指向正确地址
- [ ] 运行 `node tools/v5-full-audit.js` 零错误
- [ ] 在 GitHub Packages 中确认 `@vextjs/devcodex` 包权限为私有
- [ ] 推送 `v0.0.1` tag 触发自动发布：`git tag v0.0.1 && git push origin v0.0.1`

---

## 六、发版前审计发现（2026-04-04 第二轮全面审查）

### 🔴 已修复

| # | 文件 | 问题 | 修复 |
|:-:|------|------|:----:|
| F1 | `commercial/LICENSE.md` | 版本号 v5.0.0，许可证声明 MIT（与根目录 AGPL-3.0 冲突）| ✅ 修正为 v0.0.1 + AGPL-3.0-or-later |
| F2 | `commercial/FAQ.md` | 版本号 v5.0.0 | ✅ 修正为 v0.0.1 |
| F3 | `prompts/requirement.prompt.md` | 模板头版本 v1.0 | ✅ 修正为 v0.0.1 |
| F4 | `prompts/technical-design.prompt.md` | 模板头版本 v1.0 | ✅ 修正为 v0.0.1 |
| F5 | `prompts/implementation-plan.prompt.md` | 模板头版本 v1.0 | ✅ 修正为 v0.0.1 |
| F6 | `STATUS.md` | P1/R1 LICENSE 已修复但状态仍为 ❌ | ✅ 状态更新 |
| F7 | `website/deployment/github-packages.md` | files 字段示例与 package.json 不一致 | ✅ 已同步 |

### 🟡 观察项（不阻塞发布，v0.1.0 处理）

| # | 文件 | 问题 | 说明 |
|:-:|------|------|------|
| O1 | `devcodex-hooks.json` | 数组为空 `[]`，hooks 通过 plugin.json 注册 | 确认 plugin.json hooks.pre/post 为实际注册方式 |
| O2 | `instructions/12-audit.instructions.md` | 引用 `@self-fix` / `@fix` 旧 Agent 名 | ✅ 已修复（工作流名无 @ 前缀） |
| O3 | `instructions/13-analyze.instructions.md` | 引用 `@dev` / `@fix` | ✅ 已修复（agent.md 中已更新为工作流名） |
| O4 | `tools/gen-assets.js` | 旧包名 `@devcodex/plugin`、MIT header | dev-only，.npmignore 排除 |
| O5 | `website/rspress.config.ts` footer | Copyright 2024-present | 正确（项目始于 2024 年 v4） |

## 七、路径规范迁移（本次变更）

| # | 变更 | 状态 |
|:-:|------|:----:|
| PT1 | `02-output-paths.instructions.md`（plugin + global）重写为 `.devcodex/` 根 | ✅ 已完成 |
| PT2 | `15-memory.instructions.md`（plugin + global）路径更新 | ✅ 已完成 |
| PT3 | `memory/SKILL.md`、`summary/SKILL.md`、`load-profile/SKILL.md`、`dev-init/SKILL.md` 路径更新 | ✅ 已完成 |
| PT4 | `post-session.hook.md` 路径更新 | ✅ 已完成 |
| PT5 | 20 个 prompt 模板 `applyTo` + 路径引用批量更新 | ✅ 已完成 |
| PT6 | `FAQ.md`、`MIGRATION.md`、`website/migration.md` 路径更新 | ✅ 已完成 |
| PT7 | `index.js` `init` 命令自动创建 `.devcodex/.memory/` + 写入 `.gitignore` | ✅ 已完成 |
| PT8 | 全局 grep 扫描零残留 `projects/<project>/` 引用 | ✅ 零残留 |

## 八、网站 Sidebar 死链修复（本次发现）

| # | 死链 | 状态 |
|:-:|------|:----:|
| SL1 | `/guide/unified-agent` | ✅ 已从 sidebar 移除（v0.1.0 规划）|
| SL2 | `/guide/workflow-routing` | ✅ 已从 sidebar 移除 |
| SL3 | `/guide/tiers` | ✅ 已从 sidebar 移除，quick-start.md 死链同步修复 |
| SL4 | `/guide/safety` | ✅ 已从 sidebar 移除 |
| SL5 | `/architecture/plugin-model` | ✅ 已从 sidebar 移除 |
| SL6 | `/architecture/skills-system` | ✅ 已从 sidebar 移除 |
| SL7 | `/architecture/mcp` | ✅ 已从 sidebar 移除 |
| SL8 | `/reference/instructions` | ✅ 已从 sidebar 移除 |
| SL9 | `/reference/prompts` | ✅ 已从 sidebar 移除 |
| SL10 | `/reference/cli` | ✅ 已从 sidebar 移除 |

| 版本 | 目标 | 状态 |
|------|------|:----:|
| v0.0.1 | 内测基础功能 + 7 天试用 + GitHub Packages 私有分发 | 🔄 进行中 |
| v0.1.0 | 公开内测，完善文档，修复 D8/D13/D18 规范问题 | 📋 规划中 |
| v0.2.0 | 付费通道开放（Pro 购买 UI + Redis）| 📋 规划中 |
| v1.0.0 | 正式发布 + GitHub Marketplace | 📋 规划中 |
