# ① 预检查流程图

> 本页聚焦主流程中的 `① 预检查` 阶段。  
> 入口检查是每次收到消息后必须经过的前置闸门；所有模式输出 PC0~PC7，dev 模式额外执行 PC4 完整规范雷达与后置合规链。

---

## 预检查主链

```mermaid
flowchart TD
    START(["收到用户消息"])
    READ_RULES["PC0: 读取规则基线\n确认 profile + 输出语言"]
    INTENT["PC1: 语义意图初判\n→ 待项目现实扩展"]
    SESSION["PC2: 会话状态\n轮次 / 待跟进"]
    REALITY["项目现实扩展\nProfile / 技术栈 / 范围 / 验证方式\nIntent Expansion Card"]
    PREP["PC3: 执行准备\n扩展结果 / 未完成任务 / 产物落点"]
    DEV_MODE{"ENV_MODE\n= dev?"}
    PC4["PC4: 规范雷达\n三轴诊断（见细图）"]
    PC5["PC5: 部署体状态\n父链 .claude/.github 同步"]
    PC6["PC6: 工作区一致性\ngit dirty / 当前需求目录"]
    PC7["PC7: 新会话 resume 检测\ntasks + SUMMARY 一致性"]
    MARK["⚠️ 标记 PF/VL\n延迟追加文件"]
    NEXT["进入后续主流程"]

    START --> READ_RULES --> INTENT --> SESSION --> REALITY --> PREP --> DEV_MODE
    DEV_MODE -->|prod| PC5
    DEV_MODE -->|dev| PC4
    PC4 -->|"✅ 三轴正常"| PC5
    PC4 -->|"⚠️ 异常"| MARK --> PC5
    PC5 --> PC6 --> PC7 --> NEXT
```

> ℹ️ **检查点 2（任务执行中）**：若任务执行中任意 Axis 检测到异常，在当前回复中立即完成 PC4 诊断并输出，不等待下轮消息。  
> PC4 内部决策细节见下方细图及专属页面；完整规范见 `18-spec-radar.instructions.md`。

---

## 入口检查阶段输出

预检查阶段结束时，至少应产出以下基础信息：

1. **PC0** — 当前会话适用的规则基线 + profile 加载状态 + 输出语言
2. **PC1** — 语义初判与项目现实扩展后的最终路由
3. **PC2** — 会话状态（轮次 / 待跟进）
4. **PC3** — 执行准备状态（项目现实扩展结果 / 未完成任务 / 产物落点）
5. **PC4** — 规范原因识别结果：dev 模式输出 ✅ 无 / ⚠️ PF 标记 / VL 标记；非 dev 模式标注 N/A
6. **PC5** — 部署体状态：父链 `.claude/.github/` 是否存在、是否与源仓库关键文件同步
7. **PC6** — 工作区一致性：git 未提交变更、当前需求目录或任务上下文
8. **PC7** — 新会话 resume 强制检测：今日/昨日 tasks 文件与 SUMMARY 状态是否一致

非 chat 工作流在 CP1 / 问题确认前还应形成 Intent Expansion Card，最小字段包括：`semantic`、`project`、`continuity`、`action`、`domain`、`artifact-impact`、`risk`、`host-capability`、`validation-route`、`confidence`、`alternatives`。

---

## PC4 规范原因识别决策细图

PC4 采用**三轴诊断模型**，不依赖关键词匹配，通过评估交互底层状态来判断是否存在规范缺陷。

