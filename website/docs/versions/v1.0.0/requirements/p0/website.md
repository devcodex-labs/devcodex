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
| `website/docs/intro/index.md` | 介绍页（项目概述、双 Agent 入口、核心设计目标）|
| `website/docs/versions/v1.0.0/requirements/` | 需求文档目录（本目录）|

## 导航结构

```
首页
├── 介绍（/intro/）
│   ├── 设计理念（/intro/philosophy）
│   └── 商业化（/intro/pricing）
├── 规范镜像（/specs/）
└── 版本（/versions/v1.0.0/）
    ├── 需求文档（/requirements/）  ← 本目录
    ├── 变更日志（CHANGELOG）
    └── 发布（/release/）
```
