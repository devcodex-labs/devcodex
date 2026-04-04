# 存储规范

> **优先级**：P1  
> **状态**：⬜ 待开发  
> **关联**：[memory-resume.md](./memory-resume.md) · `instructions/02-output-paths.instructions.md` · `instructions/15-memory.instructions.md`

---

## 存储位置总览

```
<工作区>/                        ← 用户项目根目录（devcodex init 安装位置）
└── .github/                     ← DevCodex 规范文件（可提交）
    ├── agents/
    ├── skills/
    ├── instructions/
    ├── prompts/
    └── hooks/

<工作区>/.devcodex/              ← DevCodex 产物根目录
├── .memory/                     ← 记忆文件（.gitignore 排除，不提交）
│   └── clients/
│       └── <agent>/
│           └── tasks/
│               └── YYYYMMDD.md  ← 每天一个文件，会话追加
├── requirements/                ← 需求产物（可提交）
│   └── <中文描述>/
│       ├── 01-需求概述.md
│       ├── 02-技术方案.md
│       ├── 03-实施方案/
│       ├── 04-实施计划.md
│       ├── .memory/sessions.md  ← 需求级记忆（.gitignore 排除）
│       └── reports/<agent>/YYYYMMDD/
├── bugs/                        ← Bug 修复产物（可提交）
├── optimizations/               ← 性能优化产物（可提交）
├── reports/                     ← 全局报告（可提交）
│   ├── analysis/<agent>/YYYYMMDD/
│   ├── audit/<agent>/YYYYMMDD/
│   ├── bugs/<agent>/YYYYMMDD/
│   └── requirements/<agent>/YYYYMMDD/
├── data/                        ← 运行时数据（可提交）
│   ├── violations.md            ← 违规审计记录
│   ├── pending-fixes.md         ← 待处理规范修复
│   └── gap-registry.md          ← 审查维度盲区登记
├── profile/                     ← 项目规范（可提交）
│   ├── 01-项目概述.md
│   ├── 02-技术栈.md
│   └── 03-代码风格.md
├── TASK-INDEX.md                ← 任务索引（可提交）
└── README.md
```

---

## 记忆文件规范

### 路径构建

```
<工作区>/.devcodex/.memory/clients/<agent>/tasks/YYYYMMDD.md
```

- `<agent>`：`copilot` / `cursor` / `claude` / `vscode-copilot` / `unknown-agent`
- 每天一个文件，`## 会话 NN` 分段（NN 从 01 起递增）
- 文件已存在 → 追加；不存在 → 新建

### 记忆字段结构

```markdown
## 会话 01

- 🕐 开始时间：YYYY-MM-DD HH:mm
- 🎯 任务摘要：[任务描述]
- 📨 对话记录：[关键对话摘要]
- 📄 关联报告：[报告路径]
- 📦 编码检查点：[超 13 轮时写入]
- ⚠️ 待跟进：[需跟进的问题]
- 🔄 / ✅ 状态：进行中 / 已完成
```

### .gitignore 规则

```bash
# DevCodex 记忆文件（不提交）
.devcodex/.memory/
.devcodex/**/.memory/
.devcodex/**/.tmp/
```

---

## 产物文件分类

| 分类 | 目录 | 是否提交 | 说明 |
|------|------|---------|------|
| 规范文件 | `.github/` | ✅ 提交 | 团队共享 |
| 需求产物 | `.devcodex/requirements/` | ✅ 提交 | 按需共享 |
| 报告 | `.devcodex/reports/` | ✅ 提交 | 按需共享 |
| 项目规范 | `.devcodex/profile/` | ✅ 提交 | 团队共享 |
| 运行时数据 | `.devcodex/data/` | ✅ 提交 | 违规/待修复记录 |
| 记忆文件 | `.devcodex/.memory/` | ❌ 不提交 | 个人/本机 |
| 临时文件 | `.devcodex/**/.tmp/` | ❌ 不提交 | 临时产物 |

---

## data/ 目录规范

### violations.md — 违规审计记录

```markdown
| ID | 时间 | 违规规则 | 描述 | 状态 |
|----|------|---------|------|------|
| VL-001 | 2026-01-01 | S02 | 硬编码 API Key | ✅ 已关闭 |
```

### pending-fixes.md — 待处理规范修复

```markdown
| ID | 发现时间 | 文件 | 描述 | 优先级 | 状态 |
|----|---------|------|------|--------|------|
| PF-001 | 2026-01-01 | skills/compliance/SKILL.md | XX 描述不准确 | P2 | 🔄 待处理 |
```

### gap-registry.md — 审查维度盲区

```markdown
| ID | 发现时间 | 审查场景 | 盲区描述 | 建议处理 |
|----|---------|---------|---------|---------|
| GAP-001 | 2026-01-01 | audit-project | 缺少性能基准维度 | 新增 PE-12 |
```

---

## 报告命名规则

```
NN--<简述>.md
```

- `NN`：当日序号，从 `01` 起递增（扫描同目录取 max+1）
- `--`：**双横杠**（FC4 检查项）
- `<简述>`：2~5 中文词或英文单词，连字符分隔

示例：`01--skills-结构分析.md`、`02--hooks-修复方案.md`

---

## v2.0.0 存储层预留（设计原则）

v1.0.0 所有文件 I/O 操作必须通过**统一存储接口**，不直接散落在各 Skill 中：

- 记忆读写 → 统一由 `memory` Skill 代理
- 数据文件（violations/pending-fixes）→ 统一由各 Skill 的 append 调用处理
- 报告写入 → 统一由 `report` Skill 代理

> 这为 v2.0.0 替换为 MongoDB 存储层预留了替换点，无需修改各工作流 Skill。
