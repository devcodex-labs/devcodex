# PC4 规范雷达流程图

> 本页为 `① 预检查` 阶段中 PC4 节点的专属可视化。  
> PC4（规范原因识别）是 DevCodex 的规范自我升级机制的感知层，**仅 dev 模式生效**；prod 模式跳过全部 PC4 逻辑。  
> 完整规范定义见：`18-spec-radar.instructions.md`

---

## 设计定位

| 对比项 | PC4 规范雷达 | 合规检查（FC/SC） |
|--------|:-----------:|:----------------:|
| 时机 | 任务执行**前/中** | 任务完成**后** |
| 诊断对象 | **规范本身**是否存在缺陷 | AI 是否遵守了规范 |
| 输出 | `record.*` 规范化意图 + PF/VL/GAP 等证据 | 通过 / 不通过 |
| 修复 | 经 RecordRouter 写入对应台账（不立即修复）| 内联修正后重检 |

> 设计原则：**记录在使用，修复在维护**。PC4 只感知并记录，不触发任何修复动作；记录动作由 `spec-governance` 执行意图识别 → RecordRouter 分流，避免把“违规”“规范缺陷”“过程改进”“待排期问题”“审计空白”混写到同一台账。

### RecordRouter 分流口径

| 规范化意图 | 目标台账 |
|------------|----------|
| `record.violation` | `data/violations.md` |
| `record.spec-defect` | `data/pending-fixes.md` |
| `record.process-improvement` | `data/process-improvements.md` |
| `record.pending-issue` | `data/pending-issues.md` |
| `record.audit-gap` | `data/gap-registry.md` |
| `record.none` / `record.ambiguous` | 不写入；先解释或澄清 |

---

## 触发检查点

```mermaid
flowchart LR
    CP1(["检查点 1\n收到新消息时\n每轮必执行"])
    CP2(["检查点 2\n任务执行中发现异常时\n当前回复内立即输出"])
    NOTE["⚠️ G5 仅检查点 2 可评估\n（需意图已知才能对比\nviolations.md 同类型）"]

    CP1 --> PC4["PC4 三轴诊断"]
    CP2 --> PC4
    PC4 --> NOTE
```

---

## 三轴诊断模型总览

PC4 通过三个轴评估交互底层状态，**不依赖关键词匹配**，由轴的诊断结论决定是否触发。

```mermaid
flowchart TD
    ENTRY["开始 PC4 三轴诊断"]

    A_Q{"Axis A\nAI 认知锚点自检\n当前决策有明确\n规范节点支撑？"}
    B_Q{"Axis B\n对话轨迹检测\n话题是否在收敛？"}
    C_Q{"Axis C\n用户预期满足度\n用户是否在补偿\nAI 的规范缺陷？"}

    OK["PC4 ✅ 三轴正常\n无规范问题"]
    DEFERRED["延迟执行（FC 前）\n· PF/VL/GAP → RecordRouter\n· 疑似 → 回复末尾提示"]

    ENTRY --> A_Q
    A_Q -->|"✅ 有规范/已执行"| B_Q
    A_Q -->|"⚠️ 异常"| B_Q

    B_Q -->|"✅ 收敛"| C_Q
    B_Q -->|"⚠️ 异常"| C_Q

    C_Q -->|"✅ 无补偿"| OK
    C_Q -->|"⚠️ 异常"| DEFERRED

    A_Q -.->|"⚠️ 标记 PF/VL"| DEFERRED
    B_Q -.->|"⚠️ 标记 PF"| DEFERRED
```

> ℹ️ **全轴检查原则**：任意轴发现异常后，必须继续检查后续轴（不早退出）。所有标记集中在延迟执行阶段统一追加。

---

## Axis A — AI 认知锚点决策树

```mermaid
flowchart TD
    A_START(["Axis A 认知锚点 入口"])
    A1{"有明确规范节点\n可引用？"}
    A2{"是否已执行\n该规范？"}

    A_OK["Axis A 认知锚点 ✅\n→ 进入 Axis B 对话轨迹"]
    A_VL["标记 VL\n（认知锚点违背——有规范但未执行）\n→ 进入 Axis B 对话轨迹"]
    
    A3{"两条规范\n同时适用且\n方向相反？"}
    A_G1["标记 PF — G1\n认知锚点缺失\n（依赖推断/经验）\n→ 进入 Axis B 对话轨迹"]
    A_G6["标记 PF — G6\n规范内部冲突\n（无法裁决）\n→ 进入 Axis B 对话轨迹"]
    
    A4{"规范依赖的\n外部假设\n是否已失效？"}
    A_G8["标记 PF — G8\n外部假设失效\n（工具版本/API 行为变更）\n→ 进入 Axis B 对话轨迹"]

    A_START --> A1
    A1 -->|"是"| A2
    A1 -->|"否"| A3
    A2 -->|"已执行"| A4
    A2 -->|"未执行"| A_VL
    A3 -->|"是（冲突）"| A_G6
    A3 -->|"否（无规范）"| A_G1
    A4 -->|"未失效"| A_OK
    A4 -->|"已失效"| A_G8
```

