---
name: design-system-architecture
description: 设计系统架构专家 Owner — 当任务涉及设计系统、主题、Token、组件变体、Figma/代码同步、UI 一致性、可访问性、国际化、品牌视觉或组件库治理时使用；要求把视觉规则沉淀为可复用、可验证的系统契约。
---

# Design System Architecture Skill

## 定位

本 Skill 负责设计系统 Owner 视角。它不替代单页 UI 实现，而是把 token、主题、组件变体、设计源和治理规则变成长期可维护的系统契约。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| 设计系统、主题、Token、组件库、组件变体、Figma/代码同步、品牌视觉 | 必须 |
| 任务涉及多页面 UI 一致性、样式主题、可访问性、国际化或设计资产进入生产 | 必须 |
| 前端方案需要定义复用组件或视觉规范 | 必须 |
| 单次页面文案微调且不影响组件/主题 | N/A + skipReason |

## 核心门禁

| Gate | 要求 | 证据 |
|------|------|------|
| `DesignSystemArchitectureGate` | Token、组件变体、主题、一致性、设计源和治理必须成矩阵 | designTokens、componentVariantModel |
| `DesignTokenGate` | 颜色、字体、间距、圆角、阴影和语义 token 必须有来源 | designTokens |
| `ComponentVariantGate` | 组件状态、尺寸、密度、禁用、错误、加载必须定义 | componentVariantModel |
| `ThemeConsistencyGate` | 主题与品牌视觉不能一页一套 | themeConsistency |
| `FigmaCodeSyncGate` | 设计源、代码实现、资产预算和验收入口必须可追踪 | figmaCodeSync |

## 执行步骤

1. 识别设计源：Figma、现有页面、组件库、品牌规范、代码 token。
2. 建立 token 和主题矩阵：语义、状态、暗色/亮色、响应式。
3. 建立组件变体模型：状态、尺寸、密度、错误、加载、交互。
4. 评估可访问性、国际化和生产资产预算。
5. 把设计系统变更同步到文档、组件示例、测试或视觉证据。

## 输出字段

```markdown
## DesignSystemArchitectureGate

| 字段 | 内容 |
|------|------|
| designTokens | 颜色、字体、间距、圆角、语义 token |
| componentVariantModel | 组件变体、状态、尺寸、密度 |
| themeConsistency | 主题、品牌、页面一致性 |
| accessibilityI18nBoundary | 无障碍、键盘、屏幕阅读器、国际化边界 |
| figmaCodeSync | Figma/代码/资产/验收同步 |
| adoptionGovernance | 使用规范、迁移、弃用、治理 |
| evidenceMatrix | 判断 -> Figma / code / screenshot / Storybook / docs / tests |
```

## 反模式

| 反模式 | 修正 |
|--------|------|
| 每个页面手写一套颜色和间距 | 抽象 designTokens 和主题规则 |
| 组件只有默认态 | 补 variant/state/error/loading/disabled |
| 只看 Figma 静态图 | 验证代码实现、响应式、状态和资产预算 |
| 设计系统文档只给维护者看 | 同步用户/开发者可理解的使用示例 |

## 与其他 Skill 的关系

- `frontend-architecture`：设计系统落地到组件边界和状态模型。
- `ux-interaction-architecture`：交互状态和任务流影响组件变体。
- `brand-visual-quality`：品牌母版谱系、主题几何 parity、微尺寸光学校正、单色母版和视觉证据由其 Owner；本 Skill 消费已验收资产并负责 token/theme/component/Figma-code adoption。命中资产生产时引用 `ThemeGeometryParityGate`，不得在本 Skill 内复制生产门禁。
- `figma` 相关 Skill：需要 Figma 写入或设计读取时按 Figma 工具链执行。