```mermaid
flowchart TD
    ENTRY_A(["检查点 1：收到新消息（每轮执行）"])
    ENTRY_B(["检查点 2：任务执行中发现异常\n→ 当前回复内立即输出诊断"])
    
    EXPLICIT{"用户明确要求\n记录违规/登记问题？"}
    T_RECORD["Intent Detection → RecordRouter\n按 record.* 写入对应台账\nT_RECORD 分支（不延迟）"]

    AXIS_A{"Axis A：AI 认知锚点\n当前决策有明确规范支撑？"}
    A_NORMAL["Axis A 认知锚点 ✅\n→ 继续 Axis B 对话轨迹"]
    A_VL["标记 VL（执行偏差）\n→ 继续 Axis B 对话轨迹"]
    A_PF_G1["标记 PF — G1\n认知锚点缺失\n→ 继续 Axis B 对话轨迹"]
    A_PF_G6["标记 PF — G6\n规范冲突\n→ 继续 Axis B 对话轨迹"]
    A_PF_G8["标记 PF — G8\n外部假设失效\n→ 继续 Axis B 对话轨迹"]

    AXIS_B{"Axis B：对话轨迹\n话题是否在收敛？"}
    B_NORMAL["Axis B 对话轨迹 ✅\n→ 继续 Axis C 用户满足度"]
    B_PF_G2["标记 PF — G2\n循环（≥3轮）\n→ 继续 Axis C 用户满足度"]
    B_PF_G1["标记 PF — G1\n答案漂移\n→ 继续 Axis C 用户满足度"]
    B_PF_G3["标记 PF — G3\n拦截滞后\n→ 继续 Axis C 用户满足度"]
    B_PF_G5["标记 PF — G5\n重复违规\n⚠️ 仅检查点 2\n→ 继续 Axis C 用户满足度"]
    B_PF_G9["标记 PF — G9\n完成边界缺失\n→ 继续 Axis C 用户满足度"]

    AXIS_C{"Axis C：用户预期满足度\n用户是否在补偿 AI 的规范缺陷？"}
    C_OK["PC4 ✅ 三轴正常"]
    C_PF_STRONG["标记 PF — G4\n放弃/重复粘贴\n（单次即确认）"]
    C_PF_WEAK["标记 PF — G4/G7\n微操/纠正/补充背景\n（单次=疑似；≥2次=确认）"]
    C_PF_G9["标记 PF — G9\n用户表示不够/还差\n（与 Axis B 对话轨迹联合）"]
    C_SUSPECT["⚠️ 疑似 PF\n待确认"]

    DEFERRED["延迟执行（FC 前）\nPF/VL/GAP → RecordRouter\n疑似 → 回复末尾提示"]

    ENTRY_A --> EXPLICIT
    ENTRY_B --> EXPLICIT

    EXPLICIT -->|是| T_RECORD
    EXPLICIT -->|否| AXIS_A

    AXIS_A -->|有规范/已执行| A_NORMAL --> AXIS_B
    AXIS_A -->|有规范/未执行| A_VL --> AXIS_B
    AXIS_A -->|无规范/推断| A_PF_G1 --> AXIS_B
    AXIS_A -->|两规范冲突| A_PF_G6 --> AXIS_B
    AXIS_A -->|外部假设失效| A_PF_G8 --> AXIS_B

    AXIS_B -->|收敛| B_NORMAL --> AXIS_C
    AXIS_B -->|循环| B_PF_G2 --> AXIS_C
    AXIS_B -->|漂移| B_PF_G1 --> AXIS_C
    AXIS_B -->|滞后| B_PF_G3 --> AXIS_C
    AXIS_B -->|重复违规| B_PF_G5 --> AXIS_C
    AXIS_B -->|边界缺失| B_PF_G9 --> AXIS_C

    AXIS_C -->|无补偿| C_OK
    AXIS_C -->|强信号| C_PF_STRONG --> DEFERRED
    AXIS_C -->|弱信号| C_PF_WEAK --> DEFERRED
    AXIS_C -->|不够/还差| C_PF_G9 --> DEFERRED
    AXIS_C -->|模糊| C_SUSPECT --> DEFERRED

    A_VL --> DEFERRED
    A_PF_G1 --> DEFERRED
    A_PF_G6 --> DEFERRED
    A_PF_G8 --> DEFERRED
    B_PF_G2 --> DEFERRED
    B_PF_G1 --> DEFERRED
    B_PF_G3 --> DEFERRED
    B_PF_G5 --> DEFERRED
    B_PF_G9 --> DEFERRED
```

> ℹ️ **全轴检查原则**：任意轴发现异常后必须继续检查后续轴（不早退出），所有标记集中在延迟执行阶段统一追加。

### 完整触发场景（9 类，按机制分组）

| 分组 | 触发轴 | 场景描述 |
|------|:------:|---------|
| **G1** 认知锚点缺失 | A | AI 使用推断性语言（"我认为"/"可能"/"视情况"）而非引用规范；AI 将本应由规范决定的事交给用户选择；同类问题跨会话答案不一致 |
| **G2** 轨迹循环 | B | 同一话题 ≥3 轮未收敛；用户换了表达方式但实质未变，AI 仍无稳定答案 |
| **G3** 拦截节点滞后 | B | 应在 CP1 发现的问题在执行阶段才暴露；应在 plan-review 拦截的设计缺陷在 Audit 才发现；AI 未完成规定前置检查就推进了流程；跨会话恢复后跳过预检查直接执行任务（高频场景）|
| **G4** 用户预期补偿 | C | 用户开始提供逐步指令；用户复制粘贴之前说过的话；用户放弃子任务（"算了我自己做"）|
| **G5** 重复违规 | A+B | 当前问题与 violations.md 已有 VL 同类型 → 已有 VL 未转化为规范改进 ⚠️ **仅检查点 2 可评估** |
| **G6** 规范内部冲突 | A | 两条规范同时适用且指向不同方向，AI 无法裁决 |
| **G7** 领域知识缺口 | C | 用户在对话中教 AI 项目惯例/框架特性/架构约束 → profile 或规范应覆盖但未包含 |
| **G8** 外部假设失效 | A | AI 严格按规范执行，但基于的外部环境假设（工具版本/API 行为）已改变，导致结果异常 |
| **G9** 完成边界缺失 | B+C | AI 不知何时停止（持续追加内容）；AI 过早宣告完成；用户反复说"还差一步/不够"；规范缺少该类任务的完成判定标准 |

---

## 与主流程关系

- 主流程入口见：[主流程图](/specs/flowcharts)
- 合规语义见：[合规检查框架](/specs/compliance-framework)
- 前置状态汇总见：[前置状态汇总流程图](/specs/pre-state-summary-flow)
- **PC4 规范雷达专属流程图见：[PC4 规范雷达流程图](/specs/spec-radar-flow)**（三轴决策树 + G1~G11 + 多轴优先级 + 置信度 + 延迟执行）
- PC4 完整规范见：`18-spec-radar.instructions.md`（三轴诊断模型 + G1~G11 + 决策流程）

> 约束：入口检查是所有模式必经阶段，不可跳过；PC5~PC7 为基础状态，PC4 完整三轴诊断仅在 dev 模式启用，非 dev 模式标注 N/A。
