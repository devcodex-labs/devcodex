---
name: Dev Database
description: 数据库开发子类型规范 — Migration 安全策略 + Schema 变更审查
---
# Dev Database Skill

## 触发条件

涉及数据库操作：Schema 变更（DDL）、Migration 文件、ORM 模型、查询优化、数据迁移。

## 执行规则

### Migration 安全策略

| 操作类型 | 要求 |
|---------|------|
| 新增列 | DEFAULT 或 NULLABLE，禁止 NOT NULL 无默认值（避免锁表） |
| 删除列 | 必须先废弃（rename/注释），至少一个版本后再删除 |
| 修改列类型 | 评估存量数据兼容性，准备回滚脚本 |
| 新建索引 | 生产环境使用 CONCURRENTLY（PostgreSQL）或 ALGORITHM=INPLACE（MySQL） |

### CP 流程

- **CP2** 必须包含：Schema ER 图 / 变更前后对比表 / 回滚方案
- **plan-review**（CP2→CP3 强制门禁）：调用 `dev-plan-review` Skill（PR-1~PR-6），PR-5③ Schema 变更属于此路径，**不进 impact-review**
- **CP3** 必须包含：上线步骤（Migration 执行时机）+ 回滚触发条件

## 产出物

- `migrations/YYYYMMDD_description.{sql|ts|js}` — Migration 文件
- `reports/requirements/` — 开发报告（含 Schema 变更说明）

## 关键约束

- 🔴 禁止在 Migration 中写业务逻辑（纯 DDL + 数据修复）
- 🔴 大表（>100万行）变更必须评估锁时间，提供在线变更方案
