# 六宿主能力边界

DevCodex 在六个 AI Coding 宿主中共享工作流模型，但执行强度取决于各宿主可用的 Hooks、MCP、插件、权限和生命周期事件。

下表与 `public-product-expression.json` 的 host presentation 由测试对账；当前页面仍应结合首页显示的 package 版本与投影日期阅读。首次选择入口请看[宿主与工作区设置](/guide/hosts)。

| 宿主 | 推荐入口 | 公开状态 |
|------|----------|----------|
| GitHub Copilot | Copilot CLI；VS Code / JetBrains 使用 instruction fallback | 入口能力不同，按精确宿主证据执行 |
| Claude Code | Claude Code | Full（以当前 direct evidence 为上限） |
| Codex | Codex App / CLI | Beta（Hook / MCP 取决于宿主配置） |
| Gemini CLI | Gemini CLI | Beta / UNVERIFIED（需要 direct replay 才能升级） |
| Grok | `devcodex grok` | Full launcher；普通 grok 为 Partial |
| Cursor | 本地 IDE / CLI | 本地 Beta；Cloud Partial / UNVERIFIED |

## 如何理解状态

- **Full**：当前声明范围内有直接证据，但不自动覆盖未验证的宿主 variant。
- **Beta**：适配合同存在，部分真实宿主回放或平台能力仍有限。
- **Partial**：只能使用部分入口或指令回退，不能继承 Full 结论。
- **UNVERIFIED**：当前缺少足够的新鲜直接证据，不等于失败，也不能升级为通过。

配置文件存在只证明 configured；adapter 合同通过证明受管入口可解析；原生 CLI 与真实模型回放需要各自证据。这三层不能互相替代。

## Grok：Full、Partial 与 Hook 所有权

推荐从目标项目或 workspace 根启动：

```bash
devcodex grok
```

该入口在 SkillRoute bootstrap active 后才启动 Grok，并用同一份项目内核、上下文绑定和渐进式 Skill 路由建立 Full 会话。直接运行普通 `grok` 是 Partial 兼容入口：用户级规则、MCP 与可用 Hook 仍可工作，但被动的 UserPromptSubmit 输出不能冒充完整上下文注入。

只看到 Skill catalog 或路由决定，不表示正文已经加载。`StageLoadReceiptV1` 才是 entry、execution 或 closeout 阶段正文成功加载的权威回执。

Windows 上若出现 PowerShell `ParserError`，或同一 DevCodex Hook 显示两个来源，请升级到 `devcodex >= 1.17.9`，再执行：

```bash
devcodex global-adapters apply
devcodex doctor --json
devcodex grok
```

当前目标拓扑是 `devcodex-workspace` plugin 独占六个 DevCodex lifecycle 事件；用户级 Grok Hook 文件只保留委派说明和用户自己的 Hook。Grok 会精确去重完全相同的 handler，但“双声明碰巧相同”仍不是稳定所有权。无需在 `~/.grok/config.toml` 中关闭整个 Claude 兼容层，也不要把关闭 Hooks 当作产品修复。

## Cursor：本地形态、Cloud 与命令身份

Cursor 本地 IDE、交互 CLI、Headless CLI 和 Cloud Agent 必须分开判断。用户级受管 Hook 位于 `~/.cursor/hooks.json`，Plugin 位于 `~/.cursor/devcodex/plugins/devcodex-workspace`；业务项目侧只应保存 `.devcodex/`，不应复制第二套 `.cursor` 配置。

先运行：

```bash
devcodex status
devcodex doctor --json
cursor-agent --version
agent --version
```

- `adapter=ready; contract=passed` 证明受管入口与合同可解析；
- `native=unverified` 表示缺少当前形态的直接模型回放，不等于适配器失败；
- Cursor Cloud Agent 不加载用户级 Hook，因此保持 Partial / `UNVERIFIED`，不能继承本地结论；
- Windows 上多个工具都可能提供 `agent`。若 `cursor-agent --version` 正常而 `agent --version` 输出 Grok，请使用 `cursor-agent` 或调整 PATH，不能把“某个 agent 命令能运行”当作 Cursor 身份证据。

若旧会话出现 `Submission blocked by hook`、持续探索工具或 Hook 无输出，请升级到 `devcodex >= 1.17.3`，执行 `devcodex global-adapters apply`，完全退出所有 Cursor 窗口后从目标项目新建会话。开启完全访问或把用户级 `.cursor` 复制进仓库都不是默认修复。
