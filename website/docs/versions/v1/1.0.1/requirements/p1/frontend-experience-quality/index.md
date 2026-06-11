# 前端体验质量门禁

> **状态**: ✅ 已实现  
> **优先级**: P1  
> **适用版本**: v1.0.1 活动需求线  
> **关联规则**: `FrontendExperienceQualityGate`、`CrossProjectLearnedGuards`

## 目录导航

- [目标](#目标)
- [触发条件](#触发条件)
- [UI 视觉门禁](#ui-视觉门禁)
- [UX 交互门禁](#ux-交互门禁)
- [跨项目已吸纳守门](#跨项目已吸纳守门)
- [验证要求](#验证要求)

## 目标

前端页面、组件、控制台、官网、文档站、可视化工具、游戏或其他用户可见 UI / 交互任务，不能只停留在功能是否能跑。DevCodex 需要在需求、方案、测试路线和复审中同步检查视觉还原、风格主题、交互流程、反馈、可访问性、错误恢复和动效边界。

## 触发条件

命中以下任一场景时，CP1/CP2/TestRoute 必须判定 `FrontendExperienceQualityGate`：

- 新建或修改前端页面、组件、仪表盘、官网、文档站、可视化工具或游戏界面。
- 需求涉及用户流、点击、输入、导航、拖拽、确认、撤销、错误提示、状态反馈或动效转场。
- 审查发现 UI 还原度、主题一致性、响应式状态、交互反馈或可访问性风险。

纯后端、纯 CLI、纯文档或无用户可见界面的任务写 `N/A + skipReason`。

## UI 视觉门禁

| 门禁 | 要求 |
|------|------|
| `FrontendDesignSourceGate` | 明确设计来源：设计稿、截图、Figma、既有页面、设计系统、品牌主题或领域推导 |
| `UIFidelityGate` | 有参考时尽量还原布局、间距、层级、字体、颜色、状态、图标和关键资产；偏离必须说明 |
| `StyleThemeConsistencyGate` | 沿用项目既有设计系统、主题 token、颜色语义、组件库和图标体系 |
| `ResponsiveStateCoverageGate` | 覆盖桌面/移动、关键断点、主题模式、loading/empty/error/disabled/hover/focus 等状态 |
| `VisualVerificationGate` | UI 变更后用 Browser/Playwright/截图或项目等价方式留证；无法运行时记录阻塞与降级证据 |

## UX 交互门禁

| 门禁 | 要求 |
|------|------|
| `InteractionFlowGate` | 识别核心用户流、入口/出口、主次行动、导航、返回、取消、撤销和任务完成路径 |
| `InteractionFeedbackGate` | 关键控件、异步行为和结果状态具备即时、可感知且不过度打扰的反馈 |
| `InputModalityAccessibilityGate` | 按场景覆盖键盘、鼠标、触摸、焦点可见、目标尺寸、拖拽/手势替代 |
| `ErrorPreventionRecoveryGate` | 高成本、破坏性或易误操作路径具备预防、确认、撤销/恢复和可理解错误提示 |
| `MotionTransitionUsabilityGate` | 动效解释状态变化、空间关系和连续性，保持克制、稳定并尊重减弱动态设置 |

## 跨项目已吸纳守门

本需求同时吸纳 data 目录中已验证值得沉淀的八条泛化守门：

| 守门 | 要求 |
|------|------|
| `CodeTruthRequirementGate` | 写接入状态前先核对代码真相源、消费者入口和运行证据 |
| `ManualReviewEvidenceRetention` | 人工复核、视觉检查、手工冒烟或外部页面观察必须保留范围、输入、观察结果和截图/日志 |
| `DocumentationTranslationParityGuard` | 多语言文档、翻译页、README/website 同步页需核对信息等价、版本号、链接、示例、术语和顺序 |
| `FormalDocsDevCodexBoundary` | 正式用户文档与运行时报告、台账、临时分析保持边界 |
| `LLMPromptContractTriage` | prompt、Agent、Hook、MCP 契约区分人读说明、模型指令、结构化字段和宿主能力 |
| `VerificationScopeBudgetGate` | 验证强度匹配风险，避免高风险低配或低风险过度验证 |
| `LiveVerificationExecutionObligation` | 声明已验证、可运行、可点击、已安装或已发布前必须真实执行对应验证 |
| `AdapterBenchmarkAttribution` | adapter、provider、connector、SDK 或 benchmark 需记录基线、环境、版本、负载和归因边界 |

## 验证要求

- `test-router` 输出 `frontendExperience`、`manualReviewEvidence` 与 `verificationScopeBudget`。
- 命中前端体验风险时，不得只运行构建或单测；需要 Browser/截图、Playwright/E2E 或人工复核等项目等价证据。
- 命中组件生命周期、监听器、订阅、worker、定时器、缓存或长运行可视化状态时，同时判定 `LeakRiskStabilityPressureTest`。
- 规范源、Skill、模板、README、website、validate 和部署副本变更后执行 SCV，并由新增 V61 探针守住同步链。
