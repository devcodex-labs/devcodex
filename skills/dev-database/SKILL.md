---
name: dev-database
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
- **plan-review**（两阶段门禁）：PR-1 在 CP2 前自检，PR-2~PR-7 在 CP2→CP3 之间执行，PR-5③ Schema 变更属于此路径，**不进 impact-review**
- **CP3** 必须包含：上线步骤（Migration 执行时机）+ 回滚触发条件

## 产出物

- `migrations/YYYYMMDD_description.{sql|ts|js}` — Migration 文件
- `reports/requirements/` — 开发报告（含 Schema 变更说明）

## 关键约束

- 🔴 禁止在 Migration 中写业务逻辑（纯 DDL + 数据修复）
- 🔴 大表（>100万行）变更必须评估锁时间，提供在线变更方案
- 🔴 数据库、MongoDB 或数据操作连接信息默认可按用户提供内容直写或沿用项目既有模式；只有用户或项目明确指定 `config.local.json`、env、`secretRef` 或 secret manager 时，才从对应入口读取，缺失文件或字段时提醒用户补齐

## Migration 执行后验证（F-13）

Migration 执行完成后须执行以下验证，完成后方可宣告任务完成：

| 验证项 | 操作 | 通过标准 |
|--------|------|---------|
| Schema 一致性 | 对比 ORM 模型与实际表结构 | 列名/类型/约束完全一致 |
| 存量数据可用 | 抽样查询受影响的行 | 无报错，关键字段无 NULL 异常 |
| 索引生效 | EXPLAIN 关键查询 | 新索引被使用，无全表扫描回退 |
| 回滚可用性 | 验证回滚脚本语法（干运行）| 回滚脚本无语法错误 |
