# 六宿主能力边界

DevCodex 在六个 AI Coding 宿主中共享工作流模型，但执行强度取决于各宿主可用的 Hooks、MCP、插件、权限和生命周期事件。

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