---

## Axis B — 对话轨迹决策树

```mermaid
flowchart TD
    B_START(["Axis B 对话轨迹 入口"])
    B_NOTE["⚠️ 以下各项独立并列检测\n多项可同时触发并同时标记 PF\n不因前项命中而跳过后项"]

    B2{"G2：同一话题\n≥ 3 轮仍未达成共识？"}
    B_G2["标记 PF — G2\n对话轨迹循环"]

    B3{"G1：每轮 AI 给出不同解释/方案？\n（非用户要求修改）"}
    B_G1["标记 PF — G1\n答案漂移/不稳定"]

    B4{"G3：问题应在阶段 X 发现\n但在 Y 才暴露？（X 早于 Y）"}
    B_G3["标记 PF — G3\n拦截节点滞后"]

    B5{"G5：⚠️ 仅检查点 2\n当前问题与 violations.md\n已有 VL 同类型？"}
    B_G5["标记 PF — G5\n重复违规（系统性）"]

    B6{"G9：AI 不知何时停止\n或过早宣告完成？"}
    B_G9["标记 PF — G9\n完成边界缺失\n（与 Axis C 用户满足度联合）"]

    B_END(["→ 进入 Axis C 用户满足度\n携带所有已标记的 PF\n（若全否则 Axis B ✅）"])

    B_START --> B_NOTE --> B2
    B2 -->|"是，标记 G2"| B_G2 --> B3
    B2 -->|"否"| B3
    B3 -->|"是，标记 G1"| B_G1 --> B4
    B3 -->|"否"| B4
    B4 -->|"是，标记 G3"| B_G3 --> B5
    B4 -->|"否"| B5
    B5 -->|"是，标记 G5"| B_G5 --> B6
    B5 -->|"否"| B6
    B6 -->|"是，标记 G9"| B_G9 --> B_END
    B6 -->|"否"| B_END
```

---

## Axis C — 用户预期满足度决策树

```mermaid
flowchart TD
    C_START(["Axis C 用户满足度 入口"])

    C1{"用户是否出现\n补偿行为？"}
    C_OK["PC4 ✅ 三轴正常"]

    C2{"放弃子任务\n（'算了我自己做'）\n或重复粘贴\n之前说过的指令？"}
    C_G4_STRONG["标记 PF — G4\n强信号，单次即确认\n→ 延迟追加"]

    C3a{"用户微操 /\n逐步指令 /\n纠正 AI 输出？\n（非主动告知背景）"}
    C3b{"用户补充说明\n项目惯例 / 框架特性 /\n架构约束等\n领域背景？"}

    C4a{"出现次数\n≥ 2 次？"}
    C_G4_CONFIRMED["标记 PF — G4\n用户预期补偿（弱信号）\n≥ 2次已确认 → 延迟追加"]
    C_SUSPECT_G4["⚠️ 疑似 PF — G4\n弱信号待观察\n→ 回复末尾注明"]

    C4b{"出现次数\n≥ 2 次？"}
    C_G7_CONFIRMED["标记 PF — G7\n领域知识缺口（弱信号）\n≥ 2次已确认 → 延迟追加"]
    C_SUSPECT_G7["⚠️ 疑似 PF — G7\n弱信号待观察\n→ 回复末尾注明"]

    C5{"用户给出\n类比 / 举例\n说明期望？\n或'随便/你决定'\n（含放弃意味）？"}
    C5a{"出现次数\n≥ 2 次？"}
    C_SUSPECT_MISC["⚠️ 疑似 PF — G4\n弱信号已确认\n→ 延迟追加"]
    C_SUSPECT_MISC1["⚠️ 疑似 PF\n单次待观察\n→ 回复末尾注明"]

    C6{"用户反复说\n'不够 / 还差一步'？"}
    C_G9["标记 PF — G9\n完成边界缺失\n（与 Axis B 对话轨迹联合）\n→ 延迟追加"]

    C7{"其他补偿\n行为，信号\n模糊？"}
    C_SUSPECT["⚠️ 疑似 PF\n置信度降为疑似\n→ 回复末尾注明待确认"]

    C_START --> C1
    C1 -->|"否"| C_OK
    C1 -->|"是"| C2
    C2 -->|"是（强信号）"| C_G4_STRONG
    C2 -->|"否"| C3a
    C3a -->|"是（弱信号）"| C4a
    C3a -->|"否"| C3b
    C4a -->|"≥ 2 次"| C_G4_CONFIRMED
    C4a -->|"1 次"| C_SUSPECT_G4
    C3b -->|"是（弱信号）"| C4b
    C3b -->|"否"| C5
    C4b -->|"≥ 2 次"| C_G7_CONFIRMED
    C4b -->|"1 次"| C_SUSPECT_G7
    C5 -->|"是"| C5a
    C5a -->|"≥ 2 次"| C_SUSPECT_MISC
    C5a -->|"1 次"| C_SUSPECT_MISC1
    C5 -->|"否"| C6
    C6 -->|"是"| C_G9
    C6 -->|"否"| C7
    C7 -->|"是"| C_SUSPECT
    C7 -->|"否"| C_OK
```

