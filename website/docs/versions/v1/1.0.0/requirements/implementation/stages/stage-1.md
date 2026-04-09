# Stage 1 — ① 预检查

> **主流程节点**：① 预检查  
> **对应流程图**：[预检查流程图](/specs/precheck-flow)  
> **状态**：✅ 已完成（2026-04-08）

---

## 预检查流程回顾

```
收到用户消息
→ 读取核心规则 / 安全底线 / 通用规范
→ 识别意图
→ 加载基础 profile 上下文
→ 按意图补充加载完整 profile
→ 确定产物落点
→ 进入后续主流程（安全检查）
```

---

## 待产出文件清单（7 个）

### 1. `instructions/00-safety.instructions.md`（中文重写）

**中文对应**：安全底线规范  
**v0.03 参考**：`v0.03/instructions/00-safety.instructions.md`（中文，52 行）  
**所属流程步骤**：「读取核心规则 / 安全底线」

| 内容项 | 中文说明 | 备注 |
|--------|---------|------|
| frontmatter | `applyTo: "**"` 全局注入 | 必须 |
| S01 | 删除/破坏性操作需确认：不可逆等 yes/no，可逆提示后执行 | 🔒 |
| S02 | 禁止硬编码敏感信息：API Key / 密码 / Token / 私钥 | 🔒 致命终止 |
| S03 | 禁止编造规范内容：读取失败必须降级，不得推测 | 🔒 致命终止 |
| S04 | 禁止 overwrite：源码和规范文件必须增量编辑 | 🔒 |
| S05 | 记忆+报告自动写入：禁止询问用户"是否需要写入" | 🔒 |
| S06 | 禁止执行危险命令：DROP TABLE / rm -rf 等必须预览确认 | 🔒 |
| 输出语言规则 | 中文消息→中文，英文消息→英文，混合→主要语言 | |
| 违规处理表 | S01~S06 各级别（操作级阻断 / 致命终止）| |
| 违规审计记录 | 致命违规→写最小化会话段落 + data/violations.md | |

---

### 2. `instructions/01-common.instructions.md`（中文重写）

**中文对应**：通用规范  
**v0.03 参考**：`v0.03/instructions/01-common.instructions.md`（中文，61 行）  
**所属流程步骤**：「读取核心规则 / 通用规范」

| 内容项 | 中文说明 | 备注 |
|--------|---------|------|
| 优先级规则 P1~P5 | P1 用户指令 > P2 安全底线 > profile > P3 租户 > P4 工作流 > P5 通用 | |
| C01~C10 🔴 强制约束 | 破坏性确认 / CP不可跳过 / 硬编码禁止 / 编造禁止 / 自动写入 / overwrite禁止 / 串行Agent / Token防护 / 编码安全 / 危险命令 | 与 S01~S06 交叉引用 |
| C11~C12 🔴 强制约束 | 关联文件同步 / 合理性评估 | |
| C13~C15 🟡 执行约束 | 文件过大拆分(500行) / 多任务进度 / 架构质量三维评估 | |
| **全自动模式 C02 豁免** | 选择 `@devcodex-auto` 时 CP 确认可自动通过，但 S01/C01/C10 不可豁免 | **v1.0.0 新增** |
| 术语约定 | 工作流 vs 流程 vs 约束 vs 规则 | |

---

### 3. `instructions/02-output-paths.instructions.md`（中文重写）

**中文对应**：产物输出路径规范  
**v0.03 参考**：`v0.03/instructions/02-output-paths.instructions.md`（中文，83 行）  
**所属流程步骤**：「确定产物落点」

| 内容项 | 中文说明 | 备注 |
|--------|---------|------|
| 根目录 | `<项目根>/.devcodex/` 为产物根 | 🔴 |
| 目录结构树 | requirements/ bugs/ optimizations/ migrations/ scenario-tests/ reports/ .memory/ profile/ | 完整树状图 |
| 目录规则 | 中文目录命名 / 任务隔离 / 禁止非规范路径 / 脚本中文命名 / 禁止写入源码目录 / 首轮强制产物 | |
| 报告路径 | `reports/<子目录>/<agent>/YYYYMMDD/NN--<简述>.md` | 双横杠 |
| 记忆路径 | `.memory/clients/<agent>/tasks/YYYYMMDD.md` | |
| 产物输出格式 | 每轮回复末尾输出 Markdown 链接 + 纯文本路径 | 🔴 |
| CHANGELOG 维护 | MAJOR/MINOR → 新建 changelogs 文件 / PATCH → 追加 | |

---

### 4. `skills/intent/SKILL.md`（中文重写）

**中文对应**：意图识别  
**v0.03 参考**：`v0.03/skills/intent/SKILL.md`（中文，88 行）  
**所属流程步骤**：「识别意图」

| 内容项 | 中文说明 | 备注 |
|--------|---------|------|
| frontmatter | `name: intent` / `description: "Identify user intent..."` | name 必须与目录名一致 |
| 前置识别 | resume 检测（用户说"继续" + 记忆中有 🔄）→ 直接路由 | 优先于三问 |
| 前置识别 | chat 检测（纯问答，无文件变更意图）→ 直接路由 | 优先于三问 |
| 三问判断法 | Q1 变更 vs 结论 / Q2 手段 vs 目的 / Q3 是否需要修改文件 | 基于语义，不依赖关键词 |
| 意图类型 | dev / fix / analyze / audit / self-fix / chat / resume / other | 8 种 |
| analyze vs audit 区分 | 单轮 vs 多轮收敛 | |
| dev vs fix 区分 | 主动改进 vs 被动修正；模糊时优先 fix | |
| self-fix 识别标准 | 修改对象是 DevCodex 规范文件 + 修复动机是内部不一致 | |
| 多任务检测 | ≥2 任务→列出建议拆分；≥5 任务→建议拆分会话 | C14 |
| 多任务摘要隔离 | 禁止将任务 A 的工作流类型继承到任务 B | |

