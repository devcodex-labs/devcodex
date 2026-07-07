---
name: api-verification
description: 接口验证规范 — 双产物（.http + .cjs）生成 + 自动化执行脚本
---
# API Verification Skill

## 职责

在 dev/fix 工作流涉及接口变更时，生成**归档级双产物**并执行验证：
- `.http` — 可执行请求示例（VS Code REST Client 格式）
- `.cjs` — 自动化执行脚本（Node.js）

> 说明：本 Skill 不负责“给前端或调用方看的轻量接口说明”。这类阅读型目标文档由 `dev-docs` 的 `light-api` / `frontend-api` 模式负责。

## 与 test-router 的关系

- `test-router` 负责识别本轮是否存在 API/HTTP 契约变更、归档级接口验证或回归接口探针需求。
- 一旦 TestRoute 判定需要 `api-verification`，本 Skill 的 `.http + .cjs` 双产物和自动化执行规则仍然强制适用。
- TestRoute 只记录验证路线，不替代本 Skill 的接口覆盖清单、断言脚本和执行结果。

## 触发时机

| 工作流 | 触发条件 |
|--------|---------|
| dev | 新增/修改 API 接口 |
| dev-optimization | 优化前（建立基线）和优化后（对比验证） |
| dev-scenario-test | 场景测试基于接口规范 |
| fix | 修复涉及接口行为变更 |
| test-router | TestRoute 判定存在对外 HTTP/API 契约变更、归档级接口验证或接口回归探针 |

## 双产物规范

### `.http` 文件（可执行请求示例）

```http
# <模块名> API 验证请求示例

@baseUrl = http://localhost:3000
@contentType = application/json
@token = replace-with-token-if-required
@language = zh-CN
@userName = test-user
@userEmail = test@example.com

### POST 创建用户
# @description 创建新用户账号
# @expects 201 + 返回体包含 data.id（人工检查提示）
POST {{baseUrl}}/api/users
Content-Type: {{contentType}}
Accept-Language: {{language}}
# 鉴权值默认可按用户要求直写；只有用户 / 项目要求可分享或脱敏时才保留占位变量
Authorization: Bearer {{token}}

{
  "name": "{{userName}}",
  "email": "{{userEmail}}"
}

###
```

存放：任务目录根 `*-接口验证.http`（dev 需求目录或 fix bug 目录，遵循 `02-output-paths.instructions.md` 产物路径规范）

### `.cjs` 文件（自动化脚本）

```js
// *-接口验证.cjs
const http = require('http')
const https = require('https')
const assert = require('assert')
const BASE_URL = 'http://localhost:3000'

async function testEndpoint(method, path, body, expected, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL)
    const client = url.protocol === 'https:' ? https : http
    const payload = body ? JSON.stringify(body) : null
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method,
      headers: { Accept: 'application/json', ...headers }
    }
    if (payload) {
      options.headers['Content-Type'] = 'application/json'
      options.headers['Content-Length'] = Buffer.byteLength(payload)
    }
    const req = client.request(options, res => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        assert.strictEqual(res.statusCode, expected.status, `${method} ${path}: expected ${expected.status}, got ${res.statusCode}`)
        if (expected.bodyContains) assert.ok(data.includes(expected.bodyContains), `Response missing: ${expected.bodyContains}`)
        resolve({ status: res.statusCode, body: data })
      })
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

// 按需添加接口测试用例
// testEndpoint('GET', '/api/users', null, { status: 200 })
```

存放：任务目录根 `*-接口验证.cjs`（dev 需求目录或 fix bug 目录，遵循 `02-output-paths.instructions.md` 产物路径规范）；归档级脚本只连接外部已运行实例，不在脚本内启动服务。

## 执行规则

1. 读取接口定义（代码/已确认目标文档）
2. 生成 `.http` 文件（覆盖所有公开接口）
3. 生成 `.cjs` 脚本（包含断言：状态码/必填字段）
4. 执行 `.cjs` 脚本，确认全部通过
5. 输出验证摘要（通过/失败/跳过 数量）

