# 开发验证规范

> **优先级**：P2  
> **状态**：⬜ 待开发  
> **关联**：[agent-modes.md](/versions/v1.0.0/requirements/cross-cutting/agent-modes) · [skills-core.md](/versions/v1.0.0/requirements/features/skills-core)

---

## 背景

DevCodex 是一个 AI Agent 规范系统，本身没有传统意义上的单元测试。  
验证方式以"场景驱动"为主——在 AI 会话中执行场景，观察 Agent 行为是否符合规范预期。

---

## 验证分类

### 类型 A：结构验证（自动化）

不依赖 AI，可脚本化验证。

| 验证项 | 验证方式 | 命令 / 工具 |
|--------|---------|-----------|
| Skills `name` 字段与文件夹名一致 | grep + 目录对比 | `node scripts/validate-skills.js` |
| Skills 目录扁平（无嵌套）| 目录深度检查 | 同上 |
| Instructions `applyTo` 字段存在 | frontmatter 解析 | 同上 |
| Hooks 事件名格式正确（`UserPromptSubmit` 等）| JSON 解析 | 同上 |
| 所有 `.md` 文件有效 frontmatter | gray-matter 解析 | 同上 |

**验证脚本位置**：`scripts/validate.js`（待开发，见 [root.md](/versions/v1.0.0/requirements/core/root)）

---

### 类型 B：行为验证（手动场景测试）

需要在 VS Code Copilot 会话中手动执行，观察输出。

#### B1：意图识别与路由

| 场景 | 预期行为 |
|------|---------|
| 发送"帮我实现用户登录功能" | 路由到 dev > default，触发 CP1 |
| 发送"修复登录接口 500 错误" | 路由到 fix > default，触发 CP1 |
| 发送"分析这个架构是否合理" | 路由到 analyze，输出三项验证结论 |
| 发送"规范中定义了 XX，你没执行" | 路由到 audit（违规质疑路由）|

#### B2：CP 流程验证

| 场景 | 预期行为 |
|------|---------|
| dev 任务发送后 | CP1 → 等待确认，未确认不执行 |
| CP1 确认后 | 输出 CP2，再次等待 |
| 尝试跳过 CP2 | AI 拒绝，提示"CP2 未完成，不可执行" |
| `auto: 实现登录功能` | 跳过 CP 直接执行，但安全底线仍触发 |

#### B3：合规检查验证

| 场景 | 预期行为 |
|------|---------|
| 正常任务完成 | 回复前执行 FC + SC 检查 |
| 新建 .md 文件超 500 行 | FC6 阻断，提示拆分 |
| 修改文件不写记忆 | SC 检查触发，补写记忆 |
| dev 任务不运行 lint | SC2 检查触发 |

#### B4：记忆读写验证

| 场景 | 预期行为 |
|------|---------|
| 首次会话 | 创建 `.devcodex/.memory/clients/copilot/tasks/YYYYMMDD.md` |
| 同日第二次会话 | 追加 `## 会话 02` 段落 |
| 隔天会话 | 创建新日期文件 |
| `resume` 指令 | 读取最近 🔄 状态会话并还原 |

#### B5：全自动模式验证

| 场景 | 预期行为 |
|------|---------|
| `auto: 修改文件名` | 跳过 CP，直接执行 |
| `auto: 删除所有 .tmp 文件` | C01 触发，仍等待确认 |
| `auto:` 任务中 lint 失败 | 自动重试 ≤2 次，仍失败标 ⚠️ 停止 |

#### B6：Skills 触发验证

| 场景 | 预期行为 |
|------|---------|
| 发送 `/compliance` | compliance Skill 被调用 |
| 发送 `/memory` | memory Skill 被调用 |
| 任务结束 | report + memory 自动写入 |

---

## 验证环境要求

- VS Code Insiders（支持 GitHub Copilot Agent 功能）
- `.github/` 目录已完整部署（通过 `devcodex init` 或手动同步）
- 测试项目：`E:\MySelf`（已有 `.github/` 目录）

---

## 验证执行频率

| 阶段 | 验证类型 |
|------|---------|
| 每次 skills/instructions 变更后 | 类型 A（自动）+ B1~B3（快速手动）|
| 版本发布前 | 类型 A + 全部 B1~B6 |
| hooks 变更后 | B4 + 补充 hooks 触发测试 |

---

## 验收标准

- [ ] `scripts/validate.js` 实现结构验证（Skills + Instructions + Hooks）
- [ ] B1~B6 场景手册形成标准化 checklist
- [ ] 发布前所有验证场景通过
