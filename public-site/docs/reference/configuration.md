# 配置

普通单项目只需 `devcodex init`。需要团队别名或完成策略时，再编辑 workspace Profile 的 `config.json`。

workspace-namespace 使用 workspace base + project overlay。配置只对所属 scope 生效；不要把另一个项目的 Profile 当成当前 active-root。术语见[术语表](/reference/glossary)。

## Profile 路径可迁移

DevCodex 新生成的 Profile 在直属 `README.md` 声明 `Profile 路径契约：portable-v1`。项目内路径使用 `<workspace-root>`、`<project-root>`、`<active-root>` 或相对路径，不把当前盘符、用户名或安装目录固化为项目规范。

确属本机外部资源的路径可以保留，但必须在同一行添加 `<!-- devcodex:path-scope=machine-local -->`。`validate-profile` 只检查显式目标 Profile 的顶层 Markdown；不会因为一个项目迁移而扫描或修改同工作区的其他项目。未声明 `portable-v1` 的旧 Profile 保持兼容，历史报告、receipt 和审计证据也不会被迁移过程改写。

## 自动推进别名

正式入口始终是 `@devcodex-auto`。默认快捷别名为 `@rocky`。

```json
{
  "extensions": {
    "devcodex": {
      "autoAliases": ["@team-auto"]
    }
  }
}
```

- 省略 `extensions.devcodex.autoAliases`：保留默认 `@rocky`；
- 非空数组：替换默认快捷别名；
- 空数组 `[]`：关闭默认快捷别名；
- 配置不会重命名正式的 `@devcodex-auto` 入口。

## 任务恢复容量

默认不需要配置。TaskRecoveryStoreV5 的 soft limit 固定为 256 MiB，默认 hard limit 为 512 MiB；正式任务数量不设硬上限。确有更多本地恢复容量时，只能提高 hard limit：

```json
{
  "extensions": {
    "devcodex": {
      "taskRecovery": {
        "hardLimitMiB": 1024
      }
    }
  }
}
```

`hardLimitMiB` 必须是 safe integer 且不小于 512。workspace-namespace 先读 workspace base，再由当前 project overlay 覆盖；配置不能跨 project 生效。未知 key、字符串、小数、负数或小于 512 的值会 fail closed：运行时使用 512 MiB 安全默认，并由 `devcodex runtime doctor --json` 报告 typed issue，而不是按错误值继续写入。

提高 hard limit 不是清理策略，也不会扩大单个 task slot、ephemeral、trace、telemetry 或 closeout reserve 的上限。达到 soft 时系统只做安全冷化/退出缓存；达到 hard 时普通 mutation 被阻止，最小 closeout 仍使用预留空间。现有 legacy generation 不参与自动删除。

## Git 协作与集成策略

新 Profile 使用保守默认值：协作模式未核实、不自动建分支、worktree 只在显式请求时创建，所有共享 Git 动作继续要求单独确认。

此前部分单人仓库在“提交”阶段意外出现新分支，根因不是 DevCodex 产品代码自动执行了 branch create，而是代理把面向多人协作的通用 GitHub 分支惯例套到了单人开发场景，并且没有在创建/切换前披露和逐项取权。新的执行合同以 Profile 中的真实协作模式为准，不再从“提交”推导出建分支授权。

```json
{
  "extensions": {
    "devcodex": {
      "git": {
        "collaborationMode": "unverified",
        "branchPolicy": "no-auto-branch",
        "worktreePolicy": "explicit-only",
        "crossBranchIntegration": "unverified",
        "sharedActionsRequireExplicitAuthorization": true
      }
    }
  }
}
```

已确认是单人维护的项目可以在 project overlay 写 `collaborationMode: "solo"`、`branchPolicy: "keep-current"` 和 `crossBranchIntegration: "ordered-cherry-pick"`。这表示：同分支直接交付不做集成；只有从 dev/detached/worktree 选择性带入目标分支时，才按源 commit 顺序 cherry-pick。cherry-pick 仍可能冲突，也会在目标分支生成新 commit ID。

Profile 是策略与事实声明，不是执行授权。创建/切换分支、commit、cherry-pick 和 push 分别确认；push 始终独立确认。project overlay 可以收窄项目事实，但不能把 `sharedActionsRequireExplicitAuthorization` 改成 `false`。完整线性历史需要保留原 commit ID 时，可在明确选择后使用 `merge --ff-only`；merge commit 不是默认路线。

确需例外创建或切换分支时，执行前必须向用户说明原因、对当前开发的影响、可用替代方案、源/目标分支以及后续回收计划；没有这份披露和对应动作的独立授权，就保持当前分支。

如果项目里出现未预期的新分支或 worktree，先运行 `devcodex status` 与 `devcodex doctor --json`。诊断只读取 Git 元数据：当前 worktree 和有 DevCodex receipt 的对象才进行有界 dirty 探测；prunable 只报告元数据，外部未归属路径默认不进入。没有创建回执时，DevCodex 会标记 `external-unowned / UNVERIFIED`，不会把它冒充为自己创建，也不会自动 prune、remove、unlock 或修改全局 `safe.directory`。

## 进化候选与 active Skill

`devcodex init` 会为 workspace 准备 `.devcodex/workspace/evolution/{candidates,decisions,evidence}`。这里保存安装实例自己的进化候选、审批决定和证据；候选目录不是 Skill resolver 输入，也不会因写入候选就自动修改发行包或 active Skill。

默认目标是 workspace-local。只有带项目专属证据时才选择 project-local；只有维护者明确授权贡献时才选择 upstream-package。候选经 approved decision 和独立晋级授权后，才能进入 `.devcodex/workspace/skills` 或项目 overlay。

## 项目 Profile

多项目 workspace 中，某个子项目需要独立 Profile 时，可以从 workspace 根预览并初始化：

```bash
devcodex init --profile <项目相对路径> --dry-run
devcodex init --profile <项目相对路径>
```

目标必须真实存在且唯一。`--dry-run` 不创建文件；正式执行只补充缺失基线，不覆盖已编辑内容。

高级 Profile 也可以先预览：

```bash
devcodex profile plan --tier profile-closed-loop
devcodex profile init --tier profile-closed-loop
```

`--force` 可能覆盖 DevCodex 管理的目标文件；使用前先保存计划和当前 diff。

## 状态优先于猜测

```bash
devcodex status
devcodex doctor
```

配置、adapter、native 与 workspace 状态分别显示。不要根据一个文件存在、一个命令可运行或另一个宿主通过，就推断当前宿主已经完整就绪。
