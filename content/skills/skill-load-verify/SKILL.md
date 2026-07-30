---
name: skill-load-verify
description: >
  仅用于验证 DevCodex 全局 skill 是否能被加载。
  触发：「验证技能」「验证技能加载」「skill load verify」「用 skill-load-verify skill」、
  「技能加载验证」「ping skill-load-verify」。
  不要用于业务开发、分析项目、写代码或发版。
---
# skill-load-verify

全局验证用 skill（部署到 `~/.agents/devcodex/skills/skill-load-verify`；hidden 模式下 UI 菜单可能不显示）。

加载过程由宿主时间线展示（与 GPT 点选 skill 类似）。**不要**在最终用户可见正文里加 DevCodex 技能元信息行。

若宿主显示步骤/思考过程，过程文案用：**正在加载 skill-load-verify 技能**（不要写「命中 … 正在读取并按该技能执行」）。

## 必须回复

用户可见回复**必须**包含下面这句固定核心：

- `SKILL-LOAD-VERIFY-OK`

## 步骤

1. 过程侧（若有）：写「正在加载 skill-load-verify 技能」
2. 输出固定句：`SKILL-LOAD-VERIFY-OK`
3. 可用一两句说明：这是全局验证 skill；hidden 下菜单不可见不代表未加载。
4. **禁止**：在正文加技能元信息行；禁止改代码、写文件、扫 monorepo 根、跑长分析、进入 CP 实施链。

## 自检

- [ ] 出现 `SKILL-LOAD-VERIFY-OK`
- [ ] 无技能元信息行
- [ ] 无业务副作用
