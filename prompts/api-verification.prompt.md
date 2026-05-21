---
agent: agent
description: API 验证文档模板，用于生成 .http 接口文档和 .cjs 自动化脚本说明
applyTo: .devcodex/**
---
# API 验证模板

> **触发**: `api-verification/SKILL.md` 执行时生成
> **产物路径**: 任务目录根 `*-接口验证.http` + `*-接口验证.cjs`（遵循 `02-output-paths.instructions.md`）
> **执行前提**: 脚本只连接外部已运行实例，不在脚本内自启服务

---

## .http 文件模板（VS Code REST Client）

```http
# <模块名> API 验证文档
# 生成时间：YYYY-MM-DD
# 模块：<module>

@baseUrl = http://localhost:3000
@contentType = application/json

### ① GET 列表
# @description 获取<资源>列表
# @expects 200 + data.items 数组
GET {{baseUrl}}/api/<resource>
Content-Type: {{contentType}}

###

### ② POST 创建
# @description 创建新<资源>
# @expects 201 + data.id
POST {{baseUrl}}/api/<resource>
Content-Type: {{contentType}}

{
  "field1": "value1",
  "field2": "value2"
}

###

### ③ GET 单条
# @description 获取指定<资源>
# @expects 200 + data.id === :id
GET {{baseUrl}}/api/<resource>/{{resourceId}}

###
```

## .cjs 文件模板

```javascript
// <任务目录>/<module>-接口验证.cjs
// DevCodex API Verification Script
// 生成时间：YYYY-MM-DD

const http = require('http')
const assert = require('assert')

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000'

async function request(method, path, body) {
  // ... HTTP 请求实现
}

async function runTests() {
  console.log('🧪 Running API verification: <module>')
  
  // ① 列表接口
  const list = await request('GET', '/api/<resource>')
  assert.strictEqual(list.status, 200, 'List: expected 200')
  assert(Array.isArray(list.data.items), 'List: expected items array')
  console.log('  ✅ GET /api/<resource>')

  // ② 创建接口
  const created = await request('POST', '/api/<resource>', { field1: 'test' })
  assert.strictEqual(created.status, 201, 'Create: expected 201')
  assert(created.data.id, 'Create: expected id in response')
  console.log('  ✅ POST /api/<resource>')

  console.log('✅ All tests passed')
}

runTests().catch(e => { console.error('❌', e.message); process.exit(1) })
```

## 执行验证

```bash
# 先在独立终端手动启动目标服务，再执行 API 验证
API_BASE_URL=http://localhost:3000 node .devcodex/requirements/<需求名>/<module>-接口验证.cjs

# 预期输出
# 🧪 Running API verification: <module>
#   ✅ GET /api/<resource>
#   ✅ POST /api/<resource>
# ✅ All tests passed
```

> 项目自身的单元/集成/API 测试仍可放在 `tests/`；本模板只定义 DevCodex 归档级接口验证双产物。
