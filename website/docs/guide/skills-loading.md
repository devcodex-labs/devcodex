# 技能加载与验证

> 面向使用者：如何确认 DevCodex 技能是否加载，以及 **不要** 期望什么。

---

## 你会看到什么

| 位置 | 行为 |
|------|------|
| **最终回复正文** | **不**强制出现 `【DevCodex 技能】…` 元信息行（已收敛取消） |
| **宿主过程时间线** | 可能看到工具/Skill 步骤；推荐文案 **「正在加载 &lt;id&gt; 技能」** |
| **IDE skill 菜单** | `skillsDeployMode=hidden` 时全局包 skill 可能**不显示**（不等于未加载） |

全局 skill 真实目录（hidden）：

```text
~/.agents/devcodex/skills/<id>/SKILL.md
```

工作区 skill：

```text
<workspace>/.devcodex/workspace/skills/<id>/SKILL.md
```

---

## 一键验证（推荐）

在对话中发送：

```text
验证技能加载
```

（或 `skill load verify` / `用 skill-load-verify skill`）

**期望用户可见固定句：**

```text
SKILL-LOAD-VERIFY-OK
```

无需再检查元信息行。该 skill 不写代码、不做项目分析。

---

## CLI 验证

源码仓或已 `npm install -g .` / 正式包安装后：

```bash
devcodex skill intent "验证技能加载" --json
devcodex skill resolve skill-load-verify
devcodex skill plan intent
devcodex skill match "用 test skill"    # 仅工作区 AutoMatch
```

| 子命令 | 作用 |
|--------|------|
| `skill intent` | 工作区意图 + 全局 author/verify 启发式 |
| `skill resolve` | W>G 解析单 skill |
| `skill match` | 工作区 AutoMatch（不覆盖全局 verify 启发式） |
| `skill plan` | 依赖闭包 bundle 计划（需包内 `skills/portfolio.json`） |

未发布 npm 时请从源码根：

```bash
cd <devcodex-source>
npm install -g .
npm run global-adapters:apply
```

若 PATH 仍指向旧包 `@vextjs/devcodex`，先卸载再安装。

---

## 隐私提示

请勿在过程中 **List** 用户主目录下的宿主 skill 树（例如 `~/.grok/skills`、`~/.grok/bundled/skills`），以免过程 UI 暴露 `C:\Users\…` 路径。  
应 **Read 单个** 已知 `SKILL.md` 路径。Hook 对经 PreToolUse 的此类 List 会拦截（`host-skill-inventory-ban`）。

---

## 宿主差异（诚实上限）

| 宿主 | 说明 |
|------|------|
| Codex 等 UPS 较完整 | 更易注入 skill 正文；验证句更稳 |
| Grok Partial | 无可靠 UserPromptSubmit inject；依赖模型读 skill + 条件 Stop |

详见 [Grok 宿主对齐](/intro/host-parity-grok)。

---

## 相关

- 维护者 CLI 速查：[开发规范](/guide/development#cli-速查)
- 变更台账：`changelogs/unreleased.md`（skill-load-verify / 取消元行）