---

## 完整 PC4 决策流程（含前置分支）

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

    AXIS_B{"Axis B：对话轨迹\n以下各条件独立检测"}
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
    C_PF_G9["标记 PF — G9\n用户说'不够/还差'\n（与 Axis B 对话轨迹联合）"]
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

> ℹ️ **Axis A 互斥原则**：AI 对同一决策只能处于一种认知状态，五条出口为互斥选择，每种结果都继续 Axis B。  
> ℹ️ **Axis B 独立触发原则**：六条分支（G2/G1/G3/G5/G9 + 正常）**相互独立，可同时标记**；流程图简化为辐射形展示，完整的逐项独立检测逻辑详见 [Axis B 子图](#axis-b--对话轨迹决策树)。  
> ℹ️ **全轴检查原则**：任意轴发现异常后必须继续检查后续轴（不早退出），所有标记集中在延迟执行阶段统一追加。

---

## 多轴异常优先级规则

当三轴诊断中**多轴同时出现异常**时：

```mermaid
flowchart TD
    MA["多轴异常检测"]
    
    ALL["全部标记\n所有异常轴均须标记\n不可因 Axis A 认知锚点已触发\n而跳过 Axis B/C"]
    ORDER["排列顺序\nAxis A 认知锚点 → Axis B 对话轨迹 → Axis C 用户满足度\n认知锚点问题优先\n用户感知问题在后"]
    ROOT["根因分析\n若 Axis A 认知锚点 有 PF\nAxis B 对话轨迹/Axis C 用户满足度的异常\n通常是其下游表现\n根因聚焦 Axis A 认知锚点"]
    
    OUTPUT["输出格式示例\n→ PF（Axis A, G1）：认知锚点缺失\n→ PF（Axis C, G4）：用户被迫微操\n   （根因可能同 G1）"]

    MA --> ALL --> ORDER --> ROOT --> OUTPUT
```

### 多轴输出格式

```
- PC4 规范雷达：[Axis A ⚠️] [Axis B ✅] [Axis C ⚠️]
  → ⚠️ PF 标记（G1）：AI 依赖推断而非规范节点 · 延迟追加 pending-fixes.md
  → ⚠️ PF 标记（G4）：用户被迫微操补充细节 · 延迟追加（根因可能同 G1）
```

> G 码在同轴内用逗号合并（如 `G1, G6`），跨轴分行显示。

---

## 置信度与处理规则

```mermaid
flowchart TD
    CONF{"置信度判断"}
    
    C_CONFIRMED["✅ 确认\n三轴诊断有明确异常\n+ 规范查证完成\n→ 直接标记 PF 或 VL\n延迟追加"]
    
    C_HIGH["🔶 高\n三轴诊断显示异常\n规范查证进行中\n→ 查规范后定性\n当前回复内完成判断"]
    
    C_SUSPECT["⚠️ 疑似\n一轴显示潜在异常\n证据不足\n→ 标记 ⚠️ 疑似 PF\n回复末尾注明\n'待确认是否存在规范盲区'"]

    CONF -->|明确异常且已查证| C_CONFIRMED
    CONF -->|异常但未完成查证| C_HIGH
    CONF -->|一轴疑似，证据不足| C_SUSPECT
```

---

## 完整触发场景（G1~G11）

| 编号 | 名称 | 触发轴 | 判别阈值 | 典型表现 |
|:----:|------|:------:|:-------:|---------|
| **G1** | 认知锚点缺失 | A / B¹ | 单次即触发 | AI 使用"我认为/可能/视情况"；同类问题跨会话答案不一致；AI 将规范应决定的事抛给用户；需要大段理由论证而非引用规范节点 |
| **G2** | 对话轨迹循环 | B | ≥3 轮未收敛 | 同一话题反复讨论无结论；用户换表达方式 AI 仍无稳定答案 |
| **G3** | 拦截节点滞后 | B | 单次即触发 | 应在 CP1 发现的问题执行阶段才暴露；应在 plan-review 拦截的缺陷在 Audit 才发现；AI 未完成规定前置检查就推进了流程；跨会话恢复后跳过预检查直接执行任务（高频场景）|
| **G4** | 用户预期补偿 | C | 强信号单次；弱信号≥2次 | 用户开始逐步指令；重复粘贴之前说过的话；放弃子任务（"算了我自己做"）|
| **G5** | 重复违规（系统性）| A+B | 单次即触发（⚠️ 仅检查点 2）| 当前问题与 `violations.md` 已有 VL 同类型，表明已有 VL 未转化为规范改进 |
| **G6** | 规范内部冲突 | A | 单次即触发 | 两条规范同时适用且指向不同方向，AI 无法裁决 |
| **G7** | 领域知识缺口 | C | 单次=疑似；≥2次=确认 | 用户在对话中教 AI 项目惯例/框架特性/架构约束 → profile 或规范应覆盖但未包含 |
| **G8** | 外部假设失效 | A | 单次即触发 | AI 严格按规范执行，但工具版本/API 行为等外部环境假设已改变，导致结果异常 |
| **G9** | 完成边界缺失 | B+C | 单次=疑似；≥2次=确认 | AI 不知何时停止（持续追加内容）；AI 过早宣告完成；用户反复说"不够/还差一步" |

> ¹ G1 主触发轴为 Axis A（认知锚点缺失），同时也可由 Axis B 漂移（AI 答案每轮不同）独立触发。

---

## 延迟执行流程

```mermaid
flowchart TD
    PC4_END["PC4 标记完成\n（检测点完成）"]
    
    HAS_MARK{"有 PF / VL\n标记？"}

    NO_MARK["⏭ 跳过延迟追加\nPC4: ✅ 无需写入"]

    HAS_VL{"有 VL 标记？"}
    WRITE_VL["追加到\ndata/violations.md"]

    HAS_PF{"有 PF 标记？"}
    WRITE_PF["追加到\ndata/pending-fixes.md\n（含关联 VL 编号\n如适用）"]

    HAS_SUSPECT{"有疑似 PF？"}
    INLINE_SUSPECT["在回复末尾输出提示\n由用户确认是否追加"]

    DONE["✅ PC4 延迟追加完成\n（VL/PF 已写入，疑似已提示）"]

    FC_BEFORE["延迟触发点\n= FC 执行前"]

    PC4_END --> FC_BEFORE --> HAS_MARK
    HAS_MARK -->|否| NO_MARK
    HAS_MARK -->|是| HAS_VL
    HAS_VL -->|是| WRITE_VL --> HAS_PF
    HAS_VL -->|否| HAS_PF
    HAS_PF -->|是| WRITE_PF --> HAS_SUSPECT
    HAS_PF -->|否| HAS_SUSPECT
    HAS_SUSPECT -->|是| INLINE_SUSPECT --> DONE
    HAS_SUSPECT -->|否| DONE
```

> ⛔ **禁止遗漏**：只要 PC4 标记了 ⚠️（含疑似），任务完成时必须有对应输出；SC4 检查此项。  
> ℹ️ **检查点 2 回溯**：任意 Axis 检测到异常，必须在当前回复中立即完成诊断并输出，不得等待下轮消息。  
> ⛔ **禁止关键词触发**：不得仅因用户用了某个词汇而触发 PC4；必须经三轴诊断确认存在底层状态异常。

---

## 与主流程关系

- 主流程入口见：[主流程图](/specs/flowcharts)
- 预检查主链见：[① 预检查流程图](/specs/precheck-flow)
- 合规检查框架见：[合规检查框架](/specs/compliance-framework)
- 完整规范定义见：`18-spec-radar.instructions.md`（三轴诊断模型 + G1~G11 + 决策流程 + 输出格式）
