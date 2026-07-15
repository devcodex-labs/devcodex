---
name: brand-visual-quality
description: 品牌视觉资产生产质量 Owner — 当任务涉及品牌标志、图标、主题变体、微尺寸光学校正、单色母版、主资产谱系或视觉验收证据时使用；要求把几何一致性、变体关系和人工视觉结论绑定到可重放证据，避免只凭文件存在或单次截图宣告完成。
---

# Brand Visual Quality

本 Skill 负责品牌视觉资产从母版到可验收交付物的生产质量闭环。它不替代设计系统、页面交互或普通文案审查。

## 触发条件

命中任一条件时使用：

- 新建或修改 logo、app icon、favicon、品牌图形、主题图标、单色版本或微尺寸变体。
- 需要证明多个格式、主题或尺寸来自同一母版，而不是各自手工漂移。
- 视觉复审发现描边、留白、重心、负空间、轮廓、像素贴合或单色退化问题。
- 需要形成视觉证据包、人工验收结论或 blocker 修复后的重跑记录。

以下场景不单独触发本 Skill：

- 仅调整 design token、组件主题、Figma-code adoption 或通用组件变体，交给 `design-system-architecture`。
- 仅审查页面任务路径、加载/空/错状态或普通交互，交给 UX / frontend Owner。
- 一次性改文案或不影响品牌资产谱系的普通颜色微调。

## Owner 边界

| 能力 | 本 Skill | 相邻 Owner |
|---|---|---|
| 品牌母版、几何谱系、主题/尺寸变体生产质量 | Owner | `design-system-architecture` 只消费并接入 token/component/runtime |
| token、theme、component、Figma-code 同步 | 配合 | `design-system-architecture` Owner |
| 专家型产物通用品质 | 提供领域证据 | `expert-output-quality` 横切门禁 |
| 返工率与预防措施长期有效性 | 提供 WorkUnit 数据 | `rework-prevention-engineering` Owner |

## BrandVisualQualityGate

所有品牌视觉 WorkUnit 必须依次执行以下子门禁；任一必需门禁缺证据时状态只能是 `verification-pending` 或 `blocked`。

### MasterLineageGate

建立 `MasterLineageMatrix`：

| 字段 | 必填说明 |
|---|---|
| masterId / digest | 可复现母版身份 |
| sourceFormat | SVG、矢量源或批准的高分辨率母版 |
| derivedAsset | 每个输出资产路径和用途 |
| transform | 缩放、裁切、留白、光学校正，不允许只写“导出” |
| generatedAt / tool | 生成时间与工具链 |
| lineageVerdict | `matched / drifted / unknown` |

不存在可追溯母版、多个变体无法反查同一谱系或手工覆盖未记录时，禁止标 `accepted`。

### ThemeGeometryParityGate

形成 `ThemeGeometryParity`，逐主题比较 viewBox/画布、主体边界、留白、重心、轮廓与透明区。主题只允许颜色、明暗或明确批准的光学差异；未经记录的几何变化是 blocker。

### MicroOpticalVariantGate

针对 favicon、16/20/24/32px 图标和其他微尺寸输出检查像素贴合、最细笔画、负空间、视觉重心与缩放后可辨识度。微尺寸可存在受控光学校正，但必须记录与母版的差异原因，不能伪装成等比缩放。

### MonoMasterGate

形成独立单色母版或证明单色输出来自可复现变换。验证轮廓闭合、透明/实色语义、反白可用性和极端对比背景；彩色资产直接去饱和不自动等于合格单色母版。

### VisualEvidencePackGate

生成 `VisualEvidencePack`，至少包含：

- 母版与派生资产身份、命令或工具版本。
- 同画布主题并排、微尺寸像素级预览、单色正反背景预览。
- 自动几何/文件检查结果与人工视觉结论；两者不能互相替代。
- 证据生成时间、reviewer、结论和未覆盖项。

文件存在、构建成功或单张截图都不足以证明视觉质量通过。

### VisualBlockerResetGate

发现 blocker 后写 `VisualBlockerResetRecord`：记录 finding、受影响资产、补丁、旧证据失效范围、新母版身份和必须重跑的矩阵。修复单个输出后，至少重跑同母版全部主题、相关微尺寸、单色输出和证据包；不得复用 blocker 前的 accepted 结论。

## 产物契约

每个 WorkUnit 使用以下五类产物：

1. `MasterLineageMatrix`
2. `ThemeGeometryParity`
3. `MicroMonoMatrix`
4. `VisualEvidencePack`
5. `VisualBlockerResetRecord`（无 blocker 时写 `N/A + no-blocker-observed`）

任务状态机：

```text
draft → candidate → verification-pending → accepted
                                      ├──→ rejected
                                      └──→ blocked
blocked / rejected → 新 candidate（旧证据失效）
```

`accepted` 必须同时满足五类产物、自动检查和人工视觉结论；生命周期 gray/active 是 Skill portfolio 状态，与单个 WorkUnit 的 accepted 分离。

## 验证路线

| 层 | 必查 |
|---|---|
| 静态 | 格式、尺寸、viewBox/画布、alpha、文件身份、谱系完整性 |
| 几何 | 主体边界、留白、重心、轮廓和主题 parity |
| 微尺寸/单色 | 像素贴合、负空间、辨识度、正反背景 |
| 渲染 | 同一证据画布上按主题和尺寸并排，不使用不同缩放掩盖差异 |
| 人工结论 | reviewer 明确 `accepted / rejected / blocked`，写理由与未覆盖项 |
| 修复后 | 执行 VisualBlockerResetGate，重新生成受影响全部证据 |

## 生命周期与晋升

本 Skill 初始为 `gray`。结构化探针只证明契约可执行，不证明长期收益。

晋升 `active` 前必须满足以下任一取样门槛：

- 至少 3 个可比较品牌视觉 WorkUnit 的前瞻证据；或
- 至少 2 个独立项目的真实使用证据。

证据还必须说明误触发率、人工修正率、验证成本和 blocker 复发率均在可接受边界。若成本失控、与设计系统 Owner 重叠或持续产生假阳性，保持/回退 gray；无人消费时进入 sunset 评估。

## 正负样例

- 正向：同一 SVG 母版导出 light/dark、16~512px 与单色版本，五类产物齐全，自动 parity 通过且人工结论 accepted。
- 负向：只有导出文件和一张大尺寸截图，缺母版 digest、微尺寸/单色矩阵或人工结论，状态必须是 `verification-pending`。
- 阻断：dark 主题轮廓偏移；即使单文件已修，也必须先重跑同母版矩阵和证据包，完成 reset 后才能重新验收。
