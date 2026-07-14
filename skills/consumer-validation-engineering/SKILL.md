---
name: consumer-validation-engineering
description: 跨仓消费者验证工程 Owner — 当任务涉及独立 consumer/verification repository、SDK/CLI/框架/公共包的跨仓完整验证、源码 link 与 packed artifact 一致性、多分母 100% 声明、跨仓 CI、新鲜度或漂移治理时使用；要求冻结可复现身份链、分别计算适用分母，并以真实安装和跨仓运行证据约束发布。
---

# Consumer Validation Engineering

## 定位

本 Skill 负责“主仓变更是否被真实消费者以可复现方式验证”的完整证据链。它不把 dependency spec、realpath、单次 link smoke、功能清单数量或单一通过率当作跨仓闭环，而是同时管理仓库绑定、源码/制品身份、多分母验证、跨仓 CI、新鲜度和发布阻断。

## 触发条件

| 场景 | 是否触发 |
|---|:---:|
| 为 SDK、CLI、框架、插件或公共包建立独立 consumer/test/verification repository | 必须 |
| 声称“跨仓完整验证”“全场景 100%”“消费者仓已覆盖全部功能” | 必须 |
| 同时存在源码 link、workspace/file dependency、tarball、registry install 或 ignored dist | 必须 |
| 主仓 push/PR/release 需要触发消费者仓 CI，或需要定时漂移检测 | 必须 |
| 仅在同一仓库内执行单元测试且无外部消费者边界 | N/A + skipReason |

## ConsumerValidationEngineeringGate

| 字段 | 要求 |
|---|---|
| repositoryBinding | 主仓、消费者仓、origin、目标 branch、责任人、发布关系和支持矩阵 |
| sourceConsumerIdentity | run 前后冻结两仓 commit、dirty/diff hash、版本、构建与依赖解析身份 |
| artifactFreshness | 源码、dist、tarball、registry artifact 的生成时间、内容 hash 和来源 commit 可追溯 |
| dependencyResolution | dependency spec、realpath、lockfile hash/hygiene 与 CI checkout 目录拓扑一致 |
| packedArtifactIdentity | tarball checksum、pack list、安装路径、公开 API/CLI/Skill/adapter smoke |
| validationDenominators | 功能、场景、adapter/环境、影响变更、性能适用项、发布门禁分别计算 |
| crossRepositoryCI | `CrossRepoCI`：source push/PR/release dispatch、consumer workflow/run、目标 SHA 和结果可关联 |
| freshnessDrift | before/after identity 复核、定时漂移、证据保留、过期阈值和失效处理 |
| evidenceState | `not-started / partial / accepted / rejected / stale`，每个分母独立记录 |
| releaseDecision | 只有全部适用分母 accepted 且身份链新鲜，才允许 complete/100% 或 release-ready 声明 |

## 多分母完整性规则

| denominator | 最低内容 | 禁止替代证据 |
|---|---|---|
| feature | public exports、CLI commands、配置、文档能力与内部能力归类 | README 条目数 |
| scenario | happy/error/retry/timeout/compatibility/upgrade 适用场景 | 单元测试总数 |
| adapterEnvironment | runtime、OS、Node/runtime version、provider/adapter 适用组合 | 默认脚手架成功 |
| changeImpact | 本次 diff 影响的功能、消费者、迁移和回归集合 | 全量套件名称 |
| performance | 每功能适用性与每模块 workload/budget/baseline/candidate/capacity/resource/recovery | 单一 benchmark gate |
| releaseGate | pack/install、public surface、CI、文档、回滚、registry/postcheck | 本地 link smoke |

任何适用分母不是 100% accepted 时，总结只能是 `partial`；N/A 必须有适用性依据，skip/flake 必须进入治理分母，不能从统计中静默删除。

## 可复现身份链

正式 run 至少记录：

