# 通用规范

> 本页是「预检查流程图」的下级说明，聚焦步骤④：读取 `specs/common.md`。

---

## 作用

`specs/common.md` 定义通用执行机制，包括 NODE_META 解释、规范加载顺序、降级规则与优先级体系。

---

## 读取要求

1. 必须在 `specs/safety.md` 成功后读取 `specs/common.md`。  
2. 必须遵循规范文件读取顺序：租户优先 → 默认规范 → fallback。  
3. 预检查强制文件（`RULES.md` / `safety.md` / `common.md`）不走租户覆盖。  

---

## 核心约束（摘要）

1. `fetch=true` 的节点必须读取对应 spec（不存在则降级）。  
2. 节点规范冲突时，遵循优先级合并（P1 > profile > P3 > P4 > P5）。  
3. 不得自行跳过节点或裁剪必执行规则。  

---

## 输出要求

读取本文件后，至少应明确：

1. 通用规范加载状态。  
2. 后续节点规范读取与降级策略。  
3. 优先级合并规则是否可执行。  

---

## 关联页面

- 上级： [预检查流程图](/specs/precheck-flow)
- 并列： [核心规则规范说明](/specs/precheck-core-rules-spec)
- 并列： [安全底线规范说明](/specs/precheck-safety-baseline-spec)
