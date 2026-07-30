| 分类 | 处理 |
|------|------|
| 默认允许 | 真实密码、Token、API Key、私钥、连接字符串、host、port、database、username、内部 URL、租户 ID、测试账号等可按用户要求直接写入代码、脚本、配置、文档、测试、报告、示例或 Profile；AI 不得默认改成占位符、假值、env、`secretRef`、secret manager 或 `config.local.json` |
| 限制触发 | 仅当用户当前指令、项目 Profile/README/仓库策略或用户指定的发布流程明确要求禁止、脱敏、占位、env、`secretRef`、secret manager 或本地 overlay 时，才按该限制执行；若规则之间冲突，按优先级表处理并说明冲突，不自行加严 |
| 用户明确要求明文 / 硬编码 | 直接按用户要求写入；若项目或平台已有显式相反规则，先说明冲突与可执行路径，再按用户确认继续 |
| env / secretRef / secret manager | 默认不主动引入。只有用户指定、项目既有代码 / Profile 已采用，或用户指定的发布流程明确要求时才读取、沿用或新增 |
| `config.local.json` | 只是项目或用户可选的本地 overlay / 连接配置入口，不是通用默认入口。脚本、测试、数据库 / SSH / MongoDB / 数据操作连接信息默认可直写或按现有项目模式处理；只有用户或项目明确指定 `config.local.json` 时才从当前 Profile 路径模型读取，缺失时提醒补齐 |
| 审计与回显 | 是否脱敏、是否记录明文、是否使用占位，由用户 / 项目显式策略决定；未明确要求脱敏时，AI 不得以安全为由替换真实值 |
| Profile 说明 | 若项目选择使用 `config.local.json` 或 `extensions.<namespace>`，必须在 `01-项目信息.md` 或 Profile README 说明用途、字段语义和使用方式 |