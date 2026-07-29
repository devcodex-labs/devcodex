# Control Content Source

`content-source/` 是 instruction、prompt 和 Skill Markdown 的唯一手写根。现有仓库路径仍是可直接消费的 delivery 输出，由 `scripts/generate-control-content.js` 确定性生成和校验。

## 目录

- `instructions.md`、`instructions/`、`prompts/`、`skills/*/SKILL.md`：135 个可物化 source entry。
- `shared/`：至少有两个真实消费者的单层 include 片段。
- `manifest.json`：source、delivery、companion 和 compatibility mirror 合同。
- `duplication-inventory.json`、`duplication-dispositions.json`：重复候选与人工处置。

禁止 runtime 读取本目录；禁止嵌套 include、路径穿越、symlink include 和打包时隐式改写。修改后先运行 zero-write check，再显式执行 `--write`。

## 术语

| 术语 | 含义 |
|------|------|
| **工作流** | 路由级完整执行路径（dev/fix/analyze/audit/self-fix/resume/plan/chat）|
| **流程** | 步骤级执行序列（某个功能的具体操作步骤）|
| **约束** | C01~C22 编号的强制/执行规则 |
| **规则** | 更宽泛的执行规定（含约束、建议、说明等）|
