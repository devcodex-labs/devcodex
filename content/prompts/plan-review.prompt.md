---
agent: agent
description: CP1/CP2 确认后的独立方案复审模板，用于形成唯一 PR1 正式复审产物
applyTo: .devcodex/**/{requirements,bugs,optimizations,scenario-tests}/**
artifactTemplateId: plan-review
artifactTemplateContractVersion: "1"
artifactRequiredHeadings: 审查范围 | 需求与方案映射 | 代码实况 | 阻断项快照 | 复核结论
artifactExtensionHeadings: 专项审查维度 | 证据附录
artifactExtensionPolicy: additive
---
# 方案复审模板

> **路径**：`.devcodex/**/{requirements,bugs,optimizations,scenario-tests}/<任务>/03-方案复审-PR1.md`
> **触发**：CP1/CP2 已确认后，确认后复审或实施前独立复核判定需要正式 PR1 产物。
> **定位**：PR1 只复核“已确认需求—技术方案—代码实况—实施入口”是否一致，不改写 CP1/CP2，也不把报告目录中的审查意见复制成第二真相源。
> **阅读原则**：正文优先服务人类决策；摘要、digest、探针明细等机器证据放入表格或附录，不占据开头结论。
> **扩展原则**：可新增专项审查维度和证据附录，但不得删除、替换或打乱五个必需语义章节。

```markdown
# [任务名称] — 方案复审 PR1

> **复审等级**：R1 / R2 / R3 / R4
> **候选版本**：[CP1/CP2/CP3 版本]
> **源码基线**：[commit]
> **状态**：通过 / 需修订 / 阻断

## 审查范围

说明本轮复核的需求、方案、源码、消费者和明确排除项。

## 需求与方案映射

| 需求锚点 | 方案落点 | 实施入口 | 验证证据 | 结论 |
|---|---|---|---|---|

## 代码实况

记录实际 owner、调用链、共享契约、消费者和与文档不一致之处；未知项明确标为 `UNVERIFIED`。

## 阻断项快照

| blockerId | 影响面 | 证据 | 处置 | 状态 |
|---|---|---|---|---|

无阻断项时写“无已知阻断项”，不得写成“绝无缺陷”。

## 复核结论

先给出是否可进入下一阶段，再列必须修订项、非阻断建议和剩余风险。

## 专项审查维度（扩展）

按真实触发补充 API、Schema、安全、CLI、模板链、宿主、包边界或发布维度；未触发时可省略。

## 证据附录（扩展）

记录命令、exitCode、摘要和可复现路径；不要把整段机器 JSON 放进正文。
```

## 写入与资格规则

- 写入前读取本模板真实字节并形成 `ArtifactTemplateBindingV1`；绑定必须指向 `plan-review` slot 和唯一目标。
- 写入后重新读取本模板与目标文件，校验 template digest、五个必需语义、依赖顺序和 additive extension。
- 缺模板、错模板、摘要过期、错 slot、缺章节、章节乱序或未读回时，PR1 只能保持 draft/rejected，不能作为正式确认或完成证据。
- 历史审查报告不回填绑定；只有新建或实质修改的正式 PR1 使用本模板。
