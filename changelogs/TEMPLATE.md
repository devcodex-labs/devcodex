# 变更文档模板

> 此模板用于创建新版本的详细变更文档

---

## 📋 版本信息

| 项目 | 内容 |
|------|------|
| **版本号** | vX.Y.Z |
| **发布日期** | YYYY-MM-DD |
| **变更类型** | 新功能 / Bug修复 / 性能优化 / 重构 / 破坏性变更 |
| **风险级别** | P0 (Critical) / P1 (High) / P2 (Low) |
| **向后兼容** | ✅ 兼容 / ❌ 不兼容 |

---

## 📝 变更摘要

> 一句话总结本次变更的核心内容

{在这里填写一句话摘要}

---

## 🎯 背景说明

### 为什么需要这次变更？

{说明变更的背景、动机、要解决的问题}

### 现状问题

- 问题1：{描述}

### 目标

- 目标1：{描述}

---

## 📦 变更内容

### ✨ Added（新增）

- 新增功能1

### 🔄 Changed（变更）

- 变更1

### 🐛 Fixed（修复）

- 修复Bug1

### 🗑️ Removed（移除）

- 移除功能1

### ⚠️ Deprecated（即将废弃）

- 即将废弃的功能1

---

## 📊 影响范围

### 影响的文件

- `path/to/file.js` — {变更说明}

### 用户影响

- {说明对最终用户的影响}

---

## ✅ 验证

```bash
npx @vextjs/devcodex init --dry-run
npx @vextjs/devcodex status
```

---

## 📚 迁移指南（如有破坏性变更）

```bash
# 源码维护者：刷新用户级全局 adapter（不 pack / 不 publish）
devcodex global-adapters apply
# 预发冒烟：
# npm pack && npm install -g ./vextjs-devcodex-<version>.tgz
# 已发布用户：
# npm update -g @vextjs/devcodex
# workspace 运行态 only：
# devcodex update
```

---

## 🔗 相关资源

- 需求文档：填写实际 `website/docs/versions/.../requirements/...` 或 `.devcodex/.../requirements/...` 路径
- 进度追踪：填写实际任务进度、报告或发布验证路径

---

**文档生成时间**: YYYY-MM-DD
