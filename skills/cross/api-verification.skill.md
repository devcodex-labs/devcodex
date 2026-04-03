---
id: api-verification
name: API Verification
description: 接口验证规范 — 双产物（.http + .cjs）生成 + 自动化执行脚本
version: 1.0.0
tier: pro
workflow: cross
source: specs/api-verification.md
---

# API Verification Skill

## 职责

在 dev/fix 工作流涉及接口变更时，生成**双产物**并执行验证：
- `.http` — 可读接口文档（VS Code REST Client 格式）
- `.cjs` — 自动化执行脚本（Node.js）

## 触发时机

| 工作流 | 触发条件 |
|--------|---------|
| dev | 新增/修改 API 接口 |
| dev-optimization | 优化前（建立基线）和优化后（对比验证） |
| dev-scenario-test | 场景测试基于接口规范 |
| fix | 修复涉及接口行为变更 |

## 双产物规范

### `.http` 文件（接口文档）

```http
### POST 创建用户
# @description 创建新用户账号
POST {{baseUrl}}/api/users
Content-Type: application/json

{
  "name": "{{userName}}",
  "email": "{{userEmail}}"
}

###
```

存放：`tests/api/<module>.http`

### `.cjs` 文件（自动化脚本）

```js
// tests/api/<module>.test.cjs
const { execSync } = require('child_process')
// 执行所有接口并断言响应
```

存放：`tests/api/<module>.test.cjs`

## 执行规则

1. 读取接口定义（代码/文档）
2. 生成 `.http` 文件（覆盖所有公开接口）
3. 生成 `.cjs` 脚本（包含断言：状态码/必填字段）
4. 执行 `.cjs` 脚本，确认全部通过
5. 输出验证摘要（通过/失败/跳过 数量）

## 关键规则

- 🔴 禁止只生成 `.http` 不生成 `.cjs`（双产物缺一不可）
- 脚本必须包含断言（不是只发请求，要验证响应）
- 接口变更后必须更新双产物（禁止过期文档）
