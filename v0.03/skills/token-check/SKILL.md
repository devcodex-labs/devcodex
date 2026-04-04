---
name: token-check
description: Token 授权验证规范 — Free/Trial/Pro/Enterprise 四层授权 + 功能门控
---
# Token Check Skill

## 职责

在执行需要 Pro/Enterprise 功能时，验证用户 Token 授权层级，按层级开放对应功能。

## 授权层级

| 层级 | 标识 | 开放功能 |
|------|------|---------|
| Free | 无 Token | 基础开发/修复/审查/分析/聊天工作流 || Trial | `DEVCODEX_TOKEN=trial_*` | 等效 Pro 全部功能（7 天有效期，到期自动降级 Free）|| Pro | `DEVCODEX_TOKEN=pro_*` | + 高级子类型（数据库/优化/场景测试/安全修复/项目审查）+ 自修复/续接/规划/API验证/影响评估 |
| Enterprise | `DEVCODEX_TOKEN=ent_*` | + 多租户配置/自定义 Profile/优先支持/团队协作功能 |

## 功能门控矩阵

> Trial 层等效 Pro，矩阵中不单列（7 天有效期到期自动降级 Free）。

| 功能 | Free | Pro | Enterprise |
|------|:----:|:---:|:----------:|
| dev-default / dev-refactor / dev-init / dev-docs / dev-plan-review | ✅ | ✅ | ✅ |
| fix-default / analyze-research / chat | ✅ | ✅ | ✅ |
| audit-common / audit-dimensions / audit-tech-design / audit-requirements / audit-report / audit-document / audit-execution-guide | ✅ | ✅ | ✅ |
| dev-database / dev-optimization / dev-scenario-test | ❌ | ✅ | ✅ |
| fix-incident / fix-security / audit-project | ❌ | ✅ | ✅ |
| api-verification / impact-review | ❌ | ✅ | ✅ |
| self-fix / resume / plan | ❌ | ✅ | ✅ |
| 多租户 Instructions / 自定义 Profile 模板 | ❌ | ❌ | ✅ |

## 验证流程

```
执行请求 → 读取 DEVCODEX_TOKEN 环境变量
  ↓
Token 存在且有效 → 确定层级 → 检查功能权限
  ↓
无 Token 或 Token 无效 → 降级为 Free 层
  ↓
功能在当前层级不可用 → 提示升级，说明所需层级
```

## Token 设置提示

当用户访问 Pro/Enterprise 功能但无有效 Token 时：

```
🔐 该功能需要 Pro 授权
设置方法：export DEVCODEX_TOKEN=your_token
获取 Token：https://devcodex.dev/pricing
当前开放的 Free 功能：[列出可用功能]
```

## 本地开发绕过

开发调试时可设置 `DEVCODEX_DEV=true` 跳过 Token 验证（**仅限本地开发**，生产环境无效）。