1. 两仓 origin、branch、commit、dirty state 与 diff hash。
2. package version、源码 package hash、构建命令、dist hash；dist 被 ignore 时仍必须单独冻结。
3. dependency spec、resolved realpath、lockfile hash，以及无关兄弟仓/绝对路径残留检查。
4. tarball checksum、pack manifest、fresh install 路径和 registry metadata（若命中）。
5. source event、consumer CI event/run、checkout topology、目标 commit 与最终 conclusion。
6. run 结束时重新采集 1~5；任一身份变化而未重跑即标 `stale`。

## 执行流程

1. 冻结 `ConsumerRepositoryBinding`，明确哪个仓是 source of truth、哪个仓提供独立复证。
2. 建立 `SourceConsumerIdentitySnapshot`，先验证工作区/CI 能按依赖声明重建目录拓扑。
3. 生成 `ValidationDenominatorMatrix`，逐项记录 total/applicable/executed/accepted/skipped/failed/stale。
4. 先跑 source link/workspace 验证，再 pack tarball fresh install；两条路线不能互相替代。
5. 运行影响场景、全量回归、适用性能与发布门禁，保存原生命令退出码和制品 hash。
6. 关联跨仓 CI event/run；主仓没有真实触发链时不得宣称持续验证。
7. 执行 before/after drift 复核，更新 evidenceState 和 releaseDecision。
8. 将主仓、消费者仓、报告、CI、制品和 registry 证据写入可追踪矩阵。

## 输出契约

```markdown
## ConsumerValidationEngineeringGate

| 字段 | 内容 |
|---|---|
| repositoryBinding | source/consumer origins, branches, owners |
| sourceConsumerIdentity | commits, dirty/diff hashes, versions |
| artifactFreshness | source/dist/tarball/registry hashes |
| dependencyResolution | spec, realpath, lock hygiene, checkout topology |
| validationDenominators | denominator -> total/applicable/accepted/failed/skipped/stale |
| crossRepositoryCI | source event -> consumer run -> target SHA -> conclusion |
| evidenceFreshness | capturedAt, expiresAt, before/after drift |
| releaseDecision | not-started/partial/accepted/rejected/stale |
| evidenceMatrix | claim -> source -> command/run -> artifact -> consumer |
```

## 生命周期与有效性

本 Skill 初始状态为 `gray`。只有在至少两个独立项目或三个可比较工作单元中证明：身份漂移被提前捕获、多分母假 100% 被阻断、发布后消费者逃逸率下降，且没有通过减少适用分母刷指标，才可进入 active review。晋级、回滚和 sunset 由 `skill-lifecycle-governance` 与 `evolution-governance` 决定。

## 反模式

| 反模式 | 修正 |
|---|---|
| realpath 正确就声称跨仓关联完成 | 补两仓 identity、artifact、lock、CI event/run 和 before/after drift |
| 功能清单 100% 就声称验证 100% | 独立计算功能、场景、组合、影响、性能和发布分母 |
| link 成功替代 packed install | 两条路线都执行，并比较公开表面与制品 hash |
| CI 名称存在就声称持续验证 | 证明 source event 实际触发 consumer run 且目标 SHA 一致 |
| 把 skip/N/A/flake 从分母删除 | 记录适用性、原因、owner、期限与重试/阻断状态 |
| 运行中 source 或 dist 改变仍沿用结果 | 标 stale，冻结新 identity 后重跑 |

## 与其他 Skill 的关系

- `source-consumer-sync`：维护真相源与当前消费者图；本 Skill 负责外部消费者仓的可执行复证。
- `quality-strategy`：定义风险分层和验收矩阵；本 Skill 物化跨仓分母和 evidenceState。
- `test-router`：选择单元、集成、场景、性能、pack/install 与 CI 路线。
- `performance-engineering`：拥有逐模块性能协议和长期维护基线；本 Skill 只把适用结果纳入跨仓分母。
- `release-verification`：消费 accepted 且新鲜的跨仓证据作为发布门禁，不得自行降级 partial。
- `skill-lifecycle-governance` / `evolution-governance`：管理 gray 生命周期、效果指标、回滚与退役。
