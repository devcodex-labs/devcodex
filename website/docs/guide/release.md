# 版本与发布

---

## 版本规则

| 类型 | 触发条件 | 处理方式 |
|------|---------|---------|
| **MAJOR** | 架构性重构、破坏性变更（如存储层替换）| 新建 `versions/vX/` 系列目录，并创建首个快照 `versions/vX/X.Y.Z/` |
| **MINOR** | 同一大版本下出现需求/流程级演进 | 在对应 major 下新增快照（如 `versions/v1/1.1.0/`），继承并迭代上一版文档 |
| **PATCH** | Bug 修复、文档修正、规范微调 | 需求文档默认在当前快照内修正并更新需求级 CHANGELOG；实现变更默认写 `changelogs/unreleased.md`，只有正式发版时才归档为 `vX.Y.Z` |

> 采用 `major/minor` 两级结构的原因：一个大版本下通常会有多次小版本迭代，提前分层能避免后续整体搬目录。

---

## CHANGELOG 写入规范

**文件位置**：`website/docs/versions/v1/<active-version>/CHANGELOG.md`（当前为 `website/docs/versions/v1/1.0.1/CHANGELOG.md`）

### 写入时机

| 触发事件 | 谁来写 |
|---------|-------|
| 新建需求（首次定义）| 创建该需求的 AI 或开发者 |
| 需求完成开发 | 完成该需求的 AI 或开发者 |
| 需求定义发生变更 | 变更发起人 |
| 修复影响需求文档的 Bug | 修复者 |

> ⛔ AI 在上述事件发生后，**必须**在本次会话结束前写入 CHANGELOG，不得遗漏。

### 格式

```markdown
## YYYY-MM-DD

- **[需求名]** 简述变更内容
```

示例：
```markdown
## 2026-04-04

- **[Agent 双模式]** 初始需求定义，切换方式改为双 Agent 入口（D-001）
- **[存储规范]** 初始需求定义，确立双根目录原则
```

### 原则

- 只记录需求级变更，不记录 sidebar 调整、样式修改等工程变更
- 每条变更一行，简洁描述，不超过 40 字
- **倒序排列**：最新日期在最上方
- 同一天多条变更合并为一个 `## YYYY-MM-DD` 块

---

## 实现变更与正式发版

DevCodex 采用“双阶段发布 + 三层日志”：

1. **需求轨**：`website/docs/versions/v1/<active-version>/CHANGELOG.md`
   - 只记录需求/规格变更
2. **未发布实现轨**：`changelogs/unreleased.md`
   - 记录尚未正式发版的实现/修复/规范调整
3. **已发布轨**：根 `CHANGELOG.md` + `changelogs/vX.Y.Z.md`
   - 只记录真正已经发布的版本

### 默认规则

- 用户**未明确要求** `tag` / `release` / `publish` 时：
  - 每完成一个**已验证的语义变更批次**，默认更新 `changelogs/unreleased.md`
  - 默认建议执行**本地 `commit`** 作为回滚锚点
  - 不默认 bump version
  - 不默认更新根 `CHANGELOG.md`
  - 不默认 `push`
  - 不默认打 tag 或 publish
- 默认 `commit` 按**语义批次**而不是按“问题个数”切分；它是本地回滚锚点，不等于正式发版动作
- 仅在用户明确要求、需要独立回滚点或当前批次已闭环时，才把该建议转成实际本地提交
- 用户**明确确认发版**时：
  1. 确认最终版本号
  2. 从 `changelogs/unreleased.md` 归档到 `changelogs/vX.Y.Z.md`
  3. 更新根 `CHANGELOG.md`
  4. 更新 `package.json` / `plugin.json`
  5. 执行 ReleaseVerification R0~R7
  6. commit / tag / publish

> 旧日志不要求迁移；本规则只约束新变更。

---

## 发布前检查清单

> 发布当前版本前，以下项目必须全部完成。

优先查看当前活动版本的 `release/checklist`；若当前版本尚未建立发布清单，可参考基线快照：[v1.0.0 发布前检查清单](/versions/v1/1.0.0/release/checklist)。

发布时额外执行：
1. `config.json` 中 `mode` 从 `"dev"` 改为 `"prod"`
2. 确认 `.gitignore` 包含 `.devcodex/.memory/`
3. 将 `changelogs/unreleased.md` 中待发布条目归档到 `changelogs/vX.Y.Z.md`
4. 更新根 `CHANGELOG.md`
5. 更新 `package.json` version 字段为正式版本号
6. 按 `release-verification` Skill 执行 R0~R7：dirty 边界、版本一致性、changelog 归档、validate/test、pack/publish dry-run、tag/publish、发布后验收
