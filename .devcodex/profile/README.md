# DevCodex — 项目 Profile

> 本目录定义 DevCodex 项目自身的规范配置，供 `load-profile` Skill 加载。

## 文件索引

| 文件 | 说明 | 必须 |
|------|------|:----:|
| [`01-项目信息.md`](01-项目信息.md) | 技术栈、版本策略、实施计划、开发循环 | ✅ |
| [`02-架构约束.md`](02-架构约束.md) | 目录结构、模块边界、Skill 规范 | ✅ |
| [`03-代码风格.md`](03-代码风格.md) | JS 规范、Markdown 规范、禁止事项 | ✅ |
| [`config.json`](config.json) | 运行模式配置（`ENV_MODE`） | ✅ |

## 当前模式

```json
{"mode": "dev"}
```

`dev` 模式下合规检查仅执行 FC4/FC5，CP 门控为建议性（不阻断等待）。详见 [`01-common.instructions.md`](../../instructions/01-common.instructions.md) §ENV_MODE 行为总表。

