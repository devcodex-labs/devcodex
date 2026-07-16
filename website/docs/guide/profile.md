# Profile 使用指南

> 发布状态：本页描述随 **v1.14.0** 发布的 Profile 生成契约；安装当前包即可使用。

Profile 用来告诉 DevCodex：当前项目是什么、边界在哪里、如何测试和发布，以及有哪些公开能力。推荐路径始终是先预览，再生成或升级。

## 第一次成功

在目标项目根目录执行：

```bash
devcodex profile plan
devcodex profile init
devcodex status
```

`profile plan` 会显示目标目录、已检测档位、推荐档位、目标档位和逐文件动作，不会创建目录、文件或备份。首次创建的默认目标仍是 `profile-lite`；如果推荐档位更高，先检查理由，再显式选择：

```bash
devcodex profile plan --tier profile-standard
devcodex profile init --tier profile-standard
```

生成内容是有来源标记的草稿。请在依赖它做审查或发布判断前，复核所有 `unverified` / 待人工确认字段。

## 选择档位

| 档位 | 适合 | 默认生成文件（计数） |
|------|------|--------------|
| `profile-lite` | 小型项目、单服务、早期草稿 | 5：README、01~03、`config.json` |
| `profile-standard` | 有稳定测试/发布路径、多人协作、公开包 | 8：lite + 04、05、`06-功能清单.md` |
| `profile-closed-loop` | SDK/CLI、文档站、public API、多模块或规范维护项目 | 9：standard + `07-用户文档与契约规范.md` |

因此默认生成矩阵固定为 **5 / 8 / 9**。standard 的 `files` 必需计数仍是 6，因为其功能清单可由显式、真实存在的 external inventory source 提供；`defaultGeneratedFiles` 与 `requiredFiles` 是两组不同分母。

命令会根据 `bin` / `exports` / workspaces、测试和构建脚本、website、skills、instructions 等当前证据给出推荐，但不会替你自动升级。`ProfileGenerationContractGate` 保证生成器、加载器、状态和 validator 使用同一文件矩阵。

## 安全升级与降档

升级只补目标档位缺失的文件；已有正文保持不变，README 只更新档位声明。建议先预览：

```bash
devcodex profile plan --tier profile-closed-loop
devcodex profile init --tier profile-closed-loop
```

降档可能改变后续必需项判断，因此默认拒绝。确认确实需要后显式授权：

```bash
devcodex profile plan --tier profile-lite --allow-downgrade
devcodex profile init --tier profile-lite --allow-downgrade
```

降档不会删除 04~07 等高档文件。需要重生成当前档位文件时可用 `--force`；覆盖前会创建备份：

```bash
devcodex profile plan --force
devcodex profile init --force
```

这些行为由 `ProfileTierMigrationSafetyGate` 约束。`profile plan` 和 `profile init --dry-run` 都必须零写入。

## 功能清单怎么写

`06-功能清单.md` 是默认唯一规范功能清单。新生成和当前维护的 closed-loop 使用 `FeatureInventorySchemaV2`：

| 字段 | 回答的问题 |
|------|------------|
| 能力 ID / 能力组 | 这是什么稳定能力，属于哪一组？ |
| 公开面 / 配置入口 | 用户从哪里调用或配置？ |
| 主要消费者 / 文档入口 | 谁使用，去哪里读说明？ |
| 验证路线 / 事实来源 | 如何证明，证据来自哪里？ |
| 维护责任 / 发布状态 | 谁维护，当前是否已发布？ |
| 生命周期状态 | 当前是 planned、implemented、validated、released 还是 historical？ |
| 证据状态 / 证据日期 / 证据引用 | 结论由什么当前证据支持，证据新鲜到哪一天？ |

`01-项目信息.md` 只保留摘要和到 06 的链接，不复制完整表。关键词命中、纯项目符号、占位行或不存在的“来源路径”都不能通过 `FeatureInventorySchemaGate`。

兼容说明：validator 兼容读取 V1，已有 `profile-standard` 也可继续使用包含“能力组 / 当前口径 / 主要证据 / 验证路线”的结构化 legacy 表；新生成的 standard 和当前维护的 closed-loop Profile 使用 V2。V1/legacy 不会被 plan/init 静默重写，其状态投影保持 `unverified`，建议在项目下一次主动升级或复审时迁移。

## 常用参数

| 参数 | 作用 |
|------|------|
| `--tier <tier>` | 显式选择 lite / standard / closed-loop |
| `--dry-run` | 只预览，不写入 |
| `--force` / `-f` | 备份后重生成当前目标档位文件 |
| `--prod` | 将生成的 `config.json` mode 设为 prod |
| `--allow-downgrade` | 显式授权降档；高档文件仍保留 |

未知参数、缺少 `--tier` 值或非法档位会以退出码 1 友好失败，不输出内部堆栈。

## 验证与排错

先查看单项目状态：

```bash
devcodex status
devcodex doctor
devcodex status --json
devcodex doctor --json
```

状态会分开显示 `files`、`semantic` 和 `config`，避免把可选配置混入必需文件计数。`--json` 使用统一 `DevCodexCliEnvelopeV1`，Profile 投影会返回 schema、生命周期计数、证据计数与 `asOf`；V1 兼容输入保持 `unverified`。维护 workspace-namespace 或 DevCodex 规范仓时，再运行全工作区校验：

`ProfileTierStandardGate` 检查档位必需文件，`ProfileLifecycleClassificationGate` 检查稳定基线/活文档/条件本地文档，`AllDevCodexProfileValidationGate` 汇总所有 namespace 并区分 error 与 warning。

```bash
node scripts/validate-all-profiles.js --workspace <workspace-root>
```

- 目标根不符合预期：检查 `.devcodex/layout.json`；workspace-namespace 的工作区基线位于 `.devcodex/workspace/profile/`，项目 overlay 位于 `.devcodex/<project>/profile/`。
- standard/closed-loop 显示 semantic 缺失：检查功能清单来源是否真实存在，以及 06 是否为结构化表。
- closed-loop 校验失败：确认 06 使用完整 `FeatureInventorySchemaV2`（或可兼容读取的 V1），07 存在，并写清稳定基线、活文档和条件/本地文档生命周期。
- 不确定是否应该升级：重新运行 `profile plan --tier <候选档位>`，对照文件动作和推荐理由后再决定。

下一步可阅读[开发规范](./development.md)了解维护者验证路线，或回到[维护者指南概述](./index.md)。
