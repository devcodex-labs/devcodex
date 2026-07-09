---
name: accessibility-i18n
description: 无障碍与国际化专家 Owner — 当任务涉及可访问性、键盘操作、焦点、屏幕阅读器、ARIA、语言地区、本地化、RTL、翻译资源、用户可见文案或多语言文档时使用；要求把包容性体验和本地化验证绑定到真实用户路径。
---

# Accessibility I18n Skill

## 定位

本 Skill 负责无障碍与国际化 Owner 视角。它不替代设计系统或前端实现，而是确保用户可见界面、CLI 输出、文档、表单、导航和多语言内容对不同能力、语言、地区和输入方式的用户都可理解、可操作、可恢复。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| UI、表单、导航、弹窗、快捷键、焦点、键盘操作、屏幕阅读器、ARIA、语义 HTML | 必须 |
| 文档站、README、CLI 输出、错误信息或用户可见文案涉及多语言、地区格式、时间数字货币、RTL 或翻译资源 | 必须 |
| 设计系统、前端架构或用户文档变更影响可访问性和本地化 | 必须 |
| 纯内部实现且没有用户可见输出、交互或文本 | N/A + skipReason |

## 核心门禁

| Gate | 要求 | 证据 |
|------|------|------|
| `AccessibilityI18nGate` | 无障碍、国际化和本地化必须绑定真实用户路径和验证路线 | userNeedsMatrix、runtimeVerification |
| `KeyboardFocusGate` | 所有可交互路径必须可键盘到达、操作、退出和恢复 | keyboardFocusModel |
| `ScreenReaderSemanticsGate` | 语义、label、role、name、state、错误提示必须能被辅助技术理解 | screenReaderSemantics |
| `LocaleContentGate` | 文案、日期、数字、货币、复数、排序、时区和翻译资源必须有 locale 策略 | localeContentModel |
| `RtlAndLayoutGate` | RTL、长文本、多语言换行和布局膨胀不得破坏主路径 | rtlFormatting |
| `FallbackRecoveryGate` | 缺翻译、无障碍失败或用户输入错误时必须有可恢复路径 | fallbackRecovery |

## 执行步骤

1. 识别目标用户、能力差异、语言地区和输入方式。
2. 建立用户路径矩阵：页面、CLI、文档、表单、错误、导航、状态反馈。
3. 审查键盘、焦点、语义、屏幕阅读器、错误恢复和状态公告。
4. 审查 locale 内容模型：文案、格式、翻译资源、RTL、长文本和 fallback。
5. 选择验证路线：源码语义、渲染截图、浏览器/CLI smoke、文档预览、测试或人工证据。
6. 在技术方案、TestRoute 或报告中写明未触发场景的 `N/A + skipReason`。

## 输出字段

```markdown
## AccessibilityI18nGate

| 字段 | 内容 |
|------|------|
| userNeedsMatrix | 用户能力、语言地区、输入方式和任务路径 |
| keyboardFocusModel | Tab 顺序、焦点可见性、快捷键、退出和恢复 |
| screenReaderSemantics | 语义结构、label、role、state、错误公告 |
| localeContentModel | 翻译、日期数字货币、复数、排序、时区、fallback |
| rtlFormatting | RTL、长文本、换行、布局膨胀、方向切换 |
| runtimeVerification | 浏览器 / CLI / 文档预览 / 测试 / 人工证据 |
| fallbackRecovery | 缺翻译、格式错误、无障碍失败和用户误操作恢复 |
| evidenceMatrix | 判断 -> 代码 / 渲染 / 测试 / 文档 / 截图 / 用户路径 |
```

## 反模式

| 反模式 | 修正 |
|--------|------|
| 只写“支持无障碍”，没有键盘和焦点证据 | 补 `KeyboardFocusGate` 和真实路径验证 |
| 只翻译静态文案，不处理日期、数字、复数、RTL 和 fallback | 补 `LocaleContentGate` 与 `RtlAndLayoutGate` |
| 用颜色或图标作为唯一状态信号 | 增加文本、语义状态和辅助技术可读信息 |
| 文档站只看 markdown 源码，不看生成后的导航和流程图 | 补 rendered / site preview 证据 |

## 与其他 Skill 的关系

- `frontend-architecture`：负责组件、状态和渲染稳定性；本 Skill 负责可访问和本地化用户路径。
- `design-system-architecture`：负责 token、组件变体和主题契约；本 Skill 负责包容性验证。
- `ux-interaction-architecture`：负责任务流和交互反馈；本 Skill 负责键盘、辅助技术和语言地区覆盖。
- `user-manual-authoring`：用户文档多语言或站点导航应叠加本 Skill。

