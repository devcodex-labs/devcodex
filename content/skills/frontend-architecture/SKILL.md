---
name: frontend-architecture
description: 前端架构专家 Owner — 当任务涉及页面、组件、状态管理、数据获取、异步缓存、SSR/Nuxt、runtime config、i18n、SSE、空白页、性能、可访问性或前端验证路线时使用；要求优先保证旧数据可见、异步刷新、渲染稳定和用户主路径不断线。
---

# Frontend Architecture Skill

## 定位

本 Skill 负责前端架构 Owner 视角。它把 UI/交互需求落实到渲染策略、组件边界、状态模型、异步数据、缓存、错误恢复、性能与验证路线，避免页面在返回、刷新或接口抖动时变成空白。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| 首页、列表、详情、表单、后台、文档站或任意前端页面开发/修复 | 必须 |
| 涉及接口数据、缓存、异步请求、SSE、SSR、runtime config、i18n、路由返回 | 必须 |
| 用户指出空白页、loading-only、同步请求、缓存缺失、页面还原差或交互断点 | 必须 |
| 仅后端内部逻辑且无前端消费 | N/A + skipReason |

## 核心门禁

| Gate | 要求 | 证据 |
|------|------|------|
| `FrontendArchitectureOwnerGate` | 前端方案必须覆盖渲染策略、状态模型、异步缓存和验证路线 | 源码、运行截图、组件测试、E2E、API mock |
| `FrontendAsyncCacheRenderGate` | 首页、详情、列表有旧数据时先显示旧数据，异步刷新替换 | cache policy、store、route transition evidence |
| `StaleWhileRevalidateGate` | 不得把 loading-only 当主路径；网络慢或失败时保留可用状态 | fallback / stale data / retry |
| `BlankPagePreventionGate` | 返回、刷新、错误、权限、空数据、SSR hydration 不能出现无解释空白 | route guard、error boundary、empty state |
| `RuntimeConfigI18nGate` | runtime config、环境变量、i18n、时区和文案不得写死破坏多环境 | config evidence |
| `FrontendVerificationBudgetGate` | 未被明确要求打开浏览器时，按风险选择静态/组件/API/E2E；高风险或用户要求才浏览器验证 | test-router evidence |

## 执行步骤

1. 确定渲染策略：CSR、SSR、SSG、island、client-only、suspense 或 hydration 边界。
2. 建立状态模型：server state、client state、表单草稿、缓存键、失效策略和路由返回恢复。
3. 设计异步数据：先渲染旧缓存或骨架的条件、刷新、错误、重试、取消和竞态处理。
4. 检查 runtime config、i18n、SSE、长连接、权限和鉴权状态对页面的影响。
5. 定义组件边界：复用条件、props contract、事件、可访问性和布局稳定性。
6. 选择验证路线：静态检查、单元/组件、API mock、E2E、截图或浏览器交互；记录跳过浏览器的理由。

## 输出字段

```markdown
## FrontendArchitectureOwnerGate

| 字段 | 内容 |
|------|------|
| renderingStrategy | CSR / SSR / SSG / hydration / client-only 边界 |
| stateModel | server state、client state、draft、cache key 和 invalidation |
| asyncCachePolicy | stale-while-revalidate、旧数据展示、刷新、错误和重试 |
| runtimeConfig | 环境、baseURL、feature flag、权限、i18n、时区 |
| i18nSseHandling | i18n、SSE/stream、长连接和订阅生命周期 |
| blankPagePrevention | 空态、错误边界、返回恢复、权限和无数据展示 |
| verificationRoute | 静态/组件/API/E2E/截图/浏览器验证与 skipReason |
```

## 反模式

| 反模式 | 修正 |
|--------|------|
| 详情页请求未完成前直接清空页面 | 先显示缓存或 last-known-good 数据，再异步刷新 |
| 把接口请求写成阻塞同步流程 | 改成异步请求、取消竞态和状态机 |
| 浏览器验证无条件触发，消耗大量时间 | 由风险和用户要求决定，低风险可用静态/组件/API 证据 |
| 只按截图还原颜色，不检查交互状态 | 结合 UX 状态反馈、缓存和错误恢复验证 |

## 与其他 Skill 的关系

- `ux-interaction-architecture`：提供任务流、状态反馈和恢复要求。
- `developer-experience-architecture`：前端示例、文档站和组件 API 面向开发者时叠加。
- `audit-project` / `test-router`：负责把前端风险映射到测试路线。
- `expert-output-quality`：前端方案和示例必须区分推荐架构与临时 demo。
