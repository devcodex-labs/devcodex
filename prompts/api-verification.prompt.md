---
agent: agent
description: API 验证模板，用于生成 .http 可执行请求示例和 .cjs 自动化脚本说明
applyTo: .devcodex/**
---
# API 验证模板

> **触发**: `api-verification/SKILL.md` 执行时生成
> **产物路径**: 任务目录根 `*-接口验证.http` + `*-接口验证.cjs`（遵循 `02-output-paths.instructions.md`）
> **执行前提**: 脚本只连接外部已运行实例，不在脚本内自启服务
> **边界**: 本模板用于归档级接口验证，不用于生成轻量 API 文档或前端接口文档

---

## .http 文件模板（VS Code REST Client 可执行请求示例）

```http
# <模块名> API 验证请求示例
# 生成时间：YYYY-MM-DD
# 模块：<module>
# 注意：`@expects` 仅作为人工检查提示，不是跨宿主通用断言语法

@baseUrl = http://localhost:3000
@contentType = application/json
@resourceId = replace-with-created-id

### ① GET 列表
# @description 获取<资源>列表
# @expects 200 + `data.items` 为数组
GET {{baseUrl}}/api/<resource>
Content-Type: {{contentType}}

###

### ② POST 创建
# @description 创建新<资源>
# @expects 201 + 返回体包含 `data.id`
POST {{baseUrl}}/api/<resource>
Content-Type: {{contentType}}

{
  "field1": "value1",
  "field2": "value2"
}

###

### ③ GET 单条
# @description 获取指定<资源>（`resourceId` 填写上一步创建接口返回的 `data.id`）
# @expects 200 + 返回体中的 `data.id` 与 `resourceId` 一致
GET {{baseUrl}}/api/<resource>/{{resourceId}}

###
```

## .cjs 文件模板

```javascript
// <任务目录>/<module>-接口验证.cjs
// DevCodex API Verification Script
// 生成时间：YYYY-MM-DD

const http = require('http')
const https = require('https')
const assert = require('assert')

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000'

async function request(method, path, body, headers = {}) {
  const url = new URL(path, BASE_URL)
  const client = url.protocol === 'https:' ? https : http
  const payload = body ? JSON.stringify(body) : null
  const requestHeaders = {
    Accept: 'application/json',
    ...headers
  }

  if (payload) {
    requestHeaders['Content-Type'] = 'application/json'
    requestHeaders['Content-Length'] = Buffer.byteLength(payload)
  }

  return new Promise((resolve, reject) => {
    const req = client.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method,
        headers: requestHeaders
      },
      res => {
        let raw = ''
        res.on('data', chunk => { raw += chunk })
        res.on('end', () => {
          let data = null
          try { data = raw ? JSON.parse(raw) : null } catch {}
          resolve({ status: res.statusCode, headers: res.headers, body: raw, data })
        })
      }
    )

    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
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

> 项目自身的单元/集成/API 测试仍可放在 `tests/`；本模板只定义 DevCodex 归档级接口验证双产物。面向前端或调用方的阅读型说明请走 `dev-docs` 的轻量文档模式。