## 轻量验证模式（本地调试 / 一次性验证）

> 当目标仅为本地调试、联调排查或一次性自用验证，且不会作为需求/bug 的正式归档产物提交时，可使用轻量模式：

1. 可只写 `.http` 或单个 `.js` / `.cjs` 脚本，不强制生成双产物
2. 脚本以“能直接看懂、能快速执行”为优先，可直接使用局部常量、fixture、命令行参数或用户给出的真实连接信息；只有用户或项目明确指定时才读取 `config.local.json`、env、`secretRef` 或 secret manager
3. 不要求抽象通用测试框架，只需覆盖当前调试路径
4. 一旦要提交到任务目录、沉淀为正式回归资产或用于对外接口验收，必须升级回标准双产物模式

## 关键规则

- 🔴 对外接口变更的归档验证禁止只生成 `.http` 不生成 `.cjs`（双产物缺一不可）
- 归档级脚本必须包含断言（不是只发请求，要验证响应）
- API / SDK / 平台能力或 public API 设计必须先执行 `OfficialApiEvidenceGate`：读取官方 API 文档、公开契约或源码证据；不可用时记录降级证据、兼容风险和采用依据。
- 数据库、队列、缓存、详情页、列表页或跨页面返回状态的接口验证必须执行 `AsyncDbTruthSourceVerificationGate`：区分真实数据源、异步请求、缓存替换、失败回退和刷新边界；不得只凭当前 UI 空白、mock 或同步阻塞路径判断接口可用。
- 前端首页、详情、列表或搜索依赖接口数据时，验证路线要联动 `FrontendAsyncCacheRenderGate` / `StaleWhileRevalidateGate`：有旧缓存先渲染旧数据并异步刷新替换，不能回退为空白或 loading-only。
- 归档级脚本禁止自启服务；必须通过 `API_BASE_URL` 或同等配置连接用户已启动的目标实例
- 归档级 `.http` 必须声明标准变量块：`@baseUrl`、`@contentType`，鉴权接口必须声明 `@token`，有语言/区域差异时必须声明 `@language`
- `UserFacingVerificationArtifactLanguageGate`：`.http` 的标题、说明、人工检查提示、接口验证脚本注释和执行说明默认使用用户当前语言；项目要求英文、双语或特定文档语言时按项目要求；HTTP 方法、Header、变量名、JSON 字段和代码标识保持原样。
- `.http` 的 Host 建议通过 `{{baseUrl}}` 便于切换目标；鉴权头默认可直写真实 Token、Cookie、API Key 或项目私有密码，只有用户 / 项目要求可分享或脱敏时才使用 `Authorization: Bearer {{token}}` 等占位变量
- 接口变更进入正式产物时必须更新双产物（禁止过期文档）
- 前端接口文档、轻量 API 文档、字段映射、错误码或状态枚举发生变更时，必须执行 `ApiDocVerificationSync`：检查归档级 `.http` / `.cjs` 是否需要同步；若不更新，写 `N/A + skipReason`
- 异步、队列、任务型或数据库落库型接口不得只断言 HTTP 状态码；`.cjs` 应按 TestRoute 查询持久化真相源，并在可能时验证最终消费者响应字段
- `.http` 默认定位为“请求样本 + 可选轻提示”，不承诺跨宿主统一断言语法；正式归档级验证以 `.cjs` 为准

## 流程串联验证模式（F-14）

> 当接口间有依赖关系（如先登录取 token → 再调用业务接口）时，须使用流程串联模式：

```js
// 串联示例：先获取 token，再使用 token 调用业务接口
async function runFlow() {
  const loginRes = await testEndpoint('POST', '/auth/login', { user: 'test', pass: 'test' }, { status: 200 })
  const token = JSON.parse(loginRes.body).token
  await testEndpoint('GET', '/api/resource', null, { status: 200 }, { Authorization: `Bearer ${token}` })
}
```

触发条件：接口测试用例中有前序接口产出数据被后序接口消费（如 token/id/session）。
