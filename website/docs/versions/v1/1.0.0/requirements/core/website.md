# 需求：文档站（website/）

**状态**：✅ 已完成（骨架）  
**优先级**：P0

## 目标

建立开发者文档站，中文为主，包含项目介绍、需求管理、进度追踪，内容随重构进度填充。

## 已完成产物

| 文件 | 说明 |
|------|------|
| `website/package.json` | Rspress 依赖配置 |
| `website/tsconfig.json` | TS 配置 |
| `website/rspress.config.ts` | 站点配置（导航、侧边栏）|
| `website/docs/index.md` | 首页骨架 |
| `website/docs/guide/introduction.md` | 介绍页（基本信息）|
| `website/docs/progress/index.md` | 需求进度总览 |
| `website/docs/requirements/` | 需求文档目录（本目录）|

## 导航结构

```
首页
├── 介绍（/guide/introduction）
├── 需求进度（/progress/）
└── 需求文档（/requirements/）  ← 仅开发者可见，不对外展示
```

## 待填充内容（随重构进度）

- 各模块概念说明（/concepts/）
- 设计理念（/design/）
- 规范镜像中文翻译（/specs/）
- 商业化定位（/business/）
- 发布流程（/release/）
