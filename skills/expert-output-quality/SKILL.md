---
name: expert-output-quality
description: 专家型产物质量门禁 — 当任务涉及代码、文档、示例、fixture、quick start、技术方案、报告或用户指出“不专业 / 像初级 / 示例误导 / 没有资深架构视角”时使用；要求区分生产推荐路径、框架原生能力、测试夹具边界、反模式与证据矩阵。
---

# Expert Output Quality Skill

## 定位

本 Skill 防止 AI 产物停留在“能跑示例”或“解释 fixture”的初级层面。它要求代码、文档、示例、方案和报告体现技术专家、资深架构师或领域专家视角：先给生产推荐路径，再说明测试夹具、演示代码、兼容路径和反模式的边界。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| 代码、文档、示例、fixture、quick start、README、站点文档、技术方案、报告需要交付给用户或维护者 | 必须 |
| 用户指出“不专业”“像初级”“这不是推荐写法”“示例误导”“怎么又写成开发文档” | 必须 |
| 文档或报告需要解释测试 fixture、demo、mock、兼容路径、历史写法或反模式 | 必须 |
| 框架、SDK、库、运行时、权限、路由、中间件、鉴权、缓存、事务、队列、ORM、UI 组件等存在原生能力 | 必须 |
| 纯内部临时草稿、只读事实查询、无需产物沉淀的短问答 | N/A + skipReason |

## 核心门禁

| Gate | 要求 | 证据 |
|------|------|------|
| `ExpertOutputQualityGate` | 输出必须体现对应角色的专业判断，不只复述代码或示例现象 | 角色定位、推荐路径、风险和取舍 |
| `ExpertRoleBaselineGate` | 根据任务选择技术专家 / 资深架构师 / 领域专家 / 产品化文档作者视角 | 角色与受众说明 |
| `ProductionRecommendedPathGate` | 先写生产推荐路径，再写测试、demo、fixture、兼容或历史路径 | recommendedPath / nonRecommendedPath |
| `FrameworkNativeCapabilityFirstGate` | 先检查框架、SDK、平台或项目现有能力，避免手写重复机制 | official / repo-local / runtime evidence |
| `FixtureBoundaryDisclosureGate` | fixture、mock、样例配置、硬编码单例必须标明不是生产主路径 | fixtureBoundary、allowedUse、forbiddenUse |
| `ExampleArchitectureFitnessGate` | 示例要符合项目推荐架构，避免在 route、controller、UI 或测试里重复声明框架已承载的资源配置 | architectureFit、consumerImpact |
| `AntiPatternContrastGate` | 必要时列出“错误写法 / 为什么错 / 正确写法”，但不把反模式放成主路径 | antiPattern、replacement |
| `ExpertEvidenceMatrixGate` | 关键建议必须绑定代码、类型、官方文档、运行时、测试、构建或用户路径证据 | evidenceMatrix |

## 执行步骤

1. 判断产物类型和目标受众：用户、维护者、调用方、审核人或发布方。
2. 选择角色基线：技术专家、资深架构师、领域专家或用户文档作者。
3. 先反查项目和框架：已有 helper、middleware、plugin、types、schema、runtime dispatcher、配置系统、文档约定和官方 API。
4. 给出生产推荐路径：职责边界、使用方式、扩展点、失败处理、验证路线和维护成本。
5. 再标注非主路径：fixture / mock / demo / legacy / compat 的用途、风险和禁止外推范围。
6. 对容易误导的示例追加反模式对比：错误写法、为何不推荐、正确替代、如何迁移。
7. 建立 `ExpertEvidenceMatrixGate`：每个关键判断绑定至少一种事实证据；无法验证时写 `unknown / blocked / N/A + skipReason`。
8. 报告或复审中发现产物仍像初级解释时，先执行 `ReviewEscapeRecordGate`，说明此前清单为什么没有覆盖专业度维度，再补本 Skill 重跑。

## 输出字段

```markdown
## ExpertOutputQualityGate

| 字段 | 内容 |
|------|------|
| roleBaseline | 技术专家 / 资深架构师 / 领域专家 / 用户文档作者 / N/A |
| productionRecommendedPath | 生产推荐写法、职责边界和使用入口 |
| frameworkNativeCapability | 框架 / SDK / 项目既有能力证据；无则写 N/A + skipReason |
| fixtureBoundary | fixture / mock / demo / hard-coded sample 的用途与禁止外推范围 |
| exampleArchitectureFitness | 示例是否符合推荐架构；不符合时给替代示例 |
| antiPatternContrast | 错误写法、风险、替代方案；不需要时写 N/A |
| evidenceMatrix | 判断 -> 代码/类型/官方文档/测试/运行时/用户路径证据 |
```

## 常见修正

| 初级产物问题 | 专家型改法 |
|--------------|------------|
| “fixture 每个 route 都重复 middlewares，所以说明可用” | 说明 fixture 只证明底层 `RouteOptions.auth` 存在；生产推荐使用认证插件集中注册、资源 mapper 或 route group / preset helper，route 只保留最小业务声明 |
| 示例把硬编码单例当主路径 | 标为 smoke / demo，并给真实批量、配置化或生命周期完整的主路径 |
| 文档只解释内部实现字段 | 先写用户任务、配置选择、成功/失败路径，再把内部字段放到 developer / maintainer 章节 |
| 报告只说“已验证通过” | 写命令、输入、输出、exitCode、代码落点和残余风险 |
| 手写框架已有能力 | 先列框架原生能力和项目既有 helper；仅在有缺口时新增抽象 |

## 与其他 Skill 的关系

- `dev-docs` / `user-manual-authoring`：文档和用户手册需要本 Skill 检查示例、推荐路径和内部实现边界。
- `dev-plan-review`：CP2 中涉及架构、框架能力、示例或 fixture 时，本 Skill 是 PR-2 阻断项。
- `audit-project` / `audit-document` / `audit-readme` / `audit-user-manual`：审查代码、文档、README 或用户手册时叠加本 Skill。
- `test-router`：把 `expertOutputQuality` 写入 TestRoute，并选择源码反查、类型检查、官方文档、运行时探针或人工证据。
- `report`：报告必须列 `ExpertOutputQualityGate` 结果；若未触发写 `N/A + skipReason`。

## 禁止

- 禁止把 fixture、mock、硬编码样例、单例 smoke 或重复声明当成生产推荐路径。
- 禁止只说“不推荐”但不给框架原生能力、项目既有能力或推荐替代。
- 禁止只按审查报告、历史记忆或截图文字下结论；关键判断必须有本地或官方证据。
- 禁止为了“显得专业”过度设计；新增抽象仍需真实消费者、维护收益和项目边界依据。