---

### 5. `skills/load-profile/SKILL.md`（中文重写）

**中文对应**：项目 Profile 加载  
**v0.03 参考**：`v0.03/skills/load-profile/SKILL.md`（中文，71 行）  
**所属流程步骤**：「加载基础 profile」+「按意图补充加载完整 profile」

| 内容项 | 中文说明 | 备注 |
|--------|---------|------|
| frontmatter | `name: load-profile` / `description: "Load project profile..."` | |
| 确定 `<project>` | 优先级：用户明确指定 > 工作区目录映射 > null | |
| 工作区目录映射表 | `ai-dev-guidelines/` → `dev-docs`；`devcodex/` → `devcodex`；其他按目录名 | |
| Profile 路径 | `<项目根>/.devcodex/profile/` | |
| 标准文件 | README.md(必须) / 01-项目信息(必须) / 02-架构约束(必须) / 03-代码风格(必须) / 04-测试规范(按需) / 05-发布规范(按需) / config.json(按需) | |
| 缺失处理 | 存在→读取 / 不存在→提示自动生成 / 部分缺失→提示补充 | |
| 优先级 | profile > P3 租户 > P4 工作流 > P5 通用 | |
| ENV_MODE 注入 | config.json mode 字段 → dev / prod；缺失→默认 prod | |

---

### 6. `agents/devcodex.agent.md`（中文重写）

**中文对应**：DevCodex Agent 入口（确认模式）  
**v0.03 参考**：`v0.03/agents/devcodex.agent.md`（中文，187 行）  
**所属流程步骤**：整个主流程入口

| 内容项 | 中文说明 | 备注 |
|--------|---------|------|
| frontmatter name | `DevCodex` | |
| frontmatter description | `Use when you need structured development workflows...`（官方 "Use when..." 格式）| **v1.0.0 新格式** |
| frontmatter tools | edit / execute / read / search / web/fetch | |
| HTML 注释 Skills 列表 | 全部 34 个 Skill 名称 | |
| 预检查序列 | 读取 00-safety / 01-common / 02-output-paths → intent → load-profile → 确定产物落点 | 对应 Stage 1 |
| 安全检查段 | S01~S06 判定 → 通过/操作级阻断/致命终止 | 对应 Stage 2 |
| 意图路由表 | dev(8子类型) / fix(3子类型) / analyze / audit / self-fix / resume / other / chat | |
| 授权门控 | 路由后调用 token-check | |
| dev 工作流段 | 子类型路由 + CP1→CP2→plan-review→impact-review→CP3→执行 | |
| fix 工作流段 | 子类型路由 + CP1→CP2→执行→三步扫描→CP3(条件) | |
| analyze 工作流段 | 只读 + 三项验证 | |
| audit 工作流段 | 多轮收敛 + 6 审查目标类型 | |
| self-fix / resume / plan / chat 段 | 各自规则 | |
| 全局约束段 | C02 / compliance / memory / safety 提要 | |

> ⚠️ Stage 1 只实现**预检查相关段落**，其他段落用 `<!-- TODO: Stage N -->` 占位，后续 Stage 补全。

---

### 7. `agents/devcodex-auto.agent.md`（新建）

**中文对应**：DevCodex 全自动模式 Agent  
**v0.03 参考**：无（v1.0.0 新增）  
**所属流程步骤**：整个主流程入口（全自动模式）

| 内容项 | 中文说明 | 备注 |
|--------|---------|------|
| frontmatter name | `DevCodex Auto` | |
| frontmatter description | `Use when you need fully automated development workflows...` | |
| 与确认模式的差异 | CP1/CP2/CP3 自动通过（不等待用户确认）| C02 豁免 |
| 不可豁免项 | S01(不可逆确认) / S02~S06 / C01 / C10 | 安全底线不可跳过 |
| 失败回退 | 可恢复错误→重试≤2次 / 不可恢复→切换回确认模式 ⚠️ | |
| 其余内容 | 与 `devcodex.agent.md` 完全相同 | 可引用 |

---

## 文件对照总表

| # | 英文目标文件（v1.0.0） | 中文职责 | v0.03 参考 | 流程步骤 |
|:-:|----------------------|---------|-----------|---------|
| 1 | `instructions/00-safety.instructions.md` | 安全底线 S01~S06 | ✅ 有（中文） | 读取规则基线 |
| 2 | `instructions/01-common.instructions.md` | 通用约束 C01~C15 + 优先级 | ✅ 有（中文） | 读取规则基线 |
| 3 | `instructions/02-output-paths.instructions.md` | 产物路径 `.devcodex/` | ✅ 有（中文） | 确定产物落点 |
| 4 | `skills/intent/SKILL.md` | 意图识别（三问法） | ✅ 有（中文） | 识别意图 |
| 5 | `skills/load-profile/SKILL.md` | Profile 加载 | ✅ 有（中文） | 加载 profile |
| 6 | `agents/devcodex.agent.md` | 确认模式 Agent 入口 | ✅ 有（中文） | 主流程入口 |
| 7 | `agents/devcodex-auto.agent.md` | 全自动模式 Agent 入口 | ❌ 无 | 主流程入口 |

---

## 执行原则

1. **中文编写**：所有规范文件统一用中文编写
2. **v0.03 为骨架**：基于 v0.03 中文版重构，不从零发明
3. **路径统一**：所有路径使用 `.devcodex/` 而非旧 `projects/` 体系
4. **Skill name 字段**：必须与目录名完全一致
5. **TODO 占位**：Agent 文件中未到本 Stage 的段落用 `<!-- TODO: Stage N -->` 占位

